/**
 * ===========================================================================
 *  ANGELN – Fangtabelle
 * ===========================================================================
 *
 * Die erste Tätigkeit, die an einem Ausrüstungsgegenstand hängt: Wer eine
 * **Angelausrüstung** besitzt, kann damit auch etwas tun, statt sie nur als
 * Job-Voraussetzung im Schrank liegen zu haben.
 *
 * Wert eines Fangs = Grundwert × Größenfaktor. Der Größenfaktor kommt aus
 * einer Spanne je Fisch – derselbe Karpfen ist mal 2, mal 9 Kilo schwer.
 *
 * `weight` ist die Fangwahrscheinlichkeit. Sie ist bewusst so gesetzt, dass
 * Schrott und Kleinfische den Alltag bilden; die dicken Dinger sind selten
 * genug, um eine Geschichte wert zu sein.
 */

const CATCHES = [
  // ------------------------------------------------------------- Schrott
  { name: 'Alter Stiefel', emoji: '🥾', weight: 7, value: 0, kg: [1, 2],
    line: 'Ein Stiefel. Natürlich ein Stiefel.' },
  { name: 'Rostiges Fahrrad', emoji: '🚲', weight: 3, value: 40, kg: [8, 14],
    line: 'Wer wirft sowas in einen See?' },
  { name: 'Einkaufswagen', emoji: '🛒', weight: 2, value: 60, kg: [12, 20],
    line: 'Pfand gibt es dafür leider keins.' },
  { name: 'Nasse Socke', emoji: '🧦', weight: 3, value: 0, kg: [0.1, 0.4],
    line: 'Sie war mal weiß.' },

  // ------------------------------------------------------------ Alltag
  { name: 'Rotauge', emoji: '🐟', weight: 16, value: 55, kg: [0.2, 0.8],
    line: 'Klein, aber es zählt.' },
  { name: 'Barsch', emoji: '🐟', weight: 14, value: 90, kg: [0.3, 1.4],
    line: 'Stachelig, aber lecker.' },
  { name: 'Brasse', emoji: '🐠', weight: 11, value: 110, kg: [1, 4],
    line: 'Schleimig und schwer zu halten.' },
  { name: 'Forelle', emoji: '🐟', weight: 10, value: 180, kg: [0.5, 2.5],
    line: 'Die kann man guten Gewissens essen.' },
  { name: 'Aal', emoji: '🐍', weight: 7, value: 260, kg: [0.5, 3],
    line: 'Hat sich dreimal um den Kescher gewickelt.' },

  // ------------------------------------------------------------ Fänge
  { name: 'Zander', emoji: '🐡', weight: 6, value: 420, kg: [2, 8],
    line: 'Ein Raubfisch. Endlich mal Gegenwehr.' },
  { name: 'Hecht', emoji: '🦈', weight: 5, value: 620, kg: [3, 12],
    line: 'Zähne wie eine Bandsäge.' },
  { name: 'Karpfen', emoji: '🐋', weight: 4, value: 780, kg: [4, 18],
    line: 'Der Kescher hat gebogen.' },
  { name: 'Wels', emoji: '🐉', weight: 2, value: 1600, kg: [10, 60],
    line: 'Zwanzig Minuten Drill. Der Rücken meldet sich morgen.' },

  // ------------------------------------------------------------ Kuriosa
  { name: 'Goldfisch (echt vergoldet)', emoji: '✨', weight: 0.8, value: 3200, kg: [0.2, 0.5],
    line: 'Jemand hat hier sein Erbe entsorgt.' },
  { name: 'Versunkene Geldkassette', emoji: '💰', weight: 0.5, value: 5200, kg: [3, 9],
    line: 'Das Schloss war schon offen. Nicht fragen.' },
  { name: 'Ente mit Talenten', emoji: '🦆', weight: 0.4, value: 2400, kg: [1, 3],
    line: 'Sie sah dich an und nickte. Ihr habt eine Abmachung.' },
  { name: 'Nummernschild eines Vermissten', emoji: '🚗', weight: 0.6, value: 900, kg: [1, 2],
    line: 'Das gehörte mal zu einem Auto. Fragen kostet nichts.' },
  { name: 'Alte Bootsschraube', emoji: '⚓', weight: 1.5, value: 340, kg: [3, 7],
    line: 'Bronze. Der Schrotthändler freut sich.' },
];

/** Wo man angelt – reine Deko, aber sie macht die Meldung lebendig. */
const SPOTS = [
  'am alten Kanal',
  'unter der Brücke',
  'am Baggersee',
  'im Hafenbecken',
  'am Wehr',
  'auf dem Steg hinter der Werkstatt',
];

/** Wie es gelaufen ist, bevor etwas anbeißt. */
const INTROS = [
  'Zwei Stunden Stille, dann zuckt die Rute:',
  'Kaum ausgeworfen, schon beißt es:',
  'Der Schwimmer taucht ab –',
  'Nach dem dritten Kaffee endlich ein Ruck:',
  'Du hättest fast eingepackt, da:',
];

/** Wenn gar nichts anbeißt. */
const EMPTY = [
  '🎣 Nichts. Nur Wasser, Wind und deine Gedanken.',
  '🎣 Der Köder ist weg, der Fisch auch. So läuft das.',
  '🎣 Drei Bisse, kein Fang. Angeln ist Kopfsache.',
  '🎣 Ein Schwan hat sich beschwert und du hast eingepackt.',
];

module.exports = { CATCHES, SPOTS, INTROS, EMPTY };
