/**
 * Tests für Arbeitsamt: Tagesauswahl, Seltenheit, Voraussetzungen, Anstellung.
 * Aufruf: npm run test:jobs
 */
const db = require('../src/db');
const jobs = require('../src/jobs');
const JOBS = require('../src/data/jobs');
const gear = require('../src/data/gear');

const G = 'TESTGUILD4';
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

console.log('--- Katalog ---');
// Untergrenze, damit das Tagesangebot (5 Stellen) nie eintönig wird.
// Der Streamer ist bewusst NICHT mehr dabei: Aus ihm wurde eine eigene
// Tätigkeit am Setup (siehe src/streaming.js).
check(`viele Jobs vorhanden (${JOBS.length})`, JOBS.length >= 45, String(JOBS.length));
check('IDs eindeutig', new Set(JOBS.map((j) => j.id)).size === JOBS.length);
check('alle Tiers bekannt',
  JOBS.every((j) => jobs.TIER_WEIGHT[j.tier] !== undefined),
  JOBS.filter((j) => !jobs.TIER_WEIGHT[j.tier]).map((j) => j.tier).join());
check('alle haben Bezahlung und Cooldown',
  JOBS.every((j) => j.pay > 0 && j.cooldown > 0));
check('jede Item-Voraussetzung existiert im Ausrüstungskatalog', (() => {
  const names = new Set(gear.map((g) => g.name.toLowerCase()));
  return JOBS.every((j) => (j.requires ?? []).every((r) => !r.item || names.has(r.item.toLowerCase())));
})());
check('bessere Tiers zahlen im Schnitt mehr', (() => {
  const avg = (t) => {
    const l = JOBS.filter((j) => j.tier === t);
    return l.reduce((s, j) => s + j.pay, 0) / l.length;
  };
  return avg('common') < avg('uncommon') && avg('uncommon') < avg('rare')
    && avg('rare') < avg('epic') && avg('epic') < avg('legendary');
})());

console.log('--- Tagesauswahl ---');
const day1 = new Date('2026-07-20T10:00:00');
const day1b = new Date('2026-07-20T23:00:00');
const day2 = new Date('2026-07-21T10:00:00');

const a = jobs.dailyOffers(G, U, day1);
const b = jobs.dailyOffers(G, U, day1b);
const c = jobs.dailyOffers(G, U, day2);

check(`${jobs.OFFERS_PER_DAY} Angebote pro Tag`, a.length === jobs.OFFERS_PER_DAY, String(a.length));
check('gleicher Tag -> gleiches Angebot', a.map((j) => j.id).join() === b.map((j) => j.id).join());
check('anderer Tag -> anderes Angebot', a.map((j) => j.id).join() !== c.map((j) => j.id).join());
check('keine Doppelten am selben Tag', new Set(a.map((j) => j.id)).size === a.length);
check('anderer Spieler -> anderes Angebot',
  jobs.dailyOffers(G, 'ANDERER', day1).map((j) => j.id).join() !== a.map((j) => j.id).join());
check('anderer Server -> anderes Angebot',
  jobs.dailyOffers('ANDERE', U, day1).map((j) => j.id).join() !== a.map((j) => j.id).join());

console.log('--- Seltenheit über 2000 Tage ---');
const counts = {};
const start = new Date('2026-01-01T12:00:00');
for (let d = 0; d < 2000; d++) {
  const date = new Date(start.getTime() + d * 86400000);
  for (const job of jobs.dailyOffers(G, U, date)) {
    counts[job.tier] = (counts[job.tier] || 0) + 1;
  }
}
console.log('   ', JSON.stringify(counts));
check('common am häufigsten', counts.common > counts.uncommon);
check('uncommon häufiger als rare', counts.uncommon > counts.rare);
check('rare häufiger als epic', counts.rare > counts.epic);
check('epic häufiger als legendary', counts.epic > (counts.legendary ?? 0));
check('legendary kommt vor, aber selten',
  (counts.legendary ?? 0) > 0 && (counts.legendary ?? 0) < 2000 * 0.05,
  String(counts.legendary));

console.log('--- Voraussetzungen ---');
const withItem = JOBS.find((j) => (j.requires ?? []).some((r) => r.item));
const neededItem = withItem.requires.find((r) => r.item).item;

let res = jobs.checkRequirements(G, U, withItem);
check('ohne Ausrüstung nicht erfüllt', res.ok === false && res.missing.includes(neededItem));

const item = db.createItem({
  guildId: G, name: neededItem, price: 100, kind: 'gear', stock: null, createdBy: 'test',
});
db.reservePurchase(G, U, item.id, 1);
res = jobs.checkRequirements(G, U, withItem);
check('mit Ausrüstung erfüllt', res.ok === true, JSON.stringify(res.missing));

const carJob = JOBS.find((j) => (j.requires ?? []).some((r) => r.car));
const needed = carJob.requires.find((r) => r.car).car;
check('Autowert-Voraussetzung fehlt ohne Auto',
  jobs.checkRequirements(G, U, carJob).missing.some((m) => m.startsWith('Auto ab')));

const cheap = db.createItem({
  guildId: G, name: 'Billigauto', price: Math.floor(needed / 2), kind: 'car', stock: null, createdBy: 'test',
});
db.reservePurchase(G, U, cheap.id, 1);
check('zu billiges Auto reicht nicht',
  jobs.checkRequirements(G, U, carJob).missing.some((m) => m.startsWith('Auto ab')));

const pricey = db.createItem({
  guildId: G, name: 'Teures Auto', price: needed, kind: 'car', stock: null, createdBy: 'test',
});
db.reservePurchase(G, U, pricey.id, 1);
check('teures genug Auto erfüllt',
  !jobs.checkRequirements(G, U, carJob).missing.some((m) => m.startsWith('Auto ab')));

console.log('--- Bewerbung ---');
const offered = jobs.dailyOffers(G, U, day1);
const notOffered = JOBS.find((j) => !offered.some((o) => o.id === j.id));
check('Bewerbung auf nicht angebotenen Job scheitert',
  jobs.apply(G, U, notOffered.id, day1).reason === 'not_offered');
check('unbekannte Job-ID scheitert',
  jobs.apply(G, U, 'gibtesnicht', day1).reason === 'unknown_job');

// Einen angebotenen Job ohne Voraussetzungen suchen.
const easy = offered.find((j) => !(j.requires ?? []).length);
if (easy) {
  const hired = jobs.apply(G, U, easy.id, day1);
  check('Bewerbung ohne Voraussetzungen klappt', hired.ok === true, JSON.stringify(hired));
  check('Anstellung gespeichert', jobs.currentJob(G, U)?.job.id === easy.id);
  check('erneute Bewerbung -> already_hired',
    jobs.apply(G, U, easy.id, day1).reason === 'already_hired');
  check('Kündigen klappt', jobs.quit(G, U).ok === true);
  check('danach arbeitslos', jobs.currentJob(G, U) === null);
  check('Kündigen ohne Job scheitert', jobs.quit(G, U).reason === 'unemployed');
} else {
  console.log('  (kein voraussetzungsfreier Job im Tagesangebot – übersprungen)');
}

console.log('--- Auffrischung ---');
const ms = jobs.msUntilRefresh(new Date('2026-07-20T23:00:00'));
check('Auffrischung in unter 24 h', ms > 0 && ms <= 86400000, String(ms));
check('kurz vor Mitternacht < 1 h', ms <= 3600000, String(ms));

cleanup();
console.log(`\n${pass} bestanden, ${fail} fehlgeschlagen`);
process.exit(fail === 0 ? 0 : 1);
