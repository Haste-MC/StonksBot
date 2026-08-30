const db = require('./db');
const unb = require('./unb');
const identity = require('./identity');

// Späte Bindung, damit Tests die Quelle ersetzen können (§8).
const leaderboard = (...a) => unb.leaderboard(...a);

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
 * Ergänzt wird sie um die Fluxer-Spieler **ohne** Verknüpfung: Deren Geld liegt
 * im lokalen Wallet, UnbelievaBoat kennt sie gar nicht. Ohne diese Ergänzung
 * würden sie in der Rangliste fehlen, obwohl sie mitspielen.
 *
 * Nicht zu verwechseln mit `!rangliste`: Die zeigt Level, Einnahmen, Ausgaben
 * und Gesamtvermögen aus unseren eigenen Daten. `!top` ist die reine
 * Geld-Rangliste, wie man sie von UnbelievaBoat kennt.
 */

const SORTS = new Set(['total', 'cash', 'bank']);

/** Nimmt Sortier-Wünsche in mehreren Schreibweisen entgegen. */
function parseSort(input) {
  const key = String(input ?? '').toLowerCase();
  if (['cash', 'bar', 'bargeld'].includes(key)) return 'cash';
  if (['bank', 'konto'].includes(key)) return 'bank';
  return 'total';
}

/**
 * Die zusammengeführte Rangliste.
 *
 * @returns {Promise<Array<{userId,cash,bank,total,local}>>} absteigend sortiert
 */
async function fetch({ sort = 'total', limit = 15 } = {}) {
  const key = SORTS.has(sort) ? sort : 'total';
  const world = identity.world();

  // 1. UnbelievaBoat – die eigentliche Quelle für alle Discord-Konten.
  const remote = await leaderboard({ sort: key, limit: Math.max(limit, 25) })
    .catch(() => []);
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
    if ((row.total ?? 0) === 0) continue;
    entries.push({
      userId: id, cash: row.cash ?? 0, bank: row.bank ?? 0, total: row.total ?? 0, local: true,
    });
  }

  entries.sort((a, b) => b[key] - a[key]);
  return entries.slice(0, limit).map((e, i) => ({ ...e, rank: i + 1 }));
}

/** Anzeigename eines Kontos: gemerkter Name, sonst eine Erwähnung. */
function label(userId) {
  const name = identity.nameOf(userId);
  if (name) return `**${name}**`;
  // Auf Fluxer wird die Erwähnung später durch den Namen ersetzt (render.js).
  return identity.isDiscordAccount(userId) ? `<@${userId}>` : '_unbekannt_';
}

module.exports = { SORTS, parseSort, fetch, label };
