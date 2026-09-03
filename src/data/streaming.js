/**
 * ===========================================================================
 *  STREAMING – Kategorien, Ereignisse und Chat
 * ===========================================================================
 *
 * Anders als beim Angeln ist ein Stream keine einzelne Auszahlung, sondern ein
 * Schritt beim **Aufbau eines Kanals**. Deshalb hängt hier alles an drei
 * Stellschrauben, die jede Kategorie anders gewichtet:
 *
 *   reach    Wie viele Leute überhaupt reinschauen
 *   donate   Wie spendabel das Publikum ist
 *   follow   Wie viele davon hängenbleiben
 *   risk     Wie wahrscheinlich etwas schiefgeht
 *
 * Keine Kategorie ist insgesamt die beste: Wer Reichweite will, nimmt IRL und
 * lebt mit dem Risiko; wer ruhig Geld einsammeln will, quatscht.
 */

const CATEGORIES = [
  {
    id: 'chatting', name: 'Just Chatting', emoji: '💬',
    reach: 0.85, donate: 1.6, follow: 1.0, risk: 1.0,
    blurb: 'Reden. Einfach reden. Das Publikum zahlt fürs Zuhören.',
    titles: [
      'wir reden über alles außer dem Thema',
      'Kaffee, Chaos und ein bisschen Selbstmitleid',
      'Fragerunde bis mir die Antworten ausgehen',
      'Ich lese eure Nachrichten vor (mutig)',
    ],
  },
  {
    id: 'gaming', name: 'Gaming', emoji: '🎮',
    reach: 1.15, donate: 0.8, follow: 1.05, risk: 0.9,
    blurb: 'Der Klassiker. Große Reichweite, aber das Publikum ist knausrig.',
    titles: [
      'Ranked bis zum Tilt',
      'Wir schaffen das Level heute. Vermutlich.',
      'Blind durch ein Spiel, das ich nicht verstehe',
      'Ein Versuch noch, dann ist Schluss (Lüge)',
    ],
  },
  {
    id: 'speedrun', name: 'Speedrun', emoji: '⏱️',
    reach: 1.0, donate: 1.0, follow: 1.25, risk: 1.15,
    blurb: 'Nische mit harten Fans. Wenn der Run sitzt, explodiert der Kanal.',
    titles: [
      'PB-Versuch #412',
      'Any% bis die Hände weh tun',
      'Der Skip klappt heute. Ganz sicher.',
      'World Record Pace (bis Level 3)',
    ],
  },
  {
    id: 'musik', name: 'Musik', emoji: '🎧',
    reach: 0.9, donate: 1.45, follow: 0.9, risk: 1.0,
    blurb: 'Wenig Laufkundschaft, dafür großzügige Stammhörer.',
    titles: [
      'Wunschkonzert – ihr sucht aus',
      'Beats bauen, live und ohne Netz',
      'Cover-Abend mit fragwürdiger Tonlage',
      'Lofi zum Lernen und Verzweifeln',
    ],
  },
  {
    id: 'irl', name: 'IRL / Draußen', emoji: '🚶',
    reach: 1.25, donate: 1.0, follow: 1.0, risk: 1.5,
    blurb: 'Höchste Reichweite – und die meisten Dinge, die schiefgehen können.',
    titles: [
      'Stadtbummel mit fragwürdiger Route',
      'Wir suchen den besten Döner der Stadt',
      'Zug fahren und Leute anschauen',
      'Ich laufe, bis das Handy leer ist',
    ],
  },
  {
    id: 'kochen', name: 'Kochen', emoji: '🍳',
    reach: 0.8, donate: 1.2, follow: 0.85, risk: 0.75,
    blurb: 'Gemütlich, sicher, überschaubar. Der Feierabend unter den Streams.',
    titles: [
      'Wir kochen etwas, das ich noch nie gekocht habe',
      'Ein Rezept aus dem Chat (schlechte Idee)',
      'Meal Prep für die ganze Woche',
      'Backen ohne Waage – Augenmaß ist alles',
    ],
  },
];

/**
 * Ereignisse während des Streams.
 *
 * `viewers`, `follow` und `donate` sind Multiplikatoren auf das jeweilige
 * Ergebnis, `loss` ein direkter Follower-Verlust in Prozent. `risky` heißt:
 * Die Wahrscheinlichkeit steigt mit dem Risiko der Kategorie.
 *
 * Die Gewichte sind so gesetzt, dass in etwa jedem zweiten Stream irgendetwas
 * passiert – sonst wäre die Meldung immer gleich und niemand würde sie lesen.
 */
const EVENTS = [
  { id: 'none', weight: 100, text: null },

  // ------------------------------------------------------------ angenehm
  { id: 'raid', weight: 10, viewers: 1.8, follow: 1.4,
    text: '🚀 Ein größerer Kanal hat dich am Ende geraidet – plötzlich war die Bude voll.' },
  { id: 'clip', weight: 8, viewers: 1.25, follow: 2.2,
    text: '✂️ Ein Clip von dir ist rausgegangen. Leute kamen rein und blieben.' },
  { id: 'whale', weight: 7, donate: 3.5,
    text: '🐳 Jemand mit zu viel Geld und zu wenig Schlaf hat den Chat geflutet.' },
  { id: 'algorithmus', weight: 6, viewers: 1.5, follow: 1.2,
    text: '📈 Die Empfehlungen mochten dich heute. Frag nicht, warum.' },
  { id: 'kollab', weight: 5, viewers: 1.35, follow: 1.3, donate: 1.2,
    text: '🤝 Spontane Kollab mit jemandem aus deinem Chat – hat erstaunlich gut funktioniert.' },

  // ------------------------------------------------------------- ärgerlich
  { id: 'technik', weight: 9, viewers: 0.55, follow: 0.5, risky: true,
    text: '🔌 Technikprobleme. Die halbe Sendung war ein Standbild.' },
  { id: 'troll', weight: 8, donate: 0.6, loss: 0.02, risky: true,
    text: '👹 Eine Trollwelle im Chat. Ein paar Stammgäste hatten keine Lust mehr.' },
  { id: 'lag', weight: 7, viewers: 0.7, follow: 0.7, risky: true,
    text: '🐌 Das Internet war heute... kreativ. Ruckeln in HD.' },
  { id: 'stromausfall', weight: 4, viewers: 0.35, follow: 0.4, donate: 0.5, risky: true,
    text: '💡 Stromausfall mitten im Stream. Ende, aus, Sicherung.' },
  { id: 'skandal', weight: 3, loss: 0.06, donate: 0.7, risky: true,
    text: '🔥 Ein unglücklicher Satz, ein Screenshot, eine Diskussion. Das kostet Follower.' },
  { id: 'defekt', weight: 3, breaks: true, viewers: 0.6, risky: true,
    text: '💥 Mitten im Stream hat das Setup den Dienst quittiert.' },
];

/** Spendenkommentare – kurz, absurd, gelegentlich passiv-aggressiv. */
const DONATIONS = [
  'für die Katzenstreu',
  'sorry für den schlechten Witz eben',
  'ich schaue seit drei Jahren und schreibe zum ersten Mal',
  'mein Chef zahlt das, er weiß es nur nicht',
  'kauf dir ein besseres Mikrofon',
  'das war der schlechteste Take, den ich je gesehen habe. Weiter so',
  'ich bin nur wegen der Musik hier',
  'Grüße an meine Mutter, sie schaut mit',
  'nicht vorlesen',
  'BITTE VORLESEN',
  'ich habe eigentlich kein Geld',
  'für den Umzug in eine Wohnung mit Fenster',
  'du hast mir durch eine schwere Nachtschicht geholfen',
  'das ist mein letztes Geld bis Freitag',
  'ich wollte nur sehen, ob du meinen Namen richtig aussprichst',
];

/** Chatzeilen fürs Flair – rein kosmetisch. */
const CHAT = [
  'erster',
  'ist das ein neuer Hintergrund?',
  'die Kamera ist unscharf',
  'wer schaut das 2026 noch',
  'mach mal lauter',
  'mach mal leiser',
  'F',
  'das war knapp',
  'ich muss gleich weg, aber ich lasse den Tab offen',
  'sag mal was auf Sächsisch',
  'mein Beileid an dein Setup',
  'gib Kanal',
];

/** Wie ein Stream anfängt. */
const INTROS = [
  'Licht an, Mikro auf,',
  'Nach zwanzig Minuten Technikcheck:',
  'Ohne Vorwarnung live gegangen –',
  'Mit drei Stunden Verspätung, aber immerhin:',
  'Vollständig unvorbereitet:',
];

module.exports = { CATEGORIES, EVENTS, DONATIONS, CHAT, INTROS };
