# Zufallsereignisse für die Musikkarriere

Stand: 2026-09-11 · Zweig `main` · Folgeauftrag aus Beschluss 22 der
Balance-Runde (`2026-09-09-geldquellen-balance-design.md`)

## Ziel

Die Musikkarriere hat heute **keine** Zufallsereignisse. Wer täglich ins Studio
geht und veröffentlicht, kommt sicher an – das ist eine Fleißaufgabe, keine
Karriere. Creator, Börse und Heists haben längst Ereignisse; die Musik bekommt
jetzt eigene, **separat** von den Creator-Ereignissen und **schwerer**.

Zwei Schichten:

1. **Leichte Ereignisse** – an jeder Aktion gewürfelt, wirken sofort, kein
   Klick. Würze und Schwankung.
2. **Schwere Vorfälle mit Entscheidung** – selten, mit Optionen, deren
   Ausgänge die Härte bestimmen. Wer nicht reagiert, fährt schlechter.

Beide Schichten folgen bestehenden Mustern: Schicht 1 dem Creator-Würfel
(`data/creator.js EVENTS`, `creator.rollEvent`), Schicht 2 dem
Entscheidungs-System (`decisions.js`, `data/decisions.js`).

## Nicht-Ziele

- Kein eigenes Entscheidungs-System für die Musik. Das vorhandene bekommt eine
  Domäne.
- Keine Ereignisse, die Geld aus dem Nichts erzeugen (§3). Alle Geldwirkungen
  sind Multiplikatoren auf bereits verdiente Beträge oder Abzüge.
- Keine Schemaänderung. Musik-Vorfälle liegen in `creator_events` mit
  `platform = 'music'`.

## Was heute gilt (gegen den Code geprüft)

| | Wert | Quelle |
|---|---|---|
| Hype-Spanne | 0,6 bis 1,7 | `music.js` `HYPE_MIN`/`HYPE_MAX` |
| Genre-Risiko | Pop 1,0 · Hip-Hop 1,3 · Rock 0,9 · Elektro 0,8 · Indie 0,7 · Metal 0,8 · Klassik 0,5 · J-Pop 1,1 | `data/music.js` – **bisher nirgends ausgewertet** |
| Persona | `face` (Gesicht) oder `anon` | `data/music.js` `PERSONAS` |
| Sperren | Studio 6 h · Release 20 h · Konzert 3 Tage | `music.js` |
| Vorfall-Mechanik | 24 h zum Entscheiden, 36 h Mindestabstand, 2–4 % je Aktion, Ignorieren × 1,6 | `decisions.js` |
| Kopplung | `decisions.js` liest `db.allCreator`, skaliert Geld über `creator.monetization`, wirkt auf Plattform-Zeilen | `decisions.js:131,87,179` |

Die letzte Zeile ist die Arbeit: `decisions.js` muss eine **Domäne** bekommen,
sonst treffen Musik-Vorfälle Twitch-Follower.

## Schicht 1 – leichte Ereignisse

Neue Datei `src/data/musicEvents.js`. Form wie `data/creator.js EVENTS`:
gewichtete Liste mit einem `none`-Eintrag, `on` schränkt auf Aktionen ein,
`risky` skaliert das Gewicht mit `genre.risk`.

```js
{ id: 'hit', weight: 4, on: ['publish'], audience: 3.0, hype: 1.25,
  text: '🚀 Das Ding läuft. Überall. Leute, die dich nie gehört haben, singen mit.' },
```

### Die Liste

`none` hat Gewicht **110**, wie beim Creator. Damit liegt die Ereignisquote je
Aktion bei 15–17 % (Pop) – niedriger als beim Creator, dessen Ereignisliste je
Plattform 45–58 Gewicht gegen dieselben 110 stellt.

| Aktion | id | Gewicht | risky | Wirkung | Text (Kurzform) |
|---|---|---|---|---|---|
| Studio | `flow` | 7 | – | `songs: +2` statt +1 | Der Flow war da. Zwei Songs statt einem. |
| Studio | `geistesblitz` | 6 | – | `hype: ×1.15` | Eine Idee, die du seit Wochen gesucht hast. |
| Studio | `aufnahme` | 7 | ja | `songs: +0` (kein Song, Zeit weg) | Die Aufnahme ist hin. Drei Stunden für nichts. |
| Studio | `equipment` | 3 | ja | `breaks: true`, `songs: +0` | Mitten im Take gibt das Setup auf. |
| Release | `hit` | 4 | – | `audience: ×3.0`, `hype: ×1.25` | Das Ding läuft. Überall. |
| Release | `radio` | 6 | – | `audience: ×1.8`, `hype: ×1.2` | Ein Sender hat dich in die Rotation genommen. |
| Release | `flop` | 7 | ja | `audience: ×0.4` | Niemand hat es bemerkt. Passiert. |
| Release | `algorithmus` | 6 | ja | `audience: ×0.6` | Die Playlist-Kuratoren hatten heute andere Favoriten. |
| Konzert | `ausverkauft` | 6 | – | `pay: ×1.6`, `gain: ×1.5` | Ausverkauft. Die Halle vibriert. |
| Konzert | `gastauftritt` | 5 | – | `pay: ×1.3`, `hype: ×1.2` | Jemand Großes kam auf die Bühne. |
| Konzert | `ton` | 6 | ja | `pay: ×0.6`, `hype: ×0.9` | Tonprobleme. Die erste halbe Stunde war ein Brummen. |
| Konzert | `abgesagt` | 3 | ja | `pay: ×0`, `gain: ×0`, Zeit weg | Abgesagt. Die Zeit ist trotzdem weg. |

Zwölf Ereignisse, vier je Aktion, je zwei gut und zwei schlecht. Der Ausschlag
ist bewusst größer als beim Creator: Dort ist das Beste 2,4× Publikum, hier 3×;
dort kostet ein Technikproblem 45 % Publikum, hier ein Flop 60 %.

### Vokabular der Wirkungen

| Feld | Aktion | Bedeutung |
|---|---|---|
| `songs` | Studio | ersetzt das `+1` – `+2` beim Flow, `+0` bei kaputter Aufnahme |
| `breaks` | Studio | Ausrüstung (`music.GEAR`) geht kaputt, wie beim Creator |
| `hype` | alle | Faktor auf `hype`, geklemmt auf 0,6–1,7 |
| `audience` | Release | Faktor auf das Publikum der Veröffentlichung, wirkt vor `CONVERSION` |
| `pay` | Konzert | Faktor auf die Gage **vor** der Buchung |
| `gain` | Konzert | Faktor auf die neuen Hörer |

### Der Würfel

`rollMusicEvent(action, genre, random)` in `music.js` – eine Kopie von
`creator.rollEvent` mit `genre.risk` statt `fmt.risk`. Damit trifft Hip-Hop die
*risky*-Ereignisse 1,3-mal so oft wie Pop, Klassik halb so oft.

**Bei `pay: 0` wird nicht gebucht.** Die UnbelievaBoat-API lehnt eine
Nulländerung ab („Invalid cash and bank parameter"). Das ist beim Casino schon
einmal aufgefallen (`casinoPlay.js`); hier wird die Buchung übersprungen, die
Sperre und die Zeit gelten trotzdem.

### Andockpunkte in `music.js`

| Funktion | Stelle | Änderung |
|---|---|---|
| `record()` | nach `useTime`, vor `saveArtist` | `songs: row.songs + (event.songs ?? 1)`, Hype-Faktor, ggf. `db.consumeNamed(GEAR)` |
| `publish()` | `simulateRelease(row, { ..., eventAudience })` | Faktor multipliziert `audience` |
| `show()` | vor `changeCash` | `gross × pay`, `gained × gain`, Hype-Faktor; bei `pay = 0` keine Buchung |

Jede Rückgabe bekommt `event: { id, text } | null`, damit die Ansicht den Text
zeigt – wie `result.event` beim Creator.

## Schicht 2 – schwere Vorfälle mit Entscheidung

### Domäne in `decisions.js`

- Jede Vorlage in `data/decisions.js` bekommt `domain: 'creator' | 'music'`.
  Fehlt das Feld, gilt `'creator'` – die 10 bestehenden Vorlagen bleiben
  unverändert.
- `roll(guildId, userId, size, now, random, domain = 'creator')` filtert nach
  Domäne. `size` ist bei Creator die Reichweite, bei Musik die Hörerzahl –
  dieselbe Risikokurve (2–4 %), dieselbe Sperre „solange einer offen ist",
  derselbe Mindestabstand. Die Zeile bekommt `platform: 'music'`.
- `apply()` verzweigt auf `row.platform === 'music'`. Musik-Wirkungen greifen
  auf die Künstlerzeile, nie auf Plattform-Zeilen.
- `severityFor()` und `scaleMoney()` bekommen die Hörerzahl statt der
  Reichweite. `scaleMoney` nutzt heute `creator.monetization(reach)` – für die
  Musik wird stattdessen `music.royaltyPerDay(listeners)` als Maß für „ein
  Tagesertrag" verwendet, damit `cash: -2` „zwei Tage Tantiemen" heißt, so wie
  es beim Creator „zwei Tage Werbeeinnahmen" heißt.

### Vokabular der Musik-Wirkungen

| Feld | Bedeutung |
|---|---|
| `listeners` | Anteil der Hörer, negativ = Verlust (`-0.12` = 12 % weg) |
| `songsShare` | Anteil der unveröffentlichten Songs, negativ = Verlust (`-1` = alle weg, `-0.5` = die Hälfte). Bewusst ein **anderes** Feld als `songs` in Schicht 1, wo es eine absolute Zahl ist – sonst hieße dasselbe Wort zweierlei. |
| `hype` | Faktor, geklemmt auf 0,6–1,7 |
| `lockRelease` | Tage ohne Veröffentlichung – `last_release_at` wird so weit vorgeschoben |
| `lockShow` | Tage ohne Konzert – `last_show_at` analog |
| `contract` | `'break'` – der Idol-Vertrag platzt (`setContractStatus(…, 'broken')`), mit der vorhandenen Vertragsstrafe |
| `gear` | Studio-Ausrüstung kaputt |
| `cash` | in Tagen Tantiemen, negativ = Abzug |
| `publish` | `true` – veröffentlicht sofort alle Songs als Release, mit `audience`-Faktor |

`lock` (das Creator-Feld) gibt es für Musik nicht – die Musik hat zwei
verschiedene Sperren, deshalb zwei Felder.

### Die fünf Vorfälle

Gewichte und Zahlen sind für einen Künstler mittlerer Größe; `severityFor`
setzt oben einen Aufschlag bis 1,6 drauf, wie beim Creator.

**⚖️ `plagiat` – Plagiatsvorwurf** (`minListeners: 5.000`)
*Ein anderer Künstler behauptet, dein letzter Track sei geklaut. Screenshots kursieren.*

| Option | Ausgänge |
|---|---|
| 🧑‍⚖️ Anwalt einschalten | 8: `cash: -3` – teuer, aber erledigt · 2: `cash: -3`, `hype: 1.1` – der Vorwurf fällt auf ihn zurück |
| 📣 Öffentlich antworten | 5: `hype: 1.15` – die Leute glauben dir · 3: nichts · 2: `listeners: -0.08`, `hype: 0.85` – der Ton kam falsch an |
| 🤫 Ignorieren | 6: nichts · 4: `listeners: -0.12` – die Geschichte wächst |
| *verfallen* | `listeners: -0.12` |

**🎭 `skandal` – Ein altes Video taucht auf** (`minListeners: 20.000`, **nur `persona: 'face'`**)
*Von vor Jahren. Aus dem Zusammenhang gerissen, aber es ist dein Gesicht.*

| Option | Ausgänge |
|---|---|
| 🙏 Entschuldigen | 7: `listeners: -0.05`, `hype: 0.9` – es beruhigt sich · 3: `listeners: -0.03` – man rechnet es dir an |
| ⏳ Aussitzen | 5: nichts · 5: `listeners: -0.15`, `hype: 0.75` – es wird schlimmer |
| ⚔️ Gegenangriff | 3: `hype: 1.2` – die Szene feiert dich · 7: `listeners: -0.2`, `hype: 0.6` – Hype am Boden |
| *verfallen* | `listeners: -0.15`, `hype: 0.75` |

Anonyme Künstler bekommen diesen Vorfall nie – das ist der Vorteil der Maske.

**🤒 `stimme` – Stimme weg vor der Tour** (`minListeners: 5.000`)
*Zwei Tage vor dem Konzert. Kein Ton.*

| Option | Ausgänge |
|---|---|
| 🚫 Absagen | 10: `lockShow: 7`, `hype: 0.9` – die Fans verstehen es |
| 💪 Durchziehen | 5: nichts – es ging gerade so · 5: `listeners: -0.08`, `hype: 0.85` – es war hörbar |
| 🎙️ Playback | 7: nichts – niemand merkt es · 3: `listeners: -0.15`, `hype: 0.7` – jemand filmt, es fliegt auf |
| *verfallen* | `lockShow: 7`, `hype: 0.85` |

**💿 `leak` – Album im Netz** (`minListeners: 10.000`, nur mit `songs ≥ 3`)
*Dein unveröffentlichtes Material ist draußen. Alles.*

| Option | Ausgänge |
|---|---|
| ⚡ Sofort veröffentlichen | 10: `publish: true`, `audience: 0.7` – der Schwung ist halb weg, aber es ist deins |
| 🔁 Neu aufnehmen | 10: `songsShare: -1`, `hype: 1.1` – alles weg, aber die Story zieht |
| 🤷 Ignorieren | 4: `songsShare: -0.5` – die Hälfte ist verbrannt · 6: `songsShare: -1`, `listeners: -0.05` – alles weg, und es wirkt egal |
| *verfallen* | `songsShare: -1`, `listeners: -0.05` |

**🏢 `label` – Das Label will verschieben** (`minListeners: 5.000`, **nur mit aktivem Vertrag**)
*Dein Release soll drei Wochen warten. „Marktstrategie."*

| Option | Ausgänge |
|---|---|
| 🤝 Nachgeben | 10: `lockRelease: 7` – du wartest |
| 🔥 Durchziehen | 6: `hype: 1.1` – sie lassen es durchgehen · 4: `contract: 'break'` – Vertrag geplatzt, mit Strafe |
| *verfallen* | `lockRelease: 7` |

Fünf Vorfälle, die drei Ausschlusskriterien (Persona, Songs, Vertrag) sorgen
dafür, dass keiner ins Leere trifft.

### Andockpunkte

Nach jeder erfolgreichen Aktion in `music.js` (`record`, `publish`, `show`):

```js
const incident = require('./decisions').roll(guildId, userId, listeners, now, random, 'music');
```

Ergebnis ins Rückgabeobjekt (`incident`), wie beim Creator.

### Ansicht

- `buildDecisionView` (die „Vorfälle"-Seite) zeigt Musik-Vorfälle mit 🎵
  statt Plattform-Symbol. Sonst unverändert – Entscheiden, Verfall,
  Verlauf funktionieren, weil nur `apply()` verzweigt.
- `music.status()` bekommt ein Feld `incident` (der offene Vorfall oder
  `null`), und die Musik-Ansicht zeigt eine Zeile „⚠️ Offener Vorfall – im
  Menü *Vorfälle*", wenn eines da ist. Ohne das würde ein Musiker, der die
  Creator-Seite nie öffnet, den Vorfall nicht bemerken und ihn verfallen
  lassen.
- Verfall: `decisions.settle()` läuft heute beim Öffnen der Creator-Ansichten.
  Es wird zusätzlich beim Öffnen der **Musik-Ansicht** aufgerufen – sonst
  bliebe ein Musik-Vorfall für einen reinen Musiker ewig offen und blockierte
  jeden weiteren (genau der Fall, an dem eine frühere Messung gescheitert ist).

## §3 – kein Gelddrucker

- Alle Geldwirkungen sind Faktoren auf verdiente Beträge (`pay`) oder Abzüge
  (`cash`). Kein Ereignis zahlt aus dem Nichts.
- `audience`- und `gain`-Faktoren wirken vor den bestehenden unterlinearen
  Kurven; sie verschieben eine Veröffentlichung, sie ändern keine Decke.
- Der Erwartungswert der leichten Ereignisse wird **nicht behauptet, sondern
  gemessen** (Test 10). Aus den Gewichten allein lässt er sich nicht ablesen:
  Im Studio überwiegen die guten (13 gegen 10), beim Release die schlechten
  (10 gegen 13), und `genre.risk` verschiebt das je Genre. Was zählt, ist der
  Median der Hörer nach einem Jahr – mit und ohne Ereignisse.
- **Gemessen, nicht behauptet**: Nach dem Bau läuft `messung-geldquellen.js`
  erneut. Der Median nach einem Jahr muss in **500.000–700.000 Hörern**
  bleiben (Beschluss 20 der Balance-Runde, dort ausdrücklich „ohne
  Ereignisse" kalibriert). Ereignisse dürfen ihn um höchstens **10 %** heben.
  Senken dürfen sie ihn – das ist ihr Sinn.

## Tests (`test/musicEvents.test.js`)

Fester Würfel überall; die Karriere-Simulation ruft `decisions.settle()`
täglich, wie ein Menü-Klick.

1. **Jedes leichte Ereignis feuert.** 2.000 Würfe je Aktion (`record`,
   `publish`, `show`) bei **Pop** (Risiko 1,0): jede `id` kommt mindestens
   15-mal, `none` ist die Mehrheit. Das seltenste (`equipment`, Gewicht 3 von
   133) erwartet rund 45 Treffer – 15 ist die Untergrenze, die auch bei einem
   ungünstigen festen Würfel hält. Eine `id`, die nie kommt, ist ein Fehler in
   der Liste.
2. **Das Genre-Risiko wirkt.** Hip-Hop (1,3) trifft *risky*-Ereignisse
   messbar öfter als Klassik (0,5) – Verhältnis über 2.000 Würfe zwischen 2
   und 3.
3. **Jede leichte Wirkung landet im Zustand.** Je Ereignis eine Prüfung mit
   erzwungenem Würfel: `flow` gibt +2 Songs, `aufnahme` +0 bei verbrauchter
   Zeit, `equipment` entfernt die Ausrüstung, `hit` verdreifacht das Publikum,
   `abgesagt` bucht nichts und verbraucht trotzdem Sperre und Zeit.
4. **Jede Option jedes Vorfalls.** Für alle 5 × (2–3) Optionen: jeder Ausgang
   wird einmal erzwungen, die Wirkung am Künstler gemessen – Hörer, Songs,
   Hype, `last_release_at`, `last_show_at`, Vertragsstatus. `publish: true`
   erzeugt ein Release.
5. **Verfall bestraft.** Ein nicht beantworteter Vorfall wendet `expire` mit
   Faktor 1,6 an.
6. **Vorfälle kommen – und nicht zu oft.** Über eine Ein-Jahres-Karriere:
   mindestens 10, höchstens 60, nie zwei offen, nie zwei innerhalb von 36 h.
7. **Domänen bleiben getrennt.** Ein reiner Musiker bekommt nie
   `hardware`/`copyright`/…; ein reiner Creator nie `plagiat`/`skandal`/….
8. **Ausschlusskriterien greifen.** Anonym → nie `skandal`; ohne Vertrag → nie
   `label`; unter 3 Songs → nie `leak`.
9. **Bestehende Creator-Vorfälle unverändert.** `test/decisions.test.js`
   bleibt grün, ohne eine Zeile Änderung.
10. **§3-Messung.** 5 Karrieren à 365 Tage mit und ohne Ereignisse: Median der
    Hörer mit Ereignissen ≤ 1,1 × ohne. Ohne bleibt in 500–700k.
11. **Keine Nullbuchung.** `abgesagt` ruft `changeCash` nicht auf.
12. **Der Vorfall ist auffindbar.** `music.status().incident` ist gesetzt,
    solange einer offen ist, und `null` danach.

## Berührte Dateien

| Datei | Änderung |
|---|---|
| `src/data/musicEvents.js` | neu – 12 leichte Ereignisse |
| `src/data/decisions.js` | 5 Musik-Vorlagen mit `domain: 'music'`; bestehende bekommen kein Feld (Standard) |
| `src/music.js` | `rollMusicEvent`, Andockpunkte in `record`/`publish`/`show`, `status().incident`, Vorfall-Würfel |
| `src/decisions.js` | Domänen-Filter in `roll`, Musik-Zweig in `apply`, Größenmaß je Domäne, `expire` mit Domäne |
| `src/ui.js` | 🎵 in `buildDecisionView`, Hinweiszeile in der Musik-Ansicht, `decisions.settle` beim Öffnen |
| `test/musicEvents.test.js` | neu, 12 Blöcke oben |
| `package.json` | Test in die Kette |
| `scripts/messung-geldquellen.js` | Schalter `--ohne-ereignisse` für die Vergleichsmessung |
| `src/data/patchnotes.js` | Eintrag |

## Reihenfolge der Umsetzung

1. `decisions.js` Domäne + Musik-Zweig in `apply()` – **zuerst**, weil alles
   andere darauf aufbaut, und mit dem Test, dass Creator-Vorfälle unverändert
   bleiben.
2. Die 5 Musik-Vorlagen + Test 4/5/7/8.
3. `data/musicEvents.js` + Würfel + Test 1/2.
4. Andockpunkte in `music.js` + Test 3/11/12.
5. Ansicht.
6. Messung (Test 10), Patchnotes, Testkette.
