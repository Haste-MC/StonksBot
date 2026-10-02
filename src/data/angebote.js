/**
 * ===========================================================================
 *  ANGEBOTE – GEGENANFRAGEN UND GROSSE FORMATE
 * ===========================================================================
 *
 * In 5a schreibt der Spieler die Künstler aus dem Katalog an, in 5b sucht er
 * Streit. Hier dreht sich die Richtung: Ein Kontakt, zu dem der Draht steht,
 * meldet sich von selbst – mit einer von sechs Anfragen. Dieses Modul ist der
 * Zahlensatz dazu: die Zustellung, der Draht-Ausschlag, die Gewichtung beim
 * Ziehen, Honorar und Gage, die beiden Projekte und die Texte, mit denen das
 * erzählt wird. Reine Daten, kein Zustand, keine Datenbank; gerechnet wird in
 * src/angebote.js.
 *
 * ---------------------------------------------------------------------------
 *  Alles hier ist Spielfiktion
 * ---------------------------------------------------------------------------
 * Die Kontakte kommen aus dem Katalog in data/contacts.js, und dort stehen
 * Anklänge an bekannte Künstler jeden Geschlechts. Die Texte in LINES sind
 * erfundene Spielnachrichten und zitieren niemanden. Sie erzählen
 * ausschließlich, was jemand im Spiel getan hat: geschrieben, geschickt,
 * gepostet, veröffentlicht, einen Termin gemacht, geschwiegen. Keine Aussage
 * über Meinungen, Charakter, Aussehen, Herkunft (außer der Staatsangehörigkeit),
 * Familie, Gesundheit oder das Privatleben einer wirklichen Person.
 *
 * Und die Regel, die in 5b einmal gerissen ist: **kein Pronomen und kein
 * geschlechtliches Wort über einen Kontakt.** `{name}` wird durch einen echten
 * Künstlernamen ersetzt – „{name} sagt, er wisse …" liest sich bei der Hälfte
 * des Katalogs falsch. Benannt wird deshalb immer die Handlung, nie die
 * Person. Das gilt auch für die Namen in ARTEN, denn die stehen in der Anzeige
 * direkt neben dem Namen des Kontakts. test/angebote.test.js hält das mit
 * einer Sperrliste fest; wer hier etwas ergänzt, hält sich daran.
 *
 * ---------------------------------------------------------------------------
 *  Die drei Lagen in LINES
 * ---------------------------------------------------------------------------
 *   anfrage    der Kontakt meldet sich mit einem Angebot
 *   zusage     du hast angenommen
 *   absage     du hast abgelehnt
 */

// --- Zustellung ------------------------------------------------------------

/** Je vergangenem Tag ein Wurf, und höchstens EIN Treffer – gut alle fünf Tage eine Anfrage. */
const ANFRAGE_CHANCE = 0.18;
/** Mehr offene Anfragen gibt es nicht; zwei passen in den Reaktionshaushalt der Ansicht. */
const ANFRAGEN_MAX = 2;
/** So lange steht eine Anfrage, danach verfällt sie. */
const FRIST_TAGE = 3;
/** Nach drei nicht angenommenen Anfragen ruht der Zustellweg zwei Wochen. */
const PAUSE_TAGE = 14;
const PAUSE_SCHWELLE = 3;
/**
 * Mehr Abwesenheit wird nicht nachgeholt: Ohne diese Grenze bekäme ein Spieler
 * nach drei Wochen Pause zwanzig Würfe auf einmal und damit sofort beide
 * Plätze voll.
 */
const ROLL_TAGE_MAX = 7;

// --- Draht -----------------------------------------------------------------

/** Was eine Anfrage am Draht macht – Liegenlassen ist schlimmer als Absagen. */
const DRAHT_AN = 8;
const DRAHT_AB = -5;
const DRAHT_VERFALL = -8;

// --- Gewichtung beim Ziehen ------------------------------------------------

/** Partner melden sich viermal so oft wie Bekannte – das ist der Wert des Partner-Status aus 5a. */
const GEWICHT_BEKANNT = 1;
const GEWICHT_PARTNER = 4;

// --- Honorar (gastpart) ----------------------------------------------------

/**
 * Das Honorar wächst mit SEINER Reichweite, ist aber auf 30 Tage eigener
 * Tantiemen gedeckelt: Ein Winzling wird von einem Weltstar nicht über Nacht
 * reich, und wer selbst eine Million Hörer hat, verdient an einem Gastpart
 * weniger als an einem Tag Tantiemen – für den zählt nur noch der Schub.
 */
const HONORAR_K = 3;
const HONORAR_EXP = 0.6;
const HONORAR_DECKEL_TAGE = 30;

// --- Gage (vorgruppe) ------------------------------------------------------

/** So viel seines Publikums kommt mit – gedeckelt auf die eigene Hörerschaft. */
const VORGRUPPE_ANTEIL = 0.05;

// --- Projekte --------------------------------------------------------------

/** Ein Kollabo-Album kostet 18 Stunden statt der 3 einer Platte – für höchstens doppeltes Publikum. */
const KOLLABO_STUNDEN = 18;
/** Dieselben sechs Titel, die auch ein normales Album kostet – erst das macht „18 Stunden gegen 3 Stunden für dieselben Titel" zu einem Vergleich. */
const KOLLABO_TITEL = 6;
/** Fünf einzelne Konzerte kosten 20 Stunden und 12 Tage Sperre; die Tour 24 Stunden und keine Sperre. */
const TOUR_STUNDEN = 24;
const TOUR_KONZERTE = 5;
/** Wird die Frist gerissen, verfallen die investierten Stunden – der Preis dafür, dass ein Projekt nicht zwingt. */
const PROJEKT_FRIST_TAGE = 14;
/** Je Druck auf „daran arbeiten" – beliebig oft am Tag, solange das Tagesbudget trägt. */
const ARBEIT_STUNDEN = 2;

// --- Die sechs Anfragearten ------------------------------------------------

/**
 * Dieselbe Form wie REQUESTS in 5a und BEEF_AKTIONEN in 5b (`id`, `name`,
 * `emoji`, `time`), dazu `minDraht`: `kollabo`, `tour` und `label` kommen
 * ausschließlich von Partnern (Draht ≥ 50).
 *
 * `time: 0` bei `kollabo` und `tour`: Die Annahme selbst kostet nichts, das
 * Projekt kostet danach seine Stunden.
 *
 * Die Namen sind bewusst ohne „seiner"/„seinem" formuliert – sie stehen in der
 * Anzeige direkt neben dem Namen des Kontakts, und der kann jedes Geschlecht
 * haben (siehe Banner oben).
 */
const ARTEN = [
  { id: 'tausch', name: 'Gegenseitige Erwähnung', emoji: '🔁', time: 2, minDraht: 20 },
  { id: 'gastpart', name: 'Gastpart auf der neuen Platte', emoji: '🎙️', time: 2, minDraht: 20 },
  { id: 'vorgruppe', name: 'Vorgruppe beim nächsten Konzert', emoji: '🎪', time: 4, minDraht: 20 },
  { id: 'kollabo', name: 'Gemeinsames Album', emoji: '💿', time: 0, minDraht: 50 },
  { id: 'tour', name: 'Tour zu zweit', emoji: '🎵', time: 0, minDraht: 50 },
  { id: 'label', name: 'Einführung beim Label', emoji: '📝', time: 2, minDraht: 50 },
];

// --- Texte -----------------------------------------------------------------

/**
 * Drei Zeilen je Charakterzug und Lage. `{name}` wird durch den Namen des
 * Kontakts ersetzt. Der Ton ist der des Spiels: trocken, gelegentlich komisch,
 * nie etwas über einen Menschen. Erzählt wird immer nur eine Handlung im
 * Spiel – geschrieben, geschickt, gebucht, gepostet, geschwiegen.
 */
const LINES = {
  kollegial: {
    anfrage: [
      '{name} schreibt: „Ich hab da was, das ohne dich nicht funktioniert."',
      '{name} schickt eine Sprachnachricht von 14 Sekunden: „Sag einfach ja."',
      '{name} schreibt: „Kein Druck – aber ich hätte da einen Platz frei."',
    ],
    zusage: [
      '{name} schickt sofort die Datei und zwei Termine zur Auswahl.',
      '{name} schreibt „Perfekt." und legt den Ordner mit allen Spuren dazu.',
      '{name} ruft an, redet zehn Minuten über den Aufbau und schickt danach den Plan.',
    ],
    absage: [
      '{name} schreibt: „Schade. Steht, wenn du Zeit hast."',
      '{name} antwortet mit einem 👍 und hängt den Beat trotzdem an.',
      '{name} schreibt: „Alles gut. Melde mich beim nächsten Mal wieder."',
    ],
  },
  launisch: {
    anfrage: [
      '{name} schreibt um 3:40: „Jetzt oder nie. Also, eher jetzt."',
      '{name} fragt an, zieht die Anfrage zurück und fragt zwei Minuten später erneut.',
      '{name} schickt nur ein Datum, ein Studio und ein Fragezeichen.',
    ],
    zusage: [
      '{name} antwortet „endlich" und stellt eine Stunde später den Termin um.',
      '{name} schickt drei Entwürfe, einen Rückruf und am Ende doch den ersten.',
      '{name} postet ein Foto vom Mischpult, ohne ein Wort dazu zu schreiben.',
    ],
    absage: [
      '{name} liest es, tippt lange und schickt am Ende nur einen Punkt.',
      '{name} schreibt: „Okay." Danach vier Tage Funkstille.',
      '{name} löscht den ganzen Chat und postet ein Bild vom Hafen.',
    ],
  },
  geschaeftlich: {
    anfrage: [
      'Das Management von {name} schickt ein Angebot mit Frist und Honorarrahmen.',
      '{name} lässt ausrichten: „Die Zahlen passen. Wir hätten da ein Fenster."',
      'Aus dem Büro von {name} kommt eine Anfrage, samt Termin und Mitschnitt-Klausel.',
    ],
    zusage: [
      '{name} lässt den Vertrag am selben Tag zustellen – zwei Seiten, sauber.',
      'Das Büro von {name} bestätigt: Studio gebucht, Technik steht, Dienstag 18 Uhr.',
      '{name} schickt den Ablaufplan und eine Rechnung mit dem Hinweis „nach Abnahme".',
    ],
    absage: [
      '{name} lässt ausrichten, das Fenster werde anders belegt.',
      'Aus dem Büro von {name} kommt: „Zur Kenntnis genommen." Der Termin ist weg.',
      '{name} streicht den Posten aus dem Quartalsplan. Kommentarlos.',
    ],
  },
  kuehl: {
    anfrage: [
      '{name} schreibt: „Hätte da was. Interesse?"',
      '{name} schickt eine Datei, ein Datum und sonst nichts.',
      '{name} fragt in vier Worten und ist danach wieder offline.',
    ],
    zusage: [
      '{name} antwortet: „Gut." Zehn Minuten später steht der Termin im Kalender.',
      '{name} schickt die Spur ohne Kommentar. Im Dateinamen steht dein Name, Version 1.',
      '{name} bestätigt mit einem ✔️ und schickt die Adresse vom Studio.',
    ],
    absage: [
      '{name} antwortet nicht mehr. Das Angebot steht einfach nicht mehr da.',
      '{name} schreibt: „Verstanden." Der Chat bleibt danach leer.',
      '{name} nimmt den Termin aus dem Kalender. Keine weitere Nachricht.',
    ],
  },
  arrogant: {
    anfrage: [
      '{name} schreibt: „Du darfst mit. Sag kurz Bescheid."',
      '{name} postet die Ankündigung zuerst und fragt dich danach.',
      '{name} schickt: „Ein Platz ist frei. Zwei Tage, dann vergebe ich den weiter."',
    ],
    zusage: [
      '{name} schreibt „Gute Entscheidung." und schickt den Termin ohne Rückfrage.',
      '{name} kündigt die Sache als eigene Idee an. Dein Name steht klein darunter.',
      '{name} schickt den Ablauf, in dem dein Part an dritter Stelle steht.',
    ],
    absage: [
      '{name} schreibt: „Dein Verlust." Die Ankündigung läuft trotzdem.',
      '{name} vergibt den Platz noch am selben Abend weiter und postet es.',
      '{name} liket deine Absage. Mehr kommt dazu nicht.',
    ],
  },
};

module.exports = {
  ANFRAGE_CHANCE, ANFRAGEN_MAX, FRIST_TAGE, PAUSE_TAGE, PAUSE_SCHWELLE, ROLL_TAGE_MAX,
  DRAHT_AN, DRAHT_AB, DRAHT_VERFALL,
  GEWICHT_BEKANNT, GEWICHT_PARTNER,
  HONORAR_K, HONORAR_EXP, HONORAR_DECKEL_TAGE,
  VORGRUPPE_ANTEIL,
  KOLLABO_STUNDEN, KOLLABO_TITEL, TOUR_STUNDEN, TOUR_KONZERTE,
  PROJEKT_FRIST_TAGE, ARBEIT_STUNDEN,
  ARTEN, LINES,
};
