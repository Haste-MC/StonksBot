const db = require('./db');
const data = require('./data/creator');
const gearData = require('./data/gear');
// Spät gebunden, damit Tests die Geldschnittstelle ersetzen können (§8).
const unb = require('./unb');

const changeCash = (...a) => unb.changeCash(...a);

/**
 * ===========================================================================
 *  CREATOR-NETZWERK – Twitch, YouTube, Instagram, Twitter
 * ===========================================================================
 *
 * Niemand ist nur auf einer Plattform. Deshalb ist das hier kein Bündel von
 * vier getrennten Spielen, sondern EIN Publikum mit vier Türen:
 *
 *   • Reichweite überträgt sich (`SPILL`): Wer auf YouTube groß ist, startet
 *     auf Instagram nicht bei null.
 *   • Jede Aktion spült Follower zu den anderen (`spread`) – "Link in Bio".
 *   • Ein Tweet verdient **nichts**, schiebt aber die nächste Aktion an
 *     (Promo-Schub) und hält über die Community den Schwund klein.
 *   • Ereignisse wie ein viraler Clip oder ein Shitstorm wirken auf ALLE
 *     Kanäle – im Guten wie im Schlechten.
 *
 * Und alles teilt sich EIN Tagesbudget an Zeit. Ein Stream kostet den halben
 * Tag, ein Video den ganzen Nachmittag, ein Tweet fast nichts. Dadurch ist
 * "einfach alles machen" keine Option, sondern eine Entscheidung.
 *
 * ================== WARUM DAS KEIN GELDDRUCKER IST (§3) ==================
 * Dieselbe Mechanik wie beim einzelnen Kanal, nur eine Ebene höher:
 *
 *     Publikum  ~  (eigene + übertragene Follower)^0,55…0,62   unterlinear
 *     Schwund   ~  Follower je Plattform                        linear
 *
 * Der Übertrag steckt INNERHALB der unterlinearen Wurzel – vier Plattformen
 * multiplizieren die Reichweite also nicht, sie verschieben sie nur. Dazu ein
 * hartes Tagesbudget. Nachgerechnet über hunderte Karrieren in
 * test/creator.test.js, inklusive der Frage, ob sich die Plattformen
 * gegenseitig hochschaukeln können (sie können nicht).
 * =========================================================================
 */

const DAY_MS = 24 * 60 * 60 * 1000;

/** Zeitbudget pro Tag. Ein Stream kostet 2, ein Video 3, ein Post 1. */
const TIME_PER_DAY = 8;

/** Wie stark fremde Reichweite in die eigene hineinzählt. */
const SPILL = 0.25;

/** Anteil des Publikums, der auf den ANDEREN Plattformen hängenbleibt. */
const CROSS_CONV = 0.012;

/** Wie stark eine Plattform andere befeuert (Twitter ist reine Promo). */
const SPREAD = { twitch: 1.0, youtube: 1.2, instagram: 1.3, twitter: 1.8 };

/** Länger als so viele Tage wird Untätigkeit nicht nachgerechnet. */
const MAX_IDLE_DAYS = 21;

/** Grenzen der Form (Momentum). */
const HYPE_MIN = 0.6;
const HYPE_MAX = 1.6;

// ------------------------------------------------------------------ Geld

/** Twitch: Aufrufe je Zuschauer (Wiederholungen, Clips). */
const TWITCH_VIEWS = [8, 16];
const TWITCH_RPV = 0.34;              // Werbeeinnahme je Aufruf
const DONATE_CHANCE = 0.04;           // je Zuschauer
const DONATE_RANGE = [10, 150];
const SUB_CONVERT = 0.008;
const SUB_CHURN = 0.06;
const MAX_SUB_SHARE = 0.05;
const SUB_REVENUE = 12;

/** YouTube: Werbegeld je Aufruf – und der Katalog, der nachläuft. */
const YT_RPV = 0.35;
const YT_TAIL = 1.6;                  // so viele Nach-Aufrufe je Erstaufruf
const YT_TAIL_KEEP = 0.88;            // davon bleiben pro Tag 88 % übrig
const YT_MIN_SETTLE_MS = 60 * 60 * 1000;
const YT_MAX_SETTLE_DAYS = 14;

/**
 * Instagram: zahlt selbst NICHTS. Geld kommt nur über Kooperationen –
 * die Wahrscheinlichkeit hängt an der Reichweite, nicht am Glück allein.
 */
const COOP_BASE = 0.05;
const COOP_PER_AUDIENCE = 1 / 4000;
const COOP_MAX_CHANCE = 0.3;
const COOP_PER_VIEWER = 0.4;
/**
 * Marken zahlen für die GESAMTE Reichweite, nicht für den einzelnen Post –
 * deshalb geht das ganze Netzwerk in den Preis ein. Der Exponent hält auch
 * das unterlinear (§3): doppelte Reichweite ist kein doppelter Deal.
 */
const COOP_REACH_EXP = 0.6;

/** Twitter zahlt gar nichts – aber der Schub hilft der nächsten Aktion. */
const BOOST_MAX = 0.5;
const BOOST_MS = 6 * 60 * 60 * 1000;
const COMMUNITY_MAX = 100;
const COMMUNITY_DECAY = 0.08;         // pro Tag
const COMMUNITY_CHURN_CUT = 0.5;      // höchstens halber Schwund

// --------------------------------------------------------------- Burnout
/**
 * Wer jeden Tag das volle Budget raushaut, brennt aus: Die Reichweite sinkt,
 * bis er sich erholt. Das macht aus dem Zeitdeckel eine Entscheidung statt
 * einer Wand – und ist nebenbei eine weitere Obergrenze (§3).
 */
const FATIGUE_PER_TIME = 4;            // je Zeiteinheit einer Aktion
const FATIGUE_MAX = 100;              // ein voller Tag = 96
const FATIGUE_RECOVERY = 0.55;        // Anteil, der pro Tag Pause abklingt
const FATIGUE_MALUS = 0.35;           // höchstens −35 % Publikum

// ----------------------------------------------------------------- Merch
/**
 * Merch hängt an der **Community**, nicht an der Reichweite: Leute kaufen
 * Pullis von Leuten, die sie mögen. Dadurch wird Twitter indirekt profitabel,
 * ohne dass Twitter selbst einen Cent zahlt.
 *
 * Die Community klingt ohne Tweets ab – wer aufhört, verkauft nichts mehr.
 */
const MERCH_MIN_REACH = 5000;
/**
 * Umsatz = **Anteil der Fans, der kauft × Zahl der Fans**. Die Community ist
 * deshalb ein Faktor, kein Summand: Ohne Bindung verkauft auch der größte
 * Kanal nichts, und ein kleiner Kanal mit treuer Blase verdient nicht plötzlich
 * so viel wie ein Weltstar. Der Exponent hält es unterlinear (§3).
 */
const MERCH_FACTOR = 4;
const MERCH_REACH_EXP = 0.62;
const MERCH_DAILY_CAP = 100000;       // reine Notbremse, greift nie im Normalbetrieb
const MERCH_MAX_DAYS = 7;
const MERCH_MIN_SETTLE_MS = 60 * 60 * 1000;

// ------------------------------------------------------ Sponsorenverträge
/**
 * Marken zahlen für Reichweite – aber erst nach Lieferung. Ein Vertrag ist
 * eine Wette auf die eigene Ausdauer: Wer die Frist reißt, zahlt Strafe.
 */
const DEAL_MIN_REACH = 3000;
const DEAL_CHANCE_MAX = 0.25;
const DEAL_REACH_FULL = 250000;       // ab hier kommen Angebote am häufigsten
const DEAL_FACTOR = 5;
const DEAL_REACH_EXP = 0.65;          // auch hier unterlinear (§3)
const DEAL_PENALTY = 0.3;             // Vertragsstrafe, Anteil der Summe
const DEAL_OFFER_MS = 2 * DAY_MS;     // so lange steht ein Angebot
const DEAL_MAX_OFFERS = 2;
const DEAL_QUOTA = [2, 4];
const DEAL_DAYS_PER_POST = 1;

/** Grundrisiko, dass die Technik bei einer Aufnahme aufgibt. */
const BREAK_CHANCE = 0.01;

const byId = new Map(data.PLATFORMS.map((p) => [p.id, p]));
const PLATFORM_IDS = data.PLATFORMS.map((p) => p.id);

const clamp = (min, max, v) => Math.min(max, Math.max(min, v));
const pick = (list, random) => list[Math.floor(random() * list.length)];

/** Tagesstempel in lokaler Zeit – identisch zum Arbeitsamt. */
function today(date = new Date()) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

/**
 * Bereinigt einen selbst getippten Titel.
 *
 * Titel landen in Meldungen und in der Kanalansicht, also darf hier nichts
 * durchrutschen, was andere anpingt oder das Layout zerlegt. Bleibt nichts
 * übrig, entscheidet wieder der Zufall.
 */
function cleanTitle(raw) {
  const text = String(raw ?? '')
    .replace(/[\r\n]+/g, ' ')            // eine Zeile, kein Layoutbruch
    .replace(/<@[!&]?\d+>|<#\d+>/g, '')   // keine Erwähnungen durchreichen
    .replace(/@(everyone|here)/gi, '@\u200bjeden')
    .replace(/[`*_~|]/g, '')              // kein Markdown, das die Meldung zerreißt
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 80);
  return text || null;
}

/** Plattformdefinition per ID. */
function platform(id) {
  return byId.get(String(id)) ?? null;
}

/** Formatdefinition (Kategorie) einer Plattform. */
function format(platformId, formatId) {
  return (data.FORMATS[platformId] ?? []).find((f) => f.id === String(formatId)) ?? null;
}

/** Alle Formate einer Plattform. */
function formats(platformId) {
  return data.FORMATS[platformId] ?? [];
}

/**
 * Das erwartete Publikum einer Aktion.
 *
 * Der Übertrag steckt INNERHALB des Exponenten – fremde Reichweite hilft,
 * multipliziert sich aber nicht (§3).
 */
function reachOf(p, followers, cross = 0) {
  const pool = Math.max(0, followers) + SPILL * Math.max(0, cross);
  return p.base + p.k * Math.pow(pool, p.exp);
}

/** Braucht diese Plattform Ausrüstung, und hat der Spieler sie? */
function hasGear(guildId, userId, p) {
  if (!p.gear) return true;
  return Boolean(db.ownsNamed(guildId, userId, p.gear));
}

/** Wie lange noch bis zur nächsten Aktion auf dieser Plattform? (0 = jetzt) */
function remainingMs(guildId, userId, platformId, now = Date.now()) {
  const p = platform(platformId);
  if (!p) return 0;
  const row = db.getCreator(guildId, userId, platformId, now);
  if (!row.last_action_at) return 0;
  return Math.max(0, row.last_action_at + p.cooldownMin * 60 * 1000 - now);
}

/** Zeitbudget des Tages. */
function budget(guildId, userId, now = Date.now()) {
  const state = db.getCreatorState(guildId, userId, now);
  const day = today(new Date(now));
  const used = state.day === day ? state.time_used : 0;
  return { used, max: TIME_PER_DAY, left: Math.max(0, TIME_PER_DAY - used) };
}

/**
 * Tage ohne Berührung, abzüglich eines Schontags.
 *
 * Gerechnet wird ab `touched_at`, nicht ab der letzten Aktion: Sonst könnte
 * man Reichweite auf einer Plattform parken, die man nie wieder anfasst –
 * der Verfall würde ewig aufgeschoben.
 *
 * Der Schontag ist wichtig: Wer täglich zur selben Zeit sendet, liegt exakt
 * 24 Stunden auseinander und bekäme sonst JEDEN Tag einen vollen Tag
 * Inaktivitätsverfall – 2,5 % gegen 0,16 % Schwund je Aktion. Der Verfall
 * würde damit die Obergrenze bestimmen statt der eigentlichen Stellschraube,
 * und ein täglich gepflegter Kanal käme nie über ein paar zehntausend
 * Follower hinaus. Bestraft werden soll Abwesenheit, nicht Regelmäßigkeit.
 *
 * Gerechnet wird in Bruchteilen: zwei Tage Pause sind ein Tag Verfall,
 * zweieinhalb Tage anderthalb.
 */
const IDLE_GRACE_DAYS = 1;

function idleDays(lastAt, now) {
  if (!lastAt) return 0;
  return clamp(0, MAX_IDLE_DAYS, (now - lastAt) / DAY_MS - IDLE_GRACE_DAYS);
}

/** Community-Bindung, nachdem sie seit dem letzten Mal abgeklungen ist. */
function communityNow(state, now) {
  if (!state.community || !state.community_at) return state.community || 0;
  const days = Math.max(0, (now - state.community_at) / DAY_MS);
  return clamp(0, COMMUNITY_MAX, state.community * Math.pow(1 - COMMUNITY_DECAY, days));
}

/** Wie stark der Schwund durch die Community gebremst wird (1 = gar nicht). */
function churnFactor(community) {
  return 1 - COMMUNITY_CHURN_CUT * clamp(0, 1, community / COMMUNITY_MAX);
}

/** Erschöpfung, nachdem sie seit der letzten Aktion abgeklungen ist. */
function fatigueNow(state, now) {
  if (!state.fatigue || !state.fatigue_at) return state.fatigue || 0;
  const days = Math.max(0, (now - state.fatigue_at) / DAY_MS);
  return clamp(0, FATIGUE_MAX, state.fatigue * Math.pow(1 - FATIGUE_RECOVERY, days));
}

/** Was die Erschöpfung von der Reichweite übrig lässt (1 = ausgeruht). */
function energyFactor(fatigue) {
  return 1 - FATIGUE_MALUS * clamp(0, 1, fatigue / FATIGUE_MAX);
}

/** Anteil der Follower, der die Untätigkeit überlebt hat (1 = kein Verfall). */
function keepFactor(p, row, community, now) {
  const idle = idleDays(row?.touched_at || row?.last_action_at || 0, now);
  if (idle <= 0) return 1;
  return Math.pow(1 - p.churnPerDay * churnFactor(community), Math.min(idle, MAX_IDLE_DAYS));
}

/** Ist der Promo-Schub aus dem letzten Tweet noch gültig? */
function activeBoost(state, now) {
  return state.boost_until > now ? state.boost : 0;
}

/** Würfelt ein Ereignis; riskante Formate ziehen die Pannen an. */
function rollEvent(platformId, fmt, random = Math.random) {
  const usable = data.EVENTS.filter((e) => !e.on || e.on.includes(platformId));
  const weights = usable.map((e) => (e.risky ? e.weight * (fmt?.risk ?? 1) : e.weight));
  const total = weights.reduce((s, w) => s + w, 0);
  let roll = random() * total;
  for (let i = 0; i < usable.length; i++) {
    if (roll < weights[i]) return usable[i];
    roll -= weights[i];
  }
  return usable[0];
}

/** Sammelt die Spenden eines Streams ein. */
function rollDonations(viewers, factor, random) {
  const chance = DONATE_CHANCE * factor;
  const entries = [];
  let total = 0;
  for (let i = 0; i < viewers; i++) {
    if (random() >= chance) continue;
    const r = random() * random();            // viele kleine, wenige große
    const amount = Math.round(DONATE_RANGE[0] + r * (DONATE_RANGE[1] - DONATE_RANGE[0]));
    total += amount;
    if (entries.length < 3) entries.push({ amount, text: pick(data.DONATIONS, random) });
  }
  return { total, entries };
}

/**
 * ===================== DER REINE KERN =====================
 * Aus Zustand + Plattform + Format wird das Ergebnis einer Aktion. Ohne
 * Datenbank, ohne Geldbuchung – dadurch lässt sich das Gleichgewicht über
 * Millionen Aktionen nachrechnen (test/creator.test.js).
 *
 * @param {{followers,subs,hype,stock}} state   Zustand DIESER Plattform
 * @param {object} p                            Plattform
 * @param {object} fmt                          Format
 * @param {{cross,community,boost,idleDays,random}} ctx
 */
function simulate(state, p, fmt, ctx = {}) {
  const {
    cross = 0, community = 0, boost = 0, energy = 1,
    idleDays: idle = 0, random = Math.random,
  } = ctx;

  // 1. Was die Pause gekostet hat – abgefedert durch die Community.
  const dayLoss = p.churnPerDay * churnFactor(community);
  const keep = idle > 0 ? Math.pow(1 - dayLoss, Math.min(idle, MAX_IDLE_DAYS)) : 1;
  const startFollowers = state.followers * keep;
  const startSubs = (state.subs ?? 0) * keep;
  const lostToIdle = Math.round(state.followers - startFollowers);

  // 2. Tagesform, Ereignis, Promo-Schub aus dem letzten Tweet.
  const roll = 0.55 + random() * 0.95;
  const event = rollEvent(p.id, fmt, random);
  const quality = roll * state.hype;

  // 3. Publikum.
  const audience = Math.max(1, Math.round(
    reachOf(p, startFollowers, cross) * quality * fmt.reach
    * (event.audience ?? 1) * (1 + boost) * energy));

  // 4. Follower.
  const gained = Math.round(audience * p.follow * fmt.follow * (event.follow ?? 1));
  const lost = Math.round(startFollowers * (p.churnPerAction + (event.loss ?? 0)));
  const followers = Math.max(0, startFollowers - lost + gained);

  // Übertrag auf die anderen Plattformen – der Kern des Netzwerks.
  const spill = Math.round(audience * CROSS_CONV * (SPREAD[p.id] ?? 1) * fmt.follow);
  const spillLoss = event.spreadLoss ?? 0;

  const result = {
    platform: p.id, format: fmt.id,
    followers, subs: startSubs, hype: clamp(HYPE_MIN, HYPE_MAX, state.hype * 0.7 + roll * 0.3),
    audience, gained, lost, lostToIdle, spill, spillLoss,
    stock: state.stock ?? 0,
    views: audience, money: 0, ads: 0, donations: 0, donationList: [], subIncome: 0,
    coop: null, boost: 0, community: 0,
    event, roll, quality,
  };

  // 5. Geld – jede Plattform auf ihre Art.
  if (p.id === 'twitch') {
    const views = Math.round(
      audience * (TWITCH_VIEWS[0] + random() * (TWITCH_VIEWS[1] - TWITCH_VIEWS[0])));
    const subs = clamp(0, followers * MAX_SUB_SHARE,
      startSubs * (1 - SUB_CHURN) + audience * SUB_CONVERT * fmt.follow);
    const donations = rollDonations(audience, fmt.money * (event.money ?? 1), random);

    result.views = views;
    result.subs = subs;
    result.ads = Math.round(views * TWITCH_RPV * (event.money ?? 1));
    result.donations = donations.total;
    result.donationList = donations.entries;
    result.subIncome = Math.round(subs * SUB_REVENUE);
    result.money = result.ads + result.donations + result.subIncome;

  } else if (p.id === 'youtube') {
    result.ads = Math.round(audience * YT_RPV * fmt.money * (event.money ?? 1));
    result.money = result.ads;
    // Der Katalog: Aufrufe, die erst in den nächsten Tagen entstehen.
    result.stock = (state.stock ?? 0) + audience * YT_TAIL * (fmt.tail ?? 1);

  } else if (p.id === 'instagram') {
    // Zahlt selbst nichts. Geld gibt es nur, wenn eine Marke anklopft.
    const chance = clamp(0, COOP_MAX_CHANCE,
      (COOP_BASE + audience * COOP_PER_AUDIENCE) * fmt.money);
    if (random() < chance) {
      const brand = pick(data.BRANDS, random);
      const reachTotal = startFollowers + cross;
      const value = Math.round(
        (audience * COOP_PER_VIEWER + Math.pow(Math.max(0, reachTotal), COOP_REACH_EXP))
        * fmt.money * (0.6 + random()));
      result.coop = { brand, value };
      result.money = value;
    }

  } else if (p.id === 'twitter') {
    // Zahlt NIE. Wirkt stattdessen auf alles andere.
    result.money = 0;
    result.boost = clamp(0, BOOST_MAX, 0.12 * (fmt.boost ?? 1) * quality);
  }

  /**
   * Community entsteht überall dort, wo man miteinander redet: im Livechat
   * am stärksten, unter Videos noch spürbar, auf Twitter billig und direkt.
   * Im Instagram-Feed wird gescrollt, nicht geredet – dort ist der Faktor 0.
   */
  result.community = (p.community ?? 0) * (fmt.community ?? 1) * (0.8 + quality * 0.6);

  return result;
}

/**
 * Rechnet den YouTube-Katalog ab: Videos werden noch tagelang geklickt.
 *
 * Faule Abrechnung (§4): Beim ersten Mal wird nur der Zeitstempel gesetzt,
 * danach zählt allein die vergangene Zeit. Wiederholtes Aufrufen bringt
 * deshalb nichts – der Vorrat kann nur einmal ausgeschüttet werden.
 */
async function settle(guildId, userId, now = Date.now()) {
  const row = db.getCreator(guildId, userId, 'youtube', now);
  if (!row.stock_paid_through) {
    db.saveCreator(guildId, userId, 'youtube', { ...row, stock_paid_through: now });
    return null;
  }
  const elapsed = now - row.stock_paid_through;
  if (elapsed < YT_MIN_SETTLE_MS || row.stock <= 0) return null;

  const days = Math.min(YT_MAX_SETTLE_DAYS, elapsed / DAY_MS);
  const released = row.stock * (1 - Math.pow(YT_TAIL_KEEP, days));
  const amount = Math.round(released * YT_RPV);

  // Erst schreiben, dann buchen (§7).
  db.saveCreator(guildId, userId, 'youtube', {
    ...row,
    stock: row.stock - released,
    stock_paid_through: now,
    views_total: row.views_total + Math.round(released),
    earned_total: row.earned_total + amount,
  });
  if (amount <= 0) return null;

  const perk = require('./perks').perksOf(guildId, userId);
  const paid = Math.max(0, Math.round(amount * perk.income));
  const balance = await changeCash(guildId, userId, paid, 'YouTube: Katalogaufrufe');
  return { amount: paid, views: Math.round(released), days, balance };
}

/**
 * Rechnet die Merch-Verkäufe ab.
 *
 * Faule Abrechnung wie beim Katalog (§4): Beim ersten Mal nur den Zeitstempel
 * setzen, danach zählt die vergangene Zeit – gedeckelt, damit sich Wochen
 * nicht aufstauen. Verkauft wird nur, solange die Community lebt.
 */
async function settleMerch(guildId, userId, now = Date.now()) {
  const state = db.getCreatorState(guildId, userId, now);
  const rows = db.allCreator(guildId, userId);
  const reach = rows.reduce((sum, r) => sum + r.followers, 0);

  if (!state.merch_at) {
    db.saveCreatorState(guildId, userId, { ...state, merch_at: now });
    return null;
  }
  if (reach < MERCH_MIN_REACH) return null;

  const elapsed = now - state.merch_at;
  if (elapsed < MERCH_MIN_SETTLE_MS) return null;

  const community = communityNow(state, now);
  const perDay = merchPerDay(reach, community);
  const days = Math.min(MERCH_MAX_DAYS, elapsed / DAY_MS);
  const amount = Math.round(perDay * days);

  db.saveCreatorState(guildId, userId, { ...state, merch_at: now });
  if (amount <= 0) return null;

  const perk = require('./perks').perksOf(guildId, userId);
  const paid = Math.max(0, Math.round(amount * perk.income));
  const balance = await changeCash(guildId, userId, paid, 'Merch: Verkäufe');
  return { amount: paid, perDay: Math.round(perDay), days, balance };
}

/** Merch-Umsatz pro Tag: Bindung × Reichweite. */
function merchPerDay(reach, community) {
  if (reach < MERCH_MIN_REACH) return 0;
  const share = clamp(0, 1, community / COMMUNITY_MAX);
  return Math.min(MERCH_DAILY_CAP,
    Math.round(share * Math.pow(Math.max(0, reach), MERCH_REACH_EXP) * MERCH_FACTOR));
}

/** Ist dieser Kanal groß genug für Merch? */
function merchUnlocked(reach) {
  return reach >= MERCH_MIN_REACH;
}

/**
 * Würfelt ein Vertragsangebot aus. Je größer das Netzwerk, desto öfter meldet
 * sich jemand – aber nie mehr als DEAL_MAX_OFFERS gleichzeitig, und nie
 * während ein Vertrag läuft.
 */
function rollDeal(guildId, userId, reach, now, random = Math.random) {
  if (reach < DEAL_MIN_REACH) return null;
  if (db.activeDeal(guildId, userId)) return null;
  if (db.countOffers(guildId, userId, now) >= DEAL_MAX_OFFERS) return null;

  const chance = clamp(0, DEAL_CHANCE_MAX, (reach / DEAL_REACH_FULL) * DEAL_CHANCE_MAX);
  if (random() >= chance) return null;

  // Auf welcher Plattform geliefert wird. Twitter fällt raus – dort läuft
  // keine Werbung, die jemand bezahlen würde.
  const target = pick(['instagram', 'twitch', 'youtube'], random);
  const brand = pick(data.BRANDS, random);
  const quota = DEAL_QUOTA[0] + Math.floor(random() * (DEAL_QUOTA[1] - DEAL_QUOTA[0] + 1));
  const payout = Math.round(
    Math.pow(reach, DEAL_REACH_EXP) * quota * DEAL_FACTOR * (0.8 + random() * 0.4));

  return db.insertDeal({
    guildId, userId,
    brand: brand.name, emoji: brand.emoji,
    platform: target,
    // Auf Instagram will die Marke einen echten Werbepost sehen.
    format: target === 'instagram' ? 'kooperation' : '',
    quota,
    payout,
    penalty: Math.round(payout * DEAL_PENALTY),
    createdAt: now,
    expiresAt: now + DEAL_OFFER_MS,
  });
}

/**
 * Räumt Verträge auf: abgelaufene Angebote verfallen, gerissene Fristen
 * kosten Vertragsstrafe.
 *
 * @returns {Promise<{failed:object|null, expired:number}>}
 */
async function settleDeals(guildId, userId, now = Date.now()) {
  const expired = db.expireOffers(guildId, userId, now);

  const active = db.activeDeal(guildId, userId);
  if (!active || !active.deadline || active.deadline > now) return { failed: null, expired };

  // Frist gerissen: Status zuerst setzen (§7), dann buchen.
  db.setDealStatus(guildId, active.id, 'failed');
  let balance = null;
  if (active.penalty > 0) {
    balance = await changeCash(
      guildId, userId, -active.penalty, `Vertragsstrafe: ${active.brand}`);
  }
  return { failed: { ...active, balance }, expired };
}

/** Nimmt ein Angebot an. */
function accept(guildId, userId, dealId, now = Date.now()) {
  const deal = db.getDeal(guildId, dealId);
  if (!deal || deal.user_id !== String(userId)) return { ok: false, reason: 'not_found' };
  if (deal.status !== 'offer') return { ok: false, reason: 'gone', deal };
  if (deal.expires_at <= now) {
    db.setDealStatus(guildId, deal.id, 'expired');
    return { ok: false, reason: 'expired', deal };
  }
  if (db.activeDeal(guildId, userId)) return { ok: false, reason: 'busy', deal };

  const deadline = now + (deal.quota * DEAL_DAYS_PER_POST + 1) * DAY_MS;
  if (!db.acceptDeal(guildId, deal.id, now, deadline)) return { ok: false, reason: 'gone', deal };
  return { ok: true, deal: { ...deal, status: 'active', accepted_at: now, deadline } };
}

/** Lehnt ein Angebot ab. */
function decline(guildId, userId, dealId) {
  const deal = db.getDeal(guildId, dealId);
  if (!deal || deal.user_id !== String(userId)) return { ok: false, reason: 'not_found' };
  if (deal.status !== 'offer') return { ok: false, reason: 'gone', deal };
  db.setDealStatus(guildId, deal.id, 'expired');
  return { ok: true, deal };
}

/**
 * Eine Aktion auf einer Plattform.
 *
 * Der Zustand wird **vor** der Geldbuchung geschrieben (§7): Ein zweiter
 * schneller Klick findet den Cooldown vor. Ausgezahlt wird genau einmal (§9).
 */
async function act(
  guildId, userId, platformId, formatId,
  now = Date.now(), random = Math.random, wishTitle = null,
) {
  const p = platform(platformId);
  if (!p) return { ok: false, reason: 'unknown_platform' };
  const fmt = format(platformId, formatId);
  if (!fmt) return { ok: false, reason: 'unknown_format', platform: p };

  // Selbst getippter Titel schlägt die Vorauswahl.
  const wish = cleanTitle(wishTitle);

  if (!hasGear(guildId, userId, p)) {
    const item = gearData.findGear(p.gear);
    return { ok: false, reason: 'no_gear', platform: p, gear: p.gear, price: item?.price ?? null };
  }

  const left = remainingMs(guildId, userId, platformId, now);
  if (left > 0) return { ok: false, reason: 'cooldown', platform: p, remainingMs: left };

  const state = db.getCreatorState(guildId, userId, now);
  const day = today(new Date(now));
  const used = state.day === day ? state.time_used : 0;
  if (used + p.time > TIME_PER_DAY) {
    return {
      ok: false, reason: 'no_time', platform: p, need: p.time,
      used, max: TIME_PER_DAY, left: TIME_PER_DAY - used,
      resetMs: new Date(new Date(now).setHours(24, 0, 0, 0)).getTime() - now,
    };
  }

  const rows = new Map(db.allCreator(guildId, userId).map((r) => [r.platform, r]));
  const own = rows.get(platformId) ?? db.getCreator(guildId, userId, platformId, now);
  const title = wish ?? pick(fmt.titles, random);
  const cross = [...rows.values()]
    .filter((r) => r.platform !== platformId)
    .reduce((sum, r) => sum + r.followers, 0);

  const community = communityNow(state, now);
  const boost = activeBoost(state, now);
  const fatigue = fatigueNow(state, now);
  const energy = energyFactor(fatigue);

  const sim = simulate(own, p, fmt, {
    cross, community, boost, energy,
    idleDays: idleDays(own.touched_at || own.last_action_at, now),
    random,
  });

  const perk = require('./perks').perksOf(guildId, userId);
  const amount = Math.max(0, Math.round(sim.money * perk.income));

  // --- Zustand schreiben, alles synchron vor dem ersten await (§7) ---
  db.saveCreator(guildId, userId, platformId, {
    followers: sim.followers,
    subs: sim.subs,
    hype: sim.hype,
    actions: own.actions + 1,
    views_total: own.views_total + sim.views,
    earned_total: own.earned_total + amount,
    peak_audience: Math.max(own.peak_audience, sim.audience),
    peak_followers: Math.max(own.peak_followers, Math.round(sim.followers)),
    last_action_at: now,
    touched_at: now,
    stock: sim.stock,
    stock_paid_through: own.stock_paid_through || now,
    last_title: title,
  });

  // Übertrag auf die anderen Plattformen (und ggf. der Schaden eines
  // Shitstorms). Dabei wird deren aufgelaufener Verfall gleich mit abgerechnet
  // – sonst wüchse ein nie benutzter Kanal allein durch Überträge weiter.
  const spilled = [];
  for (const id of PLATFORM_IDS) {
    if (id === platformId) continue;
    const other = rows.get(id);
    const otherPlatform = platform(id);
    const keep = other ? keepFactor(otherPlatform, other, community, now) : 1;
    const surviving = other ? other.followers * keep : 0;
    const delta = sim.spill - (sim.spillLoss > 0 ? Math.round(surviving * sim.spillLoss) : 0);
    if (!delta && keep === 1) continue;
    db.addCreatorFollowers(guildId, userId, id, delta, keep, now);
    spilled.push({ platform: id, delta, decayed: Math.round((other?.followers ?? 0) - surviving) });
  }

  db.saveCreatorState(guildId, userId, {
    day,
    time_used: used + p.time,
    // Der Schub wird von der nächsten Aktion verbraucht; ein neuer Tweet
    // ersetzt ihn, eine andere Aktion räumt ihn ab.
    boost: p.id === 'twitter' ? sim.boost : 0,
    boost_until: p.id === 'twitter' ? now + BOOST_MS : 0,
    community: clamp(0, COMMUNITY_MAX, community + (sim.community ?? 0)),
    community_at: now,
    // Jede Aktion kostet Kraft, im Verhältnis zu ihrer Länge.
    fatigue: clamp(0, FATIGUE_MAX, fatigue + p.time * FATIGUE_PER_TIME),
    fatigue_at: now,
    merch_at: state.merch_at || now,
  });

  const broke = (sim.event.breaks || random() < BREAK_CHANCE) && p.gear
    ? db.consumeNamed(guildId, userId, p.gear) : false;

  // --- Laufender Sponsorenvertrag: zählt diese Aktion? ---
  let deal = null;
  const active = db.activeDeal(guildId, userId);
  if (active && active.platform === platformId
      && (!active.format || active.format === fmt.id)) {
    db.advanceDeal(guildId, active.id);
    const done = active.done + 1;
    if (done >= active.quota) db.setDealStatus(guildId, active.id, 'done');
    deal = { ...active, done, complete: done >= active.quota };
  }

  const balance = amount > 0
    ? await changeCash(guildId, userId, amount, `${p.name}: ${fmt.name}`)
    : null;

  // Erfüllte Verträge werden sofort ausgezahlt – eigene Buchung, weil es ein
  // eigener Vorgang ist (nicht der Ertrag dieser einen Aktion).
  if (deal?.complete && deal.payout > 0) {
    deal.balance = await changeCash(
      guildId, userId, deal.payout, `Sponsor: ${deal.brand}`).catch(() => null);
  }

  // --- Meldet sich eine Marke? ---
  const reachTotal = [...rows.values()].reduce((sum, r) => sum + r.followers, 0)
    + sim.followers - own.followers;
  const offer = rollDeal(guildId, userId, reachTotal, now, random);

  return {
    ok: true,
    platform: p, format: fmt,
    title, customTitle: Boolean(wish),
    intro: pick(data.INTROS, random),
    comment: pick(data.COMMENTS, random),
    event: sim.event.text ? sim.event : null,
    audience: sim.audience, views: sim.views,
    followers: Math.round(sim.followers), followersBefore: own.followers,
    gained: sim.gained, lost: sim.lost, lostToIdle: sim.lostToIdle,
    subs: Math.round(sim.subs), spill: sim.spill, spilled,
    ads: sim.ads, donations: sim.donations, donationList: sim.donationList,
    subIncome: sim.subIncome, coop: sim.coop,
    base: sim.money, amount, levelBonus: amount - sim.money, level: perk.level,
    boostUsed: boost, boost: sim.boost, community: sim.community,
    fatigue: clamp(0, FATIGUE_MAX, fatigue + p.time * FATIGUE_PER_TIME),
    energy, tired: energy < 0.95,
    deal, offer,
    stock: sim.stock, hype: sim.hype, broke, balance,
    timeUsed: used + p.time, timeMax: TIME_PER_DAY,
  };
}

/**
 * Der Zustand des ganzen Netzwerks für die Anzeige.
 *
 * Reine Vorschau: schreibt nichts, rechnet den Verfall nur vor (§4).
 */
function status(guildId, userId, now = Date.now()) {
  const state = db.getCreatorState(guildId, userId, now);
  const community = communityNow(state, now);
  const fatigue = fatigueNow(state, now);
  const rows = new Map(db.allCreator(guildId, userId).map((r) => [r.platform, r]));

  const platforms = data.PLATFORMS.map((p) => {
    const row = rows.get(p.id) ?? { followers: 0, subs: 0, hype: 1, actions: 0,
      views_total: 0, earned_total: 0, peak_audience: 0, peak_followers: 0,
      last_action_at: 0, touched_at: 0, stock: 0, last_title: '' };
    const idle = idleDays(row.touched_at || row.last_action_at, now);
    const keep = keepFactor(p, row, community, now);
    const followers = Math.round(row.followers * keep);
    const cross = [...rows.values()]
      .filter((r) => r.platform !== p.id)
      .reduce((sum, r) => sum + r.followers, 0);

    return {
      ...p,
      followers,
      subs: Math.round(row.subs * keep),
      hype: row.hype,
      actions: row.actions,
      viewsTotal: row.views_total,
      earnedTotal: row.earned_total,
      peakAudience: row.peak_audience,
      peakFollowers: row.peak_followers,
      lastTitle: row.last_title ?? '',
      // Für die Anzeige gerundet – gerechnet wird mit dem genauen Wert.
      idleDaysExact: idle,
      lostToIdle: Math.round(row.followers - followers),
      idleDays: Math.round(idle),
      stock: Math.round(row.stock),
      expected: Math.round(reachOf(p, followers, cross) * row.hype),
      remainingMs: remainingMs(guildId, userId, p.id, now),
      hasGear: hasGear(guildId, userId, p),
    };
  });

  const total = platforms.reduce((s, p) => s + p.followers, 0);

  return {
    platforms,
    total,
    earned: platforms.reduce((s, p) => s + p.earnedTotal, 0),
    actions: platforms.reduce((s, p) => s + p.actions, 0),
    community,
    churnCut: 1 - churnFactor(community),
    boost: activeBoost(state, now),
    boostMs: Math.max(0, state.boost_until - now),
    budget: budget(guildId, userId, now),
    fatigue,
    energy: energyFactor(fatigue),
    merch: {
      unlocked: merchUnlocked(total),
      minReach: MERCH_MIN_REACH,
      perDay: merchPerDay(total, community),
    },
    deal: db.activeDeal(guildId, userId),
    offers: db.listDeals(guildId, userId, 'offer').filter((d) => d.expires_at > now),
    history: db.dealHistory(guildId, userId, 5),
  };
}

/**
 * ===================== BEKANNTHEIT =====================
 * Wie bekannt jemand auf dem Server ist. Vor allem eine Frage der Reichweite –
 * aber wer lange dabei ist, kennt man auch ohne Kanal. Deshalb zählt das Level
 * mit, damit jeder einen Titel hat und nicht nur Creator.
 */
const FAME_PER_LEVEL = 400;

/**
 * Die Leiter reicht bewusst bis in zweistellige Millionen: „Superstar" soll
 * das sein, was es draußen auch ist – internationale Reichweite, kein Titel
 * für den dritten Monat. Die oberen Ränge sind ein Fernziel, keine Station.
 */
const FAME_RANKS = [
  { at: 0, emoji: '🫥', title: 'Unbeschriebenes Blatt' },
  { at: 1_000, emoji: '🙂', title: 'Vom Sehen bekannt' },
  { at: 10_000, emoji: '📍', title: 'Lokalgröße' },
  { at: 50_000, emoji: '🏙️', title: 'Stadtbekannt' },
  { at: 250_000, emoji: '📺', title: 'Landesweit ein Begriff' },
  { at: 1_000_000, emoji: '✨', title: 'Prominenz' },
  { at: 5_000_000, emoji: '🌟', title: 'Superstar' },
  { at: 20_000_000, emoji: '👑', title: 'Legende' },
];

/** Der Bekanntheitswert aus Reichweite und Level. */
function fameScore(reach = 0, level = 0) {
  return Math.max(0, Math.round(reach)) + Math.max(0, Math.round(level)) * FAME_PER_LEVEL;
}

/**
 * Der Titel zu einem Bekanntheitswert – plus dem, was zum nächsten fehlt.
 * @returns {{emoji,title,at,score,next:object|null,toNext:number}}
 */
function fameOf(reach = 0, level = 0) {
  const score = fameScore(reach, level);
  let rank = FAME_RANKS[0];
  for (const r of FAME_RANKS) if (score >= r.at) rank = r;
  const next = FAME_RANKS.find((r) => r.at > score) ?? null;
  return { ...rank, score, next, toNext: next ? next.at - score : 0 };
}

/** Fertige Meldung für Discord und Fluxer. */
function describe(result, money) {
  if (!result.ok) return null;
  const p = result.platform;
  const f = result.format;

  const lines = [`${p.emoji} ${result.intro} **„${result.title}"** _(${f.name})_`];

  lines.push(`👀 **${result.audience.toLocaleString('de-DE')}** ${p.unit}` +
    (p.id === 'twitch' ? ` · ▶️ ${result.views.toLocaleString('de-DE')} Aufrufe` : '') +
    (result.boostUsed > 0 ? ` · 🐦 +${Math.round(result.boostUsed * 100)} % durch deinen Tweet` : ''));

  if (result.event) lines.push(result.event.text);

  const delta = result.followers - result.followersBefore;
  lines.push(`👥 ${p.followerName}: **${result.followers.toLocaleString('de-DE')}** ` +
    `(${delta >= 0 ? '+' : ''}${delta.toLocaleString('de-DE')})` +
    (p.subs && result.subs > 0 ? ` · ⭐ ${result.subs} Abos` : ''));

  if (result.spilled?.length > 0 && result.spill > 0) {
    lines.push(`🔗 Über die Bio sind **+${result.spill}** Leute zu deinen anderen ` +
      'Kanälen gewandert.');
  }

  if (result.donationList?.length > 0) {
    lines.push(result.donationList.map((d) => `💸 _„${d.text}"_`).join('\n'));
  }

  if (result.coop) {
    lines.push(`🤝 ${result.coop.brand.emoji} Eine Anfrage von ${result.coop.brand.name} – ` +
      `**${money(result.coop.value)}**.`);
  }

  if (p.id === 'twitch') {
    lines.push(`💰 **${money(result.amount)}** _(Werbung ${money(result.ads)} · ` +
      `Spenden ${money(result.donations)} · Abos ${money(result.subIncome)})_`);
  } else if (p.id === 'youtube') {
    lines.push(`💰 **${money(result.amount)}** aus Werbung – ` +
      `dazu **${Math.round(result.stock).toLocaleString('de-DE')}** Aufrufe im Katalog, ` +
      'die in den nächsten Tagen noch zahlen.');
  } else if (p.id === 'instagram') {
    lines.push(result.coop
      ? `💰 **${money(result.amount)}** für die Kooperation.`
      : '💰 Instagram selbst zahlt dir **nichts** – das machen nur die Marken.');
  } else {
    lines.push('💰 Twitter zahlt dir **keinen Cent**. Dafür läuft jetzt die Promo:' +
      ` deine nächste Aktion startet mit **+${Math.round(result.boost * 100)} %** Reichweite.`);
  }

  if (result.levelBonus > 0) lines.push('🏆 inkl. Level-Zuschlag');
  if (result.lostToIdle > 0) {
    lines.push(`📉 Die Pause hat **${result.lostToIdle.toLocaleString('de-DE')}** ` +
      `${p.followerName} gekostet.`);
  }
  if (result.broke) lines.push(`💥 Dein **${p.gear}** ist dabei kaputtgegangen.`);

  lines.push(`💬 _${result.comment}_`);
  return lines.join('\n');
}

module.exports = {
  PLATFORMS: data.PLATFORMS, PLATFORM_IDS,
  TIME_PER_DAY, SPILL, CROSS_CONV, SPREAD, MAX_IDLE_DAYS,
  HYPE_MIN, HYPE_MAX, BOOST_MAX, BOOST_MS, COMMUNITY_MAX, COMMUNITY_CHURN_CUT,
  IDLE_GRACE_DAYS,
  YT_RPV, YT_TAIL, YT_TAIL_KEEP, MAX_SUB_SHARE, BREAK_CHANCE,
  platform, format, formats, reachOf, hasGear, remainingMs, budget, today, cleanTitle,
  idleDays, communityNow, churnFactor, keepFactor, activeBoost,
  fatigueNow, energyFactor, merchUnlocked, settleMerch, rollDeal, settleDeals,
  accept, decline,
  FATIGUE_MAX, FATIGUE_PER_TIME, FATIGUE_MALUS, FATIGUE_RECOVERY,
  MERCH_MIN_REACH, MERCH_DAILY_CAP, MERCH_FACTOR, merchPerDay,
  DEAL_MIN_REACH, DEAL_PENALTY, DEAL_MAX_OFFERS, DEAL_REACH_EXP,
  rollEvent, rollDonations, simulate, settle, act, status, describe,
  FAME_RANKS, FAME_PER_LEVEL, fameScore, fameOf,
};
