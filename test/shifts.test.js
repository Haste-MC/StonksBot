/**
 * Tests für Schichtbegrenzung (max. 4/Tag) und Ausrüstungsverschleiß.
 * Aufruf: npm run test:shifts
 */
const db = require('../src/db');
const jobs = require('../src/jobs');
const gear = require('../src/data/gear');
const JOBS = require('../src/data/jobs');

const G = 'TESTGUILD5';
const U = 'TESTUSER';
let pass = 0, fail = 0;

const check = (label, cond, extra = '') => {
  if (cond) { pass++; console.log(`  ✅ ${label}`); }
  else { fail++; console.log(`  ❌ ${label} ${extra}`); }
};
const cleanup = () => {
  db.clearEmployment(G, U);
  for (const kind of ['car', 'gear']) {
    for (const i of db.allItemsOfKind(G, kind)) db.deleteItem(G, i.id);
  }
};

cleanup();

(async () => {

console.log('--- Konfiguration ---');
check('4 Schichten pro Tag', jobs.MAX_SHIFTS_PER_DAY === 4);
check('2 Stunden pro Schicht', jobs.HOURS_PER_SHIFT === 2);
check('ergibt 8-Stunden-Tag', jobs.MAX_SHIFTS_PER_DAY * jobs.HOURS_PER_SHIFT === 8);

console.log('--- Verschleiß-Zuordnung ---');
check('Führerscheine unzerstörbar',
  gear.filter((g) => g.category === 'Führerschein').every((g) => gear.wearChance(g) === 0));
check('Ausbildungen unzerstörbar',
  gear.filter((g) => g.category === 'Ausbildung').every((g) => gear.wearChance(g) === 0));
check('Werkzeug verschleißt',
  gear.filter((g) => g.category === 'Werkzeug').every((g) => gear.wearChance(g) > 0));
check('Technik verschleißt',
  gear.filter((g) => g.category === 'Technik').every((g) => gear.wearChance(g) > 0));
check('Ausstattung verschleißt',
  gear.filter((g) => g.category === 'Ausstattung').every((g) => gear.wearChance(g) > 0));
check('teure Geräte halten länger',
  gear.wearChance(gear.findGear('Hebebühne')) < gear.wearChance(gear.findGear('Werkzeugkasten')));
check('isBreakable stimmt mit wearChance überein',
  gear.every((g) => gear.isBreakable(g.name) === (gear.wearChance(g) > 0)));
check('unbekannter Artikel -> nicht zerstörbar', gear.isBreakable('Gibtesnicht') === false);

console.log('--- Tageszähler ---');
// Einen Job ohne Voraussetzungen suchen und fest anstellen.
const easy = JOBS.find((j) => !(j.requires ?? []).length);
db.setEmployment(G, U, easy.id);

const day = '2026-07-20';
check('anfangs 0 Schichten', db.shiftsToday(G, U, day) === 0);
db.recordShift(G, U, 100, day);
check('nach 1 Schicht -> 1', db.shiftsToday(G, U, day) === 1);
db.recordShift(G, U, 100, day);
db.recordShift(G, U, 100, day);
check('nach 3 Schichten -> 3', db.shiftsToday(G, U, day) === 3);
check('anderer Tag -> Zähler zurückgesetzt', db.shiftsToday(G, U, '2026-07-21') === 0);
db.recordShift(G, U, 100, '2026-07-21');
check('neuer Tag zählt wieder ab 1', db.shiftsToday(G, U, '2026-07-21') === 1);
check('Gesamtschichten laufen weiter', db.getEmployment(G, U).shifts === 4,
  String(db.getEmployment(G, U).shifts));

console.log('--- Budget-Anzeige ---');
db.clearEmployment(G, U);
db.setEmployment(G, U, easy.id);
const fixed = new Date('2026-07-20T10:00:00');
db.recordShift(G, U, 100, jobs.today(fixed));
const budget = jobs.shiftBudget(G, U, fixed);
check('1 von 4 gearbeitet', budget.done === 1 && budget.left === 3, JSON.stringify(budget));
check('entspricht 2 von 8 Stunden', budget.hours === 2 && budget.maxHours === 8);

console.log('--- Limit greift ---');
db.clearEmployment(G, U);
db.setEmployment(G, U, easy.id);
for (let i = 0; i < 4; i++) db.recordShift(G, U, 100, jobs.today(fixed));
const blocked = await jobs.work(G, U, fixed);
check('5. Schicht wird abgelehnt',
  blocked.ok === false && blocked.reason === 'daily_limit', JSON.stringify(blocked));
check('meldet 4 von 4', blocked.done === 4 && blocked.max === 4);
check('nennt Zeit bis Zurücksetzung', blocked.resetMs > 0);

console.log('--- Verschleiß im Betrieb ---');
// Job mit genau einem physischen Ausrüstungsteil.
const wearJob = JOBS.find((j) =>
  (j.requires ?? []).length === 1 &&
  j.requires[0].item &&
  gear.isBreakable(j.requires[0].item));
const itemName = wearJob.requires[0].item;

const created = db.createItem({
  guildId: G, name: itemName, price: 500, kind: 'gear', stock: null, createdBy: 'test',
});

// Verschleiß 200x mit garantiertem Bruch simulieren.
const realRandom = Math.random;
Math.random = () => 0; // 0 < jede Chance -> geht immer kaputt
db.reservePurchase(G, U, created.id, 1);
check('Ausrüstung vorhanden', db.ownsNamed(G, U, itemName) !== null);
let broken = jobs.applyWear(G, U, wearJob);
check('Teil geht kaputt', broken.length === 1 && broken[0].name === itemName,
  JSON.stringify(broken));
check('aus dem Inventar entfernt', db.ownsNamed(G, U, itemName) === null);
check('Ersatzpreis wird mitgeliefert', typeof broken[0].price === 'number');

broken = jobs.applyWear(G, U, wearJob);
check('ohne Besitz kein Bruch', broken.length === 0, JSON.stringify(broken));

// Lizenz-Job darf nie verschleißen, selbst bei garantiertem Wurf.
const licenseJob = JOBS.find((j) =>
  (j.requires ?? []).length > 0 &&
  j.requires.every((r) => r.item && !gear.isBreakable(r.item)));
if (licenseJob) {
  for (const req of licenseJob.requires) {
    const it = db.createItem({
      guildId: G, name: req.item, price: 100, kind: 'gear', stock: null, createdBy: 'test',
    });
    db.reservePurchase(G, U, it.id, 1);
  }
  const none = jobs.applyWear(G, U, licenseJob);
  check(`Lizenzen bleiben heil (${licenseJob.title})`, none.length === 0, JSON.stringify(none));
  check('Lizenz noch im Besitz', db.ownsNamed(G, U, licenseJob.requires[0].item) !== null);
}

Math.random = realRandom;

console.log('--- Fehlende Ausrüstung blockiert Arbeit ---');
db.clearEmployment(G, U);
db.setEmployment(G, U, wearJob.id);
const noGear = await jobs.work(G, U, new Date('2026-07-22T10:00:00'));
check('ohne Ausrüstung keine Schicht',
  noGear.ok === false && noGear.reason === 'requirements', JSON.stringify(noGear));
check('nennt das fehlende Teil', noGear.missing?.includes(itemName));

cleanup();
console.log(`\n${pass} bestanden, ${fail} fehlgeschlagen`);
process.exit(fail === 0 ? 0 : 1);

})();
