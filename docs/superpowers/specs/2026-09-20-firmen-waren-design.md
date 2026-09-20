# Eigene Firmen – Stück 3a: Waren und Lieferketten

Stand: 2026-09-20 · Zweig `main` · baut auf Stück 1, 2a, 2b · Reihenfolge des
Nutzers: **3a Waren (NPC-Seite) → 3b Handel zwischen Spielerfirmen → 3c Börse aktiv**

## Ziel

Firmen haben heute Umsatz je Schicht, aber keine Waren, keine Lieferanten,
kein Lager. 3a führt je Branche **eine Ware** ein, die jede Schicht
verbraucht, und bindet ihren Preis an den **Kurs einer Börsenfirma** – die
simulierten Firmen der Börse werden Lieferanten. Das schafft eine echte
Geldsenke (Einkauf), eine Entscheidung (wann und wie viel einlagern) und die
erste Börsen-Anbindung (Aktie halten = Hedge gegen teure Ware). Beschluss
des Nutzers 2026-09-20: Design wie unten, „passt".

## Nicht-Ziele

- Keine Produktion durch Spielerfirmen (3b: eine Spieler-Spedition kann
  liefern), keine zweite Ware je Branche, kein Verderb.
- Keine Kursbeeinflussung durch Einkäufe (3c).
- Keine Umdeutung des Ereignisses `lieferant` (bleibt `umsatz 0,7`) – ein
  Einkaufsverbot ohne Wirkung auf ad-hoc-Käufe wäre zahnlos (YAGNI).
- Keine Änderung an Musik, Creator, Jobs.

## Was heute gilt (gegen den Code geprüft)

| | Quelle |
|---|---|
| `ceilingOf(b, stufe, extraIds)` = `{ gross, wages, net, slots, factor }`; `gross = slots × 3 × umsatz × 1,5 × uf + 4 × umsatz × 1,5 × uf`, `wages = slots × 3 × lohn × 1,5`; `fullCeilingOf(b)` | `src/company.js:90` |
| Schichten: `settle` (NPC, `Math.round(b.umsatz × f × auslastung × uf × fUmsatz)` je Schicht, `NPC_SHIFTS 3`), `workShift` (Spieler, `× PLAYER_BONUS × factor`), `pitchIn` (Inhaber, Top-Rang) | `src/company.js:408, 522, 581` |
| Börse: `ASSETS` mit `symbol, name, emoji, kind, sector, start`; Kurse in `market_prices` (`db.getPrice(guildId, symbol)` → `{ price, tick }` oder null; erst ab erster Notierung), Fortschreibung lazy/Ticker in `wallstreet.advance` (async) | `src/data/wallstreet.js`, `src/db.js:1694, 3681`, `src/wallstreet.js:264` |
| Firmenansicht: Zeile 1 Werbung·Anpacken·Entnehmen·Einzahlen, Zeile 2 Personal·Ausbau·Schließen·Home/Vorfall (8 Knöpfe); Ausbau-Ansicht: Ausbauen·Firma·Home + 4 Extras (7); Fluxer `MAX_REACTIONS 9` | `src/ui.js`, `src/fluxer/render.js` |
| Betrag-Modal `fbetrag|<entnehmen|einzahlen>` mit „alles"; Buttons-Handler `firma|<aktion>|<arg>|<uid>` | `src/buttons.js:1973, 2693` |
| Aktien-Ansicht `buildAssetView({ guildId, userId, symbol })` | `src/ui.js:3089` |
| Tests mit festen Decken: Spedition 78.000, voll 487.095, Kiosk voll 16.631; §15 nennt Kern- und Vollausbau-Decken | `test/company.test.js:76, 536, 540`, ARCHITEKTUR §15 |

## Waren und Lieferanten

`data/companies.js`: jede Branche bekommt `ware: { name, emoji, supplier }`:

| Branche | Ware | Lieferant |
|---|---|---|
| kiosk | 📦 Handelsware | LAGR |
| imbiss | 🥫 Lebensmittel | DÖNR |
| autowaesche | 🧴 Reiniger | LACK |
| cafe | ☕ Kaffee & Gebäck | DÖNR |
| fitness | 🏋️ Geräte & Zubehör | GABR |
| werkstatt | ⚙️ Ersatzteile | HAST |
| spedition | 🛞 Reifen & Teile | SCHR |
| baufirma | 🧱 Beton & Stahl | BETO |
| club | 🎤 Acts & Getränke | ENTE |

Konstanten: `WARE_SHARE = 0.2` (Anteil des Schichtumsatzes bei Kurs = Start),
`WARE_KURS_MIN = 0.5`, `WARE_KURS_MAX = 2.0` (Klemmung des Kursverhältnisses),
`AD_HOC_MARKUP = 1.25`, `LAGER_TAGE = 7`.

**Einheitspreis:** `wareUnit(b) = round(b.umsatz × WARE_SHARE)` (Kiosk 50,
Baufirma 340, Club 480). Tagespreis `warePrice(guildId, b) = round(wareUnit(b)
× ratio)` mit `ratio = clamp(WARE_KURS_MIN, WARE_KURS_MAX, kurs / asset.start)`;
`kurs = db.getPrice(guildId, supplier)?.price ?? asset.start` (synchron, letzter
bekannter Kurs – die Börse schreibt sich über Ticker und Ansichten fort; die
Firma stößt keine Kursfortschreibung an). Ad-hoc-Preis `round(warePrice ×
AD_HOC_MARKUP)`.

**Verbrauch:** jede Schicht – NPC in `settle`, Spieler in `workShift`,
Inhaber in `pitchIn` – verbraucht **1 Einheit**. Liegt eine im Lager, wird
sie entnommen (Lagerwert sinkt um den Ø-Preis der Einheit); sonst wird **ad
hoc** gekauft: Kasse − Ad-hoc-Preis (darf ins Minus wie Löhne). Geschlossene
Tage (`closed_until`) verbrauchen nichts. Rang, Auslastung und Ausbau ändern
den Verbrauch nicht: eine Einheit ist eine Einheit – der Ausbau hebt die
Marge, wie es die Löhne heute schon tun.

## Lager

Spalten in `companies`: `stock INTEGER DEFAULT 0` (Einheiten), `stock_cost
INTEGER DEFAULT 0` (dafür bezahlt). Kapazität
`capacity = (eff.slots × NPC_SHIFTS + MAX_PITCH_PER_DAY) × LAGER_TAGE` (Kiosk
Stufe 0: 10 × 7 = 70; Baufirma voll: 82 × 7 = 574). Ø-Preis
`round(stock_cost / stock)` (0 bei leerem Lager).

`buyStock(guildId, userId, units | 'voll', now)`: nach `fresh`; `units` ganze
Zahl > 0, `'voll'` = `capacity − stock`; über der Kapazität → `reason:
'capacity'` mit `free`; Kosten `units × warePrice`; Kasse muss reichen
(`reason: 'kasse'`); `closed_until > now` blockt nicht (Einkauf ist erlaubt).
Schreibt `stock += units`, `stock_cost += kosten`, `kasse −= kosten` in einer
`saveCompany`. Keine `unb`-Buchung: Die Kasse ist Firmenzustand, das Geld
verlässt das Spiel (Senke).

Entnahme beim Verbrauch: `avg = round(stock_cost / stock)`; `stock −= 1`,
`stock_cost −= avg` (bei `stock` = 0 danach `stock_cost = 0`).

## §3 – die Decke sinkt ehrlich

`ceilingOf` bekommt `ware = units × wareUnit(b)` mit `units = slots × NPC_SHIFTS
+ MAX_PITCH_PER_DAY` (bei Kurs = Start) und liefert `{ gross, wages, ware,
net: gross − wages − ware, slots, factor }`:

| Branche | Kern alt → neu | Vollausbau alt → neu |
|---|---|---|
| Kiosk | 2.850 → **2.350** | 16.631 → **15.681** |
| Imbiss | 3.465 → 2.841 | 21.015 → 19.815 |
| Autowäsche | 3.180 → 2.660 | 17.837 → 16.849 |
| Café | 21.600 → **18.180** | 133.380 → 126.180 |
| Fitnessstudio | 14.100 → 11.860 | 87.855 → 83.095 |
| Werkstatt | 20.640 → 17.120 | 134.265 → 126.785 |
| Spedition | 78.000 → **65.080** | 487.095 → **460.495** |
| Baufirma | 75.000 → 61.400 | 558.345 → **530.465** |
| Club | 68.940 → 58.380 | 414.900 → 392.820 |

(Handrechnung Spedition Kern: 96.900 − 18.900 − 34 × 380 = 65.080.) Die
Rangfolge bleibt (Baufirma > Spedition > Club …, alle Kern-Decken unter
Musik+Creator). Grenzen: bester Fall Kurs 0,5 und volles Lager = Decke +
`units × wareUnit × 0,5`; schlechtester Fall Kurs 2,0 und ad hoc = Decke −
`units × wareUnit × 1,5`. Der Ereignis-Deckel (Umsatz × 1,15) bleibt
unberührt – Waren sind Kosten, kein Umsatz. Der Decken-Test kauft im Lauf
täglich das Lager voll (Kurs = Start, weil die Testwelt keine Börsenticks hat)
und prüft `best ≤ decke`; ein zweiter Lauf ohne Einkauf prüft `best ≤ decke −
0,25 × units × wareUnit + Toleranz` (ad hoc kostet ein Viertel mehr).

## Anzeige

- **Betriebsansicht:** Feld „📦 Waren" – `🧱 Beton & Stahl · Lager **34/574** ·
  heute **371** (BETO +9 %) · Ø bezahlt 340 · reicht ~1,5 Tage`; bei leerem
  Lager `⚠️ leer – Schichten kaufen ad hoc (+25 %)`. „reicht" =
  `stock / (Vollbetriebs-Schichten + 4)` Tage, eine Nachkommastelle.
- **Zeile 2:** Personal · Ausbau · **Lager** · Home/Vorfall. „Schließen"
  wandert in die Ausbau-Ansicht (Zeile 1: Ausbauen · Schließen · Firma · Home;
  Fluxer: 4 + 4 Extras = 8 ≤ 9).
- **Lager-Ansicht** (`firma|lager|0|<uid>`): Titel „🏬 Lager – Name", Text:
  Ware, Lieferant mit Kurs und Tagesänderung (`wallstreet.quote`), Tagespreis
  vs. Einheitspreis bei Start („371 statt 340: +9 %"), Bestand/Kapazität,
  Ø-Preis, Lagerwert, Hinweis „Aktie **BETO** halten sichert gegen teure
  Ware ab." Knöpfe: „Einkaufen" (Modal `fware|kaufen|<uid>`, Feld Menge oder
  „voll"), „Voll machen" (`firma|lagervoll|0|<uid>`, deaktiviert bei voll
  oder Kasse < eine Einheit), „Firma", Home.
- **Aktien-Ansicht:** Zeile „🏭 Lieferant für: Baufirma" (aus den Branchen,
  deren `ware.supplier` das Symbol ist).

## Messung, Tests, Docs

- `firmenlauf`: kauft täglich das Lager voll, solange `ratio ≤ 1`, sonst ad hoc
  (in der Messwelt ohne Ticks ist `ratio = 1`, also immer Einkauf); gibt
  Wareneinsatz je Tag und Anteil ad hoc aus. Mediane und Amortisation neu
  in §15 (Kern und Vollausbau, mit Ereignissen wie 2b). Musik+Creator unberührt.
- Tests (`test/companyGoods.test.js`): `wareUnit` je Branche; Preis-Klemmung
  (Kurs 0,2 → 0,5; 3,0 → 2,0; fehlender Kurs → Start); Kiosk-Tag mit 2
  Schichtleitern bei Auslastung 0,4: ohne Lager `−6 × 63 = −378` zusätzlich,
  mit Lager (70 zu 50 gekauft) Kasse unverändert, `stock 64`, `stock_cost
  3.200`; `buyStock` Kapazität/Kasse/„voll"; Spieler-Schicht und Anpacken
  verbrauchen je 1; geschlossener Tag verbraucht nichts; neue Decken-Werte
  (65.080, 460.495, 15.681) und Rangfolge; Decken-Läufe mit/ohne Einkauf.
- Docs: §15 (neue Decken, Wareneinsatz 20 %, Hedge-Hinweis, gemessene
  Mediane), Patchnotes 1.35.0, Addendum in der 2a-Spec.

## Nachtrag 2026-09-20: Erstausstattung

**Befund der Gesamt-Review:** Eine frische Firma startete mit `stock 0`. Bei
Auslastung 0,3–0,4 ist die Schicht mit Ware ad hoc mehrere Tage rot
(Kiosk, 2 Aushilfen: `6 × (round(250 × 0,4) − 100 − 63) = −378` an Tag 1),
die NPCs kündigen nach `NPC_QUIT_AFTER_UNPAID = 3` unbezahlten Tagen, und an
Tag 15 ist die Firma insolvent – für einen Inhaber, der gründet, einstellt
und wartet (der Ablauf vor 1.35). Betroffen: Kiosk, Imbiss, Autowäsche,
Werkstatt, Baufirma.

**Beschluss (Option a, plus faules Nachrüsten):**

- **Erstausstattung bei der Gründung.** `company.found` bucht `b.price +
  starterCost` in EINER Buchung (§9) mit `starterCost = capacityOf(b, Kern) ×
  wareUnit(b)` (`company.starterOf`): Kiosk 70 × 50 = 3.500, Café 133 × 180 =
  23.940, Spedition 238 × 380 = 90.440, Baufirma 280 × 340 = 95.200. Die Zeile
  entsteht mit `stock = Kapazität`, `stock_cost = starterCost`, `stock_seeded
  = 1`; die Guthabenprüfung nimmt die Summe (`needed`), das Ergebnis trägt
  `starter: { units, cost }` und `total`. Kein Faucet: Schließen und Verkauf
  zahlen das Lager zum Einstand – die Erstausstattung kommt zurück wie jeder
  Einkauf, nie mehr. Die Gründungsansicht zeigt „Gründung X + Erstausstattung
  Y (N Einheiten, volles Lager)", der Hinweis nach der Gründung nennt beides.
- **Bestehende Firmen.** Neue Spalte `stock_seeded INTEGER NOT NULL DEFAULT 0`
  (CREATE TABLE, PRAGMA-Nachrüstung, `saveCompany`; `insertCompany` setzt 1).
  `settle` prüft sie am Anfang, VOR dem frühen Ausstieg bei `total <= 0` –
  schon der erste Blick nach dem Update befüllt: `stock = max(stock,
  capacityOf(b, eff))`, `stock_cost` bleibt, was wirklich gekauft wurde (bei
  leerem Lager 0 – Bestand aus der Zeit vor dem Update, ohne Einstand, zahlt
  das Schließen nichts aus), `stock_seeded = 1`, Chronik-Zeile „📦 Lager aus
  der Zeit vor dem Update aufgefüllt – ohne Einstand." (`pushNews`, Betrag 0).
- **Wirkung auf den Anlauf (Handrechnung Kiosk, 2 Aushilfen, Hände weg):**
  Tag 1 a = 0,4 → `6 × (100 − 100) = 0`, Tag 2 a = 0,48 → +120, Tag 3 a =
  0,544 → +216; die Kasse ist nie negativ, das Lager (70) trägt elf Tage, ab
  Tag 13 laufen die Schichten ad hoc bei a ≈ 0,77 mit `6 × (193 − 100) − 378
  = +180` je Tag. Kein NPC kündigt, keine Insolvenz.
- **Decken und Mediane** ändern sich nicht: Die Decke ist ein Tag mit vollem
  Lager zum Normalpreis, der stationäre Zustand der Messung ebenso. Nur die
  Anlaufphase wird kürzer (der Anteil ad hoc sinkt). Die in §15 zitierten
  Mediane stammen aus der Messung vor der Erstausstattung und werden mit der
  nächsten Messung aufgefrischt; `firmenlauf` rechnet die Erstausstattung in
  `investition` (Amortisation) und als ersten Einkauf in `wareProTag`.
- **Tests** (`test/companyGoods.test.js`): Buchung `−(25.000 + 3.500)`,
  Zeile `stock 70 / stock_cost 3.500 / stock_seeded 1`, Guthabenprüfung auf die
  Summe, Sofort-Schließen zahlt genau 3.500; Hände-weg-Szenario über 20 Tage
  (Kasse = Handrechnung je Tag, Minimum 0, keine Kündigung, Firma offen);
  Nachrüsten (`stock_seeded 0` → nach `settle` Kapazität, Einstand 0, eine
  Chronik-Zeile; zweite Abrechnung füllt nicht erneut; Restbestand behält
  seinen Einstand; Schließen zahlt nur den Einstand). Handwerte in
  `company.test.js`/`companyEvents.test.js`, die am leeren Start-Lager hingen,
  sind neu hergeleitet (Minuskiosk −57/−45 statt −246/−612, Wachsendes Café
  4.536 statt 486 …).
