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
 * Gelernt wird an vier Stellen, alle ohne Zutun des Spielers:
 *
 *   1. **Bedienung** – wer den Bot benutzt, ist sofort bekannt
 *      (bridge.js für Discord, fluxer/index.js für Fluxer).
 *   2. **Kanal-Brücke** – wer im gespiegelten Kanal schreibt, ebenso
 *      (relay.js `learnFace`).
 *   3. **Einmal beim Start** – dieses Modul holt die Namen zu allen Konten
 *      nach, die schon Geld oder Fortschritt haben. Das erwischt genau die
 *      Bestandsspieler, die vor der Namensmerkung angefangen haben.
 *   4. **Bei Bedarf** (`ensure`) – wer in einer Liste auftaucht, ohne dass wir
 *      ihn je gesehen haben. Das sind vor allem die Spieler aus
 *      UnbelievaBoats Rangliste: Sie haben Geld, aber keinen Eintrag bei uns,
 *      und standen deshalb als nackte 19-stellige ID da.
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

/**
 * Fehlversuche kurz merken.
 *
 * Ohne das würde jede Rangliste dieselben unauffindbaren Konten erneut
 * abfragen – gelöschte Accounts oder Leute, die auf keiner der beiden
 * Plattformen zu finden sind.
 */
const MISS_TTL_MS = 60 * 60 * 1000;
const misses = new Map();

/**
 * Trägt fehlende Namen für diese Konten nach – jetzt, nicht erst beim nächsten
 * Start. Gedacht für Listen, die Konten zeigen, die der Bot noch nie gesehen
 * hat.
 *
 * Beim ersten Mal kostet das je unbekanntem Konto eine Abfrage; danach steht
 * der Name in der Datenbank und es kostet nichts mehr. Fehlt der Client der
 * Plattform (Fluxer allein gestartet), passiert einfach nichts.
 *
 * @returns {Promise<number>} wie viele Namen dazugelernt wurden
 */
async function ensure(accountIds, { clients = null, limit = 25, now = Date.now() } = {}) {
  const relay = require('./relay');
  const use = clients
    ?? { discord: relay.discordClient?.(), fluxer: relay.fluxerClient?.() };
  if (!use.discord && !use.fluxer) return 0;

  let learned = 0;
  let tries = 0;
  for (const raw of accountIds ?? []) {
    const accountId = String(raw ?? '');
    if (!accountId || identity.nameOf(accountId)) continue;

    const missedAt = misses.get(accountId);
    if (missedAt && now - missedAt < MISS_TTL_MS) continue;
    if (tries++ >= limit) break;

    const name = await lookup(accountId, use);
    if (name) { identity.remember(accountId, name); learned++; }
    else misses.set(accountId, now);
  }
  return learned;
}

/**
 * Das Profilbild eines Kontos – oder null, wenn es keins gibt bzw. der Client
 * der Plattform gerade nicht da ist.
 *
 * Gemerkt für eine halbe Stunde: Ein Profil wird oft geöffnet, und ein
 * Avatar ändert sich selten. Ohne den Puffer wäre jeder `/profil`-Aufruf eine
 * API-Abfrage.
 */
const AVATAR_TTL_MS = 30 * 60 * 1000;
const avatars = new Map();

async function avatar(accountId, now = Date.now()) {
  const id = String(accountId ?? '');
  if (!id) return null;

  const cached = avatars.get(id);
  if (cached && now - cached.at < AVATAR_TTL_MS) return cached.url;

  const relay = require('./relay');
  const isDiscord = identity.isDiscordAccount(id);
  const client = isDiscord ? relay.discordClient?.() : relay.fluxerClient?.();
  if (!client?.users?.fetch) return null;

  const platformId = isDiscord ? id : id.slice(identity.FLUXER_PREFIX.length);

  try {
    const user = await client.users.fetch(platformId);
    // Je nach Plattform ist das eine Funktion oder direkt eine Zeichenkette.
    let url = null;
    if (typeof user?.displayAvatarURL === 'function') url = user.displayAvatarURL({ size: 256 });
    else if (typeof user?.avatarURL === 'function') url = user.avatarURL({ size: 256 });
    else if (typeof user?.avatarURL === 'string') url = user.avatarURL;
    url = url || null;
    avatars.set(id, { url, at: now });
    return url;
  } catch {
    // Konto gelöscht, nie gesehen, API zickt – kein Grund für Lärm.
    avatars.set(id, { url: null, at: now });
    return null;
  }
}

module.exports = {
  MAX_LOOKUPS, MISS_TTL_MS, unnamed, lookup, warm, ensure, avatar, AVATAR_TTL_MS,
};
