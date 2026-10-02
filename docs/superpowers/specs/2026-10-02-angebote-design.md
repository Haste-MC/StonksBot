# Gegenanfragen und große Formate – Stück 5c

Teil der Kontakte-Reihe (5a Der Draht zu anderen Künstlern · 5b Beef und
Disstracks · **5c Gegenanfragen und große Formate**) · Stand 2026-10-02 ·
Vorgänger: `docs/superpowers/specs/2026-09-25-kontakte-design.md` und
`docs/superpowers/specs/2026-09-25-beef-design.md`

## Ziel

Bisher geht jede Verbindung von dir aus: du schreibst an, du stachelst an. 5c
dreht die Richtung. Kontakte, die dich kennen, **melden sich bei dir** – mit
einem Tausch, einem Gastpart, einem Platz als Vorgruppe, einem gemeinsamen
Album oder einer Einführung bei ihrem Label. Damit zahlt sich die Pflege aus
5a erstmals von selbst aus, und der Partner-Status bekommt endlich seinen
eigentlichen Wert.

Die Gegenanfrage ist dabei nicht eines von drei Themen, sondern **der
Zustellweg für alle drei**: die großen Formate und die Label-Tür kommen als
Anfragearten, nicht als eigene Knöpfe.

## Nicht-Ziele

- Keine Kontakte zwischen **Spielern** (eigenes Thema).
- Keine Discord-Nachricht nach draußen: Anfragen werden faul abgerechnet und
  bei der nächsten Handlung gemeldet, wie der Gegenschlag in 5b.
- Keine neue Vertragsmechanik – nur eine zweite **Art** im vorhandenen System.
- Keine mehrtägige Verpflichtung, die Stunden im Voraus wegnimmt. Ein Projekt
  wartet; es zwingt nicht.
- Kein Umbau der Idol-Zahlen. Der Umbau in `terms()` ist verhaltensneutral.

## Was heute gilt (gegen den Code geprüft)

| | Quelle |
|---|---|
| Verträge nur in Idol-Märkten, nur mit `persona: 'face'`, ab 100.000 Hörern, Wurf 0,25 je Veröffentlichung | `src/music.js:788-806` |
| `terms(kind)` kennt **nur** `'idol'`; `data.IDOL` steht an drei Stellen hart im Code | `src/music.js:262-264`, `:706`, `:761`, `:903` |
| Idol: 90 Tage, 50 % Anteil, Wachstum × 2,2, Hallen × 1,6, Skandal × 2,0, Ausstieg 30 Tage, Vorschuss 25 Tage | `src/data/music.js:105-114`, `src/music.js:809` |
| Konzert: 4 Stunden, ab 5.000 Hörern, Gage `8 × Hörer^0,7`, Sperre 3 Tage | `src/music.js:161-165`, `:660` |
| Veröffentlichung: Sperre 20 Stunden; Album 6 Titel, 3 Stunden, `spike` 5,5, `growth` 2,4 | `src/music.js:160`, `src/data/music.js:51` |
| Tantiemen je Tag: `ROYALTY_K × Hörer^ROYALTY_EXP × Markt` | `src/music.js:145-147` |
| Draht: ab 20 „bekannt", ab 50 „Partner" (auch über `yes ≥ 3`) | `src/data/contacts.js`, `src/contacts.js` |
| Reihe 1 der Kontaktansicht trägt **fünf** Knöpfe = Discord-Maximum | `src/ui.js` (4 Anfragen + Anstacheln/Disstrack) |
| 90 Kontakte, davon 72 mit Musik-Reichweite | `src/data/contacts.js` |

## Architektur

Zwei neue Module in der Hausform von `src/contacts.js` und `src/beef.js` – oben
die reinen Rechnungen (keine Datenbank, kein Zufall außer dem hereingereichten),
unten der Zustand: **`src/angebote.js`** und **`src/data/angebote.js`**.

`angebote.js` liest seinen Kontext über `contacts.detail(...)` und bewegt den
Draht ausschließlich über `contacts.moveDraht(...)` – dieselbe Regel wie in 5b,
der Draht wird an genau einer Stelle geschrieben. Für die Musikseite benutzt es
`beef.musikLage(...)`, damit ein Kontakt mit Doppelrolle nicht auf der
Creator-Seite gemessen wird. Alle Modulkreise über spät gebundene `require` (§8).

Drei Tabellen:

```
angebote (guild_id, user_id, id INTEGER PRIMARY KEY, art, contact_id,
          erstellt, frist, status)            -- status: offen | an | ab | verfallen
projekte (guild_id, user_id, id INTEGER PRIMARY KEY, art, contact_id,
          stunden_soll, stunden_ist, frist, status)  -- offen | fertig | verfallen
angebot_uhr (guild_id, user_id, last_roll, abgelehnt_folge,
             PRIMARY KEY (guild_id, user_id))
```

`abgelehnt_folge` zählt, wie oft hintereinander eine Anfrage nicht angenommen
wurde – nach drei Mal ruht der Zustellweg (`PAUSE_TAGE`).

## Die sechs Anfragearten

| Art | Was er will | Zeit | Was du bekommst | Ab Draht |
|---|---|---|---|---|
| 🔁 `tausch` | Er erwähnt dich, du ihn | 2 h | Reichweiten-Schub wie 5a (`contacts.boostOf('shoutout', …)`) | 20 |
| 🎙️ `gastpart` | Du singst auf seiner Platte | 2 h | **Honorar** + Schub wie `reaktion` | 20 |
| 🎪 `vorgruppe` | Du spielst vor ihm | 4 h | **Gage** mit seinem Publikum im Saal | 20 |
| 💿 `kollabo` | Gemeinsames Album | – | öffnet ein **Projekt** (18 h + 6 Titel) | **50** |
| 🎵 `tour` | Tour mit ihm | – | öffnet ein **Projekt** (24 h) | **50** |
| 📝 `label` | Einführung bei seinem Label | 2 h | öffnet ein **Vertragsangebot** | **50** |

`kollabo`, `tour` und `label` kommen also ausschließlich von Partnern. Das ist
der Wert, den der Partner-Status in 5a versprochen hat.

## Zustellung

`angebote.settle(guildId, userId, now, random)` rechnet faul ab (§4) und gibt
eine Liste von Ereignissen zurück, die die Anzeige meldet – genau wie
`beef.settle`. Pro **ganzem vergangenen Tag** seit `last_roll` ein Wurf:

```
ANFRAGE_CHANCE = 0.18        je Tag, höchstens EIN Treffer je Tag
ANFRAGEN_MAX   = 2           mehr offene Anfragen gibt es nicht
FRIST_TAGE     = 3
PAUSE_TAGE     = 14          nach drei nicht angenommenen Anfragen
ROLL_TAGE_MAX  = 7           mehr als sieben Tage Abwesenheit werden nicht nachgeholt
```

Bei einem Treffer wird der Kontakt gewichtet gezogen:

```
gewicht = drahtgewicht × passung
drahtgewicht = Draht < 20 ? 0 : Draht < 50 ? 1 : 4
passung      = passungOf({ meine, seine, seite: 'musik' }).passung   (aus 5a)
```

Partner wiegen also viermal so schwer wie Bekannte, und wer sprachlich und im
Genre zu dir passt, meldet sich eher – dieselbe Passung, die in 5a die
Antwortchance trägt. Die **Art** wird aus den für diesen Draht erlaubten Arten
gleichverteilt gezogen, mit einer Ausnahme: `label` nur, wenn kein Vertrag läuft
und keiner offen ist, und `kollabo`/`tour` nur, wenn kein Projekt offen ist.

`ROLL_TAGE_MAX` ist wichtig: ohne die Grenze bekäme ein Spieler nach drei Wochen
Pause zwanzig Würfe auf einmal und damit sofort beide Plätze voll.

## Annehmen, Ablehnen, Liegenlassen

`angebote.annehmen(guildId, userId, id, now, random)` prüft in dieser Reihenfolge:
Anfrage unbekannt → nicht mehr offen → Frist abgelaufen → Kontakt aus dem Katalog
verschwunden → **Zeit buchen** (`creator.useTime`, die Stunden der Art) → erst
dann schreiben. `no_time`/`exhausted` gehen unverändert durch, und bis zur
Zeitbuchung ist nichts geschrieben.

| Ausgang | Draht | Folge |
|---|---|---|
| angenommen | **+8** | die Wirkung der Art, `abgelehnt_folge = 0` |
| abgelehnt | **−5** | `abgelehnt_folge + 1` |
| verfallen (Frist) | **−8** | `abgelehnt_folge + 1` |

Liegenlassen kostet mehr als Absagen – jemanden auf „gelesen" sitzen zu lassen
ist schlimmer, als ihm Nein zu sagen. Nach drei nicht angenommenen Anfragen
ruht der Zustellweg zwei Wochen (`PAUSE_TAGE`), unabhängig vom Kontakt.

## Das Honorar und die Gage

**Honorar** (`gastpart`), zweiseitig gedeckelt:

```
honorar = min(HONORAR_K × seine^HONORAR_EXP, HONORAR_DECKEL_TAGE × tantiemenProTag)
HONORAR_K = 3 · HONORAR_EXP = 0,6 · HONORAR_DECKEL_TAGE = 30
```

Von Hand nachgerechnet (`royaltyPerDay` mit Markt 1,0):

| Deine Hörer | Lil Pfand 8.400 | Oxmo 350.000 | Nina Chuba 3,2 Mio | Hans Zimmer 110 Mio |
|---|---|---|---|---|
| 1.000 (60/Tag, Deckel 1.796) | 679 | **1.796** | **1.796** | **1.796** |
| 10.000 (949/Tag, Deckel 28.468) | 679 | 6.362 | 24.000 | **28.468** |
| 100.000 (15.040/Tag, Deckel 451.193) | 679 | 6.362 | 24.000 | 200.427 |
| 1 Mio (238.364/Tag) | 679 | 6.362 | 24.000 | 200.427 |

Fett ist, wo der Deckel greift. Die Zahlen zeigen beides ehrlich: ein Winzling
wird von einem Weltstar nicht über Nacht reich, und ein Künstler mit einer
Million Hörern verdient an einem Gastpart weniger als an einem Tag Tantiemen –
für den zählt nur noch der Schub, nicht das Geld. **Das gehört in die Anzeige
und in §15, nicht nur in die Spec.**

**Gage** (`vorgruppe`) in der Form der Konzert-Gage aus 5a, sein Publikum
gedeckelt auf die eigene Hörerschaft:

```
extraHoerer = min(meine, seine × VORGRUPPE_ANTEIL)     VORGRUPPE_ANTEIL = 0,05
gage        = SHOW_PAY × (meine + extraHoerer)^SHOW_EXP
```

Von Hand: bei 10.000 eigenen Hörern bringt eine Vorgruppe bei Oxmo (350.000)
8.200 statt 5.048 allein – **×1,62**, und das ist gleichzeitig das Maximum
(2^0,7), weil der Deckel bei der eigenen Hörerschaft liegt. Bei 100.000 eigenen
Hörern reicht Oxmo nur für ×1,12, Nina Chuba für ×1,62. Die Vorgruppe zählt als
Konzert und setzt dessen Sperre.

## Die Projekte

Ein Projekt ist ein **Stundenkonto**, das man an Tagen seiner Wahl füllt –
normal aus dem Tagesbudget, kein Sonderweg um §17 herum.

```
KOLLABO_STUNDEN = 18 · KOLLABO_TITEL = 6
TOUR_STUNDEN    = 24 · TOUR_KONZERTE = 5
PROJEKT_FRIST_TAGE = 14
ARBEIT_STUNDEN  = 2        je Druck auf „daran arbeiten"
```

`angebote.arbeiten(guildId, userId, id, now)` bucht `ARBEIT_STUNDEN` und zählt
sie auf `stunden_ist`. Beliebig oft am Tag, solange das Budget trägt; jeder
Druck ist eine Buchung (§9). Wird die Frist gerissen, verfallen die
investierten Stunden – das ist der Preis dafür, dass ein Projekt nicht zwingt.

**Kollabo-Album**, wenn das Konto voll ist: eine Veröffentlichung in Albumgröße
über `music.publish(..., 'album', ..., { audience: kollaboFaktor })`, dazu die
sechs Titel, die das Album ohnehin kostet.

```
kollaboFaktor = 1 + clamp(0, 1, log10(1 + seine / max(100, meine)) / 3)
```

Dieselbe Form wie `wuchtOf` in 5b, Obergrenze also **×2,0**. Von Hand: bei
10.000 eigenen Hörern bringt Oxmo ×1,519, Nina Chuba ×1,836, Hans Zimmer ×2,000;
bei 1 Mio eigenen Hörern bringt Oxmo nur noch ×1,043.

Ein Album kostet normal 3 Stunden und 6 Titel. Das Kollabo kostet **18** Stunden
und dieselben 6 Titel für höchstens doppeltes Publikum. **Es muss sich also nur
mit einem deutlich größeren Partner lohnen – und ob es das überhaupt tut, sagt
die Messung, nicht diese Spec.**

**Tour**, wenn das Konto voll ist: `TOUR_KONZERTE` Konzerte auf einmal, sein
Publikum **einmal** dazu (nicht je Abend), in derselben Form wie die Vorgruppe.
Fünf einzelne Konzerte kosten 20 Stunden und 12 Tage Sperre; die Tour kostet 24
Stunden und keine Sperre. Der Gewinn ist also die Zeit, nicht die Gage – und
genau das ist zu messen.

## Das Label

**Erst ein Umbau, verhaltensneutral.** `terms(kind)` gibt heute nur für `'idol'`
etwas zurück, und `data.IDOL` steht an drei Stellen hart im Code
(`src/music.js:706`, `:761`, `:903`). Diese drei Stellen gehen über
`terms(contract.kind)`, bevor eine zweite Art daneben steht. Die bestehenden
Idol-Tests müssen **Zahl für Zahl** unverändert weiterlaufen; tun sie es nicht,
ist der Umbau falsch.

Danach `LABEL` in `src/data/music.js`, neben `IDOL`:

| | Idol (unverändert) | Label (neu) |
|---|---|---|
| Hörer-Schwelle | 100.000 | **25.000** |
| `persona: 'face'` nötig | ja | **nein** |
| Laufzeit | 90 Tage | 60 Tage |
| Anteil | 50 % | **30 %** |
| Wachstum | × 2,2 | × 1,5 |
| Hallen | × 1,6 | × 1,2 |
| Skandal | × 2,0 | × 1,0 |
| Ausstieg | 30 Tage | 15 Tage |
| Vorschuss | 25 Tage | **10 Tage** |

Eine angenommene `label`-Anfrage legt ein Vertragsangebot in **seinem** Land an
(`db.insertContract` mit `kind: 'label'`, `country: contact.country`), mit
derselben Drei-Tage-Frist wie das Idol-Angebot. Unterschrift, Ausstieg und
Abrechnung laufen durch den vorhandenen Weg. Damit bekommt erstmals jeder Markt
einen Weg zu einem Vertrag – weniger Schub als beim Idol, aber auch weniger
Fessel, und ohne nach Tokio zu ziehen.

## Anzeige

- **Eigener Menüeintrag 📬 Angebote** (Gruppe `work`). Reihe 1 der
  Kontaktansicht sitzt mit fünf Knöpfen am Discord-Maximum, dort passt nichts
  mehr hinein.
- **Angebots-Ansicht:** je offene Anfrage eine Zeile mit Kontakt, Art, was sie
  bringt (Honorar oder Gage **als Zahl**, Schub als Faktor), den Stunden und der
  Restfrist; Knöpfe `annehmen|<id>|<uid>` und `ablehnen|<id>|<uid>`. Dazu das
  laufende Projekt mit Fortschrittsbalken und `arbeiten|<id>|<uid>`.
  Reaktionshaushalt: 2 Anfragen × 2 + Arbeiten + Zurück + Home = **7** (§16).
- **Hinweiszeile** in der Musik- und der Kontaktansicht, wenn etwas offen ist
  („📬 2 Angebote warten · 💿 Kollabo mit *Name*: 6 von 18 Stunden").
- **Meldungen** über denselben Weg wie in 5b: `settle` liefert Ereignisse,
  `settleAngebote` in `src/buttons.js` meldet sie, und **jede** Rückgabe nach
  dem `settle` trägt sie mit – auch die Ablehnungen, sonst verschluckt ein
  abgelehnter Knopfdruck eine verfallene Anfrage.
- **Texte** je Charakterzug wie in 5a/5b, alles Spielfiktion: Musik, Termine,
  Zahlen. Keine Aussage über Meinung, Charakter, Aussehen, Herkunft (außer der
  Staatsangehörigkeit), Familie, Gesundheit oder Privatleben einer realen
  Person, keine Pronomen über einen Kontakt.

## §3, Messung, Tests

**Dieses Stück bringt drei neue Geldwege** (Honorar, Gage, Vorschuss) und einen
Vertrag, der laufende Einnahmen umverteilt. Bei 5b hat eine Netto-Rechnung einen
Effekt verdeckt, der sich erst isoliert zeigte. **Jeder Weg wird deshalb einzeln
gemessen, nicht nur die Summe.**

Decken, jede gerechnet:
- **Honorar:** `3 × seine^0,6`, gedeckelt auf 30 Tage eigener Tantiemen. Höchster
  möglicher Einzelbetrag im Katalog: `3 × 130.000.000^0,6` = **221.558**, und das
  nur für einen Spieler, dessen Deckel darüber liegt – nachgerechnet **ab 55.285
  eigenen Hörern**. Darunter bindet immer der Deckel, und das Honorar ist dann
  exakt 30 Tage eigener Tantiemen.
- **Gage:** höchstens `2^0,7` = ×1,62 einer eigenen Konzert-Gage, weil sein
  Publikum auf die eigene Hörerschaft gedeckelt ist.
- **Kollabo:** höchstens ×2,0 Publikum **einer** Veröffentlichung, gegen 15
  Stunden Mehrkosten gegenüber einem normalen Album. Dazu entfällt – weil das
  Album über `publish(…, { force: true })` läuft – die 20-Stunden-Sperre
  zwischen zwei Veröffentlichungen: Gemessen erscheint ein Kollabo eine Minute
  nach einem normalen Album. Das ist der Preis dafür, dass die bezahlten 18
  Stunden nicht an einer Platte von vorgestern scheitern (`no_songs` ist die
  einzige Stelle, an der ein volles Konto nicht abschließt), und ein zweites
  Kollabo kostet trotzdem wieder 18 Arbeitsstunden aus dem Tagesbudget, also
  mindestens neun Drücke über mehrere Tage – das ist kein schnellerer Weg zu
  vielen Platten als die Sperre selbst. Für die Messung in Task 6 heißt das:
  Die Zahl der Veröffentlichungen je Jahr steigt um die Kollabos, und das ist
  so gewollt.
- **Tour:** fünf Konzerte für 24 statt 20 Stunden, sein Publikum einmal; die
  Konzert-Sperre entfällt. Die Decke ist die der fünf Konzerte plus ×1,62 auf
  eines davon.
- **Vorschuss:** 10 Tage Tantiemen, einmal je Vertrag, nur wenn keiner läuft.
- Kein `unb`-Aufruf in `src/angebote.js` oder `src/data/angebote.js` – die
  Geldwege laufen über die vorhandenen Buchungen in `src/music.js`.

**Messung** (`scripts/messung-geldquellen.js --nur=angebote`), in der Form des
Beef-Laufs: Archetypen **Musik+Creator** und **nur Musik**, je 10 × 365 Tage mit
demselben gesäten Würfel, Varianten:

1. `aus` – Zustellweg still (die Grundlage)
2. `alles-ab` – jede Anfrage abgelehnt (was kostet Höflichkeit?)
3. `alles-an` – jede Anfrage angenommen (die Summe)
4. `nur-geld` – nur `gastpart` und `vorgruppe` angenommen (Honorar und Gage isoliert)
5. `nur-projekte` – nur `kollabo` und `tour` angenommen (die Formate isoliert)
6. `nur-label` – nur `label` angenommen (der Vertrag isoliert)

Ausgabe je Variante: Median/Tag, Differenz als Mediane **und je Seed gepaart**,
Spanne, „N von 10 Seeds im Plus", Annahmequote, Ø Honorar, Ø Gage, fertige und
verfallene Projekte, unterschriebene Verträge. **Liegt eine Variante über
+25 % gepaart, wird die zugehörige Konstante gesenkt und neu gemessen**, und
beide Werte stehen im Bericht. Vor jeder abgeleiteten Zahl eine Handprüfung
gegen einen Einzelfall. Eine stille Null ist ein Fehler, kein Ergebnis.

**Tests** (`test/angebote.test.js`, ohne Netz, §12):

- Rein: Gewichtung (Draht < 20 wiegt 0, Partner viermal Bekannter, Passung
  wirkt) · `honorarOf` an den vier handgerechneten Zeilen inklusive beider
  Deckelfälle · `gageOf` an den vier Werten · `kollaboFaktor` an den
  handgerechneten Werten inklusive der Obergrenze 2,0 · Fristen und
  `ROLL_TAGE_MAX`.
- Zustand: Zeit wird **vor** jedem Schreiben gebucht · `ANFRAGEN_MAX` ·
  Draht +8/−5/−8 · `abgelehnt_folge` und `PAUSE_TAGE` · `label` nur ohne
  laufenden Vertrag · `kollabo`/`tour` nur ohne offenes Projekt · ein
  verfallenes Projekt gibt die Stunden **nicht** zurück · `settle` ist
  idempotent und holt höchstens `ROLL_TAGE_MAX` Tage nach.
- Vertrag: der Umbau auf `terms(kind)` ändert für Idol **keine Zahl** (die
  bestehenden Tests sind der Beweis) · ein `label`-Vertrag zahlt 10 Tage
  Vorschuss, nimmt 30 % und läuft 60 Tage · die Hörer-Schwelle 25.000 greift.
- Anzeige (`test/fluxer-render.test.js`): Angebots-Ansicht mit zwei Anfragen
  und einem Projekt, Honorar und Gage als Zahl, Fortschrittsbalken,
  `overflow === undefined`; die Meldung einer verfallenen Anfrage erscheint
  auch auf einem abgelehnten Knopfdruck.
