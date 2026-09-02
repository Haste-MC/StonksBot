/**
 * ===========================================================================
 *  BEFÖRDERUNGEN – Karriere mit Würfel
 * ===========================================================================
 *
 * Eine Beförderung ist **kein erreichter Schwellenwert, sondern ein Wurf nach
 * jeder Schicht**. Die Chance steigt mit jeder Schicht seit dem letzten
 * Aufstieg – wer lange dieselbe Arbeit macht, wird irgendwann bemerkt. Zwei
 * Leute mit gleich vielen Schichten können also unterschiedlich weit sein,
 * und der nächste Aufstieg kann jederzeit kommen.
 *
 * **Nach oben ist die Leiter offen.** Es gibt keinen höchsten Rang; nach den
 * benannten Stufen zählt ein Stern hoch. Damit das nicht in absurde Löhne
 * kippt, wachsen zwei Dinge gegenläufig:
 *
 *   - Die **Chance** sinkt mit jedem Rang (höhere Posten sind seltener).
 *   - Der **Lohnfaktor** wächst logarithmisch, nicht linear – der Sprung von
 *     Rang 1 auf 2 ist deutlich, der von 30 auf 31 kaum spürbar.
 *
 * Der Rang wird **gespeichert** (employment.rank), weil er gewürfelt ist und
 * sich nicht aus der Schichtzahl ableiten lässt. Ein Jobwechsel setzt ihn auf
 * null zurück: Bleiben ist eine echte Entscheidung gegen den nächsten Job.
 */

/** Die benannten Stufen. Darüber hinaus geht es mit Sternen weiter. */
const TITLES = [
  { title: 'Aushilfe', emoji: '🔰' },
  { title: 'Fachkraft', emoji: '🥉' },
  { title: 'Vorarbeiter:in', emoji: '🥈' },
  { title: 'Meister:in', emoji: '🥇' },
  { title: 'Betriebsleitung', emoji: '🏅' },
  { title: 'Prokurist:in', emoji: '📜' },
  { title: 'Geschäftsführung', emoji: '💼' },
  { title: 'Vorstand', emoji: '👔' },
  { title: 'Teilhaber:in', emoji: '👑' },
];

/** Wie stark der Lohn je Rang wächst (logarithmisch, siehe oben). */
const PAY_SCALE = 0.25;

/** Grundchance je Schicht seit dem letzten Aufstieg. */
const CHANCE_PER_SHIFT = 0.03;

/** Wie stark die Chance mit jedem Rang gebremst wird. */
const RANK_DRAG = 0.6;

/** Höchste Chance je Schicht – auch nach ewigem Warten bleibt es ein Wurf. */
const MAX_CHANCE = 0.5;

/** Titel und Emoji zu einem Rang. Oberhalb der Liste zählt ein Stern hoch. */
function titleOf(rank = 0) {
  const r = Math.max(0, Math.floor(Number(rank) || 0));
  if (r < TITLES.length) return { ...TITLES[r], rank: r };

  const stars = r - TITLES.length + 1;
  const top = TITLES[TITLES.length - 1];
  return { title: `${top.title} ★${stars}`, emoji: '🌟', rank: r };
}

/** Lohnfaktor eines Rangs: wächst immer, aber mit abnehmendem Schwung. */
function payFactor(rank = 0) {
  const r = Math.max(0, Math.floor(Number(rank) || 0));
  return 1 + PAY_SCALE * Math.log(1 + r);
}

/** Alles zu einem Rang auf einmal. */
function rank(r = 0) {
  const t = titleOf(r);
  return { ...t, pay: payFactor(t.rank) };
}

/**
 * Beförderungschance nach der nächsten Schicht.
 *
 * Steigt linear mit den Schichten seit dem letzten Aufstieg und sinkt mit dem
 * erreichten Rang. Bei Rang 0 dauert es im Schnitt rund 8 Schichten, bei Rang
 * 10 schon gut 25 – die Leiter wird nach oben hin dünner, hört aber nie auf.
 */
function chance(currentRank = 0, shiftsSince = 0) {
  const r = Math.max(0, Math.floor(Number(currentRank) || 0));
  const since = Math.max(0, Math.floor(Number(shiftsSince) || 0));
  return Math.min(MAX_CHANCE, (CHANCE_PER_SHIFT * since) / (1 + r * RANK_DRAG));
}

/**
 * Würfelt eine Beförderung aus.
 * @returns {null|{from:object, to:object, chance:number}}
 */
function roll(currentRank = 0, shiftsSince = 0, random = Math.random) {
  const p = chance(currentRank, shiftsSince);
  if (random() >= p) return null;

  const from = rank(currentRank);
  const to = rank(from.rank + 1);
  return { from, to, chance: p };
}

/** "🥈 Vorarbeiter:in" – für Anzeigen. */
function label(r = 0) {
  const info = rank(r);
  return `${info.emoji} ${info.title}`;
}

module.exports = {
  TITLES, PAY_SCALE, CHANCE_PER_SHIFT, RANK_DRAG, MAX_CHANCE,
  titleOf, payFactor, rank, chance, roll, label,
};
