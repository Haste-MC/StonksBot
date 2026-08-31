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

// Emoji-Übersetzung: Discord-Emojis (allen voran das Währungszeichen) haben
// auf Fluxer keine Entsprechung und umgekehrt – ohne Übersetzung landet in der
// Brücke Rohtext wie `:Rubine:`. Kein SDK-Import, nur Textumformung.
const emoji = require('./fluxer/emoji');
const db = require('./db');

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

/**
 * ===========================================================================
 *  ALS DER SPIELER AUFTRETEN (Webhooks)
 * ===========================================================================
 *
 * Standardmäßig erscheint eine gespiegelte Nachricht drüben unter **Name und
 * Avatar des Absenders**, statt als `🔵 **Kevin:** Hallo` vom Bot. Möglich
 * machen das Webhooks: Beide Plattformen erlauben beim Ausführen eines
 * Webhooks, Name und Avatar pro Nachricht zu überschreiben.
 *
 * Drei Dinge sind dabei wichtig:
 *
 *  - **Der Token gibt es nur einmal.** Er kommt beim Anlegen zurück; später
 *    liefert ihn keine Seite mehr aus. Deshalb liegt er in der Datenbank
 *    (`relay_webhooks`) – sonst bräuchte jeder Neustart einen neuen Webhook,
 *    und die Kanäle liefen irgendwann ins Webhook-Limit.
 *  - **Schleifenschutz.** Eine Webhook-Nachricht stammt NICHT vom Bot-Konto –
 *    `author.id` ist die Webhook-ID. Ohne Sonderbehandlung würde der Bot seine
 *    eigenen gespiegelten Nachrichten wieder einlesen und zurückspiegeln.
 *    Deshalb merken wir uns die IDs unserer Webhooks und überspringen sie.
 *  - **Notausgang.** Fehlt das Recht „Webhooks verwalten", schlägt das Anlegen
 *    fehl. Dann fällt die Brücke auf die alte Textform zurück, statt zu
 *    schweigen – lieber sichtbar als schön.
 */

/** Als Persona spiegeln? Sonst die alte Textform mit Präfix. */
const WEBHOOKS = !['false', '0', 'off'].includes(
  String(process.env.RELAY_WEBHOOKS ?? '').toLowerCase());

/** Name des Webhooks, unter dem die Brücke sendet (nur in den Einstellungen sichtbar). */
const WEBHOOK_NAME = process.env.RELAY_WEBHOOK_NAME || 'Kanal-Brücke';

/**
 * Optionaler Zusatz hinter dem Anzeigenamen, z.B. " (Fluxer)".
 * Leer = maximal unauffällig; die Plattformen setzen ohnehin ein BOT-Abzeichen
 * an Webhook-Nachrichten, es wird also niemand getäuscht.
 */
const NAME_SUFFIX = process.env.RELAY_NAME_SUFFIX || '';

/**
 * Fremde Webhook-Nachrichten ignorieren.
 *
 * Läuft im selben Kanal noch eine zweite Brücke (die ebenfalls als Persona
 * spiegelt), schaukeln sich beide gegenseitig hoch: Ihre Spiegelung sieht für
 * uns aus wie eine echte Nachricht. Mit dieser Einstellung bleibt alles
 * unbeachtet, was von einem Webhook kommt.
 */
const IGNORE_WEBHOOKS = ['true', '1', 'on'].includes(
  String(process.env.RELAY_IGNORE_WEBHOOKS || '').toLowerCase());

/** Webhook-Objekte je Kanal: "<plattform>:<kanal>" -> Webhook | null (= geht nicht). */
const hooks = new Map();

/** IDs unserer eigenen Webhooks – für den Schleifenschutz. */
const ownWebhookIds = new Set(db.allRelayWebhooks().map((w) => w.webhook_id));

const hookKey = (platform, channelId) => `${platform}:${channelId}`;

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

  const flag = platform === 'discord' ? '🔵 ' : '🟣 ';
  const clipped = body.length > MAX_LENGTH ? `${body.slice(0, MAX_LENGTH)}…` : body;
  return `${flag} **${author}:** ${clipped}`;
}

/**
 * Der reine Nachrichtentext – ohne "**Name:**"-Präfix, denn beim Spiegeln als
 * Persona trägt schon der Absendername die Herkunft.
 */
function body(message) {
  const pieces = [];
  if (message.content) pieces.push(message.content);

  for (const embed of message.embeds ?? []) {
    const text = flattenEmbed(embed);
    if (text) pieces.push(text);
  }

  const files = [...(message.attachments?.values?.() ?? message.attachments ?? [])]
    .map((a) => a?.url).filter(Boolean);
  if (files.length) pieces.push(files.join('\n'));

  const text = pieces.join('\n').trim();
  if (!text) return null;
  return text.length > MAX_LENGTH ? `${text.slice(0, MAX_LENGTH)}…` : text;
}

/**
 * Anzeigename für die Gegenseite.
 *
 * Discord verbietet "discord" im Webhook-Namen und begrenzt auf 80 Zeichen –
 * ein abgelehnter Name würde die ganze Nachricht verschlucken.
 */
function displayName(message) {
  const raw = message.member?.displayName
    ?? message.author?.displayName
    ?? message.author?.globalName
    ?? message.author?.username
    ?? 'Jemand';

  const safe = String(raw).replace(/discord/gi, 'disc0rd')
    .replace(/@(everyone|here)/gi, '$1').trim() || 'Jemand';
  return `${safe}${NAME_SUFFIX}`.slice(0, 80);
}

/**
 * Avatarbild des Absenders (oder null – dann nimmt der Webhook sein eigenes).
 *
 * Bewusst Schritt für Schritt geprüft: `avatarURL` ist je nach Plattform eine
 * Funktion ODER ein String, und die Funktion darf null liefern. Eine
 * `??`-Kette würde dann die Funktion selbst durchreichen.
 */
function avatarOf(message) {
  const user = message.author;
  if (!user) return null;

  try {
    if (typeof user.displayAvatarURL === 'function') {
      return user.displayAvatarURL({ size: 128 }) || null;
    }
    if (typeof user.avatarURL === 'function') return user.avatarURL({ size: 128 }) || null;
    if (typeof user.avatarURL === 'string') return user.avatarURL || null;
    return null;
  } catch {
    return null;
  }
}

/** Kann dieser Webhook senden? (Ohne Token geht nur Verwalten, nicht Ausführen.) */
const canExecute = (hook) => Boolean(hook && typeof hook.send === 'function' && hook.token !== null);

/**
 * Besorgt den Webhook für einen Kanal: gemerkter Token → vorhandener Webhook
 * mit unserem Namen → neu anlegen. `null` heißt "geht hier nicht" und wird
 * gemerkt, damit nicht bei jeder Nachricht erneut probiert wird.
 */
async function webhookFor(platform, channelId) {
  const key = hookKey(platform, channelId);
  if (hooks.has(key)) return hooks.get(key);

  const client = clients[platform];
  if (!client) return null;

  let hook = null;
  try {
    hook = await fromStore(platform, channelId, client)
      ?? await fromChannel(platform, channelId, client);
  } catch (err) {
    console.warn(`Brücke: kein Webhook in ${platform}/${channelId} (${err.message}) – ` +
      'spiegele in Textform. Fehlt das Recht "Webhooks verwalten"?');
    hook = null;
  }

  if (hook) {
    ownWebhookIds.add(String(hook.id));
    db.setRelayWebhook(platform, channelId, String(hook.id), hook.token ?? '');
  }
  hooks.set(key, hook);
  return hook;
}

/** Aus dem gemerkten Token wieder einen sendefähigen Webhook bauen. */
async function fromStore(platform, channelId, client) {
  const stored = db.getRelayWebhook(platform, channelId);
  if (!stored?.token) return null;

  try {
    // Discord.js kennt Client#fetchWebhook(id, token); Fluxer baut das Objekt
    // aus gespeicherter ID und Token (Webhook.fromToken).
    let hook = null;
    if (platform === 'discord') {
      hook = await client.fetchWebhook(stored.webhook_id, stored.token);
    } else {
      const Webhook = require('./fluxer/sdk').sdk()?.Webhook;
      hook = Webhook?.fromToken(client, stored.webhook_id, stored.token, { channelId });
    }
    return canExecute(hook) ? hook : null;
  } catch (err) {
    // Webhook drüben gelöscht -> Eintrag wegwerfen und gleich neu anlegen.
    db.deleteRelayWebhook(platform, channelId);
    return null;
  }
}

/** Vorhandenen Brücken-Webhook im Kanal finden oder einen neuen anlegen. */
async function fromChannel(platform, channelId, client) {
  const channel = await resolveChannel(platform, channelId, client);
  if (!channel?.createWebhook) return null;

  const existing = await channel.fetchWebhooks?.().catch(() => null);
  const mine = [...(existing?.values?.() ?? existing ?? [])]
    .find((w) => w?.name === WEBHOOK_NAME && canExecute(w));
  if (mine) return mine;

  return channel.createWebhook({ name: WEBHOOK_NAME });
}

/** Kanalobjekt der jeweiligen Plattform. */
async function resolveChannel(platform, channelId, client) {
  if (platform === 'discord') return client.channels.fetch(channelId);
  // Fluxer: erst der Cache, sonst über die API nachladen.
  return client.channels?.get?.(channelId)
    ?? (await client.channels?.resolve?.(channelId).catch(() => null))
    ?? null;
}

/**
 * Spiegelt als Persona. `false` heißt "hat nicht geklappt" – dann übernimmt
 * der Aufrufer mit der Textform.
 */
async function sendAsPersona(platform, channelId, message, text) {
  if (!WEBHOOKS) return false;
  const hook = await webhookFor(platform, channelId);
  if (!hook) return false;

  const payload = {
    content: text,
    username: displayName(message),
    // Die Plattformen schreiben das Feld unterschiedlich – beide mitgeben.
    avatarURL: avatarOf(message) ?? undefined,
    avatarUrl: avatarOf(message) ?? undefined,
    allowedMentions: { parse: [] },
  };

  try {
    await hook.send(payload);
    return true;
  } catch (err) {
    // Webhook weg oder Recht entzogen: vergessen und beim nächsten Mal neu
    // versuchen; diese Nachricht geht in Textform raus.
    console.warn(`Brücke: Webhook-Versand in ${platform}/${channelId} fehlgeschlagen ` +
      `(${err.message}) – spiegele in Textform.`);
    hooks.delete(hookKey(platform, channelId));
    db.deleteRelayWebhook(platform, channelId);
    return false;
  }
}

// ------------------------------------------------------------ Weiterleiten

/**
 * Stammt die Nachricht von uns selbst?
 * Solche NIE spiegeln – sonst schaukeln sich beide Seiten hoch.
 */
function isOwn(message, platform) {
  // Eigene Webhook-Nachrichten tragen NICHT die Bot-ID, sondern die des
  // Webhooks – ohne diese Zeile würde die Brücke ihre eigenen Spiegelungen
  // erneut spiegeln und beide Kanäle in Sekunden fluten.
  const hookId = message.webhookId ?? message.webhook_id;
  if (hookId && ownWebhookIds.has(String(hookId))) return true;

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

/** Von einem fremden Webhook – und sollen die übersprungen werden? */
function ignored(message) {
  if (!IGNORE_WEBHOOKS) return false;
  return Boolean(message.webhookId ?? message.webhook_id);
}

/** Ist diese Nachricht zu spiegeln? (nur für Tests/Diagnose) */
function shouldRelay(message, platform) {
  if (!ready() || isOwn(message, platform) || ignored(message)) return false;
  return destination(message, platform) !== null;
}

/** Discord → Fluxer. */
async function fromDiscord(message) {
  if (!ready() || isOwn(message, 'discord') || ignored(message)) return false;
  const target = destination(message, 'discord');
  if (!target || !body(message)) return false;
  const asPersona = await sendAsPersona(
    'fluxer', target, message, emoji.toFluxer(body(message) ?? ''));
  if (asPersona) return true;

  const text = format(message, { platform: 'discord' });
  if (!text) return false;
  await clients.fluxer.channels.send(target, { content: emoji.toFluxer(text) });
  return true;
}

/** Fluxer → Discord. */
async function fromFluxer(message) {
  if (!ready() || isOwn(message, 'fluxer') || ignored(message)) return false;
  const target = destination(message, 'fluxer');
  if (!target || !body(message)) return false;
  const asPersona = await sendAsPersona(
    'discord', target, message, emoji.toDiscord(body(message) ?? ''));
  if (asPersona) return true;

  const text = format(message, { platform: 'fluxer' });
  if (!text) return false;
  const channel = await clients.discord.channels.fetch(target);
  // Keine Erwähnungen auslösen: gespiegelter Text soll niemanden anpingen.
  await channel.send({ content: emoji.toDiscord(text), allowedMentions: { parse: [] } });
  return true;
}

module.exports = {
  enabled, DISCORD_CHANNEL, FLUXER_CHANNEL, MAX_LENGTH, RELAY_ALL, EXCLUDE, OVERRIDES,
  WEBHOOKS, WEBHOOK_NAME, NAME_SUFFIX, IGNORE_WEBHOOKS,
  register, ready, discordClient, format, flattenEmbed, shouldRelay, fromDiscord, fromFluxer,
  normalize, counterpart, destination, textChannels,
  body, displayName, avatarOf, ignored, webhookFor, sendAsPersona, ownWebhookIds, hooks,
};
