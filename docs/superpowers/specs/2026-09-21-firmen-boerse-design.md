# Eigene Firmen – Stück 3c: Börse aktiv (Nachfrage-Drift und Firmenanteile)

Stand: 2026-09-21 · Zweig `main` · baut auf 3a/3b · Beschluss des Nutzers
2026-09-21: **A (Nachfrage-Drift) + C (Börsengang der eigenen Firma), kein B
(Kredit)**.

## Ziel

Bis 3b reagieren die simulierten Börsenfirmen nicht auf die Spieler, und
Spielerfirmen haben keinen Weg, Kapital von anderen Spielern zu holen. 3c
schließt beides:

- **A – Nachfrage-Drift:** Die Wareneinkäufe aller Spielerfirmen je
  Lieferanten-Aktie fließen als gedeckeltes, nur positives Nachfragesignal in
  die Kursdrift dieser Aktie. Viele Baufirmen → BETO steigt leicht.
- **C – Firmenanteile:** Ein Inhaber kann bis zu 49 % seiner Firma als Anteile
  an andere Spieler verkaufen. Anteile bekommen ihren Anteil an jeder Entnahme
  und an der Auszahlung beim Schließen/Verkauf; sie können zwischen Spielern
  weitergehandelt werden. Kein Kurs, keine Simulation – der Wert ist die
  Ausschüttung.

## Nicht-Ziele

- Kein Firmenkredit (B). Keine Notierung von Spielerfirmen im Börsen-Ticker
  (kein simulierter Kurs, keine Kursereignisse), keine Übernahme durch
  Mehrheit (der Inhaber hält immer ≥ 51 %).
- Kein Handel der Anteile gegen die Börsen-Assets, keine Dividenden aus dem
  Nichts: ausgeschüttet wird nur, was der Inhaber aus der Kasse nimmt.
- Nachfrage-Drift nur für Aktien mit Lieferantenrolle; keine negative
  Drift ohne Nachfrage (heutiges Verhalten bleibt der Nullpunkt).

## Was heute gilt (gegen den Code geprüft)

| | Quelle |
|---|---|
| `step(price, sigma, random, shock, shockSigma, recoverTo)`: `drift = min(DRIFT_CAP, σ²/2 × DRIFT_SHARE)`, `DRIFT_CAP 0.00004` je Takt (30 min → ≤ ~4 %/Monat); `simulate` läuft je Takt über `singles` | `src/wallstreet.js:102, 160, 310` |
| `market_prices (guild_id, symbol, price, tick, listed_at, recover_to, recover_until)`; `db.getPrice/setPrice`; `advance(guildId, now)` lazy + Ticker | `src/db.js:413`, `src/wallstreet.js:264` |
| Wareneinkäufe: `buyStock` (NPC), ad hoc in `consumeOne` (settle/workShift/pitchIn), Großhandel in `buyFromTrader` (Spediteur zahlt `wholesale` je Einheit) | `src/company.js` |
| Entnahme `withdraw(guildId, userId, amount, now)`: Kasse −, eine Buchung `{ xp:false, tax:false, kind:'company' }`, Rücknahme bei Fehler; `close`/`sell` zahlen `kasse + stock_cost` (+ `investedOf` beim Verkauf) in einer Buchung | `src/company.js:720, 815, 840` |
| `pay(guildId, userId, price, reason)`: Konto belasten (Bank anzapfen), Rücknahme bei Fehler | `src/company.js:1076` |
| Börse-Ansicht: Kacheln je Wert, Nav `wkind|all/stock/fund/crypto`, `wdepot`; Aktien-Ansicht `buildAssetView` mit „🏭 Lieferant für" | `src/ui.js:2990, 3220` |
| Ausbau-Ansicht: Ausbauen · Schließen · Firma · Home + 4 Extras (8 Knöpfe); Fluxer `MAX_REACTIONS 9` | `src/ui.js`, `src/fluxer/render.js` |

## A – Nachfrage-Drift

**Zählen.** Spalten an `market_prices`: `demand_day TEXT DEFAULT ''`,
`demand_today INTEGER DEFAULT 0`, `demand_ema REAL DEFAULT 0`.
`wallstreet.recordDemand(guildId, symbol, units, now)` (synchron): rollt bei
Tageswechsel `ema = ema × (1 − 1/7) + demand_today / 7` (für jeden
übersprungenen Tag einmal mit 0 nachziehen, höchstens 30), setzt
`demand_day`, addiert `units` auf `demand_today`. Aufrufer (alle in
`company.js`): `buyStock` (Einheiten), `consumeOne`-Ad-hoc (1 je Einheit,
gesammelt je `settle`/Schicht), `buyFromTrader` (Einheiten – der Spediteur
kauft beim NPC-Markt). Gezählt wird beim Lieferanten der **Käufer-Branche**.

**Wirken.** Konstanten `DEMAND_REF = 200` (Einheiten je Tag, ab hier volle
Wirkung), `DEMAND_CAP = 0.00002` (je Takt; = `DRIFT_CAP / 2`). In `simulate`
je Takt und Aktie: `extra = DEMAND_CAP × min(1, emaNow / DEMAND_REF)` mit
`emaNow` = EMA inklusive des laufenden Tages (`ema × 6/7 + demand_today / 7`)
– nur Aktien mit Lieferantenrolle (`data/companies` `ware.supplier`), sonst
0. `step` bekommt einen Parameter `extraDrift` und addiert ihn zur Drift.
Nachfrage senkt nie (`extra ≥ 0`).

**§3-Grenze.** Zusätzlicher passiver Zufluss ≤ `DEMAND_CAP × 48 Takte × 365`
= 0,35 → höchstens **+42 %/Jahr** auf den Kurs einer voll nachgefragten
Aktie (die bestehende Drift: ≤ 0,00004 → +100 %/Jahr). Eine einzelne
Kern-Baufirma (40 Einheiten/Tag) bringt `40/200 × 0,35` = +7 %/Jahr; ein
Inhaber, der die eigene Lieferanten-Aktie hält, hebt sie damit um höchstens
diesen Betrag – und zahlt seine Ware im selben Maß teurer (Ratio steigt).
Gemessen: 365 Tage `simulate` mit konstanter Nachfrage 0 / 40 / 200 gegen
denselben Würfel; Handrechnung `e^(0,00002 × 48 × 365) = 1,42`.

**Anzeige.** Aktien-Ansicht: „🏭 Nachfrage: **Ø 38 Einheiten/Tag** (7 Tage) ·
Drift +0,02 %/Tag" (`extra × 48` in Prozent, zwei Nachkommastellen); ohne
Nachfrage „🏭 Nachfrage: keine". Schlagzeilen bleiben, wie sie sind.

## C – Firmenanteile

**Modell.** `SHARES_TOTAL = 1000` Anteile je Firma; der Inhaber hält, was
nicht bei anderen liegt, mindestens `OWNER_MIN = 510`. `IPO_MIN_STUFE = 2`
(Börsengang erst ab Stufe 2 – es soll etwas dahinterstehen).
`SHARE_FEE = 0.01` (1 % des Kaufpreises als Gebühr, Senke wie an der Börse).

Tabellen:
- `company_shares (company_id, user_id, shares, cost, pending, received,
  PRIMARY KEY (company_id, user_id))` – `cost` bezahlt (für die Anzeige),
  `pending` noch nicht abgeholte Ausschüttung, `received` abgeholt gesamt.
- `company_share_offers (id, guild_id, company_id, seller_id, shares, price,
  created_at)` – Verkaufsangebote (Inhaber wie Anteilseigner).

**Funktionen** (`src/company.js`, Abschnitt „Anteile"):
- `sharesOf(companyId)` → `{ total: 1000, owner: 1000 − Σ, holders:[{ user_id,
  shares, cost, pending, received }] }`.
- `listShares(guildId, userId, companyId, shares, price, now)`: Verkäufer ist
  Inhaber (Stufe ≥ `IPO_MIN_STUFE`, nach Verkauf ≥ `OWNER_MIN`) oder Halter
  (nach Verkauf ≥ 0, offene Angebote mitgezählt); `shares ≥ 1`, `price ≥ 1`;
  → `{ ok, offer }` | `reason: 'no_company' | 'stufe' | 'owner_min' | 'shares' |
  'price'`.
- `cancelShareOffer(guildId, userId, offerId)` → nur der Verkäufer.
- `shareOffers(guildId, companyId | null)` → offene Angebote (Firma oder alle
  des Servers), mit Firmenname, Branche, Buchwert je Anteil `round((investedOf
  + kasse + stock_cost) / 1000)`, letzte Ausschüttung je Anteil (siehe
  unten), sortiert nach `price`.
- `buyShares(guildId, userId, offerId, shares, now)`: Käufer ≠ Verkäufer,
  `shares ≤ offer.shares`, Firma offen; Preis `n × price`, Gebühr `round(n ×
  price × SHARE_FEE)`; **Buchungen:** Käufer `−(n × price + fee)` (über `pay`,
  Bank anzapfen), dann Verkäufer `+ n × price` `{ xp:false, tax:false,
  kind:'company' }`; scheitert die zweite, wird die erste zurückgenommen
  (Muster `pay`). Danach synchron: Angebot kürzen/löschen, Halter-Zeilen
  fortschreiben (`cost` anteilig mitnehmen), Chronik der Firma („📈 12 Anteile
  gingen von A an B für 3.900"). → `{ ok, shares, price, cost, fee, seller }` |
  `reason: 'offer' | 'self' | 'shares' | 'funds' | 'payment'`.
- **Ausschüttung:** `withdraw(value)` teilt: jeder Halter bekommt
  `floor(value × shares / 1000)` auf `pending`, der Inhaber erhält den Rest
  (eine Buchung wie heute). Ebenso die Auszahlung in `close`/`sell` (auf die
  gesamte Auszahlung, inkl. Lager und – beim Verkauf – Ausbau). Die Firma
  merkt sich `payout_30d` nicht; die Anzeige nutzt `received + pending` je
  Halter und die letzte Entnahme (`last_payout INTEGER` an der Firma:
  Betrag der letzten Entnahme/Auszahlung je 1000 Anteile).
- `claimDividends(guildId, userId)`: alle `pending` des Spielers über alle
  Firmen in **einer** Buchung `{ xp:false, tax:false, kind:'company' }`,
  `pending → received`; bei Buchungsfehler unverändert. → `{ ok, amount,
  parts:[{ company, amount }] }`.
- Geschlossene Firmen: Halter-Zeilen bleiben (für `pending`), Angebote werden
  in `closeCompany` gelöscht; `sharesOf` einer geschlossenen Firma liefert
  `holders` unverändert, `listShares` lehnt ab (`'no_company'`).

**§3.** Alles Transfers: Anteilskauf Spieler → Spieler (Gebühr = Senke),
Ausschüttung aus der Kasse (bestehendes Geld) – statt an den Inhaber an die
Halter. Nichts entsteht; ein Inhaber kann nicht mehr ausschütten, als er
entnimmt. Kein Kurs → kein Sell-an-den-Markt-Zufluss. Test: Buchungssumme
über eine Kauf-Entnahme-Abhol-Kette = −Gebühr.

**Anzeige.**
- Ausbau-Ansicht: Knopf „Anteile" (→ `firma|anteile|0|<uid>`), 9 Knöpfe
  (Fluxer-Grenze genau erreicht – Test).
- **Anteile-Ansicht (Inhaber)** `buildFirmaAnteileView`: Verteilung
  („Du 760 · 3 Anteilseigner 240"), Buchwert je Anteil, letzte Ausschüttung je
  Anteil, offene Angebote der Firma, Halterliste (bis 5). Knöpfe: „Anteile
  anbieten" (Modal `fanteil|anbieten|<uid>`, Text `<anzahl> <preis>`),
  „Angebot zurückziehen" (`firma|anteilweg|<offerId>|<uid>` – nur das eigene
  jüngste), „Firma", Home. Bei Stufe < 2: Hinweis, Knopf deaktiviert.
- **Börse:** Nav bekommt „🏢 Firmenanteile" (`wanteile|1|<uid>`) → Liste der
  Angebote des Servers, 5 je Seite: „#12 **Bau AG** (Baufirma, Stufe 3) · 40
  Anteile à 5.000 · Buchwert 4.120 · letzte Ausschüttung 310/Anteil"; Knöpfe:
  „Kaufen" (Modal `fanteil|kaufen|<uid>`, Text `<nr> <anzahl>`), „Meine
  Anteile" (`wmeine|<uid>`), Seiten, Börse, Home.
- **Meine Anteile** `buildMeineAnteileView`: je Firma Anteile, bezahlt,
  ausstehend, erhalten; Knöpfe „Ausschüttung abholen" (`wanteilabholen|<uid>`,
  deaktiviert bei 0), „Anteile verkaufen" (Modal `fanteil|verkaufen|<uid>`,
  Text `<firma-nr> <anzahl> <preis>`), „Firmenanteile", Home. Die Firma-Nr
  ist die `companies.id`, in beiden Listen sichtbar.
- Betriebsansicht: Fußzeile „… · 240 Anteile bei 3 Spielern" wenn Halter.

## Messung, Tests, Docs

- A: Test `simulate`-Drift mit fester Nachfrage (0/40/200) über 365 Tage,
  seeded, Verhältnis der Endkurse gegen `e^(extra × Takte)` ± Rauschen
  (Vergleich desselben Würfels: exakt `exp(Σ extra)`, weil `step`
  multiplikativ ist); EMA-Handrechnung (7 Tage 140 Einheiten → 140 × (1 −
  (6/7)^7) = 91,2); Ad-hoc/Großhandel/NPC zählen je Einheit einmal.
- C: Tests `test/companyShares.test.js`: IPO-Regeln (Stufe, 510), Kauf mit
  Gebühr und Rücknahme, Teilkauf, Weiterverkauf, Entnahme 10.000 bei 240
  Anteilen → Halter `pending` 2.400 anteilig (floor), Inhaber 7.600; Schließen
  verteilt; Abholen in einer Buchung; Summe aller Buchungen = −Gebühren;
  geschlossene Firma: kein Angebot, `pending` bleibt abholbar.
- Docs: §15 (Nachfrage-Drift-Grenze +42 %/Jahr, Anteile = Transfers),
  Patchnotes 1.37.0, Addendum in der 3b-Spec.

## Nachtrag 2026-09-21

Nach dem Gesamt-Review des Branches weicht der Code in vier Punkten vom Text
oben ab – der Code gilt:

- **EMA rollt ungedeckelt.** `recordDemand` zieht übersprungene Tage nicht
  „höchstens 30" einzeln nach, sondern geschlossen: `ema = ema × keep +
  demand_today / 7`, dann `ema *= keep^(days − 1)` mit `keep = 6/7`. Das ist
  dieselbe Rechnung ohne Schleife und ohne Obergrenze (nach 38 Tagen ist ein
  1.000er-Tag auf 0,74 abgeklungen, siehe `test/wallstreet.test.js`).
- **Handwert der EMA:** 7 Tage je 140 Einheiten ergeben `140 × (1 − (6/7)^7)`
  = **92,41** (nicht die runden Werte aus frühen Entwürfen); so steht es im
  Test.
- **`buyShares` reserviert zuerst (§7).** Das Angebot wird synchron vor dem
  ersten `await` um `n` verkleinert, dann Käufer, dann Verkäufer gebucht;
  scheitert eine Buchung, wächst das Angebot zurück (und der Käufer bekommt
  sein Geld zurück, protokolliert, falls auch das scheitert). Ein leeres
  Angebot wird erst nach beiden Buchungen gelöscht. Es gibt keine
  „Angebot inzwischen verkleinert"-Rückbuchung mehr; `shares` im Ergebnis ist
  immer `n`.
- **Drift-Vergleich ehrlich.** „Die Hälfte der bestehenden Drift" stimmt nur
  gegen `DRIFT_CAP`. BETO selbst driftet mit `variance/2` ≈ 0,0000205 je Takt
  (≈ +43 %/Jahr); volle Nachfrage (+0,00002) verdoppelt seinen passiven
  Zufluss etwa (≈ +103 %/Jahr). Pumpen ist ab einer BETO-Position von
  ≈ 2,5 Mio. netto positiv, gedeckelt auf +7,3 %/Jahr je Kern-Baufirma, und
  der Gewinn geht an jeden Halter – ein begrenzter, dokumentierter dritter
  Zufluss der Börse (ARCHITEKTUR §3, §15).

## Nachtrag 2026-09-24: Stück 4 umgesetzt (mehrere Firmen, Firmenwert)

Stück 4 (`docs/superpowers/specs/2026-09-24-firmen-mehrere-design.md`) baut
direkt auf 3c auf und ändert zwei Annahmen dieser Spec:

- **Nicht mehr „eine offene Firma je Spieler".** Der Unique-Index
  `idx_companies_owner_open` ist weg; das Limit hängt am Konto-Level
  (`maxCompanies = 1 + floor(level / 10)`, höchstens 5). Alle Inhaber-
  Funktionen nehmen eine optionale `companyId`, ohne sie gilt die aktive
  Firma (`company_active`). Wo diese Spec „die Firma des Spielers" schreibt,
  ist seitdem „die gemeinte Firma" zu lesen.
- **Anteile haben jetzt einen Buchwert im Vermögen.** 3c sagte „Kein Kurs:
  Anteile werden nicht simuliert, ihr Wert ist die Ausschüttung" – das gilt
  weiter fürs Geld, aber `networth` zeigt seit Stück 4 den Posten 🏢 Firmen:
  Firmenwert (Substanz + Ertragswert) × gehaltenem Anteil, dazu das noch
  nicht abgeholte `pending`. Ein Halter sieht seine Anteile also im Vermögen
  und in der Rangliste, ohne dass ein Kurs entsteht; verkaufen kann er sie
  weiterhin nur über ein Angebot an einen anderen Spieler.

Unverändert bleiben Nachfrage-Drift, `buyShares`, Ausschüttung und Gebühr.
Neu ist nur, dass die Kassenwirkung außerhalb des Tagesschritts (Werbung,
Prämie, Vorfall) über `companies.profit_pending` in den nächsten
abgerechneten Tag fällt – sonst wäre der Ertragswert über die eigene Kasse
käuflich (§3; siehe den Nachtrag „Ertragswert ohne Werbe-Hebel" in der
Stück-4-Spec). Zahlen und Grenzen stehen in ARCHITEKTUR §15
(„Mehrere Firmen und Firmenwert"), gemessen in
`docs/messungen/2026-09-24-firmenwert.txt`.
