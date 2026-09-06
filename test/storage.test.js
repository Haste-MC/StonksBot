/**
 * Tests für das Storage-Wars-Minigame.
 *
 * Schwerpunkt: das Auktionshaus ist eine **bewusste Ausnahme von §3** – hier
 * fließt Geld ins Spiel. Geprüft wird deshalb nicht, dass es keinen Zufluss
 * gibt, sondern dass er die Form hat, die das Feature braucht:
 *
 *  1. **Bieten lohnt sich.** Die typische Garage ist deutlich mehr wert als
 *     ihr Startpreis – sonst gäbe es keinen Grund, sich hochzubieten.
 *  2. **Es gibt eine Spanne**, in der Hochbieten sich noch rechnet – und ein
 *     Ende, ab dem nicht mehr (der Fluch des Gewinners).
 *  3. **Der Zufluss ist über den Durchsatz gedeckelt**, nicht über den Preis:
 *     immer nur ein Los, 20 Minuten, serverweit.
 *
 * Dazu Sequenz, Bieten (atomar), Anti-Snipe, faule Abrechnung (idempotent)
 * und die Sammlung.
 *
 * Aufruf: npm run test:storage
 */
const db = require('../src/db');
const storage = require('../src/storage');
const data = require('../src/data/storage');
const cond = require('../src/condition');
const unb = require('../src/unb');

/** Deterministischer PRNG (mulberry32) – macht die Monte-Carlo-Läufe reproduzierbar. */
function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

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
  console.log('--- Preisbildung: Startpreis unter dem Erwartungswert (analytisch) ---');
  // Analytisch statt empirisch: Bei Heavy-Tail-Verteilungen ist der gemessene
  // Mittelwert zu wackelig. Gezeigt wird, dass der Erwartungswert die
  // Seltenheits- UND Zustands-Multiplikatoren korrekt enthält – und dass der
  // Startpreis bewusst darunter liegt.
  const totR = data.RARITIES.reduce((s, r) => s + r.weight, 0);
  const handRar = data.RARITIES.reduce((s, r) => s + (r.weight / totR) * r.mult, 0);
  const totC = data.CONDITIONS.reduce((s, c) => s + c.weight, 0);
  const handCond = data.CONDITIONS.reduce((s, c) => s + (c.weight / totC) * c.mult, 0);
  check('E[Seltenheit] == Σ p·mult', Math.abs(storage.expectedRarityMultiplier() - handRar) < 1e-9);
  check('E[Zustand] == Σ p·mult', Math.abs(storage.expectedConditionMultiplier() - handCond) < 1e-9);
  check('E[Objekt] (voll) = Basis × E[Seltenheit] × E[Zustand]',
    Math.abs(storage.expectedObjectValueFull() - storage.objectMean() * handRar * handCond) < 1e-6);

  // Der Startpreis rechnet OHNE den Jackpot-Tail (ab UNPRICED_FROM): Der Preis
  // folgt dem, was üblicherweise drinliegt, nicht einer Lotterie.
  check('Preis-Erwartung liegt unter der vollen (Tail ist geschenkt)',
    storage.pricedRarityMultiplier() < storage.expectedRarityMultiplier());

  const carAvg = storage.avgCarValue(G);
  const startOk = data.TIERS.every((t) => {
    const e = storage.expectedValueFull(t, carAvg);   // VOLLER Erwartungswert
    const s = storage.startPrice(t, carAvg);
    return s < e * 0.6 && s > e * 0.25;
  });
  check('Startpreis liegt deutlich unter dem Erwartungswert – aber nicht geschenkt',
    startOk,
    data.TIERS.map((t) => `${t.id}:${(storage.startPrice(t, carAvg)
      / storage.expectedValueFull(t, carAvg)).toFixed(2)}`).join(' '));
  check('der Startanteil ist die einzige Stellschraube dafür',
    storage.START_SHARE > 0 && storage.START_SHARE < 1, String(storage.START_SHARE));

  console.log('--- Drop-Chancen: legendary 1 %, mythic 0,5 %, Tail respektlos selten ---');
  const rng = mulberry32(1234567);
  const N = 400000;
  const counts = {};
  for (let i = 0; i < N; i++) {
    const o = storage.rollObject(rng);
    counts[o.rarity] = (counts[o.rarity] || 0) + 1;
  }
  const freq = (id) => (counts[id] || 0) / N;
  console.log(`    common ${(freq('common') * 100).toFixed(1)}% · legendary ${(freq('legendary') * 100).toFixed(3)}% ` +
    `· mythic ${(freq('mythic') * 100).toFixed(3)}% · godlike ${(freq('godlike') * 100).toFixed(4)}%`);
  // Absichtlich als Aussage über die REIHENFOLGE, nicht als feste Prozentzahl:
  // Wie großzügig die Stufen sind, ist eine Balance-Entscheidung und darf sich
  // ändern – dass "common" die häufigste Stufe bleibt, nicht.
  check(`common ist die häufigste Stufe (${(freq('common') * 100).toFixed(1)} %)`,
    data.RARITIES.every((r) => r.id === 'common' || freq(r.id) < freq('common')) &&
    freq('common') > 0.4,
    String(freq('common')));
  check('legendary ≈ 1 % (±0,3)', Math.abs(freq('legendary') - 0.01) < 0.003, String(freq('legendary')));
  check('mythic ≈ 0,5 % (±0,2)', Math.abs(freq('mythic') - 0.005) < 0.002, String(freq('mythic')));
  const order = ['common', 'uncommon', 'rare', 'epic', 'legendary', 'mythic', 'godlike'];
  check('Häufigkeit fällt mit der Seltenheit',
    order.every((id, i) => i === 0 || (counts[id] || 0) <= (counts[order[i - 1]] || 0)),
    order.map((id) => `${id}:${counts[id] || 0}`).join(' '));
  check('alle Stufen ab Godlike jeweils < 0,1 %',
    ['godlike', 'cosmic', 'primordial', 'celestial', 'eternal', 'ascended', 'transcendent', 'omnipotent', 'origin']
      .every((id) => freq(id) < 0.001));

  console.log('--- Balance: Bieten muss sich lohnen ---');
  /*
   * Regressionsschutz. Vorher lag der Median bei 0,70 × Startpreis: Wer mitbot,
   * verlor im Schnitt ein Drittel – und wer sich hochbieten ließ, verlor
   * sicher. Damit war das Bietgefecht, also der Sinn des Features, tot.
   */
  const rngMed = mulberry32(987654);
  const ratios = [];
  for (let i = 0; i < 20000; i++) {
    const r = storage.rollLot(G, rngMed);
    ratios.push(r.value / r.startPrice);
  }
  ratios.sort((a, b) => a - b);
  const quant = (p) => ratios[Math.floor(p * (ratios.length - 1))];
  const winRate = ratios.filter((r) => r >= 1).length / ratios.length;
  console.log(`    Median ${quant(0.5).toFixed(2)} · p25 ${quant(0.25).toFixed(2)} · ` +
    `p90 ${quant(0.9).toFixed(2)} · Gewinnquote ${(100 * winRate).toFixed(1)} %`);
  check('die Median-Garage ist mindestens das 1,4-Fache ihres Startpreises wert',
    quant(0.5) >= 1.4, quant(0.5).toFixed(3));
  check('auch das untere Viertel trägt sich', quant(0.25) >= 1.0, quant(0.25).toFixed(3));
  check('vier von fünf Garagen lohnen sich zum Startpreis',
    winRate >= 0.8, (100 * winRate).toFixed(1));
  // Ohne Nieten wäre es kein Storage Wars, sondern ein Automat.
  check('aber es gibt weiterhin Nieten', quant(0.05) < 1, quant(0.05).toFixed(3));

  /*
   * Die Spanne, um die es geht: Wie weit darf man über den Startpreis gehen,
   * bevor sich die typische Garage nicht mehr rechnet? Darunter ist Bieten
   * richtig, darüber der Fluch des Gewinners.
   */
  const breakEven = quant(0.5);
  console.log(`    Bietspanne: bis ${((breakEven - 1) * 100).toFixed(0)} % über dem `
    + 'Startpreis rechnet sich die Median-Garage noch');
  check('die Spanne ist groß genug für ein Gefecht (≥ +40 %)',
    breakEven >= 1.4, breakEven.toFixed(2));
  check('und endet irgendwo (kein Freibrief)', quant(0.5) < 4, quant(0.5).toFixed(2));

  console.log('--- Kein Objekt trägt den halben Preis ---');
  /*
   * Gemessen wird der Anteil am **eingepreisten** Mittel: Nur der bestimmt den
   * Startpreis. Jackpot-Stücke sind daraus per Bauart heraus (siehe
   * data/storage.js) – sie dürfen deshalb so wertvoll sein, wie sie wollen.
   */
  const totW = data.OBJECTS.reduce((a, o) => a + (o.weight ?? 1), 0);
  const priced = data.OBJECTS.filter((o) => !o.jackpot);
  const shares = priced.map((o) =>
    ((o.weight ?? 1) / totW) * ((o.range[0] + o.range[1]) / 2) / storage.pricedObjectMean());
  check('kein eingepreistes Fundstück macht mehr als 20 % des Preises aus',
    Math.max(...shares) <= 0.20,
    priced[shares.indexOf(Math.max(...shares))].name + ' ' + (100 * Math.max(...shares)).toFixed(1) + ' %');
  check('und die Jackpots stehen komplett außerhalb des Preises',
    data.OBJECTS.some((o) => o.jackpot) && storage.unpricedObjectShare() > 0,
    (100 * storage.unpricedObjectShare()).toFixed(0) + ' %');

  console.log('--- Jackpot-Stücke sind findbar, aber nicht eingepreist ---');
  {
    const jackpots = data.OBJECTS.filter((o) => o.jackpot);
    check('es gibt welche', jackpots.length > 0, String(jackpots.length));
    check('sie sind die teuersten im Katalog',
      Math.min(...jackpots.map((o) => o.range[0]))
      > Math.max(...data.OBJECTS.filter((o) => !o.jackpot).map((o) => o.range[1])) / 2);
    check('sie drücken den Preis nicht in jede Garage',
      storage.pricedObjectMean() < storage.objectMean(),
      `${storage.pricedObjectMean().toFixed(0)} vs ${storage.objectMean().toFixed(0)}`);
    console.log(`    ${(100 * storage.unpricedObjectShare()).toFixed(0)} % des Objektwerts `
      + 'sind geschenkter Ausreißer statt Dauerabgabe.');

    // Findbar müssen sie trotzdem sein – sonst wäre es nur eine schöne Liste.
    const rngJ = mulberry32(31337);
    const seen = new Set();
    for (let i = 0; i < 200000; i++) seen.add(storage.rollObject(rngJ).name);
    check('trotzdem taucht jedes Stück irgendwann auf',
      data.OBJECTS.every((o) => seen.has(o.name)),
      data.OBJECTS.filter((o) => !seen.has(o.name)).map((o) => o.name).join());
  }

  console.log('--- In jeder Garage liegt Bargeld ---');
  const rngCash = mulberry32(13579);
  let withoutCash = 0;
  for (let i = 0; i < 3000; i++) if (!storage.rollLot(G, rngCash).contents.cash) withoutCash++;
  check('Bargeld-Sockel ist garantiert', withoutCash === 0, String(withoutCash));
  check('jede Stufe hat eine eigene Bargeldspanne',
    data.TIERS.every((t) => Array.isArray(t.cash) && t.cash[0] > 0));

  console.log('--- Wert- & Zustands-Multiplikatoren ---');
  check('beschädigt = 0,5×', data.conditionOf('beschaedigt').mult === 0.5);
  check('Sammlerzustand = 3×', data.conditionOf('sammlerzustand').mult === 3.0);
  check('Seltenheits-Multiplikator steigt streng',
    data.RARITIES.every((r, i) => i === 0 || r.mult > data.RARITIES[i - 1].mult));
  check('15 Seltenheitsstufen', data.RARITIES.length === 15, String(data.RARITIES.length));

  console.log('--- Zufluss empirisch (seeded) + Jackpots/Nieten ---');
  const rng2 = mulberry32(424242);
  let sumV = 0, sumS = 0, jackpots = 0, busts = 0;
  const M = 20000;
  for (let i = 0; i < M; i++) {
    const r = storage.rollLot(G, rng2);
    sumV += r.value; sumS += r.startPrice;
    if (r.value > r.startPrice) jackpots++;
    if (r.value < 0.5 * r.startPrice) busts++;
  }
  const meanV = sumV / M, meanS = sumS / M;
  console.log(`    Ø Inhalt ${Math.round(meanV)} · Ø Startpreis ${Math.round(meanS)} ` +
    `· RTP ${(meanV / meanS * 100).toFixed(1)} % · Jackpots ${jackpots} · Nieten ${busts}`);
  check('Ø Inhalt liegt deutlich über dem Startpreis (bewusster Zufluss)',
    meanV >= 1.8 * meanS, `${Math.round(meanV)} vs ${Math.round(meanS)}`);
  check('Jackpots kommen vor', jackpots > 0);
  check('Nieten kommen vor', busts > 0);

  /*
   * Gedeckelt wird der Zufluss über den DURCHSATZ, nicht über den Preis: Es
   * ist immer nur ein Los live. Mehr als das kann serverweit nicht ins Spiel
   * fließen – und das auch nur, wenn niemand mitbietet.
   */
  const perHour = (meanV - meanS) * (60 * 60 * 1000 / storage.LOT_DURATION_MS);
  console.log(`    Höchstzufluss ${Math.round(perHour).toLocaleString('de-DE')} pro Stunde `
    + 'für den ganzen Server (ohne Gegengebote)');
  /*
   * Die Obergrenze ist eine bewusste Balance-Entscheidung, keine Naturkonstante:
   * Sie wächst mit, wenn im Katalog wertvolle Stücke häufiger werden. Wer sie
   * anhebt, sollte wissen, was er tut – deshalb steht sie hier und nicht im
   * Code.
   */
  check('der Zufluss bleibt in der abgesprochenen Größenordnung',
    perHour <= 60000, Math.round(perHour).toString());
  check('nur ein Los gleichzeitig – der Deckel hängt an der Zeit',
    storage.LOT_DURATION_MS >= 10 * 60 * 1000, String(storage.LOT_DURATION_MS));

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
  console.log('--- Die Schätzung des Auktionators ---');
  {
    const rngE = mulberry32(2468);
    let inBand = 0;
    const N2 = 5000;
    for (let i = 0; i < N2; i++) {
      const l = storage.rollLot(G, rngE);
      const band = storage.appraisal({ estimate: l.estimate });
      if (l.value >= band.low && l.value <= band.high) inBand++;
    }
    const hit = inBand / N2;
    console.log(`    Der echte Wert liegt in ${(hit * 100).toFixed(0)} % der Fälle in der Spanne.`);
    check('die Schätzung hilft (trifft meistens)', hit > 0.6, hit.toFixed(2));
    check('aber sie ist nicht sicher (man kann sich vergreifen)', hit < 0.95, hit.toFixed(2));
    check('sie steht auf keinem Fall bei null',
      storage.rollLot(G, rngE).estimate > 0);
    check('die Spanne liegt um die Schätzung herum', (() => {
      const b = storage.appraisal({ estimate: 1000 });
      return b.low === 800 && b.high === 1200;
    })());
    check('ohne Schätzung keine Spanne', storage.appraisal({ estimate: 0 }) === null);

    // Sie darf sich nicht bei jedem Aufruf neu würfeln – sonst könnte man sie
    // durch Neuladen so lange ziehen, bis sie gefällt.
    cleanup();
    const bE = 8_100_000_000_000;
    const { lot: lotE } = makeLot({
      base: bE, startPrice: 1000, contents: { objects: [], cash: 5000, car: null },
      value: 5000, opensAt: bE, endsAt: bE + L, roundEnds: bE + 5 * L,
    });
    const first = db.getLot(G, lotE.id).estimate;
    check('die Schätzung liegt fest', db.getLot(G, lotE.id).estimate === first);
  }

  console.log('--- Übergang: alte Lose werden neu aufgerufen ---');
  {
    cleanup();
    const bR = 8_300_000_000_000;
    const round = db.insertRound(G, bR, bR + 4 * L, 2);
    // So sah ein Los vor dem Rebalancing aus: teurer Aufruf, keine Schätzung.
    const alt = db.insertLot({
      guildId: G, roundId: round.id, seq: 1, tier: 'klein', seller: 'A', hint: '', peek: '',
      startPrice: 99999, contents: { objects: [], cash: 4000, car: null }, value: 4000,
      estimate: 0, opensAt: bR + 2 * L, endsAt: bR + 3 * L,
    });
    const laufend = db.insertLot({
      guildId: G, roundId: round.id, seq: 0, tier: 'klein', seller: 'B', hint: '', peek: '',
      startPrice: 99999, contents: { objects: [], cash: 4000, car: null }, value: 4000,
      estimate: 0, opensAt: bR, endsAt: bR + L,
    });

    const fixed = storage.reprice(G, bR);
    check('das noch verschlossene Los wird neu aufgerufen', fixed === 1, String(fixed));
    check('und zwar günstiger', db.getLot(G, alt.id).start_price < 99999,
      String(db.getLot(G, alt.id).start_price));
    check('mit Schätzung', db.getLot(G, alt.id).estimate > 0);
    check('das laufende Los bleibt, wie es war',
      db.getLot(G, laufend.id).start_price === 99999,
      String(db.getLot(G, laufend.id).start_price));

    // Wer schon geboten hat, verlässt sich auf seinen Preis.
    balanceOf(U).cash = 1_000_000; balanceOf(U).total = 1_000_000;
    await storage.placeBid(G, U, laufend.id, 99999, bR + 1);
    check('ein Los mit Gebot wird nie umgepreist',
      storage.reprice(G, bR) === 0 && db.getLot(G, laufend.id).start_price === 99999);
  }

  console.log('--- Anti-Snipe: das letzte Gebot beendet nicht die Auktion ---');
  {
    cleanup();
    const LL = 100 * 1000;                 // langes Los -> Fenster = 10 s
    const bS = 8_200_000_000_000;
    const round = db.insertRound(G, bS, bS + 2 * LL, 2);
    const lot1 = db.insertLot({
      guildId: G, roundId: round.id, seq: 0, tier: 'klein', seller: 'A',
      hint: '', peek: '', startPrice: 1000, contents: { objects: [], cash: 1, car: null },
      value: 1, estimate: 1, opensAt: bS, endsAt: bS + LL,
    });
    const lot2 = db.insertLot({
      guildId: G, roundId: round.id, seq: 1, tier: 'klein', seller: 'B',
      hint: '', peek: '', startPrice: 1000, contents: { objects: [], cash: 1, car: null },
      value: 1, estimate: 1, opensAt: bS + LL, endsAt: bS + 2 * LL,
    });

    const fenster = storage.snipeWindow(db.getLot(G, lot1.id));
    check('das Fenster hängt an der Laufzeit', fenster === Math.round(LL * 0.1), String(fenster));

    balanceOf(U).cash = 1_000_000; balanceOf(U).total = 1_000_000;
    balanceOf(U2).cash = 1_000_000; balanceOf(U2).total = 1_000_000;

    const frueh = await storage.placeBid(G, U, lot1.id, 1000, bS + LL / 2);
    check('ein frühes Gebot verlängert nichts', frueh.ok && frueh.extended === 0,
      String(frueh.extended));
    check('das Ende steht noch', db.getLot(G, lot1.id).ends_at === bS + LL);

    const spaet = await storage.placeBid(G, U2, lot1.id, 5000, bS + LL - 2000);
    check('ein Gebot in der Schlussphase verlängert', spaet.extended === fenster,
      String(spaet.extended));
    check('das Los läuft länger', db.getLot(G, lot1.id).ends_at === bS + LL + fenster);
    check('das nächste Los rückt mit',
      db.getLot(G, lot2.id).opens_at === bS + LL + fenster
      && db.getLot(G, lot2.id).ends_at === bS + 2 * LL + fenster,
      JSON.stringify([db.getLot(G, lot2.id).opens_at - bS, db.getLot(G, lot2.id).ends_at - bS]));
    check('und die Runde endet später',
      db.activeRound(G, bS + LL)?.ends_at === bS + 2 * LL + fenster);

    // Nicht endlos: Nach genug Verlängerungen ist Schluss.
    let at = bS + LL + fenster;
    let bid = 5000;
    for (let i = 0; i < storage.SNIPE_MAX_ROUNDS + 3; i++) {
      const lotNow = db.getLot(G, lot1.id);
      bid = storage.minBid(lotNow);
      await storage.placeBid(G, i % 2 ? U : U2, lot1.id, bid, lotNow.ends_at - 1);
      at = db.getLot(G, lot1.id).ends_at;
    }
    const finalLot = db.getLot(G, lot1.id);
    check('die Verlängerung ist gedeckelt',
      finalLot.extended === storage.maxExtend(finalLot),
      `${finalLot.extended} vs ${storage.maxExtend(finalLot)}`);
    check('danach beendet ein Gebot die Auktion nicht mehr endlos',
      (await storage.placeBid(G, U, lot1.id, storage.minBid(finalLot), finalLot.ends_at - 1))
        .extended === 0);
  }

  console.log(`\n${pass} bestanden, ${fail} fehlgeschlagen`);
  process.exit(fail === 0 ? 0 : 1);
})();
