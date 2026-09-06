/**
 * Legt den Fahrzeugkatalog in der Datenbank an.
 *
 * Aufruf:  node src/seed-cars.js <server-id> [--reset]
 *
 * Die Autos stehen in src/data/catalog.js, die zugehörigen Fotos in
 * src/data/images.json (erzeugt von scripts/fetch-images.js). Autos ohne
 * Foto werden trotzdem angelegt – sie zeigen dann nur kein Bild.
 */
const db = require('./db');
const catalog = require('./data/catalog');

let images = {};
try {
  images = require('./data/images.json');
} catch {
  console.warn('⚠️  src/data/images.json fehlt – Autos werden ohne Fotos angelegt.');
  console.warn('   Erzeugen mit: node scripts/fetch-images.js\n');
}

const guildId = process.argv[2];
const reset = process.argv.includes('--reset');

if (!guildId || !/^[A-Za-z0-9_][A-Za-z0-9_-]{4,63}$/.test(guildId)) {
  console.error('Aufruf: node src/seed-cars.js <server-id> [--reset]');
  process.exit(1);
}

if (reset) {
  let removed = 0;
  for (;;) {
    const { items } = db.listItems(guildId, 1);
    if (items.length === 0) break;
    for (const i of items) { db.deleteItem(guildId, i.id); removed++; }
  }
  console.log(`🗑️  ${removed} vorhandene Artikel gelöscht.\n`);
}

// Derselbe Abgleich, den auch der Bot beim Start macht: nur Fehlendes anlegen.
const result = require('./seed').ensureCatalog(guildId, 'car');
const added = result.added.length;
const skipped = catalog.length - added;
const withoutImage = result.added.filter((name) => !images[name]).length;

// Übersicht nach Marken.
const brands = db.listBrands(guildId);
console.log('Marken im Katalog:');
for (const b of brands) {
  console.log(`  ${b.brand.padEnd(16)} ${String(b.n).padStart(2)} Autos  ` +
    `${b.min_price.toLocaleString('de-DE')} – ${b.max_price.toLocaleString('de-DE')}`);
}

console.log(`\n${added} Autos angelegt, ${skipped} übersprungen (schon vorhanden).`);
if (withoutImage) console.log(`${withoutImage} davon ohne Foto.`);
