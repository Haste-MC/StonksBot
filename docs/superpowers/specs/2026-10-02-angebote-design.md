# Gegenanfragen und große Formate – Stück 5c

> **Nachtrag aus Stück 6a (2026-10-08):** Die hier wortgetreu vorgeschriebenen
> Meldungstexte sind überholt. Sie sprachen mit einem Pronomen über einen
> **beliebigen** Kontakt — etwa »für ihn«, »Mit ihm läuft schon einer«, »sein
> Konter«, »bei seinem Label« —, und der Katalog in `src/data/contacts.js` hat
> **kein Geschlechtsfeld**. Betroffen waren unter anderem Nina Chuba, Loredana,
> Rosalía, Anitta, Angèle, Sezen Aksu, Ado, Peggy Gou und Pamela Reif, dazu die
> Bands. Stück 6a hat sie neutral gefasst; der gültige Stand steht in
> `docs/superpowers/specs/2026-10-07-beziehungen-design.md` und im Code.
> **Wer gegen dieses Dokument implementiert, übernimmt die Texte nicht wortgetreu.**

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
| 🔁 `tausch` | Er erwähnt dich, du ihn | 2 h | Release-Schub auf die nächste Veröffentlichung | 20 |
| 🎙️ `gastpart` | Du singst auf seiner Platte | 2 h | **Honorar** + derselbe Release-Schub | 20 |
| 🎪 `vorgruppe` | Du spielst vor ihm | 4 h | **Gage** mit seinem Publikum im Saal | 20 |
| 💿 `kollabo` | Gemeinsames Album | – | öffnet ein **Projekt** (18 h + 6 Titel) | **50** |
| 🎵 `tour` | Tour mit ihm | – | öffnet ein **Projekt** (24 h) | **50** |
| 📝 `label` | Einführung bei seinem Label | 2 h | öffnet ein **Vertragsangebot** | **50** |

**Ein Schub, nicht zwei verschiedene:** Diese Tabelle versprach für `tausch`
den Schub von `contacts.boostOf('shoutout', …)` und für `gastpart` „wie
`reaktion`" – also zwei unterschiedlich starke. Gebaut ist EINER: `schubFor`
(`src/angebote.js`) setzt für beide Arten `stufe: 'zusage'` und daraus einen
`release`-Schub `min(4, 1 + 3 × stärke)` für 48 Stunden. Das ist Absicht und
bleibt so – eine zugesagte Gegenanfrage ist eine Zusage, und zwei Stufen für
dieselbe Zusage wären eine Unterscheidung ohne Grund. Die Tabelle sagt es jetzt,
wie es ist (§15 beschreibt denselben Weg).

`kollabo`, `tour` und `label` kommen also ausschließlich von Partnern. Das ist
der Wert, den der Partner-Status in 5a versprochen hat.

## Zustellung

`angebote.settle(guildId, userId, now, random)` rechnet faul ab (§4) und gibt
eine Liste von Ereignissen zurück, die die Anzeige meldet – genau wie
`beef.settle`. Pro **ganzem vergangenen Tag** seit `last_roll` ein Wurf:

```
ANFRAGE_CHANCE = 0.09        je Tag, höchstens EIN Treffer je Tag
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
| Vorschuss | 25 Tage | **3 Tage** |

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
  bringt (Honorar oder Gage **als Zahl**, der Schub als Satz – „📣 Schub auf
  deine nächste Veröffentlichung", siehe unten), den Stunden und der
  Restfrist; Knöpfe `annehmen|<id>|<uid>` und `ablehnen|<id>|<uid>`. Dazu das
  laufende Projekt mit Fortschrittsbalken und `arbeiten|<id>|<uid>`.
  Reaktionshaushalt: 2 Anfragen × 2 + Arbeiten + Zurück + Home = **7** (§16).
  **Der Schub steht als Satz und nicht als Faktor, und das bleibt so:** Seine
  Stärke hängt an `contacts.staerkeOf` und damit am Draht und an der Passung zum
  Zeitpunkt der ZUSAGE. Ein Faktor in der Angebotszeile wäre eine Vorhersage –
  der Draht kühlt ab (§5a), und zwischen Zustellung und Klick liegen bis zu drei
  Tage. Die Zahl steht deshalb dort, wo sie feststeht: in der Zusage
  (`annahmeNote`: „🤝 Wirkt auf …: ×2,4, noch 48 h"). Honorar und Gage stehen
  anders als der Schub schon in der Zeile, weil sie nur an Reichweiten hängen
  und sich bis zum Klick nicht ändern.
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
- **Vorschuss:** 3 Tage Tantiemen, einmal je Vertrag, nur wenn keiner läuft.
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
  bestehenden Tests sind der Beweis) · ein `label`-Vertrag zahlt 3 Tage
  Vorschuss (bis zum Balancing vom 2026-10-02 stand hier 10, siehe das Addendum),
  nimmt 30 % und läuft 60 Tage · die Hörer-Schwelle 25.000 greift.
- Anzeige (`test/fluxer-render.test.js`): Angebots-Ansicht mit zwei Anfragen
  und einem Projekt, Honorar und Gage als Zahl, Fortschrittsbalken,
  `overflow === undefined`; die Meldung einer verfallenen Anfrage erscheint
  auch auf einem abgelehnten Knopfdruck.

## Addendum nach der Messung (2026-10-02/03)

Gemessen mit `scripts/messung-geldquellen.js --nur=angebote`, 10 · 30 · 60 Läufe
à 365 Tage, Rohausgabe in `docs/messungen/2026-10-02-angebote.txt`. Alle Zahlen
hier stehen dort mit demselben Wert.

### Was die Messung ergeben hat

Die Kopfzahlen sind die der **ENDEINSTELLUNG**, also des Stands, der heute in den
Datendateien steht: `ANFRAGE_CHANCE` 0,09 und `LABEL.advanceDays` 3. Die rechte
Spalte hält den **Lauf vor dem Balancing** fest (0,18 und 10 Tage) – das ist der
Stand, der den Auslöser gerissen hat, und keine seiner Zahlen gilt noch. Beide
Läufe haben dieselben Seeds, dieselbe Strategie und dieselbe Grundlage „aus"; die
Grundlage ist von beiden Konstanten unberührt, weil sie den Zustellweg nie ruft.

| Variante (60 Läufe, Mediane / gepaart je Seed) | Endeinstellung: Musik+Creator | Endeinstellung: nur Musik | vor dem Balancing: M+C · nur Musik |
|---|---|---|---|
| `aus` | 303.876/Tag | 89.211/Tag | 303.876/Tag · 89.211/Tag (unberührt) |
| `alles-ab` | −5,2 % / −2,8 % | +1,0 % / +0,0 % | −3,3 % / −0,4 % · +0,7 % / −0,1 % |
| `alles-an` | −0,9 % / −0,4 % | +16,8 % / **+17,9 %** | +3,3 % / +8,6 % · +46,2 % / **+47,0 %** |
| `nur-geld` | −6,2 % / −4,4 % | +2,6 % / +1,0 % | −4,5 % / −2,5 % · +6,6 % / +4,6 % |
| `nur-projekte` | −1,6 % / +0,0 % | +5,3 % / +2,5 % | −3,0 % / −0,1 % · +7,3 % / +3,1 % |
| `nur-label` | −4,5 % / −1,4 % | +0,1 % / −0,1 % | −1,2 % / −0,8 % · +3,8 % / −0,2 % |

Die Decken halten – **Endeinstellung, 60 Läufe:** Honorar höchstens **221.558**
(Coldplay 130 Mio, und nur ab 55.285 eigenen Hörern – als größter Einzelbetrag
über 365 Gastparts genau erreicht, Ø 5.942), Gage höchstens **×1,625** (gemessen
größte 158.038, Ø 52.993), Kollabo-Faktor höchstens ×2,000 (gemessen nur bis
**1,069**, im Mittel **1,037**), Vorschuss **3 Tage** Tantiemen (gemessen
Ø 222.815, größter 911.720). Kein `unb`-Aufruf in `src/angebote.js`.
**Vor dem Balancing** waren es dieselbe Honorardecke 221.558 über 842 Gastparts
(Ø 14.331), Gage größte 231.082 (Ø 63.219), Kollabo-Faktor bis 1,683 (Ø 1,145)
und 10 Tage Vorschuss (Ø 913.659, größter 3.372.861).

### Sechs Abweichungen zwischen Spec und gebautem Code bzw. gemessener Wirklichkeit

1. **Die Spec nennt Hans Zimmer (110 Mio) als größten Kontakt, der Katalog hat
   Coldplay mit 130 Mio.** Die Decke der Spec (`3 × 130.000.000^0,6` = 221.558)
   ist richtig, die Tabellenüberschrift darüber nicht ganz.
2. **Der Kollabo-Faktor ist in der Praxis ×1,037 und nicht ×2,0** (vor dem
   Balancing ×1,145). Die Spec rechnet mit „10.000 eigene Hörer gegen Hans
   Zimmer" – diese Lage kommt nicht
   vor. Wer einen Partner aufbauen kann, baut ihn zu jemandem auf, der in seiner
   Größenordnung liegt: Die Antwortchance eines Künstlers mit 100.000 Hörern
   liegt bei Coldplay bei 6,7 % und bei den übrigen Riesen bei `CHANCE_MIN`
   2,0 %.
3. **Die Spec fragt „lohnt sich das Kollabo?" – die Antwort ist nein, und die
   gemessene Spielweise kann es nicht einmal abschließen.** 174 von 195
   Kollabos sind mit **vollem** 18-Stunden-Konto verfallen, weil die sechs Titel
   fehlten (1.825 Drücke mit `no_songs`) – vor dem Balancing 356 von 377 und
   3.630 Drücke. Bei gleicher Veröffentlichungspolitik (ein eigenes Kontrollpaar,
   beide horten) liegt das Kollabo bei −5,3 % / −5,0 % (Musik+Creator) und
   +3,7 % / +3,8 % (nur Musik); vor dem Balancing bei −6,7 % / −4,2 % und
   −1,5 % / −0,1 %. Die 203 Kollabos dieses Paares haben ein Publikum ×1,054
   (1,005 … 1,353) bzw. ×1,049 (1,004 … 1,360) gebracht.
   Die Spec hat mit „muss sich mit einem deutlich größeren Partner lohnen"
   richtig geahnt, dass es knapp wird; dass es nicht aufgeht, sagt erst die
   Messung.
4. **Die Spec listet die aufgehobene 20-Stunden-Release-Sperre als Decke, die
   man prüfen muss.** Geprüft: Sie ändert nichts. Die Zahl der
   Veröffentlichungen je Tag liegt in jeder Variante zwischen −1,3 % und +0,4 %
   gegen „aus" – weil der Spieler ohnehin an der Titelzahl und nicht an der
   Sperre hängt.
5. **Die Spec rechnet die fünf Tour-Buchungen nicht als §9-Ausnahme aus.** Der
   gebaute Code bucht fünfmal, und das ist richtig: `xpForAmount` ist
   `⌊√Betrag⌋`, gemessen 1.352 XP gegen 611 für eine einzige Buchung. Das steht
   jetzt in `ARCHITEKTUR.md` §9 und §15.
6. **5c schaltet einen alten Vorfall erstmals überall frei.** „Das Label will
   verschieben" (`src/data/musicDecisions.js`, `requires: { contract: true }`)
   war außerhalb Japans und Koreas unerreichbar. Seine Option „Durchziehen"
   lässt den Vertrag mit 40 % platzen, und das kostet 15 Tage Tantiemen:
   gemessen **−750 am Tag** in `alles-an` (vor dem Balancing −1.823). Die Spec
   erwähnt das nicht. Und weil der gemessene Spieler jeden Vorfall mit einer
   **zufälligen** Option beantwortet (`scripts/messung-geldquellen.js:1014`), ist
   das der Preis des blinden Antwortens und nicht der des „Durchziehens".

### Der Zuschnitt: warum die isolierenden Varianten zu klein ausfallen

Die Spec verlangt die vier isolierenden Varianten, damit kein Effekt in einer
Netto-Rechnung verschwindet. Gemessen passiert das Gegenteil: Sie fallen **zu
klein** aus, weil `PAUSE_SCHWELLE` 3 greift. Wer fünf von sechs Arten ablehnt,
steht an 15,2 % (`nur-geld`), 20,1 % (`nur-projekte`) und 26,5 % (`nur-label`)
aller Tage ohne einen Wurf da; `alles-an` an 0 %. Deshalb ist eine zweite
Zerlegung dazugekommen (`--zerlegung`): „alles-an" gegen „alles-an ohne eine
Gruppe", bei gleicher Zustellrate. Gepaart, reiner Musiker, 30 Läufe: Honorar +
Gage **+18,2 %**, Kollabo + Tour **+20,2 %**, Label **+5,9 %**, Erwähnung
**+2,5 %** – zusammen +46,8 % gegen die gemessenen +47,0 %.

### Zwei Konstanten mussten gesenkt werden

`alles-an` lag für den reinen Musiker bei **+47,0 %** gepaart (60 Läufe; +47,1 %
bei 30, +51,5 % bei 10 – über alle drei Seedzahlen stabil, 55 von 60 Seeds im
Plus). Der Auslöser „über +25 %" war damit erreicht. **Welche** Konstante, hat die
Messung entschieden: jeder Hebel einzeln gefahren, 30 Läufe zur Suche, 60 zur
Bestätigung (vollständige Tabelle in der Messdatei, Abschnitt „Der Auslöser").

Zwei der vier Hebel, die der Plan nennt (die Spec nennt keine Hebelliste),
wirken nicht oder falsch:

* `VORGRUPPE_ANTEIL` 0,05 → 0 ändert die Zahl um **±0,0** Prozentpunkte. Die Gage
  ist fast vollständig die eigene Konzertgage; das mitgebrachte Publikum legt nur
  die letzten 62 % obendrauf.
* `TOUR_STUNDEN` 24 → 40 macht es **schlechter** (+57,4 %): Das Konto wird in den
  14 Tagen nicht mehr voll, die Tour verfällt, und weil ein offenes Projekt
  `kollabo` von der Zustellung aussperrt, spart der Spieler sich die 18 Stunden,
  die er sonst in ein Kollabo ohne Titel gesteckt hätte.
* `HONORAR_K` und `KOLLABO_STUNDEN` hängen an Wegen, die zusammen 423 von 130.432
  am Tag ausmachen.
* `LABEL.cut` 30 % → 50 % käme mit +19,2 % unter die Linie, aber der Anteil liegt
  auf **jeder** Musikeinnahme: Er besteuert Honorar, Gage und Tour mit, also die
  Wege, die das Problem verursachen, über einen Weg, der nur +5,9 % davon trägt –
  und `nur-label` fiele von −0,2 % auf −3,5 %.

Gesenkt wurden deshalb **zwei** Zahlen:

| Konstante | Datei | vorher | nachher |
|---|---|---|---|
| `ANFRAGE_CHANCE` | `src/data/angebote.js` | 0,18 | **0,09** |
| `LABEL.advanceDays` | `src/data/music.js` | 10 | **3** |

`ANFRAGE_CHANCE` trifft, was die Zerlegung als Ursache benennt: nicht den Betrag
je Anfrage, sondern die Menge an freien Gelegenheiten – alle vier Wege hängen
daran gemeinsam. Allein bringt sie +47,0 % → +23,0 %. **Unter 0,12 ist sie aber
nicht auflösbar**: 0,09 gibt +23,0 %, 0,08 gibt +25,6 %, 0,07 gibt +26,9 % und
0,06 gibt +14,0 % – bei 60 Läufen, derselben Säung, einem Schritt von einem
Prozentpunkt. Deshalb kommt `LABEL.advanceDays` dazu: der einzige Betrag je
Anfrage, der wirklich aus der Reihe fällt (Ø 913.659 bei einem Tageseinkommen von
89.211, alle 60 Tage neu, 209 Mal in 60 gemessenen Jahren). Zusammen:
**+17,9 %**, also 7,1 Prozentpunkte unter dem Deckel.

Endeinstellung, 60 Läufe, gepaart: `alles-an` nur Musik **+17,9 %**,
Musik+Creator **−0,4 %** · `alles-ab` +0,0 % / −2,8 % · `nur-geld` +1,0 % /
−4,4 % · `nur-projekte` +2,5 % / +0,0 % · `nur-label` −0,1 % / −1,4 %.

**Die zwei gesenkten Konstanten standen an VIER Stellen dieser Spec, und alle
vier tragen jetzt den Wert, mit dem der Code läuft:**

1. `ANFRAGE_CHANCE` im Konstantenblock – **0.09** (stand hier als `0.18`).
2. `Vorschuss | 25 Tage | 3 Tage` in der Label-Tabelle (stand als `10 Tage`).
3. „**Vorschuss:** 3 Tage Tantiemen" in der Decken-Liste (stand als `10 Tage`).
4. „ein `label`-Vertrag zahlt 3 Tage Vorschuss" in der Testliste – `test/music.test.js`
   prüft die 3.

**Warum sie jetzt im Text stehen und nicht nur hier annotiert sind:** Die
Anmerkung „zu lesen als 0.09" setzt voraus, dass jeder Leser bis zum Addendum
kommt. Wer den Konstantenblock liest, um eine Zahl im Code zu prüfen, hört davor
auf – und las dann 0,18, also das Doppelte. Eine Spec, deren Körper die falsche
Zahl trägt und sie am Ende berichtigt, hat zwei Werte; der Körper gewinnt, weil er
zuerst gelesen wird. Was die Annotation leistete, leistet jetzt die Klammer
daneben: die Geschichte bleibt nachlesbar, der Wert ist der echte.

Gefunden mit `grep -n '0\.18\|10 Tage\|advanceDays'` über diese Datei; mehr als
diese vier Stellen gibt es nicht – die weiteren Treffer stehen in diesem Addendum
und sind dort als „vor dem Balancing" markiert. Sonst ist nichts angetastet:
Jeder Betrag, den die Anzeige auf einen Knopf schreibt, ist der, den diese Spec
versprochen hat.
