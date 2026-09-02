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

/** Hausvorteil: der Startpreis liegt über dem Erwartungswert des Inhalts. */
const HOUSE_MARGIN = 1.10;

/**
 * Ab dieser Seltenheit fließt ein Fund NICHT mehr in den Startpreis ein.
 *
 * Godlike & Co. sind mit Absicht fast unerreichbar (< 1 : 2000). Trotzdem
 * steckten sie im Erwartungswert – also im Preis JEDER Garage. Bezahlt hat man
 * eine Lotterie, die man praktisch nie gewinnt. Der Jackpot bleibt drin, er
 * wird nur nicht mehr eingepreist: geschenkter Bonus statt Dauerabgabe.
 *
 * Damit das kein Gelddrucker wird, muss der so verschenkte Anteil KLEINER sein
 * als der Hausvorteil – genau das prüft test/storage.test.js.
 */
const UNPRICED_FROM = 'godlike';
/** Wie lange eine einzelne Garage live ist. Tunbar über opts.lotDuration. */
const LOT_DURATION_MS = 20 * MIN;
/** Pause zwischen dem Ende einer Runde und dem Start der nächsten. */
const ROUND_GAP_MS = 0;
/** Wie viele Garagen eine Runde hat. */
const ROUND_SIZE = [4, 7];
/** Mindest-Erhöhungsschritt beim Überbieten. */
const BID_INCREMENT = 0.10;
/** Zustand gefundener Autos (verstaubte Garage) – fest, für saubere E[V]-Rechnung. */
const FOUND_CAR_CONDITION = 65;
/** Nur günstigere Autos sind auffindbar, damit der Jackpot den EV nicht sprengt. */
const CAR_PRICE_CAP = 40000;

// ------------------------------------------------------------- Erwartungswert

/** Bargeldspanne einer Stufe (mit Rückfall auf die allgemeine Spanne). */
function cashRange(tier) {
  return tier.cash ?? data.CASH_RANGE;
}

/** Erwartetes Bargeld einer Stufe. `cashChance` bleibt für Stufen ohne `cash`. */
function expectedCash(tier) {
  const [min, max] = cashRange(tier);
  return (tier.cashChance ?? 1) * (min + max) / 2;
}

/**
 * Mittlerer Basiswert eines Objekts (ohne Seltenheit/Zustand) – **gewichtet**,
 * damit seltene Teuerstücke den Preis nicht tragen, den man in jeder Garage
 * zahlt (siehe data/storage.js).
 */
function objectMean() {
  const total = data.OBJECTS.reduce((s, o) => s + (o.weight ?? 1), 0);
  return data.OBJECTS.reduce(
    (s, o) => s + (o.weight ?? 1) * (o.range[0] + o.range[1]) / 2, 0) / total;
}

/** Gewichteter Erwartungswert eines Multiplikators über eine Stufenliste. */
function expectedMultiplier(list) {
  const total = list.reduce((s, e) => s + e.weight, 0);
  return list.reduce((s, e) => s + (e.weight / total) * e.mult, 0);
}

const expectedRarityMultiplier = () => expectedMultiplier(data.RARITIES);
const expectedConditionMultiplier = () => expectedMultiplier(data.CONDITIONS);

/**
 * E[Seltenheit] für die **Preisbildung**: Stufen ab `UNPRICED_FROM` zählen nur
 * mit dem Multiplikator der letzten eingepreisten Stufe. Der Rest ist Bonus
 * (siehe UNPRICED_FROM). Liegt immer unter `expectedRarityMultiplier()`.
 */
function pricedRarityMultiplier() {
  const cut = data.RARITIES.findIndex((r) => r.id === UNPRICED_FROM);
  if (cut < 0) return expectedRarityMultiplier();
  const total = data.RARITIES.reduce((s, r) => s + r.weight, 0);
  const capped = data.RARITIES[cut - 1].mult;
  return data.RARITIES.reduce(
    (s, r, i) => s + (r.weight / total) * (i < cut ? r.mult : capped), 0);
}

/** Anteil des Erwartungswerts, der bewusst nicht eingepreist wird. */
function unpricedShare() {
  return 1 - pricedRarityMultiplier() / expectedRarityMultiplier();
}

/** Erwarteter Wert EINES Objekts – die Grundlage des Startpreises. */
function expectedObjectValue() {
  return objectMean() * pricedRarityMultiplier() * expectedConditionMultiplier();
}

/** Der **volle** Erwartungswert eines Objekts, Jackpot-Tail eingerechnet. */
function expectedObjectValueFull() {
  return objectMean() * expectedRarityMultiplier() * expectedConditionMultiplier();
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
  return countMean * expectedObjectValue() + expectedCash(tier) + tier.carChance * carValue;
}

/**
 * Der **volle** Erwartungswert einer Stufe – inklusive des Jackpot-Tails, der
 * nicht eingepreist wird. Nur so lässt sich beweisen, dass der Startpreis auch
 * darüber liegt (kein Gelddrucker); der Test rechnet damit.
 */
function expectedValueFull(tier, carValue = 0) {
  const countMean = (tier.objectCount[0] + tier.objectCount[1]) / 2;
  return countMean * expectedObjectValueFull() + expectedCash(tier) + tier.carChance * carValue;
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
 * Würfelt EIN Fundobjekt: Basiswert × Seltenheit × Zustand. Seltenheit und
 * Zustand werden mitgeführt (für Anzeige/Flex und späteren Verkaufswert).
 */
function rollObject(random = Math.random) {
  const base = data.weighted(data.OBJECTS, random);
  const rarity = data.weighted(data.RARITIES, random);
  const cond = data.weighted(data.CONDITIONS, random);
  const value = Math.max(1, Math.round(data.between(base.range, random) * rarity.mult * cond.mult));
  return { name: base.name, value, rarity: rarity.id, condition: cond.id };
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
  for (let i = 0; i < k; i++) objects.push(rollObject(random));

  const cash = random() < (tier.cashChance ?? 1)
    ? Math.max(1, Math.round(data.between(cashRange(tier), random))) : 0;

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

  // NICHT sofort aufdecken: die verschlossene Garage wandert ins Inventar des
  // Gewinners. Aufmachen tut er selbst (openGarage) – Storage-Wars-Moment.
  db.addGarage(guildId, winner, label, price, lot.contents, lot.value);
  db.finishLot(guildId, lot.id, 'sold');

  db.createMessage({
    guildId, userId: winner, type: 'info',
    title: `Zuschlag: ${label} für ${price.toLocaleString('de-DE')}`,
    body: 'Die Garage ist noch **verschlossen**. Öffne sie im Auktionshaus unter ' +
      '„Meine Garagen", um zu sehen, was drin steckt!',
    amount: price,
  });

  return { lotId: lot.id, status: 'sold', winner, label, price };
}

/**
 * Öffnet eine ersteigerte, verschlossene Garage und deckt den Inhalt auf:
 * Objekte wandern in die Sammlung, Bargeld/Auto werden materialisiert. Erst
 * lokal entfernen, dann gutschreiben (§7) – ein zweiter Klick findet nichts
 * mehr, also kein doppeltes Aufdecken.
 */
async function openGarage(guildId, userId, garageId) {
  const garage = db.getGarage(guildId, garageId);
  if (!garage || garage.user_id !== userId) return { ok: false, reason: 'not_found' };
  if (!db.removeGarage(guildId, userId, garageId)) return { ok: false, reason: 'not_found' };

  const c = garage.contents;
  for (const o of c.objects || []) {
    db.addLoot(guildId, userId, o.name, o.value, o.rarity, o.condition, null);
  }

  let cashFound = c.cash || 0;
  let carResult = null;
  if (c.car) {
    carResult = await applyCarReward(guildId, userId, c.car);
    if (carResult.cashedOut) cashFound += carResult.value;
  }
  if (cashFound > 0) {
    await changeCash(guildId, userId, cashFound, `Fund: ${garage.label}`).catch(() => {});
  }

  const net = garage.value - garage.price;
  return { ok: true, garage, contents: c, cashFound, carResult, value: garage.value, price: garage.price, net };
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
    lines.push(objs.map((o) => {
      const r = data.rarityOf(o.rarity);
      const c = data.conditionOf(o.condition);
      return `• ${r.emoji} **${o.name}** — _${r.label}, ${c.label}_`;
    }).join('\n'));
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
  UNPRICED_FROM,
  objectMean, expectedMultiplier, expectedRarityMultiplier, expectedConditionMultiplier,
  pricedRarityMultiplier, unpricedShare, cashRange, expectedCash,
  expectedObjectValue, expectedObjectValueFull, expectedValueFull,
  eligibleCars, avgCarValue, expectedValue, startPrice,
  rollObject, rollLot, generateLot, ensureRound, minBid, isLive, placeBid,
  settle, resolveLot, applyCarReward, openGarage, revealBody, sellLoot,
};
