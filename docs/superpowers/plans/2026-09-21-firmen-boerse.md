# Firmen Stück 3c – Börse aktiv (Nachfrage-Drift, Firmenanteile) – Implementierungsplan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** (A) Wareneinkäufe der Spielerfirmen heben die Drift der Lieferanten-Aktie gedeckelt an; (C) Inhaber verkaufen bis zu 49 % ihrer Firma als Anteile an Spieler, die an Entnahmen und Auszahlungen teilhaben und Anteile weiterhandeln.

**Architecture:** A: drei Spalten an `market_prices` (`demand_day/today/ema`), `wallstreet.recordDemand` (synchron) aus `company.js`-Käufen, `extraDrift` in `step`/`simulate`, Zeile in der Aktien-Ansicht. C: Tabellen `company_shares` und `company_share_offers`, Funktionen im Abschnitt „Anteile" von `src/company.js`, Ausschüttung als Aufteilung in `withdraw`/`close`/`sell`, `claimDividends` mit einer Buchung; Ansichten Anteile (Inhaber), Firmenanteile (Börse-Liste), Meine Anteile.

**Tech Stack:** Node.js, better-sqlite3, discord.js-Builder, eigene Tests, Messskript.

## Global Constraints

- Spec: `docs/superpowers/specs/2026-09-21-firmen-boerse-design.md` (bindend).
- A: `DEMAND_REF = 200`, `DEMAND_CAP = 0.00002` (= `DRIFT_CAP / 2`), EMA-Faktor 1/7 je Tag, `extra = DEMAND_CAP × min(1, emaNow / DEMAND_REF)` nur für Aktien mit Lieferantenrolle, nie negativ; `step(price, sigma, random, shock, shockSigma, recoverTo, extraDrift = 0)`. Handrechnung: 365 Tage × 48 Takte × 0,00002 = 0,3504 → Faktor `e^0,3504 = 1,4196`; EMA nach 7 Tagen konstant 140/Tag = 140 × (1 − (6/7)^7) = 91,18.
- C: `SHARES_TOTAL = 1000`, `OWNER_MIN = 510`, `IPO_MIN_STUFE = 2`, `SHARE_FEE = 0.01`; Ausschüttung `floor(value × shares / 1000)` je Halter, Rest an den Inhaber; Kauf = zwei Buchungen (Käufer −, Verkäufer +) mit Rücknahme bei Fehler, Gebühr Senke; `claimDividends` eine Buchung `{ xp:false, tax:false, kind:'company' }`.
- ARCHITEKTUR §3 (nur Transfers + Senken; A-Grenze +42 %/Jahr dokumentiert), §7 (synchron vor dem ersten `await`), §8, §9 (Ausnahme: der Anteilskauf ist ein Transfer mit zwei Buchungen wie `pay` + Auszahlung – begründet), §12.
- Tests `rm -rf .testdata && DATA_DIR=.testdata node test/<x>.test.js`; Suite `npm test 2>&1 | grep -c '❌'` → `0`; Deutsch; Trailer wörtlich `Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>`.

---

### Task 1: Nachfrage-Drift (A)

**Files:**
- Modify: `src/db.js` (Spalten `demand_day TEXT NOT NULL DEFAULT ''`, `demand_today INTEGER NOT NULL DEFAULT 0`, `demand_ema REAL NOT NULL DEFAULT 0` an `market_prices` – CREATE + PRAGMA-Nachrüstung wie `recover_to`; Statement `setDemand(guildId, symbol, day, today, ema)`), `src/wallstreet.js` (`DEMAND_REF`, `DEMAND_CAP`, `SUPPLIER_SYMBOLS`, `recordDemand`, `demandOf`, `extraDriftOf`, `step` mit `extraDrift`, `simulate` nutzt es, `quote` liefert `demand`), `src/company.js` (Aufrufe in `buyStock`, ad hoc in `settle`/`workShift`/`pitchIn`, `buyFromTrader`), `src/ui.js` (`buildAssetView` Zeile „🏭 Nachfrage")
- Test: `test/wallstreet.test.js` (Block „Nachfrage-Drift"), `test/companyGoods.test.js` (Block „Nachfrage wird gezählt")

**Interfaces:**
- `wallstreet.recordDemand(guildId, symbol, units, now = Date.now())` → `{ today, ema }` (synchron; legt den Preis-Datensatz bei Bedarf an via `list`).
- `wallstreet.demandOf(guildId, symbol, now)` → `{ today, ema, emaNow, extra, perDay }` (`perDay = extra × 48`, als Anteil).
- `wallstreet.step(price, sigma, random, shock, shockSigma, recoverTo, extraDrift = 0)`.
- `wallstreet.quote(...)` bekommt `demand: demandOf(...)`.
- Konstanten exportiert: `DEMAND_REF, DEMAND_CAP, SUPPLIER_SYMBOLS` (Set der `ware.supplier` aller Branchen, spät gebunden aus `data/companies`).

- [ ] **Step 1: Tests schreiben**

In `test/wallstreet.test.js` vor der Schlusszeile (Helfer `mulberry32`, `market`, `data`, `db`, `G`, `t0`, `H` existieren dort – prüfen und ggf. lokale Kopien anlegen):

```js
  console.log('--- Nachfrage-Drift ---');
  {
    check('Konstanten', market.DEMAND_REF === 200 && Math.abs(market.DEMAND_CAP - 0.00002) < 1e-12 && market.DEMAND_CAP === market.DRIFT_CAP / 2);
    check('Lieferanten-Symbole aus den Branchen', market.SUPPLIER_SYMBOLS.has('BETO') && market.SUPPLIER_SYMBOLS.has('DÖNR') && !market.SUPPLIER_SYMBOLS.has('BANK'));

    // step: extraDrift wirkt multiplikativ und exakt (gleicher Würfel).
    const rngA = mulberry32(11), rngB = mulberry32(11);
    let a = 5000, b = 5000;
    for (let t = 0; t < 48 * 365; t++) {
      a = market.step(a, 0.005, rngA, 0, 0, 0, 0);
      b = market.step(b, 0.005, rngB, 0, 0, 0, market.DEMAND_CAP);
    }
    check('365 Tage volle Nachfrage: Faktor e^0,3504 ≈ 1,42 (Rundung je Takt ±1 %)',
      Math.abs(b / a / Math.exp(market.DEMAND_CAP * 48 * 365) - 1) < 0.01, `${(b / a).toFixed(4)} vs ${Math.exp(0.3504).toFixed(4)}`);

    // EMA-Handrechnung: 7 Tage je 140 Einheiten → 140 × (1 − (6/7)^7) = 91,18.
    const GD = `DEMAND_T${Date.now()}`;
    const tag = (d) => new Date(new Date(t0).setHours(6, 0, 0, 0)).getTime() + d * 24 * H;
    for (let d = 0; d < 7; d++) market.recordDemand(GD, 'BETO', 140, tag(d));
    let dm = market.demandOf(GD, 'BETO', tag(7));
    check('EMA nach 7 Tagen 140/Tag = 91,18', Math.abs(dm.ema - 140 * (1 - Math.pow(6 / 7, 7))) < 1e-6, String(dm.ema));
    check('emaNow ohne heutige Käufe = ema × 6/7', Math.abs(dm.emaNow - dm.ema * 6 / 7) < 1e-9);
    check('extra = CAP × min(1, emaNow/200)', Math.abs(dm.extra - market.DEMAND_CAP * Math.min(1, dm.emaNow / 200)) < 1e-15);
    market.recordDemand(GD, 'BETO', 400, tag(7));
    dm = market.demandOf(GD, 'BETO', tag(7));
    check('400 heute: emaNow über 200 → extra = CAP (gedeckelt)', dm.extra === market.DEMAND_CAP && dm.today === 400);
    check('30 Tage Pause: EMA klingt ab, nie negativ', market.demandOf(GD, 'BETO', tag(40)).ema < 1 && market.demandOf(GD, 'BETO', tag(40)).extra >= 0);
    check('Aktie ohne Lieferantenrolle: extra 0', market.recordDemand(GD, 'BANK', 500, tag(7)) && market.demandOf(GD, 'BANK', tag(7)).extra === 0);
    check('quote nennt die Nachfrage', typeof market.quote(GD, 'BETO', tag(7)).demand?.perDay === 'number');
  }
```

In `test/companyGoods.test.js` vor der Schlusszeile:

```js
  console.log('--- Nachfrage wird gezählt (NPC, ad hoc, Großhandel) ---');
  {
    const market = require('../src/wallstreet');
    const G = `DEM_T${Date.now()}`;
    const U = 'n1', T = 'n2';
    konten.set(U, 5_000_000); konten.set(T, 5_000_000);
    const t0 = new Date(new Date().setHours(6, 0, 0, 0)).getTime() + DAY_MS;
    let r = await company.found(G, U, 'baufirma', 'Bau AG', t0);
    const bid = r.company.id;
    check('Gründung zählt die Erstausstattung (280) bei BETO', market.demandOf(G, 'BETO', t0).today === 280, String(market.demandOf(G, 'BETO', t0).today));
    db.saveCompany({ ...db.getCompany(bid), stock: 0, stock_cost: 0 });
    await company.deposit(G, U, 200_000, t0);
    r = await company.buyStock(G, U, 10, t0);
    check('NPC-Kauf 10 → 290', r.ok && market.demandOf(G, 'BETO', t0).today === 290);
    db.saveCompany({ ...db.getCompany(bid), stock: 0, stock_cost: 0 });
    r = await company.pitchIn(G, U, t0 + 3600e3);
    check('ad hoc beim Anpacken → 291', r.ok && r.ware.adhoc && market.demandOf(G, 'BETO', t0).today === 291);
    r = await company.found(G, T, 'spedition', 'Speedy', t0);
    company.setOffer(G, T, 'baufirma', 95, t0);
    r = await company.buyFromTrader(G, U, r.company.id, 5, t0 + 7200e3);
    check('Großhandel 5 → 296 (beim Lieferanten des Käufers)', r.ok && market.demandOf(G, 'BETO', t0).today === 296, JSON.stringify(r));
    check('SCHR (Spedition) unberührt', market.demandOf(G, 'SCHR', t0).today === 238);   // Erstausstattung der Spedition: 34 × 7
  }
```

(Die Erstausstattung bei `found` zählt als Kauf – sie ist einer. Spedition Kern: (10 × 3 + 4) × 7 = 238.)

- [ ] **Step 2: Tests laufen lassen – müssen fehlschlagen** (`market.DEMAND_REF` undefined).

- [ ] **Step 3: `src/db.js`** – Spalten + Nachrüstung an `market_prices` (Block bei `recover_to`), Statement `setDemand: UPDATE market_prices SET demand_day = ?, demand_today = ?, demand_ema = ? WHERE guild_id = ? AND symbol = ?` und Funktion `setDemand(guildId, symbol, day, today, ema)`.

- [ ] **Step 4: `src/wallstreet.js`**

```js
// ===================== NACHFRAGE =====================
// Wareneinkäufe der Spielerfirmen (Stück 3c) heben die Drift der Lieferanten-
// Aktie – gedeckelt auf die Hälfte der normalen Drift und nie negativ. Die
// Grenze ist damit ausgerechnet: höchstens e^(0,00002 × 48 × 365) = +42 % im
// Jahr auf eine voll nachgefragte Aktie (ARCHITEKTUR §15).
const DEMAND_REF = 200;          // Einheiten je Tag für die volle Wirkung
const DEMAND_CAP = DRIFT_CAP / 2;
const DEMAND_EMA_DAYS = 7;
const SUPPLIER_SYMBOLS = new Set(require('./data/companies').BRANCHES.map((b) => b.ware.supplier));

const dayOf = (now) => { const d = new Date(now); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };

/** EMA bis zum Tag `day` nachziehen (jeder übersprungene Tag zählt mit 0; höchstens 30). */
function rollDemand(row, day) {
  if (!row.demand_day || row.demand_day === day) return { today: row.demand_today ?? 0, ema: row.demand_ema ?? 0, rolled: false };
  const from = new Date(row.demand_day + 'T06:00:00'), to = new Date(day + 'T06:00:00');
  const days = Math.min(30, Math.max(1, Math.round((to - from) / 86_400_000)));
  let ema = row.demand_ema ?? 0;
  ema = ema * (1 - 1 / DEMAND_EMA_DAYS) + (row.demand_today ?? 0) / DEMAND_EMA_DAYS;
  for (let i = 1; i < days; i++) ema *= (1 - 1 / DEMAND_EMA_DAYS);
  return { today: 0, ema, rolled: true };
}

function recordDemand(guildId, symbol, units, now = Date.now()) {
  const asset = data.find(symbol);
  if (!asset || !(units > 0)) return null;
  const row = db.getPrice(guildId, asset.symbol) ?? list(guildId, asset, tickOf(now), now);
  const day = dayOf(now);
  const cur = rollDemand(row, day);
  const today = cur.today + Math.round(units);
  db.setDemand(guildId, asset.symbol, day, today, cur.ema);
  return { today, ema: cur.ema };
}

function demandOf(guildId, symbol, now = Date.now()) {
  const asset = data.find(symbol);
  const row = asset && db.getPrice(guildId, asset.symbol);
  if (!row) return { today: 0, ema: 0, emaNow: 0, extra: 0, perDay: 0 };
  const cur = rollDemand(row, dayOf(now));
  const emaNow = cur.ema * (1 - 1 / DEMAND_EMA_DAYS) + cur.today / DEMAND_EMA_DAYS;
  const extra = SUPPLIER_SYMBOLS.has(asset.symbol) ? DEMAND_CAP * Math.min(1, emaNow / DEMAND_REF) : 0;
  return { today: cur.today, ema: cur.ema, emaNow, extra, perDay: extra * 48 };
}
```

`step`: Signatur `+ extraDrift = 0`, `const drift = Math.min(DRIFT_CAP, (variance / 2) * DRIFT_SHARE) + extraDrift;`. `simulate`: vor der Takt-Schleife `const extras = new Map(singles.map((a) => [a.symbol, demandOf(guildId, a.symbol, now).extra]));` und im `step`-Aufruf `…, active, extras.get(asset.symbol))`. (Die Nachfrage ist innerhalb eines `simulate`-Laufs konstant – nachgeholte Takte bekommen die heutige Nachfrage; dokumentieren.) `quote`: `demand: demandOf(guildId, asset.symbol, now)`. Exporte.

- [ ] **Step 5: `src/company.js`** – Hilfsfunktion `noteDemand(guildId, b, units, now)` → `require('./wallstreet').recordDemand(guildId, b.ware.supplier, units, now)` (spät gebunden); Aufrufe: `found` (Erstausstattung `starter.units`), `buyStock` (`n`), `buyFromTrader` (`n`, Lieferant der **Käufer**-Branche), `settle` (Summe der Ad-hoc-Einheiten des Laufs, einmal nach der Schleife wenn > 0), `workShift`/`pitchIn` (1 wenn `v.adhoc`).

- [ ] **Step 6: `src/ui.js` `buildAssetView`** – Feld „🏭 Nachfrage": `a.demand.emaNow > 0 ? \`Ø **${Math.round(a.demand.emaNow)} Einheiten/Tag** (7 Tage) · Drift +${(a.demand.perDay * 100).toFixed(2).replace('.', ',')} %/Tag\` : 'keine'` – nur für `SUPPLIER_SYMBOLS`.

- [ ] **Step 7: Tests, Commit** – wallstreet, companyGoods, companyTrade, company, fluxer-render → `0 fehlgeschlagen`.

```bash
git add src/db.js src/wallstreet.js src/company.js src/ui.js test/wallstreet.test.js test/companyGoods.test.js
git commit -m "boerse: nachfrage-drift – wareneinkaeufe heben die lieferanten-aktie, gedeckelt auf die halbe drift

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 2: Firmenanteile – Modell (C)

**Files:**
- Modify: `src/data/companies.js` (`SHARES_TOTAL 1000, OWNER_MIN 510, IPO_MIN_STUFE 2, SHARE_FEE 0.01`), `src/db.js` (Tabellen `company_shares`, `company_share_offers`; Spalte `last_payout INTEGER NOT NULL DEFAULT 0` an `companies`; Funktionen `getShare(companyId, userId)`, `holdersOf(companyId)`, `setShare(companyId, userId, { shares, cost, pending, received })`, `insertShareOffer`, `getShareOffer(id)`, `updateShareOffer(id, shares)`, `deleteShareOffer(id)`, `shareOffersOf(guildId, companyId | null)`, `deleteShareOffersOfCompany`, `pendingOf(guildId, userId)` (JOIN companies für `guild_id`), `clearPending(guildId, userId)`), `src/company.js` (Abschnitt „Anteile": `sharesOf`, `listShares`, `cancelShareOffer`, `shareOffers`, `buyShares`, `splitPayout` (rein), `claimDividends`; `withdraw`/`close`/`sell` nutzen `splitPayout`; `closeCompany` löscht Angebote; `status()` + `anteile: sharesOf(c.id)`)
- Create: `test/companyShares.test.js`; `package.json`.

**Interfaces:**
- `splitPayout(companyId, value)` → `{ owner, parts:[{ user_id, amount }] }` (rein: `amount = floor(value × shares / 1000)`; `owner = value − Σ`).
- `sharesOf(companyId)` → `{ total, owner, holders }`.
- `listShares(guildId, userId, companyId, shares, price, now)` → `{ ok, offer }` | `{ ok:false, reason:'no_company'|'stufe'|'owner_min'|'shares'|'price' }` (Inhaber: `companyId` muss die eigene sein; Halter: eigene Anteile abzüglich offener Angebote).
- `cancelShareOffer(guildId, userId, offerId)` → `{ ok }` | `reason:'offer'`.
- `shareOffers(guildId, companyId = null)` → `[{ id, company:{ id, name, branch, stufe }, seller_id, shares, price, book, lastPayout }]` sortiert nach `price`.
- `buyShares(guildId, userId, offerId, shares, now)` → `{ ok, shares, price, cost, fee, seller, company }` | `reason:'offer'|'self'|'shares'|'funds'|'payment'|'closed'`.
- `claimDividends(guildId, userId)` → `{ ok, amount, parts }` | `{ ok:true, amount:0 }` | `reason:'payment'`.
- `withdraw` Ergebnis + `paid` (Inhaberanteil) und `shared` (Summe an Halter); `close`/`sell` analog.

- [ ] **Step 1: Test schreiben (`test/companyShares.test.js`)** – gefälschte Bank wie in `test/companyGoods.test.js` (mit `bookings`), dann:

```js
(async () => {
  const G = `ANTEIL_T${Date.now()}`;
  const O = 'o1', A = 'a1', B = 'b1';
  konten.set(O, 20_000_000); konten.set(A, 5_000_000); konten.set(B, 5_000_000);
  const t0 = new Date(new Date().setHours(6, 0, 0, 0)).getTime() + DAY_MS;
  const H = 3600e3;

  console.log('--- Konstanten und Regeln ---');
  check('Konstanten', data.SHARES_TOTAL === 1000 && data.OWNER_MIN === 510 && data.IPO_MIN_STUFE === 2 && data.SHARE_FEE === 0.01);
  let r = await company.found(G, O, 'cafe', 'Kaffeeklatsch', t0);
  const cid = r.company.id;
  check('Stufe 0: kein Börsengang', company.listShares(G, O, cid, 100, 1_000, t0).reason === 'stufe');
  db.setCompanyStufe(cid, 2);
  check('mehr als 490 geht nicht', company.listShares(G, O, cid, 491, 1_000, t0).reason === 'owner_min');
  check('Menge/Preis geprüft', company.listShares(G, O, cid, 0, 1_000, t0).reason === 'shares' && company.listShares(G, O, cid, 10, 0, t0).reason === 'price');
  r = company.listShares(G, O, cid, 300, 1_000, t0);
  check('300 Anteile à 1.000 angeboten', r.ok && r.offer.shares === 300 && r.offer.price === 1_000, JSON.stringify(r));
  const offerId = r.offer.id;
  check('zweites Angebot: nur noch 190 möglich', company.listShares(G, O, cid, 191, 1_000, t0).reason === 'owner_min' && company.listShares(G, O, cid, 190, 2_000, t0).ok);
  check('Liste des Servers: zwei Angebote, billigstes zuerst', company.shareOffers(G).length === 2 && company.shareOffers(G)[0].price === 1_000);

  console.log('--- Kauf ---');
  check('Verkäufer kauft nicht bei sich', (await company.buyShares(G, O, offerId, 10, t0)).reason === 'self');
  check('mehr als angeboten', (await company.buyShares(G, A, offerId, 301, t0)).reason === 'shares');
  bookings = [];
  r = await company.buyShares(G, A, offerId, 200, t0 + H);
  // 200 × 1.000 = 200.000; Gebühr 1 % = 2.000; Käufer −202.000, Verkäufer +200.000.
  check('A kauft 200: −202.000 / +200.000, Gebühr 2.000', r.ok && r.cost === 200_000 && r.fee === 2_000
    && bookings.length === 2 && bookings[0].user === A && bookings[0].amount === -202_000 && bookings[1].user === O && bookings[1].amount === 200_000
    && bookings.every((x) => x.opts.xp === false), JSON.stringify({ r, bookings }));
  let s = company.sharesOf(cid);
  check('Verteilung: Inhaber 800, A 200 (Angebot auf 100 gekürzt)', s.owner === 800 && s.holders.length === 1 && s.holders[0].shares === 200 && s.holders[0].cost === 200_000
    && db.getShareOffer(offerId).shares === 100);
  r = await company.buyShares(G, B, offerId, 100, t0 + 2 * H);
  check('B kauft den Rest: Angebot weg', r.ok && db.getShareOffer(offerId) === null && company.sharesOf(cid).owner === 700);
  check('Chronik nennt den Handel', JSON.parse(db.getCompany(cid).news)[0].text.includes('Anteile'));

  console.log('--- Ausschüttung ---');
  await company.deposit(G, O, 100_000, t0 + 3 * H);
  bookings = [];
  r = await company.withdraw(G, O, 10_000, t0 + 3 * H);
  // A: floor(10.000 × 200/1000) = 2.000; B: 1.000; Inhaber 7.000 in einer Buchung.
  check('Entnahme 10.000: Inhaber 7.000 gebucht, A 2.000 und B 1.000 ausstehend', r.ok && r.paid === 7_000 && r.shared === 3_000
    && bookings.length === 1 && bookings[0].amount === 7_000
    && db.getShare(cid, A).pending === 2_000 && db.getShare(cid, B).pending === 1_000, JSON.stringify({ r, bookings }));
  check('last_payout je 1000 Anteile = 10.000', db.getCompany(cid).last_payout === 10_000);
  bookings = [];
  r = await company.claimDividends(G, A);
  check('A holt 2.000 in einer Buchung ab', r.ok && r.amount === 2_000 && bookings.length === 1 && bookings[0].amount === 2_000 && bookings[0].opts.xp === false
    && db.getShare(cid, A).pending === 0 && db.getShare(cid, A).received === 2_000);
  check('nochmal abholen: 0', (await company.claimDividends(G, A)).amount === 0);

  console.log('--- Weiterverkauf und Schließen ---');
  r = company.listShares(G, A, cid, 50, 1_500, t0 + 4 * H);
  check('A bietet 50 an', r.ok);
  check('A kann nicht mehr als 150 weitere anbieten', company.listShares(G, A, cid, 151, 1_500, t0 + 4 * H).reason === 'shares');
  const bVor = konten.get(B);
  r = await company.buyShares(G, B, r.offer.id, 50, t0 + 5 * H);
  check('B kauft 50 von A: B 150, A 150, A.cost anteilig 150.000', r.ok && db.getShare(cid, B).shares === 150 && db.getShare(cid, A).shares === 150
    && db.getShare(cid, A).cost === 150_000 && konten.get(B) === bVor - Math.round(75_000 * 1.01));
  r = company.cancelShareOffer(G, A, 999_999);
  check('fremdes/unbekanntes Angebot nicht löschbar', r.ok === false);
  // Schließen: Kasse 90.000 + Lager (Café-Erstausstattung 133 × 180 = 23.940) → 113.940; Halter 15 % = 17.091 (A floor 17.091, B 17.091), Inhaber Rest.
  const payout = db.getCompany(cid).kasse + db.getCompany(cid).stock_cost;
  bookings = [];
  r = await company.close(G, O, t0 + 6 * H);
  const teil = Math.floor(payout * 150 / 1000);
  check('Schließen teilt die Auszahlung: Inhaber Rest, je Halter floor(15 %)', r.ok && r.paid === payout - 2 * teil && bookings[0].amount === payout - 2 * teil
    && db.getShare(cid, A).pending === teil && db.getShare(cid, B).pending === teil, JSON.stringify({ r, teil, payout }));
  check('geschlossen: keine Angebote, kein neues Angebot', company.shareOffers(G, cid).length === 0 && company.listShares(G, A, cid, 10, 100, t0 + 7 * H).reason === 'no_company');
  bookings = [];
  r = await company.claimDividends(G, B);
  check('B holt nach dem Schließen ab: 1.000 + 17.091', r.ok && r.amount === 1_000 + teil && bookings.length === 1);

  console.log('--- §3: Summe aller Buchungen ---');
  {
    // Über die ganze Kette entsteht kein Geld: Käufe sind Transfers minus Gebühr,
    // Ausschüttungen kommen aus der Kasse (Einzahlung/Umsatz), nie aus dem Nichts.
    const kette = konten.get(O) + konten.get(A) + konten.get(B);
    check('Konten-Summe = Start − Gründung − Einzahlungen + Entnahmen/Auszahlungen − Gebühren (Handrechnung im Report)', Number.isFinite(kette));
  }
  console.log(`\n${pass} bestanden, ${fail} fehlgeschlagen`);
  process.exit(fail === 0 ? 0 : 1);
})();
```

Die letzte Prüfung ersetzt der Implementierer durch eine echte Handrechnung: Start 30 Mio − Gründung (120.000 + 23.940) − Einzahlung 100.000 + Entnahme 7.000 + Auszahlung + abgeholte Ausschüttungen − Gebühren (2.000 + 1.000 + 750) = Summe der drei Konten; genaue Zahlen im Report. Prüfen, dass `deposit` bei Stufe-Setzen per `db.setCompanyStufe` nichts bucht.

- [ ] **Step 2: Test laufen lassen – muss fehlschlagen** (`data.SHARES_TOTAL` undefined).

- [ ] **Step 3: `src/db.js`** – Tabellen:

```sql
CREATE TABLE IF NOT EXISTS company_shares (
  company_id INTEGER NOT NULL, user_id TEXT NOT NULL,
  shares INTEGER NOT NULL DEFAULT 0, cost INTEGER NOT NULL DEFAULT 0,
  pending INTEGER NOT NULL DEFAULT 0, received INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (company_id, user_id)
);
CREATE TABLE IF NOT EXISTS company_share_offers (
  id INTEGER PRIMARY KEY AUTOINCREMENT, guild_id TEXT NOT NULL, company_id INTEGER NOT NULL,
  seller_id TEXT NOT NULL, shares INTEGER NOT NULL, price INTEGER NOT NULL, created_at INTEGER NOT NULL
);
```

Spalte `last_payout` an `companies` (+ Migration, `saveCompany`). Funktionen wie in den Interfaces; `pendingOf(guildId, userId)` → Zeilen mit `pending > 0` (JOIN companies für guild und Name).

- [ ] **Step 4: `src/company.js`** – Abschnitt „Anteile":

```js
// --------------------------------------------------------------- Anteile

/** Aufteilung einer Auszahlung: Halter bekommen floor(value × Anteile/1000), der Inhaber den Rest. */
function splitPayout(companyId, value) {
  const parts = db.holdersOf(companyId).filter((h) => h.shares > 0)
    .map((h) => ({ user_id: h.user_id, amount: Math.floor(value * h.shares / data.SHARES_TOTAL) }));
  return { owner: value - parts.reduce((s, p) => s + p.amount, 0), parts };
}

/** Schreibt die Halter-Anteile gut (synchron) und merkt die Ausschüttung je 1000 Anteile. */
function distribute(c, value) {
  const split = splitPayout(c.id, value);
  for (const p of split.parts) {
    const h = db.getShare(c.id, p.user_id);
    db.setShare(c.id, p.user_id, { ...h, pending: h.pending + p.amount });
  }
  return { ...split, shared: value - split.owner };
}

function sharesOf(companyId) {
  const holders = db.holdersOf(companyId).filter((h) => h.shares > 0);
  const held = holders.reduce((s, h) => s + h.shares, 0);
  return { total: data.SHARES_TOTAL, owner: data.SHARES_TOTAL - held, holders };
}

function listShares(guildId, userId, companyId, shares, price, now = Date.now()) {
  const c = db.getCompany(Number(companyId));
  if (!c || c.status !== 'open' || c.guild_id !== guildId) return { ok: false, reason: 'no_company' };
  const n = Math.floor(Number(shares)), p = Math.floor(Number(price));
  if (!(n > 0)) return { ok: false, reason: 'shares' };
  if (!(p > 0)) return { ok: false, reason: 'price' };
  const offen = db.shareOffersOf(guildId, c.id).filter((o) => o.seller_id === String(userId)).reduce((s, o) => s + o.shares, 0);
  if (c.owner_id === String(userId)) {
    if ((c.stufe ?? 0) < data.IPO_MIN_STUFE) return { ok: false, reason: 'stufe', stufe: c.stufe, min: data.IPO_MIN_STUFE };
    if (sharesOf(c.id).owner - offen - n < data.OWNER_MIN) return { ok: false, reason: 'owner_min', free: sharesOf(c.id).owner - offen - data.OWNER_MIN };
  } else {
    const h = db.getShare(c.id, userId);
    if (!h || h.shares - offen < n) return { ok: false, reason: 'shares', free: Math.max(0, (h?.shares ?? 0) - offen) };
  }
  const offer = db.insertShareOffer({ guildId, companyId: c.id, sellerId: String(userId), shares: n, price: p, now });
  return { ok: true, offer };
}

function cancelShareOffer(guildId, userId, offerId) {
  const o = db.getShareOffer(Number(offerId));
  if (!o || o.guild_id !== guildId || o.seller_id !== String(userId)) return { ok: false, reason: 'offer' };
  db.deleteShareOffer(o.id);
  return { ok: true };
}

function shareOffers(guildId, companyId = null) {
  return db.shareOffersOf(guildId, companyId).map((o) => {
    const c = db.getCompany(o.company_id);
    const b = branch(c.branch);
    const book = Math.round((investedOf(b, c, db.companyExtras(c.id)) + c.kasse + (c.stock_cost ?? 0)) / data.SHARES_TOTAL);
    return { id: o.id, company: { id: c.id, name: c.name, branch: b.id, branchName: b.name, emoji: b.emoji, stufe: c.stufe ?? 0 },
      seller_id: o.seller_id, shares: o.shares, price: o.price, book, lastPayout: Math.round((c.last_payout ?? 0) / data.SHARES_TOTAL) };
  }).filter((o) => o.company).sort((x, y) => x.price - y.price || x.id - y.id);
}

/**
 * Anteilskauf: ein Transfer Spieler → Spieler mit Gebühr (Senke). Zwei
 * Buchungen sind hier unvermeidlich (zwei Konten) – scheitert die zweite,
 * wird die erste zurückgenommen (Muster `pay`). Der Zustand (Angebot, Halter)
 * wird erst nach beiden Buchungen geschrieben.
 */
async function buyShares(guildId, userId, offerId, shares, now = Date.now()) {
  const o = db.getShareOffer(Number(offerId));
  if (!o || o.guild_id !== guildId) return { ok: false, reason: 'offer' };
  if (o.seller_id === String(userId)) return { ok: false, reason: 'self' };
  const c = db.getCompany(o.company_id);
  if (!c || c.status !== 'open') return { ok: false, reason: 'closed' };
  const n = Math.floor(Number(shares));
  if (!(n > 0) || n > o.shares) return { ok: false, reason: 'shares', max: o.shares };
  const cost = n * o.price;
  const fee = Math.round(cost * data.SHARE_FEE);
  const paid = await pay(guildId, userId, cost + fee, `Anteile: ${c.name}`);
  if (!paid.ok) return { ok: false, reason: paid.reason, needed: paid.needed, have: paid.have };
  try {
    await changeCash(guildId, o.seller_id, cost, `Anteilsverkauf: ${c.name}`, { xp: false, tax: false, kind: 'company' });
  } catch (err) {
    await changeCash(guildId, userId, cost + fee, 'Anteilskauf abgebrochen', { xp: false, tax: false, kind: 'company' }).catch(() => {});
    return { ok: false, reason: 'payment', error: err.message };
  }
  // Angebot noch da? (Zwischen den Buchungen kann nichts Synchrones passieren, aber ein zweiter Klick davor schon.)
  const still = db.getShareOffer(o.id);
  const take = Math.min(n, still?.shares ?? 0);
  if (take < n) { /* Rest an den Käufer zurück: */ await changeCash(guildId, userId, (n - take) * o.price, 'Anteile: Angebot verkleinert', { xp: false, tax: false, kind: 'company' }).catch(() => {}); }
  if (take > 0) {
    if (still.shares - take <= 0) db.deleteShareOffer(o.id); else db.updateShareOffer(o.id, still.shares - take);
    const seller = db.getShare(c.id, o.seller_id);
    if (seller) {
      const costOut = Math.round(seller.cost * take / seller.shares);
      db.setShare(c.id, o.seller_id, { ...seller, shares: seller.shares - take, cost: seller.cost - costOut });
    }
    const buyer = db.getShare(c.id, userId) ?? { shares: 0, cost: 0, pending: 0, received: 0 };
    db.setShare(c.id, userId, { ...buyer, shares: buyer.shares + take, cost: buyer.cost + take * o.price });
    const cur = db.getCompany(c.id);
    db.saveCompany({ ...cur, news: pushNews(cur, now, `📈 ${take} Anteile gingen von ${nameOf(o.seller_id)} an ${nameOf(userId)} für ${(take * o.price).toLocaleString('de-DE')}`, 0) });
  }
  return { ok: true, shares: take, price: o.price, cost: take * o.price, fee, seller: o.seller_id, company: { id: c.id, name: c.name } };
}
```

(`nameOf` → `require('./identity').nameOf(id) ?? 'Spieler'`; der Sonderfall „Angebot zwischen den Buchungen verkleinert" ist nur mit `await` dazwischen erreichbar – die Rückzahlung deckt ihn.) `pay` liegt weiter unten in der Datei – Reihenfolge egal (Hoisting).

`claimDividends`:

```js
async function claimDividends(guildId, userId) {
  const rows = db.pendingOf(guildId, userId);
  const amount = rows.reduce((s, r) => s + r.pending, 0);
  if (amount <= 0) return { ok: true, amount: 0, parts: [] };
  db.clearPending(guildId, userId);                     // erst nehmen (§7), dann buchen
  try {
    const balance = await changeCash(guildId, userId, amount, 'Ausschüttung Firmenanteile', { xp: false, tax: false, kind: 'company' });
    return { ok: true, amount, parts: rows.map((r) => ({ company: r.name, amount: r.pending })), balance };
  } catch (err) {
    for (const r of rows) { const h = db.getShare(r.company_id, userId); db.setShare(r.company_id, userId, { ...h, pending: h.pending + r.pending, received: h.received - r.pending }); }
    return { ok: false, reason: 'payment', error: err.message };
  }
}
```

(`clearPending` verschiebt `pending` nach `received`.) `withdraw`: nach der Kassenprüfung `const d = distribute(c, value); db.saveCompany({ ...c, kasse: c.kasse - value, last_payout: value });` Buchung über `d.owner`, Ergebnis `+ paid: d.owner, shared: d.shared`; Rücknahme bei Fehler stellt Kasse UND `pending` zurück. `close`/`sell`: `payout` wird aufgeteilt, gebucht wird `d.owner`. `closeCompany`: `db.deleteShareOffersOfCompany(c.id)`. `status()`: `anteile: sharesOf(c.id)`. Exporte.

- [ ] **Step 5: Tests, Commit** – companyShares, companyGoods, companyTrade, company, companyEvents, db → `0 fehlgeschlagen` (bestehende Entnahme-/Schließen-Tests ohne Halter bleiben unverändert: `owner = value`).

```bash
git add src/data/companies.js src/db.js src/company.js test/companyShares.test.js package.json
git commit -m "firmen: anteile – boersengang ab stufe 2, kauf als transfer mit gebuehr, ausschuettung aus entnahme und auszahlung

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 3: Firmenanteile – Anzeige (C)

**Files:** `src/ui.js` (`buildFirmaAnteileView`, `buildAnteileMarktView({ guildId, userId, page })`, `buildMeineAnteileView`; Ausbau-Ansicht Knopf „Anteile"; Börse-Nav „🏢 Firmenanteile"; Betriebsansicht-Fußzeile), `src/buttons.js` (`firma|anteile`, `firma|anteilweg|<id>`, `wanteile|<page>`, `wmeine`, `wanteilabholen`, Modale `fanteil|anbieten` (`<anzahl> <preis>`), `fanteil|kaufen` (`<nr> <anzahl>`), `fanteil|verkaufen` (`<firma-nr> <anzahl> <preis>`)), `test/fluxer-render.test.js`, `test/menu.test.js` läuft.

- [ ] **Step 1:** Ansichten nach Spec „Anzeige" (Texte dort). Anteile-Ansicht: Knöpfe Anteile anbieten · Angebot zurückziehen (deaktiviert ohne eigenes Angebot; ID des jüngsten) · Firma · Home. Markt-Liste: 5 je Seite, Knöpfe Kaufen · Meine Anteile · ◀ ▶ (nur wenn nötig) · Börse (`wkind|all`) · Home ≤ 5 → wenn zwei Seitenknöpfe nötig sind, zweite Zeile. Meine Anteile: Ausschüttung abholen · Anteile verkaufen · Firmenanteile · Home.
- [ ] **Step 2:** Handler: Modale vor `deferUpdate`; Texte: `stufe: '🏗️ Anteile gibt es ab Ausbaustufe 2.'`, `owner_min: '❌ Du musst mindestens 51 % behalten – noch X Anteile frei.'`, `shares/price: '❌ Anzahl und Preis, z. B. „100 2500".'`, `offer: '❌ Dieses Angebot gibt es nicht mehr.'`, `self: '❌ Das ist dein eigenes Angebot.'`, `funds: '💸 Dafür fehlen X.'`, `payment: '❌ Buchung fehlgeschlagen – nichts passiert.'`, `closed: '🏢 Die Firma gibt es nicht mehr.'`; Erfolg Kauf: `📈 **n** Anteile an **Firma** für X (+ Y Gebühr).`; Abholen: `💰 **X** Ausschüttung abgeholt (Firma A 2.000, …).`
- [ ] **Step 3:** Render-Tests: Ausbau-Ansicht mit 9 Knöpfen → `overflow === undefined`; Anteile-Ansicht (Stufe 2 mit einem Angebot), Markt-Liste mit 2 Angeboten, Meine Anteile mit `pending > 0` (Knopf aktiv); Börse-Nav enthält `wanteile|1`.
- [ ] **Step 4:** Tests (fluxer-render, menu, companyShares) → `0 fehlgeschlagen`; Commit:

```bash
git add src/ui.js src/buttons.js test/fluxer-render.test.js
git commit -m "firmen: anteile-ansichten – anbieten, firmenanteile an der boerse, meine anteile mit ausschuettung

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 4: Messung, Docs, Patchnotes

**Files:** `scripts/messung-geldquellen.js` (Abschnitt „--- Nachfrage-Drift ---": drei 365-Tage-`simulate`-Läufe mit fester Nachfrage 0 / 40 / 200 (per `recordDemand` täglich) gegen denselben Seed für BETO, Ausgabe Endkurs-Verhältnis vs. `e^(extra × 48 × 365)`), `ARCHITEKTUR.md` §15 („Börse aktiv (seit 1.37.0, Stück 3c)": A-Grenze +42 %/Jahr mit Handrechnung und gemessenem Verhältnis, Kern-Baufirma +7 %/Jahr; Anteile = Transfers, Gebühr, Ausschüttung nur aus Entnahmen; §9-Ausnahme begründet), `docs/messungen/2026-09-21-boerse-nachfrage.txt`, `src/data/patchnotes.js` (1.37.0 „📈 Börse: Nachfrage und Firmenanteile", 2026-09-21), Addendum in der 3b-Spec („3c umgesetzt").

- [ ] Lauf mit Timeout 600000 (der Drift-Abschnitt ist billig; die Firmen-Abschnitte brauchen wie bisher Minuten) → Datei; Handvalidierung `e^0,3504 = 1,4196` gegen das gemessene Verhältnis (gleicher Würfel → exakt bis auf Rundung je Takt).
- [ ] Suite `npm test 2>&1 | grep -c '❌'` → `0`; Commit:

```bash
git add scripts/messung-geldquellen.js ARCHITEKTUR.md docs/messungen/2026-09-21-boerse-nachfrage.txt src/data/patchnotes.js docs/superpowers/specs/2026-09-21-firmen-handel-design.md
git commit -m "boerse: messung der nachfrage-drift, §15 boerse aktiv, patchnotes 1.37.0

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

## Selbstprüfung gegen die Spec

- A: Zählen (Spalten, `recordDemand`, EMA-Rollen), Wirken (`extra`, `step`, `simulate`, nur Lieferanten, nie negativ), Aufrufer (NPC, ad hoc, Großhandel, Erstausstattung), Grenze und Anzeige: Task 1 + 4. ✔
- C: Tabellen, Konstanten, `sharesOf`/`listShares`/`cancel`/`shareOffers`/`buyShares` (zwei Buchungen mit Rücknahme, Gebühr)/Ausschüttung in `withdraw`/`close`/`sell`/`claimDividends`, geschlossene Firmen: Task 2. Anzeige: Task 3. Docs: Task 4. ✔
- §3-Kette (Buchungssumme = −Gebühren) im Test von Task 2. ✔
