const db = require('./db');
const data = require('./data/fishing');
const gearData = require('./data/gear');
// Spät gebunden, damit Tests die Geldschnittstelle ersetzen können (§8).
const unb = require('./unb');

const changeCash = (...a) => unb.changeCash(...a);

/**
 * ===========================================================================
 *  ANGELN – eine Tätigkeit, die an der Ausrüstung hängt
 * ===========================================================================
 *
 * Ausrüstung war bisher reine Job-Voraussetzung: gekauft, eingelagert,
 * vergessen. Wer eine **Angelausrüstung** hat, kann damit jetzt selbst etwas
 * anfangen – unabhängig davon, ob er als Fischer angestellt ist.
 *
 * Balance: Das ist eine Geldquelle wie eine Schicht, also gilt dasselbe
 * Muster – **Cooldown statt Deckelung durch Zufall**. Pro Zug gibt es im
 * Schnitt weniger als eine Schicht, dafür ohne Anstellung und mit der
 * Möglichkeit eines seltenen dicken Fangs. Der Level-Aufschlag aus perks.js
 * gilt auch hier; die Rute kann kaputtgehen wie jedes andere Werkzeug.
 */

/** Die Ausrüstung, ohne die nichts geht. */
const GEAR = 'Angelausrüstung';

/** Pause zwischen zwei Zügen. */
const COOLDOWN_MS = 20 * 60 * 1000;

/** So oft beißt gar nichts an. */
const EMPTY_CHANCE = 0.12;

/** Wahrscheinlichkeit, dass die Rute dabei bricht. */
const BREAK_CHANCE = 0.015;

const totalWeight = () => data.CATCHES.reduce((s, c) => s + c.weight, 0);

const pick = (list, random) => list[Math.floor(random() * list.length)];
const between = ([min, max], random) => min + random() * (max - min);

/** Würfelt einen Fang aus der Fangtabelle. */
function rollCatch(random = Math.random) {
  let roll = random() * totalWeight();
  for (const entry of data.CATCHES) {
    if (roll < entry.weight) return entry;
    roll -= entry.weight;
  }
  return data.CATCHES[data.CATCHES.length - 1];
}

/** Wie lange noch bis zum nächsten Zug? (0 = jetzt) */
function remainingMs(guildId, userId, now = Date.now()) {
  const claim = db.getClaim(guildId, userId, 'fishing');
  if (!claim) return 0;
  return Math.max(0, claim.claimed_at + COOLDOWN_MS - now);
}

/** Besitzt jemand die Ausrüstung? */
function hasGear(guildId, userId) {
  return Boolean(db.ownsNamed(guildId, userId, GEAR));
}

/**
 * Einmal angeln.
 *
 * Der Anspruch wird **vor** der Geldbuchung vermerkt (§7): Ein zweiter
 * schneller Klick findet den Cooldown vor und geht leer aus.
 *
 * @returns {Promise<{ok:boolean, catch?:object, amount?:number, ...}>}
 */
async function fish(guildId, userId, now = Date.now(), random = Math.random) {
  if (!hasGear(guildId, userId)) {
    const item = gearData.findGear(GEAR);
    return { ok: false, reason: 'no_gear', gear: GEAR, price: item?.price ?? null };
  }

  const left = remainingMs(guildId, userId, now);
  if (left > 0) return { ok: false, reason: 'cooldown', remainingMs: left };

  db.setClaim(guildId, userId, 'fishing', now);

  const spot = pick(data.SPOTS, random);

  // Nichts gefangen: kein Geld, aber der Cooldown läuft. Angeln ist so.
  if (random() < EMPTY_CHANCE) {
    return { ok: true, empty: true, spot, text: pick(data.EMPTY, random), amount: 0 };
  }

  const entry = rollCatch(random);
  const kg = Number(between(entry.kg, random).toFixed(1));
  const sizeFactor = entry.kg[1] > entry.kg[0]
    ? 0.7 + ((kg - entry.kg[0]) / (entry.kg[1] - entry.kg[0])) * 0.8
    : 1;

  const perk = require('./perks').perksOf(guildId, userId);
  const base = Math.round(entry.value * sizeFactor);
  const amount = Math.max(0, Math.round(base * perk.income));

  // Die Rute kann brechen – wie jedes Werkzeug bei der Arbeit.
  const broke = random() < BREAK_CHANCE ? db.consumeNamed(guildId, userId, GEAR) : false;

  let balance = null;
  if (amount > 0) {
    balance = await changeCash(guildId, userId, amount, `Fang: ${entry.name}`);
  }

  return {
    ok: true, empty: false, spot, kg, amount, base,
    levelBonus: amount - base, level: perk.level,
    catch: entry, intro: pick(data.INTROS, random), broke, balance,
  };
}

/** Fertige Meldung für Discord und Fluxer. */
function describe(result, moneyText) {
  if (!result.ok) return null;
  if (result.empty) return `${result.text}\n_${result.spot}_`;

  const c = result.catch;
  const lines = [
    `🎣 ${result.intro} **${c.emoji} ${c.name}**, ${result.kg} kg.`,
    `_${c.line}_`,
    result.amount > 0
      ? `💰 Verkauft für **${moneyText}**${result.levelBonus > 0 ? ` _(inkl. Level-Zuschlag)_` : ''}.`
      : '🗑️ Dafür zahlt dir niemand etwas.',
    `_${result.spot}_`,
  ];
  if (result.broke) lines.push('💥 Dabei ist deine **Angelausrüstung** gebrochen.');
  return lines.join('\n');
}

module.exports = {
  GEAR, COOLDOWN_MS, EMPTY_CHANCE, BREAK_CHANCE,
  rollCatch, remainingMs, hasGear, fish, describe,
};
