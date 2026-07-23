/**
 * Tests für das Levelsystem (XP-Kurve, Ein-/Ausgaben-Statistik) und die
 * dazugehörigen DB-Funktionen. Aufruf: npm run test:level
 *
 * Assertions auf Statistik-Werte sind bewusst DELTA-basiert (Baseline zu
 * Beginn lesen), damit ein zweiter Testlauf – income_total & Co. akkumulieren –
 * nicht fehlschlägt.
 */
const db = require('../src/db');
const level = require('../src/level');

const G = 'TESTGUILD_LEVEL';
const U = 'LVLUSER';
let pass = 0, fail = 0;

const check = (label, ok, extra = '') => {
  if (ok) { pass++; console.log(`  ✅ ${label}`); }
  else { fail++; console.log(`  ❌ ${label} ${extra}`); }
};
const cleanupItems = () => {
  for (const k of ['car', 'gear', 'property']) {
    for (const i of db.allItemsOfKind(G, k)) db.deleteItem(G, i.id);
  }
};

cleanupItems();

(async () => {
  console.log('--- XP pro Betrag ---');
  check('0 → 0 XP', level.xpForAmount(0) === 0);
  check('Vorzeichen egal', level.xpForAmount(-10000) === level.xpForAmount(10000));
  check('100 → 10 XP', level.xpForAmount(100) === 10, String(level.xpForAmount(100)));
  check('10 000 → 100 XP', level.xpForAmount(10000) === 100, String(level.xpForAmount(10000)));
  check('1 Mio → 1000 XP', level.xpForAmount(1000000) === 1000, String(level.xpForAmount(1000000)));
  check('monoton steigend', [1, 100, 5000, 100000, 5000000]
    .every((v, i, a) => i === 0 || level.xpForAmount(v) >= level.xpForAmount(a[i - 1])));
  // 10 000 am Stück (100 XP) gibt weniger als 100× je 100 (100 × 10 = 1000 XP).
  check('abnehmender Grenznutzen: splitten lohnt',
    level.xpForAmount(10000) < 100 * level.xpForAmount(100),
    `${level.xpForAmount(10000)} vs ${100 * level.xpForAmount(100)}`);

  console.log('--- Level aus XP ---');
  check('0 XP → Level 0', level.levelForXp(0) === 0);
  check('100 XP → Level 1', level.levelForXp(100) === 1);
  check('400 XP → Level 2', level.levelForXp(400) === 2);
  check('900 XP → Level 3', level.levelForXp(900) === 3);
  check('2500 XP → Level 5', level.levelForXp(2500) === 5);
  check('xpForLevel ist Umkehrung', [0, 1, 2, 5, 10]
    .every((l) => level.levelForXp(level.xpForLevel(l)) === l));
  check('negatives XP → Level 0', level.levelForXp(-50) === 0);

  console.log('--- Fortschritt im Level ---');
  const prog = level.progress(250);
  check('Level 1 bei 250 XP', prog.level === 1, String(prog.level));
  check('into = 250 − 100 = 150', prog.into === 150, String(prog.into));
  check('needed = 400 − 100 = 300', prog.needed === 300, String(prog.needed));
  check('ratio zwischen 0 und 1', prog.ratio > 0 && prog.ratio < 1, String(prog.ratio));
  check('genau auf der Schwelle → ratio 0',
    level.progress(100).ratio === 0, String(level.progress(100).ratio));

  console.log('--- award schreibt Statistik fort ---');
  const base = db.getStats(G, U);

  level.award(G, U, 0);
  const afterZero = db.getStats(G, U);
  check('award(0) ist ein No-op',
    afterZero.xp === base.xp && afterZero.income_total === base.income_total &&
    afterZero.expense_total === base.expense_total);

  level.award(G, U, 10000);   // Einnahme
  let s = db.getStats(G, U);
  check('Einnahme erhöht income_total um 10 000',
    s.income_total - base.income_total === 10000, `${s.income_total - base.income_total}`);
  check('Einnahme lässt expense_total unberührt',
    s.expense_total === base.expense_total);
  check('Einnahme gibt 100 XP', s.xp - base.xp === 100, String(s.xp - base.xp));

  level.award(G, U, -400);    // Ausgabe
  s = db.getStats(G, U);
  check('Ausgabe erhöht expense_total um 400 (Betrag)',
    s.expense_total - base.expense_total === 400, String(s.expense_total - base.expense_total));
  check('Ausgabe lässt income_total unberührt',
    s.income_total - base.income_total === 10000);
  check('Ausgabe gibt 20 XP dazu (100 + 20)',
    s.xp - base.xp === 120, String(s.xp - base.xp));

  console.log('--- Spruch (tagline) ---');
  db.setTagline(G, U, 'Reicher als du 😎');
  check('Spruch wird gespeichert', db.getStats(G, U).tagline === 'Reicher als du 😎');
  db.setTagline(G, U, '');
  check('Spruch lässt sich leeren', db.getStats(G, U).tagline === '');
  check('Statistik bleibt beim Spruch-Setzen erhalten',
    db.getStats(G, U).income_total - base.income_total === 10000);

  console.log('--- getStats ohne Zeile ---');
  const fresh = db.getStats(G, 'NIEMAND');
  check('Unbekannter zählt als 0',
    fresh.xp === 0 && fresh.income_total === 0 && fresh.expense_total === 0 && fresh.tagline === '');

  console.log('--- listStats ist die Teilnehmerliste ---');
  const roster = db.listStats(G);
  check('gelisteter Spieler taucht auf', roster.some((r) => r.user_id === U));
  check('Unbekannter (nie gebucht) taucht nicht auf', !roster.some((r) => r.user_id === 'NIEMAND'));

  console.log('--- propertyValue zählt nur Immobilien ---');
  const haus = db.createItem({
    guildId: G, name: 'Levelvilla', price: 500000, kind: 'property',
    stock: 3, garage: 2, rent: 500, createdBy: 't',
  });
  const auto = db.createItem({
    guildId: G, name: 'Levelauto', price: 80000, kind: 'car', stock: null, createdBy: 't',
  });
  db.reservePurchase(G, U, haus.id, 2);
  db.reservePurchase(G, U, auto.id, 1);
  check('Immobilienwert = 2 × 500 000', db.propertyValue(G, U) === 1000000,
    String(db.propertyValue(G, U)));
  check('propertyValue ignoriert Autos',
    db.propertyValue(G, U) === 1000000 && db.garageValue(G, U) > 0);

  cleanupItems();
  console.log(`\n${pass} bestanden, ${fail} fehlgeschlagen`);
  process.exit(fail === 0 ? 0 : 1);
})();
