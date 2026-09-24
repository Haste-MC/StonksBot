# Eigene Firmen – Stück 4: Mehrere Firmen und Firmenwert im Vermögen

Stand: 2026-09-24 · Zweig `main` · baut auf Stück 1–3c · Beschlüsse des
Nutzers 2026-09-24: **Limit am Konto-Level (B)**, **Wert = Substanz *und*
Ertragswert**, **voll in der Rangliste**.

## Ziel

Zwei Dinge, die zusammengehören:

1. **Mehrere Firmen je Spieler.** Heute sperrt ein eindeutiger Index die
   zweite Firma; das Limit wächst künftig mit dem Konto-Level.
2. **Firmenwert zählt zum Vermögen** – in Profil, Rangliste und überall, wo
   `networth` rechnet: die eigene Substanz plus ein Ertragswert, jeweils
   anteilig (seit 3c gehören bis zu 49 % anderen Spielern), plus Anteile an
   fremden Firmen.

## Nicht-Ziele

- Keine Konzernstruktur (Firmen besitzen keine Firmen), keine gemeinsame
  Kasse, kein Firmenverbund-Bonus.
- Keine Änderung an Decken, Waren, Handel, Anteilen, Ereignissen.
- Kein Handel mit ganzen Firmen außerhalb des Übernahme-Vorfalls (2b).
- Keine zweite Rangliste; der Firmenwert fließt in die bestehende ein.

## Was heute gilt (gegen den Code geprüft)

| | Quelle |
|---|---|
| `CREATE UNIQUE INDEX idx_companies_owner_open ON companies (guild_id, owner_id) WHERE status = 'open'` | `src/db.js:575` |
| `db.getOpenCompany(guildId, ownerId)` → eine Zeile; `ownCompany`, `ownerContext`, `fresh`, `found` (`reason: 'already'`), `status`, `buyStock`, `buyFromTrader`, `withdraw`, `deposit`, `pitchIn`, `advertise`, `setOffer`, `listShares`, `claimDividends` gehen von genau einer offenen Firma aus | `src/company.js:58, 203, 242, 664`, ganze Datei |
| Knopf-IDs ohne Firmen-ID: `firma|<aktion>|<arg>|<uid>`; Menüeintrag `firma` → `buildFirmaView({ guildId, userId })` | `src/ui.js`, `src/buttons.js`, `src/menu.js` |
| Jobsystem: `company.asJob('firma:<id>')`, `openings(guildId)` listet alle offenen Firmen, ein Spieler hat höchstens **eine** Anstellung | `src/company.js`, `src/jobs.js` |
| `networth.PARTS` (garage, realty, depot, collection), `assetsOf(guildId, userId)` synchron, `of(...)`, `breakdown(...)`; `db.assetOwners(guildId)` (Inventar, Depot, Sammlung) | `src/networth.js`, `src/db.js:1979` |
| Rangliste: `toplist` zählt `networth.assetsOf` je Eintrag und ergänzt Besitzer ohne Guthaben über `networth.owners` | `src/toplist.js:105, 124` |
| Level: `perks.levelOf(guildId, userId)` (aus XP), `perks.perksOf(...)` | `src/perks.js:84, 110` |
| Anteile (3c): `sharesOf(companyId)` → `{ total: 1000, owner, holders }`, `investedOf(b, c, extraIds)`, `db.companySharesOf(guildId, userId)`, `pending`/`received` je Halter | `src/company.js`, `src/db.js` |
| Abrechnung liefert je Lauf `{ days, umsatz, loehne, … }`; die Firma merkt sich noch keinen Gewinnverlauf | `src/company.js:470` |

## Teil 1: Mehrere Firmen

**Limit.** `maxCompanies(level) = clamp(1, 5, 1 + floor(level / 10))` –
Level 0–9: 1, 10–19: 2, …, ab 40: 5. Konstanten `COMPANIES_PER_LEVEL = 10`,
`COMPANIES_MAX = 5` in `data/companies.js`. `found` prüft
`db.openCompaniesOf(guildId, userId).length < maxCompanies(perks.levelOf(...))`
→ sonst `reason: 'limit'` mit `{ have, max, level, nextAt }` (`nextAt` = Level
für die nächste Firma, oder null bei 5).

**Datenbank.** Der eindeutige Index fällt weg (`DROP INDEX IF EXISTS
idx_companies_owner_open`), ein einfacher Index tritt an seine Stelle
(`idx_companies_owner ON companies (guild_id, owner_id, status)`). Neu:
`db.openCompaniesOf(guildId, ownerId)` (sortiert nach `founded_at`).
`db.getOpenCompany` bleibt (liefert die älteste) – damit funktionieren alte
Aufrufwege weiter, bis sie umgestellt sind.

**Auswahl.** Alle Inhaber-Funktionen bekommen ein optionales letztes Argument
`companyId`:
`ownerContext(guildId, userId, companyId = null)`,
`fresh(guildId, userId, now, random, companyId = null)`,
`status(guildId, userId, now, companyId = null)`,
`withdraw/deposit/pitchIn/advertise/hireNpc/fire/promote/bonus/close/upgrade/
buyExtra/buyStock/buyFromTrader/setOffer/listShares(…, companyId)`.
Ohne `companyId` gilt die **aktive** Firma des Spielers: die zuletzt
gegründete oder zuletzt geöffnete, gemerkt in der Tabelle `company_active
(guild_id, user_id, company_id, at, PRIMARY KEY (guild_id, user_id))`.
`activeCompanyId(guildId, userId)` liefert sie und fällt auf die älteste
offene zurück, wenn die gemerkte geschlossen oder weg ist; `setActive(guildId,
userId, companyId)` läuft beim Öffnen einer Firmenansicht und nach `found`.

**Ansichten.**
- **Firmen-Übersicht** (neuer Einstieg des Menüeintrags `firma`, wenn der
  Spieler mehr als eine Firma hat): je Firma eine Zeile „🏗️ **Bau AG**
  (Baufirma, Stufe 3) · Kasse 120.400 · Prognose +38.200 · ⚠️ Vorfall" und ein
  Knopf je Firma (bis 4, dann Seiten), dazu „Gründen" (wenn unter dem Limit)
  und Home. Bei genau einer Firma bleibt der Einstieg wie heute die
  Betriebsansicht; bei null die Gründungsansicht.
- **Betriebsansicht**: Titel wie heute; neue Fußzeile „Firma 2 von 3" wenn
  mehrere; Knopf „Firmen" (→ Übersicht) statt „Home", wenn mehr als eine.
- Alle Firmen-Knopf-IDs tragen die Firmen-ID im `arg`-Feld, wo sie heute `0`
  ist – Format bleibt `firma|<aktion>|<arg>|<uid>` (§6: zustandslos). Wo `arg`
  schon belegt ist (`personal|<page>`, `ausbauen|<stufeId>`, `extra|<id>`),
  wird die Firmen-ID **nicht** in die ID gelegt; diese Aktionen gelten für die
  aktive Firma (sie sind nur aus deren Ansicht erreichbar, die `setActive`
  gesetzt hat).
- Gründungsansicht nennt das Limit: „Firma 2 von 3 (Level 21)".

**Jobs.** Ein Spieler kann weiterhin nur **eine** Anstellung haben, auch als
Inhaber mehrerer Firmen; `join` lehnt die eigene Firma ab wie bisher (für jede
eigene Firma). `openings` bleibt unverändert.

**Ereignisse/Vorfälle (2b).** Der Wurf hängt an der Firma, die Sperre „ein
offener Vorfall je Spieler" bleibt: Wer mit Firma A einen Vorfall hat,
bekommt aus Firma B keinen zweiten. Der Vorfall trägt die Firmen-ID in einer
neuen Spalte `creator_events.ref_id INTEGER DEFAULT 0` (`platform` bleibt
`'company'`); `applyCompany` wirkt auf genau diese Firma, bei `ref_id = 0`
(Altbestand) auf die aktive.

## Teil 2: Firmenwert im Vermögen

**Substanzwert** einer Firma: `invested + kasse + stock_cost`
(`invested = investedOf(b, c, extraIds)` = gekaufte Stufen und Extras; die
Gründungsgebühr zählt **nicht**, wie beim Schließen).

**Ertragswert:** gleitender Tagesgewinn × `ERTRAG_FAKTOR = 30`.
Neue Spalte `companies.profit_ema REAL DEFAULT 0` (EMA über 7 Tage, wie die
Nachfrage): `settle` schreibt je abgerechnetem Tag
`profit_ema = profit_ema × 6/7 + tagesgewinn / 7`, wobei `tagesgewinn` die
Kassenänderung dieses Tages **aus dem Betrieb** ist (Umsatz − Löhne − Ware −
Ereigniskosten; Einzahlungen, Entnahmen, Anteilskäufe und Handel zählen
nicht). Ertragswert = `max(0, round(profit_ema × 30))` – negative Gewinne
zählen nicht (eine Firma im Minus ist nicht negativ wert, sie ist ihre
Substanz wert).

**Abgrenzung (`profit_pending`).** Nicht jeder Betriebsaufwand fällt in
einem Abrechnungstag an: Werbung, Prämie und die Kassenwirkung eines
Vorfalls gehen in **Echtzeit** aus der Kasse, der Umsatz, den sie kaufen,
entsteht aber in den Tagen danach. Zählte nur der Umsatz, wäre der
Ertragswert für Geld aus der eigenen Kasse käuflich. Deshalb gibt es die
Spalte `companies.profit_pending INTEGER NOT NULL DEFAULT 0`: jede
Kassenbewegung des **Betriebs** außerhalb des Tagesschritts addiert ihren
vorzeichenbehafteten Betrag darauf, und der **erste** abgerechnete Tag des
nächsten Laufs schlägt ihn auf seinen `tagesgewinn` und setzt die Spalte auf
0 (nicht verteilt über alle nachgeholten Tage – eine lange Abwesenheit soll
die Werbung nicht verdünnen).

Es zählen darauf:

- `advertise` – die Werbekosten (−),
- `bonus` – die Prämie (−; schlägt die Buchung fehl, wird sie zurückgelegt),
- `decisions.applyCompany` – die Kassenwirkung des Vorfall-Ausgangs
  (`done.kasse + done.refund`, also derselbe Nettobetrag wie in der Chronik).

Es zählen **nicht** darauf: `deposit` und `withdraw` (Kapital, keine
Leistung), `buyStock` und `buyFromTrader` (Ware landet in `stock_cost` und
wird dem Tag berechnet, der sie verbraucht – sonst doppelt), Anteilskäufe
und Ausschüttungen (Umbuchungen zwischen Spielern), die Auszahlung bei
`close`/`sell` (die Firma endet dort) und das Gründungslager
(Erstausstattung, schon in `stock_cost`). Die leichten Ereignisse **im**
Tagesschritt laufen weiter direkt über `tagEreignis` – sie kommen nie über
`applyCompany`, also gibt es kein Doppelzählen.

**Firmenwert** = Substanz + Ertragswert. Verteilung: Der Inhaber hält
`sharesOf().owner / 1000`, jeder Halter seinen Anteil. Dazu beim Halter sein
`pending` (schon verdiente, nicht abgeholte Ausschüttung).

Also je Spieler:
```
company = Σ über eigene offene Firmen: firmenwert × ownerAnteil
        + Σ über gehaltene Anteile:    firmenwert × anteil + pending
```

`networth.PARTS` bekommt `{ key: 'company', label: 'Firmen', emoji: '🏢' }`;
`assetsOf` ruft `require('./company').worthOf(guildId, userId)` (synchron,
ohne `unb`). `db.assetOwners` bekommt zwei weitere UNION-Zweige (offene
Firmen, Anteile mit `shares > 0` oder `pending > 0`), damit ein reiner
Firmenbesitzer in der Rangliste auftaucht.

**Anzeige.** Profil und Rangliste zeigen den Anteil über die bestehende
`breakdown`-Zeile (🏢 kommt automatisch dazu). Die Ranglisten-Fußzeile nennt
zusätzlich, wie viel des Gesamtvermögens auf Firmen entfällt
(„🏢 Firmen: 38 % des Vermögens der Top 10").

**§3.** Keine neue Geldquelle: Der Firmenwert ist eine **Anzeige** über
bestehenden Zustand (Investition, Kasse, Lager, gemessener Gewinn). Kein
Ausschüttungs- oder Kaufweg ändert sich. Der Ertragswert kann nicht
hochgespielt werden: `profit_ema` kommt ausschließlich aus `settle`
(Betriebsergebnis), nicht aus Einzahlungen; Einzahlen erhöht nur die
Substanz, und zwar um genau den eingezahlten Betrag, der vorher vom Konto
abging (Vermögen bleibt gleich). Test: Einzahlung 100.000 → Vermögen
unverändert; Entnahme desselben Betrags → unverändert.

## Messung, Tests, Docs

- Tests `test/companyMulti.test.js`: Limit je Level (0→1, 10→2, 45→5), `found`
  mit `reason:'limit'`, zweite Firma gründen und beide betreiben (Kassen
  getrennt, Abrechnung getrennt, Vorfall-Sperre greift über beide), `status`
  mit `companyId`, aktive Firma merken und Rückfall, Schließen einer von
  zwei Firmen.
- Tests `test/companyWorth.test.js`: Substanz- und Ertragswert (Handrechnung
  Kiosk Stufe 1, 7 Tage Gewinn 2.000/Tag → `profit_ema` = 2.000 × (1 −
  (6/7)^7) = 1.320 → Ertragswert 39.600), Verteilung bei 200 verkauften
  Anteilen (Inhaber 80 %, Halter 20 % + pending), Einzahlung/Entnahme
  vermögensneutral, geschlossene Firmen zählen nicht, `assetOwners` findet
  reine Firmenbesitzer, negative `profit_ema` → Ertragswert 0; dazu der
  Nachtrag unten: Werbung, Prämie und Vorfall-Kasse laufen über
  `profit_pending` in den nächsten abgerechneten Tag, `profit_pending` wird
  dabei genau einmal verbraucht, Einzahlung/Entnahme/Wareneinkauf nicht.
- Messung: `firmenlauf` gibt am Ende den Firmenwert aus (Substanz, Ertrag,
  Summe) – eine Kern-Baufirma nach 365 Tagen und eine voll ausgebaute; §15
  nennt die Zahlen, damit klar ist, wie stark Firmen die Rangliste bewegen.
- Docs: §15 (Firmenwert-Formel, gemessene Größenordnung, Limit am Level),
  Patchnotes 1.38.0, Addendum in der 3c-Spec.

## Nachtrag

Der alte Unique-Index `idx_companies_owner_open` („höchstens eine offene
Firma je Spieler") ist mit diesem Stück weg (`DROP INDEX IF EXISTS` in
`src/db.js`). Das ist kein Rückweg: Sobald ein Spieler zwei offene Firmen
hat, schlägt ein Rollback auf einen älteren Commit beim Start fehl, weil
dessen `CREATE UNIQUE INDEX IF NOT EXISTS idx_companies_owner_open` gegen
die vorhandenen Duplikate läuft. Ein Rollback muss also vorher die
überzähligen Firmen der betroffenen Spieler schließen (oder löschen), sonst
bricht der Serverstart der alten Version an der Index-Erstellung ab.

## Nachtrag 2026-09-24: Ertragswert ohne Werbe-Hebel

**Der Fehler.** Die erste Fassung von Stück 4 zählte für `profit_ema` nur,
was im Tagesschritt von `settle` passiert: NPC-Umsatz − Löhne − Ware ±
Kassenwirkung des leichten Ereignisses. Alles, was **außerhalb** dieser
Schleife aus der Kasse geht, war unsichtbar – der Umsatz, den es kauft,
zählte aber voll. Weil `earnings = profit_ema × 30` ist, war der Firmenwert
damit über die eigene Kasse käuflich, und zwar einseitig: bezahlen kostet
nur Substanz (1 : 1), der gekaufte Mehrumsatz zahlt dreißigfach.

**Gemessen** (Café Stufe 5, voll besetzt, eingeschwungene Grundlinie, eine
Werbung für 6.000 aus der Kasse, danach ein abgerechneter Tag):

| | Firmenwert gesamt | davon Ertragswert |
|---|---|---|
| vorher (ohne Verrechnung) | **+55.876** | **+24.406** |
| nachher (mit `profit_pending`) | **+30.162** | **−1.308** |

Die Differenz ist exakt `round(6.000 / 7 × 30) = 25.714`: die Werbekosten
fehlten in der EMA. Der Reviewer hat denselben Effekt an einer anderen
Grundlinie mit **+54.346 Firmenwert, davon +47.926 Ertragswert** gemessen –
die Höhe hängt daran, wie weit die Auslastung noch vom Ziel entfernt ist,
der Hebel selbst nicht. Wiederholbar war das alle drei Tage
(`WERBUNG_DAYS = 3`). Dasselbe galt für `bonus` (`src/company.js`) und für
die Kassenwirkung eines Vorfalls, die `decisions.applyCompany` in Echtzeit
anwendet.

**Der Fix.** Neue Spalte `companies.profit_pending` (CREATE, PRAGMA-Nachrüstung,
`saveCompany`). `advertise` (−Kosten), `bonus` (−Prämie) und
`applyCompany` (`done.kasse + done.refund`) buchen ihren Betrag darauf; der
erste abgerechnete Tag des nächsten Laufs addiert ihn auf seinen
`tagesgewinn` und leert die Spalte. Abgrenzung siehe „Teil 2", Absatz
**Abgrenzung (`profit_pending`)**. Nach dem Fix bleibt die Werbung ein
Geschäft, wenn sie sich rechnet – aber sie ist kein Hebel mehr, sondern
Aufwand, der gegen den Mehrumsatz antritt, den er kauft (§3).
