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
 * ===================== ZWEI BEWUSSTE ZUFLÜSSE =====================
 * Die Börse war lange ein exaktes Martingal: Erwartungswert null, kein Muster
 * im Vorteil. Sauber – aber sie fühlte sich tot an, und das aus einem
 * unangenehmen Grund. Bei multiplikativen Kursen gilt
 *
 *     Median = Mittelwert · e^(−σ²·t/2)
 *
 * Der Mittelwert stimmte also, während der **typische** Verlauf langsam
 * ausblutete: Gemessen gingen nur 39 % aller Käufe mit Gewinn raus. Wer hielt,
 * verlor gefühlt immer, und wer hinschaute, wurde dafür nicht belohnt.
 *
 * Deshalb jetzt zwei Zuflüsse, beide klein, beide gedeckelt, beide gemessen:
 *
 *  1. **Drift** – der Markt steigt leicht. Das gleicht das Ausbluten aus, ohne
 *     irgendein Handelsmuster zu bevorzugen: Es gibt nichts vorherzusagen,
 *     der Zufluss ist passiv und proportional zum eingesetzten Geld. Gedeckelt
 *     über DRIFT_CAP.
 *  2. **Nachbeben** – nach einem Kurssturz (oder einer Übertreibung nach oben)
 *     zieht der Kurs einen Teil davon zurück. **Nur in diesem Fenster** ist
 *     etwas vorhersagbar, und genau das macht Hinschauen wertvoll: Wer den
 *     Einbruch sieht und kauft, verdient daran.
 *
 * Warum nicht dauerhaft an einen Anker binden? Das war der erste Versuch, und
 * er ist an der Messung gescheitert: Ein simpler Bot („kaufe 10 % unter dem
 * Schnitt") holte damit **+105 % auf das eingesetzte Kapital in zwei Monaten**
 * heraus – bei einem Blick pro Tag. Vorhersagbarkeit ist immer handelbar; die
 * Frage ist nur, wie oft es sie gibt. Deshalb hier: selten und begrenzt.
 *
 * Wie groß der Vorteil des Hinschauens tatsächlich ist, rechnet
 * test/wallstreet.test.js mit demselben Bot nach und hält ihn nach oben fest.
 * ==================================================================
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

/**
 * Aufwärtsdrift je Takt, als **Anteil des Ausblutens** (σ²/2).
 *
 * 1 hieße: Der Median steht exakt still, der Mittelwert wächst um dasselbe.
 * 0,6 lässt einen Rest übrig – Halten lohnt sich, ist aber kein Selbstläufer.
 */
const DRIFT_SHARE = 1;

/**
 * Und ein harter Deckel je Takt.
 *
 * Nötig wegen Krypto: Dort ist σ²/2 so groß, dass die volle Drift +150 % im
 * Monat wären. Mit Deckel liegt der passive Zufluss für JEDEN Wert bei
 * höchstens ~4 % im Monat.
 */
const DRIFT_CAP = 0.00004;

/**
 * ===================== NACHBEBEN =====================
 * Selten kippt ein Kurs weg (oder schießt hoch) – und holt danach einen Teil
 * davon zurück. Das ist die einzige Stelle, an der der Kurs vorhersagbar ist,
 * und sie ist mit Absicht selten: Der Vorteil, den man daraus ziehen kann, ist
 * die Zahl der Ereignisse mal ihre Tiefe.
 */
const EVENT_CHANCE = 1 / (48 * 90);   // je Wert etwa alle 90 Tage
const EVENT_SIZE = [0.12, 0.30];      // wie tief es kippt
const RECOVER_SHARE = 0.5;            // so viel davon kommt zurück
const RECOVER_TICKS = 96;             // über zwei Tage verteilt
const RECOVER_PULL = 0.035;           // Zug je Takt in Richtung Erholung

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
function step(price, sigma, random = Math.random, shock = 0, shockSigma = 0, recoverTo = 0) {
  if (!sigma && !shock && !recoverTo) return price;
  const variance = sigma * sigma + shockSigma * shockSigma;

  // Drift: gleicht das Ausbluten des Medians zum großen Teil aus, gedeckelt.
  const drift = Math.min(DRIFT_CAP, (variance / 2) * DRIFT_SHARE);

  // Nachbeben: zieht in Richtung Erholungsziel – nur solange das Fenster läuft.
  const pull = recoverTo > 0
    ? RECOVER_PULL * Math.log(recoverTo / Math.max(1, price)) : 0;

  const factor = Math.exp(pull + drift + sigma * gauss(random) + shock - variance / 2);
  return Math.max(1, Math.round(price * factor));
}

/**
 * Würfelt ein Kursereignis aus: Sturz oder Übertreibung.
 *
 * @returns {{price:number, to:number, down:boolean}|null} neuer Kurs und das
 *   Erholungsziel – oder null, wenn nichts passiert ist.
 */
function rollEvent(price, tick, random = Math.random) {
  if (random() >= EVENT_CHANCE) return null;

  const size = EVENT_SIZE[0] + random() * (EVENT_SIZE[1] - EVENT_SIZE[0]);
  const down = random() < 0.5;
  const after = down
    ? Math.max(1, Math.round(price * (1 - size)))
    : Math.max(1, Math.round(price * (1 + size)));

  // Zurück kommt nur ein Teil – der Rest ist echte Neubewertung. Sonst wäre
  // jedes Ereignis eine sichere Bank für den, der es sieht.
  const to = down
    ? after + (price - after) * RECOVER_SHARE
    : after - (after - price) * RECOVER_SHARE;

  return { price: after, to, until: tick + RECOVER_TICKS, down, size };
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
  // Offene Nachbeben aus einem früheren Lauf weiterführen.
  const recovery = new Map(singles.map((a) => {
    const row = db.getPrice(guildId, a.symbol);
    return [a.symbol, { to: row.recover_to ?? 0, until: row.recover_until ?? 0 }];
  }));
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
      const open = recovery.get(asset.symbol);
      const active = open.until > t ? open.to : 0;

      let next = step(
        before, asset.sigma * vol, random,
        shocks[asset.kind] ?? 0, shockSigma[asset.kind] ?? 0, active);

      // Kippt hier gerade etwas weg? Dann überschreibt das den normalen Schritt.
      const event = active > 0 ? null : rollEvent(next, t, random);
      if (event) {
        next = event.price;
        recovery.set(asset.symbol, { to: event.to, until: event.until });
      } else if (open.until <= t && open.to > 0) {
        recovery.set(asset.symbol, { to: 0, until: 0 });   // Fenster abgelaufen
      }

      prices.set(asset.symbol, next);
      db.addHistory(guildId, asset.symbol, t, next);

      const change = (next - before) / before;
      if (Math.abs(change) >= NEWS_THRESHOLD) {
        const headline = makeHeadline(asset, change);
        db.addNews(guildId, asset.symbol, t, headline, change, now);
        news.push({ symbol: asset.symbol, headline, change, event: Boolean(event) });
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
    db.setPrice(guildId, asset.symbol, price, target, undefined, recovery.get(asset.symbol));
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
    const amount = Math.max(0, gross - feeForUser(guildId, holding.user_id, gross));
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

/**
 * Gebühr zu einem Auftragswert.
 *
 * `factor` ist der Level-Rabatt (siehe perks.js). Er darf die Gebühr senken,
 * aber nie auf null: Sie ist der Grund, warum die Börse unterm Strich eine
 * Geldsenke ist – ohne sie wäre Handeln ein Nullsummenspiel mit unbegrenzt
 * vielen Versuchen.
 */
function feeFor(amount, factor = 1) {
  // Achtung: `Number(x) || 1` wäre hier falsch – 0 ist falsy und würde zum
  // vollen Satz statt zum Deckel führen.
  const raw = Number.isFinite(Number(factor)) ? Number(factor) : 1;
  const cut = Math.min(1, Math.max(0.25, raw));
  return Math.max(MIN_FEE, Math.round(Math.abs(amount) * FEE * cut));
}

/** Die Gebühr, die dieser Spieler zahlt (mit seinem Level-Rabatt). */
function feeForUser(guildId, userId, amount) {
  return feeFor(amount, require('./perks').perksOf(guildId, userId).fee);
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
  const fee = feeForUser(guildId, userId, gross);
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
      guildId, userId, -total, `Börse: ${shares}× ${q.symbol} @ ${q.price}`,
      { kind: 'market' });

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
  const fee = feeForUser(guildId, userId, gross);
  const net = Math.max(0, gross - fee);

  // Anteiliger Einstand der verkauften Stücke – der Rest bleibt im Depot.
  const share = shares / holding.shares;
  const investedOut = Math.round(holding.invested * share);
  db.setHolding(guildId, userId, symbol,
    holding.shares - shares, holding.invested - investedOut);

  try {
    const newBalance = await changeCash(
      guildId, userId, net, `Börse: Verkauf ${shares}× ${q.symbol} @ ${q.price}`,
      { kind: 'market' });
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
  DRIFT_SHARE, DRIFT_CAP, EVENT_CHANCE, EVENT_SIZE, RECOVER_SHARE, RECOVER_TICKS,
  RECOVER_PULL, rollEvent,
  gauss, step, nextVol, tickOf, basketOf, fundPrice, basketMean, list, advance,
  simulate, makeHeadline, bankrupt,
  feeFor, feeForUser, quote, board, portfolio, sharesFor, buy, sell,
  startTicker, stopTicker, tickerRunning,
  sparkline, percent, arrow,
};
