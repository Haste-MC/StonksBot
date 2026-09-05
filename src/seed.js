const db = require('./db');
const gearData = require('./data/gear');

/**
 * ===========================================================================
 *  KATALOG-ABGLEICH
 * ===========================================================================
 *
 * Der Shop liest seine Artikel aus der **Datenbank**, nicht aus den
 * Katalogdateien: Admins dürfen Preise ändern, eigene Artikel anlegen und
 * welche löschen. Neue Ausrüstung aus einem Update landet dadurch aber nicht
 * von allein im Laden – bei den Heist-Werkzeugen ist genau das passiert: Sie
 * standen im Katalog und waren im Shop nirgends zu finden.
 *
 * Dieser Abgleich schließt die Lücke. Er ist bewusst **nur additiv**:
 *
 *   • fehlende Artikel werden angelegt,
 *   • vorhandene bleiben unangetastet (auch geänderte Preise),
 *   • gelöschte kommen NICHT zurück – wer etwas rausgeworfen hat, hat das
 *     absichtlich getan.
 */

/**
 * Trägt fehlende Ausrüstung nach.
 * @returns {{added: string[], had: number}}
 */
function ensureGear(guildId) {
  const existing = new Set(
    db.allItemsOfKind(guildId, 'gear').map((i) => i.name.toLowerCase()));
  const added = [];

  for (const item of gearData) {
    if (existing.has(item.name.toLowerCase())) continue;
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
      added.push(item.name);
    } catch (err) {
      // Doppelter Name: dann steht er schon drin, alles gut.
      if (!String(err.message).includes('UNIQUE')) throw err;
    }
  }

  return { added, had: existing.size };
}

/** Beim Start aufrufen: trägt nach und sagt kurz Bescheid. */
function syncCatalogs(guildId) {
  try {
    const gear = ensureGear(guildId);
    if (gear.added.length) {
      console.log(`🧰 ${gear.added.length} neue Ausrüstungsartikel nachgetragen: `
        + `${gear.added.join(', ')}`);
    }
    return gear;
  } catch (err) {
    console.warn('⚠️  Katalog-Abgleich fehlgeschlagen:', err.message);
    return { added: [], had: 0 };
  }
}

module.exports = { ensureGear, syncCatalogs };
