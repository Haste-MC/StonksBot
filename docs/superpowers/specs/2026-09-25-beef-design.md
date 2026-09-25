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
Szenen-Malus, und `music.publish` fragt `beef.zielFor(...)`, gegen wen ein
Disstrack geht. Beide Richtungen laufen über spät gebundene `require` (§8).

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

Fünfte Anfrageart in `REQUESTS`: `{ id: 'anstacheln', name: 'Anstacheln',
emoji: '🔥', time: 2, minDraht: null }`. Sie läuft **nicht** durch
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

Von Hand: gleich groß, Hip-Hop → 0 % · du tausendmal größer, Hip-Hop → 33,3 % ·
du hunderttausendmal größer → 60 % (Obergrenze) · gleich groß, Klassik →
12,3 % · du tausendmal größer, Klassik → 45,6 %.

Bei Häme wird statt der Aufmerksamkeit der Faktor **0,5** übergeben, der Hype
fällt auf × 0,8, 2 % der Hörer gehen, und **die Runde geht an ihn**. Ohne Häme
holt der Disstrack die Runde für dich.

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

- Hype × (1 − 0,25 × wucht) – bei einem tausendmal Größeren also × 0,75
- Hörer − (10 % × wucht), höchstens 10 %
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

**Versöhnung** ist eine sechste Anfrageart `{ id: 'frieden', name: 'Frieden
anbieten', emoji: '🕊️', time: 2, minDraht: null }`, möglich sobald die Hitze
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

- **Kontaktansicht des Gegners:** Zeile „🔥 **Beef** · Hitze 62 ▰▰▰▱▱ · Runden
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
