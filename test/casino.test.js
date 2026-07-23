/**
 * Tests fürs Casino.
 *
 * Schwerpunkt: kein Spiel darf über 100 % ausschütten (kein Gelddrucker).
 * Dazu Monte-Carlo je Spiel plus Blackjack-Geldfluss und Doppelklick-Schutz.
 *
 * Aufruf: npm run test:casino
 */
const db = require('../src/db');
const casino = require('../src/casino');
const play = require('../src/casinoPlay');
const unb = require('../src/unb');

const G = 'TESTGUILD13';
const U = 'TESTUSER';
let pass = 0, fail = 0;

const check = (label, ok, extra = '') => {
  if (ok) { pass++; console.log(`  ✅ ${label}`); }
  else { fail++; console.log(`  ❌ ${label} ${extra}`); }
};

const wallet = {};
const balanceOf = (u) => (wallet[u] ??= { cash: 100000000, bank: 0, total: 100000000 });
unb.getBalance = async (g, u) => ({ ...balanceOf(u) });
unb.changeCash = async (g, u, a) => {
  const b = balanceOf(u); b.cash += a; b.total = b.cash + b.bank; return { ...b };
};

db.clearGame(G, U);

(async () => {
  const N = 2000000;

  console.log('--- RTP: kein Spiel über 100 % ---');

  let cf = 0;
  for (let i = 0; i < N; i++) cf += casino.coinflip(Math.random() < 0.5 ? 'kopf' : 'zahl').multiplier;
  const cfRtp = cf / N;
  console.log(`    Coinflip RTP: ${(cfRtp * 100).toFixed(2)} %`);
  check('Coinflip ≤ 100 %', cfRtp <= 1.005, String(cfRtp));
  check('Coinflip ist fair (~100 %)', Math.abs(cfRtp - 1) < 0.01, String(cfRtp));

  let sl = 0;
  for (let i = 0; i < N; i++) sl += casino.slots().multiplier;
  const slRtp = sl / N;
  console.log(`    Slots RTP: ${(slRtp * 100).toFixed(2)} %`);
  check('Slots unter 100 %', slRtp < 1, String(slRtp));
  check('Slots nicht zu geizig (>80 %)', slRtp > 0.8, String(slRtp));

  for (const bet of ['red', 'black', 'green', 'dozen1', 'dozen2', 'dozen3']) {
    let r = 0;
    for (let i = 0; i < N; i++) r += casino.roulette(bet).multiplier;
    const rtp = r / N;
    check(`Roulette ${bet} unter 100 % (${(rtp * 100).toFixed(1)} %)`, rtp < 1, String(rtp));
  }

  // Blackjack: Strategie "wie der Dealer" (ziehen bis 17) als Referenz.
  let bj = 0;
  const M = 500000;
  for (let i = 0; i < M; i++) {
    const st = casino.blackjackDeal();
    while (casino.handValue(st.player) < 17) casino.blackjackHit(st);
    if (casino.handValue(st.player) <= 21) casino.dealerPlay(st);
    bj += casino.blackjackSettle(st).multiplier;
  }
  const bjRtp = bj / M;
  console.log(`    Blackjack RTP (Dealer-Strategie): ${(bjRtp * 100).toFixed(2)} %`);
  check('Blackjack unter 100 %', bjRtp < 1, String(bjRtp));

  console.log('--- Kartenlogik ---');
  check('Ass flexibel (A+K = 21)', casino.handValue(['AS', 'KH']) === 21);
  check('Doppel-Ass (A+A = 12)', casino.handValue(['AS', 'AH']) === 12);
  check('Ass wird abgewertet (A+9+5 = 15)', casino.handValue(['AS', '9H', '5C']) === 15);
  check('Blackjack erkannt', casino.isBlackjack(['AS', 'KH']) === true);
  check('21 aus 3 Karten kein Blackjack', casino.isBlackjack(['7S', '7H', '7C']) === false);
  check('Schuh hat 4×52 Karten', casino.makeShoe().length === 208);

  console.log('--- Einsatzgrenzen ---');
  check('Minimum greift', casino.clampBet(1) === casino.MIN_BET);
  check('Maximum greift', casino.clampBet(1e12) === casino.MAX_BET);
  check('Text wird geparst', casino.clampBet('500') === 500);
  check('Unsinn wird zum Minimum', casino.clampBet('abc') === casino.MIN_BET);

  console.log('--- Geldfluss: Einzelrunde ---');
  balanceOf(U).cash = 100000; balanceOf(U).total = 100000;
  // Erzwungener Coinflip-Gewinn.
  const win = await play.playRound(G, U, 1000, 'test', () => ({ result: 'kopf', win: true, multiplier: 2 }));
  check('Gewinn: Netto +Einsatz', win.net === 1000, String(win.net));
  check('Gewinn gutgeschrieben', balanceOf(U).cash === 101000, String(balanceOf(U).cash));

  const lose = await play.playRound(G, U, 1000, 'test', () => ({ multiplier: 0 }));
  check('Verlust: Netto −Einsatz', lose.net === -1000, String(lose.net));
  check('Verlust abgebucht', balanceOf(U).cash === 100000, String(balanceOf(U).cash));

  balanceOf(U).cash = 500; balanceOf(U).total = 500;
  const broke = await play.playRound(G, U, 1000, 'test', () => ({ multiplier: 2 }));
  check('kein Spiel ohne Deckung', broke.ok === false && broke.reason === 'insufficient_funds');
  check('kein Geld bewegt', balanceOf(U).cash === 500);

  console.log('--- Netto 0 (Einsatz zurück) bucht nichts ---');
  balanceOf(U).cash = 100000; balanceOf(U).total = 100000;
  // changeCash überwachen: bei Netto 0 darf es NICHT gerufen werden
  // (UnbelievaBoat lehnt cash:0 mit 400 ab).
  const realChange = unb.changeCash;
  let changeCalls = 0;
  unb.changeCash = async (...a) => { changeCalls++; return realChange(...a); };
  const even = await play.playRound(G, U, 1000, 'test', () => ({ multiplier: 1 }));
  unb.changeCash = realChange;
  check('Runde ok, Netto 0', even.ok === true && even.net === 0, JSON.stringify(even));
  check('changeCash nicht aufgerufen', changeCalls === 0, String(changeCalls));
  check('Guthaben unverändert', balanceOf(U).cash === 100000, String(balanceOf(U).cash));
  check('Bilanz wird trotzdem gemeldet', even.newBalance.cash === 100000);

  console.log('--- Blackjack-Geldfluss ---');
  balanceOf(U).cash = 100000; balanceOf(U).total = 100000;
  db.clearGame(G, U);

  // Deterministischer Schuh über eine feste RNG wäre aufwändig – wir prüfen
  // den Geldfluss über viele echte Runden: Bilanz = Auszahlungen − Einsätze.
  let staked = 0, returned = 0;
  const startCash = balanceOf(U).cash;
  for (let i = 0; i < 2000; i++) {
    const bet = 100;
    const dealt = await play.blackjackDeal(G, U, bet);
    staked += bet;
    let res = dealt;
    // Einfache Strategie: ziehen bis 17.
    while (res.ok && res.status === 'playing' && casino.handValue(res.state.player) < 17) {
      res = await play.blackjackHit(G, U);
    }
    if (res.ok && res.status === 'playing') res = await play.blackjackStand(G, U);
    if (res.ok && res.status === 'done') returned += res.gross;
  }
  const bilanz = balanceOf(U).cash - startCash;
  console.log(`    2000 Runden: eingesetzt ${staked}, zurück ${returned}, Bilanz ${bilanz}`);
  // Deterministisch: die Buchung muss exakt aufgehen.
  check('Bilanz = Rückzahlung − Einsatz', bilanz === returned - staked,
    `${bilanz} vs ${returned - staked}`);
  // Statistisch nur grob (der echte Hausvorteil steckt im Monte-Carlo oben):
  // die Rückzahlung darf nicht deutlich über dem Einsatz liegen.
  check('kein Faucet über 2000 Runden', returned <= staked * 1.05,
    `RTP ${(returned / staked * 100).toFixed(1)} %`);
  check('keine laufende Runde übrig', db.getGame(G, U) === null);

  console.log('--- Doppelklick-Schutz: kein zweiter Einsatz ---');
  balanceOf(U).cash = 100000; balanceOf(U).total = 100000;
  db.clearGame(G, U);
  // Laufende Runde vortäuschen (nicht-terminaler Zustand).
  db.setGame(G, U, 5000, { shoe: casino.makeShoe(), player: ['5S', '6H'], dealer: ['KD', '7C'] });
  const before = balanceOf(U).cash;
  const d2 = await play.blackjackDeal(G, U, 5000);
  check('Deal während laufender Runde abgewiesen',
    d2.ok === false && d2.reason === 'active', JSON.stringify(d2));
  check('kein Einsatz abgebucht', balanceOf(U).cash === before, String(before - balanceOf(U).cash));
  db.clearGame(G, U);

  console.log('--- Doppelklick-Schutz: keine doppelte Auszahlung ---');
  balanceOf(U).cash = 100000; balanceOf(U).total = 100000;
  db.clearGame(G, U);
  await play.blackjackDeal(G, U, 1000);
  const s1 = await play.blackjackStand(G, U);
  const cashAfterStand = balanceOf(U).cash;
  const s2 = await play.blackjackStand(G, U);   // zweiter Klick
  check('zweites Stand ohne Runde', s2.ok === false && s2.reason === 'no_game');
  check('kein zweites Mal ausgezahlt', balanceOf(U).cash === cashAfterStand,
    String(balanceOf(U).cash - cashAfterStand));

  db.clearGame(G, U);
  console.log(`\n${pass} bestanden, ${fail} fehlgeschlagen`);
  process.exit(fail === 0 ? 0 : 1);
})();
