const db = require('./db');
const condition = require('./condition');
// Spät gebunden, damit Tests die Geldschnittstelle ersetzen können (§8).
const unb = require('./unb');

const getBalance = (...a) => unb.getBalance(...a);
const changeCash = (...a) => unb.changeCash(...a);
const withdrawFromBank = (...a) => unb.withdrawFromBank(...a);

/**
 * ===========================================================================
 *  WERKSTATT – beschädigte Autos wieder aufbauen
 * ===========================================================================
 *
 * Autos verlieren auf der Straße Zustand (siehe street.js) und damit Wert.
 * Bisher war das eine Einbahnstraße: einmal zerkratzt, für immer zerkratzt.
 * Die Werkstatt dreht das um – gegen Geld.
 *
 * ===================== WICHTIGSTE REGEL =====================
 * Eine Reparatur kostet IMMER mehr, als sie an Wert zurückbringt.
 *
 * Sonst wäre sie ein Gelddrucker (ARCHITEKTUR §3): Schrottwagen billig
 * kaufen, reparieren, zum Zeitwert verkaufen, Gewinn. Mit dem Aufschlag ist
 * Reparieren ein **Geldsenke** – man kauft sich Erhalt, Prestige und einen
 * höheren Wiederverkaufspreis, aber nie einen Gewinn.
 *
 * Bewiesen wird das in test/workshop.test.js über zufällige Preise,
 * Zustände und Stufen – nicht behauptet.
 * ============================================================
 *
 * Die Stufen sind bewusst grob: man wählt ein **Ziel**, keinen Betrag. Das
 * passt zur Anzeige (die Zustandsstufen aus condition.js kennt der Spieler
 * schon) und macht den Preis vorhersehbar.
 *
 * Nach oben gedeckelt ist der Preis trotzdem: **nie mehr als der Neupreis**.
 * Ein Schrotthaufen ist nur noch 30 % wert, die Lücke bis 100 % ist also
 * riesig – ohne Deckel käme bei einer Restaurierung eine Rechnung über dem
 * Neuwagenpreis heraus, und die würde niemand mehr ernst nehmen. Der Deckel
 * kann die Regel oben nicht verletzen: der Zeitwert liegt immer unter dem
 * Neupreis, der Zuwachs damit erst recht.
 */

/**
 * Die Ausbaustufen. `target` ist der Zustand, auf den der Wagen gebracht wird;
 * `markup` der Aufschlag auf den reinen Wertzuwachs.
 *
 * Der Aufschlag steigt mit dem Ziel: die letzten Prozente sind – wie in echt –
 * die teuersten. Wer nur wieder fahrbar sein will, kommt günstig weg;
 * Neuwagenzustand ist Luxus.
 *
 * Die Aufschläge sind bewusst knapp über 1 gewählt: Das Teure an einer
 * Reparatur ist der **Wertzuwachs selbst**, nicht die Marge. Bei einem Ziel
 * von 100 % holt man einen Wagen aus dem Restwert (30 %) zurück auf den
 * vollen – das sind bis zu 70 % des Neupreises, die die Rechnung tragen muss.
 * Weiter senken lässt sich der Preis deshalb nicht, ohne die Regel oben zu
 * brechen: Unterhalb des Zuwachses wäre die Werkstatt ein Gelddrucker.
 */
const TIERS = [
  {
    id: 'clean',
    label: 'Aufbereitung',
    emoji: '🧽',
    target: 55,
    markup: 1.04,
    blurb: 'Waschen, polieren, Diebstahlsicherung – das Gröbste raus.',
  },
  {
    id: 'fix',
    label: 'Instandsetzung',
    emoji: '🔧',
    target: 80,
    markup: 1.07,
    blurb: 'Dellen, Lack und Technik: der Wagen ist wieder in gutem Zustand.',
  },
  {
    id: 'resto',
    label: 'Restaurierung',
    emoji: '✨',
    target: condition.MAX,
    markup: 1.09,
    blurb: 'Volle Wiederherstellung ab Werk – teuer, aber wie neu.',
  },
];

/** Werkstattpauschale: fällt zusätzlich zum Aufschlag an. */
const FEE_RATIO = 0.005;
const MIN_FEE = 150;

/** Grundgebühr für einen Auftrag – bei teuren Wagen arbeitet niemand billiger. */
function fee(price) {
  return Math.max(MIN_FEE, Math.round(price * FEE_RATIO));
}

function findTier(tierId) {
  return TIERS.find((t) => t.id === tierId) ?? null;
}

/**
 * Kostenvoranschlag für eine Stufe.
 *
 * @returns {null|{tier,from,to,before,after,gain,fee,cost,possible}}
 *   `null` bei unbekannter Stufe. `possible: false` heißt: der Wagen ist
 *   schon mindestens so gut – dann gibt es nichts zu tun.
 */
function quote(price, current, tierId) {
  const tier = findTier(tierId);
  if (!tier) return null;

  const from = condition.clamp(current);
  const to = tier.target;
  const before = condition.currentValue(price, from);
  const after = condition.currentValue(price, to);
  const gain = Math.max(0, after - before);
  const workFee = fee(price);

  return {
    tier,
    from,
    to,
    before,
    after,
    gain,
    fee: workFee,
    // Aufgerundet plus Pauschale: der Preis liegt damit auch bei
    // Cent-Beträgen garantiert über dem Wertzuwachs. Der Deckel (Neupreis)
    // greift nur bei sehr kaputten oder sehr billigen Wagen.
    cost: Math.min(price, Math.ceil(gain * tier.markup) + workFee),
    possible: to > from,
  };
}

/** Alle Stufen mit Kostenvoranschlag – für die Anzeige. */
function quotes(price, current) {
  return TIERS.map((t) => quote(price, current, t.id));
}

/**
 * Beauftragt eine Reparatur.
 *
 * Reihenfolge wie beim Kauf (§9), nur umgekehrt gewichtet: Der neue Zustand
 * wird **synchron gesetzt, bevor der erste `await` kommt**. Ein zweiter,
 * schneller Klick findet den Wagen dann schon repariert vor und wird mit
 * `already_good` abgewiesen – so kann die Rechnung nicht doppelt kommen (§7).
 * Scheitert danach die Geldbuchung, wird der alte Zustand zurückgeschrieben.
 *
 * @param {boolean} allowBank Bei zu wenig Bargeld automatisch von der Bank holen.
 */
async function repair(guildId, userId, itemId, tierId, allowBank = true) {
  const tier = findTier(tierId);
  if (!tier) return { ok: false, reason: 'bad_tier' };

  const car = db.getOwned(guildId, userId, itemId);
  if (!car) return { ok: false, reason: 'not_owned' };
  if (car.kind !== 'car') return { ok: false, reason: 'not_a_car', item: car };

  const q = quote(car.price, car.condition, tierId);
  if (!q.possible) return { ok: false, reason: 'already_good', item: car, quote: q };

  // Synchron reservieren (siehe oben) – ab hier gehört der Auftrag uns.
  db.setCondition(guildId, userId, itemId, q.to);

  let movedFromBank = 0;

  try {
    const balance = await getBalance(guildId, userId);
    const funds = allowBank ? balance.total : balance.cash;

    if (funds < q.cost) {
      db.setCondition(guildId, userId, itemId, q.from);
      return {
        ok: false, reason: 'insufficient_funds', item: car, quote: q,
        needed: q.cost, have: funds,
      };
    }

    // Fehlendes Bargeld von der Bank holen.
    if (balance.cash < q.cost) {
      movedFromBank = q.cost - balance.cash;
      await withdrawFromBank(guildId, userId, movedFromBank, `Werkstatt: ${car.name}`);
    }

    const newBalance = await changeCash(
      guildId, userId, -q.cost, `Werkstatt: ${car.name} (${q.from} % → ${q.to} %)`);

    return { ok: true, item: car, quote: q, cost: q.cost, movedFromBank, newBalance };
  } catch (err) {
    // Geld nicht gebucht -> Reparatur zurücknehmen.
    db.setCondition(guildId, userId, itemId, q.from);
    if (movedFromBank > 0) {
      await withdrawFromBank(guildId, userId, -movedFromBank, 'Werkstatt abgebrochen')
        .catch(() => {});
    }
    throw err;
  }
}

// ===========================================================================
//  SELBER SCHRAUBEN
// ===========================================================================
//
// Wer Werkzeug besitzt, soll es benutzen können, statt es nur als
// Job-Voraussetzung im Schrank zu haben. Mit dem **Werkzeugkasten** repariert
// man selbst und zahlt nur noch Material – die Werkstattmarge entfällt.
//
// ===================== DIE REGEL BLEIBT =====================
// Auch selbst geschraubt kostet eine Reparatur **mehr, als sie an Wert
// zurückbringt**. Sonst wäre der Weg offen: Wrack billig kaufen, selbst
// herrichten, zum Zeitwert verkaufen, Gewinn (ARCHITEKTUR §3). Der Aufschlag
// ist nur kleiner als in der Werkstatt, nie kleiner als 1.
// ============================================================
//
// Zusätzliches Werkzeug macht die Sache besser: Die Hebebühne senkt den
// Materialaufschlag weiter, das Diagnosegerät verhindert Pfusch.

/** Ohne das geht gar nichts. */
const BASE_TOOL = 'Werkzeugkasten';

/** Werkzeug, das die Sache verbessert: Name -> Wirkung. */
const EXTRA_TOOLS = [
  { name: 'Hebebühne', markup: -0.02, botch: -0.10, note: 'Hebebühne spart Material' },
  { name: 'Diagnosegerät', markup: -0.005, botch: -0.15, note: 'Diagnosegerät findet den Fehler sofort' },
  { name: 'Schweißgerät', markup: -0.01, botch: -0.05, note: 'Schweißgerät für die Karosserie' },
];

/** Materialaufschlag ohne Zusatzwerkzeug – knapp, aber über 1. */
const SELF_MARKUP = 1.03;

/** So weit darf der Aufschlag höchstens sinken. NIE auf oder unter 1. */
const SELF_MARKUP_FLOOR = 1.005;

/** Grundchance, dass etwas schiefgeht. */
const BOTCH_CHANCE = 0.25;

/** Bei Pfusch erreichst du nur diesen Anteil des Zielzustands. */
const BOTCH_KEEP = [0.4, 0.75];

/** Pause zwischen zwei Eigenreparaturen – Schrauben dauert. */
const COOLDOWN_MS = 45 * 60 * 1000;

/** Chance, dabei den Werkzeugkasten zu ruinieren. */
const TOOL_BREAK_CHANCE = 0.02;

/** Welches Werkzeug jemand hat und was es bringt. */
function toolsOf(guildId, userId) {
  const db2 = require('./db');
  const base = Boolean(db2.ownsNamed(guildId, userId, BASE_TOOL));
  const extras = EXTRA_TOOLS.filter((t) => db2.ownsNamed(guildId, userId, t.name));

  const markup = Math.max(
    SELF_MARKUP_FLOOR,
    SELF_MARKUP + extras.reduce((s, t) => s + t.markup, 0));
  const botch = Math.max(0.02, BOTCH_CHANCE + extras.reduce((s, t) => s + t.botch, 0));

  return { base, extras, markup, botch };
}

/** Kostenvoranschlag fürs Selberschrauben (Material statt Werkstattpreis). */
function selfQuote(guildId, userId, price, current, tierId) {
  const est = quote(price, current, tierId);
  if (!est) return null;

  const tools = toolsOf(guildId, userId);
  const cost = Math.min(price, Math.ceil(est.gain * tools.markup) + fee(price));

  return { ...est, cost, tools, saved: Math.max(0, est.cost - cost) };
}

/** Wie lange noch bis zur nächsten Eigenreparatur? */
function selfRemainingMs(guildId, userId, now = Date.now()) {
  const claim = require('./db').getClaim(guildId, userId, 'wrench');
  if (!claim) return 0;
  return Math.max(0, claim.claimed_at + COOLDOWN_MS - now);
}

/**
 * Selbst reparieren.
 *
 * Dieselbe Reihenfolge wie in der Werkstatt (§7/§9): Zustand synchron setzen,
 * dann buchen, bei Fehlschlag zurückrollen. Zusätzlich kann es misslingen –
 * dann steigt der Zustand nur teilweise, das Material ist aber bezahlt.
 */
async function selfRepair(guildId, userId, itemId, tierId, now = Date.now(), random = Math.random) {
  const tier = findTier(tierId);
  if (!tier) return { ok: false, reason: 'bad_tier' };

  const tools = toolsOf(guildId, userId);
  if (!tools.base) return { ok: false, reason: 'no_tools', needs: BASE_TOOL };

  const left = selfRemainingMs(guildId, userId, now);
  if (left > 0) return { ok: false, reason: 'cooldown', remainingMs: left };

  const car = db.getOwned(guildId, userId, itemId);
  if (!car) return { ok: false, reason: 'not_owned' };
  if (car.kind !== 'car') return { ok: false, reason: 'not_a_car', item: car };

  const q = selfQuote(guildId, userId, car.price, car.condition, tierId);
  if (!q.possible) return { ok: false, reason: 'already_good', item: car, quote: q };

  // Pfusch: Der Zustand steigt nur teilweise – nie mehr als bezahlt.
  const botched = random() < tools.botch;
  const reached = botched
    ? condition.clamp(q.from + (q.to - q.from) *
        (BOTCH_KEEP[0] + random() * (BOTCH_KEEP[1] - BOTCH_KEEP[0])))
    : q.to;

  db.setClaim(guildId, userId, 'wrench', now);
  db.setCondition(guildId, userId, itemId, reached);

  let movedFromBank = 0;
  try {
    const balance = await getBalance(guildId, userId);
    if (balance.total < q.cost) {
      db.setCondition(guildId, userId, itemId, q.from);
      db.clearClaim(guildId, userId, 'wrench');
      return {
        ok: false, reason: 'insufficient_funds', item: car, quote: q,
        needed: q.cost, have: balance.total,
      };
    }

    if (balance.cash < q.cost) {
      movedFromBank = q.cost - balance.cash;
      await withdrawFromBank(guildId, userId, movedFromBank, `Material: ${car.name}`);
    }
    const newBalance = await changeCash(
      guildId, userId, -q.cost, `Selbst repariert: ${car.name} (${q.from} % → ${reached} %)`);

    const brokeTool = random() < TOOL_BREAK_CHANCE
      ? db.consumeNamed(guildId, userId, BASE_TOOL) : false;

    return {
      ok: true, item: car, quote: q, cost: q.cost, reached, botched, tools,
      saved: q.saved, movedFromBank, newBalance, brokeTool,
    };
  } catch (err) {
    db.setCondition(guildId, userId, itemId, q.from);
    db.clearClaim(guildId, userId, 'wrench');
    if (movedFromBank > 0) {
      await withdrawFromBank(guildId, userId, -movedFromBank, 'Reparatur abgebrochen').catch(() => {});
    }
    throw err;
  }
}

module.exports = {
  TIERS, FEE_RATIO, MIN_FEE, fee, findTier, quote, quotes, repair,
  BASE_TOOL, EXTRA_TOOLS, SELF_MARKUP, SELF_MARKUP_FLOOR, BOTCH_CHANCE, COOLDOWN_MS,
  TOOL_BREAK_CHANCE, toolsOf, selfQuote, selfRemainingMs, selfRepair,
};
