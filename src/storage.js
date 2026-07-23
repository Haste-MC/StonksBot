const db = require('./db');
const condition = require('./condition');
const data = require('./data/storage');
const unb = require('./unb');

// Late-Binding, damit Tests unb.* ersetzen können (siehe ARCHITEKTUR §8).
const getBalance = (...a) => unb.getBalance(...a);
const changeCash = (...a) => unb.changeCash(...a);
const withdrawFromBank = (...a) => unb.withdrawFromBank(...a);

const MIN = 60 * 1000;

/**
 * ===========================================================================
 *  STORAGE WARS – KERNLOGIK
 * ===========================================================================
 *
 * Serverweite Auktion: eine RUNDE besteht aus 4–7 Garagen (Losen), die
 * NACHEINANDER live gehen – Garage 1 ~1 h, dann Garage 2, usw. Immer nur eine
 * ist bietbar. Alles hängt an der Zeit (kein Scheduler): mehrfaches Öffnen
 * erzeugt nichts, fällige Lose werden faul beim nächsten settle() abgerechnet.
 *
 * ===================== KEIN GELDDRUCKER (§3) =====================
 * Startpreis S = round(E[V] × HAUSMARGE), HAUSMARGE ≥ 1. S hängt nur an der
 * Größenstufe (der Erscheinung), NIE am konkreten Inhalt V. Jeder Gewinner
 * zahlt ≥ S ≥ E[V], also E[Gewinn] ≤ 0. Bewiesen in test/storage.test.js.
 * ================================================================
 */

/** Hausvorteil: der Startpreis liegt 15 % über dem Erwartungswert des Inhalts. */
const HOUSE_MARGIN = 1.15;
/** Wie lange eine einzelne Garage live ist. Tunbar über opts.lotDuration. */
const LOT_DURATION_MS = 60 * MIN;
/** Pause zwischen dem Ende einer Runde und dem Start der nächsten. */
const ROUND_GAP_MS = 30 * MIN;
/** Wie viele Garagen eine Runde hat. */
const ROUND_SIZE = [4, 7];
/** Mindest-Erhöhungsschritt beim Überbieten. */
const BID_INCREMENT = 0.10;
/** Zustand gefundener Autos (verstaubte Garage) – fest, für saubere E[V]-Rechnung. */
const FOUND_CAR_CONDITION = 65;
/** Nur günstigere Autos sind auffindbar, damit der Jackpot den EV nicht sprengt. */
const CAR_PRICE_CAP = 40000;

// ------------------------------------------------------------- Erwartungswert

const CASH_MEAN = (data.CASH_RANGE[0] + data.CASH_RANGE[1]) / 2;

/** Mittlerer Wert eines einzelnen Fundobjekts (gleichverteilte Auswahl). */
function objectMean() {
  return data.OBJECTS.reduce((s, o) => s + (o.range[0] + o.range[1]) / 2, 0) / data.OBJECTS.length;
}

/** Auffindbare Autos dieses Servers (unter dem Preisdeckel). */
function eligibleCars(guildId) {
  return db.allItemsOfKind(guildId, 'car').filter((c) => c.price <= CAR_PRICE_CAP);
}

/** Durchschnittlicher Zeitwert eines auffindbaren Autos (0 = keine im Katalog). */
function avgCarValue(guildId) {
  const cars = eligibleCars(guildId);
  if (!cars.length) return 0;
  return cars.reduce((s, c) => s + condition.currentValue(c.price, FOUND_CAR_CONDITION), 0) / cars.length;
}

/**
 * Analytischer Erwartungswert des Inhalts einer Stufe – Grundlage für den
 * Startpreis. Hängt NICHT vom konkreten Wurf ab.
 */
function expectedValue(tier, carValue = 0) {
  const countMean = (tier.objectCount[0] + tier.objectCount[1]) / 2;
  return countMean * objectMean() + tier.cashChance * CASH_MEAN + tier.carChance * carValue;
}

function startPrice(tier, carValue) {
  return Math.max(1, Math.round(expectedValue(tier, carValue) * HOUSE_MARGIN));
}

// ------------------------------------------------------------- Generierung

/** Ganzzahl in [min,max] inklusive. */
function randInt([min, max], random) {
  return min + Math.floor(random() * (max - min + 1));
}

/**
 * Würfelt EIN Los (ohne DB) – Inhalt, Wert, Startpreis, Flavor. Ausgelagert,
 * damit der Monte-Carlo-Test tausende Lose ohne DB-Schreibzugriffe prüfen kann.
 */
function rollLot(guildId, random = Math.random) {
  const tier = data.weighted(data.TIERS, random);
  const carAvg = avgCarValue(guildId);
  const cars = eligibleCars(guildId);

  const k = randInt(tier.objectCount, random);
  const objects = [];
  for (let i = 0; i < k; i++) {
    const o = data.pick(data.OBJECTS, random);
    objects.push({ name: o.name, value: Math.max(1, Math.round(data.between(o.range, random))) });
  }

  const cash = random() < tier.cashChance
    ? Math.max(1, Math.round(data.between(data.CASH_RANGE, random))) : 0;

  let car = null;
  if (cars.length && random() < tier.carChance) {
    const c = data.pick(cars, random);
    car = {
      itemId: c.id, name: c.name, condition: FOUND_CAR_CONDITION,
      value: condition.currentValue(c.price, FOUND_CAR_CONDITION),
    };
  }

  const value = objects.reduce((s, o) => s + o.value, 0) + cash + (car ? car.value : 0);

  // Hinweis + evtl. ein sichtbares Objekt (nur Name, kein Wert) – reine Flavor,
  // aus der Stufe abgeleitet, damit der Peek den Jackpot nicht verrät.
  const hint = data.pick(data.HINTS, random);
  const peek = objects.length && random() < 0.5
    ? `${data.pick(data.PEEK_INTROS, random)} „${data.pick(objects, random).name}".`
    : '';

  return {
    tier: tier.id, seller: data.pick(data.SELLERS, random), hint, peek,
    startPrice: startPrice(tier, carAvg), contents: { objects, cash, car }, value,
  };
}

/**
 * Erzeugt ein Los und schreibt es in die DB.
 * @param slot {roundId, seq, opensAt, endsAt}
 */
function generateLot(guildId, slot, random = Math.random) {
  const rolled = rollLot(guildId, random);
  return db.insertLot({
    guildId, roundId: slot.roundId, seq: slot.seq, ...rolled,
    opensAt: slot.opensAt, endsAt: slot.endsAt,
  });
}

/**
 * Sorgt dafür, dass eine Runde läuft. Legt – atomar – eine neue Runde mit
 * 4–7 gestaffelten Losen an, wenn keine mehr läuft und die Pause vorbei ist.
 * @returns die neue Runde samt Losen, oder null (es lief schon eine / Pause).
 */
function ensureRound(guildId, now = Date.now(), random = Math.random, opts = {}) {
  const lotDuration = opts.lotDuration ?? LOT_DURATION_MS;
  const roundGap = opts.roundGap ?? ROUND_GAP_MS;

  return db.transaction(() => {
    const latest = db.latestRound(guildId);
    if (latest && latest.ends_at > now) return null;                 // läuft noch
    if (latest && now < latest.ends_at + roundGap) return null;      // Pause

    const size = randInt(ROUND_SIZE, random);
    const round = db.insertRound(guildId, now, now + size * lotDuration, size);
    const lots = [];
    for (let seq = 0; seq < size; seq++) {
      const opensAt = now + seq * lotDuration;
      lots.push(generateLot(guildId, {
        roundId: round.id, seq, opensAt, endsAt: opensAt + lotDuration,
      }, random));
    }
    return { round, lots };
  });
}

// ------------------------------------------------------------------- Bieten

/** Mindestgebot für ein Los: Startpreis oder Höchstgebot + Schritt. */
function minBid(lot) {
  if (lot.top_bid > 0) {
    return Math.max(lot.top_bid + 1, Math.ceil(lot.top_bid * (1 + BID_INCREMENT)));
  }
  return lot.start_price;
}

/** Ist dieses Los gerade live (bietbar)? */
function isLive(lot, now = Date.now()) {
  return lot.status === 'open' && lot.opens_at <= now && now < lot.ends_at;
}

async function placeBid(guildId, userId, lotId, amount, now = Date.now()) {
  const lot = db.getLot(guildId, lotId);
  if (!lot) return { ok: false, reason: 'not_found' };
  if (!isLive(lot, now)) return { ok: false, reason: 'not_live', lot };

  const bid = Math.round(Number(amount));
  const min = minBid(lot);
  if (!Number.isFinite(bid) || bid < min) return { ok: false, reason: 'too_low', lot, min };

  const balance = await getBalance(guildId, userId);
  if (balance.total < bid) {
    return { ok: false, reason: 'insufficient_funds', lot, needed: bid, have: balance.total };
  }

  const prevBidder = lot.top_bidder;
  const prevBid = lot.top_bid;

  // Atomar: nur wenn immer noch live UND höher als das aktuelle Gebot.
  if (!db.placeBid(guildId, lotId, bid, userId, now)) {
    const fresh = db.getLot(guildId, lotId);
    return { ok: false, reason: 'outbid', lot: fresh, min: minBid(fresh) };
  }

  // Vorherigen Höchstbietenden benachrichtigen (nicht sich selbst).
  if (prevBidder && prevBidder !== userId) {
    db.createMessage({
      guildId, userId: prevBidder, type: 'info',
      title: `Überboten: Garage #${lot.seq + 1}`,
      body: `Jemand hat dein Gebot übertroffen. Nachlegen im Auktionshaus?`,
      amount: bid,
    });
  }

  return { ok: true, lot: db.getLot(guildId, lotId), bid, previous: prevBid };
}

// -------------------------------------------------------------- Abrechnung

/**
 * Rechnet alle fälligen Lose ab (Zuschlag, Reveal, Sammlung, Postfach) und
 * startet danach ggf. die nächste Runde. Idempotent: jedes Los wird atomar
 * beansprucht, wiederholtes Aufrufen bucht nichts doppelt.
 *
 * @returns die für `userId` relevanten Zuschläge (für die Sofort-Notiz).
 */
async function settle(guildId, userId = null, now = Date.now(), opts = {}) {
  const results = [];
  for (const lot of db.dueLots(guildId, now)) {
    if (!db.claimLot(guildId, lot.id)) continue;   // schon von anderem Aufruf beansprucht
    results.push(await resolveLot(guildId, lot));
  }
  ensureRound(guildId, now, opts.random ?? Math.random, opts);
  return userId ? results.filter((r) => r.winner === userId && r.status === 'sold') : results;
}

async function resolveLot(guildId, lot) {
  const label = `Garage #${lot.seq + 1}`;

  if (!lot.top_bidder) {
    db.finishLot(guildId, lot.id, 'unsold');
    return { lotId: lot.id, status: 'unsold', winner: null, label };
  }

  const winner = lot.top_bidder;
  const price = lot.top_bid;

  const balance = await getBalance(guildId, winner);
  if (balance.total < price) {
    db.finishLot(guildId, lot.id, 'void');
    db.createMessage({
      guildId, userId: winner, type: 'info',
      title: `Zuschlag geplatzt: ${label}`,
      body: `Du hattest das Höchstgebot, konntest aber nicht zahlen.`,
    });
    return { lotId: lot.id, status: 'void', winner, label };
  }

  try {
    if (balance.cash < price) {
      await withdrawFromBank(guildId, winner, price - balance.cash, `Auktion: ${label}`);
    }
    await changeCash(guildId, winner, -price, `Auktion: ${label}`);
  } catch (err) {
    db.finishLot(guildId, lot.id, 'void');
    return { lotId: lot.id, status: 'void', winner, label, error: true };
  }

  // Inhalt auflösen: Objekte -> Sammlung, Bargeld/Auto -> ggf. Bargeld.
  const c = lot.contents;
  for (const o of c.objects || []) db.addLoot(guildId, winner, o.name, o.value, lot.id);

  let cashFound = c.cash || 0;
  let carResult = null;
  if (c.car) {
    carResult = await applyCarReward(guildId, winner, c.car);
    if (carResult.cashedOut) cashFound += carResult.value;
  }
  if (cashFound > 0) {
    await changeCash(guildId, winner, cashFound, `Fund: ${label}`).catch(() => {});
  }

  db.finishLot(guildId, lot.id, 'sold');

  const net = lot.value - price;
  db.createMessage({
    guildId, userId: winner, type: 'info',
    title: `Zuschlag: ${label} für ${price.toLocaleString('de-DE')}`,
    body: revealBody(c, carResult, net),
    amount: lot.value,
    itemId: c.car ? c.car.itemId : null,
  });

  return {
    lotId: lot.id, status: 'sold', winner, label, price,
    value: lot.value, net, contents: c, carResult,
  };
}

/**
 * Behandelt ein gefundenes Auto: echtes Fahrzeug, wenn noch nicht besessen und
 * ein Stellplatz frei ist; sonst als Bargeld ausgezahlt.
 */
async function applyCarReward(guildId, userId, car) {
  const property = require('./property');
  const owned = db.getOwned(guildId, userId, car.itemId);
  const slots = property.capacity(guildId, userId);
  if (!owned && slots.free >= 1) {
    db.grantCar(guildId, userId, car.itemId, car.condition);
    return { granted: true, name: car.name, value: car.value };
  }
  return { cashedOut: true, name: car.name, value: car.value };
}

function revealBody(contents, carResult, net) {
  const lines = [];
  const objs = contents.objects || [];
  if (objs.length) {
    lines.push('**Fundstücke** (in deiner Sammlung):');
    lines.push(objs.map((o) => `• ${o.name}`).join('\n'));
  }
  if (contents.cash > 0) lines.push(`💵 Bargeld gefunden: ${contents.cash.toLocaleString('de-DE')}`);
  if (carResult) {
    lines.push(carResult.granted
      ? `🚗 Ein **${carResult.name}** stand drin – ab in die Garage!`
      : `🚗 Ein **${carResult.name}** stand drin – zu Bargeld gemacht.`);
  }
  lines.push(net >= 0
    ? `📈 Geschätzter Gewinn: **+${net.toLocaleString('de-DE')}**`
    : `📉 Geschätzter Verlust: **${net.toLocaleString('de-DE')}**`);
  return lines.join('\n');
}

// -------------------------------------------------------------- Hehler

/**
 * Verkauft ein einzelnes Fundstück oder (ohne lootId) die ganze Sammlung.
 * Erst lokal entfernen, dann buchen – so kann ein zweiter Klick nichts doppelt
 * verkaufen (§7).
 */
async function sellLoot(guildId, userId, lootId = null) {
  if (lootId != null) {
    const loot = db.getLoot(guildId, lootId);
    if (!loot || loot.user_id !== userId) return { ok: false, reason: 'not_found' };
    if (!db.removeLoot(guildId, userId, lootId)) return { ok: false, reason: 'not_found' };
    const balance = await changeCash(
      guildId, userId, loot.value, `Hehler: ${loot.name}`).catch(() => null);
    return { ok: true, sold: [loot], total: loot.value, balance };
  }

  const items = db.listLoot(guildId, userId);
  if (!items.length) return { ok: false, reason: 'empty' };
  const total = items.reduce((s, i) => s + i.value, 0);
  db.clearLoot(guildId, userId);
  const balance = await changeCash(
    guildId, userId, total, `Hehler: ${items.length} Fundstücke`).catch(() => null);
  return { ok: true, sold: items, total, balance };
}

module.exports = {
  HOUSE_MARGIN, LOT_DURATION_MS, ROUND_GAP_MS, ROUND_SIZE, BID_INCREMENT,
  FOUND_CAR_CONDITION, CAR_PRICE_CAP, MIN,
  objectMean, eligibleCars, avgCarValue, expectedValue, startPrice,
  rollLot, generateLot, ensureRound, minBid, isLive, placeBid,
  settle, resolveLot, applyCarReward, sellLoot,
};
