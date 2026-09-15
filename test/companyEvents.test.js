/**
 * Firmen Stück 2b: Kataloge, Wirkungen, Abrechnung mit Ereignissen, Vorfälle.
 * Aufruf: DATA_DIR=.testdata node test/companyEvents.test.js
 */
const unb = require('../src/unb');
const konten = new Map();
let bookings = [];
unb.getBalance = async (g, u) => ({ cash: konten.get(u) ?? 0, bank: 0, total: konten.get(u) ?? 0 });
unb.changeCash = async (g, u, amount, reason, opts = {}) => {
  konten.set(u, (konten.get(u) ?? 0) + amount);
  bookings.push({ user: u, amount, reason, opts });
  return { cash: konten.get(u), bank: 0, total: konten.get(u) };
};
unb.withdrawFromBank = async (g, u, amount) => ({ cash: konten.get(u) ?? 0, bank: 0, total: konten.get(u) ?? 0 });

const data = require('../src/data/companies');
const events = require('../src/data/companyEvents');
const { COMPANY_DECISIONS } = require('../src/data/companyDecisions');
const { DECISIONS } = require('../src/data/decisions');
const { MUSIC_DECISIONS } = require('../src/data/musicDecisions');

let pass = 0, fail = 0;
const check = (label, ok, extra = '') => {
  if (ok) { pass++; console.log(`  ✅ ${label}`); }
  else { fail++; console.log(`  ❌ ${label} ${extra}`); }
};
const near = (a, b, eps = 1e-9) => Math.abs(a - b) < eps;
const DAY_MS = 24 * 60 * 60 * 1000;

/** Grenzen der Wirkungstabelle aus der Spec. */
const GRENZEN = {
  umsatz: [0.4, data.EVENT_UMSATZ_MAX], days: [1, 7], auslastung: [-0.2, 0.2], kasse: [-3, 0],
  refund: [0, 1.5], wages: [0, 1.5], quit: [0, 2], lock: [0, 5], werbung: [-3, 3], staffRank: [-1, 1],
};
const FELDER = new Set([...Object.keys(GRENZEN), 'sell']);
function wirkungOk(e, label) {
  for (const [k, v] of Object.entries(e)) {
    if (['id', 'weight', 'text', 'klassen', 'flavor'].includes(k)) continue;
    if (!FELDER.has(k)) { check(`${label}: unbekanntes Feld ${k}`, false); return; }
    if (k === 'sell') continue;
    const [lo, hi] = GRENZEN[k];
    check(`${label}: ${k}=${v} in [${lo}, ${hi}]`, typeof v === 'number' && v >= lo && v <= hi);
  }
  if (e.refund && !(e.kasse < 0)) check(`${label}: refund nur mit kasse-Abzug`, false);
}

(async () => {
  console.log('--- Leichte Ereignisse: Katalog ---');
  {
    check('EVENT_UMSATZ_MAX ist 1,15', data.EVENT_UMSATZ_MAX === 1.15);
    const list = events.COMPANY_EVENTS;
    check('none zuerst mit Gewicht 140', list[0].id === 'none' && list[0].weight === 140 && list[0].text === null);
    check('zwölf Ereignisse je Gewicht 5', list.length === 13 && list.slice(1).every((e) => e.weight === 5));
    check('IDs eindeutig', new Set(list.map((e) => e.id)).size === list.length);
    for (const e of list.slice(1)) {
      check(`${e.id}: Text mit Emoji vorn`, typeof e.text === 'string' && e.text.length > 10);
      check(`${e.id}: kein lock (nur Vorfälle sperren)`, e.lock === undefined);
      wirkungOk(e, e.id);
    }
    const gut = list.slice(1).filter((e) => (e.umsatz ?? 1) > 1 || (e.auslastung ?? 0) > 0 || (e.wages ?? 1) < 1
      || (e.werbung ?? 0) > 0 || (e.staffRank ?? 0) > 0);
    check('sechs gute, sechs schlechte', gut.length === 6, String(gut.length));
    const mittel = events.candidates('mittel');
    const klein = events.candidates('klein');
    check('mittel sieht alle 13 Kandidaten', mittel.length === 13);
    check('klein sieht 10 (ohne grossauftrag, talent, abwanderung)', klein.length === 10
      && !klein.some((c) => ['grossauftrag', 'talent', 'abwanderung'].includes(c.event.id)));
    const sum = (l) => l.reduce((s, c) => s + c.weight, 0);
    check('Ereignisquote mittel 30 %', near(1 - 140 / sum(mittel), 0.3));
    check('Ereignisquote klein ≈ 24 %', near(1 - 140 / sum(klein), 45 / 185));
    check('NO_EVENT ist none', events.NO_EVENT === list[0]);
  }

  console.log('--- Vorfälle: Katalog ---');
  {
    check('sechs Vorfälle', COMPANY_DECISIONS.length === 6);
    const ids = [...DECISIONS, ...MUSIC_DECISIONS, ...COMPANY_DECISIONS].map((d) => d.id);
    check('IDs eindeutig über alle drei Kataloge', new Set(ids).size === ids.length);
    for (const d of COMPANY_DECISIONS) {
      check(`${d.id}: Kopf vollständig`, d.emoji && d.title && typeof d.minGroesse === 'number' && d.text);
      check(`${d.id}: 2–3 Optionen`, d.options.length >= 2 && d.options.length <= 3);
      check(`${d.id}: expire mit Text`, d.expire && typeof d.expire.text === 'string');
      wirkungOk(d.expire, `${d.id}/expire`);
      for (const o of d.options) {
        check(`${d.id}/${o.id}: 1–3 Ausgänge mit Gewicht > 0 und Text`,
          o.outcomes.length >= 1 && o.outcomes.length <= 3 && o.outcomes.every((x) => x.weight > 0 && x.text));
        for (const x of o.outcomes) wirkungOk(x, `${d.id}/${o.id}`);
      }
    }
    const u = COMPANY_DECISIONS.find((d) => d.id === 'uebernahme');
    check('nur die Übernahme verkauft', COMPANY_DECISIONS.every((d) => d.options.every((o) => o.outcomes.every((x) =>
      !x.sell || d.id === 'uebernahme'))) && u.options.some((o) => o.outcomes.some((x) => x.sell === true)));
    const s = COMPANY_DECISIONS.find((d) => d.id === 'streik');
    check('Streik braucht Größe 3 und 3 NPCs', s.minGroesse === 3 && s.minNpc === 3);
    const w = COMPANY_DECISIONS.find((d) => d.id === 'wasserschaden').options.find((o) => o.id === 'versicherung');
    check('Versicherung: Abzug in jedem Ausgang, Rückerstattung nur in einem',
      w.outcomes.every((x) => x.kasse === -1.5 && x.lock === 2) && w.outcomes.filter((x) => x.refund === 1).length === 1);
  }

  console.log('--- Abrechnung mit Ereignissen (Kiosk Stufe 1, Decke 2.850) ---');
  {
    const db = require('../src/db');
    const company = require('../src/company');
    const G = `FEV_T${Date.now()}`;
    const U = 'u1';
    konten.set(U, 1_000_000);
    const t0 = new Date(new Date().setHours(6, 0, 0, 0)).getTime() + DAY_MS;
    const seq = (...v) => { let i = 0; return () => (i < v.length ? v[i++] : 0.5); };
    // Würfel: erster Aufruf wählt das leichte Ereignis (Anteil an der Gewichtssumme),
    // zweiter den Vorfall (0,99 = keiner). candidates('klein') hat 185 Gewicht:
    // none 0…140, dann die neun Einträge je 5 in Katalogreihenfolge.
    const pos = (id) => {
      let acc = 0;
      for (const c of events.candidates('klein')) { if (c.event.id === id) return (acc + 2.5) / 185; acc += c.weight; }
      throw new Error(id);
    };
    const wurf = (id) => seq(pos(id), 0.99);

    let r = await company.found(G, U, 'kiosk', 'Eckladen', t0);
    check('Kiosk gegründet', r.ok, JSON.stringify(r));
    const cid = r.company.id;
    company.hireNpc(G, U, t0, seq(0.1)); company.hireNpc(G, U, t0, seq(0.2));
    for (const s of db.companyStaff(cid)) db.saveStaff({ ...s, rank: 2 });    // Schichtleiter
    await company.deposit(G, U, 100_000, t0);
    const b = company.branch('kiosk');
    const decke = company.ceilingOf(b).net;
    check('Decke Kiosk 2.850', decke === 2_850);
    check('groesse 0, riskPerDay 2 %, severity 1', company.groesse(db.getCompany(cid), []) === 0
      && near(company.riskPerDay(0), 0.02) && company.severityFor(0) === 1);
    check('groesse 9: riskPerDay 8 %, severity 1,6, riskFor(9, 30) = 1 − 0,92^30',
      near(company.riskPerDay(9), 0.08) && near(company.severityFor(9), 1.6) && near(company.riskFor(9, 30), 1 - 0.92 ** 30));

    // Referenztag ohne Ereignis: 2 NPC × 3 Schichten × (250 × 1,5 × a − 100 × 1,5).
    const a0 = db.getCompany(cid).auslastung;
    const ziel = company.dailyTarget(b, 2, false, 2);           // 0,3 + 0,5 = 0,8
    const a1 = a0 + (ziel - a0) * 0.2;                           // 0,4
    const tagesUmsatz = (a) => 2 * 3 * Math.round(250 * 1.5 * a);
    const tagesLohn = 2 * 3 * 150;
    let vor = db.getCompany(cid).kasse;
    let s = company.settle(cid, t0 + DAY_MS, wurf('none'));
    check('ohne Ereignis: Kasse + Umsatz − Löhne, keine Chronik',
      db.getCompany(cid).kasse - vor === tagesUmsatz(a1) - tagesLohn && s.news.length === 0,
      `${db.getCompany(cid).kasse - vor} vs ${tagesUmsatz(a1) - tagesLohn}`);

    // kuehlung: −0,5 × Decke = −1.425, nicht verstärkt.
    let a = db.getCompany(cid).auslastung; a = a + (ziel - a) * 0.2;
    vor = db.getCompany(cid).kasse;
    s = company.settle(cid, t0 + 2 * DAY_MS, wurf('kuehlung'));
    check('kuehlung: −1.425 zusätzlich, Chronik-Zeile',
      db.getCompany(cid).kasse - vor === tagesUmsatz(a) - tagesLohn - 1_425 && s.news.length === 1 && s.news[0].text.startsWith('🧊'),
      `${db.getCompany(cid).kasse - vor} vs ${tagesUmsatz(a) - tagesLohn - 1_425}`);
    check('Chronik in der Firma gespeichert', JSON.parse(db.getCompany(cid).news).length === 1);

    // lieferant: Umsatz × 0,7 an diesem Tag, morgen wieder 1,0.
    a = db.getCompany(cid).auslastung; a = a + (ziel - a) * 0.2;
    vor = db.getCompany(cid).kasse;
    company.settle(cid, t0 + 3 * DAY_MS, wurf('lieferant'));
    check('lieferant: Umsatz × 0,7', db.getCompany(cid).kasse - vor === 2 * 3 * Math.round(250 * 1.5 * a * 0.7) - tagesLohn,
      `${db.getCompany(cid).kasse - vor}`);
    a = db.getCompany(cid).auslastung; a = a + (ziel - a) * 0.2;
    vor = db.getCompany(cid).kasse;
    company.settle(cid, t0 + 4 * DAY_MS, wurf('none'));
    check('… am nächsten Tag wieder 1,0', db.getCompany(cid).kasse - vor === tagesUmsatz(a) - tagesLohn);

    // guter_tag: Löhne halbiert.
    a = db.getCompany(cid).auslastung; a = a + (ziel - a) * 0.2;
    vor = db.getCompany(cid).kasse;
    company.settle(cid, t0 + 5 * DAY_MS, wurf('guter_tag'));
    check('guter_tag: Löhne × 0,5', db.getCompany(cid).kasse - vor === tagesUmsatz(a) - 2 * 3 * Math.round(150 * 0.5));

    // lokalpresse / bewertung: Auslastung ±0,1 (nach der Tagesbewegung, gedeckelt).
    a = db.getCompany(cid).auslastung; a = a + (ziel - a) * 0.2;
    company.settle(cid, t0 + 6 * DAY_MS, wurf('lokalpresse'));
    check('lokalpresse: +0,1 Auslastung', near(db.getCompany(cid).auslastung, a + 0.1, 1e-9));
    a = db.getCompany(cid).auslastung; a = a + (ziel - a) * 0.2;
    company.settle(cid, t0 + 7 * DAY_MS, wurf('bewertung'));
    check('bewertung: −0,1 Auslastung', near(db.getCompany(cid).auslastung, a - 0.1, 1e-9));

    // empfehlung: ein Werbetag.
    company.settle(cid, t0 + 8 * DAY_MS, wurf('empfehlung'));
    check('empfehlung: werbung_until = Tag + 1', db.getCompany(cid).werbung_until === t0 + 9 * DAY_MS, String(db.getCompany(cid).werbung_until - t0));

    // Ein Boost stapelt nicht: stammkunde (1,10) auf laufenden Boost 1,15 → max, nicht Produkt.
    const c0 = db.getCompany(cid);
    db.saveCompany({ ...c0, umsatz_boost: 1.15, umsatz_boost_until: t0 + 12 * DAY_MS });
    company.settle(cid, t0 + 9 * DAY_MS, wurf('stammkunde'));
    check('Boosts stapeln nicht (max 1,15, längeres until bleibt)',
      db.getCompany(cid).umsatz_boost === 1.15 && db.getCompany(cid).umsatz_boost_until === t0 + 12 * DAY_MS);
    // Ein Malus ersetzt den Boost.
    company.settle(cid, t0 + 10 * DAY_MS, wurf('krank'));
    check('krank ersetzt den laufenden Boost (0,8 für heute)',
      db.getCompany(cid).umsatz_boost === 0.8 && db.getCompany(cid).umsatz_boost_until === t0 + 10 * DAY_MS);

    // Sperre (nur aus Vorfällen): applyEffect direkt, dann drei Abrechnungstage ohne Umsatz.
    const now = t0 + 11 * DAY_MS;
    company.settle(cid, now, wurf('none'));
    const c1 = db.getCompany(cid);
    const staff1 = db.companyStaff(cid);
    const eff = company.applyEffect(c1, staff1, { lock: 3 }, { b, extraIds: [], at: now, haerte: 1 });
    db.saveCompany(eff.company);
    check('lock 3: closed_until = now + 3 Tage', eff.company.closed_until === now + 3 * DAY_MS && eff.done.lock === 3);
    r = await company.pitchIn(G, U, now + 60_000);
    check('Anpacken gesperrt: locked mit remainingMs', r.ok === false && r.reason === 'locked' && r.remainingMs > 0, JSON.stringify(r));
    r = await company.advertise(G, U, now + 60_000);
    check('Werbung gesperrt', r.ok === false && r.reason === 'locked');
    vor = db.getCompany(cid).kasse;
    s = company.settle(cid, now + 3 * DAY_MS, () => 0.5);
    check('drei geschlossene Tage: nur Löhne', s.days === 3 && s.umsatz === 0 && db.getCompany(cid).kasse - vor === -3 * tagesLohn,
      `${db.getCompany(cid).kasse - vor}`);
    vor = db.getCompany(cid).kasse;
    s = company.settle(cid, now + 4 * DAY_MS, () => 0.5);
    check('vierter Tag: wieder Umsatz', s.umsatz > 0 && db.getCompany(cid).kasse - vor > -tagesLohn);
    r = await company.pitchIn(G, U, now + 4 * DAY_MS);
    check('Anpacken geht wieder', r.ok, JSON.stringify(r));

    // Härte: kasse −1 bei groesse 9 und Schweigen = −1 × 1,6 × 1,6 × Decke.
    const c2 = db.getCompany(cid);
    const e2 = company.applyEffect(c2, db.companyStaff(cid), { kasse: -1, refund: 1 }, { b, extraIds: [], at: now, haerte: 1.6 * 1.6 });
    check('kasse −1 mit Härte 2,56: −7.296, refund 1 = +2.850 (nie mehr als der Abzug)',
      e2.done.kasse === -Math.round(2.56 * decke) && e2.done.refund === decke && e2.company.kasse === c2.kasse - Math.round(2.56 * decke) + decke,
      JSON.stringify(e2.done));
    const e3 = company.applyEffect(c2, db.companyStaff(cid), { kasse: -0.3, refund: 1 }, { b, extraIds: [], at: now, haerte: 1 });
    check('refund gedeckelt auf den Abzug', e3.done.refund === Math.round(0.3 * decke));

    // quit: dienstältester zuerst; staffRank ±1 gedeckelt.
    const staffQ = db.companyStaff(cid);
    db.saveStaff({ ...staffQ[0], shifts: 99 });
    const e4 = company.applyEffect(db.getCompany(cid), db.companyStaff(cid), { quit: 1 }, { b, extraIds: [], at: now, haerte: 1 });
    check('quit 1: der mit den meisten Schichten geht', e4.quit.length === 1 && e4.quit[0].id === staffQ[0].id && e4.staff.length === 1
      && e4.done.quit[0] === staffQ[0].name);
    // applyEffect ist rein – die Zeilen löscht der Aufrufer (wie settle). Sonst bleibt
    // der Kiosk mit 2 NPCs auf 2 Plätzen voll, und der Spieler unten käme nicht rein.
    for (const q of e4.quit) db.deleteStaff(q.id);
    const e5 = company.applyEffect(db.getCompany(cid), db.companyStaff(cid), { staffRank: 1 }, { b, extraIds: [], at: now, haerte: 1, random: () => 0 });
    check('staffRank +1 auf Schichtleiter bleibt Schichtleiter (gedeckelt)', e5.done.staffRank === null || e5.staff.every((x) => x.rank <= 2));

    // investedOf
    check('investedOf ohne Ausbau = 0', company.investedOf(b, db.getCompany(cid), []) === 0);
    check('investedOf Stufe 2 + ein Extra', company.investedOf(b, { ...db.getCompany(cid), stufe: 2 }, [b.extras[0].id])
      === b.stufen[0].price + b.stufen[1].price + b.extras[0].price);

    // jobs.work reicht locked durch.
    const jobs = require('../src/jobs');
    const P = 'p1';
    const c3 = db.getCompany(cid);
    db.saveCompany({ ...c3, closed_until: now + 10 * DAY_MS });
    const j = await company.join(G, P, cid, now + 5 * DAY_MS);
    check('Spieler eingestellt', j.ok, JSON.stringify(j));
    const w = await jobs.work(G, P, new Date(now + 5 * DAY_MS));
    check('Schicht in geschlossener Firma: locked mit remainingMs', w.ok === false && w.reason === 'locked' && w.remainingMs > 0, JSON.stringify(w));
    db.saveCompany({ ...db.getCompany(cid), closed_until: 0 });

    const st = company.status(G, U, now + 5 * DAY_MS);
    check('status: news, closedMs 0, groesse, invested', Array.isArray(st.news) && st.closedMs === 0 && st.groesse === 0 && st.invested === 0);
    await company.close(G, U, now + 5 * DAY_MS);
  }

  console.log(`\n${pass} bestanden, ${fail} fehlgeschlagen`);
  process.exit(fail === 0 ? 0 : 1);
})();
