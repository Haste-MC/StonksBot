const config = require('./config');
const render = require('./render');
const prompt = require('./prompt');
const commands = require('./commands');
const { createInteraction } = require('./interaction');
const { buttons, modals, parseId } = require('../buttons');
const db = require('../db');
const identity = require('../identity');
const relay = require('../relay');

/**
 * ===========================================================================
 *  FLUXER-BOT – Einstiegspunkt
 * ===========================================================================
 *
 * Zwei Wege führen zu einer Aktion:
 *
 *   1. **Textbefehl** (`!menu`, `!shop 2`, `!kaufen 42`) -> Ansicht bauen,
 *      als Embed senden und mit Reaktionen versehen.
 *   2. **Reaktion** auf ein Menü -> nachschlagen, welcher Button gemeint war,
 *      und den **unveränderten Handler aus buttons.js** aufrufen.
 *
 * Dadurch teilt sich diese Version die komplette Spiellogik und alle Ansichten
 * mit der Discord-Version.
 */

// @fluxerjs/core ist die Bibliothek des Projekts; `fluxerjs` bündelt sie.
// Beides wird akzeptiert, damit die Installation flexibel bleibt.
function loadSdk() {
  for (const name of ['@fluxerjs/core', 'fluxerjs']) {
    try { return require(name); } catch { /* nächste probieren */ }
  }
  console.error(
    '❌ Fluxer-SDK nicht gefunden. Installiere es mit:  npm install @fluxerjs/core');
  process.exit(1);
}

const { Client, Events } = loadSdk();
const client = new Client();

client.on(Events.Ready, () => {
  console.log(`✅ Fluxer-Bot bereit – Präfix "${config.prefix}"`);
  relay.register('fluxer', client);
  if (relay.enabled) console.log('🔗 Kanal-Brücke: Fluxer-Seite bereit.');
  db.purgeFluxerViews();

  // Kataloge (Autos, Immobilien, Ausrüstung) liegen PRO SERVER in der
  // Datenbank. Damit man weiß, womit man sie befüllt, hier die IDs ausgeben.
  try {
    const guilds = [...(client.guilds?.values?.() ?? [])];
    for (const g of guilds) {
      const cars = db.allItemsOfKind(g.id, 'car').length;
      console.log(`   Server "${g.name ?? g.id}" (${g.id}) – ${cars} Autos im Katalog` +
        (cars === 0 ? `  ⚠️  noch leer:  npm run seed -- ${g.id}` : ''));
    }
  } catch { /* Serverliste noch nicht geladen – nicht schlimm */ }
});

// ------------------------------------------------------------ Textbefehle

client.on(Events.MessageCreate, async (message) => {
  try {
    // Erst spiegeln, dann verarbeiten: Auch Befehle anderer Spieler sollen
    // drüben sichtbar sein. Eigene Nachrichten filtert die Brücke selbst.
    relay.fromFluxer(message).catch((err) =>
      console.error('Brücke Fluxer→Discord:', err.message));

    if (message.author?.bot) return;

    // Wartet gerade eine Frage auf Antwort? (Modal-Ersatz)
    if (prompt.consume(message)) return;

    const content = (message.content || '').trim();
    if (!content.startsWith(config.prefix)) return;

    const [name, ...args] = content.slice(config.prefix.length).split(/\s+/);
    const command = commands.find(name);
    if (!command) return;

    // Auf Welt und Konto übersetzen – dadurch teilt sich ein verknüpfter
    // Spieler seinen Fortschritt mit der Discord-Seite.
    const platformUserId = message.author.id;
    const accountId = identity.account('fluxer', platformUserId);
    identity.remember(accountId, message.author.displayName ?? message.author.username);

    const ctx = {
      guildId: identity.world(),
      userId: accountId,
      platformUserId,
      args,
      prefix: config.prefix,
      isAdmin: require('../accounts').isAdmin(platformUserId),
    };

    const result = await command.run(ctx);

    if (result?.text) {
      await message.channel.send({ content: `<@${platformUserId}> ${result.text}` });
    }
    if (result?.view) {
      await present(message.channel, ctx.userId, result.view, platformUserId);
    }
    if (result?.note) {
      await message.channel.send({ content: `<@${platformUserId}> ${result.note}` });
    }
  } catch (err) {
    console.error('Fehler bei einem Befehl:', err);
    await message.channel?.send({ content: '❌ Da ist etwas schiefgelaufen.' }).catch(() => {});
  }
});

// -------------------------------------------------------------- Reaktionen

client.on(Events.MessageReactionAdd, async (payload) => {
  try {
    const { emoji, userId, messageId } = normalize(payload);
    debug('Reaktion empfangen', { emoji, userId, messageId });
    if (!userId || !messageId || !emoji) return;

    // Der Bot setzt die Reaktionen selbst – diese Ereignisse ignorieren.
    if (userId === client.user?.id) return;

    const hit = render.lookup(messageId, emoji);
    if (!hit) return debug('  -> keine bekannte Menü-Nachricht');

    // Wie im Original: Das Menü gehört dem, der es geöffnet hat – verglichen
    // wird auf Kontoebene, damit es auch nach einer Verknüpfung passt.
    const accountId = identity.account('fluxer', userId);
    if (String(hit.userId) !== String(accountId)) {
      return debug('  -> fremdes Menü, ignoriert');
    }

    const message = await fetchMessage(payload);
    if (!message) return debug('  -> Nachricht nicht abrufbar');

    debug('  -> führe aus:', hit.customId);
    await dispatch(hit.customId, {
      channel: message.channel,
      message,
      userId: accountId,
      platformUserId: userId,
      guildId: identity.world(),
    });

    // Reaktion zurücknehmen, damit derselbe Knopf erneut gedrückt werden kann.
    await message.removeReaction(emoji, userId).catch(() => {});
  } catch (err) {
    console.error('Fehler bei einer Reaktion:', err);
  }
});

/** Ruft den passenden Handler aus buttons.js auf – unverändert wiederverwendet. */
async function dispatch(customId, ctx) {
  const { action, parts } = parseId(customId);
  const handler = buttons[action];
  if (!handler) return;

  const interaction = createInteraction({
    ...ctx,
    prompt: async ({ channel, userId, title, label }) =>
      prompt.ask({ channel, userId, title, label }),
  });

  // Modals gibt es nicht: Öffnet ein Handler eines, fragen wir im Chat nach
  // und rufen anschließend den zugehörigen Modal-Handler auf.
  const originalShowModal = interaction.showModal;
  interaction.showModal = async (modal) => {
    const { customId: modalId, answer } = await originalShowModal.call(interaction, modal);
    if (answer === null) return;
    const { action: modalAction, parts: modalParts } = parseId(modalId);
    const field = fieldNameOf(modal);
    const modalInteraction = createInteraction({ ...ctx, prompt: ctx.prompt });
    modalInteraction.fields = { getTextInputValue: () => answer, get: () => answer, field };
    await modals[modalAction]?.(modalInteraction, modalParts);
  };

  await handler(interaction, parts);
}

/** Name des Eingabefelds eines Modals (für fields.getTextInputValue). */
function fieldNameOf(modal) {
  const json = typeof modal.toJSON === 'function' ? modal.toJSON() : modal;
  return json.components?.[0]?.components?.[0]?.custom_id ?? 'value';
}

/** Sendet eine Ansicht und merkt sich die Reaktions-Zuordnung. */
async function present(channel, userId, view, platformUserId = userId) {
  const interaction = createInteraction({
    channel, message: null, userId, platformUserId, guildId: identity.world(),
    prompt: prompt.ask,
  });
  return interaction.update(view);
}

/** Die Server-ID – je nach SDK-Objekt an unterschiedlicher Stelle. */
function guildOf(obj) {
  return obj?.guildId ?? obj?.guild?.id ?? obj?.channel?.guildId ?? null;
}

/**
 * Vereinheitlicht das Reaktions-Ereignis. Das SDK liefert
 * `{ reaction, user, messageId, channelId, emoji: { name }, userId }`.
 */
function normalize(payload) {
  const emoji = typeof payload?.emoji === 'string'
    ? payload.emoji
    : payload?.emoji?.name ?? payload?.reaction?.emojiIdentifier;
  return {
    emoji,
    userId: payload?.userId ?? payload?.user?.id,
    messageId: payload?.messageId ?? payload?.reaction?.messageId,
  };
}

/**
 * Holt die Nachricht, auf die reagiert wurde.
 *
 * Das Reaktions-Ereignis liefert nur IDs (`messageId`, `channelId`) – die
 * Nachricht selbst steckt nicht darin. Dafür bringt das `reaction`-Objekt eine
 * eigene `fetchMessage()` mit; das ist der vorgesehene Weg.
 */
async function fetchMessage(payload) {
  const reaction = payload?.reaction;
  if (reaction?.fetchMessage) {
    const msg = await reaction.fetchMessage().catch(() => null);
    if (msg) return msg;
  }
  // Ausweichweg, falls das SDK die Nachricht doch mitschickt.
  if (payload?.message?.edit) return payload.message;
  return null;
}

/** Diagnose-Ausgaben, wenn FLUXER_DEBUG=true gesetzt ist. */
function debug(...args) {
  if (process.env.FLUXER_DEBUG === 'true') console.log('[fluxer]', ...args);
}

client.login(config.token);
