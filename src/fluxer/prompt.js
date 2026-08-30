/**
 * ===========================================================================
 *  PROMPT – Ersatz für Modals
 * ===========================================================================
 *
 * Fluxer kennt keine Modals (Eingabefenster). Wo das Original eines öffnet
 * (eigener Casino-Einsatz, Auktionsgebot, Profil-Spruch), fragt der Bot hier
 * einfach im Kanal nach und wartet auf die nächste Nachricht des Spielers.
 *
 * Bewusst mit Zeitlimit: sonst bliebe eine Frage ewig offen und die nächste
 * beliebige Nachricht würde als Antwort gewertet.
 */

const TIMEOUT_MS = 60 * 1000;

/** Offene Fragen: "<kanal>:<spieler>" -> auflösende Funktion. */
const waiting = new Map();

const keyOf = (channelId, userId) => `${channelId}:${userId}`;

/**
 * Stellt eine Frage und wartet auf die Antwort des Spielers.
 * @returns {Promise<string|null>} die Antwort, oder null bei Zeitablauf.
 */
async function ask({ channel, userId, title = 'Eingabe', label = 'Wert', timeoutMs = TIMEOUT_MS }) {
  const key = keyOf(channel.id, userId);

  // Eine ältere, noch offene Frage desselben Spielers verfällt.
  waiting.get(key)?.(null);

  await channel.send({
    content: `<@${userId}> **${title}** – ${label}?\n` +
      `_Antworte einfach mit deiner Eingabe (${Math.round(timeoutMs / 1000)} s Zeit)._`,
  }).catch(() => {});

  return new Promise((resolve) => {
    const timer = setTimeout(() => {
      waiting.delete(key);
      resolve(null);
    }, timeoutMs);

    waiting.set(key, (value) => {
      clearTimeout(timer);
      waiting.delete(key);
      resolve(value);
    });
  });
}

/**
 * Prüft, ob diese Nachricht die Antwort auf eine offene Frage ist.
 * @returns {boolean} true, wenn sie als Antwort verbraucht wurde.
 */
function consume(message) {
  const key = keyOf(message.channel?.id ?? message.channelId, message.author?.id);
  const resolve = waiting.get(key);
  if (!resolve) return false;
  resolve(message.content ?? '');
  return true;
}

/** Wie viele Fragen gerade offen sind (für Tests/Diagnose). */
const pending = () => waiting.size;

module.exports = { TIMEOUT_MS, ask, consume, pending };
