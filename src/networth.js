const db = require('./db');

/**
 * ===========================================================================
 *  VERMÖGEN (Networth) – eine einzige Wahrheit
 * ===========================================================================
 *
 * Vorher rechnete jede Ansicht ihr eigenes „Vermögen" zusammen, und jede
 * vergaß etwas anderes: Das Profil zählte das Depot mit, die Rangliste nicht,
 * und die **Sammlung aus den Auktionen** kam nirgends vor – obwohl dort bei
 * manchen 50.000 liegen. Deshalb steht die Rechnung ab jetzt nur noch hier.
 *
 *     Vermögen = Bargeld + Bank + Autos + Immobilien + Depot + Sammlung
 *
 * Alle Bestandteile außer dem Geld liegen synchron in SQLite (§7) – die
 * Rechnung kostet also keine API-Abfrage. Nur das Guthaben selbst kommt bei
 * Discord-Konten von UnbelievaBoat, und genau deshalb lässt sich hier ein
 * bereits bekanntes Guthaben übergeben (die Ranglisten holen alle Kontostände
 * mit EINEM Aufruf und reichen sie durch).
 */

/** Wie die Bestandteile heißen und aussehen – für Fuß- und Detailzeilen. */
const PARTS = [
  { key: 'garage', label: 'Autos', emoji: '🚗' },
  { key: 'realty', label: 'Immobilien', emoji: '🏠' },
  { key: 'depot', label: 'Depot', emoji: '📈' },
  { key: 'collection', label: 'Sammlung', emoji: '🏺' },
];

/**
 * Alles, was jemand BESITZT – ohne Bargeld und Bank. Synchron und billig.
 * @returns {{garage,realty,depot,collection,total}}
 */
function assetsOf(guildId, userId) {
  const garage = db.garageValue(guildId, userId) || 0;
  const realty = db.propertyValue(guildId, userId) || 0;
  const depot = Math.round(require('./wallstreet').portfolio(guildId, userId).value || 0);
  const collection = db.lootSummary(guildId, userId).value || 0;
  return { garage, realty, depot, collection, total: garage + realty + depot + collection };
}

/** IDs aller Spieler, die irgendetwas besitzen (auch ohne Geld). */
function owners(guildId) {
  return db.assetOwners(guildId);
}

/**
 * Das vollständige Vermögen eines Spielers.
 *
 * @param {object|null} balance vorab bekanntes Guthaben ({cash,bank,total}) –
 *   spart die Abfrage. Ohne Angabe wird es geholt; scheitert das (kein Token,
 *   API weg), zählt nur der Besitz, statt die ganze Zeile ausfallen zu lassen.
 */
async function of(guildId, userId, balance = null) {
  // Späte Bindung, damit Tests die Geldquelle ersetzen können (§8).
  const bal = balance ?? await require('./unb').getBalance(guildId, userId).catch(() => null);
  const assets = assetsOf(guildId, userId);
  const cash = bal?.cash ?? 0;
  const bank = bal?.bank ?? 0;
  const liquid = bal ? (bal.total ?? cash + bank) : 0;

  return {
    ...assets,
    cash,
    bank,
    liquid,
    assets: assets.total,
    total: liquid + assets.total,
    known: Boolean(bal),
  };
}

/**
 * Kurzform der Bestandteile für eine Zeile, z.B.
 * „🚗 12.000 · 🏺 50.000". Leere Posten bleiben weg – sonst steht überall 0.
 */
function breakdown(worth, format) {
  return PARTS.filter((p) => (worth[p.key] || 0) > 0)
    .map((p) => `${p.emoji} ${format(worth[p.key])}`)
    .join(' · ');
}

module.exports = { PARTS, assetsOf, owners, of, breakdown };
