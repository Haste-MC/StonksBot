# Beziehungen mit Kontakten, Stück 6a: Gedächtnis und Haltung

**Datum:** 2026-10-07
**Vorgänger:** 5a Kontakte (`2026-09-25-kontakte-design.md`), 5b Beef, 5c Angebote
**Nachfolger:** 6b (Wirkung der Beziehungsarten), 6c (Eigenleben der Kontakte)

## Das Problem

Der Draht aus 5a ist **eine** Zahl von −100 bis 100. Daraus folgen vier Lücken,
die beim Spielen auffallen:

1. **Kein Gedächtnis.** Draht 40 sieht gleich aus, ob er aus zwanzig flüchtigen
   Reaktionen kommt oder aus einem gemeinsamen Album.
2. **Keine Haltung.** Der Kontakt hat keine eigene Meinung über dich — nur
   deine Zahl über ihn.
3. **Ein Zustand ist nicht darstellbar.** „Er nimmt dich ernst, arbeitet aber
   nie mehr mit dir" ist genau das, was ein Disstrack erzeugt. Gemittelt ergibt
   es denselben Draht wie zweimal lauwarm.
4. **Das Durchziehen ist unsichtbar.** Ein fertiges Album zu zweit bewegt heute
   **null** Punkte Draht (`src/angebote.js:716`), ein verfallenes Projekt
   ebenfalls null (`src/angebote.js:304`). Die zwei größten Ereignisse des
   ganzen Systems sind für die Beziehung nicht vorhanden.

## Die Lösung in einem Satz

Gespeichert werden zwei Achsen — **Respekt** (wie ernst er dich nimmt) und
**Vertrauen** (ob er sich auf dich verlässt). Der Draht ist nur noch ihr
Mittelwert. Respekt öffnet die Antwort eines Großen, Vertrauen die mehrtägigen
Formate, und aus der Lage auf dieser Fläche folgt die **Art** der Beziehung.

Das ist eine **Umverteilung bestehender Chancen, keine neue Geldquelle** (§3).

---

## 1. Speicherung

### 1.1 Drei Spalten auf `contacts`

Über das vorhandene `PRAGMA table_info` + `ADD COLUMN`-Muster (`src/db.js`):

```
respekt    INTEGER NOT NULL DEFAULT 0     -- −100 … 100
vertrauen  INTEGER NOT NULL DEFAULT 0     -- −100 … 100
boden      INTEGER NOT NULL DEFAULT 0     --    0 …  30, Vertrauens-Boden
```

### 1.2 Die Wanderung

Im **selben** `if`, das die Spalten anlegt — läuft damit genau einmal:

```sql
UPDATE contacts SET respekt = draht, vertrauen = draht;
```

Am Tag der Wanderung ist jeder Draht auf den Punkt derselbe wie vorher, denn
`(d + d) / 2 = d` ohne Rundung. `boden` bleibt bei 0: Der Boden entsteht nur aus
Dingen, die nach der Wanderung abgeschlossen werden. Wer vorher ein Album zu
zweit gemacht hat, hat dafür ohnehin keinen Draht bekommen (Lücke 4) — es gibt
nichts, was rückwirkend gutzuschreiben wäre.

### 1.3 Die alte Spalte

`draht` bleibt in der Tabelle stehen, wird aber von **niemandem** mehr gelesen.
Geschrieben wird sie weiterhin, und zwar ausschließlich als abgeleiteter Wert in
derselben Anweisung wie die Achsen — damit kein zweites Buchführungssystem
entsteht, das auseinanderlaufen kann.

### 1.4 Das Gedächtnis

```sql
CREATE TABLE IF NOT EXISTS contact_memory (
  guild_id    TEXT    NOT NULL,
  user_id     TEXT    NOT NULL,
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  contact_id  TEXT    NOT NULL,
  at          INTEGER NOT NULL,
  art         TEXT    NOT NULL,
  detail      TEXT    NOT NULL DEFAULT '',
  d_respekt   INTEGER NOT NULL DEFAULT 0,
  d_vertrauen INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_contact_memory
  ON contact_memory (guild_id, user_id, contact_id, id DESC);
```

**`d_respekt` und `d_vertrauen` werden NIE für eine Rechnung gelesen.** Sie
stehen nur in der Zeile, damit die Ansicht „+18 Vertrauen" schreiben kann. Die
Achsen auf `contacts` sind die einzige Wahrheit. Das ist der Grund, warum die
Liste gekappt werden darf, ohne dass eine Zahl driftet — wer hier später
aggregiert, baut genau den Fehler ein, den diese Trennung verhindert.

Gekappt wird beim Einfügen auf `MEMORY_MAX = 12` je (Gilde, Spieler, Kontakt):
alles außer den neuesten zwölf nach `id DESC` wird gelöscht (`id` ist
AUTOINCREMENT, die Reihenfolge ist also die Einfügereihenfolge).

Geschrieben wird der Eintrag in **derselben Transaktion** wie die Achsen (§7,
§9) — eine Handlung, eine Buchung.

---

## 2. Die Arithmetik

Alles hier gehört in die **reine Hälfte** von `src/contacts.js` (keine
Datenbank, kein Zufall) und ist damit einzeln nachrechenbar.

### 2.1 Der abgeleitete Draht

```js
const drahtVon = (respekt, vertrauen) => Math.round((respekt + vertrauen) / 2);
```

### 2.2 Abkühlen

```js
/** Eine Achse Richtung Ziel, ohne Überschießen. */
function decayAchse(wert, punkte, boden = 0) {
  if (wert > boden) return Math.max(boden, wert - punkte);
  if (wert < 0) return Math.min(0, wert + punkte);
  return wert;
}
```

| Achse | je Woche | wohin |
|---|---|---|
| Respekt | `RESPEKT_DECAY_PRO_WOCHE = 1` | gegen 0 |
| Vertrauen | `VERTRAUEN_DECAY_PRO_WOCHE = 3` | von oben gegen `boden`, von unten gegen 0 |

Gerundet wird wie heute auf ganze Wochen (`Math.floor(tage / 7)`).

Solange Vertrauen über dem Boden steht, kühlt der Draht mit **(1 + 3) / 2 =
genau den heutigen 2 Punkten** ab.

Zwei Festlegungen, damit nichts im Unklaren bleibt:

- **Der Boden fällt nie.** Ein vermasseltes Projekt kostet hart Vertrauen,
  löscht aber nicht das Album, das vorher fertig wurde.
- **Der Boden zieht nicht nach oben.** Steht Vertrauen bei −50, steigt es wie
  heute gegen 0 und bleibt dort. Der Boden bremst den Fall, er heilt keinen
  Beef. Damit Vertrauen nie *unter* seinem eigenen Boden liegt, hebt jede
  Bewegung, die den Boden erhöht, in derselben Anweisung auch das Vertrauen auf
  mindestens den neuen Boden.

### 2.3 Der Boden

| Ereignis | Boden |
|---|---|
| großes Format **abgeschlossen** (Album zu zweit, Tour) | `BODEN_FERTIG = 10` |
| Gegenanfrage angenommen **und erfüllt** | `BODEN_AN = 3` |
| alles andere | 0 |

Deckel `BODEN_MAX = 30`.

„Erfüllt" ist dabei eindeutig: `tausch`, `gastpart`, `vorgruppe` und `label`
sind mit der Annahme erledigt und buchen den Boden sofort. `kollabo` und `tour`
erzeugen ein Projekt und buchen den Boden erst beim Abschluss — dann über
`BODEN_FERTIG`, nicht über `BODEN_AN`.

Zusagen und freundliche Antworten heben den Boden **nicht**. Nur Durchgezogenes
bleibt.

Bei Boden 30 und Respekt auf 0 landet der Draht bei 15 — unter „bekannt" (20)
und unter der Schwelle, ab der `angebote.gewichtOf` überhaupt Gegenanfragen
zulässt. Die Beziehung bleibt warm und öffnet nichts von allein.

---

## 3. Was welche Achse bewegt

Jedes Ereignis bewegt ein Paar. Wo in der Spalte „Mittel" **wie heute** steht,
ist der Mittelwert identisch zum heutigen Draht-Delta — die Spaltung ist dort
die einzige Änderung.

### 3.1 Anfragen (`src/data/contacts.js`, `ACHSEN`)

| Antwort | Respekt | Vertrauen | Mittel |
|---|---|---|---|
| `zusage` | +12 | +12 | +12, wie heute |
| `echt` | +9 | +3 | +6, wie heute |
| `fluechtig` | +3 | +1 | +2, wie heute |
| `ignoriert` | −2 | 0 | −1, wie heute |
| `verstimmt` | −8 | −2 | −5, wie heute |

Ein 🔥 zurück und ein echter Satz bringen fast nur Respekt. Eine Zusage bringt
beides.

### 3.2 Gegenanfragen und Projekte (`src/data/angebote.js`)

| Ereignis | Respekt | Vertrauen | Boden | Mittel |
|---|---|---|---|---|
| `ACHSEN_AN` angenommen | +4 | +12 | +3¹ | +8, wie heute |
| `ACHSEN_AB` abgesagt | −2 | −8 | — | −5, wie heute |
| `ACHSEN_VERFALL` verfallen lassen | −4 | −12 | — | −8, wie heute |
| `ACHSEN_FERTIG` Projekt abgeschlossen | +6 | +18 | +10 | **+12 (heute 0)** |
| `ACHSEN_PFUSCH` Projekt verfallen | −6 | −20 | — | **−13 (heute 0)** |

¹ nur bei `tausch`, `gastpart`, `vorgruppe`, `label` — siehe 2.3.

Die unteren zwei Zeilen sind die **einzige** absichtliche Erweiterung über die
heutige Bilanz hinaus. Sie schließen Lücke 4: Eine saubere Absage kostet fast
nichts, ein bezahltes Album verrotten zu lassen ist der härteste
Vertrauensverlust im Spiel.

### 3.3 Beef (`src/data/beef.js`)

| Ereignis | Respekt | Vertrauen | Mittel | heute |
|---|---|---|---|---|
| `ACHSEN_ANSTACHELN` | 0 | −24 | −12 | −15 |
| `ACHSEN_BLAMAGE` Diss floppt | −10 | −4 | −7 | −5 |
| `ACHSEN_DISS` Diss landet | **+10** | −36 | −13 | −20 |
| `ACHSEN_KONTER` er schlägt zurück | −6 | −14 | −10 | wie heute |
| `ACHSEN_ANGEZAEHLT` | −4 | −16 | −10 | wie heute |

Der gelandete Disstrack ist der Fall, der die Spaltung rechtfertigt: Er nimmt
dich **ernster** als vorher und lässt sich auf kein mehrtägiges Format mehr ein.

**Gemessen, und es korrigiert eine Behauptung dieser Spec:** Ein einzelner
Schlagwechsel macht aus einem Fremden **keinen** Rivalen. Anstacheln (0),
ein Diss (+10) und ein Konter (−6) ergeben netto **+4** Respekt — bei
Vertrauen −74 ist das Draht −35 und damit die Art `verstimmt`, nicht `rivale`
(der verlangt Respekt ≥ 30). Der Rivale entsteht auf genau zwei Wegen:

| Weg | |
|---|---|
| **Du hattest schon Standing.** Respekt ≥ 26 vor dem Beef — drei echte Antworten (je +9) reichen. | der Regelfall |
| **Ein langer Krieg.** Fünf gelandete Disse gegen zwei Konter: Respekt 38. | selten |

Das ist **besser als das, was hier ursprünglich stand**, und bleibt so: Ein
Niemand, der einen Weltstar einmal anpiekst und einen Konter kassiert, ist
dessen Rivale nicht — er ist jemand, über den der Star sich geärgert hat. Wer
ein Rivale werden will, muss vorher etwas bedeuten. Die Messung (§8.3) berichtet,
wie oft `rivale` im Messjahr tatsächlich vorkommt, damit die Art nicht
stillschweigend Dekoration bleibt.
Anstacheln bringt keinen Respekt — eine Provokation ist noch kein Treffer. Sich
zu blamieren kostet Respekt, nicht Vertrauen.

**Der Frieden** (`beef.frieden`) wirkt nur auf **Vertrauen**, mit der heutigen
Deckel-Logik unverändert übertragen:

```js
zielV = Math.max(v, Math.min(FRIEDEN_DECKEL, v + FRIEDEN_PLUS));
```

Respekt bleibt, wie er ist. Nach der Versöhnung arbeitet er wieder mit dir — und
respektiert weiterhin, was du getroffen hast.

---

## 4. Respekt öffnet die Antwort

### 4.1 Heute

```js
basis = Math.min(CHANCE_MAX, 0.6 * Math.sqrt(ratio));   // ratio = meine / seine
… + (draht / 100) * 0.25
```

### 4.2 Neu

Der Reichweiten-Term bleibt **unverändert**. Der additive Beziehungs-Term hängt
jetzt am Respekt, und sein Gewicht **wächst mit dem Abstand**:

```js
respektGewicht = RESPEKT_W_MIN
  + RESPEKT_W_SPAN * clamp(0, 1, Math.log10(seine / Math.max(100, meine)) / RESPEKT_W_DEKADEN)

… + (Math.max(0, respekt) / 100) * respektGewicht
  + Math.min(0, vertrauen / 100) * VERTRAUEN_MALUS
```

| Konstante | Wert |
|---|---|
| `RESPEKT_W_MIN` | 0,12 |
| `RESPEKT_W_SPAN` | 0,33 |
| `RESPEKT_W_DEKADEN` | 3 |
| `VERTRAUEN_MALUS` | 0,25 |

| Abstand | Gewicht | heute |
|---|---|---|
| gleich groß oder kleiner | 0,12 | 0,25 |
| 10× | 0,23 | 0,25 |
| 100× | 0,34 | 0,25 |
| 1000× und mehr | 0,45 | 0,25 |

**Die Grenze liegt bei Faktor 15,2** — darunter kostet die Umverteilung, darüber
zahlt sie. Gerechnet, nicht geschätzt:

| meine → seine | heute @ Draht 0 / 50 / 100 | neu @ Respekt 0 / 50 / 100 |
|---|---|---|
| 100k → 100k | 60,0 / 72,5 / 85,0 % | 60,0 / 66,0 / 72,0 % |
| 100k → 1 Mio | 19,0 / 31,5 / 44,0 % | 19,0 / 30,5 / 42,0 % |
| 100k → 10 Mio | 6,0 / 18,5 / 31,0 % | 6,0 / **23,0** / **40,0** % |
| 10k → 10 Mio | 1,9 / 14,4 / 26,9 % | 1,9 / **24,4** / **46,9** % |

**Positives Vertrauen hebt die Antwortchance nicht** — das ist Respekts Aufgabe.
**Negatives Vertrauen senkt sie** doppelt, und das zweite ist nötig:

```js
respektWirkt = Math.max(0, respekt) * (1 + Math.min(0, vertrauen / 100))
… + (respektWirkt / 100) * respektGewicht(meine, seine)
  + Math.min(0, vertrauen / 100) * VERTRAUEN_MALUS
```

Bei Vertrauen ≥ 0 ist der Faktor **1** und nichts ändert sich — alle Zahlen der
Tabelle oben gelten unverändert. Bei Vertrauen −100 ist der Respekt-Term **ganz
weg**.

**Warum der additive Malus allein nicht reicht — gemessen, und er widerlegt eine
frühere Fassung dieser Spec.** `VERTRAUEN_MALUS` sättigt bei −0,25, während der
Respekt-Term bis `1,0 × 0,45` läuft. Ein Spieler, der denselben Kontakt
wiederholt **disst** (nicht anstachelt — Anstacheln bringt 0 Respekt), sammelt
+10 Respekt je Treffer bei Vertrauen längst auf −100:

| Zustand (10k gegen 10 Mio) | R | V | nur additiv | **mit Dämpfer** |
|---|---|---|---|---|
| fremd | 0 | 0 | 6,9 % | 6,9 % |
| Rivale | 30 | −20 | 15,4 % | 12,7 % |
| 8 gelandete Disse | 68 | −100 | **12,5 %** | **2,0 %** |
| 12 gelandete Disse | 88 | −100 | **21,5 %** | **2,0 %** |
| echte Beziehung | 60 | 60 | 33,9 % | 33,9 % |

Ohne den Dämpfer ist der Dauer-Beefer ab acht Treffern **besser dran als ein
Fremder** — und schlimmer: `stufeVon` wiegt die Zusage mit `(1 + respekt/100)`
und liest **kein** Vertrauen, das Zusage-Gewicht stieg also dauerhaft auf 1,68
und mit ihm der Schub je Antwort. Damit hätte der Beef den **Ertrag** verändert
und nicht nur den Zugang, und das verletzt §3.

Deshalb liest **auch `stufeVon`** den gedämpften Respekt, nicht den rohen. Der
Rivale behält dabei 80 % seines Vorteils (12,7 % gegen 6,9 % beim Fremden) — er
bleibt ein echter, bevorteilter Zustand, nur kein Wachstumsweg.

### 4.3 Die Verbindlichkeit

`stufeVon(random, { ratio, draht })` wird zu `{ ratio, respekt }`: Das Gewicht
der `zusage` hängt am Respekt, nicht am Mittelwert. Begründung: Mit Vertrauen
wäre es selbstverstärkend (Vertrauen erzeugt Zusagen erzeugt Vertrauen), und
Respekt ist durchgehend die Achse, die über das Antworten entscheidet. Der `ratio`
bleibt der **rohe** Größenvergleich.

`staerkeOf` bleibt vollständig unverändert und rechnet weiter mit dem rohen
Abstand — die Höhe des Schubs darf nicht an der Beziehung hängen, sonst wandert
die Umverteilung in die Hörerzahlen (§3).

---

## 5. Vertrauen öffnet die großen Formate

Genau zwei Tore wechseln die Achse. Alles andere rechnet weiter mit dem
abgeleiteten Draht.

| Stelle | heute | neu |
|---|---|---|
| `REQUESTS` → `konzert` | `minDraht: 20` | `minVertrauen: 20` |
| `ARTEN` → `kollabo`, `tour`, `label` | `minDraht: 50` | `minVertrauen: 50` |

Unverändert am Draht: `angebote.gewichtOf` (ob er sich überhaupt meldet),
`ARTEN` → `tausch`/`gastpart`/`vorgruppe` (`minDraht: 20`), die Stufen 20/50/−20/−50.

`artenFuer` und `contacts.detail` müssen **beide** Felder behandeln; es gibt
einen neuen Ablehnungsgrund `'vertrauen'` mit eigenem Text in der Ansicht
(`🔒 Vertrauen 50 nötig`). Ein Eintrag, der beide Felder setzt, ist ein Fehler —
der Test prüft, dass jede Art genau eines trägt.

### 5.1 Die Erreichbarkeit ist das Risiko dieses Stücks — gemessen, nicht behauptet

Vertrauen 50 ohne je ein großes Format, brutto: 2 Zusagen (+24) + 2 angenommene
kleine Gegenanfragen (+24) + 2 echte Antworten (+6) = **54**. Mit dem Abkühlen
von 3 Punkten je Woche reicht das in **keinem** Zeitfenster:

| Zeitraum | brutto | nach Abkühlen |
|---|---|---|
| 2 Wochen | 54 | 48 |
| 4 Wochen | 54 | 42 |
| 8 Wochen | 54 | 30 |

Und das ist kein Zufall der Beispielfolge, sondern der Raten:

| | Vertrauen neu | Draht heute | Verhältnis |
|---|---|---|---|
| Abkühlen je Woche | 3 | 2 | **1,5× schneller** |
| je Zusage | +12 | +12 | 1,0× |
| je angenommene Gegenanfrage | +12 | +8 | 1,5× |
| je echte Antwort | +3 | +6 | **0,5×** |

**Vertrauen 50 ist damit strukturell schwerer zu erreichen als Draht 50 heute.**
Stünde das Tor für `kollabo`, `tour` und `label` ungeprüft bei 50, wäre es nur
noch durch ein abgeschlossenes Projekt zu öffnen — und ein Projekt entsteht
ausschließlich aus `kollabo` oder `tour`. Das ist derselbe Kreis, der in 5c das
Kollabo-Album unspielbar gemacht hat (174 von 195 Konten liefen mit vollen 18
Stunden ab).

**Blockierende Vorbedingung vor dem Merge.** Gemessen wird mit demselben Aufbau
wie 5c der Anteil der Konten, die binnen eines Jahres Vertrauen 50 erreichen,
gegen den heutigen Anteil, der Draht 50 erreicht. Liegt er darunter, geht
`minVertrauen` für die drei großen Formate in Stufen herunter — **50 → 45 → 40
→ 35** — bis die Anteile übereinstimmen. Zusätzlich wird gezählt, wie viele
`kollabo`- und `tour`-Projekte im Messjahr überhaupt zustande kommen; **null ist
ein Fehlschlag, nicht ein Ergebnis.**

Was dabei ausdrücklich **nicht** angefasst wird: die Asymmetrie des Abkühlens
(Respekt 1, Vertrauen 3). Sie trägt die ganze Aussage dieses Stücks — dass eine
vernachlässigte Beziehung von selbst zu „er kennt dich, verlässt sich aber nicht
mehr auf dich" wird — und sie hält den Draht-Verfall bei den heutigen 2 Punkten.
Das Tor ist der Hebel, nicht die Uhr.

---

## 6. Die Art der Beziehung

Eine **reine Funktion** über Respekt, Vertrauen, Boden, Größenverhältnis, `trait`
und einen hereingereichten `beefOffen`-Schalter — sechs Werte, die alle schon
vorliegen. Den Beef liest der Aufrufer, wie `contacts.detail` es heute schon tut;
`artOf` selbst fragt keine Datenbank. Kein Zustand, keine Spalte, nichts, was
driften kann.

`artOf(…)` liefert die **erste** Art, deren Bedingung passt:

| # | Art | Bedingung |
|---|---|---|
| 1 | `beef` | offener Beef |
| 2 | `rivale` | Respekt ≥ 30 **und** Vertrauen ≤ −20 |
| 3 | `verstimmt` | Draht ≤ −20 |
| 4 | `mentor` | `seine / meine ≥ 10` **und** Respekt ≥ 50 **und** Vertrauen ≥ 40 |
| 5 | `schuetzling` | `meine / seine ≥ 10` **und** Vertrauen ≥ 40 |
| 6 | `partner` | Respekt ≥ 50 **und** Vertrauen ≥ 50 |
| 7 | `band` | Boden ≥ 10 |
| 8 | `geschaeftlich` | `trait === 'geschaeftlich'` **und** Respekt ≥ 40 |
| 9 | `bekannt` | Draht ≥ 20 |
| 10 | `fremd` | sonst |

Die Reihenfolge ist Absicht, an drei Stellen:

- **`rivale` steht über `verstimmt`**, sonst verschwindet er: Respekt 30 bei
  Vertrauen −80 ergibt Draht −25 und hieße sonst nur „verstimmt".
- **`mentor` und `schuetzling` stehen über `partner`**, weil sie das
  Spezifischere sind.
- **`band` steht unter den warmen Arten**, damit sie das bedeutet, was sie sagt:
  Ihr habt ein Album zusammen, und seither ist es abgekühlt.

### 6.1 Eine einzige Partner-Regel

Heute existiert „Partner" in **drei** Fassungen, von denen zwei sich
widersprechen:

| | Regel | Stelle |
|---|---|---|
| Anzeige-Stufe | `draht ≥ 50` | `src/contacts.js:98` |
| `istPartner` | `yes ≥ 3` **oder** `draht ≥ 50` | `src/contacts.js:224` |
| Türöffner-Zählung | `draht ≥ 50` | `src/contacts.js:240` |

Die Ansicht zeigt das ⭐ nach der zweiten Regel und schreibt dazu „das öffnet
Türen im Umfeld" (`src/ui.js:3123`) — gezählt wird nach der dritten. **Wer drei
Zusagen bei Draht 30 hat, liest, dass er Türen öffnet, und öffnet keine.** Das
ist ein bestehender Fehler, kein Nebenprodukt von 6a.

Neu gibt es eine Regel:

```js
const istPartner = (respekt, vertrauen) => respekt >= 50 && vertrauen >= 50;
```

Sie gilt für alles: das ⭐, die +10 Punkte Antwortchance, die Türöffner-Zählung
(`contacts.js:240`) und `beef.js:399`. `PARTNER_YES` fällt weg — drei Zusagen
heben jetzt von sich aus beide Achsen um je 36, der Weg bleibt also, nur ehrlich.

Das ist mechanisch eine **Verschärfung**: Draht 50 ist heute mit Respekt 100 und
Vertrauen 0 erreichbar, also von jemandem, der sich nachweislich nicht auf dich
verlässt. Wie viele Partner dadurch wegfallen, wird gemessen (§8).

`artOf` ist davon unabhängig: Es kann „Mentor" liefern, während `istPartner`
wahr ist. Die Ansicht zeigt dann beides — die Art als Zeile, das ⭐ daneben.
`drahtStufe` wird durch `artOf` ersetzt und entfällt.

---

## 7. Die Ansicht

### 7.1 Kontaktansicht (`buildKontaktView`)

Die heutige Draht-Zeile wird zu drei:

```
🤝 Mentor · ⭐ fester Partner
   Draht ▓▓▓░░ 63 · 17 Versuche, 4 Zusagen
   Respekt ▓▓▓▓░ 72 · Vertrauen ▓▓▓░░ 54 (Boden 10)
```

Darunter das Gedächtnis, die neuesten `MEMORY_ZEIGEN = 3`:

```
📖 Was zwischen euch war
• vor 3 Tagen · Album zu zweit fertig gemacht (+18 Vertrauen)
• vor 2 Wochen · Gegenanfrage verfallen lassen (−12 Vertrauen)
• vor 5 Wochen · Zusage für eine gemeinsame Sache
_… und 6 weitere · 13 Mal kam nichts zurück_
```

Die letzte Zeile deckt „was du nur gewollt hast" ab — sie kommt aus
`tries − yes` und braucht keine Gedächtniszeilen. Ohne das wären es zwanzig
Zeilen „ignoriert" und die Liste wäre wertlos.

Die Länge ist durch `MEMORY_ZEIGEN` gedeckelt und braucht keinen
Kürzungshelfer: Drei Zeilen à höchstens rund 70 Zeichen können die Beschreibung
nicht sprengen. `buttons.notizAus` passt hier ausdrücklich **nicht** — sein
Überlauftext verweist auf die Vorfall-Ansicht („sie stehen im Verlauf der
Vorfall-Ansicht"), und das wäre an dieser Stelle gelogen.

### 7.2 Liste (`buildKontakteView`)

Statt der Stufe steht die Art. Die Sortierung bleibt unverändert (Gesperrte nach
hinten, dann beste Chance).

---

## 8. Tests und Messung

### 8.1 Der Paritätstest

Das wichtigste Testwerkzeug dieses Stücks. Für eine Folge von Ereignissen gilt:
Wenn jede Spaltung gleichmäßig ist und beide Abkühlraten 2 betragen, muss der
abgeleitete Draht **exakt** dem entsprechen, was die heutige Kette aus `decay`
und den heutigen Deltas liefert. Die alte Funktion `decay(draht, tage)` bleibt
dafür erhalten und ist das Referenzmodell im Test.

Was dieser Test beweist und was nicht — der Unterschied ist wichtig, weil der
Name mehr verspricht, als die Sache hält:

- **Er beweist:** Die Buchführung ist neutral. `decayAchse` mit Boden 0
  verhält sich wie `decay`, und `drahtVon(d, d)` ist `d`. Eine gemessene
  Änderung kommt also nicht aus einem Rechenfehler in der Umstellung.
- **Er beweist NICHT, dass das Spiel sich gleich verhält.** Mit den echten,
  ungleichen Paaren laufen die Ketten auseinander, und das ist Absicht.
  Gerechnet: Zwanzig echte Antworten ergaben früher Draht **100** (20 × +6,
  geklemmt); jetzt sättigt Respekt bei 100, während Vertrauen auf 60 steht,
  und der Draht bleibt bei **80**. Ebenso driftet eine Beziehung mit Respekt
  50 und Vertrauen −50 — heute Draht 0 — beim Abkühlen auf +1 nach einer
  Woche und +10 nach zehn, weil Vertrauen dreimal schneller gegen die Null
  läuft als Respekt.

Beides gehört **als eigene Zusicherung** in den Test, mit genau diesen Zahlen.
Sonst liest ein späterer Leser „Parität bestanden" und hält die gelieferten
Zahlen für neutral. Die Entartung des Paritätstests — beide Achsen tragen in
jedem Schritt dasselbe, die Rundung wird nie berührt — muss im Kommentar
dort stehen, wo der Test steht.

### 8.2 Weitere Zusicherungen

- `artOf`: jede der zehn Arten, und für jede Schwelle **beide** Seiten
  (Respekt 29 vs. 30, Vertrauen −19 vs. −20, Boden 9 vs. 10 …).
- Die drei Reihenfolge-Absichten aus §6 als eigene Fälle: der Rivale bei Draht
  −25 wird nicht „verstimmt"; der Mentor mit Respekt 60 / Vertrauen 60 wird
  nicht „partner", trägt aber `istPartner`; die alte Band mit Respekt 70 /
  Vertrauen 70 wird „partner", nicht „band".
- `istPartner`: ⭐, Antwortchance, Türöffner und `beef.js:399` zählen dasselbe —
  der Test stellt den heutigen Fehler nach (drei Zusagen bei Draht 30) und
  verlangt, dass ⭐ und Türöffner übereinstimmen.
- Der Vertrauens-Malus: der Dauer-Beefer landet auf `CHANCE_MIN`.
- Der Boden: fällt nie; zieht nicht nach oben; Vertrauen liegt nach keiner
  Bewegung unter seinem Boden.
- Die Erreichbarkeit aus §5.1 als Ablauf: Eine Folge aus Zusagen und kleinen
  Gegenanfragen über ein realistisches Zeitfenster erreicht das gesetzte Tor —
  der Test hält den nach der Messung festgelegten Wert fest, damit niemand ihn
  später stillschweigend wieder anhebt.
- Jede Art in `ARTEN`/`REQUESTS` trägt genau eines von `minDraht`/`minVertrauen`.

Alle Tests ohne Netz (§12), gesäte Würfel.

### 8.3 Messung

`scripts/messung-geldquellen.js`, dieselben Archetypen wie 5a bis 5c, gegen
`main` gepaart:

| | erwartete Richtung |
|---|---|
| Musiker + Creator, Kontaktpflege täglich | ± wenige Prozent |
| nur Musiker | leicht hoch (Weltstars erreichbarer) |
| nur Creator | ± wenige Prozent |
| Partner-Anteil der Kontakte | **runter** (die Verschärfung aus §6.1) |
| Verteilung der zehn Arten | jede muss vorkommen |

**Zusätzlich zu zählen:** Wie oft jede der zehn Beziehungsarten im Messjahr
auftritt. Eine Art mit **null** Vorkommen ist Dekoration, und zwei stehen unter
Verdacht: `rivale` (braucht Respekt ≥ 30, also vorheriges Standing oder einen
langen Krieg) und `schuetzling` (braucht, dass der Spieler zehnmal größer ist als
der Kontakt).

**Auslöser:** Steigt die Jahressumme eines Archetyps um mehr als **25 %** über
`main`, wird `RESPEKT_W_SPAN` gesenkt, bis es darunter liegt — und die Messung
wiederholt. Fällt eine Summe um mehr als 25 %, geht `RESPEKT_W_MIN` hoch.

Zusätzlich festzuhalten, weil es die ehrliche Grenze dieser Messung ist: Der
Respekt-Hebel wirkt nur, wo überhaupt Kontakte angeschrieben werden. Varianten
ohne `strat.kontakte` sind von diesem Stück unberührt und sagen über seinen
Deckel nichts.

---

## 9. Was ausdrücklich NICHT in diesem Stück ist

- **Die Wirkung der Arten.** Dass ein Mentor andere Gegenanfragen schickt, ein
  Rivale anders schreibt, eine alte Band leichter wieder zusammenkommt — das ist
  6b. 6a zeichnet die Karte und benennt sie; wirksam wird sie später.
- **Eigenleben.** Kontakte, die sich zwischen den Anfragen von selbst bewegen,
  sind 6c.
- **Neue Geldquellen.** Keine. Keine neue Einnahmeart, kein neuer Multiplikator
  auf eine bestehende. `staerkeOf` und `boostOf` bleiben unangetastet.
- **Romantische Beziehungen.** Nicht Teil dieses Stücks.
