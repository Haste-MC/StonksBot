# Beef und Disstracks – Stück 5b

Teil der Kontakte-Reihe (5a Der Draht zu anderen Künstlern · **5b Beef und
Disstracks** · 5c Gegenanfragen und große Formate) · Stand 2026-09-25 ·
Vorgänger: `docs/superpowers/specs/2026-09-25-kontakte-design.md`

## Ziel

Aus dem Kontaktsystem wird eine Bühne für Streit. Man kann andere Künstler
anstacheln, Disstracks gegen sie veröffentlichen, Gegenschläge einstecken und
den Schlagabtausch gewinnen oder verlieren – mit einer Hitze, die eskaliert und
abkühlt, einer Szene, die Partei nimmt, und der Möglichkeit, sich am Ende zu
versöhnen.

Die Richtung des Systems ist eine einzige Regel: **Nach oben treten lohnt und
ist gefährlich, nach unten treten ist billig und blamiert.**

## Nicht-Ziele

- Keine neue Geldquelle. Der Beef zahlt ausschließlich über die vorhandene
  Veröffentlichungsmaschine und über Hype (§3).
- Kein Beef zwischen Spielern. Gegner sind immer Kontakte aus dem Katalog.
- Keine Crews oder Lager im Katalog (keine neuen Beziehungsfelder zwischen
  NPCs) – „die Szene" wird aus Sprache und Genre abgeleitet.
- Kein Disstrack für Creator. Der Creator-Kanal hat kein Format dafür; wer nur
  Kanäle macht, kann angezählt werden und schlucken, aber nicht zurückschlagen.
- Keine dauerhafte Narbe („Ihr habt Geschichte") – ein abgerechneter Beef
  verschwindet aus der Ansicht, sobald sein Bonusfenster durch ist.

## Was heute gilt (gegen den Code geprüft)

- `src/data/music.js`: acht Genres mit einem Feld `risk` (Hip-Hop 1,3 · J-Pop
  1,1 · Pop 1,0 · Rock 0,9 · Metal und Elektro 0,8 · Indie 0,7 · Klassik 0,5);
  vier Veröffentlichungsarten mit `songs`, `spike`, `growth`, `time`
  (Single 1/1,0/1,0/2 · EP 3/2,6/1,5/2 · Album 6/5,5/2,4/3 · Deluxe
  2/1,6/0,7/1).
- `src/music.js`: `publish(guildId, userId, typeId, now, random, { events,
  force, audience })` nimmt bereits einen `audience`-Faktor von außen – der
  Disstrack braucht dafür keinen neuen Weg. `HYPE_MIN 0,6`, `HYPE_MAX 1,7`.
  Charts ab `audience ≥ 1000`. Eine Veröffentlichung kostet aufgenommene Titel
  und teilt sich `RELEASE_COOLDOWN_MIN`.
- `src/contacts.js`: `detail(guildId, userId, contactId, now)` liefert
  `meineReichweite`, `seineReichweite`, `draht`, `stufe`, `gesperrtBis`,
  `partner` und die vier Anfragearten. `chanceOf` ist eine Summandenliste,
  `drahtJetzt` rechnet das Abklingen faul (§4). Stufen: ab 20 bekannt, ab 50
  Partner, unter −20 verstimmt, unter **−50 Beef**.
- `src/data/contacts.js`: 74 Kontakte mit `language`, `country`, `genre`,
  `platform`, `reach`, `reachCreator`, `trait`; `TRAIT_BONUS` für die
  Antwortchance; `RELATED_GENRES` als Liste verwandter Paare.

## Architektur

Neues Modul **`src/beef.js`**, zweigeteilt wie `src/contacts.js`: oben die
reinen Rechnungen (kein Zufall außer dem hereingereichten, keine Datenbank),
unten der Zustand. Die Zahlen und Schwellen stehen in **`src/data/beef.js`**.

`beef.js` liest seinen Kontext über `contacts.detail(...)` und bewegt den Draht
ausschließlich über eine neue Funktion `contacts.moveDraht(guildId, userId,
contactId, delta, now)` – der Draht wird an genau einer Stelle geschrieben.
Umgekehrt fragt `contacts.chanceOf` über `beef.szeneMalus(...)` nach dem
Szenen-Malus und `contacts.detail` über `beef.offenerBeef(...)` nach dem Grund
`beef`. Alle Richtungen laufen über spät gebundene `require` (§8).

**Die Beef-Aktionen stehen NICHT in `data/contacts.js REQUESTS`.** Diese Liste
hat vier Einträge, ihre Chance-Rechnung ist die Kooperationsrechnung aus 5a,
und `test/contacts.test.js:53` und `:179` halten das fest. Anstacheln und
Frieden bekommen darum ihre eigene Liste `BEEF_AKTIONEN` in `src/data/beef.js`
mit derselben Form (`id`, `name`, `emoji`, `time`) – ihre Auflösung ist ohnehin
eine andere.

**Wer orchestriert:** `beef.anstacheln`, `beef.diss`, `beef.frieden` und
`beef.settle` sind die vier Eingänge. `beef.diss` ist der Dirigent des
Disstracks: Wirkung rechnen → `music.publish(…, 'diss', …, { audience })` →
Zustand schreiben. `music.publish` selbst kennt den Beef nur an drei Stellen:
es lehnt `diss` ohne offenen Beef ab (`reason: 'kein_beef'`, damit ein alter
Knopf nichts kaputt macht), es nimmt den Hype-Bonus aus `beef.bonusOf(...)`
entgegen, und es würfelt nach einer Chart-Platzierung über `beef.anzaehlen(...)`.

Häme und Gegenschlag brauchen dieselbe Wirkung auf den Künstler – Hype mal
einem Faktor, ein Anteil der Hörer weg. Dafür gibt es **eine** Funktion
`music.applyBeefTreffer(guildId, userId, { hype, hoererAnteil }, now)`, die
beide Aufrufer benutzen; `beef.js` schreibt die Künstlerzeile nicht selbst.

## Der Zustand: Hitze und Runden

Tabelle `beefs`:

```
beefs (
  guild_id TEXT, user_id TEXT, contact_id TEXT,
  hitze REAL, runden_ich INTEGER, runden_er INTEGER,
  last_hit INTEGER, last_cool INTEGER, konter_at INTEGER,
  angefangen INTEGER, status TEXT, bonus_until INTEGER,
  PRIMARY KEY (guild_id, user_id, contact_id)
)
```

`status` ist `offen` · `sieg` · `niederlage` · `unentschieden` · `frieden`.

**Hitze 0–100** ist die Uhr des Beefs:

| Ereignis | Hitze |
|---|---|
| Anstacheln, er steigt ein (`HITZE_ANSTACHELN`) | +25 |
| Er zählt dich an (`HITZE_ANGEZAEHLT`) | +25 |
| Dein Disstrack (`HITZE_DISS`) | +30 |
| Sein Gegenschlag (`HITZE_KONTER`) | +30 |
| Abkühlung (`HITZE_COOL_PRO_TAG`) | −6 je Tag |

Die Abkühlung wird faul gerechnet (§4): `hitzeJetzt(row, now)` zieht aus
`last_cool` ab und schreibt nichts. Geschrieben wird sie nur, wenn sowieso
etwas anderes geschrieben wird.

Gedeckelt bei 100. Bei **Hitze ≤ 0 ist der Beef vorbei** und wird abgerechnet.

Höchstens **zwei offene Beefs** gleichzeitig (`BEEFS_MAX = 2`). Ein dritter
Versuch wird mit `zu_viele` abgelehnt.

## Anstacheln

Erster Eintrag in `BEEF_AKTIONEN` (`src/data/beef.js`): `{ id: 'anstacheln',
name: 'Anstacheln', emoji: '🔥', time: 2 }`. Sie läuft **nicht** durch
`contacts.request`, sondern durch `beef.anstacheln(guildId, userId, contactId,
now, random)`; die Reihenfolge der Prüfungen ist dieselbe wie in 5a: Kontakt
unbekannt → Seite fehlt (nur Musiker) → schon ein Beef mit ihm offen → zu viele
Beefs → Sperre → **Zeit buchen (2 h, auch wenn er nicht einsteigt)** → Wurf →
ein Schreibvorgang.

Die Einstiegschance ist die Umkehrung der Antwortchance aus 5a. Beim Feature
fragt man um einen Gefallen, hier um Streit – und da rechnet der andere
kaufmännisch:

```
v        = log10(max(100, meine) / max(1, seine))
einstieg = clamp(0,02, 0,95, 0,55 + 0,25 × v + BEEF_TRAIT[charakter])
```

Von Hand nachgerechnet, ohne Charakterzug: auf Augenhöhe (`v = 0`) **55 %** ·
er zehnmal größer (`v = −1`) **30 %** · hundertmal größer **5 %** · tausendmal
größer **2 %** (Untergrenze) · er zehnmal kleiner **80 %** · hundertmal kleiner
**95 %** (Obergrenze).

`BEEF_TRAIT` – beim Streit zählen andere Züge als beim Gefallen:

| Charakter | Einstieg |
|---|---|
| arrogant | +0,20 |
| launisch | +0,15 |
| kuehl | −0,05 |
| kollegial | −0,25 |
| geschaeftlich | −0,10 + 0,20 × clamp(0, 1, meine/seine) |

Der geschäftliche steigt also nur ein, wenn du groß genug bist, dass es sich
für ihn rechnet: gleich groß oder größer +0,10, winzig −0,10.

**Das Genre spielt beim Einstieg keine Rolle.** Er entscheidet nach Größe und
Charakter, nicht nach deiner Sparte. Das Genre wirkt auf die Wirkung und auf
die Häme – dort, wo das Publikum urteilt.

**Steigt er nicht ein, ist es eine Blamage:** Draht −5, Hype × 0,95 (einmalig,
sofort), die zwei Stunden sind weg, und der Kontakt ist wie in 5a drei Tage
dicht. Steigt er ein: Beef mit Hitze 25, Draht −15, Runden 0:0.

## Der Disstrack

Fünfte Veröffentlichungsart in `src/data/music.js`:

```js
{ id: 'diss', name: 'Disstrack', emoji: '🔥', songs: 1, spike: 3.0,
  growth: 0.4, time: 2, blurb: 'Viel Lärm, wenig Bleibendes – und alle hören hin.' }
```

Spike 3,0 schlägt härter ein als eine Single (1,0), Growth 0,4 hält weniger als
jede andere Art. Der Disstrack ist nur wählbar, wenn ein Beef offen ist; das
Ziel ist der Gegner (`beef.zielFor`). Ohne offenen Beef antwortet `publish` mit
`reason: 'kein_beef'`.

Obendrauf kommt die **Aufmerksamkeit**, in derselben Form wie die Stärke in 5a:

```
wucht          = clamp(0, 1, log10(1 + seine / max(100, meine)) / 3)
genrefaktor    = genre.risk / 1,3
aufmerksamkeit = 1 + 1,5 × wucht × genrefaktor × (0,5 + 0,5 × hitze/100)
```

Von Hand: tausendmal größerer Gegner, Hip-Hop, Hitze 100 → `wucht = 1,0`,
`genrefaktor = 1,0` → **×2,5**. Derselbe Gegner bei Hitze 25 → ×1,94. Gegner
auf Augenhöhe, Hip-Hop, Hitze 100 → `wucht = 0,1004` → ×1,151. Gegner auf
Augenhöhe in Klassik (`genrefaktor = 0,3846`) bei Hitze 100 → ×1,058.

Die Aufmerksamkeit wird als `audience`-Faktor an `publish` übergeben – derselbe
Weg, den Ereignisse und der Schub aus 5a schon nehmen.

**Häme, wenn du nach unten trittst:**

```
haeme = clamp(0, 0,6, log10(max(1, meine / max(1, seine))) / 3
                      + 0,2 × (1 − genrefaktor))
```

Von Hand: gleich groß, Hip-Hop → 0 % · du zehnmal größer, Hip-Hop → 33,3 % ·
du hundertmal größer → 60 % (die Obergrenze greift ab dem 63-fachen) · gleich
groß, Klassik → 12,3 % · du zehnmal größer, Klassik → 45,6 % · du tausendmal
größer → 60 % in jedem Genre.

Bei Häme wird statt der Aufmerksamkeit der Faktor **0,5** an `publish`
übergeben, und danach setzt `music.applyBeefTreffer(..., { hype: 0,8,
hoererAnteil: 0,02 })` den Rest: Hype × 0,8 und 2 % der Hörer weg. **Die Runde
geht an ihn.** Ohne Häme holt der Disstrack die Runde für dich.

In jedem Fall: Hitze +30, Draht −20, ein aufgenommener Titel und die normale
Veröffentlichungssperre.

## Sein Gegenschlag

Beim Disstrack wird `konter_at = now + 1…3 Tage` gewürfelt und gespeichert.
`beef.settle(guildId, userId, now)` rechnet ihn faul ab (§4), sobald jemand
hinschaut oder handelt, und genau einmal je Schlag (`konter_at` wird danach auf
0 gesetzt, §9). Er schlägt nur zurück, wenn die Hitze zu diesem Zeitpunkt noch
**≥ 40** ist (`HITZE_KONTER_MIN`) – wer kurz vor dem Ende noch einen raushaut,
hat Glück gehabt.

Seine Wucht ist dieselbe Rechnung: `wucht = clamp(0, 1, log10(1 + seine /
max(100, meine)) / 3)`.

- `music.applyBeefTreffer(..., { hype: 1 − 0,25 × wucht, hoererAnteil: 0,10 ×
  wucht })` – bei einem tausendmal Größeren also Hype × 0,75 und 10 % der Hörer
  weg, bei einem gleich Großen Hype × 0,975 und 1 % der Hörer
- Hitze +30, Draht −10
- **Die Runde geht an ihn, außer `wucht < 0,2`** – ein Konter von jemandem, der
  weit kleiner ist als du, wirkt lächerlich, und die Runde bleibt bei dir.

## Angezählt werden

Auslöser ist eine Veröffentlichung, die chartet (`position > 0`): Wurf
`ANZAEHL_CHANCE = 0,06`. Auch völlig Fremde kommen in Frage – wer groß wird,
zieht Feinde an. Gewichtet wird über den ganzen Katalog:

```
gewicht = genrenaehe × groessennaehe × (1 + max(0, BEEF_TRAIT_BASIS[charakter]))
genrenaehe    = gleiches Genre 3 · verwandt 2 · sonst 1
groessennaehe = 1 / (1 + |log10(max(1, seine) / max(100, meine))|)
```

`BEEF_TRAIT_BASIS` ist `BEEF_TRAIT` ohne den größenabhängigen Teil des
geschäftlichen Zuges, damit die Gewichtung eine reine Rechnung bleibt.
Kontakte, mit denen schon ein Beef offen ist, und Partner (Draht ≥ 50) fallen
heraus; bei zwei offenen Beefs passiert nichts.

Wer angezählt wird, steht bei **Hitze 25 und 0:1 hinten**, Draht −10. Man kann
antworten (Disstrack) oder schlucken – Schlucken kostet nichts, aber die Hitze
kühlt ab und der Beef endet dann als **Niederlage**, weil er die Runde hat.

## Die Szene macht dicht

Solange ein Beef offen ist, wird jeder Kontakt schwieriger, der zur Szene des
Gegners gehört – **gleiche Sprache und gleiches Genre** wie er (oder er selbst):

```
szeneMalus = −0,15 × hitze/100
```

Das ist ein weiterer Summand in `contacts.chanceOf`, gedeckelt wie alle
anderen durch `CHANCE_MIN 0,02`. Bei zwei offenen Beefs zählt der **größte**
Malus, nicht die Summe – sonst könnte man sich selbst vollständig aussperren.

## Ende, Sieg, Versöhnung

Bei Hitze ≤ 0 rechnet `beef.settle` ab: `runden_ich > runden_er` → `sieg`,
`<` → `niederlage`, `=` → `unentschieden`. `bonus_until = now + 7 Tage`.

| Ende | Wirkung, 7 Tage lang |
|---|---|
| Sieg | Hype × 1,25 |
| Niederlage | Hype × 0,85 |
| Unentschieden | nichts |
| Frieden | nichts |

`beef.bonusOf(guildId, userId, now)` gibt den Faktor des **jüngsten**
abgerechneten Beefs zurück, dessen Fenster noch läuft – gestapelt wird nie
(wie der Schub in 5a). Er wirkt auf den Hype in `music.publish` und
`music.show` und ist durch `HYPE_MAX 1,7` gedeckelt. Kein Geld, keine Decke.

**Versöhnung** ist der zweite Eintrag in `BEEF_AKTIONEN`: `{ id: 'frieden',
name: 'Frieden anbieten', emoji: '🕊️', time: 2 }`, möglich sobald die Hitze
unter 30 liegt (auch nach dem Ende, solange die Zeile steht):
`beef.frieden(...)` kostet zwei Stunden, setzt `status: 'frieden'`, löscht
Bonus und Malus und hebt den Draht:

```
draht = min(−10, draht + 30)
```

Der Deckel bei −10 ist der Punkt: Aus dem größten Feind kann der größte
Verbündete werden, aber Beef anfangen und sofort Frieden schließen ist **keine
Abkürzung zum Partner** – der Draht springt nie ins Plus, und der Weg dorthin
ist genauso lang wie ohne Beef.

## Anzeige

- **Kontaktansicht des Gegners:** Zeile „🔥 **Beef** · Hitze 62 ▰▰▰▰▱ · Runden
  2:1 · sein Konter kommt in 14 h". Die vier Kooperations-Knöpfe sind
  deaktiviert mit dem neuen Grund `beef` („❌ Solange der Beef läuft, nicht.").
  Neue Knöpfe: **🔥 Disstrack** (nur bei offenem Beef und genug Titeln) und
  **🕊️ Frieden anbieten** (nur bei Hitze < 30). Ohne Beef steht dort
  stattdessen **🔥 Anstacheln** mit der Einstiegschance im Label.
- **Der Disstrack lebt in der Kontaktansicht, nicht in der Musikansicht.** Dort
  ist das Ziel eindeutig, und der Reaktionshaushalt der Musikansicht (§16,
  `MAX_REACTIONS 9`) bleibt unberührt. Die Musikansicht bekommt nur eine
  Hinweiszeile „🔥 Beef mit *Name* · Hitze 62 – ein Disstrack wartet".
- **Kontaktliste:** 🔥 statt 🔒 bei laufendem Beef, Sortierung wie bisher.
- **Meldungen:** Anstacheln (Einstieg oder Blamage, mit dem Ton des Kontakts),
  Disstrack (Aufmerksamkeit oder Häme), der Gegenschlag beim nächsten
  Hinschauen, und die Abrechnung („🔥 Der Beef mit *Name* ist durch: 2:1 für
  dich. Die Straße redet – sieben Tage lang.").
- **Texte** wie in 5a je Charakterzug, alles Spielfiktion: Musik, Zeilen,
  Termine. Keine Aussagen über die wirkliche Welt und keine Beleidigungen, die
  außerhalb des Spiels stehen könnten – der Disstrack ist eine Veröffentlichung
  im Spiel, kein Kommentar über eine reale Person.

## §3, Messung, Tests

**Warum das kein Geldrucker ist:** Der Disstrack ist eine Veröffentlichung mit
dem **niedrigsten Growth im Spiel** (0,4 gegen 1,0 einer Single). Die
Aufmerksamkeit ist ein Spike auf das Publikum einer einzelnen
Veröffentlichung – die Hörer, die bleiben, hängen an `growth`, nicht am Spike.
Der Sieg zahlt nur über Hype, und Hype ist bei 1,7 hart gedeckelt. Kein
`unb`-Aufruf in `src/beef.js` oder `src/data/beef.js`.

**Messung** (`scripts/messung-geldquellen.js --nur=beef`, in der Form des
Kontaktlaufs aus 5a): zwei Archetypen – **Musik+Creator** und **nur Musik**,
weil der reine Creator keinen Disstrack hat – je zwei Varianten mit demselben
gesäten Würfel: einmal wie bisher, einmal mit Beef-Spielweise (anstacheln,
sobald keiner offen ist; Disstrack, sobald ein Titel da und die Sperre durch
ist). Ausgegeben werden Median/Tag beider Varianten, die Differenz in Prozent,
die Einstiegsquote, die Häme-Quote, die Siegquote und der durchschnittliche
Aufmerksamkeitsfaktor. Erwartung: eine Umverteilung, kein Zuwachs. **Liegt die
Differenz über +25 %, wird `DISS_AUFMERK` (1,5) gesenkt und neu gemessen** –
das steht dann im Messbericht. Die Decken der Archetypen werden neu gerechnet
und in §15 fortgeschrieben.

**Tests** (`test/beef.test.js`, ohne Netz, §12):

- Rein: Einstiegschance an allen sechs handgerechneten Punkten · `BEEF_TRAIT`
  inklusive des größenabhängigen geschäftlichen Zuges · `wucht`,
  `aufmerksamkeit` und `haeme` an den oben nachgerechneten Werten · Abkühlung
  über zwei Tage · Rundenlogik in allen vier Fällen (Diss mit und ohne Häme,
  Konter mit `wucht` über und unter 0,2).
- Zustand: Zeit wird auch bei der Blamage gebucht und **vor** jedem Schreiben ·
  Sperre 3 Tage · `BEEFS_MAX` · Konter genau einmal je Schlag und nur ab Hitze
  40 · Abrechnung in allen drei Ausgängen · `bonusOf` stapelt nicht und nimmt
  den jüngsten · Versöhnungsdeckel bei −10 aus zwei Richtungen · Szenen-Malus
  greift nur bei gleicher Sprache **und** gleichem Genre und nimmt bei zwei
  Beefs den größten.
- Angezählt: die Gewichtung schließt offene Beefs und Partner aus, und bei
  zwei offenen Beefs passiert nichts.
- Anzeige (`test/fluxer-render.test.js`): Beef-Zeile, deaktivierte
  Kooperations-Knöpfe mit Grund `beef`, Disstrack-Knopf nur bei offenem Beef,
  Friedensknopf nur unter Hitze 30, `overflow === undefined` in beiden neuen
  Zuständen der Kontaktansicht.

## Addendum nach der Messung (2026-09-26)

Gemessen mit `scripts/messung-geldquellen.js --nur=beef`; die vollständige
Ausgabe, der Aufbau und eine von Hand nachgerechnete Einzelprüfung stehen in
`docs/messungen/2026-09-26-beef.txt`. Drei Läufe: `10 365 --nur=beef` und
zweimal derselbe Lauf mit `--diss-aufmerk=0.75` bzw. `--diss-aufmerk=0`.

**Die Zahlen** (10 Läufe à 365 Tage, fester Würfel, Beefwürfe auf einem eigenen
Strom; „wie bisher" ist der Lauf ohne jeden Beef, „passiv" derselbe Spieler, der
angezählt wird und nie antwortet):

| | Musik+Creator | nur Musik |
|---|---|---|
| wie bisher | 372.788/Tag | 104.965/Tag |
| passiv (angezählt, nie geantwortet) | 309.694 (−16,9 %, gepaart −14,1 %) | 75.051 (−28,5 %, gepaart −23,4 %) |
| Beef-Spielweise | 376.192 (+0,9 %, gepaart −0,6 %) | 112.427 (+7,1 %, gepaart +15,4 %) |
| Beef-Spielweise gegen passiv | +21,5 % (gepaart +15,5 %) | +49,8 % (gepaart +55,1 %) |
| Kontrolle: ohne Beef, Album statt Single | 2.590.231 (+594,8 %) | 2.806.466 (+2573,7 %) |

Einstiegsquote 25,0 % bei Ø gewürfelter Chance 21,1 % · Häme-Quote 28,2 % ·
Siegquote **0,0 %** über 718 Abrechnungen · Ø Aufmerksamkeitsfaktor über alle
Disstracks **0,908** (unter 1, weil die Häme-Fälle fest 0,50 zahlen) · Ø Wucht
0,051 · Disstracks 0,95/Tag = 98,9 % aller Veröffentlichungen · Kosten an
Aktionen 12,56 → 12,52 am Tag, Hörer 587.277 → 114.390, Hype 1,14 → 0,86.

**Die Erwartung der Spec ist eingetreten:** eine Umverteilung, kein Zuwachs. Die
Beef-Spielweise ist gegen „wie bisher" bei Musik+Creator nicht von null zu
unterscheiden (5 von 10 Seeds im Plus); was messbar bleibt, ist der Preis des
Aussitzens. (Das gilt für DIESE Spielweise. Zwei andere, die dieser Lauf nicht
gefahren hat, verhalten sich anders – siehe **Addendum 2** unten.)

**`DISS_AUFMERK` wurde NICHT gesenkt.** Der Auslöser des Plans („über +25 %")
ist gegen „wie bisher" mit +15,4 % nicht erreicht. (Für zwei Spielweisen, die
dieser Lauf nicht gefahren hat, ist er erreicht – **Addendum 2** unten; gesenkt
wurde `DISS_AUFMERK` trotzdem nicht, weil es dort messbar nicht das Stellrad
ist.) Gesenkt und neu gemessen
wurde trotzdem, weil die Differenz gegen den passiven Spieler darüber liegt:
Bei 0,75 steigt sie sogar (nur Musik gepaart +22,5 % gegen „wie bisher" statt
+15,4 %), und bei 0,00 – Aufmerksamkeit konstant 1,0 – liegt die Spielweise noch
+22,4 % bzw. +40,6 % über dem passiven Spieler. Der Faktor ist bei dieser
Streuung kein Stellrad. Was den Unterschied trägt, ist der
Veröffentlichungsplatz: `spike` 3,0 des Disstracks gegen 1,0 der Single, und
`spike` zählt im Buzz zweimal (`audience` und `buzz = audience × 9 × spike`).

**Vier Stellen, an denen die Spec ergänzt oder widerlegt wurde:**

1. **Der §3-Satz der Spec ist zu kurz.** „Die Hörer, die bleiben, hängen an
   `growth`, nicht am Spike" stimmt so nicht: Der Spike trägt den Buzz, Buzz wird
   zum selben Satz je Abruf bezahlt wie die stetigen Hörer, und die gewonnenen
   Hörer sind `audience × … × growth`, also ebenfalls vom Spike abhängig. Dass
   der Disstrack trotzdem kein Geldrucker ist, liegt nicht an seinem `growth`,
   sondern daran, dass ihm eine bessere Veröffentlichung gegenübersteht: Die
   Kontrollvariante „Album statt Single" verdient das Sechs- bzw.
   Sechsundzwanzigfache, ganz ohne Beef.
2. **Die Aufmerksamkeit ist in der Praxis ein Abzug, kein Gewinn.** Der
   Spec-Fall (×2,5 gegen einen tausendmal Größeren bei voller Hitze) kommt für
   einen gewachsenen Spieler nicht vor: Ø Wucht 0,051, Häme in 28,2 % der Fälle,
   Ø Faktor 0,908. Die Formel ist unverändert richtig, ihr Anwendungsbereich war
   zu optimistisch beschrieben.
3. **Das Bonusfenster hat in DIESER Messung nie einen Sieg ausgezahlt** (in der
   Spielweise des Nachtrags 5c schon – Addendum 2, Punkt 2)**.** Alle 718
   Abrechnungen gingen 0:1 aus, und keine abgerechnete Front war eine, in die der
   Spieler einen Disstrack gesteckt hatte: `zielFor` nimmt die heißeste Front,
   und wer sie täglich auf `HITZE_MAX` hält, rechnet sie nie ab; abgerechnet wird
   die zweite, unbeachtete Front aus `anzaehlen` – mit 0:1. Das ist keine
   Abweichung im Code (die Spec beschreibt beide Teile korrekt), aber eine Lücke
   in der Spec: Sie hat den Fall „zwei Fronten, eine davon dauerhaft heiß" nicht
   durchdacht. `BONUS_SIEG` 1,25 ist damit in 2 × 3.650 simulierten Tagen nicht
   ein Mal wirksam geworden.
4. **Drei Ergänzungen im Code, die die Spec nicht nennt** (alle aus Stück 2 und 3,
   an ihrer Stelle im Code begründet): `settle` läuft als Schritt 0 jeder
   Beef-Aktion und in `music.publish`/`music.show`, damit die faule Abrechnung
   (§4) nicht verloren geht; `anstacheln` lehnt mit dem neuen Grund `zu_frisch`
   ab, solange das Bonusfenster eines abgerechneten Beefs mit demselben Kontakt
   noch läuft (die Tabelle hat nur eine Zeile je Kontakt, ein neuer Beef würde
   den eben verdienten Bonus mitreißen); und `anzaehlen` schließt dieselben
   frischen Kontakte aus demselben Grund aus. Zahlen wurden dabei keine geändert:
   `src/data/beef.js` steht unverändert auf den Werten dieser Spec.

**Eine Anmerkung zum §3-Nachweis in den Tests:** Die §3-Prüfung in
`test/musicEvents.test.js` („mit Ereignissen: Median höchstens 10 % über ohne")
ist einseitig – sie deckt genau das ab, was ihre Beschriftung sagt (eine
Obergrenze, keine Bandbreite), und würde einen Einbruch nach unten nicht
bemerken. Für den Beef ist das ohne Folgen, weil dieser Test keinen Beef fährt;
der Nachweis für 5b ist die Messung oben, und dort steht der Einbruch nach unten
ausdrücklich in der Tabelle (passiver Spieler). Geändert wurde die Prüfung
nicht: Sie hält, was sie behauptet, und eine zweite Schranke ohne eine gemessene
Grundlage wäre eine geratene Zahl.

## Addendum 2 nach dem Nachtrag 5c (2026-09-26)

Dasselbe Skript, dieselben Seeds, dieselbe Strategie – zwei Varianten mehr:
`node scripts/messung-geldquellen.js 10 365 --nur=beef` fährt jetzt sechs
Varianten je Archetyp. Die vollständige Ausgabe steht als eigener Abschnitt
(„Nachtrag 5c") in `docs/messungen/2026-09-26-beef.txt`; die vier Varianten des
ersten Addendums sind dort Zeile für Zeile unverändert (geprüft: 96 von 96
committeten Zeilen zeichengleich, in allen drei Läufen).

**Warum es den Nachtrag gibt.** Die Zahl des ersten Addendums (+0,9 % / +7,1 %)
ist das **Netto** aus zwei neuen Wirkungen, die sich aufheben: dem Gewinn des
Disstracks und dem Verlust aus den Niederlagen-Fenstern, die `anzaehlen`
nebenbei aufmacht und die die gemessene Spielweise nie beantwortet. Sie
beantwortet damit keine der zwei Fragen, die §3 stellt. Zwei Spielweisen füllen
die Lücke:

| gegen „ohne Beef" | Musik+Creator | nur Musik |
|---|---|---|
| `diss-isoliert` (`anzaehlen` auf BEIDEN Seiten still) | 408.312/Tag (+9,5 %, gepaart +14,3 %, 9/10 Seeds) | 134.570 (+28,2 %, gepaart **+45,5 %**, 8/10) |
| `sieg-farm` (ein Disstrack je Front, dann auskühlen) | 407.082/Tag (+9,2 %, gepaart +14,4 %, 7/10) | 169.188 (**+61,2 %**, gepaart **+75,5 %**, **10/10**) |

1. **Der Disstrack allein ist mehr wert als das erste Addendum gemessen hat.**
   `diss-isoliert` unterscheidet sich von der Grundlage in genau einer Sache:
   „Disstrack statt Single". Die Grundlage ist dabei unverändert „ohne Beef" – in
   ihr ist `anzaehlen` seit dem ersten Lauf ebenfalls stillgelegt, beide Seiten
   würfeln dort nicht. Gegen „aktiv" gerechnet liegt `diss-isoliert` +8,5 %
   (gepaart +12,2 %) bzw. +19,7 % (gepaart +5,9 %) darüber – das ist der Preis
   der Anzähl-Fenster. Bezahlt wird nicht mit Zeit (12,56 → 12,50
   Kanalaktionen, 0,95 → 0,97 Veröffentlichungen), sondern mit Hörern und Hype
   (112.450 bzw. 132.454 Hörer, Ø Hype über alle Tage 0,97 gegen 1,12 bzw.
   1,13). Der Disstrack belegt weiter 98,9 % aller Veröffentlichungen, die
   Häme-Quote liegt bei 30,8 % bzw. 32,1 %, der Ø Aufmerksamkeitsfaktor bei
   0,891 bzw. 0,879. **Abrechnungen: 0** – die einzige Front wird täglich auf
   `HITZE_MAX` gehalten und kühlt nie aus, `BONUS_SIEG` und `BONUS_NIEDERLAGE`
   sind in dieser Variante also beide wirkungslos. Genau deshalb ist sie die
   saubere Messung des Veröffentlichungsplatzes.

2. **Punkt 3 des ersten Addendums ist bestätigt UND eingegrenzt: Die Null war
   die Spielweise.** `sieg-farm` wählt ihr Ziel so, dass `wuchtOf` unter 0,19
   bleibt (95 % von `KONTER_LAECHERLICH`, damit sein Gegenschlag die Runde für
   *mich* holt) und `haemeOf` minimal ist, setzt GENAU EINEN Disstrack und lässt
   die Front dann auskühlen. Ergebnis: **Siegquote 65,4 %** bzw. **67,3 %** über
   393 bzw. 385 Abrechnungen; von den eigenen, bedissten Fronten gingen **257 von
   266** bzw. **259 von 268** als Sieg aus. Die Lücke der Spec („zwei Fronten,
   eine davon dauerhaft heiß") bleibt eine Lücke – aber `BONUS_SIEG` 1,25 ist
   nicht wirkungslos, sondern in der Spielweise, die ihn sieht, der **stärkste
   Beef-Effekt der ganzen Messung**: Ø Hype im Siegfenster 1,472 bzw. 1,488 mit
   größtem Wert genau 1,700 = `HYPE_MAX`, gegen 1,153 bzw. 1,170 an Tagen ohne
   Fenster; Hörer am Jahresende 703.896 bzw. 770.662 gegen 587.277 bzw. 579.842
   ohne Beef. Sie kostet dabei fast nichts (12,23 Kanalaktionen, 0,95
   Veröffentlichungen, Disstracks 8,2 % der Veröffentlichungen) und ist die
   einzige Variante mit einem Ø Aufmerksamkeitsfaktor über 1 (**1,079**), weil
   sie nie nach unten tritt (Ø Wucht 0,146, Häme-Quote 3,5 % statt 30,8 %).

3. **Neu und in der Spec nicht vorgesehen: `haemeOf` klemmt nur in Hip-Hop auf
   0.** `Math.max(1, meine / seine)` klemmt das GRÖSSENVERHÄLTNIS bei 1, nicht
   den Logarithmus bei 0. Der erste Summand verschwindet damit bei jedem Gegner,
   der mindestens so groß ist wie ich, der Genre-Summand
   `0,2 × (1 − genrefaktor)` bleibt aber stehen. Für den Pop-Künstler der Messung
   ist der Boden **0,0462** (gemessen in allen sechs Blöcken als gewählte
   Wahrscheinlichkeit, gewürfelt 3,5 % Häme). Aus den Konstanten gerechnet – eine
   Herleitung, keine Messung – ist er 0,2 × (1 − risk/1,3): Hip-Hop 0 · Japanpop
   0,0308 · Pop 0,0462 · Rock 0,0615 · Elektro und Metal 0,0769 · Indie 0,0923 ·
   Klassik 0,1231. Ein hämefreier Disstrack ist also eine Hip-Hop-Eigenschaft.
   Die Formel ist unverändert; nur die Beschreibung („wer nach unten tritt, wird
   ausgelacht") legte nahe, dass es nach oben hin gar kein Risiko gibt.

4. **Der Auslöser des Plans ist für den reinen Musiker erreicht – und
   `DISS_AUFMERK` erreicht das Ziel nicht.** Gegen „ohne Beef", je Seed gepaart,
   in den drei Läufen 1,50 / 0,75 / 0,00:

   | | Musik+Creator | nur Musik |
   |---|---|---|
   | `diss-isoliert` | +14,3 % / +7,4 % / +3,7 % | **+45,5 % / +45,9 % / +26,3 %** |
   | `sieg-farm` | +14,4 % / +8,8 % / +15,2 % | **+75,5 % / +57,1 % / +71,2 %** |

   Für Musik+Creator ist die Schwelle in keiner der neun Zahlen erreicht, für nur
   Musik in allen. Bei `DISS_AUFMERK` **0,00** – Aufmerksamkeit konstant 1,0 –
   liegt `diss-isoliert` noch bei +26,3 % und `sieg-farm` bei +71,2 %. Der Faktor
   bewegt `diss-isoliert` (nicht monoton), aber er bringt es nicht unter die
   Schwelle, und `sieg-farm` bewegt er überhaupt nicht: Deren Zuwachs kommt über
   `BONUS_SIEG` am Hype, nicht über die Aufmerksamkeit. **`src/data/beef.js`
   steht unverändert auf `DISS_AUFMERK` 1,5**; die drei Läufe haben den Wert nur
   über die Kommandozeile überschrieben. Was gesenkt wird – und ob – ist eine
   Balancing-Entscheidung des Besitzers; die Messung sagt nur, welche Zahl es
   nicht tut. Die sichtbaren Hebel wären `spike` 3,0 des Disstracks
   (`src/data/music.js`, zusammen mit dem täglichen Veröffentlichungsplatz) für
   `diss-isoliert` und `BONUS_SIEG` 1,25 / `HYPE_MAX` 1,7 / `BONUS_TAGE` 7 für
   `sieg-farm`.

5. **Was auch jetzt nicht gemessen ist:** der Spieler, der Frieden anbietet; die
   Kombination „Album horten UND Sieg-Farm"; eine Sieg-Farm, die ihre freien Tage
   nutzt (an 1.123 bzw. 1.153 von 3.650 Tagen fand sie kein Ziel im sicheren
   Fenster, an 835 bzw. 827 waren beide Fronten belegt – ihre Zahl ist eine
   Untergrenze); und der reine Creator, der keinen Disstrack hat.
