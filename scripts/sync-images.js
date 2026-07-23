/**
 * Überträgt geänderte Fotos aus den *-images.json in die Datenbank.
 *
 * Aufruf:  node scripts/sync-images.js <server-id> [--check]
 *
 * Nötig, weil der Bot seine Bilder aus der Datenbank liest – die JSON-Dateien
 * sind nur die Vorlage für den Seed. Wer dort eine URL austauscht, muss sie
 * hierüber nachziehen.
 *
 * Bewusst zerstörungsfrei: es wird ausschließlich das Bild aktualisiert.
 * Ein `--reset` des Seeds würde Artikel löschen und per ON DELETE CASCADE
 * auch die Inventare der Spieler mitnehmen.
 *
 * Mit --check wird nur berichtet, nichts geschrieben.
 */
const db = require('../src/db');

const SOURCES = [
  { kind: 'car', file: '../src/data/images.json', label: 'Autos' },
  { kind: 'property', file: '../src/data/property-images.json', label: 'Immobilien' },
];

const guildId = process.argv[2];
const checkOnly = process.argv.includes('--check');

if (!guildId || !/^\d{17,20}$/.test(guildId)) {
  console.error('Aufruf: node scripts/sync-images.js <server-id> [--check]');
  process.exit(1);
}

const UA = 'DiscordCarShopBot/1.0';

async function reachable(url) {
  try {
    const res = await fetch(url, { method: 'HEAD', headers: { 'User-Agent': UA } });
    const type = (res.headers.get('content-type') || '').split(';')[0];
    return res.ok && /^image\/(jpeg|png|gif|webp)$/.test(type)
      ? { ok: true, type }
      : { ok: false, reason: `${res.status} ${type || 'kein Bildtyp'}` };
  } catch (err) {
    return { ok: false, reason: err.message };
  }
}

(async () => {
  let changed = 0, unchanged = 0, missing = 0, broken = 0;

  for (const source of SOURCES) {
    let images;
    try {
      images = require(source.file);
    } catch {
      console.log(`⏭️  ${source.label}: keine JSON gefunden, übersprungen.`);
      continue;
    }

    console.log(`\n=== ${source.label} ===`);
    const items = db.allItemsOfKind(guildId, source.kind);

    for (const item of items) {
      const wanted = images[item.name];
      if (!wanted) {
        missing++;
        console.log(`⚠️  ${item.name}: kein Eintrag in der JSON`);
        continue;
      }

      if (wanted.url === item.image_url && wanted.attribution === item.attribution) {
        unchanged++;
        continue;
      }

      // Vor dem Übernehmen prüfen – ein kaputtes Bild macht das Embed unbrauchbar.
      const check = await reachable(wanted.url);
      if (!check.ok) {
        broken++;
        console.log(`❌ ${item.name}: neue URL nicht nutzbar (${check.reason})`);
        console.log(`   ${wanted.url}`);
        continue;
      }

      if (checkOnly) {
        console.log(`🔄 ${item.name}: würde aktualisiert werden`);
      } else {
        db.updateItemImage(guildId, item.name, wanted.url, wanted.attribution);
        console.log(`✅ ${item.name}: Bild aktualisiert`);
      }
      changed++;
    }
  }

  console.log(`\n${changed} ${checkOnly ? 'zu ändern' : 'geändert'}, ` +
    `${unchanged} unverändert, ${missing} ohne JSON-Eintrag, ${broken} kaputt.`);
  if (broken) process.exitCode = 1;
})();
