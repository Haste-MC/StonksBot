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
/** `--ohne-ereignisse`: Musik ohne leichte Ereignisse und ohne Vorfälle (Vergleichsmessung, §3). */
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
 * Spieler, der sich selbst im Weg steht, nicht die Firma. Ohne Zufall: Die
 * Firma würfelt nicht (nur NPC-Namen), der Lauf ist deterministisch.
 *
 * @returns {{median:number, decke:number, amortTage:number|null, entnommen:number,
 *   stufe5Tag:number|null, vollTag:number|null, endeProTag:number}}
 *   `median` Tagesgewinn (Kassenstand nach Abrechnung minus Tagesbeginn),
 *   `decke` die Kern-Decke bzw. beim Ausbau die volle (`fullCeilingOf`).
 */
async function firmenlauf(branchId, tage, { ausbau = 'keiner' } = {}) {
  if (!['keiner', 'kapitalist', 'aufsteiger'].includes(ausbau)) throw new Error(`ausbau: ${ausbau}`);
  const b = company.branch(branchId);
  const G = welt(`firma_${branchId}_${ausbau}`);
  const U = `fx:firma_${branchId}_${ausbau}`;
  const rand = rng(4242);
  const decke = (ausbau === 'keiner' ? company.ceilingOf(b) : company.fullCeilingOf(b)).net;
  const reserve = Math.round(b.price * companyData.WERBUNG_COST_SHARE);
  const gesamtAusbau = b.stufen.reduce((s, st) => s + st.price, 0) + b.extras.reduce((s, e) => s + e.price, 0);
  const investition = b.price + (ausbau === 'kapitalist' ? gesamtAusbau : 0);
  const top = companyData.RANKS.length - 1;

  // Ab heute vorwärts, wie `karriere` (die Module schreiben echte Zeitstempel).
  let now = new Date(new Date().setHours(6, 0, 0, 0)).getTime();
  const f = await company.found(G, U, b.id, `Mess-${b.name}`, now);
  if (!f.ok) throw new Error(`Gründung ${b.id} gescheitert: ${f.reason}`);
  const cid = f.company.id;

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

  const gewinn = [];
  let entnommen = 0;
  let amortTage = null;
  let stufe5Tag = null;
  let vollTag = null;
  let werbungLief = false;
  try {
    for (let d = 0; d < tage; d++) {
      // Ab Tag 30 wird jeder unter Schichtleiter befördert – auch später eingestellte.
      if (d >= 30) {
        for (const s of db.companyStaff(cid)) {
          for (let k = s.rank; k < top; k++) company.promote(G, U, s.id, +1, now);
        }
      }
      const vor = db.getCompany(cid).kasse;
      const wb = await company.advertise(G, U, now);
      // Bis zur ersten Kampagne füllt sich die Kasse erst (Auslastung startet bei 0,3 –
      // Tag 1–3 reicht sie nicht); jede spätere Absage wäre ein Fehler, der laut sein soll.
      if (wb.ok) werbungLief = true;
      if (!(wb.ok || wb.reason === 'running' || (wb.reason === 'kasse' && !werbungLief))) {
        throw new Error(`Werbung ${b.id} an Tag ${d + 1} abgelehnt: ${wb.reason}`);
      }
      for (let i = 0; i < companyData.MAX_PITCH_PER_DAY; i++) {
        const r = await company.pitchIn(G, U, now + i * 60_000);
        if (!r.ok) break;                 // Zeit alle oder Tageslimit
      }
      company.settle(cid, now + DAY);
      const c = db.getCompany(cid);
      if (!c || c.status !== 'open') throw new Error(`Firma ${b.id} an Tag ${d + 1} geschlossen (${c?.closed_why})`);
      gewinn.push(c.kasse - vor);

      const frei = Math.floor(c.kasse - reserve);
      if (frei > 0) {
        const en = await company.withdraw(G, U, frei, now + DAY);
        if (!en.ok) throw new Error(`Entnahme ${b.id} an Tag ${d + 1} gescheitert: ${en.reason}`);
        entnommen += frei;
        if (amortTage === null && entnommen > investition) amortTage = d + 1;
      }

      if (ausbau === 'aufsteiger') {
        // Erst die Leiter, dann die Extras – so lange, wie das Konto reicht.
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
        if (stufe5Tag === null && cur.stufe >= companyData.MAX_STUFE) stufe5Tag = d + 1;
        if (vollTag === null && cur.stufe >= companyData.MAX_STUFE
          && db.companyExtras(cid).length === b.extras.length) vollTag = d + 1;
      }
      now += DAY;
    }
  } finally {
    unb.getBalance = altGetBalance;
  }

  // Stille Null abfangen: Entnahmen müssen im Konto unter „Entnahme" auftauchen.
  const gezaehlt = quellen[U]?.Entnahme ?? 0;
  if (Math.round(gezaehlt) !== Math.round(entnommen)) {
    throw new Error(`Firma ${b.id}: ${de(entnommen)} entnommen, aber ${de(gezaehlt)} im Konto gezählt`);
  }
  if (ausbau === 'aufsteiger') {
    // Zweite stille Null: Was der Aufsteiger gekauft hat, muss im Konto als „Ausbau" stehen.
    const ausgegeben = -(quellen[U]?.Ausbau ?? 0);
    const c = db.getCompany(cid);
    const soll = b.stufen.slice(0, c.stufe).reduce((s, st) => s + st.price, 0)
      + db.companyExtras(cid).reduce((s, id) => s + companyData.extraById(id).price, 0);
    if (Math.round(ausgegeben) !== Math.round(soll)) {
      throw new Error(`Aufsteiger ${b.id}: Ausbau ${de(soll)} gekauft, aber ${de(ausgegeben)} im Konto gezählt`);
    }
  }
  return {
    median: median(gewinn), decke, amortTage, entnommen, stufe5Tag, vollTag,
    endeProTag: median(gewinn.slice(-30)),
  };
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
module.exports = { firmenlauf, karriere, kanaltag, strategien, welt, main };

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

  console.log('\n--- Firmen (nicht ausgebaut, Vollbetrieb) ---\n');
  for (const br of companyData.BRANCHES) {
    const r = await firmenlauf(br.id, TAGE);
    console.log(`  ${(br.emoji + ' ' + br.name).padEnd(16)}${de(r.median).padStart(9)}/Tag   ` +
      `Decke ${de(r.decke)}   Amortisation ${r.amortTage === null ? `nicht in ${TAGE}` : r.amortTage} Tage`);
  }

  console.log('\n--- Firmen voll ausgebaut (Kapitalist: alles am Tag 1) ---\n');
  for (const br of companyData.BRANCHES) {
    const r = await firmenlauf(br.id, TAGE, { ausbau: 'kapitalist' });
    console.log(`  ${(br.emoji + ' ' + br.name).padEnd(16)}${de(r.median).padStart(9)}/Tag   ` +
      `Decke ${de(r.decke)}   Amortisation des Ausbaus ${r.amortTage === null ? `nicht in ${TAGE}` : r.amortTage} Tage`);
  }
  console.log('\n--- Firmen aus eigener Kraft (Aufsteiger: nur aus Gewinn) ---\n');
  for (const br of companyData.BRANCHES) {
    const r = await firmenlauf(br.id, TAGE, { ausbau: 'aufsteiger' });
    console.log(`  ${(br.emoji + ' ' + br.name).padEnd(16)}Stufe 5 an Tag ${r.stufe5Tag ?? '–'} · voll an Tag ${r.vollTag ?? '–'} · ` +
      `Ertrag am Ende ${de(r.endeProTag)}/Tag`);
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
