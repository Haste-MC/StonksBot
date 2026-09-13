# Eigene Firmen – Stück 2a: Branchenkatalog und Ausbau

Stand: 2026-09-13 · Zweig `main` · baut auf Stück 1 (`2026-09-12-firmen-kern-design.md`)

## Ziel

Der Kern hat die Investition bewusst ausgespart: Gründen ist billig, die
Decke niedrig (Spedition 78.000/Tag, unter Musik+Creator). Stück 2a bringt
das, wofür man das Musikgeld ausgibt – **Ausbau** – und den vollen
**Branchenkatalog**. Beschlüsse aus dem Gespräch:

| # | Beschluss |
|---|---|
| 1 | Stück 2 wird geteilt: **2a** Katalog + Ausbau (diese Spec), **2b** Ereignisse/Vorfälle mit Entscheidung (eigene Spec, Domäne `company` im Entscheidungs-System). |
| 2 | Ausbau = **Stufenleiter je Branche (A)** plus **Einzelinvestitionen als Extras (C)**. Filialen (B) kommen später. |
| 3 | Voll ausgebaute Spedition **~500.000/Tag** bei **~50 Mio** Gesamtausbau (Amortisation ~100 Tage) – nach zwei Jahren gleichauf mit Musik+Creator (490.000). Alle Branchen skalieren im selben Verhältnis (~×6 des Kernwerts). |
| 4 | Neun Branchen, drei je Klasse. Der Charakter kommt aus den Zahlen, nicht aus Sonderfällen im Code. |

## Nicht-Ziele

- Keine Ereignisse (2b), keine Filialen, keine zweite Firma je Spieler.
- Keine Bauzeit – der Ausbau wirkt sofort. Die Bremse ist das Geld (§15).
- Kein Rückbau, kein Wiederverkauf von Stufen oder Extras. Insolvenz und
  Schließen vernichten den Ausbau mit der Firma.
- Kein Zeitbudget-Umbau (offener Punkt seit Stück 1).

## Was heute gilt (gegen den Code geprüft)

| | Quelle |
|---|---|
| Branche `{ id, name, emoji, price, slots, umsatz, lohn, blurb }`; `RANKS` Faktoren 1 / 1,25 / 1,5; `NPC_SHIFTS 3`, `MAX_PITCH_PER_DAY 4` | `src/data/companies.js` |
| `ceilingOf(b)` = `slots × 3 × umsatz × 1,5 + 4 × umsatz × 1,5 − slots × 3 × lohn × 1,5` | `src/company.js:65` |
| `b.slots` wird gelesen in `hireNpc`, `join`, `openings`, `dailyTarget`, `status`; `b.umsatz` in `settle` (NPC), `workShift`, `pitchIn`, `status.forecast`, `ceilingOf` | `src/company.js` |
| Gründung bucht vom Konto des Inhabers, Bank wird bei Bedarf angezapft; `withdraw`/`deposit` buchen mit `{ xp: false }` (XP-Schleife) | `src/company.js found/deposit/withdraw` |
| Gründungsansicht: eine Button-Zeile mit drei Branchen; Betriebsansicht zwei Zeilen; Personal seitenweise; Fluxer: Nav-Zeile zuerst wegen `MAX_REACTIONS` | `src/ui.js`, `src/fluxer/render.js` |
| Messskript-Archetyp `firmenlauf(branchId, tage)` mit `--strategie`-Muster; gemessen ohne Ausbau: Kiosk 2.850, Café 21.600, Spedition 78.000 | `scripts/messung-geldquellen.js`, ARCHITEKTUR §15 |

## Der Katalog

Neun Branchen. **Alle Zahlen sind Startwerte für die Messung.** Vorgerechnete
Kern-Decke (Stufe 0, ohne Extras, Formel oben) und Amortisation der Gründung
dienen nur der Einordnung; gezogen wird `umsatz`.

| Klasse | id | Branche | Gründung | Plätze | Umsatz | Lohn | Kern-Decke/Tag | Charakter |
|---|---|---|---|---|---|---|---|---|
| klein | `kiosk` | 🏪 Kiosk | 25.000 | 2 | 250 | 100 | 2.850 | *vorhanden* – läuft fast allein |
| klein | `imbiss` | 🌭 Imbiss | 40.000 | 3 | 240 | 90 | 3.465 | viele billige Schichten, Werbung wirkt stark |
| klein | `autowaesche` | 🚗 Autowäsche | 35.000 | 2 | 260 | 80 | 3.180 | kaum Personal, dafür teurer Ausbau (Anlagen) |
| mittel | `cafe` | ☕ Café | 120.000 | 5 | 900 | 180 | 21.600 | *vorhanden* |
| mittel | `fitness` | 🏋️ Fitnessstudio | 150.000 | 4 | 700 | 150 | 14.100 | wenig Lohn, Umsatz hängt am Ausbau (Geräte) |
| mittel | `werkstatt` | 🔧 Werkstatt | 200.000 | 4 | 1.100 | 320 | 20.640 | teure Fachkräfte, hoher Umsatz je Schicht |
| groß | `spedition` | 🚚 Spedition | 1.200.000 | 10 | 1.900 | 420 | 78.000 | *vorhanden* |
| groß | `baufirma` | 🏗️ Baufirma | 1.800.000 | 12 | 1.700 | 500 | 75.000 | höchste Löhne, nur mit voller Mannschaft rentabel |
| groß | `club` | 🍸 Club | 1.000.000 | 6 | 2.400 | 380 | 68.940 | wenige Plätze, teurer Ausbau, starke Werbewirkung |

Regel aus dem Kern, die bleibt: **Kern-Decke jeder Branche unter Musik+Creator
(100.916/Tag nach einem Jahr).** Die Baufirma wurde deshalb von 2.200 auf
1.700 Umsatz gesetzt (2.200 → 105.000).

„Werbung wirkt stark" (Imbiss, Club) ist in 2a **kein** Sonderfall im Code –
es steht als Absicht für 2b (Ereignisse) hier, damit die Zahlen später dort
gezogen werden. In 2a gilt für alle dieselbe Werbung.

## Die Leiter (A)

Jede Branche hat **fünf Stufen**, kumulativ – Stufe 3 enthält 1 und 2. Ein
Eintrag `{ name, price, slots, umsatz }`: `slots` ist die **neue Platzzahl**,
`umsatz` der **Faktor** auf den Umsatz je Schicht (nicht kumulativ zu
rechnen – der Wert der Stufe gilt).

Gemeinsame Regel für alle Branchen:

- Umsatzfaktoren: Stufe 1–5 = **1,2 · 1,45 · 1,7 · 1,95 · 2,2**.
- Plätze: verdoppeln sich über die Leiter (Kern → Stufe 5), gleichmäßig
  verteilt, gerundet: Kiosk 2 → 3, 3, 4, 4, 4 · Imbiss 3 → 4, 4, 5, 6, 6 ·
  Autowäsche 2 → 3, 3, 4, 4, 4 · Café 5 → 6, 7, 8, 9, 10 · Fitness 4 → 5, 6, 6,
  7, 8 · Werkstatt 4 → 5, 6, 6, 7, 8 · Spedition 10 → 12, 14, 16, 18, 20 ·
  Baufirma 12 → 14, 17, 19, 22, 24 · Club 6 → 7, 8, 9, 11, 12.
- Preise: **Gründungspreis × 1,5 · 3 · 6 · 9 · 14** (Summe ×33,5). Spedition:
  1,8 · 3,6 · 7,2 · 10,8 · 16,8 Mio = 40,2 Mio.
- Löhne skalieren **nicht** – die Marge wächst mit der Größe (Skaleneffekt).
  Das ist der Mechanismus, der aus 78.000 die halbe Million macht.

Namen der Stufen (Stimmung, kein Code):

| Branche | 1 | 2 | 3 | 4 | 5 |
|---|---|---|---|---|---|
| Kiosk | Kühlregal | Lotto-Terminal | Zweite Kasse | Backshop | Paketstation |
| Imbiss | Zweiter Grill | Sitzplätze | Lieferdienst | Zweite Theke | Foodtruck |
| Autowäsche | Zweite Box | Staubsaugerplätze | Waschstraße | Innenreinigung | Zweite Waschstraße |
| Café | Terrasse | Siebträger-Maschine | Frühstückskarte | Abendbetrieb | Rösterei |
| Fitnessstudio | Freihantelbereich | Kursraum | Sauna | Cardio-Fläche | 24-Stunden-Betrieb |
| Werkstatt | Zweite Hebebühne | Diagnosegerät | Reifenlager | Lackierkabine | Dritte Hebebühne |
| Spedition | 3 Lkw | Depot | Eigene Werkstatt | Flotte 15 | Flotte 20 |
| Baufirma | Zweite Kolonne | Kran | Bauhof | Dritte Kolonne | Fertigteilwerk |
| Club | Zweite Bar | Soundanlage | Lounge | Zweiter Floor | Dachterrasse |

## Die Extras (C)

Vier je Branche, in beliebiger Reihenfolge kaufbar, jedes genau einmal.
`{ id, name, emoji, price, umsatz?, slots?, minStufe }` – `umsatz` ist ein
**Zuschlag** auf den Faktor (Leiter 2,2 + drei Extras à 0,15 = 2,65), `slots`
ein Zuschlag auf die Plätze. Gemeinsame Regel: **drei Extras à +0,15 Umsatz,
eines à +2 Plätze (klein: +1)**; Preis je Extra **Gründungspreis × 2**; das
Platz-Extra und eines der Umsatz-Extras haben `minStufe` (2 bzw. 3), die
beiden anderen keine.

| Branche | Extras (Umsatz +0,15 / Plätze) |
|---|---|
| Kiosk | Zeitungsregal · Kaffeeautomat · Bargeld-Service (ab 3) · Verlängerte Öffnung (+1 Platz, ab 2) |
| Imbiss | Eiswürfelmaschine · Fritteuse XL · Currywurst-Franchise (ab 3) · Nachtschicht (+1, ab 2) |
| Autowäsche | Wachsprogramm · Felgenreiniger · Kartenzahlung (ab 3) · Sonntagsöffnung (+1, ab 2) |
| Café | Kuchenvitrine · Kaffeebohnen-Verkauf · Catering (ab 3) · Zweite Schicht (+2, ab 2) |
| Fitnessstudio | Proteinbar · Personal Training · Firmenverträge (ab 3) · Frühöffnung (+2, ab 2) |
| Werkstatt | Reifenservice · TÜV-Prüfstelle · Oldtimer-Restauration (ab 3) · Samstagsschicht (+2, ab 2) |
| Spedition | Telematik · Tankkarten-Vertrag · Gefahrgut-Lizenz (ab 3) · Nachtschicht (+2, ab 2) |
| Baufirma | Eigener Bagger · Gerüstbau · Sanierungslizenz (ab 3) · Zweite Schicht (+2, ab 2) |
| Club | VIP-Bereich · Gastro-Lizenz · Booking-Agentur (ab 3) · Afterhour (+2, ab 2) |

## Die Decke, vorgerechnet

`effectiveOf(company, branch)` → `{ slots, umsatzFactor }`:

```
stufe   = branch.stufen[company.stufe − 1]      (Stufe 0: Kern)
slots   = (stufe ? stufe.slots : branch.slots) + Σ extras.slots
faktor  = (stufe ? stufe.umsatz : 1) + Σ extras.umsatz
```

`ceilingOf(b, stufe = 5, extras = alle)`:

```
gross = slots × 3 × b.umsatz × 1,5 × faktor + 4 × b.umsatz × 1,5 × faktor
wages = slots × 3 × b.lohn × 1,5
net   = gross − wages
```

Spedition voll: slots 22, faktor 2,65 → `22 × 3 × 1.900 × 1,5 × 2,65 = 498.465`
+ `4 × 1.900 × 1,5 × 2,65 = 30.210` = 528.675 brutto − Löhne `22 × 3 × 630 =
41.580` → **487.095/Tag**. Ziel 500.000 – das ist nah genug für Startwerte;
die Messung zieht `umsatz` oder die Faktoren. Kiosk voll: slots 5, faktor 2,65:
`5 × 3 × 250 × 1,5 × 2,65 = 14.906` + Anpacken `4 × 250 × 1,5 × 2,65 = 3.975`
− Löhne `5 × 3 × 150 = 2.250` = **16.631**. Café voll: slots 12:
`12 × 3 × 900 × 1,5 × 2,65 = 128.790` + `14.310` − `12 × 3 × 270 = 9.720` =
**133.380**.

Gesamtausbau Spedition: 40,2 Mio Leiter + 9,6 Mio Extras = **49,8 Mio** →
Amortisation bei 487.095/Tag ≈ 102 Tage. Kiosk: 837.500 + 200.000 = 1,04 Mio
bei 16.631/Tag ≈ 62 Tage.

## Der Kern rechnet mit dem Ausbau

### Daten

- `companies.stufe INTEGER NOT NULL DEFAULT 0` (Spalte nachrüsten: die
  Tabelle ist seit Stück 1 produktiv → `ALTER TABLE … ADD COLUMN` im
  Try-Muster von `db.js`, wie beim Tageszähler der Schichten).
- Neue Tabelle `company_extras (company_id INTEGER NOT NULL, extra_id TEXT NOT NULL, bought_at INTEGER NOT NULL, PRIMARY KEY (company_id, extra_id))`.
- `db.js`: `setCompanyStufe(id, stufe)`, `companyExtras(companyId)` → `[extra_id]`, `addCompanyExtra(companyId, extraId, now)`, `deleteExtrasOfCompany(companyId)` (bei Schließen/Insolvenz mit aufräumen).

### `company.js`

- **`effectiveOf(company, branch)`** wie oben. Jede Stelle, die heute
  `b.slots` liest (`hireNpc`, `join`, `openings`, `dailyTarget`, `status`),
  nimmt `eff.slots`; jede Stelle, die `b.umsatz` liest (`settle`,
  `workShift`, `pitchIn`, `status.forecast`), multipliziert mit
  `eff.umsatzFactor`. `dailyTarget(b, staffCount, werbung, slots)` bekommt
  die Plätze als Parameter, weil das Ziel an der Besetzung *der aktuellen*
  Plätze hängt.
- **`upgrade(guildId, userId, now)`**: nächste Stufe; `stufe ≥ 5` →
  `reason: 'max'`; Guthaben (`total`) ≥ Preis, Bank anzapfen wie bei
  `found`; **zuerst** `setCompanyStufe` (§7), dann **eine** Buchung
  `changeCash(−price, 'Ausbau: <Firma> – <Stufe>', { xp: false, kind: 'company' })`;
  scheitert sie, Stufe zurück. Kein XP: Investition ist keine Ausgabe fürs
  Level – sonst wäre das die nächste XP-Schleife (Stück-1-Review).
- **`buyExtra(guildId, userId, extraId, now)`**: Extra bekannt und zur
  Branche gehörig (`unknown`), noch nicht gekauft (`owned`), `minStufe`
  erreicht (`stufe`), Guthaben; `addCompanyExtra` zuerst, dann eine Buchung,
  bei Fehler Zeile löschen.
- Beide nach `fresh` (Abrechnung zuerst) – eine gerade insolvente Firma kann
  nicht ausgebaut werden.
- **`ceilingOf(b, stufe = MAX, extraIds = alle)`** und **`nextStufe(company, branch)`** für die Anzeige.
- `closeCompany` löscht die Extras mit.
- **`status()`** liefert zusätzlich `stufe`, `stufen` (Liste mit `owned`), `extras` (Liste mit `owned`, `locked`), `effective`, `ceilingNow`, `ceilingMax`, `nextStufe`.

### Warum die Investition vom Konto kommt, nicht aus der Kasse

Die Kasse ist Betriebsgeld (Löhne, Werbung); der Ausbau ist Kapital des
Inhabers. Wer aus dem Gewinn ausbaut, entnimmt erst – zwei Klicks, dafür
bleibt die Kasse als Puffer gegen die Insolvenz sichtbar und die Bilanz
lesbar („was habe ich investiert, was hat die Firma verdient").

## Ansichten

- **Gründungsansicht:** drei Button-Zeilen (klein · mittel · groß) à drei
  Branchen, plus Home-Zeile = 4 Zeilen. Der Embed listet je Klasse die drei
  Branchen mit Preis, Plätzen, Umsatz/Lohn, Kern-Decke **und** voller Decke
  („ausgebaut bis ~487.000/Tag"). Fluxer: 9 Branchen + Home = 10 > 9
  Reaktionen → die Gründungsansicht bekommt Seiten je Klasse
  (`firma|gruendung|<klein|mittel|gross>|<userId>`) mit Nav-Zeile zuerst; auf
  Discord wird trotzdem alles auf einer Seite gezeigt (Seitenparameter
  optional, Standard „alle").
- **Betriebsansicht:** neue Zeile im Embed „🏗️ Ausbau: Stufe 2/5 *(Depot)* ·
  3 von 4 Extras"; Footer zeigt die aktuelle Decke und die volle; neuer
  Button „🏗️ Ausbau" in der zweiten Zeile (Personal · Ausbau · Schließen ·
  Home = 4).
- **Ausbau-Ansicht** (`firma|ausbau|0|<userId>`): Feld „Nächste Stufe" mit
  Name, Preis, Wirkung („→ 14 Plätze, Umsatz ×1,45") oder „Voll ausgebaut";
  vier Felder Extras mit Preis, Wirkung, Zustand (✅ gekauft · 🔒 ab Stufe n
  · 🛒 kaufbar). Buttons: Nav-Zeile zuerst (Ausbauen · Firma · Home), dann
  eine Zeile mit den vier Extras (`firma|extra|<extraId>|<userId>`),
  gekaufte/gesperrte/unbezahlbare deaktiviert. 7 Buttons – passt in Fluxers
  9 Reaktionen.
- Bestätigung vor dem Kauf? **Nein** – Preis und Wirkung stehen am Button,
  ein Kauf ist nicht umkehrbar, aber auch nicht versehentlich (kein Modal,
  kein Betrag). Bei Stufen ab 5 Mio trotzdem eine Rückfrage wie beim
  Schließen (`firma|ausbauen|ja|<userId>`), damit ein Fehlklick nicht 16 Mio
  kostet. Grenze: `CONFIRM_ABOVE = 5_000_000`.

## §3 und Messung

- **Decke:** `ceilingOf(b)` (voll) je Branche im Test vorgerechnet; 365-Tage-
  Simulation im Vollausbau (Stufe 5, alle Extras, volle NPC-Besetzung mit
  Schichtleitern, Werbung, Anpacken): `best <= decke`, Median > 0. Zweiter
  Test: **Monotonie** – jede Stufe und jedes Extra hebt `ceilingOf` echt.
- **Reihenfolge und Doppelkauf:** Stufe 3 vor 2 unmöglich (Leiter), Extra
  zweimal → `owned`, Extra vor `minStufe` → `stufe`; fehlgeschlagene Buchung
  rollt Stufe/Extra zurück.
- **Bestehende Firmen** (Stufe 0 nach der Spaltenmigration) verhalten sich
  exakt wie vorher: `effectiveOf` mit Stufe 0 und ohne Extras liefert
  `branch.slots` und Faktor 1 – die Kern-Tests bleiben grün.
- **Messung** (`scripts/messung-geldquellen.js`): Archetyp `firma-ausbau:<branch>`
  in zwei Spielweisen: **Kapitalist** (50 Mio Startguthaben, baut am Tag 1
  voll aus) und **Aufsteiger** (kein Startguthaben; entnimmt täglich und
  kauft die nächste Stufe/das nächste Extra, sobald das Konto reicht,
  billigstes zuerst). Ausgabe je Branche: Median/Tag im Vollausbau, Decke,
  Amortisation des Gesamtausbaus, und beim Aufsteiger der Tag, an dem Stufe
  5 erreicht ist. Zielmarken: Spedition ~500.000/Tag voll; alle Branchen
  voll ≈ ×6 ihres Kernwerts; Amortisation des Gesamtausbaus 60–120 Tage.
  Liegt eine Branche mehr als 25 % daneben, werden ihre `umsatz`-Faktoren
  der Leiter angepasst (Kern-`umsatz` bleibt, sonst verschiebt sich Stück 1).
- ARCHITEKTUR §15: „Firma voll ausgebaut ≈ Musik+Creator nach zwei Jahren –
  die Königsdisziplin *mit* Firma." mit den gemessenen Werten. Patchnotes
  1.32.0.

## Fehlerfälle

| Fall | Verhalten |
|---|---|
| Ausbau bei Stufe 5 | `max`, Button deaktiviert |
| Extra unbekannt / fremde Branche | `unknown` |
| Extra schon gekauft | `owned`, Button deaktiviert |
| Extra vor `minStufe` | `stufe`, Button 🔒 |
| Guthaben reicht nicht | `funds` mit `needed/have`, Button deaktiviert (Anzeige kennt das Guthaben nicht – sie zeigt den Preis, der Kauf lehnt ab) |
| Buchung schlägt fehl | Stufe/Extra zurückgenommen, `payment` |
| Firma inzwischen insolvent | `no_company` (nach `fresh`) |
| Personal über neuen Plätzen (kann nicht passieren – Plätze wachsen nur) | – |

## Tests (`test/company.test.js`, neuer Abschnitt; Kern-Tests unverändert)

1. Katalog: neun Branchen, je fünf Stufen mit steigenden Preisen, Plätzen
   und Faktoren; je vier Extras, Summen der Preise ≈ 41,5× Gründung (±5 %);
   Kern-Decke jeder Branche < 100.916.
2. `effectiveOf`: Stufe 0 ohne Extras = Kernwerte; Stufe 5 + alle = Decke
   der Vorrechnung (Spedition 487.095 als Handrechnung).
3. Monotonie: jede Stufe und jedes Extra hebt `ceilingOf`.
4. `upgrade`: Reihenfolge, Preis gebucht (eine Buchung, `xp: false`), Bank
   angezapft, `max`, `funds`, Rollback bei Buchungsfehler.
5. `buyExtra`: `unknown`, `owned`, `stufe`, Rollback.
6. Wirkung im Betrieb: nach Stufe 1 fasst die Firma mehr NPCs, `settle`
   rechnet mit dem Faktor (Handrechnung eines Tages), `workShift`/`pitchIn`
   ebenso.
7. Schließen/Insolvenz löscht Extras.
8. Bestehende Firma (Stufe 0) unverändert: Kern-Handrechnungen aus Stück 1
   gelten weiter (die vorhandenen Tests).
9. §3: Vollausbau-Simulation je Branche, `best <= decke`.
10. Migration: eine Datenbank aus Stück 1 ohne Spalte `stufe` lädt und hat
    danach Stufe 0 (Test legt die Tabelle im alten Schema an, lädt `db.js`
    neu – Muster aus bestehenden Migrationstests, falls vorhanden; sonst
    prüft der Test nur, dass `ALTER TABLE` idempotent ist).

## Berührte Dateien

| Datei | Änderung |
|---|---|
| `src/data/companies.js` | sechs neue Branchen, `stufen`/`extras` je Branche, `CONFIRM_ABOVE`, `MAX_STUFE = 5` |
| `src/db.js` | Spalte `stufe` (Migration), Tabelle `company_extras`, Funktionen |
| `src/company.js` | `effectiveOf`, `nextStufe`, `ceilingOf(b, stufe, extras)`, `upgrade`, `buyExtra`, Anpassung aller `b.slots`/`b.umsatz`-Stellen, `status` erweitert, `closeCompany` löscht Extras |
| `src/ui.js` | Gründungsansicht (9 Branchen, Klassen-Seiten), Betriebsansicht (Ausbau-Zeile, Button), `buildFirmaAusbauView` |
| `src/buttons.js` | `firma|ausbau`, `firma|ausbauen|<ja>`, `firma|extra|<id>`, `firma|gruendung|<klasse>` |
| `test/company.test.js` | neuer Abschnitt |
| `scripts/messung-geldquellen.js` | Archetyp `firma-ausbau` (Kapitalist, Aufsteiger) |
| `src/data/patchnotes.js` | 1.32.0 |
| `ARCHITEKTUR.md` | §15 |

## Reihenfolge der Umsetzung

1. Daten (neun Branchen, Leiter, Extras) + `effectiveOf`/`ceilingOf`/Monotonie + Tests 1–3.
2. Migration + `company_extras` + `upgrade`/`buyExtra` + Tests 4, 5, 7, 10.
3. Ausbau im Betrieb (alle `b.slots`/`b.umsatz`-Stellen, `status`) + Tests 6, 8.
4. Ansichten und Handler.
5. Messung (Test 9, Archetypen), Werte ziehen, Patchnotes, §15.

## Nach der Messung (2026-09-13)

Gemessen voll ausgebaut (365 Tage, Median): Kiosk 16.636/Tag, Imbiss 21.015,
Autowäsche 17.827, Café 133.360, Fitnessstudio 87.838, Werkstatt 134.248,
Spedition 487.060, Baufirma 558.304, Club 414.900.

Die Baufirma stand mit den Standardfaktoren (1,2…2,2) bei 495.574/Tag und 178
Tagen Amortisation – über der in Beschluss 3 genannten Toleranz, weil ihr
Ausbau mit 74,7 Mio (bei Kern-Decke 75.000) der teuerste im Katalog ist.
**Entscheidung des Nutzers (2026-09-13, Option B):** Die Baufirma behält ihre
eigenen Stufenfaktoren (1,3 · 1,6 · 1,9 · 2,2 · 2,5) und wird damit zur neuen
Spitze – 558.304/Tag, noch vor der Spedition (487.060). Grund: „die Baufirma
kann die Spitze sein"; die Faktoren sind der einzige Hebel, der den Kern
(Stück 1) nicht verschiebt. Die Spedition bleibt gleichauf mit Musik+Creator
nach zwei Jahren (490.099), alle übrigen Branchen liegen darunter. Der Code
bleibt unverändert, nur die Dokumentation (Patchnotes, §15) benennt jetzt
ehrlich, dass die Baufirma und nicht die Spedition die Spitze ist.

Randnotiz aus dem §3-Test: Die volle Decke rechnet ungerundet, die Abrechnung
rundet je Schicht auf 0,25 (höchstens +0,5 je Schicht). Die Prüfgrenze im Test
ist deshalb `decke + 0,5 × (Plätze × NPC_SHIFTS + MAX_PITCH_PER_DAY)` statt
eines pauschalen `decke + 1` – beim Kiosk (19 Schichten voll ausgebaut) sind
das 4,75 über der Decke, exakt die Rundung und nichts sonst.
