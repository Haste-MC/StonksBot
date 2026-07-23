/**
 * Casino-Spiellogik.
 *
 * ===================== GRUNDREGEL =====================
 * Kein Spiel darf für den Spieler einen Erwartungswert über 100 % haben.
 * Sonst wäre das Casino ein Gelddrucker. Jede Auszahlungstabelle ist so
 * gewählt, dass der "Hausvorteil" ≥ 0 ist – geprüft per Monte-Carlo in
 * test/casino.test.js.
 * =====================================================
 *
 * Alle Funktionen nehmen optional eine RNG entgegen, damit die Tests
 * deterministisch laufen können.
 */

const MIN_BET = 10;
const MAX_BET = 1000000;

const rnd = (random = Math.random) => random();
const pick = (arr, random = Math.random) => arr[Math.floor(random() * arr.length)];

// ------------------------------------------------------------------- Karten

const SUITS = { S: '♠️', H: '♥️', D: '♦️', C: '♣️' };
const RANKS = ['A', '2', '3', '4', '5', '6', '7', '8', '9', 'T', 'J', 'Q', 'K'];
const DECKS_IN_SHOE = 4;   // Mehrere Decks halten den Hausvorteil stabil positiv.

/** Ein gemischter Schuh aus mehreren Decks, als Array von Codes wie "TH". */
function makeShoe(random = Math.random) {
  const cards = [];
  for (let d = 0; d < DECKS_IN_SHOE; d++) {
    for (const s of Object.keys(SUITS)) {
      for (const r of RANKS) cards.push(r + s);
    }
  }
  // Fisher-Yates.
  for (let i = cards.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [cards[i], cards[j]] = [cards[j], cards[i]];
  }
  return cards;
}

/** Anzeigeform einer Karte, z.B. "10♥️", "A♠️". */
function formatCard(code) {
  const rank = code.slice(0, -1);
  const suit = SUITS[code.slice(-1)];
  return `${rank === 'T' ? '10' : rank}${suit}`;
}

const formatHand = (hand) => hand.map(formatCard).join(' ');

/** Blackjack-Wert einer Hand (Ass als 11 oder 1). */
function handValue(hand) {
  let total = 0;
  let aces = 0;
  for (const code of hand) {
    const r = code.slice(0, -1);
    if (r === 'A') { total += 11; aces++; }
    else if (['T', 'J', 'Q', 'K'].includes(r)) total += 10;
    else total += Number(r);
  }
  while (total > 21 && aces > 0) { total -= 10; aces--; }
  return total;
}

const isBlackjack = (hand) => hand.length === 2 && handValue(hand) === 21;

// --------------------------------------------------------------- Blackjack

/**
 * Teilt eine neue Blackjack-Runde. Gibt den Anfangszustand zurück.
 * Der Einsatz ist zu diesem Zeitpunkt bereits abgebucht.
 */
function blackjackDeal(random = Math.random) {
  const shoe = makeShoe(random);
  const player = [shoe.pop(), shoe.pop()];
  const dealer = [shoe.pop(), shoe.pop()];
  return { shoe, player, dealer };
}

/** Spieler zieht eine Karte. */
function blackjackHit(state) {
  state.player.push(state.shoe.pop());
  return state;
}

/**
 * Dealer spielt aus: zieht bis mindestens 17. Hit auf Soft 17 hält den
 * Hausvorteil klar positiv (siehe Grundregel).
 */
function dealerPlay(state, random = Math.random) {
  while (true) {
    const v = handValue(state.dealer);
    if (v > 17) break;
    if (v === 17) {
      // Soft 17? -> ziehen. (Ass als 11 gezählt und Gesamt 17.)
      const soft = state.dealer.some((c) => c.startsWith('A')) &&
        rawSum(state.dealer) !== 17;
      if (!soft) break;
    }
    state.dealer.push(state.shoe.pop());
  }
  return state;
}

/** Summe ohne Ass-Abwertung – nur zur Soft-Hand-Erkennung. */
function rawSum(hand) {
  let t = 0;
  for (const code of hand) {
    const r = code.slice(0, -1);
    if (r === 'A') t += 11;
    else if (['T', 'J', 'Q', 'K'].includes(r)) t += 10;
    else t += Number(r);
  }
  return t;
}

/**
 * Wertet eine beendete Runde aus.
 * @returns {{outcome, multiplier}} multiplier = Bruttorückzahlung / Einsatz.
 *   2.5 = Blackjack, 2 = Gewinn, 1 = Push, 0 = Verlust.
 */
function blackjackSettle(state) {
  const pv = handValue(state.player);
  const dv = handValue(state.dealer);
  const pbj = isBlackjack(state.player);
  const dbj = isBlackjack(state.dealer);

  if (pv > 21) return { outcome: 'bust', multiplier: 0 };
  if (pbj && dbj) return { outcome: 'push', multiplier: 1 };
  if (pbj) return { outcome: 'blackjack', multiplier: 2.5 };
  if (dbj) return { outcome: 'dealer_blackjack', multiplier: 0 };
  if (dv > 21) return { outcome: 'dealer_bust', multiplier: 2 };
  if (pv > dv) return { outcome: 'win', multiplier: 2 };
  if (pv < dv) return { outcome: 'lose', multiplier: 0 };
  return { outcome: 'push', multiplier: 1 };
}

// ------------------------------------------------------------------ Coinflip

/**
 * Münzwurf. Faires 50/50, zahlt 2× – Erwartungswert genau 100 %.
 * @returns {{result, win, multiplier}}
 */
function coinflip(choice, random = Math.random) {
  const result = rnd(random) < 0.5 ? 'kopf' : 'zahl';
  const win = result === choice;
  return { result, win, multiplier: win ? 2 : 0 };
}

// -------------------------------------------------------------------- Slots

// Gewichte und Auszahlungen sind über test/casino.test.js auf einen
// Rückzahlungswert von ~92 % kalibriert (≈ 8 % Hausvorteil).
const SLOT_SYMBOLS = [
  { e: '🍒', weight: 24 },
  { e: '🍋', weight: 24 },
  { e: '🔔', weight: 20 },
  { e: '⭐', weight: 16 },
  { e: '💎', weight: 10 },
  { e: '7️⃣', weight: 6 },
];

/** Auszahlung (Bruttomultiplikator) für drei gleiche Symbole. */
const SLOT_TRIPLE = {
  '7️⃣': 90,
  '💎': 40,
  '⭐': 16,
  '🔔': 9,
  '🍋': 4,
  '🍒': 4,
};

/**
 * Auszahlung für ein Paar (zwei gleiche Symbole) – jetzt symbolabhängig.
 * Günstige Symbole geben den Einsatz zurück, seltene zahlen mehr.
 * Gesamt kalibriert auf ~89 % Rückzahlung (siehe test/casino.test.js).
 */
const SLOT_PAIR = {
  '🍒': 1,
  '🍋': 1,
  '🔔': 1.3,
  '⭐': 1.6,
  '💎': 2.2,
  '7️⃣': 3.5,
};

const SLOT_TOTAL_WEIGHT = SLOT_SYMBOLS.reduce((s, x) => s + x.weight, 0);

function spinReel(random = Math.random) {
  let roll = random() * SLOT_TOTAL_WEIGHT;
  for (const sym of SLOT_SYMBOLS) {
    if (roll < sym.weight) return sym.e;
    roll -= sym.weight;
  }
  return SLOT_SYMBOLS[SLOT_SYMBOLS.length - 1].e;
}

/**
 * Ein Spin mit drei Walzen.
 * @returns {{reels, multiplier, line}}
 */
function slots(random = Math.random) {
  const reels = [spinReel(random), spinReel(random), spinReel(random)];
  const [a, b, c] = reels;
  let multiplier = 0;
  let line = 'Kein Gewinn';

  if (a === b && b === c) {
    multiplier = SLOT_TRIPLE[a] ?? 0;
    line = `🎉 Dreimal ${a}!`;
  } else {
    // Welches Symbol bildet das Paar?
    const pairSym = (a === b || a === c) ? a : (b === c ? b : null);
    if (pairSym) {
      multiplier = SLOT_PAIR[pairSym] ?? 0;
      line = multiplier === 1
        ? `Paar ${pairSym} — Einsatz zurück`
        : `Paar ${pairSym} — ${String(multiplier).replace('.', ',')}×`;
    }
  }

  return { reels, multiplier, line };
}

// ------------------------------------------------------------------ Roulette

/** Rote Zahlen im europäischen Kessel. */
const RED_NUMBERS = new Set(
  [1, 3, 5, 7, 9, 12, 14, 16, 18, 19, 21, 23, 25, 27, 30, 32, 34, 36]);

const rouletteColor = (n) => (n === 0 ? 'green' : RED_NUMBERS.has(n) ? 'red' : 'black');

/**
 * Europäisches Roulette (ein Nullfach). Alle Wetten haben denselben
 * Hausvorteil von 1/37 ≈ 2,7 %.
 *
 * @param {string} bet 'red' | 'black' | 'green' | 'dozen1' | 'dozen2' | 'dozen3'
 * @returns {{number, color, multiplier}}
 */
function roulette(bet, random = Math.random) {
  const number = Math.floor(random() * 37);
  const color = rouletteColor(number);
  let multiplier = 0;

  if (bet === 'red' && color === 'red') multiplier = 2;
  else if (bet === 'black' && color === 'black') multiplier = 2;
  else if (bet === 'green' && color === 'green') multiplier = 36;
  else if (bet === 'dozen1' && number >= 1 && number <= 12) multiplier = 3;
  else if (bet === 'dozen2' && number >= 13 && number <= 24) multiplier = 3;
  else if (bet === 'dozen3' && number >= 25 && number <= 36) multiplier = 3;

  return { number, color, multiplier };
}

/** Begrenzt einen Einsatz auf den erlaubten Bereich. */
function clampBet(amount) {
  const n = Math.floor(Number(amount) || 0);
  return Math.min(MAX_BET, Math.max(MIN_BET, n));
}

module.exports = {
  MIN_BET, MAX_BET, SUITS, RANKS, DECKS_IN_SHOE,
  SLOT_SYMBOLS, SLOT_TRIPLE, SLOT_PAIR, RED_NUMBERS,
  makeShoe, formatCard, formatHand, handValue, isBlackjack,
  blackjackDeal, blackjackHit, dealerPlay, blackjackSettle,
  coinflip, spinReel, slots, rouletteColor, roulette, clampBet,
};
