# Rangfolge der Geldquellen

Stand: 2026-09-09 · Zweig `main`

## Beschlossene Anpassungen

Der Stand der Absprachen, damit er nicht in einem Gesprächsverlauf verloren
geht. **Diese Punkte sind entschieden.** Alle Zahlenwerte, die sie brauchen,
kommen aus der Messung — nicht aus Schätzungen.

| # | Beschluss |
|---|---|
| 1 | ✅ Heists bekommen eine **Sperre je Ziel** statt einer globalen. Staffelung 12/12/12/18/18/40/72 h. Der Einstieg (erste drei Ziele) bleibt bei 12 h. |
| 2 | **Knast läuft weiter parallel** zur Sperre, nicht obendrauf. Folge beim Goldtransport: Ein Fehlschlag kostet nur die Geldstrafe. Bewusst so. |
| 3 | Die Heist-Kurve muss **aufsteigend** bleiben: Ein höheres Ziel wirft pro Tag mehr ab als ein niedrigeres. |
| 4 | ✅ `CREATOR_SPILL` wird **entfernt**. Ein großer Creator startet als Musiker bei null. |
| 5 | ✅ `reachBonus` wird **angeschlossen**, aber als **Untergrenze** auf die Gesamtreichweite (`max(Follower, Hörer × 0,18)`), nicht als Summand. |
| 6 | **Startbonus**: Beim ersten Anlegen eines Kanals werden Follower in Höhe dieser Untergrenze einmalig echt gutgeschrieben — einmal je Konto **und Plattform**, gegen Löschen-und-neu-Anlegen gesichert. |
| 7 | `SOCIAL_SPILL` bleibt bestehen. Ein Musiker mit großem Publikum hat große Socials — das ist gewollt und realistisch. |
| 8 | Die Kanäle eines erfolgreichen Musikers wachsen **1,2-mal schneller** als die eines reinen Creators — **zusätzlich** zur allgemeinen Beschleunigung. Die Faktoren multiplizieren sich. |
| ~~9~~ | ~~Konzerte werden gedämpft.~~ **Zurückgenommen.** Beruhte auf einer fehlerhaften Messung. Konzerte sind mit `Hörer^0,7` der gut gebaute Teil und liegen ab 100.000 Hörern deutlich hinter den Tantiemen. Sie bleiben unverändert. |
| ~~10~~ | ~~Tantiemen werden hart angehoben.~~ **Umgekehrt.** Tantiemen sind 97 % der Musik-Einnahmen und wachsen **überlinear** — sie werden **gedämpft**, siehe 16. |
| 11 | **Merch wird hart angehoben** — Ziel: **250.000/Tag bei 2,6 Mio Followern**. Hilft vor allem dem reinen Creator, bei dem Merch 89 % der Einnahmen ausmacht. |
| ~~16~~ | ~~Tantiemen `Hörer^0,9`, Anker 194.661.~~ **Ersetzt durch 19.** |
| 19 | **Tantiemen: `k × Hörer^1,2`**, Anker bei **363.900 Hörern** (gemessener Ein-Jahres-Stand), wo der heutige Wert von 81.493/Tag erhalten bleibt. Der Exponent bestimmt die *Spreizung* zwischen Anfang und Endgame, der Anker nur die *Höhe* — `^0,9` hätte den Anfang angehoben und die Spitze gekappt, genau umgekehrt zum Ziel. Spreizung 10.000 → 2,6 Mio Hörer: heute 4.333×, künftig 791×. |
| 20 | **Eine Musikkarriere erreicht nach einem Jahr täglichen Spielens 500.000 bis 700.000 Hörer** — als Median ohne Ereignisse, die das anheben oder drücken (viraler Clip, Shitstorm). Heute gemessen: 363.900, das Wachstum steigt also um rund das 1,6-Fache. Daraus folgt bei Beschluss 19 ein Ein-Jahres-Ertrag von rund 119.000 bis 179.000/Tag, also das 1,4- bis 2,1-Fache des gebremsten Goldtransports. |
| ~~17~~ | ~~YouTube `^0,85`~~, dann ~~`^0,99` mit Anker 500k~~. **Ersetzt durch 21.** Gemessen lag YouTube schon bei `^1,08` — das Problem war nicht die Kurve, sondern die Bremse. |
| 21 | **Die Vermarktungsbremse fällt für alle vier Plattformen.** `monetization()` stand bei 10.000 Followern auf 6 % und machte aus den versprochenen 0,35 je Aufruf real 0,021 — ein Video brachte 27. Gedämpft wird jetzt allein über die Reichweitenkurve (`reachOf`, Exponent 0,58). Gemessen: reiner Creator 6.266 → 14.628/Tag, Musik+Creator unverändert, Faktor 6,8 → 3,0. **Umgesetzt.** |
| 22 | **Musik bekommt eigene, schwerere Zufallsereignisse** — separat von den Creator-Ereignissen. Eigenes Feature, eigene Spec, nach Abschluss dieser Balance-Runde. |
| 18 | **`MERCH_DAILY_CAP` wird angehoben.** Er steht auf 100.000 und würde nach der Merch-Anhebung ab etwa einer Million Followern greifen. |
| 12 | **Wachstum beschleunigt, asymmetrisch.** Für die **Musik** gilt Beschluss 20 (500.000–700.000 Hörer nach einem Jahr, Faktor ~1,5). Für den **Creator** bleibt es bei **1 Mio Follower in ~9 Monaten** — gemessen sind heute 458.743 nach einem Jahr, nötig ist also etwa Faktor 1,8. |
| 13 | Die **Erfolgs-Schwellen** aus der Spec vom 2026-09-08 werden gegen die neuen Raten neu gerechnet. `id` bleibt, wer einen Erfolg hat, behält ihn. |
| 14 | **Rangfolge als Ganzes:** Musik+Creator > nur Creator > Heists. „Nur Creator" bleibt eine tragfähige Spielweise. |
| 15 | **Erst messen, dann ändern.** Keine Stellschraube wird bewegt, bevor belastbare Messwerte vorliegen. |

## Ziel

Die Einnahmequellen sollen eine klare, gewollte Rangfolge haben:

1. **Musik + Creator** ist die beste Quelle im Spiel — verdient durch die
   höchste Einstiegshürde und die Notwendigkeit, zwei Systeme zu beherrschen.
2. **Nur Creator** bleibt eine tragfähige, deutlich leichtere Spielweise.
3. **Heists** sind ein Ereignis, kein Job.

Dazu wird die Zusammensetzung der Musik-Einnahmen umgebaut, das Wachstum
beider Karrieren beschleunigt und die Querverbindung zwischen Creator und
Musik auf eine Richtung reduziert.

## Nicht-Ziele

- Keine neue Spielart. Alle Änderungen bewegen vorhandene Stellschrauben.
- Kein Scheduler (§4).
- Die Preise (Chiron 3,2 Mio, Schloss 18 Mio) bleiben, wo sie sind.

## Ausgangslage (gemessen, nicht geschätzt)

Zwei Karrieren über 1.095 Tage, je 8 Zeiteinheiten am Tag, gleicher Würfel:

| | Einnahmen/Tag | Follower | Hörer |
|---|---|---|---|
| nur Creator | 1.061 | 898.813 | — |
| Musik + Creator | 6.749 | 1.093.017 | 50.280 |

Aufschlüsselung der Musik-Karriere: Konzerte 5.331.719 · Merch 1.432.344 ·
Instagram 456.275 · YouTube 139.858 · Twitch 29.706.

Beim reinen Creator: Merch 881.081 · Instagram 278.849 · Twitch 1.232 ·
YouTube 533.

### Der Kernbefund: die Tantiemen wachsen überlinear

Das ist die Ursache hinter allem anderen und ein Konstruktionsfehler, kein
Balancing-Wert.

Die `monetization`-Kurve wurde als **Bremse** für Creator gebaut, wo das
Publikum selbst schon unterlinear wächst. Die Musik multipliziert sie aber auf
eine Einnahme, die bereits **linear** in den Hörern ist:

```
Creator   Publikum^0,73 als Dämpfer auf die Einnahme je Aufruf   →  unterlinear
Musik     Hörer  ×  Hörer^0,73                                   →  ÜBERLINEAR
```

Gemessen an den echten Funktionen:

| Hörer | Vermarktung | Tantiemen/Tag |
|---|---|---|
| 10.000 | 6,0 % | 414 |
| 100.000 | 12,6 % | 8.722 |
| 194.661 | 20,6 % | 27.610 |
| 872.183 | 61,4 % | 369.720 |
| 2.000.000 | — | **1.380.000** |

Achtzigfache Hörerzahl bringt das **893-Fache** an Geld. Alles andere im Spiel
verhält sich brav: Konzerte `Hörer^0,7`, Merch `Reichweite^0,92`, Sponsoren
`^0,65`. Die Tantiemen sind die einzige überlineare Einnahme — und damit die
Erklärung dafür, dass Musik+Creator in der Messung das **51-Fache** eines
reinen Creators verdient.

### Was daran falsch ist

1. **Konzerte umgehen die Vermarktungskurve.** `SHOW_PAY × Hörer^0,7` ist
   ungedämpft, während Tantiemen, Werbung und Merch durch `monetization`
   laufen. Ergebnis: 72 % der Musik-Einnahmen kommen aus Konzerten.
2. **Tantiemen sind praktisch null.** Sie benutzen die Creator-Kurve mit
   `MON_FULL = 1.700.000` **Followern**. Ein Musiker mit 50.000 Hörern liegt
   damit bei 7 % Vermarktung — obwohl 50.000 Hörer eine ernste Größe sind.
   Streaming zahlt aber ab dem ersten Abruf, es rampt nicht wie Werbung.
3. **Kanäle speisen Musik.** `CREATOR_SPILL = 0,08` rechnet Kanalreichweite in
   den Hörer-Pool. Ein großer Streamer startet als Musiker nicht bei null.
4. **Die Gegenrichtung ist toter Code.** `reachBonus` / `MUSIC_TO_CREATOR`
   sind exportiert, werden aber nirgends aufgerufen.
5. **Der Aufbau dauert zu lange.** Knapp eine Million Follower nach drei
   Jahren täglichen Spielens.
6. **Heists sind ein 12-Stunden-Rhythmus.** Ein Millionending alle zwölf
   Stunden ist Klickarbeit, keine Entscheidung.

### Korrekturen an früher genannten Zahlen

Zwei Werte, die in diesem Projekt bereits dokumentiert sind, waren falsch:

| | falsch | richtig | Ursache |
|---|---|---|---|
| Goldtransport | ~875.000/Tag | **214.627/Tag** | Beute wird durch die Crew geteilt (`crewFactor`, `LEADER_SHARE`), und die Strafe zahlt jedes Mitglied voll |
| Musik bei 872k Hörern | ~706.000/Tag | **~434.000/Tag** | `monetization`-Faktor übersehen |

Die erste Zahl steht in `docs/superpowers/specs/2026-09-08-achievements-design.md`
und hat dort die Platin-Schwellen begründet. Sie wird dort korrigiert.

## Die Änderungen

### 1 · Heists: Sperre je Ziel

`HEIST_COOLDOWN_MS` (eine Zahl für alle sieben Ziele) weicht einem Feld
`cooldownH` je Ziel in `src/data/heists.js`.

| Ziel | Sperre | Knast | EV/Tag heute | EV/Tag neu |
|---|---|---|---|---|
| Spätkauf | 12 h | 5 h | 5.234 | 5.234 |
| Tankstelle | 12 h | 9 h | 16.806 | 16.806 |
| Juwelier | 12 h | 18 h | 32.964 | 32.964 |
| Kunstdepot | **18 h** | 24 h | 90.844 | 68.480 |
| Filialbank | **18 h** | 36 h | 96.178 | 74.352 |
| Kasino-Tresor | **40 h** | 48 h | 180.993 | 79.290 |
| Goldtransport | **72 h** | 72 h | 214.627 | **85.851** |

Die Werte sind so gewählt, dass die Kurve **aufsteigend** bleibt: Ein höheres
Ziel muss pro Tag mehr abwerfen als ein niedrigeres, sonst lohnt der Aufstieg
nicht. Eine naive Staffelung (18/24/48/72) hätte die Filialbank unter das
Kunstdepot gedrückt.

Der Einstieg bleibt unangetastet — die ersten drei Ziele behalten 12 h.

**Knast läuft weiter parallel.** Beim Goldtransport sind Sperre und Knast damit
beide 72 h; ein Fehlschlag kostet dort also nur die Geldstrafe, keine
zusätzliche Zeit. Das ist eine bewusste Entscheidung und wird im Code als
solche vermerkt, damit es später niemand für einen Fehler hält.

**Umsetzung:** Neue Spalte `cooldown_until` auf `criminals`, beim Abschluss
gesetzt. Bestandszeilen (`0`) fallen auf `last_heist_at + 12 h` zurück, damit
durch das Update niemand eine laufende Sperre verliert.

### 2 · Creator und Musik werden eine Einbahnstraße

| Richtung | heute | neu |
|---|---|---|
| Kanäle → Hörer (`CREATOR_SPILL`) | aktiv, 0,08 | **entfernt** |
| Hörer → Kanal-Publikum (`reachBonus`) | toter Code | **angeschlossen, als Untergrenze** |
| Releases → echte Follower (`SOCIAL_SPILL`) | aktiv, 0,05 | siehe unten |

**Die Kanäle eines erfolgreichen Musikers wachsen 1,2-mal schneller als die
eines reinen Creators — zusätzlich zur allgemeinen Beschleunigung aus
Abschnitt 4.** Die beiden Faktoren multiplizieren sich also: Verdreifacht sich
das Grundtempo, liegt der Musiker bei 3 × 1,2 = 3,6-fachem Kanalwachstum
gegenüber heute, der reine Creator bei 3-fachem.

Gemessen wird das am **Follower-Zuwachs pro Tag** im Vergleich zweier Konten
mit gleichem Zeiteinsatz, nicht am Endstand — der Endstand hängt auch daran,
wie viel Zeit ins Studio statt in die Kanäle geht.

**Ein großer Creator startet als Musiker bei null.** `reachOf` rechnet nur noch
mit echten Hörern; der Parameter `cross` und die Übergabe von `creatorReach`
entfallen.

**Ein großer Musiker startet als Creator mit großen Kanälen.** Zwei Teile:

- **Untergrenze:** `effektive Gesamtreichweite = max(Follower, Hörer × 0,18)`.
  Kein Summand — ein Hörer zählt einmal, nicht zweimal. Die Grenze gilt auf die
  **Gesamtreichweite**, nicht je Kanal; sonst zählte derselbe Hörer viermal.
- **Startbonus:** Beim ersten Anlegen eines Kanals werden Follower in Höhe
  dieser Untergrenze einmalig echt gutgeschrieben. Damit ist die Zahl sichtbar
  statt nur rechnerisch. Weil die Untergrenze ohnehin gilt, verschenkt der
  Bonus nichts Zusätzliches.
- **Missbrauchsschutz:** einmal je Konto **und Plattform**, in der Datenbank
  vermerkt. Sonst wäre Kanal löschen und neu anlegen eine Follower-Quelle, und
  Follower speisen Merch und Sponsorenverträge.

### 3 · Musik-Einnahmen neu zusammengesetzt

Alle drei Einnahmen werden von der `monetization`-Konstruktion auf ein
**reines Potenzgesetz** umgestellt: `Ertrag = k × Größe^Exponent`, Exponent
kleiner als 1. Damit ist jede Einnahme im Spiel unterlinear.

| Quelle | Formel neu | Exponent | Faktor `k` |
|---|---|---|---|
| Tantiemen | `k × Hörer^0,9` | 0,9 | so, dass bei **194.661 Hörern** der heutige Wert **27.610/Tag** erhalten bleibt |
| YouTube | `k × Publikum^0,85` | 0,85 | derselbe Ankerpunkt |
| Merch | `k × Reichweite^0,92` (Exponent unverändert) | 0,92 | `MERCH_FACTOR` 0,05 → **0,241**, sodass 2,6 Mio Follower **250.000/Tag** ergeben |

**Wirkung auf die Tantiemen** (Anker 194.661):

| Hörer | heute | neu |
|---|---|---|
| 10.000 | 414 | **1.909** |
| 100.000 | 8.722 | 15.161 |
| 194.661 | 27.610 | 27.610 |
| 500.000 | 141.202 | 64.535 |
| 872.183 | 369.720 | **106.480** |
| 2.000.000 | 1.380.000 | **224.724** |

Kleine und mittlere Künstler verdienen **mehr** als heute, nur die Spitze wird
gebändigt. Das Wachstum über die Spanne 10.000 → 872.183 Hörer fällt von 893×
auf 56×.

**Wirkung auf Merch** (`MERCH_FACTOR` 0,241, Heimatmarkt 1,3):

| Follower | heute | neu |
|---|---|---|
| 215.376 | 5.241 | **25.276** |
| 545.334 | 12.321 | **59.415** |
| 1.000.000 | 21.524 | **103.792** |
| 2.600.000 | 51.843 | **250.000** |

Dieser Hebel wirkt vor allem auf den **reinen Creator**: Sein gemessenes
Jahreseinkommen bestand zu 89 % aus Merch, wird also grob verfünffacht. Das
schließt einen großen Teil des 51-fachen Abstands, ohne die Rangfolge zu drehen.

`MERCH_DAILY_CAP` (heute 100.000) muss mit angehoben werden, sonst greift er
ab etwa einer Million Followern.

Der Merch-Hebel wirkt auch auf den **reinen Creator** — dort sind Merch heute
86 % der Einnahmen. Das schließt einen Teil des Abstands, ohne die Rangfolge
umzudrehen.

### 4 · Wachstum: asymmetrisch beschleunigt

Heute: knapp eine Million Follower nach drei Jahren. Ziel: **eine Million in
einem Jahr** — im Mittel dreifaches Tempo, aber **nicht gleich verteilt**:

| | Ziel | heute |
|---|---|---|
| Creator (leichter) | 1 Mio Follower in **~9 Monaten** | 36 Monate |
| Musik (schwerer) | die Hörerzahl, die das Zielbild aus Abschnitt 3 trägt, in **~15 Monaten** | 50.280 Hörer nach 36 Monaten |

Das ist die ausdrückliche Vorgabe: „Artist schwerer, Creator einfacher". Die
Musik zahlt ihre höhere Hürde durch das höhere Einkommen und den Übertrag auf
die Kanäle zurück.

**Die Hörerzahl ist bewusst kein eigener Zielwert.** Sie ergibt sich aus
Abschnitt 3: Wenn Tantiemen ~3 Mio und Konzerte ~4 Mio über die Karriere
tragen sollen, folgt daraus, wie viele Hörer wann da sein müssen. Eine zweite,
frei gesetzte Zahl daneben würde der ersten widersprechen.

Stellschrauben: für die Musik `REACH_K` und `CONVERSION`, für die Kanäle die
Reichweitenkurve in `creator.js`. Welche davon wie weit bewegt wird, entscheidet
die Messung — beide Kurven müssen unterlinear bleiben (§3).

### 5 · Erfolgs-Schwellen neu rechnen

Die Schwellen aus `2026-09-08-achievements-design.md` wurden gegen die alten
Raten geeicht — teils gegen die falsche Heist-Zahl. Sie verschieben sich in
**beide** Richtungen:

| Erfolg | Grund | Richtung |
|---|---|---|
| `worth_50m` Schwerreich | Einkommen steigt | Schwelle **hoch** |
| `depot_25m` Großkapital | Einkommen steigt | Schwelle **hoch** |
| `loot_50m` Beutezug | Heist-Ertrag sinkt von 215k auf 86k/Tag | Schwelle **runter** |
| `srv_pate` (100 Mio Diebesgut) | dito | Schwelle **runter** |
| `job_1000`, `fish_1000`, `level_100` | zeitbasiert, unberührt | unverändert |

Die neuen Werte werden aus der Messung abgeleitet, nicht geraten. Die `id`
jeder Regel bleibt unverändert — wer einen Erfolg hat, behält ihn.

## Wie die Zielwerte getroffen werden

Nicht durch Raten. Das Messskript aus der Analyse wird ein **Test im Projekt**
(`test/geldquellen.test.js`): Es fährt beide Karrieren mit festem Würfel,
gibt die Aufschlüsselung aus und prüft Grenzen.

Vorgehen: Stellschrauben drehen, messen, wiederholen, bis die Zielwerte stehen.
Danach bleibt der Test liegen und schlägt an, wenn eine spätere Änderung die
Zusammensetzung wieder kippt.

### Zwei Mängel der bisherigen Messung, die vor der Kalibrierung weg müssen

**1 · Die simulierte Spielweise ist zu schwach.** Die Aktionszählung über drei
Jahre ergab:

```
instagram/reel 1095 · twitter/ankuendigung 1095 · youtube/tutorial 86 · twitch/chatting 12
```

YouTube lief 86-mal, Twitch 12-mal — Instagram und Twitter fraßen das gesamte
Zeitbudget, weil das Skript stur das erste Format nimmt, das durchgeht. Daher
die auffällig niedrigen Werte (533 auf YouTube, 1.232 auf Twitch über drei
Jahre). Das ist ein Fehler des Skripts, nicht des Spiels.

Die Strategie muss vor der Kalibrierung: je Zeitscheibe das Format mit dem
besten **Ertrag je Zeiteinheit** wählen statt das erste passende, und Twitter
gezielt für die Community fahren, an der Merch hängt.

**2 · Ohne festen Würfel ist die Streuung größer als der Effekt.** Zwei Läufe
mit praktisch identischem Code:

| | Lauf A | Lauf B |
|---|---|---|
| Hörer nach 3 Jahren | 50.280 | 907 |
| Einnahmen/Tag | 6.749 | 1.391 |
| Faktor gegen reinen Creator | 6,36× | 1,07× |

Musikwachstum verstärkt sich selbst: Frühe gute Würfe wachsen sich aus, frühe
schlechte nie. Ein einzelner Lauf sagt deshalb nichts.

**Die Messung braucht:** festen Würfel (`mulberry32` wie in den übrigen Tests),
mindestens **50 Läufe je Archetyp**, und die Auswertung über den **Median**,
nicht den Mittelwert — bei einer Verteilung mit schwerem Ende zieht ein
einzelner Ausreißer den Mittelwert beliebig weit. Zusätzlich das 25-%- und
75-%-Quantil ausgeben, damit sichtbar ist, wie breit die Streuung ist.

Erst wenn diese beiden Punkte stehen, wird eine einzige Stellschraube bewegt.
**Alle bisher in dieser Spec genannten Ist-Zahlen sind damit vorläufig** und
werden durch die erste saubere Messung ersetzt.

## §3 — kein Gelddrucker

Die Rangfolge wird angehoben, die Grenze bleibt:

| | |
|---|---|
| **Gemeinsames Zeitbudget** | `music.useTime` delegiert an `creator.useTime`; 8 Einheiten am Tag für Musik **und** Kanäle zusammen. Beides voll zu betreiben ist unmöglich. |
| **Untergrenze statt Summe** | Ein Hörer zählt einmal. |
| **Einbahnstraße** | Creator speist Musik nicht mehr — kein Kreislauf, der sich hochschaukeln kann. |
| **Kurven bleiben unterlinear** | Vermarktung 0,73 · Merch 0,92 · Sponsoren 0,65 · Musik-Reichweite unterlinear |
| **Konzerte werden gedämpft** | Die einzige Auszahlung ohne Kurve wird gesenkt. |

Nachgerechnet wird das im Test, nicht behauptet.

**Bewusst in Kauf genommen:** Das ist eine spürbare Ausweitung der Geldmenge.
Endgame-Spieler verdienen nach der Änderung deutlich mehr, die Preise bleiben.
Große Ziele rücken damit näher — das ist die Absicht, nicht ein Nebeneffekt.

## Berührte Dateien

| Datei | Änderung |
|---|---|
| `src/data/heists.js` | `cooldownH` je Ziel |
| `src/heist.js` | Sperre je Ziel statt global |
| `src/db.js` | Spalte `cooldown_until`, Startbonus-Merker |
| `src/music.js` | `CREATOR_SPILL` raus, `reachBonus` angeschlossen, eigene Vermarktungskurve, `SHOW_PAY`, `SOCIAL_SPILL`, Wachstum |
| `src/creator.js` | `MERCH_FACTOR`, Wachstum, Untergrenze auf die Gesamtreichweite, Startbonus |
| `src/achievements.js` | vier Schwellen neu |
| `test/geldquellen.test.js` | neu — die Messung als Test |
| `test/heist.test.js`, `test/music.test.js`, `test/creator.test.js` | Anpassungen |
| `docs/.../2026-09-08-achievements-design.md` | Zahl 875.000 korrigieren |
| `ARCHITEKTUR.md` | Abschnitt zur Rangfolge der Geldquellen |
| `src/data/patchnotes.js` | Eintrag |

## Tests

1. **Die Rangfolge stimmt:** Musik+Creator > nur Creator > Heists, gemessen
   über simulierte Karrieren mit festem Würfel.
2. **Die Zusammensetzung stimmt:** Konzerte, Tantiemen und Merch liegen je in
   ihrem Zielkorridor; kein einzelner Posten trägt mehr als die Hälfte.
3. **Die Heist-Kurve ist aufsteigend:** EV pro Tag steigt über alle sieben
   Ziele monoton.
4. **Einbahnstraße:** Ein Konto mit großen Kanälen und null Hörern bekommt
   **keinen** Hörer-Vorteil. Ein Release bringt weiterhin Follower.
5. **Untergrenze statt Summe:** Ein Konto mit Followern **über** der
   Untergrenze bekommt durch Hörer keinen zusätzlichen Vorteil.
6. **Startbonus einmalig:** Kanal löschen und neu anlegen bringt kein zweites
   Mal Follower.
7. **Sperren-Migration:** Eine Bestandszeile ohne `cooldown_until` verliert
   ihre laufende Sperre nicht.
8. **§3:** Kein Kreislauf — hunderte Karrieren, in denen geprüft wird, dass
   sich Musik und Kanäle nicht gegenseitig hochschaukeln.
9. **Wachstumstempo:** Die erste Million wird im Zielkorridor erreicht
   (Creator ~9 Monate, Musik ~15 Monate).

Alle Tests ohne Netz (§12), fester Würfel.

## Reihenfolge der Umsetzung

Die Teile hängen zusammen — die Messung muss zuletzt stimmen, nicht nach jedem
Schritt. **Schritt 1 ist unabhängig vom Rest** und könnte auch allein
ausgeliefert werden, falls der Wirtschaftsteil länger dauert:

1. Heist-Sperren (unabhängig, kann zuerst und allein grün werden)
2. **Messskript, das etwas taugt**: bessere Creator-Strategie, fester Würfel,
   50 Läufe je Archetyp, Auswertung über Median und Quantile. Ergebnis ist der
   belastbare Ist-Zustand — er ersetzt alle vorläufigen Zahlen dieser Spec.
   **Dieser Schritt endet mit einer Vorlage der Messwerte, bevor irgendeine
   Stellschraube bewegt wird.**
3. Einbahnstraße Creator ↔ Musik
4. Musik-Einnahmen neu zusammensetzen, gegen die Messung kalibriert
5. Wachstum asymmetrisch beschleunigen, gegen die Messung kalibriert
6. Erfolgs-Schwellen aus den neuen Messwerten ableiten
7. Doku und Patchnotes
