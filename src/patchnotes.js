const db = require('./db');
const notes = require('./data/patchnotes');

/**
 * ===========================================================================
 *  PATCHNOTES-ZUSTELLUNG
 * ===========================================================================
 *
 * Wer den Bot benutzt und eine neuere Version noch nicht gesehen hat, bekommt
 * die Notes **einmalig** ins Postfach gelegt – plus einen kurzen Toast.
 *
 * Passt zur faulen Architektur (§4): kein Broadcast, kein Scheduler, keine DMs.
 * Zugestellt wird beim nächsten Mal, wenn der Spieler ohnehin interagiert.
 *
 * Idempotent: nach der Zustellung wird die Version pro Spieler gemerkt, ein
 * zweiter Aufruf liefert nichts mehr.
 */

/** Die aktuelle Version (oberster Eintrag). */
const LATEST = notes[0]?.version ?? '';

/**
 * Welche Einträge dieser Spieler noch nicht gesehen hat.
 *
 * Wer noch nie Notes bekommen hat (neuer Spieler ODER Bestandsspieler beim
 * allerersten Rollout) bekommt **nur die neueste** – die komplette Historie
 * nachzuwerfen wäre reines Rauschen.
 */
function pending(seenVersion) {
  if (!notes.length) return [];
  if (!seenVersion) return [notes[0]];

  const index = notes.findIndex((n) => n.version === seenVersion);
  if (index === -1) return [notes[0]];   // unbekannte Version -> nur die neueste
  return notes.slice(0, index);          // alles, was neuer ist
}

/** Formatiert einen Eintrag als Postfach-Text. */
function formatBody(note) {
  return `**${note.title}**\n${note.lines.map((l) => `• ${l}`).join('\n')}`;
}

/**
 * Legt ausstehende Patchnotes ins Postfach und merkt sich die Version.
 *
 * @returns {string|null} Kurzer Hinweistext für einen Toast, oder null.
 */
function deliver(guildId, userId) {
  const stats = db.getStats(guildId, userId);
  const due = pending(stats.seen_version);
  if (!due.length) return null;

  // Älteste zuerst einlegen, damit die neueste oben im Postfach liegt.
  for (const note of [...due].reverse()) {
    db.createMessage({
      guildId,
      userId,
      type: 'info',
      title: `Update ${note.version} – ${note.title}`,
      body: formatBody(note),
      sender: 'Entwicklung',
    });
  }

  db.setSeenVersion(guildId, userId, LATEST);

  const newest = due[0];
  return `📢 **Update ${newest.version}: ${newest.title}** — ` +
    `die Patchnotes liegen in deinem 📬 **Postfach**.`;
}

module.exports = { LATEST, notes, pending, formatBody, deliver };
