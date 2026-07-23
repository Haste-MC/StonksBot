/**
 * Tests für den Gebrauchtmarkt (Inserate, Treuhand, Rückabwicklung).
 * Aufruf: npm run test:market
 */
const db = require('../src/db');

const G = 'TESTGUILD2';
const SELLER = 'SELLER';
const BUYER = 'BUYER';
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

const car = db.createItem({
  guildId: G, name: 'Testwagen', price: 10000, emoji: '🚗',
  stock: null, createdBy: 'seed', imageUrl: 'https://example.com/c.jpg',
});
db.reservePurchase(G, SELLER, car.id, 1);

console.log('--- Inserat erstellen ---');
check('Verkäufer besitzt das Auto', db.getOwned(G, SELLER, car.id)?.quantity === 1);
const made = db.createListing(G, SELLER, car.id, 7500);
check('createListing erfolgreich', made.ok === true, JSON.stringify(made));
check('Auto ist aus der Garage (Treuhand)', db.getOwned(G, SELLER, car.id) === null);
check('Inserat erscheint im Markt', db.listListings(G, 1).total === 1);

const listingId = made.listing.id;
const l = db.getListing(G, listingId);
check('Inseratspreis korrekt', l.listing_price === 7500, String(l?.listing_price));
check('Neupreis bleibt erhalten', l.price === 10000, String(l?.price));
check('Verkäufer hinterlegt', l.seller_id === SELLER);
check('Bilddaten mitgeliefert', l.image_url?.includes('example.com'));

console.log('--- Ohne Besitz inserieren ---');
check('Fremder kann nicht inserieren',
  db.createListing(G, 'FREMDER', car.id, 100).reason === 'not_owned');

console.log('--- Ausrüstung gehört in keinen Markt ---');
const villa = db.createItem({
  guildId: G, name: 'Testvilla', price: 9000, kind: 'property',
  stock: 2, garage: 4, rent: 30, createdBy: 'test',
});
const lizenz = db.createItem({
  guildId: G, name: 'Testlizenz', price: 500, kind: 'gear', stock: null, createdBy: 'test',
});
db.reservePurchase(G, SELLER, villa.id, 1);
db.reservePurchase(G, SELLER, lizenz.id, 1);

check('Ausrüstung wird abgelehnt',
  db.createListing(G, SELLER, lizenz.id, 300).reason === 'wrong_kind');
check('abgelehnte Ausrüstung bleibt im Besitz', db.getOwned(G, SELLER, lizenz.id) !== null);

// Immobilien sind erlaubt, landen aber im Immobilien-, nicht im Automarkt.
check('Immobilie ist inserierbar', db.createListing(G, SELLER, villa.id, 5000).ok === true);
check('Automarkt bleibt sortenrein',
  db.listListings(G, 1, 'car').items.every((i) => i.kind === 'car'),
  db.listListings(G, 1, 'car').items.map((i) => `${i.name}:${i.kind}`).join());
check('Villa erscheint im Immobilienmarkt',
  db.listListings(G, 1, 'property').items.some((i) => i.name === 'Testvilla'));
check('Villa nicht im Automarkt',
  !db.listListings(G, 1, 'car').items.some((i) => i.name === 'Testvilla'));

db.deleteItem(G, villa.id);
db.deleteItem(G, lizenz.id);

console.log('--- Zurückziehen ---');
const cancelled = db.cancelListing(G, SELLER, listingId);
check('cancelListing erfolgreich', cancelled.ok === true);
check('Auto zurück in der Garage', db.getOwned(G, SELLER, car.id)?.quantity === 1);
check('Inserat verschwunden', db.listListings(G, 1).total === 0);

console.log('--- Fremdes Inserat zurückziehen ---');
const again = db.createListing(G, SELLER, car.id, 5000);
check('nur der Verkäufer darf zurückziehen',
  db.cancelListing(G, 'FREMDER', again.listing.id).reason === 'not_seller');
check('Inserat noch da', db.listListings(G, 1).total === 1);

console.log('--- Übereignung an Käufer ---');
const taken = db.takeListing(G, BUYER, again.listing.id);
check('takeListing erfolgreich', taken.ok === true);
check('Käufer hat das Auto', db.getOwned(G, BUYER, car.id)?.quantity === 1);
check('Verkäufer hat es nicht', db.getOwned(G, SELLER, car.id) === null);
check('Inserat entfernt', db.listListings(G, 1).total === 0);

console.log('--- Rückabwicklung (Geldbuchung schlug fehl) ---');
db.restoreListing(G, BUYER, taken.listing);
check('Auto wieder beim Käufer weg', db.getOwned(G, BUYER, car.id) === null);
check('Inserat wieder im Markt', db.listListings(G, 1).total === 1);
const restored = db.listListings(G, 1).items[0];
check('Preis nach Rückabwicklung erhalten', restored.listing_price === 5000,
  String(restored.listing_price));
check('Verkäufer nach Rückabwicklung erhalten', restored.seller_id === SELLER);

console.log('--- Limit pro Spieler ---');
db.cancelListing(G, SELLER, restored.listing_id);
db.reservePurchase(G, SELLER, car.id, db.MAX_LISTINGS_PER_USER + 2);
let hitLimit = false;
for (let i = 0; i < db.MAX_LISTINGS_PER_USER + 2; i++) {
  const r = db.createListing(G, SELLER, car.id, 100);
  if (!r.ok && r.reason === 'too_many_listings') { hitLimit = true; break; }
}
check(`Limit von ${db.MAX_LISTINGS_PER_USER} Inseraten greift`, hitLimit);

console.log('--- Unbekanntes Inserat ---');
check('getListing unbekannt -> null', db.getListing(G, 999999) === null);
check('takeListing unbekannt -> not_found', db.takeListing(G, BUYER, 999999).reason === 'not_found');

console.log('--- Auto löschen räumt Inserate ab ---');
db.deleteItem(G, car.id);
check('Inserate nach Artikel-Löschung weg', db.listListings(G, 1).total === 0);

cleanup();
console.log(`\n${pass} bestanden, ${fail} fehlgeschlagen`);
process.exit(fail === 0 ? 0 : 1);
