# Vorfälle bei Musik und Creator – Implementierungsplan

> **Für agentische Arbeiter:** ERFORDERLICHE SUB-SKILL: `superpowers:subagent-driven-development`.
> Schritte tragen Kästchen (`- [ ]`).

**Ziel:** Entscheidungs-Vorfälle bei Musik und Creator hängen an der Zeit statt
am Fleiß, geben schon in den ersten Wochen etwas zu entscheiden, und die drei
Bereiche nehmen sich nicht mehr gegenseitig die Vorfälle weg.

**Architektur:** Ein neuer Eingang `decisions.tick(...)` würfelt faul über die
vergangenen Tage, in derselben Form, die `company.settle` schon benutzt. Die
Würfe je Aktion entfallen. Eine kleine Uhr-Tabelle trägt den Zeitstempel je
Bereich, und `db.openEvent`/`db.lastEventAt` bekommen einen Bereichsfilter aus
der vorhandenen `platform`-Spalte.

**Spec:** `docs/superpowers/specs/2026-10-06-vorfaelle-design.md` – sie ist die
Quelle jeder Zahl.

**Tech:** Node.js, better-sqlite3 (synchron), eigenes Testgerüst
(`test/*.test.js`, Ausgabe „N bestanden, M fehlgeschlagen").

## Globale Vorgaben

Jede Aufgabe erbt diesen Abschnitt.

- **§3 kein Geldrucker:** Es kommt keine neue Einnahme dazu. Dieselben
  Entscheidungen mit denselben Ausgängen kommen nur häufiger und früher. Die
  Beträge bleiben, wie sie sind.
- **§4 faul abrechnen:** `tick` rechnet beim Lesen, schreibt die Uhr nur, wenn
  gewürfelt wurde, und holt höchstens `ROLL_TAGE_MAX` Tage nach.
- **§7 synchron schreiben** vor dem ersten `await`. **§9 eine Buchung je
  Aktion** – ein Vorfall bucht nichts, erst die Antwort darauf.
- **§8 späte `require`** für Modulkreise. **§12 Tests ohne Netz.**
- **Es bleibt bei EINEM offenen Vorfall je Bereich.** Der Wurf bricht ab,
  sobald einer offen ist.
- **Kein Umbau an den Firmen-Vorfällen.** `company.settle` bleibt, wie es ist –
  es ist das Vorbild, nicht der Patient. Die bestehenden Firmen-Tests müssen
  Zahl für Zahl unverändert weiterlaufen.
- **Inhalt:** alle Texte sind Spielfiktion, nennen keine reale Person und
  keine Pronomen über einen Kontakt.
- **Deutsch:** Oberfläche, Kommentare und Commit-Nachrichten. Letzte Zeile jeder
  Commit-Nachricht exakt `Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>`.
- **Tests:** `rm -rf .testdata && DATA_DIR=.testdata node test/<x>.test.js`;
  ganze Suite `npm test 2>&1 | grep -c '❌'` → `0`. **Eine neue Testdatei gehört
  in das `test`-Skript in `package.json`.** `test/storage.test.js`,
  `test/activities.test.js`, `test/npc.test.js`, `test/buyers.test.js` und
  gelegentlich `test/music.test.js` würfeln unversiegelt und fallen selten im
  Suite-Lauf um – vorbestehend; bei einem `❌` dort einmal wiederholen und es
  sagen. Ein `❌` **in einem Testnamen** ist kein Fehlschlag.
- **Keine bestehende Erwartung abschwächen oder löschen.**

## Dateien

| Datei | Verantwortung |
|---|---|
| `src/decisions.js` | `tick`, der Tageswurf; Bereichsfilter an den Sperren |
| `src/db.js` | Tabelle `decision_uhr`; `openEvent`/`lastEventAt` mit Bereich |
| `src/data/decisions.js` | zwei frühe Creator-Vorfälle, `maxReach` |
| `src/data/musicDecisions.js` | zwei frühe Musik-Vorfälle, `maxListeners` |
| `src/music.js`, `src/creator.js` | die Würfe je Aktion entfallen |
| `src/buttons.js` | `tick` in `settleMusic` und `settleCreator` |
| `test/decisions.test.js` | der Tageswurf und die Sperren |
| `test/musicEvents.test.js` | die §3-Regression |
| `scripts/messung-geldquellen.js` | `--nur=vorfaelle` |

---

### Task 1: Der Tageswurf

**Dateien:**
- Ändern: `src/decisions.js`, `src/db.js`, `test/decisions.test.js`
  (existiert bereits, 257 Zeilen, steht schon im `test`-Skript von `package.json`)

**Schnittstellen:**
- Nutzt bestehend: `db.openEvent(guildId, userId)`, `db.lastEventAt(guildId,
  userId)`, `db.insertEvent({ guildId, userId, kind, platform, refId,
  createdAt, expiresAt })`, `decisions.roll(guildId, userId, size, now, random,
  domain)`.
- Liefert für Task 2–5: `decisions.tick(guildId, userId, domain, size, now,
  random)` → der angelegte Vorfall oder `null`; `decisions.riskPerDay(reach)`;
  `decisions.chanceOver(reach, tage)`; `decisions.ROLL_TAGE_MAX`;
  `db.decisionUhr(guildId, userId, domain)`, `db.saveDecisionUhr(guildId,
  userId, domain, lastRoll)`.

- [ ] **Schritt 1: Die Uhr-Tabelle in `src/db.js`**

Im selben `db.exec`-Block wie die anderen Tabellen, im Stil von `angebot_uhr`:

```sql
  -- Wann zuletzt um einen Vorfall gewürfelt wurde, je Bereich. Die Firma
  -- braucht keine Zeile: sie zählt ihre Tage in company.settle selbst.
  CREATE TABLE IF NOT EXISTS decision_uhr (
    guild_id  TEXT    NOT NULL,
    user_id   TEXT    NOT NULL,
    domain    TEXT    NOT NULL,          -- music | creator
    last_roll INTEGER NOT NULL DEFAULT 0,
    PRIMARY KEY (guild_id, user_id, domain)
  );
```

Dazu zwei Funktionen im Stil von `db.angebotUhr`/`db.saveAngebotUhr`:
`decisionUhr(guildId, userId, domain)` gibt eine Zeile mit Vorgaben zurück,
auch wenn keine existiert (**ohne** sie anzulegen – ein Lesen darf nicht
schreiben, §4), und `saveDecisionUhr(guildId, userId, domain, lastRoll)`
schreibt sie. Beide exportieren.

- [ ] **Schritt 2: Die zwei reinen Rechnungen in `src/decisions.js`**

Neben `riskFor`, das bleibt (die Firma benutzt es nicht, aber Task 4 räumt
erst zum Schluss auf):

```js
/** Wahrscheinlichkeit je TAG – dieselbe Spanne, die die Firma nach Größe nutzt. */
const RISK_MIN_DAY = 0.02;
const RISK_MAX_DAY = 0.08;
const ROLL_TAGE_MAX = 14;   // dieselbe Zahl wie MAX_SETTLE_DAYS bei den Tantiemen

function riskPerDay(reach) {
  return clamp(RISK_MIN_DAY, RISK_MAX_DAY,
    RISK_MIN_DAY + (Math.max(0, reach) / RISK_FULL) * (RISK_MAX_DAY - RISK_MIN_DAY));
}

/** Chance, in `tage` Tagen mindestens einen zu bekommen – wie company.riskFor. */
function chanceOver(reach, tage) {
  return 1 - Math.pow(1 - riskPerDay(reach), clamp(0, ROLL_TAGE_MAX, tage));
}
```

- [ ] **Schritt 3: Test für die Rechnungen, zuerst rot**

In `test/decisions.test.js`. Diese Werte sind gegen den Rechner geprüft und
dürfen **nicht** angepasst werden:

```js
const nah = (a, b, eps = 1e-9) => Math.abs(a - b) < eps;

check('Anfänger: 2 % je Tag', nah(decisions.riskPerDay(0), 0.02));
check('100.000 Reichweite: 2,4 %', nah(decisions.riskPerDay(100_000), 0.024));
check('500.000 Reichweite: 4 %', nah(decisions.riskPerDay(500_000), 0.04));
check('1 Mio Reichweite: 6 %', nah(decisions.riskPerDay(1_000_000), 0.06));
check('ab 1,5 Mio ist bei 8 % Schluss', nah(decisions.riskPerDay(1_500_000), 0.08));
check('und darüber bleibt es bei 8 %', nah(decisions.riskPerDay(5_000_000), 0.08));
check('negative Reichweite faellt auf den Boden', nah(decisions.riskPerDay(-5), 0.02));

check('ein Tag ist die Tageschance', nah(decisions.chanceOver(0, 1), 0.02));
check('zwei Tage zinsen auf', nah(decisions.chanceOver(0, 2), 1 - 0.98 * 0.98));
check('mehr als 14 Tage werden nicht nachgeholt',
  nah(decisions.chanceOver(0, 30), decisions.chanceOver(0, 14)));
check('null Tage geben nichts', nah(decisions.chanceOver(0, 0), 0));
```

```bash
rm -rf .testdata && DATA_DIR=.testdata node test/decisions.test.js
```
Erwartet zuerst `decisions.riskPerDay is not a function`, nach Schritt 2 grün.

- [ ] **Schritt 4: Der Bereichsfilter an den Sperren**

`src/db.js`: `openEvent(guildId, userId, domain = null)` und
`lastEventAt(guildId, userId, domain = null)` bekommen einen optionalen
Bereich. Abgeleitet wird er aus der **vorhandenen** Spalte `platform` – kein
Schema-Update:

```sql
-- domain 'music'   -> platform = 'music'
-- domain 'company' -> platform = 'company'
-- domain 'creator' -> platform NOT IN ('music', 'company')
```

Ohne `domain` verhalten sich beide wie bisher (alle Bereiche), damit jeder
bestehende Aufrufer unverändert weiterläuft. `roll` reicht seinen `domain`
an beide durch.

- [ ] **Schritt 5: `decisions.tick`**

```js
/**
 * Der Tageswurf für Musik und Creator.
 *
 * Bis hierher hing ein Vorfall an der Zahl der AKTIONEN (2 % je Aktion, also
 * im Schnitt fünfzig Aktionen bis zum ersten). Wer gemütlich spielt, sah
 * deshalb nie einen. Die Firma rechnet seit jeher über die vergangenen TAGE –
 * `tick` holt das für Musik und Creator nach, mit derselben Spanne.
 *
 * Faul (§4): Geschrieben wird die Uhr nur, wenn wirklich gewürfelt wurde.
 * Abwesenheit zählt mit, aber höchstens `ROLL_TAGE_MAX` Tage – drei Wochen
 * Urlaub sollen keine Kette von Entscheidungen ausspucken.
 */
function tick(guildId, userId, domain, size, now = Date.now(), random = Math.random) {
  if (domain !== 'music' && domain !== 'creator') return null;
  // Ein offener Vorfall DIESES Bereichs hält den nächsten auf (Schritt 4).
  if (db.openEvent(guildId, userId, domain)) return null;

  const uhr = db.decisionUhr(guildId, userId, domain);
  const tage = uhr.last_roll
    ? Math.min(ROLL_TAGE_MAX, Math.floor((now - uhr.last_roll) / 86_400_000))
    : 1;                       // beim allerersten Mal ein Wurf, nicht null
  if (tage <= 0) return null;

  db.saveDecisionUhr(guildId, userId, domain, now);
  if (random() >= chanceOver(size, tage)) return null;
  return roll(guildId, userId, size, now, random, domain, { schonGewuerfelt: true });
}
```

`roll` bekommt dafür einen letzten Parameter `{ schonGewuerfelt = false }`:
Ist er gesetzt, überspringt `roll` seine eigene `random() >= riskFor(size)`-Prüfung
(die Wahrscheinlichkeit hat `tick` schon entschieden), prüft aber alles andere
weiter – Sperre, Abstand, Kandidatenliste. Die Firma ruft `roll` unverändert
auf und ist davon nicht berührt.

- [ ] **Schritt 6: Tests für `tick` und die Sperren**

```js
// tick ohne Uhr wuerfelt genau einmal (tage = 1)
// tick zweimal in derselben Stunde: der zweite Aufruf wuerfelt nicht
// 30 Tage Abwesenheit geben hoechstens ROLL_TAGE_MAX Tage
// ein offener MUSIK-Vorfall haelt den naechsten Musik-Wurf auf
// ein offener FIRMEN-Vorfall haelt den Musik-Wurf NICHT mehr auf
// ein offener CREATOR-Vorfall haelt den Musik-Wurf NICHT auf
// die Uhr wird nur geschrieben, wenn gewuerfelt wurde (reines Lesen aendert nichts)
// db.decisionUhr legt keine Zeile an (§4)
// MIN_GAP_MS gilt je Bereich: zwei Musik-Vorfaelle im Abstand von 10 h gehen nicht,
//   ein Musik- und ein Creator-Vorfall im Abstand von 10 h gehen
```

- [ ] **Schritt 7: Tests laufen lassen**

```bash
rm -rf .testdata && DATA_DIR=.testdata node test/decisions.test.js
rm -rf .testdata && DATA_DIR=.testdata node test/company.test.js
rm -rf .testdata && DATA_DIR=.testdata node test/companyEvents.test.js
npm test 2>&1 | grep -c '❌'
```
Letzte Zeile `0`. Die beiden Firmen-Dateien müssen **unverändert** weiterlaufen –
bricht dort etwas, ist der Bereichsfilter falsch.

- [ ] **Schritt 8: Commit**

```bash
git add src/decisions.js src/db.js test/decisions.test.js package.json
git commit -m "vorfaelle: der tageswurf und eine sperre je bereich

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 2: Die Würfe je Aktion entfallen, `tick` wird eingehängt

**Dateien:**
- Ändern: `src/music.js` (drei Aufrufstellen), `src/creator.js` (eine),
  `src/buttons.js` (`settleMusic`, `settleCreator`), `test/decisions.test.js`

**Schnittstellen:**
- Nutzt aus Task 1: `decisions.tick(guildId, userId, domain, size, now, random)`.
- Nutzt bestehend: `music.status(guildId, userId, now)` → `{ listeners, … }`;
  `creator.reachTotalOf(guildId, userId, followerSumme)`; `db.allCreator(guildId,
  userId)` für die Followersumme.

- [ ] **Schritt 1: Die vier Würfe entfernen**

`src/music.js:448` (`record`), `:610` (`publish`), `:867` (`show`) und
`src/creator.js:970` (`act`) rufen `require('./decisions').roll(...)` nicht mehr.
Das Feld `incident` im Ergebnis **bleibt** und ist dort künftig `null` – die
Anzeige liest es weiter, und Task 3 füllt es aus `tick`.

**Achtung, Würfelfolge:** `roll` verbrauchte `random()`. Fällt der Aufruf weg,
verschiebt sich jede spätere Zufallszahl desselben Aufrufs. Das ist gewollt und
unvermeidbar, muss aber benannt werden: Die §3-Zahlen in
`test/musicEvents.test.js` und in den Messläufen bewegen sich dadurch. Vor der
Änderung die Ausgabe von `test/musicEvents.test.js` festhalten, nach der
Änderung danebenlegen und die Differenz im Bericht nennen.

- [ ] **Schritt 2: `tick` in die fauligen Sammler**

In `src/buttons.js`, in `settleMusic` und `settleCreator`, neben dem schon
vorhandenen `decisions.settle`:

```js
  // Der Tageswurf (§4): dieselbe Stelle wie jede andere faule Abrechnung,
  // damit er weder vergessen noch verschluckt werden kann.
  const neu = require('./decisions').tick(guildId, userId, 'music',
    require('./music').status(guildId, userId).listeners);
  if (neu) lines.push(`⚠️ **${neu.decision.emoji} ${neu.decision.title}** – entscheide dich.`);
```

für `settleMusic`, und sinngemäß in `settleCreator` mit `'creator'` und der
Reichweite aus `creator.reachTotalOf(guildId, userId, …)`. Den genauen Text im
Stil der Nachbarzeilen in derselben Funktion wählen; `decisions.pending` liefert
die Vorlage, falls `tick` nur die DB-Zeile zurückgibt.

- [ ] **Schritt 2b: `pending` braucht einen Bereich**

Mit Sperren je Bereich können **drei** Vorfälle gleichzeitig offen sein, aber
`decisions.pending` ruft `db.openEvent(guildId, userId)` ohne Bereich und gibt
nur den neuesten zurück (`ORDER BY id DESC LIMIT 1`). Die anderen zwei wären
über die Ansicht unerreichbar, bis sie verfallen – und ein verfallener Vorfall
kostet den Ignorier-Aufschlag.

Dass das schon vorher ein Problem war, steht im Code: `src/company.js:1476`
filtert das Ergebnis von `pending` behelfsweise selbst
(`p?.platform === 'company' ? p : null`).

`pending(guildId, userId, now, domain = null)` bekommt den Bereich durch, und
alle vier Aufrufstellen geben ihren an:

| Stelle | Bereich |
|---|---|
| `src/music.js:1089` (`status().incident`) | `'music'` |
| `src/creator.js:1087` | `'creator'` |
| `src/company.js:1476` | `'company'` – die behelfsmäßige Filterzeile fällt weg |
| `src/ui.js:3533` | der Bereich der Ansicht, in der die Zeile steht |

Ohne `domain` verhält sich `pending` wie bisher, damit nichts Ungeprüftes bricht.

Test: drei Vorfälle gleichzeitig offen (Musik, Creator, Firma) – jede der drei
Ansichten zeigt **ihren**, nicht den neuesten.

- [ ] **Schritt 3: Tests**

```js
// music.record / publish / show legen KEINEN Vorfall mehr an (auch nicht bei
//   erzwungenem Wurf) - sonst addieren sich die Raten
// creator.act legt keinen mehr an
// settleMusic nach einem Tag legt einen an, wenn der Wurf faellt
// settleCreator desgleichen
// zweimal settleMusic hintereinander: nur ein Wurf
```

- [ ] **Schritt 4: Tests laufen lassen**

```bash
rm -rf .testdata && DATA_DIR=.testdata node test/decisions.test.js
rm -rf .testdata && DATA_DIR=.testdata node test/music.test.js
rm -rf .testdata && DATA_DIR=.testdata node test/creator.test.js
rm -rf .testdata && DATA_DIR=.testdata node test/musicEvents.test.js
rm -rf .testdata && DATA_DIR=.testdata node test/fluxer-render.test.js
npm test 2>&1 | grep -c '❌'
```

`test/musicEvents.test.js` wird Zahlen bewegen (Schritt 1). Seine
Zusicherungen dürfen nur **strenger** werden, nicht schwächer; ändert sich eine
Erwartung, steht der alte und der neue Wert im Bericht.

- [ ] **Schritt 5: Commit**

```bash
git add src/music.js src/creator.js src/buttons.js test/
git commit -m "vorfaelle: der wurf haengt an der zeit, nicht mehr an der aktion

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 3: Die frühen Vorfälle

**Dateien:**
- Ändern: `src/data/musicDecisions.js`, `src/data/decisions.js`,
  `src/decisions.js` (Obergrenze in der Kandidatenauswahl),
  `test/decisions.test.js`

**Schnittstellen:**
- Nutzt aus Task 1: `tick`. Nutzt bestehend: `decisions.scaleMoney(reach,
  factor)`, `decisions.severityFor(reach)`, `musicEligible(d, artist, contract)`.
- Liefert für Task 4/5: `FRUEH_MAX`.

- [ ] **Schritt 1: Die Obergrenze**

```js
const FRUEH_MAX = 10_000;   // darüber verschwinden die frühen Vorfälle wieder
```

In `roll` bekommt die Kandidatenauswahl je Katalog ihre Obergrenze dazu:

```js
// Musik
possible = MUSIC_DECISIONS.filter((d) =>
  size >= d.minListeners && size <= (d.maxListeners ?? Infinity)
  && musicEligible(d, artist, contract));
// Creator
possible = DECISIONS.filter((d) =>
  size >= d.minReach && size <= (d.maxReach ?? Infinity));
```

Ohne das Feld verhält sich jeder bestehende Eintrag wie bisher.

- [ ] **Schritt 2: Vier neue Einträge**

Je zwei, in der Form der Nachbarn in derselben Datei (gleiche Felder, gleiche
Zahl an Optionen, gleiche Art von Ausgängen). Die Beträge laufen durch
`scaleMoney`, sind bei einem Anfänger also zweistellig – genau so gewollt.

| Datei | id | Schwellen | Worum es geht |
|---|---|---|---|
| `musicDecisions.js` | `proberaum` | `minListeners: 0`, `maxListeners: FRUEH_MAX` | Der Proberaum wird gekündigt. Teurer nehmen, im Schlafzimmer aufnehmen, oder pausieren? |
| `musicDecisions.js` | `kleiner_auftritt` | `minListeners: 0`, `maxListeners: FRUEH_MAX` | 50 € für einen Auftritt vor zwanzig Leuten, drei Stunden Fahrt. |
| `decisions.js` | `erster_sponsor` | `minReach: 0`, `maxReach: FRUEH_MAX` | Die erste Anfrage überhaupt – und sie klingt zu gut, um sauber zu sein. |
| `decisions.js` | `festplatte` | `minReach: 0`, `maxReach: FRUEH_MAX` | Die Platte mit dem ganzen Rohmaterial stirbt. Datenrettung zahlen oder neu machen? |

Alle Texte sind Spielfiktion, nennen keine reale Person, und keine Option darf
mehr Geld **bringen** als sie kostet – ein früher Vorfall ist eine
Entscheidung, keine Einnahmequelle (§3).

- [ ] **Schritt 3: Tests**

```js
// ein Anfaenger (0 Hoerer) bekommt ueberhaupt Kandidaten - vorher war die Liste leer
// und zwar NUR die fruehen (proberaum, kleiner_auftritt)
// bei 20.000 Hoerern sind die fruehen weg und die alten da
// genau an der Grenze FRUEH_MAX ist der fruehe noch dabei (<=)
// jeder fruehe Vorfall hat dieselbe Zahl Optionen wie seine Nachbarn
// keine Option eines fruehen Vorfalls bringt netto Geld
```

- [ ] **Schritt 4: Tests laufen lassen**

```bash
rm -rf .testdata && DATA_DIR=.testdata node test/decisions.test.js
rm -rf .testdata && DATA_DIR=.testdata node test/musicEvents.test.js
npm test 2>&1 | grep -c '❌'
```

- [ ] **Schritt 5: Commit**

```bash
git add src/data/musicDecisions.js src/data/decisions.js src/decisions.js test/decisions.test.js
git commit -m "vorfaelle: vier entscheidungen vom anfangen

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 4: Messung, §15, Patchnote

**Dateien:**
- Ändern: `scripts/messung-geldquellen.js` (`--nur=vorfaelle`),
  `ARCHITEKTUR.md` §15, `src/data/patchnotes.js` (nächste Nummer),
  `docs/superpowers/specs/2026-10-06-vorfaelle-design.md` (Addendum)
- Neu: `docs/messungen/<Datum des Laufs>-vorfaelle.txt`

**Vorbild:** der Beef- und der Angebote-Lauf im selben Skript – dieselbe Form,
dieselbe Säung, eine Strategie je Archetyp, einmal gesucht und festgehalten,
eine Kontrollzeile je Variante.

- [ ] **Schritt 1: Die Messung**

Archetypen **Musik+Creator** und **nur Musik**, je 10 × 365 Tage mit demselben
gesäten Würfel, Varianten `aus` (keine Vorfälle) und `an`. Ausgabe je Variante:
Median/Tag, Differenz als Mediane **und je Seed gepaart**, Spanne, „N von 10 im
Plus".

Dazu die Zahl, um die es eigentlich geht:

- **Vorfälle je Jahr, aufgeschlüsselt nach Reichweite** – mindestens drei Stufen
  (unter 5.000, um 100.000, über 1 Mio). Erwartung aus der Spec: **7,3 / 8,8 /
  29,2**. Weicht die Messung ab, ist das ein Befund, kein Rundungsfehler.
- **Wie viele davon frühe Vorfälle sind** und ab wann sie verschwinden.
- **Der Abstand zwischen zwei Vorfällen desselben Bereichs** – `MIN_GAP_MS`
  darf nie gerissen werden.
- **Was die Trennung der Sperre bringt:** derselbe Lauf mit und ohne
  Bereichsfilter, damit „die Firma nahm der Musik die Vorfälle weg" eine Zahl
  bekommt statt eine Vermutung zu bleiben.

Jede Variante braucht eine **Kontrollzeile**, die beweist, dass sie gemessen
hat, was sie behauptet (`aus` muss null Vorfälle haben). Eine stille Null ist
ein Fehler, kein Ergebnis.

**Vor jeder abgeleiteten Zahl** eine Handprüfung: `riskPerDay` und
`chanceOver` für einen konkreten Tag von Hand nachrechnen und gegen die Ausgabe
halten; der Vergleich steht in der Messdatei und im Bericht.

**Liegt eine Variante über +25 % gepaart, wird `RISK_MAX_DAY` gesenkt und neu
gemessen**, und beide Werte stehen im Bericht. Achtung: Vorfälle können die
Bilanz in **beide** Richtungen verschieben – fällt sie um mehr als 25 %, ist
das genauso ein Befund und gehört in §15.

- [ ] **Schritt 2: Rohausgabe sichern**

Die echte Ausgabe nach `docs/messungen/<Datum des Laufs>-vorfaelle.txt`, mit
Kopf (Datum, Kommandozeilen, Seeds, Annahmen) wie
`docs/messungen/2026-10-02-angebote.txt`.

- [ ] **Schritt 3: §15 in `ARCHITEKTUR.md`**

Absatz im Stil der Nachbarn: die Mechanik in drei Sätzen, **warum** sie sich
geändert hat (der alte Zustand war je Aktion und darum für Gelegenheitsspieler
unsichtbar), die gemessenen Vorfälle je Jahr nach Reichweite **mit
Dateiverweis an der Stelle, an der sie stehen**, und eine Liste „Ehrliche
Grenzen".

Jede Zahl in §15 muss in der Messdatei mit demselben Wert stehen.

- [ ] **Schritt 4: Patchnote**

In `src/data/patchnotes.js`, nächste freie Nummer, im Stil der Nachbarn, in
Spielersprache ohne Formeln: dass Vorfälle jetzt an der Zeit hängen, dass es
früh eigene gibt, und dass Musik, Kanäle und Firma sich nicht mehr gegenseitig
blockieren.

- [ ] **Schritt 5: Addendum in der Spec**

„Addendum nach der Messung (Datum)": die gemessenen Zahlen, jede Abweichung
zwischen Spec und gebautem Code, und ob `RISK_MAX_DAY` gesenkt werden musste.

- [ ] **Schritt 6: Suite und Commit**

```bash
npm test 2>&1 | grep -c '❌'
```
Muss `0` drucken.

```bash
git add scripts/messung-geldquellen.js ARCHITEKTUR.md docs/messungen/ src/data/patchnotes.js docs/superpowers/specs/2026-10-06-vorfaelle-design.md
git commit -m "vorfaelle: messung, §15 und patchnote

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

## Selbstprüfung gegen die Spec

- Tageswurf in der Form der Firma, Deckel 14 Tage, Uhr je Bereich: Task 1. ✔
- Würfe je Aktion entfallen, `tick` hängt an den fauligen Sammlern: Task 2. ✔
- Eine Sperre je Bereich, abgeleitet aus `platform`, ohne Schema-Update: Task 1. ✔
- Vier frühe Vorfälle mit Obergrenze, Beträge über `scaleMoney`: Task 3. ✔
- §3-Nachweis, Messung nach Reichweitenstufen, Kontrollzeilen, §15, Patchnote,
  Addendum: Task 4. ✔
