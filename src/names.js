const db = require('./db');
const identity = require('./identity');

/**
 * ===========================================================================
 *  NAMEN – damit nirgends eine rohe ID steht
 * ===========================================================================
 *
 * Konten sind IDs; Menschen sind Namen. Der Bot merkt sich deshalb zu jedem
 * Konto einen Anzeigenamen (`account_names`) und zeigt den überall an –
 * Rangliste, Postfach, Auktion, Profil, Gebrauchtmarkt.
 *
 * Gelernt wird an drei Stellen, alle ohne Zutun des Spielers:
 *
 *   1. **Bedienung** – wer den Bot benutzt, ist sofort bekannt
 *      (bridge.js für Discord, fluxer/index.js für Fluxer).
 *   2. **Kanal-Brücke** – wer im gespiegelten Kanal schreibt, ebenso
 *      (relay.js `learnFace`).
 *   3. **Einmal beim Start** – dieses Modul holt die Namen zu allen Konten
 *      nach, die schon Geld oder Fortschritt haben. Das erwischt genau die
 *      Bestandsspieler, die vor der Namensmerkung angefangen haben.
 *
 * Es braucht dafür **kein** privilegiertes Intent: Ein einzelnes Konto per ID
 * abzufragen ist auf beiden Plattformen erlaubt – nur das Auflisten aller
 * Mitglieder wäre es nicht.
 */

/** Nach so vielen Abfragen ist Schluss – ein Start soll nicht minutenlang laufen. */
const MAX_LOOKUPS = 200;

/** Konten mit Fortschritt oder Geld, die (noch) keinen Namen haben. */
function unnamed(world = identity.world(), limit = MAX_LOOKUPS) {
  const seen = new Set();
  const out = [];

  const consider = (id) => {
    const accountId = String(id ?? '');
    if (!accountId || seen.has(accountId)) return;
    seen.add(accountId);
    if (identity.nameOf(accountId)) return;
    if (out.length < limit) out.push(accountId);
  };

  for (const row of db.listStats(world)) consider(row.user_id);
  for (const row of db.walletTop(world, limit)) consider(row.user_id);
  return out;
}

/**
 * Holt einen Anzeigenamen von der jeweiligen Plattform.
 * @returns {Promise<string|null>}
 */
async function lookup(accountId, clients) {
  const isDiscord = identity.isDiscordAccount(accountId);
  const client = isDiscord ? clients.discord : clients.fluxer;
  if (!client?.users?.fetch) return null;

  const platformId = isDiscord
    ? accountId
    : String(accountId).slice(identity.FLUXER_PREFIX.length);

  try {
    const user = await client.users.fetch(platformId);
    return user?.displayName ?? user?.globalName ?? user?.username ?? null;
  } catch {
    // Konto gelöscht, nie gesehen, API zickt – kein Grund für Lärm.
    return null;
  }
}

/**
 * Füllt fehlende Namen nach. Läuft im Hintergrund und darf jederzeit scheitern.
 *
 * @param clients {{discord?: object, fluxer?: object}}
 * @returns {Promise<{checked:number, learned:number}>}
 */
async function warm(clients, { world = identity.world(), limit = MAX_LOOKUPS } = {}) {
  const todo = unnamed(world, limit);
  let learned = 0;

  for (const accountId of todo) {
    const name = await lookup(accountId, clients);
    if (!name) continue;
    identity.remember(accountId, name);
    learned++;
  }

  if (learned) console.log(`👤 ${learned} Anzeigenamen nachgetragen (statt roher IDs).`);
  return { checked: todo.length, learned };
}

module.exports = { MAX_LOOKUPS, unnamed, lookup, warm };
