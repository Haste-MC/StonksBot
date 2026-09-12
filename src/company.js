/**
 * ===========================================================================
 *  FIRMEN – gründen, betreiben, Personal führen (Stück 1: der Kern)
 * ===========================================================================
 *
 * Eine Firma ist eine Geldquelle mit eigener Kasse. Der Umsatz entsteht je
 * Schicht (NPCs arbeiten automatisch, Spieler per Knopf), die Löhne gehen von
 * der Kasse ab, der Inhaber entnimmt den Rest. Drei Dinge halten das im
 * Rahmen (§3):
 *
 *   1. **Plätze.** Jede Branche hat feste Arbeitsplätze – das ist die Decke.
 *      `ceilingOf` rechnet sie vor, der Test prüft sie.
 *   2. **Löhne sind Verbindlichkeiten.** NPC-Löhne werden immer gebucht; die
 *      Kasse darf ins Minus. 14 Tage Minus sind die Insolvenz.
 *   3. **Zeit.** Inhaber-Aktionen kosten aus demselben Tagesbudget wie
 *      Streams und Studio (§15: eine Bremse, nicht zwei).
 *
 * Spieler-Angestellte laufen durch das Jobsystem (`employment.job_id =
 * 'firma:<id>'`): Tageslimit, Abklingzeit und „ein Job je Spieler" gelten
 * damit ohne neuen Code; jobs.js verzweigt bei diesen Jobs hierher.
 */

const db = require('./db');
const data = require('./data/companies');
const unb = require('./unb');

const changeCash = (...a) => unb.changeCash(...a);
const getBalance = (...a) => unb.getBalance(...a);

const DAY_MS = 24 * 60 * 60 * 1000;
const JOB_PREFIX = 'firma:';

const branchById = new Map(data.BRANCHES.map((b) => [b.id, b]));
const clamp = (min, max, v) => Math.min(max, Math.max(min, v));

/** Branche per ID, oder null. */
function branch(id) { return branchById.get(String(id ?? '')) ?? null; }

/** Rang-Eintrag zu einer Stufe (geklemmt auf 0…2). */
function rankOf(n) { return data.RANKS[clamp(0, data.RANKS.length - 1, Math.round(n ?? 0))]; }

/** Job-ID einer Firma im Jobsystem, und zurück. */
function companyJobId(id) { return `${JOB_PREFIX}${id}`; }
function companyIdOfJob(jobId) {
  const s = String(jobId ?? '');
  if (!s.startsWith(JOB_PREFIX)) return null;
  const id = Number(s.slice(JOB_PREFIX.length));
  return Number.isInteger(id) && id > 0 ? id : null;
}

/** Tagesschlüssel wie in jobs.js (Kalendertag, lokale Zeit). */
function dayKey(now) {
  const d = new Date(now);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

/** Die offene Firma eines Spielers, oder null. */
function ownCompany(guildId, userId) { return db.getOpenCompany(guildId, userId); }

/**
 * Die Decke einer Branche je Tag – vorgerechnet, damit §3 eine Zahl hat.
 * Volle NPC-Besetzung mit Schichtleitern, Auslastung 1,0 (mit Werbung),
 * tägliches Anpacken. `gross` Umsatz, `wages` Löhne, `net` die Differenz.
 */
function ceilingOf(b) {
  const top = rankOf(data.RANKS.length - 1).factor;
  const gross = b.slots * data.NPC_SHIFTS * b.umsatz * top
    + data.MAX_PITCH_PER_DAY * b.umsatz * top;
  const wages = b.slots * data.NPC_SHIFTS * b.lohn * top;
  return { gross, wages, net: gross - wages };
}

/** Name-Regeln: 2–32 Zeichen, keine Erwähnungen. */
function cleanName(name) {
  const s = String(name ?? '').replace(/\s+/g, ' ').trim();
  if (s.length < 2 || s.length > 32 || /[@<>]/.test(s)) return null;
  return s;
}

// ------------------------------------------------------------------ Gründen

/**
 * Gründet eine Firma. Zeile zuerst (§7), dann EINE Buchung des Preises (§9);
 * scheitert die Buchung, wird die Zeile wieder gelöscht.
 */
async function found(guildId, userId, branchId, name, now = Date.now()) {
  const b = branch(branchId);
  if (!b) return { ok: false, reason: 'unknown_branch' };
  const clean = cleanName(name);
  if (!clean) return { ok: false, reason: 'name' };
  if (db.getOpenCompany(guildId, userId)) return { ok: false, reason: 'already' };

  const balance = await getBalance(guildId, userId);
  if (balance.total < b.price) {
    return { ok: false, reason: 'funds', needed: b.price, have: balance.total };
  }

  let row;
  try {
    row = db.insertCompany({ guildId, ownerId: userId, branch: b.id, name: clean, now });
  } catch {
    // Eindeutiger Index: zwei Gründungen kurz hintereinander – die zweite verliert.
    return { ok: false, reason: 'already' };
  }

  try {
    if (balance.cash < b.price) {
      await unb.withdrawFromBank(guildId, userId, b.price - balance.cash, `Gründung: ${clean}`);
    }
    const newBalance = await changeCash(guildId, userId, -b.price, `Gründung: ${clean}`,
      { kind: 'company' });
    return { ok: true, company: row, branch: b, balance: newBalance };
  } catch (err) {
    db.deleteCompany(row.id);
    return { ok: false, reason: 'payment', error: err.message };
  }
}

// ----------------------------------------------------------------- Personal

/** Firma des Inhabers samt Branche und Personal – der Einstieg jeder Aktion. */
function ownerContext(guildId, userId) {
  const c = db.getOpenCompany(guildId, userId);
  if (!c) return null;
  return { company: c, branch: branch(c.branch), staff: db.companyStaff(c.id) };
}

/** Einen NPC einstellen, solange ein Platz frei ist. */
function hireNpc(guildId, userId, now = Date.now(), random = Math.random) {
  const ctx = ownerContext(guildId, userId);
  if (!ctx) return { ok: false, reason: 'no_company' };
  if (ctx.staff.length >= ctx.branch.slots) return { ok: false, reason: 'full' };
  const name = data.NPC_NAMES[Math.min(data.NPC_NAMES.length - 1,
    Math.floor(random() * data.NPC_NAMES.length))];
  const staff = db.insertStaff({ companyId: ctx.company.id, kind: 'npc', name, now });
  return { ok: true, staff, free: ctx.branch.slots - ctx.staff.length - 1 };
}

/** Entlassen – NPC oder Spieler; bei Spielern auch die Anstellung lösen. */
function fire(guildId, userId, staffId) {
  const ctx = ownerContext(guildId, userId);
  if (!ctx) return { ok: false, reason: 'no_company' };
  const s = db.staffById(staffId);
  if (!s || s.company_id !== ctx.company.id) return { ok: false, reason: 'not_found' };
  db.deleteStaff(s.id);
  if (s.kind === 'player') {
    const e = db.getEmployment(guildId, s.user_id);
    if (e?.job_id === companyJobId(ctx.company.id)) db.clearEmployment(guildId, s.user_id);
  }
  return { ok: true, staff: s };
}

// --------------------------------------------------------------- Abrechnung

/** Auslastungsziel: ohne Personal 0,3, volle Besetzung 0,8, mit Werbung 1,0. */
function dailyTarget(b, staffCount, werbungActive) {
  const ziel = data.AUSLASTUNG_MIN + data.AUSLASTUNG_STAFF * Math.min(1, staffCount / b.slots)
    + (werbungActive ? data.WERBUNG_BOOST : 0);
  return Math.min(1, ziel);
}

/**
 * Schließt eine Firma – freiwillig oder insolvent. Personal weg, Anstellungen
 * der Spieler gelöst. Die Kasse wird hier NICHT gebucht (das macht `close`).
 */
function closeCompany(guildId, companyId, now = Date.now(), why = 'closed') {
  const c = db.getCompany(companyId);
  if (!c || c.status !== 'open') return null;
  db.saveCompany({ ...c, status: 'closed', closed_at: now });
  db.deleteStaffOfCompany(c.id);
  db.clearEmploymentByJob(guildId, companyJobId(c.id));
  return { ...c, status: 'closed', closed_at: now, why };
}

/**
 * Faule Abrechnung (§4): rechnet volle Tage seit `paid_through` nach.
 * Je Tag: Auslastung bewegt sich aufs Ziel zu, NPCs arbeiten ihre Schichten
 * (Umsatz − Lohn in die Kasse, Löhne immer – Verbindlichkeiten), unbezahlte
 * NPCs kündigen nach NPC_QUIT_AFTER_UNPAID Tagen, und 14 Tage Minus sind die
 * Insolvenz. Synchron, ohne Buchung – nur Zustand.
 */
function settle(companyId, now = Date.now()) {
  const c = db.getCompany(companyId);
  if (!c || c.status !== 'open') return null;
  const b = branch(c.branch);
  const guildId = c.guild_id;

  const out = { days: 0, umsatz: 0, loehne: 0, quit: [], insolvent: false,
    auslastung: c.auslastung, kasse: c.kasse };
  const total = Math.floor((now - c.paid_through) / DAY_MS);
  if (total <= 0) return out;
  const days = Math.min(total, data.MAX_SETTLE_DAYS);
  const skipped = total - days;               // ältere Tage verfallen (wie bei Musik)
  out.days = days;

  let staff = db.companyStaff(c.id);
  let { kasse, auslastung, negative_since } = c;
  let tag = c.paid_through + skipped * DAY_MS;

  for (let d = 0; d < days; d++) {
    tag += DAY_MS;

    // 1. Auslastung bewegt sich aufs Ziel zu.
    const ziel = dailyTarget(b, staff.length, c.werbung_until > tag);
    auslastung += (ziel - auslastung) * data.AUSLASTUNG_STEP;

    // 2. NPC-Schichten – Löhne sind Verbindlichkeiten, die Kasse darf ins Minus.
    for (const s of staff) {
      if (s.kind !== 'npc') continue;
      const f = rankOf(s.rank).factor;
      const lohn = Math.round(b.lohn * f);
      const umsatz = Math.round(b.umsatz * f * auslastung);
      kasse += data.NPC_SHIFTS * (umsatz - lohn);
      out.umsatz += data.NPC_SHIFTS * umsatz;
      out.loehne += data.NPC_SHIFTS * lohn;
      s.shifts += data.NPC_SHIFTS;
    }
    // Unbezahlt heißt: Am Tagesende ist die Kasse im Minus – für alle gleich.
    for (const s of staff) if (s.kind === 'npc') s.unpaid_days = kasse < 0 ? s.unpaid_days + 1 : 0;
    const quitting = staff.filter((s) => s.kind === 'npc' && s.unpaid_days >= data.NPC_QUIT_AFTER_UNPAID);
    for (const s of quitting) { db.deleteStaff(s.id); out.quit.push(s.name); }
    staff = staff.filter((s) => !quitting.includes(s));

    // 3. Die Minus-Uhr.
    if (kasse < 0 && !negative_since) negative_since = tag;
    if (kasse >= 0) negative_since = 0;
    if (negative_since && tag - negative_since >= data.INSOLVENCY_DAYS * DAY_MS) {
      db.saveCompany({ ...c, kasse, auslastung, negative_since, paid_through: tag });
      closeCompany(guildId, c.id, tag, 'insolvent');
      out.insolvent = true; out.auslastung = auslastung; out.kasse = kasse;
      return out;
    }
  }

  for (const s of staff) db.saveStaff(s);
  db.saveCompany({ ...c, kasse, auslastung, negative_since, paid_through: tag });
  out.auslastung = auslastung; out.kasse = kasse;
  return out;
}

// ------------------------------------------------------ Spieler im Betrieb

/** Der virtuelle Job einer Firma – damit das Jobsystem sie kennt. */
function asJob(jobId) {
  const id = companyIdOfJob(jobId);
  if (id === null) return null;
  const c = db.getCompany(id);
  if (!c || c.status !== 'open') return null;
  const b = branch(c.branch);
  return {
    id: jobId, title: c.name, emoji: b.emoji, pay: b.lohn,
    cooldown: data.SHIFT_COOLDOWN_MIN, tier: 'firma', requires: [],
    company: c, branch: b,
  };
}

/** Alle offenen Firmen des Servers mit freiem Platz. */
function openings(guildId) {
  return db.openCompanies(guildId).map((c) => {
    const b = branch(c.branch);
    const free = b.slots - db.companyStaff(c.id).length;
    return { company: c, branch: b, free, lohn: b.lohn, jobId: companyJobId(c.id) };
  }).filter((o) => o.free > 0);
}

/**
 * Bei einer Firma anfangen. Ersetzt den bisherigen Job (auch eine andere
 * Firma). Zeile in company_staff UND employment.
 */
function join(guildId, userId, companyId, now = Date.now()) {
  const c = db.getCompany(companyId);
  if (!c || c.status !== 'open') return { ok: false, reason: 'closed' };
  if (c.owner_id === String(userId)) return { ok: false, reason: 'owner' };
  if (db.staffByUser(c.id, userId)) return { ok: false, reason: 'already_hired' };
  const b = branch(c.branch);
  if (db.companyStaff(c.id).length >= b.slots) return { ok: false, reason: 'full' };

  leave(guildId, userId);                        // alte Firmenstelle räumen
  db.insertStaff({ companyId: c.id, kind: 'player', userId, now });
  db.setEmployment(guildId, userId, companyJobId(c.id));
  return { ok: true, job: asJob(companyJobId(c.id)) };
}

/** Firmenstelle eines Spielers räumen (Kündigung, Wechsel). Ohne employment zu löschen. */
function leave(guildId, userId) {
  const e = db.getEmployment(guildId, userId);
  const id = companyIdOfJob(e?.job_id);
  if (id === null) return false;
  const s = db.staffByUser(id, userId);
  if (s) db.deleteStaff(s.id);
  return true;
}

/**
 * Eine Spieler-Schicht: Zustand (Kasse, Schichtzähler) hier, die Buchung an
 * den Spieler macht jobs.work – mit dessen Level-Zuschlag, der die Kasse nicht
 * belastet. Nur bei gedecktem Lohn.
 */
function workShift(guildId, userId, companyId, now = Date.now(), random = Math.random) {
  settle(companyId, now);
  const c = db.getCompany(companyId);
  if (!c || c.status !== 'open') return { ok: false, reason: 'closed' };
  const s = db.staffByUser(c.id, userId);
  if (!s) return { ok: false, reason: 'not_staff' };
  const b = branch(c.branch);
  const f = rankOf(s.rank).factor;
  const lohn = Math.max(1, Math.round(b.lohn * f * (0.85 + random() * 0.3)));
  const umsatz = Math.round(b.umsatz * f * c.auslastung * data.PLAYER_BONUS);
  if (c.kasse < lohn) return { ok: false, reason: 'kasse', lohn, kasse: c.kasse };

  db.saveCompany({ ...c, kasse: c.kasse - lohn + umsatz });
  db.saveStaff({ ...s, shifts: s.shifts + 1 });
  return { ok: true, lohn, umsatz, company: c, branch: b, rank: rankOf(s.rank) };
}

// --------------------------------------------------------- Inhaber-Aktionen

/** Zeit aus dem gemeinsamen Tagesbudget (§15: eine Bremse, nicht zwei). */
function useTime(guildId, userId, cost, now) {
  return require('./creator').useTime(guildId, userId, cost, now);
}

/** Firma des Inhabers nach Abrechnung – oder null (auch wenn gerade insolvent geworden). */
function fresh(guildId, userId, now) {
  const c = db.getOpenCompany(guildId, userId);
  if (!c) return null;
  settle(c.id, now);
  const after = db.getCompany(c.id);
  if (!after || after.status !== 'open') return null;
  return { company: after, branch: branch(after.branch), staff: db.companyStaff(after.id) };
}

/** Werbung: kostet 5 % des Gründungspreises aus der Kasse und Zeit; 3 Tage +0,25 aufs Ziel. */
async function advertise(guildId, userId, now = Date.now()) {
  const ctx = fresh(guildId, userId, now);
  if (!ctx) return { ok: false, reason: 'no_company' };
  const { company: c, branch: b } = ctx;
  if (c.werbung_until > now) return { ok: false, reason: 'running', until: c.werbung_until };
  const cost = Math.round(b.price * data.WERBUNG_COST_SHARE);
  if (c.kasse < cost) return { ok: false, reason: 'kasse', cost, kasse: c.kasse };
  const time = useTime(guildId, userId, data.TIME_WERBUNG, now);
  if (!time.ok) return { ok: false, reason: 'no_time', need: data.TIME_WERBUNG, ...time };
  const until = now + data.WERBUNG_DAYS * DAY_MS;
  db.saveCompany({ ...c, kasse: c.kasse - cost, werbung_until: until });
  return { ok: true, cost, until, time };
}

/** Selbst anpacken: eine Schicht als Schichtleiter, ohne Lohn, höchstens 4 je Tag. */
async function pitchIn(guildId, userId, now = Date.now()) {
  const ctx = fresh(guildId, userId, now);
  if (!ctx) return { ok: false, reason: 'no_company' };
  const { company: c, branch: b } = ctx;
  const day = dayKey(now);
  const done = c.pitch_day === day ? c.pitch_today : 0;
  if (done >= data.MAX_PITCH_PER_DAY) return { ok: false, reason: 'limit', done, max: data.MAX_PITCH_PER_DAY };
  const time = useTime(guildId, userId, data.TIME_ANPACKEN, now);
  if (!time.ok) return { ok: false, reason: 'no_time', need: data.TIME_ANPACKEN, ...time };
  const umsatz = Math.round(b.umsatz * rankOf(data.RANKS.length - 1).factor * c.auslastung);
  db.saveCompany({ ...c, kasse: c.kasse + umsatz, pitch_day: day, pitch_today: done + 1 });
  return { ok: true, umsatz, done: done + 1, max: data.MAX_PITCH_PER_DAY, time };
}

/** Gewinn entnehmen – Umbuchung, keine Steuer, kein Level-Zuschlag. */
async function withdraw(guildId, userId, amount, now = Date.now()) {
  const ctx = fresh(guildId, userId, now);
  if (!ctx) return { ok: false, reason: 'no_company' };
  const c = ctx.company;
  const value = Math.floor(Number(amount) || 0);
  if (value <= 0) return { ok: false, reason: 'amount' };
  if (value > c.kasse) return { ok: false, reason: 'kasse', kasse: c.kasse };
  db.saveCompany({ ...c, kasse: c.kasse - value });
  const balance = await changeCash(guildId, userId, value, `Entnahme: ${c.name}`,
    { tax: false, kind: 'company' });
  return { ok: true, amount: value, balance, kasse: c.kasse - value };
}

/** Kapital einzahlen – von Bargeld (notfalls Bank), setzt die Minus-Uhr zurück. */
async function deposit(guildId, userId, amount, now = Date.now()) {
  const ctx = fresh(guildId, userId, now);
  if (!ctx) return { ok: false, reason: 'no_company' };
  const c = ctx.company;
  const value = Math.floor(Number(amount) || 0);
  if (value <= 0) return { ok: false, reason: 'amount' };
  const balance = await getBalance(guildId, userId);
  if (balance.total < value) return { ok: false, reason: 'funds', have: balance.total };
  if (balance.cash < value) {
    await unb.withdrawFromBank(guildId, userId, value - balance.cash, `Einzahlung: ${c.name}`);
  }
  const after = await changeCash(guildId, userId, -value, `Einzahlung: ${c.name}`, { kind: 'company' });
  const current = db.getCompany(c.id);                 // frisch lesen: die Buchung hat gewartet
  const kasse = current.kasse + value;
  db.saveCompany({ ...current, kasse, negative_since: kasse < 0 ? current.negative_since : 0 });
  return { ok: true, amount: value, balance: after, kasse };
}

/** Rang ±1, geklemmt auf 0…2; bei Spielern auch employment.rank. */
function promote(guildId, userId, staffId, delta) {
  const ctx = ownerContext(guildId, userId);
  if (!ctx) return { ok: false, reason: 'no_company' };
  const s = db.staffById(staffId);
  if (!s || s.company_id !== ctx.company.id) return { ok: false, reason: 'not_found' };
  const rank = s.rank + Math.sign(delta);
  if (rank < 0 || rank >= data.RANKS.length) return { ok: false, reason: 'range', rank: rankOf(s.rank) };
  db.saveStaff({ ...s, rank });
  if (s.kind === 'player') db.promote(guildId, s.user_id, rank, db.getEmployment(guildId, s.user_id)?.shifts ?? 0);
  return { ok: true, staff: { ...s, rank }, rank: rankOf(rank) };
}

/** Prämie aus der Kasse an einen Spieler-Angestellten – eine Buchung. */
async function bonus(guildId, userId, staffId, amount, now = Date.now()) {
  const ctx = fresh(guildId, userId, now);
  if (!ctx) return { ok: false, reason: 'no_company' };
  const c = ctx.company;
  const s = db.staffById(staffId);
  if (!s || s.company_id !== c.id) return { ok: false, reason: 'not_found' };
  if (s.kind !== 'player') return { ok: false, reason: 'not_player' };
  const value = Math.floor(Number(amount) || 0);
  if (value <= 0) return { ok: false, reason: 'amount' };
  if (value > c.kasse) return { ok: false, reason: 'kasse', kasse: c.kasse };
  db.saveCompany({ ...c, kasse: c.kasse - value });
  await changeCash(guildId, s.user_id, value, `Prämie: ${c.name}`, { kind: 'job' });
  return { ok: true, amount: value, staff: s };
}

/** Freiwillig schließen: Kasse (wenn positiv) entnehmen, dann aufräumen. */
async function close(guildId, userId, now = Date.now()) {
  const ctx = fresh(guildId, userId, now);
  if (!ctx) return { ok: false, reason: 'no_company' };
  const c = ctx.company;
  const payout = Math.max(0, Math.round(c.kasse));
  const closed = closeCompany(guildId, c.id, now, 'closed');
  const balance = payout > 0
    ? await changeCash(guildId, userId, payout, `Auflösung: ${c.name}`, { tax: false, kind: 'company' })
    : null;
  return { ok: true, company: closed, payout, balance };
}

// ------------------------------------------------------------------ Anzeige

/** Alles, was die Firmenansicht wissen muss – nach Abrechnung. */
function status(guildId, userId, now = Date.now()) {
  const ctx = fresh(guildId, userId, now);
  if (!ctx) return null;
  const { company: c, branch: b, staff } = ctx;
  const day = dayKey(now);
  // Prognose: was die heutige NPC-Besetzung bei heutiger Auslastung am Tag
  // bringt – Spieler-Schichten (freiwillig, ungewiss) zählen hier nicht mit.
  const forecast = staff.filter((s) => s.kind === 'npc').reduce((sum, s) => {
    const f = rankOf(s.rank).factor;
    return sum + data.NPC_SHIFTS * (Math.round(b.umsatz * f * c.auslastung) - Math.round(b.lohn * f));
  }, 0);
  const minusDays = c.negative_since ? Math.floor((now - c.negative_since) / DAY_MS) : 0;
  return {
    company: c, branch: b, staff,
    free: b.slots - staff.length,
    kasse: c.kasse, auslastung: c.auslastung,
    werbungMs: Math.max(0, c.werbung_until - now),
    minusDays, daysLeft: c.negative_since ? Math.max(0, data.INSOLVENCY_DAYS - minusDays) : null,
    pitchLeft: data.MAX_PITCH_PER_DAY - (c.pitch_day === day ? c.pitch_today : 0),
    budget: require('./creator').budget(guildId, userId, now),
    ceiling: ceilingOf(b), forecast,
    werbungCost: Math.round(b.price * data.WERBUNG_COST_SHARE),
  };
}

module.exports = {
  BRANCHES: data.BRANCHES, RANKS: data.RANKS, JOB_PREFIX, DAY_MS,
  branch, rankOf, companyJobId, companyIdOfJob, dayKey, ownCompany, ownerContext,
  ceilingOf, cleanName, found, hireNpc, fire,
  dailyTarget, closeCompany, settle,
  asJob, openings, join, leave, workShift,
  advertise, pitchIn, withdraw, deposit, promote, bonus, close, status, fresh,
};
