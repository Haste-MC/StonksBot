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

  console.log('--- Erfolgreicher Überfall: reine Umverteilung ---');
  const räuber = await player(5000);
  const opfer = await player(20000);
  const vorher = (await totalOf(räuber)) + (await totalOf(opfer));

  const win = await robbery.rob(W, räuber, opfer, Date.now(), () => 0.01); // erzwingt Erfolg
  check('Überfall gelingt', win.ok && win.success === true, JSON.stringify(win));
  check('Räuber hat die Beute', (await cashOf(räuber)) === 5000 + win.amount);
  check('Opfer hat sie verloren', (await cashOf(opfer)) === 20000 - win.amount);
  check('SUMME BEIDER KONTEN UNVERÄNDERT',
    (await totalOf(räuber)) + (await totalOf(opfer)) === vorher,
    `${(await totalOf(räuber)) + (await totalOf(opfer))} vs ${vorher}`);
  check('Beute höchstens 30 % des Bargelds', win.amount <= 20000 * robbery.RULES.maxShare);

  console.log('--- Cooldown ---');
  const wieder = await robbery.rob(W, räuber, opfer);
  check('sofortiger zweiter Versuch abgelehnt',
    !wieder.ok && wieder.reason === 'cooldown', wieder.reason);
  check('Restzeit wird gemeldet',
    wieder.remainingMs > 0 && wieder.remainingMs <= robbery.RULES.cooldownMs);
  const später = await robbery.rob(W, räuber, opfer,
    Date.now() + robbery.RULES.cooldownMs + 1000, () => 0.01);
  check('nach Ablauf wieder möglich', später.ok === true);

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
  check('Strafe ist gedeckelt', lose.penalty <= robbery.RULES.maxPenalty);

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

  console.log('--- Erfolgschance ---');
  check('kleine Beute ist sicherer als große',
    robbery.chanceFor(100, 10000) > robbery.chanceFor(50000, 10000));
  check('Chance bleibt in sinnvollen Grenzen',
    [1, 500, 99999].every((l) => {
      const c = robbery.chanceFor(l, 1000);
      return c >= 0.2 && c <= robbery.RULES.baseChance;
    }));

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
