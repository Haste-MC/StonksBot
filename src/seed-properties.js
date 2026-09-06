/**
 * Legt den Immobilienkatalog an.
 *
 * Aufruf:  node src/seed-properties.js <server-id> [--reset]
 *
 * Immobilien haben begrenzte Stückzahl, eine Tagesmiete und Stellplätze.
 * Die Kategorie landet im Feld `brand`, damit die Shop-Filterung greift.
 */
const db = require('./db');
const catalog = require('./data/properties');

let images = {};
try {
  images = require('./data/property-images.json');
} catch {
  console.warn('⚠️  src/data/property-images.json fehlt – Objekte ohne Fotos.\n');
}

const guildId = process.argv[2];
const reset = process.argv.includes('--reset');

if (!guildId || !/^[A-Za-z0-9_][A-Za-z0-9_-]{4,63}$/.test(guildId)) {
  console.error('Aufruf: node src/seed-properties.js <server-id> [--reset]');
  process.exit(1);
}

if (reset) {
  const existing = db.allItemsOfKind(guildId, 'property');
  for (const item of existing) db.deleteItem(guildId, item.id);
  console.log(`🗑️  ${existing.length} vorhandene Immobilien gelöscht.\n`);
}

// Derselbe Abgleich, den auch der Bot beim Start macht: nur Fehlendes anlegen.
const result = require('./seed').ensureCatalog(guildId, 'property');
const added = result.added.length;
const skipped = catalog.length - added;
const withoutImage = result.added.filter((name) => !images[name]).length;

// Übersicht nach Kategorie.
const all = db.allItemsOfKind(guildId, 'property');
const byCategory = {};
for (const i of all) {
  const c = byCategory[i.brand] ??= { n: 0, min: Infinity, max: 0, slots: 0 };
  c.n++;
  c.min = Math.min(c.min, i.price);
  c.max = Math.max(c.max, i.price);
  c.slots = Math.max(c.slots, i.garage);
}

console.log('Immobilien im Katalog:');
for (const [name, c] of Object.entries(byCategory)) {
  console.log(`  ${name.padEnd(10)} ${String(c.n).padStart(2)} Objekte  ` +
    `${c.min.toLocaleString('de-DE').padStart(10)} – ${c.max.toLocaleString('de-DE').padStart(10)}  ` +
    `bis ${c.slots} Stellplätze`);
}

const totalUnits = all.reduce((s, i) => s + (i.stock ?? 0), 0);
console.log(`\n${added} Objekte angelegt, ${skipped} übersprungen.`);
console.log(`${totalUnits} Einheiten insgesamt verfügbar (begrenzte Stückzahl).`);
if (withoutImage) console.log(`${withoutImage} ohne Foto.`);
