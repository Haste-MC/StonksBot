/**
 * ===========================================================================
 *  MESSUNG: Rangfolge der Geldquellen
 * ===========================================================================
 *
 * Beantwortet eine einzige Frage mit Zahlen statt mit Schätzungen:
 *
 *     Was verdient ein reiner Creator, was ein Spieler, der Musik UND Creator
 *     betreibt – bei gleichem Zeiteinsatz? Und was ein Heist-Spieler?
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
 * Aufruf:  node scripts/messung-geldquellen.js [läufe] [tage]
 *          node scripts/messung-geldquellen.js 30 730
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

const DAY = 24 * 60 * 60 * 1000;
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
 * Ein Kanaltag: so lange Aktionen fahren, bis die Zeit alle ist.
 *
 * `community: true` setzt zuerst einen Tweet – Twitter verdient nichts, hält
 * aber die Community, an der Merch hängt. Genau diese Abwägung war in der
 * ersten Messung nie getroffen worden.
 */
async function kanaltag(G, U, strat, now, rand) {
  let t = 0;
  for (let b = 0; b < (strat.bindung ?? 0); b++) {
    for (const c of strat.bindungsreihe) {
      if (c.bindung <= 0) break;          // ohne Bindung bringt es hier nichts
      if (creator.remainingMs(G, U, c.p, now + t * 60_000) > 0) continue;
      const r = await creator.act(G, U, c.p, c.f, now + (t++) * 60_000, rand);
      if (r.ok) break;
    }
  }
  for (let i = 0; i < 12; i++) {
    /*
     * VORHER fragen statt hinterher absagen lassen.
     *
     * Jede Plattform hat eine eigene Sperre (YouTube 180 Minuten). Wer nach
     * jeder Aktion die ganze Formatliste neu durchprobiert, holt sich 51
     * Absagen für 4 Treffer – gemessen 93 % Ausschuss und damit der Grund,
     * warum ein Messlauf über eine Stunde brauchte. `remainingMs` und
     * `budget` sind billige Abfragen, `act` ist es nicht.
     */
    const zeit = creator.budget(G, U, now).left;
    if (zeit <= 0) return;

    let gemacht = false;
    for (const c of strat.reihe) {
      if (c.time > zeit) continue;
      if (creator.remainingMs(G, U, c.p, now + t * 60_000) > 0) continue;
      const r = await creator.act(G, U, c.p, c.f, now + (t++) * 60_000, rand);
      if (r.ok) { gemacht = true; break; }
    }
    if (!gemacht) return;
  }
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
  music.record(G, U, now, rand);
  const s = music.status(G, U, now + 1e6);
  if (s.songs >= 1 && s.releaseMs <= 0) {
    music.publish(G, U, s.songs >= 6 ? 'album' : s.songs >= 3 ? 'ep' : 'single', now + 2e6, rand);
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
  for (let d = 0; d < tage; d++) {
    ausruesten(G, U);                 // Defekte von gestern ersetzen
    if (musik) {
      // Erst abrechnen, dann handeln: So liegt ein voller Tag zwischen zwei
      // Abrechnungen (`MIN_SETTLE_MS` verlangt mindestens eine Stunde).
      await music.settle(G, U, now);
      music.settleContracts(G, U, now + 1e5);
      const s = musiktag(G, U, now + 2e5, rand, strat.konzert);
      if (s.showMs <= 0 && s.listeners >= music.SHOW_MIN_LISTENERS) {
        await music.show(G, U, now + 4e6, rand);
      }
    }
    await kanaltag(G, U, strat, now + 6e6, rand);
    await creator.settle(G, U, now + 20e6);
    await creator.settleMerch(G, U, now + 20e6);
    await creator.settleDeals(G, U, now + 20e6);

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
      for (const [k, v] of Object.entries(r.quellen)) summe[k] = (summe[k] ?? 0) + v;
    }
    const erg = {
      strategie: strat.name,
      median: median(geld), q25: quantil(geld, 0.25), q75: quantil(geld, 0.75),
      follower: median(follower), hoerer: median(hoerer),
      quellen: Object.fromEntries(
        Object.entries(summe).map(([k, v]) => [k, v / laeufe]).sort((a, b) => b[1] - a[1])),
    };
    if (!beste || erg.median > beste.median) beste = erg;
    if (!kurz || laeufe <= 3) {
      console.log(`    ${strat.name.padEnd(30)} Median ${de(erg.median).padStart(12)}` +
        `   ${de(erg.follower).padStart(9)} Follower` +
        (musik ? `   ${de(erg.hoerer).padStart(8)} Hörer` : ''));
    }
  }
  return beste;
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

(async () => {
  if (process.argv[2] === 'verlauf') {
    await verlauf(Number(process.argv[3] || 3), Number(process.argv[4] || 1500));
    return;
  }
  const LAEUFE = Number(process.argv[2] || 30);
  const TAGE = Number(process.argv[3] || 730);

  console.log(`\n=== Messung: ${LAEUFE} Läufe à ${TAGE} Tage, fester Würfel ===\n`);

  console.log('  nur Creator');
  const a = await archetyp('creator', false, LAEUFE, TAGE);
  console.log('\n  Musik + Creator');
  const b = await archetyp('beides', true, LAEUFE, TAGE);

  const zeile = (name, r) =>
    `  ${name.padEnd(16)}${de(r.median / TAGE).padStart(9)}/Tag   ` +
    `[${de(r.q25 / TAGE)} … ${de(r.q75 / TAGE)}]   ` +
    `${de(r.follower)} Follower` + (r.hoerer ? `, ${de(r.hoerer)} Hörer` : '');

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

  console.log(`\n--- Heists, Erwartungswert je Crew-Mitglied ---\n`);
  for (const h of heists()) {
    console.log(`  ${h.id.padEnd(14)} ${(h.chance * 100).toFixed(0).padStart(3)} %   ` +
      `Sperre ${String(h.sperreH).padStart(2)} h   ` +
      `Anteil ${de(h.anteil).padStart(9)}   EV/Versuch ${de(h.ev).padStart(9)}   ` +
      `EV/Tag ${de(h.proTag).padStart(9)}`);
  }
  console.log();
})();
