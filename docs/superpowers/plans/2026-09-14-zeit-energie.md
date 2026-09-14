# Zeit und Energie – Implementierungsplan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ein 24-h-Tag für Creator, Musik, Firma und Jobs, eine gemeinsame Energie, die den Ertrag skaliert und unter 10 % blockt, und eine Überstunde für Angestellte.

**Architecture:** Das Energie-Modell (Kostenkurve, Erholung, Faktor, Wand) wird ein eigenes, reines Modul `src/energy.js` ohne DB-Zugriff. `src/creator.js` bleibt Besitzer des Zustands (`creator_state`) und bietet `previewTime`/`useTime`/`energyOf`/`budget` an; Musik, Firma und Jobs gehen über diese Schnittstelle. Der Faktor wird an jeder Ertragsstelle nach der Buchung geholt und auf die Wirkung der Aktion multipliziert.

**Tech Stack:** Node.js, better-sqlite3 (synchron), discord.js-Builder für Ansichten, eigene Test-Skripte (`node test/<x>.test.js`, Zähler ✅/❌), Messskript `scripts/messung-geldquellen.js`.

## Global Constraints

- Spec: `docs/superpowers/specs/2026-09-14-zeit-energie-design.md` – die Tabellen dort sind die Prüfpunkte.
- ARCHITEKTUR.md: §3 kein Gelddrucker (Faktor ≤ 1), §7 synchrone Schreibvorgänge vor dem ersten `await`, §8 spät gebundene `require` in Funktionen, §9 eine Buchung je Aktion, §12 Tests ohne Netz.
- Tests laufen so: `rm -rf .testdata && DATA_DIR=.testdata node test/<x>.test.js`; volle Suite: `npm test 2>&1 | grep -c '❌'` muss `0` liefern.
- Commit-Trailer wörtlich: `Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>`.
- Konstanten-Startwerte (Spec): `HOUR_COST_BASE 1.4`, `HOUR_COST_SLOPE 0.25`, `RECOVERY_PER_HOUR 4`, `MALUS_MAX 0.8`, `ENERGY_WALL 0.10`, `FATIGUE_MAX 100`, `TIME_PER_DAY 24`, `OVERTIME_SHIFTS 1`, `OVERTIME_PAY 1.25`, `OVERTIME_FATIGUE 2`.
- Alle Texte auf Deutsch, Stil wie die bestehenden (Emoji vorn, `**fett**` für Zahlen, `_kursiv_` für Nebensätze).
- Kein `unb`-Netzaufruf in Tests: `unb.changeCash`/`unb.getBalance` werden gefälscht, und zwar **vor** dem ersten `require` eines Moduls, das `changeCash` beim Laden destrukturiert (`src/jobs.js:4`).

---

### Task 1: `src/energy.js` – das reine Modell

**Files:**
- Create: `src/energy.js`
- Create: `test/energy.test.js`
- Modify: `package.json` (Testliste)

**Interfaces:**
- Produces:
  - `costOf(used, hours, fatigueFactor = 1) → number` – Erschöpfungspunkte für `hours` Stunden ab `used` verbrauchten Stunden.
  - `recover(fatigue, fatigueAt, now) → number` – Erschöpfung nach linearer Erholung (`RECOVERY_PER_HOUR` je Echtzeit-Stunde), geklemmt auf 0…100.
  - `energyOf(fatigue) → number` (0…1), `factorOf(energy) → number` (0,2…1), `exhausted(fatigue) → boolean`, `readyAt(fatigue, fatigueAt) → number|null` (ms-Zeitstempel, ab dem die Wand fällt; `null`, wenn nicht erschöpft).
  - `blockText(res, now = Date.now()) → string` – „🔋 Du bist erschöpft. Wieder in **1 h 2 min**." aus `res.readyAt`.
  - Konstanten `HOUR_COST_BASE, HOUR_COST_SLOPE, RECOVERY_PER_HOUR, MALUS_MAX, ENERGY_WALL, FATIGUE_MAX`.

- [ ] **Step 1: Test schreiben (Handrechnung aus der Spec)**

```js
// test/energy.test.js
/**
 * Zeit und Energie: Kostenkurve, Erholung, Faktor, Wand – Handrechnung aus
 * docs/superpowers/specs/2026-09-14-zeit-energie-design.md.
 * Aufruf: DATA_DIR=.testdata node test/energy.test.js
 */
const unb = require('../src/unb');
// Gefälschte Bank VOR allen anderen Modulen (jobs.js destrukturiert changeCash beim Laden).
const konten = new Map();
let bookings = [];
unb.getBalance = async (g, u) => ({ cash: konten.get(u) ?? 0, bank: 0, total: konten.get(u) ?? 0 });
unb.changeCash = async (g, u, amount, reason, opts = {}) => {
  konten.set(u, (konten.get(u) ?? 0) + amount);
  bookings.push({ user: u, amount, reason, opts });
  return { cash: konten.get(u), bank: 0, total: konten.get(u) };
};
unb.withdrawFromBank = async () => ({ cash: 0, bank: 0, total: 0 });

const energy = require('../src/energy');

let pass = 0, fail = 0;
const check = (label, ok, extra = '') => {
  if (ok) { pass++; console.log(`  ✅ ${label}`); }
  else { fail++; console.log(`  ❌ ${label} ${extra}`); }
};
const near = (a, b, eps = 1e-9) => Math.abs(a - b) < eps;
const H = 60 * 60 * 1000;

(async () => {
  console.log('--- Kostenkurve (Stunde n kostet 1,4 + 0,25 × n) ---');
  {
    check('8 h ab 0 kosten 20,2', near(energy.costOf(0, 8), 20.2), String(energy.costOf(0, 8)));
    check('Stunden 9–10 kosten 7,55', near(energy.costOf(8, 2), 7.55), String(energy.costOf(8, 2)));
    check('… als Überstunde doppelt: 15,1', near(energy.costOf(8, 2, 2), 15.1));
    check('12 h kosten 36,3', near(energy.costOf(0, 12), 36.3));
    check('16 h kosten 56,4', near(energy.costOf(0, 16), 56.4));
    check('21 h kosten 87,15', near(energy.costOf(0, 21), 87.15));
    check('22 h kosten 94,05', near(energy.costOf(0, 22), 94.05));
    check('Stückweise = am Stück (8 + 2 = 10)', near(energy.costOf(0, 8) + energy.costOf(8, 2), energy.costOf(0, 10)));
    check('0 Stunden kosten nichts', energy.costOf(5, 0) === 0);
  }

  console.log('--- Energie und Wand ---');
  {
    check('8-h-Tag endet bei 79,8 %', near(energy.energyOf(energy.costOf(0, 8)), 0.798));
    check('10 h mit Überstunde bei 64,7 % (≥ 60 %)',
      near(energy.energyOf(energy.costOf(0, 8) + energy.costOf(8, 2, 2)), 0.647));
    check('21 h: noch über der Wand', !energy.exhausted(energy.costOf(0, 21)));
    check('22 h: an der Wand', energy.exhausted(energy.costOf(0, 22)));
    check('genau 90 Punkte sind noch nicht erschöpft (Wand ist „unter 10 %")', !energy.exhausted(90));
    check('readyAt: 94,05 Punkte → 1,0125 h nach fatigue_at',
      near(energy.readyAt(94.05, 1_000), 1_000 + (4.05 / 4) * H, 1), String(energy.readyAt(94.05, 1_000)));
    check('readyAt ohne Erschöpfung null', energy.readyAt(50, 1_000) === null);
  }

  console.log('--- Erholung (4 Punkte je Echtzeit-Stunde) ---');
  {
    const t = 1_000_000;
    check('Marathon (94,05) nach 8 h bei 62,05 → 37,95 % Energie',
      near(energy.energyOf(energy.recover(94.05, t, t + 8 * H)), 0.3795));
    check('nach 16 h bei 69,95 %', near(energy.energyOf(energy.recover(94.05, t, t + 16 * H)), 0.6995));
    check('nach 24 h voll (klemmt bei 0)', energy.recover(94.05, t, t + 24 * H) === 0);
    check('8-h-Tag (20,2) nach 5 h 3 min voll', energy.recover(20.2, t, t + 5.05 * H) < 1e-9);
    check('ohne fatigue_at keine Erholung, aber auch kein Fehler', energy.recover(30, 0, t) === 30);
    check('Zeit rückwärts erholt nicht', energy.recover(30, t, t - H) === 30);
  }

  console.log('--- Faktor: 1 − 0,8 × (1 − Energie)² ---');
  {
    check('100 % → 1,00', energy.factorOf(1) === 1);
    check('75 % → 0,95', near(energy.factorOf(0.75), 0.95));
    check('50 % → 0,80', near(energy.factorOf(0.5), 0.8));
    check('25 % → 0,55', near(energy.factorOf(0.25), 0.55));
    check('10 % → 0,352', near(energy.factorOf(0.1), 0.352));
    check('0 % → 0,20 (nie unter 0,2)', near(energy.factorOf(0), 0.2));
    check('über 1 wird geklemmt', energy.factorOf(1.5) === 1);
  }

  console.log('--- Sperrtext ---');
  {
    const now = 5_000_000;
    const text = energy.blockText({ reason: 'exhausted', readyAt: now + 62 * 60 * 1000 }, now);
    check('nennt die Restzeit', text.includes('erschöpft') && text.includes('1 h 2 min'), text);
    const past = energy.blockText({ reason: 'exhausted', readyAt: now - 1 }, now);
    check('abgelaufen → „jetzt"', past.includes('jetzt'), past);
  }

  console.log(`\n${pass} bestanden, ${fail} fehlgeschlagen`);
  process.exit(fail === 0 ? 0 : 1);
})();
```

- [ ] **Step 2: Test laufen lassen – muss fehlschlagen**

Run: `rm -rf .testdata && DATA_DIR=.testdata node test/energy.test.js`
Expected: `Error: Cannot find module '../src/energy'`

- [ ] **Step 3: Modul schreiben**

```js
// src/energy.js
/**
 * Energie – die eine Bremse für alle Arbeit (Creator, Musik, Firma, Jobs).
 *
 * Reines Modell, kein Zustand: Wer die Erschöpfung eines Spielers kennt
 * (`creator_state.fatigue`, `fatigue_at`), kann hier ausrechnen, was der
 * Tag kostet, wie viel über Nacht zurückkommt und was von der Wirkung einer
 * Aktion übrig bleibt. Den Zustand hält src/creator.js (useTime, energyOf).
 *
 * Warum konvex: Die n-te Stunde des Tages kostet mehr als die erste. Nur so
 * gilt beides zugleich – ein 8-h-Tag lässt die Energie kaum sinken (79,8 %),
 * und bei ~21 Stunden am Stück steht man an der Wand. Ein linearer Preis
 * kann nur eins von beidem (siehe Spec 2026-09-14, Tabelle).
 */

const HOUR_COST_BASE = 1.4;     // Punkte für die erste Stunde …
const HOUR_COST_SLOPE = 0.25;   // … plus so viel je weiterer Stunde des Tages
const RECOVERY_PER_HOUR = 4;    // Punkte je Echtzeit-Stunde ohne Aktion
const MALUS_MAX = 0.8;          // bei 0 % Energie bleibt ein Fünftel der Wirkung
const ENERGY_WALL = 0.10;       // darunter geht nichts mehr, was Zeit kostet
const FATIGUE_MAX = 100;

const H_MS = 60 * 60 * 1000;
const clamp = (lo, hi, v) => Math.max(lo, Math.min(hi, v));

/**
 * Erschöpfungspunkte für `hours` Stunden, wenn heute schon `used` Stunden
 * verbraucht sind: Summe über n = used+1 … used+hours von BASE + SLOPE × n.
 * `fatigueFactor` ist der Überstunden-Aufschlag (2 = doppelt so müde).
 */
function costOf(used, hours, fatigueFactor = 1) {
  if (hours <= 0) return 0;
  const sum = hours * HOUR_COST_BASE
    + HOUR_COST_SLOPE * (hours * used + (hours * (hours + 1)) / 2);
  return sum * fatigueFactor;
}

/** Erschöpfung nach linearer Erholung seit `fatigueAt` (0 = ausgeruht). */
function recover(fatigue, fatigueAt, now) {
  if (!fatigue || !fatigueAt || now <= fatigueAt) return fatigue || 0;
  const hours = (now - fatigueAt) / H_MS;
  return clamp(0, FATIGUE_MAX, fatigue - hours * RECOVERY_PER_HOUR);
}

/** Energie 0…1 aus der Erschöpfung. */
function energyOf(fatigue) {
  return clamp(0, 1, 1 - (fatigue || 0) / FATIGUE_MAX);
}

/** Was von der Wirkung einer Aktion bleibt: flach oben, steil unten. */
function factorOf(energy) {
  const e = clamp(0, 1, energy);
  return 1 - MALUS_MAX * (1 - e) ** 2;
}

/**
 * Unter der Wand? „Unter 10 %" – genau 10 % ist noch erlaubt. Verglichen wird
 * in Punkten (> 90), nicht in Energie: 1 − 0,9 ist in JS 0,0999…, und damit
 * stünde jemand mit genau 90 Punkten fälschlich an der Wand.
 */
function exhausted(fatigue) {
  return (fatigue || 0) > FATIGUE_MAX * (1 - ENERGY_WALL);
}

/** Zeitpunkt, ab dem die Wand fällt – null, wenn nicht erschöpft. */
function readyAt(fatigue, fatigueAt) {
  if (!exhausted(fatigue)) return null;
  const wallFatigue = FATIGUE_MAX * (1 - ENERGY_WALL);       // 90
  return fatigueAt + ((fatigue - wallFatigue) / RECOVERY_PER_HOUR) * H_MS;
}

/** Ein Text für alle Wege (Menü, Slash, Fluxer). */
function blockText(res, now = Date.now()) {
  const ms = (res.readyAt ?? now) - now;
  const wann = ms > 0
    ? `in **${require('./income').formatRemaining(ms)}**` : '**jetzt**';
  return `🔋 Du bist erschöpft. Wieder ${wann}.`;
}

module.exports = {
  HOUR_COST_BASE, HOUR_COST_SLOPE, RECOVERY_PER_HOUR, MALUS_MAX, ENERGY_WALL, FATIGUE_MAX,
  costOf, recover, energyOf, factorOf, exhausted, readyAt, blockText,
};
```

- [ ] **Step 4: Test laufen lassen – muss bestehen**

Run: `rm -rf .testdata && DATA_DIR=.testdata node test/energy.test.js`
Expected: `… bestanden, 0 fehlgeschlagen` (26 Prüfungen)

- [ ] **Step 5: Test in `package.json` eintragen**

In `"test"` nach `node test/creator.test.js` einfügen: ` && node test/energy.test.js`.

- [ ] **Step 6: Commit**

```bash
git add src/energy.js test/energy.test.js package.json
git commit -m "energie: reines modell – konvexe kosten, lineare erholung, faktor, wand

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 2: `src/creator.js` – 24 Stunden, `previewTime`/`useTime`/`energyOf`, Faktor nach der Buchung

**Files:**
- Modify: `src/creator.js:45-46` (TIME_PER_DAY), `:160-168` (FATIGUE-Konstanten), `:352-357` (budget), `:396-405` (fatigueNow/energyFactor), `:806-830` und `:870-946` (act), `:958-978` (useTime), `:982-1045` (status), `:1156-1170` (exports)
- Modify: `src/buttons.js:2392-2394` (Müde-Hinweis nutzt `res.factor`)
- Modify: `src/decisions.js:314-320` (nur Konstante – bleibt, prüfen)
- Modify: `test/creator.test.js:477-478, 589-623`
- Test: `test/energy.test.js` (neuer Block „Zeit und Zustand")

**Interfaces:**
- Consumes: `energy.costOf/recover/energyOf/factorOf/exhausted/readyAt` (Task 1).
- Produces (alle in `src/creator.js`, exportiert):
  - `TIME_PER_DAY = 24`
  - `previewTime(guildId, userId, cost, now = Date.now(), { fatigueFactor = 1 } = {})` → `{ ok: true, used, left, max, resetMs, fatigue, energy, factor }` | `{ ok: false, reason: 'exhausted', readyAt, energy, used, left, max, resetMs }` | `{ ok: false, reason: 'no_time', used, left, max, resetMs, energy }`. `fatigue/energy/factor` sind die Werte **nach** der (noch nicht geschriebenen) Buchung. Schreibt nichts.
  - `useTime(guildId, userId, cost, now = Date.now(), { fatigueFactor = 1 } = {})` → dieselben Formen; bei `ok` ist der Zustand geschrieben (`day`, `time_used`, `fatigue`, `fatigue_at`).
  - `energyOf(guildId, userId, now = Date.now())` → `{ fatigue, energy, factor, readyAt }` (aktuell, nach Erholung).
  - `budget(guildId, userId, now)` → `{ used, max, left, energy, factor, readyAt }`.
  - `fatigueNow(state, now)` → `energy.recover(state.fatigue, state.fatigue_at, now)` (Signatur bleibt; `decisions.js` nutzt sie).
  - `energyFactor(fatigue)` → `energy.factorOf(energy.energyOf(fatigue))` (Signatur bleibt).
  - `act(...)` Ergebnis: `energy` ist jetzt die **Energie** (0…1), neu `factor`; `tired = factor < 0.95`; neuer Ablehnungsgrund `exhausted` mit `readyAt`.
  - `status(...)`: `energy` (0…1), neu `factor`, `readyAt`.
  - Exporte `FATIGUE_PER_TIME, FATIGUE_MALUS, FATIGUE_RECOVERY` entfallen; `FATIGUE_MAX` bleibt (= `energy.FATIGUE_MAX`).

- [ ] **Step 1: Tests schreiben – Block in `test/energy.test.js` vor der Schlusszeile**

```js
  console.log('--- Zeit und Zustand (creator.previewTime / useTime / energyOf) ---');
  {
    const db = require('../src/db');
    const creator = require('../src/creator');
    const G = `ENERGIE_T${Date.now()}`;
    const U = 'u1';
    const t0 = new Date(new Date().setHours(6, 0, 0, 0)).getTime() + 24 * H;

    check('der Tag hat 24 Stunden', creator.TIME_PER_DAY === 24);
    let b = creator.budget(G, U, t0);
    check('frisch: 0 von 24, Energie 100 %, Faktor 1',
      b.used === 0 && b.max === 24 && b.left === 24 && b.energy === 1 && b.factor === 1 && b.readyAt === null,
      JSON.stringify(b));

    // Vorschau schreibt nichts.
    let p = creator.previewTime(G, U, 8, t0);
    check('Vorschau 8 h: ok, Energie danach 79,8 %', p.ok && near(p.energy, 0.798) && near(p.factor, energy.factorOf(0.798)), JSON.stringify(p));
    check('… und hat nichts geschrieben', creator.budget(G, U, t0).used === 0);

    // Buchen: 8 h am Stück.
    let r = creator.useTime(G, U, 8, t0);
    check('8 h gebucht: 16 übrig, Energie 79,8 %', r.ok && r.used === 8 && r.left === 16 && near(r.energy, 0.798), JSON.stringify(r));
    check('energyOf liest denselben Stand', near(creator.energyOf(G, U, t0).energy, 0.798));

    // Überstunde: 2 h mit doppelter Müdigkeit → 64,7 %.
    r = creator.useTime(G, U, 2, t0, { fatigueFactor: 2 });
    check('2 h doppelt müde: 64,7 %', r.ok && near(r.energy, 0.647), JSON.stringify(r));

    // Erholung wirkt in Echtzeit: 1 h später 4 Punkte weniger.
    check('eine Stunde später +4 Punkte', near(creator.energyOf(G, U, t0 + H).energy, 0.687));

    // Bis zur Wand: weitere 12 h (insgesamt 22) am selben Zeitpunkt t0.
    r = creator.useTime(G, U, 12, t0);
    check('22 h gebucht, jetzt unter der Wand', r.ok && r.used === 22 && r.energy < 0.1, JSON.stringify(r));
    r = creator.useTime(G, U, 1, t0);
    check('nächste Aktion: exhausted mit readyAt', r.ok === false && r.reason === 'exhausted' && r.readyAt > t0, JSON.stringify(r));
    check('… und die Stunden bleiben bei 22', creator.budget(G, U, t0).used === 22);
    const ready = creator.energyOf(G, U, t0).readyAt;
    r = creator.useTime(G, U, 1, ready + 1);
    check('ab readyAt geht es wieder (23. Stunde)', r.ok && r.used === 23, JSON.stringify(r));
    r = creator.useTime(G, U, 2, ready + 1);
    check('mehr als 24: no_time', r.ok === false && r.reason === 'no_time' && r.left === 1, JSON.stringify(r));

    // Neuer Tag: Stunden auf 0, Erschöpfung erholt sich nur mit der Zeit.
    // Stand nach der 23. Stunde (bei ready+1 = t0 + 2,5 h): 90 + costOf(22, 1) = 90 + 7,15 = 97,15;
    // bis t0 + 24 h vergehen 21,5 h × 4 = 86 Punkte → 11,15 → 88,85 %.
    b = creator.budget(G, U, t0 + 24 * H);
    check('nächster Tag: 0 von 24, Energie bei ~88,9 %', b.used === 0 && near(b.energy, 0.8885, 1e-3), JSON.stringify(b));

    // Marathon-Prüfpunkt: Wand um Mitternacht, 8 Uhr ~38 %.
    const V = 'u2';
    const mitternacht = new Date(new Date(t0).setHours(24, 0, 0, 0)).getTime();
    creator.useTime(G, V, 22, mitternacht - 1);
    const morgen = creator.energyOf(G, V, mitternacht - 1 + 8 * H);
    check('Marathon: um 8 Uhr 35–45 % Energie', morgen.energy > 0.35 && morgen.energy < 0.45, String(morgen.energy));
  }
```

- [ ] **Step 2: Test laufen lassen – muss fehlschlagen**

Run: `rm -rf .testdata && DATA_DIR=.testdata node test/energy.test.js`
Expected: mehrere ❌, u. a. „der Tag hat 24 Stunden" und `creator.previewTime is not a function`.

- [ ] **Step 3: `src/creator.js` umbauen**

Konstanten (`:45-46` und `:160-168`) ersetzen:

```js
/** Zeitbudget pro Tag – 24 Stunden für alles: Kanäle, Musik, Firma und Jobs (siehe src/energy.js). */
const TIME_PER_DAY = 24;
```

```js
/**
 * Erschöpfung: Zustand liegt hier (creator_state.fatigue, fatigue_at), das
 * Modell in src/energy.js. Eine Energie für alle – wer nachts noch streamt,
 * ist morgens im Job müde, und umgekehrt.
 */
const energyModel = require('./energy');
const FATIGUE_MAX = energyModel.FATIGUE_MAX;
```

`fatigueNow`/`energyFactor` (`:396-405`) ersetzen:

```js
/** Erschöpfung, nachdem sie seit der letzten Aktion abgeklungen ist (linear, Echtzeit). */
function fatigueNow(state, now) {
  return energyModel.recover(state.fatigue || 0, state.fatigue_at || 0, now);
}

/** Was die Erschöpfung von der Wirkung übrig lässt (1 = ausgeruht). */
function energyFactor(fatigue) {
  return energyModel.factorOf(energyModel.energyOf(fatigue));
}
```

`budget` (`:352-357`) ersetzen und `previewTime`/`energyOf` daneben; `useTime` (`:958-978`) ersetzen:

```js
/** Energie eines Spielers jetzt – nach Erholung, ohne zu schreiben. */
function energyOf(guildId, userId, now = Date.now()) {
  const state = db.getCreatorState(guildId, userId, now);
  const fatigue = fatigueNow(state, now);
  const energy = energyModel.energyOf(fatigue);
  return { fatigue, energy, factor: energyModel.factorOf(energy),
    readyAt: energyModel.readyAt(fatigue, state.fatigue_at || now) };
}

/** Zeitbudget des Tages samt Energie. */
function budget(guildId, userId, now = Date.now()) {
  const state = db.getCreatorState(guildId, userId, now);
  const day = today(new Date(now));
  const used = state.day === day ? state.time_used : 0;
  const e = energyOf(guildId, userId, now);
  return { used, max: TIME_PER_DAY, left: Math.max(0, TIME_PER_DAY - used),
    energy: e.energy, factor: e.factor, readyAt: e.readyAt };
}

/**
 * Rechnet eine Buchung vor, ohne zu schreiben: Wand (Energie unter 10 % VOR
 * der Aktion), dann Stunden. Liefert bei `ok` Erschöpfung, Energie und
 * Faktor NACH der Aktion – die letzte Stunde eines langen Tags ist die müdeste.
 */
function previewTime(guildId, userId, cost, now = Date.now(), { fatigueFactor = 1 } = {}) {
  const state = db.getCreatorState(guildId, userId, now);
  const day = today(new Date(now));
  const used = state.day === day ? state.time_used : 0;
  const resetMs = new Date(new Date(now).setHours(24, 0, 0, 0)).getTime() - now;
  const before = fatigueNow(state, now);
  const base = { used, left: TIME_PER_DAY - used, max: TIME_PER_DAY, resetMs };

  if (energyModel.exhausted(before)) {
    return { ok: false, reason: 'exhausted', ...base,
      energy: energyModel.energyOf(before),
      readyAt: energyModel.readyAt(before, state.fatigue_at || now) };
  }
  if (used + cost > TIME_PER_DAY) {
    return { ok: false, reason: 'no_time', ...base, energy: energyModel.energyOf(before) };
  }
  const fatigue = clamp(0, FATIGUE_MAX, before + energyModel.costOf(used, cost, fatigueFactor));
  const energy = energyModel.energyOf(fatigue);
  return { ok: true, used: used + cost, left: TIME_PER_DAY - used - cost, max: TIME_PER_DAY, resetMs,
    fatigue, energy, factor: energyModel.factorOf(energy), state, day };
}

/**
 * Bucht Zeit aus dem gemeinsamen Tagesbudget ab.
 *
 * Musik, Firma und Jobs teilen sich denselben Tag: Wer vormittags im Studio
 * war, kann abends nicht mehr vier Stunden streamen. Synchron (§7).
 */
function useTime(guildId, userId, cost, now = Date.now(), opts = {}) {
  const p = previewTime(guildId, userId, cost, now, opts);
  if (!p.ok) return p;
  const { state, day, ...out } = p;
  db.saveCreatorState(guildId, userId, {
    ...state, day, time_used: out.used, fatigue: out.fatigue, fatigue_at: now,
    merch_at: state.merch_at || now,
  });
  return out;
}
```

`act` (`:806-830`): den Block `const state = …` bis `const energy = energyFactor(fatigue);` so umbauen, dass Wand und Zeit über `previewTime` laufen und der Faktor **nach** der Buchung gilt:

```js
  const time = previewTime(guildId, userId, p.time, now);
  if (!time.ok) return { ok: false, ...time, platform: p, need: p.time };
  const { state, day, used: usedAfter } = time;
  const used = usedAfter - p.time;
```

und weiter unten (wo bisher `community`, `boost`, `fatigue`, `energy` berechnet werden):

```js
  const community = communityNow(state, now);
  const boost = activeBoost(state, now);
  const fatigue = time.fatigue;          // nach dieser Aktion
  const energy = time.factor;            // in simulate heißt der Faktor weiterhin `energy`
```

Im `db.saveCreatorState`-Aufruf (`:870-882`): `time_used: usedAfter`, `fatigue: fatigue` (ohne erneute Addition). Im Rückgabeobjekt (`:941-945`):

```js
    fatigue,
    energy: time.energy, factor: time.factor, tired: time.factor < 0.95,
    …
    timeUsed: usedAfter, timeMax: TIME_PER_DAY,
```

`status` (`:1040-1041`): `energy: energyModel.energyOf(fatigue), factor: energyFactor(fatigue), readyAt: energyModel.readyAt(fatigue, state.fatigue_at || now),`.

Exporte: `FATIGUE_MAX` behalten, `FATIGUE_PER_TIME, FATIGUE_MALUS, FATIGUE_RECOVERY` streichen, `previewTime, energyOf` ergänzen.

`src/buttons.js:2392-2394`:

```js
      if (res.tired) {
        note += `\n🔋 Du wirkst müde: **${Math.round(res.energy * 100)} %** Energie, ` +
          `Wirkung ×${res.factor.toFixed(2)}. Eine Pause hilft.`;
      }
```

- [ ] **Step 4: `test/creator.test.js` anpassen**

`:477-478` bleibt gültig (nutzt `creator.TIME_PER_DAY`) – prüfen, dass die Schleife dort genug Aktionen macht, um 24 zu füllen; wenn sie mit Cooldowns nicht über 24 kommt, den Test auf `spent <= creator.TIME_PER_DAY && blocked !== null` mit Cooldown-freien Zeitstempeln umstellen. Burnout-Block `:589-600` ersetzen:

```js
    check('ausgeruht gibt es keinen Malus', creator.energyFactor(0) === 1);
    check('der Malus ist gedeckelt (0,2 bleibt)', Math.abs(creator.energyFactor(creator.FATIGUE_MAX) - 0.2) < 1e-9);
    check('Erschöpfung klingt in Pausen ab',
      creator.fatigueNow({ fatigue: 100, fatigue_at: 1 }, 1 + DAY_MS) < 100,
      String(creator.fatigueNow({ fatigue: 100, fatigue_at: 1 }, 1 + DAY_MS)));
    check('ein normaler Tag merkt fast nichts (75 % → 0,95)',
      Math.abs(creator.energyFactor(25) - 0.95) < 1e-9, String(creator.energyFactor(25)));
```

`:607-608`: `fresh.ok && fresh.factor > 0.99` („die erste Aktion des Tages läuft mit fast voller Energie"). `:616-622` bleibt (Energie < 1, drei Tage später höher).

- [ ] **Step 5: Tests laufen lassen**

Run: `rm -rf .testdata && DATA_DIR=.testdata node test/energy.test.js && DATA_DIR=.testdata node test/creator.test.js && DATA_DIR=.testdata node test/decisions.test.js`
Expected: alle drei `0 fehlgeschlagen`.

- [ ] **Step 6: Commit**

```bash
git add src/creator.js src/buttons.js test/creator.test.js test/energy.test.js
git commit -m "energie: 24-stunden-tag, previewTime/useTime mit wand, faktor nach der buchung

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 3: Jobs buchen Zeit, Überstunde, Faktor auf den Lohn

**Files:**
- Modify: `src/jobs.js:16-21` (Konstanten), `:191-290` (work), `:305-316` (shiftBudget), Exporte
- Modify: `src/company.js:346-362` (workShift bekommt `{ factor, overtime }`)
- Modify: `test/shifts.test.js:28-31, 74-86`
- Test: `test/energy.test.js` (Block „Jobs")

**Interfaces:**
- Consumes: `creator.previewTime/useTime(…, { fatigueFactor })`, `company.workShift`.
- Produces:
  - `jobs.OVERTIME_SHIFTS = 1`, `jobs.OVERTIME_PAY = 1.25`, `jobs.OVERTIME_FATIGUE = 2`.
  - `jobs.shiftBudget(guildId, userId, now)` → `{ done, max, left, hours, maxHours, overtimeLeft, nextIsOvertime, maxAll }` (`max` bleibt 4 regulär, `maxAll = 5`).
  - `jobs.work(...)` Ergebnis zusätzlich `overtime: boolean, overtimeBonus: number, energy, factor`; Ablehnung `daily_limit` meldet `done, max: 5`; neue Ablehnungen `exhausted` (mit `readyAt`) und `no_time` (mit `left, max: 24`).
  - `company.workShift(guildId, userId, companyId, now, random, { factor = 1, overtime = false } = {})` → `{ ok, lohn, umsatz, overtimeBonus, … }` – `lohn = max(1, round(b.lohn × f × variance × factor))`, bei Überstunde `× OVERTIME_PAY` (Bonus = Differenz), `umsatz = round(b.umsatz × f × auslastung × PLAYER_BONUS × umsatzFactor × factor)`.

- [ ] **Step 1: Tests schreiben – Block in `test/energy.test.js`**

```js
  console.log('--- Jobs: Zeit, Überstunde, Faktor ---');
  {
    const db = require('../src/db');
    const creator = require('../src/creator');
    const jobs = require('../src/jobs');
    const JOBS = require('../src/data/jobs');
    const G = `ENERGIE_J${Date.now()}`;
    const U = 'j1';
    const easy = JOBS.find((j) => !(j.requires ?? []).length);
    db.setEmployment(G, U, easy.id);
    const t0 = new Date(new Date().setHours(6, 0, 0, 0)).getTime() + 24 * H;
    const at = (h) => new Date(t0 + h * H);

    check('Konstanten: 1 Überstunde, ×1,25, doppelt müde',
      jobs.OVERTIME_SHIFTS === 1 && jobs.OVERTIME_PAY === 1.25 && jobs.OVERTIME_FATIGUE === 2);

    // Vier reguläre Schichten, jede 2 h aus dem 24-h-Tag (Cooldown des Jobs beachten).
    const step = Math.max(2, Math.ceil(easy.cooldown / 60) + 0.01);
    let r;
    for (let i = 0; i < 4; i++) {
      r = await jobs.work(G, U, at(i * step));
      check(`Schicht ${i + 1} regulär`, r.ok && r.overtime === false && r.overtimeBonus === 0, JSON.stringify(r));
    }
    check('vier Schichten = 8 von 24 Stunden', creator.budget(G, U, at(3 * step)).used === 8);
    let b = jobs.shiftBudget(G, U, at(3 * step));
    check('shiftBudget: 4/4, nächste ist Überstunde', b.done === 4 && b.left === 0 && b.nextIsOvertime === true && b.overtimeLeft === 1, JSON.stringify(b));

    // Die fünfte Schicht ist die Überstunde: Lohn ×1,25 auf den Grundlohn, doppelte Müdigkeit.
    const vor = creator.energyOf(G, U, at(4 * step)).fatigue;
    r = await jobs.work(G, U, at(4 * step));
    check('5. Schicht = Überstunde', r.ok && r.overtime === true && r.overtimeBonus > 0, JSON.stringify(r));
    check('Bonus ist ein Viertel des Grundlohns (auf Taler gerundet)',
      Math.abs(r.overtimeBonus - Math.round((r.base - r.overtimeBonus) * 0.25)) <= 1, `${r.base} / ${r.overtimeBonus}`);
    const nach = creator.energyOf(G, U, at(4 * step)).fatigue;
    check('Überstunde macht doppelt müde: 2 × costOf(8, 2) = 15,1 (nach Erholung seit der 4. Schicht)',
      near(nach - vor, energy.costOf(8, 2, 2), 1e-6), `${nach - vor}`);
    check('10 von 24 Stunden', creator.budget(G, U, at(4 * step)).used === 10);

    r = await jobs.work(G, U, at(5 * step));
    check('6. Schicht: daily_limit mit 5 von 5', r.ok === false && r.reason === 'daily_limit' && r.done === 5 && r.max === 5, JSON.stringify(r));

    // Faktor auf den Lohn: bei 50 Punkten Erschöpfung (vor der Schicht) zahlt die Schicht weniger.
    const V = 'j2';
    db.setEmployment(G, V, easy.id);
    const s = db.getCreatorState(G, V, t0);
    db.saveCreatorState(G, V, { ...s, fatigue: 50, fatigue_at: t0 });
    const realRandom = Math.random; Math.random = () => 0.5;           // variance = 1,0
    r = await jobs.work(G, V, new Date(t0));
    Math.random = realRandom;
    // Nach der Schicht: 50 + costOf(0, 2) = 53,55 → Energie 0,4645 → Faktor 0,77059.
    const erwartet = Math.max(1, Math.round(easy.pay * 0.77059));
    check('Lohn bei 46 % Energie: Grundlohn × 0,7706', r.ok && Math.abs(r.base - erwartet) <= 1 && near(r.factor, 0.77059, 1e-4),
      `base ${r.base} erwartet ${erwartet} factor ${r.factor}`);

    // Wand: erschöpft → keine Schicht, keine Buchung.
    const W = 'j3';
    db.setEmployment(G, W, easy.id);
    const sw = db.getCreatorState(G, W, t0);
    db.saveCreatorState(G, W, { ...sw, fatigue: 95, fatigue_at: t0 });
    bookings = [];
    r = await jobs.work(G, W, new Date(t0));
    check('erschöpft: exhausted mit readyAt, nichts gebucht', r.ok === false && r.reason === 'exhausted' && r.readyAt > t0 && bookings.length === 0, JSON.stringify(r));
    check('… und die Schicht zählt nicht', db.shiftsToday(G, W, jobs.today(new Date(t0))) === 0);
  }
```

- [ ] **Step 2: Test laufen lassen – muss fehlschlagen**

Run: `rm -rf .testdata && DATA_DIR=.testdata node test/energy.test.js`
Expected: ❌ bei „Konstanten", „shiftBudget", „5. Schicht = Überstunde" (heute `daily_limit`).

- [ ] **Step 3: `src/jobs.js` umbauen**

Konstanten (`:16-21`):

```js
/**
 * Eine Schicht sind zwei Stunden aus dem gemeinsamen 24-h-Tag (creator.useTime).
 * Vier reguläre Schichten plus eine Überstunde: ×1,25 Lohn, doppelt müde.
 */
const HOURS_PER_SHIFT = 2;
const MAX_SHIFTS_PER_DAY = 4;
const OVERTIME_SHIFTS = 1;
const OVERTIME_PAY = 1.25;
const OVERTIME_FATIGUE = 2;
```

`work` (`:203-208`): Deckel auf `MAX_SHIFTS_PER_DAY + OVERTIME_SHIFTS`, `max` in der Ablehnung ebenso; nach der Cooldown-Prüfung (`:211-215`) einfügen:

```js
  const overtime = done >= MAX_SHIFTS_PER_DAY;
  const creator = require('./creator');
  const timeOpts = { fatigueFactor: overtime ? OVERTIME_FATIGUE : 1 };
  // Vorschau zuerst (Wand, Stunden) – gebucht wird erst, wenn die Schicht steht (§7: alles synchron bis dahin).
  const preview = creator.previewTime(guildId, userId, HOURS_PER_SHIFT, now.getTime(), timeOpts);
  if (!preview.ok) return { ok: false, ...preview, job };
```

Firmenstelle (`:217-236`): `company.workShift(guildId, userId, cid, now.getTime(), random, { factor: preview.factor, overtime })`; direkt nach dem erfolgreichen `workShift` und **vor** dem `await changeCash`: `const time = creator.useTime(guildId, userId, HOURS_PER_SHIFT, now.getTime(), timeOpts);`. Rückgabe ergänzen: `overtime, overtimeBonus: shift.overtimeBonus, energy: time.energy, factor: time.factor, maxShifts: MAX_SHIFTS_PER_DAY + OVERTIME_SHIFTS`.

Katalog-Job (`:239-253`): nach `checkRequirements` und vor dem `await changeCash`:

```js
  const time = creator.useTime(guildId, userId, HOURS_PER_SHIFT, now.getTime(), timeOpts);
  const variance = 0.85 + Math.random() * 0.3;
  const perk = require('./perks').perksOf(guildId, userId);
  const ranks = require('./ranks');
  const rank = ranks.rank(employment.rank ?? 0);
  // Müde arbeitet man langsamer (Faktor), die Überstunde zahlt einen Zuschlag auf den Grundlohn.
  const plain = Math.max(1, Math.round(job.pay * variance * time.factor));
  const base = overtime ? Math.round(plain * OVERTIME_PAY) : plain;
  const overtimeBonus = base - plain;
  const amount = Math.max(1, Math.round(base * perk.income * rank.pay));
```

Rückgabe (`:275-282`) ergänzen: `overtime, overtimeBonus, energy: time.energy, factor: time.factor, maxShifts: MAX_SHIFTS_PER_DAY + OVERTIME_SHIFTS`.

`shiftBudget` (`:305-316`):

```js
function shiftBudget(guildId, userId, now = new Date()) {
  const done = db.shiftsToday(guildId, userId, today(now));
  const maxAll = MAX_SHIFTS_PER_DAY + OVERTIME_SHIFTS;
  return {
    done,
    max: MAX_SHIFTS_PER_DAY, maxAll,
    left: Math.max(0, MAX_SHIFTS_PER_DAY - done),
    overtimeLeft: Math.max(0, maxAll - Math.max(done, MAX_SHIFTS_PER_DAY)),
    nextIsOvertime: done >= MAX_SHIFTS_PER_DAY && done < maxAll,
    hours: done * HOURS_PER_SHIFT,
    maxHours: MAX_SHIFTS_PER_DAY * HOURS_PER_SHIFT,
  };
}
```

Exporte: `OVERTIME_SHIFTS, OVERTIME_PAY, OVERTIME_FATIGUE` ergänzen.

`src/company.js:346-362` (`workShift`):

```js
function workShift(guildId, userId, companyId, now = Date.now(), random = Math.random,
  { factor = 1, overtime = false } = {}) {
  settle(companyId, now);
  const c = db.getCompany(companyId);
  if (!c || c.status !== 'open') return { ok: false, reason: 'closed' };
  const s = db.staffByUser(c.id, userId);
  if (!s) return { ok: false, reason: 'not_staff' };
  const b = branch(c.branch);
  const eff = effectiveOf(c, b);
  const f = rankOf(s.rank).factor;
  // Müde verkauft man weniger und arbeitet langsamer: Umsatz und Lohn × Faktor.
  const plain = Math.max(1, Math.round(b.lohn * f * (0.85 + random() * 0.3) * factor));
  const lohn = overtime ? Math.round(plain * require('./jobs').OVERTIME_PAY) : plain;
  const umsatz = Math.round(b.umsatz * f * c.auslastung * data.PLAYER_BONUS * eff.umsatzFactor * factor);
  if (c.kasse < lohn) return { ok: false, reason: 'kasse', lohn, kasse: c.kasse };

  db.saveCompany({ ...c, kasse: c.kasse - lohn + umsatz });
  db.saveStaff({ ...s, shifts: s.shifts + 1 });
  return { ok: true, lohn, umsatz, overtimeBonus: lohn - plain, company: c, branch: b, rank: rankOf(s.rank) };
}
```

- [ ] **Step 4: `test/shifts.test.js` anpassen**

`:30` ergänzen: `check('eine Überstunde, ×1,25, doppelt müde', jobs.OVERTIME_SHIFTS === 1 && jobs.OVERTIME_PAY === 1.25 && jobs.OVERTIME_FATIGUE === 2);`
`:76`: `check('entspricht 2 von 8 Stunden (+1 Überstunde offen)', budget.hours === 2 && budget.maxHours === 8 && budget.overtimeLeft === 1 && budget.nextIsOvertime === false);`
`:80-86`: fünf Schichten eintragen (`for (let i = 0; i < 5; i++)`), Labels „6. Schicht wird abgelehnt", „meldet 5 von 5" mit `blocked.done === 5 && blocked.max === 5`.

- [ ] **Step 5: Tests laufen lassen**

Run: `rm -rf .testdata && DATA_DIR=.testdata node test/energy.test.js && DATA_DIR=.testdata node test/shifts.test.js && DATA_DIR=.testdata node test/jobs.test.js && DATA_DIR=.testdata node test/company.test.js`
Expected: alle `0 fehlgeschlagen`. Falls `company.test.js` an `s.budget.max === 8` (`:364`) scheitert: auf `24` ändern – das gehört zu dieser Task.

- [ ] **Step 6: Commit**

```bash
git add src/jobs.js src/company.js test/shifts.test.js test/energy.test.js test/company.test.js
git commit -m "jobs: schichten buchen zeit aus dem 24-h-tag, ueberstunde x1,25, faktor auf den lohn

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 4: Faktor bei Anpacken, Studio, Release und Show; `exhausted` durchreichen

**Files:**
- Modify: `src/company.js:398-412` (pitchIn), `:383-396` (advertise – nur Kommentar)
- Modify: `src/music.js:391-430` (record), `:482-520` (publish), `:573-640` (show)
- Test: `test/energy.test.js` (Block „Wirkung"), `test/company.test.js`, `test/music.test.js` (nur wenn etwas bricht)

**Interfaces:**
- Consumes: `creator.useTime` liefert `factor`; Ablehnung `{ ok:false, reason:'exhausted', readyAt }`.
- Produces: `pitchIn` → `{ ok, umsatz, done, max, time, factor }`; `record` → `{ …, quality, factor }` (quality bereits × factor); `publish` → `{ …, factor }`; `show` → `{ …, quality, factor }`. Alle vier geben bei Erschöpfung `{ ok: false, reason: 'exhausted', readyAt, need, … }` zurück – die bestehende Form `{ ok: false, reason: 'no_time', need, ...time }` reicht dafür schon, weil `...time` zuletzt steht und `reason` überschreibt. **Trotzdem explizit machen**: `reason: time.reason` schreiben, damit es niemand „repariert".

- [ ] **Step 1: Tests schreiben – Block in `test/energy.test.js`**

```js
  console.log('--- Wirkung: Anpacken, Studio, Release, Show ---');
  {
    const db = require('../src/db');
    const company = require('../src/company');
    const music = require('../src/music');
    const G = `ENERGIE_W${Date.now()}`;
    const U = 'w1';
    const t0 = new Date(new Date().setHours(6, 0, 0, 0)).getTime() + 24 * H;
    konten.set(U, 1_000_000);

    // Kiosk, Auslastung 0,3, kein Ausbau: Anpacken = round(250 × 1,5 × 0,3 × factor).
    let r = await company.found(G, U, 'kiosk', 'Müde Ecke', t0);
    check('Kiosk gegründet', r.ok, JSON.stringify(r));
    const s0 = db.getCreatorState(G, U, t0);
    db.saveCreatorState(G, U, { ...s0, fatigue: 50, fatigue_at: t0 });
    r = await company.pitchIn(G, U, t0);
    // 50 + costOf(0, 2) = 53,55 → Energie 0,4645 → Faktor 0,77059 → 112,5 × 0,77059 = 86,69 → 87
    check('Anpacken bei 46 % Energie: 87 statt 113', r.ok && r.umsatz === 87 && near(r.factor, 0.77059, 1e-4), JSON.stringify(r));

    // Wand bei Anpacken und Werbung.
    db.saveCreatorState(G, U, { ...db.getCreatorState(G, U, t0), fatigue: 95, fatigue_at: t0 });
    r = await company.pitchIn(G, U, t0);
    check('Anpacken erschöpft: exhausted + readyAt', r.ok === false && r.reason === 'exhausted' && r.readyAt > t0, JSON.stringify(r));
    await company.deposit(G, U, 50_000, t0);          // Werbung prüft die Kasse vor der Zeit
    r = await company.advertise(G, U, t0);
    check('Werbung erschöpft: exhausted', r.ok === false && r.reason === 'exhausted', JSON.stringify(r));
    await company.close(G, U, t0);

    // Musik: Studio-Qualität × Faktor. Mit festem Würfel 0,5 wäre quality 1,05.
    const M = 'w2';
    konten.set(M, 1_000_000);
    const setup = db.createItem({ guildId: G, name: music.GEAR, price: 1, kind: 'gear', stock: null, createdBy: 't' });
    db.reservePurchase(G, M, setup.id, 1);
    music.setup(G, M, 'pop', music.PERSONAS[0].id);
    db.saveCreatorState(G, M, { ...db.getCreatorState(G, M, t0), fatigue: 50, fatigue_at: t0 });
    r = music.record(G, M, t0, () => 0.5, { events: false });
    // 50 + costOf(0, 3) = 50 + 4,2 + 0,25 × 6 = 55,7 → Energie 0,443 → Faktor 1 − 0,8 × 0,557² = 0,75180
    check('Aufnahme bei 44 % Energie: quality 1,05 × 0,7518', r.ok && near(r.quality, 1.05 * 0.75180, 1e-4) && near(r.factor, 0.75180, 1e-4), JSON.stringify(r));

    // Release: audience × Faktor. Vergleich frisch gegen müde mit demselben Würfel.
    const F = 'w3';
    konten.set(F, 1_000_000);
    db.reservePurchase(G, F, setup.id, 1);
    music.setup(G, F, 'pop', music.PERSONAS[0].id);
    music.record(G, F, t0, () => 0.5, { events: false });
    const frisch = music.publish(G, F, 'single', t0 + 21 * H, () => 0.5, { events: false });
    // M ist bis dahin erholt – für den Vergleich wieder auf 50 Punkte setzen.
    db.saveCreatorState(G, M, { ...db.getCreatorState(G, M, t0 + 21 * H), fatigue: 50, fatigue_at: t0 + 21 * H });
    const muede = music.publish(G, M, 'single', t0 + 21 * H, () => 0.5, { events: false });
    check('Release frisch ok und müde ok', frisch.ok && muede.ok, JSON.stringify({ frisch: frisch.reason, muede: muede.reason }));
    check('müdes Release erreicht weniger Publikum (Faktor < 1)',
      muede.ok && frisch.ok && muede.audience < frisch.audience && muede.factor < 1 && frisch.factor > 0.95,
      `${muede.audience} < ${frisch.audience}`);

    // Wand im Studio.
    db.saveCreatorState(G, M, { ...db.getCreatorState(G, M, t0), fatigue: 95, fatigue_at: t0 + 22 * H });
    r = music.record(G, M, t0 + 22 * H, () => 0.5, { events: false });
    check('Studio erschöpft: exhausted', r.ok === false && r.reason === 'exhausted' && r.readyAt > t0 + 22 * H, JSON.stringify(r));
  }
```

- [ ] **Step 2: Test laufen lassen – muss fehlschlagen**

Run: `rm -rf .testdata && DATA_DIR=.testdata node test/energy.test.js`
Expected: ❌ „Anpacken bei 46 % Energie" (113 statt 87), ❌ „Aufnahme bei 44 % Energie" (`factor` undefined).

- [ ] **Step 3: `src/company.js` – pitchIn und advertise**

`pitchIn` (`:405-411`):

```js
  const time = useTime(guildId, userId, data.TIME_ANPACKEN, now);
  if (!time.ok) return { ok: false, reason: time.reason, need: data.TIME_ANPACKEN, ...time };
  const eff = effectiveOf(c, b);
  // Müde packt man weniger an: Umsatz × Energiefaktor (nach der Buchung).
  const umsatz = Math.round(b.umsatz * rankOf(data.RANKS.length - 1).factor * c.auslastung * eff.umsatzFactor * time.factor);
  db.saveCompany({ ...c, kasse: c.kasse + umsatz, pitch_day: day, pitch_today: done + 1 });
  return { ok: true, umsatz, done: done + 1, max: data.MAX_PITCH_PER_DAY, time, factor: time.factor };
```

`advertise` (`:391`): `if (!time.ok) return { ok: false, reason: time.reason, need: data.TIME_WERBUNG, ...time };` – Werbung hat keinen Ertrag, der Faktor greift nicht (Kommentar: „kostet Stunden und Energie, skaliert nichts").

- [ ] **Step 4: `src/music.js` – record, publish, show**

`record` (`:401-402, 408, 426`):

```js
  const time = useTime(guildId, userId, RECORD_TIME, now);
  if (!time.ok) return { ok: false, reason: time.reason, need: RECORD_TIME, ...time };
  …
  // Müde nimmt man schlechter auf: Qualität × Energiefaktor (nach der Buchung).
  const quality = (0.7 + random() * 0.7) * time.factor;
  …
    ok: true, songs, quality, factor: time.factor,
```

`publish` (`:498-499`, `:513-516`): `force` bucht keine Zeit, nimmt aber die aktuelle Energie:

```js
  const time = force
    ? { ok: true, forced: true, factor: require('./creator').energyOf(guildId, userId, now).factor }
    : useTime(guildId, userId, type.time, now);
  if (!time.ok) return { ok: false, reason: time.reason, need: type.time, release: type, ...time };
  …
    audienceFactor: audienceFactor * (event.audience ?? 1) * time.factor,
```

und im Rückgabeobjekt `factor: time.factor` ergänzen.

`show` (`:589-590, 599, 632`):

```js
  const time = useTime(guildId, userId, SHOW_TIME, now);
  if (!time.ok) return { ok: false, reason: time.reason, need: SHOW_TIME, ...time };
  …
  const quality = (0.75 + random() * 0.6) * time.factor;   // Gage und Zuwachs hängen daran
  …
    ok: true, gross, cut, amount: net, gained, quality, factor: time.factor, genre: g,
```

- [ ] **Step 5: Tests laufen lassen**

Run: `rm -rf .testdata && DATA_DIR=.testdata node test/energy.test.js && DATA_DIR=.testdata node test/music.test.js && DATA_DIR=.testdata node test/musicEvents.test.js && DATA_DIR=.testdata node test/company.test.js`
Expected: alle `0 fehlgeschlagen`. Wenn `music.test.js` Kalibrierungswerte (z. B. „~830k mit deutsch") um mehr als die Toleranz verfehlt, **nicht** die Toleranz weiten, sondern hier stoppen und berichten – dann ist der Faktor in der Simulation stärker als in der Spec gedacht, und Task 6 (Messung) muss vor der Kalibrierung laufen. `music.test.js` „mit Gesicht wachsen die Kanäle deutlich stärker mit" ist ein bekannter seltener Math.random-Flake (ein zweiter Lauf entscheidet).

- [ ] **Step 6: Commit**

```bash
git add src/company.js src/music.js test/energy.test.js
git commit -m "energie: faktor auf anpacken, studio, release und show; exhausted wird durchgereicht

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 5: Anzeige und Texte

**Files:**
- Modify: `src/ui.js:881, 908-913, 958-966` (Jobcenter), `:1106-1110` (Firma ⏳ Heute), `:1604-1606` (Creator extras), `:2199-2204` (Musik ⏳ Heute), `:2887-2892` (Plattform ⏳ Bereit), Hilfsfunktion neben `auslastungBar` (`:983`)
- Modify: `src/buttons.js:289-312` (shiftResult), `:318-328` (Schicht-Embed), `:367-369` (Footer), `:1801-1803` (Studio), `:1843-1845` (Release), `:1890-1892` (Show), `:1958, 1963` (Werbung/Anpacken), `:2358-2361` (Creator)
- Modify: `src/fluxer/commands.js:469-484` (workProblem)
- Test: `test/menu.test.js` (läuft nur), `test/fluxer-render.test.js` (läuft nur)

**Interfaces:**
- Consumes: `creator.budget()` → `{ used, max, left, energy, factor, readyAt }`; `energy.blockText(res, now)`; `jobs.shiftBudget()` → `{ done, max, maxAll, left, overtimeLeft, nextIsOvertime, hours, maxHours }`; `work()`-Ergebnis mit `overtime, overtimeBonus`.
- Produces: `ui.zeitEnergieZeile(budget)` (exportiert) → z. B. `⏳ Zeit: **14** von 24 · 🔋 ▰▰▰▰▰▰▱▱ 77 %` plus Zusatz `_müde – Wirkung ×0,80_` (Faktor < 0,95) oder `_erschöpft – wieder in 1 h 2 min_` (readyAt gesetzt).

- [ ] **Step 1: Hilfsfunktion in `src/ui.js` neben `auslastungBar` (`:983`)**

```js
/**
 * Die gemeinsame Zeile für Zeit und Energie (ein Tag, eine Energie – §17).
 * `budget` kommt aus creator.budget().
 */
function zeitEnergieZeile(budget) {
  const n = Math.round(Math.max(0, Math.min(1, budget.energy)) * 8);
  let s = `⏳ Zeit: **${budget.left}** von ${budget.max} · 🔋 ${'▰'.repeat(n)}${'▱'.repeat(8 - n)} ${pct(budget.energy)}`;
  if (budget.readyAt) {
    s += `\n_erschöpft – wieder in ${require('./income').formatRemaining(Math.max(0, budget.readyAt - Date.now()))}_`;
  } else if (budget.factor < 0.95) {
    s += `\n_müde – Wirkung ×${budget.factor.toFixed(2).replace('.', ',')}_`;
  }
  return s;
}
```

`module.exports` um `zeitEnergieZeile` ergänzen.

- [ ] **Step 2: Die vier Stellen umstellen**

Firma (`:1106-1110`):

```js
  embed.addFields({
    name: '⏳ Heute',
    value: `${zeitEnergieZeile(s.budget)}\nAnpacken noch **${s.pitchLeft}×** · Werbung kostet ${money(symbol, s.werbungCost)}`,
  });
```

Creator extras (`:1604-1606`): die beiden Zeilen `⏳ **Zeit heute:** …` und `🔋 **Energie:** …` durch `zeitEnergieZeile(s.budget)` ersetzen.

Musik (`:2199-2204`): `value: \`${zeitEnergieZeile(s.budget)}\nStudio ${…} · Release ${…}\``.

Plattform (`:2887-2892`): `value: \`${readyIn(me.remainingMs)} · braucht **${p.time}** h\n${zeitEnergieZeile(s.budget)}\` + …`.

Jobcenter (`:908-913`):

```js
    const kacheln = '▰'.repeat(Math.min(budget.done, budget.max)) + '▱'.repeat(budget.left)
      + (budget.done > budget.max ? '⏰' : '▫️');
    embed.addFields({
      name: 'Heute gearbeitet',
      value: `${kacheln}  ${Math.min(budget.done, budget.max)}/${budget.max} Schichten · ${Math.min(budget.hours, budget.maxHours)}/${budget.maxHours} Stunden`
        + (budget.done > budget.max ? ` + ${(budget.done - budget.max) * jobs.HOURS_PER_SHIFT} Überstunden` : '')
        + `\n${zeitEnergieZeile(require('./creator').budget(guildId, userId))}`
        + (budget.left === 0 && budget.overtimeLeft === 0 ? '\n🛌 Feierabend – morgen geht es weiter.' : ''),
    });
```

Knopf (`:958-966`):

```js
      .setLabel(budget.left > 0
        ? `Schicht arbeiten (${budget.left} übrig)`
        : budget.nextIsOvertime ? 'Überstunde (+25 %)' : 'Heute fertig')
      .setEmoji(budget.left > 0 ? '⚒️' : budget.nextIsOvertime ? '⏰' : '🛌')
      .setStyle(ButtonStyle.Primary)
      .setDisabled(!current || (budget.left === 0 && !budget.nextIsOvertime)),
```

- [ ] **Step 3: Texte in `src/buttons.js`**

`shiftResult` (`:289-312`) – vor `const texts = {`:

```js
    if (result.reason === 'exhausted') return { content: require('./energy').blockText(result) };
    if (result.reason === 'no_time') {
      return { content: `😴 Der Tag hat nur ${result.max} Stunden – übrig sind **${result.left}**, eine Schicht braucht ${jobs.HOURS_PER_SHIFT}.` };
    }
```

`daily_limit`-Text (`:297-304`): `${result.done} Schichten` bleibt; die Stundenangabe wird `(${Math.min(result.done, jobs.MAX_SHIFTS_PER_DAY) * jobs.HOURS_PER_SHIFT} Stunden${result.done > jobs.MAX_SHIFTS_PER_DAY ? ' + Überstunde' : ''})`.

Schicht-Embed (`:318-321`): Titel bei Überstunde `⏰ Überstunde bei …` / `⏰ Überstunde beendet`; Beschreibung ergänzen:

```js
      (result.overtime
        ? `\n⏰ Überstunde: **${money(symbol, result.overtimeBonus)}** Zuschlag – du bist ziemlich platt.`
        : '') +
      (result.factor < 0.95
        ? `\n🔋 Müde gearbeitet: Wirkung ×${result.factor.toFixed(2)} (${Math.round(result.energy * 100)} % Energie).`
        : '')
```

Feld „Heute" (`:326-327`): `${result.shiftsToday}/${result.maxShifts} Schichten · ${result.shiftsToday * jobs.HOURS_PER_SHIFT} h`. Footer (`:367`): `result.shiftsToday >= result.maxShifts`.

Studio/Release/Show/Creator (`:1801, 1843, 1890, 2358`): jeweils **vor** dem `no_time`-Zweig einfügen `} else if (res.reason === 'exhausted') { note = require('./energy').blockText(res);`. Werbung/Anpacken (`:1958, 1963`): in die Tabellen `exhausted: require('./energy').blockText(r),` aufnehmen. In allen `no_time`-Texten „Zeit" durch „Stunden" ersetzen (z. B. `😴 Eine Session kostet **3** Stunden, übrig sind **1**.`); der Creator-Text (`:2359`) sagt jetzt „Der Tag hat 24 Stunden.".

`src/fluxer/commands.js:469-484` (`workProblem`): Fälle ergänzen

```js
    case 'exhausted':
      return require('../energy').blockText(res);
    case 'no_time':
      return `😴 Der Tag hat nur ${res.max} Stunden – übrig sind **${res.left}**.`;
```

- [ ] **Step 4: Tests laufen lassen**

Run: `rm -rf .testdata && DATA_DIR=.testdata node test/menu.test.js && DATA_DIR=.testdata node test/fluxer-render.test.js && DATA_DIR=.testdata node test/energy.test.js`
Expected: `0 fehlgeschlagen`. Falls der Menü-Test die Jobcenter-Ansicht nicht rendert, eine Sichtprüfung per Skript machen (`buildJobsView`/Jobcenter-Builder mit einem Testspieler, `console.log(embed.data.fields)`), damit die fünfte Kachel und die Energie-Zeile sichtbar sind – die Ausgabe in den Bericht.

- [ ] **Step 5: Commit**

```bash
git add src/ui.js src/buttons.js src/fluxer/commands.js
git commit -m "energie: gemeinsame zeit/energie-zeile, ueberstunden-kachel, sperrtext auf allen wegen

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 6: Messung, Kalibrierung, Docs, Patchnotes

**Files:**
- Modify: `scripts/messung-geldquellen.js:60-70` (Optionen), `:230-271` (kanaltag), `:288-320` (karriere), `:450-460` (Kommentar firmenlauf)
- Modify: `ARCHITEKTUR.md` §15 (`:384-461`), neuer §17 nach §16
- Modify: `src/data/patchnotes.js:19` (Eintrag 1.33.0 oben)
- Modify (nur wenn die Messung es verlangt): `src/energy.js` Konstanten **und** die Handrechnung in `test/energy.test.js` und der Spec-Tabelle – alle drei zusammen.

**Interfaces:**
- Consumes: alles aus Task 1–5.
- Produces: Optionen `--stunden=<N>` (Deckel je Tag für Kanäle+Musik zusammen, Standard 24) und `--marathon` (gerade Tage bis zur Wand, ungerade Tage Pause); Ausgabe je Archetyp zusätzlich „mittlere Energie am Tagesende".

- [ ] **Step 1: Skript erweitern**

Optionen (`:60-70`):

```js
/** `--stunden=<N>`: höchstens N Stunden am Tag (Musik + Kanäle zusammen; Standard 24 = bis Zeit oder Wand). */
const STUNDEN = Number((process.argv.find((a) => a.startsWith('--stunden=')) ?? '').slice('--stunden='.length)) || 24;
/** `--marathon`: gerade Tage bis zur Wand, ungerade Tage Pause – misst „Marathon + Ruhetag im Wechsel". */
const MARATHON = process.argv.includes('--marathon');
```

`kanaltag` (`:230-271`): der Deckel und das Vorrücken der Uhr, damit Plattform-Cooldowns im Tag ablaufen (sonst kommt kein Lauf über eine Aktion je Plattform hinaus):

```js
async function kanaltag(G, U, strat, now, rand, stunden = STUNDEN) {
  let t = 0;                                   // Minuten seit `now`
  const ENDE = 15 * 60;                        // spätestens ~22:40 ist Schluss
  for (let b = 0; b < (strat.bindung ?? 0); b++) {
    for (const c of strat.bindungsreihe) {
      if (c.bindung <= 0) break;
      if (creator.remainingMs(G, U, c.p, now + t * 60_000) > 0) continue;
      const r = await creator.act(G, U, c.p, c.f, now + (t++) * 60_000, rand);
      if (r.ok) break;
    }
  }
  for (let i = 0; i < 60; i++) {
    const b = creator.budget(G, U, now + t * 60_000);
    const zeit = Math.min(b.left, stunden - b.used);
    if (zeit <= 0 || b.readyAt) return;        // Zeit alle oder an der Wand

    let gemacht = false;
    let warten = Infinity;
    for (const c of strat.reihe) {
      if (c.time > zeit) continue;
      const rest = creator.remainingMs(G, U, c.p, now + t * 60_000);
      if (rest > 0) { warten = Math.min(warten, rest); continue; }
      const r = await creator.act(G, U, c.p, c.f, now + (t++) * 60_000, rand);
      if (r.ok) { gemacht = true; break; }
      if (r.reason === 'exhausted') return;
    }
    if (gemacht) continue;
    // Nichts frei: die Uhr bis zur nächsten freien Plattform vorstellen.
    if (!Number.isFinite(warten)) return;
    t += Math.ceil(warten / 60_000) + 1;
    if (t > ENDE) return;
  }
}
```

`karriere` (`:307-320`): Ruhetage im Marathon-Modus – `if (MARATHON && d % 2 === 1) { /* Ruhetag: nur Abrechnungen */ }`, d. h. `musiktag`, `music.show` und `kanaltag` in `if (!(MARATHON && d % 2 === 1)) { … }` einschließen; die Abrechnungen bleiben. Zusätzlich je Tag `energieSumme += creator.energyOf(G, U, now + 20e6).energy` und am Ende `energie: energieSumme / tage` im Ergebnis; in `durchlauf`/`zeile` mit ausgeben (`… · Energie Ø 71 %`).

Kommentar bei `firmenlauf` (`:454-458`): „Werbung 2 + 4 × Anpacken 2 = 10 > 8" ist Geschichte – ersetzen durch „Werbung 2 + 4 × Anpacken 2 = 10 von 24 Stunden, alles passt; die Energie drückt das vierte Anpacken um ein paar Prozent".

- [ ] **Step 2: Messläufe (je 10 Läufe à 365 Tage, nur Musik+Creator-Archetyp genügt nicht – das Skript misst beide, das ist in Ordnung)**

```bash
rm -rf .testdata && DATA_DIR=.testdata node scripts/messung-geldquellen.js 10 365 --stunden=8 2>&1 | tee /tmp/claude-1000/-home-kevin-projects-DiscordBot/bceec67f-7105-4095-882a-6de722ecf202/scratchpad/mess-8.txt
```

ebenso `--stunden=12`, `--stunden=16`, ohne Deckel (24) und `--marathon`. Die Firmen-Abschnitte des Skripts liefern nebenbei die neuen Firmenzahlen (Anpacken passt jetzt viermal an Werbetagen, Faktor drückt leicht).

Erwartung aus der Spec, gegen die geprüft wird:
- `tag8` nahe der bisherigen 100.916/Tag (±15 %).
- `tag16` deutlich unter 2 × `tag8`.
- `marathon` unter `tag12`.

Wenn `tag16` oder `24` über 2,5 × `tag8` liegen, ist die Kurve zu weich: `HOUR_COST_SLOPE` auf 0,3 heben (Handrechnung in Test und Spec **mit** ändern: 8 h = 22,0 → 78,0 %; 10 h Überstunde = 22,0 + 2 × (2,8 + 0,3 × 19) = 38,8 → 61,2 %; Wand nach Stunde 20) und die Läufe wiederholen. Nichts anderes drehen.

- [ ] **Step 3: Docs**

ARCHITEKTUR §15: nach dem Absatz „Zum **Zeitbudget:** …" (`:454-461`) ersetzen durch einen Absatz „Seit 1.33.0 (24-h-Tag, eine Energie): gemessen 365 Tage, Median – 8 h/Tag …, 12 h …, 16 h …, bis zur Wand …, Marathon im Wechsel … (Ø Energie …). Firmen im Vollbetrieb neu: Kiosk …, Café …, Spedition … (Anpacken passt jetzt viermal, Faktor drückt leicht)." mit den gemessenen Zahlen. Die alte Musik+Creator-Zahl (100.916) bleibt als „vor 1.33.0" stehen.

Neuer §17 (nach §16):

```markdown
## 17. Ein Tag, eine Energie

Alle Arbeit – Kanäle, Musik, Firma, Jobs – bucht aus **einem** 24-Stunden-Tag
(`creator.useTime`, Reset Mitternacht) und macht **eine** Energie müde
(`creator_state.fatigue`, Modell in `src/energy.js`). Jobs: 4 Schichten à 2 h
plus eine Überstunde (×1,25 Lohn, doppelt müde). Selbstständige haben keinen
Deckel außer der Energie.

- **Verbrauch konvex:** Stunde n kostet 1,4 + 0,25 × n Punkte. 8 h → 79,8 %,
  10 h mit Überstunde → 64,7 %, 16 h → 43,6 %, Wand nach Stunde 21.
- **Erholung linear:** 4 Punkte je Echtzeit-Stunde ohne Aktion. Marathon bis
  Mitternacht → 8 Uhr ~38 %, abends voll (Beschluss: ein harter Tag danach).
- **Faktor** `1 − 0,8 × (1 − Energie)²` auf die *Wirkung* jeder Aktion (Publikum,
  Lohn, Umsatz, Qualität, Release-Reichweite) – nach der Buchung, die letzte
  Stunde ist die müdeste. 75 % → 0,95, 50 % → 0,80, 10 % → 0,35.
- **Wand:** unter 10 % Energie wird jede Aktion mit Zeitkosten abgelehnt
  (`reason: 'exhausted'`, `readyAt`); Aktionen ohne Zeitkosten gehen immer.
- Faktor ≤ 1: keine Decke aus §3/§15 kann überschritten werden.

Warum konvex: „8 h ≥ 75 %" und „Wand bei ~20 h" gehen linear nicht zusammen.
Warum kein Schlaf-Knopf, keine Energie-Items: das wäre ein Kaufweg an der
einzigen Bremse vorbei.
```

Patchnote 1.33.0 in `src/data/patchnotes.js` (oben einfügen, Datum 2026-09-14, Titel „⏳ Ein Tag, eine Energie"): Zeilen zu 24 h für alle, Energie für alle (Faktor, Wand), Überstunde, und ehrlich die gemessene neue Creator-Zahl gegenüber 100.916.

- [ ] **Step 4: Volle Suite**

Run: `npm test 2>&1 | grep -c '❌'` → `0`; `npm test 2>&1 | grep -E "^[0-9]+ bestanden" | awk '{p+=$1; f+=$3} END {print p" bestanden, "f" fehlgeschlagen"}'`.

- [ ] **Step 5: Commit**

```bash
git add scripts/messung-geldquellen.js ARCHITEKTUR.md src/data/patchnotes.js src/energy.js test/energy.test.js docs/superpowers/specs/2026-09-14-zeit-energie-design.md
git commit -m "energie: messung mit stundendeckel und marathon, §17, patchnotes 1.33.0

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

## Selbstprüfung gegen die Spec

- Beschluss 1 (24 h, Jobs inklusive): Task 2 (`TIME_PER_DAY`), Task 3 (Schichten buchen). ✔
- Beschluss 2 (eine Energie): Task 1–2. ✔
- Beschluss 3 (Job 8 + 1 h Überstunde, Rest frei): Task 3 (`MAX_SHIFTS_PER_DAY + OVERTIME_SHIFTS`, kein weiterer Deckel). ✔
- Beschluss 4 (Faktor + Wand): Task 1 (`factorOf`, `exhausted`), Task 2 (`previewTime` prüft die Wand vor der Aktion). ✔
- Beschluss 5 (Wirkung, Tabelle): Task 2 (Creator), Task 3 (Lohn, Firmenstelle Umsatz+Lohn), Task 4 (Anpacken, Studio, Release inkl. `force`, Show; Werbung ohne). ✔
- Beschluss 6 (Überstunde ×1,25, doppelt müde): Task 3. ✔
- Beschluss 7 (Marathon ein Tag): Task 1 (`RECOVERY_PER_HOUR`), Prüfpunkt in Task 2. ✔
- Schnittstelle (`previewTime/useTime/energyOf/budget`): Task 2. ✔
- Anzeige (gemeinsame Zeile, Jobcenter-Kachel, Sperrtext auf allen Wegen): Task 5. ✔
- Messung, §15/§17, Patchnotes, Testanpassungen (`company.test.js:364`, `shifts.test.js:76`, `creator.test.js:477`): Task 3, 2, 6. `music.test.js:431` und der Kommentar in `musicEvents.test.js:472` bleiben gültig (nutzen `TIME_PER_DAY` bzw. sind Prosa – Kommentar in Task 6 auf „3 von 24" ändern). ✔
- Nicht-Ziele eingehalten: keine Items, kein Übertrag, keine Cooldown-Änderung. ✔
