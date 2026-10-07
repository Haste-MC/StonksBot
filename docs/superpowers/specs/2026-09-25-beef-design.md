# Beef und Disstracks – Stück 5b

> **Nachtrag aus Stück 6a (2026-10-08):** Die hier wortgetreu vorgeschriebenen
> Meldungstexte sind überholt. Sie sprachen mit einem Pronomen über einen
> **beliebigen** Kontakt — etwa »für ihn«, »Mit ihm läuft schon einer«, »sein
> Konter«, »bei seinem Label« —, und der Katalog in `src/data/contacts.js` hat
> **kein Geschlechtsfeld**. Betroffen waren unter anderem Nina Chuba, Loredana,
> Rosalía, Anitta, Angèle, Sezen Aksu, Ado, Peggy Gou und Pamela Reif, dazu die
> Bands. Stück 6a hat sie neutral gefasst; der gültige Stand steht in
> `docs/superpowers/specs/2026-10-07-beziehungen-design.md` und im Code.
> **Wer gegen dieses Dokument implementiert, übernimmt die Texte nicht wortgetreu.**

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
{ id: 'diss', name: 'Disstrack', emoji: '🔥', songs: 1, spike: 2.1,
  growth: 0.4, time: 2, blurb: 'Viel Lärm, wenig Bleibendes – und alle hören hin.' }
```

Spike 2,1 schlägt härter ein als eine Single (1,0), Growth 0,4 hält weniger als
jede andere Art. **Diese Spec hatte hier bis zum 2026-09-26 Spike 3,0.** Mit 3,0
war `spike × growth` = 1,20 und damit größer als die 1,00 der Single: Der
Disstrack holte je aufgenommenem Titel MEHR bleibende Hörer als eine Single und
war damit trotz seines Blurbs die bleibendere Art – die Wurzel des
Geldruckers, den der Nachtrag 5d gemessen hat. Mit 2,1 ist das Produkt 0,84
(unter der Single), der Buzz je Titel bleibt mit 2,1² = 4,41 der zweithöchste im
Spiel (nur das Album liegt mit 5,04 darüber). Siehe **Addendum 3** unten. Der Disstrack ist nur wählbar, wenn ein Beef offen ist; das
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
`ANZAEHL_CHANCE = 0,35`. (Diese Spec hatte hier bis zum 2026-09-26 0,06. Die Zahl
ist der einzige Hebel, der den passiven Spieler oft erreicht, und sie ist erhöht
worden, damit das Aussitzen wieder etwas kostet – gezählt 83,0 Anzählungen im Jahr
statt 19,6. Siehe **Addendum 4** unten.) Auch völlig Fremde kommen in Frage – wer
groß wird, zieht Feinde an. Gewichtet wird über den ganzen Katalog:

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
antworten (Disstrack) oder schlucken – Schlucken kostet im Moment nichts, aber die
Hitze kühlt ab und der Beef endet dann als **Niederlage**, weil er die Runde hat.

**Und Schlucken ist die einzige Lage, in der `konter_at` 0 bleibt** (`src/beef.js:418`;
`settle` schlägt nur bei `konter_at > 0` zu, `src/beef.js:454`): Wer nie antwortet,
nimmt nie einen Gegenschlag. Ihn erreicht von allen Zahlen dieses Stücks deshalb nur
das Niederlagen-Fenster – über `ANZAEHL_CHANCE` (wie oft es aufgeht),
`BONUS_NIEDERLAGE` (wie hart es beißt) und `BONUS_TAGE` (wie lange). Gemessen kostet
das Aussitzen einen reinen Musiker **−19,9 %** im Jahr und einen Musik+Creator
**−10,2 %**; ohne das Fenster (Kontrolllauf mit `BONUS_NIEDERLAGE` 1,00) sind es in
beiden Archetypen **exakt ±0,0 %**, auch bei 4.939 abgerechneten Niederlagen. Siehe
**Addendum 4**.

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
`<` → `niederlage`, `=` → `unentschieden`.
`bonus_until = now + BONUS_TAGE`, und `BONUS_TAGE` ist **1 Tag**. (Diese Spec
hatte hier bis zum 2026-09-26 sieben Tage; das war der zweite Teil des
Geldruckers – der Hype trägt sich selbst weiter, und ein Wochenfenster
machte aus dem Ausschlag einen Dauerzustand. Die zwei Faktoren selbst sind
unverändert – auch nach Addendum 4, das die HÄUFIGKEIT der Niederlage erhöht hat und
nicht ihre Wucht. Siehe **Addendum 3** und **Addendum 4** unten.)

| Ende | Wirkung, 1 Tag lang |
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
  dich. Die Straße redet – einen Tag lang." – `BONUS_TAGE`, seit dem Balancing
  vom 2026-09-26 auf 1 statt 7; der Text hängt in `beefNote`
  (`src/buttons.js`) an dieser Konstante, damit er nicht wieder abdriftet).
- **Texte** wie in 5a je Charakterzug, alles Spielfiktion: Musik, Zeilen,
  Termine. Keine Aussagen über die wirkliche Welt und keine Beleidigungen, die
  außerhalb des Spiels stehen könnten – der Disstrack ist eine Veröffentlichung
  im Spiel, kein Kommentar über eine reale Person.

## §3, Messung, Tests

**Warum das kein Geldrucker ist:** Kein `unb`-Aufruf in `src/beef.js` oder
`src/data/beef.js`; die Aufmerksamkeit ist ein Faktor auf das Publikum **einer**
Veröffentlichung, und der Sieg zahlt ausschließlich über den Hype, der bei
`HYPE_MAX` 1,7 hart gedeckelt ist.

**Der ursprüngliche Satz dieser Spec war an zwei Stellen falsch, und beide sind
gemessen widerlegt** (`docs/messungen/2026-09-26-beef.txt`, Nachträge 5c und 5d):

1. „Der niedrigste Growth im Spiel ist die Bremse, die Hörer hängen an `growth`,
   nicht am Spike" – falsch. In `src/music.js` ist `gained = audience × … ×
   type.growth × …`, und `audience` enthält `type.spike`. Die bleibenden Hörer je
   aufgenommenem Titel sind `spike × growth`, also 3,0 × 0,4 = **1,20** – mehr
   als die 1,00 einer Single. Der Disstrack war die bleibendere Art. Behoben
   über `spike` 2,1 (Produkt 0,84).
2. „Der Hype ist gedeckelt, also kann der Sieg nicht davonlaufen" – richtig,
   aber unvollständig: Der Deckel war genau das Problem. Der Hype trägt sich
   selbst weiter, und der Faktor greift auf JEDE Veröffentlichung und JEDES
   Konzert im Fenster. Beim Veröffentlichen ist der Fixpunkt
   `0,3 × Wurf × B / (1 − 0,7 × B)` = 3,0 × Wurf bei B = 1,25, beim Konzert ist
   der Nenner `1 − 0,8 × 1,25` **genau 0** – dort gibt es gar keinen Fixpunkt,
   und die Folge läuft monoton in den Deckel. Wer regelmäßig gewann, klebte an
   `HYPE_MAX`, statt einen Ausschlag zu bekommen (gemessen: 14.335 von 21.900
   Tagen im Siegfenster, Ø Hype dort 1,519). Behoben über `BONUS_TAGE` 1
   (2.824 von 21.900 Tagen, Ø Hype im Fenster 1,173).

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

## Addendum 3 nach dem Nachtrag 5d (2026-09-26): der Deckel hält wieder

**Auch dieses Addendum ist inzwischen historisch: Was heute gilt, steht in
Addendum 4.** Seine Zahlen sind unverändert der Stand, den es gemessen hat; sie gelten
aber für `ANZAEHL_CHANCE` 0,06 statt 0,35 – geändert hat sich davon die Spalte
„passiv" und, weil die `sieg-farm` ebenfalls öfter angezählt wird, auch ihre.

**Die Addenda 1 und 2 sind ab hier historisch.** Ihre Zahlen sind unverändert
der Stand, den sie gemessen haben; sie gelten aber für `spike` 3,0 und
`BONUS_TAGE` 7 und für einen Kontaktkatalog mit 74 Einträgen. Was zum Zeitpunkt
dieses Addendums galt, steht hier. Vollständige Ausgabe aller Läufe:
`docs/messungen/2026-09-26-beef.txt`, Abschnitt „Nachtrag 5d".

**Warum es diesen Nachtrag gibt.** Der Kontaktkatalog ist auf 90 Einträge
erweitert worden (Commit 3db0b2f, um die Lücke im mittleren Größenbereich zu
schließen, die Addendum 2 als Grenze (d) notiert hatte). Damit findet die
`sieg-farm` an weit mehr Tagen ein Ziel im sicheren Fenster, und der Auslöser
des Plans („über +25 %") war gerissen: Neu gemessen mit denselben Konstanten und
denselben Seeds stand `sieg-farm` für den reinen Musiker bei **+165,9 %**
(gepaart, 60 Läufe) statt +75,5 %, `diss-isoliert` bei +38,3 %, und für
Musik+Creator `sieg-farm` bei +46,6 %.

**Geändert wurden zwei Zahlen, sonst nichts.**

| Konstante | Datei | alt | neu |
|---|---|---|---|
| Disstrack `spike` | `src/data/music.js` | 3,0 | **2,1** |
| `BONUS_TAGE` | `src/data/beef.js` | 7 | **1** |

Unverändert: `growth` 0,4 · `BONUS_SIEG` 1,25 · `BONUS_NIEDERLAGE` 0,85 ·
`DISS_AUFMERK` 1,5 · `HAEME_AUDIENCE` 0,50 · `HYPE_MAX` 1,7 · jede andere Zahl ·
jede Formel. Der Spiegel des Zahlensatzes (Sieg 1,25 gegen Niederlage 0,85, im
Logarithmus 0,73) ist damit unangetastet: Der Sieg und die Niederlage behalten
ihre volle Wucht, nur das Fenster ist kürzer.

**Zwei Konstanten, weil es zwei Mechanismen sind.** Genau wie Addendum 2 es
vermutet hat: `spike` ist der Hebel von `diss-isoliert` (dort sind 98,7 % aller
Veröffentlichungen Disstracks), `BONUS_TAGE` der von `sieg-farm` (dort belegt
der Disstrack nur 15,1 % der Veröffentlichungen, der Zuwachs kommt aus dem
Hype-Fenster). Gemessen, dass keine der beiden allein reicht:

| Einstellung | Läufe | `sieg-farm`, nur Musik, gepaart |
|---|---|---|
| `spike` 2,1 · `BONUS_TAGE` 7 (Kontrolle 2) | 60 | +95,2 % ✗ |
| `spike` 3,0 · `BONUS_TAGE` 1 | **30** | +92,2 % ✗ |
| `spike` 2,1 · `BONUS_TAGE` 1 (Endstand) | 60 | **+19,7 %** ✔ |

Die mittlere Zeile ist die einzige mit nur 30 statt 60 Läufen (siehe
`docs/messungen/2026-09-26-beef.txt`, Abschnitt „Nachtrag 5d" – dort steht die
Läufezahl direkt hinter der Einstellung); bei 10 Seeds wackelt derselbe Punkt
laut Ehrlichen Grenzen (2) unten um gut zehn Prozentpunkte, also ist sie nicht
ohne Weiteres mit den zwei 60-Läufe-Zeilen vergleichbar.

**Der Endstand** (60 Läufe à 365 Tage, Mediane / je Seed gepaart gegen
„ohne Beef"; das 10- und das 30-Läufe-Protokoll stehen in der Messdatei daneben
und halten den Deckel ebenfalls, mit +15,2 % bzw. +19,6 % als größter Zahl):

| Variante | Musik+Creator | nur Musik |
|---|---|---|
| ohne Beef | 358.064/Tag | 104.032/Tag |
| passiv | 352.978 (−1,4 % / +0,2 %) | 97.843 (−5,9 % / −5,0 %) |
| aktiv | 310.231 (−13,4 % / −14,0 %) | 52.325 (−49,7 % / −49,6 %) |
| `diss-isoliert` | 310.926 (−13,2 % / −12,4 %) | 53.854 (−48,2 % / −46,9 %) |
| `sieg-farm` | 357.554 (−0,1 % / +0,8 %) | 121.091 (**+16,4 % / +19,7 %**) |
| Kontrolle: ohne Beef, Album | 2.741.519 (+665,7 %) | 2.981.641 (+2766,1 %) |

Die größte Zahl der Tabelle ist +19,7 %; der Auslöser ist in keiner der sechzehn
Zellen erreicht.

**Der Sieg ist weiter spürbar, und das ist gemessen.** Ein Kontrolllauf fährt die
Endeinstellung mit `BONUS_SIEG` 1,00 und `BONUS_NIEDERLAGE` 1,00: Die Sieg-Farm
des reinen Musikers bringt dann 104.892/Tag (**+4,8 %** gepaart) statt 121.091
(+19,7 %) – der Ausgang trägt ihr also knapp **15 Prozentpunkte** ihres
Jahresertrags –, ihr Ø Hype fällt von 1,19 auf 1,11 und im Siegfenster von 1,173
auf 1,134 (bei fast gleich vielen Fenstertagen: 2.824 gegen 2.822). Der passive
Spieler landet ohne Ausgangsfaktor bei **exakt ±0,0 %** – ohne ihn ist „passiv"
Zahl für Zahl „ohne Beef". Die Siegquote der Farm bleibt hoch: 2.875 Siege in
3.270 Abrechnungen (**87,9 %**).

**Der Preis, und er ist unbequem.** Der passive Spieler verlor mit dem
Wochenfenster **−23,9 %** im Jahr (nur Musik) bzw. −10,4 % (Musik+Creator);
jetzt sind es **−5,0 %** bzw. +0,2 %, bei Musik+Creator also nicht mehr von null
zu unterscheiden. Ein kürzeres Fenster verkürzt Sieg und Niederlage gleich stark,
und die Niederlage war die Zahl, mit der die Patchnotes zu 1.40.0 geworben haben
– sie sind entsprechend neu geschrieben. Innerhalb der geänderten Konstanten
gibt es dagegen kein Mittel: `BONUS_NIEDERLAGE` allein härter zu machen bräche
den Spiegel, und der passive Spieler ist nicht die Spielweise, die über +25 %
lag. Die messbare Alternative wäre gewesen, das Wochenfenster zu behalten und
`BONUS_SIEG` auf 1,03 zu senken (gemessen: hält den Deckel ebenfalls, mit
+21,1 % bei 30 Läufen) – dann wäre der Ausgang eine Woche lang um 3 % spürbar,
also gar nicht. Ein Tag mit dem vollen Viertel ist die bessere Hälfte dieses
Tauschs; dass es ein Tausch ist, steht hier.

**Was der Disstrack jetzt ist.** Zweitlauteste Art im Spiel und die am wenigsten
bleibende – das, was sein Blurb sagt:

| Art | `songs` | `spike` | `growth` | Hörer je Titel | Buzz je Titel |
|---|---|---|---|---|---|
| Single | 1 | 1,0 | 1,0 | 1,00 | 1,00 |
| EP | 3 | 2,6 | 1,5 | 1,30 | 2,25 |
| Album | 6 | 5,5 | 2,4 | **2,20** | 5,04 |
| Deluxe / Remix | 2 | 1,6 | 0,7 | 0,56 | 1,28 |
| Disstrack | 1 | 2,1 | 0,4 | 0,84 | **4,41** |

`test/music.test.js` hält die Richtung fest („Disstrack: mehr spike, weniger
growth als die Single") und ist **nicht** angepasst worden: 2,1 > 1,0 und
0,4 < 1,0 gelten unverändert. Ebenso unverändert sind die zwei Prüfungen in
`test/beef.test.js`, die `bonusFaktor` auf 1,25 und 0,85 festnageln.

**Ehrliche Grenzen dieses Addendums.** (1) Der Rand ist nah: +19,7 % liegt gut
fünf Prozentpunkte unter dem Deckel, und `spike` 2,2 statt 2,1 reißt ihn schon
(+25,3 %, gemessen). Wer am Kontaktkatalog, an `ANZAEHL_CHANCE`, an `HYPE_MAX`
oder an den Genres dreht, muss diese Messung wiederholen. (2) Bei 10 Seeds
wackelt derselbe Punkt der Suche um gut zehn Prozentpunkte – deshalb ist mit 30
gesucht und mit 60 bestätigt. (3) Die Strategie-Suchphase des Messskripts ist
nicht bit-stabil (fünf Zeilen, je 1 Einheit, zwischen zwei Aufrufen derselben
Kommandozeile); der Beef-Abschnitt war in jedem Vergleich zeilengleich, und
keine Zahl dieses Addendums kommt aus der Suchphase. (4) Die Grenzen (5) von
Addendum 2 gelten weiter: Frieden, „Album horten UND Sieg-Farm" und der reine
Creator sind nicht gemessen.


## Addendum 4 nach dem Nachtrag 5e (2026-09-26): das Aussitzen kostet wieder

**Die Addenda 1 bis 3 sind ab hier historisch.** Was heute gilt, steht hier.
Vollständige Ausgabe aller Läufe: `docs/messungen/2026-09-26-beef.txt`, Abschnitt
„Nachtrag 5e".

**Warum es diesen Nachtrag gibt.** Addendum 3 hat den Deckel von +25 % wieder
eingehalten, aber dafür `BONUS_TAGE` von 7 auf 1 gesenkt – und ein kürzeres Fenster
verkürzt den Sieg UND die Niederlage gleich stark. Der Preis stand in Addendum 3
selbst: Wer angezählt wird und es aussitzt, verlor mit dem Wochenfenster −23,9 % im
Jahr und danach nur noch **−5,0 %**; für Musik+Creator waren es +0,2 %, also nichts.
Der Beef hatte als Drohung keine Zähne mehr.

**Geändert wurde eine Zahl, sonst nichts.**

| Konstante | Datei | alt | neu |
|---|---|---|---|
| `ANZAEHL_CHANCE` | `src/data/beef.js` | 0,06 | **0,35** |

Unverändert: `BONUS_NIEDERLAGE` 0,85 · `BONUS_SIEG` 1,25 · `BONUS_TAGE` 1 ·
Disstrack `spike` 2,1 · `growth` 0,4 · `DISS_AUFMERK` 1,5 · `KONTER_HYPE` 0,25 ·
`KONTER_HOERER` 0,10 · `HYPE_MAX` 1,7 · der Katalog · jede Formel. **Der Spiegel des
Zahlensatzes ist damit nicht gebrochen** (Sieg 1,25 gegen Niederlage 0,85, im
Logarithmus 0,73) – und das ist ein Messergebnis, keine Vorliebe: `BONUS_NIEDERLAGE`
zu senken war der zweite erlaubte Hebel, ist gemessen worden und sättigt, weil der
Faktor nur einen Tag greift und der Hype sich danach wieder hochträgt
(`hype ← 0,7 × hype + 0,3 × Wurf`).

| `BONUS_NIEDERLAGE` (bei `ANZAEHL_CHANCE` 0,06) | passiv, nur Musik, gepaart, 30 Läufe |
|---|---|
| 0,85 | −5,2 % |
| 0,60 | −11,2 % |
| 0,40 | −12,5 % |

Sechs Prozentpunkte für den ersten Schritt, 1,3 für den zweiten. Die Zahl der Fenster
sättigt nicht:

| `ANZAEHL_CHANCE` (bei `BONUS_NIEDERLAGE` 0,85) | passiv, nur Musik, gepaart, 60 Läufe |
|---|---|
| 0,06 | −5,0 % |
| 0,25 | −16,4 % |
| 0,30 | −18,1 % |
| **0,35** | **−19,9 %** ✔ |
| 0,40 | −21,7 % |
| 0,45 | −22,7 % |

**Warum es überhaupt nur diese Zahlen sein konnten.** `anzaehlen` schreibt
`konter_at: 0` (`src/beef.js:418`), und `settle` schlägt nur bei `konter_at > 0` zu
(`src/beef.js:454`); `konter_at` bekommt nur dort einen Zeitpunkt, wo der Spieler
selbst einen Disstrack veröffentlicht (`src/beef.js:327`). Wer schluckt, nimmt also im
ganzen Jahr keinen Gegenschlag – `KONTER_HYPE` und `KONTER_HOERER` können ihn nicht
erreichen, und sie zu erhöhen würde nur den aktiven Spieler bestrafen, der bei −51,8 %
steht. Gegengeprüft ist das nicht nur gelesen, sondern ausgeführt (Handprüfung 5e) und
gemessen: Der Kontrolllauf mit `BONUS_SIEG` 1,00 und `BONUS_NIEDERLAGE` 1,00 setzt
„passiv" in BEIDEN Archetypen auf **exakt ±0,0 %**, bei unveränderten 4.939
abgerechneten Niederlagen – Szene-Malus, Draht und die offene Front kosten kein Geld.

**Der Endstand** (60 Läufe à 365 Tage, ohne jeden Schalter, Mediane / je Seed gepaart
gegen „ohne Beef"; in Klammern die Seeds im Plus):

| Variante | Musik+Creator | nur Musik |
|---|---|---|
| ohne Beef | 358.064/Tag | 104.032/Tag |
| passiv | 321.828 (−10,1 % / **−10,2 %**, 18/60) | 83.053 (−20,2 % / **−19,9 %**, 4/60) |
| aktiv | 297.043 (−17,0 % / −17,7 %, 7/60) | 50.344 (−51,6 % / −51,8 %, 0/60) |
| `diss-isoliert` | 310.926 (−13,2 % / −12,4 %, 15/60) | 53.854 (−48,2 % / −46,9 %, 0/60) |
| `sieg-farm` | 346.329 (−3,3 % / −1,2 %, 27/60) | 120.874 (**+16,2 % / +15,0 %**, 46/60) |
| Kontrolle: ohne Beef, Album | 2.741.519 (+665,7 %) | 2.981.641 (+2766,1 %) |

Die größte Zahl der sechzehn Zellen ist **+16,2 %**; der Auslöser „über +25 %" ist in
keiner erreicht, und der Abstand ist mit 8,8 Prozentpunkten größer als der von
Addendum 3 (5,3). Das ist kein Zufall, sondern dieselbe Zahl von der anderen Seite:
Die `sieg-farm` wird ebenfalls öfter angezählt (995 statt 240 Anzählungen in 21.900
Tagen) und rechnet diese unbeachteten Fronten als Niederlagen ab – ihre Siegquote
fällt von 87,9 % auf **71,0 %**.

**Die Ursache des Preises, gezählt.** Der passive reine Musiker wird 4.982 mal in
21.900 Tagen angezählt (83,0 im Jahr) statt 1.174 (19,6), und jede Front endet 0:1:
4.901 Abrechnungen, Siegquote 0,0 %, **Gegenschläge 0**. Sein Ø Hype über alle Tage
(Median der Seeds) fällt von 1,13 auf 1,03 und sein Hype am Jahresende von 1,11 auf
1,00, seine Tantiemen von 91.222/Tag auf 72.653/Tag.

**`diss-isoliert` ist in jeder gemessenen Einstellung Zahl für Zahl dieselbe** – die
schärfste interne Kontrolle dieses Nachtrags, denn dort ist `anzaehlen` auf beiden
Seiten stillgelegt und die geänderte Zahl kann die Variante nicht erreichen.

**Ehrliche Grenzen dieses Addendums.** (1) Die Musik+Creator-Zahl ist die schwächste
veröffentlichte Zahl: −10,2 % bei 60 Läufen, **−6,9 % bei 120**, Spanne je Seed
−33,8 % … +35,2 %, 18 von 60 Seeds im Plus. Gesichert ist ihr Vorzeichen (exakter
Vorzeichentest p = 0,0027 bei 60 und 0,0013 bei 120; vorher war es mit 31 von 60 im
Plus reines Rauschen), nicht ihre Größe. Der Grund ist strukturell und gemessen: Das
Fenster ist ein Faktor auf den Hype, und beim Musik+Creator hängen nur Tantiemen
(22 % der Einnahmen) und Konzerte (3 %) daran; Merch fällt 4,4 %, während die
Tantiemen 22,6 % fallen. Selbst `--anzaehl-chance=1.0` bringt ihn nur auf −5,5 %. Ihn
weiter zu senken bräuchte einen Verlust, der nicht über den Hype läuft – den gibt es
in 5b nicht. (2) 0,35 ist eine große Zahl im Spielgefühl, und das ist nicht gemessen:
alle gut vier Tage eine neue Front. (3) In der 30-Läufe-Suche stehen drei nicht
gewählte Einstellungen über +25 % (`sieg-farm`, nur Musik); jede mit 60 Läufen
bestätigte bleibt bei oder unter +16,6 %. (4) Die Suchphase des Messskripts ist weiter
nicht bit-stabil (hier zwei Zeilen, je 1 Einheit); keine Zahl kommt aus ihr. (5) Nicht
gemessen ist die Spielweise dazwischen – antworten, gewinnen, Frieden anbieten. Mit 83
Fronten im Jahr ist sie die interessante Frage, und das Messskript baut sie nicht.
(6) Kein Test war anzupassen: `test/beef.test.js` nagelt `bonusFaktor` weiter auf 1,25
und 0,85 fest, seine Prüfung „Über der Chance passiert nichts" liest
`data.ANZAEHL_CHANCE` statt eine Zahl zu wiederholen, und die Prüfung darunter würfelt
0,01 – unter 0,06 wie unter 0,35. `ANZAEHL_CHANCE` selbst ist damit von keinem Test
festgenagelt; wer sie wieder ändert, merkt es nur an dieser Messung.
