/**
 * ===========================================================================
 *  HEISTS – der kriminelle Pfad
 * ===========================================================================
 *
 * Anders als jede andere Tätigkeit ist ein Ding **kein Kreislauf, sondern ein
 * Projekt**: Man sucht sich ein Ziel, besorgt über Tage die Vorbereitung,
 * holt sich Leute dazu – und dann entscheidet ein einziger Wurf.
 *
 * Drei Dinge bestimmen ihn:
 *
 *   1. **Vorbereitung.** Jeder erledigte Schritt senkt das Risiko oder hebt
 *      die Beute. Ohne Vorbereitung ist ein Ding ein Selbstmordkommando – der
 *      Erwartungswert ist dann bei allem außer dem Kiosk negativ.
 *   2. **Ausrüstung.** Jede Location verlangt eine Mindeststufe. Mit besserem
 *      Werkzeug sinkt das Risiko zusätzlich.
 *   3. **Crew.** Große Ziele gehen nicht allein. Mehr Leute heißt mehr
 *      Sicherheit – und weniger Anteil.
 *
 * Dazu die **Fahndung**: Jedes Ding erhöht sie, sie klingt nur mit der Zeit
 * ab, und wer heiß ist, scheitert öfter und zahlt höhere Strafen.
 */

/**
 * Vorbereitungsschritte. `risk` senkt die Fehlschlagwahrscheinlichkeit,
 * `loot` hebt die Beute, `heat` verändert die Fahndung.
 *
 * `needs` ist eine Bedingung an den Spieler, der den Schritt erledigt:
 *   item  Gegenstand im Besitz
 *   car   Auto mindestens dieses Wertes
 *   crew  Mindestgröße der Crew
 */
const PREPS = [
  {
    id: 'auskundschaften', name: 'Auskundschaften', emoji: '🔭',
    cost: 500, risk: 0.05, loot: 0.05, heat: 0, cooldownMin: 45,
    text: 'Zwei Abende im Auto gegenüber. Wachwechsel um 22:40, immer derselbe Mann.',
  },
  {
    id: 'fluchtwagen', name: 'Fluchtwagen besorgen', emoji: '🚗',
    cost: 1_500, risk: 0.06, loot: 0, heat: -0.05, cooldownMin: 60,
    needs: { car: 20_000 },
    text: 'Nicht der schnellste, aber der unauffälligste. Kennzeichen kommt noch.',
  },
  {
    id: 'werkzeug', name: 'Werkzeug beschaffen', emoji: '🧰',
    cost: 2_000, risk: 0.03, loot: 0.10, heat: 0, cooldownMin: 45,
    needs: { item: 'Werkzeugkasten' },
    text: 'Alles, was man braucht, um leise laut zu werden.',
  },
  {
    id: 'insider', name: 'Insider anwerben', emoji: '🤝',
    cost: 8_000, risk: 0.07, loot: 0.20, heat: 0.05, cooldownMin: 90,
    text: 'Er will dreißig Prozent. Er bekommt fünf und einen guten Grund zu schweigen.',
  },
  {
    id: 'masken', name: 'Masken und Kleidung', emoji: '🧤',
    cost: 800, risk: 0.02, loot: 0, heat: -0.15, cooldownMin: 30,
    needs: { item: 'Sturmmaske' },
    text: 'Vier gleiche Overalls. Danach brennen sie.',
  },
  {
    id: 'funk', name: 'Funk einrichten', emoji: '📻',
    cost: 1_200, risk: 0.045, loot: 0, heat: 0, cooldownMin: 45,
    needs: { item: 'Funkgeräte', crew: 2 },
    text: 'Eigener Kanal, eigene Codewörter. "Regenschirm" heißt abbrechen.',
  },
  {
    id: 'hacker', name: 'Kameras abschalten', emoji: '💻',
    cost: 6_000, risk: 0.08, loot: 0, heat: -0.10, cooldownMin: 90,
    needs: { item: 'Laptop' },
    text: 'Die Aufzeichnung läuft weiter. Sie zeigt nur den Flur von gestern.',
  },
  {
    id: 'stoersender', name: 'Störsender aufstellen', emoji: '🚨',
    cost: 9_000, risk: 0.09, loot: 0, heat: -0.05, cooldownMin: 120,
    needs: { item: 'Störsender' },
    text: 'Für elf Minuten gibt es diesen Häuserblock nicht.',
  },
  {
    id: 'sprengung', name: 'Sprengung vorbereiten', emoji: '💣',
    cost: 20_000, risk: -0.03, loot: 0.35, heat: 0.20, cooldownMin: 120,
    needs: { item: 'Sprengsatz' },
    text: 'Zwei Ladungen an den Scharnieren. Laut, schnell, unwiderruflich.',
  },
  {
    id: 'schmiere', name: 'Schmiere stehen', emoji: '👀',
    cost: 0, risk: 0.055, loot: 0, heat: 0, cooldownMin: 30,
    needs: { crew: 3 },
    text: 'Einer bleibt draußen. Der langweiligste Job und der wichtigste.',
  },
  {
    id: 'hehler', name: 'Hehler organisieren', emoji: '💼',
    cost: 3_000, risk: 0, loot: 0.18, heat: 0, cooldownMin: 60,
    text: 'Er zahlt schlecht, aber sofort und ohne Fragen.',
  },
];

/**
 * Ausrüstungsstufen. Jede Location verlangt eine Mindeststufe; bessere
 * Ausrüstung senkt zusätzlich das Risiko.
 */
const TIERS = [
  { tier: 0, name: 'Blank', emoji: '✊', items: [], risk: 0,
    blurb: 'Bloße Hände und ein Plan, der keiner ist.' },
  { tier: 1, name: 'Gelegenheitstäter', emoji: '🧤', items: ['Sturmmaske'], risk: 0.03,
    blurb: 'Maske auf, rein, raus.' },
  { tier: 2, name: 'Ausgerüstet', emoji: '🧰', items: ['Sturmmaske', 'Brecheisen'], risk: 0.07,
    blurb: 'Damit bekommt man die meisten Türen auf.' },
  { tier: 3, name: 'Professionell', emoji: '🔓',
    items: ['Sturmmaske', 'Brecheisen', 'Dietrich-Set', 'Funkgeräte'], risk: 0.12,
    blurb: 'Leise, koordiniert, ohne Spuren.' },
  { tier: 4, name: 'Spezialeinheit', emoji: '💣',
    items: ['Sturmmaske', 'Brecheisen', 'Dietrich-Set', 'Funkgeräte', 'Störsender', 'Sprengsatz'],
    risk: 0.18,
    blurb: 'Alles dabei, was man für ein sehr schlechtes Ende braucht.' },
];

/**
 * Die Ziele. `base` ist die Grundchance auf Erfolg vor Vorbereitung,
 * `loot` die Spanne der Beute, `heat` was es an Fahndung kostet.
 */
const LOCATIONS = [
  {
    id: 'kiosk', name: 'Spätkauf an der Ecke', emoji: '🏪', tier: 0,
    minCrew: 1, maxCrew: 2, gearTier: 0, preps: ['auskundschaften', 'masken'],
    base: 0.55, loot: [3_000, 8_000], fine: 7_000, jailHours: 5, heat: 8,
    blurb: 'Die Kasse, ein paar Stangen Zigaretten und ein sehr wütender Besitzer.',
  },
  {
    id: 'tankstelle', name: 'Tankstelle', emoji: '⛽', tier: 1,
    minCrew: 1, maxCrew: 3, gearTier: 1,
    preps: ['auskundschaften', 'masken', 'fluchtwagen'],
    base: 0.50, loot: [9_000, 24_000], fine: 20_000, jailHours: 9, heat: 12,
    blurb: 'Nachts um drei. Der Tresor ist ein Witz, die Kameras nicht.',
  },
  {
    id: 'juwelier', name: 'Juwelier', emoji: '💎', tier: 2,
    minCrew: 2, maxCrew: 4, gearTier: 2,
    preps: ['auskundschaften', 'masken', 'fluchtwagen', 'werkzeug', 'hehler'],
    base: 0.42, loot: [40_000, 110_000], fine: 70_000, jailHours: 18, heat: 22,
    blurb: 'Vitrinen aus Panzerglas, eine Alarmanlage von 1998 und sehr viel Karat.',
  },
  {
    id: 'kunstlager', name: 'Kunstdepot', emoji: '🖼️', tier: 3,
    minCrew: 2, maxCrew: 5, gearTier: 2,
    preps: ['auskundschaften', 'insider', 'werkzeug', 'hacker', 'hehler'],
    base: 0.38, loot: [90_000, 240_000], fine: 180_000, jailHours: 24, heat: 28,
    blurb: 'Zollfreilager. Was hier steht, existiert offiziell nirgendwo – auch nicht, wenn es weg ist.',
  },
  {
    id: 'bank', name: 'Filialbank', emoji: '🏦', tier: 4,
    minCrew: 3, maxCrew: 5, gearTier: 3,
    preps: ['auskundschaften', 'masken', 'fluchtwagen', 'funk', 'hacker', 'schmiere', 'hehler'],
    base: 0.32, loot: [200_000, 520_000], fine: 250_000, jailHours: 36, heat: 38,
    blurb: 'Zwei Minuten bis der Alarm durchgeht, vier bis der erste Wagen da ist.',
  },
  {
    id: 'casino', name: 'Kasino-Tresor', emoji: '🎰', tier: 5,
    minCrew: 4, maxCrew: 6, gearTier: 3,
    preps: ['auskundschaften', 'insider', 'funk', 'hacker', 'stoersender', 'schmiere', 'hehler'],
    base: 0.26, loot: [450_000, 1_100_000], fine: 500_000, jailHours: 48, heat: 50,
    blurb: 'Der Tresor liegt drei Etagen unter dem Roulette. Der Weg zurück ist das Problem.',
  },
  {
    id: 'goldtransport', name: 'Goldtransport', emoji: '🚚', tier: 6,
    minCrew: 4, maxCrew: 6, gearTier: 4,
    preps: ['auskundschaften', 'insider', 'fluchtwagen', 'funk', 'stoersender', 'sprengung',
      'schmiere', 'hehler'],
    base: 0.20, loot: [900_000, 2_400_000], fine: 900_000, jailHours: 72, heat: 65,
    blurb: 'Gepanzert, bewaffnet, pünktlich. Genau deshalb kann man ihn planen.',
  },
];

/** Wie ein gelungenes Ding klingt. */
const CLEAN = [
  'Rein, raus, keiner hat etwas gehört. So soll es sein.',
  'Vier Minuten schneller als geplant. Der Wagen stand, wo er stehen sollte.',
  'Kein Alarm, keine Zeugen, keine Spuren. Der Plan hat gehalten.',
  'Es lief so glatt, dass es fast unheimlich war.',
];

/** Erfolg mit Komplikationen. */
const MESSY = [
  'Der Alarm ging zwei Minuten zu früh. Ihr wart trotzdem draußen.',
  'Einer musste die Tür treten. Laut, aber es hat gereicht.',
  'Die Hälfte liegt noch drin – dafür seid ihr alle raus.',
  'Ein Streifenwagen kam um die Ecke. Ihr habt einen Umweg genommen.',
];

/** Gescheitert. */
const FAILED = [
  'Der Wachmann war nicht der aus der Beobachtung. Er war wach.',
  'Die Tür hielt. Und hielt. Und dann kam das Blaulicht.',
  'Jemand hat geredet. Sie warteten schon.',
  'Der Fluchtwagen sprang nicht an. Sowas passiert nur im Film – und heute.',
];

/** Komplett danebengegangen. */
const DISASTER = [
  'Es war von der ersten Sekunde an falsch. Ihr wart die Einzigen, die es nicht wussten.',
  'Aus zwei Minuten wurden zwanzig. Aus dem Ding wurde eine Geiselnahme ohne Geiseln.',
  'Sie hatten den Tipp vor euch. Der Insider war keiner.',
];

/**
 * ===========================================================================
 *  SZENEN – die Entscheidungen während des Dings
 * ===========================================================================
 *
 * Ein Ding läuft nicht mehr in einem Wurf ab: Zwischen Start und Ausgang
 * stehen mehrere Szenen, und jede verlangt eine Entscheidung. In der Crew
 * kommt reihum jeder mindestens einmal dran, allein trifft man alle selbst.
 *
 * Jede Option ist ein **Tauschgeschäft**: Sicherheit gegen Beute oder
 * umgekehrt. Es gibt bewusst keine Option, die einfach nur gut ist – sonst
 * wäre die Entscheidung keine, sondern eine Fleißaufgabe, und der
 * Erwartungswert eines unvorbereiteten Dings würde ins Plus kippen
 * (ARCHITEKTUR §3; nachgerechnet in test/heist.test.js).
 *
 *   odds   Aufschlag auf die Erfolgschance (Prozentpunkte als Anteil)
 *   loot   Aufschlag auf die Beute (Anteil)
 *   heat   Aufschlag auf die Fahndung (Punkte, optional)
 */
const SCENES = [
  {
    id: 'alarm',
    emoji: '🚨',
    title: 'Die Alarmanlage',
    text: 'Hinter der Tür blinkt ein Kästchen, das laut Plan gar nicht da sein sollte.',
    options: [
      {
        id: 'kappen', label: 'Kabel kappen', emoji: '✂️', odds: 0.05, loot: -0.12,
        text: 'Zwei Minuten Fummelei – dafür bleibt es still.',
      },
      {
        id: 'ignorieren', label: 'Ignorieren, Tempo machen', emoji: '🏃', odds: -0.05, loot: 0.22,
        text: 'Es piept. Ihr rennt trotzdem weiter – und nehmt mehr mit.',
      },
      {
        id: 'umleiten', label: 'Auf den Nachbarn umlenken', emoji: '🔀', odds: 0.02, loot: 0,
        heat: 3, text: 'Die Streife fährt erst mal nebenan vorbei. Erst mal.',
      },
    ],
  },
  {
    id: 'wachmann',
    emoji: '💤',
    title: 'Der Wachmann',
    text: 'Er sitzt im Kabuff und döst. Sein Funkgerät liegt auf dem Tisch.',
    options: [
      {
        id: 'schleichen', label: 'Vorbeischleichen', emoji: '🤫', odds: 0.04, loot: -0.08,
        text: 'Ihr nehmt den langen Weg. Er schnarcht weiter.',
      },
      {
        id: 'fesseln', label: 'Überwältigen', emoji: '🪢', odds: -0.03, loot: 0.15,
        heat: 5, text: 'Schnell, leise, unschön. Der Weg ist jetzt frei.',
      },
      {
        id: 'funk', label: 'Nur das Funkgerät klauen', emoji: '📻', odds: 0.02, loot: -0.03,
        text: 'Wenn er aufwacht, kann er wenigstens niemanden rufen.',
      },
    ],
  },
  {
    id: 'tresor',
    emoji: '🔐',
    title: 'Der Tresor',
    text: 'Er ist älter als erwartet – und dicker.',
    options: [
      {
        id: 'bohren', label: 'Aufbohren', emoji: '🛠️', odds: 0.03, loot: -0.05,
        text: 'Langsam, sauber, laut genug für die halbe Straße. Aber er geht auf.',
      },
      {
        id: 'sprengen', label: 'Sprengen', emoji: '💥', odds: -0.07, loot: 0.3,
        heat: 6, text: 'Der Knall war zu hören. Was drin lag, aber auch.',
      },
      {
        id: 'liegenlassen', label: 'Liegen lassen', emoji: '🚪', odds: 0.07, loot: -0.25,
        text: 'Ihr nehmt, was rumliegt, und seid weg, bevor jemand kommt.',
      },
    ],
  },
  {
    id: 'zeuge',
    emoji: '👀',
    title: 'Der Zeuge',
    text: 'Jemand steht am Fenster gegenüber. Handy in der Hand.',
    options: [
      {
        id: 'weg', label: 'Sofort abbrechen und raus', emoji: '🏃', odds: 0.08, loot: -0.3,
        text: 'Ihr seid weg, bevor das Foto scharf ist.',
      },
      {
        id: 'maske', label: 'Maske runterziehen, weitermachen', emoji: '🎭', odds: -0.02, loot: 0.1,
        heat: 4, text: 'Er hat Stoff gesehen, kein Gesicht. Ihr macht weiter.',
      },
      {
        id: 'ablenken', label: 'Jemand lenkt ihn ab', emoji: '🙋', odds: 0.03, loot: -0.1,
        text: 'Einer von euch spielt den Betrunkenen. Es funktioniert erstaunlich gut.',
      },
    ],
  },
  {
    id: 'streife',
    emoji: '🚓',
    title: 'Die Streife',
    text: 'Blaulicht am Ende der Straße. Noch ohne Sirene.',
    options: [
      {
        id: 'warten', label: 'Abwarten', emoji: '⏳', odds: 0.06, loot: -0.15,
        text: 'Zehn Minuten Stillstand. Zehn Minuten, die euch fehlen.',
      },
      {
        id: 'durchziehen', label: 'Durchziehen', emoji: '⚡', odds: -0.06, loot: 0.25,
        text: 'Wer jetzt aufhört, war umsonst hier.',
      },
      {
        id: 'umweg', label: 'Fluchtweg ändern', emoji: '🗺️', odds: 0.03, loot: -0.05,
        text: 'Der Umweg ist länger, aber leer.',
      },
    ],
  },
  {
    id: 'beute',
    emoji: '💼',
    title: 'Mehr, als reinpasst',
    text: 'Da liegt deutlich mehr, als ihr tragen könnt.',
    options: [
      {
        id: 'mitnehmen', label: 'Alles mitnehmen', emoji: '🎒', odds: -0.06, loot: 0.28,
        text: 'Vollgepackt. Schwer. Langsam.',
      },
      {
        id: 'auswaehlen', label: 'Nur das Beste', emoji: '💎', odds: 0, loot: 0.06,
        text: 'Ihr nehmt, was klein ist und teuer.',
      },
      {
        id: 'leicht', label: 'Leicht bleiben', emoji: '🪶', odds: 0.06, loot: -0.18,
        text: 'Beweglich zu sein hat auch einen Wert.',
      },
    ],
  },
  {
    id: 'insider',
    emoji: '📱',
    title: 'Der Anruf',
    text: 'Euer Kontakt meldet sich mitten im Ding. Er klingt nervös.',
    options: [
      {
        id: 'zuhoeren', label: 'Zuhören', emoji: '👂', odds: 0.05, loot: -0.1,
        text: 'Er hatte recht: hinten war eine Kamera mehr.',
      },
      {
        id: 'auflegen', label: 'Auflegen', emoji: '📴', odds: -0.03, loot: 0.12,
        text: 'Keine Zeit. Vielleicht war es wichtig.',
      },
      {
        id: 'abschalten', label: 'Handys ganz aus', emoji: '🔕', odds: 0.03, loot: -0.02,
        heat: -4, text: 'Kein Funkmast merkt sich, wer hier war.',
      },
    ],
  },
  {
    id: 'tuer',
    emoji: '🚪',
    title: 'Die zweite Tür',
    text: 'Hinter der ersten Tür steht eine zweite. Von der stand nichts im Plan.',
    options: [
      {
        id: 'knacken', label: 'Knacken', emoji: '🔓', odds: 0.02, loot: 0,
        text: 'Dauert. Geht aber.',
      },
      {
        id: 'ramme', label: 'Mit Anlauf', emoji: '🐏', odds: -0.05, loot: 0.2,
        heat: 4, text: 'Sie gibt beim dritten Mal nach. Der halbe Block hat es gehört.',
      },
      {
        id: 'lueftung', label: 'Durch die Lüftung', emoji: '🕳️', odds: 0.04, loot: -0.14,
        text: 'Eng, staubig, unbeobachtet. Nur passt kaum was durch.',
      },
    ],
  },
  {
    id: 'flucht',
    emoji: '🚗',
    title: 'Der Absprung',
    text: 'Draußen ist es heller, als es sein sollte.',
    options: [
      {
        id: 'gas', label: 'Vollgas', emoji: '🏎️', odds: -0.04, loot: 0.18,
        heat: 5, text: 'Zwei rote Ampeln, ein Kreisverkehr, niemand hinterher.',
      },
      {
        id: 'spazieren', label: 'Ruhig weggehen', emoji: '🚶', odds: 0.06, loot: -0.16,
        text: 'Nichts sieht unauffälliger aus als Langeweile.',
      },
      {
        id: 'aufteilen', label: 'Aufteilen', emoji: '↔️', odds: 0.03, loot: -0.06,
        text: 'Drei Richtungen, ein Treffpunkt. Klassiker, weil es klappt.',
      },
    ],
  },
];

const sceneById = new Map(SCENES.map((s) => [s.id, s]));
const scene = (id) => sceneById.get(String(id ?? '')) ?? null;

module.exports = {
  PREPS, TIERS, LOCATIONS, CLEAN, MESSY, FAILED, DISASTER, SCENES, scene,
};
