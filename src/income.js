const db = require('./db');
const unb = require('./unb');
const lines = require('./data/daily');

// Späte Bindung, damit Tests die Geldbuchung ersetzen können (ARCHITEKTUR §8).
const changeCash = (...a) => unb.changeCash(...a);

/**
 * ===========================================================================
 *  GRUNDEINKOMMEN – der Ersatz für UnbelievaBoats !daily
 * ===========================================================================
 *
 * Auf Fluxer gibt es UnbelievaBoat nicht, also muss der Bot selbst einen
 * Einstieg ins Geldverdienen bieten. Das eigentliche Arbeiten läuft weiterhin
 * über das Arbeitsamt (`jobs.js`, Befehl `!work`) – `!daily` ist nur der
 * kleine tägliche Sockel, damit niemand ohne Startkapital feststeckt.
 *
 * Einmal am Tag, dafür mit spürbarer Spanne (200–2000): Der Bonus soll sich
 * wie ein kleiner Glücksmoment anfühlen und nicht wie eine Gehaltsabrechnung.
 * Zum Vergleich: eine Job-Schicht bringt 70–800 pro Lauf – wer regelmäßig
 * arbeitet, verdient weiterhin deutlich mehr als der eine Tagesgriff.
 *
 * Woher das Geld kam, würfelt [`data/daily.js`](data/daily.js) dazu – wie bei
 * UnbelievaBoats `!work`. Der Spruch ist reine Deko und hat **keinen** Einfluss
 * auf den Betrag; sonst müsste man auf gute Sprüche hoffen.
 */

const DAY_MS = 24 * 60 * 60 * 1000;

/** Fester Sockel plus Zufallsanteil – die Spanne ist die Balance-Stellschraube. */
const DAILY = { base: 200, bonus: 1800, cooldownMs: DAY_MS };

/** Wie lange noch bis zur nächsten Auszahlung? (0 = jetzt möglich) */
function remainingMs(guildId, userId, kind = 'daily', now = Date.now(), cooldownMs = DAILY.cooldownMs) {
  const claim = db.getClaim(guildId, userId, kind);
  if (!claim) return 0;
  return Math.max(0, claim.claimed_at + cooldownMs - now);
}

/**
 * Zahlt den Tagesbonus aus.
 *
 * Der Anspruch wird **vor** der Geldbuchung synchron vermerkt: ein zweiter,
 * schneller Aufruf findet dann schon den Cooldown vor und geht leer aus –
 * so kann der Bonus nicht doppelt kassiert werden (ARCHITEKTUR §7).
 *
 * @returns {Promise<{ok:boolean, amount?:number, balance?:object, flavor?:string,
 *   remainingMs?:number}>} `flavor` ist die Spruchvorlage mit `{betrag}`.
 */
async function daily(guildId, userId, now = Date.now(), random = Math.random) {
  const left = remainingMs(guildId, userId, 'daily', now);
  if (left > 0) return { ok: false, reason: 'cooldown', remainingMs: left };

  const amount = DAILY.base + Math.floor(random() * (DAILY.bonus + 1));
  const flavor = lines.pick(random);
  db.setClaim(guildId, userId, 'daily', now);

  try {
    const balance = await changeCash(guildId, userId, amount, 'Täglicher Bonus');
    return { ok: true, amount, balance, flavor };
  } catch (err) {
    // Buchung fehlgeschlagen -> Anspruch zurückgeben, sonst wäre der Tag verloren.
    db.clearClaim(guildId, userId, 'daily');
    throw err;
  }
}

/** Menschlich lesbarer Rest ("3 h 12 min"). */
function formatRemaining(ms) {
  const totalMin = Math.ceil(ms / 60000);
  const h = Math.floor(totalMin / 60);
  const m = totalMin % 60;
  return h > 0 ? `${h} h ${m} min` : `${m} min`;
}

module.exports = { DAY_MS, DAILY, lines, remainingMs, daily, formatRemaining };
