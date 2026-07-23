/**
 * Tests für Immobilien: Garagenkapazität, Bestandsgrenzen, Miete, Kauf.
 * Aufruf: npm run test:property
 */
const db = require('../src/db');
const property = require('../src/property');
const catalog = require('../src/data/properties');

const G = 'TESTGUILD6';
const U = 'TESTUSER';
let pass = 0, fail = 0;

const check = (label, cond, extra = '') => {
  if (cond) { pass++; console.log(`  ✅ ${label}`); }
  else { fail++; console.log(`  ❌ ${label} ${extra}`); }
};
const cleanup = () => {
  db.endRental(G, U);
  db.endRental(G, 'ANDERER');
  for (const kind of ['car', 'gear', 'property']) {
    for (const i of db.allItemsOfKind(G, kind)) db.deleteItem(G, i.id);
  }
};

cleanup();

console.log('--- Katalog ---');
check(`${catalog.length} Objekte definiert`, catalog.length >= 20, String(catalog.length));
check('alle haben begrenzte Stückzahl', catalog.every((p) => p.stock > 0));
check('alle haben Kaufpreis und Miete', catalog.every((p) => p.price > 0 && p.rent > 0));
check('Miete etwa Kaufpreis/350', catalog.every((p) => {
  const ratio = p.price / p.rent;
  return ratio > 250 && ratio < 450;
}), catalog.filter((p) => { const r = p.price / p.rent; return r <= 250 || r >= 450; })
  .map((p) => `${p.name}:${Math.round(p.price / p.rent)}`).join(' '));
check('teurere Objekte haben tendenziell mehr Stellplätze', (() => {
  const villa = catalog.filter((p) => p.category === 'Villa');
  const zimmer = catalog.filter((p) => p.category === 'Zimmer');
  const avg = (l) => l.reduce((s, p) => s + p.garage, 0) / l.length;
  return avg(villa) > avg(zimmer);
})());
check('es gibt Objekte ganz ohne Garage', catalog.some((p) => p.garage === 0));

console.log('--- Grundkapazität ---');
let cap = property.capacity(G, U);
check(`ohne Immobilie ${property.STREET_SLOTS} Straßenplätze`,
  cap.capacity === property.STREET_SLOTS, JSON.stringify(cap));
check('nichts belegt', cap.used === 0 && cap.free === property.STREET_SLOTS);

console.log('--- Autos belegen Plätze ---');
// Zwei verschiedene Modelle: jedes Modell gibt es nur einmal pro Spieler.
const car = db.createItem({
  guildId: G, name: 'Testauto', price: 1000, kind: 'car', stock: null, createdBy: 'test',
});
const car2 = db.createItem({
  guildId: G, name: 'Testauto Zwei', price: 1200, kind: 'car', stock: null, createdBy: 'test',
});
const car3 = db.createItem({
  guildId: G, name: 'Testauto Drei', price: 1400, kind: 'car', stock: null, createdBy: 'test',
});
db.reservePurchase(G, U, car.id, 1);
db.reservePurchase(G, U, car2.id, 1);
cap = property.capacity(G, U);
check('2 Autos -> 0 frei', cap.used === 2 && cap.free === 0, JSON.stringify(cap));

console.log('--- Garagen-Sperre beim Autokauf ---');
const { buy: buyItem } = require('../src/purchase');
(async () => {
  // Ein drittes, noch nicht besessenes Modell – so greift wirklich die Garage.
  const blocked = await buyItem(G, U, car3.id, 1);
  check('Kauf ohne Stellplatz abgelehnt',
    blocked.ok === false && blocked.reason === 'no_garage', JSON.stringify(blocked));
  check('meldet Kapazität mit', blocked.capacity === 2 && blocked.used === 2);

  console.log('--- Gekaufte Immobilie erweitert die Garage ---');
  const haus = db.createItem({
    guildId: G, name: 'Testhaus', price: 5000, kind: 'property', stock: 2,
    garage: 3, rent: 20, createdBy: 'test',
  });
  db.reservePurchase(G, U, haus.id, 1);
  cap = property.capacity(G, U);
  check('3 Plätze dazu', cap.capacity === property.STREET_SLOTS + 3, JSON.stringify(cap));
  check('davon 3 frei', cap.free === 3);
  check('Quelle korrekt aufgeschlüsselt', cap.owned === 3 && cap.rented === 0);

  console.log('--- Bestand: Mieter zählen mit ---');
  const knapp = db.createItem({
    guildId: G, name: 'Knappes Objekt', price: 900, kind: 'property', stock: 1,
    garage: 1, rent: 10, createdBy: 'test',
  });
  check('anfangs 1 verfügbar', property.available(G, knapp) === 1);
  db.startRental(G, 'ANDERER', knapp.id, Date.now() + property.DAY_MS, 10);
  check('durch Mieter belegt', property.available(G, knapp) === 0,
    String(property.available(G, knapp)));
  db.endRental(G, 'ANDERER');
  check('nach Kündigung wieder frei', property.available(G, knapp) === 1);

  const unbegrenzt = db.createItem({
    guildId: G, name: 'Unbegrenzt', price: 100, kind: 'property', stock: null,
    garage: 0, rent: 5, createdBy: 'test',
  });
  check('stock=null -> unbegrenzt', property.available(G, unbegrenzt) === Infinity);

  console.log('--- Mietabrechnung ---');
  // Miete für 3 Tage fällig stellen.
  const rentItem = db.createItem({
    guildId: G, name: 'Mietwohnung', price: 3500, kind: 'property', stock: 5,
    garage: 2, rent: 100, createdBy: 'test',
  });
  const now = Date.now();
  db.startRental(G, U, rentItem.id, now - 3 * property.DAY_MS, 100);

  const rental = db.getRental(G, U);
  check('Mietvertrag gespeichert', rental?.item_id === rentItem.id);
  check('Mietobjekt liefert Stellplätze',
    property.capacity(G, U).rented === 2, JSON.stringify(property.capacity(G, U)));

  console.log('--- Rauswurf bei Zahlungsunfähigkeit ---');
  // getBalance ist gemockt: erst arm, dann reich.
  const unb = require('../src/unb');
  const realGet = unb.getBalance;
  unb.getBalance = async () => ({ cash: 0, bank: 0, total: 0 });

  const evicted = await property.settleRent(G, U, now);
  check('wird rausgeworfen', evicted.status === 'evicted', JSON.stringify(evicted));
  check('3 Tage abgerechnet', evicted.days === 3, String(evicted.days));
  check('Forderung 300', evicted.amount === 300, String(evicted.amount));
  check('Mietvertrag beendet', db.getRental(G, U) === null);
  check('Stellplätze wieder weg', property.capacity(G, U).rented === 0);
  check('Autos bleiben erhalten', db.carsOwned(G, U) === 2);

  console.log('--- Ohne Mietvertrag passiert nichts ---');
  const none = await property.settleRent(G, U, now);
  check('status none', none.status === 'none');

  console.log('--- Frisch bezahlt -> nichts fällig ---');
  db.startRental(G, U, rentItem.id, now + property.DAY_MS, 100);
  const fresh = await property.settleRent(G, U, now);
  check('status ok, keine Buchung', fresh.status === 'ok', JSON.stringify(fresh));

  unb.getBalance = realGet;

  cleanup();
  console.log(`\n${pass} bestanden, ${fail} fehlgeschlagen`);
  process.exit(fail === 0 ? 0 : 1);
})();
