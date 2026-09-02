/**
 * Tests für die Level-Vorteile.
 *
 * Zwei Sorten von Prüfungen:
 *
 *  1. **Die Kurve** – Vorteile wachsen mit dem Level, sind aber gedeckelt.
 *     Ohne Deckel liefe der Aufschlag mit dem Level davon, und weil jede
 *     Geldbuchung XP gibt, wäre das eine sich selbst verstärkende Schleife.
 *  2. **Die Grenzen bleiben** – ARCHITEKTUR §3. Die Börsengebühr darf sinken,
 *     aber nie auf null; Werkstatt und Auktionshaus dürfen gar nicht
 *     angefasst werden, weil dort der Aufschlag knapp über dem Wertzuwachs
 *     bzw. dem Erwartungswert liegt.
 *
 * Aufruf: node test/perks.test.js
 */
process.env.WORK_BONUS = 'true';

const db = require('../src/db');
const perks = require('../src/perks');
const level = require('../src/level');
const income = require('../src/income');
const market = require('../src/wallstreet');
const workshop = require('../src/workshop');
const storage = require('../src/storage');
const property = require('../src/property');
const unb = require('../src/unb');

const G = 'TESTWORLD_PERKS';
let pass = 0, fail = 0;
const check = (label, ok, extra = '') => {
  if (ok) { pass++; console.log(`  ✅ ${label}`); }
  else { fail++; console.log(`  ❌ ${label} ${extra}`); }
};

const wallet = {};
const balanceOf = (u) => (wallet[u] ??= { cash: 1_000_000, bank: 0, total: 1_000_000 });
unb.getBalance = async (g, u) => ({ ...balanceOf(u) });
unb.changeCash = async (g, u, a) => {
  const b = balanceOf(u); b.cash += a; b.total = b.cash + b.bank; return { ...b };
};
unb.withdrawFromBank = async (g, u, a) => {
  const b = balanceOf(u); b.cash += a; b.bank -= a; b.total = b.cash + b.bank; return { ...b };
};

/** Setzt ein Konto auf ein bestimmtes Level. */
function makeLevel(userId, lvl) {
  const stats = db.getStats(G, userId);
  db.addStats(G, userId, { xp: level.xpForLevel(lvl) - stats.xp });
  return userId;
}

(async () => {
  console.log('--- Die Kurve ---');
  check('Level 0 hat keine Vorteile',
    perks.perks(0).income === 1 && perks.perks(0).fee === 1 &&
    perks.perks(0).slots === 0 && perks.perks(0).theft === 1);

  const levels = [0, 1, 5, 10, 20, 30, 50, 999];
  const income5 = levels.map((l) => perks.perks(l).income);
  check('Einkommen steigt monoton',
    income5.every((v, i) => i === 0 || v >= income5[i - 1]));
  check('Einkommen ist gedeckelt',
    perks.perks(999).income === 1 + perks.INCOME_CAP, String(perks.perks(999).income));
  check('Gebührenrabatt ist gedeckelt',
    perks.perks(999).fee === 1 - perks.FEE_CUT_CAP, String(perks.perks(999).fee));
  check('Diebstahlrabatt ist gedeckelt',
    Math.abs(perks.perks(999).theft - (1 - perks.THEFT_CUT_CAP)) < 1e-9);
  check('Stellplätze sind begrenzt',
    perks.perks(999).slots === perks.SLOT_LEVELS.length);
  check('negative Level fallen auf 0 zurück', perks.perks(-5).income === 1);

  console.log('--- Die Grenzen aus §3 bleiben stehen ---');
  check('Börsengebühr sinkt, wird aber NIE null',
    levels.every((l) => market.feeFor(100000, perks.perks(l).fee) > 0),
    String(market.feeFor(100000, perks.perks(999).fee)));
  check('höheres Level = kleinere Gebühr',
    market.feeFor(100000, perks.perks(30).fee) < market.feeFor(100000, perks.perks(0).fee));
  check('Rabatt ist auch intern gedeckelt (kein Faktor unter 0,25)',
    market.feeFor(100000, 0) === market.feeFor(100000, 0.25),
    `${market.feeFor(100000, 0)} vs ${market.feeFor(100000, 0.25)}`);

  // Die Werkstatt darf gar keinen Rabatt kennen: Dort liegt der Preis nur
  // knapp über dem Wertzuwachs – ein Nachlass machte daraus einen Gelddrucker.
  check('Werkstatt kennt keine Level-Rabatte',
    !require('node:fs').readFileSync('src/workshop.js', 'utf8').includes('perks'));
  check('Auktionshaus kennt keine Level-Rabatte',
    !require('node:fs').readFileSync('src/storage.js', 'utf8').includes('perks'));
  check('Reparatur kostet weiterhin mehr als sie bringt',
    workshop.quote(50000, 20, 'resto').cost > workshop.quote(50000, 20, 'resto').gain);
  check('Startpreis der Auktion liegt weiter über dem Erwartungswert',
    require('../src/data/storage').TIERS.every((t) =>
      storage.startPrice(t, 0) >= storage.expectedValueFull(t, 0)));

  console.log('--- Tagesbonus wächst mit dem Level ---');
  const LOW = makeLevel('PERK_LOW', 0);
  const HIGH = makeLevel('PERK_HIGH', 20);
  check('Level sitzt', perks.levelOf(G, LOW) === 0 && perks.levelOf(G, HIGH) === 20,
    `${perks.levelOf(G, LOW)}/${perks.levelOf(G, HIGH)}`);

  const fixed = () => 0.5;   // immer derselbe Wurf -> Vergleich ist fair
  db.clearClaim(G, LOW, 'daily'); db.clearClaim(G, HIGH, 'daily');
  const low = await income.daily(G, LOW, Date.now(), fixed);
  const high = await income.daily(G, HIGH, Date.now(), fixed);
  check('gleicher Wurf, mehr Geld auf höherem Level', high.amount > low.amount,
    `${high.amount} vs ${low.amount}`);
  check('Aufschlag entspricht der Kurve',
    high.amount === Math.round(low.amount * perks.perks(20).income),
    `${high.amount} vs ${Math.round(low.amount * perks.perks(20).income)}`);
  check('der Zuschlag wird ausgewiesen', high.bonus > 0 && high.base === low.amount,
    `${high.bonus}/${high.base}`);
  check('Level 0 bekommt keinen Zuschlag', low.bonus === 0);

  console.log('--- Stellplätze und Diebstahlrisiko ---');
  check('ab Level 10 ein Platz mehr',
    property.capacity(G, HIGH).capacity - property.capacity(G, LOW).capacity ===
    perks.perks(20).slots, String(perks.perks(20).slots));
  check('Kapazität weist den Bonus aus', property.capacity(G, HIGH).bonus === 2,
    String(property.capacity(G, HIGH).bonus));
  check('Diebstahlrisiko sinkt, verschwindet aber nicht',
    perks.perks(999).theft > 0 && perks.perks(999).theft < 1);

  console.log('--- Zuschlag auf UnbelievaBoats Auszahlung ---');
  perks.reset();
  check('Auszahlung wird aus dem Text gelesen',
    perks.parsePayout({ content: 'You worked and earned **1,250** Rubine' }) === 1250);
  check('auch aus einem Embed',
    perks.parsePayout({ content: '', embeds: [{ description: 'Du hast 3.400 verdient' }] }) === 3400);
  check('absurde Zahlen werden ignoriert',
    perks.parsePayout({ content: `Nachricht 99999999999` }) === 0);
  check('ohne Zahl kein Fund', perks.parsePayout({ content: 'nichts hier' }) === 0);

  const credited = [];
  const credit = async (id, amount, reason) => { credited.push({ id, amount, reason }); };
  const t = Date.now();
  const DISCORD_ID = '498875863496916995';

  // Der Zuschlag hängt an der WELT (die Nachricht kennt keine Guild-ID der
  // Spiellogik) – das Level muss also dort sitzen.
  const identity = require('../src/identity');
  const W = identity.world();
  const worldLevel = (userId, lvl) => {
    db.addStats(W, userId, { xp: level.xpForLevel(lvl) - db.getStats(W, userId).xp });
  };
  worldLevel(DISCORD_ID, 20);

  check('die Bot-Antwort allein löst nichts aus',
    (await perks.handleMessage({ channelId: 'C1', author: { id: 'UNB', bot: true }, content: 'earned 1.000' }, credit, t)) === null);
  check('nichts gebucht', credited.length === 0);

  await perks.handleMessage({ channelId: 'C1', author: { id: DISCORD_ID, bot: false }, content: '!work' }, credit, t);
  const res = await perks.handleMessage(
    { channelId: 'C1', author: { id: 'UNB', bot: true }, content: 'You earned 1.000!' }, credit, t + 2000);
  check('Zuschlag berechnet', res && res.amount === Math.round(1000 * perks.perks(20).incomeBonus),
    JSON.stringify(res));
  check('und gebucht', credited.length === 1 && credited[0].amount === res.amount);

  const repeat = await perks.handleMessage(
    { channelId: 'C1', author: { id: 'UNB', bot: true }, content: 'You earned 1.000!' }, credit, t + 3000);
  check('eine zweite Bot-Nachricht bekommt nichts mehr', repeat === null);

  await perks.handleMessage({ channelId: 'C1', author: { id: DISCORD_ID, bot: false }, content: '!work' }, credit, t + 4000);
  const cooled = await perks.handleMessage(
    { channelId: 'C1', author: { id: 'UNB', bot: true }, content: 'You earned 1.000!' }, credit, t + 5000);
  check('Cooldown verhindert Dauerfeuer', cooled === null, JSON.stringify(cooled));

  perks.reset();
  await perks.handleMessage({ channelId: 'C2', author: { id: DISCORD_ID, bot: false }, content: '!work' }, credit, t);
  const late = await perks.handleMessage(
    { channelId: 'C2', author: { id: 'UNB', bot: true }, content: 'You earned 1.000!' },
    credit, t + perks.WINDOW_MS + 1000);
  check('zu späte Antwort zählt nicht mehr', late === null);

  perks.reset();
  const LOWDC = '111111111111111111';
  worldLevel(LOWDC, 0);
  await perks.handleMessage({ channelId: 'C3', author: { id: LOWDC, bot: false }, content: '!work' }, credit, t);
  const none = await perks.handleMessage(
    { channelId: 'C3', author: { id: 'UNB', bot: true }, content: 'You earned 1.000!' }, credit, t + 1000);
  check('Level 0 bekommt keinen Zuschlag', none === null);

  console.log('--- Anzeige ---');
  check('Zusammenfassung nennt alle aktiven Vorteile',
    perks.summary(20).length === 4, String(perks.summary(20).length));
  check('auf Level 0 nur die beiden Prozentzeilen', perks.summary(0).length === 2);
  check('nächster Meilenstein wird genannt', perks.nextMilestone(8).text.includes('Level 10'),
    perks.nextMilestone(8).text);
  check('am Ende der Kurve gibt es keinen mehr', perks.nextMilestone(999) === null);

  db.clearClaim(G, LOW, 'daily'); db.clearClaim(G, HIGH, 'daily');
  worldLevel(DISCORD_ID, 0);      // Testkonto in der echten Welt zurücksetzen
  console.log(`\n${pass} bestanden, ${fail} fehlgeschlagen`);
  process.exit(fail === 0 ? 0 : 1);
})();
