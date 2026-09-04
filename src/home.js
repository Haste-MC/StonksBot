const db = require('./db');
const world = require('./data/world');
// Spät gebunden, damit Tests die Geldschnittstelle ersetzen können (§8).
const unb = require('./unb');

const changeCash = (...a) => unb.changeCash(...a);

/**
 * ===========================================================================
 *  HEIMAT UND SPRACHE
 * ===========================================================================
 *
 * Zwei Entscheidungen, die zusammen den Markt bestimmen, für den man
 * produziert – und die sich absichtlich nicht beliebig wechseln lassen:
 *
 *   **Das Land** wählt man einmal frei. Danach ist jeder Wechsel ein Umzug:
 *   Er kostet Geld, beendet den Mietvertrag – und die eigene Wohnung bleibt
 *   im alten Land zurück. Sie gehört einem weiter und behält ihren Wert, aber
 *   wohnen und parken kann man darin nicht mehr. Wer umzieht, braucht drüben
 *   erst wieder eine Bleibe.
 *
 *   **Die Sprache** wählt man ebenfalls einmal frei. Ein Wechsel danach kostet
 *   den größten Teil der Reichweite – das Publikum zieht nicht mit in eine
 *   andere Sprache.
 *
 * Warum so streng: Ohne Kosten wäre beides eine Optimierungsaufgabe, die man
 * einmal löst und danach vergisst. Mit Kosten ist es eine Weichenstellung.
 */

const DAY_MS = 24 * 60 * 60 * 1000;

/** Grundkosten eines Umzugs, mal Kaufkraft des Ziellandes. */
const MOVE_BASE = 50_000;

/** Jeder weitere Umzug wird teurer – Kisten packen macht keinen Spaß. */
const MOVE_STEP = 0.5;

/** Anteil der Follower, der einen Sprachwechsel NICHT mitmacht. */
const LANGUAGE_LOSS = 0.45;

/** So lange muss man nach einem Sprachwechsel dabeibleiben. */
const LANGUAGE_COOLDOWN_MS = 30 * DAY_MS;

const countryById = new Map(world.COUNTRIES.map((c) => [c.id, c]));
const languageById = new Map(world.LANGUAGES.map((l) => [l.id, l]));

/** Land per ID (oder das leere Standardland). */
function country(id) {
  return countryById.get(String(id ?? '')) ?? world.DEFAULT_COUNTRY;
}

/** Sprache per ID (oder die leere Standardsprache). */
function language(id) {
  return languageById.get(String(id ?? '')) ?? world.DEFAULT_LANGUAGE;
}

/** Wo dieser Spieler lebt. */
function homeOf(guildId, userId) {
  return country(db.getStats(guildId, userId).home_country);
}

/** In welcher Sprache dieser Spieler Inhalte macht. */
function languageOf(guildId, userId) {
  return language(db.getCreatorState(guildId, userId).language);
}

/** Hat der Spieler seine Heimat schon gewählt? */
function settled(guildId, userId) {
  return Boolean(db.getStats(guildId, userId).home_country);
}

/**
 * Der Markt, für den jemand produziert.
 *
 * `pool` skaliert die Obergrenze der Reichweite **linear** und verschiebt den
 * Punkt der vollen Vermarktung mit. `speed` beschleunigt den Weg dorthin,
 * ohne die Grenze zu verschieben (siehe creator.js: Zuwachs UND Schwund
 * werden damit multipliziert). So entsteht die Abwägung:
 *
 *   Landessprache → kleiner Topf, aber schnell voll
 *   Englisch      → riesiger Topf, aber zäh
 */
function marketOf(guildId, userId) {
  const lang = languageOf(guildId, userId);
  const land = homeOf(guildId, userId);
  const atHome = Boolean(lang.id) && lang.id === land.language;

  return {
    language: lang,
    country: land,
    atHome,
    pool: lang.pool,
    // Heimvorteil: Wer in der Sprache seines Landes sendet, kennt die Kultur.
    speed: lang.speed * (atHome ? world.HOME_BONUS_SPEED : 1),
    // Werbepreise hängen am Sprachmarkt ...
    money: lang.money,
    // ... Verträge und Merch an der Kaufkraft der Heimat.
    deal: land.market,
  };
}

/** Was ein Umzug in dieses Land kostet. */
function moveCost(guildId, userId, targetId) {
  const target = country(targetId);
  const moves = db.getStats(guildId, userId).moves ?? 0;
  return Math.round(MOVE_BASE * target.market * (1 + moves * MOVE_STEP));
}

/**
 * Setzt die Heimat.
 *
 * Beim ersten Mal umsonst. Danach ist es ein Umzug: Er kostet Geld und
 * beendet den Mietvertrag – die Wohnung im alten Land bleibt zurück.
 *
 * Geschrieben wird **vor** der Geldbuchung (§7), gebucht genau einmal (§9).
 */
async function setHome(guildId, userId, targetId, now = Date.now()) {
  const target = country(targetId);
  if (!target.id) return { ok: false, reason: 'unknown_country' };

  const current = homeOf(guildId, userId);
  if (current.id === target.id) return { ok: false, reason: 'already_there', country: target };

  // Erste Wahl: geschenkt.
  if (!current.id) {
    db.setHome(guildId, userId, target.id, { at: now });
    return { ok: true, first: true, country: target, cost: 0 };
  }

  // Unter Idol-Vertrag bleibt man im Land – so steht es im Vertrag.
  try {
    const contract = require('./music').contractOf(guildId, userId);
    if (contract) {
      return { ok: false, reason: 'contract', country: target, contract };
    }
  } catch { /* Musik nicht geladen: dann gibt es auch keinen Vertrag */ }

  const cost = moveCost(guildId, userId, target.id);
  const balance = await require('./unb').getBalance(guildId, userId).catch(() => null);
  if (!balance || balance.total < cost) {
    return { ok: false, reason: 'too_poor', country: target, cost, have: balance?.total ?? 0 };
  }

  // Zuerst der Zustand, dann das Geld.
  db.setHome(guildId, userId, target.id, { move: true, at: now });
  const rental = db.getRental(guildId, userId);
  if (rental) db.endRental(guildId, userId);

  const left = db.listOwnedProperties(guildId, userId)
    .filter((p) => (p.country || current.id) === current.id);

  const after = await changeCash(guildId, userId, -cost, `Umzug nach ${target.name}`);
  return {
    ok: true, first: false, country: target, from: current, cost,
    rental: rental ?? null, leftBehind: left, balance: after,
  };
}

/**
 * Setzt die Inhaltssprache.
 *
 * Beim ersten Mal umsonst. Danach kostet der Wechsel den größten Teil der
 * Reichweite: Ein deutschsprachiges Publikum schaut keine englischen Videos,
 * nur weil derselbe Mensch davor sitzt.
 */
function setLanguage(guildId, userId, targetId, now = Date.now()) {
  const target = language(targetId);
  if (!target.id) return { ok: false, reason: 'unknown_language' };

  const state = db.getCreatorState(guildId, userId, now);
  const current = language(state.language);
  if (current.id === target.id) return { ok: false, reason: 'already_set', language: target };

  if (current.id && state.language_at && now - state.language_at < LANGUAGE_COOLDOWN_MS) {
    return {
      ok: false, reason: 'cooldown', language: target,
      remainingMs: state.language_at + LANGUAGE_COOLDOWN_MS - now,
    };
  }

  const rows = db.allCreator(guildId, userId);
  const before = rows.reduce((s, r) => s + r.followers, 0);
  let lost = 0;

  if (current.id) {
    for (const row of rows) {
      const after = Math.round(row.followers * (1 - LANGUAGE_LOSS));
      lost += row.followers - after;
      db.saveCreator(guildId, userId, row.platform, { ...row, followers: after });
    }
  }

  db.saveCreatorState(guildId, userId, { ...state, language: target.id, language_at: now });
  return { ok: true, first: !current.id, language: target, from: current, lost, before };
}

module.exports = {
  COUNTRIES: world.COUNTRIES, LANGUAGES: world.LANGUAGES,
  MOVE_BASE, MOVE_STEP, LANGUAGE_LOSS, LANGUAGE_COOLDOWN_MS,
  country, language, homeOf, languageOf, settled, marketOf, moveCost,
  setHome, setLanguage,
};
