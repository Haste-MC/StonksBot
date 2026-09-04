/**
 * ===========================================================================
 *  MUSIK – Genres, Veröffentlichungen, Verträge
 * ===========================================================================
 *
 * Die Königsdisziplin ohne eigene Firma: Ein Kanal wächst über Reichweite,
 * ein Künstler über **monatliche Hörer** – und die zahlen weiter, während man
 * schläft. Dafür ist der Weg dorthin länger, teurer und deutlich strenger.
 *
 * Zwei Wege, einmal zu wählen:
 *
 *   🎭 **Gesicht**  Du trittst öffentlich auf. Deine Socials wachsen kräftig
 *                   mit, Konzerte zahlen mehr, Marken wollen dich – dafür
 *                   trifft dich jeder Skandal doppelt, und in Japan oder
 *                   Korea klopft irgendwann eine Agentur an.
 *   🎭 **Anonym**   Niemand kennt dein Gesicht (wie Ado). Das Rätsel zieht:
 *                   mehr Abrufe je Hörer, keine Bildskandale, kein Ausbrennen
 *                   durch Öffentlichkeit. Dafür wachsen die Socials kaum,
 *                   Konzerte sind aufwendiger – und Idol wirst du nie.
 */

/** Genres. `reach` zieht Hörer, `royalty` bringt Geld, `live` füllt Hallen. */
const GENRES = [
  { id: 'pop', name: 'Pop', emoji: '✨', reach: 1.25, royalty: 1.00, live: 1.10, risk: 1.0,
    blurb: 'Größtes Publikum, härteste Konkurrenz.' },
  { id: 'hiphop', name: 'Hip-Hop', emoji: '🎤', reach: 1.20, royalty: 1.05, live: 1.05, risk: 1.3,
    blurb: 'Läuft überall – und jede Zeile wird auf die Goldwaage gelegt.' },
  { id: 'rock', name: 'Rock', emoji: '🎸', reach: 0.90, royalty: 0.95, live: 1.45, risk: 0.9,
    blurb: 'Weniger Abrufe, dafür volle Hallen.' },
  { id: 'elektro', name: 'Elektronisch', emoji: '🎛️', reach: 1.05, royalty: 0.85, live: 1.35, risk: 0.8,
    blurb: 'Clubs, Festivals, endlose Remixe.' },
  { id: 'indie', name: 'Indie', emoji: '🌙', reach: 0.75, royalty: 1.10, live: 1.00, risk: 0.7,
    blurb: 'Kleine, treue Hörerschaft, die wirklich zuhört.' },
  { id: 'metal', name: 'Metal', emoji: '🤘', reach: 0.65, royalty: 0.90, live: 1.60, risk: 0.8,
    blurb: 'Die loyalste Fanbasis der Welt – und die besten Konzerte.' },
  { id: 'klassik', name: 'Klassik / Score', emoji: '🎻', reach: 0.55, royalty: 1.35, live: 1.20, risk: 0.5,
    blurb: 'Wenig Abrufe, aber Lizenzen zahlen fürstlich.' },
  { id: 'jpop', name: 'J-Pop / K-Pop', emoji: '🌸', reach: 1.15, royalty: 1.30, live: 1.30, risk: 1.1,
    blurb: 'Perfektion als Beruf. Ohne Agentur schwer, mit Agentur unfrei.' },
];

/**
 * Veröffentlichungsarten. `songs` ist der Preis in aufgenommenen Titeln,
 * `spike` der Schub an Abrufen, `growth` der Zuwachs an Hörern.
 */
const RELEASES = [
  { id: 'single', name: 'Single', emoji: '💿', songs: 1, spike: 1.0, growth: 1.0, time: 2,
    blurb: 'Schnell draußen, schnell vergessen.' },
  { id: 'ep', name: 'EP', emoji: '📀', songs: 3, spike: 2.6, growth: 1.5, time: 2,
    blurb: 'Der vernünftige Mittelweg.' },
  { id: 'album', name: 'Album', emoji: '🎼', songs: 6, spike: 5.5, growth: 2.4, time: 3,
    blurb: 'Ein Statement. Kostet Monate, trägt Jahre.' },
  { id: 'deluxe', name: 'Deluxe / Remix', emoji: '🔁', songs: 2, spike: 1.6, growth: 0.7, time: 1,
    blurb: 'Zweitverwertung. Billig, ehrlich, funktioniert.' },
];

/** Wie ein Song im Studio entsteht – reine Farbe für die Meldung. */
const STUDIO = [
  'Vier Stunden an acht Takten.',
  'Der Beat stand nach zehn Minuten, der Text nach zehn Stunden.',
  'Du hast das Demo dreimal weggeworfen und beim vierten Mal behalten.',
  'Aufgenommen um halb vier nachts, weil die Idee nicht warten wollte.',
  'Der Toningenieur sagt, es sei fertig. Du glaubst ihm nicht.',
  'Ein Take. Ein einziger Take.',
  'Du hast den Refrain geändert, bis ihn niemand mehr erkannt hat.',
];

/** Konzert-Farbe. */
const SHOWS = [
  'Ausverkauft. Die vorderste Reihe kannte jede Zeile.',
  'Die Anlage ist zweimal ausgefallen. Gesungen wurde trotzdem.',
  'Halbleer, aber die, die da waren, waren richtig da.',
  'Zugabe nach der Zugabe.',
  'Du hast dich beim letzten Song verspielt. Niemand hat es gemerkt.',
  'Der Saal hat den zweiten Refrain allein gesungen.',
];

/** Schlagzeilen bei Chart-Erfolg. */
const CHART_NEWS = [
  'steigt neu in die Charts ein',
  'klettert auf Platz {platz}',
  'hält sich seit Wochen in den Top 10',
  'verdrängt die Konkurrenz von der Eins',
];

/**
 * Idol-Vertrag (nur Japan und Südkorea, nur mit Gesicht).
 *
 * Das ist ganz bewusst ein zweischneidiges Angebot: Die Agentur macht dich
 * groß, schneller als du es je allein schaffst – und nimmt dir dafür die
 * Hälfte des Geldes und einen Teil deiner Freiheit.
 */
const IDOL = {
  minListeners: 100_000,
  durationDays: 90,
  cut: 0.5,                 // Anteil der Musikeinnahmen für die Agentur
  growth: 2.2,              // dafür wächst die Hörerschaft mehr als doppelt so schnell
  liveBonus: 1.6,           // und die Hallen sind größer
  scandalFactor: 2.0,       // ein Fehltritt kostet das Doppelte
  exitPenaltyDays: 30,      // vorzeitig raus: so viele Tage Einnahmen als Strafe
  blurb: 'Trainingsplan, Choreografie, Zeitplan – und ein Vertrag, der '
    + 'bestimmt, was du sagst, mit wem du dich zeigst und wann du frei hast.',
  rules: [
    '💰 Vorschuss bei Unterschrift: 25 Tage Tantiemen, sofort auf die Hand.',
    '💴 Danach geht die Hälfte deiner Musikeinnahmen an die Agentur.',
    '📈 Dafür wächst deine Hörerschaft mehr als doppelt so schnell.',
    '🎤 Größere Hallen: Konzerte bringen 60 % mehr.',
    '🚫 Kein Wechsel zu anonym, kein Umzug ins Ausland.',
    '⚠️ Skandale kosten doppelt – die Agentur duldet nichts.',
    '📆 90 Tage Laufzeit. Vorzeitiger Ausstieg kostet 30 Tage Einnahmen.',
  ],
};

/** Zwei Wege, aufzutreten. */
const PERSONAS = [
  {
    id: 'face', name: 'Mit Gesicht', emoji: '🎭',
    plays: 1.0, growth: 1.0, live: 1.0, social: 1.0, scandal: 1.0,
    blurb: 'Du zeigst dich. Deine Kanäle wachsen kräftig mit, Konzerte zahlen '
      + 'voll – dafür trifft dich jeder Skandal ungebremst.',
  },
  {
    id: 'anon', name: 'Anonym', emoji: '🕶️',
    plays: 1.25, growth: 0.9, live: 0.75, social: 0.35, scandal: 0.45,
    blurb: 'Niemand kennt dein Gesicht. Das Rätsel zieht Abrufe an und schützt '
      + 'dich vor dem meisten Ärger – aber deine Socials bleiben klein, und '
      + 'Konzerte sind ein Aufwand.',
  },
];

module.exports = { GENRES, RELEASES, STUDIO, SHOWS, CHART_NEWS, IDOL, PERSONAS };
