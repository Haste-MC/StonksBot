const db = require('./db');
const condition = require('./condition');
const data = require('./data/npc');
const unb = require('./unb');

const changeCash = (...a) => unb.changeCash(...a);

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Interessenten für Inserate von Spielern.
 *
 * ===================== WICHTIGSTE REGEL =====================
 * Ein NPC zahlt NIEMALS mehr als den Zeitwert (Neupreis × Zustand).
 *
 * Ohne diese Obergrenze wäre das Ganze ein Gelddrucker: Auto zum Listenpreis
 * kaufen, überteuert inserieren, warten, Gewinn. Mit ihr ist Verkaufen
 * bestenfalls ein Nullsummengeschäft – also reine Liquidität. Gewinn entsteht
 * nur dadurch, dass man vorher günstig eingekauft hat.
 * ============================================================
 */

/** Ab diesem Verhältnis zum Zeitwert kauft niemand mehr. */
const MAX_RATIO = 1.0;

/** Unterhalb davon ist die Kaufchance maximal – billiger macht es nicht schneller. */
const MIN_RATIO = 0.35;

/** Höchste Kaufwahrscheinlichkeit pro Tag (bei Verramschpreisen). */
const MAX_DAILY_CHANCE = 0.9;

/** Nach längerer Abwesenheit nicht unbegrenzt nachholen. */
const MAX_CATCHUP_DAYS = 14;

/** Wie lange ein Kaufangebot im Postfach gültig bleibt. */
const OFFER_LIFETIME = 2 * DAY_MS;

/** Höchstzahl offener Angebote pro Inserat – kein Postfach-Spam. */
const MAX_OPEN_OFFERS = 2;

/**
 * Kaufwahrscheinlichkeit pro Tag, abhängig vom Verhältnis Preis/Zeitwert.
 * Fällt zum Zeitwert hin auf null: wer den vollen Wert verlangt, wartet ewig.
 */
function saleChancePerDay(ratio) {
  if (ratio >= MAX_RATIO) return 0;
  const t = Math.min(1, Math.max(0, (MAX_RATIO - ratio) / (MAX_RATIO - MIN_RATIO)));
  return MAX_DAILY_CHANCE * Math.pow(t, 1.3);
}

/**
 * Wahrscheinlichkeit für ein Kaufangebot (statt eines direkten Kaufs).
 * Steigt mit dem Preis: je überzogener das Inserat, desto eher versucht
 * jemand zu handeln, statt einfach zu zahlen.
 */
function offerChancePerDay(ratio) {
  const t = Math.min(1, Math.max(0, (ratio - 0.65) / 0.75));
  return 0.30 * t;
}

/**
 * Wie viel ein Interessent zu zahlen bereit ist.
 * Immer unter dem geforderten Preis UND unter dem Zeitwert – beides zusammen
 * macht ein Angebot nie zum Geschäft auf Kosten des Systems.
 */
function offerAmount(askingPrice, worth, random = Math.random) {
  const haggled = askingPrice * (0.62 + random() * 0.28);
  const ceiling = worth * (0.70 + random() * 0.30);
  return Math.max(1, Math.round(Math.min(haggled, ceiling)));
}

/** Zeitwert eines Inserats. Immobilien haben keinen Zustand. */
function worthOf(listing) {
  if (listing.kind === 'car') {
    return condition.currentValue(listing.price, listing.listing_condition ?? 100);
  }
  return listing.price;
}

/**
 * Prüft die Inserate eines Spielers auf Interessenten.
 *
 * Läuft faul mit: die vergangenen Tage seit der letzten Prüfung werden
 * nachgeholt. Wiederholtes Aufrufen bringt also nichts.
 *
 * @returns {Promise<{sold: Array, offers: Array}>}
 */
async function settleListings(guildId, userId, now = Date.now(), random = Math.random) {
  db.expireMessages(guildId, now);

  const listings = db.ownListings(guildId, userId);
  const sold = [];
  const offers = [];

  for (const listing of listings) {
    // Beim ersten Mal nur den Zeitpunkt setzen – kein rückwirkendes Nachholen.
    const since = listing.checked_at || listing.created_at;
    const elapsedDays = Math.floor((now - since) / DAY_MS);
    if (elapsedDays < 1) continue;

    const days = Math.min(elapsedDays, MAX_CATCHUP_DAYS);
    db.touchListing(guildId, listing.listing_id, now);

    const worth = worthOf(listing);
    const ratio = listing.listing_price / Math.max(1, worth);
    const buyChance = saleChancePerDay(ratio);
    const offerChance = offerChancePerDay(ratio);

    let done = false;
    for (let d = 0; d < days && !done; d++) {
      if (buyChance > 0 && random() < buyChance) {
        const result = await completeSale(guildId, userId, listing, random);
        if (result) { sold.push(result); done = true; }
        continue;
      }

      if (random() < offerChance) {
        const made = makeOffer(guildId, userId, listing, worth, now, random);
        if (made) offers.push(made);
      }
    }
  }

  return { sold, offers };
}

/** Ein NPC kauft das Inserat zum geforderten Preis. */
async function completeSale(guildId, sellerId, listing, random = Math.random) {
  const taken = db.takeListing(guildId, `npc:${listing.listing_id}`, listing.listing_id);
  if (!taken.ok) return null;

  // Der Käufer ist kein Spieler – der Artikel verschwindet einfach.
  db.removeCar(guildId, `npc:${listing.listing_id}`, listing.id);
  db.cancelOffersFor(guildId, listing.listing_id);

  const buyer = data.pick(data.SELLERS, random);
  await changeCash(guildId, sellerId, listing.listing_price,
    `Verkauf: ${listing.name}`).catch(() => {});

  db.createMessage({
    guildId, userId: sellerId, type: 'sold',
    title: `Verkauft: ${listing.name}`,
    body: `${buyer} hat dein Inserat zum geforderten Preis übernommen.`,
    sender: buyer,
    amount: listing.listing_price,
    itemId: listing.id,
  });

  return { name: listing.name, price: listing.listing_price, buyer };
}

/** Ein NPC macht ein Gegenangebot, das im Postfach landet. */
function makeOffer(guildId, sellerId, listing, worth, now, random = Math.random) {
  const open = db.listMessages(guildId, sellerId, 1).items
    .filter((m) => m.type === 'offer' && m.listing_id === listing.listing_id).length;
  if (open >= MAX_OPEN_OFFERS) return null;

  const amount = offerAmount(listing.listing_price, worth, random);
  // Ein Angebot über dem geforderten Preis wäre unsinnig.
  if (amount >= listing.listing_price) return null;

  const buyer = data.pick(data.SELLERS, random);
  const percent = Math.round((amount / listing.listing_price) * 100);

  db.createMessage({
    guildId, userId: sellerId, type: 'offer',
    title: `Angebot für ${listing.name}`,
    body: `${buyer} bietet ${percent} % deines Preises. Annehmen oder ablehnen?`,
    sender: buyer,
    amount,
    itemId: listing.id,
    listingId: listing.listing_id,
    expiresAt: now + OFFER_LIFETIME,
  });

  return { name: listing.name, amount, buyer };
}

/**
 * Nimmt ein Kaufangebot an. Der Artikel geht weg, das Geld kommt rein.
 */
async function acceptOffer(guildId, userId, messageId) {
  const message = db.getMessage(guildId, messageId);
  if (!message || message.user_id !== userId) return { ok: false, reason: 'not_found' };
  if (message.resolved) return { ok: false, reason: 'already_resolved' };
  if (message.type !== 'offer') return { ok: false, reason: 'not_an_offer' };
  if (message.expires_at && message.expires_at <= Date.now()) {
    db.resolveMessage(guildId, messageId, 'expired');
    return { ok: false, reason: 'expired' };
  }

  const listing = db.getListing(guildId, message.listing_id);
  if (!listing) {
    db.resolveMessage(guildId, messageId, 'expired');
    return { ok: false, reason: 'listing_gone' };
  }

  const taken = db.takeListing(guildId, `npc:${message.listing_id}`, message.listing_id);
  if (!taken.ok) {
    db.resolveMessage(guildId, messageId, 'expired');
    return { ok: false, reason: 'listing_gone' };
  }
  db.removeCar(guildId, `npc:${message.listing_id}`, listing.id);

  const balance = await changeCash(
    guildId, userId, message.amount, `Verkauf: ${listing.name}`);

  db.resolveMessage(guildId, messageId, 'accepted');
  db.cancelOffersFor(guildId, message.listing_id);

  return { ok: true, message, listing, amount: message.amount, balance };
}

/** Lehnt ein Angebot ab. Das Inserat bleibt bestehen. */
function declineOffer(guildId, userId, messageId) {
  const message = db.getMessage(guildId, messageId);
  if (!message || message.user_id !== userId) return { ok: false, reason: 'not_found' };
  if (message.resolved) return { ok: false, reason: 'already_resolved' };
  db.resolveMessage(guildId, messageId, 'declined');
  return { ok: true, message };
}

module.exports = {
  MAX_RATIO, MIN_RATIO, MAX_DAILY_CHANCE, MAX_CATCHUP_DAYS,
  OFFER_LIFETIME, MAX_OPEN_OFFERS, DAY_MS,
  saleChancePerDay, offerChancePerDay, offerAmount, worthOf,
  settleListings, completeSale, makeOffer, acceptOffer, declineOffer,
};
