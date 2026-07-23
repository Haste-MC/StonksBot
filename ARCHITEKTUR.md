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

**Diese Grenzen werden per Monte-Carlo-Test bewiesen, nicht behauptet.** Wenn
du etwas baust, das Geld auszahlt, schreib einen Test, der über viele tausend
Durchläufe zeigt, dass die Bilanz nicht positiv kippt (siehe
`test/buyers.test.js`, `test/casino.test.js`, `test/tenants.test.js`).

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
