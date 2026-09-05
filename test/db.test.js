/**
 * Tests für die Shop-Datenbank. Aufruf: npm test
 * Nutzt einen eigenen Test-Server-ID-Namensraum und räumt hinterher auf.
 */
const db = require('../src/db');

const G = 'TESTGUILD';
const U = 'TESTUSER';
let pass = 0, fail = 0;

const check = (label, cond, extra = '') => {
  if (cond) { pass++; console.log(`  ✅ ${label}`); }
  else { fail++; console.log(`  ❌ ${label} ${extra}`); }
};
const cleanup = () => {
  for (;;) {
    const { items } = db.listItems(G, 1);
    if (!items.length) break;
    for (const i of items) db.deleteItem(G, i.id);
  }
};

cleanup();

console.log('--- Anlegen ---');
const limited = db.createItem({
  guildId: G, name: 'Testschwert', price: 100, description: 'scharf', emoji: '⚔️',
  stock: 2, createdBy: U, brand: 'Testmarke',
  imageUrl: 'https://example.com/x.jpg', attribution: 'Foto: Test, CC BY 4.0',
});
const unlimited = db.createItem({ guildId: G, name: 'Testbrot', price: 5, stock: null, createdBy: U });
check('createItem liefert Zeile mit ID', typeof limited.id === 'number');
check('stock=2 gespeichert', limited.stock === 2, `stock=${limited.stock}`);
check('stock=null bleibt unbegrenzt', unlimited.stock === null);
check('brand gespeichert', limited.brand === 'Testmarke', limited.brand);
check('image_url gespeichert', limited.image_url === 'https://example.com/x.jpg', limited.image_url);
check('attribution gespeichert', limited.attribution.includes('CC BY'), limited.attribution);
check('Standardwerte leer statt null', unlimited.brand === '' && unlimited.image_url === '',
  JSON.stringify([unlimited.brand, unlimited.image_url]));

console.log('--- Doppelter Name ---');
let dup = false;
try { db.createItem({ guildId: G, name: 'testSCHWERT', price: 1, createdBy: U }); }
catch (e) { dup = String(e.message).includes('UNIQUE'); }
check('gleicher Name (andere Schreibweise) abgelehnt', dup);

console.log('--- Lagerbestand ---');
check('2 von 2 reservieren klappt', db.reservePurchase(G, U, limited.id, 2).ok === true);
check('Lager jetzt 0', db.getItem(G, limited.id).stock === 0);
const over = db.reservePurchase(G, U, limited.id, 1);
check('3. Stück abgelehnt', over.ok === false && over.reason === 'out_of_stock');
check('999 von unbegrenztem Artikel klappt', db.reservePurchase(G, U, unlimited.id, 999).ok === true);
check('unbegrenztes Lager bleibt null', db.getItem(G, unlimited.id).stock === null);

console.log('--- Besitz & Garage ---');
check('getOwned findet Besitz', db.getOwned(G, U, limited.id)?.quantity === 2);
check('getOwned bei Fremdartikel null', db.getOwned(G, 'ANDERER', limited.id) === null);
check('teuerstes Auto = Testschwert', db.getMostValuable(G, U)?.name === 'Testschwert');
check('Garagenwert = 2*100 + 999*5', db.garageValue(G, U) === 2 * 100 + 999 * 5,
  String(db.garageValue(G, U)));
check('getOwned liefert Bildspalte mit', db.getOwned(G, U, limited.id)?.image_url?.includes('example.com'));

console.log('--- Rollback ---');
db.releasePurchase(G, U, limited.id, 2, true);
check('Lager wieder 2', db.getItem(G, limited.id).stock === 2);
check('aus Garage entfernt', db.getOwned(G, U, limited.id) === null);

console.log('--- Fehlerfälle ---');
check('reservePurchase unbekannte ID', db.reservePurchase(G, U, 999999, 1).reason === 'not_found');
check('getItem unbekannte ID -> null', db.getItem(G, 999999) === null);
check('getMostValuable ohne Besitz -> null', db.getMostValuable(G, 'NIEMAND') === null);
check('garageValue ohne Besitz -> 0', db.garageValue(G, 'NIEMAND') === 0);

console.log('--- Löschen kaskadiert ---');
db.deleteItem(G, unlimited.id);
check('Garage nach Löschen leer', db.listInventory(G, U, 1).total === 0);

console.log('--- Server-Trennung ---');
check('anderer Server sieht nichts', db.listItems('ANDERERSERVER', 1).total === 0);

cleanup();
console.log('--- Katalog-Abgleich ---');
{
  const seed = require('../src/seed');
  const gearData = require('../src/data/gear');
  const G2 = `SEED_${Date.now()}`;

  const first = seed.ensureGear(G2);
  check('ein leerer Server bekommt den ganzen Katalog',
    first.added.length === gearData.length, `${first.added.length}/${gearData.length}`);
  check('ein zweiter Lauf legt nichts doppelt an',
    seed.ensureGear(G2).added.length === 0);

  // Der Fall, der die Heist-Werkzeuge unsichtbar gemacht hat: Der Katalog
  // wächst, die Datenbank kennt die neuen Sachen noch nicht.
  const one = db.allItemsOfKind(G2, 'gear').find((i) => i.name === 'Sturmmaske');
  db.deleteItem(G2, one.id);
  const again = seed.ensureGear(G2);
  check('fehlende Artikel werden nachgetragen',
    again.added.length === 1 && again.added[0] === 'Sturmmaske', again.added.join());

  check('Heist-Ausrüstung ist im Shop auffindbar',
    require('../src/data/heists').TIERS.at(-1).items
      .every((name) => db.allItemsOfKind(G2, 'gear').some((i) => i.name === name)));
  check('sie hat eine eigene Kategorie',
    db.allItemsOfKind(G2, 'gear')
      .some((i) => i.brand === 'Untergrund' && i.name === 'Brecheisen'));
}

console.log(`\n${pass} bestanden, ${fail} fehlgeschlagen`);
process.exit(fail === 0 ? 0 : 1);
