# Duo-Version: Discord + Fluxer in einem Prozess

Dieser Branch (`duo`) führt beide Versionen zusammen: **ein Prozess, eine
Hosting-Instanz, ein Backup** – und **gemeinsamer Fortschritt** über beide
Plattformen (Cross-Progression).

```bash
npm run start:duo
```

Fehlt eines der Tokens, startet die jeweils andere Seite trotzdem. Die
Einzelstarts (`npm start`, `npm run start:fluxer`) funktionieren weiterhin.

## Wie der gemeinsame Fortschritt funktioniert

Die gesamte Spiellogik arbeitet mit `(guildId, userId)` und behandelt beides als
undurchsichtige Zeichenketten. Genau das nutzt [`identity.js`](src/identity.js):
An der **Außengrenze** werden die Plattform-IDs auf ein gemeinsames Paar übersetzt.

```
Discord (Server 561…, User 498…)  ┐
                                   ├──►  (WELT, KONTO)
Fluxer  (Server abc,   User xyz)  ┘
```

Dadurch bleibt die komplette Spiellogik **unverändert** – sie merkt nicht einmal,
dass es zwei Plattformen gibt.

| Begriff | Bedeutung |
|--|--|
| **Welt** | Alle Server teilen sich eine (`WORLD_ID`). |
| **Konto** | Die Discord-User-ID. Fluxer-Spieler ohne Verknüpfung bekommen `fx:<id>`. |

Übersetzt wird an genau zwei Stellen: [`bridge.js`](src/bridge.js) hüllt das
Discord-Interaction ein, [`fluxer/index.js`](src/fluxer/index.js) übersetzt die
Fluxer-Nachrichten.

> ⚠️ **`WORLD_ID` muss auf deine bestehende Discord-Server-ID zeigen**, sonst
> liegt der alte Spielstand unter einer anderen Welt und wirkt verschwunden
> (er ist es nicht). Der Bot warnt beim Start, wenn die Variable fehlt.

## Geld: UnbelievaBoat bleibt die Wahrheit

Cross-Progression braucht **eine** Geldquelle. [`unb.js`](src/unb.js) entscheidet
deshalb pro Konto:

| Konto | Geld liegt bei |
|--|--|
| Discord-Konto (auch verknüpfte Fluxer-Spieler) | **UnbelievaBoat** – der echte Kontostand bleibt erhalten, `!bal` und `!work` stimmen weiter |
| Fluxer-Spieler **ohne** Verknüpfung | lokales Wallet (Zwischenstand) |

Beim Verknüpfen wandert der Zwischenstand einmalig zu UnbelievaBoat.

## Konten verknüpfen

Bewusst **ohne Bestätigungscode** – es braucht nur eine Plattform, weil nicht
jeder noch Zugriff auf sein Discord-Konto hat.

**Auf Fluxer:**
```
!link <deine-discord-id>     verknüpfen (Fortschritt wird übernommen)
!konto                       Status anzeigen
!unlink                      Verknüpfung aufheben
```

**Auf Discord:** `/konto` zeigt die eigene ID und die verknüpften Fluxer-Zugänge.

**Admins** (IDs in `BOT_ADMINS`, kommagetrennt) können fremde Verknüpfungen
korrigieren: `!link <fluxer-user> <discord-id>` bzw. `!unlink <fluxer-user>`.

### Was beim Verknüpfen passiert
Alles wandert in einer Transaktion hinüber: Besitz (Mengen werden addiert,
Zustände bleiben), Level und Statistik (werden **addiert**, nicht überschrieben),
Sammlung, Inserate, Mietverhältnisse, Postfach, Gebote.

Zwei bewusste Entscheidungen:
- **Erfahrung wird addiert**, nicht überschrieben – niemand verliert seinen Fortschritt.
- **Schulden wandern mit.** Würde ein negativer Stand erlassen, entstünde Geld
  aus dem Nichts (ARCHITEKTUR §3). Der Übertrag zählt umgekehrt **nicht** als
  Einnahme, sonst gäbe es Erfahrung doppelt für dasselbe Geld.

Beides ist in [`test/accounts.test.js`](test/accounts.test.js) abgesichert.

## Konfiguration

```env
WORLD_ID=<deine-discord-server-id>   # WICHTIG: bewahrt den bestehenden Spielstand
DISCORD_TOKEN=…
DISCORD_CLIENT_ID=…
UNB_TOKEN=…
UNB_GUILD_ID=<deine-discord-server-id>
FLUXER_TOKEN=…
BOT_ADMINS=<deine-discord-id>
```

## Bank: Geld vor Überfällen schützen

UnbelievaBoats `!rob` nimmt nur **Bargeld** – wer sein Geld auf der Bank hat, ist
sicher. Auf Discord erledigen das UnbelievaBoats eigene Befehle; Fluxer-Spieler
hatten diese Möglichkeit nicht und konnten sich gegen einen Überfall aus Discord
nicht wehren. Deshalb gibt es auf Fluxer:

```
!einzahlen <betrag|alles>    Bargeld auf die Bank (geschützt)
!abheben  <betrag|alles>     von der Bank zurück ins Bargeld
```

[`banking.js`](src/banking.js) arbeitet über dieselbe Geldschnittstelle wie alles
andere – also automatisch mit der richtigen Quelle (UnbelievaBoat bei verknüpften
Konten, lokales Wallet bei den übrigen). Umbuchungen verändern das
Gesamtvermögen nie; das prüft [`test/banking.test.js`](test/banking.test.js) unter
anderem mit 200 zufälligen Buchungen.

## Währungssymbol auf Fluxer

Kommt das Symbol von UnbelievaBoat, ist es ein **Discord**-Emoji
(`<:Rubine:1067…>`) – dessen ID kennt Fluxer nicht, dort stünde nur roher Text.
Trage das Fluxer-Gegenstück ein:

```env
FLUXER_CURRENCY_SYMBOL=<:Rubine:DEINE-FLUXER-EMOJI-ID>
```

Ohne Eintrag wird auf den bloßen Namen zurückgefallen (lesbar statt kaputt).
Übrige Discord-Emojis werden ebenfalls durch ihren Namen ersetzt.

## Kanal-Brücke: gemeinsamer Chat über beide Plattformen

Discord kennt keine **ausgehenden** Webhooks – man kann sich nicht benachrichtigen
lassen, wenn dort etwas passiert. Man braucht einen Bot, der mitliest. Genau den
gibt es hier: Im duo-Prozess sind beide Clients gleichzeitig offen, also spiegelt
[`relay.js`](src/relay.js) direkt zwischen ihnen – **ohne Webhook**.

**Variante A – ein Kanalpaar:**
```env
RELAY_DISCORD_CHANNEL=<discord-kanal-id>
RELAY_FLUXER_CHANNEL=<fluxer-kanal-id>
```

**Variante B – der ganze Server:**
```env
RELAY_ALL=true
RELAY_EXCLUDE=admin,intern          # bleibt privat
RELAY_MAP=<dcId>:<fxId>             # Ausnahmen mit abweichendem Namen
```

Bei Variante B werden die Gegenstücke **über den Kanalnamen** gefunden – man muss
also kein Paar von Hand eintragen. Verglichen wird nur nach Buchstaben und
Ziffern, `💰┃economy` findet also `economy`. Kanäle ohne Gegenstück auf der
anderen Seite werden einfach übersprungen. Auf Discord ist zusätzlich das
**Message Content Intent** erforderlich (Developer Portal → Bot), sonst kommen
die Nachrichten ohne Text an.

Gespiegelt wird **alles im Kanal**, in **beide Richtungen** – auch Bot-Ausgaben
wie UnbelievaBoats Auszahlungen und Überfälle. Embeds werden in lesbaren Text
umgewandelt, Anhänge als Verweis angehängt, überlange Nachrichten gekürzt.
Erwähnungen lösen drüben bewusst **keinen Ping** aus.

**Schleifenschutz:** Die eigenen Nachrichten des Bots werden nie gespiegelt.
Ohne diese Regel würde jede weitergeleitete Nachricht drüben erneut weitergeleitet
und beide Kanäle wären in Sekunden geflutet – [`test/relay.test.js`](test/relay.test.js)
sichert das ab.

## Überfall und Rollen-Einkommen

UnbelievaBoats Befehle lassen sich für Fluxer-Spieler **nicht auslösen**: Die API
kennt keine Befehlsausführung, und eine gespiegelte Nachricht stammt vom Bot,
nicht vom Spieler – UnbelievaBoat würde sie ignorieren oder auf das Konto des
Bots anwenden. Deshalb sind beide Funktionen nachgebaut. Sie wirken über
`changeCash` auf **dieselben** UnbelievaBoat-Konten und funktionieren damit auf
beiden Plattformen gleich.

```
!rob <@spieler>       jemanden ausrauben
!einkommen            Rollen-Einkommen abholen
```

**Überfall** ([`robbery.js`](src/robbery.js)): Nur **Bargeld** ist erbeutbar – wer
einzahlt, ist sicher. Höchstens 30 % vom Bargeld des Opfers, Opfer unter 500
sind geschützt, 2 h Cooldown. Die Erfolgschance sinkt, je größer die Beute im
Verhältnis zum eigenen Bargeld ist. Bei Misserfolg zahlt der Räuber Schmerzensgeld
**an das Opfer**.

Zwei bewusste Entscheidungen, beide getestet:
- **Reine Umverteilung.** Was der eine bekommt, verliert der andere – auf den
  Cent, auch bei Misserfolg. Über 60 Überfälle bleibt die Summe exakt gleich.
- **Keine Erfahrung.** Sonst könnten sich zwei Spieler gegenseitig ausrauben und
  daraus endlos Erfahrung erzeugen.

**Rollen-Einkommen** ([`roleIncome.js`](src/roleIncome.js)):
```env
INCOME_ROLES=<rollen-id>:500,<rollen-id>:1500
INCOME_INTERVAL_HOURS=24
```
Die Rollen liest der **Discord**-Client – auch für Fluxer-Spieler, sofern ihr
Konto verknüpft ist. Genau dafür ist der duo-Betrieb gut: Beide Clients laufen im
selben Prozess. Ohne Verknüpfung gibt es keine Rollen und damit kein Einkommen –
ein guter Anreiz für `!link`.

## Werkstatt: beschädigte Autos wieder aufbauen

Autos, die draußen stehen, verlieren über Nacht Zustand – und damit Wert
([`street.js`](src/street.js)). Bisher war das eine **Einbahnstraße**: einmal
zerkratzt, für immer zerkratzt. Die Werkstatt dreht das um, gegen Geld.

```
!werkstatt          beschädigte Autos auflisten (auch !reparieren)
!werkstatt <seite>  weiterblättern
```

Auf Discord zusätzlich als `/werkstatt` (mit `auto:<id>` direkt zum
Kostenvoranschlag). Aus der Garage führt ein Knopf direkt hinüber, sobald dort
etwas Beschädigtes steht.

Man wählt ein **Ziel**, keinen Betrag – die Stufen sind dieselben, die der
Spieler aus der Zustandsanzeige schon kennt:

| Stufe | Ziel | Aufschlag |
|--|--|--|
| 🧽 Aufbereitung | 55 % (😐 Gebraucht) | ×1,04 |
| 🔧 Instandsetzung | 80 % (🙂 Gut) | ×1,07 |
| ✨ Restaurierung | 100 % (✨ Neuwertig) | ×1,09 |

Der Preis ist der **Wertzuwachs mal Aufschlag plus Werkstattpauschale**
(0,5 % vom Neupreis, mindestens 150), **gedeckelt auf den Neupreis**. Der
Aufschlag steigt mit dem Ziel: die letzten Prozente sind – wie in echt – die
teuersten. Der Deckel ist nötig, weil ein Schrotthaufen nur noch 30 % wert ist:
ohne ihn käme bei einer Restaurierung eine Rechnung über dem Neuwagenpreis
heraus. Die Regel oben kann er nicht verletzen – der Zeitwert liegt immer unter
dem Neupreis, der Zuwachs erst recht.

**Warum die Rechnung trotzdem hoch aussieht.** Das Teure ist nicht die Marge,
sondern der **Wertzuwachs selbst**: Ein Wagen im Restwert (30 %) auf 100 % zu
bringen holt bis zu 70 % des Neupreises zurück, und so viel muss die Rechnung
mindestens tragen. Die Aufschläge liegen deshalb nur noch knapp über 1 – viel
weiter lässt sich der Preis nicht senken, ohne die Regel oben zu brechen.

**Reparieren ist bewusst nie ein Geschäft.** Ohne den Aufschlag wäre die
Werkstatt ein Gelddrucker (ARCHITEKTUR §3): Schrottwagen billig kaufen,
reparieren, zum Zeitwert verkaufen, Gewinn. Weil die Rechnung immer über dem
Wertzuwachs liegt, kauft man Erhalt, Prestige und einen höheren
Wiederverkaufspreis – aber nie Gewinn. Über 15 000 zufällige Kombinationen aus
Preis, Zustand und Stufe prüft
[`test/workshop.test.js`](test/workshop.test.js), dass die Kosten den Zuwachs
nie unterschreiten – dazu jede Kombination für Autos bis 6 000 einzeln, weil
dort die Pauschale und der Deckel am schwersten wiegen.

Zwei weitere bewusste Entscheidungen, ebenfalls getestet:
- **Erst der Zustand, dann das Geld.** Der neue Zustand wird gesetzt, *bevor*
  die erste `await`-Buchung läuft – ein zweiter schneller Klick findet den
  Wagen schon repariert vor und wird abgewiesen (ARCHITEKTUR §7). Scheitert
  danach die Geldbuchung, wird der alte Zustand zurückgeschrieben.
- **Bank zählt mit.** Reicht das Bargeld nicht, wird der fehlende Teil von der
  Bank geholt – wie beim Autokauf.

[`workshop.js`](src/workshop.js) bucht über dieselbe Geldschnittstelle wie
alles andere und funktioniert damit auf beiden Plattformen gleich.

## Geld-Rangliste (!top)

Hier liegt der Fall **anders als bei `!rob`**: Die Rangliste lässt sich über die
API wirklich **lesen** (`getGuildLeaderboard`), sie wird also nicht nachgebaut,
sondern geholt – ein Aufruf statt einer Abfrage je Spieler.

```
!top            nach Gesamtvermögen
!top bar        nach Bargeld
!top bank       nach Bankguthaben
```

Auf Discord zusätzlich als `/top`. Die Ansicht lässt sich per Knopf umschalten.

Ergänzt wird die Liste um die **Fluxer-Spieler ohne Verknüpfung**: Deren Geld
liegt im lokalen Wallet, UnbelievaBoat kennt sie nicht – ohne diese Ergänzung
würden sie fehlen, obwohl sie mitspielen. Verknüpfte Konten stehen nur einmal
drin.

Nicht zu verwechseln mit `!rangliste`: Die zeigt Level, Einnahmen, Ausgaben und
Gesamtvermögen aus unseren eigenen Daten. `!top` ist die reine Geldliste.

## Grenzen
- **Ein Prozess:** Ein harter Absturz betrifft beide Bots. Unbehandelte Fehler
  werden abgefangen, aber die Trennung zweier Instanzen ist robuster.
- **Verknüpfung ohne Prüfung:** Wer eine fremde Discord-ID einträgt, bekommt
  Zugriff auf deren Spielstand. Bewusste Entscheidung für die Freundesgruppe;
  ein Admin kann jede Verknüpfung aufheben.
- **Erwähnungen:** Fluxer kann Discord-IDs nicht auflösen. In Ansichten wird
  deshalb der gemerkte Anzeigename gezeigt.
