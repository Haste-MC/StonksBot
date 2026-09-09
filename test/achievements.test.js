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

  // Der stille Nachtrag (A3-Fix) läuft sonst automatisch VOR dieser Prüfung
  // an und würde fish_1/fish_100 schon selbst vergeben – dieser Test will
  // aber gezielt den `kind`-Andockpunkt in `check()` sehen, nicht das
  // Zusammenspiel mit einem taufrischen, nie nachgetragenen Konto (das
  // deckt die eigene A3-Prüfung weiter unten ab).
  await ach.backfill(W, C);
  db.setActivity(W, C, 'fishing', 100, 1000);
  const ersteRunde = await ach.onActivity(W, C, 'fishing');
  const idsRunde = ersteRunde.map((r) => r.id).sort();
  check('Bronze und Silber gehen zusammen raus',
    idsRunde.join(',') === 'fish_1,fish_100', idsRunde.join(','));
  check('beim zweiten Mal nichts mehr',
    (await ach.onActivity(W, C, 'fishing')).length === 0);
  check('§3: kein einziger Geldaufruf', geldAufrufe === 0, String(geldAufrufe));

  console.log('--- §7: die Zeile steht vor dem ersten await ---');
  // D hat den stillen Nachtrag (A3-Fix) schon hinter sich – genau wie ein
  // Konto, das vorher einmal die Ansicht geöffnet hat. Nur dann bleibt
  // `onActivity` bis zum `check()` synchron; auf einem wirklich frischen
  // Konto müsste `onActivity` selbst erst den Nachtrag abwarten (siehe die
  // A3-Prüfung weiter unten, die genau diesen Fall abdeckt).
  await ach.backfill(W, D);
  db.setActivity(W, D, 'fishing', 1, 1000);
  const laeuft = ach.onActivity(W, D, 'fishing');
  check('schon vor dem Auflösen in der Datenbank',
    db.achievementsOf(W, D).some((r) => r.ach_id === 'fish_1'));
  await laeuft;

  console.log('--- Serverweit: genau einer, der andere geht leer aus ---');
  const E = 'fx:emil', F = 'fx:frida';
  // Beide vorab nachtragen (bei 0 Schichten – noch nichts zu holen), damit
  // dieser Test wie vor dem A3-Fix den `kind`-Andockpunkt selbst prüft.
  await ach.backfill(W, E);
  await ach.backfill(W, F);
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

  console.log('--- A1: Aktivitäten ohne `kind` an der Buchung lösen ihren Erfolg trotzdem aus ---');
  // rent_1, rob_10 und casino_1 hängen an Aktivitäten, die BEWUSST ohne
  // `kind` buchen (robbery.js, tenants.js, casinoPlay.js) und darum nie über
  // unb.countActivity liefen. Der Andockpunkt sitzt jetzt in
  // `activity.record` selbst – dort laufen alle drei ebenso durch wie der
  // Buchungspfad.
  // `activity.record` ruft den Erfolgs-Andockpunkt fire-and-forget auf
  // (genau wie in der Produktion, siehe robbery.js & Co.) – ohne den
  // Vorab-Nachtrag müsste `onActivity` selbst noch den stillen Nachtrag
  // abwarten (A3-Fix), und die Prüfung direkt im Anschluss ohne jedes
  // `await` wäre reine Glückssache. Bei 0 Vorkommen gibt es dabei nichts
  // nachzutragen, nur die Markierung wird gesetzt.
  const RAEUBER = 'fx:raeuber';
  await ach.backfill(W, RAEUBER);
  db.setActivity(W, RAEUBER, 'rob', 9, Date.now());
  activity.record(W, RAEUBER, 'rob');
  check('der zehnte Überfall löst rob_10 aus',
    db.achievementsOf(W, RAEUBER).some((r) => r.ach_id === 'rob_10'),
    JSON.stringify(db.achievementsOf(W, RAEUBER)));

  const VERMIETER = 'fx:vermieter';
  await ach.backfill(W, VERMIETER);
  activity.record(W, VERMIETER, 'landlord');
  check('die erste Mieteinnahme löst rent_1 aus',
    db.achievementsOf(W, VERMIETER).some((r) => r.ach_id === 'rent_1'),
    JSON.stringify(db.achievementsOf(W, VERMIETER)));

  const ZOCKER = 'fx:zocker';
  await ach.backfill(W, ZOCKER);
  activity.record(W, ZOCKER, 'casino');
  check('die erste Casino-Runde löst casino_1 aus',
    db.achievementsOf(W, ZOCKER).some((r) => r.ach_id === 'casino_1'),
    JSON.stringify(db.achievementsOf(W, ZOCKER)));

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

  console.log('--- B1: listFor bekommt das Vermögen übergeben statt es zu holen ---');
  // `listFor` baut intern `stateCtx` – ohne übergebenes Vermögen holt das
  // `networth.of` per HTTP nach. Das Profil hat das Vermögen aber schon
  // zehn Zeilen darüber berechnet; ein zweiter Roundtrip im Renderpfad wäre
  // reine Verschwendung.
  const BILANZ = 'fx:bilanzprobe';
  let worthAufrufeListFor = 0;
  networth.of = async (...a) => { worthAufrufeListFor++; return echtesOf(...a); };
  await ach.listFor(W, BILANZ, { total: 123_456 });
  check('kein Networth-Aufruf, wenn das Vermögen schon übergeben wird',
    worthAufrufeListFor === 0, String(worthAufrufeListFor));
  networth.of = echtesOf;

  console.log('--- B2: state() rechnet das Vermögen nur, wenn noch etwas offen ist ---');
  // Ein Konto mit JEDEM state-Erfolg soll für einen Menü-Aufruf keinen
  // Netzwerk-Roundtrip fürs Vermögen mehr bezahlen – `state()` prüft das
  // billig über `achievementsOf`, bevor es `stateCtx` überhaupt baut.
  const VOLL = 'fx:vollstaendig';
  for (const regel of ach.RULES.filter((r) => r.on === 'state')) {
    db.awardAchievement(W, VOLL, regel.id, Date.now());
  }
  let worthAufrufeState = 0;
  networth.of = async (...a) => { worthAufrufeState++; return echtesOf(...a); };
  await ach.state(W, VOLL, null);
  check('kein Networth-Aufruf mehr, wenn schon alle state-Erfolge geholt sind',
    worthAufrufeState === 0, String(worthAufrufeState));
  networth.of = echtesOf;

  console.log('--- Meldungen: leise unten, laut oben ---');
  const relay = require('../src/relay');
  const durchsagen = [];
  relay.broadcast = async (text, opts = {}) => { durchsagen.push({ text, ...opts }); return ['discord']; };
  require('../src/currency').getSymbol = async () => '🪙';

  const H = 'fx:heinz';
  // Vorab nachtragen (bei 0 Fängen – noch nichts zu holen), damit die
  // erste Bronze-Meldung gleich unten wirklich aus `check()` kommt und
  // nicht schon vom automatischen Nachtrag lautlos vorweggenommen wird.
  await ach.backfill(W, H);
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
  // Vorab nachtragen (bei 0 Fängen), sonst würde der automatische Nachtrag
  // fish_1/100/500 schon lautlos selbst vergeben, bevor `check()` überhaupt
  // drankommt – der Witz dieses Tests ist aber gerade `check()` plus ein
  // kaputtes `relay.broadcast`, nicht der Nachtrag (der ruft `report()` nie
  // auf und bräuchte diesen Test also gar nicht).
  await ach.backfill(W, J);
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

  console.log('--- A3: der stille Nachtrag greift auch über den Buchungspfad ---');
  // Bisher lief `backfill()` nur aus den Ansichten (ui.js). Ein
  // Bestandsspieler, der nach dem Update zuerst arbeitet statt ins Menü zu
  // schauen, bekäme sonst beim allerersten Ereignis die volle Meldungswelle
  // statt gar keine. `onActivity` trägt jetzt selbst lautlos nach, BEVOR es
  // seinen eigenen Andockpunkt prüft.
  durchsagen.length = 0;
  const OHNE_ANSICHT = 'fx:unsichtbar';
  db.setActivity(W, OHNE_ANSICHT, 'fishing', 600, 1000);
  const postfachVorherA3 = db.listMessages(W, OHNE_ANSICHT).total;
  await ach.onActivity(W, OHNE_ANSICHT, 'fishing');
  check('keine Durchsage beim allerersten Ereignis ohne vorherigen Ansichtsbesuch',
    durchsagen.length === 0, JSON.stringify(durchsagen));
  check('kein Postfach-Eintrag',
    db.listMessages(W, OHNE_ANSICHT).total === postfachVorherA3,
    `${postfachVorherA3} -> ${db.listMessages(W, OHNE_ANSICHT).total}`);
  check('die Erfolge sind trotzdem vergeben',
    ['fish_1', 'fish_100', 'fish_500'].every((id) =>
      db.achievementsOf(W, OHNE_ANSICHT).some((r) => r.ach_id === id)),
    JSON.stringify(db.achievementsOf(W, OHNE_ANSICHT)));

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

  console.log('--- A2: der Welt-Nachtrag läuft aus dem Profil, nicht zufällig aus der ersten Ansicht ---');
  // Ohne den Aufruf in buildProfileView ginge ein serverweiter Erfolg an den,
  // der zufällig zuerst hinschaut – nicht an den stärksten Kandidaten. Beide
  // Konten bekommen ein Fundstück, das für `srv_godlike` reicht (Rang
  // "godlike oder besser"); der Fund mit dem höheren Rang muss gewinnen. Die
  // Fundstücke landen in `storage_loot`, darüber findet `networth.owners()`
  // (also `db.assetOwners()`) beide Konten von selbst – kein expliziter
  // Konten-Parameter wie in den Tests oben nötig.
  const WA2 = `${W}_A2`;
  const SCHWACH = 'fx:schwach', STARK = 'fx:stark';
  db.addLoot(WA2, SCHWACH, 'Fund', 1000, 'godlike', 'normal', null);
  db.addLoot(WA2, STARK, 'Fund', 1000, 'cosmic', 'normal', null);

  // A1-Fix: `buildProfileView` wartet nicht mehr auf `backfillWorld` (sonst
  // würde die erste Profilansicht nach dem Deploy an Discords 3-Sekunden-
  // Fenster scheitern, siehe Prüfbericht). Der Welt-Nachtrag läuft jetzt im
  // Hintergrund weiter.
  //
  // A3-Fix: Der Anstoß sitzt jetzt in `achievements.state()` selbst, nicht
  // mehr in `buildProfileView` – ein Aufruf innerhalb DESSELBEN Moduls, den
  // ein Monkeypatch von außen (wie vorher hier) nicht mehr abfangen kann.
  // Für DIESEN Test (der genau das Vergleichsergebnis prüft) reicht es,
  // aktiv auf den Fertig-Marker zu warten, statt eine bestimmte Aufrufstelle
  // abzufangen – alles hier ist lokal und ohne Netz (§12), also kurze,
  // wiederholte `setImmediate`-Sprünge statt eines festen Timeouts.
  await require('../src/ui').buildProfileView({ guildId: WA2, userId: SCHWACH });
  for (let i = 0; i < 200 && !db.getClaim(WA2, '*', 'ach_backfill_world_fertig'); i++) {
    await new Promise((r) => setImmediate(r));
  }
  check('der Welt-Nachtrag ist nach dem Profilaufruf tatsächlich fertig geworden',
    Boolean(db.getClaim(WA2, '*', 'ach_backfill_world_fertig')));

  const inhaberA2 = db.allFirsts(WA2).find((r) => r.ach_id === 'srv_godlike');
  check('nach dem Profilaufruf für das schwächere Konto hält das stärkere den serverweiten Erfolg',
    inhaberA2?.user_id === STARK, JSON.stringify(inhaberA2));

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
  // Der stille Nachtrag (A3-Fix) ist schon gelaufen – wie bei D im §7-Test
  // oben geht es hier um den `kind`-Andockpunkt selbst, nicht um das
  // Zusammenspiel mit einem allerersten, noch nie nachgetragenen Konto (das
  // deckt die eigene A3-Prüfung weiter oben ab).
  await ach.backfill(W, L);
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

  console.log('--- Abzeichen fürs Profil: privat UND serverweit (badgesFor) ---');
  // Emil (E) hat aus dem Abschnitt "Serverweit: genau einer" sowohl private
  // Erfolge (job_1, job_50, job_250) als auch den serverweiten srv_worker –
  // ein bekanntes Konto mit genau der Mischung, die das Profil braucht.
  const abzeichenEmil = ach.badgesFor(W, E, 5);
  check('der serverweite Erfolg steht an erster Stelle',
    abzeichenEmil[0]?.id === 'srv_worker' && abzeichenEmil[0]?.scope === 'server',
    JSON.stringify(abzeichenEmil));

  // Karl (K) hat aus dem Nachtrag Bronze/Silber/Gold sowohl bei Job als auch
  // beim Angeln. Für Platin gibt es bei ihm keine Vorgeschichte – ein
  // direkter Award (wie schon ganz oben in dieser Datei für job_1) macht das
  // Konto vollständig, ohne eine neue Spielsituation zu erfinden.
  db.awardAchievement(W, K, 'castle', Date.now());
  const abzeichenKarl = ach.badgesFor(W, K, 20);
  check('Karl hat keinen serverweiten Erfolg (der ginge sonst vor)',
    !abzeichenKarl.some((b) => b.scope === 'server'), JSON.stringify(abzeichenKarl));
  const stufenIndex = (tier) => abzeichenKarl.findIndex((b) => b.tier === tier);
  check('unter den privaten steht Platin vor Gold',
    stufenIndex('platin') >= 0 && stufenIndex('platin') < stufenIndex('gold'),
    JSON.stringify(abzeichenKarl.map((b) => b.tier)));
  check('Gold steht vor Silber',
    stufenIndex('gold') < stufenIndex('silber'), JSON.stringify(abzeichenKarl.map((b) => b.tier)));
  check('Silber steht vor Bronze',
    stufenIndex('silber') < stufenIndex('bronze'), JSON.stringify(abzeichenKarl.map((b) => b.tier)));

  check('nie mehr Abzeichen als angefordert',
    ach.badgesFor(W, K, 3).length === 3 && ach.badgesFor(W, E, 1).length === 1);

  // Ein Konto ganz ohne Erfolge (aus dem Nachtrag-Regressionstest oben,
  // "kein einziger serverweiter Erfolg" / "überhaupt nichts vergeben").
  const abzeichenLeer = ach.badgesFor(WR2, R2, 3);
  check('ein Konto ohne Erfolge bekommt eine leere Liste statt einem Absturz',
    Array.isArray(abzeichenLeer) && abzeichenLeer.length === 0, JSON.stringify(abzeichenLeer));

  // Die leere Liste darf die Profilzeile nicht zum Kippen bringen.
  const uiMain = require('../src/ui');
  const profilOhneAbzeichen = await uiMain.buildProfileView({ guildId: WR2, userId: R2 });
  check('das Profil baut trotzdem ein Embed', profilOhneAbzeichen.embeds?.length === 1);

  /*
   * Ein Konto NUR mit einem serverweiten Erfolg, ganz ohne private – so lässt
   * sich beweisen, dass die Abzeichenzeile im Profil wirklich aus badgesFor()
   * kommt (das kennt serverweite Erfolge) und nicht mehr aus listFor() (das
   * kennt nur private, siehe "Emil" oben: dessen job_250 trägt zufällig
   * dasselbe Emoji wie sein serverweiter Erfolg – ein Konto ohne private
   * Erfolge umgeht diese Verwechslung). Reiner db.awardAchievement-Aufruf wie
   * schon bei Karls 'castle' oben, ohne neue Spielsituation zu erfinden;
   * db.claimFirst braucht es hier nicht, denn badgesFor() liest nur
   * db.achievementsOf(), nicht die Ehrentafel.
   */
  const P = 'fx:preisverdaechtig';
  db.awardAchievement(W, P, 'srv_millionaire', Date.now());
  const profilMitAbzeichen = await uiMain.buildProfileView({ guildId: W, userId: P });
  const profilAbzeichenText = JSON.stringify(profilMitAbzeichen.embeds[0].toJSON());
  check('das Profil zeigt das Abzeichen des serverweiten Erfolgs (👑 Der erste Millionär)',
    profilAbzeichenText.includes('👑'), profilAbzeichenText.slice(0, 300));

  const ui = require('../src/achievementsUi');
  const ansicht = await ui.buildAchievementsView({ guildId: W, userId: K });
  check('die Ansicht baut ein Embed', ansicht.embeds?.length === 1);
  const text = JSON.stringify(ansicht.embeds[0].toJSON());
  check('sie nennt den Zähler', /\d+\s*\/\s*37/.test(text), text.slice(0, 200));
  check('und keine rohe Konto-ID', !text.includes('fx:karl'), text.slice(0, 200));

  console.log('--- C1: Serverweite Erfolge stehen zusätzlich in "Meine Erfolge" ---');
  // Anton hält srv_millionaire aus dem allerersten Abschnitt (claimFirst
  // oben). `listFor` filtert bewusst auf privat (wegen der
  // Fortschrittsanzeige) – der serverweite Erfolg muss trotzdem in der
  // eigenen Ansicht auftauchen, nicht nur auf der Ehrentafel.
  const ansichtAnton = await ui.buildAchievementsView({ guildId: W, userId: A });
  const antonText = JSON.stringify(ansichtAnton.embeds[0].toJSON());
  check('der serverweite Erfolg steht im Embed',
    antonText.includes('Der erste Millionär') && antonText.includes('👑'),
    antonText.slice(0, 300));

  // Auch für die Ehrentafel unten: Anton ist nachweislich ein Konto mit
  // einem serverweiten Erfolg.
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

  console.log('--- Titel-Menü: faire Aufteilung statt stillem Abschneiden ---');
  /*
   * Alle 12 Aktivitäten UND acht Gold-Erfolge auf einem Konto – zusammen 20
   * Titel, mehr als die 16 Plätze im Menü. Vorher gewannen die Aktivitäten
   * immer, jetzt bekommt jede Seite mindestens die Hälfte.
   */
  const VIEL = 'fx:vielseitig';
  const now = Date.now();
  for (const kind of activity2.KINDS.map((k) => k.id)) db.setActivity(W, VIEL, kind, 50, now);
  const goldIds = ['job_250', 'worth_1m', 'car_500k', 'realty_1m',
    'heist_clean', 'casino_100k', 'depot_250k', 'coll_100k'];
  for (const id of goldIds) db.awardAchievement(W, VIEL, id, now);

  const vieleTitel = await uiMain.buildTitleView({ guildId: W, userId: VIEL });
  const vieleButtons = vieleTitel.components.flatMap((r) => r.toJSON().components);
  /*
   * 12 Aktivitäts- und 8 Erfolgstitel (20 zusammen) auf 16 Plätze: Bei
   * fairer Aufteilung bekommt jede Seite die Hälfte, also genau 8
   * Erfolgstitel-Knöpfe. Der alte, unfaire Algorithmus (Aktivitäten zuerst,
   * Rest abgeschnitten) ließe hier nur 4 übrig – "mindestens einer" hätte
   * das nicht bemerkt, die genaue Zahl schon.
   */
  const erfolgsKnoepfeViel = vieleButtons.filter((b) => b.custom_id.includes('ach:'));
  check('bei fairer Aufteilung bekommen die Erfolgstitel die Hälfte der 16 Plätze (8 von 8)',
    erfolgsKnoepfeViel.length === 8,
    erfolgsKnoepfeViel.map((b) => b.custom_id).join(', ') || '(keine)');
  check('der Hinweis auf gekürzte Titel steht in der Beschreibung',
    vieleTitel.embeds[0].toJSON().description.includes('nicht mehr ins Menü'),
    vieleTitel.embeds[0].toJSON().description);

  // Zum Vergleich: ein Konto mit wenigen Titeln braucht keinen Hinweis.
  const WENIG = 'fx:wenigtitel';
  db.setActivity(W, WENIG, 'job', 5, now);
  const wenigTitel = await uiMain.buildTitleView({ guildId: W, userId: WENIG });
  check('ohne Kürzung steht der Hinweis auch nicht da',
    !wenigTitel.embeds[0].toJSON().description.includes('nicht mehr ins Menü'),
    wenigTitel.embeds[0].toJSON().description);

  console.log('--- Block A: die erste Profilansicht nach dem Deploy darf nicht kippen ---');
  // Viele Besitzer, damit `backfillWorld` (ohne den Fix: streng sequenziell,
  // eine Guthabenabfrage je Besitzer) etwas zum Abarbeiten hätte. Der Test
  // beweist gerade, dass davon NICHTS mehr in den synchronen Ablauf von
  // `buildProfileView` hineinragt.
  const WBURST = `${W}_BURST`;
  const BURST_OWNER = 'fx:burst_owner';
  for (let i = 0; i < 8; i++) db.addLoot(WBURST, `fx:burst_${i}`, 'Fund', 1000, 'common', 'normal', null);
  db.addLoot(WBURST, BURST_OWNER, 'Fund', 1000, 'common', 'normal', null);
  // Der eigene (private) Nachtrag des Betrachters ist schon gelaufen – dieser
  // Test prüft gezielt den WELT-Nachtrag, nicht das Zusammenspiel mit einem
  // taufrischen eigenen Konto (das deckt Block B weiter oben ab).
  await ach.backfill(WBURST, BURST_OWNER);

  const echtesGetBalance = unb.getBalance;
  let balanceAufrufe = 0;
  unb.getBalance = async (...a) => { balanceAufrufe++; return echtesGetBalance(...a); };
  await uiMain.buildProfileView({ guildId: WBURST, userId: BURST_OWNER });
  unb.getBalance = echtesGetBalance;
  check('buildProfileView löst höchstens eine Guthabenabfrage aus, auch mit vielen '
    + 'Besitzern und ohne gelaufenen Welt-Nachtrag', balanceAufrufe <= 1, String(balanceAufrufe));

  console.log('--- Block A: der Wettlauf um serverweite Erfolge ist gesperrt, bis der Welt-Nachtrag fertig ist ---');
  const WRACE = `${W}_RACE`;
  const RACE1 = 'fx:race1';
  // Das Vermögen wird direkt übergeben (wie `state()` es von der Ansicht
  // erwartet) – kein Netz nötig, um gezielt die Sperre zu prüfen.
  await ach.state(WRACE, RACE1, { total: 2_000_000 });
  check('private state-Erfolge werden trotzdem vergeben',
    db.achievementsOf(WRACE, RACE1).some((r) => r.ach_id === 'worth_100k'),
    JSON.stringify(db.achievementsOf(WRACE, RACE1)));
  check('der serverweite Erfolg wird OHNE Fertig-Marker NICHT vergeben, obwohl die Bedingung erfüllt ist',
    !db.achievementsOf(WRACE, RACE1).some((r) => r.ach_id === 'srv_millionaire'),
    JSON.stringify(db.achievementsOf(WRACE, RACE1)));
  check('und auch nicht auf der Ehrentafel reserviert',
    !db.allFirsts(WRACE).some((r) => r.ach_id === 'srv_millionaire'), JSON.stringify(db.allFirsts(WRACE)));

  // A3-Fix: `state()` stößt `backfillWorld` inzwischen SELBST an (fire-and-
  // forget), sobald der Fertig-Marker fehlt – der Aufruf oben (Zeile 650) hat
  // ihn also schon losgeschickt, intern und darum nicht mehr per Monkeypatch
  // abfangbar (siehe die A2-Prüfung weiter oben, die das schon umgestellt
  // hat). Ein zweiter, expliziter Aufruf hier wäre bei einer leeren Welt
  // harmlos, aber nicht mehr nötig, um ihn abzuschließen: Warten reicht, um
  // zu zeigen, dass er ganz von allein fertig wird.
  for (let i = 0; i < 200 && !db.getClaim(WRACE, '*', 'ach_backfill_world_fertig'); i++) {
    await new Promise((r) => setImmediate(r));
  }
  check('backfillWorld ist über state() selbst angelaufen, ganz ohne expliziten Aufruf',
    Boolean(db.getClaim(WRACE, '*', 'ach_backfill_world_fertig')));

  await ach.state(WRACE, RACE1, { total: 2_000_000 });
  check('nach backfillWorld (Fertig-Marker gesetzt) vergibt state() serverweite Erfolge wieder normal',
    db.achievementsOf(WRACE, RACE1).some((r) => r.ach_id === 'srv_millionaire'),
    JSON.stringify(db.achievementsOf(WRACE, RACE1)));

  const WRACE2 = `${W}_RACE2`;
  const RACE2 = 'fx:race2';
  await ach.backfill(WRACE2, RACE2);
  db.setActivity(WRACE2, RACE2, 'job', 250, Date.now());
  const raceFrisch = await ach.onActivity(WRACE2, RACE2, 'job');
  check('onActivity vergibt serverweite Erfolge auch OHNE Fertig-Marker – eine Tat zählt immer',
    raceFrisch.some((r) => r.id === 'srv_worker'), raceFrisch.map((r) => r.id).join(','));
  check('WRACE2 hat wirklich (noch) keinen Fertig-Marker (Kontrolle)',
    !db.getClaim(WRACE2, '*', 'ach_backfill_world_fertig'));

  console.log('--- A1: backfillWorld sperrt sich nach einem Absturz nicht mehr selbst aus ---');
  // Bricht der Welt-Nachtrag mittendrin ab (hier: `networth.owners()` wirft,
  // wie es auch aus einem Getter in baseCtx oder aus rule.measure(ctx)
  // passieren könnte), verhinderte der Start-Marker bisher jeden weiteren
  // Versuch, während der Fertig-Marker nie kam – sechs serverweite Erfolge
  // wären für diese Welt für immer verloren, heilbar nur per
  // Datenbankeingriff.
  const WA1 = `${W}_A1FAIL`;
  const networthMod = require('../src/networth');
  const echtesOwners = networthMod.owners;
  networthMod.owners = () => { throw new Error('kaputt: owners()'); };

  await ach.backfillWorld(WA1).catch(() => {});
  check('nach einem Absturz ist der Start-Marker WIEDER WEG',
    !db.getClaim(WA1, '*', 'ach_backfill_world'));
  check('und der Fertig-Marker ist (noch) nicht da',
    !db.getClaim(WA1, '*', 'ach_backfill_world_fertig'));

  networthMod.owners = echtesOwners;
  const zweiterVersuchA1 = await ach.backfillWorld(WA1);
  check('ein zweiter Aufruf läuft danach wieder ganz normal los',
    typeof zweiterVersuchA1 === 'number', String(zweiterVersuchA1));
  check('und bringt die Arbeit diesmal zu Ende (Fertig-Marker gesetzt)',
    Boolean(db.getClaim(WA1, '*', 'ach_backfill_world_fertig')));

  const RACE_A1 = 'fx:race_a1';
  await ach.state(WA1, RACE_A1, { total: 2_000_000 });
  check('state() vergibt nach dem geheilten Welt-Nachtrag wieder serverweite Erfolge',
    db.achievementsOf(WA1, RACE_A1).some((r) => r.ach_id === 'srv_millionaire'),
    JSON.stringify(db.achievementsOf(WA1, RACE_A1)));

  console.log('--- A1: eine einzelne kaputte measure-Funktion reißt die übrigen Regeln nicht mit ---');
  // `measure` stand vorher AUSSERHALB des try, das `test` umgibt – ein Wurf
  // dort riss den GESAMTEN Welt-Nachtrag ab, nicht nur den einen Kandidaten
  // oder die eine Regel.
  const WA1M = `${W}_A1MEASURE`;
  const STARK_A1 = 'fx:stark_a1';
  db.setActivity(WA1M, STARK_A1, 'job', 900, 1000);        // erfüllt srv_worker
  const walletA1M = require('../src/wallet');
  await walletA1M.changeCash(WA1M, STARK_A1, 2_000_000, 'Testkapital', { xp: false });

  const srvMillionaireRegel = ach.RULES.find((r) => r.id === 'srv_millionaire');
  const echteMeasure = srvMillionaireRegel.measure;
  srvMillionaireRegel.measure = () => { throw new Error('kaputte measure'); };

  // `unb.getBalance` steht seit dem §3-Aufwärmen ganz oben auf einem Mock,
  // der immer eine leere Bilanz liefert – ohne die kurze Umleitung auf die
  // echte, lokale Wallet bliebe `ctx.worth` bei 0 und `srv_millionaire`s
  // `test()` würde nie zutreffen, womit die (absichtlich kaputte) `measure`
  // NIE aufgerufen würde und dieser Test gar nichts prüfte.
  const echtesGetBalanceMockA1M = unb.getBalance;
  unb.getBalance = (...a) => walletA1M.getBalance(...a);
  let a1mFehler = null;
  try { await ach.backfillWorld(WA1M, [STARK_A1]); }
  catch (e) { a1mFehler = e; }
  unb.getBalance = echtesGetBalanceMockA1M;
  srvMillionaireRegel.measure = echteMeasure;

  check('backfillWorld wirft NICHT, obwohl eine measure-Funktion kaputt ist',
    a1mFehler === null, String(a1mFehler));
  check('eine andere serverweite Regel wird trotzdem ganz normal vergeben (srv_worker)',
    db.allFirsts(WA1M).some((r) => r.ach_id === 'srv_worker'),
    JSON.stringify(db.allFirsts(WA1M)));
  check('srv_millionaire selbst bleibt wegen der kaputten measure unvergeben, statt den Rest mitzureißen',
    !db.allFirsts(WA1M).some((r) => r.ach_id === 'srv_millionaire'),
    JSON.stringify(db.allFirsts(WA1M)));
  check('und der Fertig-Marker ist trotzdem gesetzt',
    Boolean(db.getClaim(WA1M, '*', 'ach_backfill_world_fertig')));

  console.log('--- A2: activity.record kippt nicht, wenn die Erfolgs-Prüfung selbst wirft ---');
  // `require('./achievements')` und die Marker-Abfrage standen bisher
  // UNGESCHÜTZT vor jedem try/catch – ein Wurf dort würde `record` selbst
  // werfen. `record` hängt aber UNGESCHÜTZT an sieben Stellen, u.a.
  // robbery.js NACH dem Geldtransfer eines Überfalls und creator.js VOR der
  // Auszahlung einer Aktion: Ein Wurf hier dürfte niemals einen Überfall oder
  // eine Auszahlung kippen.
  const KONTOA2 = 'fx:kontoa2';
  const echtesGetClaimA2 = db.getClaim;
  db.getClaim = () => { throw new Error('db kaputt'); };

  let a2Wurf = false;
  let a2Ergebnis;
  try { a2Ergebnis = activity.record(W, KONTOA2, 'job'); }
  catch { a2Wurf = true; }
  db.getClaim = echtesGetClaimA2;

  check('activity.record wirft NICHT, wenn db.getClaim wirft', !a2Wurf);
  check('und liefert trotzdem true zurück', a2Ergebnis === true);
  check('der Strich wurde trotzdem gesetzt (die Strichliste hat Vorrang vor dem Erfolg)',
    db.activityOf(W, KONTOA2).some((r) => r.kind === 'job' && r.count >= 1),
    JSON.stringify(db.activityOf(W, KONTOA2)));

  console.log('--- A3: ein Aufbau der Startseite stößt den Welt-Nachtrag an, ganz ohne je ein Profil zu öffnen ---');
  const WHOME = `${W}_HOMEVIEW`;
  const HOMEOWNER = 'fx:homeowner';
  db.addLoot(WHOME, HOMEOWNER, 'Fund', 1000, 'common', 'normal', null);
  await require('../src/ui').buildHomeView({ guildId: WHOME, userId: HOMEOWNER });
  for (let i = 0; i < 200 && !db.getClaim(WHOME, '*', 'ach_backfill_world_fertig'); i++) {
    await new Promise((r) => setImmediate(r));
  }
  check('der Welt-Nachtrag lief, obwohl nie ein Profil geöffnet wurde – nur die Startseite',
    Boolean(db.getClaim(WHOME, '*', 'ach_backfill_world_fertig')));

  console.log('--- Block B: neue Spieler verlieren ihren ersten Erfolg nicht mehr ---');
  const NEU1 = 'fx:neuling_b1';
  // Ein wirklich brandneues Konto, über `activity.record()` – nicht über
  // `ach.onActivity()` direkt: Genau die interne Reihenfolge von `record()`
  // (Nachtrag VOR `bumpActivity`) ist der Fix.
  activity.record(W, NEU1, 'job');
  // record() ist synchron und fire-and-forget für den Erfolgs-Andockpunkt –
  // kurz nachgeben, damit der Nachtrag im Hintergrund durchgelaufen ist.
  await new Promise((r) => setImmediate(r));
  check('die allererste Schicht eines brandneuen Kontos steht als "Erster Arbeitstag" im Postfach',
    db.listMessages(W, NEU1).items.some((m) => m.title.includes('Erster Arbeitstag')),
    JSON.stringify(db.listMessages(W, NEU1).items.map((m) => m.title)));

  const NEU2 = 'fx:neuling_b2';
  const storage = require('../src/storage');
  const garageB2 = db.addGarage(W, NEU2, 'Testgarage', 1000, {
    objects: [{ name: 'Kristallkugel', value: 500_000, rarity: 'cosmic', condition: 'gut' }],
    cash: 0, car: null,
  }, 500_000);
  durchsagen.length = 0;
  await storage.openGarage(W, NEU2, garageB2.id);
  await new Promise((r) => setImmediate(r));
  check('ein brandneues Konto, dessen erster Fund ein Cosmic ist, löst eine Durchsage für '
    + 'den Platin-Erfolg "Godlike" aus', durchsagen.some((d) => d.text.includes('Godlike')),
    JSON.stringify(durchsagen));

  console.log('--- Block B: ein Bestandskonto bleibt beim ersten Ereignis weiterhin lautlos (Regression) ---');
  const BESTAND = 'fx:bestand_b3';
  db.setActivity(W, BESTAND, 'job', 300, 1000);   // Vorgeschichte, nie eine Ansicht geöffnet
  durchsagen.length = 0;
  const postfachVorherB3 = db.listMessages(W, BESTAND).total;
  activity.record(W, BESTAND, 'job');
  await new Promise((r) => setImmediate(r));
  check('keine Durchsage beim ersten Ereignis eines Bestandskontos mit viel Vorgeschichte',
    durchsagen.length === 0, JSON.stringify(durchsagen));
  check('kein Postfach-Eintrag',
    db.listMessages(W, BESTAND).total === postfachVorherB3,
    `${postfachVorherB3} -> ${db.listMessages(W, BESTAND).total}`);
  check('der Nachtrag hat trotzdem alles Erfüllte vergeben',
    db.achievementsOf(W, BESTAND).some((r) => r.ach_id === 'job_250'),
    JSON.stringify(db.achievementsOf(W, BESTAND)));

  console.log('--- Block C1: der state()-Kurzschluss greift jetzt auch mit serverweiten Gegenstücken ---');
  const WSHORT = `${W}_SHORT`;
  const HALTER = 'fx:halter', VOLL2 = 'fx:vollstaendig2';
  // Die serverweiten Gegenstücke gehören einem ANDEREN Konto.
  for (const regel of ach.RULES.filter((r) => r.on === 'state' && r.scope === 'server')) {
    db.claimFirst(WSHORT, regel.id, HALTER, Date.now());
    db.awardAchievement(WSHORT, HALTER, regel.id, Date.now());
  }
  // VOLL2 selbst hat alle PRIVATEN state-Erfolge.
  for (const regel of ach.RULES.filter((r) => r.on === 'state' && r.scope === 'privat')) {
    db.awardAchievement(WSHORT, VOLL2, regel.id, Date.now());
  }
  let worthAufrufeShort = 0;
  networth.of = async (...a) => { worthAufrufeShort++; return echtesOf(...a); };
  await ach.state(WSHORT, VOLL2, null);
  check('kein Networth-Aufruf, wenn die serverweiten Gegenstücke einem anderen Konto gehören',
    worthAufrufeShort === 0, String(worthAufrufeShort));
  networth.of = echtesOf;

  console.log(`\n${pass} bestanden, ${fail} fehlgeschlagen`);
  process.exit(fail === 0 ? 0 : 1);
})();
