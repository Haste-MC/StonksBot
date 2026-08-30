const db = require('./db');

/**
 * ===========================================================================
 *  WALLET – die eigene Wirtschaft (Fluxer)
 * ===========================================================================
 *
 * Auf Fluxer gibt es kein UnbelievaBoat, also liegt das Geld hier. Dieses
 * Modul ist ein **1:1-Ersatz** für die drei Funktionen, die src/unb.js nach
 * außen anbietet – gleiche Namen, gleiche Argumente, gleiche Rückgabe:
 *
 *     getBalance(guildId, userId)                  -> { cash, bank, total }
 *     changeCash(guildId, userId, amount, reason)  -> neue Bilanz
 *     withdrawFromBank(guildId, userId, amount, r) -> neue Bilanz
 *
 * Dadurch bleibt die gesamte Spiellogik (Käufe, Miete, Jobs, Casino,
 * Auktionen …) unverändert – sie merkt gar nicht, dass das Geld jetzt lokal
 * liegt.
 *
 * ================== BUCHHALTERISCHE GRUNDREGEL ==================
 * Vermögen entsteht und verschwindet AUSSCHLIESSLICH über changeCash.
 * withdrawFromBank schiebt nur zwischen Bank und Bargeld hin und her und
 * verändert die Summe nie. Daraus folgt die Invariante, die der Test
 * absichert:
 *
 *     cash + bank  ==  Startguthaben + Summe(aller changeCash-Beträge)
 * ================================================================
 *
 * Alle Schreibvorgänge sind einzelne, synchrone SQL-Anweisungen – zwischen
 * ihnen kann kein zweiter Klick dazwischenfunken (ARCHITEKTUR §7).
 */

/** Startkapital für neue Spieler, damit niemand bei null feststeckt. */
const START_CASH = Number(process.env.START_CASH || '2500');

/** Liest die Bilanz und legt den Geldbeutel beim ersten Kontakt an. */
function readBalance(guildId, userId) {
  const w = db.getWallet(guildId, userId, START_CASH);
  return { cash: w.cash, bank: w.bank, total: w.cash + w.bank };
}

/** Guthaben eines Spielers: { cash, bank, total }. */
async function getBalance(guildId, userId) {
  return readBalance(guildId, userId);
}

/**
 * Verändert das Bargeld (negativ = abziehen) und schreibt den Grund ins Log.
 *
 * Wie beim Original vergibt jede echte Buchung Erfahrung; Storno- und
 * Rückerstattungsbuchungen übergeben `{ xp: false }` und zählen nicht mit
 * (kein Doppelzählen).
 */
async function changeCash(guildId, userId, amount, reason = '', opts = {}) {
  const value = Math.round(Number(amount) || 0);

  // Eine Nullbuchung ist bedeutungslos – nur die Bilanz zurückgeben.
  // (Das Original lehnte sie mit einem API-Fehler ab.)
  if (value === 0) return readBalance(guildId, userId);

  db.getWallet(guildId, userId, START_CASH);   // sicherstellen, dass er existiert
  db.addCash(guildId, userId, value);
  db.logWallet(guildId, userId, value, reason);

  if (opts.xp !== false) {
    try { require('./level').award(guildId, userId, value); } catch { /* egal */ }
  }

  return readBalance(guildId, userId);
}

/**
 * Verschiebt Geld von der Bank aufs Bargeld (negativ = zurück auf die Bank).
 * Das Gesamtvermögen bleibt dabei unverändert – deshalb kein Log und kein XP.
 */
async function withdrawFromBank(guildId, userId, amount, reason = '') {
  const value = Math.round(Number(amount) || 0);
  if (value === 0) return readBalance(guildId, userId);

  db.getWallet(guildId, userId, START_CASH);
  db.moveToCash(guildId, userId, value);
  return readBalance(guildId, userId);
}

/** Zahlt Geld auf die Bank ein (Bargeld -> Bank). */
async function deposit(guildId, userId, amount, reason = '') {
  return withdrawFromBank(guildId, userId, -Math.abs(Math.round(Number(amount) || 0)), reason);
}

/**
 * Leert einen Geldbeutel vollständig und meldet, wie viel darin war.
 *
 * Gebraucht beim Verknüpfen: Das Zwischenguthaben eines Fluxer-Spielers wandert
 * zu UnbelievaBoat. Erst hier abräumen, dann dort gutschreiben – so kann das
 * Geld nicht doppelt existieren.
 */
function drain(guildId, accountId) {
  const before = readBalance(guildId, accountId);
  if (before.total === 0) return 0;
  if (before.bank !== 0) db.moveToCash(guildId, accountId, before.bank);
  db.addCash(guildId, accountId, -before.total);
  db.logWallet(guildId, accountId, -before.total, 'Übertrag bei Kontoverknüpfung');
  return before.total;
}

module.exports = {
  START_CASH, getBalance, changeCash, withdrawFromBank, deposit, readBalance, drain,
};
