# Kontakte – Stück 5a: Der Draht zu anderen Künstlern

Stand: 2026-09-25 · Zweig `main` · erstes von drei Stücken (5a Kontakte und
Draht, 5b Beef und Disstracks, 5c Gegenanfragen und große Formate) ·
Beschlüsse des Nutzers 2026-09-25 im Text markiert.

## Ziel

Musiker und Creator können andere Künstler anschreiben – im eigenen Land oder
international –, **für Zusammenarbeit und mehr**. Ob jemand antwortet, hängt
an der eigenen Reichweite gegen seine, an Sprache, Land, Genre, Hype,
Charakter und am bisherigen Draht. Die Antwort hat Stufen: vom Emoji unter
dem Post bis zur echten Zusage, die eine gemeinsame Sache und dauerhafte
Verbindungen freischaltet.

Beschlüsse:

| # | Beschluss |
|---|---|
| 1 | Fester, handgeschriebener Katalog (A); echte Künstlernamen, ein paar Quatsch-Einträge dazwischen; **gemeinsamer** Katalog für Musik und Creator, Doppelrollen erlaubt. |
| 2 | Ein Versuch kostet **2 Stunden** aus dem 24-h-Tag (A), dazu eine Sperre je Kontakt. |
| 3 | Antwortchance als Wurzelkurve ohne harte Schwelle (A), plus Türöffner-**Bonus** über gute Drähte; Sprache, Land, Genre, Hype, Charakter und Anfrageart wirken mit. |
| 4 | Wirkung über bestehende Multiplikatoren (A), Freischaltungen (C) **nur bei echten Zusagen**, nicht bei flüchtigen Reaktionen. |
| 5 | Der Katalog deckt **jedes Land, jede Sprache, jedes Genre, jede Plattform** ab (Regeln unten, im Test geprüft); die **Passung** steuert Chance *und* Wirkung, damit ein deutscher Rapper einem J-Pop-Act in Japan fast nichts bringt. |

Erfundene Aussagen der Kontakte bleiben **innerhalb der Spielfiktion** (Musik,
Streams, Kollabos); keine Meinungen zu realen Themen, keine Zitate außerhalb
des Spiels.

## Nicht-Ziele

- Kein Beef, keine Disstracks, keine Lagerbildung (5b).
- Keine Gegenanfragen der Kontakte, keine mehrtägigen Formate (Tour,
  Kollabo-Album), keine Label-Verträge über Kontakte (5c).
- Keine Kontakte zwischen **Spielern** (das ist ein eigenes Thema).
- Kein neuer Geldweg: Schübe wirken auf bestehende Aktionen und deren Decken.

## Was heute gilt (gegen den Code geprüft)

| | Quelle |
|---|---|
| Künstler: `db.getArtist(guildId, userId, now)` mit `genre, persona, listeners, hype, songs, buzz`; `music.status(...)` liefert `listeners`, `market`, `genre`, `persona`; `publish(..., { audience: faktor })` skaliert das Publikum einer Veröffentlichung; `show(...)` zahlt nach `listeners^SHOW_EXP` | `src/music.js` |
| Creator: `creator.status(...)` mit `platforms[].followers`, `total`, `community`, `boost`/`boost_until` (Twitter-Promo, Multiplikator auf die nächste Aktion), `act(...)` nutzt `boost` | `src/creator.js` |
| Markt: `home.marketOf(guildId, userId)` → `{ country, language, scene, pool, speed, royalty, strict, deal, atHome }`; 21 Länder, 15 Sprachen | `src/home.js`, `src/data/world.js` |
| Genres: 8 (`pop, hiphop, rock, elektro, indie, metal, klassik, jpop`) mit `reach`, `risk`, `live` | `src/data/music.js` |
| Zeit und Energie: `creator.useTime(guildId, userId, stunden, now)` → `{ ok, factor, … }` bzw. `{ ok:false, reason:'exhausted'|'no_time' }` (24-h-Tag, Energie skaliert die Wirkung) | `src/creator.js`, `src/energy.js` |
| Menü-Registry, zustandslose Button-IDs (§6), Fluxer-Reaktionshaushalt `MAX_REACTIONS 9`, Modale als Ein-Feld-Prompt | `src/menu.js`, `src/ui.js`, `src/fluxer/` |
| Muster für „jemand meldet sich": Marken-Anfrage auf Instagram (`creator.js`, `COOP_*`), Idol-Vertrag (`data/music.js IDOL`) | `src/creator.js`, `src/music.js` |

## Der Katalog

`src/data/contacts.js`, handgeschrieben:

```js
{ id: 'apache', name: 'Apache 207', emoji: '🎤',
  kind: 'musik',                 // musik | creator | beides
  country: 'de', language: 'deutsch',
  genre: 'hiphop',               // Musikseite
  platform: null,                // Creator-Seite (twitch|youtube|instagram|twitter)
  reach: 3_200_000,              // Hörer (Musik)
  reachCreator: 0,               // Follower (Creator), bei `beides` gesetzt
  trait: 'kuehl',                // kollegial | arrogant | geschaeftlich | launisch | kuehl
  blurb: 'Antwortet selten, aber wenn, dann kurz und trocken.' }
```

**Reichweitenklassen** (nur zur Orientierung beim Schreiben, keine Logik):
lokal 5.000–50.000 · Landesgröße 100.000–3 Mio · international 5–50 Mio ·
Weltstar ab 100 Mio.

**Abdeckungsregeln** (im Katalogtest geprüft):

- jedes der **21 Länder** ≥ 1 Kontakt;
- jede der **15 Sprachen** ≥ 3 Musik-Kontakte, darunter mindestens einer unter
  100.000 und mindestens einer über 1 Mio;
- jedes der **8 Genres** ≥ 4 Kontakte in ≥ 3 Sprachen, darunter ≥ 1 mit
  `reach ≥ 100 Mio`;
- jede der **4 Plattformen** ≥ 3 Creator-Kontakte, davon ≥ 1 über 10 Mio;
- IDs eindeutig; `country` und `language` existieren in `data/world`; `genre`
  existiert in `data/music`; `kind` passt zu den gesetzten Feldern
  (`musik` → `genre` und `reach`; `creator` → `platform` und `reachCreator`;
  `beides` → alle vier).

Ergibt rund 45 Musik- und 20 Creator-Einträge, einige mit Doppelrolle, dazu
ein paar Quatsch-Namen als unterste Stufe (z. B. „Lil Pfand", lokal, antwortet
immer, bringt fast nichts).

## Passung

```
sprachfaktor = gleiche Sprache 1,0 · Englisch (bei einem der beiden) 0,6 · sonst 0,15
genrefaktor  = gleiches Genre 1,0 · verwandt 0,7 · fremd 0,3
   verwandt: pop↔hiphop, pop↔elektro, pop↔jpop, rock↔metal, rock↔indie, indie↔pop
passung = sprachfaktor × genrefaktor          // 0,045 … 1,0
```

Für Creator-Anfragen zählt statt des Genres die Plattform:
`plattformfaktor = gleiche Plattform 1,0 · sonst 0,6` (Reichweite wandert
zwischen Plattformen, aber nicht ungebremst).

## Anfrage und Antwort

Vier Arten (`data/contacts.js` `REQUESTS`):

| id | Name | Zeit | Schwierigkeit | Bedingung |
|---|---|---|---|---|
| `reaktion` | Auf deinen Post reagieren | 2 h | +0,15 | – |
| `shoutout` | Dich erwähnen | 2 h | 0 | – |
| `feature` | Gemeinsamer Track / Gastauftritt | 2 h | −0,10 | – |
| `konzert` | Gemeinsam auf die Bühne / Event | 2 h | −0,20 | Draht ≥ 20 |

**Seiten und Voraussetzungen.** Jede Anfrage läuft entweder über die
**Musikseite** oder die **Creator-Seite**:

- Musikseite: deine Reichweite = `music.status().listeners`, seine = `reach`;
  möglich, wenn du die Karriere gestartet hast (`genre` und `persona` gesetzt)
  und der Kontakt `kind` `musik` oder `beides` ist.
- Creator-Seite: deine Reichweite = `creator.status().total`, seine =
  `reachCreator`; möglich, wenn du auf mindestens einer Plattform Follower
  hast und der Kontakt `kind` `creator` oder `beides` ist.
- Bei `beides` wählt die Anfrageart die Seite: `feature`/`konzert` gehen über
  die Musikseite, wenn du Musik machst, sonst über die Creator-Seite;
  `reaktion`/`shoutout` laufen über die Seite mit der größeren eigenen
  Reichweite. Die Ansicht sagt, welche Seite gilt.
- Beide Reichweiten gehen mit einem Boden von **100** in die Rechnung, damit
  ein frischer Account keine Division durch null erzeugt.

**Antwortchance** (Wurf 1):

```
ratio  = max(100, deineReichweite) / seineReichweite     (Seite wie oben)
basis  = 0,6 × √ratio                             gedeckelt auf 0,95
chance = clamp(0,02, 0,95,
           basis
           + schwierigkeit                        (Tabelle oben)
           + (gleiches Land ? 0,05 : 0)
           + sprachbonus                          (gleiche Sprache +0,10 · Englisch 0 · fremd −0,15)
           + genrebonus                           (gleiches Genre +0,05 · fremd −0,05)
           + draht / 100 × 0,25                   (−0,25 … +0,25)
           + tuerOeffner                          (0 … +0,15, siehe unten)
           + hypeBonus                            ((hype − 1) × 0,1, −0,04 … +0,07)
           + charakter)                           (kollegial +0,10 · launisch ±0 · geschaeftlich −0,05 · kuehl −0,08 · arrogant −0,12)
```

`tuerOeffner` = `0,15 × min(1, Σ Drähte ≥ 50 zu Kontakten desselben Landes
oder Genres / 2)` – zwei Partner im Umfeld geben den vollen Bonus.

`hypeBonus` nutzt den vorhandenen Hype (Musik `HYPE_MIN 0,6` … `HYPE_MAX 1,7`).

**Antwortstufe** (Wurf 2, nur wenn Wurf 1 trifft): Gewichte

```
gewichte = { fluechtig: 6, echt: 3, zusage: 1 }
  × Anpassung: zusage × (1 + 2 × min(1, ratio))          // auf Augenhöhe viel öfter Zusagen
               zusage × (1 + draht / 100)
               fluechtig × (ratio < 0,05 ? 2 : 1)         // beim Weltstar bleibt es meist beim Emoji
```

Bei `ratio ≥ 1` und Draht 50 steht es also etwa 6 : 3 : 4,5 (Emoji : Antwort :
Zusage), bei 1:1000 rund 12 : 3 : 1.

Handrechnung der Basis (geprüft): 1:1 → 0,600 · 1:10 → 0,190 · 1:100 → 0,060 ·
1:1000 → 0,019 (die Untergrenze 0,02 hebt das auf 2 %). Rohstärke
`log10(1 + seine/deine)/3`: gleich groß 0,100 · 1:10 0,347 · 1:100 0,668 ·
1:1000 1,000 (gedeckelt).

**Sperren:** nach jedem Versuch 3 Tage, nach „ignoriert" 7 Tage keine neue
Anfrage bei diesem Kontakt. Die Zeit (2 h) wird **immer** gebucht, auch wenn
er nicht antwortet – der Abend ist weg.

## Wirkung

```
staerke = clamp(0, 1, log10(1 + seineReichweite / max(100, deineReichweite)) / 3)
          × passung × stufenfaktor
   stufenfaktor: fluechtig 0,25 · echt 0,5 · zusage 1,0
```

| Anfrage | Wirkung |
|---|---|
| `reaktion`, `shoutout` | Schub auf die nächste Veröffentlichung bzw. Creator-Aktion: Faktor `1 + 3 × staerke` (max 4), gültig 48 h |
| `feature` | Die nächste Veröffentlichung/Aktion läuft „mit ihm": Faktor `1 + 5 × staerke` (max 6), zusätzlich Hype × `1 + 0,15 × staerke`, Titelzusatz „feat. <Name>"; gültig 72 h |
| `konzert` | Beim nächsten Konzert zählt `staerke × seineReichweite × 0,1` Hörer zusätzlich für die Gage, gedeckelt auf das Doppelte der eigenen Gage; gültig 7 Tage |

Der Schub liegt in einer neuen Tabelle `contact_boosts (guild_id, user_id,
kind, factor, extra, until, contact_id)` mit `kind ∈ { release, creator, show }`
und wird von `music.publish`, `creator.act` und `music.show` beim nächsten Mal
**verbraucht** (gelesen, angewandt, gelöscht – wie der Twitter-Promo-Schub).
Mehrere Schübe derselben Art: der stärkere gewinnt, sie stapeln nicht.

## Draht und Freischaltung

Tabelle `contacts (guild_id, user_id, contact_id, draht, tries, yes, last_try,
last_move, PRIMARY KEY (guild_id, user_id, contact_id))`.

Bewegung: Zusage +12 · echte Antwort +6 · flüchtig +2 · ignoriert −1 ·
Absage mit Verstimmung (arrogant/kühl, 25 % der Ablehnungen) −5. Abklingen:
2 Punkte je Woche Richtung 0, faul gerechnet aus `last_move` (§4).

Stufen: ab **20 „bekannt"** (Konzert/Event möglich) · ab **50 „Partner"**
(+10 Punkte Antwortchance bei ihm, zählt für den Türöffner, in 5c
Gegenanfragen) · unter **−20 „verstimmt"** · unter **−50 „Beef"** (Tür zu 5b;
in 5a nur durch wiederholtes Nerven erreichbar).

`yes ≥ 3` **oder** Draht ≥ 50 macht ihn zum Partner – Freischaltungen hängen
ausschließlich an Zusagen, nie an flüchtigen Reaktionen.

## Anzeige

- Neuer Menüeintrag **🤝 Kontakte** (Gruppe wie Musik/Netzwerk).
- **Liste:** Filter *Inland · Meine Sprache · International · Alle*, 5 je
  Seite, Zeile: `🎤 **Apache 207** 🇩🇪 Hip-Hop · 3,2 Mio · Draht ▰▰▱▱▱ 24
  (bekannt) · Chance 31 % · frei in 2 Tagen`. Knöpfe: Filter, Seiten, Home.
- **Kontakt:** Blurb, seine Zahlen, Passung („🇩🇪 deutsch · Hip-Hop · passt zu
  dir: 100 %"), dein Draht mit Stufe, Historie (`tries`/`yes`), vier Knöpfe
  für die Anfragearten mit Chance in Prozent und Zeitkosten (gesperrte
  deaktiviert), zurück zur Liste, Home.
- **Antworttext** im Stil des Charakters, je Stufe eine Zeile aus dem Katalog
  (`lines: { fluechtig: [...], echt: [...], zusage: [...], nein: [...] }` je
  Charakterzug, nicht je Kontakt – fünf Charaktere × vier Stufen × drei
  Varianten).
- Musik- und Creator-Ansicht zeigen einen aktiven Schub in der bestehenden
  „⏳ Heute"-Zeile („🤝 Feature mit Apache 207 – wirkt auf die nächste
  Veröffentlichung, noch 41 h").

## §3, Messung, Tests

**§3:** Kein neuer Zufluss. Jeder Schub ist ein Faktor auf eine bestehende
Aktion, deren Decke (Sprache, Szene, Plattform, Markt) unverändert gilt; Geld
entsteht weiter nur über Tantiemen, Werbung, Gagen. Die Obergrenze des
Zusatznutzens ist damit `Faktor × bestehende Decke` **für eine Aktion**, nicht
dauerhaft. Gemessen wird ein Jahreslauf Musik+Creator mit und ohne
Kontaktpflege (gleicher Würfel, 2 h/Tag in Kontakte statt in eine Aktion);
erwartet wird ein Zuwachs im niedrigen zweistelligen Prozentbereich, keine
Verdopplung – sonst werden `0,6 ×` in der Basis oder die Faktoren gesenkt und
neu gemessen.

**Tests** (`test/contacts.test.js`): Abdeckungsregeln des Katalogs;
Handrechnungen der Chance für 1:1, 1:10, 1:100, 1:1000, je mit und ohne
Sprach-/Genre-Passung und mit Draht ±50; Stufenverteilung über 10.000 Würfe
(Erwartungswerte ±2 %); Passung (deutscher Rapper für J-Pop-Act: Chance und
Wirkung ≈ 5 %); Zeit wird auch bei „ignoriert" gebucht; Sperren 3/7 Tage;
Draht-Bewegung und Abklingen über Wochen; Schub verfällt, stapelt nicht, wird
beim Verbrauch gelöscht und wirkt genau einmal; Freischaltung erst ab drei
Zusagen oder Draht 50; Konzert-Anfrage erst ab Draht 20.

**Docs:** ARCHITEKTUR §15 (Kontakte als Reichweiten-Hebel mit Messzahl),
Patchnotes 1.39.0, Menüeintrag in der Registry.

---

## Addendum nach der Messung (2026-09-25)

Gemessen wurde wie in „§3, Messung, Tests" vorgesehen: ein Jahreslauf
Musik+Creator mit und ohne Kontaktpflege, gleicher Würfel, 2 h/Tag in Kontakte
statt in eine Aktion – dazu derselbe Vergleich für den reinen Creator.
Aufruf, Aufbau, Handrechnung und Rohausgabe stehen in
`docs/messungen/2026-09-25-kontakte.txt`; der Abschnitt im Messskript heißt
`--nur=kontakte`.

**Das Ergebnis widerspricht der Erwartung der Spec – in die andere Richtung.**
Erwartet war „ein Zuwachs im niedrigen zweistelligen Prozentbereich".
Gemessen (10 Läufe à 365 Tage, Median je Tag):

| | ohne Kontakte | mit Kontakten | Differenz |
|---|---|---|---|
| Musik + Creator | 372.788/Tag | 341.705/Tag | **−8,3 %** (gepaart je Seed −8,0 %) |
| nur Creator | 334.254/Tag | 318.203/Tag | **−4,8 %** (gepaart je Seed −1,8 %) |

**Mit der Streuung gelesen, nicht ohne sie.** Je Seed reicht die Spanne von
−24,2 % … +12,7 % (Musik+Creator) und −25,0 % … +26,9 % (nur Creator); die
Richtung stimmt in 7 von 10 bzw. 6 von 10 Seeds. Für Musik+Creator ist der
Befund damit stabil, **beim reinen Creator liegt er im Rauschen** – dort sagt
diese Messung nicht „Kontakte kosten Geld", sondern „hier misst sie nichts
Verlässliches". Dasselbe gilt für jeden Vergleich der drei Varianten
untereinander.

Zusagenquote 7,9 % bzw. 9,6 % aller Anfragen (61,3 % bleiben unbeantwortet);
durchschnittlicher Schubfaktor bei einer Veröffentlichung **mit** Schub 1,30
(größter 2,80), über alle Veröffentlichungen gemittelt 1,05.

**Korrektur an der Messung selbst.** Die erste Fassung hat den simulierten
Spieler jeden Kandidaten mit der Stärke einer *Zusage* bewerten lassen. Das ist
keine neutrale Vereinfachung: Der erwartete Stufenfaktor aus `stufeVon` ist
0,350 beim fernen Weltstar mit Draht 15 und 0,500 auf Augenhöhe, die Regel hat
den Weltstar also um das 1,43-fache überbewertet. Sie kam auf −17,3 % bzw.
−16,2 %; die halbe Differenz war eine Eigenschaft der Bewertungsregel. Jetzt
wird über alle drei Antwortstufen gemittelt, und die Erwartung wird gegen
200.000 Würfe der echten `stufeVon` gehalten (in der Messdatei abgedruckt).

**Konsequenz: Es wurde nichts gesenkt.** Der Auslöser der Spec („liegt es über
+50 %, `0,6` in der Basis oder die Schubfaktoren senken und neu messen") ist
nicht erreicht. Die Basis `0,6` und alle Schubfaktoren stehen unverändert; am
Verhalten des Spiels hat diese Messung nichts geändert.

**Zwei Befunde, die die Spec so nicht vorgesehen hatte:**

1. **Die zwei Stunden sind der ganze Preis.** Sie kosten gezählte 15,0 % der
   Kanalaktionen am Tag (12,56 → 10,68; reiner Creator 16,16 → 15,02, −7,0 %),
   weil der Tag ohnehin an der Energie-Wand endet. Die Musikseite bleibt fast
   unberührt (0,95 Veröffentlichungen am Tag in beiden Läufen); die Differenz
   sitzt in den Followern (2,59 Mio gegen 1,95 Mio) und wächst über das Jahr.
   Kontakte sind damit eine **Ausgabe mit Streuung**, keine Quelle – was §3
   genau so wollte, nur deutlicher als gedacht.

2. **Der Konzert-Schub auf der Creator-Seite ist der kleinste der drei Schübe
   auf seiner Seite – wegen der Draht-Schwelle, nicht wegen der Formel.**
   Die Wirkungstabelle der Spec kennt für `konzert` nur die Musikseite
   („Hörer für die Gage"). `contacts.request` ersetzt den dort wirkungslosen
   Faktor 1 auf der Creator-Seite durch `min(4, 1 + 3 × Stärke)` über 7 Tage –
   sonst wäre ein gemeinsames Event für einen reinen Creator ein Schub ohne
   Wirkung. Gemessen, gleiches gegen gleiches aus demselben Lauf: `creator/
   konzert` Ø **1,05** (größter 1,28) über 511 verbrauchte Schübe gegen
   `creator/reaktion` Ø 1,15 und `creator/feature` Ø 1,10; beim reinen Creator
   Ø 1,04 über 652 gegen 1,15 und 1,10. Die Formel ist Zeichen für Zeichen
   dieselbe wie die von `reaktion` und kann deshalb nicht strukturell schwächer
   sein; der Unterschied kommt von `minDraht: STUFE_BEKANNT` – nur lange
   gepflegte, also kleine Kontakte kommen überhaupt auf die Bühne, und bei
   kleinen Kontakten ist `staerkeOf` klein. Ein Spieler, der nach
   Chance × Nutzen wählt, nimmt sie ohnehin **nie**: Das Feature auf derselben
   Seite hat den größeren Faktor (`1 + 5 × Stärke`) *und* die bessere Chance
   (Schwierigkeit −0,10 gegen −0,20) und verlangt keinen Draht. Die Zahlen
   stammen deshalb aus einem dritten Messlauf, der die Bühne erzwingt, sobald
   sie möglich ist („Konzert-Vorrang" im Messskript).

**Offen für 5b/5c:** Ob die Kontakte eine attraktivere Zeitverwendung werden
sollen, ist eine Balancing-Entscheidung des Nutzers, keine Folge dieser
Messung. Drei Hebel wären möglich, keiner davon ist umgesetzt: die zwei Stunden
senken, die Sperre nach „ignoriert" verkürzen, oder die Wirkung von einer
einzelnen Aktion auf einen Zeitraum ausdehnen – der dritte wäre der einzige,
der die Rangfolge der Geldquellen wirklich verschiebt, und er bräuchte eine
neue Decke (§3).
