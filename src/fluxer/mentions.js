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
 * ===================== WER GEPINGT WIRD, UND WER NICHT =====================
 * Früher pingte die Brücke nie (`allowedMentions: { parse: [] }`). Das hatte
 * eine Lücke: Wer nur auf Discord ist, war von Fluxer aus nicht erreichbar –
 * er hat keine Fluxer-ID, die man erwähnen könnte, und Klartext `@Kevin`
 * wurde nicht ausgewertet.
 *
 * Jetzt gilt: **Ausdrückliche** Erwähnungen (`<@id>` oder Klartext `@Name`)
 * werden übersetzt UND pingen, wenn sie eindeutig auf ein Konto der Gegenseite
 * zeigen. Alles andere bleibt stumm: `@everyone`, `@here`, Rollen, und Namen,
 * die zwei Konten treffen könnten. `translateFull` liefert dafür neben dem
 * Text die Liste der IDs, die tatsächlich benachrichtigt werden dürfen – die
 * Brücke setzt genau diese in `allowedMentions.users`, nie `parse`.
 * ===========================================================================
 *
 * Rollen (`<@&…>`) und Kanäle (`<#…>`) gibt es drüben gar nicht – die werden
 * zu ihrem Namen, damit keine kaputte Klammer stehen bleibt.
 */

/** Nutzer-Erwähnung, Rolle, Kanal. */
const USER = /<@!?([0-9a-zA-Z:_-]+)>/g;

/**
 * Klartext `@Name` – die einzige Möglichkeit, jemanden zu meinen, der auf der
 * eigenen Plattform gar kein Konto hat. Nicht hinter `<` (das ist die echte
 * Erwähnung) und nicht mitten in einem Wort (`mail@host` ist keine Anrede).
 */
const PLAIN = /(?<![\w<@])@([^\s@<>#&][^\s@<>]{0,31})/g;
const NEVER_PING = new Set(['everyone', 'here']);
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
function translateFull(text, message, from, to) {
  const users = new Set();
  if (typeof text !== 'string' || !(text.includes('<') || text.includes('@'))) {
    return { text, users: [] };
  }

  const names = namesFrom(message);
  const { roles, channels } = labelsFrom(message);

  const out = text
    .replace(USER, (whole, id) => {
      const platformId = String(id);
      const account = identity.account(from, platformId);

      // 1) Verknüpft? Dann kennt die Gegenseite eine echte ID.
      let target = identity.platformIdOf(account, to);

      // 2) Sonst über den Namen – auf der Zielplattform, egal welche.
      const name = names.get(platformId) ?? identity.nameOf(account);
      if (!target && name) target = identity.platformIdByName(name, to);

      if (target) { users.add(String(target)); return `<@${target}>`; }
      return name ? `@${name}` : '@jemand';
    })
    .replace(ROLE, (whole, id) => `@${roles.get(String(id)) ?? 'Rolle'}`)
    .replace(CHANNEL, (whole, id) => `#${channels.get(String(id)) ?? 'kanal'}`)
    // 3) Klartext `@Name`: eindeutig auf der Zielplattform -> echte Erwähnung.
    .replace(PLAIN, (whole, name) => {
      if (NEVER_PING.has(name.toLowerCase())) return whole;
      const target = identity.platformIdByName(name, to);
      if (!target) return whole;
      users.add(String(target));
      return `<@${target}>`;
    });

  return { text: out, users: [...users] };
}

/** Nur der Text – für Aufrufer, die keine Ping-Liste brauchen. */
function translate(text, message, from, to) {
  return translateFull(text, message, from, to).text;
}

/** Fluxer-Nachricht für Discord aufbereiten. */
const toDiscord = (text, message) => translate(text, message, 'fluxer', 'discord');

/** Discord-Nachricht für Fluxer aufbereiten. */
const toFluxer = (text, message) => translate(text, message, 'discord', 'fluxer');

/** Dasselbe mit Ping-Liste – für die Brücke. */
const toDiscordFull = (text, message) => translateFull(text, message, 'fluxer', 'discord');
const toFluxerFull = (text, message) => translateFull(text, message, 'discord', 'fluxer');

module.exports = {
  USER, ROLE, CHANNEL, PLAIN, namesFrom, labelsFrom,
  translate, translateFull, toDiscord, toFluxer, toDiscordFull, toFluxerFull,
};
