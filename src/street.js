const db = require('./db');
const condition = require('./condition');
const property = require('./property');

/**
 * Risiko für Autos, die draußen stehen.
 *
 * Die Garage fasst nur so viele Wagen, wie Immobilien Stellplätze bringen.
 * Alles darüber parkt auf der Straße – und dort kann etwas passieren.
 *
 * Abgerechnet wird faul: beim nächsten Kontakt mit dem Bot werden die
 * seither vergangenen Tage nachgeholt. Ein Tag ohne Bot-Nutzung ist also
 * kein Freifahrtschein.
 */

const DAY_MS = 24 * 60 * 60 * 1000;

/** Nach so vielen Tagen wird nicht weiter nachgeholt – sonst ist die Rückkehr brutal. */
const MAX_CATCHUP_DAYS = 14;

/**
 * Wahrscheinlichkeiten pro Auto und Nacht auf der Straße.
 * Bewusst niedrig gehalten: ein Auto draußen soll sich riskant anfühlen,
 * aber niemanden über Nacht ruinieren.
 */
const RISK = {
  scratch: 0.10,   // Kratzer, kleine Dellen
  damage: 0.035,   // ernsthafter Schaden
  theft: 0.008,    // Diebstahl (Grundwert, steigt mit dem Wert des Wagens)
};

const SCRATCH_LOSS = [3, 10];    // Zustandsverlust
const DAMAGE_LOSS = [15, 35];

/**
 * Teure Autos werden häufiger gestohlen. Der Faktor wächst logarithmisch,
 * damit ein Bugatti riskanter ist als ein Corsa, aber nicht chancenlos.
 */
function theftChance(price) {
  const factor = 1 + Math.log10(Math.max(1, price) / 10000) * 0.6;
  return RISK.theft * Math.max(0.4, Math.min(3.5, factor));
}

const between = ([min, max]) => min + Math.random() * (max - min);

/**
 * Welche Autos stehen draußen?
 * Die wertvollsten kommen zuerst in die Garage – niemand stellt den Ferrari
 * raus und den Corsa rein.
 */
function parkedOutside(guildId, userId) {
  const slots = property.capacity(guildId, userId);
  const covered = slots.owned + slots.rented;   // überdachte Plätze
  const cars = db.carsByValue(guildId, userId);
  return { outside: cars.slice(covered), covered, cars };
}

/**
 * Holt die vergangenen Nächte nach.
 *
 * @returns {Promise<{events: Array, days: number, outside: number}>}
 */
async function settle(guildId, userId, now = Date.now()) {
  const { outside } = parkedOutside(guildId, userId);
  const watch = db.getStreetWatch(guildId, userId);

  // Beim ersten Mal nur den Zeitpunkt merken – niemand soll rückwirkend
  // für Tage bestraft werden, an denen es das Feature noch nicht gab.
  if (!watch) {
    db.setStreetWatch(guildId, userId, now);
    return { events: [], days: 0, outside: outside.length };
  }

  const elapsed = Math.floor((now - watch.last_check) / DAY_MS);
  if (elapsed < 1) return { events: [], days: 0, outside: outside.length };

  const days = Math.min(elapsed, MAX_CATCHUP_DAYS);
  db.setStreetWatch(guildId, userId, now);

  if (outside.length === 0) return { events: [], days, outside: 0 };

  const events = [];
  // Erfahrung schützt: Wer weiß, wo er parkt, wird seltener bestohlen
  // (siehe perks.js).
  const theftFactor = require('./perks').perksOf(guildId, userId).theft;
  // Der Zustand ändert sich während der Simulation – lokal mitführen.
  const state = new Map(outside.map((c) => [c.id, c.condition ?? 100]));
  const stolen = new Set();

  for (let day = 0; day < days; day++) {
    for (const car of outside) {
      if (stolen.has(car.id)) continue;

      if (Math.random() < theftChance(car.price) * theftFactor) {
        stolen.add(car.id);
        db.removeCar(guildId, userId, car.id);
        events.push({ type: 'theft', name: car.name, price: car.price });
        continue;
      }

      if (Math.random() < RISK.damage) {
        const loss = Math.round(between(DAMAGE_LOSS));
        const next = condition.clamp(state.get(car.id) - loss);
        state.set(car.id, next);
        events.push({ type: 'damage', name: car.name, loss, condition: next });
        continue;
      }

      if (Math.random() < RISK.scratch) {
        const loss = Math.round(between(SCRATCH_LOSS));
        const next = condition.clamp(state.get(car.id) - loss);
        state.set(car.id, next);
        events.push({ type: 'scratch', name: car.name, loss, condition: next });
      }
    }
  }

  // Neue Zustände schreiben (gestohlene sind schon weg).
  for (const [itemId, value] of state) {
    if (stolen.has(itemId)) continue;
    db.setCondition(guildId, userId, itemId, value);
  }

  return { events, days, outside: outside.length };
}

/** Fasst viele Einzelereignisse zu einer lesbaren Meldung zusammen. */
function summarize(result, symbol) {
  if (!result.events.length) return null;

  const thefts = result.events.filter((e) => e.type === 'theft');
  const damages = result.events.filter((e) => e.type === 'damage');
  const scratches = result.events.filter((e) => e.type === 'scratch');

  const lines = [];

  if (thefts.length) {
    lines.push('🚨 **Gestohlen!**\n' + thefts.map((t) =>
      `• **${t.name}** — weg. Neupreis war ${symbol} ${t.price.toLocaleString('de-DE')}.`)
      .join('\n'));
  }

  if (damages.length) {
    lines.push('💥 **Beschädigt**\n' + damages.map((d) =>
      `• ${d.name} −${d.loss} Zustand → ${condition.labelDetailed(d.condition)}`).join('\n'));
  }

  if (scratches.length) {
    // Kratzer je Fahrzeug zusammenfassen, sonst wird die Liste lang.
    const perCar = new Map();
    for (const s of scratches) {
      const e = perCar.get(s.name) ?? { loss: 0, condition: s.condition };
      e.loss += s.loss;
      e.condition = Math.min(e.condition, s.condition);
      perCar.set(s.name, e);
    }
    lines.push('🪛 **Zerkratzt**\n' + [...perCar].map(([name, e]) =>
      `• ${name} −${e.loss} Zustand → ${condition.labelDetailed(e.condition)}`).join('\n'));
  }

  const nights = result.days === 1 ? 'einer Nacht' : `${result.days} Nächten`;
  lines.push(`_Nach ${nights} auf der Straße. Eine Garage schützt davor._`);

  return lines.join('\n\n');
}

module.exports = {
  DAY_MS, MAX_CATCHUP_DAYS, RISK, SCRATCH_LOSS, DAMAGE_LOSS,
  theftChance, parkedOutside, settle, summarize,
};
