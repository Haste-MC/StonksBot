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

module.exports = {
  BRANCHES: data.BRANCHES, RANKS: data.RANKS, JOB_PREFIX, DAY_MS,
  branch, rankOf, companyJobId, companyIdOfJob, dayKey, ownCompany, ownerContext,
  ceilingOf, cleanName, found, hireNpc, fire,
};
