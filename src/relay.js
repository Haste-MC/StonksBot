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

/** Nur aktiv, wenn beide Kanäle bekannt sind. */
const enabled = Boolean(DISCORD_CHANNEL && FLUXER_CHANNEL);

/** Höchstlänge einer gespiegelten Nachricht. */
const MAX_LENGTH = 1500;

const clients = { discord: null, fluxer: null };

/** Ein Einstiegspunkt meldet hier seinen Client an. */
function register(platform, client) {
  clients[platform] = client;
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
 * Ist diese Nachricht zu spiegeln?
 * Eigene Nachrichten NICHT – sonst schaukeln sich beide Seiten hoch.
 */
function shouldRelay(message, platform) {
  if (!ready()) return false;
  const own = clients[platform]?.user?.id;
  if (own && String(message.author?.id) === String(own)) return false;

  const channelId = String(message.channelId ?? message.channel?.id ?? '');
  const expected = platform === 'discord' ? DISCORD_CHANNEL : FLUXER_CHANNEL;
  return channelId === String(expected);
}

/** Discord → Fluxer. */
async function fromDiscord(message) {
  if (!shouldRelay(message, 'discord')) return false;
  const text = format(message, { platform: 'discord' });
  if (!text) return false;
  await clients.fluxer.channels.send(FLUXER_CHANNEL, { content: text });
  return true;
}

/** Fluxer → Discord. */
async function fromFluxer(message) {
  if (!shouldRelay(message, 'fluxer')) return false;
  const text = format(message, { platform: 'fluxer' });
  if (!text) return false;
  const channel = await clients.discord.channels.fetch(DISCORD_CHANNEL);
  // Keine Erwähnungen auslösen: gespiegelter Text soll niemanden anpingen.
  await channel.send({ content: text, allowedMentions: { parse: [] } });
  return true;
}

module.exports = {
  enabled, DISCORD_CHANNEL, FLUXER_CHANNEL, MAX_LENGTH,
  register, ready, format, flattenEmbed, shouldRelay, fromDiscord, fromFluxer,
};
