const db = require('./db');

/**
 * ===========================================================================
 *  LEVELSYSTEM
 * ===========================================================================
 *
 * Erfahrung (XP) entsteht bei JEDER echten Geldbuchung – Einnahme wie Ausgabe.
 * Der einzige Aufrufer ist `unb.changeCash` (der zentrale Geld-Choke-Point);
 * Storno-/Rückerstattungsbuchungen buchen dort mit `{ xp: false }` und lösen
 * deshalb kein XP aus (kein Doppelzählen).
 *
 * Die Kurve ist bewusst wurzelförmig: mehr Geld gibt mehr XP, aber mit
 * abnehmendem Grenznutzen – ein einzelner Millionenkauf soll das Level nicht
 * sprengen. Beide Konstanten unten sind reine Balance-Stellschrauben.
 */

// XP pro Buchung = floor(sqrt(|betrag|)).  100 → 10 · 10 000 → 100 · 1 Mio → 1000
function xpForAmount(amount) {
  return Math.floor(Math.sqrt(Math.abs(amount) || 0));
}

// Level aus Gesamt-XP.  level = floor(sqrt(xp / XP_PER_LEVEL²-Faktor))
// → Lvl 1 bei 100 XP, Lvl 2 bei 400, Lvl 3 bei 900, Lvl 5 bei 2500 …
const XP_SCALE = 100;

function levelForXp(xp) {
  return Math.floor(Math.sqrt(Math.max(0, xp) / XP_SCALE));
}

/** Gesamt-XP, die man für ein bestimmtes Level braucht (Umkehrung von levelForXp). */
function xpForLevel(level) {
  return XP_SCALE * level * level;
}

/**
 * Fortschritt innerhalb des aktuellen Levels – für einen Balken im Profil.
 * @returns {{level:number, into:number, needed:number, ratio:number}}
 */
function progress(xp) {
  const level = levelForXp(xp);
  const base = xpForLevel(level);
  const next = xpForLevel(level + 1);
  const needed = next - base;
  const into = Math.max(0, xp - base);
  return { level, into, needed, ratio: needed > 0 ? into / needed : 0 };
}

/**
 * Vergibt XP und schreibt Ein-/Ausgaben fort. `amount > 0` ist eine Einnahme,
 * `amount < 0` eine Ausgabe; 0 ist ein No-op (die API bucht 0 ohnehin nie).
 */
function award(guildId, userId, amount) {
  if (!amount) return;
  db.addStats(guildId, userId, {
    xp: xpForAmount(amount),
    income: amount > 0 ? amount : 0,
    expense: amount < 0 ? -amount : 0,
  });
}

module.exports = { xpForAmount, levelForXp, xpForLevel, progress, award, XP_SCALE };
