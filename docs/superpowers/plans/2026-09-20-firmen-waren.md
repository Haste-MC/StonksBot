# Firmen Stück 3a – Waren und Lieferketten – Implementierungsplan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Jede Branche verbraucht je Schicht eine Ware, deren Preis am Kurs einer Börsenfirma hängt; Firmen führen ein Lager, kaufen ein oder zahlen ad hoc ein Viertel mehr; die Decke sinkt um den Wareneinsatz bei Kurs = Start.

**Architecture:** Waren-Daten (`ware` je Branche, Konstanten) in `data/companies.js`; Preis- und Lagerlogik als kleine reine Funktionen in `src/company.js` (`wareUnit`, `warePrice`, `capacityOf`, `consumeOne`), Verbrauch in `settle`/`workShift`/`pitchIn`, Einkauf `buyStock`; zwei neue Spalten `stock`, `stock_cost`; Anzeige in Betriebs-, Lager- und Aktien-Ansicht; `ceilingOf` mit `ware`.

**Tech Stack:** Node.js, better-sqlite3 (synchron), discord.js-Builder, eigene Test-Skripte, Messskript.

## Global Constraints

- Spec: `docs/superpowers/specs/2026-09-20-firmen-waren-design.md` – Tabellen (Waren/Lieferanten, neue Decken) sind bindend.
- Konstanten wörtlich: `WARE_SHARE = 0.2`, `WARE_KURS_MIN = 0.5`, `WARE_KURS_MAX = 2.0`, `AD_HOC_MARKUP = 1.25`, `LAGER_TAGE = 7`.
- `wareUnit(b) = Math.round(b.umsatz × WARE_SHARE)`; `warePrice = Math.round(wareUnit × clamp(0.5, 2.0, kurs / start))`, `kurs = db.getPrice(guildId, supplier)?.price ?? asset.start`; Ad-hoc `Math.round(warePrice × 1.25)`.
- `ceilingOf` → `{ gross, wages, ware, net: gross − wages − ware, slots, factor }`, `ware = (slots × NPC_SHIFTS + MAX_PITCH_PER_DAY) × wareUnit(b)`. Neue Decken: Spedition 65.080 / voll 460.495, Kiosk 2.350 / voll 15.681, Café 18.180, Baufirma voll 530.465.
- Verbrauch 1 Einheit je Schicht (NPC/Spieler/Anpacken), nichts an geschlossenen Tagen; Lager zuerst (Ø-Preis abziehen), sonst ad hoc aus der Kasse (darf ins Minus).
- ARCHITEKTUR §3 (Decke berechnet und getestet), §4, §7 (synchron vor dem ersten `await`), §8 (späte `require`), §9 (Einkauf ist Kassenzustand, keine `unb`-Buchung), §12 (Tests ohne Netz).
- Tests: `rm -rf .testdata && DATA_DIR=.testdata node test/<x>.test.js`; volle Suite `npm test 2>&1 | grep -c '❌'` → `0`. Gefälschte Bank wie in `test/companyEvents.test.js`.
- Deutsch; Commit-Trailer wörtlich `Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>`.

---

### Task 1: Daten, Preis, Decke

**Files:**
- Modify: `src/data/companies.js` (Konstanten, `ware` je Branche, Export), `src/company.js` (`wareUnit`, `wareOf`, `warePrice`, `capacityOf`, `ceilingOf`, Exporte)
- Modify: `test/company.test.js:76, 536, 540` (neue Decken)
- Create: `test/companyGoods.test.js`; Modify: `package.json` (`&& node test/companyGoods.test.js` nach `companyEvents`)

**Interfaces:**
- Produces: `data.WARE_SHARE, WARE_KURS_MIN, WARE_KURS_MAX, AD_HOC_MARKUP, LAGER_TAGE`; `b.ware = { name, emoji, supplier }` für alle 9 Branchen (Tabelle der Spec).
  `company.wareUnit(b) → number`; `company.wareOf(guildId, b, now?) → { name, emoji, supplier, asset, start, kurs, ratio, unit, price, adhoc }` (`asset` = `require('./data/wallstreet').find(supplier)`; `kurs` aus `db.getPrice`, sonst `start`; `ratio` geklemmt; `price = round(unit × ratio)`; `adhoc = round(price × AD_HOC_MARKUP)`); `company.capacityOf(b, eff) → (eff.slots × NPC_SHIFTS + MAX_PITCH_PER_DAY) × LAGER_TAGE`; `ceilingOf(...)` mit `ware`.

- [ ] **Step 1: Test schreiben**

```js
// test/companyGoods.test.js
/**
 * Firmen Stück 3a: Waren, Lieferanten, Lager, Decke mit Wareneinsatz.
 * Aufruf: DATA_DIR=.testdata node test/companyGoods.test.js
 */
const unb = require('../src/unb');
const konten = new Map();
let bookings = [];
unb.getBalance = async (g, u) => ({ cash: konten.get(u) ?? 0, bank: 0, total: konten.get(u) ?? 0 });
unb.changeCash = async (g, u, amount, reason, opts = {}) => {
  konten.set(u, (konten.get(u) ?? 0) + amount);
  bookings.push({ user: u, amount, reason, opts });
  return { cash: konten.get(u), bank: 0, total: konten.get(u) };
};
unb.withdrawFromBank = async (g, u) => ({ cash: konten.get(u) ?? 0, bank: 0, total: konten.get(u) ?? 0 });

const db = require('../src/db');
const company = require('../src/company');
const data = require('../src/data/companies');
const wsData = require('../src/data/wallstreet');

let pass = 0, fail = 0;
const check = (label, ok, extra = '') => {
  if (ok) { pass++; console.log(`  ✅ ${label}`); }
  else { fail++; console.log(`  ❌ ${label} ${extra}`); }
};
const DAY_MS = 24 * 60 * 60 * 1000;
const de = (n) => Math.round(n).toLocaleString('de-DE');

(async () => {
  console.log('--- Waren und Lieferanten ---');
  {
    check('Konstanten', data.WARE_SHARE === 0.2 && data.WARE_KURS_MIN === 0.5 && data.WARE_KURS_MAX === 2.0
      && data.AD_HOC_MARKUP === 1.25 && data.LAGER_TAGE === 7);
    for (const b of data.BRANCHES) {
      check(`${b.id}: Ware mit Name, Emoji und Lieferant an der Börse`,
        b.ware && b.ware.name && b.ware.emoji && wsData.find(b.ware.supplier)?.kind === 'stock', JSON.stringify(b.ware));
    }
    const byId = Object.fromEntries(data.BRANCHES.map((b) => [b.id, b]));
    check('Lieferanten wie in der Spec',
      byId.kiosk.ware.supplier === 'LAGR' && byId.imbiss.ware.supplier === 'DÖNR' && byId.autowaesche.ware.supplier === 'LACK'
      && byId.cafe.ware.supplier === 'DÖNR' && byId.fitness.ware.supplier === 'GABR' && byId.werkstatt.ware.supplier === 'HAST'
      && byId.spedition.ware.supplier === 'SCHR' && byId.baufirma.ware.supplier === 'BETO' && byId.club.ware.supplier === 'ENTE');
    check('Einheitspreise: Kiosk 50, Baufirma 340, Club 480',
      company.wareUnit(byId.kiosk) === 50 && company.wareUnit(byId.baufirma) === 340 && company.wareUnit(byId.club) === 480);
  }

  console.log('--- Tagespreis am Kurs ---');
  {
    const G = `WARE_T${Date.now()}`;
    const b = company.branch('baufirma');
    const beto = wsData.find('BETO');
    let w = company.wareOf(G, b);
    check('ohne Notierung: Kurs = Start, ratio 1, Preis 340, ad hoc 425',
      w.kurs === beto.start && w.ratio === 1 && w.price === 340 && w.adhoc === 425, JSON.stringify(w));
    db.setPrice(G, 'BETO', Math.round(beto.start * 1.3), 1, Date.now());
    w = company.wareOf(G, b);
    check('Kurs +30 %: Preis 442', w.price === Math.round(340 * (Math.round(beto.start * 1.3) / beto.start)), String(w.price));
    db.setPrice(G, 'BETO', Math.round(beto.start * 0.2), 2, Date.now());
    check('Kurs 0,2 → geklemmt auf 0,5: Preis 170', company.wareOf(G, b).price === 170);
    db.setPrice(G, 'BETO', beto.start * 3, 3, Date.now());
    check('Kurs 3,0 → geklemmt auf 2,0: Preis 680', company.wareOf(G, b).price === 680);
  }

  console.log('--- Decke mit Wareneinsatz ---');
  {
    const byId = Object.fromEntries(data.BRANCHES.map((b) => [b.id, b]));
    const sp = company.ceilingOf(byId.spedition);
    check('Spedition Kern: 96.900 − 18.900 − 34 × 380 = 65.080', sp.gross === 96_900 && sp.wages === 18_900 && sp.ware === 12_920 && sp.net === 65_080, JSON.stringify(sp));
    check('Kiosk Kern 2.350', company.ceilingOf(byId.kiosk).net === 2_350);
    check('Café Kern 18.180', company.ceilingOf(byId.cafe).net === 18_180);
    check('Spedition voll 460.495', company.fullCeilingOf(byId.spedition).net === 460_495, de(company.fullCeilingOf(byId.spedition).net));
    check('Kiosk voll 15.681', company.fullCeilingOf(byId.kiosk).net === 15_681);
    check('Baufirma voll 530.465', company.fullCeilingOf(byId.baufirma).net === 530_465);
    check('Rangfolge voll: Baufirma > Spedition > Club',
      company.fullCeilingOf(byId.baufirma).net > company.fullCeilingOf(byId.spedition).net
      && company.fullCeilingOf(byId.spedition).net > company.fullCeilingOf(byId.club).net);
    const eff = company.effectiveOf({ id: 0, stufe: 0 }, byId.kiosk, []);
    check('Kapazität Kiosk Stufe 0: (2 × 3 + 4) × 7 = 70', company.capacityOf(byId.kiosk, eff) === 70);
  }

  console.log(`\n${pass} bestanden, ${fail} fehlgeschlagen`);
  process.exit(fail === 0 ? 0 : 1);
})();
```

Prüfen, dass `db.setPrice(guildId, symbol, price, tick, now)` diese Signatur hat (`src/wallstreet.js:245` ruft sie so).

- [ ] **Step 2: Test laufen lassen – muss fehlschlagen**

Run: `rm -rf .testdata && DATA_DIR=.testdata node test/companyGoods.test.js`
Expected: ❌ „Konstanten" und „Ware mit Name…".

- [ ] **Step 3: Daten**

`src/data/companies.js`, nach `EVENT_UMSATZ_MAX`:

```js
// Waren (Stück 3a): jede Schicht verbraucht eine Einheit, der Preis hängt am
// Kurs des Lieferanten an der Börse (data/wallstreet.js).
const WARE_SHARE = 0.2;          // Anteil des Schichtumsatzes bei Kurs = Start
const WARE_KURS_MIN = 0.5;       // Klemmung des Kursverhältnisses …
const WARE_KURS_MAX = 2.0;       // … nach oben
const AD_HOC_MARKUP = 1.25;      // ohne Lager kostet die Einheit ein Viertel mehr
const LAGER_TAGE = 7;            // Kapazität in Vollbetriebs-Tagen
```

Je Branche im `BRANCHES`-Eintrag ein Feld `ware` (Tabelle der Spec), z. B. Kiosk: `ware: { name: 'Handelsware', emoji: '📦', supplier: 'LAGR' }`, Baufirma `{ name: 'Beton & Stahl', emoji: '🧱', supplier: 'BETO' }`, Club `{ name: 'Acts & Getränke', emoji: '🎤', supplier: 'ENTE' }`, Imbiss `{ 'Lebensmittel', '🥫', 'DÖNR' }`, Autowäsche `{ 'Reiniger', '🧴', 'LACK' }`, Café `{ 'Kaffee & Gebäck', '☕', 'DÖNR' }`, Fitness `{ 'Geräte & Zubehör', '🏋️', 'GABR' }`, Werkstatt `{ 'Ersatzteile', '⚙️', 'HAST' }`, Spedition `{ 'Reifen & Teile', '🛞', 'SCHR' }`. Konstanten exportieren.

- [ ] **Step 4: `src/company.js`**

Neben `ceilingOf`:

```js
// ----------------------------------------------------------------- Waren

/** Einheitspreis bei Kurs = Start: ein Fünftel des Schichtumsatzes. */
function wareUnit(b) {
  return Math.round(b.umsatz * data.WARE_SHARE);
}

/**
 * Die Ware einer Branche mit Tagespreis. Der Kurs ist der zuletzt notierte
 * der Lieferanten-Aktie (die Börse schreibt sich über Ticker und Ansichten
 * fort – die Firma stößt nichts an); ohne Notierung gilt der Startkurs.
 * Das Verhältnis ist geklemmt (0,5 … 2,0): Ein Kurssturz macht Ware billig,
 * nie umsonst; eine Blase teuer, nie unbezahlbar.
 */
function wareOf(guildId, b) {
  const asset = require('./data/wallstreet').find(b.ware.supplier);
  const kurs = db.getPrice(guildId, asset.symbol)?.price ?? asset.start;
  const ratio = Math.max(data.WARE_KURS_MIN, Math.min(data.WARE_KURS_MAX, kurs / asset.start));
  const unit = wareUnit(b);
  const price = Math.round(unit * ratio);
  return { ...b.ware, asset, start: asset.start, kurs, ratio, unit, price,
    adhoc: Math.round(price * data.AD_HOC_MARKUP) };
}

/** Lagerkapazität: eine Woche Vollbetrieb (NPC-Schichten + Anpacken). */
function capacityOf(b, eff) {
  return (eff.slots * data.NPC_SHIFTS + data.MAX_PITCH_PER_DAY) * data.LAGER_TAGE;
}
```

`ceilingOf`: nach `wages` → `const ware = (slots * data.NPC_SHIFTS + data.MAX_PITCH_PER_DAY) * wareUnit(b);` und `return { gross, wages, ware, net: gross - wages - ware, slots, factor: umsatzFactor };`. Kommentar: „Wareneinsatz bei Kurs = Start (Stück 3a) – die Decke ist die eines Tages mit vollem Lager zum Normalpreis."

Exporte: `wareUnit, wareOf, capacityOf`.

- [ ] **Step 5: `test/company.test.js` Decken anpassen**

`:76` → `65_080` (Kommentar: „… − 34 × 380 Ware"), `:536` → `460_495`, `:540` → `15_681`. Der Kommentar über `:76` („Handrechnung Spedition …") um „, Ware 34 × 380 = 12.920 → 65.080 netto" ergänzen.

- [ ] **Step 6: Tests, package.json, Commit**

Run: `rm -rf .testdata && DATA_DIR=.testdata node test/companyGoods.test.js && DATA_DIR=.testdata node test/company.test.js && DATA_DIR=.testdata node test/companyEvents.test.js` → `0 fehlgeschlagen` (der §3-Lauf in company.test.js bleibt unter der neuen Decke, weil noch nichts verbraucht wird; das ändert Task 2).

```bash
git add src/data/companies.js src/company.js test/company.test.js test/companyGoods.test.js package.json
git commit -m "firmen: waren je branche, tagespreis am kurs des lieferanten, decke mit wareneinsatz

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 2: Lager, Verbrauch, Einkauf

**Files:**
- Modify: `src/db.js` (Spalten `stock`, `stock_cost` + Migration, `saveCompany`), `src/company.js` (`consumeOne`, Verbrauch in `settle`/`workShift`/`pitchIn`, `buyStock`, `status().ware`, Exporte)
- Modify: `test/company.test.js` (§3-Lauf: täglich `buyStock('voll')`; zweiter Lauf ohne Einkauf), `test/companyGoods.test.js` (Block „Lager und Verbrauch")

**Interfaces:**
- Produces: `companies.stock INTEGER NOT NULL DEFAULT 0`, `stock_cost INTEGER NOT NULL DEFAULT 0`.
  `company.consumeOne(c, w) → { company, cost, adhoc }` (rein: nimmt eine Einheit aus dem Lager – `stock −1`, `stock_cost −avg` – oder bucht `w.adhoc` von der Kasse; `cost` = abgezogener Kassenbetrag (0 bei Lager), `adhoc` boolean).
  `settle` → `out.ware = { units, adhoc, cost }`; `workShift`/`pitchIn` Ergebnis + `ware: { adhoc, cost }`.
  `company.buyStock(guildId, userId, units | 'voll', now) → { ok, units, price, cost, stock, capacity, kasse }` | `{ ok:false, reason: 'no_company'|'units'|'capacity'|'kasse', free?, cost?, kasse? }`.
  `status()` + `ware: { …wareOf, stock, capacity, avgPaid, value, daysLeft, perDay }` (`perDay = eff.slots × NPC_SHIFTS + MAX_PITCH_PER_DAY`, `daysLeft = round(stock / perDay × 10) / 10`, `value = stock_cost`).

- [ ] **Step 1: Tests schreiben – Block in `test/companyGoods.test.js` vor der Schlusszeile**

```js
  console.log('--- Lager und Verbrauch (Kiosk, 2 Schichtleiter, Auslastung 0,4) ---');
  {
    const G = `LAGER_T${Date.now()}`;
    const U = 'l1';
    konten.set(U, 1_000_000);
    const t0 = new Date(new Date().setHours(6, 0, 0, 0)).getTime() + DAY_MS;
    const seq = (...v) => { let i = 0; return () => (i < v.length ? v[i++] : 0.5); };
    const keinWurf = () => 0.5;
    let r = await company.found(G, U, 'kiosk', 'Lagerbude', t0);
    const cid = r.company.id;
    const b = company.branch('kiosk');
    company.hireNpc(G, U, t0, seq(0.1)); company.hireNpc(G, U, t0, seq(0.2));
    for (const s of db.companyStaff(cid)) db.saveStaff({ ...s, rank: 2 });
    await company.deposit(G, U, 100_000, t0);
    check('frisch: Lager leer, Kapazität 70, Preis 50, ad hoc 63', (() => {
      const s = company.status(G, U, t0);
      return s.ware.stock === 0 && s.ware.capacity === 70 && s.ware.price === 50 && s.ware.adhoc === 63 && s.ware.avgPaid === 0;
    })());

    // Tag 1 ohne Lager: Umsatz 6 × round(375 × 0,4) = 900, Löhne 900, Ware 6 × 63 = 378 ad hoc.
    let vor = db.getCompany(cid).kasse;
    let s = company.settle(cid, t0 + DAY_MS, keinWurf);
    check('ohne Lager: −378 ad hoc, 6 Einheiten', db.getCompany(cid).kasse - vor === -378 && s.ware.units === 6 && s.ware.adhoc === 6 && s.ware.cost === 378,
      JSON.stringify({ delta: db.getCompany(cid).kasse - vor, ware: s.ware }));

    // Einkauf: 70 zu 50 = 3.500 aus der Kasse.
    vor = db.getCompany(cid).kasse;
    r = await company.buyStock(G, U, 'voll', t0 + DAY_MS + 3600e3);
    check('voll machen: 70 Einheiten für 3.500', r.ok && r.units === 70 && r.cost === 3_500 && r.stock === 70 && db.getCompany(cid).kasse === vor - 3_500, JSON.stringify(r));
    check('Kapazität voll → capacity', (await company.buyStock(G, U, 5, t0 + DAY_MS + 3600e3)).reason === 'capacity');
    check('0 oder Unsinn → units', (await company.buyStock(G, U, 0, t0 + DAY_MS + 3600e3)).reason === 'units'
      && (await company.buyStock(G, U, 'x', t0 + DAY_MS + 3600e3)).reason === 'units');

    // Tag 2 mit Lager: Kasse nur Umsatz − Löhne; Lager 70 → 64, Wert 3.500 → 3.200.
    const a1 = db.getCompany(cid).auslastung;
    const ziel = company.dailyTarget(b, 2, false, 2);
    const a2 = a1 + (ziel - a1) * 0.2;
    vor = db.getCompany(cid).kasse;
    s = company.settle(cid, t0 + 2 * DAY_MS, keinWurf);
    check('mit Lager: kein Warenabzug, 64 übrig, Wert 3.200',
      db.getCompany(cid).kasse - vor === 2 * 3 * Math.round(375 * a2) - 900 && s.ware.adhoc === 0 && s.ware.cost === 0
      && db.getCompany(cid).stock === 64 && db.getCompany(cid).stock_cost === 3_200,
      JSON.stringify({ delta: db.getCompany(cid).kasse - vor, stock: db.getCompany(cid).stock, cost: db.getCompany(cid).stock_cost }));
    s = company.status(G, U, t0 + 2 * DAY_MS);
    check('status: reicht 6,4 Tage, Ø 50, Wert 3.200', s.ware.daysLeft === 6.4 && s.ware.avgPaid === 50 && s.ware.value === 3_200, JSON.stringify(s.ware));

    // Anpacken verbraucht eine Einheit.
    r = await company.pitchIn(G, U, t0 + 2 * DAY_MS + 3600e3);
    check('Anpacken: eine Einheit aus dem Lager', r.ok && r.ware.adhoc === false && db.getCompany(cid).stock === 63, JSON.stringify(r.ware));

    // Leeres Lager + Anpacken: ad hoc 63 von der Kasse, Umsatz bleibt.
    db.saveCompany({ ...db.getCompany(cid), stock: 0, stock_cost: 0 });
    vor = db.getCompany(cid).kasse;
    r = await company.pitchIn(G, U, t0 + 2 * DAY_MS + 10_800e3);
    check('Anpacken ohne Lager: Umsatz − 63', r.ok && r.ware.adhoc === true && r.ware.cost === 63 && db.getCompany(cid).kasse - vor === r.umsatz - 63, JSON.stringify(r));

    // Geschlossener Tag: kein Verbrauch, kein Ad-hoc.
    db.saveCompany({ ...db.getCompany(cid), closed_until: t0 + 4 * DAY_MS });
    vor = db.getCompany(cid).kasse;
    s = company.settle(cid, t0 + 3 * DAY_MS, keinWurf);
    check('geschlossen: nur Löhne, keine Ware', s.ware.units === 0 && db.getCompany(cid).kasse - vor === -900);
    db.saveCompany({ ...db.getCompany(cid), closed_until: 0 });

    // Kasse zu klein für den Einkauf.
    db.saveCompany({ ...db.getCompany(cid), kasse: 100 });
    r = await company.buyStock(G, U, 10, t0 + 4 * DAY_MS);
    check('Kasse reicht nicht → kasse', r.ok === false && r.reason === 'kasse' && r.cost === 500);

    // Spieler-Schicht verbraucht eine Einheit (Platz frei machen: ein NPC geht).
    db.saveCompany({ ...db.getCompany(cid), kasse: 10_000, stock: 5, stock_cost: 250 });
    company.fire(G, U, db.companyStaff(cid)[0].id, t0 + 4 * DAY_MS);
    const P = 'l2';
    const j = await company.join(G, P, cid, t0 + 4 * DAY_MS);
    check('Spieler eingestellt', j.ok, JSON.stringify(j));
    const w = company.workShift(G, P, cid, t0 + 4 * DAY_MS + 3600e3, () => 0.5);
    check('Spieler-Schicht: eine Einheit aus dem Lager (5 → 4, Wert 250 → 200)',
      w.ok && w.ware.adhoc === false && db.getCompany(cid).stock === 4 && db.getCompany(cid).stock_cost === 200, JSON.stringify(w));
    await company.close(G, U, t0 + 4 * DAY_MS + 7200e3);
  }
```

- [ ] **Step 2: Test laufen lassen – muss fehlschlagen**

Run: `rm -rf .testdata && DATA_DIR=.testdata node test/companyGoods.test.js`
Expected: ❌ ab „frisch: Lager leer …" (`s.ware` undefined).

- [ ] **Step 3: `src/db.js`**

Spalten `stock INTEGER NOT NULL DEFAULT 0`, `stock_cost INTEGER NOT NULL DEFAULT 0` in `CREATE TABLE companies`, in die PRAGMA-Migrationsliste (der Block aus Stück 2b) und ins `saveCompany`-Statement/-Funktion (`c.stock ?? 0, c.stock_cost ?? 0`).

- [ ] **Step 4: `src/company.js`**

```js
/**
 * Eine Einheit verbrauchen: aus dem Lager (Wert um den Ø-Preis senken) oder
 * ad hoc zum Aufschlag von der Kasse – die darf dabei ins Minus wie bei Löhnen.
 * Rein: liefert die fortgeschriebene Firmenzeile.
 */
function consumeOne(c, w) {
  const next = { ...c };
  if ((next.stock ?? 0) > 0) {
    const avg = Math.round(next.stock_cost / next.stock);
    next.stock -= 1;
    next.stock_cost = next.stock > 0 ? next.stock_cost - avg : 0;
    return { company: next, cost: 0, adhoc: false };
  }
  next.kasse -= w.adhoc;
  return { company: next, cost: w.adhoc, adhoc: true };
}
```

`settle`: nach `eff` → `const w = wareOf(guildId, b);`; `out.ware = { units: 0, adhoc: 0, cost: 0 }`; in der NPC-Schleife bei `!zu` je Schicht (`for (let k = 0; k < data.NPC_SHIFTS; k++)`): `const v = consumeOne(cur, w); cur = v.company; out.ware.units++; if (v.adhoc) { out.ware.adhoc++; out.ware.cost += v.cost; }` – vor der Umsatzbuchung, damit der Tag vollständig ist. (Die Schleife multipliziert heute `NPC_SHIFTS × (umsatz − lohn)`; der Verbrauch läuft als eigene kleine Schleife daneben.)

`workShift`: nach der Kasse-Prüfung `if (c.kasse < lohn)` → `const v = consumeOne(c, wareOf(guildId, b));` und `db.saveCompany({ ...v.company, kasse: v.company.kasse - lohn + umsatz })`; Ergebnis `ware: { adhoc: v.adhoc, cost: v.cost }`. `pitchIn`: analog nach `useTime` (die Zeit ist gebucht, die Schicht findet statt): `const v = consumeOne(c, wareOf(guildId, b)); db.saveCompany({ ...v.company, kasse: v.company.kasse + umsatz, pitch_day, pitch_today })`, Ergebnis `ware`.

```js
/** Lager füllen – aus der Kasse, zum Tagespreis. `units` ganze Zahl oder 'voll'. */
async function buyStock(guildId, userId, units, now = Date.now()) {
  const ctx = fresh(guildId, userId, now);
  if (!ctx) return { ok: false, reason: 'no_company' };
  const { company: c, branch: b } = ctx;
  const eff = effectiveOf(c, b);
  const capacity = capacityOf(b, eff);
  const free = capacity - (c.stock ?? 0);
  const n = units === 'voll' ? free : Math.floor(Number(units));
  if (!Number.isFinite(n) || n <= 0) return { ok: false, reason: units === 'voll' && free <= 0 ? 'capacity' : 'units', free };
  if (n > free) return { ok: false, reason: 'capacity', free };
  const w = wareOf(guildId, b);
  const cost = n * w.price;
  if (c.kasse < cost) return { ok: false, reason: 'kasse', cost, kasse: c.kasse };
  db.saveCompany({ ...c, kasse: c.kasse - cost, stock: (c.stock ?? 0) + n, stock_cost: (c.stock_cost ?? 0) + cost });
  return { ok: true, units: n, price: w.price, cost, stock: (c.stock ?? 0) + n, capacity, kasse: c.kasse - cost };
}
```

(`async`, damit der Handler-Aufruf wie `deposit`/`withdraw` aussieht; es gibt kein `await` – das ist gewollt: Kassenzustand, keine Buchung.)

`status()`: `ware: (() => { const w = wareOf(guildId, b); const perDay = eff.slots * data.NPC_SHIFTS + data.MAX_PITCH_PER_DAY; const stock = c.stock ?? 0; return { ...w, stock, capacity: capacityOf(b, eff), avgPaid: stock > 0 ? Math.round((c.stock_cost ?? 0) / stock) : 0, value: c.stock_cost ?? 0, perDay, daysLeft: Math.round((stock / perDay) * 10) / 10 }; })()`.

Exporte: `consumeOne, buyStock`.

- [ ] **Step 5: `test/company.test.js` §3-Lauf**

Im Block „§3: kein Tag über der Decke" (~`:433`): vor `company.advertise(...)` täglich `await company.buyStock(G, U, 'voll', now);` (Kurs = Start in der Testwelt → Einkauf zur Decke). Direkt danach ein zweiter, kürzerer Lauf (Kiosk, Café, Spedition, 120 Tage) **ohne** Einkauf mit Check `best <= decke - 0.25 * (b.slots * data.NPC_SHIFTS + data.MAX_PITCH_PER_DAY) * company.wareUnit(b) + 0.5 * b.slots * data.NPC_SHIFTS` („ad hoc kostet ein Viertel mehr"). Beide `median > 0`.

- [ ] **Step 6: Tests, Commit**

Run: `rm -rf .testdata && DATA_DIR=.testdata node test/companyGoods.test.js && DATA_DIR=.testdata node test/company.test.js && DATA_DIR=.testdata node test/companyEvents.test.js && DATA_DIR=.testdata node test/db.test.js && DATA_DIR=.testdata node test/shifts.test.js && DATA_DIR=.testdata node test/energy.test.js` → alle `0 fehlgeschlagen`. In `companyEvents.test.js` verschieben sich Handrechnungen um den Ad-hoc-Warenabzug (z. B. „ohne Ereignis: Kasse + Umsatz − Löhne" jetzt −378 bei 6 Schichten, Anpacken-Umsatz-Checks um −63): jede Erwartung mit einer Zeile Kommentar („Ware: 6 × 63 ad hoc") anpassen – **nicht** Toleranzen weiten; wo ein Block die Kasse-Delta mehrfach prüft, das Lager am Blockanfang mit `buyStock('voll')` füllen und den Kauf in der Erwartung berücksichtigen, falls das einfacher ist.

```bash
git add src/db.js src/company.js test/company.test.js test/companyGoods.test.js test/companyEvents.test.js
git commit -m "firmen: lager, verbrauch je schicht (lager oder ad hoc), einkauf aus der kasse

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 3: Anzeige

**Files:**
- Modify: `src/ui.js` (`buildFirmaView` Feld „📦 Waren", Zeile 2; `buildFirmaAusbauView` Schließen; neue `buildFirmaLagerView`; `buildAssetView` Zeile „Lieferant für"), `src/buttons.js` (`firma|lager`, `firma|lagervoll`, Modal `fware|kaufen`, Ergebnis-Texte für `ware.adhoc` bei Anpacken/Schicht), `src/menu.js` nur falls Untermenüs registriert werden müssen (prüfen, wie `firma|personal` gebaut wird)
- Test: `test/fluxer-render.test.js` (Lager-Ansicht rendern, Reaktionshaushalt), `test/menu.test.js` (läuft)

**Interfaces:**
- Consumes: `status().ware`, `company.buyStock`, `wallstreet.quote(guildId, symbol)`.
- Produces: `buildFirmaLagerView({ guildId, userId })`; Button-IDs `firma|lager|0|<uid>`, `firma|lagervoll|0|<uid>`, Modal `fware|kaufen|<uid>` (Feld `amount`, „voll" erlaubt).

- [ ] **Step 1: Betriebsansicht**

Nach dem Feld „👥 Personal" (oder als eigenes Feld nach „⏳ Heute"):

```js
  embed.addFields({
    name: '📦 Waren',
    value: `${s.ware.emoji} ${s.ware.name} · Lager **${s.ware.stock}/${s.ware.capacity}** · heute **${money(symbol, s.ware.price)}**`
      + ` (${s.ware.asset.symbol} ${s.ware.ratio >= 1 ? '+' : ''}${Math.round((s.ware.ratio - 1) * 100)} %)`
      + (s.ware.stock > 0 ? ` · Ø bezahlt ${money(symbol, s.ware.avgPaid)} · reicht ~${String(s.ware.daysLeft).replace('.', ',')} Tage`
        : `\n⚠️ _leer – Schichten kaufen ad hoc (${money(symbol, s.ware.adhoc)}, +25 %)_`),
  });
```

Zeile 2: `firma|schliessen` durch `new ButtonBuilder().setCustomId(\`firma|lager|0|${userId}\`).setLabel('Lager').setEmoji('🏬').setStyle(ButtonStyle.Primary)` ersetzen. Ausbau-Ansicht Zeile 1: nach „Ausbauen" den Schließen-Knopf einfügen (`firma|schliessen|0|<uid>`, 🔒, Danger). Footer der Betriebsansicht: „Decke jetzt …" bleibt (jetzt netto nach Ware).

- [ ] **Step 2: Lager-Ansicht**

```js
/** Das Lager: Ware, Lieferant, Preis, Bestand – und der Einkauf. */
async function buildFirmaLagerView({ guildId, userId }) {
  const company = require('./company');
  const s = company.status(guildId, userId);
  if (!s) return buildFirmaFoundView({ guildId, userId });
  const symbol = await getSymbol(guildId);
  const w = s.ware;
  const q = require('./wallstreet').quote(guildId, w.asset.symbol);
  const trend = q ? `${q.dayChange >= 0 ? '📈' : '📉'} ${q.dayChange >= 0 ? '+' : ''}${(q.dayChange * 100).toFixed(1).replace('.', ',')} % heute` : '';
  const embed = new EmbedBuilder()
    .setTitle(`🏬 Lager – ${s.company.name}`)
    .setColor(0x8e6e53)
    .setDescription(`${w.emoji} **${w.name}** – jede Schicht verbraucht eine Einheit.\n`
      + `Lieferant: ${w.asset.emoji} **${w.asset.name}** (${w.asset.symbol}) · Kurs ${money(symbol, w.kurs)} ${trend}\n`
      + `Tagespreis **${money(symbol, w.price)}** je Einheit (Normalpreis ${money(symbol, w.unit)}: ${w.ratio >= 1 ? '+' : ''}${Math.round((w.ratio - 1) * 100)} %) · ohne Lager ad hoc ${money(symbol, w.adhoc)}\n`
      + `_Aktie **${w.asset.symbol}** halten sichert gegen teure Ware ab._`)
    .addFields(
      { name: 'Bestand', value: `**${w.stock}/${w.capacity}** Einheiten · reicht ~${String(w.daysLeft).replace('.', ',')} Tage`, inline: true },
      { name: 'Ø bezahlt', value: w.stock > 0 ? money(symbol, w.avgPaid) : '–', inline: true },
      { name: 'Lagerwert', value: money(symbol, w.value), inline: true },
      { name: '💰 Kasse', value: money(symbol, s.kasse), inline: true },
      { name: 'Voll machen kostet', value: money(symbol, (w.capacity - w.stock) * w.price), inline: true },
    );
  const free = w.capacity - w.stock;
  return {
    embeds: [embed],
    components: [new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId(`firma|einkaufen|0|${userId}`).setLabel('Einkaufen').setEmoji('🛒')
        .setStyle(ButtonStyle.Primary).setDisabled(free <= 0 || s.kasse < w.price),
      new ButtonBuilder().setCustomId(`firma|lagervoll|0|${userId}`).setLabel(`Voll machen (${free})`).setEmoji('📦')
        .setStyle(ButtonStyle.Success).setDisabled(free <= 0 || s.kasse < free * w.price),
      new ButtonBuilder().setCustomId(ID.menu('firma', 1, userId)).setLabel('Firma').setEmoji('🏢').setStyle(ButtonStyle.Secondary),
      homeButton(userId))],
  };
}
```

Exportieren. `buildAssetView`: nach der Beschreibung ein Feld „🏭 Lieferant für" mit den Branchen, deren `ware.supplier === a.symbol` (`require('./data/companies').BRANCHES.filter(...)` → `${b.emoji} ${b.name}` mit „ · " verbunden), nur wenn es welche gibt.

- [ ] **Step 3: Handler in `src/buttons.js`**

Im `firma`-Dispatcher: `einkaufen` öffnet ein Modal `fware|kaufen|<uid>` (Feld `amount`, Label „Menge (oder „voll")"), vor `deferUpdate` wie `entnehmen`. Nach `deferUpdate`: `aktion === 'lager'` → `editReply(buildFirmaLagerView)`; `aktion === 'lagervoll'` → `const r = await company.buyStock(guildId, userId, 'voll'); note = r.ok ? \`📦 **${r.units}** Einheiten für ${money(symbol, r.cost)} eingelagert (${r.stock}/${r.capacity}).\` : { capacity: '📦 Das Lager ist voll.', kasse: \`💸 Dafür fehlen ${money(symbol, (r.cost ?? 0) - (r.kasse ?? 0))} in der Kasse.\`, units: '❌ Menge?', no_company: '🏢 Du hast keine Firma.' }[r.reason] ?? '❌ Das ging nicht.'; editReply(buildFirmaLagerView)`. Neuer Modal-Handler `fware(interaction, [modus])`: `raw === 'voll' ? 'voll' : Number(raw)` → `buyStock` → dieselben Texte → `editReply(buildFirmaLagerView)`.

Anpacken-Ergebnistext: `+ (r.ware?.adhoc ? \` _(Ware ad hoc für ${money(symbol, r.ware.cost)} – das Lager ist leer)_\` : '')`. Schicht-Embed (`shiftResult`, Firmenzweig): Feld „Ware" nur bei `result.ware?.adhoc` → `ad hoc ${money(symbol, result.ware.cost)}` (dazu muss `jobs.work` das `ware`-Feld aus `shift` durchreichen: `ware: shift.ware`).

- [ ] **Step 4: Render-Test**

In `test/fluxer-render.test.js` (nach dem 2b-Block): Firma mit `stock 0` → `buildFirmaView` Feld „📦 Waren" enthält „leer"; `buildFirmaLagerView` → Titel beginnt mit 🏬, vier Knöpfe, `Einkaufen` aktiv bei Kasse ≥ Preis; Reaktionshaushalt ≤ `MAX_REACTIONS`; `buildFirmaAusbauView` Zeile 1 enthält `firma|schliessen`; Betriebsansicht Zeile 2 enthält `firma|lager` und nicht `firma|schliessen`; `buildAssetView` für `BETO` enthält „Baufirma".

- [ ] **Step 5: Tests, Commit**

Run: `rm -rf .testdata && DATA_DIR=.testdata node test/fluxer-render.test.js && DATA_DIR=.testdata node test/menu.test.js && DATA_DIR=.testdata node test/companyGoods.test.js && DATA_DIR=.testdata node test/shifts.test.js` → `0 fehlgeschlagen`.

```bash
git add src/ui.js src/buttons.js src/jobs.js test/fluxer-render.test.js
git commit -m "firmen: waren-feld, lager-ansicht mit einkauf, schliessen im ausbau, lieferant an der boerse

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 4: Messung, Docs, Patchnotes

**Files:**
- Modify: `scripts/messung-geldquellen.js` (`firmenlauf`: täglich `buyStock('voll')` bei `ratio ≤ 1`, Ausgabe Wareneinsatz/Tag und Anteil ad hoc), `ARCHITEKTUR.md` §15 (neue Decken-Tabelle Kern/voll, Wareneinsatz 20 %, Hedge, gemessene Mediane mit Datei), `docs/messungen/2026-09-20-firmen-waren.txt` (Firmen-Abschnitte des Laufs), `src/data/patchnotes.js` (1.35.0, Datum des Laufs, über 1.34.0), 2a-Spec-Addendum (eine Zeile „3a umgesetzt")

- [ ] **Step 1: Skript** – in der Tagesschleife vor `advertise`: `const st = company.status(G, U, now); if (st.ware.ratio <= 1 && st.ware.stock < st.ware.perDay) { const k = await company.buyStock(G, U, 'voll', now); if (k.ok) wareKosten += k.cost; }`; aus `settle`-Ergebnis `adhocEinheiten += s.ware.adhoc; einheiten += s.ware.units`; Ausgabe je Branche `Ware Ø X/Tag, ad hoc Y %`. Reserve für die Entnahme (`reserve`) um einen Tag Ware erhöhen (`+ perDay × unit`), sonst kauft der Lauf nie.
- [ ] **Step 2: Lauf** – `rm -rf .testdata && DATA_DIR=.testdata node scripts/messung-geldquellen.js 10 365 2>&1 | tee <scratchpad>/mess-3a.txt` (Timeout 600000; ggf. Hintergrund). Handvalidierung: ein Kiosk-Tag im Lauf mit vollem Lager = Umsatz − Löhne (kein Warenabzug), Einkauf 70 × 50 = 3.500 einmal am Anfang; Zahlen in den Report.
- [ ] **Step 3: Docs** – §15: Tabelle Kern/voll alt → neu (Spec-Tabelle), Satz zu Preis/Kurs/Klemmung/ad hoc, gemessene Mediane (mit Ereignissen wie 2b, Kurs = Start) mit Verweis auf `docs/messungen/2026-09-20-firmen-waren.txt`; die 2b-Zahlen bleiben als „vor 1.35.0" stehen. Patchnote 1.35.0 „📦 Firmen: Waren und Lieferanten" (Ware je Branche, Lager, Preis am Kurs, ad hoc +25 %, Decken sinken um den Wareneinsatz – gemessene Mediane, Hedge-Tipp).
- [ ] **Step 4: Suite, Commit** – `npm test 2>&1 | grep -c '❌'` → `0`.

```bash
git add scripts/messung-geldquellen.js ARCHITEKTUR.md docs/messungen/2026-09-20-firmen-waren.txt src/data/patchnotes.js docs/superpowers/specs/2026-09-13-firmen-ausbau-design.md
git commit -m "firmen: messung mit waren, §15 decken neu, patchnotes 1.35.0

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

## Selbstprüfung gegen die Spec

- Waren/Lieferanten-Tabelle, Konstanten, `wareUnit`/`warePrice`/Klemmung: Task 1. ✔
- Verbrauch je Schicht (NPC/Spieler/Anpacken), geschlossene Tage, Lager zuerst, ad hoc: Task 2. ✔
- Lager (Spalten, Kapazität, Ø-Preis, `buyStock` inkl. `'voll'`, Kapazität/Kasse/Units-Fehler): Task 2. ✔
- Decke mit `ware`, neue Werte, Rangfolge, Decken-Läufe mit/ohne Einkauf: Task 1 + 2. ✔
- Anzeige (Waren-Feld, Zeile 2 Lager, Schließen im Ausbau, Lager-Ansicht, Modal, Aktien-Zeile): Task 3. ✔
- Messung, §15, Patchnotes, Addendum: Task 4. ✔
- Nicht-Ziele eingehalten (kein `lieferant`-Umbau, keine Produktion). ✔
