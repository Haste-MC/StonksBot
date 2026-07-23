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

if (!guildId || !/^\d{17,20}$/.test(guildId)) {
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

let added = 0, skipped = 0, withoutImage = 0;

for (const car of catalog) {
  const image = images[car.name];
  if (!image) withoutImage++;

  try {
    db.createItem({
      guildId,
      name: car.name,
      price: car.price,
      description: car.spec,
      emoji: car.emoji,
      brand: car.brand,
      stock: null,
      createdBy: 'seed',
      imageUrl: image?.url ?? '',
      attribution: image?.attribution ?? '',
    });
    added++;
  } catch (err) {
    if (String(err.message).includes('UNIQUE')) { skipped++; continue; }
    throw err;
  }
}

// Übersicht nach Marken.
const brands = db.listBrands(guildId);
console.log('Marken im Katalog:');
for (const b of brands) {
  console.log(`  ${b.brand.padEnd(16)} ${String(b.n).padStart(2)} Autos  ` +
    `${b.min_price.toLocaleString('de-DE')} – ${b.max_price.toLocaleString('de-DE')}`);
}

console.log(`\n${added} Autos angelegt, ${skipped} übersprungen (schon vorhanden).`);
if (withoutImage) console.log(`${withoutImage} davon ohne Foto.`);
