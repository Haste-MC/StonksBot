# Erfolge (Achievements) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 37 private Erfolge in vier Stufen und 15 serverweite Erfolge mit genau einem Gewinner, beide mit Durchsage.

**Architecture:** Ein deklaratives Regelwerk in `src/achievements.js` wird an drei Andockpunkten geprüft: an jeder Geldbuchung mit `kind` (über `unb.countActivity`), beim Aufbau von Profil und Startseite, und über ausdrückliche `fire`-Aufrufe für Ereignisse ohne Geldbuchung. Die Vergabe schreibt synchron in die DB; die serverweite Einmaligkeit kommt aus dem Primärschlüssel (`INSERT OR IGNORE` + `changes()`). Meldungen laufen danach fire-and-forget.

**Tech Stack:** Node.js, `node:sqlite` (`DatabaseSync`), discord.js v14, eigenes Fluxer-SDK. Keine neuen Abhängigkeiten.

**Spec:** `docs/superpowers/specs/2026-09-08-achievements-design.md`

## Global Constraints

- **Sprache:** Sämtliche Bezeichner, Kommentare, Commit-Nachrichten und Spielertexte auf **Deutsch**. Kommentare erklären das *Warum*, nicht das *Was* — so wie im übrigen Code.
- **ARCHITEKTUR §3 (kein Gelddrucker):** Kein Erfolg zahlt Geld, XP oder Rabatte aus. `src/achievements.js` bindet weder `unb` noch `wallet` noch `level` ein.
- **ARCHITEKTUR §4 (faule Abrechnung):** Kein Scheduler, kein `setInterval`. Geprüft wird nur an vorhandenen Andockpunkten.
- **ARCHITEKTUR §7 (synchron vor dem ersten await):** Die DB-Zeile steht, bevor der erste `await` zurückkommt.
- **ARCHITEKTUR §8 (späte Bindung):** Module, die Tests ersetzen wollen, über `require(...)` **innerhalb** der Funktion holen, nicht oben im Modul.
- **ARCHITEKTUR §12 (Tests ohne Netz):** Kein Test darf eine API aufrufen. Währungssymbol und Guthaben werden ersetzt.
- **Fehler dürfen nie eskalieren:** Jeder Aufruf aus fremdem Code heraus (`countActivity`, Ansichten, `fire`) ist in `try/catch` gekapselt. Ein Erfolg darf keine Schicht, keinen Heist und keine Ansicht kippen.
- **`id` ist für immer.** Schwellen, Titel und Emojis dürfen sich ändern, `id` niemals.
- **Test-Stil:** Wie die übrigen Tests im Projekt — ein `check(label, ok, extra)`-Helfer, `console.log` mit ✅/❌, am Ende `process.exit(fail === 0 ? 0 : 1)`. Kein Test-Framework.
- **Welt-Isolierung im Test:** `process.env.WORLD_ID` **vor** dem ersten `require('../src/db')` auf einen pro Lauf eindeutigen Wert setzen (`ACH_T${Date.now()}`), sonst sind Läufe nicht wiederholbar.

## Abweichungen von der Spec (beim Nachsehen im Code gefunden)

- Das Casino bucht in **`src/casinoPlay.js`** (`playRound` und `finish`), nicht in `src/casino.js`. Der `fire`-Aufruf gehört dorthin.
- **`db.carsOwned(guildId, userId)` gibt es bereits** — die in der Spec geplante `countCars` entfällt, es bleiben vier neue DB-Funktionen.
- Der `state`-Andockpunkt hängt an **`buildProfileView`** und **`buildHomeView`** (Startseite). Die Rangliste ruft bereits `podium.celebrate` auf; dort zusätzlich pro Eintrag den Zustand zu prüfen, würde je Spieler mehrere Abfragen kosten. Profil und Startseite öffnet ohnehin jeder.

## File Structure

| Datei | Verantwortung |
|---|---|
| `src/achievements.js` (neu) | Regelwerk, Vergabe, Meldungen, Nachtrag. Kennt keine Discord-Objekte. |
| `src/achievementsUi.js` (neu) | Die beiden Ansichten (eigene Erfolge, Ehrentafel). Kennt keine Regeln, nur `achievements.listFor`/`board`. |
| `src/db.js` | Zwei Tabellen, vier Funktionen. |
| `src/unb.js` | Eine Zeile in `countActivity`. |
| `src/ui.js` | `state`-Aufruf in zwei Ansichten, Abzeichen-Zeile im Profil, Erfolgstitel im Titel-Menü. |
| `src/activity.js` | Titelwunsch mit Präfix `ach:` auflösen. |
| `src/menu.js` | Ein Eintrag. |
| `src/heist.js`, `src/home.js`, `src/casinoPlay.js`, `src/storage.js` | Je ein `fire`. |
| `test/achievements.test.js` (neu) | Alle 13 Testfälle der Spec. |

---

### Task 1: DB-Schicht

**Files:**
- Modify: `src/db.js` (Tabellen nach dem `podium`-Block, Statements im `stmt`-Objekt, Funktionen, Export)
- Test: `test/achievements.test.js` (neu)

**Interfaces:**
- Consumes: nichts
- Produces:
  - `db.awardAchievement(guildId, userId, achId, at) -> boolean` (`true` nur beim ersten Mal)
  - `db.claimFirst(guildId, achId, userId, at) -> boolean` (`true` nur für den Ersten der Welt)
  - `db.achievementsOf(guildId, userId) -> Array<{ach_id, at}>` (neueste zuerst)
  - `db.allFirsts(guildId) -> Array<{ach_id, user_id, at}>`

- [ ] **Step 1: Write the failing test**

Neue Datei `test/achievements.test.js`:

```js
/**
 * Tests für die Erfolge (achievements.js).
 *
 * Der heikelste Teil ist nicht das Vergeben, sondern die Einmaligkeit: Ein
 * serverweiter Erfolg darf genau einen Gewinner haben, auch wenn zwei Spieler
 * in derselben Millisekunde fertig werden. Deshalb hängt sie am
 * Primärschlüssel und nicht an einer Prüfung im Code.
 *
 * Aufruf: node test/achievements.test.js
 */
process.env.WORLD_ID = `ACH_T${Date.now()}`;

const db = require('../src/db');
const identity = require('../src/identity');

const W = identity.world();
let pass = 0, fail = 0;
const check = (label, ok, extra = '') => {
  if (ok) { pass++; console.log(`  ✅ ${label}`); }
  else { fail++; console.log(`  ❌ ${label} ${extra}`); }
};

const A = 'fx:anton', B = 'fx:berta';

(async () => {
  console.log('--- Vergeben ist einmalig je Konto ---');
  check('erste Vergabe zählt', db.awardAchievement(W, A, 'job_1', 1000) === true);
  check('die zweite nicht mehr', db.awardAchievement(W, A, 'job_1', 2000) === false);
  check('ein anderes Konto bekommt ihn trotzdem',
    db.awardAchievement(W, B, 'job_1', 3000) === true);

  const meine = db.achievementsOf(W, A);
  check('der Erfolg steht in der Liste', meine.length === 1 && meine[0].ach_id === 'job_1',
    JSON.stringify(meine));
  check('mit dem Zeitpunkt der ERSTEN Vergabe', meine[0].at === 1000, String(meine[0]?.at));

  console.log('--- Serverweit gewinnt genau einer ---');
  check('Anton war zuerst da', db.claimFirst(W, 'srv_millionaire', A, 1000) === true);
  check('Berta geht leer aus', db.claimFirst(W, 'srv_millionaire', B, 1001) === false);

  const tafel = db.allFirsts(W);
  const eintrag = tafel.find((r) => r.ach_id === 'srv_millionaire');
  check('die Ehrentafel nennt den Gewinner', eintrag?.user_id === A, JSON.stringify(eintrag));
  check('und nur einen', tafel.filter((r) => r.ach_id === 'srv_millionaire').length === 1);

  console.log(`\n${pass} bestanden, ${fail} fehlgeschlagen`);
  process.exit(fail === 0 ? 0 : 1);
})();
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node test/achievements.test.js`
Expected: FAIL — `TypeError: db.awardAchievement is not a function`

- [ ] **Step 3: Add the tables**

In `src/db.js` direkt **nach** dem `CREATE TABLE ... podium`-Block einfügen:

```js
/*
 * Erfolge.
 *
 * Zwei Tabellen, obwohl es um dieselbe Sache geht – und genau darin liegt der
 * Trick. `achievements` hält fest, wer was hat. `achievement_firsts` hat den
 * Erfolg im PRIMÄRSCHLÜSSEL und kann deshalb je Welt nur EINE Zeile
 * aufnehmen: Damit entscheidet die Datenbank, wer der Erste war, und nicht
 * eine Prüfung im Code, die zwei gleichzeitige Spieler beide bestehen würden.
 */
db.exec(`
  CREATE TABLE IF NOT EXISTS achievements (
    guild_id TEXT    NOT NULL,
    user_id  TEXT    NOT NULL,
    ach_id   TEXT    NOT NULL,
    at       INTEGER NOT NULL,
    PRIMARY KEY (guild_id, user_id, ach_id)
  );

  CREATE TABLE IF NOT EXISTS achievement_firsts (
    guild_id TEXT    NOT NULL,
    ach_id   TEXT    NOT NULL,
    user_id  TEXT    NOT NULL,
    at       INTEGER NOT NULL,
    PRIMARY KEY (guild_id, ach_id)
  );
`);
```

- [ ] **Step 4: Add the statements**

Im `stmt`-Objekt in `src/db.js`, hinter den Storage-Statements:

```js
  // --- Erfolge ---
  awardAchievement: db.prepare(
    'INSERT OR IGNORE INTO achievements (guild_id, user_id, ach_id, at) VALUES (?, ?, ?, ?)'),
  achievementsOf: db.prepare(
    'SELECT ach_id, at FROM achievements WHERE guild_id = ? AND user_id = ? ORDER BY at DESC'),
  claimFirst: db.prepare(
    'INSERT OR IGNORE INTO achievement_firsts (guild_id, ach_id, user_id, at) VALUES (?, ?, ?, ?)'),
  allFirsts: db.prepare(
    'SELECT ach_id, user_id, at FROM achievement_firsts WHERE guild_id = ? ORDER BY at ASC'),
```

- [ ] **Step 5: Add the functions**

In `src/db.js`, hinter `claimLot`:

```js
// ------------------------------------------------------------------ ERFOLGE

/** Vergibt einen Erfolg. `true` nur beim ersten Mal – ein zweiter Aufruf ändert nichts. */
function awardAchievement(guildId, userId, achId, at = Date.now()) {
  return stmt.awardAchievement.run(guildId, userId, achId, at).changes > 0;
}

/** Alle Erfolge eines Kontos, neueste zuerst. */
function achievementsOf(guildId, userId) {
  return stmt.achievementsOf.all(guildId, userId);
}

/**
 * Beansprucht einen serverweiten Erfolg. `true` nur für den Ersten.
 *
 * Die Einmaligkeit kommt aus dem Primärschlüssel, nicht aus einer Prüfung:
 * Zwei Spieler, die in derselben Millisekunde fertig werden, bestünden ein
 * "gibt es den schon?" beide. `INSERT OR IGNORE` kann nur einer gewinnen.
 */
function claimFirst(guildId, achId, userId, at = Date.now()) {
  return stmt.claimFirst.run(guildId, achId, userId, at).changes > 0;
}

/** Die Ehrentafel: wer welchen serverweiten Erfolg hält. */
function allFirsts(guildId) {
  return stmt.allFirsts.all(guildId);
}
```

Im Export-Block ergänzen:

```js
  awardAchievement, achievementsOf, claimFirst, allFirsts,
```

- [ ] **Step 6: Run test to verify it passes**

Run: `node test/achievements.test.js`
Expected: PASS — die Ausgabe endet mit `0 fehlgeschlagen`

- [ ] **Step 7: Commit**

```bash
git add src/db.js test/achievements.test.js
git commit -m "erfolge: datenbank-schicht mit atomarem ersten"
```

---

### Task 2: Das Regelwerk

**Files:**
- Create: `src/achievements.js`
- Modify: `test/achievements.test.js`

**Interfaces:**
- Consumes: `db` aus Task 1
- Produces:
  - `achievements.RULES -> Array<Rule>` — 52 Regeln
  - `achievements.TIERS -> {bronze|silber|gold|platin: {label, emoji, loud, rank}}`
  - `achievements.byId(id) -> Rule | null`
  - `achievements.rarityRank(id) -> number` (Rang in `RARITIES`, `-1` wenn unbekannt)
  - Rule-Form: `{ id, scope: 'privat'|'server', tier?, emoji, title, text, on, test(ctx), progress?(ctx) -> [ist, soll], measure?(ctx) -> number, backfill?: false }`

- [ ] **Step 1: Write the failing test**

An `test/achievements.test.js` **vor** der Schlusszeile anhängen:

```js
  console.log('--- Das Regelwerk ist wohlgeformt ---');
  const ach = require('../src/achievements');
  const activity = require('../src/activity');

  const ids = ach.RULES.map((r) => r.id);
  check('jede id kommt genau einmal vor', new Set(ids).size === ids.length,
    ids.filter((id, i) => ids.indexOf(id) !== i).join(', '));
  check('37 private Erfolge',
    ach.RULES.filter((r) => r.scope === 'privat').length === 37,
    String(ach.RULES.filter((r) => r.scope === 'privat').length));
  check('15 serverweite Erfolge',
    ach.RULES.filter((r) => r.scope === 'server').length === 15,
    String(ach.RULES.filter((r) => r.scope === 'server').length));

  const unvollstaendig = ach.RULES.filter((r) =>
    !r.emoji || !r.title || !r.text || !r.on || typeof r.test !== 'function');
  check('jede Regel hat Emoji, Titel, Text, Andockpunkt und Prüfung',
    unvollstaendig.length === 0, unvollstaendig.map((r) => r.id).join(', '));

  const falscheStufe = ach.RULES.filter((r) =>
    r.scope === 'privat' ? !ach.TIERS[r.tier] : Boolean(r.tier));
  check('private Erfolge haben eine gültige Stufe, serverweite keine',
    falscheStufe.length === 0, falscheStufe.map((r) => r.id).join(', '));

  const unbekannteAktivitaet = ach.RULES
    .filter((r) => r.on.startsWith('kind:'))
    .filter((r) => !activity.kind(r.on.slice(5)));
  check('jeder kind-Andockpunkt nennt eine bekannte Aktivität',
    unbekannteAktivitaet.length === 0, unbekannteAktivitaet.map((r) => r.on).join(', '));

  console.log('--- Raritäten werden als "oder besser" verglichen ---');
  check('Cosmic liegt über Godlike', ach.rarityRank('cosmic') > ach.rarityRank('godlike'));
  check('Mythic liegt darunter', ach.rarityRank('mythic') < ach.rarityRank('godlike'));
  check('Unbekanntes ist -1', ach.rarityRank('quatsch') === -1);
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node test/achievements.test.js`
Expected: FAIL — `Cannot find module '../src/achievements'`

- [ ] **Step 3: Write the module head, tiers and rarity helper**

Neue Datei `src/achievements.js`:

```js
const db = require('./db');

/**
 * ===========================================================================
 *  ERFOLGE – privat und serverweit
 * ===========================================================================
 *
 * Zwei Sorten:
 *
 *   privat     Meilensteine, die jeder für sich erreicht. Vier Stufen, damit
 *              der Fortschritt sichtbar bleibt statt sofort fertig zu sein.
 *   server     Taten, die nur EINER haben kann. Wer zuerst da ist, bekommt
 *              sie – alle anderen gehen leer aus.
 *
 * ==================== KEIN GELDDRUCKER (§3) ====================
 * Erfolge geben ausschließlich Ruhm: ein Abzeichen im Profil und einen
 * wählbaren Titel. Kein Geld, keine Erfahrung, keine Rabatte. Deshalb bindet
 * dieses Modul weder `unb` noch `wallet` noch `level` ein – wer hier eine
 * Auszahlung einbauen will, muss erst diese Zeile löschen.
 * ==============================================================
 *
 * Ein neuer Erfolg ist ein Eintrag in RULES – sonst nichts. Braucht er ein
 * Ereignis, das keine Geldbuchung ist, kommt ein `fire()` an die passende
 * Stelle.
 *
 * WICHTIG: Die `id` ist der Schlüssel und bleibt für immer. Titel, Emoji,
 * Text und Schwelle darf man ändern – wer den Erfolg hat, behält ihn. Eine
 * neue `id` dagegen ist ein NEUER Erfolg, den alle erneut holen müssen.
 */

/**
 * Die Stufen. `loud` entscheidet, ob es in den Kanal geht.
 *
 * Warum nicht alles laut: Von 37 privaten Erfolgen sind 20 laut. Wäre jeder
 * es, hätte der Hauptkanal bei zehn Spielern schnell 370 Meldungen – und
 * damit wäre keine davon mehr ein Ereignis.
 */
const TIERS = {
  bronze: { label: 'Bronze', emoji: '🥉', loud: false, rank: 1 },
  silber: { label: 'Silber', emoji: '🥈', loud: false, rank: 2 },
  gold:   { label: 'Gold',   emoji: '🥇', loud: true,  rank: 3 },
  platin: { label: 'Platin', emoji: '💠', loud: true,  rank: 4 },
};

/**
 * Rang einer Seltenheit in der Leiter aus data/storage.js.
 *
 * Gebraucht für „diese Stufe ODER BESSER": Ein Cosmic-Fund erfüllt auch den
 * Godlike-Erfolg. Ohne Rangvergleich müsste jede Regel alle höheren Stufen
 * einzeln aufzählen.
 *
 * @returns {number} Rang, oder -1 wenn die Leiter das nicht kennt
 */
function rarityRank(id) {
  const { RARITIES } = require('./data/storage');
  return RARITIES.findIndex((r) => r.id === String(id ?? ''));
}

/** Ab dieser Stufe zählt ein Fund für den jeweiligen Erfolg. */
const abStufe = (stufe) => (c) => rarityRank(c.rarity) >= rarityRank(stufe);
```

- [ ] **Step 4: Write the private rules**

Weiter in `src/achievements.js`:

```js
/**
 * Alle Erfolge.
 *
 * Die Schwellen sind am echten Spielstand geeicht (siehe die Spec unter
 * docs/superpowers/specs/): Bronze und Silber am heutigen Höchststand, Gold
 * und Platin am Endgame-Ertrag von rund 875.000 Beute pro Tag. Wer sie
 * ändert, sollte dort nachrechnen statt zu raten.
 */
const RULES = [
  // ------------------------------------------------------------------ Arbeit
  { id: 'job_1', scope: 'privat', tier: 'bronze', emoji: '💼', title: 'Erster Arbeitstag',
    text: 'Die erste Schicht geschoben.', on: 'kind:job',
    test: (c) => c.shifts >= 1, progress: (c) => [c.shifts, 1] },
  { id: 'job_50', scope: 'privat', tier: 'silber', emoji: '🔧', title: 'Malocher',
    text: '50 Schichten.', on: 'kind:job',
    test: (c) => c.shifts >= 50, progress: (c) => [c.shifts, 50] },
  { id: 'job_250', scope: 'privat', tier: 'gold', emoji: '⚙️', title: 'Arbeitstier',
    text: '250 Schichten.', on: 'kind:job',
    test: (c) => c.shifts >= 250, progress: (c) => [c.shifts, 250] },
  { id: 'job_1000', scope: 'privat', tier: 'platin', emoji: '🏭', title: 'Lebenswerk',
    text: '1.000 Schichten. Irgendwann ist es keine Arbeit mehr, sondern Charakter.',
    on: 'kind:job', test: (c) => c.shifts >= 1000, progress: (c) => [c.shifts, 1000] },

  // --------------------------------------------------------------- Vermögen
  { id: 'worth_100k', scope: 'privat', tier: 'bronze', emoji: '💵', title: 'Erstes Polster',
    text: 'Ein Vermögen von 100.000.', on: 'state',
    test: (c) => c.worth >= 100_000, progress: (c) => [c.worth, 100_000] },
  { id: 'worth_500k', scope: 'privat', tier: 'silber', emoji: '💸', title: 'Halbe Million',
    text: 'Ein Vermögen von 500.000.', on: 'state',
    test: (c) => c.worth >= 500_000, progress: (c) => [c.worth, 500_000] },
  { id: 'worth_1m', scope: 'privat', tier: 'gold', emoji: '💰', title: 'Millionär',
    text: 'Ein Vermögen von einer Million.', on: 'state',
    test: (c) => c.worth >= 1_000_000, progress: (c) => [c.worth, 1_000_000] },
  { id: 'worth_50m', scope: 'privat', tier: 'platin', emoji: '🤑', title: 'Schwerreich',
    text: 'Ein Vermögen von 50 Millionen.', on: 'state',
    test: (c) => c.worth >= 50_000_000, progress: (c) => [c.worth, 50_000_000] },

  // -------------------------------------------------------------- Fuhrpark
  { id: 'car_1', scope: 'privat', tier: 'bronze', emoji: '🚗', title: 'Erstes eigenes Auto',
    text: 'Das erste Auto in der Garage.', on: 'state',
    test: (c) => c.cars >= 1, progress: (c) => [c.cars, 1] },
  { id: 'car_5', scope: 'privat', tier: 'silber', emoji: '🅿️', title: 'Sammler',
    text: 'Fünf Autos gleichzeitig.', on: 'state',
    test: (c) => c.cars >= 5, progress: (c) => [c.cars, 5] },
  { id: 'car_500k', scope: 'privat', tier: 'gold', emoji: '🏎️', title: 'Traumwagen',
    text: 'Ein Auto für mindestens 500.000.', on: 'state',
    test: (c) => c.bestCar >= 500_000, progress: (c) => [c.bestCar, 500_000] },
  { id: 'car_3m', scope: 'privat', tier: 'platin', emoji: '👑', title: 'Hypercar',
    text: 'Ein Auto für mindestens 3 Millionen.', on: 'state',
    test: (c) => c.bestCar >= 3_000_000, progress: (c) => [c.bestCar, 3_000_000] },

  // ------------------------------------------------------------ Immobilien
  { id: 'prop_1', scope: 'privat', tier: 'bronze', emoji: '🏠', title: 'Eigenheim',
    text: 'Die erste eigene Immobilie.', on: 'state',
    test: (c) => c.properties >= 1, progress: (c) => [c.properties, 1] },
  { id: 'rent_1', scope: 'privat', tier: 'silber', emoji: '🔑', title: 'Vermieter',
    text: 'Die erste Mieteinnahme.', on: 'kind:landlord',
    test: (c) => (c.counts.landlord ?? 0) >= 1, progress: (c) => [c.counts.landlord ?? 0, 1] },
  { id: 'realty_1m', scope: 'privat', tier: 'gold', emoji: '🏘️', title: 'Immobilienmogul',
    text: 'Immobilien im Wert von einer Million.', on: 'state',
    test: (c) => c.realty >= 1_000_000, progress: (c) => [c.realty, 1_000_000] },
  { id: 'castle', scope: 'privat', tier: 'platin', emoji: '🏰', title: 'Schlossherr',
    text: 'Das Schloss. Es gibt genau eines.', on: 'state',
    test: (c) => c.hasCastle },

  // --------------------------------------------------------- Krumme Dinger
  { id: 'heist_1', scope: 'privat', tier: 'bronze', emoji: '🕵️', title: 'Erstes Ding',
    text: 'Am ersten Heist teilgenommen.', on: 'state',
    test: (c) => c.heists >= 1, progress: (c) => [c.heists, 1] },
  { id: 'rob_10', scope: 'privat', tier: 'silber', emoji: '🎭', title: 'Straßenräuber',
    text: 'Zehn Überfälle.', on: 'kind:rob',
    test: (c) => (c.counts.rob ?? 0) >= 10, progress: (c) => [c.counts.rob ?? 0, 10] },
  { id: 'heist_clean', scope: 'privat', tier: 'gold', emoji: '💎',
    title: 'Sauber durchgezogen', text: 'Ein Heist ohne einen einzigen Fehler.',
    on: 'fire:heist_perfect', test: () => true },
  { id: 'loot_50m', scope: 'privat', tier: 'platin', emoji: '🧨', title: 'Beutezug',
    text: '50 Millionen Diebesgut über alle Dinger hinweg.', on: 'state',
    test: (c) => c.lootTotal >= 50_000_000, progress: (c) => [c.lootTotal, 50_000_000] },

  // ---------------------------------------------------------------- Zocken
  { id: 'casino_1', scope: 'privat', tier: 'bronze', emoji: '🎰', title: 'Anfängerglück',
    text: 'Die erste Runde im Casino.', on: 'kind:casino',
    test: (c) => (c.counts.casino ?? 0) >= 1, progress: (c) => [c.counts.casino ?? 0, 1] },
  { id: 'casino_100k', scope: 'privat', tier: 'gold', emoji: '🃏', title: 'Hochroller',
    text: '100.000 Gewinn in einer einzigen Runde.', on: 'fire:casino_win',
    test: (c) => c.amount >= 100_000 },
  { id: 'casino_1m', scope: 'privat', tier: 'platin', emoji: '💥', title: 'Bank gesprengt',
    text: 'Eine Million Gewinn in einer einzigen Runde. Mehr lässt das Haus nicht zu.',
    on: 'fire:casino_win', test: (c) => c.amount >= 1_000_000 },

  // ----------------------------------------------------------------- Börse
  { id: 'market_1', scope: 'privat', tier: 'bronze', emoji: '📈', title: 'Kleinanleger',
    text: 'Der erste Handel an der Börse.', on: 'kind:market',
    test: (c) => (c.counts.market ?? 0) >= 1, progress: (c) => [c.counts.market ?? 0, 1] },
  { id: 'depot_250k', scope: 'privat', tier: 'gold', emoji: '🦈', title: 'Börsenhai',
    text: 'Ein Depot im Wert von 250.000.', on: 'state',
    test: (c) => c.depot >= 250_000, progress: (c) => [c.depot, 250_000] },
  { id: 'depot_25m', scope: 'privat', tier: 'platin', emoji: '🏦', title: 'Großkapital',
    text: 'Ein Depot im Wert von 25 Millionen – bei laufendem Kursrisiko.',
    on: 'state', test: (c) => c.depot >= 25_000_000, progress: (c) => [c.depot, 25_000_000] },

  // ------------------------------------------------------------- Auktionen
  { id: 'lot_1', scope: 'privat', tier: 'bronze', emoji: '🏬', title: 'Erster Zuschlag',
    text: 'Die erste Garage ersteigert.', on: 'kind:auction',
    test: (c) => (c.counts.auction ?? 0) >= 1, progress: (c) => [c.counts.auction ?? 0, 1] },
  { id: 'coll_100k', scope: 'privat', tier: 'gold', emoji: '🏺', title: 'Schatzmeister',
    text: 'Eine Sammlung im Schätzwert von 100.000.', on: 'state',
    test: (c) => c.collection >= 100_000, progress: (c) => [c.collection, 100_000] },
  { id: 'godlike', scope: 'privat', tier: 'platin', emoji: '🟠', title: 'Godlike',
    text: 'Ein Fundstück der Stufe Godlike oder besser. Etwa eine von 400 Garagen.',
    on: 'fire:loot', test: abStufe('godlike') },

  // ---------------------------------------------------------------- Angeln
  { id: 'fish_1', scope: 'privat', tier: 'bronze', emoji: '🎣', title: 'Erster Fang',
    text: 'Einmal am Wasser gesessen.', on: 'kind:fishing',
    test: (c) => (c.counts.fishing ?? 0) >= 1, progress: (c) => [c.counts.fishing ?? 0, 1] },
  { id: 'fish_100', scope: 'privat', tier: 'silber', emoji: '🐟', title: 'Angler',
    text: '100 Fänge.', on: 'kind:fishing',
    test: (c) => (c.counts.fishing ?? 0) >= 100, progress: (c) => [c.counts.fishing ?? 0, 100] },
  { id: 'fish_500', scope: 'privat', tier: 'gold', emoji: '🐠', title: 'Fischerkönig',
    text: '500 Fänge.', on: 'kind:fishing',
    test: (c) => (c.counts.fishing ?? 0) >= 500, progress: (c) => [c.counts.fishing ?? 0, 500] },
  { id: 'fish_1000', scope: 'privat', tier: 'platin', emoji: '🐋', title: 'Moby Dick',
    text: '1.000 Fänge.', on: 'kind:fishing',
    test: (c) => (c.counts.fishing ?? 0) >= 1000, progress: (c) => [c.counts.fishing ?? 0, 1000] },

  // ----------------------------------------------------------------- Leben
  { id: 'move_1', scope: 'privat', tier: 'bronze', emoji: '✈️', title: 'Weltenbummler',
    text: 'Ins Ausland gezogen.', on: 'fire:move', test: () => true },
  { id: 'level_25', scope: 'privat', tier: 'silber', emoji: '🏆', title: 'Aufsteiger',
    text: 'Level 25.', on: 'state',
    test: (c) => c.level >= 25, progress: (c) => [c.level, 25] },
  { id: 'level_50', scope: 'privat', tier: 'gold', emoji: '🌟', title: 'Legende',
    text: 'Level 50.', on: 'state',
    test: (c) => c.level >= 50, progress: (c) => [c.level, 50] },
  { id: 'level_100', scope: 'privat', tier: 'platin', emoji: '♾️', title: 'Unsterblich',
    text: 'Level 100. Eine Million Erfahrung – das dauert Jahre, und das ist Absicht.',
    on: 'state', test: (c) => c.level >= 100, progress: (c) => [c.level, 100] },
```

- [ ] **Step 5: Write the server-wide rules**

Direkt anschließend, noch innerhalb von `RULES`:

```js
  // ============================================================== SERVERWEIT
  // Genau einer je Welt. `measure` entscheidet beim einmaligen Nachtrag, wer
  // ihn bekommt, wenn ihn schon mehrere erfüllen; `backfill: false` heißt,
  // dass es dafür keine Daten in der Vergangenheit gibt.
  { id: 'srv_millionaire', scope: 'server', emoji: '👑', title: 'Der erste Millionär',
    text: 'Als Erster ein Vermögen von einer Million.', on: 'state',
    test: (c) => c.worth >= 1_000_000, measure: (c) => c.worth },
  { id: 'srv_supercar', scope: 'server', emoji: '🏎️', title: 'Der erste Supersportwagen',
    text: 'Als Erster ein Auto für mindestens 500.000.', on: 'state',
    test: (c) => c.bestCar >= 500_000, measure: (c) => c.bestCar },
  { id: 'srv_castle', scope: 'server', emoji: '🏰', title: 'Der Schlossherr',
    text: 'Das Schloss gehört genau einem.', on: 'state',
    test: (c) => c.hasCastle, measure: (c) => c.realty },
  { id: 'srv_depot', scope: 'server', emoji: '📈', title: 'Der erste Großanleger',
    text: 'Als Erster ein Depot im Wert von 500.000.', on: 'state',
    test: (c) => c.depot >= 500_000, measure: (c) => c.depot },
  { id: 'srv_heist', scope: 'server', emoji: '💎', title: 'Der erste perfekte Coup',
    text: 'Als Erster ein Ding ohne einen einzigen Fehler.',
    on: 'fire:heist_perfect', test: () => true, backfill: false },
  { id: 'srv_pate', scope: 'server', emoji: '🚚', title: 'Der Pate',
    text: 'Als Erster 100 Millionen Diebesgut.', on: 'state',
    test: (c) => c.lootTotal >= 100_000_000, measure: (c) => c.lootTotal },
  { id: 'srv_worker', scope: 'server', emoji: '⚙️', title: 'Der erste Malocher',
    text: 'Als Erster 250 Schichten.', on: 'kind:job',
    test: (c) => c.shifts >= 250, measure: (c) => c.shifts },
  { id: 'srv_bigbid', scope: 'server', emoji: '🏬', title: 'Der erste Großeinkauf',
    text: 'Als Erster einen Zuschlag über 100.000.', on: 'fire:lot_won',
    test: (c) => c.price >= 100_000, backfill: false },
  { id: 'srv_godlike', scope: 'server', emoji: '🟠', title: 'Der erste Godlike-Fund',
    text: 'Als Erster ein Stück der Stufe Godlike. Etwa eine von 400 Garagen.',
    on: 'fire:loot', test: abStufe('godlike'), measure: (c) => c.bestRarity },
  { id: 'srv_cosmic', scope: 'server', emoji: '🌌', title: 'Der erste Cosmic-Fund',
    text: 'Als Erster ein Stück der Stufe Cosmic. Etwa eine von 4.000 Garagen.',
    on: 'fire:loot', test: abStufe('cosmic'), measure: (c) => c.bestRarity },
  { id: 'srv_billion', scope: 'server', emoji: '💰', title: 'Der erste Milliardär',
    text: 'Als Erster ein Vermögen von einer Milliarde.', on: 'state',
    test: (c) => c.worth >= 1_000_000_000, measure: (c) => c.worth },
  { id: 'srv_primordial', scope: 'server', emoji: '🩸', title: 'Primordial',
    text: 'Ein Stück der Stufe Primordial. Etwa eine von 40.000 Garagen.',
    on: 'fire:loot', test: abStufe('primordial'), measure: (c) => c.bestRarity },
  { id: 'srv_celestial', scope: 'server', emoji: '🌟', title: 'Celestial',
    text: 'Ein Stück der Stufe Celestial. Etwa eine von 700.000 Garagen.',
    on: 'fire:loot', test: abStufe('celestial'), measure: (c) => c.bestRarity },
  { id: 'srv_omnipotent', scope: 'server', emoji: '👁️', title: 'Omnipotent',
    text: 'Ein Stück der Stufe Omnipotent. Eine von zehn Milliarden Garagen.',
    on: 'fire:loot', test: abStufe('omnipotent'), measure: (c) => c.bestRarity },
  { id: 'srv_origin', scope: 'server', emoji: '🎆', title: 'Origin',
    text: 'Ein Stück der Stufe Origin. Diese Zeile bleibt leer, und das ist der Witz.',
    on: 'fire:loot', test: abStufe('origin'), measure: (c) => c.bestRarity },
];

const RULE_BY_ID = new Map(RULES.map((r) => [r.id, r]));

/** Die Regel zu einer Kennung, oder null. */
function byId(id) {
  return RULE_BY_ID.get(String(id ?? '')) ?? null;
}

module.exports = { TIERS, RULES, byId, rarityRank };
```

- [ ] **Step 6: Run test to verify it passes**

Run: `node test/achievements.test.js`
Expected: PASS — die Ausgabe endet mit `0 fehlgeschlagen`

- [ ] **Step 7: Commit**

```bash
git add src/achievements.js test/achievements.test.js
git commit -m "erfolge: regelwerk mit 37 privaten und 15 serverweiten"
```

---

### Task 3: Vergabe und Zustandsdaten

**Files:**
- Modify: `src/achievements.js`
- Modify: `test/achievements.test.js`

**Interfaces:**
- Consumes: `RULES`, `TIERS`, `byId` aus Task 2; `db.awardAchievement`, `db.claimFirst` aus Task 1
- Produces:
  - `achievements.check(guildId, userId, hook, ctx) -> Rule[]` — vergibt synchron, meldet nichts
  - `achievements.stateCtx(guildId, userId, worth) -> ctx` — die faulen Getter
  - `achievements.onActivity(guildId, userId, kind) -> Promise<Rule[]>`
  - `achievements.state(guildId, userId, worth) -> Promise<Rule[]>`
  - `achievements.fire(guildId, userId, name, daten) -> Promise<Rule[]>`

- [ ] **Step 1: Write the failing test**

An `test/achievements.test.js` anhängen:

```js
  console.log('--- Vergeben: einmal, synchron, ohne Geld ---');
  const C = 'fx:cem', D = 'fx:dora';

  // §3: Die Geldschnittstelle wird ersetzt und mitgezählt. Sie darf nie
  // angefasst werden – ein Erfolg ist Ruhm, keine Auszahlung.
  const unb = require('../src/unb');
  let geldAufrufe = 0;
  // Das Original merken: Task 6 prüft den echten Andockpunkt in changeCash
  // und braucht die unveränderte Funktion zurück.
  const echtesChangeCash = unb.changeCash;
  unb.changeCash = async () => { geldAufrufe++; return { cash: 0, bank: 0, total: 0 }; };
  unb.getBalance = async () => ({ cash: 0, bank: 0, total: 0 });

  db.setActivity(W, C, 'fishing', 100, 1000);
  const ersteRunde = await ach.onActivity(W, C, 'fishing');
  const idsRunde = ersteRunde.map((r) => r.id).sort();
  check('Bronze und Silber gehen zusammen raus',
    idsRunde.join(',') === 'fish_1,fish_100', idsRunde.join(','));
  check('beim zweiten Mal nichts mehr',
    (await ach.onActivity(W, C, 'fishing')).length === 0);
  check('§3: kein einziger Geldaufruf', geldAufrufe === 0, String(geldAufrufe));

  console.log('--- §7: die Zeile steht vor dem ersten await ---');
  db.setActivity(W, D, 'fishing', 1, 1000);
  const laeuft = ach.onActivity(W, D, 'fishing');
  check('schon vor dem Auflösen in der Datenbank',
    db.achievementsOf(W, D).some((r) => r.ach_id === 'fish_1'));
  await laeuft;

  console.log('--- Serverweit: genau einer, der andere geht leer aus ---');
  const E = 'fx:emil', F = 'fx:frida';
  db.setActivity(W, E, 'job', 250, 1000);
  db.setActivity(W, F, 'job', 250, 1000);
  const erster = await ach.onActivity(W, E, 'job');
  const zweiter = await ach.onActivity(W, F, 'job');
  check('der Erste bekommt ihn', erster.some((r) => r.id === 'srv_worker'));
  check('der Zweite nicht', !zweiter.some((r) => r.id === 'srv_worker'));
  check('aber seine privaten Erfolge schon',
    zweiter.some((r) => r.id === 'job_250'), zweiter.map((r) => r.id).join(','));
  check('und er hat auch keine stille Kopie',
    !db.achievementsOf(W, F).some((r) => r.ach_id === 'srv_worker'));

  console.log('--- fire: Ereignisse ohne Geldbuchung ---');
  const G = 'fx:gustav';
  check('ein Mythic reicht nicht',
    (await ach.fire(W, G, 'loot', { rarity: 'mythic' })).length === 0);
  const cosmic = await ach.fire(W, G, 'loot', { rarity: 'cosmic' });
  check('ein Cosmic löst auch den Godlike-Erfolg aus (oder besser)',
    cosmic.some((r) => r.id === 'godlike') && cosmic.some((r) => r.id === 'srv_cosmic'),
    cosmic.map((r) => r.id).join(','));

  console.log('--- Der Buchungspfad rechnet kein Vermögen ---');
  const networth = require('../src/networth');
  const echtesOf = networth.of;
  let worthAufrufe = 0;
  networth.of = async (...a) => { worthAufrufe++; return echtesOf(...a); };
  db.setActivity(W, C, 'job', 1, 2000);
  await ach.onActivity(W, C, 'job');
  check('kein Networth auf dem Buchungspfad', worthAufrufe === 0, String(worthAufrufe));
  networth.of = echtesOf;
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node test/achievements.test.js`
Expected: FAIL — `ach.onActivity is not a function`

- [ ] **Step 3: Write the context builders**

In `src/achievements.js` vor `module.exports` einfügen:

```js
/**
 * ===========================================================================
 *  DER ZUSAMMENHANG (ctx)
 * ===========================================================================
 *
 * Jede Regel bekommt ein `ctx` mit dem, was sie zum Prüfen braucht. Die
 * teuren Werte sind **Getter**: Sie rechnen erst, wenn eine Regel danach
 * fragt, und danach nie wieder.
 *
 * Das ist keine Spielerei, sondern der Grund, warum die Prüfung an jeder
 * Geldbuchung hängen darf: Auf dem Buchungspfad laufen nur Regeln mit
 * `kind:`-Andockpunkt, und die fragen ausschließlich nach der Strichliste –
 * eine einzige Abfrage. Vermögen, Depot und Immobilien werden dort nie
 * berechnet.
 */
function baseCtx(guildId, userId, extra = {}) {
  const cache = new Map();
  const once = (key, fn) => {
    if (!cache.has(key)) cache.set(key, fn());
    return cache.get(key);
  };

  return {
    ...extra,
    get counts() {
      return once('counts', () => Object.fromEntries(
        db.activityOf(guildId, userId).map((row) => [row.kind, row.count])));
    },
    get shifts() { return this.counts.job ?? 0; },
    get cars() { return once('cars', () => db.carsOwned(guildId, userId)); },
    get bestCar() {
      return once('bestCar', () => db.getMostValuable(guildId, userId)?.price ?? 0);
    },
    get properties() {
      return once('props', () => db.listOwnedProperties(guildId, userId).length);
    },
    get realty() { return once('realty', () => db.propertyValue(guildId, userId) || 0); },
    get hasCastle() {
      return once('castle', () => db.listOwnedProperties(guildId, userId)
        .some((p) => String(p.name).toLowerCase() === 'schloss'));
    },
    get depot() {
      return once('depot', () =>
        Math.round(require('./wallstreet').portfolio(guildId, userId).value || 0));
    },
    get collection() {
      return once('coll', () => db.lootSummary(guildId, userId).value || 0);
    },
    get crime() { return once('crime', () => db.peekCriminal(guildId, userId)); },
    get heists() { return this.crime?.heists ?? 0; },
    get lootTotal() { return this.crime?.loot_total ?? 0; },
    get level() {
      return once('level', () =>
        require('./level').progress(db.getStats(guildId, userId).xp).level);
    },
    /** Bester Rang in der noch vorhandenen Sammlung – für den Nachtrag. */
    get bestRarity() {
      return once('bestRarity', () => db.listLoot(guildId, userId)
        .reduce((best, item) => Math.max(best, rarityRank(item.rarity)), -1));
    },
  };
}

/**
 * Der Zusammenhang für den `state`-Andockpunkt.
 *
 * Das Vermögen wird **übergeben**, nicht geholt: Profil und Startseite haben
 * es ohnehin gerade berechnet. Ohne diesen Kniff käme bei jedem Blick eine
 * zweite Guthabenabfrage über die API dazu.
 */
async function stateCtx(guildId, userId, worth = null) {
  const total = worth?.total ?? (await require('./networth').of(guildId, userId)
    .then((w) => w.total).catch(() => 0));
  return baseCtx(guildId, userId, { worth: total });
}
```

- [ ] **Step 4: Write the award core**

Weiter in `src/achievements.js`:

```js
/**
 * Prüft alle Regeln eines Andockpunkts und vergibt, was zutrifft.
 *
 * **Synchron** – hier ist kein `await` (§7). Ein zweiter, schneller Klick
 * findet die Zeile bereits vor, und bei einem serverweiten Erfolg entscheidet
 * die Datenbank, wer der Erste war.
 *
 * Ein Verlierer bekommt bei `scope: 'server'` GAR NICHTS – auch keine private
 * Kopie. Sonst stünde der Erfolg bei zwei Leuten im Profil, und die Ehrentafel
 * würde ihre eigene Aussage widerlegen.
 *
 * @returns {Array} die frisch vergebenen Regeln (zum Melden)
 */
function check(guildId, userId, hook, ctx, now = Date.now()) {
  const schon = new Set(db.achievementsOf(guildId, userId).map((r) => r.ach_id));
  const frisch = [];

  for (const rule of RULES) {
    if (rule.on !== hook) continue;
    if (schon.has(rule.id)) continue;

    let trifft = false;
    try { trifft = Boolean(rule.test(ctx)); }
    catch { continue; }          // eine kaputte Regel darf die anderen nicht mitreißen
    if (!trifft) continue;

    if (rule.scope === 'server' && !db.claimFirst(guildId, rule.id, userId, now)) continue;
    if (!db.awardAchievement(guildId, userId, rule.id, now)) continue;
    frisch.push(rule);
  }

  return frisch;
}

/** Andockpunkt 1: eine Geldbuchung mit `kind` (siehe unb.countActivity). */
async function onActivity(guildId, userId, kind, now = Date.now()) {
  const frisch = check(guildId, userId, `kind:${kind}`, baseCtx(guildId, userId), now);
  await report(guildId, userId, frisch);
  return frisch;
}

/** Andockpunkt 2: Profil und Startseite. `worth` spart die Guthabenabfrage. */
async function state(guildId, userId, worth = null, now = Date.now()) {
  const ctx = await stateCtx(guildId, userId, worth);
  const frisch = check(guildId, userId, 'state', ctx, now);
  await report(guildId, userId, frisch);
  return frisch;
}

/** Andockpunkt 3: die Hintertür für Ereignisse ohne Geldbuchung. */
async function fire(guildId, userId, name, daten = {}, now = Date.now()) {
  const frisch = check(
    guildId, userId, `fire:${name}`, baseCtx(guildId, userId, daten), now);
  await report(guildId, userId, frisch);
  return frisch;
}
```

- [ ] **Step 5: Add a placeholder report and export**

Vorläufig – Task 4 füllt es. Direkt vor `module.exports`:

```js
/** Meldet frisch vergebene Erfolge. Wird in Task 4 ausgebaut. */
async function report(guildId, userId, frisch) {
  return frisch;
}
```

`module.exports` ersetzen durch:

```js
module.exports = {
  TIERS, RULES, byId, rarityRank,
  baseCtx, stateCtx, check, onActivity, state, fire,
};
```

- [ ] **Step 6: Run test to verify it passes**

Run: `node test/achievements.test.js`
Expected: PASS — die Ausgabe endet mit `0 fehlgeschlagen`

- [ ] **Step 7: Commit**

```bash
git add src/achievements.js test/achievements.test.js
git commit -m "erfolge: vergabe mit faulen zustandsdaten"
```

---

### Task 4: Meldungen

**Files:**
- Modify: `src/achievements.js` (`report` ausbauen)
- Modify: `test/achievements.test.js`

**Interfaces:**
- Consumes: `check` und die drei Andockpunkte aus Task 3; `relay.broadcast(text, { lane })`; `db.createMessage`; `identity.mention`
- Produces: `report(guildId, userId, frisch) -> Promise<void>` — Postfach immer, Kanal nur bei `TIERS[tier].loud` oder `scope === 'server'`

- [ ] **Step 1: Write the failing test**

An `test/achievements.test.js` anhängen:

```js
  console.log('--- Meldungen: leise unten, laut oben ---');
  const relay = require('../src/relay');
  const durchsagen = [];
  relay.broadcast = async (text, opts = {}) => { durchsagen.push({ text, ...opts }); return ['discord']; };
  require('../src/currency').getSymbol = async () => '🪙';

  const H = 'fx:heinz';
  db.setActivity(W, H, 'fishing', 1, 1000);
  await ach.onActivity(W, H, 'fishing');
  check('Bronze geht NICHT in den Kanal', durchsagen.length === 0,
    JSON.stringify(durchsagen));
  check('steht aber im Postfach',
    db.listMessages(W, H).items.some((m) => m.title.includes('Erster Fang')),
    JSON.stringify(db.listMessages(W, H).items.map((m) => m.title)));

  durchsagen.length = 0;
  db.setActivity(W, H, 'fishing', 500, 2000);
  await ach.onActivity(W, H, 'fishing');
  check('Gold geht in den Kanal', durchsagen.length >= 1, String(durchsagen.length));
  check('und zwar in den Hauptkanal',
    durchsagen.every((d) => d.lane === 'wichtig'), JSON.stringify(durchsagen));
  check('die Meldung nennt den Erfolg',
    durchsagen.some((d) => d.text.includes('Fischerkönig')),
    durchsagen.map((d) => d.text).join(' | '));
  check('und pingt niemanden',
    durchsagen.every((d) => !d.text.includes('@everyone') && !d.text.includes('@here')));

  durchsagen.length = 0;
  const I = 'fx:ida';
  await ach.fire(W, I, 'lot_won', { price: 150_000 });
  check('ein serverweiter Erfolg geht in den Kanal', durchsagen.length === 1);
  check('und sagt, dass es der Erste war',
    durchsagen[0]?.text.includes('als Erster'), durchsagen[0]?.text);

  console.log('--- Eine kaputte Meldung kippt die Vergabe nicht ---');
  relay.broadcast = async () => { throw new Error('kein Kanal'); };
  const J = 'fx:jonas';
  db.setActivity(W, J, 'fishing', 500, 3000);
  const trotzdem = await ach.onActivity(W, J, 'fishing');
  check('die Erfolge sind trotzdem vergeben', trotzdem.length >= 3, String(trotzdem.length));
  check('und stehen in der Datenbank',
    db.achievementsOf(W, J).some((r) => r.ach_id === 'fish_500'));
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node test/achievements.test.js`
Expected: FAIL — `❌ steht aber im Postfach` (das Postfach ist leer, `report` tut noch nichts)

- [ ] **Step 3: Implement report**

In `src/achievements.js` die Platzhalter-`report` ersetzen:

```js
/**
 * ===========================================================================
 *  MELDEN
 * ===========================================================================
 *
 * Ins Postfach kommt jeder Erfolg – dort stört er niemanden und man findet ihn
 * wieder. In den Kanal kommen nur Gold, Platin und die serverweiten: Wäre
 * jeder Erfolg laut, hätte der Hauptkanal bei zehn Spielern schnell
 * dreihundert Meldungen, und dann ist keine davon mehr ein Ereignis.
 *
 * Alles hier ist fire-and-forget und vollständig in try/catch: Ein Glückwunsch
 * darf niemals eine Schicht, einen Heist oder eine Ansicht kippen.
 */
async function report(guildId, userId, frisch, now = Date.now()) {
  if (!frisch.length) return;

  for (const rule of frisch) {
    const stufe = rule.scope === 'server' ? null : TIERS[rule.tier];

    try {
      db.createMessage({
        guildId, userId, type: 'info',
        title: `${rule.emoji} ${rule.title}`,
        body: rule.scope === 'server'
          ? `${rule.text}\nDu hast ihn **als Erster auf dem Server** geholt.`
          : `${rule.text}\n_${stufe.emoji} ${stufe.label}_`,
      });
    } catch { /* ein Postfacheintrag darf nichts kippen */ }

    if (rule.scope !== 'server' && !stufe.loud) continue;

    try {
      const identity = require('./identity');
      const text = rule.scope === 'server'
        ? `${rule.emoji} ${identity.mention(userId)} holt **${rule.title}** `
          + `– **als Erster auf dem Server**.\n_${rule.text}_`
        : `${stufe.emoji} ${identity.mention(userId)} schaltet **${rule.title}** frei.`
          + `\n_${rule.text}_`;
      await require('./relay').broadcast(text, { lane: 'wichtig' });
    } catch { /* ohne Kanal bleibt es beim Postfach */ }
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node test/achievements.test.js`
Expected: PASS — die Ausgabe endet mit `0 fehlgeschlagen`

- [ ] **Step 5: Commit**

```bash
git add src/achievements.js test/achievements.test.js
git commit -m "erfolge: meldungen ins postfach, gold und serverweit auch in den kanal"
```

---

### Task 5: Stummer Nachtrag für Bestandsspieler

**Files:**
- Modify: `src/achievements.js`
- Modify: `test/achievements.test.js`

**Interfaces:**
- Consumes: `check`, `stateCtx`, `baseCtx`; `db.getClaim`/`db.setClaim`; `networth.owners`
- Produces:
  - `achievements.backfill(guildId, userId) -> Promise<number>` — still, einmal je Konto
  - `achievements.backfillWorld(guildId) -> Promise<number>` — still, einmal je Welt

- [ ] **Step 1: Write the failing test**

An `test/achievements.test.js` anhängen:

```js
  console.log('--- Nachtrag: alles auf einmal, aber lautlos ---');
  relay.broadcast = async (text, opts = {}) => { durchsagen.push({ text, ...opts }); return ['discord']; };
  durchsagen.length = 0;

  const K = 'fx:karl';                       // ein Bestandsspieler mit Vorgeschichte
  db.setActivity(W, K, 'fishing', 600, 1000);
  db.setActivity(W, K, 'job', 300, 1000);
  const vorher = db.listMessages(W, K).total;

  const nachgetragen = await ach.backfill(W, K);
  check('der Nachtrag vergibt mehrere Erfolge auf einmal', nachgetragen >= 6,
    String(nachgetragen));
  check('aber KEINE Durchsage', durchsagen.length === 0, JSON.stringify(durchsagen));
  check('und kein Postfach-Eintrag', db.listMessages(W, K).total === vorher,
    `${vorher} -> ${db.listMessages(W, K).total}`);
  check('die Erfolge sind trotzdem da',
    db.achievementsOf(W, K).some((r) => r.ach_id === 'fish_500'));
  check('ein zweiter Nachtrag tut nichts mehr', (await ach.backfill(W, K)) === 0);

  console.log('--- Serverweiter Nachtrag geht an den Stärksten ---');
  // Zwei Konten erfüllen "Der erste Malocher". Der mit den meisten Schichten
  // soll ihn bekommen – nicht der, der zufällig zuerst geprüft wird.
  const W2 = `${W}_B`;
  db.setActivity(W2, 'fx:wenig', 'job', 260, 1000);
  db.setActivity(W2, 'fx:viel', 'job', 900, 1000);

  // Die Konten werden ausdrücklich übergeben – so hängt der Test nicht an
  // networth.owners und damit nicht am Besitz in einer fremden Welt.
  await ach.backfillWorld(W2, ['fx:wenig', 'fx:viel']);
  const tafel2 = db.allFirsts(W2).find((r) => r.ach_id === 'srv_worker');
  check('der mit den meisten Schichten hält ihn', tafel2?.user_id === 'fx:viel',
    JSON.stringify(tafel2));
  check('auch der serverweite Nachtrag war lautlos', durchsagen.length === 0,
    JSON.stringify(durchsagen));
  check('ohne Daten kein Nachtrag: der perfekte Coup bleibt frei',
    !db.allFirsts(W2).some((r) => r.ach_id === 'srv_heist'));
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node test/achievements.test.js`
Expected: FAIL — `ach.backfill is not a function`

- [ ] **Step 3: Implement the per-account backfill**

In `src/achievements.js` vor `module.exports`:

```js
/**
 * ===========================================================================
 *  NACHTRAG FÜR BESTANDSSPIELER
 * ===========================================================================
 *
 * Die Erfolge beginnen bei null – wer vorher 600 Fische gefangen hat, stünde
 * ohne alles da. Also einmalig alles vergeben, was schon erfüllt ist.
 *
 * **Lautlos**, und das ist der ganze Punkt: Ohne diese Regel bekäme ein
 * Bestandsspieler beim ersten Menü-Klick zwanzig Glückwünsche am Stück, und
 * der Hauptkanal wäre am Tag der Einführung unbenutzbar. Wie bei
 * `activity.backfill()` und der Erstbefüllung des Treppchens gilt: Der erste
 * Durchlauf merkt sich den Stand, gefeiert wird ab der nächsten Veränderung.
 *
 * @returns {Promise<number>} wie viele Erfolge nachgetragen wurden
 */
async function backfill(guildId, userId, now = Date.now()) {
  if (db.getClaim(guildId, userId, 'ach_backfill')) return 0;
  db.setClaim(guildId, userId, 'ach_backfill', now);   // synchron, vor dem ersten await (§7)

  const ctx = await stateCtx(guildId, userId);
  let n = 0;

  // Alle Andockpunkte durchgehen: Was zählbar ist, ist auch nachtragbar.
  // `fire`-Erfolge ohne Daten in der Vergangenheit fallen dabei von selbst
  // heraus – ihr `test` bekommt kein Ereignis und schlägt fehl.
  for (const hook of hooksOf('privat')) {
    n += check(guildId, userId, hook, ctx, now).length;
  }
  return n;
}

/** Alle Andockpunkte, die in Regeln dieser Sorte vorkommen. */
function hooksOf(scope) {
  return [...new Set(RULES.filter((r) => r.scope === scope).map((r) => r.on))];
}
```

- [ ] **Step 4: Implement the world backfill**

Direkt anschließend:

```js
/**
 * Einmaliger Durchlauf über die ganze Welt für die serverweiten Erfolge.
 *
 * Ohne ihn ginge „Der erste Millionär" an den, der nach dem Update zufällig
 * zuerst ins Menü klickt – nicht an den Reichsten. Deshalb wird hier der
 * Kandidat mit dem höchsten `measure` bestimmt und bekommt ihn.
 *
 * Erfolge mit `backfill: false` bleiben außen vor: Für sie gibt es keine
 * Daten in der Vergangenheit (ein perfekter Coup wird nirgends festgehalten),
 * also starten sie leer und gehen an den Nächsten, der es schafft.
 *
 * @param {string[]} [konten] – nur für Tests; sonst alle mit Besitz
 * @returns {Promise<number>} wie viele serverweite Erfolge vergeben wurden
 */
async function backfillWorld(guildId, konten = null, now = Date.now()) {
  if (db.getClaim(guildId, '*', 'ach_backfill_world')) return 0;
  db.setClaim(guildId, '*', 'ach_backfill_world', now);

  const alle = konten ?? require('./networth').owners(guildId);
  if (!alle.length) return 0;

  // Einmal je Konto den Zusammenhang bauen, nicht je Regel.
  const ctxs = [];
  for (const userId of alle) ctxs.push([userId, await stateCtx(guildId, userId)]);

  let n = 0;
  for (const rule of RULES) {
    if (rule.scope !== 'server' || rule.backfill === false) continue;

    let bester = null;
    let bestwert = -Infinity;
    for (const [userId, ctx] of ctxs) {
      let trifft = false;
      try { trifft = Boolean(rule.test(ctx)); } catch { continue; }
      if (!trifft) continue;

      const wert = rule.measure ? rule.measure(ctx) : ctx.worth;
      if (wert > bestwert) { bestwert = wert; bester = userId; }
    }

    if (!bester) continue;
    if (!db.claimFirst(guildId, rule.id, bester, now)) continue;
    db.awardAchievement(guildId, bester, rule.id, now);
    n++;
  }
  return n;
}
```

Im `module.exports` ergänzen: `backfill, backfillWorld, hooksOf,`

- [ ] **Step 5: Run test to verify it passes**

Run: `node test/achievements.test.js`
Expected: PASS — die Ausgabe endet mit `0 fehlgeschlagen`

- [ ] **Step 6: Commit**

```bash
git add src/achievements.js test/achievements.test.js
git commit -m "erfolge: stummer nachtrag fuer bestandsspieler"
```

---

### Task 6: Andockpunkte einhängen

**Files:**
- Modify: `src/unb.js:92-96` (`countActivity`)
- Modify: `src/ui.js` (`buildProfileView`, `buildHomeView`)
- Modify: `src/heist.js` (nach `saveCriminal` im Ergebnis-Block)
- Modify: `src/home.js:145`
- Modify: `src/casinoPlay.js` (`playRound`, `finish`)
- Modify: `src/storage.js` (`resolveLot`, `openGarage`)
- Modify: `test/achievements.test.js`

**Interfaces:**
- Consumes: `achievements.onActivity`, `achievements.state`, `achievements.fire`, `achievements.backfill`
- Produces: keine neuen Signaturen

- [ ] **Step 1: Write the failing test**

An `test/achievements.test.js` anhängen:

```js
  console.log('--- Der Andockpunkt an der Geldbuchung ---');
  // Ab hier wieder die echte Buchung: Sie ruft countActivity auf, und genau
  // das ist der Andockpunkt, der hier geprüft wird. Für `fx:`-Konten läuft
  // sie über das lokale Wallet, also ohne Netz (§12).
  unb.changeCash = echtesChangeCash;

  const L = 'fx:lena';
  await unb.changeCash(W, L, 500, 'Schicht', { kind: 'job' });
  check('eine Buchung mit kind vergibt den Erfolg',
    db.achievementsOf(W, L).some((r) => r.ach_id === 'job_1'),
    JSON.stringify(db.achievementsOf(W, L)));

  const M = 'fx:mia';
  await unb.changeCash(W, M, 500, 'Storno', { kind: 'job', xp: false });
  check('eine Stornobuchung vergibt nichts', db.achievementsOf(W, M).length === 0);
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node test/achievements.test.js`
Expected: FAIL — `❌ eine Buchung mit kind vergibt den Erfolg`

- [ ] **Step 3: Hook into countActivity**

`src/unb.js`, die Funktion `countActivity` ersetzen:

```js
/**
 * Führt Strichliste darüber, was jemand tut – daraus entsteht der Titel im
 * Profil (siehe activity.js) und, seit den Erfolgen, auch das Abzeichen.
 * Gezählt wird nur, was ein `kind` mitbringt; Storno- und Rückerstattungs-
 * buchungen (`{ xp: false }`) zählen nie mit, sonst stünde für eine
 * abgebrochene Aktion ein Strich in der Liste.
 */
function countActivity(guildId, accountId, opts = {}) {
  if (!opts.kind || opts.xp === false) return;
  try { require('./activity').record(guildId, accountId, opts.kind); }
  catch { /* ein Strich in der Liste darf keine Buchung scheitern lassen */ }

  // Erfolge hängen an derselben Stelle – hier ist bekannt, WAS jemand getan
  // hat. Bewusst ohne await: Ein Glückwunsch darf eine Schicht nicht bremsen.
  try { require('./achievements').onActivity(guildId, accountId, opts.kind).catch(() => {}); }
  catch { /* dito */ }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node test/achievements.test.js`
Expected: PASS — die Ausgabe endet mit `0 fehlgeschlagen`

- [ ] **Step 5: Hook the state point into the profile**

`src/ui.js`, in `buildProfileView` direkt **nach** der Zeile
`const worth = await require('./networth').of(guildId, owner, bal);` einfügen:

```js
  /*
   * Erfolge, die am Zustand hängen (Vermögen, Level, Fuhrpark), werden hier
   * geprüft: Das Vermögen liegt gerade vor, also kostet es keine zusätzliche
   * Abfrage. Erst der Nachtrag (still), dann die laufende Prüfung – sonst
   * käme für einen Bestandsspieler beim ersten Blick eine Welle Meldungen.
   */
  const erfolge = require('./achievements');
  await erfolge.backfill(guildId, owner).catch(() => {});
  erfolge.state(guildId, owner, worth).catch(() => {});
```

- [ ] **Step 6: Hook the state point into the home view**

`src/ui.js`, in `buildHomeView` nach der Berechnung des Vermögens dieselben
drei Zeilen einfügen (dort heißt die Variable ebenfalls `worth`; falls nicht
vorhanden, `null` übergeben — `stateCtx` holt es dann selbst):

```js
  const erfolge = require('./achievements');
  await erfolge.backfill(guildId, userId).catch(() => {});
  erfolge.state(guildId, userId, null).catch(() => {});
```

- [ ] **Step 7: Add the five fire calls**

`src/heist.js`, in der Crew-Schleife direkt nach `db.saveCriminal(...)`:

```js
    // Ein Ding ganz ohne Fehler – das gibt es nur bei `clean`, nicht bei
    // `messy`. Kein Geldereignis, deshalb die Hintertür.
    if (outcome === 'clean') {
      require('./achievements').fire(guildId, member.user_id, 'heist_perfect').catch(() => {});
    }
```

`src/home.js:145`, direkt nach `db.setHome(guildId, userId, target.id, { move: true, at: now });`:

```js
  require('./achievements').fire(guildId, userId, 'move', { country: target.id })
    .catch(() => {});
```

`src/casinoPlay.js`, in `playRound` direkt vor dem `return`:

```js
  // Der Gewinn EINER Runde – nicht die Summe. Genau darum geht es beim
  // Hochroller: einmal groß, nicht oft klein.
  if (net > 0) {
    require('./achievements').fire(guildId, userId, 'casino_win', { amount: net })
      .catch(() => {});
  }
```

`src/casinoPlay.js`, in `finish` direkt vor dem `return`:

```js
  const gewinn = gross - g.bet;
  if (gewinn > 0) {
    require('./achievements').fire(guildId, userId, 'casino_win', { amount: gewinn })
      .catch(() => {});
  }
```

`src/storage.js`, in `resolveLot` direkt vor
`return { lotId: lot.id, status: 'sold', winner, label, price };`:

```js
  require('./achievements').fire(guildId, winner, 'lot_won', { price }).catch(() => {});
```

`src/storage.js`, in `openGarage` in der Schleife über `c.objects`:

```js
  for (const o of c.objects || []) {
    db.addLoot(guildId, userId, o.name, o.value, o.rarity, o.condition, null);
    // Die Seltenheit zählt im Moment des Aufdeckens. Über den Zustand ginge
    // leer aus, wer das Stück vor der nächsten Prüfung verkauft.
    require('./achievements').fire(guildId, userId, 'loot', { rarity: o.rarity })
      .catch(() => {});
  }
```

- [ ] **Step 8: Run the affected suites**

Run: `node test/achievements.test.js && node test/heist.test.js && node test/storage.test.js && node test/casino.test.js && node test/home.test.js`
Expected: alle vier mit `0 fehlgeschlagen`

- [ ] **Step 9: Commit**

```bash
git add src/unb.js src/ui.js src/heist.js src/home.js src/casinoPlay.js src/storage.js test/achievements.test.js
git commit -m "erfolge: an buchung, zustand und fuenf ereignisse angehaengt"
```

---

### Task 7: Die Ansicht

**Files:**
- Create: `src/achievementsUi.js`
- Modify: `src/menu.js` (ein Eintrag in `ENTRIES`, Gruppe `me`)
- Modify: `test/achievements.test.js`
- Modify: `test/menu.test.js`

**Interfaces:**
- Consumes: `achievements.RULES`, `TIERS`, `db.achievementsOf`, `db.allFirsts`, `identity.display`
- Produces:
  - `achievements.listFor(guildId, userId) -> Promise<{offen: Array, geholt: Array, gesamt: number}>`
  - `achievements.board(guildId) -> Array<{rule, userId|null, at|null}>`
  - `achievementsUi.buildAchievementsView({guildId, userId, page}) -> {embeds, components}`

- [ ] **Step 1: Write the failing test**

An `test/achievements.test.js` anhängen:

```js
  console.log('--- Die Ansicht ---');
  const liste = await ach.listFor(W, K);
  check('geholte und offene Erfolge sind getrennt',
    liste.geholt.length > 0 && liste.offen.length > 0,
    `${liste.geholt.length} / ${liste.offen.length}`);
  check('zusammen sind es alle privaten', liste.gesamt === 37, String(liste.gesamt));
  check('keiner steht in beiden Listen',
    !liste.geholt.some((g) => liste.offen.some((o) => o.id === g.id)));

  const offenMitZiel = liste.offen.find((r) => r.progress);
  check('offene Erfolge zeigen Fortschritt als [ist, soll]',
    Array.isArray(offenMitZiel?.progress) && offenMitZiel.progress.length === 2,
    JSON.stringify(offenMitZiel?.progress));
  check('und der Fortschritt liegt unter dem Ziel',
    offenMitZiel.progress[0] < offenMitZiel.progress[1],
    JSON.stringify(offenMitZiel.progress));

  const tafel3 = ach.board(W);
  check('die Ehrentafel listet alle serverweiten', tafel3.length === 15, String(tafel3.length));
  check('vergebene nennen den Halter',
    tafel3.find((e) => e.rule.id === 'srv_worker')?.userId === 'fx:emil');
  check('unerreichte bleiben leer',
    tafel3.find((e) => e.rule.id === 'srv_origin')?.userId === null);

  const ui = require('../src/achievementsUi');
  const ansicht = await ui.buildAchievementsView({ guildId: W, userId: K });
  check('die Ansicht baut ein Embed', ansicht.embeds?.length === 1);
  const text = JSON.stringify(ansicht.embeds[0].toJSON());
  check('sie nennt den Zähler', /\d+\s*\/\s*37/.test(text), text.slice(0, 200));
  check('und keine rohe Konto-ID', !text.includes('fx:karl'), text.slice(0, 200));
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node test/achievements.test.js`
Expected: FAIL — `ach.listFor is not a function`

- [ ] **Step 3: Implement listFor and board**

In `src/achievements.js` vor `module.exports`:

```js
/**
 * Die eigenen Erfolge für die Ansicht: was man hat, was noch fehlt.
 *
 * Der Fortschritt (`[ist, soll]`) macht den Unterschied zwischen einer Liste
 * und einem Ziel: „37 / 250 Schichten" sagt einem, dass man dran ist –
 * „Arbeitstier: gesperrt" sagt gar nichts.
 */
async function listFor(guildId, userId) {
  const privat = RULES.filter((r) => r.scope === 'privat');
  const haben = new Map(db.achievementsOf(guildId, userId).map((r) => [r.ach_id, r.at]));
  const ctx = await stateCtx(guildId, userId);

  const geholt = [];
  const offen = [];
  for (const rule of privat) {
    if (haben.has(rule.id)) { geholt.push({ ...rule, at: haben.get(rule.id) }); continue; }
    let progress = null;
    try { progress = rule.progress ? rule.progress(ctx) : null; } catch { /* egal */ }
    offen.push({ ...rule, progress });
  }

  // Seltenstes zuerst – Platin oben, damit der Flex sichtbar ist.
  geholt.sort((a, b) => TIERS[b.tier].rank - TIERS[a.tier].rank || b.at - a.at);
  offen.sort((a, b) => TIERS[a.tier].rank - TIERS[b.tier].rank);

  return { geholt, offen, gesamt: privat.length };
}

/**
 * Die Ehrentafel: alle serverweiten Erfolge mit ihrem Halter.
 *
 * Auch die unerreichten stehen drin. Eine leere Zeile ist hier kein Mangel,
 * sondern der Reiz – sie zeigt, dass es noch etwas zu holen gibt.
 */
function board(guildId) {
  const halter = new Map(db.allFirsts(guildId).map((r) => [r.ach_id, r]));
  return RULES.filter((r) => r.scope === 'server').map((rule) => {
    const treffer = halter.get(rule.id) ?? null;
    return { rule, userId: treffer?.user_id ?? null, at: treffer?.at ?? null };
  });
}
```

`module.exports` ergänzen: `listFor, board,`

- [ ] **Step 4: Implement the view**

Neue Datei `src/achievementsUi.js`:

```js
const { EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
const identity = require('./identity');
const achievements = require('./achievements');

/**
 * ===========================================================================
 *  ANSICHT DER ERFOLGE
 * ===========================================================================
 *
 * Zwei Seiten: die eigenen Erfolge und die Ehrentafel. Bewusst eine eigene
 * Datei statt eines weiteren Blocks in ui.js – die hat über viertausend
 * Zeilen, und casinoUi.js zeigt, dass ausgelagerte Ansichten hier üblich sind.
 *
 * Die Datei kennt keine Regeln, nur `achievements.listFor` und `board`. Wer
 * einen Erfolg hinzufügt, muss hier nichts anfassen.
 */

/** Ein Balken aus [ist, soll] – zehn Felder, damit es auf Fluxer nicht bricht. */
function bar([ist, soll]) {
  const anteil = soll > 0 ? Math.min(1, ist / soll) : 0;
  const voll = Math.round(anteil * 10);
  return `${'▰'.repeat(voll)}${'▱'.repeat(10 - voll)}`;
}

const zahl = (n) => Math.round(n).toLocaleString('de-DE');

/** Höchstens so viele offene Erfolge zeigen – der Rest wäre eine Wand. */
const OFFEN_MAX = 8;

/**
 * Seite 1: die eigenen Erfolge.
 * Geholte oben (Platin zuerst), darunter die nächsten erreichbaren Ziele.
 */
async function buildAchievementsView({ guildId, userId, page = 1 }) {
  const { geholt, offen, gesamt } = await achievements.listFor(guildId, userId);

  const embed = new EmbedBuilder()
    .setTitle('🏅 Erfolge')
    .setColor(0xf1c40f)
    .setDescription(
      `${identity.mention(userId)} · **${geholt.length} / ${gesamt}**`
      + (geholt.length === gesamt ? '\nAlles geholt. Ernsthaft?' : ''));

  if (geholt.length) {
    embed.addFields({
      name: '✅ Geholt',
      value: geholt.slice(0, 15).map((r) =>
        `${r.emoji} **${r.title}** _(${achievements.TIERS[r.tier].label})_`).join('\n')
        + (geholt.length > 15 ? `\n… und ${geholt.length - 15} weitere` : ''),
    });
  }

  if (offen.length) {
    embed.addFields({
      name: '🔒 Als Nächstes',
      value: offen.slice(0, OFFEN_MAX).map((r) => {
        const ziel = r.progress
          ? `\n${bar(r.progress)} ${zahl(r.progress[0])} / ${zahl(r.progress[1])}`
          : '';
        return `${r.emoji} **${r.title}** — _${r.text}_${ziel}`;
      }).join('\n'),
    });
  }

  return {
    embeds: [embed],
    components: [new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId(`erfolge-tafel|${userId}`)
        .setLabel('Ehrentafel')
        .setEmoji('👑')
        .setStyle(ButtonStyle.Primary))],
  };
}

/**
 * Seite 2: die Ehrentafel der serverweiten Erfolge.
 *
 * Auch die leeren Zeilen bleiben stehen – sie sind die Einladung.
 */
async function buildBoardView({ guildId, userId }) {
  const tafel = achievements.board(guildId);
  const vergeben = tafel.filter((e) => e.userId);

  const embed = new EmbedBuilder()
    .setTitle('👑 Ehrentafel')
    .setColor(0xe67e22)
    .setDescription(
      'Diese Erfolge kann nur **einer** haben – wer zuerst da ist, behält ihn.\n'
      + `Vergeben: **${vergeben.length} / ${tafel.length}**`)
    .addFields({
      name: 'Serverweit',
      value: tafel.map((e) =>
        `${e.rule.emoji} **${e.rule.title}** — `
        + (e.userId ? identity.mention(e.userId) : '_noch niemand_')).join('\n'),
    });

  return {
    embeds: [embed],
    components: [new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId(`erfolge-meine|${userId}`)
        .setLabel('Meine Erfolge')
        .setEmoji('🏅')
        .setStyle(ButtonStyle.Secondary))],
  };
}

module.exports = { buildAchievementsView, buildBoardView, bar };
```

- [ ] **Step 5: Add the menu entry**

`src/menu.js`, in `ENTRIES` bei der Gruppe `me` ergänzen:

```js
  {
    id: 'erfolge',
    group: 'me',
    label: 'Erfolge',
    emoji: '🏅',
    description: 'Abzeichen, Meilensteine und die Ehrentafel',
    style: 'primary',
    build: (ctx) => require('./achievementsUi').buildAchievementsView(ctx),
  },
```

Den Kommentar über `ENTRIES` ergänzen:

```js
 * Discord erlaubt 25 Buttons (5 Zeilen à 5) – so viele Menüpunkte passen.
 * Mit "Erfolge" sind es jetzt genau 25. Wer einen weiteren Punkt will, muss
 * vorher einen anderen entfernen oder zusammenlegen.
```

- [ ] **Step 6: Add the menu-size guard**

In `test/menu.test.js` **vor** der Zeile `process.exit(fail === 0 ? 0 : 1);`
(sie steht in Zeile 127, alles danach würde nie laufen):

```js
  console.log('--- Das Hauptmenü passt noch in Discords Grenze ---');
  check('höchstens 25 Menüpunkte', ENTRIES.length <= 25, String(ENTRIES.length));
  check('der Erfolgs-Eintrag ist dabei', ENTRIES.some((e) => e.id === 'erfolge'));
```

- [ ] **Step 7: Run tests to verify they pass**

Run: `node test/achievements.test.js && node test/menu.test.js`
Expected: beide `0 fehlgeschlagen`

- [ ] **Step 8: Commit**

```bash
git add src/achievementsUi.js src/achievements.js src/menu.js test/achievements.test.js test/menu.test.js
git commit -m "erfolge: eigene ansicht und ehrentafel"
```

---

### Task 8: Profil-Abzeichen und Erfolgstitel

**Files:**
- Modify: `src/activity.js` (`titleOf`, `unlocked`, `choose`)
- Modify: `src/ui.js` (`buildProfileView` Beschreibung, `buildTitleView`)
- Modify: `test/achievements.test.js`

**Interfaces:**
- Consumes: `achievements.listFor`, `achievements.byId`, `achievements.TIERS`
- Produces:
  - `activity.titleOf(guildId, userId)` versteht zusätzlich einen Wunsch `ach:<id>`
  - `achievements.titlesFor(guildId, userId) -> Array<{id, emoji, title}>` — Gold, Platin, serverweit

- [ ] **Step 1: Write the failing test**

An `test/achievements.test.js` anhängen:

```js
  console.log('--- Erfolgstitel reihen sich in die vorhandenen ein ---');
  const titel = ach.titlesFor(W, K);
  check('nur Gold, Platin und serverweit sind Titel',
    titel.every((t) => {
      const r = ach.byId(t.id.slice(4));
      return r.scope === 'server' || r.tier === 'gold' || r.tier === 'platin';
    }), JSON.stringify(titel));
  check('Karls Fischerkönig ist dabei',
    titel.some((t) => t.id === 'ach:fish_500'), JSON.stringify(titel));

  const activity2 = require('../src/activity');
  check('der Titel lässt sich wählen', activity2.choose(W, K, 'ach:fish_500') === true);
  const getragen = activity2.titleOf(W, K);
  check('und steht dann im Profil',
    getragen?.title === 'Fischerkönig', JSON.stringify(getragen));
  check('als selbst gewählt markiert', getragen?.chosen === true);

  check('ein nicht verdienter Erfolgstitel wird abgelehnt',
    activity2.choose(W, K, 'ach:srv_origin') === false);
  activity2.choose(W, K, '');
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node test/achievements.test.js`
Expected: FAIL — `ach.titlesFor is not a function`

- [ ] **Step 3: Implement titlesFor**

In `src/achievements.js` vor `module.exports`:

```js
/**
 * Erfolge, die einen Titel hergeben: Gold, Platin und alle serverweiten.
 *
 * Bronze und Silber bewusst nicht – ein Titel soll etwas bedeuten, und
 * „Erster Arbeitstag" über dem Profil sagt nur, dass man einmal da war.
 *
 * Die Kennungen tragen das Präfix `ach:`, damit activity.js sie von seinen
 * eigenen Titeln unterscheiden kann, ohne dass beide Listen sich kennen.
 */
function titlesFor(guildId, userId) {
  const haben = new Set(db.achievementsOf(guildId, userId).map((r) => r.ach_id));
  return RULES
    .filter((r) => haben.has(r.id))
    .filter((r) => r.scope === 'server' || r.tier === 'gold' || r.tier === 'platin')
    .map((r) => ({ id: `ach:${r.id}`, emoji: r.emoji, title: r.title }));
}
```

`module.exports` ergänzen: `titlesFor,`

- [ ] **Step 4: Teach activity.js the prefix**

`src/activity.js`, `titleOf` ersetzen:

```js
/**
 * Der Titel, der im Profil steht.
 *
 * Reihenfolge: eigene Wahl schlägt Automatik, 'none' heißt „keiner", und ohne
 * Wahl gewinnt die häufigste Aktivität. Wer noch gar nichts gemacht hat,
 * bekommt keinen Titel – das ist kein Fehler, sondern der Anfang.
 *
 * Ein Wunsch mit dem Präfix `ach:` kommt aus den Erfolgen (achievements.js).
 * Die beiden Listen kennen einander nicht; das Präfix ist die ganze
 * Schnittstelle – so bleibt es EIN Titelsystem statt zwei.
 *
 * @returns {{id,emoji,title,count,tier,chosen:boolean}|null}
 */
function titleOf(guildId, userId) {
  const wish = String(db.getStats(guildId, userId).title ?? '');
  if (wish === 'none') return null;

  if (wish.startsWith('ach:')) {
    const eigene = require('./achievements').titlesFor(guildId, userId);
    const treffer = eigene.find((t) => t.id === wish);
    // Kein Treffer heißt: Der Erfolg ist (noch) nicht verdient. Nicht
    // schummeln – dann greift unten die Automatik.
    if (treffer) {
      return { id: treffer.id, emoji: treffer.emoji, title: treffer.title,
        count: 0, tier: 0, chosen: true };
    }
  }

  const list = unlocked(guildId, userId);
  if (wish) {
    const own = list.find((t) => t.id === wish);
    if (own) return { ...own, chosen: true };
  }
  return list.length ? { ...list[0], chosen: false } : null;
}
```

`choose` ersetzen:

```js
/** Setzt den Wunsch: eine Kennung, '' für automatisch, 'none' für keinen. */
function choose(guildId, userId, wish) {
  const value = String(wish ?? '');

  if (value.startsWith('ach:')) {
    // Nur verdiente Erfolgstitel – sonst könnte man sich "Origin" anheften.
    const eigene = require('./achievements').titlesFor(guildId, userId);
    if (!eigene.some((t) => t.id === value)) return false;
    db.setTitle(guildId, userId, value);
    return true;
  }

  if (value && value !== 'none' && !byId.has(value)) return false;
  db.setTitle(guildId, userId, value);
  return true;
}
```

- [ ] **Step 5: Add the badge line to the profile**

`src/ui.js`, in `buildProfileView` die `setDescription(...)`-Zeile ergänzen. Vor
dem `EmbedBuilder` einfügen:

```js
  // Abzeichen: die drei seltensten, serverweite immer zuerst. Eine Zeile
  // reicht – die vollständige Liste hat ihre eigene Ansicht.
  const erfolgListe = await require('./achievements').listFor(guildId, owner)
    .catch(() => ({ geholt: [], gesamt: 0 }));
  const abzeichen = erfolgListe.geholt.slice(0, 3).map((r) => r.emoji).join(' ');
```

Und in `setDescription` nach der `worn`-Zeile einfügen:

```js
      (erfolgListe.gesamt
        ? `🏅 ${erfolgListe.geholt.length}/${erfolgListe.gesamt}${abzeichen ? ` ${abzeichen}` : ''}\n`
        : '') +
```

- [ ] **Step 6: Offer the achievement titles in the title menu**

`src/ui.js`, in `buildTitleView` hinter `const list = activity.unlocked(guildId, userId);`:

```js
  // Erfolgstitel stehen gleichberechtigt zur Wahl – sie kommen nur aus einer
  // anderen Quelle (achievements.js), erkennbar am Präfix `ach:`.
  const ausErfolgen = require('./achievements').titlesFor(guildId, userId);
```

Und in der Auswahlliste die Einträge aus `ausErfolgen` mit anhängen (dieselbe
Form wie die vorhandenen: `label` = `title`, `value` = `id`, `emoji` = `emoji`).

- [ ] **Step 7: Run tests to verify they pass**

Run: `node test/achievements.test.js && node test/activity.test.js && node test/home.test.js`
Expected: alle `0 fehlgeschlagen`

- [ ] **Step 8: Commit**

```bash
git add src/achievements.js src/activity.js src/ui.js test/achievements.test.js
git commit -m "erfolge: abzeichen im profil und titel aus erfolgen"
```

---

### Task 9: Abschluss

**Files:**
- Modify: `package.json`
- Modify: `ARCHITEKTUR.md`
- Modify: `src/data/patchnotes.js`

**Interfaces:**
- Consumes: alles Vorherige
- Produces: nichts Neues

- [ ] **Step 1: Add the test to the chain**

`package.json`, im `test`-Skript hinter `node test/podium.test.js &&` einfügen:

```
node test/achievements.test.js &&
```

- [ ] **Step 2: Document the hook point**

`ARCHITEKTUR.md`, am Ende einen Abschnitt anfügen:

```markdown
## Erfolge

`src/achievements.js` hält ein deklaratives Regelwerk. Ein neuer Erfolg ist ein
Eintrag in `RULES` – sonst nichts. Drei Andockpunkte:

- `kind:<id>` – läuft in `unb.countActivity`, also an jeder Geldbuchung mit
  `kind`. Dort werden **nur** Regeln dieses `kind` geprüft; teure Werte
  (Vermögen, Depot) werden auf diesem Pfad nie berechnet.
- `state` – läuft beim Aufbau von Profil und Startseite, wo das Vermögen
  ohnehin vorliegt und übergeben wird.
- `fire:<name>` – die Hintertür für Ereignisse ohne Geldbuchung
  (`achievements.fire(...)` in heist.js, home.js, casinoPlay.js, storage.js).

Die serverweite Einmaligkeit hängt am Primärschlüssel von
`achievement_firsts`, nicht an einer Prüfung im Code (§7): Zwei gleichzeitige
Spieler bestünden ein „gibt es den schon?" beide.

Erfolge geben **kein Geld und keine XP** (§3). Das Modul bindet weder `unb`
noch `wallet` noch `level` ein.
```

- [ ] **Step 3: Add a patchnote**

`src/data/patchnotes.js`, neuen Eintrag oben in der Liste (Form der
vorhandenen Einträge übernehmen):

```js
  {
    version: '1.27.0',
    date: '2026-09-08',
    title: '🏅 Erfolge',
    lines: [
      '**37 private Erfolge** in vier Stufen – von der ersten Schicht bis Level 100.',
      '**15 serverweite Erfolge**, die nur *einer* haben kann. Wer zuerst da ist, behält sie.',
      'Gold, Platin und serverweite Erfolge werden im Kanal angesagt; die kleinen landen still im Postfach.',
      'Neuer Menüpunkt **Erfolge** mit Fortschrittsanzeige und Ehrentafel.',
      'Wer schon lange dabei ist, bekommt seine Erfolge beim ersten Blick nachgetragen – lautlos.',
    ],
  },
```

- [ ] **Step 4: Run the full suite**

Run: `npm test`
Expected: jede Datei endet mit `0 fehlgeschlagen`, Gesamtzahl über 1.870 Prüfungen

- [ ] **Step 5: Commit**

```bash
git add package.json ARCHITEKTUR.md src/data/patchnotes.js
git commit -m "erfolge: test in die kette, architektur und patchnotes"
```

---

## Selbstprüfung (nach dem Schreiben durchgegangen)

**Spec-Abdeckung:** Datenmodell → Task 1. Regelform und alle 52 Regeln → Task 2. Drei Andockpunkte → Task 3 (Logik) und Task 6 (Einhängen). Vergabe-Ablauf §7 → Task 3. Meldungen mit Stufen und Lane → Task 4. Nachtrag privat und serverweit inklusive `backfill: false` → Task 5. Die fünf `fire`-Aufrufe → Task 6. Beide Ansichten und der Menü-Eintrag → Task 7. Profil-Abzeichen und Titel-Integration mit `ach:`-Präfix → Task 8. §3-Nachweis → Task 3, Test „kein einziger Geldaufruf". Alle 13 Testfälle der Spec sind auf die Tasks verteilt.

**Offene Punkte, die beim Umsetzen zu klären sind:**
- Task 8, Schritt 6 beschreibt die Erweiterung des Titel-Menüs, ohne dessen genauen Code zu zeigen — `buildTitleView` in `ui.js:3258` baut die Auswahl aus `activity.unlocked`; die Erfolgstitel haben dieselbe Form (`id`, `emoji`, `title`), aber keine `count`/`tier`-Felder. Wer die Stelle anfasst, muss die vorhandene Schleife lesen.
- Task 6, Schritt 6: Ob `buildHomeView` bereits ein `worth`-Objekt hat, ist beim Umsetzen zu prüfen; falls ja, statt `null` übergeben.
