/**
 * ===========================================================================
 *  LEICHTE EREIGNISSE DER MUSIKKARRIERE
 * ===========================================================================
 *
 * Das Gegenstück zu EVENTS in data/creator.js: an jeder Aktion gewürfelt,
 * wirkt sofort, kein Klick. Vier je Aktion, je zwei gut und zwei schlecht.
 * Der Ausschlag ist bewusst größer als beim Creator – die Musik soll die
 * schwerere Karriere sein.
 *
 *   on       die Aktion, an der das Ereignis hängt: record | publish | show
 *   risky    Gewicht wird mit dem Genre-Risiko multipliziert (Hip-Hop 1,3,
 *            Klassik 0,5) – das Feld `risk` in data/music.js war bis hierher
 *            nirgends ausgewertet
 *   songs    Studio: ersetzt das +1 (2 beim Flow, 0 bei kaputter Aufnahme)
 *   breaks   Studio: die Ausrüstung geht kaputt
 *   hype     Faktor auf die Form
 *   audience Release: Faktor auf das Publikum, wirkt vor der Konversion
 *   pay      Konzert: Faktor auf die Gage VOR der Buchung (0 = keine Buchung)
 *   gain     Konzert: Faktor auf die neuen Hörer
 */

const MUSIC_EVENTS = [
  { id: 'none', weight: 110, text: null },

  // ------------------------------------------------------------- Studio
  { id: 'flow', weight: 7, on: ['record'], songs: 2,
    text: '🌊 Der Flow war da. Zwei Songs statt einem, und beide sitzen.' },
  { id: 'geistesblitz', weight: 6, on: ['record'], hype: 1.15,
    text: '💡 Eine Idee, die du seit Wochen gesucht hast. Plötzlich passt alles.' },
  { id: 'aufnahme', weight: 7, on: ['record'], songs: 0, risky: true,
    text: '🗑️ Die Aufnahme ist hin. Drei Stunden für nichts.' },
  { id: 'equipment', weight: 3, on: ['record'], songs: 0, breaks: true, risky: true,
    text: '💥 Mitten im Take gibt das Setup auf. Kein Song, kein Setup.' },

  // ------------------------------------------------------------ Release
  { id: 'hit', weight: 4, on: ['publish'], audience: 3.0, hype: 1.25,
    text: '🚀 Das Ding läuft. Überall. Leute, die dich nie gehört haben, singen mit.' },
  { id: 'radio', weight: 6, on: ['publish'], audience: 1.8, hype: 1.2,
    text: '📻 Ein Sender hat dich in die Rotation genommen. Autofahrer kennen dich jetzt.' },
  { id: 'flop', weight: 7, on: ['publish'], audience: 0.4, risky: true,
    text: '🪦 Niemand hat es bemerkt. Passiert.' },
  { id: 'algorithmus', weight: 6, on: ['publish'], audience: 0.6, risky: true,
    text: '🤖 Die Playlist-Kuratoren hatten heute andere Favoriten.' },

  // ------------------------------------------------------------ Konzert
  { id: 'ausverkauft', weight: 6, on: ['show'], pay: 1.6, gain: 1.5,
    text: '🎟️ Ausverkauft. Die Halle vibriert, bevor du überhaupt auf der Bühne bist.' },
  { id: 'gastauftritt', weight: 5, on: ['show'], pay: 1.3, hype: 1.2,
    text: '🤝 Jemand Großes kam auf die Bühne. Das Video davon läuft schon.' },
  { id: 'ton', weight: 6, on: ['show'], pay: 0.6, hype: 0.9, risky: true,
    text: '🔇 Tonprobleme. Die erste halbe Stunde war ein Brummen.' },
  { id: 'abgesagt', weight: 3, on: ['show'], pay: 0, gain: 0, risky: true,
    text: '🚫 Abgesagt – Halle, Wetter, irgendwas. Die Zeit ist trotzdem weg.' },
];

/**
 * Die Kandidaten einer Aktion mit ihren Gewichten. Aus derselben Funktion
 * ziehen der Würfel und die Tests – so lässt sich ein bestimmtes Ereignis
 * mit einer festen Zufallszahl erzwingen.
 */
function candidates(action, risk = 1) {
  return MUSIC_EVENTS
    .filter((e) => !e.on || e.on.includes(action))
    .map((e) => ({ event: e, weight: e.risky ? e.weight * risk : e.weight }));
}

module.exports = { MUSIC_EVENTS, candidates };
