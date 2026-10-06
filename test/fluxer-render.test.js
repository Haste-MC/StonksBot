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
    const row2Ids = row2.map((b) => b.data.custom_id);
    check('zweite Zeile hat den Vorfall UND einen Rückweg',
      row2Ids.includes(`vorfall|company|${FU}`) && row2Ids[row2Ids.length - 1] === `home|${FU}`, row2Ids.join(' '));
    // Nicht die (immer wahre) Länge nach dem Abschneiden prüfen, sondern dass nichts abgeschnitten wurde.
    check('Firmenansicht hält das Fluxer-Limit (kein Überlauf)', render.mapReactions(v).overflow === undefined, String(render.mapReactions(v).overflow));

    const d = await ui.buildDecisionView({ guildId: FG, userId: FU });
    check('Vorfall-Ansicht: Titel beginnt mit 🏢', d.embeds[0].data.title.startsWith('🏢'), d.embeds[0].data.title);
    check('Fußzeile nennt die Firma', d.embeds[0].data.footer.text.includes('Rösterei'), d.embeds[0].data.footer.text);
    const back = d.components[1].components[0].data.custom_id;
    // Stück 4: der Weg zurück nennt die Firma des Vorfalls, nicht mehr nur das Menü.
    check('Zurück führt zur Firma des Vorfalls', back === `firma|oeffnen|${r.company.id}|${FU}`, back);
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
      v.components[1].components.some((b) => b.data.custom_id === `firma|lager|${cid}|${FU}`) && !alleIds.some((id) => id.startsWith('firma|schliessen')),
      alleIds.join(' '));
    check('Betriebsansicht: höchstens 8 Knöpfe', alleIds.length <= 8, String(alleIds.length));
    check('Betriebsansicht hält das Fluxer-Limit (kein Überlauf)', render.mapReactions(v).overflow === undefined, String(render.mapReactions(v).overflow));

    // Ausbau: Schließen wohnt jetzt hier, in Zeile 1.
    const a = await ui.buildFirmaAusbauView({ guildId: FG, userId: FU });
    const zeile1 = a.components[0].components.map((b) => b.data.custom_id);
    check('Ausbau Zeile 1 enthält Schließen', zeile1.includes(`firma|schliessen|${cid}|${FU}`), zeile1.join(' '));
    check('Ausbau hält das Fluxer-Limit (kein Überlauf)', render.mapReactions(a).overflow === undefined, String(render.mapReactions(a).overflow));

    // Lager-Ansicht: Titel, vier Knöpfe, Einkaufen aktiv bei Kasse ≥ Tagespreis.
    const l = await ui.buildFirmaLagerView({ guildId: FG, userId: FU });
    check('Lager: Titel beginnt mit 🏬', l.embeds[0].data.title.startsWith('🏬'), l.embeds[0].data.title);
    const lk = l.components[0].components;
    check('Lager: vier Knöpfe', l.components.length === 1 && lk.length === 4, String(lk.length));
    check('Lager: Einkaufen aktiv (Kasse 100.000 ≥ 340)', lk[0].data.custom_id === `firma|einkaufen|${cid}|${FU}` && lk[0].data.disabled !== true);
    check('Lager: Voll machen nennt die freien Plätze (280)', lk[1].data.custom_id === `firma|lagervoll|${cid}|${FU}` && lk[1].data.label.includes('(280)'), lk[1].data.label);
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
    check('Käufer-Lager hat den Kauf-Knopf', kIds.includes(`firma|handelkauf|${kid}|${FK}`), kIds.join(' '));
    const kaufBtn = kaeuferLager.components.flatMap((row) => row.components).find((b) => b.data.custom_id === `firma|handelkauf|${kid}|${FK}`);
    check('Kauf-Knopf ist aktiv (Lager frei, Kasse reicht)', kaufBtn.data.disabled !== true);
    check('Käufer-Lager hält das Fluxer-Limit', render.mapReactions(kaeuferLager).overflow === undefined,
      String(render.mapReactions(kaeuferLager).overflow));

    const spediLager = await ui.buildFirmaLagerView({ guildId: FG, userId: FT });
    const sIds = spediLager.components.flatMap((row) => row.components.map((b) => b.data.custom_id));
    check('Spediteur-Lager zeigt „Handel"', sIds.includes(`firma|handel|${tid}|${FT}`), sIds.join(' '));
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

  console.log('--- Nachfrage-Drift (Spec 3c A: Darstellung) ---');
  {
    const ui = require('../src/ui');
    const wallstreet = require('../src/wallstreet');
    // Frischer Server: noch keine Firma hat Beton gekauft – „keine".
    const NG = `FRN_T${Date.now()}`;
    const now = Date.now();
    const vor = await ui.buildAssetView({ guildId: NG, userId: U, symbol: 'BETO' });
    const nachfrageVor = vor.embeds[0].data.fields.find((f) => f.name === '🏭 Nachfrage');
    check('BETO ohne Einkäufe: Nachfrage „keine"', nachfrageVor?.value === 'keine', nachfrageVor?.value);
    wallstreet.recordDemand(NG, 'BETO', 140, now);
    const nach = await ui.buildAssetView({ guildId: NG, userId: U, symbol: 'BETO' });
    const nachfrage = nach.embeds[0].data.fields.find((f) => f.name === '🏭 Nachfrage')?.value ?? '';
    // 140 Einheiten heute, EMA über 7 Tage: 140 / 7 = 20 Einheiten/Tag.
    check('BETO nach 140 Einheiten: Ø 20 Einheiten/Tag und Drift je Tag',
      /Ø \*\*20 Einheiten\/Tag\*\* \(7 Tage\) · Drift \+\d+,\d{2} %\/Tag/.test(nachfrage), nachfrage);
    check('Drift ist positiv', !/Drift \+0,00 %/.test(nachfrage), nachfrage);
  }

  console.log('--- Firmenanteile (Spec 3c C: Darstellung) ---');
  {
    const ui = require('../src/ui');
    const company = require('../src/company');
    const FG = `FR3C_T${Date.now()}`;
    const FO = 'fr_inhaber';
    const FA = 'fr_anleger';
    const now = Date.now();
    let r = await company.found(FG, FO, 'baufirma', 'Bau AG', now);
    check('Baufirma gegründet', r.ok, JSON.stringify(r));
    const cid = r.company.id;
    await company.deposit(FG, FO, 200_000, now);

    // Ausbau-Ansicht: 9 Knöpfe (4 + Anteile in Zeile 1, 4 Extras) – die Fluxer-Grenze genau.
    // Stufe 0: die Extras sind noch gesperrt – erst die Stufe setzen, damit alle 9 zählen.
    db.setCompanyStufe(cid, 4);
    const a = await ui.buildFirmaAusbauView({ guildId: FG, userId: FO });
    const aIds = a.components.flatMap((row) => row.components.map((b) => b.data.custom_id));
    const aAktiv = a.components.flatMap((row) => row.components).filter((b) => !b.data.disabled);
    check('Ausbau Zeile 1 enthält Anteile', a.components[0].components.some((b) => b.data.custom_id === `firma|anteile|${cid}|${FO}`), aIds.join(' '));
    check('Ausbau: 9 Knöpfe, alle aktiv', aIds.length === 9 && aAktiv.length === 9, `${aIds.length} / ${aAktiv.length} aktiv`);
    for (const row of a.components) check('Ausbau: höchstens fünf Knöpfe je Zeile', row.components.length <= 5, String(row.components.length));
    check('Ausbau mit 9 Knöpfen hält das Fluxer-Limit genau (kein Überlauf)',
      render.mapReactions(a).overflow === undefined && render.mapReactions(a).length === render.MAX_REACTIONS,
      `${render.mapReactions(a).length} / overflow ${render.mapReactions(a).overflow}`);

    // Anteile-Ansicht unter Stufe 2: Hinweis, Anbieten gesperrt.
    db.setCompanyStufe(cid, 1);
    const v1 = await ui.buildFirmaAnteileView({ guildId: FG, userId: FO });
    check('Anteile (Stufe 1): Hinweis „Noch kein Börsengang"', v1.embeds[0].data.fields.some((f) => f.name.includes('Noch kein Börsengang')),
      v1.embeds[0].data.fields.map((f) => f.name).join(', '));
    check('Anteile (Stufe 1): Anbieten gesperrt', v1.components[0].components[0].data.disabled === true);

    // Stufe 2 mit einem Angebot: Verteilung, Angebot, Zurückziehen aktiv mit der Angebots-ID.
    db.setCompanyStufe(cid, 2);
    r = company.listShares(FG, FO, cid, 100, 2_500, now);
    check('100 Anteile à 2.500 angeboten', r.ok, JSON.stringify(r));
    const offerId = r.offer.id;
    const v2 = await ui.buildFirmaAnteileView({ guildId: FG, userId: FO });
    const v2Fields = Object.fromEntries(v2.embeds[0].data.fields.map((f) => [f.name, f.value]));
    check('Anteile: Titel beginnt mit 📊', v2.embeds[0].data.title.startsWith('📊'), v2.embeds[0].data.title);
    check('Anteile: Verteilung „Du 1000 – alle Anteile bei dir"', v2Fields['🥧 Verteilung']?.includes('**1000**'), v2Fields['🥧 Verteilung']);
    check('Anteile: Buchwert je Anteil ist eine Zahl', /\d/.test(v2Fields['📒 Buchwert je Anteil'] ?? ''), v2Fields['📒 Buchwert je Anteil']);
    check('Anteile: Anbieten nennt 390 freie (490 − 100 im Angebot)', v2Fields['📤 Anbieten']?.includes('**390**') && v2Fields['📤 Anbieten'].includes('100 schon'), v2Fields['📤 Anbieten']);
    check('Anteile: Angebot #id · 100 Anteile à 2.500 von dir',
      v2Fields['🏷️ Offene Angebote (1)']?.includes(`#${offerId}`) && v2Fields['🏷️ Offene Angebote (1)'].includes('**100**') && v2Fields['🏷️ Offene Angebote (1)'].includes('2.500') && v2Fields['🏷️ Offene Angebote (1)'].includes('von dir'),
      v2Fields['🏷️ Offene Angebote (1)']);
    const v2Ids = v2.components[0].components.map((b) => b.data.custom_id);
    check('Anteile: Knöpfe Anbieten · Zurückziehen(#id) · Firma · Home',
      v2Ids.join(' ') === `firma|anteilanbieten|${cid}|${FO} firma|anteilweg|${offerId}|${FO} firma|oeffnen|${cid}|${FO} home|${FO}`, v2Ids.join(' '));
    check('Anteile: Zurückziehen aktiv', v2.components[0].components[1].data.disabled !== true);
    check('Anteile-Ansicht hält das Fluxer-Limit (kein Überlauf)', render.mapReactions(v2).overflow === undefined, String(render.mapReactions(v2).overflow));
    console.log('    ' + v2.embeds[0].data.title);
    for (const f of v2.embeds[0].data.fields) console.log(`    [${f.name}] ${f.value.replace(/\n/g, ' | ')}`);

    // Markt-Liste mit 2 Angeboten: Zeile nennt #id, Firma, Branche, Stufe, Firma-Nr, Anteile, Preis, Buchwert, Ausschüttung.
    r = company.listShares(FG, FO, cid, 40, 5_000, now);
    const offer2 = r.offer.id;
    const m = await ui.buildAnteileMarktView({ guildId: FG, userId: FA, page: 1 });
    const mDesc = m.embeds[0].data.description;
    check('Markt: Titel 🏢 Firmenanteile', m.embeds[0].data.title === '🏢 Firmenanteile', m.embeds[0].data.title);
    check('Markt: beide Angebote, billigstes zuerst', mDesc.indexOf(`#${offerId} `) < mDesc.indexOf(`#${offer2} `) && mDesc.includes('**100** Anteile à **'), mDesc);
    check('Markt: Zeile nennt 🏗️ Bau AG (Baufirma, Stufe 2, Firma-Nr), Buchwert und letzte Ausschüttung',
      mDesc.includes(`🏗️ **Bau AG** (Baufirma, Stufe 2, Firma-Nr ${cid})`) && !mDesc.includes('undefined') && mDesc.includes('Buchwert') && mDesc.includes('letzte Ausschüttung') && mDesc.includes('/Anteil'), mDesc);
    const mIds = m.components.flatMap((row) => row.components.map((b) => b.data.custom_id));
    check('Markt: Knöpfe Kaufen · Meine Anteile · Börse · Home, keine Seitenknöpfe bei einer Seite',
      mIds.join(' ') === `wanteilkauf|${FA} wmeine|${FA} wkind|all|${FA} home|${FA}`, mIds.join(' '));
    check('Markt: Kaufen aktiv', m.components[0].components[0].data.disabled !== true);
    check('Markt-Liste hält das Fluxer-Limit (kein Überlauf)', render.mapReactions(m).overflow === undefined, String(render.mapReactions(m).overflow));
    for (const zeile of mDesc.split('\n')) console.log('    ' + zeile);

    // Leere Liste: Kaufen gesperrt.
    const leer = await ui.buildAnteileMarktView({ guildId: `LEER_${FG}`, userId: FA, page: 1 });
    check('Markt leer: Kaufen gesperrt, Hinweis', leer.components[0].components[0].data.disabled === true && leer.embeds[0].data.description.includes('Niemand'));

    // Sechs Angebote → zwei Seiten → zweite Zeile mit ◀ ▶.
    for (let i = 0; i < 4; i++) company.listShares(FG, FO, cid, 10, 6_000 + i, now);
    const m2 = await ui.buildAnteileMarktView({ guildId: FG, userId: FA, page: 2 });
    check('Markt (2 Seiten): zweite Zeile mit Zurück/Weiter', m2.components.length === 2
      && m2.components[1].components[0].data.custom_id === `wanteile|1|${FA}` && m2.components[1].components[2].data.disabled === true,
      m2.components.map((row) => row.components.map((b) => b.data.custom_id).join(' ')).join(' / '));
    for (const row of m2.components) check('Markt (2 Seiten): höchstens fünf Knöpfe je Zeile', row.components.length <= 5, String(row.components.length));
    check('Markt (2 Seiten): Seite 2 zeigt ein Angebot', (m2.embeds[0].data.description.match(/^#\d+ /gm) ?? []).length === 1, m2.embeds[0].data.description);
    check('Markt (2 Seiten) hält das Fluxer-Limit', render.mapReactions(m2).overflow === undefined, String(render.mapReactions(m2).overflow));

    // Börse-Nav: Firmenanteile in der Filterzeile, Depot in der Navigation – jede Zeile ≤ 5.
    const boerse = await ui.buildMarketView({ guildId: FG, userId: FA, page: 1 });
    const bIds = boerse.components.flatMap((row) => row.components.map((b) => b.data.custom_id));
    check('Börse-Nav enthält wanteile|1 und wdepot', bIds.includes(`wanteile|1|${FA}`) && bIds.includes(`wdepot|${FA}`), bIds.join(' '));
    for (const row of boerse.components) check('Börse: höchstens fünf Knöpfe je Zeile', row.components.length <= 5, String(row.components.length));
    check('Börse: höchstens fünf Zeilen', boerse.components.length <= 5, String(boerse.components.length));

    // Meine Anteile ohne Beteiligung: Abholen und Verkaufen gesperrt.
    const leer2 = await ui.buildMeineAnteileView({ guildId: FG, userId: FA });
    check('Meine Anteile (leer): Abholen und Verkaufen gesperrt',
      leer2.components[0].components[0].data.disabled === true && leer2.components[0].components[1].data.disabled === true);

    // Anleger kauft 100, Inhaber entnimmt → pending > 0 → Abholen aktiv.
    r = await company.buyShares(FG, FA, offerId, 100, now);
    check('Anleger kauft 100 Anteile', r.ok && r.shares === 100 && r.fee === 2_500, JSON.stringify(r));
    r = await company.withdraw(FG, FO, 50_000, now);
    check('Entnahme 50.000: 45.000 für den Inhaber, 5.000 an Anteilseigner', r.ok && r.paid === 45_000 && r.shared === 5_000, JSON.stringify(r));
    const mine = await ui.buildMeineAnteileView({ guildId: FG, userId: FA });
    const mineDesc = mine.embeds[0].data.description;
    check('Meine Anteile: Firma-Nr, 100 Anteile (10 %), bezahlt 250.000, ausstehend 5.000, erhalten 0',
      mineDesc.includes(`Firma-Nr ${cid}`) && mineDesc.includes('**100** Anteile (10 %)') && mineDesc.includes('bezahlt') && mineDesc.includes('250.000')
      && mineDesc.includes('ausstehend **') && mineDesc.includes('5.000') && mineDesc.includes('erhalten'), mineDesc);
    const mineBtn = mine.components[0].components;
    check('Meine Anteile: Knöpfe Abholen · Verkaufen · Zurückziehen · Firmenanteile · Home',
      mineBtn.map((b) => b.data.custom_id).join(' ') === `wanteilabholen|${FA} wanteilverkauf|${FA} wanteilweg|0|${FA} wanteile|1|${FA} home|${FA}`,
      mineBtn.map((b) => b.data.custom_id).join(' '));
    check('Meine Anteile: Abholen aktiv (pending 5.000) und nennt den Betrag', mineBtn[0].data.disabled !== true && mineBtn[0].data.label.includes('5.000'), mineBtn[0].data.label);
    check('Meine Anteile: Verkaufen aktiv, Zurückziehen gesperrt (kein Angebot)', mineBtn[1].data.disabled !== true && mineBtn[2].data.disabled === true);
    check('Meine Anteile hält das Fluxer-Limit (kein Überlauf)', render.mapReactions(mine).overflow === undefined, String(render.mapReactions(mine).overflow));
    for (const zeile of mineDesc.split('\n')) console.log('    ' + zeile);

    // Betriebsansicht: Fußzeile nennt die Halter.
    const betrieb = await ui.buildFirmaView({ guildId: FG, userId: FO });
    check('Betriebsansicht: Fußzeile „· 100 Anteile bei 1 Spieler"', betrieb.embeds[0].data.footer.text.includes('· 100 Anteile bei 1 Spieler'), betrieb.embeds[0].data.footer.text);
    check('Betriebsansicht hält das Fluxer-Limit', render.mapReactions(betrieb).overflow === undefined);
    // Anteile-Ansicht des Inhabers nach dem Kauf: Verteilung und Halterliste.
    const v3 = await ui.buildFirmaAnteileView({ guildId: FG, userId: FO });
    const v3Fields = Object.fromEntries(v3.embeds[0].data.fields.map((f) => [f.name, f.value]));
    check('Anteile: Verteilung „Du 900 · 1 Anteilseigner 100"', v3Fields['🥧 Verteilung'] === 'Du **900** · 1 Anteilseigner **100**', v3Fields['🥧 Verteilung']);
    check('Anteile: letzte Ausschüttung 50 je Anteil', v3Fields['💰 Letzte Ausschüttung']?.includes('50 je Anteil'), v3Fields['💰 Letzte Ausschüttung']);
    check('Anteile: Halterliste mit 100 Anteilen (10 %) und 5.000 ausstehend',
      v3Fields['👥 Anteilseigner (1)']?.includes('**100** Anteile (10 %)') && v3Fields['👥 Anteilseigner (1)'].includes('5.000 ausstehend'), v3Fields['👥 Anteilseigner (1)']);

    // Anleger bietet weiter → Zurückziehen in „Meine Anteile" aktiv, mit der ID.
    r = company.listShares(FG, FA, cid, 30, 3_000, now);
    check('Anleger bietet 30 weiter', r.ok, JSON.stringify(r));
    const mine2 = await ui.buildMeineAnteileView({ guildId: FG, userId: FA });
    check('Meine Anteile: Zurückziehen aktiv mit Angebots-ID', mine2.components[0].components[2].data.custom_id === `wanteilweg|${r.offer.id}|${FA}`
      && mine2.components[0].components[2].data.disabled !== true, mine2.components[0].components[2].data.custom_id);
    check('Meine Anteile: Feld „Deine Angebote"', mine2.embeds[0].data.fields.some((f) => f.name.startsWith('🏷️ Deine Angebote')));

    await company.close(FG, FO, now);
  }

  console.log('--- Mehrere Firmen: Übersicht, Betrieb, Gründung am Limit (Spec 4: Ansichten) ---');
  {
    const ui = require('../src/ui');
    const company = require('../src/company');
    const level = require('../src/level');
    const FG = `FR4_T${Date.now()}`;
    const FU = 'fr_multi';
    const now = Date.now();
    // Level 15 erlaubt zwei Firmen (eine je 10 Level, Deckel 5).
    const setLevel = (lvl) => db.addStats(FG, FU, { xp: level.xpForLevel(lvl) - db.getStats(FG, FU).xp });
    setLevel(15);
    const a = (await company.found(FG, FU, 'kiosk', 'Eckladen', now)).company.id;

    // Eine Firma: der Menüeintrag zeigt den Betrieb, nicht die Übersicht.
    const eine = await buildEntryView('firma', { guildId: FG, userId: FU, page: 1 });
    check('eine Firma: Menü zeigt den Betrieb', eine.embeds[0].data.title.includes('Eckladen'), eine.embeds[0].data.title);
    const eineIds = eine.components.flatMap((row) => row.components.map((b) => b.data.custom_id));
    check('eine Firma (noch eine frei): Zeile 2 hat „Firmen" UND Home',
      eineIds[eineIds.length - 2] === `firma|firmen|0|${FU}` && eineIds[eineIds.length - 1] === `home|${FU}`,
      eineIds.join(' '));
    check('eine Firma: keine Fußzeile „Firma x von y"',
      !(eine.embeds[0].data.footer?.text ?? '').includes('Firma 1 von'), eine.embeds[0].data.footer?.text);

    const b = (await company.found(FG, FU, 'imbiss', 'Bude', now + 3600e3)).company.id;

    // Übersicht: Titel, je Firma ein Feld und ein Knopf, Gründen am Limit gesperrt.
    const ueber = await buildEntryView('firma', { guildId: FG, userId: FU, page: 1 });
    check('zwei Firmen: Menü zeigt die Übersicht', ueber.embeds[0].data.title === '🏢 Deine Firmen (2 von 2)', ueber.embeds[0].data.title);
    const uFelder = ueber.embeds[0].data.fields;
    check('Übersicht: je Firma ein Feld', uFelder.length === 2, uFelder.map((f) => f.name).join(', '));
    check('Übersicht: Feld nennt Branche, Stufe, Kasse und Prognose',
      uFelder[0].value.includes('Kiosk, Stufe 0') && uFelder[0].value.includes('Kasse') && uFelder[0].value.includes('Prognose'),
      uFelder[0].value);
    check('Übersicht: die aktive Firma ist markiert', uFelder[1].name.endsWith('· aktiv') && !uFelder[0].name.endsWith('· aktiv'),
      `${uFelder[0].name} / ${uFelder[1].name}`);
    const uIds = ueber.components.map((row) => row.components.map((btn) => btn.data.custom_id));
    check('Übersicht: Knopf je Firma (älteste zuerst), dann Gründen und Home',
      uIds[0].join(' ') === `firma|oeffnen|${a}|${FU} firma|oeffnen|${b}|${FU}`
      && uIds[1].join(' ') === `firma|gruenden|0|${FU} home|${FU}`, JSON.stringify(uIds));
    check('Übersicht: Gründen ist am Limit gesperrt',
      ueber.components[1].components[0].data.disabled === true);
    for (const row of ueber.components) check('Übersicht: höchstens fünf Knöpfe je Zeile', row.components.length <= 5, String(row.components.length));
    check('Übersicht hält das Fluxer-Limit (kein Überlauf)', render.mapReactions(ueber).overflow === undefined,
      String(render.mapReactions(ueber).overflow));
    console.log('    ' + ueber.embeds[0].data.title);
    for (const f of uFelder) console.log(`    [${f.name}] ${f.value.replace(/\n/g, ' | ')}`);

    // Betriebsansicht: Fußzeile zählt mit, die Knöpfe tragen die Firmen-ID, „Firmen" statt Home.
    const vA = await ui.buildFirmaView({ guildId: FG, userId: FU, companyId: a });
    check('Betrieb A: richtige Firma', vA.embeds[0].data.title.includes('Eckladen'), vA.embeds[0].data.title);
    check('Betrieb A: Fußzeile „· Firma 1 von 2"', vA.embeds[0].data.footer.text.includes('· Firma 1 von 2'), vA.embeds[0].data.footer.text);
    const aIds = vA.components.map((row) => row.components.map((btn) => btn.data.custom_id));
    check('Betrieb A: Zeile 1 trägt die Firmen-ID',
      aIds[0].join(' ') === `firma|werbung|${a}|${FU} firma|anpacken|${a}|${FU} firma|entnehmen|${a}|${FU} firma|einzahlen|${a}|${FU}`,
      aIds[0].join(' '));
    check('Betrieb A: Zeile 2 Personal · Ausbau · Lager · Firmen · Home',
      aIds[1].join(' ') === `firma|personal|0|${FU} firma|ausbau|${a}|${FU} firma|lager|${a}|${FU} firma|firmen|0|${FU} home|${FU}`,
      aIds[1].join(' '));
    for (const row of vA.components) check('Betrieb A: höchstens fünf Knöpfe je Zeile', row.components.length <= 5, String(row.components.length));
    check('Betrieb A hält das Fluxer-Limit (kein Überlauf)', render.mapReactions(vA).overflow === undefined,
      String(render.mapReactions(vA).overflow));

    const vB = await ui.buildFirmaView({ guildId: FG, userId: FU, companyId: b });
    check('Betrieb B: richtige Firma und Fußzeile „· Firma 2 von 2"',
      vB.embeds[0].data.title.includes('Bude') && vB.embeds[0].data.footer.text.includes('· Firma 2 von 2'),
      `${vB.embeds[0].data.title} / ${vB.embeds[0].data.footer.text}`);

    // Gründungsansicht am Limit: Hinweis auf das Level, Branchenknöpfe gesperrt.
    const g = await ui.buildFirmaFoundView({ guildId: FG, userId: FU });
    check('Gründung am Limit: Beschreibung nennt den Ist-Stand „Du führst 2 von 2 Firmen (Level 15)"',
      g.embeds[0].data.description.includes('**Du führst 2 von 2** Firmen (Level 15)')
      && !g.embeds[0].data.description.includes('**Firma 2 von 2**'), g.embeds[0].data.description);
    const gLimit = g.embeds[0].data.fields.find((f) => f.name === '🏢 Limit erreicht');
    check('Gründung am Limit: Hinweis „ab Level 20"',
      gLimit?.value.includes('**2 von 2**') && gLimit.value.includes('**Level 20**'), gLimit?.value);
    check('Gründung am Limit: Branchenknöpfe gesperrt',
      g.components[1].components.every((btn) => btn.data.disabled === true));
    check('Gründung: Rückweg zur Übersicht',
      g.components[0].components.some((btn) => btn.data.custom_id === `firma|firmen|0|${FU}`),
      g.components[0].components.map((btn) => btn.data.custom_id).join(' '));
    check('Gründungsansicht hält das Fluxer-Limit (kein Überlauf)', render.mapReactions(g).overflow === undefined,
      String(render.mapReactions(g).overflow));

    // Ein Level mehr: die dritte darf gegründet werden.
    setLevel(20);
    const g2 = await ui.buildFirmaFoundView({ guildId: FG, userId: FU });
    check('Level 20: „Firma 3 von 3 (Level 20)", Branchen wieder frei',
      g2.embeds[0].data.description.includes('**Firma 3 von 3** (Level 20)')
      && g2.components[1].components.every((btn) => btn.data.disabled !== true), g2.embeds[0].data.description);
    const ueber2 = await ui.buildFirmenView({ guildId: FG, userId: FU });
    check('Level 20: Übersicht „2 von 3", Gründen frei',
      ueber2.embeds[0].data.title === '🏢 Deine Firmen (2 von 3)'
      && ueber2.components[1].components[0].data.disabled !== true, ueber2.embeds[0].data.title);

    await company.close(FG, FU, now, a);
    await company.close(FG, FU, now, b);
  }

  console.log('--- Mehrere Firmen: Vorfall, Schließen-Bestätigung und veraltete Knöpfe (Review) ---');
  {
    const ui = require('../src/ui');
    const company = require('../src/company');
    const level = require('../src/level');
    const buttons = require('../src/buttons').buttons;
    const FG = `FR4_R${Date.now()}`;
    const FU = 'fr_review';
    const now = Date.now();
    db.addStats(FG, FU, { xp: level.xpForLevel(20) - db.getStats(FG, FU).xp });
    const a = (await company.found(FG, FU, 'kiosk', 'Eckladen', now)).company.id;
    const b = (await company.found(FG, FU, 'imbiss', 'Bude', now + 3600e3)).company.id;

    /** Ein Klick auf einen Knopf: sammelt Ansicht, Hinweise und Modale. */
    const klick = async (aktion, arg) => {
      const rec = { views: [], notes: [], modals: [] };
      await buttons.firma({
        guildId: FG,
        user: { id: FU },
        deferUpdate: async () => {},
        editReply: async (v) => { rec.views.push(v); return v; },
        reply: async (v) => { rec.notes.push(v.content ?? v); return v; },
        followUp: async (v) => { rec.notes.push(v.content ?? v); return v; },
        showModal: async (m) => { rec.modals.push(m); },
      }, [aktion, arg]);
      return rec;
    };
    const idsOf = (v) => v.components.flatMap((row) => row.components.map((btn) => btn.data.custom_id));

    // (i) Der Vorfall hängt an A – in der Ansicht von B hat er nichts zu suchen.
    db.clearEvents(FG, FU);
    db.insertEvent({ guildId: FG, userId: FU, kind: 'wasserschaden', platform: 'company',
      refId: a, createdAt: now, expiresAt: now + 24 * 3600e3 });
    const vorfallA = await ui.buildFirmaView({ guildId: FG, userId: FU, companyId: a });
    check('Vorfall: A zeigt das Feld', vorfallA.embeds[0].data.fields.some((f) => f.name === '⚠️ Vorfall'),
      vorfallA.embeds[0].data.fields.map((f) => f.name).join(', '));
    check('Vorfall: A hat den Knopf', idsOf(vorfallA).includes(`vorfall|company|${FU}`), idsOf(vorfallA).join(' '));
    const vorfallB = await ui.buildFirmaView({ guildId: FG, userId: FU, companyId: b });
    check('Vorfall: B zeigt KEIN Vorfall-Feld', !vorfallB.embeds[0].data.fields.some((f) => f.name === '⚠️ Vorfall'),
      vorfallB.embeds[0].data.fields.map((f) => f.name).join(', '));
    check('Vorfall: B hat KEINEN Vorfall-Knopf', !idsOf(vorfallB).some((id) => id.startsWith('vorfall|')), idsOf(vorfallB).join(' '));
    check('Vorfall: B behält den Rückweg (Firmen und Home)',
      idsOf(vorfallB).includes(`firma|firmen|0|${FU}`) && idsOf(vorfallB).includes(`home|${FU}`), idsOf(vorfallB).join(' '));
    for (const row of vorfallA.components) check('Vorfall: A hat höchstens fünf Knöpfe je Zeile', row.components.length <= 5, String(row.components.length));
    check('Vorfall: A hält das Fluxer-Limit', render.mapReactions(vorfallA).overflow === undefined,
      String(render.mapReactions(vorfallA).overflow));
    check('Vorfall: B hält das Fluxer-Limit', render.mapReactions(vorfallB).overflow === undefined,
      String(render.mapReactions(vorfallB).overflow));
    db.clearEvents(FG, FU);

    // (i-b) „NPC einstellen" trägt Seite UND Firma (`<seite>-<id>`): Die
    // Personalseite von A darf nicht in B einstellen, nur weil zwischendurch B
    // aktiv geworden ist. Vorher rief der Knopf `hireNpc` ohne ID – der NPC
    // landete still in der aktiven Firma.
    company.setActive(FG, FU, a);
    const personalA = await ui.buildFirmaStaffView({ guildId: FG, userId: FU });
    check('Personal: der NPC-Knopf trägt Seite und Firma',
      idsOf(personalA).includes(`firma|npc|1-${a}|${FU}`), idsOf(personalA).join(' '));
    check('Personal: A hält das Fluxer-Limit', render.mapReactions(personalA).overflow === undefined,
      String(render.mapReactions(personalA).overflow));
    company.setActive(FG, FU, b);                      // der Spieler wechselt zwischendurch
    const npcKlick = await klick('npc', `1-${a}`);
    check('NPC: eingestellt wird in der Firma der Personalseite (A), nicht in der aktiven (B)',
      db.companyStaff(a).length === 1 && db.companyStaff(b).length === 0,
      `A ${db.companyStaff(a).length} / B ${db.companyStaff(b).length}`);
    check('NPC: die Ansicht danach zeigt dieselbe Firma (A)',
      (npcKlick.views[0]?.embeds[0].data.title ?? '').includes('Eckladen'),
      npcKlick.views[0]?.embeds[0].data.title);
    check('NPC: A ist danach auch die aktive Firma', company.activeCompanyId(FG, FU) === a,
      String(company.activeCompanyId(FG, FU)));

    // (ii) Die Schließen-Bestätigung trägt die Firmen-ID – und trifft sie auch
    // dann, wenn zwischendurch eine andere Firma aktiv geworden ist.
    const dialog = await klick('schliessen', String(a));
    const ja = dialog.views[0].components[0].components[0].data;
    check('Schließen: Bestätigung trägt die Firmen-ID', ja.custom_id === `firma|schliessen|ja-${a}|${FU}`, ja.custom_id);
    check('Schließen: Dialog nennt die Firma', dialog.views[0].embeds[0].data.title.includes('Eckladen'),
      dialog.views[0].embeds[0].data.title);
    company.setActive(FG, FU, b);                      // der Spieler wechselt zwischendurch
    await klick('schliessen', `ja-${a}`);
    check('Schließen: genau die bestätigte Firma ist zu',
      db.getCompany(a).status === 'closed' && db.getCompany(b).status === 'open',
      `${db.getCompany(a).status} / ${db.getCompany(b).status}`);

    // (iii) Veralteter Knopf: die ID löst nicht mehr auf – nichts passiert.
    await company.deposit(FG, FU, 100_000, now + 2 * 3600e3, b);
    const kasseB = db.getCompany(b).kasse;
    const alt = await klick('werbung', String(a));
    check('Veralteter Knopf: Hinweis „gibt es nicht mehr"',
      alt.notes.some((n) => String(n).includes('Diese Firma gibt es nicht mehr')), JSON.stringify(alt.notes));
    check('Veralteter Knopf: die aktive Firma bleibt unberührt', db.getCompany(b).kasse === kasseB,
      `${db.getCompany(b).kasse} statt ${kasseB}`);
    check('Veralteter Knopf: die Übersicht kommt zurück',
      (alt.views[0]?.embeds[0].data.title ?? '').startsWith('🏢 Deine Firmen'), alt.views[0]?.embeds[0].data.title);
    const altModal = await klick('entnehmen', String(a));
    check('Veralteter Knopf: auch ein Modal-Knopf wird abgewiesen',
      altModal.modals.length === 0 && altModal.notes.some((n) => String(n).includes('gibt es nicht mehr')),
      JSON.stringify(altModal.notes));
    const altOeffnen = await klick('oeffnen', String(a));
    check('Veralteter Knopf: „Öffnen" zeigt nicht die aktive Firma',
      !(altOeffnen.views[0]?.embeds[0].data.title ?? '').includes('Bude')
      && altOeffnen.notes.some((n) => String(n).includes('gibt es nicht mehr')),
      `${altOeffnen.views[0]?.embeds[0].data.title} / ${JSON.stringify(altOeffnen.notes)}`);

    // (iv) Auch der NPC-Knopf einer inzwischen geschlossenen Firma wird
    // abgewiesen statt umgeleitet – A ist seit (ii) zu.
    const npcAlt = await klick('npc', `1-${a}`);
    check('NPC: veralteter Knopf wird abgewiesen',
      npcAlt.notes.some((n) => String(n).includes('Diese Firma gibt es nicht mehr')), JSON.stringify(npcAlt.notes));
    check('NPC: die aktive Firma bekommt kein Personal untergeschoben',
      db.companyStaff(b).length === 0, String(db.companyStaff(b).length));

    await company.close(FG, FU, now + 3 * 3600e3, b);
  }

  console.log('--- Stück 4b: die Modale tragen die Firmen-ID ---');
  {
    const company = require('../src/company');
    const level = require('../src/level');
    const { buttons, modals, parseId } = require('../src/buttons');
    const now = Date.now();

    /** Ein Klick auf einen Knopf – sammelt Ansicht, Hinweise und Modale. */
    const klick = async (guildId, userId, aktion, arg) => {
      const rec = { views: [], notes: [], modals: [] };
      await buttons.firma({
        guildId,
        user: { id: userId },
        deferUpdate: async () => {},
        editReply: async (v) => { rec.views.push(v); return v; },
        reply: async (v) => { rec.notes.push(v.content ?? v); return v; },
        followUp: async (v) => { rec.notes.push(v.content ?? v); return v; },
        showModal: async (m) => { rec.modals.push(m); },
      }, [aktion, arg]);
      return rec;
    };
    const modalId = (m) => m.data?.custom_id ?? m.toJSON().custom_id;
    /**
     * Ein abgesendetes Modal – zerlegt wie der Fluxer-Shim
     * (`src/fluxer/index.js`: `parseId(modalId)` → `modals[action](inter, parts)`),
     * damit die Argumentreihenfolge `[modus, cid]` hier mitgeprüft wird.
     */
    const absenden = async (guildId, userId, id, wert) => {
      const { action, parts } = parseId(id);
      const rec = { views: [], notes: [], parts };
      await modals[action]({
        guildId,
        user: { id: userId },
        deferUpdate: async () => {},
        editReply: async (v) => { rec.views.push(v); return v; },
        reply: async (v) => { rec.notes.push(v.content ?? v); return v; },
        followUp: async (v) => { rec.notes.push(v.content ?? v); return v; },
        fields: { getTextInputValue: () => wert },
      }, parts);
      return rec;
    };
    const titel = (rec) => rec.views[0]?.embeds[0].data.title ?? '';

    // Zwei Firmen desselben Inhabers: A ist der Knopf, B wird zwischendurch aktiv.
    const FG = `FR4B_T${Date.now()}`;
    const FU = 'fr4b_inhaber';
    db.addStats(FG, FU, { xp: level.xpForLevel(15) - db.getStats(FG, FU).xp });
    const a = (await company.found(FG, FU, 'kiosk', 'Eckladen', now)).company.id;
    const b = (await company.found(FG, FU, 'imbiss', 'Bude', now + 3600e3)).company.id;
    await company.deposit(FG, FU, 200_000, now, a);
    await company.deposit(FG, FU, 200_000, now, b);
    // Beide Lager leer: ein falsch gelandeter Kauf wäre in B sichtbar.
    db.saveCompany({ ...db.getCompany(a), stock: 0, stock_cost: 0 });
    db.saveCompany({ ...db.getCompany(b), stock: 0, stock_cost: 0 });

    // (1) Einzahlen: Knopf in A, zwischendurch wird B aktiv, Modal trifft A.
    const einzahlen = await klick(FG, FU, 'einzahlen', String(a));
    check('Einzahlen: das Modal trägt die Firmen-ID', modalId(einzahlen.modals[0]) === `fbetrag|einzahlen|${a}|${FU}`,
      modalId(einzahlen.modals[0]));
    company.setActive(FG, FU, b);                      // andere Nachricht, andere Firma
    const kasseA = db.getCompany(a).kasse, kasseB = db.getCompany(b).kasse;
    const eingezahlt = await absenden(FG, FU, modalId(einzahlen.modals[0]), '5000');
    check('Fluxer-Reihenfolge: parts sind [modus, cid, uid]',
      eingezahlt.parts[0] === 'einzahlen' && Number(eingezahlt.parts[1]) === a && eingezahlt.parts[2] === FU,
      eingezahlt.parts.join(' '));
    check('Einzahlen: das Geld landet in A, B bleibt unberührt',
      db.getCompany(a).kasse === kasseA + 5000 && db.getCompany(b).kasse === kasseB,
      `A ${db.getCompany(a).kasse - kasseA} / B ${db.getCompany(b).kasse - kasseB}`);
    check('Einzahlen: die Ansicht danach zeigt A', titel(eingezahlt).includes('Eckladen'), titel(eingezahlt));

    // (2) Entnehmen mit „alles": der Betrag muss aus derselben Kasse kommen.
    const entnehmen = await klick(FG, FU, 'entnehmen', String(a));
    company.setActive(FG, FU, b);
    const kasseA2 = db.getCompany(a).kasse, kasseB2 = db.getCompany(b).kasse;
    const entnommen = await absenden(FG, FU, modalId(entnehmen.modals[0]), 'alles');
    check('Entnehmen „alles": leert A, B bleibt unberührt',
      db.getCompany(a).kasse === 0 && kasseA2 > 0 && db.getCompany(b).kasse === kasseB2,
      `A ${kasseA2} → ${db.getCompany(a).kasse} / B ${db.getCompany(b).kasse} statt ${kasseB2}`);
    check('Entnehmen: die Ansicht danach zeigt A', titel(entnommen).includes('Eckladen'), titel(entnommen));
    await company.deposit(FG, FU, 200_000, now, a);

    // (3) Wareneinkauf: der Knopf der Lager-Ansicht von A.
    const einkaufen = await klick(FG, FU, 'einkaufen', String(a));
    check('Einkaufen: das Modal trägt die Firmen-ID', modalId(einkaufen.modals[0]) === `fware|kaufen|${a}|${FU}`,
      modalId(einkaufen.modals[0]));
    company.setActive(FG, FU, b);
    const lagerA = db.getCompany(a).stock, lagerB = db.getCompany(b).stock;
    const gekauft = await absenden(FG, FU, modalId(einkaufen.modals[0]), '10');
    check('Einkaufen: die Ware landet in A, B bleibt leer',
      db.getCompany(a).stock === lagerA + 10 && db.getCompany(b).stock === lagerB,
      `A ${db.getCompany(a).stock - lagerA} / B ${db.getCompany(b).stock - lagerB}`);
    check('Einkaufen: die Lager-Ansicht danach zeigt A', titel(gekauft).includes('Eckladen'), titel(gekauft));

    // (4) Kauf beim Spediteur: ein Großhändler beliefert beide Branchen.
    const FT = 'fr4b_spedi';
    const tid = (await company.found(FG, FT, 'spedition', 'Blitz-Spedition', now)).company.id;
    await company.deposit(FG, FT, 500_000, now, tid);
    company.setOffer(FG, FT, 'alle', 95, now, tid);
    company.setActive(FG, FU, a);
    const handelkauf = await klick(FG, FU, 'handelkauf', String(a));
    check('Spediteur-Kauf: das Modal trägt die Firmen-ID', modalId(handelkauf.modals[0]) === `fware|handel|${a}|${FU}`,
      modalId(handelkauf.modals[0]));
    company.setActive(FG, FU, b);
    const lagerA2 = db.getCompany(a).stock, lagerB2 = db.getCompany(b).stock;
    const geliefert = await absenden(FG, FU, modalId(handelkauf.modals[0]), '10');
    check('Spediteur-Kauf: die Ware landet in A, B bleibt unberührt',
      db.getCompany(a).stock === lagerA2 + 10 && db.getCompany(b).stock === lagerB2,
      `A ${db.getCompany(a).stock - lagerA2} / B ${db.getCompany(b).stock - lagerB2} (${JSON.stringify(geliefert.notes)})`);
    check('Spediteur-Kauf: die Lager-Ansicht danach zeigt A', titel(geliefert).includes('Eckladen'), titel(geliefert));

    // (5) Handelsangebot: zwei Speditionen desselben Inhabers.
    const FS = 'fr4b_haendler';
    db.addStats(FG, FS, { xp: level.xpForLevel(15) - db.getStats(FG, FS).xp });
    const s1 = (await company.found(FG, FS, 'spedition', 'Erste Fuhre', now)).company.id;
    const s2 = (await company.found(FG, FS, 'spedition', 'Zweite Fuhre', now + 3600e3)).company.id;
    const handelsetzen = await klick(FG, FS, 'handelsetzen', String(s1));
    check('Angebot setzen: das Modal trägt die Firmen-ID', modalId(handelsetzen.modals[0]) === `fhandel|setzen|${s1}|${FS}`,
      modalId(handelsetzen.modals[0]));
    company.setActive(FG, FS, s2);
    const gesetzt = await absenden(FG, FS, modalId(handelsetzen.modals[0]), 'kiosk 97');
    const offerS1 = db.offersOfCompany(s1).find((o) => o.branch === 'kiosk');
    const offerS2 = db.offersOfCompany(s2).find((o) => o.branch === 'kiosk');
    check('Angebot setzen: das Angebot steht bei S1, nicht bei S2',
      offerS1?.share === 97 && offerS1.active === 1 && !(offerS2?.active === 1 && offerS2.share === 97),
      `${JSON.stringify(offerS1)} / ${JSON.stringify(offerS2)}`);
    check('Angebot setzen: die Handel-Ansicht danach zeigt S1', titel(gesetzt).includes('Erste Fuhre'), titel(gesetzt));

    // (6) Anteile anbieten: zwei ausgebaute Firmen desselben Inhabers.
    const FO = 'fr4b_ag';
    db.addStats(FG, FO, { xp: level.xpForLevel(15) - db.getStats(FG, FO).xp });
    const o1 = (await company.found(FG, FO, 'baufirma', 'Bau AG', now)).company.id;
    const o2 = (await company.found(FG, FO, 'baufirma', 'Beton AG', now + 3600e3)).company.id;
    db.setCompanyStufe(o1, 2);
    db.setCompanyStufe(o2, 2);
    const anbieten = await klick(FG, FO, 'anteilanbieten', String(o1));
    check('Anteile anbieten: das Modal trägt die Firmen-ID', modalId(anbieten.modals[0]) === `fanteil|anbieten|${o1}|${FO}`,
      modalId(anbieten.modals[0]));
    company.setActive(FG, FO, o2);
    const angeboten = await absenden(FG, FO, modalId(anbieten.modals[0]), '100 2500');
    check('Anteile anbieten: das Angebot gehört O1, O2 hat keines',
      company.shareOffers(FG, o1).length === 1 && company.shareOffers(FG, o2).length === 0,
      `O1 ${company.shareOffers(FG, o1).length} / O2 ${company.shareOffers(FG, o2).length} (${JSON.stringify(angeboten.notes)})`);
    check('Anteile anbieten: die Anteile-Ansicht danach zeigt O1', titel(angeboten).includes('Bau AG'), titel(angeboten));

    // (7) Veraltetes Modal: die genannte Firma ist zu – abweisen statt umleiten.
    const veraltet = `fbetrag|einzahlen|${a}|${FU}`;
    await company.close(FG, FU, now + 2 * 3600e3, a);
    company.setActive(FG, FU, b);
    const kasseB3 = db.getCompany(b).kasse;
    const abgewiesen = await absenden(FG, FU, veraltet, '5000');
    check('Veraltetes Modal: Hinweis „gibt es nicht mehr"',
      abgewiesen.notes.some((n) => String(n).includes('Diese Firma gibt es nicht mehr')), JSON.stringify(abgewiesen.notes));
    check('Veraltetes Modal: die aktive Firma bleibt unberührt', db.getCompany(b).kasse === kasseB3,
      `${db.getCompany(b).kasse} statt ${kasseB3}`);
    check('Veraltetes Modal: die Übersicht kommt zurück', titel(abgewiesen).startsWith('🏢 Deine Firmen'), titel(abgewiesen));

    // (8) Ohne ID (`0`) gilt weiter die aktive Firma – Altverhalten.
    company.setActive(FG, FU, b);
    const kasseB4 = db.getCompany(b).kasse;
    await absenden(FG, FU, `fbetrag|einzahlen|0|${FU}`, '1000');
    check('Modal ohne Firmen-ID (0): die aktive Firma bekommt das Geld',
      db.getCompany(b).kasse === kasseB4 + 1000, `${db.getCompany(b).kasse - kasseB4}`);

    await company.close(FG, FU, now + 3 * 3600e3, b);
    await company.close(FG, FT, now + 3 * 3600e3, tid);
    await company.close(FG, FS, now + 3 * 3600e3, s1);
    await company.close(FG, FS, now + 3 * 3600e3, s2);
    await company.close(FG, FO, now + 3 * 3600e3, o1);
    await company.close(FG, FO, now + 3 * 3600e3, o2);
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

  console.log('--- Kontakte (Spec 5a: Anzeige) ---');
  /*
   * Die Anzeige der Kontakte hat eine harte Grenze: Auf Fluxer wird jeder
   * aktive Knopf zu einer Reaktion, und mehr als neun gibt es nicht (§16).
   * Fünf Kontakte + Blättern + Hauptmenü sind acht – der Filter darf also
   * genau ein Knopf sein. Deshalb wird hier auf JEDER der drei Ansichten
   * geprüft, dass nichts abgeschnitten wird (`overflow === undefined`).
   */
  {
    const ui = require('../src/ui');
    const contacts = require('../src/contacts');
    const cdata = require('../src/data/contacts');
    const music = require('../src/music');
    const home = require('../src/home');
    const { kontaktNote } = require('../src/buttons');
    const KG = `KON_T${Date.now()}`;
    const KU = 'kon_user';
    const jetzt = Date.now();
    // Ein deutscher Rapper mit 10.000 Hörern – damit hat er eine Musikseite,
    // aber keine Creator-Seite, und die Liste ist voll.
    await home.setHome(KG, KU, 'de');
    home.setLanguage(KG, KU, 'deutsch');
    music.setup(KG, KU, 'hiphop', music.PERSONAS[0].id);
    db.saveArtist(KG, KU, { ...db.getArtist(KG, KU, jetzt), listeners: 10_000 });

    const liste = await ui.buildKontakteView({ guildId: KG, userId: KU, page: 1, filter: 'alle' });
    const lEmbed = liste.embeds[0].toJSON();
    check('Liste heißt „🤝 Kontakte"', lEmbed.title.startsWith('🤝 Kontakte'), lEmbed.title);
    check('Liste nennt die eigene Reichweite', lEmbed.description.includes('10.000') && lEmbed.description.includes('Hörer'),
      lEmbed.description.split('\n')[0]);
    // Die Chance der Liste ist die einer BESTIMMTEN Anfrageart – ohne den
    // Namen dahinter passt sie zu keiner der vier Zahlen einen Klick später.
    check('fünf Zeilen mit Draht, Stufe und benannter Chance',
      lEmbed.description.split('\n')
        .filter((z) => z.includes('Draht ') && z.includes('Chance (Shoutout) ')).length === 5,
      lEmbed.description);
    const lRows = liste.components.map((r) => r.toJSON().components);
    check('fünf Kontakt-Knöpfe, nummeriert',
      lRows[0].length === 5 && lRows[0].every((b, i) => b.label.startsWith(`${i + 1}. `)
        && b.custom_id.startsWith('kontakt|')), lRows[0].map((b) => b.label).join(' | '));
    check('Seiten, Filter und Hauptmenü in einer Zeile',
      lRows[1].map((b) => b.custom_id).join(' ') === `kontakte|alle|0|${KU} noop kontakte|alle|2|${KU} kontakte|inland|1|${KU} home|${KU}`,
      lRows[1].map((b) => b.custom_id).join(' '));
    check('auf Seite 1 ist „Zurück" gesperrt', lRows[1][0].disabled === true);
    check('Liste hält das Fluxer-Limit (kein Überlauf)',
      render.mapReactions(liste).overflow === undefined, String(render.mapReactions(liste).overflow));

    // Der Filterknopf schaltet reihum – vier Knöpfe nebeneinander sprengten
    // den Reaktionshaushalt, erreichbar bleiben trotzdem alle vier Filter.
    const inland = await ui.buildKontakteView({ guildId: KG, userId: KU, page: 1, filter: 'inland' });
    const iEmbed = inland.embeds[0].toJSON();
    check('Filter Inland zeigt nur deutsche Kontakte',
      iEmbed.description.split('\n').filter((z) => z.startsWith('**')).every((z) => z.includes('🇩🇪')),
      iEmbed.description);
    check('der Filterknopf schaltet weiter zu „Meine Sprache"',
      inland.components[1].toJSON().components.some((b) => b.custom_id === `kontakte|sprache|1|${KU}`));
    check('Filter-Ansicht hält das Fluxer-Limit',
      render.mapReactions(inland).overflow === undefined, String(render.mapReactions(inland).overflow));

    // Blättern: Seite 2 zeigt andere Kontakte, beide Pfeile sind offen.
    const seite2 = await ui.buildKontakteView({ guildId: KG, userId: KU, page: 2, filter: 'alle' });
    const knopf = (v, i) => v.components[0].toJSON().components[i].custom_id;
    check('Seite 2 zeigt andere Kontakte', knopf(seite2, 0) !== knopf(liste, 0),
      `${knopf(seite2, 0)} vs ${knopf(liste, 0)}`);
    const s2nav = seite2.components[1].toJSON().components;
    check('auf Seite 2 gehen beide Pfeile', s2nav[0].disabled !== true && s2nav[2].disabled !== true);
    check('Seite 2 hält das Fluxer-Limit (kein Überlauf)',
      render.mapReactions(seite2).overflow === undefined,
      `${render.mapReactions(seite2).length} / ${render.mapReactions(seite2).overflow}`);
    // Seite 99 gibt es nicht – sie darf nicht leer sein (alte Knopf-IDs, §6).
    const seite99 = await ui.buildKontakteView({ guildId: KG, userId: KU, page: 99, filter: 'alle' });
    check('Seite 99 landet auf der letzten Seite',
      seite99.components[0].toJSON().components.length > 0);

    // Kontaktansicht: die Konzert-Anfrage braucht Draht 20 und ist gesperrt.
    const klein = cdata.CONTACTS.find((c) => c.id === 'lilpfand');
    const kontakt = await ui.buildKontaktView({ guildId: KG, userId: KU, contactId: klein.id });
    const kEmbed = kontakt.embeds[0].toJSON();
    check('Kontaktansicht zeigt Blurb, Sprache, Genre und Reichweite',
      kEmbed.description.includes(klein.blurb) && kEmbed.description.includes('🇩🇪 deutsch · Hip-Hop')
      && kEmbed.description.includes('Reichweite'), kEmbed.description);
    check('Draht, Historie und Passung stehen da',
      kEmbed.description.includes('🤝 Draht ▱▱▱▱▱ 0 (neutral) · 0 Versuche, 0 Zusagen')
      && kEmbed.description.includes('🎯 Passung 100 %'), kEmbed.description);
    const kRow = kontakt.components[0].toJSON().components;
    // Seit 5b steht als fünfter Knopf das Anstacheln daneben (unten geprüft) –
    // die vier Anfragen tragen weiterhin ihre Chance im Namen.
    check('vier Anfrage-Knöpfe mit Prozent im Namen',
      kRow.length === 5 && kRow.slice(0, 4).every((b) => / \d+ %$/.test(b.label)),
      kRow.map((b) => b.label).join(' | '));
    check('das Konzert ist ohne Draht 20 gesperrt',
      kRow[3].custom_id === `kanfrage|${klein.id}-konzert|${KU}` && kRow[3].disabled === true,
      JSON.stringify(kRow[3]));
    check('Grund steht auch im Text', kEmbed.fields[0].value.includes('Draht 20 nötig'),
      kEmbed.fields[0].value);
    check('Zurück und Hauptmenü', kontakt.components[1].toJSON().components
      .map((b) => b.custom_id).join(' ') === `kontakte|alle|1|${KU} home|${KU}`);
    check('Kontaktansicht hält das Fluxer-Limit (kein Überlauf)',
      render.mapReactions(kontakt).overflow === undefined, String(render.mapReactions(kontakt).overflow));
    const alt = await ui.buildKontaktView({ guildId: KG, userId: KU, contactId: 'gibtsnichtmehr' });
    check('eine veraltete Knopf-ID öffnet nichts Falsches (§6)',
      alt.embeds[0].toJSON().description.includes('gibt es nicht'),
      alt.embeds[0].toJSON().description);

    // Antwortmeldung: Zusage (Würfel trifft, zweiter Wurf landet auf „zusage").
    const wuerfel = (...werte) => { let i = 0; return () => werte[Math.min(i++, werte.length - 1)]; };
    const zusage = contacts.request(KG, KU, klein.id, 'shoutout', jetzt, wuerfel(0.1, 0.9, 0));
    check('der Wurf ergibt eine Zusage', zusage.ok && zusage.antwort === 'zusage',
      JSON.stringify({ ok: zusage.ok, antwort: zusage.antwort }));
    const zNote = kontaktNote(zusage, jetzt);
    check('Meldung: Stufe, Text des Kontakts, Schub, Draht und Sperre',
      zNote.includes('Zusage!') && zNote.includes(zusage.text)
      && /🤝 Wirkt auf deine nächste Veröffentlichung: ×\d+,\d, noch 48 h/.test(zNote)
      && zNote.includes('🤝 Draht ▰▱▱▱▱ **12** (+12,')
      && zNote.includes('Wieder erreichbar in 3 Tagen'), zNote);

    // Schub-Zeile in der Musikansicht.
    const studio = await ui.buildMusicView({ guildId: KG, userId: KU });
    const heute = studio.embeds[0].toJSON().fields.find((f) => f.name === '⏳ Heute').value;
    check('die Musikansicht zeigt den laufenden Schub',
      heute.includes(`🤝 Shoutout mit *${klein.name}* – wirkt auf die nächste Veröffentlichung, noch 48 h`),
      heute);

    /*
     * Der Disstrack (5b) ist die fünfte Veröffentlichungsart, steht aber
     * NICHT in der Musikansicht: Dort wäre das Ziel nicht eindeutig, und ein
     * fünfter Knopf sprengte den Reaktionshaushalt (§16). Er lebt in der
     * Kontaktansicht des Gegners.
     */
    const arten = await ui.buildReleaseView({ guildId: KG, userId: KU });
    const aKnoepfe = arten.components[0].toJSON().components;
    check('die Veröffentlichungsansicht zeigt vier Arten – ohne Disstrack',
      aKnoepfe.length === 4 && !aKnoepfe.some((b) => b.custom_id.startsWith('mpub|diss')),
      aKnoepfe.map((b) => b.custom_id).join(' '));
    check('und beschreibt genau diese vier',
      arten.embeds[0].toJSON().fields.length === 4
      && !arten.embeds[0].toJSON().fields.some((f) => f.name.includes('Disstrack')),
      arten.embeds[0].toJSON().fields.map((f) => f.name).join(' | '));
    check('Veröffentlichungsansicht hält das Fluxer-Limit (kein Überlauf)',
      render.mapReactions(arten).overflow === undefined, String(render.mapReactions(arten).overflow));

    // Antwortmeldung: ignoriert – kein Schub, aber sieben Tage Sperre.
    const star = cdata.CONTACTS.find((c) => c.reach >= 100_000_000);
    const nein = contacts.request(KG, KU, star.id, 'feature', jetzt, wuerfel(0.999));
    check('der Weltstar sagt nichts zu', nein.ok && nein.antwort === 'ignoriert',
      JSON.stringify({ ok: nein.ok, antwort: nein.antwort, reason: nein.reason }));
    const nNote = kontaktNote(nein, jetzt);
    check('Meldung ohne Schub, mit Sperre von sieben Tagen',
      !nNote.includes('Wirkt auf') && nNote.includes('Wieder erreichbar in 7 Tagen')
      && nNote.includes('(-1,'), nNote);

    // Fehlerfälle – Wortlaut aus der Spec.
    check('gesperrt: „Melde dich in … wieder."',
      kontaktNote(contacts.request(KG, KU, klein.id, 'shoutout', jetzt, wuerfel(0.1)), jetzt)
        === '⏳ Melde dich in 3 Tagen wieder.');
    check('zu wenig Draht nennt die nötige Zahl',
      kontaktNote(contacts.request(KG, KU, 'ninachuba', 'konzert', jetzt, wuerfel(0.1)), jetzt)
        === '🤝 Dafür kennt ihr euch noch nicht gut genug (Draht 20 nötig).');
    check('unbekannter Kontakt wird abgewiesen statt verwechselt',
      kontaktNote(contacts.request(KG, KU, 'gibtsnichtmehr', 'shoutout', jetzt, wuerfel(0.1)), jetzt)
        .includes('gibt es nicht'));

    // Ein Schub, der nicht stärker ist als der laufende, verpufft – die
    // Meldung darf dann weder Faktor noch Dauer nennen, nur den Fixsatz.
    db.setBoost(KG, KU, {
      kind: 'release', factor: 99, extra: 1, until: jetzt + 999 * 3600e3,
      contactId: 'ewiger-platzhalter', requestId: 'shoutout',
    }, jetzt);
    const rammstein = cdata.CONTACTS.find((c) => c.id === 'rammstein');
    const abgelehnt = contacts.request(KG, KU, rammstein.id, 'shoutout', jetzt, wuerfel(0.01, 0.5, 0));
    check('die Anfrage an Rammstein bekommt eine Antwort',
      abgelehnt.ok && abgelehnt.antwort !== 'ignoriert' && Boolean(abgelehnt.boost),
      JSON.stringify({ ok: abgelehnt.ok, antwort: abgelehnt.antwort, boost: abgelehnt.boost }));
    check('der neue Schub ist nicht stärker als der laufende – er verpufft',
      abgelehnt.boost && abgelehnt.boost.neu === false, JSON.stringify(abgelehnt.boost));
    const abgelehntNote = kontaktNote(abgelehnt, jetzt);
    check('Meldung nennt weder Faktor noch Dauer, nur den Fixsatz',
      abgelehntNote.includes('🤝 Ein mindestens gleich starker Schub läuft schon – dieser hier wirkt nicht.')
      && !abgelehntNote.includes('×') && !abgelehntNote.includes('Wirkt auf'), abgelehntNote);

    // no_time: der Tag ist randvoll, aber (durch Erholung seit dem letzten
    // Eintrag) nicht mehr erschöpft – der Satz baut sich aus `need`/`left`
    // zusammen, genau wie bei Studio, Release und Konzert.
    const creatorMod = require('../src/creator');
    const KG2 = `KON_T2_${Date.now()}`;
    const KU2 = 'kon_user_zeit';
    await home.setHome(KG2, KU2, 'de');
    home.setLanguage(KG2, KU2, 'deutsch');
    music.setup(KG2, KU2, 'hiphop', music.PERSONAS[0].id);
    db.saveArtist(KG2, KU2, { ...db.getArtist(KG2, KU2, jetzt), listeners: 10_000 });
    const tagStart = new Date(jetzt);
    tagStart.setHours(1, 0, 0, 0);
    const t0 = tagStart.getTime();
    const gebucht = creatorMod.useTime(KG2, KU2, 24, t0);
    check('der ganze Tag ist verplant', gebucht.ok && gebucht.left === 0, JSON.stringify(gebucht));
    const t1 = t0 + 3 * 3600e3;
    const blockiert = contacts.request(KG2, KU2, 'lilpfand', 'shoutout', t1, wuerfel(0.01));
    check('keine Wand mehr, aber die Stunden sind alle',
      blockiert.ok === false && blockiert.reason === 'no_time' && blockiert.left === 0,
      JSON.stringify(blockiert));
    const notime = kontaktNote(blockiert, t1);
    check('no_time-Satz baut sich aus need und left zusammen',
      notime === `😴 Eine Anfrage kostet **${blockiert.need}** Stunden, übrig sind **${blockiert.left}**.`,
      notime);

    // exhausted: unter der Wand liefert kontaktNote denselben Text wie
    // energy.blockText – ein zweiter Wortlaut wäre eine Quelle für Drift.
    const KG3 = `KON_T3_${Date.now()}`;
    const KU3 = 'kon_user_erschoepft';
    await home.setHome(KG3, KU3, 'de');
    home.setLanguage(KG3, KU3, 'deutsch');
    music.setup(KG3, KU3, 'hiphop', music.PERSONAS[0].id);
    db.saveArtist(KG3, KU3, { ...db.getArtist(KG3, KU3, jetzt), listeners: 10_000 });
    creatorMod.useTime(KG3, KU3, 22, jetzt);
    const erschoepft = contacts.request(KG3, KU3, 'lilpfand', 'shoutout', jetzt, wuerfel(0.01));
    check('nach 22 Stunden steht die Wand', erschoepft.ok === false && erschoepft.reason === 'exhausted',
      JSON.stringify(erschoepft));
    const erschoepftNote = kontaktNote(erschoepft, jetzt);
    check('erschoepft-Text kommt unverändert von energy.blockText',
      erschoepftNote === require('../src/energy').blockText(erschoepft, jetzt), erschoepftNote);

    // Schub-Zeile in der Creator-Ansicht: derselbe Mechanismus wie bei Musik –
    // `kind` läuft auf der Creator-Seite aber immer auf 'creator' zusammen.
    const KGc = `KON_C_${Date.now()}`;
    const KUc = 'kon_user_creator';
    await home.setHome(KGc, KUc, 'de');
    home.setLanguage(KGc, KUc, 'deutsch');
    db.saveCreator(KGc, KUc, 'twitch', {
      ...db.getCreator(KGc, KUc, 'twitch'), followers: 5_000, touched_at: jetzt, last_action_at: jetzt,
    });
    const papaplatte = cdata.CONTACTS.find((c) => c.id === 'papaplatte');
    const czusage = contacts.request(KGc, KUc, papaplatte.id, 'shoutout', jetzt, wuerfel(0.01, 0.9, 0));
    check('die Creator-Anfrage bekommt eine Antwort und einen Creator-Schub',
      czusage.ok && czusage.antwort !== 'ignoriert' && czusage.boost && czusage.boost.kind === 'creator',
      JSON.stringify({ antwort: czusage.antwort, boost: czusage.boost }));
    const creatorView = await ui.buildCreatorView({ guildId: KGc, userId: KUc });
    const cExtras = creatorView.embeds[0].toJSON().fields.find((f) => f.name === '​').value;
    check('die Creator-Ansicht zeigt den laufenden Schub',
      cExtras.includes(`🤝 Shoutout mit *${papaplatte.name}* – wirkt auf die nächste Aktion, noch 48 h`),
      cExtras);

    /*
     * Und wenn er gewirkt hat? Bis hierher stand der Schub nur in der Ansicht
     * SOLANGE er lag: Beim Verbrauch verschwand die Zeile, und das Ergebnis
     * schwieg. Geprüft wird darum die Meldung, die der Knopf wirklich schickt
     * (`buttons.mpub`, `buttons.mshow`) und der Text, den `creator.describe`
     * baut – für alle drei Stellen, die einen Schub verbrauchen.
     */
    const { buttons: knoepfe } = require('../src/buttons');
    /** Ein Klick auf einen Knopf; zurück kommt der private Hinweis danach. */
    const meldung = async (handler, guildId, userId, args = []) => {
      const notes = [];
      await handler({
        guildId,
        user: { id: userId },
        deferUpdate: async () => {},
        editReply: async (v) => v,
        reply: async (v) => { notes.push(v.content ?? v); return v; },
        followUp: async (v) => { notes.push(v.content ?? v); return v; },
      }, args);
      return notes.join('\n');
    };
    /**
     * Die Ereigniswürfel der Musik laufen in `buttons.mpub`/`mshow` über
     * `Math.random` – ohne festen Wert könnte ein abgesagtes Konzert
     * (Gewicht 3) den Test gelegentlich umkippen. 0,01 trifft in `candidates`
     * immer „none" (Gewicht 110 an erster Stelle).
     */
    const ohneEreignis = async (fn) => {
      const echt = Math.random;
      Math.random = () => 0.01;
      try { return await fn(); } finally { Math.random = echt; }
    };

    // (1) Veröffentlichung: der Faktor-Schub gehört in die Meldung.
    const KGr = `KON_R_${Date.now()}`;
    const KUr = 'kon_user_release';
    await home.setHome(KGr, KUr, 'de');
    home.setLanguage(KGr, KUr, 'deutsch');
    music.setup(KGr, KUr, 'hiphop', music.PERSONAS[0].id);
    db.saveArtist(KGr, KUr, {
      ...db.getArtist(KGr, KUr, Date.now()), listeners: 10_000, songs: 3,
    });
    db.setBoost(KGr, KUr, {
      kind: 'release', factor: 1.3, extra: 1, until: Date.now() + 48 * 3600e3,
      contactId: klein.id, requestId: 'shoutout',
    }, Date.now());
    const relNote = await ohneEreignis(() => meldung(knoepfe.mpub, KGr, KUr, ['single']));
    check('die Veröffentlichung meldet den verbrauchten Schub mit Namen und Faktor',
      relNote.includes(`🤝 Der Schub von **${klein.name}** hat gewirkt: ×1,3 Reichweite.`), relNote);
    // Ohne Schub steht die Zeile nicht da – sonst wäre sie nur Dekoration.
    db.saveArtist(KGr, KUr, {
      ...db.getArtist(KGr, KUr, Date.now()), songs: 3, last_release_at: 0,
    });
    const relOhne = await ohneEreignis(() => meldung(knoepfe.mpub, KGr, KUr, ['single']));
    check('ohne Schub bleibt die Zeile weg', !relOhne.includes('hat gewirkt'), relOhne);

    // (2) Konzert: dort zählen Hörer, keine Faktoren – und zwar die gedeckelten.
    const KGs = `KON_S_${Date.now()}`;
    const KUs = 'kon_user_show';
    await home.setHome(KGs, KUs, 'de');
    home.setLanguage(KGs, KUs, 'deutsch');
    music.setup(KGs, KUs, 'hiphop', music.PERSONAS[0].id);
    db.saveArtist(KGs, KUs, { ...db.getArtist(KGs, KUs, Date.now()), listeners: 50_000 });
    const nina = cdata.CONTACTS.find((c) => c.id === 'ninachuba');
    db.setBoost(KGs, KUs, {
      kind: 'show', factor: 1, extra: 2_000, until: Date.now() + 7 * 24 * 3600e3,
      contactId: nina.id, requestId: 'konzert',
    }, Date.now());
    const showNote = await ohneEreignis(() => meldung(knoepfe.mshow, KGs, KUs, []));
    check('das Konzert meldet die mitgebrachten Hörer',
      showNote.includes(`🤝 Der Schub von **${nina.name}** hat gewirkt: **+2.000** Hörer im Saal.`),
      showNote);

    // Ein abgesagtes Konzert verbraucht den Schub trotzdem (er wird vor dem
    // Ereigniswürfel gelesen) – dann muss die Meldung genau das sagen.
    // 0,99 trifft in `candidates('show', 1,3)` den letzten Kandidaten „abgesagt".
    db.saveArtist(KGs, KUs, {
      ...db.getArtist(KGs, KUs, Date.now()), listeners: 50_000, last_show_at: 0,
    });
    db.setBoost(KGs, KUs, {
      kind: 'show', factor: 1, extra: 2_000, until: Date.now() + 7 * 24 * 3600e3,
      contactId: nina.id, requestId: 'konzert',
    }, Date.now());
    const echterZufall = Math.random;
    Math.random = () => 0.99;
    let abgesagtNote;
    try { abgesagtNote = await meldung(knoepfe.mshow, KGs, KUs, []); } finally {
      Math.random = echterZufall;
    }
    check('das abgesagte Konzert verschweigt den verbrauchten Schub nicht',
      abgesagtNote.includes('Abgesagt')
      && abgesagtNote.includes(`🤝 Der Schub von **${nina.name}** ist damit verbraucht – angekommen ist davon nichts.`),
      abgesagtNote);

    // (3) Kanalaktion: derselbe Satz, gebaut von creator.describe.
    const KGa = `KON_A_${Date.now()}`;
    const KUa = 'kon_user_aktion';
    await home.setHome(KGa, KUa, 'de');
    home.setLanguage(KGa, KUa, 'deutsch');
    db.saveCreator(KGa, KUa, 'instagram', {
      ...db.getCreator(KGa, KUa, 'instagram'), followers: 5_000,
      touched_at: jetzt, last_action_at: 0,
    });
    db.setBoost(KGa, KUa, {
      kind: 'creator', factor: 1.2, extra: 1, until: Date.now() + 48 * 3600e3,
      contactId: papaplatte.id, requestId: 'shoutout',
    }, Date.now());
    const akt = await creatorMod.act(KGa, KUa, 'instagram', 'foto', Date.now(), () => 0.5);
    check('die Kanalaktion verbraucht den Schub',
      akt.ok && akt.kontakt && akt.kontakt.name === papaplatte.name,
      JSON.stringify({ ok: akt.ok, reason: akt.reason, kontakt: akt.kontakt }));
    const aktNote = creatorMod.describe(akt, (n) => `${n}`);
    check('die Kanalaktion meldet den verbrauchten Schub mit Namen und Faktor',
      aktNote.includes(`🤝 Der Schub von **${papaplatte.name}** hat gewirkt: ×1,2 Reichweite.`),
      aktNote);
  }

  console.log('--- Beef (Spec 5b: Anzeige) ---');
  /*
   * Die Anzeige des Beefs ist die einzige Stelle, an der ein Spieler ihn
   * überhaupt sieht – und sie hat dieselbe harte Grenze wie die Kontakte
   * (§16, neun Reaktionen). Ohne Beef trägt die Kontaktansicht 4 Anfragen +
   * Anstacheln + Zurück + Hauptmenü = 7 aktive Knöpfe; mit Beef sind die vier
   * Anfragen deaktiviert und bekommen keine Reaktion (`render.js`), dafür
   * kommen Disstrack und Frieden dazu = 4. Geprüft wird `overflow === undefined`
   * in BEIDEN Zuständen, sonst verschwände ein Knopf lautlos.
   */
  {
    const ui = require('../src/ui');
    const beef = require('../src/beef');
    const bdata = require('../src/data/beef');
    const contacts = require('../src/contacts');
    const cdata = require('../src/data/contacts');
    const music = require('../src/music');
    const home = require('../src/home');
    const {
      anstachelnNote, dissNote, friedenNote, beefNote, beefProblem,
      kontaktNote: kNote5b, releaseNote: rNote5b, buttons: knoepfe5b,
    } = require('../src/buttons');
    const jetzt = Date.now();
    const wuerfel = (...werte) => { let i = 0; return () => werte[Math.min(i++, werte.length - 1)]; };

    /** Ein frischer Rapper mit Titeln im Kasten – jeder Fall bekommt seinen. */
    let lauf = 0;
    const neu = async (listeners = 50_000) => {
      const g = `BEEF_T${Date.now()}_${lauf++}`;
      const u = 'beef_user';
      await home.setHome(g, u, 'de');
      home.setLanguage(g, u, 'deutsch');
      music.setup(g, u, 'hiphop', music.PERSONAS[0].id);
      db.saveArtist(g, u, { ...db.getArtist(g, u, jetzt), listeners, songs: 4 });
      return [g, u];
    };
    /** Eine Beef-Zeile von Hand – die Ansicht soll geprüft werden, nicht der Wurf. */
    const setzeBeef = (g, u, contactId, felder) => db.saveBeef(g, u, contactId, {
      hitze: 25, runden_ich: 0, runden_er: 0, last_hit: jetzt, last_cool: jetzt,
      konter_at: 0, angefangen: jetzt, status: 'offen', bonus_until: 0, ...felder,
    });

    const gross = cdata.CONTACTS.find((c) => c.id === 'rammstein');
    const klein = cdata.CONTACTS.find((c) => c.id === 'lilpfand');

    // --- Kontaktansicht OHNE Beef: der Anstachel-Knopf mit seiner Chance ----
    const [VG, VU] = await neu();
    const ohne = await ui.buildKontaktView({ guildId: VG, userId: VU, contactId: gross.id });
    const oRow = ohne.components[0].toJSON().components;
    check('ohne Beef steht als fünfter Knopf das Anstacheln mit Prozent',
      oRow.length === 5 && oRow[4].custom_id === `anstacheln|${gross.id}|${VU}`
      && / \d+ %$/.test(oRow[4].label) && oRow[4].disabled !== true,
      oRow.map((b) => `${b.custom_id}=${b.label}`).join(' | '));
    check('die Prozentzahl ist die Einstiegschance aus beef.einstiegOf',
      oRow[4].label === `Anstacheln ${Math.round(beef.einstiegOf({
        ...beef.musikLage(VG, VU, gross, jetzt), trait: gross.trait,
      }) * 100)} %`, oRow[4].label);
    check('ohne Beef gibt es keine Beef-Zeile und keinen Friedensknopf',
      !ohne.embeds[0].toJSON().description.includes('🔥 **Beef**')
      && ohne.components[1].toJSON().components[0].custom_id === `kontakte|alle|1|${VU}`,
      ohne.components[1].toJSON().components.map((b) => b.custom_id).join(' '));
    check('Kontaktansicht ohne Beef hält das Fluxer-Limit (kein Überlauf)',
      render.mapReactions(ohne).overflow === undefined,
      `${render.mapReactions(ohne).length} / ${render.mapReactions(ohne).overflow}`);

    // --- Kontaktansicht MIT Beef -------------------------------------------
    // Zwei Fronten: der heiße gegen den Großen (Konter steht aus), der kalte
    // gegen den Kleinen (kühlt ab, Frieden möglich).
    setzeBeef(VG, VU, gross.id, {
      hitze: 62, runden_ich: 2, runden_er: 1, konter_at: jetzt + 14 * 3600e3,
    });
    setzeBeef(VG, VU, klein.id, { hitze: 20, runden_ich: 1, runden_er: 0 });

    const mit = await ui.buildKontaktView({ guildId: VG, userId: VU, contactId: gross.id });
    const mEmbed = mit.embeds[0].toJSON();
    check('die Beef-Zeile nennt Hitze, Balken, Runden und den Konter',
      mEmbed.description.includes('🔥 **Beef** · Hitze 62 ▰▰▰▰▱ · Runden 2:1 · sein Konter kommt in 14 h'),
      mEmbed.description.split('\n').filter((z) => z.includes('Beef')).join(' / '));
    const mRow = mit.components[0].toJSON().components;
    check('die vier Kooperationsknöpfe sind deaktiviert',
      mRow.slice(0, 4).every((b) => b.disabled === true && b.custom_id.startsWith('kanfrage|')),
      mRow.map((b) => `${b.custom_id}:${b.disabled}`).join(' | '));
    check('und der Grund steht im Text',
      mEmbed.fields[0].value.split('\n').every((z) => z.endsWith('❌ Solange der Beef läuft, nicht.')),
      mEmbed.fields[0].value);
    check('fünfter Knopf ist der Disstrack, offen mit Titeln im Kasten',
      mRow.length === 5 && mRow[4].custom_id === `diss|${gross.id}|${VU}`
      && mRow[4].label === 'Disstrack' && mRow[4].disabled !== true,
      JSON.stringify(mRow[4]));
    check('bei Hitze 62 gibt es keinen Friedensknopf',
      !mit.components[1].toJSON().components.some((b) => b.custom_id.startsWith('frieden|')),
      mit.components[1].toJSON().components.map((b) => b.custom_id).join(' '));
    check('Kontaktansicht mit Beef hält das Fluxer-Limit (kein Überlauf)',
      render.mapReactions(mit).overflow === undefined,
      `${render.mapReactions(mit).length} / ${render.mapReactions(mit).overflow}`);

    // Der abgekühlte Beef: keine Konter-Uhr, dafür der Rest bis zum Ende – und
    // Frieden ist unter Hitze 30 möglich.
    const kalt = await ui.buildKontaktView({ guildId: VG, userId: VU, contactId: klein.id });
    check('ohne ausstehenden Konter zählt die Zeile die Abkühlung herunter',
      kalt.embeds[0].toJSON().description.includes('🔥 **Beef** · Hitze 20 ▰▱▱▱▱ · Runden 1:0 · kühlt ab, noch 3 Tage'),
      kalt.embeds[0].toJSON().description.split('\n').filter((z) => z.includes('Beef')).join(' / '));
    check('unter Hitze 30 steht der Friedensknopf vor Zurück und Hauptmenü',
      kalt.components[1].toJSON().components.map((b) => b.custom_id).join(' ')
        === `frieden|${klein.id}|${VU} kontakte|alle|1|${VU} home|${VU}`,
      kalt.components[1].toJSON().components.map((b) => b.custom_id).join(' '));
    check('Kontaktansicht mit Friedensknopf hält das Fluxer-Limit',
      render.mapReactions(kalt).overflow === undefined,
      `${render.mapReactions(kalt).length} / ${render.mapReactions(kalt).overflow}`);

    // --- Kontaktliste: 🔥 statt 🔒 ----------------------------------------
    const alleZ = contacts.listFor(VG, VU, { filter: 'alle', now: jetzt });
    const platz = alleZ.findIndex((z) => z.contact.id === gross.id);
    const liste5b = await ui.buildKontakteView({
      guildId: VG, userId: VU, page: Math.floor(platz / 5) + 1, filter: 'alle',
    });
    const beefZeileListe = liste5b.embeds[0].toJSON().description.split('\n')
      .find((z) => z.includes(gross.name));
    check('die Kontaktliste zeigt 🔥 statt des Sperr-Zusatzes 🔒',
      Boolean(beefZeileListe) && beefZeileListe.endsWith(' · 🔥 Beef')
      && !beefZeileListe.includes('🔒'), String(beefZeileListe));
    check('Kontaktliste mit Beef hält das Fluxer-Limit',
      render.mapReactions(liste5b).overflow === undefined,
      String(render.mapReactions(liste5b).overflow));

    // --- Musikansicht: nur eine Hinweiszeile, kein fünfter Knopf -----------
    const studio5b = await ui.buildMusicView({ guildId: VG, userId: VU });
    const heute5b = studio5b.embeds[0].toJSON().fields.find((f) => f.name === '⏳ Heute').value;
    check('die Musikansicht nennt den heißesten Beef',
      heute5b.includes(`🔥 Beef mit *${gross.name}* · Hitze 62 – ein Disstrack wartet`), heute5b);
    check('aber sie bekommt keinen Disstrack-Knopf (§16)',
      !studio5b.components.some((r) => r.toJSON().components
        .some((b) => String(b.custom_id).startsWith('diss|'))),
      studio5b.components.map((r) => r.toJSON().components.map((b) => b.custom_id).join(' ')).join(' | '));
    check('Musikansicht mit Beef hält das Fluxer-Limit (kein Überlauf)',
      render.mapReactions(studio5b).overflow === undefined,
      `${render.mapReactions(studio5b).length} / ${render.mapReactions(studio5b).overflow}`);
    const arten5b = await ui.buildReleaseView({ guildId: VG, userId: VU });
    check('die Veröffentlichungsansicht bleibt bei vier Arten ohne Disstrack',
      arten5b.components[0].toJSON().components.length === 4
      && !arten5b.components[0].toJSON().components.some((b) => b.custom_id.startsWith('mpub|diss')),
      arten5b.components[0].toJSON().components.map((b) => b.custom_id).join(' '));

    // --- Meldung: Einstieg -------------------------------------------------
    const [EG, EU] = await neu();
    const ein = beef.anstacheln(EG, EU, klein.id, jetzt, wuerfel(0));
    check('der Wurf ergibt einen Einstieg', ein.ok && ein.ein === true,
      JSON.stringify({ ok: ein.ok, reason: ein.reason, ein: ein.ein }));
    const einNote = anstachelnNote(ein, jetzt);
    check('Meldung bei Einstieg: Name, Ton des Kontakts, Hitze, Draht',
      einNote.includes(`🔥 **${klein.name}** steigt ein.`) && einNote.includes(ein.text)
      && einNote.includes(`🔥 Hitze ${bdata.HITZE_ANSTACHELN}`)
      && einNote.includes('🤝 Draht ▱▱▱▱▱ **-15** (-15,'), einNote);

    // --- Meldung: Blamage --------------------------------------------------
    const [BlG, BlU] = await neu();
    const blamage = beef.anstacheln(BlG, BlU, gross.id, jetzt, wuerfel(0.99));
    check('gegen den Großen steigt er nicht ein', blamage.ok && blamage.ein === false,
      JSON.stringify({ ok: blamage.ok, reason: blamage.reason, ein: blamage.ein }));
    const blNote = anstachelnNote(blamage, jetzt);
    check('Meldung bei Blamage: kein Einstieg, Hype gelitten, die zwei Stunden',
      blNote.includes(`😶 ${gross.name} reagiert nicht.`)
      && blNote.includes('📉 Dein Hype hat gelitten.')
      && blNote.includes(`⏱️ Die **${bdata.BEEF_TIME}** Stunden sind trotzdem weg`), blNote);

    // --- Meldung: Disstrack, mit und ohne Häme ----------------------------
    const [DG, DU] = await neu();
    setzeBeef(DG, DU, gross.id, { hitze: 62 });
    const dissRes = beef.diss(DG, DU, gross.id, jetzt, wuerfel(0.99, 0.5));
    check('der Disstrack gegen den Großen geht durch und ohne Häme',
      dissRes.ok && dissRes.beef.haeme === false,
      JSON.stringify({ ok: dissRes.ok, reason: dissRes.reason }));
    const dNote = dissNote(dissRes, jetzt);
    check('Meldung: normale Veröffentlichung plus Gegner, Aufmerksamkeit, Runden',
      dNote.includes('**Disstrack** ist draußen.') && dNote.includes('haben reingehört')
      && /🔥 Gegen \*\*Rammstein\*\* · Aufmerksamkeit ×\d+,\d · Runden 1:0/.test(dNote), dNote);

    const [HG, HU] = await neu();
    setzeBeef(HG, HU, klein.id, { hitze: 62 });
    const haeme = beef.diss(HG, HU, klein.id, jetzt, wuerfel(0.01, 0.5));
    check('nach unten getreten wird ausgelacht', haeme.ok && haeme.beef.haeme === true,
      JSON.stringify({ ok: haeme.ok, reason: haeme.reason }));
    check('Meldung bei Häme nennt die Nummer zu klein',
      dissNote(haeme, jetzt).includes(
        `😬 Das ging nach hinten los: ${klein.name} ist eine Nummer zu klein für dich.`),
      dissNote(haeme, jetzt));

    // --- Meldung: Gegenschlag (aus settle) --------------------------------
    const [KG5, KU5] = await neu();
    setzeBeef(KG5, KU5, gross.id, { hitze: 70, konter_at: jetzt - 1000 });
    const konterEv = beef.settle(KG5, KU5, jetzt, wuerfel(0));
    check('der fällige Konter kommt als Ereignis',
      konterEv.length === 1 && konterEv[0].art === 'konter',
      JSON.stringify(konterEv.map((e) => e.art)));
    const kNote = beefNote(konterEv);
    check('Meldung beim Gegenschlag: Name, Ton, Hype und verlorene Hörer',
      kNote.includes(`🔥 **${gross.name}** hat zurückgeschlagen.`)
      && kNote.includes(konterEv[0].text)
      && /📉 Hype −\d+ %, [\d.]+ Hörer weg\./.test(kNote), kNote);

    // --- Meldung: Abrechnung in allen drei Ausgängen -----------------------
    // Drei Fronten, eine Abrechnung: die Hitze ist bei allen längst durch.
    const [AG, AU] = await neu();
    const lange = { hitze: 10, last_cool: jetzt - 30 * 86_400_000 };
    setzeBeef(AG, AU, gross.id, { ...lange, runden_ich: 2, runden_er: 1 });
    setzeBeef(AG, AU, klein.id, { ...lange, runden_ich: 1, runden_er: 2 });
    setzeBeef(AG, AU, 'ninachuba', { ...lange, runden_ich: 1, runden_er: 1 });
    const enden = beef.settle(AG, AU, jetzt, wuerfel(0));
    check('alle drei Beefs werden abgerechnet',
      enden.length === 3 && enden.every((e) => e.art === 'ende'),
      JSON.stringify(enden.map((e) => `${e.contactId}:${e.status}`)));
    const aNote = beefNote(enden);
    // Die Dauer kommt aus BONUS_TAGE, nicht aus einer festen Zahl im Test –
    // sonst prüft der Test nur sich selbst, wenn Text und Konstante
    // gemeinsam verrutschen (siehe die Korrektur von „sieben Tage"/„eine
    // Woche" auf `BONUS_TAGE` 1 im Balancing vom 2026-09-26).
    const dauer = bdata.BONUS_TAGE === 1 ? 'einen Tag' : `${bdata.BONUS_TAGE} Tage`;
    check('Abrechnung: Sieg nennt den Stand und die Dauer aus BONUS_TAGE',
      aNote.includes(`🔥 Der Beef mit **${gross.name}** ist durch: **2:1** für dich. Die Straße redet – ${dauer} lang.`),
      aNote);
    check('Abrechnung: Niederlage sitzt dieselbe Dauer aus BONUS_TAGE',
      aNote.includes(`🔥 Der Beef mit **${klein.name}** ist durch: **1:2** für ihn. Das sitzt ${dauer}.`),
      aNote);
    check('Abrechnung: unentschieden hat keinen Gewinner',
      aNote.includes('ist durch: **1:1**. Keiner hat gewonnen.'), aNote);

    // --- Meldung: Frieden --------------------------------------------------
    const [FG, FU] = await neu();
    // Von −40 aus greift der Deckel: −40 + 30 wäre 10, gemeldet werden muss
    // FRIEDEN_DECKEL. (Ein Draht ÜBER dem Deckel bleibt unangetastet – der
    // Deckel bremst nach oben und zieht nicht nach unten; das rechnet
    // test/beef.test.js von beiden Seiten durch.)
    contacts.moveDraht(FG, FU, klein.id, -40, jetzt);
    setzeBeef(FG, FU, klein.id, { hitze: 10 });
    const friede = beef.frieden(FG, FU, klein.id, jetzt, wuerfel(0));
    check('Frieden geht unter Hitze 30', friede.ok === true,
      JSON.stringify({ ok: friede.ok, reason: friede.reason }));
    check('Meldung bei Frieden: der Draht springt nicht ins Plus',
      friedenNote(friede, jetzt).includes(
        `🕊️ Ihr habt Frieden geschlossen. Draht **${bdata.FRIEDEN_DECKEL}**.`),
      friedenNote(friede, jetzt));

    // --- Die Fehlerfälle mit dem Wortlaut der Spec ------------------------
    check('laeuft_schon', beefProblem({ reason: 'laeuft_schon' }, jetzt)
      === '🔥 Mit ihm läuft schon einer.');
    check('zu_viele', beefProblem({ reason: 'zu_viele' }, jetzt)
      === '🔥 Zwei Beefs sind genug.');
    check('zu_heiss nennt Hitze und Grenze',
      beefProblem({ reason: 'zu_heiss', hitze: 62 }, jetzt)
        === `🔥 Dafür ist es noch zu heiß (Hitze 62, nötig unter ${bdata.HITZE_FRIEDEN_MAX}).`,
      beefProblem({ reason: 'zu_heiss', hitze: 62 }, jetzt));
    check('kein_beef', beefProblem({ reason: 'kein_beef' }, jetzt)
      === '❌ Dafür läuft kein Beef.');
    check('gesperrt wie in 5a',
      beefProblem({ reason: 'gesperrt', remainingMs: 3 * 86_400_000 }, jetzt)
        === '⏳ Melde dich in 3 Tagen wieder.');
    check('zu_frisch nennt die Restzeit des Bonusfensters',
      beefProblem({ reason: 'zu_frisch', bis: jetzt + 3 * 86_400_000 }, jetzt)
        .includes('wieder möglich in 3 Tagen'),
      beefProblem({ reason: 'zu_frisch', bis: jetzt + 3 * 86_400_000 }, jetzt));
    check('eine Absage der Veröffentlichung kommt unverändert von releaseProblem',
      beefProblem({ reason: 'no_songs', need: 1, have: 0, release: { name: 'Disstrack' } }, jetzt)
        .includes('braucht **1** Titel'),
      beefProblem({ reason: 'no_songs', need: 1, have: 0, release: { name: 'Disstrack' } }, jetzt));

    /*
     * Und der Grund, warum `beefVorher` überall gerendert werden MUSS: Eine
     * abgelehnte Veröffentlichung rechnet den fälligen Gegenschlag trotzdem ab
     * (§4, Schritt 0 in `music.publish`). Ohne die Zeile in der Meldung kostet
     * ein Fehlklick still Hype und Hörer.
     */
    const [MG, MU] = await neu();
    db.saveArtist(MG, MU, { ...db.getArtist(MG, MU, jetzt), listeners: 50_000, songs: 0 });
    setzeBeef(MG, MU, gross.id, { hitze: 70, konter_at: jetzt - 1000 });
    const abgelehntPub = music.publish(MG, MU, 'single', jetzt, wuerfel(0.5));
    check('ohne Titel wird abgelehnt – der Konter ist trotzdem gefallen',
      abgelehntPub.ok === false && abgelehntPub.reason === 'no_songs'
      && abgelehntPub.beefVorher.length === 1
      && abgelehntPub.beefVorher[0].art === 'konter',
      JSON.stringify({ reason: abgelehntPub.reason, vorher: abgelehntPub.beefVorher?.length }));
    check('und er steht in der Meldung vor der Absage',
      require('../src/buttons').mitBeef(abgelehntPub.beefVorher,
        require('../src/buttons').releaseProblem(abgelehntPub, jetzt))
        .startsWith(`🔥 **${gross.name}** hat zurückgeschlagen.`),
      require('../src/buttons').mitBeef(abgelehntPub.beefVorher,
        require('../src/buttons').releaseProblem(abgelehntPub, jetzt)));

    /*
     * -----------------------------------------------------------------------
     *  Wo der Gegenschlag fällt – und wer ihn ausspricht
     * -----------------------------------------------------------------------
     *
     * Eine ANSICHT darf ihn nicht buchen. Sie hat keinen Rückkanal: Was sie
     * abrechnet, ist danach weg, ohne dass es jemand gesehen hätte – der
     * Spieler findet nur kleinere Zahlen und erfährt nie, warum. Geprüft wird
     * deshalb beides: dass Musik- und Kontaktansicht den fälligen Konter
     * LIEGEN LASSEN, und dass die Knöpfe, die dorthin führen, ihn melden.
     */
    /** Ein Klick auf einen Knopf; zurück kommt der private Hinweis danach. */
    const klick = async (handler, guildId, userId, args = []) => {
      const notes = [];
      await handler({
        guildId,
        user: { id: userId },
        deferUpdate: async () => {},
        update: async (v) => v,
        editReply: async (v) => v,
        reply: async (v) => { notes.push(v.content ?? v); return v; },
        followUp: async (v) => { notes.push(v.content ?? v); return v; },
      }, args);
      return notes.join('\n');
    };

    const [SG, SU] = await neu();
    setzeBeef(SG, SU, gross.id, { hitze: 70, konter_at: jetzt - 1000 });
    const vorAnsicht = db.getArtist(SG, SU, jetzt);
    await ui.buildMusicView({ guildId: SG, userId: SU });
    await ui.buildKontakteView({ guildId: SG, userId: SU, page: 1, filter: 'alle' });
    const nachAnsicht = db.getArtist(SG, SU, jetzt);
    check('Musik- und Kontaktansicht buchen den fälligen Gegenschlag NICHT',
      nachAnsicht.listeners === vorAnsicht.listeners
      && nachAnsicht.hype === vorAnsicht.hype
      && db.beefRow(SG, SU, gross.id).konter_at === jetzt - 1000,
      JSON.stringify({
        hoerer: [vorAnsicht.listeners, nachAnsicht.listeners],
        hype: [vorAnsicht.hype, nachAnsicht.hype],
        konterInMs: db.beefRow(SG, SU, gross.id).konter_at - jetzt,
      }));
    const musikNote = await klick(knoepfe5b.musik, SG, SU);
    check('der Knopf 🎵 Musik meldet ihn, statt ihn zu verschlucken',
      musikNote.includes(`🔥 **${gross.name}** hat zurückgeschlagen.`)
      && musikNote.includes('📉 Hype −'), musikNote);
    check('und erst dieser Klick hat ihn wirklich fallen lassen',
      db.getArtist(SG, SU, jetzt).listeners < vorAnsicht.listeners
      && db.beefRow(SG, SU, gross.id).konter_at === 0,
      JSON.stringify({
        hoerer: db.getArtist(SG, SU, jetzt).listeners,
        konter: db.beefRow(SG, SU, gross.id).konter_at,
      }));

    const [LG, LU] = await neu();
    setzeBeef(LG, LU, gross.id, { hitze: 70, konter_at: jetzt - 1000 });
    const listeNote = await klick(knoepfe5b.kontakte, LG, LU, ['alle', '1']);
    check('der Knopf 🤝 Kontakte meldet ihn ebenso',
      listeNote.includes(`🔥 **${gross.name}** hat zurückgeschlagen.`), listeNote);

    /*
     * -----------------------------------------------------------------------
     *  Das Nachbeben: abgerechnet, aber das Bonusfenster läuft noch
     * -----------------------------------------------------------------------
     *
     * Der Beef ist durch, wirkt aber weiter auf den Hype – und die Versöhnung
     * ist dort noch möglich („auch nach dem Ende, solange die Zeile steht").
     * Anstacheln dagegen weist mit `zu_frisch` ab. Die Ansicht muss genau das
     * zeigen: die Zeile mit dem AUSGANG, den Friedensknopf, und das Anstacheln
     * zu. Erst wenn das Fenster durch ist, verschwindet alles.
     */
    const [BG, BU] = await neu();
    setzeBeef(BG, BU, gross.id, {
      hitze: 0, runden_ich: 2, runden_er: 1, konter_at: 0,
      status: 'sieg', bonus_until: jetzt + 6 * 86_400_000,
    });
    const nachbeben = await ui.buildKontaktView({ guildId: BG, userId: BU, contactId: gross.id });
    const nbBeschreibung = nachbeben.embeds[0].toJSON().description;
    check('im Bonusfenster nennt die Zeile den Ausgang, nicht eine Hitze von 0',
      nbBeschreibung.includes('🔥 **Beef** · Sieg 2:1 · die Straße redet noch 6 Tage')
      && !nbBeschreibung.includes('Hitze 0'),
      nbBeschreibung.split('\n').filter((z) => z.includes('Beef')).join(' / '));
    const nbRow = nachbeben.components[0].toJSON().components;
    check('der Anstachel-Knopf ist im Bonusfenster deaktiviert',
      nbRow[4].custom_id === `anstacheln|${gross.id}|${BU}` && nbRow[4].disabled === true,
      nbRow.map((b) => `${b.custom_id}:${b.disabled}`).join(' | '));
    check('und einen Disstrack gibt es dort nicht – es läuft kein Beef mehr',
      !nachbeben.components.some((r) => r.toJSON().components
        .some((b) => String(b.custom_id).startsWith('diss|'))),
      nbRow.map((b) => b.custom_id).join(' '));
    check('die vier Anfragen sind wieder offen begründet, nicht mit dem Beef',
      !nachbeben.embeds[0].toJSON().fields[0].value.includes('Solange der Beef läuft'),
      nachbeben.embeds[0].toJSON().fields[0].value);
    const nbZweite = nachbeben.components[1].toJSON().components;
    check('der Friedensknopf steht im Bonusfenster da',
      nbZweite[0].custom_id === `frieden|${gross.id}|${BU}`,
      nbZweite.map((b) => b.custom_id).join(' '));
    check('Kontaktansicht im Bonusfenster hält das Fluxer-Limit (kein Überlauf)',
      render.mapReactions(nachbeben).overflow === undefined,
      `${render.mapReactions(nachbeben).length} / ${render.mapReactions(nachbeben).overflow}`);
    // Der Beleg, dass die beiden Knöpfe die Wahrheit sagen: das Modul.
    check('beef.anstacheln weist im Bonusfenster mit zu_frisch ab',
      beef.anstacheln(BG, BU, gross.id, jetzt, wuerfel(0)).reason === 'zu_frisch',
      JSON.stringify(beef.anstacheln(BG, BU, gross.id, jetzt, wuerfel(0)).reason));
    check('beef.frieden geht dort dagegen wirklich',
      beef.frieden(BG, BU, gross.id, jetzt, wuerfel(0)).ok === true,
      JSON.stringify(beef.frieden(BG, BU, gross.id, jetzt, wuerfel(0))?.reason ?? 'ok'));

    // Fenster durch: die Zeile ist weg, und das Anstacheln geht wieder.
    const [NG, NU] = await neu();
    setzeBeef(NG, NU, gross.id, {
      hitze: 0, runden_ich: 2, runden_er: 1, konter_at: 0,
      status: 'sieg', bonus_until: jetzt - 1000,
    });
    const durch = await ui.buildKontaktView({ guildId: NG, userId: NU, contactId: gross.id });
    check('nach dem Bonusfenster verschwindet der Beef aus der Ansicht',
      !durch.embeds[0].toJSON().description.includes('🔥 **Beef**')
      && durch.components[0].toJSON().components[4].disabled !== true,
      durch.embeds[0].toJSON().description.split('\n').slice(-1).join(''));

    /*
     * -----------------------------------------------------------------------
     *  Die Hinweiszeile der Musikansicht sagt, was der Knopf drüben hergibt
     * -----------------------------------------------------------------------
     */
    const [TG, TU] = await neu();
    setzeBeef(TG, TU, gross.id, { hitze: 62 });
    db.saveArtist(TG, TU, { ...db.getArtist(TG, TU, jetzt), songs: 0 });
    const ohneTitel = await ui.buildMusicView({ guildId: TG, userId: TU });
    const zeileOhneTitel = ohneTitel.embeds[0].toJSON().fields
      .find((f) => f.name === '⏳ Heute').value;
    check('ohne Titel im Kasten verspricht die Musikansicht keinen Disstrack',
      zeileOhneTitel.includes('🔥 Beef mit')
      && zeileOhneTitel.includes('– für einen Disstrack fehlt ein Titel'),
      zeileOhneTitel.split('\n').filter((z) => z.includes('Beef')).join(' / '));
    db.saveArtist(TG, TU, {
      ...db.getArtist(TG, TU, jetzt), songs: 4, last_release_at: jetzt,
    });
    const inSperre = await ui.buildMusicView({ guildId: TG, userId: TU });
    const zeileSperre = inSperre.embeds[0].toJSON().fields
      .find((f) => f.name === '⏳ Heute').value;
    check('und in der Veröffentlichungssperre sagt sie, wann er geht',
      /🔥 Beef mit .* – ein Disstrack geht erst in /.test(zeileSperre),
      zeileSperre.split('\n').filter((z) => z.includes('Beef')).join(' / '));

    /*
     * -----------------------------------------------------------------------
     *  Kein Streit möglich – dann fällt der fünfte Knopf weg
     * -----------------------------------------------------------------------
     * Ein Knopf, der nie angehen kann, ist kein Knopf. Bei einem Kontakt ohne
     * Musik-Reichweite gibt es nichts zu beefen, also steht dort auch nichts.
     */
    const nurCreator = cdata.CONTACTS.find((c) => !c.reach && c.reachCreator > 0);
    const [PG, PU] = await neu();
    const ohneStreit = await ui.buildKontaktView({
      guildId: PG, userId: PU, contactId: nurCreator.id,
    });
    const osRow = ohneStreit.components[0].toJSON().components;
    check('ohne Musik-Reichweite des Kontakts gibt es keinen fünften Knopf',
      osRow.length === 4 && !osRow.some((b) => String(b.custom_id).startsWith('anstacheln|')),
      osRow.map((b) => `${b.custom_id}:${b.disabled}`).join(' | '));
    check('Kontaktansicht ohne Beef-Knopf hält das Fluxer-Limit',
      render.mapReactions(ohneStreit).overflow === undefined,
      `${render.mapReactions(ohneStreit).length} / ${render.mapReactions(ohneStreit).overflow}`);

    // --- Die zwei Meldungen, die bisher niemand geprüft hat ----------------
    check('kontaktNote sagt bei Grund beef dasselbe wie der gesperrte Knopf',
      kNote5b({ ok: false, reason: 'beef' }, jetzt) === '❌ Solange der Beef läuft, nicht.',
      kNote5b({ ok: false, reason: 'beef' }, jetzt));
    const angeNote = rNote5b({
      release: { emoji: '💿', name: 'Single' },
      audience: 12_000, listeners: 11_000, listenersBefore: 10_000,
      angezaehlt: { contact: klein, text: 'Er postet einen Screenshot von dir.' },
    });
    check('die Veröffentlichung meldet, wenn dich jemand anzählt',
      angeNote.includes(`🔥 **${klein.name}** zählt dich an.`)
      && angeNote.includes('_Er postet einen Screenshot von dir._'), angeNote);
  }

  console.log('--- Angebote (Spec 5c: Anzeige) ---');
  /*
   * Die Angebots-Ansicht ist der einzige Ort, an dem eine Gegenanfrage
   * überhaupt sichtbar wird – und sie sitzt am selben harten Deckel wie
   * Kontakte und Beef (§16, neun Reaktionen): 2 Anfragen × 2 Knöpfe +
   * Arbeiten + Zurück + Hauptmenü = 7. Geprüft wird im VOLLEN Zustand, also
   * mit zwei Anfragen UND einem laufenden Projekt; ein achter Knopf fiele
   * sonst stumm hinten runter.
   *
   * Dazu die drei Meldungen und – wichtigster Punkt – dass ein ins Leere
   * gehender Klick die fällige Abrechnung MITMELDET. Ohne das verschluckt er
   * eine verfallene Anfrage samt Draht-Verlust (in 5b zweimal passiert).
   */
  {
    const ui = require('../src/ui');
    const angeboteUi = require('../src/angeboteUi');
    const ang = require('../src/angebote');
    const adata = require('../src/data/angebote');
    const cdata = require('../src/data/contacts');
    const music = require('../src/music');
    const home = require('../src/home');
    const {
      angebotNote, mitAngebote, annahmeNote, absageNote, arbeitNote, angebotProblem,
    } = require('../src/buttons');
    const TAG = 86_400_000;
    const jetzt = Date.now();
    const nie = () => 0.9999;        // kein Treffer, egal wie hoch ANFRAGE_CHANCE steht

    let lauf = 0;
    /** Ein deutscher Rapper mit 10.000 Hörern – die Zahlen der Spec-Tabelle. */
    const neu = async (listeners = 10_000) => {
      const g = `ANGUI_T${Date.now()}_${lauf++}`;
      const u = 'ang_user';
      await home.setHome(g, u, 'de');
      home.setLanguage(g, u, 'deutsch');
      music.setup(g, u, 'hiphop', music.PERSONAS[0].id);
      db.saveArtist(g, u, {
        ...db.getArtist(g, u, jetzt), listeners, songs: 6,
        touched_at: jetzt, last_action_at: jetzt, paid_through: jetzt,
      });
      return [g, u];
    };
    const anfrage = (g, u, art, contactId, frist) => db.insertAngebot({
      guildId: g, userId: u, art, contactId, erstellt: jetzt, frist });

    const OXMO = cdata.byId('oxmopuccino');       // 350.000 Reichweite
    const LILPFAND = cdata.byId('lilpfand');      // 8.400 Reichweite

    // --- Die volle Ansicht: zwei Anfragen und ein Projekt ------------------
    const [VG, VU] = await neu();
    const a1 = anfrage(VG, VU, 'gastpart', OXMO.id, jetzt + 2 * TAG);
    const a2 = anfrage(VG, VU, 'vorgruppe', LILPFAND.id, jetzt + 3 * TAG);
    const pr = db.insertProjekt({
      guildId: VG, userId: VU, art: 'kollabo', contactId: OXMO.id,
      stundenSoll: adata.KOLLABO_STUNDEN, frist: jetzt + 11 * TAG });
    db.saveProjekt(VG, pr.id, { stundenIst: 6 });

    const voll = await angeboteUi.buildAngeboteView({ guildId: VG, userId: VU });
    const vText = voll.embeds[0].toJSON().description;
    const vIds = voll.components.flatMap((r) => r.toJSON().components.map((b) => b.custom_id));
    check('die Ansicht trägt je Anfrage Annehmen und Absagen, dazu Arbeiten, Zurück, Home',
      vIds.join(' ') === `angebot-an|${a1.id}|${VU} angebot-ab|${a1.id}|${VU} `
        + `angebot-an|${a2.id}|${VU} angebot-ab|${a2.id}|${VU} `
        + `angebot-arbeit|${pr.id}|${VU} grp|work|${VU} home|${VU}`,
      vIds.join(' '));
    check('zwei Anfragen und ein Projekt halten das Fluxer-Limit (kein Überlauf)',
      render.mapReactions(voll).overflow === undefined
      && render.mapReactions(voll).length === 7,
      `${render.mapReactions(voll).length} / ${render.mapReactions(voll).overflow}`);

    // Honorar und Gage stehen als ZAHL in der Zeile – nicht als „bringt Geld".
    const honorar = ang.honorarOf({
      seine: OXMO.reach,
      tantiemenProTag: music.royaltyPerDay(10_000, music.marketOf(VG, VU)),
    });
    const gage = ang.gageOf({
      meine: 10_000, seine: LILPFAND.reach,
      showPay: music.SHOW_PAY, showExp: music.SHOW_EXP,
    });
    check(`das Honorar steht als Zahl in der Zeile (${honorar.toLocaleString('de-DE')})`,
      vText.includes(`💰 Honorar **${honorar.toLocaleString('de-DE')}**`),
      vText.split('\n').filter((z) => z.includes('Honorar')).join(' / '));
    check(`die Gage steht als Zahl in der Zeile (${gage.toLocaleString('de-DE')})`,
      vText.includes(`💰 Gage **${gage.toLocaleString('de-DE')}**`),
      vText.split('\n').filter((z) => z.includes('Gage')).join(' / '));
    check('je Anfrage stehen Art, Kontakt, Zeile, Stunden und Restfrist',
      vText.includes(`🎙️ **${ang.artOf('gastpart').name}** — ${OXMO.emoji} ${OXMO.name}`)
      && vText.includes('⏳ 2 Stunden · Frist: noch 2 Tage')
      && vText.includes('⏳ 4 Stunden · Frist: noch 3 Tage'),
      vText);
    check('der Fortschrittsbalken des Projekts zeigt 6 von 18 Stunden',
      vText.includes('▰▰▰▱▱▱▱▱▱▱ 6 von 18 Stunden · Frist: noch 11 Tage'),
      vText.split('\n').filter((z) => z.includes('von 18')).join(' / '));

    // --- Die leere Ansicht --------------------------------------------------
    const [LG, LU] = await neu();
    const leer = await angeboteUi.buildAngeboteView({ guildId: LG, userId: LU });
    check('die leere Ansicht sagt, dass gerade nichts anliegt',
      leer.embeds[0].toJSON().description.includes('Gerade liegt nichts an'),
      leer.embeds[0].toJSON().description);
    check('und hat trotzdem den Weg ins Hauptmenü',
      leer.components.flatMap((r) => r.toJSON().components)
        .some((b) => b.custom_id === `home|${LU}`));
    check('die leere Ansicht hält das Fluxer-Limit',
      render.mapReactions(leer).overflow === undefined,
      String(render.mapReactions(leer).overflow));

    // --- Meldung: angenommen (Honorar) -------------------------------------
    const [AG, AU] = await neu();
    const an = anfrage(AG, AU, 'gastpart', OXMO.id, jetzt + 2 * TAG);
    const resAn = await ang.annehmen(AG, AU, an.id, jetzt, nie);
    check('die Zusage geht durch', resAn.ok === true,
      JSON.stringify({ ok: resAn.ok, reason: resAn.reason }));
    const anNote = annahmeNote(resAn, '€', jetzt);
    check('Meldung bei Annahme: Art, Kontakt, Honorar als Zahl, Draht +8, Reststunden',
      anNote.includes(`🤝 Zugesagt: 🎙️ **${ang.artOf('gastpart').name}** `
        + `— ${OXMO.emoji} **${OXMO.name}**`)
      // Die GEBUCHTE Zahl, nicht das Brutto: `res.honorar` ist die Rechnung,
      // `res.geld.amount` das, was `payGig` aufs Konto gelegt hat. Ohne
      // Vertrag sind beide gleich – der Fall mit Anteil steht gleich darunter.
      && anNote.includes(`💰 Honorar: **€ ${resAn.geld.amount.toLocaleString('de-DE')}**`)
      && anNote.includes(`(+${adata.DRAHT_AN},`)
      && anNote.includes('⏱️ heute übrig:'), anNote);

    /*
     * -----------------------------------------------------------------------
     *  Der Anteil der Agentur gehört in die Meldung (5c-Review, Befund 1)
     * -----------------------------------------------------------------------
     * `annahmeNote` druckte `res.honorar` – das BRUTTO. Bei einem
     * unterschriebenen Vertrag nimmt `music.payGig` davon 30 bzw. 50 %, und
     * dem Spieler stand eine Zahl da, die so nie auf dem Konto ankam. Ein
     * Vertragskünstler bekommt weiter Gastparts und Vorgruppen (`artenFuer`
     * sperrt nur `label`), also trifft das jeden Unterschreiber.
     */
    const [KG, KU] = await neu(60_000);
    const kVertrag = db.insertContract({
      guildId: KG, userId: KU, kind: 'label', agency: 'Chocolat Musique',
      country: 'fr', createdAt: jetzt - 1000, expiresAt: jetzt + music.CONTRACT_OFFER_MS });
    db.setContractStatus(KG, kVertrag.id, 'active',
      { signedAt: jetzt - 1000, endsAt: jetzt + 30 * TAG });
    const kAn = anfrage(KG, KU, 'gastpart', OXMO.id, jetzt + 2 * TAG);
    const resK = await ang.annehmen(KG, KU, kAn.id, jetzt, nie);
    const kNote = annahmeNote(resK, '€', jetzt);
    check('ein Vertrag nimmt vom Honorar wirklich einen Anteil',
      resK.ok === true && resK.geld.cut > 0 && resK.geld.amount < resK.honorar,
      JSON.stringify({ ok: resK.ok, reason: resK.reason, geld: resK.geld, brutto: resK.honorar }));
    check('und die Zusage nennt das Netto plus den Anteil – nicht das Brutto',
      kNote.includes(`💰 Honorar: **€ ${resK.geld.amount.toLocaleString('de-DE')}**`)
      && kNote.includes(`_(nach € ${resK.geld.cut.toLocaleString('de-DE')} Agenturanteil)_`)
      && !kNote.includes(`Honorar: **€ ${resK.honorar.toLocaleString('de-DE')}**`),
      kNote);

    // --- Meldung: abgesagt --------------------------------------------------
    const [BG, BU] = await neu();
    const ab = anfrage(BG, BU, 'tausch', OXMO.id, jetzt + 2 * TAG);
    const resAb = ang.ablehnen(BG, BU, ab.id, jetzt, nie);
    const abNote = absageNote(resAb, jetzt);
    check('Meldung bei Absage: Draht −5 und die Zeile des Kontakts',
      resAb.ok && abNote.includes(`🚪 Du hast abgesagt. Draht **−${Math.abs(adata.DRAHT_AB)}**.`)
      && abNote.includes(`_${resAb.text}_`), abNote);

    // --- Meldung: verfallen -------------------------------------------------
    const [CG, CU] = await neu();
    anfrage(CG, CU, 'gastpart', OXMO.id, jetzt - 1000);
    const verfall = angebotNote(ang.settle(CG, CU, jetzt, nie));
    check('Meldung bei Verfall: Name und Draht −8',
      verfall.includes(`⌛ Die Anfrage von **${OXMO.name}** ist verstrichen. `
        + `Draht **−${Math.abs(adata.DRAHT_VERFALL)}**.`), verfall);

    /*
     * -----------------------------------------------------------------------
     *  Der Fehler aus 5b: ein abgelehnter Klick verschluckt die Abrechnung
     * -----------------------------------------------------------------------
     * `ablehnen` rechnet als Schritt 0 ab und gibt das Ergebnis unter `vorher`
     * heraus – AUCH auf dem Weg `{ ok: false, reason: 'weg' }`. Wird das nicht
     * gemeldet, kostet der Klick still 8 Draht, und der Spieler sieht nur eine
     * kleinere Zahl.
     */
    const [DG, DU] = await neu();
    anfrage(DG, DU, 'gastpart', OXMO.id, jetzt - 1000);
    const insLeere = ang.ablehnen(DG, DU, 999_999, jetzt, nie);
    const leereNote = mitAngebote(insLeere.vorher, absageNote(insLeere, jetzt));
    check('ein Klick ins Leere meldet trotzdem die verfallene Anfrage',
      insLeere.ok === false && insLeere.reason === 'weg'
      && leereNote.includes(`⌛ Die Anfrage von **${OXMO.name}** ist verstrichen.`)
      && leereNote.includes('❌ Dieses Angebot gibt es nicht mehr.'), leereNote);

    // --- Die zwei Absagegründe aus 5c, die sonst „❌ Das ging nicht." wären --
    const [EG, EU] = await neu(50_000);
    db.insertProjekt({
      guildId: EG, userId: EU, art: 'kollabo', contactId: OXMO.id,
      stundenSoll: adata.KOLLABO_STUNDEN, frist: jetzt + 11 * TAG });
    const zweites = anfrage(EG, EU, 'tour', OXMO.id, jetzt + 2 * TAG);
    const resZwei = await ang.annehmen(EG, EU, zweites.id, jetzt, nie);
    check('ein zweites großes Format wird mit projekt_offen abgewiesen',
      resZwei.ok === false && resZwei.reason === 'projekt_offen',
      JSON.stringify({ ok: resZwei.ok, reason: resZwei.reason }));
    // Der Prüfname trägt bewusst kein ❌: `npm test | grep -c '❌'` zählt die
    // Fehlschläge, und ein Name mit dem Zeichen wäre ein falscher Treffer.
    check('und bekommt einen eigenen Text statt der Standardabsage',
      annahmeNote(resZwei, '€', jetzt).includes('Erst das laufende Projekt')
      && annahmeNote(resZwei, '€', jetzt).includes('Zwei Stundenkonten gibt es nicht.'),
      annahmeNote(resZwei, '€', jetzt));

    const [FG, FU] = await neu(50_000);
    db.insertContract({
      guildId: FG, userId: FU, kind: 'label', agency: 'Chocolat Musique',
      country: 'fr', createdAt: jetzt, expiresAt: jetzt + music.CONTRACT_OFFER_MS });
    const zweiter = anfrage(FG, FU, 'label', OXMO.id, jetzt + 2 * TAG);
    const resVert = await ang.annehmen(FG, FU, zweiter.id, jetzt, nie);
    check('eine zweite Label-Tür wird mit vertrag_offen abgewiesen',
      resVert.ok === false && resVert.reason === 'vertrag_offen',
      JSON.stringify({ ok: resVert.ok, reason: resVert.reason }));
    check('und nennt das Angebot, das schon auf dem Tisch liegt',
      annahmeNote(resVert, '€', jetzt).includes('**Chocolat Musique**')
      && !annahmeNote(resVert, '€', jetzt).includes('Das ging nicht'),
      annahmeNote(resVert, '€', jetzt));
    check('die Hörerschwelle des Labels steht als Zahl im Text',
      angebotProblem({ ok: false, reason: 'zu_klein', need: music.LABEL.minListeners }, jetzt)
        === '📝 Dafür bist du dem Label noch zu klein (25.000 Hörer nötig).',
      angebotProblem({ ok: false, reason: 'zu_klein', need: music.LABEL.minListeners }, jetzt));

    /*
     * -----------------------------------------------------------------------
     *  Die Reststunden stimmen auch bei den Nullbuchungen (5c-Review, Blocker 2)
     * -----------------------------------------------------------------------
     * `kollabo` und `tour` haben `time: 0`; `annehmen` buchte dort nichts und
     * gab `{ ok: true, factor: 1 }` ohne `left` heraus. `annahmeNote` druckte
     * `res.zeit?.left ?? 0` – ein Spieler mit vollen 24 Stunden las „heute
     * übrig: 0 Stunden", direkt neben der Zusage. Geprüft wird gegen
     * `creator.budget`, also gegen die Zahl, die auch jede andere Ansicht zeigt.
     */
    const creator = require('../src/creator');
    for (const art of ['kollabo', 'tour']) {
      const [ZG, ZU] = await neu(60_000);
      const z = anfrage(ZG, ZU, art, OXMO.id, jetzt + 2 * TAG);
      const resZ = await ang.annehmen(ZG, ZU, z.id, jetzt, nie);
      const uebrig = creator.budget(ZG, ZU, jetzt).left;
      check(`${art} kostet nichts – und meldet den ECHTEN Reststand des Tages`,
        resZ.ok === true && resZ.zeit.left === uebrig && uebrig === 24,
        JSON.stringify({ ok: resZ.ok, reason: resZ.reason, left: resZ.zeit?.left, uebrig }));
      check(`und die Zusage zu ${art} schreibt ihn auch so hin`,
        annahmeNote(resZ, '€', jetzt).includes(`⏱️ heute übrig: **${uebrig}** Stunden`),
        annahmeNote(resZ, '€', jetzt));
    }
    // Die Gegenprobe: `label` kostet 2 Stunden, dort muss die Zahl FALLEN.
    {
      const [ZG, ZU] = await neu(60_000);
      const z = anfrage(ZG, ZU, 'label', OXMO.id, jetzt + 2 * TAG);
      const resZ = await ang.annehmen(ZG, ZU, z.id, jetzt, nie);
      check('label kostet 2 Stunden – und meldet 22 übrig',
        resZ.ok === true && resZ.zeit.left === 22
        && annahmeNote(resZ, '€', jetzt).includes('⏱️ heute übrig: **22** Stunden'),
        JSON.stringify({ ok: resZ.ok, reason: resZ.reason, left: resZ.zeit?.left }));
    }
    // Und ohne bekannten Reststand steht die Zeile GAR NICHT da statt falsch.
    check('ohne bekannte Reststunden fehlt die Zeile, statt 0 zu behaupten',
      !annahmeNote({ ...resAn, zeit: { ok: true } }, '€', jetzt).includes('heute übrig'),
      annahmeNote({ ...resAn, zeit: { ok: true } }, '€', jetzt));

    /*
     * -----------------------------------------------------------------------
     *  Die sechs Titel stehen VOR den 18 Stunden (5c-Review, Blocker 4)
     * -----------------------------------------------------------------------
     * `KOLLABO_TITEL` kam in keiner Ansicht und in keiner Meldung vor – die
     * erste Erwähnung war die Absage `no_songs` NACH dem letzten der neun
     * Drücke (gemessen 1.825 Mal, und 174 von 195 Kollabos sind mit vollem
     * Stundenkonto verfallen). Geprüft wird an allen drei Stellen, und zwar
     * gegen `data.KOLLABO_TITEL`: Die Zahl wird unten verbogen, damit eine
     * getippte 6 auffliegt.
     */
    {
      const [MG, MU] = await neu(60_000);
      const mk = anfrage(MG, MU, 'kollabo', OXMO.id, jetzt + 2 * TAG);
      const zeileMit = async () => (await angeboteUi.buildAngeboteView(
        { guildId: MG, userId: MU })).embeds[0].toJSON().description;
      check(`die Angebotszeile nennt die ${adata.KOLLABO_TITEL} aufgenommenen Titel`,
        (await zeileMit()).includes(`${adata.KOLLABO_TITEL} aufgenommene Titel`),
        (await zeileMit()).split('\n').filter((z) => z.includes('Stunden Arbeit')).join(' / '));

      const resM = await ang.annehmen(MG, MU, mk.id, jetzt, nie);
      const mNote = annahmeNote(resM, '€', jetzt);
      check('die Zusage zum Kollabo sagt, was am Ende noch gebraucht wird',
        resM.ok === true
        && mNote.includes(`🎼 Dafür brauchst du am Ende **${adata.KOLLABO_TITEL}** `
          + 'aufgenommene Titel – ohne sie erscheint nichts, und die Stunden sind weg.'),
        mNote);
      check('und der Fortschrittsbalken wiederholt es am laufenden Konto',
        (await zeileMit()).includes(`${adata.KOLLABO_TITEL} aufgenommene Titel nötig`),
        (await zeileMit()).split('\n').filter((z) => z.includes('von 18')).join(' / '));

      /*
       * Der Beweis, dass die Zahl an allen drei Stellen aus der Konstante kommt:
       * `KOLLABO_TITEL` wird verbogen und der ganze Weg noch einmal gegangen –
       * Angebotszeile, Zusage, Fortschrittsbalken. Eine getippte 6 bliebe an
       * ihrer Stelle stehen und fällt hier auf. `music.publish` verlangt
       * dieselbe Konstante; die Anzeige muss ihr folgen, sonst verspricht sie
       * eine andere Hürde als die, an der das Projekt scheitert.
       */
      const echt = adata.KOLLABO_TITEL;
      try {
        adata.KOLLABO_TITEL = 7;
        const [BG, BU] = await neu(60_000);
        const bk = anfrage(BG, BU, 'kollabo', OXMO.id, jetzt + 2 * TAG);
        const sicht = async () => (await angeboteUi.buildAngeboteView(
          { guildId: BG, userId: BU })).embeds[0].toJSON().description;
        const bAngebot = await sicht();
        const bRes = await ang.annehmen(BG, BU, bk.id, jetzt, nie);
        const bNote = annahmeNote(bRes, '€', jetzt);
        const bBalken = await sicht();
        check('alle drei Stellen folgen data.KOLLABO_TITEL und keiner getippten 6',
          bAngebot.includes('7 aufgenommene Titel')
          && !bAngebot.includes('6 aufgenommene Titel')
          && bNote.includes('**7** aufgenommene Titel')
          && bBalken.includes('7 aufgenommene Titel nötig')
          && !bBalken.includes('6 aufgenommene Titel'),
          JSON.stringify({ angebot: bAngebot.split('\n').pop(),
            note: bNote.split('\n').filter((z) => z.includes('Titel')).join(' / '),
            balken: bBalken.split('\n').pop() }));
      } finally {
        adata.KOLLABO_TITEL = echt;
      }
    }

    // --- Arbeiten: Stand und Abschluss -------------------------------------
    const [HG, HU] = await neu();
    const hp = db.insertProjekt({
      guildId: HG, userId: HU, art: 'kollabo', contactId: OXMO.id,
      stundenSoll: adata.KOLLABO_STUNDEN, frist: jetzt + 11 * TAG });
    const geArbeitet = await ang.arbeiten(HG, HU, hp.id, jetzt, nie);
    check('zwei Stunden am Projekt melden den neuen Stand mit Balken',
      geArbeitet.ok && geArbeitet.fertig === false
      && arbeitNote(geArbeitet, '€', jetzt).includes('**2 von 18** Stunden'),
      arbeitNote(geArbeitet, '€', jetzt));

    db.saveProjekt(HG, hp.id, { stundenIst: adata.KOLLABO_STUNDEN - 2 });
    const fertig = await ang.arbeiten(HG, HU, hp.id, jetzt, nie);
    check('das volle Konto veröffentlicht das gemeinsame Album',
      fertig.ok && fertig.fertig === true && fertig.art === 'kollabo',
      JSON.stringify({ ok: fertig.ok, fertig: fertig.fertig, reason: fertig.reason }));
    const fertigNote = arbeitNote(fertig, '€', jetzt);
    check('und meldet die normale Veröffentlichung plus die eine Kollabo-Zeile',
      fertigNote.includes('ist draußen.')
      && fertigNote.includes('👂 ')
      && fertigNote.includes(`💿 Das gemeinsame Album mit **${OXMO.name}** ist draußen.`),
      fertigNote);
    check('die Stundenzahl im Arbeitstext kommt aus der Konstante, nicht aus Prosa',
      arbeitNote(geArbeitet, '€', jetzt)
        .includes(`${adata.ARBEIT_STUNDEN} Stunden mehr.`),
      arbeitNote(geArbeitet, '€', jetzt));
    check('und ohne Kontakt steht dort kein Pronomen',
      !/\b(ihm|ihr|ihn|seine[rmsn]?|ihre[rmsn]?)\b/i.test(
        arbeitNote({ ...geArbeitet, contact: null, projekt: null }, '€', jetzt)),
      arbeitNote({ ...geArbeitet, contact: null, projekt: null }, '€', jetzt));

    /*
     * -----------------------------------------------------------------------
     *  Ein Abschluss MELDET, was er gebucht hat (5c-Review, Befund 2)
     * -----------------------------------------------------------------------
     * Ein volles Stundenkonto lässt die echten Maschinen laufen: `music.publish`
     * bzw. fünfmal `music.show`. Beide rechnen als Schritt 0 den fälligen Beef
     * nach – das KOSTET Hype und Hörer – und geben ihn unter `beefVorher`
     * heraus. `arbeitNote` ließ ihn fallen: Der Gegenschlag wurde angewandt,
     * aber nicht gemeldet, und der Spieler sah nur kleinere Zahlen.
     */
    /** Eine Beef-Zeile von Hand – wie im 5b-Block. */
    const setzeBeef = (g, u, contactId, felder) => db.saveBeef(g, u, contactId, {
      hitze: 25, runden_ich: 0, runden_er: 0, last_hit: jetzt, last_cool: jetzt,
      konter_at: 0, angefangen: jetzt, status: 'offen', bonus_until: 0, ...felder,
    });
    const RAMM = cdata.byId('rammstein');

    const [JG, JU] = await neu(60_000);
    const jp = db.insertProjekt({
      guildId: JG, userId: JU, art: 'kollabo', contactId: OXMO.id,
      stundenSoll: adata.KOLLABO_STUNDEN, frist: jetzt + 11 * TAG });
    db.saveProjekt(JG, jp.id, { stundenIst: adata.KOLLABO_STUNDEN - 2 });
    setzeBeef(JG, JU, RAMM.id, { hitze: 70, konter_at: jetzt - 1000 });
    const jFertig = await ang.arbeiten(JG, JU, jp.id, jetzt, nie);
    const jNote = arbeitNote(jFertig, '€', jetzt);
    check('das Kollabo rechnet den fälligen Gegenschlag ab – und meldet ihn',
      jFertig.ok === true && jFertig.platte?.beefVorher?.length === 1
      && jFertig.platte.beefVorher[0].art === 'konter'
      && jNote.startsWith(`🔥 **${RAMM.name}** hat zurückgeschlagen.`),
      JSON.stringify({ ok: jFertig.ok, vorher: jFertig.platte?.beefVorher?.length })
        + ' | ' + jNote.split('\n')[0]);

    // Derselbe Verlust auf dem abgewiesenen Weg: Ohne die sechs Titel schließt
    // das Konto nicht ab – `music.publish` hat den Konter aber schon gebucht.
    const [NG, NU] = await neu(60_000);
    db.saveArtist(NG, NU, { ...db.getArtist(NG, NU, jetzt), listeners: 60_000, songs: 0 });
    const np = db.insertProjekt({
      guildId: NG, userId: NU, art: 'kollabo', contactId: OXMO.id,
      stundenSoll: adata.KOLLABO_STUNDEN, frist: jetzt + 11 * TAG });
    db.saveProjekt(NG, np.id, { stundenIst: adata.KOLLABO_STUNDEN - 2 });
    setzeBeef(NG, NU, RAMM.id, { hitze: 70, konter_at: jetzt - 1000 });
    const nFertig = await ang.arbeiten(NG, NU, np.id, jetzt, nie);
    const nNote = arbeitNote(nFertig, '€', jetzt);
    check('und auch die Absage wegen fehlender Titel meldet ihn',
      nFertig.ok === false && nFertig.reason === 'no_songs'
      && nFertig.platte?.beefVorher?.length === 1
      && nNote.startsWith(`🔥 **${RAMM.name}** hat zurückgeschlagen.`),
      JSON.stringify({ ok: nFertig.ok, reason: nFertig.reason }) + ' | ' + nNote);

    // Die Tour: fünf echte Konzerte, der Konter fällt am ERSTEN Abend.
    const [TG, TU] = await neu(60_000);
    const tp = db.insertProjekt({
      guildId: TG, userId: TU, art: 'tour', contactId: OXMO.id,
      stundenSoll: adata.TOUR_STUNDEN, frist: jetzt + 11 * TAG });
    db.saveProjekt(TG, tp.id, { stundenIst: adata.TOUR_STUNDEN - 2 });
    setzeBeef(TG, TU, RAMM.id, { hitze: 70, konter_at: jetzt - 1000 });
    const tFertig = await ang.arbeiten(TG, TU, tp.id, jetzt, nie);
    const tNote = arbeitNote(tFertig, '€', jetzt);
    check('die Tour rechnet den fälligen Gegenschlag ab – und meldet ihn',
      tFertig.ok === true && tFertig.art === 'tour'
      && tFertig.abende[0]?.beefVorher?.length === 1
      && tNote.startsWith(`🔥 **${RAMM.name}** hat zurückgeschlagen.`),
      JSON.stringify({ ok: tFertig.ok, reason: tFertig.reason,
        vorher: tFertig.abende?.[0]?.beefVorher?.length }) + ' | ' + tNote.split('\n')[0]);
    check('und `abschliessen` summiert den Agenturanteil der Abende selbst',
      tFertig.cut === tFertig.abende.reduce((sum, a) => sum + (a.cut ?? 0), 0),
      JSON.stringify({ cut: tFertig.cut }));

    /*
     * Was eine echte Tour nicht zuverlässig würfelt, prüft der Renderer direkt:
     * `arbeitNote` ist eine reine Funktion. Hier hängen drei Verluste dran –
     * der verbrauchte 5a-Schub, der Grund eines ausgefallenen Abends und der
     * Anteil, den `brutto > verdient` verschweigt, sobald `perks.payout` das
     * Netto wieder über `brutto − cut` hebt (Befund 5).
     */
    const kunstTour = {
      ok: true, fertig: true, art: 'tour', contact: OXMO,
      konzerte: 4, brutto: 1_000, verdient: 1_100, cut: 300, gewonnen: 500,
      abende: [
        {
          ok: true, cancelled: false, cut: 60, amount: 220, gained: 100,
          extraHoerer: 1_200, kontakt: { name: 'Haiyti', factor: 1.5 },
          event: null, incident: null,
          beefVorher: [{ art: 'konter', contact: RAMM, wucht: 1, treffer: { verloren: 900 } }],
        },
        { ok: true, cancelled: true, cut: 0, amount: 0, gained: 0,
          event: { id: 'absage', text: 'Die Halle ist abgebrannt.' } },
        { ok: true, cancelled: false, cut: 80, amount: 300, gained: 120,
          event: { id: 'presse', text: 'Die Presse ist da.' } },
        { ok: true, cancelled: false, cut: 80, amount: 300, gained: 140, event: null },
        { ok: true, cancelled: false, cut: 80, amount: 280, gained: 140, event: null },
      ],
    };
    const kNoteTour = arbeitNote(kunstTour, '€', jetzt);
    check('die Tour-Meldung nennt den Anteil auch, wenn das Netto über Brutto−Anteil liegt',
      kNoteTour.includes('_(nach € 300 Agenturanteil)_'), kNoteTour);
    check('sie nennt den verbrauchten Schub des ersten Abends',
      kNoteTour.includes('🤝 Der Schub von **Haiyti** hat gewirkt: '
        + '**+1.200** Hörer im Saal.'), kNoteTour);
    check('sie sagt je Abend, was passiert ist – samt Grund der Absage',
      kNoteTour.includes('🎤 Abend 2 ist ausgefallen – Die Halle ist abgebrannt.')
      && kNoteTour.includes('🎤 Abend 3: Die Presse ist da.')
      && !kNoteTour.includes('Abend 4:'), kNoteTour);
    check('und der fällige Gegenschlag steht auch hier vor allem anderen',
      kNoteTour.startsWith(`🔥 **${RAMM.name}** hat zurückgeschlagen.`), kNoteTour);

    // --- Die Hinweiszeile in Musik- und Kontaktansicht ---------------------
    const studio = await ui.buildMusicView({ guildId: VG, userId: VU });
    const heute = studio.embeds[0].toJSON().fields.find((f) => f.name === '⏳ Heute').value;
    check('die Musikansicht trägt die Hinweiszeile mit Zahl und Stundenkonto',
      heute.includes('📬 **2 Angebote** warten')
      && heute.includes(`💿 Kollabo mit *${OXMO.name}*: 6 von 18 Stunden`), heute);
    check('aber keinen Angebots-Knopf (§16)',
      !studio.components.some((r) => r.toJSON().components
        .some((b) => String(b.custom_id).startsWith('angebot-'))),
      studio.components.map((r) => r.toJSON().components
        .map((b) => b.custom_id).join(' ')).join(' | '));
    check('Musikansicht mit Hinweiszeile hält das Fluxer-Limit (kein Überlauf)',
      render.mapReactions(studio).overflow === undefined,
      `${render.mapReactions(studio).length} / ${render.mapReactions(studio).overflow}`);

    const kliste = await ui.buildKontakteView({
      guildId: VG, userId: VU, page: 1, filter: 'alle' });
    check('die Kontaktansicht trägt dieselbe Zeile',
      kliste.embeds[0].toJSON().description.includes('📬 **2 Angebote** warten'),
      kliste.embeds[0].toJSON().description.split('\n').slice(0, 3).join(' / '));
    check('Kontaktansicht mit Hinweiszeile hält das Fluxer-Limit',
      render.mapReactions(kliste).overflow === undefined,
      String(render.mapReactions(kliste).overflow));

    /*
     * Die Zeile darf nicht mehr versprechen, als die Ansicht zeigt (Befund 6):
     * `buildAngeboteView` schneidet bei `ANFRAGEN_MAX` ab, weil der dritten
     * Anfrage kein Knopf mehr bliebe (§16). Zählte die Zeile alle offenen,
     * stünde „3 Angebote“ über einer Ansicht mit zwei.
     */
    anfrage(VG, VU, 'tausch', LILPFAND.id, jetzt + 3 * TAG);
    check('drei offene Anfragen stehen in der Tabelle',
      ang.offeneAngebote(VG, VU, jetzt).filter((r) => r.restMs > 0).length === 3,
      String(ang.offeneAngebote(VG, VU, jetzt).filter((r) => r.restMs > 0).length));
    const dreiView = await angeboteUi.buildAngeboteView({ guildId: VG, userId: VU });
    check('die Ansicht zeigt davon nur zwei',
      dreiView.components[0].toJSON().components
        .filter((b) => String(b.custom_id).startsWith('angebot-an|')).length
        === adata.ANFRAGEN_MAX
      && render.mapReactions(dreiView).overflow === undefined,
      String(dreiView.components[0].toJSON().components.length));
    check('und die Hinweiszeile zählt genau das, was die Ansicht zeigt',
      ui.angeboteZeile(VG, VU, jetzt).includes('📬 **2 Angebote** warten'),
      ui.angeboteZeile(VG, VU, jetzt));

    // Eine Anfrage, deren Frist durch ist, zählt in der Zeile NICHT mehr mit:
    // Sie steht bis zur Abrechnung weiter als `offen` in der Tabelle.
    const [IG, IU] = await neu();
    anfrage(IG, IU, 'gastpart', OXMO.id, jetzt - 1000);
    check('eine verstrichene Anfrage verspricht in der Hinweiszeile nichts mehr',
      ui.angeboteZeile(IG, IU, jetzt) === null, String(ui.angeboteZeile(IG, IU, jetzt)));
  }

  console.log('--- Vertragsansicht (Spec 5c: zwei Vertragsarten) ---');
  /*
   * `buildMusicDealView` ist der EINZIGE Weg im Spiel, einen Vertrag zu
   * unterschreiben – und las bis 5c durchgehend `music.IDOL`. Ein
   * Label-Unterzeichner stand damit vor „50 % der Einnahmen · 25 Tage
   * Vorschuss · 90 Tage Laufzeit", während die Kasse 30 % nahm, 10 Tage zahlte
   * und der Vertrag 60 Tage lief. Dieser Test schickt ein LABEL-Angebot durch
   * Ansicht und Unterschrift und prüft, dass keine der drei Idol-Zahlen
   * irgendwo auftaucht.
   */
  {
    const ui = require('../src/ui');
    const music = require('../src/music');
    const home = require('../src/home');
    const jetzt = Date.now();
    const G = `DEAL_T${Date.now()}`;
    const U = 'deal_user';
    await home.setHome(G, U, 'de');
    home.setLanguage(G, U, 'deutsch');
    music.setup(G, U, 'hiphop', music.PERSONAS[0].id);
    db.saveArtist(G, U, {
      ...db.getArtist(G, U, jetzt), listeners: 60_000,
      touched_at: jetzt, last_action_at: jetzt, paid_through: jetzt,
    });
    const row = db.insertContract({
      guildId: G, userId: U, kind: 'label', agency: 'Chocolat Musique',
      country: 'fr', createdAt: jetzt, expiresAt: jetzt + music.CONTRACT_OFFER_MS });

    /** Alles, was ein Spieler an dieser Ansicht lesen kann, in einem String. */
    const sichtbar = (v) => {
      const e = v.embeds[0].toJSON();
      return [e.title, e.description, e.footer?.text,
        ...(e.fields ?? []).flatMap((f) => [f.name, f.value])].filter(Boolean).join('\n');
    };
    const IDOL_ZAHLEN = ['50 %', 'Hälfte', '25 Tage', '90 Tage', '30 Tage'];

    const offer = await ui.buildMusicDealView({ guildId: G, userId: U });
    const oText = sichtbar(offer);
    check('das Label-Angebot zeigt die Konditionen des LABELS',
      oText.includes(`${music.LABEL.advanceDays} Tage Tantiemen`) && oText.includes('30 %')
      && oText.includes('Laufzeit 60 Tage') && oText.includes('15 Tage Einnahmen'),
      oText);
    check('und keine einzige Idol-Zahl',
      IDOL_ZAHLEN.every((z) => !oText.includes(z)),
      IDOL_ZAHLEN.filter((z) => oText.includes(z)).join(' | '));

    const signed = await music.sign(G, U, row.id);
    check('die Unterschrift gibt die Konditionen ihrer Art heraus',
      signed.ok && signed.terms === music.LABEL,
      JSON.stringify({ ok: signed.ok, reason: signed.reason }));
    // Genau der Text, den `mdealok` in buttons.js meldet.
    const quittung = `${signed.terms.rules.join('\n')}`;
    check('die Bestätigung der Unterschrift nennt keine Idol-Zahl',
      IDOL_ZAHLEN.every((z) => !quittung.includes(z)) && quittung.includes('30 %'),
      quittung);

    const laufend = await ui.buildMusicDealView({ guildId: G, userId: U });
    const lText = sichtbar(laufend);
    check('der laufende Label-Vertrag zeigt Laufzeit und Ausstieg aus seinen Konditionen',
      lText.includes('von **60 Tagen**')
      && lText.includes('Vorzeitiger Ausstieg kostet 15 Tage Einnahmen und Hörer.'),
      lText);
    check('und auch hier keine Idol-Zahl',
      IDOL_ZAHLEN.every((z) => !lText.includes(z)),
      IDOL_ZAHLEN.filter((z) => lText.includes(z)).join(' | '));

    const studio = await ui.buildMusicView({ guildId: G, userId: U });
    const vertragsfeld = studio.embeds[0].toJSON().fields
      .find((f) => f.name.startsWith('📜 Unter Vertrag'));
    check('die Musikansicht nennt den Anteil, mit dem sie auch rechnet',
      vertragsfeld.value.includes('30 % deiner Einnahmen')
      && !vertragsfeld.value.includes('50 %'), vertragsfeld.value);

    // Und der Gegenbeweis: Für ein IDOL-Angebot stehen weiter die Idol-Zahlen.
    const [IG2, IU2] = [`DEAL_I${Date.now()}`, 'deal_idol'];
    await home.setHome(IG2, IU2, 'jp');
    home.setLanguage(IG2, IU2, 'japanisch');
    music.setup(IG2, IU2, 'hiphop', music.PERSONAS[0].id);
    db.insertContract({
      guildId: IG2, userId: IU2, kind: 'idol', agency: 'Sakura Pro',
      country: 'jp', createdAt: jetzt, expiresAt: jetzt + music.CONTRACT_OFFER_MS });
    const idol = sichtbar(await ui.buildMusicDealView({ guildId: IG2, userId: IU2 }));
    check('ein Idol-Angebot zeigt unverändert seine eigenen Zahlen',
      idol.includes('25 Tage Tantiemen') && idol.includes('Laufzeit 90 Tage')
      && idol.includes('30 Tage Einnahmen'), idol);

    /*
     * -----------------------------------------------------------------------
     *  Die Ansicht darf sich nicht selbst widersprechen (5c-Review, Blocker 1)
     * -----------------------------------------------------------------------
     * `LABEL.blurb` begann mit „Ein Vertrag über **zwei Jahre** Musik", während
     * `durationDays` 60 ist und derselbe Fußtext drei Zeilen darunter „Laufzeit
     * 60 Tage" schrieb – ein Faktor zwölf in EINER Meldung, direkt über
     * ✍️ Unterschreiben. Geprüft wird nicht der Wortlaut, sondern die Aussage:
     * Jede Laufzeitangabe in Beschreibung und Fußtext wird in Tage umgerechnet
     * und gegen `durationDays` gestellt. Beträge in „Tagen Einnahmen" oder
     * „Tagen Tantiemen" sind keine Laufzeiten und zählen nicht mit – deshalb
     * stehen nur Beschreibung (der Blurb) und die „Laufzeit"-Angabe des
     * Fußtexts im Prüfbereich.
     */
    const ZAHLWORT = { ein: 1, eine: 1, zwei: 2, drei: 3, vier: 4, fünf: 5, sechs: 6,
      sieben: 7, acht: 8, neun: 9, zehn: 10, elf: 11, zwölf: 12 };
    const EINHEIT = { tag: 1, tage: 1, tagen: 1, woche: 7, wochen: 7,
      monat: 30, monate: 30, monaten: 30, jahr: 365, jahre: 365, jahren: 365 };
    /** Jede „<Zahl oder Zahlwort> <Zeiteinheit>"-Angabe eines Texts, in Tagen. */
    const laufzeiten = (text) => [...text.matchAll(
      /(\d+|[A-Za-zÄÖÜäöü]+)\s+(Tage?n?|Woche[n]?|Monate?n?|Jahre?n?)\b/g)]
      .map(([, zahl, einheit]) => {
        const n = /^\d+$/.test(zahl) ? Number(zahl) : ZAHLWORT[zahl.toLowerCase()];
        return n === undefined ? null : n * EINHEIT[einheit.toLowerCase()];
      })
      .filter((t) => t !== null);

    const ANGEBOTE = [
      ['Label', music.LABEL, { guildId: G, userId: U }],
      ['Idol', music.IDOL, { guildId: IG2, userId: IU2 }],
    ];
    for (const [name, kond, wer] of ANGEBOTE) {
      const e = (await ui.buildMusicDealView(wer)).embeds[0].toJSON();
      const laufzeitSatz = (e.footer?.text ?? '').split('·')
        .find((t) => t.includes('Laufzeit')) ?? '';
      const gemessen = [...laufzeiten(e.description ?? ''), ...laufzeiten(laufzeitSatz)];
      check(`${name}: jede Laufzeitangabe der Ansicht trifft durationDays `
        + `(${kond.durationDays} Tage)`,
        gemessen.length > 0 && gemessen.every((t) => t === kond.durationDays),
        JSON.stringify({ gemessen, soll: kond.durationDays,
          text: `${e.description} | ${laufzeitSatz}` }));
    }
  }

  console.log(`\n${pass} bestanden, ${fail} fehlgeschlagen`);
  process.exit(fail === 0 ? 0 : 1);
})();
