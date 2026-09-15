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
 * Was Stufe und Extras aus einer Branche machen: Plätze und Umsatzfaktor.
 * Stufe 0 ohne Extras = Kernwerte – bestehende Firmen rechnen wie bisher.
 * `extraIds` übergibt der Aufrufer, wenn er sie schon hat; sonst aus der DB.
 */
function effectiveOf(company, b, extraIds = null) {
  const ids = extraIds ?? db.companyExtras(company.id);
  const st = company.stufe > 0 ? b.stufen[Math.min(company.stufe, data.MAX_STUFE) - 1] : null;
  let slots = st ? st.slots : b.slots;
  let umsatzFactor = st ? st.umsatz : 1;
  for (const id of ids) {
    const e = data.extraById(id);
    if (!e) continue;
    if (e.slots) slots += e.slots;
    if (e.umsatz) umsatzFactor += e.umsatz;
  }
  return { slots, umsatzFactor: Math.round(umsatzFactor * 1000) / 1000 };
}

/** Die nächste Stufe der Leiter, oder null bei Vollausbau. */
function nextStufe(company, b) {
  return company.stufe >= data.MAX_STUFE ? null : b.stufen[company.stufe];
}

/**
 * Die Decke je Tag – vorgerechnet, damit §3 eine Zahl hat. Standard ist der
 * Kern (Stufe 0, keine Extras); mit Stufe und Extras die Decke der aktuellen
 * Firma, `fullCeilingOf` die des Vollausbaus. Volle NPC-Besetzung mit
 * Schichtleitern, Auslastung 1,0, tägliches Anpacken.
 */
function ceilingOf(b, stufe = 0, extraIds = []) {
  const top = rankOf(data.RANKS.length - 1).factor;
  const { slots, umsatzFactor } = effectiveOf({ id: 0, stufe }, b, extraIds);
  const gross = Math.round(slots * data.NPC_SHIFTS * b.umsatz * top * umsatzFactor
    + data.MAX_PITCH_PER_DAY * b.umsatz * top * umsatzFactor);
  const wages = Math.round(slots * data.NPC_SHIFTS * b.lohn * top);
  // Ganze Taler: die Anzeige zeigt die Decke, und 16.631,25 sind kein Betrag.
  return { gross, wages, net: gross - wages, slots, factor: umsatzFactor };
}

function fullCeilingOf(b) {
  return ceilingOf(b, data.MAX_STUFE, b.extras.map((e) => e.id));
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

/** Einen NPC einstellen, solange ein Platz frei ist – nach Abrechnung (Kündigungen zuerst). */
function hireNpc(guildId, userId, now = Date.now(), random = Math.random) {
  const ctx = fresh(guildId, userId, now);
  if (!ctx) return { ok: false, reason: 'no_company' };
  const eff = effectiveOf(ctx.company, ctx.branch);
  if (ctx.staff.length >= eff.slots) return { ok: false, reason: 'full' };
  const name = data.NPC_NAMES[Math.min(data.NPC_NAMES.length - 1,
    Math.floor(random() * data.NPC_NAMES.length))];
  const staff = db.insertStaff({ companyId: ctx.company.id, kind: 'npc', name, now });
  return { ok: true, staff, free: eff.slots - ctx.staff.length - 1 };
}

/** Entlassen – NPC oder Spieler; bei Spielern auch die Anstellung lösen. Rechnet vorher ab. */
function fire(guildId, userId, staffId, now = Date.now()) {
  const ctx = fresh(guildId, userId, now);
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
function dailyTarget(b, staffCount, werbungActive, slots = b.slots) {
  const ziel = data.AUSLASTUNG_MIN + data.AUSLASTUNG_STAFF * Math.min(1, staffCount / slots)
    + (werbungActive ? data.WERBUNG_BOOST : 0);
  return Math.min(1, ziel);
}

// ------------------------------------------------------------- Ereignisse

const NEWS_MAX = 5;

/** Firmengröße: Ausbaustufe plus gekaufte Extras (0 … 9). Treibt Häufigkeit und Härte. */
function groesse(c, extraIds) {
  return (c.stufe ?? 0) + extraIds.length;
}
/** Tageswahrscheinlichkeit eines Vorfalls: 2 % (Größe 0) … 8 % (Größe 9). */
function riskPerDay(g) {
  return 0.02 + (g / 9) * 0.06;
}
/** Wahrscheinlichkeit, dass in `days` Tagen mindestens ein Vorfall passiert. */
function riskFor(g, days) {
  return 1 - Math.pow(1 - riskPerDay(g), Math.max(0, days));
}
/** Verstärkung der Verluste: 1 (Größe 0) … 1,6 (Größe 9). */
function severityFor(g) {
  return 1 + (g / 9) * 0.6;
}
/** Was in Stufen und Extras steckt – so rechnet auch der Schließen-Dialog. */
function investedOf(b, c, extraIds) {
  return b.stufen.slice(0, c.stufe ?? 0).reduce((s, st) => s + st.price, 0)
    + extraIds.reduce((s, id) => s + (data.extraById(id)?.price ?? 0), 0);
}

/**
 * Wendet eine Wirkung (leichtes Ereignis oder Vorfall-Ausgang) auf eine Firma
 * an – rein, ohne DB: liefert die fortgeschriebene Firmenzeile, die
 * verbleibende Belegschaft, die gekündigten Zeilen und `done` mit den
 * angewandten Zahlen. Verluste (kasse < 0, auslastung < 0, quit, lock,
 * werbung < 0) werden mit `haerte` verstärkt, Gewinne nie; `refund` gibt nie
 * mehr zurück, als dieselbe Wirkung abgezogen hat.
 *
 * `today`: der Tag `at` zählt schon als erster Tag (Abrechnung); bei
 * Vorfällen (Echtzeit) beginnen die `days` mit dem nächsten Abrechnungstag.
 */
function applyEffect(c, staff, effect, { b, extraIds, at, today = false, haerte = 1, random = Math.random }) {
  const decke = ceilingOf(b, c.stufe ?? 0, extraIds).net;
  const days = effect.days ?? 1;
  const until = at + (days - (today ? 1 : 0)) * DAY_MS;
  const next = { ...c };
  let rest = [...staff];
  const quit = [];
  const done = { kasse: 0, refund: 0, auslastung: 0, quit: [], lock: 0, umsatz: null, days: 0,
    wages: null, werbung: 0, staffRank: null, sell: !!effect.sell };

  if (effect.kasse) {
    done.kasse = -Math.round(Math.abs(effect.kasse) * decke * haerte);
    next.kasse += done.kasse;
  }
  if (effect.refund && done.kasse < 0) {
    done.refund = Math.min(Math.round(effect.refund * decke), -done.kasse);
    next.kasse += done.refund;
  }
  if (effect.auslastung) {
    const delta = effect.auslastung < 0 ? effect.auslastung * haerte : effect.auslastung;
    const a = Math.max(0, Math.min(1, next.auslastung + delta));
    done.auslastung = a - next.auslastung;
    next.auslastung = a;
  }
  if (effect.umsatz) {
    // Boosts stapeln nicht (§3): zwei gute Nachrichten sind das Maximum beider,
    // nie das Produkt. Ein Malus ersetzt, was gerade läuft.
    const laeuft = next.umsatz_boost_until >= at ? next.umsatz_boost : 1;
    if (effect.umsatz >= 1 && laeuft >= 1) {
      next.umsatz_boost = Math.min(data.EVENT_UMSATZ_MAX, Math.max(laeuft, effect.umsatz));
      next.umsatz_boost_until = Math.max(next.umsatz_boost_until, until);
    } else {
      next.umsatz_boost = Math.min(data.EVENT_UMSATZ_MAX, effect.umsatz);
      next.umsatz_boost_until = until;
    }
    done.umsatz = next.umsatz_boost; done.days = days;
  }
  if (effect.wages !== undefined) {
    next.wage_factor = effect.wages; next.wage_factor_until = until;
    done.wages = effect.wages; done.days = days;
  }
  if (effect.werbung) {
    const w = effect.werbung < 0 ? Math.round(effect.werbung * haerte) : effect.werbung;
    next.werbung_until = w > 0
      ? Math.max(next.werbung_until, at) + w * DAY_MS
      : Math.max(0, next.werbung_until + w * DAY_MS);
    done.werbung = w;
  }
  if (effect.lock) {
    done.lock = Math.min(5, Math.round(effect.lock * haerte));
    next.closed_until = Math.max(next.closed_until ?? 0, at) + done.lock * DAY_MS;
  }
  if (effect.quit) {
    const n = Math.min(rest.filter((s) => s.kind === 'npc').length, Math.round(effect.quit * haerte));
    const npcs = rest.filter((s) => s.kind === 'npc').sort((x, y) => y.shifts - x.shifts);
    for (const s of npcs.slice(0, n)) { quit.push(s); done.quit.push(s.name); }
    rest = rest.filter((s) => !quit.includes(s));
  }
  if (effect.staffRank) {
    const npcs = rest.filter((s) => s.kind === 'npc');
    if (npcs.length) {
      const s = npcs[Math.min(npcs.length - 1, Math.floor(random() * npcs.length))];
      const rank = Math.max(0, Math.min(data.RANKS.length - 1, s.rank + effect.staffRank));
      if (rank !== s.rank) { s.rank = rank; done.staffRank = { name: s.name, rank }; }
    }
  }
  return { company: next, staff: rest, quit, done };
}

/** Eine Zeile in die Chronik (neueste zuerst, höchstens NEWS_MAX). */
function pushNews(c, at, text) {
  const list = typeof c.news === 'string' ? JSON.parse(c.news || '[]') : (c.news ?? []);
  return [{ at, text }, ...list].slice(0, NEWS_MAX);
}

/** Würfelt ein leichtes Ereignis für einen Abrechnungstag. */
function rollLightEvent(klasse, random = Math.random) {
  const list = require('./data/companyEvents').candidates(klasse);
  const total = list.reduce((s, c) => s + c.weight, 0);
  let roll = random() * total;
  for (const c of list) {
    if (roll < c.weight) return c.event;
    roll -= c.weight;
  }
  return require('./data/companyEvents').NO_EVENT;
}

/**
 * Schließt eine Firma – freiwillig oder insolvent. Personal weg, Anstellungen
 * der Spieler gelöst. Die Kasse wird hier NICHT gebucht (das macht `close`).
 */
function closeCompany(guildId, companyId, now = Date.now(), why = 'closed') {
  const c = db.getCompany(companyId);
  if (!c || c.status !== 'open') return null;
  db.saveCompany({ ...c, status: 'closed', closed_at: now, closed_why: why });
  db.deleteStaffOfCompany(c.id);
  db.deleteExtrasOfCompany(c.id);
  db.clearEmploymentByJob(guildId, companyJobId(c.id));
  return { ...c, status: 'closed', closed_at: now, closed_why: why, why };
}

/**
 * Die zuletzt geschlossene Firma eines Spielers – aber nur, solange die
 * Schließung höchstens 30 Tage her ist (der Insolvenz-Hinweis in der
 * Gründungsansicht soll nicht ewig kleben bleiben).
 */
function lastClosed(guildId, userId, now = Date.now()) {
  const c = db.lastClosedCompany(guildId, userId);
  if (!c || now - c.closed_at > 30 * DAY_MS) return null;
  return c;
}

/**
 * Faule Abrechnung (§4): rechnet volle Tage seit `paid_through` nach.
 * Je Tag: Auslastung bewegt sich aufs Ziel zu, ein leichtes Ereignis wird
 * gewürfelt (wirkt sofort, landet in der Chronik), NPCs arbeiten ihre
 * Schichten (Umsatz − Lohn in die Kasse, Löhne immer – Verbindlichkeiten,
 * auch bei geschlossenem Betrieb), unbezahlte NPCs kündigen nach
 * NPC_QUIT_AFTER_UNPAID Tagen, und 14 Tage Minus sind die Insolvenz.
 * Synchron, ohne Buchung – nur Zustand. `random` ist der Würfel der Tests.
 */
function settle(companyId, now = Date.now(), random = Math.random) {
  const c = db.getCompany(companyId);
  if (!c || c.status !== 'open') return null;
  const b = branch(c.branch);
  const extraIds = db.companyExtras(c.id);
  const eff = effectiveOf(c, b, extraIds);
  const guildId = c.guild_id;

  const out = { days: 0, umsatz: 0, loehne: 0, quit: [], insolvent: false,
    auslastung: c.auslastung, kasse: c.kasse, news: [], incident: null };
  const total = Math.floor((now - c.paid_through) / DAY_MS);
  if (total <= 0) return out;
  const days = Math.min(total, data.MAX_SETTLE_DAYS);
  const skipped = total - days;               // ältere Tage verfallen (wie bei Musik)
  out.days = days;

  let staff = db.companyStaff(c.id);
  let cur = { ...c };                         // die fortgeschriebene Firmenzeile
  let tag = c.paid_through + skipped * DAY_MS;

  for (let d = 0; d < days; d++) {
    tag += DAY_MS;

    // 1. Auslastung bewegt sich aufs Ziel zu. Werbung zählt am Tag ihres Ablaufs
    //    noch mit (>=): drei bezahlte Tage sind drei Abrechnungen, auch wenn sie
    //    genau zum Tick gekauft wurde.
    const ziel = dailyTarget(b, staff.length, cur.werbung_until >= tag, eff.slots);
    cur.auslastung += (ziel - cur.auslastung) * data.AUSLASTUNG_STEP;

    // 2. Ein leichtes Ereignis – nicht verstärkt, wirkt ab heute.
    const ev = rollLightEvent(b.klasse, random);
    if (ev.text) {
      const r = applyEffect(cur, staff, ev, { b, extraIds, at: tag, today: true, haerte: 1, random });
      cur = r.company; staff = r.staff;
      for (const s of r.quit) { db.deleteStaff(s.id); out.quit.push(s.name); }
      const text = ev.flavor?.[b.id] ?? ev.text;
      cur.news = pushNews(cur, tag, text);
      out.news.push({ at: tag, text, kasse: r.done.kasse + r.done.refund });
    }

    // 3. Faktoren des Tages und Schließung.
    const fUmsatz = cur.umsatz_boost_until >= tag ? cur.umsatz_boost : 1;
    const fLohn = cur.wage_factor_until >= tag ? cur.wage_factor : 1;
    const zu = tag <= (cur.closed_until ?? 0);

    // 4. NPC-Schichten – Löhne sind Verbindlichkeiten, auch bei geschlossenem Betrieb.
    for (const s of staff) {
      if (s.kind !== 'npc') continue;
      const f = rankOf(s.rank).factor;
      const lohn = Math.round(b.lohn * f * fLohn);
      const umsatz = zu ? 0 : Math.round(b.umsatz * f * cur.auslastung * eff.umsatzFactor * fUmsatz);
      cur.kasse += data.NPC_SHIFTS * (umsatz - lohn);
      out.umsatz += data.NPC_SHIFTS * umsatz;
      out.loehne += data.NPC_SHIFTS * lohn;
      if (!zu) s.shifts += data.NPC_SHIFTS;
    }
    // Unbezahlt heißt: Am Tagesende ist die Kasse im Minus – für alle gleich.
    for (const s of staff) if (s.kind === 'npc') s.unpaid_days = cur.kasse < 0 ? s.unpaid_days + 1 : 0;
    const quitting = staff.filter((s) => s.kind === 'npc' && s.unpaid_days >= data.NPC_QUIT_AFTER_UNPAID);
    for (const s of quitting) { db.deleteStaff(s.id); out.quit.push(s.name); }
    staff = staff.filter((s) => !quitting.includes(s));

    // 5. Die Minus-Uhr.
    if (cur.kasse < 0 && !cur.negative_since) cur.negative_since = tag;
    if (cur.kasse >= 0) cur.negative_since = 0;
    if (cur.negative_since && tag - cur.negative_since >= data.INSOLVENCY_DAYS * DAY_MS) {
      db.saveCompany({ ...cur, paid_through: tag });
      closeCompany(guildId, c.id, tag, 'insolvent');
      out.insolvent = true; out.auslastung = cur.auslastung; out.kasse = cur.kasse;
      return out;
    }
  }

  for (const s of staff) db.saveStaff(s);
  db.saveCompany({ ...cur, paid_through: tag });
  out.auslastung = cur.auslastung; out.kasse = cur.kasse;

  // Ein Vorfall je Abrechnung – über die nachgeholten Tage, nicht je Tag (§4).
  // Gewürfelt mit `now`, nicht mit dem Abrechnungstag: die 24-h-Frist läuft ab jetzt.
  out.incident = require('./decisions').roll(guildId, c.owner_id,
    { groesse: groesse(cur, extraIds), days, npc: staff.filter((s) => s.kind === 'npc').length },
    now, random, 'company');
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
    const eff = effectiveOf(c, b);
    const free = eff.slots - db.companyStaff(c.id).length;
    return { company: c, branch: b, free, lohn: b.lohn, jobId: companyJobId(c.id), stufe: c.stufe };
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
  if (db.companyStaff(c.id).length >= effectiveOf(c, b).slots) return { ok: false, reason: 'full' };

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
function workShift(guildId, userId, companyId, now = Date.now(), random = Math.random,
  { factor = 1, overtime = false } = {}) {
  settle(companyId, now);
  const c = db.getCompany(companyId);
  if (!c || c.status !== 'open') return { ok: false, reason: 'closed' };
  const s = db.staffByUser(c.id, userId);
  if (!s) return { ok: false, reason: 'not_staff' };
  // Geschlossener Betrieb (Vorfall): keine Schicht, kein Lohn – und keine Stunden verbraucht.
  if (now < (c.closed_until ?? 0)) return { ok: false, reason: 'locked', remainingMs: c.closed_until - now };
  const b = branch(c.branch);
  const eff = effectiveOf(c, b);
  const f = rankOf(s.rank).factor;
  // Müde verkauft man weniger und arbeitet langsamer: Umsatz und Lohn × Faktor.
  const plain = Math.max(1, Math.round(b.lohn * f * (0.85 + random() * 0.3) * factor));
  const lohn = overtime ? Math.round(plain * require('./jobs').OVERTIME_PAY) : plain;
  const umsatz = Math.round(b.umsatz * f * c.auslastung * data.PLAYER_BONUS * eff.umsatzFactor * factor);
  if (c.kasse < lohn) return { ok: false, reason: 'kasse', lohn, kasse: c.kasse };

  db.saveCompany({ ...c, kasse: c.kasse - lohn + umsatz });
  db.saveStaff({ ...s, shifts: s.shifts + 1 });
  return { ok: true, lohn, umsatz, overtimeBonus: lohn - plain, company: c, branch: b, rank: rankOf(s.rank) };
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
  // Sperre vor Zeit und Kasse: eine abgelehnte Aktion kostet keine Stunden.
  if (now < (c.closed_until ?? 0)) return { ok: false, reason: 'locked', remainingMs: c.closed_until - now };
  if (c.werbung_until > now) return { ok: false, reason: 'running', until: c.werbung_until };
  const cost = Math.round(b.price * data.WERBUNG_COST_SHARE);
  if (c.kasse < cost) return { ok: false, reason: 'kasse', cost, kasse: c.kasse };
  // Werbung kostet Stunden und Energie, skaliert nichts – der Faktor greift nicht.
  const time = useTime(guildId, userId, data.TIME_WERBUNG, now);
  if (!time.ok) return { ok: false, reason: time.reason, need: data.TIME_WERBUNG, ...time };
  const until = now + data.WERBUNG_DAYS * DAY_MS;
  db.saveCompany({ ...c, kasse: c.kasse - cost, werbung_until: until });
  return { ok: true, cost, until, time };
}

/** Selbst anpacken: eine Schicht als Schichtleiter, ohne Lohn, höchstens 4 je Tag. */
async function pitchIn(guildId, userId, now = Date.now()) {
  const ctx = fresh(guildId, userId, now);
  if (!ctx) return { ok: false, reason: 'no_company' };
  const { company: c, branch: b } = ctx;
  if (now < (c.closed_until ?? 0)) return { ok: false, reason: 'locked', remainingMs: c.closed_until - now };
  const day = dayKey(now);
  const done = c.pitch_day === day ? c.pitch_today : 0;
  if (done >= data.MAX_PITCH_PER_DAY) return { ok: false, reason: 'limit', done, max: data.MAX_PITCH_PER_DAY };
  const time = useTime(guildId, userId, data.TIME_ANPACKEN, now);
  if (!time.ok) return { ok: false, reason: time.reason, need: data.TIME_ANPACKEN, ...time };
  const eff = effectiveOf(c, b);
  // Müde packt man weniger an: Umsatz × Energiefaktor (nach der Buchung).
  const umsatz = Math.round(b.umsatz * rankOf(data.RANKS.length - 1).factor * c.auslastung * eff.umsatzFactor * time.factor);
  db.saveCompany({ ...c, kasse: c.kasse + umsatz, pitch_day: day, pitch_today: done + 1 });
  return { ok: true, umsatz, done: done + 1, max: data.MAX_PITCH_PER_DAY, time, factor: time.factor };
}

/**
 * Gewinn entnehmen – Umbuchung, keine Steuer, kein Level-Zuschlag.
 *
 * Entnahme ist eine Umbuchung, keine Einnahme: Ohne `xp: false` würde
 * Einzahlen + Entnehmen desselben Betrags Erfahrung aus dem Nichts erzeugen
 * (unb.changeCash vergibt sie je Buchung). XP für Firmengewinn gibt es erst,
 * wenn Stück 2 Kapital und Gewinn trennt.
 */
async function withdraw(guildId, userId, amount, now = Date.now()) {
  const ctx = fresh(guildId, userId, now);
  if (!ctx) return { ok: false, reason: 'no_company' };
  const c = ctx.company;
  const value = Math.floor(Number(amount) || 0);
  if (value <= 0) return { ok: false, reason: 'amount' };
  if (value > c.kasse) return { ok: false, reason: 'kasse', kasse: c.kasse };
  db.saveCompany({ ...c, kasse: c.kasse - value });
  try {
    const balance = await changeCash(guildId, userId, value, `Entnahme: ${c.name}`,
      { xp: false, tax: false, kind: 'company' });
    return { ok: true, amount: value, balance, kasse: c.kasse - value };
  } catch (err) {
    // Buchung fehlgeschlagen -> Kasse frisch lesen und den Betrag zurücklegen (wie bei `found`).
    const current = db.getCompany(c.id);
    db.saveCompany({ ...current, kasse: current.kasse + value });
    return { ok: false, reason: 'payment', error: err.message };
  }
}

/**
 * Kapital einzahlen – von Bargeld (notfalls Bank), setzt die Minus-Uhr zurück.
 * Umbuchung wie die Entnahme: keine Erfahrung (sonst XP-Schleife über die Kasse).
 */
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
  const after = await changeCash(guildId, userId, -value, `Einzahlung: ${c.name}`,
    { xp: false, kind: 'company' });
  const current = db.getCompany(c.id);                 // frisch lesen: die Buchung hat gewartet
  if (!current || current.status !== 'open') {
    // Firma wurde während der Buchung geschlossen/insolvent -> Geld zurück. Das ist die
    // zweite Buchung dieser abgebrochenen Aktion, aber sie kehrt die erste exakt um.
    await changeCash(guildId, userId, value, `Rückzahlung: ${c.name}`, { tax: false, kind: 'company' });
    return { ok: false, reason: 'closed' };
  }
  const kasse = current.kasse + value;
  db.saveCompany({ ...current, kasse, negative_since: kasse < 0 ? current.negative_since : 0 });
  return { ok: true, amount: value, balance: after, kasse };
}

/** Rang ±1, geklemmt auf 0…2; bei Spielern auch employment.rank. */
function promote(guildId, userId, staffId, delta, now = Date.now()) {
  const step = delta > 0 ? 1 : delta < 0 ? -1 : 0;
  if (!step) return { ok: false, reason: 'delta' };
  const ctx = fresh(guildId, userId, now);
  if (!ctx) return { ok: false, reason: 'no_company' };
  const s = db.staffById(staffId);
  if (!s || s.company_id !== ctx.company.id) return { ok: false, reason: 'not_found' };
  const rank = s.rank + step;
  if (rank < 0 || rank >= data.RANKS.length) return { ok: false, reason: 'range', rank: rankOf(s.rank) };
  db.saveStaff({ ...s, rank });
  if (s.kind === 'player') db.promote(guildId, s.user_id, rank, db.getEmployment(guildId, s.user_id)?.shifts ?? 0);
  return { ok: true, staff: { ...s, rank }, rank: rankOf(rank) };
}

/**
 * Prämie aus der Kasse an einen Spieler-Angestellten – eine Buchung. `kind:
 * 'company'`, nicht 'job': Eine Prämie ist keine Schicht und darf keinen
 * Schicht-Erfolg auslösen (activity.js ignoriert unbekannte Kennungen).
 */
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
  try {
    await changeCash(guildId, s.user_id, value, `Prämie: ${c.name}`, { kind: 'company' });
    return { ok: true, amount: value, staff: s };
  } catch (err) {
    // Buchung fehlgeschlagen -> Kasse frisch lesen und den Betrag zurücklegen (wie bei `found`).
    const current = db.getCompany(c.id);
    db.saveCompany({ ...current, kasse: current.kasse + value });
    return { ok: false, reason: 'payment', error: err.message };
  }
}

/**
 * Freiwillig schließen: Kasse (wenn positiv) entnehmen, dann aufräumen. Die Zeile geht
 * zuerst (§7) – schlägt die Auszahlung danach fehl, gibt es niemanden mehr, dem man das
 * Geld zurückbuchen könnte, also bleibt die Firma zu und ein Admin muss von Hand nachbuchen.
 */
async function close(guildId, userId, now = Date.now()) {
  const ctx = fresh(guildId, userId, now);
  if (!ctx) return { ok: false, reason: 'no_company' };
  const c = ctx.company;
  const payout = Math.max(0, Math.round(c.kasse));
  const closed = closeCompany(guildId, c.id, now, 'closed');
  if (payout <= 0) return { ok: true, company: closed, payout, paid: true, balance: null };
  try {
    const balance = await changeCash(guildId, userId, payout, `Auflösung: ${c.name}`,
      { xp: false, tax: false, kind: 'company' });
    return { ok: true, company: closed, payout, paid: true, balance };
  } catch (err) {
    console.warn(`Firma ${c.id}: Auszahlung von ${payout} bei Auflösung fehlgeschlagen – ${err.message}`);
    return { ok: true, company: closed, payout, paid: false, error: err.message };
  }
}

/**
 * Verkauf im Übernahme-Vorfall: schließt mit Grund `sold` und zahlt
 * Gründung + Ausbau + Kasse – nie mehr, als reingesteckt wurde (§3).
 * Eine Buchung, ohne XP und Steuer (Umbuchung wie bei `close`).
 * Ohne Abrechnung (`ownerContext`, nicht `fresh`): der Aufrufer steht
 * mitten in einem Vorfall, die Firma ist schon abgerechnet.
 */
async function sell(guildId, userId, now = Date.now()) {
  const ctx = ownerContext(guildId, userId);
  if (!ctx) return { ok: false, reason: 'no_company' };
  const { company: c, branch: b } = ctx;
  const extraIds = db.companyExtras(c.id);
  const payout = Math.max(0, Math.round(investedOf(b, c, extraIds) + c.kasse));
  const closed = closeCompany(guildId, c.id, now, 'sold');
  if (payout <= 0) return { ok: true, company: closed, payout, paid: true, balance: null };
  try {
    const balance = await changeCash(guildId, userId, payout, `Verkauf: ${c.name}`,
      { xp: false, tax: false, kind: 'company' });
    return { ok: true, company: closed, payout, paid: true, balance };
  } catch (err) {
    console.warn(`Firma ${c.id}: Auszahlung von ${payout} beim Verkauf fehlgeschlagen – ${err.message}`);
    return { ok: true, company: closed, payout, paid: false, error: err.message };
  }
}

// ------------------------------------------------------------------ Anzeige

/** Alles, was die Firmenansicht wissen muss – nach Abrechnung. */
function status(guildId, userId, now = Date.now()) {
  const ctx = fresh(guildId, userId, now);
  if (!ctx) return null;
  const { company: c, branch: b, staff } = ctx;
  const day = dayKey(now);
  const extraIds = db.companyExtras(c.id);
  const eff = effectiveOf(c, b, extraIds);
  const ceilingNow = ceilingOf(b, c.stufe, extraIds);
  // Prognose: was die heutige NPC-Besetzung bei heutiger Auslastung am Tag
  // bringt – Spieler-Schichten (freiwillig, ungewiss) zählen hier nicht mit.
  // Laufende Ereignis-Faktoren (Umsatz-Boost, Lohn-Faktor, Schließung) zählen
  // hier mit – sonst zeigt die Prognose an geschlossenen oder verboosteten
  // Tagen einen Wert, den die Abrechnung so nie bringt.
  const fUmsatz = c.umsatz_boost_until >= now ? c.umsatz_boost : 1;
  const fLohn = c.wage_factor_until >= now ? c.wage_factor : 1;
  const closedNow = (c.closed_until ?? 0) >= now;
  const forecast = staff.filter((s) => s.kind === 'npc').reduce((sum, s) => {
    const f = rankOf(s.rank).factor;
    const umsatzTeil = closedNow ? 0 : Math.round(b.umsatz * f * c.auslastung * eff.umsatzFactor * fUmsatz);
    return sum + data.NPC_SHIFTS * (umsatzTeil - Math.round(b.lohn * f * fLohn));
  }, 0);
  const minusDays = c.negative_since ? Math.floor((now - c.negative_since) / DAY_MS) : 0;
  // Die Auslastung bewegt sich nur bei der Abrechnung (§4) – die Ansicht zeigt
  // deshalb, wohin sie will, was der nächste Tick bringt und wann er kommt.
  // Der nächste Tag rechnet mit `paid_through + DAY_MS`, genau wie `settle`.
  const nextTag = c.paid_through + DAY_MS;
  const target = dailyTarget(b, staff.length, c.werbung_until >= nextTag, eff.slots);
  const auslastungTomorrow = c.auslastung + (target - c.auslastung) * data.AUSLASTUNG_STEP;
  return {
    company: c, branch: b, staff,
    free: eff.slots - staff.length,
    kasse: c.kasse, auslastung: c.auslastung,
    target, auslastungTomorrow, nextSettleMs: Math.max(0, nextTag - now),
    werbungMs: Math.max(0, c.werbung_until - now),
    minusDays, daysLeft: c.negative_since ? Math.max(0, data.INSOLVENCY_DAYS - minusDays) : null,
    pitchLeft: data.MAX_PITCH_PER_DAY - (c.pitch_day === day ? c.pitch_today : 0),
    budget: require('./creator').budget(guildId, userId, now),
    ceiling: ceilingNow, ceilingNow, ceilingMax: fullCeilingOf(b), forecast,
    effective: eff, stufe: c.stufe, nextStufe: nextStufe(c, b),
    stufen: b.stufen.map((st) => ({ ...st, owned: st.id <= c.stufe })),
    extras: b.extras.map((e) => ({ ...e, owned: extraIds.includes(e.id), locked: c.stufe < e.minStufe })),
    werbungCost: Math.round(b.price * data.WERBUNG_COST_SHARE),
    // Ereignisse (Stück 2b): Chronik, Schließung, laufende Faktoren, Größe und Investition.
    news: typeof c.news === 'string' ? JSON.parse(c.news || '[]') : (c.news ?? []),
    closedMs: Math.max(0, (c.closed_until ?? 0) - now),
    groesse: groesse(c, extraIds), invested: investedOf(b, c, extraIds),
    umsatzBoost: c.umsatz_boost_until >= now ? { factor: c.umsatz_boost, until: c.umsatz_boost_until } : null,
    wageFactor: c.wage_factor_until >= now ? { factor: c.wage_factor, until: c.wage_factor_until } : null,
    // Offener Vorfall (spät gebunden, nur diese Domäne – decisions kennt alle drei).
    incident: (() => { const p = require('./decisions').pending(guildId, userId, now); return p?.platform === 'company' ? p : null; })(),
  };
}

// ------------------------------------------------------------------ Ausbau

/**
 * Bezahlt eine Investition vom Konto des Inhabers (Bargeld, notfalls Bank) –
 * eine Buchung, ohne XP: Investition ist keine Ausgabe fürs Level, sonst
 * wäre Kaufen die nächste XP-Schleife (siehe deposit/withdraw).
 * Gibt `{ ok, balance }` oder `{ ok: false, reason: 'funds'|'payment', … }`.
 */
async function pay(guildId, userId, price, reason) {
  const balance = await getBalance(guildId, userId);
  if (balance.total < price) return { ok: false, reason: 'funds', needed: price, have: balance.total };
  let moved = 0;
  try {
    if (balance.cash < price) {
      await unb.withdrawFromBank(guildId, userId, price - balance.cash, reason);
      moved = price - balance.cash;             // erst nach Erfolg merken: ein Bankfehler darf nichts umkehren
    }
    const after = await changeCash(guildId, userId, -price, reason, { xp: false, kind: 'company' });
    return { ok: true, balance: after };
  } catch (err) {
    // Bank wurde schon angezapft, die Abbuchung vom Konto ist aber gescheitert –
    // sonst wäre das Geld weg, ohne dass ein Kauf zustande kam (Muster src/npc.js).
    if (moved) await unb.withdrawFromBank(guildId, userId, -moved, 'Ausbau abgebrochen').catch(() => {});
    return { ok: false, reason: 'payment', error: err.message };
  }
}

/**
 * Firmen, für die gerade ein Kauf läuft (§7). Die Sperre wird synchron vor dem
 * ersten `await` gesetzt: Ein zweiter Klick, der während `getBalance` eintrifft,
 * darf nicht die schon erhöhte Stufe lesen und die übernächste kaufen – das
 * wäre ein Kauf ohne Guthabenprüfung, und die bedingte Rücknahme des ersten
 * Kaufs würde bei einem Buchungsfehler ins Leere laufen. Die bedingte
 * Schreibung bleibt als zweite Verteidigungslinie.
 */
const inFlight = new Set();

/** Die nächste Stufe der Leiter kaufen. Stufe zuerst (§7), dann buchen; bei Fehler zurück. */
async function upgrade(guildId, userId, now = Date.now()) {
  const ctx = fresh(guildId, userId, now);
  if (!ctx) return { ok: false, reason: 'no_company' };
  const { company: c, branch: b } = ctx;
  if (inFlight.has(c.id)) return { ok: false, reason: 'busy' };
  inFlight.add(c.id);
  try {
    const st = nextStufe(c, b);
    if (!st) return { ok: false, reason: 'max' };
    const balance = await getBalance(guildId, userId);
    if (balance.total < st.price) return { ok: false, reason: 'funds', needed: st.price, have: balance.total, stufe: st };

    // Bedingt schreiben: nur wenn die Stufe noch beim gelesenen Stand ist – sonst
    // hat ein gleichzeitiger zweiter Klick den Kauf schon abgeschlossen (§9).
    if (!db.setCompanyStufe(c.id, st.id, c.stufe)) return { ok: false, reason: 'busy' };
    const paid = await pay(guildId, userId, st.price, `Ausbau: ${c.name} – ${st.name}`);
    if (!paid.ok) {
      if (!db.setCompanyStufe(c.id, c.stufe, st.id)) {
        console.warn(`Firma ${c.id}: Stufe ${st.id} nach fehlgeschlagener Buchung nicht zurückgenommen – Stand hat sich inzwischen geändert.`);
      }
      return {
        ok: false, reason: paid.reason, needed: paid.needed, have: paid.have, error: paid.error, stufe: st,
      };
    }
    return { ok: true, stufe: st, price: st.price, balance: paid.balance };
  } finally {
    inFlight.delete(c.id);
  }
}

/** Ein Extra kaufen – jedes genau einmal, manche erst ab einer Stufe. */
async function buyExtra(guildId, userId, extraId, now = Date.now()) {
  const ctx = fresh(guildId, userId, now);
  if (!ctx) return { ok: false, reason: 'no_company' };
  const { company: c, branch: b } = ctx;
  if (inFlight.has(c.id)) return { ok: false, reason: 'busy' };
  inFlight.add(c.id);
  try {
    const e = b.extras.find((x) => x.id === String(extraId));
    if (!e) return { ok: false, reason: 'unknown' };
    if (db.companyExtras(c.id).includes(e.id)) return { ok: false, reason: 'owned', extra: e };
    if (c.stufe < e.minStufe) return { ok: false, reason: 'stufe', extra: e, minStufe: e.minStufe };
    const balance = await getBalance(guildId, userId);
    if (balance.total < e.price) return { ok: false, reason: 'funds', needed: e.price, have: balance.total, extra: e };

    try {
      db.addCompanyExtra(c.id, e.id, now);
    } catch {
      // PRIMARY KEY (company_id, extra_id) schlägt fehl, wenn ein gleichzeitiger
      // zweiter Klick das Extra schon eingetragen hat (Muster wie bei `found`).
      return { ok: false, reason: 'owned', extra: e };
    }
    const paid = await pay(guildId, userId, e.price, `Ausbau: ${c.name} – ${e.name}`);
    if (!paid.ok) {
      db.deleteCompanyExtra(c.id, e.id);
      return {
        ok: false, reason: paid.reason, needed: paid.needed, have: paid.have, error: paid.error, extra: e,
      };
    }
    return { ok: true, extra: e, price: e.price, balance: paid.balance };
  } finally {
    inFlight.delete(c.id);
  }
}

module.exports = {
  BRANCHES: data.BRANCHES, RANKS: data.RANKS, JOB_PREFIX, DAY_MS,
  MAX_STUFE: data.MAX_STUFE, CONFIRM_ABOVE: data.CONFIRM_ABOVE,
  branch, rankOf, companyJobId, companyIdOfJob, dayKey, ownCompany, ownerContext,
  ceilingOf, effectiveOf, nextStufe, fullCeilingOf, cleanName, found, hireNpc, fire,
  dailyTarget, closeCompany, lastClosed, settle,
  asJob, openings, join, leave, workShift,
  advertise, pitchIn, withdraw, deposit, promote, bonus, close, sell, status, fresh,
  upgrade, buyExtra,
  groesse, riskPerDay, riskFor, severityFor, investedOf, applyEffect, pushNews, rollLightEvent, NEWS_MAX,
};
