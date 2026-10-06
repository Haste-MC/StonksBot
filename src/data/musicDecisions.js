/**
 * ===========================================================================
 *  SCHWERE VORFÄLLE DER MUSIKKARRIERE – die, bei denen man wählen muss
 * ===========================================================================
 *
 * Das Gegenstück zu data/decisions.js für Musiker. Läuft durch dasselbe
 * System (decisions.js), aber in einer eigenen Liste: Der Creator-Katalog
 * wird auf Creator-Wirkungsschlüssel geprüft, diese hier haben andere.
 *
 * AUFBAU
 * ------
 *   minListeners  ab wie vielen Hörern der Vorfall auftaucht
 *   maxListeners  bis zu wie vielen noch (fehlt = nach oben offen)
 *   requires      Zulassung: { persona: 'face' } | { songs: 3 } | { contract: true }
 *   options       2–3 Wahlmöglichkeiten, jede mit gewichteten Ausgängen
 *   expire        Ausgang, wenn niemand reagiert (× IGNORE_PENALTY auf Verluste)
 *
 * WIRKUNGEN (alle optional)
 * -------------------------
 *   listeners    Anteil der Hörer (-0.12 = −12 %), Verluste skalieren mit Größe
 *   songsShare   Anteil der unveröffentlichten Titel (-1 = alle weg)
 *   hype         Faktor auf die Form, geklemmt auf HYPE_MIN…HYPE_MAX
 *   lockRelease  Tage ohne Veröffentlichung
 *   lockShow     Tage ohne Konzert
 *   contract     'break' – der Idol-Vertrag platzt, mit der üblichen Strafe
 *   gear         true = das Studio-Setup geht kaputt
 *   cash         Vielfaches eines Tages Tantiemen (±)
 *   publish      true = alles Aufgenommene wird sofort veröffentlicht …
 *   audience     … mit diesem Faktor auf das Publikum
 */

// Die Obergrenze der frühen Vorfälle steht bei den Creator-Vorfällen – ein
// Wert für beide Kataloge, damit „früh" nicht in zwei Dateien getrennt
// davonläuft. data/decisions.js hängt an keinem Modul, der Weg ist also kreisfrei.
const { FRUEH_MAX } = require('./decisions');

const MUSIC_DECISIONS = [
  {
    id: 'plagiat',
    emoji: '⚖️',
    title: 'Plagiatsvorwurf',
    minListeners: 5_000,
    text: 'Ein anderer Künstler behauptet, dein letzter Track sei geklaut. '
      + 'Screenshots kursieren.',
    options: [
      {
        id: 'anwalt', label: 'Anwalt einschalten', emoji: '🧑‍⚖️',
        outcomes: [
          { weight: 8, cash: -3,
            text: 'Teuer, aber erledigt. Die Abmahnung geht in die andere Richtung.' },
          { weight: 2, cash: -3, hype: 1.1,
            text: 'Der Vorwurf fällt auf ihn zurück – und alle haben zugeschaut.' },
        ],
      },
      {
        id: 'antworten', label: 'Öffentlich antworten', emoji: '📣',
        outcomes: [
          { weight: 5, hype: 1.15,
            text: 'Du legst die Session-Dateien offen. Die Leute glauben dir.' },
          { weight: 3,
            text: 'Ein Statement, ein Tag Diskussion, dann ist es vorbei.' },
          { weight: 2, listeners: -0.08, hype: 0.85,
            text: 'Der Ton kam falsch an. Jetzt wirkt es, als hättest du was zu verbergen.' },
        ],
      },
      {
        id: 'ignorieren', label: 'Ignorieren', emoji: '🤫',
        outcomes: [
          { weight: 6,
            text: 'Kein Kommentar. Nach einer Woche redet niemand mehr darüber.' },
          { weight: 4, listeners: -0.12,
            text: 'Die Geschichte wächst ohne dich weiter. Und bleibt hängen.' },
        ],
      },
    ],
    expire: {
      listeners: -0.12,
      text: 'Du hast nicht reagiert. Für viele ist das die Antwort.',
    },
  },
  {
    id: 'skandal',
    emoji: '🎭',
    title: 'Ein altes Video taucht auf',
    minListeners: 20_000,
    requires: { persona: 'face' },
    text: 'Von vor Jahren. Aus dem Zusammenhang gerissen, aber es ist dein Gesicht.',
    options: [
      {
        id: 'entschuldigen', label: 'Entschuldigen', emoji: '🙏',
        outcomes: [
          { weight: 7, listeners: -0.05, hype: 0.9,
            text: 'Ehrlich und kurz. Es beruhigt sich – ein paar gehen trotzdem.' },
          { weight: 3, listeners: -0.03,
            text: 'Man rechnet es dir an, dass du nicht ausweichst.' },
        ],
      },
      {
        id: 'aussitzen', label: 'Aussitzen', emoji: '⏳',
        outcomes: [
          { weight: 5,
            text: 'Drei Tage Sturm, dann ein neues Thema. Glück gehabt.' },
          { weight: 5, listeners: -0.15, hype: 0.75,
            text: 'Es wird schlimmer. Jeden Tag ein neuer Ausschnitt.' },
        ],
      },
      {
        id: 'gegenangriff', label: 'Gegenangriff', emoji: '⚔️',
        outcomes: [
          { weight: 3, hype: 1.2,
            text: 'Du gehst frontal drauf – und die Szene feiert dich dafür.' },
          { weight: 7, listeners: -0.2, hype: 0.6,
            text: 'Du hast den Falschen angegriffen. Hype am Boden.' },
        ],
      },
    ],
    expire: {
      listeners: -0.15, hype: 0.75,
      text: 'Kein Wort von dir. Das Video spricht für sich – sagen die Leute.',
    },
  },
  {
    id: 'stimme',
    emoji: '🤒',
    title: 'Stimme weg vor der Tour',
    minListeners: 5_000,
    text: 'Zwei Tage vor dem Konzert. Kein Ton.',
    options: [
      {
        id: 'absagen', label: 'Absagen', emoji: '🚫',
        outcomes: [
          { weight: 10, lockShow: 7, hype: 0.9,
            text: 'Die Fans verstehen es. Die Halle bleibt eine Woche dunkel.' },
        ],
      },
      {
        id: 'durchziehen', label: 'Durchziehen', emoji: '💪',
        outcomes: [
          { weight: 5,
            text: 'Tee, Honig, Wille. Es ging gerade so.' },
          { weight: 5, listeners: -0.08, hype: 0.85,
            text: 'Es war hörbar. Die Videos davon auch.' },
        ],
      },
      {
        id: 'playback', label: 'Playback', emoji: '🎙️',
        outcomes: [
          { weight: 7,
            text: 'Niemand merkt es. Niemand.' },
          { weight: 3, listeners: -0.15, hype: 0.7,
            text: 'Jemand filmt aus der ersten Reihe. Es fliegt auf.' },
        ],
      },
    ],
    expire: {
      lockShow: 7, hype: 0.85,
      text: 'Keine Entscheidung ist auch eine: Die Show fällt aus, ohne Ansage.',
    },
  },
  {
    id: 'album_leak',
    emoji: '💿',
    title: 'Album im Netz',
    minListeners: 10_000,
    requires: { songs: 3 },
    text: 'Dein unveröffentlichtes Material ist draußen. Alles.',
    options: [
      {
        id: 'sofort', label: 'Sofort veröffentlichen', emoji: '⚡',
        outcomes: [
          { weight: 10, publish: true, audience: 0.7,
            text: 'Der Schwung ist halb weg – aber es ist deins, offiziell.' },
        ],
      },
      {
        id: 'neu', label: 'Neu aufnehmen', emoji: '🔁',
        outcomes: [
          { weight: 10, songsShare: -1, hype: 1.1,
            text: 'Alles weg. Aber die Story zieht – alle wollen die echte Version.' },
        ],
      },
      {
        id: 'ignorieren', label: 'Ignorieren', emoji: '🤷',
        outcomes: [
          { weight: 4, songsShare: -0.5,
            text: 'Die Hälfte ist verbrannt. Der Rest lässt sich retten.' },
          { weight: 6, songsShare: -1, listeners: -0.05,
            text: 'Alles weg – und es wirkt, als wäre es dir egal.' },
        ],
      },
    ],
    expire: {
      songsShare: -1, listeners: -0.05,
      text: 'Das Material lief eine Woche ohne dich. Jetzt gehört es allen.',
    },
  },
  {
    id: 'label',
    emoji: '🏢',
    title: 'Das Label will verschieben',
    minListeners: 5_000,
    requires: { contract: true },
    text: 'Dein Release soll drei Wochen warten. „Marktstrategie."',
    options: [
      {
        id: 'nachgeben', label: 'Nachgeben', emoji: '🤝',
        outcomes: [
          { weight: 10, lockRelease: 7,
            text: 'Du wartest. Es ist ihr Kalender.' },
        ],
      },
      {
        id: 'durchziehen', label: 'Durchziehen', emoji: '🔥',
        outcomes: [
          { weight: 6, hype: 1.1,
            text: 'Sie lassen es durchgehen. Diesmal.' },
          { weight: 4, contract: 'break',
            text: 'Vertrag geplatzt. Die Strafe steht im Kleingedruckten.' },
        ],
      },
    ],
    expire: {
      lockRelease: 7,
      text: 'Keine Antwort heißt: Das Label entscheidet. Und das Label wartet.',
    },
  },

  // --------------------------------------------------------------------
  //  Die frühen Vorfälle: 0 … FRUEH_MAX Hörer
  //
  //  Ohne Zulassungshürde (`requires`), denn sie sollen den treffen, der
  //  gerade anfängt – ohne Songs, ohne Vertrag, ohne Gesicht. Kein Ausgang
  //  zahlt etwas aus: ein früher Vorfall ist eine Entscheidung, keine
  //  Einnahmequelle (§3). `cash` zählt in Tagen Tantiemen, bei null Hörern
  //  also in Kleingeld – gemeint ist der Abend, nicht die Summe.
  // --------------------------------------------------------------------
  {
    id: 'proberaum',
    emoji: '🚪',
    title: 'Der Proberaum ist gekündigt',
    minListeners: 0,
    maxListeners: FRUEH_MAX,
    text: 'Zum Monatsende. Der Vermieter baut Wohnungen daraus. Zwei Straßen '
      + 'weiter gibt es einen – für das Doppelte.',
    options: [
      {
        id: 'teurer', label: 'Den teureren nehmen', emoji: '🔑',
        outcomes: [
          { weight: 7, cash: -2,
            text: 'Doppelte Miete, derselbe Hall. Dafür stehst du nächste Woche wieder am Pult.' },
          { weight: 3, cash: -3, hype: 1.05,
            text: 'Der neue Raum ist der bessere. Es tut weh, aber man hört es.' },
        ],
      },
      {
        id: 'schlafzimmer', label: 'Im Schlafzimmer aufnehmen', emoji: '🛏️',
        outcomes: [
          { weight: 6, hype: 0.9,
            text: 'Matratze an die Wand, Decke über den Schrank. Es geht – es klingt nur nicht so.' },
          { weight: 4, listeners: -0.04, hype: 0.85,
            text: 'Ab acht klopfen die Nachbarn. Was danach fertig wird, hört man das an.' },
        ],
      },
      {
        id: 'pause', label: 'Erst mal pausieren', emoji: '⏸️',
        outcomes: [
          { weight: 6, lockRelease: 3,
            text: 'Drei Tage ohne Raum und ohne Veröffentlichung. Kostet nichts außer Zeit.' },
          { weight: 4, lockRelease: 3, hype: 0.9,
            text: 'Die Pause zieht sich. Wer nichts rausbringt, wird schnell nicht mehr erwartet.' },
        ],
      },
    ],
    expire: {
      lockRelease: 5, hype: 0.9,
      text: 'Die Kündigung läuft einfach ab. Deine Sachen stehen jetzt im Flur deiner Wohnung.',
    },
  },
  {
    id: 'kleiner_auftritt',
    emoji: '🚐',
    title: 'Fünfzig Euro und drei Stunden Fahrt',
    minListeners: 0,
    maxListeners: FRUEH_MAX,
    text: 'Ein Jugendzentrum fragt an: Samstag, zwanzig Minuten, fünfzig Euro. '
      + 'Drei Stunden hin, drei zurück, zwanzig Leute im Raum.',
    options: [
      {
        id: 'hinfahren', label: 'Hinfahren', emoji: '🚗',
        outcomes: [
          { weight: 6, cash: -1, listeners: 0.03,
            text: 'Zwanzig Leute, und sie bleiben bis zum letzten Ton. Der Tank kostet mehr als die Gage.' },
          { weight: 4, cash: -2, hype: 1.1,
            text: 'Halb leerer Raum – aber hinten steht jemand, der zwei Straßen weiter Konzerte bucht. Der Name bleibt hängen.' },
        ],
      },
      {
        id: 'nachfragen', label: 'Mehr Gage verlangen', emoji: '💬',
        outcomes: [
          { weight: 5,
            text: 'Sie haben kein Budget mehr. Ehrlich gesagt war es die Fahrt auch nicht wert.' },
          { weight: 5, hype: 0.95,
            text: 'Sie nehmen jemand anderen. Die Bühne war klein, der Flurfunk nicht.' },
        ],
      },
      {
        id: 'absagen', label: 'Absagen und schreiben', emoji: '🛋️',
        outcomes: [
          { weight: 7, lockShow: 1,
            text: 'Du bleibst da und arbeitest. Kein Verlust, kein Publikum.' },
          { weight: 3, hype: 0.9,
            text: 'Der Abend bleibt frei und leer. Irgendwann fragt niemand mehr an.' },
        ],
      },
    ],
    expire: {
      lockShow: 2, hype: 0.9,
      text: 'Du hast nicht geantwortet. Samstag spielt jemand anderes, und gefragt '
        + 'wird beim nächsten Mal auch jemand anderes.',
    },
  },
];

module.exports = { MUSIC_DECISIONS };
