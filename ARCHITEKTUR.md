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
Firmenkassen sind lokaler Zustand; der Handel (§15, 3b) bewegt Geld
Kasse → Kasse ohne `changeCash`.

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
Seit 1.37.0 kommt ein dritter, nachfragegetriebener dazu: Wareneinkäufe der
Spielerfirmen heben die Lieferanten-Aktie, gedeckelt auf `DEMAND_CAP`
(höchstens +42 %/Jahr, je Kern-Baufirma +7,3 %/Jahr) – siehe §15 „Börse
aktiv".

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
- **Zwei Ausnahmen.** (1) Anteilskauf (`company.buyShares`, §15 „Börse aktiv"):
  zwei Buchungen mit Rücknahme – ein Transfer zwischen Spielern, für den es
  keine einzelne Buchung gibt; erst Käufer −, dann Verkäufer +, scheitert die
  zweite, wird die erste zurückgenommen (Rücknahme wie bei `pay` nicht
  garantiert – dann fehlt Geld, nie entsteht welches; wird protokolliert).
  (2) Der Abschluss einer **Tour** (`angebote.abschliessen`, §15 „Gegenanfragen
  und große Formate"): **fünf** Buchungen, eine je Abend, weil fünf Konzerte
  fünf Konzerte sind. Hier entsteht nichts – jede Buchung ist die eines
  einzelnen Abends über `music.show` –, und der Grund steht in §15 an der
  Stelle, an der die Zahl steht: Eine einzige Buchung über die Summe hätte die
  Erfahrung halbiert (`xpForAmount` ist `floor(√Betrag)`, gemessen 1.352 XP
  gegen 611) und aus fünf Konzerten in jedem Zähler eines gemacht.

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
beim Schließen oder Verkauf zum Einstand (`stock_cost`) ausgezahlt. Jede
Gründung bringt ein volles Kern-Lager mit (**Erstausstattung**, Nachtrag der
Spec: `company.starterOf` = Kapazität × Einheitspreis – Kiosk 3.500, Café
23.940, Baufirma 95.200), in derselben Buchung wie der Gründungspreis; sie
liegt als `stock_cost` im Lager und kommt beim Schließen zum Einstand zurück,
nie mehr. Ohne sie war der Anlauf ein Tod auf Raten: leeres Lager, ad hoc
+25 %, bei Auslastung 0,3–0,4 tagelang rote Schichten, NPC-Kündigung nach drei
unbezahlten Tagen, Insolvenz an Tag 15 – für einen Inhaber, der gründet,
einstellt und wartet. Firmen aus der Zeit davor (`stock_seeded 0`) füllt die
erste Abrechnung nach dem Update einmal ohne Einstand auf (Chronik-Zeile;
`stock_cost` bleibt, was wirklich gekauft wurde – das Schließen zahlt
Geschenktes nicht aus). Der Hedge
ist die Börse selbst: Wer die Aktie des Lieferanten hält, gewinnt am Kurs, was
ihn die Ware mehr kostet. Die Decke (`ceilingOf(...).net`) zieht die Ware
zum Startkurs ab (`Units × wareUnit`, Units = Plätze × 3 + 4). Die
Geldwirkungen der Ereignisse (`kasse`, `refund` in `applyEffect`) sind
Vielfache dieses niedrigeren `net` – gewollt: Die Härte bleibt relativ zum
Gewinn (Kiosk `kuehlung` −1.175 statt −1.425). Grenzen um die Decke: bester
Fall Kurs 0,5 und volles Lager = Decke + ½ × Units × wareUnit, schlechtester
Fall Kurs 2,0 und alles ad hoc = Decke − 1,5 × Units × wareUnit; weil `settle`
den Preis einmal je Abrechnung liest, kann ein 30-Tage-Nachholen komplett zum
Verhältnis 0,5 laufen – mehr als die Klemmung gibt es aber auch dann nicht.
Der Ausbau
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
sind hier nicht gemessen; die Kern-Mediane **mit** Ereignissen sind mit
`docs/messungen/2026-09-21-firmen-handel.txt` aufgefrischt (die 20.09-Datei
zeigt noch den Stand vor der Erstausstattung – Commits 50a4650/0ca5a97 –, die
den Anlauf ändert, weniger ad hoc, das erste Lager ist schon da; bei fünf der
neun Branchen verschiebt das auch den stationären Median, s. u.); Decken,
„ohne"-Mediane und die Vollausbau-Zahlen unten sind davon unberührt): Der
simulierte Inhaber kauft täglich nach der
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
**Mit** Ereignissen im Kern (Stand 21.09., nach der Erstausstattung): Kiosk
2.003 (vor 1.35.0 2.536), Imbiss 2.660 (3.279), Autowäsche 2.300 (2.855), Café
15.956 (19.414), Fitnessstudio 10.382 (12.673), Werkstatt 14.797 (18.400),
Spedition 58.238 (71.160), Baufirma 52.915 (66.803), Club 51.585 (62.145) –
16–20 % weniger; voll
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

**Handel (seit 1.36.0, Stück 3b):** Die Spedition ist der Großhändler
(`handel: true` in `data/companies.js`, nur sie). Sie kann jede der neun
Waren an andere Spielerfirmen liefern: Sie kauft im Moment der Lieferung beim
NPC-Markt zum Großhandelspreis, 10 % unter dem Tagespreis (`HANDEL_RABATT`
0,1: `round(npcPrice × 0,9)`), und verkauft zu einem selbst gesetzten Anteil
des Tagespreises zwischen **90 und 100 %** (`setOffer`, je Branche oder
`alle`, `aus` schaltet ab; `company_offers`) – der Preis hängt damit am Kurs,
95 % bleiben 95 %, wenn BETO steigt. Kapazität **20 Einheiten je Platz und
Tag** (`HANDEL_KAPAZITAET`: Kern 10 × 20 = 200, Vollausbau 22 × 20 = 440;
`trade_day`/`trade_today` wie `pitch_day` – der Tag ist der Kalendertag, kein
rollierendes 24-Stunden-Fenster, daher lassen sich rund um Mitternacht
höchstens zwei Tageskapazitäten verkaufen), kein Zwischenlager, keine Zeit,
keine Verträge. Der Kauf (`buyFromTrader`, `units` oder „voll" = min aus
Wunsch, freien Lagerplätzen, Restkapazität) läuft **Kasse → Kasse, synchron,
ohne Buchung nach außen**: Käufer `kasse −= n × price`, Lager und Einstand
wie bei `buyStock`; Spediteur `kasse += n × (price − wholesale)`, nur die
Spanne – den Großhandelspreis hat er im selben Moment an den NPC
weitergereicht (`trade_units`, `trade_profit` zählen mit). Die Spanne ist
nie negativ (bei 90 % runden beide auf dieselbe Zahl; `tradeQuote` klemmt
zusätzlich) – ein Spediteur kann sich nicht in den Ruin liefern. **Handels-
Decken (§3):** Der einzige neue Geldeffekt ist, dass bis zu 10 % der
Warenkosten des Käufers nicht vernichtet werden, sondern beim Spediteur
landen. *Käufer:* Decke + `0,1 × Units × wareUnit` – Kiosk Kern +50, Baufirma
Kern 61.400 + 1.360 = 62.760, Baufirma voll +2.788 je Tag Verbrauch. *Spediteur:*
Kapazität × größte Spanne je Einheit = `Plätze × 20 × 48` (48 = 0,1 × 480,
die Club-Ware ist die teuerste; bei 95 % sind es für die Baufirma-Ware
17 = 323 − 306): Kern 10 × 20 × 48 = **9.600**, Vollausbau 22 × 20 × 48 =
**21.120** je Tag (Stufe 5 „Flotte 20" + Extra „Nachtschicht" = 22 Plätze;
die 3b-Spec schrieb 19.200 mit 20 Plätzen – Rechenfehler, siehe Nachtrag in
der 3a-Spec) – weniger als ein Sechstel der Spedition-Decke im Kern (65.080)
und ein Zwanzigstel voll (460.495). Gemessen (`handelslauf` im Messskript,
365 Tage, fester Würfel, `DATA_DIR=.testdata node
scripts/messung-geldquellen.js 10 365`, Auszug in
`docs/messungen/2026-09-21-firmen-handel.txt`): eine Spedition (Kern) mit
Angebot `alle 95` und eine Baufirma (Kern) in derselben Welt, die täglich
zuerst beim Spediteur kauft („voll", höchstens 200) und den Rest beim NPC;
beide mit demselben Tagesablauf und je demselben Würfel wie ihr
Einzellauf, also identische Ereignisse – die Differenz ist reiner Handel
(`firmenlauf` läuft seit 3b über dasselbe `betrieb`-Objekt; die Firmen-Blöcke
der Messung sind Zeile für Zeile unverändert). Bei Kurs = Start kostet die
Baufirma-Ware 340, das Angebot 323, Großhandel 306, Spanne 17 je Einheit; die
Baufirma verbraucht 40 je Tag. Ergebnis ohne Ereignisse: Spediteur
**65.609 statt 64.929 (+680)**, Käufer **61.945 statt 61.265 (+680)** – genau
40 × 17, an 333 von 365 Tagen geliefert (Σ 13.480 Einheiten, Σ 229.160 Spanne,
Ø 628/Tag; 92,6 % der Ware des Käufers kommt vom Spediteur, der Rest ist der
ad-hoc-Anlauf der Baufirma, siehe oben). Mit Ereignissen: Spediteur 58.770
statt 58.238 (+532 im Median: an 307 von 365 Tagen wird geliefert – an
geschlossenen Tagen des Käufers und an Tagen, an denen seine Kasse den
Einkauf nicht hergibt, gibt es keine Spanne, und das verschiebt den Median
um weniger als die 680 eines Handelstages), Käufer 53.595 statt 52.915
(+680), Spanne Ø 600/Tag (Σ 218.841), Ø 35 Einheiten/Tag (Σ 12.873, 90,7 %
der Käufer-Ware). Beste Tage ohne Ereignisse, Ware zum Verbrauch gerechnet:
Spediteur 65.609 ≤ 65.080 + 9.600, Käufer 61.945 ≤ 62.760; größte Tagesspanne
3.400 ≤ 9.600 – das sind 200 Einheiten (die ganze Tageskapazität; 200 Einheiten
decken fünf Verbrauchstage der Baufirma bei 40 Einheiten/Tag) an einem
Nachkauf nach einer Lücke, je Einheit weiter 17: Die Ersparnis hängt an der
gekauften Einheit, nicht am Tag – ein solcher Nachkauf übersteigt darum die
Käufer-Decke von 1.360 je Verbrauchstag, ohne dass der Prüfwert (Ware zum
Verbrauch gerechnet, statt zum Einkaufstag) darüberliegt. Handprüfung Tag 36
ohne Ereignisse (`--trace=handel:baufirma:ohne`
bzw. `handel:spedition:ohne`): Käufer morgens 103.600, Einkauf 40 × 323 =
12.920 statt 13.600, vor der Abrechnung 100.739 (ohne Handel 100.059), abends
165.503 statt 164.823; Spediteur morgens 72.920, Werbung 60.000, eigener
Einkauf 34 × 380, Spanne +680, vor der Abrechnung 11.754 statt 11.074, abends
78.324 statt 77.644. Die Messung hat eine Lücke: Beide Firmen würfeln mit
demselben Seed und sind deshalb an denselben Tagen geschlossen – der Fall
„Spediteur zu, Käufer weicht auf den NPC aus" (`reason 'trader'`) kommt im
Lauf nicht vor (0×), ist aber getestet (`test/companyTrade.test.js`). Die
Kern-Mediane mit Ereignissen sind oben im 3a-Absatz bereits auf diesen Lauf
aufgefrischt (fünf der neun Branchen verschoben, u. a. Baufirma 52.915 statt
55.830 in der Datei vom 20.09.); die Decken sind unverändert.

**Börse aktiv (seit 1.37.0, Stück 3c):** Zwei Verbindungen zwischen Firmen
und Börse, beide ohne neue Geldquelle. *(A) Nachfrage-Drift.* Jeder
Wareneinkauf einer Spielerfirma (`buyStock`, ad hoc in `consumeOne`,
Großhandel in `buyFromTrader` – je Einheit einmal, beim Lieferanten der
Käufer-Branche) zählt per `wallstreet.recordDemand` auf `demand_today` der
Lieferanten-Aktie; ein 7-Tage-EMA (`demand_ema`, rollt am Kalendertag,
übersprungene Tage mit 0) glättet. `simulate` addiert je Takt `extra =
DEMAND_CAP × min(1, emaNow / DEMAND_REF)` zur Drift (`step(…, extraDrift)`),
`DEMAND_CAP` 0,00002 = `DRIFT_CAP` / 2, `DEMAND_REF` 200 Einheiten/Tag, nur
für Aktien mit Lieferantenrolle, nie negativ – ohne Nachfrage bleibt alles
wie bisher. Die Aktien-Ansicht zeigt „🏭 Nachfrage: Ø 38 Einheiten/Tag
(7 Tage) · Drift +0,02 %/Tag". **Grenze (§3):** Der zusätzliche passive
Zufluss auf eine voll nachgefragte Aktie ist höchstens `e^(0,00002 × 48 ×
365)` = e^0,3504 = **1,4196, also +42 %/Jahr**. Ehrlicher Vergleich: Die
Decke ist die Hälfte von `DRIFT_CAP`, aber BETO schöpft `DRIFT_CAP` gar
nicht aus – seine eigene Drift ist `variance/2` = (0,005² + 0,004²)/2 ≈
0,0000205 je Takt (σ 0,005, Marktschock 0,004 bei vol 1), also ≈ +43 %/Jahr.
Volle Nachfrage legt 0,00002 obendrauf: Für BETO **verdoppelt** sich der
passive Zufluss damit in etwa (0,0000205 → 0,0000405 je Takt, ≈ +43 %/Jahr →
≈ +103 %/Jahr, e^0,71). Klein bleibt er nur gegen die Schwankung (BETO σ
0,005 je Takt → allein das eigene Rauschen 0,66 im Jahr).
Eine einzelne Kern-Baufirma (40 Einheiten/Tag) bringt `40/200 × 0,3504` =
e^0,0701 = **+7,3 %/Jahr**. Gemessen (`nachfragelauf` im Messskript,
`DATA_DIR=.testdata node scripts/messung-geldquellen.js 10 365`, Auszug in
`docs/messungen/2026-09-21-boerse-nachfrage.txt`): drei Börsenwelten je
Seed mit demselben Würfel, 365 Tage à 48 Takte, täglich `recordDemand` 0 /
40 / 200 Einheiten BETO vor dem `advance` des Tages. Weil `step`
multiplikativ ist, gilt bei gleichem Würfel `ln(p_n/p_0) = Σ extra` exakt
bis auf die Rundung auf ganze Kurse – und bis auf den Nachbeben-Zug:
`RECOVER_PULL × ln(recoverTo/price)` zieht innerhalb eines 96-Takte-Fensters
auch die dort angesammelte Extra-Drift zurück zum Erholungsziel (≈ −0,003 je
Ereignis, ≈ −0,015/Jahr bei 5 Ereignissen – unter der Rundungs-σ von 0,05). Σ extra ist deterministisch: 0,0689
(40) und 0,3446 (200) – sechs Tage Drift unter der geschlossenen Form, weil
die EMA anläuft (Tag 1: emaNow 200/7 = 28,6; Tag 7: 200 × (1 − (6/7)^7) =
132,0; Tag 15: 180,2 = 90 %; Σ (6/7)^d = 6 fehlende Tage) → Erwartung e^Σ
= **1,0714** bzw. **1,4115**. Seed 20260921: Endkurse **1.102 · 1.171 ·
1.477**, p40/p0 = **1,0626**, p200/p0 = **1,3403** (ln 0,2929, −0,0518
gegen Σ extra = 1,0 σ Rundung: jeder Takt rundet auf ganze Einheiten,
Varianz 1/(12 × Kurs²) je Takt und Welt, über 17.520 Takte bei Kurs Ø
1.207 … 1.359 ist σ ≈ 0,05). Über 10 Seeds: p40/p0 Median 1,0736 (1,0107 …
1,1871), p200/p0 Median 1,3824 (1,3253 … 1,5935); das Mittel der Abweichung
ln − Σ extra ist +0,0112 (40) und −0,0067 (200) bei erwarteter Rundungs-σ
des Mittels 0,0164 bzw. 0,0153 – 0,7 σ und 0,4 σ, die Identität hält. Ohne
Nachfrage ist der Lauf mit dem alten Code identisch (extra 0, derselbe
Würfel). **Pumpen – gedeckelt, nicht unmöglich:** Ein Inhaber, der die
Aktie seines Lieferanten hält, hebt sie mit der eigenen Nachfrage um
höchstens die +7,3 %/Jahr einer Kern-Baufirma (40 Einheiten/Tag; für den
vollen Deckel bräuchte es fünf Baufirmen) – und der Tagespreis seiner Ware
hängt am Kursverhältnis (3a): Am Jahresende zahlt er dieselben 7,3 % auf
jede Einheit, über das Jahr näherungsweise die Hälfte (linearer Anlauf) auf
40 × 340 × 365 = 4,96 Mio. Warenkosten (≈ 181.000); der Kursgewinn ist
7,3 % der Position. Ab einer BETO-Position von ≈ 2,5 Mio. ist Pumpen also
netto positiv – und dieselben 7,3 % bekommt jeder andere Halter, ohne eine
Firma zu führen. Das ist der **dritte Zufluss** der Börse (§3): begrenzt
auf +7,3 %/Jahr je Kern-Baufirma und `DEMAND_CAP` insgesamt, nicht an den
Halter gebunden, hier dokumentiert. *(C) Firmenanteile.* Je Firma `SHARES_TOTAL` 1.000 Anteile, der
Inhaber hält, was niemand sonst hält (keine eigene Zeile), mindestens
`OWNER_MIN` 510; Angebote ab Stufe `IPO_MIN_STUFE` 2 (`listShares`,
`company_share_offers`), Kauf an der Börse unter „Firmenanteile"
(`buyShares`): **Käufer −(n × Preis + Gebühr), Verkäufer +n × Preis** –
Gebühr `SHARE_FEE` 1 %, gerundet, die einzige Senke; ein Transfer zwischen
Spielern, deshalb eine der zwei Ausnahmen von §9 (die andere ist der
Tour-Abschluss, siehe „Gegenanfragen und große Formate" weiter unten) – zwei
Buchungen: erst `pay` beim Käufer mit Bank, dann Gutschrift beim Verkäufer,
scheitert die, geht
die erste zurück – zwischen den Buchungen fehlt Geld, es entsteht keins; das
Angebot wird vor der ersten Buchung synchron um die gekauften Anteile
verkleinert (§7, erst nehmen, dann buchen) und bei einem Fehler wieder
vergrößert – ein zweiter Klick sieht den Rest). **Kein Kurs:** Anteile
werden nicht simuliert, nicht an den Markt verkauft, ihr Wert ist die
Ausschüttung. Ausgeschüttet wird nur, was ohnehin die Kasse verlässt:
`withdraw` teilt den Betrag `floor(value × shares / 1000)` je Halter auf
`pending`, der Inhaber bekommt den Rest in der einen Buchung wie bisher;
`close`/`sell` teilen die ganze Auszahlung (Kasse + Lager, beim Verkauf +
Ausbau) ebenso. `claimDividends` holt alle `pending` eines Spielers in
**einer** Buchung. Halter-Zeilen überleben das Schließen (`pending` bleibt
abholbar), Angebote nicht. **§3:** Nichts entsteht – Käufe sind Transfers
minus Gebühr, Ausschüttungen kommen aus der Kasse (Einzahlung, Umsatz) statt
an den Inhaber an die Halter; ein Inhaber kann nicht mehr ausschütten, als
er entnimmt. Die Kette im Test (`test/companyShares.test.js`, „§3: Summe
aller Buchungen": Gründung, zwei Verkäufe des Inhabers, Einzahlung, Entnahme
10.000, Weiterverkauf, Schließen, Abholen) endet bei Konten-Summe
**29.859.159 = 30.000.000 Start − 120.000 Gründungspreis − 3.750 Gebühren
(2.000 + 1.000 + 750) − 17.091 noch nicht abgeholt** – Konto für Konto von
Hand nachgerechnet (O 20.142.818, A 4.875.000, B 4.841.341).

**Mehrere Firmen und Firmenwert (seit 1.38.0, Stück 4):** Zwei Änderungen, die
zusammengehören – ein Spieler darf mehrere Firmen führen, und was sie wert
sind, zählt zum Vermögen. *(A) Limit am Konto-Level.* Der alte Unique-Index
„eine offene Firma je Spieler" ist weg; `company.maxCompanies(level) =
clamp(1, 5, 1 + floor(level / 10))` (`COMPANIES_PER_LEVEL` 10,
`COMPANIES_MAX` 5):

| Level | 0–9 | 10–19 | 20–29 | 30–39 | ab 40 |
|---|---|---|---|---|---|
| offene Firmen | 1 | 2 | 3 | 4 | 5 |

`found` lehnt darüber mit `reason: 'limit'` ab (`{ have, max, level, nextAt }`);
jede Inhaber-Aktion nimmt eine optionale `companyId`, ohne sie gilt die aktive
Firma (`company_active`, Rückfall auf die älteste offene). Der Menüeintrag
„Firma" führt ab zwei Firmen auf eine Übersicht, die Betriebsansicht zeigt
„Firma 2 von 3". Eine Anstellung bleibt es trotzdem nur eine, und die Sperre
„ein offener Vorfall je Spieler" gilt über alle Firmen zusammen – mehrere
Firmen sind mehr Kapital, nicht mehr Zeit. *(B) Der Wert.* `company.valueOf`
= **Substanz** (gekaufte Stufen und Extras + Kasse + Lager zum Einstand; der
Gründungspreis zählt nicht, wie beim Schließen) + **Ertragswert**
(`max(0, round(profit_ema × ERTRAG_FAKTOR))`, `ERTRAG_FAKTOR` 30). `profit_ema`
ist ein 7-Tage-EMA des Tagesgewinns **aus dem Betrieb**, den `settle` je
abgerechnetem Tag fortschreibt: NPC-Umsatz − Löhne − verbrauchte Ware zum
Einstand ± Kassenwirkung der Ereignisse, dazu über `profit_pending` die
Werbung, die Prämie und die Kassenwirkung eines Vorfalls (Task 3: sonst wäre
der Ertragswert über die eigene Kasse käuflich – bezahlen kostet Substanz
1 : 1, der gekaufte Mehrumsatz zählte dreißigfach). Einzahlung, Entnahme,
Wareneinkauf, Anteilskäufe und Ausschüttungen zählen nicht in die EMA:
Einzahlen hebt nur die Substanz, um genau den Betrag, der vom Konto abging
(§3, Test „Einzahlung ist vermögensneutral"). *Verteilung:* Der Inhaber trägt
`valueOf × sharesOf().owner / 1000`, jeder Halter `valueOf × shares / 1000`
plus sein noch nicht abgeholtes `pending` (3c). `networth.PARTS` hat dafür den
Posten 🏢 Firmen (`company.worthOf`, synchron, ohne Abrechnung – Hinsehen darf
nichts ändern), `db.assetOwners` findet auch reine Firmenbesitzer, und die
Ranglisten-Fußzeile nennt „🏢 Firmen: X % des Vermögens der Top 10" über die
angezeigten Zeilen.

**Gemessen** (365 Tage, fester Würfel, `firmenlauf` im Messskript, Auszug in
`docs/messungen/2026-09-24-firmenwert.txt`; Zeile „Firmenwert am Ende" je
Branche, Werte mit Ereignissen): Ein **Kern-Kiosk** ist am Jahresende
**16.368** wert (Substanz 4.750 = Kasse 1.750 + Lager 3.000, Ertragswert
11.618 aus `profit_ema` 387), eine **Kern-Spedition 1.246.950** (Substanz
150.440, Ertragswert 1.096.510), eine **Kern-Baufirma 661.574**. Voll
ausgebaut: **Spedition 61.448.038** (Substanz 50.046.200, davon 49,8 Mio
Ausbau, Ertragswert 11.401.838), **Baufirma 88.498.718** (Substanz
74.985.160, Ertragswert 13.513.558), Café 8.192.261, Kiosk 1.361.745. Die
Spanne zwischen der kleinsten und der größten Firma ist damit **1 : 5.400** –
und bei den ausgebauten Firmen ist der größere Teil **Substanz** (Café 62 %,
Spedition 81 %, Baufirma 85 %), also bezahltes Kapital, das **im Betrieb
steckt** – beim freiwilligen Schließen kommen nur Kasse und Lager zurück, der
Ausbau nur beim Übernahme-Verkauf (`sell`); der Ertragswert ist der kleinere
Teil. Die Rangliste bewegt sich dadurch für Kern-Firmen kaum, für Endgame-Firmen dagegen stark:
Eine voll ausgebaute Baufirma trägt mit 88,5 Mio so viel zum Vermögen bei wie
**239 Tage Musik+Creator** (369.752/Tag im selben Lauf) – sie hat aber auch
74,7 Mio Ausbau gekostet, und genau die stehen als Substanz darin.
**Handprüfung** (Kiosk Kern ohne Ereignisse): eingeschwungener Tag
2 × 3 Schichten × 250 × 1,5 = 2.250 Umsatz − 900 Löhne − 6 × 50 Ware = 1.050;
Werbung 1.250 alle 3 Tage fällt über `profit_pending` in denselben Tag
(−200 statt +1.050); am Laufende (letzte Kampagne einen Tag her) wiegen die
Werbetage `(1/7)(6/7) / (1 − (6/7)³)` = 0,3308 → 1.050 − 1.250 × 0,3308 =
**636,5**, gemessen `profit_ema` **636,61**, Ertragswert 30 × 636,61 =
**19.098** – die EMA aus den Tagesbuchungen von Hand nachgerechnet ergibt
denselben Wert. Der Ertragswert ist damit **nicht** 30 × Median/Tag (das wären
69.930): Der Median ist der Kassen-Tagesgewinn *mit* den vier Anpacken-
Schichten des Inhabers (+1.300/Tag) und *ohne* die Werbung (ein Quantil trifft
einen Tag ohne Kampagne), die EMA ist genau umgekehrt geschnitten – Probe:
2.350 (Kassentag) − 1.300 − 413,5 = 636,5. **Ehrliche Grenzen:** (1) Die
Abrechnung ist faul (§4) – eine liegengelassene Firma behält ihren letzten
Wert, bis jemand hinsieht; die Rangliste zeigt also den Stand der letzten
Abrechnung, nicht den von heute. (2) Wer länger als `MAX_SETTLE_DAYS` (30
Tage) weg war, verliert die älteren Tage; die EMA steht so lange still und
springt danach mit den nachgeholten Tagen. (3) **Spieler-Schichten zählen
nicht in die EMA** – eine Firma, die vor allem vom Anpacken des Inhabers und
von Spieler-Angestellten lebt, ist im Ertragswert systematisch zu niedrig
bewertet (beim Kiosk um 1.300 von 2.350 am Tag, also mehr als die Hälfte).
Das ist gewollt: Bewertet wird, was die Firma ohne ihren Inhaber abwirft.
(4) **Die Substanz ist kein Liquidationserlös.** `close` zahlt nur
`max(0, Kasse + Lager zum Einstand)` aus; der Ausbau (`invested`) kommt allein
beim Übernahme-Verkauf (`sell`) zurück. Gemessen an einem Café auf Stufe 5 mit
`invested` **4.020.000**: Auszahlung beim freiwilligen Schließen **23.940**.
Der Wert in der Rangliste ist der eines laufenden Betriebs, nicht der, den ein
Aufgeben einbringt. (5) **Der ×30-Hebel wirkt auch auf befristete Ereignisse.**
Ein Großauftrag (`umsatz ×1,15` über 5 Tage) hebt den angezeigten Wert eines
Kern-Cafés um rund **44.000**, während er tatsächlich nur rund **13.600** Kasse
einbringt; die Überzeichnung klingt mit 6/7 je Abrechnungstag wieder ab und
zahlt nie etwas aus. (6) **Die Großhandels-Spanne (3b) hebt die Summe aller
Vermögen** um genau diese Spanne: Der Käufer bucht die Ware zum eigenen
Einstand ins Lager, der Verkäufer hat den Aufschlag schon in der Kasse. Gedeckelt
ist das durch die Handels-Decke – gemessen **680 je Tag und Firmenpaar**.

**Kein Rückweg.** Der alte Unique-Index `idx_companies_owner_open` („höchstens
eine offene Firma je Spieler") fällt beim Start (`DROP INDEX IF EXISTS` in
`src/db.js`). Sobald ein Spieler zwei offene Firmen hat, kann diese Datenbank
nicht mehr auf einen älteren Stand zurück: Das
`CREATE UNIQUE INDEX IF NOT EXISTS idx_companies_owner_open` der alten Version
läuft beim Start gegen die vorhandenen Duplikate, und der Serverstart bricht an
der Index-Erstellung ab. Ein Rollback muss vorher die überzähligen Firmen der
betroffenen Spieler schließen oder löschen.

**Kontakte (seit 1.39.0, Stück 5a):** Wer Musik macht oder streamt, kann andere
Künstler anschreiben (`src/contacts.js`, Katalog `src/data/contacts.js`): Eine
Anfrage kostet zwei Stunden aus dem 24-h-Tag – auch dann, wenn nie eine Antwort
kommt –, danach ist derselbe Kontakt drei Tage dicht (nach „ignoriert" sieben).
Zwei Würfe entscheiden: ob er überhaupt antwortet (Wurzelkurve auf dem
Reichweitenverhältnis, dazu Sprache, Land, Genre, Hype, Charakter, Draht und
Türöffner) und wie verbindlich (flüchtig · echt · Zusage). Eine Antwort setzt
einen Schub auf **genau eine** nächste Aktion: Veröffentlichung oder
Kanalaktion mit `1 + 3 × Stärke` (Feature `1 + 5 × Stärke`, gedeckelt auf 4
bzw. 6), ein zugesagtes Konzert bringt Hörer für **eine** Gage mit.

**Die Grenze ist scharf und gewollt:** kein neuer Zufluss (§3). Der Schub ist
ein Faktor auf eine bestehende Aktion, wird beim Verbrauch gelesen, angewandt
und gelöscht (wie der Twitter-Promo-Schub), stapelt nie (der stärkere bleibt
liegen, Maximum statt Produkt) und hebt **keine** Decke: Sprache, Szene,
Plattform und Markt gelten unverändert, und die mitgebrachten Konzert-Hörer
sind auf die eigene Hörerschaft gedeckelt – mehr als doppeltes Publikum gibt
es nicht, und weil die Gage mit `Hörer^0,7` wächst (`SHOW_EXP` in
`src/music.js`), sind das höchstens **+62 %** auf eine einzige Gage.

**Gemessen** (10 Läufe à 365 Tage, fester Würfel `rng(1000+i)`, in allen
Varianten dieselbe Strategie, die Kontaktwürfe auf einem zweiten Strom
`rng(501000+i)`; `node scripts/messung-geldquellen.js 10 365 --nur=kontakte`,
vollständige Ausgabe in `docs/messungen/2026-09-25-kontakte.txt`): Tägliche
Kontaktpflege – 2 h in Kontakte statt in eine Aktion – bringt **nicht** mehr
Geld, sondern weniger. Musik+Creator 341.705/Tag statt 372.788 (**−8,3 %**, je
Seed gepaart −8,0 %, 7 von 10 Seeds negativ), nur Creator 318.203 statt 334.254
(−4,8 %, gepaart −1,8 %, 6 von 10 Seeds negativ – bei einer Seed-Spanne von
−25,0 % … +26,9 % ist das dort **nicht von null zu unterscheiden**; als „kostet
Geld" darf nur die erste Zeile gelesen werden). Die Spec hatte einen Zuwachs im
niedrigen zweistelligen Prozentbereich erwartet und ein Senken der Basis `0,6`
oder der Schubfaktoren für den Fall einer **Verdopplung** vorgesehen; die
Schwelle „über +50 %" steht nicht in der Spec, sondern im Plan
(`docs/superpowers/plans/2026-09-25-kontakte.md`, Task 4). Kein Auslöser ist
erreicht, die Messung zeigt nur in die andere Richtung; gesenkt wurde nichts. Der Grund
steht in denselben Zählern: 61,3 % der Anfragen bleiben unbeantwortet, die
**Zusagenquote** liegt bei 7,9 % (nur Creator 9,6 %), und ein Schub trifft nur
jede sechste Veröffentlichung – dort im Mittel Faktor **1,30** (größter 2,80),
über **alle** Veröffentlichungen gemittelt 1,05 und über alle Kanalaktionen
1,00. Dagegen stehen gezählte 15,0 % weniger Kanalaktionen am Tag (12,56 →
10,68; reiner Creator 16,16 → 15,02, −7,0 %), denn der Tag endet ohnehin an der
Energie-Wand (Ø Energie am Tagesende 12 % ohne und 14 % mit Kontakten, beim
reinen Creator 8 % und 4 %) und die zwei Kontaktstunden schieben jede spätere
Stunde die Kostenkurve hinauf (§17). Die Musikseite bleibt dabei fast unberührt
(0,95 Veröffentlichungen am Tag in beiden Läufen, 587.277 gegen 582.021 Hörer) –
die Differenz sitzt in den Followern (2,59 Mio gegen 1,95 Mio), weil jeder
fehlende Kanaltag auch dem Wachstum des nächsten fehlt.

Der simulierte Spieler wählt nach **Chance × erwartetem Nutzen**, und
„erwartet" ist hier das ganze Wort: gemittelt über die drei Antwortstufen mit
den Wahrscheinlichkeiten aus `stufeVon`. Eine erste Fassung dieser Messung hat
jeden Kandidaten mit der Stärke einer *Zusage* bewertet und damit den fernen
Weltstar um das 1,43-fache überbewertet (erwarteter Stufenfaktor 0,350 gegen
0,500 auf Augenhöhe); sie kam auf −17,3 % bzw. −16,2 %. Die halbe gemessene
Differenz war also eine Eigenschaft der Bewertungsregel, nicht des Spiels. Die
Gegenprobe zur neuen Regel steht in der Messdatei: Die Erwartung wird gegen
200.000 Würfe der echten `stufeVon` gehalten, je Fall.

**Die Passung ist der Hebel, nicht der Fleiß.** Sprache und Genre (bei
Creator-Anfragen die Plattform) multiplizieren Chance *und* Wirkung. Isoliert
gerechnet – derselbe Kontakt mit 3,2 Mio Hörern im selben Land, nur Sprache und
Genre getauscht, Spieler ein deutscher Rapper mit 500.000 Hörern: gleiche
Sprache und verwandtes Genre (Passung 0,700) geben **63,7 %** Antwortchance und
Schub **1,608**, fremde Sprache und fremdes Genre (Passung 0,045) nur **33,7 %**
und **1,039** – der Schub über 1 fällt von 0,608 auf 0,039, also auf genau das
Verhältnis der Passungen (1/15,6). Im Katalog kommen Größe, Land und Charakter
dazu, und dann ist der Abstand die Summe von vier Dingen, nicht der Passung
allein: Derselbe Rapper kommt bei Nina Chuba (Deutschland, Pop, 3,2 Mio,
kollegial) auf **63,7 %** und Schub 1,608, bei YOASOBI (Japan, J-Pop, 15 Mio,
geschäftlich) auf **2,0 %** (die Untergrenze `CHANCE_MIN`) und Schub 1,067. Die
vier Summanden dahinter: Größe (Basis 0,237 gegen 0,110), Land (+0,05 gegen ±0,
der Spieler wohnt in Deutschland), Sprache und Genre (+0,10/±0 gegen
−0,15/−0,05) und Charakter (+0,10 gegen −0,05). Das ist Beschluss 5 der Spec,
gemessen statt behauptet – jede dieser Zahlen gibt das Messskript selbst aus.

**Die eine bewusste Abweichung:** Auf der Creator-Seite ersetzt
`contacts.request` den wirkungslosen Faktor 1, den `boostOf` für die Bühne
liefert, durch `min(4, 1 + 3 × Stärke)` über 7 Tage – sonst wäre ein
gemeinsames Event dort ein Schub ohne Wirkung. Gemessen ist er der **kleinste
der drei Schübe auf seiner Seite**: Ø Faktor **1,05** (größter 1,28) über 511
verbrauchte Schübe gegen Ø 1,15 bei `creator/reaktion` und Ø 1,10 bei
`creator/feature` aus demselben Lauf; beim reinen Creator Ø 1,04 über 652 gegen
1,15 und 1,10. **Nicht, weil die Formel schwächer wäre** – sie ist Zeichen für
Zeichen dieselbe wie die von `reaktion`, und dieselbe Formel kann nicht
strukturell schwächer sein. Der Grund ist die Schwelle `minDraht ≥ 20`: Sie
lässt nur lange gepflegte, also kleine Kontakte durch, und bei kleinen
Kontakten ist `staerkeOf` klein. Die Bühne bekommt kein schwächeres Werkzeug,
sondern ein kleineres Publikum. Ein Spieler, der nach Chance × Nutzen wählt,
nimmt sie ohnehin nie – das Feature auf derselben Seite hat den größeren Faktor
*und* die bessere Chance (Schwierigkeit −0,10 gegen −0,20) und verlangt keinen
Draht. Die Zahlen oben stammen deshalb aus einem dritten Lauf, der sie erzwingt
(„Konzert-Vorrang" im Messskript) – ohne ihn steht in der Spalte eine Null, und
eine Null ohne Erklärung ist kein Messwert.

**Beim reinen Musiker kehrt sich das Vorzeichen um.** Wer keine Kanäle
betreibt, hat keine Füllaktionen, die die zwei Stunden verdrängen könnten: Sein
Tag endet gar nicht an der Energie-Wand (Ø Energie am Tagesende **100 %** ohne
und 98 % mit Kontakten), und 0,95 Veröffentlichungen sowie 0,22 Konzerte am Tag
stehen in beiden Varianten. Gemessen im selben Aufbau (dritter Archetyp „nur
Musik" in `--nur=kontakte`, 10 Läufe à 365 Tage, dieselben Würfel; Nachtrag in
`docs/messungen/2026-09-25-kontakte.txt`): **+12,9 %** im Median, gepaart je
Seed +11,0 %, 7 von 10 Seeds positiv – bei einer Seed-Spanne von −16,4 % …
+55,0 %, die Richtung ist also gestützt, die Größe nicht. Der Schub bei einer
Veröffentlichung liegt dort bei Ø **1,34** (größter 2,80) über 484 von 3.461,
und er zahlt fast nur über den Buzz: Die Hörerzahl am Jahresende unterscheidet
sich um +2,1 %, das Geld um +12,9 % – `publish` multipliziert den
`audienceFactor`, und `settle` zahlt die laufenden Abrufe **plus** den
abklingenden Schub der letzten Veröffentlichung. §3 bleibt unberührt: keine
neue Quelle, keine bewegte Decke.

**Ehrliche Grenzen:** (1) Gemessen ist die Spielweise „**jeden Tag** zwei
Stunden, bester Kontakt nach Chance × erwartetem Nutzen" – nicht „nur bei guter
Gelegenheit". Wer die zwei Stunden nur an Tagen ausgibt, an denen Passung und
Chance zusammenkommen, zahlt den Preis seltener; diese Zwischenstufe ist nicht
gemessen und steht deshalb auch nirgends als Zahl. (2) Die Streuung ist größer
als bei den Firmen: je Seed −24,2 % … +12,7 % (Musik+Creator) und −25,0 % …
+26,9 % (nur Creator). Die Richtung stimmt in 7 von 10 bzw. 6 von 10 Seeds –
beim reinen Creator ist der Befund damit innerhalb des Rauschens. (3) Die Wahl
des simulierten Spielers rechnet den Nutzen EINER Anfrage, nicht den Wert des
Drahts, den sie aufbaut. (4) Die Messung ist eine reine Geldfrage. Was die
Kontakte an Spielgefühl, an Freischaltungen (Partner ab drei Zusagen) und als
Vorbau für 5b/5c bringen, misst sie nicht – und das war auch nie ihr Argument.
(5) Für die beiden Archetypen, deren Tag an der Energie-Wand endet, sind die
Kontakte damit **keine** Geldquelle in der Rangfolge oben, sondern eine
Ausgabe: Sie kosten Zeit und geben Streuung zurück. Beim reinen Musiker gilt
dieser Satz nicht (Absatz davor, +12,9 %) – dort kosten die zwei Stunden
nichts, weil nichts da ist, was sie verdrängen könnten. Eine Quelle wird der
Schub auch dort nicht: Er bleibt ein Faktor auf eine bestehende Aktion. Wer die
Kontakte zur Quelle machen wollte, müsste an den Decken drehen, nicht an den
Faktoren – und genau das verbietet §3.

**Beef und Disstracks (seit 1.40.0, Stück 5b):** Derselbe Draht wie in 5a,
andersherum benutzt (`src/beef.js`, Zahlen in `src/data/beef.js`): Anstacheln
kostet dieselben zwei Stunden wie eine Anfrage, und ob er einsteigt, ist die
Umkehrung der Antwortchance – beim Gefallen hilft es, klein zu sein, beim
Streit nicht. Läuft ein Beef, gibt es den **Disstrack** als fünfte
Veröffentlichungsart, dessen Publikumsfaktor an der Größe des Gegners
(`wucht`), am Genre und an der **Hitze** hängt, der Uhr des Beefs: Sie steigt
mit jedem Schlag und kühlt um 6 Punkte am Tag ab, bei 0 wird abgerechnet. Dazu
kommen sein Gegenschlag (ein bis drei Tage später, einmal je Schlag, nur ab
Hitze 40), die Häme, wenn du nach unten trittst, die dichte Szene, solange es
brennt, das Angezähltwerden nach einer Chart-Platzierung – und der Ausgang, der
**einen Tag** lang auf den Hype wirkt (`BONUS_TAGE` 1 seit dem Balancing vom
2026-09-26; vorher sieben, siehe unten „Der Deckel von +25 %").

**Die Grenze ist scharf und gewollt:** kein neuer Zufluss (§3). Die
Aufmerksamkeit ist ein Faktor auf das Publikum **einer** Veröffentlichung, der
Sieg zahlt ausschließlich über Hype, Hype ist bei `HYPE_MAX` **1,7** hart
gedeckelt – und in `src/beef.js` und `src/data/beef.js` steht kein einziger
`unb`-Aufruf. Der Disstrack bewegt also weder eine Decke noch legt er einen
Hahn: Er ist eine Veröffentlichungsart wie die anderen vier, mit anderen Zahlen.

**`spike` und `growth` zusammen, nicht `growth` allein.** In früheren Fassungen
stand hier, sein `growth` von 0,4 – der niedrigste im Spiel – sei die Bremse,
denn „die Hörer, die bleiben, hängen am Growth". Das ist falsch, und
`src/music.js` sagt warum: Die gewonnenen Hörer sind `audience × CONVERSION ×
TEMPO × boost × type.growth × …`, und `audience` enthält seinerseits
`type.spike`. Beide Zahlen zählen also zusammen, und der Buzz zählt `spike`
sogar zweimal (`buzz = audience × 9 × spike`, vereinfacht – der Code
multipliziert zusätzlich mit `p.plays`, der Persona-Zahl, `src/music.js:467`).
Je **aufgenommenem Titel** –
Titel sind der Preis, den `songs` verlangt – steht damit (nachgerechnet aus
`RELEASES` in `src/data/music.js`):

| Art | `songs` | `spike` | `growth` | Hörer je Titel (`spike × growth / songs`) | Buzz je Titel (`spike² / songs`) |
| --- | --- | --- | --- | --- | --- |
| Single | 1 | 1,0 | 1,0 | 1,00 | 1,00 |
| EP | 3 | 2,6 | 1,5 | 1,30 | 2,25 |
| Album | 6 | 5,5 | 2,4 | **2,20** | 5,04 |
| Deluxe / Remix | 2 | 1,6 | 0,7 | 0,56 | 1,28 |
| Disstrack | 1 | 2,1 | 0,4 | 0,84 | 4,41 |

**Bis zum 2026-09-26 stand hier `spike` 3,0, und damit 1,20 Hörer je Titel –
mehr als die Single.** Der Disstrack war also die bleibendere Veröffentlichung,
obwohl sein Blurb „viel Lärm, wenig Bleibendes" verspricht, und genau daran hing
der Geldrucker, den die Messung gefunden hat. Mit `spike` 2,1 ist das Produkt
0,84 und liegt unter der Single, während der Buzz je Titel mit 4,41 der
**zweithöchste im Spiel** bleibt (nur das Album liegt mit 5,04 darüber). Der
Disstrack ist damit die zweitlauteste und die am wenigsten bleibende Art – das,
was sein Blurb sagt. `test/music.test.js` hält die Richtung fest („mehr spike,
weniger growth als die Single") und ist unverändert: 2,1 > 1,0 und 0,4 < 1,0.

**Die zweite Bremse ist der geteilte Veröffentlichungsplatz.** Ein Disstrack ist
eine Veröffentlichung: Er kostet einen Titel aus demselben Vorrat und verbraucht
denselben Platz, den die `cooldown`-Sperre auf gut einen am Tag begrenzt. Ein
Disstrack-Tag ist damit ein Tag ohne EP und ohne Album – und beim Album stehen je
Titel 2,20 Hörer gegen 0,84. Hörer sind die Größe, die sich verzinst (`audience`
hängt über `reachOf` an der Hörerzahl, der Buzz hängt an `audience`); ein
einmalig hoher Buzz hängt an nichts. Genau das misst die Kontrollvariante weiter
unten in diesem Abschnitt („Die Veröffentlichungsart ist der große Hebel"): Die
Beef-Spielweise liegt **89,2 %** bzw. **98,3 %** unter demselben Spieler, der
ohne jeden Beef auf sechs Titel und ein Album wartet.

**Gemessen** (`node scripts/messung-geldquellen.js 60 365 --nur=beef`, vollständige
Ausgabe in `docs/messungen/2026-09-26-beef.txt`, Abschnitt „Nachtrag 5e"; fester
Würfel `rng(1000+i)`, Beefwürfe `rng(701000+i)`, in allen sechs Varianten dieselbe
je Archetyp einmal gesuchte Strategie, eigene Welt und eigenes Konto je Variante).
Sechs Varianten, zwei Archetypen; gezeigt ist der Median je Tag und die Differenz
gegen „ohne Beef" als *Mediane / je Seed gepaart*:

| Variante | Musik+Creator | nur Musik |
| --- | --- | --- |
| ohne Beef (wie vor 1.40.0) | 358.064/Tag | 104.032/Tag |
| passiv (angezählt, nie geantwortet) | 321.828 (−10,1 % / **−10,2 %**) | 83.053 (−20,2 % / **−19,9 %**) |
| aktiv (jeden Tag Disstrack) | 297.043 (−17,0 % / −17,7 %) | 50.344 (−51,6 % / −51,8 %) |
| `diss-isoliert` (nur „Disstrack statt Single") | 310.926 (−13,2 % / −12,4 %) | 53.854 (−48,2 % / −46,9 %) |
| `sieg-farm` (ein Disstrack je Front, dann auskühlen) | 346.329 (−3,3 % / −1,2 %) | 120.874 (**+16,2 % / +15,0 %**) |
| Kontrolle: ohne Beef, Album statt Single | 2.741.519 (+665,7 %) | 2.981.641 (+2766,1 %) |

**Der Deckel von +25 % hält, und er hat zwei Konstanten gekostet.** Der Plan zu 5b
sieht vor: Liegt eine Spielweise über **+25 %** gegen „wie bisher", wird nachjustiert
und neu gemessen (`docs/superpowers/plans/2026-09-25-beef.md`, Task 5). Nach der
Erweiterung des Kontaktkatalogs auf 90 Einträge war er gerissen – für den reinen
Musiker stand `sieg-farm` bei **+165,9 %** (gepaart) und `diss-isoliert` bei
+38,3 %, für Musik+Creator `sieg-farm` bei +46,6 %. Geändert wurden daraufhin
**zwei** Zahlen, sonst nichts:

* `spike` des Disstracks **3,0 → 2,1** (`src/data/music.js`) – das ist der Hebel
  von `diss-isoliert`, weil dort 98,7 % aller Veröffentlichungen Disstracks sind.
* `BONUS_TAGE` **7 → 1** (`src/data/beef.js`) – das ist der Hebel von `sieg-farm`,
  weil die ihren Zuwachs über das Hype-Fenster holt und der Disstrack bei ihr nur
  14,2 % der Veröffentlichungen belegt (Endstand, nur Musik; 15,1 % war der
  ältere 5d-Wert vor Nachtrag 5e).

Eine dritte Zahl kam im Nachtrag danach hinzu, und zwar aus dem umgekehrten Grund –
nicht weil eine Spielweise zu viel einbrachte, sondern weil das Aussitzen zu wenig
kostete (siehe „Der Preis des kurzen Fensters" unten):

* `ANZAEHL_CHANCE` **0,06 → 0,35** (`src/data/beef.js`) – das ist der einzige Hebel,
  der den passiven Spieler überhaupt erreicht. Er senkt außerdem die `sieg-farm`
  weiter, weil sie die Fronten, die das Angezähltwerden aufmacht, als Niederlagen
  abrechnet.

**`BONUS_SIEG` 1,25 und `BONUS_NIEDERLAGE` 0,85 sind unverändert.** Der Sieg und die
Niederlage behalten ihre volle Wucht; nur das Fenster ist kürzer. Der Spiegel des
Zahlensatzes (im Logarithmus wiegt die Niederlage 0,73 des Siegs) ist also auch nach
5e unangetastet – und das ist gemessen und keine Vorliebe: `BONUS_NIEDERLAGE` zu
senken war der erlaubte zweite Hebel von 5e, ist gemessen worden und sättigt
(0,85 → 0,60 bringt dem passiven Musiker 6,0 Prozentpunkte, 0,60 → 0,40 nur noch
1,3), weil der Faktor nur einen Tag greift und der Hype sich danach wieder hochträgt.
`DISS_AUFMERK` steht weiter auf 1,5 – die Messung von 5c hatte gezeigt, dass es nicht
das Stellrad ist (gepaart +45,5 % → +26,3 % bei `--diss-aufmerk=0`, also weiter über
der Schwelle), und diese Messung bestätigt es.

**Warum `BONUS_TAGE` 7 der Fehler war, und zwar rechnerisch.** Der Hype trägt sich
selbst weiter, und der Ausgangsfaktor greift auf JEDE Veröffentlichung und JEDES
Konzert im Fenster (`src/music.js`):

* Veröffentlichen: `hype ← clamp(0,6…1,7 , clamp(0,6…1,7 , 0,7 × hype + 0,3 × Wurf) × B)`,
  Fixpunkt `h* = 0,3 × Wurf × B / (1 − 0,7 × B)`. Bei `B` = 1,25 ist das
  3,0 × Wurf, bei einem mittleren Wurf von 1,05 also 3,15 – weit über `HYPE_MAX` 1,7.
* Konzert: `hype ← clamp(0,6…1,7 , (0,8 × hype + 0,3 × Güte) × B)`, Fixpunkt
  `h* = 0,3 × Güte × B / (1 − 0,8 × B)`. Bei `B` = 1,25 ist der Nenner **genau 0** –
  es gibt keinen Fixpunkt mehr, die Folge läuft monoton in den Deckel. 1,25 ist der
  Kehrwert von 0,8.

Wer regelmäßig gewann, klebte damit dauerhaft an der Decke statt einen Ausschlag zu
bekommen. Gemessen (Kontrolllauf, der sich von der Endeinstellung in NICHTS außer
`BONUS_TAGE` unterscheidet, Archetyp „nur Musik"): bei sieben Tagen **14.335 von
21.900 Tagen** im Siegfenster, Ø Hype dort **1,519**, über alle Tage **1,46**, am
Jahresende **1,59**; bei einem Tag **2.824 von 21.900 Tagen**, Ø Hype im Fenster
**1,173**, über alle Tage **1,19**, am Jahresende **1,23**. Und die Spielweise
selbst: **+95,2 %** gegen +19,7 % (gepaart). Dieser Kontrolllauf ist der von 5d und
damit bei `ANZAEHL_CHANCE` 0,06 gemessen; 5e hat ihn nicht wiederholt, weil er die
Wirkung von `BONUS_TAGE` zeigt und nicht die des Angezähltwerdens.

**Der Sieg ist weiter spürbar – gemessen, nicht behauptet.** Ein zweiter
Kontrolllauf fährt die Endeinstellung mit `BONUS_SIEG` 1,00 und `BONUS_NIEDERLAGE`
1,00, also mit abgeschaltetem Ausgang. Für den reinen Musiker bringt die Sieg-Farm
dann 106.225/Tag (**−1,4 %** gepaart) statt 120.874 (+15,0 %) – der Ausgang trägt
ihr also **16,4 Prozentpunkte** ihres Jahresertrags –, und ihr Ø Hype über alle Tage
liegt bei 1,11 statt 1,18. Der passive Spieler landet ohne Ausgangsfaktor bei **exakt
±0,0 %**, und zwar in BEIDEN Archetypen und bei 4.939 abgerechneten Niederlagen:
Seine Zeile ist Zahl für Zahl die von „ohne Beef" (104.032/Tag, 858.428 Follower,
591.809 Hörer, Hype 1,11). Das ist die Kontrolle, die belegt, dass das
Angezähltwerden selbst – Szene-Malus, Draht, die offene Front – kein Geld kostet und
ausschließlich das Niederlagen-Fenster es tut.

**Der Preis des kurzen Fensters, und wie er bezahlt wurde.** Wer angezählt wird und
es aussitzt, verlor mit dem Wochenfenster **−23,9 %** (nur Musik) bzw. −10,4 %
(Musik+Creator) im Jahr. Mit dem Tagesfenster von 5d waren es nur noch **−5,0 %**
bzw. +0,2 %, bei Musik+Creator also nicht mehr von null zu unterscheiden – ein
kürzeres Fenster verkürzt den Sieg und die Niederlage gleich stark, und die
Niederlage war die Zahl, mit der 1.40.0 geworben hat. Nachtrag 5e holt sie zurück,
ohne das Fenster wieder zu verlängern: **häufiger statt länger.** `ANZAEHL_CHANCE`
0,06 → 0,35 heißt gezählt 83,0 Anzählungen im Jahr statt 19,6 (nur Musik, Variante
„passiv", 60 Läufe), und jede davon endet 0:1 – 4.901 Abrechnungen, Siegquote 0,0 %,
Gegenschläge **0**. Das Ergebnis: **−19,9 %** (nur Musik, gepaart) statt −5,0 %,
56 von 60 Seeds tragen das Vorzeichen, und **−10,2 %** statt +0,2 % bei
Musik+Creator (18 von 60 Seeds im Plus, bei 120 Läufen −6,9 % – das Vorzeichen ist
gesichert, die Größe nicht).

**Warum `ANZAEHL_CHANCE` und nicht `BONUS_NIEDERLAGE`.** Weil es die einzige Zahl
ist, die den passiven Spieler oft erreicht, und das steht im Code: `anzaehlen`
schreibt `konter_at: 0` (`src/beef.js:418`), und `settle` schlägt nur bei
`konter_at > 0` zu (`src/beef.js:454`). Wer schluckt, nimmt also im ganzen Jahr
**keinen** Gegenschlag; `KONTER_HYPE` und `KONTER_HOERER` können ihn nicht treffen,
und sie zu erhöhen würde nur den aktiven Spieler bestrafen, der bei −51,8 % steht.
Von allen Beef-Zahlen erreichen ihn damit genau drei: wie oft ein Niederlagen-Fenster
aufgeht, wie hart es beißt und wie lange es offen bleibt. `BONUS_NIEDERLAGE` ist
gemessen worden und ist der schwächere Hebel (siehe oben, er sättigt); die Zahl der
Fenster sättigt nicht. **Wo diese Messung an ihre Grenze kommt:** Musik+Creator
lässt sich so nicht weit ins Minus holen, weil das Fenster ein Faktor auf den Hype
ist und bei ihm nur Tantiemen (22 % seiner Einnahmen) und Konzerte (3 %) daran
hängen – Merch (59 %) fällt nur 4,4 %, während die Tantiemen 22,6 % fallen. Selbst
`--anzaehl-chance=1.0` bringt ihn nur auf −5,5 %. Was ihn wirklich treffen würde,
wäre ein Verlust, der nicht über den Hype läuft; eine solche Zahl gibt es in 5b
nicht, und diese Messung durfte sie nicht erfinden.

**Die Sieg-Farm bleibt die stärkste Beef-Spielweise, und sie sieht den Sieg.** Sie
macht EINEN Disstrack je Front und lässt sie dann auskühlen; das Ziel wird so
gewählt, dass `wuchtOf` unter 0,19 bleibt (95 % von `KONTER_LAECHERLICH` 0,20, damit
sein Gegenschlag die Runde für *mich* holt) und `haemeOf` so klein ist, wie es das
Genre zulässt. Ergebnis über 21.900 Tage: 3.843 Abrechnungen, **Sieg 2.730
(Siegquote 71,0 %)**, Niederlage 1.065 (27,7 %), Unentschieden 48 (1,2 %); ihr Ø
Aufmerksamkeitsfaktor **1,068** ist der einzige über 1 in der ganzen Messung, ihre
Häme-Quote liegt bei 4,4 % statt 23,3 %. Die Siegquote ist mit 5e gefallen (vorher
2.875 von 3.270 = 87,9 %), und zwar nicht in ihrer eigenen Spielweise: Die 995
Fronten, die das Angezähltwerden nebenbei aufmacht, kühlen unbeachtet aus und
rechnen als Niederlage ab. Was sie **nicht** mehr ist: die Spielweise, die auch
Hörer bringt. Ihre 565.692 Hörer am Jahresende liegen unter den 591.809 des Spielers
ohne Beef; mit `spike` 3,0 und dem Wochenfenster lagen sie mit 968.915 weit darüber.

**Die Spielweise „jeden Tag ein Disstrack" ist jetzt messbar teuer.** „aktiv" liegt
für den reinen Musiker bei **−51,8 %**, `diss-isoliert` bei −46,9 % (gepaart), für
Musik+Creator bei −17,7 % bzw. −12,4 %. Der Grund ist die Verzinsung: Wer 365 Tage
lang eine Art mit 0,84 Hörern je Titel statt 1,00 bringt, endet mit 79.941 statt
591.809 Hörern. Die zwei Prozentpunkte, die 5e draufgelegt hat (−49,6 % → −51,8 %),
sind das häufigere Angezähltwerden: Es trifft ihn schwächer als den passiven
Spieler, weil seine zwei Frontplätze meist von seinem eigenen Dauerbeef belegt sind
(3.032 Anzählungen statt 4.982). Der Satz „Wer streitet, sollte gewinnen wollen und nicht ewig
weitermachen" war bis hierher eine Absicht; jetzt ist er eine Messung.

**Der Sieg zahlt der Spielweise „aktiv" weiterhin nie.** Alle **2.986**
Abrechnungen dieser Variante gingen **0:1** aus, Siegquote **0,0 %**, und keine
abgerechnete Front war eine, in die der Spieler je einen Disstrack gesteckt hatte.
Das ist keine stille Null, sondern die Mechanik: `zielFor` nimmt die heißeste Front,
und wer sie täglich auf `HITZE_MAX` hält (Ø Hitze beim Disstrack 95,5), rechnet sie
im ganzen Jahr nicht ab; abgerechnet wird die **zweite** Front, die das
Angezähltwerden nebenbei aufgemacht hat und die unbeachtet auskühlt. Widerlegt ist
der Sieg damit nicht – `test/beef.test.js` rechnet alle drei Ausgänge durch, und die
Sieg-Farm kommt auf 71,0 % –, aber in DIESER Spielweise trägt er nicht.

**`haemeOf` klemmt nur in Hip-Hop auf 0.** Bei derselben Messreihe aufgefallen und
hier festgehalten, weil es nirgends stand: `Math.max(1, meine / seine)` klemmt das
Größenverhältnis bei 1, nicht den Logarithmus bei 0 – der erste Summand verschwindet
bei jedem Gegner, der mindestens so groß ist wie ich, der Genre-Summand
`0,2 × (1 − genrefaktor)` bleibt aber stehen. Für einen Pop-Künstler bleibt damit ein
Häme-Risiko von **0,0462** je Disstrack, egal wie groß der Gegner ist (gemessen in
jedem Block als gewählte Wahrscheinlichkeit 0,0462). Null ist der Boden nur bei
`genrefaktor` 1, also `risk` 1,3 – und das hat allein Hip-Hop.

**Die Veröffentlichungsart ist der große Hebel, und sie hat mit dem Beef nichts zu
tun.** Als Kontrolle lief derselbe Spieler ohne jeden Beef, aber mit „warten bis
sechs Titel, dann Album" statt der täglichen Single: **+665,7 %** (2.741.519/Tag)
bzw. **+2766,1 %** (2.981.641/Tag), 60 von 60 Seeds, und die Beef-Spielweise liegt
89,2 % bzw. 98,3 % darunter. Das ist ein Befund über die Musik und über die
Spielweise des Messskripts, nicht über 5b: Die Zahlen der Archetypen oben messen
„jeden Tag die Single, die fertig ist" und damit **nicht** die beste Spielweise. Wer
die Rangfolge oben fortschreibt, muss das wissen.

**Ehrliche Grenzen:** (1) **Der Rand ist nah, aber weniger nah als nach 5d.** Die
Endeinstellung liegt mit +16,2 % 8,8 Prozentpunkte unter dem Deckel (nach 5d
waren es +19,7 % und gut fünf), und `spike` 2,2 statt 2,1 riss ihn damals schon
(+25,3 %, gemessen). Wer am Kontaktkatalog, an `ANZAEHL_CHANCE`, an `HYPE_MAX` oder
an den Genres dreht, muss diese Messung wiederholen. (2) **Die Streuung ist größer
als der Effekt.** Bei 10 Seeds wackelt derselbe Punkt der Suche um gut zehn
Prozentpunkte – dieselbe Einstellung liefert dort für `sieg-farm` +15,2 % statt
+19,7 %. Deshalb ist mit 30 Seeds gesucht und mit 60 bestätigt; die Rangfolge der
Spielweisen ist über alle drei Seedzahlen stabil, die Größe der Zahlen nicht. Bei der
`sieg-farm` gilt das auch für 30 Seeds: In der Suche von 5e stehen drei nicht
gewählte Einstellungen über +25 %, alle mit 30 Läufen gemessen, während jede mit 60
bestätigte bei oder unter +16,6 % bleibt. **Die schwächste veröffentlichte Zahl ist
die des passiven Musik+Creators** (−10,2 % bei 60 Läufen, −6,9 % bei 120, Spanne je
Seed −33,8 % … +35,2 %): Ihr Vorzeichen ist gesichert, ihre Größe nicht. (3)
Die Zahlen der Spielweise „aktiv" gelten für genau eine Spielweise, und zwar die
teure: jeden Tag ein Disstrack auf die heißeste Front, **kein Frieden**. **Nicht**
gemessen sind der Spieler, der Frieden anbietet, und die Kombination „Album horten
**und** Disstrack" – Songs und Veröffentlichungsplatz sind zwischen beiden geteilt.
Auch **nicht gemessen** ist die Kombination aus Beef-Sieg und Kontakt-Zusage:
Keine Beef-Variante des Messskripts setzt `strat.kontakte`
(`scripts/messung-geldquellen.js:826` gegen die Variantenkonstruktion an
`:2740-2752` – dort fehlt `kontakte: true`, anders als in der 5a-Kontaktmessung),
also gab es in keinem gemessenen Beef-Jahr eine einzige 5a-Kontaktanfrage. Das ist
kein Randfall: Eine `feature`-Zusage multipliziert denselben `audienceFactor` einer
Veröffentlichung mit bis zu `kb.factor` **6** (`src/contacts.js:90`), den auch die
Aufmerksamkeit des Disstracks speist (dort höchstens 2,5) – und anders als die
Hype-Seite (`HYPE_MAX`) ist dieser Faktor auf einer einzelnen Veröffentlichung
nicht gedeckelt. Was ein gewonnener Beef zusammen mit einer frischen
Feature-Zusage bringt, ist damit **nicht gemessen**, und diese Messung schätzt es
nicht. Auch die `sieg-farm` ist die beste **gemessene** und nicht die beste mögliche. (4)
**`diss-isoliert` ist eine Messvariante und kein Spielzustand:** Kein Spieler kann
`anzaehlen` abschalten. Die Zahl sagt, was der Disstrack als Veröffentlichung wert
ist, nicht was ein Spieler verdient. (5) Der **reine Creator fehlt** – er hat keinen
Disstrack. (6) Alles hängt an `ANZAEHL_CHANCE` (35 % je Chart-Platzierung, seit 5e):
Wer nie chartet, sieht nie einen fremden Beef – und für ihn ist der ganze Abschnitt
wirkungslos. Wie sich 83 Anzählungen im Jahr statt 20 anfühlen, ist **nicht**
gemessen; gemessen ist nur, was sie kosten. Ungenannt bisher: In derselben
Sieg-Farm blockieren fremd geöffnete Fronten den eigenen 🔥-Anstacheln-Knopf mit
dem Grund `zu_viele` („Zwei Beefs sind genug.") an 11.917 von 21.900 Tagen –
**54,4 %**, also an rund jedem zweiten Tag (`docs/messungen/2026-09-26-beef.txt`,
„Sieg-Farm, Tage ohne Anstacheln … beide Fronten belegt"). Auch das ist nur
gezählt, nicht als Spielgefühl bewertet. (7) Ein Eingriff des Messwerkzeugs: Der
Anzähl-Wurf läuft dort für „passiv" und „aktiv" auf dem Beefwürfel; für „ohne Beef"
(und „Album") entfällt er ganz, statt gezogen und weggeworfen zu werden. (8) Die
Strategie-Suchphase des Messskripts ist **nicht bit-stabil**: Zwei Aufrufe derselben
Kommandozeile unterscheiden sich dort in fünf Zeilen um je 1 Einheit (in 5e waren es
zwei Zeilen, und bei zwei Aufrufen derselben Kommandozeile trat es gar nicht auf).
Der Beef-Abschnitt war in jedem Vergleich zeilengleich; woher die Abweichung kommt,
ist nicht geklärt. (9) Die Messung ist eine reine Geldfrage; was der Beef an Spielgefühl
und Texten bringt, misst sie nicht. (10) Für **jede** gemessene Beef-Spielweise ist
der Beef damit **keine** Geldquelle in der Rangfolge oben, sondern ein Risiko, das
man verwaltet – die stärkste liegt bei +16,2 %, und die Album-Spielweise ohne jeden
Beef liegt mit 2.981.641/Tag gegen 120.874/Tag eine Größenordnung darüber. (11) Was
5e aufwirft und nicht messen konnte: Mit 83 Fronten im Jahr ist „jede beantworten"
keine Spielweise mehr (−51,8 %) und „alle aussitzen" kostet −19,9 %; die Spielweise
dazwischen – antworten, gewinnen, Frieden anbieten – ist im Messskript nicht gebaut.

**Gegenanfragen und große Formate (seit 1.41.0, Stück 5c):** Derselbe Draht wie
in 5a und 5b, diesmal in der Gegenrichtung (`src/angebote.js`, Zahlen in
`src/data/angebote.js`): Ein Kontakt, zu dem der Draht steht, meldet sich von
selbst – ein Wurf je vergangenem Tag mit `ANFRAGE_CHANCE`, höchstens
`ANFRAGEN_MAX` 2 offen, höchstens `ROLL_TAGE_MAX` 7 nachgeholte Tage, Frist drei
Tage. Es gibt **sechs Arten**: Erwähnung und Gastpart (beide setzen denselben
Release-Schub wie eine Zusage in 5a), Vorgruppe (eine Gage), gemeinsames Album
und Tour zu zweit (je ein **Stundenkonto**, das man in Zwei-Stunden-Schritten
füllt, 14 Tage Frist, danach sind die Stunden weg) und die Einführung beim Label
(ein Vertragsangebot). Die letzten drei kommen nur von Partnern (Draht ≥ 50);
Annehmen hebt den Draht um 8, Absagen senkt ihn um 5, **Liegenlassen um 8**, und
nach drei nicht angenommenen Anfragen ruht der Zustellweg zwei Wochen.

**Die Grenze ist scharf und gewollt:** kein neuer Zufluss (§3). In
`src/angebote.js` und `src/data/angebote.js` steht **kein einziger `unb`-Aufruf**
– Honorar und Gage gehen über `music.payGig`, die Tour über `music.show`, das
Kollabo über `music.publish`, der Vorschuss über `music.sign`, alle mit
`{ kind: 'music' }` wie das Konzert. Vier Decken, jede mit den Funktionen aus
`src/angebote.js` gerechnet (`docs/messungen/2026-10-02-angebote.txt`, Abschnitt
„Decken"):

* **Honorar zweiseitig gedeckelt.** `3 × seine^0,6`, aber nie über 30 Tage
  eigener Tantiemen. Höchster Betrag, den der Katalog hergibt: **221.558**
  (Coldplay, 130 Mio Hörer) – und den auch nur ab **55.285 eigenen Hörern**,
  darunter bindet immer der Deckel. Wer selbst eine Million Hörer hat, bekommt
  für einen Gastpart bei einem 3,2-Mio-Künstler **24.000** gegen 238.364
  Tantiemen am Tag: für den zählt nur noch der Schub.
* **Gage ×1,625.** Sein Publikum ist auf die eigene Hörerschaft gedeckelt, und
  die Gage hängt an `Hörer^0,7` – mehr als `2^0,7` = **×1,625** gibt es nicht.
  Gerechnet bei 10.000 eigenen Hörern: 5.048 allein und 8.200 mit einem Partner
  von 350.000 – und mit jedem größeren genau dasselbe, weil der Deckel bei der
  eigenen Hörerschaft liegt. Bei 100.000 eigenen reicht derselbe 350.000er nur
  noch für ×1,120, ein 3,2-Mio-Partner wieder für ×1,625.
* **Kollabo ×2,0.** `1 + log10(1 + seine/meine)/3`, also höchstens ×2,000 auf das
  Publikum **einer** Veröffentlichung – und nur gegen 18 statt 3 Stunden für
  dieselben sechs Titel.
* **Vorschuss 3 Tage.** `LABEL.advanceDays` 3 Tage Tantiemen bei Unterschrift,
  einmal je Vertrag, nur wenn keiner läuft; danach 30 % Anteil über 60 Tage.
  **Waren bis zum 2026-10-02 zehn Tage** – das ist eine der zwei Zahlen, die die
  Messung gekostet hat, siehe „Der Deckel von +25 %" unten.

**Zwei Ausnahmen, beide bewusst.** (1) **Die Tour bucht fünfmal, einmal je
Abend** – das ist die zweite Ausnahme von §9 („eine Buchung je Aktion", die
andere ist der Anteilskauf). Der Grund ist gemessen und nicht geschätzt: Eine
einzige Buchung über die Summe hätte die Erfahrung mehr als halbiert, weil
`xpForAmount` die Wurzel nimmt – fünf Abende mit 109.468 · 52.810 · 76.033 ·
53.459 · 82.480 geben `⌊√⌋` zusammen **1.352 XP**, eine Buchung über 374.250 nur
**611** –, und aus fünf Konzerten wäre in `artist.shows`, in der Aktivitätsliste
(`unb.countActivity` hängt an jeder Buchung mit `kind`) und in jedem Erfolg eines
geworden. Es entsteht dabei nichts: Jede der fünf Buchungen ist die eines
einzelnen Abends über `music.show`. (2) **`SHOW_MIN_LISTENERS` (5.000) gilt für
Vorgruppe und Tour absichtlich nicht** – die Halle füllt der Hauptact. Die Folge
muss man aussprechen: Ein Künstler, der allein kein einziges Konzert spielen
dürfte, bekommt fünf `shows` und fünf Aktivitätstakte in seine Statistik. Kein
Hahn, denn Gage und Zuwachs hängen weiter an der **eigenen** Hörerschaft (bei 10
Hörern 65, auch neben Coldplay), aber ein Weg auf die Bühne, den es vorher nicht
gab. Dazu kommt, dass `publish(…, { force: true })` beim Kollabo auch die
20-Stunden-Release-Sperre übergeht; gemessen hat das **nichts** geändert, weil
die Zahl der Veröffentlichungen je Tag in jeder Variante gleich blieb – zwischen
−1,3 % und +0,4 % gegen „aus" in der Ausgangseinstellung und zwischen −0,6 % und
+0,0 % in der Endeinstellung. Der Spieler hängt an der Titelzahl, nicht an der
Sperre.

**Gemessen** (`node scripts/messung-geldquellen.js 60 365 --nur=angebote`,
vollständige Ausgabe in `docs/messungen/2026-10-02-angebote.txt`; fester Würfel
`rng(1000+i)`, Kontaktwürfe `rng(501000+i)`, Angebotswürfe `rng(901000+i)`, in
allen Varianten dieselbe je Archetyp einmal gesuchte Strategie, eigene Welt und
eigenes Konto je Variante). **Alle Varianten pflegen Kontakte mit
Partner-Vorrang** – ohne Draht ≥ 20 meldet sich niemand, und die freie Wahl aus
5a baut über ein Jahr genau einen Draht auf, nämlich zu einem reinen Creator
ohne Musik-Reichweite (gemessen: `tomscott` bei Draht 93–100, sonst niemand über
23). Sechs Varianten, zwei Archetypen; gezeigt ist der Median je Tag und die
Differenz gegen „aus" als *Mediane / je Seed gepaart*.

**Diese erste Tabelle ist die AUSGANGSEINSTELLUNG** (`ANFRAGE_CHANCE` 0,18,
`LABEL.advanceDays` 10) – also der Stand, der den Auslöser gerissen hat. Heute
stehen in den Datendateien 0,09 und 3; wer diese Tabelle nachfahren will, braucht
deshalb `--anfrage-chance=0.18 --label-vorschuss=10`. Was heute gilt, misst die
zweite Tabelle darunter.

| Variante (Ausgangseinstellung) | Musik+Creator | nur Musik |
| --- | --- | --- |
| `aus` (wie vor 1.41.0) | 303.876/Tag | 89.211/Tag |
| `alles-ab` (jede Anfrage abgelehnt) | 293.980 (−3,3 % / −0,4 %) | 89.875 (+0,7 % / −0,1 %) |
| `alles-an` (jede Anfrage angenommen) | 313.913 (+3,3 % / +8,6 %) | 130.432 (+46,2 % / **+47,0 %**) |
| `nur-geld` (nur Honorar und Gage) | 290.179 (−4,5 % / −2,5 %) | 95.108 (+6,6 % / +4,6 %) |
| `nur-projekte` (nur Kollabo und Tour) | 294.897 (−3,0 % / −0,1 %) | 95.739 (+7,3 % / +3,1 %) |
| `nur-label` (nur der Vertrag) | 300.179 (−1,2 % / −0,8 %) | 92.576 (+3,8 % / −0,2 %) |

**Und das ist der Stand von heute** (`ANFRAGE_CHANCE` 0,09,
`LABEL.advanceDays` 3; dieselben Seeds, dieselbe Strategie, dieselbe Grundlage
„aus" – sie ist von beiden Konstanten unberührt, weil sie den Zustellweg nie
ruft):

| Variante (Endeinstellung) | Musik+Creator | nur Musik |
| --- | --- | --- |
| `aus` | 303.876/Tag | 89.211/Tag |
| `alles-ab` | 288.150 (−5,2 % / −2,8 %) | 90.112 (+1,0 % / +0,0 %) |
| `alles-an` | 301.263 (−0,9 % / −0,4 %) | 104.209 (+16,8 % / **+17,9 %**) |
| `nur-geld` | 285.073 (−6,2 % / −4,4 %) | 91.542 (+2,6 % / +1,0 %) |
| `nur-projekte` | 299.115 (−1,6 % / +0,0 %) | 93.916 (+5,3 % / +2,5 %) |
| `nur-label` | 290.172 (−4,5 % / −1,4 %) | 89.323 (+0,1 % / −0,1 %) |

**Höflichkeit kostet fast nichts, und das ist eine Nachricht.** `alles-ab` liegt
beim reinen Musiker bei +0,0 % gepaart (Ausgangseinstellung −0,1 %): Wer jede
Anfrage absagt, verliert Draht und steht an 18,9 % der Tage in der
Zwei-Wochen-Pause (Ausgangseinstellung 27,8 %), aber Geld kostet ihn das nicht.
Bei Musik+Creator sind es −2,8 % (vorher −0,4 %) – das sind die Stunden, die das
Lesen und Absagen trotzdem kostet, und sie liegen innerhalb der Streuung (Spanne
je Seed −25,6 % … +32,3 %). Teuer ist nur das Liegenlassen (−8 Draht statt −5), und das steht in
der Anzeige.

**Die Summe der Teile ist ein Zehntel des Ganzen – und der Grund ist die Pause.**
(Die Zahlen dieses Absatzes sind die der Ausgangseinstellung, weil die Zerlegung
dort gefahren wurde.) `alles-an` liegt für den reinen Musiker bei +47,0 %,
während jede isolierende Variante zwischen −0,2 % und +4,6 % steht. Das ist kein Rechenfehler, sondern
`PAUSE_SCHWELLE` 3: Wer fünf von sechs Arten ablehnt, treibt `abgelehnt_folge`
ständig über die Schwelle und steht gemessen an **15,2 % (`nur-geld`), 20,1 %
(`nur-projekte`) und 26,5 % (`nur-label`) aller Tage ohne einen einzigen Wurf**
da – `alles-an` an 0 %. Die isolierten Zahlen messen also die Pause mit. Für die
Frage „welcher Weg trägt was?" musste deshalb eine zweite Zerlegung dazukommen
(`--zerlegung`, 30 Läufe): „alles-an" gegen „alles-an ohne eine Gruppe", bei
gleicher Zustellrate. Gepaart je Seed, reiner Musiker: **Honorar + Gage +18,2 % ·
Kollabo + Tour +20,2 % · Label +5,9 % · Erwähnung +2,5 %** (Musik+Creator:
+6,1 % · +7,6 % · +1,0 % · +4,7 %). Für den reinen Musiker addieren sich diese
vier auf +46,8 % und treffen damit die +47,0 % – bei voller Zustellrate sind die
Wege dort fast additiv. **Für Musik+Creator gilt dieser Satz nicht:** Dieselben
vier summieren auf +19,4 %, gemessen sind +5,6 %. Sein Tag ist voll, und die Zeit
kostet mehr, als die Summe der Beiträge wert ist – wer die vier Zahlen der
Klammer addiert, muss das mitlesen.

**Woher das Geld wirklich kommt** (`alles-an`, reiner Musiker, 60 Läufe, je Tag,
Endeinstellung): Tantiemen 93.478 (gegen 78.022 ohne Angebote), Konzert 17.191
(gegen 12.854), Vorschuss 1.302, Vorgruppe 823, Gastpart 91, Vertragsstrafe
−750. Die drei neuen Geldwege zusammen sind damit **2.216 am Tag** von 104.209 –
der größere Teil des Zuwachses steckt nicht im Geld, sondern in den **Hörern**
(710.274 gegen 516.949), und die kommen aus den 2 %, die jeder Vorgruppen- und
Tour-Abend bindet, und aus dem Wachstum ×1,5 des Label-Vertrags. Die Zahl der
Konzerte steigt um **+14,6 %**, die der Veröffentlichungen um −0,6 %. (In der
Ausgangseinstellung waren es Tantiemen 102.945, Konzert 20.496, Vorschuss
**8.719**, Vorgruppe 1.848, Gastpart 423, Vertragsstrafe −1.823 und +25,2 %
Konzerte – der Vorschuss war dort der größte der drei neuen Wege, und genau
deshalb ist er gesenkt worden.)

**Die vier Decken sind in der Praxis drei.** Das Honorar erreicht seinen
Katalog-Höchstwert wirklich – gemessen **221.558** als größter Einzelbetrag, in
beiden Einstellungen, bei einem Mittel von 5.942 über 365 Gastparts
(Endeinstellung; 14.331 über 842 in der Ausgangseinstellung). Die Gage auch
(größte 158.038, Ø 52.993; in der Ausgangseinstellung 231.082 bei Ø 63.219). Der
**Kollabo-Faktor nicht**: Über die fünf erschienenen Kollabo-Alben steht er bei
Ø **1,037** (1,002 … 1,069) gegen eine Decke von 2,000 – in der
Ausgangseinstellung Ø 1,145 mit 1,683 als größtem Wert. Der Grund ist nicht der
Zufall, sondern die Antwortchance: Sie liegt für einen Künstler mit 100.000
Hörern bei Coldplay bei 6,7 % und bei den übrigen Riesen bei `CHANCE_MIN`
**2,0 %**. Der Partner, den man überhaupt aufbauen kann, ist in seiner
Größenordnung – gemessen hatten die Partner am Laufende eine Reichweite von Ø
524.048 ohne Angebote und Ø 1.869.805 mit (Ausgangseinstellung: 6.574.127, weil
dort gut doppelt so viele Anfragen zugestellt wurden – 3.362 gegen 1.630 – und
jede angenommene den Draht um 8 hebt).

**Das Kollabo-Album ist in der gemessenen Spielweise ein Totalverlust, und das
ist eine Zahl, kein Eindruck.** Von **195** angenommenen Kollabos sind **5**
erschienen und **174** verfallen – jedes mit einem **vollen** Stundenkonto von 18
Stunden, dazu 1.825 Knopfdrücke, die mit `no_songs` abgewiesen wurden (in der
Ausgangseinstellung 377 · 7 · 356 und 3.630 Drücke). Der Grund
ist das Zusammenspiel zweier Regeln, die beide richtig sind: Ein Kollabo braucht
`KOLLABO_TITEL` 6 Titel, und die gemessene Spielweise veröffentlicht jeden Tag
die Single, die fertig ist – sie hat nie sechs liegen. Wer ein Kollabo annimmt,
muss seine Titel horten, und das sagt ihm nur die `no_songs`-Meldung.
**Und wenn er es richtig macht, ist es ein Nullgeschäft:** Ein eigenes
Kontrollpaar (beide horten, beide bringen Alben, nur eines ist ein Kollabo) liegt
in der Endeinstellung bei **−5,3 % / −5,0 %** (Musik+Creator) und **+3,7 % /
+3,8 %** (nur Musik), in der Ausgangseinstellung bei −6,7 % / −4,2 % und −1,5 % /
−0,1 % – vier Zahlen, die um null streuen, bei Spannen je Seed von −48,6 % bis
+70,9 %. 18 Stunden gegen 3 für ein Publikum ×1,054 (1,005 … 1,353) bzw. ×1,049
(1,004 … 1,360) ist eben kein Geschäft – das sind die Faktoren, die die 203
Kollabos **dieses** Paares wirklich gebracht haben, nicht die ×1,037 der fünf aus
`alles-an`. An der Stückzahl ist die Zahl nicht gescheitert: Im Kontrollpaar sind
203 von 206 Kollabos erschienen (108 von 110 und 95 von 96), weil der Spieler
dort seine Titel hortet. Die Gegenprobe gegen die Single-Grundlage zeigt, warum
dieses Paar nötig war: „horten statt tägliche Single" allein ist **+821,8 %**
bzw. **+3309,3 %** – wer ein Kollabo gegen die Single-Grundlage stellt, verkauft diesen Abstand als Wirkung
des Kollabos.

**Der Deckel von +25 % hält, und er hat zwei Konstanten gekostet.** Der
Plan zu 5c sieht vor: Liegt eine Variante über **+25 %** gepaart, wird die
zugehörige Konstante gesenkt und neu gemessen. `alles-an` lag für den reinen
Musiker bei **+47,0 %** (60 Läufe; +47,1 % bei 30, +51,5 % bei 10 – über alle
drei Seedzahlen stabil, 55 von 60 Seeds im Plus). Welche Konstante das ist, hat
die Messung entschieden und nicht die Vermutung – jeder Hebel einzeln gemessen,
30 Läufe, `alles-an` gepaart gegen die +47,1 % der Ausgangseinstellung:

| Hebel | Einstellung | `alles-an` gepaart |
| --- | --- | --- |
| `VORGRUPPE_ANTEIL` | 0,05 → 0 | +47,1 % (**±0,0**) |
| `TOUR_STUNDEN` | 24 → 40 | +57,4 % (**+10,3**) |
| `LABEL.advanceDays` | 10 → 3 | +38,3 % (−8,8) |
| `LABEL.advanceDays` | 10 → 0 | +34,6 % (−12,5) |
| `LABEL.cut` | 30 % → 40 % | +36,1 % (−11,0) |
| `TOUR_KONZERTE` | 5 → 3 | +31,5 % (−15,6) |
| `ANFRAGE_CHANCE` | 18 % → 12 % | +30,9 % (−16,2) |
| `LABEL.cut` | 30 % → 50 % | +23,3 % (−23,8) |
| `ANFRAGE_CHANCE` | 18 % → 9 % | +24,9 % (−22,2) |
| `ANFRAGE_CHANCE` | 18 % → 7 % | +28,7 % (−18,4, **nicht monoton**) |
| `ANFRAGE_CHANCE` | 18 % → 6 % | +12,4 % (−34,7) |
| `advanceDays` 3 **und** `ANFRAGE_CHANCE` 12 % | | +26,9 % (−20,2) |
| `advanceDays` 3, `ANFRAGE_CHANCE` 12 % **und** `TOUR_KONZERTE` 3 | | +24,5 % (−22,6) |
| `advanceDays` 3 **und** `ANFRAGE_CHANCE` 9 % | | +21,9 % (−25,2) |

**Zwei der vier Hebel, die der Plan nennt, wirken nicht oder falsch.**
`VORGRUPPE_ANTEIL` auf 0 ändert die Zahl auf die Stelle **nicht** – weil die Gage
fast vollständig die eigene Konzertgage ist und das mitgebrachte Publikum nur die
letzten 62 % obendrauf legt. `TOUR_STUNDEN` auf 40 macht es **schlechter**: Das
Konto wird dann innerhalb der 14 Tage nicht mehr voll, die Tour verfällt, und weil
ein offenes Projekt `kollabo` von der Zustellung aussperrt, spart der Spieler sich
die 18 Stunden, die er sonst in ein Kollabo ohne Titel gesteckt hätte.
`HONORAR_K` und `KOLLABO_STUNDEN` hängen an Wegen, die zusammen 423 von 130.432
am Tag ausmachen.

**Keiner der vier Hebel aus der Liste des Plans löst es allein.** `LABEL.cut` auf
50 % käme mit +19,2 % (60 Läufe) unter die Linie, aber dieser Anteil liegt auf
JEDER Musikeinnahme: Er senkt die Zahl, indem er Honorar, Gage und Tour
mitbesteuert – also die Wege, die das Problem verursachen, über einen Weg, der
nur +5,9 % davon trägt. Dazu nähme der Label-Vertrag damit denselben Anteil wie
das Idol-Angebot bei weniger Wachstum und kleineren Hallen, und `nur-label` fiele
von −0,2 % auf −3,5 %: ein Vertrag, den niemand mehr unterschreiben sollte.
**Eine Kombination aus der Liste kommt ebenfalls unter den Deckel, und sie ist
trotzdem nicht gewählt:** `advanceDays` 3, `ANFRAGE_CHANCE` 12 % **und**
`TOUR_KONZERTE` 3 liegt bei **+24,5 %** (30 Läufe, −22,6 Punkte). Sie bezahlt
diesen Platz aber mit einer dritten Konstante und mit dem knappsten Abstand aller
Kandidaten – die gewählte Einstellung liegt mit +17,9 % volle 7,1 Prozentpunkte
unter dem Deckel –, und `TOUR_KONZERTE` von 5 auf 3 nimmt der Tour genau das, was
sie von einem Konzert unterscheidet, obwohl die Zerlegung nicht auf die Zahl der
Abende zeigt, sondern auf die Menge der Gelegenheiten.
`ANFRAGE_CHANCE` ist der Hebel, den die Zerlegung benennt – alle vier Wege
hängen an ihm gemeinsam –, aber **unter 0,12 ist er nicht auflösbar**: 0,09 gibt
+23,0 %, 0,08 gibt +25,6 %, 0,07 gibt +26,9 %, und 0,06 gibt +14,0 % – bei 60
Läufen, derselben Säung, einem Schritt von einem Prozentpunkt. Das ist kein
Verlauf, sondern ein Rauschteppich um die +25 %; 5b hat dasselbe bei 10 Seeds
gesehen, hier passiert es bei 60.

**Das Messwerkzeug zieht an dieser Stelle einen anderen Schluss als dieser
Abschnitt, und das steht so in der Rohausgabe.** Unter der Zerlegung druckt es die
Faustregel „stärkster Beitrag: projekte +20,2 % – DAS ist die Gruppe, deren
Konstante der Auslöser meint". Sie zeigt auf die Konstanten von Kollabo und Tour,
und genau die sind oben einzeln gefahren: `KOLLABO_STUNDEN` hängt an einem Weg,
der 423 von 130.432 am Tag ausmacht, `TOUR_STUNDEN` macht es mit +57,4 %
schlechter, und `TOUR_KONZERTE` wirkt zwar (+31,5 %), bleibt allein aber über dem
Deckel und kürzt die Tour auf drei Abende. Die Faustregel ist also eine Heuristik
des Werkzeugs und kein Ergebnis; gewählt ist die Konstante, an der alle vier
Gruppen **gemeinsam** hängen. Gedruckt bleibt die Zeile trotzdem – ein Werkzeug,
das seinen eigenen Schluss zieht, muss nachlesbar sein, auch wenn die Messung
dagegen entscheidet.

**Gesenkt wurden deshalb ZWEI Zahlen, wie bei 5b, und sie ergeben zusammen eine
Rechnung:**

* `ANFRAGE_CHANCE` **0,18 → 0,09** (`src/data/angebote.js`) – die Menge an freien
  Gelegenheiten, die ein Tag enthält. Aus „gut alle fünf Tage eine Anfrage" wird
  „gut alle elf". Allein: +47,0 % → +23,0 %.
* `LABEL.advanceDays` **10 → 3** (`src/data/music.js`) – der einzige Betrag je
  Anfrage, der wirklich aus der Reihe fällt: Ø **913.659** bei einem
  Tageseinkommen von 89.211, und das alle 60 Tage neu, 209 Mal in 60 gemessenen
  Jahren. Zusammen mit der Chance: +23,0 % → **+17,9 %**, also genau die 5,1
  Prozentpunkte, die die Zerlegung dem Label zuschreibt (+5,9 %).

**Die Endeinstellung, bestätigt bei 60 Läufen:** `alles-an` liegt beim reinen
Musiker bei **+16,8 % / +17,9 % gepaart** (48 von 60 Seeds im Plus, Spanne
−25,0 % … +117,0 %) und bei Musik+Creator bei **−0,9 % / −0,4 %**. Damit liegt
die stärkste gemessene Spielweise **7,1 Prozentpunkte unter dem Deckel** (bei 5b
waren es am Ende 8,8). Die isolierten Varianten stehen danach bei +1,0 %
(`nur-geld`), +2,5 % (`nur-projekte`) und −0,1 % (`nur-label`), die Konzerte bei
+14,6 % statt +25,2 %. **Nicht angetastet** wurden `HONORAR_K`, `HONORAR_EXP`,
`HONORAR_DECKEL_TAGE`, `VORGRUPPE_ANTEIL`, `KOLLABO_STUNDEN`, `KOLLABO_TITEL`,
`TOUR_STUNDEN`, `TOUR_KONZERTE`, `PROJEKT_FRIST_TAGE`, `LABEL.cut` und jede
andere Zahl: Jeder Betrag, den die Anzeige auf einen Knopf schreibt, ist der, den
die Spec versprochen hat.

**Ehrliche Grenzen:** (1) **Die Streuung ist größer als jede isolierte Zahl.** Bei
60 Läufen reicht die Spanne je Seed für `alles-an` von −17,9 % bis +167,5 %, für
`nur-geld` von −35,5 % bis +53,8 %. Gesichert ist deshalb nur das Vorzeichen und
die Größenordnung von `alles-an` (bei 10, 30 und 60 Läufen +51,5 % / +47,1 % /
+47,0 %); die isolierten Zahlen zwischen −0,2 % und +4,6 % sind von null **nicht**
zu trennen. Wer am Kontaktkatalog, an `ANFRAGE_CHANCE`, an `SHOW_PAY` oder an
`royaltyPerDay` dreht, muss diese Messung wiederholen. (2) **Der Rand ist näher
als bei 5b, und der Hebel hat eine grobe Auflösung.** Die Endeinstellung liegt
7,1 Prozentpunkte unter dem Deckel (5b: 8,8), und `ANFRAGE_CHANCE` lässt sich
unter 0,12 nicht feiner stellen: Drei benachbarte Werte geben bei 60 Läufen
+23,0 %, +25,6 % und +26,9 %, einer davon springt auf +14,0 %. Eine Einstellung
mit mehr Abstand gäbe es also, sie wäre aber nicht besser begründet, sondern nur
weiter weg. Wer den Deckel schärfer braucht, braucht erst einen Hebel mit
feinerer Auflösung. (3) **Gemessen sind zwei
Spielweisen und nicht alle.** „Jede Anfrage am Tag ihrer Zustellung beantworten"
und „jede ablehnen" – **nicht** gemessen ist das Liegenlassen als Spielweise
(es kostet 8 statt 5 Draht und steckt in `alles-ab` nur als die billigere
Variante), nicht der Spieler, der auswählt („Tour ja, Kollabo nein, und zwar
nach der Größe des Partners"), und nicht der, der einen Vertrag vorzeitig
verlässt. (4) **Die Projektarbeit ist eine gewählte Spielweise:** zwei Drücke am
Tag, also vier von 24 Stunden, womit das Kollabo in 5 und die Tour in 6 Tagen
voll ist. Mit **einem** Druck am Tag bräuchte die Tour 12 der 14 Fristtage, und
ein einziger Tag ohne Zeit hätte das Konto verfallen lassen – gemessen wäre dann
die Frist und nicht die Tour. Wie sich das für jemanden rechnet, der nur an
manchen Tagen drückt, ist **nicht** gemessen. (5) **Die Kontaktpflege läuft mit
Partner-Vorrang, und das ist ein Messwerkzeug, keine Empfehlung.** Ohne ihn baut
die freie Wahl aus 5a den Draht zu einem reinen Creator auf, und der ganze
Abschnitt wäre eine stille Null. Was die Gegenanfragen einem Spieler bringen, der
seine Kontakte frei wählt, ist damit **nicht** gemessen – er bekommt vermutlich
weniger, aber „vermutlich" ist keine Zahl. Auch die zwei Stunden Kontaktpflege
selbst sind in **jeder** Variante bezahlt, also nicht Teil der Differenz; was sie
kosten, hat 5a gemessen (−8,3 %). (6) **`SHOW_MIN_LISTENERS` greift in der
Messung nie.** Bis ein Draht für eine Vorgruppe steht, hat der gemessene Spieler
längst mehr als 5.000 Hörer (am Tag der ersten gemessenen Annahme 14.108). Dass
ein Künstler mit 10 Hörern über eine Vorgruppe auf die Bühne kommt, ist also eine
Rechnung – dieselbe wie oben: 65 Gage auch neben Coldplay, und 0 Hörer Zuwachs,
weil der Zuwachs 2 % der eigenen Hörerschaft ist (`src/music.js`, `showGain`) –
und **keine Messung**. (7) **Der Kollabo-Faktor ist in `alles-an` nur bis ×1,069
gemessen** (in der Ausgangseinstellung bis ×1,683, im Kontrollpaar bis ×1,353
bzw. ×1,360), die
Decke ×2,0 steht als Rechnung da. Ein Spieler, der es schafft, mit Coldplay
befreundet zu sein, während er selbst klein ist, ist in keinem gemessenen Jahr
vorgekommen – die Antwortchance dafür ist 2,0 %. **Und die ×2,0 sind nicht die
Decke des Abends, sondern nur einer von zwei Faktoren:** Der Kollabo-Faktor geht
als `audienceFactor` in `simulateRelease`, der 5a-Schub über
`contacts.consumeBoost('release', …)` – und das Album, mit dem das Kollabo
erscheint, VERBRAUCHT diesen Schub wie jedes andere. Die beiden multiplizieren
sich also (`src/music.js`, `publish`: `audienceFactor * … * (kb?.factor ?? 1)`):
×2,0 neben einem Schub ×4 (die Decke von `boostOf`, bei `feature` ×6) ist ×8,0
auf das erreichte Publikum, nicht ×2,0. Wer die Obergrenze dieses Wegs
abschätzen will, rechnet beide Faktoren. **Gemessen ist diese Paarung nicht:**
Die Messung protokolliert den Kollabo-Faktor (Ø 1,037, höchstens ×1,069), aber
nicht, welcher 5a-Schub beim Erscheinen der fünf fertigen Kollabos gerade lag –
der Höchstwert ×8,0 ist also eine Rechnung, genau wie die ×2,0. (8) **5c macht einen alten Vorfall erstmals überall
erreichbar.** „Das Label will verschieben" (`src/data/musicDecisions.js`,
`requires: { contract: true }`) gab es vorher nur in Japan und Korea, weil nur
dort ein Vertrag möglich war. Seine Option „Durchziehen" platzt mit 40 %, und das
kostet 15 Tage Tantiemen: gemessen **−750 am Tag** in `alles-an`
(Ausgangseinstellung −1.823) – ein Posten, den 5c nicht gebaut, aber
freigeschaltet hat. Was diese Zahl **nicht** ist: der Preis des „Durchziehens".
Der gemessene Spieler wählt bei jedem Vorfall eine **zufällige** Option
(`scripts/messung-geldquellen.js:1014`), also ist −750 der Preis des blinden
Antwortens; was ein Spieler zahlt, der gezielt durchzieht oder gezielt nachgibt,
ist nicht gemessen. (9) Der Beef läuft in allen Varianten mit
(`ANZAEHL_CHANCE` 35 %), gleich in jeder – er ist Teil der Grundlage und nicht
Teil der Differenz. Die Kombination „Beef-Sieg **und** Gegenanfrage" ist damit
weiter **nicht** gemessen, genau wie 5b es für die andere Richtung festgehalten
hat. (10) Die Messung ist eine reine Geldfrage; was
die sechs Arten an Spielgefühl und Texten bringen, misst sie nicht. (11) Für
**Musik+Creator** sind die Gegenanfragen damit **keine** Geldquelle in der
Rangfolge oben: −0,4 % gepaart in der Endeinstellung (vor dem Balancing +8,6 %,
36 von 60 Seeds im Plus) – sie kosten ihn so viel Zeit, wie sie einbringen. Für
den **reinen Musiker** sind sie mit +17,9 % der stärkste Einzeleffekt, den dieses
Spiel neben der Veröffentlichungsart kennt, und der Grund ist seine leere Zeit:
Gemessen macht er in jeder Variante **0,00** Kanalaktionen am Tag, Musik+Creator
in `alles-an` **10,31** (ohne Angebote 10,70). Die Gegenanfragen füllen bei ihm
also Stunden, um die nichts anderes konkurriert, und er muss nichts verdrängen.
Wer danach die Rangfolge oben fortschreibt, muss beides nennen – eine Zahl „für
den Spieler" gibt es hier nicht. (12) **Die Vorgruppe trägt keinen einzigen
Faktor des Konzerts, und für manche Künstler ist sie deshalb schlechter als der
Abend, den sie verbraucht.** `gageOf` ist `SHOW_PAY × (meine + extra)^SHOW_EXP`
und sonst nichts: keine `market.scene`, kein `market.deal`, kein `genre.live`,
kein `persona.live`, kein Güte-Wurf, kein Ereignis und kein `liveBonus` eines
Vertrags. Das eigene Konzert (`music.show`) hat sie alle. Beide kosten 4 Stunden,
und beide setzen dieselbe Drei-Tage-Sperre. Gegen die Brutto-Gage des eigenen
Konzerts bei 10.000 Hörern, Güte-Wurf 1, ohne Ereignis, ohne Vertrag und mit
vollem mitgebrachtem Publikum (also am Deckel 2^0,7 = ×1,6245) steht die
Vorgruppe damit bei: **de/pop/face ×1,14** · **de/hiphop/face ×1,19** ·
**us/rock/face ×0,39** · **us/metal/face ×0,36** · **at/indie/anon ×2,41**. Für
einen US-Rocker oder -Metaller ist die Vorgruppe also strikt schlechter als das
Konzert, das sie ihm wegnimmt; für den anonymen Indie-Künstler in Österreich ist
sie mehr als das Doppelte. **Gemessen ist genau ein Punkt dieser Spanne:** Der
Lauf wohnt in Deutschland und spielt Pop mit Gesicht
(`scripts/messung-geldquellen.js`: `home.setHome(G, U, 'de')`,
`music.setup(…, 'pop', PERSONAS[0])`), also die **×1,14** – die vier anderen
Zahlen sind Rechnungen aus `gageOf` und der Gagenformel in `music.show`, keine
Messwerte. Die Formel bleibt trotzdem, wie sie ist: Sie ist die Grundlage der
Messung oben, und an ihr hängt auch, dass `SHOW_MIN_LISTENERS` hier entfallen
darf (65 Gage bei 10 Hörern, auch neben Coldplay). Wer sie anfasst, fährt die
Messung neu. (13) **Ein Vertrag besteuert Honorar und Gage, ohne sie größer zu
machen.** `music.payGig` zieht `kond.cut` von jedem Honorar und jeder Gage ab
(30 % beim Label, 50 % beim Idol), aber `gageOf` und `honorarOf` sehen
`kond.liveBonus` nie – die „größeren Hallen" gelten nur für das eigene Konzert
und für den Tour-Abend, die durch `music.show` laufen. Für §3 ist das die
konservative Richtung (ein Weg mehr, der Geld abgibt, und keiner, der welches
schafft), für den Spieler ist es inkonsistent: Die Patchnote nennt die Vorgruppe
„ein Konzert", und ein Vertragskünstler bekommt dort den Anteil abgezogen und den
Zuschlag nicht. Geändert ist nichts – jede Änderung an `gageOf` oder `honorarOf`
würde die Messung oben ungültig machen –, aber wer die Hallen-Boni einmal
anfasst, fasst diese beiden Stellen mit an.

**Vorfälle bei Musik und Creator (seit 1.42.0, Stück 5f):** Ein Vorfall ist eine
Entscheidung mit Frist – „Plagiatsvorwurf", „Die Platte klackt" –, und sie
hängt jetzt an der **Zeit** statt am Fleiß. `decisions.tick` rechnet faul über
die vergangenen Tage ab und würfelt in derselben Form wie die Firma:
`p(reichweite) = clamp(0,02; 0,08; 0,02 + reichweite/1.500.000 × 0,06)`,
`chance(tage) = 1 − (1 − p)^min(tage, 14)`. Gerufen wird er aus den fauligen
Sammlern, die es schon gibt (`buttons.settleMusic` mit der Hörerzahl,
`buttons.settleCreator` mit `creator.reachTotalOf`), und nur von dort: Für
`music` und `creator` verlangt `decisions.roll` seitdem `schonGewuerfelt` und
wirft sonst einen Fehler, damit neben dem Tageswurf keine zweite Rate entstehen
kann. Dazu vier Vorfälle „vom Anfangen" mit Schwelle 0 und Obergrenze
`FRUEH_MAX` 10.000, und eine Sperre **je Bereich** statt einer im ganzen Spiel.

**Warum es sich geändert hat:** Vorher wurde **je Aktion** gewürfelt – 2 % je
`record`, `publish`, `show` und `creator.act`, Erwartungswert fünfzig Aktionen
bis zum ersten Vorfall. Für einen Gelegenheitsspieler war der ganze Mechanismus
damit unsichtbar, und wer viel klickte, bekam entsprechend mehr – die Rate hing
allein an der Zahl der Aktionen und an nichts sonst. Dazu kamen zwei
Verstärker: Unter 5.000 Hörern war die Kandidatenliste **leer**, der Wurf fiel
ins Leere und die Uhr war trotzdem geschrieben; und `db.openEvent` fragte nur
nach `(guild_id, user_id)`, also sperrte ein einziger offener Vorfall Musik,
Creator **und** Firma gleichzeitig – wobei die Firma am häufigsten feuert.

**Gemessen** (`node scripts/messung-geldquellen.js 60 365 --nur=vorfaelle`,
vollständige Ausgabe in `docs/messungen/2026-10-06-vorfaelle.txt`; Reichweite
festgehalten, 100 Seeds à 365 Tage je Stufe, jeder Vorfall sofort geschlossen –
gemessen ist die Häufigkeit, nicht das Geld):

| Reichweite | Musik | Creator | erwartet mit Sperre | Spec-Tabelle |
| --- | --- | --- | --- | --- |
| 0 (Anfänger) | **6,90 ± 0,24** | **6,89 ± 0,22** | 7,16 | 7,3 |
| 5.000 | 6,99 ± 0,24 | – | 7,23 | 7,4 |
| 10.000 | 7,06 ± 0,24 | – | 7,30 | 7,4 |
| 20.000 | 7,27 ± 0,25 | – | 7,44 | 7,6 |
| 100.000 | **8,44 ± 0,27** | **8,42 ± 0,26** | 8,55 | 8,8 |
| 500.000 | 13,78 ± 0,35 | – | 14,04 | 14,6 |
| 1,5 Mio | **26,43 ± 0,46** | **26,48 ± 0,46** | 27,04 | 29,2 |

**Die Spec-Tabelle ist eine Obergrenze, nicht eine Vorhersage – und das ist der
Grund für jede Abweichung in der letzten Spalte.** Sie ist `365 × p` und nimmt
an, dass jeder der 365 Würfe zählt. Er zählt aber nicht: Jeder Vorfall sperrt
über `MIN_GAP_MS` den Wurf des **folgenden** Tages (ein Wurf je Tag, 24 h sind
weniger als 36 h). Daraus folgt `I = p × (365 − I)`, also **`365p/(1+p)`** – die
Spalte davor, und die trifft die Messung auf 96,3 bis 98,7 % bei höchstens 1,3 σ
Abweichung. Die Herleitung prüft sich selbst: Die Zahl der durchgekommenen
Würfe, die trotzdem nichts gaben, muss `p × Vorfälle` sein, und sie stimmt im
Rahmen des Rauschens (gemessen 206 gegen gerechnet 211,4 bei 1,5 Mio, 11 gegen
13,8 bei null – das sind 20 % zu wenig, auf einer gezählten 11 aber nur 0,75 σ); der
kleinste gemessene Abstand zweier Vorfälle desselben Bereichs ist in **jeder**
Stufe genau 48,0 Stunden, nie 24 und nie 36.

**Ein Anfänger sieht jetzt wirklich welche, und zwar nur die, die zu ihm
passen.** Bei 0 und 2.000 Hörern sind **100 %** der 6,90 bzw. 6,93 Vorfälle frühe
(`proberaum`, `kleiner_auftritt` – die einzigen zwei Kandidaten dort), bei 5.000
und 10.000 die Hälfte (3,51 und 3,56), bei 20.000 **keiner** mehr. Die Grenze
liegt also genau auf `FRUEH_MAX`. Beim Creator sind es bei null 4,71 von 6,89
(68 %), weil `hardware` ebenfalls ab null geht und nach oben offen ist.

**Was es kostet** (60 Läufe à 365 Tage, dieselbe je Archetyp einmal gesuchte
Strategie, eigener fünfter Würfel `rng(1101000+i)` für die Vorfälle, damit „aus"
und „an" denselben Musik- und Kanallauf haben; gepaart je Seed, Zahlen in
`docs/messungen/2026-10-06-vorfaelle.txt`):

| Archetyp | ohne Vorfälle | mit Vorfällen | Mediane / gepaart | Vorfälle/Jahr |
| --- | --- | --- | --- | --- |
| Musik+Creator | 495.099/Tag | 455.123/Tag | −8,1 % / **−7,4 %** | 31,85 |
| nur Musik | 109.717/Tag | 90.810/Tag | −17,2 % / **−16,9 %** | 9,73 |

**Der Deckel von ±25 % hält in beide Richtungen, und `RISK_MAX_DAY` bleibt bei
0,08.** Vorfälle können die Bilanz nach oben *und* nach unten schieben; gemessen
schieben sie sie nach unten, und zwar 7,4 bzw. 16,9 % – der reine Musiker damit
8,1 Prozentpunkte vor dem Auslöser, Musik+Creator 17,6. Die Treppe ist dabei dieselbe Lehre wie bei 5b und 5c: Bei **10**
Läufen stand der reine Musiker bei −22,1 %, bei **30** bei −22,2 %, bei **60**
bei −16,9 %. Wer diese Messung wiederholt und bei 10 Seeds über −25 % landet,
hat nicht die Konstante zu senken, sondern mehr Seeds zu fahren.

**Der Verlust ist fast vollständig eine Wachstumsbremse und kaum eine
Geldsenke** – das ist der Befund, auf den §3 hier ankommt. Der Posten „Vorfall"
im Konto ist winzig: **−559** am Tag beim reinen Musiker von 18.907 Differenz
(3,0 %) und **−3.061** bei Musik+Creator von 39.976 (7,7 %) – die Differenz aus
den Medianen, der Posten als Mittel über die Läufe, also streng genommen nicht
dieselbe Statistik; die Größenordnung ist es. Die anderen 97 bzw. 92 Prozent sind
**alles außer diesem Posten** – überwiegend verlorene Hörer und Follower, die
sich nicht mehr verzinsen (531.018 statt 693.797 Hörer, −23,5 %, beim reinen
Musiker; 4.695.384 statt 6.399.765 Follower, −26,6 %, bei Musik+Creator), aber
nicht nur: Darin stecken auch die Sperren auf Veröffentlichung und Konzert
(`lockRelease`, `lockShow`), verbrauchte Ausrüstung (`gear`), gekürzte Community
und der Vertragsbruch, dessen Strafe `music.leave` unter „Vertragsstrafe" bucht
und nicht unter „Vorfall". Getrennt gemessen sind diese Kanäle nicht; dass sie in
diesem Lauf klein sind, zeigt die Tagesleistung (beim reinen Musiker 0,94
Veröffentlichungen und 0,23 Konzerte je Tag, mit wie ohne Vorfälle), und einen
Vertrag unterschreibt der gemessene Spieler nie. Der §3-Treiber in
`test/musicEvents.test.js` sieht mit anderer Spielweise und anderen Seeds
dasselbe: Hörer-Median 441.957 gegen 568.264, Faktor 0,778.

**Was die Trennung der Sperre bringt** (derselbe Lauf mit und ohne
Bereichsfilter, 100 Seeds à 365 Tage, ein Spieler mit Musik 100.000 Hörer,
Kanälen 100.000 Reichweite und einer Firma der Größe 5;
`docs/messungen/2026-10-06-vorfaelle.txt`): Mit Filter stehen beim Spieler, der
jeden Vorfall am Tag seines Auftretens beantwortet, Musik **8,41**, Creator
**8,93** und Firma **18,16** Vorfälle im Jahr – und zwar gleich, egal welcher
Bereich zuerst würfelt. **Ohne** Filter hängt genau daran, wer sie bekommt:

| ohne Filter, „sofort" | Musik | Creator | Firma | zusammen |
| --- | --- | --- | --- | --- |
| Firma zuerst | 7,35 | 7,60 | 17,42 | 32,37 |
| Musik zuerst | 7,78 | 8,24 | 16,51 | 32,53 |

Der Gewinn der Trennung ist deshalb eine **Spanne über die Würfelreihenfolge** und
keine einzelne Zahl: Musik **+8,1 bis +14,4 %**, Creator **+8,4 bis +17,5 %**,
zusammen +9,1 bis +9,7 %. „Die Firma nahm der Musik die Vorfälle weg" ist damit
wahr und kleiner als die Formulierung klingt – und die Reihenfolge verschiebt nur,
**wer** die Vorfälle bekommt, nicht wie viele es gibt: Die Summe ohne Filter ist
in beiden Reihenfolgen praktisch dieselbe (32,37 gegen 32,53), während die Musik
einmal 1.742 von 36.500 Würfen an einen fremden offenen Vorfall verliert (Firma
zuerst, 4,8 % der Tage) und einmal keinen einzigen (Musik zuerst). Welche
Reihenfolge ein echter Spieler hat, weiß niemand – er öffnet seine Ansichten,
wie er will. **Und die Firma feuert jetzt selbst 4,2 bis 10,0 % häufiger** (18,16
gegen 17,42 bzw. 16,51), weil ein offener Musik- oder Kanal-Vorfall ihre
Abrechnung nicht mehr aufhält; an `company.riskFor` ist nichts geändert.

**Die Sperre durch `openEvent` ist aufschiebend, die durch `MIN_GAP_MS` ist
endgültig.** Wer nie antwortet, hat von der Trennung nichts (bei der Musik
zwischen −0,8 % und +0,9 %, je Würfelreihenfolge, statt der +8 bis +14 % des
Spielers, der antwortet) – und das ist kein Widerspruch, sondern die Reihenfolge im Code: Bricht
`tick` wegen eines offenen Vorfalls ab, wird die Uhr **nicht** geschrieben, der
nächste Wurf deckt zwei Tage und hat die doppelte Chance. `MIN_GAP_MS` greift
dagegen erst **nach** `saveDecisionUhr`, und dieser Wurf ist weg. Gemessen: 5.186
von 36.500 Musik-Tagen ohne Wurf und trotzdem 8,45 gegen 8,53 Vorfälle.

**Die Tür** (`decisions.betreten`) fragt nach der **Benutzung**, nicht nach der
Größe und nicht nach der Existenz einer Zeile: `db.getCreator` legt die
Kanalzeile beim ersten Zugriff an, und `buttons.settleCreator` tut genau das –
ein Blick in die Creator-Ansicht hätte die Tür sonst dauerhaft aufgestoßen.
Gezählt wird `actions`, das allein `creator.act` hochzählt. Gemessen über je 365
Tage mit 100.000 Reichweite im Aufruf: wer nur geschaut hat **0** Vorfälle, wer
eine Musikkarriere und keine Kanalaktion hat **0**, wer wirklich gesendet hat
**8**. Ein reiner Firmenspieler zieht damit keine Creator-Vorfälle mehr; vorher
sammelte `reachTotalOf` sie ihm ein.

**Ehrliche Grenzen:** (1) **Die Streuung ist größer als die Zahl.** Je Seed reicht
die Spanne beim reinen Musiker von −40,7 % bis +5,0 % (5 von 60 Seeds im Plus),
bei Musik+Creator von −29,7 % bis +4,1 % (2 von 60). −16,9 % ist eine Aussage
über sechzig Jahre, nicht über eines. (2) **Der Stufenlauf hält die Reichweite
fest, eine Karriere tut das nicht.** Deshalb sind „14,6 bei 500.000" aus der
Tabelle und „9,73 je Jahr" aus dem Karriere-Lauf kein Widerspruch: Der gemessene
Musiker **erreicht** 531.018 Hörer erst am Jahresende und verbringt die ersten
Monate unter 100.000, wo `p` bei 0,020…0,024 liegt. Wer die Tabelle auf eine
Karriere anwendet, liest die Zahl eines Spielers, der zwölf Monate lang Weltstar
war. (3) **Der gemessene Spieler wählt bei jedem Vorfall eine zufällige Option.**
−16,9 % ist der Preis des blinden Antwortens; was ein Spieler zahlt, der gezielt
wählt, ist nicht gemessen, und wer gar nicht antwortet, zahlt dazu den
Ignorier-Aufschlag von 1,6 auf jeden Verlust. (4) **Im Stufenlauf, in der
Türprobe und im Sperrelauf wird kein Vorfall beantwortet** – jeder wird gezählt
und sofort geschlossen, ohne Wirkung. Gemessen ist dort die Häufigkeit und die
Sperre; was ein Vorfall kostet, misst nur der Karriere-Lauf. (5) **Der
Stufenlauf hat keine aufgenommenen Titel und keinen Vertrag,** also kommen
`album_leak` (braucht 3 Titel) und `label` (braucht einen Vertrag) dort nie vor –
bei 1,5 Mio stehen drei Kandidaten statt fünf. Das ändert, **welche** Vorfälle
gezogen werden, nicht wie viele; leer war die Liste in keiner Stufe. (6) **Der
Firmenwurf im Sperrelauf ist ein Aufruf, keine Firma:** `decisions.roll(…,
'company')` über einen abgerechneten Tag, ohne Lager, Werbung, Löhne und
Entnahme. Für die Sperrfrage genügt das; was ein Firmen-Vorfall kostet, misst der
Firmenlauf. (7) **Die Reihenfolge der drei Würfe ist eine Annahme, und sie trägt
die Überschrift oben** – im Spiel würfelt jeder Bereich, wenn der Spieler seine
Ansicht öffnet. Ohne Filter ändert sie die Zahlen genau da, wo es weh tut: Musik
7,35 (Firma zuerst) gegen 7,78 (Musik zuerst), also **+14,4 % gegen +8,1 %** für
denselben Befund. Deshalb steht er oben als Spanne und nicht als Zahl. Mit Filter
ändert sie nichts, und dass sie es nicht tut, ist eine Kontrollzeile. (8) **Der Tageswurf hängt im Messskript an
`strat.vorfaelle` und läuft nur in diesem Abschnitt.** Die Rangfolge der
Archetypen oben und die Zahlen von 5a, 5b und 5c sind damit **ohne** Vorfälle
gemessen – **anders als vorher.** Vor diesem Stück würfelte jede Aktion
(`git show main:src/music.js` 448/610/867 und `main:src/creator.js:970`), und der
Karriere-Lauf fährt mit `events: true` (`scripts/messung-geldquellen.js:78`) –
Vorfälle kamen also vor, und sie stehen im Ergebnis des letzten Laufs vor diesem
Stück: `docs/messungen/2026-10-02-angebote.txt:439` „· Vorfall -2.791/Tag (-1 %)"
(Musik+Creator) und `:607` „· Vorfall -1.051/Tag (-1 %)" (nur Musik). Entfernt hat
die Würfe je Aktion **Schritt 2 dieses Stücks** (`eab3576`) – nicht Stück 2 des
Projekts, das ist der Firmen-Ausbau. Für die älteren Zahlen heißt das: Sie wurden
**mit** einer Vorfallsbremse von rund 1 % des Tageseinkommens gemessen, die es
jetzt nicht mehr gibt – wer 5a bis 5e heute neu fährt, landet rund ein Prozent
**höher** als das, was hier steht. Und wer sie mit dem Tageswurf fährt, muss beim
reinen Musiker rund 17 % weniger erwarten als die Zahlen oben. (9) **Die
100 Seeds sind in jeder Stufe dieselben,** damit die Stufen vergleichbar sind –
ihre Abweichungen von der Erwartung sind deshalb korreliert, und alle dreizehn
zeigen nach unten. (10) **Die Abwesenheit ist nicht gemessen.** `ROLL_TAGE_MAX`
deckelt das Nachholen auf 14 Tage, und in diesem Lauf greift der Deckel **nie**:
„nachgeholte Tage je Wurf Ø 1,00 (kleinster 1,00, größter 1,00)". Der gemessene
Spieler ist jeden Tag da; was jemand bekommt, der drei Wochen weg war, steht in
`test/decisions.test.js`. **Damit gilt die gemessene Häufigkeit für genau diesen
Spieler:** für den, der täglich zur selben Stunde hereinschaut (Ø 1,00 nachgeholte
Tage je Wurf). `tick` rechnet volle Tage und stellt die Uhr danach auf jetzt, also
fällt der Rest unter 24 Stunden weg – wer seltener oder unregelmäßig kommt,
bekommt entsprechend **weniger** Würfe und damit weniger Vorfälle als die Zahlen
oben. Um wie viel weniger, ist **nicht gemessen**; rein **abgeleitet** (keine
Messung) wären es bei einem Blick alle 36 Stunden 8760 / 36 = 243 Würfe im Jahr
statt 365, bei p = 0,02 also rund 4,9 statt 6,90 Vorfälle. (11) **Der reine
Creator kommt im Geldvergleich nicht vor;** für ihn gilt der Creator-Teil des Stufenlaufs, aber keine Bilanzzahl.
(12) **Die vier frühen Vorfälle haben eine alte Zahl bewegt – die Richtung ist
gemessen, die Größe nicht.** Der §3-Treiber in `test/musicEvents.test.js` ging mit
ihnen von Σ **41** auf Σ **47** über fünf Jahre (dieselben fünf Seeds, in
Wegwerf-Arbeitsbäumen an `e4582dc` und `9c3e97f` gefahren). Fünf Seeds tragen
daraus nur das Vorzeichen: Je Seed lauten die Zahlen 6→6, 8→**7**, 7→11, 11→16,
9→**7** – zwei von fünf gehen nach **unten**, die Sprünge sind ±5, und das
Poisson-Rauschen auf einer Summe dieser Größe liegt allein schon bei ±7. Die +6
ist damit von 0 nicht zu trennen, erst recht nicht von 5 × 0,65 = 3,25; und
würfelpaarig sind die zwei Läufe ohnehin nicht, weil jeder Vorfall die Hörerkurve
verschiebt und damit jede folgende Rate. **Was wirklich null ist, ist der Verlust
an die leere Kandidatenliste:** 0 leere Würfe mit Grund „kein Kandidat" in allen
dreizehn Stufen, und bei Reichweite 0 stehen zwei Kandidaten bereit. **Und was
seine Größe ist, zählt der Karriere-Lauf aus:** 44 von 584 Vorfällen des reinen
Musikers fielen bei 10.000 Hörern oder darunter (0,73 je Jahr), und **30 davon
unter 5.000** – genau die Würfe, die vorher ins Leere fielen: **0,50 je Jahr**,
über fünf Jahre also 2,5. Die +6 des Tests ist mehr als das Doppelte davon, und
genau daran sieht man, dass sie Rauschen ist und keine Rate.

### Beziehungen: zwei Achsen statt einer Zahl (seit Stück 6a, 2026-10-08)

Der Draht zu einem Kontakt ist nicht mehr gespeichert, sondern **abgeleitet**:
`Math.round((respekt + vertrauen) / 2)`. Gespeichert sind **Respekt** (wie ernst
er dich nimmt) und **Vertrauen** (ob er sich auf dich verlässt). Respekt öffnet
die Antwort eines Großen, Vertrauen die mehrtägigen Formate.

**Gemessen (`docs/messungen/2026-10-08-beziehungen.txt`, 30 Läufe à 365 Tage,
Median, gegen `main` bei 03aaf92):** Kontaktpflege liefert **−0,9 %**
(Musik+Creator), **−0,6 %** (nur Creator) und **−2,8 %** (nur Musik). Der
Auslöser von +25 % ist nicht ausgelöst, und die größte Abweichung geht nach
unten. Dieses Stück ist eine Umverteilung des **Zugangs**, keine Geldquelle:
`staerkeOf` und `boostOf` sind unangetastet, die Höhe eines Schubs hängt weiter
am rohen Größenabstand.

**Die Gegenprobe, die den Vergleich trägt:** Ein Messlauf **ohne** Kontakte ist
zwischen `main` und dem Zweig ziffernidentisch (493.618 / 557.305 / 108.493 pro
Tag). Das Stück fasst nur Kontakte an, ein Lauf ohne sie *muss* gleich bleiben –
und ohne diese Zeile wäre der Rest Behauptung. Ein erster Auswertungsversuch war
daran gescheitert: 38 verglichene Zeilen, alle +0,0 %, weil es die
Release-Strategietabelle war und nicht die Kontaktvarianten.

**Der Riegel gegen das Dauer-Beefen hält erst seit dem Dämpfer.** Der additive
`VERTRAUEN_MALUS` sättigt bei −0,25, während der Respekt-Term bis 0,45 läuft:
Acht gelandete Disse (Respekt 68, Vertrauen −100) kamen auf **12,5 %**
Antwortchance gegen 6,9 % beim Fremden, zwölf auf 21,5 %. Und `stufeVon` wog die
Zusage am Respekt, ohne Vertrauen zu lesen – das Zusage-Gewicht stieg dauerhaft
auf 1,68 und mit ihm der Schub je Antwort, also der **Ertrag**. Seit
`respektWirkt(respekt, vertrauen) = max(0, respekt) × (1 + min(0, vertrauen/100))`
landet derselbe Spieler auf `CHANCE_MIN`; bei Vertrauen ≥ 0 ist der Faktor 1 und
keine der zehn Chance-Sollwerte ändert sich. Der Rivale behält 80 % seines
Vorteils.

**Ehrliche Grenzen:**

1. **Das Tor für Album, Tour und Label bleibt bei Vertrauen 50 – als bewusste
   Übersteuerung der ersten Hälfte des eigenen Auslösers.** Wer auf einen
   Partner zielt, erreicht es mit 100 % (so sicher wie früher Draht 50); bei
   freiem Spiel mit 20 bis 43 % gegen vorher 50 bis 70 %. Die zweite, härtere
   Hälfte besteht deutlich: **234 Touren und 72 Alben** sind im Messjahr fertig
   geworden. Die Senkung bei freiem Spiel ist die beabsichtigte Umverteilung –
   mehrtägige Formate verlangen jetzt Absicht statt Zufall.
2. **Eine der zehn Beziehungsarten ist Dekoration.** `band` („gemeinsame
   Vergangenheit") kommt in **keinem** der beiden Läufe ein einziges Mal vor,
   obwohl 72 Mal ein Boden von 10 gesetzt wurde. Ursache ist die Reihenfolge in
   `contacts.artOf`: `band` steht **unter** den warmen Arten, nach einem
   fertigen Album ist die Beziehung aber warm (Respekt +6, Vertrauen +18), also
   gewinnt `partner`. Erreichbar, aber nicht im Messhorizont. `rivale` kommt vor
   und ist keine Dekoration; `mentor` ist dünn (1 von 30 Konten).
3. **Im Band Vertrauen 0 bis +36 hebt ein gelandeter Diss den Zugang noch** um
   bis zu 4,5 Punkte, weil positives Vertrauen für die Chance wertlos ist –
   genau die Regel wird dort zum Schlupfloch. Erschöpfend durchgerechnet über
   alle 201 × 201 Achsenpaare; Obergrenze +0,045 Chance je 36 wieder aufgebauter
   Vertrauenspunkte. Ein echter Tausch: Wer so fährt, hält das Vertrauen bei
   Null und verliert Kollabo, Tour, Label und den Partnerstatus (alle ab 50).
4. **Der Dämpfer verdoppelt die Strafe legitimer Rückschläge.** Beim
   Weltstar-Partner kostet **eine** verfallene Gegenanfrage 10,0 Chancenpunkte
   statt 4,8. Gemessen trifft es gute Beziehungen selten: In fünf von sechs
   Varianten null Tage mit einem eingebrochenen Partner, in einer 1 von 30
   Konten mit 42 Tagen. Selbstheilend, 3 Punkte je Woche.
5. **Der Paritätstest beweist die Buchführung, nicht das Spielverhalten.** Bei
   gleichmäßiger Spaltung ist die neue Kette ziffernidentisch zur alten – aber
   mit den echten Paaren laufen sie auseinander, und das ist Absicht: Zwanzig
   echte Antworten ergaben früher Draht 100, jetzt 80 (Respekt sättigt bei 100,
   Vertrauen steht bei 60).

**Der Kollabo-Befund aus 5c war falsch formuliert.** Dort steht „das
Kollabo-Album ist nicht spielbar". Gemessen: **Jedes** der 215 verfallenen
Kollabos hatte die 18 von 18 Stunden **voll** und durchschnittlich 0,2 bis 0,3
Titel von sechs geforderten. Die zwei Spielweisen, die Titel **horten**, schaffen
72 von 72. Richtig ist: Das Kollabo ist **unverträglich mit dem täglichen
Single-Release**, und das Spiel sagt es nicht – man zahlt erst 18 Stunden und
erfährt den Grund (`no_songs`) danach. Spielregel aus 5c, in 6a nicht angefasst.

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
