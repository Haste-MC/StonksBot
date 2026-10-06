# Vorfälle bei Musik und Creator – von der Aktion auf den Tag

Stand 2026-10-06 · Anlass: gemeldet, dass Entscheidungs-Vorfälle bei Musik und
Creator „irgendwie nicht passieren, so wirklich wie bei der Firma".

## Der Befund, der dahintersteckt

Gemessen, nicht vermutet (validierter Treiber: der §3-Jahreslauf in
`test/musicEvents.test.js`). Der Mechanismus ist **nicht kaputt** – eine
Karriere, die ein Jahr lang *jeden Tag* aufnimmt, veröffentlicht und spielt und
dabei auf 470.000–590.000 Hörer kommt, bekommt **7 bis 16 Vorfälle im Jahr**
(Median 10). Eine Firma der Größe 1–3 kommt auf 9,7–14,6. Drei Dinge stapeln
sich aber, bis davon für einen echten Spieler nichts übrig bleibt:

1. **Mindest-Reichweite.** Jede Musik-Entscheidung braucht Hörer: `plagiat`,
   `stimme` und `label` ab **5.000**, `album_leak` ab 10.000, `skandal` ab
   20.000 (`src/data/musicDecisions.js`). Beim Creator brauchen **11 von 12**
   mindestens 10.000 Follower; nur `hardware` (Twitch) geht ab null
   (`src/data/decisions.js`). Darunter ist `possible` leer, `roll` gibt `null`
   zurück – es wird gewürfelt und das Ergebnis weggeworfen.
2. **Je Aktion statt je Tag.** `riskFor(reach)` liefert 2 % je Aktion, 4 % erst
   ab 1,5 Mio Reichweite (`src/decisions.js:77`). Erwartungswert: **50
   Aktionen** bis zum ersten Vorfall. Die Firma rechnet dagegen
   `1 − (1 − p)^Tage` mit 2–8 % **je abgerechnetem Tag**
   (`src/company.js:365-371`) und feuert deshalb 7–29 Mal im Jahr, unabhängig
   davon, wie oft jemand klickt.
3. **Eine Sperre für alles.** `db.openEvent` und `db.lastEventAt` fragen nur
   nach `(guild_id, user_id)` (`src/db.js:2390`, `:2402`). Ein einziger offener
   oder frischer Vorfall sperrt Musik, Creator **und** Firma gleichzeitig – und
   die Firma feuert am häufigsten.

## Ziel

Vorfälle sollen an der **Zeit** hängen, nicht am Fleiß, und schon in den ersten
Wochen etwas zu entscheiden geben – ohne dass die drei Bereiche sich
gegenseitig die Vorfälle wegnehmen.

## Nicht-Ziele

- Keine neuen Wirkungen und keine neuen Ausgänge für die vorhandenen
  Entscheidungen. Nur **wann** sie kommen ändert sich, nicht **was** sie tun.
- Keine Änderung an den Firmen-Vorfällen. Die Firma ist das Vorbild, nicht der
  Patient.
- Kein neuer Geldweg. Vorfälle kosten und bringen heute schon Geld; die
  Beträge bleiben, wie sie sind (§3 greift trotzdem, siehe unten).
- Keine Vorfälle, die ohne Zutun Geld bewegen: Es bleibt dabei, dass ein
  Vorfall eine **Entscheidung** verlangt und erst die Antwort bucht.

## Was heute gilt (gegen den Code geprüft)

| | Quelle |
|---|---|
| `roll(guildId, userId, size, now, random, domain)` mit `domain ∈ { creator, music, company }` | `src/decisions.js:128` |
| Gewürfelt wird je Aktion: `record`, `publish`, `show`, `creator.act` | `src/music.js:448`, `:610`, `:867`, `src/creator.js:970` |
| Die Firma würfelt je abgerechnetem Tag in `company.settle` | `src/company.js:672` |
| `RISK_MIN 0.02`, `RISK_MAX 0.04`, `RISK_FULL 1_500_000`, `MIN_GAP_MS` 36 h, `DECIDE_MS` 24 h | `src/decisions.js:38-46` |
| `SEVERITY_MAX 1.6` ab `SEVERITY_FULL 3_000_000`; `scaleMoney` skaliert die Beträge mit der Reichweite | `src/decisions.js:63-89` |
| Tabelle `creator_events` mit einer Spalte `platform` (`'music'`, `'company'` oder eine Creator-Plattform) | `src/db.js` |
| 12 Creator-, 5 Musik-, 6 Firmen-Entscheidungen | `src/data/decisions.js`, `musicDecisions.js`, `companyDecisions.js` |
| `creator.settle` ist **YouTube-spezifisch** (Lagerabrechnung) und taugt nicht als Heimat eines allgemeinen Wurfs | `src/creator.js:641-650` |

## Die Wahrscheinlichkeit zieht von der Aktion auf den Tag

`decisions.tick(guildId, userId, domain, size, now, random)` ist der neue
Eingang. Er rechnet faul ab (§4) und würfelt über die vergangenen Tage, in
derselben Form wie die Firma:

```
p(reichweite) = clamp(RISK_MIN_DAY, RISK_MAX_DAY,
                      RISK_MIN_DAY + (reichweite / RISK_FULL) × (RISK_MAX_DAY − RISK_MIN_DAY))
chance(tage)  = 1 − (1 − p)^min(tage, ROLL_TAGE_MAX)

RISK_MIN_DAY = 0,02 · RISK_MAX_DAY = 0,08 · RISK_FULL = 1_500_000 (unverändert)
ROLL_TAGE_MAX = 14      (dieselbe Zahl wie MAX_SETTLE_DAYS bei den Tantiemen)
```

Von Hand nachgerechnet:

| Reichweite | p je Tag | erwartet je Jahr | Chance, in 30 Tagen mindestens einen zu sehen |
|---|---|---|---|
| 0 (Anfänger) | 0,0200 | **7,3** | 45,5 % |
| 100.000 | 0,0240 | 8,8 | 51,8 % |
| 500.000 | 0,0400 | **14,6** | 70,6 % |
| 1 Mio | 0,0600 | 21,9 | 84,4 % |
| ≥ 1,5 Mio | 0,0800 | **29,2** | 91,8 % |

Dieselbe Spanne wie die Firma (Größe 0 = 7,3/Jahr, Größe 9 = 29,2/Jahr). Die
36-Stunden-Sperre deckelt rechnerisch bei 243 im Jahr und bindet damit nie.

**Die Würfe je Aktion entfallen** – `record`, `publish`, `show` und
`creator.act` rufen `decisions.roll` nicht mehr. Blieben beide Wege stehen,
addierten sich die Raten.

**Die Uhr** steht in einer eigenen kleinen Tabelle, nach dem Muster von
`angebot_uhr` aus 5c:

```
decision_uhr (guild_id, user_id, domain, last_roll, PRIMARY KEY (guild_id, user_id, domain))
```

`domain` ist `'music'` oder `'creator'`. Die Firma bleibt bei ihrem eigenen Weg
über `company.settle` – sie hat die Tage dort ohnehin schon zur Hand.

**Aufgerufen** wird `tick` aus den fauligen Sammlern, die es schon gibt:
`settleMusic` und `settleCreator` in `src/buttons.js` (dort steht bereits
`decisions.settle`). Damit hängt der Wurf an denselben Stellen wie jede andere
faule Abrechnung – kein neuer Zustellweg, und er kann nicht verschluckt werden.

**Abwesenheit zählt mit, gedeckelt.** Wer drei Wochen weg war, holt höchstens
14 Tage nach, und es bleibt bei **einem** offenen Vorfall je Bereich: Der Wurf
bricht ab, sobald einer offen ist.

## Ein Satz Entscheidungen „vom Anfangen"

Entscheidungen bekommen eine **Obergrenze** als Gegenstück zur vorhandenen
Untergrenze. Ohne sie klopfte der gekündigte Proberaum noch bei zwei Millionen
Hörern an.

```
FRUEH_MAX = 10_000     // darüber verschwinden die frühen Vorfälle wieder
```

Vier neue Einträge, Schwelle 0, `maxReach: FRUEH_MAX`, zwei für die Musik und
zwei für den Creator – Dinge, die nur einem Niemand passieren:

| Bereich | Vorfall | Feld | Worum es geht |
|---|---|---|---|
| Musik | `proberaum` | `maxListeners` | Der Proberaum wird gekündigt. Teurer nehmen, im Schlafzimmer aufnehmen, oder eine Weile pausieren? |
| Musik | `kleiner_auftritt` | `maxListeners` | 50 € für einen Auftritt vor zwanzig Leuten, drei Stunden Fahrt. |
| Creator | `erster_sponsor` | `maxReach` | Die erste Anfrage überhaupt – und sie klingt zu gut, um sauber zu sein. |
| Creator | `festplatte` | `maxReach` | Die Platte mit dem ganzen Rohmaterial stirbt. Datenrettung zahlen oder alles neu machen? |

Das neue Feld heißt in beiden Katalogen so wie sein vorhandenes Gegenstück:
`maxListeners` bei den Musik-Entscheidungen (die `minListeners` tragen),
`maxReach` bei den Creator-Entscheidungen (die `minReach` tragen).

Die Beträge laufen durch das vorhandene `scaleMoney`, das sie an der Reichweite
misst – bei einem Anfänger sind das zweistellige Summen, und genau so soll es
sein. Die Texte sind Spielfiktion und nennen keine reale Person.

## Je Bereich eine Sperre

`db.openEvent` und `db.lastEventAt` bekommen einen Bereichsfilter. Er wird aus
der vorhandenen Spalte `platform` abgeleitet – `'music'` ist Musik,
`'company'` ist Firma, alles andere Creator –, **kein Schema-Update nötig**.

Folge: höchstens ein offener Vorfall **je Bereich** statt einer im ganzen
Spiel, also bis zu drei gleichzeitig, aber nie zwei aus derselben Richtung. Die
36 Stunden Abstand bleiben und gelten ebenfalls je Bereich.

Das ist der dritte Grund aus dem Befund: Weil die Firma am häufigsten feuert,
nahm sie der Musik bisher die Vorfälle weg.

## §3, Messung, Tests

**Warum das kein Geldrucker ist:** Es kommt keine neue Einnahme dazu. Dieselben
Entscheidungen mit denselben Ausgängen kommen nur häufiger und früher, und die
Ausgänge des Schweigens sind schon heute teurer als die des Antwortens
(`src/decisions.js:49-51`). Der Umbau kann die Bilanz also in **beide**
Richtungen verschieben – das ist genau das, was gemessen werden muss.

**Messung:** ein Jahr mit und ohne Vorfälle, beide Archetypen (Musik+Creator
und nur Musik), gleiche gesäte Würfel, gegen denselben **+25 %**-Auslöser wie
bei 5b und 5c. Dazu die Zahl, um die es eigentlich geht:

- **Vorfälle je Jahr, aufgeschlüsselt nach Reichweite** – mindestens drei
  Stufen (Anfänger unter 5.000, Mitte um 100.000, groß über 1 Mio), damit
  belegt ist, dass ein Anfänger jetzt wirklich welche sieht. Erwartung aus der
  Tabelle oben: 7,3 / 8,8 / 29,2.
- **Wie viele davon frühe Vorfälle sind** und ab wann sie verschwinden.
- **Der Abstand zwischen zwei Vorfällen** – die 36 Stunden dürfen nicht
  gerissen werden, auch nicht über Bereichsgrenzen hinweg innerhalb eines
  Bereichs.
- **Was die Trennung der Sperre bringt:** derselbe Lauf mit und ohne
  Bereichsfilter, damit die Behauptung „die Firma nahm der Musik die Vorfälle
  weg" eine Zahl bekommt und keine Vermutung bleibt.

Vor jeder abgeleiteten Zahl eine Handprüfung gegen einen Einzelfall. Eine
stille Null ist ein Fehler, kein Ergebnis. Liegt eine Variante über +25 %
gepaart, wird `RISK_MAX_DAY` gesenkt und neu gemessen; beide Werte stehen im
Bericht.

**Tests** (ohne Netz, §12):

- Rein: `riskPerDay` an den fünf handgerechneten Punkten · `chance(tage)` mit
  dem Deckel bei 14 · `maxReach` schließt oberhalb aus und `minReach` unterhalb.
- Zustand: `tick` würfelt höchstens einmal je Tag und holt höchstens
  `ROLL_TAGE_MAX` nach · bei einem offenen Vorfall desselben Bereichs passiert
  nichts · ein offener **Firmen**-Vorfall blockiert die Musik **nicht** mehr ·
  die Uhr wird nur geschrieben, wenn gewürfelt wurde · `record`, `publish`,
  `show` und `creator.act` würfeln **nicht** mehr (sonst addieren sich die Raten).
- Regression: die §3-Prüfung in `test/musicEvents.test.js` läuft weiter und
  bekommt die neue Erwartung; die bestehende Zusicherung „über 5 Jahre
  zusammen mindestens 35 Vorfälle" darf nur **strenger** werden, nicht
  schwächer.

---

## Addendum nach der Messung (2026-10-06)

Gemessen mit `node scripts/messung-geldquellen.js 10|30|60 365 --nur=vorfaelle`,
vollständige Ausgabe in `docs/messungen/2026-10-06-vorfaelle.txt`. Jede Zahl
unten steht dort mit demselben Wert.

### Musste `RISK_MAX_DAY` gesenkt werden? Nein.

Der Auslöser „über ±25 % gepaart" ist in **keiner** Richtung erreicht:
Musik+Creator liegt bei **−8,1 % / −7,4 % gepaart**, der reine Musiker bei
**−17,2 % / −16,9 % gepaart** (60 Läufe à 365 Tage, 2 bzw. 5 von 60 Seeds im
Plus). `RISK_MIN_DAY` bleibt 0,02, `RISK_MAX_DAY` bleibt 0,08, `ROLL_TAGE_MAX`
bleibt 14, `MIN_GAP_MS` bleibt 36 h, `FRUEH_MAX` bleibt 10.000 – keine Konstante
dieses Stücks ist angefasst worden.

Die Treppe ist trotzdem erwähnenswert, weil sie die Lehre von 5b und 5c
wiederholt: Bei **10** Läufen stand der reine Musiker bei −22,1 %, bei **30** bei
−22,2 %, bei **60** bei −16,9 %. Hätte die Messung bei den 10 Läufen gestoppt,
die das Aufgabenheft nennt, wäre sie **2,8 Prozentpunkte** vor dem Auslöser
stehen geblieben und hätte dieselbe Einstellung deutlich schlechter aussehen
lassen, als sie ist.

### Was die Messung gegen die Spec sagt

| | Spec | gemessen |
|---|---|---|
| Vorfälle/Jahr bei 0 (Musik / Creator) | 7,3 | **6,90 ± 0,24 / 6,89 ± 0,22** |
| bei 100.000 | 8,8 | **8,44 ± 0,27 / 8,42 ± 0,26** |
| bei 500.000 (Musik) | 14,6 | **13,78 ± 0,35** |
| bei ≥ 1,5 Mio | 29,2 | **26,43 ± 0,46 / 26,48 ± 0,46** |

**Die Tabelle oben in dieser Spec ist als Obergrenze richtig gerechnet und als
Vorhersage falsch.** `365 × p` nimmt an, dass jeder der 365 Würfe zählt. Er
zählt nicht: Jeder Vorfall sperrt über `MIN_GAP_MS` den Wurf des **folgenden**
Tages (ein Wurf je Tag, 24 h < 36 h). Die ehrliche Erwartung ist deshalb

```
I = p × (365 − I)   ⟹   I = 365 × p / (1 + p)
```

also 7,16 / 8,55 / 14,04 / 27,04 – und **die** trifft die Messung auf 96,3 bis
98,7 % bei höchstens 1,3 σ. Der Abstand zur Spec-Zahl wächst mit der Rate
(−5,5 % bei null, −9,5 % bei 1,5 Mio), weil es bei 29 Vorfällen mehr gesperrte
Folgetage sind als bei 7.

**Damit ist ein Satz dieser Spec widerlegt:** „Die 36-Stunden-Sperre deckelt
rechnerisch bei 243 im Jahr und bindet damit nie." Die 243 sind richtig, der
Schluss ist falsch. Die Sperre bindet bei **jedem einzelnen** Vorfall, weil ein
Wurf je Tag fällt und der nächste Tag innerhalb der 36 Stunden liegt: Der
kleinste gemessene Abstand zweier Vorfälle desselben Bereichs ist in **jeder**
Stufe genau 48,0 Stunden, nie 24 und nie 36. Gekostet hat das p × Vorfälle Würfe
je Jahr – gemessen 206 gegen gerechnet 211,4 bei 1,5 Mio, 11 gegen 13,8 bei null.

**Die Spalte „Chance, in 30 Tagen mindestens einen zu sehen" misst nicht das,
was `chanceOver` liefert.** 45,5 % bei p = 0,02 ist `1 − (1 − p)^30`, also 30
einzelne Tageswürfe. `chanceOver(reichweite, 30)` gibt 24,6 %, weil
`ROLL_TAGE_MAX` die **nachgeholten** Tage auf 14 deckelt. Beide Zahlen sind
richtig und antworten auf zwei Fragen; für das normale Spiel (ein Wurf je Tag)
gilt die Spalte, für die Rückkehr nach drei Wochen gilt `chanceOver`. Die Spalte
bleibt stehen, aber sie ist keine Zeile aus dem Code.

### Abweichungen zwischen Spec und gebautem Code

1. **Eine Tür, die die Spec nicht vorsah.** `decisions.betreten` lässt nur
   würfeln, wer den Bereich benutzt hat (`music.started` bzw. `actions > 0` auf
   einem Kanal). Die Spec sagte nur „aufgerufen wird `tick` aus den fauligen
   Sammlern" – ohne Tür hätte ein einziger Blick in die Creator-Ansicht gereicht,
   weil `creator.settle` die Kanalzeile beim ersten Zugriff anlegt und
   `reachTotalOf` den Boden einer Musikkarriere mitzählt. Gemessen über je 365
   Tage mit 100.000 Reichweite im Aufruf: nur geschaut **0** Vorfälle, nur Musik
   **0**, wirklich gesendet **8**.
2. **`decisions.roll` verlangt für `music` und `creator` jetzt `schonGewuerfelt`
   und wirft sonst einen Fehler.** Die Spec verlangte nur, dass die Würfe je
   Aktion entfallen; der Fehler ist die Zusicherung, dass neben dem Tageswurf
   keine zweite Rate entstehen kann. Die Vorgabe-Domäne `'creator'` ist
   entfallen.
3. **`tick` hängt an mehr Türen als den zwei genannten.** Die Spec nannte
   `settleMusic` und `settleCreator` in `src/buttons.js`; gebaut gehen auch das
   Menü, `/creator` und `!creator` auf Fluxer über `settleCreator`, damit der
   Wurf auf keinem Weg verschluckt wird.
4. **Das Nicht-Ziel „keine Änderung an den Firmen-Vorfällen" hält im Code und
   nicht im Verhalten.** An `company.riskFor`, `company.settle` und am
   Firmenkatalog ist nichts geändert. Die Firma **feuert aber messbar häufiger**,
   weil ein offener Musik- oder Kanal-Vorfall ihre Abrechnung nicht mehr
   aufhält: 18,16 gegen 17,42 Vorfälle im Jahr bei Größe 5, also **+4,2 %** (für
   den Spieler, der nie antwortet: +5,1 %). Das ist die gewollte Folge der
   getrennten Sperre, aber es ist eine Änderung auf dem Firmenpfad, und sie
   gehört in die Bilanz.
5. **Die Behauptung des Aufgabenhefts zu `messung-geldquellen.js:1456` trifft
   nicht zu.** Zeile 1456 gehört zum FIRMENLAUF, und der würfelt über
   `company.settle` weiter wie immer (Gegenprobe: Kiosk, 365 Tage, **8**
   Vorfälle, erwartet 7,16). Die stille Null steckte in `karriere` – dem
   Karriere-Lauf, aus dem jede Archetypen-Zahl in §15 kommt: Er hatte keinen
   Vorfallszähler und rief `tick` nicht, konnte also seit Stück 2 keinen Vorfall
   mehr bekommen und hätte schweigend null gemeldet. Deshalb prüft jetzt jede
   Variante „aus" auf Vorfälle **und** auf Würfe.
6. **Die Regression im §3-Treiber ist strenger geworden, aber ihre dokumentierte
   Zahl war falsch.** `test/musicEvents.test.js` nannte „gemessen 41"; gemessen
   sind **47** über fünf Jahre. Die Schwelle bleibt bei 35 (sie durfte nur
   strenger werden), der Name nennt jetzt die echte Zahl. Woher der Sprung kommt,
   ist gemessen und nicht geraten: dieselben fünf Seeds an `e4582dc` (Σ 41) und
   `9c3e97f` (Σ 47), in Wegwerf-Arbeitsbäumen. `9c3e97f` ist der Commit der vier
   frühen Vorfälle – **+1,2 Vorfälle je Jahr**, die vorher unter 5.000 Hörern in
   eine leere Kandidatenliste gefallen sind. Eine unabhängige Nachrechnung hatte
   diesen Verlust auf 0,65 je Jahr geschätzt; er war fast doppelt so groß.
7. **Der Rest steht wie geschrieben.** `decision_uhr (guild_id, user_id, domain,
   last_roll)`, die Felder `maxListeners` und `maxReach` neben ihren vorhandenen
   Gegenstücken, `FRUEH_MAX` 10.000 (inklusiv – bei 10.000 Hörern sind die frühen
   Vorfälle noch möglich, bei 20.000 nicht mehr, und genau so steht es in der
   Messung), die Beträge über `scaleMoney`, der Bereichsfilter aus der
   vorhandenen Spalte `platform` ohne Schema-Update, die Sperre je Bereich und
   der Deckel von 14 nachgeholten Tagen.

### Was die Trennung der Sperre wirklich bringt

Die Spec sagte: „Weil die Firma am häufigsten feuert, nahm sie der Musik bisher
die Vorfälle weg." Das ist wahr und kleiner als die Formulierung klingt. Derselbe
Lauf mit und ohne Bereichsfilter (100 Seeds à 365 Tage, Musik 100.000 Hörer,
Kanäle 100.000 Reichweite, Firma Größe 5), für den Spieler, der jeden Vorfall am
Tag seines Auftretens beantwortet: **Musik +14,4 %** (8,41 gegen 7,35),
**Creator +17,5 %** (8,93 gegen 7,60), zusammen +9,7 %. Ohne Filter verlor die
Musik 1.742 von 36.500 Würfen an einen fremden offenen Vorfall – 4,8 % der Tage.

**Und eine Mechanik, die in der Spec nicht steht:** Die Sperre durch `openEvent`
ist **aufschiebend**, die durch `MIN_GAP_MS` ist **endgültig**. Bricht `tick`
wegen eines offenen Vorfalls ab, wird die Uhr nicht geschrieben, und der nächste
Wurf deckt zwei Tage mit der doppelten Chance. `MIN_GAP_MS` greift dagegen erst
**nach** `saveDecisionUhr` – dieser Wurf ist weg. Deshalb hat ein Spieler, der
nie antwortet, von der Trennung fast nichts (+0,9 % statt +14,4 %), obwohl er
5.186 von 36.500 Musik-Tagen ohne Wurf verbringt.

### Was §3 dazu sagt

**Kein Geldrucker, und zwar deutlicher als erwartet.** Der Posten „Vorfall" im
Konto ist winzig: **−559** am Tag beim reinen Musiker von 18.907 Differenz
(3,0 %) und **−3.061** bei Musik+Creator von 39.976 (7,7 %). Die anderen 97 bzw.
92 Prozent sind verlorene Hörer und Follower, die sich nicht mehr verzinsen:
531.018 statt 693.797 Hörer (−23,5 %) und 4.695.384 statt 6.399.765 Follower
(−26,6 %). Ein Vorfall ist damit keine Geldsenke, sondern eine Wachstumsbremse –
für §3 die konservative Richtung. Der §3-Treiber in `test/musicEvents.test.js`
sieht mit anderer Spielweise und anderen Seeds dasselbe: Hörer-Median 441.957
gegen 568.264, Faktor 0,778.

**Die Karriere ist nicht die Stufe.** Der reine Musiker bekommt **9,73** Vorfälle
im Jahr, nicht die 14,6 der Spec-Tabelle – weil er 531.018 Hörer erst am
Jahresende erreicht und die ersten Monate unter 100.000 verbringt, wo p bei
0,020…0,024 liegt. Musik+Creator bekommt **31,85** (Musik 9,27, Creator 22,58),
weil die Gesamtreichweite seiner Kanäle früh über 1,5 Mio geht und p dort am
Deckel klebt. Wer die Tabelle oben auf eine Karriere anwendet, liest die Zahl
eines Spielers, der zwölf Monate lang Weltstar war.
