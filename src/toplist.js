const db = require('./db');
const unb = require('./unb');
const identity = require('./identity');
const networth = require('./networth');

// Späte Bindung, damit Tests die Quelle ersetzen können (§8).
const leaderboard = (...a) => unb.leaderboard(...a);
const getBalance = (...a) => unb.getBalance(...a);

/**
 * ===========================================================================
 *  GELD-RANGLISTE (!top)
 * ===========================================================================
 *
 * Anders als `!work` oder `!rob` lässt sich die Rangliste tatsächlich **lesen**:
 * UnbelievaBoat hat dafür einen Endpunkt. Sie muss also nicht nachgebaut
 * werden – ein Aufruf liefert alle Plätze auf einmal, statt je Spieler
 * nachzufragen.
 *
 * Ergänzt wird sie um alles, was UnbelievaBoat NICHT weiß:
 *
 *  - **Fluxer-Spieler ohne Verknüpfung** – ihr Geld liegt im lokalen Wallet.
 *  - **Besitz** – Autos, Immobilien, Depot und die Sammlung aus den Auktionen
 *    (siehe networth.js). Jede Zeile trägt deshalb neben dem Geld auch
 *    `assets` und `networth`, und `!top vermögen` sortiert danach.
 *
 * Erst dadurch ist es **unsere** Rangliste und nicht bloß eine Kopie der
 * fremden: Wer nichts auf dem Konto hat, aber eine Sammlung für 50.000, steht
 * hier – dort nicht.
 *
 * Nicht zu verwechseln mit `!rangliste`: Die zeigt Level, Einnahmen und
 * Ausgaben aus unseren eigenen Daten. `!top` rankt Geld und Besitz.
 */

const SORTS = new Set(['total', 'cash', 'bank', 'networth']);

/**
 * Wie viele Kontostände einzeln nachgeschlagen werden dürfen.
 *
 * Besitzer, die UnbelievaBoat nicht in seiner Rangliste führt, kosten je eine
 * Abfrage. Ohne Deckel könnte ein Server mit hunderten Autobesitzern die API
 * fluten – lieber ein paar Zeilen ungenau als ein Ratelimit.
 */
const MAX_LOOKUPS = 25;

/** Nimmt Sortier-Wünsche in mehreren Schreibweisen entgegen. */
function parseSort(input) {
  const key = String(input ?? '').toLowerCase();
  if (['cash', 'bar', 'bargeld'].includes(key)) return 'cash';
  if (['bank', 'konto'].includes(key)) return 'bank';
  if (['networth', 'vermögen', 'vermoegen', 'gesamt', 'alles', 'besitz'].includes(key)) {
    return 'networth';
  }
  return 'total';
}

/**
 * Die zusammengeführte Rangliste.
 *
 * Drei Quellen, damit **jeder** auftaucht, der irgendetwas hat:
 *   1. UnbelievaBoat – alle Discord-Konten mit Geld, in EINEM Aufruf.
 *   2. Lokale Geldbeutel – Fluxer-Spieler ohne Verknüpfung.
 *   3. Besitzer ohne Geld – wer nur Autos, Aktien oder Fundstücke hat, wäre
 *      sonst unsichtbar, obwohl sein Besitz zählt (siehe networth.js).
 *
 * Jede Zeile trägt zusätzlich `assets` und `networth`; das Sortieren nach
 * `networth` braucht dadurch keine einzige weitere Abfrage.
 *
 * @returns {Promise<Array<{userId,cash,bank,total,assets,networth,local}>>}
 *   absteigend sortiert
 */
async function fetch({ sort = 'total', limit = 15 } = {}) {
  const key = SORTS.has(sort) ? sort : 'total';
  const world = identity.world();

  // 1. UnbelievaBoat – die eigentliche Quelle für alle Discord-Konten.
  //    Beim Vermögen entscheidet am Ende ohnehin unsere eigene Summe, für den
  //    Abruf zählt dort also das Gesamtguthaben.
  const remote = await leaderboard({
    sort: key === 'networth' ? 'total' : key, limit: Math.max(limit, 100),
  }).catch(() => []);
  const entries = remote.map((u) => ({
    userId: String(u.user_id),
    cash: u.cash ?? 0,
    bank: u.bank ?? 0,
    total: u.total ?? (u.cash ?? 0) + (u.bank ?? 0),
    local: false,
  }));

  // 2. Fluxer-Spieler ohne Verknüpfung: Ihr Geld liegt lokal, UnbelievaBoat
  //    kennt sie nicht. Nur solche Konten – verknüpfte stehen schon oben.
  const seen = new Set(entries.map((e) => e.userId));
  for (const row of db.walletTop(world, 100)) {
    const id = String(row.user_id);
    if (identity.isDiscordAccount(id) || seen.has(id)) continue;
    seen.add(id);
    entries.push({
      userId: id, cash: row.cash ?? 0, bank: row.bank ?? 0, total: row.total ?? 0, local: true,
    });
  }

  // 3. Besitz ohne Guthaben: Ein leerer Geldbeutel neben einer Sammlung für
  //    50.000 ist kein Grund, jemanden aus der Rangliste zu werfen.
  let lookups = 0;
  for (const id of networth.owners(world)) {
    if (seen.has(id)) continue;
    seen.add(id);
    const discord = identity.isDiscordAccount(id);
    // Wen UnbelievaBoat nicht führt, fragen wir einzeln – aber nicht endlos.
    const bal = discord && lookups++ < MAX_LOOKUPS
      ? await getBalance(world, id).catch(() => null)
      : null;
    entries.push({
      userId: id,
      cash: bal?.cash ?? 0,
      bank: bal?.bank ?? 0,
      total: bal?.total ?? 0,
      local: !discord,
    });
  }

  // Besitz dazurechnen (synchron aus SQLite, kostet keine Abfrage).
  for (const e of entries) {
    const assets = networth.assetsOf(world, e.userId);
    e.assets = assets.total;
    e.garage = assets.garage;
    e.realty = assets.realty;
    e.depot = assets.depot;
    e.collection = assets.collection;
    e.networth = e.total + assets.total;
  }

  return entries
    .filter((e) => e.total > 0 || e.assets > 0)
    .sort((a, b) => b[key] - a[key])
    .slice(0, limit)
    .map((e, i) => ({ ...e, rank: i + 1 }));
}

/**
 * Anzeigename eines Kontos.
 *
 * Ein gemerkter Name gewinnt – auch bei Discord-Konten, denn in der Rangliste
 * liest sich „**Kevin**" besser als eine Erwähnung, die auf Fluxer ohnehin
 * ersetzt würde. Sonst übernimmt identity.mention (nie eine rohe ID).
 */
function label(userId) {
  const name = identity.nameOf(userId);
  return name ? `**${name}**` : identity.mention(userId);
}

module.exports = { SORTS, parseSort, fetch, label };
