/**
 * Energie – die eine Bremse für alle Arbeit (Creator, Musik, Firma, Jobs).
 *
 * Reines Modell, kein Zustand: Wer die Erschöpfung eines Spielers kennt
 * (`creator_state.fatigue`, `fatigue_at`), kann hier ausrechnen, was der
 * Tag kostet, wie viel über Nacht zurückkommt und was von der Wirkung einer
 * Aktion übrig bleibt. Den Zustand hält src/creator.js (useTime, energyOf).
 *
 * Warum konvex: Die n-te Stunde des Tages kostet mehr als die erste. Nur so
 * gilt beides zugleich – ein 8-h-Tag lässt die Energie kaum sinken (79,8 %),
 * und bei ~21 Stunden am Stück steht man an der Wand. Ein linearer Preis
 * kann nur eins von beidem (siehe Spec 2026-09-14, Tabelle).
 */

const HOUR_COST_BASE = 1.4;     // Punkte für die erste Stunde …
const HOUR_COST_SLOPE = 0.25;   // … plus so viel je weiterer Stunde des Tages
const RECOVERY_PER_HOUR = 4;    // Punkte je Echtzeit-Stunde ohne Aktion
const MALUS_MAX = 0.8;          // bei 0 % Energie bleibt ein Fünftel der Wirkung
const ENERGY_WALL = 0.10;       // darunter geht nichts mehr, was Zeit kostet
const FATIGUE_MAX = 100;

const H_MS = 60 * 60 * 1000;
const clamp = (lo, hi, v) => Math.max(lo, Math.min(hi, v));

/**
 * Erschöpfungspunkte für `hours` Stunden, wenn heute schon `used` Stunden
 * verbraucht sind: Summe über n = used+1 … used+hours von BASE + SLOPE × n.
 * `fatigueFactor` ist der Überstunden-Aufschlag (2 = doppelt so müde).
 */
function costOf(used, hours, fatigueFactor = 1) {
  if (hours <= 0) return 0;
  const sum = hours * HOUR_COST_BASE
    + HOUR_COST_SLOPE * (hours * used + (hours * (hours + 1)) / 2);
  return sum * fatigueFactor;
}

/** Erschöpfung nach linearer Erholung seit `fatigueAt` (0 = ausgeruht). */
function recover(fatigue, fatigueAt, now) {
  if (!fatigue || !fatigueAt || now <= fatigueAt) return fatigue || 0;
  const hours = (now - fatigueAt) / H_MS;
  return clamp(0, FATIGUE_MAX, fatigue - hours * RECOVERY_PER_HOUR);
}

/** Energie 0…1 aus der Erschöpfung. */
function energyOf(fatigue) {
  return clamp(0, 1, 1 - (fatigue || 0) / FATIGUE_MAX);
}

/** Was von der Wirkung einer Aktion bleibt: flach oben, steil unten. */
function factorOf(energy) {
  const e = clamp(0, 1, energy);
  return 1 - MALUS_MAX * (1 - e) ** 2;
}

/**
 * Unter der Wand? „Unter 10 %" – genau 10 % ist noch erlaubt. Verglichen wird
 * in Punkten (> 90), nicht in Energie: 1 − 0,9 ist in JS 0,0999…, und damit
 * stünde jemand mit genau 90 Punkten fälschlich an der Wand.
 */
function exhausted(fatigue) {
  return (fatigue || 0) > FATIGUE_MAX * (1 - ENERGY_WALL);
}

/** Zeitpunkt, ab dem die Wand fällt – null, wenn nicht erschöpft. */
function readyAt(fatigue, fatigueAt) {
  if (!exhausted(fatigue)) return null;
  const wallFatigue = FATIGUE_MAX * (1 - ENERGY_WALL);       // 90
  return fatigueAt + ((fatigue - wallFatigue) / RECOVERY_PER_HOUR) * H_MS;
}

/** Ein Text für alle Wege (Menü, Slash, Fluxer). */
function blockText(res, now = Date.now()) {
  const ms = (res.readyAt ?? now) - now;
  const wann = ms > 0
    ? `in **${require('./income').formatRemaining(ms)}**` : '**jetzt**';
  return `🔋 Du bist erschöpft. Wieder ${wann}.`;
}

module.exports = {
  HOUR_COST_BASE, HOUR_COST_SLOPE, RECOVERY_PER_HOUR, MALUS_MAX, ENERGY_WALL, FATIGUE_MAX,
  costOf, recover, energyOf, factorOf, exhausted, readyAt, blockText,
};
