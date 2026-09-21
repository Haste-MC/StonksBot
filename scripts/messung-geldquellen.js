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
 */
const TRACE = (process.argv.find((a) => a.startsWith('--trace=')) ?? '').slice('--trace='.length) || null;
const de = (n) => Math.round(n).toLocaleString('de-DE');

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
 */
function musiktag(G, U, now, rand, konzertZuerst = false) {
  if (konzertZuerst) {
    const vor = music.status(G, U, now);
    if (vor.showMs <= 0 && vor.listeners >= music.SHOW_MIN_LISTENERS) return vor;
  }
  music.record(G, U, now, rand, musikOpts);
  const s = music.status(G, U, now + 1e6);
  if (s.songs >= 1 && s.releaseMs <= 0) {
    music.publish(G, U, s.songs >= 6 ? 'album' : s.songs >= 3 ? 'ep' : 'single', now + 2e6, rand, musikOpts);
  }
  return music.status(G, U, now + 3e6);
}

// ------------------------------------------------------------ Ein Lauf

async function karriere(G, U, { musik, strat }, tage, seed, marken = null) {
  const erreicht = {};
  const tagesgeld = [];
  const rand = rng(seed);
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
  for (let d = 0; d < tage; d++) {
    ausruesten(G, U);                 // Defekte von gestern ersetzen
    // Marathon-Modus: ungerade Tage sind Ruhetage – nur Abrechnungen, keine Arbeit.
    const ruhetag = MARATHON && d % 2 === 1;
    if (musik) {
      // Erst abrechnen, dann handeln: So liegt ein voller Tag zwischen zwei
      // Abrechnungen (`MIN_SETTLE_MS` verlangt mindestens eine Stunde).
      await music.settle(G, U, now);
      music.settleContracts(G, U, now + 1e5);
      if (!ruhetag) {
        const s = musiktag(G, U, now + 2e5, rand, strat.konzert);
        if (s.showMs <= 0 && s.listeners >= music.SHOW_MIN_LISTENERS) {
          await music.show(G, U, now + 4e6, rand, musikOpts);
        }
      }
    }
    const minuten = ruhetag ? 0 : await kanaltag(G, U, strat, now + 6e6, rand);
    await creator.settle(G, U, now + 20e6);
    await creator.settleMerch(G, U, now + 20e6);
    await creator.settleDeals(G, U, now + 20e6);
    // Energie am Tagesende: nach der letzten Kanalaktion (die Uhr kann bis
    // ~22:40 vorrücken), sonst zur Abrechnung um ~11:33 – Mittel über den Lauf.
    energieSumme += creator.energyOf(G, U, Math.max(now + 20e6, now + 6e6 + minuten * 60_000)).energy;

    /*
     * Vorfälle wie ein Spieler behandeln: Verfallene abrechnen, offene mit
     * zufälliger Option entscheiden. Ohne das bleibt der erste Vorfall des
     * Jahres ewig offen und blockiert alle weiteren – genau so hat eine
     * frühere Messung „einen Vorfall pro Jahr" gemeldet.
     */
    await decisions.settle(G, U, now + 20.5e6);
    const offen = decisions.pending(G, U, now + 20.6e6);
    if (offen) {
      const o = offen.decision.options[Math.floor(rand() * offen.decision.options.length)];
      await decisions.choose(G, U, offen.id, o.id, now + 20.6e6, rand);
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
    now += DAY;
  }

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
 *   lagerEnde:number, einkaufAus:number, handel:object}}
 *   `median` Tagesgewinn (Kassenstand nach Abrechnung minus Tagesbeginn),
 *   `decke` die Kern-Decke bzw. beim Ausbau die volle (`fullCeilingOf`),
 *   `ereignisTage` Tage mit Chronik-Zeile, `vorfaelle` gewürfelte Vorfälle,
 *   `zuTage` abgerechnete Tage mit geschlossenem Betrieb, `best` der höchste
 *   NPC-Umsatz eines Tages, `ereignisDecke` die Umsatz-Decke × EVENT_UMSATZ_MAX
 *   (§3; beim Aufsteiger die des Endausbaus), `nachschuss` eingezahlte Summe,
 *   `werbungAus` Tage, an denen die Werbung trotzdem an der Kasse scheiterte.
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
    return {
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

/** Für Prüf- und Kontrollläufe importierbar (test/…, Handprüfung): nur als Hauptprogramm messen. */
module.exports = { firmenlauf, handelslauf, karriere, kanaltag, strategien, welt, main };

async function main() {
  if (process.argv[2] === 'verlauf') {
    await verlauf(Number(process.argv[3] || 3), Number(process.argv[4] || 1500));
    return;
  }
  const LAEUFE = Number(process.argv[2] || 30);
  const TAGE = Number(process.argv[3] || 730);

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
