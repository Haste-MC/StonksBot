# Firmen Stück 4 – Mehrere Firmen und Firmenwert – Implementierungsplan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ein Spieler kann so viele Firmen führen, wie sein Konto-Level erlaubt (1 + Level/10, max. 5); der Wert seiner Firmen (Substanz + Ertragswert, anteilig) zählt zum Vermögen und damit zur Rangliste.

**Architecture:** Der eindeutige Index fällt, `db.openCompaniesOf` und eine Merk-Tabelle `company_active` treten dazu; alle Inhaber-Funktionen bekommen ein optionales `companyId` und fallen auf die aktive Firma zurück; eine Firmen-Übersicht wird der neue Einstieg bei mehreren Firmen; `companies.profit_ema` misst den Betriebsgewinn, `company.worthOf` liefert den Vermögensanteil, `networth` bekommt den Posten `company`.

**Tech Stack:** Node.js, better-sqlite3 (synchron), discord.js-Builder, eigene Tests, Messskript.

## Global Constraints

- Spec: `docs/superpowers/specs/2026-09-24-firmen-mehrere-design.md` (bindend).
- `COMPANIES_PER_LEVEL = 10`, `COMPANIES_MAX = 5`, `ERTRAG_FAKTOR = 30`, EMA-Fenster 7 Tage (`profit_ema = profit_ema × 6/7 + tagesgewinn / 7` je abgerechnetem Tag).
- `maxCompanies(level) = Math.min(COMPANIES_MAX, 1 + Math.floor(level / COMPANIES_PER_LEVEL))`, mindestens 1.
- Firmenwert = `invested + kasse + stock_cost + max(0, round(profit_ema × 30))`; Inhaber `owner/1000`, Halter `shares/1000` plus `pending`. Geschlossene Firmen zählen nicht (nur `pending` der Halter).
- Tagesgewinn für die EMA ist ausschließlich das Betriebsergebnis eines `settle`-Tages (NPC-Umsatz − Löhne − Warenkosten dieses Tages − Ereignis-Kassenwirkungen); Einzahlungen, Entnahmen, Anteils- und Handelserlöse zählen nicht.
- ARCHITEKTUR §3 (keine neue Geldquelle – Anzeige über bestehenden Zustand), §4, §6 (zustandslose Button-IDs), §7, §8, §9, §12.
- Tests `rm -rf .testdata && DATA_DIR=.testdata node test/<x>.test.js`; Suite `npm test 2>&1 | grep -c '❌'` → `0`. Deutsch; Trailer wörtlich `Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>`.

---

### Task 1: Mehrere Firmen – Datenschicht und Auswahl

**Files:**
- Modify: `src/data/companies.js` (`COMPANIES_PER_LEVEL`, `COMPANIES_MAX`, Export), `src/db.js` (Index tauschen, `openCompaniesOf`, Tabelle `company_active` mit `getActiveCompany`/`setActiveCompany`/`clearActiveCompany`, Spalte `creator_events.ref_id INTEGER NOT NULL DEFAULT 0` + `insertEvent({ …, refId = 0 })`), `src/company.js` (`maxCompanies`, `companiesOf`, `activeCompanyId`, `setActive`, optionales `companyId` in `ownerContext`/`fresh`/`status` und allen Inhaber-Aktionen, `found` mit Limit, `closeCompany` räumt `company_active`), `src/decisions.js` (`roll` schreibt `refId`, `applyCompany` nutzt `row.ref_id`)
- Create: `test/companyMulti.test.js`; `package.json` (`&& node test/companyMulti.test.js` nach `companyShares`)

**Interfaces:**
- `company.maxCompanies(level) → 1…5` (rein).
- `company.companiesOf(guildId, userId) → [row]` (offene, älteste zuerst).
- `company.activeCompanyId(guildId, userId) → number|null` (gemerkte, sonst älteste offene).
- `company.setActive(guildId, userId, companyId) → void`.
- `ownerContext(guildId, userId, companyId = null)`, `fresh(guildId, userId, now = Date.now(), random = Math.random, companyId = null)`, `status(guildId, userId, now = Date.now(), companyId = null)`; alle Inhaber-Aktionen bekommen `companyId` als **letztes** Argument mit Default `null`.
- `found(...)` → zusätzlich `reason: 'limit'` mit `{ have, max, level, nextAt }`; Erfolg setzt die neue Firma aktiv.

- [ ] **Step 1: Test schreiben**

```js
// test/companyMulti.test.js
/**
 * Firmen Stück 4: mehrere Firmen je Spieler – Limit, Auswahl, getrennte Betriebe.
 * Aufruf: DATA_DIR=.testdata node test/companyMulti.test.js
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
const H = 3600e3;
const keinWurf = () => 0.5;

/** Level über XP setzen (perks.levelOf liest die Statistik). */
function setLevel(G, U, lvl) {
  const level = require('../src/level');
  const xp = level.xpForLevel ? level.xpForLevel(lvl) : null;   // Helfer prüfen; sonst hochzählen
  const stats = db.getStats(G, U);
  db.saveStats?.(G, U, { ...stats, xp });                        // API prüfen und anpassen
}

(async () => {
  console.log('--- Limit am Level ---');
  {
    check('Konstanten', data.COMPANIES_PER_LEVEL === 10 && data.COMPANIES_MAX === 5);
    check('Level 0 → 1, 9 → 1, 10 → 2, 25 → 3, 39 → 4, 40 → 5, 99 → 5',
      [0, 9, 10, 25, 39, 40, 99].map((l) => company.maxCompanies(l)).join() === '1,1,2,3,4,5,5',
      [0, 9, 10, 25, 39, 40, 99].map((l) => company.maxCompanies(l)).join());
  }

  console.log('--- Zwei Firmen führen ---');
  {
    const G = `MULTI_T${Date.now()}`;
    const U = 'm1';
    konten.set(U, 50_000_000);
    const t0 = new Date(new Date().setHours(6, 0, 0, 0)).getTime() + DAY_MS;
    setLevel(G, U, 15);                                   // erlaubt 2

    let r = await company.found(G, U, 'kiosk', 'Eckladen', t0);
    check('erste Firma', r.ok, JSON.stringify(r.reason));
    const k1 = r.company.id;
    check('sie ist aktiv', company.activeCompanyId(G, U) === k1);
    r = await company.found(G, U, 'imbiss', 'Bude', t0 + H);
    check('zweite Firma bei Level 15', r.ok, JSON.stringify(r));
    const i1 = r.company.id;
    check('jetzt ist die zweite aktiv', company.activeCompanyId(G, U) === i1);
    check('companiesOf: beide, älteste zuerst', company.companiesOf(G, U).map((c) => c.id).join() === `${k1},${i1}`);
    r = await company.found(G, U, 'cafe', 'Dritte', t0 + 2 * H);
    check('dritte scheitert am Limit', r.ok === false && r.reason === 'limit' && r.have === 2 && r.max === 2 && r.nextAt === 20, JSON.stringify(r));

    setLevel(G, U, 20);
    r = await company.found(G, U, 'cafe', 'Dritte', t0 + 3 * H);
    check('mit Level 20 geht die dritte', r.ok, JSON.stringify(r));
    const c1 = r.company.id;

    // Getrennte Kassen und Abrechnungen.
    await company.deposit(G, U, 10_000, t0 + 4 * H, k1);
    check('Einzahlung landet in der genannten Firma', db.getCompany(k1).kasse > 0 && db.getCompany(i1).kasse === 0,
      `${db.getCompany(k1).kasse} / ${db.getCompany(i1).kasse}`);
    const s1 = company.status(G, U, t0 + 4 * H, k1);
    const s2 = company.status(G, U, t0 + 4 * H, i1);
    check('status je Firma', s1.company.id === k1 && s2.company.id === i1 && s1.branch.id === 'kiosk' && s2.branch.id === 'imbiss');
    check('ohne companyId gilt die aktive (zuletzt gegründete)', company.status(G, U, t0 + 4 * H).company.id === c1);

    company.hireNpc(G, U, t0 + 5 * H, () => 0.1, k1);
    check('Personal geht an die genannte Firma', db.companyStaff(k1).length === 1 && db.companyStaff(i1).length === 0);

    // Vorfall-Sperre gilt über alle Firmen des Spielers.
    db.clearEvents(G, U);
    const ev = db.insertEvent({ guildId: G, userId: U, kind: 'gesundheitsamt', platform: 'company', refId: k1, createdAt: t0 + 6 * H, expiresAt: t0 + 30 * H });
    check('Vorfall trägt die Firmen-ID', db.getEvent(G, ev.id).ref_id === k1);
    const zweiter = require('../src/decisions').roll(G, U, { groesse: 9, days: 30, npc: 5 }, t0 + 7 * H, () => 0.01, 'company');
    check('kein zweiter Vorfall, solange einer offen ist', zweiter === null);

    // Schließen: aktive Firma fällt zurück.
    await company.close(G, U, t0 + 8 * H, c1);
    check('geschlossen, aktive fällt auf eine offene zurück', db.getCompany(c1).status === 'closed'
      && [k1, i1].includes(company.activeCompanyId(G, U)), String(company.activeCompanyId(G, U)));
    check('companiesOf zählt nur offene', company.companiesOf(G, U).length === 2);
  }

  console.log(`\n${pass} bestanden, ${fail} fehlgeschlagen`);
  process.exit(fail === 0 ? 0 : 1);
})();
```

`setLevel` an die echte API anpassen (`src/level.js` / `db.getStats`/`addXp` lesen — notfalls XP über `db` direkt setzen); im Report festhalten, welcher Weg genommen wurde.

- [ ] **Step 2: Test laufen lassen – muss fehlschlagen** (`COMPANIES_PER_LEVEL` undefined).

- [ ] **Step 3: `src/db.js`**

Index tauschen (im selben `db.exec`-Block, nach der Tabelle):

```sql
DROP INDEX IF EXISTS idx_companies_owner_open;
CREATE INDEX IF NOT EXISTS idx_companies_owner ON companies (guild_id, owner_id, status);
CREATE TABLE IF NOT EXISTS company_active (
  guild_id   TEXT    NOT NULL,
  user_id    TEXT    NOT NULL,
  company_id INTEGER NOT NULL,
  at         INTEGER NOT NULL,
  PRIMARY KEY (guild_id, user_id)
);
```

Spalte `ref_id INTEGER NOT NULL DEFAULT 0` an `creator_events` (CREATE + PRAGMA-Nachrüstung wie gehabt); `insertEvent` nimmt `refId = 0` und schreibt es. Funktionen: `openCompaniesOf(guildId, ownerId)` (`WHERE status='open' ORDER BY founded_at, id`), `getActiveCompany(guildId, userId)`, `setActiveCompany(guildId, userId, companyId, at)` (UPSERT), `clearActiveCompany(guildId, userId)`.

- [ ] **Step 4: `src/company.js`**

```js
/** Wie viele Firmen ein Konto dieses Levels führen darf. */
function maxCompanies(level) {
  return Math.max(1, Math.min(data.COMPANIES_MAX, 1 + Math.floor((Number(level) || 0) / data.COMPANIES_PER_LEVEL)));
}
/** Alle offenen Firmen eines Spielers, älteste zuerst. */
function companiesOf(guildId, userId) { return db.openCompaniesOf(guildId, userId); }
/**
 * Die Firma, auf die sich eine Aktion ohne ausdrückliche ID bezieht: die
 * zuletzt geöffnete oder gegründete – sonst die älteste offene.
 */
function activeCompanyId(guildId, userId) {
  const row = db.getActiveCompany(guildId, userId);
  const open = companiesOf(guildId, userId);
  if (row && open.some((c) => c.id === row.company_id)) return row.company_id;
  return open[0]?.id ?? null;
}
function setActive(guildId, userId, companyId, now = Date.now()) {
  if (companyId) db.setActiveCompany(guildId, userId, Number(companyId), now);
}
```

`ownCompany(guildId, userId, companyId = null)`: mit ID die Zeile prüfen (`owner_id`, `guild_id`, `status === 'open'`), ohne ID die aktive. `ownerContext`/`fresh`/`status` reichen `companyId` durch. Jede Inhaber-Aktion bekommt `companyId = null` als letztes Argument und gibt es an `fresh`/`ownerContext` weiter (Liste in der Spec). `found`:

```js
  const open = companiesOf(guildId, userId);
  const level = require('./perks').levelOf(guildId, userId);
  const max = maxCompanies(level);
  if (open.length >= max) {
    const nextAt = max < data.COMPANIES_MAX ? max * data.COMPANIES_PER_LEVEL : null;
    return { ok: false, reason: 'limit', have: open.length, max, level, nextAt };
  }
```

(Der bisherige `already`-Zweig entfällt; der Insert-Fehler-Catch bleibt.) Nach erfolgreicher Gründung `setActive(guildId, userId, row.id, now)`. `closeCompany`: `if (db.getActiveCompany(guildId, c.owner_id)?.company_id === c.id) db.clearActiveCompany(guildId, c.owner_id);`.

- [ ] **Step 5: `src/decisions.js`** – `roll` für `company` schreibt `refId: size.companyId` (der Aufrufer in `settle` gibt die ID mit); `applyCompany` nimmt `const cid = row.ref_id || null;` und ruft `company.fresh(guildId, userId, now, random, cid)`.

- [ ] **Step 6: Tests, Commit** – companyMulti, company, companyEvents, companyShares, companyGoods, companyTrade, db → `0 fehlgeschlagen`.

```bash
git add src/data/companies.js src/db.js src/company.js src/decisions.js test/companyMulti.test.js package.json
git commit -m "firmen: mehrere firmen je spieler – limit am level, aktive firma, aktionen mit firmen-id

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 2: Mehrere Firmen – Anzeige und Wege

**Files:** `src/ui.js` (neue `buildFirmenView({ guildId, userId, page })`; `buildFirmaView` mit `companyId`, Fußzeile „Firma 2 von 3", Knopf „Firmen"; Gründungsansicht nennt Limit/Level; alle `firma|…|0|`-IDs tragen die Firmen-ID, wo `arg` frei ist), `src/buttons.js` (`firma`-Dispatcher liest die Firmen-ID aus `arg` und ruft `setActive`; neuer Zweig `firmen` für die Übersicht; `gruenden`-Zweig zeigt `limit`-Text), `src/menu.js` (Eintrag `firma` → `buildFirmenView` wenn > 1 Firma), Tests `test/fluxer-render.test.js`, `test/menu.test.js`.

- [ ] **Step 1: Übersicht** – `buildFirmenView`: Titel „🏢 Deine Firmen (2 von 3)", je Firma ein Feld mit Branche/Stufe/Kasse/Prognose/Warnungen (Vorfall, Minus, geschlossen bis), Knöpfe: je Firma einer (`firma|oeffnen|<id>|<uid>`, max 4 je Zeile), zweite Zeile „Gründen" (`firma|gruenden|0|<uid>`, deaktiviert am Limit mit Hinweis im Text) · Home. Bei 0 Firmen → Gründungsansicht, bei 1 → Betriebsansicht (Weiche im Menü-Builder).
- [ ] **Step 2: Betriebsansicht** – `buildFirmaView({ guildId, userId, companyId })`; Fußzeile ergänzt „· Firma 2 von 3"; in Zeile 2 ersetzt „Firmen" (`firma|firmen|0|<uid>`) den Home-Knopf, wenn `companiesOf(...).length > 1` (Vorfall-Knopf hat Vorrang wie bisher → dann entfällt Home ganz; Reihenfolge: Personal · Ausbau · Lager · (Vorfall|Firmen|Home)).
- [ ] **Step 3: IDs und Dispatcher** – `firma|<aktion>|<arg>|<uid>`: für `werbung, anpacken, entnehmen, einzahlen, npc, lager, lagervoll, handel, handelaus, anteile, ausbau, schliessen, oeffnen, einkaufen, handelkauf, handelsetzen, anteilanbieten` trägt `arg` die Firmen-ID (0 = aktive). Der Dispatcher ruft vor der Aktion `company.setActive(guildId, userId, id)` wenn `id > 0` und reicht `id || null` an die Aktion. Die Aktionen mit belegtem `arg` (`personal|<page>`, `ausbauen|<stufeId>`, `extra|<id>`, `gruendung|<klasse>`, `anteilweg|<offerId>`) laufen weiter auf der aktiven Firma.
- [ ] **Step 4: Texte** – `gruenden` mit `reason: 'limit'`: „🏢 Du führst schon **2 von 2** Firmen. Die nächste gibt es ab **Level 20**." (ohne `nextAt`: „Mehr als 5 Firmen gehen nicht.").
- [ ] **Step 5: Render-Tests** – Übersicht mit 2 Firmen (Knöpfe, ≤ 5 je Zeile, `mapReactions(...).overflow === undefined`), Betriebsansicht mit „Firmen"-Knopf und Fußzeile, Gründungsansicht am Limit.
- [ ] **Step 6: Tests, Commit** – fluxer-render, menu, companyMulti → `0 fehlgeschlagen`.

```bash
git add src/ui.js src/buttons.js src/menu.js test/fluxer-render.test.js
git commit -m "firmen: uebersicht mehrerer firmen, firmen-id in den knopf-ids, limit-text

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 3: Firmenwert im Vermögen

**Files:** `src/data/companies.js` (`ERTRAG_FAKTOR = 30`), `src/db.js` (Spalte `companies.profit_ema REAL NOT NULL DEFAULT 0` + Migration + `saveCompany`; `assetOwners` um Firmen und Anteile erweitern), `src/company.js` (`profit_ema` in `settle`, `valueOf(companyId)`, `worthOf(guildId, userId)`), `src/networth.js` (`PARTS` + `company`, `assetsOf`), `src/ui.js`/`src/toplist.js` (Fußzeile Firmenanteil), Tests `test/companyWorth.test.js`, `test/networth.test.js`/`test/toplist.test.js` (laufen).

**Interfaces:**
- `company.valueOf(companyId) → { invested, kasse, stock, substance, earnings, total }` (0 für geschlossene/unbekannte).
- `company.worthOf(guildId, userId) → { own, shares, pending, total }` (synchron, ohne `unb`).
- `networth.assetsOf(...)` + `company` (= `worthOf(...).total`).

- [ ] **Step 1: Test schreiben (`test/companyWorth.test.js`)** – Handrechnungen:
  - Kiosk Stufe 0, Kasse 5.000, Lager 70 × 50 = 3.500, `profit_ema` 0 → `substance = 0 + 5.000 + 3.500`, `earnings = 0`, `total = 8.500`.
  - `profit_ema` 1.320 (7 Tage à 2.000: `2.000 × (1 − (6/7)^7) = 1.319,96…` → im Test `settle`-getrieben prüfen oder direkt setzen) → `earnings = round(1.320 × 30) = 39.600`.
  - Stufe 2 Café (`investedOf` 180.000 + 360.000) → Substanz enthält 540.000.
  - 200 Anteile verkauft: Inhaber 80 % des Firmenwerts, Halter 20 % + sein `pending`.
  - Einzahlung 100.000: `worthOf(owner).total` **unverändert** (Kasse +100.000, Konto −100.000 – der Test prüft nur den Firmenteil: `+100.000`, und dass `networth.of(...)` gleich bleibt, mit gefälschtem Guthaben).
  - Geschlossene Firma zählt nicht; `pending` eines Halters einer geschlossenen Firma zählt weiter.
  - negative `profit_ema` → `earnings = 0`.
  - `db.assetOwners` enthält einen reinen Firmenbesitzer und einen reinen Anteilshalter.
- [ ] **Step 2: Test laufen lassen – muss fehlschlagen.**
- [ ] **Step 3: `profit_ema` in `settle`** – im Tagesschritt den Betriebsgewinn des Tages sammeln: `tagesgewinn = NPC-Umsatz − Löhne − Warenkosten (ad hoc + Lagerentnahme zum Ø-Preis) − Ereignis-Kasse`; nach dem Tag `cur.profit_ema = (cur.profit_ema ?? 0) * 6/7 + tagesgewinn / 7`. Kommentar: warum nur Betrieb (Einzahlungen dürfen den Ertragswert nicht heben).
- [ ] **Step 4: `valueOf`/`worthOf`** wie in den Interfaces; `worthOf` nutzt `companiesOf` und `db.companySharesOf(guildId, userId)`.
- [ ] **Step 5: `networth`** – `PARTS` ergänzen (`{ key: 'company', label: 'Firmen', emoji: '🏢' }`), `assetsOf` um `company` (spät gebunden), `total` mitzählen; `db.assetOwners` um `SELECT owner_id FROM companies WHERE guild_id = ? AND status='open'` und `SELECT user_id FROM company_shares cs JOIN companies c ON c.id = cs.company_id WHERE c.guild_id = ? AND (cs.shares > 0 OR cs.pending > 0)` erweitern (Parameterliste in `assetOwners(guildId)` anpassen).
- [ ] **Step 6: Rangliste** – Fußzeile „🏢 Firmen: X % des Vermögens der Top 10" (Summe `company` / Summe `networth` der angezeigten Zeilen, gerundet).
- [ ] **Step 7: Tests, Commit** – companyWorth, networth, toplist, company, fluxer-render, menu → `0 fehlgeschlagen`.

```bash
git add src/data/companies.js src/db.js src/company.js src/networth.js src/ui.js src/toplist.js test/companyWorth.test.js
git commit -m "firmen: firmenwert (substanz und ertragswert) zaehlt zum vermoegen und zur rangliste

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 4: Messung, Docs, Patchnotes

**Files:** `scripts/messung-geldquellen.js` (`firmenlauf` gibt am Ende `valueOf` aus: Substanz, Ertragswert, Summe – für Kern und Vollausbau), `ARCHITEKTUR.md` §15 („Mehrere Firmen und Firmenwert (seit 1.38.0, Stück 4)": Limit-Tabelle Level→Firmen, Wertformel, gemessene Firmenwerte, Wirkung auf die Rangliste), `docs/messungen/2026-09-24-firmenwert.txt`, `src/data/patchnotes.js` (1.38.0, 2026-09-24), Addendum in der 3c-Spec.

- [ ] Lauf `rm -rf .testdata && DATA_DIR=.testdata node scripts/messung-geldquellen.js 10 365 2>&1 | tee <scratchpad>/mess-4.txt` (Timeout 600000, ggf. Hintergrund); Handvalidierung: Kiosk Kern nach 365 Tagen – Substanz (Kasse + Lager) und `profit_ema × 30` gegen den Median/Tag des Laufs vergleichen (der Ertragswert sollte ≈ 30 × Median sein, wenn der Lauf stabil ist); Abweichung erklären.
- [ ] §15, Patchnote („🏢 Mehrere Firmen": Limit am Level mit Tabelle; „Firmenwert zählt": Formel in einem Satz, Beispiel, Hinweis auf Rangliste), Addendum.
- [ ] Suite `npm test 2>&1 | grep -c '❌'` → `0`; Commit:

```bash
git add scripts/messung-geldquellen.js ARCHITEKTUR.md docs/messungen/2026-09-24-firmenwert.txt src/data/patchnotes.js docs/superpowers/specs/2026-09-21-firmen-boerse-design.md
git commit -m "firmen: messung des firmenwerts, §15 mehrere firmen, patchnotes 1.38.0

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

## Selbstprüfung gegen die Spec

- Limit am Level, Index, aktive Firma, `companyId` in allen Inhaber-Aktionen, Vorfall mit `ref_id`, Jobs unverändert: Task 1. ✔
- Übersicht, Betriebsansicht, IDs, Limit-Text, Render-Tests: Task 2. ✔
- Substanz + Ertragswert (EMA nur aus dem Betrieb), Verteilung mit Anteilen und `pending`, `networth`-Posten, `assetOwners`, Rangliste: Task 3. ✔
- Messung, §15, Patchnotes, Addendum: Task 4. ✔
- §3: keine neue Geldquelle – Test „Einzahlung ist vermögensneutral" in Task 3. ✔
