# Eigene Firmen – Stück 1: der Kern

Stand: 2026-09-12 · Zweig `main` · erstes von drei Stücken

## Die drei Stücke

„Eigene Unternehmen" ist zu groß für eine Spec. Der Nutzer hat den Schnitt
in drei spielbare Stücke bestätigt:

1. **Der Kern** (diese Spec): gründen, betreiben, Angestellte (NPC und
   Spieler), Kasse, Insolvenz, Arbeitsamt-Anbindung, Menü.
2. **Branchen, Ausbau, Ereignisse:** voller Katalog, Ausbaustufen
   (Filialen, Flotte), Vorfälle mit Entscheidung nach dem Muster von Creator
   und Musik. Hier liegt die *Investition* und damit das Endgame-Einkommen.
3. **Produktion und Handel:** Lieferketten zwischen Firmen, Handel zwischen
   Spielern – und Anbindung an die Börse: Die simulierten Firmen dort werden
   Handelspartner.

## Ziel des Kerns

Ein Spieler gründet eine Firma, stellt Personal ein, hält die Kasse im Plus
und entnimmt den Gewinn. Andere Spieler können sich bei ihm bewerben und
Schichten arbeiten wie beim Arbeitsamt. Die Firma ist eine **eigene
Geldquelle**, gestaffelt nach Branche, aber **noch kein Endgame**: Ohne
Ausbau (Stück 2) bleibt ihre Decke unter Musik+Creator.

Beschlüsse aus dem Gespräch:

| # | Beschluss |
|---|---|
| 1 | Gestaffelt nach Branche: kleine Branchen billig und schwach, große teuer und stark („je nachdem, was du aufmachst"). |
| 2 | Hybrid: Die Firma läuft passiv mit Personal; Inhaber-Aktionen heben die Auslastung und kosten Zeit aus dem **gemeinsamen Tagesbudget** (8 Einheiten, wie Creator und Musik) – „eine Bremse, nicht zwei" (§15). |
| 3 | Firmenkasse als lokaler Zustand: Umsatz rein, Löhne raus, Inhaber entnimmt und zahlt ein. Kasse 14 Tage im Minus → Insolvenz. |
| 4 | NPC-Angestellte kosten täglich, arbeiten verlässlich; Spieler kosten nur gearbeitete Schichten, bringen ×1,3 Umsatz. Feste Plätze je Branche; NPCs füllen, was frei ist; der Inhaber muss entlassen, um Platz zu machen. |
| 5 | Der Inhaber führt sein Personal selbst: befördern, zurückstufen, entlassen, Prämie. Keine automatische Beförderung. |
| 6 | **Gründungspreise realistisch** („Deutschland durch drei", wie die übrigen Spielpreise): Kiosk 25.000 · Café 120.000 · Spedition 1.200.000. Die Investition liegt im Wachstum (Stück 2), nicht in der Gründung. |
| 7 | Umsatz entsteht **je Schicht** (Ansatz 1); Kundschaft, Fehlentscheidungen und andere Umsatzvarianten kommen später. |

## Nicht-Ziele (Kern)

- Kein Ausbau, keine Ereignisse, keine Produktion, kein Handel.
- Eine Firma je Spieler.
- Keine Neubalance des Zeitbudgets. **Offener Punkt für später:** 8 Einheiten
  für drei Karrieren sind knapp, und Selbstständige arbeiten IRL mehr als
  Angestellte – der Nutzer will das nach dem Kern anschauen.
- Keine Steuern auf Firmengewinne im Kern.

## Was heute gilt (gegen den Code geprüft)

| | Quelle |
|---|---|
| Jobs: `employment (guild_id, user_id, job_id, hired_at, last_work_at, shifts, earned, rank, rank_at, work_day, shifts_today)`, ein Job je Spieler, `MAX_SHIFTS_PER_DAY = 4`, `jobs.work()` bucht `job.pay × Varianz × perk.income × rank.pay` per `changeCash` und würfelt danach die Beförderung (`ranks.roll`) | `src/jobs.js:16, 176–235`, `src/db.js:1076` |
| Zeitbudget: `creator.useTime(guildId, userId, cost, now)`, `TIME_PER_DAY = 8`, Tageswechsel um Mitternacht; Musik nutzt es über `music.useTime` | `src/creator.js:45, 352` |
| Level-Zuschlag auf Einnahmen: `perks.payout(guildId, userId, amount)` – nur auf positive Beträge | `src/perks.js:122` |
| Menü-Registry mit `group: 'work'` (Arbeitsamt, Creator, Musik …), Fluxer nutzt dieselben Handler aus `buttons.js`; Fluxer-Modals haben genau **ein** Feld | `src/menu.js`, `src/fluxer/index.js`, ARCHITEKTUR §5/§6 |
| Namen: `names.js` löst *Konto*-Namen auf – eine NPC-Namensliste gibt es nicht | `src/names.js` |
| Preisniveau: 3-Zimmer-Wohnung 105.000, Corsa 900, Tellerwäscher 110/Schicht, Konzernchef 4.200/Schicht | `src/data/properties.js`, `catalog.js`, `jobs.js` |

## Datenmodell

```sql
CREATE TABLE IF NOT EXISTS companies (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  guild_id       TEXT    NOT NULL,
  owner_id       TEXT    NOT NULL,           -- Konto-ID (identity), nicht Plattform-ID
  branch         TEXT    NOT NULL,           -- 'kiosk' | 'cafe' | 'spedition'
  name           TEXT    NOT NULL,
  kasse          INTEGER NOT NULL DEFAULT 0, -- kann negativ werden
  auslastung     REAL    NOT NULL DEFAULT 0.3,
  founded_at     INTEGER NOT NULL,
  paid_through   INTEGER NOT NULL,           -- bis wann abgerechnet (faul, §4)
  negative_since INTEGER NOT NULL DEFAULT 0, -- 0 = Kasse nicht im Minus
  werbung_until  INTEGER NOT NULL DEFAULT 0,
  pitch_day      TEXT    NOT NULL DEFAULT '',      -- Tageszähler „selbst anpacken" (wie shifts_today)
  pitch_today    INTEGER NOT NULL DEFAULT 0,
  status         TEXT    NOT NULL DEFAULT 'open',   -- 'open' | 'closed'
  closed_at      INTEGER NOT NULL DEFAULT 0
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_companies_owner_open
  ON companies (guild_id, owner_id) WHERE status = 'open';

CREATE TABLE IF NOT EXISTS company_staff (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  company_id  INTEGER NOT NULL,
  kind        TEXT    NOT NULL,              -- 'npc' | 'player'
  user_id     TEXT    NOT NULL DEFAULT '',   -- Konto-ID bei Spielern
  name        TEXT    NOT NULL,              -- NPC-Name, bei Spielern leer
  rank        INTEGER NOT NULL DEFAULT 0,    -- 0 Aushilfe · 1 Fachkraft · 2 Schichtleiter
  hired_at    INTEGER NOT NULL,
  shifts      INTEGER NOT NULL DEFAULT 0,
  unpaid_days INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_company_staff_company ON company_staff (company_id);
```

Spieler-Angestellte stehen **zusätzlich** in `employment` mit
`job_id = 'firma:<company_id>'`. Damit gelten Tageslimit, Abklingzeit und
„ein Job je Spieler" ohne neuen Code; `employment.rank` spiegelt
`company_staff.rank` (der Inhaber setzt beide). Kündigt der Spieler
(`jobs.quit`) oder bewirbt er sich woanders, wird seine `company_staff`-Zeile
gelöscht (`jobs` ruft `company.leave` beim Wechsel von einem `firma:`-Job).

## Die Branchen (`src/data/companies.js`)

| id | Name | Gründung | Plätze | Umsatz/Schicht | Lohn/Schicht | NPC-Schichten/Tag |
|---|---|---|---|---|---|---|
| `kiosk` | 🏪 Kiosk | 25.000 | 2 | 250 | 100 | 3 |
| `cafe` | ☕ Café | 120.000 | 5 | 900 | 180 | 3 |
| `spedition` | 🚚 Spedition | 1.200.000 | 10 | 2.600 | 420 | 3 |

**Startwerte, keine Behauptung.** Sie werden in der Messung (unten) gegen die
Zielmarken gezogen. Vorrechnung der Decke bei voller Auslastung, voller
NPC-Besetzung (ohne Spieler-Faktor): Kiosk 2 × 3 × 250 = 1.500 Umsatz − 600
Lohn = **900/Tag**; Café 5 × 3 × 900 = 13.500 − 2.700 = **10.800/Tag**;
Spedition 10 × 3 × 2.600 = 78.000 − 12.600 = **65.400/Tag**. Mit Schichtleitern
(×1,5 Umsatz, ×1,5 Lohn) entsprechend mehr – die Zielmarken ~2.500 / ~20.000
/ ~70.000 sind mit Beförderungen und Werbung erreichbar, nicht ohne.

Rangfaktoren: Aushilfe 1,0 · Fachkraft 1,25 · Schichtleiter 1,5 – auf
Umsatz **und** Lohn. Spieler-Schicht: Umsatz ×1,3 (Beschluss 4).

Dazu in derselben Datei: `NPC_NAMES` (≈ 40 Vornamen), `RANKS`
(`[{ id: 0, name: 'Aushilfe' }, { id: 1, name: 'Fachkraft' }, { id: 2, name: 'Schichtleiter' }]`),
`INSOLVENCY_DAYS = 14`, `NPC_QUIT_AFTER_UNPAID = 3`, `WERBUNG_DAYS = 3`,
`WERBUNG_BOOST = 0.25`, `WERBUNG_COST_SHARE = 0.05` (des Gründungspreises),
`AUSLASTUNG_MIN = 0.3`, `AUSLASTUNG_STAFF = 0.5`, `AUSLASTUNG_STEP = 0.2`,
`PLAYER_BONUS = 1.3`, `TIME_WERBUNG = 2`, `TIME_ANPACKEN = 2`,
`SHIFT_COOLDOWN_MIN = 60`, `MAX_PITCH_PER_DAY = 4`, `MAX_SETTLE_DAYS = 30`.

Warum `AUSLASTUNG_STAFF = 0,5` und nicht 0,7: Volle Besetzung allein bringt
die Auslastung auf 0,8. Die letzten 20 % gibt es nur mit Werbung – sonst
wäre Werbung bei voller Besetzung wirkungslos, und der Inhaber hätte nach
dem Einstellen nichts mehr zu tun.

## Das Modul `src/company.js`

Reiner Kern in Funktionen, Geld nur über `changeCash` (spät gebunden wie in
`music.js`), Zustand nur über `db.js`.

### Gründen – `found(guildId, userId, branchId, name, now)`

- Bedingungen: keine offene Firma; Name 2–32 Zeichen, keine Erwähnungen/`@`;
  Branche bekannt; Guthaben ≥ Preis (Prüfung über `unb.getBalance`).
- Zuerst die Zeile anlegen (§7), dann eine Buchung `changeCash(−preis, 'Gründung: <Name>')`.
  Scheitert die Buchung, wird die Zeile wieder gelöscht.
- `kasse = 0`, `auslastung = AUSLASTUNG_MIN`, `paid_through = now`.

### Abrechnen – `settle(guildId, companyId, now)` (faul, §4)

Läuft beim Öffnen jeder Firmenansicht und **vor jeder Aktion** (auch vor
der Spieler-Schicht). Für jeden vollen Tag zwischen `paid_through` und `now`
(höchstens 30 Tage, ältere verfallen wie bei Musik):

1. **Auslastung:** `ziel = AUSLASTUNG_MIN + AUSLASTUNG_STAFF × besetzt/plaetze`
   + `WERBUNG_BOOST` wenn `werbung_until > tag`, geklemmt auf 1,0;
   `auslastung += (ziel − auslastung) × AUSLASTUNG_STEP`. Ohne Personal 0,3,
   volle Besetzung 0,8, volle Besetzung mit Werbung 1,0.
2. **NPC-Schichten:** je NPC `NPC_SHIFTS` Schichten, je Schicht
   `kasse += umsatz − lohn` mit `lohn = branch.lohn × rankFaktor` und
   `umsatz = branch.umsatz × rankFaktor × auslastung`. **Löhne sind
   Verbindlichkeiten:** Sie werden immer gebucht, die Kasse darf dadurch
   ins Minus laufen – genau so entsteht das Minus, das die Insolvenz-Uhr
   startet. Ist die Kasse am Ende des Tages negativ, gilt der NPC als
   unbezahlt: `unpaid_days++`; bei `unpaid_days ≥ NPC_QUIT_AFTER_UNPAID`
   kündigt er (Zeile gelöscht, Rückgabe nennt ihn). Kasse wieder ≥ 0 →
   `unpaid_days = 0`. Wer alle NPCs verliert, hat keine Lohnkosten mehr –
   aber das Minus bleibt, bis der Inhaber einzahlt.
3. **Minus-Uhr:** `kasse < 0` und `negative_since == 0` → `negative_since = tag`;
   `kasse ≥ 0` → `negative_since = 0`. Ist `negative_since` gesetzt und
   `tag − negative_since ≥ INSOLVENCY_DAYS × Tag` → **Insolvenz**:
   `status = 'closed'`, `closed_at`, alle `company_staff` gelöscht, alle
   `employment` mit `firma:<id>` gelöscht. Abrechnung endet.
4. `paid_through` vorrücken.

Rückgabe: `{ days, umsatz, loehne, quit: [npc…], insolvent: boolean, auslastung }`
für die Anzeige. Kein `await` vor dem Schreiben – `settle` ist synchron.

### Spieler-Schicht – `workShift(guildId, userId, now)`

Aus `jobs.work` aufgerufen, wenn `employment.job_id` mit `firma:` beginnt
(dort bleiben Tageslimit, Abklingzeit `SHIFT_COOLDOWN_MIN`, `recordShift`;
die Beförderungs-Würfelung entfällt für Firmenjobs).

- `settle` zuerst. Firma geschlossen → `{ ok: false, reason: 'closed' }` und
  `employment` löschen.
- `lohn = round(branch.lohn × rankFaktor × Varianz 0,85–1,15)`, `umsatz = branch.umsatz × rankFaktor × auslastung × PLAYER_BONUS`.
- `kasse < lohn` → `{ ok: false, reason: 'kasse' }` – keine Schicht.
- Zustand zuerst (§7): `kasse += umsatz − lohn`, `staff.shifts++`, dann eine
  Buchung `changeCash(userId, perks.payout(lohn), 'Schicht: <Firma>')` (§9).
  Der Level-Zuschlag geht **nicht** zulasten der Kasse – er ist der Zuschlag
  des Spielers, wie bei jedem Job (§15: Zuschläge sind kein zweiter Hahn,
  sie sitzen an der Auszahlung).

### Inhaber-Aktionen

| Aktion | Zeit | Wirkung |
|---|---|---|
| `advertise` | `TIME_WERBUNG` | braucht Deckung (`kasse ≥ kosten`), sonst abgelehnt; `kasse −= preis × WERBUNG_COST_SHARE`, `werbung_until = now + WERBUNG_DAYS` (läuft die Werbung noch, verlängert sie sich nicht – abgelehnt mit `reason: 'running'`) |
| `pitchIn` (selbst anpacken) | `TIME_ANPACKEN` | eine Schicht als Schichtleiter ohne Lohn: `kasse += branch.umsatz × 1,5 × auslastung`; höchstens `MAX_PITCH_PER_DAY` je Tag (`pitch_day/pitch_today`) |
| `withdraw(amount)` | – | `amount ≤ kasse`, `kasse −= amount`, eine Buchung `changeCash(+amount, 'Entnahme: <Firma>')`; **kein** `perks.payout` (Entnahme ist Umbuchung, kein Einkommen) |
| `deposit(amount)` | – | Guthaben prüfen, eine Buchung `changeCash(−amount)`, dann `kasse += amount`, `negative_since` neu bewerten |
| `hireNpc()` | – | freier Platz nötig; Name aus `NPC_NAMES` gewürfelt, `rank 0` |
| `fire(staffId)` | – | Zeile löschen; bei Spielern auch `employment` |
| `promote(staffId)` / `demote(staffId)` | – | `rank` ±1 in 0…2, bei Spielern auch `employment.rank` |
| `bonus(staffId, amount)` | – | nur Spieler; `amount ≤ kasse`; `kasse −= amount`, eine Buchung an den Spieler `'Prämie: <Firma>'` |
| `close()` | – | freiwillig schließen: Kasse (falls > 0) wird entnommen (eine Buchung), dann wie Insolvenz aufräumen |

Zeit-Aktionen laufen über `creator.useTime` – dasselbe Budget wie Streams
und Studio.

### Arbeitsamt – `openings(guildId)` und `apply`

`openings` liefert alle offenen Firmen des Servers mit freiem Platz:
`{ company, branch, free, lohn, owner }`. `jobs.apply` bekommt eine
Verzweigung: `jobId` beginnt mit `firma:` → `company.join(guildId, userId, companyId)`:
Inhaber darf nicht (`reason: 'owner'`), kein Platz (`'full'`), sonst
`company_staff`-Zeile (`kind 'player'`, `rank 0`) + `employment`
(`job_id 'firma:<id>'`, ersetzt den alten Job, bei Wechsel von einer anderen
Firma dort `leave`).

### Anzeige – `status(guildId, userId, now)`

Nach `settle`: Firma, Branche, Kasse, Auslastung (%), Personal-Liste (Name
oder Kontoname, Rang, Schichten, `unpaid_days`), freie Plätze, `werbung`-Rest,
Minus-Tage bis zur Insolvenz, Tagesbudget, `pitchLeft`, Vorrechnung
„erwarteter Tagesgewinn bei aktueller Besetzung" (Umsatz − Löhne bei
heutiger Auslastung – damit der Inhaber sieht, ob sich ein NPC lohnt).

## Menü und Ansichten

- Registry-Eintrag `firma` (`group: 'work'`, 🏢, „Firma", „Gründen, führen, Gewinn entnehmen").
- **Gründungsansicht** (ohne Firma): drei Branchen mit Preis, Plätzen, Umsatz/Lohn je Schicht, vorgerechneter Decke; Button „Gründen" je Branche → Modal mit **einem** Feld (Name).
- **Betriebsansicht:** Kasse, Auslastung, Personal (bis 10 Zeilen), Werbung-Rest, Warnung bei Minus („noch N Tage bis zur Insolvenz"), Buttons: Werbung · Anpacken · Entnehmen · Einzahlen · Personal · Schließen. Entnehmen/Einzahlen über ein Ein-Feld-Modal (Betrag; „alles" erlaubt).
- **Personalansicht:** je Angestellter eine Zeile mit Buttons ⬆️ ⬇️ ❌ 💶 (Prämie → Modal Betrag); Button „NPC einstellen" solange Platz.
- **Arbeitsamt:** neue Rubrik „🏢 Firmen auf diesem Server" unter dem Tagesangebot – je Firma Name, Branche, Lohn, freie Plätze, „Bewerben".
- Button-IDs zustandslos: `firma|<aktion>|<id>|<userId>`, `fstaff|<aktion>|<staffId>|<userId>`.

## §3 – kein Gelddrucker, bewiesen

- **Hahn:** Umsatz je Schicht. **Decke je Tag** = `plaetze × NPC_SHIFTS × umsatz × 1,5 (Schichtleiter) × 1,0 (Auslastung mit Werbung)` + `MAX_PITCH_PER_DAY × umsatz × 1,5` (Anpacken); Spieler auf denselben Plätzen ×1,3 statt ×1,0. Für die Spedition mit NPCs: 10 × 3 × 2.600 × 1,5 = 117.000 + 4 × 3.900 = 15.600 → **132.600 Umsatz/Tag brutto**, abzüglich 10 × 3 × 630 = 18.900 Löhne → **113.700/Tag** absolute Obergrenze (volle Besetzung mit Schichtleitern, Werbung, tägliches Anpacken); mit zehn Spieler-Schichtleitern, die je 4 Schichten stehen, statt NPCs wäre es mehr – der Test rechnet beide Varianten vor. Ohne Werbung (Auslastung 0,8): 93.600 + 12.480 − 18.900 = **87.180/Tag**. Alles unter Musik+Creator nach einem Jahr (134.407) und weit unter zwei Jahren (490.099) – Stück 2 hebt es.
- **Senken:** NPC-Löhne (verschwinden), Werbung, Gründung, Insolvenz.
- **Test:** ein Test rechnet die Decke aus den Datenwerten vor und lässt eine Simulation (volle Besetzung, täglich Werbung + Anpacken, 365 Tage) laufen – der beste Tag darf die Decke nicht überschreiten.
- **Messung:** `scripts/messung-geldquellen.js` bekommt einen Archetyp `firma:<branch>` (Inhaber ohne Musik/Creator: gründet am Tag 1 mit ausreichend Startguthaben, stellt volle NPC-Besetzung ein, befördert nach 30 Tagen alle, macht täglich Werbung + Anpacken, entnimmt täglich). Zielmarken nach 365 Tagen, Median des Tagesgewinns: Kiosk ~2.500, Café ~20.000, Spedition ~70.000. Die Umsatz-/Lohnwerte der Tabelle werden gegen diese Marken gezogen; Abweichungen werden gemessen, nicht geschätzt (`messfehler-vermeiden.md`).

## Fehlerfälle

| Fall | Verhalten |
|---|---|
| Gründung: Buchung schlägt fehl | Zeile wird gelöscht, `{ ok: false, reason: 'payment' }` |
| Spieler-Schicht: Kasse deckt Lohn nicht | keine Schicht, Hinweis „Die Kasse deckt deinen Lohn nicht – sprich mit dem Inhaber." |
| Spieler-Schicht: Firma inzwischen geschlossen | `employment` gelöscht, Hinweis |
| NPC unbezahlt (Kasse am Tagesende negativ) | arbeitet weiter, kündigt nach 3 Tagen; die Betriebsansicht nennt Kündigungen aus der Abrechnung |
| Entnahme > Kasse | abgelehnt |
| Einzahlung > Guthaben | abgelehnt |
| Inhaber bewirbt sich bei sich | abgelehnt (`owner`) |
| Zwei Gründungen schnell hintereinander | eindeutiger Index `idx_companies_owner_open` → zweite scheitert, keine Doppelbuchung |
| Nachbuchung nach Schließung | Personalzeilen sind weg, `settle` auf `closed` tut nichts |

## Tests (`test/company.test.js`)

1. Katalog: drei Branchen, alle Felder, Decke vorgerechnet und `> 0`, Kiosk < Café < Spedition bei Preis und Decke.
2. Gründen: Preis wird gebucht (genau eine Buchung), Name-Regeln, zweite Firma abgelehnt, zu wenig Geld abgelehnt.
3. NPC einstellen bis Platz voll, dann `full`; entlassen schafft Platz.
4. Abrechnung: 5 Tage mit 2 NPCs → Kasse = Σ(umsatz − lohn) exakt vorgerechnet (Auslastung je Tag mitgerechnet); Firma ohne Umsatzdeckung (Auslastung 0,3, Kiosk mit 2 Schichtleitern) läuft ins Minus, `unpaid_days` steigt, nach 3 Tagen Kündigung; Einzahlung setzt `unpaid_days` zurück.
5. Auslastung: ohne Personal → 0,3; volle Besetzung → nähert sich 1,0 (nach 20 Tagen > 0,95); Werbung hebt das Ziel; nach Ablauf sinkt es wieder.
6. Spieler-Schicht: Umsatz ×1,3, Lohn per `changeCash` (eine Buchung), Level-Zuschlag nicht aus der Kasse; Kasse zu klein → keine Schicht, keine Buchung; Tageslimit 4 wie beim Arbeitsamt.
7. Befördern/zurückstufen ändert Rang (0…2 geklemmt), Umsatz und Lohn der nächsten Schicht; Prämie bucht einmal und mindert die Kasse.
8. Entnehmen/Einzahlen: je eine Buchung, Grenzen, `negative_since` wird zurückgesetzt.
9. Insolvenz: Kasse 14 Tage negativ → geschlossen, Personal und `employment` weg; 13 Tage → offen. Einzahlen am Tag 13 rettet.
10. Arbeitsamt: `openings` listet nur offene Firmen mit Platz; Bewerben ersetzt den alten Job; Inhaber abgelehnt; Kündigung räumt `company_staff` auf.
11. §3-Decke: Simulation 365 Tage im Vollbetrieb – kein Tag über der vorgerechneten Decke; Median-Tagesgewinn je Branche im Bericht.
12. Zeitbudget: Werbung und Anpacken kosten Einheiten aus demselben Budget wie `music.record`.

## Berührte Dateien

| Datei | Änderung |
|---|---|
| `src/data/companies.js` | neu – Branchen, Ränge, Konstanten, NPC-Namen |
| `src/company.js` | neu – Kern (found, settle, workShift, Aktionen, openings, join/leave, status) |
| `src/db.js` | Tabellen, Statements, Funktionen |
| `src/jobs.js` | Verzweigung `firma:` in `apply`, `work`, `quit` |
| `src/menu.js` | Eintrag `firma` |
| `src/ui.js` | `buildFirmaView`, `buildFirmaFoundView`, `buildFirmaStaffView`, Rubrik im Arbeitsamt |
| `src/buttons.js` | Handler `firma`, `fstaff`, Modals `fname`, `fbetrag`, `fpraemie` |
| `test/company.test.js` | neu |
| `package.json` | Testkette |
| `scripts/messung-geldquellen.js` | Archetyp `firma:<branch>` |
| `src/data/patchnotes.js` | Eintrag 1.31.0 |
| `ARCHITEKTUR.md` | §15 um die Firma ergänzen (Decke, Rang unter Musik+Creator bis Stück 2) |

## Reihenfolge der Umsetzung

1. Daten + `db.js` + `found`/`hireNpc`/`fire` + Tests 1–3.
2. `settle` + Auslastung + Insolvenz + Tests 4, 5, 9.
3. Spieler-Schicht + Arbeitsamt-Verzweigung + Tests 6, 10.
4. Inhaber-Aktionen (Werbung, Anpacken, Entnahme, Einzahlung, Rang, Prämie, Schließen) + Tests 7, 8, 12.
5. Ansichten und Handler (Discord + Fluxer über dieselben Handler).
6. Decke-Test 11, Messskript-Archetyp, Werte ziehen, Patchnotes, ARCHITEKTUR.

## Nach der Messung (2026-09-13)

Was sich beim Umsetzen gegen die Zahlen oben verschoben hat – die Abschnitte davor
bleiben als Entwurf stehen, hier gilt der Stand im Code:

- **Spedition `umsatz` 2.600 → 1.900.** Mit 2.600 lag der gemessene Median bei
  103.280/Tag und damit über Musik+Creator (100.916). Die Decke der Spedition
  ist damit 10 × 3 × 1.900 × 1,5 + 4 × 2.850 = 96.900 brutto − 18.900 Löhne =
  **78.000/Tag** (vorher 113.700).
- **Gemessene Mediane** (`scripts/messung-geldquellen.js`, 365 Tage, Vollbetrieb
  mit Werbung und täglichem Anpacken): Kiosk **2.584**, Café **19.651**,
  Spedition **70.380** – alle unter Musik+Creator (**100.916**).
- **Signatur:** `settle(companyId, now)` – ohne `guildId`; die Firma kennt ihren
  Server selbst (`guild_id`). `fresh(guildId, userId, now)` rechnet ab und liefert
  Firma, Branche und Personal; alle Inhaber-Aktionen und auch `hireNpc`/`fire`
  gehen darüber.
- **Umbuchungen ohne Erfahrung:** Einzahlen, Entnehmen und die Auszahlung beim
  Schließen buchen `{ xp: false }` – sonst wäre Einzahlen + Entnehmen desselben
  Betrags eine XP-Schleife ohne Kosten. Die Prämie bucht `kind: 'company'`
  (keine Schicht, kein Schicht-Erfolg).

### Offene Designfrage: die Decke mit Spieler-Personal

Die Decke oben rechnet mit NPCs (3 Schichten, ×1,0). Zehn Spieler-Schichtleiter
auf denselben Plätzen stehen je 4 Schichten mit ×1,3: 10 × 4 × 1.900 × 1,5 × 1,3 =
148.200 brutto − 10 × 4 × 630 = 25.200 Löhne + 4 × 2.850 Anpacken →
**~134.400/Tag für den Inhaber**, über Musik+Creator. Das setzt zehn Spieler
voraus, die alle täglich vier Schichten für eine fremde Firma stehen – in der
Praxis eher Theorie, aber §3 kennt kein „in der Praxis". Entscheidung steht aus
(mit dem Nutzer); bis dahin bleibt jede Konstante, wie sie ist.
