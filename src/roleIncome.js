const db = require('./db');
const unb = require('./unb');
const identity = require('./identity');

const changeCash = (...a) => unb.changeCash(...a);

/**
 * ===========================================================================
 *  ROLLEN-EINKOMMEN – der Ersatz für !collect-income
 * ===========================================================================
 *
 * UnbelievaBoats Rollen-Einkommen ist über die API **nicht auslesbar** – die
 * Konfiguration bleibt in deren Bot. Deshalb hier eine eigene, die auf beiden
 * Plattformen funktioniert.
 *
 * Eingestellt wird sie in der .env:
 *
 *     INCOME_ROLES=<rollen-id>:<betrag>,<rollen-id>:<betrag>
 *     INCOME_INTERVAL_HOURS=24
 *
 * Die Rollen liest der **Discord**-Client – auch für Fluxer-Spieler, sofern ihr
 * Konto verknüpft ist. Das ist genau der Vorteil des duo-Betriebs: Beide
 * Clients laufen im selben Prozess, also kennt die Fluxer-Seite die
 * Discord-Rollen. Wer nicht verknüpft ist, hat keine Rollen und damit auch
 * kein Rollen-Einkommen – ein guter Anreiz für `!link`.
 */

const HOUR = 60 * 60 * 1000;

const INTERVAL_MS = Number(process.env.INCOME_INTERVAL_HOURS || '24') * HOUR;

/** Rollen-ID -> Betrag, aus der .env gelesen. */
const ROLES = new Map(
  (process.env.INCOME_ROLES || '').split(',')
    .map((entry) => entry.split(':').map((s) => s.trim()))
    .filter((p) => p.length === 2 && p[0] && Number(p[1]) > 0)
    .map(([id, amount]) => [id, Math.floor(Number(amount))]));

const enabled = ROLES.size > 0;

/** Wie lange noch bis zur nächsten Auszahlung? (0 = jetzt möglich) */
function remainingMs(guildId, accountId, now = Date.now()) {
  const claim = db.getClaim(guildId, accountId, 'roleincome');
  if (!claim) return 0;
  return Math.max(0, claim.claimed_at + INTERVAL_MS - now);
}

/** Was diese Rollen zusammen einbringen. */
function amountFor(roleIds) {
  let total = 0;
  const parts = [];
  for (const id of roleIds ?? []) {
    const value = ROLES.get(String(id));
    if (value) { total += value; parts.push({ roleId: String(id), amount: value }); }
  }
  return { total, parts };
}

/**
 * Zahlt das Rollen-Einkommen aus.
 *
 * Wie beim Tagesbonus wird der Anspruch **vor** der Buchung vermerkt, damit
 * ein zweiter schneller Aufruf leer ausgeht (ARCHITEKTUR §7).
 */
async function claim(guildId, accountId, roleIds, now = Date.now()) {
  if (!enabled) return { ok: false, reason: 'disabled' };

  const { total, parts } = amountFor(roleIds);
  if (total <= 0) return { ok: false, reason: 'no_roles' };

  const left = remainingMs(guildId, accountId, now);
  if (left > 0) return { ok: false, reason: 'cooldown', remainingMs: left, amount: total };

  db.setClaim(guildId, accountId, 'roleincome', now);
  try {
    const balance = await changeCash(guildId, accountId, total, 'Rollen-Einkommen');
    return { ok: true, amount: total, parts, balance };
  } catch (err) {
    db.clearClaim(guildId, accountId, 'roleincome');
    throw err;
  }
}

/**
 * Die Discord-Rollen eines Kontos – auch von der Fluxer-Seite aus nutzbar,
 * weil im duo-Prozess beide Clients laufen.
 *
 * @param discordClient der eingeloggte Discord-Client (oder null)
 * @returns {Promise<string[]>} Rollen-IDs; leer, wenn nicht ermittelbar
 */
async function rolesOf(discordClient, accountId) {
  if (!discordClient || !identity.isDiscordAccount(accountId)) return [];
  const guildId = process.env.UNB_GUILD_ID || process.env.DISCORD_GUILD_ID
    || process.env.WORLD_ID || '';
  if (!guildId) return [];

  try {
    const guild = await discordClient.guilds.fetch(guildId);
    const member = await guild.members.fetch(String(accountId));
    return [...member.roles.cache.keys()];
  } catch {
    return [];   // nicht auf dem Server, oder Rollen nicht abrufbar
  }
}

module.exports = {
  HOUR, INTERVAL_MS, ROLES, enabled,
  remainingMs, amountFor, claim, rolesOf,
};
