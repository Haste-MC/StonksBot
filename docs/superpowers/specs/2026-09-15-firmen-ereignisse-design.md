# Eigene Firmen – Stück 2b: Ereignisse und Vorfälle

Stand: 2026-09-15 · Zweig `main` · baut auf Stück 1 (`2026-09-12-firmen-kern-design.md`),
Stück 2a (`2026-09-13-firmen-ausbau-design.md`) und dem Muster der Musik-Ereignisse
(`2026-09-11-musik-ereignisse-design.md`)

## Ziel

Eine Firma läuft heute ohne jede Überraschung: Personal rein, Werbung an,
Abrechnung abholen. Stück 2b bringt die zwei Schichten, die die Musik zum
Spiel gemacht haben – **leichte Tagesereignisse** ohne Klick und **Vorfälle mit
Entscheidung** – ohne die Decke aus §3 aufzugeben.

Beschlüsse aus dem Gespräch:

| # | Beschluss |
|---|---|
| 1 | Beide Schichten in einem Stück (A): leichte Ereignisse in der Abrechnung, Vorfälle im bestehenden Entscheidungs-System mit Domäne `company`. |
| 2 | Häufigkeit und Härte hängen an der **Firmengröße** = Ausbaustufe + gekaufte Extras (A); Geldwirkungen sind Vielfache der aktuellen Tagesdecke. |
| 3 | Die Decke bekommt ausgewiesenen Ereignis-Spielraum (B): `EVENT_UMSATZ_MAX = 1,15` auf den Tagesumsatz; ein Lauf mit Ereignissen prüft den Umsatz gegen `Umsatz-Decke × 1,15`. |
| 4 | Härtester Ausgang ist die **Betriebsschließung für Tage** (bis Stufe 3). Ausbau wird nie zerstört. |
| 5 | Ein gemeinsamer, branchenneutraler Katalog mit Klassen-Filter und optionalem `flavor`-Feld je Branche (C); Start ohne Branchentexte. |

## Nicht-Ziele

- Keine Ereignisse auf Spieler-Angestellte persönlich (kein Lohnabzug, kein
  Rangverlust durch Vorfall). Sie merken Ereignisse nur an ihrer Schicht.
- Keine branchenspezifischen Ereignisse im Start – nur das `flavor`-Feld.
- Kein Verkauf der Firma außerhalb des Übernahme-Vorfalls; keine DMs.
- Keine neue Tabelle für Vorfälle: sie liegen in `creator_events` mit
  `platform = 'company'`, wie die Musik-Vorfälle mit `'music'`.
- Kein Ausgang, der Geld aus dem Nichts erzeugt (§3): positives Geld nur als
  Rückerstattung nach vorherigem Abzug; die Übernahme zahlt höchstens, was
  reingesteckt wurde, plus Kasse.

## Was heute gilt (gegen den Code geprüft)

| | Quelle |
|---|---|
| `settle(companyId, now)`: je Tag Auslastung → NPC-Schichten (Umsatz − Lohn) → unbezahlte Tage/Kündigungen → Minus-Uhr/Insolvenz; `MAX_SETTLE_DAYS 30`; Ergebnis `{ days, umsatz, loehne, quit, insolvent, auslastung, kasse }` | `src/company.js:226` |
| `ceilingOf(b, stufe, extraIds).net` = Tagesdecke mit NPC-Schichtleitern + 4 Anpacken − Löhne; Test „§3: kein Tag über der Decke" mit Toleranz `decke + 0,5 × Schichten` | `src/company.js`, `test/company.test.js` |
| `status()` liefert `stufe`, `stufen[{owned, price}]`, `extras[{owned, price}]`; „investiert" = Summe der gekauften Stufen und Extras (so rechnet der Schließen-Dialog) | `src/buttons.js:2057` |
| `close()` → `closeCompany(…, 'closed')`, Auszahlung der Kasse in einer Buchung `{ xp:false, tax:false, kind:'company' }`; `closed_why` in `insolvent`/`closed` | `src/company.js:522` |
| `workShift`, `pitchIn`, `advertise` prüfen Status `open`, Kasse, Zeit/Energie; Ablehnungsgründe `closed`, `kasse`, `limit`, `running`, `no_time`, `exhausted` | `src/company.js` |
| Entscheidungs-System: `roll(guildId, userId, size, now, random, domain)` mit `openEvent`-Sperre und `MIN_GAP_MS 36 h`, `riskFor(reach)`, `severityFor(reach)`, `apply` verzweigt bei `row.platform === 'music'` nach `applyMusic`; `choose`, `settle` (Verfall), `pending`, `history`; `DECIDE_MS 24 h`, `IGNORE_PENALTY 1,6` | `src/decisions.js` |
| Kataloge: `data/decisions.js` (Creator), `data/musicDecisions.js` (`minListeners`, Genre/Persona-Filter), `data/musicEvents.js` (`candidates(action, risk)` mit `none`-Gewicht 110) | `src/data/` |
| Anzeige: `buildDecisionView` kennt Creator und Musik (Titel-Emoji, Footer, Zurück-Knopf); Musik-Ansicht zeigt „⚠️ Offener Vorfall" und einen Danger-Knopf „Vorfall" | `src/ui.js:2198, 2746` |
| Firmenansicht: zwei Knopfzeilen (Werbung·Anpacken·Entnehmen·Einzahlen / Personal·Ausbau·Schließen·Home); Fluxer-Reaktionshaushalt `MAX_REACTIONS` | `src/ui.js`, `src/fluxer/render.js` |
| Firmen im Messskript: `firmenlauf(branchId, tage, { ausbau })`, `--ohne-ereignisse` bisher nur für Musik | `scripts/messung-geldquellen.js` |

## Schicht 1: Leichte Ereignisse

Je abgerechnetem Tag in `settle` **ein Wurf** aus `data/companyEvents.js`, nach
der Auslastungsbewegung und vor den NPC-Schichten, so dass „Kühlung kaputt"
genau diesen Tag trifft. Kein Klick, keine Frist.

Katalogform (wie `musicEvents`):

```
{ id, weight, klassen: ['klein','mittel','gross'] | null, text,
  umsatz?, days?, auslastung?, kasse?, wages?, quit?, werbung?, staffRank?,
  flavor?: { kiosk: '…', club: '…' } }
```

`candidates(klasse)` filtert nach Klasse und liefert `{ event, weight }`;
Würfel und Tests ziehen aus derselben Funktion. `none` hat Gewicht 140, die
zwölf Ereignisse je 5 → 60/200 = **30 % Ereignistage** für `mittel`/`gross`;
`klein` sieht neun Einträge (45/185 ≈ 24 %), gut : schlecht = 1 : 1.

| id | Klassen | Wirkung | Text |
|---|---|---|---|
| `stammkunde` | alle | `umsatz 1.10` | 🤝 Ein Stammkunde bringt seine Kollegen mit. |
| `grossauftrag` | mittel, gross | `umsatz 1.15`, `days 2` | 📦 Ein Großauftrag – zwei Tage volle Auslastung. |
| `lokalpresse` | alle | `auslastung +0.1` | 📰 Die Lokalzeitung hat euch erwähnt. |
| `guter_tag` | alle | `wages 0.5` | ☀️ Ruhiger Tag, halbe Belegschaft reicht – die Löhne auch. |
| `empfehlung` | alle | `werbung +1` | ⭐ Fünf Sterne online – wirkt wie ein Tag Werbung. |
| `talent` | mittel, gross | `staffRank +1` | 🎓 Einer deiner Leute wächst über sich hinaus. |
| `lieferant` | alle | `umsatz 0.7` | 🚚 Der Lieferant kommt nicht. Halbleere Regale. |
| `kuehlung` | alle | `kasse −0.5` | 🧊 Die Kühlung fällt aus. Was drin war, ist hin. |
| `kassensturz` | alle | `kasse −0.3` | 🧾 Die Kasse stimmt nicht. Keiner weiß, warum. |
| `krank` | alle | `umsatz 0.8` | 🤒 Zwei Leute krank – Lohn läuft, Umsatz nicht. |
| `abwanderung` | mittel, gross | `quit 1` | 👋 Einer deiner Leute geht zur Konkurrenz. |
| `bewertung` | alle | `auslastung −0.1` | 💬 Eine Ein-Stern-Bewertung macht die Runde. |

(`krank` hat kein `wages`-Feld – Löhne laufen ohnehin, das ist die Pointe.)

## Schicht 2: Vorfälle

Nach jeder Abrechnung mit `days ≥ 1` **ein Wurf** `decisions.roll(guildId,
ownerId, groesse, now, random, 'company')` – höchstens ein Vorfall je
Abrechnung, egal wie viele Tage sie nachholt. Die Sperren des Systems gelten
über alle Domänen: ein offener Vorfall je Spieler, 36 h Abstand. Die Frist
(24 h) läuft ab dem echten `now` der Abrechnung, nicht ab dem simulierten Tag.
Nur der Inhaber entscheidet; die Zeile in `creator_events` trägt
`platform = 'company'` und `kind = <id>`.

**Größe und Risiko** (`src/company.js`):

```
groesse(c, extraIds) = c.stufe + extraIds.length            // 0 … 9
riskPerDay(groesse)  = 0.02 + groesse / 9 × 0.06            // 2 % … 8 %
riskFor(groesse, days) = 1 − (1 − riskPerDay) ^ days
severityFor(groesse) = 1 + groesse / 9 × 0.6                // 1 … 1,6
```

Kiosk Stufe 1 ohne Extras: alle ~50 Tage ein Vorfall; voll ausgebaute Firma
(5 + 4): alle ~12 Tage. `decisions.roll` bekommt für die Domäne `company`
diese Funktionen statt `riskFor(reach)` – die Kurve des Creators (Reichweite in
Millionen) passt nicht auf 0…9. Der Aufruf übergibt `{ groesse, days }` als
`size`.

**Härte:** Verluste × `severityFor(groesse)`, × 1,6 bei Schweigen
(`IGNORE_PENALTY`, wie bisher). Gewinne nicht verstärkt.

Katalog `data/companyDecisions.js`, Form wie `musicDecisions` mit `minGroesse`
und optional `minNpc`:

| id | ab Größe | Text | Optionen → Ausgänge |
|---|---|---|---|
| `gesundheitsamt` 🧑‍⚕️ | 0 | Unangemeldete Kontrolle, Mängelliste. | **Sofort beheben** (🔧): `kasse −1` · **Abwarten** (⏳): 5/10 nichts, 5/10 `lock 3`, `auslastung −0.2` · *Schweigen:* `lock 5` |
| `griff_in_die_kasse` 🕵️ | 1, `minNpc 1` | Ein Angestellter greift in die Kasse. | **Anzeigen** (⚖️): `quit 1` + 6/10 nichts weiter, 4/10 `kasse −0.5` · **Unter vier Augen** (🤫): 7/10 `staffRank +1`, `kasse −0.3`; 3/10 `kasse −1`, `quit 1` · *Schweigen:* `kasse −2` |
| `streik` ✊ | 3, `minNpc 3` | Die Belegschaft will mehr. | **Nachgeben** (🤝): `wages 1.3`, `days 7` · **Aussitzen** (🪨): 5/10 `lock 2`, 5/10 `quit 2` · *Schweigen:* `lock 3`, `quit 1` |
| `wasserschaden` 💧 | 0 | Rohrbruch über Nacht. | **Notdienst** (🚨): `kasse −1.5` · **Versicherung** (📄): `lock 2` + 7/10 `refund 1` (Rückerstattung, wirkt nach dem Abzug von `kasse −1.5`, der in dieser Option ebenfalls anfällt), 3/10 nichts · *Schweigen:* `lock 4`, `kasse −1` |
| `uebernahme` 🏦 | 3 | Ein Investor will den Laden. | **Verkaufen** (💰): `sell` – Firma schließt (`closed_why 'sold'`), Auszahlung = investiert + Kasse · **Ablehnen** (🚫): 6/10 nichts, 4/10 `auslastung −0.2` · *Schweigen:* wie Ablehnen |
| `grossauftrag_risiko` 🎲 | 2 | Ein Kunde will alles auf einmal – Vorkasse nötig. | **Annehmen** (✅): `kasse −1` + 65/100 `umsatz 1.15`, `days 5`; 35/100 nichts · **Ablehnen** (🚫): nichts · *Schweigen:* nichts |

Zur Versicherung: „Versicherung" bedeutet `kasse −1.5` (der Schaden fällt so
oder so an) plus zwei Tage zu, dafür in 70 % der Fälle `refund 1` zurück –
netto −0,5 statt −1,5, gegen zwei Tage ohne Schichten.

## Wirkungen (beide Schichten, ein Vokabular)

Angewandt von `company.applyEffect(c, effect, { groesse, ignored, tag })`
(synchron, §7), gerufen aus `settle` (leichte Ereignisse) und aus
`decisions.applyCompany` (Vorfälle):

| Feld | Bedeutung | Grenze im Katalogtest |
|---|---|---|
| `umsatz` | Faktor auf den Umsatz der nächsten `days` Tage (Standard 1); `umsatz_boost`/`umsatz_boost_until` | 0,4 … **1,15** |
| `days` | Dauer für `umsatz`/`wages` in Tagen (Standard 1) | 1 … 7 |
| `auslastung` | Punkte auf die Auslastung, gedeckelt 0…1 | −0,2 … +0,2 |
| `kasse` | Vielfaches von `ceilingOf(b, stufe, extras).net`, negativ = Abzug × Härte | −3 … 0 |
| `refund` | Vielfaches der Tagesdecke zurück in die Kasse, nur nach einem `kasse`-Abzug derselben Option, nie mehr als abgezogen | 0 … 1,5 |
| `wages` | Faktor auf die NPC-Löhne der `days` Tage; `wage_factor`/`wage_factor_until` | 0 … 1,5 |
| `quit` | so viele NPCs kündigen, die dienstältesten (meiste Schichten) zuerst | 0 … 2 |
| `lock` | Betrieb geschlossen: `closed_until = tag + lock × DAY`; keine NPC-Schichten, keine Spieler-Schichten, kein Anpacken, keine Werbung; Löhne laufen | 0 … 5 |
| `werbung` | Werbetage ± auf `werbung_until` (nie unter `tag`) | −3 … +3 |
| `staffRank` | ein zufälliger NPC ±1 Rang (innerhalb `RANKS`) | −1 … +1 |
| `sell` | nur Übernahme: `closeCompany(…, 'sold')` und Auszahlung investiert + Kasse | – |

Verstärkt werden nur Verluste (`kasse < 0`, `auslastung < 0`, `quit`, `lock`,
`werbung < 0`) mit `severityFor × (ignored ? 1,6 : 1)`; `lock` und `quit`
gerundet auf ganze Tage/Personen, `lock` bleibt ≤ 5, `quit` ≤ NPC-Anzahl.
Leichte Ereignisse werden **nicht** verstärkt (Härte 1) – sie sind Rauschen,
keine Strafe.

## §3: Die Ereignis-Decke

Neue Konstante `EVENT_UMSATZ_MAX = 1.15` in `data/companies.js`. Regeln:

- Kein Katalogeintrag hat `umsatz > 1,15`; mehrere Wirkungen stapeln sich
  nicht: Ein neuer `umsatz`-Boost ersetzt den laufenden (`Math.max` der
  Faktoren, längeres `until` gewinnt), er multipliziert ihn nie.
- Der bestehende Test „§3: kein Tag über der Decke" läuft ohne Ereignisse
  (fester Würfel) weiter gegen die Netto-Decke. Ein zweiter 365-Tage-Lauf
  **mit** Ereignissen prüft den **Umsatz** der NPC-Schichten je Tag gegen
  `slots × NPC_SHIFTS × round(umsatz × 1,5) × EVENT_UMSATZ_MAX` (+ Rundungs-
  toleranz). Die Ereignis-Decke ist eine Umsatz-Decke: Lohnnachlässe
  (`guter_tag`, `wages 0,5`) heben den Nettogewinn eines Tages über die
  Netto-Decke, höchstens um die halben Löhne eines Tages – gewollt, weil sie
  kein Umsatz sind, und gedeckelt durch `wages ≥ 0`.
- `kasse` ist nie positiv; `refund` nie größer als der Abzug derselben Option.
- Die Übernahme zahlt `investiert + kasse`, wobei `investiert` = Summe der
  gekauften Stufen- und Extra-Preise (dieselbe Rechnung wie der
  Schließen-Dialog) – nie mehr, als der Spieler eingezahlt hat.
- ARCHITEKTUR §15 nennt beide Zahlen je Branche: Decke und Ereignis-Decke.

## Zustand

`companies` bekommt (PRAGMA-Migration wie `stufe`/`closed_why`):

| Spalte | Typ | Bedeutung |
|---|---|---|
| `news` | TEXT DEFAULT '[]' | Chronik: JSON-Liste der letzten 5 `{ at, text }` (neueste zuerst) |
| `closed_until` | INTEGER DEFAULT 0 | Betrieb geschlossen bis (ms) |
| `umsatz_boost` / `umsatz_boost_until` | REAL DEFAULT 1 / INTEGER DEFAULT 0 | laufender Umsatzfaktor |
| `wage_factor` / `wage_factor_until` | REAL DEFAULT 1 / INTEGER DEFAULT 0 | laufender Lohnfaktor |

`saveCompany` schreibt alle sechs. `closed_why` bekommt den Wert `'sold'`.

**`settle` je Tag** (neu in der Reihenfolge):

1. Auslastung bewegt sich aufs Ziel.
2. Wurf leichtes Ereignis → `applyEffect` (Chronik-Zeile mit `tag`).
3. Faktoren des Tages: `f_umsatz = umsatz_boost_until >= tag ? umsatz_boost : 1`,
   `f_lohn = wage_factor_until >= tag ? wage_factor : 1`.
4. Wenn `closed_until >= tag`: keine Schichten, aber Löhne (`f_lohn`) als
   Verbindlichkeit; sonst NPC-Schichten mit `umsatz × f_umsatz`, Lohn × `f_lohn`.
5. Unbezahlte Tage, Kündigungen, Minus-Uhr wie heute.

Nach der Schleife: `out.news` (die neuen Zeilen), und – nur wenn `days ≥ 1`
und die Firma noch offen ist – der Vorfallswurf.

**Sperre im Betrieb:** `workShift`, `pitchIn`, `advertise` geben bei
`closed_until > now` `{ ok:false, reason:'locked', remainingMs }` zurück;
`jobs.work` reicht `locked` durch. Entnehmen/Einzahlen/Personal/Ausbau gehen
weiter.

**Vorfall anwenden** (`decisions.applyCompany(guildId, userId, row, effect,
now, ignored, random)`): Firma des Inhabers holen (`ownCompany`) – gibt es sie
nicht mehr, wird der Vorfall ohne Wirkung geschlossen. Sonst
`company.applyEffect` synchron, und der Ausgangstext wird als Chronik-Zeile
angehängt; `sell` ruft `company.sell(guildId, ownerId, now)` →
`closeCompany(…, 'sold')` und bucht die Auszahlung in einer Buchung (§9, wie
`close`, `paid:false` bei Buchungsfehler). Rückgabe `done` mit den
angewandten Zahlen für den Ergebnistext.

## Anzeige und Wege

- **Betriebsansicht** (`buildFirmaView`): Feld „📰 Chronik" (letzte 5 Zeilen
  „14.09. · 🧊 Die Kühlung fällt aus…"); bei offenem Vorfall ein rotes Feld
  „⚠️ Vorfall: *Titel* – noch **17 h**" und in der zweiten Knopfzeile
  „Vorfall" (Danger) **statt** „Home" (keine neue Zeile – Fluxer-Reaktions-
  haushalt). Bei Schließung ein Feld „🔒 Geschlossen – noch **2 Tage**", die
  Knöpfe Werbung/Anpacken deaktiviert.
- **`buildDecisionView`**: dritte Domäne `platform === 'company'` – Titel mit
  🏢, Footer „Betrifft deine Firma *Name*", Zurück-Knopf zur Firma. Der
  `wahl|…`-Handler bleibt; `decisions.apply` verzweigt bei `company`. Im
  Verlauf (`history`) bekommen Firmen-Vorfälle das Präfix 🏢.
- **Angestellte** sehen bei `locked`: „🔒 *Firma* ist geschlossen – noch
  **2 Tage**." (Arbeitsamt-Knopf und `work`-Ergebnis, Fluxer `workProblem`).
- **Fluxer**: die bestehenden Wege (Reaktionen für Optionen) – kein neuer
  Befehl.

## Messung

- `firmenlauf` würfelt leichte Ereignisse (Standard) und entscheidet Vorfälle
  zufällig (wie `karriere` für Musik); `--ohne-ereignisse` schaltet beides ab.
  Der simulierte Inhaber „schaut" täglich, entscheidet offene Vorfälle sofort
  mit einer zufälligen Option.
- Ausgabe je Branche: Median mit und ohne Ereignisse, Anzahl Vorfälle je
  Jahr, Anteil geschlossener Tage. Erwartung: Median mit Ereignissen liegt
  **unter** dem ohne (schlecht ist teurer als gut), kein Tag über der
  Ereignis-Decke, Vorfälle je Jahr zwischen ~7 (Größe 0) und ~30 (Größe 9).
- Gemessene Zahlen in §15; Patchnote nennt, was Ereignisse im Mittel kosten.

## Tests

- Katalogtest (`test/companyEvents.test.js`): jeder Eintrag beider Kataloge
  innerhalb der Grenzen der Wirkungstabelle; `umsatz ≤ EVENT_UMSATZ_MAX`;
  `kasse ≤ 0`; `refund` nur mit `kasse` in derselben Option; jede Option 1–3
  Ausgänge mit Gewicht > 0; `expire` vorhanden; `klassen`/`minGroesse` gültig;
  IDs eindeutig über alle drei Kataloge (Creator, Musik, Firma).
- `settle` mit festem Würfel: jedes leichte Ereignis einmal erzwungen,
  Handrechnung Kiosk Stufe 1 (Decke 2.850): `kuehlung` → −1.425; `lieferant`
  → NPC-Umsatz × 0,7; `grossauftrag` → zwei Tage × 1,15, am dritten 1,0;
  `guter_tag` → Löhne halbiert; `abwanderung` → dienstältester NPC weg.
- Sperre: `lock 3` → drei Abrechnungstage ohne Umsatz, Löhne laufen, Kasse
  sinkt; `workShift`/`pitchIn`/`advertise` → `locked` mit `remainingMs`;
  am vierten Tag läuft es wieder.
- Vorfälle: `riskPerDay(0) = 0,02`, `riskPerDay(9) = 0,08`, `riskFor(9, 30)`
  Handrechnung; jede Option jedes Vorfalls einmal mit erzwungenem Ausgang,
  inkl. Schweigen ×1,6; Übernahme → Firma `sold`, Auszahlung = investiert +
  Kasse in einer Buchung; Vorfall auf geschlossene Firma → keine Wirkung.
- Decken-Test auf `× EVENT_UMSATZ_MAX`; 365-Tage-Lauf mit Ereignissen für
  Kiosk/Café/Spedition ohne Tag über der Ereignis-Decke.
- Menü-/Fluxer-Render-Test: Firmenansicht mit Vorfall-Knopf bleibt unter den
  Grenzen.

## Docs

ARCHITEKTUR §15 (Ereignis-Decke, gemessene Mediane mit/ohne, Vorfallsrate),
Patchnotes 1.34.0, Addendum in der 2a-Spec: „2b umgesetzt am …".
