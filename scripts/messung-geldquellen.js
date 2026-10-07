/**
 * ===========================================================================
 *  MESSUNG: Rangfolge der Geldquellen
 * ===========================================================================
 *
 * Beantwortet eine einzige Frage mit Zahlen statt mit Schätzungen:
 *
 *     Was verdient ein reiner Creator, was ein Spieler, der Musik UND Creator
 *     betreibt – bei gleichem Zeiteinsatz? Und was ein Heist-Spieler?
 *     Und was wirft eine Firma im Vollbetrieb ab (seit 1.31.0) – im Kern,
 *     voll ausgebaut, und aus eigener Kraft ausgebaut (seit 1.32.0)?
 *
 * ==================== WARUM DAS SO GEBAUT IST ====================
 * Zwei Fehler haben eine frühere Messung wertlos gemacht; beide sind hier
 * ausdrücklich adressiert:
 *
 *  1. **Die simulierte Spielweise war zu schwach.** Ein Skript, das stur das
 *     erstbeste Format nimmt, misst nicht das Spiel, sondern sich selbst.
 *     Deshalb fährt jeder Archetyp hier MEHRERE Strategien, und gewertet wird
 *     die beste. Ein Balancing gegen schlechtes Spiel wäre wertlos.
 *
 *  2. **Ohne festen Würfel war die Streuung größer als der Effekt.** Zwei
 *     Läufe desselben Codes ergaben 907 und 50.280 Hörer. Musikwachstum
 *     verstärkt sich selbst: frühe gute Würfe wachsen sich aus, frühe
 *     schlechte nie. Deshalb: fester Würfel, viele Läufe, und ausgewertet
 *     wird der **Median** – bei dieser Verteilung zieht ein einzelner
 *     Ausreißer jeden Mittelwert beliebig weit.
 * ================================================================
 *
 * Aufruf:  node scripts/messung-geldquellen.js [läufe] [tage] [--stunden=N] [--marathon]
 *          node scripts/messung-geldquellen.js 30 730
 *          node scripts/messung-geldquellen.js 10 365 --stunden=8
 *          node scripts/messung-geldquellen.js 10 365 --nur=nachfrage
 *          node scripts/messung-geldquellen.js 10 365 --nur=kontakte
 *          node scripts/messung-geldquellen.js 10 365 --nur=beef
 *          node scripts/messung-geldquellen.js 10 365 --nur=angebote
 *          node scripts/messung-geldquellen.js 10 365 --nur=vorfaelle
 *          node scripts/messung-geldquellen.js stufenprobe [würfe]
 *              – Gegenprobe: der gerechnete erwartete Stufenfaktor gegen die
 *                gewürfelte `contacts.stufeVon` (läuft in Sekunden).
 *
 * Kein Netz: die Geldschnittstelle wird ersetzt und mitgeschrieben.
 */

/*
 * EIGENE Datenbank, bevor irgendein Modul geladen wird.
 *
 * Ohne das schreibt der Messlauf in `data/shop.db` – die echte Spieldatenbank.
 * Das verfälscht nichts, macht die Datei aber gross und den Lauf dadurch
 * quälend langsam: gemessen 11 Minuten Laufzeit für 30 Sekunden Rechnen, der
 * Rest Warten auf die Platte.
 */
process.env.DATA_DIR = process.env.DATA_DIR
  || require('node:path').join(require('node:os').tmpdir(), `messung-${process.pid}`);

const db = require('../src/db');
const creator = require('../src/creator');
const music = require('../src/music');
const home = require('../src/home');
const unb = require('../src/unb');
const gearData = require('../src/data/gear');
const heistData = require('../src/data/heists');
const heist = require('../src/heist');
const decisions = require('../src/decisions');
const company = require('../src/company');
const companyData = require('../src/data/companies');
const contacts = require('../src/contacts');
const contactsData = require('../src/data/contacts');
const beef = require('../src/beef');
const beefData = require('../src/data/beef');
const musicData = require('../src/data/music');
const angebote = require('../src/angebote');
const angeboteData = require('../src/data/angebote');

const DAY = 24 * 60 * 60 * 1000;
/** `--ohne-ereignisse`: Musik und Firmen ohne leichte Ereignisse und ohne Vorfälle (Vergleichsmessung, §3). */
const OHNE_EREIGNISSE = process.argv.includes('--ohne-ereignisse');
const musikOpts = { events: !OHNE_EREIGNISSE };
/*
 * `--strategie=<Name>`: Suchphase überspringen und nur die genannte Strategie
 * messen (Name exakt wie hinter `via "…"` ausgegeben). Mit Ereignissen ist die
 * kurze Suchphase verrauscht und kann eine andere Strategie wählen als der
 * Lauf ohne Ereignisse – dann misst man die Wahl, nicht die Ereignisse.
 */
const STRATEGIE = (process.argv.find((a) => a.startsWith('--strategie=')) ?? '').slice('--strategie='.length) || null;
/** `--stunden=<N>`: höchstens N Stunden am Tag (Musik + Kanäle zusammen; Standard 24 = bis Zeit oder Wand). */
const STUNDEN = Number((process.argv.find((a) => a.startsWith('--stunden=')) ?? '').slice('--stunden='.length)) || 24;
/** `--marathon`: gerade Tage bis zur Wand, ungerade Tage Pause – misst „Marathon + Ruhetag im Wechsel". */
const MARATHON = process.argv.includes('--marathon');
/**
 * `--trace=<branche>:<keiner|kapitalist|aufsteiger>:<mit|ohne>`: die Tagesbuchungen dieses
 * Firmenlaufs als JSON-Zeilen auf stderr (Handprüfung: Einkauf, Werbung, Anpacken, Umsatz,
 * Löhne, Ware, Lager, Kasse). `--trace=handel:<spedition|baufirma>:<mit|ohne>` dasselbe für
 * eine Seite des Handelslaufs (Stück 3b: `kauf.handel/preis/ersparnis`, `spanne`).
 * `--trace=kontakte` gibt jede Kontaktanfrage des Kontaktlaufs (Stück 5a) als JSON-Zeile aus.
 * `--trace=beef` gibt jedes Anstacheln und jeden Disstrack des Beeflaufs (Stück 5b) als
 * JSON-Zeile aus – die Grundlage der Handprüfung (Einstiegschance, Wucht, Aufmerksamkeit).
 * `--trace=angebote` gibt jede Zustellung, jede Annahme, jeden Druck auf „daran arbeiten",
 * jedes fertige Projekt und jede Unterschrift des Angebotslaufs (Stück 5c) als JSON-Zeile
 * aus – die Grundlage der Handprüfung (Honorar, Gage, Kollabo-Faktor, Tour-Gast). Die
 * Hörerzahl steht dabei mit DEMSELBEN Zeitstempel dabei, mit dem der Spielcode sie liest;
 * nur so ist der Kollabo-Faktor von Hand auf die letzte Stelle nachrechenbar.
 */
const TRACE = (process.argv.find((a) => a.startsWith('--trace=')) ?? '').slice('--trace='.length) || null;
/**
 * `--nur=<abschnitt>`: nur einen Abschnitt fahren.
 *   `nachfrage` Nachfrage-Drift (Stück 3c) – billig, der Rest braucht Minuten.
 *   `kontakte`  Kontaktpflege mit und ohne (Stück 5a) – zwei Archetypen, je drei Varianten.
 *   `beef`      Beef und Disstracks (Stück 5b/5c) – zwei Archetypen, je SECHS Varianten
 *   `vorfaelle` Vorfälle bei Musik und Creator (Stück 5f) – Handprüfung, Vorfälle je
 *               Jahr nach Reichweite, Türprobe, Sperre mit und ohne Bereichsfilter,
 *               dazu der Karriere-Lauf „aus" gegen „an" (zwei Archetypen).
 *   `angebote`  Gegenanfragen und große Formate (Stück 5c) – zwei Archetypen, je SECHS
 *               Varianten plus ein Kontrollpaar für das Kollabo-Album
 *               (ohne Beef · passiv · Beef-Spielweise · ohne Beef, aber Album statt Single ·
 *               diss-isoliert · sieg-farm).
 */
const NUR = (process.argv.find((a) => a.startsWith('--nur=')) ?? '').slice('--nur='.length) || null;
/**
 * `--diss-aufmerk=<N>`: `DISS_AUFMERK` (Stück 5b, Standard 1,5) für diesen Lauf
 * überschreiben. Der Plan zu 5b sieht vor, den Wert zu senken, falls die
 * Beef-Spielweise über +25 % einbringt – mit diesem Schalter ist die
 * Gegenmessung eine Kommandozeile und keine Änderung an der Datendatei, und
 * beide Läufe stehen mit ihrem Aufruf im Messbericht. `src/beef.js` liest den
 * Wert bei jedem Aufruf aus dem Datenmodul, also greift das Überschreiben.
 */
const DISS_AUFMERK_ARG = process.argv.find((a) => a.startsWith('--diss-aufmerk=')) ?? null;
const DISS_AUFMERK = DISS_AUFMERK_ARG === null ? null : Number(DISS_AUFMERK_ARG.slice('--diss-aufmerk='.length));
const de = (n) => Math.round(n).toLocaleString('de-DE');
// 0 ist ausdrücklich erlaubt: `aufmerksamkeit` ist dann konstant 1,0 – die
// Gegenprobe, ob der Faktor überhaupt der Hebel ist.
if (DISS_AUFMERK !== null && Number.isFinite(DISS_AUFMERK) && DISS_AUFMERK >= 0) beefData.DISS_AUFMERK = DISS_AUFMERK;

/*
 * `--diss-spike=<N>`, `--diss-growth=<N>`, `--bonus-sieg=<N>`,
 * `--bonus-niederlage=<N>`, `--bonus-tage=<N>`, `--anzaehl-chance=<N>`:
 * dieselbe Bauweise wie `--diss-aufmerk` oben, für die sechs Zahlen, an denen
 * das Balancing von 5b/5c/5e hängt. `spike` und `growth` des Disstracks stehen
 * in `src/data/music.js`, die drei `BONUS_*` und `ANZAEHL_CHANCE` in
 * `src/data/beef.js`; `src/music.js` liest den Typ bei jeder Veröffentlichung
 * über `release('diss')` aus demselben Objekt, `src/beef.js` die Bonuszahlen
 * bei jedem Aufruf und `ANZAEHL_CHANCE` in `anzaehlen` vor dem ersten Wurf
 * (`src/beef.js`, `if (random() >= data.ANZAEHL_CHANCE) return null;`) aus dem
 * Datenmodul – beides greift also.
 *
 * Wozu: Die SUCHE nach einer Einstellung braucht viele Läufe, und jeder Lauf
 * soll mit seiner Kommandozeile im Messbericht stehen statt mit „vorher war die
 * Datei anders". Die ENDMESSUNG läuft ohne jeden dieser Schalter, damit die
 * veröffentlichten Zahlen aus den Konstanten selbst kommen; die Kopfzeile jedes
 * Laufs druckt alle sechs Werte mit, deshalb ist in der Rohausgabe zu sehen,
 * welcher Lauf welche hatte.
 */
function zahlArg(name) {
  const a = process.argv.find((x) => x.startsWith(`--${name}=`)) ?? null;
  if (a === null) return null;
  const n = Number(a.slice(name.length + 3));
  return Number.isFinite(n) ? n : null;
}
const DISS_SPIKE = zahlArg('diss-spike');
const DISS_GROWTH = zahlArg('diss-growth');
const BONUS_SIEG_ARG = zahlArg('bonus-sieg');
const BONUS_NIEDERLAGE_ARG = zahlArg('bonus-niederlage');
const BONUS_TAGE_ARG = zahlArg('bonus-tage');
const ANZAEHL_CHANCE_ARG = zahlArg('anzaehl-chance');
{
  // Der Disstrack ist dasselbe Objekt, das `music.release('diss')` zurückgibt.
  const diss = musicData.RELEASES.find((r) => r.id === 'diss');
  if (DISS_SPIKE !== null && DISS_SPIKE > 0) diss.spike = DISS_SPIKE;
  if (DISS_GROWTH !== null && DISS_GROWTH > 0) diss.growth = DISS_GROWTH;
  if (BONUS_SIEG_ARG !== null && BONUS_SIEG_ARG > 0) beefData.BONUS_SIEG = BONUS_SIEG_ARG;
  if (BONUS_NIEDERLAGE_ARG !== null && BONUS_NIEDERLAGE_ARG > 0) beefData.BONUS_NIEDERLAGE = BONUS_NIEDERLAGE_ARG;
  if (BONUS_TAGE_ARG !== null && BONUS_TAGE_ARG >= 0) beefData.BONUS_TAGE = BONUS_TAGE_ARG;
  // 0 ist ausdrücklich erlaubt (dann zählt niemand von selbst an – die
  // Gegenprobe), 1 ebenfalls (jede Chart-Platzierung zieht einen Feind).
  if (ANZAEHL_CHANCE_ARG !== null && ANZAEHL_CHANCE_ARG >= 0 && ANZAEHL_CHANCE_ARG <= 1) {
    beefData.ANZAEHL_CHANCE = ANZAEHL_CHANCE_ARG;
  }
}

/**
 * Die Stellräder des Angebotslaufs (Stück 5c) – dieselbe Bauart wie die des
 * Beeflaufs darüber und aus demselben Grund: Der Auslöser „über +25 % gepaart"
 * verlangt, dass eine Konstante gesenkt und NEU GEMESSEN wird. Über die
 * Kommandozeile bleibt die Gegenmessung ein Aufruf und keine Änderung an
 * `src/data/angebote.js`, und die Kopfzeile jedes Laufs druckt alle Werte mit.
 *
 *   --honorar-k=N          HONORAR_K (Standard 3)
 *   --vorgruppe-anteil=N   VORGRUPPE_ANTEIL (Standard 0,05)
 *   --kollabo-stunden=N    KOLLABO_STUNDEN (Standard 18)
 *   --tour-stunden=N       TOUR_STUNDEN (Standard 24)
 *   --label-vorschuss=N    LABEL.advanceDays (Standard 10)
 *   --label-cut=N          LABEL.cut (Standard 0,30)
 *   --tour-konzerte=N      TOUR_KONZERTE (Standard 5)
 *   --anfrage-chance=N     ANFRAGE_CHANCE (Standard 0,18 je Tageswurf)
 *   --druecke=N            Drücke auf „daran arbeiten" je Tag (Standard 2 = 4 h)
 *
 * Die letzten zwei standen NICHT in der Liste des Plans. Sie sind dazugekommen,
 * weil die Zerlegung (siehe `ANGEBOT_ANNAHME`) gezeigt hat, dass die vier Hebel
 * des Plans den Auslöser nicht erreichen: `VORGRUPPE_ANTEIL` auf 0 ändert
 * gemessen NICHTS (+47,1 % gepaart, auf die Stelle derselbe Wert wie mit 0,05),
 * `TOUR_STUNDEN` 24 → 40 macht es SCHLECHTER (+57,4 %), und `HONORAR_K` und
 * `KOLLABO_STUNDEN` hängen an Wegen, die zusammen 207 von 134.747 am Tag
 * ausmachen. Damit die Entscheidung über eine Konstante eine Messung bleibt und
 * keine Vermutung, sind die zwei Kandidaten messbar, die die Zerlegung benennt.
 */
const HONORAR_K_ARG = zahlArg('honorar-k');
const VORGRUPPE_ANTEIL_ARG = zahlArg('vorgruppe-anteil');
const KOLLABO_STUNDEN_ARG = zahlArg('kollabo-stunden');
const TOUR_STUNDEN_ARG = zahlArg('tour-stunden');
const LABEL_VORSCHUSS_ARG = zahlArg('label-vorschuss');
const LABEL_CUT_ARG = zahlArg('label-cut');
const TOUR_KONZERTE_ARG = zahlArg('tour-konzerte');
const ANFRAGE_CHANCE_ARG = zahlArg('anfrage-chance');
{
  if (TOUR_KONZERTE_ARG !== null && TOUR_KONZERTE_ARG >= 1) {
    angeboteData.TOUR_KONZERTE = Math.round(TOUR_KONZERTE_ARG);
  }
  if (ANFRAGE_CHANCE_ARG !== null && ANFRAGE_CHANCE_ARG >= 0 && ANFRAGE_CHANCE_ARG <= 1) {
    angeboteData.ANFRAGE_CHANCE = ANFRAGE_CHANCE_ARG;
  }
  if (HONORAR_K_ARG !== null && HONORAR_K_ARG >= 0) angeboteData.HONORAR_K = HONORAR_K_ARG;
  if (VORGRUPPE_ANTEIL_ARG !== null && VORGRUPPE_ANTEIL_ARG >= 0) {
    angeboteData.VORGRUPPE_ANTEIL = VORGRUPPE_ANTEIL_ARG;
  }
  if (KOLLABO_STUNDEN_ARG !== null && KOLLABO_STUNDEN_ARG > 0) {
    angeboteData.KOLLABO_STUNDEN = KOLLABO_STUNDEN_ARG;
  }
  if (TOUR_STUNDEN_ARG !== null && TOUR_STUNDEN_ARG > 0) angeboteData.TOUR_STUNDEN = TOUR_STUNDEN_ARG;
  // 0 ist erlaubt: ein Vertrag ohne Vorschuss ist die Gegenprobe zu der Frage,
  // ob der Vorschuss allein den Unterschied macht.
  if (LABEL_VORSCHUSS_ARG !== null && LABEL_VORSCHUSS_ARG >= 0) {
    musicData.LABEL.advanceDays = LABEL_VORSCHUSS_ARG;
  }
  if (LABEL_CUT_ARG !== null && LABEL_CUT_ARG >= 0 && LABEL_CUT_ARG < 1) {
    musicData.LABEL.cut = LABEL_CUT_ARG;
  }
}
/** Drücke auf „daran arbeiten" je Tag – siehe `angebotetag`. */
const ANGEBOT_DRUECKE = Math.max(1, Math.round(zahlArg('druecke') ?? 2));

// ------------------------------------------------------------------ Würfel

/** Derselbe Generator wie in den Tests des Projekts – gleicher Seed, gleicher Lauf. */
function rng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// ------------------------------------------------------------- Statistik

/** Quantil einer Zahlenreihe (0,5 = Median). */
function quantil(werte, q) {
  if (!werte.length) return 0;
  const s = [...werte].sort((a, b) => a - b);
  const i = (s.length - 1) * q;
  const lo = Math.floor(i);
  const hi = Math.ceil(i);
  return lo === hi ? s[lo] : s[lo] + (s[hi] - s[lo]) * (i - lo);
}

const median = (w) => quantil(w, 0.5);

// -------------------------------------------------------------- Aufbau

/** Geld wird nicht gebucht, sondern gezählt – nach Quelle getrennt. */
const konto = {};
const quellen = {};
unb.getBalance = async () => ({ cash: 500_000_000, bank: 0, total: 500_000_000 });
unb.changeCash = async (g, u, betrag, grund) => {
  konto[u] = (konto[u] ?? 0) + betrag;
  const k = String(grund ?? '?').split(':')[0].trim();
  (quellen[u] ??= {})[k] = (quellen[u][k] ?? 0) + betrag;
  return { cash: 0, bank: 0, total: 0 };
};
// Gründung und Einzahlung ziehen notfalls von der Bank – hier reicht das Bargeld immer.
unb.withdrawFromBank = async () => ({ cash: 0, bank: 0, total: 0 });

/** Eine Welt je Lauf, damit sich Läufe nicht gegenseitig sehen. */
function welt(n) {
  return `MESS_${process.pid}_${n}`;
}

/**
 * Sorgt dafür, dass die Ausrüstung DA IST – auch nach einem Defekt.
 *
 * Zwei Dinge, an denen ein Lauf gescheitert ist:
 *
 *  - Ausrüstung geht im Spiel kaputt (`BREAK_CHANCE` in creator.js). Wer nicht
 *    nachkauft, wird stillschweigend handlungsunfähig und verdient ab da
 *    nichts mehr – ohne dass irgendetwas nach einem Fehler aussieht. Die Tests
 *    des Projekts kaufen aus demselben Grund nach (`refill`).
 *  - Der Gegenstand darf je Welt nur EINMAL angelegt werden (eindeutiger
 *    Index über Welt und Name). Deshalb wird die Kennung gemerkt und beim
 *    Nachkaufen wiederverwendet.
 */
const gegenstaende = new Map();       // "welt|name" -> item.id

function ausruesten(G, U) {
  const namen = new Set([music.GEAR]);
  for (const p of creator.PLATFORMS) {
    const g = gearData.findGear(p.gear);
    if (g) namen.add(g.name);
  }
  for (const name of namen) {
    if (db.ownsNamed(G, U, name)) continue;
    const key = `${G}|${name}`;
    let id = gegenstaende.get(key);
    if (id === undefined) {
      id = db.createItem({
        guildId: G, name, price: 1, kind: 'gear', stock: null, createdBy: 'mess',
      }).id;
      gegenstaende.set(key, id);
    }
    db.reservePurchase(G, U, id, 1);
  }
}

// ------------------------------------------------------------ Strategien

/**
 * Alle Kombinationen aus Plattform und Format, mit Zeitkosten.
 *
 * `money` ist der Ertragsfaktor des Formats, `time` die Zeitkosten der
 * Plattform. Das Verhältnis ist der Anhaltspunkt für „was lohnt sich" – die
 * Wahrheit misst der Lauf, nicht diese Zahl.
 */
function alleKombis() {
  const out = [];
  for (const p of creator.PLATFORMS) {
    for (const f of creator.formats(p.id) ?? []) {
      out.push({
        p: p.id, f: f.id, time: p.time ?? 1,
        money: f.money ?? 0, follow: f.follow ?? 1, reach: f.reach ?? 1,
        // Bindung baut Community auf, an der Merch haengt (siehe creator.js).
        bindung: (p.community ?? 0) * (f.community ?? 1),
      });
    }
  }
  return out;
}

/**
 * Die Strategien, gegen die jeder Archetyp antritt. Gewertet wird die beste –
 * gemessen werden soll das Spiel, nicht die Fantasie des Skripts.
 */
function strategien(musik = false) {
  const k = alleKombis();
  const nachGeld = [...k].sort((a, b) => (b.money / b.time) - (a.money / a.time));
  const nachReichweite = [...k].sort((a, b) => (b.reach / b.time) - (a.reach / a.time));
  const nachFollowern = [...k].sort((a, b) => (b.follow / b.time) - (a.follow / a.time));

  /*
   * Bindungsaufbau nach ERTRAG je Zeiteinheit, nicht nach Reihenfolge im
   * Datensatz. `twitter/community` bringt 2,42 je Zeiteinheit,
   * `twitter/ankuendigung` nur 0,66 – ein Probelauf nahm blind den zweiten
   * und blieb damit bei einem Gleichgewicht von 8 statt 30 von 100. Merch
   * hängt direkt daran, und Merch ist der größte Posten des reinen Creators.
   */
  const nachBindung = [...k].sort((a, b) => (b.bindung / b.time) - (a.bindung / a.time));

  const basis = [
    { name: 'Ertrag je Zeit', reihe: nachGeld },
    { name: 'Reichweite zuerst', reihe: nachReichweite },
    { name: 'Follower zuerst', reihe: nachFollowern },
    { name: 'Reichweite, dann Ertrag', reihe: [...nachReichweite.slice(0, 3), ...nachGeld] },
  ];

  // Wie viel Zeit am Tag in die Bindung geht: gar nichts, wenig, viel.
  const out = [];
  for (const b of basis) {
    for (const bindung of [0, 1, 3]) {
      // Die Konzert-Entscheidung gibt es nur fuer die Musikseite; fuer den
      // reinen Creator wuerde sie den Suchraum nur verdoppeln.
      for (const konzert of (musik ? [false, true] : [false])) {
        out.push({
          ...b,
          name: `${b.name} +${bindung}B${konzert ? ' +K' : ''}`,
          bindung, konzert,
          bindungsreihe: nachBindung,
        });
      }
    }
  }
  return out;
}

/**
 * Ein Kanaltag: so lange Aktionen fahren, bis die Zeit alle ist – oder die
 * Energie an der Wand steht, oder der Deckel `stunden` (`--stunden=N`) voll ist.
 *
 * `community: true` setzt zuerst einen Tweet – Twitter verdient nichts, hält
 * aber die Community, an der Merch hängt. Genau diese Abwägung war in der
 * ersten Messung nie getroffen worden.
 *
 * Die Uhr rückt im Tag vor: Jede Plattform hat eine eigene Sperre (YouTube
 * 180 Minuten). Wer nur eine Minute je Aktion weiterzählt, kommt an einem
 * 24-h-Tag nie über eine Aktion je Plattform hinaus – dann misst man die
 * Sperren, nicht den Tag. Ist nichts frei, springt die Uhr zur nächsten
 * freien Plattform; spätestens ~22:40 ist Schluss.
 */
async function kanaltag(G, U, strat, now, rand, stunden = STUNDEN) {
  let t = 0;                                   // Minuten seit `now` – wird zurückgegeben
  const ENDE = 15 * 60;                        // spätestens ~22:40 ist Schluss
  /** Was heute noch geht: Zeit, Deckel und Wand – null, wenn Schluss ist. */
  const frei = () => {
    const b = creator.budget(G, U, now + t * 60_000);
    const zeit = Math.min(b.left, stunden - b.used);
    return zeit <= 0 || b.readyAt ? null : zeit;
  };
  for (let b = 0; b < (strat.bindung ?? 0); b++) {
    for (const c of strat.bindungsreihe) {
      if (c.bindung <= 0) break;               // ohne Bindung bringt es hier nichts
      /*
       * Auch hier gilt der Deckel: Ist Twitter gesperrt, steht als Nächstes
       * ein Stream (2 h) oder ein Video (3 h) in der Bindungsreihe – ohne
       * diese Prüfung kam ein „8-h-Tag" auf 11 Stunden (Handprüfung).
       */
      const zeit = frei();
      if (zeit === null) return t;
      if (c.time > zeit) continue;
      if (creator.remainingMs(G, U, c.p, now + t * 60_000) > 0) continue;
      const r = await creator.act(G, U, c.p, c.f, now + (t++) * 60_000, rand);
      if (r.ok) break;
      if (r.reason === 'exhausted') return t;
    }
  }
  for (let i = 0; i < 60; i++) {
    /*
     * VORHER fragen statt hinterher absagen lassen: `remainingMs` und
     * `budget` sind billige Abfragen, `act` ist es nicht (gemessen 93 %
     * Ausschuss, als jede Aktion die ganze Formatliste neu durchprobierte).
     */
    const zeit = frei();
    if (zeit === null) return t;               // Zeit alle oder an der Wand

    let gemacht = false;
    let warten = Infinity;
    for (const c of strat.reihe) {
      if (c.time > zeit) continue;
      const rest = creator.remainingMs(G, U, c.p, now + t * 60_000);
      if (rest > 0) { warten = Math.min(warten, rest); continue; }
      const r = await creator.act(G, U, c.p, c.f, now + (t++) * 60_000, rand);
      if (r.ok) { gemacht = true; break; }
      if (r.reason === 'exhausted') return t;
    }
    if (gemacht) continue;
    // Nichts frei: die Uhr bis zur nächsten freien Plattform vorstellen.
    if (!Number.isFinite(warten)) return t;
    t += Math.ceil(warten / 60_000) + 1;
    if (t > ENDE) return t;
  }
  return t;
}

/**
 * Ein Musiktag: Songs sammeln, dann veröffentlichen.
 *
 * `konzertZuerst` ist die Entscheidung, die ein früherer Lauf nie getroffen
 * hat: Studio (3) + Release (2) + Konzert (4) sind 9 von 8 Zeiteinheiten. Wer
 * immer ins Studio geht, spielt NIE ein Konzert – obwohl eines bei 194.661
 * Hörern 54.245 zahlt gegen 27.610 Tantiemen am Tag. An Konzerttagen bleibt
 * das Studio deshalb zu.
 *
 * `horten` und `beefTag` gehören zum Beeflauf (Stück 5b) und sind unten an
 * ihrer Stelle erklärt: die Veröffentlichungspolitik („Album statt täglicher
 * Single") und der Beefschritt zwischen Studio und Veröffentlichung.
 */
function musiktag(G, U, now, rand, konzertZuerst = false, horten = false, beefTag = null) {
  if (konzertZuerst) {
    const vor = music.status(G, U, now);
    if (vor.showMs <= 0 && vor.listeners >= music.SHOW_MIN_LISTENERS) {
      // Auch am Konzerttag wird gestritten: Die zwei Stunden des Beefs kommen
      // aus demselben Budget, aber nicht aus dem Studio, das heute zu bleibt.
      if (beefTag) beefTag(now + 1e5);
      return music.status(G, U, now + 2e5);
    }
  }
  music.record(G, U, now, rand, musikOpts);
  /*
   * Der Beeftag steht ZWISCHEN Studio und Veröffentlichung, und das ist keine
   * Feinheit, sondern die gemessene Spielweise: „Disstrack, sobald ein Titel da
   * und die Veröffentlichungssperre durch ist". Stand er davor, sah er nur den
   * Titel von gestern – und weil die Veröffentlichung von gestern den
   * aufgebraucht hat, kam er fast nie dazu (gemessen 0,18 Disstracks am Tag
   * statt 0,8). Hier nimmt der Disstrack den Veröffentlichungsplatz des Tages,
   * den sonst Single, EP oder Album gehabt hätte; genau darin sitzt sein Preis.
   */
  if (beefTag) beefTag(now + 1.4e6);
  const s = music.status(G, U, now + 1.5e6);
  if (s.songs >= 1 && s.releaseMs <= 0) {
    /*
     * `horten`: warten, bis sechs Titel liegen, und dann ein Album – statt
     * jeden Tag die Single, die gerade fertig ist.
     *
     * Das ist keine Spielerei, sondern die Vergleichsgrundlage des Beeflaufs
     * (Stück 5b). Der Buzz einer Veröffentlichung wächst mit `spike` ZWEIMAL
     * (`audience` trägt ihn einmal, `buzz = audience × 9 × spike` ein zweites
     * Mal), und Buzz wird zum selben Satz je Abruf bezahlt wie die stetigen
     * Hörer. Je aufgenommenem Titel heißt das: Single 1,0² = 1,00, EP
     * 2,6²/3 = 2,25, Album 5,5²/6 = 5,04 – und Disstrack 3,0²/1 = 9,00.
     * Gegen den täglichen Single-Griff sieht deshalb JEDE hohe `spike`-Art gut
     * aus, auch ohne jeden Beef. Ohne diese Variante wäre die gemessene
     * Beef-Differenz zum Teil nur der Abstand zu einer schwachen Spielweise –
     * und ein Balancing gegen schlechtes Spiel wäre wertlos (siehe Kopf).
     */
    /*
     * `horten` darf auch eine FUNKTION sein (Stück 5c, Angebotslauf): Dann wird
     * gehortet wie bei `true`, aber die sechs Titel bleiben liegen, solange die
     * Funktion das sagt – weil ein Kollabo-Album offen ist, das genau diese
     * sechs Titel braucht (`KOLLABO_TITEL`). Ohne diese Zurückhaltung griffe
     * das normale Album bei sechs Titeln zuerst, das Kollabo fände danach nie
     * sechs vor, und die Variante „Kollabo bei gleicher
     * Veröffentlichungspolitik" wäre nicht messbar. Für `true` und `false`
     * bleibt diese Zeile Wort für Wort die des Beeflaufs.
     */
    const hortet = horten === true || typeof horten === 'function';
    const zurueck = typeof horten === 'function' && horten();
    const art = hortet
      ? (s.songs >= 6 && !zurueck ? 'album' : null)
      : (s.songs >= 6 ? 'album' : s.songs >= 3 ? 'ep' : 'single');
    if (art) music.publish(G, U, art, now + 2e6, rand, musikOpts);
  }
  return music.status(G, U, now + 3e6);
}

// ------------------------------------------------------- Kontakte (5a)

/**
 * ===========================================================================
 *  KONTAKTPFLEGE ALS SPIELWEISE
 * ===========================================================================
 *
 * Gemessen wird eine einzige Frage: Was bringen die Kontakte (Stück 5a), wenn
 * ein Spieler jeden Tag zwei Stunden hineinsteckt – statt in eine Aktion?
 *
 * Damit die Differenz die Kontakte misst und nichts sonst:
 *
 *  • Alle Varianten fahren DIESELBE Strategie (einmal gesucht, dann fest) und
 *    denselben Würfel `rng(1000 + i)` für Musik, Kanäle, Ereignisse, Vorfälle.
 *  • Die Kontaktwürfe laufen über einen ZWEITEN Würfel (`rng(seed + 500_000)`).
 *    Sonst verschöbe jeder Kontaktwurf den Hauptstrom, und die Differenz wäre
 *    zur Hälfte ein anderer Würfel. (Dass ein Schub die Folgetage verändert
 *    und damit auch dort andere Zahlen aus demselben Strom zieht, lässt sich
 *    nicht vermeiden – dafür gibt es mehrere Läufe und den Median.)
 *  • Jede Variante bekommt eigene Welten, damit nichts hinüberleckt.
 *
 * Gezählt wird über eine Hülle um `contacts.consumeBoost`: nur ein Schub, der
 * wirklich verbraucht wurde, zählt als Wirkung. Ein Schub, der verfällt, ist
 * keine.
 */

/** Zähler des laufenden Kontaktlaufs – `null`, solange nicht gemessen wird. */
let kz = null;

function neuerZaehler({ beziehung = false } = {}) {
  return {
    /*
     * Die Beziehungszähler (Task 7): nur dort, wo ein Aufrufer sie ausdrücklich
     * bestellt (`kontaktvariante`, `angebotvariante`). Sie lesen jeden Tag die
     * ganze Kontaktliste und kosten Zeit, die die übrigen Abschnitte nicht
     * brauchen. `null` heißt: nicht gemessen – kein Ergebnis, keine Null.
     */
    beziehung: beziehung ? neuerBeziehungsZaehler() : null,
    versuche: 0,
    antworten: { zusage: 0, echt: 0, fluechtig: 0, ignoriert: 0 },
    abgelehnt: {},                  // Grund -> Anzahl (keine Zeit, Wand, …)
    nichts: 0,                      // Tage ohne wählbaren Kontakt
    // Ein Ja versucht immer, einen Schub zu setzen; geschrieben wird er nur,
    // wenn kein stärkerer derselben Art noch läuft (`db.setBoost` gibt `neu`).
    schubVersuche: 0,               // Antworten, die einen Schub setzen WOLLTEN
    gesetzt: 0,                     // davon wirklich geschrieben (neu === true)
    verbraucht: { release: [], creator: [], show: [] },
    konzertCreator: [],             // Faktoren der Konzert-Schübe auf der Creator-Seite
    // Verbrauchte Schübe je Art – "kind/anfrage" -> Faktoren. Erst damit lässt
    // sich das Creator-Konzert mit dem vergleichen, was auf DERSELBEN Seite
    // aus einer Reaktion oder einem Feature wird (gleiche Größe, gleiche Art).
    verbrauchtJeArt: {},
    proAnfrage: {},                 // "seite/anfrage" -> { versuche, zusage, echt, fluechtig, ignoriert }
    publishes: 0, shows: 0, akte: 0,
  };
}

/** Die zehn Beziehungsarten, in der Reihenfolge von `contacts.artOf` (die erste passende gewinnt). */
const BEZIEHUNGSARTEN = ['beef', 'rivale', 'verstimmt', 'mentor', 'schuetzling', 'partner',
  'band', 'geschaeftlich', 'bekannt', 'fremd'];

/**
 * Die Beziehungszähler eines Messlaufs – eine Zeile je Konto, nicht je Tag.
 *
 *  • `arten`: je Art, in wie vielen Konten sie im Messjahr bei MINDESTENS EINEM
 *    Kontakt auftrat (`konten`), bei wie vielen (Konto, Kontakt)-Paaren überhaupt
 *    je (`paare`) und wie viele Kontakte sie am Laufende hatten (`ende`).
 *    Eine Art mit null Vorkommen ist ein Befund, keine Randnotiz.
 *  • Vertrauen: je Konto der höchste und der tiefste Stand über alle Kontakte
 *    mit Datenbankzeile (wer nie angeschrieben wurde, steht bei 0 und zählt
 *    nicht als „tiefster") und die Tage mit mindestens einem Kontakt unter 0.
 *  • `tageEinbruch`: Tage, an denen ein Kontakt unter Vertrauen 0 liegt, der
 *    schon einmal Vertrauen >= 50 hatte - der Rückschlag einer GUTEN Beziehung
 *    (Brief 5b). Die rohe Zahl `tageUnterNull` sättigt, sobald Beef läuft, und
 *    steht nur zur Einordnung daneben.
 *  • `drahtMax` steht daneben, damit der Vergleich mit dem Draht der alten Welt
 *    (Anteil mit Draht ≥ 50) aus demselben Lauf kommt.
 *  • Projekte: aus `db.projekteOf` am Laufende, nur `kollabo` und `tour`.
 *
 * Gesampelt wird einmal am Tagesende. Ein Stand, der innerhalb eines Tages
 * steigt und wieder fällt, bliebe unsichtbar – bei Wochen-Abkühlung und einer
 * Bewegung je Kontakt und Tag kommt das praktisch nicht vor, ist aber die
 * Grenze der Zahl.
 */
function neuerBeziehungsZaehler() {
  return {
    konten: 0,
    arten: Object.fromEntries(BEZIEHUNGSARTEN.map((a) => [a, { konten: 0, paare: 0, ende: 0 }])),
    vertrauenMax: [], vertrauenMin: [], tageUnterNull: [], tageEinbruch: [], drahtMax: [],
    partnerJemals: 0,            // Konten, die an irgendeinem Tag einen Partner hatten
    ohneKontakt: 0,              // Konten ohne eine einzige Kontaktzeile (kein Max/Min)
    projekte: {
      kollabo: { fertig: 0, verfallen: 0, offen: 0 },
      tour: { fertig: 0, verfallen: 0, offen: 0 },
    },
  };
}

/** Der Tageszustand EINES Kontos, solange der Lauf geht. */
function neuerBeziehungsStand() {
  return {
    max: -Infinity, min: Infinity, drahtMax: -Infinity, tageUnterNull: 0, partner: false,
    war50: new Set(),          // Kontakte, die irgendwann Vertrauen >= 50 hatten
    tageEinbruch: 0,           // Tage mit einem solchen Kontakt unter Vertrauen 0
    jemals: Object.fromEntries(BEZIEHUNGSARTEN.map((a) => [a, new Set()])),
    ende: null,
  };
}

/**
 * Ein Tag Beziehungsbefund. Liest nur: `contacts.listFor` ist dieselbe Funktion
 * wie die Ansicht des Spielers, `achsenJetzt` rechnet das Abkühlen beim Lesen.
 * Es wird nichts geschrieben und nichts gewürfelt.
 */
function beziehungsTag(st, G, U, now) {
  const liste = contacts.listFor(G, U, { now });
  const heute = {};
  for (const e of liste) {
    heute[e.art] = (heute[e.art] ?? 0) + 1;
    st.jemals[e.art]?.add(e.contact.id);
    if (e.partner) st.partner = true;
  }
  st.ende = heute;
  // Vertrauen und Draht nur über Kontakte, die es in der Datenbank wirklich gibt.
  let unterNull = false;
  let einbruch = false;
  for (const z of db.contactsOf(G, U)) {
    const a = contacts.achsenJetzt(z, now);
    if (a.vertrauen >= 50) st.war50.add(z.contact_id);
    if (a.vertrauen < 0 && st.war50.has(z.contact_id)) einbruch = true;
    if (a.vertrauen > st.max) st.max = a.vertrauen;
    if (a.vertrauen < st.min) st.min = a.vertrauen;
    if (a.draht > st.drahtMax) st.drahtMax = a.draht;
    if (a.vertrauen < 0) unterNull = true;
  }
  if (unterNull) st.tageUnterNull++;
  if (einbruch) st.tageEinbruch++;
}

/** Am Laufende: den Tagesstand des Kontos und die Projekte in den Zähler übernehmen. */
function beziehungsEnde(bz2, st, G, U) {
  bz2.konten++;
  for (const a of BEZIEHUNGSARTEN) {
    bz2.arten[a].konten += st.jemals[a].size > 0 ? 1 : 0;
    bz2.arten[a].paare += st.jemals[a].size;
    bz2.arten[a].ende += st.ende?.[a] ?? 0;
  }
  if (st.max === -Infinity) bz2.ohneKontakt++;
  else {
    bz2.vertrauenMax.push(st.max);
    bz2.vertrauenMin.push(st.min);
    bz2.drahtMax.push(st.drahtMax);
  }
  bz2.tageUnterNull.push(st.tageUnterNull);
  bz2.tageEinbruch.push(st.tageEinbruch);
  if (st.partner) bz2.partnerJemals++;
  for (const p of db.projekteOf(G, U)) {
    const z = bz2.projekte[p.art];
    if (!z) continue;
    if (p.status === 'fertig') z.fertig++;
    else if (p.status === 'verfallen') z.verfallen++;
    else z.offen++;
  }
}

/** Die Ausgabezeilen der Beziehungszähler – vollständig, auch die Nullen. */
function beziehungsZeilen(bz2, { projekteMoeglich = true } = {}) {
  const out = [];
  const n = bz2.konten;
  const anteil = (k) => (n ? `${komma((k / n) * 100, 1)} %` : '–');
  const liste = (a) => [...a].sort((x, y) => x - y).join(' ');
  const med = (a) => (a.length ? komma(median(a), 1) : '–');
  const vm = bz2.vertrauenMax;
  const ab50 = vm.filter((v) => v >= 50).length;
  const draht50 = bz2.drahtMax.filter((v) => v >= 50).length;
  out.push(`Beziehungsarten im Messjahr (${n} Konten; Konten mit Art bei mindestens einem Kontakt · ` +
    `(Konto, Kontakt)-Paare insgesamt · Kontakte am Laufende):`);
  for (const a of BEZIEHUNGSARTEN) {
    const z = bz2.arten[a];
    out.push(`    ${a.padEnd(14)} ${String(z.konten).padStart(4)} Konten · ${String(z.paare).padStart(6)} Paare · ` +
      `${String(z.ende).padStart(6)} am Ende${z.paare === 0 ? '   ← NULL VORKOMMEN (Befund)' : ''}`);
  }
  out.push(`Vertrauen: Anteil der Konten mit mindestens einem Kontakt ≥ 50: ${anteil(ab50)} ` +
    `(${ab50} von ${n}${bz2.ohneKontakt ? `, ${bz2.ohneKontakt} Konten ohne eine einzige Kontaktzeile` : ''})`);
  out.push(`           (zum Vergleich im selben Lauf, Draht ≥ 50 bei mindestens einem Kontakt: ` +
    `${anteil(draht50)}; mit Partnerstatus an irgendeinem Tag: ${anteil(bz2.partnerJemals)})`);
  out.push(`           höchstes Vertrauen je Konto: Median ${med(vm)} · sortiert: ${liste(vm) || '–'}`);
  out.push(`           tiefstes Vertrauen je Konto: Median ${med(bz2.vertrauenMin)} · sortiert: ${liste(bz2.vertrauenMin) || '–'}`);
  out.push(`           Tage mit mindestens einem Kontakt unter Vertrauen 0: Median ${med(bz2.tageUnterNull)}, ` +
    `Mittel ${komma(mittel(bz2.tageUnterNull), 1)}, größter ${bz2.tageUnterNull.length ? Math.max(...bz2.tageUnterNull) : '–'} · ` +
    `Konten mit mindestens einem solchen Tag: ${bz2.tageUnterNull.filter((t) => t > 0).length} von ${n} · ` +
    `sortiert: ${liste(bz2.tageUnterNull) || '–'}`);
  const eb = bz2.tageEinbruch;
  out.push(`           Tage mit einem Kontakt unter Vertrauen 0, der schon einmal Vertrauen ≥ 50 hatte (der Einbruch ` +
    `einer guten Beziehung, Brief 5b): Median ${med(eb)}, Mittel ${komma(mittel(eb), 1)}, ` +
    `größter ${eb.length ? Math.max(...eb) : '–'} · Konten mit mindestens einem solchen Tag: ` +
    `${eb.filter((t) => t > 0).length} von ${n} · sortiert: ${liste(eb) || '–'}`);
  const pk = bz2.projekte.kollabo;
  const pt = bz2.projekte.tour;
  const fertig = pk.fertig + pt.fertig;
  const verfallen = pk.verfallen + pt.verfallen;
  out.push(`Projekte:  ${fertig} abgeschlossen, ${verfallen} verfallen (kollabo ${pk.fertig}/${pk.verfallen}, ` +
    `tour ${pt.fertig}/${pt.verfallen}; am Laufende noch offen ${pk.offen + pt.offen})` +
    (projekteMoeglich
      ? (fertig === 0 ? '   ← NULL ABGESCHLOSSEN = FEHLSCHLAG, kein Ergebnis' : '')
      : '   (hier entstehen keine Projekte – es laufen keine Gegenanfragen, oder die Spielweise nimmt keine ' +
        'an –, 0 ist erwartet und kein Fehlschlag)'));
  return out;
}

/*
 * Die Hüllen. Sie zählen nur, wenn `kz` gesetzt ist, und geben unverändert
 * weiter – die gemessene Welt bleibt die echte.
 */
const echtConsume = contacts.consumeBoost;
contacts.consumeBoost = (g, u, kind, now) => {
  const b = echtConsume(g, u, kind, now);
  if (kz && b) {
    (kz.verbraucht[kind] ??= []).push(b.factor);
    (kz.verbrauchtJeArt[`${kind}/${b.requestId}`] ??= []).push(b.factor);
    if (kind === 'creator' && b.requestId === 'konzert') kz.konzertCreator.push(b.factor);
  }
  return b;
};
const echtPublish = music.publish;
music.publish = (...a) => {
  const r = echtPublish(...a);
  if (kz && r?.ok) kz.publishes++;
  return r;
};
const echtShow = music.show;
music.show = async (...a) => {
  const r = await echtShow(...a);
  if (kz && r?.ok) kz.shows++;
  return r;
};
const echtAct = creator.act;
creator.act = async (...a) => {
  const r = await echtAct(...a);
  if (kz && r?.ok) kz.akte++;
  return r;
};

/**
 * Was ein Ja bei dieser Anfrage wert wäre – als „Faktor über 1" auf die
 * nächste Aktion, damit sich die vier Anfragearten vergleichen lassen.
 *
 * `reaktion`/`shoutout` 1 + 3 × Stärke, `feature` 1 + 5 × Stärke; das Konzert
 * bringt auf der Musikseite keine Faktoren, sondern Hörer für EINE Gage
 * (gedeckelt auf die eigene Hörerschaft, also höchstens ×2 Publikum).
 *
 * Die Gage wächst aber NICHT linear mit dem Publikum: `music.show` zahlt
 * `(Hörer + Zusatzhörer)^SHOW_EXP` (src/music.js, `SHOW_EXP` = 0,7). Doppeltes
 * Publikum ist deshalb +62 %, nicht +100 % – genau das steht hier. (Die vier
 * Stunden des Konzerts werden nicht gegengerechnet: Der Messlauf spielt jedes
 * mögliche Konzert ohnehin, der Schub hängt sich nur an eines an; sie sind
 * also keine Mehrkosten der Anfrage.)
 *
 * Auf der Creator-Seite schreibt `contacts.request` den Konzert-Schub in
 * dieselbe Formel um, die `boostOf` sonst für `reaktion`/`shoutout` liefert
 * (`min(4, 1 + 3 × Stärke)`, src/contacts.js). Damit hier keine zweite Kopie
 * dieser Formel steht, wird sie aus `boostOf` geholt; ändert sie sich dort,
 * ändert sie sich hier mit.
 */
function nutzenOf(requestId, staerke, seine, meine, seite) {
  const b = contacts.boostOf(requestId, staerke, seine);
  if (b.kind === 'show') {
    if (seite === 'creator') return contacts.boostOf('reaktion', staerke, seine).factor - 1;
    const m = Math.max(1, meine);
    return Math.pow((m + Math.min(b.extra, m)) / m, music.SHOW_EXP) - 1;
  }
  return b.factor - 1;
}

/**
 * Wie die zweite Würfelrunde (`contacts.stufeVon`) im Mittel ausfällt.
 *
 * Die Stufe ist nicht frei wählbar: Wer antwortet, antwortet meistens flüchtig.
 * Wie oft es eine Zusage wird, hängt am Größenverhältnis und am Respekt – und
 * genau daran hing der Denkfehler der ersten Fassung dieser Messung, die für
 * JEDEN Kandidaten mit der Stärke einer Zusage gerechnet hat. Das überschätzt
 * den fernen Weltstar gegenüber dem Kontakt auf Augenhöhe um rund das
 * 1,43-fache (0,500 gegen 0,350 erwarteter Stufenfaktor).
 *
 * Die Gewichte sind dieselben wie in `stufeVon` (src/contacts.js) – die
 * Funktion würfelt, sie gibt ihre Verteilung nicht heraus, deshalb steht sie
 * hier ein zweites Mal. Dass beide übereinstimmen, wird nicht geglaubt,
 * sondern geprüft: `node scripts/messung-geldquellen.js stufenprobe` würfelt
 * `stufeVon` selbst millionenfach und vergleicht.
 *
 * Gewogen wird der RESPEKT, nicht der Draht (das war bis Task 5 ein stiller
 * Unterschied zur Produktion), und gedämpft mit dem Vertrauen – dieselbe
 * Rechnung wie `contacts.respektWirkt`, hier bewusst ausgeschrieben: Ein
 * Nachbau, der die geprüfte Funktion aufruft, prüft nichts mehr.
 */
function stufenVerteilung({ ratio, respekt = 0, vertrauen = 0 }) {
  const naehe = Math.min(1, ratio);
  const wirkt = Math.max(0, respekt) * (1 + Math.min(0, vertrauen / 100));
  const gewichte = {
    fluechtig: 6 * (ratio < 0.05 ? 2 : 1),
    echt: 3,
    zusage: 1 * (1 + 2 * naehe) * (1 + wirkt / 100),
  };
  const summe = gewichte.fluechtig + gewichte.echt + gewichte.zusage;
  return {
    fluechtig: gewichte.fluechtig / summe,
    echt: gewichte.echt / summe,
    zusage: gewichte.zusage / summe,
  };
}

/** Der erwartete Stufenfaktor – Σ p(Stufe) × STUFEN_FAKTOR(Stufe). */
function erwarteterStufenFaktor(arg) {
  const p = stufenVerteilung(arg);
  return Object.entries(p).reduce((s, [stufe, w]) => s + w * contacts.STUFEN_FAKTOR[stufe], 0);
}

/** Welche Reichweite auf dieser Seite zählt – für die Trace-Zeile. */
const seite2reichweite = (seite, ich) => Math.max(100, (seite === 'creator' ? ich.total : ich.listeners) || 0);
const seite2seine = (seite, contact) => (seite === 'creator' ? contact.reachCreator : contact.reach);

/**
 * Ein Kontakttag: zwei Stunden in den besten verfügbaren Kontakt.
 *
 * `vorrang` ist das Messwerkzeug für einen sonst nie gewählten Schub (siehe
 * unten im Rumpf); ohne ihn wählt der Spieler frei.
 *
 * „Bester" heißt: über alle freien Kontakte und alle vier Anfragearten die
 * höchste **Chance × erwarteter Nutzen**. Die Chance kommt aus
 * `contacts.detail`, also aus derselben Funktion, die die Ansicht zeigt – das
 * Skript rechnet sie nicht nach.
 *
 * „Erwarteter Nutzen" heißt: über die drei Antwortstufen gemittelt, mit den
 * Wahrscheinlichkeiten aus `stufeVon` (`stufenVerteilung`). Die erste Fassung
 * dieser Messung hat für jeden Kandidaten mit der Stärke einer ZUSAGE
 * gerechnet – das ist eine Wette, die es so nicht gibt, und sie überschätzt
 * den fernen Weltstar gegenüber dem Kontakt auf Augenhöhe systematisch (bei
 * einem Verhältnis von 0,005 und Respekt 15 ist der erwartete Stufenfaktor
 * 0,350, auf Augenhöhe 0,500). Gemittelt wird über `nutzenOf` selbst, nicht
 * über die Stärke, damit die Decken der Schübe richtig greifen.
 *
 * Vorausgewählt werden die besten acht aus `contacts.listFor`, damit nicht
 * 74 × `detail` je Tag gerechnet werden muss; die Vorauswahl nutzt dieselbe
 * Größe, nur mit der Chance der Leitseite.
 */
function kontakttag(G, U, now, rand, vorrang = null) {
  const sm = music.status(G, U, now);
  const cs = creator.status(G, U, now);
  const beste = cs.platforms.reduce((a, p) => (p.followers > (a?.followers ?? -1) ? p : a), null);
  const ich = {
    musik: sm.started,
    creator: (beste?.followers ?? 0) > 0,
    listeners: sm.listeners,
    total: cs.total,
    language: sm.market.language.id,
    genre: sm.started ? sm.genre.id : null,
    platform: (beste?.followers ?? 0) > 0 ? beste.id : null,
  };

  /** Stärke und erwarteter Nutzen dieser Anfrage – auf der Seite, über die sie liefe. */
  const bewerte = (contact, requestId, respekt = 0, vertrauen = 0) => {
    const seite = contacts.seiteFuer(contact, ich, requestId);
    if (!seite) return null;
    const meine = Math.max(100, (seite === 'creator' ? ich.total : ich.listeners) || 0);
    const seine = seite === 'creator' ? contact.reachCreator : contact.reach;
    const p = contacts.passungOf({
      meine: seite === 'creator'
        ? { language: ich.language, platform: ich.platform }
        : { language: ich.language, genre: ich.genre },
      seine: seite === 'creator'
        ? { language: contact.language, platform: contact.platform }
        : { language: contact.language, genre: contact.genre },
      seite,
    });
    const staerke = contacts.staerkeOf({
      seineReichweite: seine, meineReichweite: meine, passung: p.passung, stufe: 'zusage' });
    // Genau das Verhältnis, mit dem `contacts.request` gleich `stufeVon` ruft.
    const ratio = meine / Math.max(1, seine);
    const verteilung = stufenVerteilung({ ratio, respekt, vertrauen });
    const nutzen = Object.entries(verteilung).reduce((s, [stufe, w]) =>
      s + w * nutzenOf(requestId, staerke * contacts.STUFEN_FAKTOR[stufe], seine, meine, seite), 0);
    return {
      seite, staerke, nutzen,
      stufenFaktor: erwarteterStufenFaktor({ ratio, respekt, vertrauen }),
    };
  };

  // Vorauswahl: die acht besten freien Kontakte nach Chance × erwarteter Stärke der Leitseite.
  const liste = contacts.listFor(G, U, { now })
    .filter((z) => z.gesperrtBis <= now)
    .map((z) => {
      const b = bewerte(z.contact, 'shoutout', z.respekt, z.vertrauen);
      // Beim Partner-Vorrang zählt die Musikseite auch schon in der
      // Vorauswahl: Sonst verdrängen die acht größten Creator des Katalogs
      // jeden Musiker, und die Auswahl unten fände nichts mehr vor.
      const raus = vorrang === 'partner' && (!b || b.seite !== 'musik');
      return { ...z, grob: (b && !raus) ? z.chance * b.staerke * b.stufenFaktor : 0 };
    })
    .sort((a, b) => b.grob - a.grob)
    .slice(0, 8);

  /*
   * `vorrang = 'konzert'`: Die Bühne bekommt Vorrang, sobald sie überhaupt
   * möglich ist (Draht ≥ 20). Ohne diesen Vorrang wird das Konzert NIE
   * gewählt und die Zeile bliebe eine stille Null – es ist auf beiden Seiten
   * dominiert: auf der Creator-Seite vom Feature (Faktor 1 + 5 × Stärke bei
   * Schwierigkeit −0,10 gegen 1 + 3 × Stärke bei −0,20), auf der Musikseite
   * bringt es gar keinen Faktor, sondern Hörer für eine einzige Gage. Der
   * Vorrang ist also kein besseres Spiel, sondern das Messwerkzeug für genau
   * diesen Schub.
   *
   * `vorrang = 'partner'`: NUR die Musikseite, und dort der Kontakt, der dem
   * Partnerstatus am nächsten ist (die schwächere Achse, `min(Respekt,
   * Vertrauen)`, am höchsten), zuerst – das Messwerkzeug des Angebotslaufs
   * (Stück 5c), aus demselben Grund wie der Konzert-Vorrang und mit demselben Vorbehalt: Es ist
   * eine Spielweise, keine Empfehlung. Zwei Dinge aus dem Code erzwingen ihn:
   *
   *  • Eine Gegenanfrage kommt ausschließlich von einem Kontakt mit MUSIK-
   *    Reichweite (`src/angebote.js`, `zustellen`: `if (!c.reach) continue;`)
   *    und erst ab Draht 20; `kollabo`, `tour` und `label` erst ab 50.
   *  • Die freie Wahl oben baut über ein Jahr GENAU EINEN Draht auf, und das ist
   *    ein reiner Creator. Gemessen (Probelauf, 365 Tage, Seeds 1000/1001, beide
   *    Archetypen): `tomscott` steht am Ende bei Draht 93 … 100 bei 8 … 14
   *    Zusagen und sonst niemand über 23 – und `tomscott` hat kein `reach`,
   *    sondern nur `reachCreator` (`src/data/contacts.js:567`). Der ganze
   *    Angebotslauf hätte damit null Anfragen, und das wäre eine stille Null und
   *    kein Ergebnis.
   *
   * Der Draht allein genügt nicht: Nur die Musikseite zu nehmen, ließ im
   * Probelauf in 2 von 4 Fällen keinen einzigen Musiker über 20 kommen (Draht
   * 15/15, die zwei Stunden verteilten sich auf mehrere) – `PARTNER` wäre dann
   * seedabhängig da oder nicht, und die drei Partner-Arten wären in der Hälfte
   * der Seeds eine stille Null. Deshalb der Draht als erstes Kriterium: Wer
   * einen Partner will, füttert denselben Kontakt, sobald die Drei-Tage-Sperre
   * durch ist. Die Zahl der Partner am Laufende steht in der Ausgabe.
   */
  let wahl = null;
  const nurMusik = vorrang === 'partner';
  for (const z of liste) {
    const d = contacts.detail(G, U, z.contact.id, now);
    if (!d) continue;
    for (const r of d.requests) {
      if (!r.moeglich) continue;
      const b = bewerte(z.contact, r.id, d.respekt, d.vertrauen);
      if (!b) continue;
      if (nurMusik && b.seite !== 'musik') continue;
      const score = r.chance * b.nutzen;
      const konzert = vorrang === 'konzert' && r.id === 'konzert';
      // Beim Partner-Vorrang schlägt die schwächere Achse jeden Score: Dieselbe
      // Person weiter füttern, bis sie Partner ist. Partner ist `respekt >= 50 &&
      // vertrauen >= 50` und hängt damit an der SCHWÄCHEREN Achse – nicht am
      // Draht, dem Mittelwert: Eine echte Antwort hebt den Respekt dreimal
      // schneller (9 gegen 3), der Draht als Ziel wählte darum den
      // respektlastigen Kontakt (80/20, Draht 50) vor dem, der eine Zusage vom
      // Partner entfernt ist (50/48, Draht 49). Innerhalb eines Kontakts
      // entscheidet danach wieder Chance × Nutzen wie überall.
      const naehe = Math.min(d.respekt, d.vertrauen);
      const besser = nurMusik
        ? (!wahl || naehe > wahl.naehe || (naehe === wahl.naehe && score > wahl.score))
        : (!wahl || (konzert && !wahl.konzert) || (konzert === wahl.konzert && score > wahl.score));
      if (besser) {
        wahl = { score, konzert, contactId: z.contact.id, requestId: r.id, seite: b.seite,
          chance: r.chance, draht: d.draht, naehe, respekt: d.respekt, vertrauen: d.vertrauen };
      }
    }
  }
  if (!wahl) { if (kz) kz.nichts++; return null; }

  const erg = contacts.request(G, U, wahl.contactId, wahl.requestId, now, rand);
  /*
   * `--trace=kontakte`: jede Anfrage als JSON-Zeile auf stderr – die Grundlage
   * der Handprüfung (Chance, Stärke und Faktor eines einzelnen Tages von Hand
   * gegen data/contacts.js nachgerechnet).
   */
  if (TRACE === 'kontakte') {
    const b = bewerte(contactsData.byId(wahl.contactId), wahl.requestId,
      wahl.respekt, wahl.vertrauen) ?? {};
    console.error(JSON.stringify({
      datum: new Date(now).toISOString().slice(0, 10),
      kontakt: wahl.contactId, anfrage: wahl.requestId, seite: wahl.seite,
      // `chance` ist der Wert, gegen den WIRKLICH gewürfelt wurde (aus
      // `contacts.request`); `chanceAnzeige` ist derselbe Wert aus
      // `contacts.detail`, also das, was auf dem Knopf steht.
      chance: erg.chance ?? null, chanceAnzeige: wahl.chance,
      antwort: erg.antwort ?? null, ok: erg.ok,
      drahtVor: erg.drahtVor ?? null, draht: erg.draht ?? null,
      staerke: erg.staerke ?? null, staerkeBeiZusage: b.staerke ?? null,
      stufenFaktorErwartet: b.stufenFaktor ?? null, nutzenErwartet: b.nutzen ?? null,
      faktor: erg.boost?.factor ?? null, extra: erg.boost?.extra ?? null,
      meine: seite2reichweite(wahl.seite, ich), seine: seite2seine(wahl.seite, contactsData.byId(wahl.contactId)),
      // Die restlichen Summanden der Chance, damit sie von Hand nachrechenbar ist.
      hype: sm.hype ?? 1, tuerOeffner: contacts.tuerOeffnerFor(db.contactsOf(G, U), contactsData.byId(wahl.contactId), now),
      // Partner VOR der Anfrage – das ist der Summand, mit dem gerechnet wurde.
      partnerVor: Boolean(erg.partner) && !erg.partnerNeu, trait: contactsData.byId(wahl.contactId).trait,
    }));
  }
  if (kz) {
    if (!erg.ok) {
      kz.abgelehnt[erg.reason] = (kz.abgelehnt[erg.reason] ?? 0) + 1;
    } else {
      kz.versuche++;
      kz.antworten[erg.antwort]++;
      // Ein Ja WILL immer einen Schub setzen; `boost.neu` sagt, ob er auch
      // geschrieben wurde – ein noch laufender stärkerer Schub bleibt liegen.
      if (erg.boost) {
        kz.schubVersuche++;
        if (erg.boost.neu) kz.gesetzt++;
      }
      const key = `${erg.seite}/${wahl.requestId}`;
      const a = (kz.proAnfrage[key] ??= { versuche: 0, zusage: 0, echt: 0, fluechtig: 0, ignoriert: 0 });
      a.versuche++;
      a[erg.antwort]++;
    }
  }
  return erg;
}

// ------------------------------------------------------------ Ein Lauf

async function karriere(G, U, { musik, strat }, tage, seed, marken = null) {
  const erreicht = {};
  const tagesgeld = [];
  const rand = rng(seed);
  /*
   * EIGENER Würfel für die Kontaktwürfe (Stück 5a). Zöge die Kontaktpflege aus
   * `rand`, wäre der Lauf „mit Kontakten" ab dem ersten Wurf auch ein anderer
   * Musik- und Kanallauf – die Differenz misst dann zur Hälfte einen anderen
   * Würfel statt der Kontakte.
   */
  const kontaktRand = rng(seed + 500_000);
  // Beziehungsbefund (Task 7) – nur, wenn der Aufrufer ihn bestellt hat.
  const bzStand = kz?.beziehung ? neuerBeziehungsStand() : null;
  /*
   * DRITTER Würfel für den Beef (Stück 5b), aus demselben Grund wie der
   * Kontaktwürfel: Anstacheln, Disstrack und das Angezähltwerden dürfen den
   * Musik- und Kanalstrom nicht verschieben, sonst wäre die Differenz zur
   * Hälfte ein anderer Würfel.
   *
   * Er hängt auch dann am Zähler, wenn die Beef-Spielweise „aus" ist – nicht
   * weil die Hülle um `beef.anzaehlen` dort aus ihm zieht, sondern im
   * Gegenteil: Für „aus" gibt die Hülle sofort `null` zurück, OHNE zu
   * würfeln (siehe dort). Für „passiv" und „aktiv" zieht sie ihren Wurf aus
   * diesem Strom statt aus `rand`. So oder so bleibt der Hauptstrom
   * unberührt – sonst wäre schon die Variante „ohne Beef" ein anderer Lauf
   * als die anderen zwei, weil `music.publish` bei jeder Chart-Platzierung
   * einen Wurf mehr zöge.
   */
  const beefRand = rng(seed + 700_000);
  if (bz) bz.rand = beefRand;
  /*
   * VIERTER Würfel für die Gegenanfragen (Stück 5c), aus genau dem Grund der
   * zwei davor: Zustellung, Annahme, Absage, die Projektarbeit und die
   * Veröffentlichungen und Konzerte, die ein fertiges Projekt auslöst, dürfen
   * den Musik- und Kanalstrom nicht verschieben. Er wird in JEDER Variante
   * angelegt – auch in „aus", wo niemand aus ihm zieht –, denn das Anlegen
   * selbst berührt `rand` nicht, und so bleibt die Grundlage derselbe Lauf.
   */
  const angebotRand = rng(seed + 900_000);
  if (ag) ag.rand = angebotRand;
  /*
   * FÜNFTER Würfel für die Vorfälle (Stück 5f), aus genau dem Grund der drei
   * davor: Der Tageswurf und die Wahl der Option dürfen den Musik- und
   * Kanalstrom nicht verschieben, sonst wäre schon die Variante „ohne Vorfälle"
   * ein anderer Lauf als die mit. Angelegt wird er in JEDER Variante – das
   * Anlegen selbst berührt `rand` nicht.
   */
  const vorfallRand = rng(seed + 1_100_000);
  if (vf) vf.rand = vorfallRand;
  ausruesten(G, U);
  await home.setHome(G, U, 'de');
  if (musik) music.setup(G, U, 'pop', music.PERSONAS[0].id);

  /*
   * Der Lauf beginnt HEUTE und geht vorwärts – nicht in der Vergangenheit.
   *
   * `music.setup` und die Kanal-Anlage schreiben die echte `Date.now()` in
   * die Datenbank. Startet die Simulation vor diesem Zeitpunkt, liegt
   * `paid_through` in der Zukunft, `elapsed` wird negativ und `settle` gibt
   * jeden Tag null zurück – die Tantiemen fehlen dann vollständig, ohne dass
   * irgendetwas nach einem Fehler aussieht. Genau daran sind drei Probeläufe
   * gescheitert. Die Tests des Projekts machen es aus demselben Grund so.
   */
  let now = new Date(new Date().setHours(6, 0, 0, 0)).getTime();
  let energieSumme = 0;
  /*
   * Der Hype ueber ALLE Tage, nicht nur am Ende (Stueck 5c).
   *
   * Der Ausgang eines Beefs zahlt ausschliesslich ueber den Hype, und zwar
   * sieben Tage lang (`BONUS_TAGE`). Die Zahl am letzten Tag trifft dieses
   * Fenster nur zufaellig – wer wissen will, ob ein Siegfenster den Hype an die
   * Decke `HYPE_MAX` klebt, braucht den Mittelwert ueber den ganzen Lauf.
   * Gezaehlt wird der Wert, den `musiktag` ohnehin zurueckgibt: kein
   * zusaetzlicher Aufruf, kein zusaetzlicher Wurf.
   */
  let hypeSumme = 0;
  let hypeTage = 0;
  for (let d = 0; d < tage; d++) {
    ausruesten(G, U);                 // Defekte von gestern ersetzen
    // Marathon-Modus: ungerade Tage sind Ruhetage – nur Abrechnungen, keine Arbeit.
    const ruhetag = MARATHON && d % 2 === 1;
    if (musik) {
      // Erst abrechnen, dann handeln: So liegt ein voller Tag zwischen zwei
      // Abrechnungen (`MIN_SETTLE_MS` verlangt mindestens eine Stunde).
      await music.settle(G, U, now);
      music.settleContracts(G, U, now + 1e5);
    }
    /*
     * Zwei Stunden Kontaktpflege (`kontakte`, Stück 5a) – VOR der
     * Veröffentlichung des Tages, damit ein heute gesetzter Schub heute noch
     * wirken kann. Die zwei Stunden kommen aus demselben 24-h-Budget wie alles
     * andere; bezahlt werden sie am Tagesende beim Kanalprogramm, das die
     * Restzeit ausschöpft – also genau „2 h in Kontakte statt in eine Aktion".
     */
    if (strat.kontakte && !ruhetag) kontakttag(G, U, now + 15e4, kontaktRand, strat.kontaktVorrang ?? null);
    /*
     * Die Gegenanfragen (Stück 5c) – NACH der Kontaktpflege und VOR dem
     * Musiktag, aus demselben Grund wie die Kontaktpflege: Ein Schub, den ein
     * angenommener Gastpart heute setzt, soll die Veröffentlichung von heute
     * erreichen. Die Zeit kommt aus demselben 24-h-Tag; Honorar, Gage und die
     * Projektstunden sind damit echte Mehrkosten und keine Nebenrechnung.
     */
    if (musik && !ruhetag && ANGEBOT_SPIELWEISEN.has(strat.angebote)) {
      await angebotetag(G, U, now + 17e4, angebotRand, strat.angebote);
    }
    if (musik && !ruhetag) {
      /*
       * Zwei Stunden Beef (Stück 5b) aus demselben 24-h-Budget wie alles
       * andere. Der Schritt liegt IM Musiktag zwischen Studio und
       * Veröffentlichung (siehe `musiktag`), weil die gemessene Spielweise den
       * Disstrack bringt, sobald ein Titel da und die Sperre durch ist.
       */
      const beefHook = BEEF_SPIELWEISEN.has(strat.beef)
        ? (jetzt) => beeftag(G, U, jetzt, beefRand, strat.beef) : null;
      /*
       * `horten: 'kollabo'` ist die Veröffentlichungspolitik des
       * Kollabo-Kontrollpaars (5c): sechs Titel sammeln wie bei `true`, sie aber
       * liegen lassen, solange ein Kollabo-Konto offen ist. Für jede andere
       * Variante bleibt der Ausdruck `strat.horten === true` wie bisher.
       */
      const horten = strat.horten === 'kollabo'
        ? () => db.projekteOf(G, U).some((p) => p.status === 'offen' && p.art === 'kollabo')
        : strat.horten === true;
      const s = musiktag(G, U, now + 2e5, rand, strat.konzert, horten, beefHook);
      hypeSumme += s.hype ?? 0;
      hypeTage++;
      if (s.showMs <= 0 && s.listeners >= music.SHOW_MIN_LISTENERS) {
        await music.show(G, U, now + 4e6, rand, musikOpts);
      }
    }
    /*
     * `kanaele: false` ist der reine Musiker: kein Kanalprogramm, also auch
     * keine Füllaktionen, die die zwei Kontaktstunden verdrängen könnten.
     * Genau das ist die Frage, die der dritte Archetyp im Kontaktlauf stellt.
     */
    const minuten = (ruhetag || strat.kanaele === false)
      ? 0 : await kanaltag(G, U, strat, now + 6e6, rand);
    await creator.settle(G, U, now + 20e6);
    await creator.settleMerch(G, U, now + 20e6);
    await creator.settleDeals(G, U, now + 20e6);
    // Energie am Tagesende: nach der letzten Kanalaktion (die Uhr kann bis
    // ~22:40 vorrücken), sonst zur Abrechnung um ~11:33 – Mittel über den Lauf.
    energieSumme += creator.energyOf(G, U, Math.max(now + 20e6, now + 6e6 + minuten * 60_000)).energy;

    /*
     * Vorfälle wie ein Spieler behandeln: Verfallene abrechnen, würfeln, offene
     * mit zufälliger Option entscheiden. Ohne das Entscheiden bleibt der erste
     * Vorfall des Jahres ewig offen und blockiert alle weiteren – genau so hat
     * eine frühere Messung „einen Vorfall pro Jahr" gemeldet.
     *
     * DER TAGESWURF (Stück 5f) steht hinter `strat.vorfaelle` und läuft damit
     * NUR im Vorfall-Abschnitt. Zwei Gründe: Die Zahlen der Abschnitte 5a–5c
     * sind ohne ihn gemessen, und eine stille Rate in allen Läufen würde sie
     * ändern, ohne dass es jemand sieht. Gerufen wird er mit DENSELBEN
     * Argumenten wie im Spiel (`buttons.settleMusic`: Hörer · `settleCreator`:
     * `creator.reachTotalOf`), NACH `decisions.settle` – ein eben verfallener
     * Vorfall darf den neuen nicht blockieren.
     *
     * Ohne ihn hat ein Karriere-Lauf NULL Vorfälle, denn die Würfe je Aktion
     * sind seit 5f weg: `music.record`, `publish`, `show` und `creator.act`
     * rufen `decisions.roll` nicht mehr. Das ist genau die stille Null, gegen
     * die die Kontrollzeilen des Abschnitts gebaut sind.
     */
    await decisions.settle(G, U, now + 20.5e6);
    if (strat.vorfaelle) {
      if (musik) {
        vorfallWurf(G, U, 'music', music.status(G, U, now + 20.52e6).listeners,
          now + 20.52e6, vorfallRand);
      }
      vorfallWurf(G, U, 'creator', creator.reachTotalOf(G, U,
        db.allCreator(G, U).reduce((s, r) => s + r.followers, 0)), now + 20.54e6, vorfallRand);
    }
    /*
     * Entschieden wird JE BEREICH: Seit 5f können Musik, Creator und Firma
     * gleichzeitig einen offenen Vorfall haben. `pending` ohne Bereich gäbe nur
     * den neuesten zurück, die anderen verfielen – und ein verfallener Vorfall
     * ist teurer (IGNORE_PENALTY 1,6). Der Würfel ist der Vorfallsstrom, sobald
     * der Tageswurf läuft; ohne ihn kann hier ohnehin nichts offen sein.
     */
    for (const bereich of ['music', 'creator', 'company']) {
      const offen = decisions.pending(G, U, now + 20.6e6, bereich);
      if (!offen) continue;
      const w = strat.vorfaelle ? vorfallRand : rand;
      const o = offen.decision.options[Math.floor(w() * offen.decision.options.length)];
      const ch = await decisions.choose(G, U, offen.id, o.id, now + 20.6e6, w);
      if (vf) {
        if (ch?.ok === false) vf.fehler.push(`${bereich}/${offen.kind}: ${ch.reason}`);
        else vf.beantwortet[bereich] = (vf.beantwortet[bereich] ?? 0) + 1;
      }
    }

    /*
     * Meilensteine festhalten: Wann wird welche Hörerzahl erreicht, und was
     * verdient der Spieler an diesem Tag? Der Tagesertrag wird aus den
     * letzten 30 Tagen gemittelt – ein einzelner Tag schwankt zu stark
     * (Konzerte kommen nur alle drei Tage).
     */
    if (marken) {
      tagesgeld.push(konto[U] ?? 0);
      const hoerer = musik ? (music.status(G, U, now + 21e6).listeners ?? 0) : 0;
      for (const m of marken) {
        if (erreicht[m] || hoerer < m) continue;
        const j = Math.max(0, tagesgeld.length - 31);
        erreicht[m] = {
          tag: d + 1,
          hoerer: Math.round(hoerer),
          follower: db.allCreator(G, U).reduce((x, r) => x + r.followers, 0),
          proTag: ((konto[U] ?? 0) - tagesgeld[j]) / Math.max(1, tagesgeld.length - 1 - j),
        };
      }
    }
    if (bzStand) beziehungsTag(bzStand, G, U, now + 21.1e6);
    now += DAY;
  }
  if (bzStand) beziehungsEnde(kz.beziehung, bzStand, G, U);

  /*
   * Die Hörerzahl MIT Zeitstempel lesen.
   *
   * `db.getArtist(G, U)` ohne `now` liefert den rohen Speicherwert, auf den
   * der Verfall noch nicht angewandt wurde – eine Zahl, mit der das Spiel nie
   * rechnet. Genau daran ist ein Probelauf gescheitert: gemeldet wurden
   * 177.930 Hörer, während die Auszahlungen zu einem Bruchteil davon passten.
   */
  return {
    geld: konto[U] ?? 0,
    quellen: quellen[U] ?? {},
    follower: db.allCreator(G, U).reduce((s, r) => s + r.followers, 0),
    hoerer: musik ? Math.round(music.status(G, U, now).listeners ?? 0) : 0,
    // Der Hype am Ende: Der Ausgang eines Beefs zahlt AUSSCHLIESSLICH über ihn
    // (§15), deshalb steht er neben den Hörern. Für alles andere ist er nur
    // ein zusätzliches Feld, das kein Aufrufer lesen muss.
    hype: musik ? music.status(G, U, now).hype : 0,
    // Der Hype im Mittel ueber alle Tage des Laufs (siehe `hypeSumme` oben).
    hypeMittel: hypeTage ? hypeSumme / hypeTage : 0,
    energie: energieSumme / Math.max(1, tage),
    erreicht,
  };
}

/** Ein Archetyp über viele Läufe und alle Strategien; zurück kommt die beste. */
/**
 * Ein Archetyp in zwei Phasen.
 *
 * Erst wird die beste Strategie mit WENIGEN Läufen gesucht, dann wird nur
 * diese mit ALLEN Läufen gemessen. Alle Strategien voll durchzurechnen wäre
 * ein Vielfaches der Laufzeit, ohne dass die Verlierer irgendjemanden
 * interessieren.
 */
async function archetyp(name, musik, laeufe, tage) {
  // Festgelegte Strategie: keine Suche. Gibt es sie für diesen Archetyp nicht
  // (die Konzert-Varianten „+K" existieren nur für Musik), läuft die Suche wie gewohnt.
  if (STRATEGIE) {
    const fest = strategien(musik).filter((s) => s.name === STRATEGIE);
    if (fest.length) {
      console.log(`    -> Strategie festgelegt: "${STRATEGIE}", ${laeufe} Läufe à ${tage} Tage`);
      return durchlauf(name, musik, laeufe, tage, fest, false);
    }
    console.log(`    -> Strategie "${STRATEGIE}" gibt es für diesen Archetyp nicht, Suche wie gewohnt`);
  }
  /*
   * Die Suchphase laeuft mit wenigen Laeufen UND verkuerzter Karriere: Welche
   * Strategie vorn liegt, steht deutlich frueher fest als die Endzahlen. Die
   * volle Laenge kostet in der Suche ein Vielfaches, ohne die Rangfolge zu
   * aendern.
   */
  const suchLaeufe = Math.max(2, Math.min(3, laeufe));
  const suchTage = Math.min(tage, 180);
  const gefunden = await durchlauf(name, musik, suchLaeufe, suchTage, strategien(musik), true);
  console.log(`    -> beste Strategie: "${gefunden.strategie}" (aus ${suchTage} Tagen), jetzt ${laeufe} Läufe à ${tage} Tage`);
  const nur = strategien(musik).filter((s) => s.name === gefunden.strategie);
  return durchlauf(name, musik, laeufe, tage, nur, false);
}

async function durchlauf(name, musik, laeufe, tage, liste, kurz) {
  let beste = null;
  for (const strat of liste) {
    const geld = [];
    const follower = [];
    const hoerer = [];
    const energie = [];
    const summe = {};
    for (let i = 0; i < laeufe; i++) {
      // Welt UND Konto je Lauf eindeutig: Sonst zählt `konto` über die
      // Strategien hinweg weiter und jede folgende sieht besser aus als die
      // vorige – genau das ist beim ersten Probelauf passiert.
      const kennung = `${name}_${strat.name.replace(/\W+/g, '')}_${i}`;
      const G = welt(kennung);
      const U = `fx:${kennung}`;
      const r = await karriere(G, U, { musik, strat }, tage, 1000 + i);
      geld.push(r.geld);
      follower.push(r.follower);
      hoerer.push(r.hoerer);
      energie.push(r.energie);
      for (const [k, v] of Object.entries(r.quellen)) summe[k] = (summe[k] ?? 0) + v;
    }
    const erg = {
      strategie: strat.name,
      median: median(geld), q25: quantil(geld, 0.25), q75: quantil(geld, 0.75),
      follower: median(follower), hoerer: median(hoerer),
      energie: energie.reduce((a, b) => a + b, 0) / Math.max(1, energie.length),
      quellen: Object.fromEntries(
        Object.entries(summe).map(([k, v]) => [k, v / laeufe]).sort((a, b) => b[1] - a[1])),
    };
    if (!beste || erg.median > beste.median) beste = erg;
    if (!kurz || laeufe <= 3) {
      console.log(`    ${strat.name.padEnd(30)} Median ${de(erg.median).padStart(12)}` +
        `   ${de(erg.follower).padStart(9)} Follower` +
        (musik ? `   ${de(erg.hoerer).padStart(8)} Hörer` : '') +
        `   Energie Ø ${Math.round(erg.energie * 100)} %`);
    }
  }
  return beste;
}

// ------------------------------------------------------------ Firmen

/**
 * Eine Firma im Vollbetrieb – derselbe Tagesablauf wie der Decke-Test in
 * test/company.test.js:
 *
 *   Tag 1 Gründung und volle NPC-Besetzung (Aushilfen), ab Tag 30 wird jeder
 *   unter Schichtleiter befördert, täglich Werbung und Anpacken (Werbung 2
 *   + 4 × Anpacken 2 = 10 von 24 Stunden, alles passt; die Energie drückt
 *   das vierte Anpacken um ein paar Prozent), abends Abrechnung und Entnahme
 *   des Gewinns.
 *
 * Drei Spielweisen (`ausbau`, seit 1.32.0):
 *
 *   'keiner'      Kern, Stufe 0, keine Extras – die Messung aus 1.31.0.
 *   'kapitalist'  Am Tag 1 alle fünf Stufen und vier Extras vom Konto (500 Mio
 *                 für alle); gezählt werden nur die Entnahmen. `amortTage` ist
 *                 der erste Tag, an dem sie Gründung UND Gesamtausbau übersteigen.
 *   'aufsteiger'  Eigene Guthabenlogik: `getBalance` liefert für diesen Nutzer
 *                 nur `konto[U]` (Entnahmen minus Ausbaukäufe), nicht 500 Mio.
 *                 Die Gründung bezahlt er nicht – Startpunkt ist die gegründete
 *                 Firma mit Kern-Besetzung, die Frage ist der Weg AB dort.
 *                 Täglich nach der Entnahme: nächste Stufe, wenn bezahlbar;
 *                 sonst das billigste freigeschaltete Extra; danach NPCs
 *                 nachstellen. `stufe5Tag`/`vollTag`: erster Tag mit Stufe 5
 *                 bzw. Stufe 5 + 4 Extras; `endeProTag`: Median der letzten 30 Tage.
 *
 * Die Entnahme lässt die Werbekosten in der Kasse: Wer abends alles
 * herausnimmt, kann morgens keine Werbung bezahlen – dann misst man einen
 * Spieler, der sich selbst im Weg steht, nicht die Firma.
 *
 * Ereignisse (seit 1.34.0, Stück 2b): Standard ist `ereignisse = true` – die
 * Abrechnung würfelt je Tag ein leichtes Ereignis und je Abrechnung einen
 * Vorfall, beides aus dem festen Würfel. Der simulierte Inhaber schaut
 * täglich: Einen offenen Vorfall entscheidet er sofort mit einer zufälligen
 * Option, aber NIE mit einer, die verkaufen kann (sonst endet der Lauf).
 * Ist die Firma geschlossen (`locked`), fallen Werbung und Anpacken aus;
 * gekündigte NPCs werden täglich nachbesetzt (als Aushilfe – die Beförderung
 * ab Tag 30 holt sie nach). Reicht die Kasse morgens nicht für die Werbung
 * oder ist sie im Minus (nach Schließung oder Kassenabzug), schießt er den
 * Fehlbetrag nach – „Einzahlen rettet" ist die Spielweise, die die Ansicht
 * empfiehlt. Ein- und Auszahlungen sind Umbuchungen: `median` misst nur die
 * Kasse (Umsatz, Löhne, Werbung, Anpacken, Ereignisse), `amortTage` rechnet
 * Entnahmen minus Nachschuss gegen die Investition.
 * `ereignisse = false` (Schalter `--ohne-ereignisse`): Würfel ≡ 0,5, also
 * weder Ereignis noch Vorfall – der Lauf ist dann deterministisch wie vor 2b.
 *
 * Waren (seit 1.35.0, Stück 3a): Jede Schicht verbraucht eine Einheit Ware –
 * aus dem Lager oder ad hoc (+25 %) von der Kasse. Der simulierte Inhaber
 * kauft morgens nach der Werbung täglich das Lager voll, solange der Tagespreis
 * nicht über dem Startkurs liegt (`ratio ≤ 1`; die Messwelt hat keine
 * Börsenticks, also gilt immer Kurs = Start und Einkauf zum Einheitspreis).
 * Ein Einkauf über den Tagesverbrauch hinaus (erstes Füllen) lässt die
 * Werbekosten in der Kasse. Reicht es nicht für „voll" (Anlaufzeit,
 * Ereignis), kaufen die Schichten des Tages ad hoc – gezählt in `einkaufAus`
 * und im ad-hoc-Anteil.
 * Die abendliche Entnahme lässt neben der Werbung das Geld für den nächsten
 * Einkauf in der Kasse (`Kapazität − Bestand` Einheiten zum Tagespreis) – am
 * ersten Einkaufstag ein ganzes Lager, danach nur den Tagesverbrauch. Der
 * Einkauf zählt zum Tagesgewinn (Kasse abends minus morgens), damit `median`
 * den Wareneinsatz enthält wie die Decke (`ceilingOf(...).net`); der einmalige
 * Aufbau des Lagers ist ein Ausreißer, den der Median nicht sieht.
 * `wareProTag` = (Einkäufe − Lagerwert am Ende + ad hoc) / Tage, also der
 * tatsächliche Verbrauch – die Erstausstattung (mit der Gründung bezahlt)
 * zählt als erster Einkauf, `investition` enthält sie ebenfalls;
 * `adhocAnteil` = ad-hoc-Einheiten / alle Einheiten
 * (NPC-Schichten aus `settle` und Anpacken). Ohne Ereignisse muss der beste
 * Tag unter der Decke bleiben – geprüft wird `bestNetto`, der Tag mit der
 * Ware, die er verbraucht hat, zum Einheitspreis (das erste Füllen, die Lücke
 * nach einem Ausbau oder ein übersprungener Einkauf verschieben Warenkosten
 * zwischen den Tagen; `bestGewinn` ist der rohe beste Kassentag).
 * `trace(tag)` (optional) bekommt je Tag die Buchungen für die Handprüfung.
 *
 * Handel (seit 1.36.0, Stück 3b): `betrieb()` ist der Tagesablauf als Objekt
 * (`morgen`, `abend`, `aufstieg`, `naechsterTag`, `ergebnis`), damit
 * `handelslauf` zwei Firmen in EINER Welt im Wechsel laufen lassen kann –
 * `firmenlauf` ist nur noch die Schleife darum, mit denselben Buchungen wie
 * vorher (die Firmen-Abschnitte des Laufs sind Zeile für Zeile gleich
 * geblieben – geprüft per Diff gegen einen Lauf des Codes VOR dem Umbau, mit
 * derselben TAGE-Zahl, siehe .superpowers/sdd/task-3-report.md; NICHT gegen
 * die committete docs/messungen/2026-09-20-firmen-waren.txt, die vor den
 * Erstausstattungs-Commits 50a4650/0ca5a97 liegt und darum nicht als
 * Baseline taugt).
 * `kaufen(now, d, st)` ersetzt den NPC-Einkauf (der Käufer im Handelslauf
 * kauft zuerst beim Spediteur); der §3-Prüfwert rechnet die verbrauchte Ware
 * seitdem zum Preis des heutigen Einkaufs (ohne Handel ist das der
 * Einheitspreis, also dieselbe Zahl wie vorher) – so zählt die Ersparnis je
 * verbrauchter Einheit, nicht je gekaufter, und ein Nachkauf nach einer Lücke
 * verschiebt sie nicht auf einen Tag. Die Spanne des Spediteurs steht in
 * seiner Kasse und damit im Tagesgewinn. `handel` im Ergebnis: gelieferte bzw.
 * bezogene Einheiten, Spanne bzw. Ersparnis, beste Tageswerte, Handelstage,
 * NPC-Ausweichtage (Spediteur zu) und die Handels-Decke (§3: Spediteur
 * Plätze × 20 × 48, Käufer 0,1 × Tagesverbrauch × Einheitspreis) – ohne
 * Ereignisse muss `bestNetto ≤ decke + handel.decke` gelten.
 *
 * @returns {{median:number, decke:number, amortTage:number|null, entnommen:number,
 *   stufe5Tag:number|null, vollTag:number|null, endeProTag:number,
 *   ereignisTage:number, vorfaelle:number, zuTage:number, best:number, ereignisDecke:number,
 *   nachschuss:number, nachschussTage:number, werbungAus:number,
 *   wareProTag:number, wareEinkauf:number, wareAdhoc:number, einheiten:number,
 *   adhocEinheiten:number, adhocAnteil:number, bestGewinn:number, bestNetto:number, bestTag:object|null,
 *   lagerEnde:number, einkaufAus:number, handel:object, wert:object}}
 *   `median` Tagesgewinn (Kassenstand nach Abrechnung minus Tagesbeginn),
 *   `decke` die Kern-Decke bzw. beim Ausbau die volle (`fullCeilingOf`),
 *   `ereignisTage` Tage mit Chronik-Zeile, `vorfaelle` gewürfelte Vorfälle,
 *   `zuTage` abgerechnete Tage mit geschlossenem Betrieb, `best` der höchste
 *   NPC-Umsatz eines Tages, `ereignisDecke` die Umsatz-Decke × EVENT_UMSATZ_MAX
 *   (§3; beim Aufsteiger die des Endausbaus), `nachschuss` eingezahlte Summe,
 *   `werbungAus` Tage, an denen die Werbung trotzdem an der Kasse scheiterte,
 *   `wert` der Firmenwert am Ende (Stück 4, `company.valueOf`): Substanz
 *   (`invested` Ausbau + `kasse` + `stock` Lager zum Einstand) und `earnings`
 *   = `max(0, round(profit_ema × 30))`, dazu die rohe `profitEma`.
 */
async function betrieb(branchId, { ausbau = 'keiner', ereignisse = !OHNE_EREIGNISSE, wuerfel = null, trace = null,
  welt: weltId = null, user: userId = null, name = null, kaufen = null } = {}) {
  if (!['keiner', 'kapitalist', 'aufsteiger'].includes(ausbau)) throw new Error(`ausbau: ${ausbau}`);
  const b = company.branch(branchId);
  const G = weltId ?? welt(`firma_${branchId}_${ausbau}_${ereignisse ? 'mit' : 'ohne'}`);
  const U = userId ?? `fx:firma_${branchId}_${ausbau}_${ereignisse ? 'mit' : 'ohne'}`;
  const rand = rng(4242);
  // Der Würfel der Abrechnung: 0,5 trifft weder ein Ereignis (none 0…140 von 185+) noch
  // einen Vorfall (Risiko höchstens 8 %/Tag). `wuerfel` ist für die Handprüfung.
  const ereignisRand = ereignisse ? (wuerfel ?? rand) : () => 0.5;
  /** Umsatz-Decke der NPC-Schichten × 1,15 (§3) für die aktuelle Stufe und Extras. */
  const ereignisDeckeVon = (c) => {
    const eff = company.effectiveOf(c, b);
    const top = companyData.RANKS[companyData.RANKS.length - 1].factor;
    return eff.slots * companyData.NPC_SHIFTS * Math.round(b.umsatz * top * eff.umsatzFactor) * companyData.EVENT_UMSATZ_MAX;
  };
  const decke = (ausbau === 'keiner' ? company.ceilingOf(b) : company.fullCeilingOf(b)).net;
  const reserveWerbung = Math.round(b.price * companyData.WERBUNG_COST_SHARE);
  /** Was die Entnahme abends in der Kasse lässt: Werbung plus der nächste Einkauf (Stück 3a). */
  let reserve = reserveWerbung;
  const gesamtAusbau = b.stufen.reduce((s, st) => s + st.price, 0) + b.extras.reduce((s, e) => s + e.price, 0);
  const top = companyData.RANKS.length - 1;
  const unit = company.wareUnit(b);

  // Ab heute vorwärts, wie `karriere` (die Module schreiben echte Zeitstempel).
  let now = new Date(new Date().setHours(6, 0, 0, 0)).getTime();
  const f = await company.found(G, U, b.id, name ?? `Mess-${b.name}`, now);
  if (!f.ok) throw new Error(`Gründung ${b.id} gescheitert: ${f.reason}`);
  const cid = f.company.id;
  // Die Investition ist Gründung plus Erstausstattung (Nachtrag: das volle Kern-Lager wird
  // mit der Gründung bezahlt), beim Kapitalisten dazu der ganze Ausbau.
  const investition = b.price + f.starter.cost + (ausbau === 'kapitalist' ? gesamtAusbau : 0);

  /** NPCs nachstellen, bis alle Plätze der aktuellen Stufe besetzt sind. */
  const besetzen = (t) => {
    const soll = company.effectiveOf(db.getCompany(cid), b).slots;
    while (db.companyStaff(cid).length < soll) {
      const r = company.hireNpc(G, U, t, rand);
      if (!r.ok) throw new Error(`Einstellen ${b.id} gescheitert: ${r.reason}`);
    }
  };

  if (ausbau === 'kapitalist') {
    for (let i = 0; i < companyData.MAX_STUFE; i++) {
      const r = await company.upgrade(G, U, now);
      if (!r.ok) throw new Error(`Ausbau ${b.id} Stufe ${i + 1} gescheitert: ${r.reason}`);
    }
    for (const e of b.extras) {
      const r = await company.buyExtra(G, U, e.id, now);
      if (!r.ok) throw new Error(`Ausbau ${b.id} Extra ${e.id} gescheitert: ${r.reason}`);
    }
  }
  besetzen(now);

  /*
   * Aufsteiger: Die Gründung ist bezahlt (aus dem 500-Mio-Fake), ab jetzt
   * zählt nur noch, was die Firma abwirft. `konto[U]` beginnt bei null, und
   * `getBalance` sieht für U NUR dieses Konto – jeder Kauf muss aus Entnahmen
   * bezahlt sein. Der Fake für alle anderen bleibt, wie er ist.
   */
  const altGetBalance = unb.getBalance;
  if (ausbau === 'aufsteiger') {
    konto[U] = 0;
    unb.getBalance = async (g, u) => (u === U
      ? { cash: konto[u] ?? 0, bank: 0, total: konto[u] ?? 0 }
      : altGetBalance(g, u));
  }

  /** Standard-Einkauf: das Lager beim NPC-Markt voll machen. */
  const npcKauf = async (t, d) => {
    const k = await company.buyStock(G, U, 'voll', t);
    if (!k.ok) throw new Error(`Einkauf ${b.id} an Tag ${d + 1} abgelehnt: ${k.reason}`);
    return { units: k.units, cost: k.cost, handel: 0, ersparnis: 0 };
  };

  const gewinn = [];
  let entnommen = 0;
  let amortTage = null;
  let stufe5Tag = null;
  let vollTag = null;
  let werbungLief = false;
  let ereignisTage = 0;
  let vorfaelle = 0;
  let zuTage = 0;
  let best = 0;
  let nachschuss = 0;
  let nachschussTage = 0;
  let werbungAus = 0;
  let wareEinkauf = f.starter.cost;    // Taler für Einkäufe ins Lager – die Erstausstattung ist der erste
  let einkaufAus = 0;                  // Tage, an denen „voll" an der Kasse scheiterte
  let wareAdhoc = 0;                   // Taler ad hoc (NPC-Schichten und Anpacken ohne Lager)
  let einheiten = 0;                   // verbrauchte Einheiten insgesamt
  let adhocEinheiten = 0;              // … davon ad hoc
  let gekauftNpc = 0;                  // Einheiten im Lauf beim NPC gekauft (ohne Erstausstattung)
  let bestGewinn = -Infinity;          // bester Tag (Kasse abends minus morgens)
  let bestNetto = -Infinity;           // bester Tag mit der verbrauchten Ware zum Einkaufspreis (§3-Prüfwert)
  let bestTag = null;                  // … und seine Buchungen (für die Handprüfung)
  let ereignisDecke = ereignisDeckeVon(db.getCompany(cid));
  // Handel (Stück 3b): Käuferseite (bezogen, Ersparnis) und Spediteurseite (geliefert, Spanne).
  // Eine Firma hat je Lauf nur eine Rolle (Verkäufer ODER Käufer) – `tage`/`decke` zählen
  // also nie beide Seiten derselben Firma zugleich.
  const handel = { einheiten: 0, ersparnis: 0, bestErsparnis: 0, bestErsparnisEinheiten: 0, bestErsparnisTag: 0,
    geliefert: 0, spanne: 0, bestSpanne: 0, bestSpanneEinheiten: 0, tage: 0, zu: 0 };
  // Was der Morgen dem Abend hinterlässt.
  let tag = null;

  /** Beförderung, Nachschuss, Werbung, Einkauf, Anpacken. */
  async function morgen(d) {
    // Ab Tag 30 wird jeder unter Schichtleiter befördert – auch später eingestellte.
    if (d >= 30) {
      for (const s of db.companyStaff(cid)) {
        for (let k = s.rank; k < top; k++) company.promote(G, U, s.id, +1, now);
      }
    }
    // Nachschuss (nur mit Ereignissen, erst nachdem die erste Kampagne lief): Ereignisse und
    // Schließungen drücken die Kasse unter die Werbekosten oder ins Minus. Der Inhaber zahlt
    // ein, was fehlt – bis zu den Werbekosten, wenn heute eine Kampagne ansteht, sonst bis
    // null (Löhne sind Verbindlichkeiten, unbezahlte NPCs kündigen) – und höchstens, was er
    // hat (der Aufsteiger hat anfangs nichts). Ohne Ereignisse fehlt nie etwas.
    {
      const c0 = db.getCompany(cid);
      const zuHeute = now < (c0.closed_until ?? 0);
      const faellig = werbungLief && !zuHeute && c0.werbung_until <= now;
      const soll = faellig ? reserveWerbung : 0;
      const kann = Math.max(0, Math.floor((await unb.getBalance(G, U)).total));
      const fehlt = Math.min(soll - c0.kasse, kann);
      if (ereignisse && werbungLief && fehlt > 0) {
        const ein = await company.deposit(G, U, fehlt, now);
        if (!ein.ok) throw new Error(`Nachschuss ${b.id} an Tag ${d + 1} gescheitert: ${ein.reason}`);
        nachschuss += fehlt; nachschussTage++;
      }
    }
    // Tagesbeginn NACH dem Nachschuss: Ein- und Auszahlungen sind Umbuchungen, kein Gewinn.
    const c1 = db.getCompany(cid);
    const vor = c1.kasse;
    const spanneVor = c1.trade_profit ?? 0;
    const wb = await company.advertise(G, U, now);
    // Bis zur ersten Kampagne füllt sich die Kasse erst (Auslastung startet bei 0,3 –
    // Tag 1–3 reicht sie nicht); geschlossen (`locked`) ist erlaubt; mit Ereignissen darf
    // die Kasse auch später fehlen, wenn der Nachschuss nicht reichte (gezählt). In der
    // Anlaufphase (Tag < 30) darf sie auch ohne Ereignisse fehlen: Die Erstausstattung
    // (Nachtrag) lässt die erste Kampagne früher zünden (Baufirma Tag 6 bei Auslastung 0,6),
    // als der Drei-Tage-Takt sich selbst trägt – an Tag 12 fehlen 2.000 von 90.000 (gezählt).
    // Jede andere Absage wäre ein Fehler, der laut sein soll.
    if (wb.ok) werbungLief = true;
    if (wb.reason === 'kasse' && werbungLief) werbungAus++;
    if (!(wb.ok || wb.reason === 'running' || wb.reason === 'locked'
      || (wb.reason === 'kasse' && (!werbungLief || ereignisse || d < 30)))) {
      throw new Error(`Werbung ${b.id} an Tag ${d + 1} abgelehnt: ${wb.reason}`);
    }
    // Einkauf (Stück 3a), nach der Werbung: täglich das Lager voll, solange der Tagespreis
    // nicht über dem Start liegt – am ersten Tag mit Geld ein ganzes Lager, danach den Verbrauch
    // von gestern. Den Tagesverbrauch hat die Entnahme gestern in der Kasse gelassen; ein
    // größerer Einkauf (erstes Füllen, Lücke nach ad hoc) muss die Werbekosten in der Kasse
    // lassen, sonst fehlt in zwei Tagen die Kampagne (Baufirma: Lager 95.200, Werbung 90.000,
    // Tagesgewinn 61.400). Reicht es nicht, kaufen die Schichten heute ad hoc (gezählt).
    // Mit `kaufen` (Handelslauf) entscheidet dieselbe Kassenprüfung zum NPC-Preis, gekauft
    // wird dann zuerst beim Spediteur.
    let kauf = { units: 0, cost: 0, handel: 0, ersparnis: 0 };
    {
      const st = company.status(G, U, now);
      const fehlt = st.ware.capacity - st.ware.stock;
      if (st.ware.ratio <= 1 && fehlt > 0) {
        const behalten = fehlt > st.ware.perDay ? reserveWerbung : 0;
        if (st.kasse - fehlt * st.ware.price >= behalten) {
          kauf = await (kaufen ?? npcKauf)(now, d, st);
          wareEinkauf += kauf.cost;
          gekauftNpc += kauf.units - kauf.handel;
          if (kauf.handel > 0) {
            handel.einheiten += kauf.handel; handel.ersparnis += kauf.ersparnis; handel.tage++;
            if (kauf.ersparnis > handel.bestErsparnis) {
              handel.bestErsparnis = kauf.ersparnis; handel.bestErsparnisEinheiten = kauf.handel; handel.bestErsparnisTag = d;
            }
          }
          if (kauf.zu) handel.zu++;
        } else {
          einkaufAus++;
        }
      }
    }
    let anpacken = 0;
    let anpackenAdhocCost = 0;
    for (let i = 0; i < companyData.MAX_PITCH_PER_DAY; i++) {
      const r = await company.pitchIn(G, U, now + i * 60_000);
      if (!r.ok) break;                 // Zeit alle, Tageslimit oder geschlossen
      anpacken++;
      einheiten++;
      if (r.ware.adhoc) { adhocEinheiten++; wareAdhoc += r.ware.cost; anpackenAdhocCost += r.ware.cost; }
    }
    tag = { vor, spanneVor, wb, kauf, anpacken, anpackenAdhocCost };
  }

  /** Abrechnung, Vorfall, Nachbesetzung, Tagesgewinn, Entnahme. */
  async function abend(d) {
    const { vor, spanneVor, wb, kauf, anpacken, anpackenAdhocCost } = tag;
    const vorAbrechnung = db.getCompany(cid).kasse;
    const s = company.settle(cid, now + DAY, ereignisRand);
    einheiten += s.ware.units;
    adhocEinheiten += s.ware.adhoc;
    wareAdhoc += s.ware.cost;
    const nachAbrechnung = db.getCompany(cid);
    if (!nachAbrechnung || nachAbrechnung.status !== 'open') throw new Error(`Firma ${b.id} an Tag ${d + 1} geschlossen (${nachAbrechnung?.closed_why})`);
    ereignisTage += s.news.length;
    if (s.incident) vorfaelle++;
    if ((nachAbrechnung.closed_until ?? 0) >= now + DAY) zuTage++;
    if (s.umsatz > best) best = s.umsatz;

    // Ein offener Vorfall wird sofort entschieden – zufällige Option, nie verkaufen.
    // Sein Ausgang (Kassenabzug, Schließung, Kündigung) zählt zum Gewinn dieses Tages.
    if (ereignisse) {
      const open = decisions.pending(G, U, now + DAY);
      if (open?.platform === 'company') {
        const opts = open.decision.options.filter((o) => !o.outcomes.some((x) => x.sell));
        const o = opts[Math.min(opts.length - 1, Math.floor(rand() * opts.length))];
        const ch = await decisions.choose(G, U, open.id, o.id, now + DAY + 1, rand);
        if (!ch.ok) throw new Error(`Vorfall ${b.id} an Tag ${d + 1}: ${ch.reason}`);
        if (!db.getCompany(cid) || db.getCompany(cid).status !== 'open') throw new Error(`Firma ${b.id} an Tag ${d + 1} durch Vorfall geschlossen`);
      }
    }
    besetzen(now + DAY);                // Kündigungen (Ereignis, Vorfall, unbezahlt) nachbesetzen
    const c = db.getCompany(cid);
    gewinn.push(c.kasse - vor);
    // Spediteurseite: was heute an Spanne in die Kasse kam (Kasse → Kasse, im Tagesgewinn enthalten).
    const spanne = (c.trade_profit ?? 0) - spanneVor;
    const geliefertHeute = (c.trade_units ?? 0) - handel.geliefert;
    handel.geliefert = c.trade_units ?? 0;
    if (spanne > 0) {
      handel.spanne += spanne; handel.tage++;
      if (spanne > handel.bestSpanne) { handel.bestSpanne = spanne; handel.bestSpanneEinheiten = geliefertHeute; }
    }
    // §3-Prüfwert: der Tag mit der Ware, die er verbraucht hat, zum Preis des heutigen Einkaufs
    // (ohne Handel der Einheitspreis) – statt mit dem, was er zufällig eingekauft hat (das erste
    // Füllen, die Lücke nach einem Ausbau oder ein übersprungener Einkauf verschieben
    // Warenkosten zwischen den Tagen).
    const preisHeute = kauf.units > 0 ? kauf.cost / kauf.units : unit;
    const netto = c.kasse - vor + kauf.cost - (anpacken + s.ware.units) * preisHeute + s.ware.cost + anpackenAdhocCost;
    if (netto > bestNetto) {
      bestNetto = netto;
      bestTag = { tag: d + 1, vor, kauf, werbung: wb.ok ? wb.cost : 0, anpacken, umsatz: s.umsatz, loehne: s.loehne,
        ware: s.ware, kasse: c.kasse, stock: c.stock ?? 0, netto };
    }
    if (c.kasse - vor > bestGewinn) bestGewinn = c.kasse - vor;
    if (trace) {
      trace({ tag: d + 1, vor, kauf, werbung: wb.ok ? wb.cost : 0, anpacken,
        vorAbrechnung, umsatz: s.umsatz, loehne: s.loehne, ware: s.ware, news: s.news.length,
        spanne, kasse: c.kasse, stock: c.stock ?? 0, stockCost: c.stock_cost ?? 0 });
    }

    // Die Entnahme lässt Werbung und den nächsten Einkauf in der Kasse (Stück 3a).
    {
      const w = company.wareOf(G, b);
      const frei = company.capacityOf(b, company.effectiveOf(c, b)) - (c.stock ?? 0);
      reserve = reserveWerbung + (w.ratio <= 1 ? frei * w.price : 0);
    }
    const frei = Math.floor(c.kasse - reserve);
    if (frei > 0) {
      const en = await company.withdraw(G, U, frei, now + DAY);
      if (!en.ok) throw new Error(`Entnahme ${b.id} an Tag ${d + 1} gescheitert: ${en.reason}`);
      entnommen += frei;
      if (amortTage === null && entnommen - nachschuss > investition) amortTage = d + 1;
    }
  }

  /** Aufsteiger: erst die Leiter, dann die Extras – so lange, wie das Konto reicht. */
  async function aufstieg(d) {
    for (;;) {
      const cur = db.getCompany(cid);
      const guthaben = konto[U] ?? 0;
      const st = company.nextStufe(cur, b);
      if (st && st.price <= guthaben) {
        const r = await company.upgrade(G, U, now + DAY);
        if (!r.ok) throw new Error(`Aufsteiger ${b.id} Stufe ${st.id} an Tag ${d + 1}: ${r.reason}`);
        continue;
      }
      const gekauft = db.companyExtras(cid);
      const offen = b.extras
        .filter((e) => !gekauft.includes(e.id) && cur.stufe >= e.minStufe && e.price <= guthaben)
        .sort((x, y) => x.price - y.price);
      if (!offen.length) break;
      const r = await company.buyExtra(G, U, offen[0].id, now + DAY);
      if (!r.ok) throw new Error(`Aufsteiger ${b.id} Extra ${offen[0].id} an Tag ${d + 1}: ${r.reason}`);
    }
    besetzen(now + DAY);
    const cur = db.getCompany(cid);
    ereignisDecke = Math.max(ereignisDecke, ereignisDeckeVon(cur));
    if (stufe5Tag === null && cur.stufe >= companyData.MAX_STUFE) stufe5Tag = d + 1;
    if (vollTag === null && cur.stufe >= companyData.MAX_STUFE
      && db.companyExtras(cid).length === b.extras.length) vollTag = d + 1;
  }

  /** §3-Prüfungen und stille Nullen, dann das Ergebnis. */
  function ergebnis(tage) {
    const c = db.getCompany(cid);
    // §3: kein Tag über der Ereignis-Decke. Toleranz: die Abrechnung rundet round(x × 1,15)
    // je Schicht, die Decke round(x) × 1,15 – Unterschied höchstens 0,8 je Schicht (nachgerechnet
    // über alle Branchen, Stufen und Extras), also 1 je Schicht.
    const eff = company.effectiveOf(c, b);
    const schichten = eff.slots * companyData.NPC_SHIFTS;
    if (best > ereignisDecke + schichten) {
      throw new Error(`Firma ${b.id}: NPC-Umsatz ${de(best)} über der Ereignis-Decke ${de(ereignisDecke)}`);
    }
    // Handels-Decke (§3, Stück 3b): Spediteur Kapazität × größte Spanne (Club 480 → 48),
    // Käufer 0,1 × Tagesverbrauch × Einheitspreis – nur, wenn wirklich gehandelt wurde.
    const maxSpanne = Math.max(...companyData.BRANCHES.map((x) => {
      const u = company.wareUnit(x);
      return u - Math.round(u * (1 - companyData.HANDEL_RABATT));
    }));
    handel.geliefert = c.trade_units ?? 0;
    handel.decke = handel.geliefert > 0 ? eff.slots * companyData.HANDEL_KAPAZITAET * maxSpanne
      : handel.einheiten > 0 ? Math.round(companyData.HANDEL_RABATT * (schichten + companyData.MAX_PITCH_PER_DAY) * unit) : 0;
    // Tagesverbrauch des Käufers (wie `st.ware.perDay` in `morgen`) – Referenz, um einen
    // Nachkauf über mehrere Tage vom normalen Tagesgeschäft zu unterscheiden (s. u.).
    handel.perDay = schichten + companyData.MAX_PITCH_PER_DAY;
    handel.anteil = handel.einheiten + gekauftNpc + adhocEinheiten > 0
      ? handel.einheiten / (handel.einheiten + gekauftNpc + adhocEinheiten) : 0;
    handel.gekauftNpc = gekauftNpc;
    // §3 mit Waren: Ohne Ereignisse liegt kein Tag über der Decke, wenn man ihm die verbrauchte
    // Ware zum Einkaufspreis anrechnet (`bestNetto`); mit Handel kommt die Handels-Decke dazu.
    // Toleranz wie oben: Rundung je Schicht.
    if (!ereignisse && bestNetto > decke + handel.decke + schichten + companyData.MAX_PITCH_PER_DAY) {
      throw new Error(`Firma ${b.id}: Tagesgewinn ${de(bestNetto)} über der Decke ${de(decke)} + Handels-Decke ${de(handel.decke)}: ${JSON.stringify(bestTag)}`);
    }

    // Stille Null abfangen: Entnahmen müssen im Konto unter „Entnahme" auftauchen, Nachschuss unter „Einzahlung".
    const gezaehlt = quellen[U]?.Entnahme ?? 0;
    if (Math.round(gezaehlt) !== Math.round(entnommen)) {
      throw new Error(`Firma ${b.id}: ${de(entnommen)} entnommen, aber ${de(gezaehlt)} im Konto gezählt`);
    }
    if (Math.round(-(quellen[U]?.Einzahlung ?? 0)) !== Math.round(nachschuss)) {
      throw new Error(`Firma ${b.id}: ${de(nachschuss)} nachgeschossen, aber ${de(-(quellen[U]?.Einzahlung ?? 0))} im Konto gezählt`);
    }
    if (ausbau === 'aufsteiger') {
      // Zweite stille Null: Was der Aufsteiger gekauft hat, muss im Konto als „Ausbau" stehen.
      const ausgegeben = -(quellen[U]?.Ausbau ?? 0);
      const soll = b.stufen.slice(0, c.stufe).reduce((s, st) => s + st.price, 0)
        + db.companyExtras(cid).reduce((s, id) => s + companyData.extraById(id).price, 0);
      if (Math.round(ausgegeben) !== Math.round(soll)) {
        throw new Error(`Aufsteiger ${b.id}: Ausbau ${de(soll)} gekauft, aber ${de(ausgegeben)} im Konto gezählt`);
      }
    }
    // Dritte stille Null (Handel): die Spanne in der Kasse muss dem Zähler an der Firma entsprechen.
    if (Math.round(handel.spanne) !== Math.round(c.trade_profit ?? 0)) {
      throw new Error(`Firma ${b.id}: Spanne ${de(handel.spanne)} gezählt, aber ${de(c.trade_profit ?? 0)} an der Firma`);
    }
    const lagerEnde = c.stock_cost ?? 0;
    // Firmenwert (Stück 4): Substanz (Ausbau + Kasse + Lager) und Ertragswert
    // (gleitender Tagesgewinn × ERTRAG_FAKTOR) am Ende des Laufs, dazu die rohe
    // `profit_ema` – damit die Docs-Zahl gegen den Median/Tag prüfbar ist.
    const wert = { ...company.valueOf(cid), profitEma: c.profit_ema ?? 0 };
    return {
      wert,
      median: median(gewinn), decke, amortTage, entnommen, stufe5Tag, vollTag,
      endeProTag: median(gewinn.slice(-30)),
      ereignisTage, vorfaelle, zuTage, best, ereignisDecke, nachschuss, nachschussTage, werbungAus,
      wareProTag: (wareEinkauf - lagerEnde + wareAdhoc) / tage, wareEinkauf, wareAdhoc, lagerEnde,
      einheiten, adhocEinheiten, adhocAnteil: einheiten ? adhocEinheiten / einheiten : 0, bestGewinn, bestNetto, bestTag, einkaufAus,
      handel: { ...handel },
    };
  }

  return {
    cid, b, G, U, ausbau,
    get now() { return now; },
    morgen, abend, aufstieg, ergebnis,
    naechsterTag() { now += DAY; },
    schliessen() { unb.getBalance = altGetBalance; },
  };
}

/** Eine Firma allein über `tage` Tage – siehe `betrieb`. */
async function firmenlauf(branchId, tage, opts = {}) {
  const f = await betrieb(branchId, opts);
  try {
    for (let d = 0; d < tage; d++) {
      await f.morgen(d);
      await f.abend(d);
      if (f.ausbau === 'aufsteiger') await f.aufstieg(d);
      f.naechsterTag();
    }
  } finally {
    f.schliessen();
  }
  return f.ergebnis(tage);
}

/**
 * Handel (Stück 3b): eine Spedition (Kern) und eine Baufirma (Kern) in EINER Welt.
 * Die Spedition setzt am ersten Tag `alle 95` (95 % des NPC-Tagespreises, Großhandel
 * 90 % – Spanne 5 %: Baufirma-Ware 340 → 323 statt 340, Spanne 17 je Einheit); beide
 * fahren den Tagesablauf aus `betrieb` mit eigenem festen Würfel (je Firma `rng(4242)`,
 * also dieselben Ereignisse wie ihr `firmenlauf`-Gegenstück). Der Käufer kauft morgens
 * zuerst beim Spediteur (`buyFromTrader 'voll'`, begrenzt durch dessen Tageskapazität
 * 10 × 20 = 200) und macht den Rest beim NPC voll; ist der Spediteur zu (Vorfall),
 * weicht er ganz auf den NPC aus (gezählt in `handel.zu`). Reihenfolge je Tag:
 * Spediteur-Morgen, Käufer-Morgen (hier fließt die Spanne), Spediteur-Abend,
 * Käufer-Abend – so steht die Spanne im Tagesgewinn des Spediteurs, nicht nach
 * seiner Entnahme.
 *
 * @returns {{spediteur:object, kaeufer:object}} je das Ergebnis von `betrieb.ergebnis`.
 */
async function handelslauf(tage, { ereignisse = !OHNE_EREIGNISSE, trace = {} } = {}) {
  const G = welt(`handel_${ereignisse ? 'mit' : 'ohne'}`);
  const spediteur = await betrieb('spedition', { ereignisse, welt: G, user: `fx:handel_spedition_${ereignisse ? 'mit' : 'ohne'}`,
    name: 'Mess-Spedition', trace: trace.spedition ?? null });
  const angebot = company.setOffer(G, spediteur.U, 'alle', 95, spediteur.now);
  if (!angebot.ok) throw new Error(`Angebot der Spedition abgelehnt: ${angebot.reason}`);

  const kaeuferU = `fx:handel_baufirma_${ereignisse ? 'mit' : 'ohne'}`;
  /** Zuerst beim Spediteur, den Rest beim NPC. */
  const kaufen = async (t, d, st) => {
    const kauf = { units: 0, cost: 0, handel: 0, ersparnis: 0, zu: false };
    const h = await company.buyFromTrader(G, kaeuferU, spediteur.cid, 'voll', t);
    if (h.ok) {
      kauf.units += h.units; kauf.cost += h.cost; kauf.handel = h.units;
      kauf.ersparnis = h.units * (st.ware.price - h.price);
      kauf.preis = h.price; kauf.grosshandel = h.wholesale; kauf.spanne = h.spread;
    } else if (h.reason === 'trader') {
      kauf.zu = true;                   // Spediteur geschlossen – heute alles beim NPC
    } else if (h.reason !== 'capacity') {
      throw new Error(`Kauf beim Spediteur an Tag ${d + 1} abgelehnt: ${h.reason}`);
    }
    const rest = company.status(G, kaeuferU, t);
    if (rest.ware.capacity - rest.ware.stock > 0) {
      const k = await company.buyStock(G, kaeuferU, 'voll', t);
      if (!k.ok) throw new Error(`Einkauf Baufirma an Tag ${d + 1} abgelehnt: ${k.reason}`);
      kauf.units += k.units; kauf.cost += k.cost;
    }
    return kauf;
  };
  const kaeufer = await betrieb('baufirma', { ereignisse, welt: G, user: kaeuferU, name: 'Mess-Baufirma', kaufen,
    trace: trace.baufirma ?? null });

  try {
    for (let d = 0; d < tage; d++) {
      await spediteur.morgen(d);
      await kaeufer.morgen(d);
      await spediteur.abend(d);
      await kaeufer.abend(d);
      spediteur.naechsterTag();
      kaeufer.naechsterTag();
    }
  } finally {
    spediteur.schliessen();
    kaeufer.schliessen();
  }
  return { spediteur: spediteur.ergebnis(tage), kaeufer: kaeufer.ergebnis(tage) };
}

// ------------------------------------------------------------ Nachfrage-Drift

/**
 * Nachfrage-Drift (Stück 3c): Drei Welten, derselbe Würfel, `tage` Tage Börse je 48 Takte
 * am Tag – in Welt 0 wird für BETO nichts nachgefragt, in Welt 40 täglich 40 Einheiten
 * (eine Kern-Baufirma), in Welt 200 täglich 200 (`DEMAND_REF`, volle Wirkung). Das
 * Ganze `laeufe`-mal mit verschiedenen Seeds; Σ extra ist in jedem Lauf gleich (die
 * Nachfrage ist deterministisch), nur der Kursweg wechselt.
 *
 * Weil `step` multiplikativ ist und die Nachfrage nur als additive Drift je Takt
 * eingeht, gilt bei gleichem Würfel exakt (bis auf die Rundung auf ganze Kurse):
 *
 *     ln(p_n / p_0) = Σ extra über alle Takte
 *
 * Σ extra wird mitgezählt (`demandOf().extra` × simulierte Takte je Tag) und gegen die
 * geschlossene Form e^(DEMAND_CAP × 48 × 365) gestellt. Die EMA (7 Tage) läuft an: Am
 * ersten Tag wirkt nur 1/7 der Nachfrage, nach 15 Tagen 90 % – deshalb liegt Σ extra
 * um sechs Tage Drift unter dem geschlossenen Wert.
 *
 * Rundungsrauschen: Jeder Takt rundet auf ganze Einheiten – relativer Fehler
 * gleichverteilt in ±0,5/Kurs, Varianz 1/(12 × Kurs²) je Takt und Welt; die Differenz
 * ln(p_n/p_0) zweier Welten sammelt beide als Irrfahrt: σ² = Σ_Takte 1/12 × (1/p_n² +
 * 1/p_0²), hier mit dem Tageskurs gerechnet. Bei Kurs 1.750 sind das ~3 % über 17.520
 * Takte; fällt der Kurs, mehr. Erst das Mittel über die Seeds macht die Identität
 * scharf: Erwartung 0 ± σ/√Läufe.
 */
async function nachfragelauf(laeufe, tage) {
  const wallstreet = require('../src/wallstreet');
  const SYMBOL = 'BETO';
  const { start: startkurs, sigma: sigmaBeto } = require('../src/data/wallstreet').find(SYMBOL);
  const TAKTE = DAY / wallstreet.TICK_MS;                   // 48
  const start = new Date(); start.setHours(12, 0, 0, 0);    // Mittag: ±1 h Sommerzeit ändert das Datum nicht
  const t0 = start.getTime();
  const cap = wallstreet.DEMAND_CAP, ref = wallstreet.DEMAND_REF;
  const f4 = (n) => n.toFixed(4).replace('.', ',');
  const pz = (n) => ((n - 1) * 100).toFixed(1).replace('.', ',') + ' %';
  const vz = (n) => (n >= 0 ? '+' : '−') + f4(Math.abs(n));
  const geschlossen = (u) => Math.exp(cap * Math.min(1, u / ref) * TAKTE * tage);

  /** Eine Welt: `units` je Tag, Würfel `seed` → Endkurs, Σ extra, Tageskurse. */
  const welt3c = async (units, seed) => {
    const G = welt(`nachfrage_${units}_${seed}`);
    const rand = rng(seed);
    await wallstreet.advance(G, t0, rand);                  // erster Aufruf: merkt nur den Takt
    let sumExtra = 0, takte = 0, ereignisse = 0;
    const kurse = [], marken = [];
    for (let tag = 1; tag <= tage; tag++) {
      const now = t0 + tag * DAY;
      if (units > 0) wallstreet.recordDemand(G, SYMBOL, units, now);
      const d = wallstreet.demandOf(G, SYMBOL, now);
      const r = await wallstreet.advance(G, now, rand);
      if (r.simulated !== TAKTE) throw new Error(`Tag ${tag}: ${r.simulated} Takte statt ${TAKTE}`);
      sumExtra += d.extra * r.simulated;
      takte += r.simulated;
      ereignisse += r.news.filter((n) => n.symbol === SYMBOL && n.event).length;
      kurse.push(db.getPrice(G, SYMBOL).price);
      if (tag === 1 || tag === 7 || tag === 15 || tag === 30) marken.push({ tag, emaNow: d.emaNow, extra: d.extra });
    }
    return { units, seed, end: kurse[kurse.length - 1], sumExtra, takte, ereignisse, kurse, marken,
      kursMittel: kurse.reduce((s, p) => s + p, 0) / kurse.length, kursMin: Math.min(...kurse), kursMax: Math.max(...kurse) };
  };
  /** Rundungs-σ der Differenz ln(p_a/p_b) aus den Tageskursen beider Welten. */
  const rundung = (a, b) => Math.sqrt(a.kurse.reduce((s, p, i) => s + (TAKTE / 12) * (1 / (p * p) + 1 / (b.kurse[i] ** 2)), 0));

  console.log(`  Deckel DEMAND_CAP ${String(cap).replace('.', ',')} je Takt (= DRIFT_CAP ${String(wallstreet.DRIFT_CAP).replace('.', ',')} / 2), ` +
    `volle Wirkung ab DEMAND_REF ${ref} Einheiten/Tag, EMA ${wallstreet.DEMAND_EMA_DAYS} Tage; ` +
    `${TAKTE} Takte/Tag, ${tage} Tage = ${de(TAKTE * tage)} Takte; BETO Start ${de(startkurs)}, σ ${String(sigmaBeto).replace('.', ',')} je Takt; ` +
    `${laeufe} Seeds, je Seed derselbe Würfel in den drei Welten 0 / 40 / 200 Einheiten am Tag.`);
  console.log(`  Geschlossene Form (Nachfrage vom ersten Takt an voll wirksam): ` +
    `200/Tag e^(${String(cap).replace('.', ',')} × ${TAKTE} × ${tage}) = e^${f4(cap * TAKTE * tage)} = ${f4(geschlossen(200))} (${pz(geschlossen(200))}) · ` +
    `40/Tag e^${f4(cap * 0.2 * TAKTE * tage)} = ${f4(geschlossen(40))} (${pz(geschlossen(40))}).`);

  const ergebnisse = [];                                    // je Seed { p0, p40, p200 }
  for (let i = 0; i < laeufe; i++) {
    const seed = 20260921 + i;
    const p0 = await welt3c(0, seed), p40 = await welt3c(40, seed), p200 = await welt3c(200, seed);
    ergebnisse.push({ seed, p0, p40, p200 });
  }
  const erster = ergebnisse[0];
  const anlauf = (w) => w.marken.map((m) => `Tag ${m.tag}: ${m.emaNow.toFixed(1).replace('.', ',')} → ${m.extra.toExponential(2).replace('.', ',')}`).join(', ');
  console.log(`  Anlauf der EMA (emaNow Einheiten/Tag → extra je Takt): 40/Tag ${anlauf(erster.p40)} · 200/Tag ${anlauf(erster.p200)}.`);
  for (const w of [erster.p40, erster.p200]) {
    const luecke = cap * Math.min(1, w.units / ref) * TAKTE * tage - w.sumExtra;
    console.log(`  Σ extra ${w.units}/Tag: ${f4(w.sumExtra)} über ${de(w.takte)} Takte → e^Σ = ${f4(Math.exp(w.sumExtra))} ` +
      `(geschlossene Form ${f4(geschlossen(w.units))}, Anlauf-Lücke ${f4(luecke)} = ${(luecke / (cap * Math.min(1, w.units / ref) * TAKTE)).toFixed(1).replace('.', ',')} Tage Drift).`);
  }

  console.log(`
  Je Seed (Endkurse p0 · p40 · p200; Verhältnis, ln, Abweichung von Σ extra in Rundungs-σ):`);
  const abw = { 40: [], 200: [] }, sig = { 40: [], 200: [] };
  for (const e of ergebnisse) {
    const teil = (w) => {
      const ratio = w.end / e.p0.end, ln = Math.log(ratio), s = rundung(w, e.p0), d = ln - w.sumExtra;
      abw[w.units].push(d); sig[w.units].push(s);
      return `p${w.units}/p0 ${f4(ratio)} (ln ${f4(ln)}, ${vz(d)} = ${(Math.abs(d) / s).toFixed(1).replace('.', ',')} σ, σ ${f4(s)})`;
    };
    console.log(`  Seed ${e.seed}: ${de(e.p0.end).padStart(6)} · ${de(e.p40.end).padStart(6)} · ${de(e.p200.end).padStart(6)}   ` +
      `${teil(e.p40)} · ${teil(e.p200)}   Kurs Ø ${de(e.p0.kursMittel)} (${de(e.p0.kursMin)} … ${de(e.p0.kursMax)}), Ereignisse BETO ${e.p0.ereignisse}`);
  }
  const mittel = (xs) => xs.reduce((s, x) => s + x, 0) / xs.length;
  const median = (xs) => quantil(xs, 0.5);
  for (const u of [40, 200]) {
    const ratios = ergebnisse.map((e) => e[`p${u}`].end / e.p0.end);
    const sumExtra = erster[`p${u}`].sumExtra;
    // σ des Mittels: √(Σ σ_i²)/n – die Seeds sind unabhängig.
    const sigMittel = Math.sqrt(sig[u].reduce((s, x) => s + x * x, 0)) / sig[u].length;
    console.log(`  p${u}/p0 über ${laeufe} Seeds: Median ${f4(median(ratios))}, Mittel ${f4(mittel(ratios))}, ` +
      `${f4(Math.min(...ratios))} … ${f4(Math.max(...ratios))}; ` +
      `Mittel der Abweichung ln − Σ extra = ${vz(mittel(abw[u]))} bei erwarteter Rundungs-σ des Mittels ${f4(sigMittel)} ` +
      `(${(Math.abs(mittel(abw[u])) / sigMittel).toFixed(1).replace('.', ',')} σ) → Erwartung e^Σ = ${f4(Math.exp(sumExtra))}, geschlossene Form ${f4(geschlossen(u))}.`);
  }
}

// ------------------------------------------------------------ Heists

/**
 * Der Heist braucht keine Simulation – sein Erwartungswert ist geschlossen
 * ausrechenbar. Beute geteilt durch die Crew, Strafe trägt jeder voll,
 * Wartezeit ist das Maximum aus Sperre und Knast (sie laufen parallel).
 */
function heists() {
  const gear = heistData.GEAR_TIERS ?? heistData.TIERS ?? [];
  const top = gear[gear.length - 1] ?? { risk: 0 };
  const preps = heistData.PREPS ?? [];
  const orte = heistData.LOCATIONS ?? heistData.HEISTS ?? [];
  // Sperre je Ziel (data/heists.js). Frueher eine Zahl fuer alle sieben.

  return orte.map((loc) => {
    const done = (loc.preps ?? []).map((id) => preps.find((p) => p.id === id)).filter(Boolean);
    const crew = loc.minCrew;
    const chance = heist.oddsOf({ loc, done, tier: top, crewSize: crew, heat: 0 }).chance;
    const lootF = 1 + done.reduce((s, p) => s + (p.loot ?? 0), 0);
    const brutto = ((loc.loot[0] + loc.loot[1]) / 2) * lootF;
    const anteil = brutto / (1.15 + (crew - 1));
    const ev = chance * anteil - (1 - chance) * loc.fine;
    const sperreH = loc.cooldownH ?? 12;
    const wartenH = chance * sperreH + (1 - chance) * Math.max(sperreH, loc.jailHours);
    return { id: loc.id, chance, anteil, ev, sperreH, proTag: ev / (wartenH / 24) };
  });
}

// ------------------------------------------------------------ Ausgabe

/**
 * Verlaufsmodus: Eine lange Musikkarriere, aufgezeichnet an Meilensteinen.
 *
 * Beantwortet: Wie lange bis zu einer bestimmten Hörerzahl, wie viele
 * Follower hat der Künstler dann, und was verdient er an diesem Punkt?
 */
async function verlauf(laeufe, tage) {
  const MARKEN = [100_000, 250_000, 500_000, 1_000_000, 2_000_000, 2_600_000];
  const strat = strategien(true).find((x) => x.name === 'Reichweite zuerst +3B +K')
    ?? strategien(true)[0];
  console.log(`\n=== Verlauf einer Musikkarriere: ${laeufe} Läufe à ${tage} Tage ===`);
  console.log(`    Spielweise: "${strat.name}"\n`);

  const proMarke = {};
  for (let i = 0; i < laeufe; i++) {
    const kennung = `verlauf_${i}`;
    const r = await karriere(welt(kennung), `fx:${kennung}`, { musik: true, strat }, tage, 2000 + i, MARKEN);
    for (const [m, v] of Object.entries(r.erreicht)) (proMarke[m] ??= []).push(v);
    console.log(`    Lauf ${i + 1}: ${de(r.hoerer)} Hörer, ${de(r.follower)} Follower nach ${tage} Tagen`);
  }

  console.log(`\n  Hörer      erreicht nach   Follower dort   Ertrag/Tag dort`);
  for (const m of MARKEN) {
    const l = proMarke[m] ?? [];
    if (!l.length) { console.log(`  ${de(m).padStart(9)}   nicht erreicht`); continue; }
    const tag = median(l.map((v) => v.tag));
    console.log(`  ${de(m).padStart(9)}   ${(Math.round(tag) + ' Tagen').padStart(13)}   ` +
      `${de(median(l.map((v) => v.follower))).padStart(13)}   ${de(median(l.map((v) => v.proTag))).padStart(15)}`);
  }
  console.log();
}

/** Eine Variante (mit/ohne Kontaktpflege) über alle Seeds; die Zähler kommen mit. */
async function kontaktvariante(kennungBasis, musik, strat, laeufe, tage) {
  kz = neuerZaehler({ beziehung: true });
  const geld = [];
  const hoerer = [];
  const follower = [];
  const energie = [];
  let zaehler;
  try {
    for (let i = 0; i < laeufe; i++) {
      const kennung = `${kennungBasis}_${i}`;
      const G = welt(kennung);
      const U = `fx:${kennung}`;
      const r = await karriere(G, U, { musik, strat }, tage, 1000 + i);
      geld.push(r.geld);
      hoerer.push(r.hoerer);
      follower.push(r.follower);
      energie.push(r.energie);
    }
  } finally {
    // Auch wenn ein Lauf abbricht: Der Zähler muss weg, sonst zählen die
    // Hüllen in jeden folgenden Lauf hinein.
    zaehler = kz;
    kz = null;
  }
  return {
    geld, zaehler,
    median: median(geld), q25: quantil(geld, 0.25), q75: quantil(geld, 0.75),
    hoerer: median(hoerer), follower: median(follower),
    energie: energie.reduce((a, b) => a + b, 0) / Math.max(1, energie.length),
  };
}

const prozent = (x) => `${x >= 0 ? '+' : '−'}${Math.abs(x * 100).toFixed(1).replace('.', ',')} %`;
const komma = (x, n = 2) => x.toFixed(n).replace('.', ',');
const mittel = (a) => (a.length ? a.reduce((x, y) => x + y, 0) / a.length : 0);
/** Ein Summand mit Vorzeichen, deutsch gesetzt: +0,050 / −0,050 / ±0,000. */
const vorzeichen = (x, n = 3) => (x === 0 ? `±${(0).toFixed(n).replace('.', ',')}`
  : `${x > 0 ? '+' : '−'}${Math.abs(x).toFixed(n).replace('.', ',')}`);

/** Die Zählerzeilen einer Variante – roh, ohne Rundung auf schöne Zahlen. */
function kontaktZeilen(z, tage, laeufe) {
  const out = [];
  const n = z.versuche;
  const q = (k) => (n ? `${z.antworten[k]} (${komma((z.antworten[k] / n) * 100, 1)} %)` : `${z.antworten[k]}`);
  out.push(`Versuche ${de(n)} in ${de(tage * laeufe)} Tagen (${komma(n / (tage * laeufe), 2)}/Tag) · ` +
    `Zusage ${q('zusage')} · echte Antwort ${q('echt')} · flüchtig ${q('fluechtig')} · ignoriert ${q('ignoriert')}`);
  const abg = Object.entries(z.abgelehnt).map(([k, v]) => `${k} ${v}`).join(', ') || 'keine';
  out.push(`nicht zustande gekommen: ${abg} · Tage ohne wählbaren Kontakt ${z.nichts}`);
  const verbrauchtGesamt = z.verbraucht.release.length + z.verbraucht.creator.length + z.verbraucht.show.length;
  out.push(`Antworten mit Schub-Versuch ${de(z.schubVersuche)} · davon wirklich geschrieben ${de(z.gesetzt)} ` +
    `(${de(z.schubVersuche - z.gesetzt)} blieben liegen, weil ein stärkerer Schub derselben Art noch lief) · ` +
    `verbraucht release ${z.verbraucht.release.length}, creator ${z.verbraucht.creator.length}, ` +
    `show ${z.verbraucht.show.length} (geschrieben minus verbraucht = ${z.gesetzt - verbrauchtGesamt} verfallen oder überschrieben)`);
  const f = (a) => (a.length ? `Ø ${komma(mittel(a))} (größter ${komma(Math.max(...a))})` : 'keiner');
  out.push(`Ø Schubfaktor bei Veröffentlichungen: ${f(z.verbraucht.release)} über ${z.verbraucht.release.length} von ${de(z.publishes)} Veröffentlichungen ` +
    `→ über ALLE Veröffentlichungen Ø ${komma(z.publishes ? (z.verbraucht.release.reduce((a, b) => a + b, 0) + (z.publishes - z.verbraucht.release.length)) / z.publishes : 1)}`);
  out.push(`Ø Schubfaktor bei Creator-Aktionen: ${f(z.verbraucht.creator)} über ${z.verbraucht.creator.length} von ${de(z.akte)} Aktionen ` +
    `→ über ALLE Aktionen Ø ${komma(z.akte ? (z.verbraucht.creator.reduce((a, b) => a + b, 0) + (z.akte - z.verbraucht.creator.length)) / z.akte : 1)}`);
  out.push(`Konzert-Schübe auf der Musikseite (Hörer statt Faktor): ${z.verbraucht.show.length} von ${de(z.shows)} Konzerten verbraucht`);
  out.push(`Konzert auf der CREATOR-Seite (die Abweichung, Faktor statt Hörer): ${z.konzertCreator.length} verbraucht, ${f(z.konzertCreator)}`);
  // Gleiches gegen Gleiches: der verbrauchte Schub je Art, NICHT gegen einen
  // Durchschnitt über alle Arten. Nur so ist das Creator-Konzert vergleichbar.
  const jeArt = Object.entries(z.verbrauchtJeArt).sort((a, b) => b[1].length - a[1].length)
    .map(([k, a]) => `${k} ${f(a)} über ${a.length}`).join(' · ');
  out.push(`Ø verbrauchter Schubfaktor je Art (gleiches gegen gleiches): ${jeArt || 'keiner'}`);
  const je = Object.entries(z.proAnfrage).sort((a, b) => b[1].versuche - a[1].versuche)
    .map(([k, v]) => `${k} ${v.versuche}× (Zusage ${komma((v.zusage / v.versuche) * 100, 1)} %)`).join(' · ');
  out.push(`je Seite und Anfrageart: ${je || 'keine'}`);
  return out;
}

/**
 * Gegenprobe zur Erwartung des Stufenfaktors: `stufeVon` selbst würfeln lassen.
 *
 * `stufenVerteilung` schreibt die Gewichte aus `src/contacts.js` ein zweites
 * Mal ab (die Funktion gibt ihre Verteilung nicht heraus). Abgeschriebenes
 * glaubt man nicht, man prüft es: Hier wird die echte `contacts.stufeVon`
 * millionenfach gewürfelt und der gewürfelte Mittelwert gegen den gerechneten
 * gehalten. Weicht er um mehr als 0,002 ab, steht das als ✗ in der Ausgabe –
 * und `allesGut` ist false, damit der Aufrufer daraus einen Abbruch machen
 * kann. Ein Wächter, der grün durchläuft, ist keiner: Genau so konnte der
 * Draht-statt-Respekt-Bruch seit Stück 3 unbemerkt leben.
 */
function stufenprobe(wuerfe = 1_000_000) {
  const faelle = [
    { name: 'Taylor Swift (Verhältnis 0,0047, Respekt 15)', ratio: 562552 / 120_000_000, respekt: 15 },
    { name: 'Kontakt auf Augenhöhe (Verhältnis 1, Respekt 0)', ratio: 1, respekt: 0 },
    { name: 'knapp unter der 0,05-Schwelle', ratio: 0.049, respekt: 0 },
    { name: 'knapp über der 0,05-Schwelle', ratio: 0.051, respekt: 0 },
    { name: 'kleinerer Kontakt (0,2), Respekt 30', ratio: 0.2, respekt: 30 },
    { name: 'Weltstar ohne Respekt', ratio: 0.001, respekt: 0 },
    // Der Dämpfer: derselbe Respekt, einmal mit halbem und einmal ohne
    // Vertrauen. Ohne ihn liefen Nachbau und Produktion hier auseinander.
    { name: 'Rivale (Respekt 68, Vertrauen −50)', ratio: 0.2, respekt: 68, vertrauen: -50 },
    { name: 'Dauer-Beefer (Respekt 68, Vertrauen −100)', ratio: 0.2, respekt: 68, vertrauen: -100 },
  ];
  const out = [];
  let allesGut = true;
  for (const fall of faelle) {
    const r = rng(4711);
    let summe = 0;
    const zahl = { fluechtig: 0, echt: 0, zusage: 0 };
    for (let i = 0; i < wuerfe; i++) {
      const s = contacts.stufeVon(r,
        { ratio: fall.ratio, respekt: fall.respekt, vertrauen: fall.vertrauen ?? 0 });
      zahl[s]++;
      summe += contacts.STUFEN_FAKTOR[s];
    }
    const gewuerfelt = summe / wuerfe;
    const arg = { ratio: fall.ratio, respekt: fall.respekt, vertrauen: fall.vertrauen ?? 0 };
    const gerechnet = erwarteterStufenFaktor(arg);
    const p = stufenVerteilung(arg);
    const ok = Math.abs(gewuerfelt - gerechnet) < 0.002;
    if (!ok) allesGut = false;
    out.push(`  ${fall.name.padEnd(46)} gerechnet ${gerechnet.toFixed(5)} · gewürfelt ${gewuerfelt.toFixed(5)} ` +
      `(${de(wuerfe)} Würfe) ${ok ? '✔' : '✗ ABWEICHUNG'}`);
    out.push(`    Zusagen gerechnet ${(p.zusage * 100).toFixed(3)} % · gewürfelt ${((zahl.zusage / wuerfe) * 100).toFixed(3)} %`);
  }
  out.push(`  ${allesGut ? 'Alle Fälle stimmen überein ✔' : 'MINDESTENS EIN FALL WEICHT AB ✗'}`);
  return { zeilen: out, allesGut };
}

/**
 * Die Passung als Zahl – mit den echten Funktionen gerechnet, nicht von Hand.
 *
 * Zwei Blöcke: (a) NUR die Passung verschoben (alles andere gleich), (b) der
 * konkrete Fall aus dem Katalog mit den echten Ländern und Charakterzügen.
 * Jede Zeile sagt selbst, ob das Land gleich ist – ohne diese Angabe ist keine
 * der Zahlen nachrechenbar (der Landbonus ist +0,05).
 */
function passungsblock() {
  const MEINE = 500_000;
  const ich = { country: 'de', language: 'deutsch', genre: 'hiphop' };
  const out = [];

  const verwandt = (a, b) => contactsData.RELATED_GENRES.some(
    ([x, y]) => (x === a && y === b) || (y === a && x === b));

  const zeile = (name, c) => {
    const p = contacts.passungOf({
      meine: { language: ich.language, genre: ich.genre },
      seine: { language: c.language, genre: c.genre },
      seite: 'musik',
    });
    const sprache = ich.language === c.language ? 'gleich'
      : (ich.language === 'englisch' || c.language === 'englisch') ? 'englisch' : 'fremd';
    const genre = ich.genre === c.genre ? 'gleich' : verwandt(ich.genre, c.genre) ? 'verwandt' : 'fremd';
    const gleichesLand = c.country === ich.country;
    const arg = {
      meineReichweite: MEINE, seineReichweite: c.reach, gleichesLand, sprache, genre,
      respekt: 0, vertrauen: 0, tuerOeffner: 0, hype: 1, trait: c.trait, partner: false,
    };
    const staerke = contacts.staerkeOf({
      seineReichweite: c.reach, meineReichweite: MEINE, passung: p.passung, stufe: 'zusage' });
    const werte = ['reaktion', 'feature'].map((id) => ({
      id,
      chance: contacts.chanceOf({ ...arg, request: id }),
      faktor: contacts.boostOf(id, staerke, c.reach).factor,
    }));
    // Die Summanden einzeln, damit die Zeile von Hand nachrechenbar ist.
    const basis = Math.min(contactsData.CHANCE_MAX, 0.6 * Math.sqrt(MEINE / c.reach));
    const teile = [
      `Basis ${komma(basis, 3)} (Größe)`,
      `Respekt-Gewicht ${komma(contacts.respektGewicht(MEINE, c.reach), 3)} (×Respekt/100)`,
      `Land ${gleichesLand ? '+0,050' : '±0,000'}`,
      `Sprache ${sprache === 'gleich' ? '+0,100' : sprache === 'englisch' ? '±0,000' : '−0,150'}`,
      `Genre ${genre === 'gleich' ? '+0,050' : genre === 'verwandt' ? '±0,000' : '−0,050'}`,
      `Charakter ${c.trait} ${vorzeichen(contactsData.TRAIT_BONUS[c.trait] ?? 0, 3)}`,
    ];
    out.push(`  ${name.padEnd(34)} Passung ${komma(p.passung, 3)} · ` +
      werte.map((w) => `${w.id} ${komma(w.chance * 100, 1)} % / Faktor ${komma(w.faktor, 3)}`).join(' · ') +
      ` · Stärke ${komma(staerke, 4)}`);
    out.push(`      Summanden: ${teile.join(' · ')} · Schwierigkeit reaktion +0,150 / feature −0,100`);
  };

  out.push(`  Spieler: ${ich.country} / ${ich.language} / ${ich.genre}, ${de(MEINE)} Hörer, ` +
    `Respekt 0, Vertrauen 0, Hype 1, kein Türöffner, kein Partner.`);
  out.push('');
  out.push('  (a) NUR die Passung verschoben: derselbe Kontakt (3,2 Mio, kollegial, Land de = gleiches Land),');
  out.push('      nur Sprache und Genre getauscht.');
  zeile('gleiche Sprache, verw. Genre', { country: 'de', language: 'deutsch', genre: 'pop', reach: 3_200_000, trait: 'kollegial' });
  zeile('fremde Sprache, fremdes Genre', { country: 'de', language: 'japanisch', genre: 'jpop', reach: 3_200_000, trait: 'kollegial' });
  out.push('');
  out.push('  (b) Der konkrete Fall aus dem Katalog – echte Länder, echte Größen, echte Charakterzüge:');
  for (const id of ['ninachuba', 'yoasobi']) {
    const c = contactsData.byId(id);
    zeile(`${c.name} (${c.country}, ${c.language}, ${c.genre})`, c);
  }
  return out;
}

/** Tagesleistung einer Variante: was an einem Tag wirklich getan wurde. */
function leistung(z, tage, laeufe) {
  const n = tage * laeufe;
  return { akte: z.akte / n, publishes: z.publishes / n, shows: z.shows / n };
}

/**
 * Stück 5a: Was die Kontaktpflege bringt.
 *
 * Zwei Archetypen, je drei Varianten mit demselben Würfel und derselben
 * Strategie. Die Strategie wird je Archetyp EINMAL gesucht (ohne Kontakte) und
 * dann für alle Varianten festgehalten – sonst misst man die Strategiewahl.
 *
 * Die dritte Variante („Konzert-Vorrang") ist keine Spielempfehlung, sondern
 * das Messwerkzeug für den Konzert-Schub: Ohne Vorrang wählt ein Spieler, der
 * nach Chance × Nutzen geht, die Bühne nie (sie ist auf beiden Seiten
 * dominiert), und die Zeile bliebe eine stille Null.
 */
async function kontaktlauf(laeufe, tage) {
  const paare = [
    { titel: 'Musik+Creator', musik: true, kennung: 'kontakte_beides' },
    { titel: 'nur Creator', musik: false, kennung: 'kontakte_creator' },
    // Der reine Musiker: dieselbe Messung ohne Kanalprogramm. Er hat keine
    // Füllaktionen, die die zwei Stunden verdrängen könnten – bei ihm kostet
    // die Kontaktpflege also fast nichts, während der Release-Schub der
    // stärkste der drei ist. Ohne diesen Lauf wäre das eine Vermutung.
    { titel: 'nur Musik', musik: true, kennung: 'kontakte_musik', kanaele: false },
  ];

  for (const a of paare) {
    /*
     * Ohne Kanäle unterscheiden sich die Strategien nur noch im Konzert-Flag:
     * Reihenfolge und Bindungsstunden betreffen ausschließlich das Kanal-
     * programm. Gesucht wird deshalb nur zwischen diesen beiden – die 48
     * Varianten wären 24-mal derselbe Lauf.
     */
    const alle = a.kanaele === false
      ? strategien(true).filter((s) => s.name.startsWith('Ertrag je Zeit +0B'))
        .map((s) => ({ ...s, kanaele: false }))
      : strategien(a.musik);
    let strat;
    if (STRATEGIE && alle.some((s) => s.name === STRATEGIE)) {
      strat = alle.find((s) => s.name === STRATEGIE);
    } else {
      const such = await durchlauf(`${a.kennung}_suche`, a.musik, Math.max(2, Math.min(3, laeufe)),
        Math.min(tage, 180), alle, true);
      strat = alle.find((s) => s.name === such.strategie);
    }
    console.log(`  ${a.titel}: Strategie "${strat.name}", ${laeufe} Läufe à ${tage} Tage, Würfel rng(1000+i), ` +
      `Kontaktwürfe rng(501000+i)`);

    const ohne = await kontaktvariante(`${a.kennung}_ohne`, a.musik, { ...strat, kontakte: false }, laeufe, tage);
    const mit = await kontaktvariante(`${a.kennung}_mit`, a.musik, { ...strat, kontakte: true }, laeufe, tage);
    const kon = await kontaktvariante(`${a.kennung}_konzert`, a.musik,
      { ...strat, kontakte: true, kontaktVorrang: 'konzert' }, laeufe, tage);

    const zeile = (was, r) => `    ${was.padEnd(18)}${de(r.median / tage).padStart(10)}/Tag   ` +
      `[${de(r.q25 / tage)} … ${de(r.q75 / tage)}]   ${de(r.follower)} Follower` +
      (r.hoerer ? `, ${de(r.hoerer)} Hörer` : '') +
      ` · Energie Ø ${Math.round(r.energie * 100)} %`;
    /*
     * Gepaart auswerten: Je Seed läuft in beiden Varianten derselbe Würfel, das
     * Verhältnis je Seed ist damit die ehrlichere Zahl – es steht neben dem
     * Verhältnis der Mediane, nicht an seiner Stelle.
     */
    const diffzeile = (r) => {
      const paarweise = ohne.geld.map((g, i) => r.geld[i] / Math.max(1, g));
      return `      Differenz der Mediane ${prozent(r.median / Math.max(1, ohne.median) - 1)} · ` +
        `je Seed (gepaart) Median ${prozent(median(paarweise) - 1)}, ` +
        `Spanne ${prozent(Math.min(...paarweise) - 1)} … ${prozent(Math.max(...paarweise) - 1)}\n` +
        `      je Seed: ${paarweise.map((x) => prozent(x - 1)).join(' · ')}`;
    };

    console.log(zeile('ohne Kontakte', ohne));
    console.log(zeile('mit Kontakten', mit));
    console.log(diffzeile(mit));

    // Was die zwei Stunden gekostet haben – gezählt, nicht überschlagen.
    const lo = leistung(ohne.zaehler, tage, laeufe);
    const lm = leistung(mit.zaehler, tage, laeufe);
    console.log(`      Tagesleistung Ø/Tag: ohne ${komma(lo.akte)} Kanalaktionen · ${komma(lo.publishes)} Veröffentlichungen · ${komma(lo.shows)} Konzerte` +
      ` → mit ${komma(lm.akte)} · ${komma(lm.publishes)} · ${komma(lm.shows)}` +
      ` (${prozent(lm.akte / Math.max(1e-9, lo.akte) - 1)} Kanalaktionen)`);
    for (const l of kontaktZeilen(mit.zaehler, tage, laeufe)) console.log(`      ${l}`);
    for (const l of beziehungsZeilen(mit.zaehler.beziehung, { projekteMoeglich: false })) console.log(`      ${l}`);
    if (ohne.zaehler.versuche || ohne.zaehler.gesetzt) {
      console.log(`      KONTROLLE ohne Kontakte: Versuche ${ohne.zaehler.versuche}, Schübe ${ohne.zaehler.gesetzt} – muss 0 sein!`);
    } else {
      console.log(`      Kontrolle: im Lauf ohne Kontaktpflege 0 Versuche und 0 Schübe ✔`);
    }

    console.log(`    Konzert-Vorrang (nur zur Messung des Konzert-Schubs, keine Spielempfehlung):`);
    console.log(zeile('mit Konzert-Vorrang', kon));
    console.log(diffzeile(kon));
    for (const l of kontaktZeilen(kon.zaehler, tage, laeufe)) console.log(`      ${l}`);
    for (const l of beziehungsZeilen(kon.zaehler.beziehung, { projekteMoeglich: false })) console.log(`      ${l}`);
    console.log();
  }
}

// ---------------------------------------------------------------- Beef (5b)

/**
 * ===========================================================================
 *  BEEF ALS SPIELWEISE
 * ===========================================================================
 *
 * Gemessen wird eine einzige Frage: Was bringt der Beef (Stück 5b), wenn ein
 * Spieler ihn als Spielweise fährt – jeden Tag anstacheln, sobald keine Front
 * offen ist, und einen Disstrack veröffentlichen, sobald ein Titel da und die
 * Veröffentlichungssperre durch ist?
 *
 * Der Aufbau ist der des Kontaktlaufs aus 5a (`kontaktlauf`), mit einem
 * Unterschied, der aus dem Code kommt und nicht aus einer Entscheidung:
 *
 *   **Es gibt drei Varianten, nicht zwei.** `music.publish` zählt einen
 *   Spieler nach jeder Chart-Platzierung von selbst an (`beef.anzaehlen`) –
 *   dagegen kann er sich nicht entscheiden. Wer nie antwortet, steht in jedem
 *   dieser Beefs bei 0:1 und verliert ihn bei der Abrechnung, und eine
 *   Niederlage nimmt sieben Tage lang Hype (`BONUS_NIEDERLAGE` 0,85). Die
 *   Spielweise „ich lasse das" ist deshalb NICHT dasselbe wie „es gibt keinen
 *   Beef", und ein Lauf, der nur zwei Varianten vergleicht, verrechnet die
 *   beiden Dinge gegeneinander:
 *
 *     aus      wie vor 1.40.0: kein Anstacheln, kein Disstrack, und auch
 *              niemand, der von selbst anzählt.
 *     passiv   das Spiel, wie es ist, gespielt von einem, der die drei Knöpfe
 *              nie drückt: Er wird angezählt und schluckt es.
 *     aktiv    die gemessene Spielweise: anstacheln + Disstrack, kein Frieden.
 *
 * ---------------------------------------------------------------------------
 *  Stück 5c: zwei Spielweisen, die diese drei nicht beantworten
 * ---------------------------------------------------------------------------
 * „aktiv gegen aus" ist die SUMME aus zwei neuen Wirkungen, die sich zufällig
 * aufheben: dem Gewinn des Disstracks und dem Verlust aus den Fenstern der
 * Niederlagen, die `anzaehlen` nebenbei aufmacht. Deshalb kommen zwei
 * Varianten dazu:
 *
 *     diss_isoliert  wie „aktiv", aber `anzaehlen` ist auf BEIDEN Seiten
 *                    stillgelegt – auch in der Vergleichsgrundlage „aus", die
 *                    das seit dem ersten Lauf ist. Übrig bleibt genau ein
 *                    Unterschied: „Disstrack statt Single".
 *     sieg           die Sieg-Farm: EIN Disstrack je Front, dann auskühlen
 *                    lassen und abrechnen. Sie ist die Spielweise, die
 *                    `BONUS_SIEG` überhaupt sehen kann; „aktiv" hat in 718
 *                    Abrechnungen keinen einzigen Sieg gesehen. Siehe
 *                    `siegtag`.
 *
 * Damit die Differenz den Beef misst und nichts sonst:
 *
 *  • ALLE Varianten fahren DIESELBE Strategie (einmal gesucht, dann fest)
 *    und denselben Würfel `rng(1000 + i)` für Musik, Kanäle, Ereignisse und
 *    Vorfälle – dieselben Seeds wie im Kontaktlauf.
 *  • Alle Beefwürfe laufen über einen DRITTEN Würfel `rng(701000 + i)`:
 *    Einstieg, Häme, Kontertage, das Angezähltwerden und der Disstrack selbst.
 *    „passiv", „aktiv" und die Sieg-Farm ziehen den Anzähl-Wurf aus diesem
 *    Strom; „aus" und „diss_isoliert" ziehen ihn gar nicht – die Hülle gibt
 *    dort null zurück, ohne zu würfeln. Beides hält den Hauptstrom gleich – sonst hätte „aus"
 *    einen Wurf weniger im Hauptstrom und wäre ab der ersten
 *    Chart-Platzierung ein anderer Musiklauf.
 *  • Jede Variante bekommt eigene Welten und eigene Konten.
 *
 * Gezählt wird ausschließlich, was das Spiel selbst gemeldet hat: die
 * Rückgabewerte von `beef.anstacheln` und `beef.diss` und die Ereignisse aus
 * `beef.settle`. Das Skript rechnet keine Einstiegschance, keine Wucht und
 * keine Aufmerksamkeit nach – es nimmt die Zahlen, mit denen gewürfelt wurde.
 */

/**
 * Die Spielweisen, die einen Beeftag bekommen. „passiv" steht NICHT darin: Wer
 * nur angezählt wird, drückt keinen Knopf.
 *
 *   aktiv           anstacheln + jeden Tag Disstrack auf die heißeste Front
 *   diss_isoliert   dieselbe Spielweise, aber `anzaehlen` ist auf BEIDEN Seiten
 *                   stillgelegt (Stück 5c, siehe Hülle unten)
 *   sieg            die Sieg-Farm: ein Disstrack je Front, dann auskühlen
 */
const BEEF_SPIELWEISEN = new Set(['aktiv', 'diss_isoliert', 'sieg']);

/** Zähler des laufenden Beeflaufs – `null`, solange nicht gemessen wird. */
let bz = null;

function neuerBeefZaehler(spielweise) {
  return {
    spielweise,                     // 'aus' | 'passiv' | 'aktiv'
    rand: null,                     // der Beefwürfel des laufenden Seeds
    // Anstacheln
    einstieg: 0, blamage: 0, chancen: [],
    anstachelAb: {},                // Grund -> Anzahl
    // Disstrack
    disse: 0, haeme: 0, dissAb: {},
    aufmerksamkeit: [],             // Faktor je Disstrack (die Häme-Fälle mit 0,5 dabei)
    aufmerksamkeitOhneHaeme: [],
    wucht: [], hitzeBeiDiss: [],
    offenBeiDiss: [],               // offene Fronten im Moment des Disstracks
    // Fremder Anlass und Ausgang
    angezaehlt: 0, konter: 0,
    ende: { sieg: 0, niederlage: 0, unentschieden: 0 },
    /*
     * Der erste Lauf hat für die aktive Spielweise eine Siegquote von 0,0 %
     * über 136 Abrechnungen gemeldet – eine Null, die erklärt werden muss.
     * Deshalb wird hier festgehalten, WELCHE Beefs überhaupt abgerechnet
     * werden: `gedisst` merkt jede Front, in die dieser Spieler mindestens
     * einen Disstrack gesteckt hat (Welt + Kontakt, damit sich die Läufe nicht
     * sehen), `endeGedisst` zählt die Abrechnungen solcher Fronten, und
     * `endeRunden` hält den Rundenstand jeder Abrechnung fest.
     */
    gedisst: new Set(),
    endeGedisst: { sieg: 0, niederlage: 0, unentschieden: 0 },
    endeRunden: {},                 // "ich:er" -> Anzahl
    /*
     * Stück 5c, nur für die Sieg-Farm gefüllt:
     *   eigene      Fronten, die dieser Spieler selbst angestachelt hat. Der
     *               Schlüssel ist Welt + Kontakt + ANFANGSZEITPUNKT, also die
     *               einzelne Front und nicht der Gegner: Mit demselben Gegner
     *               kann im Jahr ein zweiter Streit anfangen, sobald sein
     *               Bonusfenster durch ist, und der ist eine neue Front. Ein
     *               Schlüssel ohne Zeitstempel hat in einem ersten Lauf genau
     *               das kaputt gemacht – die zweite Front galt als „schon
     *               bedisst", blieb unbeantwortet und ging 0:0 aus (301 von 545
     *               Abrechnungen). Die Fronten, die `anzaehlen` aufmacht,
     *               gehören nicht zur Farm und werden von ihr nicht bedisst.
     *   dissePro    Disstracks je Front, gleicher Schlüssel. Die Farm verlangt
     *               GENAU EINEN; die Kontrollzeile prüft das, statt es zu
     *               behaupten.
     *   frontVon    Welt + Kontakt -> Schlüssel der zuletzt mit ihm geöffneten
     *               Front. `settle` meldet eine Abrechnung nur mit dem Kontakt;
     *               über diese Zeile findet sie zurück zu ihrer Front. Das ist
     *               eindeutig, weil mit einem Gegner nie zwei Fronten offen
     *               sein können: `anstacheln` lehnt mit `laeuft_schon` ab,
     *               solange eine läuft, und mit `zu_frisch`, solange sein
     *               Bonusfenster steht.
     *   sieg        warum ein Tag der Farm ohne Anstacheln endete, und was sie
     *               beim Anstacheln gewählt hat (Wucht, Häme, Chance, Größe).
     *   hype…       der Hype an den Tagen des Beefschritts, getrennt nach dem
     *               Bonusfenster, in dem der Tag lag. Damit ist die Behauptung
     *               „ein Siegfenster klebt den Hype an HYPE_MAX" eine Messung.
     */
    eigene: new Set(),
    dissePro: {},
    frontVon: {},
    sieg: {
      keinSicheresZiel: 0, frontenVoll: 0, wuchtUeberGrenze: 0,
      zielWucht: [], zielHaeme: [], zielChance: [], zielReach: [],
    },
    hypeSieg: [], hypeNiederlage: [], hypeOhne: [],
  };
}

/**
 * Die Hüllen. Beide zählen nur, wenn `bz` gesetzt ist, und geben sonst
 * unverändert weiter – die gemessene Welt bleibt die echte.
 *
 * `anzaehlen` bekommt dabei den BEEFWÜRFEL statt des Hauptstroms. Das ist der
 * einzige Eingriff dieses Laufs in das Spiel, und er ist nötig: `publish` ruft
 * `anzaehlen` als letzten Wurf, also verschiebt der Wurf innerhalb der
 * Veröffentlichung nichts – aber alles, was danach aus demselben Strom kommt.
 * Ohne diesen Umweg wäre die Variante „aus" (die nicht anzählt) ab der ersten
 * Chart-Platzierung ein anderer Musiklauf als „passiv" und „aktiv", und die
 * Differenz wäre zur Hälfte ein anderer Würfel.
 */
const echtAnzaehlen = beef.anzaehlen;
beef.anzaehlen = (g, u, now, random = Math.random) => {
  if (!bz) return echtAnzaehlen(g, u, now, random);
  /*
   * „aus" zählt nicht an, und „diss_isoliert" (Stück 5c) ebenfalls nicht:
   * Diese Variante misst den Disstrack OHNE die Fronten, die das Spiel von
   * selbst aufmacht, und ihre Vergleichsgrundlage ist genau deshalb „ohne
   * Beef" – dort ist `anzaehlen` seit dem ersten Lauf stillgelegt. Beide Seiten
   * würfeln hier nicht und verwerfen auch nichts; die Hülle kürzt vorher ab.
   */
  if (bz.spielweise === 'aus' || bz.spielweise === 'diss_isoliert') return null;
  const r = echtAnzaehlen(g, u, now, bz.rand ?? random);
  if (r) bz.angezaehlt++;
  return r;
};

/**
 * `beef.settle` meldet Gegenschlag und Abrechnung – gezählt wird hier.
 *
 * ACHTUNG, und deshalb steht die Zählung zweimal im Skript: `anstacheln`,
 * `diss` und `frieden` rufen in src/beef.js die LOKALE Funktion `settle`, nicht
 * den Export. Diese Hülle sieht also nur die Aufrufe von außen (`music.publish`
 * und `music.show`). Was bei einem Anstacheln oder Disstrack fällig wird, kommt
 * dort als `vorher` zurück und wird an der Aufrufstelle gezählt (`zaehleEnden`).
 * Doppelt zählt nichts: `settle` meldet ein Ereignis genau einmal, weil es es
 * beim Melden auch schreibt.
 */
const echtBeefSettle = beef.settle;
beef.settle = (g, u, now, random = Math.random) => {
  const ev = echtBeefSettle(g, u, now, random);
  if (bz) zaehleEnden(g, ev, now);
  return ev;
};

/**
 * Gegenschläge und Abrechnungen aus einer Ereignisliste in den Zähler.
 *
 * Für die zwei Spielweisen aus Stück 5c geht jedes Ereignis zusätzlich als
 * Trace-Zeile hinaus (`--trace=beef`): Erst damit ist der Weg einer Front von
 * Hand nachrechenbar – Anstacheln, Disstrack, Gegenschlag, Abrechnung. Für
 * „passiv" und „aktiv" bleibt die Trace-Ausgabe unverändert die des ersten
 * Laufs, sonst wäre die Handprüfung im Messbericht nicht mehr wiederholbar.
 */
function zaehleEnden(guildId, ereignisse, now = 0) {
  if (!bz) return;
  const spur = TRACE === 'beef' && (bz.spielweise === 'sieg' || bz.spielweise === 'diss_isoliert');
  for (const e of ereignisse ?? []) {
    // Der Schlüssel der EINZELNEN Front – über `frontVon`, denn `settle` meldet
    // nur den Kontakt (siehe die Erklärung an `frontVon` im Zähler).
    const kontaktKey = `${guildId}|${e.contactId}`;
    const inst = bz.frontVon[kontaktKey];
    if (spur) {
      console.error(JSON.stringify({
        datum: now ? new Date(now).toISOString().slice(0, 10) : null, was: e.art,
        modus: bz.spielweise, kontakt: e.contactId,
        eigeneFront: Boolean(inst) && bz.eigene.has(inst),
        disseAufDieseFront: inst ? (bz.dissePro[inst] ?? 0) : 0,
        ...(e.art === 'konter'
          ? { wucht: e.wucht, runde: e.runde, hitzeNach: e.hitze, hypeVor: e.treffer?.hypeVor ?? null }
          : { status: e.status, faktor: e.faktor, bonusUntil: e.bonusUntil }),
        runden: `${e.rundenIch}:${e.rundenEr}`,
      }));
    }
    if (e.art === 'konter') bz.konter++;
    else if (e.art === 'ende') {
      bz.ende[e.status] = (bz.ende[e.status] ?? 0) + 1;
      const stand = `${e.rundenIch}:${e.rundenEr}`;
      bz.endeRunden[stand] = (bz.endeRunden[stand] ?? 0) + 1;
      /*
       * Wurde in DIESE Front ein Disstrack gesteckt? Für die Sieg-Farm wird
       * das über `frontVon` an der einzelnen Front entschieden, sonst (wie
       * bisher) am Kontakt. Der Unterschied ist nicht akademisch: Ein Gegner,
       * der im Frühjahr bedisst wurde und im Herbst von selbst anzählt, stünde
       * über den Kontakt sonst als „bedisste Front" da und würde seine 0:1
       * Niederlage der Farm zuschreiben.
       */
      const bedisst = bz.spielweise === 'sieg'
        // Die Farm disst ausschließlich eigene Fronten, und jede eigene Front
        // steht bis zu ihrer Abrechnung in `frontVon`. Keine Zeile dort heißt
        // deshalb: fremder Anlass, also nicht bedisst. Ohne diese Regel hätte
        // eine Front, die `anzaehlen` mit einem früher bedissten Gegner
        // aufmacht, ihre 0:1-Niederlage der Farm zugeschrieben.
        ? (inst ? (bz.dissePro[inst] ?? 0) > 0 : false)
        : bz.gedisst.has(kontaktKey);
      if (bedisst) {
        bz.endeGedisst[e.status] = (bz.endeGedisst[e.status] ?? 0) + 1;
      }
      // Die Front ist durch: Mit demselben Gegner kann später eine neue
      // anfangen, und die ist eine andere.
      if (inst) delete bz.frontVon[kontaktKey];
    }
  }
}

/**
 * Ein Beeftag: zwei Stunden in den Streit.
 *
 * Die Spielweise ist die aus dem Plan, und sie ist absichtlich die TEURE,
 * nicht die kluge:
 *
 *  1. Läuft ein Beef, kommt der Disstrack – sobald ein Titel da und die
 *     Veröffentlichungssperre durch ist. Er bekommt damit immer den
 *     Veröffentlichungsplatz des Tages, den sonst Single, EP oder Album gehabt
 *     hätten (`growth` 0,4 gegen 1,0 bis 2,4). Genau darin sitzt der Preis.
 *  2. Läuft keiner, wird angestachelt. Das Ziel ist das höchste
 *     `einstiegOf × wuchtOf` – der beste Kompromiss aus „er steigt ein" und
 *     „er ist groß genug, dass es sich lohnt". Beide Funktionen kommen aus
 *     src/beef.js; das Skript rechnet sie nicht nach.
 *  3. Frieden wird NIE angeboten. Er kostet zwei weitere Stunden und nimmt dem
 *     Beef den Ausgang; wer ihn anbietet, spielt vorsichtiger als die
 *     gemessene Spielweise.
 *
 * Abgelehnte Versuche kosten nichts, solange sie vor der Zeitbuchung
 * scheitern (`gesperrt`, `zu_frisch`, `laeuft_schon`) – dann wird der nächste
 * Kandidat probiert. An der Zeit scheitert der Tag ganz.
 */
function beeftag(G, U, now, rand, modus = 'aktiv') {
  const s = music.status(G, U, now);
  if (!s.started) return null;

  // Erst die faule Abrechnung (§4): Ein ausgekühlter Beef steht bis dahin
  // weiter als offen in der Tabelle und wäre hier eine Front, die es nicht
  // mehr gibt. Über die Hülle gezählt.
  beef.settle(G, U, now, rand);
  const offen = beef.offeneBeefs(G, U, now);

  /*
   * Stück 5c: Der Hype dieses Tages, getrennt nach dem Bonusfenster, in dem er
   * liegt. NACH der Abrechnung gelesen, denn ein fälliger Gegenschlag nimmt
   * Hype und Hörer, und das Bonusfenster entsteht überhaupt erst dort.
   *
   * Der Block hängt an `modus !== 'aktiv'` – also ausschließlich an den zwei
   * neuen Spielweisen. Damit bleibt jede Zahl der vier alten Varianten die des
   * committeten Laufs; ein zusätzlicher Lesevorgang würfelt zwar nicht, aber
   * die Gleichheit soll nachprüfbar bleiben und nicht behauptet sein.
   */
  if (modus !== 'aktiv') {
    const nach = music.status(G, U, now);
    const fenster = beef.bonusOf(G, U, now).status;
    (fenster === 'sieg' ? bz.hypeSieg
      : fenster === 'niederlage' ? bz.hypeNiederlage : bz.hypeOhne).push(nach.hype);
    if (modus === 'sieg') return siegtag(G, U, now, rand, nach, offen);
  }

  // 1. Der Disstrack.
  if (offen.length) {
    const ziel = beef.zielFor(G, U, now);
    if (!ziel) {
      // Kann nach `offen.length` nicht passieren – gezählt wird es trotzdem,
      // damit es nicht als stille Null durchgeht, wenn sich `zielFor` ändert.
      bz.dissAb.kein_ziel = (bz.dissAb.kein_ziel ?? 0) + 1;
      return null;
    }
    if (s.songs < 1 || s.releaseMs > 0) {
      const grund = s.songs < 1 ? 'kein_titel' : 'sperre';
      bz.dissAb[grund] = (bz.dissAb[grund] ?? 0) + 1;
      return null;
    }
    const hitzeVor = ziel.hitze;
    const r = beef.diss(G, U, ziel.contact_id, now, rand);
    zaehleEnden(G, r.vorher, now);
    if (!r.ok) {
      bz.dissAb[r.reason] = (bz.dissAb[r.reason] ?? 0) + 1;
      return r;
    }
    zaehleDiss(G, ziel, hitzeVor, offen.length, r, s, now, modus);
    return r;
  }

  // 2. Anstacheln. Die Reihenfolge ist Einstieg × Wucht, die besten acht
  //    werden probiert – mehr kann ein Tag nicht kosten, weil der erste
  //    Versuch, der die Zeit bucht, den Tag beendet.
  const meine = Math.max(100, s.listeners || 0);
  const kandidaten = contactsData.CONTACTS
    .filter((c) => c.reach > 0)
    .map((c) => ({
      c,
      wert: beef.einstiegOf({ meine, seine: c.reach, trait: c.trait })
        * beef.wuchtOf({ meine, seine: c.reach }),
    }))
    .sort((a, b) => b.wert - a.wert)
    .slice(0, 8);

  for (const k of kandidaten) {
    const r = beef.anstacheln(G, U, k.c.id, now, rand);
    zaehleEnden(G, r.vorher, now);
    if (r.ok) {
      bz.chancen.push(r.chance);
      if (r.ein) bz.einstieg++; else bz.blamage++;
      if (TRACE === 'beef') {
        console.error(JSON.stringify({
          datum: new Date(now).toISOString().slice(0, 10), was: 'anstacheln',
          kontakt: k.c.id, trait: k.c.trait,
          meine: Math.round(s.listeners), seine: k.c.reach,
          chance: r.chance, wucht: beef.wuchtOf({ meine, seine: k.c.reach }),
          wertDerWahl: k.wert, ein: r.ein,
        }));
      }
      return r;
    }
    bz.anstachelAb[r.reason] = (bz.anstachelAb[r.reason] ?? 0) + 1;
    // Vor der Zeitbuchung gescheitert: Der Abend ist noch da, also der nächste.
    if (r.reason === 'gesperrt' || r.reason === 'zu_frisch' || r.reason === 'laeuft_schon') continue;
    return r;                          // Zeit, Wand oder Seite: der Tag ist durch
  }
  return null;
}

/**
 * Ein gelungener Disstrack in die Zähler – aus beiden Spielweisen heraus
 * (`beeftag` für „aktiv"/„diss_isoliert", `siegtag` für die Sieg-Farm).
 *
 * Gezählt wird ausschließlich, was `beef.diss` zurückgegeben hat. Die einzige
 * Zahl, die von außen dazukommt, ist `hitzeVor` – die Hitze, die `zielFor`
 * bzw. die Frontenliste vor dem Schlag gemeldet hat.
 *
 * Die Trace-Zeile der Spielweise „aktiv" bleibt Feld für Feld die des ersten
 * Laufs; die zwei neuen Spielweisen hängen ihre Felder HINTEN an. Sonst wäre
 * die Handprüfung im Messbericht, die eine solche Zeile wörtlich zitiert,
 * nicht mehr wiederholbar.
 */
function zaehleDiss(G, ziel, hitzeVor, offenAnzahl, r, s, now, modus, front = null) {
  const schluessel = front ?? `${G}|${ziel.contact_id}`;
  bz.disse++;
  bz.gedisst.add(`${G}|${ziel.contact_id}`);
  bz.dissePro[schluessel] = (bz.dissePro[schluessel] ?? 0) + 1;
  bz.offenBeiDiss.push(offenAnzahl);
  bz.aufmerksamkeit.push(r.beef.aufmerksamkeit);
  bz.wucht.push(r.beef.wucht);
  bz.hitzeBeiDiss.push(hitzeVor);
  if (r.beef.haeme) bz.haeme++;
  else bz.aufmerksamkeitOhneHaeme.push(r.beef.aufmerksamkeit);
  if (TRACE !== 'beef') return;
  const zeile = {
    datum: new Date(now).toISOString().slice(0, 10), was: 'diss',
    kontakt: ziel.contact_id, trait: ziel.contact?.trait ?? null,
    meine: Math.round(s.listeners), seine: ziel.contact?.reach ?? null,
    genre: s.genre?.id ?? null, genrefaktor: beef.genrefaktorOf(music.genre(s.genre?.id)?.risk),
    hitzeVor, wucht: r.beef.wucht, haeme: r.beef.haeme,
    aufmerksamkeit: r.beef.aufmerksamkeit,
    audienceFactor: r.audienceFactor, audience: r.audience,
    gained: r.gained, position: r.position, hitzeNach: r.beef.hitze,
    runden: `${r.beef.rundenIch}:${r.beef.rundenEr}`,
  };
  if (modus !== 'aktiv') {
    zeile.modus = modus;
    zeile.hype = s.hype;
    zeile.disseAufDieseFront = bz.dissePro[schluessel];
  }
  console.error(JSON.stringify(zeile));
}

/**
 * ===========================================================================
 *  DIE SIEG-FARM (Stück 5c)
 * ===========================================================================
 *
 * Die gemessene Spielweise aus 5b hat in 718 Abrechnungen NICHT EINEN Sieg
 * gesehen (`BONUS_SIEG` 1,25 hat nie gezahlt), und der Grund war die
 * Spielweise, nicht der Zufall: Wer seine heißeste Front jeden Tag mit einem
 * Disstrack auf `HITZE_MAX` hält, rechnet sie nie ab. Diese Variante spielt
 * deshalb das Gegenteil und ist damit die Spielweise, die einen Sieg
 * überhaupt sehen KANN:
 *
 *   1. Eine Front aufmachen, deren Ausgang so weit feststeht, wie das Spiel es
 *      zulässt. Zwei Bedingungen, beide aus src/beef.js GELESEN und nicht
 *      nachgerechnet:
 *        • `wuchtOf` unter 0,19 – 95 % von `KONTER_LAECHERLICH` (0,2), siehe den
 *          Sicherheitsabstand an der Auswahlstelle → sein Gegenschlag wirkt
 *          lächerlich und holt die Runde für MICH (`rundeNachKonter`).
 *        • `haemeOf` so klein, wie es für IRGENDEIN Ziel des Katalogs geht (also
 *          ein Gegner, der mindestens so groß ist wie ich). Das ist
 *          für einen Pop-Künstler NICHT null, sondern 0,0462 – siehe die
 *          Begründung an der Auswahlstelle unten. Die Farm kann die Häme also
 *          nur minimieren; tritt sie ein, holt SEIN Lager die Runde
 *          (`rundeNachDiss`), und aus dem Sieg wird ein Unentschieden (mit
 *          Gegenschlag) oder eine Niederlage (ohne).
 *      Unter den Kandidaten, die beides erfüllen, wird der mit der höchsten
 *      `einstiegOf` genommen – die Farm will, dass er einsteigt.
 *   2. GENAU EIN Disstrack in diese Front. Danach nichts mehr: sie kühlt mit
 *      `HITZE_COOL_PRO_TAG` 6 aus und wird abgerechnet.
 *   3. Fronten, die `anzaehlen` von selbst aufmacht, gehören NICHT zur Farm –
 *      sie werden nicht bedisst und gehen wie beim passiven Spieler mit 0:1
 *      aus. `anzaehlen` bleibt dabei lebendig, damit diese Variante mit
 *      „passiv" und „aktiv" vergleichbar bleibt.
 *   4. Kein Frieden, wie in allen anderen Varianten.
 *
 * Findet sich kein Kandidat im sicheren Fenster (der Spieler wächst, der
 * Katalog nicht), passiert an diesem Tag nichts – und das wird gezählt
 * (`sieg.keinSicheresZiel`), nicht verschwiegen.
 */
function siegtag(G, U, now, rand, s, offen) {
  // 1. Eine eigene Front, in die noch kein Disstrack ging: genau einer hinein.
  const schluesselVon = (b) => `${G}|${b.contact_id}|${b.angefangen}`;
  const ziel = offen
    .filter((b) => bz.eigene.has(schluesselVon(b)) && !(bz.dissePro[schluesselVon(b)] > 0))
    .sort((a, b) => b.hitze - a.hitze)[0];
  if (ziel) {
    if (s.songs < 1 || s.releaseMs > 0) {
      const grund = s.songs < 1 ? 'kein_titel' : 'sperre';
      bz.dissAb[grund] = (bz.dissAb[grund] ?? 0) + 1;
      return null;
    }
    const hitzeVor = ziel.hitze;
    const mitKontakt = { ...ziel, contact: contactsData.byId(ziel.contact_id) };
    const r = beef.diss(G, U, ziel.contact_id, now, rand);
    zaehleEnden(G, r.vorher, now);
    if (!r.ok) {
      bz.dissAb[r.reason] = (bz.dissAb[r.reason] ?? 0) + 1;
      return r;
    }
    zaehleDiss(G, mitKontakt, hitzeVor, offen.length, r, s, now, 'sieg', schluesselVon(ziel));
    if (r.beef.wucht >= beefData.KONTER_LAECHERLICH) bz.sieg.wuchtUeberGrenze++;
    return r;
  }

  // 2. Kein Platz für eine neue Front? Dann ist der Tag durch – gezählt.
  if (offen.length >= beefData.BEEFS_MAX) {
    bz.sieg.frontenVoll++;
    return null;
  }

  // 3. Eine neue Front im sicheren Fenster.
  const meine = Math.max(100, s.listeners || 0);
  const genrefaktor = beef.genrefaktorOf(music.genre(s.genre?.id)?.risk);
  const laeuft = new Set(offen.map((b) => b.contact_id));
  const alle = contactsData.CONTACTS
    .filter((c) => c.reach > 0 && !laeuft.has(c.id))
    .map((c) => ({
      c,
      wucht: beef.wuchtOf({ meine, seine: c.reach }),
      haeme: beef.haemeOf({ meine, seine: c.reach, genrefaktor }),
      chance: beef.einstiegOf({ meine, seine: c.reach, trait: c.trait }),
    }));
  /*
   * Erst die harte Bedingung: Sein Gegenschlag muss lächerlich wirken, sonst
   * holt er eine Runde und der Ausgang steht nicht mehr fest.
   *
   * Dann die weiche: die KLEINSTE Häme-Wahrscheinlichkeit, die `beef.haemeOf`
   * für so ein Ziel überhaupt hergibt – abgelesen, nicht nachgerechnet. Sie ist
   * für einen Pop-Künstler NICHT null, sondern 0,2 × (1 − genrefaktor) = 0,0462:
   * `haemeOf` klemmt das Größenverhältnis bei 1 (`Math.max(1, meine/seine)`),
   * also verschwindet der erste Summand bei jedem Gegner, der mindestens so
   * groß ist wie ich, aber der Genre-Summand bleibt stehen. Nur in Hip-Hop
   * (`risk` 1,3 → genrefaktor 1) wäre er 0. Die Farm kann die Häme deshalb
   * nicht ausschließen, nur minimieren – wie oft sie trotzdem eintritt, steht
   * als Häme-Quote in der Ausgabe.
   */
  const haemeBoden = alle.length ? Math.min(...alle.map((k) => k.haeme)) : 0;
  /*
   * Der Sicherheitsabstand auf die Wucht: `KONTER_LAECHERLICH` wird beim
   * ANSTACHELN geprüft, entschieden wird die Runde aber beim GEGENSCHLAG, und
   * dazwischen liegen Tage, in denen die eigene Hörerzahl fällt (Abwanderung
   * je Veröffentlichung und je Tag). Ein Ziel genau an der Grenze rutscht dabei
   * darüber, und dann holt SEIN Konter die Runde. Ein erster Lauf ohne diesen
   * Abstand hat das gezeigt. Wie oft es TROTZ Abstand passiert, steht als
   * `wuchtUeberGrenze` in der Ausgabe – behauptet wird nichts.
   */
  const wuchtDeckel = beefData.KONTER_LAECHERLICH * 0.95;
  const kandidaten = alle
    .filter((k) => k.haeme <= haemeBoden + 1e-12 && k.wucht < wuchtDeckel)
    .sort((a, b) => b.chance - a.chance)
    .slice(0, 8);
  if (!kandidaten.length) {
    bz.sieg.keinSicheresZiel++;
    return null;
  }

  for (const k of kandidaten) {
    const r = beef.anstacheln(G, U, k.c.id, now, rand);
    zaehleEnden(G, r.vorher, now);
    if (r.ok) {
      bz.chancen.push(r.chance);
      bz.sieg.zielWucht.push(k.wucht);
      bz.sieg.zielHaeme.push(k.haeme);
      bz.sieg.zielChance.push(k.chance);
      bz.sieg.zielReach.push(k.c.reach);
      if (r.ein) {
        bz.einstieg++;
        // `beef.anstacheln` schreibt `angefangen: now` – derselbe Schlüssel.
        const front = `${G}|${k.c.id}|${now}`;
        bz.eigene.add(front);
        bz.frontVon[`${G}|${k.c.id}`] = front;
      } else bz.blamage++;
      if (TRACE === 'beef') {
        console.error(JSON.stringify({
          datum: new Date(now).toISOString().slice(0, 10), was: 'anstacheln',
          modus: 'sieg', kontakt: k.c.id, trait: k.c.trait,
          meine: Math.round(s.listeners), seine: k.c.reach,
          chance: r.chance, wucht: k.wucht, haeme: k.haeme,
          hype: s.hype, ein: r.ein,
        }));
      }
      return r;
    }
    bz.anstachelAb[r.reason] = (bz.anstachelAb[r.reason] ?? 0) + 1;
    if (r.reason === 'gesperrt' || r.reason === 'zu_frisch' || r.reason === 'laeuft_schon') continue;
    return r;
  }
  return null;
}

/** Eine Variante des Beeflaufs über alle Seeds; beide Zähler kommen mit. */
async function beefvariante(kennungBasis, musik, strat, laeufe, tage, spielweise) {
  kz = neuerZaehler();                 // Kanalaktionen, Veröffentlichungen, Konzerte
  bz = neuerBeefZaehler(spielweise);
  const geld = [];
  const hoerer = [];
  const follower = [];
  const hype = [];
  const hypeMittel = [];               // Hype im Mittel ueber ALLE Tage, je Seed
  const energie = [];
  const summe = {};                    // Geld je Quelle, damit die Differenz eine Adresse hat
  let zaehler;
  let beefZaehler;
  try {
    for (let i = 0; i < laeufe; i++) {
      const kennung = `${kennungBasis}_${i}`;
      const r = await karriere(welt(kennung), `fx:${kennung}`, { musik, strat }, tage, 1000 + i);
      geld.push(r.geld);
      hoerer.push(r.hoerer);
      follower.push(r.follower);
      hype.push(r.hype);
      hypeMittel.push(r.hypeMittel);
      energie.push(r.energie);
      for (const [k, v] of Object.entries(r.quellen)) summe[k] = (summe[k] ?? 0) + v;
    }
  } finally {
    // Auch wenn ein Lauf abbricht: Die Zähler müssen weg, sonst zählen die
    // Hüllen in jeden folgenden Lauf hinein.
    zaehler = kz; kz = null;
    beefZaehler = bz; bz = null;
  }
  return {
    geld, zaehler, beefZaehler,
    median: median(geld), q25: quantil(geld, 0.25), q75: quantil(geld, 0.75),
    hoerer: median(hoerer), follower: median(follower), hype: median(hype),
    /*
     * Der Hype im Mittel ueber alle Tage, als Median ueber die Seeds – und die
     * Spanne dazu. `hype` oben ist der Wert am LETZTEN Tag; er trifft ein
     * Bonusfenster (7 Tage) nur zufaellig und kann deshalb nicht zeigen, ob ein
     * Siegfenster den Hype an `HYPE_MAX` klebt.
     */
    hypeTage: median(hypeMittel),
    hypeTageMin: Math.min(...hypeMittel), hypeTageMax: Math.max(...hypeMittel),
    energie: energie.reduce((a, b) => a + b, 0) / Math.max(1, energie.length),
    quellen: Object.fromEntries(Object.entries(summe)
      .map(([k, v]) => [k, v / Math.max(1, laeufe)]).sort((a, b) => b[1] - a[1])),
  };
}

/** Die Zählerzeilen einer Beef-Variante – roh, ohne Rundung auf schöne Zahlen. */
function beefZeilen(z, tage, laeufe) {
  const out = [];
  const n = tage * laeufe;
  const quote = (a, b) => (b ? `${komma((a / b) * 100, 1)} %` : '– (0 Fälle)');
  const liste = (o) => Object.entries(o).map(([k, v]) => `${k} ${de(v)}`).join(', ') || 'keine';
  const versuche = z.einstieg + z.blamage;
  out.push(`Anstacheln: ${de(versuche)} bezahlte Versuche in ${de(n)} Tagen (${komma(versuche / n, 2)}/Tag) · ` +
    `Einstieg ${de(z.einstieg)} (Einstiegsquote ${quote(z.einstieg, versuche)}) · ` +
    `Blamage ${de(z.blamage)} (${quote(z.blamage, versuche)}) · ` +
    `Ø gewürfelte Einstiegschance ${z.chancen.length ? komma(mittel(z.chancen) * 100, 1) + ' %' : '–'}`);
  out.push(`ohne Zeitkosten abgelehnt (vor der Buchung): ${liste(z.anstachelAb)}`);
  out.push(`von selbst angezählt (nach einer Chart-Platzierung, ${komma(beefData.ANZAEHL_CHANCE * 100, 0)} % je Platzierung): ${de(z.angezaehlt)}`);
  out.push(`Disstracks ${de(z.disse)} (${komma(z.disse / n, 2)}/Tag) · ` +
    `Häme ${de(z.haeme)} (Häme-Quote ${quote(z.haeme, z.disse)}) · ` +
    `kein Disstrack möglich an: ${liste(z.dissAb)}`);
  const f = (a, k = 3) => (a.length ? `Ø ${komma(mittel(a), k)} (kleinster ${komma(Math.min(...a), k)}, größter ${komma(Math.max(...a), k)})` : 'keiner');
  out.push(`Ø Aufmerksamkeitsfaktor über ALLE Disstracks: ${f(z.aufmerksamkeit)} · ` +
    `ohne die Häme-Fälle (die zahlen fest ${komma(beefData.HAEME_AUDIENCE)}): ${f(z.aufmerksamkeitOhneHaeme)}`);
  out.push(`Ø Wucht beim Disstrack: ${f(z.wucht)} · Ø Hitze beim Disstrack: ${f(z.hitzeBeiDiss, 1)}`);
  out.push(`Ø offene Fronten im Moment des Disstracks: ${z.offenBeiDiss.length ? komma(mittel(z.offenBeiDiss)) : '–'} ` +
    `(höchstens ${beefData.BEEFS_MAX})`);
  const ausgaenge = z.ende.sieg + z.ende.niederlage + z.ende.unentschieden;
  out.push(`Gegenschläge ${de(z.konter)} · Abrechnungen ${de(ausgaenge)}: ` +
    `Sieg ${de(z.ende.sieg)} (Siegquote ${quote(z.ende.sieg, ausgaenge)}) · ` +
    `Niederlage ${de(z.ende.niederlage)} (${quote(z.ende.niederlage, ausgaenge)}) · ` +
    `Unentschieden ${de(z.ende.unentschieden)} (${quote(z.ende.unentschieden, ausgaenge)})`);
  const g = z.endeGedisst.sieg + z.endeGedisst.niederlage + z.endeGedisst.unentschieden;
  out.push(`davon Fronten, in die dieser Spieler je einen Disstrack gesteckt hat: ${de(g)} von ${de(ausgaenge)} ` +
    `(Sieg ${de(z.endeGedisst.sieg)} · Niederlage ${de(z.endeGedisst.niederlage)} · Unentschieden ${de(z.endeGedisst.unentschieden)}) – ` +
    `der Rest wurde nie beantwortet und geht mit 0:1 aus`);
  out.push(`Rundenstand bei der Abrechnung: ${Object.entries(z.endeRunden)
    .sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k} ${de(v)}×`).join(' · ') || 'keine'}`);
  /*
   * Stück 5c. Beide Blöcke stehen nur da, wenn sie etwas zu sagen haben: Für
   * die vier Varianten von 5b sind diese Listen leer, und deren Ausgabe bleibt
   * damit Zeile für Zeile die des committeten Laufs.
   */
  if (z.hypeSieg.length || z.hypeNiederlage.length || z.hypeOhne.length) {
    const hy = (a) => (a.length
      ? `${komma(mittel(a), 3)} (${de(a.length)} Tage, kleinster ${komma(Math.min(...a), 3)}, größter ${komma(Math.max(...a), 3)})`
      : 'keine solchen Tage');
    out.push(`Ø Hype am Beeftag, getrennt nach dem Bonusfenster (HYPE_MAX ${komma(music.HYPE_MAX)}): ` +
      `im Siegfenster ${hy(z.hypeSieg)} · im Niederlagenfenster ${hy(z.hypeNiederlage)} · ` +
      `ohne Fenster ${hy(z.hypeOhne)}`);
  }
  if (z.spielweise === 'sieg') {
    const g = z.sieg;
    const f = (a, k = 4) => (a.length ? `Ø ${komma(mittel(a), k)} (kleinster ${komma(Math.min(...a), k)}, größter ${komma(Math.max(...a), k)})` : 'keiner');
    out.push(`Sieg-Farm, gewähltes Ziel: Ø Wucht ${f(g.zielWucht)} (Bedingung: unter ` +
      `${komma(beefData.KONTER_LAECHERLICH * 0.95)} = 95 % von KONTER_LAECHERLICH ` +
      `${komma(beefData.KONTER_LAECHERLICH)}) · Häme ${f(g.zielHaeme)} ` +
      `(Bedingung: der kleinste Wert, den haemeOf für irgendein Ziel hergibt – für Pop 0,0462 und NICHT 0) · ` +
      `Ø Einstiegschance ${g.zielChance.length ? komma(mittel(g.zielChance) * 100, 1) + ' %' : '–'} · ` +
      `Ø Reichweite des Gegners ${g.zielReach.length ? de(mittel(g.zielReach)) : '–'}`);
    const proFront = Object.values(z.dissePro);
    out.push(`Sieg-Farm, eigene Fronten: ${de(z.eigene.size)} angestachelt und eingestiegen · ` +
      `${de(proFront.length)} davon bedisst · Disstracks je Front höchstens ` +
      `${proFront.length ? de(Math.max(...proFront)) : '–'} (die Farm verlangt genau 1)`);
    out.push(`Sieg-Farm, Tage ohne Anstacheln: kein Kandidat im sicheren Fenster ` +
      `${de(g.keinSicheresZiel)} · beide Fronten belegt ${de(g.frontenVoll)}`);
    out.push(`Sieg-Farm, Disstracks, deren Wucht bis zum Schlag über KONTER_LAECHERLICH ` +
      `${komma(beefData.KONTER_LAECHERLICH)} gestiegen ist: ${de(g.wuchtUeberGrenze)} von ${de(z.disse)} ` +
      `– bei ihnen holt sein Gegenschlag die Runde, der Ausgang steht dann nicht mehr fest`);
  }
  return out;
}

/**
 * Stück 5b: Was der Beef bringt.
 *
 * Zwei Archetypen – Musik+Creator und nur Musik; der reine Creator hat keinen
 * Disstrack und kommt deshalb nicht vor. Je Archetyp sechs Varianten (aus,
 * passiv, aktiv, Album, diss_isoliert, sieg – die letzten zwei aus Stück 5c)
 * mit demselben Würfel und derselben Strategie. Die Strategie
 * wird je Archetyp EINMAL gesucht (ohne Beef) und dann für alle Varianten
 * festgehalten – sonst misst man die Strategiewahl.
 */
async function beeflauf(laeufe, tage) {
  const paare = [
    { titel: 'Musik+Creator', musik: true, kennung: 'beef_beides' },
    // Der reine Musiker: dieselbe Messung ohne Kanalprogramm. Bei ihm gibt es
    // keine Füllaktionen, die die zwei Stunden verdrängen könnten – der Preis
    // des Beefs ist dort allein der Veröffentlichungsplatz.
    { titel: 'nur Musik', musik: true, kennung: 'beef_musik', kanaele: false },
  ];

  for (const a of paare) {
    const alle = a.kanaele === false
      ? strategien(true).filter((s) => s.name.startsWith('Ertrag je Zeit +0B'))
        .map((s) => ({ ...s, kanaele: false }))
      : strategien(a.musik);
    let strat;
    if (STRATEGIE && alle.some((s) => s.name === STRATEGIE)) {
      strat = alle.find((s) => s.name === STRATEGIE);
    } else {
      /*
       * Die Suchphase läuft OHNE Beef – wie die Suchphase des Kontaktlaufs ohne
       * Kontakte läuft: gesucht wird in der Welt der Vergleichsgrundlage, sonst
       * bekommt die Grundlage eine Strategie, die für eine andere Welt gewählt
       * wurde, und die Differenz enthält die Strategiewahl.
       *
       * Ein Zähler mit `spielweise: 'aus'` genügt dafür: Die Hülle um
       * `beef.anzaehlen` gibt dann null zurück, ohne zu würfeln. Ohne ihn liefe
       * die Suche mit lebendigem Anzählen, und für „Musik+Creator" kam dabei
       * eine ANDERE Strategie heraus als im Kontaktlauf („+K" statt ohne) –
       * die Zeile „ohne Beef" wäre dann nicht mehr zeilengleich mit „ohne
       * Kontakte" aus 5a, obwohl beide dasselbe messen.
       */
      bz = neuerBeefZaehler('aus');
      let such;
      try {
        such = await durchlauf(`${a.kennung}_suche`, a.musik, Math.max(2, Math.min(3, laeufe)),
          Math.min(tage, 180), alle, true);
      } finally {
        bz = null;
      }
      strat = alle.find((s) => s.name === such.strategie);
    }
    console.log(`  ${a.titel}: Strategie "${strat.name}" (Suche ohne Beef, wie in 5a), ${laeufe} Läufe à ${tage} Tage, ` +
      `Würfel rng(1000+i), Beefwürfe rng(701000+i), DISS_AUFMERK ${komma(beefData.DISS_AUFMERK, 2)}`);

    const aus = await beefvariante(`${a.kennung}_aus`, a.musik, { ...strat, beef: false }, laeufe, tage, 'aus');
    const passiv = await beefvariante(`${a.kennung}_passiv`, a.musik, { ...strat, beef: 'passiv' }, laeufe, tage, 'passiv');
    const aktiv = await beefvariante(`${a.kennung}_aktiv`, a.musik, { ...strat, beef: 'aktiv' }, laeufe, tage, 'aktiv');
    /*
     * Die vierte Variante ist KEINE Beef-Variante, sondern die zweite
     * Vergleichsgrundlage: derselbe Spieler ohne jeden Beef, der aber auf sechs
     * Titel wartet und ein Album bringt (`horten`, siehe `musiktag`). Ohne sie
     * misst „aktiv gegen aus" zum Teil nur den Abstand zwischen einer hohen und
     * einer niedrigen `spike`-Art – der Disstrack ist die höchste `spike`-Art je
     * Titel im Spiel, und das Album die höchste, die es ohne Beef gibt.
     */
    const album = await beefvariante(`${a.kennung}_album`, a.musik,
      { ...strat, beef: false, horten: true }, laeufe, tage, 'aus');

    const zeile = (was, r) => `    ${was.padEnd(20)}${de(r.median / tage).padStart(10)}/Tag   ` +
      `[${de(r.q25 / tage)} … ${de(r.q75 / tage)}]   ${de(r.follower)} Follower` +
      (r.hoerer ? `, ${de(r.hoerer)} Hörer` : '') +
      ` · Hype ${komma(r.hype)} · Energie Ø ${Math.round(r.energie * 100)} %`;
    /*
     * Gepaart auswerten: Je Seed läuft in allen Varianten derselbe Würfel, das
     * Verhältnis je Seed ist damit die ehrlichere Zahl – es steht neben dem
     * Verhältnis der Mediane, nicht an seiner Stelle. Die Spanne steht dabei,
     * weil sie im Kontaktlauf größer war als der Effekt und hier größer sein
     * kann als dort.
     */
    const paarweise = (r, basis) => r.geld.map((g, i) => g / Math.max(1, basis.geld[i]));
    const diffzeile = (r, basis, wasBasis) => {
      const p = paarweise(r, basis);
      const rauf = p.filter((x) => x > 1).length;
      return `      gegen „${wasBasis}": Mediane ${prozent(r.median / Math.max(1, basis.median) - 1)} · ` +
        `je Seed (gepaart) Median ${prozent(median(p) - 1)}, ` +
        `Spanne ${prozent(Math.min(...p) - 1)} … ${prozent(Math.max(...p) - 1)}, ` +
        `${rauf} von ${p.length} Seeds im Plus\n` +
        `      je Seed: ${p.map((x) => prozent(x - 1)).join(' · ')}`;
    };

    console.log(zeile('ohne Beef (vor 1.40)', aus));
    console.log(zeile('passiv (geschluckt)', passiv));
    console.log(diffzeile(passiv, aus, 'ohne Beef'));
    console.log(zeile('aktiv (Beef-Spielweise)', aktiv));
    console.log(diffzeile(aktiv, aus, 'ohne Beef'));
    console.log(diffzeile(aktiv, passiv, 'passiv'));
    console.log(zeile('ohne Beef, Album statt Single', album));
    console.log(diffzeile(album, aus, 'ohne Beef'));
    console.log(diffzeile(aktiv, album, 'ohne Beef, Album'));
    const quellenzeile = (was, r) => `      Quellen ${was.padEnd(24)}` + (Object.entries(r.quellen)
      .filter(([, v]) => Math.abs(v) > 1)
      .map(([k, v]) => `${k} ${de(v / tage)}/Tag (${Math.round((v / Math.max(1, r.median)) * 100)} %)`).join(' · ') || 'keine');
    console.log(quellenzeile('ohne Beef:', aus));
    console.log(quellenzeile('passiv:', passiv));
    console.log(quellenzeile('aktiv:', aktiv));
    console.log(quellenzeile('ohne Beef, Album:', album));

    /*
     * Der Auslöser aus dem PLAN (docs/superpowers/plans/2026-09-25-beef.md,
     * Task 5; die Spec nennt ihn ebenfalls, aber die Zahl gehört dem Plan):
     * Liegt die Differenz über +25 %, wird `DISS_AUFMERK` gesenkt und neu
     * gemessen.
     *
     * „Die Differenz" ist im Plan die zwischen „wie bisher" und „mit
     * Beef-Spielweise" – das ist die Zeile gegen „ohne Beef". Weil sich das
     * auch als „gegen denselben Spieler, der nur nicht zurückschlägt" lesen
     * lässt und diese Zahl deutlich größer ist, steht sie daneben, und jede
     * Zahl wird mit ihrer Vergleichsgrundlage benannt. Wer den Auslöser prüft,
     * soll sehen, WELCHE Differenz ihn erreicht hat.
     */
    const kandidatenAusloeser = [
      ['Mediane gegen „ohne Beef"', aktiv.median / Math.max(1, aus.median) - 1],
      ['gepaart gegen „ohne Beef"', median(paarweise(aktiv, aus)) - 1],
      ['Mediane gegen „passiv"', aktiv.median / Math.max(1, passiv.median) - 1],
      ['gepaart gegen „passiv"', median(paarweise(aktiv, passiv)) - 1],
    ];
    const groesste = kandidatenAusloeser.reduce((a, b) => (b[1] > a[1] ? b : a));
    console.log(`      Auslöser „über +25 %" (Plan, Task 5): ` +
      `${kandidatenAusloeser.slice(0, 2).map(([k, v]) => `${k} ${prozent(v)}`).join(', ')} – ` +
      `das ist die Differenz, die der Plan meint („wie bisher" gegen „mit Beef-Spielweise")`);
    console.log(`      größte Differenz überhaupt: ${prozent(groesste[1])} (${groesste[0]}) → ` +
      `${groesste[1] > 0.25 ? 'ERREICHT, DISS_AUFMERK senken und neu messen' : 'nicht erreicht, DISS_AUFMERK unverändert'}`);

    // Was die zwei Stunden gekostet haben – gezählt, nicht überschlagen.
    const l = (r) => leistung(r.zaehler, tage, laeufe);
    const la = l(aus); const lp = l(passiv); const lk = l(aktiv); const lal = l(album);
    console.log(`      Tagesleistung Ø/Tag: ohne Beef ${komma(la.akte)} Kanalaktionen · ${komma(la.publishes)} Veröffentlichungen · ${komma(la.shows)} Konzerte` +
      ` → passiv ${komma(lp.akte)} · ${komma(lp.publishes)} · ${komma(lp.shows)}` +
      ` → aktiv ${komma(lk.akte)} · ${komma(lk.publishes)} · ${komma(lk.shows)}` +
      ` → Album ${komma(lal.akte)} · ${komma(lal.publishes)} · ${komma(lal.shows)}` +
      ` (aktiv gegen ohne Beef: ${prozent(lk.akte / Math.max(1e-9, la.akte) - 1)} Kanalaktionen, ${prozent(lk.publishes / Math.max(1e-9, la.publishes) - 1)} Veröffentlichungen)`);
    console.log(`      davon Disstracks: ${komma(aktiv.beefZaehler.disse / (tage * laeufe))}/Tag – ` +
      `${komma((aktiv.beefZaehler.disse / Math.max(1, aktiv.zaehler.publishes)) * 100, 1)} % aller Veröffentlichungen der aktiven Variante`);

    console.log(`    passiv:`);
    for (const z of beefZeilen(passiv.beefZaehler, tage, laeufe)) console.log(`      ${z}`);
    console.log(`    aktiv:`);
    for (const z of beefZeilen(aktiv.beefZaehler, tage, laeufe)) console.log(`      ${z}`);

    // Stille Nullen sind Fehler, nicht Ergebnisse: Die Varianten „aus" und
    // „Album" (die ebenfalls mit `spielweise: 'aus'` läuft) MÜSSEN leer sein,
    // „passiv" und „aktiv" dürfen es nicht.
    const leerCheck = (z) => !z.einstieg && !z.blamage && !z.disse && !z.angezaehlt && !z.konter
      && !z.ende.sieg && !z.ende.niederlage && !z.ende.unentschieden;
    const b = aus.beefZaehler;
    console.log(`      KONTROLLE „ohne Beef": ${leerCheck(b) ? 'kein einziger Beef, kein Gegenschlag, keine Abrechnung ✔'
      : `NICHT LEER – ${JSON.stringify({ ...b, rand: undefined, gedisst: b.gedisst.size })}`}`);
    const balbum = album.beefZaehler;
    console.log(`      KONTROLLE „Album": ${leerCheck(balbum) ? 'kein einziger Beef, kein Gegenschlag, keine Abrechnung ✔'
      : `NICHT LEER – ${JSON.stringify({ ...balbum, rand: undefined, gedisst: balbum.gedisst.size })}`}`);
    const p = passiv.beefZaehler;
    console.log(`      KONTROLLE „passiv": angezählt ${de(p.angezaehlt)}, Abrechnungen ` +
      `${de(p.ende.sieg + p.ende.niederlage + p.ende.unentschieden)}, eigene Disstracks ${de(p.disse)} ` +
      `(${p.angezaehlt > 0 && p.disse === 0 ? 'so gewollt ✔' : 'FEHLER – passiv heißt: angezählt werden, aber nie selbst schlagen'})`);

    /*
     * =====================================================================
     *  STÜCK 5c: DIE ZWEI SPIELWEISEN, DIE 5b NICHT GEMESSEN HAT
     * =====================================================================
     *
     * Der Lauf von 5b hat für die aktive Spielweise +0,9 % (Mediane) bzw.
     * −0,6 % (gepaart) gegen „ohne Beef" gemeldet. Diese Zahl ist die SUMME aus
     * zwei neuen Wirkungen, die sich zufällig aufheben: dem Gewinn des
     * Disstracks und dem Verlust aus den Niederlagen-Fenstern der Fronten, die
     * `anzaehlen` von selbst aufmacht. Sie beantwortet damit keine der zwei
     * Fragen, die §3 stellt. Zwei Spielweisen füllen die Lücke:
     *
     *   diss-isoliert  dieselbe Spielweise wie „aktiv", aber `anzaehlen` ist auf
     *                  BEIDEN Seiten stillgelegt. Damit bleibt als Unterschied
     *                  nur „Disstrack statt Single".
     *   sieg-farm      ein Disstrack je Front, dann auskühlen lassen und
     *                  abrechnen – die Spielweise, die einen Sieg überhaupt
     *                  sehen kann (siehe `siegtag`).
     */
    const dissIso = await beefvariante(`${a.kennung}_dissiso`, a.musik,
      { ...strat, beef: 'diss_isoliert' }, laeufe, tage, 'diss_isoliert');
    const siegFarm = await beefvariante(`${a.kennung}_siegfarm`, a.musik,
      { ...strat, beef: 'sieg' }, laeufe, tage, 'sieg');
    const ld = l(dissIso); const ls = l(siegFarm);

    console.log(`    ---- Stück 5c: zwei bisher ungemessene Spielweisen ----`);
    console.log(zeile('diss-isoliert', dissIso));
    console.log(`      Vergleichsgrundlage ist „ohne Beef" (die Zeile oben, unverändert): In ihr ist`);
    console.log(`      \`anzaehlen\` seit dem ersten Lauf ebenfalls stillgelegt – die Hülle gibt null zurück,`);
    console.log(`      bevor sie würfelt. Damit unterscheiden sich die zwei Läufe in genau einer Sache:`);
    console.log(`      „Disstrack statt Single". Eine EIGENE Grundlage gibt es nicht, weil sie Zahl für Zahl`);
    console.log(`      diese wäre; die Kontrollzeilen unten zeigen für beide Seiten, dass niemand anzählt.`);
    console.log(`      Der Unterschied zur Zeile „aktiv gegen ohne Beef" liegt deshalb nicht in der`);
    console.log(`      Grundlage, sondern in der Variante: „aktiv" wird angezählt, „diss-isoliert" nicht.`);
    console.log(diffzeile(dissIso, aus, 'ohne Beef'));
    console.log(diffzeile(dissIso, aktiv, 'aktiv (Beef-Spielweise)'));
    console.log(diffzeile(dissIso, album, 'ohne Beef, Album'));
    console.log(zeile('sieg-farm', siegFarm));
    console.log(`      Vergleichsgrundlagen der Sieg-Farm sind „passiv" (dieselbe Anzähl-Belastung, denn`);
    console.log(`      \`anzaehlen\` bleibt hier lebendig) und „ohne Beef" (das Spiel vor 1.40.0).`);
    console.log(diffzeile(siegFarm, aus, 'ohne Beef'));
    console.log(diffzeile(siegFarm, passiv, 'passiv'));
    console.log(diffzeile(siegFarm, aktiv, 'aktiv (Beef-Spielweise)'));
    console.log(quellenzeile('diss-isoliert:', dissIso));
    console.log(quellenzeile('sieg-farm:', siegFarm));
    const hypeZeile = (was, r) => `${was} ${komma(r.hypeTage)} [${komma(r.hypeTageMin)} … ${komma(r.hypeTageMax)}]`;
    console.log(`      Ø Hype über ALLE Tage (Median der Seeds, Spanne der Seeds), HYPE_MAX ${komma(music.HYPE_MAX)}: ` +
      [hypeZeile('ohne Beef', aus), hypeZeile('passiv', passiv), hypeZeile('aktiv', aktiv),
        hypeZeile('Album', album), hypeZeile('diss-isoliert', dissIso), hypeZeile('sieg-farm', siegFarm)].join(' · '));
    console.log(`      Tagesleistung Ø/Tag: diss-isoliert ${komma(ld.akte)} Kanalaktionen · ${komma(ld.publishes)} Veröffentlichungen · ${komma(ld.shows)} Konzerte` +
      ` (gegen ohne Beef: ${prozent(ld.akte / Math.max(1e-9, la.akte) - 1)} Kanalaktionen, ${prozent(ld.publishes / Math.max(1e-9, la.publishes) - 1)} Veröffentlichungen)` +
      ` → sieg-farm ${komma(ls.akte)} · ${komma(ls.publishes)} · ${komma(ls.shows)}` +
      ` (gegen ohne Beef: ${prozent(ls.akte / Math.max(1e-9, la.akte) - 1)} Kanalaktionen, ${prozent(ls.publishes / Math.max(1e-9, la.publishes) - 1)} Veröffentlichungen)`);
    console.log(`      davon Disstracks: diss-isoliert ${komma(dissIso.beefZaehler.disse / (tage * laeufe))}/Tag – ` +
      `${komma((dissIso.beefZaehler.disse / Math.max(1, dissIso.zaehler.publishes)) * 100, 1)} % aller Veröffentlichungen · ` +
      `sieg-farm ${komma(siegFarm.beefZaehler.disse / (tage * laeufe), 3)}/Tag – ` +
      `${komma((siegFarm.beefZaehler.disse / Math.max(1, siegFarm.zaehler.publishes)) * 100, 1)} % aller Veröffentlichungen`);
    /*
     * Der Auslöser des Plans, diesmal für die isolierte Zahl. Er gilt für die
     * Differenz „wie bisher" gegen „mit Beef-Spielweise" – hier gegen dieselbe
     * Grundlage wie oben, nur ohne den Anzähl-Anteil auf der aktiven Seite.
     */
    const isoM = dissIso.median / Math.max(1, aus.median) - 1;
    const isoP = median(paarweise(dissIso, aus)) - 1;
    console.log(`      Auslöser „über +25 %" (Plan, Task 5) für diss-isoliert: Mediane ${prozent(isoM)}, ` +
      `gepaart ${prozent(isoP)} → ${Math.max(isoM, isoP) > 0.25
        ? 'ERREICHT, DISS_AUFMERK senken und neu messen' : 'nicht erreicht'}`);
    /*
     * Die Sieg-Farm ist ebenfalls eine Beef-Spielweise, also gilt der Auslöser
     * des Plans auch für sie – gegen dieselbe Grundlage „ohne Beef". Er steht
     * hier, damit niemand ihn selbst ausrechnen muss.
     */
    const farmM = siegFarm.median / Math.max(1, aus.median) - 1;
    const farmP = median(paarweise(siegFarm, aus)) - 1;
    console.log(`      Auslöser „über +25 %" (Plan, Task 5) für sieg-farm: Mediane ${prozent(farmM)}, ` +
      `gepaart ${prozent(farmP)} → ${Math.max(farmM, farmP) > 0.25
        ? 'ERREICHT, DISS_AUFMERK senken und neu messen' : 'nicht erreicht'}`);
    console.log(`    diss-isoliert:`);
    for (const z of beefZeilen(dissIso.beefZaehler, tage, laeufe)) console.log(`      ${z}`);
    console.log(`    sieg-farm:`);
    for (const z of beefZeilen(siegFarm.beefZaehler, tage, laeufe)) console.log(`      ${z}`);

    /*
     * Die Kontrollzeilen der zwei neuen Varianten. Auch hier ist eine stille
     * Null ein Fehler: „diss-isoliert" MUSS ohne eine einzige Anzählung
     * durchlaufen und trotzdem Disstracks haben, und die Sieg-Farm MUSS genau
     * einen Disstrack je Front gesetzt haben, keinen einzigen mit Häme und
     * keinen mit einer Wucht, die den Gegenschlag ernst nehmen würde.
     */
    const bd = dissIso.beefZaehler;
    console.log(`      KONTROLLE Grundlage „ohne Beef" (für diss-isoliert): ${leerCheck(b)
      ? 'kein einziger Beef, kein Gegenschlag, keine Abrechnung, keine Anzählung ✔'
      : 'NICHT LEER – FEHLER'}`);
    console.log(`      KONTROLLE „diss-isoliert": angezählt ${de(bd.angezaehlt)} ` +
      `(${bd.angezaehlt === 0 ? 'erwartet 0, `anzaehlen` stillgelegt wie in „ohne Beef" ✔'
        : 'FEHLER – die Isolierung greift nicht'}), ` +
      `Disstracks ${de(bd.disse)} (${bd.disse > 0 ? 'nicht null ✔' : 'FEHLER – nichts gemessen'}), ` +
      `Anstacheln ${de(bd.einstieg + bd.blamage)} (${bd.einstieg > 0 ? 'mindestens ein Einstieg ✔' : 'FEHLER – keine Front'}), ` +
      `Abrechnungen ${de(bd.ende.sieg + bd.ende.niederlage + bd.ende.unentschieden)} ` +
      `(keine Null, die verschwiegen wird: die eine Front wird jeden Tag neu bedisst und damit auf ` +
      `HITZE_MAX gehalten – sie kühlt nie aus, also wird sie nie abgerechnet; Ø offene Fronten im ` +
      `Moment des Disstracks ${bd.offenBeiDiss.length ? komma(mittel(bd.offenBeiDiss)) : '–'})`);
    const bs = siegFarm.beefZaehler;
    const proFront = Object.values(bs.dissePro);
    const maxProFront = proFront.length ? Math.max(...proFront) : 0;
    const maxWucht = bs.wucht.length ? Math.max(...bs.wucht) : 0;
    const gesamtGedisst = bs.endeGedisst.sieg + bs.endeGedisst.niederlage + bs.endeGedisst.unentschieden;
    const haemeZiele = bs.sieg.zielHaeme;
    console.log(`      KONTROLLE „sieg-farm": Disstracks ${de(bs.disse)} ` +
      `(${bs.disse > 0 ? 'nicht null ✔' : 'FEHLER – nichts gemessen'}), ` +
      `höchstens ${de(maxProFront)} je Front (${maxProFront === 1 ? 'erwartet 1 ✔' : 'FEHLER – die Farm disst eine Front nicht genau einmal'}), ` +
      `größte Wucht beim Disstrack ${komma(maxWucht, 4)} ` +
      `(${bs.sieg.wuchtUeberGrenze} davon über KONTER_LAECHERLICH ${komma(beefData.KONTER_LAECHERLICH)} – ` +
      `gezählt, nicht weggerundet), ` +
      `gewählte Häme-Wahrscheinlichkeit ${haemeZiele.length ? `${komma(Math.min(...haemeZiele), 4)} … ${komma(Math.max(...haemeZiele), 4)}` : '–'} ` +
      `(der Boden von haemeOf für dieses Genre, NICHT 0 – deshalb ist die Häme-Quote unten nicht null, sondern gewürfelt), ` +
      `eigene Fronten abgerechnet ${de(gesamtGedisst)} ` +
      `(${gesamtGedisst > 0 ? 'nicht null ✔' : 'FEHLER – keine eigene Front ist abgerechnet worden, die Siegquote wäre eine stille Null'})`);
    console.log();
  }
}

// ------------------------------------------------------- Angebote (5c)

/**
 * ===========================================================================
 *  GEGENANFRAGEN UND GROSSE FORMATE ALS SPIELWEISE
 * ===========================================================================
 *
 * Gemessen wird eine einzige Frage: Was bringen die Gegenanfragen (Stück 5c) –
 * und bringt einer der drei neuen Geldwege (Honorar, Gage, Vorschuss) oder einer
 * der beiden großen Formate einen Zufluss, den §3 nicht erlaubt?
 *
 * Der Aufbau ist der des Beeflaufs, mit DREI Unterschieden, die aus dem Code
 * kommen und nicht aus einer Entscheidung:
 *
 *  1. **Jede Variante pflegt Kontakte.** Eine Gegenanfrage setzt einen Draht ab
 *     20 voraus, `kollabo`/`tour`/`label` einen ab 50 (`minDraht` in
 *     `src/data/angebote.js`). Ohne Kontaktpflege gibt es also nichts zu messen.
 *     Deshalb läuft `strat.kontakte` in ALLEN Varianten – auch in der Grundlage
 *     „aus". Die Differenz misst damit die Gegenanfragen und nicht die
 *     Kontaktpflege; was die kostet, hat 5a gemessen.
 *  2. **Und sie pflegt sie mit Partner-Vorrang.** Die freie Wahl aus 5a baut über
 *     ein Jahr genau einen Draht auf, und das ist ein reiner Creator ohne
 *     Musik-Reichweite – gemessen, siehe `kontakttag`. Der Vorrang ist das
 *     Messwerkzeug, ohne das der ganze Lauf eine stille Null wäre.
 *  3. **Es gibt sechs Varianten und ein Kontrollpaar dazu.** Die sechs stehen im
 *     Plan; das Kontrollpaar musste dazukommen, weil die gemessene
 *     Veröffentlichungspolitik („jeden Tag die Single, die fertig ist") nie sechs
 *     Titel liegen hat und ein Kollabo-Album deshalb NIE abschließt. Das ist ein
 *     Ergebnis und kein Fehler – es steht als Zahl in der Ausgabe –, aber es
 *     beantwortet die Frage der Spec („lohnt sich das Kollabo?") nicht. Dafür
 *     laufen zwei weitere Varianten, die beide auf sechs Titel warten und sich
 *     NUR darin unterscheiden, ob das Album ein Kollabo ist.
 *
 *     Warum das nicht eine siebte Spalte derselben Tabelle ist: Der Abstand
 *     zwischen „Album" und „täglicher Single" ist das Größte, was dieses Spiel
 *     kennt (5b hat +665,7 % bzw. +2766,1 % gemessen). Eine Kollabo-Variante
 *     gegen die Single-Grundlage zu stellen hieße, diesen Abstand als Wirkung des
 *     Kollabos auszugeben.
 *
 * Damit die Differenz die Gegenanfragen misst und nichts sonst:
 *
 *  • ALLE Varianten fahren DIESELBE Strategie (einmal je Archetyp gesucht, dann
 *    fest) und denselben Würfel `rng(1000 + i)` für Musik, Kanäle, Ereignisse
 *    und Vorfälle, denselben Kontaktwürfel `rng(501000 + i)` – dieselben Seeds
 *    wie im Kontakt- und im Beeflauf.
 *  • Alle Angebotswürfe laufen über einen VIERTEN Würfel `rng(901000 + i)`:
 *    Zustellung, Kontaktwahl beim Ziehen, Art, Textzeile – und die
 *    Veröffentlichung des Kollabos und die fünf Konzerte der Tour, weil
 *    `abschliessen` ihnen genau diesen Würfel durchreicht.
 *  • Jede Variante bekommt eigene Welten und eigene Konten.
 *
 * Gezählt wird ausschließlich, was das Spiel zurückgegeben hat: die Ereignisse
 * aus `angebote.settle` und die Rückgabewerte von `annehmen`, `ablehnen`,
 * `arbeiten` und `music.sign`. Das Skript rechnet kein Honorar, keine Gage und
 * keinen Kollabo-Faktor nach – es nimmt die Zahlen, mit denen gebucht wurde.
 * (Die Handprüfung im Messbericht rechnet sie von Hand nach und hält sie
 * dagegen; dafür gibt es `--trace=angebote`.)
 */

/**
 * Welche Arten eine Spielweise annimmt. `null` heißt: Der Zustellweg wird nicht
 * einmal angefasst – das ist die Grundlage „aus", und sie ruft `settle` nie.
 */
const ANGEBOT_ANNAHME = {
  aus: null,
  'alles-ab': new Set(),
  'alles-an': new Set(['tausch', 'gastpart', 'vorgruppe', 'kollabo', 'tour', 'label']),
  'nur-geld': new Set(['gastpart', 'vorgruppe']),
  'nur-projekte': new Set(['kollabo', 'tour']),
  'nur-label': new Set(['label']),
  // Das Kontrollpaar für das Kollabo (siehe Kopf): beide horten, nur eine nimmt an.
  'horten-aus': null,
  'horten-kollabo': new Set(['kollabo']),
  /*
   * Die Zerlegung von „alles-an" (`--zerlegung`). Sie musste dazukommen, weil die
   * fünf Varianten des Plans die Frage „welche Konstante greift?" NICHT
   * beantworten konnten: Gemessen (10 Läufe, nur Musik) liegt „alles-an" bei
   * +51,5 % gepaart, während jede isolierende Variante zwischen −0,7 % und
   * +3,8 % steht. Die Summe der Teile ist also ein Zehntel des Ganzen, und der
   * Grund steht in `src/data/angebote.js`: Wer ablehnt, treibt
   * `abgelehnt_folge` hoch, und nach PAUSE_SCHWELLE 3 ruht der Zustellweg
   * PAUSE_TAGE 14. Eine isolierende Variante lehnt fünf von sechs Arten ab und
   * bekommt deshalb kaum noch Anfragen – gemessen 5 Verträge in „nur-label"
   * gegen 36 in „alles-an". Die isolierte Zahl misst damit die Pause mit und
   * nicht den Weg allein.
   *
   * Diese vier Varianten nehmen deshalb ALLES an BIS AUF eine Gruppe. Sie
   * laufen damit bei derselben Zustellrate wie „alles-an", und die Differenz
   * „alles-an" minus „ohne-X" ist der Beitrag von X an der Spielweise, die den
   * Auslöser reißt. Abgelehnt wird dabei nur eine Art von sechs, die Pause
   * bleibt also selten.
   */
  'ohne-geld': new Set(['tausch', 'kollabo', 'tour', 'label']),
  'ohne-projekte': new Set(['tausch', 'gastpart', 'vorgruppe', 'label']),
  'ohne-label': new Set(['tausch', 'gastpart', 'vorgruppe', 'kollabo', 'tour']),
  'ohne-tausch': new Set(['gastpart', 'vorgruppe', 'kollabo', 'tour', 'label']),
};

/** `--zerlegung`: die vier „alles-an ohne X"-Varianten mitfahren. */
const ZERLEGUNG = process.argv.includes('--zerlegung');

/**
 * Nimmt die Spielweise überhaupt `kollabo` oder `tour` an? Nur dann ist „null
 * abgeschlossene Projekte" ein Fehlschlag; bei `alles-ab`, `nur-geld` und
 * `nur-label` ist die Null Absicht und darf nicht wie ein Alarm aussehen.
 */
const nimmtProjekteAn = (spielweise) => {
  const an = ANGEBOT_ANNAHME[spielweise];
  return Boolean(an && (an.has('kollabo') || an.has('tour')));
};

/** Die Spielweisen, die einen Angebotstag bekommen – „aus" steht NICHT darin. */
const ANGEBOT_SPIELWEISEN = new Set(Object.entries(ANGEBOT_ANNAHME)
  .filter(([, v]) => v !== null).map(([k]) => k));

/** Zähler des laufenden Angebotslaufs – `null`, solange nicht gemessen wird. */
let ag = null;

function neuerAngebotZaehler(spielweise) {
  return {
    spielweise,
    rand: null,
    // Zustellung
    zugestellt: {},                 // Art -> Anzahl
    seine: [],                      // Musik-Reichweite des Kontakts je zugestellter Anfrage
    verfallen: {},                  // Art -> Anzahl (liegen gelassen)
    pausen: 0,                      // wie oft der Zustellweg zwei Wochen ruhte
    // Antwort
    angenommen: {}, abgelehnt: {},
    annahmeAb: {},                  // "Art/Grund" -> Anzahl
    // Honorar und Gage – brutto wie netto, denn ein Label-Vertrag nimmt 30 %
    honorare: [], honorarNetto: 0, honorarBrutto: 0, honorarSeine: [],
    gagen: [], gageNetto: 0, gageBrutto: 0, extraHoerer: [], gageSeine: [],
    // Projekte
    projekteAuf: {}, projekteFertig: {}, projekteVerfallen: {},
    verfalleneStunden: [],          // Stunden, die mit einem Projekt verfallen sind
    kollaboVerfall: [],             // je verfallenem Kollabo { ist, soll, titel }
    druecke: 0, arbeitAb: {},
    kollaboFaktoren: [], kollaboAudience: [], kollaboPlatz: [], kollaboGewonnen: [],
    tourAbende: 0, tourKonzerte: [], tourAbgesagt: 0, tourBrutto: [], tourNetto: 0,
    tourGast: [], tourGewonnen: [],
    // Vertrag
    vertragAngebote: 0, vertragArten: {}, unterschrieben: 0, vorschuesse: [],
    vorschussNetto: 0, signAb: {}, vertragEnden: 0,
    // Beziehung am Ende jedes Laufs – der Beweis, dass es Partner gab (Respekt UND Vertrauen)
    partnerAmEnde: [], bekanntAmEnde: [], partnerReach: [],
  };
}

/**
 * `music.settleContracts` meldet den ausgelaufenen Vertrag – gezählt wird hier.
 * Ohne diese Zahl wäre „5 unterschriebene Verträge in 365 Tagen" nicht
 * nachvollziehbar: Ein neues Angebot kann erst kommen, wenn das alte durch ist.
 */
const echtSettleContracts = music.settleContracts;
music.settleContracts = (...a) => {
  const r = echtSettleContracts(...a);
  if (ag && r?.ended) ag.vertragEnden++;
  return r;
};

/**
 * Die Ereignisse der faulen Abrechnung in den Zähler – aus `settle` selbst und
 * aus dem `vorher` JEDES Knopfdrucks. Doppelt zählt dabei nichts: `settle`
 * meldet ein Ereignis genau einmal, weil es es beim Melden auch schreibt.
 */
function zaehleAngebotEreignisse(ereignisse, kontext = null) {
  if (!ag) return;
  for (const e of ereignisse ?? []) {
    if (e.art === 'neu') {
      const id = e.angebot?.art ?? '?';
      ag.zugestellt[id] = (ag.zugestellt[id] ?? 0) + 1;
      ag.seine.push(e.contact?.reach ?? 0);
    } else if (e.art === 'verfallen') {
      const id = e.angebot?.art ?? '?';
      ag.verfallen[id] = (ag.verfallen[id] ?? 0) + 1;
    } else if (e.art === 'projekt_verfallen') {
      const id = e.projekt?.art ?? '?';
      ag.projekteVerfallen[id] = (ag.projekteVerfallen[id] ?? 0) + 1;
      ag.verfalleneStunden.push(e.projekt?.stunden_ist ?? 0);
      /*
       * Warum ein Kollabo verfällt (Task 7): Stunden gegen Soll UND die Titel, die
       * beim Verfall im Katalog lagen. Ein Konto mit vollen Stunden und zu wenigen
       * Titeln hängt an `no_songs` (`angebote.arbeiten`, `KOLLABO_TITEL`); eines mit
       * zu wenigen Stunden hat die Zeit nicht investiert. Die Titel stehen am
       * `now` der Abrechnung, also am Tag, an dem der Verfall bemerkt wird (nach der
       * Frist), nicht an der Frist selbst.
       */
      if (e.projekt?.art === 'kollabo') {
        ag.kollaboVerfall.push({
          ist: e.projekt.stunden_ist ?? 0, soll: e.projekt.stunden_soll ?? 0,
          titel: kontext ? music.status(kontext.G, kontext.U, kontext.now).songs : null,
        });
      }
    }
  }
}

/** Eine Annahme in die Zähler – nur, was `annehmen` zurückgegeben hat. */
function zaehleAnnahme(art, contact, r) {
  if (!ag) return;
  if (!r.ok) {
    ag.annahmeAb[`${art}/${r.reason}`] = (ag.annahmeAb[`${art}/${r.reason}`] ?? 0) + 1;
    return;
  }
  ag.angenommen[art] = (ag.angenommen[art] ?? 0) + 1;
  if (r.honorar !== null && r.honorar !== undefined) {
    ag.honorare.push(r.honorar);
    ag.honorarSeine.push(contact?.reach ?? 0);
    ag.honorarBrutto += r.geld?.gross ?? 0;
    ag.honorarNetto += r.geld?.amount ?? 0;
  }
  if (r.gage !== null && r.gage !== undefined) {
    ag.gagen.push(r.gage);
    ag.extraHoerer.push(r.extraHoerer ?? 0);
    ag.gageSeine.push(contact?.reach ?? 0);
    ag.gageBrutto += r.geld?.gross ?? 0;
    ag.gageNetto += r.geld?.amount ?? 0;
  }
  if (r.projekt) ag.projekteAuf[art] = (ag.projekteAuf[art] ?? 0) + 1;
  if (r.vertragsangebot) {
    ag.vertragAngebote++;
    const k = r.vertragsangebot.kind ?? '?';
    ag.vertragArten[k] = (ag.vertragArten[k] ?? 0) + 1;
  }
}

/** Ein abgeschlossenes Projekt in die Zähler – nur, was `abschliessen` gemeldet hat. */
function zaehleAbschluss(r, now) {
  if (!ag) return;
  ag.projekteFertig[r.art] = (ag.projekteFertig[r.art] ?? 0) + 1;
  if (r.art === 'kollabo') {
    ag.kollaboFaktoren.push(r.audience);
    ag.kollaboAudience.push(r.platte?.audience ?? 0);
    ag.kollaboPlatz.push(r.platte?.position ?? 0);
    ag.kollaboGewonnen.push(r.platte?.gained ?? 0);
  }
  if (r.art === 'tour') {
    ag.tourAbende += r.abende?.length ?? 0;
    ag.tourKonzerte.push(r.konzerte ?? 0);
    ag.tourAbgesagt += (r.abende ?? []).filter((a) => a.ok && a.cancelled).length;
    ag.tourBrutto.push(r.brutto ?? 0);
    ag.tourNetto += r.verdient ?? 0;
    ag.tourGast.push(r.gast ?? 0);
    ag.tourGewonnen.push(r.gewonnen ?? 0);
  }
  if (TRACE !== 'angebote') return;
  const zeile = {
    datum: new Date(now).toISOString().slice(0, 10), was: 'projekt_fertig',
    modus: ag.spielweise, art: r.art, kontakt: r.contact?.id ?? null,
    seine: r.contact?.reach ?? null,
  };
  if (r.art === 'kollabo') {
    Object.assign(zeile, {
      audience: r.audience, platteAudience: r.platte?.audience, platz: r.platte?.position,
      gewonnen: r.platte?.gained, hoererNach: r.platte?.listeners, buzz: r.platte?.buzz,
    });
  } else {
    Object.assign(zeile, {
      gast: r.gast, konzerte: r.konzerte, brutto: r.brutto, netto: r.verdient,
      cut: r.cut, gewonnen: r.gewonnen,
      abende: (r.abende ?? []).map((a) => ({
        ok: a.ok, brutto: a.gross, netto: a.amount, extra: a.extraHoerer,
        guete: a.quality, gewonnen: a.gained, abgesagt: a.cancelled,
      })),
    });
  }
  console.error(JSON.stringify(zeile));
}

/**
 * Ein Angebotstag.
 *
 * Die Spielweise ist bewusst die FLEISSIGE und nicht die kluge – dieselbe Linie
 * wie beim Beeflauf:
 *
 *  1. Faul abrechnen (§4). Damit kommen die Anfragen herein und die Fristen
 *     laufen ab; was dabei verfällt, wird gezählt.
 *  2. JEDE offene Anfrage wird HEUTE beantwortet – angenommen, wenn die
 *     Spielweise diese Art will, sonst abgelehnt. Liegen bleibt nichts: Das wäre
 *     eine dritte Entscheidung (−8 Draht statt −5), und sie steckt in „alles-ab"
 *     ohnehin als die teurere Variante derselben Haltung. Was trotzdem verfällt
 *     – eine Anfrage, die am Tag ihrer Zustellung schon durch war –, steht als
 *     Zahl in der Ausgabe.
 *  3. Am offenen Projekt arbeiten, `ANGEBOT_DRUECKE` Drücke am Tag (Standard 2 =
 *     vier Stunden). Das ist die Zahl, die ein Konto innerhalb der Frist
 *     zuverlässig füllt: Das Kollabo braucht 18 Stunden (9 Drücke → 5 Tage), die
 *     Tour 24 (12 Drücke → 6 Tage), die Frist ist 14 Tage. Mit einem Druck am Tag
 *     bräuchte die Tour 12 von 14 Tagen – ein einziger Tag ohne Zeit hätte das
 *     Konto verfallen lassen, und gemessen wäre dann die Frist und nicht die
 *     Tour. Mit zwei Drücken bleibt ein echter Preis (vier von 24 Stunden an
 *     diesen Tagen) und ein Spielraum, der nicht am Zufall hängt. Wie viele
 *     Konten trotzdem verfallen sind, steht in der Ausgabe.
 *  4. Ein Vertragsangebot wird unterschrieben, wenn die Spielweise `label` will.
 *     Ausgestiegen wird NIE (`music.leave` kostet 15 Tage Tantiemen) – wer
 *     unterschreibt, sitzt die 60 Tage ab.
 */
async function angebotetag(G, U, now, rand, spielweise) {
  if (!ag) return null;
  const annahme = ANGEBOT_ANNAHME[spielweise];
  if (!annahme) return null;
  const s = music.status(G, U, now);
  if (!s.started) return null;

  // 1. Zustellung und Fristen. Die Pause wird an der Uhr abgelesen, nicht
  //    nachgerechnet: `settle` meldet sie nicht als Ereignis.
  const uhrVor = db.angebotUhr(G, U);
  zaehleAngebotEreignisse(angebote.settle(G, U, now, rand), { G, U, now });
  const uhrNach = db.angebotUhr(G, U);
  if (uhrNach.pause_bis > uhrVor.pause_bis && uhrNach.pause_bis > now) ag.pausen++;

  // 2. Antworten. Die Liste wird VOR der ersten Antwort gelesen; eine Anfrage,
  //    die inzwischen weg ist, meldet der Knopf mit `weg`/`abgelaufen`, und das
  //    wird gezählt statt verschwiegen.
  for (const a of angebote.offeneAngebote(G, U, now)) {
    if (TRACE === 'angebote') {
      console.error(JSON.stringify({
        datum: new Date(now).toISOString().slice(0, 10),
        was: annahme.has(a.art) ? 'annehmen' : 'ablehnen', modus: ag.spielweise,
        art: a.art, kontakt: a.contact?.id ?? null, seine: a.contact?.reach ?? null,
        meine: Math.round(s.listeners), hoererTantiemen: Math.round(
          music.royaltyPerDay(s.listeners, music.marketOf(G, U))),
      }));
    }
    if (annahme.has(a.art)) {
      const r = await angebote.annehmen(G, U, a.id, now, rand);
      zaehleAngebotEreignisse(r.vorher, { G, U, now });
      zaehleAnnahme(a.art, a.contact, r);
      if (TRACE === 'angebote' && r.ok) {
        console.error(JSON.stringify({
          datum: new Date(now).toISOString().slice(0, 10), was: 'angenommen',
          modus: ag.spielweise, art: a.art, kontakt: a.contact?.id ?? null,
          seine: a.contact?.reach ?? null, honorar: r.honorar, gage: r.gage,
          extraHoerer: r.extraHoerer, brutto: r.geld?.gross ?? null,
          cut: r.geld?.cut ?? null, netto: r.geld?.amount ?? null,
          draht: r.draht?.draht ?? null, projekt: r.projekt ? r.projekt.stunden_soll : null,
          vertrag: r.vertragsangebot ? r.vertragsangebot.kind : null,
        }));
      }
    } else {
      const r = angebote.ablehnen(G, U, a.id, now, rand);
      zaehleAngebotEreignisse(r.vorher, { G, U, now });
      if (r.ok) ag.abgelehnt[a.art] = (ag.abgelehnt[a.art] ?? 0) + 1;
      else ag.annahmeAb[`${a.art}/ab-${r.reason}`] = (ag.annahmeAb[`${a.art}/ab-${r.reason}`] ?? 0) + 1;
    }
  }

  // 3. Am Projekt arbeiten.
  for (let i = 0; i < ANGEBOT_DRUECKE; i++) {
    const offen = angebote.offeneProjekte(G, U, now + i * 1000);
    if (!offen.length) break;
    if (TRACE === 'angebote') {
      /*
       * Die Hörerzahl VOR dem Druck, mit demselben Zeitstempel, mit dem
       * `abschliessen` sie gleich über `beef.musikLage` liest. Nur mit dieser
       * Zahl ist der Kollabo-Faktor von Hand nachrechenbar: Nach der
       * Veröffentlichung ist sie eine andere.
       */
      console.error(JSON.stringify({
        datum: new Date(now).toISOString().slice(0, 10), was: 'arbeiten',
        modus: ag.spielweise, art: offen[0].art, kontakt: offen[0].contact_id,
        seine: offen[0].contact?.reach ?? null,
        meine: music.status(G, U, now + i * 1000).listeners,
        ist: offen[0].stunden_ist, soll: offen[0].stunden_soll,
      }));
    }
    const r = await angebote.arbeiten(G, U, offen[0].id, now + i * 1000, rand);
    zaehleAngebotEreignisse(r.vorher, { G, U, now: now + i * 1000 });
    if (!r.ok) {
      ag.arbeitAb[`${offen[0].art}/${r.reason}`] = (ag.arbeitAb[`${offen[0].art}/${r.reason}`] ?? 0) + 1;
      break;                       // derselbe Grund gilt auch für den zweiten Druck
    }
    ag.druecke++;
    if (r.fertig) zaehleAbschluss(r, now);
  }

  // 4. Unterschreiben.
  if (annahme.has('label')) {
    const offer = db.openContract(G, U, now);
    if (offer) {
      const r = await music.sign(G, U, offer.id, now + 3e4);
      if (r.ok) {
        ag.unterschrieben++;
        ag.vorschuesse.push(r.advance);
        ag.vorschussNetto += r.advance;
        if (TRACE === 'angebote') {
          console.error(JSON.stringify({
            datum: new Date(now).toISOString().slice(0, 10), was: 'unterschrieben',
            modus: ag.spielweise, kind: offer.kind, agency: offer.agency,
            land: offer.country, vorschuss: r.advance,
            vorschussTage: r.terms?.advanceDays, anteil: r.terms?.cut,
            meine: Math.round(music.status(G, U, now).listeners),
          }));
        }
      } else ag.signAb[r.reason] = (ag.signAb[r.reason] ?? 0) + 1;
    }
  }
  return null;
}

/** Eine Variante des Angebotslaufs über alle Seeds; beide Zähler kommen mit. */
async function angebotvariante(kennungBasis, musik, strat, laeufe, tage, spielweise) {
  kz = neuerZaehler({ beziehung: true });                 // Kanalaktionen, Veröffentlichungen, Konzerte
  ag = neuerAngebotZaehler(spielweise);
  const geld = [];
  const hoerer = [];
  const follower = [];
  const summe = {};
  let zaehler;
  let angebotZaehler;
  try {
    for (let i = 0; i < laeufe; i++) {
      const kennung = `${kennungBasis}_${i}`;
      const G = welt(kennung);
      const U = `fx:${kennung}`;
      const r = await karriere(G, U, { musik, strat }, tage, 1000 + i);
      geld.push(r.geld);
      hoerer.push(r.hoerer);
      follower.push(r.follower);
      for (const [k, v] of Object.entries(r.quellen)) summe[k] = (summe[k] ?? 0) + v;
      /*
       * Der Draht am Ende des Laufs – der Beweis, dass es überhaupt Partner gab.
       * Gezählt werden nur Kontakte mit MUSIK-Reichweite, denn nur die können
       * eine Gegenanfrage schicken (`zustellen`), und mit `drahtJetzt`, weil der
       * rohe Speicherwert den Abklang noch nicht enthält.
       */
      const ende = new Date(new Date().setHours(6, 0, 0, 0)).getTime() + tage * DAY;
      const zeilen = db.contactsOf(G, U)
        .map((z) => ({ c: contactsData.byId(z.contact_id), draht: contacts.drahtJetzt(z, ende),
          partner: contacts.istPartnerRow(z, ende) }))
        .filter((z) => (z.c?.reach ?? 0) > 0);
      ag.bekanntAmEnde.push(zeilen.filter((z) => z.draht >= contactsData.STUFE_BEKANNT).length);
      // Partner nach der EINEN Regel (`istPartner`: Respekt UND Vertrauen >= 50),
      // nicht nach dem Draht – Respekt 100 / Vertrauen 0 ist Draht 50 und kein Partner.
      const partner = zeilen.filter((z) => z.partner);
      ag.partnerAmEnde.push(partner.length);
      for (const z of partner) ag.partnerReach.push(z.c.reach);
    }
  } finally {
    // Auch wenn ein Lauf abbricht: Die Zähler müssen weg, sonst zählen die
    // Hüllen in jeden folgenden Lauf hinein.
    zaehler = kz; kz = null;
    angebotZaehler = ag; ag = null;
  }
  return {
    geld, zaehler, angebotZaehler,
    median: median(geld), q25: quantil(geld, 0.25), q75: quantil(geld, 0.75),
    hoerer: median(hoerer), follower: median(follower),
    quellen: Object.fromEntries(Object.entries(summe)
      .map(([k, v]) => [k, v / Math.max(1, laeufe)]).sort((a, b) => b[1] - a[1])),
  };
}

/** Die Zählerzeilen einer Angebots-Variante – roh, ohne Rundung auf schöne Zahlen. */
function angebotZeilen(z, tage, laeufe) {
  const out = [];
  const n = tage * laeufe;
  const liste = (o) => Object.entries(o).sort((a, b) => b[1] - a[1])
    .map(([k, v]) => `${k} ${de(v)}`).join(', ') || 'keine';
  const summe = (o) => Object.values(o).reduce((a, b) => a + b, 0);
  const quote = (a, b) => (b ? `${komma((a / b) * 100, 1)} %` : '– (0 Fälle)');
  const f = (a, k = 0) => (a.length
    ? `Ø ${komma(mittel(a), k)} (kleinster ${komma(Math.min(...a), k)}, größter ${komma(Math.max(...a), k)})`
    : 'keiner');

  const zu = summe(z.zugestellt);
  const an = summe(z.angenommen);
  const ab = summe(z.abgelehnt);
  const ver = summe(z.verfallen);
  out.push(`Zugestellt ${de(zu)} Anfragen in ${de(n)} Tagen (${komma(zu / n, 3)}/Tag, erwartet ` +
    `${komma(angeboteData.ANFRAGE_CHANCE, 3)} je Wurf): ${liste(z.zugestellt)}`);
  out.push(`Ø Musik-Reichweite des anfragenden Kontakts: ${f(z.seine)}`);
  out.push(`Angenommen ${de(an)} (Annahmequote ${quote(an, zu)}): ${liste(z.angenommen)}`);
  out.push(`Abgelehnt ${de(ab)} (${quote(ab, zu)}): ${liste(z.abgelehnt)} · ` +
    `liegen geblieben und verfallen ${de(ver)} (${quote(ver, zu)}): ${liste(z.verfallen)}`);
  out.push(`Zustellweg ruhte ${de(z.pausen)}× zwei Wochen (nach ${angeboteData.PAUSE_SCHWELLE} nicht ` +
    `angenommenen Anfragen) – das sind ${de(z.pausen * angeboteData.PAUSE_TAGE)} von ${de(n)} Tagen ` +
    `(${quote(z.pausen * angeboteData.PAUSE_TAGE, n)}) ohne jeden Wurf`);
  out.push(`abgewiesene Knopfdrücke (Grund je Art): ${liste(z.annahmeAb)}`);
  out.push(`Honorar (gastpart) ${de(z.honorare.length)}×: ${f(z.honorare)} · brutto Σ ${de(z.honorarBrutto)}, ` +
    `netto Σ ${de(z.honorarNetto)} (${de(z.honorarNetto / n)}/Tag) · Ø Reichweite des Partners ${f(z.honorarSeine)}`);
  out.push(`Gage (vorgruppe) ${de(z.gagen.length)}×: ${f(z.gagen)} · brutto Σ ${de(z.gageBrutto)}, ` +
    `netto Σ ${de(z.gageNetto)} (${de(z.gageNetto / n)}/Tag) · mitgebrachte Hörer ${f(z.extraHoerer)} · ` +
    `Ø Reichweite des Partners ${f(z.gageSeine)}`);
  out.push(`Projekte aufgemacht: ${liste(z.projekteAuf)} · fertig: ${liste(z.projekteFertig)} · ` +
    `verfallen: ${liste(z.projekteVerfallen)} (dabei verfallene Stunden ${f(z.verfalleneStunden, 1)})`);
  const kv = z.kollaboVerfall;
  if (kv.length) {
    const voll = kv.filter((k) => k.ist >= k.soll);
    const titel = kv.map((k) => k.titel).filter((t) => t !== null);
    out.push(`Verfallene Kollabos ${kv.length}: Stunden voll (${kv[0].soll}) bei ${voll.length}, ` +
      `davon mit weniger als ${angeboteData.KOLLABO_TITEL} Titeln beim Verfall ` +
      `${voll.filter((k) => (k.titel ?? Infinity) < angeboteData.KOLLABO_TITEL).length} · ` +
      `Titel beim Verfall: Ø ${titel.length ? komma(mittel(titel), 1) : '–'} ` +
      `(Soll ${angeboteData.KOLLABO_TITEL}) · je Projekt Stunden/Titel: ` +
      `${kv.map((k) => `${k.ist}/${k.soll} h, ${k.titel ?? '?'} T`).join('; ')}`);
  }
  out.push(`Drücke auf „daran arbeiten" ${de(z.druecke)} (${komma(z.druecke / n, 3)}/Tag, je Druck ` +
    `${angeboteData.ARBEIT_STUNDEN} h = ${de(z.druecke * angeboteData.ARBEIT_STUNDEN)} Stunden) · ` +
    `abgewiesen: ${liste(z.arbeitAb)}`);
  out.push(`Kollabo: Faktor auf das Publikum ${f(z.kollaboFaktoren, 3)} (Decke ${komma(2, 3)}) · ` +
    `erreichtes Publikum ${f(z.kollaboAudience)} · gewonnene Hörer ${f(z.kollaboGewonnen)} · ` +
    `Chartplatz ${f(z.kollaboPlatz, 1)}`);
  out.push(`Tour: Abende ${de(z.tourAbende)} (davon abgesagt ${de(z.tourAbgesagt)}), gespielte Konzerte je Tour ` +
    `${f(z.tourKonzerte, 1)} · Brutto je Tour ${f(z.tourBrutto)}, netto Σ ${de(z.tourNetto)} ` +
    `(${de(z.tourNetto / n)}/Tag) · mitgebrachte Hörer am letzten Abend ${f(z.tourGast)} · ` +
    `gewonnene Hörer je Tour ${f(z.tourGewonnen)}`);
  out.push(`Vertrag: Angebote ${de(z.vertragAngebote)} (Arten: ${liste(z.vertragArten)}) · ` +
    `unterschrieben ${de(z.unterschrieben)} · ausgelaufen ${de(z.vertragEnden)} · ` +
    `Vorschuss ${f(z.vorschuesse)}, Σ ${de(z.vorschussNetto)} (${de(z.vorschussNetto / n)}/Tag) · ` +
    `nicht unterschrieben: ${liste(z.signAb)}`);
  out.push(`Beziehung am Laufende (nur Kontakte mit Musik-Reichweite): Partner (Respekt ≥ ` +
    `${contactsData.PARTNER_RESPEKT} und Vertrauen ≥ ${contactsData.PARTNER_VERTRAUEN}) ${f(z.partnerAmEnde, 1)} · ` +
    `bekannt (Draht ≥ ${contactsData.STUFE_BEKANNT}) ` +
    `${f(z.bekanntAmEnde, 1)} · Reichweite dieser Partner ${f(z.partnerReach)}`);
  return out;
}

/**
 * Die Decken dieses Stücks, mit den Funktionen aus `src/angebote.js` gerechnet
 * und nicht nachgebaut – damit §15 sie mit einer Quelle nennen kann.
 *
 * Das ist keine Simulation, sondern eine Rechnung: Was ist der GRÖSSTE Betrag,
 * den der Katalog hergibt, und was davon erreicht die gemessene Spielweise? Die
 * zweite Zahl ist die, die zählt – die erste ist die Decke, die §3 verlangt.
 */
function angebotDecken() {
  const out = [];
  const groesste = contactsData.CONTACTS.filter((c) => c.reach > 0)
    .reduce((a, c) => (c.reach > a.reach ? c : a));
  const markt = { royalty: 1 };
  const rpd = (h) => music.royaltyPerDay(h, markt);
  out.push(`Größter Musiker im Katalog: ${groesste.name} (${de(groesste.reach)} Hörer, ` +
    `${groesste.language}/${groesste.genre}/${groesste.country})`);
  const hoch = angebote.honorarOf({ seine: groesste.reach, tantiemenProTag: Number.MAX_SAFE_INTEGER / 60 });
  out.push(`Honorar, höchster möglicher Einzelbetrag: honorarOf(seine ${de(groesste.reach)}, Deckel offen) = ` +
    `${de(hoch)} – das ist ${komma(angeboteData.HONORAR_K, 1)} × ${de(groesste.reach)}^` +
    `${komma(angeboteData.HONORAR_EXP, 1)}; der zweite Deckel ist ` +
    `${angeboteData.HONORAR_DECKEL_TAGE} Tage eigener Tantiemen und bindet, solange ` +
    `${angeboteData.HONORAR_DECKEL_TAGE} × Tantiemen/Tag darunter liegt`);
  // Ab welcher eigenen Hörerzahl der Reichweiten-Term bindet statt des Deckels:
  // Suche über ganze Hörer, damit die Zahl aus derselben Funktion kommt.
  let schwelle = null;
  for (let h = 1_000; h <= 400_000; h += 1) {
    if (angeboteData.HONORAR_DECKEL_TAGE * rpd(h) >= hoch) { schwelle = h; break; }
  }
  out.push(`  … der Reichweiten-Term bindet erst ab ${schwelle === null ? '> 400.000' : de(schwelle)} ` +
    `eigenen Hörern (gesucht mit royaltyPerDay, Markt 1,0, in Schritten von einem Hörer); darunter ist ` +
    `das Honorar exakt ${angeboteData.HONORAR_DECKEL_TAGE} Tage eigener Tantiemen`);
  for (const meine of [1_000, 10_000, 100_000, 1_000_000]) {
    const zeile = [8_400, 350_000, 3_200_000, groesste.reach].map((seine) => {
      const h = angebote.honorarOf({ seine, tantiemenProTag: rpd(meine) });
      const deckel = Math.round(angeboteData.HONORAR_DECKEL_TAGE * rpd(meine));
      return `${de(h)}${h >= deckel ? ' (Deckel)' : ''}`;
    });
    out.push(`  honorarOf bei ${de(meine)} eigenen Hörern (Tantiemen ${de(rpd(meine))}/Tag, Deckel ` +
      `${de(angeboteData.HONORAR_DECKEL_TAGE * rpd(meine))}): seine 8.400 → ${zeile[0]} · ` +
      `350.000 → ${zeile[1]} · 3,2 Mio → ${zeile[2]} · ${de(groesste.reach)} → ${zeile[3]}`);
  }
  for (const meine of [10_000, 100_000]) {
    const allein = angebote.gageOf({ meine, seine: 0, showPay: music.SHOW_PAY, showExp: music.SHOW_EXP });
    const mit = [350_000, 3_200_000, groesste.reach].map((seine) => angebote.gageOf({
      meine, seine, showPay: music.SHOW_PAY, showExp: music.SHOW_EXP }));
    out.push(`  gageOf bei ${de(meine)} eigenen Hörern: allein ${de(allein)} · seine 350.000 → ` +
      `${de(mit[0])} (×${komma(mit[0] / allein, 3)}) · 3,2 Mio → ${de(mit[1])} (×${komma(mit[1] / allein, 3)}) · ` +
      `${de(groesste.reach)} → ${de(mit[2])} (×${komma(mit[2] / allein, 3)}) – Decke 2^` +
      `${komma(music.SHOW_EXP, 1)} = ×${komma(Math.pow(2, music.SHOW_EXP), 3)}`);
  }
  for (const meine of [10_000, 100_000, 1_000_000]) {
    const k = [350_000, 3_200_000, groesste.reach].map((seine) => angebote.kollaboFaktorOf({ meine, seine }));
    out.push(`  kollaboFaktorOf bei ${de(meine)} eigenen Hörern: seine 350.000 → ×${komma(k[0], 3)} · ` +
      `3,2 Mio → ×${komma(k[1], 3)} · ${de(groesste.reach)} → ×${komma(k[2], 3)} (Decke ×2,000)`);
  }
  out.push(`  Vorschuss Label: ${musicData.LABEL.advanceDays} Tage Tantiemen bei Unterschrift, einmal je ` +
    `Vertrag, danach ${komma(musicData.LABEL.cut * 100, 0)} % Anteil über ${musicData.LABEL.durationDays} ` +
    `Tage – bei 100.000 Hörern also ${de(musicData.LABEL.advanceDays * rpd(100_000))} auf die Hand gegen ` +
    `${de(musicData.LABEL.cut * musicData.LABEL.durationDays * rpd(100_000))}, die der Anteil über die ` +
    `Laufzeit aus den Tantiemen allein nimmt (ohne Wachstum ×${komma(musicData.LABEL.growth, 1)} ` +
    `und Hallen ×${komma(musicData.LABEL.liveBonus, 1)} gegengerechnet – was netto bleibt, sagt der Lauf)`);
  /*
   * Die Decken gelten für den GRÖSSTEN Partner. Erreichbar ist er nicht
   * zwangsläufig: Die Antwortchance fällt mit dem Größenverhältnis. Deshalb
   * steht hier, was `contacts.chanceOf` für die größten Kontakte hergibt –
   * abgelesen aus derselben Funktion, die die Ansicht zeigt.
   */
  const ich = { language: 'deutsch', genre: 'pop' };
  /** Dieselben Summanden, mit denen `contacts.detail` die Chance auf den Knopf schreibt. */
  const chance = (c, meine, respekt = 0, vertrauen = 0) => contacts.chanceOf({
    meineReichweite: meine, seineReichweite: c.reach, request: 'shoutout',
    gleichesLand: c.country === 'de',
    sprache: c.language === ich.language ? 'gleich' : (c.language === 'englisch' ? 'englisch' : 'fremd'),
    genre: c.genre === ich.genre ? 'gleich'
      : (contactsData.RELATED_GENRES.some(([x, y]) => (x === ich.genre && y === c.genre)
        || (y === ich.genre && x === c.genre)) ? 'verwandt' : 'fremd'),
    respekt, vertrauen, hype: 1, trait: c.trait, partner: contacts.istPartner(respekt, vertrauen),
  });
  for (const meine of [100_000, 1_000_000]) {
    const zeilen = contactsData.CONTACTS.filter((c) => c.reach > 0)
      .sort((a, b) => b.reach - a.reach).slice(0, 3)
      .map((c) => `${c.name} (${de(c.reach)}) ${komma(chance(c, meine, 0, 0) * 100, 1)} %`);
    out.push(`  Antwortchance eines deutschen Pop-Künstlers mit ${de(meine)} Hörern bei den drei größten ` +
      `Kontakten (chanceOf mit „Erwähnung", Respekt 0, Vertrauen 0, Hype 1,0): ${zeilen.join(' · ')} – ` +
      `${komma(contactsData.CHANCE_MIN * 100, 1)} % ist die Untergrenze CHANCE_MIN, und sie ändert sich ` +
      `mit dem RESPEKT (nicht dem Draht) um ${komma(contactsData.RESPEKT_W_MIN * 100, 0)} bis ` +
      `${komma((contactsData.RESPEKT_W_MIN + contactsData.RESPEKT_W_SPAN) * 100, 0)} Punkte × Respekt/100 – ` +
      `je größer der Abstand, desto mehr, das volle Gewicht ab ${contactsData.RESPEKT_W_DEKADEN} Dekaden; ` +
      `ein Vertrauen unter 0 dämpft den Respekt-Term und senkt die Chance zusätzlich, ` +
      `positives Vertrauen hebt sie nicht`);
  }
  return out;
}

/**
 * Stück 5c: Was die Gegenanfragen bringen.
 *
 * Zwei Archetypen – Musik+Creator und nur Musik; der reine Creator kommt nicht
 * vor, weil eine Gegenanfrage eine Sache unter Musikern ist (`musikIch` gibt für
 * ihn `null`, und `annehmen` antwortet `seite`). Je Archetyp sechs Varianten plus
 * das Kollabo-Kontrollpaar, alle mit demselben Würfel und derselben Strategie.
 * Die Strategie wird je Archetyp EINMAL gesucht – ohne Kontakte und ohne
 * Angebote, also in derselben Welt wie im Kontakt- und im Beeflauf – und dann für
 * alle Varianten festgehalten; sonst misst man die Strategiewahl.
 */
async function angebotelauf(laeufe, tage) {
  const paare = [
    { titel: 'Musik+Creator', musik: true, kennung: 'ang_beides' },
    // Der reine Musiker: dieselbe Messung ohne Kanalprogramm. Bei ihm gibt es
    // keine Füllaktionen, die die Stunden verdrängen könnten – der Preis der
    // Gegenanfragen ist dort allein die Zeit und der Veröffentlichungsplatz.
    { titel: 'nur Musik', musik: true, kennung: 'ang_musik', kanaele: false },
  ];

  console.log('  Decken, mit den Funktionen aus src/angebote.js gerechnet (keine Simulation):');
  for (const l of angebotDecken()) console.log(`    ${l}`);
  console.log();

  for (const a of paare) {
    const alle = a.kanaele === false
      ? strategien(true).filter((s) => s.name.startsWith('Ertrag je Zeit +0B'))
        .map((s) => ({ ...s, kanaele: false }))
      : strategien(a.musik);
    let strat;
    if (STRATEGIE && alle.some((s) => s.name === STRATEGIE)) {
      strat = alle.find((s) => s.name === STRATEGIE);
    } else {
      const such = await durchlauf(`${a.kennung}_suche`, a.musik, Math.max(2, Math.min(3, laeufe)),
        Math.min(tage, 180), alle, true);
      strat = alle.find((s) => s.name === such.strategie);
    }
    // Die Grundlage aller Varianten: dieselbe Strategie, dieselbe
    // Kontaktpflege mit Partner-Vorrang, nur die Spielweise wechselt.
    const basis = { ...strat, kontakte: true, kontaktVorrang: 'partner' };
    console.log(`  ${a.titel}: Strategie "${strat.name}" (Suche ohne Kontakte und ohne Angebote), ` +
      `${laeufe} Läufe à ${tage} Tage, Würfel rng(1000+i), Kontaktwürfe rng(501000+i), ` +
      `Angebotswürfe rng(901000+i), Kontaktpflege in ALLEN Varianten mit Partner-Vorrang, ` +
      `${ANGEBOT_DRUECKE} Drücke „daran arbeiten"/Tag`);

    const v = {};
    for (const name of ['aus', 'alles-ab', 'alles-an', 'nur-geld', 'nur-projekte', 'nur-label']) {
      v[name] = await angebotvariante(`${a.kennung}_${name.replace('-', '')}`, a.musik,
        { ...basis, angebote: name }, laeufe, tage, name);
    }

    const zeile = (was, r) => `    ${was.padEnd(24)}${de(r.median / tage).padStart(10)}/Tag   ` +
      `[${de(r.q25 / tage)} … ${de(r.q75 / tage)}]   ${de(r.follower)} Follower` +
      (r.hoerer ? `, ${de(r.hoerer)} Hörer` : '');
    /*
     * Gepaart auswerten: Je Seed läuft in allen Varianten derselbe Würfel, das
     * Verhältnis je Seed ist damit die ehrlichere Zahl – es steht neben dem
     * Verhältnis der Mediane, nicht an seiner Stelle.
     */
    const paarweise = (r, b) => r.geld.map((g, i) => g / Math.max(1, b.geld[i]));
    const diffzeile = (r, b, wasBasis) => {
      const p = paarweise(r, b);
      const rauf = p.filter((x) => x > 1).length;
      return `      gegen „${wasBasis}": Mediane ${prozent(r.median / Math.max(1, b.median) - 1)} · ` +
        `je Seed (gepaart) Median ${prozent(median(p) - 1)}, ` +
        `Spanne ${prozent(Math.min(...p) - 1)} … ${prozent(Math.max(...p) - 1)}, ` +
        `${rauf} von ${p.length} Seeds im Plus\n` +
        `      je Seed: ${p.map((x) => prozent(x - 1)).join(' · ')}`;
    };
    const titel = {
      aus: 'aus (die Grundlage)',
      'alles-ab': 'alles-ab',
      'alles-an': 'alles-an',
      'nur-geld': 'nur-geld',
      'nur-projekte': 'nur-projekte',
      'nur-label': 'nur-label',
    };

    console.log(zeile(titel.aus, v.aus));
    for (const name of ['alles-ab', 'alles-an', 'nur-geld', 'nur-projekte', 'nur-label']) {
      console.log(zeile(titel[name], v[name]));
      console.log(diffzeile(v[name], v.aus, 'aus'));
    }
    const quellenzeile = (was, r) => `      Quellen ${was.padEnd(16)}` + (Object.entries(r.quellen)
      .filter(([, x]) => Math.abs(x) > 1)
      .map(([k, x]) => `${k} ${de(x / tage)}/Tag (${Math.round((x / Math.max(1, r.median)) * 100)} %)`).join(' · ') || 'keine');
    for (const name of ['aus', 'alles-ab', 'alles-an', 'nur-geld', 'nur-projekte', 'nur-label']) {
      console.log(quellenzeile(`${name}:`, v[name]));
    }

    // Was die Stunden gekostet haben – gezählt, nicht überschlagen.
    const l = (r) => leistung(r.zaehler, tage, laeufe);
    const la = l(v.aus);
    console.log(`      Tagesleistung Ø/Tag (Kanalaktionen · Veröffentlichungen · Konzerte): ` +
      ['aus', 'alles-ab', 'alles-an', 'nur-geld', 'nur-projekte', 'nur-label']
        .map((name) => {
          const x = l(v[name]);
          return `${name} ${komma(x.akte)} · ${komma(x.publishes)} · ${komma(x.shows)}`;
        }).join(' → '));
    console.log(`      Veröffentlichungen und Konzerte gegen „aus": ` +
      ['alles-an', 'nur-projekte'].map((name) => {
        const x = l(v[name]);
        return `${name} ${prozent(x.publishes / Math.max(1e-9, la.publishes) - 1)} Veröffentlichungen, ` +
          `${prozent(x.shows / Math.max(1e-9, la.shows) - 1)} Konzerte`;
      }).join(' · '));

    for (const name of ['aus', 'alles-ab', 'alles-an', 'nur-geld', 'nur-projekte', 'nur-label']) {
      console.log(`    ${name}:`);
      for (const z of angebotZeilen(v[name].angebotZaehler, tage, laeufe)) console.log(`      ${z}`);
      for (const z of beziehungsZeilen(v[name].zaehler.beziehung, { projekteMoeglich: nimmtProjekteAn(name) })) console.log(`      ${z}`);
    }

    /*
     * Die Kontrollzeilen. Eine stille Null ist ein Fehler, kein Ergebnis –
     * deshalb sagt jede Variante, dass sie gemessen hat, was sie behauptet, und
     * zwar in beide Richtungen: „aus" MUSS leer sein, die anderen fünf dürfen es
     * nicht, und jede isolierende Variante MUSS bei den Arten, die sie nicht
     * annimmt, auf null stehen.
     */
    const summe = (o) => Object.values(o).reduce((x, y) => x + y, 0);
    const leer = (z) => !summe(z.zugestellt) && !summe(z.angenommen) && !summe(z.abgelehnt)
      && !summe(z.verfallen) && !z.honorare.length && !z.gagen.length && !summe(z.projekteAuf)
      && !z.vertragAngebote && !z.unterschrieben && !z.druecke;
    const zaus = v.aus.angebotZaehler;
    console.log(`      KONTROLLE „aus": ${leer(zaus)
      ? `keine Anfrage, kein Honorar, keine Gage, kein Projekt, kein Vertrag ✔ – der Draht stand ` +
        `trotzdem (Ø ${komma(mittel(zaus.partnerAmEnde), 1)} Partner und Ø ` +
        `${komma(mittel(zaus.bekanntAmEnde), 1)} Bekannte mit Musik-Reichweite am Laufende), ` +
        `der Zustellweg wurde nur nie gerufen`
      : `NICHT LEER – FEHLER: ${JSON.stringify({ zugestellt: zaus.zugestellt, angenommen: zaus.angenommen })}`}`);
    const pruefe = (name, erwartetNull, erwartetNichtNull) => {
      const z = v[name].angebotZaehler;
      const istNull = erwartetNull.filter(([, x]) => (typeof x === 'function' ? x(z) : x) !== 0);
      const istLeer = erwartetNichtNull.filter(([, x]) => (typeof x === 'function' ? x(z) : x) === 0);
      const zeigen = (paare2) => paare2.map(([k, x]) => `${k} ${de(typeof x === 'function' ? x(z) : x)}`).join(', ');
      console.log(`      KONTROLLE „${name}": ${istNull.length === 0 && istLeer.length === 0
        ? `${erwartetNull.length ? `${erwartetNull.map(([k]) => `${k} 0`).join(', ')} ✔ · ` : 'nichts muss null sein · '}` +
          `${erwartetNichtNull.map(([k, x]) => `${k} ${de(typeof x === 'function' ? x(z) : x)}`).join(', ')} ✔`
        : `FEHLER – nicht null, obwohl erwartet: ${zeigen(istNull) || '–'}; null, obwohl erwartet: ` +
          `${erwartetNichtNull.filter(([k]) => istLeer.some(([k2]) => k2 === k)).map(([k]) => k).join(', ') || '–'}`}`);
    };
    pruefe('alles-ab',
      [['angenommen', (z) => summe(z.angenommen)], ['Honorare', (z) => z.honorare.length],
        ['Gagen', (z) => z.gagen.length], ['Projekte', (z) => summe(z.projekteAuf)],
        ['Verträge', (z) => z.unterschrieben]],
      [['zugestellt', (z) => summe(z.zugestellt)], ['abgelehnt', (z) => summe(z.abgelehnt)]]);
    pruefe('alles-an', [],
      [['zugestellt', (z) => summe(z.zugestellt)], ['angenommen', (z) => summe(z.angenommen)]]);
    pruefe('nur-geld',
      [['Projekte', (z) => summe(z.projekteAuf)], ['Verträge', (z) => z.unterschrieben],
        ['Drücke', (z) => z.druecke]],
      [['Honorare', (z) => z.honorare.length], ['Gagen', (z) => z.gagen.length],
        ['abgelehnt', (z) => summe(z.abgelehnt)]]);
    pruefe('nur-projekte',
      [['Honorare', (z) => z.honorare.length], ['Gagen', (z) => z.gagen.length],
        ['Verträge', (z) => z.unterschrieben]],
      [['Projekte', (z) => summe(z.projekteAuf)], ['Drücke', (z) => z.druecke],
        ['abgelehnt', (z) => summe(z.abgelehnt)]]);
    pruefe('nur-label',
      [['Honorare', (z) => z.honorare.length], ['Gagen', (z) => z.gagen.length],
        ['Projekte', (z) => summe(z.projekteAuf)], ['Drücke', (z) => z.druecke]],
      [['Vertragsangebote', (z) => z.vertragAngebote], ['unterschrieben', (z) => z.unterschrieben],
        ['abgelehnt', (z) => summe(z.abgelehnt)]]);
    /*
     * Die Vertragsart ist eine eigene Kontrolle: Der Lauf wohnt in Deutschland
     * (`home.setHome(G, U, 'de')`), und `rollContract` klopft nur in Märkten mit
     * Idol-System an. Jeder Vertrag dieses Laufs MUSS also ein `label`-Vertrag
     * sein – sonst messen wir das Idol-Angebot und nennen es Label.
     */
    const zl = v['nur-label'].angebotZaehler;
    const arten = Object.keys(zl.vertragArten);
    console.log(`      KONTROLLE Vertragsart: ${arten.length === 1 && arten[0] === 'label'
      ? `ausschließlich \`label\` (${de(zl.vertragArten.label)} Angebote) ✔ – kein Idol-Angebot, ` +
        `denn der Lauf wohnt in Deutschland und rollContract klopft nur in Idol-Märkten`
      : `FEHLER – auch andere Arten: ${JSON.stringify(zl.vertragArten)}`}`);

    /*
     * Der Auslöser aus dem Plan/der Spec: Liegt eine Variante über +25 % gepaart,
     * wird die zugehörige Konstante gesenkt und neu gemessen. Ausgewertet wird
     * für jede Variante beides – Mediane und gepaart – und benannt, welche Zahl
     * ihn erreicht hat.
     */
    const kandidaten = ['alles-ab', 'alles-an', 'nur-geld', 'nur-projekte', 'nur-label']
      .flatMap((name) => [
        [`${name} (Mediane)`, v[name].median / Math.max(1, v.aus.median) - 1],
        [`${name} (gepaart)`, median(paarweise(v[name], v.aus)) - 1],
      ]);
    const groesste = kandidaten.reduce((x, y) => (y[1] > x[1] ? y : x));
    console.log(`      Auslöser „über +25 % gepaart" (Plan/Spec, Task 6): ` +
      kandidaten.filter(([k]) => k.endsWith('(gepaart)')).map(([k, x]) => `${k.replace(' (gepaart)', '')} ${prozent(x)}`).join(' · '));
    console.log(`      größte Differenz überhaupt: ${prozent(groesste[1])} (${groesste[0]}) → ` +
      `${groesste[1] > 0.25 ? 'ERREICHT, die zugehörige Konstante senken und neu messen'
        : 'nicht erreicht, alle Konstanten unverändert'}`);

    /*
     * =====================================================================
     *  DAS KONTROLLPAAR FÜR DAS KOLLABO-ALBUM
     * =====================================================================
     *
     * Siehe den Kopf dieses Abschnitts. Beide Varianten warten auf sechs Titel;
     * sie unterscheiden sich in genau einer Sache – ob das Album ein Kollabo ist.
     * Die Grundlage „aus" von oben taugt dafür nicht: Sie veröffentlicht jeden Tag
     * eine Single, und der Abstand zwischen Album und Single ist das Größte, was
     * dieses Spiel kennt.
     */
    const hAus = await angebotvariante(`${a.kennung}_hortenaus`, a.musik,
      { ...basis, angebote: 'horten-aus', horten: true }, laeufe, tage, 'horten-aus');
    const hKol = await angebotvariante(`${a.kennung}_hortenkollabo`, a.musik,
      { ...basis, angebote: 'horten-kollabo', horten: 'kollabo' }, laeufe, tage, 'horten-kollabo');
    console.log(`    ---- Kontrollpaar: das Kollabo gegen ein normales Album, gleiche Veröffentlichungspolitik ----`);
    console.log(zeile('horten, ohne Kollabo', hAus));
    console.log(zeile('horten, mit Kollabo', hKol));
    console.log(diffzeile(hKol, hAus, 'horten, ohne Kollabo'));
    console.log(diffzeile(hAus, v.aus, 'aus (täglich Single)'));
    console.log(quellenzeile('horten ohne:', hAus));
    console.log(quellenzeile('horten mit:', hKol));
    const lh = l(hAus); const lk = l(hKol);
    console.log(`      Tagesleistung Ø/Tag: horten ohne Kollabo ${komma(lh.akte)} Kanalaktionen · ` +
      `${komma(lh.publishes)} Veröffentlichungen · ${komma(lh.shows)} Konzerte → mit Kollabo ` +
      `${komma(lk.akte)} · ${komma(lk.publishes)} · ${komma(lk.shows)} ` +
      `(${prozent(lk.publishes / Math.max(1e-9, lh.publishes) - 1)} Veröffentlichungen)`);
    for (const [name, r] of [['horten-aus', hAus], ['horten-kollabo', hKol]]) {
      console.log(`    ${name}:`);
      for (const z of angebotZeilen(r.angebotZaehler, tage, laeufe)) console.log(`      ${z}`);
      for (const z of beziehungsZeilen(r.zaehler.beziehung, { projekteMoeglich: nimmtProjekteAn(name) })) console.log(`      ${z}`);
    }
    const zh = hAus.angebotZaehler;
    console.log(`      KONTROLLE „horten-aus": ${leer(zh)
      ? 'keine Anfrage, kein Projekt, kein Kollabo ✔'
      : `NICHT LEER – FEHLER: ${JSON.stringify({ zugestellt: zh.zugestellt, angenommen: zh.angenommen })}`}`);
    const zk = hKol.angebotZaehler;
    const kolFertig = zk.projekteFertig.kollabo ?? 0;
    console.log(`      KONTROLLE „horten-kollabo": Kollabos aufgemacht ${de(zk.projekteAuf.kollabo ?? 0)}, ` +
      `fertig ${de(kolFertig)} ${kolFertig > 0 ? '✔' : '– FEHLER: kein einziges Kollabo ist erschienen, ' +
        'die Variante misst nichts'}, Honorare ${de(zk.honorare.length)}, Gagen ${de(zk.gagen.length)}, ` +
      `Verträge ${de(zk.unterschrieben)} (die drei müssen 0 sein: ` +
      `${zk.honorare.length === 0 && zk.gagen.length === 0 && zk.unterschrieben === 0 ? '✔' : 'FEHLER'})`);
    /*
     * =====================================================================
     *  DIE ZERLEGUNG VON „ALLES-AN" (--zerlegung)
     * =====================================================================
     *
     * Vier Varianten, die alles annehmen BIS AUF eine Gruppe. „alles-an" minus
     * „ohne-X" ist der Beitrag von X – gemessen bei derselben Zustellrate und
     * damit ohne den Pausen-Effekt, der die isolierenden Varianten verzerrt.
     * Die Beiträge müssen sich NICHT zu „alles-an" addieren: Die Wege wirken
     * übereinander (ein Vorschuss hebt kein Honorar, aber die Hörer, die ein
     * Kollabo bringt, heben jede Tantieme danach). Genau das ist die Frage.
     */
    if (ZERLEGUNG) {
      console.log(`    ---- Zerlegung: „alles-an" ohne jeweils eine Gruppe (gleiche Zustellrate) ----`);
      const w = {};
      for (const name of ['ohne-geld', 'ohne-projekte', 'ohne-label', 'ohne-tausch']) {
        w[name] = await angebotvariante(`${a.kennung}_${name.replace('-', '')}`, a.musik,
          { ...basis, angebote: name }, laeufe, tage, name);
        console.log(zeile(name, w[name]));
        console.log(diffzeile(w[name], v.aus, 'aus'));
        console.log(diffzeile(w[name], v['alles-an'], 'alles-an'));
      }
      for (const name of ['ohne-geld', 'ohne-projekte', 'ohne-label', 'ohne-tausch']) {
        console.log(quellenzeile(`${name}:`, w[name]));
      }
      /*
       * Der Beitrag einer Gruppe, gepaart je Seed: `alles-an / ohne-X − 1`.
       * Gepaart, weil die Streuung über die Seeds größer ist als jeder dieser
       * Beiträge (siehe die Spannen oben).
       */
      const beitrag = ['ohne-geld', 'ohne-projekte', 'ohne-label', 'ohne-tausch']
        .map((name) => [name, median(paarweise(v['alles-an'], w[name])) - 1]);
      console.log(`      Beitrag der Gruppe zu „alles-an" (gepaart, alles-an gegen alles-an ohne X): ` +
        beitrag.map(([k, x]) => `${k.replace('ohne-', '')} ${prozent(x)}`).join(' · '));
      const stark = beitrag.reduce((x, y) => (y[1] > x[1] ? y : x));
      console.log(`      stärkster Beitrag: ${stark[0].replace('ohne-', '')} ${prozent(stark[1])} – ` +
        `DAS ist die Gruppe, deren Konstante der Auslöser meint`);
      for (const name of ['ohne-geld', 'ohne-projekte', 'ohne-label', 'ohne-tausch']) {
        console.log(`    ${name}:`);
        for (const z of angebotZeilen(w[name].angebotZaehler, tage, laeufe)) console.log(`      ${z}`);
        for (const z of beziehungsZeilen(w[name].zaehler.beziehung, { projekteMoeglich: nimmtProjekteAn(name) })) console.log(`      ${z}`);
      }
      // Kontrolle: Jede Variante MUSS bei ihrer ausgelassenen Gruppe auf null stehen.
      const sum2 = (o) => Object.values(o).reduce((x, y) => x + y, 0);
      const checks = [
        ['ohne-geld', (z) => z.honorare.length + z.gagen.length, 'Honorare + Gagen'],
        ['ohne-projekte', (z) => sum2(z.projekteAuf), 'Projekte'],
        ['ohne-label', (z) => z.vertragAngebote + z.unterschrieben, 'Vertragsangebote + Unterschriften'],
        ['ohne-tausch', (z) => z.angenommen.tausch ?? 0, 'angenommene tausch'],
      ];
      for (const [name, f2, was] of checks) {
        const z = w[name].angebotZaehler;
        const ab = sum2(z.abgelehnt);
        console.log(`      KONTROLLE „${name}": ${was} ${de(f2(z))} ` +
          `(${f2(z) === 0 ? 'erwartet 0 ✔' : 'FEHLER – die ausgelassene Gruppe wirkt doch'}), ` +
          `zugestellt ${de(sum2(z.zugestellt))}, abgelehnt ${de(ab)} ` +
          `(${ab > 0 ? 'nicht null ✔ – genau die ausgelassene Gruppe' : 'FEHLER – nichts abgelehnt'}), ` +
          `Pausen ${de(z.pausen)} gegen ${de(v['alles-an'].angebotZaehler.pausen)} in „alles-an"`);
      }
    }

    const kolM = hKol.median / Math.max(1, hAus.median) - 1;
    const kolP = median(paarweise(hKol, hAus)) - 1;
    console.log(`      Auslöser „über +25 % gepaart" für das Kollabo (gegen dieselbe ` +
      `Veröffentlichungspolitik): Mediane ${prozent(kolM)}, gepaart ${prozent(kolP)} → ` +
      `${Math.max(kolM, kolP) > 0.25 ? 'ERREICHT, KOLLABO_STUNDEN erhöhen oder den Faktor senken und neu messen'
        : 'nicht erreicht'}`);
    console.log();
  }
}

// =====================================================================
//  Vorfälle bei Musik und Creator (Stück 5f): vom Wurf je Aktion zum Wurf
//  je Tag
// =====================================================================
/*
 * Die eine Frage: Wie viele Vorfälle bekommt ein Spieler jetzt im JAHR – nach
 * Reichweite aufgeschlüsselt –, und verschiebt das seine Bilanz um mehr als
 * ±25 % in eine der beiden Richtungen?
 *
 * Warum es den Abschnitt gibt: Bis 5f hing ein Vorfall an der Zahl der
 * AKTIONEN (2 % je Aktion, im Schnitt fünfzig Aktionen bis zum ersten) – für
 * einen Gelegenheitsspieler unsichtbar. Seit 5f würfelt `decisions.tick` über
 * die vergangenen TAGE, in derselben Form wie die Firma.
 *
 * WARUM DER WURF HIER NEU EINGEHÄNGT WERDEN MUSSTE: Die Würfe je Aktion sind
 * weg (`music.record`, `publish`, `show` und `creator.act` rufen
 * `decisions.roll` nicht mehr), und `karriere` rief `tick` nicht. Ein
 * Karriere-Lauf hätte deshalb NULL Vorfälle gemeldet, ohne dass irgendetwas
 * nach einem Fehler aussieht. Genau diese stille Null ist der Fehler, gegen
 * den jede Kontrollzeile hier gebaut ist.
 *
 * Fünf Teile:
 *
 *  (1) HANDPRÜFUNG ohne Simulation – `riskPerDay` und `chanceOver` von Hand
 *      nachgerechnet und gegen den Code gehalten.
 *  (2) STUFENLAUF – Reichweite FESTGEHALTEN, ein Jahr je Stufe. Das ist die
 *      Zahl, die neben der Spec-Tabelle steht, und sie misst ausdrücklich
 *      etwas anderes als eine Karriere (siehe dort).
 *  (3) TÜRPROBE – wer einen Bereich nicht betreten hat, würfelt dort nicht.
 *  (4) SPERRE – derselbe Lauf mit und ohne Bereichsfilter, damit „die Firma
 *      nahm der Musik die Vorfälle weg" eine Zahl bekommt.
 *  (5) KARRIERE-LAUF – zwei Archetypen, Varianten „aus" und „an", gepaart je
 *      Seed, gegen den ±25-%-Auslöser.
 */

/** Die vier Vorfälle „vom Anfangen" (Schwelle 0, Obergrenze FRUEH_MAX). */
const VORFALL_FRUEH = new Set(['proberaum', 'kleiner_auftritt', 'erster_sponsor', 'festplatte']);

/**
 * Die Reichweitenstufen des Stufenlaufs – mindestens unter 5.000, um 100.000,
 * über 1 Mio. 10.000 und 20.000 stehen beide darin, weil zwischen ihnen die
 * frühen Vorfälle verschwinden (`FRUEH_MAX`, Obergrenze inklusiv).
 */
const VORFALL_STUFEN = [0, 2_000, 5_000, 10_000, 20_000, 100_000, 500_000, 1_000_000, 1_500_000];

/** Zähler des laufenden Vorfall-Laufs – `null`, solange nicht gemessen wird. */
let vf = null;

function neuerVorfallZaehler(variante) {
  return {
    variante,
    rand: null,
    tage: {},                 // Bereich -> Tage, an denen `tick` gerufen wurde
    wuerfe: {},               // Bereich -> Tage, an denen die Uhr geschrieben wurde (= gewürfelt)
    keinWurf: {},             // Bereich -> Tage ohne Wurf
    tuerZu: {},               // davon: Bereich nicht betreten
    offenBlockt: {},          // davon: offener Vorfall DIESES Bereichs
    durch: {},                // Bereich -> Würfe, bei denen der Würfel durchkam
    leer: {},                 // Grund -> Würfe, die trotz Durchkommen nichts gaben
    vorfaelle: {},            // Bereich -> Vorfälle
    beantwortet: {},          // Bereich -> entschiedene Vorfälle
    arten: {},                // Vorfall-ID -> Anzahl
    frueh: {},                // Bereich -> frühe Vorfälle
    fruehReach: [],           // Reichweite beim Ziehen eines frühen Vorfalls
    spaetReach: [],           // dasselbe für die übrigen
    nachgeholt: [],           // `tage` je Wurf (Deckel ROLL_TAGE_MAX)
    abstaende: [],            // Stunden zwischen zwei Vorfällen DESSELBEN Bereichs
    zuDicht: 0,               // Verstöße gegen MIN_GAP_MS
    letzter: {},              // Bereich -> created_at des letzten Vorfalls
    fehler: [],               // abgelehnte `choose`-Aufrufe (muss leer bleiben)
    /*
     * Zeilen in `creator_events`, am Ende jedes Laufs direkt aus der Tabelle
     * gezählt – NICHT von dieser Instrumentierung gefüllt.
     *
     * Der Grund steht in der Kontrollzeile: `vorfaelle` und `wuerfe` hängen
     * beide an `vorfallWurf`, und die Variante „aus" ruft `vorfallWurf` nie.
     * Zwei der drei Beine der Kontrolle wären damit null, weil sie niemand
     * füllt, und nicht, weil nichts passiert ist. Diese Zeilenzahl und der
     * Kontoposten „Vorfall" sind die zwei Beine, die ohne die Instrumentierung
     * auskommen.
     */
    zeilen: 0,
  };
}

/**
 * Wie viele Kandidaten der Katalog bei dieser Reichweite hergibt.
 *
 * NACHGEBAUT aus `decisions.roll` (dieselben Felder, dieselbe
 * `musicEligible`-Prüfung) und nur zur Diagnose da: Sie sagt, WARUM ein
 * durchgekommener Wurf nichts gegeben hat. Der Nachbau prüft sich selbst – jede
 * leere Antwort, die er nicht erklärt, landet unter `leer.unerklaert`, und diese
 * Zahl muss null sein.
 */
function vorfallKandidaten(G, U, domain, size, now) {
  if (domain === 'music') {
    const artist = db.getArtist(G, U, now);
    const contract = db.activeContract(G, U);
    return decisions.MUSIC_DECISIONS.filter((d) => size >= d.minListeners
      && size <= (d.maxListeners ?? Infinity) && decisions.musicEligible(d, artist, contract));
  }
  return decisions.DECISIONS.filter((d) => size >= d.minReach && size <= (d.maxReach ?? Infinity));
}

/**
 * Der Tageswurf im Messlauf – derselbe Aufruf wie in `buttons.settleMusic` und
 * `buttons.settleCreator`, nur mit Zählung drumherum.
 *
 * Der Würfel wird in eine Hülle gelegt, die jeden Zug mitschreibt. Damit ist
 * nachträglich zu sehen, ob der Würfel durchgekommen ist (erster Zug gegen
 * `chanceOver`) – und ein Wurf, der durchkam und trotzdem nichts gab, bekommt
 * seinen Grund statt einer Vermutung. Die Hülle gibt genau die Zahlen weiter,
 * die der Strom liefert; der Lauf bleibt derselbe.
 */
function vorfallWurf(G, U, domain, size, now, rand) {
  const uhrVor = db.decisionUhr(G, U, domain).last_roll;
  const offenVor = Boolean(db.openEvent(G, U, domain));
  const betreten = decisions.betreten(G, U, domain);
  const abstandZu = now - db.lastEventAt(G, U, domain) < decisions.MIN_GAP_MS;
  const kandidaten = vorfallKandidaten(G, U, domain, size, now).length;
  const zuege = [];
  const beob = () => { const v = rand(); zuege.push(v); return v; };
  const neu = decisions.tick(G, U, domain, size, now, beob);
  const z = vf;
  if (!z) return neu;
  z.tage[domain] = (z.tage[domain] ?? 0) + 1;
  if (db.decisionUhr(G, U, domain).last_roll === uhrVor) {
    z.keinWurf[domain] = (z.keinWurf[domain] ?? 0) + 1;
    if (!betreten) z.tuerZu[domain] = (z.tuerZu[domain] ?? 0) + 1;
    else if (offenVor) z.offenBlockt[domain] = (z.offenBlockt[domain] ?? 0) + 1;
    return neu;
  }
  z.wuerfe[domain] = (z.wuerfe[domain] ?? 0) + 1;
  const tage = uhrVor ? Math.min(decisions.ROLL_TAGE_MAX, Math.floor((now - uhrVor) / DAY)) : 1;
  z.nachgeholt.push(tage);
  if (zuege.length && zuege[0] < decisions.chanceOver(size, tage)) {
    z.durch[domain] = (z.durch[domain] ?? 0) + 1;
    if (!neu) {
      const grund = abstandZu ? 'abstand' : kandidaten === 0 ? 'keinKandidat' : 'unerklaert';
      z.leer[grund] = (z.leer[grund] ?? 0) + 1;
    }
  }
  if (neu) {
    z.vorfaelle[domain] = (z.vorfaelle[domain] ?? 0) + 1;
    z.arten[neu.kind] = (z.arten[neu.kind] ?? 0) + 1;
    if (VORFALL_FRUEH.has(neu.kind)) {
      z.frueh[domain] = (z.frueh[domain] ?? 0) + 1;
      z.fruehReach.push(Math.round(size));
    } else z.spaetReach.push(Math.round(size));
    const letzter = z.letzter[domain] ?? 0;
    if (letzter) {
      z.abstaende.push((neu.created_at - letzter) / 3600e3);
      if (neu.created_at - letzter < decisions.MIN_GAP_MS) z.zuDicht++;
    }
    z.letzter[domain] = neu.created_at;
  }
  return neu;
}

/**
 * (1) Die Handprüfung: dieselben Zahlen zweimal gerechnet.
 *
 * Links die Formel aus der Spec, hier von Hand hingeschrieben, rechts der Code.
 * Stimmen sie nicht auf die vierte Stelle überein, ist jede weitere Zahl dieses
 * Abschnitts wertlos – deshalb steht die Prüfung VOR jeder Simulation.
 */
function vorfallHandprobe() {
  const out = [];
  const handP = (r) => Math.min(0.08, Math.max(0.02, 0.02 + (Math.max(0, r) / 1_500_000) * 0.06));
  const handChance = (r, t) => 1 - (1 - handP(r)) ** Math.min(14, Math.max(0, t));
  let fehler = 0;
  out.push('Formel von Hand: p = clamp(0,02; 0,08; 0,02 + reichweite / 1.500.000 × 0,06) · ' +
    'chance(tage) = 1 − (1 − p)^min(tage, 14)');
  out.push('Reichweite      p Hand   p Code   erwartet/Jahr (365×p)   chance(1 Tag) Hand/Code   ' +
    'chance(14) Hand/Code   chance(30) Code (Deckel!)   30 Kalendertage 1−(1−p)^30');
  for (const r of [0, 100_000, 500_000, 1_000_000, 1_500_000, 3_000_000]) {
    const pH = handP(r);
    const pC = decisions.riskPerDay(r);
    const c1H = handChance(r, 1); const c1C = decisions.chanceOver(r, 1);
    const c14H = handChance(r, 14); const c14C = decisions.chanceOver(r, 14);
    const c30C = decisions.chanceOver(r, 30);
    const kal = 1 - (1 - pH) ** 30;
    const ok = Math.abs(pH - pC) < 1e-12 && Math.abs(c1H - c1C) < 1e-12 && Math.abs(c14H - c14C) < 1e-12;
    if (!ok) fehler++;
    out.push(`${de(r).padStart(10)}   ${komma(pH, 4)}   ${komma(pC, 4)}   ${komma(365 * pH, 1).padStart(6)}` +
      `                  ${komma(c1H * 100, 2)} / ${komma(c1C * 100, 2)} %        ` +
      `${komma(c14H * 100, 1)} / ${komma(c14C * 100, 1)} %        ${komma(c30C * 100, 1)} %` +
      `                    ${komma(kal * 100, 1)} %   ${ok ? '✔' : 'FEHLER'}`);
  }
  out.push(`KONTROLLE Handprüfung: ${fehler === 0
    ? 'Hand und Code stimmen an allen 6 Punkten auf 1e-12 überein ✔'
    : `FEHLER – ${fehler} Punkte weichen ab`}`);
  out.push('Spec-Tabelle zum Vergleich: 0 → 7,3 · 100.000 → 8,8 · 500.000 → 14,6 · 1 Mio → 21,9 · ' +
    '≥ 1,5 Mio → 29,2 Vorfälle je Jahr. Das ist 365 × p und damit eine OBERGRENZE ohne Sperre:');
  out.push('  Die Spec-Spalte „Chance in 30 Tagen" (45,5 % bei p = 0,02) ist 1 − (1 − p)^30, also 30 ' +
    'einzelne Tageswürfe. `chanceOver(reichweite, 30)` gibt etwas anderes (24,4 %), weil ROLL_TAGE_MAX ' +
    'die NACHGEHOLTEN Tage auf 14 deckelt – beide Zahlen sind richtig, sie antworten auf zwei Fragen. ' +
    'Im normalen Spiel (ein Wurf je Tag) gilt die Spec-Spalte.');
  return out;
}

/**
 * (2) Ein Stufenlauf: Reichweite FESTGEHALTEN, ein Jahr, ein Bereich.
 *
 * Warum festgehalten: Die Spec-Tabelle ist eine Zeile je Reichweite, nicht eine
 * Karriere. „8,8 Vorfälle bei 100.000" heißt „wer ein Jahr lang 100.000 hat" –
 * nicht „wer im Laufe des Jahres dort ankommt". Genau deshalb steht dieser Lauf
 * neben dem Karriere-Lauf und nicht an seiner Stelle.
 *
 * Der Vorfall wird gezählt und SOFORT GESCHLOSSEN (`db.resolveEvent`), seine
 * Wirkung bleibt aus: Gemessen wird hier die HÄUFIGKEIT bei festgehaltener
 * Reichweite. Würde der Lauf entscheiden, verschöbe `applyMusic` die Hörerzahl
 * der Künstlerzeile – und die festgehaltene Reichweite wäre keine mehr. Was ein
 * Vorfall KOSTET, misst Teil (5).
 */
async function stufenlauf(domain, reach, tage, seed) {
  const kennung = `vf_stufe_${domain}_${reach}_${seed}`;
  const G = welt(kennung);
  const U = `fx:${kennung}`;
  ausruesten(G, U);
  await home.setHome(G, U, 'de');
  let now = new Date(new Date().setHours(6, 0, 0, 0)).getTime();
  const rand = rng(seed);
  // Die Tür aufmachen – `betreten` prüft die BENUTZUNG, nicht die Größe.
  if (domain === 'music') music.setup(G, U, 'pop', music.PERSONAS[0].id);
  else {
    const p = creator.PLATFORMS[0];
    const f = creator.formats(p.id)[0];
    const r = await creator.act(G, U, p.id, f.id, now, rand);
    if (!r.ok) throw new Error(`Stufenlauf ${domain}: erste Kanalaktion abgelehnt (${r.reason})`);
  }
  if (!decisions.betreten(G, U, domain)) throw new Error(`Stufenlauf ${domain}: Tür blieb zu`);
  const merk = vf;
  vf = neuerVorfallZaehler(`stufe_${domain}_${reach}`);
  let z;
  let kandidaten = [];
  try {
    for (let d = 0; d < tage; d++) {
      const t = now + 1.6e5;
      await decisions.settle(G, U, t - 1e4);
      const neu = vorfallWurf(G, U, domain, reach, t, rand);
      if (neu) {
        db.resolveEvent(G, neu.id, {
          status: 'done', choice: '(nur gezählt)', outcome: '', effect: '', at: t + 1e3,
        });
        vf.beantwortet[domain] = (vf.beantwortet[domain] ?? 0) + 1;
      }
      now += DAY;
    }
    kandidaten = vorfallKandidaten(G, U, domain, reach, now);
  } finally {
    // Der Zähler muss weg, auch wenn ein Lauf abbricht – sonst zählt die Hülle
    // in jeden folgenden Lauf hinein.
    z = vf;
    vf = merk;
  }
  return { z, kandidaten };
}

/**
 * (3) Die Türprobe: Wer einen Bereich nicht betreten hat, würfelt dort nicht.
 *
 * Drei Spieler, ein Jahr, dieselbe Reichweite im Aufruf:
 *   „nur geschaut"  – `creator.settle` hat die Kanalzeile angelegt, 0 Aktionen.
 *   „nur Musik"     – echte Musikkarriere, nie eine Kanalaktion gesendet.
 *   „hat gesendet"  – eine echte `creator.act`.
 * Die ersten zwei MÜSSEN null Creator-Vorfälle haben, der dritte nicht.
 */
async function tuerprobe(tage) {
  const out = [];
  const faelle = [
    ['nur geschaut (creator.settle hat die Zeile angelegt, 0 Aktionen)', 'geschaut'],
    ['nur Musik (Karriere gestartet, nie eine Kanalaktion)', 'nurmusik'],
    ['hat gesendet (eine echte creator.act)', 'gesendet'],
  ];
  for (const [titel, art] of faelle) {
    const G = welt(`vf_tuer_${art}`);
    const U = `fx:vf_tuer_${art}`;
    ausruesten(G, U);
    await home.setHome(G, U, 'de');
    let now = new Date(new Date().setHours(6, 0, 0, 0)).getTime();
    const rand = rng(77);
    if (art === 'geschaut') await creator.settle(G, U, now);
    if (art === 'nurmusik') music.setup(G, U, 'pop', music.PERSONAS[0].id);
    if (art === 'gesendet') {
      const p = creator.PLATFORMS[0];
      const r = await creator.act(G, U, p.id, creator.formats(p.id)[0].id, now, rand);
      if (!r.ok) throw new Error(`Türprobe: Kanalaktion abgelehnt (${r.reason})`);
    }
    let n = 0;
    for (let d = 0; d < tage; d++) {
      const t = now + 1.6e5;
      await decisions.settle(G, U, t - 1e4);
      const neu = decisions.tick(G, U, 'creator', 100_000, t, rand);
      if (neu) {
        n++;
        db.resolveEvent(G, neu.id, { status: 'done', choice: '(nur gezählt)', outcome: '', effect: '', at: t + 1e3 });
      }
      now += DAY;
    }
    const soll = art === 'gesendet';
    out.push(`${titel}: ${n} Creator-Vorfälle in ${tage} Tagen – ` +
      `${soll ? (n > 0 ? 'erwartet > 0 ✔' : 'FEHLER – die Tür ist zu, obwohl gesendet wurde')
        : (n === 0 ? 'erwartet 0 ✔' : 'FEHLER – gewürfelt, ohne den Bereich betreten zu haben')}` +
      `  (reachTotalOf im Aufruf: 100.000, also wäre der Katalog voll)`);
  }
  return out;
}

/**
 * (4) Die Sperre: derselbe Lauf mit und ohne Bereichsfilter.
 *
 * Ein Spieler, der alle drei Bereiche bespielt: Musik (Hörer festgehalten),
 * Creator (Reichweite festgehalten) und eine Firma der Größe `groesse`. Jeden
 * Tag würfeln alle drei, dann wird jeder offene Vorfall geschlossen – ein
 * Spieler, der täglich hereinschaut, hat am Abend nichts offen.
 *
 * Der FIRMENWURF steht hier als direkter `decisions.roll(…, 'company')` mit
 * einem abgerechneten Tag – genau der Aufruf, den `company.settle` macht
 * (`src/company.js`, „Ein Vorfall je Abrechnung"). Eine echte Firma mit Lager,
 * Werbung und Entnahme braucht es dafür nicht; gemessen wird die SPERRE, nicht
 * das Geld. Alle Vorfälle werden deshalb gezählt und sofort geschlossen, ohne
 * Wirkung.
 *
 * „Ohne Filter" ist der Zustand VOR 5f: `db.openEvent` und `db.lastEventAt`
 * ohne Bereich, also eine Sperre und ein Mindestabstand für alles. Gelegt wird
 * das über eine Hülle um die zwei Abfragen – derselbe Code, nur das Argument
 * fällt weg.
 *
 * Die REIHENFOLGE der drei Würfe ist im Spiel beliebig (jeder Bereich würfelt,
 * wenn der Spieler seine Ansicht öffnet). Ohne Filter entscheidet sie darüber,
 * wer die Sperre bekommt – deshalb wird sie als eigene Variante mitgefahren.
 */
async function sperrelauf(tage, seed, { filter, reihenfolge, beantworten, hoerer, reichweite, groesse, npc }) {
  const kennung = `vf_sperre_${filter ? 'an' : 'aus'}_${reihenfolge}_${beantworten}_${seed}`;
  const G = welt(kennung);
  const U = `fx:${kennung}`;
  ausruesten(G, U);
  await home.setHome(G, U, 'de');
  let now = new Date(new Date().setHours(6, 0, 0, 0)).getTime();
  music.setup(G, U, 'pop', music.PERSONAS[0].id);
  const p = creator.PLATFORMS[0];
  const erst = await creator.act(G, U, p.id, creator.formats(p.id)[0].id, now, rng(seed + 7));
  if (!erst.ok) throw new Error(`Sperrelauf: erste Kanalaktion abgelehnt (${erst.reason})`);
  // Je Bereich ein eigener Würfel: Ohne Filter würfelt ein gesperrter Bereich
  // gar nicht, und ein gemeinsamer Strom wäre danach verschoben – die Differenz
  // wäre dann zur Hälfte ein anderer Würfel.
  const randM = rng(seed);
  const randC = rng(seed + 10_000);
  const randF = rng(seed + 20_000);
  const echtOpen = db.openEvent;
  const echtLast = db.lastEventAt;
  if (!filter) {
    db.openEvent = (g, u) => echtOpen(g, u);
    db.lastEventAt = (g, u) => echtLast(g, u);
  }
  const merk = vf;
  vf = neuerVorfallZaehler(`sperre_${filter ? 'an' : 'aus'}_${reihenfolge}_${beantworten}`);
  let z;
  try {
    for (let d = 0; d < tage; d++) {
      const t = now + 1.6e5;
      /*
       * Morgens wird geschlossen, was abgelaufen ist – OHNE Wirkung und NICHT
       * über `decisions.settle`: Das würde den Ignorier-Aufschlag buchen und die
       * festgehaltene Reichweite verschieben. Hier wird die SPERRE gemessen,
       * nicht das Geld.
       *
       * Das ist der Unterschied zwischen den zwei Spielweisen dieses Teils: Wer
       * `beantworten: 'sofort'` spielt, hat abends nichts offen; wer „nie"
       * spielt, lässt jeden Vorfall die vollen DECIDE_MS stehen.
       *
       * Die Uhr des Tages, von Hand nachgerechnet: Schnitt bei `t − 2e4`, die
       * drei Würfe bei `t`, `t + 1e3`, `t + 2e3`, Abendschluss bei `t + 1e4`.
       * Ein Vorfall von Tag d läuft bei `t_d + DAY` ab, also GENAU zum Wurf von
       * Tag d+1 – der Schnitt um 20 Sekunden davor erwischt ihn nicht, der Wurf
       * ist gesperrt, und am Tag darauf wird er vor dem Wurf geschlossen. Wer
       * nie beantwortet, verliert damit genau einen folgenden Wurf je Vorfall;
       * DECIDE_MS sind 24 h, also genau ein Tag.
       */
      for (const row of db.overdueEvents(G, U, t - 2e4)) {
        db.resolveEvent(G, row.id, {
          status: 'expired', choice: '', outcome: '', effect: '', at: t - 2e4,
        });
        vf.verfallenZahl = (vf.verfallenZahl ?? 0) + 1;
      }
      const musikWurf = () => vorfallWurf(G, U, 'music', hoerer, t, randM);
      const kanalWurf = () => vorfallWurf(G, U, 'creator', reichweite, t + 1e3, randC);
      const firmaWurf = () => {
        const neu = decisions.roll(G, U, { groesse, days: 1, npc, companyId: 0 },
          t + 2e3, randF, 'company');
        if (neu) {
          vf.vorfaelle.company = (vf.vorfaelle.company ?? 0) + 1;
          vf.arten[neu.kind] = (vf.arten[neu.kind] ?? 0) + 1;
        }
        vf.tage.company = (vf.tage.company ?? 0) + 1;
        return neu;
      };
      const reihe = reihenfolge === 'firma-zuerst'
        ? [firmaWurf, musikWurf, kanalWurf] : [musikWurf, kanalWurf, firmaWurf];
      for (const w of reihe) w();
      // Abends ist nichts mehr offen – wie ein Spieler, der täglich hereinschaut.
      for (const bereich of (beantworten === 'sofort' ? ['music', 'creator', 'company'] : [])) {
        const offen = db.openEvent(G, U, bereich);
        if (!offen) continue;
        db.resolveEvent(G, offen.id, {
          status: 'done', choice: '(nur gezählt)', outcome: '', effect: '', at: t + 1e4,
        });
        vf.beantwortet[bereich] = (vf.beantwortet[bereich] ?? 0) + 1;
      }
      now += DAY;
    }
  } finally {
    db.openEvent = echtOpen;
    db.lastEventAt = echtLast;
    z = vf;
    vf = merk;
  }
  return z;
}

/**
 * (5) Eine Variante des Karriere-Laufs – gebaut wie `angebotvariante`: dieselbe
 * Säung, dieselbe Strategie, nur die Spielweise wechselt.
 */
async function vorfallvariante(kennungBasis, musik, strat, laeufe, tage, variante) {
  kz = neuerZaehler();
  vf = neuerVorfallZaehler(variante);
  const geld = [];
  const hoerer = [];
  const follower = [];
  const summe = {};
  let zaehler;
  let vorfallZaehler;
  try {
    for (let i = 0; i < laeufe; i++) {
      const kennung = `${kennungBasis}_${i}`;
      const G = welt(kennung);
      const U = `fx:${kennung}`;
      /*
       * Der Zeitpunkt des letzten Vorfalls gehört zum LAUF, nicht zur Variante:
       * Jeder Lauf beginnt wieder heute 6:00, und ohne diesen Schnitt wäre der
       * „Abstand" zwischen dem letzten Vorfall von Lauf i und dem ersten von
       * Lauf i+1 eine erfundene Zahl – womöglich eine negative. Alles andere
       * wird über alle Läufe aufsummiert.
       */
      vf.letzter = {};
      const r = await karriere(G, U, { musik, strat }, tage, 1000 + i);
      /*
       * Die Zeilen der Tabelle, bevor der nächste Lauf eine eigene Welt
       * aufmacht. `eventHistory` liefert die entschiedenen und verfallenen,
       * `openEvent` die eine, die noch offen stehen kann – zusammen jede Zeile,
       * die dieser Lauf angelegt hat, gezählt an der Datenbank und nicht an
       * einem Zähler dieses Skripts.
       */
      vf.zeilen += db.eventHistory(G, U, 1e9).length + (db.openEvent(G, U) ? 1 : 0);
      geld.push(r.geld);
      hoerer.push(r.hoerer);
      follower.push(r.follower);
      for (const [k, v] of Object.entries(r.quellen)) summe[k] = (summe[k] ?? 0) + v;
    }
  } finally {
    zaehler = kz; kz = null;
    vorfallZaehler = vf; vf = null;
  }
  return {
    geld, zaehler, vorfallZaehler,
    median: median(geld), q25: quantil(geld, 0.25), q75: quantil(geld, 0.75),
    hoerer: median(hoerer), follower: median(follower),
    quellen: Object.fromEntries(Object.entries(summe)
      .map(([k, v]) => [k, v / Math.max(1, laeufe)]).sort((a, b) => b[1] - a[1])),
  };
}

/** Die Zählerzeilen einer Vorfall-Variante – roh, ohne Rundung auf schöne Zahlen. */
function vorfallZeilen(z, tage, laeufe) {
  const out = [];
  const n = tage * laeufe;
  const summe = (o) => Object.values(o).reduce((a, b) => a + b, 0);
  const liste = (o) => Object.entries(o).sort((a, b) => b[1] - a[1])
    .map(([k, v]) => `${k} ${de(v)}`).join(', ') || 'keine';
  const f = (a, k = 1) => (a.length
    ? `Ø ${komma(mittel(a), k)} (kleinster ${komma(Math.min(...a), k)}, größter ${komma(Math.max(...a), k)})`
    : 'keiner');
  const v = summe(z.vorfaelle);
  out.push(`Vorfälle ${de(v)} in ${de(n)} Tagen = ${komma(v / Math.max(1, laeufe), 2)} je Lauf ` +
    `(${komma((v / n) * 365, 2)} je Jahr): ${liste(z.vorfaelle)}`);
  out.push(`Arten: ${liste(z.arten)}`);
  out.push(`frühe Vorfälle (Schwelle 0, Deckel ${de(decisions.FRUEH_MAX)}): ${de(summe(z.frueh))} ` +
    `(${v ? komma((summe(z.frueh) / v) * 100, 1) : '0,0'} % aller Vorfälle): ${liste(z.frueh)} · ` +
    `Reichweite beim Ziehen ${f(z.fruehReach, 0)} · die übrigen ${f(z.spaetReach, 0)}`);
  /*
   * Und die Zahl, um die es beim §3-Treiber geht: Wie viele Vorfälle unter 5.000
   * gezogen wurden. Vor Stück 5f war der Musikkatalog dort LEER (der kleinste
   * Mindestwert war 5.000), der Wurf fiel ins Leere, und die Uhr war trotzdem
   * geschrieben. Genau diese Würfe sind der Gewinn der vier frühen Vorfälle –
   * gezählt, nicht aus einem Mittelwert geschätzt.
   */
  const unter = z.fruehReach.filter((r) => r < 5000).length;
  out.push(`davon unter 5.000 (dort war der Musikkatalog vor 5f LEER): ${de(unter)} = ` +
    `${komma((unter / n) * 365, 2)} je Jahr · bei 5.000 bis ${de(decisions.FRUEH_MAX)}: ` +
    `${de(z.fruehReach.length - unter)} = ${komma(((z.fruehReach.length - unter) / n) * 365, 2)} je Jahr`);
  out.push(`Tageswürfe: gerufen ${liste(z.tage)} · wirklich gewürfelt ${liste(z.wuerfe)} · ` +
    `kein Wurf ${liste(z.keinWurf)} (davon Tür zu ${liste(z.tuerZu)}, ` +
    `offener Vorfall desselben Bereichs ${liste(z.offenBlockt)})`);
  out.push(`nachgeholte Tage je Wurf (Deckel ${decisions.ROLL_TAGE_MAX}): ${f(z.nachgeholt, 2)}`);
  out.push(`Würfel kam durch ${liste(z.durch)} · davon ohne Vorfall: ${liste(z.leer)} ` +
    `(abstand = MIN_GAP_MS, keinKandidat = leere Liste, unerklaert MUSS 0 sein)`);
  out.push(`beantwortet ${liste(z.beantwortet)} · abgelehnte choose-Aufrufe ${z.fehler.length}` +
    `${z.fehler.length ? ` – FEHLER: ${z.fehler.slice(0, 3).join(' | ')}` : ' ✔'}`);
  out.push(`Abstand zweier Vorfälle desselben Bereichs: ${f(z.abstaende, 1)} Stunden · ` +
    `unter ${decisions.MIN_GAP_MS / 3600e3} h: ${z.zuDicht} ` +
    `${z.zuDicht === 0 ? '✔' : 'FEHLER – MIN_GAP_MS gerissen'}`);
  return out;
}

async function vorfaellelauf(laeufe, tage) {
  /*
   * Die Teile (2) bis (4) würfeln nur und spielen nicht – ein Jahr kostet dort
   * Millisekunden, nicht Minuten. Deshalb 100 Seeds statt 10: Bei 10 Seeds ist
   * der Standardfehler des Mittels am unteren Ende ±0,85 Vorfälle, und eine
   * Abweichung von der Spec-Tabelle wäre nicht von Rauschen zu trennen. Mit 100
   * sind es ±0,27 – dann ist eine Abweichung ein Befund.
   */
  const STUFEN_SEEDS = 100;
  console.log('  (1) HANDPRÜFUNG – gerechnet, nicht simuliert:');
  for (const l of vorfallHandprobe()) console.log(`    ${l}`);
  console.log();

  console.log(`  (2) VORFÄLLE JE JAHR NACH REICHWEITE – Reichweite FESTGEHALTEN, ` +
    `${STUFEN_SEEDS} Seeds à 365 Tage je Stufe, Würfel rng(seed), Start heute 6:00 vorwärts.`);
  console.log('      Das ist die Zahl neben der Spec-Tabelle: „wer ein Jahr lang X hat", NICHT ' +
    '„wer im Lauf des Jahres bei X ankommt".');
  const stufen = { music: [], creator: [] };
  for (const domain of ['music', 'creator']) {
    const liste = domain === 'music' ? VORFALL_STUFEN : [0, 2_000, 100_000, 1_500_000];
    for (const reach of liste) {
      const zs = [];
      let kandidaten = [];
      for (let s = 1; s <= STUFEN_SEEDS; s++) {
        const r = await stufenlauf(domain, reach, 365, 4000 + s);
        zs.push(r.z);
        kandidaten = r.kandidaten;
      }
      const je = zs.map((z) => (z.vorfaelle[domain] ?? 0));
      const frueh = zs.map((z) => (z.frueh[domain] ?? 0));
      const pTag = decisions.riskPerDay(reach);
      const erwartet = 365 * pTag;
      /*
       * Die Erwartung MIT Sperre, von Hand hergeleitet und nicht geschätzt:
       * Jeder Vorfall sperrt den Wurf des FOLGENDEN Tages (36 h Mindestabstand,
       * ein Wurf je Tag – 24 h sind weniger als 36). Von 365 Würfen gehen also
       * `I` ins Leere, wenn `I` Vorfälle fallen:
       *     I = p × (365 − I)  ⟹  I = 365 × p / (1 + p)
       * Das ist die Zahl, gegen die der Stufenlauf verglichen werden MUSS; die
       * Spec-Tabelle (365 × p) ist die Obergrenze ohne Sperre.
       */
      const erwartetMitSperre = (365 * pTag) / (1 + pTag);
      const sd = Math.sqrt(mittel(je.map((x) => (x - mittel(je)) ** 2)));
      const se = sd / Math.sqrt(je.length);
      const abst = zs.flatMap((z) => z.abstaende);
      const eintrag = {
        domain, reach, je, erwartet, erwartetMitSperre, pTag, se,
        mittel: mittel(je), median: median(je),
        frueh: mittel(frueh),
        kandidaten: kandidaten.map((d) => d.id),
        durch: zs.reduce((s, z) => s + (z.durch[domain] ?? 0), 0),
        wuerfe: zs.reduce((s, z) => s + (z.wuerfe[domain] ?? 0), 0),
        keinWurf: zs.reduce((s, z) => s + (z.keinWurf[domain] ?? 0), 0),
        leerAbstand: zs.reduce((s, z) => s + (z.leer.abstand ?? 0), 0),
        leerKein: zs.reduce((s, z) => s + (z.leer.keinKandidat ?? 0), 0),
        leerUnerklaert: zs.reduce((s, z) => s + (z.leer.unerklaert ?? 0), 0),
        zuDicht: zs.reduce((s, z) => s + z.zuDicht, 0),
        minAbstand: abst.length ? Math.min(...abst) : null,
        arten: zs.reduce((o, z) => {
          for (const [k, x] of Object.entries(z.arten)) o[k] = (o[k] ?? 0) + x;
          return o;
        }, {}),
      };
      stufen[domain].push(eintrag);
      console.log(`    ${domain === 'music' ? 'Musik  ' : 'Creator'} ${de(reach).padStart(9)}: ` +
        `Ø ${komma(eintrag.mittel, 2).padStart(5)} ± ${komma(se, 2)} Vorfälle/Jahr ` +
        `(Median ${komma(eintrag.median, 1)}, Spanne ${Math.min(...je)} … ${Math.max(...je)}) · ` +
        `erwartet MIT Sperre 365p/(1+p) = ${komma(erwartetMitSperre, 2)} ` +
        `(${komma((eintrag.mittel / erwartetMitSperre) * 100, 1)} % davon, Abweichung ` +
        `${komma((eintrag.mittel - erwartetMitSperre) / Math.max(1e-9, se), 1)} σ) · ` +
        `Spec-Tabelle 365 × p = ${komma(erwartet, 1)} · ` +
        `davon früh Ø ${komma(eintrag.frueh, 2)} · Kandidaten ${eintrag.kandidaten.length} ` +
        `(${eintrag.kandidaten.join(', ') || 'KEINE'})`);
      /*
       * Gegenprobe der Sperre, ohne zweite Annahme: Jeder Vorfall sperrt genau
       * den folgenden Wurf, also MUSS die Zahl der leeren Würfe „Abstand"
       * p × Vorfälle sein. Stimmt das nicht, ist die Herleitung oben falsch.
       */
      const vorfaelleGesamt = je.reduce((a, b) => a + b, 0);
      console.log(`                        Würfe ${de(eintrag.wuerfe)} (kein Wurf ` +
        `${de(eintrag.keinWurf)}), Würfel kam durch ${de(eintrag.durch)}, davon ohne Vorfall: ` +
        `Abstand ${de(eintrag.leerAbstand)} (erwartet p × Vorfälle = ` +
        `${komma(pTag * vorfaelleGesamt, 1)}), kein Kandidat ${de(eintrag.leerKein)}, ` +
        `unerklärt ${de(eintrag.leerUnerklaert)} ${eintrag.leerUnerklaert === 0 ? '✔' : 'FEHLER'} · ` +
        `kleinster Abstand ${eintrag.minAbstand === null ? '–' : `${komma(eintrag.minAbstand, 1)} h`}, ` +
        `unter 36 h ${eintrag.zuDicht} ${eintrag.zuDicht === 0 ? '✔' : 'FEHLER'}`);
      console.log(`                        Arten: ${Object.entries(eintrag.arten)
        .sort((a, b) => b[1] - a[1]).map(([k, x]) => `${k} ${x}`).join(', ') || 'keine'}`);
    }
  }
  /*
   * Die KONTROLLZEILE dieses Teils: Der Verlust gegen 365 × p muss sich aus
   * den gezählten Gründen ergeben – Abstand und leere Kandidatenliste. Bleibt
   * ein Rest, ist die Zählung falsch und nicht die Rate.
   */
  const kontrolleStufe = stufen.music.concat(stufen.creator)
    .filter((e) => e.leerUnerklaert > 0 || e.zuDicht > 0);
  console.log(`    KONTROLLE Stufenlauf: ${kontrolleStufe.length === 0
    ? 'jeder durchgekommene Wurf ohne Vorfall hat seinen Grund (Abstand oder leere Liste), ' +
      'und MIN_GAP_MS ist in keiner Stufe gerissen ✔'
    : `FEHLER in ${kontrolleStufe.length} Stufen: ${kontrolleStufe
      .map((e) => `${e.domain}/${de(e.reach)}`).join(', ')}`}`);
  console.log(`    KONTROLLE „keine stille Null": ${stufen.music.concat(stufen.creator)
    .every((e) => e.mittel > 0) ? 'jede Stufe hat Vorfälle ✔'
    : `FEHLER – Stufen ohne jeden Vorfall: ${stufen.music.concat(stufen.creator)
      .filter((e) => e.mittel === 0).map((e) => `${e.domain}/${de(e.reach)}`).join(', ')}`}`);
  console.log();

  console.log('  (3) DIE TÜR – wer den Bereich nicht betreten hat, würfelt dort nicht (365 Tage je Fall):');
  for (const l of await tuerprobe(365)) console.log(`    ${l}`);
  console.log();

  console.log(`  (4) DIE SPERRE JE BEREICH – ein Spieler mit Musik (100.000 Hörer), Kanälen ` +
    `(100.000 Reichweite) und einer Firma der Größe 5 mit 3 NPCs, ${STUFEN_SEEDS} Seeds à 365 Tage.`);
  console.log('      Zwei Spielweisen: „sofort" beantwortet jeden Vorfall am Tag seines Auftretens, ' +
    '„nie" lässt jeden die vollen 24 h stehen – der Gelegenheitsspieler, um den es geht.');
  const sperre = {};
  for (const filter of [true, false]) {
    for (const beantworten of ['sofort', 'nie']) {
      for (const reihenfolge of ['firma-zuerst', 'musik-zuerst']) {
        const zs = [];
        for (let s = 1; s <= STUFEN_SEEDS; s++) {
          zs.push(await sperrelauf(365, 5000 + s, {
            filter, reihenfolge, beantworten,
            hoerer: 100_000, reichweite: 100_000, groesse: 5, npc: 3,
          }));
        }
        const je = (bereich) => zs.map((z) => (z.vorfaelle[bereich] ?? 0));
        sperre[`${filter ? 'an' : 'aus'}/${beantworten}/${reihenfolge}`] = {
          music: mittel(je('music')), creator: mittel(je('creator')), company: mittel(je('company')),
          gesamt: mittel(zs.map((z) => Object.values(z.vorfaelle).reduce((a, b) => a + b, 0))),
          zuDicht: zs.reduce((s, z) => s + z.zuDicht, 0),
          keinWurf: zs.reduce((s, z) => s + (z.keinWurf.music ?? 0), 0),
          offenBlockt: zs.reduce((s, z) => s + (z.offenBlockt.music ?? 0), 0),
          verfallen: zs.reduce((s, z) => s + (z.verfallenZahl ?? 0), 0),
        };
      }
    }
  }
  const namen = [];
  for (const filter of ['an', 'aus']) {
    for (const beantworten of ['sofort', 'nie']) {
      for (const reihenfolge of ['firma-zuerst', 'musik-zuerst']) {
        namen.push(`${filter}/${beantworten}/${reihenfolge}`);
      }
    }
  }
  for (const name of namen) {
    const r = sperre[name];
    console.log(`    Filter ${name.padEnd(26)} Musik Ø ${komma(r.music, 2).padStart(5)} · Creator Ø ` +
      `${komma(r.creator, 2).padStart(5)} · Firma Ø ${komma(r.company, 2).padStart(5)} · ` +
      `zusammen Ø ${komma(r.gesamt, 2).padStart(5)} je Jahr · Musik-Tage ohne Wurf ` +
      `${de(r.keinWurf)} (davon offener Vorfall ${de(r.offenBlockt)}) · verfallen ${de(r.verfallen)} · ` +
      `MIN_GAP gerissen ${r.zuDicht}`);
  }
  /*
   * Was die Trennung bringt – JE REIHENFOLGE und dann als SPANNE.
   *
   * Mit Filter ist die Reihenfolge gleichgültig (Kontrollzeile darunter), ohne
   * Filter entscheidet sie darüber, WER die Sperre bekommt. Eine einzelne
   * Reihenfolge als „das Ergebnis" zu melden, wäre die Wahl einer beliebigen
   * Annahme: Für die Musik stehen dann +14,4 % oder +8,1 % da, aus demselben
   * Lauf. Deshalb druckt dieser Abschnitt beide Zeilen UND die Spanne, und die
   * Spanne ist die Zahl, die in Bericht und §15 gehört.
   */
  for (const beantworten of ['sofort', 'nie']) {
    const an = sperre[`an/${beantworten}/firma-zuerst`];
    const q = (a, b) => prozent(a / Math.max(1e-9, b) - 1);
    for (const reihenfolge of ['firma-zuerst', 'musik-zuerst']) {
      const aus = sperre[`aus/${beantworten}/${reihenfolge}`];
      console.log(`    Was die Trennung der Sperre bringt („${beantworten}", ` +
        `${reihenfolge === 'firma-zuerst' ? 'Firma zuerst' : 'Musik zuerst'}): ` +
        `MUSIK ${komma(an.music, 2)} gegen ${komma(aus.music, 2)} = ${q(an.music, aus.music)} · ` +
        `CREATOR ${komma(an.creator, 2)} gegen ${komma(aus.creator, 2)} = ${q(an.creator, aus.creator)} · ` +
        `FIRMA ${komma(an.company, 2)} gegen ${komma(aus.company, 2)} = ${q(an.company, aus.company)} · ` +
        `zusammen ${komma(an.gesamt, 2)} gegen ${komma(aus.gesamt, 2)} = ${q(an.gesamt, aus.gesamt)}`);
    }
    const spanne = (feld) => {
      const w = ['firma-zuerst', 'musik-zuerst']
        .map((r) => an[feld] / Math.max(1e-9, sperre[`aus/${beantworten}/${r}`][feld]) - 1);
      return `${prozent(Math.min(...w))} … ${prozent(Math.max(...w))}`;
    };
    console.log(`    DIE SPANNE über die Würfelreihenfolge („${beantworten}") – das ist die Zahl, ` +
      `die der Bericht nennt: MUSIK ${spanne('music')} · CREATOR ${spanne('creator')} · ` +
      `FIRMA ${spanne('company')} · zusammen ${spanne('gesamt')}`);
  }
  /*
   * Die Gegenprobe zur Spanne: Sie darf nur UMVERTEILEN. Bewegt sich die Summe
   * ohne Filter zwischen den zwei Reihenfolgen um mehr als eine Zehntelstelle,
   * dann ändert die Reihenfolge nicht nur, WER die Vorfälle bekommt, sondern
   * WIE VIELE es gibt – und dann trägt der ganze Absatz nicht mehr.
   */
  const summen = ['firma-zuerst', 'musik-zuerst'].map((r) => sperre[`aus/sofort/${r}`].gesamt);
  console.log(`    KONTROLLE Spanne: die Reihenfolge verteilt nur um – Summe ohne Filter ` +
    `${komma(summen[0], 2)} gegen ${komma(summen[1], 2)} ` +
    `(${prozent(summen[1] / summen[0] - 1)}) ${Math.abs(summen[1] / summen[0] - 1) < 0.02
      ? '✔' : 'FEHLER – die Reihenfolge ändert die Gesamtzahl, nicht nur die Verteilung'}`);
  const gleich = ['sofort', 'nie'].every((b) => Math.abs(sperre[`an/${b}/firma-zuerst`].music
    - sperre[`an/${b}/musik-zuerst`].music) < 1e-9);
  console.log(`    KONTROLLE Reihenfolge: Mit Filter darf sie nichts ändern – ` +
    `${gleich ? 'Musik auf die Stelle identisch in beiden Spielweisen ✔'
      : 'FEHLER, die Bereiche sehen sich also doch'}; ohne Filter ändert sie etwas ` +
    `(Musik ${komma(sperre['aus/nie/firma-zuerst'].music, 2)} gegen ` +
    `${komma(sperre['aus/nie/musik-zuerst'].music, 2)}) – genau das ist der Befund.`);
  console.log(`    KONTROLLE MIN_GAP: ${namen.filter((n) => n.startsWith('an/'))
    .every((n) => sperre[n].zuDicht === 0)
    ? 'mit Filter kein Verstoß innerhalb eines Bereichs in allen vier Läufen ✔' : 'FEHLER'}`);
  console.log(`    KONTROLLE „nie": verfallene Vorfälle müssen > 0 sein, „sofort" muss 0 haben – ` +
    `sofort ${de(sperre['an/sofort/firma-zuerst'].verfallen)}, nie ` +
    `${de(sperre['an/nie/firma-zuerst'].verfallen)} ` +
    `${sperre['an/sofort/firma-zuerst'].verfallen === 0
      && sperre['an/nie/firma-zuerst'].verfallen > 0 ? '✔' : 'FEHLER'}`);
  console.log();

  console.log(`  (5) DER KARRIERE-LAUF – ${laeufe} Läufe à ${tage} Tage, Varianten „aus" (keine ` +
    `Vorfälle) und „an" (Tageswurf in Musik UND Kanälen), gepaart je Seed.`);
  const paare = [
    { titel: 'Musik+Creator', musik: true, kennung: 'vf_beides' },
    { titel: 'nur Musik', musik: true, kennung: 'vf_musik', kanaele: false },
  ];
  const ergebnis = {};
  for (const a of paare) {
    const alle = a.kanaele === false
      ? strategien(true).filter((s) => s.name.startsWith('Ertrag je Zeit +0B'))
        .map((s) => ({ ...s, kanaele: false }))
      : strategien(a.musik);
    let strat;
    if (STRATEGIE && alle.some((s) => s.name === STRATEGIE)) {
      strat = alle.find((s) => s.name === STRATEGIE);
    } else {
      const such = await durchlauf(`${a.kennung}_suche`, a.musik, Math.max(2, Math.min(3, laeufe)),
        Math.min(tage, 180), alle, true);
      strat = alle.find((s) => s.name === such.strategie);
    }
    console.log(`    ${a.titel}: Strategie "${strat.name}" (Suche ohne Vorfälle), ${laeufe} Läufe à ` +
      `${tage} Tage, Würfel rng(1000+i), Vorfallswürfe rng(1101000+i) – ein EIGENER Strom, damit ` +
      `„aus" und „an" denselben Musik- und Kanallauf haben`);
    const v = {};
    for (const name of ['aus', 'an']) {
      v[name] = await vorfallvariante(`${a.kennung}_${name}`, a.musik,
        { ...strat, vorfaelle: name === 'an' }, laeufe, tage, name);
    }
    ergebnis[a.titel] = v;
    const zeile = (was, r) => `    ${was.padEnd(24)}${de(r.median / tage).padStart(10)}/Tag   ` +
      `[${de(r.q25 / tage)} … ${de(r.q75 / tage)}]   ${de(r.follower)} Follower` +
      (r.hoerer ? `, ${de(r.hoerer)} Hörer` : '');
    const paarweise = (r, b) => r.geld.map((g, i) => g / Math.max(1, b.geld[i]));
    console.log(zeile('aus (die Grundlage)', v.aus));
    console.log(zeile('an', v.an));
    const p = paarweise(v.an, v.aus);
    const rauf = p.filter((x) => x > 1).length;
    console.log(`      gegen „aus": Mediane ${prozent(v.an.median / Math.max(1, v.aus.median) - 1)} · ` +
      `je Seed (gepaart) Median ${prozent(median(p) - 1)}, ` +
      `Spanne ${prozent(Math.min(...p) - 1)} … ${prozent(Math.max(...p) - 1)}, ` +
      `${rauf} von ${p.length} Seeds im Plus`);
    console.log(`      je Seed: ${p.map((x) => prozent(x - 1)).join(' · ')}`);
    const quellenzeile = (was, r) => `      Quellen ${was.padEnd(6)}` + (Object.entries(r.quellen)
      .filter(([, x]) => Math.abs(x) > 1)
      .map(([k, x]) => `${k} ${de(x / tage)}/Tag (${Math.round((x / Math.max(1, r.median)) * 100)} %)`)
      .join(' · ') || 'keine');
    for (const name of ['aus', 'an']) console.log(quellenzeile(`${name}:`, v[name]));
    const vorfallGeld = (r) => (r.quellen.Vorfall ?? 0);
    console.log(`      Der Posten „Vorfall" allein: aus ${de(vorfallGeld(v.aus))} je Lauf, an ` +
      `${de(vorfallGeld(v.an))} je Lauf (${de(vorfallGeld(v.an) / tage)}/Tag) – ` +
      `${vorfallGeld(v.an) < 0 ? 'ein Minusposten' : 'ein Plusposten'}`);
    const l = (r) => leistung(r.zaehler, tage, laeufe);
    console.log(`      Tagesleistung Ø/Tag (Kanalaktionen · Veröffentlichungen · Konzerte): ` +
      ['aus', 'an'].map((name) => {
        const x = l(v[name]);
        return `${name} ${komma(x.akte)} · ${komma(x.publishes)} · ${komma(x.shows)}`;
      }).join(' → '));
    for (const name of ['aus', 'an']) {
      console.log(`    ${name}:`);
      for (const z of vorfallZeilen(v[name].vorfallZaehler, tage, laeufe)) console.log(`      ${z}`);
    }
    /*
     * Die Kontrollzeilen. „aus" MUSS leer sein – nicht nur ohne Vorfälle,
     * sondern ohne jeden Wurf: Der Tageswurf ist die EINZIGE Quelle, seit die
     * Würfe je Aktion weg sind. Und „an" darf nicht leer sein, sonst misst der
     * Lauf eine stille Null und nennt sie Ergebnis.
     *
     * EHRLICH ZU DEN BEINEN DIESER KONTROLLE: `vorfaelle` und `wuerfe` kommen
     * beide aus `vorfallWurf`, und die Variante „aus" ruft `vorfallWurf` gar
     * nicht – diese zwei Beine sind dort null, WEIL SIE NIEMAND FÜLLT, und
     * können einen überlebenden Wurf an einer anderen Stelle nicht finden. Das
     * können nur die zwei Beine, die nicht an dieser Instrumentierung hängen:
     * die Zeilen in `creator_events` (am Ende jedes Laufs direkt aus der
     * Tabelle gezählt) und der Kontoposten „Vorfall". Deshalb stehen alle vier
     * in der Zeile, und jedes sagt dazu, woher es kommt.
     */
    const sum = (o) => Object.values(o).reduce((x, y) => x + y, 0);
    const za = v.aus.vorfallZaehler;
    const zn = v.an.vorfallZaehler;
    console.log(`      KONTROLLE „aus": Vorfälle ${sum(za.vorfaelle)}, Würfe ${sum(za.wuerfe)} ` +
      `(beide aus dieser Instrumentierung, also nur so gut wie sie) · Zeilen in creator_events ` +
      `${za.zeilen}, Posten „Vorfall" ${de(vorfallGeld(v.aus))} (beide UNABHÄNGIG davon – nur diese ` +
      `zwei finden einen Wurf, der an einer ungezählten Stelle überlebt hätte) – ` +
      `${sum(za.vorfaelle) === 0 && sum(za.wuerfe) === 0 && za.zeilen === 0
        && vorfallGeld(v.aus) === 0
        ? 'alles null ✔ (keine Würfe je Aktion mehr, kein Tageswurf – die Grundlage ist wirklich leer)'
        : 'FEHLER – „aus" hat Vorfälle, Würfe oder Zeilen'}`);
    console.log(`      KONTROLLE „an": Vorfälle ${sum(zn.vorfaelle)} ` +
      `(${komma(sum(zn.vorfaelle) / Math.max(1, laeufe), 2)} je Lauf), Würfe ${sum(zn.wuerfe)}, ` +
      `Zeilen in creator_events ${zn.zeilen}, Posten „Vorfall" ${de(vorfallGeld(v.an))} – ` +
      `${sum(zn.vorfaelle) > 0 && sum(zn.wuerfe) > 0 && zn.zeilen > 0
        ? 'nicht null ✔' : 'FEHLER – stille Null'}` +
      `${zn.zeilen === sum(zn.vorfaelle) ? ' · Zeilen und gezählte Vorfälle stimmen überein ✔'
        : ` · ACHTUNG: ${zn.zeilen} Zeilen gegen ${sum(zn.vorfaelle)} gezählte Vorfälle`}`);
    console.log(`      KONTROLLE Bereiche in „an": ${a.kanaele === false
      ? `der reine Musiker hat ${zn.vorfaelle.creator ?? 0} Creator-Vorfälle – ` +
        `${(zn.vorfaelle.creator ?? 0) === 0 ? 'erwartet 0 ✔ (nie eine Kanalaktion, die Tür bleibt zu)'
          : 'FEHLER – gewürfelt, ohne den Bereich betreten zu haben'}`
      : `Musik ${zn.vorfaelle.music ?? 0}, Creator ${zn.vorfaelle.creator ?? 0} – ` +
        `${(zn.vorfaelle.music ?? 0) > 0 && (zn.vorfaelle.creator ?? 0) > 0
          ? 'beide Bereiche feuern ✔' : 'FEHLER – ein Bereich bleibt stumm'}`}`);
    const gepaart = median(p) - 1;
    const mediane = v.an.median / Math.max(1, v.aus.median) - 1;
    const schlimmer = Math.abs(gepaart) > Math.abs(mediane) ? gepaart : mediane;
    console.log(`      AUSLÖSER „±25 % gepaart" für ${a.titel}: Mediane ${prozent(mediane)}, ` +
      `gepaart ${prozent(gepaart)} → ${Math.abs(schlimmer) > 0.25
        ? `ERREICHT (${schlimmer > 0 ? 'nach oben' : 'nach unten'}), RISK_MAX_DAY senken und neu messen`
        : 'nicht erreicht'}`);
    console.log();
  }
  return { stufen, sperre, ergebnis };
}

/** Für Prüf- und Kontrollläufe importierbar (test/…, Handprüfung): nur als Hauptprogramm messen. */
module.exports = { firmenlauf, handelslauf, karriere, kanaltag, strategien, welt, angebotDecken, main };

async function main() {
  if (process.argv[2] === 'verlauf') {
    await verlauf(Number(process.argv[3] || 3), Number(process.argv[4] || 1500));
    return;
  }
  const LAEUFE = Number(process.argv[2] || 30);
  const TAGE = Number(process.argv[3] || 730);

  if (process.argv[2] === 'stufenprobe') {
    console.log(`\n--- Gegenprobe: erwarteter Stufenfaktor gegen gewürfelte \`stufeVon\` ---\n`);
    const probe = stufenprobe(Number(process.argv[3] || 1_000_000));
    for (const l of probe.zeilen) console.log(l);
    console.log();
    // Als Wächter in `npm test`: Weicht ein Fall ab, bricht der Lauf ab. Der
    // Nachbau `stufenVerteilung` ist die einzige Stelle des Projekts, die eine
    // Formel aus src/ abschreibt – und keine Testdatei prüft sie.
    if (!probe.allesGut) process.exitCode = 1;
    return;
  }

  if (NUR === 'kontakte') {
    console.log(`\n--- Kontakte (Stück 5a: mit und ohne Kontaktpflege, ${LAEUFE} Läufe à ${TAGE} Tage) ---\n`);
    console.log('  Gegenprobe zur Wahl des Spielers: erwarteter Stufenfaktor gegen gewürfelte `stufeVon`');
    for (const l of stufenprobe(200_000).zeilen) console.log(l);
    console.log();
    console.log('  Passung (mit contacts.passungOf / chanceOf / staerkeOf / boostOf gerechnet):');
    for (const l of passungsblock()) console.log(l);
    console.log();
    await kontaktlauf(LAEUFE, TAGE);
    return;
  }

  if (NUR === 'beef') {
    console.log(`\n--- Beef (Stück 5b/5c: ohne Beef · passiv · Beef-Spielweise · ohne Beef mit Album · ` +
      `diss-isoliert · sieg-farm – ${LAEUFE} Läufe à ${TAGE} Tage) ---\n`);
    // Alle Zahlen, an denen das Balancing hängt, stehen in der Kopfzeile jedes
    // Laufs – damit in der Rohausgabe zu sehen ist, welche Einstellung sie
    // gemessen hat, und nicht nur in der Kommandozeile darüber.
    const gesetzt = (arg) => (arg === null ? '' : '*');
    console.log(`  DISS_AUFMERK ${komma(beefData.DISS_AUFMERK, 2)}` +
      `${DISS_AUFMERK_ARG ? ' (über --diss-aufmerk gesetzt)' : ' (Standard aus src/data/beef.js)'}` +
      `, HAEME_AUDIENCE ${komma(beefData.HAEME_AUDIENCE)}, BONUS_SIEG ${komma(beefData.BONUS_SIEG)}` +
      `${gesetzt(BONUS_SIEG_ARG)}, BONUS_NIEDERLAGE ${komma(beefData.BONUS_NIEDERLAGE)}` +
      `${gesetzt(BONUS_NIEDERLAGE_ARG)}, BONUS_TAGE ${beefData.BONUS_TAGE}${gesetzt(BONUS_TAGE_ARG)}` +
      `, Disstrack spike ${komma(music.release('diss').spike, 2)}${gesetzt(DISS_SPIKE)}` +
      ` gegen Single ${komma(music.release('single').spike, 2)}` +
      `, Disstrack growth ${komma(music.release('diss').growth, 2)}${gesetzt(DISS_GROWTH)} ` +
      `gegen Single ${komma(music.release('single').growth, 1)}` +
      `, ANZAEHL_CHANCE ${komma(beefData.ANZAEHL_CHANCE * 100, 1)} %${gesetzt(ANZAEHL_CHANCE_ARG)}` +
      `${[BONUS_SIEG_ARG, BONUS_NIEDERLAGE_ARG, BONUS_TAGE_ARG, DISS_SPIKE, DISS_GROWTH, ANZAEHL_CHANCE_ARG]
        .some((x) => x !== null) ? '   (* über die Kommandozeile gesetzt, nicht aus der Datendatei)' : ''}\n`);
    await beeflauf(LAEUFE, TAGE);
    return;
  }

  if (NUR === 'angebote') {
    console.log(`\n--- Gegenanfragen und große Formate (Stück 5c: aus · alles-ab · alles-an · nur-geld · ` +
      `nur-projekte · nur-label, dazu das Kollabo-Kontrollpaar – ${LAEUFE} Läufe à ${TAGE} Tage) ---\n`);
    // Alle Zahlen, an denen das Balancing hängt, stehen in der Kopfzeile des
    // Laufs – damit in der Rohausgabe zu sehen ist, welche Einstellung sie
    // gemessen hat, und nicht nur in der Kommandozeile darüber.
    const gesetzt = (arg) => (arg === null ? '' : '*');
    console.log(`  HONORAR_K ${komma(angeboteData.HONORAR_K, 2)}${gesetzt(HONORAR_K_ARG)}` +
      `, HONORAR_EXP ${komma(angeboteData.HONORAR_EXP, 2)}` +
      `, HONORAR_DECKEL_TAGE ${angeboteData.HONORAR_DECKEL_TAGE}` +
      `, VORGRUPPE_ANTEIL ${komma(angeboteData.VORGRUPPE_ANTEIL, 3)}${gesetzt(VORGRUPPE_ANTEIL_ARG)}` +
      `, KOLLABO_STUNDEN ${angeboteData.KOLLABO_STUNDEN}${gesetzt(KOLLABO_STUNDEN_ARG)}` +
      `, KOLLABO_TITEL ${angeboteData.KOLLABO_TITEL}` +
      `, TOUR_STUNDEN ${angeboteData.TOUR_STUNDEN}${gesetzt(TOUR_STUNDEN_ARG)}` +
      `, PROJEKT_FRIST_TAGE ${angeboteData.PROJEKT_FRIST_TAGE}` +
      `, ARBEIT_STUNDEN ${angeboteData.ARBEIT_STUNDEN}` +
      `, TOUR_KONZERTE ${angeboteData.TOUR_KONZERTE}${gesetzt(TOUR_KONZERTE_ARG)}` +
      `, ANFRAGE_CHANCE ${komma(angeboteData.ANFRAGE_CHANCE * 100, 1)} %${gesetzt(ANFRAGE_CHANCE_ARG)}` +
      `, ANFRAGEN_MAX ${angeboteData.ANFRAGEN_MAX}, FRIST_TAGE ${angeboteData.FRIST_TAGE}` +
      `, PAUSE_SCHWELLE ${angeboteData.PAUSE_SCHWELLE}, PAUSE_TAGE ${angeboteData.PAUSE_TAGE}` +
      `, LABEL.minListeners ${de(musicData.LABEL.minListeners)}` +
      `, LABEL.advanceDays ${musicData.LABEL.advanceDays}${gesetzt(LABEL_VORSCHUSS_ARG)}` +
      `, LABEL.cut ${komma(musicData.LABEL.cut * 100, 0)} %${gesetzt(LABEL_CUT_ARG)}` +
      `, LABEL.durationDays ${musicData.LABEL.durationDays}` +
      `, ANZAEHL_CHANCE ${komma(beefData.ANZAEHL_CHANCE * 100, 1)} % (der Beef läuft mit, in jeder Variante gleich)` +
      `${[HONORAR_K_ARG, VORGRUPPE_ANTEIL_ARG, KOLLABO_STUNDEN_ARG, TOUR_STUNDEN_ARG,
        LABEL_VORSCHUSS_ARG, LABEL_CUT_ARG, TOUR_KONZERTE_ARG, ANFRAGE_CHANCE_ARG].some((x) => x !== null)
        ? '   (* über die Kommandozeile gesetzt, nicht aus der Datendatei)' : ''}\n`);
    await angebotelauf(LAEUFE, TAGE);
    return;
  }

  if (NUR === 'vorfaelle') {
    console.log(`\n--- Vorfälle bei Musik und Creator (Stück 5f: vom Wurf je Aktion zum Wurf je Tag ` +
      `– ${LAEUFE} Läufe à ${TAGE} Tage) ---\n`);
    // Alle Zahlen, an denen dieser Abschnitt hängt, stehen in der Kopfzeile –
    // damit in der Rohausgabe zu sehen ist, welche Einstellung sie gemessen hat.
    console.log(`  RISK_MIN_DAY ${komma(decisions.RISK_MIN_DAY, 3)}` +
      `, RISK_MAX_DAY ${komma(decisions.RISK_MAX_DAY, 3)}` +
      `, RISK_FULL ${de(decisions.RISK_FULL)}` +
      `, ROLL_TAGE_MAX ${decisions.ROLL_TAGE_MAX}` +
      `, MIN_GAP_MS ${decisions.MIN_GAP_MS / 3600e3} h` +
      `, DECIDE_MS ${decisions.DECIDE_MS / 3600e3} h` +
      `, FRUEH_MAX ${de(decisions.FRUEH_MAX)}` +
      `, SEVERITY_MAX ${komma(decisions.SEVERITY_MAX, 2)} ab ${de(decisions.SEVERITY_FULL)}` +
      `, IGNORE_PENALTY ${komma(decisions.IGNORE_PENALTY, 2)}` +
      `   (alle aus src/decisions.js, keine Kommandozeile greift hier)\n`);
    await vorfaellelauf(LAEUFE, TAGE);
    return;
  }

  if (NUR === 'nachfrage') {
    console.log(`\n--- Nachfrage-Drift (Stück 3c: BETO, ${TAGE} Tage, drei Welten, ein Würfel) ---\n`);
    await nachfragelauf(LAEUFE, TAGE);
    console.log();
    return;
  }

  console.log(`\n=== Messung: ${LAEUFE} Läufe à ${TAGE} Tage, fester Würfel${STRATEGIE ? ' (Strategie festgelegt)' : ''}` +
    `, Deckel ${STUNDEN} h/Tag${MARATHON ? ', Marathon im Wechsel' : ''} ===\n`);

  console.log('  nur Creator');
  const a = await archetyp('creator', false, LAEUFE, TAGE);
  console.log('\n  Musik + Creator');
  const b = await archetyp('beides', true, LAEUFE, TAGE);

  const zeile = (name, r) =>
    `  ${name.padEnd(16)}${de(r.median / TAGE).padStart(9)}/Tag   ` +
    `[${de(r.q25 / TAGE)} … ${de(r.q75 / TAGE)}]   ` +
    `${de(r.follower)} Follower` + (r.hoerer ? `, ${de(r.hoerer)} Hörer` : '') +
    ` · Energie Ø ${Math.round(r.energie * 100)} %`;

  console.log(`\n--- Beste Strategie je Archetyp (Median, Quartile) ---\n`);
  console.log(zeile('nur Creator', a), `\n    via "${a.strategie}"`);
  console.log(zeile('Musik+Creator', b), `\n    via "${b.strategie}"`);
  console.log(`\n  Faktor Musik+Creator / nur Creator: ${(b.median / Math.max(1, a.median)).toFixed(2)}×`);

  const anteile = (r) => Object.entries(r.quellen)
    .filter(([, v]) => Math.abs(v) > 1)
    .map(([k, v]) => `${k} ${de(v)} (${Math.round((v / r.median) * 100)} %)`).join(' · ');
  console.log(`\n--- Woher das Geld kommt (Mittel je Lauf) ---\n`);
  console.log(`  nur Creator     ${anteile(a)}`);
  console.log(`  Musik+Creator   ${anteile(b)}`);

  /*
   * Firmen: je Branche ein Lauf MIT Ereignissen und Vorfällen (Standard) und einer
   * OHNE (Würfel ≡ 0,5) – beide in einem Aufruf, damit die Differenz auf einer Zeile
   * steht. `--ohne-ereignisse` lässt nur den zweiten laufen (wie vor 2b).
   */
  const ereignisZeile = (r) => `Ereignistage ${r.ereignisTage}, Vorfälle ${r.vorfaelle}, ${r.zuTage} Tage zu, ` +
    `Nachschuss ${de(r.nachschuss)} an ${r.nachschussTage} Tagen, Werbung ${r.werbungAus}× an der Kasse gescheitert, ` +
    `bester NPC-Umsatz ${de(r.best)} ` +
    `(Ereignis-Decke ${de(r.ereignisDecke)})`;
  const spur = (id, opts, ereignisse) => (TRACE === `${id}:${opts.ausbau ?? 'keiner'}:${ereignisse ? 'mit' : 'ohne'}`
    ? (t) => console.error(JSON.stringify(t)) : null);
  const beide = async (id, opts) => ({
    mit: OHNE_EREIGNISSE ? null : await firmenlauf(id, TAGE, { ...opts, ereignisse: true, trace: spur(id, opts, true) }),
    ohne: await firmenlauf(id, TAGE, { ...opts, ereignisse: false, trace: spur(id, opts, false) }),
  });
  const amort = (r, was) => `${was} ${r.amortTage === null ? `nicht in ${TAGE}` : r.amortTage} Tage`;
  /** Waren (Stück 3a): Wareneinsatz je Tag und Anteil ad hoc, mit und ohne Ereignisse; Kurs = Start. */
  const wareZeile = (mit, ohne) => {
    const w = (r) => `Ware Ø ${de(Math.round(r.wareProTag))}/Tag, ad hoc ${(r.adhocAnteil * 100).toFixed(1).replace('.', ',')} % ` +
      `(${de(r.adhocEinheiten)} von ${de(r.einheiten)} Einheiten)`;
    return (mit ? `mit Ereignissen: ${w(mit)}, Einkauf ${mit.einkaufAus}× an der Kasse gescheitert · ohne: ${w(ohne)}` : w(ohne)) +
      ` · bester Tag ohne ${de(ohne.bestNetto)} (Decke ${de(ohne.decke)}, Ware zum Verbrauch gerechnet)`;
  };

  /**
   * Firmenwert am Ende (Stück 4): Substanz und Ertragswert, je Lauf eine Zeile.
   * `profit_ema` steht dabei, damit der Ertragswert gegen den Median/Tag desselben
   * Laufs nachrechenbar ist (Ertragswert = max(0, round(profit_ema × 30))).
   */
  const wertZeile = (r, was) => `${' '.repeat(18)}Firmenwert am Ende ${was}: ` +
    `Substanz ${de(r.wert.substance)} (Kasse ${de(r.wert.kasse)}, Lager ${de(r.wert.stock)}, Ausbau ${de(r.wert.invested)}) · ` +
    `Ertragswert ${de(r.wert.earnings)} (profit_ema ${de(r.wert.profitEma)}) · Summe ${de(r.wert.total)}`;
  const werte = (mit, ohne) => {
    if (mit) console.log(wertZeile(mit, 'mit Ereignissen'));
    console.log(wertZeile(ohne, mit ? 'ohne' : 'ohne Ereignisse'));
  };

  console.log('\n--- Firmen (nicht ausgebaut, Vollbetrieb) ---\n');
  const kern = {};                      // die Kern-Läufe als Referenz für den Handel (Stück 3b)
  for (const br of companyData.BRANCHES) {
    const { mit, ohne } = await beide(br.id, {});
    kern[br.id] = { mit, ohne };
    const kopf = `  ${(br.emoji + ' ' + br.name).padEnd(16)}`;
    if (mit) {
      console.log(`${kopf}mit Ereignissen ${de(mit.median).padStart(9)}/Tag (Vorfälle ${mit.vorfaelle}, ${mit.zuTage} Tage zu) · ` +
        `ohne ${de(ohne.median).padStart(9)}/Tag   Decke ${de(ohne.decke)}   ` +
        `${amort(mit, 'Amortisation mit')}, ${amort(ohne, 'ohne')}`);
      console.log(`${' '.repeat(18)}${ereignisZeile(mit)}`);
    } else {
      console.log(`${kopf}${de(ohne.median).padStart(9)}/Tag   Decke ${de(ohne.decke)}   ${amort(ohne, 'Amortisation')}`);
    }
    console.log(`${' '.repeat(18)}${wareZeile(mit, ohne)}`);
    werte(mit, ohne);
  }

  console.log('\n--- Firmen voll ausgebaut (Kapitalist: alles am Tag 1) ---\n');
  for (const br of companyData.BRANCHES) {
    const { mit, ohne } = await beide(br.id, { ausbau: 'kapitalist' });
    const kopf = `  ${(br.emoji + ' ' + br.name).padEnd(16)}`;
    if (mit) {
      console.log(`${kopf}mit Ereignissen ${de(mit.median).padStart(9)}/Tag (Vorfälle ${mit.vorfaelle}, ${mit.zuTage} Tage zu) · ` +
        `ohne ${de(ohne.median).padStart(9)}/Tag   Decke ${de(ohne.decke)}   ` +
        `${amort(mit, 'Amortisation des Ausbaus mit')}, ${amort(ohne, 'ohne')}`);
      console.log(`${' '.repeat(18)}${ereignisZeile(mit)}`);
    } else {
      console.log(`${kopf}${de(ohne.median).padStart(9)}/Tag   Decke ${de(ohne.decke)}   ${amort(ohne, 'Amortisation des Ausbaus')}`);
    }
    console.log(`${' '.repeat(18)}${wareZeile(mit, ohne)}`);
    werte(mit, ohne);
  }
  console.log('\n--- Firmen aus eigener Kraft (Aufsteiger: nur aus Gewinn) ---\n');
  for (const br of companyData.BRANCHES) {
    const { mit, ohne } = await beide(br.id, { ausbau: 'aufsteiger' });
    const kopf = `  ${(br.emoji + ' ' + br.name).padEnd(16)}`;
    const weg = (r) => `Stufe 5 an Tag ${r.stufe5Tag ?? '–'} · voll an Tag ${r.vollTag ?? '–'} · Ertrag am Ende ${de(r.endeProTag)}/Tag`;
    if (mit) {
      console.log(`${kopf}mit Ereignissen: ${weg(mit)} (Vorfälle ${mit.vorfaelle}, ${mit.zuTage} Tage zu)`);
      console.log(`${' '.repeat(18)}ohne:            ${weg(ohne)}`);
      console.log(`${' '.repeat(18)}${ereignisZeile(mit)}`);
    } else {
      console.log(`${kopf}${weg(ohne)}`);
    }
    console.log(`${' '.repeat(18)}${wareZeile(mit, ohne)}`);
    werte(mit, ohne);
  }

  /*
   * Handel (Stück 3b): Spedition (Kern, Angebot alle 95 %) liefert einer Baufirma (Kern) in
   * derselben Welt; Referenz sind die Kern-Läufe oben (gleicher Würfel je Firma). Erwartung
   * bei Kurs = Start: 40 Einheiten/Tag × 17 = 680/Tag Spanne beim Spediteur und dieselben
   * 680/Tag Ersparnis beim Käufer (323 statt 340 je Einheit), beide unter ihrer Handels-Decke.
   */
  console.log('\n--- Handel (Spedition liefert Baufirma) ---\n');
  {
    const spurH = (seite, ereignisse) => (TRACE === `handel:${seite}:${ereignisse ? 'mit' : 'ohne'}`
      ? (t) => console.error(JSON.stringify(t)) : null);
    const lauf = async (ereignisse) => handelslauf(TAGE, { ereignisse,
      trace: { spedition: spurH('spedition', ereignisse), baufirma: spurH('baufirma', ereignisse) } });
    const mit = OHNE_EREIGNISSE ? null : await lauf(true);
    const ohne = await lauf(false);
    const plus = (n) => (n >= 0 ? '+' : '−') + de(Math.abs(n));
    const refS = kern.spedition;
    const refB = kern.baufirma;
    const q = company.wareUnit(company.branch('baufirma'));
    console.log(`  Spedition Kern (10 Plätze, Kapazität ${10 * companyData.HANDEL_KAPAZITAET}/Tag) bietet alle Waren zu 95 % ` +
      `(Baufirma-Ware ${de(q)} → ${de(Math.round(q * 0.95))}, Großhandel ${de(Math.round(q * 0.9))}, Spanne ${de(Math.round(q * 0.95) - Math.round(q * 0.9))} je Einheit); ` +
      `die Baufirma Kern kauft täglich zuerst dort, den Rest beim NPC.`);
    const vergleich = (name, r, ref) => (r
      ? `${name}mit Handel ${de(r.median).padStart(9)}/Tag · ohne (Referenz) ${de(ref.median).padStart(9)}/Tag · Differenz ${plus(r.median - ref.median)}`
      : null);
    const s = (r) => r.spediteur.handel;
    const k = (r) => r.kaeufer.handel;
    // Spediteur: Median mit Ereignissen (Hauptvergleich), ohne Ereignisse (§3-Prüfung).
    console.log(`  🚚 Spediteur    ${mit ? vergleich('', mit.spediteur, refS.mit) + ' (mit Ereignissen)' : ''}`);
    console.log(`${' '.repeat(18)}${vergleich('', ohne.spediteur, refS.ohne)} (ohne Ereignisse)`);
    for (const [was, r] of [['mit Ereignissen', mit], ['ohne', ohne]]) {
      if (!r) continue;
      const h = s(r);
      console.log(`${' '.repeat(18)}${was}: Spanne Ø ${de(h.spanne / TAGE)}/Tag (Σ ${de(h.spanne)} an ${h.tage} Handelstagen), ` +
        `geliefert Ø ${de(h.geliefert / TAGE)} Einheiten/Tag (Σ ${de(h.geliefert)}), ` +
        `größte Tagesspanne ${de(h.bestSpanne)} für ${de(h.bestSpanneEinheiten)} Einheiten (Handels-Decke Spediteur ${de(h.decke)})` +
        (was === 'ohne' ? ` · bester Tag ${de(r.spediteur.bestNetto)} (Decke ${de(r.spediteur.decke)} + Handels-Decke ${de(s(r).decke)}, Ware zum Verbrauch gerechnet)` : ''));
    }
    console.log(`  🏗️ Käufer       ${mit ? vergleich('', mit.kaeufer, refB.mit) + ' (mit Ereignissen)' : ''}`);
    console.log(`${' '.repeat(18)}${vergleich('', ohne.kaeufer, refB.ohne)} (ohne Ereignisse)`);
    for (const [was, r] of [['mit Ereignissen', mit], ['ohne', ohne]]) {
      if (!r) continue;
      const h = k(r);
      console.log(`${' '.repeat(18)}${was}: Ersparnis Ø ${de(h.ersparnis / TAGE)}/Tag (Σ ${de(h.ersparnis)}), ` +
        `vom Spediteur ${de(h.einheiten)} von ${de(h.einheiten + h.gekauftNpc + r.kaeufer.adhocEinheiten)} Einheiten ` +
        `(${(h.anteil * 100).toFixed(1).replace('.', ',')} %; NPC ${de(h.gekauftNpc)}, ad hoc ${de(r.kaeufer.adhocEinheiten)}; ohne Erstausstattung), ` +
        `Spediteur ${h.zu}× zu, größte Tagesersparnis ${de(h.bestErsparnis)} für ${de(h.bestErsparnisEinheiten)} Einheiten an Tag ${h.bestErsparnisTag + 1}` +
        (h.bestErsparnisEinheiten > h.perDay ? ` (über dem Tagesverbrauch ${h.perDay} – Nachkauf nach einer Lücke)` : '') +
        ` (Handels-Decke Käufer ${de(h.decke)} je Tag Verbrauch)` +
        (was === 'ohne' ? ` · bester Tag ${de(r.kaeufer.bestNetto)} (Decke ${de(r.kaeufer.decke)} + Handels-Decke ${de(h.decke)}, Ware zum Verbrauch gerechnet)` : ''));
    }
  }

  /*
   * Nachfrage-Drift (Stück 3c): Wareneinkäufe heben die Lieferanten-Aktie – gedeckelt.
   * Drei Börsenwelten mit demselben Würfel, 0 / 40 / 200 Einheiten BETO am Tag; die
   * Endkurse müssen sich um genau e^(Σ extra) unterscheiden (bis auf Rundung je Takt).
   */
  console.log(`\n--- Nachfrage-Drift (Stück 3c: BETO, ${TAGE} Tage, drei Welten, ein Würfel) ---\n`);
  await nachfragelauf(LAEUFE, TAGE);

  console.log(`\n--- Heists, Erwartungswert je Crew-Mitglied ---\n`);
  for (const h of heists()) {
    console.log(`  ${h.id.padEnd(14)} ${(h.chance * 100).toFixed(0).padStart(3)} %   ` +
      `Sperre ${String(h.sperreH).padStart(2)} h   ` +
      `Anteil ${de(h.anteil).padStart(9)}   EV/Versuch ${de(h.ev).padStart(9)}   ` +
      `EV/Tag ${de(h.proTag).padStart(9)}`);
  }
  console.log();
}

if (require.main === module) main();
