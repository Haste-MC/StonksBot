const db = require('./db');
const data = require('./data/wallstreet');
// Spät gebunden, damit Tests die Geldschnittstelle ersetzen können (§8).
const unb = require('./unb');

const getBalance = (...a) => unb.getBalance(...a);
const changeCash = (...a) => unb.changeCash(...a);
const withdrawFromBank = (...a) => unb.withdrawFromBank(...a);

/**
 * ===========================================================================
 *  WALLSTREET – eine simulierte Wirtschaft
 * ===========================================================================
 *
 * Aktien, Fonds-Anteile und Krypto mit Kursen, die sich stündlich bewegen.
 * Gekauft und verkauft wird mit demselben Geld wie alles andere.
 *
 * ===================== KEIN GELDDRUCKER (§3) =====================
 * Der Kurs ist ein **Martingal**: Der Erwartungswert des nächsten Kurses ist
 * exakt der aktuelle. Formal wird der Ertrag als exp(σ·z − σ²/2) gewürfelt;
 * für normalverteiltes z gilt E[exp(σ·z)] = exp(σ²/2), der Abzug hebt das
 * also genau auf.
 *
 * Folge: **Kein Handelsmuster hat einen Vorteil.** Kaufen, halten, Dips
 * kaufen, Trends reiten – alles hat den Erwartungswert null. Darauf kommt die
 * Gebühr (beide Seiten), und damit ist die Börse unterm Strich eine
 * Geldsenke. Kein Zins, keine Dividende, kein Bonus: All das wäre Geld aus
 * dem Nichts.
 *
 * Bewiesen in test/wallstreet.test.js – analytisch UND per Monte-Carlo über
 * mehrere Handelsstrategien.
 * =================================================================
 *
 * ===================== FAULE SIMULATION (§4) =====================
 * Es gibt keinen Scheduler. Jeder Wert merkt sich, bis zu welchem **Tick** er
 * simuliert wurde; beim nächsten Kontakt werden die vergangenen Stunden
 * nachgeholt. Zehnmal die Börse öffnen bewegt keinen Kurs – nur Zeit tut das.
 * =================================================================
 */

/** Ein Kurs-Tick ist eine halbe Stunde. */
const TICK_MS = 30 * 60 * 1000;

/** Nach so vielen Ticks wird nicht weiter nachgeholt (Rechenzeit, 14 Tage). */
const MAX_CATCHUP = 48 * 14;

/**
 * Gemeinsamer Marktfaktor: Aktien bewegen sich nicht unabhängig voneinander.
 * Pro Tick gibt es einen Ruck für den ganzen Markt, auf den jeder Wert mit
 * seinem eigenen Rauschen obendrauf reagiert. Erst dadurch gibt es „rote
 * Tage", an denen fast alles fällt – und der Index wird zu einer echten
 * Aussage über die Lage.
 *
 * Krypto hat seinen eigenen Ruck: Coins hängen aneinander, aber nicht am
 * Aktienmarkt.
 */
const MARKET_SIGMA = 0.004;
const CRYPTO_SIGMA = 0.012;

/**
 * Nervosität des Marktes. Sie wandert träge um 1 herum (Mean Reversion) und
 * skaliert ALLE Schwankungen – so entstehen ruhige Phasen und hektische.
 *
 * Wichtig: Die Nervosität ändert nur die **Streuung**, nie die Richtung. Der
 * Erwartungswert bleibt in jeder Phase der aktuelle Kurs.
 */
const VOL_PULL = 0.02;       // wie stark es zur Normallage zurückzieht
const VOL_NOISE = 0.05;      // wie stark die Nervosität selbst schwankt
const VOL_RANGE = [0.45, 2.6];

/** Gebühr je Seite. Die einzige Stelle, an der der Börse Geld zufließt. */
const FEE = 0.01;

/** Mindestgebühr, damit Kleinstaufträge nicht gebührenfrei sind. */
const MIN_FEE = 1;

/** Unter diesem Kurs ist ein Wert insolvent und wird ausgebucht. */
const BANKRUPT_BELOW = 5;

/** So viele Ticks Verlauf werden aufgehoben (7 Tage). */
const HISTORY_TICKS = 24 * 7;

/** Ab dieser Bewegung je Tick gibt es eine Schlagzeile. */
const NEWS_THRESHOLD = 0.03;

/** Höchstens so viele Stücke auf einmal – gegen Zahlenunfälle. */
const MAX_SHARES = 1_000_000;

// ---------------------------------------------------------------- Zufall

/**
 * Standardnormalverteilte Zahl (Box-Muller).
 * `random` ist injizierbar, damit Tests reproduzierbar sind.
 */
function gauss(random = Math.random) {
  let u = 0;
  while (u === 0) u = random();       // log(0) vermeiden
  const v = random();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}

/**
 * Ein Kursschritt aus gemeinsamem Marktruck und eigenem Rauschen.
 *
 * `shock` ist der bereits gewürfelte Ruck des Gesamtmarktes (log-Rendite),
 * `shockSigma` dessen Streuung – beides fließt in die Martingal-Korrektur ein.
 * Der Abzug σ²/2 über BEIDE Anteile sorgt dafür, dass gilt:
 *
 *     E[nextPrice] === price
 *
 * Ohne diesen Abzug hätte jeder Wert eine eingebaute Aufwärtsdrift – ein
 * Gelddrucker, der mit der Schwankung wächst (ARCHITEKTUR §3).
 */
function step(price, sigma, random = Math.random, shock = 0, shockSigma = 0) {
  if (!sigma && !shock) return price;
  const variance = sigma * sigma + shockSigma * shockSigma;
  const factor = Math.exp(sigma * gauss(random) + shock - variance / 2);
  return Math.max(1, Math.round(price * factor));
}

/** Nächste Nervosität: zieht zur 1 zurück, wackelt aber selbst. */
function nextVol(vol, random = Math.random) {
  const next = vol + (1 - vol) * VOL_PULL + gauss(random) * VOL_NOISE;
  return Math.min(VOL_RANGE[1], Math.max(VOL_RANGE[0], next));
}

// ------------------------------------------------------------------ Zeit

/** Der aktuelle Tick (Stunden seit Epoch). */
const tickOf = (now = Date.now()) => Math.floor(now / TICK_MS);

// ------------------------------------------------------------- Notierung

/** Alle Werte, die zu einem Korb gehören (für Fonds). */
function basketOf(asset) {
  if (Array.isArray(asset.basket)) {
    return data.ASSETS.filter((a) => asset.basket.includes(a.symbol));
  }
  return data.ASSETS.filter((a) => a.kind === asset.basket);
}

/**
 * Der Kurs eines Fonds ist der **Mittelwert seines Korbs** – kein eigener
 * Zufall. Dadurch ist er automatisch ebenfalls ein Martingal (Mittelwert von
 * Martingalen), schwankt aber weniger, weil sich Einzelbewegungen wegmitteln.
 * Genau das macht Diversifikation aus, und hier ist sie nicht simuliert,
 * sondern echt.
 */
function fundPrice(guildId, asset) {
  const parts = basketOf(asset);
  if (!parts.length) return 1;
  const sum = parts.reduce((s, a) => s + (db.getPrice(guildId, a.symbol)?.price ?? a.start), 0);
  return Math.max(1, Math.round((sum / parts.length) * (asset.scale ?? 1)));
}

/** Derselbe Mittelwert, aber aus laufenden Kursen (während der Simulation). */
function basketMean(asset, prices) {
  const parts = basketOf(asset);
  if (!parts.length) return 1;
  const sum = parts.reduce((s, a) => s + (prices.get(a.symbol) ?? a.start), 0);
  return Math.max(1, Math.round((sum / parts.length) * (asset.scale ?? 1)));
}

/** Legt einen Wert erstmalig an. */
function list(guildId, asset, tick, now = Date.now()) {
  const price = asset.kind === 'fund' ? fundPrice(guildId, asset) : asset.start;
  db.setPrice(guildId, asset.symbol, price, tick, now);
  db.addHistory(guildId, asset.symbol, tick, price);
  return db.getPrice(guildId, asset.symbol);
}

// ---------------------------------------------------------- Simulation

/**
 * Schreibt den Markt bis zum aktuellen Tick fort.
 *
 * Aufgerufen vom Ticker (alle 30 Minuten, siehe `startTicker`) UND vor jeder
 * Ansicht. Beides ist unschädlich: Simuliert wird gegen die **Uhr**, nicht
 * gegen die Zahl der Aufrufe – zweimal hintereinander bewegt keinen Kurs.
 *
 * Beim allerersten Mal wird nur der Zeitpunkt gemerkt: Ein frisch
 * aufgesetzter Bot soll nicht zwei Wochen Kursgeschichte nachwürfeln.
 *
 * @returns {Promise<{ticks:number, simulated:number, news:Array, bankruptcies:Array}>}
 */
async function advance(guildId, now = Date.now(), random = Math.random) {
  const target = tickOf(now);

  const state = db.getMarketState(guildId);
  if (!state) {
    db.transaction(() => {
      for (const asset of data.ASSETS) {
        if (!db.getPrice(guildId, asset.symbol)) list(guildId, asset, target, now);
      }
      db.setMarketState(guildId, 1, target);
      return true;
    });
    return { ticks: target, simulated: 0, news: [], bankruptcies: [] };
  }

  const from = Math.max(state.tick, target - MAX_CATCHUP);
  if (target <= from) return { ticks: target, simulated: 0, news: [], bankruptcies: [] };

  // Die ganze Simulation in EINER Transaktion. Ohne sie schreibt SQLite jede
  // Verlaufszeile einzeln auf die Platte – ein Nachholen über zwei Wochen
  // dauerte damit anderthalb Minuten statt eines Wimpernschlags.
  const { news, broke, vol } = db.transaction(() => simulate(guildId, from, target, now, random));

  // Insolvenzen erst danach: Sie buchen Geld, und eine offene Transaktion
  // über ein `await` hinweg wäre eine gute Art, die Datenbank zu sperren.
  const bankruptcies = [];
  for (const asset of broke) {
    bankruptcies.push(await bankrupt(guildId, asset.asset, asset.price, target, now));
  }
  if (bankruptcies.length) {
    // Nach einer Neuemission stimmen die Fondskurse nicht mehr.
    db.transaction(() => {
      for (const asset of data.ASSETS) {
        if (asset.kind === 'fund') db.setPrice(guildId, asset.symbol, fundPrice(guildId, asset), target);
      }
      return true;
    });
  }

  return { ticks: target, simulated: target - from, news, bankruptcies, vol };
}

/**
 * Der rein rechnende Teil: keine Geldbuchung, kein `await`, alles synchron.
 * Genau deshalb darf er komplett in einer Transaktion laufen.
 */
function simulate(guildId, from, target, now, random) {
  const news = [];
  const broke = [];

  // Fehlende Werte (neu im Katalog) steigen zum Startkurs ein.
  for (const asset of data.ASSETS) {
    if (!db.getPrice(guildId, asset.symbol)) list(guildId, asset, from, now);
  }

  const singles = data.ASSETS.filter((a) => a.kind !== 'fund');
  const funds = data.ASSETS.filter((a) => a.kind === 'fund');
  const prices = new Map(singles.map((a) => [a.symbol, db.getPrice(guildId, a.symbol).price]));
  const fundPrices = new Map(funds.map((a) => [a.symbol, db.getPrice(guildId, a.symbol).price]));
  let vol = db.getMarketState(guildId)?.vol ?? 1;

  for (let t = from + 1; t <= target; t++) {
    vol = nextVol(vol, random);

    // Ein Ruck für den Aktienmarkt, einer für Krypto.
    const shocks = {
      stock: gauss(random) * MARKET_SIGMA * vol,
      crypto: gauss(random) * CRYPTO_SIGMA * vol,
    };
    const shockSigma = { stock: MARKET_SIGMA * vol, crypto: CRYPTO_SIGMA * vol };

    for (const asset of singles) {
      const before = prices.get(asset.symbol);
      const next = step(
        before, asset.sigma * vol, random,
        shocks[asset.kind] ?? 0, shockSigma[asset.kind] ?? 0);

      prices.set(asset.symbol, next);
      db.addHistory(guildId, asset.symbol, t, next);

      const change = (next - before) / before;
      if (Math.abs(change) >= NEWS_THRESHOLD) {
        const headline = makeHeadline(asset, change);
        db.addNews(guildId, asset.symbol, t, headline, change, now);
        news.push({ symbol: asset.symbol, headline, change });
      }
    }

    // Fonds im selben Takt mitziehen: Sie sind der Mittelwert ihres Korbs,
    // also gibt es sie nur mit frischen Kursen – und nur so bekommt auch der
    // Index einen echten Verlauf statt eines einzelnen Punktes.
    for (const asset of funds) {
      const before = fundPrices.get(asset.symbol);
      const next = basketMean(asset, prices);
      fundPrices.set(asset.symbol, next);
      db.addHistory(guildId, asset.symbol, t, next);

      const change = before > 0 ? (next - before) / before : 0;
      if (Math.abs(change) >= NEWS_THRESHOLD) {
        const headline = makeHeadline(asset, change);
        db.addNews(guildId, asset.symbol, t, headline, change, now);
        news.push({ symbol: asset.symbol, headline, change });
      }
    }
  }

  for (const asset of singles) {
    const price = prices.get(asset.symbol);
    db.setPrice(guildId, asset.symbol, price, target);
    db.purgeHistory(guildId, asset.symbol, target - HISTORY_TICKS);
    if (price < BANKRUPT_BELOW) broke.push({ asset, price });
  }
  for (const asset of funds) {
    db.setPrice(guildId, asset.symbol, fundPrices.get(asset.symbol), target);
    db.purgeHistory(guildId, asset.symbol, target - HISTORY_TICKS);
  }

  db.setMarketState(guildId, vol, target);
  db.purgeNews(guildId, target - HISTORY_TICKS);
  return { news, broke, vol };
}

/** Baut eine Schlagzeile zur Bewegung (erklärt sie, sagt sie nicht voraus). */
function makeHeadline(asset, change) {
  const pool = data.HEADLINES[asset.kind] ?? data.HEADLINES.stock;
  const lines = change > 0 ? pool.up : pool.down;
  const line = lines[Math.floor(Math.random() * lines.length)];
  return line
    .replace('{name}', asset.name)
    .replace('{pct}', `${change > 0 ? '+' : '−'}${Math.abs(change * 100).toFixed(1)}`);
}

/**
 * Insolvenz: Halter werden zum letzten Kurs ausgezahlt (abzüglich der
 * üblichen Gebühr – sonst wäre die Pleite besser als ein Verkauf), danach
 * wird der Wert zum Startkurs neu notiert.
 */
async function bankrupt(guildId, asset, price, tick, now = Date.now()) {
  const paid = [];

  for (const holding of db.holdersOf(guildId, asset.symbol)) {
    const gross = holding.shares * price;
    const amount = Math.max(0, gross - feeFor(gross));
    db.setHolding(guildId, holding.user_id, asset.symbol, 0, 0);

    if (amount > 0) {
      await changeCash(guildId, holding.user_id, amount,
        `Insolvenz: ${asset.name}`).catch(() => {});
    }
    db.createMessage({
      guildId, userId: holding.user_id, type: 'info',
      title: `Insolvenz: ${asset.name}`,
      body: `Deine ${holding.shares} Stück wurden zum letzten Kurs ausgebucht.\n` +
        `Erlös: ${amount.toLocaleString('de-DE')} (Einstand ${holding.invested.toLocaleString('de-DE')}).`,
      amount,
    });
    paid.push({ userId: holding.user_id, shares: holding.shares, amount });
  }

  db.addNews(guildId, asset.symbol, tick,
    data.BANKRUPTCY[Math.floor(Math.random() * data.BANKRUPTCY.length)]
      .replace('{name}', asset.name), -1, now);
  db.relistAsset(guildId, asset.symbol, asset.start, tick, now);
  db.addHistory(guildId, asset.symbol, tick, asset.start);
  db.addNews(guildId, asset.symbol, tick,
    data.RELAUNCH.replace('{name}', asset.name)
      .replace('{price}', asset.start.toLocaleString('de-DE')), 0, now);

  return { symbol: asset.symbol, name: asset.name, price, paid };
}

// ------------------------------------------------------------- Abfragen

/** Gebühr zu einem Auftragswert. */
function feeFor(amount) {
  return Math.max(MIN_FEE, Math.round(Math.abs(amount) * FEE));
}

/** Ein Wert mit Kurs, Verlauf und Veränderung. */
function quote(guildId, symbol, now = Date.now()) {
  const asset = data.find(symbol);
  if (!asset) return null;

  const row = db.getPrice(guildId, asset.symbol) ?? list(guildId, asset, tickOf(now), now);
  const hist = db.history(guildId, asset.symbol, row.tick - 24);
  const first = hist.length ? hist[0].price : row.price;

  return {
    ...asset,
    price: row.price,
    tick: row.tick,
    history: hist.map((h) => h.price),
    dayChange: first > 0 ? (row.price - first) / first : 0,
    kindLabel: data.KIND_LABEL[asset.kind] ?? asset.kind,
  };
}

/** Alle Werte, sortiert: Fonds, Aktien, Krypto. */
function board(guildId, now = Date.now()) {
  const order = { fund: 0, stock: 1, crypto: 2 };
  return data.ASSETS
    .map((a) => quote(guildId, a.symbol, now))
    .sort((a, b) => (order[a.kind] - order[b.kind]) || b.price - a.price);
}

/** Depot eines Spielers samt Bewertung. */
function portfolio(guildId, userId, now = Date.now()) {
  const positions = db.holdingsOf(guildId, userId).map((h) => {
    const q = quote(guildId, h.symbol, now);
    const value = q ? h.shares * q.price : 0;
    return {
      symbol: h.symbol,
      name: q?.name ?? h.symbol,
      emoji: q?.emoji ?? '•',
      kind: q?.kind ?? 'stock',
      shares: h.shares,
      invested: h.invested,
      price: q?.price ?? 0,
      average: h.shares > 0 ? h.invested / h.shares : 0,
      value,
      profit: value - h.invested,
      ratio: h.invested > 0 ? (value - h.invested) / h.invested : 0,
    };
  }).sort((a, b) => b.value - a.value);

  const value = positions.reduce((s, p) => s + p.value, 0);
  const invested = positions.reduce((s, p) => s + p.invested, 0);
  return { positions, value, invested, profit: value - invested };
}

/** Wie viele Stücke bekommt man für einen Betrag? */
function sharesFor(price, budget) {
  if (price <= 0) return 0;
  // Die Gebühr muss mitbezahlt werden, sonst reicht das Geld knapp nicht.
  return Math.max(0, Math.floor(budget / (price * (1 + FEE))));
}

// -------------------------------------------------------------- Handel

/**
 * Kauf.
 *
 * Reihenfolge wie überall (§9): erst die Position lokal buchen (synchron,
 * daher doppelklicksicher), dann das Geld. Scheitert die Buchung, wird die
 * Position zurückgesetzt.
 */
async function buy(guildId, userId, symbol, sharesWanted, now = Date.now(), allowBank = true) {
  const q = quote(guildId, symbol, now);
  if (!q) return { ok: false, reason: 'unknown_symbol' };

  const shares = Math.floor(Number(sharesWanted));
  if (!Number.isFinite(shares) || shares <= 0) return { ok: false, reason: 'bad_amount' };
  if (shares > MAX_SHARES) return { ok: false, reason: 'too_many', max: MAX_SHARES };

  const gross = shares * q.price;
  const fee = feeFor(gross);
  const total = gross + fee;

  const balance = await getBalance(guildId, userId);
  const funds = allowBank ? balance.total : balance.cash;
  if (funds < total) {
    return { ok: false, reason: 'insufficient_funds', needed: total, have: funds, quote: q };
  }

  const before = db.getHolding(guildId, userId, symbol);
  const shareSum = (before?.shares ?? 0) + shares;
  const investSum = (before?.invested ?? 0) + gross;
  db.setHolding(guildId, userId, symbol, shareSum, investSum);

  let movedFromBank = 0;
  try {
    if (balance.cash < total) {
      movedFromBank = total - balance.cash;
      await withdrawFromBank(guildId, userId, movedFromBank, `Börse: ${q.name}`);
    }
    const newBalance = await changeCash(
      guildId, userId, -total, `Börse: ${shares}× ${q.symbol} @ ${q.price}`);

    return {
      ok: true, quote: q, shares, price: q.price, gross, fee, total,
      movedFromBank, newBalance, holding: db.getHolding(guildId, userId, symbol),
    };
  } catch (err) {
    if (before) db.setHolding(guildId, userId, symbol, before.shares, before.invested);
    else db.setHolding(guildId, userId, symbol, 0, 0);
    if (movedFromBank > 0) {
      await withdrawFromBank(guildId, userId, -movedFromBank, 'Börse abgebrochen').catch(() => {});
    }
    throw err;
  }
}

/** Verkauf. `shares` = null verkauft die ganze Position. */
async function sell(guildId, userId, symbol, sharesWanted = null, now = Date.now()) {
  const q = quote(guildId, symbol, now);
  if (!q) return { ok: false, reason: 'unknown_symbol' };

  const holding = db.getHolding(guildId, userId, symbol);
  if (!holding || holding.shares <= 0) return { ok: false, reason: 'nothing_held', quote: q };

  const shares = sharesWanted === null
    ? holding.shares
    : Math.floor(Number(sharesWanted));
  if (!Number.isFinite(shares) || shares <= 0) return { ok: false, reason: 'bad_amount' };
  if (shares > holding.shares) {
    return { ok: false, reason: 'not_enough_shares', have: holding.shares, quote: q };
  }

  const gross = shares * q.price;
  const fee = feeFor(gross);
  const net = Math.max(0, gross - fee);

  // Anteiliger Einstand der verkauften Stücke – der Rest bleibt im Depot.
  const share = shares / holding.shares;
  const investedOut = Math.round(holding.invested * share);
  db.setHolding(guildId, userId, symbol,
    holding.shares - shares, holding.invested - investedOut);

  try {
    const newBalance = await changeCash(
      guildId, userId, net, `Börse: Verkauf ${shares}× ${q.symbol} @ ${q.price}`);
    return {
      ok: true, quote: q, shares, price: q.price, gross, fee, net,
      invested: investedOut, profit: net - investedOut, newBalance,
    };
  } catch (err) {
    db.setHolding(guildId, userId, symbol, holding.shares, holding.invested);
    throw err;
  }
}

// -------------------------------------------------------------- Ticker

/**
 * ===========================================================================
 *  DER TICKER – die eine Ausnahme von der faulen Abrechnung
 * ===========================================================================
 *
 * Der Rest des Bots rechnet faul ab (ARCHITEKTUR §4): Miete, Straßenschäden
 * und Auktionen passieren erst, wenn jemand hinschaut. Für eine Börse ist das
 * die falsche Wahl – Kurse müssen sich bewegen, während niemand zusieht,
 * sonst sind Schlagzeilen sinnlos und der Verlauf entsteht erst beim Öffnen.
 *
 * Deshalb hier ein echter Taktgeber. Er ist aber nur ein **Auslöser**, keine
 * zweite Codebahn: Er ruft dasselbe `advance()` auf, das auch vor jeder
 * Ansicht läuft. Simuliert wird gegen die Uhr, nicht gegen die Zahl der
 * Aufrufe – ein verpasster Takt (Neustart, Ausfall) wird beim nächsten Lauf
 * einfach nachgeholt, ein doppelter tut nichts.
 */

/** Läuft schon einer? Im duo-Prozess starten beide Seiten den Ticker. */
let ticker = null;

/**
 * Startet den Taktgeber für eine Welt.
 * @returns {boolean} false, wenn schon einer läuft.
 */
function startTicker(guildId, { intervalMs = TICK_MS, onTick = null } = {}) {
  if (ticker) return false;

  const run = async () => {
    try {
      const result = await advance(guildId);
      if (result.simulated > 0 && (result.news.length || result.bankruptcies.length)) {
        console.log(`📈 Börse: ${result.simulated} Takt(e) · ${result.news.length} Schlagzeilen` +
          (result.bankruptcies.length ? ` · ${result.bankruptcies.length} Insolvenz(en)` : ''));
      }
      if (onTick) await onTick(result);
    } catch (err) {
      // Ein Fehler im Takt darf den Bot nicht mitreißen.
      console.error('Börse: Takt fehlgeschlagen:', err.message);
    }
  };

  run();                                   // sofort aufholen, was liegen blieb
  ticker = setInterval(run, intervalMs);
  ticker.unref?.();                        // hält den Prozess nicht am Leben
  console.log(`📈 Börse: Ticker läuft (alle ${Math.round(intervalMs / 60000)} min).`);
  return true;
}

/** Hält den Taktgeber an (Tests, sauberes Herunterfahren). */
function stopTicker() {
  if (!ticker) return false;
  clearInterval(ticker);
  ticker = null;
  return true;
}

/** Läuft gerade ein Taktgeber? */
const tickerRunning = () => ticker !== null;

// ------------------------------------------------------------- Anzeige

/** Kleines Balkendiagramm aus dem Kursverlauf. */
const SPARK = '▁▂▃▄▅▆▇█';

function sparkline(prices, width = 24) {
  const series = prices.slice(-width);
  if (series.length < 2) return '▁'.repeat(Math.max(1, series.length));

  const min = Math.min(...series);
  const max = Math.max(...series);
  if (max === min) return '▄'.repeat(series.length);

  return series.map((p) => {
    const level = Math.round(((p - min) / (max - min)) * (SPARK.length - 1));
    return SPARK[level];
  }).join('');
}

/** "+3,4 %" bzw. "−1,2 %". */
function percent(change) {
  const sign = change > 0 ? '+' : (change < 0 ? '−' : '±');
  return `${sign}${Math.abs(change * 100).toFixed(1)} %`;
}

/** Pfeil zur Richtung – für die Zeile im Kursboard. */
function arrow(change) {
  if (change > 0.02) return '📈';
  if (change < -0.02) return '📉';
  return '➖';
}

module.exports = {
  TICK_MS, MAX_CATCHUP, FEE, MIN_FEE, BANKRUPT_BELOW, HISTORY_TICKS,
  NEWS_THRESHOLD, MAX_SHARES, MARKET_SIGMA, CRYPTO_SIGMA, VOL_RANGE,
  gauss, step, nextVol, tickOf, basketOf, fundPrice, basketMean, list, advance,
  simulate, makeHeadline, bankrupt,
  feeFor, quote, board, portfolio, sharesFor, buy, sell,
  startTicker, stopTicker, tickerRunning,
  sparkline, percent, arrow,
};
