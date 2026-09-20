# Architektur & Entwickler-Leitfaden

Diese Seite erklärt die **Muster und Prinzipien**, die sich durch den ganzen
Bot ziehen. Die [README.md](README.md) beschreibt die Features aus Spielersicht
– hier geht es darum, *wie* der Code funktioniert und *warum* er so gebaut ist.
Wer ein neues Feature anfängt, sollte das hier einmal gelesen haben.

---

## 1. Überblick in drei Sätzen

Ein Discord-Bot (discord.js v14), der ein Wirtschaftsspiel über UnbelievaBoat
abwickelt: Autos, Immobilien, Jobs, ein Casino und computergesteuerte
Marktteilnehmer. **Das Geld liegt bei UnbelievaBoat** (per API), **alles
andere** (Besitz, Verträge, Spielzustände) liegt in einer lokalen
SQLite-Datenbank. Bedient wird fast alles über **Buttons** in einem einzigen,
sich selbst neu aufbauenden Menü.

## 2. Wo Geld herkommt und wo Zustand liegt

Das ist die wichtigste Trennung im ganzen Projekt:

| | UnbelievaBoat-API | Lokale SQLite (`data/shop.db`) |
|--|-------------------|-------------------------------|
| **Was** | Bargeld & Bank der Spieler | Alles andere |
| **Modul** | [`src/unb.js`](src/unb.js) | [`src/db.js`](src/db.js) |
| **Beispiele** | `getBalance`, `changeCash` | Autos, Immobilien, Mietverträge, Jobs, Postfach, Blackjack-Runden |

Es gibt **keine** lokale Bilanz. Willst du wissen, wie viel jemand hat, fragst
du die API. Willst du jemandem Geld geben/nehmen, rufst du `changeCash` auf.

## 3. Die goldene Regel: kein Gelddrucker

Jedes Feature, das Geld erzeugen könnte, muss so gebaut sein, dass es **auf
Dauer keinen Gewinn aus dem Nichts** ermöglicht. Das ist die wiederkehrende
Design-Frage bei jedem PR. Beispiele, wie das gelöst wurde:

- **NPC-Käufer** ([`buyers.js`](src/buyers.js)) zahlen nie mehr als den
  Zeitwert eines Autos.
- **NPC-Mieter** ([`tenants.js`](src/tenants.js)) ziehen nur ein, wenn die
  Miete ≤ 1,5× marktüblich ist.
- **Casino** ([`casino.js`](src/casino.js)): jedes Spiel hat eine
  Rückzahlungsquote (RTP) ≤ 100 %.
- **Zwangsverkauf / Gebrauchtmarkt**: Erlöse liegen unter dem Neupreis.

- **Staatskasse** ([`treasury.js`](src/treasury.js)): sammelt 19 % / 40 % jeder
  Buchung, ohne dem Spieler etwas abzuziehen – und zahlt **nichts** an Spieler
  aus. Eine reine Senke erzeugt kein Geld im Kreislauf; erst eine Auszahlung
  würde diese Regel berühren.

**Diese Grenzen werden per Monte-Carlo-Test bewiesen, nicht behauptet.** Wenn
du etwas baust, das Geld auszahlt, schreib einen Test, der über viele tausend
Durchläufe zeigt, dass die Bilanz nicht positiv kippt (siehe
`test/buyers.test.js`, `test/casino.test.js`, `test/tenants.test.js`).

### Bewusste Ausnahme 2: die Börse

[`wallstreet.js`](src/wallstreet.js) hat seit dem Umbau zwei kleine Zuflüsse:
eine **gedeckelte Aufwärtsdrift** (sie gleicht aus, dass der Median eines
Zufallslaufs mit σ²·t/2 absackt) und **Nachbeben** nach seltenen Kursstürzen.

Der Grund: Als reines Martingal war die Börse rechnerisch fair, aber nur 39 %
aller Käufe gingen mit Gewinn raus – der Mittelwert wurde von seltenen
Ausreißern getragen. Ein Feature, bei dem der typische Spieler immer verliert,
wird nicht benutzt.

Beides ist gemessen und nach oben festgenagelt: Ein Bot, der stur tief kauft
und hoch verkauft, holt ~20 % auf das eingesetzte Kapital in sechs Wochen
(vorher, mit dauerhafter Kursbindung: +105 %). Wer hier etwas ändert, muss
diesen Wert im Test im Auge behalten.

### Bewusste Ausnahme 1: das Auktionshaus

[`storage.js`](src/storage.js) **erzeugt Geld** – mit Absicht, als
Produktentscheidung. Der Startpreis liegt bei rund 45 % des erwarteten Inhalts,
die typische Garage ist also etwa das 1,7-Fache ihres Aufrufpreises wert.

Der Grund: Vorher lag der Preis über dem Erwartungswert. Damit verlor jeder
Mitbieter im Schnitt – und ein Bietgefecht, also der ganze Sinn des Features,
war eine Selbstschädigung. Ein Wettbewerb um etwas, das sich nicht lohnt, ist
kein Wettbewerb.

Gedeckelt ist der Zufluss **nicht über den Preis, sondern über den Durchsatz**:
serverweit ist immer nur ein Los live, 20 Minuten lang. Mehr als ~11.000 pro
Stunde können daraus nicht ins Spiel fließen, und jedes Gegengebot senkt den
Schnitt des Gewinners weiter. `test/storage.test.js` rechnet diese Obergrenze
nach – die Regel ist damit nicht aufgehoben, sondern durch eine andere,
schwächere ersetzt.

Wer hier etwas ändert: Diese Ausnahme ist bewusst und dokumentiert. Sie
zurückzudrehen („der Startpreis muss doch über dem Erwartungswert liegen")
macht das Feature wieder kaputt.

## 4. Faule (lazy) Abrechnung statt Hintergrundjobs

Der Bot hat **keinen Scheduler und keinen Cronjob**. Alles Zeitabhängige –
Miete, Straßenschäden, NPC-Ankünfte, Mahnungen – wird **nachgeholt, wenn der
Spieler das nächste Mal interagiert**. Jedes solche System speichert einen
`last_check`/`checked_at`-Zeitstempel und rechnet beim nächsten Aufruf die
vergangenen Tage nach.

Das Muster (siehe [`street.js`](src/street.js), [`buyers.js`](src/buyers.js),
[`tenants.js`](src/tenants.js), `property.settleRent`):

```
1. Zeitstempel der letzten Prüfung holen
2. Beim allerersten Mal: nur Zeitstempel setzen, NICHTS nachholen
   (sonst würde man rückwirkend für Tage bestraft, die es das Feature nicht gab)
3. Vergangene Tage = floor((jetzt - letzterCheck) / TAG), gedeckelt (z.B. 14)
4. Zeitstempel aktualisieren (Rest der angebrochenen Periode bleibt erhalten)
5. Pro Tag die Ereignisse würfeln/abrechnen
```

**Wichtig:** Wiederholtes Aufrufen darf nichts erzeugen. Weil die Ereignisse an
der vergangenen *Zeit* hängen (nicht am Öffnen der Ansicht), bringt zehnmaliges
Klicken hintereinander nichts. Das ist in den Tests jeweils abgesichert
("Wiederholtes Aufrufen bringt nichts").

Zusammengeführt werden all diese Abrechnungen in **`settle(interaction)`** in
[`src/buttons.js`](src/buttons.js). Diese Funktion läuft, wenn ein Spieler ein
geld-/besitzrelevantes Menü öffnet (`RENT_RELEVANT`-Set), und sammelt die
Meldungen (Miete abgebucht, Auto gestohlen, NPC eingezogen, Rechnung fällig …)
in eine einzige ephemere Notiz.

## 5. Die Menü-Registry (so fügst du ein Menü hinzu)

Das Hauptmenü baut sich aus einer Liste in [`src/menu.js`](src/menu.js). **Ein
neuer Menüpunkt = ein Eintrag**, mehr nicht – Button im Hauptmenü, Navigation
und der Zurück-Weg entstehen automatisch:

```js
{
  id: 'werkstatt',                        // eindeutig, taucht in Button-IDs auf
  label: 'Werkstatt',
  emoji: '🔧',
  description: 'Autos reparieren',
  style: 'primary',                       // optional
  adminOnly: false,                       // optional: nur "Server verwalten"
  build: (ctx) => ui.buildWerkstattView(ctx),   // {guildId,userId,page,isAdmin}
}
```

`build` bekommt einen Kontext und gibt `{ embeds, components }` zurück. Der Test
[`test/menu.test.js`](test/menu.test.js) läuft **automatisch über jeden
Eintrag** – ein neues Menü ist ab dem ersten Tag gegen die Discord-Limits
geprüft, ohne dass du den Test anfassen musst.

## 6. Buttons: zustandslose IDs

Button-`customId`s tragen **allen Zustand in sich**, der zum Neuaufbau der
Ansicht nötig ist. Format durchgehend:

```
<aktion>|<param1>|<param2>|…|<userId>
```

- Der **letzte Teil ist immer die userId** dessen, der das Menü geöffnet hat.
  Der Router in [`src/index.js`](src/index.js) prüft damit, dass nur dieser
  Spieler klicken darf.
- Alles andere (Seite, Einsatz, Marke, Spiel-ID …) steckt davor.
- **Folge:** Buttons funktionieren auch nach einem Bot-Neustart weiter – es gibt
  keinen In-Memory-Zustand, der verloren gehen könnte.

Ein Handler heißt wie die Aktion. `buy|42|123` ruft `buttons.buy(interaction,
['42','123'])`. Die Handler liegen im `buttons`-Objekt in
[`src/buttons.js`](src/buttons.js). Neue Aktion = neue Methode dort.

Faustregeln zum Antworten:
- **Ansicht im selben Panel ändern** → `interaction.deferUpdate()` dann
  `interaction.editReply(view)` (oder `interaction.update(view)`).
- **Private Rückmeldung** (Kaufbestätigung o.ä.) → `interaction.deferReply({
  flags: MessageFlags.Ephemeral })` dann `editReply`.

Modals (Texteingabe, z.B. eigener Casino-Einsatz) laufen über ein separates
`modals`-Objekt und werden in `index.js` per `isModalSubmit()` geroutet.

## 7. Der Trick mit synchronem SQLite

`node:sqlite` ist **synchron**. Das nutzen wir bewusst gegen Doppelklicks aus:
Zwischen einem synchronen DB-Schreibvorgang und dem nächsten `await` kann kein
zweiter Klick dazwischenfunken (Node ist single-threaded).

Beispiel Blackjack ([`casinoPlay.js`](src/casinoPlay.js)): die Runde wird
**synchron in der DB reserviert, bevor** der erste `await` (die Geldbuchung)
passiert. Ein zweiter, schneller Klick findet dann schon eine laufende Runde
vor und wird abgewiesen – so kann der Einsatz nicht doppelt abgebucht werden.
Gleiches Prinzip beim Auszahlen: die Runde wird **vor** der Auszahlung gelöscht.

Wenn du geld-/besitzverändernde Aktionen baust: überlege, was zwei schnelle
Klicks anrichten, und schließe die Lücke synchron, bevor du `await`est.

## 8. Warten mit `await`: spät binden für Testbarkeit

Module, die UnbelievaBoat aufrufen, importieren **das Modul**, nicht die
Funktionen direkt:

```js
// so NICHT – die Referenz ist im Test nicht mehr austauschbar:
const { getBalance } = require('./unb');

// so – im Test lässt sich unb.getBalance ersetzen:
const unb = require('./unb');
const getBalance = (...a) => unb.getBalance(...a);
```

Dadurch können Tests `unb.getBalance = async () => ({...})` setzen und den
kompletten Geldfluss durchspielen, ohne echte API-Anfragen. Fast alle
`*.test.js` machen das (Wallet-Mock oben in der Datei). Wer neu eine
API-abhängige Funktion schreibt und diese Regel vergisst, merkt es sofort: der
Test schlägt mit einem echten 404 fehl.

## 9. Geldbuchung: eine Buchung pro Aktion

- **Netto in EINEM `changeCash`-Aufruf** buchen, wo möglich (z.B. Casino: bei
  Gewinn +Einsatz, bei Verlust −Einsatz). Kein Zwischenstand, in dem Geld
  entstehen oder verloren gehen kann.
- **Netto 0 niemals buchen.** Die UnbelievaBoat-API lehnt `{ cash: 0 }` mit
  *"Invalid cash and bank parameter provided"* ab. Ein Slots-Paar, das den
  Einsatz zurückgibt, überspringt die Buchung (siehe `casinoPlay.playRound`).
- **Erst lokal, dann Geld** bei mehrstufigen Käufen: erst den Artikel per
  Transaktion reservieren, dann buchen; schlägt die Buchung fehl, den lokalen
  Schritt zurückrollen (`purchase.js`, `property.js`). Umgekehrt wäre eine
  fehlgeschlagene Rückerstattung über die API nicht garantiert.

## 10. Bilder & Lizenzen

Auto- und Immobilienfotos kommen von **Wikimedia Commons** unter freien
Lizenzen (CC BY / BY-SA / gemeinfrei). Der Ablauf:

1. Katalog in [`src/data/catalog.js`](src/data/catalog.js) bzw.
   [`properties.js`](src/data/properties.js) mit Suchbegriffen.
2. `npm run images` / `npm run images:props` sucht Fotos, prüft die Lizenz,
   verlangt Mindestgröße und **verifiziert jede URL per HTTP**.
3. `npm run audit` prüft, ob ein Foto zum Modell passt (kein GLA statt A45).
4. Der Seed schreibt URL **und Namensnennung** in die DB.

**Der Bot liest Bilder aus der Datenbank, nicht aus den JSON-Dateien.** Wer
eine URL ändert, muss sie mit `npm run sync:images -- <server-id>` nachziehen –
`--reset` beim Seed würde Artikel löschen und per Kaskade den Besitz aller
Spieler mitnehmen.

## 11. Verzeichnisstruktur

```
src/
  index.js         Bot-Start, Interaktions-Router (Buttons, Modals, Commands)
  config.js        .env laden & prüfen
  unb.js           UnbelievaBoat-API (das einzige Modul, das Geld anfasst)
  db.js            SQLite: Schema-Migrationen + alle Queries an einem Ort
  menu.js          Menü-Registry (Hauptmenü + Dispatch)
  ui.js            View-Builder (Embeds + Buttons) für Autos/Immobilien/Jobs …
  casinoUi.js      View-Builder fürs Casino
  buttons.js       ALLE Button-/Modal-Handler + settle() (faule Abrechnung)

  purchase.js      Kauf: Auto/Ausrüstung, Garagen-Grenze, Rückabwicklung
  property.js      Immobilien: Kapazität, Miete, Kauf, Zwangsverkauf
  tenants.js       NPC-Mieter bei Spieler-Vermietern
  buyers.js        NPC-Käufer für Spieler-Inserate + Postfach-Angebote
  bills.js         Rechnungen (Infrastruktur; erzeugt noch keine)
  npc.js           NPC-Marktanzeigen (Gebraucht & Immobilien)
  jobs.js          Arbeitsamt: Tagesauswahl, Schichten, Voraussetzungen
  street.js        Straßenrisiko (Kratzer/Schaden/Diebstahl)
  condition.js     Fahrzeugzustand 0–100 + Wertformel
  currency.js      Serverwährungssymbol (gecacht)
  seed.js          Katalog-Abgleich beim Start (Ausrüstung, Autos, Immobilien)
  activity.js      Strichliste "was tust du am häufigsten" -> Titel im Profil
  podium.js        Glückwunsch, wenn jemand auf Platz 1-3 der Reichsten steigt
  networth.js      Vermögen an EINER Stelle: Geld + Autos + Immobilien
                   + Depot + Sammlung (alle Ranglisten/Ansichten nutzen es)
  toplist.js       Reichen-Rangliste: UnbelievaBoat + lokale Geldbeutel + Besitz
  topEcho.js       Antwortet auf `!top` mit unserer Rangliste (Präfix mitlesen)
  casino.js        Reine Spiellogik (Karten, Slots, Roulette, Coinflip)
  casinoPlay.js    Casino-Geldfluss + Blackjack-Rundenverwaltung

  commands/        Slash-Command-Definitionen (dünn – rufen die Builder auf)
  data/            Kataloge (Autos, Immobilien, Ausrüstung, Jobs, NPC-Texte)
                   + *-images.json (von den Scripts erzeugt)
scripts/           Bild-Werkzeuge (fetch / audit / sync)
test/              Ein *.test.js pro Bereich; `npm test` läuft alle
```

## 12. Entwickeln

```bash
npm install
cp .env.example .env      # Tokens eintragen (siehe README)
npm test                  # alle Tests (kein Netz nötig – API ist gemockt)
npm run deploy            # Slash-Commands registrieren
npm start                 # Bot starten
```

### Tests

Es gibt **keinen Test-Runner** – jede `test/*.test.js` ist ein eigenständiges
Node-Skript, das `✅/❌`-Zeilen ausgibt und mit Exitcode ≠ 0 beendet, wenn
etwas fehlschlägt. `npm test` hängt sie mit `&&` aneinander. Ein neuer Bereich
bekommt eine neue Datei und wird ans `test`-Skript in `package.json` angehängt.

Worauf die Tests besonders achten (und dein neuer Test auch sollte):
- **Kein Gelddrucker** (Monte-Carlo, siehe §3).
- **Faule Abrechnung ist idempotent** – wiederholtes Aufrufen ohne Zeitablauf
  ändert nichts (§4).
- **Discord-Limits** – ≤ 5 Zeilen, ≤ 5 Buttons/Zeile, Label ≤ 80,
  Beschreibung ≤ 4096 (§5).
- **Rückabwicklung** – schlägt ein Schritt fehl, bleibt der Besitz erhalten.

### Nach einer Änderung

`npm test` muss grün sein, dann `npm run deploy` (nur nötig, wenn sich
Command-Definitionen geändert haben) und `npm start` neu. Slash-Commands werden
auf `DEV_GUILD_ID` sofort aktiv, global bis zu 1 h.

## 13. Bewusst offene Baustellen

- **Rechnungen** ([`bills.js`](src/bills.js)) sind vollständig gebaut, aber es
  werden noch keine erzeugt – welche Kosten (Kfz-Steuer, Grundsteuer,
  Versicherung) ist eine Balance-Entscheidung.
- **Casino** nutzt Emoji statt externer Gifs (bewusst, wegen Zuverlässigkeit).
- Ein Automodell kann pro Spieler **nur einmal** besessen werden – der Zustand
  hängt am Besitzeintrag. Mehrere gleiche Autos bräuchten eine eigene
  Fahrzeug-Tabelle.

## 14. Erfolge

`src/achievements.js` hält ein deklaratives Regelwerk. Ein neuer Erfolg ist ein
Eintrag in `RULES` – sonst nichts. Drei Andockpunkte:

- `kind:<id>` – läuft in `activity.record`, dem einzigen Ort, den jede
  Aktivität durchläuft: auch der Buchungspfad (`unb.countActivity`) landet
  dort, aber ebenso Überfall, Vermieten und Casino, die bewusst ohne `kind`
  buchen. Dort werden **nur** Regeln dieses `kind` geprüft; teure Werte
  (Vermögen, Depot) werden ab dem **zweiten** Ereignis eines Kontos nie
  berechnet. Beim allerersten Ereignis läuft davor einmalig der stille
  Bestands-Nachtrag (`backfill`, siehe unten) – der rechnet dabei einmalig
  das Vermögen, damit er den Fortschritt vor diesem Ereignis richtig
  einordnet.
- `state` – läuft beim Aufbau von Profil und Startseite. Im Profil liegt das
  Vermögen ohnehin vor und wird übergeben; auf der Startseite holt `stateCtx`
  es bei Bedarf selbst über die API – aber nur, wenn `state()` vorher billig
  feststellt, dass überhaupt noch ein state-Erfolg offen ist.
- `fire:<name>` – die Hintertür für Ereignisse ohne Geldbuchung
  (`achievements.fire(...)` in heist.js, home.js, casinoPlay.js, storage.js).

Die serverweite Einmaligkeit hängt am Primärschlüssel von
`achievement_firsts`, nicht an einer Prüfung im Code (§7): Zwei gleichzeitige
Spieler bestünden ein „gibt es den schon?" beide.

Erfolge geben **kein Geld und keine XP** (§3). Das Modul bindet weder `unb`
noch `wallet` ein – es hat also gar keinen Weg, etwas auszuzahlen. `level` wird
nur gelesen (`progress()` rechnet aus vorhandener Erfahrung ein Level aus),
nie vergeben.

Der Nachtrag für Bestandsspieler ist **lautlos**: Beim ersten Blick eines
Kontos wird alles bereits Erfüllte still vergeben, ohne Postfach und ohne
Durchsage. Ohne das käme am Tag der Einführung für jeden langjährigen Spieler
eine Meldungswelle. Erfolge, für die es keine Daten aus der Vergangenheit gibt
(ein perfekter Coup wird nirgends festgehalten), tragen `backfill: false` und
starten leer. `onActivity` und `fire` tragen zusätzlich selbst nach (über
den vorhandenen Marker abgesichert, damit der Normalfall synchron bleibt,
§7) – ein Bestandskonto, das nie eine Ansicht öffnet, sondern gleich
arbeitet oder ins Casino geht, bekommt sonst genau dort seine Meldungswelle.
`backfillWorld` läuft einmalig, angestoßen aus `state()`, damit ein
serverweiter Erfolg beim Nachtrag an den stärksten Kandidaten geht statt an
den zufällig ersten Betrachter.

**Sperre, bis der Welt-Nachtrag fertig ist:** `state()` vergibt keine
serverweiten Erfolge, solange der Marker `ach_backfill_world_fertig` für die
Welt fehlt (siehe `check()`, Parameter `serverweitErlaubt`). Der Grund: Ein
Blick aufs Profil oder die Startseite ist keine Leistung – ohne diese Sperre
schnappt sich sonst der erste Betrachter nach einem Deploy ein serverweites
Abzeichen, bevor `backfillWorld` überhaupt alle Kandidaten verglichen hat.
Die Sperre fällt endgültig, sobald der Fertig-Marker gesetzt ist; `state()`
stößt `backfillWorld` dafür bei jedem Aufruf ohne diesen Marker selbst an
(fire-and-forget, dedupliziert über den eigenen Start-Marker von
`backfillWorld`). `onActivity` und `fire` reichen den Parameter bewusst nicht
durch (Default `true`): Dort hängt der Erfolg an einer echten Tat, nicht an
einem Blick, und darf gewinnen, auch bevor der Welt-Nachtrag gelaufen ist.
Der Start-Marker von `backfillWorld` (`ach_backfill_world`) wird im
Fehlerfall (eine werfende Regel, ein Absturz beim Guthaben holen) wieder
zurückgenommen, damit ein späterer Aufruf es erneut versucht – sonst käme
der Fertig-Marker nie, und die sechs serverweiten Erfolge blieben für die
Welt auf Dauer gesperrt, heilbar nur noch per Datenbankeingriff.

## 15. Die Rangfolge der Geldquellen

Die Einnahmequellen sind gegeneinander **gemessen**, nicht geschätzt – mit
`scripts/messung-geldquellen.js`: simulierte Karrieren über ein bis zwei Jahre,
fester Würfel, mehrere Spielweisen je Archetyp (gewertet wird die beste),
Median statt Mittelwert. Stand 2026-09-11:

| nach 2 Jahren täglichen Spielens | Ertrag/Tag |
|---|---|
| Musik + Creator | ~490.000 |
| nur Creator | ~315.000 |
| Goldtransport (je Crew-Mitglied) | ~86.000 |

Die Rangfolge ist gewollt: Musik+Creator ist die beste Quelle, weil sie zwei
Systeme und ein gemeinsames Zeitbudget verlangt. „Nur Creator" bleibt eine
tragfähige Spielweise. Heists sind ein Ereignis, kein Job.

**Firmen (seit 1.31.0, Stück 1 ohne Ausbau):** Die Decke ist je Branche eine
vorgerechnete Zahl (`company.ceilingOf`), geprüft in `test/company.test.js` –
Spedition 78.000/Tag, Café 21.600, Kiosk 2.850 bei voller Besetzung mit
Schichtleitern, Werbung und täglichem Anpacken. Gemessen im Vollbetrieb (365
Tage, Median, `firmenlauf` im Messskript, Stand 2026-09-13): Kiosk 2.850/Tag,
Café 21.600/Tag, Spedition 78.000/Tag – mit durchgehender Werbung erreicht die
Auslastung 1,0, der Median liegt auf der Decke; Amortisation des
Gründungspreises nach 20 / 14 / 37 Tagen. Alle unter Musik+Creator
(100.916/Tag im selben Lauf über ein Jahr); das Endgame kommt mit dem Ausbau
(Stück 2). Die Spedition stand mit `umsatz` 2.600 bei 103.280/Tag und damit
über Musik+Creator – deshalb 1.900. NPC-Löhne sind eine echte Senke, die
Kasse darf ins Minus (Insolvenz nach 14 Tagen).

**Ausbau (seit 1.32.0, Stück 2a):** Fünf Stufen und vier Extras je Branche
heben Plätze und Umsatz je Schicht; Löhne skalieren nicht, die Marge wächst
mit der Größe. Volle Decke (`company.fullCeilingOf`): Spedition 487.095/Tag,
Café 133.380, Kiosk 16.631. Gemessen voll ausgebaut (365 Tage, Median, Stand
2026-09-13): Kiosk 16.636/Tag, Imbiss 21.015, Autowäsche 17.827, Café 133.360,
Fitnessstudio 87.838, Werkstatt 134.248, Spedition 487.060, Baufirma 558.304,
Club 414.900 – jede Branche etwa ×6 ihres Kernwerts (5,6 bis 7,4), der Median
liegt auf der Decke (an zwei von drei Tagen läuft keine Werbekampagne an und
alle vier Anpacken passen ins Zeitbudget). Gründung plus Gesamtausbau
amortisieren sich in 51 (Café) bis 123 (Spedition) Tagen; Ausnahme Baufirma
mit 159 Tagen (siehe unten). Aus eigener Kraft (nur Gewinn reinvestiert,
Stufe vor Extra) ist die Spedition nach 262 Tagen voll, das Café nach 95, der
Club nach 257; die Baufirma erreicht Stufe 5 im ersten Jahr nicht. Investitionen
buchen ohne XP (Umbuchung, keine Ausgabe).

**Die Rangfolge voll ausgebaut:** Die Baufirma ist mit 558.304/Tag die Spitze,
noch vor der Spedition (487.060) – Beschluss des Nutzers 2026-09-13: „die
Baufirma kann die Spitze sein". Die Spedition liegt damit gleichauf mit
Musik+Creator nach zwei Jahren (490.099) – die Königsdisziplin *mit* Firma,
aber erkauft: ~50 Mio Ausbau. Alle anderen Branchen (Kiosk, Imbiss,
Autowäsche, Café, Fitnessstudio, Werkstatt, Club) liegen darunter.

Die **Baufirma** hat eigene Stufenfaktoren (1,3 · 1,6 · 1,9 · 2,2 · 2,5 statt
1,2…2,2), und das ist gewollt, kein Kompromiss: Mit den Standardfaktoren stand
sie bei 495.574/Tag und 178 Tagen Amortisation, weil ihr Ausbau mit 74,7 Mio
(bei Kern-Decke 75.000) der teuerste im Spiel ist – die Löhne (500) fressen
dort die Marge stärker als anderswo. Die eigenen Faktoren heben sie über die
Spedition und drücken die Amortisation auf 159 Tage; die Faktoren sind der
einzige Hebel, der den Kern (Stück 1) nicht verschiebt.

Die Decke oben gilt für NPC-Personal. Mit **Spieler-Angestellten** liegt sie
deutlich höher: Ein Spieler bringt ×1,3 Umsatz und steht bis zu 4 Schichten am
Tag statt 3. Voll ausgebaut mit 26 Spieler-Schichtleitern brächte die Baufirma
26 × 4 × 1.700 × 1,5 × 1,3 × 2,95 = 1.017.042 brutto, minus Löhne 26 × 4 × 750
= 78.000, plus Anpacken 30.090 → ~969.000/Tag; die Spedition (22 Plätze,
×2,65) ~839.000/Tag – rund das Doppelte von Musik+Creator. Das ist eine
bewusste Entscheidung (2026-09-13, Beschluss A): Wer 26 echte Mitspieler für
750 je Schicht organisiert, hat es verdient. Zweitkonten sind ein
Moderationsthema, kein Balance-Thema.

**Seit 1.33.0 (24-h-Tag, eine Energie, §17):** gemessen 365 Tage, 10 Läufe,
Median je Tag, Musik+Creator mit Stundendeckel (`--stunden=N`) – 8 h/Tag
149.415 (Ø Energie am Tagesende 98 %), 12 h 234.731 (83 %), 16 h 329.875
(63 %), bis zur Wand 369.752 (11 %), Marathon im Wechsel mit Ruhetag
(`--marathon`) 133.796 (49 %). Die Ø-Energie-Werte sind gemessen nach der
letzten Aktion, mit Aktionen so dicht, wie die Sperren es zulassen; wer 16
Stunden über den ganzen Tag verteilt, erholt sich zwischendurch (4 Punkte je
Echtzeit-Stunde) und sieht diese Werte nicht. Die Energie ist die Bremse für
lange Tage: ohne Malus (Kontrolllauf, Faktor ≡ 1, Wand bleibt) lägen 16 h bei
390.345 und die Wand bei 570.473 – der Faktor nimmt dem 16-h-Tag 15 %, dem
Tag bis zur Wand 35 %. Die 8-h-Zahl vor 1.33.0 war 100.916/Tag (reproduziert,
gleicher Würfel); der Sprung auf 149.415 hat zwei gemessene Gründe, keiner
davon ist die Kurve: Das alte Messskript rückte die Uhr nicht vor und ließ
Stunden liegen, sobald alle Plattformen gesperrt waren (dasselbe neue Skript
auf dem alten Spiel: 134.870), und die alte Creator-Erschöpfung (linear
−35 %, nur 55 % Erholung je Tag) drückte einen normalen Tag dauerhaft auf
einen Dauer-Malus von überschlägig ×0,85 – die neue Kurve lässt ihn bei
Faktor ≈ 1 (Ø 98 % Energie). Die Quartile der 10 Läufe liegen zwischen −3 %
und −12 % unter bzw. +2 % und +20 % über dem Median (8 h streut am
stärksten: 131.511 … 179.739); die Wahl der Strategie in der Suchphase
streut ähnlich. Die Spec hatte 8 h innerhalb ±15 % von 100.916 und 16 h
‚deutlich unter 2×' erwartet; gemessen sind es +48 % (davon +34 %
Messskript, +11 % Spiel) und 2,21×, bis zur Wand 2,47× – knapp unter dem
2,5×-Auslöser für eine steilere Kurve und innerhalb der Strategie-Streuung.
Beschluss des Nutzers 2026-09-14: Konstanten bleiben (‚einfach lassen').

Firmen im Vollbetrieb neu (365 Tage, Median): Kiosk 2.831/Tag, Café 21.529,
Spedition 77.849; voll ausgebaut Baufirma 557.910, Spedition 486.664, Café
133.173 – Anpacken passt jetzt viermal auch an Werbetagen (2 + 4 × 2 = 10 von
24 Stunden), der Faktor drückt das dritte und vierte leicht (Kiosk von Hand:
375 × (0,999 + 0,995 + 0,985 + 0,967) = 1.480 statt 1.500, also 2.830 ≈
2.831). Das Zeitbudget bremst die Firma weiterhin nicht – der Umsatz kommt
aus Plätzen und Schichten, nicht aus der Zeit des Inhabers; die Bremse für
Firmen ist das Geld (50–75 Mio Ausbau, 51–158 Tage Amortisation).

**Ereignisse (seit 1.34.0, Stück 2b; alle Zahlen in diesem Absatz Stand vor
1.35.0, ohne Wareneinsatz – die neuen stehen im Absatz „Waren“ darunter):** Die Abrechnung würfelt je Tag ein
leichtes Ereignis (`data/companyEvents.js`, `none` mit Gewicht 140 gegen 9 × 5
bei kleinen und 12 × 5 bei mittleren/großen Firmen – also 24 % bzw. 30 % der
Tage) und je Abrechnung einen Vorfall (`decisions.roll(…, 'company')`,
`riskPerDay = 2 % + Größe/9 × 6 %`, Größe = Stufe + Extras). Die **Ereignis-
Decke** ist eine Umsatz-Decke, keine zweite Gewinn-Decke: kein Katalogeintrag
hebt den Tagesumsatz über `× 1,15` (`EVENT_UMSATZ_MAX`), Boosts stapeln nicht
(ein neuer ersetzt den laufenden, Maximum statt Produkt), `kasse` ist nie
positiv, eine Rückerstattung nie größer als der Abzug derselben Option, und
die Übernahme zahlt höchstens investiert + Kasse. Je Branche gilt für den
NPC-Umsatz eines Tages `Plätze × 3 × round(Umsatz × 1,5) × 1,15` – im Kern (gerundet, Kiosk
exakt 2.587,5) Kiosk 2.588, Imbiss 3.726, Autowäsche 2.691, Café 23.288, Fitnessstudio
14.490, Werkstatt 22.770, Spedition 98.325, Baufirma 105.570, Club 74.520
(brutto, neben der Netto-Decke 2.850 … 78.000 oben); voll ausgebaut Kiosk
17.147, Café 148.129, Spedition 573.273, Baufirma 674.813, Club 460.782.
Die Abrechnung rundet je Schicht `round(Umsatz × Faktor × 1,15)`, die Decke
`round(Umsatz × Faktor) × 1,15` – der Unterschied ist höchstens 0,8 je
Schicht darüber (nach unten bis 1,05) über alle Stufen und Extras
(nachgerechnet), im Kern höchstens 0,5;
die Prüfgrenze ist deshalb Decke + 0,5 je Schicht (Test) bzw. + 1 je
Schicht (Messskript). Gemessen (365 Tage, fester Würfel, `firmenlauf` mit und
ohne Ereignisse im selben Lauf: `DATA_DIR=.testdata node
scripts/messung-geldquellen.js 10 365`, fester Seed – der Lauf vom 2026-09-20
war im Firmen-Teil zeilengleich mit dem vom 2026-09-15; die Firmen-Blöcke
liegen in `docs/messungen/2026-09-20-firmen-ereignisse.txt`) liegt der beste
Tag überall höchstens auf der Prüfgrenze (Club genau auf der Ereignis-Decke,
Baufirma und Fitnessstudio auf der +0,5-je-Schicht-Grenze): Der Club trifft
die Decke exakt (Kern 74.520, voll 460.782), Baufirma und Fitnessstudio im
Kern liegen um genau die Rundung darüber – Baufirma 105.588 = 36 × round(2.932,5) = 36 × 2.933 gegen 105.570
(+18 = 0,5 × 36 Schichten), Fitnessstudio 14.496 = 12 × round(1.207,5) gegen
14.490 (+6 = 0,5 × 12). Der Median **mit** Ereignissen liegt in jeder Branche
5–11 % unter dem ohne: im Kern Kiosk 2.536 statt 2.831 (−10 %), Imbiss 3.279
statt 3.446 (−5 %), Autowäsche 2.855 statt 3.160 (−10 %), Café 19.414 statt
21.529 (−10 %), Fitnessstudio 12.673 statt 14.045 (−10 %), Werkstatt 18.400
statt 20.552 (−10 %), Spedition 71.160 statt 77.849 (−9 %), Baufirma 66.803
statt 74.865 (−11 %), Club 62.145 statt 68.749 (−10 %); voll ausgebaut Kiosk
15.256 statt 16.583 (−8 %), Imbiss 18.907 statt 20.964 (−10 %), Autowäsche
15.977 statt 17.773 (−10 %), Café 126.958 statt 133.173 (−5 %),
Fitnessstudio 80.056 statt 87.693 (−9 %), Werkstatt 123.787 statt 134.020
(−8 %), Spedition 436.834 statt 486.664 (−10 %), Baufirma 501.780 statt
557.910 (−10 %), Club 374.329 statt 414.397 (−10 %). Schlecht ist teurer
als gut, wie in §3 gewollt. Vorfälle im Lauf: 4–8 im Jahr bei Größe 0, 24–32 voll ausgebaut,
mit 5–9 bzw. 9–20 geschlossenen Betriebstagen (Schließung bis 5 Tage, Löhne
laufen weiter). Die Kurve allein gäbe 7,3 bzw. 29,2; nach jedem Vorfall ist
der nächste Abrechnungstag gesperrt (`MIN_GAP_MS` 36 h, die Entscheidung
fällt im Lauf sofort), was die Erwartung nur wenig drückt: die Formel
p/(1+p) je Tag gibt 7,2 bzw. 27,0, die Simulation (10.000 gewürfelte Jahre,
`vorfaelle-verteilung.js` im lokalen Messordner) im Mittel 7,14 bzw. 27,05. Der Rest ist Streuung:
10–90 % der Jahre liegen bei 4…11 bzw. 21…33 Vorfällen, und der Lauf hat
einen festen Seed – die Zählung je Branche ist eine Stichprobe von 365 Tagen,
keine neun unabhängigen (dass alle mittleren und großen Branchen im Kern auf
4 kommen und Kiosk wie Autowäsche auf 8, legt dasselbe Würfelfenster nahe;
geprüft ist das nicht). Der simulierte Inhaber entscheidet Vorfälle sofort mit einer
zufälligen Option (nie „Verkaufen") und schießt Kapital nach, wenn Ereignis
oder Schließung die Kasse unter die Werbekosten oder ins Minus drücken – die
Spielweise, die die Ansicht bei „Kasse im Minus" empfiehlt (Kern-Kiosk
11.184 an 15 Tagen, voll ausgebaute Spedition 2,9 Mio an 14 Tagen; das sind
Umbuchungen vom Konto, im Median nicht enthalten und in der Amortisation
gegengerechnet). Die Rangfolge bleibt: Die Baufirma führt mit 501.780, die
Spedition (436.834) fällt mit Ereignissen unter Musik+Creator nach zwei
Jahren (490.099); die Amortisation des Vollausbaus dauert 61 (Café) bis 178
(Baufirma) Tage statt 51 bis 158. Aus eigener Kraft kostet der Weg zum
Vollausbau mit Ereignissen 4–20 Tage mehr (Café 98 statt 94, Kiosk 141 statt
136, Spedition 280 statt 260, Club 270 statt 254). Eine Beobachtung am
Entwurf, hier nicht behoben: `hireNpc`, `fire` und `promote` sind kostenlos
und sofort wirksam, also lassen sich die Stiche `quit`, `wages` und `lock`
weitgehend umgehen – wer die Belegschaft entlässt und am nächsten Tag neu
einstellt, zahlt weder den Lohnfaktor noch die Löhne der Schließung, nur das
Auslastungsziel sinkt für die Zeit. Ein Balance-Punkt für später
(Einstellsperre nach Entlassung oder Rang-Anlauf), kein Fehler in 2b.

**Waren (seit 1.35.0, Stück 3a):** Jede Schicht (NPC, Spieler, Anpacken)
verbraucht eine Einheit Ware; jede Branche hat eine (`b.ware`: Kiosk
Handelsware von LAGR, Baufirma Beton & Stahl von BETO …) und der Lieferant
ist eine Aktie der Börse. Der Einheitspreis bei Kurs = Start ist ein
Fünftel des Schichtumsatzes (`WARE_SHARE` 0,2: Kiosk 50, Café 180,
Spedition 380, Baufirma 340, Club 480), der Tagespreis skaliert mit dem
Kursverhältnis zum Startkurs, geklemmt auf 0,5 … 2,0 (`WARE_KURS_MIN/MAX`) –
ein Kurssturz macht Ware billig, nie umsonst, eine Blase teuer, nie
unbezahlbar; er wird **einmal je Abrechnung** gelesen und gilt für alle
nachgeholten Tage. Wer kein Lager hat, kauft ad hoc zum Aufschlag von 25 %
(`AD_HOC_MARKUP`), von der Kasse, die dabei wie bei Löhnen ins Minus darf.
Das Lager fasst sieben Vollbetriebs-Tage (`LAGER_TAGE` × (Plätze × 3 + 4)),
wird aus der Kasse zum Tagespreis gefüllt (`buyStock`, Menge oder „voll") und
beim Schließen oder Verkauf zum Einstand (`stock_cost`) ausgezahlt. Der Hedge
ist die Börse selbst: Wer die Aktie des Lieferanten hält, gewinnt am Kurs, was
ihn die Ware mehr kostet. Die Decke (`ceilingOf(...).net`) zieht die Ware
zum Startkurs ab (`Units × wareUnit`, Units = Plätze × 3 + 4). Der Ausbau
hebt den Umsatz, nicht den Warenpreis – deshalb kostet die Ware im Kern
15–18 % der Decke, voll ausgebaut 5–6 %:

| Branche | Kern vor 1.35.0 → neu | Vollausbau vor 1.35.0 → neu |
|---|---|---|
| Kiosk | 2.850 → 2.350 | 16.631 → 15.681 |
| Imbiss | 3.465 → 2.841 | 21.015 → 19.815 |
| Autowäsche | 3.180 → 2.660 | 17.837 → 16.849 |
| Café | 21.600 → 18.180 | 133.380 → 126.180 |
| Fitnessstudio | 14.100 → 11.860 | 87.855 → 83.095 |
| Werkstatt | 20.640 → 17.120 | 134.265 → 126.785 |
| Spedition | 78.000 → 65.080 | 487.095 → 460.495 |
| Baufirma | 75.000 → 61.400 | 558.345 → 530.465 |
| Club | 68.940 → 58.380 | 414.900 → 392.820 |

(Handrechnung Spedition Kern: 96.900 − 18.900 − 34 × 380 = 65.080.) Die
Rangfolge bleibt (Baufirma > Spedition > Club, alle Kern-Decken unter
Musik+Creator); der Ereignis-Deckel (Umsatz × 1,15) ist unberührt, Waren
sind Kosten, kein Umsatz. Gemessen (365 Tage, fester Würfel, `DATA_DIR=.testdata
node scripts/messung-geldquellen.js 10 365`, Firmen-Blöcke in
`docs/messungen/2026-09-20-firmen-waren.txt`; die Messwelt hat keine
Börsenticks, also Kurs = Start und Einkauf zum Einheitspreis – Kurs-Effekte
sind hier nicht gemessen): Der simulierte Inhaber kauft täglich nach der
Werbung das Lager voll (am ersten Tag mit genug Kasse ein ganzes, danach den
Verbrauch von gestern; die Entnahme lässt Werbung plus nächsten Einkauf in der
Kasse; ein Einkauf über den Tagesverbrauch hinaus lässt die Werbekosten
stehen – sonst fehlt der Baufirma mit 90.000 je Kampagne bei 61.400 Tagesgewinn
zwei Tage später die Werbung). Ohne Ereignisse liegt der Median in jeder
Branche genau um `Units × wareUnit` unter dem Wert vor 1.35.0 (Kiosk 2.331 =
2.831 − 10 × 50, Spedition 64.929 = 77.849 − 34 × 380, Baufirma voll 530.030 =
557.910 − 82 × 340) und der beste Tag – mit der verbrauchten Ware zum
Einheitspreis gerechnet – unter der Decke (Kiosk 2.331 ≤ 2.350, Spedition
voll 460.064 ≤ 460.495; roh kann ein Tag darüber liegen, wenn der Einkauf
auf einen anderen Tag fiel, etwa nach einem Ausbau des Aufsteigers).
**Mit** Ereignissen im Kern: Kiosk 2.037 (vor 1.35.0 2.536), Imbiss
2.629 (3.279), Autowäsche 2.338 (2.855), Café 15.956 (19.414), Fitnessstudio
10.382 (12.673), Werkstatt 14.797 (18.400), Spedition 58.238 (71.160),
Baufirma 55.830 (66.803), Club 51.605 (62.145) – 16–20 % weniger; voll
ausgebaut Kiosk 14.321 (15.256), Imbiss 17.707 (18.907), Autowäsche 14.989
(15.977), Café 119.758 (126.958), Fitnessstudio 75.296 (80.056), Werkstatt
116.307 (123.787), Spedition 412.039 (436.834), Baufirma 471.973 (501.780),
Club 352.144 (374.329) – 6 % weniger. Wareneinsatz je Tag (Einkäufe minus
Lagerwert am Ende plus ad hoc, mit Ereignissen): Kern Kiosk 490, Café 3.341,
Spedition 12.743, Baufirma 13.681; voll Kiosk 897, Café 6.960, Spedition
25.955, Baufirma 27.249, Club 21.518 – an einem vollen Tag sind es genau
`Units × wareUnit` (Kiosk voll 19 × 50 = 950, Spedition voll 70 × 380 =
26.600), geschlossene Tage verbrauchen nichts und drücken den Schnitt; ohne
Ereignisse liegt die Spedition voll bei 26.655 = (25.340 × 380 + 210 × 475)
/ 365, die 210 ad-hoc-Einheiten sind die Anlaufzeit. Der Anteil ad hoc liegt
bei 2,5–5,1 % im Kern und 0,8–1,4 % voll ausgebaut – die Tage, bis die Kasse
das erste Lager bezahlt, und Tage nach Kassenabzügen; Ausreißer ist die
Baufirma im Kern mit 12,9 % (ohne Ereignisse 9,3 %): Werbung 90.000 je
Kampagne gegen 61.400 Tagesgewinn – ohne Ereignisse sind es 1.360
Einheiten ad hoc bei 40 Einheiten Tagesverbrauch, also 34 Tage bis zum
ersten vollen Lager (95.200, Füllung um Tag 35); mit Ereignissen scheitert
der Einkauf 56× im ganzen Jahr, nicht nur beim Anlauf (dort wächst ad hoc
auf 1.833 Einheiten, höchstens rund 46 Tage), sondern auch später, wenn
Kassenabzüge (Werbung, Vorfälle) das Lagergeld erneut auffressen. Die
Rangfolge bleibt: Baufirma 471.973 vor Spedition 412.039 (16 % unter
Musik+Creator nach zwei Jahren, 490.099) und Club 352.144. Amortisation
des Vollausbaus mit Ereignissen 64 (Café) bis 188 (Baufirma) Tage statt 61
bis 178; aus eigener Kraft dauert der Vollausbau 14–20 % länger (Kiosk 168
statt 141, Café 113 statt 98, Fitnessstudio 210 statt 184, Spedition 332
statt 280, Club 323 statt 270 Tage), die Baufirma schafft ihn wie vor
1.35.0 nicht im Jahr. Handprüfung eines Kiosk-Tages (`--trace=kiosk:keiner:ohne`, Tag 34,
volles Lager, keine Werbung): morgens 1.750 in der Kasse, Einkauf 10 × 50 =
500, Anpacken 4×, vor der Abrechnung 2.729, Umsatz 2.250 − Löhne 900 →
abends 4.079, keine Ware von der Kasse (6 Einheiten aus dem Lager, 0 ad
hoc), Tagesgewinn 2.329 (Decke 2.350; das dritte und vierte Anpacken sind
müder, wie oben). Das erste Lager kostet an Tag 13 einmalig 70 × 50 = 3.500;
davor kaufen alle Schichten ad hoc (6 × 63 = 378 je Tag für die
NPC-Schichten, dazu je Anpacken 63).

### Eine Bremse, nicht zwei

Jede Einnahme darf **eine** unterlineare Kurve haben – nicht zwei übereinander,
und keine überlineare. Beides gab es:

- Die Creator-Plattformen hatten `reachOf` (Exponent 0,58) **und** die
  Vermarktungskurve `monetization()` (6 % bei 10.000 Followern). Zwei Bremsen;
  die zweite ist weg. Der Satz je Aufruf ist jetzt der, der im Code steht.
- Die Musik multiplizierte `monetization()` auf eine Einnahme, die bereits
  linear in den Hörern war – das ergab `Hörer^1,73`, die einzige überlineare
  Einnahme im Spiel. Jetzt `k × Hörer^1,2` (`royaltyPerDay`), unterlinear in der
  Zeit, weil die Hörer selbst unterlinear wachsen.

Wer eine Einnahme anfasst, prüft danach die Messung neu. Die Kalibrierwerte
(`REACH_K`, `GROWTH`, `MERCH_FACTOR`, `ROYALTY_ANCHOR`) tragen im Code den
gemessenen Grund für ihre Höhe.

### Musik und Kanäle: eine Einbahnstraße

Musik zahlt auf die Kanäle ein (`SOCIAL_SPILL`, `reachBonus` als Untergrenze
der Gesamtreichweite, Startbonus beim ersten Kanal). Die Kanäle zahlen **nicht**
auf die Musik ein – `CREATOR_SPILL` ist entfernt. Beides zusammen wäre ein
Kreislauf, der sich selbst füttert.

### Tests und Messläufe schreiben nicht in die Spieldatenbank

`DATA_DIR` lenkt die Datenbank um; `npm test` legt seine Welten in `.testdata`
an. Vorher schrieb alles in `data/shop.db` – die Datei war auf 60 MB mit 2.253
Welten gewachsen, und weil SQLite jeden Schreibvorgang auf die Platte zwang,
lief ein Messlauf elf Minuten für dreißig Sekunden Rechenzeit. `synchronous`
steht im Betrieb auf `NORMAL` (mit WAL der übliche Kompromiss), für
Wegwerf-Datenbanken auf `OFF`.

## 16. Die Brücke antwortet

Die Kanal-Brücke (`src/relay.js`) spiegelt Nachrichten zwischen Discord und
Fluxer als Persona des Absenders (Webhooks). Seit 1.30.0 merkt sie sich dabei
in `relay_messages`, welche Nachricht welche gespiegelt hat – ein Paar
`discord_id ↔ fluxer_id`, **14 Tage** lang, aufgeräumt beim Einfügen (§4).

Eine Antwort wird damit zuordenbar, aber die Plattformen können nicht dasselbe:

| Richtung | Darstellung | Warum |
|---|---|---|
| Discord → Fluxer | echte Antwort (`replyTo`), Persona bleibt, Autor wird gepingt (`replied_user` – Zustellung am 2026-09-12 live bestätigt) | Fluxers Webhook-Endpunkt nimmt `message_reference` an (geprüft 2026-09-12) |
| Fluxer → Discord | Zitat-Zeile `> ↩️ **Name:** Kopfzeile…` (80 Zeichen) | Discord-Webhooks dürfen nicht antworten |

Ist das Original der Brücke unbekannt (älter als 14 Tage, nie gespiegelt),
kommt auch nach Fluxer das Zitat; lässt es sich nicht mehr laden, wird ohne
Hinweis gespiegelt. Erwähnungen im Zitat werden lesbar übersetzt, pingen aber
niemanden – gepingt wird nur, wen die Antwort selbst erwähnt, plus der Autor
des Originals bei einer echten Antwort.

## 17. Ein Tag, eine Energie

Alle Arbeit – Kanäle, Musik, Firma, Jobs – bucht aus **einem** 24-Stunden-Tag
(`creator.useTime`, Reset Mitternacht) und macht **eine** Energie müde
(`creator_state.fatigue`, Modell in `src/energy.js`). Jobs: 4 Schichten à 2 h
plus eine Überstunde (×1,25 Lohn, doppelt müde). Selbstständige haben keinen
Deckel außer der Energie.

- **Verbrauch konvex:** Stunde n kostet 1,4 + 0,25 × n Punkte. 8 h → 79,8 %,
  10 h mit Überstunde → 64,7 %, 16 h → 43,6 %, Wand nach Stunde 21.
- **Erholung linear:** 4 Punkte je Echtzeit-Stunde ohne Aktion. Marathon bis
  Mitternacht → 8 Uhr ~38 %, abends voll (Beschluss: ein harter Tag danach).
- **Faktor** `1 − 0,8 × (1 − Energie)²` auf die *Wirkung* jeder Aktion (Publikum,
  Lohn, Umsatz, Qualität, Release-Reichweite) – nach der Buchung, die letzte
  Stunde ist die müdeste. 75 % → 0,95, 50 % → 0,80, 10 % → 0,35.
- **Wand:** unter 10 % Energie wird jede Aktion mit Zeitkosten abgelehnt
  (`reason: 'exhausted'`, `readyAt`); Aktionen ohne Zeitkosten gehen immer.
- Faktor ≤ 1: keine Decke aus §3/§15 kann überschritten werden.

Warum konvex: „8 h ≥ 75 %" und „Wand bei ~20 h" gehen linear nicht zusammen.
Warum kein Schlaf-Knopf, keine Energie-Items: das wäre ein Kaufweg an der
einzigen Bremse vorbei.
