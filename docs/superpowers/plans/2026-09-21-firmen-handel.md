# Firmen Stück 3b – Handel (Spedition als Großhändler) – Implementierungsplan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Die Spedition kann die Ware jeder Branche mit Großhandelsrabatt liefern; andere Spielerfirmen kaufen bei ihr statt beim NPC-Markt; Geld fließt Kasse → Kasse, gedeckelt und gemessen.

**Architecture:** Angebote in der Tabelle `company_offers` (Anteil des NPC-Tagespreises, 90–100 %); Tageszähler `trade_day/trade_today` und Summen `trade_units/trade_profit` an der Firma; reine Preisrechnung `tradeQuote(npcPrice, share)`; `setOffer`, `offersOf`, `offersFor`, `buyFromTrader` in `src/company.js`; Käuferseite in der Lager-Ansicht, Händlerseite in einer neuen Handel-Ansicht; Messung `handelslauf`.

**Tech Stack:** Node.js, better-sqlite3 (synchron), discord.js-Builder, eigene Tests, Messskript.

## Global Constraints

- Spec: `docs/superpowers/specs/2026-09-21-firmen-handel-design.md` (bindend).
- Konstanten wörtlich: `HANDEL_RABATT = 0.10`, `HANDEL_SHARE_MIN = 90`, `HANDEL_SHARE_MAX = 100`, `HANDEL_KAPAZITAET = 20`; nur Branchen mit `handel: true` (Spedition) bieten an.
- Preise: `price = Math.round(npcPrice × share / 100)`, `wholesale = Math.round(npcPrice × (1 − HANDEL_RABATT))`, `spread = price − wholesale ≥ 0`. Handrechnung Kiosk-Ware (NPC 50): 95 % → 48 / 45 / 3; Baufirma-Ware (340): 323 / 306 / 17.
- Kauf synchron ohne `unb` (§7/§9: Kasse → Kasse), beide Firmen je ein `saveCompany`, Chronik beidseitig; `n = min(units, freie Lagerplätze, Tageskapazität)`; Tageskapazität `eff.slots × 20 − trade_today` (Tag = `dayKey`).
- §3: Handels-Decke Käufer = Decke + `0,1 × units × wareUnit`; Spediteur = `eff.slots × 20 × round(480 × 0,1)` (Kern 9.600, voll 19.200); Test und §15.
- Tests `rm -rf .testdata && DATA_DIR=.testdata node test/<x>.test.js`; Suite `npm test 2>&1 | grep -c '❌'` → `0`; gefälschte Bank wie in `test/companyGoods.test.js`. Deutsch; Trailer wörtlich `Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>`.

---

### Task 1: Angebote, Preisrechnung, Kauf (Kern)

**Files:**
- Modify: `src/data/companies.js` (Konstanten, `handel: true` an der Spedition, Export), `src/db.js` (Tabelle `company_offers`, Spalten `trade_day TEXT DEFAULT ''`, `trade_today INTEGER DEFAULT 0`, `trade_units INTEGER DEFAULT 0`, `trade_profit INTEGER DEFAULT 0` + Migration + `saveCompany`; Statements/Funktionen `upsertOffer(companyId, branch, share, active, now)`, `offersOfCompany(companyId)`, `activeOffersFor(guildId, branch)` (JOIN companies, `status='open'`), `deleteOffersOfCompany(companyId)` in `closeCompany`), `src/company.js` (`tradeQuote`, `isTrader(b)`, `tradeCapacity`, `setOffer`, `offersOf`, `offersFor`, `buyFromTrader`, `status().handel` für Spediteure `{ today, capacity, units, profit, offers }` und `status().angebote` für alle (Ergebnis von `offersFor`), Exporte)
- Create: `test/companyTrade.test.js`; `package.json` (`&& node test/companyTrade.test.js` nach `companyGoods`)

**Interfaces:**
- `tradeQuote(npcPrice, share) → { price, wholesale, spread }` (rein).
- `setOffer(guildId, userId, branchId | 'alle', share | 'aus', now) → { ok, offers } | { ok:false, reason:'no_company'|'not_trader'|'branch'|'share' }`.
- `offersOf(guildId, companyId) → [{ branch, ware:{name,emoji}, share, active }]` (alle neun, Katalogreihenfolge).
- `offersFor(guildId, buyerBranchId, now) → [{ company:{id,name}, share, price, wholesale, spread, left }]` sortiert `price asc, name asc`, nur offene, nicht geschlossene Spediteure mit `left > 0`.
- `buyFromTrader(guildId, buyerUserId, traderCompanyId, units | 'voll', now) → { ok, units, price, wholesale, cost, spread, trader:{id,name}, stock, kasse } | { ok:false, reason:'no_company'|'trader'|'self'|'capacity'|'kasse', free?, left?, cost?, kasse? }`.

- [ ] **Step 1: Test schreiben**

```js
// test/companyTrade.test.js
/**
 * Firmen Stück 3b: Spedition als Großhändler – Angebote, Preise, Kauf, Decken.
 * Aufruf: DATA_DIR=.testdata node test/companyTrade.test.js
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

let pass = 0, fail = 0;
const check = (label, ok, extra = '') => {
  if (ok) { pass++; console.log(`  ✅ ${label}`); }
  else { fail++; console.log(`  ❌ ${label} ${extra}`); }
};
const DAY_MS = 24 * 60 * 60 * 1000;
const H = 60 * 60 * 1000;
const seq = (...v) => { let i = 0; return () => (i < v.length ? v[i++] : 0.5); };
const keinWurf = () => 0.5;

(async () => {
  console.log('--- Konstanten und Preisrechnung ---');
  {
    check('Konstanten', data.HANDEL_RABATT === 0.1 && data.HANDEL_SHARE_MIN === 90 && data.HANDEL_SHARE_MAX === 100 && data.HANDEL_KAPAZITAET === 20);
    check('nur die Spedition handelt', data.BRANCHES.filter((b) => b.handel).map((b) => b.id).join() === 'spedition');
    const q = company.tradeQuote(50, 95);
    check('Kiosk-Ware 50 bei 95 %: 48 / 45 / 3', q.price === 48 && q.wholesale === 45 && q.spread === 3, JSON.stringify(q));
    const q2 = company.tradeQuote(340, 95);
    check('Baufirma-Ware 340 bei 95 %: 323 / 306 / 17', q2.price === 323 && q2.wholesale === 306 && q2.spread === 17, JSON.stringify(q2));
    check('bei 90 % ist die Spanne 0', company.tradeQuote(50, 90).spread === 0);
    check('bei 100 % zahlt der Käufer den NPC-Preis', company.tradeQuote(50, 100).price === 50);
  }

  console.log('--- Angebote ---');
  {
    const G = `HANDEL_T${Date.now()}`;
    const T = 't1', K = 'k1', B = 'b1';
    konten.set(T, 5_000_000); konten.set(K, 1_000_000); konten.set(B, 5_000_000);
    const t0 = new Date(new Date().setHours(6, 0, 0, 0)).getTime() + DAY_MS;
    let r = await company.found(G, T, 'spedition', 'Speedy GmbH', t0);
    const tid = r.company.id;
    r = await company.found(G, K, 'kiosk', 'Eckladen', t0);
    const kid = r.company.id;
    r = await company.found(G, B, 'baufirma', 'Bau AG', t0);
    const bid = r.company.id;

    check('Kiosk darf nicht anbieten', (company.setOffer(G, K, 'kiosk', 95, t0)).reason === 'not_trader');
    check('unbekannte Branche', (company.setOffer(G, T, 'bank', 95, t0)).reason === 'branch');
    check('Anteil außerhalb 90–100', company.setOffer(G, T, 'kiosk', 89, t0).reason === 'share' && company.setOffer(G, T, 'kiosk', 101, t0).reason === 'share'
      && company.setOffer(G, T, 'kiosk', 'x', t0).reason === 'share');
    r = company.setOffer(G, T, 'alle', 95, t0);
    check('alle auf 95 %: neun aktive Angebote', r.ok && r.offers.length === 9 && r.offers.every((o) => o.active && o.share === 95), JSON.stringify(r.offers?.length));
    r = company.setOffer(G, T, 'kiosk', 'aus', t0);
    check('kiosk aus', r.ok && r.offers.find((o) => o.branch === 'kiosk').active === false && r.offers.filter((o) => o.active).length === 8);
    r = company.setOffer(G, T, 'kiosk', 97, t0);
    check('kiosk wieder an mit 97 %', r.ok && r.offers.find((o) => o.branch === 'kiosk').share === 97 && r.offers.find((o) => o.branch === 'kiosk').active === true);
    check('offersOf: neun Zeilen in Katalogreihenfolge', company.offersOf(G, tid).map((o) => o.branch).join() === data.BRANCHES.map((b) => b.id).join());

    // Käufersicht: ein Angebot für die Kiosk-Ware, Preis 49 (97 % von 50 = 48,5 → 49), Kapazität 10 × 20 = 200.
    let list = company.offersFor(G, 'kiosk', t0);
    check('offersFor kiosk: Speedy 49 statt 50, 200 übrig', list.length === 1 && list[0].price === 49 && list[0].wholesale === 45 && list[0].spread === 4 && list[0].left === 200 && list[0].company.name === 'Speedy GmbH', JSON.stringify(list));

    // Kauf: Kiosk-Lager ist nach der Gründung voll (70) → erst 20 verbrauchen.
    db.saveCompany({ ...db.getCompany(kid), stock: 50, stock_cost: 2_500 });
    const kVor = db.getCompany(kid).kasse, tVor = db.getCompany(tid).kasse;
    r = await company.buyFromTrader(G, K, tid, 20, t0 + H);
    check('20 Einheiten bei Speedy: Käufer −980, Lager 70 / 3.480; Spediteur +80 Spanne, heute 20/200',
      r.ok && r.units === 20 && r.price === 49 && r.cost === 980 && r.spread === 80
      && db.getCompany(kid).kasse === kVor - 980 && db.getCompany(kid).stock === 70 && db.getCompany(kid).stock_cost === 3_480
      && db.getCompany(tid).kasse === tVor + 80 && db.getCompany(tid).trade_today === 20 && db.getCompany(tid).trade_units === 20 && db.getCompany(tid).trade_profit === 80,
      JSON.stringify({ r, k: db.getCompany(kid).kasse - kVor, t: db.getCompany(tid).kasse - tVor }));
    check('keine Buchung nach außen', bookings.filter((x) => x.reason.includes('Speedy') || x.reason.includes('Eckladen')).length === 0);
    check('Chronik beidseitig', JSON.parse(db.getCompany(kid).news)[0].text.includes('Speedy GmbH') && JSON.parse(db.getCompany(tid).news)[0].text.includes('Eckladen'));
    r = await company.buyFromTrader(G, K, tid, 5, t0 + H);
    check('Lager voll → capacity mit free 0', r.ok === false && r.reason === 'capacity' && r.free === 0, JSON.stringify(r));

    // Baufirma: 'voll' begrenzt durch die Tageskapazität (Spediteur hat noch 180).
    db.saveCompany({ ...db.getCompany(bid), stock: 0, stock_cost: 0 });
    const bVor = db.getCompany(bid).kasse;
    r = await company.buyFromTrader(G, B, tid, 'voll', t0 + 2 * H);
    check("'voll' liefert 180 (Tageskapazität), 323 je Einheit, Spanne 17 × 180 = 3.060",
      r.ok && r.units === 180 && r.price === 323 && r.cost === 180 * 323 && r.spread === 3_060 && db.getCompany(bid).kasse === bVor - 180 * 323
      && db.getCompany(bid).stock === 180 && db.getCompany(tid).trade_today === 200, JSON.stringify(r));
    r = await company.buyFromTrader(G, B, tid, 10, t0 + 3 * H);
    check('Kapazität des Tages erschöpft → capacity mit left 0', r.ok === false && r.reason === 'capacity' && r.left === 0, JSON.stringify(r));
    check('offersFor blendet Spediteure ohne Kapazität aus', company.offersFor(G, 'baufirma', t0 + 3 * H).length === 0);
    r = await company.buyFromTrader(G, B, tid, 10, t0 + DAY_MS + H);
    check('nächster Tag: Kapazität zurück (trade_today 10)', r.ok && db.getCompany(tid).trade_today === 10, JSON.stringify(r));

    // Kasse des Käufers reicht nicht.
    db.saveCompany({ ...db.getCompany(bid), kasse: 100 });
    r = await company.buyFromTrader(G, B, tid, 10, t0 + DAY_MS + 2 * H);
    check('Kasse zu klein → kasse mit cost 3.230', r.ok === false && r.reason === 'kasse' && r.cost === 3_230, JSON.stringify(r));

    // Geschlossener Spediteur liefert nicht; inaktives Angebot auch nicht.
    db.saveCompany({ ...db.getCompany(tid), closed_until: t0 + 3 * DAY_MS });
    db.saveCompany({ ...db.getCompany(bid), kasse: 1_000_000 });
    r = await company.buyFromTrader(G, B, tid, 10, t0 + DAY_MS + 3 * H);
    check('geschlossener Spediteur → trader', r.ok === false && r.reason === 'trader');
    check('… und fehlt in offersFor', company.offersFor(G, 'baufirma', t0 + DAY_MS + 3 * H).length === 0);
    db.saveCompany({ ...db.getCompany(tid), closed_until: 0 });
    company.setOffer(G, T, 'baufirma', 'aus', t0 + DAY_MS + 3 * H);
    r = await company.buyFromTrader(G, B, tid, 10, t0 + DAY_MS + 3 * H);
    check('inaktives Angebot → trader', r.ok === false && r.reason === 'trader');

    // status: Spediteur sieht Handel, Käufer sieht Angebote.
    company.setOffer(G, T, 'baufirma', 95, t0 + DAY_MS + 3 * H);
    const st = company.status(G, T, t0 + DAY_MS + 3 * H);
    // Spanne gesamt: 20 × 4 (Kiosk 97 %) + 180 × 17 + 10 × 17 (Baufirma 95 %) = 80 + 3.060 + 170 = 3.310.
    check('status Spediteur: handel { today 10, capacity 200, units 210, profit 3.310 }',
      st.handel && st.handel.today === 10 && st.handel.capacity === 200 && st.handel.units === 210 && st.handel.profit === 3_310, JSON.stringify(st.handel));
    const sb = company.status(G, B, t0 + DAY_MS + 3 * H);
    check('status Käufer: angebote mit Speedy', sb.angebote.length === 1 && sb.angebote[0].company.name === 'Speedy GmbH' && sb.handel === null);

    // Schließen räumt Angebote weg.
    await company.close(G, T, t0 + DAY_MS + 4 * H);
    check('geschlossen: keine Angebote mehr', company.offersFor(G, 'baufirma', t0 + DAY_MS + 4 * H).length === 0 && db.offersOfCompany(tid).length === 0);
  }

  console.log('--- §3: Handels-Decken ---');
  {
    const byId = Object.fromEntries(data.BRANCHES.map((b) => [b.id, b]));
    const sp = byId.spedition;
    const teuerste = Math.max(...data.BRANCHES.map((b) => company.wareUnit(b)));
    check('teuerste Ware ist der Club mit 480', teuerste === 480);
    check('Spediteur Kern: 10 × 20 × 48 = 9.600/Tag', sp.slots * data.HANDEL_KAPAZITAET * Math.round(teuerste * data.HANDEL_RABATT) === 9_600);
    const effVoll = company.effectiveOf({ id: 0, stufe: data.MAX_STUFE }, sp, sp.extras.map((e) => e.id));
    check('Spediteur voll: 20 × 20 × 48 = 19.200/Tag', effVoll.slots * data.HANDEL_KAPAZITAET * 48 === 19_200);
    const k = company.ceilingOf(byId.kiosk);
    check('Käufer Kiosk: Handels-Decke = 2.350 + 0,1 × 500 = 2.400', k.net + Math.round(0.1 * k.ware) === 2_400);
  }

  console.log(`\n${pass} bestanden, ${fail} fehlgeschlagen`);
  process.exit(fail === 0 ? 0 : 1);
})();
```

Hinweis zur Handrechnung: 97 % von 50 = 48,5 → `Math.round` = 49 (JS rundet ,5 auf); Spanne 49 − 45 = 4; 20 × 4 = 80. Kiosk-Lager: Gründung liefert 70 (Erstausstattung), im Test auf 50/2.500 gesetzt, danach 70/3.480 (2.500 + 980). Spediteur nach drei Käufen: 20 + 180 + 10 = 210 Einheiten, Spanne 80 + 3.060 + 170 = 3.310.

- [ ] **Step 2: Test laufen lassen – muss fehlschlagen** (`Konstanten` ❌).

- [ ] **Step 3: Daten und DB**

`data/companies.js`: `HANDEL_RABATT = 0.10; HANDEL_SHARE_MIN = 90; HANDEL_SHARE_MAX = 100; HANDEL_KAPAZITAET = 20;` exportieren; Spedition-Eintrag `handel: true`.

`db.js`: Tabelle
```sql
CREATE TABLE IF NOT EXISTS company_offers (
  company_id INTEGER NOT NULL,
  branch     TEXT    NOT NULL,
  share      INTEGER NOT NULL,
  active     INTEGER NOT NULL DEFAULT 1,
  updated_at INTEGER NOT NULL,
  PRIMARY KEY (company_id, branch)
);
```
Spalten `trade_day TEXT NOT NULL DEFAULT ''`, `trade_today INTEGER NOT NULL DEFAULT 0`, `trade_units INTEGER NOT NULL DEFAULT 0`, `trade_profit INTEGER NOT NULL DEFAULT 0` (CREATE, PRAGMA-Liste, `saveCompany`). Funktionen: `upsertOffer(companyId, branch, share, active, now)` (`INSERT … ON CONFLICT(company_id, branch) DO UPDATE SET share=excluded.share, active=excluded.active, updated_at=excluded.updated_at`), `offersOfCompany(companyId)`, `activeOffersFor(guildId, branch)` (`SELECT o.*, c.* FROM company_offers o JOIN companies c ON c.id = o.company_id WHERE c.guild_id = ? AND o.branch = ? AND o.active = 1 AND c.status = 'open'`), `deleteOffersOfCompany(companyId)` – in `closeCompany` aufrufen.

- [ ] **Step 4: `src/company.js`**

```js
// ---------------------------------------------------------------- Handel

/** Preis, Großhandelspreis und Spanne je Einheit – rein. */
function tradeQuote(npcPrice, share) {
  const price = Math.round(npcPrice * share / 100);
  const wholesale = Math.round(npcPrice * (1 - data.HANDEL_RABATT));
  return { price, wholesale, spread: price - wholesale };
}
const isTrader = (b) => !!b.handel;

/** Wie viele Einheiten der Spediteur heute noch liefern kann. */
function tradeCapacity(c, b, now) {
  const eff = effectiveOf(c, b);
  const max = eff.slots * data.HANDEL_KAPAZITAET;
  const today = c.trade_day === dayKey(now) ? c.trade_today : 0;
  return { max, today, left: Math.max(0, max - today) };
}

function offersOf(guildId, companyId) {
  const rows = new Map(db.offersOfCompany(companyId).map((o) => [o.branch, o]));
  return data.BRANCHES.map((b) => {
    const o = rows.get(b.id);
    return { branch: b.id, ware: b.ware, share: o?.share ?? data.HANDEL_SHARE_MAX, active: !!o?.active };
  });
}

function setOffer(guildId, userId, branchId, share, now = Date.now()) {
  const ctx = ownerContext(guildId, userId);
  if (!ctx) return { ok: false, reason: 'no_company' };
  if (!isTrader(ctx.branch)) return { ok: false, reason: 'not_trader' };
  const targets = branchId === 'alle' ? data.BRANCHES.map((b) => b.id) : [String(branchId)];
  if (!targets.every((id) => branch(id))) return { ok: false, reason: 'branch' };
  const aus = share === 'aus';
  const n = Math.floor(Number(share));
  if (!aus && (!Number.isFinite(n) || n < data.HANDEL_SHARE_MIN || n > data.HANDEL_SHARE_MAX)) return { ok: false, reason: 'share' };
  for (const id of targets) {
    const cur = db.offersOfCompany(ctx.company.id).find((o) => o.branch === id);
    db.upsertOffer(ctx.company.id, id, aus ? (cur?.share ?? data.HANDEL_SHARE_MAX) : n, aus ? 0 : 1, now);
  }
  return { ok: true, offers: offersOf(guildId, ctx.company.id) };
}

/** Aktive Angebote offener, nicht geschlossener Spediteure für die Ware einer Branche. */
function offersFor(guildId, buyerBranchId, now = Date.now()) {
  const b = branch(buyerBranchId);
  if (!b) return [];
  const npc = wareOf(guildId, b).price;
  return db.activeOffersFor(guildId, b.id)
    .filter((row) => !(row.closed_until > now))
    .map((row) => {
      const c = db.getCompany(row.company_id);
      const cap = tradeCapacity(c, branch(c.branch), now);
      return { company: { id: c.id, name: c.name }, share: row.share, ...tradeQuote(npc, row.share), left: cap.left };
    })
    .filter((o) => o.left > 0)
    .sort((x, y) => x.price - y.price || x.company.name.localeCompare(y.company.name, 'de'));
}

/**
 * Kauf beim Spediteur: Kasse → Kasse, synchron, ohne Buchung nach außen. Der
 * Spediteur zahlt den Großhandelspreis sofort aus dem Erlös – er braucht
 * weder Lager noch Zeit, nur Kapazität (Plätze × HANDEL_KAPAZITAET je Tag).
 */
async function buyFromTrader(guildId, buyerUserId, traderCompanyId, units, now = Date.now()) {
  const ctx = fresh(guildId, buyerUserId, now);
  if (!ctx) return { ok: false, reason: 'no_company' };
  const { company: c, branch: b } = ctx;
  if (c.id === Number(traderCompanyId)) return { ok: false, reason: 'self' };
  settle(Number(traderCompanyId), now);
  const t = db.getCompany(Number(traderCompanyId));
  const tb = t ? branch(t.branch) : null;
  const offer = t && db.offersOfCompany(t.id).find((o) => o.branch === b.id && o.active);
  if (!t || t.status !== 'open' || !tb || !isTrader(tb) || !offer || t.closed_until > now) return { ok: false, reason: 'trader' };
  const eff = effectiveOf(c, b);
  const free = capacityOf(b, eff) - (c.stock ?? 0);
  const cap = tradeCapacity(t, tb, now);
  const want = units === 'voll' ? Infinity : Math.floor(Number(units));
  const n = Math.min(want, free, cap.left);
  if (!Number.isFinite(want) && want !== Infinity || n <= 0) return { ok: false, reason: 'capacity', free, left: cap.left };
  const q = tradeQuote(wareOf(guildId, b).price, offer.share);
  const cost = n * q.price;
  if (c.kasse < cost) return { ok: false, reason: 'kasse', cost, kasse: c.kasse };
  const spread = n * q.spread;
  const buyer = { ...c, kasse: c.kasse - cost, stock: (c.stock ?? 0) + n, stock_cost: (c.stock_cost ?? 0) + cost };
  buyer.news = pushNews(buyer, now, `🚚 ${n} ${b.ware.name} von ${t.name} für ${cost.toLocaleString('de-DE')}`, -cost);
  const trader = { ...t, kasse: t.kasse + spread, trade_day: dayKey(now), trade_today: cap.today + n,
    trade_units: (t.trade_units ?? 0) + n, trade_profit: (t.trade_profit ?? 0) + spread };
  trader.news = pushNews(trader, now, `🚚 ${n} ${b.ware.name} an ${c.name} geliefert: +${spread.toLocaleString('de-DE')} Spanne`, spread);
  db.saveCompany(buyer); db.saveCompany(trader);
  return { ok: true, units: n, price: q.price, wholesale: q.wholesale, cost, spread, trader: { id: t.id, name: t.name }, stock: buyer.stock, kasse: buyer.kasse };
}
```

(`want`-Prüfung sauber schreiben: `const want = units === 'voll' ? Infinity : Math.floor(Number(units)); if (!(want > 0)) return { ok:false, reason:'capacity', free, left: cap.left };`.) `status()`: `handel: isTrader(b) ? { ...tradeCapacity(c, b, now), units: c.trade_units ?? 0, profit: c.trade_profit ?? 0, offers: offersOf(guildId, c.id) } : null`, `angebote: offersFor(guildId, b.id, now)`. `closeCompany`: `db.deleteOffersOfCompany(c.id)`. Exporte.

- [ ] **Step 5: Tests, package.json, Commit** – `companyTrade`, `companyGoods`, `company`, `companyEvents`, `db` → `0 fehlgeschlagen`.

```bash
git add src/data/companies.js src/db.js src/company.js test/companyTrade.test.js package.json
git commit -m "firmen: spedition als grosshaendler – angebote, kauf kasse zu kasse, tageskapazitaet

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 2: Anzeige

**Files:**
- Modify: `src/ui.js` (Lager-Ansicht: Abschnitt „🚚 Spediteure" + Knopf „Bei Spediteur kaufen" wenn `s.angebote.length`, Knopf „Handel" für Spediteure; neue `buildFirmaHandelView`; Betriebsansicht: Handel-Zeile im Waren-Feld für Spediteure), `src/buttons.js` (`firma|handel`, `firma|handelaus`, Modal `fhandel|setzen`, Modal `fware|handel`), `test/fluxer-render.test.js`

**Interfaces:** Consumes `status().handel`, `status().angebote`, `company.setOffer`, `company.buyFromTrader`. Produces `buildFirmaHandelView({ guildId, userId })`; IDs `firma|handel|0|<uid>`, `firma|handelaus|0|<uid>`, `fhandel|setzen|<uid>` (Feld `text`: `<branche|alle> <prozent|aus>`), `fware|handel|<uid>` (Feld `amount`, „voll").

- [ ] **Step 1: Lager-Ansicht (Käufer)** – nach den Feldern, wenn `s.angebote.length`: Feld „🚚 Spediteure" mit bis zu drei Zeilen `**Name** ${money(price)} statt ${money(npc)} (${share} %) · heute noch ${left} Einheiten`; Knopf `firma|handelkauf|0|<uid>` „Bei Spediteur kaufen" 🚚 (Modal `fware|handel`), deaktiviert bei `free <= 0 || s.kasse < angebote[0].price`. Für Spediteure (`s.handel`) zusätzlich Knopf `firma|handel|0|<uid>` „Handel" 🚚. Reihe bleibt ≤ 6? Discord max 5 je Zeile: Einkaufen · Voll machen · Bei Spediteur kaufen · Firma · Home = 5; Spediteur-Lager: Einkaufen · Voll machen · Handel · Firma · Home = 5 (ein Spediteur kauft seine eigene Ware nur beim NPC – ein anderer Spediteur könnte ihn beliefern; wenn `s.handel && s.angebote.length` → zweite Zeile mit „Bei Spediteur kaufen"). Fluxer: ≤ 9 ✓.
- [ ] **Step 2: Handel-Ansicht** – Titel „🚚 Handel – Name", Beschreibung: Regeln in zwei Sätzen (Großhandel −10 %, 90–100 %, Kapazität `today/max` heute), Feld je Ware? Neun Felder sind zu viel – eine Tabelle im Beschreibungstext: `📦 Handelsware (Kiosk) · 95 % · an` je Zeile; Feld „Bisher" `units Einheiten · Spanne profit`. Knöpfe: „Angebot setzen" (Modal `fhandel|setzen`, Label „Branche oder „alle", dann Prozent oder „aus" – z. B. „baufirma 95""), „Alles aus" (`firma|handelaus`), „Lager" (`firma|lager`), „Firma", Home.
- [ ] **Step 3: Betriebsansicht** – im Feld „📦 Waren" für Spediteure eine Zeile `🚚 Handel: heute ${today}/${max} · gesamt ${units} Einheiten, +${money(profit)} Spanne`.
- [ ] **Step 4: Handler** – `firma`-Dispatcher: Modal-Zweige `handelkauf` (→ `fware|handel`) und `handelsetzen` (→ `fhandel|setzen`) vor `deferUpdate`; nach `deferUpdate`: `handel` → Handel-Ansicht; `handelaus` → `setOffer(…, 'alle', 'aus')` + Ansicht. Modal-Handler: `fware` bekommt Modus `handel`: günstigstes Angebot aus `status().angebote[0]`, `buyFromTrader(guildId, userId, angebot.company.id, amount)`, Texte `{ trader: '🚚 Der Spediteur liefert gerade nicht.', capacity: '📦 Es passt nichts mehr rein – oder der Spediteur hat für heute geliefert.', kasse: '💸 Dafür fehlen X in der Kasse.' }`, Erfolg `🚚 **n** Einheiten von **Name** für X (Y je Einheit statt Z).`; `fhandel(interaction, ['setzen'])`: Text parsen (`/^(\S+)\s+(\d+|aus)$/i`), `setOffer`, Texte `{ not_trader, branch: '❌ Branche unbekannt – z. B. „baufirma 95" oder „alle 97".', share: '❌ Prozent zwischen 90 und 100, oder „aus".' }`, Erfolg → Handel-Ansicht.
- [ ] **Step 5: Render-Test** – Spediteur mit Angebot + Käufer in `test/fluxer-render.test.js`: Käufer-Lager zeigt „🚚 Spediteure" und den Kauf-Knopf; Spediteur-Lager zeigt „Handel"; Handel-Ansicht 5 Knöpfe, `mapReactions(...).overflow === undefined`; Betriebsansicht des Spediteurs enthält „🚚 Handel:".
- [ ] **Step 6: Tests, Commit** – fluxer-render, menu, companyTrade → `0 fehlgeschlagen`.

```bash
git add src/ui.js src/buttons.js test/fluxer-render.test.js
git commit -m "firmen: handel-ansicht der spedition, angebote und kauf in der lager-ansicht

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 3: Messung, Docs, Patchnotes

**Files:** `scripts/messung-geldquellen.js` (`handelslauf(tage)`), `ARCHITEKTUR.md` §15 („Handel (seit 1.36.0, Stück 3b)"), `docs/messungen/2026-09-21-firmen-handel.txt`, `src/data/patchnotes.js` (1.36.0), 3a-Spec-Addendum.

- [ ] **Step 1: `handelslauf(tage)`** – eine Welt: Spedition (Kern, 10 NPCs Schichtleiter ab Tag 30, Werbung, Anpacken – wie `firmenlauf`) mit `setOffer('alle', 95)`, eine Baufirma (Kern) als Käufer, die täglich zuerst `buyFromTrader(…, 'voll')` und dann `buyStock('voll')` macht; Ereignisse mit festem Würfel wie `firmenlauf`. Ausgabe: Spediteur Median Kasse-Delta/Tag mit Handel vs. Referenz `firmenlauf('spedition')`, Käufer Median vs. `firmenlauf('baufirma')`, Spanne/Tag, Einheiten/Tag, Anteil der Käufer-Ware vom Spediteur. Erwartung: Käufer spart `0,05 × NPC-Preis` je Einheit (40/Tag × 17 = 680/Tag), Spediteur +680/Tag, beide unter Handels-Decke (Spediteur 9.600, Käufer 61.400 + 1.360). `main()` druckt den Abschnitt „--- Handel (Spedition liefert Baufirma) ---".
- [ ] **Step 2: Lauf** – `rm -rf .testdata && DATA_DIR=.testdata node scripts/messung-geldquellen.js 10 365 2>&1 | tee <scratchpad>/mess-3b.txt` (Timeout 600000, ggf. Hintergrund); Handvalidierung: ein Tag mit 40 gelieferten Einheiten → Spanne 680 beim Spediteur, Käufer zahlt 40 × 323 statt 40 × 340.
- [ ] **Step 3: Docs** – §15 Absatz mit Regeln, Handels-Decken (9.600 / 19.200; Käufer + 0,1 × Ware), gemessene Zahlen mit Datei; Patchnote 1.36.0 „🚚 Firmen: Die Spedition liefert" (Großhändler, 90–100 %, Kapazität 20 je Platz, Käufer sieht Angebote im Lager, Spanne bleibt beim Spediteur); Addendum in der 3a-Spec.
- [ ] **Step 4: Suite, Commit** – `npm test 2>&1 | grep -c '❌'` → `0`.

```bash
git add scripts/messung-geldquellen.js ARCHITEKTUR.md docs/messungen/2026-09-21-firmen-handel.txt src/data/patchnotes.js docs/superpowers/specs/2026-09-20-firmen-waren-design.md
git commit -m "firmen: messung des handels, §15 handels-decken, patchnotes 1.36.0

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

## Selbstprüfung gegen die Spec

- Angebot (Tabelle, share 90–100, `alle`/`aus`, nur `handel: true`): Task 1. ✔
- Kauf (min aus Wunsch/Lager/Kapazität, Preise, Kasse → Kasse, Chronik beidseitig, Zähler, Ablehnungen): Task 1. ✔
- §3 Handels-Decken mit Handrechnung: Task 1 (Test), Task 3 (§15). ✔
- Anzeige Käufer/Spediteur/Betriebsansicht, Modals, Fluxer-Budget: Task 2. ✔
- Messung `handelslauf`, Docs, Patchnotes, Addendum: Task 3. ✔
