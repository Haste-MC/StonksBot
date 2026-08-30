const wallet = require('./wallet');

/**
 * ===========================================================================
 *  GELD-SCHNITTSTELLE (Fluxer-Branch)
 * ===========================================================================
 *
 * Auf `main` sprach dieses Modul mit der UnbelievaBoat-API. Auf Fluxer gibt es
 * UnbelievaBoat nicht, deshalb liegt die Wirtschaft jetzt lokal in
 * [wallet.js](./wallet.js).
 *
 * **Der Dateiname bleibt bewusst `unb.js`** und die Signaturen bleiben exakt
 * gleich: So bleibt dieser Austausch auf EINE Datei beschränkt, und die 13
 * Module, die Geld buchen (purchase, property, jobs, casinoPlay, storage,
 * buyers, tenants, npc, bills …), laufen unverändert weiter. Das hält den
 * Unterschied zu `main` klein und Merges konfliktfrei.
 *
 * Die späte Bindung (`const changeCash = (...a) => unb.changeCash(...a)`) in
 * den Aufrufern funktioniert dadurch weiterhin – auch in den Tests, die diese
 * Funktionen ersetzen (ARCHITEKTUR §8).
 */

const FALLBACK_SYMBOL = process.env.CURRENCY_SYMBOL || '🪙';

/**
 * Steht dort, wo früher der UnbelievaBoat-Client lag. `currency.js` fragt
 * darüber das Währungssymbol ab – hier kommt es aus der Konfiguration,
 * damit auch dieses Modul unverändert bleibt.
 */
const unb = {
  async getGuild() {
    return { currencySymbol: FALLBACK_SYMBOL };
  },
};

/** Guthaben eines Users: { cash, bank, total }. */
function getBalance(guildId, userId) {
  return wallet.getBalance(guildId, userId);
}

/**
 * Verändert das Bargeld eines Users (negativ = abziehen).
 * Der Grund landet im lokalen Transaktionslog (`wallet_log`).
 *
 * Jede echte Buchung vergibt Erfahrung; Storno-/Rückerstattungsbuchungen
 * übergeben `{ xp: false }` und zählen nicht mit.
 */
function changeCash(guildId, userId, amount, reason, opts = {}) {
  return wallet.changeCash(guildId, userId, amount, reason, opts);
}

/**
 * Verschiebt Geld von der Bank aufs Bargeld – nötig, wenn jemand zwar genug
 * Vermögen hat, aber nicht genug flüssig ist.
 */
function withdrawFromBank(guildId, userId, amount, reason) {
  return wallet.withdrawFromBank(guildId, userId, amount, reason);
}

module.exports = { unb, getBalance, changeCash, withdrawFromBank };
