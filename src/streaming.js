const db = require('./db');
const data = require('./data/streaming');
const gearData = require('./data/gear');
// Spät gebunden, damit Tests die Geldschnittstelle ersetzen können (§8).
const unb = require('./unb');

const changeCash = (...a) => unb.changeCash(...a);

/**
 * ===========================================================================
 *  STREAMING – ein Kanal statt einer Auszahlung
 * ===========================================================================
 *
 * Angeln ist ein Wurf: Cooldown, Zufall, Geld. Streaming ist etwas anderes –
 * hier baut man über viele Sendungen eine **Reichweite** auf, und die
 * Reichweite ist es, die verdient. Wer aufhört, verliert sie wieder.
 *
 * ================== WARUM DAS KEIN GELDDRUCKER IST (§3) ==================
 * Der entscheidende Punkt ist die Form der beiden Kurven:
 *
 *     Zuschauer  ~  follower^0.62      (unterlinear: doppelt so viele
 *                                       Follower sind nicht doppelt so viele
 *                                       Zuschauer)
 *     Verlust    ~  follower           (linear: jeder Stream und jeder Tag
 *                                       kosten einen festen Anteil)
 *
 * Zuwachs wächst also langsamer als der Verlust. Es gibt damit genau einen
 * Punkt, an dem sich beides aufhebt – ein **Gleichgewicht**, über das kein
 * Kanal hinauskommt, egal wie lange jemand spielt. Zusätzlich gedeckelt:
 * höchstens MAX_STREAMS_PER_DAY Sendungen am Tag, wie die Schichten im
 * Arbeitsamt. Beides ist in test/streaming.test.js über 200 simulierte
 * Karrieren nachgerechnet, nicht behauptet.
 * =========================================================================
 *
 * Das Gegenstück dazu: Der Aufbau ist lang. Die ersten Streams sehen fünf
 * Leute, und die Kurve wird erst nach vielen Sendungen interessant.
 */

/** Ohne das geht nichts. */
const GEAR = 'Streaming-Setup';

/** Pause zwischen zwei Sendungen. */
const COOLDOWN_MS = 90 * 60 * 1000;

/** Mehr als das schafft an einem Tag niemand (wie die Schichten im Job). */
const MAX_STREAMS_PER_DAY = 4;

const DAY_MS = 24 * 60 * 60 * 1000;

// ------------------------------------------------------------- Reichweite

/** Grundzuschauer, die auch ein Kanal ohne einen einzigen Follower bekommt. */
const BASE_VIEWERS = 12;

/**
 * Zuschauer = BASE + REACH_K · follower^REACH_EXP.
 *
 * REACH_EXP < 1 ist die halbe Miete für §3: Der zehnfache Kanal hat nur die
 * gut vierfache Zuschauerzahl. Wachstum wird mit der Größe immer zäher.
 */
const REACH_K = 0.9;
const REACH_EXP = 0.62;

/** Anteil der Zuschauer, der dem Kanal folgt. */
const FOLLOW_RATE = 0.35;

/** Was ein Stream an Followern kostet (Entfolgen, Aufräumen, Langeweile). */
const CHURN_PER_STREAM = 0.014;

/** Was Nichtstun kostet – je Tag ohne Sendung. */
const CHURN_PER_DAY = 0.025;

/** Länger als so viele Tage wird Inaktivität nicht nachgerechnet. */
const MAX_IDLE_DAYS = 21;

// ------------------------------------------------------------------- Geld

/** Wie oft eine Sendung im Nachhinein noch angeklickt wird (VOD, Clips). */
const VIEWS_PER_VIEWER = [8, 16];

/** Werbeeinnahme je Aufruf. */
const REVENUE_PER_VIEW = 0.34;

/** Wahrscheinlichkeit je Zuschauer, dass er etwas spendet. */
const DONATE_CHANCE = 0.04;

/** Spanne einer einzelnen Spende. */
const DONATE_RANGE = [10, 150];

/** Anteil der Zuschauer, der ein Abo abschließt. */
const SUB_CONVERT = 0.008;

/** Abos, die je Sendung wieder gekündigt werden. */
const SUB_CHURN = 0.06;

/** Mehr als diesen Anteil der Follower abonniert nie. */
const MAX_SUB_SHARE = 0.05;

/** Einnahme je Abo und Sendung. */
const SUB_REVENUE = 12;

/** Grundrisiko, dass das Setup bei einer Sendung den Geist aufgibt. */
const BREAK_CHANCE = 0.01;

/** Grenzen der Form (Momentum). */
const HYPE_MIN = 0.6;
const HYPE_MAX = 1.6;

const byId = new Map(data.CATEGORIES.map((c) => [c.id, c]));

const clamp = (min, max, v) => Math.min(max, Math.max(min, v));
const pick = (list, random) => list[Math.floor(random() * list.length)];

/** Tagesstempel in lokaler Zeit – identisch zum Arbeitsamt. */
function today(date = new Date()) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

/** Erwartete Zuschauerzahl eines Kanals dieser Größe (ohne Zufall). */
function reachOf(followers) {
  return BASE_VIEWERS + REACH_K * Math.pow(Math.max(0, followers), REACH_EXP);
}

/** Kategorie per ID, oder null. */
function category(id) {
  return byId.get(String(id)) ?? null;
}

/** Besitzt jemand das Setup? */
function hasGear(guildId, userId) {
  return Boolean(db.ownsNamed(guildId, userId, GEAR));
}

/** Wie lange noch bis zur nächsten Sendung? (0 = jetzt) */
function remainingMs(guildId, userId, now = Date.now()) {
  const channel = db.getChannel(guildId, userId, now);
  if (!channel.last_stream_at) return 0;
  return Math.max(0, channel.last_stream_at + COOLDOWN_MS - now);
}

/** Sendungen heute und was noch geht. */
function budget(guildId, userId, now = Date.now()) {
  const channel = db.getChannel(guildId, userId, now);
  const day = today(new Date(now));
  const done = channel.day === day ? channel.streams_today : 0;
  return { done, max: MAX_STREAMS_PER_DAY, left: Math.max(0, MAX_STREAMS_PER_DAY - done) };
}

/**
 * Der Kanal, wie er *jetzt* dasteht – inklusive des Verfalls, der seit der
 * letzten Sendung aufgelaufen ist.
 *
 * Wichtig: Das ist eine reine Vorschau und schreibt nichts. Gerechnet wird
 * erst bei der nächsten Sendung (faule Abrechnung, §4) – dadurch bringt
 * wiederholtes Aufrufen der Ansicht nichts und kostet auch nichts.
 */
function status(guildId, userId, now = Date.now()) {
  const channel = db.getChannel(guildId, userId, now);
  const decayed = withDecay(channel, now);
  return {
    ...channel,
    followers: Math.round(decayed.followers),
    subs: Math.round(decayed.subs),
    lostToIdle: Math.round(channel.followers - decayed.followers),
    idleDays: idleDays(channel, now),
    viewersExpected: Math.round(reachOf(decayed.followers) * channel.hype),
    remainingMs: remainingMs(guildId, userId, now),
    budget: budget(guildId, userId, now),
    hasGear: hasGear(guildId, userId),
  };
}

/** Volle Tage ohne Sendung (der erste Tag ist frei). */
function idleDays(channel, now) {
  if (!channel.last_stream_at) return 0;
  const days = Math.floor((now - channel.last_stream_at) / DAY_MS);
  return clamp(0, MAX_IDLE_DAYS, days);
}

/** Follower und Abos, nachdem die Untätigkeit abgezogen wurde. */
function withDecay(channel, now) {
  const days = idleDays(channel, now);
  if (days <= 0) return { followers: channel.followers, subs: channel.subs };
  const keep = Math.pow(1 - CHURN_PER_DAY, days);
  return { followers: channel.followers * keep, subs: channel.subs * keep };
}

/** Würfelt ein Ereignis; riskante Kategorien ziehen die Pannen an. */
function rollEvent(cat, random = Math.random) {
  const weights = data.EVENTS.map((e) =>
    e.risky ? e.weight * (cat?.risk ?? 1) : e.weight);
  const total = weights.reduce((s, w) => s + w, 0);
  let roll = random() * total;
  for (let i = 0; i < data.EVENTS.length; i++) {
    if (roll < weights[i]) return data.EVENTS[i];
    roll -= weights[i];
  }
  return data.EVENTS[0];
}

/** Sammelt die Spenden eines Streams ein. */
function rollDonations(viewers, factor, random) {
  const chance = DONATE_CHANCE * factor;
  const entries = [];
  let total = 0;
  // Die Zuschauerzahl ist die Zahl der Würfe – jeder entscheidet für sich.
  for (let i = 0; i < viewers; i++) {
    if (random() >= chance) continue;
    // Quadratische Verzerrung: viele kleine, wenige große Beträge.
    const r = random() * random();
    const amount = Math.round(DONATE_RANGE[0] + r * (DONATE_RANGE[1] - DONATE_RANGE[0]));
    total += amount;
    if (entries.length < 3) entries.push({ amount, text: pick(data.DONATIONS, random) });
  }
  return { total, entries };
}

/**
 * ===================== DER REINE KERN =====================
 * Aus Kanalzustand + Kategorie wird der nächste Kanalzustand. Ohne Datenbank,
 * ohne Geldbuchung, ohne Zeit – nur Mathematik und ein Zufallsgenerator.
 *
 * Warum getrennt: Der Nachweis aus §3 (die Reichweite läuft nicht davon)
 * braucht Millionen Sendungen. Über die Datenbank wäre das eine Frage von
 * Minuten, hier sind es Sekunden – und der Test prüft exakt die Formeln, die
 * auch im Spiel laufen.
 *
 * @param {{followers:number, subs:number, hype:number}} state
 * @returns {object} Ergebnis der Sendung inkl. Folgezustand
 */
function simulate(state, cat, { idleDays: idle = 0, random = Math.random } = {}) {
  // 1. Was die Pause gekostet hat.
  const keep = idle > 0 ? Math.pow(1 - CHURN_PER_DAY, Math.min(idle, MAX_IDLE_DAYS)) : 1;
  const startFollowers = state.followers * keep;
  const startSubs = state.subs * keep;
  const lostToIdle = Math.round(state.followers - startFollowers);

  // 2. Tagesform und Ereignis.
  const roll = 0.55 + random() * 0.95;
  const event = rollEvent(cat, random);
  const quality = roll * state.hype;

  // 3. Reichweite.
  const viewers = Math.max(1, Math.round(
    reachOf(startFollowers) * quality * cat.reach * (event.viewers ?? 1)));
  const views = Math.round(
    viewers * (VIEWS_PER_VIEWER[0] + random() * (VIEWS_PER_VIEWER[1] - VIEWS_PER_VIEWER[0])));

  // 4. Follower: Zuwachs aus den Zuschauern, Abgang aus dem Bestand.
  const gained = Math.round(viewers * FOLLOW_RATE * cat.follow * (event.follow ?? 1));
  const lost = Math.round(startFollowers * (CHURN_PER_STREAM + (event.loss ?? 0)));
  const followers = Math.max(0, startFollowers - lost + gained);

  // 5. Abos: wachsen aus den Zuschauern, kündigen anteilig, gedeckelt.
  const subs = clamp(0, followers * MAX_SUB_SHARE,
    startSubs * (1 - SUB_CHURN) + viewers * SUB_CONVERT * cat.follow);

  // 6. Einnahmen.
  const ads = Math.round(views * REVENUE_PER_VIEW);
  const donations = rollDonations(viewers, cat.donate * (event.donate ?? 1), random);
  const subIncome = Math.round(subs * SUB_REVENUE);

  return {
    followers, subs,
    hype: clamp(HYPE_MIN, HYPE_MAX, state.hype * 0.7 + roll * 0.3),
    viewers, views, gained, lost, lostToIdle,
    ads, donations: donations.total, donationList: donations.entries, subIncome,
    base: ads + donations.total + subIncome,
    event, roll, quality,
  };
}

/**
 * Eine Sendung.
 *
 * Der komplette Kanalzustand wird **vor** der Geldbuchung in einer einzigen
 * Anweisung geschrieben (§7): Ein zweiter schneller Klick findet den Cooldown
 * vor und geht leer aus. Ausgezahlt wird genau einmal (§9) – Werbung, Spenden
 * und Abos zusammen.
 */
async function stream(guildId, userId, categoryId, now = Date.now(), random = Math.random) {
  const cat = category(categoryId);
  if (!cat) return { ok: false, reason: 'unknown_category' };

  if (!hasGear(guildId, userId)) {
    const item = gearData.findGear(GEAR);
    return { ok: false, reason: 'no_gear', gear: GEAR, price: item?.price ?? null };
  }

  const channel = db.getChannel(guildId, userId, now);

  const left = remainingMs(guildId, userId, now);
  if (left > 0) return { ok: false, reason: 'cooldown', remainingMs: left, channel };

  const day = today(new Date(now));
  const doneToday = channel.day === day ? channel.streams_today : 0;
  if (doneToday >= MAX_STREAMS_PER_DAY) {
    return {
      ok: false, reason: 'daily_limit', done: doneToday, max: MAX_STREAMS_PER_DAY,
      resetMs: new Date(new Date(now).setHours(24, 0, 0, 0)).getTime() - now,
      channel,
    };
  }

  const sim = simulate(channel, cat, { idleDays: idleDays(channel, now), random });

  const perk = require('./perks').perksOf(guildId, userId);
  const amount = Math.max(0, Math.round(sim.base * perk.income));

  // Zustand fortschreiben – synchron, vor jedem await.
  const updated = {
    followers: sim.followers,
    subs: sim.subs,
    hype: sim.hype,
    streams: channel.streams + 1,
    views_total: channel.views_total + sim.views,
    earned_total: channel.earned_total + amount,
    peak_viewers: Math.max(channel.peak_viewers, sim.viewers),
    peak_followers: Math.max(channel.peak_followers, Math.round(sim.followers)),
    last_stream_at: now,
    streams_today: doneToday + 1,
    day,
  };
  db.saveChannel(guildId, userId, updated);

  // Das Setup kann dabei kaputtgehen – wie jedes Werkzeug bei der Arbeit.
  const broke = (sim.event.breaks || random() < BREAK_CHANCE)
    ? db.consumeNamed(guildId, userId, GEAR) : false;

  // Eine einzige Buchung (§9).
  const balance = amount > 0
    ? await changeCash(guildId, userId, amount, `Stream: ${cat.name}`)
    : null;

  return {
    ok: true,
    category: cat,
    title: pick(cat.titles, random),
    intro: pick(data.INTROS, random),
    chat: pick(data.CHAT, random),
    event: sim.event.text ? sim.event : null,
    quality: sim.quality, roll: sim.roll,
    viewers: sim.viewers, views: sim.views,
    followers: Math.round(sim.followers),
    followersBefore: Math.round(channel.followers),
    gained: sim.gained, lost: sim.lost, lostToIdle: sim.lostToIdle,
    subs: Math.round(sim.subs),
    subsBefore: Math.round(channel.subs),
    ads: sim.ads, donations: sim.donations, donationList: sim.donationList,
    subIncome: sim.subIncome,
    base: sim.base, amount, levelBonus: amount - sim.base, level: perk.level,
    hype: sim.hype,
    broke, balance,
    streamsToday: updated.streams_today, maxStreams: MAX_STREAMS_PER_DAY,
    channel: updated,
  };
}

/** Fertige Meldung für Discord und Fluxer. */
function describe(result, money) {
  if (!result.ok) return null;
  const c = result.category;

  const lines = [
    `${c.emoji} ${result.intro} **„${result.title}"**`,
    `👀 **${result.viewers.toLocaleString('de-DE')}** Zuschauer · ` +
    `▶️ ${result.views.toLocaleString('de-DE')} Aufrufe`,
  ];

  if (result.event) lines.push(result.event.text);

  const follow = result.followers - result.followersBefore;
  lines.push(
    `👥 Follower: **${result.followers.toLocaleString('de-DE')}** ` +
    `(${follow >= 0 ? '+' : ''}${follow.toLocaleString('de-DE')})` +
    (result.subs > 0 ? ` · ⭐ ${result.subs} Abos` : ''));

  if (result.donationList.length > 0) {
    lines.push(result.donationList
      .map((d) => `💸 _„${d.text}"_`).join('\n'));
  }

  lines.push(
    `💰 **${money(result.amount)}** ` +
    `_(Werbung ${money(result.ads)} · Spenden ${money(result.donations)} · ` +
    `Abos ${money(result.subIncome)})_` +
    (result.levelBonus > 0 ? `\n🏆 inkl. Level-Zuschlag` : ''));

  if (result.lostToIdle > 0) {
    lines.push(`📉 Die Pause hat **${result.lostToIdle.toLocaleString('de-DE')}** Follower gekostet.`);
  }
  if (result.broke) lines.push(`💥 Dein **${GEAR}** ist dabei kaputtgegangen.`);

  lines.push(`💬 _${result.chat}_`);
  return lines.join('\n');
}

module.exports = {
  GEAR, COOLDOWN_MS, MAX_STREAMS_PER_DAY, CATEGORIES: data.CATEGORIES,
  BASE_VIEWERS, REACH_K, REACH_EXP, FOLLOW_RATE,
  CHURN_PER_STREAM, CHURN_PER_DAY, MAX_IDLE_DAYS,
  REVENUE_PER_VIEW, DONATE_CHANCE, SUB_CONVERT, SUB_CHURN, SUB_REVENUE, MAX_SUB_SHARE,
  BREAK_CHANCE, HYPE_MIN, HYPE_MAX,
  reachOf, category, hasGear, remainingMs, budget, status, today,
  rollEvent, rollDonations, simulate, stream, describe, withDecay, idleDays,
};
