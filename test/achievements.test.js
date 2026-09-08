/**
 * Tests für die Erfolge (achievements.js).
 *
 * Der heikelste Teil ist nicht das Vergeben, sondern die Einmaligkeit: Ein
 * serverweiter Erfolg darf genau einen Gewinner haben, auch wenn zwei Spieler
 * in derselben Millisekunde fertig werden. Deshalb hängt sie am
 * Primärschlüssel und nicht an einer Prüfung im Code.
 *
 * Aufruf: node test/achievements.test.js
 */
process.env.WORLD_ID = `ACH_T${Date.now()}`;

const db = require('../src/db');
const identity = require('../src/identity');

const W = identity.world();
let pass = 0, fail = 0;
const check = (label, ok, extra = '') => {
  if (ok) { pass++; console.log(`  ✅ ${label}`); }
  else { fail++; console.log(`  ❌ ${label} ${extra}`); }
};

const A = 'fx:anton', B = 'fx:berta';

(async () => {
  console.log('--- Vergeben ist einmalig je Konto ---');
  check('erste Vergabe zählt', db.awardAchievement(W, A, 'job_1', 1000) === true);
  check('die zweite nicht mehr', db.awardAchievement(W, A, 'job_1', 2000) === false);
  check('ein anderes Konto bekommt ihn trotzdem',
    db.awardAchievement(W, B, 'job_1', 3000) === true);

  const meine = db.achievementsOf(W, A);
  check('der Erfolg steht in der Liste', meine.length === 1 && meine[0].ach_id === 'job_1',
    JSON.stringify(meine));
  check('mit dem Zeitpunkt der ERSTEN Vergabe', meine[0].at === 1000, String(meine[0]?.at));

  console.log('--- Serverweit gewinnt genau einer ---');
  check('Anton war zuerst da', db.claimFirst(W, 'srv_millionaire', A, 1000) === true);
  check('Berta geht leer aus', db.claimFirst(W, 'srv_millionaire', B, 1001) === false);

  const tafel = db.allFirsts(W);
  const eintrag = tafel.find((r) => r.ach_id === 'srv_millionaire');
  check('die Ehrentafel nennt den Gewinner', eintrag?.user_id === A, JSON.stringify(eintrag));
  check('und nur einen', tafel.filter((r) => r.ach_id === 'srv_millionaire').length === 1);

  console.log('--- Das Regelwerk ist wohlgeformt ---');
  const ach = require('../src/achievements');
  const activity = require('../src/activity');

  const ids = ach.RULES.map((r) => r.id);
  check('jede id kommt genau einmal vor', new Set(ids).size === ids.length,
    ids.filter((id, i) => ids.indexOf(id) !== i).join(', '));
  check('37 private Erfolge',
    ach.RULES.filter((r) => r.scope === 'privat').length === 37,
    String(ach.RULES.filter((r) => r.scope === 'privat').length));
  check('15 serverweite Erfolge',
    ach.RULES.filter((r) => r.scope === 'server').length === 15,
    String(ach.RULES.filter((r) => r.scope === 'server').length));

  const unvollstaendig = ach.RULES.filter((r) =>
    !r.emoji || !r.title || !r.text || !r.on || typeof r.test !== 'function');
  check('jede Regel hat Emoji, Titel, Text, Andockpunkt und Prüfung',
    unvollstaendig.length === 0, unvollstaendig.map((r) => r.id).join(', '));

  const falscheStufe = ach.RULES.filter((r) =>
    r.scope === 'privat' ? !ach.TIERS[r.tier] : Boolean(r.tier));
  check('private Erfolge haben eine gültige Stufe, serverweite keine',
    falscheStufe.length === 0, falscheStufe.map((r) => r.id).join(', '));

  const unbekannteAktivitaet = ach.RULES
    .filter((r) => r.on.startsWith('kind:'))
    .filter((r) => !activity.kind(r.on.slice(5)));
  check('jeder kind-Andockpunkt nennt eine bekannte Aktivität',
    unbekannteAktivitaet.length === 0, unbekannteAktivitaet.map((r) => r.on).join(', '));

  console.log('--- Raritäten werden als "oder besser" verglichen ---');
  check('Cosmic liegt über Godlike', ach.rarityRank('cosmic') > ach.rarityRank('godlike'));
  check('Mythic liegt darunter', ach.rarityRank('mythic') < ach.rarityRank('godlike'));
  check('Unbekanntes ist -1', ach.rarityRank('quatsch') === -1);

  console.log('--- Vergeben: einmal, synchron, ohne Geld ---');
  const C = 'fx:cem', D = 'fx:dora';

  // §3: Die Geldschnittstelle wird ersetzt und mitgezählt. Sie darf nie
  // angefasst werden – ein Erfolg ist Ruhm, keine Auszahlung.
  const unb = require('../src/unb');
  let geldAufrufe = 0;
  // Das Original merken: Task 6 prüft den echten Andockpunkt in changeCash
  // und braucht die unveränderte Funktion zurück.
  const echtesChangeCash = unb.changeCash;
  unb.changeCash = async () => { geldAufrufe++; return { cash: 0, bank: 0, total: 0 }; };
  unb.getBalance = async () => ({ cash: 0, bank: 0, total: 0 });

  db.setActivity(W, C, 'fishing', 100, 1000);
  const ersteRunde = await ach.onActivity(W, C, 'fishing');
  const idsRunde = ersteRunde.map((r) => r.id).sort();
  check('Bronze und Silber gehen zusammen raus',
    idsRunde.join(',') === 'fish_1,fish_100', idsRunde.join(','));
  check('beim zweiten Mal nichts mehr',
    (await ach.onActivity(W, C, 'fishing')).length === 0);
  check('§3: kein einziger Geldaufruf', geldAufrufe === 0, String(geldAufrufe));

  console.log('--- §7: die Zeile steht vor dem ersten await ---');
  db.setActivity(W, D, 'fishing', 1, 1000);
  const laeuft = ach.onActivity(W, D, 'fishing');
  check('schon vor dem Auflösen in der Datenbank',
    db.achievementsOf(W, D).some((r) => r.ach_id === 'fish_1'));
  await laeuft;

  console.log('--- Serverweit: genau einer, der andere geht leer aus ---');
  const E = 'fx:emil', F = 'fx:frida';
  db.setActivity(W, E, 'job', 250, 1000);
  db.setActivity(W, F, 'job', 250, 1000);
  const erster = await ach.onActivity(W, E, 'job');
  const zweiter = await ach.onActivity(W, F, 'job');
  check('der Erste bekommt ihn', erster.some((r) => r.id === 'srv_worker'));
  check('der Zweite nicht', !zweiter.some((r) => r.id === 'srv_worker'));
  check('aber seine privaten Erfolge schon',
    zweiter.some((r) => r.id === 'job_250'), zweiter.map((r) => r.id).join(','));
  check('und er hat auch keine stille Kopie',
    !db.achievementsOf(W, F).some((r) => r.ach_id === 'srv_worker'));

  console.log('--- fire: Ereignisse ohne Geldbuchung ---');
  const G = 'fx:gustav';
  check('ein Mythic reicht nicht',
    (await ach.fire(W, G, 'loot', { rarity: 'mythic' })).length === 0);
  const cosmic = await ach.fire(W, G, 'loot', { rarity: 'cosmic' });
  check('ein Cosmic löst auch den Godlike-Erfolg aus (oder besser)',
    cosmic.some((r) => r.id === 'godlike') && cosmic.some((r) => r.id === 'srv_cosmic'),
    cosmic.map((r) => r.id).join(','));

  console.log('--- Der Buchungspfad rechnet kein Vermögen ---');
  const networth = require('../src/networth');
  const echtesOf = networth.of;
  let worthAufrufe = 0;
  networth.of = async (...a) => { worthAufrufe++; return echtesOf(...a); };
  db.setActivity(W, C, 'job', 1, 2000);
  await ach.onActivity(W, C, 'job');
  check('kein Networth auf dem Buchungspfad', worthAufrufe === 0, String(worthAufrufe));
  networth.of = echtesOf;

  console.log('--- Meldungen: leise unten, laut oben ---');
  const relay = require('../src/relay');
  const durchsagen = [];
  relay.broadcast = async (text, opts = {}) => { durchsagen.push({ text, ...opts }); return ['discord']; };
  require('../src/currency').getSymbol = async () => '🪙';

  const H = 'fx:heinz';
  db.setActivity(W, H, 'fishing', 1, 1000);
  await ach.onActivity(W, H, 'fishing');
  check('Bronze geht NICHT in den Kanal', durchsagen.length === 0,
    JSON.stringify(durchsagen));
  check('steht aber im Postfach',
    db.listMessages(W, H).items.some((m) => m.title.includes('Erster Fang')),
    JSON.stringify(db.listMessages(W, H).items.map((m) => m.title)));

  durchsagen.length = 0;
  db.setActivity(W, H, 'fishing', 500, 2000);
  await ach.onActivity(W, H, 'fishing');
  check('Gold geht in den Kanal', durchsagen.length >= 1, String(durchsagen.length));
  check('und zwar in den Hauptkanal',
    durchsagen.every((d) => d.lane === 'wichtig'), JSON.stringify(durchsagen));
  check('die Meldung nennt den Erfolg',
    durchsagen.some((d) => d.text.includes('Fischerkönig')),
    durchsagen.map((d) => d.text).join(' | '));
  check('und pingt niemanden',
    durchsagen.every((d) => !d.text.includes('@everyone') && !d.text.includes('@here')));

  durchsagen.length = 0;
  const I = 'fx:ida';
  await ach.fire(W, I, 'lot_won', { price: 150_000 });
  check('ein serverweiter Erfolg geht in den Kanal', durchsagen.length === 1);
  check('und sagt, dass es der Erste war',
    durchsagen[0]?.text.includes('als Erster'), durchsagen[0]?.text);

  console.log('--- Eine kaputte Meldung kippt die Vergabe nicht ---');
  relay.broadcast = async () => { throw new Error('kein Kanal'); };
  const J = 'fx:jonas';
  db.setActivity(W, J, 'fishing', 500, 3000);
  const trotzdem = await ach.onActivity(W, J, 'fishing');
  check('die Erfolge sind trotzdem vergeben', trotzdem.length >= 3, String(trotzdem.length));
  check('und stehen in der Datenbank',
    db.achievementsOf(W, J).some((r) => r.ach_id === 'fish_500'));

  console.log('--- Regression: Einzel-Nachtrag beansprucht keinen serverweiten Erfolg ---');
  // Karl hat Fänge und Schichten, aber nie einen Heist gemacht. `check()`
  // filtert Andockpunkte nicht nach `scope` – ein einzelner Konto-Nachtrag
  // darf trotzdem keinen serverweiten Erfolg per claimFirst an sich reißen.
  const WR1 = `${W}_R1`;
  const R1 = 'fx:robert';
  db.setActivity(WR1, R1, 'fishing', 600, 1000);
  db.setActivity(WR1, R1, 'job', 300, 1000);
  await ach.backfill(WR1, R1);
  check('kein einziger serverweiter Erfolg wird beansprucht',
    db.allFirsts(WR1).length === 0, JSON.stringify(db.allFirsts(WR1)));

  console.log('--- Regression: ein frisches Konto bekommt nichts geschenkt ---');
  // move_1 und heist_clean hatten `test: () => true` – ohne echte Prüfung
  // feuern sie im Nachtrag bedingungslos, auch ganz ohne Vorgeschichte.
  const WR2 = `${W}_R2`;
  const R2 = 'fx:frisch';
  await ach.backfill(WR2, R2);
  check('kein move_1 und kein heist_clean ohne jede Aktivität',
    !db.achievementsOf(WR2, R2).some((r) => ['move_1', 'heist_clean'].includes(r.ach_id)),
    JSON.stringify(db.achievementsOf(WR2, R2)));
  check('überhaupt nichts vergeben',
    db.achievementsOf(WR2, R2).length === 0, JSON.stringify(db.achievementsOf(WR2, R2)));

  console.log('--- Regression: Raritäten werden aus dem Bestand nachgetragen ---');
  const WR3 = `${W}_R3`;
  const R3 = 'fx:sammler';
  db.addLoot(WR3, R3, 'Kristallschädel', 500_000, 'cosmic', 'gut', null);
  await ach.backfill(WR3, R3);
  check('ein Cosmic-Fundstück im Bestand trägt godlike nach',
    db.achievementsOf(WR3, R3).some((r) => r.ach_id === 'godlike'),
    JSON.stringify(db.achievementsOf(WR3, R3)));

  console.log('--- Regression: serverweiter Nachtrag trotz vorherigem Einzel-Nachtrag ---');
  const WR4 = `${W}_R4`;
  db.setActivity(WR4, 'fx:wenig2', 'job', 260, 1000);
  db.setActivity(WR4, 'fx:viel2', 'job', 900, 1000);
  await ach.backfill(WR4, 'fx:wenig2');
  await ach.backfill(WR4, 'fx:viel2');
  await ach.backfillWorld(WR4, ['fx:wenig2', 'fx:viel2']);
  const tafelR4 = db.allFirsts(WR4).find((r) => r.ach_id === 'srv_worker');
  check('nach zwei Einzel-Nachträgen bekommt weiterhin der Stärkere den Serverrekord',
    tafelR4?.user_id === 'fx:viel2', JSON.stringify(tafelR4));

  console.log('--- Nachtrag: alles auf einmal, aber lautlos ---');
  relay.broadcast = async (text, opts = {}) => { durchsagen.push({ text, ...opts }); return ['discord']; };
  durchsagen.length = 0;

  const K = 'fx:karl';                       // ein Bestandsspieler mit Vorgeschichte
  db.setActivity(W, K, 'fishing', 600, 1000);
  db.setActivity(W, K, 'job', 300, 1000);
  const vorher = db.listMessages(W, K).total;

  const nachgetragen = await ach.backfill(W, K);
  check('der Nachtrag vergibt mehrere Erfolge auf einmal', nachgetragen >= 6,
    String(nachgetragen));
  check('aber KEINE Durchsage', durchsagen.length === 0, JSON.stringify(durchsagen));
  check('und kein Postfach-Eintrag', db.listMessages(W, K).total === vorher,
    `${vorher} -> ${db.listMessages(W, K).total}`);
  check('die Erfolge sind trotzdem da',
    db.achievementsOf(W, K).some((r) => r.ach_id === 'fish_500'));
  check('ein zweiter Nachtrag tut nichts mehr', (await ach.backfill(W, K)) === 0);

  console.log('--- Serverweiter Nachtrag geht an den Stärksten ---');
  // Zwei Konten erfüllen "Der erste Malocher". Der mit den meisten Schichten
  // soll ihn bekommen – nicht der, der zufällig zuerst geprüft wird.
  const W2 = `${W}_B`;
  db.setActivity(W2, 'fx:wenig', 'job', 260, 1000);
  db.setActivity(W2, 'fx:viel', 'job', 900, 1000);
  const postfachVorher = db.listMessages(W2, 'fx:viel').total;

  // Die Konten werden ausdrücklich übergeben – so hängt der Test nicht an
  // networth.owners und damit nicht am Besitz in einer fremden Welt.
  await ach.backfillWorld(W2, ['fx:wenig', 'fx:viel']);
  const tafel2 = db.allFirsts(W2).find((r) => r.ach_id === 'srv_worker');
  check('der mit den meisten Schichten hält ihn', tafel2?.user_id === 'fx:viel',
    JSON.stringify(tafel2));
  check('auch der serverweite Nachtrag war lautlos', durchsagen.length === 0,
    JSON.stringify(durchsagen));
  check('und ohne Postfach-Eintrag',
    db.listMessages(W2, 'fx:viel').total === postfachVorher,
    `${postfachVorher} -> ${db.listMessages(W2, 'fx:viel').total}`);
  check('ohne Daten kein Nachtrag: der perfekte Coup bleibt frei',
    !db.allFirsts(W2).some((r) => r.ach_id === 'srv_heist'));

  console.log('--- Der Umzug wirkt auch im laufenden Betrieb ---');
  const N = 'fx:norbert';
  // Ohne Umzug in der Akte passiert nichts – auch wenn das Ereignis kommt.
  await ach.fire(W, N, 'move', { country: 'es' });
  check('ohne Umzug in der Akte kein Erfolg',
    !db.achievementsOf(W, N).some((r) => r.ach_id === 'move_1'));

  // db.setHome vermerkt den Umzug; erst danach greift die Regel.
  db.setHome(W, N, 'es', { move: true, at: Date.now() });
  await ach.fire(W, N, 'move', { country: 'es' });
  check('nach dem Umzug greift move_1',
    db.achievementsOf(W, N).some((r) => r.ach_id === 'move_1'),
    JSON.stringify(db.achievementsOf(W, N)));

  console.log('--- Der Andockpunkt an der Geldbuchung ---');
  // Ab hier wieder die echte Buchung: Sie ruft countActivity auf, und genau
  // das ist der Andockpunkt, der hier geprüft wird. Für `fx:`-Konten läuft
  // sie über das lokale Wallet, also ohne Netz (§12).
  unb.changeCash = echtesChangeCash;

  const L = 'fx:lena';
  await unb.changeCash(W, L, 500, 'Schicht', { kind: 'job' });
  check('eine Buchung mit kind vergibt den Erfolg',
    db.achievementsOf(W, L).some((r) => r.ach_id === 'job_1'),
    JSON.stringify(db.achievementsOf(W, L)));

  const M = 'fx:mia';
  await unb.changeCash(W, M, 500, 'Storno', { kind: 'job', xp: false });
  check('eine Stornobuchung vergibt nichts', db.achievementsOf(W, M).length === 0);

  console.log('--- Die Ansicht ---');
  const liste = await ach.listFor(W, K);
  check('geholte und offene Erfolge sind getrennt',
    liste.geholt.length > 0 && liste.offen.length > 0,
    `${liste.geholt.length} / ${liste.offen.length}`);
  check('zusammen sind es alle privaten', liste.gesamt === 37, String(liste.gesamt));
  check('keiner steht in beiden Listen',
    !liste.geholt.some((g) => liste.offen.some((o) => o.id === g.id)));

  const offenMitZiel = liste.offen.find((r) => r.progress);
  check('offene Erfolge zeigen Fortschritt als [ist, soll]',
    Array.isArray(offenMitZiel?.progress) && offenMitZiel.progress.length === 2,
    JSON.stringify(offenMitZiel?.progress));
  check('und der Fortschritt liegt unter dem Ziel',
    offenMitZiel.progress[0] < offenMitZiel.progress[1],
    JSON.stringify(offenMitZiel.progress));

  const tafel3 = ach.board(W);
  check('die Ehrentafel listet alle serverweiten', tafel3.length === 15, String(tafel3.length));
  check('vergebene nennen den Halter',
    tafel3.find((e) => e.rule.id === 'srv_worker')?.userId === 'fx:emil');
  check('unerreichte bleiben leer',
    tafel3.find((e) => e.rule.id === 'srv_origin')?.userId === null);

  const ui = require('../src/achievementsUi');
  const ansicht = await ui.buildAchievementsView({ guildId: W, userId: K });
  check('die Ansicht baut ein Embed', ansicht.embeds?.length === 1);
  const text = JSON.stringify(ansicht.embeds[0].toJSON());
  check('sie nennt den Zähler', /\d+\s*\/\s*37/.test(text), text.slice(0, 200));
  check('und keine rohe Konto-ID', !text.includes('fx:karl'), text.slice(0, 200));

  // Anton hält srv_millionaire aus dem allerersten Abschnitt (claimFirst
  // oben) – ein Konto, das nachweislich einen serverweiten Erfolg hat.
  const tafelAnsicht = await ui.buildBoardView({ guildId: W, userId: A });
  check('die Ehrentafel baut ein Embed', tafelAnsicht.embeds?.length === 1);
  const tafelText = JSON.stringify(tafelAnsicht.embeds[0].toJSON());
  check('alle 15 serverweiten Erfolge stehen drin',
    tafel3.every((e) => tafelText.includes(e.rule.title)),
    tafelText.slice(0, 200));
  check('der Halter steht nicht als rohe Konto-ID da', !tafelText.includes(A), tafelText.slice(0, 200));
  check('unerreichte zeigen "noch niemand"', tafelText.includes('noch niemand'), tafelText.slice(0, 200));
  check('kein Feld sprengt Discords 1024-Zeichen-Grenze',
    tafelAnsicht.embeds[0].toJSON().fields.every((f) => f.value.length <= 1024),
    JSON.stringify(tafelAnsicht.embeds[0].toJSON().fields.map((f) => f.value.length)));

  console.log('--- Erfolgstitel reihen sich in die vorhandenen ein ---');
  const titel = ach.titlesFor(W, K);
  check('nur Gold, Platin und serverweit sind Titel',
    titel.every((t) => {
      const r = ach.byId(t.id.slice(4));
      return r.scope === 'server' || r.tier === 'gold' || r.tier === 'platin';
    }), JSON.stringify(titel));
  check('Karls Fischerkönig ist dabei',
    titel.some((t) => t.id === 'ach:fish_500'), JSON.stringify(titel));

  const activity2 = require('../src/activity');
  check('der Titel lässt sich wählen', activity2.choose(W, K, 'ach:fish_500') === true);
  const getragen = activity2.titleOf(W, K);
  check('und steht dann im Profil',
    getragen?.title === 'Fischerkönig', JSON.stringify(getragen));
  check('als selbst gewählt markiert', getragen?.chosen === true);

  check('ein nicht verdienter Erfolgstitel wird abgelehnt',
    activity2.choose(W, K, 'ach:srv_origin') === false);
  activity2.choose(W, K, '');

  console.log(`\n${pass} bestanden, ${fail} fehlgeschlagen`);
  process.exit(fail === 0 ? 0 : 1);
})();
