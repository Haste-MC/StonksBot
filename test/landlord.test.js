/**
 * Tests für Spieler-Vermietung, Gnadenfrist und Zwangsverkauf.
 * Aufruf: npm run test:landlord
 */
const db = require('../src/db');
const property = require('../src/property');
const unb = require('../src/unb');

const G = 'TESTGUILD7';
const LANDLORD = 'VERMIETER';
const TENANT = 'MIETER';
let pass = 0, fail = 0;

const check = (label, cond, extra = '') => {
  if (cond) { pass++; console.log(`  ✅ ${label}`); }
  else { fail++; console.log(`  ❌ ${label} ${extra}`); }
};
const cleanup = () => {
  for (const u of [LANDLORD, TENANT]) {
    db.endRental(G, u);
    db.clearGrace(G, u);
  }
  for (const kind of ['car', 'gear', 'property']) {
    for (const i of db.allItemsOfKind(G, kind)) db.deleteItem(G, i.id);
  }
};

// UnbelievaBoat komplett ersetzen – kein echtes Geld bewegen.
const wallet = {};
const balanceOf = (u) => (wallet[u] ??= { cash: 100000, bank: 0, total: 100000 });
unb.getBalance = async (g, u) => ({ ...balanceOf(u) });
unb.changeCash = async (g, u, amount) => {
  const b = balanceOf(u);
  b.cash += amount; b.total = b.cash + b.bank;
  return { ...b };
};
unb.withdrawFromBank = async (g, u, amount) => {
  const b = balanceOf(u);
  b.cash += amount; b.bank -= amount; b.total = b.cash + b.bank;
  return { ...b };
};

cleanup();

(async () => {
  const haus = db.createItem({
    guildId: G, name: 'Vermiethaus', price: 50000, kind: 'property',
    stock: 3, garage: 4, rent: 150, createdBy: 'test',
  });
  db.reservePurchase(G, LANDLORD, haus.id, 1);

  console.log('--- Vermieten ---');
  check('Vermieter hat anfangs 4+2 Plätze',
    property.capacity(G, LANDLORD).capacity === property.STREET_SLOTS + 4,
    JSON.stringify(property.capacity(G, LANDLORD)));

  const bad = property.offerForRent(G, TENANT, haus.id, 200);
  check('Fremder kann nicht vermieten', bad.reason === 'not_owned');

  const offer = property.offerForRent(G, LANDLORD, haus.id, 200);
  check('Angebot erstellt', offer.ok === true, JSON.stringify(offer));
  check('Doppeltes Angebot abgelehnt',
    property.offerForRent(G, LANDLORD, haus.id, 300).reason === 'already_offered');

  console.log('--- Anmieten ---');
  check('eigenes Angebot nicht mietbar',
    (await property.rentFromPlayer(G, LANDLORD, offer.offer.id)).reason === 'own_offer');

  const rented = await property.rentFromPlayer(G, TENANT, offer.offer.id);
  check('Mieter zieht ein', rented.ok === true, JSON.stringify(rented));
  check('Mieter bekommt die 4 Plätze',
    property.capacity(G, TENANT).capacity === property.STREET_SLOTS + 4,
    JSON.stringify(property.capacity(G, TENANT)));
  check('Vermieter verliert die Plätze',
    property.capacity(G, LANDLORD).capacity === property.STREET_SLOTS,
    JSON.stringify(property.capacity(G, LANDLORD)));
  check('Erste Miete beim Vermieter angekommen',
    balanceOf(LANDLORD).cash === 100000 + 200, String(balanceOf(LANDLORD).cash));
  check('Mieter hat gezahlt', balanceOf(TENANT).cash === 100000 - 200);
  check('Angebot gilt als belegt', db.offerTaken(G, haus.id, LANDLORD) === true);
  check('zweiter Mieter abgewiesen',
    (await property.rentFromPlayer(G, 'DRITTER', offer.offer.id)).reason === 'unavailable');

  console.log('--- Laufende Miete geht an den Vermieter ---');
  const before = balanceOf(LANDLORD).cash;
  const r = db.getRental(G, TENANT);
  db.extendRental(G, TENANT, Date.now() - 3 * property.DAY_MS, 0);
  const settled = await property.settleRent(G, TENANT);
  check('3 Tage abgerechnet', settled.status === 'paid' && settled.days === 3,
    JSON.stringify(settled));
  check('600 an den Vermieter', balanceOf(LANDLORD).cash === before + 600,
    String(balanceOf(LANDLORD).cash - before));
  check('Vermieter wird gemeldet', settled.landlordId === LANDLORD);

  console.log('--- Gnadenfrist ---');
  const auto = db.createItem({
    guildId: G, name: 'Testkarre', price: 10000, kind: 'car', stock: null, createdBy: 'test',
  });
  // Mieter hat 6 Plätze, wir geben ihm 6 Autos -> voll, aber nicht drüber.
  db.reservePurchase(G, TENANT, auto.id, 6);
  let cap = await property.enforceCapacity(G, TENANT);
  check('genau voll ist kein Problem', cap.status === 'ok', JSON.stringify(cap));

  // Vertrag beenden -> 4 Plätze weg, 6 Autos bleiben.
  db.endRental(G, TENANT);
  cap = await property.enforceCapacity(G, TENANT);
  check('Überkapazität startet Frist', cap.status === 'grace_started', JSON.stringify(cap));
  check('4 Autos zu viel', cap.excess === 4, String(cap.excess));
  check('Frist gespeichert', db.getGrace(G, TENANT) !== null);

  cap = await property.enforceCapacity(G, TENANT);
  check('erneuter Aufruf verlängert nicht', cap.status === 'grace', JSON.stringify(cap));
  check('Restzeit knapp 7 Tage',
    cap.remainingMs > 6.9 * property.DAY_MS && cap.remainingMs <= 7 * property.DAY_MS);
  check('noch nichts verkauft', db.carsOwned(G, TENANT) === 6);

  console.log('--- Zwangsverkauf nach Fristablauf ---');
  const cashBefore = balanceOf(TENANT).cash;
  const future = Date.now() + (property.GRACE_DAYS + 1) * property.DAY_MS;
  cap = await property.enforceCapacity(G, TENANT, future);

  check('Zwangsverkauf ausgelöst', cap.status === 'sold', JSON.stringify(cap).slice(0, 200));
  check('genau 4 Autos verkauft', cap.sold.length === 4, String(cap.sold.length));
  check('Bestand jetzt 2', db.carsOwned(G, TENANT) === 2, String(db.carsOwned(G, TENANT)));
  check('wieder innerhalb der Kapazität', cap.used <= cap.capacity, JSON.stringify(cap));
  check('Frist zurückgesetzt', db.getGrace(G, TENANT) === null);
  check('Erlös gutgeschrieben', balanceOf(TENANT).cash === cashBefore + cap.total,
    `${balanceOf(TENANT).cash} vs ${cashBefore + cap.total}`);
  check('jeder Erlös zwischen 40 % und 95 %',
    cap.sold.every((s) => s.percent >= 40 && s.percent <= 95),
    cap.sold.map((s) => s.percent).join());
  check('Erlös unter Neupreis',
    cap.sold.every((s) => s.amount < s.original));

  console.log('--- Nach dem Verkauf ist Ruhe ---');
  cap = await property.enforceCapacity(G, TENANT);
  check('Status wieder ok', cap.status === 'ok', JSON.stringify(cap));

  console.log('--- Angebot zurückziehen wirft Mieter raus ---');
  const rented2 = await property.rentFromPlayer(G, TENANT, offer.offer.id);
  check('erneut vermietet', rented2.ok === true);
  const withdrawn = property.withdrawOffer(G, LANDLORD, offer.offer.id);
  check('Angebot zurückgezogen', withdrawn.ok === true, JSON.stringify(withdrawn));
  check('Mieter gemeldet', withdrawn.evictedTenant === TENANT);
  check('Mietvertrag beendet', db.getRental(G, TENANT) === null);
  check('Vermieter hat Plätze zurück',
    property.capacity(G, LANDLORD).capacity === property.STREET_SLOTS + 4);
  check('Fremder kann nicht zurückziehen',
    property.withdrawOffer(G, TENANT, 99999).ok === false);

  cleanup();
  console.log(`\n${pass} bestanden, ${fail} fehlgeschlagen`);
  process.exit(fail === 0 ? 0 : 1);
})();
