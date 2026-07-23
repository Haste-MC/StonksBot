const db = require('./db');
const casino = require('./casino');
const unb = require('./unb');

const getBalance = (...a) => unb.getBalance(...a);
const changeCash = (...a) => unb.changeCash(...a);

/**
 * Eine Einzelrunde (Coinflip, Slots, Roulette).
 *
 * Der Nettobetrag wird in EINEM changeCash-Aufruf gebucht: bei Verlust −Einsatz,
 * bei Gewinn (Bruttoauszahlung − Einsatz). Dadurch kann kein Zwischenstand
 * entstehen, in dem Geld verloren geht, und es entsteht nie Geld aus dem Nichts.
 */
async function playRound(guildId, userId, bet, reason, play) {
  const balance = await getBalance(guildId, userId);
  if (balance.total < bet) {
    return { ok: false, reason: 'insufficient_funds', have: balance.total, needed: bet };
  }

  const outcome = play();
  const gross = Math.round(bet * outcome.multiplier);
  const net = gross - bet;

  // Ein Netto von 0 (z.B. Slots-Paar = Einsatz zurück) darf NICHT gebucht
  // werden: die UnbelievaBoat-API lehnt eine Nulländerung mit
  // "Invalid cash and bank parameter provided" ab. Dann bleibt das Guthaben
  // ohnehin unverändert, also die eingangs geholte Bilanz zurückgeben.
  const newBalance = net === 0
    ? balance
    : await changeCash(guildId, userId, net, reason);

  return { ok: true, outcome, bet, gross, net, newBalance };
}

// --------------------------------------------------------------- Blackjack

/**
 * Startet eine Blackjack-Runde.
 *
 * Reihenfolge ist bewusst gewählt: die Runde wird SYNCHRON in der Datenbank
 * reserviert, bevor der erste await passiert. Ein zweiter, schneller Klick
 * findet dann bereits eine laufende Runde vor und wird abgewiesen – so lässt
 * sich der Einsatz nicht doppelt abbuchen.
 */
async function blackjackDeal(guildId, userId, bet, random = Math.random) {
  if (db.getGame(guildId, userId)) return { ok: false, reason: 'active' };

  const state = casino.blackjackDeal(random);
  db.setGame(guildId, userId, bet, state);   // Slot synchron belegen

  const balance = await getBalance(guildId, userId);
  if (balance.total < bet) {
    db.clearGame(guildId, userId);
    return { ok: false, reason: 'insufficient_funds', have: balance.total, needed: bet };
  }

  await changeCash(guildId, userId, -bet, 'Blackjack: Einsatz');

  // Naturblackjack bei Spieler oder Dealer beendet die Runde sofort.
  if (casino.isBlackjack(state.player) || casino.isBlackjack(state.dealer)) {
    return finish(guildId, userId);
  }

  return { ok: true, status: 'playing', state, bet };
}

/** Spieler zieht eine Karte. */
async function blackjackHit(guildId, userId) {
  const game = db.getGame(guildId, userId);
  if (!game) return { ok: false, reason: 'no_game' };

  casino.blackjackHit(game);

  if (casino.handValue(game.player) > 21) {
    return finish(guildId, userId, game);   // überkauft
  }

  db.updateGame(guildId, userId, game);
  return { ok: true, status: 'playing', state: game, bet: game.bet };
}

/** Spieler bleibt stehen – Dealer spielt aus. */
async function blackjackStand(guildId, userId) {
  const game = db.getGame(guildId, userId);
  if (!game) return { ok: false, reason: 'no_game' };
  return finish(guildId, userId, game);
}

/**
 * Beendet die Runde und zahlt aus. Die Runde wird SYNCHRON gelöscht, bevor
 * die Auszahlung gebucht wird – dadurch kann ein zweiter Klick nicht ein
 * zweites Mal kassieren.
 */
async function finish(guildId, userId, game = null, random = Math.random) {
  const g = game ?? db.getGame(guildId, userId);
  if (!g) return { ok: false, reason: 'no_game' };

  // Dealer spielt nur aus, wenn der Spieler nicht überkauft hat.
  if (casino.handValue(g.player) <= 21) casino.dealerPlay(g, random);

  const result = casino.blackjackSettle(g);
  const gross = Math.round(g.bet * result.multiplier);

  db.clearGame(guildId, userId);   // vor der Auszahlung

  const newBalance = gross > 0
    ? await changeCash(guildId, userId, gross, `Blackjack: ${result.outcome}`)
    : await getBalance(guildId, userId);

  return { ok: true, status: 'done', state: g, bet: g.bet, result, gross, newBalance };
}

module.exports = { playRound, blackjackDeal, blackjackHit, blackjackStand, finish };
