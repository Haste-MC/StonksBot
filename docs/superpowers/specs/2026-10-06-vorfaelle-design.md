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
