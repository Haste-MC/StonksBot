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
 * Volle Tage ohne Berührung (der erste Tag ist frei).
 *
 * Gerechnet wird ab `touched_at`, nicht ab der letzten Aktion: Sonst könnte
 * man Reichweite auf einer Plattform parken, die man nie wieder anfasst –
 * der Verfall würde ewig aufgeschoben.
 */
function idleDays(lastAt, now) {
  if (!lastAt) return 0;
  return clamp(0, MAX_IDLE_DAYS, Math.floor((now - lastAt) / DAY_MS));
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
    cross = 0, community = 0, boost = 0, idleDays: idle = 0, random = Math.random,
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
    * (event.audience ?? 1) * (1 + boost)));

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
    result.community = (fmt.community ?? 1) * (0.8 + quality * 0.6);
  }

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
 * Eine Aktion auf einer Plattform.
 *
 * Der Zustand wird **vor** der Geldbuchung geschrieben (§7): Ein zweiter
 * schneller Klick findet den Cooldown vor. Ausgezahlt wird genau einmal (§9).
 */
async function act(guildId, userId, platformId, formatId, now = Date.now(), random = Math.random) {
  const p = platform(platformId);
  if (!p) return { ok: false, reason: 'unknown_platform' };
  const fmt = format(platformId, formatId);
  if (!fmt) return { ok: false, reason: 'unknown_format', platform: p };

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
  const cross = [...rows.values()]
    .filter((r) => r.platform !== platformId)
    .reduce((sum, r) => sum + r.followers, 0);

  const community = communityNow(state, now);
  const boost = activeBoost(state, now);

  const sim = simulate(own, p, fmt, {
    cross, community, boost,
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
  });

  const broke = (sim.event.breaks || random() < BREAK_CHANCE) && p.gear
    ? db.consumeNamed(guildId, userId, p.gear) : false;

  const balance = amount > 0
    ? await changeCash(guildId, userId, amount, `${p.name}: ${fmt.name}`)
    : null;

  return {
    ok: true,
    platform: p, format: fmt,
    title: pick(fmt.titles, random),
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
  const rows = new Map(db.allCreator(guildId, userId).map((r) => [r.platform, r]));

  const platforms = data.PLATFORMS.map((p) => {
    const row = rows.get(p.id) ?? { followers: 0, subs: 0, hype: 1, actions: 0,
      views_total: 0, earned_total: 0, peak_audience: 0, peak_followers: 0,
      last_action_at: 0, touched_at: 0, stock: 0 };
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
      lostToIdle: Math.round(row.followers - followers),
      idleDays: idle,
      stock: Math.round(row.stock),
      expected: Math.round(reachOf(p, followers, cross) * row.hype),
      remainingMs: remainingMs(guildId, userId, p.id, now),
      hasGear: hasGear(guildId, userId, p),
    };
  });

  return {
    platforms,
    total: platforms.reduce((s, p) => s + p.followers, 0),
    earned: platforms.reduce((s, p) => s + p.earnedTotal, 0),
    actions: platforms.reduce((s, p) => s + p.actions, 0),
    community,
    churnCut: 1 - churnFactor(community),
    boost: activeBoost(state, now),
    boostMs: Math.max(0, state.boost_until - now),
    budget: budget(guildId, userId, now),
  };
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
  YT_RPV, YT_TAIL, YT_TAIL_KEEP, MAX_SUB_SHARE, BREAK_CHANCE,
  platform, format, formats, reachOf, hasGear, remainingMs, budget, today,
  idleDays, communityNow, churnFactor, keepFactor, activeBoost,
  rollEvent, rollDonations, simulate, settle, act, status, describe,
};
