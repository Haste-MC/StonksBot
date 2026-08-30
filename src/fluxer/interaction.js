const render = require('./render');

/**
 * ===========================================================================
 *  INTERACTION-ADAPTER
 * ===========================================================================
 *
 * Die ~1100 Zeilen Handler in `buttons.js` erwarten ein Discord-`interaction`
 * mit `deferUpdate/editReply/update/followUp/reply`. Fluxer kennt so etwas
 * nicht – es gibt nur Nachrichten und Reaktionen.
 *
 * Dieses Modul baut ein Objekt, das sich **wie** ein Interaction verhält, aber
 * auf Fluxer-Nachrichten arbeitet. Dadurch laufen die bestehenden Handler
 * unverändert weiter – das ist der eigentliche Trick der Portierung.
 *
 * Unterschiede, die Fluxer aufzwingt:
 *  - **Kein „ephemeral"**: private Antworten gibt es nicht. Solche Meldungen
 *    gehen als normale Nachricht mit Erwähnung in den Kanal.
 *  - **Kein Modal**: `showModal` fragt stattdessen im Chat nach (siehe prompt.js).
 */

/**
 * @param ctx {{ channel, message, userId, guildId, prompt }}
 *   channel  Fluxer-Kanal zum Senden
 *   message  die Menü-Nachricht, die aktualisiert wird (oder null)
 *   userId   wer bedient
 *   prompt   Funktion für Texteingaben (Modal-Ersatz)
 */
function createInteraction(ctx) {
  const { channel, userId, guildId } = ctx;
  let message = ctx.message ?? null;

  /** Schickt eine Ansicht in die Menü-Nachricht (oder legt sie neu an). */
  async function show(view) {
    const { embed, mapping, reactions } = render.toMessage(view);

    if (message) {
      // Bevorzugt in derselben Nachricht bleiben – wie das Original, das das
      // Panel neu aufbaut. Klappt das nicht, wird neu gesendet.
      try {
        await message.edit({ embeds: [embed] });
      } catch {
        message = await channel.send({ embeds: [embed] });
      }
    } else {
      message = await channel.send({ embeds: [embed] });
    }

    render.remember(message.id, userId, mapping);
    await syncReactions(message, reactions);
    return message;
  }

  /** Setzt die Reaktionen der Nachricht auf genau die benötigten. */
  async function syncReactions(msg, wanted) {
    for (const emoji of wanted) {
      try { await msg.react(emoji); } catch { /* Reaktion nicht setzbar */ }
    }
  }

  /** Meldung an den Spieler – auf Fluxer immer sichtbar im Kanal. */
  async function notify(payload) {
    const content = typeof payload === 'string' ? payload : payload?.content;
    if (!content) return null;
    return channel.send({ content: `<@${userId}> ${content}` }).catch(() => null);
  }

  return {
    // --- Identität, wie sie die Handler lesen ---
    guildId,
    user: { id: userId },
    channel,
    get message() { return message; },

    // Rechte gibt es auf Fluxer (noch) nicht fein genug – Admin-Menüs bleiben zu.
    memberPermissions: { has: () => false },

    deferred: false,
    replied: false,

    // --- Die Discord-Oberfläche, die buttons.js benutzt ---
    async deferUpdate() { /* nichts nötig: wir editieren ohnehin gleich */ },
    async deferReply() { this.deferred = true; },
    async update(view) { return show(view); },
    async editReply(view) {
      // Handler rufen editReply entweder mit einer Ansicht oder mit Text auf.
      if (view && (view.embeds || view.components)) return show(view);
      return notify(view);
    },
    async reply(payload) { this.replied = true; return notify(payload); },
    async followUp(payload) { return notify(payload); },

    /** Modal-Ersatz: im Chat nachfragen (siehe prompt.js). */
    async showModal(modal) {
      const json = typeof modal.toJSON === 'function' ? modal.toJSON() : modal;
      const field = json.components?.[0]?.components?.[0] ?? {};
      const answer = await ctx.prompt({
        channel, userId,
        title: json.title ?? 'Eingabe',
        label: field.label ?? 'Wert',
      });
      return { customId: json.custom_id, answer };
    },
  };
}

module.exports = { createInteraction };
