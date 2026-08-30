const { Client } = require('unb-api');
const wallet = require('./wallet');
const identity = require('./identity');

/**
 * ===========================================================================
 *  GELD-SCHNITTSTELLE (duo-Branch: Discord + Fluxer)
 * ===========================================================================
 *
 * Der Bot läuft auf beiden Plattformen mit **gemeinsamem Fortschritt**. Geld
 * kann aber nur EINE Wahrheit haben – und das bleibt **UnbelievaBoat**, damit
 * der bestehende Discord-Kontostand erhalten bleibt und die dortigen Befehle
 * (`!bal`, `!work` …) weiter stimmen.
 *
 * Deshalb entscheidet dieses Modul pro Konto:
 *
 *   Konto ist ein Discord-Konto      -> UnbelievaBoat (echter Kontostand)
 *   Fluxer-Spieler ohne Verknüpfung  -> lokales Wallet (eigener Zwischenstand)
 *
 * Sobald so jemand `!link` benutzt, wandert sein lokales Guthaben einmalig zu
 * UnbelievaBoat (siehe accounts.js) und er ist danach vollständig integriert.
 *
 * Die Signaturen bleiben exakt wie bisher, damit die 13 geldbuchenden Module
 * unverändert weiterlaufen (ARCHITEKTUR §2/§8).
 */

const token = process.env.UNB_TOKEN || '';
const unbClient = token ? new Client(token, { maxRetries: 3 }) : null;

/**
 * Der Discord-Server, unter dem UnbelievaBoat die Konten führt.
 *
 * Wichtig: Die Spiellogik übergibt inzwischen die **Welt**, nicht mehr die
 * echte Server-ID (siehe identity.js). UnbelievaBoat kennt aber nur seinen
 * Discord-Server – deshalb hier die echte ID.
 */
const UNB_GUILD =
  process.env.UNB_GUILD_ID || process.env.DISCORD_GUILD_ID
  || process.env.WORLD_ID || process.env.DEV_GUILD_ID || '';

/** Läuft dieses Konto über UnbelievaBoat? */
function viaUnb(accountId) {
  return Boolean(unbClient) && UNB_GUILD && identity.isDiscordAccount(accountId);
}

const unb = {
  async getGuild(guildId) {
    if (unbClient && UNB_GUILD) return unbClient.getGuild(UNB_GUILD);
    return { currencySymbol: process.env.CURRENCY_SYMBOL || '🪙' };
  },
};

/** Guthaben eines Kontos: { cash, bank, total }. */
async function getBalance(guildId, accountId) {
  if (viaUnb(accountId)) return unbClient.getUserBalance(UNB_GUILD, accountId);
  return wallet.getBalance(guildId, accountId);
}

/**
 * Verändert das Bargeld (negativ = abziehen). Der Grund landet im Log der
 * jeweiligen Quelle.
 *
 * Jede echte Buchung vergibt Erfahrung; Storno-/Rückerstattungsbuchungen
 * übergeben `{ xp: false }` und zählen nicht mit (kein Doppelzählen).
 */
async function changeCash(guildId, accountId, amount, reason, opts = {}) {
  if (!viaUnb(accountId)) {
    // Das lokale Wallet vergibt die Erfahrung bereits selbst.
    return wallet.changeCash(guildId, accountId, amount, reason, opts);
  }

  const balance = await unbClient.editUserBalance(
    UNB_GUILD, accountId, { cash: amount }, reason);

  if (opts.xp !== false) {
    try { require('./level').award(guildId, accountId, amount); } catch { /* egal */ }
  }
  return balance;
}

/** Verschiebt Geld von der Bank aufs Bargeld (negativ = zurück auf die Bank). */
async function withdrawFromBank(guildId, accountId, amount, reason) {
  if (!viaUnb(accountId)) return wallet.withdrawFromBank(guildId, accountId, amount, reason);
  return unbClient.editUserBalance(
    UNB_GUILD, accountId, { cash: amount, bank: -amount }, reason);
}

/**
 * Die echte Geld-Rangliste von UnbelievaBoat.
 *
 * Anders als bei den Befehlen (`!work`, `!rob` …) gibt es hierfür einen
 * Endpunkt – die Liste lässt sich also direkt lesen, statt sie nachzubauen.
 * Ein Aufruf liefert alle Plätze; wir müssen nicht je Spieler abfragen.
 *
 * @returns {Promise<Array<{user_id,cash,bank,total,rank}>>} leer, wenn
 *   UnbelievaBoat nicht eingerichtet ist.
 */
async function leaderboard({ sort = 'total', limit = 25 } = {}) {
  if (!unbClient || !UNB_GUILD) return [];
  const result = await unbClient.getGuildLeaderboard(UNB_GUILD, { sort, limit });
  return Array.isArray(result) ? result : (result?.users ?? []);
}

module.exports = {
  unb, getBalance, changeCash, withdrawFromBank, leaderboard, viaUnb, UNB_GUILD,
};
