/**
 * Tests für die Börse.
 *
 * Schwerpunkt: **KEIN GELDDRUCKER** (ARCHITEKTUR §3). Das ist hier heikler
 * als anderswo, weil der Spieler selbst entscheidet, wann er kauft und
 * verkauft. Der Beweis läuft zweigleisig:
 *
 *   1. **Analytisch:** Der Kurs ist ein Martingal – E[nächster Kurs] ist der
 *      aktuelle Kurs. Das wird über 200.000 Schritte gemessen.
 *   2. **Empirisch:** Vier Handelsstrategien (Halten, Dips kaufen, Trend
 *      reiten, Zufall) über tausende Ticks. Keine darf im Schnitt gewinnen.
 *
 * Dazu: Gebührenrechnung, Doppelklick-Schutz, Rückabwicklung, Insolvenz.
 *
 * Aufruf: node test/wallstreet.test.js
 */
const db = require('../src/db');
const market = require('../src/wallstreet');
const data = require('../src/data/wallstreet');
const unb = require('../src/unb');

const G = 'TESTWORLD_BOERSE';
const U = 'BOERSENUSER';
let pass = 0, fail = 0;

const check = (label, ok, extra = '') => {
  if (ok) { pass++; console.log(`  ✅ ${label}`); }
  else { fail++; console.log(`  ❌ ${label} ${extra}`); }
};

/** Deterministischer PRNG (mulberry32) für reproduzierbare Läufe. */
function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// Geld mocken (§8).
const wallet = {};
const balanceOf = (u) => (wallet[u] ??= { cash: 10_000_000, bank: 0, total: 10_000_000 });
unb.getBalance = async (g, u) => ({ ...balanceOf(u) });
unb.changeCash = async (g, u, a) => {
  const b = balanceOf(u); b.cash += a; b.total = b.cash + b.bank; return { ...b };
};
unb.withdrawFromBank = async (g, u, a) => {
  const b = balanceOf(u); b.cash += a; b.bank -= a; b.total = b.cash + b.bank; return { ...b };
};

const H = market.TICK_MS;
db.clearMarket(G);

(async () => {
  console.log('--- KEIN GELDDRUCKER: der Kurs ist ein Martingal ---');
  // E[exp(σ·z − σ²/2)] === 1. Ohne den Abzug σ²/2 hätte jeder Wert eine
  // eingebaute Aufwärtsdrift – Geld aus dem Nichts, wachsend mit der Schwankung.
  for (const sigma of [0.005, 0.02, 0.05]) {
    const rng = mulberry32(4242 + Math.round(sigma * 1000));
    const N = 200000;
    let sum = 0;
    for (let i = 0; i < N; i++) {
      sum += Math.exp(sigma * market.gauss(rng) - (sigma * sigma) / 2);
    }
    const mean = sum / N;
    check(`σ=${sigma}: E[Ertrag] ≈ 1 (${mean.toFixed(4)})`, Math.abs(mean - 1) < 0.01,
      String(mean));
  }

  const rngStep = mulberry32(777);
  let sum = 0;
  const N = 200000;
  for (let i = 0; i < N; i++) sum += market.step(10000, 0.02, rngStep);
  check(`Kursschritt hält den Erwartungswert (${Math.round(sum / N)} statt 10000)`,
    Math.abs(sum / N - 10000) < 100, String(sum / N));

  check('Kurse bleiben positiv',
    Array.from({ length: 5000 }, () => market.step(1, 0.05, rngStep)).every((p) => p >= 1));

  console.log('--- Nervosität ändert die Streuung, nicht die Richtung ---');
  const rngVol = mulberry32(99);
  let vol = 1;
  const vols = [];
  for (let i = 0; i < 20000; i++) { vol = market.nextVol(vol, rngVol); vols.push(vol); }
  check('bleibt in ihren Grenzen',
    vols.every((v) => v >= market.VOL_RANGE[0] && v <= market.VOL_RANGE[1]));
  check('pendelt um die Normallage',
    Math.abs(vols.reduce((a, b) => a + b, 0) / vols.length - 1) < 0.15,
    String(vols.reduce((a, b) => a + b, 0) / vols.length));
  const hoch = vols.filter((v) => v > 1.3).length;
  check('es gibt ruhige UND hektische Phasen', hoch > 100 && hoch < vols.length * 0.6,
    String(hoch));

  console.log('--- Katalog ---');
  check('mindestens 20 handelbare Werte', data.ASSETS.length >= 20, String(data.ASSETS.length));
  check('alle drei Anlageklassen vertreten',
    ['stock', 'fund', 'crypto'].every((k) => data.ASSETS.some((a) => a.kind === k)));
  check('Kürzel sind eindeutig',
    new Set(data.ASSETS.map((a) => a.symbol)).size === data.ASSETS.length);
  check('jeder Wert hat Startkurs oder Korb',
    data.ASSETS.every((a) => (a.kind === 'fund' ? a.basket : a.start > 0)));
  check('Krypto schwankt stärker als Aktien',
    Math.min(...data.ASSETS.filter((a) => a.kind === 'crypto').map((a) => a.sigma)) >
    Math.max(...data.ASSETS.filter((a) => a.kind === 'stock').map((a) => a.sigma)));

  console.log('--- Simulation läuft gegen die Uhr, nicht gegen Aufrufe ---');
  const t0 = Date.now();
  const first = await market.advance(G, t0);
  check('erster Lauf notiert nur (kein Nachholen)', first.simulated === 0, String(first.simulated));
  check('alle Werte notiert', db.allPrices(G).length === data.ASSETS.length,
    String(db.allPrices(G).length));

  const again = await market.advance(G, t0);
  check('zweiter Aufruf ohne Zeitablauf bewegt nichts', again.simulated === 0);
  const before = market.quote(G, 'HAST', t0).price;
  await market.advance(G, t0);
  check('Kurs unverändert', market.quote(G, 'HAST', t0).price === before);

  const later = await market.advance(G, t0 + 10 * H);
  check('10 Takte später wurden 10 Takte simuliert', later.simulated === 10,
    String(later.simulated));
  const far = await market.advance(G, t0 + 10000 * H);
  check(`Nachholen ist gedeckelt (${market.MAX_CATCHUP})`, far.simulated === market.MAX_CATCHUP,
    String(far.simulated));

  console.log('--- Fonds sind wirklich der Durchschnitt ---');
  const now = t0 + 10000 * H;
  const idx = market.quote(G, 'IDX', now);
  const stocks = data.ASSETS.filter((a) => a.kind === 'stock')
    .map((a) => market.quote(G, a.symbol, now).price);
  const mean = Math.round(stocks.reduce((a, b) => a + b, 0) / stocks.length);
  check('Index = Mittelwert aller Aktien', Math.abs(idx.price - mean) <= 1,
    `${idx.price} vs ${mean}`);

  // Diversifikation ist hier echt, nicht simuliert: Der Korb schwankt weniger.
  const swing = (sym) => {
    const h = market.quote(G, sym, now).history;
    const rel = h.slice(1).map((p, i) => Math.abs(p - h[i]) / h[i]);
    return rel.reduce((a, b) => a + b, 0) / Math.max(1, rel.length);
  };
  const stockSwing = data.ASSETS.filter((a) => a.kind === 'stock')
    .reduce((s, a) => s + swing(a.symbol), 0) / stocks.length;
  check('Fonds schwankt weniger als der Schnitt seiner Einzelwerte',
    swing('IDX') < stockSwing, `${swing('IDX').toFixed(4)} vs ${stockSwing.toFixed(4)}`);

  console.log('--- Gebühren: die einzige Stelle, an der Geld verschwindet ---');
  const cash0 = balanceOf(U).total;
  const price = market.quote(G, 'HAST', now).price;
  const buyRes = await market.buy(G, U, 'HAST', 10, now);
  check('Kauf klappt', buyRes.ok === true, JSON.stringify(buyRes).slice(0, 120));
  check('Gebühr ist 1 % des Auftragswerts',
    buyRes.fee === Math.max(market.MIN_FEE, Math.round(10 * price * market.FEE)),
    `${buyRes.fee}`);
  check('abgebucht wurde Kurs + Gebühr',
    cash0 - balanceOf(U).total === 10 * price + buyRes.fee,
    `${cash0 - balanceOf(U).total} vs ${10 * price + buyRes.fee}`);
  check('Stücke liegen im Depot',
    db.getHolding(G, U, 'HAST').shares === 10);

  const sellRes = await market.sell(G, U, 'HAST', null, now);
  check('Sofortiger Rückverkauf kostet genau zwei Gebühren',
    cash0 - balanceOf(U).total === buyRes.fee + sellRes.fee,
    `${cash0 - balanceOf(U).total} vs ${buyRes.fee + sellRes.fee}`);
  check('Position ist weg', db.getHolding(G, U, 'HAST') === null);

  console.log('--- Grenzen und Fehlerfälle ---');
  const unknown = await market.buy(G, U, 'GIBTSNICHT', 1, now);
  check('unbekanntes Kürzel', !unknown.ok && unknown.reason === 'unknown_symbol');
  const zero = await market.buy(G, U, 'HAST', 0, now);
  check('null Stück abgelehnt', !zero.ok && zero.reason === 'bad_amount');
  const huge = await market.buy(G, U, 'HAST', 5_000_000, now);
  check('absurde Mengen abgelehnt', !huge.ok && huge.reason === 'too_many', huge.reason);
  const sellNone = await market.sell(G, U, 'MIRO', 1, now);
  check('verkaufen ohne Bestand', !sellNone.ok && sellNone.reason === 'nothing_held');

  await market.buy(G, U, 'MIRO', 3, now);
  const tooMany = await market.sell(G, U, 'MIRO', 99, now);
  check('mehr verkaufen als man hat', !tooMany.ok && tooMany.reason === 'not_enough_shares',
    tooMany.reason);
  check('Bestand unangetastet', db.getHolding(G, U, 'MIRO').shares === 3);

  const POOR = 'ARMER';
  balanceOf(POOR).cash = 10; balanceOf(POOR).total = 10;
  const broke = await market.buy(G, POOR, 'MIRO', 100, now);
  check('ohne Deckung kein Kauf', !broke.ok && broke.reason === 'insufficient_funds');
  check('und keine Position angelegt', db.getHolding(G, POOR, 'MIRO') === null);

  console.log('--- Teilverkauf rechnet den Einstand anteilig ---');
  const holding = db.getHolding(G, U, 'MIRO');
  const part = await market.sell(G, U, 'MIRO', 1, now);
  check('ein Stück verkauft', part.ok && part.shares === 1);
  check('zwei bleiben liegen', db.getHolding(G, U, 'MIRO').shares === 2);
  check('Einstand wanderte anteilig mit',
    Math.abs(db.getHolding(G, U, 'MIRO').invested - Math.round(holding.invested * 2 / 3)) <= 1,
    `${db.getHolding(G, U, 'MIRO').invested} vs ${Math.round(holding.invested * 2 / 3)}`);
  await market.sell(G, U, 'MIRO', null, now);

  console.log('--- Rückabwicklung, wenn die Geldbuchung scheitert ---');
  const realChange = unb.changeCash;
  unb.changeCash = async () => { throw new Error('API weg'); };
  let threw = false;
  try { await market.buy(G, U, 'BETO', 5, now); } catch { threw = true; }
  unb.changeCash = realChange;
  check('Fehler wird durchgereicht', threw);
  check('keine Position aus dem Nichts', db.getHolding(G, U, 'BETO') === null);

  await market.buy(G, U, 'BETO', 5, now);
  unb.changeCash = async () => { throw new Error('API weg'); };
  threw = false;
  try { await market.sell(G, U, 'BETO', 5, now); } catch { threw = true; }
  unb.changeCash = realChange;
  check('auch beim Verkauf', threw && db.getHolding(G, U, 'BETO').shares === 5,
    String(db.getHolding(G, U, 'BETO')?.shares));
  await market.sell(G, U, 'BETO', null, now);

  console.log('--- Insolvenz: Halter werden ausgezahlt, Wert startet neu ---');
  const PLEITE = 'PLEITEUSER';
  db.setPrice(G, 'QUAK', 6, market.tickOf(now));
  await market.buy(G, PLEITE, 'QUAK', 100, now);
  const beforeCrash = balanceOf(PLEITE).total;
  db.setPrice(G, 'QUAK', 4, market.tickOf(now));       // unter die Notierungsgrenze
  const crash = await market.bankrupt(G, data.find('QUAK'), 4, market.tickOf(now), now);
  check('Halter ausgezahlt', crash.paid.length === 1 && crash.paid[0].amount > 0,
    JSON.stringify(crash.paid[0]));
  check('Auszahlung abzüglich Gebühr (nicht besser als ein Verkauf)',
    crash.paid[0].amount === 100 * 4 - market.feeFor(400), String(crash.paid[0].amount));
  check('Geld ist angekommen', balanceOf(PLEITE).total === beforeCrash + crash.paid[0].amount);
  check('Depotposition ist ausgebucht', db.getHolding(G, PLEITE, 'QUAK') === null);
  check('Wert wird neu notiert', market.quote(G, 'QUAK', now).price === data.find('QUAK').start,
    String(market.quote(G, 'QUAK', now).price));
  check('Postfach informiert',
    db.listMessages(G, PLEITE, 1).items.some((m) => m.title.includes('Insolvenz')));

  console.log('--- Keine Strategie schlägt den Markt ---');
  // Eine EINZELNE Kursbahn beweist gar nichts: Bei einem Martingal kann jede
  // Strategie durch Glück im Plus landen. Deshalb zwei belastbare Aussagen.

  /** Spielt eine Strategie auf einer Kursbahn durch. */
  function play(decide, seed, { fees = true, ticks = 400 } = {}) {
    const rng = mulberry32(seed);
    let cash = 0, shares = 0, price = 5000, paid = 0;
    const hist = [price];

    for (let t = 0; t < ticks; t++) {
      price = market.step(price, 0.02, rng);
      hist.push(price);
      const action = decide(hist, rng);
      const fee = (value) => (fees ? market.feeFor(value) : 0);

      if (action === 'buy') {
        const value = 10 * price;
        cash -= value + fee(value); paid += fee(value); shares += 10;
      } else if (action === 'sell' && shares > 0) {
        const n = Math.min(shares, 10);
        const value = n * price;
        cash += value - fee(value); paid += fee(value); shares -= n;
      }
    }
    return { end: cash + shares * price, paid };
  }

  const strategies = {
    halten: (h) => (h.length === 2 ? 'buy' : 'hold'),
    dipKaufen: (h) => (h.at(-1) < h.at(-2) * 0.98 ? 'buy'
      : (h.at(-1) > h.at(-2) * 1.02 ? 'sell' : 'hold')),
    trendReiten: (h) => (h.at(-1) > h.at(-2) * 1.02 ? 'buy'
      : (h.at(-1) < h.at(-2) * 0.98 ? 'sell' : 'hold')),
    zufall: (h, r) => (r() < 0.1 ? 'buy' : (r() < 0.2 ? 'sell' : 'hold')),
  };

  // 1) EXAKT: Auf derselben Kursbahn ist das Ergebnis mit Gebühr immer genau
  //    um die gezahlten Gebühren schlechter. Kein Zufall, keine Toleranz.
  for (const [name, decide] of Object.entries(strategies)) {
    let exact = true;
    for (let seed = 1; seed <= 40 && exact; seed++) {
      const withFee = play(decide, seed, { fees: true });
      const without = play(decide, seed, { fees: false });
      if (Math.abs((without.end - withFee.end) - withFee.paid) > 1) exact = false;
      if (withFee.end > without.end) exact = false;
    }
    check(`"${name}": Gebühren kosten exakt das, was sie kosten`, exact);
  }

  // 2) IM MITTEL: über 600 unabhängige Kursbahnen darf keine Strategie einen
  //    Gewinn erwirtschaften. Wer viel handelt, verliert deutlich mehr.
  const RUNS = 600;
  for (const [name, decide] of Object.entries(strategies)) {
    let total = 0, fees = 0;
    for (let seed = 1; seed <= RUNS; seed++) {
      const r = play(decide, seed * 7919);
      total += r.end; fees += r.paid;
    }
    const mean = total / RUNS;
    const meanFee = fees / RUNS;
    console.log(`    ${name.padEnd(12)} Ø Ergebnis ${Math.round(mean).toLocaleString('de-DE').padStart(10)} · ` +
      `Ø Gebühren ${Math.round(meanFee).toLocaleString('de-DE')}`);
    check(`"${name}" gewinnt im Mittel nicht`, mean <= 0, String(Math.round(mean)));
  }

  // 3) Der typische Halter verliert leicht: Der MEDIAN eines Martingals liegt
  //    unter dem Startwert (Wurzel-Effekt), der Mittelwert ist null.
  const ends = [];
  for (let seed = 1; seed <= 600; seed++) ends.push(play(strategies.halten, seed * 104729).end);
  ends.sort((a, b) => a - b);
  check('typischer Halter (Median) endet im Minus', ends[Math.floor(ends.length / 2)] < 0,
    String(Math.round(ends[Math.floor(ends.length / 2)])));

  console.log('--- Anzeige ---');
  check('Sparkline hat die richtige Länge',
    market.sparkline([1, 2, 3, 4, 5], 5).length === 5, market.sparkline([1, 2, 3, 4, 5], 5));
  check('flacher Verlauf stürzt nicht ab', market.sparkline([7, 7, 7]) === '▄▄▄');
  check('einzelner Punkt geht auch', market.sparkline([5]).length === 1);
  check('Prozentanzeige mit Vorzeichen',
    market.percent(0.0345) === '+3,5 %'.replace(',', '.') || market.percent(0.0345) === '+3.5 %',
    market.percent(0.0345));
  check('negative Richtung erkennbar', market.percent(-0.05).startsWith('−'));
  check('Pfeile zeigen die Richtung',
    market.arrow(0.05) === '📈' && market.arrow(-0.05) === '📉' && market.arrow(0) === '➖');

  console.log('--- Kaufmenge für einen Betrag ---');
  const q = market.quote(G, 'HAST', now);
  const forBudget = market.sharesFor(q.price, 100000);
  check('Gebühr ist eingerechnet (Budget reicht wirklich)',
    forBudget * q.price + market.feeFor(forBudget * q.price) <= 100000,
    `${forBudget} × ${q.price}`);
  check('ein Stück mehr wäre zu teuer',
    (forBudget + 1) * q.price + market.feeFor((forBudget + 1) * q.price) > 100000);
  check('bei zu kleinem Budget null Stück', market.sharesFor(1000, 10) === 0);

  console.log('--- Ticker ---');
  check('Ticker startet', market.startTicker(G, { intervalMs: 60000 }) === true);
  check('nur einer gleichzeitig', market.startTicker(G, { intervalMs: 60000 }) === false);
  check('lässt sich stoppen', market.stopTicker() === true && !market.tickerRunning());

  db.clearMarket(G);
  console.log(`\n${pass} bestanden, ${fail} fehlgeschlagen`);
  process.exit(fail === 0 ? 0 : 1);
})();
