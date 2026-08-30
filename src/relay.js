/**
 * ===========================================================================
 *  RELAY – ein gemeinsamer Kanal über beide Plattformen
 * ===========================================================================
 *
 * Discord kennt keine **ausgehenden** Webhooks – man kann sich also nicht
 * "benachrichtigen lassen", wenn dort etwas passiert. Man braucht einen Bot,
 * der mitliest. Genau den haben wir: Im duo-Prozess sind beide Clients
 * gleichzeitig offen, also spiegelt dieses Modul direkt zwischen ihnen.
 *
 * Weitergeleitet wird alles im eingestellten Kanal – auch Bot-Ausgaben wie
 * UnbelievaBoats Auszahlungen und Überfälle. Nur die **eigenen** Nachrichten
 * werden übersprungen; das ist zugleich der Schleifenschutz: Was der Bot
 * drüben absetzt, würde er sonst sofort wieder zurückspiegeln.
 *
 * Einrichtung (.env):
 *   RELAY_DISCORD_CHANNEL=<discord-kanal-id>
 *   RELAY_FLUXER_CHANNEL=<fluxer-kanal-id>
 *
 * Auf Discord ist zusätzlich das **Message Content Intent** nötig, sonst
 * kommen die Nachrichten ohne Text an.
 */

const DISCORD_CHANNEL = process.env.RELAY_DISCORD_CHANNEL || '';
const FLUXER_CHANNEL = process.env.RELAY_FLUXER_CHANNEL || '';

/**
 * Alle Kanäle spiegeln statt nur eines Paares.
 *
 * Beide Server haben denselben Aufbau, deshalb werden die Gegenstücke über den
 * **Namen** gefunden – man muss also nicht jedes Paar von Hand eintragen.
 */
const RELAY_ALL = ['true', '1'].includes(String(process.env.RELAY_ALL || '').toLowerCase());

/** Kanäle, die trotzdem außen vor bleiben (Namen, kommagetrennt). */
const EXCLUDE = new Set(
  (process.env.RELAY_EXCLUDE || '').split(',').map((s) => normalize(s)).filter(Boolean));

/** Ausdrückliche Paare für Ausnahmen: "discordId:fluxerId,discordId2:fluxerId2". */
const OVERRIDES = new Map(
  (process.env.RELAY_MAP || '').split(',').map((pair) => pair.split(':').map((s) => s.trim()))
    .filter((p) => p.length === 2 && p[0] && p[1]));

/**
 * Vergleichsform eines Kanalnamens.
 *
 * Discord-Kanäle heißen oft `💰┃economy`, das Gegenstück vielleicht `economy`.
 * Alles außer Buchstaben und Ziffern fliegt raus, damit solche Verzierungen
 * die Paarung nicht verhindern.
 */
function normalize(name) {
  return String(name ?? '').toLowerCase().replace(/[^a-z0-9äöüß]/g, '');
}

/** Nur aktiv, wenn ein Paar feststeht oder alle Kanäle gespiegelt werden. */
const enabled = Boolean((DISCORD_CHANNEL && FLUXER_CHANNEL) || RELAY_ALL || OVERRIDES.size);

/** Höchstlänge einer gespiegelten Nachricht. */
const MAX_LENGTH = 1500;

const clients = { discord: null, fluxer: null };

/** Ein Einstiegspunkt meldet hier seinen Client an. */
function register(platform, client) {
  clients[platform] = client;
}

/** Der angemeldete Discord-Client – etwa für Rollenabfragen von Fluxer aus. */
function discordClient() {
  return clients.discord;
}

/** Läuft die Brücke gerade in beide Richtungen? */
function ready() {
  return Boolean(enabled && clients.discord && clients.fluxer);
}

// ------------------------------------------------------------- Formatieren

/** Macht aus einem Embed lesbaren Text. */
function flattenEmbed(embed) {
  const e = typeof embed?.toJSON === 'function' ? embed.toJSON() : (embed ?? {});
  const parts = [];
  if (e.author?.name) parts.push(`_${e.author.name}_`);
  if (e.title) parts.push(`**${e.title}**`);
  if (e.description) parts.push(e.description);
  for (const f of e.fields ?? []) parts.push(`**${f.name}:** ${f.value}`);
  if (e.footer?.text) parts.push(`_${e.footer.text}_`);
  return parts.join('\n');
}

/**
 * Baut den Text, der auf der anderen Seite erscheint.
 * @returns {string|null} null, wenn es nichts zu spiegeln gibt.
 */
function format(message, { platform }) {
  const author = message.author?.displayName
    ?? message.author?.globalName
    ?? message.author?.username
    ?? 'Jemand';

  const pieces = [];
  if (message.content) pieces.push(message.content);

  for (const embed of message.embeds ?? []) {
    const text = flattenEmbed(embed);
    if (text) pieces.push(text);
  }

  // Anhänge als Verweis mitschicken – Dateien selbst zu übertragen wäre
  // deutlich mehr Aufwand und ist für einen Mitlese-Kanal nicht nötig.
  const files = [...(message.attachments?.values?.() ?? message.attachments ?? [])]
    .map((a) => a?.url).filter(Boolean);
  if (files.length) pieces.push(files.join('\n'));

  const body = pieces.join('\n').trim();
  if (!body) return null;

  const flag = platform === 'discord' ? '🔵 Discord' : '🟣 Fluxer';
  const clipped = body.length > MAX_LENGTH ? `${body.slice(0, MAX_LENGTH)}…` : body;
  return `${flag} **${author}:** ${clipped}`;
}

// ------------------------------------------------------------ Weiterleiten

/**
 * Stammt die Nachricht von uns selbst?
 * Solche NIE spiegeln – sonst schaukeln sich beide Seiten hoch.
 */
function isOwn(message, platform) {
  const own = clients[platform]?.user?.id;
  return Boolean(own && String(message.author?.id) === String(own));
}

/** Alle Textkanäle einer Seite, als Liste. */
function textChannels(platform) {
  const client = clients[platform];
  if (!client) return [];
  const all = platform === 'discord'
    ? [...(client.channels?.cache?.values?.() ?? [])]
    : [...(client.channels?.values?.() ?? [])];
  return all.filter((c) => {
    if (typeof c?.isTextBased === 'function') return c.isTextBased() && !c.isDM?.();
    return Boolean(c?.name);
  });
}

/** Das gleichnamige Gegenstück auf der anderen Seite, oder null. */
function counterpart(name, targetPlatform) {
  const wanted = normalize(name);
  if (!wanted) return null;
  const hit = textChannels(targetPlatform).find((c) => normalize(c.name) === wanted);
  return hit ?? null;
}

/**
 * Wohin geht diese Nachricht?
 * @returns {string|null} Kanal-ID auf der Gegenseite.
 */
function destination(message, platform) {
  const channelId = String(message.channelId ?? message.channel?.id ?? '');
  const target = platform === 'discord' ? 'fluxer' : 'discord';

  // 1. Ausdrücklich zugeordnet (beide Richtungen berücksichtigen).
  if (platform === 'discord' && OVERRIDES.has(channelId)) return OVERRIDES.get(channelId);
  if (platform === 'fluxer') {
    for (const [dc, fx] of OVERRIDES) if (fx === channelId) return dc;
  }

  // 2. Das feste Einzelpaar.
  if (DISCORD_CHANNEL && FLUXER_CHANNEL) {
    if (platform === 'discord' && channelId === String(DISCORD_CHANNEL)) return FLUXER_CHANNEL;
    if (platform === 'fluxer' && channelId === String(FLUXER_CHANNEL)) return DISCORD_CHANNEL;
  }

  // 3. Gleichnamiger Kanal auf der Gegenseite.
  if (RELAY_ALL) {
    const name = message.channel?.name;
    if (!name || EXCLUDE.has(normalize(name))) return null;
    return counterpart(name, target)?.id ?? null;
  }

  return null;
}

/** Ist diese Nachricht zu spiegeln? (nur für Tests/Diagnose) */
function shouldRelay(message, platform) {
  if (!ready() || isOwn(message, platform)) return false;
  return destination(message, platform) !== null;
}

/** Discord → Fluxer. */
async function fromDiscord(message) {
  if (!ready() || isOwn(message, 'discord')) return false;
  const target = destination(message, 'discord');
  if (!target) return false;
  const text = format(message, { platform: 'discord' });
  if (!text) return false;
  await clients.fluxer.channels.send(target, { content: text });
  return true;
}

/** Fluxer → Discord. */
async function fromFluxer(message) {
  if (!ready() || isOwn(message, 'fluxer')) return false;
  const target = destination(message, 'fluxer');
  if (!target) return false;
  const text = format(message, { platform: 'fluxer' });
  if (!text) return false;
  const channel = await clients.discord.channels.fetch(target);
  // Keine Erwähnungen auslösen: gespiegelter Text soll niemanden anpingen.
  await channel.send({ content: text, allowedMentions: { parse: [] } });
  return true;
}

module.exports = {
  enabled, DISCORD_CHANNEL, FLUXER_CHANNEL, MAX_LENGTH, RELAY_ALL, EXCLUDE, OVERRIDES,
  register, ready, discordClient, format, flattenEmbed, shouldRelay, fromDiscord, fromFluxer,
  normalize, counterpart, destination, textChannels,
};
