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
