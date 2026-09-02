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
