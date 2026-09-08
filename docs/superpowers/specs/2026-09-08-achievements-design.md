# Erfolge (Achievements)

Stand: 2026-09-08 · Zweig `main`

## Ziel

Zwei Sorten Erfolge, beide mit Durchsage:

- **Privat** – Meilensteine, die jeder Spieler für sich erreicht. Vier Stufen
  (Bronze, Silber, Gold, Platin).
- **Serverweit** – Taten, die nur **einer** haben kann. Wer zuerst da ist,
  bekommt sie; alle anderen gehen leer aus.

Erfolge geben **nur Ruhm**: Abzeichen im Profil und wählbare Titel. Kein Geld,
keine Erfahrung, keine Rabatte – damit bleibt ARCHITEKTUR §3 unberührt und
niemand hat einen Grund, Erfolge gezielt abzufarmen.

## Nicht-Ziele

- Keine Prämien, keine XP, keine dauerhaften Boni.
- Kein Scheduler (§4). Geprüft wird an vorhandenen Andockpunkten.
- Kein zweites Titelsystem. Die Titel aus `activity.js` bleiben, wie sie sind;
  Erfolgstitel reihen sich dort ein.
- Kein Erfolg für „Platz 1 der Reichsten" – das meldet `podium.js` bereits,
  das wäre dieselbe Nachricht zweimal.

## Datenmodell

```sql
CREATE TABLE IF NOT EXISTS achievements (
  guild_id TEXT    NOT NULL,
  user_id  TEXT    NOT NULL,
  ach_id   TEXT    NOT NULL,
  at       INTEGER NOT NULL,
  PRIMARY KEY (guild_id, user_id, ach_id)
);

CREATE TABLE IF NOT EXISTS achievement_firsts (
  guild_id TEXT    NOT NULL,
  ach_id   TEXT    NOT NULL,
  user_id  TEXT    NOT NULL,
  at       INTEGER NOT NULL,
  PRIMARY KEY (guild_id, ach_id)
);
```

Zwei Tabellen, weil die serverweite Einmaligkeit vom **Primärschlüssel** kommen
muss. `INSERT OR IGNORE` gefolgt von `changes() === 1` ist das atomare
„ich war der Erste" – derselbe Trick wie `db.claimLot()` bei den Auktionslosen.
Zwei Spieler in derselben Millisekunde: genau einer gewinnt, ohne Sperren.

Der Gewinner eines serverweiten Erfolgs bekommt **zusätzlich** eine Zeile in
`achievements`, damit „meine Erfolge" eine einzige Abfrage bleibt.

### Neue `db`-Funktionen

| Funktion | Zweck |
|---|---|
| `awardAchievement(guildId, userId, achId, at)` | `INSERT OR IGNORE`, liefert `true` beim ersten Mal |
| `claimFirst(guildId, achId, userId, at)` | serverweit; `true` nur für den Ersten |
| `achievementsOf(guildId, userId)` | alle Erfolge eines Kontos |
| `allFirsts(guildId)` | die Ehrentafel: `ach_id -> {user_id, at}` |
| `countCars(guildId, userId)` | Zahl der Autos (für `car_5`) |

## Eine Regel

```js
{
  id: 'worth_1m',
  scope: 'privat',            // 'privat' | 'server'
  tier: 'gold',               // bronze | silber | gold | platin (nur privat)
  emoji: '💰',
  title: 'Millionär',
  text: 'Ein Vermögen von einer Million.',
  on: 'state',                // 'kind:<id>' | 'state' | 'fire:<name>'
  test: (ctx) => ctx.worth >= 1_000_000,
  progress: (ctx) => [ctx.worth, 1_000_000],   // optional, für die Ansicht
  measure: (ctx) => ctx.worth,                 // nur scope 'server', für den Nachtrag
}
```

`progress` ist optional und liefert `[ist, soll]` für die Fortschrittszeile bei
gesperrten Erfolgen. `measure` gibt es nur bei serverweiten Erfolgen und wird
ausschließlich beim einmaligen Nachtrag gebraucht (siehe unten).

## Andockpunkte

| `on` | wann | ctx |
|---|---|---|
| `kind:<id>` | `unb.countActivity()` – jede Geldbuchung mit `kind` | die Strichliste aus `player_activity` (eine Abfrage) |
| `state` | Aufbau von Profil und Rangliste, dort wo `podium.check()` schon hängt | Networth, Level, Autos, Immobilien, Depot, Sammlung, Kriminalakte – **faul als Getter** |
| `fire:<name>` | ausdrücklich: `achievements.fire(guildId, userId, name, daten)` | die übergebenen Daten |

Bei einer Buchung laufen nur die Regeln, die auf genau dieses `kind` hören –
zwei bis drei statt siebenunddreißig. Auf dem Buchungspfad wird **nie** ein
Networth berechnet; die teuren Werte hängen alle am `state`-Andockpunkt, und
dort sind sie Getter, die nur rechnen, wenn eine Regel danach fragt.

### Die `fire`-Aufrufe (vier Dateien, fünf Ereignisse)

| Datei | Ereignis | Daten |
|---|---|---|
| `heist.js` | `heist_perfect` | – |
| `home.js` | `move` | `{ country }` |
| `casino.js` | `casino_win` | `{ amount }` |
| `storage.js` | `lot_won` | `{ price }` |
| `storage.js` | `loot` | `{ rarity }` – je Fundstück beim Reveal |

Die Raritäts-Erfolge laufen bewusst über `fire` und nicht über `state`: Wer das
Stück vor der nächsten Prüfung verkauft, ginge sonst leer aus.

## Ablauf einer Vergabe (§7)

1. **Sammeln** – zutreffende, noch nicht vergebene Regeln bestimmen. Reines
   Lesen und Rechnen, synchron.
2. **Eintragen** – synchron in die DB, vor dem ersten `await`. Bei
   `scope: 'server'` entscheidet `claimFirst()`; wer verliert, bekommt gar
   nichts, auch keine private Kopie.
3. **Melden** – erst danach, fire-and-forget: Postfach-Eintrag und ggf.
   `relay.broadcast`.

Schritt 3 läuft vollständig in `try/catch`. Eine misslungene Meldung darf die
auslösende Aktion nie kippen – genau wie `collectTax` und `countActivity` heute.

## Meldungen

| Sorte | Postfach | Kanal |
|---|---|---|
| Bronze, Silber | ja | – |
| Gold, Platin | ja | Hauptkanal, `relay.broadcast(..., { lane: 'wichtig' })` |
| serverweit | ja | Hauptkanal, mit dem Zusatz „als Erster auf dem Server" |

Nie ein Ping: `broadcast` setzt `allowedMentions: { parse: [] }` bereits selbst.

Von 37 privaten Erfolgen sind 20 laut, und die verteilen sich über die gesamte
Laufbahn eines Spielers.

## Nachtrag für Bestandsspieler

Der erste Durchlauf ist **stumm** – wie `activity.backfill()` und die
Erstbefüllung des Treppchens.

- **Privat:** Beim ersten `check()` eines Kontos wird alles bereits Erfüllte
  still vergeben, Marker in `income_claims` (`kind: 'ach_backfill'`). Ohne das
  bekäme ein Bestandsspieler beim ersten Menü-Klick zwanzig Meldungen am Stück.
- **Serverweit:** Einmalig pro Welt ein Durchlauf über alle bekannten Konten
  (`networth.owners()`), Marker `income_claims` mit `user_id = '*'`. Vergeben
  wird an den Kandidaten mit dem **höchsten `measure`** des jeweiligen Erfolgs,
  ersatzweise nach Vermögen. So geht „Der erste Millionär" an den Reichsten und
  nicht an den, der zufällig zuerst ins Menü klickt.

### Was sich nicht nachtragen lässt

Der Nachtrag kann nur lesen, was heute noch in der Datenbank steht.

- **Raritäts-Erfolge** werden aus `storage_loot` nachgetragen (die Sammlung
  liegt dort), `measure` ist der Rang des besten Stücks. Bereits verkaufte
  Fundstücke sind für die Geschichte verloren – heute steht dort ohnehin
  nichts über 🔵 Rare, die Frage ist also derzeit ohne Folgen.
- **Der perfekte Coup** wird nirgends festgehalten. Dieser Erfolg startet leer
  und geht an den Nächsten, der einen Heist ohne Verluste durchzieht – auch
  wenn früher schon einmal einer gelungen sein sollte.
- **Der Großeinkauf** (Zuschlag ≥ 100k) ebenso: Zuschläge werden nicht
  historisch gespeichert. Startet leer.

Die **beiden letzten** Fälle tragen im Code `backfill: false`, damit niemand
später einen Nachtrag baut, der auf Daten zugreift, die es nie gab. Die
Raritäts-Erfolge werden nachgetragen.

## Ansichten

### Menü-Eintrag „Erfolge"

Neuer Eintrag in `menu.js`, Gruppe `me`. Damit sind **25 von 25** möglichen
Buttons belegt – das Hauptmenü ist danach voll, was im Code vermerkt wird.

Zwei Seiten:

1. **Meine Erfolge** – freigeschaltet oben (nach Stufe sortiert, Platin zuerst),
   gesperrte darunter mit Fortschritt („37 / 250 Schichten").
2. **Ehrentafel** – die serverweiten Erfolge mit dem Namen des Halters, oder
   „noch niemand". Die unerreichbaren Stufen stehen dauerhaft leer da; das ist
   Absicht, kein Fehler.

Fluxer bekommt das über `buildEntryView` automatisch mit – die Befehle je
Menüpunkt entstehen dort schon generisch (`src/fluxer/commands.js`).

### Profil

Eine Zeile unter dem Titel: `🏅 14/37` plus die drei seltensten Abzeichen,
serverweite immer zuerst.

### Titel

Gold-, Platin- und serverweite Erfolge liefern je einen Titel. `activity.js`
erkennt einen Titelwunsch mit dem Präfix `ach:` und schlägt ihn hier nach; das
vorhandene Titel-Menü listet sie mit auf. Kein zweites System.

### Neue Dateien

`src/achievements.js` (Regeln und Logik) und `src/achievementsUi.js` (Ansicht).
Die Ansicht kommt **nicht** in `ui.js` – die Datei hat bereits 4.069 Zeilen.
`casinoUi.js` ist der Präzedenzfall für ausgelagerte Ansichten.

## Die Erfolge

### Privat (37)

| Bereich | 🥉 Bronze | 🥈 Silber | 🥇 Gold | 💠 Platin |
|---|---|---|---|---|
| Arbeit | Erster Arbeitstag (1 Schicht) | Malocher (50) | Arbeitstier (250) | Lebenswerk (1.000) |
| Vermögen | Erstes Polster (100k) | Halbe Million (500k) | Millionär (1 Mio) | Schwerreich (50 Mio) |
| Fuhrpark | Erstes eigenes Auto | Sammler (5 Autos) | Traumwagen (Auto ≥ 500k) | Hypercar (Auto ≥ 3 Mio) |
| Immobilien | Eigenheim (erste eigene) | Vermieter (erste Miete) | Immobilienmogul (≥ 1 Mio) | Schlossherr (das Schloss) |
| Krumme Dinger | Erstes Ding (1 Heist) | Straßenräuber (10 Überfälle) | Sauber durchgezogen (perfekter Coup) | Beutezug (50 Mio Diebesgut) |
| Zocken | Anfängerglück (1. Gewinn) | – | Hochroller (100k in einer Runde) | Bank gesprengt (1 Mio in einer Runde) |
| Börse | Kleinanleger (1. Kauf) | – | Börsenhai (Depot ≥ 250k) | Großkapital (Depot ≥ 25 Mio) |
| Auktionen | Erster Zuschlag | – | Schatzmeister (Sammlung ≥ 100k) | Godlike (Fund ab 🟠 Godlike) |
| Angeln | Erster Fang | Angler (100) | Fischerkönig (500) | Moby Dick (1.000) |
| Leben | Weltenbummler (Umzug ins Ausland) | Aufsteiger (Level 25) | Legende (Level 50) | Unsterblich (Level 100) |

10 Bronze, 7 Silber, 10 Gold, 10 Platin. Drei Bereiche haben keine sinnvolle
mittlere Stufe.

#### Kalibriert am echten Spielstand

Die Schwellen sind nicht geraten, sondern am Stand vom 2026-09-08 gemessen
(`data/shop.db`):

| Größe | heutiger Höchstwert | Bronze | Silber | Gold | Platin |
|---|---|---|---|---|---|
| Erfahrung | 65.170 XP = **Level 25** | – | 25 | 50 (250k XP) | 100 (1 Mio XP) |
| Schichten | **45** | 1 | 50 | 250 | 1.000 |
| Diebesgut | **16.047** | – | – | – | 50 Mio |
| Sammlung | nur ⚪ Common und 🔵 Rare | – | – | – | 🟠 Godlike |

Silber liegt damit jeweils knapp über dem, was heute schon jemand hat – es gibt
also sofort etwas zu holen. Gold ist Monate entfernt, Platin die Laufbahn.

#### Der Endgame-Maßstab

Der heutige Höchststand taugt nur für Bronze und Silber. Platin muss sich am
**Endgame-Ertrag** messen, sonst ist es in zwei Wochen abgeräumt. Maßgeblich
ist der Goldtransport (`src/data/heists.js`), voll vorbereitet:

| | |
|---|---|
| Beute | 900k–2,4 Mio, Mittel 1,65 Mio |
| Vorbereitungs-Boni | auskundschaften +5 %, insider +20 %, sprengung +35 %, hehler +18 % = **+78 %** → ~2,94 Mio je Erfolg |
| Erfolgschance | `base` 20 % + ~35 % aus den Vorbereitungen ≈ **55 %** |
| Taktung | 12 h Sperre, bei Fehlschlag zusätzlich **72 h Knast** |

Erwartungswert je Versuch 1,62 Mio, Zeitkosten 12 h + 0,45 × 72 h = 44 h.
Macht **~875.000 Beute pro Tag** im Dauerbetrieb.

Daran hängen die drei Platin-Werte, die sich nicht an einer Systemgrenze
festmachen lassen. Ziel: **rund zwei Monate Endgame-Dauerbetrieb.**

| Erfolg | Schwelle | ≈ Tage |
|---|---|---|
| Beutezug | 50 Mio Diebesgut | ~57 |
| Schwerreich | 50 Mio Vermögen | ~57 |
| Großkapital | 25 Mio im Depot | ~29 (dazu das Kursrisiko) |

Die übrigen Platin-Werte sind **Systemgrenzen** und bleiben, wie sie sind: das
Casino deckelt bei `MAX_BET = 1.000.000`, der Fahrzeugkatalog endet beim
Koenigsegg Jesko (3,5 Mio), und das Schloss gibt es laut `stock: 1` genau
einmal pro Welt. Höher geht dort schlicht nicht.

### Serverweit (14)

| | Erfolg | Bedingung | `measure` |
|---|---|---|---|
| 👑 | Der erste Millionär | Vermögen ≥ 1 Mio | Vermögen |
| 🏎️ | Der erste Supersportwagen | Auto ≥ 500k | Wert des teuersten Autos |
| 🏰 | Der Schlossherr | besitzt das Schloss (`stock: 1`) | Immobilienwert |
| 📈 | Der erste Großanleger | Depot ≥ 500k | Depotwert |
| 💎 | Der erste perfekte Coup | Heist ohne Verluste | – (kein Nachtrag) |
| ⚙️ | Der erste Malocher | 250 Schichten | Schichten |
| 🏬 | Der erste Großeinkauf | Zuschlag ≥ 100k | – (kein Nachtrag) |
| 🟠 | Der erste Godlike-Fund | Fund ab Godlike | bester Rang in `storage_loot` |
| 🌌 | Der erste Cosmic-Fund | Fund ab Cosmic | bester Rang in `storage_loot` |
| 💰 | Der erste Milliardär | Vermögen ≥ 1 Mrd | Vermögen |
| 🩸 | Primordial | Fund ab Primordial | bester Rang in `storage_loot` |
| 🌟 | Celestial | Fund ab Celestial | bester Rang in `storage_loot` |
| 👁️ | Omnipotent | Fund ab Omnipotent | bester Rang in `storage_loot` |
| 🎆 | Origin | Fund Origin | bester Rang in `storage_loot` |

Die Raritäten kommen aus `src/data/storage.js`; verglichen wird über den Rang in
`RARITIES`, also „diese Stufe **oder besser**".

Wie selten das ist, bei etwa fünf Objekten je Garage:

| Stufe | Chance je Objekt | ≈ Garagen bis zum ersten Treffer |
|---|---|---|
| 🟠 Godlike | 0,05 % | ~400 |
| 🌌 Cosmic | 0,005 % | ~4.000 |
| 🩸 Primordial | 0,0005 % | ~40.000 |
| 🌟 Celestial | 0,00003 % | ~700.000 |
| 👁️ Omnipotent | 0,000000002 % | ~10 Milliarden |
| 🎆 Origin | 0,0000000001 % | ~200 Milliarden |

Die unteren Zeilen der Ehrentafel bleiben damit auf Dauer leer. Das ist der
Reiz: Sollte je jemand einen Cosmic aus einer Garage ziehen, ist die Meldung im
Hauptkanal verdient.

## §3 – kein Gelddrucker

Trivial, aber im Test festgehalten: Eine Regel darf keine Geldfunktion
aufrufen. `achievements.js` bindet weder `unb` noch `wallet` ein, und ein Test
vergibt sämtliche Erfolge eines Kontos und prüft, dass die Geldschnittstelle
dabei null Mal angefasst wurde.

## Tests (`test/achievements.test.js`)

1. Alle Regeln sind wohlgeformt: eindeutige IDs, jede hat `emoji`, `title`,
   `text`, `on`, `test`; `scope` und `tier` gültig; jeder `kind:`-Andockpunkt
   nennt eine Aktivität, die `activity.KINDS` kennt.
2. Eine Schwelle greift genau **einmal** – der zweite Aufruf vergibt nichts.
3. Serverweit: zwei Spieler erfüllen die Bedingung, genau einer bekommt sie,
   der andere gar nichts.
4. §7: Der Eintrag steht in der DB, bevor der erste `await` zurückkommt.
5. §3: Eine Vergabe bucht kein Geld (ersetzte Geldschnittstelle, null Aufrufe).
6. Der Nachtrag ist stumm: Ein Bestandskonto bekommt alles Erfüllte, aber weder
   `broadcast` noch `createMessage` werden aufgerufen.
7. Der serverweite Nachtrag geht an den mit dem höchsten `measure`.
8. Meldungen landen richtig: Bronze/Silber nur im Postfach, Gold/Platin und
   serverweit zusätzlich im Hauptkanal (`lane: 'wichtig'`).
9. Der Buchungspfad rechnet kein Networth (Zähler auf `networth.of`: null).
10. Raritäten vergleichen „oder besser": Der Godlike-Erfolg greift auch bei
    einem Cosmic-Fund, aber nicht bei Mythic.
11. Gesperrte Erfolge zeigen Fortschritt, verraten aber nichts Falsches.
12. Eine geworfene Meldung kippt die Vergabe nicht.
13. Das Hauptmenü hat höchstens 25 Einträge.

Alle Tests ohne Netz (§12), fester Würfel wo gewürfelt wird.

## Berührte Dateien

| Datei | Änderung |
|---|---|
| `src/achievements.js` | neu – Regeln, Vergabe, Nachtrag |
| `src/achievementsUi.js` | neu – die beiden Ansichten |
| `src/db.js` | zwei Tabellen, fünf Funktionen |
| `src/unb.js` | eine Zeile in `countActivity` |
| `src/menu.js` | ein Eintrag (danach 25/25) |
| `src/ui.js` | Abzeichen-Zeile im Profil, Erfolgstitel im Titel-Menü |
| `src/activity.js` | erkennt Titelwünsche mit Präfix `ach:` |
| `src/heist.js`, `src/home.js`, `src/casino.js`, `src/storage.js` | je ein `fire` |
| `test/achievements.test.js` | neu |
| `package.json` | Test in die Kette |
| `ARCHITEKTUR.md` | kurzer Abschnitt zum Andockpunkt |

## Erweiterbarkeit

Ein neuer Erfolg ist ein Eintrag in der Liste in `achievements.js` – sonst
nichts. Braucht er ein Ereignis, das keine Geldbuchung ist, kommt eine Zeile
`achievements.fire(...)` an die passende Stelle. Bewusst so gebaut, damit
später „kranker Stuff" nachgerüstet werden kann, ohne die Mechanik anzufassen.
