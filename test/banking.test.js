/**
 * Tests für Ein- und Auszahlungen.
 *
 * Hintergrund: UnbelievaBoats `!rob` nimmt nur Bargeld. Fluxer-Spieler konnten
 * sich bisher nicht wehren, weil sie ihr Geld nicht auf die Bank bringen
 * konnten. Diese Befehle schließen die Lücke.
 *
 * Wichtigste Zusicherung: Umbuchungen verändern das GESAMTVERMÖGEN nie.
 *
 * Aufruf: npm run test:banking
 */
process.env.WORLD_ID = 'TESTWORLD_BANK';

const banking = require('../src/banking');
const wallet = require('../src/wallet');
const identity = require('../src/identity');

const W = identity.world();
let pass = 0, fail = 0;
const check = (label, ok, extra = '') => {
  if (ok) { pass++; console.log(`  ✅ ${label}`); }
  else { fail++; console.log(`  ❌ ${label} ${extra}`); }
};

let n = 0;
const player = () => `BANKUSER_${Date.now()}_${n++}`;

(async () => {
  console.log('--- Beträge verstehen ---');
  check('"alles" nimmt den verfügbaren Betrag', banking.parseAmount('alles', 7000) === 7000);
  check('"max" ebenso', banking.parseAmount('max', 250) === 250);
  check('Tausenderpunkte werden gelesen', banking.parseAmount('1.500', 0) === 1500);
  check('Leerzeichen werden gelesen', banking.parseAmount('12 000', 0) === 12000);
  check('null bei 0', banking.parseAmount('0', 0) === null);
  check('null bei negativ', banking.parseAmount('-100', 0) === null);
  check('null bei Unsinn', banking.parseAmount('abc', 0) === null);
  check('null bei leer', banking.parseAmount('', 0) === null);

  console.log('--- Einzahlen ---');
  const U = player();
  const start = await wallet.getBalance(W, U);
  check('Startguthaben liegt bar vor', start.cash === wallet.START_CASH && start.bank === 0);

  const dep = await banking.deposit(W, U, 1000);
  check('Einzahlung klappt', dep.ok === true, JSON.stringify(dep).slice(0, 80));
  check('Bargeld sinkt um 1000', dep.balance.cash === start.cash - 1000);
  check('Bank steigt um 1000', dep.balance.bank === 1000);
  check('GESAMTVERMÖGEN unverändert', dep.balance.total === start.total,
    `${dep.balance.total} vs ${start.total}`);

  const tooMuch = await banking.deposit(W, U, 999999);
  check('mehr als vorhanden wird abgelehnt',
    !tooMuch.ok && tooMuch.reason === 'not_enough_cash', tooMuch.reason);
  check('nach Ablehnung nichts bewegt',
    (await wallet.getBalance(W, U)).bank === 1000);

  console.log('--- Abheben ---');
  const wd = await banking.withdraw(W, U, 400);
  check('Abhebung klappt', wd.ok === true);
  check('Bank sinkt um 400', wd.balance.bank === 600);
  check('Bargeld steigt um 400', wd.balance.cash === start.cash - 600);
  check('GESAMTVERMÖGEN weiterhin unverändert', wd.balance.total === start.total);

  const overdraw = await banking.withdraw(W, U, 99999);
  check('mehr als auf der Bank wird abgelehnt',
    !overdraw.ok && overdraw.reason === 'not_enough_bank', overdraw.reason);

  console.log('--- "alles" ---');
  const all = await banking.deposit(W, U, 'alles');
  check('alles einzahlen leert das Bargeld', all.ok && all.balance.cash === 0,
    JSON.stringify(all.balance));
  check('Bank hält jetzt das ganze Vermögen', all.balance.bank === start.total);
  check('Summe stimmt immer noch', all.balance.total === start.total);

  const empty = await banking.deposit(W, U, 'alles');
  check('ohne Bargeld: freundliche Absage', !empty.ok && empty.reason === 'no_cash');

  const allBack = await banking.withdraw(W, U, 'alles');
  check('alles abheben leert die Bank', allBack.ok && allBack.balance.bank === 0);
  check('Bargeld entspricht dem Vermögen', allBack.balance.cash === start.total);
  const emptyBank = await banking.withdraw(W, U, 'alles');
  check('ohne Bankguthaben: freundliche Absage', !emptyBank.ok && emptyBank.reason === 'no_bank');

  console.log('--- 200 zufällige Umbuchungen erhalten die Summe ---');
  let drift = null;
  for (let i = 0; i < 200; i++) {
    const bal = await wallet.getBalance(W, U);
    const fn = Math.random() < 0.5 ? banking.deposit : banking.withdraw;
    const pool = fn === banking.deposit ? bal.cash : bal.bank;
    if (pool > 1) await fn(W, U, Math.max(1, Math.floor(Math.random() * pool)));
    const after = await wallet.getBalance(W, U);
    if (after.total !== start.total) { drift = after.total; break; }
  }
  check('Vermögen bleibt exakt gleich', drift === null,
    drift === null ? '' : `abgewichen auf ${drift}`);

  console.log('--- Ungültige Eingabe ---');
  const bad = await banking.deposit(W, U, 'blubb');
  check('Unsinn wird abgelehnt', !bad.ok && bad.reason === 'bad_amount');

  console.log(`\n${pass} bestanden, ${fail} fehlgeschlagen`);
  process.exit(fail === 0 ? 0 : 1);
})();
