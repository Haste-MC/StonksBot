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
  const mentionId = ctx.platformUserId ?? userId;
  let message = ctx.message ?? null;

  /** Schickt eine Ansicht in die Menü-Nachricht (oder legt sie neu an). */
  async function show(view) {
    const { embed, mapping, reactions } = render.toMessage(view);

    // Welche Reaktionen hängen aktuell dran? (aus der gemerkten Zuordnung)
    const previous = message ? render.current(message.id) : [];
    let fresh = false;

    if (message) {
      // Bevorzugt in derselben Nachricht bleiben – wie das Original, das das
      // Panel neu aufbaut. Klappt das nicht, wird neu gesendet.
      try {
        await message.edit({ embeds: [embed] });
      } catch (err) {
        debug('edit fehlgeschlagen, sende neu:', err?.message);
        message = await channel.send({ embeds: [embed] });
        fresh = true;
      }
    } else {
      message = await channel.send({ embeds: [embed] });
      fresh = true;
    }

    render.remember(message.id, userId, mapping);
    await syncReactions(message, reactions, fresh ? [] : previous);
    return message;
  }

  /**
   * Bringt die Reaktionen auf den Stand der neuen Ansicht.
   *
   * Wichtig: Beim Wechsel der Ansicht müssen die Reaktionen der VORHERIGEN
   * verschwinden – sonst kleben tote Symbole an der Nachricht, die nichts
   * mehr auslösen. Es werden nur die Unterschiede angefasst, damit nicht bei
   * jedem Klick ein Dutzend Anfragen anfällt.
   */
  async function syncReactions(msg, wanted, previous = []) {
    const keep = new Set(wanted);

    for (const emoji of previous) {
      if (keep.has(emoji)) continue;
      await msg.removeReactionEmoji?.(emoji).catch((err) => {
        debug('konnte alte Reaktion nicht entfernen:', emoji, err?.message);
      });
    }

    for (const emoji of wanted) {
      if (previous.includes(emoji)) continue;   // hängt schon dran
      try {
        await msg.react(emoji);
      } catch (err) {
        debug('Reaktion konnte nicht gesetzt werden:', emoji, err?.message);
      }
    }
  }

  function debug(...args) {
    if (process.env.FLUXER_DEBUG === 'true') console.log('[fluxer]', ...args);
  }

  /** Meldung an den Spieler – auf Fluxer immer sichtbar im Kanal. */
  async function notify(payload) {
    const content = typeof payload === 'string' ? payload : payload?.content;
    if (!content) return null;
    return channel.send({ content: `<@${mentionId}> ${content}` }).catch(() => null);
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
