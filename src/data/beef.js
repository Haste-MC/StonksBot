/**
 * ===========================================================================
 *  BEEF UND DISSTRACKS
 * ===========================================================================
 *
 * Der Draht zu anderen Künstlern (5a) geht in beide Richtungen: Man kann
 * jemanden anschreiben, um etwas zu bekommen – oder um Streit zu suchen. Dieses
 * Modul ist der Zahlensatz dazu: die Hitze als Uhr des Beefs, die Einstiegs-
 * chance, die Wirkung eines Disstracks, der Gegenschlag, das Ende und die
 * Texte, mit denen das alles erzählt wird. Reine Daten, kein Zustand, keine
 * Datenbank; gerechnet wird in src/beef.js.
 *
 * ---------------------------------------------------------------------------
 *  Alles hier ist Spielfiktion
 * ---------------------------------------------------------------------------
 * Die Gegner kommen aus dem Katalog in data/contacts.js, und dort stehen
 * Anklänge an bekannte Künstler. Die Texte in LINES sind erfundene
 * Spielnachrichten und zitieren niemanden. Sie erzählen ausschließlich, was
 * jemand im Spiel getan hat: geantwortet, gepostet, veröffentlicht, einen Termin gemacht, geschwiegen. Keine Aussage
 * über Meinungen, Charakter, Aussehen, Herkunft, Familie, Gesundheit oder das
 * Privatleben einer wirklichen Person, keine Beleidigung, nichts über Politik
 * oder Weltgeschehen. Ein Disstrack prahlt hier über Musik und Erfolg – sonst
 * nichts. test/beef.test.js hält das mit einer Sperrliste fest; wer hier etwas
 * ergänzt, hält sich daran.
 *
 * ---------------------------------------------------------------------------
 *  Die vier Lagen in LINES
 * ---------------------------------------------------------------------------
 *   einstieg   er lässt sich anstacheln, der Beef beginnt
 *   blamage    er steigt nicht ein, du stehst mit deiner Zeile allein da
 *   konter     sein Gegenschlag
 *   ende       der Beef ist abgerechnet
 */

// --- Hitze -----------------------------------------------------------------

/** Die Hitze ist die Uhr des Beefs: bei 0 ist Schluss, mehr als voll geht nicht. */
const HITZE_MAX = 100;
/** Ein angenommener Anstoß heizt so viel auf wie ein Angezählt-Werden. */
const HITZE_ANSTACHELN = 25;
const HITZE_ANGEZAEHLT = 25;
/** Ein Schlag wiegt schwerer als der Anfang – Diss und Konter gleich viel. */
const HITZE_DISS = 30;
const HITZE_KONTER = 30;
/** Ohne Nachschub ist ein frisch entfachter Beef nach gut vier Tagen durch. */
const HITZE_COOL_PRO_TAG = 6;
/** Darunter schlägt er nicht mehr zurück. */
const HITZE_KONTER_MIN = 40;
/** Darüber nimmt er keinen Frieden an. */
const HITZE_FRIEDEN_MAX = 30;
/** Zwei Fronten reichen – ein dritter Beef wird abgelehnt. */
const BEEFS_MAX = 2;

// --- Einstieg --------------------------------------------------------------

/** Anstacheln kostet dieselben zwei Stunden wie eine Anfrage in 5a. */
const BEEF_TIME = 2;
/** Auf Augenhöhe steigt gut jeder Zweite ein. */
const EINSTIEG_BASIS = 0.55;
/** Je Zehnerpotenz Größenunterschied 25 Punkte – der Riese hat nichts zu gewinnen. */
const EINSTIEG_STEIGUNG = 0.25;
/** Nie ganz unmöglich, nie ganz sicher. */
const EINSTIEG_MIN = 0.02;
const EINSTIEG_MAX = 0.95;

// --- Charakter -------------------------------------------------------------

/**
 * Charakter beim Streit – andere Züge als beim Gefallen (TRAIT_BONUS in 5a).
 * Wer arrogant ist, schlägt beim Gefallen aus und beim Streit ein; wer
 * kollegial ist, genau umgekehrt.
 */
const BEEF_TRAIT = {
  arrogant: 0.20, launisch: 0.15, kuehl: -0.05,
  geschaeftlich: -0.10, kollegial: -0.25,
};
/** Nur der Geschäftsmann rechnet die Größe mit: Streit muss sich lohnen. */
const GESCHAEFT_GROESSE = 0.20;

// --- Disstrack -------------------------------------------------------------

/** Ein Disstrack gegen einen Riesen bei voller Hitze holt das 2,5-fache Publikum. */
const DISS_AUFMERK = 1.5;
/** Häme greift nie weiter als bis hierhin – ganz verrissen wird niemand. */
const HAEME_MAX = 0.6;
/** Bei Häme zählt nicht die Aufmerksamkeit, sondern dieser halbe Faktor. */
const HAEME_AUDIENCE = 0.5;
/** Was Häme kostet: ein Fünftel Hype und zwei Prozent der Hörer. */
const HAEME_HYPE = 0.8;
const HAEME_HOERER = 0.02;

// --- Gegenschlag -----------------------------------------------------------

/** Sein Konter nimmt bis zu einem Viertel Hype und bis zu 10 % der Hörer. */
const KONTER_HYPE = 0.25;
const KONTER_HOERER = 0.10;
/** Darunter ist er so klein, dass sein Konter lächerlich wirkt. */
const KONTER_LAECHERLICH = 0.2;
/** Er antwortet nicht sofort – ein bis drei Tage später. */
const KONTER_MIN_TAGE = 1;
const KONTER_MAX_TAGE = 3;

// --- Angezählt werden ------------------------------------------------------

/**
 * Gut jede dritte Chart-Platzierung zieht einen Feind an.
 *
 * Balancing, gemessen (Messung vom 2026-09-26, Abschnitt „Nachtrag 5e"): Diese
 * Zahl ist der EINZIGE Hebel, mit dem der Beef den passiven Spieler überhaupt
 * noch etwas kostet. Wer angezählt wird und schluckt, nimmt keinen Gegenschlag
 * (`anzaehlen` schreibt `konter_at: 0`, und `settle` schlägt nur bei
 * `konter_at > 0` zu) – bei ihm greift von allen Beef-Zahlen ausschließlich das
 * Niederlagen-Fenster, und `BONUS_TAGE` 1 macht daraus einen Tag mit
 * `BONUS_NIEDERLAGE` 0,85. Wie teuer das Aussitzen im Jahr ist, hängt deshalb
 * nur daran, WIE OFT ein Fenster aufgeht, und das ist diese Zahl.
 *
 * Bei 0,06 kostete das Aussitzen einen reinen Musiker 5,0 % im Jahr (gepaart,
 * 60 Läufe) und einen Musik+Creator +0,2 %, also nichts. Gemessen wurde die
 * Reihe 0,06 · 0,25 · 0,30 · 0,35 · 0,40 · 0,45 bei sonst unveränderten Zahlen:
 * −5,0 % · −16,4 % · −18,1 % · −19,9 % · −21,7 % · −22,7 %. 0,35 liegt in der
 * Mitte des Zielbands (−15 % bis −25 %) und liefert gleichzeitig die einzige
 * Musik+Creator-Zahl, deren Vorzeichen aus dem Rauschen heraussteht (−10,2 %,
 * 42 von 60 Seeds im Minus).
 *
 * `BONUS_NIEDERLAGE` ist deshalb UNVERÄNDERT 0,85 und der Spiegel zu
 * `BONUS_SIEG` 1,25 unangetastet: Als Hebel sättigt die Zahl schnell (gemessen
 * bei 30 Läufen 0,85 → 0,60 bringt 6 Prozentpunkte, 0,60 → 0,40 nur noch 1,3),
 * und ein halbes Dutzend Läufe mit beiden Hebeln zusammen war in beiden
 * Archetypen schlechter als 0,35 allein.
 *
 * Der Deckel des Plans („keine Spielweise über +25 % gegen ohne Beef") hält mit
 * mehr Luft als vorher: Das häufigere Angezähltwerden trifft auch die Sieg-Farm,
 * die diese Fronten als Niederlagen abrechnet (Siegquote des reinen Musikers
 * 87,9 % → 71,0 %); ihre größte Zelle fällt von +19,7 % auf +16,2 %.
 */
const ANZAEHL_CHANCE = 0.35;

// --- Szene -----------------------------------------------------------------

/** Solange es brennt, macht seine Szene dicht – bei voller Hitze 15 Punkte. */
const SZENE_MALUS = 0.15;

// --- Achsen ----------------------------------------------------------------

/**
 * Was ein Beef an den zwei Achsen kostet.
 *
 * Der gelandete Disstrack ist der Fall, der die Spaltung überhaupt
 * rechtfertigt: Er nimmt dich danach ERNSTER als vorher (+10 Respekt) und
 * lässt sich auf kein mehrtägiges Format mehr ein (−36 Vertrauen). Mit einer
 * Zahl war dieser Zustand nicht darstellbar – gemittelt sah er aus wie
 * zweimal lauwarm.
 *
 * Anstacheln bringt keinen Respekt: Eine Provokation ist noch kein Treffer.
 * Sich zu blamieren kostet Respekt, nicht Vertrauen – er hat ja nichts
 * zugesagt, du hast dich nur vorgeführt. Und der ausgelachte Diss (`ACHSEN_HAEME`)
 * ist das Gegenteil des gelandeten, nicht dieselbe Buchung: Er senkt den
 * Respekt, statt ihn zu heben.
 */
const ACHSEN_ANSTACHELN = { respekt: 0, vertrauen: -24 };    // Mittel −12 (vorher −15)
const ACHSEN_BLAMAGE = { respekt: -10, vertrauen: -4 };      // Mittel  −7 (vorher  −5)
const ACHSEN_DISS = { respekt: 10, vertrauen: -36 };         // Mittel −13 (vorher −20)
/**
 * Nach unten geschlagen und sich dabei vorgeführt. Anders als beim gelandeten
 * Diss nimmt er dich danach WENIGER ernst – er hat die Runde, du hast Hype und
 * Hörer verloren, und die Szene hat gesehen, auf wen du gezielt hast.
 */
const ACHSEN_HAEME = { respekt: -8, vertrauen: -20 };        // Mittel −14
const ACHSEN_KONTER = { respekt: -6, vertrauen: -14 };       // Mittel −10 (wie vorher)
const ACHSEN_ANGEZAEHLT = { respekt: -4, vertrauen: -16 };   // Mittel −10 (wie vorher)

/** Steigt er nicht ein, kostet die Blamage einmalig ein Zwanzigstel Hype. */
const BLAMAGE_HYPE = 0.95;

// --- Frieden ---------------------------------------------------------------

/**
 * Versöhnung hebt das VERTRAUEN deutlich … (nicht den Respekt: Was du
 * getroffen hast, respektiert er weiterhin – er arbeitet nur wieder mit dir.)
 */
const FRIEDEN_PLUS = 30;
/** … aber nie ins Plus: Beef anfangen ist keine Abkürzung zum Partner. */
const FRIEDEN_DECKEL = -10;

// --- Ausgang ---------------------------------------------------------------

/**
 * Der Ausgang wirkt EINEN Tag auf den Hype – nicht eine Woche.
 *
 * Balancing, gemessen (Messung vom 2026-09-26, Abschnitt „Nachtrag 5d"): Der
 * Hype trägt sich selbst weiter (`hype ← 0,7 × hype + 0,3 × Wurf` beim
 * Veröffentlichen, `0,8 × hype + 0,3 × Güte` beim Konzert), und der Faktor
 * greift auf JEDE Veröffentlichung und JEDES Konzert im Fenster. Bei sieben
 * Tagen war der Fixpunkt dieser Rekursion `0,3 × Wurf × 1,25 / (1 − 0,7 × 1,25)`
 * = 3,0 × Wurf, also weit über `HYPE_MAX` 1,7; beim Konzert ist `1 − 0,8 × 1,25`
 * sogar genau 0, die Rekursion hat dort gar keinen Fixpunkt mehr. Wer regelmäßig
 * gewann, klebte damit dauerhaft an der Decke: gemessen lagen bei sieben Tagen
 * 14.335 von 21.900 simulierten Tagen im Siegfenster (Ø Hype dort 1,519, über
 * alle Tage 1,46), bei einem Tag sind es 2.824 (Ø Hype im Fenster 1,173, über
 * alle Tage 1,19) gegen 1,13 ohne jeden Beef. Ein Tag reicht für einen
 * sichtbaren Ausschlag, ohne dass sich Fenster an Fenster zu einem Dauerzustand
 * reiht: Der Ausgang trägt der gezielt gewinnenden Spielweise weiter ihren
 * ganzen Zuwachs. Bei `ANZAEHL_CHANCE` 0,06 waren das knapp 15 Prozentpunkte
 * (+19,7 % gegen +4,8 % ohne die zwei Faktoren); mit 0,35 sind es 16,4
 * (+15,0 % gegen −1,4 %, neu gemessen in „Nachtrag 5e"). Die Zahlen des
 * Fixpunkt- und Fensterabsatzes darüber stehen unverändert, weil sie die
 * Wirkung von `BONUS_TAGE` zeigen und bei 0,06 gemessen sind.
 *
 * Die zwei Faktoren selbst sind deshalb UNVERÄNDERT: Ein Sieg ist mit 1,25 der
 * stärkste Hype-Schub, den das Spiel an einem Tag kennt, und eine Niederlage
 * bleibt mit 0,85 genauso spürbar.
 */
const BONUS_TAGE = 1;
const BONUS_SIEG = 1.25;
const BONUS_NIEDERLAGE = 0.85;

// --- Aktionen --------------------------------------------------------------

/**
 * Die beiden Beef-Aktionen. Sie haben dieselbe Form wie REQUESTS in 5a
 * (`id`, `name`, `emoji`, `time`), stehen aber bewusst in einer eigenen Liste:
 * ihre Auflösung ist eine andere, und test/contacts.test.js hält fest, dass
 * REQUESTS genau vier Einträge hat.
 */
const BEEF_AKTIONEN = [
  { id: 'anstacheln', name: 'Anstacheln', emoji: '🔥', time: BEEF_TIME },
  { id: 'frieden', name: 'Frieden anbieten', emoji: '🕊️', time: BEEF_TIME },
];

// --- Texte -----------------------------------------------------------------

/**
 * Drei Zeilen je Charakterzug und Lage. `{name}` wird durch den Namen des
 * Kontakts ersetzt. Der Ton ist der des Spiels: trocken, gelegentlich komisch,
 * nie gemein über einen Menschen. Erzählt wird immer nur eine Handlung im
 * Spiel – geantwortet, gepostet, veröffentlicht, geschwiegen.
 */
const LINES = {
  kollegial: {
    einstieg: [
      '{name} schreibt: „Ernsthaft? Na gut – aber wir bleiben bei der Musik."',
      '{name} antwortet: „Schade drum. Wenn du das willst, kriegst du das."',
      '{name} schreibt: „Ich mach da sonst nicht mit. Heute einmal doch."',
    ],
    blamage: [
      '{name} schreibt: „Lass gut sein, ja? Schick mir lieber den Beat."',
      '{name} antwortet mit einem 🤝 und einer Einladung ins Studio. Das war es dann.',
      '{name} hat deine Zeile geteilt – mit drei Lach-Emojis und ohne einen Gegenschuss.',
    ],
    konter: [
      '{name} legt eine Antwort nach, die zur Hälfte ein Kompliment ist.',
      '{name} veröffentlicht eine Strophe und bedankt sich am Ende für den Anstoß.',
      '{name} schickt den Part vorab, damit du weißt, was auf dich zukommt.',
    ],
    ende: [
      '{name} schlägt ein gemeinsames Foto vor. Die Sache sei ausgestanden.',
      '{name} schreibt: „Gute Runde. Nächstes Mal wieder auf derselben Spur."',
      '{name} setzt beide Tracks in eine Playlist mit dem Titel „Ausgeredet".',
    ],
  },
  launisch: {
    einstieg: [
      '{name} antwortet um halb vier: „Heute passt mir das sogar."',
      '{name} schreibt „nein", löscht es und schreibt „doch, okay".',
      '{name} steigt ein, ohne ein Wort zu schreiben – nur ein Studiofoto.',
    ],
    blamage: [
      '{name} hat gelesen, getippt, aufgehört. Danach drei Tage Funkstille.',
      '{name} antwortet: „hab grad keinen Kopf dafür." Mehr kommt nicht.',
      '{name} postet stattdessen ein Bild vom Frühstück. Deine Zeile bleibt stehen.',
    ],
    konter: [
      '{name} stellt um vier Uhr früh zwei Minuten online. Gereimt, unabgemischt.',
      '{name} veröffentlicht eine Antwort, nimmt den Track wieder offline und lädt abends eine zweite Fassung hoch.',
      '{name} legt nach – mitten in der Nacht, ohne Ankündigung, dafür mit Wucht.',
    ],
    ende: [
      '{name} schreibt: „Weiß auch nicht mehr, warum. Ist jetzt aber vorbei."',
      '{name} löscht alle Beiträge zur Sache und postet ein Bild vom Meer.',
      '{name} ist zwei Wochen offline. Danach steht dazu nichts mehr im Profil.',
    ],
  },
  geschaeftlich: {
    einstieg: [
      '{name} lässt ausrichten: „Wir sehen da Reichweite. Machen wir."',
      'Das Management von {name} bestätigt einen Termin für die Antwort: Dienstag, 18 Uhr.',
      '{name} antwortet mit einer Zahl – deinen Hörern der letzten 28 Tage – und einem 🔥.',
    ],
    blamage: [
      '{name} lässt ausrichten, das rechne sich nicht. Der Rest bleibt unbeantwortet.',
      'Aus dem Büro von {name} kommt: „Kein Bedarf." Deine Zeile läuft ins Leere.',
      '{name} antwortet automatisiert: „Anfrage eingegangen." Danach nichts mehr.',
    ],
    konter: [
      '{name} veröffentlicht die Antwort pünktlich um Mitternacht, samt Cover und Pressetext.',
      '{name} schaltet Anzeigen auf den Gegentrack. Der läuft überall, bevor du überhaupt hingehört hast.',
      '{name} bringt den Konter als Single heraus: zwei Strophen, sauberer Mix, fester Termin.',
    ],
    ende: [
      '{name} erklärt die Sache über das Büro für beendet und schickt eine Playlist mit beiden Tracks.',
      '{name} nimmt den Track aus dem Verkauf, sobald die Zahlen nachgeben.',
      '{name} verlängert nichts. Das Thema steht in keinem Plan der nächsten Wochen.',
    ],
  },
  kuehl: {
    einstieg: [
      '{name} antwortet mit einem Wort: „Gut."',
      '{name} schreibt: „Verstanden. Dann machen wir das."',
      '{name} bestätigt kommentarlos und ist wieder offline.',
    ],
    blamage: [
      '{name} antwortet nicht. Die Zeile steht da, und nichts passiert.',
      '{name} schreibt: „Kein Interesse." Danach ist der Chat zu.',
      '{name} hat gelesen. Ein ✔️ kommt zurück, sonst nichts.',
    ],
    konter: [
      '{name} stellt vier Zeilen online. Kein Titelbild, kein Kommentar.',
      '{name} antwortet mit einem Instrumental, in dessen Dateinamen dein Name steht.',
      '{name} veröffentlicht 90 Sekunden. Länger war es offenbar nicht nötig.',
    ],
    ende: [
      '{name} schreibt: „Erledigt." Mehr steht dazu nicht.',
      '{name} nimmt den Track kommentarlos aus dem Profil.',
      '{name} spielt das nächste Konzert, ohne die Sache zu erwähnen.',
    ],
  },
  arrogant: {
    einstieg: [
      '{name} antwortet binnen Minuten: „Süß. Dann zeig mal, was du hast."',
      '{name} postet einen Screenshot deiner Zeile und schreibt „Notiert." darunter.',
      '{name} meldet sich von selbst: „Ich hab Zeit. Du hast Glück."',
    ],
    blamage: [
      '{name} hat nicht mal gelesen. Deine Zeile steht da wie bestellt und nicht abgeholt.',
      '{name} liket die Zeile und schreibt nichts. Das war die ganze Antwort.',
      '{name} postet im selben Moment die eigenen Tourdaten. Zufall, sagt das Team.',
    ],
    konter: [
      '{name} legt nach – vier Minuten, drei Strophen, kein Refrain.',
      '{name} veröffentlicht nachts um zwei eine Antwort unter dem Titel „Nachtrag".',
      '{name} baut deinen Namen in den Refrain ein. Falsch betont, mit Absicht.',
    ],
    ende: [
      '{name} gibt ein Interview über das neue Album. Der Beef kommt darin nicht vor.',
      '{name} hakt die Sache als „Kapitel" ab und spielt wieder das alte Set.',
      '{name} nimmt den Track aus dem Set. Ohne Ankündigung, ohne Erklärung.',
    ],
  },
};

module.exports = {
  BEEF_AKTIONEN, BEEF_TRAIT, GESCHAEFT_GROESSE, LINES,
  HITZE_MAX, HITZE_ANSTACHELN, HITZE_ANGEZAEHLT, HITZE_DISS, HITZE_KONTER,
  HITZE_COOL_PRO_TAG, HITZE_KONTER_MIN, HITZE_FRIEDEN_MAX, BEEFS_MAX,
  BEEF_TIME, EINSTIEG_BASIS, EINSTIEG_STEIGUNG, EINSTIEG_MIN, EINSTIEG_MAX,
  DISS_AUFMERK, HAEME_MAX, HAEME_AUDIENCE, HAEME_HYPE, HAEME_HOERER,
  KONTER_HYPE, KONTER_HOERER, KONTER_LAECHERLICH, KONTER_MIN_TAGE, KONTER_MAX_TAGE,
  ANZAEHL_CHANCE, SZENE_MALUS,
  ACHSEN_ANSTACHELN, ACHSEN_BLAMAGE, ACHSEN_DISS, ACHSEN_HAEME, ACHSEN_KONTER,
  ACHSEN_ANGEZAEHLT,
  BLAMAGE_HYPE, FRIEDEN_PLUS, FRIEDEN_DECKEL,
  BONUS_TAGE, BONUS_SIEG, BONUS_NIEDERLAGE,
};
