# Fluxer-Version

Dieser Branch (`fluxer`) lässt denselben Bot auf **[Fluxer](https://fluxer.app)** laufen.
Zwei Dinge sind dort anders als auf Discord – alles andere ist identisch.

## 1. Die Wirtschaft gehört jetzt dem Bot

Auf Fluxer gibt es **kein UnbelievaBoat**, also liegt das Geld lokal in der SQLite-Datenbank
([`wallet.js`](src/wallet.js), Tabellen `wallets` und `wallet_log`).

Der Austausch beschränkt sich bewusst auf **eine Datei**: [`unb.js`](src/unb.js) behält
Namen und Signaturen und reicht nur noch an das lokale Wallet weiter. Dadurch laufen die
13 Module, die Geld buchen (Käufe, Miete, Jobs, Casino, Auktionen …), **unverändert** –
und Merges von `main` bleiben konfliktfrei.

**Buchhalterische Grundregel** (per Test abgesichert in [`test/wallet.test.js`](test/wallet.test.js)):

```
cash + bank  ==  Startkapital + Summe aller changeCash-Buchungen
```

Umbuchungen zwischen Bank und Bargeld verändern die Summe **nie**. Wäre das anders, wäre
das Wallet selbst ein Gelddrucker – genau das, was ARCHITEKTUR.md §3 verbietet.

Zusätzlich gibt es `!daily` ([`income.js`](src/income.js)) als kleinen Einstieg, damit
niemand ohne Startkapital feststeckt. Das eigentliche Verdienen läuft weiter über das
Arbeitsamt (`!work`).

## 2. Bedienung ohne Buttons

**Fluxer hat noch keine Message-Components.** Nachgeprüft am installierten SDK
(`@fluxerjs/core` 2.2.0): 52 Gateway-Events, **kein `InteractionCreate`**, und als Builder
nur `EmbedBuilder`/`AttachmentBuilder` – kein `ButtonBuilder`. Fluxers eigene Roadmap führt
Components, Modals und Slash-Commands als *geplant*. Ohne `InteractionCreate` könnte ein Bot
von einem Klick ohnehin nie erfahren.

Deshalb **Hybrid-Bedienung**:

| | |
|--|--|
| **Textbefehle** | öffnen Ansichten und führen direkte Aktionen aus (`!menu`, `!shop 2`, `!kaufen 42`) |
| **Reaktionen** | bedienen das offene Menü (◀️ ▶️ 🏠 zum Navigieren, 1️⃣–9️⃣ zum Auswählen) |

Die Übersetzung macht [`render.js`](src/fluxer/render.js): Es nimmt die **unveränderten**
Ansichten aus `ui.js`/`menu.js` (deren discord.js-Builder sind reine JSON-Erzeuger ohne
Netzwerk), rendert das Embed und hängt pro Button eine Reaktion an – samt Legende.

Damit die Handler aus [`buttons.js`](src/buttons.js) **unverändert** weiterlaufen, baut
[`interaction.js`](src/fluxer/interaction.js) ein Objekt, das sich wie ein Discord-
`interaction` verhält (`deferUpdate`, `editReply`, `update`, `followUp` …).

Welche Reaktion welche Aktion auslöst, steht in der Tabelle `fluxer_views` – dadurch
funktionieren offene Menüs **auch nach einem Neustart** weiter, genau wie die zustandslosen
Button-IDs im Original (ARCHITEKTUR §6).

### Zwei Einschränkungen, die Fluxer aufzwingt
- **Keine privaten Antworten** („ephemeral"): Rückmeldungen erscheinen als normale
  Nachricht mit Erwähnung im Kanal.
- **Keine Modals**: Wo das Original ein Eingabefenster öffnet (eigener Casino-Einsatz,
  Auktionsgebot, Profil-Spruch), fragt der Bot im Chat nach und wartet auf die Antwort
  ([`prompt.js`](src/fluxer/prompt.js)).

**Kommen später echte Buttons**, werden nur `render.js` und `interaction.js` ersetzt –
Ansichten und Spiellogik bleiben unberührt.

## Starten

```bash
npm install
cp .env.example .env      # FLUXER_TOKEN eintragen
npm test                  # alle Suites, inkl. Wallet und Darstellung
npm run start:fluxer
```

## Befehle

`!hilfe` · `!menu` · `!shop [seite]` · `!garage` · `!geld` · `!profil` ·
`!daily` · `!work` · `!jobs` · `!kaufen <id>`

Die Liste in [`commands.js`](src/fluxer/commands.js) erzeugt die Hilfe automatisch – ein
neuer Befehl taucht dort von selbst auf.

## Was noch fehlt

Portiert ist das Fundament (Hauptmenü, Shop mit Detail und Kauf, Garage, Guthaben, Profil,
Einkommen). Immobilien, Casino, Postfach, Auktion und Rangliste sind über dieselben
Bausteine anzuschließen: Befehl in `commands.js` ergänzen, der Rest funktioniert bereits.
