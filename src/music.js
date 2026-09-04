const db = require('./db');
const data = require('./data/music');
// Spät gebunden, damit Tests die Geldschnittstelle ersetzen können (§8).
const unb = require('./unb');

const changeCash = (...a) => unb.changeCash(...a);

/**
 * ===========================================================================
 *  MUSIK – die Königsdisziplin ohne eigene Firma
 * ===========================================================================
 *
 * Rechnet wie das Creator-Netzwerk, nur eine Stufe höher: **monatliche
 * Hörer** statt Follower, **Tantiemen** statt Werbegeld – und die zahlen
 * weiter, während man schläft.
 *
 * Was Musik von allem anderen unterscheidet:
 *
 *   • **Das Land entscheidet mit.** Die Szene bestimmt, wie viele Hörer
 *     überhaupt zu holen sind, die Tantiemen, was ein Abruf abwirft (Japan
 *     zahlt das Siebenfache Indiens), und die Strenge, wie schnell man
 *     vergessen wird und wie hart Skandale treffen.
 *   • **Zwei Wege.** Mit Gesicht wächst alles mit – die Kanäle, die Gagen,
 *     das Risiko. Anonym (wie Ado) zieht das Rätsel mehr Abrufe, schützt vor
 *     Ärger, lässt die Socials aber klein.
 *   • **Idol-Verträge.** In Japan und Südkorea klopft ab einer gewissen Größe
 *     eine Agentur an: doppeltes Wachstum, größere Hallen – gegen die Hälfte
 *     der Einnahmen und einen Teil der Freiheit.
 *   • **Alles hängt zusammen.** Hörer zählen als Publikum auf den Kanälen,
 *     Kanalreichweite hilft der Musik, und beide teilen sich denselben Tag.
 *
 * ================== WARUM DAS KEIN GELDDRUCKER IST (§3) ==================
 * Dieselbe Form wie überall: Der Zuwachs an Hörern wächst unterlinear
 * (`hörer^0,6`), der Verlust linear (Abgänge je Release + Vergessen je Tag,
 * mal Strenge des Landes). Daraus folgt ein Gleichgewicht je Land und Genre.
 * Nachgerechnet in test/music.test.js.
 * =========================================================================
 */

const DAY_MS = 24 * 60 * 60 * 1000;

// ------------------------------------------------------------ Reichweite

/** Hörer, die ein Release ohne jede Fanbasis erreicht. */
const BASE_REACH = 40;
const REACH_K = 3.5;
const REACH_EXP = 0.60;

/**
 * Tempo der ganzen Karriere.
 *
 * Multipliziert Zuwachs UND Abgang – dasselbe Gleichgewicht, nur langsamer
 * erreicht (dieselbe Mechanik wie `speed` bei den Sprachen). Musik soll die
 * schwerste Disziplin sein: Ein Kanal steht nach einem Jahr, ein Name in der
 * Musik braucht zwei.
 */
const TEMPO = 0.5;

/** Anteil des Publikums einer Veröffentlichung, der Hörer bleibt. */
const CONVERSION = 0.5;

/** Hörer, die bei jeder Veröffentlichung abspringen. */
const CHURN_PER_RELEASE = 0.02;

/** Vergessen je Tag ohne Lebenszeichen – mal Strenge des Landes. */
const CHURN_PER_DAY = 0.012;
const MAX_IDLE_DAYS = 30;
const IDLE_GRACE_DAYS = 2;          // Musik verzeiht länger als ein Kanal

/** Wie stark Kanalreichweite in die Musik hineinzählt. */
const CREATOR_SPILL = 0.08;

/** Wie stark Hörer als Publikum auf den Kanälen zählen. */
const MUSIC_TO_CREATOR = 0.18;

/** Anteil des Release-Publikums, der auf den Kanälen hängenbleibt. */
const SOCIAL_SPILL = 0.05;

// ------------------------------------------------------------------ Geld

/** Abrufe je Hörer und Tag. */
const PLAYS_PER_LISTENER = 0.5;

/** Was ein Abruf abwirft, vor Land und Vermarktung. */
const ROYALTY = 1.2;

/** Der Schub aus einer Veröffentlichung klingt so schnell ab. */
const BUZZ_KEEP = 0.82;
const BUZZ_PER_LISTENER = 9;

const MIN_SETTLE_MS = 60 * 60 * 1000;
const MAX_SETTLE_DAYS = 14;

// -------------------------------------------------------------- Aktionen

const RECORD_TIME = 3;
const RECORD_COOLDOWN_MIN = 6 * 60;
const RELEASE_COOLDOWN_MIN = 20 * 60;
const SHOW_TIME = 4;
const SHOW_COOLDOWN_MIN = 3 * 24 * 60;
const SHOW_MIN_LISTENERS = 5_000;
const SHOW_PAY = 8;                 // Faktor auf hörer^0,7
const SHOW_EXP = 0.7;

/** Ohne das geht im Studio nichts. */
const GEAR = 'Streaming-Setup';

/** Grenzen der Form. */
const HYPE_MIN = 0.6;
const HYPE_MAX = 1.7;

// ------------------------------------------------------------- Verträge

/** Wie wahrscheinlich eine Agentur anklopft (je Veröffentlichung). */
const CONTRACT_CHANCE = 0.25;
const CONTRACT_OFFER_MS = 3 * DAY_MS;

const AGENCIES = {
  jp: ['Sakura Entertainment', 'Hoshi Music', 'Tsuki Agency', 'Neo Tokyo Sound'],
  kr: ['Hanbit Entertainment', 'Studio Vega', 'Seoul Wave', 'Aurora Media'],
};

const genreById = new Map(data.GENRES.map((g) => [g.id, g]));
const releaseById = new Map(data.RELEASES.map((r) => [r.id, r]));
const personaById = new Map(data.PERSONAS.map((p) => [p.id, p]));

const clamp = (min, max, v) => Math.min(max, Math.max(min, v));
const pick = (list, random) => list[Math.floor(random() * list.length)];

/** Genre, Release-Art und Auftrittsform per ID. */
function genre(id) { return genreById.get(String(id ?? '')) ?? null; }
function release(id) { return releaseById.get(String(id ?? '')) ?? null; }
function persona(id) {
  return personaById.get(String(id ?? '')) ?? { ...data.PERSONAS[0], id: '', name: 'noch offen' };
}

/** Der Künstler eines Spielers. */
function artistOf(guildId, userId, now = Date.now()) {
  return db.getArtist(guildId, userId, now);
}

/** Hat der Spieler überhaupt schon angefangen? */
function started(guildId, userId) {
  const a = db.getArtist(guildId, userId);
  return Boolean(a.genre && a.persona);
}

/**
 * Der Musikmarkt: Sprache und Kaufkraft kommen aus home.js, Szene, Tantiemen
 * und Strenge aus dem Land.
 */
function marketOf(guildId, userId) {
  const home = require('./home');
  const base = home.marketOf(guildId, userId);
  const music = base.country.music ?? { scene: 1, royalty: 1, idol: false, strict: 0.4 };
  return { ...base, ...music };
}

/** Tage ohne Lebenszeichen, abzüglich Schonfrist. */
function idleDays(lastAt, now) {
  if (!lastAt) return 0;
  return clamp(0, MAX_IDLE_DAYS, (now - lastAt) / DAY_MS - IDLE_GRACE_DAYS);
}

/** Anteil der Hörer, der eine Pause überlebt – strenge Märkte vergessen schneller. */
function keepFactor(row, market, now) {
  const idle = idleDays(row.touched_at || row.last_action_at, now);
  if (idle <= 0) return 1;
  return Math.pow(1 - CHURN_PER_DAY * (0.5 + market.strict), Math.min(idle, MAX_IDLE_DAYS));
}

/**
 * Wie viele Hörer eine Veröffentlichung erreicht.
 *
 * Die Szene geht mit `scene^(1-exp)` ein, nicht roh: So skaliert die
 * **Obergrenze linear** mit der Größe des Musikmarkts. Roh eingesetzt wäre
 * eine halb so große Szene eine sechsmal kleinere Decke gewesen – Rumänien
 * wäre unspielbar geworden.
 */
function reachOf(listeners, cross = 0, market = { scene: 1, pool: 1 }) {
  const pool = Math.max(0, listeners) + CREATOR_SPILL * Math.max(0, cross);
  return (BASE_REACH + REACH_K * Math.pow(pool, REACH_EXP))
    * Math.pow(Math.max(0.05, market.scene), 1 - REACH_EXP);
}

/** Was die Musik den Kanälen an Publikum zuträgt (siehe creator.js). */
function reachBonus(guildId, userId) {
  try {
    const a = db.getArtist(guildId, userId);
    return Math.round((a?.listeners ?? 0) * MUSIC_TO_CREATOR);
  } catch { return 0; }
}

/** Läuft gerade ein Vertrag? */
function contractOf(guildId, userId) {
  return db.activeContract(guildId, userId);
}

/** Die Vertragsbedingungen (aktuell nur Idol). */
function terms(kind) {
  return kind === 'idol' ? data.IDOL : null;
}

/** Gemeinsames Tagesbudget mit den Kanälen. */
function useTime(guildId, userId, cost, now) {
  return require('./creator').useTime(guildId, userId, cost, now);
}

/** Rechnet den Verfall an und gibt den Künstler mit aktuellen Zahlen zurück. */
function decayed(row, market, now) {
  const keep = keepFactor(row, market, now);
  return {
    listeners: row.listeners * keep,
    lost: Math.round(row.listeners - row.listeners * keep),
  };
}

/**
 * Der Anfang: Genre und Auftrittsform wählen.
 *
 * Beides einmal frei. Das Genre lässt sich später wechseln (kostet Hörer),
 * die Auftrittsform nur in eine Richtung: Wer sich einmal gezeigt hat, kann
 * das Gesicht nicht zurücknehmen.
 */
function setup(guildId, userId, genreId, personaId, now = Date.now()) {
  const g = genre(genreId);
  const p = personaById.get(String(personaId ?? ''));
  if (!g) return { ok: false, reason: 'unknown_genre' };
  if (!p) return { ok: false, reason: 'unknown_persona' };

  const row = db.getArtist(guildId, userId, now);
  if (row.genre && row.persona) return { ok: false, reason: 'already_started' };

  db.saveArtist(guildId, userId, {
    ...row, genre: g.id, persona: p.id, hype: 1,
    started_at: now, touched_at: now, paid_through: now,
  });
  return { ok: true, genre: g, persona: p };
}

/** Genre wechseln – die alten Hörer kommen nicht alle mit. */
const GENRE_SWITCH_LOSS = 0.3;

function setGenre(guildId, userId, genreId, now = Date.now()) {
  const g = genre(genreId);
  if (!g) return { ok: false, reason: 'unknown_genre' };
  const row = db.getArtist(guildId, userId, now);
  if (!row.genre) return { ok: false, reason: 'not_started' };
  if (row.genre === g.id) return { ok: false, reason: 'already_set', genre: g };

  const lost = Math.round(row.listeners * GENRE_SWITCH_LOSS);
  db.saveArtist(guildId, userId, {
    ...row, genre: g.id, listeners: row.listeners - lost, touched_at: now,
  });
  return { ok: true, genre: g, from: genre(row.genre), lost };
}

/**
 * Die Enthüllung: vom anonymen Künstler zum Gesicht.
 *
 * Ein einmaliges Ereignis mit gewaltigem Schub – und danach unumkehrbar.
 * Andersherum geht es nicht: Ein Gesicht, das man kennt, wird man nicht mehr
 * los.
 */
const REVEAL_BUZZ = 6;
const REVEAL_GROWTH = 0.35;

function reveal(guildId, userId, now = Date.now()) {
  const row = db.getArtist(guildId, userId, now);
  if (!row.persona) return { ok: false, reason: 'not_started' };
  if (row.persona === 'face') return { ok: false, reason: 'already_face' };
  if (db.activeContract(guildId, userId)) return { ok: false, reason: 'contract' };

  const gained = Math.round(row.listeners * REVEAL_GROWTH);
  db.saveArtist(guildId, userId, {
    ...row,
    persona: 'face',
    listeners: row.listeners + gained,
    buzz: row.buzz + row.listeners * REVEAL_BUZZ,
    hype: clamp(HYPE_MIN, HYPE_MAX, row.hype * 1.3),
    touched_at: now, last_action_at: now,
  });
  return { ok: true, gained, listeners: row.listeners + gained };
}

// ------------------------------------------------------------------ Studio

/**
 * Wie lange noch bis zur nächsten Aktion dieser Art?
 *
 * Jede Art hat ihren eigenen Zeitstempel: Wer aufnimmt, soll deshalb nicht
 * warten müssen, bis die Pause fürs nächste Album vorbei ist.
 */
function remainingMs(row, field, minutes, now) {
  const at = row[field] || 0;
  if (!at) return 0;
  return Math.max(0, at + minutes * 60 * 1000 - now);
}

/** Besitzt der Spieler die nötige Technik? */
function hasGear(guildId, userId) {
  return Boolean(db.ownsNamed(guildId, userId, GEAR));
}

/**
 * Eine Studiosession: ein Titel mehr im Kasten.
 *
 * Kostet Zeit aus dem gemeinsamen Tagesbudget – wer aufnimmt, streamt heute
 * nicht mehr viel.
 */
function record(guildId, userId, now = Date.now(), random = Math.random) {
  const row = db.getArtist(guildId, userId, now);
  if (!row.genre || !row.persona) return { ok: false, reason: 'not_started' };
  if (!hasGear(guildId, userId)) {
    return { ok: false, reason: 'no_gear', gear: GEAR };
  }

  const left = remainingMs(row, 'last_record_at', RECORD_COOLDOWN_MIN, now);
  if (left > 0) return { ok: false, reason: 'cooldown', remainingMs: left };

  const time = useTime(guildId, userId, RECORD_TIME, now);
  if (!time.ok) return { ok: false, reason: 'no_time', need: RECORD_TIME, ...time };

  const quality = 0.7 + random() * 0.7;
  db.saveArtist(guildId, userId, {
    ...row,
    songs: row.songs + 1,
    hype: clamp(HYPE_MIN, HYPE_MAX, row.hype * 0.85 + quality * 0.15),
    last_action_at: now, last_record_at: now, touched_at: now,
  });

  return {
    ok: true, songs: row.songs + 1, quality,
    text: pick(data.STUDIO, random), time,
  };
}

/**
 * ===================== DER REINE KERN =====================
 * Aus Zustand + Veröffentlichung wird der nächste Zustand. Ohne Datenbank,
 * ohne Geld – damit sich das Gleichgewicht über zehntausende Releases
 * nachrechnen lässt (test/music.test.js). Dieselbe Trennung wie beim Creator.
 */
function simulateRelease(state, {
  type, genre: g, persona: p, market, idol = null, creatorReach = 0,
  idleDays: idle = 0, random = Math.random,
}) {
  // 1. Was die Pause gekostet hat.
  const keep = idle > 0
    ? Math.pow(1 - CHURN_PER_DAY * (0.5 + market.strict), Math.min(idle, MAX_IDLE_DAYS)) : 1;
  const startListeners = state.listeners * keep;
  const lostToIdle = Math.round(state.listeners - startListeners);

  // 2. Wen die Veröffentlichung erreicht.
  const roll = 0.6 + random() * 0.9;
  const audience = Math.max(1, Math.round(
    reachOf(startListeners, creatorReach, market) * roll * state.hype * g.reach * type.spike));

  /*
   * 3. Hörer. Zwei Beschleuniger – Agenturschub und Sprachtempo – wirken auf
   *    Zuwachs UND Abgang: schneller, nicht größer. Die Decke bestimmen
   *    allein Szene und Genre (§3).
   */
  const boost = (idol ? idol.growth : 1) * market.speed;
  const gained = Math.round(
    audience * CONVERSION * TEMPO * boost * type.growth * g.reach * p.growth);
  const lost = Math.round(startListeners * CHURN_PER_RELEASE * TEMPO * boost);
  const listeners = Math.max(0, startListeners - lost + gained);

  // 4. Der Schub an Abrufen klingt über Tage ab.
  const buzz = state.buzz + audience * BUZZ_PER_LISTENER * type.spike * p.plays;

  // 5. Charts: erst ab echter Reichweite.
  const position = audience >= 1000
    ? clamp(1, 100, Math.round(112 - Math.log10(audience) * 24)) : 0;

  return {
    audience, gained, lost, lostToIdle, listeners, buzz, position, roll,
    hype: clamp(HYPE_MIN, HYPE_MAX, state.hype * 0.7 + roll * 0.3),
  };
}

/**
 * Veröffentlichen. Verbraucht aufgenommene Titel, bringt Hörer und einen
 * Schub an Abrufen – und manchmal eine Chartplatzierung.
 */
function publish(guildId, userId, typeId, now = Date.now(), random = Math.random) {
  const type = release(typeId);
  if (!type) return { ok: false, reason: 'unknown_release' };

  const row = db.getArtist(guildId, userId, now);
  if (!row.genre || !row.persona) return { ok: false, reason: 'not_started' };
  if (row.songs < type.songs) {
    return { ok: false, reason: 'no_songs', need: type.songs, have: row.songs, release: type };
  }

  const left = remainingMs(row, 'last_release_at', RELEASE_COOLDOWN_MIN, now);
  if (left > 0) return { ok: false, reason: 'cooldown', remainingMs: left, release: type };

  const time = useTime(guildId, userId, type.time, now);
  if (!time.ok) return { ok: false, reason: 'no_time', need: type.time, release: type, ...time };

  const market = marketOf(guildId, userId);
  const g = genre(row.genre);
  const p = persona(row.persona);
  const contract = db.activeContract(guildId, userId);
  const idol = contract ? data.IDOL : null;

  const creatorReach = require('./creator').status(guildId, userId).total;
  const sim = simulateRelease(row, {
    type, genre: g, persona: p, market, idol, creatorReach,
    idleDays: idleDays(row.touched_at || row.last_action_at, now), random,
  });

  const { audience, gained, lost, listeners, buzz, position } = sim;
  const charted = position > 0;
  const best = charted && (row.best_chart === 0 || position < row.best_chart)
    ? position : row.best_chart;

  db.saveArtist(guildId, userId, {
    ...row,
    songs: row.songs - type.songs,
    releases: row.releases + 1,
    listeners,
    buzz,
    best_chart: best,
    peak_listeners: Math.max(row.peak_listeners, Math.round(listeners)),
    hype: sim.hype,
    last_action_at: now, last_release_at: now, touched_at: now,
    paid_through: row.paid_through || now,
  });

  // 6. Die Kanäle wachsen mit – jeder erfolgreiche Künstler hat Socials.
  const spill = Math.round(audience * SOCIAL_SPILL * p.social);
  const spilled = [];
  for (const id of require('./creator').PLATFORM_IDS) {
    if (spill <= 0) break;
    db.addCreatorFollowers(guildId, userId, id, spill, 1, now);
    spilled.push({ platform: id, delta: spill });
  }

  // 7. Klopft eine Agentur an?
  const offer = rollContract(guildId, userId, listeners, market, now, random);

  return {
    ok: true, release: type, genre: g, persona: p,
    audience, gained, lost, lostToIdle: sim.lostToIdle,
    listeners: Math.round(listeners), listenersBefore: row.listeners,
    buzz, position: charted ? position : 0, best,
    spill, spilled, offer, time,
    songsLeft: row.songs - type.songs,
    text: charted
      ? pick(data.CHART_NEWS, random).replace('{platz}', String(position))
      : null,
  };
}

/**
 * Ein Konzert. Zahlt sofort und richtig – aber nur, wer genug Hörer hat,
 * bekommt eine Halle voll.
 */
async function show(guildId, userId, now = Date.now(), random = Math.random) {
  const row = db.getArtist(guildId, userId, now);
  if (!row.genre || !row.persona) return { ok: false, reason: 'not_started' };

  const market = marketOf(guildId, userId);
  const before = decayed(row, market, now);
  if (before.listeners < SHOW_MIN_LISTENERS) {
    return {
      ok: false, reason: 'too_small',
      have: Math.round(before.listeners), need: SHOW_MIN_LISTENERS,
    };
  }

  const left = remainingMs(row, 'last_show_at', SHOW_COOLDOWN_MIN, now);
  if (left > 0) return { ok: false, reason: 'cooldown', remainingMs: left };

  const time = useTime(guildId, userId, SHOW_TIME, now);
  if (!time.ok) return { ok: false, reason: 'no_time', need: SHOW_TIME, ...time };

  const g = genre(row.genre);
  const p = persona(row.persona);
  const contract = db.activeContract(guildId, userId);
  const idol = contract ? data.IDOL : null;

  const quality = 0.75 + random() * 0.6;
  const gross = Math.round(
    Math.pow(before.listeners, SHOW_EXP) * SHOW_PAY
    * market.scene * market.deal * g.live * p.live * quality
    * (idol ? idol.liveBonus : 1));

  // Ein Konzert bindet: Wer live gesehen hat, bleibt eher.
  const gained = Math.round(before.listeners * 0.02 * quality);

  db.saveArtist(guildId, userId, {
    ...row,
    shows: row.shows + 1,
    listeners: before.listeners + gained,
    peak_listeners: Math.max(row.peak_listeners, Math.round(before.listeners + gained)),
    hype: clamp(HYPE_MIN, HYPE_MAX, row.hype * 0.8 + quality * 0.3),
    last_action_at: now, last_show_at: now, touched_at: now,
  });

  const cut = idol ? Math.round(gross * idol.cut) : 0;
  const net = gross - cut;
  const balance = await changeCash(guildId, userId, net, `Konzert: ${g.name}`);

  return {
    ok: true, gross, cut, amount: net, gained, quality, genre: g,
    text: pick(data.SHOWS, random), balance, time,
    listeners: Math.round(before.listeners + gained),
  };
}

/**
 * Tantiemen abrechnen – der eigentliche Ertrag.
 *
 * Faule Abrechnung (§4): Beim ersten Mal nur den Zeitstempel setzen, danach
 * zählt allein die vergangene Zeit. Bezahlt werden die laufenden Abrufe der
 * Hörerschaft plus der abklingende Schub der letzten Veröffentlichung.
 */
async function settle(guildId, userId, now = Date.now()) {
  const row = db.getArtist(guildId, userId, now);
  if (!row.genre) return null;

  if (!row.paid_through) {
    db.saveArtist(guildId, userId, { ...row, paid_through: now });
    return null;
  }
  const elapsed = now - row.paid_through;
  if (elapsed < MIN_SETTLE_MS) return null;

  const market = marketOf(guildId, userId);
  const days = Math.min(MAX_SETTLE_DAYS, elapsed / DAY_MS);
  const p = persona(row.persona);

  const steady = row.listeners * PLAYS_PER_LISTENER * p.plays * days;
  const fromBuzz = row.buzz * (1 - Math.pow(BUZZ_KEEP, days));
  const streams = steady + fromBuzz;

  const mon = require('./creator').monetization(row.listeners, market.pool);
  const gross = Math.round(streams * ROYALTY * market.royalty * mon);

  const contract = db.activeContract(guildId, userId);
  const cut = contract ? Math.round(gross * data.IDOL.cut) : 0;
  const net = gross - cut;

  db.saveArtist(guildId, userId, {
    ...row,
    buzz: row.buzz - fromBuzz,
    streams_total: row.streams_total + Math.round(streams),
    earned_total: row.earned_total + net,
    paid_through: now,
  });
  if (net <= 0) return null;

  const perk = require('./perks').perksOf(guildId, userId);
  const paid = Math.max(0, Math.round(net * perk.income));
  const balance = await changeCash(guildId, userId, paid, 'Tantiemen');
  return { amount: paid, streams: Math.round(streams), cut, days, balance };
}

// -------------------------------------------------------------- Verträge

/**
 * Klopft eine Agentur an?
 *
 * Nur in Ländern mit Idol-System, nur mit Gesicht, nur ab einer gewissen
 * Größe – und nur, wenn nicht schon ein Vertrag läuft.
 */
function rollContract(guildId, userId, listeners, market, now = Date.now(), random = Math.random) {
  if (!market.idol) return null;
  if (listeners < data.IDOL.minListeners) return null;
  if (db.activeContract(guildId, userId)) return null;
  if (db.openContract(guildId, userId, now)) return null;

  const row = db.getArtist(guildId, userId, now);
  if (row.persona !== 'face') return null;
  if (random() >= CONTRACT_CHANCE) return null;

  const agencies = AGENCIES[market.country.id] ?? AGENCIES.jp;
  return db.insertContract({
    guildId, userId, kind: 'idol',
    agency: agencies[Math.floor(random() * agencies.length)],
    country: market.country.id,
    createdAt: now,
    expiresAt: now + CONTRACT_OFFER_MS,
  });
}

/** Ein Angebot annehmen. */
/** Der Vorschuss bei Unterschrift, in Tagen laufender Tantiemen. */
const IDOL_ADVANCE_DAYS = 25;

async function sign(guildId, userId, contractId, now = Date.now()) {
  const row = db.getContract(guildId, contractId);
  if (!row || row.user_id !== String(userId)) return { ok: false, reason: 'not_found' };
  if (row.status !== 'offer') return { ok: false, reason: 'gone' };
  if (row.expires_at <= now) {
    db.setContractStatus(guildId, row.id, 'expired');
    return { ok: false, reason: 'expired' };
  }
  if (db.activeContract(guildId, userId)) return { ok: false, reason: 'busy' };

  const ends = now + data.IDOL.durationDays * DAY_MS;
  db.setContractStatus(guildId, row.id, 'active', { signedAt: now, endsAt: ends });

  // Vorschuss: Die Agentur zahlt bei Unterschrift. Ohne ihn wäre der Vertrag
  // nur ein Abzug mit Zusatzregeln – niemand würde ihn nehmen.
  const artist = db.getArtist(guildId, userId, now);
  const market = marketOf(guildId, userId);
  const advance = Math.round(
    artist.listeners * PLAYS_PER_LISTENER * ROYALTY * market.royalty * IDOL_ADVANCE_DAYS);
  const balance = advance > 0
    ? await changeCash(guildId, userId, advance, `Vorschuss: ${row.agency}`) : null;

  return {
    ok: true, advance, balance,
    contract: { ...row, status: 'active', signed_at: now, ends_at: ends },
    terms: data.IDOL,
  };
}

/** Ein Angebot ablehnen. */
function decline(guildId, userId, contractId) {
  const row = db.getContract(guildId, contractId);
  if (!row || row.user_id !== String(userId)) return { ok: false, reason: 'not_found' };
  if (row.status !== 'offer') return { ok: false, reason: 'gone' };
  db.setContractStatus(guildId, row.id, 'expired');
  return { ok: true, contract: row };
}

/**
 * Vorzeitig aussteigen. Kostet die vereinbarte Strafe – und die Agentur
 * erzählt es weiter.
 */
async function leave(guildId, userId, now = Date.now()) {
  const contract = db.activeContract(guildId, userId);
  if (!contract) return { ok: false, reason: 'no_contract' };

  const row = db.getArtist(guildId, userId, now);
  const market = marketOf(guildId, userId);
  const perDay = row.listeners * PLAYS_PER_LISTENER * ROYALTY * market.royalty;
  const penalty = Math.round(perDay * data.IDOL.exitPenaltyDays);

  db.setContractStatus(guildId, contract.id, 'broken', {
    signedAt: contract.signed_at, endsAt: now,
  });
  db.saveArtist(guildId, userId, {
    ...row,
    listeners: Math.round(row.listeners * 0.9),
    hype: clamp(HYPE_MIN, HYPE_MAX, row.hype * 0.8),
    touched_at: now,
  });

  const balance = penalty > 0
    ? await changeCash(guildId, userId, -penalty, `Vertragsstrafe: ${contract.agency}`)
    : null;
  return { ok: true, contract, penalty, balance };
}

/** Abgelaufene Verträge und Angebote aufräumen (faul, §4). */
function settleContracts(guildId, userId, now = Date.now()) {
  const active = db.activeContract(guildId, userId);
  if (active && active.ends_at && active.ends_at <= now) {
    db.setContractStatus(guildId, active.id, 'done', {
      signedAt: active.signed_at, endsAt: active.ends_at,
    });
    return { ended: active };
  }
  return { ended: null };
}

/** Alles, was die Anzeige über einen Künstler wissen muss. */
function status(guildId, userId, now = Date.now()) {
  const row = db.getArtist(guildId, userId, now);
  const market = marketOf(guildId, userId);
  const g = genre(row.genre);
  const p = persona(row.persona);
  const contract = db.activeContract(guildId, userId);
  const offer = db.openContract(guildId, userId, now);
  const after = decayed(row, market, now);

  const budget = require('./creator').budget(guildId, userId, now);
  const perDay = Math.round(
    after.listeners * PLAYS_PER_LISTENER * (p.plays ?? 1) * ROYALTY * market.royalty
    * require('./creator').monetization(after.listeners, market.pool)
    * (contract ? 1 - data.IDOL.cut : 1));

  return {
    ...row,
    started: Boolean(row.genre && row.persona),
    genre: g, persona: p, market,
    listeners: Math.round(after.listeners),
    lostToIdle: after.lost,
    buzz: Math.round(row.buzz),
    perDay,
    contract,
    contractEndsMs: contract?.ends_at ? Math.max(0, contract.ends_at - now) : 0,
    offer,
    offerEndsMs: offer ? Math.max(0, offer.expires_at - now) : 0,
    canIdol: Boolean(market.idol),
    budget,
    recordMs: remainingMs(row, 'last_record_at', RECORD_COOLDOWN_MIN, now),
    releaseMs: remainingMs(row, 'last_release_at', RELEASE_COOLDOWN_MIN, now),
    showMs: remainingMs(row, 'last_show_at', SHOW_COOLDOWN_MIN, now),
    hasGear: hasGear(guildId, userId),
  };
}

module.exports = {
  GENRES: data.GENRES, RELEASES: data.RELEASES, PERSONAS: data.PERSONAS, IDOL: data.IDOL,
  BASE_REACH, REACH_K, REACH_EXP, CHURN_PER_RELEASE, CHURN_PER_DAY, MAX_IDLE_DAYS,
  IDLE_GRACE_DAYS, CREATOR_SPILL, MUSIC_TO_CREATOR, SOCIAL_SPILL,
  PLAYS_PER_LISTENER, ROYALTY, BUZZ_KEEP, BUZZ_PER_LISTENER, MAX_SETTLE_DAYS,
  TEMPO, CONVERSION,
  RECORD_TIME, RECORD_COOLDOWN_MIN, RELEASE_COOLDOWN_MIN,
  SHOW_TIME, SHOW_COOLDOWN_MIN, SHOW_MIN_LISTENERS, SHOW_PAY, SHOW_EXP,
  GEAR, HYPE_MIN, HYPE_MAX, CONTRACT_CHANCE, CONTRACT_OFFER_MS, AGENCIES,
  GENRE_SWITCH_LOSS, REVEAL_BUZZ, REVEAL_GROWTH,
  genre, release, persona, artistOf, started, marketOf, idleDays, keepFactor,
  reachOf, reachBonus, contractOf, terms, simulateRelease,
  setup, setGenre, reveal, record, publish, show, settle, status,
  rollContract, sign, decline, leave, settleContracts,
};
