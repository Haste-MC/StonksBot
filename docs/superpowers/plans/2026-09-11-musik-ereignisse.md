# Zufallsereignisse für die Musikkarriere – Umsetzungsplan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Die Musikkarriere bekommt zwei Schichten Zufall – zwölf leichte Ereignisse an den drei Aktionen und fünf schwere Vorfälle mit Entscheidung – ohne Gelddrucker und ohne dass sich der kalibrierte Hörer-Median (500–700k nach einem Jahr) um mehr als 10 % nach oben verschiebt.

**Architecture:** Schicht 1 kopiert das Creator-Muster (`data/creator.js EVENTS` + `creator.rollEvent`): gewichtete Liste in `src/data/musicEvents.js`, Würfel `rollMusicEvent` in `music.js`, Andockpunkte in `record`/`publish`/`show`. Schicht 2 erweitert das bestehende Entscheidungs-System um eine **Domäne**: `decisions.roll(…, domain)` filtert nach Domäne, `decisions.apply()` verzweigt auf `row.platform === 'music'` in eine eigene Funktion `applyMusic`, die nur die Künstlerzeile anfasst. Keine Schemaänderung – Musik-Vorfälle liegen in `creator_events` mit `platform = 'music'`.

**Tech Stack:** Node.js (CommonJS), `node:sqlite` über `src/db.js`, eigene Testdateien ohne Framework (`check(label, ok)`-Muster, Aufruf `node test/<name>.test.js`), fester Würfel (`mulberry32`) in Tests.

## Global Constraints

- Spec: `docs/superpowers/specs/2026-09-11-musik-ereignisse-design.md`. Bei Widerspruch zwischen Plan und Spec gilt die Spec – **außer** bei der Ablage der Musik-Vorlagen (siehe Abweichung unten).
- ARCHITEKTUR.md §3 (kein Gelddrucker – gemessen, nicht behauptet), §7 (synchroner Schreibvorgang vor dem ersten `await`), §8 (späte Bindung: `require('./decisions')` **innerhalb** der Funktionen in `music.js`, `require('./music')` innerhalb der Funktionen in `decisions.js`), §9 (eine Buchung je Aktion), §12 (Tests ohne Netz: `unb.changeCash`/`unb.getBalance` werden im Test ersetzt).
- Tests laufen mit `DATA_DIR=.testdata` (siehe `package.json`), nie gegen `data/shop.db`. Einzelaufruf: `rm -rf .testdata && DATA_DIR=.testdata node test/musicEvents.test.js`.
- Sprache in Code-Kommentaren, Texten, Commit-Botschaften: Deutsch. Commit-Botschaften enden mit `Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>`.
- `test/decisions.test.js` bleibt **ohne eine Zeile Änderung** grün (Spec, Test 9).
- Bei `pay = 0` (Ereignis `abgesagt`) wird **nicht** gebucht – die UnbelievaBoat-API lehnt Nulländerungen ab.
- Der Ereigniswürfel ist in jeder der drei Aktionen der **erste** Aufruf von `random()` – nur so lassen sich Ereignisse im Test mit einer festen Zahlenfolge erzwingen. Das steht als Kommentar an jeder Andockstelle.
- **Regeln aus `messfehler-vermeiden.md`:** Jede abgeleitete Zahl erst gegen einen von Hand gerechneten Einzelfall prüfen; auf stille Nullen achten (ein Wert von 0 Hörern/0 Vorfällen ist ein Fehler, kein Ergebnis); Simulationen starten **heute 6:00** und laufen vorwärts; `grep src/` statt raten.

### Abweichung von der Spec (begründet)

Die Spec legt die fünf Musik-Vorlagen in `src/data/decisions.js` mit `domain: 'music'` ab. Das geht nicht ohne `test/decisions.test.js` zu ändern: Der Test prüft den **gesamten** `DECISIONS`-Katalog auf bekannte Wirkungsschlüssel (`followers`, `hype`, `cash`, …) und darauf, dass `platform` eine echte Creator-Plattform ist. Musik-Wirkungen (`listeners`, `songsShare`, `lockRelease`, …) würden ihn rot machen – Test 9 der Spec verlangt aber, dass er unverändert grün bleibt.

Deshalb: eigene Datei **`src/data/musicDecisions.js`** mit `MUSIC_DECISIONS`. `decisions.js` kennt beide Listen; `roll()` wählt nach Domäne, `byId` enthält beide. `DECISIONS` in `data/decisions.js` bleibt unangetastet. Die Domäne steckt in der Liste, nicht im Feld – deshalb entfällt das Feld `domain` auf den Vorlagen.

Zweite Kleinigkeit: Die Spec nennt den Leak-Vorfall `leak`. Diese ID gibt es schon (Creator: „Dein unfertiges Video ist geleakt"); `byId` ist eine Map über beide Listen. Die Musik-Variante heißt **`album_leak`**.

### Gemessener Ausgangspunkt (vor dem Bau, 2026-09-11)

Tagesroutine wie in `scripts/messung-geldquellen.js` (Abrechnen → Konzert-Tag oder Studio+Release → Konzert wenn möglich), Pop, Gesicht, Deutschland, 365 Tage, fester Würfel, Seeds 1–5:

```
Hörer nach 365 Tagen: 537.918  573.659  581.796  582.901  597.169   Median 581.796
```

Das ist die Referenz für Test 10. Die Zahl steht hier, damit niemand sie schätzen muss.

---

## Dateien

| Datei | Verantwortung |
|---|---|
| `src/data/musicDecisions.js` | **neu** – die fünf schweren Vorfälle (`MUSIC_DECISIONS`) |
| `src/data/musicEvents.js` | **neu** – die zwölf leichten Ereignisse (`MUSIC_EVENTS`) und `candidates(action, risk)` |
| `src/decisions.js` | Domäne in `roll`, Zulassungsprüfung `musicEligible`, Musik-Zweig `applyMusic`, `random` durch `apply` |
| `src/music.js` | `rollMusicEvent`, Optionen `{ events, force, audience }` an `record`/`publish`/`show`, Vorfall-Würfel, `status().incident` |
| `src/ui.js` | 🎵 in `buildDecisionView`, Hinweiszeile in `buildMusicView` |
| `src/buttons.js` | `decisions.settle` in `settleMusic`, Ereignis- und Vorfall-Zeilen in `mstudio`/`mpub`/`mshow`, Musik-Wirkungen in `wahl` |
| `src/fluxer/commands.js` | `/musik` rechnet Vorfälle mit ab |
| `test/musicEvents.test.js` | **neu** – alle 12 Prüfblöcke der Spec |
| `scripts/messung-geldquellen.js` | Vorfälle täglich entscheiden; Schalter `--ohne-ereignisse` |
| `src/data/patchnotes.js` | Eintrag 1.29.0 |
| `package.json` | `test/musicEvents.test.js` in die Kette |

---

### Task 1: Die fünf schweren Vorfälle als Daten

**Files:**
- Create: `src/data/musicDecisions.js`
- Create: `test/musicEvents.test.js`
- Modify: `package.json:10` (Testkette)

**Interfaces:**
- Produces: `MUSIC_DECISIONS` – Array von Vorlagen `{ id, emoji, title, minListeners, requires?, text, options: [{ id, label, emoji, outcomes: [{ weight, text, …Wirkung }] }], expire: { text, …Wirkung } }`. `requires` ist `{ persona: 'face' } | { songs: 3 } | { contract: true }` oder fehlt. Wirkungsschlüssel: `listeners`, `songsShare`, `hype`, `lockRelease`, `lockShow`, `contract`, `gear`, `cash`, `publish`, `audience`.

- [ ] **Step 1: Test für den Katalog schreiben**

`test/musicEvents.test.js` anlegen. Kopf und erster Block:

```js
/**
 * Tests für die Zufallsereignisse der Musikkarriere.
 *
 * Zwei Schichten, zwei Versprechen:
 *
 *  1. **Leichte Ereignisse** (data/musicEvents.js) feuern wirklich, hängen am
 *     Genre-Risiko und landen im Zustand – ein Tippfehler in einem
 *     Wirkungsschlüssel wäre sonst still wirkungslos.
 *  2. **Schwere Vorfälle** (data/musicDecisions.js) laufen durch das
 *     bestehende Entscheidungs-System, treffen nur die Künstlerzeile, und
 *     die Creator-Vorfälle bleiben davon unberührt.
 *
 * Dazu die §3-Messung: Mit Ereignissen darf der Hörer-Median nach einem
 * Jahr höchstens 10 % über dem ohne liegen.
 *
 * Aufruf: DATA_DIR=.testdata node test/musicEvents.test.js
 */
const db = require('../src/db');
const music = require('../src/music');
const decisions = require('../src/decisions');
const home = require('../src/home');
const unb = require('../src/unb');
const { MUSIC_DECISIONS } = require('../src/data/musicDecisions');
const { DECISIONS } = require('../src/data/decisions');

let pass = 0, fail = 0;
const check = (label, ok, extra = '') => {
  if (ok) { pass++; console.log(`  ✅ ${label}`); }
  else { fail++; console.log(`  ❌ ${label} ${extra}`); }
};

const G = `MEVENT_T${Date.now()}`;
const DAY_MS = 24 * 60 * 60 * 1000;
const de = (n) => Math.round(n).toLocaleString('de-DE');

let cash = 0;
let bookings = 0;
unb.changeCash = async (g, u, a) => { cash += a; bookings++; return { cash, bank: 0, total: cash }; };
unb.getBalance = async () => ({ cash: 10_000_000, bank: 0, total: 10_000_000 });

/** Derselbe feste Würfel wie in scripts/messung-geldquellen.js. */
function rng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Feste Zahlenfolge; nach dem Ende kommt 0,5. */
function seq(...values) {
  let i = 0;
  return () => (i < values.length ? values[i++] : 0.5);
}

/**
 * Würfel für decisions.roll(): Der erste Aufruf (Risikoprüfung) trifft immer,
 * danach gleichverteilt (Auswahl der Vorlage). `() => 0` wäre falsch – die
 * Auswahl träfe dann immer die erste Vorlage.
 */
function hit(rand) {
  let first = true;
  return () => { if (first) { first = false; return 0; } return rand(); };
}

const setup = db.createItem({
  guildId: G, name: music.GEAR, price: 3400, kind: 'gear', stock: null, createdBy: 't',
});

let n = 0;
/** Ein Künstler mit Ausrüstung, Heimat Deutschland (kein Idol-Markt). */
async function artist({ genre = 'pop', persona = 'face', listeners = 0, songs = 0, land = 'de' } = {}) {
  const U = `fx:e${n++}`;
  db.clearArtist(G, U);
  db.clearCreator(G, U);
  db.clearEvents(G, U);
  if (!db.ownsNamed(G, U, music.GEAR)) db.reservePurchase(G, U, setup.id, 1);
  await home.setHome(G, U, land);
  home.setLanguage(G, U, 'deutsch');
  music.setup(G, U, genre, persona);
  const now = Date.now();
  const row = db.getArtist(G, U, now);
  db.saveArtist(G, U, {
    ...row, listeners, songs, touched_at: now, paid_through: now, last_action_at: now,
  });
  return U;
}

const gear = (U) => Boolean(db.ownsNamed(G, U, music.GEAR));
const refill = (U) => { if (!gear(U)) db.reservePurchase(G, U, setup.id, 1); };

(async () => {
  console.log('--- Der Katalog der schweren Vorfälle ---');
  {
    check('fünf Vorfälle', MUSIC_DECISIONS.length === 5, String(MUSIC_DECISIONS.length));
    const ids = new Set(MUSIC_DECISIONS.map((d) => d.id));
    check('IDs sind eindeutig', ids.size === MUSIC_DECISIONS.length);
    check('keine ID kollidiert mit einem Creator-Vorfall',
      DECISIONS.every((d) => !ids.has(d.id)));
    check('jeder hat Titel, Text, Emoji, Hörerschwelle',
      MUSIC_DECISIONS.every((d) => d.title && d.text && d.emoji && d.minListeners > 0));
    check('jeder hat mindestens zwei Optionen',
      MUSIC_DECISIONS.every((d) => d.options.length >= 2));
    check('jede Option hat gewichtete Ausgänge mit Text',
      MUSIC_DECISIONS.every((d) => d.options.every((o) =>
        o.outcomes.length >= 1 && o.outcomes.every((x) => x.weight > 0 && x.text))));
    check('jeder hat einen Ausgang fürs Nichtstun',
      MUSIC_DECISIONS.every((d) => d.expire && d.expire.text));

    // Ein Tippfehler im Schlüssel wäre still wirkungslos – deshalb die Liste.
    const KEYS = new Set(['weight', 'text', 'listeners', 'songsShare', 'hype',
      'lockRelease', 'lockShow', 'contract', 'gear', 'cash', 'publish', 'audience']);
    const strays = [];
    for (const d of MUSIC_DECISIONS) {
      for (const o of d.options) {
        for (const x of o.outcomes) {
          for (const k of Object.keys(x)) if (!KEYS.has(k)) strays.push(`${d.id}.${o.id}.${k}`);
        }
      }
      for (const k of Object.keys(d.expire)) if (!KEYS.has(k)) strays.push(`${d.id}.expire.${k}`);
    }
    check('keine unbekannten Wirkungsschlüssel', strays.length === 0, strays.join(' '));

    // Vertragsbruch bucht die Strafe selbst – ein zweites `cash` wäre §9-Bruch.
    check('contract:break nie zusammen mit cash',
      MUSIC_DECISIONS.every((d) => [...d.options.flatMap((o) => o.outcomes), d.expire]
        .every((x) => !(x.contract && x.cash))));
    check('requires nur mit bekannten Feldern',
      MUSIC_DECISIONS.every((d) => !d.requires
        || Object.keys(d.requires).every((k) => ['persona', 'songs', 'contract'].includes(k))));
  }

  console.log(`\n${pass} bestanden, ${fail} fehlgeschlagen`);
  process.exit(fail ? 1 : 0);
})();
```

- [ ] **Step 2: Test laufen lassen – er muss scheitern**

```bash
rm -rf .testdata && DATA_DIR=.testdata node test/musicEvents.test.js
```

Erwartet: `Error: Cannot find module '../src/data/musicDecisions'`.

- [ ] **Step 3: Die Datendatei schreiben**

`src/data/musicDecisions.js`:

```js
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
];

module.exports = { MUSIC_DECISIONS };
```

- [ ] **Step 4: Test laufen lassen – grün**

```bash
rm -rf .testdata && DATA_DIR=.testdata node test/musicEvents.test.js
```

Erwartet: 11 ✅, `11 bestanden, 0 fehlgeschlagen`.

- [ ] **Step 5: In die Testkette hängen**

In `package.json` Zeile 10 am Ende der `test`-Kette ` && node test/musicEvents.test.js` anhängen (nach `node test/heist.test.js`).

- [ ] **Step 6: Commit**

```bash
git add src/data/musicDecisions.js test/musicEvents.test.js package.json
git commit -m "$(printf 'musik-vorfaelle: die fuenf schweren vorfaelle als daten\n\nEigene Liste statt Eintrag in data/decisions.js: Der Creator-Katalog wird\nauf Creator-Wirkungsschluessel geprueft, diese hier haben andere.\n\nCo-Authored-By: Claude Opus 5 <noreply@anthropic.com>')"
```

---

### Task 2: Domäne in `decisions.roll` und Zulassung

**Files:**
- Modify: `src/decisions.js:1-3` (Import), `:63` (`byId`), `:105-122` (`roll`)
- Test: `test/musicEvents.test.js`

**Interfaces:**
- Consumes: `MUSIC_DECISIONS` aus Task 1.
- Produces: `roll(guildId, userId, size, now, random, domain = 'creator')` – bei `domain === 'music'` ist `size` die Hörerzahl, die Zeile bekommt `platform: 'music'`. `musicEligible(d, artist, contract)` exportiert. `decision(kind)` findet auch Musik-Vorlagen.

- [ ] **Step 1: Tests für Domäne und Zulassung schreiben**

In `test/musicEvents.test.js` vor der Abschlusszeile (`console.log(\`\n${pass} bestanden …`) einfügen:

```js
  console.log('\n--- Domänen bleiben getrennt ---');
  {
    const musicIds = new Set(MUSIC_DECISIONS.map((d) => d.id));
    const creatorIds = new Set(DECISIONS.map((d) => d.id));

    // Ein reiner Musiker: 1.000 Würfe mit Würfel, der immer einen Vorfall zieht.
    const U = await artist({ listeners: 100_000, songs: 5 });
    const got = new Set();
    let now = Date.now();
    for (let i = 0; i < 1000; i++) {
      const rand = rng(i + 1);
      const ev = decisions.roll(G, U, 100_000, now, hit(rand), 'music');
      if (ev) { got.add(ev.kind); db.resolveEvent(G, ev.id, { status: 'done', at: now }); }
      now += decisions.MIN_GAP_MS + 1000;
    }
    check('ein Musiker bekommt nur Musik-Vorfälle',
      [...got].every((k) => musicIds.has(k)), [...got].join(' '));
    check('… und zwar alle ohne Zulassungshürde (plagiat, stimme, album_leak)',
      got.has('plagiat') && got.has('stimme') && got.has('album_leak'), [...got].join(' '));
    check('… und skandal (100.000 Hörer, Gesicht)',
      got.has('skandal'), [...got].join(' '));
    check('… und nie label (kein Vertrag)', !got.has('label'));
    check('die Zeile trägt platform = music',
      decisions.roll(G, U, 100_000, now, () => 0, 'music')?.platform === 'music');
    db.clearEvents(G, U);

    // Ein reiner Creator: Standard-Domäne, keine Musik-IDs.
    const C = `fx:c${n++}`;
    db.clearCreator(G, C); db.clearEvents(G, C);
    const share = { twitch: 0.52, youtube: 0.24, instagram: 0.11, twitter: 0.13 };
    for (const [id, part] of Object.entries(share)) {
      const row = db.getCreator(G, C, id, now);
      db.saveCreator(G, C, id, { ...row, followers: Math.round(1_000_000 * part), touched_at: now });
    }
    const gotC = new Set();
    for (let i = 0; i < 300; i++) {
      const rand = rng(i + 7);
      const ev = decisions.roll(G, C, 1_000_000, now, hit(rand));
      if (ev) { gotC.add(ev.kind); db.resolveEvent(G, ev.id, { status: 'done', at: now }); }
      now += decisions.MIN_GAP_MS + 1000;
    }
    check('ein Creator bekommt nur Creator-Vorfälle',
      gotC.size > 0 && [...gotC].every((k) => creatorIds.has(k)), [...gotC].join(' '));
    check('decision() findet Musik-Vorlagen', decisions.decision('plagiat')?.title === 'Plagiatsvorwurf');
  }

  console.log('\n--- Zulassungskriterien ---');
  {
    const now = Date.now();
    const anon = await artist({ persona: 'anon', listeners: 100_000, songs: 5 });
    const kinds = (U, size, tries = 400) => {
      const out = new Set();
      let t = now;
      for (let i = 0; i < tries; i++) {
        const rand = rng(i + 3);
        const ev = decisions.roll(G, U, size, t, hit(rand), 'music');
        if (ev) { out.add(ev.kind); db.resolveEvent(G, ev.id, { status: 'done', at: t }); }
        t += decisions.MIN_GAP_MS + 1000;
      }
      return out;
    };
    const a = kinds(anon, 100_000);
    check('anonym: nie skandal', a.size > 0 && !a.has('skandal'), [...a].join(' '));

    const wenig = await artist({ listeners: 100_000, songs: 2 });
    const w = kinds(wenig, 100_000);
    check('unter 3 Songs: nie album_leak', w.size > 0 && !w.has('album_leak'), [...w].join(' '));

    const klein = await artist({ listeners: 6_000, songs: 5 });
    const k = kinds(klein, 6_000);
    check('bei 6.000 Hörern: plagiat und stimme, aber kein skandal/album_leak',
      k.has('plagiat') && k.has('stimme') && !k.has('skandal') && !k.has('album_leak'),
      [...k].join(' '));

    // Mit Vertrag: label wird möglich. Vertrag direkt in die Tabelle legen.
    const idol = await artist({ listeners: 150_000, songs: 5, land: 'jp' });
    const c = db.insertContract({
      guildId: G, userId: idol, kind: 'idol', agency: 'Test Ent.', country: 'jp',
      createdAt: now, expiresAt: now + DAY_MS,
    });
    db.setContractStatus(G, c.id, 'active', { signedAt: now, endsAt: now + 90 * DAY_MS });
    check('Vertrag ist aktiv (Voraussetzung)', Boolean(music.contractOf(G, idol)));
    const l = kinds(idol, 150_000);
    check('mit Vertrag: label kommt', l.has('label'), [...l].join(' '));
  }
```

- [ ] **Step 2: Tests laufen lassen – sie müssen scheitern**

```bash
rm -rf .testdata && DATA_DIR=.testdata node test/musicEvents.test.js
```

Erwartet: „ein Musiker bekommt nur Musik-Vorfälle" ❌ (heute liefert `roll` Creator-Vorfälle, weil `domain` ignoriert wird und `reach >= d.minReach` gegen die Creator-Liste läuft).

- [ ] **Step 3: `decisions.js` umbauen**

Import (Zeile 2) ersetzen:

```js
const { DECISIONS } = require('./data/decisions');
const { MUSIC_DECISIONS } = require('./data/musicDecisions');
```

`byId` (Zeile 63) ersetzen:

```js
/** Beide Kataloge in einer Map – die Zeile in der DB kennt nur die `kind`. */
const byId = new Map([...DECISIONS, ...MUSIC_DECISIONS].map((d) => [d.id, d]));
```

Nach `pickOutcome` (vor dem Kommentar zu `roll`) einfügen:

```js
/**
 * Zulassung eines Musik-Vorfalls: Persona, vorhandene Titel, Vertrag.
 *
 * Ohne diese Prüfung träfe „Das Label will verschieben" jemanden ohne Label
 * und „Album im Netz" jemanden ohne Album – Vorfälle ins Leere.
 */
function musicEligible(d, artist, contract) {
  const r = d.requires ?? {};
  if (r.persona && artist.persona !== r.persona) return false;
  if (r.songs && (artist.songs ?? 0) < r.songs) return false;
  if (r.contract && !contract) return false;
  return true;
}
```

`roll` (Zeile 105–122) ersetzen:

```js
/**
 * Würfelt einen Vorfall aus. Höchstens einer gleichzeitig, und nicht öfter
 * als MIN_GAP_MS – sonst wäre der Kanal ein Katastrophengebiet.
 *
 * `size` ist bei Creator die Reichweite, bei Musik die Hörerzahl – dieselbe
 * Risikokurve. Die Sperre „solange einer offen ist" gilt über beide Domänen:
 * Wer gerade ein Creator-Drama hat, bekommt kein Musik-Drama obendrauf.
 */
function roll(guildId, userId, size, now = Date.now(), random = Math.random, domain = 'creator') {
  if (db.openEvent(guildId, userId)) return null;
  if (now - db.lastEventAt(guildId, userId) < MIN_GAP_MS) return null;
  if (random() >= riskFor(size)) return null;

  let possible;
  if (domain === 'music') {
    const artist = db.getArtist(guildId, userId, now);
    const contract = db.activeContract(guildId, userId);
    possible = MUSIC_DECISIONS.filter((d) =>
      size >= d.minListeners && musicEligible(d, artist, contract));
  } else {
    possible = DECISIONS.filter((d) => size >= d.minReach);
  }
  if (!possible.length) return null;
  const picked = possible[Math.floor(random() * possible.length)];

  return db.insertEvent({
    guildId, userId,
    kind: picked.id,
    platform: domain === 'music' ? 'music' : (picked.platform ?? ''),
    createdAt: now,
    expiresAt: now + DECIDE_MS,
  });
}
```

Export ergänzen: in `module.exports` nach `DECISIONS,` ein `MUSIC_DECISIONS,` und nach `pickOutcome,` ein `musicEligible,`.

- [ ] **Step 4: Beide Tests laufen lassen – grün**

```bash
rm -rf .testdata && DATA_DIR=.testdata node test/musicEvents.test.js && DATA_DIR=.testdata node test/decisions.test.js
```

Erwartet: `musicEvents` alle ✅; `decisions.test.js` unverändert grün (`git diff --stat test/decisions.test.js` ist leer).

- [ ] **Step 5: Commit**

```bash
git add src/decisions.js test/musicEvents.test.js
git commit -m "$(printf 'vorfaelle: domaene musik im wuerfel, zulassung nach persona/titeln/vertrag\n\nCo-Authored-By: Claude Opus 5 <noreply@anthropic.com>')"
```

---

### Task 3: Musik-Zweig in `decisions.apply`

**Files:**
- Modify: `src/decisions.js` (`apply`, `choose`, `expire`; neue Funktion `applyMusic`)
- Modify: `src/music.js` (Optionen `{ events, force, audience }` an `publish` – **nur die Signatur und `force`/`audience`**, der Ereigniswürfel kommt in Task 5)
- Test: `test/musicEvents.test.js`

**Interfaces:**
- Consumes: `music.publish(guildId, userId, typeId, now, random, opts)` mit `opts = { events = true, force = false, audience = 1 }` – `force` überspringt Sperre und Zeitbudget, `audience` multipliziert das Publikum (wird in dieser Task eingebaut).
- Produces: `apply(guildId, userId, row, effect, now, ignored = false, random = Math.random)`; Rückgabe bei Musik `{ listeners, songs, cash, hype, lockRelease, lockShow, gear, contract, published, balance? }`. `choose(…, random)` und `expire(…)` reichen `random` durch.

- [ ] **Step 1: Tests für jede Option jedes Vorfalls und für den Verfall schreiben**

In `test/musicEvents.test.js` vor der Abschlusszeile einfügen:

```js
  /** Legt einen offenen Musik-Vorfall an, ohne zu würfeln. */
  function openMusic(U, kind, now) {
    return db.insertEvent({
      guildId: G, userId: U, kind, platform: 'music',
      createdAt: now, expiresAt: now + decisions.DECIDE_MS,
    });
  }
  const first = () => 0;          // erster Ausgang der Option
  const last = () => 0.999;       // letzter Ausgang

  console.log('\n--- Jede Option jedes Vorfalls wirkt am Künstler ---');
  {
    const now = Date.now();
    const H = 100_000;
    const rel = (U) => music.status(G, U, now).releaseMs;
    const shw = (U) => music.status(G, U, now).showMs;

    // plagiat
    {
      const U = await artist({ listeners: H, songs: 4 });
      const perDay = music.royaltyPerDay(H, music.marketOf(G, U));
      cash = 0; bookings = 0;
      let ev = openMusic(U, 'plagiat', now);
      let r = await decisions.choose(G, U, ev.id, 'anwalt', now, first);
      check('plagiat/anwalt: -3 Tage Tantiemen', r.ok && cash < 0
        && Math.abs(cash) >= 3 * perDay * 0.99 && Math.abs(cash) <= 3 * perDay * 2.0,
        `${de(cash)} bei ${de(perDay)}/Tag`);
      check('… genau eine Buchung (§9)', bookings === 1, String(bookings));

      ev = openMusic(U, 'plagiat', now + 1);
      const hypeVor = db.getArtist(G, U).hype;
      r = await decisions.choose(G, U, ev.id, 'antworten', now + 1, first);
      check('plagiat/antworten (gut): Hype × 1,15',
        Math.abs(db.getArtist(G, U).hype - Math.min(music.HYPE_MAX, hypeVor * 1.15)) < 1e-9);

      ev = openMusic(U, 'plagiat', now + 2);
      const vor = db.getArtist(G, U).listeners;
      r = await decisions.choose(G, U, ev.id, 'ignorieren', now + 2, last);
      const nach = db.getArtist(G, U).listeners;
      check('plagiat/ignorieren (schlecht): Hörer −12 % (× Härte)',
        nach < vor && nach >= vor * (1 - 0.12 * decisions.SEVERITY_MAX) - 1
        && nach <= vor * 0.88 + 1, `${de(vor)} -> ${de(nach)}`);
    }

    // skandal
    {
      const U = await artist({ listeners: H, songs: 0 });
      let ev = openMusic(U, 'skandal', now);
      let vor = db.getArtist(G, U);
      await decisions.choose(G, U, ev.id, 'entschuldigen', now, first);
      let nach = db.getArtist(G, U);
      check('skandal/entschuldigen: −5 % Hörer und Hype × 0,9',
        nach.listeners < vor.listeners && nach.hype < vor.hype);

      ev = openMusic(U, 'skandal', now + 1);
      vor = db.getArtist(G, U);
      await decisions.choose(G, U, ev.id, 'gegenangriff', now + 1, first);
      nach = db.getArtist(G, U);
      check('skandal/gegenangriff (gut): Hype × 1,2, Hörer unverändert',
        nach.hype > vor.hype && nach.listeners === vor.listeners);

      ev = openMusic(U, 'skandal', now + 2);
      vor = db.getArtist(G, U);
      await decisions.choose(G, U, ev.id, 'aussitzen', now + 2, last);
      nach = db.getArtist(G, U);
      check('skandal/aussitzen (schlecht): −15 % Hörer',
        nach.listeners <= vor.listeners * 0.85 + 1, `${de(vor.listeners)} -> ${de(nach.listeners)}`);
    }

    // stimme
    {
      const U = await artist({ listeners: H });
      let ev = openMusic(U, 'stimme', now);
      await decisions.choose(G, U, ev.id, 'absagen', now, first);
      check('stimme/absagen: 7 Tage Konzertsperre',
        shw(U) > 6.9 * DAY_MS && shw(U) <= 7 * DAY_MS, de(shw(U) / DAY_MS));

      ev = openMusic(U, 'stimme', now + 1);
      const vor = db.getArtist(G, U);
      await decisions.choose(G, U, ev.id, 'playback', now + 1, first);
      check('stimme/playback (gut): keine Folgen',
        db.getArtist(G, U).listeners === vor.listeners && db.getArtist(G, U).hype === vor.hype);

      ev = openMusic(U, 'stimme', now + 2);
      await decisions.choose(G, U, ev.id, 'durchziehen', now + 2, last);
      check('stimme/durchziehen (schlecht): Hörer weg',
        db.getArtist(G, U).listeners < vor.listeners);
    }

    // album_leak
    {
      const U = await artist({ listeners: H, songs: 6 });
      let ev = openMusic(U, 'album_leak', now);
      const relVor = db.getArtist(G, U).releases;
      const r = await decisions.choose(G, U, ev.id, 'sofort', now, first);
      const a = db.getArtist(G, U);
      check('album_leak/sofort: ein Release entsteht, alle Titel weg',
        a.releases === relVor + 1 && a.songs === 0 && r.effect.published?.ok === true,
        `releases ${relVor} -> ${a.releases}, songs ${a.songs}`);
      check('… mit Publikum × 0,7 (Faktor durchgereicht)',
        r.effect.published.audienceFactor === 0.7, String(r.effect.published?.audienceFactor));

      const V = await artist({ listeners: H, songs: 4 });
      ev = openMusic(V, 'album_leak', now);
      await decisions.choose(G, V, ev.id, 'neu', now, first);
      check('album_leak/neu: alle Titel weg, Hype × 1,1',
        db.getArtist(G, V).songs === 0 && db.getArtist(G, V).hype > 1);

      const W = await artist({ listeners: H, songs: 4 });
      ev = openMusic(W, 'album_leak', now);
      await decisions.choose(G, W, ev.id, 'ignorieren', now, first);
      check('album_leak/ignorieren (gut): die Hälfte bleibt', db.getArtist(G, W).songs === 2);
    }

    // label
    {
      const U = await artist({ listeners: H, songs: 2, land: 'jp' });
      const c = db.insertContract({
        guildId: G, userId: U, kind: 'idol', agency: 'Test Ent.', country: 'jp',
        createdAt: now, expiresAt: now + DAY_MS,
      });
      db.setContractStatus(G, c.id, 'active', { signedAt: now, endsAt: now + 90 * DAY_MS });
      let ev = openMusic(U, 'label', now);
      await decisions.choose(G, U, ev.id, 'nachgeben', now, first);
      check('label/nachgeben: 7 Tage Release-Sperre',
        rel(U) > 6.9 * DAY_MS && rel(U) <= 7 * DAY_MS, de(rel(U) / DAY_MS));

      ev = openMusic(U, 'label', now + 1);
      cash = 0; bookings = 0;
      const r = await decisions.choose(G, U, ev.id, 'durchziehen', now + 1, last);
      check('label/durchziehen (schlecht): Vertrag geplatzt, Strafe gebucht',
        !music.contractOf(G, U) && db.getContract(G, c.id).status === 'broken'
        && cash < 0 && bookings === 1 && r.effect.contract,
        `status ${db.getContract(G, c.id).status}, ${de(cash)}, ${bookings} Buchungen`);
    }
  }

  console.log('\n--- Verfall bestraft ---');
  {
    const now = Date.now();
    const U = await artist({ listeners: 100_000 });
    const ev = openMusic(U, 'plagiat', now);
    const vor = db.getArtist(G, U).listeners;
    const gone = await decisions.settle(G, U, now + decisions.DECIDE_MS + 1);
    const nach = db.getArtist(G, U).listeners;
    // Härte bei 100.000 Hörern: 1 + 100000/3000000 × 0,6 = 1,02; × 1,6 Ignorieren = 1,632
    const erwartet = Math.round(vor * (1 - 0.12 * decisions.severityFor(100_000) * decisions.IGNORE_PENALTY));
    check('ein verfallener Vorfall wird abgerechnet', gone.length === 1 && gone[0].decision.id === 'plagiat');
    check('… mit Faktor 1,6 auf den Verlust', nach === erwartet, `${de(vor)} -> ${de(nach)}, erwartet ${de(erwartet)}`);
    check('danach ist nichts mehr offen', decisions.pending(G, U, now + decisions.DECIDE_MS + 2) === null);
    check('er steht in der Historie', decisions.history(G, U, 1)[0]?.status === 'expired');
  }
```

- [ ] **Step 2: Tests laufen lassen – sie müssen scheitern**

```bash
rm -rf .testdata && DATA_DIR=.testdata node test/musicEvents.test.js
```

Erwartet: die neuen Prüfungen ❌ (heute wendet `apply` Musik-Wirkungen auf Creator-Zeilen an – Hörer bleiben unverändert).

- [ ] **Step 3: `music.publish` bekommt Optionen `force` und `audience`**

In `src/music.js` die Signatur von `publish` (Zeile 451) ändern:

```js
function publish(guildId, userId, typeId, now = Date.now(), random = Math.random,
  { events = true, force = false, audience: audienceFactor = 1 } = {}) {
```

Die Sperr- und Zeitprüfung darunter ersetzen:

```js
  // `force`: eine erzwungene Veröffentlichung (Vorfall „Album im Netz") kennt
  // weder Sperre noch Zeitbudget – das Material ist ohnehin schon draußen.
  const left = force ? 0 : remainingMs(row, 'last_release_at', RELEASE_COOLDOWN_MIN, now);
  if (left > 0) return { ok: false, reason: 'cooldown', remainingMs: left, release: type };

  const time = force ? { ok: true, forced: true } : useTime(guildId, userId, type.time, now);
  if (!time.ok) return { ok: false, reason: 'no_time', need: type.time, release: type, ...time };
```

Den Aufruf von `simulateRelease` ändern:

```js
  const sim = simulateRelease(row, {
    type, genre: g, persona: p, market, idol,
    idleDays: idleDays(row.touched_at || row.last_action_at, now), random,
    audienceFactor,
  });
```

`simulateRelease` (Zeile 408) nimmt den Faktor entgegen – Signatur:

```js
function simulateRelease(state, {
  type, genre: g, persona: p, market, idol = null,
  idleDays: idle = 0, random = Math.random, audienceFactor = 1,
}) {
```

und im Schritt 2:

```js
  const audience = Math.max(1, Math.round(
    reachOf(startListeners, market) * roll * state.hype * g.reach * type.spike * audienceFactor));
```

Im Rückgabeobjekt von `publish` ergänzen: `audienceFactor,` (direkt nach `audience, gained, lost, …`). Der Parameter `events` wird in dieser Task noch nicht benutzt – Task 5 hängt den Würfel daran.

- [ ] **Step 4: `applyMusic` schreiben und `apply` verzweigen**

In `src/decisions.js` die Signatur von `apply` ändern und ganz oben in der Funktion verzweigen:

```js
async function apply(guildId, userId, row, effect, now = Date.now(), ignored = false,
  random = Math.random) {
  if (row.platform === 'music') return applyMusic(guildId, userId, row, effect, now, ignored, random);
  const creator = require('./creator');
```

Direkt **vor** `apply` einfügen:

```js
/**
 * Wendet eine Musik-Wirkung an – nur auf die Künstlerzeile, nie auf Kanäle.
 *
 * Reihenfolge: erst alles, was synchron in die Künstlerzeile geht (§7), dann
 * Ausrüstung, dann die erzwungene Veröffentlichung, dann das, was bucht
 * (Vertragsbruch ODER Geld – nie beides, siehe Katalogtest, §9).
 *
 * Verluste werden wie beim Creator verstärkt: Härte nach Größe, × 1,6 bei
 * Schweigen, × 2 unter Idol-Vertrag. Gewinne nicht.
 */
async function applyMusic(guildId, userId, row, effect, now, ignored, random) {
  const music = require('./music');
  const artist = db.getArtist(guildId, userId, now);
  const market = music.marketOf(guildId, userId);
  const contract = music.contractOf(guildId, userId);
  const weight = severityFor(artist.listeners)
    * (ignored ? IGNORE_PENALTY : 1)
    * (contract ? music.IDOL.scandalFactor : 1);
  const scaled = (v) => (v < 0 ? v * weight : v);
  const done = {
    listeners: 0, songs: 0, cash: 0, hype: effect.hype ?? 0,
    lockRelease: 0, lockShow: 0, gear: null, contract: null, published: null,
  };

  // --- Künstlerzeile: ein synchroner Schreibvorgang ---
  const next = { ...artist };
  if (effect.listeners) {
    next.listeners = Math.max(0, Math.round(artist.listeners * (1 + scaled(effect.listeners))));
    done.listeners = next.listeners - artist.listeners;
  }
  if (effect.songsShare) {
    // Anteil, nicht verstärkt: mehr als „alle weg" gibt es nicht.
    next.songs = Math.max(0, Math.round(artist.songs * (1 + Math.max(-1, effect.songsShare))));
    done.songs = next.songs - artist.songs;
  }
  if (effect.hype) {
    next.hype = clamp(music.HYPE_MIN, music.HYPE_MAX, artist.hype * effect.hype);
  }
  // Sperren: der Zeitstempel wird so weit vorgeschoben, dass die Restzeit
  // genau `Tage` beträgt (remainingMs = at + Sperre − now).
  if (effect.lockRelease) {
    next.last_release_at = now + effect.lockRelease * DAY_MS - music.RELEASE_COOLDOWN_MIN * 60_000;
    done.lockRelease = effect.lockRelease;
  }
  if (effect.lockShow) {
    next.last_show_at = now + effect.lockShow * DAY_MS - music.SHOW_COOLDOWN_MIN * 60_000;
    done.lockShow = effect.lockShow;
  }
  db.saveArtist(guildId, userId, next);

  // --- Ausrüstung ---
  if (effect.gear && db.consumeNamed(guildId, userId, music.GEAR)) done.gear = music.GEAR;

  // --- Erzwungene Veröffentlichung: alles Aufgenommene, sofort ---
  if (effect.publish) {
    const a = db.getArtist(guildId, userId, now);
    const type = a.songs >= 6 ? 'album' : a.songs >= 3 ? 'ep' : 'single';
    const res = music.publish(guildId, userId, type, now, random,
      { events: false, force: true, audience: effect.audience ?? 1 });
    if (res.ok) {
      done.published = res;
      // Was das Release nicht verbraucht hat, ist trotzdem draußen.
      const after = db.getArtist(guildId, userId, now);
      db.saveArtist(guildId, userId, { ...after, songs: 0 });
    }
  }

  // --- Vertragsbruch: bucht die Strafe selbst (genau eine Buchung) ---
  if (effect.contract === 'break' && contract) {
    const res = await music.leave(guildId, userId, now);
    if (res.ok) {
      done.contract = res.contract;
      done.cash = -res.penalty;
      done.balance = res.balance;
    }
  }

  // --- Geld: in Tagen Tantiemen, genau eine Buchung ---
  if (effect.cash) {
    const perDay = music.royaltyPerDay(artist.listeners, market);
    const days = effect.cash < 0 ? scaled(effect.cash) : effect.cash;
    const amount = require('./perks').payout(guildId, userId, Math.round(days * perDay));
    if (amount !== 0) {
      const title = decision(row.kind)?.title ?? 'Vorfall';
      done.cash = amount;
      done.balance = await changeCash(guildId, userId, amount, `Vorfall: ${title}`)
        .catch(() => null);
    }
  }

  return done;
}
```

In `choose` den `apply`-Aufruf ändern:

```js
  const done = await apply(guildId, userId, row, outcome, now, false, random);
```

(`expire` bleibt: `apply(guildId, userId, row, d.expire, now, true)` – der Standard-Würfel reicht dort.)

Export ergänzen: `applyMusic,` nach `apply,`.

- [ ] **Step 5: Von Hand nachrechnen, bevor der Test läuft**

Verfall-Test: `severityFor(100_000) = 1 + 100000/3000000 × 0,6 = 1,02`. Gewicht = 1,02 × 1,6 = 1,632. Verlust = 0,12 × 1,632 = 0,19584. Bei 100.000 Hörern: `round(100000 × 0,80416) = 80.416`. Der Test erwartet genau diesen Wert; wenn er abweicht, ist die Formel falsch, nicht der Test.

- [ ] **Step 6: Tests laufen lassen – grün**

```bash
rm -rf .testdata && DATA_DIR=.testdata node test/musicEvents.test.js && DATA_DIR=.testdata node test/decisions.test.js && DATA_DIR=.testdata node test/music.test.js
```

Erwartet: alle ✅ in allen drei Dateien. Bei „ein verfallener Vorfall … Faktor 1,6": Ausgabe `100.000 -> 80.416`.

- [ ] **Step 7: Commit**

```bash
git add src/decisions.js src/music.js test/musicEvents.test.js
git commit -m "$(printf 'vorfaelle: musik-zweig in apply – hoerer, titel, sperren, vertrag, tantiemen\n\nCo-Authored-By: Claude Opus 5 <noreply@anthropic.com>')"
```

---

### Task 4: Die zwölf leichten Ereignisse und der Würfel

**Files:**
- Create: `src/data/musicEvents.js`
- Modify: `src/music.js` (neue Funktion `rollMusicEvent`, Export)
- Test: `test/musicEvents.test.js`

**Interfaces:**
- Produces: `MUSIC_EVENTS` (Array, erster Eintrag `none` mit Gewicht 110), `candidates(action, risk)` → `[{ event, weight }]` in Listenreihenfolge; `music.rollMusicEvent(action, genre, random)` → Ereignisobjekt (bei `none`: `{ id: 'none', text: null }`). `music.NO_EVENT` = das `none`-Objekt.

- [ ] **Step 1: Tests für Würfel und Genre-Risiko schreiben**

In `test/musicEvents.test.js` bei den Imports ergänzen:

```js
const { MUSIC_EVENTS, candidates } = require('../src/data/musicEvents');
```

Vor der Abschlusszeile einfügen:

```js
  console.log('\n--- Leichte Ereignisse: jedes feuert ---');
  {
    check('zwölf Ereignisse plus none', MUSIC_EVENTS.length === 13, String(MUSIC_EVENTS.length));
    check('none steht vorn mit Gewicht 110',
      MUSIC_EVENTS[0].id === 'none' && MUSIC_EVENTS[0].weight === 110);
    const KEYS = new Set(['id', 'weight', 'on', 'risky', 'text',
      'songs', 'breaks', 'hype', 'audience', 'pay', 'gain']);
    const strays = MUSIC_EVENTS.flatMap((e) => Object.keys(e).filter((k) => !KEYS.has(k)).map((k) => `${e.id}.${k}`));
    check('keine unbekannten Felder', strays.length === 0, strays.join(' '));
    check('jedes Ereignis außer none hat Text und genau eine Aktion',
      MUSIC_EVENTS.slice(1).every((e) => e.text && Array.isArray(e.on) && e.on.length === 1));

    const pop = music.genre('pop');
    for (const action of ['record', 'publish', 'show']) {
      const counts = {};
      const rand = rng(11);
      for (let i = 0; i < 2000; i++) {
        const e = music.rollMusicEvent(action, pop, rand);
        counts[e.id] = (counts[e.id] ?? 0) + 1;
      }
      const ids = MUSIC_EVENTS.filter((e) => e.on?.includes(action)).map((e) => e.id);
      check(`${action}: vier Ereignisse (${ids.join(', ')})`, ids.length === 4);
      check(`${action}: jedes kommt mindestens 15-mal`,
        ids.every((id) => (counts[id] ?? 0) >= 15),
        ids.map((id) => `${id}=${counts[id] ?? 0}`).join(' '));
      check(`${action}: none ist die Mehrheit`,
        counts.none > 1000, `none=${counts.none}`);
      check(`${action}: kein fremdes Ereignis`,
        Object.keys(counts).every((id) => id === 'none' || ids.includes(id)),
        Object.keys(counts).join(' '));
    }
  }

  console.log('\n--- Das Genre-Risiko wirkt ---');
  {
    const risky = new Set(MUSIC_EVENTS.filter((e) => e.risky).map((e) => e.id));
    check('sechs riskante Ereignisse', risky.size === 6, [...risky].join(' '));
    const count = (genreId) => {
      const g = music.genre(genreId);
      const rand = rng(23);
      let hits = 0;
      for (const action of ['record', 'publish', 'show']) {
        for (let i = 0; i < 2000; i++) if (risky.has(music.rollMusicEvent(action, g, rand).id)) hits++;
      }
      return hits;
    };
    const hiphop = count('hiphop');
    const klassik = count('klassik');
    // Erwartung: 1,3 / 0,5 = 2,6 auf die Gewichte; durch das feste none-Gewicht
    // liegt das Verhältnis der Treffer etwas darunter. Spanne aus der Spec: 2–3.
    check('Hip-Hop trifft Pannen 2- bis 3-mal so oft wie Klassik',
      hiphop / klassik >= 2 && hiphop / klassik <= 3,
      `${hiphop} / ${klassik} = ${(hiphop / klassik).toFixed(2)}`);
    check('candidates() liefert die Gewichte, mit denen gewürfelt wird',
      candidates('record', 1.3).find((c) => c.event.id === 'aufnahme').weight === 7 * 1.3
      && candidates('record', 1.3).find((c) => c.event.id === 'flow').weight === 7);
  }
```

- [ ] **Step 2: Tests laufen lassen – sie müssen scheitern**

```bash
rm -rf .testdata && DATA_DIR=.testdata node test/musicEvents.test.js
```

Erwartet: `Cannot find module '../src/data/musicEvents'`.

- [ ] **Step 3: Datendatei schreiben**

`src/data/musicEvents.js`:

```js
/**
 * ===========================================================================
 *  LEICHTE EREIGNISSE DER MUSIKKARRIERE
 * ===========================================================================
 *
 * Das Gegenstück zu EVENTS in data/creator.js: an jeder Aktion gewürfelt,
 * wirkt sofort, kein Klick. Vier je Aktion, je zwei gut und zwei schlecht.
 * Der Ausschlag ist bewusst größer als beim Creator – die Musik soll die
 * schwerere Karriere sein.
 *
 *   on       die Aktion, an der das Ereignis hängt: record | publish | show
 *   risky    Gewicht wird mit dem Genre-Risiko multipliziert (Hip-Hop 1,3,
 *            Klassik 0,5) – das Feld `risk` in data/music.js war bis hierher
 *            nirgends ausgewertet
 *   songs    Studio: ersetzt das +1 (2 beim Flow, 0 bei kaputter Aufnahme)
 *   breaks   Studio: die Ausrüstung geht kaputt
 *   hype     Faktor auf die Form
 *   audience Release: Faktor auf das Publikum, wirkt vor der Konversion
 *   pay      Konzert: Faktor auf die Gage VOR der Buchung (0 = keine Buchung)
 *   gain     Konzert: Faktor auf die neuen Hörer
 */

const MUSIC_EVENTS = [
  { id: 'none', weight: 110, text: null },

  // ------------------------------------------------------------- Studio
  { id: 'flow', weight: 7, on: ['record'], songs: 2,
    text: '🌊 Der Flow war da. Zwei Songs statt einem, und beide sitzen.' },
  { id: 'geistesblitz', weight: 6, on: ['record'], hype: 1.15,
    text: '💡 Eine Idee, die du seit Wochen gesucht hast. Plötzlich passt alles.' },
  { id: 'aufnahme', weight: 7, on: ['record'], songs: 0, risky: true,
    text: '🗑️ Die Aufnahme ist hin. Drei Stunden für nichts.' },
  { id: 'equipment', weight: 3, on: ['record'], songs: 0, breaks: true, risky: true,
    text: '💥 Mitten im Take gibt das Setup auf. Kein Song, kein Setup.' },

  // ------------------------------------------------------------ Release
  { id: 'hit', weight: 4, on: ['publish'], audience: 3.0, hype: 1.25,
    text: '🚀 Das Ding läuft. Überall. Leute, die dich nie gehört haben, singen mit.' },
  { id: 'radio', weight: 6, on: ['publish'], audience: 1.8, hype: 1.2,
    text: '📻 Ein Sender hat dich in die Rotation genommen. Autofahrer kennen dich jetzt.' },
  { id: 'flop', weight: 7, on: ['publish'], audience: 0.4, risky: true,
    text: '🪦 Niemand hat es bemerkt. Passiert.' },
  { id: 'algorithmus', weight: 6, on: ['publish'], audience: 0.6, risky: true,
    text: '🤖 Die Playlist-Kuratoren hatten heute andere Favoriten.' },

  // ------------------------------------------------------------ Konzert
  { id: 'ausverkauft', weight: 6, on: ['show'], pay: 1.6, gain: 1.5,
    text: '🎟️ Ausverkauft. Die Halle vibriert, bevor du überhaupt auf der Bühne bist.' },
  { id: 'gastauftritt', weight: 5, on: ['show'], pay: 1.3, hype: 1.2,
    text: '🤝 Jemand Großes kam auf die Bühne. Das Video davon läuft schon.' },
  { id: 'ton', weight: 6, on: ['show'], pay: 0.6, hype: 0.9, risky: true,
    text: '🔇 Tonprobleme. Die erste halbe Stunde war ein Brummen.' },
  { id: 'abgesagt', weight: 3, on: ['show'], pay: 0, gain: 0, risky: true,
    text: '🚫 Abgesagt – Halle, Wetter, irgendwas. Die Zeit ist trotzdem weg.' },
];

/**
 * Die Kandidaten einer Aktion mit ihren Gewichten. Aus derselben Funktion
 * ziehen der Würfel und die Tests – so lässt sich ein bestimmtes Ereignis
 * mit einer festen Zufallszahl erzwingen.
 */
function candidates(action, risk = 1) {
  return MUSIC_EVENTS
    .filter((e) => !e.on || e.on.includes(action))
    .map((e) => ({ event: e, weight: e.risky ? e.weight * risk : e.weight }));
}

module.exports = { MUSIC_EVENTS, candidates };
```

- [ ] **Step 4: Würfel in `music.js`**

In `src/music.js` nach `const data = require('./data/music');` (Kopf der Datei) ergänzen:

```js
const { candidates, MUSIC_EVENTS } = require('./data/musicEvents');
```

Nach `hasGear` (Zeile ~365) einfügen:

```js
/** Das Nicht-Ereignis – damit Aufrufer nie auf null prüfen müssen. */
const NO_EVENT = MUSIC_EVENTS[0];

/**
 * Würfelt ein leichtes Ereignis; riskante Genres ziehen die Pannen an.
 * Kopie von creator.rollEvent mit `genre.risk` statt `fmt.risk`.
 */
function rollMusicEvent(action, g, random = Math.random) {
  const list = candidates(action, g?.risk ?? 1);
  const total = list.reduce((s, c) => s + c.weight, 0);
  let roll = random() * total;
  for (const c of list) {
    if (roll < c.weight) return c.event;
    roll -= c.weight;
  }
  return NO_EVENT;
}
```

Export ergänzen: `MUSIC_EVENTS, NO_EVENT, rollMusicEvent,` in `module.exports` (z. B. nach `GENRE_SWITCH_LOSS, REVEAL_BUZZ, REVEAL_GROWTH,`).

- [ ] **Step 5: Einen Einzelfall von Hand prüfen**

`candidates('record', 1.3)`: flow 7, geistesblitz 6, aufnahme 7×1,3 = 9,1, equipment 3×1,3 = 3,9, none 110 → Summe 136. Für Pop: 133, `equipment` = 3/133 = 2,26 % → bei 2.000 Würfen ≈ 45 Treffer. Das ist die Grundlage der Untergrenze 15 im Test.

- [ ] **Step 6: Tests laufen lassen – grün**

```bash
rm -rf .testdata && DATA_DIR=.testdata node test/musicEvents.test.js
```

Erwartet: alle ✅. Die Ausgabe zu „Hip-Hop trifft Pannen …" zeigt ein Verhältnis zwischen 2 und 3 – **die Zahl notieren**; liegt sie außerhalb, ist der Würfel falsch, nicht die Spanne.

- [ ] **Step 7: Commit**

```bash
git add src/data/musicEvents.js src/music.js test/musicEvents.test.js
git commit -m "$(printf 'musik: zwoelf leichte ereignisse und der wuerfel ueber das genre-risiko\n\nCo-Authored-By: Claude Opus 5 <noreply@anthropic.com>')"
```

---

### Task 5: Andockpunkte in `record`, `publish`, `show` und der Vorfall-Würfel

**Files:**
- Modify: `src/music.js` (`record` ~372, `publish` ~451, `show` ~527, `status` ~745)
- Test: `test/musicEvents.test.js`

**Interfaces:**
- Consumes: `rollMusicEvent`, `NO_EVENT` (Task 4), `decisions.roll(…, 'music')` (Task 2).
- Produces: `record(guildId, userId, now, random, { events = true } = {})`, `show(guildId, userId, now, random, { events = true } = {})`, `publish` wie Task 3. Jede erfolgreiche Rückgabe hat `event: { id, text } | null` und `incident: row | null`. `status()` hat `incident` (der offene Vorfall mit Vorlage oder `null`). **Der Ereigniswürfel ist der erste `random()`-Aufruf der Aktion.**

- [ ] **Step 1: Tests schreiben (Wirkungen im Zustand, keine Nullbuchung, Vorfall auffindbar)**

Vor der Abschlusszeile einfügen:

```js
  /** Zufallszahl, die bei dieser Aktion und diesem Genre genau `id` trifft. */
  function forceValue(action, g, id) {
    const list = candidates(action, g.risk);
    const total = list.reduce((s, c) => s + c.weight, 0);
    let before = 0;
    for (const c of list) {
      if (c.event.id === id) return (before + c.weight / 2) / total;
      before += c.weight;
    }
    throw new Error(`kein Ereignis ${id} bei ${action}`);
  }
  const pop = music.genre('pop');

  console.log('\n--- Jede leichte Wirkung landet im Zustand ---');
  {
    const t0 = new Date(new Date().setHours(6, 0, 0, 0)).getTime() + DAY_MS;

    // Studio
    {
      const U = await artist({ listeners: 50_000 });
      // Ein Studio-Tag kostet 3 von 8 Zeiteinheiten, das Budget gilt je
      // Kalendertag – deshalb ein Tag Abstand zwischen den Sessions.
      const tag = (k) => t0 + k * DAY_MS;
      let r = music.record(G, U, tag(0), seq(forceValue('record', pop, 'flow')));
      check('flow: zwei Songs', r.ok && r.songs === 2 && r.event?.id === 'flow', JSON.stringify(r.event ?? r));
      r = music.record(G, U, tag(1), seq(forceValue('record', pop, 'aufnahme')));
      check('aufnahme: kein Song, aber Zeit verbraucht',
        r.ok && r.songs === 2 && r.event?.id === 'aufnahme' && r.time.ok, JSON.stringify(r.event ?? r));
      const budgetVor = music.status(G, U, tag(2)).budget.left;
      r = music.record(G, U, tag(2), seq(forceValue('record', pop, 'equipment')));
      check('equipment: Setup weg, kein Song', r.ok && r.songs === 2 && !gear(U) && r.event?.id === 'equipment');
      check('… und die Zeit ist weg', music.status(G, U, tag(2)).budget.left === budgetVor - music.RECORD_TIME);
      refill(U);
      r = music.record(G, U, tag(3), seq(forceValue('record', pop, 'geistesblitz')));
      const hypeNach = db.getArtist(G, U).hype;
      check('geistesblitz: Hype gestiegen', r.ok && r.event?.id === 'geistesblitz' && hypeNach > 1);
      r = music.record(G, U, tag(4), seq(forceValue('record', pop, 'none')));
      check('none: ein Song, kein Ereignis', r.ok && r.songs === 3 && r.event === null);
      r = music.record(G, U, tag(5), seq(forceValue('record', pop, 'flow')), { events: false });
      check('events:false – kein Würfel, ein Song', r.ok && r.songs === 4 && r.event === null);
    }

    // Release: hit verdreifacht das Publikum gegenüber none bei gleichem Rest-Würfel.
    {
      const A = await artist({ listeners: 50_000, songs: 1 });
      const B = await artist({ listeners: 50_000, songs: 1 });
      const ra = music.publish(G, A, 'single', t0, seq(forceValue('publish', pop, 'none'), 0.5));
      const rb = music.publish(G, B, 'single', t0, seq(forceValue('publish', pop, 'hit'), 0.5));
      check('hit: Publikum × 3', ra.ok && rb.ok && rb.event?.id === 'hit'
        && Math.abs(rb.audience / ra.audience - 3) < 0.01, `${ra.audience} -> ${rb.audience}`);
      check('hit: Hype × 1,25 zusätzlich',
        Math.abs(db.getArtist(G, B).hype - Math.min(music.HYPE_MAX, db.getArtist(G, A).hype * 1.25)) < 1e-9);
      const C = await artist({ listeners: 50_000, songs: 1 });
      const rc = music.publish(G, C, 'single', t0, seq(forceValue('publish', pop, 'flop'), 0.5));
      check('flop: Publikum × 0,4', rc.ok && Math.abs(rc.audience / ra.audience - 0.4) < 0.01,
        `${ra.audience} -> ${rc.audience}`);
    }

    // Konzert
    {
      const A = await artist({ listeners: 50_000 });
      const B = await artist({ listeners: 50_000 });
      cash = 0; bookings = 0;
      const ra = await music.show(G, A, t0, seq(forceValue('show', pop, 'none'), 0.5));
      const geldA = cash;
      cash = 0; bookings = 0;
      const rb = await music.show(G, B, t0, seq(forceValue('show', pop, 'ausverkauft'), 0.5));
      check('ausverkauft: Gage × 1,6', ra.ok && rb.ok && Math.abs(rb.gross / ra.gross - 1.6) < 0.01,
        `${ra.gross} -> ${rb.gross}`);
      check('ausverkauft: neue Hörer × 1,5', Math.abs(rb.gained / ra.gained - 1.5) < 0.05,
        `${ra.gained} -> ${rb.gained}`);
      check('… gebucht wurde die Gage', cash === rb.amount && bookings === 1);

      const D = await artist({ listeners: 50_000 });
      cash = 0; bookings = 0;
      const showsVor = db.getArtist(G, D).shows;
      const rd = await music.show(G, D, t0, seq(forceValue('show', pop, 'abgesagt'), 0.5));
      check('abgesagt: keine Buchung (§ Nullbuchung)', rd.ok && rd.amount === 0 && bookings === 0,
        `${bookings} Buchungen, amount ${rd.amount}`);
      check('abgesagt: keine neuen Hörer, kein gezähltes Konzert',
        rd.gained === 0 && db.getArtist(G, D).shows === showsVor);
      check('abgesagt: Sperre und Zeit trotzdem verbraucht',
        music.status(G, D, t0 + 1).showMs > 0 && rd.time.ok);
    }
  }

  console.log('\n--- Der Vorfall ist auffindbar ---');
  {
    const t0 = new Date(new Date().setHours(6, 0, 0, 0)).getTime() + DAY_MS;
    const U = await artist({ listeners: 100_000, songs: 3 });
    check('ohne Vorfall: status().incident ist null', music.status(G, U, t0).incident === null);
    // Der Vorfall-Würfel ist der letzte random()-Aufruf: erst Ereignis (none),
    // dann Qualität, dann Vorfall (0 → trifft) und Auswahl (0 → erster).
    const r = music.record(G, U, t0, seq(forceValue('record', pop, 'none'), 0.5, 0, 0));
    check('eine Aktion kann einen Vorfall auslösen', r.ok && r.incident?.platform === 'music',
      JSON.stringify(r.incident));
    const s = music.status(G, U, t0 + 1);
    check('status().incident zeigt ihn mit Vorlage', s.incident?.decision?.id === r.incident.kind);
    const r2 = music.record(G, U, t0 + 7 * 3600e3, seq(forceValue('record', pop, 'none'), 0.5, 0, 0));
    check('solange einer offen ist, kommt kein zweiter', r2.ok && r2.incident === null);
    await decisions.choose(G, U, r.incident.id, s.incident.decision.options[0].id, t0 + 2, () => 0.5);
    check('danach ist incident wieder null', music.status(G, U, t0 + 3).incident === null);
  }
```

- [ ] **Step 2: Tests laufen lassen – sie müssen scheitern**

```bash
rm -rf .testdata && DATA_DIR=.testdata node test/musicEvents.test.js
```

Erwartet: „flow: zwei Songs" ❌ (`r.event` ist undefined, `songs` ist 1).

- [ ] **Step 3: `record` umbauen**

`src/music.js`, `record` – Signatur und Kern ersetzen:

```js
function record(guildId, userId, now = Date.now(), random = Math.random, { events = true } = {}) {
  const row = db.getArtist(guildId, userId, now);
  if (!row.genre || !row.persona) return { ok: false, reason: 'not_started' };
  if (!hasGear(guildId, userId)) {
    return { ok: false, reason: 'no_gear', gear: GEAR };
  }

  const left = remainingMs(row, 'last_record_at', RECORD_COOLDOWN_MIN, now);
  if (left > 0) return { ok: false, reason: 'cooldown', remainingMs: left };

  const time = useTime(guildId, userId, RECORD_TIME, now);
  if (!time.ok) return { ok: false, reason: 'no_time', need: RECORD_TIME, ...time };

  // Der Ereigniswürfel ist der ERSTE random()-Aufruf – so lässt sich ein
  // Ereignis im Test mit einer festen Zahlenfolge erzwingen.
  const g = genre(row.genre);
  const event = events ? rollMusicEvent('record', g, random) : NO_EVENT;
  const quality = 0.7 + random() * 0.7;
  const songs = row.songs + (event.songs ?? 1);
  db.saveArtist(guildId, userId, {
    ...row,
    songs,
    hype: clamp(HYPE_MIN, HYPE_MAX, (row.hype * 0.85 + quality * 0.15) * (event.hype ?? 1)),
    last_action_at: now, last_record_at: now, touched_at: now,
  });
  if (event.breaks) db.consumeNamed(guildId, userId, GEAR);

  // Zählt für den Titel im Profil – ein Song ist Arbeit, auch ohne Buchung.
  require('./activity').record(guildId, userId, 'music', now);

  // … und ob heute etwas passiert, das eine Entscheidung verlangt (§8: spät gebunden).
  const incident = events
    ? require('./decisions').roll(guildId, userId, row.listeners, now, random, 'music') : null;

  return {
    ok: true, songs, quality,
    event: event.id === 'none' ? null : { id: event.id, text: event.text },
    incident,
    text: pick(data.STUDIO, random), time,
  };
}
```

- [ ] **Step 4: `publish` umbauen**

Nach der Zeile `const idol = contract ? data.IDOL : null;` in `publish` einfügen:

```js
  // Der Ereigniswürfel ist der ERSTE random()-Aufruf (siehe record).
  const event = events ? rollMusicEvent('publish', g, random) : NO_EVENT;
```

und den `simulateRelease`-Aufruf so ändern, dass der Faktor beides enthält:

```js
    audienceFactor: audienceFactor * (event.audience ?? 1),
```

Beim `saveArtist` in `publish`: `hype: sim.hype,` ersetzen durch

```js
    hype: clamp(HYPE_MIN, HYPE_MAX, sim.hype * (event.hype ?? 1)),
```

Vor `require('./activity').record(guildId, userId, 'music', now);` einfügen:

```js
  const incident = events
    ? require('./decisions').roll(guildId, userId, listeners, now, random, 'music') : null;
```

Im Rückgabeobjekt ergänzen:

```js
    event: event.id === 'none' ? null : { id: event.id, text: event.text },
    incident,
```

- [ ] **Step 5: `show` umbauen**

Signatur:

```js
async function show(guildId, userId, now = Date.now(), random = Math.random, { events = true } = {}) {
```

Den Block von `const quality = …` bis zum `return` ersetzen:

```js
  // Der Ereigniswürfel ist der ERSTE random()-Aufruf (siehe record).
  const event = events ? rollMusicEvent('show', g, random) : NO_EVENT;
  const quality = 0.75 + random() * 0.6;
  const gross = Math.round(
    Math.pow(before.listeners, SHOW_EXP) * SHOW_PAY
    * market.scene * market.deal * g.live * p.live * quality
    * (idol ? idol.liveBonus : 1)
    * (event.pay ?? 1));

  // Ein Konzert bindet: Wer live gesehen hat, bleibt eher.
  const gained = Math.round(before.listeners * 0.02 * quality * (event.gain ?? 1));
  const cancelled = (event.pay ?? 1) === 0;

  db.saveArtist(guildId, userId, {
    ...row,
    shows: row.shows + (cancelled ? 0 : 1),
    listeners: before.listeners + gained,
    peak_listeners: Math.max(row.peak_listeners, Math.round(before.listeners + gained)),
    hype: clamp(HYPE_MIN, HYPE_MAX, (row.hype * 0.8 + quality * 0.3) * (event.hype ?? 1)),
    last_action_at: now, last_show_at: now, touched_at: now,
  });

  const incident = events
    ? require('./decisions').roll(guildId, userId, before.listeners + gained, now, random, 'music')
    : null;

  const cut = idol ? Math.round(gross * idol.cut) : 0;
  // Erst der Anteil der Agentur, dann der Level-Zuschlag auf das, was bleibt.
  const net = cancelled ? 0 : require('./perks').payout(guildId, userId, gross - cut);
  // Bei 0 wird nicht gebucht: Die UnbelievaBoat-API lehnt Nulländerungen ab.
  const balance = net !== 0
    ? await changeCash(guildId, userId, net, `Konzert: ${g.name}`, { kind: 'music' })
    : null;

  return {
    ok: true, gross, cut, amount: net, gained, quality, genre: g,
    event: event.id === 'none' ? null : { id: event.id, text: event.text },
    incident,
    text: pick(data.SHOWS, random), balance, time,
    listeners: Math.round(before.listeners + gained),
  };
```

- [ ] **Step 6: `status().incident`**

In `status` (Zeile ~745) im Rückgabeobjekt nach `hasGear: hasGear(guildId, userId),` ergänzen:

```js
    // Der offene Vorfall – egal welcher Domäne: Beide blockieren die Musik.
    incident: require('./decisions').pending(guildId, userId, now),
```

- [ ] **Step 7: Tests laufen lassen – grün, und die Nachbarn mit**

```bash
rm -rf .testdata && DATA_DIR=.testdata node test/musicEvents.test.js && DATA_DIR=.testdata node test/music.test.js && DATA_DIR=.testdata node test/creator.test.js && DATA_DIR=.testdata node test/decisions.test.js
```

Erwartet: alle ✅. **Achtung bei `music.test.js`:** Es simuliert Karrieren mit `Math.random` und prüft Gleichgewichte. Fällt dort eine Prüfung, ist die Ursache zu benennen (welche, welche Zahlen), nicht die Schwelle zu verschieben. Das Ergebnis gehört in den Bericht dieser Task.

- [ ] **Step 8: Commit**

```bash
git add src/music.js test/musicEvents.test.js
git commit -m "$(printf 'musik: ereignisse und vorfaelle an studio, release und konzert\n\nDer Ereigniswuerfel ist der erste random()-Aufruf jeder Aktion. Bei\nabgesagtem Konzert wird nicht gebucht (Nullaenderung).\n\nCo-Authored-By: Claude Opus 5 <noreply@anthropic.com>')"
```

---

### Task 6: Ansicht – Vorfälle sichtbar, Verfall beim Öffnen, Texte nach der Aktion

**Files:**
- Modify: `src/ui.js:1773-1905` (`buildMusicView`), `:2391-2445` (`buildDecisionView`)
- Modify: `src/buttons.js:199-219` (`settleMusic`), `:1741-1770` (`mstudio`), `:1782-1824` (`mpub`), `:1826-1850` (`mshow`), `:2075-2098` (`wahl`)
- Modify: `src/fluxer/commands.js:105-114` (`/musik`)

**Interfaces:**
- Consumes: `music.status().incident`, `res.event`, `res.incident` aus Task 5; `decisions.settle` (bestehend); `res.effect` aus `applyMusic` (Task 3).

Dieser Task hat keinen automatischen Test – die Ansichten werden im Projekt nicht getestet. Prüfung: `node -e "require('./src/ui'); require('./src/buttons'); require('./src/fluxer/commands')"` lädt ohne Fehler, plus die volle Testkette.

- [ ] **Step 1: `settleMusic` rechnet Vorfälle ab**

In `src/buttons.js`, `settleMusic`, nach dem Tantiemen-Block und vor `const contract = music.settleContracts(…)` einfügen:

```js
  // Abgelaufene Vorfälle wirken jetzt – sonst bliebe ein Musik-Vorfall für
  // jemanden, der die Creator-Seite nie öffnet, ewig offen und blockierte
  // jeden weiteren.
  for (const gone of await require('./decisions').settle(guildId, userId).catch(() => [])) {
    lines.push(`⚠️ **${gone.decision.emoji} ${gone.decision.title}** – du hast nicht ` +
      `reagiert.\n_${gone.outcome.text}_`);
  }
```

- [ ] **Step 2: Fluxer `/musik` ebenso**

In `src/fluxer/commands.js` im Eintrag `names: ['musik', …]` nach `music.settleContracts(guildId, userId);` einfügen:

```js
      await require('../decisions').settle(guildId, userId).catch(() => []);
```

- [ ] **Step 3: Hinweiszeile in `buildMusicView`**

In `src/ui.js`, `buildMusicView`, direkt vor `if (s.lostToIdle > 0) {` einfügen:

```js
  if (s.incident) {
    embed.addFields({
      name: '⚠️ Offener Vorfall',
      value: `**${s.incident.decision.emoji} ${s.incident.decision.title}** – noch ` +
        `**${require('./income').formatRemaining(s.incident.remainingMs)}**. ` +
        'Entscheiden im Menü *Vorfälle* (⚠️).',
    });
  }
```

Und in der zweiten Button-Zeile (`extra`) vor `extra.push(homeButton(userId));`:

```js
  if (s.incident) {
    extra.push(new ButtonBuilder().setCustomId(`vorfall|${userId}`)
      .setLabel('Vorfall').setEmoji('⚠️').setStyle(ButtonStyle.Danger));
  }
```

(`vorfall|<userId>` ist der bestehende Handler `buttons.vorfall` – zustandslos, §6.)

- [ ] **Step 4: 🎵 in `buildDecisionView`**

In `src/ui.js`, `buildDecisionView`, die Zeile `const platform = open.platform ? creator.platform(open.platform) : null;` ersetzen:

```js
  const isMusic = open.platform === 'music';
  const platform = !isMusic && open.platform ? creator.platform(open.platform) : null;
```

Den Titel und Footer des offenen Vorfalls anpassen:

```js
    .setTitle(`${isMusic ? '🎵 ' : ''}${d.emoji} ${d.title}`)
```

```js
    .setFooter({
      text: isMusic ? 'Betrifft deine Musik'
        : platform ? `Betrifft ${platform.name}` : 'Betrifft dein ganzes Netzwerk',
    });
```

Die Rückweg-Zeile des offenen Vorfalls (`rows.push(new ActionRowBuilder().addComponents(…'Netzwerk'…))`) ersetzen:

```js
  rows.push(new ActionRowBuilder().addComponents(
    isMusic
      ? new ButtonBuilder().setCustomId(ID.menu('musik', 1, userId))
        .setLabel('Studio').setEmoji('🎵').setStyle(ButtonStyle.Secondary)
      : new ButtonBuilder().setCustomId(ID.menu('creator', 1, userId))
        .setLabel('Netzwerk').setEmoji('📡').setStyle(ButtonStyle.Secondary),
    homeButton(userId)));
```

In der Historie (`for (const p of past)`) das 🎵 vor den Titel setzen:

```js
        name: `${p.platform === 'music' ? '🎵 ' : ''}${p.decision.emoji} ${p.decision.title}`,
```

- [ ] **Step 5: Ereignis- und Vorfalltexte nach den Aktionen**

`src/buttons.js`, `mstudio`, im `else`-Zweig nach der `note = …`-Zuweisung:

```js
      if (res.event) note += `\n${res.event.text}`;
      if (res.event?.id === 'equipment') note += `\n💥 Dein **${music.GEAR}** ist hin (🧰 Ausrüstung).`;
      if (res.incident) {
        const d = require('./decisions').decision(res.incident.kind);
        note += `\n⚠️ **${d?.emoji ?? ''} ${d?.title ?? 'Etwas ist passiert'}** – ` +
          'du musst dich entscheiden (⚠️ Vorfall).';
      }
```

`mpub`, im `else`-Zweig **vor** `note += '\n_Die Tantiemen kommen laufend, nicht sofort._';`:

```js
      if (res.event) note += `\n${res.event.text}`;
      if (res.incident) {
        const d = require('./decisions').decision(res.incident.kind);
        note += `\n⚠️ **${d?.emoji ?? ''} ${d?.title ?? 'Etwas ist passiert'}** – ` +
          'du musst dich entscheiden (⚠️ Vorfall).';
      }
```

`mshow`, den `else`-Zweig ersetzen:

```js
    } else if (res.amount === 0 && res.event) {
      note = `${res.event.text}\n_Keine Gage, kein Publikum – aber die Tour-Pause läuft._`;
    } else {
      note = `🎤 _${res.text}_\n💰 **${money(symbol, res.amount)}**` +
        (res.cut > 0 ? ` _(nach ${money(symbol, res.cut)} Agenturanteil)_` : '') +
        `\n👂 **+${res.gained.toLocaleString('de-DE')}** Hörer, die dich live gesehen haben.`;
      if (res.event) note += `\n${res.event.text}`;
    }
    if (res.ok && res.incident) {
      const d = require('./decisions').decision(res.incident.kind);
      note += `\n⚠️ **${d?.emoji ?? ''} ${d?.title ?? 'Etwas ist passiert'}** – ` +
        'du musst dich entscheiden (⚠️ Vorfall).';
    }
```

- [ ] **Step 6: Musik-Wirkungen im `wahl`-Text**

`src/buttons.js`, `wahl`, im `else`-Zweig nach `if (e.locked?.length) { … }` einfügen:

```js
      // Musik-Wirkungen (applyMusic) – die Felder gibt es nur dort.
      if (e.listeners) {
        parts.push(`${e.listeners > 0 ? '👂 +' : '📉 '}${e.listeners.toLocaleString('de-DE')} Hörer`);
      }
      if (e.songs) parts.push(`🎼 ${e.songs} Titel`);
      if (e.lockRelease) parts.push(`⛔ ${e.lockRelease} Tage kein Release`);
      if (e.lockShow) parts.push(`⛔ ${e.lockShow} Tage kein Konzert`);
      if (e.contract) parts.push(`📜 Vertrag mit ${e.contract.agency} geplatzt`);
      if (e.published?.ok) {
        parts.push(`💿 ${e.published.release.name} draußen, ` +
          `${e.published.audience.toLocaleString('de-DE')} haben reingehört`);
      }
```

- [ ] **Step 7: Laden und volle Kette**

```bash
node -e "require('./src/ui'); require('./src/buttons'); require('./src/fluxer/commands'); console.log('ok')" && npm test 2>&1 | tail -5
```

Erwartet: `ok`, und die Kette endet mit der Zusammenfassung von `musicEvents.test.js` ohne ❌ in der gesamten Ausgabe (`npm test 2>&1 | grep -c '❌'` → `0`).

- [ ] **Step 8: Commit**

```bash
git add src/ui.js src/buttons.js src/fluxer/commands.js
git commit -m "$(printf 'musik: vorfaelle in der ansicht, verfall beim oeffnen des studios\n\nCo-Authored-By: Claude Opus 5 <noreply@anthropic.com>')"
```

---

### Task 7: Karriere-Tests (Häufigkeit, §3-Messung) und die Vergleichsmessung

**Files:**
- Test: `test/musicEvents.test.js`
- Modify: `scripts/messung-geldquellen.js` (Vorfälle täglich entscheiden; Schalter `--ohne-ereignisse`)
- Modify: `src/data/patchnotes.js` (Eintrag 1.29.0)
- Modify: `docs/superpowers/specs/2026-09-09-geldquellen-balance-design.md` (Beschluss 22 ✅)

**Interfaces:**
- Consumes: alles aus Task 1–6.

- [ ] **Step 1: Karriere-Simulation und Tests 6 und 10 schreiben**

Vor der Abschlusszeile in `test/musicEvents.test.js` einfügen:

```js
  /**
   * Ein Jahr Karriere, Tagesroutine wie in scripts/messung-geldquellen.js:
   * abrechnen → Konzert-Tag (dann kein Studio) oder Studio + Release → Konzert
   * wenn möglich. Täglich `decisions.settle()`, und ein offener Vorfall wird
   * wie von einem Spieler entschieden: zufällige Option.
   *
   * Startet HEUTE 6:00 und läuft vorwärts (siehe messfehler-vermeiden.md).
   */
  async function jahr(U, seed, events) {
    const rand = rng(seed);
    const opts = { events };
    let now = new Date(new Date().setHours(6, 0, 0, 0)).getTime() + DAY_MS;
    let vorfaelle = 0;
    let zweiOffen = 0;
    let zuDicht = 0;
    let letzter = 0;
    for (let d = 0; d < 365; d++) {
      refill(U);
      await music.settle(G, U, now);
      music.settleContracts(G, U, now + 1e5);
      await decisions.settle(G, U, now + 1.5e5);
      const vor = music.status(G, U, now + 2e5);
      if (!(vor.showMs <= 0 && vor.listeners >= music.SHOW_MIN_LISTENERS)) {
        music.record(G, U, now + 2e5, rand, opts);
        const s = music.status(G, U, now + 1.2e6);
        if (s.songs >= 1 && s.releaseMs <= 0) {
          music.publish(G, U, s.songs >= 6 ? 'album' : s.songs >= 3 ? 'ep' : 'single', now + 2.2e6, rand, opts);
        }
      }
      const s = music.status(G, U, now + 3.2e6);
      if (s.showMs <= 0 && s.listeners >= music.SHOW_MIN_LISTENERS) {
        await music.show(G, U, now + 4e6, rand, opts);
      }
      const open = decisions.pending(G, U, now + 5e6);
      if (open) {
        vorfaelle++;
        if (open.created_at - letzter < decisions.MIN_GAP_MS && letzter) zuDicht++;
        letzter = open.created_at;
        const o = open.decision.options[Math.floor(rand() * open.decision.options.length)];
        await decisions.choose(G, U, open.id, o.id, now + 5e6, rand);
        // Nach dem Entscheiden darf nichts mehr offen sein – sonst waren es zwei.
        if (decisions.pending(G, U, now + 5.1e6)) zweiOffen++;
      }
      now += DAY_MS;
    }
    return {
      hoerer: Math.round(music.status(G, U, now).listeners),
      vorfaelle, zweiOffen, zuDicht,
    };
  }
  const medianOf = (xs) => { const s = [...xs].sort((a, b) => a - b); return s[Math.floor(s.length / 2)]; };

  console.log('\n--- Ein Jahr mit Ereignissen: Vorfälle kommen, aber nicht zu oft ---');
  console.log('\n--- §3-Messung: 5 Karrieren mit und ohne Ereignisse ---');
  {
    const mit = [], ohne = [], counts = [], countsOhne = [];
    for (let seed = 1; seed <= 5; seed++) {
      const A = await artist(); const ra = await jahr(A, seed, true);
      const B = await artist(); const rb = await jahr(B, seed, false);
      mit.push(ra.hoerer); ohne.push(rb.hoerer); counts.push(ra); countsOhne.push(rb);
      console.log(`    Seed ${seed}: mit ${de(ra.hoerer)} (${ra.vorfaelle} Vorfälle) · ohne ${de(rb.hoerer)}`);
    }
    const mMit = medianOf(mit), mOhne = medianOf(ohne);
    console.log(`    Median: mit ${de(mMit)} · ohne ${de(mOhne)} · Faktor ${(mMit / mOhne).toFixed(3)}`);

    check('ohne Ereignisse: alle 5 Läufe bringen Hörer (keine stille Null)', ohne.every((h) => h > 100_000), ohne.map(de).join(' '));
    check('ohne Ereignisse bleibt der Median in 500.000–700.000 (Beschluss 20)',
      mOhne >= 500_000 && mOhne <= 700_000, de(mOhne));
    check('ohne Ereignisse: kein Vorfall', countsOhne.every((c) => c.vorfaelle === 0),
      countsOhne.map((c) => c.vorfaelle).join(' '));
    check('mit Ereignissen: Median höchstens 10 % über ohne (§3)',
      mMit <= mOhne * 1.1, `${de(mMit)} vs ${de(mOhne)}`);
    check('mit Ereignissen: mindestens 10 Vorfälle im Jahr, in jedem Lauf',
      counts.every((c) => c.vorfaelle >= 10), counts.map((c) => c.vorfaelle).join(' '));
    check('… und höchstens 60', counts.every((c) => c.vorfaelle <= 60), counts.map((c) => c.vorfaelle).join(' '));
    check('nie zwei gleichzeitig offen', counts.every((c) => c.zweiOffen === 0));
    check('nie zwei innerhalb von 36 Stunden', counts.every((c) => c.zuDicht === 0), counts.map((c) => c.zuDicht).join(' '));
  }
```

- [ ] **Step 2: Laufen lassen und die Zahlen lesen**

```bash
rm -rf .testdata && DATA_DIR=.testdata node test/musicEvents.test.js 2>&1 | tail -25
```

Erwartet: Die fünf `Seed`-Zeilen zeigen Hörerzahlen in sechsstelliger Höhe auf beiden Seiten; „ohne" liegt nahe 581.796 (Referenz oben, gleiche Routine, aber die Tagesuhrzeiten weichen leicht ab – Abweichungen unter 5 % sind normal). Alle ✅.

**Wenn „mit" mehr als 10 % über „ohne" liegt:** Nicht die Schwelle ändern. Die Ursache messen (welches Ereignis, welcher Vorfall?) und im Bericht nennen; die Gewichte der Spec sind dann zu senken – vorzugsweise `hit` (Gewicht 4) oder `ausverkauft` `gain`. Das ist eine Entscheidung des Nutzers.

**Wenn ein Lauf unter 10 Vorfällen liegt:** Prüfen, ob `decisions.settle()`/`choose` wirklich täglich laufen (ein offener Vorfall blockiert alle weiteren). Das war die Falle in einer früheren Messung.

- [ ] **Step 3: Messskript – Vorfälle entscheiden, Schalter**

`scripts/messung-geldquellen.js`: oben bei den Konstanten (nach `const DAY = …` – per `grep -n "const DAY" scripts/messung-geldquellen.js` suchen) einfügen:

```js
/** `--ohne-ereignisse`: Musik ohne leichte Ereignisse und ohne Vorfälle (Vergleichsmessung, §3). */
const OHNE_EREIGNISSE = process.argv.includes('--ohne-ereignisse');
const musikOpts = { events: !OHNE_EREIGNISSE };
```

`process.argv`-Auswertung: `Number(process.argv[2] || 30)` und `[3]` funktionieren weiter, wenn der Schalter **hinter** den Zahlen steht: `node scripts/messung-geldquellen.js 30 365 --ohne-ereignisse`.

In `musiktag` die beiden Aufrufe ergänzen:

```js
  music.record(G, U, now, rand, musikOpts);
  …
    music.publish(G, U, s.songs >= 6 ? 'album' : s.songs >= 3 ? 'ep' : 'single', now + 2e6, rand, musikOpts);
```

In `karriere` den Konzert-Aufruf: `await music.show(G, U, now + 4e6, rand, musikOpts);`

Und in `karriere` nach `await creator.settleDeals(G, U, now + 20e6);` einfügen:

```js
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
```

Import oben ergänzen (bei den anderen `require('../src/…')`): `const decisions = require('../src/decisions');`

- [ ] **Step 4: Messung laufen lassen – beide Seiten**

```bash
node scripts/messung-geldquellen.js 30 365 --ohne-ereignisse 2>&1 | grep -A3 "Beste Strategie"
```

```bash
node scripts/messung-geldquellen.js 30 365 2>&1 | grep -A3 "Beste Strategie"
```

Erwartet: Zeile `Musik+Creator … Hörer` – „ohne" zwischen 500.000 und 700.000; „mit" höchstens 10 % darüber. **Beide Zahlen wörtlich in den Bericht.** Zusätzlich die Creator-Zeile beider Läufe: Sie darf sich zwischen den Läufen nur durch die jetzt entschiedenen Creator-Vorfälle unterscheiden (Musik → Creator ist Einbahnstraße; Musik-Ereignisse verändern Creator-Zahlen nur über den `SOCIAL_SPILL` der Releases).

- [ ] **Step 5: Patchnotes**

In `src/data/patchnotes.js` ganz oben im Array (vor `version: '1.28.0'`) einfügen:

```js
  {
    version: '1.29.0',
    date: '2026-09-11',
    title: '🎲 Die Musik wird unberechenbar',
    lines: [
      '🎵 **Zwölf Ereignisse im Studio, beim Release und auf der Bühne.** Ein Flow bringt zwei Songs, ein Hit verdreifacht das Publikum, ein Flop lässt es verpuffen, ein abgesagtes Konzert kostet die Zeit ohne Gage. Etwa jede vierte Aktion trifft eines.',
      '🎸 **Das Genre-Risiko zählt jetzt.** Hip-Hop zieht Pannen 1,3-mal so oft an wie Pop, Klassik halb so oft – die Zahl stand schon immer im Genre, jetzt tut sie etwas.',
      '⚠️ **Fünf Vorfälle mit Entscheidung:** Plagiatsvorwurf, ein altes Video (nur mit Gesicht), Stimme weg vor der Tour, Album im Netz, das Label will verschieben (nur mit Vertrag). Wer nicht reagiert, fährt schlechter – wie bei den Creator-Vorfällen. Zu finden unter ⚠️ Vorfall, auch direkt aus dem Studio.',
      '📏 **Gemessen, nicht geschätzt:** Ein Jahr durchgehend spielen bringt weiter 500.000–700.000 Hörer. Die Ereignisse verschieben den Median um weniger als 10 %.',
    ],
  },
```

Danach `DATA_DIR=.testdata node test/patchnotes.test.js` – grün.

- [ ] **Step 6: Beschluss 22 abhaken**

In `docs/superpowers/specs/2026-09-09-geldquellen-balance-design.md` bei Beschluss 22 ein ✅ setzen (Muster der anderen Beschlüsse) und die Statuszeile „Umgesetzt bis auf Beschluss 22" ersetzen durch „Alle 22 Beschlüsse umgesetzt (Beschluss 22: `2026-09-11-musik-ereignisse-design.md`)".

- [ ] **Step 7: Volle Kette**

```bash
npm test 2>&1 | grep -c '❌'; npm test 2>&1 | tail -3
```

Erwartet: `0` und die letzte Zusammenfassung ohne Fehler.

- [ ] **Step 8: Commit**

```bash
git add test/musicEvents.test.js scripts/messung-geldquellen.js src/data/patchnotes.js docs/superpowers/specs/2026-09-09-geldquellen-balance-design.md
git commit -m "$(printf 'musik-ereignisse: jahresmessung, vergleichslauf, patchnotes 1.29.0\n\nMedian ohne Ereignisse: <ZAHL> Hoerer, mit: <ZAHL> (Faktor <X>).\n\nCo-Authored-By: Claude Opus 5 <noreply@anthropic.com>')"
```

Die Platzhalter `<ZAHL>`/`<X>` sind mit den gemessenen Werten aus Step 4 zu füllen – **keine Schätzung**.

---

## Selbstprüfung des Plans

**Spec-Abdeckung:** Schicht 1 Liste → Task 4; Würfel/Genre-Risiko → Task 4; Andockpunkte und `pay = 0` → Task 5; Domäne in `roll` → Task 2; `apply`-Zweig, Vokabular, Tantiemen-Maß → Task 3; fünf Vorfälle mit Zulassung → Task 1 + 2; Ansicht (🎵, Hinweis, `settle` beim Öffnen) → Task 6; Tests 1–12 → 1/2/4 (Task 4), 3/11/12 (Task 5), 4/5 (Task 3), 6/10 (Task 7), 7/8 (Task 2), 9 (Task 2, Step 4); Messung `--ohne-ereignisse` → Task 7; Patchnotes → Task 7; Testkette → Task 1.

**Namen quer über die Tasks:** `MUSIC_DECISIONS` (Task 1, 2), `musicEligible` (2), `applyMusic` (3), `apply(…, random)` (3), `publish(…, { events, force, audience })` (3, 5, 7), `audienceFactor` in Rückgabe (3, Test in 3), `MUSIC_EVENTS`/`candidates` (4, 5), `rollMusicEvent`/`NO_EVENT` (4, 5), `record/show(…, { events })` (5, 7), `res.event`/`res.incident`/`status().incident` (5, 6), `done.published/contract/listeners/songs/lockRelease/lockShow` (3, 6).
