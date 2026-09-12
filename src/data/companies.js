/**
 * ===========================================================================
 *  FIRMEN – Branchen, Ränge, Konstanten (Stück 1: der Kern)
 * ===========================================================================
 *
 * Gründungspreise sind realistisch („Deutschland durch drei", wie die
 * übrigen Preise im Spiel). Die Investition liegt nicht in der Gründung,
 * sondern im Ausbau – der kommt in Stück 2. Deshalb ist die Decke einer
 * nicht ausgebauten Firma bewusst niedrig (siehe company.ceilingOf).
 *
 *   price   Gründungspreis
 *   slots   Arbeitsplätze – NPCs und Spieler zusammen; das ist die Decke
 *   umsatz  Umsatz je Schicht bei Auslastung 1,0 und Rang Aushilfe
 *   lohn    Lohn je Schicht, Rang Aushilfe
 *
 * Alle Zahlen sind gegen die Messung gezogen (scripts/messung-geldquellen.js),
 * keine Behauptung. Zielmarken im Vollbetrieb: Kiosk ~2.500/Tag, Café ~20.000,
 * Spedition ~70.000 – alle unter Musik+Creator. Gemessen (365 Tage, Median):
 * Kiosk 2.584, Café 19.651, Spedition 70.380 – die Spedition stand mit
 * umsatz 2.600 bei 103.280 und damit ÜBER Musik+Creator (100.916), deshalb 1.900.
 */

const BRANCHES = [
  { id: 'kiosk', name: 'Kiosk', emoji: '🏪', price: 25_000, slots: 2, umsatz: 250, lohn: 100,
    blurb: 'Zeitungen, Zigaretten, kalte Getränke. Läuft fast allein – aber eben nur fast.' },
  { id: 'cafe', name: 'Café', emoji: '☕', price: 120_000, slots: 5, umsatz: 900, lohn: 180,
    blurb: 'Braucht Leute hinter der Theke und jemanden, der sich kümmert. Dann läuft es.' },
  { id: 'spedition', name: 'Spedition', emoji: '🚚', price: 1_200_000, slots: 10, umsatz: 1_900, lohn: 420,
    blurb: 'Lkw, Fahrer, Disposition. Hohe Löhne, hohe Marge – rentabel nur mit voller Mannschaft.' },
];

/** Ränge: Faktor auf Umsatz UND Lohn – der Inhaber befördert selbst. */
const RANKS = [
  { id: 0, name: 'Aushilfe', emoji: '🧹', factor: 1.0 },
  { id: 1, name: 'Fachkraft', emoji: '🔧', factor: 1.25 },
  { id: 2, name: 'Schichtleiter', emoji: '📋', factor: 1.5 },
];

const NPC_NAMES = [
  'Ali', 'Anja', 'Ben', 'Bianca', 'Cem', 'Clara', 'Dennis', 'Dilara', 'Emre', 'Eva',
  'Finn', 'Frieda', 'Gökhan', 'Greta', 'Hakan', 'Hanna', 'Igor', 'Ines', 'Jonas', 'Julia',
  'Kai', 'Katja', 'Leon', 'Lena', 'Murat', 'Mia', 'Niko', 'Nina', 'Ömer', 'Olga',
  'Paul', 'Petra', 'Rafael', 'Rosa', 'Sven', 'Selin', 'Tim', 'Tamara', 'Yusuf', 'Zoe',
];

const NPC_SHIFTS = 3;               // Schichten je NPC und Tag
const INSOLVENCY_DAYS = 14;         // so lange darf die Kasse im Minus sein
const NPC_QUIT_AFTER_UNPAID = 3;    // unbezahlte Tage, bis ein NPC kündigt
const WERBUNG_DAYS = 3;
const WERBUNG_BOOST = 0.25;         // auf das Auslastungsziel
const WERBUNG_COST_SHARE = 0.05;    // des Gründungspreises
const AUSLASTUNG_MIN = 0.3;         // ohne Personal
const AUSLASTUNG_STAFF = 0.5;       // volle Besetzung bringt 0,3 + 0,5 = 0,8; der Rest ist Werbung
const AUSLASTUNG_STEP = 0.2;        // Annäherung je Tag
const PLAYER_BONUS = 1.3;           // Umsatz einer Spieler-Schicht gegenüber NPC
const TIME_WERBUNG = 2;             // aus dem gemeinsamen Tagesbudget (creator.useTime)
const TIME_ANPACKEN = 2;
const SHIFT_COOLDOWN_MIN = 60;      // Abklingzeit einer Spieler-Schicht
const MAX_PITCH_PER_DAY = 4;        // „selbst anpacken" je Tag
const MAX_SETTLE_DAYS = 30;         // ältere Tage verfallen (wie bei Musik)

module.exports = {
  BRANCHES, RANKS, NPC_NAMES,
  NPC_SHIFTS, INSOLVENCY_DAYS, NPC_QUIT_AFTER_UNPAID, WERBUNG_DAYS, WERBUNG_BOOST,
  WERBUNG_COST_SHARE, AUSLASTUNG_MIN, AUSLASTUNG_STAFF, AUSLASTUNG_STEP, PLAYER_BONUS,
  TIME_WERBUNG, TIME_ANPACKEN, SHIFT_COOLDOWN_MIN, MAX_PITCH_PER_DAY, MAX_SETTLE_DAYS,
};
