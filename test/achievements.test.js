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

  console.log(`\n${pass} bestanden, ${fail} fehlgeschlagen`);
  process.exit(fail === 0 ? 0 : 1);
})();
