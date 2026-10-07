/**
 * ===========================================================================
 *  DER DRAHT ZU ANDEREN KÜNSTLERN
 * ===========================================================================
 *
 * Wer Musik macht oder streamt, sitzt nicht allein im Zimmer: Man schreibt
 * andere an. Ein Emoji zurück ist schon etwas, ein echter Satz ist mehr, eine
 * Zusage ist selten – und genau darum geht es hier. Dieses Modul ist der
 * Katalog dazu: die Künstler, die man anschreiben kann, die vier Anfragearten,
 * die Charakterzüge samt ihrer Antworttexte und alle Zahlen, mit denen
 * src/contacts.js rechnet. Reine Daten, kein Zustand, keine Datenbank.
 *
 * ---------------------------------------------------------------------------
 *  Echte Namen, erfundene Zahlen
 * ---------------------------------------------------------------------------
 * Die meisten Einträge tragen den echten Namen einer realen Künstlerin, eines
 * realen Künstlers oder Creators, damit die Welt vertraut wirkt – dazwischen
 * stehen bewusst erfundene Namen als lokale Ebene (z. B. „Steffi
 * Stream-Schnecke", „Der Timeline-Troll"). `reach`/`reachCreator` sind für
 * ALLE Einträge Spielfiktion in einer plausiblen Größenordnung, keine
 * recherchierten Werte; die Zeilen in LINES sind erfunden und keine Zitate.
 *
 * ---------------------------------------------------------------------------
 *  Abdeckung – eine Verpflichtung, kein Wunsch
 * ---------------------------------------------------------------------------
 * test/contacts.test.js prüft das Folgende. Wer Einträge entfernt, muss die
 * Regeln weiter erfüllen – der Test wird nicht gelockert, der Katalog wird
 * ergänzt:
 *
 *   Land       jedes Land aus world.js hat mindestens einen Kontakt
 *   Sprache    jede Sprache hat ≥ 3 Musiker, davon einer unter 100k Hörern
 *              (die lokale Ebene) und einer über 1 Mio (etwas zu erreichen)
 *   Genre      jedes Genre hat ≥ 4 Kontakte aus ≥ 3 Sprachen und ≥ 1 Weltstar
 *              (ab 100 Mio Hörern)
 *   Plattform  jede Plattform hat ≥ 3 Creator, davon ≥ 1 über 10 Mio
 *   Mittelfeld jedes Genre hat mindestens je einen Kontakt in 40k–200k,
 *              200k–1 Mio und 1–5 Mio, und zwischen zwei aufeinander
 *              folgenden Mittelfeld-Kontakten liegt höchstens der Faktor 10
 *
 * Das Mittelfeld ist keine Kosmetik: Sowohl die Antwortchance in 5a als auch
 * der ganze Beef in 5b hängen am Größenverhältnis der beiden Künstler. Wer
 * 100.000 Hörer hat, braucht im eigenen Genre jemanden in seiner Liga –
 * sonst gibt es nur Zwerge und Weltstars und dazwischen nichts.
 *
 * ---------------------------------------------------------------------------
 *  Felder eines Eintrags
 * ---------------------------------------------------------------------------
 *   id            eindeutiger Schlüssel (wandert in die Datenbank)
 *   name, emoji   Anzeige in Listen und Nachrichten
 *   kind          'musik' | 'creator' | 'beides'
 *   country       Land aus world.js (Heimvorteil, wenn man dort sitzt)
 *   language      Sprache aus world.js (steuert die Passung am stärksten)
 *   genre         Genre aus music.js      – nur bei musik/beides
 *   reach         monatliche Hörer         – nur bei musik/beides
 *                 (Spielfiktion in plausibler Größenordnung, nicht recherchiert)
 *   platform      Plattform aus creator.js – nur bei creator/beides
 *   reachCreator  Follower                 – nur bei creator/beides
 *                 (dieselbe Spielfiktion wie `reach`)
 *   trait         Charakterzug: steuert Antwortchance (TRAIT_BONUS) und Ton
 *   blurb         ein Satz, der den Kontakt greifbar macht
 */

// --- Konstanten ------------------------------------------------------------

/** Eine Anfrage kostet zwei Stunden – schreiben, warten, nachfassen. */
const KONTAKT_TIME = 2;

/** Nach einer Anfrage ist derselbe Kontakt drei Tage lang dicht. */
const SPERRE_TAGE = 3;
/** Wer ignoriert wurde, darf erst nach einer Woche wieder nerven. */
const SPERRE_IGNORIERT_TAGE = 7;

/**
 * Ohne Kontakt kühlt die Beziehung ab: zwei Punkte je Woche Richtung 0.
 * Bleibt als REFERENZ des Paritätstests stehen (test/beziehungen.test.js) und
 * wird von contacts.decay noch gelesen – die übrigen DRAHT_* sind mit dem
 * Umbau auf die Achsen weggefallen, diese Zahl bleibt.
 */
const DRAHT_DECAY_PRO_WOCHE = 2;

/** Schwellen der Beziehungsstufen. */
const STUFE_BEKANNT = 20;
const STUFE_PARTNER = 50;
const STUFE_VERSTIMMT = -20;
const STUFE_BEEF = -50;

/** Die Antwortchance bleibt immer zwischen diesen Grenzen. */
const CHANCE_MIN = 0.02;
const CHANCE_MAX = 0.95;

// --- Respekt und Vertrauen (Stück 6a) --------------------------------------

/**
 * Was eine Antwort an den zwei Achsen bewegt.
 *
 * Der Mittelwert ist bei allen fünf Zeilen identisch zum alten Draht-Delta
 * (+12 / +6 / +2 / −1 / −5) – die Spaltung ist die einzige Änderung, und der
 * Paritätstest in test/beziehungen.test.js hängt daran. Ein 🔥 zurück und ein
 * echter Satz bringen fast nur Respekt; eine Zusage bringt beides.
 */
const ACHSEN = {
  zusage:    { respekt: 12, vertrauen: 12 },   // Mittel +12
  echt:      { respekt:  9, vertrauen:  3 },   // Mittel  +6
  fluechtig: { respekt:  3, vertrauen:  1 },   // Mittel  +2
  ignoriert: { respekt: -2, vertrauen:  0 },   // Mittel  −1
  verstimmt: { respekt: -8, vertrauen: -2 },   // Mittel  −5
};

/**
 * Ohne Kontakt kühlt die Beziehung ab. Respekt bleibt länger als Vertrauen:
 * Wer dich einmal ernst genommen hat, tut das auch in einem halben Jahr noch –
 * verlassen tut er sich nur auf jemanden, von dem er zuletzt etwas gehört hat.
 * (1 + 3) / 2 = 2, also kühlt der Draht mit genau den alten zwei Punkten ab –
 * aber nur unter ZWEI Voraussetzungen:
 *
 *   • Keine Achse erreicht ihr Ziel im Zeitraum (Respekt die 0, Vertrauen
 *     seinen Boden). Läuft eine auf, kühlt der Draht langsamer: Respekt 40 /
 *     Vertrauen 2, eine Woche – alt 21 → 19, neu 19,5 → 20.
 *   • Beide Achsen haben dasselbe Vorzeichen. Bei gemischtem Vorzeichen kühlt
 *     der Draht gar nicht ab, er driftet um einen Punkt je Woche VON der Null
 *     weg: Respekt 50 / Vertrauen −50 ist Draht 0 und steht nach einer Woche
 *     auf +1 (49 / −47), nach zehn auf +10. Umgekehrt −50 / 50 auf −1. Das ist
 *     gewollt – eine vernachlässigte Beziehung wird von selbst zu „er kennt
 *     dich, verlässt sich aber nicht mehr auf dich" – und steht als
 *     Zusicherung im Abschnitt „Die gewollte Abweichung" in
 *     test/beziehungen.test.js.
 */
const RESPEKT_DECAY_PRO_WOCHE = 1;
const VERTRAUEN_DECAY_PRO_WOCHE = 3;

/**
 * Der Boden, unter den Vertrauen nicht fällt. Nur DURCHGEZOGENES setzt ihn
 * (die Werte stehen in data/angebote.js), Zusagen und freundliche Antworten
 * nicht. Bei 30 Boden und Respekt 0 liegt der Draht bei 15 – unter „bekannt"
 * und unter der Schwelle, ab der Gegenanfragen überhaupt kommen: Die Beziehung
 * bleibt warm und öffnet nichts von allein.
 */
const BODEN_MAX = 30;

/** Respekt und Vertrauen liegen je zwischen diesen zwei Grenzen. */
const ACHSE_MIN = -100;
const ACHSE_MAX = 100;

/**
 * Das Gewicht des Respekts in der Antwortchance – es WÄCHST mit dem Abstand.
 *
 *   gleich groß oder kleiner  0,12   (heute 0,25)
 *   10×                       0,23
 *   100×                      0,34
 *   1000× und mehr            0,45
 *
 * Die Grenze liegt bei Faktor 15,2: Darunter kostet die Umverteilung, darüber
 * zahlt sie. Multiplikativ ginge das nicht – die Wurzel in der Basis staucht
 * jeden Faktor so stark, dass der Weltstar SCHWERER erreichbar würde
 * (100k gegen 10 Mio bei voller Beziehung 19,0 % statt 31,0 %).
 */
const RESPEKT_W_MIN = 0.12;
const RESPEKT_W_SPAN = 0.33;
const RESPEKT_W_DEKADEN = 3;

/**
 * Negatives Vertrauen zieht die Antwortchance – positives hebt sie NICHT, das
 * ist Respekts Aufgabe.
 *
 * Dieser Summand allein ist KEIN Riegel: Er sättigt bei −0,25, während der
 * Respekt-Term bis 0,45 läuft. Die Masche ist der wiederholte DISSTRACK (nicht
 * das Anstacheln – das bringt 0 Respekt): Jeder gelandete Diss legt +10 Respekt
 * nach, das Vertrauen liegt längst auf −100, und ab acht Treffern stünde der
 * Dauer-Beefer besser da als ein Fremder. Den Riegel macht erst
 * `contacts.respektWirkt`, das den Respekt-Term bei Vertrauen −100 auf null
 * dämpft – erst zusammen landet die Masche auf CHANCE_MIN.
 */
const VERTRAUEN_MALUS = 0.25;

/** Fester Partner: beide Achsen oben. Die EINZIGE Regel dafür. */
const PARTNER_RESPEKT = 50;
const PARTNER_VERTRAUEN = 50;

/** Schwellen der Beziehungsarten (Reihenfolge in contacts.artOf). */
const ART_RIVALE_RESPEKT = 30;
const ART_RIVALE_VERTRAUEN = -20;
const ART_ABSTAND = 10;              // ab Faktor 10 ist einer „viel größer"
const ART_MENTOR_RESPEKT = 50;
const ART_MENTOR_VERTRAUEN = 40;
const ART_SCHUETZLING_VERTRAUEN = 40;
const ART_BAND_BODEN = 10;
const ART_GESCHAEFTLICH_RESPEKT = 40;

/** Das Gedächtnis: so viele Zeilen je Kontakt, so viele in der Ansicht. */
const MEMORY_MAX = 12;
const MEMORY_ZEIGEN = 3;

/**
 * Was eine Gedächtniszeile erzählt. `{detail}` wird ersetzt.
 *
 * Bewusst NICHT eingetragen werden `fluechtig`, `echt`, `ignoriert` und
 * `angebot_ab`: Sie sind häufig und klein, und zwanzig Zeilen „ignoriert"
 * machen die Liste wertlos. Was man nur gewollt hat, erzählt stattdessen die
 * Zusammenfassung aus `tries − yes`.
 */
const MEMORY_TEXTE = {
  zusage:            'Zusage für {detail}',
  verstimmt:         'Du hast {detail} zu oft gefragt',
  angebot_an:        '{detail} angenommen',
  angebot_verfallen: '{detail} verfallen lassen',
  projekt_fertig:    '{detail} zu zweit fertig gemacht',
  projekt_verfallen: '{detail} verrotten lassen',
  beef_start:        'Beef angefangen',
  blamage:           'Dein Disstrack ging nach hinten los',
  diss:              'Dein Disstrack hat getroffen',
  konter:            'Konter kassiert',
  angezaehlt:        'Er hat dich angezählt',
  frieden:           'Frieden gemacht',
};

// --- Anfragearten ----------------------------------------------------------

/** Eine gemeinsame Bühne ist eine Verpflichtung – sie hängt am Vertrauen. */
const KONZERT_VERTRAUEN = 20;

/**
 * Vier Dinge, um die man bitten kann. `schwierigkeit` ist der Aufschlag auf
 * die Antwortchance – eine Reaktion kostet niemanden etwas, eine gemeinsame
 * Bühne schon. `minDraht` verlangt eine bestehende Beziehung, `minVertrauen`
 * dass er sich auf dich verlässt – höchstens EINES der beiden Tore je Art.
 */
const REQUESTS = [
  { id: 'reaktion', name: 'Auf deinen Post reagieren', emoji: '💬', time: KONTAKT_TIME, schwierigkeit: 0.15, minDraht: null, minVertrauen: null },
  { id: 'shoutout', name: 'Dich erwähnen', emoji: '📣', time: KONTAKT_TIME, schwierigkeit: 0, minDraht: null, minVertrauen: null },
  { id: 'feature', name: 'Gemeinsame Sache', emoji: '🎤', time: KONTAKT_TIME, schwierigkeit: -0.10, minDraht: null, minVertrauen: null },
  { id: 'konzert', name: 'Gemeinsam auf die Bühne', emoji: '🎪', time: KONTAKT_TIME, schwierigkeit: -0.20, minDraht: null, minVertrauen: KONZERT_VERTRAUEN },
];

// --- Charakterzüge ---------------------------------------------------------

/**
 * Der Charakterzug verschiebt die Antwortchance – und bestimmt den Ton der
 * Antwort. Wer kollegial ist, schreibt fast jedem zurück; wer arrogant ist,
 * schaut erst auf die Zahlen.
 */
const TRAIT_BONUS = {
  kollegial: 0.10,
  launisch: 0,
  geschaeftlich: -0.05,
  kuehl: -0.08,
  arrogant: -0.12,
};

/**
 * Antworttexte je Charakterzug und Stufe. `{name}` wird durch den Namen des
 * Kontakts ersetzt. Alles Spielfiktion: Musik, Streams, Termine – sonst nichts.
 */
const LINES = {
  kollegial: {
    fluechtig: [
      '{name} hat ein 🔥 dagelassen. Mehr nicht, aber immerhin sofort.',
      '{name} antwortet mit drei Herzen und einem Daumen.',
      '{name} hat die Nachricht gesehen und ein 🎧 zurückgeschickt.',
    ],
    echt: [
      '{name} schreibt: „Hab reingehört, die zweite Hälfte ist stark. Schick mir mehr!"',
      '{name} schreibt: „Kenn ich, mach ich seit Jahren. Melde dich, wenn du nicht weiterkommst."',
      '{name} schreibt: „Gute Arbeit. Ich teile das mal in meiner Gruppe."',
    ],
    zusage: [
      '{name} schreibt: „Klar, machen wir. Ich blocke mir zwei Tage."',
      '{name} schreibt: „Bin dabei. Schick mir die Datei, ich leg heute Abend was drauf."',
      '{name} schreibt: „Sofort ja. Sag nur, wann und wo."',
    ],
    nein: [
      '{name} schreibt: „Diesmal nicht, ich sitze bis zur Decke in Terminen. Frag nochmal!"',
      '{name} schreibt: „Passt gerade gar nicht – aber bleib dran, ja?"',
      '{name} schreibt: „Nächstes Mal. Versprochen."',
    ],
  },
  launisch: {
    fluechtig: [
      '{name} reagiert mit einem 👀 und ist wieder weg.',
      '{name} hat kurz getippt, dann wieder aufgehört. Geblieben ist ein 🎶.',
      '{name} antwortet nach vier Stunden mit „hm".',
    ],
    echt: [
      '{name} schreibt: „Heute find ich das gut. Frag mich morgen nochmal."',
      '{name} schreibt: „Die Strophe zieht, der Rest nicht. Ehrlich gesagt."',
      '{name} schreibt: „Bin gerade in einer komischen Phase, aber das hier hat was."',
    ],
    zusage: [
      '{name} schreibt: „Weiß auch nicht warum, aber ja. Lass machen."',
      '{name} schreibt: „Okay. Aber wenn ich mich morgen anders fühle, sag ich ab."',
      '{name} schreibt: „Ja. Jetzt. Bevor ich es mir überlege."',
    ],
    nein: [
      '{name} schreibt: „Keine Lust. Liegt nicht an dir."',
      '{name} schreibt: „Nee, heute nicht."',
      '{name} schreibt: „Ich mach gerade nichts mit niemandem. Sorry."',
    ],
  },
  geschaeftlich: {
    fluechtig: [
      'Das Management von {name} hat mit 👍 quittiert.',
      '{name} antwortet automatisiert: „Anfrage eingegangen."',
      'Von {name} kommt ein 📈 zurück. Vermutlich freundlich gemeint.',
    ],
    echt: [
      '{name} schreibt: „Interessant. Schick mir Zahlen: Hörer, Reichweite, Zeitraum."',
      '{name} schreibt: „Grundsätzlich möglich. Die Konditionen klären wir vorher."',
      '{name} schreibt: „Mein Kalender ist eng. Was genau brauchst du, in einem Satz?"',
    ],
    zusage: [
      '{name} schreibt: „Passt. Termin steht, Rest regeln die Büros."',
      '{name} schreibt: „Ja – zu den Bedingungen, die ich dir schicke."',
      '{name} schreibt: „Machen wir. Ich setze es für kommende Woche an."',
    ],
    nein: [
      '{name} schreibt: „Rechnet sich für beide Seiten gerade nicht."',
      '{name} schreibt: „Quartal ist voll. Frag im nächsten wieder an."',
      '{name} schreibt: „Absage, aber sauber begründet: falscher Zeitpunkt."',
    ],
  },
  kuehl: {
    fluechtig: [
      '{name} hat gelesen. Ein ✔️ kommt zurück.',
      '{name} antwortet: „ok".',
      'Von {name} kommt ein 🎹 – kommentarlos.',
    ],
    echt: [
      '{name} schreibt: „Solide gemacht. Der Mix ist zu laut."',
      '{name} schreibt: „Ich höre selten fremde Sachen. Das war in Ordnung."',
      '{name} schreibt: „Kurz und ehrlich: Der Aufbau funktioniert, der Schluss nicht."',
    ],
    zusage: [
      '{name} schreibt: „Einverstanden. Einmal, sauber, ohne Aufhebens."',
      '{name} schreibt: „Ja. Ich schicke meine Spur bis Freitag."',
      '{name} schreibt: „Gut. Aber keine Fotos davon."',
    ],
    nein: [
      '{name} schreibt: „Nein."',
      '{name} schreibt: „Ich arbeite allein. Das bleibt so."',
      '{name} antwortet gar nicht mehr – die Sache ist damit beantwortet.',
    ],
  },
  arrogant: {
    fluechtig: [
      '{name} liked die Nachricht. Das war es dann.',
      '{name} schickt ein 😎 und keine Silbe dazu.',
      '{name} antwortet mit dem eigenen Tourplakat. Ohne Text.',
    ],
    echt: [
      '{name} schreibt: „Nicht schlecht für die Größenordnung."',
      '{name} schreibt: „Hab reingehört. Ruf an, wenn du in meiner Liga bist."',
      '{name} schreibt: „Der Ansatz stimmt. Die Zahlen noch nicht."',
    ],
    zusage: [
      '{name} schreibt: „Na gut. Eine Strophe. Und mein Name steht vorne."',
      '{name} schreibt: „Ich mach das – weil ich Lust habe, nicht weil du gefragt hast."',
      '{name} schreibt: „Ja. Du weißt hoffentlich, was das für dich bedeutet."',
    ],
    nein: [
      '{name} schreibt: „Weißt du eigentlich, wie viele mich täglich anschreiben?"',
      '{name} schreibt: „Komm wieder, wenn dich jemand kennt."',
      '{name} schreibt: „Nein. Und bitte nicht nochmal."',
    ],
  },
};

/** Genres, die sich gegenseitig tragen – halbe Passung statt Fremdeln. */
const RELATED_GENRES = [
  ['pop', 'hiphop'],
  ['pop', 'elektro'],
  ['pop', 'jpop'],
  ['rock', 'metal'],
  ['rock', 'indie'],
  ['indie', 'pop'],
];

// --- Der Katalog -----------------------------------------------------------

/**
 * Die Künstler und Creator, die man anschreiben kann. Sortiert nach Sprache,
 * damit die Abdeckung beim Lesen sichtbar bleibt. `reach` sind monatliche
 * Hörer, `reachCreator` sind Follower – beides Spielfiktion in plausibler
 * Größenordnung, nicht recherchiert (siehe Kopf der Datei).
 */
const CONTACTS = [
  // --- Deutsch -------------------------------------------------------------
  { id: 'lilpfand', name: 'Lil Pfand', emoji: '🍾', kind: 'musik', country: 'de', language: 'deutsch',
    genre: 'hiphop', reach: 8_400, trait: 'kollegial',
    blurb: 'Nimmt im Keller seiner Oma auf und antwortet in elf Sekunden.' },
  { id: 'ninachuba', name: 'Nina Chuba', emoji: '🫧', kind: 'musik', country: 'de', language: 'deutsch',
    genre: 'pop', reach: 3_200_000, trait: 'kollegial',
    blurb: 'Ohrwürmer am Fließband, aber sie hört wirklich zu.' },
  { id: 'rafcamora', name: 'RAF Camora', emoji: '🌴', kind: 'musik', country: 'at', language: 'deutsch',
    genre: 'hiphop', reach: 6_500_000, trait: 'geschaeftlich',
    blurb: 'Wiener Schule, karibischer Klang – und ein Kalender wie ein Konzern.' },
  { id: 'loredana', name: 'Loredana', emoji: '💎', kind: 'musik', country: 'ch', language: 'deutsch',
    genre: 'hiphop', reach: 2_800_000, trait: 'launisch',
    blurb: 'Antwortet spontan oder gar nicht. Dazwischen gibt es nichts.' },
  { id: 'rammstein', name: 'Rammstein', emoji: '🔥', kind: 'musik', country: 'de', language: 'deutsch',
    genre: 'metal', reach: 30_000_000, trait: 'kuehl',
    blurb: 'Bühnenbau seit Jahrzehnten. Kurze Nachrichten, große Hallen.' },
  { id: 'hanszimmer', name: 'Hans Zimmer', emoji: '🎬', kind: 'musik', country: 'de', language: 'deutsch',
    genre: 'klassik', reach: 110_000_000, trait: 'geschaeftlich',
    blurb: 'Schreibt Musik für halbe Kinojahrgänge. Termine laufen übers Büro.' },
  { id: 'igorlevit', name: 'Igor Levit', emoji: '🕯️', kind: 'musik', country: 'de', language: 'deutsch',
    genre: 'klassik', reach: 400_000, trait: 'geschaeftlich',
    blurb: 'Spielt ganze Sonatenzyklen an einem Abend. Termine laufen über die Konzertagentur.' },

  // --- Englisch ------------------------------------------------------------
  { id: 'taylorswift', name: 'Taylor Swift', emoji: '✨', kind: 'musik', country: 'us', language: 'englisch',
    genre: 'pop', reach: 120_000_000, trait: 'geschaeftlich',
    blurb: 'Die größte Tourmaschine der Welt. Jede Anfrage geht durch drei Büros.' },
  { id: 'drake', name: 'Drake', emoji: '🦉', kind: 'beides', country: 'ca', language: 'englisch',
    genre: 'hiphop', reach: 110_000_000, platform: 'twitter', reachCreator: 40_000_000, trait: 'arrogant',
    blurb: 'Postet um vier Uhr morgens und hat trotzdem immer die besseren Zahlen.' },
  { id: 'coldplay', name: 'Coldplay', emoji: '🎆', kind: 'musik', country: 'gb', language: 'englisch',
    genre: 'rock', reach: 130_000_000, trait: 'kollegial',
    blurb: 'Stadion voller Leuchtarmbänder – und trotzdem freundlich im Chat.' },
  { id: 'metallica', name: 'Metallica', emoji: '🤘', kind: 'musik', country: 'us', language: 'englisch',
    genre: 'metal', reach: 120_000_000, trait: 'kuehl',
    blurb: 'Vier Jahrzehnte Tour. Antwortet knapp, hält aber jedes Wort.' },
  { id: 'arcticmonkeys', name: 'Arctic Monkeys', emoji: '🌙', kind: 'musik', country: 'gb', language: 'englisch',
    genre: 'indie', reach: 105_000_000, trait: 'launisch',
    blurb: 'Zwischen zwei Platten unerreichbar, danach plötzlich gesprächig.' },
  { id: 'burnaboy', name: 'Burna Boy', emoji: '🦅', kind: 'beides', country: 'ng', language: 'englisch',
    genre: 'pop', reach: 30_000_000, platform: 'twitter', reachCreator: 12_000_000, trait: 'arrogant',
    blurb: 'Lagos, London, ausverkauft. Sagt dir gern, in welcher Reihenfolge.' },
  { id: 'bopworth', name: 'Sir Reginald Bopworth', emoji: '🎻', kind: 'musik', country: 'gb', language: 'englisch',
    genre: 'klassik', reach: 3_900, trait: 'kollegial',
    blurb: 'Komponiert Fanfaren für Dorffeste und freut sich über jede Nachricht.' },
  { id: 'protesthero', name: 'Protest the Hero', emoji: '🗡️', kind: 'musik', country: 'ca', language: 'englisch',
    genre: 'metal', reach: 280_000, trait: 'launisch',
    blurb: 'Verschachtelte Riffs, Clubtouren durch halb Kanada, Jahre zwischen zwei Platten.' },

  // --- Spanisch ------------------------------------------------------------
  { id: 'rosalia', name: 'Rosalía', emoji: '🌹', kind: 'musik', country: 'es', language: 'spanisch',
    genre: 'pop', reach: 25_000_000, trait: 'launisch',
    blurb: 'Flamenco trifft Autotune. Arbeitet in Schüben und verschwindet dann.' },
  { id: 'pesopluma', name: 'Peso Pluma', emoji: '🪶', kind: 'musik', country: 'mx', language: 'spanisch',
    genre: 'pop', reach: 40_000_000, trait: 'geschaeftlich',
    blurb: 'Volle Hallen von Guadalajara bis Los Angeles, Termine im Halbstundentakt.' },
  { id: 'churros', name: 'Los Churros Eléctricos', emoji: '🍩', kind: 'musik', country: 'es', language: 'spanisch',
    genre: 'elektro', reach: 31_000, trait: 'kollegial',
    blurb: 'Spielen jeden Samstag im Strandlokal und nehmen jeden mit auf die Bühne.' },
  { id: 'lospunsetes', name: 'Los Punsetes', emoji: '🎸', kind: 'musik', country: 'es', language: 'spanisch',
    genre: 'indie', reach: 90_000, trait: 'kuehl',
    blurb: 'Trockene Gitarrenplatten und kleine, volle Säle in Madrid.' },

  // --- Portugiesisch -------------------------------------------------------
  { id: 'anitta', name: 'Anitta', emoji: '🔆', kind: 'beides', country: 'br', language: 'portugiesisch',
    genre: 'pop', reach: 20_000_000, platform: 'instagram', reachCreator: 65_000_000, trait: 'geschaeftlich',
    blurb: 'Singt in drei Sprachen und verhandelt in allen dreien.' },
  { id: 'emicida', name: 'Emicida', emoji: '📚', kind: 'musik', country: 'br', language: 'portugiesisch',
    genre: 'hiphop', reach: 1_800_000, trait: 'kollegial',
    blurb: 'Nimmt sich Zeit für lange Antworten – und meint jede Zeile davon.' },
  { id: 'sepultura', name: 'Sepultura', emoji: '⚒️', kind: 'musik', country: 'br', language: 'portugiesisch',
    genre: 'metal', reach: 3_000_000, trait: 'kuehl',
    blurb: 'Seit den Achtzigern auf Tour. Redet erst, wenn der Soundcheck steht.' },
  { id: 'zedopandeiro', name: 'Zé do Pandeiro', emoji: '🥁', kind: 'musik', country: 'br', language: 'portugiesisch',
    genre: 'indie', reach: 12_000, trait: 'kollegial',
    blurb: 'Nimmt alles auf dem Balkon auf, Papageien inklusive.' },
  { id: 'guiboratto', name: 'Gui Boratto', emoji: '🎧', kind: 'musik', country: 'br', language: 'portugiesisch',
    genre: 'elektro', reach: 450_000, trait: 'kuehl',
    blurb: 'Baut lange Technobögen in São Paulo und spielt sie auf europäischen Festivals.' },

  // --- Französisch ---------------------------------------------------------
  { id: 'davidguetta', name: 'David Guetta', emoji: '🎛️', kind: 'musik', country: 'fr', language: 'franzoesisch',
    genre: 'elektro', reach: 105_000_000, trait: 'geschaeftlich',
    blurb: 'Drei Festivals pro Wochenende. Anfragen bitte mit Datum und Bühnenplan.' },
  { id: 'angele', name: 'Angèle', emoji: '🎀', kind: 'musik', country: 'fr', language: 'franzoesisch',
    genre: 'pop', reach: 6_000_000, trait: 'launisch',
    blurb: 'Schreibt lieber Lieder als Nachrichten – manchmal aber eben doch.' },
  { id: 'pomme', name: 'Pomme', emoji: '🍏', kind: 'musik', country: 'fr', language: 'franzoesisch',
    genre: 'indie', reach: 800_000, trait: 'kollegial',
    blurb: 'Leise Platten, warme Antworten, Harmonium im Wohnzimmer.' },
  { id: 'baguettesauvage', name: 'Baguette Sauvage', emoji: '🥖', kind: 'musik', country: 'fr', language: 'franzoesisch',
    genre: 'rock', reach: 7_600, trait: 'launisch',
    blurb: 'Vier Leute, ein Proberaum über der Bäckerei, ständig neue Bandnamen.' },
  { id: 'oxmopuccino', name: 'Oxmo Puccino', emoji: '🖋️', kind: 'musik', country: 'fr', language: 'franzoesisch',
    genre: 'hiphop', reach: 350_000, trait: 'kollegial',
    blurb: 'Rappt seit Jahrzehnten in Bildern und tourt durch französische Theatersäle.' },
  { id: 'vanessawagner', name: 'Vanessa Wagner', emoji: '🌫️', kind: 'musik', country: 'fr', language: 'franzoesisch',
    genre: 'klassik', reach: 45_000, trait: 'kollegial',
    blurb: 'Klavierabende zwischen Minimal Music und Klassik, meist in kleinen Sälen.' },

  // --- Italienisch ---------------------------------------------------------
  { id: 'maneskin', name: 'Måneskin', emoji: '⚡', kind: 'musik', country: 'it', language: 'italienisch',
    genre: 'rock', reach: 22_000_000, trait: 'arrogant',
    blurb: 'Vom Straßenmusiker zum Stadion – und erzählt das auch gern.' },
  { id: 'einaudi', name: 'Ludovico Einaudi', emoji: '🎹', kind: 'musik', country: 'it', language: 'italienisch',
    genre: 'klassik', reach: 18_000_000, trait: 'kuehl',
    blurb: 'Acht Töne, die überall laufen. Antwortet so sparsam wie er spielt.' },
  { id: 'calcutta', name: 'Calcutta', emoji: '🌾', kind: 'musik', country: 'it', language: 'italienisch',
    genre: 'indie', reach: 700_000, trait: 'launisch',
    blurb: 'Verschwindet für Monate und taucht mit einem neuen Album wieder auf.' },
  { id: 'nonnabeat', name: 'Nonna Beat', emoji: '🍝', kind: 'musik', country: 'it', language: 'italienisch',
    genre: 'elektro', reach: 9_800, trait: 'kollegial',
    blurb: 'Baut Techno aus Küchengeräuschen. Kocht beim Abmischen.' },
  { id: 'vascorossi', name: 'Vasco Rossi', emoji: '🏟️', kind: 'musik', country: 'it', language: 'italienisch',
    genre: 'rock', reach: 2_500_000, trait: 'geschaeftlich',
    blurb: 'Füllt seit Jahrzehnten italienische Stadien. Die Tour steht ein Jahr vorher.' },

  // --- Türkisch ------------------------------------------------------------
  { id: 'sezenaksu', name: 'Sezen Aksu', emoji: '🕊️', kind: 'musik', country: 'tr', language: 'tuerkisch',
    genre: 'pop', reach: 6_000_000, trait: 'kuehl',
    blurb: 'Hat halbe Generationen von Sängern großgezogen. Prüft jeden genau.' },
  { id: 'ezhel', name: 'Ezhel', emoji: '🌿', kind: 'musik', country: 'tr', language: 'tuerkisch',
    genre: 'hiphop', reach: 4_200_000, trait: 'launisch',
    blurb: 'Zwischen Istanbul und Berlin, immer im falschen Zeitfenster erreichbar.' },
  { id: 'doenerdeluxe', name: 'Döner Deluxe', emoji: '🌯', kind: 'musik', country: 'tr', language: 'tuerkisch',
    genre: 'hiphop', reach: 15_000, trait: 'kollegial',
    blurb: 'Rappt nachts im Imbiss seines Onkels und lädt jeden zum Feature ein.' },
  { id: 'sertaberener', name: 'Sertab Erener', emoji: '🌺', kind: 'musik', country: 'tr', language: 'tuerkisch',
    genre: 'pop', reach: 650_000, trait: 'geschaeftlich',
    blurb: 'Hat den großen Songwettbewerb gewonnen und spielt seither jede Sommerbühne am Bosporus.' },
  { id: 'mezarkabul', name: 'Mezarkabul', emoji: '🐺', kind: 'musik', country: 'tr', language: 'tuerkisch',
    genre: 'metal', reach: 140_000, trait: 'kuehl',
    blurb: 'Türkischer Metal seit den Achtzigern, laute Hallen in Istanbul und Ankara.' },

  // --- Polnisch ------------------------------------------------------------
  { id: 'podsiadlo', name: 'Dawid Podsiadło', emoji: '🎈', kind: 'musik', country: 'pl', language: 'polnisch',
    genre: 'pop', reach: 3_000_000, trait: 'kollegial',
    blurb: 'Füllt Stadien in Warschau und schreibt trotzdem selbst zurück.' },
  { id: 'behemoth', name: 'Behemoth', emoji: '🦇', kind: 'musik', country: 'pl', language: 'polnisch',
    genre: 'metal', reach: 1_500_000, trait: 'kuehl',
    blurb: 'Bühnenbild wie eine Kathedrale. Small Talk ist nicht vorgesehen.' },
  { id: 'pierogisound', name: 'Pierogi Sound System', emoji: '🥟', kind: 'musik', country: 'pl', language: 'polnisch',
    genre: 'elektro', reach: 18_000, trait: 'kollegial',
    blurb: 'Legt auf jeder Hochzeit auf und hat für jeden Remix zehn Minuten Zeit.' },
  { id: 'riverside', name: 'Riverside', emoji: '🌊', kind: 'musik', country: 'pl', language: 'polnisch',
    genre: 'rock', reach: 160_000, trait: 'kuehl',
    blurb: 'Zehnminütige Stücke, ganze Konzeptalben, Clubtouren quer durch Europa.' },

  // --- Japanisch -----------------------------------------------------------
  { id: 'yoasobi', name: 'YOASOBI', emoji: '🌸', kind: 'musik', country: 'jp', language: 'japanisch',
    genre: 'jpop', reach: 15_000_000, trait: 'geschaeftlich',
    blurb: 'Macht aus Kurzgeschichten Charthits. Alles läuft über die Agentur.' },
  { id: 'ado', name: 'Ado', emoji: '🎭', kind: 'musik', country: 'jp', language: 'japanisch',
    genre: 'jpop', reach: 12_000_000, trait: 'kuehl',
    blurb: 'Singt hinter einem Vorhang und hält auch sonst Abstand.' },
  { id: 'hisaishi', name: 'Joe Hisaishi', emoji: '🍃', kind: 'musik', country: 'jp', language: 'japanisch',
    genre: 'klassik', reach: 9_000_000, trait: 'kuehl',
    blurb: 'Dirigiert lieber, als dass er schreibt. Wenn er zusagt, sitzt jeder Ton.' },
  { id: 'karaokeken', name: 'Karaoke-Kaiser Ken', emoji: '🎤', kind: 'musik', country: 'jp', language: 'japanisch',
    genre: 'rock', reach: 24_000, trait: 'launisch',
    blurb: 'Hausband einer Karaokebar in Osaka, spielt alles – auch um vier Uhr früh.' },
  { id: 'tofubeats', name: 'tofubeats', emoji: '🍥', kind: 'musik', country: 'jp', language: 'japanisch',
    genre: 'elektro', reach: 190_000, trait: 'launisch',
    blurb: 'Produziert in Kobe und schiebt zwischen zwei Alben ständig Remixe nach.' },
  { id: 'wedcampanella', name: 'Wednesday Campanella', emoji: '🎏', kind: 'musik', country: 'jp', language: 'japanisch',
    genre: 'jpop', reach: 800_000, trait: 'launisch',
    blurb: 'Videos wie Kurzfilme, Auftritte auf Festivals von Sapporo bis Fukuoka.' },
  { id: 'aimer', name: 'Aimer', emoji: '❄️', kind: 'musik', country: 'jp', language: 'japanisch',
    genre: 'jpop', reach: 3_000_000, trait: 'kuehl',
    blurb: 'Singt Titellieder für halbe Serienstaffeln. Anfragen gehen ans Label.' },

  // --- Koreanisch ----------------------------------------------------------
  { id: 'bts', name: 'BTS', emoji: '💜', kind: 'musik', country: 'kr', language: 'koreanisch',
    genre: 'jpop', reach: 120_000_000, trait: 'geschaeftlich',
    blurb: 'Weltweite Stadionläufe. Jede Anfrage landet zuerst bei der Agentur.' },
  { id: 'peggygou', name: 'Peggy Gou', emoji: '🪩', kind: 'musik', country: 'kr', language: 'koreanisch',
    genre: 'elektro', reach: 3_500_000, trait: 'arrogant',
    blurb: 'Zwischen Seoul, Berlin und Ibiza – und weiß genau, wer wichtig ist.' },
  { id: 'kimchikid', name: 'Kimchi Kid', emoji: '🥬', kind: 'musik', country: 'kr', language: 'koreanisch',
    genre: 'hiphop', reach: 41_000, trait: 'kollegial',
    blurb: 'Rappt über Mittagspausen und schickt jedem seine Beats zum Ausprobieren.' },
  { id: 'neonkimbap', name: 'Neon Kimbap', emoji: '🍙', kind: 'musik', country: 'kr', language: 'koreanisch',
    genre: 'jpop', reach: 130_000, trait: 'kollegial',
    blurb: 'Fünf Rookies, eine Bühne im Kaufhaus von Busan, jeden Samstag um vier.' },

  // --- Hindi ---------------------------------------------------------------
  { id: 'arijitsingh', name: 'Arijit Singh', emoji: '🪔', kind: 'musik', country: 'in', language: 'hindi',
    genre: 'pop', reach: 90_000_000, trait: 'kuehl',
    blurb: 'Singt halbe Filmjahrgänge ein und meidet jedes Interview.' },
  { id: 'arrahman', name: 'A. R. Rahman', emoji: '🎼', kind: 'musik', country: 'in', language: 'hindi',
    genre: 'klassik', reach: 40_000_000, trait: 'geschaeftlich',
    blurb: 'Eigenes Studio, eigene Regeln, Termine über Monate im Voraus.' },
  { id: 'bastibeats', name: 'Bollywood Basti Beats', emoji: '📻', kind: 'musik', country: 'in', language: 'hindi',
    genre: 'elektro', reach: 27_000, trait: 'kollegial',
    blurb: 'Remixt alte Filmsongs auf einem Laptop mit gesprungenem Display.' },

  // --- Arabisch ------------------------------------------------------------
  { id: 'amrdiab', name: 'Amr Diab', emoji: '🌙', kind: 'musik', country: 'ae', language: 'arabisch',
    genre: 'pop', reach: 12_000_000, trait: 'geschaeftlich',
    blurb: 'Seit Jahrzehnten der Klang jeder Sommernacht. Termine über Dubai.' },
  { id: 'saintlevant', name: 'Saint Levant', emoji: '🕌', kind: 'musik', country: 'ae', language: 'arabisch',
    genre: 'hiphop', reach: 3_000_000, trait: 'launisch',
    blurb: 'Wechselt mitten im Lied die Sprache und mitten im Chat das Thema.' },
  { id: 'shishasound', name: 'Shisha Sound', emoji: '💨', kind: 'musik', country: 'ae', language: 'arabisch',
    genre: 'elektro', reach: 19_000, trait: 'kollegial',
    blurb: 'Legt auf Dachterrassen auf und kennt jeden Türsteher der Stadt.' },

  // --- Mandarin ------------------------------------------------------------
  { id: 'jaychou', name: 'Jay Chou', emoji: '🐉', kind: 'musik', country: 'au', language: 'mandarin',
    genre: 'pop', reach: 12_000_000, trait: 'kuehl',
    blurb: 'Tourt von Sydney aus durch die halbe Welt. Spricht selten, spielt viel.' },
  { id: 'jacksonwang', name: 'Jackson Wang', emoji: '🐎', kind: 'musik', country: 'us', language: 'mandarin',
    genre: 'jpop', reach: 6_000_000, trait: 'arrogant',
    blurb: 'Eigenes Label, eigene Marke, eigene Meinung über deine Reichweite.' },
  { id: 'mcwokandroll', name: 'MC Wok & Roll', emoji: '🥢', kind: 'musik', country: 'us', language: 'mandarin',
    genre: 'hiphop', reach: 22_000, trait: 'kollegial',
    blurb: 'Rappt zwischen zwei Schichten im Familienrestaurant und freut sich über jeden.' },

  // --- Niederländisch ------------------------------------------------------
  { id: 'tiesto', name: 'Tiësto', emoji: '🔊', kind: 'musik', country: 'nl', language: 'niederlaendisch',
    genre: 'elektro', reach: 40_000_000, trait: 'geschaeftlich',
    blurb: 'Hat den Beruf mit erfunden. Der Kalender ist zwei Jahre voll.' },
  { id: 'destaat', name: 'De Staat', emoji: '🎚️', kind: 'musik', country: 'nl', language: 'niederlaendisch',
    genre: 'rock', reach: 350_000, trait: 'launisch',
    blurb: 'Baut seltsame Instrumente und noch seltsamere Videos.' },
  { id: 'innerohrwurm', name: 'Inner Ohrwurm', emoji: '🐛', kind: 'musik', country: 'nl', language: 'niederlaendisch',
    genre: 'elektro', reach: 12_000, trait: 'kollegial',
    blurb: 'Produziert auf einem Hausboot und schickt ungefragt Demos.' },
  { id: 'stroopwafels', name: 'Stroopwafel Sisters', emoji: '🧇', kind: 'musik', country: 'nl', language: 'niederlaendisch',
    genre: 'pop', reach: 120_000, trait: 'kollegial',
    blurb: 'Zwei Schwestern mit Akkordeon, die jedes Dorffest zwischen Utrecht und Groningen spielen.' },
  { id: 'joepbeving', name: 'Joep Beving', emoji: '🕰️', kind: 'musik', country: 'nl', language: 'niederlaendisch',
    genre: 'klassik', reach: 2_000_000, trait: 'kuehl',
    blurb: 'Leise Klavierstücke, die in Millionen Playlists liegen; spielt Kirchen und alte Säle.' },

  // --- Rumänisch -----------------------------------------------------------
  { id: 'inna', name: 'INNA', emoji: '🌞', kind: 'musik', country: 'ro', language: 'rumaenisch',
    genre: 'pop', reach: 8_000_000, trait: 'kollegial',
    blurb: 'Seit Jahren im Radio jedes Sommerlandes – und immer noch erreichbar.' },
  { id: 'carlasdreams', name: "Carla's Dreams", emoji: '🎩', kind: 'musik', country: 'ro', language: 'rumaenisch',
    genre: 'indie', reach: 1_500_000, trait: 'kuehl',
    blurb: 'Tritt maskiert auf und schreibt so knapp, wie er aussieht.' },
  { id: 'draculadisco', name: 'Dracula Disco', emoji: '🦇', kind: 'musik', country: 'ro', language: 'rumaenisch',
    genre: 'elektro', reach: 14_000, trait: 'launisch',
    blurb: 'Legt nur nach Mitternacht auf, schläft tagsüber, antwortet um drei.' },

  // --- Creator: Twitch -----------------------------------------------------
  { id: 'ninja', name: 'Ninja', emoji: '🥷', kind: 'creator', country: 'us', language: 'englisch',
    platform: 'twitch', reachCreator: 19_000_000, trait: 'geschaeftlich',
    blurb: 'Der Name, der Streaming groß gemacht hat. Kooperationen laufen über sein Team.' },
  { id: 'ibai', name: 'Ibai', emoji: '🎙️', kind: 'creator', country: 'es', language: 'spanisch',
    platform: 'twitch', reachCreator: 16_000_000, trait: 'kollegial',
    blurb: 'Veranstaltet halbe Volksfeste im Stream und lädt gern Gäste ein.' },
  { id: 'papaplatte', name: 'Papaplatte', emoji: '🍽️', kind: 'creator', country: 'de', language: 'deutsch',
    platform: 'twitch', reachCreator: 1_400_000, trait: 'launisch',
    blurb: 'Zehn Stunden am Stück live, danach drei Tage nicht erreichbar.' },
  { id: 'gaules', name: 'Gaules', emoji: '🏆', kind: 'creator', country: 'br', language: 'portugiesisch',
    platform: 'twitch', reachCreator: 4_000_000, trait: 'kollegial',
    blurb: 'Kommentiert Turniere bis in die Nacht und begrüßt jeden im Chat.' },
  { id: 'steffistream', name: 'Steffi Stream-Schnecke', emoji: '🐌', kind: 'creator', country: 'de', language: 'deutsch',
    platform: 'twitch', reachCreator: 340, trait: 'kollegial',
    blurb: 'Drei Zuschauer, davon zwei die Familie – und trotzdem jeden Abend live.' },

  // --- Creator: YouTube ----------------------------------------------------
  { id: 'mrbeast', name: 'MrBeast', emoji: '💸', kind: 'creator', country: 'us', language: 'englisch',
    platform: 'youtube', reachCreator: 300_000_000, trait: 'geschaeftlich',
    blurb: 'Produktionen wie Filmstudios. Anfragen beantwortet ein ganzes Büro.' },
  { id: 'whindersson', name: 'Whindersson Nunes', emoji: '😄', kind: 'creator', country: 'br', language: 'portugiesisch',
    platform: 'youtube', reachCreator: 60_000_000, trait: 'kollegial',
    blurb: 'Komiker, Sänger, Dauergast überall – und trotzdem herzlich.' },
  { id: 'carryminati', name: 'CarryMinati', emoji: '⚡', kind: 'creator', country: 'in', language: 'hindi',
    platform: 'youtube', reachCreator: 42_000_000, trait: 'arrogant',
    blurb: 'Schnelle Schnitte, schnelle Meinung zu deinen Abrufzahlen.' },
  { id: 'squeezie', name: 'Squeezie', emoji: '🎮', kind: 'creator', country: 'fr', language: 'franzoesisch',
    platform: 'youtube', reachCreator: 19_000_000, trait: 'kuehl',
    blurb: 'Füllt Hallen mit einem Videoformat. Sagt wenig, plant lange.' },
  { id: 'rezo', name: 'Rezo', emoji: '💙', kind: 'creator', country: 'de', language: 'deutsch',
    platform: 'youtube', reachCreator: 2_200_000, trait: 'kollegial',
    blurb: 'Recherchiert monatelang an einem Video und teilt gern sein Handwerk.' },

  // --- Creator: Instagram --------------------------------------------------
  { id: 'khabylame', name: 'Khaby Lame', emoji: '🤲', kind: 'creator', country: 'it', language: 'italienisch',
    platform: 'instagram', reachCreator: 80_000_000, trait: 'kollegial',
    blurb: 'Braucht keine Worte. Antwortet trotzdem – meist mit einer Geste.' },
  { id: 'lelepons', name: 'Lele Pons', emoji: '🎬', kind: 'creator', country: 'mx', language: 'spanisch',
    platform: 'instagram', reachCreator: 50_000_000, trait: 'launisch',
    blurb: 'Dreht fünf Clips am Tag und vergisst zwischendurch das Handy.' },
  { id: 'ferragni', name: 'Chiara Ferragni', emoji: '👜', kind: 'creator', country: 'it', language: 'italienisch',
    platform: 'instagram', reachCreator: 29_000_000, trait: 'geschaeftlich',
    blurb: 'Hat aus einem Blog ein Unternehmen gemacht. Alles hat einen Preis.' },
  { id: 'pamelareif', name: 'Pamela Reif', emoji: '🏋️', kind: 'creator', country: 'de', language: 'deutsch',
    platform: 'instagram', reachCreator: 9_000_000, trait: 'kuehl',
    blurb: 'Trainingspläne im Minutentakt, Antworten im Wochenrhythmus.' },
  { id: 'filterfrieda', name: 'Filter-Frieda', emoji: '🪞', kind: 'creator', country: 'at', language: 'deutsch',
    platform: 'instagram', reachCreator: 2_700, trait: 'kollegial',
    blurb: 'Fotografiert jedes Frühstück von oben und markiert dich ungefragt mit.' },

  // --- Creator: Twitter ----------------------------------------------------
  { id: 'mkbhd', name: 'Marques Brownlee', emoji: '📱', kind: 'creator', country: 'us', language: 'englisch',
    platform: 'twitter', reachCreator: 6_500_000, trait: 'kuehl',
    blurb: 'Prüft alles doppelt, bevor er etwas schreibt. Dafür stimmt es dann.' },
  { id: 'tomscott', name: 'Tom Scott', emoji: '🟥', kind: 'creator', country: 'gb', language: 'englisch',
    platform: 'twitter', reachCreator: 1_100_000, trait: 'kollegial',
    blurb: 'Erklärt gern, wie etwas funktioniert – auch deine Anfrage.' },
  { id: 'timelinetroll', name: 'Der Timeline-Troll', emoji: '🪤', kind: 'creator', country: 'de', language: 'deutsch',
    platform: 'twitter', reachCreator: 84_000, trait: 'arrogant',
    blurb: 'Kommentiert alles, kennt niemanden, hält sich für den Mittelpunkt.' },
];

/** Einen Kontakt am Schlüssel holen. */
const byId = (id) => CONTACTS.find((c) => c.id === id) || null;

module.exports = {
  CONTACTS, REQUESTS, TRAIT_BONUS, LINES, RELATED_GENRES, byId,
  KONTAKT_TIME, SPERRE_TAGE, SPERRE_IGNORIERT_TAGE,
  DRAHT_DECAY_PRO_WOCHE,
  KONZERT_VERTRAUEN,
  STUFE_BEKANNT, STUFE_PARTNER, STUFE_VERSTIMMT, STUFE_BEEF,
  CHANCE_MIN, CHANCE_MAX,
  ACHSEN, RESPEKT_DECAY_PRO_WOCHE, VERTRAUEN_DECAY_PRO_WOCHE, BODEN_MAX,
  ACHSE_MIN, ACHSE_MAX,
  RESPEKT_W_MIN, RESPEKT_W_SPAN, RESPEKT_W_DEKADEN, VERTRAUEN_MALUS,
  PARTNER_RESPEKT, PARTNER_VERTRAUEN,
  ART_RIVALE_RESPEKT, ART_RIVALE_VERTRAUEN, ART_ABSTAND, ART_MENTOR_RESPEKT,
  ART_MENTOR_VERTRAUEN, ART_SCHUETZLING_VERTRAUEN, ART_BAND_BODEN,
  ART_GESCHAEFTLICH_RESPEKT, MEMORY_MAX, MEMORY_ZEIGEN, MEMORY_TEXTE,
};
