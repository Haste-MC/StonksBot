const db = require('./db');

/**
 * ===========================================================================
 *  KATALOG-ABGLEICH
 * ===========================================================================
 *
 * Der Shop liest seine Artikel aus der **Datenbank**, nicht aus den
 * Katalogdateien: Admins dürfen Preise ändern, eigene Artikel anlegen und
 * welche löschen. Neue Sachen aus einem Update landen dadurch aber nicht von
 * allein im Laden – bei den Heist-Werkzeugen ist genau das passiert: Sie
 * standen im Katalog und waren im Shop nirgends zu finden.
 *
 * Dieser Abgleich schließt die Lücke für **alle drei Kataloge** – Ausrüstung,
 * Autos und Immobilien. Er läuft bei jedem Start und ist bewusst nur additiv:
 *
 *   • fehlende Artikel werden angelegt,
 *   • vorhandene bleiben unangetastet – auch von Hand geänderte Preise,
 *     Beschreibungen und Bestände,
 *   • **gelöschte bleiben gelöscht**: `/removeitem` merkt sich den Namen
 *     (`catalog_removed`), und der Abgleich überspringt ihn. Sonst käme jeder
 *     bewusst entfernte Artikel beim nächsten Neustart zurück.
 *
 * Betrifft nur den **Shop** (Tabelle `items`). Reine Spieldaten – Jobs,
 * Heist-Ziele, Szenen, Fundstücke, Länder … – werden direkt aus den Dateien
 * gelesen; die sind nach einem Neustart ohnehin sofort da.
 */

/** Bilder sind optional: fehlt die Datei, werden Artikel ohne Foto angelegt. */
function imagesOf(file) {
  try { return require(file); } catch { return {}; }
}

/**
 * Die drei Kataloge, jeweils übersetzt in die Felder von `createItem`.
 *
 * Ein neuer Katalog = ein Eintrag hier. Die Reihenfolge bestimmt nur, was
 * zuerst in der Startmeldung steht.
 */
const CATALOGS = [
  {
    kind: 'gear',
    label: 'Ausrüstungsartikel',
    emoji: '🧰',
    entries: () => require('./data/gear').map((item) => ({
      name: item.name,
      price: item.price,
      description: item.description,
      emoji: item.emoji,
      brand: item.category,
      kind: 'gear',
      stock: null,
    })),
  },
  {
    kind: 'car',
    label: 'Autos',
    emoji: '🚗',
    entries: () => {
      const images = imagesOf('./data/images.json');
      return require('./data/catalog').map((car) => ({
        name: car.name,
        price: car.price,
        description: car.spec,
        emoji: car.emoji,
        brand: car.brand,
        kind: 'car',
        stock: null,
        imageUrl: images[car.name]?.url ?? '',
        attribution: images[car.name]?.attribution ?? '',
      }));
    },
  },
  {
    kind: 'property',
    label: 'Immobilien',
    emoji: '🏘️',
    entries: () => {
      const images = imagesOf('./data/property-images.json');
      return require('./data/properties').map((entry) => ({
        name: entry.name,
        price: entry.price,
        description: entry.description,
        emoji: entry.emoji,
        brand: entry.category,
        kind: 'property',
        stock: entry.stock,
        garage: entry.garage,
        rent: entry.rent,
        imageUrl: images[entry.name]?.url ?? '',
        attribution: images[entry.name]?.attribution ?? '',
      }));
    },
  },
];

const catalogOf = (kind) => CATALOGS.find((c) => c.kind === kind) ?? null;

/**
 * Trägt fehlende Artikel EINES Katalogs nach.
 * @returns {{added: string[], had: number, skipped: number}}
 */
function ensureCatalog(guildId, kind) {
  const catalog = catalogOf(kind);
  if (!catalog) return { added: [], had: 0, skipped: 0 };

  const existing = new Set(
    db.allItemsOfKind(guildId, kind).map((i) => i.name.toLowerCase()));
  const removed = db.removedNames(guildId, kind);
  const added = [];
  let skipped = 0;

  for (const item of catalog.entries()) {
    const key = item.name.toLowerCase();
    if (existing.has(key)) continue;
    // Bewusst gelöscht: nicht wieder anlegen (siehe Kopf).
    if (removed.has(key)) { skipped++; continue; }

    try {
      db.createItem({ guildId, createdBy: 'seed', ...item });
      added.push(item.name);
    } catch (err) {
      // Doppelter Name: dann steht er schon drin, alles gut.
      if (!String(err.message).includes('UNIQUE')) throw err;
    }
  }

  return { added, had: existing.size, skipped };
}

/** Alte Schreibweise – der Ausrüstungskatalog ist nur einer von dreien. */
const ensureGear = (guildId) => ensureCatalog(guildId, 'gear');

/**
 * Beim Start aufrufen: alle Kataloge nachtragen und kurz Bescheid sagen.
 * Ein Fehler hier darf den Start nie verhindern.
 */
function syncCatalogs(guildId) {
  const result = {};
  for (const catalog of CATALOGS) {
    try {
      const res = ensureCatalog(guildId, catalog.kind);
      result[catalog.kind] = res;
      if (res.added.length) {
        const names = res.added.slice(0, 8).join(', ')
          + (res.added.length > 8 ? ` … (+${res.added.length - 8})` : '');
        console.log(`${catalog.emoji} ${res.added.length} neue ${catalog.label} `
          + `nachgetragen: ${names}`);
      }
    } catch (err) {
      console.warn(`⚠️  Katalog-Abgleich (${catalog.label}) fehlgeschlagen:`, err.message);
      result[catalog.kind] = { added: [], had: 0, skipped: 0 };
    }
  }
  return result;
}

module.exports = { CATALOGS, catalogOf, ensureCatalog, ensureGear, syncCatalogs };
