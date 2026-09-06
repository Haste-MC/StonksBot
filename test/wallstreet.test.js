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
  console.log('--- Das Fundament: der Zufallsschritt selbst ist fair ---');
  /*
   * E[exp(σ·z − σ²/2)] === 1: Ohne diesen Abzug hätte jeder Wert eine
   * eingebaute Drift, die mit der Schwankung wächst. Der Abzug bleibt – die
   * bewusste Drift kommt separat obendrauf und ist gedeckelt (siehe unten).
   */
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
  // Der Schritt trägt jetzt die gedeckelte Drift – der Erwartungswert liegt
  // also ein Stück ÜBER dem Ausgangskurs, und zwar um genau diesen Deckel.
  const erwartet = 10000 * Math.exp(market.DRIFT_CAP);
  check(`Kursschritt steigt um die Drift (${Math.round(sum / N)} statt ${Math.round(erwartet)})`,
    Math.abs(sum / N - erwartet) < 120, String(sum / N));
  check('und die Drift ist gedeckelt', market.DRIFT_CAP <= 0.00005, String(market.DRIFT_CAP));

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

  console.log('--- Drift: Halten blutet nicht mehr aus ---');
  {
    /*
     * Der Grund für die Drift. Vorher galt Median = Mittelwert · e^(−σ²t/2):
     * Der Erwartungswert stimmte, aber der typische Verlauf sank – gemessen
     * gingen nur 39 % aller Käufe mit Gewinn raus. Jetzt hebt die Drift genau
     * dieses Ausbluten auf, solange die Schwankung unter dem Deckel bleibt.
     */
    const typisch = data.ASSETS.filter((a) => a.kind === 'stock').map((a) => a.sigma)
      .sort((a, b) => a - b)[Math.floor(data.ASSETS.filter((a) => a.kind === 'stock').length / 2)];

    const halten = (sigma, ticks, N = 3000) => {
      const out = []; let sum = 0;
      for (let i = 0; i < N; i++) {
        const rng = mulberry32(i * 7919 + 3);
        let p = 5000, vol = 1;
        for (let t = 0; t < ticks; t++) {
          vol = market.nextVol(vol, rng);
          p = market.step(p, sigma * vol, rng,
            market.gauss(rng) * market.MARKET_SIGMA * vol, market.MARKET_SIGMA * vol);
        }
        out.push(p / 5000); sum += p / 5000;
      }
      out.sort((a, b) => a - b);
      return { med: out[Math.floor(0.5 * N)], mean: sum / N };
    };

    const monat = halten(typisch, 1440);
    console.log(`    typische Aktie über einen Monat: Median ${((monat.med - 1) * 100).toFixed(1)} % `
      + `· Ø ${((monat.mean - 1) * 100).toFixed(1)} %`);
    check('der Median bleibt ungefähr stehen (vorher −10 %)',
      monat.med > 0.95, monat.med.toFixed(3));
    check('und der Erwartungswert steigt spürbar, aber maßvoll',
      monat.mean > 1.01 && monat.mean < 1.10, monat.mean.toFixed(3));

    // Krypto bleibt bewusst die Wette: dort ist σ weit über dem Deckel.
    const krypto = data.ASSETS.find((a) => a.kind === 'crypto');
    const kMonat = halten(krypto.sigma, 1440, 1500);
    check('Krypto bleibt eine Wette (Median klar im Minus)',
      kMonat.med < 0.8, kMonat.med.toFixed(3));
  }

  console.log('--- Nachbeben: Hinschauen lohnt sich, aber begrenzt ---');
  {
    check('Ereignisse sind selten', market.EVENT_CHANCE < 1 / (48 * 30),
      String(1 / market.EVENT_CHANCE));
    check('sie holen nur einen Teil zurück',
      market.RECOVER_SHARE > 0 && market.RECOVER_SHARE < 1, String(market.RECOVER_SHARE));

    const rngE = mulberry32(4711);
    let hits = 0, sample = null;
    for (let i = 0; i < 200000; i++) {
      const ev = market.rollEvent(1000, 0, rngE);
      if (ev) { hits++; sample = sample ?? ev; }
    }
    check('ein Ereignis kippt den Kurs deutlich',
      Math.abs(sample.price - 1000) / 1000 >= market.EVENT_SIZE[0] - 0.001,
      JSON.stringify(sample));
    check('das Erholungsziel liegt zwischen Sturz und Ausgangskurs',
      (sample.down && sample.to > sample.price && sample.to < 1000)
      || (!sample.down && sample.to < sample.price && sample.to > 1000),
      JSON.stringify(sample));
    check('die Häufigkeit stimmt ungefähr',
      Math.abs(hits / 200000 - market.EVENT_CHANCE) < market.EVENT_CHANCE * 0.2,
      `${hits} von 200000`);
  }

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
  check('typischer Halter zahlt wenigstens die Gebühr', ends[Math.floor(ends.length / 2)] < 0,
    String(Math.round(ends[Math.floor(ends.length / 2)])));

  console.log('--- Wie viel bringt Hinschauen wirklich? ---');
  {
    /*
     * Der Grund, warum es die Nachbeben überhaupt gibt – und die Schranke, die
     * verhindert, dass daraus eine Gelddruckmaschine wird.
     *
     * Gemessen mit einem stumpfen Bot: kaufen, wenn der Kurs 10 % unter dem
     * Schnitt der letzten 200 Takte liegt, verkaufen bei 10 % darüber, und das
     * nur EINMAL AM TAG geprüft. Die erste Fassung dieser Idee (eine dauerhafte
     * Kursbindung) holte damit +105 % heraus; das war der Grund, sie wieder
     * auszubauen. Bleibt der Wert hier klein, ist Hinschauen belohnt, ohne dass
     * der Markt verschenkt wird.
     */
    const sigma = data.ASSETS.find((a) => a.kind === 'stock').sigma;
    let profit = 0, capital = 0;

    for (let seed = 1; seed <= 80; seed++) {
      const rng = mulberry32(seed * 104729 + 7);
      let cash = 0, shares = 0, p = 5000, vol = 1, exposure = 0;
      let rec = { to: 0, until: 0 };
      const hist = [p];

      for (let t = 0; t < 2000; t++) {
        vol = market.nextVol(vol, rng);
        const active = rec.until > t ? rec.to : 0;
        p = market.step(p, sigma * vol, rng,
          market.gauss(rng) * market.MARKET_SIGMA * vol, market.MARKET_SIGMA * vol, active);

        const ev = active > 0 ? null : market.rollEvent(p, t, rng);
        if (ev) { p = ev.price; rec = { to: ev.to, until: ev.until }; }
        else if (rec.until <= t) rec = { to: 0, until: 0 };
        hist.push(p);

        if (t % 48 === 0) {
          const win = hist.slice(-200);
          const avg = win.reduce((x, y) => x + y, 0) / win.length;
          if (p < avg * 0.9) { const v = 10 * p; cash -= v + market.feeFor(v); shares += 10; }
          else if (p > avg * 1.1 && shares > 0) {
            const n = Math.min(shares, 10); const v = n * p;
            cash += v - market.feeFor(v); shares -= n;
          }
        }
        exposure += shares * p;
      }
      profit += cash + shares * p;
      capital += exposure / 2000;
    }

    const rendite = capital > 0 ? profit / capital : 0;
    console.log(`    „tief kaufen, hoch verkaufen" bringt ${(100 * rendite).toFixed(0)} % `
      + 'auf das eingesetzte Kapital (rund 6 Wochen)');
    check('Hinschauen lohnt sich', rendite > 0, (100 * rendite).toFixed(1) + ' %');
    check('aber es ist keine Gelddruckmaschine (< 40 %)', rendite < 0.4,
      (100 * rendite).toFixed(1) + ' %');
  }

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
