/**
 * Tests für das Storage-Wars-Minigame.
 *
 * Schwerpunkt: KEIN GELDDRUCKER (Monte-Carlo) – der Erwartungswert des Inhalts
 * liegt unter dem Startpreis. Dazu Sequenz, Bieten (atomar), faule Abrechnung
 * (idempotent) und die Sammlung.
 *
 * Aufruf: npm run test:storage
 */
const db = require('../src/db');
const storage = require('../src/storage');
const cond = require('../src/condition');
const unb = require('../src/unb');

const G = 'TESTGUILD_STORAGE';
const U = 'SWUSER';
const U2 = 'SWUSER2';
let pass = 0, fail = 0;

const check = (label, ok, extra = '') => {
  if (ok) { pass++; console.log(`  ✅ ${label}`); }
  else { fail++; console.log(`  ❌ ${label} ${extra}`); }
};

const wallet = {};
const balanceOf = (u) => (wallet[u] ??= { cash: 1000000, bank: 0, total: 1000000 });
unb.getBalance = async (g, u) => ({ ...balanceOf(u) });
unb.changeCash = async (g, u, a) => {
  const b = balanceOf(u); b.cash += a; b.total = b.cash + b.bank; return { ...b };
};
unb.withdrawFromBank = async (g, u, a) => {
  const b = balanceOf(u); b.cash += a; b.bank -= a; b.total = b.cash + b.bank; return { ...b };
};

const cleanup = () => {
  db.clearStorage(G);
  for (const k of ['car', 'gear', 'property']) {
    for (const i of db.allItemsOfKind(G, k)) db.deleteItem(G, i.id);
  }
};

cleanup();

// Ein paar günstige Autos, damit auch Auto-Jackpots vorkommen können.
db.createItem({ guildId: G, name: 'SW-Testflitzer', price: 8000, kind: 'car', stock: null, createdBy: 't' });
db.createItem({ guildId: G, name: 'SW-Testkombi', price: 25000, kind: 'car', stock: null, createdBy: 't' });

const L = 1000; // kurze Los-Dauer für die Tests

/** Legt eine Runde + ein Los mit bekanntem Inhalt an (deterministisch). */
function makeLot({ base, startPrice = 1000, contents, value, opensAt, endsAt, seq = 0, roundEnds }) {
  const round = db.insertRound(G, base, roundEnds ?? base + 1000 * L, 1);
  const lot = db.insertLot({
    guildId: G, roundId: round.id, seq, tier: 'klein', seller: 'Auktionator',
    hint: '', peek: '', startPrice, contents, value,
    opensAt: opensAt ?? base, endsAt: endsAt ?? base + L,
  });
  return { round, lot };
}

(async () => {
  console.log('--- KEIN GELDDRUCKER: E[Inhalt] ≤ Startpreis (Monte-Carlo) ---');
  const N = 20000;
  let sumV = 0, sumS = 0, jackpots = 0, busts = 0;
  for (let i = 0; i < N; i++) {
    const r = storage.rollLot(G);
    sumV += r.value; sumS += r.startPrice;
    if (r.value > r.startPrice) jackpots++;
    if (r.value < 0.5 * r.startPrice) busts++;
  }
  const meanV = sumV / N, meanS = sumS / N;
  console.log(`    Ø Inhalt ${Math.round(meanV)} · Ø Startpreis ${Math.round(meanS)} ` +
    `· RTP ${(meanV / meanS * 100).toFixed(1)} % · Jackpots ${jackpots} · Nieten ${busts}`);
  check('Ø Inhalt ≤ Ø Startpreis (kein Faucet)', meanV <= meanS, `${meanV} vs ${meanS}`);
  check('aber nicht zu geizig (Ø Inhalt ≥ 70 % Startpreis)', meanV >= 0.7 * meanS);
  check('Jackpots kommen vor (Inhalt > Preis)', jackpots > 0);
  check('Nieten kommen vor (Inhalt < halber Preis)', busts > 0);

  console.log('--- Erwartungswert passt zum empirischen Mittel ---');
  const data = require('../src/data/storage');
  const carAvg = storage.avgCarValue(G);
  const kleinTier = data.TIERS.find((t) => t.id === 'klein');
  let sK = 0, nK = 0;
  for (let i = 0; i < 30000; i++) {
    const r = storage.rollLot(G);
    if (r.tier === 'klein') { sK += r.value; nK++; }
  }
  const empirical = sK / nK, analytic = storage.expectedValue(kleinTier, carAvg);
  check('E[V|klein] ≈ empirisch (±8 %)',
    Math.abs(empirical - analytic) / analytic < 0.08, `${Math.round(empirical)} vs ${Math.round(analytic)}`);

  console.log('--- ensureRound: 4–7 Garagen, gestaffelt ---');
  cleanup();
  const base = 5_000_000_000_000; // fixer Zeitpunkt weit in der Zukunft
  const created = storage.ensureRound(G, base, Math.random, { lotDuration: L, roundGap: 0 });
  check('Runde angelegt', created && created.lots.length >= 4 && created.lots.length <= 7,
    String(created?.lots.length));
  const lots = db.listRoundLots(G, created.round.id);
  check('Lose in Sequenz 0..n-1', lots.every((l, i) => l.seq === i));

  console.log('--- Immer nur EINE Garage live ---');
  for (let seq = 0; seq < lots.length; seq++) {
    const t = base + seq * L + L / 2; // Mitte des seq-ten Fensters
    const live = lots.filter((l) => storage.isLive(l, t));
    check(`bei Fenster ${seq}: genau eine live`, live.length === 1 && live[0].seq === seq,
      live.map((l) => l.seq).join());
  }

  console.log('--- ensureRound ist idempotent (keine zweite Runde) ---');
  const again = storage.ensureRound(G, base + L / 2, Math.random, { lotDuration: L, roundGap: 0 });
  check('während laufender Runde keine neue', again === null);

  console.log('--- Bieten ---');
  cleanup();
  const at = base + L / 2; // Los 0 ist live
  const { lot } = makeLot({
    base, startPrice: 1000,
    contents: { objects: [{ name: 'Vase', value: 2000 }], cash: 500, car: null }, value: 2500,
  });

  const tooLow = await storage.placeBid(G, U, lot.id, 999, at);
  check('unter Startpreis abgelehnt', !tooLow.ok && tooLow.reason === 'too_low', tooLow.reason);

  const bid1 = await storage.placeBid(G, U, lot.id, 1000, at);
  check('Startgebot angenommen', bid1.ok && bid1.bid === 1000, JSON.stringify(bid1).slice(0, 80));
  check('Höchstbietender gesetzt', db.getLot(G, lot.id).top_bidder === U);

  const belowMin = await storage.placeBid(G, U2, lot.id, 1050, at);
  check('unter Mindest-Erhöhung abgelehnt', !belowMin.ok && belowMin.reason === 'too_low',
    JSON.stringify(belowMin).slice(0, 80));

  const min2 = storage.minBid(db.getLot(G, lot.id));
  const bid2 = await storage.placeBid(G, U2, lot.id, min2, at);
  check('gültiges Übergebot angenommen', bid2.ok, JSON.stringify(bid2).slice(0, 80));
  check('Vorbieter U wurde überboten-benachrichtigt',
    db.listMessages(G, U, 1).items.some((m) => m.title.includes('Überboten')));

  console.log('--- Bieten nur auf das LIVE-Los ---');
  const future = await storage.placeBid(G, U, lot.id, 5000, base - L); // vor opens_at
  check('vor Öffnung abgelehnt', !future.ok && future.reason === 'not_live', future.reason);

  console.log('--- Atomarität: niedrigeres Gebot greift nicht (Race) ---');
  const cur = db.getLot(G, lot.id).top_bid;
  const lowerWins = db.placeBid(G, lot.id, cur - 1, 'HACKER', at);
  check('DB weist niedrigeres Gebot ab', lowerWins === false);
  check('Top-Gebot unverändert', db.getLot(G, lot.id).top_bid === cur);

  console.log('--- zu wenig Geld ---');
  balanceOf('PLEITE').cash = 10; balanceOf('PLEITE').total = 10;
  const broke = await storage.placeBid(G, 'PLEITE', lot.id, storage.minBid(db.getLot(G, lot.id)), at);
  check('Gebot ohne Deckung abgelehnt', !broke.ok && broke.reason === 'insufficient_funds', broke.reason);

  console.log('--- Abrechnung: Zuschlag → verschlossene Garage (kein Reveal) ---');
  cleanup();
  balanceOf(U).cash = 1000000; balanceOf(U).bank = 0; balanceOf(U).total = 1000000;
  db.clearLoot(G, U);
  const b2 = 7_000_000_000_000;
  const { lot: lot2 } = makeLot({
    base: b2, startPrice: 1000,
    contents: { objects: [{ name: 'Vase', value: 2000 }, { name: 'Uhr', value: 800 }], cash: 500, car: null },
    value: 3300, opensAt: b2, endsAt: b2 + L, roundEnds: b2 + 5 * L,
  });
  await storage.placeBid(G, U, lot2.id, 1200, b2 + L / 2);
  const cashBefore = balanceOf(U).total;

  const res = await storage.settle(G, U, b2 + 2 * L, { lotDuration: L, roundGap: 1e15 });
  check('Zuschlag an U gemeldet', res.length === 1 && res[0].winner === U, JSON.stringify(res).slice(0, 80));
  check('Los als verkauft markiert', db.getLot(G, lot2.id).status === 'sold');
  check('nur das Gebot abgebucht (noch kein Fund)',
    balanceOf(U).total === cashBefore - 1200, String(balanceOf(U).total - cashBefore));
  check('Garage liegt verschlossen im Inventar', db.countGarages(G, U) === 1, String(db.countGarages(G, U)));
  check('noch nichts in der Sammlung', db.listLoot(G, U).length === 0);
  check('Postfach: Garage ist verschlossen',
    db.listMessages(G, U, 1).items.some((m) => m.body.includes('verschlossen')));

  console.log('--- Abrechnung ist idempotent ---');
  const balAfter = balanceOf(U).total;
  await storage.settle(G, U, b2 + 3 * L, { lotDuration: L, roundGap: 1e15 });
  check('zweite Abrechnung bucht nichts', balanceOf(U).total === balAfter);
  check('keine zweite Garage', db.countGarages(G, U) === 1);

  console.log('--- Garage aktiv öffnen deckt auf ---');
  const garage = db.listGarages(G, U)[0];
  const beforeOpen = balanceOf(U).total;
  const opened = await storage.openGarage(G, U, garage.id);
  check('öffnen ok, Netto = 3300 − 1200', opened.ok && opened.net === 2100, JSON.stringify(opened).slice(0, 80));
  check('Bargeldfund gutgeschrieben (+500)', balanceOf(U).total === beforeOpen + 500,
    String(balanceOf(U).total - beforeOpen));
  check('zwei Fundstücke in der Sammlung', db.listLoot(G, U).length === 2, String(db.listLoot(G, U).length));
  check('Sammlungswert = 2800', db.lootSummary(G, U).value === 2800, String(db.lootSummary(G, U).value));
  check('Garage nach dem Öffnen weg', db.countGarages(G, U) === 0);
  const reopen = await storage.openGarage(G, U, garage.id);
  check('zweites Öffnen findet nichts', !reopen.ok && reopen.reason === 'not_found');

  console.log('--- kein Bieter → unsold; zahlungsunfähig → void ---');
  cleanup();
  const b3 = 8_000_000_000_000;
  const { lot: lot3 } = makeLot({
    base: b3, startPrice: 1000, contents: { objects: [{ name: 'x', value: 100 }], cash: 0, car: null },
    value: 100, opensAt: b3, endsAt: b3 + L, roundEnds: b3 + 5 * L,
  });
  await storage.settle(G, null, b3 + 2 * L, { lotDuration: L, roundGap: 1e15 });
  check('Los ohne Gebot ist unsold', db.getLot(G, lot3.id).status === 'unsold');

  const b4 = 8_100_000_000_000;
  const { lot: lot4 } = makeLot({
    base: b4, startPrice: 1000, contents: { objects: [{ name: 'y', value: 100 }], cash: 0, car: null },
    value: 100, opensAt: b4, endsAt: b4 + L, roundEnds: b4 + 5 * L,
  });
  balanceOf('ARM').cash = 500000; balanceOf('ARM').bank = 0; balanceOf('ARM').total = 500000;
  await storage.placeBid(G, 'ARM', lot4.id, 5000, b4 + L / 2);
  balanceOf('ARM').cash = 10; balanceOf('ARM').bank = 0; balanceOf('ARM').total = 10; // pleite bis zur Abrechnung
  await storage.settle(G, null, b4 + 2 * L, { lotDuration: L, roundGap: 1e15 });
  check('geplatzter Zuschlag → void', db.getLot(G, lot4.id).status === 'void');
  check('Postfach meldet geplatzten Zuschlag',
    db.listMessages(G, 'ARM', 1).items.some((m) => m.title.includes('geplatzt')));

  console.log('--- Auto-Fund: echtes Auto oder Bargeld ---');
  cleanup();
  const car = db.createItem({ guildId: G, name: 'SW-Fundauto', price: 8000, kind: 'car', stock: null, createdBy: 't' });
  const carVal = cond.currentValue(8000, storage.FOUND_CAR_CONDITION);
  const reward = await storage.applyCarReward(G, 'CARWIN', { itemId: car.id, name: 'SW-Fundauto', condition: storage.FOUND_CAR_CONDITION, value: carVal });
  check('Auto landet in der Garage (Platz frei)', reward.granted === true && db.getOwned(G, 'CARWIN', car.id) !== null);
  const reward2 = await storage.applyCarReward(G, 'CARWIN', { itemId: car.id, name: 'SW-Fundauto', condition: storage.FOUND_CAR_CONDITION, value: carVal });
  check('schon besessen → als Bargeld', reward2.cashedOut === true);

  console.log('--- Hehler: Sammlung verkaufen ---');
  db.clearLoot(G, U);
  balanceOf(U).cash = 1000000; balanceOf(U).bank = 0; balanceOf(U).total = 1000000;
  db.addLoot(G, U, 'Vase', 2000);
  db.addLoot(G, U, 'Uhr', 800);
  const before = balanceOf(U).total;
  const sale = await storage.sellLoot(G, U);
  check('alles verkauft bringt 2800', sale.ok && sale.total === 2800, JSON.stringify(sale).slice(0, 60));
  check('Bargeld gutgeschrieben', balanceOf(U).total === before + 2800);
  check('Sammlung danach leer', db.listLoot(G, U).length === 0);
  const empty = await storage.sellLoot(G, U);
  check('zweiter Verkauf findet nichts', !empty.ok && empty.reason === 'empty');

  console.log('--- Runde erneuern nach Ende + Pause ---');
  cleanup();
  const b5 = 9_000_000_000_000;
  const r1 = storage.ensureRound(G, b5, Math.random, { lotDuration: L, roundGap: 10 * L });
  check('erste Runde entsteht', r1 !== null);
  const roundEnd = b5 + r1.lots.length * L;
  const inGap = storage.ensureRound(G, roundEnd + 1, Math.random, { lotDuration: L, roundGap: 10 * L });
  check('in der Pause keine neue Runde', inGap === null);
  const r2 = storage.ensureRound(G, roundEnd + 10 * L + 1, Math.random, { lotDuration: L, roundGap: 10 * L });
  check('nach der Pause neue Runde', r2 !== null && r2.round.id !== r1.round.id);

  cleanup();
  db.clearLoot(G, U); db.clearLoot(G, U2);
  console.log(`\n${pass} bestanden, ${fail} fehlgeschlagen`);
  process.exit(fail === 0 ? 0 : 1);
})();
