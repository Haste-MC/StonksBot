const db = require('./db');
const condition = require('./condition');
const data = require('./data/npc');
const unb = require('./unb');

const getBalance = (...a) => unb.getBalance(...a);
const changeCash = (...a) => unb.changeCash(...a);
const withdrawFromBank = (...a) => unb.withdrawFromBank(...a);

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Wie viele Anzeigen gleichzeitig stehen dürfen.
 *
 * Eine Spanne statt einer festen Zahl: mal ist der Markt voll, mal steht kaum
 * etwas drin. `min` verhindert nur, dass er komplett leerläuft.
 */
const CAPACITY = {
  car: { min: 2, max: 9 },
  property: { min: 1, max: 6 },
};

/** Wie lange eine Anzeige steht. Kurz genug, dass sich Nachschauen lohnt. */
const LIFETIME = [1.5 * DAY_MS, 4 * DAY_MS];

/**
 * Alle drei Stunden gibt es eine Gelegenheit, dass eine neue Anzeige eingeht –
 * mit dieser Wahrscheinlichkeit. Dadurch tauchen Angebote unregelmäßig auf:
 * mal kommen zwei an einem Abend, mal einen Tag lang keines.
 */
const ARRIVAL_TICK_MS = 3 * 60 * 60 * 1000;
const ARRIVAL_CHANCE = 0.42;

/** Nach längerer Pause nicht unbegrenzt nachholen – sonst platzt der Markt. */
const MAX_TICKS = 16;

/** Anteil der Immobilienanzeigen, die Miete statt Verkauf sind. */
const RENT_SHARE = 0.45;

/**
 * Lässt neue Anzeigen eintrudeln und entfernt Abgelaufenes.
 *
 * Bewusst serverweit (nicht pro Spieler): so entsteht Konkurrenz um die guten
 * Angebote. Wer zuerst schaut, bekommt das Schnäppchen.
 *
 * Wird faul aufgerufen – beim Öffnen der jeweiligen Marktansicht. Die
 * Ankünfte hängen an der vergangenen Zeit, nicht am Öffnen: wer den Markt
 * zehnmal hintereinander aufruft, erzeugt dadurch keine neuen Anzeigen.
 */
function refresh(guildId, kind, now = Date.now(), random = Math.random) {
  db.purgeExpiredNpc(guildId, now);

  const limits = CAPACITY[kind];
  if (!limits) return [];

  const spawn = db.getNpcSpawn(guildId, kind);

  // Beim allerersten Mal den Markt mit einer zufälligen Menge bestücken,
  // damit er nicht leer startet.
  if (!spawn) {
    const initial = limits.min +
      Math.floor(random() * (limits.max - limits.min + 1));
    db.setNpcSpawn(guildId, kind, now);
    return addListings(guildId, kind, initial, now, random);
  }

  let have = db.countNpcListings(guildId, kind, now);
  const elapsed = now - spawn.last_spawn;
  const ticks = Math.min(Math.floor(elapsed / ARRIVAL_TICK_MS), MAX_TICKS);

  // Nur volle Intervalle verbrauchen – der Rest zählt beim nächsten Mal.
  if (ticks > 0) {
    db.setNpcSpawn(guildId, kind, spawn.last_spawn + ticks * ARRIVAL_TICK_MS);
  }

  let wanted = 0;
  for (let t = 0; t < ticks; t++) {
    if (have + wanted >= limits.max) break;
    if (random() < ARRIVAL_CHANCE) wanted++;
  }

  // Untergrenze sichern, damit der Markt nie ganz leer ist.
  if (have + wanted < limits.min) wanted = limits.min - have;

  if (wanted <= 0) return [];
  return addListings(guildId, kind, wanted, now, random);
}

/** Legt bis zu `count` neue Anzeigen an, ohne ein Modell zu wiederholen. */
function addListings(guildId, kind, count, now, random) {
  // Nichts doppelt anbieten – sonst stehen dreimal dieselben Corsas drin.
  const taken = db.npcItemIds(guildId, kind, now);
  const pool = db.allItemsOfKind(guildId, kind).filter((i) => !taken.has(i.id));

  const created = [];
  for (let n = 0; n < count && pool.length > 0; n++) {
    const index = Math.floor(random() * pool.length);
    const [item] = pool.splice(index, 1);
    created.push(generate(guildId, item, kind, now, random));
  }
  return created;
}

/** Erzeugt eine einzelne Anzeige zu einem Artikel. */
function generate(guildId, item, kind, now = Date.now(), random = Math.random) {
  const deal = data.weighted(data.DEALS, random);
  const isRent = kind === 'property' && item.rent > 0 && random() < RENT_SHARE;

  let cond = 100;
  // Mietanzeigen brauchen eigene Begründungen – Verkaufs-Sprüche passen nicht.
  const reasons = isRent ? (data.RENT_REASONS[deal.id] ?? deal.reasons) : deal.reasons;
  let note = data.pick(reasons, random);

  if (kind === 'car') {
    const band = data.weighted(data.CONDITIONS, random);
    cond = Math.round(data.between(band.range, random));
    // Bei sichtbaren Mängeln einen erklärenden Satz anhängen.
    if (cond < 70 && random() < 0.7) {
      note = `${data.pick(data.DAMAGE_NOTES, random)} ${note}`;
    }
  } else if (random() < 0.6) {
    note = `${data.pick(data.PROPERTY_NOTES, random)} ${note}`;
  }

  // Grundlage ist der Zeitwert, nicht der Neupreis – ein Wrack für 90 % vom
  // Neupreis wäre absurd, 90 % vom Zeitwert dagegen ein fairer Preis.
  const base = isRent
    ? item.rent
    : condition.currentValue(item.price, cond);

  const price = Math.max(1, Math.round(base * data.between(deal.range, random)));

  return db.insertNpcListing({
    guildId,
    itemId: item.id,
    kind,
    mode: isRent ? 'rent' : 'sale',
    seller: data.pick(data.SELLERS, random),
    note: note.slice(0, 190),
    price,
    condition: cond,
    deal: deal.id,
    expiresAt: now + data.between(LIFETIME, random),
  });
}

/** Alle aktiven Anzeigen einer Art, frisch aufgefüllt. */
function listings(guildId, kind, now = Date.now()) {
  refresh(guildId, kind, now);
  return db.listNpcListings(guildId, kind, now);
}

/** Beschriftung der Preisstufe (nur zur Anzeige nach dem Kauf). */
function dealLabel(id) {
  return data.DEALS.find((d) => d.id === id)?.label ?? '';
}

// ------------------------------------------------------------------- Kauf

/**
 * Kauft ein Fahrzeug oder eine Immobilie von einem privaten Anbieter.
 * Das Geld verschwindet – der Verkäufer ist kein Spieler.
 */
async function buy(guildId, userId, npcId) {
  const listing = db.getNpcListing(guildId, npcId);
  if (!listing) return { ok: false, reason: 'not_found' };
  if (listing.expires_at <= Date.now()) {
    db.deleteNpcListing(guildId, npcId);
    return { ok: false, reason: 'expired', listing };
  }
  if (listing.mode !== 'sale') return { ok: false, reason: 'not_for_sale', listing };

  if (db.getOwned(guildId, userId, listing.id)) {
    return { ok: false, reason: 'already_owned', listing };
  }

  // Autos brauchen einen Stellplatz.
  if (listing.kind === 'car') {
    const property = require('./property');
    const slots = property.capacity(guildId, userId);
    if (slots.free < 1) {
      return { ok: false, reason: 'no_garage', listing, ...slots };
    }
  }

  const balance = await getBalance(guildId, userId);
  if (balance.total < listing.npc_price) {
    return {
      ok: false, reason: 'insufficient_funds', listing,
      needed: listing.npc_price, have: balance.total,
    };
  }

  // Erst lokal übereignen, dann buchen – bei Fehlschlag ist der lokale
  // Schritt zuverlässig zurückzurollen.
  db.reservePurchase(guildId, userId, listing.id, 1);
  if (listing.kind === 'property') {
    db.stampCountry(guildId, userId, listing.id, require('./home').homeOf(guildId, userId).id);
  }
  db.setCondition(guildId, userId, listing.id, listing.npc_condition);
  db.deleteNpcListing(guildId, npcId);

  let movedFromBank = 0;
  try {
    if (balance.cash < listing.npc_price) {
      movedFromBank = listing.npc_price - balance.cash;
      await withdrawFromBank(guildId, userId, movedFromBank, `Kauf: ${listing.name}`);
    }
    const newBalance = await changeCash(
      guildId, userId, -listing.npc_price, `Privatkauf: ${listing.name}`);

    return { ok: true, listing, newBalance, movedFromBank };
  } catch (err) {
    db.removeCar(guildId, userId, listing.id);
    db.insertNpcListing({
      guildId, itemId: listing.id, kind: listing.kind, mode: listing.mode,
      seller: listing.seller, note: listing.note, price: listing.npc_price,
      condition: listing.npc_condition, deal: listing.deal, expiresAt: listing.expires_at,
    });
    if (movedFromBank > 0) {
      await withdrawFromBank(guildId, userId, -movedFromBank, 'Kauf abgebrochen').catch(() => {});
    }
    throw err;
  }
}

/** Mietet eine Wohnung von einem privaten Anbieter. */
async function rent(guildId, userId, npcId) {
  const listing = db.getNpcListing(guildId, npcId);
  if (!listing) return { ok: false, reason: 'not_found' };
  if (listing.mode !== 'rent') return { ok: false, reason: 'not_for_rent', listing };
  if (listing.expires_at <= Date.now()) {
    db.deleteNpcListing(guildId, npcId);
    return { ok: false, reason: 'expired', listing };
  }

  const existing = db.getRental(guildId, userId);
  if (existing?.item_id === listing.id) {
    return { ok: false, reason: 'already_renting', listing };
  }

  const balance = await getBalance(guildId, userId);
  if (balance.total < listing.npc_price) {
    return {
      ok: false, reason: 'insufficient_funds', listing,
      needed: listing.npc_price, have: balance.total,
    };
  }

  if (balance.cash < listing.npc_price) {
    await withdrawFromBank(
      guildId, userId, listing.npc_price - balance.cash, `Miete: ${listing.name}`);
  }
  const newBalance = await changeCash(
    guildId, userId, -listing.npc_price, `Erste Miete: ${listing.name}`);

  // landlord_id bleibt leer: der Vermieter ist kein Spieler.
  db.startRental(
    guildId, userId, listing.id, Date.now() + DAY_MS, listing.npc_price, '', listing.npc_price);
  db.deleteNpcListing(guildId, npcId);

  const property = require('./property');
  return { ok: true, listing, previous: existing, newBalance, capacity: property.capacity(guildId, userId) };
}

module.exports = {
  CAPACITY, LIFETIME, RENT_SHARE, DAY_MS,
  ARRIVAL_TICK_MS, ARRIVAL_CHANCE, MAX_TICKS,
  refresh, addListings, generate, listings, dealLabel, buy, rent,
};
