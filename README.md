# UnbelievaBoat Shop-Bot

Ein Discord-Bot (discord.js v14) mit **eigenem Shop- und Inventarsystem**.
Die Artikel gehören dem Bot und liegen in einer lokalen Datenbank – bezahlt wird
aber mit echtem **UnbelievaBoat-Guthaben** über dessen API.

> 🛠️ **Neu im Projekt?** [`ARCHITEKTUR.md`](ARCHITEKTUR.md) erklärt die
> Muster und Prinzipien hinter dem Code (Geldfluss, faule Abrechnung,
> Menü-Registry, Exploit-Schutz, Tests). Diese README beschreibt die Features
> aus Spielersicht.

## Befehle

| Befehl | Beschreibung |
|--------|--------------|
| `/shop [bereich]` | Öffnet das Autohaus – mit Buttons zum Blättern und Kaufen. |
| `/car <id>` | Zeigt ein Auto mit Foto, Preis und technischen Daten. |
| `/buy <id> [menge]` | Kauft einen Neuwagen (geht auch per Button im `/shop`). |
| `/sell <auto-id> <preis>` | Stellt ein Auto aus deiner Garage in den Gebrauchtmarkt. |
| `/mylistings` | Zeigt deine Inserate – mit Button zum Zurückziehen. |
| `/inventory [user] [seite]` | Zeigt die Garage von dir oder einem anderen User. |
| `/showcase [id] [user]` | Zeigt ein Auto aus der Garage groß her (ohne ID: das teuerste). |
| `/balance [user]` | Zeigt Bargeld / Bank / Gesamt aus UnbelievaBoat. |
| `/staat` | Zeigt die Staatskasse – den gemeinsamen Topf des Servers. |
| `/heimat` | Wohnsitz und Inhaltssprache – für welchen Markt du produzierst. |
| `/heist` | Der kriminelle Pfad: planen, vorbereiten, durchziehen. |
| `/musik` | Deine Musikkarriere: Songs, Releases, Konzerte, Tantiemen. |
| `/creator [plattform]` | Dein Netzwerk: Twitch, YouTube, Instagram, Twitter. |
| `/leaderboard` | Rangliste – jetzt auch nach **Reichweite**. |
| `/additem …` | **Admin:** legt einen Neuwagen an (Name, Preis, Marke, Bild, Lager …). |
| `/removeitem <id>` | **Admin:** löscht einen Artikel. |

## Die zwei Shops

`/shop` hat zwei Bereiche, zwischen denen ein Button umschaltet:

**✨ Neuwagen** — der feste Katalog. Unbegrenzter Vorrat, feste Preise.
Nur Admins können hier über `/additem` etwas hinzufügen.

**🔧 Gebrauchtwagen** — der Spielermarkt. Jeder kann mit `/sell` ein Auto aus
seiner Garage zum selbst gewählten Preis anbieten. Beim Kauf wandert das Geld
direkt vom Käufer zum Verkäufer.

Ein inseriertes Auto verlässt die Garage des Verkäufers (Treuhand) – so kann es
nicht gleichzeitig verkauft und behalten werden. Wird das Inserat zurückgezogen,
kommt das Auto zurück. Pro Spieler sind maximal 10 Inserate gleichzeitig erlaubt.

## Hauptmenü

`/menu` öffnet die zentrale Anlaufstelle. Von dort führt ein Button in jeden
Bereich, und aus jedem Bereich führt 🏠 zurück. Die Slash-Befehle bleiben als
Abkürzung bestehen – `/shop` springt direkt zu den Neuwagen.

### Ein neues Menü hinzufügen

Menüs stehen in einer Registry in [`src/menu.js`](src/menu.js). Ein neuer
Bereich braucht **genau einen Eintrag** – Button im Hauptmenü, Navigation und
Zurück-Weg entstehen automatisch:

```js
{
  id: 'werkstatt',
  label: 'Werkstatt',
  emoji: '🔩',
  description: 'Autos tunen und reparieren',
  adminOnly: false,          // optional
  build: (ctx) => ui.buildWerkstattView(ctx),
}
```

`build` bekommt `{ guildId, userId, page, isAdmin }` und gibt
`{ embeds, components }` zurück. Für Ansichten mit Seiten hilft
`navigationRow(id, seite, seiten, userId)` aus [`src/ui.js`](src/ui.js) –
die Blätter-Buttons und der Hauptmenü-Button sind darin schon enthalten.

Discord erlaubt 25 Buttons pro Nachricht, also bis zu 25 Menüpunkte.

## Bedienung per Buttons

Alle Menüs lassen sich mit Buttons steuern: ◀️ / ▶️ zum Blättern, ein Button
pro Auto zum Kaufen, und ein Umschalter zwischen Neu- und Gebrauchtwagen.

Die Button-IDs sind zustandslos aufgebaut (`shop|used|2|<userId>`) – dadurch
funktionieren die Buttons auch noch, **nachdem der Bot neu gestartet wurde**.
Bedienen darf sie nur, wer den Befehl aufgerufen hat.

## Immobilien

`/property` öffnet den Markt: 26 Objekte vom WG-Zimmer (12.000) bis zum Schloss
(18 Mio.), jeweils in **begrenzter Stückzahl**. Jedes Objekt lässt sich
**kaufen oder mieten**.

## Private Anbieter (NPCs)

Damit der Markt auch dann lebt, wenn gerade niemand etwas anbietet, stellen
computergesteuerte Anbieter eigene Anzeigen ein – Gebrauchtwagen mit echtem
Zustand, Wohnungen zum Kauf oder zur Miete.

Die Anzeigen stehen **serverweit**, nicht pro Spieler: wer zuerst nachschaut,
bekommt das Schnäppchen.

### Kommen und gehen

Beides ist zufällig:

- **Verschwinden:** Jede Anzeige bekommt bei der Erstellung eine eigene
  Laufzeit zwischen 1,5 und 4 Tagen.
- **Auftauchen:** Alle 3 Stunden gibt es eine 42-%-Chance, dass eine neue
  Anzeige eingeht. Dadurch kommen mal zwei an einem Abend, mal einen ganzen
  Tag lang keine.

Der Bestand schwankt damit frei zwischen 2 und 9 Anzeigen (Immobilien: 1–6).
Eine Untergrenze verhindert nur, dass der Markt komplett leerläuft.

Die Ankünfte hängen an der **vergangenen Zeit**, nicht am Öffnen der Ansicht:
wer den Markt zehnmal hintereinander aufruft, erzeugt dadurch keine einzige
neue Anzeige. Nach längerer Abwesenheit werden höchstens 48 Stunden
nachgeholt, damit der Markt nicht überläuft.

### Preisstreuung

Grundlage ist immer der **Zeitwert** (Neupreis × Zustand), nicht der Neupreis –
ein Wrack für 90 % vom Neupreis wäre absurd, 90 % vom Zeitwert dagegen fair.

| Stufe | Häufigkeit | Preis vom Zeitwert |
|-------|-----------|--------------------|
| 🔥 Verdächtig günstig | 4 % | 20–40 % |
| 💚 Günstig | 14 % | 45–75 % |
| ⚪ Marktüblich | 52 % | 85–115 % |
| 🟠 Überteuert | 22 % | 130–190 % |
| 🤡 Realitätsfern | 8 % | 250–500 % |

**Der Bot verrät nicht, ob ein Angebot gut ist.** Eine Anzeige zeigt nur den
geforderten Preis, eine grobe Zustandsstufe und den Verkäufer – kein Neupreis,
keine Prozentzahl, kein Zeitwert. Wer die Preise seines Servers nicht kennt,
kauft eben blind.

Auch nach dem Kauf gibt es keine Bewertung. Wer wissen will, ob er ein
Schnäppchen gemacht hat, verkauft weiter und sieht, was er bekommt.

Der Zustand erscheint im Markt nur als Stufe (*Gut*, *Abgenutzt*, …). Den
genauen Wert sieht man erst, wenn das Fahrzeug einem selbst gehört – in der
Garage, nach dem Kauf und in Schadensmeldungen.

Die Anzeigentexte sind dabei nicht immer ehrlich: ein Wagen mit 17 % Zustand
kann sich durchaus „scheckheftgepflegt" nennen. Der Zustandswert ist die
verlässliche Angabe, der Text nicht.

Dazu passende Verkäufernamen und Anzeigentexte, mit eigenen Formulierungen für
Miete und für beschädigte Fahrzeuge:

> **McLaren 720S** — 197.048 (58 % vom Zeitwert) · ✨ Neuwertig (95 %)
> 🧑‍💼 Frau Öztürk — _Steht nur rum, weg damit._

> **Jaguar F-Type R** — 446.594 (447 % vom Zeitwert) · 🙂 Gut (76 %)
> 🧑‍💼 Karsten aus Bochum — _SAMMLERSTÜCK!!! Wertsteigerung garantiert!!_

Konfiguration in [`src/data/npc.js`](src/data/npc.js), Logik in
[`src/npc.js`](src/npc.js).

## Heimat und Sprache

Wo du lebst und in welcher Sprache du sendest, entscheidet, für wen du Inhalte
machst: Die **Landessprache** hat einen kleinen Topf, bindet aber schnell und
zahlt gut – die Decke kommt früh. **Englisch** hat einen riesigen Topf, dafür
einen zähen Start. Superstar wird man nur international; auf Deutsch reicht es
bis Prominenz.

Die erste Wahl ist kostenlos. Danach kostet ein **Umzug** Geld, beendet den
Mietvertrag und lässt die eigene Wohnung im alten Land zurück (sie bleibt dein
Eigentum, gibt dir dort aber keinen Stellplatz mehr). Ein **Sprachwechsel**
kostet 45 % deiner Follower. `/heimat`

## Heists

Der kriminelle Pfad funktioniert wie ein Projekt statt wie ein Job: Ziel
aussuchen (vom Spätkauf bis zum Goldtransport), über Tage **vorbereiten**
(auskundschaften, Fluchtwagen, Funk, Kameras abschalten, Insider …), **Crew**
zusammenstellen – und dann entscheidet ein Wurf.

Ohne Vorbereitung ist der Erwartungswert **negativ**; mit voller Vorbereitung
wird es die lukrativste Sache im Spiel. Fehlschläge kosten Strafe, Knast und
manchmal die Ausrüstung, und die **Fahndung** steigt mit jedem Ding. `/heist`

## Musik

Die längste Strecke im Spiel: Songs aufnehmen, veröffentlichen, Konzerte
spielen – und **monatliche Hörer** sammeln, die Tantiemen zahlen, während du
schläfst. Das Land entscheidet strenger mit als überall sonst (Szene,
Tantiemen, wie schnell man vergessen wird), und du wählst einmal, ob du **mit
Gesicht** oder **anonym** auftrittst.

In Japan und Südkorea klopfen ab 100.000 Hörern **Idol-Agenturen** an: doppeltes
Tempo und ein Vorschuss gegen die Hälfte der Einnahmen, ein Umzugsverbot und
doppelt teure Skandale. Jede Veröffentlichung lässt außerdem deine Kanäle
mitwachsen. `/musik`

## Creator-Netzwerk

Vier Plattformen, ein Publikum: **Twitch** (Streams: Werbung, Spenden, Abos),
**YouTube** (Videos, die noch tagelang Aufrufe bringen), **Instagram** (wächst
am schnellsten, zahlt selbst nichts – Geld kommt nur über Kooperationen) und
**Twitter** (zahlt **nie** etwas, gibt aber Promo und Community).

Sie hängen zusammen: Jede Aktion spült Follower zu den anderen Kanälen, fremde
Reichweite zählt anteilig in die eigene hinein, und Ereignisse wie ein viraler
Clip oder ein Shitstorm wirken überall. Alles teilt sich ein Tagesbudget an
Zeit – ein Stream kostet 2, ein Video 3, ein Post oder Tweet 1.

Dazu **Sponsorenverträge** (Marken zahlen für gelieferte Beiträge – wer die
Frist reißt, zahlt Strafe), **Merch** (hängt an Community *und* Reichweite),
**Burnout** (wer täglich am Anschlag fährt, verliert Reichweite) und
**Vorfälle mit Entscheidung**: Der Sponsor ist ein Betrüger, ein alter Clip
taucht auf, das Finanzamt schreibt. Keine Option ist sicher, mit der Größe wird
es gefährlicher – und wer nicht reagiert, fährt am schlechtesten.

Der Ertrag wächst mit der Reichweite, bleibt aber gedeckelt: Publikum wächst
unterlinear zur Followerzahl (auch die übertragene), der Schwund linear. Die
Obergrenzen liegen bei mehreren Millionen Followern je Plattform – der Weg
dahin dauert Monate, dafür verdient ein großer Kanal ein Vielfaches des besten
Jobs. Details in [DUO.md](DUO.md#creator-netzwerk-).

## Staatskasse

Ein serverweiter Topf, der bei **jeder** Geldbewegung mitverdient: **19 %** bei
Ausgaben (Mehrwertsteuer) und **40 %** bei Einnahmen (Einkommensteuer).

**Der Spieler zahlt dafür nichts.** Der Anteil wird aus dem Betrag nur
berechnet und zusätzlich in die Kasse gelegt – ein Auto für 10 000 kostet
weiterhin genau 10 000, die Kasse notiert dazu 1 900. Preise und Verdienste
ändern sich durch das Feature an keiner Stelle.

Die Kasse ist **auf die Wohnsitzländer der Spieler aufgeteilt**: Jeder zahlt in
den Topf seines Landes, und `!laender` zeigt die Rangliste der reichsten
Staaten.

Aus der Kasse fließt nichts an Spieler zurück; sie ist eine reine Senke und
damit kein Gelddrucker im Sinne von [ARCHITEKTUR §3](ARCHITEKTUR.md). `/staat`
zeigt Stand, Aufteilung, die stärksten Bereiche, die größten Beitragszahler und
die letzten Zuflüsse. Ausführlich in [DUO.md](DUO.md#staatskasse-der-gemeinsame-topf).

## Casino

`/menu` → 🎰 **Casino** ist ein Ein-Panel-Erlebnis: ein Spiel wählen, den
Einsatz per Chip (100 / 1K / 10K / 100K / Max) oder eigenem Betrag setzen,
spielen – alles in derselben Nachricht, ohne Menü-Springerei.

| Spiel | Auszahlung | RTP (Rückzahlungsquote) |
|-------|-----------|-------------------------|
| 🪙 Coinflip | Gewinn 2× | 100,0 % (fair) |
| 🎰 Slots | Paar = Einsatz, Dreier 7×–120× | 92,2 % |
| 🃏 Blackjack | Gewinn 2×, Blackjack 2,5× | ~94 % |
| 🎡 Roulette | Rot/Schwarz 2×, Dutzend 3×, Grün 36× | 97,2 % |

**Kein Gelddrucker:** Jedes Spiel hat einen Rückzahlungswert von ≤ 100 % – das
Casino ist auf Dauer eine Geldsenke, keine Quelle. Die RTPs sind per
Monte-Carlo über je 2 Mio. Runden in [`test/casino.test.js`](test/casino.test.js)
kalibriert und geprüft. Coinflip ist exakt fair (EV 0), alle anderen haben
einen Hausvorteil.

### Technik

- **Blackjack** nutzt einen 4-Deck-Schuh, Dealer zieht bis 17 (Hit auf Soft 17)
  und zahlt Blackjack 3:2. Kartenwerte mit flexiblem Ass. Der Rundenzustand
  liegt in der Datenbank (zu groß für eine Button-ID), höchstens eine Runde
  pro Spieler.
- **Doppelklick-Schutz:** Der Einsatz wird abgebucht bzw. die Runde
  synchron reserviert, *bevor* der erste `await` passiert – ein zweiter
  schneller Klick findet eine laufende Runde vor und wird abgewiesen. Ebenso
  wird die Runde vor der Auszahlung gelöscht, sodass kein zweiter Klick doppelt
  kassiert. Geprüft in den Tests.
- **Eigener Einsatz** über ein Discord-Modal (Texteingabe), auf 10 – 1.000.000
  begrenzt.
- Geld läuft über genau einen `changeCash`-Aufruf pro Runde (Netto), damit kein
  Zwischenstand Geld erzeugt oder verliert.

## Postfach

`/menu` → 📬 **Postfach** sammelt alles, was auf eine Antwort wartet:

| Typ | Aktion |
|-----|--------|
| 🤝 Kaufangebot | annehmen oder ablehnen |
| ✅ Verkauft | nur Information |
| 🧾 Rechnung | bezahlen |

### Interessenten für eigene Inserate

Wer etwas über `/sell` inseriert, bekommt mit der Zeit Reaktionen: entweder
kauft jemand zum geforderten Preis, oder es kommt ein Gegenangebot ins
Postfach. Wie schnell, hängt vom Preis ab.

**Die zentrale Regel: ein NPC zahlt niemals mehr als den Zeitwert.**

Ohne diese Grenze wäre das Ganze ein Gelddrucker – Auto zum Listenpreis
kaufen, überteuert inserieren, warten, Gewinn. Mit ihr ist Verkaufen
bestenfalls ein Nullsummengeschäft. Gewinn entsteht ausschließlich dadurch,
dass man vorher günstig eingekauft hat.

| Preis (Anteil am Zeitwert) | Kaufchance pro Tag |
|---------------------------|--------------------|
| 35 % | ~90 % |
| 60 % | ~48 % |
| 80 % | ~19 % |
| 95 % | ~2 % |
| **ab 100 %** | **0 %** |

Gegenangebote liegen immer unter der Forderung **und** unter dem Zeitwert –
beide Grenzen zusammen schließen aus, dass sich über Verhandlungen Geld
erzeugen lässt. Je überzogener das Inserat, desto eher wird gehandelt statt
gekauft; das ist die Rückmeldung, dass der Preis zu hoch ist.

Geprüft wird das in [`test/buyers.test.js`](test/buyers.test.js) mit 20.000
Gebots-Stichproben und einer Simulation über 1.000 Kauf-Verkauf-Runden auf
fünf Preisstufen. Ergebnis: auf jeder Stufe Verlust, nie Gewinn.

### Rechnungen

Die Infrastruktur steht vollständig – erstellen, anzeigen, bezahlen, mahnen
(15 % Gebühr bei verstrichener Frist). **Erzeugt werden derzeit noch keine
Rechnungen**: welche Kosten es geben soll (Kfz-Steuer, Grundsteuer,
Versicherung, Reparaturen), ist eine Balance-Entscheidung und bewusst offen.

Ein neuer Rechnungstyp braucht nur einen Aufruf:

```js
bills.create({
  guildId, userId,
  title: 'Kfz-Steuer 2026',
  body: 'Für alle zugelassenen Fahrzeuge.',
  sender: 'Finanzamt',
  amount: 1200,
  dueDays: 7,
});
```

Bewusst gibt es **keine** automatische Abbuchung und keine Pfändung – wer
nicht zahlen kann, soll nicht in eine ausweglose Schuldenspirale rutschen.
Die Mahngebühr macht Aufschieben trotzdem unattraktiv.

## Fahrzeugzustand

Jedes Auto hat einen Zustand von 0 bis 100. Neu gekauft startet er bei 100.
Der Zustand bestimmt den Wert:

```
Wert = Neupreis × (0,30 + 0,70 × Zustand/100)
```

Ein Totalschaden ist also noch 30 % wert (Teile, Schrott), ein neuwertiger
Wagen 100 %. Die Formel steht in [`src/condition.js`](src/condition.js) und
noch einmal als SQL in der Garagenwert-Abfrage – beide müssen zusammenpassen,
darauf prüft ein Test.

| Zustand | Stufe |
|---------|-------|
| 90–100 | ✨ Neuwertig |
| 70–89 | 🙂 Gut |
| 50–69 | 😐 Gebraucht |
| 30–49 | 🔧 Abgenutzt |
| 15–29 | 🛠️ Beschädigt |
| 0–14 | 💀 Schrott |

Der Zustand überlebt die Treuhand: wer ein zerkratztes Auto inseriert,
verkauft es zerkratzt, und der Käufer sieht das vorher.

**Jedes Modell gibt es nur einmal pro Spieler.** Der Zustand hängt am
Besitzeintrag – zwei Wagen desselben Modells mit unterschiedlichem Zustand
ließen sich in einer Mengen-Spalte nicht abbilden.

## Risiko auf der Straße

Autos, für die kein überdachter Stellplatz da ist, parken auf der Straße.
Dabei gilt: **die wertvollsten Wagen kommen zuerst in die Garage** – niemand
stellt den Ferrari raus und den Corsa rein.

Pro Auto und Nacht draußen:

| Ereignis | Chance | Folge |
|----------|--------|-------|
| 🪛 Zerkratzt | 10 % | −3 bis −10 Zustand |
| 💥 Beschädigt | 3,5 % | −15 bis −35 Zustand |
| 🚨 Gestohlen | 0,3–2 % | Auto weg |

Das Diebstahlrisiko wächst mit dem Wert: ein Corsa wird im Schnitt nach 313
Nächten gestohlen, ein Chiron nach 50. Wer teure Autos ohne Garage parkt,
verliert sie.

Abgerechnet wird faul, wie die Miete. Zwei Sicherungen:

- Beim **allerersten** Mal wird nur der Zeitpunkt gemerkt – niemand wird
  rückwirkend für Tage bestraft, an denen es das Feature noch nicht gab.
- Höchstens **14 Nächte** werden nachgeholt. Nach längerer Abwesenheit ist die
  Rückkehr damit unangenehm, aber nicht vernichtend.

Die Garage schützt vollständig – das ist der eigentliche Grund, eine Immobilie
mit Stellplätzen zu besitzen.

### Stellplätze begrenzen den Autobesitz

Jeder hat 2 Straßenplätze. Immobilien bringen weitere Stellplätze mit – vom
Hausboot (0) bis zum Schloss (15). **Ohne freien Platz kein Autokauf**, auch
nicht auf dem Gebrauchtmarkt.

```
Kapazität = 2 (Straße) + gekaufte Immobilien + Mietobjekt
```

Das ist eine harte Grenze: `/menu` → 🔑 Mein Besitz zeigt die Auslastung.

### Miete

Die Tagesmiete beträgt etwa Kaufpreis/350 – nach knapp einem Jahr Miete hätte
man das Objekt auch kaufen können.

Abgerechnet wird **faul**: Sobald ein Spieler den Bot benutzt, werden die
seither vergangenen Tage nachberechnet und abgebucht. Dadurch braucht es keinen
Hintergrundjob und keine Zeitsteuerung. Wer nicht zahlen kann, wird
**zwangsgeräumt** und verliert die Stellplätze – die Autos bleiben, aber neue
lassen sich erst wieder kaufen, wenn Platz da ist.

Ein gemietetes Objekt zählt gegen den Bestand: mietet jemand die einzige
Berghütte, ist sie für alle anderen weg, bis er kündigt.

### Ein Markt für alles

`/property` zeigt **alle** Angebote in einer Liste, nach Preis sortiert:

| Quelle | Aktionen |
|--------|----------|
| 🏢 Vom Markt | kaufen oder mieten |
| 🧑 Von Spieler · Verkauf | kaufen |
| 🧑 Von Spieler · Miete | mieten |

Getrennte Menüpunkte für „kaufen" und „mieten" wären unübersichtlich gewesen,
weil dasselbe Objekt in beiden auftaucht. Die Detailansicht zeigt je nach
Herkunft nur die Buttons, die tatsächlich möglich sind.

Technisch steckt die Herkunft im Button-Schlüssel (`m` = Markt, `s` = Verkauf,
`o` = Mietangebot), sodass eine einzige Ansicht alle drei Quellen bedient.

### Immobilien an Spieler verkaufen

```bash
/sell <objekt-id> <preis>
```

Derselbe Befehl wie bei Autos – er erkennt automatisch, worum es geht, und
sortiert das Inserat in den passenden Markt ein. Ausrüstung bleibt
ausgeschlossen: ein gebrauchter Führerschein ergibt keinen Sinn.

Ein inseriertes Objekt liegt in Treuhand, ist also bis zum Verkauf aus dem
Besitz – **inklusive der Stellplätze**. Eine bewohnte Immobilie lässt sich
nicht verkaufen, sonst stünde der Mieter plötzlich bei einem fremden
Eigentümer.

### Vermieten an Spieler

```bash
/rentout <objekt-id> <preis pro tag>
```

Die Miete geht **direkt an den Vermieter**. Der vereinbarte Preis wird im
Vertrag gespeichert – unabhängig vom Katalogwert des Objekts.

**Wer vermietet, gibt die Garage ab.** Die Stellplätze zählen dem Mieter,
nicht dem Eigentümer. Das verhindert, dass man Objekte vermietet und trotzdem
die Plätze behält – kann den Vermieter aber selbst in die Überkapazität
bringen, worauf `/rentout` hinweist.

Zieht der Vermieter sein Angebot zurück, endet ein laufender Vertrag sofort.

### NPC-Mieter

Bietest du eine Immobilie über `/rentout` an, kann sich mit der Zeit ein
computergesteuerter Mieter finden – auch dann, wenn kein Spieler zugreift. Er
zahlt dir täglich Miete und kann irgendwann von selbst wieder ausziehen. Ein-
und Auszug landen als Nachricht im 📬 Postfach, die Einnahmen erscheinen beim
nächsten Öffnen eines relevanten Menüs.

Ein NPC-Mieter belegt die Immobilie wie ein Spieler-Mieter: die Stellplätze
gehen für die Dauer an ihn über. Ziehst du das Angebot zurück, fliegt er raus.

**Exploit-Schutz:** Ein NPC zieht nur ein, wenn die geforderte Miete höchstens
das **1,5-fache der marktüblichen Miete** beträgt. Wer 1.000.000/Tag für eine
Wohnung verlangt, findet niemanden. Dadurch ist die Mieteinnahme eine langsame
Rendite auf ein großes, gebundenes Investment – über 200 Tage Dauervermietung
kommt weniger herein als der Kaufpreis (geprüft in
[`test/tenants.test.js`](test/tenants.test.js)), also kein Gelddrucker.

### Zu wenig Stellplätze

Wer mehr Autos als Plätze hat – nach Zwangsräumung, Kündigung oder weil er
selbst vermietet hat – bekommt **7 Tage Zeit**, das zu regeln.

Läuft die Frist ab, werden **zufällig** so viele Fahrzeuge zwangsverkauft, bis
es wieder passt. Der Erlös liegt bei **40–95 %** des Kaufpreises, pro Fahrzeug
neu ausgewürfelt: ein Zwangsverkauf ist nie so gut wie ein selbst gewählter.

Die Frist läuft ab dem ersten Mal, an dem die Überkapazität auffällt, und wird
durch wiederholtes Nachsehen nicht verlängert.

## Arbeitsamt

`/jobs` zeigt **5 zufällige Stellenangebote pro Tag**. Die Auswahl wird aus
`(Server, Spieler, Datum)` berechnet – jeder hat sein eigenes Angebot, es
bleibt den ganzen Tag stabil, und neu Aufrufen würfelt nicht neu. Gespeichert
werden muss dafür nichts.

Jobs haben fünf Seltenheitsstufen. Wie oft sie im Angebot auftauchen, steuern
die Gewichte in [`src/jobs.js`](src/jobs.js):

| Stufe | Verdienst | Erscheint etwa |
|-------|-----------|----------------|
| ⚪ Alltäglich | 70 – 200 | mehrmals täglich |
| 🟢 Solide | 260 – 400 | fast täglich |
| 🔵 Selten | 480 – 750 | alle 2–3 Tage |
| 🟣 Sehr selten | 1.200 – 1.800 | alle ~9 Tage |
| 🟠 Legendär | 3.200 – 5.000 | alle ~36 Tage |

Die Werte sind über eine Simulation in [`test/jobs.test.js`](test/jobs.test.js)
kalibriert und werden dort auch geprüft.

Mit `/work` (oder dem Button) arbeitest du eine Schicht. Der Verdienst schwankt
um ±15 %, danach läuft ein jobabhängiger Cooldown.

### Arbeitszeit

Eine Schicht entspricht etwa **zwei Stunden** Arbeit, und mehr als **vier
Schichten am Tag** – also acht Stunden – erlaubt das Arbeitsamt nicht. Der
Zähler springt um Mitternacht zurück, zusammen mit dem neuen Stellenangebot.

Der Cooldown pro Job bleibt zusätzlich bestehen: er bestimmt, wie schnell die
vier Schichten abgearbeitet werden können. Bei allen Jobs sind vier Schichten
innerhalb von 24 Stunden erreichbar (geprüft in
[`test/shifts.test.js`](test/shifts.test.js)).

### Verschleiß

Physische Ausrüstung kann bei der Arbeit kaputtgehen und muss dann neu gekauft
werden. Die Wahrscheinlichkeit hängt an der **Kategorie**, nicht am einzelnen
Artikel – dadurch sind Führerscheine und Ausbildungen strukturell unzerstörbar
und können nicht versehentlich verschleißen:

| Kategorie | Verschleiß pro Schicht | Hält etwa |
|-----------|------------------------|-----------|
| 🔧 Werkzeug, Ausstattung | 4 % | 25 Schichten |
| 🔧 Technik | 2 % | 50 Schichten |
| 🛡️ Führerschein, Ausbildung | 0 % | für immer |

Teure Geräte halten länger (`wear` in [`src/data/gear.js`](src/data/gear.js)):
die Hebebühne 125 Schichten, der Serverschrank 167.

Im Shop markiert 🔧 Verschleißteile und 🛡️ unzerstörbare Qualifikationen.
Verschleiß wird erst **nach** erfolgreicher Bezahlung abgerechnet – niemand
verliert Ausrüstung für Arbeit, die nicht vergütet wurde. Geht das letzte
benötigte Teil kaputt, blockiert das den Job, bis Ersatz gekauft ist.

### Voraussetzungen

Bessere Jobs verlangen Ausrüstung aus dem Shop `/menu` → 🧰 **Ausrüstung**:

```js
requires: [{ item: 'Pilotenlizenz' }]   // dieser Artikel im Besitz
requires: [{ car: 200000 }]             // ein Auto ab diesem Wert
```

Die zweite Form verbindet Arbeitsamt und Autohaus: der *Rennfahrer* braucht
einen Wagen ab 200.000, der *Werksfahrer* ab einer Million.

`node src/seed-gear.js <server-id>` prüft beim Anlegen automatisch, ob jede
Job-Voraussetzung auch wirklich käuflich ist, und meldet Lücken.

## Nach Marke filtern

Im Neuwagen-Shop führt **🏷️ Nach Marke filtern** zu einer Übersicht mit einem
Button pro Hersteller (inklusive Anzahl und Preisspanne). Ein Klick auf *Audi*
zeigt nur Audis – die Marke bleibt beim Blättern erhalten, weil sie in der
Button-ID steckt (`menu|new|2|Audi|<userId>`).

Die Markenauswahl fasst 20 Marken pro Seite und blättert darüber hinaus.

## Autohaus-Katalog

Der Katalog steht in [`src/data/catalog.js`](src/data/catalog.js) – rund 70
reale Autos von 900 bis 3.500.000, vom Opel Corsa B bis zum Koenigsegg Jesko.
Preise orientieren sich an realen Marktpreisen, die Beschreibungen enthalten
echte Leistungsdaten.

```bash
npm run seed -- <server-id>            # anlegen
npm run seed -- <server-id> --reset    # vorher alles löschen
```

Ein neues Auto ergänzt du mit einem Eintrag in `catalog.js` und einem Lauf von
`npm run images` – das Foto wird automatisch gesucht.

### Bilder & Lizenzen

Die Fotos stammen von **Wikimedia Commons** und stehen unter freien Lizenzen
(CC BY, CC BY-SA, gemeinfrei). Urheber und Lizenz sind pro Auto gespeichert und
werden im Bot über dem Bild angezeigt – das erfüllt die Namensnennungspflicht
der CC-Lizenzen.

```bash
npm run images   # Fotos suchen und prüfen -> src/data/images.json
npm run audit    # gefundene Fotos gegen die Modellnamen gegenprüfen
```

### Ein Bild austauschen

**Wichtig:** Der Bot liest seine Bilder aus der **Datenbank**, nicht aus den
JSON-Dateien – die sind nur die Vorlage für den Seed. Wer eine URL in
`src/data/images.json` oder `src/data/property-images.json` ändert, muss sie
nachziehen:

```bash
npm run sync:images -- <server-id> --check   # zeigt, was sich ändern würde
npm run sync:images -- <server-id>           # überträgt es
```

Das Script prüft jede neue URL vorher per HTTP und lehnt sie ab, wenn sie kein
darstellbares Bild liefert. Es fasst **ausschließlich** das Bild an – Preise,
Bestände und Inventare bleiben unberührt.

Nicht `npm run seed -- … --reset` dafür benutzen: das löscht die Artikel und
nimmt per `ON DELETE CASCADE` auch den Besitz aller Spieler mit.

`npm run images` akzeptiert nur eindeutig freie Lizenzen, verlangt mindestens
800 px Breite und prüft jede URL per HTTP. Der Dateiname muss außerdem Marke
**und** Modell enthalten – mit Wortgrenzen, sonst landet z.B. ein *GLA 45* beim
*A 45*. `npm run audit` sucht genau nach solchen Verwechslungen.

Wer eigene Autos ergänzt (`/additem` mit `bild:`), sollte ebenfalls nur frei
lizenzierte Bilder verwenden und die Quelle über `bildquelle:` angeben.
Beliebige Autofotos aus dem Netz sind in aller Regel urheberrechtlich geschützt.

Die Admin-Befehle sind über `Server verwalten` abgesichert und für normale
Mitglieder gar nicht erst sichtbar.

## Architektur

```
Artikel + Inventare  ->  lokale SQLite-Datenbank (data/shop.db)
Geld (Bargeld/Bank)  ->  UnbelievaBoat-API
Währungssymbol       ->  UnbelievaBoat-API (serverspezifisch, gecacht)
```

Der Bot liest **nicht** aus UnbelievaBoats eigenem Shop – er hat seinen eigenen
Katalog. Das Währungssymbol wird automatisch vom Server übernommen (z.B. ein
eigenes Emoji), es muss nichts konfiguriert werden.

Als Datenbank dient das in Node eingebaute `node:sqlite` – keine zusätzliche
Abhängigkeit, keine Installation.

## Voraussetzungen

- Node.js **22+** (wegen `node:sqlite`; getestet mit v26)
- Ein Discord-Bot: https://discord.com/developers/applications
- UnbelievaBoat muss auf dem Server sein und eine Economy haben.
- Ein UnbelievaBoat-**API-Token**: https://unbelievaboat.com/applications
  Die dortige Application muss für deinen Server autorisiert sein.

## Einrichtung

```bash
npm install
cp .env.example .env      # dann Werte eintragen
```

`.env` ausfüllen:

- `DISCORD_TOKEN` – Bot-Token aus dem Discord Developer Portal (Bot → Reset Token)
- `DISCORD_CLIENT_ID` – Application ID (General Information)
- `UNB_TOKEN` – der UnbelievaBoat-API-Token (nur der Token, **ohne** `Bearer`/`Bot`)
- `DEV_GUILD_ID` – *optional*: Server-ID zum sofortigen Registrieren beim Entwickeln.
  Leer lassen → Commands werden global registriert (bis zu 1 h Verzögerung).

## Starten

```bash
npm run deploy   # Slash-Commands registrieren (bei Änderungen an den Befehlen)
npm start        # Bot starten
```

## Wie der Kauf funktioniert

1. Artikel & Preis aus der lokalen Datenbank lesen
2. Guthaben über die UnbelievaBoat-API prüfen (Bargeld **und** Bank)
3. Lokal reservieren: Lagerbestand abziehen + ins Inventar legen (eine Transaktion)
4. Geld abbuchen – fehlt Bargeld, wird der fehlende Teil automatisch von der Bank abgehoben
5. Scheitert die Geldbuchung, wird die lokale Reservierung zurückgerollt

Die Reihenfolge ist Absicht: der lokale Schritt lässt sich zuverlässig rückgängig
machen, eine fehlgeschlagene Rückerstattung über die API dagegen nicht.

Der Lagerbestand wird per `UPDATE … WHERE stock >= menge` abgezogen, sodass zwei
gleichzeitige Käufe des letzten Stücks nicht beide durchgehen können.

## Datenbank

Liegt in `data/shop.db` (per `.gitignore` ausgeschlossen). Zum Zurücksetzen
einfach löschen – die Tabellen werden beim nächsten Start neu angelegt.
Ein Backup ist schlicht eine Kopie der Datei.
