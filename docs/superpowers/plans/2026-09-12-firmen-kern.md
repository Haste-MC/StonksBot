# Eigene Firmen, Stück 1 (Kern) – Umsetzungsplan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ein Spieler gründet eine Firma (Kiosk, Café, Spedition), stellt NPC- und Spieler-Angestellte ein, hält die Kasse im Plus und entnimmt den Gewinn; andere Spieler bewerben sich über das Arbeitsamt und arbeiten dort Schichten.

**Architecture:** Neues Modul `src/company.js` (reiner Kern: gründen, faule Abrechnung, Schicht, Inhaber-Aktionen, Arbeitsamt-Anbindung) über zwei neue Tabellen in `src/db.js`. Spieler-Angestellte laufen durch das **bestehende** Jobsystem (`employment.job_id = 'firma:<id>'`), das bei diesen Jobs in die Firma verzweigt. Ansichten und Handler in `ui.js`/`buttons.js` nach den vorhandenen Mustern (Registry §5, zustandslose IDs §6); Fluxer nutzt dieselben Handler.

**Tech Stack:** Node.js (CommonJS), `node:sqlite` über `src/db.js`, discord.js-Builder für Ansichten, eigene Testdateien (`check(label, ok)`), `DATA_DIR=.testdata`.

## Global Constraints

- Spec: `docs/superpowers/specs/2026-09-12-firmen-kern-design.md`. Zahlen daraus wörtlich (Branchen-Tabelle, Konstanten, Rangfaktoren 1,0/1,25/1,5, `PLAYER_BONUS 1.3`, `INSOLVENCY_DAYS 14`, `NPC_QUIT_AFTER_UNPAID 3`, `WERBUNG_DAYS 3`, `WERBUNG_BOOST 0.25`, `WERBUNG_COST_SHARE 0.05`, `AUSLASTUNG_MIN 0.3`, `AUSLASTUNG_STAFF 0.5`, `AUSLASTUNG_STEP 0.2`, `NPC_SHIFTS 3`, `TIME_WERBUNG 2`, `TIME_ANPACKEN 2`, `SHIFT_COOLDOWN_MIN 60`, `MAX_PITCH_PER_DAY 4`, `MAX_SETTLE_DAYS 30`). **Startwerte für die Messung, keine Behauptung** – gezogen wird in Task 6.
- ARCHITEKTUR.md: §3 (Decke vorgerechnet und getestet), §4 (faule Abrechnung, kein Scheduler; `settle` läuft vor jeder Aktion und beim Öffnen), §6 (Button-IDs `<aktion>|…|<userId>`), §7 (synchroner Schreibvorgang vor dem ersten `await`), §8 (`require` anderer Spielmodule **innerhalb** von Funktionen: `creator`, `perks`, `jobs`), §9 (genau eine Geldbuchung je Aktion), §12 (Tests ohne Netz: `unb.changeCash`/`unb.getBalance`/`unb.withdrawFromBank` werden im Test ersetzt).
- Geld nur über `unb.changeCash(guildId, accountId, amount, reason, opts)`; NPC-Löhne sind **Verbindlichkeiten** (immer gebucht, Kasse darf ins Minus); Spieler-Schichten nur bei Deckung; Entnahme ist Umbuchung (`{ tax: false, kind: 'company' }`), Spieler-Lohn wie ein Job (`{ kind: 'job' }`, mit `perks.payout`-Zuschlag, der **nicht** die Kasse belastet).
- `userId` in allen Funktionen ist die **Konto-ID** (identity), wie überall in `buttons.js` (`uid(interaction)`).
- Der Ereigniswürfel/Varianz: `random` wird als Parameter durchgereicht (Tests mit festem Würfel).
- Regeln aus `messfehler-vermeiden.md`: jede abgeleitete Zahl erst gegen einen von Hand gerechneten Einzelfall; eine Null ist ein Fehler; Simulationen starten heute 6:00 und laufen vorwärts; `grep src/` statt raten.
- Sprache: Deutsch in Kommentaren, Texten, Commits. Commit-Trailer wörtlich: `Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>`.
- Tests: `rm -rf .testdata && DATA_DIR=.testdata node test/company.test.js`; volle Kette `npm test 2>&1 | grep -c '❌'` → `0`. Nie gegen `data/shop.db`. `test/menu.test.js` prüft jeden Registry-Eintrag (gültige Ansicht, Weg zurück ins Hauptmenü) – der neue Eintrag muss dort bestehen.

---

## Dateien

| Datei | Verantwortung |
|---|---|
| `src/data/companies.js` | **neu** – `BRANCHES`, `RANKS`, `NPC_NAMES`, Konstanten |
| `src/company.js` | **neu** – Kern: `found`, `settle`, `closeCompany`, `workShift`, `asJob`, `join`, `leave`, `openings`, Inhaber-Aktionen, `status`, `ceilingOf` |
| `src/db.js` | Tabellen `companies`, `company_staff`; Funktionen |
| `src/jobs.js` | `resolveJob`, Verzweigung `firma:` in `apply`, `work`, `quit`, `currentJob` |
| `src/menu.js` | Eintrag `firma` |
| `src/ui.js` | `buildFirmaView`, `buildFirmaFoundView`, `buildFirmaStaffView`; Rubrik im Arbeitsamt |
| `src/buttons.js` | Handler `firma`, `fstaff`, `fgruenden`; Modals `fname`, `fbetrag`, `fpraemie`; `apply`/`shiftResult` firmentauglich |
| `test/company.test.js` | **neu** |
| `package.json` | Testkette |
| `scripts/messung-geldquellen.js` | Archetyp `firma:<branch>` |
| `src/data/patchnotes.js` | 1.31.0 |
| `ARCHITEKTUR.md` | §15 ergänzen |

---

### Task 1: Daten, Tabellen, Gründen und Personal

**Files:**
- Create: `src/data/companies.js`, `src/company.js`, `test/company.test.js`
- Modify: `src/db.js` (Tabellen nach `relay_messages`; `stmt`-Block; Funktionen; Exporte), `package.json` (Testkette)

**Interfaces:**
- Produces (`src/data/companies.js`): `BRANCHES[{ id, name, emoji, price, slots, umsatz, lohn, blurb }]`, `RANKS[{ id, name, emoji, factor }]`, `NPC_NAMES[]`, Konstanten wie in Global Constraints.
- Produces (`src/db.js`): `insertCompany({ guildId, ownerId, branch, name, now })` → row; `getCompany(id)`; `getOpenCompany(guildId, ownerId)`; `saveCompany(row)`; `deleteCompany(id)`; `openCompanies(guildId)`; `insertStaff({ companyId, kind, userId, name, now })` → row; `companyStaff(companyId)`; `staffById(id)`; `staffByUser(companyId, userId)`; `saveStaff(row)`; `deleteStaff(id)`; `deleteStaffOfCompany(companyId)`; `clearEmploymentByJob(guildId, jobId)`; `clearCompanies(guildId)` (Tests).
- Produces (`src/company.js`): `branch(id)`, `rankOf(n)`, `JOB_PREFIX`, `companyJobId(id)`, `companyIdOfJob(jobId)`, `ownCompany(guildId, userId)`, `found(guildId, userId, branchId, name, now)`, `hireNpc(guildId, userId, now, random)`, `fire(guildId, userId, staffId)`.

- [ ] **Step 1: Test schreiben (Katalog, Gründen, Personal)**

`test/company.test.js`:

```js
/**
 * Tests für die Firmen (Stück 1: der Kern).
 *
 * Geprüft wird vor allem, was §3 verlangt: Die Decke einer Firma ist eine
 * vorgerechnete Zahl, NPC-Löhne sind eine echte Senke, und jede Aktion bucht
 * höchstens einmal (§9). Dazu die Regeln aus dem Gespräch: Löhne sind
 * Verbindlichkeiten (die Kasse darf ins Minus), 14 Tage Minus = Insolvenz,
 * der Inhaber befördert selbst.
 *
 * Aufruf: DATA_DIR=.testdata node test/company.test.js
 */
const db = require('../src/db');
const company = require('../src/company');
const data = require('../src/data/companies');
const unb = require('../src/unb');

let pass = 0, fail = 0;
const check = (label, ok, extra = '') => {
  if (ok) { pass++; console.log(`  ✅ ${label}`); }
  else { fail++; console.log(`  ❌ ${label} ${extra}`); }
};

const G = `FIRMA_T${Date.now()}`;
const DAY_MS = 24 * 60 * 60 * 1000;
const de = (n) => Math.round(n).toLocaleString('de-DE');

// Gefälschte Bank: jedes Konto startet mit `funds`, jede Buchung wird gezählt.
const konten = new Map();
let bookings = [];
const funds = (u, cash = 0, bank = 0) => konten.set(u, { cash, bank });
unb.getBalance = async (g, u) => {
  const k = konten.get(u) ?? { cash: 0, bank: 0 };
  return { cash: k.cash, bank: k.bank, total: k.cash + k.bank };
};
unb.changeCash = async (g, u, amount, reason, opts = {}) => {
  const k = konten.get(u) ?? { cash: 0, bank: 0 };
  k.cash += amount; konten.set(u, k);
  bookings.push({ user: u, amount, reason, opts });
  return { cash: k.cash, bank: k.bank, total: k.cash + k.bank };
};
unb.withdrawFromBank = async (g, u, amount) => {
  const k = konten.get(u) ?? { cash: 0, bank: 0 };
  k.cash += amount; k.bank -= amount; konten.set(u, k);
  return { cash: k.cash, bank: k.bank, total: k.cash + k.bank };
};

/** Fester Würfel: liefert nacheinander die Werte, danach 0,5. */
const seq = (...v) => { let i = 0; return () => (i < v.length ? v[i++] : 0.5); };
const t0 = new Date(new Date().setHours(6, 0, 0, 0)).getTime() + DAY_MS;
let n = 0;
const user = () => `u${++n}`;

(async () => {
  console.log('--- Der Katalog ---');
  {
    check('drei Branchen', data.BRANCHES.length === 3);
    check('jede Branche vollständig', data.BRANCHES.every((b) =>
      b.id && b.name && b.emoji && b.price > 0 && b.slots > 0 && b.umsatz > b.lohn && b.blurb));
    const [k, c, s] = data.BRANCHES;
    check('Kiosk < Café < Spedition beim Preis', k.price < c.price && c.price < s.price);
    check('… und bei der Decke',
      company.ceilingOf(k).net < company.ceilingOf(c).net && company.ceilingOf(c).net < company.ceilingOf(s).net,
      data.BRANCHES.map((b) => `${b.id}=${de(company.ceilingOf(b).net)}`).join(' '));
    // Handrechnung Spedition: 10 × 3 × 2.600 × 1,5 = 117.000 + 4 × 3.900 = 132.600 brutto,
    // Löhne 10 × 3 × 630 = 18.900 → 113.700 netto.
    check('Decke der Spedition ist die Handrechnung (113.700)',
      company.ceilingOf(s).net === 113_700, de(company.ceilingOf(s).net));
    check('drei Ränge mit Faktoren 1 / 1,25 / 1,5',
      data.RANKS.map((r) => r.factor).join() === '1,1.25,1.5');
    check('genug NPC-Namen', data.NPC_NAMES.length >= 30);
  }

  console.log('--- Gründen ---');
  {
    const U = user();
    funds(U, 10_000, 200_000);
    bookings = [];
    let r = await company.found(G, U, 'cafe', 'Kaffeeklatsch', t0);
    check('Gründung klappt', r.ok === true, r.reason);
    check('Preis wurde gebucht – genau eine Buchung', bookings.length === 1 && bookings[0].amount === -120_000,
      JSON.stringify(bookings));
    check('Bank wurde angezapft (Bargeld reichte nicht)', (konten.get(U).cash) === 10_000 + 110_000 - 120_000);
    check('Kasse startet bei 0, Auslastung bei 0,3',
      r.company.kasse === 0 && Math.abs(r.company.auslastung - data.AUSLASTUNG_MIN) < 1e-9);
    check('ownCompany findet sie', company.ownCompany(G, U)?.name === 'Kaffeeklatsch');

    r = await company.found(G, U, 'kiosk', 'Zweite', t0);
    check('zweite Firma abgelehnt', r.ok === false && r.reason === 'already');
    const V = user(); funds(V, 1_000);
    r = await company.found(G, V, 'kiosk', 'Arm', t0);
    check('zu wenig Geld abgelehnt', r.ok === false && r.reason === 'funds' && company.ownCompany(G, V) === null);
    r = await company.found(G, V, 'kiosk', 'x', t0);
    check('Name zu kurz', r.reason === 'name');
    r = await company.found(G, V, 'kiosk', '@everyone', t0);
    check('Name mit @ abgelehnt', r.reason === 'name');
    r = await company.found(G, V, 'bank', 'Geldhaus', t0);
    check('unbekannte Branche', r.reason === 'unknown_branch');
    // Buchung schlägt fehl -> Zeile wird wieder gelöscht.
    funds(V, 50_000);
    const echt = unb.changeCash;
    unb.changeCash = async () => { throw new Error('API down'); };
    r = await company.found(G, V, 'kiosk', 'Pechvogel', t0);
    unb.changeCash = echt;
    check('fehlgeschlagene Buchung -> keine Firma', r.reason === 'payment' && company.ownCompany(G, V) === null);
  }

  console.log('--- Personal einstellen und entlassen ---');
  {
    const U = user(); funds(U, 0, 100_000);
    await company.found(G, U, 'kiosk', 'Späti', t0);
    let r = company.hireNpc(G, U, t0, seq(0));
    check('NPC eingestellt', r.ok === true && r.staff.kind === 'npc' && r.staff.name === data.NPC_NAMES[0]);
    r = company.hireNpc(G, U, t0, seq(0.999));
    check('zweiter NPC, anderer Name', r.ok && r.staff.name === data.NPC_NAMES[data.NPC_NAMES.length - 1]);
    r = company.hireNpc(G, U, t0);
    check('dritter abgelehnt: Kiosk hat 2 Plätze', r.ok === false && r.reason === 'full');
    const staff = db.companyStaff(company.ownCompany(G, U).id);
    check('zwei in der Liste, Rang 0', staff.length === 2 && staff.every((s) => s.rank === 0));
    r = company.fire(G, U, staff[0].id);
    check('entlassen schafft Platz', r.ok && db.companyStaff(company.ownCompany(G, U).id).length === 1);
    check('fremdes Personal kann man nicht entlassen', company.fire(G, user(), staff[1].id).ok === false);
    check('ohne Firma kein Einstellen', company.hireNpc(G, user(), t0).reason === 'no_company');
  }

  console.log(`\n${pass} bestanden, ${fail} fehlgeschlagen`);
  process.exit(fail ? 1 : 0);
})();
```

- [ ] **Step 2: Test laufen lassen – er muss scheitern**

```bash
rm -rf .testdata && DATA_DIR=.testdata node test/company.test.js
```

Erwartet: `Cannot find module '../src/company'`.

- [ ] **Step 3: Datendatei**

`src/data/companies.js`:

```js
/**
 * ===========================================================================
 *  FIRMEN – Branchen, Ränge, Konstanten (Stück 1: der Kern)
 * ===========================================================================
 *
 * Gründungspreise sind realistisch („Deutschland durch drei", wie die
 * übrigen Preise im Spiel). Die Investition liegt nicht in der Gründung,
 * sondern im Ausbau – der kommt in Stück 2. Deshalb ist die Decke einer
 * nicht ausgebauten Firma bewusst niedrig (siehe company.ceilingOf).
 *
 *   price   Gründungspreis
 *   slots   Arbeitsplätze – NPCs und Spieler zusammen; das ist die Decke
 *   umsatz  Umsatz je Schicht bei Auslastung 1,0 und Rang Aushilfe
 *   lohn    Lohn je Schicht, Rang Aushilfe
 *
 * Alle Zahlen sind STARTWERTE für die Messung (scripts/messung-geldquellen.js),
 * keine Behauptung. Zielmarken im Vollbetrieb: Kiosk ~2.500/Tag, Café ~20.000,
 * Spedition ~70.000 – alle unter Musik+Creator.
 */

const BRANCHES = [
  { id: 'kiosk', name: 'Kiosk', emoji: '🏪', price: 25_000, slots: 2, umsatz: 250, lohn: 100,
    blurb: 'Zeitungen, Zigaretten, kalte Getränke. Läuft fast allein – aber eben nur fast.' },
  { id: 'cafe', name: 'Café', emoji: '☕', price: 120_000, slots: 5, umsatz: 900, lohn: 180,
    blurb: 'Braucht Leute hinter der Theke und jemanden, der sich kümmert. Dann läuft es.' },
  { id: 'spedition', name: 'Spedition', emoji: '🚚', price: 1_200_000, slots: 10, umsatz: 2_600, lohn: 420,
    blurb: 'Lkw, Fahrer, Disposition. Hohe Löhne, hohe Marge – rentabel nur mit voller Mannschaft.' },
];

/** Ränge: Faktor auf Umsatz UND Lohn – der Inhaber befördert selbst. */
const RANKS = [
  { id: 0, name: 'Aushilfe', emoji: '🧹', factor: 1.0 },
  { id: 1, name: 'Fachkraft', emoji: '🔧', factor: 1.25 },
  { id: 2, name: 'Schichtleiter', emoji: '📋', factor: 1.5 },
];

const NPC_NAMES = [
  'Ali', 'Anja', 'Ben', 'Bianca', 'Cem', 'Clara', 'Dennis', 'Dilara', 'Emre', 'Eva',
  'Finn', 'Frieda', 'Gökhan', 'Greta', 'Hakan', 'Hanna', 'Igor', 'Ines', 'Jonas', 'Julia',
  'Kai', 'Katja', 'Leon', 'Lena', 'Murat', 'Mia', 'Niko', 'Nina', 'Ömer', 'Olga',
  'Paul', 'Petra', 'Rafael', 'Rosa', 'Sven', 'Selin', 'Tim', 'Tamara', 'Yusuf', 'Zoe',
];

const NPC_SHIFTS = 3;               // Schichten je NPC und Tag
const INSOLVENCY_DAYS = 14;         // so lange darf die Kasse im Minus sein
const NPC_QUIT_AFTER_UNPAID = 3;    // unbezahlte Tage, bis ein NPC kündigt
const WERBUNG_DAYS = 3;
const WERBUNG_BOOST = 0.25;         // auf das Auslastungsziel
const WERBUNG_COST_SHARE = 0.05;    // des Gründungspreises
const AUSLASTUNG_MIN = 0.3;         // ohne Personal
const AUSLASTUNG_STAFF = 0.5;       // volle Besetzung bringt 0,3 + 0,5 = 0,8; der Rest ist Werbung
const AUSLASTUNG_STEP = 0.2;        // Annäherung je Tag
const PLAYER_BONUS = 1.3;           // Umsatz einer Spieler-Schicht gegenüber NPC
const TIME_WERBUNG = 2;             // aus dem gemeinsamen Tagesbudget (creator.useTime)
const TIME_ANPACKEN = 2;
const SHIFT_COOLDOWN_MIN = 60;      // Abklingzeit einer Spieler-Schicht
const MAX_PITCH_PER_DAY = 4;        // „selbst anpacken" je Tag
const MAX_SETTLE_DAYS = 30;         // ältere Tage verfallen (wie bei Musik)

module.exports = {
  BRANCHES, RANKS, NPC_NAMES,
  NPC_SHIFTS, INSOLVENCY_DAYS, NPC_QUIT_AFTER_UNPAID, WERBUNG_DAYS, WERBUNG_BOOST,
  WERBUNG_COST_SHARE, AUSLASTUNG_MIN, AUSLASTUNG_STAFF, AUSLASTUNG_STEP, PLAYER_BONUS,
  TIME_WERBUNG, TIME_ANPACKEN, SHIFT_COOLDOWN_MIN, MAX_PITCH_PER_DAY, MAX_SETTLE_DAYS,
};
```

- [ ] **Step 4: Tabellen und Funktionen in `db.js`**

Nach dem `db.exec` für `relay_messages` einfügen:

```js
// Firmen (Stück 1): Die Kasse ist LOKALER Zustand – Umsatz rein, Löhne raus,
// der Inhaber entnimmt per Buchung. Sie darf ins Minus laufen (Löhne sind
// Verbindlichkeiten); 14 Tage Minus sind die Insolvenz. Siehe company.js.
db.exec(`
  CREATE TABLE IF NOT EXISTS companies (
    id             INTEGER PRIMARY KEY AUTOINCREMENT,
    guild_id       TEXT    NOT NULL,
    owner_id       TEXT    NOT NULL,
    branch         TEXT    NOT NULL,
    name           TEXT    NOT NULL,
    kasse          INTEGER NOT NULL DEFAULT 0,
    auslastung     REAL    NOT NULL DEFAULT 0.3,
    founded_at     INTEGER NOT NULL,
    paid_through   INTEGER NOT NULL,
    negative_since INTEGER NOT NULL DEFAULT 0,
    werbung_until  INTEGER NOT NULL DEFAULT 0,
    pitch_day      TEXT    NOT NULL DEFAULT '',
    pitch_today    INTEGER NOT NULL DEFAULT 0,
    status         TEXT    NOT NULL DEFAULT 'open',
    closed_at      INTEGER NOT NULL DEFAULT 0
  );
  CREATE UNIQUE INDEX IF NOT EXISTS idx_companies_owner_open
    ON companies (guild_id, owner_id) WHERE status = 'open';

  CREATE TABLE IF NOT EXISTS company_staff (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    company_id  INTEGER NOT NULL,
    kind        TEXT    NOT NULL,
    user_id     TEXT    NOT NULL DEFAULT '',
    name        TEXT    NOT NULL,
    rank        INTEGER NOT NULL DEFAULT 0,
    hired_at    INTEGER NOT NULL,
    shifts      INTEGER NOT NULL DEFAULT 0,
    unpaid_days INTEGER NOT NULL DEFAULT 0
  );
  CREATE INDEX IF NOT EXISTS idx_company_staff_company ON company_staff (company_id);
`);
```

Im `stmt`-Objekt (z. B. nach dem Block „Paare gespiegelter Nachrichten"):

```js
  // --- Firmen ---
  insertCompany: db.prepare(
    `INSERT INTO companies (guild_id, owner_id, branch, name, founded_at, paid_through)
     VALUES (?, ?, ?, ?, ?, ?) RETURNING *`),
  getCompany: db.prepare('SELECT * FROM companies WHERE id = ?'),
  getOpenCompany: db.prepare(
    `SELECT * FROM companies WHERE guild_id = ? AND owner_id = ? AND status = 'open'`),
  openCompanies: db.prepare(
    `SELECT * FROM companies WHERE guild_id = ? AND status = 'open' ORDER BY founded_at`),
  saveCompany: db.prepare(
    `UPDATE companies SET name = ?, kasse = ?, auslastung = ?, paid_through = ?,
       negative_since = ?, werbung_until = ?, pitch_day = ?, pitch_today = ?,
       status = ?, closed_at = ?
     WHERE id = ?`),
  deleteCompany: db.prepare('DELETE FROM companies WHERE id = ?'),
  clearCompanies: db.prepare('DELETE FROM companies WHERE guild_id = ?'),
  insertStaff: db.prepare(
    `INSERT INTO company_staff (company_id, kind, user_id, name, hired_at)
     VALUES (?, ?, ?, ?, ?) RETURNING *`),
  companyStaff: db.prepare('SELECT * FROM company_staff WHERE company_id = ? ORDER BY id'),
  staffById: db.prepare('SELECT * FROM company_staff WHERE id = ?'),
  staffByUser: db.prepare(
    `SELECT * FROM company_staff WHERE company_id = ? AND kind = 'player' AND user_id = ?`),
  saveStaff: db.prepare(
    'UPDATE company_staff SET rank = ?, shifts = ?, unpaid_days = ? WHERE id = ?'),
  deleteStaff: db.prepare('DELETE FROM company_staff WHERE id = ?'),
  deleteStaffOfCompany: db.prepare('DELETE FROM company_staff WHERE company_id = ?'),
  clearEmploymentByJob: db.prepare('DELETE FROM employment WHERE guild_id = ? AND job_id = ?'),
```

Funktionen (nach `clearRelayPairs`):

```js
// ------------------------------------------------------------------ Firmen

function insertCompany({ guildId, ownerId, branch, name, now = Date.now() }) {
  return stmt.insertCompany.get(guildId, String(ownerId), branch, name, now, now);
}
function getCompany(id) { return stmt.getCompany.get(Number(id)) ?? null; }
function getOpenCompany(guildId, ownerId) {
  return stmt.getOpenCompany.get(guildId, String(ownerId)) ?? null;
}
function openCompanies(guildId) { return stmt.openCompanies.all(guildId); }
/** Schreibt die Firma in EINER Anweisung fort. */
function saveCompany(c) {
  stmt.saveCompany.run(
    c.name, Math.round(c.kasse), c.auslastung, c.paid_through, c.negative_since ?? 0,
    c.werbung_until ?? 0, c.pitch_day ?? '', c.pitch_today ?? 0, c.status ?? 'open',
    c.closed_at ?? 0, Number(c.id));
}
function deleteCompany(id) { stmt.deleteCompany.run(Number(id)); }
function clearCompanies(guildId) {
  for (const c of stmt.openCompanies.all(guildId)) stmt.deleteStaffOfCompany.run(c.id);
  stmt.clearCompanies.run(guildId);
}
function insertStaff({ companyId, kind, userId = '', name = '', now = Date.now() }) {
  return stmt.insertStaff.get(Number(companyId), kind, String(userId), name, now);
}
function companyStaff(companyId) { return stmt.companyStaff.all(Number(companyId)); }
function staffById(id) { return stmt.staffById.get(Number(id)) ?? null; }
function staffByUser(companyId, userId) {
  return stmt.staffByUser.get(Number(companyId), String(userId)) ?? null;
}
function saveStaff(s) {
  stmt.saveStaff.run(Math.round(s.rank), Math.round(s.shifts), Math.round(s.unpaid_days), Number(s.id));
}
function deleteStaff(id) { stmt.deleteStaff.run(Number(id)); }
function deleteStaffOfCompany(companyId) { stmt.deleteStaffOfCompany.run(Number(companyId)); }
/** Alle Anstellungen bei einem Job lösen (Firma geschlossen). */
function clearEmploymentByJob(guildId, jobId) { stmt.clearEmploymentByJob.run(guildId, jobId); }
```

Exporte in `module.exports`: `insertCompany, getCompany, getOpenCompany, openCompanies, saveCompany, deleteCompany, clearCompanies, insertStaff, companyStaff, staffById, staffByUser, saveStaff, deleteStaff, deleteStaffOfCompany, clearEmploymentByJob,`.

- [ ] **Step 5: `src/company.js` – erster Teil**

```js
/**
 * ===========================================================================
 *  FIRMEN – gründen, betreiben, Personal führen (Stück 1: der Kern)
 * ===========================================================================
 *
 * Eine Firma ist eine Geldquelle mit eigener Kasse. Der Umsatz entsteht je
 * Schicht (NPCs arbeiten automatisch, Spieler per Knopf), die Löhne gehen von
 * der Kasse ab, der Inhaber entnimmt den Rest. Drei Dinge halten das im
 * Rahmen (§3):
 *
 *   1. **Plätze.** Jede Branche hat feste Arbeitsplätze – das ist die Decke.
 *      `ceilingOf` rechnet sie vor, der Test prüft sie.
 *   2. **Löhne sind Verbindlichkeiten.** NPC-Löhne werden immer gebucht; die
 *      Kasse darf ins Minus. 14 Tage Minus sind die Insolvenz.
 *   3. **Zeit.** Inhaber-Aktionen kosten aus demselben Tagesbudget wie
 *      Streams und Studio (§15: eine Bremse, nicht zwei).
 *
 * Spieler-Angestellte laufen durch das Jobsystem (`employment.job_id =
 * 'firma:<id>'`): Tageslimit, Abklingzeit und „ein Job je Spieler" gelten
 * damit ohne neuen Code; jobs.js verzweigt bei diesen Jobs hierher.
 */

const db = require('./db');
const data = require('./data/companies');
const unb = require('./unb');

const changeCash = (...a) => unb.changeCash(...a);
const getBalance = (...a) => unb.getBalance(...a);

const DAY_MS = 24 * 60 * 60 * 1000;
const JOB_PREFIX = 'firma:';

const branchById = new Map(data.BRANCHES.map((b) => [b.id, b]));
const clamp = (min, max, v) => Math.min(max, Math.max(min, v));

/** Branche per ID, oder null. */
function branch(id) { return branchById.get(String(id ?? '')) ?? null; }

/** Rang-Eintrag zu einer Stufe (geklemmt auf 0…2). */
function rankOf(n) { return data.RANKS[clamp(0, data.RANKS.length - 1, Math.round(n ?? 0))]; }

/** Job-ID einer Firma im Jobsystem, und zurück. */
function companyJobId(id) { return `${JOB_PREFIX}${id}`; }
function companyIdOfJob(jobId) {
  const s = String(jobId ?? '');
  if (!s.startsWith(JOB_PREFIX)) return null;
  const id = Number(s.slice(JOB_PREFIX.length));
  return Number.isInteger(id) && id > 0 ? id : null;
}

/** Tagesschlüssel wie in jobs.js (Kalendertag, lokale Zeit). */
function dayKey(now) {
  const d = new Date(now);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

/** Die offene Firma eines Spielers, oder null. */
function ownCompany(guildId, userId) { return db.getOpenCompany(guildId, userId); }

/**
 * Die Decke einer Branche je Tag – vorgerechnet, damit §3 eine Zahl hat.
 * Volle NPC-Besetzung mit Schichtleitern, Auslastung 1,0 (mit Werbung),
 * tägliches Anpacken. `gross` Umsatz, `wages` Löhne, `net` die Differenz.
 */
function ceilingOf(b) {
  const top = rankOf(data.RANKS.length - 1).factor;
  const gross = b.slots * data.NPC_SHIFTS * b.umsatz * top
    + data.MAX_PITCH_PER_DAY * b.umsatz * top;
  const wages = b.slots * data.NPC_SHIFTS * b.lohn * top;
  return { gross, wages, net: gross - wages };
}

/** Name-Regeln: 2–32 Zeichen, keine Erwähnungen. */
function cleanName(name) {
  const s = String(name ?? '').replace(/\s+/g, ' ').trim();
  if (s.length < 2 || s.length > 32 || /[@<>]/.test(s)) return null;
  return s;
}

// ------------------------------------------------------------------ Gründen

/**
 * Gründet eine Firma. Zeile zuerst (§7), dann EINE Buchung des Preises (§9);
 * scheitert die Buchung, wird die Zeile wieder gelöscht.
 */
async function found(guildId, userId, branchId, name, now = Date.now()) {
  const b = branch(branchId);
  if (!b) return { ok: false, reason: 'unknown_branch' };
  const clean = cleanName(name);
  if (!clean) return { ok: false, reason: 'name' };
  if (db.getOpenCompany(guildId, userId)) return { ok: false, reason: 'already' };

  const balance = await getBalance(guildId, userId);
  if (balance.total < b.price) {
    return { ok: false, reason: 'funds', needed: b.price, have: balance.total };
  }

  let row;
  try {
    row = db.insertCompany({ guildId, ownerId: userId, branch: b.id, name: clean, now });
  } catch {
    // Eindeutiger Index: zwei Gründungen kurz hintereinander – die zweite verliert.
    return { ok: false, reason: 'already' };
  }

  try {
    if (balance.cash < b.price) {
      await unb.withdrawFromBank(guildId, userId, b.price - balance.cash, `Gründung: ${clean}`);
    }
    const newBalance = await changeCash(guildId, userId, -b.price, `Gründung: ${clean}`,
      { kind: 'company' });
    return { ok: true, company: row, branch: b, balance: newBalance };
  } catch (err) {
    db.deleteCompany(row.id);
    return { ok: false, reason: 'payment', error: err.message };
  }
}

// ----------------------------------------------------------------- Personal

/** Firma des Inhabers samt Branche und Personal – der Einstieg jeder Aktion. */
function ownerContext(guildId, userId) {
  const c = db.getOpenCompany(guildId, userId);
  if (!c) return null;
  return { company: c, branch: branch(c.branch), staff: db.companyStaff(c.id) };
}

/** Einen NPC einstellen, solange ein Platz frei ist. */
function hireNpc(guildId, userId, now = Date.now(), random = Math.random) {
  const ctx = ownerContext(guildId, userId);
  if (!ctx) return { ok: false, reason: 'no_company' };
  if (ctx.staff.length >= ctx.branch.slots) return { ok: false, reason: 'full' };
  const name = data.NPC_NAMES[Math.min(data.NPC_NAMES.length - 1,
    Math.floor(random() * data.NPC_NAMES.length))];
  const staff = db.insertStaff({ companyId: ctx.company.id, kind: 'npc', name, now });
  return { ok: true, staff, free: ctx.branch.slots - ctx.staff.length - 1 };
}

/** Entlassen – NPC oder Spieler; bei Spielern auch die Anstellung lösen. */
function fire(guildId, userId, staffId) {
  const ctx = ownerContext(guildId, userId);
  if (!ctx) return { ok: false, reason: 'no_company' };
  const s = db.staffById(staffId);
  if (!s || s.company_id !== ctx.company.id) return { ok: false, reason: 'not_found' };
  db.deleteStaff(s.id);
  if (s.kind === 'player') {
    const e = db.getEmployment(guildId, s.user_id);
    if (e?.job_id === companyJobId(ctx.company.id)) db.clearEmployment(guildId, s.user_id);
  }
  return { ok: true, staff: s };
}

module.exports = {
  BRANCHES: data.BRANCHES, RANKS: data.RANKS, JOB_PREFIX, DAY_MS,
  branch, rankOf, companyJobId, companyIdOfJob, dayKey, ownCompany, ownerContext,
  ceilingOf, cleanName, found, hireNpc, fire,
};
```

- [ ] **Step 6: Test grün, Testkette**

```bash
rm -rf .testdata && DATA_DIR=.testdata node test/company.test.js
```

Erwartet: alle ✅ (u. a. „Decke der Spedition ist die Handrechnung (113.700)"). Dann in `package.json` ans Ende der `test`-Kette ` && node test/company.test.js` anhängen und `npm test 2>&1 | grep -c '❌'` → `0`.

- [ ] **Step 7: Commit**

```bash
git add src/data/companies.js src/company.js src/db.js test/company.test.js package.json
git commit -m "$(printf 'firmen: branchen, tabellen, gruenden, personal einstellen und entlassen\n\nCo-Authored-By: Claude Opus 5 <noreply@anthropic.com>')"
```

---

### Task 2: Faule Abrechnung – Auslastung, NPC-Schichten, Insolvenz

**Files:**
- Modify: `src/company.js`
- Test: `test/company.test.js`

**Interfaces:**
- Consumes: Task 1.
- Produces: `settle(companyId, now)` → `{ days, umsatz, loehne, quit: string[], insolvent, auslastung, kasse } | null`; `closeCompany(guildId, companyId, now, why)`; `dailyTarget(b, staffCount, werbungActive)`.

- [ ] **Step 1: Tests 4, 5, 9 schreiben**

Vor der Abschlusszeile einfügen:

```js
  console.log('--- Abrechnung: Auslastung und NPC-Schichten ---');
  {
    const U = user(); funds(U, 0, 100_000);
    const f = await company.found(G, U, 'kiosk', 'Rechenkiosk', t0);
    company.hireNpc(G, U, t0, seq(0)); company.hireNpc(G, U, t0, seq(0.5));
    const b = company.branch('kiosk');
    // Handrechnung, 5 Tage, 2 Aushilfen (Faktor 1), Kiosk umsatz 250 / lohn 100:
    // Ziel = 0,3 + 0,5 × 2/2 = 0,8. Tag d: a += (0,8 − a) × 0,2, beginnend bei 0,3.
    let a = data.AUSLASTUNG_MIN, kasse = 0;
    for (let d = 0; d < 5; d++) {
      a += (0.8 - a) * data.AUSLASTUNG_STEP;
      const umsatz = Math.round(b.umsatz * a);
      kasse += 2 * data.NPC_SHIFTS * (umsatz - b.lohn);
    }
    const r = company.settle(f.company.id, t0 + 5 * DAY_MS);
    const c = db.getCompany(f.company.id);
    check('5 Tage abgerechnet', r.days === 5);
    check('Kasse = Handrechnung', c.kasse === kasse, `${de(c.kasse)} vs ${de(kasse)}`);
    check('Auslastung = Handrechnung', Math.abs(c.auslastung - a) < 1e-9, `${c.auslastung} vs ${a}`);
    check('paid_through ist vorgerückt', c.paid_through === t0 + 5 * DAY_MS);
    check('NPC-Schichten gezählt', db.companyStaff(c.id).every((s) => s.shifts === 15));
    check('nochmal abrechnen tut nichts', company.settle(c.id, t0 + 5 * DAY_MS).days === 0);
    check('kein Personal -> Ziel 0,3', Math.abs(company.dailyTarget(b, 0, false) - 0.3) < 1e-9);
    check('voll -> 0,8, mit Werbung -> 1,0',
      Math.abs(company.dailyTarget(b, 2, false) - 0.8) < 1e-9 && company.dailyTarget(b, 2, true) === 1);
    // Über 20 Tage nähert sich die Auslastung dem Ziel.
    company.settle(c.id, t0 + 25 * DAY_MS);
    check('nach 25 Tagen über 0,79', db.getCompany(c.id).auslastung > 0.79, String(db.getCompany(c.id).auslastung));
    check('älter als 30 Tage verfällt', company.settle(c.id, t0 + 100 * DAY_MS).days === data.MAX_SETTLE_DAYS);
  }

  console.log('--- Löhne sind Verbindlichkeiten: Minus, Kündigung, Insolvenz ---');
  {
    // Kiosk mit EINEM Schichtleiter (Ziel 0,3 + 0,5 × 1/2 = 0,55). Handrechnung:
    // Tag 1: a = 0,35, Umsatz round(250 × 1,5 × 0,35) = 131 < Lohn 150 → 3 × −19 = −57.
    // Tag 2: a = 0,39 → 146 → −12 (Kasse −69). Tag 3: a = 0,422 → 158 → +24 (Kasse −45),
    // immer noch im Minus → dritter unbezahlter Tag → Kündigung.
    const U = user(); funds(U, 0, 100_000);
    const f = await company.found(G, U, 'kiosk', 'Minuskiosk', t0);
    company.hireNpc(G, U, t0, seq(0));
    for (const s of db.companyStaff(f.company.id)) db.saveStaff({ ...s, rank: 2 });
    let r = company.settle(f.company.id, t0 + 1 * DAY_MS);
    let c = db.getCompany(f.company.id);
    check('Tag 1: Kasse −57 (Handrechnung)', c.kasse === -57, de(c.kasse));
    check('Minus-Uhr läuft', c.negative_since === t0 + 1 * DAY_MS);
    check('NPC gilt als unbezahlt', db.companyStaff(c.id).every((s) => s.unpaid_days === 1));
    r = company.settle(c.id, t0 + 3 * DAY_MS);
    check('nach 3 unbezahlten Tagen kündigt er', r.quit.length === 1 && db.companyStaff(c.id).length === 0,
      JSON.stringify(r.quit));
    check('Kasse −45 (Handrechnung)', db.getCompany(c.id).kasse === -45, de(db.getCompany(c.id).kasse));
    const minus = db.getCompany(c.id).kasse;
    r = company.settle(c.id, t0 + 13 * DAY_MS);
    c = db.getCompany(c.id);
    check('ohne Personal keine weiteren Löhne', c.kasse === minus, `${de(c.kasse)} vs ${de(minus)}`);
    check('Tag 13: noch offen', c.status === 'open' && r.insolvent === false);
    r = company.settle(c.id, t0 + 15 * DAY_MS);
    c = db.getCompany(c.id);
    check('Tag 15: insolvent', r.insolvent === true && c.status === 'closed' && c.closed_at > 0);
    check('ownCompany ist danach null', company.ownCompany(G, U) === null);
    check('settle auf geschlossen tut nichts', company.settle(c.id, t0 + 20 * DAY_MS) === null);
  }
```

- [ ] **Step 2: Test laufen lassen – Scheitern erwartet**

```bash
rm -rf .testdata && DATA_DIR=.testdata node test/company.test.js 2>&1 | grep -m1 "TypeError"
```

Erwartet: `company.settle is not a function`.

- [ ] **Step 3: `settle`, `closeCompany`, `dailyTarget`**

In `src/company.js` vor `module.exports` einfügen:

```js
// --------------------------------------------------------------- Abrechnung

/** Auslastungsziel: ohne Personal 0,3, volle Besetzung 0,8, mit Werbung 1,0. */
function dailyTarget(b, staffCount, werbungActive) {
  const ziel = data.AUSLASTUNG_MIN + data.AUSLASTUNG_STAFF * Math.min(1, staffCount / b.slots)
    + (werbungActive ? data.WERBUNG_BOOST : 0);
  return Math.min(1, ziel);
}

/**
 * Schließt eine Firma – freiwillig oder insolvent. Personal weg, Anstellungen
 * der Spieler gelöst. Die Kasse wird hier NICHT gebucht (das macht `close`).
 */
function closeCompany(guildId, companyId, now = Date.now(), why = 'closed') {
  const c = db.getCompany(companyId);
  if (!c || c.status !== 'open') return null;
  db.saveCompany({ ...c, status: 'closed', closed_at: now });
  db.deleteStaffOfCompany(c.id);
  db.clearEmploymentByJob(guildId, companyJobId(c.id));
  return { ...c, status: 'closed', closed_at: now, why };
}

/**
 * Faule Abrechnung (§4): rechnet volle Tage seit `paid_through` nach.
 * Je Tag: Auslastung bewegt sich aufs Ziel zu, NPCs arbeiten ihre Schichten
 * (Umsatz − Lohn in die Kasse, Löhne immer – Verbindlichkeiten), unbezahlte
 * NPCs kündigen nach NPC_QUIT_AFTER_UNPAID Tagen, und 14 Tage Minus sind die
 * Insolvenz. Synchron, ohne Buchung – nur Zustand.
 */
function settle(companyId, now = Date.now()) {
  const c = db.getCompany(companyId);
  if (!c || c.status !== 'open') return null;
  const b = branch(c.branch);
  const guildId = c.guild_id;

  const out = { days: 0, umsatz: 0, loehne: 0, quit: [], insolvent: false,
    auslastung: c.auslastung, kasse: c.kasse };
  const total = Math.floor((now - c.paid_through) / DAY_MS);
  if (total <= 0) return out;
  const days = Math.min(total, data.MAX_SETTLE_DAYS);
  const skipped = total - days;               // ältere Tage verfallen (wie bei Musik)
  out.days = days;

  let staff = db.companyStaff(c.id);
  let { kasse, auslastung, negative_since } = c;
  let tag = c.paid_through + skipped * DAY_MS;

  for (let d = 0; d < days; d++) {
    tag += DAY_MS;

    // 1. Auslastung bewegt sich aufs Ziel zu.
    const ziel = dailyTarget(b, staff.length, c.werbung_until > tag);
    auslastung += (ziel - auslastung) * data.AUSLASTUNG_STEP;

    // 2. NPC-Schichten – Löhne sind Verbindlichkeiten, die Kasse darf ins Minus.
    for (const s of staff) {
      if (s.kind !== 'npc') continue;
      const f = rankOf(s.rank).factor;
      const lohn = Math.round(b.lohn * f);
      const umsatz = Math.round(b.umsatz * f * auslastung);
      kasse += data.NPC_SHIFTS * (umsatz - lohn);
      out.umsatz += data.NPC_SHIFTS * umsatz;
      out.loehne += data.NPC_SHIFTS * lohn;
      s.shifts += data.NPC_SHIFTS;
    }
    // Unbezahlt heißt: Am Tagesende ist die Kasse im Minus – für alle gleich.
    for (const s of staff) if (s.kind === 'npc') s.unpaid_days = kasse < 0 ? s.unpaid_days + 1 : 0;
    const quitting = staff.filter((s) => s.kind === 'npc' && s.unpaid_days >= data.NPC_QUIT_AFTER_UNPAID);
    for (const s of quitting) { db.deleteStaff(s.id); out.quit.push(s.name); }
    staff = staff.filter((s) => !quitting.includes(s));

    // 3. Die Minus-Uhr.
    if (kasse < 0 && !negative_since) negative_since = tag;
    if (kasse >= 0) negative_since = 0;
    if (negative_since && tag - negative_since >= data.INSOLVENCY_DAYS * DAY_MS) {
      db.saveCompany({ ...c, kasse, auslastung, negative_since, paid_through: tag });
      closeCompany(guildId, c.id, tag, 'insolvent');
      out.insolvent = true; out.auslastung = auslastung; out.kasse = kasse;
      return out;
    }
  }

  for (const s of staff) db.saveStaff(s);
  db.saveCompany({ ...c, kasse, auslastung, negative_since, paid_through: tag });
  out.auslastung = auslastung; out.kasse = kasse;
  return out;
}
```

Exporte ergänzen: `dailyTarget, closeCompany, settle,`.

- [ ] **Step 4: Handrechnung prüfen, Tests grün**

Im Test steht die Handrechnung für 5 Tage Kiosk; wenn „Kasse = Handrechnung" rot ist, ist die Reihenfolge (erst Auslastung, dann Schichten) oder die Rundung anders als im Test – die Rundung `Math.round(b.umsatz * f * auslastung)` je Schicht ist die Vorgabe.

```bash
rm -rf .testdata && DATA_DIR=.testdata node test/company.test.js 2>&1 | tail -1
```

Erwartet: `… bestanden, 0 fehlgeschlagen`.

- [ ] **Step 5: Commit**

```bash
git add src/company.js test/company.test.js
git commit -m "$(printf 'firmen: faule abrechnung – auslastung, npc-schichten, loehne als verbindlichkeit, insolvenz\n\nCo-Authored-By: Claude Opus 5 <noreply@anthropic.com>')"
```

---

### Task 3: Spieler-Schichten und das Arbeitsamt

**Files:**
- Modify: `src/company.js`, `src/jobs.js` (`apply` ~153, `work` ~176, `quit` ~280, `currentJob` ~288, Exporte)
- Test: `test/company.test.js`

**Interfaces:**
- Consumes: Task 1–2.
- Produces (`company.js`): `asJob(jobId)` → virtueller Job `{ id, title, emoji, pay, cooldown, tier: 'firma', requires: [], company, branch } | null`; `join(guildId, userId, companyId, now)`; `leave(guildId, userId)`; `openings(guildId)` → `[{ company, branch, free, lohn, jobId }]`; `workShift(guildId, userId, companyId, now, random)` → `{ ok, lohn, umsatz, company, branch, rank }`.
- Produces (`jobs.js`): `resolveJob(jobId)`; `apply` verzweigt bei `firma:`; `work` bucht Firmenlohn aus `workShift`; `quit` ruft `company.leave`; `currentJob` findet Firmenjobs.

- [ ] **Step 1: Tests 6 und 10 schreiben**

Vor der Abschlusszeile:

```js
  console.log('--- Arbeitsamt: bewerben, arbeiten, kündigen ---');
  {
    const jobs = require('../src/jobs');
    const chef = user(); funds(chef, 0, 500_000);
    const f = await company.found(G, chef, 'cafe', 'Bohne', t0);
    const cid = f.company.id;
    const jobId = company.companyJobId(cid);
    check('openings listet die Firma mit 5 freien Plätzen',
      company.openings(G).some((o) => o.company.id === cid && o.free === 5 && o.jobId === jobId));
    check('Inhaber kann sich nicht selbst bewerben', jobs.apply(G, chef, jobId).reason === 'owner');

    const A = user(); funds(A, 0);
    let r = jobs.apply(G, A, jobId);
    check('Spieler bewirbt sich über jobs.apply', r.ok === true && r.job.title === 'Bohne' && r.job.tier === 'firma', r.reason);
    check('employment zeigt auf die Firma', db.getEmployment(G, A)?.job_id === jobId);
    check('company_staff hat ihn', db.staffByUser(cid, A)?.kind === 'player');
    check('currentJob findet den Firmenjob', jobs.currentJob(G, A)?.job.company?.id === cid);
    check('openings zeigt 4 freie Plätze', company.openings(G).find((o) => o.company.id === cid).free === 4);

    // Schicht: Kasse leer -> abgelehnt, keine Buchung.
    bookings = [];
    r = await jobs.work(G, A, new Date(t0 + 1000));
    check('Kasse deckt den Lohn nicht -> keine Schicht', r.ok === false && r.reason === 'kasse' && bookings.length === 0, r.reason);
    // Inhaber zahlt ein (Task 4 hat deposit noch nicht) -> Kasse direkt setzen.
    db.saveCompany({ ...db.getCompany(cid), kasse: 10_000 });
    r = await jobs.work(G, A, new Date(t0 + 2000), seq(0.5));
    const b = company.branch('cafe');
    check('Schicht gearbeitet', r.ok === true, r.reason);
    // Handrechnung: Lohn 180 × 1 × (0,85 + 0,5 × 0,3) = 180; Umsatz 900 × 1 × 0,3 × 1,3 = 351.
    check('Lohn = Handrechnung (180)', r.base === 180, String(r.base));
    check('genau eine Buchung an den Spieler, kind job', bookings.length === 1 && bookings[0].user === A
      && bookings[0].amount === r.amount && bookings[0].opts.kind === 'job', JSON.stringify(bookings));
    check('Kasse: +Umsatz −Lohn (351 − 180)', db.getCompany(cid).kasse === 10_000 + 351 - 180, de(db.getCompany(cid).kasse));
    check('Level-Zuschlag belastet die Kasse nicht', r.amount >= r.base && db.getCompany(cid).kasse === 10_000 + 171);
    check('Schicht gezählt', db.staffByUser(cid, A).shifts === 1 && db.getEmployment(G, A).shifts === 1);
    check('Ergebnis nennt Firma und Umsatz', r.company?.id === cid && r.umsatz === 351 && r.promotion === null);
    r = await jobs.work(G, A, new Date(t0 + 3000));
    check('Abklingzeit 60 min gilt', r.ok === false && r.reason === 'cooldown');

    // Beförderter Spieler: Faktor 1,25 auf Lohn und Umsatz.
    const s = db.staffByUser(cid, A); db.saveStaff({ ...s, rank: 1 });
    r = await jobs.work(G, A, new Date(t0 + 2 * 3600e3), seq(0.5));
    check('Fachkraft: Lohn 225', r.ok && r.base === 225, String(r.base));

    // Wechsel zu einem Arbeitsamt-Job löst die Firmenstelle.
    const offer = jobs.dailyOffers(G, A, new Date(t0)).find((j) => jobs.checkRequirements(G, A, j).ok);
    if (offer) {
      r = jobs.apply(G, A, offer.id, new Date(t0));
      check('Wechsel ins Arbeitsamt räumt die Firmenstelle', r.ok && db.staffByUser(cid, A) === null);
    } else {
      check('(kein freies Angebot heute – Wechsel nicht prüfbar)', true);
      jobs.quit(G, A);
    }
    check('Kündigen räumt company_staff', db.staffByUser(cid, A) === null);
    jobs.apply(G, A, jobId);
    check('wieder eingestellt', db.staffByUser(cid, A) !== null);
    r = jobs.quit(G, A);
    check('quit liefert den Firmenjob', r.ok && r.job?.title === 'Bohne' && db.staffByUser(cid, A) === null);

    // Firma voll: 5 Plätze.
    for (let i = 0; i < 5; i++) company.hireNpc(G, chef, t0, seq(0.1 * i));
    check('voll -> Bewerbung abgelehnt', jobs.apply(G, user(), jobId).reason === 'full');

    // Firma geschlossen -> Spieler fliegt raus.
    const B = user();
    company.fire(G, chef, db.companyStaff(cid)[0].id);
    jobs.apply(G, B, jobId);
    company.closeCompany(G, cid, t0 + 5000);
    check('Schließen löst die Anstellung', db.getEmployment(G, B) === null);
    r = await jobs.work(G, B, new Date(t0 + 6000));
    check('… und work sagt arbeitslos', r.ok === false && r.reason === 'unemployed');
  }
```

- [ ] **Step 2: Scheitern prüfen**

```bash
rm -rf .testdata && DATA_DIR=.testdata node test/company.test.js 2>&1 | grep -m1 "❌\|TypeError"
```

Erwartet: `company.openings is not a function`.

- [ ] **Step 3: `company.js` – Spieler und Arbeitsamt**

Vor `module.exports`:

```js
// ------------------------------------------------------ Spieler im Betrieb

/** Der virtuelle Job einer Firma – damit das Jobsystem sie kennt. */
function asJob(jobId) {
  const id = companyIdOfJob(jobId);
  if (id === null) return null;
  const c = db.getCompany(id);
  if (!c || c.status !== 'open') return null;
  const b = branch(c.branch);
  return {
    id: jobId, title: c.name, emoji: b.emoji, pay: b.lohn,
    cooldown: data.SHIFT_COOLDOWN_MIN, tier: 'firma', requires: [],
    company: c, branch: b,
  };
}

/** Alle offenen Firmen des Servers mit freiem Platz. */
function openings(guildId) {
  return db.openCompanies(guildId).map((c) => {
    const b = branch(c.branch);
    const free = b.slots - db.companyStaff(c.id).length;
    return { company: c, branch: b, free, lohn: b.lohn, jobId: companyJobId(c.id) };
  }).filter((o) => o.free > 0);
}

/**
 * Bei einer Firma anfangen. Ersetzt den bisherigen Job (auch eine andere
 * Firma). Zeile in company_staff UND employment.
 */
function join(guildId, userId, companyId, now = Date.now()) {
  const c = db.getCompany(companyId);
  if (!c || c.status !== 'open') return { ok: false, reason: 'closed' };
  if (c.owner_id === String(userId)) return { ok: false, reason: 'owner' };
  if (db.staffByUser(c.id, userId)) return { ok: false, reason: 'already_hired' };
  const b = branch(c.branch);
  if (db.companyStaff(c.id).length >= b.slots) return { ok: false, reason: 'full' };

  leave(guildId, userId);                        // alte Firmenstelle räumen
  db.insertStaff({ companyId: c.id, kind: 'player', userId, now });
  db.setEmployment(guildId, userId, companyJobId(c.id));
  return { ok: true, job: asJob(companyJobId(c.id)) };
}

/** Firmenstelle eines Spielers räumen (Kündigung, Wechsel). Ohne employment zu löschen. */
function leave(guildId, userId) {
  const e = db.getEmployment(guildId, userId);
  const id = companyIdOfJob(e?.job_id);
  if (id === null) return false;
  const s = db.staffByUser(id, userId);
  if (s) db.deleteStaff(s.id);
  return true;
}

/**
 * Eine Spieler-Schicht: Zustand (Kasse, Schichtzähler) hier, die Buchung an
 * den Spieler macht jobs.work – mit dessen Level-Zuschlag, der die Kasse nicht
 * belastet. Nur bei gedecktem Lohn.
 */
function workShift(guildId, userId, companyId, now = Date.now(), random = Math.random) {
  settle(companyId, now);
  const c = db.getCompany(companyId);
  if (!c || c.status !== 'open') return { ok: false, reason: 'closed' };
  const s = db.staffByUser(c.id, userId);
  if (!s) return { ok: false, reason: 'not_staff' };
  const b = branch(c.branch);
  const f = rankOf(s.rank).factor;
  const lohn = Math.max(1, Math.round(b.lohn * f * (0.85 + random() * 0.3)));
  const umsatz = Math.round(b.umsatz * f * c.auslastung * data.PLAYER_BONUS);
  if (c.kasse < lohn) return { ok: false, reason: 'kasse', lohn, kasse: c.kasse };

  db.saveCompany({ ...c, kasse: c.kasse - lohn + umsatz });
  db.saveStaff({ ...s, shifts: s.shifts + 1 });
  return { ok: true, lohn, umsatz, company: c, branch: b, rank: rankOf(s.rank) };
}
```

Exporte ergänzen: `asJob, openings, join, leave, workShift,`.

- [ ] **Step 4: `jobs.js` verzweigt**

Nach `const byId = …` (oben in `jobs.js`, `grep -n "const byId" src/jobs.js`) einfügen:

```js
/** Katalog-Job oder virtueller Firmenjob (`firma:<id>`, siehe company.js). */
function resolveJob(jobId) {
  return byId.get(jobId) ?? require('./company').asJob(jobId);
}
```

`apply` ersetzen:

```js
function apply(guildId, userId, jobId, date = new Date()) {
  // Firmenstelle: Plätze und Inhaber prüft die Firma selbst.
  const company = require('./company');
  if (company.companyIdOfJob(jobId) !== null) {
    const current = db.getEmployment(guildId, userId);
    const res = company.join(guildId, userId, company.companyIdOfJob(jobId), date.getTime());
    if (!res.ok) return { ok: false, reason: res.reason, job: company.asJob(jobId) };
    return { ok: true, job: res.job, previous: current ? resolveJob(current.job_id) : null };
  }

  const job = byId.get(jobId);
  if (!job) return { ok: false, reason: 'unknown_job' };

  const offered = dailyOffers(guildId, userId, date).some((j) => j.id === jobId);
  if (!offered) return { ok: false, reason: 'not_offered', job };

  const current = db.getEmployment(guildId, userId);
  if (current?.job_id === jobId) return { ok: false, reason: 'already_hired', job };

  const check = checkRequirements(guildId, userId, job);
  if (!check.ok) return { ok: false, reason: 'requirements', job, missing: check.missing };

  company.leave(guildId, userId);                // Firmenstelle räumen, falls vorhanden
  db.setEmployment(guildId, userId, jobId);
  return { ok: true, job, previous: current ? resolveJob(current.job_id) : null };
}
```

In `work` – Signatur `async function work(guildId, userId, now = new Date(), random = Math.random)`; die Zeile `const job = byId.get(employment.job_id);` durch `const job = resolveJob(employment.job_id);` ersetzen (der Aufräum-Zweig darunter bleibt: Firma geschlossen → `asJob` null → `clearEmployment`, `unemployed`). Direkt **nach** der Abklingzeit-Prüfung (`if (waited < cooldownMs) …`) und **vor** `checkRequirements` einfügen:

```js
  // Firmenstelle: Zustand macht die Firma, gebucht wird hier – einmal (§9).
  const company = require('./company');
  const cid = company.companyIdOfJob(employment.job_id);
  if (cid !== null) {
    const shift = company.workShift(guildId, userId, cid, now.getTime(), random);
    if (!shift.ok) {
      if (shift.reason === 'closed') { db.clearEmployment(guildId, userId); return { ok: false, reason: 'unemployed' }; }
      return { ok: false, reason: shift.reason, job, lohn: shift.lohn, kasse: shift.kasse };
    }
    const perk = require('./perks').perksOf(guildId, userId);
    const amount = require('./perks').payout(guildId, userId, shift.lohn);
    const balance = await changeCash(
      guildId, userId, amount, `Schicht: ${shift.company.name}`, { kind: 'job' });
    db.recordShift(guildId, userId, amount, day);
    const updated = db.getEmployment(guildId, userId);
    return {
      ok: true, job, amount, base: shift.lohn, levelBonus: amount - shift.lohn, level: perk.level,
      rank: null, promotion: null, nextChance: 0, balance, broken: [],
      employment: updated, shiftsToday: updated.shifts_today, maxShifts: MAX_SHIFTS_PER_DAY,
      company: shift.company, umsatz: shift.umsatz, companyRank: shift.rank,
    };
  }
```

`quit` ersetzen:

```js
function quit(guildId, userId) {
  const employment = db.getEmployment(guildId, userId);
  if (!employment) return { ok: false, reason: 'unemployed' };
  const job = resolveJob(employment.job_id);
  require('./company').leave(guildId, userId);
  db.clearEmployment(guildId, userId);
  return { ok: true, job: job ?? null, employment };
}
```

`currentJob`: `const job = byId.get(employment.job_id);` → `const job = resolveJob(employment.job_id);`. Export `resolveJob`.

Hinweis: `jobs.work` liest heute `Math.random` direkt für die Varianz des Katalog-Jobs – das bleibt; der neue Parameter `random` wird nur an die Firma gereicht.

- [ ] **Step 5: Tests grün, Nachbarn grün**

```bash
rm -rf .testdata && DATA_DIR=.testdata node test/company.test.js 2>&1 | tail -1; DATA_DIR=.testdata node test/jobs.test.js 2>&1 | tail -1; DATA_DIR=.testdata node test/shifts.test.js 2>&1 | tail -1
```

Erwartet: dreimal `0 fehlgeschlagen`. Handrechnung im Test: Lohn `180 × 1 × (0,85 + 0,5 × 0,3) = 180`, Umsatz `900 × 0,3 × 1,3 = 351`.

- [ ] **Step 6: Commit**

```bash
git add src/company.js src/jobs.js test/company.test.js
git commit -m "$(printf 'firmen: spieler-schichten ueber das jobsystem, bewerben und kuendigen\n\nCo-Authored-By: Claude Opus 5 <noreply@anthropic.com>')"
```

---

### Task 4: Inhaber-Aktionen

**Files:**
- Modify: `src/company.js`
- Test: `test/company.test.js`

**Interfaces:**
- Consumes: Task 1–3; `creator.useTime(guildId, userId, cost, now)` → `{ ok, left, max, resetMs }`.
- Produces: `advertise(guildId, userId, now)`, `pitchIn(guildId, userId, now)`, `withdraw(guildId, userId, amount, now)`, `deposit(guildId, userId, amount, now)`, `promote(guildId, userId, staffId, delta)`, `bonus(guildId, userId, staffId, amount, now)`, `close(guildId, userId, now)`, `status(guildId, userId, now)`. Alle Aktionen rufen zuerst `settle`.

- [ ] **Step 1: Tests 7, 8, 12 schreiben**

Vor der Abschlusszeile:

```js
  console.log('--- Inhaber-Aktionen ---');
  {
    const creator = require('../src/creator');
    const U = user(); funds(U, 50_000, 500_000);
    const f = await company.found(G, U, 'cafe', 'Chefsache', t0);
    const cid = f.company.id;
    const b = company.branch('cafe');
    for (let i = 0; i < 3; i++) company.hireNpc(G, U, t0, seq(0.1 * i));

    // Werbung braucht Deckung.
    let r = await company.advertise(G, U, t0);
    check('Werbung ohne Deckung abgelehnt', r.ok === false && r.reason === 'kasse');
    bookings = [];
    r = await company.deposit(G, U, 20_000, t0);
    check('Einzahlen: eine Buchung, Kasse steigt', r.ok && bookings.length === 1 && bookings[0].amount === -20_000
      && db.getCompany(cid).kasse === 20_000);
    check('Einzahlen über Guthaben abgelehnt', (await company.deposit(G, U, 10_000_000, t0)).reason === 'funds');
    const zeitVor = creator.budget(G, U, t0).left;
    r = await company.advertise(G, U, t0);
    check('Werbung: Kasse −6.000 (5 % von 120.000), 3 Tage', r.ok && db.getCompany(cid).kasse === 14_000
      && db.getCompany(cid).werbung_until === t0 + 3 * DAY_MS, JSON.stringify(r));
    check('Werbung kostet Zeit aus dem Creator-Budget', creator.budget(G, U, t0).left === zeitVor - data.TIME_WERBUNG);
    check('Werbung läuft schon -> abgelehnt', (await company.advertise(G, U, t0 + 1000)).reason === 'running');

    // Anpacken: Umsatz als Schichtleiter, kein Lohn.
    const a = db.getCompany(cid).auslastung;
    r = await company.pitchIn(G, U, t0);
    check('Anpacken bringt 900 × 1,5 × Auslastung', r.ok && r.umsatz === Math.round(b.umsatz * 1.5 * a)
      && db.getCompany(cid).kasse === 14_000 + r.umsatz, JSON.stringify(r));
    check('… und kostet Zeit', creator.budget(G, U, t0).left === zeitVor - data.TIME_WERBUNG - data.TIME_ANPACKEN);
    for (let i = 0; i < 3; i++) await company.pitchIn(G, U, t0);
    check('höchstens 4 je Tag (oder Zeit alle)',
      ['limit', 'no_time'].includes((await company.pitchIn(G, U, t0)).reason));

    // Rang und Prämie.
    const staff = db.companyStaff(cid);
    r = company.promote(G, U, staff[0].id, +1);
    check('befördert auf Fachkraft', r.ok && db.staffById(staff[0].id).rank === 1 && r.rank.name === 'Fachkraft');
    company.promote(G, U, staff[0].id, +1); r = company.promote(G, U, staff[0].id, +1);
    check('über Schichtleiter geht nichts', r.ok === false && db.staffById(staff[0].id).rank === 2);
    r = company.promote(G, U, staff[0].id, -1);
    check('zurückgestuft', r.ok && db.staffById(staff[0].id).rank === 1);
    check('Prämie an NPC abgelehnt', (await company.bonus(G, U, staff[0].id, 100, t0)).reason === 'not_player');
    const P = user(); funds(P, 0);
    company.join(G, P, cid, t0);
    const ps = db.staffByUser(cid, P);
    const kasseVor = db.getCompany(cid).kasse;
    bookings = [];
    r = await company.bonus(G, U, ps.id, 500, t0);
    check('Prämie: eine Buchung an den Spieler, Kasse sinkt', r.ok && bookings.length === 1 && bookings[0].user === P
      && bookings[0].amount === 500 && db.getCompany(cid).kasse === kasseVor - 500);
    check('Prämie über Kasse abgelehnt', (await company.bonus(G, U, ps.id, 10_000_000, t0)).reason === 'kasse');
    r = company.promote(G, U, ps.id, +1);
    check('Spieler-Beförderung spiegelt sich in employment.rank', r.ok && db.getEmployment(G, P).rank === 1);

    // Entnahme.
    bookings = [];
    const k = db.getCompany(cid).kasse;
    r = await company.withdraw(G, U, k, t0);
    check('Entnahme: eine Buchung ohne Steuer, Kasse 0', r.ok && bookings.length === 1 && bookings[0].amount === k
      && bookings[0].opts.tax === false && db.getCompany(cid).kasse === 0, JSON.stringify(bookings));
    check('Entnahme über Kasse abgelehnt', (await company.withdraw(G, U, 1, t0)).reason === 'kasse');
    check('Entnahme von 0 abgelehnt', (await company.withdraw(G, U, 0, t0)).reason === 'amount');

    // Einzahlen rettet vor der Insolvenz.
    db.saveCompany({ ...db.getCompany(cid), kasse: -5_000, negative_since: t0 - 13 * DAY_MS });
    r = await company.deposit(G, U, 6_000, t0);
    check('Einzahlung setzt die Minus-Uhr zurück', r.ok && db.getCompany(cid).negative_since === 0);

    // Status.
    const s = company.status(G, U, t0);
    check('status: Kasse, Auslastung, Personal, Decke, Tagesprognose',
      s.company.id === cid && s.staff.length === 4 && s.free === 1 && s.ceiling.net > 0 && typeof s.forecast === 'number'
      && s.budget.max === 8, JSON.stringify({ free: s.free, forecast: s.forecast }));

    // Schließen: Kasse wird entnommen, Personal weg.
    db.saveCompany({ ...db.getCompany(cid), kasse: 700 });
    bookings = [];
    r = await company.close(G, U, t0);
    check('Schließen entnimmt die Kasse (eine Buchung) und räumt auf',
      r.ok && bookings.length === 1 && bookings[0].amount === 700 && company.ownCompany(G, U) === null
      && db.getEmployment(G, P) === null && db.companyStaff(cid).length === 0);
    check('ohne Firma: status null', company.status(G, U, t0) === null);
  }
```

- [ ] **Step 2: Scheitern prüfen**

```bash
rm -rf .testdata && DATA_DIR=.testdata node test/company.test.js 2>&1 | grep -m1 "TypeError"
```

Erwartet: `company.advertise is not a function`.

- [ ] **Step 3: Aktionen in `company.js`**

Vor `module.exports`:

```js
// --------------------------------------------------------- Inhaber-Aktionen

/** Zeit aus dem gemeinsamen Tagesbudget (§15: eine Bremse, nicht zwei). */
function useTime(guildId, userId, cost, now) {
  return require('./creator').useTime(guildId, userId, cost, now);
}

/** Firma des Inhabers nach Abrechnung – oder null (auch wenn gerade insolvent geworden). */
function fresh(guildId, userId, now) {
  const c = db.getOpenCompany(guildId, userId);
  if (!c) return null;
  settle(c.id, now);
  const after = db.getCompany(c.id);
  if (!after || after.status !== 'open') return null;
  return { company: after, branch: branch(after.branch), staff: db.companyStaff(after.id) };
}

/** Werbung: kostet 5 % des Gründungspreises aus der Kasse und Zeit; 3 Tage +0,25 aufs Ziel. */
async function advertise(guildId, userId, now = Date.now()) {
  const ctx = fresh(guildId, userId, now);
  if (!ctx) return { ok: false, reason: 'no_company' };
  const { company: c, branch: b } = ctx;
  if (c.werbung_until > now) return { ok: false, reason: 'running', until: c.werbung_until };
  const cost = Math.round(b.price * data.WERBUNG_COST_SHARE);
  if (c.kasse < cost) return { ok: false, reason: 'kasse', cost, kasse: c.kasse };
  const time = useTime(guildId, userId, data.TIME_WERBUNG, now);
  if (!time.ok) return { ok: false, reason: 'no_time', need: data.TIME_WERBUNG, ...time };
  const until = now + data.WERBUNG_DAYS * DAY_MS;
  db.saveCompany({ ...c, kasse: c.kasse - cost, werbung_until: until });
  return { ok: true, cost, until, time };
}

/** Selbst anpacken: eine Schicht als Schichtleiter, ohne Lohn, höchstens 4 je Tag. */
async function pitchIn(guildId, userId, now = Date.now()) {
  const ctx = fresh(guildId, userId, now);
  if (!ctx) return { ok: false, reason: 'no_company' };
  const { company: c, branch: b } = ctx;
  const day = dayKey(now);
  const done = c.pitch_day === day ? c.pitch_today : 0;
  if (done >= data.MAX_PITCH_PER_DAY) return { ok: false, reason: 'limit', done, max: data.MAX_PITCH_PER_DAY };
  const time = useTime(guildId, userId, data.TIME_ANPACKEN, now);
  if (!time.ok) return { ok: false, reason: 'no_time', need: data.TIME_ANPACKEN, ...time };
  const umsatz = Math.round(b.umsatz * rankOf(data.RANKS.length - 1).factor * c.auslastung);
  db.saveCompany({ ...c, kasse: c.kasse + umsatz, pitch_day: day, pitch_today: done + 1 });
  return { ok: true, umsatz, done: done + 1, max: data.MAX_PITCH_PER_DAY, time };
}

/** Gewinn entnehmen – Umbuchung, keine Steuer, kein Level-Zuschlag. */
async function withdraw(guildId, userId, amount, now = Date.now()) {
  const ctx = fresh(guildId, userId, now);
  if (!ctx) return { ok: false, reason: 'no_company' };
  const c = ctx.company;
  const value = Math.floor(Number(amount) || 0);
  if (value <= 0) return { ok: false, reason: 'amount' };
  if (value > c.kasse) return { ok: false, reason: 'kasse', kasse: c.kasse };
  db.saveCompany({ ...c, kasse: c.kasse - value });
  const balance = await changeCash(guildId, userId, value, `Entnahme: ${c.name}`,
    { tax: false, kind: 'company' });
  return { ok: true, amount: value, balance, kasse: c.kasse - value };
}

/** Kapital einzahlen – von Bargeld (notfalls Bank), setzt die Minus-Uhr zurück. */
async function deposit(guildId, userId, amount, now = Date.now()) {
  const ctx = fresh(guildId, userId, now);
  if (!ctx) return { ok: false, reason: 'no_company' };
  const c = ctx.company;
  const value = Math.floor(Number(amount) || 0);
  if (value <= 0) return { ok: false, reason: 'amount' };
  const balance = await getBalance(guildId, userId);
  if (balance.total < value) return { ok: false, reason: 'funds', have: balance.total };
  if (balance.cash < value) {
    await unb.withdrawFromBank(guildId, userId, value - balance.cash, `Einzahlung: ${c.name}`);
  }
  const after = await changeCash(guildId, userId, -value, `Einzahlung: ${c.name}`, { kind: 'company' });
  const current = db.getCompany(c.id);                 // frisch lesen: die Buchung hat gewartet
  const kasse = current.kasse + value;
  db.saveCompany({ ...current, kasse, negative_since: kasse < 0 ? current.negative_since : 0 });
  return { ok: true, amount: value, balance: after, kasse };
}

/** Rang ±1, geklemmt auf 0…2; bei Spielern auch employment.rank. */
function promote(guildId, userId, staffId, delta) {
  const ctx = ownerContext(guildId, userId);
  if (!ctx) return { ok: false, reason: 'no_company' };
  const s = db.staffById(staffId);
  if (!s || s.company_id !== ctx.company.id) return { ok: false, reason: 'not_found' };
  const rank = s.rank + Math.sign(delta);
  if (rank < 0 || rank >= data.RANKS.length) return { ok: false, reason: 'range', rank: rankOf(s.rank) };
  db.saveStaff({ ...s, rank });
  if (s.kind === 'player') db.promote(guildId, s.user_id, rank, db.getEmployment(guildId, s.user_id)?.shifts ?? 0);
  return { ok: true, staff: { ...s, rank }, rank: rankOf(rank) };
}

/** Prämie aus der Kasse an einen Spieler-Angestellten – eine Buchung. */
async function bonus(guildId, userId, staffId, amount, now = Date.now()) {
  const ctx = fresh(guildId, userId, now);
  if (!ctx) return { ok: false, reason: 'no_company' };
  const c = ctx.company;
  const s = db.staffById(staffId);
  if (!s || s.company_id !== c.id) return { ok: false, reason: 'not_found' };
  if (s.kind !== 'player') return { ok: false, reason: 'not_player' };
  const value = Math.floor(Number(amount) || 0);
  if (value <= 0) return { ok: false, reason: 'amount' };
  if (value > c.kasse) return { ok: false, reason: 'kasse', kasse: c.kasse };
  db.saveCompany({ ...c, kasse: c.kasse - value });
  await changeCash(guildId, s.user_id, value, `Prämie: ${c.name}`, { kind: 'job' });
  return { ok: true, amount: value, staff: s };
}

/** Freiwillig schließen: Kasse (wenn positiv) entnehmen, dann aufräumen. */
async function close(guildId, userId, now = Date.now()) {
  const ctx = fresh(guildId, userId, now);
  if (!ctx) return { ok: false, reason: 'no_company' };
  const c = ctx.company;
  const payout = Math.max(0, Math.round(c.kasse));
  const closed = closeCompany(guildId, c.id, now, 'closed');
  const balance = payout > 0
    ? await changeCash(guildId, userId, payout, `Auflösung: ${c.name}`, { tax: false, kind: 'company' })
    : null;
  return { ok: true, company: closed, payout, balance };
}

// ------------------------------------------------------------------ Anzeige

/** Alles, was die Firmenansicht wissen muss – nach Abrechnung. */
function status(guildId, userId, now = Date.now()) {
  const ctx = fresh(guildId, userId, now);
  if (!ctx) return null;
  const { company: c, branch: b, staff } = ctx;
  const day = dayKey(now);
  // Prognose: was die heutige Besetzung bei heutiger Auslastung am Tag bringt.
  const forecast = staff.filter((s) => s.kind === 'npc').reduce((sum, s) => {
    const f = rankOf(s.rank).factor;
    return sum + data.NPC_SHIFTS * (Math.round(b.umsatz * f * c.auslastung) - Math.round(b.lohn * f));
  }, 0);
  const minusDays = c.negative_since ? Math.floor((now - c.negative_since) / DAY_MS) : 0;
  return {
    company: c, branch: b, staff,
    free: b.slots - staff.length,
    kasse: c.kasse, auslastung: c.auslastung,
    werbungMs: Math.max(0, c.werbung_until - now),
    minusDays, daysLeft: c.negative_since ? Math.max(0, data.INSOLVENCY_DAYS - minusDays) : null,
    pitchLeft: data.MAX_PITCH_PER_DAY - (c.pitch_day === day ? c.pitch_today : 0),
    budget: require('./creator').budget(guildId, userId, now),
    ceiling: ceilingOf(b), forecast,
    werbungCost: Math.round(b.price * data.WERBUNG_COST_SHARE),
  };
}
```

Exporte ergänzen: `advertise, pitchIn, withdraw, deposit, promote, bonus, close, status, fresh,`.

- [ ] **Step 4: Tests grün**

```bash
rm -rf .testdata && DATA_DIR=.testdata node test/company.test.js 2>&1 | tail -1; npm test 2>&1 | grep -c '❌'
```

Erwartet: `0 fehlgeschlagen`, `0`.

- [ ] **Step 5: Commit**

```bash
git add src/company.js test/company.test.js
git commit -m "$(printf 'firmen: inhaber-aktionen – werbung, anpacken, entnahme, einzahlung, rang, praemie, schliessen\n\nCo-Authored-By: Claude Opus 5 <noreply@anthropic.com>')"
```

---

### Task 5: Ansichten, Handler, Menü

**Files:**
- Modify: `src/menu.js` (Eintrag nach `jobs`), `src/ui.js` (neue Ansichten; `buildJobCenterView`), `src/buttons.js` (Handler, Modals, `apply`-Texte, `shiftResult`)
- Test: `test/menu.test.js` läuft unverändert; kein eigener UI-Test.

**Interfaces:**
- Consumes: alles aus Task 1–4 (`company.status`, `openings`, Aktionen), `jobs.apply` mit `firma:`-Jobs.
- Produces: `ui.buildFirmaView({ guildId, userId })`, `ui.buildFirmaStaffView({ guildId, userId })`; Buttons `firma|<aktion>|<arg>|<userId>` mit `aktion ∈ {werbung, anpacken, entnehmen, einzahlen, personal, npc, schliessen, gruenden}`; `fstaff|<aktion>|<staffId>|<userId>` mit `aktion ∈ {up, down, fire, bonus}`; Modals `fname|<branch>|<userId>` (Feld `name`), `fbetrag|<modus>|<userId>` (Feld `amount`, `modus ∈ {entnehmen, einzahlen}`), `fpraemie|<staffId>|<userId>` (Feld `amount`).

- [ ] **Step 1: Menü-Eintrag**

In `src/menu.js` nach dem Eintrag `jobs`:

```js
  {
    id: 'firma',
    group: 'work',
    label: 'Firma',
    emoji: '🏢',
    description: 'Gründen, Personal führen, Gewinn entnehmen',
    style: 'primary',
    build: (ctx) => ui.buildFirmaView(ctx),
  },
```

- [ ] **Step 2: Ansichten in `ui.js`**

Vor `buildGarageView` einfügen:

```js
// ------------------------------------------------------------------- Firma

/** Balken für die Auslastung (10 Felder). */
function auslastungBar(a) {
  const n = Math.round(Math.max(0, Math.min(1, a)) * 10);
  return `${'▰'.repeat(n)}${'▱'.repeat(10 - n)} ${Math.round(a * 100)} %`;
}

/** Ohne Firma: die drei Branchen zur Wahl. */
async function buildFirmaFoundView({ guildId, userId }) {
  const company = require('./company');
  const symbol = await getSymbol(guildId);
  const embed = new EmbedBuilder()
    .setTitle('🏢 Eine Firma gründen')
    .setColor(0x34495e)
    .setDescription(
      'Deine eigene Firma: Personal einstellen, Kasse im Plus halten, Gewinn entnehmen. '
      + 'NPCs kosten jeden Tag Lohn, ob Kundschaft da ist oder nicht – Spieler nur für '
      + 'gearbeitete Schichten. Läuft die Kasse **14 Tage** im Minus, ist die Firma insolvent.\n\n'
      + '_Werbung und Anpacken kosten Zeit aus demselben Tagesbudget wie Streams und Studio._');
  for (const b of company.BRANCHES) {
    const c = company.ceilingOf(b);
    embed.addFields({
      name: `${b.emoji} ${b.name} – ${money(symbol, b.price)}`,
      value: `_${b.blurb}_\n**${b.slots}** Plätze · Umsatz **${money(symbol, b.umsatz)}** / Lohn `
        + `**${money(symbol, b.lohn)}** je Schicht · Decke ~**${money(symbol, c.net)}** am Tag`,
    });
  }
  return {
    embeds: [embed],
    components: [
      new ActionRowBuilder().addComponents(...company.BRANCHES.map((b) =>
        new ButtonBuilder().setCustomId(`firma|gruenden|${b.id}|${userId}`)
          .setLabel(b.name).setEmoji(b.emoji).setStyle(ButtonStyle.Success))),
      new ActionRowBuilder().addComponents(homeButton(userId)),
    ],
  };
}

/** Mit Firma: die Betriebsansicht. */
async function buildFirmaView({ guildId, userId }) {
  const company = require('./company');
  const s = company.status(guildId, userId);
  if (!s) return buildFirmaFoundView({ guildId, userId });
  const symbol = await getSymbol(guildId);
  const fmt = require('./income').formatRemaining;

  const embed = new EmbedBuilder()
    .setTitle(`${s.branch.emoji} ${s.company.name}`)
    .setColor(s.kasse < 0 ? 0xe74c3c : 0x2ecc71)
    .setDescription(`${s.branch.name} · seit ${new Date(s.company.founded_at).toLocaleDateString('de-DE')}`)
    .addFields(
      { name: '💰 Kasse', value: `**${money(symbol, s.kasse)}**`, inline: true },
      { name: '📈 Auslastung', value: auslastungBar(s.auslastung), inline: true },
      {
        name: '👥 Personal',
        value: `${s.staff.length}/${s.branch.slots} Plätze\n_Prognose heute: ${s.forecast >= 0 ? '+' : ''}${money(symbol, s.forecast)}_`,
        inline: true,
      },
    );

  if (s.kasse < 0) {
    embed.addFields({
      name: '⚠️ Kasse im Minus',
      value: `Noch **${s.daysLeft} Tage** bis zur Insolvenz. Unbezahlte Angestellte kündigen nach `
        + `${require('./data/companies').NPC_QUIT_AFTER_UNPAID} Tagen. Zahl Kapital ein oder entlasse Leute.`,
    });
  }
  if (s.werbungMs > 0) {
    embed.addFields({ name: '📣 Werbung läuft', value: `noch ${fmt(s.werbungMs)}` });
  }
  if (s.staff.length) {
    const identity = require('./identity');
    embed.addFields({
      name: 'Belegschaft',
      value: s.staff.slice(0, 10).map((st) => {
        const r = company.rankOf(st.rank);
        const who = st.kind === 'npc' ? st.name : `👤 ${identity.nameOf(st.user_id) ?? 'Spieler'}`;
        return `${r.emoji} ${who} – ${r.name} · ${st.shifts} Schichten`
          + (st.unpaid_days ? ` · ⚠️ ${st.unpaid_days} Tage unbezahlt` : '');
      }).join('\n'),
    });
  }
  embed.addFields({
    name: '⏳ Heute',
    value: `Zeit: **${s.budget.left}** von ${s.budget.max} · Anpacken noch **${s.pitchLeft}×** · `
      + `Werbung kostet ${money(symbol, s.werbungCost)}`,
  });
  embed.setFooter({ text: `Decke ohne Ausbau: ~${money(symbol, s.ceiling.net)} am Tag` });

  const ready = (cost) => s.budget.left >= cost;
  const data = require('./data/companies');
  const rows = [
    new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId(`firma|werbung|0|${userId}`)
        .setLabel(`Werbung (${data.TIME_WERBUNG})`).setEmoji('📣').setStyle(ButtonStyle.Primary)
        .setDisabled(s.werbungMs > 0 || s.kasse < s.werbungCost || !ready(data.TIME_WERBUNG)),
      new ButtonBuilder().setCustomId(`firma|anpacken|0|${userId}`)
        .setLabel(`Anpacken (${data.TIME_ANPACKEN})`).setEmoji('🧑‍🔧').setStyle(ButtonStyle.Primary)
        .setDisabled(s.pitchLeft <= 0 || !ready(data.TIME_ANPACKEN)),
      new ButtonBuilder().setCustomId(`firma|entnehmen|0|${userId}`)
        .setLabel('Entnehmen').setEmoji('💸').setStyle(ButtonStyle.Success)
        .setDisabled(s.kasse <= 0),
      new ButtonBuilder().setCustomId(`firma|einzahlen|0|${userId}`)
        .setLabel('Einzahlen').setEmoji('🏦').setStyle(ButtonStyle.Secondary)),
    new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId(`firma|personal|0|${userId}`)
        .setLabel('Personal').setEmoji('👥').setStyle(ButtonStyle.Secondary),
      new ButtonBuilder().setCustomId(`firma|schliessen|0|${userId}`)
        .setLabel('Schließen').setEmoji('🔒').setStyle(ButtonStyle.Danger),
      homeButton(userId)),
  ];
  return { embeds: [embed], components: rows };
}

/** Personal führen: je Angestellter befördern, zurückstufen, entlassen, Prämie. */
async function buildFirmaStaffView({ guildId, userId }) {
  const company = require('./company');
  const identity = require('./identity');
  const s = company.status(guildId, userId);
  if (!s) return buildFirmaFoundView({ guildId, userId });
  const symbol = await getSymbol(guildId);

  const embed = new EmbedBuilder()
    .setTitle(`👥 Personal – ${s.company.name}`)
    .setColor(0x34495e)
    .setDescription(`${s.staff.length}/${s.branch.slots} Plätze belegt · Lohn je Schicht: `
      + company.RANKS.map((r) => `${r.emoji} ${r.name} ${money(symbol, Math.round(s.branch.lohn * r.factor))}`).join(' · ')
      + '\n_NPCs arbeiten 3 Schichten am Tag, Spieler bis zu 4 – und bringen 30 % mehr Umsatz._');

  const rows = [];
  for (const st of s.staff.slice(0, 4)) {
    const r = company.rankOf(st.rank);
    const who = st.kind === 'npc' ? st.name : (identity.nameOf(st.user_id) ?? 'Spieler');
    embed.addFields({
      name: `${st.kind === 'npc' ? '🤖' : '👤'} ${who} · ${r.emoji} ${r.name}`,
      value: `${st.shifts} Schichten` + (st.unpaid_days ? ` · ⚠️ ${st.unpaid_days} Tage unbezahlt` : ''),
    });
    rows.push(new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId(`fstaff|up|${st.id}|${userId}`).setLabel(who.slice(0, 20))
        .setEmoji('⬆️').setStyle(ButtonStyle.Secondary).setDisabled(st.rank >= company.RANKS.length - 1),
      new ButtonBuilder().setCustomId(`fstaff|down|${st.id}|${userId}`).setLabel('Zurückstufen')
        .setEmoji('⬇️').setStyle(ButtonStyle.Secondary).setDisabled(st.rank <= 0),
      new ButtonBuilder().setCustomId(`fstaff|bonus|${st.id}|${userId}`).setLabel('Prämie')
        .setEmoji('💶').setStyle(ButtonStyle.Success).setDisabled(st.kind !== 'player' || s.kasse <= 0),
      new ButtonBuilder().setCustomId(`fstaff|fire|${st.id}|${userId}`).setLabel('Entlassen')
        .setEmoji('❌').setStyle(ButtonStyle.Danger)));
  }
  if (s.staff.length > 4) {
    embed.setFooter({ text: `Nur die ersten 4 von ${s.staff.length} lassen sich hier bearbeiten.` });
  }
  rows.push(new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId(`firma|npc|0|${userId}`).setLabel('NPC einstellen')
      .setEmoji('🤖').setStyle(ButtonStyle.Primary).setDisabled(s.free <= 0),
    new ButtonBuilder().setCustomId(ID.menu('firma', 1, userId)).setLabel('Firma')
      .setEmoji('🏢').setStyle(ButtonStyle.Secondary),
    homeButton(userId)));
  return { embeds: [embed], components: rows };
}
```

Discord erlaubt höchstens 5 Zeilen à 5 Buttons – deshalb 4 Angestellte je Ansicht plus die Navigationszeile. (Der volle Personalstand steht in der Betriebsansicht; Bearbeiten der Plätze 5–10 kommt mit Stück 2.)

Im **Arbeitsamt** (`buildJobCenterView`): nach der `setDescription(...)`-Kette und vor `const applyRow` einfügen:

```js
  // Firmen auf diesem Server – Stellen bei anderen Spielern.
  const company = require('./company');
  const firmen = company.openings(guildId).filter((o) => o.company.owner_id !== String(userId)).slice(0, 5);
  if (firmen.length) {
    const identity = require('./identity');
    embed.addFields({
      name: '🏢 Firmen auf diesem Server',
      value: firmen.map((o) =>
        `${o.branch.emoji} **${o.company.name}** (${identity.nameOf(o.company.owner_id) ?? 'Spieler'}) — `
        + `${money(symbol, o.lohn)} / Schicht · ${o.free} frei`).join('\n'),
    });
  }
```

und die Komponenten um eine Zeile ergänzen (nur wenn `firmen.length`): 

```js
  const firmaRow = firmen.length ? new ActionRowBuilder().addComponents(...firmen.map((o) =>
    new ButtonBuilder().setCustomId(`apply|${o.jobId}|${userId}`)
      .setLabel(o.company.name.slice(0, 40)).setEmoji(o.branch.emoji)
      .setStyle(ButtonStyle.Success).setDisabled(current?.job.id === o.jobId))) : null;
  return { embeds: [embed], components: [applyRow, firmaRow, actions].filter(Boolean) };
```

Und im Block „Deine Anstellung": wenn `current.job.company`, statt Beförderungschance den Firmenrang zeigen:

```js
        if (current.job.company) {
          const st = require('./db').staffByUser(current.job.company.id, userId);
          const r = require('./company').rankOf(st?.rank ?? 0);
          return `${current.job.emoji} **${current.job.title}** (Firma) · `
            + `${money(symbol, Math.round(current.job.pay * r.factor))} pro Schicht\n`
            + `${r.emoji} **${r.name}** – befördert wird vom Inhaber\n`
            + `${emp.shifts} Schichten insgesamt · ${money(symbol, emp.earned)} verdient`;
        }
```

(direkt am Anfang der IIFE `(() => { … })()` dort, vor `const ranks = …`.)

Exporte: `buildFirmaView, buildFirmaFoundView, buildFirmaStaffView`.

- [ ] **Step 3: Handler in `buttons.js`**

Am Import oben `buildFirmaView, buildFirmaStaffView` ergänzen. In `apply` die Texte um `owner: '❌ In deiner eigenen Firma bist du der Chef, nicht der Angestellte.'`, `full: '❌ Dort ist gerade kein Platz frei.'`, `closed: '❌ Diese Firma gibt es nicht mehr.'` erweitern; nach dem Erfolgs-Embed zusätzlich `buildEntryView('jobs', …)` wie bisher. In `shiftResult` für `result.reason === 'kasse'`: `'💸 Die Kasse deckt deinen Lohn nicht – sprich mit dem Inhaber.'`; im Erfolgs-Embed, wenn `result.company`: Titel `${result.job.emoji} Schicht bei ${result.company.name}` und Feld `{ name: 'Umsatz für die Firma', value: money(symbol, result.umsatz), inline: true }`; `companyRank` als Footer `${rank.emoji} ${rank.name} – befördert wird vom Inhaber`.

Handler (im `Object.assign(buttons, { … })`-Block, z. B. nach `mreveal`):

```js
  /** Firma: Aktionen des Inhabers. */
  async firma(interaction, [aktion, arg]) {
    const guildId = gid(interaction);
    const userId = uid(interaction);
    const company = require('./company');
    const symbol = await getSymbol(guildId);
    const fmt = require('./income').formatRemaining;

    if (aktion === 'gruenden') {
      const b = company.branch(arg);
      if (!b) return interaction.reply({ content: '❌ Diese Branche gibt es nicht.', flags: MessageFlags.Ephemeral });
      const modal = new ModalBuilder().setCustomId(`fname|${b.id}|${userId}`).setTitle(`${b.name} gründen`);
      modal.addComponents(new ActionRowBuilder().addComponents(
        new TextInputBuilder().setCustomId('name').setLabel('Name der Firma (2–32 Zeichen)')
          .setStyle(TextInputStyle.Short).setMinLength(2).setMaxLength(32).setRequired(true)));
      return interaction.showModal(modal);
    }
    if (aktion === 'entnehmen' || aktion === 'einzahlen') {
      const modal = new ModalBuilder().setCustomId(`fbetrag|${aktion}|${userId}`)
        .setTitle(aktion === 'entnehmen' ? 'Gewinn entnehmen' : 'Kapital einzahlen');
      modal.addComponents(new ActionRowBuilder().addComponents(
        new TextInputBuilder().setCustomId('amount').setLabel('Betrag (oder „alles")')
          .setStyle(TextInputStyle.Short).setRequired(true)));
      return interaction.showModal(modal);
    }

    await interaction.deferUpdate();
    let note = null;
    if (aktion === 'werbung') {
      const r = await company.advertise(guildId, userId);
      note = r.ok ? `📣 Werbung geschaltet für ${money(symbol, r.cost)} – drei Tage mehr Kundschaft.`
        : { no_company: '🏢 Du hast keine Firma.', running: '📣 Die Kampagne läuft noch.',
          kasse: `💸 Dafür fehlen ${money(symbol, r.cost ?? 0)} in der Kasse.`,
          no_time: `😴 Werbung kostet **${r.need}** Zeit, übrig sind **${r.left}**.` }[r.reason] ?? '❌ Das ging nicht.';
    } else if (aktion === 'anpacken') {
      const r = await company.pitchIn(guildId, userId);
      note = r.ok ? `🧑‍🔧 Selbst angepackt: **${money(symbol, r.umsatz)}** Umsatz für die Firma (${r.done}/${r.max} heute).`
        : { no_company: '🏢 Du hast keine Firma.', limit: '🛌 Für heute reicht es – vier Schichten sind das Maximum.',
          no_time: `😴 Anpacken kostet **${r.need}** Zeit, übrig sind **${r.left}**.` }[r.reason] ?? '❌ Das ging nicht.';
    } else if (aktion === 'npc') {
      const r = company.hireNpc(guildId, userId);
      note = r.ok ? `🤖 **${r.staff.name}** fängt morgen an (noch ${r.free} Plätze frei).`
        : r.reason === 'full' ? '❌ Kein Platz mehr – entlasse zuerst jemanden.' : '🏢 Du hast keine Firma.';
      await interaction.editReply(await buildFirmaStaffView({ guildId, userId }));
      if (note) await interaction.followUp({ content: note, flags: MessageFlags.Ephemeral }).catch(() => {});
      return;
    } else if (aktion === 'personal') {
      return interaction.editReply(await buildFirmaStaffView({ guildId, userId }));
    } else if (aktion === 'schliessen') {
      if (arg !== 'ja') {
        return interaction.editReply({
          embeds: [new EmbedBuilder().setTitle('🔒 Firma schließen?').setColor(0xe74c3c)
            .setDescription('Die Kasse wird ausgezahlt, das Personal geht, die Gründung ist weg. Sicher?')],
          components: [new ActionRowBuilder().addComponents(
            new ButtonBuilder().setCustomId(`firma|schliessen|ja|${userId}`).setLabel('Ja, schließen')
              .setEmoji('🔒').setStyle(ButtonStyle.Danger),
            new ButtonBuilder().setCustomId(ID.menu('firma', 1, userId)).setLabel('Abbrechen')
              .setStyle(ButtonStyle.Secondary))],
        });
      }
      const r = await company.close(guildId, userId);
      note = r.ok ? `🔒 **${r.company.name}** ist geschlossen. ${r.payout > 0 ? `Ausgezahlt: ${money(symbol, r.payout)}.` : ''}`
        : '🏢 Du hast keine Firma.';
    }
    await interaction.editReply(await buildFirmaView({ guildId, userId }));
    if (note) await interaction.followUp({ content: note, flags: MessageFlags.Ephemeral }).catch(() => {});
  },

  /** Firma: Personal führen. */
  async fstaff(interaction, [aktion, staffId]) {
    const guildId = gid(interaction);
    const userId = uid(interaction);
    const company = require('./company');
    const symbol = await getSymbol(guildId);

    if (aktion === 'bonus') {
      const modal = new ModalBuilder().setCustomId(`fpraemie|${staffId}|${userId}`).setTitle('Prämie zahlen');
      modal.addComponents(new ActionRowBuilder().addComponents(
        new TextInputBuilder().setCustomId('amount').setLabel('Betrag aus der Kasse')
          .setStyle(TextInputStyle.Short).setRequired(true)));
      return interaction.showModal(modal);
    }

    await interaction.deferUpdate();
    let note = null;
    if (aktion === 'up' || aktion === 'down') {
      const r = company.promote(guildId, userId, Number(staffId), aktion === 'up' ? 1 : -1);
      note = r.ok ? `${r.rank.emoji} Jetzt **${r.rank.name}** – Umsatz und Lohn ×${r.rank.factor}.`
        : r.reason === 'range' ? 'ℹ️ Weiter geht es nicht.' : '❌ Nicht gefunden.';
    } else if (aktion === 'fire') {
      const r = company.fire(guildId, userId, Number(staffId));
      note = r.ok ? `❌ ${r.staff.kind === 'npc' ? r.staff.name : 'Der Angestellte'} ist entlassen.` : '❌ Nicht gefunden.';
    }
    await interaction.editReply(await buildFirmaStaffView({ guildId, userId }));
    if (note) await interaction.followUp({ content: note, flags: MessageFlags.Ephemeral }).catch(() => {});
  },
```

Modals (im `modals`-Objekt):

```js
  /** Firmenname eingegeben – gründen. */
  async fname(interaction, [branchId]) {
    await interaction.deferUpdate();
    const guildId = gid(interaction);
    const userId = uid(interaction);
    const company = require('./company');
    const symbol = await getSymbol(guildId);
    const r = await company.found(guildId, userId, branchId, interaction.fields.getTextInputValue('name'));
    const note = r.ok
      ? `🏢 **${r.company.name}** ist gegründet (${money(symbol, r.branch.price)}). Stell Personal ein – ohne Leute läuft nur der Notbetrieb.`
      : { name: '❌ Der Name muss 2–32 Zeichen haben, ohne @.', already: 'ℹ️ Du hast schon eine Firma.',
        funds: `💸 Dafür fehlen ${money(symbol, (r.needed ?? 0) - (r.have ?? 0))}.`,
        unknown_branch: '❌ Diese Branche gibt es nicht.', payment: '❌ Die Buchung ist fehlgeschlagen – nichts ist passiert.' }[r.reason]
        ?? '❌ Das ging nicht.';
    await interaction.editReply(await buildFirmaView({ guildId, userId }));
    await interaction.followUp({ content: note, flags: MessageFlags.Ephemeral }).catch(() => {});
  },

  /** Betrag für Entnahme/Einzahlung eingegeben. */
  async fbetrag(interaction, [modus]) {
    await interaction.deferUpdate();
    const guildId = gid(interaction);
    const userId = uid(interaction);
    const company = require('./company');
    const symbol = await getSymbol(guildId);
    const raw = String(interaction.fields.getTextInputValue('amount') ?? '').trim().toLowerCase();
    let amount = Number(raw.replace(/[.\s]/g, '').replace(',', '.'));
    if (raw === 'alles') {
      const s = company.status(guildId, userId);
      amount = modus === 'entnehmen' ? (s?.kasse ?? 0) : (await require('./unb').getBalance(guildId, userId)).total;
    }
    const r = modus === 'entnehmen'
      ? await company.withdraw(guildId, userId, amount) : await company.deposit(guildId, userId, amount);
    const note = r.ok
      ? (modus === 'entnehmen' ? `💸 **${money(symbol, r.amount)}** entnommen. Kasse: ${money(symbol, r.kasse)}.`
        : `🏦 **${money(symbol, r.amount)}** eingezahlt. Kasse: ${money(symbol, r.kasse)}.`)
      : { amount: '❌ Bitte einen Betrag über 0.', kasse: '💸 So viel ist nicht in der Kasse.',
        funds: '💸 So viel hast du nicht.', no_company: '🏢 Du hast keine Firma.' }[r.reason] ?? '❌ Das ging nicht.';
    await interaction.editReply(await buildFirmaView({ guildId, userId }));
    await interaction.followUp({ content: note, flags: MessageFlags.Ephemeral }).catch(() => {});
  },

  /** Prämie eingegeben. */
  async fpraemie(interaction, [staffId]) {
    await interaction.deferUpdate();
    const guildId = gid(interaction);
    const userId = uid(interaction);
    const company = require('./company');
    const symbol = await getSymbol(guildId);
    const amount = Number(String(interaction.fields.getTextInputValue('amount') ?? '').replace(/[.\s]/g, '').replace(',', '.'));
    const r = await company.bonus(guildId, userId, Number(staffId), amount);
    const note = r.ok ? `💶 Prämie von **${money(symbol, r.amount)}** gezahlt.`
      : { amount: '❌ Bitte einen Betrag über 0.', kasse: '💸 So viel ist nicht in der Kasse.',
        not_player: 'ℹ️ Prämien gibt es nur für Spieler – NPCs sind mit dem Lohn zufrieden.',
        not_found: '❌ Nicht gefunden.' }[r.reason] ?? '❌ Das ging nicht.';
    await interaction.editReply(await buildFirmaStaffView({ guildId, userId }));
    await interaction.followUp({ content: note, flags: MessageFlags.Ephemeral }).catch(() => {});
  },
```

Hinweis zu `interaction.reply` im `gruenden`-Zweig: die anderen Handler nutzen `deferUpdate` + `followUp`; für den Fehlerfall vor dem Modal ist `reply` mit `Ephemeral` das Muster aus `apply`.

- [ ] **Step 4: Laden, Menü-Test, volle Kette**

```bash
node -e "require('./src/ui'); require('./src/buttons'); require('./src/fluxer/commands'); console.log('ok')" && rm -rf .testdata && DATA_DIR=.testdata node test/menu.test.js 2>&1 | grep -i "firma\|fehlgeschlagen" && npm test 2>&1 | grep -c '❌'
```

Erwartet: `ok`, `firma: gültige Ansicht` ✅ und Weg zurück ✅, `0`.

- [ ] **Step 5: Commit**

```bash
git add src/menu.js src/ui.js src/buttons.js
git commit -m "$(printf 'firmen: ansichten und handler – gruenden, betrieb, personal, arbeitsamt-rubrik\n\nCo-Authored-By: Claude Opus 5 <noreply@anthropic.com>')"
```

---

### Task 6: Decke, Messung, Werte ziehen, Patchnotes, Architektur

**Files:**
- Test: `test/company.test.js`
- Modify: `scripts/messung-geldquellen.js`, `src/data/companies.js` (nur Zahlen, falls die Messung es verlangt), `src/data/patchnotes.js`, `ARCHITEKTUR.md`

**Interfaces:**
- Consumes: alles.

- [ ] **Step 1: Test 11 – Decke im Vollbetrieb**

Vor der Abschlusszeile:

```js
  console.log('--- §3: kein Tag über der Decke ---');
  {
    for (const b of data.BRANCHES) {
      const U = user(); funds(U, 0, 50_000_000);
      const f = await company.found(G, U, b.id, `Voll-${b.id}`, t0);
      for (let i = 0; i < b.slots; i++) company.hireNpc(G, U, t0, seq(0.02 * i));
      for (const s of db.companyStaff(f.company.id)) db.saveStaff({ ...s, rank: 2 });
      const decke = company.ceilingOf(b).net;
      let best = -Infinity, gewinn = [];
      let now = t0;
      for (let d = 0; d < 365; d++) {
        const vor = db.getCompany(f.company.id).kasse;
        await company.advertise(G, U, now);
        for (let i = 0; i < data.MAX_PITCH_PER_DAY; i++) await company.pitchIn(G, U, now + i * 60e3);
        company.settle(f.company.id, now + DAY_MS);
        const tag = db.getCompany(f.company.id).kasse - vor;
        best = Math.max(best, tag); gewinn.push(tag);
        now += DAY_MS;
      }
      const sorted = [...gewinn].sort((a, c) => a - c);
      const median = sorted[Math.floor(sorted.length / 2)];
      console.log(`    ${b.emoji} ${b.name}: Median ${de(median)}/Tag · bester Tag ${de(best)} · Decke ${de(decke)}`);
      check(`${b.name}: kein Tag über der Decke`, best <= decke, `${de(best)} > ${de(decke)}`);
      check(`${b.name}: die Firma verdient (keine stille Null)`, median > 0, de(median));
    }
  }
```

Hinweis: `pitchIn` kostet je 2 Zeit, Werbung 2 → 4 × 2 + 2 = 10 > 8 Budget. Im Test kommen also nur 3 Anpacken je Tag durch – **die Decke bleibt trotzdem die harte Grenze** (sie rechnet mit 4). Das ist gewollt: Die Decke ist eine Obergrenze, keine Prognose.

- [ ] **Step 2: Test laufen lassen und die drei Median-Zeilen notieren**

```bash
rm -rf .testdata && DATA_DIR=.testdata node test/company.test.js 2>&1 | grep -A8 "§3"
```

Erwartet: drei Zeilen mit Median/bester Tag/Decke, alle ✅. **Die Mediane wörtlich in den Bericht.** Erwartung aus der Handrechnung bei Auslastung 1,0 (Werbung an, voll besetzt) und 3 Anpacken: Kiosk 2 × 3 × (375 − 150) + 3 × 375 = 1.350 + 1.125 = **2.475**; Café 5 × 3 × (1.350 − 270) + 3 × 1.350 = 16.200 + 4.050 = **20.250**; Spedition 30 × (3.900 − 630) + 3 × 3.900 = 98.100 + 11.700 = **109.800** – Werbung (−6.000/3 Tage beim Café, −60.000/3 Tage bei der Spedition) drückt das um 2.000 bzw. 20.000 je Tag: Café ≈ 18.250, Spedition ≈ 89.800.

- [ ] **Step 3: Messskript – Archetyp Firma**

In `scripts/messung-geldquellen.js` eine Funktion `firmenlauf(branchId, tage)` ergänzen, die denselben Tagesablauf wie Test 11 fährt (Gründung Tag 1, volle NPC-Besetzung als Aushilfen, Beförderung aller auf Schichtleiter nach 30 Tagen, täglich Werbung + Anpacken bis das Zeitbudget alle ist, tägliche Entnahme in `konto[U]`), und im Hauptlauf hinter den beiden vorhandenen Archetypen für jede Branche eine Zeile ausgibt:

```js
  console.log('\n--- Firmen (nicht ausgebaut, Vollbetrieb) ---\n');
  for (const b of require('../src/data/companies').BRANCHES) {
    const r = await firmenlauf(b.id, TAGE);
    console.log(`  ${(b.emoji + ' ' + b.name).padEnd(16)}${de(r.median).padStart(9)}/Tag   ` +
      `Decke ${de(r.decke)}   Amortisation ${r.amortTage} Tage`);
  }
```

`firmenlauf` gibt `{ median, decke, amortTage }` zurück (`amortTage` = erster Tag, an dem die Summe der Entnahmen den Gründungspreis übersteigt). Entnahmen laufen über `company.withdraw` → `unb.changeCash` → das Skript zählt sie in `konto`/`quellen` unter „Entnahme".

- [ ] **Step 4: Messen, Werte ziehen**

```bash
node scripts/messung-geldquellen.js 10 365 2>&1 | grep -A5 "Firmen"
```

Zielmarken (Spec): Kiosk ~2.500, Café ~20.000, Spedition ~70.000 – und alle **unter** der „Musik+Creator"-Zeile derselben Ausgabe. Liegt eine Branche mehr als 25 % daneben, `umsatz` dieser Branche in `src/data/companies.js` anpassen (Lohn unverändert lassen), Test 1 (Handrechnung 113.700) entsprechend nachziehen, erneut messen. **Gemessene Werte wörtlich in den Bericht**, inklusive der Amortisation.

- [ ] **Step 5: Patchnotes und Architektur**

`src/data/patchnotes.js`, oben:

```js
  {
    version: '1.31.0',
    date: '2026-09-12',
    title: '🏢 Eigene Firmen',
    lines: [
      '🏢 **Gründe deine Firma.** Kiosk, Café oder Spedition – zu realistischen Preisen (25.000 / 120.000 / 1,2 Mio). Neuer Menüpunkt unter *Arbeit*.',
      '👥 **Personal.** NPCs kosten jeden Tag Lohn und arbeiten verlässlich; Spieler bewerben sich im Arbeitsamt unter „Firmen auf diesem Server", kosten nur gearbeitete Schichten und bringen 30 % mehr Umsatz. Du beförderst selbst, zahlst Prämien, entlässt.',
      '💰 **Die Kasse ist deine.** Umsatz rein, Löhne raus, Gewinn entnehmen. Löhne sind Verbindlichkeiten: Läuft die Kasse 14 Tage im Minus, ist die Firma insolvent. Einzahlen rettet.',
      '📣 **Werbung und Anpacken** heben die Auslastung – aus demselben Tagesbudget wie Streams und Studio.',
      '📏 **Noch kein Endgame.** Ohne Ausbau bleibt die Decke einer Firma unter Musik+Creator. Der Ausbau (Filialen, Flotte) kommt als Nächstes.',
    ],
  },
```

`ARCHITEKTUR.md` §15: nach der Tabelle einen Absatz:

```markdown
**Firmen (seit 1.31.0, Stück 1 ohne Ausbau):** Die Decke ist je Branche eine
vorgerechnete Zahl (`company.ceilingOf`), geprüft in `test/company.test.js` –
Spedition 113.700/Tag, Café ~24.000, Kiosk ~3.000 bei voller Besetzung mit
Schichtleitern, Werbung und täglichem Anpacken. Gemessen im Vollbetrieb (365
Tage, Median): <gemessene Werte>. Alle unter Musik+Creator; das Endgame kommt
mit dem Ausbau (Stück 2). NPC-Löhne sind eine echte Senke, die Kasse darf ins
Minus (Insolvenz nach 14 Tagen).
```

`<gemessene Werte>` mit den Zahlen aus Step 4 füllen – keine Schätzung.

- [ ] **Step 6: Volle Kette, Commit**

```bash
npm test 2>&1 | grep -c '❌'; npm test 2>&1 | tail -2
```

```bash
git add test/company.test.js scripts/messung-geldquellen.js src/data/companies.js src/data/patchnotes.js ARCHITEKTUR.md
git commit -m "$(printf 'firmen: decke geprueft, messung, patchnotes 1.31.0\n\nGemessen (365 Tage, Median): Kiosk <ZAHL>, Cafe <ZAHL>, Spedition <ZAHL> je Tag.\n\nCo-Authored-By: Claude Opus 5 <noreply@anthropic.com>')"
```

`<ZAHL>` aus der Messung.

---

## Selbstprüfung des Plans

**Spec-Abdeckung:** Datenmodell + Branchen + `found`/`hireNpc`/`fire` → Task 1; `settle` (Auslastung, NPC-Schichten als Verbindlichkeit, Kündigung, Insolvenz, `MAX_SETTLE_DAYS`) → Task 2; `workShift`, `asJob`, `join`/`leave`, `openings`, Verzweigung in `jobs.apply/work/quit/currentJob`, Level-Zuschlag nicht aus der Kasse → Task 3; Werbung, Anpacken, Entnahme, Einzahlung, Rang, Prämie, Schließen, `status` mit Prognose → Task 4; Menü, drei Ansichten, Arbeitsamt-Rubrik, Modals, Fluxer über dieselben Handler → Task 5; Decke-Test, Messung, Patchnotes, §15 → Task 6. Tests 1–3 (T1), 4/5/9 (T2), 6/10 (T3), 7/8/12 (T4), 11 (T6).

**Namen quer über die Tasks:** `company.found/hireNpc/fire/ownCompany/ownerContext/ceilingOf` (T1 → T2–T6), `settle/closeCompany/dailyTarget` (T2 → T3, T4, T6), `asJob/join/leave/openings/workShift/companyJobId/companyIdOfJob` (T3 → T5), `advertise/pitchIn/withdraw/deposit/promote/bonus/close/status/fresh` (T4 → T5, T6), `jobs.resolveJob` (T3 → T5), Button-IDs `firma|…`, `fstaff|…`, Modals `fname/fbetrag/fpraemie` (T5). `random`-Parameter in `hireNpc(…, now, random)` und `workShift(…, now, random)` bzw. `jobs.work(guildId, userId, now, random)` (T3-Test nutzt `seq(0.5)` als vierten Parameter von `jobs.work`).
