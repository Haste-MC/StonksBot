const db = require('./db');
const data = require('./data/npc');
const unb = require('./unb');

const changeCash = (...a) => unb.changeCash(...a);

const DAY_MS = 24 * 60 * 60 * 1000;

/** Präfix der synthetischen Mieter-IDs. Reale Discord-IDs sind rein numerisch. */
const NPC_PREFIX = 'npc-tenant:';

/** Nach längerer Abwesenheit nicht unbegrenzt nachholen. */
const MAX_CATCHUP_DAYS = 14;

/**
 * ===================== EXPLOIT-SCHUTZ =====================
 * Ein NPC-Mieter zieht nur ein, wenn die geforderte Miete höchstens das
 * 1,5-fache der marktüblichen Miete beträgt. Darüber findet sich niemand.
 *
 * Ohne diese Grenze wäre Vermieten ein Gelddrucker: billige Wohnung kaufen,
 * für 1.000.000/Tag inserieren, NPC zahlt, Profit. Mit ihr ist die
 * Mieteinnahme eine langsame Rendite auf ein großes, gebundenes Investment
 * (Kaufpreis ≈ 350 × Tagesmiete) – wie in echt, kein Glitch.
 * ==========================================================
 */
const MAX_RENT_RATIO = 1.5;

/** Wahrscheinlichkeit pro Tag, dass ein NPC in ein freies Angebot einzieht. */
function moveInChancePerDay(ratio) {
  if (ratio > MAX_RENT_RATIO) return 0;              // zu teuer – niemand zieht ein
  const t = clamp((MAX_RENT_RATIO - ratio) / (MAX_RENT_RATIO - 0.5));
  return 0.05 + 0.20 * t;                            // 5 % (fair) bis 25 % (billig)
}

/** Wahrscheinlichkeit pro Tag, dass ein NPC-Mieter auszieht. */
function moveOutChancePerDay(ratio) {
  const over = clamp((ratio - 1.0) / 0.5);           // je teurer, desto eher weg
  return 0.015 + 0.05 * over;                        // 1,5 % (fair) bis 6,5 %
}

function clamp(t) {
  return Math.min(1, Math.max(0, t));
}

const isNpcTenant = (userId) => String(userId).startsWith(NPC_PREFIX);

/**
 * Prüft die Mietangebote eines Vermieters: rechnet Mieteinnahmen ab, lässt
 * NPC-Mieter ein- und ausziehen.
 *
 * Läuft faul und zeitbasiert: die vergangenen Tage seit der letzten Prüfung
 * werden nachgeholt, wiederholtes Aufrufen bringt nichts.
 *
 * @returns {Promise<{income:number, movedIn:Array, movedOut:Array}>}
 */
async function settleLandlord(guildId, landlordId, now = Date.now(), random = Math.random) {
  const offers = db.listOffersOf(guildId, landlordId);
  let income = 0;
  const movedIn = [];
  const movedOut = [];

  for (const offer of offers) {
    const catalogRent = offer.rent || 1;
    const ratio = offer.offer_price / catalogRent;

    // Beim ersten Mal nur den Zeitpunkt setzen – kein rückwirkendes Nachholen.
    const since = offer.checked_at || 0;
    if (since === 0) {
      db.touchOffer(guildId, offer.offer_id, now);
      continue;
    }

    const elapsedDays = Math.floor((now - since) / DAY_MS);
    if (elapsedDays < 1) continue;

    const days = Math.min(elapsedDays, MAX_CATCHUP_DAYS);
    db.touchOffer(guildId, offer.offer_id, since + days * DAY_MS);

    const npcUser = `${NPC_PREFIX}${offer.offer_id}`;
    let tenant = db.tenantOfOffer(guildId, offer.id, landlordId);

    // Ein Spieler-Mieter wird nicht angefasst – der rechnet seine Miete selbst ab.
    if (tenant && !isNpcTenant(tenant.user_id)) continue;

    for (let d = 0; d < days; d++) {
      if (tenant) {
        // Tagesmiete an den Vermieter.
        await changeCash(guildId, landlordId, offer.offer_price,
          `Mieteinnahme: ${offer.name}`).catch(() => {});
        income += offer.offer_price;

        if (random() < moveOutChancePerDay(ratio)) {
          db.endRental(guildId, npcUser);
          movedOut.push({ name: offer.name, tenant: tenant.tenant_name || 'Der Mieter' });
          db.createMessage({
            guildId, userId: landlordId, type: 'info',
            title: `Ausgezogen: ${offer.name}`,
            body: `${tenant.tenant_name || 'Dein Mieter'} hat gekündigt. ` +
              'Das Objekt steht wieder zur Vermietung frei.',
            sender: tenant.tenant_name || '',
            itemId: offer.id,
          });
          tenant = null;
        }
      } else {
        // Freies Angebot: zieht jemand ein?
        if (random() < moveInChancePerDay(ratio)) {
          const name = data.pick(data.SELLERS, random);
          db.startRental(
            guildId, npcUser, offer.id, now, 0, landlordId, offer.offer_price);
          db.setTenantName(guildId, npcUser, name);
          tenant = { user_id: npcUser, tenant_name: name };

          // Erste Tagesmiete direkt bei Einzug.
          await changeCash(guildId, landlordId, offer.offer_price,
            `Mieteinnahme: ${offer.name}`).catch(() => {});
          income += offer.offer_price;

          movedIn.push({ name: offer.name, tenant: name });
          db.createMessage({
            guildId, userId: landlordId, type: 'info',
            title: `Neuer Mieter: ${offer.name}`,
            body: `${name} ist eingezogen und zahlt ` +
              `${offer.offer_price} pro Tag.`,
            sender: name,
            itemId: offer.id,
          });
        }
      }
    }
  }

  return { income, movedIn, movedOut };
}

module.exports = {
  DAY_MS, NPC_PREFIX, MAX_CATCHUP_DAYS, MAX_RENT_RATIO, isNpcTenant,
  moveInChancePerDay, moveOutChancePerDay, settleLandlord,
};
