const db = require('./db');

/**
 * ===========================================================================
 *  IDENTITÄT – eine Welt, ein Konto, zwei Plattformen
 * ===========================================================================
 *
 * Der Bot läuft auf Discord UND Fluxer, und ein Spieler soll überall
 * denselben Fortschritt haben (Cross-Progression).
 *
 * Die gesamte Spiellogik arbeitet mit `(guildId, userId)` und behandelt beides
 * als undurchsichtige Zeichenketten. Genau das nutzen wir aus: An der
 * **Außengrenze** (dort, wo eine Discord- oder Fluxer-Nachricht hereinkommt)
 * werden die Plattform-IDs auf ein gemeinsames Paar übersetzt:
 *
 *     Discord (guild 561…, user 498…)  ┐
 *                                       ├─►  (WELT, konto)
 *     Fluxer  (guild abc,   user xyz)  ┘
 *
 * Dadurch bleibt die komplette Spiellogik unverändert – sie merkt nicht
 * einmal, dass es zwei Plattformen gibt.
 *
 * ================== WARUM DIE DISCORD-ID DAS KONTO IST ==================
 * Der bestehende Discord-Fortschritt liegt bereits unter der Discord-User-ID.
 * Nimmt man sie als kanonisches Konto und die Discord-Server-ID als Welt,
 * bleibt alles Vorhandene erhalten – ohne Datenwanderung.
 * ========================================================================
 */

/**
 * Die gemeinsame Welt. Alle Server (Discord wie Fluxer) teilen sich diese –
 * so wirkt ein Fortschritt überall.
 *
 * Standard ist die bestehende Discord-Server-ID, damit der vorhandene
 * Spielstand weiterlebt. Über `WORLD_ID` in der .env änderbar.
 */
const WORLD_ID =
  process.env.WORLD_ID || process.env.DISCORD_GUILD_ID || process.env.DEV_GUILD_ID || 'world';

/**
 * Warnt, wenn die Welt nicht ausdrücklich gesetzt ist.
 *
 * Das ist der gefährlichste Stolperstein der ganzen Zusammenführung: Zeigt
 * WORLD_ID nicht auf die bestehende Discord-Server-ID, liegt der alte
 * Spielstand unter einer anderen Welt – alles wirkt gelöscht (ist es aber
 * nicht). Deshalb hier laut sein.
 */
function checkWorld() {
  if (process.env.WORLD_ID) return true;
  console.warn(
    `⚠️  WORLD_ID ist nicht gesetzt – benutze "${WORLD_ID}".\n` +
    '   Trage in der .env WORLD_ID=<deine Discord-Server-ID> ein, sonst ist der\n' +
    '   bestehende Spielstand (Autos, Immobilien, Level) nicht sichtbar.');
  return false;
}

/** Präfix für Fluxer-Spieler, die (noch) kein Discord-Konto verknüpft haben. */
const FLUXER_PREFIX = 'fx:';

/** Alle Server bilden eine Welt – die Server-ID spielt für die Daten keine Rolle. */
function world() {
  return WORLD_ID;
}

/**
 * Das kanonische Konto zu einer Plattform-Identität.
 *
 * - Discord: immer die rohe User-ID (bewahrt den bestehenden Fortschritt).
 * - Fluxer: das verknüpfte Discord-Konto – oder, solange nichts verknüpft ist,
 *   ein eigenes Konto mit Präfix, damit man sofort spielen kann.
 */
function account(platform, userId) {
  const id = String(userId);
  if (platform === 'discord') {
    // Auch Discord kann verknüpft sein (falls jemand die Richtung dreht).
    return db.getLink('discord', id)?.account_id ?? id;
  }
  return db.getLink(platform, id)?.account_id ?? `${FLUXER_PREFIX}${id}`;
}

/** Gehört dieses Konto zu Discord (und damit zu UnbelievaBoat)? */
function isDiscordAccount(accountId) {
  return !String(accountId).startsWith(FLUXER_PREFIX);
}

/** Ist diese Plattform-Identität schon verknüpft? */
function isLinked(platform, userId) {
  return db.getLink(platform, String(userId)) !== null;
}

/** Merkt sich den Anzeigenamen eines Kontos (für Plattformen ohne Erwähnungen). */
function remember(accountId, name) {
  if (name) db.setAccountName(accountId, String(name).slice(0, 60));
}

/** Anzeigename eines Kontos, sonst null. */
function nameOf(accountId) {
  return db.getAccountName(accountId);
}

module.exports = {
  WORLD_ID, FLUXER_PREFIX,
  world, account, isDiscordAccount, isLinked, remember, nameOf, checkWorld,
};
