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
