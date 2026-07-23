/**
 * Fahrzeugzustand: 0 (Schrott) bis 100 (neuwertig).
 *
 * Der Zustand hängt am einzelnen Besitzeintrag. Deshalb kann man ein
 * Automodell nur einmal besitzen – zwei Wagen desselben Modells mit
 * unterschiedlichem Zustand ließen sich in einer Mengen-Spalte nicht
 * abbilden. Das ist auch spielerisch sinnvoll: Stellplätze sind knapp,
 * Dubletten bringen niemandem etwas.
 */

const MAX = 100;
const MIN = 0;

/**
 * Wie stark der Zustand den Wert beeinflusst.
 * Ein Totalschaden ist immer noch 30 % wert (Teile, Schrottwert),
 * ein neuwertiger Wagen 100 %.
 */
const FLOOR = 0.30;

const LEVELS = [
  { min: 90, label: 'Neuwertig', emoji: '✨', color: 0x2ecc71 },
  { min: 70, label: 'Gut', emoji: '🙂', color: 0x27ae60 },
  { min: 50, label: 'Gebraucht', emoji: '😐', color: 0xf1c40f },
  { min: 30, label: 'Abgenutzt', emoji: '🔧', color: 0xe67e22 },
  { min: 15, label: 'Beschädigt', emoji: '🛠️', color: 0xd35400 },
  { min: 0, label: 'Schrott', emoji: '💀', color: 0xc0392b },
];

/** Stufe zu einem Zustandswert. */
function level(condition) {
  const c = clamp(condition);
  return LEVELS.find((l) => c >= l.min) ?? LEVELS[LEVELS.length - 1];
}

function clamp(condition) {
  const n = Number.isFinite(condition) ? Math.round(condition) : MAX;
  return Math.min(MAX, Math.max(MIN, n));
}

/** Anteil des Neupreises, den ein Wagen in diesem Zustand noch wert ist. */
function valueFactor(condition) {
  return FLOOR + (1 - FLOOR) * (clamp(condition) / MAX);
}

/** Aktueller Wert eines Fahrzeugs. */
function currentValue(price, condition) {
  return Math.max(1, Math.round(price * valueFactor(condition)));
}

/**
 * Anzeige ohne Zahl, z.B. "🙂 Gut".
 *
 * Im Markt bewusst ungenau: eine Prozentzahl ließe sich direkt gegen den
 * Preis rechnen und würde verraten, ob ein Angebot gut ist. Die grobe Stufe
 * reicht für eine Einschätzung, nimmt sie einem aber nicht ab.
 */
function label(condition) {
  const l = level(clamp(condition));
  return `${l.emoji} ${l.label}`;
}

/**
 * Anzeige mit genauem Wert, z.B. "🙂 Gut (78 %)".
 * Nur für Fahrzeuge, die einem selbst gehören – dort darf man genau hinsehen.
 */
function labelDetailed(condition) {
  const c = clamp(condition);
  return `${label(c)} (${c} %)`;
}

/** Balkenanzeige für Detailansichten. */
function bar(condition, width = 10) {
  const c = clamp(condition);
  const filled = Math.round((c / MAX) * width);
  return '▰'.repeat(filled) + '▱'.repeat(width - filled);
}

module.exports = {
  MAX, MIN, FLOOR, LEVELS, level, clamp, valueFactor, currentValue,
  label, labelDetailed, bar,
};
