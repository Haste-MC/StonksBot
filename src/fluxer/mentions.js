const identity = require('../identity');

/**
 * ===========================================================================
 *  ERWÄHNUNGEN ÜBER DIE PLATTFORMGRENZE
 * ===========================================================================
 *
 * `<@12345>` ist auf beiden Plattformen dieselbe Schreibweise – aber die ID
 * gilt nur dort, wo sie herkommt. Ungefiltert gespiegelt zeigt Discord
 * deshalb **@unbekannter-Benutzer**, und Fluxer eine tote Zahl.
 *
 * Übersetzt wird in drei Stufen, von gut nach brauchbar:
 *
 *   1. **Verknüpftes Konto** (`!link`) -> echte Erwähnung der Gegenseite.
 *      Der Name erscheint drüben als richtige Erwähnung, mit Farbe und allem.
 *   2. **Eindeutiger Namenstreffer** -> ebenfalls echte Erwähnung. Wer auf
 *      beiden Plattformen gleich heißt, wird auch ohne `!link` erkannt.
 *   3. **Sonst der Name als Text** (`@Diabilon`). Kein Ping, kein Pill –
 *      aber man sieht, wer gemeint war.
 *
 * Gepingt wird dabei nie: Die Brücke setzt `allowedMentions: { parse: [] }`.
 * Die Erwähnung soll lesbar sein, nicht jemanden aus dem Bett klingeln.
 *
 * Rollen (`<@&…>`) und Kanäle (`<#…>`) gibt es drüben gar nicht – die werden
 * zu ihrem Namen, damit keine kaputte Klammer stehen bleibt.
 */

/** Nutzer-Erwähnung, Rolle, Kanal. */
const USER = /<@!?([0-9a-zA-Z:_-]+)>/g;
const ROLE = /<@&([0-9]+)>/g;
const CHANNEL = /<#([0-9]+)>/g;

/**
 * Namen der erwähnten Nutzer aus der Nachricht selbst.
 *
 * Fluxer liefert `message.mentions` als Array, discord.js als Collection unter
 * `.users` – beides wird hier auf `id -> Name` gebracht. Das ist die
 * verlässlichste Quelle: Sie kennt auch Leute, die den Bot nie benutzt haben.
 */
function namesFrom(message) {
  const out = new Map();
  const raw = message?.mentions;
  if (!raw) return out;

  const users = Array.isArray(raw)
    ? raw
    : [...(raw.users?.values?.() ?? [])];

  for (const user of users) {
    if (!user?.id) continue;
    out.set(String(user.id), user.displayName ?? user.globalName ?? user.username ?? null);
  }

  // discord.js kennt zusätzlich Servernamen (Spitznamen).
  for (const member of raw.members?.values?.() ?? []) {
    if (member?.id && member.displayName) out.set(String(member.id), member.displayName);
  }
  return out;
}

/** Rollen- und Kanalnamen aus der Nachricht (nur discord.js liefert sie). */
function labelsFrom(message) {
  const roles = new Map();
  const channels = new Map();
  const raw = message?.mentions;
  for (const role of raw?.roles?.values?.() ?? []) {
    if (role?.id) roles.set(String(role.id), role.name);
  }
  for (const channel of raw?.channels?.values?.() ?? []) {
    if (channel?.id) channels.set(String(channel.id), channel.name);
  }
  return { roles, channels };
}

/**
 * Übersetzt alle Erwähnungen einer Nachricht.
 *
 * @param text    der bereits zusammengebaute Nachrichtentext
 * @param message die Ursprungsnachricht (für Namen)
 * @param from    Plattform, von der die Nachricht stammt
 * @param to      Zielplattform
 */
function translate(text, message, from, to) {
  if (typeof text !== 'string' || !text.includes('<')) return text;

  const names = namesFrom(message);
  const { roles, channels } = labelsFrom(message);

  return text
    .replace(USER, (whole, id) => {
      const platformId = String(id);
      const account = identity.account(from, platformId);

      // 1) Verknüpft? Dann kennt die Gegenseite eine echte ID.
      let target = identity.platformIdOf(account, to);

      // 2) Sonst über den Namen versuchen (nur Richtung Discord möglich –
      //    dort liegen die Konten, gegen die wir abgleichen).
      const name = names.get(platformId) ?? identity.nameOf(account);
      if (!target && to === 'discord' && name) {
        const guess = identity.accountByName(name);
        if (guess) target = guess;
      }

      if (target) return `<@${target}>`;
      return name ? `@${name}` : '@jemand';
    })
    .replace(ROLE, (whole, id) => `@${roles.get(String(id)) ?? 'Rolle'}`)
    .replace(CHANNEL, (whole, id) => `#${channels.get(String(id)) ?? 'kanal'}`);
}

/** Fluxer-Nachricht für Discord aufbereiten. */
const toDiscord = (text, message) => translate(text, message, 'fluxer', 'discord');

/** Discord-Nachricht für Fluxer aufbereiten. */
const toFluxer = (text, message) => translate(text, message, 'discord', 'fluxer');

module.exports = { USER, ROLE, CHANNEL, namesFrom, labelsFrom, translate, toDiscord, toFluxer };
