# Zeit und Energie – ein Tag für alles

Stand: 2026-09-14 · Zweig `main` · löst den offenen Punkt „Zeitbudget der
Selbstständigen" aus den Firmen-Specs (Stück 1 und 2a)

## Ziel

Heute hat ein Spieler zwei getrennte Tage: 8 Zeiteinheiten für Creator,
Musik und Firma (`creator.TIME_PER_DAY`) und daneben 4 Job-Schichten à 2 h,
die weder Zeit noch Erschöpfung kosten. Ein Selbstständiger mit Kanal,
Studio und Firma kommt mit 8 Einheiten auf vier Aktionen am Tag – zu wenig,
und unlogisch, weil ein Angestellter faktisch 16 Stunden hat.

Beschlüsse aus dem Gespräch:

| # | Beschluss |
|---|---|
| 1 | **Ein Tag mit 24 Stunden** für alles: Creator, Musik, Firma **und Jobs** buchen aus demselben Zähler. |
| 2 | **Eine Energie für alle** (bisher nur Creator). Sie ist die einzige echte Bremse; die potenzielle Verdreifachung der Creator-/Musik-Aktionen wird bewusst in Kauf genommen. |
| 3 | Angestellte: **Job max. 8 h + 1 Überstunde (10 h)**. Der Rest des Tages ist frei für alles andere (Lesart A: „Job ist Job, der Feierabend gehört dir"). |
| 4 | Energie wirkt doppelt (C): **Ertrag skaliert** mit der Energie, und **unter 10 % blockt** jede Aktion mit Zeitkosten. |
| 5 | Der Faktor trifft die **Wirkung der Aktion** (B), nicht nur das Geld – ein müder Stream bringt weniger Zuschauer, also weniger Geld *und* weniger Wachstum. |
| 6 | **Überstunde** (5. Schicht): Lohn ×1,25, doppelte Erschöpfung (A). |
| 7 | Ein Marathon wirkt **einen harten Tag** nach (A): nächster Morgen ~40 %, übermorgen voll. Bewusst in Kauf genommen: Marathon + Ruhetag im Wechsel ist effektiv ein ~12-h-Tag. |

## Nicht-Ziele

- Kein Schlaf-Knopf, keine Energie-Items (Kaffee, Energydrink) – das wäre
  ein Kaufweg an der Bremse vorbei.
- Kein Übertrag ungenutzter Stunden auf den nächsten Tag.
- Keine Änderung an Cooldowns (Plattform, Schicht, Aufnahme, Release, Show):
  sie takten den Tag, sie bremsen ihn nicht.
- Kein Umbau der Decken (§3/§15). Der Faktor ist ≤ 1 und kann keine Decke
  überschreiten.

## Was heute gilt (gegen den Code geprüft)

| | Quelle |
|---|---|
| `TIME_PER_DAY = 8`; `useTime(guildId, userId, cost, now)` bucht synchron, Reset am Kalendertag (`state.day`); `budget()` → `{used, max, left}` | `src/creator.js:46, 352, 958` |
| Zeitkosten: Stream 2, Video 3, Kurzvideo 1, Tweet 1 (`p.time`); Aufnahme 3, Release 1–3 (`type.time`), Show 4; Werbung 2, Anpacken 2 | `src/data/creator.js`, `src/music.js:158–161`, `src/data/music.js`, `src/data/companies.js` |
| Erschöpfung: `FATIGUE_PER_TIME 4`, `FATIGUE_MAX 100`, `FATIGUE_RECOVERY 0.55`/Tag (exponentiell), `FATIGUE_MALUS 0.35`; `energyFactor(fatigue) = 1 − 0,35 × fatigue/100`; wirkt nur auf das Creator-Publikum (`act`) | `src/creator.js:165–168, 403, 493` |
| Musik und Firma buchen über `creator.useTime`, ignorieren die Energie | `src/music.js:267`, `src/company.js:368` |
| Jobs: `HOURS_PER_SHIFT 2`, `MAX_SHIFTS_PER_DAY 4`, eigener Tageszähler `shifts_today`, kein `useTime`, keine Erschöpfung; `shiftBudget()` → `{done, max, left, hours, maxHours}` | `src/jobs.js:20–21, 191, 305` |
| Firmenstelle: `jobs.work` ruft `company.workShift` (Umsatz und Lohn aus der Firma, sync), bucht danach einmal (§9) | `src/jobs.js:215–235` |
| Zustand `creator_state`: `day, time_used, fatigue, fatigue_at` je Spieler und Server | `src/db.js:739` |
| Anzeige „⏳ Heute … von 8" in Firma, Creator, Musik, Plattform; „🔋 Energie" nur im Creator | `src/ui.js:1107, 1604, 2200, 2890` |

## Der Tag

- `TIME_PER_DAY = 24`. Reset bleibt Mitternacht, Zähler bleibt `time_used`.
- **Jobs buchen Zeit:** Jede Schicht kostet `HOURS_PER_SHIFT = 2` aus dem
  gemeinsamen Zähler. Der Schichtdeckel bleibt als eigene Regel bestehen:
  `MAX_SHIFTS_PER_DAY = 4` reguläre Schichten plus `OVERTIME_SHIFTS = 1`
  Überstunde; die 6. Schicht wird abgelehnt (`reason: 'max'` wie heute).
- **Überstunde** = jede Schicht über `MAX_SHIFTS_PER_DAY`: Lohn
  ×`OVERTIME_PAY = 1.25` (auf den Grundlohn, vor dem Level-Bonus aus
  `perks.payout`), Erschöpfung ×`OVERTIME_FATIGUE = 2`. Gilt für Katalog-Jobs
  und Firmenstellen gleich; bei der Firmenstelle zahlt die Firmenkasse den
  Zuschlag (der Lohn kommt aus `workShift`, der Zuschlag wird dort auf `lohn`
  gerechnet, der Umsatz bleibt Umsatz).
- Reihenfolge einer Schicht (alles synchron, kein `await` dazwischen – §7):
  Deckel/Cooldown prüfen → `creator.previewTime` (Wand und Stunden, ohne
  Schreiben) → Firmenstelle: `company.workShift(…, factor)` → `creator.useTime`
  → dann erst die eine Buchung.

## Die Energie

Zustand bleibt `fatigue` (0–100) und `fatigue_at` in `creator_state`;
`energie = 1 − fatigue/100`. Keine Migration: heutige Werte (≤ 32 nach einem
vollen 8-Einheiten-Tag) sind gültige Startwerte.

**Verbrauch ist konvex.** Die n-te Stunde des Tages (n = bisher verbrauchte
Stunden + 1, gezählt über alle Aktivitäten) kostet
`HOUR_COST_BASE + HOUR_COST_SLOPE × n` Prozentpunkte. Eine Aktion mit `c`
Stunden ab `used` kostet die Summe über n = used+1 … used+c:

```
kosten(used, c) = c × BASE + SLOPE × (c × used + c × (c + 1) / 2)
```

Startwerte `BASE = 1.4`, `SLOPE = 0.25` – **die Messung legt sie fest**, die
Prüfpunkte unten sind das Maß:

| Tag | Rechnung | Energie am Ende | Prüfpunkt |
|---|---|---|---|
| 8 h | 11,2 + 0,25 × 36 = 20,2 | 79,8 % | ≥ 75 % |
| 10 h mit Überstunde | 20,2 + 2 × (2,8 + 0,25 × 19) = 35,3 | 64,7 % | ≥ 60 % |
| 12 h | 16,8 + 0,25 × 78 = 36,3 | 63,7 % | – |
| 16 h | 22,4 + 0,25 × 136 = 56,4 | 43,6 % | – |
| 21 h | 29,4 + 0,25 × 231 = 87,2 | 12,8 % | noch über der Wand |
| 22 h | 30,8 + 0,25 × 253 = 94,1 | 5,9 % | Wand erreicht |

Konvex ist Pflicht, nicht Geschmack: Ein linearer Preis kann „8 h ≥ 75 %"
und „Wand bei ~20 h" nicht gleichzeitig liefern.

**Erholung linear je Echtzeit-Stunde:** `RECOVERY_PER_HOUR = 4` Punkte je
Stunde seit `fatigue_at`, nach oben bei 0 Erschöpfung gedeckelt (ersetzt den
exponentiellen Abbau). Ein 8-h-Tag ist nach ~5 h wieder voll; ein Marathon,
der um Mitternacht an der Wand endet (6 %), steht um 8 Uhr bei ~38 %, um
16 Uhr bei ~70 %, um Mitternacht bei 100 % → Beschluss 7.

**Malus-Kurve** (flach oben, steil unten):

```
energyFactor(energie) = 1 − MALUS_MAX × (1 − energie)²      MALUS_MAX = 0.8
```

| Energie | Faktor |
|---|---|
| 100 % | 1,00 |
| 75 % | 0,95 |
| 50 % | 0,80 |
| 25 % | 0,55 |
| 10 % | 0,35 |

**Wand:** Liegt die Energie **vor** der Aktion unter `ENERGY_WALL = 0.10`,
wird jede Aktion mit Zeitkosten abgelehnt: `{ ok: false, reason:
'exhausted', readyAt }` mit `readyAt = fatigue_at + (fatigue − 90) /
RECOVERY_PER_HOUR` Stunden. Die Aktion selbst darf den Spieler unter 10 %
drücken – dann ist erst die nächste dran. Aktionen ohne Zeitkosten
(Entnehmen, Einzahlen, Kaufen, Befördern, Prämie, Merch-Abrechnung) gehen
immer.

**Faktor nach der Buchung:** Jede Aktion holt den Faktor **nach** `useTime`,
also mit den gerade gebuchten Stunden – die letzte Stunde eines langen Tags
ist die müdeste. Das gilt auch für den Creator (heute rechnet `act` mit der
Energie vor der Buchung).

## Schnittstelle (`src/creator.js`)

```
previewTime(guildId, userId, cost, now, { fatigueFactor = 1 })
  → { ok: true, factor, energy, used, left, max }
  | { ok: false, reason: 'exhausted', readyAt, energy }
  | { ok: false, reason: 'no_time', used, left, max, resetMs }
useTime(guildId, userId, cost, now, { fatigueFactor = 1 })
  → wie previewTime, schreibt aber (day, time_used, fatigue, fatigue_at)
energyOf(guildId, userId, now) → { energy, factor, fatigue, readyAt|null }
budget(guildId, userId, now) → { used, max: 24, left, energy, factor }
```

`useTime` behält Signatur und Rückgabefelder (`ok, used, left, max,
resetMs`), damit Musik und Firma nicht angefasst werden müssen, außer wo sie
den Faktor anwenden. Neue Rückgabefelder: `factor`, `energy`; neuer
Ablehnungsgrund `exhausted`. Alle Aufrufer, die heute `reason: 'no_time'`
weiterreichen, reichen `exhausted` samt `readyAt` genauso durch.

## Wo der Faktor greift (Beschluss 5)

| Aktion | Stelle | skaliert |
|---|---|---|
| Stream, Video, Kurzvideo, Tweet | `creator.act` | Publikum (wie heute, neue Kurve) |
| Job-Schicht (Katalog) | `jobs.work` | Grundlohn vor `perks.payout` |
| Job-Schicht in Spielerfirma | `company.workShift(…, factor)` | Umsatz **und** Lohn der Schicht |
| Anpacken | `company.pitchIn` | Umsatz |
| Werbung | `company.advertise` | nichts – Stunden und Energie kosten trotzdem |
| Aufnahme | `music.record` | `quality` |
| Release (auch `force`) | `music.release` | `audience` (davon hängen Spike, Wachstum, Buzz ab) |
| Show | `music.show` | Publikum → Gage und Zuwachs |

Rundung wie am jeweiligen Ort heute (`Math.round` auf Taler). Der Faktor
wird als eigene Zeile im Ergebnis geführt (`energy`, `factor`), damit die
Antworten ihn nennen können („müde: −20 %").

## Anzeige

- **Gemeinsame Zeile** überall, wo heute „⏳ Zeit: x von 8" steht (Firma,
  Creator, Musik, Plattform-Ansicht): `⏳ Zeit: **14** von 24 · 🔋 ▰▰▰▰▰▰▱▱ 77 %`.
  Unter 50 %: `_müde – Ertrag −20 %_` (Faktor gerundet); unter 10 %:
  `_erschöpft – wieder ab 07:40_`.
- **Jobcenter:** Schichtbalken zeigt `▰▰▰▰⏰` (vier reguläre, eine
  Überstunden-Kachel). Der Knopf heißt nach der 4. Schicht „Überstunde
  (+25 %)", nach der 5. „Feierabend". Das Schicht-Ergebnis nennt die
  Überstunde: „⏰ Überstunde: 1.250 (+250 Zuschlag) – du bist ziemlich platt."
  Die Stundenzeile wird „8/8 Stunden + 2 Überstunden"; `shiftBudget()`
  liefert zusätzlich `overtimeLeft` und `nextIsOvertime`.
- **Wand:** ein Text für alle Wege (Menü, Slash, Fluxer): „🔋 Du bist
  erschöpft. Wieder ab 07:40 Uhr." Zeit im Serverformat wie die übrigen
  Restzeiten (`income.formatRemaining` für „in 3 h 12 min").
- Profil: die Energie-Zeile kommt in den Abschnitt, der heute das
  Zeitbudget zeigt; zeigt er keins, bleibt das Profil unverändert.

## Messung (vor dem Festlegen der Konstanten)

`scripts/messung-geldquellen.js` bekommt für den Creator+Musik-Jahreslauf
die Strategien `tag8`, `tag12`, `tag16` (täglich so viele Stunden, gleichmäßig
über Stream/Video/Studio verteilt, Cooldowns beachtet) und
`marathon-wechsel` (bis zur Wand, dann ein Tag Pause). Ausgegeben wird je
Strategie Median/Tag im Jahr und die mittlere Energie. Erwartung, die die
Messung bestätigen oder korrigieren muss:

- `tag8` liegt in der Nähe der heutigen 100.916/Tag (die Kurve trifft den
  normalen Tag kaum).
- `tag16` liegt deutlich unter dem Doppelten von `tag8`.
- `marathon-wechsel` liegt unter `tag12`.

Die gemessenen Zahlen kommen in ARCHITEKTUR §15 (neue Creator-Decke) und in
die Patchnote – ehrlich, um wie viel die Decke steigt.

## Tests

- `test/energy.test.js` (neu), Handrechnung gegen die Tabelle oben:
  `kosten(0, 8)`, `kosten(8, 2) × 2`, Energie nach 8/10/16/21/22 h; Wand
  greift bei 22 h, nicht bei 21; `readyAt` = eine Stunde nach der Wand bei
  4 Punkten/h; Marathon bis Mitternacht → 8 Uhr 35–45 %; Faktor bei
  75/50/25/10 % auf zwei Stellen; Erholung deckelt bei 100 %.
- `test/shifts.test.js`: 5. Schicht ist Überstunde ×1,25 mit doppelter
  Erschöpfung, 6. abgelehnt; jede Schicht bucht 2 h aus `creator.budget`;
  Firmenstelle skaliert Umsatz und Lohn mit dem Faktor.
- Bestehende Prüfungen auf `max === 8` / „2 von 8 Stunden" werden auf 24 bzw.
  die neue Stundenzeile angepasst (`company.test.js:364`, `shifts.test.js:76`,
  `creator.test.js:477`, `music.test.js:431`, Kommentar in
  `musicEvents.test.js:472`).
- Menü-Test: die Jobcenter-Ansicht mit fünfter Kachel und der Fluxer-
  Reaktionshaushalt bleiben unter den Grenzen.

## Docs

- ARCHITEKTUR: neuer §17 „Ein Tag, eine Energie" (24 h für alles, konvexer
  Verbrauch, lineare Erholung, Wand, Faktor-Tabelle); §15 Creator-Zahlen
  nach der Messung; die Zeitbudget-Notiz bei den Firmen wird ersetzt.
- Patchnotes 1.33.0.
