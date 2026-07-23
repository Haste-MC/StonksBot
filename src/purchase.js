const db = require('./db');
// Spät gebunden statt destrukturiert, damit die API-Aufrufe im Test
// ersetzbar bleiben (siehe src/property.js).
const unb = require('./unb');
const property = require('./property');

const getBalance = (...a) => unb.getBalance(...a);
const changeCash = (...a) => unb.changeCash(...a);
const withdrawFromBank = (...a) => unb.withdrawFromBank(...a);

/**
 * Prüft, ob noch Stellplätze frei sind. Gilt nur für Autos – Ausrüstung
 * und Immobilien brauchen keine Garage.
 */
function garageCheck(guildId, userId, item, quantity) {
  if (item.kind !== 'car') return null;
  const slots = property.capacity(guildId, userId);
  if (slots.free < quantity) {
    return { ok: false, reason: 'no_garage', item, ...slots, needed: quantity };
  }
  return null;
}

/**
 * Kauf: Artikel kommt aus der lokalen Datenbank, bezahlt wird mit echtem
 * UnbelievaBoat-Guthaben.
 *
 * Reihenfolge ist bewusst gewählt: erst lokal reservieren (Lager + Inventar),
 * dann das Geld buchen. Scheitert die Geldbuchung, lässt sich die lokale
 * Reservierung zuverlässig zurücknehmen – umgekehrt wäre eine fehlgeschlagene
 * Rückerstattung über die API nicht garantiert.
 *
 * @param {boolean} allowBank Bei zu wenig Bargeld automatisch von der Bank abheben.
 */
async function buy(guildId, userId, itemId, quantity = 1, allowBank = true) {
  const item = db.getItem(guildId, itemId);
  if (!item) return { ok: false, reason: 'not_found' };

  // Jeder Wagen hat seinen eigenen Zustand – der hängt am Besitzeintrag.
  // Deshalb gibt es jedes Modell nur einmal pro Spieler.
  if (item.kind === 'car') {
    if (quantity > 1) return { ok: false, reason: 'single_only', item };
    if (db.getOwned(guildId, userId, itemId)) {
      return { ok: false, reason: 'already_owned', item };
    }
  }

  const totalPrice = item.price * quantity;

  const blocked = garageCheck(guildId, userId, item, quantity);
  if (blocked) return blocked;

  const balance = await getBalance(guildId, userId);
  const funds = allowBank ? balance.total : balance.cash;
  if (funds < totalPrice) {
    return { ok: false, reason: 'insufficient_funds', item, needed: totalPrice, have: funds };
  }

  // 1) Lokal reservieren (atomar: Lagerbestand + Inventar).
  const reserved = db.reservePurchase(guildId, userId, itemId, quantity);
  if (!reserved.ok) return { ...reserved, item };

  const hadStock = item.stock !== null;
  let movedFromBank = 0;

  try {
    // 2) Falls nicht genug Bargeld: fehlenden Teil von der Bank holen.
    if (balance.cash < totalPrice) {
      movedFromBank = totalPrice - balance.cash;
      await withdrawFromBank(guildId, userId, movedFromBank, `Kauf: ${quantity}x ${item.name}`);
    }

    // 3) Preis abbuchen.
    const newBalance = await changeCash(
      guildId, userId, -totalPrice, `Kauf: ${quantity}x ${item.name}`);

    return { ok: true, item, quantity, totalPrice, movedFromBank, newBalance };
  } catch (err) {
    // Geldbuchung fehlgeschlagen -> lokale Reservierung zurücknehmen.
    db.releasePurchase(guildId, userId, itemId, quantity, hadStock);
    // Eine bereits erfolgte Bankabhebung ebenfalls rückgängig machen.
    if (movedFromBank > 0) {
      await withdrawFromBank(guildId, userId, -movedFromBank, 'Kauf abgebrochen').catch(() => {});
    }
    throw err;
  }
}

/**
 * Kauf eines Gebrauchtwagens von einem anderen Spieler.
 * Der Kaufpreis wandert vom Käufer zum Verkäufer.
 */
async function buyUsed(guildId, buyerId, listingId) {
  const listing = db.getListing(guildId, listingId);
  if (!listing) return { ok: false, reason: 'not_found' };
  if (listing.seller_id === buyerId) return { ok: false, reason: 'own_listing', listing };

  const price = listing.listing_price;

  // Auch Gebrauchtwagen brauchen einen Stellplatz.
  const blocked = garageCheck(guildId, buyerId, { kind: listing.kind ?? 'car' }, 1);
  if (blocked) return { ...blocked, listing };

  // Auch gebraucht gilt: jedes Modell nur einmal.
  if (listing.kind === 'car' && db.getOwned(guildId, buyerId, listing.id)) {
    return { ok: false, reason: 'already_owned', listing };
  }

  const balance = await getBalance(guildId, buyerId);
  if (balance.total < price) {
    return { ok: false, reason: 'insufficient_funds', listing, needed: price, have: balance.total };
  }

  // 1) Auto lokal übereignen und Inserat entfernen (atomar).
  const taken = db.takeListing(guildId, buyerId, listingId);
  if (!taken.ok) return { ...taken, listing };

  let movedFromBank = 0;
  let charged = false;

  try {
    // 2) Fehlendes Bargeld von der Bank des Käufers holen.
    if (balance.cash < price) {
      movedFromBank = price - balance.cash;
      await withdrawFromBank(guildId, buyerId, movedFromBank, `Kauf: ${listing.name}`);
    }

    // 3) Käufer belasten.
    const newBalance = await changeCash(guildId, buyerId, -price, `Kauf: ${listing.name}`);
    charged = true;

    // 4) Verkäufer gutschreiben.
    await changeCash(guildId, listing.seller_id, price, `Verkauf: ${listing.name}`);

    return { ok: true, listing, price, movedFromBank, newBalance };
  } catch (err) {
    // Rückabwicklung in umgekehrter Reihenfolge.
    db.restoreListing(guildId, buyerId, listing);
    if (charged) {
      // xp:false – die Belastung wurde nie wirksam, also darf die Rückerstattung
      // keine Erfahrung/Einnahme buchen (sonst Doppelzählung).
      await changeCash(guildId, buyerId, price, 'Kauf abgebrochen', { xp: false }).catch(() => {});
    }
    if (movedFromBank > 0) {
      await withdrawFromBank(guildId, buyerId, -movedFromBank, 'Kauf abgebrochen').catch(() => {});
    }
    throw err;
  }
}

module.exports = { buy, buyUsed };
