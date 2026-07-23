/**
 * Legt den Ausrüstungs-Shop an (Werkzeug, Führerscheine, Qualifikationen).
 *
 * Aufruf:  node src/seed-gear.js <server-id> [--reset]
 *
 * Diese Artikel sind Voraussetzung für Jobs im Arbeitsamt. Die Kategorie
 * wird im Feld `brand` gespeichert, damit die Shop-Filterung sie nutzen kann.
 */
const db = require('./db');
const gear = require('./data/gear');
const jobs = require('./data/jobs');

const guildId = process.argv[2];
const reset = process.argv.includes('--reset');

if (!guildId || !/^\d{17,20}$/.test(guildId)) {
  console.error('Aufruf: node src/seed-gear.js <server-id> [--reset]');
  process.exit(1);
}

if (reset) {
  const existing = db.allItemsOfKind(guildId, 'gear');
  for (const item of existing) db.deleteItem(guildId, item.id);
  console.log(`🗑️  ${existing.length} vorhandene Ausrüstungsartikel gelöscht.\n`);
}

let added = 0, skipped = 0;
for (const item of gear) {
  try {
    db.createItem({
      guildId,
      name: item.name,
      price: item.price,
      description: item.description,
      emoji: item.emoji,
      brand: item.category,
      kind: 'gear',
      stock: null,
      createdBy: 'seed',
    });
    added++;
  } catch (err) {
    if (String(err.message).includes('UNIQUE')) { skipped++; continue; }
    throw err;
  }
}

// Gegenprüfung: Verlangt ein Job Ausrüstung, die es gar nicht zu kaufen gibt?
const available = new Set(db.allItemsOfKind(guildId, 'gear').map((i) => i.name.toLowerCase()));
const unbuyable = new Set();
for (const job of jobs) {
  for (const req of job.requires ?? []) {
    if (req.item && !available.has(req.item.toLowerCase())) unbuyable.add(`${req.item} (${job.title})`);
  }
}

console.log(`${added} Artikel angelegt, ${skipped} übersprungen.`);

if (unbuyable.size) {
  console.log('\n⚠️  Diese Voraussetzungen sind nirgends käuflich:');
  for (const u of unbuyable) console.log(`   - ${u}`);
  process.exitCode = 1;
} else {
  console.log('✅ Jede Job-Voraussetzung ist im Shop erhältlich.');
}
