const db = require('./db');
const identity = require('./identity');
const unb = require('./unb');
const wallet = require('./wallet');

const changeCash = (...a) => unb.changeCash(...a);

/**
 * ===========================================================================
 *  KONTEN VERKNÜPFEN (Cross-Progression)
 * ===========================================================================
 *
 * Ein Fluxer-Spieler kann sofort losspielen; sein Fortschritt liegt solange
 * unter einem eigenen Konto (`fx:…`). Verknüpft er sich später mit seiner
 * Discord-ID, wandert **alles** hinüber: Besitz, Level, Sammlung, Inserate –
 * und das Zwischenguthaben zu UnbelievaBoat.
 *
 * Bewusst ohne Bestätigungscode: Ein Spieler hat keinen Zugriff mehr auf sein
 * Discord-Konto, und der Bot läuft in einer Freundesgruppe. Die Verknüpfung
 * geschieht per Selbstauskunft (`!link <discord-id>`); ein Admin kann sie
 * jederzeit korrigieren oder aufheben.
 */

/** Discord-IDs sind 17–20-stellige Zahlen. */
const DISCORD_ID = /^\d{17,20}$/;

/** Wer Verknüpfungen anderer ändern darf (IDs aus der .env, kommagetrennt). */
const ADMINS = (process.env.BOT_ADMINS || '')
  .split(',').map((s) => s.trim()).filter(Boolean);

function isAdmin(userId) {
  return ADMINS.includes(String(userId));
}

/**
 * Verknüpft eine Plattform-Identität mit einem Discord-Konto und führt den
 * bisherigen Spielstand zusammen.
 *
 * Reihenfolge ist wichtig: erst das Guthaben abräumen, dann verknüpfen, dann
 * gutschreiben. So kann das Geld zu keinem Zeitpunkt doppelt existieren.
 */
async function link(platform, userId, discordId) {
  const target = String(discordId).replace(/[<@!>]/g, '').trim();
  if (!DISCORD_ID.test(target)) return { ok: false, reason: 'bad_id' };

  const current = identity.account(platform, userId);
  if (current === target) return { ok: false, reason: 'already_linked', account: target };

  const world = identity.world();

  // 1) Zwischenstand einsammeln, solange er noch dem alten Konto gehört.
  //    Ein negativer Stand (Schulden) wandert bewusst MIT: Würde er erlassen,
  //    entstünde Geld aus dem Nichts – genau das verbietet ARCHITEKTUR §3.
  const carried = identity.isDiscordAccount(current) ? 0 : wallet.drain(world, current);

  // 2) Verknüpfen und den Spielstand hinüberziehen.
  db.setLink(platform, userId, target);
  const { moved } = db.mergeAccounts(world, current, target);

  // 3) Guthaben auf dem Zielkonto gutschreiben. Kein XP: Das ist ein Übertrag,
  //    kein Einkommen – sonst gäbe es Erfahrung für bereits verdientes Geld.
  if (carried > 0) {
    await changeCash(world, target, carried, 'Kontoverknüpfung: Übertrag', { xp: false })
      .catch(() => {});
  }

  return { ok: true, account: target, previous: current, carried, moved };
}

/** Hebt eine Verknüpfung auf. Der Fortschritt bleibt beim Discord-Konto. */
function unlink(platform, userId) {
  if (!db.getLink(platform, String(userId))) return { ok: false, reason: 'not_linked' };
  db.deleteLink(platform, String(userId));
  return { ok: true };
}

/** Übersicht: mit welchem Konto ist diese Identität verbunden? */
function status(platform, userId) {
  const account = identity.account(platform, userId);
  return {
    account,
    linked: identity.isLinked(platform, userId),
    viaUnb: unb.viaUnb(account),
    others: db.linksOf(account).filter((l) => l.platform !== platform),
  };
}

module.exports = { DISCORD_ID, ADMINS, isAdmin, link, unlink, status };
