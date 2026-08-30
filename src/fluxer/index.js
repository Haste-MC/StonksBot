const config = require('./config');
const render = require('./render');
const prompt = require('./prompt');
const commands = require('./commands');
const { createInteraction } = require('./interaction');
const { buttons, modals, parseId } = require('../buttons');
const db = require('../db');

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
  db.purgeFluxerViews();
});

// ------------------------------------------------------------ Textbefehle

client.on(Events.MessageCreate, async (message) => {
  try {
    if (message.author?.bot) return;

    // Wartet gerade eine Frage auf Antwort? (Modal-Ersatz)
    if (prompt.consume(message)) return;

    const content = (message.content || '').trim();
    if (!content.startsWith(config.prefix)) return;

    const [name, ...args] = content.slice(config.prefix.length).split(/\s+/);
    const command = commands.find(name);
    if (!command) return;

    const ctx = {
      guildId: guildOf(message),
      userId: message.author.id,
      args,
      prefix: config.prefix,
    };

    const result = await command.run(ctx);

    if (result?.text) {
      await message.channel.send({ content: `<@${ctx.userId}> ${result.text}` });
    }
    if (result?.view) {
      await present(message.channel, ctx.userId, result.view);
    }
    if (result?.note) {
      await message.channel.send({ content: `<@${ctx.userId}> ${result.note}` });
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
    if (!userId || !messageId) return;
    if (userId === client.user?.id) return;          // eigene Reaktionen ignorieren

    const hit = render.lookup(messageId, emoji);
    if (!hit) return;                                 // keine unserer Menü-Nachrichten

    // Wie im Original: Das Menü gehört dem, der es geöffnet hat.
    if (hit.userId !== userId) return;

    const message = await fetchMessage(payload, messageId);
    if (!message) return;

    await dispatch(hit.customId, {
      channel: message.channel ?? payload.channel,
      message,
      userId,
      guildId: guildOf(message) ?? guildOf(payload),
    });

    // Reaktion zurücknehmen, damit derselbe Knopf erneut gedrückt werden kann.
    await message.removeReaction?.(emoji, userId).catch(() => {});
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
async function present(channel, userId, view) {
  const interaction = createInteraction({
    channel, message: null, userId, guildId: guildOf(channel),
    prompt: prompt.ask,
  });
  return interaction.update(view);
}

/** Die Server-ID – je nach SDK-Objekt an unterschiedlicher Stelle. */
function guildOf(obj) {
  return obj?.guildId ?? obj?.guild?.id ?? obj?.channel?.guildId ?? null;
}

/** Vereinheitlicht das Reaktions-Ereignis (Feldnamen je nach SDK-Version). */
function normalize(payload) {
  const emoji = payload?.emoji?.name ?? payload?.emoji ?? payload?.reaction?.emoji?.name;
  const userId = payload?.userId ?? payload?.user?.id;
  const messageId = payload?.messageId ?? payload?.message?.id ?? payload?.reaction?.message?.id;
  return { emoji, userId, messageId };
}

/** Holt die Nachricht, auf die reagiert wurde. */
async function fetchMessage(payload, messageId) {
  if (payload?.message?.edit) return payload.message;
  const channel = payload?.channel ?? payload?.reaction?.message?.channel;
  if (!channel?.messages?.fetch) return payload?.message ?? null;
  return channel.messages.fetch(messageId).catch(() => null);
}

client.login(config.token);
