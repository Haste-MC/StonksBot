/**
 * ===========================================================================
 *  PATCHNOTES
 * ===========================================================================
 *
 * Änderungsliste des Bots. **Die neueste Version steht ganz oben.**
 *
 * Wer den Bot benutzt und eine neuere Version noch nicht gesehen hat, bekommt
 * die Notes einmalig ins Postfach gelegt (siehe src/patchnotes.js) – plus einen
 * kurzen Hinweis-Toast. Danach nie wieder, bis eine neue Version dazukommt.
 *
 * Eine neue Version veröffentlichen = oben einen Eintrag ergänzen. Sonst nichts.
 *
 *   version  eindeutig, wird pro Spieler als "gesehen" gemerkt
 *   date     Anzeigedatum
 *   title    kurze Überschrift
 *   lines    Stichpunkte (werden als Liste dargestellt)
 */
module.exports = [
  {
    version: '1.25.0',
    date: '2026-09-06',
    title: 'Neues Zeug in den Garagen',
    lines: [
      '📦 **32 neue Fundstücke** – vom Game Boy mit Tetris-Modul über den Manga-Karton und den Arcade-Automaten bis zur Tastatur ohne W, A, S und D.',
      '💎 **Und ein paar, bei denen der Auktionator kurz still wird:** versiegeltes Super Mario 64, 1st-Edition-Glurak im Slab, Goldbarren unter dem Fußboden, ein Zettel mit einem Seed-Phrase-Backup.',
      '🎁 **Die dicken Stücke kosten dich nichts extra:** Sie zählen voll zum Inhalt, aber nicht zum Startpreis – du bezahlst nicht in jeder Garage eine Lotterie mit.',
      '🎰 Die Auktion bleibt damit, wie sie war: Die typische Garage ist rund das 1,7-Fache ihres Aufrufpreises wert, jede zehnte ist eine Niete.',
    ],
  },
  {
    version: '1.24.0',
    date: '2026-09-06',
    title: 'Überfälle wie drüben',
    lines: [
      '🎭 **`!rob` auf Fluxer funktioniert jetzt wie UnbelievaBoats Version auf Discord:** fifty-fifty, und bei Erfolg ist das **komplette Bargeld** des Opfers weg.',
      '🏦 **Die Bank ist die Antwort darauf.** Erbeutbar ist nur Bargeld – wer einzahlt, ist unantastbar.',
      '⚖️ **Fehlschlag kostet höchstens 2.000** (vorher 5.000), und die Strafe kommt notfalls von der Bank. Wer alles eingezahlt hatte, kam vorher straffrei davon.',
      '🛡️ Unverändert: Opfer mit weniger als 500 Bargeld sind geschützt, 2 Stunden Pause zwischen zwei Versuchen.',
    ],
  },
  {
    version: '1.23.0',
    date: '2026-09-06',
    title: 'Das Auktionshaus lohnt sich endlich',
    lines: [
      '💰 **Garagen starten jetzt weit unter ihrem Wert.** Die typische Garage ist rund das **1,7-Fache** ihres Aufrufpreises wert – neun von zehn lohnen sich. Vorher war es genau andersherum.',
      '🔥 **Deshalb lohnt sich Hochbieten:** Bis etwa **+68 %** über dem Startpreis rechnet sich die typische Garage noch. Darüber schlägt der Fluch des Gewinners zu – das ist die Entscheidung.',
      '🔍 **Der Auktionator schätzt.** Jede Garage bringt eine Spanne mit, in der ihr Wert vermutlich liegt. Er trifft meistens. Meistens.',
      '⏱️ **Anti-Snipe:** Ein Gebot in den letzten Sekunden verlängert die Auktion. Wer gewinnen will, muss mehr bieten – nicht später klicken.',
      '📣 **Zuschläge werden angesagt**, damit man mitbekommt, was gerade weggeht.',
      '🎰 Nieten gibt es weiterhin: Jede zehnte Garage ist ihren Preis nicht wert.',
    ],
  },
  {
    version: '1.22.0',
    date: '2026-09-06',
    title: 'Heists: Entscheidungen mittendrin',
    lines: [
      '🎬 **Ein Ding läuft jetzt in Szenen ab.** Alarmanlage, Wachmann, Tresor, Zeuge, Streife … Jede Szene verlangt eine Entscheidung, und jede Option ist ein Tauschgeschäft: Sicherheit gegen Beute.',
      '👥 **In der Crew kommt reihum jeder mindestens einmal dran** – es gibt nie weniger Szenen als Köpfe. Allein entscheidet man alles selbst.',
      '⏳ **Niemand blockiert das Ding:** Antwortet jemand fünf Minuten nicht, darf die Crew für ihn entscheiden. Aussteigen geht mittendrin nicht mehr.',
      '📊 **Am Ende steht, was eure Entscheidungen gebracht haben** – als eigener Posten in der Erfolgschance.',
      '⚖️ **Und trotzdem kein Freifahrtschein:** Auch wer immer die sicherste Option nimmt, macht aus einem unvorbereiteten Ding kein Geschäft. Nachgerechnet für jedes Ziel.',
    ],
  },
  {
    version: '1.21.0',
    date: '2026-09-06',
    title: 'Applaus fürs Treppchen',
    lines: [
      '🥇 **Wer auf Platz 3, 2 oder 1 der Reichsten steigt, wird gefeiert** – mit einer Meldung auf beiden Plattformen, inklusive dem, den er überholt hat, und seinem Vermögen.',
      '🔕 **Ohne Ping.** Namen werden angezeigt, aber niemand wird angeschrien – @everyone schon gar nicht.',
      '🤫 **Und ohne Spam:** Nur Aufstiege zählen, jeder Platz hat eine Sperrfrist, und wer nur bei einem Börsentick kurz vorbeizieht, löst nichts aus.',
    ],
  },
  {
    version: '1.20.0',
    date: '2026-09-06',
    title: 'Titel und ein größeres Profilbild',
    lines: [
      '🏅 **Jeder bekommt einen Titel.** Er richtet sich danach, was du am häufigsten machst: Ganove, Angler, Börsenhai, Immobilienmogul … Zwölf Aktivitäten mit je drei Stufen – ab dem 1., dem 26. und dem 101. Mal.',
      '✍️ **Oder du wählst selbst:** Im Profil unter 🏅 Titel. Zur Auswahl steht, was du auch wirklich getan hast – dazu „Automatisch" und „Keiner".',
      '🖼️ **Das Profilbild ist zurück in der Ecke** und wieder groß, oben rechts. Auf Fluxer bleibt es beim Namen, weil dort nur diese Stelle Bilder zeigt.',
      '📜 **Deine Vorgeschichte zählt mit:** Geleistete Schichten, gedrehte Dinger, Creator-Aktionen, Songs, Releases, Konzerte und Fundstücke werden einmalig übernommen – der Titel steht also sofort.',
    ],
  },
  {
    version: '1.19.0',
    date: '2026-09-06',
    title: 'Level zählt jetzt überall',
    lines: [
      '💰 **Der Level-Zuschlag gilt für jede Einnahme**, nicht mehr nur für Schichten, Tagesbonus und `!work`: Heist-Beute, Konzerte, Idol-Vorschuss, Sponsorenprämien, Mieteinnahmen, Rollen-Einkommen und gute Ausgänge bei Vorfällen bekommen ihn jetzt auch. Bis zu **+60 %** ab Level 30.',
      '⚖️ **Strafen wachsen nicht mit.** Ein hohes Level macht das Bußgeld nach einem misslungenen Ding kein Stück teurer.',
      '🎰 **Nicht überall, und das mit Absicht:** Casino, Börse, Verkäufe, Auktionsfunde und Überfälle bleiben außen vor – dort wäre der Zuschlag kein Bonus, sondern eine Gelddruckmaschine.',
      '👤 **Namen statt Zahlenkolonnen:** In der Rangliste standen Spieler, die den Bot nie benutzt haben, als nackte ID da. Ihre Namen werden jetzt bei Bedarf nachgeschlagen – und wo wirklich keiner zu finden ist, steht „Spieler #1234" statt einer 19-stelligen Zahl.',
    ],
  },
  {
    version: '1.18.0',
    date: '2026-09-06',
    title: 'Vermögen zählt jetzt alles',
    lines: [
      '💰 **Networth rechnet endlich vollständig:** Bargeld, Bank, Autos, Immobilien, **Depot** und die **Sammlung aus den Auktionen**. Wer 50.000 in Fundstücken liegen hatte, sah bisher aus wie ein Habenichts.',
      '🏆 **`!top` und `/top` zeigen vier Sichten:** Vermögen (neu und Standard), Gesamtguthaben, Bargeld, Bank. Beim Vermögen steht unter jeder Zeile, woraus es besteht.',
      '👥 **Jeder ist dabei:** In der Rangliste steht jetzt auch, wer Geld oder Besitz hat, ohne je etwas mit mir gemacht zu haben – und wer nur besitzt, aber pleite ist.',
      '📣 **Ruft jemand `!top`, antworte ich mit:** Neben der Liste von UnbelievaBoat steht dann unsere – die kennt auch Besitz und die Fluxer-Spieler. Auf Wunsch räume ich ihre Liste danach weg, dann bleibt nur meine stehen.',
      '🧾 **Menü aufgeräumt:** Die Kategorien zählten ihre Menüpunkte doppelt auf. Und im Profil stand dasselbe Autofoto zweimal, wenn keine Immobilie da war.',
      '🎰 **Fluxer:** Eigene Eingaben (Casino-Einsatz, Gebot, Stückzahl, Spruch, Titel) wurden nie angenommen – die Antwort landete unter der falschen Kennung. Behoben.',
    ],
  },
  {
    version: '1.17.1',
    date: '2026-09-06',
    title: 'Heist-Ausrüstung war unsichtbar',
    lines: [
      '🧰 **Die neue Ausrüstung stand nicht im Shop.** Sturmmaske, Brecheisen, Funkgeräte, Dietrich-Set, Störsender und Sprengsatz gab es im Katalog, aber nicht zu kaufen – der Laden liest aus der Datenbank, und die kannte sie noch nicht.',
      '🔄 **Behoben, und zwar dauerhaft:** Der Bot gleicht neue Artikel jetzt bei jedem Start selbst ab. Nur Fehlendes wird angelegt – geänderte Preise und gelöschte Artikel bleiben, wie sie sind.',
      '🕵️ Zu finden unter 🧰 Ausrüstung in der Kategorie **Untergrund**.',
    ],
  },
  {
    version: '1.17.0',
    date: '2026-09-05',
    title: 'Heists',
    lines: [
      '🕵️ **Der kriminelle Pfad:** Sieben Ziele vom Spätkauf bis zum Goldtransport. Ein Ding ist kein Job, sondern ein Projekt – aussuchen, tagelang vorbereiten, Crew holen, durchziehen. `/heist`',
      '📋 **Elf Vorbereitungen:** auskundschaften, Fluchtwagen, Masken, Funk, Kameras abschalten, Störsender, Insider, Sprengung, Schmiere stehen, Hehler. Jeder Schritt hebt die Chance oder die Beute – und kostet.',
      '🧰 **Vier Ausrüstungsstufen** neu im Shop: Sturmmaske, Brecheisen, Funkgeräte, Dietrich-Set, Störsender, Sprengsatz. Es zählt die beste Ausrüstung am Tisch.',
      '👥 **Mit Crew:** Offene Planungen sieht jeder, wer beitritt teilt Beute und Strafe. Mehr Leute = sicherer und mehr Beute, aber weniger je Kopf. Der Anführer bekommt 15 % Aufschlag.',
      '🚨 **Wenn es schiefgeht:** Strafe, Knast (bis 72 Stunden, in denen gar nichts geht) und beim Desaster die Ausrüstung. Die **Fahndung** steigt mit jedem Ding und drückt die Chance um bis zu 25 Punkte.',
      '⚖️ **Ehrlich gerechnet:** Ohne Vorbereitung ist jedes Ding ein Verlustgeschäft – der Test rechnet das für jedes Ziel nach. Erst die Investition dreht es ins Plus.',
    ],
  },
  {
    version: '1.16.0',
    date: '2026-09-05',
    title: 'Musik',
    lines: [
      '🎵 **Musikkarriere:** Songs aufnehmen, veröffentlichen, Konzerte spielen. Statt Followern sammelst du **monatliche Hörer** – und die zahlen Tantiemen, auch wenn du schläfst. `/musik`',
      '🌍 **Das Land zählt mehr als überall sonst:** Szene, Tantiemen und Strenge unterscheiden sich massiv. Japan zahlt je Abruf das Siebenfache Indiens, Korea vergisst dich am schnellsten.',
      '🎭 **Zwei Wege:** Mit Gesicht wachsen deine Kanäle kräftig mit und Konzerte zahlen voll. **Anonym** (wie Ado) bringt mehr Abrufe je Hörer und schützt vor Skandalen – dafür bleiben die Socials klein. Einmal enthüllen geht, zurück nie.',
      '📜 **Idol-Verträge** in Japan und Südkorea: Vorschuss und doppeltes Tempo gegen die Hälfte deiner Einnahmen, ein Umzugsverbot und doppelt teure Skandale. 90 Tage Laufzeit.',
      '🔗 **Musik macht Socials:** Jede Veröffentlichung bringt Follower auf allen vier Plattformen, und deine Hörer zählen als Publikum für die Kanäle.',
      '⏳ **Ein Tag, ein Budget:** Studio, Releases und Konzerte kosten dieselbe Zeit wie Streams – wer im Studio war, streamt abends nicht mehr.',
    ],
  },
  {
    version: '1.15.1',
    date: '2026-09-05',
    title: 'Profilbild auf Fluxer',
    lines: [
      '🖼️ **Das Profilbild war auf Fluxer unsichtbar.** Es hing im Miniaturbild des Embeds – das stellt Fluxer nicht dar. Jetzt sitzt es im Autorblock neben deinem Namen, wo es auf beiden Plattformen erscheint.',
      '🚗 Das Miniaturbild gehört damit wieder deinem dicksten Auto.',
    ],
  },
  {
    version: '1.15.0',
    date: '2026-09-04',
    title: 'Staatskassen der Länder',
    lines: [
      '🌍 **Die Staatskasse ist aufgeteilt:** Deine Steuern fließen ab jetzt in die Kasse deines **Wohnsitzlandes**. Wer keine Heimat gewählt hat, zahlt in den Topf der Staatenlosen.',
      '🏆 **Rangliste der reichsten Staaten:** `!laender` oder 🌍 in der Staatskasse – mit Stand, Anteil, Einwohnerzahl und Buchungen. Zwei umsatzstarke Einwohner schlagen zehn sparsame.',
      '📢 **Aufforderung zur Heimatwahl:** Wer noch kein Land hat, wird bei jedem Menüaufruf daran erinnert – die erste Wahl ist kostenlos.',
      '🇷🇴 **Rumänien** ist als Land dazugekommen, mitsamt Rumänisch als Inhaltssprache.',
      '🚩 **Flaggen statt Symbolen:** Die Sprachen tragen jetzt die Flagge ihres Hauptmarkts statt Brezel, Croissant und Drache.',
    ],
  },
  {
    version: '1.14.0',
    date: '2026-09-04',
    title: 'Heimat und Sprache',
    lines: [
      '🌍 **Wohnsitz wählen:** 20 Länder, jedes mit eigener Kaufkraft – davon hängen Werbedeals, Merch und Spenden ab. `/heimat`',
      '🗣️ **Inhaltssprache wählen:** 14 Sprachen. Sie entscheidet, wie groß dein Publikum überhaupt werden kann – und wie schnell du dorthin kommst.',
      '⚖️ **Die Abwägung:** Landessprache = kleiner Topf, schnelles Wachstum, gute Werbepreise, frühe Decke. Englisch = riesiger Topf, zäher Start, keine Grenze. Auf Deutsch kommst du bis ✨ Prominenz, 🌟 Superstar wird man nur international.',
      '🏡 **Heimvorteil:** Wer in der Sprache seines Landes sendet, wächst 15 % schneller.',
      '📦 **Umziehen kostet:** Die erste Wahl ist gratis. Danach kostet jeder Umzug Geld (und wird jedes Mal teurer), beendet deinen Mietvertrag – und deine eigene Wohnung bleibt im alten Land zurück. Sie gehört dir weiter, gibt dir dort aber keinen Stellplatz mehr.',
      '🔁 **Sprachwechsel kostet 45 % deiner Follower** und sperrt 30 Tage. Ein Publikum zieht nicht in eine andere Sprache mit.',
    ],
  },
  {
    version: '1.13.0',
    date: '2026-09-03',
    title: 'Vorfälle: jetzt musst du dich entscheiden',
    lines: [
      '⚠️ **Zwölf Vorfälle** können deinen Kanal treffen: Der Sponsor entpuppt sich als Betrug, ein sechs Jahre alter Clip taucht auf, ein Netzwerk will dich exklusiv, das Finanzamt schreibt.',
      '🎲 **Keine Option ist sicher.** Jede Wahl hat mehrere Ausgänge – die brave kostet meistens ein wenig, die mutige kann alles kosten. Zahlen siehst du nicht: Das soll eine Entscheidung sein, keine Rechenaufgabe.',
      '📈 **Mit der Größe wird es gefährlicher:** mehr Vorfälle und härtere Ausgänge. Verstärkt werden nur Verluste, nie Gewinne.',
      '🤫 **Wegklicken hilft nicht.** Wer 24 Stunden nicht reagiert, bekommt den Ausgang des Schweigens – mit 60 % Aufschlag auf den Schaden.',
      '⛔ **Sperren:** Nach einem Copyright-Strike liegt der Kanal tagelang still, während die Follower weiter verfallen.',
      '🎯 **Der Sinn dahinter:** Die Spitze ist nicht mehr garantiert. Wer gut entscheidet, ist nach einem Jahr rund 40 % weiter als wer wegklickt – aber zwei Spieler mit gleichem Fleiß landen trotzdem weit auseinander.',
    ],
  },
  {
    version: '1.12.0',
    date: '2026-09-03',
    title: 'Creator-Balance: die Decke fällt',
    lines: [
      '📈 **Reichweite kann jetzt wirklich groß werden.** Bisher war bei ~14.000 Followern Schluss – weniger, als ein Spitzenjob einbringt. Die Obergrenze liegt jetzt bei mehreren Millionen je Plattform.',
      '🛌 **Der Grund war ein Fehler:** Wer täglich zur selben Zeit sendete, bekam jeden Tag einen vollen Tag „Inaktivitätsverfall" aufgebrummt. Jetzt gibt es einen **Schontag** – bestraft wird Abwesenheit, nicht Regelmäßigkeit.',
      '💰 **Entsprechend zahlt es sich aus:** ~1.700 am Tag bei 50.000 Followern, ~24.000 bei 450.000, sechsstellig ab 1,7 Millionen. Zum Vergleich: Der beste Job bringt 20.000.',
      '👕 **Merch neu gerechnet:** (Community / 100) × Reichweite^0,92 × 0,05 – Anteil der Fans, der kauft, mal Zahl der Fans. Unter 250.000 Followern ein Zubrot, darüber eine tragende Säule. Ohne Bindung verkauft auch der größte Kanal nichts.',
      '🤝 **Werbedeals knallen:** Bei einer Million Reichweite bringt ein Dreier-Vertrag ~119.000.',
      '🌟 **Bekanntheitsleiter gestreckt:** „Superstar" liegt bei 5 Millionen Followern statt 100.000 – international, nicht nach drei Monaten.',
      '💸 **Vermarktung:** Reichweite allein ist kein Geld. Wer klein ist, hat kein Partnerprogramm und miese Preise – erst ab ~450.000 Followern lohnt sich das Arbeitsamt nicht mehr. Dafür knallt es oben richtig.',
      '🌪️ **Shitstorms sind seltener, aber härter** – vorher fraß alle 40 Aktionen einer 5 % der Follower und deckelte damit heimlich den ganzen Kanal.',
    ],
  },
  {
    version: '1.11.0',
    date: '2026-09-03',
    title: 'Verträge, Merch, Burnout und eigene Titel',
    lines: [
      '🤝 **Sponsorenverträge:** Ab 3.000 Followern melden sich Marken. Liefere die vereinbarten Beiträge in der Frist und kassiere – reiß sie, und es kostet 30 % Vertragsstrafe. Im Menü unter 🤝 Deals.',
      '👕 **Merch:** Ab 5.000 Followern verkaufst du Pullis. Der Umsatz hängt an deiner **Community**, nicht an der Reichweite – die entsteht im Livechat, unter Videos und auf Twitter. Im Instagram-Feed dagegen gar nicht.',
      '🔋 **Burnout:** Wer jeden Tag das volle Zeitbudget raushaut, verliert bis zu 35 % Reichweite. Pausen bringen sie zurück. Vollgas dauerhaft = 80 %.',
      '✏️ **Eigene Titel:** Streams, Videos, Posts und Tweets kannst du selbst benennen – Schalter 🎲/✏️ in jeder Plattform-Ansicht. Der letzte Titel bleibt am Kanal stehen.',
      '📡 **Reichweiten-Rangliste:** `/leaderboard` hat eine neue Ansicht – wer hat das größte Publikum?',
      '🖼️ **Profil aufgehübscht:** Oben rechts steht jetzt dein **Profilbild**, darunter dein **Bekanntheitsgrad** – vom Unbeschriebenen Blatt bis zur Legende. Der Wert ist deine Reichweite plus 150 je Level, damit auch ohne Kanal jeder einen Titel hat.',
      '👤 **Im Profil:** Sobald du Follower hast, zeigt dein Steckbrief das Netzwerk mit der Aufteilung je Plattform.',
    ],
  },
  {
    version: '1.10.0',
    date: '2026-09-03',
    title: 'YouTube, Instagram und Twitter',
    lines: [
      '📡 **Vier Plattformen statt einer:** Aus dem Twitch-Kanal wird ein ganzes Netzwerk. `/creator` oder 📡 unter Arbeit.',
      '🔴 **YouTube:** Ein Video ist teuer in der Zeit, wandert dafür in den **Katalog** – und der bringt noch tagelang Aufrufe und Geld, ganz von allein.',
      '📸 **Instagram:** Wächst am schnellsten und zahlt dir selbst **nichts**. Geld gibt es nur über **Kooperationen** – wie oft Marken anklopfen, hängt an deiner Reichweite im ganzen Netzwerk.',
      '🐦 **Twitter:** Zahlt **keinen Cent**. Nie. Dafür schiebt ein Tweet deine nächste Aktion an und baut **Community** auf, die den Followerschwund in Pausen halbiert.',
      '🔗 **Alles hängt zusammen:** Jede Aktion spült Follower zu den anderen Kanälen, fremde Reichweite zählt anteilig mit, und ein viraler Clip – oder ein Shitstorm – wirkt überall.',
      '⏳ **Ein Tagesbudget:** 8 Zeiteinheiten für alles. Ein Stream kostet 2, ein Video 3, Post und Tweet je 1. Vier Streams sind ein voller Tag.',
      '📉 **Auch vergessene Kanäle schrumpfen** – Reichweite lässt sich nicht parken.',
    ],
  },
  {
    version: '1.9.0',
    date: '2026-09-03',
    title: 'Der eigene Kanal',
    lines: [
      '🎙️ **Streaming:** Aus dem Job „Streamer" wird eine eigene Tätigkeit. Wer ein **Streaming-Setup** hat, baut sich damit einen Kanal auf. `/stream` oder 🎙️ unter Arbeit.',
      '💰 **Drei Einnahmen:** Werbung nach Aufrufen, Spenden nach Laune des Publikums, Abos nach Followern – jede Sendung.',
      '🎮 **Sechs Kategorien:** Gaming und IRL bringen Reichweite, Just Chatting und Musik ein spendables Publikum, Speedrun treue Follower, Kochen Ruhe. Keine ist insgesamt die beste.',
      '🚀 **Ereignisse:** Raids, virale Clips und Wale im Chat – dagegen Technikpannen, Trollwellen, Stromausfall und der eine Satz zu viel.',
      '📉 **Reichweite verfällt:** Wer nicht sendet, verliert Follower. Der Aufbau dauert Wochen, dafür ist ein großer Kanal die stärkste aktive Geldquelle im Spiel.',
      '⭐ **Der Streamer-Job ist raus** – das Setup kannst du weiterhin in der 🧰 Ausrüstung kaufen (und es kann beim Senden kaputtgehen).',
    ],
  },
  {
    version: '1.8.0',
    date: '2026-09-02',
    title: 'Die Staatskasse',
    lines: [
      '🏛️ **Staatskasse:** Ein gemeinsamer Topf für den ganzen Server. Er füllt sich bei jeder Geldbewegung – 19 % bei Ausgaben, 40 % bei Einnahmen.',
      '💸 **Du zahlst dafür nichts.** Der Anteil wird aus dem Betrag nur berechnet und zusätzlich in die Kasse gelegt. Preise und Verdienste bleiben exakt wie bisher.',
      '📊 **Woher es kommt:** Die Kasse zeigt die stärksten Bereiche (Fahrzeuge, Arbeit, Börse …), die größten Beitragszahler und die letzten Zuflüsse. `/staat` oder 🏛️ im Menü unter „Ich“.',
      '🏴 **Nicht deklariert:** Raubzüge und Stornos bleiben außen vor – die Kasse sieht nur echte Buchungen.',
    ],
  },
  {
    version: '1.7.0',
    date: '2026-09-02',
    title: 'Karriere, Angeln und Selberschrauben',
    lines: [
      '🔗 **Brücke: Erwähnungen funktionieren.** Ein @Name aus Fluxer kam auf Discord als „unbekannter Benutzer" an – jetzt wird er übersetzt (echte Erwähnung bei verknüpften Konten, sonst der Name).',
      '🎉 **Beförderungen:** Nach jeder Schicht wird gewürfelt – je länger du ohne Aufstieg dabei bist, desto wahrscheinlicher. Nach oben offen: hinter Teilhaber:in geht es mit Sternen weiter. Ein Jobwechsel setzt den Rang zurück.',
      '🎣 **Angeln:** Mit der Angelausrüstung alle 20 Minuten auswerfen. 18 mögliche Fänge, vom alten Stiefel bis zum 60-Kilo-Wels. `/angeln`',
      '🔧 **Selbst schrauben:** Mit einem Werkzeugkasten reparierst du in der Werkstatt selbst und zahlst nur Material. Hebebühne und Diagnosegerät machen es günstiger und sicherer – aber Pfusch bleibt möglich.',
      '💼 **Rang sichtbar:** Profil und Schichtmeldung zeigen deinen Rang und wie viele Schichten bis zur nächsten Beförderung fehlen.',
    ],
  },
  {
    version: '1.6.0',
    date: '2026-09-02',
    title: 'Levels bringen jetzt etwas',
    lines: [
      '💰 **Mehr Geld pro Level:** +2 % Einkommen je Level auf `!daily`, jede Schicht – und als Zuschlag auf UnbelievaBoats `!work`. Bis +60 %.',
      '📉 **Günstiger handeln:** Die Börsengebühr sinkt um 2 % je Level (bis zur Hälfte).',
      '🅿️ **Mehr Platz:** Ein zusätzlicher Stellplatz ab Level 10, 20 und 35.',
      '🛡️ **Sicherer parken:** Das Diebstahlrisiko draußen sinkt mit dem Level (bis −40 %).',
      '👤 **Im Profil sichtbar:** `/profil` zeigt deine aktiven Vorteile und den nächsten Meilenstein.',
    ],
  },
  {
    version: '1.5.0',
    date: '2026-09-01',
    title: 'Wallstreet',
    lines: [
      '📈 **Börse:** 25 Werte in drei Klassen – 16 Aktien, 3 Fonds, 6 Coins. `/boerse` oder 📈 im Menü.',
      '⏱️ **Kurse ändern sich alle 30 Minuten** – auch wenn niemand zusieht. Mit gemeinsamen Markttrends, ruhigen und hektischen Phasen.',
      '🛒 **Viele Kaufwege:** Stückzahlen, feste Beträge („für 10.000"), eigene Eingabe. Verkaufen in 25/50/100 %.',
      '💼 **Depot:** `/depot` zeigt Bestand, Einstandskurs und Gewinn je Position.',
      '📰 **Schlagzeilen** erklären große Bewegungen – vorhersagen können sie nichts.',
      '💀 **Insolvenz:** Fällt ein Wert zu tief, werden die Halter ausgezahlt und der Wert startet neu.',
      '⚖️ **Fair, nicht großzügig:** Kurse sind reiner Zufall ohne Drift, dazu 1 % Gebühr je Auftrag. Keine Strategie hat einen Vorteil.',
    ],
  },
  {
    version: '1.4.0',
    date: '2026-08-31',
    title: 'Werkstatt: kaputte Autos wieder aufbauen',
    lines: [
      '🛠️ **Werkstatt:** `/werkstatt` (oder `!werkstatt`) bringt beschädigte Autos wieder auf Stand – bisher war ein Kratzer für immer.',
      '🧽 **Drei Stufen:** Aufbereitung (55 %), Instandsetzung (80 %) und volle Restaurierung (100 %). Den Preis siehst du vorher.',
      '💸 **Kein Geschäft:** Eine Reparatur kostet immer mehr, als sie an Zeitwert zurückbringt – du kaufst Erhalt, keinen Gewinn.',
      '🅿️ **Kurzer Weg:** Steht etwas Beschädigtes in deiner Garage, führt dort jetzt ein Knopf direkt in die Werkstatt.',
      '🏬 **Auktionshaus fairer:** Die typische Garage war 38 % ihres Startpreises wert – jetzt 77 %. In jeder Garage liegt Bargeld, teure Fundstücke sind seltener statt gleichverteilt.',
      '🎭 **Brücke mit Gesicht:** Gespiegelte Nachrichten erscheinen drüben jetzt mit Name und Avatar des Absenders statt als `Kevin: Text` vom Bot. Wer verknüpft ist, tritt überall mit seinem Discord-Konto auf.',
      '👤 **Namen statt IDs:** Nicht verknüpfte Fluxer-Spieler erscheinen in Rangliste, Postfach und Auktion jetzt mit Namen – vorher stand dort eine rohe Konto-ID.',
      '🪙 **Fluxer: Geldzeichen repariert.** Das Währungs-Emoji stand außerhalb der Menüs als `:Rubine:` da – jetzt wird es überall übersetzt, auch in gespiegelten Nachrichten.',
      '🎲 **`!daily` erzählt jetzt was:** Rund 60 Sprüche, woher das Geld kam – von dummem Glück bis eklig. Der Betrag schwankt neu zwischen 200 und 2000.',
      '🎰 **Kein Lotterie-Aufschlag mehr:** Die absurd seltenen Stufen (ab Godlike) kosten dich nichts mehr im Startpreis – sie bleiben als Bonus drin. Hausvorteil 15 % → 10 %.',
    ],
  },
  {
    version: '1.3.0',
    date: '2026-08-24',
    title: 'Storage Wars, Level & Profile',
    lines: [
      '🏬 **Auktionshaus:** Ersteigere verschlossene Garagen – `/auktion`. Pro Runde kommen 4–7 Garagen nacheinander unter den Hammer.',
      '🔓 **Selbst öffnen:** Ersteigerte Garagen landen verschlossen bei „Meine Garagen". Was drin ist, siehst du erst beim Aufmachen.',
      '💎 **Seltenheiten:** Fundstücke von Common bis Origin – manche sind absurd selten. Dazu Zustände von „beschädigt" bis „Sammlerzustand".',
      '🏆 **Level-System:** Du sammelst Erfahrung bei jeder Einnahme und Ausgabe.',
      '👤 **Profil & Rangliste:** `/profil` zeigt dein bestes Auto, deine teuerste Immobilie und deinen Beruf. `/leaderboard` vergleicht alle.',
      '❓ **Neu hier?** `/help` erklärt dir den Bot in einer Minute.',
      '📬 **Postfach:** Nachrichten lassen sich jetzt einzeln löschen oder komplett leeren.',
    ],
  },
];
