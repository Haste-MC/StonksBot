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

```env
RELAY_DISCORD_CHANNEL=<discord-kanal-id>
RELAY_FLUXER_CHANNEL=<fluxer-kanal-id>
```

Beide IDs nötig, sonst bleibt die Brücke aus. Auf Discord ist zusätzlich das
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

## Grenzen
- **Ein Prozess:** Ein harter Absturz betrifft beide Bots. Unbehandelte Fehler
  werden abgefangen, aber die Trennung zweier Instanzen ist robuster.
- **Verknüpfung ohne Prüfung:** Wer eine fremde Discord-ID einträgt, bekommt
  Zugriff auf deren Spielstand. Bewusste Entscheidung für die Freundesgruppe;
  ein Admin kann jede Verknüpfung aufheben.
- **Erwähnungen:** Fluxer kann Discord-IDs nicht auflösen. In Ansichten wird
  deshalb der gemerkte Anzeigename gezeigt.
