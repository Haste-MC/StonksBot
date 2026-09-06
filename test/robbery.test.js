/**
 * Tests für Überfälle und Rollen-Einkommen.
 *
 * Wichtigster Punkt: Ein Überfall ist reine UMVERTEILUNG. Was der eine bekommt,
 * verliert der andere – auf den Cent. Auch die Strafe bei Misserfolg geht ans
 * Opfer, statt zu verschwinden. Entstünde dabei Geld, wäre es ein Gelddrucker
 * (ARCHITEKTUR §3).
 *
 * Aufruf: npm run test:robbery
 */
process.env.WORLD_ID = 'TESTWORLD_ROB';
process.env.INCOME_ROLES = 'ROLLE_A:500,ROLLE_B:1500';
process.env.INCOME_INTERVAL_HOURS = '24';

const db = require('../src/db');
const wallet = require('../src/wallet');
const robbery = require('../src/robbery');
const roleIncome = require('../src/roleIncome');
const identity = require('../src/identity');

const W = identity.world();
let pass = 0, fail = 0;
const check = (label, ok, extra = '') => {
  if (ok) { pass++; console.log(`  ✅ ${label}`); }
  else { fail++; console.log(`  ❌ ${label} ${extra}`); }
};

let n = 0;
const player = async (cash) => {
  const id = `ROB_${Date.now()}_${n++}`;
  await wallet.getBalance(W, id);
  const now = (await wallet.getBalance(W, id)).cash;
  await wallet.changeCash(W, id, cash - now, 'Testaufbau');
  return id;
};
const cashOf = async (id) => (await wallet.getBalance(W, id)).cash;
const totalOf = async (id) => (await wallet.getBalance(W, id)).total;

(async () => {
  console.log('--- Regeln greifen ---');
  const a = await player(10000);
  check('sich selbst ausrauben geht nicht',
    (await robbery.rob(W, a, a)).reason === 'self');

  const arm = await player(100);
  const r1 = await robbery.rob(W, a, arm);
  check('zu armes Opfer wird geschützt', !r1.ok && r1.reason === 'victim_broke', r1.reason);
  check('kein Cooldown nach abgelehntem Versuch',
    robbery.remainingMs(W, a) === 0);

  const pleite = await player(0);
  const r2 = await robbery.rob(W, pleite, a);
  check('ohne eigenes Bargeld kein Überfall', !r2.ok && r2.reason === 'no_cash');

  console.log('--- Erfundene Ziele erzeugen kein Geld ---');
  /*
   * Ein lokaler Geldbeutel entsteht beim ersten Zugriff – mit Startkapital.
   * `!rob irgendeinname` hat ihn dadurch angelegt und sofort leergeräumt:
   * Geld aus dem Nichts, je erfundenem Namen einmal (ARCHITEKTUR §3).
   */
  const jäger = await player(10000);
  const vorherJ = await totalOf(jäger);
  const phantom = await robbery.rob(W, jäger, 'fx:GibtsGarNicht', Date.now(), () => 0.01);
  check('ein unbekanntes Ziel wird abgelehnt',
    !phantom.ok && phantom.reason === 'unknown_victim', JSON.stringify(phantom));
  check('und es entsteht kein Geld', (await totalOf(jäger)) === vorherJ);
  check('der Geldbeutel wurde gar nicht erst angelegt',
    db.hasWallet(W, 'fx:GibtsGarNicht') === false);
  check('auch kein Cooldown dafür verbraucht', robbery.remainingMs(W, jäger) === 0);

  console.log('--- Erfolgreicher Überfall: reine Umverteilung ---');
  const räuber = await player(5000);
  const opfer = await player(20000);
  const vorher = (await totalOf(räuber)) + (await totalOf(opfer));

  const win = await robbery.rob(W, räuber, opfer, Date.now(), () => 0.01); // erzwingt Erfolg
  check('Überfall gelingt', win.ok && win.success === true, JSON.stringify(win));
  // Wie bei UnbelievaBoat: alles oder nichts.
  check('das GANZE Bargeld ist weg', win.amount === 20000, String(win.amount));
  check('Räuber hat die Beute', (await cashOf(räuber)) === 5000 + 20000);
  check('das Opfer steht ohne Bargeld da', (await cashOf(opfer)) === 0);
  check('SUMME BEIDER KONTEN UNVERÄNDERT',
    (await totalOf(räuber)) + (await totalOf(opfer)) === vorher,
    `${(await totalOf(räuber)) + (await totalOf(opfer))} vs ${vorher}`);
  check('die Chance ist ein Münzwurf', win.chance === 0.5, String(win.chance));

  console.log('--- Die Bank ist die Antwort darauf ---');
  const sparer = await player(10000);
  await wallet.deposit(W, sparer, 9600, 'Test: einzahlen');   // 400 bar, Rest sicher
  const räuber2 = await player(5000);
  const nix = await robbery.rob(W, räuber2, sparer, Date.now(), () => 0.01);
  check('wer sein Geld einzahlt, ist unantastbar',
    !nix.ok && nix.reason === 'victim_broke', nix.reason);
  check('das Ersparte liegt unberührt da', (await totalOf(sparer)) === 10000);

  console.log('--- Cooldown ---');
  const wieder = await robbery.rob(W, räuber, opfer);
  check('sofortiger zweiter Versuch abgelehnt',
    !wieder.ok && wieder.reason === 'cooldown', wieder.reason);
  check('Restzeit wird gemeldet',
    wieder.remainingMs > 0 && wieder.remainingMs <= robbery.RULES.cooldownMs);
  await wallet.changeCash(W, opfer, 3000, 'Testaufbau');   // das Opfer hat wieder etwas
  const später = await robbery.rob(W, räuber, opfer,
    Date.now() + robbery.RULES.cooldownMs + 1000, () => 0.01);
  check('nach Ablauf wieder möglich', später.ok === true, später.reason ?? '');

  console.log('--- Fehlschlag: Strafe geht ans Opfer, verschwindet nicht ---');
  const r3 = await player(8000);
  const o3 = await player(15000);
  const vorher3 = (await totalOf(r3)) + (await totalOf(o3));
  const lose = await robbery.rob(W, r3, o3, Date.now(), () => 0.99); // erzwingt Misserfolg
  check('Überfall scheitert', lose.ok && lose.success === false, JSON.stringify(lose));
  check('Räuber zahlt die Strafe', (await cashOf(r3)) === 8000 - lose.penalty);
  check('Opfer bekommt sie', (await cashOf(o3)) === 15000 + lose.penalty);
  check('SUMME UNVERÄNDERT auch bei Misserfolg',
    (await totalOf(r3)) + (await totalOf(o3)) === vorher3);
  check('Strafe ist gedeckelt', lose.penalty <= robbery.RULES.maxPenalty,
    `${lose.penalty} vs ${robbery.RULES.maxPenalty}`);
  check('und der Deckel liegt bei 2.000', robbery.RULES.maxPenalty === 2000);

  console.log('--- Strafe: Bargeld oder Bank ist egal ---');
  /*
   * Wer alles einzahlt, kam vorher straffrei davon: Die Strafe hing am
   * Bargeld, und das war null. Jetzt zählt das Gesamtvermögen.
   */
  const schlau = await player(20000);
  await wallet.deposit(W, schlau, 20000, 'Test: alles auf die Bank');
  const o4 = await player(9000);
  const vorher4 = (await totalOf(schlau)) + (await totalOf(o4));
  const lose2 = await robbery.rob(W, schlau, o4, Date.now(), () => 0.99);
  check('auch ohne Bargeld wird bestraft',
    lose2.ok && lose2.success === false && lose2.penalty > 0, JSON.stringify(lose2));
  check('das Geld kommt von der Bank', (await totalOf(schlau)) === 20000 - lose2.penalty,
    String(await totalOf(schlau)));
  check('und landet beim Opfer', (await totalOf(o4)) === 9000 + lose2.penalty);
  check('die Summe stimmt weiterhin',
    (await totalOf(schlau)) + (await totalOf(o4)) === vorher4);

  console.log('--- Über viele Überfälle entsteht kein Geld ---');
  const x = await player(50000);
  const y = await player(50000);
  const start = (await totalOf(x)) + (await totalOf(y));
  let when = Date.now();
  for (let i = 0; i < 60; i++) {
    when += robbery.RULES.cooldownMs + 1000;
    await robbery.rob(W, i % 2 ? y : x, i % 2 ? x : y, when);
  }
  const ende = (await totalOf(x)) + (await totalOf(y));
  check('nach 60 Überfällen exakt dieselbe Summe', ende === start, `${ende} vs ${start}`);

  console.log('--- Erfahrung lässt sich nicht erfarmen ---');
  const xpBefore = db.getStats(W, x).xp + db.getStats(W, y).xp;
  when += robbery.RULES.cooldownMs + 1000;
  await robbery.rob(W, x, y, when, () => 0.01);
  check('ein Überfall vergibt keine Erfahrung',
    db.getStats(W, x).xp + db.getStats(W, y).xp === xpBefore);

  console.log('--- Erfolgschance: schlicht 50:50 ---');
  check('die Grundchance ist ein Münzwurf', robbery.RULES.baseChance === 0.5);
  // Kein Vorteil für Reiche und keine Rechnerei: Es gibt nur noch den Wurf.
  const arm2 = await player(600);
  const reich2 = await player(500000);
  when += robbery.RULES.cooldownMs + 1000;
  const kleiner = await robbery.rob(W, reich2, arm2, when, () => 0.01);
  when += robbery.RULES.cooldownMs + 1000;
  // Nach dem ersten Überfall ist der Arme blank – für den Gegenversuch braucht
  // er wieder etwas in der Tasche (die Strafe muss zahlbar sein).
  await wallet.changeCash(W, arm2, 800, 'Testaufbau');
  await wallet.changeCash(W, reich2, 100000 - (await cashOf(reich2)), 'Testaufbau');
  const grosser = await robbery.rob(W, arm2, reich2, when, () => 0.01);
  check('dieselbe Chance, egal wer wen ausraubt',
    kleiner.chance === grosser.chance && kleiner.chance === 0.5,
    `${kleiner.chance} / ${grosser.chance}`);

  console.log('--- Rollen-Einkommen ---');
  check('aus der .env gelesen', roleIncome.enabled === true && roleIncome.ROLES.size === 2);
  check('Beträge werden summiert',
    roleIncome.amountFor(['ROLLE_A', 'ROLLE_B']).total === 2000);
  check('unbekannte Rollen zählen nicht', roleIncome.amountFor(['EGAL']).total === 0);

  const e = await player(1000);
  const ohne = await roleIncome.claim(W, e, []);
  check('ohne passende Rolle kein Geld', !ohne.ok && ohne.reason === 'no_roles');
  check('und kein Cooldown verbraucht', roleIncome.remainingMs(W, e) === 0);

  const got = await roleIncome.claim(W, e, ['ROLLE_A']);
  check('mit Rolle wird ausgezahlt', got.ok && got.amount === 500, JSON.stringify(got));
  check('Geld ist angekommen', (await cashOf(e)) === 1500);

  const nochmal = await roleIncome.claim(W, e, ['ROLLE_A']);
  check('zweite Abholung abgelehnt', !nochmal.ok && nochmal.reason === 'cooldown');
  check('und es floss kein Geld', (await cashOf(e)) === 1500);

  const morgen = await roleIncome.claim(W, e, ['ROLLE_A'],
    Date.now() + roleIncome.INTERVAL_MS + 1000);
  check('nach dem Intervall wieder möglich', morgen.ok === true);

  console.log(`\n${pass} bestanden, ${fail} fehlgeschlagen`);
  process.exit(fail === 0 ? 0 : 1);
})();
