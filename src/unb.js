const { Client } = require('unb-api');
const { unbToken } = require('./config');

// Ein einziger, geteilter Client für den ganzen Bot.
// maxRetries: der Wrapper wartet bei 429 (Rate Limit) automatisch und wiederholt.
const unb = new Client(unbToken, { maxRetries: 3 });

/** Guthaben eines Users: { cash, bank, total }. */
function getBalance(guildId, userId) {
  return unb.getUserBalance(guildId, userId);
}

/**
 * Verändert das Bargeld eines Users (negativ = abziehen).
 * Der Grund taucht im UnbelievaBoat-Log auf.
 *
 * Jede echte Buchung vergibt Erfahrung (siehe src/level.js). Storno- und
 * Rückerstattungsbuchungen übergeben `{ xp: false }`, damit ein fehlgeschlagener
 * Kauf das Level nicht doppelt füttert. `require` erfolgt lazy, um einen
 * Ladezyklus (level → db) zu vermeiden; ein XP-Fehler darf den Geldfluss nie
 * stören, deshalb bewusst verschluckt.
 */
function changeCash(guildId, userId, amount, reason, opts = {}) {
  const p = unb.editUserBalance(guildId, userId, { cash: amount }, reason);
  if (opts.xp !== false) {
    p.then(() => {
      try { require('./level').award(guildId, userId, amount); } catch { /* egal */ }
    }).catch(() => {});
  }
  return p;
}

/**
 * Verschiebt Geld von der Bank aufs Bargeld – nötig, wenn jemand zwar
 * genug Vermögen hat, aber nicht genug flüssig ist.
 */
function withdrawFromBank(guildId, userId, amount, reason) {
  return unb.editUserBalance(guildId, userId, { cash: amount, bank: -amount }, reason);
}

module.exports = { unb, getBalance, changeCash, withdrawFromBank };
