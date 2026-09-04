const db = require('./db');
const condition = require('./condition');
// Bewusst das Modul statt einzelner Funktionen: so lassen sich die
// API-Aufrufe im Test ersetzen, ohne echte Anfragen zu schicken.
const unb = require('./unb');

const getBalance = (...a) => unb.getBalance(...a);
const changeCash = (...a) => unb.changeCash(...a);
const withdrawFromBank = (...a) => unb.withdrawFromBank(...a);

/**
 * Stellplätze, die jeder ohne Immobilie hat – Parken auf der Straße.
 * Ohne das könnte man ganz am Anfang gar kein Auto kaufen.
 */
const STREET_SLOTS = 2;

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Wer mehr Autos als Stellplätze hat, bekommt diese Frist, um das selbst zu
 * regeln – verkaufen, eine neue Wohnung mieten, was auch immer. Danach greift
 * der Zwangsverkauf.
 */
const GRACE_DAYS = 7;

/** Erlöse beim Zwangsverkauf: zufällig zwischen 40 % und 95 % des Kaufpreises. */
const FORCED_SALE_MIN = 0.40;
const FORCED_SALE_MAX = 0.95;

/**
 * Garagenkapazität eines Spielers: Straße + gekaufte Immobilien + Mietobjekt.
 * @returns {{capacity: number, used: number, free: number, street: number,
 *            owned: number, rented: number}}
 */
function capacity(guildId, userId) {
  // Nur Immobilien im eigenen Land geben Platz: Wer umgezogen ist, kann in
  // seiner alten Wohnung weder wohnen noch parken (siehe home.js).
  const owned = db.ownedGarageSlots(
    guildId, userId, require('./home').homeOf(guildId, userId).id);
  const rental = db.getRental(guildId, userId);
  const rented = rental ? rental.garage : 0;
  // Erfahrung bringt Platz: ab bestimmten Leveln gibt es einen Stellplatz
  // dazu (siehe perks.js).
  const bonus = require('./perks').perksOf(guildId, userId).slots;
  const total = STREET_SLOTS + owned + rented + bonus;
  const used = db.carsOwned(guildId, userId);

  return {
    capacity: total,
    used,
    free: Math.max(0, total - used),
    street: STREET_SLOTS,
    owned,
    rented,
    bonus,
  };
}

/** Wie viele Exemplare eines Objekts noch frei sind (Mieter zählen mit). */
function available(guildId, item) {
  if (item.stock === null) return Infinity;
  return Math.max(0, item.stock - db.countRentersOf(guildId, item.id));
}

// ------------------------------------------------- Vermietung durch Spieler

/**
 * Bietet eine eigene Immobilie zur Miete an.
 * Die Stellplätze gehen dabei an den Mieter über – wer vermietet, gibt die
 * Garage mit ab und kann dadurch selbst in die Überkapazität rutschen.
 */
function offerForRent(guildId, landlordId, itemId, price) {
  const item = db.getItem(guildId, itemId);
  if (!item || item.kind !== 'property') return { ok: false, reason: 'not_found' };

  const owned = db.getOwned(guildId, landlordId, itemId);
  if (!owned) return { ok: false, reason: 'not_owned', item };

  // Nicht anbieten, was man selbst bewohnt.
  const own = db.getRental(guildId, landlordId);
  if (own?.item_id === itemId) return { ok: false, reason: 'self_rented', item };

  try {
    const offer = db.createOffer(guildId, landlordId, itemId, price);
    return { ok: true, item, offer, capacity: capacity(guildId, landlordId) };
  } catch (err) {
    if (String(err.message).includes('UNIQUE')) return { ok: false, reason: 'already_offered', item };
    throw err;
  }
}

/** Zieht ein eigenes Mietangebot zurück. Läuft ein Vertrag, wird er beendet. */
function withdrawOffer(guildId, landlordId, offerId) {
  const offer = db.getOffer(guildId, offerId);
  if (!offer) return { ok: false, reason: 'not_found' };
  if (offer.landlord_id !== landlordId) return { ok: false, reason: 'not_landlord' };

  // Laufenden Mieter kündigen. Ein Spieler-Mieter bekommt dadurch
  // Überkapazität und die Gnadenfrist; ein NPC verschwindet einfach.
  let evictedTenant = null;
  let evictedName = null;
  for (const rental of db.tenantsOf(guildId, landlordId)) {
    if (rental.item_id === offer.id) {
      evictedTenant = rental.tenant_name ? null : rental.user_id;   // nur echte Spieler pingen
      evictedName = rental.tenant_name || null;
      db.endRental(guildId, rental.user_id);
    }
  }

  db.deleteOffer(guildId, landlordId, offerId);
  return { ok: true, offer, evictedTenant, evictedName, capacity: capacity(guildId, landlordId) };
}

// ------------------------------------------------------------------- Miete

/**
 * Rechnet fällige Miete ab. Wird "faul" aufgerufen – immer dann, wenn der
 * Spieler mit dem Bot interagiert. Dadurch braucht es keinen Hintergrundjob.
 *
 * Kann der Spieler nicht zahlen, verliert er die Wohnung (und deren
 * Stellplätze). Bereits gekaufte Autos bleiben ihm, er kann dann aber erst
 * wieder kaufen, wenn er unter der Kapazität liegt.
 *
 * @returns {Promise<{status:'none'|'ok'|'paid'|'evicted', ...}>}
 */
async function settleRent(guildId, userId, now = Date.now()) {
  const rental = db.getRental(guildId, userId);
  if (!rental) return { status: 'none' };

  const owedMs = now - rental.paid_through;
  if (owedMs < DAY_MS) return { status: 'ok', rental };

  const days = Math.floor(owedMs / DAY_MS);
  // Bei Spieler-Vermietung gilt der vereinbarte Preis, sonst der Katalogwert.
  const daily = rental.agreed_rent || rental.catalog_rent;
  const amount = days * daily;

  const balance = await getBalance(guildId, userId);
  if (balance.total < amount) {
    db.endRental(guildId, userId);
    return { status: 'evicted', rental, days, amount, had: balance.total };
  }

  // Fehlendes Bargeld von der Bank holen.
  if (balance.cash < amount) {
    await withdrawFromBank(guildId, userId, amount - balance.cash, `Miete: ${rental.name}`);
  }
  await changeCash(guildId, userId, -amount, `Miete ${days} Tage: ${rental.name}`);

  // Bei einem Spieler-Vermieter landet die Miete auf dessen Konto.
  if (rental.landlord_id) {
    await changeCash(guildId, rental.landlord_id, amount,
      `Mieteinnahme ${days} Tage: ${rental.name}`).catch(() => {});
  }

  db.extendRental(guildId, userId, rental.paid_through + days * DAY_MS, amount);

  return { status: 'paid', rental, days, amount, daily, landlordId: rental.landlord_id || null };
}

/**
 * Mietet ein von einem Spieler angebotenes Objekt.
 */
async function rentFromPlayer(guildId, userId, offerId) {
  const offer = db.getOffer(guildId, offerId);
  if (!offer) return { ok: false, reason: 'not_found' };
  if (offer.landlord_id === userId) return { ok: false, reason: 'own_offer', item: offer };
  if (db.offerTaken(guildId, offer.id, offer.landlord_id)) {
    return { ok: false, reason: 'unavailable', item: offer };
  }

  const price = offer.offer_price;
  const balance = await getBalance(guildId, userId);
  if (balance.total < price) {
    return { ok: false, reason: 'insufficient_funds', item: offer, needed: price, have: balance.total };
  }

  const existing = db.getRental(guildId, userId);

  if (balance.cash < price) {
    await withdrawFromBank(guildId, userId, price - balance.cash, `Miete: ${offer.name}`);
  }
  const newBalance = await changeCash(guildId, userId, -price, `Erste Miete: ${offer.name}`);
  await changeCash(guildId, offer.landlord_id, price, `Mieteinnahme: ${offer.name}`)
    .catch(() => {});

  db.startRental(guildId, userId, offer.id, Date.now() + DAY_MS, price, offer.landlord_id, price);

  return {
    ok: true, item: offer, previous: existing, newBalance,
    landlordId: offer.landlord_id, capacity: capacity(guildId, userId),
  };
}

/**
 * Mietet ein Objekt. Der erste Tag wird sofort bezahlt.
 */
async function rent(guildId, userId, itemId) {
  const item = db.getItem(guildId, itemId);
  if (!item || item.kind !== 'property') return { ok: false, reason: 'not_found' };
  if (!item.rent) return { ok: false, reason: 'not_rentable', item };

  const existing = db.getRental(guildId, userId);
  if (existing?.item_id === itemId) return { ok: false, reason: 'already_renting', item };

  if (available(guildId, item) <= 0) return { ok: false, reason: 'unavailable', item };

  const balance = await getBalance(guildId, userId);
  if (balance.total < item.rent) {
    return { ok: false, reason: 'insufficient_funds', item, needed: item.rent, have: balance.total };
  }

  if (balance.cash < item.rent) {
    await withdrawFromBank(guildId, userId, item.rent - balance.cash, `Miete: ${item.name}`);
  }
  const newBalance = await changeCash(guildId, userId, -item.rent, `Erste Miete: ${item.name}`);

  db.startRental(guildId, userId, itemId, Date.now() + DAY_MS, item.rent, '', item.rent);

  return { ok: true, item, previous: existing, newBalance, capacity: capacity(guildId, userId) };
}

/** Kündigt das Mietverhältnis. Bereits gezahlte Miete gibt es nicht zurück. */
function cancelRent(guildId, userId) {
  const rental = db.getRental(guildId, userId);
  if (!rental) return { ok: false, reason: 'not_renting' };
  db.endRental(guildId, userId);
  return { ok: true, rental, capacity: capacity(guildId, userId) };
}

// -------------------------------------------------------------------- Kauf

/**
 * Kauft eine Immobilie. Ablauf wie beim Autokauf: erst lokal reservieren,
 * dann Geld buchen, bei Fehlschlag zurückrollen.
 */
async function buy(guildId, userId, itemId) {
  const item = db.getItem(guildId, itemId);
  if (!item || item.kind !== 'property') return { ok: false, reason: 'not_found' };

  const owned = db.getOwned(guildId, userId, itemId);
  if (owned) return { ok: false, reason: 'already_owned', item };

  const balance = await getBalance(guildId, userId);
  if (balance.total < item.price) {
    return { ok: false, reason: 'insufficient_funds', item, needed: item.price, have: balance.total };
  }

  const reserved = db.reservePurchase(guildId, userId, itemId, 1);
  if (!reserved.ok) return { ...reserved, item };

  // Wo das Objekt steht. Ohne diesen Stempel wäre ein Umzug folgenlos.
  db.stampCountry(guildId, userId, itemId, require('./home').homeOf(guildId, userId).id);

  const hadStock = item.stock !== null;
  let movedFromBank = 0;

  try {
    if (balance.cash < item.price) {
      movedFromBank = item.price - balance.cash;
      await withdrawFromBank(guildId, userId, movedFromBank, `Kauf: ${item.name}`);
    }
    const newBalance = await changeCash(guildId, userId, -item.price, `Kauf: ${item.name}`);

    return { ok: true, item, newBalance, movedFromBank, capacity: capacity(guildId, userId) };
  } catch (err) {
    db.releasePurchase(guildId, userId, itemId, 1, hadStock);
    if (movedFromBank > 0) {
      await withdrawFromBank(guildId, userId, -movedFromBank, 'Kauf abgebrochen').catch(() => {});
    }
    throw err;
  }
}

// ------------------------------------------ Überkapazität & Zwangsverkauf

/**
 * Prüft, ob jemand mehr Autos als Stellplätze hat.
 *
 * Beim ersten Mal startet eine Frist von sieben Tagen – Zeit, selbst zu
 * verkaufen oder eine größere Bleibe zu besorgen. Läuft sie ab, werden
 * zufällig so viele Fahrzeuge zwangsverkauft, bis es wieder passt. Der Erlös
 * liegt zwischen 40 % und 95 % des Kaufpreises: Zwangsverkauf lohnt sich nie
 * so gut wie ein selbst gewählter.
 *
 * @returns {Promise<{status:'ok'|'grace_started'|'grace'|'sold', ...}>}
 */
async function enforceCapacity(guildId, userId, now = Date.now()) {
  const slots = capacity(guildId, userId);

  if (slots.used <= slots.capacity) {
    if (db.getGrace(guildId, userId)) db.clearGrace(guildId, userId);
    return { status: 'ok', ...slots };
  }

  const excess = slots.used - slots.capacity;
  const grace = db.getGrace(guildId, userId);

  if (!grace) {
    db.startGrace(guildId, userId, now);
    return {
      status: 'grace_started', excess, ...slots,
      deadline: now + GRACE_DAYS * DAY_MS, days: GRACE_DAYS,
    };
  }

  const deadline = grace.since + GRACE_DAYS * DAY_MS;
  if (now < deadline) {
    return {
      status: 'grace', excess, ...slots, deadline,
      remainingMs: deadline - now,
    };
  }

  // Frist abgelaufen: zufällige Fahrzeuge verkaufen, bis es wieder passt.
  const pool = db.randomCars(guildId, userId);
  const sold = [];
  let toSell = excess;

  for (const car of pool) {
    if (toSell <= 0) break;
    const count = Math.min(toSell, car.quantity);

    for (let i = 0; i < count; i++) {
      const factor = FORCED_SALE_MIN + Math.random() * (FORCED_SALE_MAX - FORCED_SALE_MIN);
      // Ein zerkratzter Wagen bringt auch beim Zwangsverkauf weniger.
      const worth = condition.currentValue(car.price, car.condition ?? 100);
      const amount = Math.max(1, Math.round(worth * factor));

      db.removeCar(guildId, userId, car.id);
      await changeCash(guildId, userId, amount, `Zwangsverkauf: ${car.name}`).catch(() => {});

      sold.push({
        name: car.name,
        original: car.price,
        condition: car.condition ?? 100,
        amount,
        percent: Math.round(factor * 100),
      });
      toSell--;
    }
  }

  db.clearGrace(guildId, userId);

  return {
    status: 'sold', sold,
    total: sold.reduce((s, c) => s + c.amount, 0),
    ...capacity(guildId, userId),
  };
}

module.exports = {
  STREET_SLOTS, DAY_MS, GRACE_DAYS, FORCED_SALE_MIN, FORCED_SALE_MAX,
  capacity, available, settleRent, rent, cancelRent, buy,
  offerForRent, withdrawOffer, rentFromPlayer, enforceCapacity,
};
