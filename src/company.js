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

/**
 * Wie viele Firmen ein Konto dieses Levels führen darf – rein, ohne Datenbank.
 * Level 0…9 eine, ab 10 zwei … gedeckelt auf COMPANIES_MAX.
 */
function maxCompanies(level) {
  return Math.max(1, Math.min(data.COMPANIES_MAX,
    1 + Math.floor((Number(level) || 0) / data.COMPANIES_PER_LEVEL)));
}

/** Alle offenen Firmen eines Spielers, älteste zuerst. */
function companiesOf(guildId, userId) { return db.openCompaniesOf(guildId, userId); }

/**
 * Die Firma, auf die sich eine Aktion ohne ausdrückliche ID bezieht: die
 * zuletzt gewählte oder gegründete – sonst die älteste offene.
 */
function activeCompanyId(guildId, userId) {
  const row = db.getActiveCompany(guildId, userId);
  const open = companiesOf(guildId, userId);
  if (row && open.some((c) => c.id === row.company_id)) return row.company_id;
  return open[0]?.id ?? null;
}

/** Merkt sich die Firma, auf die sich die nächsten Aktionen beziehen. */
function setActive(guildId, userId, companyId, now = Date.now()) {
  if (companyId) db.setActiveCompany(guildId, userId, Number(companyId), now);
}

/**
 * Die gemeinte offene Firma eines Spielers, oder null. Mit `companyId` wird
 * die Zeile geprüft (Server, Inhaber, offen) – so kann keine fremde Firma
 * über eine geratene ID bedient werden; ohne ID gilt die aktive.
 */
function ownCompany(guildId, userId, companyId = null) {
  if (companyId === null || companyId === undefined || companyId === '') {
    const id = activeCompanyId(guildId, userId);
    return id === null ? null : db.getCompany(id) ?? null;
  }
  const c = db.getCompany(Number(companyId));
  if (!c || c.guild_id !== guildId || c.owner_id !== String(userId) || c.status !== 'open') return null;
  return c;
}

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
  // Wareneinsatz bei Kurs = Start (Stück 3a) – die Decke ist die eines Tages
  // mit vollem Lager zum Normalpreis.
  const ware = (slots * data.NPC_SHIFTS + data.MAX_PITCH_PER_DAY) * wareUnit(b);
  // Ganze Taler: die Anzeige zeigt die Decke, und 16.631,25 sind kein Betrag.
  return { gross, wages, ware, net: gross - wages - ware, slots, factor: umsatzFactor };
}

function fullCeilingOf(b) {
  return ceilingOf(b, data.MAX_STUFE, b.extras.map((e) => e.id));
}

// ----------------------------------------------------------------- Waren

/** Einheitspreis bei Kurs = Start: ein Fünftel des Schichtumsatzes. */
function wareUnit(b) {
  return Math.round(b.umsatz * data.WARE_SHARE);
}

/**
 * Die Ware einer Branche mit Tagespreis. Der Kurs ist der zuletzt notierte
 * der Lieferanten-Aktie (die Börse schreibt sich über Ticker und Ansichten
 * fort – die Firma stößt nichts an); ohne Notierung gilt der Startkurs.
 * Das Verhältnis ist geklemmt (0,5 … 2,0): Ein Kurssturz macht Ware billig,
 * nie umsonst; eine Blase teuer, nie unbezahlbar.
 */
function wareOf(guildId, b) {
  const asset = require('./data/wallstreet').find(b.ware.supplier);
  const kurs = db.getPrice(guildId, asset.symbol)?.price ?? asset.start;
  const ratio = Math.max(data.WARE_KURS_MIN, Math.min(data.WARE_KURS_MAX, kurs / asset.start));
  const unit = wareUnit(b);
  const price = Math.round(unit * ratio);
  return {
    ...b.ware, asset, start: asset.start, kurs, ratio, unit, price,
    adhoc: Math.round(price * data.AD_HOC_MARKUP),
  };
}

/**
 * Einen Wareneinkauf bei der Börse melden (Stück 3c, Nachfrage-Drift): jede
 * gekaufte Einheit – Erstausstattung, Lagerkauf, ad hoc, Großhandel – hebt die
 * Nachfrage der Lieferanten-Aktie der **kaufenden** Branche. Spät gebunden,
 * damit company.js die Börse nicht beim Laden zieht. Synchron und billig.
 */
function noteDemand(guildId, b, units, now) {
  if (!(units > 0)) return null;
  return require('./wallstreet').recordDemand(guildId, b.ware.supplier, units, now);
}

/** Lagerkapazität: eine Woche Vollbetrieb (NPC-Schichten + Anpacken). */
function capacityOf(b, eff) {
  return (eff.slots * data.NPC_SHIFTS + data.MAX_PITCH_PER_DAY) * data.LAGER_TAGE;
}

/**
 * Erstausstattung bei der Gründung: ein volles Kern-Lager zum Einheitspreis
 * (Kiosk 70 × 50 = 3.500, Baufirma 280 × 340 = 95.200). Ohne sie startet jede
 * Firma mit leerem Lager, und bei Auslastung 0,3–0,4 ist die Schicht mit Ware
 * ad hoc tagelang rot – die NPCs kündigen nach drei unbezahlten Tagen und der
 * Betrieb ist an Tag 15 insolvent, bevor er je ein Lager bezahlen konnte
 * (Spec-Nachtrag 2026-09-20). Der Betrag wird in derselben Buchung wie der
 * Gründungspreis gezahlt und liegt als `stock_cost` im Lager – beim Schließen
 * kommt er wie jeder Einkauf zum Einstand zurück, nie mehr (§3, kein Faucet).
 */
function starterOf(b) {
  const units = capacityOf(b, effectiveOf({ id: 0, stufe: 0 }, b, []));
  return { units, cost: units * wareUnit(b) };
}

/**
 * Eine Einheit verbrauchen: aus dem Lager (Wert um den Ø-Preis senken) oder
 * ad hoc zum Aufschlag von der Kasse – die darf dabei ins Minus wie bei Löhnen.
 * Rein: liefert die fortgeschriebene Firmenzeile. Jede Schicht (NPC, Spieler,
 * Anpacken) ruft das genau einmal; ein geschlossener Tag verbraucht nichts.
 */
function consumeOne(c, w) {
  const next = { ...c };
  if ((next.stock ?? 0) > 0) {
    const avg = Math.round((next.stock_cost ?? 0) / next.stock);
    next.stock -= 1;
    // Die letzte Einheit nimmt den Restwert mit – kein Rundungsrest, nie negativ.
    next.stock_cost = next.stock > 0 ? Math.max(0, (next.stock_cost ?? 0) - avg) : 0;
    return { company: next, cost: 0, adhoc: false };
  }
  next.kasse -= w.adhoc;
  return { company: next, cost: w.adhoc, adhoc: true };
}

/** Name-Regeln: 2–32 Zeichen, keine Erwähnungen. */
function cleanName(name) {
  const s = String(name ?? '').replace(/\s+/g, ' ').trim();
  if (s.length < 2 || s.length > 32 || /[@<>]/.test(s)) return null;
  return s;
}

// ------------------------------------------------------------------ Gründen

/**
 * Aktionen, die gerade laufen (§7). Die Sperre wird synchron vor dem ersten
 * `await` gesetzt: Ein zweiter Klick, der während eines `await` eintrifft,
 * darf nicht denselben (noch alten) Stand lesen und ein zweites Mal zuschlagen
 * – das wäre z. B. eine Gründung ohne erneute Limit-Prüfung oder ein Kauf ohne
 * erneute Guthabenprüfung. `found` schlüsselt über `${guildId}:${userId}`
 * (es gibt noch keine Firmen-ID), `upgrade`/`buyExtra` über die Firmen-ID –
 * beide Schlüsselarten leben nebeneinander im selben Set, sie können nicht
 * kollidieren.
 */
const inFlight = new Set();

/**
 * Gründet eine Firma. Zeile zuerst (§7), dann EINE Buchung von Preis plus
 * Erstausstattung (§9: Gründung und Lager sind ein Kauf); scheitert die
 * Buchung, wird die Zeile wieder gelöscht. Die Firma kommt mit vollem Lager
 * zur Welt (`stock` = Kern-Kapazität, `stock_cost` = Erstausstattung).
 */
async function found(guildId, userId, branchId, name, now = Date.now()) {
  const b = branch(branchId);
  if (!b) return { ok: false, reason: 'unknown_branch' };
  const clean = cleanName(name);
  if (!clean) return { ok: false, reason: 'name' };
  // Sperre vor der Limit-Prüfung, synchron vor dem ersten `await`: zwei
  // Gründungen desselben Spielers kurz hintereinander dürfen nicht beide am
  // selben (noch alten) Limit-Stand vorbei ins Ziel laufen (früher hielt das
  // der inzwischen entfernte Unique-Index `idx_companies_owner_open`).
  const lockKey = `${guildId}:${userId}`;
  if (inFlight.has(lockKey)) return { ok: false, reason: 'busy' };
  inFlight.add(lockKey);
  try {
    // Stück 4: mehrere Firmen, aber nur so viele, wie das Level hergibt.
    const open = companiesOf(guildId, userId);
    const level = require('./perks').levelOf(guildId, userId);
    const max = maxCompanies(level);
    if (open.length >= max) {
      const nextAt = max < data.COMPANIES_MAX ? max * data.COMPANIES_PER_LEVEL : null;
      return { ok: false, reason: 'limit', have: open.length, max, level, nextAt };
    }

    const starter = starterOf(b);
    const total = b.price + starter.cost;
    const balance = await getBalance(guildId, userId);
    if (balance.total < total) {
      return { ok: false, reason: 'funds', needed: total, have: balance.total, starter };
    }

    let row;
    try {
      row = db.insertCompany({ guildId, ownerId: userId, branch: b.id, name: clean, now,
        stock: starter.units, stockCost: starter.cost });
    } catch (err) {
      // Die Zeile konnte nicht angelegt werden (Datenbankfehler) – nichts gebucht.
      return { ok: false, reason: 'insert', error: err.message };
    }

    let newBalance;
    try {
      if (balance.cash < total) {
        await unb.withdrawFromBank(guildId, userId, total - balance.cash, `Gründung: ${clean}`);
      }
      newBalance = await changeCash(guildId, userId, -total, `Gründung: ${clean}`,
        { kind: 'company' });
    } catch (err) {
      db.deleteCompany(row.id);
      return { ok: false, reason: 'payment', error: err.message };
    }
    // Erst nach der Buchung, außerhalb des try: ein Fehler in der Nachfrage-Messung
    // darf eine bezahlte Firma nie wieder löschen.
    noteDemand(guildId, b, starter.units, now);   // die Erstausstattung ist ein Kauf
    setActive(guildId, userId, row.id, now);      // die frisch gegründete ist die gemeinte
    return { ok: true, company: row, branch: b, balance: newBalance, starter, total };
  } finally {
    inFlight.delete(lockKey);
  }
}

// ----------------------------------------------------------------- Personal

/** Firma des Inhabers samt Branche und Personal – der Einstieg jeder Aktion. */
function ownerContext(guildId, userId, companyId = null) {
  const c = ownCompany(guildId, userId, companyId);
  if (!c) return null;
  return { company: c, branch: branch(c.branch), staff: db.companyStaff(c.id) };
}

/** Einen NPC einstellen, solange ein Platz frei ist – nach Abrechnung (Kündigungen zuerst). */
function hireNpc(guildId, userId, now = Date.now(), random = Math.random, companyId = null) {
  // `Math.random` hier ist der Abrechnungswürfel von `fresh`, nicht der Namenswürfel
  // `random` unten – zwei verschiedene Würfel, absichtlich nicht zusammengelegt.
  const ctx = fresh(guildId, userId, now, Math.random, companyId);
  if (!ctx) return { ok: false, reason: 'no_company' };
  const eff = effectiveOf(ctx.company, ctx.branch);
  if (ctx.staff.length >= eff.slots) return { ok: false, reason: 'full' };
  const name = data.NPC_NAMES[Math.min(data.NPC_NAMES.length - 1,
    Math.floor(random() * data.NPC_NAMES.length))];
  const staff = db.insertStaff({ companyId: ctx.company.id, kind: 'npc', name, now });
  return { ok: true, staff, free: eff.slots - ctx.staff.length - 1 };
}

/** Entlassen – NPC oder Spieler; bei Spielern auch die Anstellung lösen. Rechnet vorher ab. */
function fire(guildId, userId, staffId, now = Date.now(), companyId = null) {
  // `Math.random` hier ist nur der Abrechnungswürfel von `fresh` (wie bei `hireNpc`).
  const ctx = fresh(guildId, userId, now, Math.random, companyId);
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

/** Die Chronik einer Firmenzeile – leer, wenn das Feld fehlt oder kaputt ist. */
function newsOf(c) {
  try {
    const list = typeof c.news === 'string' ? JSON.parse(c.news || '[]') : (c.news ?? []);
    return Array.isArray(list) ? list : [];
  } catch { return []; }
}

/**
 * Eine Zeile in die Chronik (neueste zuerst, höchstens NEWS_MAX). `kasse` ist,
 * was die Zeile die Kasse netto gekostet oder gebracht hat (0 = nur Zustand).
 */
function pushNews(c, at, text, kasse = 0) {
  return [{ at, text, kasse }, ...newsOf(c)].slice(0, NEWS_MAX);
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
  db.deleteOffersOfCompany(c.id);
  db.deleteShareOffersOfCompany(c.id);      // Anteile bleiben (Auszahlung wird geteilt), Angebote nicht
  db.clearEmploymentByJob(guildId, companyJobId(c.id));
  // Zeigte die gemerkte Firma hierher, ist sie hinfällig – die nächste Aktion
  // ohne ID nimmt dann wieder die älteste offene (Stück 4).
  if (db.getActiveCompany(guildId, c.owner_id)?.company_id === c.id) {
    db.clearActiveCompany(guildId, c.owner_id);
  }
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
  let c = db.getCompany(companyId);
  if (!c || c.status !== 'open') return null;
  const b = branch(c.branch);
  const extraIds = db.companyExtras(c.id);
  const eff = effectiveOf(c, b, extraIds);
  const guildId = c.guild_id;

  // Firmen aus der Zeit vor der Erstausstattung (stock_seeded 0): einmal das Lager
  // auffüllen, ohne Einstand – der Bestand wurde nie bezahlt, also zahlt ihn das
  // Schließen auch nicht aus (`stock_cost` bleibt, was wirklich gekauft wurde). Vor
  // dem frühen Ausstieg, damit schon der erste Blick nach dem Update befüllt.
  if (!c.stock_seeded) {
    c = { ...c, stock: Math.max(c.stock ?? 0, capacityOf(b, eff)), stock_seeded: 1 };
    c.news = pushNews(c, now, '📦 Lager aus der Zeit vor dem Update aufgefüllt – ohne Einstand.');
    db.saveCompany(c);
  }

  const out = { days: 0, umsatz: 0, loehne: 0, quit: [], insolvent: false,
    auslastung: c.auslastung, kasse: c.kasse, news: [], incident: null,
    ware: { units: 0, adhoc: 0, cost: 0 } };
  const total = Math.floor((now - c.paid_through) / DAY_MS);
  if (total <= 0) return out;
  const w = wareOf(guildId, b);                // Tagespreis – gilt für alle nachgeholten Tage
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
      const kasse = r.done.kasse + r.done.refund;
      cur.news = pushNews(cur, tag, text, kasse);
      out.news.push({ at: tag, text, kasse });
    }

    // 3. Faktoren des Tages und Schließung.
    const fUmsatz = cur.umsatz_boost_until >= tag ? cur.umsatz_boost : 1;
    const fLohn = cur.wage_factor_until >= tag ? cur.wage_factor : 1;
    const zu = tag <= (cur.closed_until ?? 0);

    // 4. NPC-Schichten – Löhne sind Verbindlichkeiten, auch bei geschlossenem Betrieb.
    //    Jede Schicht verbraucht eine Einheit Ware (Lager, sonst ad hoc von der
    //    Kasse) – vor der Umsatzbuchung, damit der Tag vollständig ist. Bei
    //    geschlossenem Betrieb gibt es keine Schicht und keinen Verbrauch.
    for (const s of staff) {
      if (s.kind !== 'npc') continue;
      const f = rankOf(s.rank).factor;
      const lohn = Math.round(b.lohn * f * fLohn);
      const umsatz = zu ? 0 : Math.round(b.umsatz * f * cur.auslastung * eff.umsatzFactor * fUmsatz);
      if (!zu) {
        for (let k = 0; k < data.NPC_SHIFTS; k++) {
          const v = consumeOne(cur, w);
          cur = v.company;
          out.ware.units++;
          if (v.adhoc) { out.ware.adhoc++; out.ware.cost += v.cost; }
        }
      }
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
      noteDemand(guildId, b, out.ware.adhoc, now);   // bis hierhin ad hoc gekauft
      return out;
    }
  }

  for (const s of staff) db.saveStaff(s);
  db.saveCompany({ ...cur, paid_through: tag });
  out.auslastung = cur.auslastung; out.kasse = cur.kasse;
  // Ad-hoc-Einheiten des Laufs sind Käufe: einmal gesammelt melden, mit `now`
  // (nachgeholte Tage zählen auf heute – die Börse rechnet je Lauf ohnehin grob).
  noteDemand(guildId, b, out.ware.adhoc, now);

  // Ein Vorfall je Abrechnung – über die nachgeholten Tage, nicht je Tag (§4).
  // Gewürfelt mit `now`, nicht mit dem Abrechnungstag: die 24-h-Frist läuft ab jetzt.
  out.incident = require('./decisions').roll(guildId, c.owner_id,
    { groesse: groesse(cur, extraIds), days, npc: staff.filter((s) => s.kind === 'npc').length,
      companyId: c.id },
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

  // Eine Schicht, eine Einheit Ware – aus dem Lager oder ad hoc von der Kasse.
  const v = consumeOne(c, wareOf(guildId, b));
  const after = { ...v.company, kasse: v.company.kasse - lohn + umsatz };
  db.saveCompany(after);
  db.saveStaff({ ...s, shifts: s.shifts + 1 });
  if (v.adhoc) noteDemand(guildId, b, 1, now);
  return { ok: true, lohn, umsatz, overtimeBonus: lohn - plain, company: after, branch: b, rank: rankOf(s.rank),
    ware: { adhoc: v.adhoc, cost: v.cost } };
}

// --------------------------------------------------------- Inhaber-Aktionen

/** Zeit aus dem gemeinsamen Tagesbudget (§15: eine Bremse, nicht zwei). */
function useTime(guildId, userId, cost, now) {
  return require('./creator').useTime(guildId, userId, cost, now);
}

/**
 * Firma des Inhabers nach Abrechnung – oder null (auch wenn gerade insolvent
 * geworden). `random` ist der Würfel der Abrechnung (Tests).
 */
function fresh(guildId, userId, now, random = Math.random, companyId = null) {
  const c = ownCompany(guildId, userId, companyId);
  if (!c) return null;
  settle(c.id, now, random);
  const after = db.getCompany(c.id);
  if (!after || after.status !== 'open') return null;
  return { company: after, branch: branch(after.branch), staff: db.companyStaff(after.id) };
}

/** Werbung: kostet 5 % des Gründungspreises aus der Kasse und Zeit; 3 Tage +0,25 aufs Ziel. */
async function advertise(guildId, userId, now = Date.now(), companyId = null) {
  const ctx = fresh(guildId, userId, now, Math.random, companyId);
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
async function pitchIn(guildId, userId, now = Date.now(), companyId = null) {
  const ctx = fresh(guildId, userId, now, Math.random, companyId);
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
  // Die Zeit ist gebucht, die Schicht findet statt: eine Einheit Ware (Lager oder ad hoc).
  const v = consumeOne(c, wareOf(guildId, b));
  db.saveCompany({ ...v.company, kasse: v.company.kasse + umsatz, pitch_day: day, pitch_today: done + 1 });
  if (v.adhoc) noteDemand(guildId, b, 1, now);
  return { ok: true, umsatz, done: done + 1, max: data.MAX_PITCH_PER_DAY, time, factor: time.factor,
    ware: { adhoc: v.adhoc, cost: v.cost } };
}

/**
 * Lager füllen – aus der Kasse, zum Tagespreis. `units` ganze Zahl oder 'voll'.
 * `async`, damit der Handler-Aufruf wie `deposit`/`withdraw` aussieht; es gibt
 * kein `await` – gewollt: Kassenzustand, keine Buchung über `unb`.
 */
async function buyStock(guildId, userId, units, now = Date.now(), companyId = null) {
  const ctx = fresh(guildId, userId, now, Math.random, companyId);
  if (!ctx) return { ok: false, reason: 'no_company' };
  const { company: c, branch: b } = ctx;
  const eff = effectiveOf(c, b);
  const capacity = capacityOf(b, eff);
  const free = capacity - (c.stock ?? 0);
  const n = units === 'voll' ? free : Math.floor(Number(units));
  if (!Number.isFinite(n) || n <= 0) return { ok: false, reason: units === 'voll' && free <= 0 ? 'capacity' : 'units', free };
  if (n > free) return { ok: false, reason: 'capacity', free };
  const w = wareOf(guildId, b);
  const cost = n * w.price;
  if (c.kasse < cost) return { ok: false, reason: 'kasse', cost, kasse: c.kasse };
  db.saveCompany({ ...c, kasse: c.kasse - cost, stock: (c.stock ?? 0) + n, stock_cost: (c.stock_cost ?? 0) + cost });
  noteDemand(guildId, b, n, now);
  return { ok: true, units: n, price: w.price, cost, stock: (c.stock ?? 0) + n, capacity, kasse: c.kasse - cost };
}

/**
 * Gewinn entnehmen – Umbuchung, keine Steuer, kein Level-Zuschlag.
 *
 * Entnahme ist eine Umbuchung, keine Einnahme: Ohne `xp: false` würde
 * Einzahlen + Entnehmen desselben Betrags Erfahrung aus dem Nichts erzeugen
 * (unb.changeCash vergibt sie je Buchung). XP für Firmengewinn gibt es erst,
 * wenn Stück 2 Kapital und Gewinn trennt.
 */
async function withdraw(guildId, userId, amount, now = Date.now(), companyId = null) {
  const ctx = fresh(guildId, userId, now, Math.random, companyId);
  if (!ctx) return { ok: false, reason: 'no_company' };
  const c = ctx.company;
  const value = Math.floor(Number(amount) || 0);
  if (value <= 0) return { ok: false, reason: 'amount' };
  if (value > c.kasse) return { ok: false, reason: 'kasse', kasse: c.kasse };
  // Anteile (Stück 3c): der Split ist rein (keine Schreibung) – die Halter
  // bekommen ihren Teil (`pending`) erst gutgeschrieben, wenn die Buchung des
  // Inhaberteils geglückt ist; scheitert sie, gibt es nichts zurückzunehmen,
  // weil noch nichts geschrieben wurde – nur die Kasse muss zurück.
  const split = splitPayout(c.id, value);
  db.saveCompany({ ...c, kasse: c.kasse - value, last_payout: value });
  try {
    const balance = await changeCash(guildId, userId, split.owner, `Entnahme: ${c.name}`,
      { xp: false, tax: false, kind: 'company' });
    creditParts(c.id, split.parts);
    const shared = value - split.owner;
    return { ok: true, amount: value, paid: split.owner, shared, balance, kasse: c.kasse - value };
  } catch (err) {
    // Buchung fehlgeschlagen -> Kasse frisch lesen und den Betrag zurücklegen (wie bei `found`).
    const current = db.getCompany(c.id);
    db.saveCompany({ ...current, kasse: current.kasse + value, last_payout: c.last_payout ?? 0 });
    return { ok: false, reason: 'payment', error: err.message };
  }
}

/**
 * Kapital einzahlen – von Bargeld (notfalls Bank), setzt die Minus-Uhr zurück.
 * Umbuchung wie die Entnahme: keine Erfahrung (sonst XP-Schleife über die Kasse).
 */
async function deposit(guildId, userId, amount, now = Date.now(), companyId = null) {
  const ctx = fresh(guildId, userId, now, Math.random, companyId);
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
function promote(guildId, userId, staffId, delta, now = Date.now(), companyId = null) {
  const step = delta > 0 ? 1 : delta < 0 ? -1 : 0;
  if (!step) return { ok: false, reason: 'delta' };
  const ctx = fresh(guildId, userId, now, Math.random, companyId);
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
async function bonus(guildId, userId, staffId, amount, now = Date.now(), companyId = null) {
  const ctx = fresh(guildId, userId, now, Math.random, companyId);
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
 * Freiwillig schließen: Kasse (wenn positiv) plus Lager zum Einstand entnehmen, dann
 * aufräumen. Das Lager zählt mit dem, was es gekostet hat (`stock_cost`) – Geld, das beim
 * Einkauf aus dem Spiel ging, kommt zurück, nie mehr (§3, kein Faucet). Die Zeile geht
 * zuerst (§7) – schlägt die Auszahlung danach fehl, gibt es niemanden mehr, dem man das
 * Geld zurückbuchen könnte, also bleibt die Firma zu und ein Admin muss von Hand nachbuchen.
 */
async function close(guildId, userId, now = Date.now(), companyId = null) {
  const ctx = fresh(guildId, userId, now, Math.random, companyId);
  if (!ctx) return { ok: false, reason: 'no_company' };
  const c = ctx.company;
  const payout = Math.max(0, Math.round(c.kasse + (c.stock_cost ?? 0)));
  const closed = closeCompany(guildId, c.id, now, 'closed');
  if (payout <= 0) return { ok: true, company: closed, payout, paid: true, shared: 0, balance: null };
  // Anteile (Stück 3c): die Halter bekommen ihren Teil synchron (`pending`) – die Firma
  // ist schon zu, ihr Anteil steht fest; nur der Inhaberteil hängt an der Buchung.
  const d = distribute(closed, payout);
  try {
    const balance = await changeCash(guildId, userId, d.owner, `Auflösung: ${c.name}`,
      { xp: false, tax: false, kind: 'company' });
    return { ok: true, company: closed, payout, paid: d.owner, shared: d.shared, balance };
  } catch (err) {
    console.warn(`Firma ${c.id}: Auszahlung von ${d.owner} bei Auflösung fehlgeschlagen – ${err.message}`);
    return { ok: true, company: closed, payout, paid: false, shared: d.shared, error: err.message };
  }
}

/**
 * Verkauf im Übernahme-Vorfall: schließt mit Grund `sold` und zahlt
 * Ausbau + Kasse + Lager zum Einstand (die Gründung nicht – so rechnet auch der
 * Schließen-Dialog), nie mehr, als reingesteckt wurde (§3).
 * Eine Buchung, ohne XP und Steuer (Umbuchung wie bei `close`).
 * Ohne Abrechnung (`ownerContext`, nicht `fresh`): der Aufrufer steht
 * mitten in einem Vorfall, die Firma ist schon abgerechnet.
 */
async function sell(guildId, userId, now = Date.now(), companyId = null) {
  const ctx = ownerContext(guildId, userId, companyId);
  if (!ctx) return { ok: false, reason: 'no_company' };
  const { company: c, branch: b } = ctx;
  const extraIds = db.companyExtras(c.id);
  const payout = Math.max(0, Math.round(investedOf(b, c, extraIds) + c.kasse + (c.stock_cost ?? 0)));
  const closed = closeCompany(guildId, c.id, now, 'sold');
  if (payout <= 0) return { ok: true, company: closed, payout, paid: true, shared: 0, balance: null };
  const d = distribute(closed, payout);              // Anteile (Stück 3c): wie bei `close`
  try {
    const balance = await changeCash(guildId, userId, d.owner, `Verkauf: ${c.name}`,
      { xp: false, tax: false, kind: 'company' });
    return { ok: true, company: closed, payout, paid: d.owner, shared: d.shared, balance };
  } catch (err) {
    console.warn(`Firma ${c.id}: Auszahlung von ${d.owner} beim Verkauf fehlgeschlagen – ${err.message}`);
    return { ok: true, company: closed, payout, paid: false, shared: d.shared, error: err.message };
  }
}

// ------------------------------------------------------------------ Handel
//
// Stück 3b: Die Spedition ist der Großhändler. Sie bietet je Branche die Ware
// zu einem Anteil des NPC-Tagespreises an (90–100 %), kauft selbst zum
// Großhandelspreis (NPC-Preis minus HANDEL_RABATT) und behält die Differenz.
// Kasse zu Kasse, synchron, ohne Buchung nach außen – kein Faucet: der Käufer
// zahlt höchstens den NPC-Preis, der Spediteur verdient höchstens den Rabatt.
// Der Spediteur braucht weder Lager noch Zeit, nur Tageskapazität
// (Plätze × HANDEL_KAPAZITAET Einheiten je Tag).

/** Preis, Großhandelspreis und Spanne je Einheit – rein. */
function tradeQuote(npcPrice, share) {
  const price = Math.round(npcPrice * share / 100);
  const wholesale = Math.round(npcPrice * (1 - data.HANDEL_RABATT));
  // Bei 90 % runden beide dieselbe Zahl – die Spanne ist nie negativ (der Test
  // prüft 1–2.000 × 90–100). Die Klemmung hält das, falls sich die Konstanten je
  // auseinanderbewegen: der Spediteur legt beim Liefern nie drauf (§3).
  return { price, wholesale, spread: Math.max(0, price - wholesale) };
}
const isTrader = (b) => !!b?.handel;

/** Wie viele Einheiten der Spediteur heute noch liefern kann. */
function tradeCapacity(c, b, now) {
  const eff = effectiveOf(c, b);
  const capacity = eff.slots * data.HANDEL_KAPAZITAET;
  const today = c.trade_day === dayKey(now) ? (c.trade_today ?? 0) : 0;
  return { capacity, today, left: Math.max(0, capacity - today) };
}

/** Die Angebote eines Spediteurs – alle neun Branchen in Katalogreihenfolge. */
function offersOf(guildId, companyId) {
  const rows = new Map(db.offersOfCompany(companyId).map((o) => [o.branch, o]));
  return data.BRANCHES.map((b) => {
    const o = rows.get(b.id);
    return { branch: b.id, ware: b.ware, share: o?.share ?? data.HANDEL_SHARE_MAX, active: !!o?.active };
  });
}

/**
 * Angebot setzen: Anteil 90–100 für eine Branche oder 'alle', oder 'aus'
 * (der Anteil bleibt gespeichert, nur der Schalter kippt). Ohne Abrechnung
 * (`ownerContext`): ein Preisschild kostet weder Zeit noch Geld.
 */
function setOffer(guildId, userId, branchId, share, now = Date.now(), companyId = null) {
  const ctx = ownerContext(guildId, userId, companyId);
  if (!ctx) return { ok: false, reason: 'no_company' };
  if (!isTrader(ctx.branch)) return { ok: false, reason: 'not_trader' };
  const targets = branchId === 'alle' ? data.BRANCHES.map((b) => b.id) : [String(branchId)];
  if (!targets.every((id) => branch(id))) return { ok: false, reason: 'branch' };
  const aus = share === 'aus';
  const n = Math.floor(Number(share));
  if (!aus && (!Number.isFinite(n) || n < data.HANDEL_SHARE_MIN || n > data.HANDEL_SHARE_MAX)) return { ok: false, reason: 'share' };
  const cur = new Map(db.offersOfCompany(ctx.company.id).map((o) => [o.branch, o]));
  for (const id of targets) {
    db.upsertOffer(ctx.company.id, id, aus ? (cur.get(id)?.share ?? data.HANDEL_SHARE_MAX) : n, aus ? 0 : 1, now);
  }
  return { ok: true, offers: offersOf(guildId, ctx.company.id) };
}

/**
 * Aktive Angebote offener, nicht geschlossener Spediteure mit Restkapazität für
 * die Ware einer Branche – billigster zuerst, bei Gleichstand nach Name.
 * `exceptId` blendet die eigene Firma aus (eine Spedition kauft nicht bei sich).
 */
function offersFor(guildId, buyerBranchId, now = Date.now(), exceptId = null) {
  const b = branch(buyerBranchId);
  if (!b) return [];
  const npc = wareOf(guildId, b).price;
  return db.activeOffersFor(guildId, b.id)
    .filter((c) => c.id !== Number(exceptId) && !(c.closed_until > now) && isTrader(branch(c.branch)))
    .map((c) => ({ company: { id: c.id, name: c.name }, share: c.share, ...tradeQuote(npc, c.share),
      left: tradeCapacity(c, branch(c.branch), now).left }))
    .filter((o) => o.left > 0)
    .sort((x, y) => x.price - y.price || x.company.name.localeCompare(y.company.name, 'de'));
}

/**
 * Kauf beim Spediteur: Kasse → Kasse, synchron, ohne Buchung nach außen. Der
 * Käufer zahlt `units × price` aus der Kasse ins Lager (Einstand wie bei
 * `buyStock`); der Spediteur bekommt nur die Spanne – den Großhandelspreis
 * hat er im selben Moment an den NPC-Lieferanten weitergereicht. `units`
 * ganze Zahl oder 'voll' (so viel wie Lager und Tageskapazität hergeben).
 * `async` wie `buyStock`: kein `await`, gewollt.
 */
async function buyFromTrader(guildId, buyerUserId, traderCompanyId, units, now = Date.now(), companyId = null) {
  const ctx = fresh(guildId, buyerUserId, now, Math.random, companyId);
  if (!ctx) return { ok: false, reason: 'no_company' };
  const { company: c, branch: b } = ctx;
  const traderId = Number(traderCompanyId);
  if (c.id === traderId) return { ok: false, reason: 'self' };
  // Günstige Prüfungen zuerst (kein anderer Server, existiert, ist Spediteur, hat ein
  // aktives Angebot) – erst danach lohnt sich die Tagesabrechnung des Spediteurs.
  let t = db.getCompany(traderId);
  const tb = t ? branch(t.branch) : null;
  const offer = t && db.offersOfCompany(traderId).find((o) => o.branch === b.id && o.active);
  if (!t || t.guild_id !== guildId || t.status !== 'open' || !isTrader(tb) || !offer) return { ok: false, reason: 'trader' };
  // Der Spediteur wird vor dem Lesen abgerechnet – seine Kasse soll den Tag
  // schon kennen, bevor die Spanne dazukommt (§4: faule Abrechnung, hier angestoßen).
  settle(traderId, now);
  t = db.getCompany(traderId);
  if (!t || t.status !== 'open' || t.closed_until > now) return { ok: false, reason: 'trader' };
  const free = capacityOf(b, effectiveOf(c, b)) - (c.stock ?? 0);
  const cap = tradeCapacity(t, tb, now);
  const want = units === 'voll' ? Infinity : Math.floor(Number(units));
  // Menge unbrauchbar (Garbage-Input wie 'x' oder <= 0) ist ein anderer Fehler als
  // „passt gerade nicht mehr rein" – die Ansicht soll das unterscheiden können.
  if (!(want > 0)) return { ok: false, reason: 'units', free, left: cap.left };
  const n = Math.min(want, free, cap.left);
  if (n <= 0) return { ok: false, reason: 'capacity', free, left: cap.left };
  const q = tradeQuote(wareOf(guildId, b).price, offer.share);
  const cost = n * q.price;
  if (c.kasse < cost) return { ok: false, reason: 'kasse', cost, kasse: c.kasse };
  const spread = n * q.spread;
  const buyer = { ...c, kasse: c.kasse - cost, stock: (c.stock ?? 0) + n, stock_cost: (c.stock_cost ?? 0) + cost };
  buyer.news = pushNews(buyer, now, `🚚 ${n} ${b.ware.name} von ${t.name} für ${cost.toLocaleString('de-DE')}`, -cost);
  const trader = { ...t, kasse: t.kasse + spread, trade_day: dayKey(now), trade_today: cap.today + n,
    trade_units: (t.trade_units ?? 0) + n, trade_profit: (t.trade_profit ?? 0) + spread };
  trader.news = pushNews(trader, now, `🚚 ${n} ${b.ware.name} an ${c.name} geliefert: +${spread.toLocaleString('de-DE')} Spanne`, spread);
  db.transaction(() => {
    db.saveCompany(buyer);
    db.saveCompany(trader);
  });
  // Die Ware kommt (gedanklich) vom Lieferanten der Käufer-Branche – der
  // Spediteur reicht nur durch; seine eigene Aktie (SCHR) bleibt unberührt.
  noteDemand(guildId, b, n, now);
  return { ok: true, units: n, price: q.price, wholesale: q.wholesale, cost, spread,
    trader: { id: t.id, name: t.name }, stock: buyer.stock, kasse: buyer.kasse };
}

// --------------------------------------------------------------- Anteile
//
// Jede Firma hat SHARES_TOTAL Anteile; der Inhaber hält, was niemand sonst
// hält (er hat keine eigene Zeile). Ab Stufe IPO_MIN_STUFE darf er bis auf
// OWNER_MIN abgeben; Halter dürfen weiterverkaufen. Ein Kauf ist ein Transfer
// Spieler → Spieler mit Gebühr (die einzige Senke des Handels, §3). Entnahme
// und Auszahlung (Schließen/Verkauf) werden nach Anteilen geteilt: Halter
// bekommen ihren Teil als `pending` gutgeschrieben und holen ihn gesammelt ab
// (eine Buchung je Abholung – nicht eine je Halter und Entnahme).

/** Anzeigename eines Spielers für die Chronik – spät gebunden, ohne Discord. */
function nameOf(userId) { return require('./identity').nameOf(userId) ?? 'Spieler'; }

/** Aufteilung einer Auszahlung: Halter bekommen floor(value × Anteile/1000), der Inhaber den Rest. */
function splitPayout(companyId, value) {
  const parts = db.companyShareHolders(companyId).filter((h) => h.shares > 0)
    .map((h) => ({ user_id: h.user_id, amount: Math.floor(value * h.shares / data.SHARES_TOTAL) }));
  return { owner: value - parts.reduce((s, p) => s + p.amount, 0), parts };
}

/** Schreibt die Halter-Teile eines (schon berechneten) Splits gut – reine Buchhaltung, keine Bank. */
function creditParts(companyId, parts) {
  for (const p of parts) {
    const h = db.getCompanyShare(companyId, p.user_id);
    db.setCompanyShare(companyId, p.user_id, { ...h, pending: (h?.pending ?? 0) + p.amount });
  }
}

/** Berechnet den Split und schreibt die Halter-Anteile sofort gut (synchron). */
function distribute(c, value) {
  const split = splitPayout(c.id, value);
  creditParts(c.id, split.parts);
  return { ...split, shared: value - split.owner };
}

/** Verteilung der Anteile: Gesamtzahl, Inhaberanteil, Halter mit > 0 Anteilen. */
function sharesOf(companyId) {
  const holders = db.companyShareHolders(companyId).filter((h) => h.shares > 0);
  const held = holders.reduce((s, h) => s + h.shares, 0);
  return { total: data.SHARES_TOTAL, owner: data.SHARES_TOTAL - held, holders };
}

/**
 * Anteile zum Verkauf stellen. Inhaber: nur die eigene, offene Firma, ab
 * Stufe IPO_MIN_STUFE, und nie unter OWNER_MIN (offene Angebote zählen als
 * schon abgegeben). Halter: höchstens die eigenen Anteile abzüglich offener
 * Angebote. Synchron, keine Buchung.
 */
function listShares(guildId, userId, companyId, shares, price, now = Date.now()) {
  const c = db.getCompany(Number(companyId));
  if (!c || c.status !== 'open' || c.guild_id !== guildId) return { ok: false, reason: 'no_company' };
  const n = Math.floor(Number(shares)), p = Math.floor(Number(price));
  if (!(n > 0)) return { ok: false, reason: 'shares' };
  if (!(p > 0)) return { ok: false, reason: 'price' };
  const offen = db.shareOffersOf(guildId, c.id).filter((o) => o.seller_id === String(userId)).reduce((s, o) => s + o.shares, 0);
  if (c.owner_id === String(userId)) {
    if ((c.stufe ?? 0) < data.IPO_MIN_STUFE) return { ok: false, reason: 'stufe', stufe: c.stufe ?? 0, min: data.IPO_MIN_STUFE };
    const free = sharesOf(c.id).owner - offen - data.OWNER_MIN;
    if (n > free) return { ok: false, reason: 'owner_min', free: Math.max(0, free) };
  } else {
    const h = db.getCompanyShare(c.id, userId);
    const free = Math.max(0, (h?.shares ?? 0) - offen);
    if (n > free) return { ok: false, reason: 'shares', free };
  }
  const offer = db.insertShareOffer({ guildId, companyId: c.id, sellerId: String(userId), shares: n, price: p, now });
  return { ok: true, offer };
}

/** Eigenes Angebot zurückziehen. */
function cancelShareOffer(guildId, userId, offerId) {
  const o = db.getShareOffer(Number(offerId));
  if (!o || o.guild_id !== guildId || o.seller_id !== String(userId)) return { ok: false, reason: 'offer' };
  db.deleteShareOffer(o.id);
  return { ok: true };
}

/**
 * Offene Angebote eines Servers (oder einer Firma), billigstes zuerst – mit
 * Firmenkopf, Buchwert je Anteil (Ausbau + Kasse + Lager, ohne Gründung: so
 * rechnet auch der Schließen-Dialog) und letzter Ausschüttung je Anteil.
 */
function shareOffers(guildId, companyId = null) {
  return db.shareOffersOf(guildId, companyId).map((o) => {
    if (o.shares <= 0) return null;                // gerade komplett reserviert (buyShares, §7)
    const c = db.getCompany(o.company_id);
    if (!c) return null;
    const b = branch(c.branch);
    const book = Math.round((investedOf(b, c, db.companyExtras(c.id)) + c.kasse + (c.stock_cost ?? 0)) / data.SHARES_TOTAL);
    return {
      id: o.id,
      company: { id: c.id, name: c.name, branch: b.id, branchName: b.name, emoji: b.emoji, stufe: c.stufe ?? 0 },
      seller_id: o.seller_id, shares: o.shares, price: o.price, book,
      lastPayout: Math.round((c.last_payout ?? 0) / data.SHARES_TOTAL),
    };
  }).filter(Boolean).sort((x, y) => x.price - y.price || x.id - y.id);
}

/**
 * Anteilskauf: ein Transfer Spieler → Spieler mit Gebühr (Senke). Erst nehmen,
 * dann buchen (§7): Das Angebot wird SYNCHRON vor dem ersten `await` um `n`
 * verkleinert – ein zweiter Klick sieht den Rest (oder 0) und bekommt `shares`.
 * Zwei Buchungen sind unvermeidlich (zwei Konten): Scheitert die erste (Käufer),
 * wächst das Angebot zurück; scheitert die zweite (Verkäufer), geht das Geld an
 * den Käufer zurück und das Angebot wächst zurück (Muster `pay`). Gelöscht wird
 * ein leeres Angebot erst, wenn beide Buchungen durch sind. Halter-Zeilen werden
 * erst danach geschrieben. Kauft der Inhaber zurück, bekommt er keine eigene
 * Halter-Zeile – sein impliziter Anteil (`sharesOf().owner`) wächst schon
 * dadurch, dass die Halter-Summe sinkt. Im Ergebnis ist `shares` immer `n`.
 */
async function buyShares(guildId, userId, offerId, shares, now = Date.now()) {
  const o = db.getShareOffer(Number(offerId));
  if (!o || o.guild_id !== guildId) return { ok: false, reason: 'offer' };
  if (o.seller_id === String(userId)) return { ok: false, reason: 'self' };
  const c = db.getCompany(o.company_id);
  if (!c || c.status !== 'open') return { ok: false, reason: 'closed' };
  const n = Math.floor(Number(shares));
  if (!(n > 0) || n > o.shares) return { ok: false, reason: 'shares', max: o.shares };
  // Zweite Absicherung (billig) gegen Drift zwischen Angebot und tatsächlichem Bestand:
  // reicht, was der Verkäufer wirklich hält, gerade noch für n Anteile dieses Kaufs?
  if (o.seller_id === c.owner_id) {
    if (sharesOf(c.id).owner - n < data.OWNER_MIN) return { ok: false, reason: 'shares', max: o.shares };
  } else {
    const h = db.getCompanyShare(c.id, o.seller_id);
    if ((h?.shares ?? 0) < n) return { ok: false, reason: 'shares', max: o.shares };
  }
  const cost = n * o.price;
  const fee = Math.round(cost * data.SHARE_FEE);
  const rest = o.shares - n;
  db.updateShareOffer(o.id, rest);                 // reserviert – synchron, vor dem ersten await
  // Rücknahme RELATIV zur aktuellen Zeile, nicht zum bei Eintritt gelesenen `o.shares`:
  // ein zweiter, zwischenzeitlich abgeschlossener Kauf hat den Rest schon weiter
  // verkleinert – absolut zurückschreiben würde dessen Reservierung mitkassieren
  // (Angebot überverkauft, 1000-Anteile-Invariante bricht).
  const restore = () => {
    const cur = db.getShareOffer(o.id);
    if (cur) { db.updateShareOffer(o.id, cur.shares + n); return; }
    // Zeile zwischenzeitlich komplett verkauft und gelöscht (die andere Buchung lief
    // durch, Rest 0) – Wiederherstellen unter derselben id geht nicht mehr, also für
    // den Verkäufer neu anlegen und die neue id protokollieren.
    const again = db.insertShareOffer({ guildId, companyId: c.id, sellerId: o.seller_id, shares: n, price: o.price, now });
    console.warn(`Anteile: Angebot ${o.id} war beim Rückbuchen weg, neu angelegt als ${again.id} (${n} Anteile, Verkäufer ${o.seller_id})`);
  };
  const paid = await pay(guildId, userId, cost + fee, `Anteile: ${c.name}`);
  if (!paid.ok) {
    restore();
    return { ok: false, reason: paid.reason, needed: paid.needed, have: paid.have, error: paid.error };
  }
  try {
    await changeCash(guildId, o.seller_id, cost, `Anteilsverkauf: ${c.name}`, { xp: false, tax: false, kind: 'company' });
  } catch (err) {
    restore();
    await changeCash(guildId, userId, cost + fee, 'Anteilskauf abgebrochen', { xp: false, tax: false, kind: 'company' })
      .catch((e) => console.warn(`Anteile: Rücknahme fehlgeschlagen (${userId}, ${cost + fee}) – ${e.message}`));
    return { ok: false, reason: 'payment', error: err.message };
  }
  if (rest <= 0) db.deleteShareOffer(o.id);
  const seller = db.getCompanyShare(c.id, o.seller_id);
  if (seller && seller.shares > 0) {
    // Einstand anteilig mitgeben – der Rest bleibt beim Verkäufer.
    const costOut = Math.round(seller.cost * n / seller.shares);
    db.setCompanyShare(c.id, o.seller_id, { ...seller, shares: seller.shares - n, cost: seller.cost - costOut });
  }
  if (String(userId) !== c.owner_id) {
    // Kauft irgendjemand außer dem Inhaber, bekommt er/sie eine Halter-Zeile.
    // Kauft der Inhaber selbst zurück, bleibt er ohne Zeile (siehe Kommentar oben).
    const buyer = db.getCompanyShare(c.id, userId) ?? { shares: 0, cost: 0, pending: 0, received: 0 };
    db.setCompanyShare(c.id, userId, { ...buyer, shares: buyer.shares + n, cost: buyer.cost + cost });
  }
  const cur = db.getCompany(c.id);
  db.saveCompany({ ...cur, news: pushNews(cur, now, `📈 ${n} Anteile gingen von ${nameOf(o.seller_id)} an ${nameOf(userId)} für ${cost.toLocaleString('de-DE')}`, 0) });
  return { ok: true, shares: n, price: o.price, cost, fee, seller: o.seller_id, company: { id: c.id, name: c.name } };
}

/**
 * Ausstehende Ausschüttungen abholen – alle Firmen des Servers in EINER
 * Buchung. Erst nehmen (§7), dann buchen; scheitert die Buchung, geht es zurück.
 */
async function claimDividends(guildId, userId) {
  const rows = db.pendingOf(guildId, userId);
  const amount = rows.reduce((s, r) => s + r.pending, 0);
  if (amount <= 0) return { ok: true, amount: 0, parts: [] };
  db.clearPending(guildId, userId);
  try {
    const balance = await changeCash(guildId, userId, amount, 'Ausschüttung Firmenanteile', { xp: false, tax: false, kind: 'company' });
    return { ok: true, amount, parts: rows.map((r) => ({ company: r.name, companyId: r.company_id, amount: r.pending })), balance };
  } catch (err) {
    for (const r of rows) {
      const h = db.getCompanyShare(r.company_id, userId);
      if (h) db.setCompanyShare(r.company_id, userId, { ...h, pending: h.pending + r.pending, received: h.received - r.pending });
    }
    return { ok: false, reason: 'payment', error: err.message };
  }
}

// ------------------------------------------------------------------ Anzeige

/** Alles, was die Firmenansicht wissen muss – nach Abrechnung. */
function status(guildId, userId, now = Date.now(), companyId = null) {
  const ctx = fresh(guildId, userId, now, Math.random, companyId);
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
  const npcs = staff.filter((s) => s.kind === 'npc');
  const wareNow = wareOf(guildId, b);
  const forecastOhneWare = npcs.reduce((sum, s) => {
    const f = rankOf(s.rank).factor;
    const umsatzTeil = closedNow ? 0 : Math.round(b.umsatz * f * c.auslastung * eff.umsatzFactor * fUmsatz);
    return sum + data.NPC_SHIFTS * (umsatzTeil - Math.round(b.lohn * f * fLohn));
  }, 0);
  // Ware der heutigen NPC-Schichten: was im Lager liegt, ist schon bezahlt (kostet heute
  // nichts); jede fehlende Einheit kommt ad hoc von der Kasse. Geschlossen: keine Schicht.
  const npcShifts = closedNow ? 0 : npcs.length * data.NPC_SHIFTS;
  const wareHeute = Math.max(0, npcShifts - (c.stock ?? 0)) * wareNow.adhoc;
  const forecast = forecastOhneWare - wareHeute;
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
    news: newsOf(c),
    closedMs: Math.max(0, (c.closed_until ?? 0) - now),
    groesse: groesse(c, extraIds), invested: investedOf(b, c, extraIds),
    umsatzBoost: c.umsatz_boost_until >= now ? { factor: c.umsatz_boost, until: c.umsatz_boost_until } : null,
    wageFactor: c.wage_factor_until >= now ? { factor: c.wage_factor, until: c.wage_factor_until } : null,
    // Offener Vorfall (spät gebunden, nur diese Domäne – decisions kennt alle drei).
    incident: (() => { const p = require('./decisions').pending(guildId, userId, now); return p?.platform === 'company' ? p : null; })(),
    // Waren (Stück 3a): Tagespreis, Lager, Einstand und Reichweite bei Vollbetrieb.
    ware: (() => {
      const w = wareNow;
      const perDay = eff.slots * data.NPC_SHIFTS + data.MAX_PITCH_PER_DAY;
      const stock = c.stock ?? 0;
      return {
        ...w, stock, capacity: capacityOf(b, eff),
        avgPaid: stock > 0 ? Math.round((c.stock_cost ?? 0) / stock) : 0,
        value: c.stock_cost ?? 0, perDay,
        daysLeft: Math.round((stock / perDay) * 10) / 10,
      };
    })(),
    // Handel (Stück 3b): der Spediteur sieht Tageskapazität, Lebenswerte und seine
    // Angebote; jede Firma sieht, wer ihr ihre Ware billiger als der NPC liefert.
    handel: isTrader(b)
      ? { ...tradeCapacity(c, b, now), units: c.trade_units ?? 0, profit: c.trade_profit ?? 0, offers: offersOf(guildId, c.id) }
      : null,
    angebote: offersFor(guildId, b.id, now, c.id),
    // Anteile (Stück 3c): Verteilung (Inhaber und Halter).
    anteile: sharesOf(c.id),
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

/** Die nächste Stufe der Leiter kaufen. Stufe zuerst (§7), dann buchen; bei Fehler zurück. */
async function upgrade(guildId, userId, now = Date.now(), companyId = null) {
  const ctx = fresh(guildId, userId, now, Math.random, companyId);
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
async function buyExtra(guildId, userId, extraId, now = Date.now(), companyId = null) {
  const ctx = fresh(guildId, userId, now, Math.random, companyId);
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
  maxCompanies, companiesOf, activeCompanyId, setActive,
  ceilingOf, effectiveOf, nextStufe, fullCeilingOf, cleanName, found, hireNpc, fire,
  wareUnit, wareOf, capacityOf, starterOf, consumeOne, buyStock,
  tradeQuote, isTrader, tradeCapacity, offersOf, setOffer, offersFor, buyFromTrader,
  dailyTarget, closeCompany, lastClosed, settle,
  asJob, openings, join, leave, workShift,
  advertise, pitchIn, withdraw, deposit, promote, bonus, close, sell, status, fresh,
  upgrade, buyExtra,
  splitPayout, sharesOf, listShares, cancelShareOffer, shareOffers, buyShares, claimDividends,
  groesse, riskPerDay, riskFor, severityFor, investedOf, applyEffect, pushNews, newsOf, rollLightEvent, NEWS_MAX,
};
