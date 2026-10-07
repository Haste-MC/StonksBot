# Beziehungen 6a: Gedächtnis und Haltung — Umsetzungsplan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Der Draht zu einem Kontakt wird aus zwei gespeicherten Achsen — Respekt und Vertrauen — abgeleitet; die Beziehung merkt sich, wie sie dahin kam, und trägt einen Namen.

**Architecture:** Zwei neue Spalten auf `contacts` tragen die Wahrheit, `draht` wird nur noch abgeleitet und ausschließlich in `db.saveContact` geschrieben. Die reine Hälfte von `src/contacts.js` bekommt die Arithmetik (Ableitung, Abkühlen mit Boden, Respekt-Gewicht, Beziehungsart), die zustandsbehaftete Hälfte eine `move`-Funktion, die alle bisherigen `moveDraht`-Aufrufer ersetzt. Eine gekappte Tabelle `contact_memory` erzählt die Geschichte, ohne an einer Rechnung beteiligt zu sein.

**Tech Stack:** Node.js, `node:sqlite` (synchron), discord.js (nur Ansicht), hauseigener Test-Harness (`check(label, ok, extra)`, Aufruf `DATA_DIR=.testdata node test/<x>.test.js`).

**Spec:** `docs/superpowers/specs/2026-10-07-beziehungen-design.md`

## Global Constraints

- **§3 Kein Geldrucker.** Keine neue Einnahmeart, kein neuer Multiplikator auf eine bestehende. `contacts.staerkeOf` und `contacts.boostOf` bleiben **unverändert** — die Höhe eines Schubs hängt am rohen Größenabstand, nie an der Beziehung.
- **§4 Faule Abrechnung.** Das Abkühlen wird beim Lesen gerechnet und **nie** geschrieben. Eine Leseoperation legt keine Zeile an.
- **§7 Synchron vor dem ersten `await`.** Achsen-Schreibvorgang und Gedächtniseintrag stehen synchron hintereinander, ohne `await` dazwischen. Das Projekt benutzt nirgends `db.transaction` — nicht damit anfangen.
- **§12 Tests ohne Netz**, gesäte Würfel.
- **Der Draht ist abgeleitet.** `Math.round((respekt + vertrauen) / 2)`. Er wird **ausschließlich** in `db.saveContact` geschrieben und von keiner anderen Stelle berechnet und gespeichert.
- **`d_respekt`/`d_vertrauen` in `contact_memory` werden NIE für eine Rechnung gelesen.** Nur Anzeige. Wer hier aggregiert, baut die Drift ein, die diese Trennung verhindert.
- **Achsen-Grenzen:** Respekt und Vertrauen je −100 … 100, `boden` 0 … 30. Jede Bewegung klemmt.
- **Eine Partner-Regel:** `respekt >= 50 && vertrauen >= 50`, gültig für ⭐, Antwortchance, Türöffner und `beef.js`. Kein zweiter Weg.
- **Alle Zahlenkonstanten stehen in `src/data/*.js`**, nie im Rechencode. Beef-Werte in `data/beef.js`, Angebots-Werte in `data/angebote.js`, alles übrige in `data/contacts.js`.
- **Sprache:** Benutzertexte deutsch, geschlechtsneutral, wo die Person unbekannt ist. Dezimaltrennzeichen Komma in jedem Text, den ein Spieler liest.
- **Zeilennummern in diesem Plan sind Wegweiser, keine Adressen.** Sie stammen vom Tag, an dem der Plan geschrieben wurde, und verschieben sich mit jeder vorangehenden Aufgabe — Task 2 hat allein in `src/contacts.js` 26 Zeilen eingefügt. **Verbindlich ist immer der Name** der Funktion, der Konstante oder des Textbausteins; such ihn mit `grep -n`, statt einer Nummer zu folgen. Steht an der genannten Nummer etwas anderes als beschrieben, ist die Nummer veraltet und nicht der Code falsch.

## Dateien

| Datei | Verantwortung | Tasks |
|---|---|---|
| `src/db.js` | Spalten, Wanderung, `contact_memory`, `saveContact`, `addMemory`, `memoryOf` | 1 |
| `src/data/contacts.js` | `ACHSEN`, Abkühlraten, Boden, Respekt-Gewicht, Art-Schwellen, Gedächtnistexte | 2 |
| `src/data/angebote.js` | fünf Achsenpaare, `BODEN_*`, `minVertrauen` in `ARTEN` | 4 |
| `src/data/beef.js` | fünf Achsenpaare | 5 |
| `src/contacts.js` | reine Arithmetik (T2), `move`, `request`, Antwortchance, `listFor`, `detail` (T3) | 2, 3 |
| `src/angebote.js` | Achsenpaare an fünf Stellen, Boden, Vertrauens-Tor, Gedächtnis | 4 |
| `src/beef.js` | Achsenpaare an sechs Stellen, Frieden auf Vertrauen, Partner-Regel | 5 |
| `src/ui.js` | `ARTEN_NAMEN`, dreizeiliger Kopf, Gedächtnisblock, `grundText` | 6 |
| `src/buttons.js` | Achsen-Deltas statt Stufenname in den Meldungen | 6 |
| `scripts/messung-geldquellen.js` | die zwei Nachbauten nachziehen, Messung fahren | 7 |
| `test/beziehungen.test.js` | **neu** — Arithmetik, Paritätstest, Arten, Partner-Regel, Gedächtnis | 1–5 |
| `test/contacts.test.js` | `drahtStufe`-Fälle auf `artOf` umstellen | 3 |
| `test/beef.test.js`, `test/angebote.test.js`, `test/fluxer-render.test.js` | `moveDraht` → `move` nachziehen | 4, 5, 6 |
| `ARCHITEKTUR.md`, `src/data/patchnotes.js` | §15-Eintrag, Patchnote | 7 |

---

## Task 1: Spalten, Wanderung und die Gedächtnistabelle

**Files:**
- Modify: `src/db.js` (Block `-------- KONTAKTE` ab Zeile 1033; Statements ab Zeile 2304; Funktionen ab Zeile 3822)
- Test: `test/beziehungen.test.js` (neu)

**Interfaces:**
- Consumes: nichts aus früheren Tasks.
- Produces:
  - `db.saveContact(guildId, userId, contactId, { respekt, vertrauen, boden, tries, yes, last_try, last_move, ignored_at })` — schreibt `draht` selbst als `Math.round((respekt + vertrauen) / 2)`
  - `db.addMemory(guildId, userId, contactId, { at, art, detail, dRespekt, dVertrauen }, max)` — fügt ein und kappt auf `max`
  - `db.memoryOf(guildId, userId, contactId, limit)` — neueste zuerst, Rohzeilen
  - `db.memoryCount(guildId, userId, contactId)` — Anzahl gespeicherter Zeilen

- [ ] **Step 1: Die drei Spalten und die Wanderung**

Direkt **nach** dem `db.exec(\`CREATE TABLE IF NOT EXISTS contacts …\`)`-Block in `src/db.js` einfügen (das Muster steht so schon bei `companies` in Zeile 609 und `creator_channels` in Zeile 846):

```js
// 6a: Respekt und Vertrauen sind die Wahrheit, `draht` nur noch ihr Mittelwert.
// Die Wanderung setzt beide auf den heutigen Draht – (d+d)/2 = d ohne Rundung,
// am Wanderungstag ist also jeder Draht unverändert. Sie hängt an den gerade
// angelegten Spalten und läuft darum genau einmal.
{
  const have = new Set(db.prepare('PRAGMA table_info(contacts)').all().map((c) => c.name));
  const spalten = {
    respekt: 'INTEGER NOT NULL DEFAULT 0',
    vertrauen: 'INTEGER NOT NULL DEFAULT 0',
    boden: 'INTEGER NOT NULL DEFAULT 0',
  };
  const fehlten = Object.keys(spalten).filter((c) => !have.has(c));
  for (const c of fehlten) db.exec(`ALTER TABLE contacts ADD COLUMN ${c} ${spalten[c]}`);
  if (fehlten.includes('respekt')) {
    db.exec('UPDATE contacts SET respekt = draht, vertrauen = draht');
  }
}
```

- [ ] **Step 2: Die Gedächtnistabelle**

In denselben `db.exec`-Block, in dem `contacts` und `contact_boosts` stehen, hinter `angebot_uhr` anfügen:

```sql
  -- 6a: Was zwischen euch war. Eine gekappte Erzählung, KEINE Rechengrundlage:
  -- d_respekt/d_vertrauen stehen nur hier, damit die Ansicht "+18 Vertrauen"
  -- schreiben kann. Die Achsen auf contacts sind die einzige Wahrheit –
  -- deshalb darf diese Liste gekappt werden, ohne dass eine Zahl driftet.
  CREATE TABLE IF NOT EXISTS contact_memory (
    guild_id    TEXT    NOT NULL,
    user_id     TEXT    NOT NULL,
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    contact_id  TEXT    NOT NULL,
    at          INTEGER NOT NULL,
    art         TEXT    NOT NULL,
    detail      TEXT    NOT NULL DEFAULT '',
    d_respekt   INTEGER NOT NULL DEFAULT 0,
    d_vertrauen INTEGER NOT NULL DEFAULT 0
  );
  CREATE INDEX IF NOT EXISTS idx_contact_memory
    ON contact_memory (guild_id, user_id, contact_id, id DESC);
```

- [ ] **Step 3: Die Statements**

`stmt.saveContact` (Zeile 2309) **ersetzen** und die vier Gedächtnis-Statements im Abschnitt `// --- Kontakte ---` ergänzen:

```js
  // Eine Anfrage = EINE Anweisung (§7). `draht` ist abgeleitet und wird
  // ausschließlich hier geschrieben – eine Quelle, kein zweites Buch.
  saveContact: db.prepare(
    `INSERT INTO contacts (guild_id, user_id, contact_id, draht, respekt, vertrauen,
                           boden, tries, yes, last_try, last_move, ignored_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT (guild_id, user_id, contact_id) DO UPDATE SET
       draht = excluded.draht, respekt = excluded.respekt,
       vertrauen = excluded.vertrauen, boden = excluded.boden,
       tries = excluded.tries, yes = excluded.yes,
       last_try = excluded.last_try, last_move = excluded.last_move,
       ignored_at = excluded.ignored_at`),

  memoryOf: db.prepare(
    `SELECT * FROM contact_memory
      WHERE guild_id = ? AND user_id = ? AND contact_id = ?
      ORDER BY id DESC LIMIT ?`),
  memoryCount: db.prepare(
    `SELECT COUNT(*) AS n FROM contact_memory
      WHERE guild_id = ? AND user_id = ? AND contact_id = ?`),
  insertMemory: db.prepare(
    `INSERT INTO contact_memory (guild_id, user_id, contact_id, at, art, detail,
                                 d_respekt, d_vertrauen)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`),
  // Gekappt wird nach `id DESC` – AUTOINCREMENT, also Einfügereihenfolge.
  pruneMemory: db.prepare(
    `DELETE FROM contact_memory
      WHERE guild_id = ? AND user_id = ? AND contact_id = ?
        AND id NOT IN (SELECT id FROM contact_memory
                        WHERE guild_id = ? AND user_id = ? AND contact_id = ?
                        ORDER BY id DESC LIMIT ?)`),
  clearMemoryOf: db.prepare(
    'DELETE FROM contact_memory WHERE guild_id = ? AND user_id = ?'),
```

- [ ] **Step 4: Die Funktionen**

`saveContact` (Zeile 3834) ersetzen und die drei neuen dahinter:

```js
/**
 * Schreibt die Achsen in EINER Anweisung fort – legt die Zeile bei Bedarf an.
 * Der Draht wird hier und nur hier abgeleitet.
 */
function saveContact(guildId, userId, contactId, c) {
  const respekt = Math.round(c.respekt ?? 0);
  const vertrauen = Math.round(c.vertrauen ?? 0);
  stmt.saveContact.run(
    guildId, String(userId), String(contactId),
    Math.round((respekt + vertrauen) / 2),
    respekt, vertrauen, Math.round(c.boden ?? 0),
    c.tries ?? 0, c.yes ?? 0,
    c.last_try ?? 0, c.last_move ?? 0, c.ignored_at ?? 0);
}

/** Ein Gedächtniseintrag, danach auf `max` gekappt. */
function addMemory(guildId, userId, contactId, m, max) {
  const uid = String(userId);
  const cid = String(contactId);
  stmt.insertMemory.run(guildId, uid, cid, m.at, String(m.art),
    String(m.detail ?? ''),
    Math.round(m.dRespekt ?? 0), Math.round(m.dVertrauen ?? 0));
  stmt.pruneMemory.run(guildId, uid, cid, guildId, uid, cid, max);
}

/** Die neuesten Gedächtniszeilen zu einem Kontakt – neueste zuerst. */
function memoryOf(guildId, userId, contactId, limit) {
  return stmt.memoryOf.all(guildId, String(userId), String(contactId), limit);
}

/** Wie viele Zeilen überhaupt gespeichert sind (für „… und N weitere"). */
function memoryCount(guildId, userId, contactId) {
  return stmt.memoryCount.get(guildId, String(userId), String(contactId))?.n ?? 0;
}
```

In `clearContacts` (die Funktion, die `clearContactsOf` und `clearBoosts` fährt) **zusätzlich** `stmt.clearMemoryOf.run(guildId, String(userId))` aufrufen — sonst überlebt die Erzählung das Löschen des Drahts.

`module.exports` (Zeile 4685) um `addMemory, memoryOf, memoryCount` ergänzen.

- [ ] **Step 4b: Die drei Aufrufer gleichmäßig spalten, damit der Zweig grün bleibt**

Drei Stellen übergeben `saveContact` heute noch ein `draht:`, das die neue Fassung ignoriert — ohne diesen Schritt sind `test/contacts.test.js`, `test/beef.test.js` und `test/angebote.test.js` bis Task 3 rot, und der nächste Reviewer kann neue Brüche nicht von geerbten unterscheiden.

Setze an allen drei Stellen **beide Achsen auf genau den bisherigen Draht-Wert**:

- `src/contacts.js:383` (in `moveDraht`): `respekt: nachher, vertrauen: nachher, boden: row?.boden ?? 0`
- `src/contacts.js:458` (in `request`): `respekt: neu, vertrauen: neu, boden: row?.boden ?? 0`
- `test/angebote.test.js:249` (der `draht`-Helfer): beide Achsen auf `wert`

Das ist kein Pflaster, sondern die **gleichmäßige Spaltung**: Bei `respekt === vertrauen === d` ergibt `Math.round((d + d) / 2)` genau `d`, ohne Rundung — verhaltensidentisch zum heutigen Einzelwert, und genau die Nullhypothese, die der Paritätstest in Task 2 festschreibt. Task 3 ersetzt die beiden `contacts.js`-Stellen durch die echten, ungleichen Paare aus `data.ACHSEN`.

Über jede der beiden `contacts.js`-Stellen einen Kommentar, der sagt, dass das ein Zwischenzustand ist — ohne ihn sieht die gleichmäßige Spaltung später wie eine Absicht aus.

- [ ] **Step 5: Den Test schreiben**

Neue Datei `test/beziehungen.test.js`:

```js
// test/beziehungen.test.js
/**
 * Beziehungen 6a: Spalten, Wanderung, Gedächtnis, Arithmetik, Arten.
 * Aufruf: rm -rf .testdata && DATA_DIR=.testdata node test/beziehungen.test.js
 */
const db = require('../src/db');

let pass = 0, fail = 0;
const check = (label, ok, extra = '') => {
  if (ok) { pass++; console.log(`  ✅ ${label}`); }
  else { fail++; console.log(`  ❌ ${label} ${extra}`); }
};
const near = (a, b, eps = 1e-9) => Math.abs(a - b) < eps;

const G = 'g1';
const U = 'u1';

(async () => {
  console.log('--- Spalten und abgeleiteter Draht ---');
  {
    db.saveContact(G, U, 'lilpfand', {
      respekt: 40, vertrauen: 20, boden: 0,
      tries: 3, yes: 1, last_try: 1000, last_move: 1000, ignored_at: 0 });
    const row = db.getContact(G, U, 'lilpfand');
    check('Achsen kommen zurück', row.respekt === 40 && row.vertrauen === 20, JSON.stringify(row));
    check('Draht ist der Mittelwert', row.draht === 30, String(row.draht));
    check('Boden, Zähler und Zeiten bleiben',
      row.boden === 0 && row.tries === 3 && row.yes === 1 && row.last_try === 1000);

    // Ungerade Summe: Math.round rundet bei .5 nach oben.
    db.saveContact(G, U, 'ninachuba', { respekt: 41, vertrauen: 20 });
    check('ungerade Summe wird gerundet',
      db.getContact(G, U, 'ninachuba').draht === 31,
      String(db.getContact(G, U, 'ninachuba').draht));

    // Negative Achsen.
    db.saveContact(G, U, 'drake', { respekt: 10, vertrauen: -80 });
    check('negativer Mittelwert', db.getContact(G, U, 'drake').draht === -35,
      String(db.getContact(G, U, 'drake').draht));

    check('Lesen legt keine Zeile an (§4)', db.getContact(G, U, 'rammstein') === null);
  }

  console.log('--- Gedächtnis ---');
  {
    for (let i = 1; i <= 15; i++) {
      db.addMemory(G, U, 'lilpfand',
        { at: 1000 + i, art: 'zusage', detail: `t${i}`, dRespekt: i, dVertrauen: i }, 12);
    }
    check('auf zwölf gekappt', db.memoryCount(G, U, 'lilpfand') === 12,
      String(db.memoryCount(G, U, 'lilpfand')));
    const neueste = db.memoryOf(G, U, 'lilpfand', 3);
    check('neueste zuerst',
      neueste.length === 3 && neueste[0].detail === 't15' && neueste[2].detail === 't13',
      JSON.stringify(neueste.map((m) => m.detail)));
    check('die ältesten drei sind weg',
      !db.memoryOf(G, U, 'lilpfand', 12).some((m) => ['t1', 't2', 't3'].includes(m.detail)));
    check('Deltas werden mitgeführt',
      neueste[0].d_respekt === 15 && neueste[0].d_vertrauen === 15);
    check('je Kontakt eigene Kappung', db.memoryCount(G, U, 'ninachuba') === 0);
  }

  console.log(`\n${pass} bestanden, ${fail} fehlgeschlagen`);
  process.exit(fail === 0 ? 0 : 1);
})();
```

- [ ] **Step 6: Test laufen lassen, erst rot, dann grün**

```bash
rm -rf .testdata && DATA_DIR=.testdata node test/beziehungen.test.js
```

Erwartet vor Step 1–4: Absturz oder `❌` (die Spalten und `db.addMemory` fehlen). Nach Step 1–4: `11 bestanden, 0 fehlgeschlagen`.

- [ ] **Step 7: Die Wanderung an einer echten Altzeile prüfen**

Die Wanderung kann der Test oben nicht prüfen, weil eine frische Datenbank die Spalten schon mitbringt. Von Hand, einmal, gegen eine Datenbank im Altzustand:

```bash
rm -rf .testdata && mkdir -p .testdata && DATA_DIR=.testdata node -e "
const { DatabaseSync } = require('node:sqlite');
const d = new DatabaseSync('.testdata/shop.db');
d.exec(\`CREATE TABLE contacts (guild_id TEXT NOT NULL, user_id TEXT NOT NULL,
  contact_id TEXT NOT NULL, draht INTEGER NOT NULL DEFAULT 0,
  tries INTEGER NOT NULL DEFAULT 0, yes INTEGER NOT NULL DEFAULT 0,
  last_try INTEGER NOT NULL DEFAULT 0, last_move INTEGER NOT NULL DEFAULT 0,
  ignored_at INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (guild_id, user_id, contact_id));\`);
d.exec(\"INSERT INTO contacts (guild_id,user_id,contact_id,draht,tries,yes) VALUES ('g','u','drake',44,9,2),('g','u','anitta',-30,4,0)\");
d.close();
" && DATA_DIR=.testdata node -e "
const db = require('./src/db');
const a = db.getContact('g','u','drake');
const b = db.getContact('g','u','anitta');
console.log('drake  ', a.draht, a.respekt, a.vertrauen, a.boden);
console.log('anitta ', b.draht, b.respekt, b.vertrauen, b.boden);
console.log(a.respekt === 44 && a.vertrauen === 44 && a.boden === 0
  && b.respekt === -30 && b.vertrauen === -30 ? 'WANDERUNG OK' : 'WANDERUNG FALSCH');
"
```

Erwartet: `drake 44 44 44 0`, `anitta -30 -30 -30 0`, `WANDERUNG OK`.

- [ ] **Step 8: Die neue Testdatei in `npm test` eintragen**

`package.json` → `scripts.test` fährt `rm -rf .testdata`, setzt `DATA_DIR` und listet dann ~51 Testdateien einzeln auf. Eine Datei, die dort nicht steht, läuft in der Gesamtsuite **nie** — und niemand merkt es, weil die Suite grün bleibt. `test/beziehungen.test.js` kommt direkt **hinter `node test/angebote.test.js`**, wo die Kontakt-Familie steht.

**Daraus folgt eine Anforderung an die Datei selbst:** `npm test` löscht `.testdata` nur **einmal** am Anfang und fährt danach alles gegen **dieselbe** Datenbank. `test/beziehungen.test.js` läuft dort nach `contacts`, `beef` und `angebote`, die alle in die Tabelle `contacts` schreiben. Die Datei darf deshalb keinen leeren Ausgangszustand voraussetzen:

- **Eigene Schlüssel**, nicht `g1`/`u1`: Präfix `b6a-` (`b6a-g1`, `b6a-g2`, `b6a-u1`, `b6a-u2`). Mit `grep -rn "b6a-" test/` prüfen, dass sie sonst nirgends vorkommen.
- **Vorher aufräumen**: Am Anfang jedes Abschnitts, der leere Tabellen braucht, `db.clearContacts(gilde, nutzer)` für jede benutzte Kombination — das löscht seit Step 4 auch das Gedächtnis mit.

Zwei Zusicherungen dafür, und die zweite ist die eigentliche:

```bash
rm -rf .testdata && DATA_DIR=.testdata node test/beziehungen.test.js   # grün
DATA_DIR=.testdata node test/beziehungen.test.js                       # ohne rm, ebenfalls grün
```

- [ ] **Step 9: Commit**

```bash
git add src/db.js test/beziehungen.test.js package.json
git commit -m "beziehungen: zwei achsen, die wanderung und die gedaechtnistabelle"
```

---

## Task 2: Die reine Arithmetik und alle Konstanten

**Files:**
- Modify: `src/data/contacts.js` (Konstanten ab Zeile 72, `module.exports` ab Zeile 574)
- Modify: `src/contacts.js` (reine Hälfte, Zeilen 26–118)
- Test: `test/beziehungen.test.js`

**Interfaces:**
- Consumes: nichts aus Task 1 (reine Rechnungen, keine Datenbank).
- Produces:
  - `contacts.drahtVon(respekt, vertrauen) -> number`
  - `contacts.decayAchse(wert, punkte, boden = 0) -> number`
  - `contacts.respektGewicht(meine, seine) -> number`
  - `contacts.decay(draht, tage)` bleibt **unverändert** erhalten und ist das Referenzmodell des Paritätstests
  - `data.ACHSEN`, `data.RESPEKT_DECAY_PRO_WOCHE`, `data.VERTRAUEN_DECAY_PRO_WOCHE`, `data.BODEN_MAX`, `data.RESPEKT_W_MIN`, `data.RESPEKT_W_SPAN`, `data.RESPEKT_W_DEKADEN`, `data.VERTRAUEN_MALUS`, `data.PARTNER_RESPEKT`, `data.PARTNER_VERTRAUEN`, `data.ART_*`, `data.MEMORY_MAX`, `data.MEMORY_ZEIGEN`, `data.MEMORY_TEXTE`

- [ ] **Step 1: Die Konstanten in `src/data/contacts.js`**

Den Abschnitt `/** Was eine Antwort am Draht bewegt. */` samt der fünf `DRAHT_*`-Konstanten und `DRAHT_DECAY_PRO_WOCHE` **ersetzen** durch:

```js
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
 * (1 + 3) / 2 = 2, also kühlt der Draht mit genau den alten zwei Punkten ab,
 * solange Vertrauen über seinem Boden steht.
 */
const RESPEKT_DECAY_PRO_WOCHE = 1;
const VERTRAUEN_DECAY_PRO_WOCHE = 3;

/** Die alte Rate – bleibt als Referenz des Paritätstests stehen. */
const DRAHT_DECAY_PRO_WOCHE = 2;

/**
 * Der Boden, unter den Vertrauen nicht fällt. Nur DURCHGEZOGENES setzt ihn
 * (die Werte stehen in data/angebote.js), Zusagen und freundliche Antworten
 * nicht. Bei 30 Boden und Respekt 0 liegt der Draht bei 15 – unter „bekannt"
 * und unter der Schwelle, ab der Gegenanfragen überhaupt kommen: Die Beziehung
 * bleibt warm und öffnet nichts von allein.
 */
const BODEN_MAX = 30;

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
 * ist Respekts Aufgabe. Der Riegel gegen die naheliegende Masche: Wer denselben
 * Kontakt wiederholt anstachelt, sammelt Respekt bei Vertrauen auf −100 und
 * landet damit auf CHANCE_MIN statt über dem Fremden.
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
```

> **Diese Aufgabe ist rein additiv und löscht NICHTS.** Die fünf alten `DRAHT_*`-Konstanten, `STUFE_BEEF`, `PARTNER_YES` und `drahtStufe` bleiben vollständig stehen und exportiert, obwohl sie am Ende verschwinden sollen. Grund, nachgemessen: die `delta`-Zuweisung in `request` liest die fünf Deltas, die alte `istPartner` liest `PARTNER_YES`, `drahtStufe` liest `STUFE_BEEF`, und `listFor`/`detail`/`request` rufen `drahtStufe`. Löschte diese Aufgabe sie, setzte `request` `delta = undefined` und schriebe `NaN` in den Draht — die Suite wäre bis Task 3 rot, und der nächste Reviewer könnte neue Brüche nicht von geerbten unterscheiden. **Task 3 löscht sie, in derselben Änderung, die ihre Leser ersetzt.**

`module.exports` wird nur **ergänzt**: `ACHSEN, RESPEKT_DECAY_PRO_WOCHE, VERTRAUEN_DECAY_PRO_WOCHE, BODEN_MAX, RESPEKT_W_MIN, RESPEKT_W_SPAN, RESPEKT_W_DEKADEN, VERTRAUEN_MALUS, PARTNER_RESPEKT, PARTNER_VERTRAUEN, ART_RIVALE_RESPEKT, ART_RIVALE_VERTRAUEN, ART_ABSTAND, ART_MENTOR_RESPEKT, ART_MENTOR_VERTRAUEN, ART_SCHUETZLING_VERTRAUEN, ART_BAND_BODEN, ART_GESCHAEFTLICH_RESPEKT, MEMORY_MAX, MEMORY_ZEIGEN, MEMORY_TEXTE`. Nichts kommt heraus.

- [ ] **Step 2: Die Arithmetik in `src/contacts.js`**

`drahtStufe` (Zeile 96) **bleibt stehen** — ihre drei Aufrufer in `listFor`, `detail` und `request` verschwinden erst in Task 3. `decay` (Zeile 110) bleibt ebenfalls unverändert; sie ist das Referenzmodell des Paritätstests. Hinter `decay` einfügen:

```js
/** Der Draht ist abgeleitet – hier gerechnet, geschrieben nur in db.saveContact. */
const drahtVon = (respekt, vertrauen) => Math.round((respekt + vertrauen) / 2);

/**
 * Eine Achse Richtung Ziel, ohne Überschießen.
 *
 * Von oben gegen `boden`, von unten gegen 0. Der Boden bremst nur den Fall –
 * er zieht nicht nach oben und heilt damit keinen Beef.
 */
function decayAchse(wert, punkte, boden = 0) {
  if (wert > boden) return Math.max(boden, wert - punkte);
  if (wert < 0) return Math.min(0, wert + punkte);
  return wert;
}

/** Das Gewicht des Respekts in der Antwortchance – wächst mit dem Abstand. */
function respektGewicht(meine, seine) {
  const dekaden = Math.log10(Math.max(1, seine) / Math.max(100, meine || 0));
  return data.RESPEKT_W_MIN
    + data.RESPEKT_W_SPAN * clamp(0, 1, dekaden / data.RESPEKT_W_DEKADEN);
}
```

`module.exports` wird nur **ergänzt**: `drahtVon, decayAchse, respektGewicht` hinein. `drahtStufe` und `decay` bleiben exportiert.

> **Warum `istPartner` und `artOf` hier NICHT stehen:** `src/contacts.js` trägt heute eine `function istPartner(row, draht)` mit fünf Aufrufern (in `listFor`, `detail`, `request` und zweimal in dessen Rückgabe). Ein zusätzliches `const istPartner` im selben Gültigkeitsbereich ist ein `SyntaxError: Identifier 'istPartner' has already been declared` — die Datei ließe sich nicht einmal laden. Beide Funktionen kommen deshalb in Task 3, wo die alte Fassung und ihre fünf Aufrufer in derselben Änderung verschwinden.

- [ ] **Step 3: Den Paritätstest schreiben**

Das wichtigste Testwerkzeug dieses Stücks. An `test/beziehungen.test.js` anfügen, **vor** der Schlusszeile mit `console.log(\`\n${pass} …\`)`:

```js
  console.log('--- Parität gegen die alte Kette ---');
  {
    const contacts = require('../src/contacts');
    const cdata = require('../src/data/contacts');

    // Die alten Draht-Deltas, wie main sie rechnete.
    const ALT = { zusage: 12, echt: 6, fluechtig: 2, ignoriert: -1, verstimmt: -5 };
    const klemm = (v) => Math.max(-100, Math.min(100, v));

    /** Die alte Kette: EIN Draht, Abkühlen mit contacts.decay. */
    const altKette = (folge) => folge.reduce((draht, [art, tage]) =>
      klemm(contacts.decay(draht, tage) + ALT[art]), 0);

    /**
     * Die neue Kette mit GLEICHMÄSSIGER Spaltung und gleicher Abkühlrate:
     * beide Achsen tragen in jedem Schritt dasselbe, also gilt (d+d)/2 = d.
     * Weicht das ab, liegt der Fehler in der Mechanik – nicht in den Zahlen.
     */
    const neuKette = (folge) => {
      let r = 0, v = 0;
      for (const [art, tage] of folge) {
        const ab = Math.floor(Math.max(0, tage) / 7) * cdata.DRAHT_DECAY_PRO_WOCHE;
        r = klemm(contacts.decayAchse(r, ab, 0) + ALT[art]);
        v = klemm(contacts.decayAchse(v, ab, 0) + ALT[art]);
      }
      return contacts.drahtVon(r, v);
    };

    const folgen = [
      [['zusage', 0]],
      [['zusage', 0], ['zusage', 0], ['zusage', 0], ['zusage', 0], ['zusage', 0]],
      [['ignoriert', 3], ['ignoriert', 3], ['ignoriert', 3], ['verstimmt', 7]],
      [['zusage', 0], ['zusage', 0], ['fluechtig', 70]],
      [['verstimmt', 0], ['verstimmt', 0], ['verstimmt', 0], ['verstimmt', 0],
        ['verstimmt', 0], ['verstimmt', 0], ['verstimmt', 0], ['verstimmt', 0],
        ['verstimmt', 0], ['verstimmt', 0], ['verstimmt', 0], ['verstimmt', 0],
        ['verstimmt', 0], ['verstimmt', 0], ['verstimmt', 0], ['verstimmt', 0],
        ['verstimmt', 0], ['verstimmt', 0], ['verstimmt', 0], ['verstimmt', 0],
        ['verstimmt', 0], ['verstimmt', 0]],            // läuft an die −100
      [['zusage', 0], ['zusage', 0], ['zusage', 0], ['zusage', 0], ['zusage', 0],
        ['zusage', 0], ['zusage', 0], ['zusage', 0], ['zusage', 0], ['zusage', 0]],  // an die +100
    ];
    for (let i = 0; i < folgen.length; i++) {
      const a = altKette(folgen[i]);
      const n = neuKette(folgen[i]);
      check(`Parität, Folge ${i + 1} (${folgen[i].length} Schritte): ${a}`, a === n,
        `alt ${a}, neu ${n}`);
    }

    // Und dasselbe über 400 gewürfelte Folgen mit gesätem Zufall.
    let seed = 20261007;
    const wuerfel = () => {
      seed = (seed * 1103515245 + 12345) & 0x7fffffff;
      return seed / 0x7fffffff;
    };
    const arten = Object.keys(ALT);
    let abweichungen = 0;
    for (let n = 0; n < 400; n++) {
      const folge = [];
      const len = 1 + Math.floor(wuerfel() * 25);
      for (let i = 0; i < len; i++) {
        folge.push([arten[Math.floor(wuerfel() * arten.length)],
          Math.floor(wuerfel() * 40)]);
      }
      if (altKette(folge) !== neuKette(folge)) abweichungen++;
    }
    check('Parität über 400 gewürfelte Folgen', abweichungen === 0,
      `${abweichungen} Abweichungen`);
  }
```

- [ ] **Step 4: Den Arithmetiktest schreiben**

Ebenfalls an `test/beziehungen.test.js` anfügen:

```js
  console.log('--- Abkühlen mit Boden ---');
  {
    const contacts = require('../src/contacts');
    const f = contacts.decayAchse;
    check('von oben gegen 0', f(40, 3, 0) === 37, String(f(40, 3, 0)));
    check('kein Überschießen nach unten', f(2, 3, 0) === 0, String(f(2, 3, 0)));
    check('von unten gegen 0', f(-40, 3, 0) === -37, String(f(-40, 3, 0)));
    check('kein Überschießen nach oben', f(-2, 3, 0) === 0, String(f(-2, 3, 0)));
    check('der Boden bremst den Fall', f(31, 3, 30) === 30, String(f(31, 3, 30)));
    check('auf dem Boden bleibt es liegen', f(30, 3, 30) === 30, String(f(30, 3, 30)));
    check('der Boden zieht NICHT nach oben', f(0, 3, 30) === 0, String(f(0, 3, 30)));
    check('von unten ist der Boden egal', f(-50, 3, 30) === -47, String(f(-50, 3, 30)));
  }

  console.log('--- Respekt-Gewicht ---');
  {
    const contacts = require('../src/contacts');
    const g = contacts.respektGewicht;
    check('gleich groß: 0,12', near(g(100_000, 100_000), 0.12), String(g(100_000, 100_000)));
    check('10×: 0,23', near(g(100_000, 1_000_000), 0.23), String(g(100_000, 1_000_000)));
    check('100×: 0,34', near(g(100_000, 10_000_000), 0.34), String(g(100_000, 10_000_000)));
    check('1000×: 0,45', near(g(10_000, 10_000_000), 0.45), String(g(10_000, 10_000_000)));
    check('er ist kleiner: 0,12 (geklemmt)', near(g(100_000, 10_000), 0.12), String(g(100_000, 10_000)));
    check('weit über 1000× bleibt 0,45', near(g(100, 1_000_000_000), 0.45), String(g(100, 1_000_000_000)));
    // Die Grenze, an der das neue Gewicht die alten 0,25 übersteigt.
    check('Faktor 15,2 ist die Grenze',
      g(100_000, 1_520_000) > 0.25 && g(100_000, 1_500_000) < 0.2501,
      `${g(100_000, 1_500_000)} / ${g(100_000, 1_520_000)}`);
  }

```

- [ ] **Step 5: Test laufen lassen**

```bash
rm -rf .testdata && DATA_DIR=.testdata node test/beziehungen.test.js
```

Erwartet: jede Zeile `✅`, `0 fehlgeschlagen`. **Schlägt der Paritätstest fehl, ist die Mechanik falsch, nicht der Test** — dann `drahtVon` oder `decayAchse` prüfen, nicht die erwarteten Werte anpassen.

- [ ] **Step 6: Commit**

```bash
git add src/data/contacts.js src/contacts.js test/beziehungen.test.js
git commit -m "beziehungen: die reine arithmetik, die arten und der paritaetstest"
```

---

## Task 3: `src/contacts.js` vollständig auf die Achsen

**Files:**
- Modify: `src/contacts.js` (`chanceOf` ab Zeile 45, `stufeVon` ab Zeile 63, `drahtJetzt` Zeile 233, `istPartner` Zeile 248, `tuerOeffnerFor` Zeile 257, `chanceFor` Zeile 271, `listFor` Zeile 294, `detail` Zeile 325, `moveDraht` Zeile 403, `request` Zeile 429)
- Modify: `test/contacts.test.js` (die `drahtStufe`-Fälle)
- Test: `test/beziehungen.test.js`, `test/contacts.test.js`

**Interfaces:**
- Consumes: aus Task 1 `db.saveContact`, `db.addMemory`; aus Task 2 `drahtVon`, `decayAchse`, `respektGewicht`, `data.ACHSEN`, `data.MEMORY_MAX`, `data.VERTRAUEN_MALUS`.
- Produces:
  - `contacts.achsenJetzt(row, now) -> { respekt, vertrauen, boden, draht }` — faul gerechnet, schreibt nie (§4)
  - `contacts.drahtJetzt(row, now) -> number` — bleibt als dünne Hülle (`angebote.js`, `beef.js` und die Messung rufen sie)
  - `contacts.istPartnerRow(row, now) -> boolean`
  - `contacts.move(guildId, userId, contactId, { respekt, vertrauen, boden, setzeVertrauen, merken }, now, { sperre }) -> { vorher, nachher, achsenVor, achsen }` — **ersetzt `moveDraht` vollständig**; `vorher`/`nachher` sind weiterhin Draht-**Zahlen**, damit `buttons.beefDraht` weiterläuft
  - `contacts.chanceOf({ …, respekt, vertrauen, … })` — `draht` ist **weg**
  - `contacts.stufeVon(random, { ratio, respekt })` — `draht` ist **weg**
  - `contacts.detail(...)` liefert zusätzlich `respekt`, `vertrauen`, `boden`, `art` — `stufe` bleibt bis Task 6 daneben stehen
  - `contacts.request(...)` liefert zusätzlich `achsen`, `achsenVor`, `art` — `stufe` ebenso

> **Diese Aufgabe traegt alle Löschungen des Stücks.** Task 2 war rein additiv, damit die Suite nicht über zwei Aufgaben rot steht. Was hier verschwindet, und zwar jeweils in derselben Änderung, die seine Leser ersetzt:
>
> | zu löschen | Leser, die hier ersetzt werden |
> |---|---|
> | `data.DRAHT_ZUSAGE`, `DRAHT_ECHT`, `DRAHT_FLUECHTIG`, `DRAHT_IGNORIERT`, `DRAHT_VERSTIMMT` | die `delta`-Zuweisung in `request` (Step 5, ersetzt durch `data.ACHSEN`) |
> | `data.PARTNER_YES` | die alte `istPartner` (Step 6) |
>
> **Nicht hier, sondern erst in Task 6** verschwinden `contacts.drahtStufe`, `data.STUFE_BEEF` und das Feld `stufe` in den Rückgabewerten. Nachgemessen: `src/buttons.js:659` (`anfrageNote`) und `:798` (`beefDraht`) lesen `DRAHT_STUFEN[…stufe]`, und **kein Test prüft diese Ausgabe** — gelöscht hier, stünde dort still das Wort `undefined` in jeder Beef- und Anfragemeldung, ohne dass die Suite auch nur blinkt. `listFor`, `detail` und `request` liefern ab dieser Aufgabe `art` **zusätzlich** zu `stufe`; Task 6 stellt die Ansicht um und nimmt `stufe` dann mit.
> | `contacts.moveDraht` | die neun externen Aufrufer kommen in Task 4 und 5; hier wird `move` daneben gebaut und `moveDraht` bleibt bis dahin **stehen** |
>
> `data.DRAHT_DECAY_PRO_WOCHE` und `contacts.decay` bleiben: Sie sind das Referenzmodell des Paritätstests.
>
> Am Ende dieser Aufgabe müssen `test/contacts.test.js`, `test/beef.test.js`, `test/angebote.test.js`, `test/beziehungen.test.js` und `test/db.test.js` alle auf `0 fehlgeschlagen` stehen.

- [ ] **Step 1: `achsenJetzt` und `drahtJetzt`**

`drahtJetzt` (Zeile 233) **ersetzen**:

```js
/**
 * Die Achsen von heute: abgekühlt seit der letzten Bewegung, ohne zu schreiben
 * (§4). Erst die nächste Bewegung schreibt die abgekühlten Werte fort.
 */
function achsenJetzt(row, now) {
  if (!row) return { respekt: 0, vertrauen: 0, boden: 0, draht: 0 };
  const boden = row.boden ?? 0;
  const wochen = row.last_move
    ? Math.floor(Math.max(0, (now - row.last_move) / DAY_MS) / 7)
    : 0;
  const respekt = decayAchse(row.respekt, wochen * data.RESPEKT_DECAY_PRO_WOCHE, 0);
  const vertrauen = decayAchse(row.vertrauen, wochen * data.VERTRAUEN_DECAY_PRO_WOCHE, boden);
  return { respekt, vertrauen, boden, draht: drahtVon(respekt, vertrauen) };
}

/** Nur der Draht davon – was angebote.js, beef.js und die Messung brauchen. */
function drahtJetzt(row, now) {
  return achsenJetzt(row, now).draht;
}

/** Fester Partner, direkt auf einer Zeile. */
function istPartnerRow(row, now) {
  const a = achsenJetzt(row, now);
  return istPartner(a.respekt, a.vertrauen);
}
```

- [ ] **Step 2: `move` statt `moveDraht`**

`moveDraht` (Zeile 403) **bleibt vorerst stehen** — `src/beef.js` und `src/angebote.js` rufen es an neun Stellen, und die kommen erst in Task 4 und 5 dran. `move` wird **daneben** gebaut, und `moveDraht` ruft es intern, damit es nur eine Schreibmechanik gibt:

```js
/** Alt-Einstieg, bis Task 4 und 5 ihre Aufrufer umgestellt haben. Gleichmäßige
 *  Spaltung – Mittelwert unverändert, siehe Paritätstest. */
function moveDraht(guildId, userId, contactId, delta, now = Date.now(), opts = {}) {
  const erg = move(guildId, userId, contactId,
    { respekt: delta, vertrauen: delta }, now, opts);
  // `stufe` muss mitkommen: buttons.js:798 (beefDraht) liest es, und kein Test
  // prüft diese Zeichenkette – ohne das Feld stünde dort still „undefined".
  return { ...erg, stufe: drahtStufe(erg.nachher) };
}
```

Die alte `istPartner` (Zeile 223) wird in Step 6 gelöscht. `move` selbst:

```js
/**
 * Bewegt die Achsen – die einzige Stelle, an der sie jemand von außen
 * schreibt. Das Abkühlen wird vorher faul eingerechnet (§4), damit ein alter
 * Wert nicht konserviert wird. `sperre` setzt zusätzlich `last_try`.
 *
 * `setzeVertrauen` setzt ein Ziel statt zu addieren – das braucht genau eine
 * Stelle, die Versöhnung in beef.js. `merken` schreibt eine Gedächtniszeile,
 * synchron direkt hinter dem Achsen-Schreibvorgang und ohne `await` dazwischen
 * (§7); das Projekt benutzt nirgends `db.transaction`.
 *
 * (`request` unten schreibt seine Zeile weiterhin selbst: Es setzt in
 * DERSELBEN Anweisung auch `yes` und `ignored_at` – ein Beef tut das nie.)
 */
function move(guildId, userId, contactId, bewegung, now = Date.now(), { sperre = false } = {}) {
  const { respekt = 0, vertrauen = 0, boden = 0,
    setzeVertrauen = null, merken = null } = bewegung;
  const zeilen = db.contactsOf(guildId, userId);
  const row = zeilen.find((z) => z.contact_id === contactId) ?? null;
  const vor = achsenJetzt(row, now);

  const bodenNeu = clamp(0, data.BODEN_MAX, vor.boden + boden);
  const respektNeu = clamp(-100, 100, vor.respekt + respekt);
  const rohV = setzeVertrauen === null ? vor.vertrauen + vertrauen : setzeVertrauen;
  // Wer den Boden hebt, hebt das Vertrauen mit – es darf nie unter dem
  // eigenen Boden liegen.
  const vertrauenNeu = clamp(-100, 100, boden > 0 ? Math.max(rohV, bodenNeu) : rohV);

  db.saveContact(guildId, userId, contactId, {
    respekt: respektNeu, vertrauen: vertrauenNeu, boden: bodenNeu,
    tries: (row?.tries ?? 0) + (sperre ? 1 : 0),
    yes: row?.yes ?? 0,
    last_try: sperre ? now : (row?.last_try ?? 0),
    last_move: now,
    ignored_at: row?.ignored_at ?? 0,
  });
  if (merken) {
    db.addMemory(guildId, userId, contactId, {
      at: now, art: merken.art, detail: merken.detail ?? '',
      dRespekt: respektNeu - vor.respekt, dVertrauen: vertrauenNeu - vor.vertrauen,
    }, data.MEMORY_MAX);
  }

  return {
    vorher: vor.draht, nachher: drahtVon(respektNeu, vertrauenNeu),
    achsenVor: { respekt: vor.respekt, vertrauen: vor.vertrauen, boden: vor.boden },
    achsen: { respekt: respektNeu, vertrauen: vertrauenNeu, boden: bodenNeu },
  };
}
```

- [ ] **Step 3: Die Antwortchance und die Verbindlichkeit**

`chanceOf` (Zeile 45) — `draht` durch `respekt`/`vertrauen` ersetzen:

```js
/** Antwortchance (Wurf 1) – alle Summanden aus der Spec. */
function chanceOf({ meineReichweite, seineReichweite, request, gleichesLand, sprache, genre,
  respekt = 0, vertrauen = 0, tuerOeffner = 0, hype = 1, trait = 'launisch',
  partner = false, szene = 0 }) {
  const ratio = Math.max(100, meineReichweite || 0) / Math.max(1, seineReichweite);
  const basis = Math.min(data.CHANCE_MAX, 0.6 * Math.sqrt(ratio));
  const r = data.REQUESTS.find((x) => x.id === request);
  const sprachbonus = sprache === 'gleich' ? 0.10 : sprache === 'englisch' ? 0 : -0.15;
  const genrebonus = genre === 'gleich' ? 0.05 : genre === 'verwandt' ? 0 : -0.05;
  return clamp(data.CHANCE_MIN, data.CHANCE_MAX,
    basis + (r?.schwierigkeit ?? 0)
    + (gleichesLand ? 0.05 : 0) + sprachbonus + genrebonus
    // Respekt öffnet die Tür, und je größer der Abstand, desto mehr.
    + (Math.max(0, respekt) / 100) * respektGewicht(meineReichweite, seineReichweite)
    // Positives Vertrauen hebt die Chance NICHT – das ist Respekts Aufgabe.
    // Negatives senkt sie, und das ist der Riegel gegen den Dauer-Beefer.
    + Math.min(0, vertrauen / 100) * data.VERTRAUEN_MALUS
    + clamp(0, 0.15, tuerOeffner)
    + (hype - 1) * 0.1 + (data.TRAIT_BONUS[trait] ?? 0) + (partner ? 0.10 : 0)
    // Solange ein Beef offen ist, macht die Szene des Gegners dicht (5b). Die
    // reine Hälfte holt sich das nicht selbst – sie bekommt es gereicht.
    + szene);
}
```

`stufeVon` (Zeile 63) — nur das Gewicht der Zusage hängt um:

```js
/**
 * Wie verbindlich die Antwort ausfällt (Wurf 2).
 *
 * Das Gewicht der Zusage hängt am RESPEKT, nicht am Mittelwert: Mit Vertrauen
 * wäre es selbstverstärkend (Vertrauen erzeugt Zusagen erzeugt Vertrauen), und
 * Respekt ist durchgehend die Achse, die über das Antworten entscheidet. Der
 * `ratio` bleibt der rohe Größenvergleich.
 */
function stufeVon(random, { ratio, respekt = 0 }) {
  const naehe = Math.min(1, ratio);
  const gewichte = {
    fluechtig: 6 * (ratio < 0.05 ? 2 : 1),
    echt: 3,
    zusage: 1 * (1 + 2 * naehe) * (1 + respekt / 100),
  };
  const summe = gewichte.fluechtig + gewichte.echt + gewichte.zusage;
  let wurf = random() * summe;
  for (const [stufe, g] of Object.entries(gewichte)) {
    if (wurf < g) return stufe;
    wurf -= g;
  }
  return 'fluechtig';
}
```

- [ ] **Step 4: Die vier Aufrufer durchziehen**

`tuerOeffnerFor` (Zeile 257): `if (nah && drahtJetzt(row, now) >= data.STUFE_PARTNER) anzahl++;` wird zu `if (nah && istPartnerRow(row, now)) anzahl++;`.

`chanceFor` (Zeile 271): Parameter `draht` wird zu `respekt, vertrauen` und beide werden an `chanceOf` durchgereicht.

`listFor` (Zeile 294) und `detail` (Zeile 325): statt `const draht = drahtJetzt(row, now)` nun `const a = achsenJetzt(row, now)`; `partner` kommt aus `istPartner(a.respekt, a.vertrauen)`; die Rückgabe trägt `respekt: a.respekt, vertrauen: a.vertrauen, boden: a.boden, draht: a.draht` und statt `stufe: drahtStufe(draht)` ein

```js
      art: artOf({ respekt: a.respekt, vertrauen: a.vertrauen, boden: a.boden,
        meine: k ? k.meine : 0, seine: k ? k.seine : 0,
        trait: contact.trait, beefOffen: Boolean(beefOffen) }),
```

In `listFor` fehlt der Beef-Schalter bislang. Er wird dort **einmal vor der Schleife** geholt, nicht je Kontakt — die Liste läuft über alle 89 Einträge, und `offenerBeef` ist je Aufruf eine Abfrage:

```js
  const offene = new Set(require('./beef').offeneBeefs(guildId, userId, now)
    .map((b) => b.contact_id));
```

In der Schleife dann `beefOffen: offene.has(contact.id)`.

Die Draht-Tore bleiben am Draht: `r.minDraht !== null && a.draht < r.minDraht`. **Neu zusätzlich** das Vertrauens-Tor, mit eigenem Grund:

```js
    const grund = !ks ? 'seite'
      : beefOffen ? 'beef'
        : (r.minDraht != null && a.draht < r.minDraht) ? 'draht'
          : (r.minVertrauen != null && a.vertrauen < r.minVertrauen) ? 'vertrauen'
            : gesperrtBis > now ? 'gesperrt' : null;
```

- [ ] **Step 5: `request` auf die Achsen**

In `request` (Zeile 429): `const draht = drahtJetzt(row, now)` wird zu `const a = achsenJetzt(row, now)`; `partner` aus `istPartner(a.respekt, a.vertrauen)`. Die Draht-Prüfung bleibt (`r.minDraht`), die Vertrauens-Prüfung kommt dazu:

```js
  if (r.minDraht != null && a.draht < r.minDraht) {
    return { ok: false, reason: 'draht', contact, request: r, draht: a.draht, need: r.minDraht };
  }
  if (r.minVertrauen != null && a.vertrauen < r.minVertrauen) {
    return { ok: false, reason: 'vertrauen', contact, request: r,
      vertrauen: a.vertrauen, need: r.minVertrauen };
  }
```

Der Wurf und der Schreibvorgang:

```js
  const antwort = random() < chance ? stufeVon(random, { ratio, respekt: a.respekt }) : 'ignoriert';

  // Wer arrogant oder kühl ist, nimmt das Nerven manchmal übel.
  const empfindlich = contact.trait === 'arrogant' || contact.trait === 'kuehl';
  const schluessel = antwort !== 'ignoriert' ? antwort
    : (empfindlich && random() < VERSTIMMT_CHANCE ? 'verstimmt' : 'ignoriert');
  const paar = data.ACHSEN[schluessel];

  const respektNeu = clamp(-100, 100, a.respekt + paar.respekt);
  const vertrauenNeu = clamp(-100, 100, a.vertrauen + paar.vertrauen);
  const yesNeu = yes + (antwort === 'zusage' ? 1 : 0);

  // EINE Anweisung (§7) – sie setzt auch `yes` und `ignored_at`.
  db.saveContact(guildId, userId, contact.id, {
    respekt: respektNeu, vertrauen: vertrauenNeu, boden: a.boden,
    tries: tries + 1,
    yes: yesNeu,
    last_try: now,
    last_move: now,
    ignored_at: antwort === 'ignoriert' ? now : (row?.ignored_at ?? 0),
  });
  // Nur Zusage und Verstimmung kommen ins Gedächtnis – flüchtig, echt und
  // ignoriert sind häufig und klein, die erzählt `tries − yes`.
  if (schluessel === 'zusage' || schluessel === 'verstimmt') {
    db.addMemory(guildId, userId, contact.id, {
      at: now, art: schluessel, detail: r.name,
      dRespekt: respektNeu - a.respekt, dVertrauen: vertrauenNeu - a.vertrauen,
    }, data.MEMORY_MAX);
  }
```

Die Rückgabe: `draht: drahtVon(respektNeu, vertrauenNeu)`, `drahtVor: a.draht`, `delta: drahtVon(respektNeu, vertrauenNeu) - a.draht`, das bisherige `stufe: drahtStufe(drahtVon(respektNeu, vertrauenNeu))` (es bleibt bis Task 6, weil `buttons.anfrageNote` es liest), dazu `achsen: { respekt: respektNeu, vertrauen: vertrauenNeu, boden: a.boden }`, `achsenVor: { respekt: a.respekt, vertrauen: a.vertrauen, boden: a.boden }`, `partner: istPartner(respektNeu, vertrauenNeu)`, `partnerNeu: !partner && istPartner(respektNeu, vertrauenNeu)` und

```js
    art: artOf({ respekt: respektNeu, vertrauen: vertrauenNeu, boden: a.boden,
      meine: k.meine, seine: k.seine, trait: contact.trait, beefOffen: false }),
```

`module.exports`: `move, achsenJetzt, istPartnerRow` hinein. `moveDraht` bleibt bis Task 5 exportiert, `drahtJetzt` dauerhaft.

- [ ] **Step 6: `istPartner` und `artOf` — die alte Fassung verschwindet in derselben Änderung**

Die bestehende `function istPartner(row, draht)` (Zeile 248) **löschen** und in der reinen Hälfte, hinter `respektGewicht`, einsetzen:

```js
/**
 * Fester Partner. Die EINZIGE Regel – gültig für das ⭐, die +10 Punkte
 * Antwortchance, die Türöffner-Zählung und die Anzählrunde in beef.js.
 *
 * Vorher gab es drei Fassungen, von denen zwei sich widersprachen: Die Ansicht
 * zeigte das ⭐ bei `yes >= 3`, gezählt wurde aber nur `draht >= 50` – wer drei
 * Zusagen bei Draht 30 hatte, las „das öffnet Türen im Umfeld" und öffnete
 * keine.
 */
const istPartner = (respekt, vertrauen) =>
  respekt >= data.PARTNER_RESPEKT && vertrauen >= data.PARTNER_VERTRAUEN;

/**
 * Die Art der Beziehung – reine Funktion, kein Zustand, keine Datenbank.
 * Die ERSTE passende Art gewinnt, und die Reihenfolge ist an drei Stellen
 * Absicht:
 *
 *   • `rivale` über `verstimmt`, sonst verschwindet er: Respekt 30 bei
 *     Vertrauen −80 ergibt Draht −25 und hieße sonst nur „verstimmt".
 *   • `mentor`/`schuetzling` über `partner`, weil sie das Spezifischere sind.
 *     `istPartner` ist davon unabhängig – die Ansicht zeigt beides.
 *   • `band` unter den warmen Arten, damit sie das bedeutet, was sie sagt:
 *     Ihr habt ein Album zusammen, und seither ist es abgekühlt.
 *
 * `beefOffen` wird hereingereicht, nicht gelesen – der Aufrufer hat den Beef
 * sowieso in der Hand (`contacts.detail` fragt ihn heute schon).
 */
function artOf({ respekt, vertrauen, boden = 0, meine = 0, seine = 0,
  trait = null, beefOffen = false }) {
  const draht = drahtVon(respekt, vertrauen);
  const erGroesser = Math.max(1, seine) / Math.max(1, meine);
  const ichGroesser = Math.max(1, meine) / Math.max(1, seine);

  if (beefOffen) return 'beef';
  if (respekt >= data.ART_RIVALE_RESPEKT
    && vertrauen <= data.ART_RIVALE_VERTRAUEN) return 'rivale';
  if (draht <= data.STUFE_VERSTIMMT) return 'verstimmt';
  if (erGroesser >= data.ART_ABSTAND && respekt >= data.ART_MENTOR_RESPEKT
    && vertrauen >= data.ART_MENTOR_VERTRAUEN) return 'mentor';
  if (ichGroesser >= data.ART_ABSTAND
    && vertrauen >= data.ART_SCHUETZLING_VERTRAUEN) return 'schuetzling';
  if (istPartner(respekt, vertrauen)) return 'partner';
  if (boden >= data.ART_BAND_BODEN) return 'band';
  if (trait === 'geschaeftlich'
    && respekt >= data.ART_GESCHAEFTLICH_RESPEKT) return 'geschaeftlich';
  if (draht >= data.STUFE_BEKANNT) return 'bekannt';
  return 'fremd';
}
```

Die fünf Aufrufer (in `listFor`, `detail`, `request` und zweimal in dessen Rückgabe) rufen danach `istPartner(a.respekt, a.vertrauen)` beziehungsweise `istPartner(respektNeu, vertrauenNeu)` — sie werden in Step 4 und Step 5 ohnehin angefasst. `module.exports`: `istPartner, artOf` hinein.

- [ ] **Step 7: `istPartner` und `artOf` testen**

An `test/beziehungen.test.js` anfügen:

```js
  console.log('--- Fester Partner: eine Regel ---');
  {
    const contacts = require('../src/contacts');
    check('beide oben', contacts.istPartner(50, 50) === true);
    check('Respekt knapp drunter', contacts.istPartner(49, 50) === false);
    check('Vertrauen knapp drunter', contacts.istPartner(50, 49) === false);
    // Der Fall, den die alte Regel durchließ: Draht 50 ohne jedes Vertrauen.
    check('Respekt 100 und Vertrauen 0 ist KEIN Partner',
      contacts.istPartner(100, 0) === false);
    check('beide unten', contacts.istPartner(0, 0) === false);
  }

  console.log('--- Die Art der Beziehung ---');
  {
    const contacts = require('../src/contacts');
    const art = (o) => contacts.artOf({ meine: 100_000, seine: 100_000, ...o });

    check('offener Beef schlägt alles',
      art({ respekt: 90, vertrauen: 90, boden: 30, beefOffen: true }) === 'beef');
    check('Rivale: Respekt 30, Vertrauen −20',
      art({ respekt: 30, vertrauen: -20 }) === 'rivale');
    check('Respekt 29 ist kein Rivale',
      art({ respekt: 29, vertrauen: -20 }) === 'fremd',
      art({ respekt: 29, vertrauen: -20 }));
    check('Vertrauen −19 ist kein Rivale',
      art({ respekt: 30, vertrauen: -19 }) === 'fremd',
      art({ respekt: 30, vertrauen: -19 }));
    // Der Zustand, den eine Zahl nicht ausdrücken kann: Draht −25, aber Rivale.
    check('der Rivale bei Draht −25 wird NICHT verstimmt',
      art({ respekt: 30, vertrauen: -80 }) === 'rivale',
      art({ respekt: 30, vertrauen: -80 }));
    check('verstimmt bei Draht −20 ohne Respekt',
      art({ respekt: 0, vertrauen: -40 }) === 'verstimmt');
    check('Draht −19 ist nicht verstimmt',
      art({ respekt: 0, vertrauen: -38 }) === 'fremd',
      art({ respekt: 0, vertrauen: -38 }));

    const gross = { meine: 100_000, seine: 10_000_000 };
    check('Mentor', contacts.artOf({ ...gross, respekt: 50, vertrauen: 40 }) === 'mentor');
    check('Respekt 49 ist kein Mentor',
      contacts.artOf({ ...gross, respekt: 49, vertrauen: 40 }) === 'bekannt',
      contacts.artOf({ ...gross, respekt: 49, vertrauen: 40 }));
    check('Vertrauen 39 ist kein Mentor',
      contacts.artOf({ ...gross, respekt: 50, vertrauen: 39 }) === 'bekannt',
      contacts.artOf({ ...gross, respekt: 50, vertrauen: 39 }));
    check('Faktor 10 reicht für den Mentor',
      contacts.artOf({ meine: 100_000, seine: 1_000_000, respekt: 50, vertrauen: 40 }) === 'mentor');
    check('Faktor 9,99999 reicht nicht',
      contacts.artOf({ meine: 100_000, seine: 999_999, respekt: 50, vertrauen: 40 }) === 'bekannt',
      contacts.artOf({ meine: 100_000, seine: 999_999, respekt: 50, vertrauen: 40 }));
    // Die Reihenfolge-Absicht aus der Spec: Mentor steht ÜBER Partner, das
    // ⭐ hängt daran aber nicht.
    check('Mentor schlägt Partner',
      contacts.artOf({ ...gross, respekt: 60, vertrauen: 60 }) === 'mentor');
    check('…und ist trotzdem fester Partner', contacts.istPartner(60, 60) === true);

    check('Schützling',
      contacts.artOf({ meine: 10_000_000, seine: 100_000, respekt: 0, vertrauen: 40 }) === 'schuetzling');
    check('Partner bei gleicher Größe', art({ respekt: 50, vertrauen: 50 }) === 'partner');
    check('alte Band: Boden 10 ohne warme Achsen',
      art({ respekt: 0, vertrauen: 0, boden: 10 }) === 'band');
    check('Boden 9 ist keine Band',
      art({ respekt: 0, vertrauen: 0, boden: 9 }) === 'fremd',
      art({ respekt: 0, vertrauen: 0, boden: 9 }));
    // Die zweite Reihenfolge-Absicht: band steht UNTER den warmen Arten.
    check('warme Band wird Partner, nicht Band',
      art({ respekt: 70, vertrauen: 70, boden: 10 }) === 'partner',
      art({ respekt: 70, vertrauen: 70, boden: 10 }));
    check('geschäftlich',
      art({ respekt: 40, vertrauen: 0, trait: 'geschaeftlich' }) === 'geschaeftlich');
    check('derselbe Respekt ohne den Charakterzug ist nur bekannt',
      art({ respekt: 40, vertrauen: 0, trait: 'kollegial' }) === 'bekannt',
      art({ respekt: 40, vertrauen: 0, trait: 'kollegial' }));
    check('bekannt bei Draht 20', art({ respekt: 20, vertrauen: 20 }) === 'bekannt');
    check('fremd bei null', art({ respekt: 0, vertrauen: 0 }) === 'fremd');

    // Jede der zehn Arten muss erreichbar sein – sonst ist eine Schwelle tot.
    const alle = new Set([
      art({ respekt: 0, vertrauen: 0, beefOffen: true }),
      art({ respekt: 30, vertrauen: -80 }),
      art({ respekt: 0, vertrauen: -40 }),
      contacts.artOf({ ...gross, respekt: 50, vertrauen: 40 }),
      contacts.artOf({ meine: 10_000_000, seine: 100_000, respekt: 0, vertrauen: 40 }),
      art({ respekt: 50, vertrauen: 50 }),
      art({ respekt: 0, vertrauen: 0, boden: 10 }),
      art({ respekt: 40, vertrauen: 0, trait: 'geschaeftlich' }),
      art({ respekt: 20, vertrauen: 20 }),
      art({ respekt: 0, vertrauen: 0 }),
    ]);
    check('alle zehn Arten sind erreichbar', alle.size === 10,
      `${alle.size}: ${[...alle].join(', ')}`);
  }
```

- [ ] **Step 8: Die Zahlentabelle der Spec als Test**

An `test/beziehungen.test.js` anfügen:

```js
  console.log('--- Antwortchance: die Tabelle der Spec ---');
  {
    const contacts = require('../src/contacts');
    // Neutrale Anfrage, gleiches Land, gleiche Sprache, gleiches Genre weg –
    // gemessen wird der Beziehungs-Summand, nicht die Beiwerke.
    const arg = (meine, seine, respekt, vertrauen = 0) => ({
      meineReichweite: meine, seineReichweite: seine, request: 'shoutout',
      gleichesLand: false, sprache: 'englisch', genre: 'verwandt',
      respekt, vertrauen, tuerOeffner: 0, hype: 1, trait: 'launisch',
      partner: false, szene: 0,
    });
    const c = (...a) => contacts.chanceOf(arg(...a));
    const tabelle = [
      // meine,     seine,  R,   erwartet
      [100_000,   100_000,   0, 0.6000],
      [100_000,   100_000,  50, 0.6600],
      [100_000,   100_000, 100, 0.7200],
      [100_000, 1_000_000,   0, 0.1897],
      [100_000, 1_000_000, 100, 0.4197],
      [100_000, 10_000_000,  0, 0.0600],
      [100_000, 10_000_000, 50, 0.2300],
      [100_000, 10_000_000, 100, 0.4000],
      [10_000,  10_000_000, 50, 0.2440],
      [10_000,  10_000_000, 100, 0.4690],
    ];
    for (const [m, s, r, soll] of tabelle) {
      check(`${m} → ${s} bei Respekt ${r}: ${(soll * 100).toFixed(1)} %`,
        near(c(m, s, r), soll, 5e-5), String(c(m, s, r)));
    }

    check('positives Vertrauen hebt die Chance NICHT',
      near(c(100_000, 10_000_000, 50, 0), c(100_000, 10_000_000, 50, 100), 1e-12));

    // Der Riegel: Dauer-Beefer mit Respekt 20 und Vertrauen −100.
    check('Dauer-Beefer landet auf CHANCE_MIN',
      near(c(100_000, 10_000_000, 20, -100), 0.02),
      String(c(100_000, 10_000_000, 20, -100)));
    check('…ohne den Malus wäre er über dem Fremden',
      c(100_000, 10_000_000, 20, 0) > c(100_000, 10_000_000, 0, 0));
  }

  console.log('--- Die Schreibwege ---');
  {
    const contacts = require('../src/contacts');
    const T = 1_700_000_000_000;
    const DAY = 86_400_000;

    // move: addiert, klemmt, kühlt vorher faul ab.
    db.saveContact(G, 'u2', 'drake',
      { respekt: 40, vertrauen: 40, boden: 0, last_move: T });
    const m1 = contacts.move(G, 'u2', 'drake', { respekt: 10, vertrauen: -20 }, T);
    check('move addiert beide Achsen',
      m1.achsen.respekt === 50 && m1.achsen.vertrauen === 20, JSON.stringify(m1.achsen));
    check('move meldet den Draht vorher und nachher',
      m1.vorher === 40 && m1.nachher === 35, `${m1.vorher}/${m1.nachher}`);

    // Vier Wochen später: Respekt −4, Vertrauen −12.
    const spaet = T + 28 * DAY;
    const a = contacts.achsenJetzt(db.getContact(G, 'u2', 'drake'), spaet);
    check('Respekt kühlt mit 1 je Woche', a.respekt === 46, String(a.respekt));
    check('Vertrauen kühlt mit 3 je Woche', a.vertrauen === 8, String(a.vertrauen));
    check('der Draht kühlt mit den alten 2', a.draht === 27, String(a.draht));
    check('Lesen hat nichts geschrieben (§4)',
      db.getContact(G, 'u2', 'drake').respekt === 50);

    // Der Boden hebt das Vertrauen mit.
    db.saveContact(G, 'u3', 'anitta', { respekt: 0, vertrauen: 2, boden: 0, last_move: T });
    const m2 = contacts.move(G, 'u3', 'anitta', { boden: 10 }, T);
    check('der Boden hebt das Vertrauen auf seine Höhe',
      m2.achsen.boden === 10 && m2.achsen.vertrauen === 10, JSON.stringify(m2.achsen));
    const m3 = contacts.move(G, 'u3', 'anitta', { boden: 30 }, T);
    check('der Boden ist bei 30 gedeckelt', m3.achsen.boden === 30, String(m3.achsen.boden));

    // setzeVertrauen: nur die Versöhnung benutzt es.
    db.saveContact(G, 'u4', 'ezhel', { respekt: 20, vertrauen: -70, boden: 0, last_move: T });
    const m4 = contacts.move(G, 'u4', 'ezhel', { setzeVertrauen: -40 }, T);
    check('setzeVertrauen setzt statt zu addieren',
      m4.achsen.vertrauen === -40 && m4.achsen.respekt === 20, JSON.stringify(m4.achsen));

    // merken schreibt eine Gedächtniszeile mit den echten Deltas.
    contacts.move(G, 'u4', 'ezhel',
      { respekt: 5, vertrauen: 5, merken: { art: 'frieden', detail: '' } }, T);
    const mem = db.memoryOf(G, 'u4', 'ezhel', 1);
    check('merken schreibt mit den echten Deltas',
      mem.length === 1 && mem[0].art === 'frieden'
      && mem[0].d_respekt === 5 && mem[0].d_vertrauen === 5, JSON.stringify(mem));
    check('ohne merken keine Zeile', db.memoryCount(G, 'u2', 'drake') === 0);
  }
```

- [ ] **Step 9: Die Kette durch die ECHTE Schreibmechanik führen**

Der Paritätstest aus Task 2 baut die Wochenzählung (`Math.floor(tage / 7) * rate`) und die ±100-Klemme im **Test** nach. Damit deckt er die Produktivlogik nicht: Ein falsch verdrahtetes `move` oder `achsenJetzt` fiele dort nicht auf.

Ergänze in `test/beziehungen.test.js` eine Zusicherung, die dieselbe Ereignisfolge durch `contacts.move` und `contacts.achsenJetzt` schickt — mit echten Zeitstempeln, über eine echte Zeile in der Datenbank — und mit dem von Hand gerechneten Ergebnis vergleicht. Zwei Fälle genügen, beide mit den **echten** Paaren aus `data.ACHSEN`:

- **Zwanzig echte Antworten** (`ACHSEN.echt`, je `respekt +9 / vertrauen +3`), alle am selben Tag: Respekt sättigt bei 100, Vertrauen steht bei 60, der Draht ist **80**. Die alte Kette ergab hier 100 — die Abweichung ist das Design und wird hier festgehalten, nicht versteckt.
- **Respekt 50, Vertrauen −50** (Draht 0), dann vier Wochen nichts: Respekt 46, Vertrauen −38, Draht **4**. Nach zehn Wochen: Respekt 40, Vertrauen −20, Draht **10**. Die alte Kette blieb beide Male bei 0, weil ein Draht von 0 nicht abkühlt.

Diese zwei Zusicherungen sind die einzigen, die die Wochenzählung und die Klemme der **Produktivlogik** prüfen.

- [ ] **Step 10: `test/contacts.test.js` nachziehen**

Die Fälle, die `contacts.drahtStufe` aufrufen, auf `contacts.artOf` umstellen. Die alten Erwartungen übersetzen:

| alt | neu |
|---|---|
| `drahtStufe(0) === 'neutral'` | `artOf({ respekt: 0, vertrauen: 0 }) === 'fremd'` |
| `drahtStufe(20) === 'bekannt'` | `artOf({ respekt: 20, vertrauen: 20 }) === 'bekannt'` |
| `drahtStufe(50) === 'partner'` | `artOf({ respekt: 50, vertrauen: 50 }) === 'partner'` |
| `drahtStufe(-20) === 'verstimmt'` | `artOf({ respekt: 0, vertrauen: -40 }) === 'verstimmt'` |
| `drahtStufe(-50) === 'beef'` | **entfällt** — `beef` heißt jetzt „offener Beef", nicht „Draht ≤ −50". Ein Draht von −50 ohne Beef ist `verstimmt` oder `rivale`. |

Fälle, die `contacts.chanceOf({ …, draht: N })` aufrufen, auf `respekt: N, vertrauen: N` umstellen — **und die Erwartung neu rechnen**, nicht blind übernehmen: Das Gewicht ist bei gleicher Größe 0,12 statt 0,25. Wo der alte Test eine Zahl hart kodiert hat, wird sie mit `contacts.respektGewicht` ausgedrückt, damit sie nicht wieder einfriert.

Fälle mit `contacts.stufeVon(r, { ratio, draht })` auf `{ ratio, respekt }` umstellen.

- [ ] **Step 11: Beide Tests laufen lassen**

```bash
rm -rf .testdata && DATA_DIR=.testdata node test/beziehungen.test.js
rm -rf .testdata && DATA_DIR=.testdata node test/contacts.test.js
```

Erwartet: beide `0 fehlgeschlagen`.

- [ ] **Step 12: Commit**

```bash
git add src/contacts.js test/contacts.test.js test/beziehungen.test.js
git commit -m "beziehungen: contacts.js auf die achsen - move, chance, art"
```

---

## Task 4: Angebote, Projekte und das Vertrauens-Tor

**Files:**
- Modify: `src/data/angebote.js` (Draht-Abschnitt Zeile 77–81, `ARTEN` Zeile 135–140, `module.exports`)
- Modify: `src/data/contacts.js` (`REQUESTS` → `konzert`, Zeile 112)
- Modify: `src/angebote.js` (`artenFuer` 208, `zustellen` 227, `settle` 277 Schritte 1 und 2, `annehmen` 610, `ablehnen` 645, `abschliessen` 694)
- Test: `test/beziehungen.test.js`, `test/angebote.test.js`

**Interfaces:**
- Consumes: `contacts.move`, `contacts.achsenJetzt`, `contacts.drahtJetzt` aus Task 3.
- Produces: `angebote.artenFuer(guildId, userId, { draht, vertrauen }, now)` — **die Signatur ändert sich**, das dritte Argument ist jetzt ein Objekt statt einer Zahl.

- [ ] **Step 1: Die Konstanten und die zwei Tore**

In `src/data/angebote.js` den Abschnitt `// --- Draht ---` ersetzen:

```js
// --- Achsen ----------------------------------------------------------------

/**
 * Was eine Gegenanfrage an den zwei Achsen macht. Die ersten drei Mittelwerte
 * sind identisch zu den alten Draht-Deltas (+8 / −5 / −8); eine angenommene
 * Anfrage bringt vor allem VERTRAUEN, eine saubere Absage kostet kaum Respekt.
 */
const ACHSEN_AN = { respekt: 4, vertrauen: 12 };        // Mittel  +8
const ACHSEN_AB = { respekt: -2, vertrauen: -8 };       // Mittel  −5
const ACHSEN_VERFALL = { respekt: -4, vertrauen: -12 }; // Mittel  −8

/**
 * Die zwei NEUEN Bewegungen – vorher bewegte ein abgeschlossenes Album zu
 * zweit null Punkte Draht, und ein verrottetes Projekt ebenfalls null. Das
 * Durchziehen und das Vermasseln waren für die Beziehung unsichtbar.
 *
 * Ein bezahltes Album verrotten zu lassen ist der härteste Vertrauensverlust
 * im Spiel – härter als eine verfallene Anfrage, weil die Stunden schon
 * investiert waren.
 */
const ACHSEN_FERTIG = { respekt: 6, vertrauen: 18 };    // Mittel +12 (vorher 0)
const ACHSEN_PFUSCH = { respekt: -6, vertrauen: -20 };  // Mittel −13 (vorher 0)

/**
 * Was den Vertrauens-Boden hebt – NUR Durchgezogenes.
 *
 * `tausch`, `gastpart`, `vorgruppe` und `label` sind mit der Annahme erledigt
 * und buchen BODEN_AN sofort. `kollabo` und `tour` erzeugen ein Projekt und
 * buchen erst beim Abschluss, dann über BODEN_FERTIG – nicht beides.
 */
const BODEN_AN = 3;
const BODEN_FERTIG = 10;
```

`ARTEN` (Zeile 135) — die drei großen Formate hängen ans Vertrauen. **Jede Art trägt genau eines der beiden Felder**, nie beide:

```js
const ARTEN = [
  { id: 'tausch', name: 'Gegenseitige Erwähnung', emoji: '🔁', time: 2, minDraht: 20, minVertrauen: null },
  { id: 'gastpart', name: 'Gastpart auf der neuen Platte', emoji: '🎙️', time: 2, minDraht: 20, minVertrauen: null },
  { id: 'vorgruppe', name: 'Vorgruppe beim nächsten Konzert', emoji: '🎪', time: 4, minDraht: 20, minVertrauen: null },
  { id: 'kollabo', name: 'Gemeinsames Album', emoji: '💿', time: 0, minDraht: null, minVertrauen: 50 },
  { id: 'tour', name: 'Tour zu zweit', emoji: '🎵', time: 0, minDraht: null, minVertrauen: 50 },
  { id: 'label', name: 'Einführung beim Label', emoji: '📝', time: 2, minDraht: null, minVertrauen: 50 },
];
```

In `src/data/contacts.js` die Konstante ergänzen und `REQUESTS` → `konzert` umhängen:

```js
/** Eine gemeinsame Bühne ist eine Verpflichtung – sie hängt am Vertrauen. */
const KONZERT_VERTRAUEN = 20;
```

```js
  { id: 'konzert', name: 'Gemeinsam auf die Bühne', emoji: '🎪', time: KONTAKT_TIME, schwierigkeit: -0.20, minDraht: null, minVertrauen: KONZERT_VERTRAUEN },
```

Die anderen drei `REQUESTS` bekommen `minVertrauen: null`. `KONZERT_VERTRAUEN` exportieren.

> **Reihenfolge, damit kein Loch entsteht:** Task 3 hat die Prüfung `r.minVertrauen != null` schon gebaut und liest bis hierhin `undefined`, also nichts. `konzert` behielt dort `minDraht: 20` und war durchgehend bewacht. Erst dieser Schritt hängt es um — kein Zeitfenster, in dem das Tor offen steht.

`module.exports` in `data/angebote.js`: `DRAHT_AN, DRAHT_AB, DRAHT_VERFALL` heraus; `ACHSEN_AN, ACHSEN_AB, ACHSEN_VERFALL, ACHSEN_FERTIG, ACHSEN_PFUSCH, BODEN_AN, BODEN_FERTIG` hinein.

- [ ] **Step 2: `artenFuer` nimmt beide Achsen**

```js
function artenFuer(guildId, userId, achsen, now) {
  const projektOffen = db.projekteOf(guildId, userId).some((p) => p.status === 'offen');
  const grossOffen = db.angeboteOf(guildId, userId).some((r) => r.status === 'offen'
    && r.frist > now && (r.art === 'kollabo' || r.art === 'tour'));
  const vertrag = Boolean(db.activeContract(guildId, userId))
    || Boolean(db.openContract(guildId, userId, now));
  return data.ARTEN.filter((a) => {
    // Die kleinen Formate hängen am Draht, die drei großen am Vertrauen:
    // Wer sich auf mehrere Tage einlässt, muss sich auf dich verlassen.
    if (a.minDraht != null && achsen.draht < a.minDraht) return false;
    if (a.minVertrauen != null && achsen.vertrauen < a.minVertrauen) return false;
    if (a.id === 'label') return !vertrag;
    if (a.id === 'kollabo' || a.id === 'tour') return !projektOffen && !grossOffen;
    return true;
  });
}
```

In `zustellen` (Zeile 236) `const draht = contacts.drahtJetzt(row, now)` zu `const achsen = contacts.achsenJetzt(row, now)`; `gewichtOf({ draht: achsen.draht, passung: … })` (das Gewicht bleibt am Draht — ob er sich überhaupt meldet, ist die Gesamtwärme); `kandidaten.push({ c, g, achsen })`; der Aufruf wird `artenFuer(guildId, userId, treffer.achsen, now)`.

Jede weitere Stelle, die `artenFuer` aufruft, mitziehen: `grep -n 'artenFuer' src/`.

- [ ] **Step 3: Die fünf Schreibstellen**

Alle `contacts.moveDraht(..., data.DRAHT_*, now)` zu `contacts.move(..., { ...paar, boden, merken }, now)`:

`settle` Schritt 1, verfallene Anfrage (Zeile 291):

```js
    const draht = contacts.move(guildId, userId, row.contact_id, {
      ...data.ACHSEN_VERFALL,
      merken: { art: 'angebot_verfallen', detail: artOf(row.art)?.name ?? row.art },
    }, now);
```

`settle` Schritt 2, verfallenes Projekt (Zeile 304) — **neu**, hier bewegte sich vorher nichts:

```js
    const neu = db.saveProjekt(guildId, row.id, { status: 'verfallen' });
    const contact = katalog.byId(row.contact_id);
    // NEU in 6a: Ein bezahltes Projekt verrotten zu lassen kostet Vertrauen.
    // Vorher war der härteste Fehlgriff des Systems am Draht unsichtbar.
    const draht = contacts.move(guildId, userId, row.contact_id, {
      ...data.ACHSEN_PFUSCH,
      merken: { art: 'projekt_verfallen', detail: artOf(row.art)?.name ?? row.art },
    }, now);
    ereignisse.push({
      art: 'projekt_verfallen', contact, draht,
      projekt: { ...neu, artInfo: artOf(row.art), contact },
    });
```

`annehmen` (Zeile 610) — der Boden nur, wenn kein Projekt entsteht:

```js
  const angebot = db.saveAngebot(guildId, id, { status: 'an' });
  const draht = contacts.move(guildId, userId, row.contact_id, {
    ...data.ACHSEN_AN,
    // kollabo und tour sind mit der Annahme NICHT erledigt – ihr Boden kommt
    // beim Abschluss über BODEN_FERTIG. Sonst zählte dasselbe zweimal.
    boden: projekt ? 0 : data.BODEN_AN,
    merken: { art: 'angebot_an', detail: art.name },
  }, now);
```

`ablehnen` (Zeile 645) — ohne Gedächtniseintrag, eine saubere Absage ist keine Geschichte:

```js
  const draht = contacts.move(guildId, userId, row.contact_id, data.ACHSEN_AB, now);
```

`abschliessen`, im `fertig`-Helfer (Zeile 694) — **eine** Stelle für beide Wege:

```js
  const fertig = () => {
    const projekt = db.saveProjekt(guildId, p.id,
      { status: 'fertig', stundenIst: p.stunden_soll });
    // NEU in 6a: Das Durchziehen zählt. Der Boden hält das Vertrauen danach
    // dauerhaft – ein Album zu zweit ist nach einem halben Jahr Funkstille
    // nicht nichts.
    contacts.move(guildId, userId, p.contact_id, {
      ...data.ACHSEN_FERTIG, boden: data.BODEN_FERTIG,
      merken: { art: 'projekt_fertig', detail: artOf(p.art)?.name ?? p.art },
    }, now);
    return projekt;
  };
```

`require('./contacts')` steht in `abschliessen` noch nicht — am Kopf der Funktion ergänzen (spät binden, §8).

- [ ] **Step 4: Test schreiben**

An `test/beziehungen.test.js` anfügen:

```js
  console.log('--- Angebote: Tore und Achsen ---');
  {
    const adata = require('../src/data/angebote');
    const cdata = require('../src/data/contacts');

    check('jede Angebotsart trägt genau EIN Tor',
      adata.ARTEN.every((a) =>
        (a.minDraht == null) !== (a.minVertrauen == null)),
      JSON.stringify(adata.ARTEN.map((a) => [a.id, a.minDraht, a.minVertrauen])));
    check('die drei großen Formate hängen am Vertrauen',
      ['kollabo', 'tour', 'label'].every((id) =>
        adata.ARTEN.find((a) => a.id === id).minVertrauen === 50));
    check('die drei kleinen hängen am Draht',
      ['tausch', 'gastpart', 'vorgruppe'].every((id) =>
        adata.ARTEN.find((a) => a.id === id).minDraht === 20));
    check('jede Anfrageart trägt höchstens EIN Tor',
      cdata.REQUESTS.every((r) => !(r.minDraht != null && r.minVertrauen != null)));
    check('die gemeinsame Bühne hängt am Vertrauen',
      cdata.REQUESTS.find((r) => r.id === 'konzert').minVertrauen === 20
      && cdata.REQUESTS.find((r) => r.id === 'konzert').minDraht === null);

    // Die Mittelwerte: drei wie früher, zwei neu.
    const mittel = (p) => (p.respekt + p.vertrauen) / 2;
    check('ACHSEN_AN mittelt auf die alten +8', mittel(adata.ACHSEN_AN) === 8);
    check('ACHSEN_AB mittelt auf die alten −5', mittel(adata.ACHSEN_AB) === -5);
    check('ACHSEN_VERFALL mittelt auf die alten −8', mittel(adata.ACHSEN_VERFALL) === -8);
    check('ACHSEN_FERTIG ist neu und positiv', mittel(adata.ACHSEN_FERTIG) === 12);
    check('ACHSEN_PFUSCH ist neu und der härteste Verlust',
      adata.ACHSEN_PFUSCH.vertrauen < adata.ACHSEN_VERFALL.vertrauen
      && adata.ACHSEN_PFUSCH.vertrauen === -20);
    check('Verfallen kostet mehr Vertrauen als Absagen',
      adata.ACHSEN_VERFALL.vertrauen < adata.ACHSEN_AB.vertrauen);
    check('Absagen kostet kaum Respekt',
      Math.abs(adata.ACHSEN_AB.respekt) < Math.abs(adata.ACHSEN_AB.vertrauen));
    check('nur Durchgezogenes hebt den Boden',
      adata.BODEN_FERTIG === 10 && adata.BODEN_AN === 3);
  }
```

In `test/angebote.test.js` die Fälle nachziehen, die `artenFuer` mit einer Zahl aufrufen oder `moveDraht` erwarten. Zusätzlich **zwei neue Fälle**, die vorher nicht prüfbar waren:

```js
    // 6a: Ein abgeschlossenes Projekt bewegt die Beziehung – vorher nichts.
    // (Der genaue Aufbau folgt dem bestehenden Kollabo-Fall in dieser Datei.)
    check('abgeschlossenes Projekt hebt Vertrauen und setzt den Boden',
      nach.vertrauen - vor.vertrauen === 18 && nach.boden === 10,
      `${vor.vertrauen} → ${nach.vertrauen}, Boden ${nach.boden}`);
    check('verfallenes Projekt kostet Vertrauen',
      nachVerfall.vertrauen - vorVerfall.vertrauen === -20,
      `${vorVerfall.vertrauen} → ${nachVerfall.vertrauen}`);
```

- [ ] **Step 5: Tests laufen lassen**

```bash
rm -rf .testdata && DATA_DIR=.testdata node test/beziehungen.test.js
rm -rf .testdata && DATA_DIR=.testdata node test/angebote.test.js
```

Erwartet: beide `0 fehlgeschlagen`.

- [ ] **Step 6: Commit**

```bash
git add src/data/angebote.js src/data/contacts.js src/angebote.js test/angebote.test.js test/beziehungen.test.js
git commit -m "beziehungen: angebote auf die achsen, das durchziehen zaehlt endlich"
```

---

## Task 5: Beef, der Frieden und die Partner-Regel

**Files:**
- Modify: `src/data/beef.js` (Draht-Abschnitt Zeile 144–150, `module.exports` Zeile 335)
- Modify: `src/beef.js` (Zeilen 246, 251, 332, 399, 421, 469, 598)
- Test: `test/beziehungen.test.js`, `test/beef.test.js`

**Interfaces:**
- Consumes: `contacts.move`, `contacts.istPartnerRow` aus Task 3.
- Produces: `beef.friedenZiel(vertrauen) -> number` — reine Funktion, damit der Deckel prüfbar ist, ohne die Formel im Test zu wiederholen.

- [ ] **Step 1: Die Konstanten**

In `src/data/beef.js` den Abschnitt `// --- Draht ---` ersetzen:

```js
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
 * zugesagt, du hast dich nur vorgeführt.
 */
const ACHSEN_ANSTACHELN = { respekt: 0, vertrauen: -24 };    // Mittel −12 (vorher −15)
const ACHSEN_BLAMAGE = { respekt: -10, vertrauen: -4 };      // Mittel  −7 (vorher  −5)
const ACHSEN_DISS = { respekt: 10, vertrauen: -36 };         // Mittel −13 (vorher −20)
const ACHSEN_KONTER = { respekt: -6, vertrauen: -14 };       // Mittel −10 (wie vorher)
const ACHSEN_ANGEZAEHLT = { respekt: -4, vertrauen: -16 };   // Mittel −10 (wie vorher)
```

Die fünf `DRAHT_*` löschen. `FRIEDEN_PLUS` (30) und `FRIEDEN_DECKEL` (−10) bleiben unverändert — sie wirken jetzt auf Vertrauen. Den Kommentar dort nachziehen:

```js
// --- Frieden ---------------------------------------------------------------

/**
 * Versöhnung hebt das VERTRAUEN deutlich … (nicht den Respekt: Was du
 * getroffen hast, respektiert er weiterhin – er arbeitet nur wieder mit dir.)
 */
const FRIEDEN_PLUS = 30;
/** … aber nie ins Plus: Beef anfangen ist keine Abkürzung zum Partner. */
const FRIEDEN_DECKEL = -10;
```

`module.exports`: die fünf `DRAHT_*` heraus, die fünf `ACHSEN_*` hinein.

- [ ] **Step 2: Die sechs Schreibstellen**

`anstacheln`, Einstieg (Zeile 246):

```js
    draht = contacts.move(guildId, userId, contactId, {
      ...data.ACHSEN_ANSTACHELN, merken: { art: 'beef_start', detail: '' },
    }, now, { sperre: true });
```

`anstacheln`, Blamage (Zeile 251):

```js
    draht = contacts.move(guildId, userId, contactId, {
      ...data.ACHSEN_BLAMAGE, merken: { art: 'blamage', detail: '' },
    }, now, { sperre: true });
```

`diss` (Zeile 332):

```js
  const draht = contacts.move(guildId, userId, contactId, {
    ...data.ACHSEN_DISS, merken: { art: 'diss', detail: '' },
  }, now);
```

`anzaehlen` (Zeile 421):

```js
  const draht = contacts.move(guildId, userId, c.id, {
    ...data.ACHSEN_ANGEZAEHLT, merken: { art: 'angezaehlt', detail: '' },
  }, now);
```

`settle`, Konter (Zeile 469):

```js
        const draht = contacts.move(guildId, userId, row.contact_id, {
          ...data.ACHSEN_KONTER, merken: { art: 'konter', detail: '' },
        }, now);
```

- [ ] **Step 3: Der Frieden setzt Vertrauen, nicht den Draht**

Zeile 598 ersetzen. Die Deckel-Logik bleibt wortgleich, sie wirkt nur auf die andere Achse:

```js
  // Der Deckel ist eine Bremse nach oben, kein Zug nach unten: Wer trotz Beef
  // noch über FRIEDEN_DECKEL steht (anstacheln hat keine Voraussetzung, ein
  // Partner kann also angestachelt werden), behält sein Vertrauen. Sonst
  // würde die freundlichste Schaltfläche des Spiels bis zu 110 Punkte
  // verbrennen, die bloßes Auskühlen gar nichts gekostet hätte.
  //
  // Respekt bleibt unberührt: Was du getroffen hast, respektiert er weiter.
  const vorherAchsen = contacts.achsenJetzt(
    db.getContact(guildId, userId, contactId), now);
  const draht = contacts.move(guildId, userId, contactId, {
    setzeVertrauen: friedenZiel(vorherAchsen.vertrauen),
    merken: { art: 'frieden', detail: '' },
  }, now, { sperre: true });
```

Die Formel bekommt dabei einen **Namen** und steht in der reinen Hälfte von `src/beef.js`, exportiert — sonst kann sie nur geprüft werden, indem ein Test sie nachrechnet und damit sich selbst bestätigt:

```js
/** Wohin die Versöhnung das Vertrauen hebt – gedeckelt, nie nach unten. */
function friedenZiel(vertrauen) {
  return Math.max(vertrauen,
    Math.min(data.FRIEDEN_DECKEL, vertrauen + data.FRIEDEN_PLUS));
}
```

- [ ] **Step 4: Die Partner-Regel in der Anzählrunde**

Zeile 399: `if (contacts.drahtJetzt(z, now) >= cdata.STUFE_PARTNER) continue;` wird zu

```js
    // Wer fester Partner ist, zählt dich nicht an – dieselbe Regel, die das ⭐
    // und den Türöffner trägt. Vorher stand hier eine dritte Fassung.
    if (contacts.istPartnerRow(z, now)) continue;
```

- [ ] **Step 5: Test schreiben**

An `test/beziehungen.test.js` anfügen:

```js
  console.log('--- Beef: Respekt rauf, Vertrauen runter ---');
  {
    const bdata = require('../src/data/beef');
    const mittel = (p) => (p.respekt + p.vertrauen) / 2;

    // Der Kern des ganzen Stücks: Der gelandete Diss hebt den Respekt.
    check('der gelandete Disstrack HEBT den Respekt',
      bdata.ACHSEN_DISS.respekt > 0, String(bdata.ACHSEN_DISS.respekt));
    check('…und zerstört das Vertrauen',
      bdata.ACHSEN_DISS.vertrauen === -36, String(bdata.ACHSEN_DISS.vertrauen));
    check('Anstacheln bringt keinen Respekt',
      bdata.ACHSEN_ANSTACHELN.respekt === 0);
    check('die Blamage kostet Respekt, nicht Vertrauen',
      bdata.ACHSEN_BLAMAGE.respekt < bdata.ACHSEN_BLAMAGE.vertrauen,
      JSON.stringify(bdata.ACHSEN_BLAMAGE));
    check('Konter mittelt auf die alten −10', mittel(bdata.ACHSEN_KONTER) === -10);
    check('Angezählt mittelt auf die alten −10', mittel(bdata.ACHSEN_ANGEZAEHLT) === -10);

    // Ein ganzer Beef-Durchlauf: Respekt netto leicht hoch, Vertrauen am Boden,
    // der Draht trotzdem klar im Minus – und damit jedes Tor zu.
    const contacts = require('../src/contacts');
    const rNetto = bdata.ACHSEN_ANSTACHELN.respekt + bdata.ACHSEN_DISS.respekt
      + bdata.ACHSEN_KONTER.respekt;
    const vNetto = bdata.ACHSEN_ANSTACHELN.vertrauen + bdata.ACHSEN_DISS.vertrauen
      + bdata.ACHSEN_KONTER.vertrauen;
    check('nach einem Beef: Respekt netto nicht gesunken', rNetto >= 0, String(rNetto));
    check('nach einem Beef: Vertrauen tief im Minus', vNetto <= -70, String(vNetto));
    check('nach einem Beef sind alle großen Formate zu',
      vNetto < 50 && contacts.drahtVon(rNetto, vNetto) < 20,
      `R ${rNetto}, V ${vNetto}, Draht ${contacts.drahtVon(rNetto, vNetto)}`);
    check('nach einem Beef ist er ein Rivale, nicht nur verstimmt',
      contacts.artOf({ respekt: rNetto, vertrauen: vNetto,
        meine: 100_000, seine: 100_000 }) === 'rivale',
      contacts.artOf({ respekt: rNetto, vertrauen: vNetto,
        meine: 100_000, seine: 100_000 }));

    // Der Frieden hebt Vertrauen bis zum Deckel und rührt den Respekt nicht an.
    // Geprüft wird die PRODUKTIONSFUNKTION, nicht eine Kopie ihrer Formel.
    const beef = require('../src/beef');
    check('der Frieden hebt −70 auf den Deckel −10', beef.friedenZiel(-70) === -40,
      String(beef.friedenZiel(-70)));
    check('…und −20 nur bis −10', beef.friedenZiel(-20) === -10,
      String(beef.friedenZiel(-20)));
    check('…und zieht einen hohen Wert nicht herunter', beef.friedenZiel(20) === 20,
      String(beef.friedenZiel(20)));
  }
```

In `test/beef.test.js` die `moveDraht`-Stellen auf `move` umstellen und die erwarteten Draht-Werte **neu rechnen** (Anstacheln mittelt jetzt −12 statt −15, der Diss −13 statt −20). Die Werte aus den `ACHSEN_*`-Konstanten ableiten, nicht hart kodieren.

- [ ] **Step 6: Tests laufen lassen**

```bash
rm -rf .testdata && DATA_DIR=.testdata node test/beziehungen.test.js
rm -rf .testdata && DATA_DIR=.testdata node test/beef.test.js
```

Erwartet: beide `0 fehlgeschlagen`.

- [ ] **Step 7: Commit**

```bash
git add src/data/beef.js src/beef.js test/beef.test.js test/beziehungen.test.js
git commit -m "beziehungen: beef auf die achsen, der diss hebt den respekt"
```

---

## Task 6: Die Ansicht

**Files:**
- Modify: `src/ui.js` (`DRAHT_STUFEN` 2761, `buildKontakteView` 2969, `buildKontaktView` 3078, `module.exports` 5688)
- Modify: `src/buttons.js` (`anfrageNote` ~658, `beefDraht` ~793)
- Test: `test/fluxer-render.test.js`

**Interfaces:**
- Consumes: `contacts.detail` (mit `respekt`, `vertrauen`, `boden`, `art`), `contacts.listFor`, `db.memoryOf`, `db.memoryCount`, `data.MEMORY_ZEIGEN`, `data.MEMORY_TEXTE`.
- Produces: `ui.ARTEN_NAMEN` (ersetzt `ui.DRAHT_STUFEN`), `ui.achsenZeile(d)`, `ui.gedaechtnisBlock(guildId, userId, contactId, tries, yes, now)`.

- [ ] **Step 1: Die Namen der zehn Arten**

`DRAHT_STUFEN` (Zeile 2761) ersetzen:

```js
/** Die zehn Beziehungsarten – contacts.artOf liefert die Schlüssel. */
const ARTEN_NAMEN = {
  beef: '🔥 Beef',
  rivale: '⚔️ Rivale',
  verstimmt: '🙄 verstimmt',
  mentor: '🎓 Mentor',
  schuetzling: '🐣 Schützling',
  partner: '🤝 fester Partner',
  band: '💿 alte Band',
  geschaeftlich: '💼 geschäftlich',
  bekannt: '👋 bekannt',
  fremd: '· fremd',
};
```

`module.exports`: `DRAHT_STUFEN` heraus, `ARTEN_NAMEN` hinein. Beide Fundstellen in `src/buttons.js` mitziehen.

**Diese Aufgabe trägt die letzten drei Löschungen des Stücks**, weil erst hier ihre Leser verschwinden: `contacts.drahtStufe`, `data.STUFE_BEEF` und das Feld `stufe` in den Rückgabewerten von `contacts.move`, `contacts.moveDraht`, `contacts.listFor`, `contacts.detail` und `contacts.request`. Lösche sie erst, nachdem Step 5 `anfrageNote` und `beefDraht` auf `achsenZeile` umgestellt hat, und prüfe mit `grep -rn 'drahtStufe\|STUFE_BEEF\|DRAHT_STUFEN\|\.stufe' src/ test/ scripts/`, dass niemand mehr daran hängt — **kein Test prüft die betroffenen Zeichenketten**, ein übersehener Leser rendert also still `undefined`.

- [ ] **Step 2: Der dreizeilige Kopf**

In `buildKontaktView` (Zeile 3110) die eine Draht-Zeile durch drei ersetzen:

```js
    `${ARTEN_NAMEN[d.art] ?? ARTEN_NAMEN.fremd}`
      + (d.partner && d.art !== 'partner' ? ' · ⭐ fester Partner' : ''),
    `   Draht ${drahtBar(d.draht)} ${d.draht} · `
      + `${d.tries} ${d.tries === 1 ? 'Versuch' : 'Versuche'}, `
      + `${d.yes} ${d.yes === 1 ? 'Zusage' : 'Zusagen'}`,
    `   Respekt ${drahtBar(d.respekt)} ${d.respekt} · `
      + `Vertrauen ${drahtBar(d.vertrauen)} ${d.vertrauen}`
      + (d.boden > 0 ? ` _(Boden ${d.boden})_` : ''),
```

Die Zeile `if (d.partner) kopf.push('⭐ Fester Partner – das öffnet Türen im Umfeld.')` (Zeile 3123) **löschen** — das ⭐ steht jetzt in der ersten Zeile, und die Aussage über die Türen stimmt ab Task 3 wieder (`tuerOeffnerFor` zählt dieselbe Regel). Die Türöffner-Zeile darunter bleibt, wie sie ist.

In `buildKontakteView` (Zeile 3013) `DRAHT_STUFEN[z.stufe]` zu `ARTEN_NAMEN[z.art]`.

- [ ] **Step 3: Der Gedächtnisblock**

Neue Hilfsfunktion in `src/ui.js`, direkt vor `buildKontaktView`:

```js
/**
 * „Was zwischen euch war" – die neuesten MEMORY_ZEIGEN Zeilen.
 *
 * Die Länge ist durch MEMORY_ZEIGEN gedeckelt und braucht darum keinen
 * Kürzungshelfer: Drei Zeilen à höchstens rund 70 Zeichen können die
 * Beschreibung nicht sprengen. (`buttons.notizAus` passt hier NICHT – sein
 * Überlauftext verweist auf die Vorfall-Ansicht.)
 *
 * Die letzte Zeile deckt „was du nur gewollt hast" ab: Sie kommt aus
 * `tries − yes` und braucht keine Gedächtniszeilen – zwanzig Zeilen
 * „ignoriert" machten die Liste wertlos.
 */
function gedaechtnisBlock(guildId, userId, contactId, tries, yes, now) {
  const cdata = require('./data/contacts');
  const zeilen = db.memoryOf(guildId, userId, contactId, cdata.MEMORY_ZEIGEN);
  const vergeblich = Math.max(0, tries - yes);
  if (!zeilen.length && !vergeblich) return null;

  const out = ['', '📖 **Was zwischen euch war**'];
  for (const m of zeilen) {
    const text = (cdata.MEMORY_TEXTE[m.art] ?? m.art).replace('{detail}', m.detail);
    const d = [
      m.d_respekt ? `${m.d_respekt > 0 ? '+' : ''}${m.d_respekt} Respekt` : null,
      m.d_vertrauen ? `${m.d_vertrauen > 0 ? '+' : ''}${m.d_vertrauen} Vertrauen` : null,
    ].filter(Boolean).join(', ');
    out.push(`• vor ${frist(now - m.at)} · ${text}${d ? ` _(${d})_` : ''}`);
  }
  const gesamt = db.memoryCount(guildId, userId, contactId);
  const schwanz = [
    gesamt > zeilen.length ? `… und ${gesamt - zeilen.length} weitere` : null,
    vergeblich ? `${vergeblich} Mal kam nichts zurück` : null,
  ].filter(Boolean);
  if (schwanz.length) out.push(`_${schwanz.join(' · ')}_`);
  return out;
}
```

In `buildKontaktView` hinter dem Kopf einhängen:

```js
  const erinnerung = gedaechtnisBlock(guildId, userId, contactId, d.tries, d.yes, now);
  if (erinnerung) kopf.push(...erinnerung);
```

- [ ] **Step 4: Der neue Ablehnungsgrund**

In `grundText` (Zeile 3148) ergänzen — `r.minVertrauen` statt `r.minDraht`:

```js
    vertrauen: `🔒 Vertrauen ${r.minVertrauen} nötig`,
```

- [ ] **Step 5: Die Meldungen in `src/buttons.js`**

Beide Meldungen zeigen dasselbe: den neuen Draht, seine Bewegung und die zwei Achsen-Deltas. Sie bekommen **einen** Erzeuger in `src/ui.js`, direkt hinter `drahtBar` — sonst steht derselbe dreiteilige String zweimal im Code und läuft beim nächsten Mal auseinander:

```js
/**
 * Die Achsenbewegung in einer Zeile – der EINE Erzeuger für alle Meldungen.
 *
 * `anfrageNote` (nach einer Anfrage) und `beefDraht` (nach jedem Beef-Schritt
 * und jedem verfallenen Projekt) zeigen dasselbe aus verschieden geformten
 * Ergebnissen; die Zeile selbst gibt es nur hier.
 */
function achsenZeile(draht, delta, achsenVor, achsen) {
  const vz = (n) => `${n >= 0 ? '+' : ''}${n}`;
  return `🤝 Draht ${drahtBar(draht)} **${draht}** (${vz(delta)})`
    + ` · Respekt ${vz(achsen.respekt - achsenVor.respekt)}`
    + ` · Vertrauen ${vz(achsen.vertrauen - achsenVor.vertrauen)}`;
}
```

`achsenZeile` exportieren. `anfrageNote` (Zeile 658) ruft sie:

```js
  zeilen.push(achsenZeile(res.draht, res.delta, res.achsenVor, res.achsen));
```

`beefDraht` (Zeile 793) ebenso — `d.stufe` gibt es nicht mehr:

```js
/** Die Achsenbewegung, wie `contacts.move` sie meldet. */
function beefDraht(d) {
  if (!d) return null;
  return achsenZeile(d.nachher, d.nachher - d.vorher, d.achsenVor, d.achsen);
}
```

Die `DRAHT_STUFEN`-Einfuhr in `src/buttons.js` entfernen, wenn sie danach unbenutzt ist (`grep -n DRAHT_STUFEN src/buttons.js`).

- [ ] **Step 6: Das verfallene Projekt meldet jetzt etwas**

`settle` in `angebote.js` liefert für `projekt_verfallen` ab Task 4 ein `draht`-Feld. Die Stelle in `src/buttons.js`, die `projekt_verfallen` rendert (`grep -n "projekt_verfallen" src/buttons.js`), um `beefDraht(e.draht)` ergänzen — sonst verschwindet der härteste Vertrauensverlust des Spiels still.

- [ ] **Step 7: Tests laufen lassen**

```bash
rm -rf .testdata && DATA_DIR=.testdata node test/fluxer-render.test.js
npm test 2>&1 | grep -c '❌'
```

Erwartet: `test/fluxer-render.test.js` `0 fehlgeschlagen`; die Suite-Zählung `0`. Die bekannt flatternden Dateien (`test/storage.test.js`, `test/activities.test.js`, `test/npc.test.js`, `test/buyers.test.js`, gelegentlich `test/music.test.js`) würfeln ungesät — bei einem `❌` dort denselben Test einzeln nachfahren, bevor er als Regression gilt.

- [ ] **Step 8: Commit**

```bash
git add src/ui.js src/buttons.js test/fluxer-render.test.js
git commit -m "beziehungen: die ansicht - zwei balken, zehn arten, das gedaechtnis"
```

---

## Task 7: Messung, die Tor-Entscheidung und die Dokumentation

**Diese Aufgabe fährt der Koordinator selbst, nicht ein Implementierer-Subagent.** Sie besteht aus Urteilen (welches Tor gilt) und aus Messläufen, die Minuten dauern und deren Ergebnis niemand vorhersagen kann.

**Files:**
- Modify: `scripts/messung-geldquellen.js` (`stufenVerteilung` 662, der Summandenbericht 2063–2075, der Kontaktbericht)
- Modify: `src/data/angebote.js` (`minVertrauen`, falls die Messung es verlangt)
- Create: `docs/messungen/2026-10-07-beziehungen.txt`
- Modify: `ARCHITEKTUR.md` (§15), `src/data/patchnotes.js`

- [ ] **Step 1: Die zwei Nachbauten in der Messung nachziehen**

Die Messung rechnet zwei Produktionsregeln selbst nach. Beide würden nach Task 3 still auf alten Zahlen weiterlaufen:

`stufenVerteilung` (Zeile 662) — `draht` zu `respekt`:

```js
function stufenVerteilung({ ratio, respekt = 0 }) {
  const naehe = Math.min(1, ratio);
  const gewichte = {
    fluechtig: 6 * (ratio < 0.05 ? 2 : 1),
    echt: 3,
    zusage: 1 * (1 + 2 * naehe) * (1 + respekt / 100),
  };
  const summe = gewichte.fluechtig + gewichte.echt + gewichte.zusage;
  return {
    fluechtig: gewichte.fluechtig / summe,
    echt: gewichte.echt / summe,
    zusage: gewichte.zusage / summe,
  };
}
```

Jeden Aufrufer mitziehen: `grep -n 'stufenVerteilung\|erwarteterStufenFaktor' scripts/messung-geldquellen.js`.

Der Summandenbericht (Zeile 2063–2075): `draht: 0` im `arg` zu `respekt: 0, vertrauen: 0`, und die handnachrechenbare Zeile um den neuen Summanden ergänzen:

```js
    const teile = [
      `Basis ${komma(basis, 3)} (Größe)`,
      `Respekt-Gewicht ${komma(contacts.respektGewicht(MEINE, c.reach), 3)} (×Respekt/100)`,
      `Land ${gleichesLand ? '+0,050' : '±0,000'}`,
      `Sprache ${sprache === 'gleich' ? '+0,100' : sprache === 'englisch' ? '±0,000' : '−0,150'}`,
      `Genre ${genre === 'gleich' ? '+0,050' : genre === 'verwandt' ? '±0,000' : '−0,050'}`,
      `Charakter ${c.trait} ${vorzeichen(contactsData.TRAIT_BONUS[c.trait] ?? 0, 3)}`,
    ];
```

Die Kopfzeile darunter (`Draht 0, Hype 1, …`) zu `Respekt 0, Vertrauen 0, Hype 1, …`.

- [ ] **Step 2: Die vorhandene Gegenprobe fahren**

Das Projekt hat für genau diesen Nachbau schon eine Gegenprobe. Sie ist jetzt der Beweis, dass Schritt 1 stimmt:

```bash
node scripts/messung-geldquellen.js stufenprobe 1000000
```

Erwartet: Der gerechnete erwartete Stufenfaktor und der millionenfach gewürfelte stimmen auf drei Stellen überein. **Weichen sie ab, ist Schritt 1 falsch** — nicht die Probe lockern.

- [ ] **Step 3: Die zwei Zähler für §5.1 einbauen**

Der Kontaktbericht braucht zwei Zahlen, die es heute nicht gibt. In die Kontaktvariante (`kontaktvariante`, der Aufbau ab Zeile 2156) je Lauf mitschreiben:

- `vertrauenMax` je Konto: das höchste Vertrauen, das irgendein Kontakt im Messjahr erreicht hat
- `projekteFertig`: wie viele `kollabo`- und `tour`-Projekte im Messjahr **abgeschlossen** wurden (`db.projekteOf(...).filter((p) => p.status === 'fertig').length`)

Im Bericht ausgeben:

```
  Vertrauen: Anteil der Konten mit mindestens einem Kontakt ≥ 50: NN,N %
             (zum Vergleich main, Draht ≥ 50: NN,N %)
  Projekte:  N abgeschlossen, N verfallen
```

- [ ] **Step 4: Gepaart gegen `main` messen**

```bash
git stash list                       # sicherstellen, dass nichts liegen bleibt
node scripts/messung-geldquellen.js 30 365 --nur=kontakte > /tmp/zweig.txt
git stash push -u -m beziehungen-messung
git checkout main
node scripts/messung-geldquellen.js 30 365 --nur=kontakte > /tmp/main.txt
git checkout -
git stash pop
```

Gewertet wird der **Median** über die 30 Läufe, nicht der Mittelwert — die Verteilung der Hörerzahlen hat schwere Ausläufer, und das steht seit 5a als Grund im Kopf des Messskripts.

- [ ] **Step 5: Die blockierende Entscheidung aus §5.1 treffen**

Liegt der Anteil der Konten, die Vertrauen 50 erreichen, **unter** dem heutigen Anteil, der Draht 50 erreicht, geht `minVertrauen` der drei großen Formate in `src/data/angebote.js` eine Stufe herunter, und Schritt 4 wird wiederholt:

```
50  →  45  →  40  →  35
```

Abgebrochen wird, sobald die Anteile übereinstimmen. **Sind im Messjahr null `kollabo`- oder `tour`-Projekte zustande gekommen, ist das ein Fehlschlag und kein Ergebnis** — dann weiter herunter, auch unter 35, und der Grund gehört ins Messfile.

Die Abkühl-Asymmetrie (Respekt 1, Vertrauen 3) wird dabei **nicht** angefasst. Sie trägt die Aussage des Stücks und hält den Draht-Verfall bei den alten zwei Punkten.

- [ ] **Step 6: Den Auslöser aus §8.3 prüfen**

Steigt die Jahressumme eines Archetyps um mehr als **25 %** über `main`, geht `RESPEKT_W_SPAN` (0,33) herunter, bis es darunter liegt, und Schritt 4 wird wiederholt. Fällt eine Summe um mehr als 25 %, geht `RESPEKT_W_MIN` (0,12) hoch.

Zusätzlich festhalten, was diese Messung **nicht** sagt: Der Respekt-Hebel wirkt nur, wo überhaupt Kontakte angeschrieben werden. Varianten ohne `strat.kontakte` sind von diesem Stück unberührt, und ihr Deckel sagt über 6a nichts.

- [ ] **Step 7: Messfile, §15 und Patchnote**

`docs/messungen/2026-10-07-beziehungen.txt` nach dem Muster der vier Vorgänger: die rohen Läufe, die Mediane, die Anteilsvergleiche aus Schritt 3, die getroffene Tor-Entscheidung aus Schritt 5 mit ihrer Begründung, und ausdrücklich die Grenzen der Messung.

`ARCHITEKTUR.md` §15: der gemessene Deckel dieses Stücks und die Zeile „Ehrliche Grenzen". **Keine Zahl dort, die nicht im Messfile steht** — in 5b/5c/Vorfälle ist genau dieser Abgleich dreimal nötig geworden, zuletzt hat der Zweig-Review eine §15-Behauptung mit dem eigenen Vorgänger-Messlauf widerlegt.

`src/data/patchnotes.js`: eine Note, die sagt, was der Spieler merkt — zwei Balken statt einem, der Weltstar über Beziehung erreichbar, der Rivale als eigener Zustand, das fertige Album zählt endlich, und das ⭐ hält jetzt sein Versprechen.

- [ ] **Step 8: Die ganze Suite, zweimal**

```bash
npm test 2>&1 | grep -E "^[0-9]+ bestanden" | awk '{p+=$1; f+=$3} END {print p" bestanden, "f" fehlgeschlagen"}'
npm test 2>&1 | grep -c '❌'
```

Zweimal fahren. Erwartet beim zweiten Lauf dieselbe Zahl; weicht sie ab, ist eine der fünf ungesät würfelnden Dateien schuld und wird einzeln nachgefahren, bevor etwas als Regression gilt.

- [ ] **Step 9: Commit**

```bash
git add scripts/messung-geldquellen.js docs/messungen/2026-10-07-beziehungen.txt ARCHITEKTUR.md src/data/patchnotes.js src/data/angebote.js
git commit -m "beziehungen: messung, das vertrauens-tor und die patchnote"
```

---

## Nach allen Tasks

Ganzzweig-Review über `superpowers:requesting-code-review` auf dem stärksten verfügbaren Modell, mit dem Paket aus `scripts/review-package $(git merge-base main HEAD) HEAD`. Dem Review ausdrücklich mitgeben:

1. **§5.1 ist der Blocker.** Ist das Tor gemessen gesetzt oder bei 50 stehen geblieben, weil es niemand nachgefahren hat?
2. **Die zehn Arten und ihre Reihenfolge** — ist jede erreichbar, und gibt es eine Kombination, die in die falsche Gegend fällt?
3. **Die eine Partner-Regel** — zählen ⭐, Antwortchance, Türöffner und `beef.js` wirklich dasselbe, oder ist eine vierte Fassung entstanden?
4. **Der Draht wird nur in `db.saveContact` geschrieben** — rechnet ihn irgendwo sonst jemand aus und speichert ihn?
5. **`d_respekt`/`d_vertrauen`** — liest sie irgendwo jemand für eine Rechnung?
6. **§3** — ist `staerkeOf`/`boostOf` wirklich unangetastet, und gibt es einen Weg, über die Beziehung mehr Geld statt nur mehr Zugang zu holen?

Danach `superpowers:finishing-a-development-branch`.
