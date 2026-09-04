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
(`<:Rubine:1067…>`) – Name **und ID**. Die ID gilt nur auf Discord; Fluxer zeigt
davon nur Rohtext (`:Rubine:`). Trage das Fluxer-Gegenstück ein:

```env
FLUXER_CURRENCY_SYMBOL=<:Rubine:DEINE-FLUXER-EMOJI-ID>
```

Die Schreibweise ist nachsichtig – `<:Rubine:154…>`, `Rubine:154…` oder auch
nur die **ID** werden angenommen und in die Form gebracht, die Fluxer im Text
versteht (`<:Name:ID>`). Bei einer nackten ID wird der Name ergänzt; gerendert
wird ohnehin über die ID.

Ohne Eintrag steht dort **🪙** – eine Münze ist überall darstellbar. Übrige
Discord-Emojis werden durch ihren Namen ersetzt (`<:check:456>` → „check").

Übersetzt wird an **einer** Stelle, [`fluxer/emoji.js`](src/fluxer/emoji.js),
und die hängt an allen Ausgabewegen:

| Weg | Beispiel |
|--|--|
| Embeds (Menüs) | Autohaus, Garage, Rangliste |
| Textantworten | `!daily`, `!einzahlen`, Kaufbestätigungen |
| Meldungen aus den Button-Handlern | Miete abgebucht, Auto gestohlen, Zuschlag |
| Kanal-Brücke | UnbelievaBoats eigene Nachrichten aus Discord |

Vorher hing die Übersetzung nur an den Embeds – deshalb stimmte das Symbol im
Menü, während direkt daneben `:Rubine: 275` stand. In der Gegenrichtung gilt
dasselbe: Ein Fluxer-Emoji wird auf Discord zum echten Discord-Emoji
(Währung) bzw. zu seinem Namen, statt als fremde ID zu zerbrechen.
[`test/fluxer-render.test.js`](test/fluxer-render.test.js) und
[`test/relay.test.js`](test/relay.test.js) prüfen beide Richtungen.

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

### Erwähnungen

`<@12345>` schreiben beide Plattformen gleich – aber die ID gilt nur dort, wo
sie herkommt. Ungefiltert gespiegelt zeigte Discord deshalb
**@unbekannter-Benutzer** und Fluxer eine tote Zahl.
[`fluxer/mentions.js`](src/fluxer/mentions.js) übersetzt in drei Stufen:

| | Ergebnis |
|--|--|
| Konto ist **verknüpft** (`!link`) | echte Erwähnung der Gegenseite, mit Pill und Farbe |
| **Eindeutiger Namenstreffer** | ebenfalls echte Erwähnung – auch ohne `!link` |
| sonst | der Name als Text: `@Diabilon` |

Rollen (`<@&…>`) und Kanäle (`<#…>`) gibt es drüben gar nicht; sie werden zu
ihrem Namen, damit keine kaputte Klammer stehen bleibt. Gepingt wird nie:
Die Brücke setzt in beide Richtungen `allowedMentions: { parse: [] }`. Die
Erwähnung soll lesbar sein, nicht jemanden aus dem Bett klingeln.

### Unter dem Namen des Absenders (Webhooks)

Eine gespiegelte Nachricht erscheint drüben mit **Name und Avatar des
Absenders**, nicht als `🔵 **Kevin:** Hallo` vom Bot. Beide Plattformen
erlauben das beim Ausführen eines **Webhooks**: Name und Avatar lassen sich pro
Nachricht überschreiben.

```env
RELAY_WEBHOOKS=false            # abschalten, dann wieder die Textform
RELAY_WEBHOOK_NAME=Kanal-Brücke # Name des Webhooks (nur in den Einstellungen sichtbar)
RELAY_NAME_SUFFIX= (Fluxer)     # optionaler Zusatz hinter dem Namen
RELAY_IGNORE_WEBHOOKS=true      # Nachrichten fremder Webhooks nicht spiegeln
```

Auf Discord braucht der Bot dafür das Recht **„Webhooks verwalten"**. Fehlt es,
spiegelt die Brücke weiter in der alten Textform – lieber sichtbar als schön.
Getäuscht wird dabei niemand: Beide Plattformen hängen an Webhook-Nachrichten
ihr **BOT-Abzeichen**.

Drei Dinge, die dabei leicht schiefgehen:

- **Den Token gibt es nur einmal** – beim Anlegen. Fluxer gibt ihn später nicht
  mehr heraus („fetched webhooks cannot execute"), deshalb liegt er in der
  Tabelle `relay_webhooks`. Ohne das bräuchte jeder Neustart einen neuen
  Webhook, bis der Kanal ins Webhook-Limit läuft.
- **Der Schleifenschutz musste erweitert werden.** Eine Webhook-Nachricht
  trägt nicht die Bot-ID, sondern die des Webhooks – die alte Prüfung „ist das
  unser Bot?" hätte nicht mehr gegriffen, und jede Spiegelung wäre sofort
  zurückgespiegelt worden. Der Bot merkt sich deshalb die IDs seiner eigenen
  Webhooks; [`test/relay.test.js`](test/relay.test.js) sichert genau das ab.
- **Zweite Brücke im selben Kanal?** Läuft dort noch ein anderer Bridge-Bot,
  sehen sich beide gegenseitig als „echte" Nutzer und schaukeln sich hoch.
  `RELAY_IGNORE_WEBHOOKS=true` ignoriert alles, was von einem Webhook kommt.

Der Anzeigename wird plattformtauglich gemacht: höchstens 80 Zeichen, kein
`@everyone`, und „discord"/„clyde" darf laut Discord nicht im Webhook-Namen
stehen (ein abgelehnter Name würde die ganze Nachricht verschlucken).

**Ein Gesicht für beide Plattformen.** Wer über `!link` verknüpft ist, tritt in
der Brücke immer mit **Name und Avatar seines Discord-Kontos** auf – auch wenn
er auf Fluxer schreibt und dort anders heißt. Das passt zur Grundidee des
duo-Branches: ein Konto, zwei Zugänge. Wer nicht verknüpft ist (`fx:…`), behält
sein Fluxer-Aussehen; ein anderes gibt es für ihn ja nicht. Nachrichten, die
auf Discord entstehen, behalten ihren **Servernamen** (Spitzname) – der ist
näher dran als der globale Name.

**Auch ohne `!link`.** Verknüpfen ist für den Spielstand gedacht, nicht fürs
Aussehen – niemand soll dazu gezwungen werden, nur damit die Brücke hübsch ist.
Heißt jemand auf Fluxer so wie **genau ein** bekanntes Discord-Konto, wird
dessen Gesicht benutzt. Zwei Sicherungen:

- Nur **eindeutige** Treffer zählen. Zwei „Kevin" auf Discord → keiner.
- Es geht ausschließlich um die **Darstellung**. Konto, Geld und Fortschritt
  hängen weiterhin allein an `!link`; ein Fehlgriff kostet höchstens ein
  falsches Profilbild an einer gespiegelten Nachricht.

Woher der Bot die Discord-Namen kennt, ohne die Mitgliederliste abzufragen (die
bräuchte ein privilegiertes Intent): Er lernt sie aus dem Verkehr im
gespiegelten Kanal.

```env
RELAY_DISCORD_IDENTITY=false   # aus: jeder sieht aus wie auf seiner Plattform
RELAY_MATCH_NAMES=false        # aus: Discord-Gesicht nur für verknüpfte Konten
```

Das Discord-Gesicht wird 15 Minuten gemerkt, damit nicht jede Nachricht eine
Abfrage auslöst. Fehlt der Discord-Client (Einzelbetrieb) oder ist das Konto
nicht auffindbar, gilt wieder das Plattform-Aussehen.

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

## Namen statt IDs

Konten sind IDs, Menschen sind Namen. Nicht verknüpfte Fluxer-Spieler haben das
Konto `fx:12345` – und daraus wird auf **keiner** Plattform eine Erwähnung. In
der Rangliste stand deshalb roh `<@fx:12345>`.

Alle Ansichten gehen jetzt über zwei Helfer in
[`identity.js`](src/identity.js):

| Fall | Ausgabe |
|--|--|
| Discord-Konto | `<@498…>` – echte Erwähnung, auf Fluxer durch den Namen ersetzt |
| Fluxer-Konto mit bekanntem Namen | **Simon** |
| noch unbekannt | **Spieler #5544** – nie eine rohe ID, aber unterscheidbar |

Den Namen lernt der Bot von selbst, an drei Stellen und ohne Zutun des
Spielers:

1. **Bedienung** – wer den Bot benutzt, ist sofort bekannt.
2. **Kanal-Brücke** – wer im gespiegelten Kanal schreibt, ebenso; das gilt für
   beide Plattformen.
3. **Einmal beim Start** – [`names.js`](src/names.js) trägt die Namen zu allen
   Konten nach, die schon Geld oder Fortschritt haben. Das erwischt die
   Bestandsspieler von vor der Namensmerkung.

Dafür braucht es **kein** privilegiertes Intent: Ein einzelnes Konto per ID
abzufragen ist auf beiden Plattformen erlaubt – nur das Auflisten aller
Mitglieder wäre es nicht.

Abgesichert in [`test/names.test.js`](test/names.test.js).

## Karriere und Tätigkeiten

### Beförderungen

Eine Beförderung ist **kein erreichter Schwellenwert, sondern ein Wurf nach
jeder Schicht**. Die Chance steigt mit jeder Schicht seit dem letzten Aufstieg
– wer lange dieselbe Arbeit macht, wird irgendwann bemerkt. Zwei Leute mit
gleich vielen Schichten können also unterschiedlich weit sein, und der nächste
Aufstieg kann jederzeit kommen.

**Nach oben ist die Leiter offen.** Es gibt keinen höchsten Rang; nach den
benannten Stufen zählt ein Stern hoch (`Teilhaber:in ★17`). Damit das nicht in
absurde Löhne kippt, wachsen zwei Dinge gegenläufig:

| | |
|--|--|
| **Chance** | `3 % × Schichten seit dem Aufstieg ÷ (1 + Rang × 0,6)`, gedeckelt bei 50 % |
| **Lohn** | `1 + 0,25 × ln(1 + Rang)` – wächst immer, aber mit abnehmendem Schwung |

| Rang | Titel | Lohn | Ø Schichten bis zum nächsten |
|--|--|--|--|
| 0 | 🔰 Aushilfe | ×1,00 | 7 |
| 1 | 🥉 Fachkraft | ×1,17 | 9 |
| 3 | 🥇 Meister:in | ×1,35 | 12 |
| 8 | 👑 Teilhaber:in | ×1,55 | 17 |
| 25 | 🌟 Teilhaber:in ★17 | ×1,81 | 28 |

Der Rang wird **gespeichert** (`employment.rank`), weil er gewürfelt ist und
sich nicht aus der Schichtzahl ableiten lässt; `rank_at` merkt sich die
Schichtzahl beim letzten Aufstieg, daraus ergibt sich die wachsende Chance.
Ein Jobwechsel setzt beides auf null: Bleiben ist eine echte Entscheidung
gegen den nächsthöheren Job. Das Arbeitsamt zeigt die aktuelle Chance an.

### Angeln 🎣

Ausrüstung war bisher reine Job-Voraussetzung: gekauft, eingelagert,
vergessen. Wer eine **Angelausrüstung** besitzt, kann damit jetzt selbst etwas
anfangen – ohne Anstellung, ohne Bewerbung.

```
!angeln          einmal auswerfen (auch !fischen)
```

Auf Discord `/angeln` oder 🎣 unter Arbeit. Alle 20 Minuten ein Zug, 18
mögliche Fänge vom alten Stiefel über Hecht und Wels bis zur versunkenen
Geldkassette. Der Wert hängt an der **Größe** – derselbe Karpfen ist mal 4,
mal 18 Kilo schwer. Manchmal beißt nichts, und die Rute kann brechen.

### Heimat und Sprache 🌍

```
!heimat          (auch !land, !sprache, !wohnsitz)
/heimat          auf Discord, oder 🌍 im Menü unter „Ich"
```

Zwei Entscheidungen, die zusammen bestimmen, **für wen** man eigentlich
Inhalte macht:

| | bestimmt | wirkt auf |
|--|--|--|
| 🏠 **Wohnsitz** | Kaufkraft deines Heimatmarkts | Werbedeals, Merch, Spenden |
| 🗣️ **Inhaltssprache** | Größe des erreichbaren Publikums | Obergrenze, Tempo, Werbepreis |

### Die Abwägung

```
🥨 Landessprache   kleiner Topf · bindet schnell · gute Werbepreise · Decke kommt früh
🌍 Englisch        riesiger Topf · zäher Start · keine Decke in Sicht
```

Technisch stecken dahinter zwei getrennte Größen, und die Trennung ist der
ganze Trick:

- **`pool`** skaliert die Obergrenze der Reichweite **linear**. Deutsch (0,55)
  deckelt Twitch bei rund 1,08 Mio Followern, Englisch (3,0) bei 5,88 Mio.
- **`speed`** multipliziert Zuwachs **und** Schwund. Der Endpunkt bleibt damit
  exakt gleich, nur der Weg dorthin wird kürzer: Bis zur halben Decke braucht
  ein deutscher Kanal **1.365** Aktionen, ein englischer **4.322**.

Wäre `speed` nur auf den Zuwachs gegangen, wäre die schnelle Wahl auch die
größere gewesen – und es gäbe nichts zu entscheiden. Genau das prüft
[`test/home.test.js`](test/home.test.js) ausdrücklich nach.

Dazu wandert der Punkt der **vollen Vermarktung** mit dem Markt: Mit 500.000
Followern ist man im deutschsprachigen Raum eine Größe und verdient
entsprechend, im englischsprachigen ist man damit niemand.

### Was welcher Rang noch hergibt

Weil die Decke an der Sprache hängt, ist auch die Bekanntheitsleiter nicht für
jeden offen:

| Sprache | Netzwerk-Decke | höchster erreichbarer Rang |
|--|--:|--|
| 🌍 Englisch | 18,2 Mio | 🌟 Superstar |
| 🐉 Mandarin | 12,2 Mio | 🌟 Superstar |
| 💃 Spanisch | 10,9 Mio | 🌟 Superstar |
| 🪷 Hindi | 9,1 Mio | 🌟 Superstar |
| 🥨 Deutsch | 3,3 Mio | ✨ Prominenz |
| 🗾 Japanisch | 3,6 Mio | ✨ Prominenz |
| 🌷 Niederländisch | 1,1 Mio | ✨ Prominenz |

**Superstar wird man nur international.** Wer auf Deutsch sendet, kommt bis
Prominenz – dafür schneller, mit besseren Werbepreisen und einem Publikum, das
bleibt. Das ist kein Zufall, sondern genau die Aussage des Rangs.

### Heimvorteil

Wer in der Sprache seines Landes sendet, bekommt **+15 % Tempo** – man kennt
die Kultur, die Witze sitzen, die Leute bleiben eher hängen.

### Wer noch keine Heimat hat, wird gefragt

Ohne Wohnsitz produziert man für einen neutralen Markt und zahlt in den Topf
der Staatenlosen – beides verschenkt. Deshalb weist der Bot **bei jedem
Menüaufruf** darauf hin, solange nichts gewählt ist, auf Discord wie auf
Fluxer. Der Hinweis verschwindet mit der ersten Wahl (die kostenlos ist).

### Umziehen kostet

Die **erste Wahl ist kostenlos**, bei Land wie Sprache. Danach:

**Umzug** — Grundkosten mal Kaufkraft des Ziels (nach Japan 70.000, in die
Schweiz 80.000), und jeder weitere Umzug wird 50 % teurer. Dazu:

- 🔑 Dein **Mietvertrag endet** – die Wohnung steht im alten Land.
- 🏠 **Eigene Immobilien bleiben zurück.** Sie gehören dir weiter und zählen
  voll zum Vermögen, geben dir am neuen Ort aber **keinen Stellplatz**.
- 🚗 Ohne Wohnung zählt nur noch die Straße – zu viele Autos bringen dich in
  die Gnadenfrist. Wer umzieht, muss sich drüben erst wieder eine Bleibe
  kaufen oder mieten.

**Sprachwechsel** — kostet **45 % aller Follower** auf allen Plattformen und
sperrt weitere Wechsel für 30 Tage. Ein deutschsprachiges Publikum schaut keine
englischen Videos, nur weil derselbe Mensch davor sitzt.

Ohne diese Kosten wäre beides eine Optimierungsaufgabe, die man einmal löst und
danach vergisst. Mit ihnen ist es eine Weichenstellung.

## Creator-Netzwerk 📡

Das **Streaming-Setup** war früher Voraussetzung für den Job „Streamer". Der
Job ist raus – stattdessen hängt daran die komplexeste Tätigkeit im Spiel, und
zwar nicht auf einer Plattform, sondern auf **vier**:

```
!creator         das ganze Netzwerk (auch !netzwerk, !social)
!twitch !youtube !insta !twitter    direkt zu einer Plattform
/creator [plattform]                auf Discord, oder 📡 unter Arbeit
```

Niemand ist nur auf einer Plattform. Wer streamt, hat auch YouTube, Instagram
und Twitter – und die hängen zusammen.

#### Vier Plattformen, vier Geschäftsmodelle

| | Aktion | Zeit | Verdient an | Community | Charakter |
|--|--|--|--|--|--|
| 🟣 **Twitch** | Stream | 2 | Werbung + Spenden + **Abos** | stark | live, sofort, das meiste Geld |
| 🔴 **YouTube** | Video | 3 | Werbung auf Aufrufe | mittel | teuer in der Zeit, **zahlt tagelang nach** |
| 📸 **Instagram** | Post | 1 | **nur Kooperationen** | keine | wächst am schnellsten, zahlt selbst nichts |
| 🐦 **Twitter** | Tweet | 1 | **gar nichts** | stark | Promo und Community – trotzdem unverzichtbar |

Das ist bewusst so ungleich wie in Wirklichkeit:

- **Twitch** zahlt pro Zuschauer am besten, weil Spenden und Abos dazukommen.
- **YouTube** erreicht ein Vielfaches eines Livestreams, aber fast niemand
  abonniert. Dafür wandert jedes Video in den **Katalog** und wird noch tagelang
  geklickt – das Geld kommt von allein, auch wenn du nichts tust.
- **Instagram** überweist dir **keinen Cent**. Geld gibt es nur, wenn eine Marke
  anklopft – und wie oft das passiert, hängt an deiner Reichweite im **ganzen**
  Netzwerk, nicht an diesem einen Post.
- **Twitter** zahlt **nie**. Ein Tweet gibt der nächsten Aktion einen
  Reichweitenschub (Promo) und ist pro Zeiteinheit die beste Community-Quelle.

**Community ist nicht dasselbe wie Reichweite.** Sie entsteht dort, wo man
miteinander redet – und genau deshalb nicht überall gleich:

| | Community je Aktion | je Zeiteinheit |
|--|--|--|
| 🟣 Twitch (Just Chatting) | 2,9 | 1,5 |
| 🐦 Twitter (Community-Tweet) | 3,1 | **3,1** |
| 🔴 YouTube (Vlog) | 1,8 | 0,6 |
| 📸 Instagram | **0** | 0 |

Zwei Stunden Livechat sind zwei Stunden Beziehung, unter Videos wird noch
diskutiert – im Instagram-Feed wird gesehen, geliked und weitergescrollt.
Twitter bleibt die billigste Quelle, ist aber nicht mehr die einzige.
Community halbiert den Followerschwund in Pausen und trägt den Merch-Umsatz.

#### Wie sich die Plattformen gegenseitig tragen

- **Übertrag:** Jede Aktion spült Follower zu den anderen Kanälen („Link in
  Bio"). Twitter am stärksten, weil es reine Promo ist.
- **Gemeinsame Reichweite:** Fremde Follower zählen zu 25 % in die eigene
  Reichweite hinein. Wer auf YouTube groß ist, startet auf Instagram nicht bei
  null.
- **Ereignisse wirken netzwerkweit:** Ein viraler Clip oder ein Presseartikel
  bringt überall Follower – ein **Shitstorm** kostet überall welche.
- **Ein Schontag:** Der Verfall greift erst ab dem zweiten Tag ohne Aktion.
  Ohne ihn bekäme jemand, der täglich zur selben Zeit sendet, jeden Tag einen
  vollen Tag Inaktivitätsverfall aufgebrummt – 2,5 % gegen 0,16 % Schwund je
  Aktion. Bestraft werden soll Abwesenheit, nicht Regelmäßigkeit.
- **Ein Tagesbudget:** Alle Plattformen teilen sich **8 Zeiteinheiten** am Tag.
  Vier Streams sind ein voller Tag; zwei Videos plus zwei Posts auch. Damit ist
  „einfach alles machen" keine Option, sondern eine Entscheidung.

#### Warum das kein Gelddrucker ist (ARCHITEKTUR §3)

Vier Plattformen, die sich gegenseitig Follower zuspielen, sind genau die Form,
aus der eine Aufschaukelung wird. Verhindert wird das dadurch, dass der
Übertrag **innerhalb** der unterlinearen Wurzel steckt:

```
Publikum  ~  (eigene + 0,25 · fremde Follower)^0,55…0,62     unterlinear
Schwund   ~  Follower je Plattform                            linear
```

Fremde Reichweite verschiebt die Kurve also, sie multipliziert sie nicht. Dazu
kommt: Auch ein Kanal, auf dem man **nie** etwas macht, verfällt – der Verfall
wird beim Übertrag mitgerechnet. Ohne das ließe sich Reichweite auf einem
vergessenen Kanal parken und beliebig ansammeln.

[`test/creator.test.js`](test/creator.test.js) prüft das auf drei Wegen:

1. **Analytisch**: Für jede Plattform gibt es einen Punkt, ab dem der Schwund
   den Zuwachs überholt – deutlich oberhalb davon ist der Zuwachs nachweislich
   kleiner. Das gilt unabhängig davon, wie lange jemand spielt; eine Simulation
   kann so etwas nie beweisen. Die Obergrenzen: 🟣 1,96 Mio · 🔴 2,93 Mio ·
   📸 0,87 Mio · 🐦 0,31 Mio.
2. **Unterlinearität**: Zehnfache Reichweite bringt weniger als zehnfaches
   Geld – bei Streams, bei Merch und bei Verträgen.
3. **Simuliert** über 22 Karrieren à 1200 Tage: Jede Verdopplung der Spielzeit
   bringt weniger als die vorige.

```
Tag 150: 165.000 → Tag 300: 611.000 → Tag 600: 2,01 Mio → Tag 1200: 5,06 Mio
Wachstum:       3,7×             3,3×              2,5×
```

Das Wachstum bremst durchgehend ab – und läuft gegen die Summe der
Obergrenzen von rund 6 Millionen. Geprüft wird außerdem, dass
Twitter über hunderte Tweets **exakt null** verdient und Instagram ohne
Kooperation ebenfalls nichts.

#### Eigene Titel ✏️

Jede Plattform hat einen Schalter **🎲 Titel: zufällig / ✏️ Titel: eigener**.
Im eigenen Modus fragt der Bot nach der Formatwahl nach dem Titel – auf Discord
per Eingabefenster, auf Fluxer per Rückfrage im Chat.

```
🟣 Vollständig unvorbereitet: „Ich lese drei Stunden lang Steuerbescheide vor" (Gaming)
```

Der Titel steht danach unter 📌 **Zuletzt** an der Plattform. Entschärft wird
er trotzdem: Erwähnungen, `@everyone`, Markdown und Zeilenumbrüche fliegen
raus, bei 80 Zeichen ist Schluss – wer nur Leerzeichen tippt, bekommt wieder
einen aus der Vorauswahl.

#### Sponsorenverträge 🤝

Ab etwa **3.000** Followern im Netzwerk melden sich Marken. Ein Vertrag ist
eine Abmachung mit Frist:

```
"Liefere 3 Werbeposts auf Instagram in 4 Tagen → 6.400"
```

Angenommen wird im Menü unter 🤝 **Deals** (`!deals` auf Fluxer). Wer liefert,
bekommt die Summe **nach der letzten Lieferung** ausgezahlt. Wer die Frist
reißt, zahlt **30 % Vertragsstrafe**. Es läuft immer nur ein Vertrag; Angebote
verfallen nach zwei Tagen von selbst.

Die Summe hängt an der **Gesamtreichweite** – hier zahlt sich das Netzwerk
wirklich aus, und ab einer gewissen Größe knallt es:

| Reichweite | Vertrag über 3 Beiträge |
|--:|--:|
| 10.000 | ~2.300 |
| 50.000 | ~17.000 |
| 250.000 | ~48.000 |
| 1.000.000 | ~119.000 |
| 3.000.000 | ~243.000 |

Auch das bleibt unterlinear (`reichweite^0,65`): Der zehnfache Kanal bekommt
keine zehnfachen Verträge. Twitter wird nie beauftragt, dort läuft keine
Werbung, die jemand bezahlen würde.

#### Vermarktung: Reichweite ist nicht gleich Geld

Wie gut sich Reichweite überhaupt zu Geld machen lässt, hängt davon ab, wie
groß man ist. Das ist keine Strafe für kleine Kanäle, sondern die
Wirklichkeit: kein Partnerprogramm, miese Tausenderkontaktpreise, keine
Verhandlungsmacht, keine Marke, die einen kennt.

```
Vermarktungsgrad = (Reichweite / 1.700.000)^0,73      gedeckelt bei 100 %
```

| Reichweite | Vermarktung | Geld/Tag | Einordnung |
|--:|--:|--:|--|
| bis 36.000 | 6 % | – | Taschengeld |
| 50.000 | 8 % | ~1.700 | Nebenverdienst |
| 250.000 | 25 % | ~11.000 | halber Spitzenjob |
| 450.000 | 38 % | ~24.000 | **Job kündigen** |
| 850.000 | 60 % | ~53.000 | drei Spitzenjobs |
| 1.700.000 | 100 % | ~128.000 | volle Vermarktung |
| 3.200.000 | 100 % | ~196.000 | – |

Der Ertrag wächst im Aufstieg damit **schneller** als die Reichweite – das ist
so gewollt: Der Weg ist lang, und ab einer gewissen Größe soll es knallen.
Zum Vergleich: Der bestbezahlte Job (Astronaut) bringt bei vier Schichten
20.000 am Tag; ab etwa 450.000 Followern lohnt sich das Arbeitsamt nicht mehr.

Auf Sponsorenverträge wirkt die Kurve nur zur Hälfte (Wurzel) – Verträge
werden verhandelt, nicht nach Tarif bezahlt. Ein kleiner Kanal bekommt
schlechte Konditionen, aber keine Almosen.

#### Merch 👕

Ab **5.000** Followern verkaufst du Merch:

```
pro Tag = (Community / 100) × Reichweite^0,92 × 0,05
```

Also **Anteil der Fans, der kauft × Zahl der Fans**. Die Community ist ein
**Faktor**, kein Summand – ohne Bindung verkauft auch der größte Kanal
nichts, und eine treue kleine Blase verdient nicht so viel wie ein Weltstar:

| Reichweite | Merch/Tag (volle Community) |
|--:|--:|
| 5.000 | 126 |
| 50.000 | 1.052 |
| 250.000 | 4.625 |
| 1.000.000 | 17.000 |
| 3.000.000 | 45.500 |

Der Exponent ist bewusst steil: Unter 250.000 Followern ist Merch ein Zubrot,
darüber eine tragende Säule.

Bindung entsteht im Livechat, unter Videos und auf Twitter – im
Instagram-Feed nicht. Abgerechnet wird faul (§4) beim Öffnen des Menüs,
gedeckelt auf 7 Tage Rückstau. Die Community klingt ohne Aktivität ab – wer
aufhört, verkauft bald nichts mehr.

#### Burnout 🔋

Wer jeden Tag das volle Zeitbudget raushaut, brennt aus: Jede Aktion kostet
Kraft, jede Pause bringt sie zurück (55 % pro Tag).

| Tempo | Dauerzustand |
|--|--|
| 8 von 8 Zeit, jeden Tag | 80 % Reichweite |
| 6 von 8 | 85 % |
| 4 von 8 | 90 % |
| 2 von 8 | 95 % |

Der Malus ist bei **−35 %** hart gedeckelt und trifft nur, wer dauerhaft am
Anschlag fährt. Aus dem Zeitdeckel wird damit eine Entscheidung statt einer
Wand – und nebenbei eine weitere Obergrenze für §3.

#### Vorfälle: Entscheidungen mit Folgen ⚠️

Bis hierher war der Aufstieg eine Fleißaufgabe – wer täglich sendet, kommt an.
Genau daran krankt jede Aktivität, die sich durchoptimieren lässt: Man spielt
sie nicht mehr, man arbeitet sie ab.

**Zwölf Vorfälle** brechen das auf. Der Sponsor entpuppt sich als Betrug, ein
sechs Jahre alter Clip taucht auf, ein Netzwerk will dich exklusiv, das
Finanzamt schreibt, jemand steht vor deiner Tür. Jeder hat zwei bis drei
Optionen, jede Option **mehrere gewichtete Ausgänge**:

```
🪙 Dein Sponsor ist ein Problem
   ✂️ Öffentlich distanzieren   → meist Community, manchmal Spott
   🤐 Aussitzen                 → meist Schaden, manchmal Ruhe
   🔥 Nachlegen                 → selten viel Geld, meist ein Desaster
```

Bewusst **ohne Zahlen in der Anzeige**: Was eine Option kostet oder bringt,
steht nirgends – sonst wäre es Rechnen statt Entscheiden.

**Drei Regeln machen den Unterschied:**

1. **Keine Option ist sicher.** Die brave Wahl kostet meistens ein wenig, die
   mutige kann alles kosten – und manchmal ist es umgekehrt.
2. **Mit der Größe wird es gefährlicher.** Große Kanäle stehen unter
   Beobachtung: mehr Vorfälle (2 % → 4 % je Aktion) und **härtere Ausgänge**
   (Verluste bis ×1,6). Verstärkt werden nur Verluste, nie Gewinne.
3. **Wegklicken hilft nicht.** Wer 24 Stunden nicht reagiert, bekommt den
   Ausgang, den Schweigen eben hat – mit **60 % Aufschlag** auf den Schaden.

Der härteste Ausgang ist eine **Sperre**: Nach einem Copyright-Strike liegt
der Kanal Tage still, während die Follower weiter verfallen.

#### Warum die Spitze nicht sicher ist

Das ist der eigentliche Zweck der Vorfälle. Über 40 simulierte Karrieren mit
Drama:

| Spielweise | Tag 365 | Tag 730 |
|--|--:|--:|
| überlegt entschieden | 484.000 | 1.221.000 |
| zufällig geklickt | 415.000 | 915.000 |
| nie reagiert | 345.000 | 774.000 |

Dazu eine Streuung von **p10 zu p90 um den Faktor 2** – zwei Spieler mit
identischem Fleiß landen ein Jahr später weit auseinander. Wer gut entscheidet,
ist rund **40 % weiter** als wer wegklickt; garantiert ist beides nicht.

Damit ist der Weg an die Spitze kein Countdown mehr, sondern etwas, das
schiefgehen kann – und ein großer Kanal ist kein Zustand, den man erreicht,
sondern einer, den man hält.

#### Rangliste und Profil

`/leaderboard` hat eine neue Ansicht **📡 Reichweite** – dort stehen nur
Spieler mit Kanal. Im **Profil** taucht ein Netzwerk-Feld auf, sobald du
überhaupt Follower hast: Gesamtzahl plus Aufteilung je Plattform.

Dazu zeigt das Profil oben rechts das **Profilbild** des Kontos (von Discord
oder Fluxer, je nachdem woher es kommt; eine halbe Stunde gepuffert, damit
nicht jeder Aufruf eine API-Abfrage ist) und darunter den
**Bekanntheitsgrad** – zwischen Erwähnung und Angeber-Spruch:

```
@Kevin
📺 Landesweit ein Begriff
> Ich bin nur wegen der Autos hier
```

| Wert | Titel | erreichbar etwa |
|--|--|--|
| 0 | 🫥 Unbeschriebenes Blatt | – |
| 10.000 | 🙂 Vom Sehen bekannt | erster Monat |
| 25.000 | 📍 Lokalgröße | ~Tag 70 |
| 50.000 | 🏙️ Stadtbekannt | ~Tag 110 |
| 250.000 | 📺 Landesweit ein Begriff | ~Tag 230 |
| 1.000.000 | ✨ Prominenz | ~Tag 520 |
| 5.000.000 | 🌟 Superstar | Jahre |
| 20.000.000 | 👑 Legende | Fernziel |

Die Leiter reicht bewusst bis in zweistellige Millionen: „Superstar" soll das
sein, was es draußen auch ist – internationale Reichweite, kein Titel für den
dritten Monat. Der Wert ist **Reichweite + 400 je Level**. Bekanntheit ist damit vor allem
eine Frage des Publikums – aber wer lange dabei ist, kennt man auch ohne
Kanal, und so hat jeder einen Titel statt nur die Creator.

#### Was sich lohnt

Ein Spieler, der täglich sein Zeitbudget nutzt (Tweet + 2 Streams + Video):

| Tag | Reichweite | Geld/Tag | Einordnung |
|--:|--:|--:|--|
| 30 | 4.000 | 1.700 | Nebenverdienst |
| 90 | 35.000 | 8.900 | halber Spitzenjob |
| 180 | 138.000 | 24.000 | **Job kündigen** |
| 365 | 546.000 | 57.000 | knapp 3 Spitzenjobs |
| 730 | 1,7 Mio | 121.000 | – |
| 1200 | 3,2 Mio | 194.000 | – |

Zum Vergleich: Der bestbezahlte Job (Astronaut) bringt bei vier Schichten
**20.000 am Tag**. Der Weg dahin ist lang, und genau deshalb darf es oben
richtig knallen – ab einer gewissen Größe könnte man realistisch keinen
Standardjob mehr nebenher machen.

**Spezialisieren oder verteilen?** Das Gleichgewicht einer Plattform hängt
*nicht* an der Zahl der Aktionen – Zuwachs und Schwund skalieren beide damit,
nur das Tempo ändert sich. Wer alles auf einen Kanal wirft, ist deshalb früh
vorn (Tag 120: 93.000 gegen 63.000 Follower); wer verteilt, hat am Ende vier
Obergrenzen statt einer (Tag 900: 2,3 Mio gegen 1,7 Mio). Geld je Zeiteinheit
bleibt live trotzdem am stärksten.

### Selbst schrauben 🔧

Mit einem **Werkzeugkasten** repariert man in der Werkstatt selbst und zahlt
nur Material statt des Werkstattpreises. Zusatzwerkzeug hilft: Die Hebebühne
senkt den Materialaufschlag, das Diagnosegerät und das Schweißgerät senken das
Pfuschrisiko.

| | Werkstatt | selbst (nur Kasten) | selbst (voll ausgestattet) |
|--|--|--|--|
| Aufschlag | ×1,04 – ×1,09 | ×1,03 | ×1,005 |
| Risiko | keins | 25 % Pfusch | 2 % Pfusch |
| Tempo | sofort | 45 min Pause | 45 min Pause |

**Die Regel bleibt auch hier:** Eine Reparatur kostet immer mehr, als sie an
Wert zurückbringt – sonst wäre der Weg offen, Wracks zu kaufen, selbst
herzurichten und zum Zeitwert zu verkaufen (ARCHITEKTUR §3). Der Aufschlag ist
nur kleiner als in der Werkstatt, nie kleiner als 1; das prüft
[`test/activities.test.js`](test/activities.test.js) für jede Kombination aus
Preis, Zustand und Werkzeugpark. Bei Pfusch steigt der Zustand nur teilweise,
das Material ist trotzdem bezahlt – und der Werkzeugkasten kann dabei
draufgehen.

## Level-Vorteile: wofür man überhaupt levelt

Erfahrung sammelte man bisher nebenbei, ohne dass sie etwas bewirkt hätte.
Jetzt hängen fünf Vorteile daran – alle in [`perks.js`](src/perks.js), damit
man beim Balancing nicht durch zehn Dateien sucht.

| Vorteil | Wirkung | Deckel |
|--|--|--|
| 💰 **Einkommen** | +2 % je Level auf `!daily`, jede Schicht und `!work` | +60 % (Level 30) |
| 📉 **Börsengebühr** | −2 % je Level | −50 % |
| 🅿️ **Stellplätze** | je einer ab Level 10, 20 und 35 | +3 |
| 🛡️ **Straße** | geringeres Diebstahlrisiko, −2 % je Level | −40 % |

Sichtbar sind sie im **Profil** (`/profil`) samt nächstem Meilenstein – ohne
diese Anzeige wäre das Levelsystem eine Zahl ohne Wirkung. Beim Tagesbonus und
bei jeder Schicht steht der Zuschlag in der Antwort.

### Zuschlag auf UnbelievaBoats `!work`

UnbelievaBoats Auszahlung können wir nicht ändern – fremder Bot, eigene
Datenbank. Also legt der Bot drauf: Er liest die Auszahlung mit und bucht den
Aufschlag hinterher.

Das Zuordnen ist der heikle Teil, denn die Antwort des fremden Bots hat keinen
Bezug zum Befehl. Deshalb in zwei Schritten: Wer `!work` schreibt, hinterlässt
einen Anspruch im Kanal; die nächste Bot-Nachricht dort löst ihn ein, und die
größte Zahl darin gilt als Auszahlung. Absichtlich vorsichtig – ein offener
Anspruch je Kanal, 20 Sekunden Zeitfenster, Cooldown je Spieler, Obergrenze
für die erkannte Summe. Im Zweifel passiert lieber nichts, als dass jemand
fremdes Geld bekommt.

```env
WORK_BONUS=true                 # aus, solange nicht gesetzt
WORK_BONUS_COMMANDS=work,daily,crime,slut,beg
WORK_BONUS_COOLDOWN_MIN=20
```

Braucht wie die Nudges das **Message Content Intent** und den Präfix
(`!work`) – UnbelievaBoats Slash-Befehle sind für uns unsichtbar.

### Was bewusst KEINEN Rabatt bekommt

Zwei Systeme bleiben unangetastet, weil dort der Aufschlag knapp über der
Grenze liegt, die den Bot vor einem Gelddrucker schützt (ARCHITEKTUR §3):

- **Werkstatt** – der Preis liegt nur wenige Prozent über dem Wertzuwachs. Ein
  Level-Rabatt machte daraus ein Geschäft: reparieren, verkaufen, Gewinn.
- **Auktionshaus** – der Startpreis liegt knapp über dem Erwartungswert des
  Inhalts. Jeder Nachlass drehte den Erwartungswert ins Plus.

Die **Börsengebühr** darf sinken, aber nie auf null: Sie ist der Grund, warum
die Börse unterm Strich eine Geldsenke ist. Das Einkommen zu erhöhen ist
dagegen unbedenklich – `!daily`, Schichten und `!work` sind ohnehin die
geplanten Geldquellen.

Gedeckelt ist alles, weil **jede Geldbuchung XP gibt**: Ohne Obergrenze wäre
mehr Einkommen → mehr XP → mehr Level → mehr Einkommen eine sich selbst
verstärkende Schleife. [`test/perks.test.js`](test/perks.test.js) prüft die
Deckel und dass Werkstatt, Auktionshaus und Gebührenuntergrenze unangetastet
bleiben.

## Wallstreet: die simulierte Wirtschaft

25 handelbare Werte in drei Anlageklassen, Kurse ändern sich **alle 30
Minuten**.

```
!boerse [seite]              Kursboard (auch !aktien)
!depot                       eigener Bestand mit Gewinn/Verlust
!invest <kürzel> <stück>     kaufen – auch „für 20000" oder „alles"
!verkaufe <kürzel> [stück]   verkaufen – ohne Angabe alles
```

Auf Discord `/boerse` (mit `wert:HAST` direkt zum Papier) und `/depot`, dazu
📈 **Börse** unter Zocken und 💼 **Depot** unter Ich.

| Klasse | Beispiele | Charakter |
|--|--|--|
| **Aktien** (16) | Haste Motors, Miro Pharma, Casino Royale | mittlere Schwankung, eigene Geschichte, gemeinsamer Markttrend |
| **Fonds** (3) | Haste-Index, Krypto-Korb, Blue-Chip | Mittelwert ihres Korbs – ruhiger Einstieg |
| **Krypto** (6) | RubinCoin, QuakCoin, ToastCoin | wild, eigener Trend, kann pleitegehen |

**Kaufwege:** Stückzahlen (1/5/10/50/Max), Beträge („für 10.000"), eigene
Eingabe – und beim Verkauf 25/50/100 % des Bestands oder eine Stückzahl. Auf
Fluxer geht dasselbe per Text: `!invest RUBI für 20000`.

### Kein Gelddrucker (ARCHITEKTUR §3)

Hier ist die Regel schwerer einzuhalten als anderswo, weil der Spieler selbst
entscheidet, wann er kauft. Der Kurs ist deshalb ein **Martingal**: Der
Erwartungswert des nächsten Kurses ist exakt der aktuelle. Gewürfelt wird
`exp(σ·z − σ²/2)`; für normalverteiltes z hebt der Abzug den Aufwärtseffekt
der Schwankung genau auf. Ohne ihn hätte jeder Wert eine eingebaute Drift –
und je wilder ein Coin, desto mehr Geld aus dem Nichts.

Folge: **Keine Strategie hat einen Vorteil.** Halten, Dips kaufen, Trends
reiten, würfeln – alles hat den Erwartungswert null. Darauf kommt die Gebühr
von 1 % je Auftrag, und damit ist die Börse unterm Strich eine Geldsenke.
Keine Zinsen, keine Dividende, kein Bonus – all das wäre Geld aus dem Nichts.

[`test/wallstreet.test.js`](test/wallstreet.test.js) beweist beides:
analytisch (E[Ertrag] = 1 über 200.000 Schritte je Schwankungsstufe) und
empirisch (vier Strategien über je 600 Kursbahnen; zusätzlich exakt: auf
derselben Bahn ist das Ergebnis mit Gebühr immer genau um die gezahlten
Gebühren schlechter).

### Was die Kurse realistisch macht

- **Gemeinsamer Marktruck.** Aktien bewegen sich nicht unabhängig: Pro Takt
  gibt es einen Ruck für den ganzen Markt, auf den jeder Wert mit eigenem
  Rauschen reagiert. Erst dadurch gibt es „rote Tage" – und der Index wird zu
  einer echten Aussage.
- **Nervositätsphasen.** Eine träge um 1 pendelnde Volatilität skaliert alle
  Schwankungen: ruhige Wochen, hektische Tage. Sie ändert nur die Streuung,
  nie die Richtung.
- **Echte Diversifikation.** Ein Fonds hat keinen eigenen Zufall, sein Kurs
  **ist** der Mittelwert seines Korbs. Dass er weniger schwankt, ist deshalb
  keine gesetzte Zahl, sondern ergibt sich – und wird im Test nachgemessen.
- **Schlagzeilen** entstehen **nach** einer Bewegung und erklären sie nur.
  Eine Vorhersage wäre ein garantierter Gewinn.
- **Insolvenz.** Fällt ein Wert unter 5, werden die Halter zum letzten Kurs
  ausgezahlt (abzüglich der üblichen Gebühr, sonst wäre die Pleite besser als
  ein Verkauf), es gibt eine Nachricht ins Postfach, und der Wert wird neu
  notiert. Das verhindert nebenbei einen Exploit: Bei einem Kurs von 1 könnte
  es nur noch aufwärtsgehen.

### Der Ticker – die eine Ausnahme

Der Rest des Bots rechnet faul ab (§4). Für eine Börse wäre das falsch: Kurse
müssen sich bewegen, während niemand zusieht. Es gibt deshalb einen echten
Taktgeber (`startTicker`, alle 30 min). Er ist aber nur ein **Auslöser**, keine
zweite Codebahn – er ruft dasselbe `advance()` auf, das auch vor jeder Ansicht
läuft. Simuliert wird gegen die **Uhr**: Ein verpasster Takt (Neustart,
Ausfall) wird nachgeholt, ein doppelter Aufruf tut nichts. Nachgeholt wird
höchstens 14 Tage.

Die ganze Nachsimulation läuft in **einer** Transaktion. Ohne sie schrieb
SQLite jede der 15.000 Verlaufszeilen einzeln auf die Platte – zwei Wochen
Nachholen dauerten 107 Sekunden statt 0,14.

## Tagesbonus (!daily)

UnbelievaBoats `!daily` gibt es auf Fluxer nicht, also bringt der Bot einen
eigenen mit – und der erzählt jetzt auch, woher das Geld kam:

```
!daily     einmal am Tag kassieren (auch !täglich)
```

```
🧻 Auf dem Bahnhofsklo Pfandflaschen gesammelt. Riecht nach Erfolg
   und nach anderem: 🪙 1.612.
💰 Kontostand: 🪙 48.930
```

Rund 60 Sprüche in [`data/daily.js`](src/data/daily.js) – von dummem Glück über
zwielichtig bis eklig, wie bei UnbelievaBoats `!work`. Der Betrag schwankt
zwischen **200 und 2000** und hängt **nicht** vom Spruch ab; sonst müsste man
auf gute Zeilen hoffen statt einfach zu kassieren. Eine neue Zeile hinzufügen
heißt: eine Zeile in die Liste schreiben (Platzhalter `{betrag}`) – der Test in
[`test/wallet.test.js`](test/wallet.test.js) prüft jede automatisch auf
Platzhalter, Dubletten und Länge.

Zum Vergleich: eine Job-Schicht bringt 70–800. Wer arbeitet, verdient weiterhin
mehr als der eine Griff am Tag.

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

## Auktionshaus: Balance der Garagen

Storage Wars fühlte sich wie Geldverbrennen an – zu Recht. Der Startpreis ist
der **Erwartungswert** des Inhalts plus Hausvorteil, und der Erwartungswert
wurde von Dingen getragen, die man praktisch nie zieht:

| Ursache | vorher |
|--|--|
| Ein einziges Fundstück (Dragonlore) | trug **49 %** des durchschnittlichen Objektwerts, steckte aber nur in 1 von 14 Funden |
| Funde seltener als 1 : 100 (Mythic und aufwärts) | **19 %** des Preises – eine Lotterie, die man in jeder Garage mitbezahlt hat |
| Bargeld | lag nur in 15–35 % der Garagen |

Ergebnis: Die **typische** Garage war 38 % ihres Startpreises wert. Der
Durchschnitt stimmte – aber den bekommt man nur, wenn man tausende Garagen
kauft. Bei fünf Käufen sieht man den Median, und der war ein Totalverlust.

Vier Stellschrauben, alle in [`data/storage.js`](src/data/storage.js) bzw.
[`storage.js`](src/storage.js):

1. **Fundgewichte.** Teure Stücke sind jetzt entsprechend selten, statt gleich
   oft gezogen zu werden wie ein Toaster. Der Preis folgt dem, was üblicherweise
   drinliegt.
2**Der unerreichbare Tail wird nicht mehr eingepreist.** Alles ab „Godlike"
   (< 1 : 2000) fließt in den Inhalt, aber nicht in den Startpreis – geschenkter
   Bonus statt Dauerabgabe. Damit das keine Geldquelle wird, muss der so
   verschenkte Anteil (6,1 %) unter dem Hausvorteil (10 %) bleiben; der Test
   rechnet beides gegeneinander.
3**Sockel statt Alles-oder-nichts.** In **jeder** Garage liegt Bargeld
   (Spanne je Größe), und es sind mehr Objekte drin – mehr Stücke heißt näher am
   Durchschnitt.

Dazu der Hausvorteil von 15 % auf 10 %.

| | vorher | jetzt |
|--|--|--|
| typische Garage (Median) | 38 % des Preises | **77 %** |
| schlechtes Viertel (p25) | 17 % | **61 %** |
| Garagen mit Gewinn | 19,6 % | **24,7 %** |
| Ø Inhalt / Ø Preis | 88 % | **95 %** |

**Warum nicht mehr als jede vierte Garage Gewinn bringt:** Der Preis muss über
dem Erwartungswert liegen, sonst ist die Auktion eine Geldquelle (ARCHITEKTUR
§3). Bei einer Verteilung mit Jackpots heißt das zwangsläufig, dass die
Mehrheit der Käufe knapp darunter landet – der Gewinn steckt in den seltenen
Funden. Erreichbar war also nicht „meistens Gewinn", sondern „meistens ein
kleiner Verlust statt eines Totalverlusts". Genau das steht jetzt auch im
Auktions-Panel, damit niemand mit falscher Erwartung bietet.

Abgesichert ist das Rebalancing in
[`test/storage.test.js`](test/storage.test.js): Median- und p25-Schranken über
20 000 gewürfelte Garagen, dazu der analytische Nachweis, dass der Startpreis
weiterhin über dem **vollen** Erwartungswert liegt (Jackpot-Tail eingerechnet).

## Staatskasse: der gemeinsame Topf

```
!staat            (auch !staatskasse, !staatskonto, !kasse)
/staat            auf Discord
🏛️ Staatskasse    im Menü unter „Ich“
```

Jede Geldbewegung auf dem Server wirft etwas für die Allgemeinheit ab:

| Buchung | Satz | Beispiel |
|---------|------|----------|
| **Ausgabe** (Spieler zahlt) | **19 %** Mehrwertsteuer | Auto für 10 000 → 1 900 in die Kasse |
| **Einnahme** (Spieler kassiert) | **40 %** Einkommensteuer | Schicht über 2 000 → 800 in die Kasse |

### Niemand zahlt dafür etwas

Das ist der Kern und der häufigste Denkfehler: Der Anteil wird **aus dem Betrag
nur berechnet** und dann *zusätzlich* in die Kasse gelegt. Der Spieler zahlt
keinen Taler mehr und gibt von seiner Einnahme nichts ab.

```
vorher:   Spieler −10 000
nachher:  Spieler −10 000   +   Staatskasse +1 900
```

Preise, Löhne, Gebühren und jede Bilanz bleiben also exakt wie bisher. Das ist
in [`test/treasury.test.js`](test/treasury.test.js) direkt geprüft: über 2 000
zufällige Buchungen verändert sich das Vermögen der Spieler um **exakt** die
Summe der gebuchten Beträge – die Kasse hat daran keinen Anteil.

### Warum das kein Gelddrucker ist (ARCHITEKTUR §3)

Die Kasse ist eine **reine Senke**: Aus ihr fließt nichts an Spieler zurück. Sie
erzeugt kein Geld im Kreislauf, sondern zählt, was die Server-Wirtschaft
umsetzt. §3 wäre erst berührt, wenn jemand daraus ausgezahlt bekäme – deshalb
gibt es bewusst keine Auszahlfunktion, und der Test prüft, dass es sie auch
nicht gibt.

### Angebunden an genau einer Stelle

Der Anteil entsteht in `unb.changeCash` – dem zentralen Geld-Choke-Point, durch
den jede Buchung des ganzen Bots läuft. Ein neues Feature ist damit automatisch
angeschlossen, ohne dass es etwas davon wissen muss.

Ausgenommen sind:

- **Stornos und Rückerstattungen** (`{ xp: false }`) – sonst würde ein
  abgebrochener Kauf die Kasse füttern.
- **Raubzüge** – Beute wird nicht deklariert (sie laufen ohnehin mit
  `{ xp: false }`).
- Buchungen mit ausdrücklichem `{ tax: false }`.

Fehlschläge der Kasse werden geschluckt: Eine Geldbuchung darf niemals daran
scheitern, dass die Statistik danebengeht.

### Aufgeteilt auf die Länder

Jeder Spieler zahlt in die Kasse **seines Wohnsitzlandes** (siehe
[Heimat und Sprache](#heimat-und-sprache-)). Wer keine Heimat gewählt hat,
zahlt in den Topf der Staatenlosen.

```
!laender         Rangliste der reichsten Staaten (auch !staaten)
🌍 Länder        Knopf in der Staatskasse
```

```
🥇 🇩🇪 Deutschland   173.500 · 44 % · 2 Einwohner · 2 Buchungen
🥈 🇺🇸 USA           117.800 · 30 % · 1 Einwohner · 1 Buchung
🥉 🇯🇵 Japan          72.200 · 18 % · 1 Einwohner · 1 Buchung
```

Interessant ist dabei nicht der absolute Stand, sondern das Verhältnis: Ein
Land mit zwei umsatzstarken Einwohnern überholt eines mit zehn sparsamen.

Der **Welttopf bleibt die Gesamtsumme** – die Länderzeilen sind nur seine
Aufteilung. Buchungen aus der Zeit *vor* dieser Aufteilung gehören keinem
Land; sie stehen in der Ansicht offen als „nicht zugeordnet". Ein **Umzug**
ändert nur, wohin künftige Steuern fließen: Was ein Land eingenommen hat,
behält es.

### Was die Ansicht zeigt

- **Kassenstand** und die Aufteilung in Mehrwert- und Einkommensteuer
- **Umsatz**: die Bemessungsgrundlage beider Seiten und die Zahl der Buchungen
- **Stärkste Bereiche** – Fahrzeuge, Arbeit, Miete, Börse, Casino, Auktionshaus,
  Werkstatt, Angeln, Boni, Rechnungen (die Buchungsgründe sind Freitext, daher
  eine kleine Zuordnung in `treasury.js` statt hunderter Einzelzeilen)
- **Größte Beitragszahler** und dein eigener Beitrag in der Fußzeile
- **Die letzten Zuflüsse**

Beim Verknüpfen zweier Konten (`!link`) wandert der Beitrag mit; der Kassenstand
selbst bleibt davon unberührt.

### Sätze ändern

```
TREASURY_VAT_RATE=0.19
TREASURY_TAX_RATE=0.40
```

Werte zwischen 0 und 1; alles andere fällt auf die Standardsätze zurück.

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
