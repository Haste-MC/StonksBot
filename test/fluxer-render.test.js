/**
 * Tests für die Fluxer-Darstellung: Buttons gibt es dort nicht, also werden
 * Ansichten als Embed + Emoji-Reaktionen gerendert.
 *
 * Schwerpunkte: die Zuordnung Reaktion -> Aktion ist EINDEUTIG (sonst löst ein
 * Klick die falsche Sache aus), Navigation geht nie verloren, und die Zahl der
 * Reaktionen bleibt klein (jede ist ein eigener REST-Aufruf).
 *
 * Aufruf: npm run test:fluxer
 */
const { ActionRowBuilder, ButtonBuilder, ButtonStyle, EmbedBuilder } = require('discord.js');
// Guthaben mocken (ARCHITEKTUR §12: „npm test – kein Netz nötig"): die Firmenansicht
// unten gründet eine Firma, und das bucht.
const unb = require('../src/unb');
const wallet = { cash: 10_000_000, bank: 0, total: 10_000_000 };
unb.getBalance = async () => ({ ...wallet });
unb.changeCash = async () => ({ ...wallet });
unb.withdrawFromBank = async () => ({ ...wallet });
const render = require('../src/fluxer/render');
const db = require('../src/db');
const { buildMainMenu, ENTRIES, buildEntryView } = require('../src/menu');

const G = process.env.DEV_GUILD_ID || '561491377502945288';
const U = '498875863496916995';
let pass = 0, fail = 0;
const check = (label, ok, extra = '') => {
  if (ok) { pass++; console.log(`  ✅ ${label}`); }
  else { fail++; console.log(`  ❌ ${label} ${extra}`); }
};

/** Baut eine Ansicht aus einfachen Button-Beschreibungen. */
function view(buttons) {
  const rows = [];
  for (let i = 0; i < buttons.length; i += 5) {
    rows.push(new ActionRowBuilder().addComponents(...buttons.slice(i, i + 5).map((b) => {
      const btn = new ButtonBuilder()
        .setCustomId(b.id).setLabel(b.label ?? b.id).setStyle(ButtonStyle.Secondary);
      if (b.emoji) btn.setEmoji(b.emoji);
      if (b.disabled) btn.setDisabled(true);
      return btn;
    })));
  }
  return { embeds: [new EmbedBuilder().setTitle('T').setDescription('D')], components: rows };
}

(async () => {
  console.log('--- Grundlagen ---');
  const simple = render.toMessage(view([{ id: 'a|1' }, { id: 'b|2' }]));
  check('jede Aktion bekommt eine Reaktion', simple.reactions.length === 2);
  check('Reaktionen sind verschieden', new Set(simple.reactions).size === 2);
  check('Embed bleibt erhalten', simple.embed.title === 'T');
  check('Legende wird angehängt', simple.embed.description.includes('▬'));

  console.log('--- Deaktivierte Knöpfe bekommen nichts ---');
  const withNoop = render.toMessage(view([
    { id: 'prev|1', emoji: '◀️' },
    { id: 'noop', label: '2 / 5', disabled: true },
    { id: 'next|3', emoji: '▶️' },
  ]));
  check('Seitenanzeige wird übersprungen', withNoop.reactions.length === 2,
    withNoop.reactions.join(' '));
  check('keine Reaktion zeigt auf noop',
    !withNoop.mapping.some((m) => m.customId === 'noop'));

  console.log('--- Navigation behält ihr Symbol und hat Vorrang ---');
  const many = render.toMessage(view([
    ...Array.from({ length: 12 }, (_, i) => ({ id: `det|${i}`, label: `Auto ${i}` })),
    { id: 'prev|1', emoji: '◀️', label: 'Zurück' },
    { id: 'next|3', emoji: '▶️', label: 'Weiter' },
    { id: 'home|u', emoji: '🏠', label: 'Hauptmenü' },
  ]));
  check('◀️ ▶️ 🏠 sind dabei, obwohl sie hinten stehen',
    ['◀️', '▶️', '🏠'].every((e) => many.reactions.includes(e)), many.reactions.join(' '));
  check('◀️ zeigt auf die vorige Seite',
    many.mapping.find((m) => m.emoji === '◀️').customId === 'prev|1');
  check('🏠 zeigt aufs Hauptmenü',
    many.mapping.find((m) => m.emoji === '🏠').customId === 'home|u');

  console.log('--- Reaktionen bleiben knapp (jede ist ein REST-Aufruf) ---');
  check(`höchstens ${render.MAX_REACTIONS} Reaktionen`,
    many.reactions.length <= render.MAX_REACTIONS, String(many.reactions.length));
  check('Überzähliges wird gemeldet', many.embed.description.includes('weitere'));
  check('Zuordnung bleibt eindeutig',
    new Set(many.mapping.map((m) => m.emoji)).size === many.mapping.length);
  check('keine Aktion doppelt belegt',
    new Set(many.mapping.map((m) => m.customId)).size === many.mapping.length);

  console.log('--- Echte Ansichten des Bots ---');
  const main = render.toMessage(buildMainMenu({ userId: U }));
  check('Hauptmenü lässt sich darstellen', main.reactions.length > 0);
  check('Hauptmenü hält das Limit ein', main.reactions.length <= render.MAX_REACTIONS);

  let problems = [];
  for (const entry of ENTRIES) {
    const v = await buildEntryView(entry.id, { guildId: G, userId: U, page: 1 });
    const r = render.toMessage(v);
    if (r.reactions.length > render.MAX_REACTIONS) problems.push(`${entry.id}: zu viele`);
    if (new Set(r.reactions).size !== r.reactions.length) problems.push(`${entry.id}: doppelt`);
    if (!r.embed.title && !r.embed.description) problems.push(`${entry.id}: leer`);
  }
  check('jeder Menüpunkt rendert sauber', problems.length === 0, problems.join('; '));

  console.log('--- Firma mit Schließung, Vorfall und Chronik (Spec 2b: Darstellung) ---');
  {
    const ui = require('../src/ui');
    const company = require('../src/company');
    const DAY = 24 * 60 * 60 * 1000;
    const FG = `FR_T${Date.now()}`;
    const FU = 'fr_firma';
    const now = Date.now();
    const r = await company.found(FG, FU, 'cafe', 'Rösterei', now);
    check('Firma gegründet', r.ok, JSON.stringify(r));
    const c = db.getCompany(r.company.id);
    db.saveCompany({
      ...c,
      closed_until: now + 2 * DAY,
      news: [
        { at: now, text: '💧 Rohrbruch – Notdienst.', kasse: -1425 },
        { at: now - DAY, text: '⭐ Gute Bewertung.' },              // alte Zeile ohne kasse
      ],
    });
    db.insertEvent({ guildId: FG, userId: FU, kind: 'wasserschaden', platform: 'company',
      createdAt: now, expiresAt: now + DAY });

    const v = await ui.buildFirmaView({ guildId: FG, userId: FU });
    const fields = v.embeds[0].data.fields.map((f) => f.name);
    check('Felder Geschlossen, Vorfall, Chronik', ['🔒 Geschlossen', '⚠️ Vorfall', '📰 Chronik'].every((n) => fields.includes(n)),
      fields.join(', '));
    const chronik = v.embeds[0].data.fields.find((f) => f.name === '📰 Chronik').value;
    check('Chronik nennt die Kosten, alte Zeile ohne Betrag bleibt',
      chronik.includes('-1.425)') && chronik.includes('Gute Bewertung.') && !chronik.includes('Gute Bewertung. ('), chronik);
    const [row1, row2] = v.components.map((row) => row.components);
    check('Werbung und Anpacken sind bei Schließung gesperrt', row1[0].data.disabled === true && row1[1].data.disabled === true);
    check('letzter Knopf der zweiten Zeile ist der Vorfall', row2[row2.length - 1].data.custom_id === `vorfall|${FU}`,
      row2[row2.length - 1].data.custom_id);
    // Nicht die (immer wahre) Länge nach dem Abschneiden prüfen, sondern dass nichts abgeschnitten wurde.
    check('Firmenansicht hält das Fluxer-Limit (kein Überlauf)', render.mapReactions(v).overflow === undefined, String(render.mapReactions(v).overflow));

    const d = await ui.buildDecisionView({ guildId: FG, userId: FU });
    check('Vorfall-Ansicht: Titel beginnt mit 🏢', d.embeds[0].data.title.startsWith('🏢'), d.embeds[0].data.title);
    check('Fußzeile nennt die Firma', d.embeds[0].data.footer.text.includes('Rösterei'), d.embeds[0].data.footer.text);
    const back = d.components[1].components[0].data.custom_id;
    check('Zurück führt zur Firma', back === `menu|firma|1|${FU}`, back);
    check('Vorfall-Ansicht hält das Fluxer-Limit', render.toMessage(d).reactions.length <= render.MAX_REACTIONS);

    // Rückschau ohne offenen Vorfall: Firmeninhaber bekommen einen Firma-Knopf.
    db.clearEvents(FG, FU);
    const h = await ui.buildDecisionView({ guildId: FG, userId: FU });
    const ids = h.components[0].components.map((b) => b.data.custom_id);
    check('Rückschau: Netzwerk, Firma, Home', ids.includes(`menu|firma|1|${FU}`) && ids.includes(`menu|creator|1|${FU}`) && ids.length === 3, ids.join(' '));
    await company.close(FG, FU, now);
  }

  console.log('--- Waren und Lager (Spec 3a: Darstellung) ---');
  {
    const ui = require('../src/ui');
    const company = require('../src/company');
    const FG = `FR3_T${Date.now()}`;
    const FU = 'fr_lager';
    const now = Date.now();
    const r = await company.found(FG, FU, 'baufirma', 'Betonwerk', now);
    check('Baufirma gegründet', r.ok, JSON.stringify(r));
    const cid = r.company.id;
    await company.deposit(FG, FU, 100_000, now);

    // Betriebsansicht: Waren-Feld (Erstausstattung 280/280, Kurs = Start → „±0 %"; leeres Lager
    // warnt), Zeile 2 führt zum Lager statt zum Schließen.
    const v0 = await ui.buildFirmaView({ guildId: FG, userId: FU });
    const waren0 = v0.embeds[0].data.fields.find((f) => f.name === '📦 Waren');
    check('Erstausstattung: Feld nennt 280/280, reicht ~7 Tage, BETO ±0 %',
      waren0?.value.includes('**280/280**') && waren0.value.includes('reicht ~7 Tage') && waren0.value.includes('(BETO ±0 %)'), waren0?.value);
    db.saveCompany({ ...db.getCompany(cid), stock: 0, stock_cost: 0 });
    const v = await ui.buildFirmaView({ guildId: FG, userId: FU });
    const waren = v.embeds[0].data.fields.find((f) => f.name === '📦 Waren');
    check('Betriebsansicht hat das Feld 📦 Waren', !!waren, v.embeds[0].data.fields.map((f) => f.name).join(', '));
    check('leeres Lager: Feld warnt vor ad hoc', waren?.value.includes('leer') && waren.value.includes('ad hoc'), waren?.value);
    const alleIds = v.components.flatMap((row) => row.components.map((b) => b.data.custom_id));
    check('Zeile 2 führt zum Lager, nicht zum Schließen',
      v.components[1].components.some((b) => b.data.custom_id === `firma|lager|0|${FU}`) && !alleIds.some((id) => id.startsWith('firma|schliessen')),
      alleIds.join(' '));
    check('Betriebsansicht: höchstens 8 Knöpfe', alleIds.length <= 8, String(alleIds.length));
    check('Betriebsansicht hält das Fluxer-Limit (kein Überlauf)', render.mapReactions(v).overflow === undefined, String(render.mapReactions(v).overflow));

    // Ausbau: Schließen wohnt jetzt hier, in Zeile 1.
    const a = await ui.buildFirmaAusbauView({ guildId: FG, userId: FU });
    const zeile1 = a.components[0].components.map((b) => b.data.custom_id);
    check('Ausbau Zeile 1 enthält Schließen', zeile1.includes(`firma|schliessen|0|${FU}`), zeile1.join(' '));
    check('Ausbau hält das Fluxer-Limit (kein Überlauf)', render.mapReactions(a).overflow === undefined, String(render.mapReactions(a).overflow));

    // Lager-Ansicht: Titel, vier Knöpfe, Einkaufen aktiv bei Kasse ≥ Tagespreis.
    const l = await ui.buildFirmaLagerView({ guildId: FG, userId: FU });
    check('Lager: Titel beginnt mit 🏬', l.embeds[0].data.title.startsWith('🏬'), l.embeds[0].data.title);
    const lk = l.components[0].components;
    check('Lager: vier Knöpfe', l.components.length === 1 && lk.length === 4, String(lk.length));
    check('Lager: Einkaufen aktiv (Kasse 100.000 ≥ 340)', lk[0].data.custom_id === `firma|einkaufen|0|${FU}` && lk[0].data.disabled !== true);
    check('Lager: Voll machen nennt die freien Plätze (280)', lk[1].data.custom_id === `firma|lagervoll|0|${FU}` && lk[1].data.label.includes('(280)'), lk[1].data.label);
    check('Lager: leerer Bestand sagt „leer", nicht „reicht ~0 Tage"',
      l.embeds[0].data.fields.find((f) => f.name === 'Bestand')?.value.includes('leer')
      && !l.embeds[0].data.fields.find((f) => f.name === 'Bestand')?.value.includes('reicht'), l.embeds[0].data.fields.find((f) => f.name === 'Bestand')?.value);
    check('Lager: Beschreibung nennt Lieferant und Tagespreis', l.embeds[0].data.description.includes('BETO') && l.embeds[0].data.description.includes('Tagespreis'));
    check('Lager hält das Fluxer-Limit (kein Überlauf)', render.mapReactions(l).overflow === undefined, String(render.mapReactions(l).overflow));
    console.log('    ' + l.embeds[0].data.title);
    for (const zeile of l.embeds[0].data.description.split('\n')) console.log('    ' + zeile);
    for (const f of l.embeds[0].data.fields) console.log(`    [${f.name}] ${f.value}`);
    console.log('    Knöpfe: ' + lk.map((b) => `${b.data.emoji?.name ?? ''} ${b.data.label}${b.data.disabled ? ' (aus)' : ''}`).join(' · '));

    // Kasse zu klein: Einkaufen gesperrt.
    db.saveCompany({ ...db.getCompany(cid), kasse: 100 });
    const l2 = await ui.buildFirmaLagerView({ guildId: FG, userId: FU });
    check('Lager: Einkaufen gesperrt bei Kasse < Tagespreis', l2.components[0].components[0].data.disabled === true);
    // Volles Lager (Erstausstattung): nichts zu kaufen, beide Kaufknöpfe aus.
    db.saveCompany({ ...db.getCompany(cid), kasse: 100_000, stock: 280, stock_cost: 95_200 });
    const l3 = await ui.buildFirmaLagerView({ guildId: FG, userId: FU });
    check('Lager voll: Einkaufen und Voll machen (0) gesperrt', l3.components[0].components[0].data.disabled === true
      && l3.components[0].components[1].data.disabled === true && l3.components[0].components[1].data.label.includes('(0)'),
      l3.components[0].components[1].data.label);

    // Börse: der Lieferant nennt seine Branchen.
    const av = await ui.buildAssetView({ guildId: FG, userId: FU, symbol: 'BETO' });
    const lief = av.embeds[0].data.fields.find((f) => f.name === '🏭 Lieferant für');
    check('BETO: Lieferant für Baufirma', lief?.value.includes('Baufirma'), lief?.value);
    const av2 = await ui.buildAssetView({ guildId: FG, userId: FU, symbol: 'DÖNR' });
    const lief2 = av2.embeds[0].data.fields.find((f) => f.name === '🏭 Lieferant für');
    check('DÖNR: Lieferant für Imbiss und Café', lief2?.value.includes('Imbiss') && lief2.value.includes('Café'), lief2?.value);
    await company.close(FG, FU, now);
  }

  console.log('--- Handel: Spedition als Großhändler (Spec 3b: Darstellung) ---');
  {
    const ui = require('../src/ui');
    const company = require('../src/company');
    const FG = `FR3B_T${Date.now()}`;
    const FT = 'fr_spedi';
    const FK = 'fr_kiosk';
    const now = Date.now();
    let r = await company.found(FG, FT, 'spedition', 'Blitz-Spedition', now);
    check('Spedition gegründet', r.ok, JSON.stringify(r));
    const tid = r.company.id;
    r = await company.found(FG, FK, 'kiosk', 'Eckladen', now);
    check('Kiosk gegründet', r.ok, JSON.stringify(r));
    const kid = r.company.id;
    await company.deposit(FG, FT, 500_000, now);
    await company.deposit(FG, FK, 500_000, now);
    company.setOffer(FG, FT, 'alle', 95, now);
    // Lager des Käufers muss Platz haben, damit „Bei Spediteur kaufen" aktiv ist.
    db.saveCompany({ ...db.getCompany(kid), stock: 0, stock_cost: 0, kasse: 500_000 });

    const kaeuferLager = await ui.buildFirmaLagerView({ guildId: FG, userId: FK });
    const kFields = kaeuferLager.embeds[0].data.fields.map((f) => f.name);
    check('Käufer-Lager zeigt 🚚 Spediteure', kFields.includes('🚚 Spediteure'), kFields.join(', '));
    const kIds = kaeuferLager.components.flatMap((row) => row.components.map((b) => b.data.custom_id));
    check('Käufer-Lager hat den Kauf-Knopf', kIds.includes(`firma|handelkauf|0|${FK}`), kIds.join(' '));
    const kaufBtn = kaeuferLager.components.flatMap((row) => row.components).find((b) => b.data.custom_id === `firma|handelkauf|0|${FK}`);
    check('Kauf-Knopf ist aktiv (Lager frei, Kasse reicht)', kaufBtn.data.disabled !== true);
    check('Käufer-Lager hält das Fluxer-Limit', render.mapReactions(kaeuferLager).overflow === undefined,
      String(render.mapReactions(kaeuferLager).overflow));

    const spediLager = await ui.buildFirmaLagerView({ guildId: FG, userId: FT });
    const sIds = spediLager.components.flatMap((row) => row.components.map((b) => b.data.custom_id));
    check('Spediteur-Lager zeigt „Handel"', sIds.includes(`firma|handel|0|${FT}`), sIds.join(' '));
    check('Spediteur-Lager hält das Fluxer-Limit', render.mapReactions(spediLager).overflow === undefined,
      String(render.mapReactions(spediLager).overflow));

    const handel = await ui.buildFirmaHandelView({ guildId: FG, userId: FT });
    check('Handel-Ansicht: Titel beginnt mit 🚚', handel.embeds[0].data.title.startsWith('🚚'), handel.embeds[0].data.title);
    const hButtons = handel.components.flatMap((row) => row.components);
    check('Handel-Ansicht: fünf Knöpfe', handel.components.length === 1 && hButtons.length === 5, String(hButtons.length));
    check('Handel-Ansicht hält das Fluxer-Limit (kein Überlauf)', render.mapReactions(handel).overflow === undefined,
      String(render.mapReactions(handel).overflow));
    console.log('    ' + handel.embeds[0].data.title);
    for (const zeile of handel.embeds[0].data.description.split('\n')) console.log('    ' + zeile);

    const spediBetrieb = await ui.buildFirmaView({ guildId: FG, userId: FT });
    const waren = spediBetrieb.embeds[0].data.fields.find((f) => f.name === '📦 Waren');
    check('Betriebsansicht der Spedition enthält „🚚 Handel:"', waren?.value.includes('🚚 Handel:'), waren?.value);

    // Eine Spedition ist selbst auch Kunde ihrer eigenen Branche „spedition" – beliefert
    // sie eine ANDERE Spedition, zeigt ihre Lager-Ansicht sowohl den eigenen „Handel"-Knopf
    // als auch „Bei Spediteur kaufen" und braucht dafür zwei Zeilen (ARCHITEKTUR §15,
    // Kommentar in buildFirmaLagerView: „sonst wären es sechs Knöpfe in einer").
    const FT2 = 'fr_spedi2';
    r = await company.found(FG, FT2, 'spedition', 'Turbo-Spedition', now);
    check('zweite Spedition gegründet', r.ok, JSON.stringify(r));
    await company.deposit(FG, FT2, 500_000, now);
    company.setOffer(FG, FT2, 'spedition', 95, now);

    const spediLager2 = await ui.buildFirmaLagerView({ guildId: FG, userId: FT });
    const s2Fields = spediLager2.embeds[0].data.fields.map((f) => f.name);
    check('Spediteur-Lager (beliefert von anderer Spedition) zeigt „🚚 Spediteure"',
      s2Fields.includes('🚚 Spediteure'), s2Fields.join(', '));
    check('Spediteur-Lager (beliefert): zwei Zeilen', spediLager2.components.length === 2,
      String(spediLager2.components.length));
    for (const row of spediLager2.components) {
      check('Spediteur-Lager (beliefert): höchstens fünf Knöpfe je Zeile', row.components.length <= 5,
        String(row.components.length));
    }
    check('Spediteur-Lager (beliefert) hält das Fluxer-Limit (kein Überlauf)',
      render.mapReactions(spediLager2).overflow === undefined, String(render.mapReactions(spediLager2).overflow));

    await company.close(FG, FT2, now);
    await company.close(FG, FT, now);
    await company.close(FG, FK, now);
  }

  console.log('--- Zuordnung übersteht einen Neustart (liegt in der DB) ---');
  const msgId = `MSG_${Date.now()}`;
  render.remember(msgId, U, many.mapping);
  const hit = render.lookup(msgId, '🏠');
  check('gemerkte Aktion wird wiedergefunden', hit && hit.customId === 'home|u',
    JSON.stringify(hit));
  check('Besitzer wird mitgeführt', hit.userId === U);
  check('unbekannte Reaktion liefert nichts', render.lookup(msgId, '🤡') === null);
  check('unbekannte Nachricht liefert nichts', render.lookup('GIBTSNICHT', '🏠') === null);
  db.purgeFluxerViews(Date.now() + 1000);

  console.log('--- Reaktionen sauber abgleichen (keine toten Symbole) ---');
  // Wechselt die Ansicht, müssen die Reaktionen der alten verschwinden.
  const msg2 = `MSG2_${Date.now()}`;
  const viewA = render.toMessage(view([{ id: 'a|1' }, { id: 'b|2' }, { id: 'c|3' }]));
  render.remember(msg2, U, viewA.mapping);
  check('aktuelle Reaktionen sind abrufbar',
    render.current(msg2).join(' ') === viewA.reactions.join(' '));
  const viewB = render.toMessage(view([{ id: 'x|9' }]));
  render.remember(msg2, U, viewB.mapping);
  const stale = render.current(msg2);
  check('nach dem Wechsel nur noch die neuen', stale.length === 1, stale.join(' '));
  check('alte Aktion ist nicht mehr erreichbar', render.lookup(msg2, '3️⃣') === null);

  console.log('--- Reaktions-Ereignis des echten SDK wird verstanden ---');
  // Form laut @fluxerjs/core: { reaction, user, messageId, channelId, emoji:{name}, userId }
  const payload = {
    reaction: { messageId: msg2, channelId: 'c1' },
    user: { id: U },
    userId: U,
    messageId: msg2,
    channelId: 'c1',
    emoji: { name: viewB.reactions[0] },
  };
  const parsed = {
    emoji: payload.emoji?.name,
    userId: payload.userId ?? payload.user?.id,
    messageId: payload.messageId ?? payload.reaction?.messageId,
  };
  check('Emoji wird aus emoji.name gelesen', parsed.emoji === viewB.reactions[0]);
  check('Klick findet die richtige Aktion',
    render.lookup(parsed.messageId, parsed.emoji)?.customId === 'x|9');
  db.purgeFluxerViews(Date.now() + 1000);

  console.log('--- Währungssymbol: Discord-Emoji hat auf Fluxer nichts verloren ---');
  // Das Symbol kommt von UnbelievaBoat und ist deshalb IMMER ein Discord-Emoji.
  // Früher wurde es nur in Embeds übersetzt – in Textantworten und in der
  // Brücke blieb `:Rubine:` stehen. Jetzt hängt alles an emoji.js.
  const currency = require('../src/currency');
  const identity = require('../src/identity');
  const unbmod = require('../src/unb');
  unbmod.unb.getGuild = async () => ({ currencySymbol: '<:Rubine:1067>' });
  await currency.getSymbol(identity.world());
  const emoji = require('../src/fluxer/emoji');

  const raw = '🏠 Mieteinnahmen: <:Rubine:1067> 275 von deinen Mietobjekten.';
  check('Währungsemoji wird ersetzt', emoji.toFluxer(raw).includes('🪙'), emoji.toFluxer(raw));
  check('nichts Rohes bleibt übrig', !/<a?:[^:]+:\d+>/.test(emoji.toFluxer(raw)));
  check('fremdes Emoji wird zum Namen',
    emoji.toFluxer('<:check:456> fertig') === 'check fertig', emoji.toFluxer('<:check:456> fertig'));
  check('auch animierte Emojis (früher übersehen)',
    emoji.toFluxer('<a:tanz:99> los') === 'tanz los', emoji.toFluxer('<a:tanz:99> los'));
  check('Text ohne Emoji bleibt unverändert',
    emoji.toFluxer('einfach nur Text') === 'einfach nur Text');
  check('Nicht-Text überlebt', emoji.toFluxer(undefined) === undefined);

  check('forFluxer übersetzt auch Erwähnungen und Emojis zusammen',
    !render.forFluxer(raw).includes('<:'), render.forFluxer(raw));
  const embedded = render.toMessage({
    embeds: [new EmbedBuilder().setTitle(`Kontostand <:Rubine:1067> 5`).setDescription(raw)],
    components: [],
  }).embed;
  check('Embeds bleiben übersetzt', !`${embedded.title}${embedded.description}`.includes('<:'),
    embedded.title);

  console.log('--- FLUXER_CURRENCY_SYMBOL darf man schlampig eintragen ---');
  // Fluxer rendert im Text `<:Name:ID>`. Wer nur die ID aus der Oberfläche
  // kopiert, hätte sonst die nackte Zahl im Chat stehen.
  const ID = '1543693306263769088';
  check('nackte ID wird ergänzt',
    emoji.normalizeSymbol(ID, 'Rubine') === `<:Rubine:${ID}>`,
    emoji.normalizeSymbol(ID, 'Rubine'));
  check('vollständige Angabe bleibt',
    emoji.normalizeSymbol(`<:Rubine:${ID}>`) === `<:Rubine:${ID}>`);
  check('Reaktions-Schreibweise wird umgebaut',
    emoji.normalizeSymbol(`Rubine:${ID}`) === `<:Rubine:${ID}>`);
  check('mit führendem Doppelpunkt ebenso',
    emoji.normalizeSymbol(`:Rubine:${ID}`) === `<:Rubine:${ID}>`);
  check('animiert bleibt animiert',
    emoji.normalizeSymbol(`a:Tanz:${ID}`) === `<a:Tanz:${ID}>`);
  check('normales Emoji bleibt unangetastet', emoji.normalizeSymbol('🪙') === '🪙');
  check('leer bleibt leer', emoji.normalizeSymbol('') === '' && emoji.normalizeSymbol(null) === '');
  check('ohne Name springt ein Ersatzname ein',
    /^<:\w+:\d+>$/.test(emoji.normalizeSymbol(ID)), emoji.normalizeSymbol(ID));

  console.log('--- Textantworten laufen durch dieselbe Übersetzung ---');
  // Der eigentliche Fehler: followUp/reply gingen roh raus (Abrechnungen,
  // Kaufbestätigungen, Fehlermeldungen).
  const sent = [];
  const fakeChannel = { id: 'c1', async send(payload) { sent.push(payload); return { id: 'm1' }; } };
  const { createInteraction } = require('../src/fluxer/interaction');
  const interaction = createInteraction({
    channel: fakeChannel, message: null, userId: U, platformUserId: 'FX1', guildId: G,
    prompt: async () => null,
  });
  await interaction.followUp({ content: raw });
  await interaction.reply(`Gekauft für <:Rubine:1067> 900`);
  check('followUp ist übersetzt', sent[0] && !sent[0].content.includes('<:'), sent[0]?.content);
  check('reply ist übersetzt', sent[1] && sent[1].content.includes('🪙'), sent[1]?.content);
  check('die Erwähnung bleibt erhalten (soll pingen)',
    sent.every((m) => m.content.startsWith('<@FX1>')), sent[0]?.content);

  console.log('--- Profilbild: Fluxer zeigt nur das Autorbild ---');
  /*
   * Auf Discord steht das Profilbild groß oben rechts (thumbnail). Fluxer
   * stellt thumbnail nicht dar – dort muss es in den Autorblock wandern,
   * sonst ist es schlicht weg (genau das ist schon einmal passiert).
   */
  const profil = new EmbedBuilder().setTitle('👤 Profil').setDescription('D')
    .setThumbnail('https://cdn.example/avatar.png')
    .setAuthor({ name: 'Kevin' })
    .setImage('https://cdn.example/haus.png');
  const fluxerProfil = render.toMessage({ embeds: [profil], components: [] }).embed;
  check('das Bild landet beim Autor',
    fluxerProfil.author?.icon_url === 'https://cdn.example/avatar.png',
    JSON.stringify(fluxerProfil.author));
  // Das Miniaturbild bleibt zusätzlich dran: Zeigt eine neue Fluxer-Version
  // es doch, steht das Bild groß in der Ecke – ohne Codeänderung.
  check('das Miniaturbild bleibt für später dran',
    fluxerProfil.thumbnail?.url === 'https://cdn.example/avatar.png',
    JSON.stringify(fluxerProfil.thumbnail));
  check('das große Foto bleibt, wo es war',
    fluxerProfil.image?.url === 'https://cdn.example/haus.png');

  const autoEmbed = new EmbedBuilder().setTitle('Auto').setDescription('D')
    .setThumbnail('https://cdn.example/auto.png');
  check('ohne Autor bleibt das Miniaturbild unangetastet',
    render.toMessage({ embeds: [autoEmbed], components: [] }).embed.thumbnail?.url
      === 'https://cdn.example/auto.png');

  console.log('--- Rohe IDs stehen bleiben lassen wir nicht ---');
  /*
   * Fluxer kann eine Discord-ID nicht auflösen. Kennen wir den Namen, steht
   * er da; kennen wir ihn nicht, war es bisher eine nackte 19-stellige Zahl –
   * genau das war in der Rangliste zu sehen.
   */
  identity.remember('112233445566778899', 'Bekannter');
  check('bekannter Name gewinnt',
    render.forFluxer('<@112233445566778899> hat geboten') === '**Bekannter** hat geboten',
    render.forFluxer('<@112233445566778899> hat geboten'));
  const unbekannt = render.forFluxer('<@987654321098765432> führt');
  check('unbekannt wird lesbar statt roh', unbekannt === '**Spieler #5432** führt', unbekannt);
  check('keine rohe ID mehr im Text', !unbekannt.includes('987654321098765432'), unbekannt);
  check('andere Klammern bleiben unangetastet',
    render.forFluxer('<@nicht-eine-id> hallo') === '<@nicht-eine-id> hallo');

  console.log('--- Modal-Ersatz: die Antwort muss ankommen ---');
  /*
   * Der Fehler: `ask` merkte sich die Frage unter dem KONTO (fx:FX2 oder die
   * verknüpfte Discord-ID), die eingehende Antwort trägt aber die Fluxer-ID
   * des Absenders. Dadurch wurde keine Eingabe je angenommen – eigener
   * Casino-Einsatz, Gebot, Spruch, Stückzahl und Titel liefen alle ins Leere.
   */
  const prompt = require('../src/fluxer/prompt');
  const askChannel = { id: 'c9', async send() { return { id: 'm9' }; } };
  const askInteraction = createInteraction({
    channel: askChannel, message: null, userId: `fx:FX2`, platformUserId: 'FX2', guildId: G,
    prompt: (opts) => prompt.ask(opts),
  });
  const modal = {
    toJSON: () => ({
      custom_id: 'cbetset|slots|fx:FX2',
      title: 'Eigener Einsatz',
      components: [{ components: [{ custom_id: 'amount', label: 'Betrag' }] }],
    }),
  };
  const answering = askInteraction.showModal(modal);
  await new Promise((r) => setImmediate(r));
  check('die Frage steht offen', prompt.pending() === 1, String(prompt.pending()));
  check('eine fremde Nachricht zählt nicht',
    prompt.consume({ channel: { id: 'c9' }, author: { id: 'ANDERER' }, content: '999' }) === false);
  check('die eigene Antwort wird angenommen',
    prompt.consume({ channel: { id: 'c9' }, author: { id: 'FX2' }, content: '500' }) === true);
  const answered = await answering;
  check('und kommt beim Handler an', answered.answer === '500', JSON.stringify(answered));
  check('die Frage ist danach zu', prompt.pending() === 0, String(prompt.pending()));

  console.log(`\n${pass} bestanden, ${fail} fehlgeschlagen`);
  process.exit(fail === 0 ? 0 : 1);
})();
