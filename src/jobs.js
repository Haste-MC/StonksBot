const db = require('./db');
const JOBS = require('./data/jobs');
const gear = require('./data/gear');
const { changeCash } = require('./unb');

const byId = new Map(JOBS.map((j) => [j.id, j]));

/** Wie viele Jobs pro Tag angeboten werden. */
const OFFERS_PER_DAY = 5;

/**
 * Eine Schicht entspricht etwa zwei Stunden Arbeit. Mehr als vier Schichten
 * am Tag – also acht Stunden – lässt das Arbeitsamt nicht zu.
 */
const HOURS_PER_SHIFT = 2;
const MAX_SHIFTS_PER_DAY = 4;

/**
 * Ziehungsgewichte. Kleinere Zahlen = seltener im Tagesangebot.
 *
 * Kalibriert über test/jobs.test.js (Simulation über 2000 Tage): ein Epic
 * erscheint im Schnitt etwa alle 10 Tage, ein Legendary alle 40 Tage.
 * Seltener wäre frustrierend – die Spitzenjobs verlangen ohnehin sehr teure
 * Voraussetzungen, da soll die Ziehung nicht zusätzlich blockieren.
 */
const TIER_WEIGHT = {
  common: 100,
  uncommon: 45,
  rare: 15,
  epic: 8,
  legendary: 3,
};

const TIER_LABEL = {
  common: '⚪ Alltäglich',
  uncommon: '🟢 Solide',
  rare: '🔵 Selten',
  epic: '🟣 Sehr selten',
  legendary: '🟠 Legendär',
};

const TIER_COLOR = {
  common: 0x95a5a6,
  uncommon: 0x2ecc71,
  rare: 0x3498db,
  epic: 0x9b59b6,
  legendary: 0xe67e22,
};

// ------------------------------------------------------ deterministischer Zufall

/** 32-Bit-Hash (FNV-1a) – macht aus einem String einen Startwert. */
function hash(str) {
  let h = 2166136261;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

/** Kleiner, schneller PRNG (mulberry32) – gleicher Startwert, gleiche Folge. */
function rng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Tagesstempel in lokaler Zeit, z.B. "2026-07-20". */
function today(date = new Date()) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

/**
 * Das Tagesangebot für einen Spieler.
 *
 * Bewusst deterministisch aus (Server, Spieler, Datum) berechnet: dadurch
 * sieht jeder sein eigenes Angebot, es bleibt den ganzen Tag stabil, und
 * niemand kann durch wiederholtes Aufrufen neu würfeln. Gespeichert werden
 * muss dafür nichts.
 */
function dailyOffers(guildId, userId, date = new Date()) {
  const random = rng(hash(`${guildId}:${userId}:${today(date)}`));

  const pool = JOBS.map((job) => ({ job, weight: TIER_WEIGHT[job.tier] ?? 1 }));
  const picked = [];

  for (let n = 0; n < OFFERS_PER_DAY && pool.length > 0; n++) {
    const total = pool.reduce((sum, e) => sum + e.weight, 0);
    let roll = random() * total;
    let index = 0;
    while (index < pool.length - 1 && roll >= pool[index].weight) {
      roll -= pool[index].weight;
      index++;
    }
    picked.push(pool[index].job);
    pool.splice(index, 1); // kein Job doppelt am selben Tag
  }

  return picked;
}

/** Millisekunden bis zum nächsten Tagesangebot. */
function msUntilRefresh(now = new Date()) {
  const next = new Date(now);
  next.setHours(24, 0, 0, 0);
  return next.getTime() - now.getTime();
}

// ------------------------------------------------------------ Voraussetzungen

/**
 * Prüft, ob ein Spieler alle Voraussetzungen erfüllt.
 * @returns {{ok: boolean, missing: string[], met: string[]}}
 */
function checkRequirements(guildId, userId, job) {
  const missing = [];
  const met = [];

  for (const req of job.requires ?? []) {
    if (req.item) {
      const owned = db.ownsNamed(guildId, userId, req.item);
      (owned ? met : missing).push(req.item);
    } else if (req.car) {
      const best = db.bestCarValue(guildId, userId);
      const label = `Auto ab ${req.car.toLocaleString('de-DE')}`;
      (best >= req.car ? met : missing).push(label);
    }
  }

  return { ok: missing.length === 0, missing, met };
}

/** Lesbare Liste der Voraussetzungen eines Jobs. */
function requirementLabels(job) {
  return (job.requires ?? []).map((r) =>
    r.item ? r.item : `Auto ab ${r.car.toLocaleString('de-DE')}`);
}

// ------------------------------------------------------------------ Bewerbung

/**
 * Bewirbt einen Spieler auf einen Job. Erfolgreich, wenn der Job heute
 * angeboten wird und alle Voraussetzungen erfüllt sind.
 */
function apply(guildId, userId, jobId, date = new Date()) {
  const job = byId.get(jobId);
  if (!job) return { ok: false, reason: 'unknown_job' };

  const offered = dailyOffers(guildId, userId, date).some((j) => j.id === jobId);
  if (!offered) return { ok: false, reason: 'not_offered', job };

  const current = db.getEmployment(guildId, userId);
  if (current?.job_id === jobId) return { ok: false, reason: 'already_hired', job };

  const check = checkRequirements(guildId, userId, job);
  if (!check.ok) return { ok: false, reason: 'requirements', job, missing: check.missing };

  db.setEmployment(guildId, userId, jobId);
  return { ok: true, job, previous: current ? byId.get(current.job_id) ?? null : null };
}

// -------------------------------------------------------------------- Arbeiten

/**
 * Eine Schicht arbeiten. Zahlt den Verdienst über die UnbelievaBoat-API aus.
 * Der Verdienst schwankt um ±15 %, damit es sich nicht wie ein Automat anfühlt.
 */
async function work(guildId, userId, now = new Date()) {
  const employment = db.getEmployment(guildId, userId);
  if (!employment) return { ok: false, reason: 'unemployed' };

  const job = byId.get(employment.job_id);
  if (!job) {
    // Job wurde aus dem Katalog entfernt – Anstellung aufräumen.
    db.clearEmployment(guildId, userId);
    return { ok: false, reason: 'unemployed' };
  }

  const day = today(now);
  const done = db.shiftsToday(guildId, userId, day);
  if (done >= MAX_SHIFTS_PER_DAY) {
    return {
      ok: false, reason: 'daily_limit', job,
      done, max: MAX_SHIFTS_PER_DAY, resetMs: msUntilRefresh(now),
    };
  }

  const waited = now.getTime() - employment.last_work_at;
  const cooldownMs = job.cooldown * 60 * 1000;
  if (waited < cooldownMs) {
    return { ok: false, reason: 'cooldown', job, remainingMs: cooldownMs - waited };
  }

  // Voraussetzungen können nachträglich wegfallen (Auto verkauft, Werkzeug kaputt).
  const check = checkRequirements(guildId, userId, job);
  if (!check.ok) return { ok: false, reason: 'requirements', job, missing: check.missing };

  const variance = 0.85 + Math.random() * 0.3;
  const amount = Math.max(1, Math.round(job.pay * variance));

  const balance = await changeCash(guildId, userId, amount, `Schicht: ${job.title}`);
  db.recordShift(guildId, userId, amount, day);

  // Erst nach erfolgreicher Schicht Verschleiß abrechnen – so verliert
  // niemand Ausrüstung für Arbeit, die gar nicht bezahlt wurde.
  const broken = applyWear(guildId, userId, job);

  const updated = db.getEmployment(guildId, userId);
  return {
    ok: true, job, amount, balance, broken,
    employment: updated,
    shiftsToday: updated.shifts_today,
    maxShifts: MAX_SHIFTS_PER_DAY,
  };
}

/**
 * Würfelt für jedes physische Ausrüstungsteil des Jobs, ob es kaputtgeht.
 * Lizenzen und Ausbildungen haben Verschleiß 0 und sind damit sicher.
 *
 * @returns {Array<{name: string, replacement: number|null}>} kaputtgegangene Teile
 */
function applyWear(guildId, userId, job) {
  const broken = [];

  for (const req of job.requires ?? []) {
    if (!req.item) continue;
    const chance = gear.wearChance(gear.findGear(req.item));
    if (chance <= 0) continue;
    if (Math.random() >= chance) continue;

    if (db.consumeNamed(guildId, userId, req.item)) {
      const def = gear.findGear(req.item);
      broken.push({ name: req.item, price: def?.price ?? null });
    }
  }

  return broken;
}

/** Schichten heute und verbleibendes Kontingent. */
function shiftBudget(guildId, userId, now = new Date()) {
  const done = db.shiftsToday(guildId, userId, today(now));
  return {
    done,
    max: MAX_SHIFTS_PER_DAY,
    left: Math.max(0, MAX_SHIFTS_PER_DAY - done),
    hours: done * HOURS_PER_SHIFT,
    maxHours: MAX_SHIFTS_PER_DAY * HOURS_PER_SHIFT,
  };
}

/** Kündigt die aktuelle Anstellung. */
function quit(guildId, userId) {
  const employment = db.getEmployment(guildId, userId);
  if (!employment) return { ok: false, reason: 'unemployed' };
  db.clearEmployment(guildId, userId);
  return { ok: true, job: byId.get(employment.job_id) ?? null, employment };
}

/** Aktuelle Anstellung inklusive Job-Definition. */
function currentJob(guildId, userId) {
  const employment = db.getEmployment(guildId, userId);
  if (!employment) return null;
  const job = byId.get(employment.job_id);
  return job ? { job, employment } : null;
}

module.exports = {
  JOBS, byId, dailyOffers, msUntilRefresh, checkRequirements, requirementLabels,
  apply, work, quit, currentJob, today, applyWear, shiftBudget,
  OFFERS_PER_DAY, TIER_WEIGHT, TIER_LABEL, TIER_COLOR,
  HOURS_PER_SHIFT, MAX_SHIFTS_PER_DAY,
};
