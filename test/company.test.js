/**
 * Tests für die Firmen (Stück 1: der Kern).
 *
 * Geprüft wird vor allem, was §3 verlangt: Die Decke einer Firma ist eine
 * vorgerechnete Zahl, NPC-Löhne sind eine echte Senke, und jede Aktion bucht
 * höchstens einmal (§9). Dazu die Regeln aus dem Gespräch: Löhne sind
 * Verbindlichkeiten (die Kasse darf ins Minus), 14 Tage Minus = Insolvenz,
 * der Inhaber befördert selbst.
 *
 * Aufruf: DATA_DIR=.testdata node test/company.test.js
 */
const db = require('../src/db');
const company = require('../src/company');
const data = require('../src/data/companies');
const unb = require('../src/unb');

let pass = 0, fail = 0;
const check = (label, ok, extra = '') => {
  if (ok) { pass++; console.log(`  ✅ ${label}`); }
  else { fail++; console.log(`  ❌ ${label} ${extra}`); }
};

const G = `FIRMA_T${Date.now()}`;
const DAY_MS = 24 * 60 * 60 * 1000;
const de = (n) => Math.round(n).toLocaleString('de-DE');

// Gefälschte Bank: jedes Konto startet mit `funds`, jede Buchung wird gezählt.
const konten = new Map();
let bookings = [];
const funds = (u, cash = 0, bank = 0) => konten.set(u, { cash, bank });
unb.getBalance = async (g, u) => {
  const k = konten.get(u) ?? { cash: 0, bank: 0 };
  return { cash: k.cash, bank: k.bank, total: k.cash + k.bank };
};
unb.changeCash = async (g, u, amount, reason, opts = {}) => {
  const k = konten.get(u) ?? { cash: 0, bank: 0 };
  k.cash += amount; konten.set(u, k);
  bookings.push({ user: u, amount, reason, opts });
  return { cash: k.cash, bank: k.bank, total: k.cash + k.bank };
};
unb.withdrawFromBank = async (g, u, amount) => {
  const k = konten.get(u) ?? { cash: 0, bank: 0 };
  k.cash += amount; k.bank -= amount; konten.set(u, k);
  return { cash: k.cash, bank: k.bank, total: k.cash + k.bank };
};

/** Fester Würfel: liefert nacheinander die Werte, danach 0,5. */
const seq = (...v) => { let i = 0; return () => (i < v.length ? v[i++] : 0.5); };
const t0 = new Date(new Date().setHours(6, 0, 0, 0)).getTime() + DAY_MS;
let n = 0;
const user = () => `u${++n}`;

(async () => {
  console.log('--- Der Katalog ---');
  {
    check('neun Branchen', data.BRANCHES.length === 9, String(data.BRANCHES.length));
    check('IDs eindeutig', new Set(data.BRANCHES.map((b) => b.id)).size === 9);
    check('drei je Klasse', ['klein', 'mittel', 'gross'].every((k) =>
      data.BRANCHES.filter((b) => b.klasse === k).length === 3));
    check('jede Branche vollständig', data.BRANCHES.every((b) =>
      b.id && b.name && b.emoji && b.price > 0 && b.slots > 0 && b.umsatz > b.lohn && b.blurb));
    const byId = Object.fromEntries(data.BRANCHES.map((b) => [b.id, b]));
    const [k, c, s] = [byId.kiosk, byId.cafe, byId.spedition];
    check('Kiosk < Café < Spedition beim Preis', k.price < c.price && c.price < s.price);
    check('… und bei der Decke',
      company.ceilingOf(k).net < company.ceilingOf(c).net && company.ceilingOf(c).net < company.ceilingOf(s).net,
      data.BRANCHES.map((b) => `${b.id}=${de(company.ceilingOf(b).net)}`).join(' '));
    // Handrechnung Spedition: 10 × 3 × 1.900 × 1,5 = 85.500 + 4 × 2.850 = 96.900 brutto,
    // Löhne 10 × 3 × 630 = 18.900 → 78.000 netto.
    check('Decke der Spedition ist die Handrechnung (78.000)',
      company.ceilingOf(s).net === 78_000, de(company.ceilingOf(s).net));
    check('drei Ränge mit Faktoren 1 / 1,25 / 1,5',
      data.RANKS.map((r) => r.factor).join() === '1,1.25,1.5');
    check('genug NPC-Namen', data.NPC_NAMES.length >= 30);
  }

  console.log('--- Gründen ---');
  {
    const U = user();
    funds(U, 10_000, 200_000);
    bookings = [];
    let r = await company.found(G, U, 'cafe', 'Kaffeeklatsch', t0);
    check('Gründung klappt', r.ok === true, r.reason);
    check('Preis wurde gebucht – genau eine Buchung', bookings.length === 1 && bookings[0].amount === -120_000,
      JSON.stringify(bookings));
    check('Bank wurde angezapft (Bargeld reichte nicht)', (konten.get(U).cash) === 10_000 + 110_000 - 120_000);
    check('Kasse startet bei 0, Auslastung bei 0,3',
      r.company.kasse === 0 && Math.abs(r.company.auslastung - data.AUSLASTUNG_MIN) < 1e-9);
    check('ownCompany findet sie', company.ownCompany(G, U)?.name === 'Kaffeeklatsch');

    r = await company.found(G, U, 'kiosk', 'Zweite', t0);
    check('zweite Firma abgelehnt', r.ok === false && r.reason === 'already');
    const V = user(); funds(V, 1_000);
    r = await company.found(G, V, 'kiosk', 'Arm', t0);
    check('zu wenig Geld abgelehnt', r.ok === false && r.reason === 'funds' && company.ownCompany(G, V) === null);
    r = await company.found(G, V, 'kiosk', 'x', t0);
    check('Name zu kurz', r.reason === 'name');
    r = await company.found(G, V, 'kiosk', '@everyone', t0);
    check('Name mit @ abgelehnt', r.reason === 'name');
    r = await company.found(G, V, 'bank', 'Geldhaus', t0);
    check('unbekannte Branche', r.reason === 'unknown_branch');
    // Buchung schlägt fehl -> Zeile wird wieder gelöscht.
    funds(V, 50_000);
    const echt = unb.changeCash;
    unb.changeCash = async () => { throw new Error('API down'); };
    r = await company.found(G, V, 'kiosk', 'Pechvogel', t0);
    unb.changeCash = echt;
    check('fehlgeschlagene Buchung -> keine Firma', r.reason === 'payment' && company.ownCompany(G, V) === null);
  }

  console.log('--- Personal einstellen und entlassen ---');
  {
    const U = user(); funds(U, 0, 100_000);
    await company.found(G, U, 'kiosk', 'Späti', t0);
    let r = company.hireNpc(G, U, t0, seq(0));
    check('NPC eingestellt', r.ok === true && r.staff.kind === 'npc' && r.staff.name === data.NPC_NAMES[0]);
    r = company.hireNpc(G, U, t0, seq(0.999));
    check('zweiter NPC, anderer Name', r.ok && r.staff.name === data.NPC_NAMES[data.NPC_NAMES.length - 1]);
    r = company.hireNpc(G, U, t0);
    check('dritter abgelehnt: Kiosk hat 2 Plätze', r.ok === false && r.reason === 'full');
    const staff = db.companyStaff(company.ownCompany(G, U).id);
    check('zwei in der Liste, Rang 0', staff.length === 2 && staff.every((s) => s.rank === 0));
    r = company.fire(G, U, staff[0].id);
    check('entlassen schafft Platz', r.ok && db.companyStaff(company.ownCompany(G, U).id).length === 1);
    check('fremdes Personal kann man nicht entlassen', company.fire(G, user(), staff[1].id).ok === false);
    check('ohne Firma kein Einstellen', company.hireNpc(G, user(), t0).reason === 'no_company');
  }

  console.log('--- Abrechnung: Auslastung und NPC-Schichten ---');
  {
    const U = user(); funds(U, 0, 100_000);
    const f = await company.found(G, U, 'kiosk', 'Rechenkiosk', t0);
    company.hireNpc(G, U, t0, seq(0)); company.hireNpc(G, U, t0, seq(0.5));
    const b = company.branch('kiosk');
    // Handrechnung, 5 Tage, 2 Aushilfen (Faktor 1), Kiosk umsatz 250 / lohn 100:
    // Ziel = 0,3 + 0,5 × 2/2 = 0,8. Tag d: a += (0,8 − a) × 0,2, beginnend bei 0,3.
    let a = data.AUSLASTUNG_MIN, kasse = 0;
    for (let d = 0; d < 5; d++) {
      a += (0.8 - a) * data.AUSLASTUNG_STEP;
      const umsatz = Math.round(b.umsatz * a);
      kasse += 2 * data.NPC_SHIFTS * (umsatz - b.lohn);
    }
    const r = company.settle(f.company.id, t0 + 5 * DAY_MS);
    const c = db.getCompany(f.company.id);
    check('5 Tage abgerechnet', r.days === 5);
    check('Kasse = Handrechnung', c.kasse === kasse, `${de(c.kasse)} vs ${de(kasse)}`);
    check('Auslastung = Handrechnung', Math.abs(c.auslastung - a) < 1e-9, `${c.auslastung} vs ${a}`);
    check('paid_through ist vorgerückt', c.paid_through === t0 + 5 * DAY_MS);
    check('NPC-Schichten gezählt', db.companyStaff(c.id).every((s) => s.shifts === 15));
    check('nochmal abrechnen tut nichts', company.settle(c.id, t0 + 5 * DAY_MS).days === 0);
    check('kein Personal -> Ziel 0,3', Math.abs(company.dailyTarget(b, 0, false) - 0.3) < 1e-9);
    check('voll -> 0,8, mit Werbung -> 1,0',
      Math.abs(company.dailyTarget(b, 2, false) - 0.8) < 1e-9 && company.dailyTarget(b, 2, true) === 1);
    // Über 20 Tage nähert sich die Auslastung dem Ziel.
    company.settle(c.id, t0 + 25 * DAY_MS);
    check('nach 25 Tagen über 0,79', db.getCompany(c.id).auslastung > 0.79, String(db.getCompany(c.id).auslastung));
    check('älter als 30 Tage verfällt', company.settle(c.id, t0 + 100 * DAY_MS).days === data.MAX_SETTLE_DAYS);
  }

  console.log('--- Löhne sind Verbindlichkeiten: Minus, Kündigung, Insolvenz ---');
  {
    // Kiosk mit EINEM Schichtleiter (Ziel 0,3 + 0,5 × 1/2 = 0,55). Handrechnung:
    // Tag 1: a = 0,35, Umsatz round(250 × 1,5 × 0,35) = 131 < Lohn 150 → 3 × −19 = −57.
    // Tag 2: a = 0,39 → 146 → −12 (Kasse −69). Tag 3: a = 0,422 → 158 → +24 (Kasse −45),
    // immer noch im Minus → dritter unbezahlter Tag → Kündigung.
    const U = user(); funds(U, 0, 100_000);
    const f = await company.found(G, U, 'kiosk', 'Minuskiosk', t0);
    company.hireNpc(G, U, t0, seq(0));
    for (const s of db.companyStaff(f.company.id)) db.saveStaff({ ...s, rank: 2 });
    let r = company.settle(f.company.id, t0 + 1 * DAY_MS);
    let c = db.getCompany(f.company.id);
    check('Tag 1: Kasse −57 (Handrechnung)', c.kasse === -57, de(c.kasse));
    check('Minus-Uhr läuft', c.negative_since === t0 + 1 * DAY_MS);
    check('NPC gilt als unbezahlt', db.companyStaff(c.id).every((s) => s.unpaid_days === 1));
    r = company.settle(c.id, t0 + 3 * DAY_MS);
    check('nach 3 unbezahlten Tagen kündigt er', r.quit.length === 1 && db.companyStaff(c.id).length === 0,
      JSON.stringify(r.quit));
    check('Kasse −45 (Handrechnung)', db.getCompany(c.id).kasse === -45, de(db.getCompany(c.id).kasse));
    const minus = db.getCompany(c.id).kasse;
    r = company.settle(c.id, t0 + 13 * DAY_MS);
    c = db.getCompany(c.id);
    check('ohne Personal keine weiteren Löhne', c.kasse === minus, `${de(c.kasse)} vs ${de(minus)}`);
    check('Tag 13: noch offen', c.status === 'open' && r.insolvent === false);
    r = company.settle(c.id, t0 + 15 * DAY_MS);
    c = db.getCompany(c.id);
    check('Tag 15: insolvent', r.insolvent === true && c.status === 'closed' && c.closed_at > 0);
    check('ownCompany ist danach null', company.ownCompany(G, U) === null);
    check('settle auf geschlossen tut nichts', company.settle(c.id, t0 + 20 * DAY_MS) === null);
    check('lastClosed nennt die insolvente Firma',
      company.lastClosed(G, U, t0 + 15 * DAY_MS)?.closed_why === 'insolvent');
  }

  console.log('--- Arbeitsamt: bewerben, arbeiten, kündigen ---');
  {
    const jobs = require('../src/jobs');
    const chef = user(); funds(chef, 0, 500_000);
    const f = await company.found(G, chef, 'cafe', 'Bohne', t0);
    const cid = f.company.id;
    const jobId = company.companyJobId(cid);
    check('openings listet die Firma mit 5 freien Plätzen',
      company.openings(G).some((o) => o.company.id === cid && o.free === 5 && o.jobId === jobId));
    check('Inhaber kann sich nicht selbst bewerben', jobs.apply(G, chef, jobId).reason === 'owner');

    const A = user(); funds(A, 0);
    let r = jobs.apply(G, A, jobId);
    check('Spieler bewirbt sich über jobs.apply', r.ok === true && r.job.title === 'Bohne' && r.job.tier === 'firma', r.reason);
    check('employment zeigt auf die Firma', db.getEmployment(G, A)?.job_id === jobId);
    check('company_staff hat ihn', db.staffByUser(cid, A)?.kind === 'player');
    check('currentJob findet den Firmenjob', jobs.currentJob(G, A)?.job.company?.id === cid);
    check('openings zeigt 4 freie Plätze', company.openings(G).find((o) => o.company.id === cid).free === 4);

    // Schicht: Kasse leer -> abgelehnt, keine Buchung.
    bookings = [];
    r = await jobs.work(G, A, new Date(t0 + 1000));
    check('Kasse deckt den Lohn nicht -> keine Schicht', r.ok === false && r.reason === 'kasse' && bookings.length === 0, r.reason);
    // Inhaber zahlt ein (Task 4 hat deposit noch nicht) -> Kasse direkt setzen.
    db.saveCompany({ ...db.getCompany(cid), kasse: 10_000 });
    r = await jobs.work(G, A, new Date(t0 + 2000), seq(0.5));
    const b = company.branch('cafe');
    check('Schicht gearbeitet', r.ok === true, r.reason);
    // Handrechnung: Lohn 180 × 1 × (0,85 + 0,5 × 0,3) = 180; Umsatz 900 × 1 × 0,3 × 1,3 = 351.
    check('Lohn = Handrechnung (180)', r.base === 180, String(r.base));
    check('genau eine Buchung an den Spieler, kind job', bookings.length === 1 && bookings[0].user === A
      && bookings[0].amount === r.amount && bookings[0].opts.kind === 'job', JSON.stringify(bookings));
    check('Kasse: +Umsatz −Lohn (351 − 180)', db.getCompany(cid).kasse === 10_000 + 351 - 180, de(db.getCompany(cid).kasse));
    check('Level-Zuschlag belastet die Kasse nicht', r.amount >= r.base && db.getCompany(cid).kasse === 10_000 + 171);
    check('Schicht gezählt', db.staffByUser(cid, A).shifts === 1 && db.getEmployment(G, A).shifts === 1);
    check('Ergebnis nennt Firma und Umsatz', r.company?.id === cid && r.umsatz === 351 && r.promotion === null);
    r = await jobs.work(G, A, new Date(t0 + 3000));
    check('Abklingzeit 60 min gilt', r.ok === false && r.reason === 'cooldown');

    // Beförderter Spieler: Faktor 1,25 auf Lohn und Umsatz.
    const s = db.staffByUser(cid, A); db.saveStaff({ ...s, rank: 1 });
    r = await jobs.work(G, A, new Date(t0 + 2 * 3600e3), seq(0.5));
    check('Fachkraft: Lohn 225', r.ok && r.base === 225, String(r.base));

    // Wechsel zu einem Arbeitsamt-Job löst die Firmenstelle.
    const offer = jobs.dailyOffers(G, A, new Date(t0)).find((j) => jobs.checkRequirements(G, A, j).ok);
    if (offer) {
      r = jobs.apply(G, A, offer.id, new Date(t0));
      check('Wechsel ins Arbeitsamt räumt die Firmenstelle', r.ok && db.staffByUser(cid, A) === null);
    } else {
      check('(kein freies Angebot heute – Wechsel nicht prüfbar)', true);
      jobs.quit(G, A);
    }
    check('Kündigen räumt company_staff', db.staffByUser(cid, A) === null);
    jobs.apply(G, A, jobId);
    check('wieder eingestellt', db.staffByUser(cid, A) !== null);
    r = jobs.quit(G, A);
    check('quit liefert den Firmenjob', r.ok && r.job?.title === 'Bohne' && db.staffByUser(cid, A) === null);

    // Firma voll: 5 Plätze.
    for (let i = 0; i < 5; i++) company.hireNpc(G, chef, t0, seq(0.1 * i));
    check('voll -> Bewerbung abgelehnt', jobs.apply(G, user(), jobId).reason === 'full');

    // Firma geschlossen -> Spieler fliegt raus.
    const B = user();
    company.fire(G, chef, db.companyStaff(cid)[0].id);
    jobs.apply(G, B, jobId);
    company.closeCompany(G, cid, t0 + 5000);
    check('Schließen löst die Anstellung', db.getEmployment(G, B) === null);
    r = await jobs.work(G, B, new Date(t0 + 6000));
    check('… und work sagt arbeitslos', r.ok === false && r.reason === 'unemployed');
  }

  console.log('--- Inhaber-Aktionen ---');
  {
    const creator = require('../src/creator');
    const U = user(); funds(U, 50_000, 500_000);
    const f = await company.found(G, U, 'cafe', 'Chefsache', t0);
    const cid = f.company.id;
    const b = company.branch('cafe');
    for (let i = 0; i < 3; i++) company.hireNpc(G, U, t0, seq(0.1 * i));

    // Werbung braucht Deckung.
    let r = await company.advertise(G, U, t0);
    check('Werbung ohne Deckung abgelehnt', r.ok === false && r.reason === 'kasse');
    bookings = [];
    r = await company.deposit(G, U, 20_000, t0);
    check('Einzahlen: eine Buchung, Kasse steigt', r.ok && bookings.length === 1 && bookings[0].amount === -20_000
      && db.getCompany(cid).kasse === 20_000);
    check('Einzahlen ist eine Umbuchung: keine XP (sonst XP-Schleife Einzahlen → Entnehmen)',
      bookings[0].opts.xp === false && bookings[0].opts.kind === 'company', JSON.stringify(bookings[0].opts));
    check('Einzahlen über Guthaben abgelehnt', (await company.deposit(G, U, 10_000_000, t0)).reason === 'funds');
    const zeitVor = creator.budget(G, U, t0).left;
    r = await company.advertise(G, U, t0);
    check('Werbung: Kasse −6.000 (5 % von 120.000), 3 Tage', r.ok && db.getCompany(cid).kasse === 14_000
      && db.getCompany(cid).werbung_until === t0 + 3 * DAY_MS, JSON.stringify(r));
    check('Werbung kostet Zeit aus dem Creator-Budget', creator.budget(G, U, t0).left === zeitVor - data.TIME_WERBUNG);
    check('Werbung läuft schon -> abgelehnt', (await company.advertise(G, U, t0 + 1000)).reason === 'running');

    // Anpacken: Umsatz als Schichtleiter, kein Lohn.
    const a = db.getCompany(cid).auslastung;
    r = await company.pitchIn(G, U, t0);
    check('Anpacken bringt 900 × 1,5 × Auslastung', r.ok && r.umsatz === Math.round(b.umsatz * 1.5 * a)
      && db.getCompany(cid).kasse === 14_000 + r.umsatz, JSON.stringify(r));
    check('… und kostet Zeit', creator.budget(G, U, t0).left === zeitVor - data.TIME_WERBUNG - data.TIME_ANPACKEN);
    for (let i = 0; i < 3; i++) await company.pitchIn(G, U, t0);
    check('höchstens 4 je Tag (oder Zeit alle)',
      ['limit', 'no_time'].includes((await company.pitchIn(G, U, t0)).reason));

    // Rang und Prämie.
    const staff = db.companyStaff(cid);
    r = company.promote(G, U, staff[0].id, +1);
    check('befördert auf Fachkraft', r.ok && db.staffById(staff[0].id).rank === 1 && r.rank.name === 'Fachkraft');
    company.promote(G, U, staff[0].id, +1); r = company.promote(G, U, staff[0].id, +1);
    check('über Schichtleiter geht nichts', r.ok === false && db.staffById(staff[0].id).rank === 2);
    r = company.promote(G, U, staff[0].id, -1);
    check('zurückgestuft', r.ok && db.staffById(staff[0].id).rank === 1);
    check('Prämie an NPC abgelehnt', (await company.bonus(G, U, staff[0].id, 100, t0)).reason === 'not_player');
    const P = user(); funds(P, 0);
    company.join(G, P, cid, t0);
    const ps = db.staffByUser(cid, P);
    const kasseVor = db.getCompany(cid).kasse;
    bookings = [];
    r = await company.bonus(G, U, ps.id, 500, t0);
    check('Prämie: eine Buchung an den Spieler, Kasse sinkt', r.ok && bookings.length === 1 && bookings[0].user === P
      && bookings[0].amount === 500 && db.getCompany(cid).kasse === kasseVor - 500);
    check('Prämie ist keine Schicht (kind company, nicht job)', bookings[0].opts.kind === 'company',
      JSON.stringify(bookings[0].opts));
    check('Prämie über Kasse abgelehnt', (await company.bonus(G, U, ps.id, 10_000_000, t0)).reason === 'kasse');
    r = company.promote(G, U, ps.id, +1);
    check('Spieler-Beförderung spiegelt sich in employment.rank', r.ok && db.getEmployment(G, P).rank === 1);

    // Entnahme.
    bookings = [];
    const k = db.getCompany(cid).kasse;
    r = await company.withdraw(G, U, k, t0);
    check('Entnahme: eine Buchung ohne Steuer, Kasse 0', r.ok && bookings.length === 1 && bookings[0].amount === k
      && bookings[0].opts.tax === false && db.getCompany(cid).kasse === 0, JSON.stringify(bookings));
    check('Entnahme ist eine Umbuchung: keine XP', bookings[0].opts.xp === false, JSON.stringify(bookings[0].opts));
    check('Entnahme über Kasse abgelehnt', (await company.withdraw(G, U, 1, t0)).reason === 'kasse');
    check('Entnahme von 0 abgelehnt', (await company.withdraw(G, U, 0, t0)).reason === 'amount');

    // Fehlgeschlagene Auszahlungen: Kasse geht zurück statt verloren zu gehen.
    db.saveCompany({ ...db.getCompany(cid), kasse: 3_000 });
    const echtChangeCash = unb.changeCash;
    unb.changeCash = async () => { throw new Error('API down'); };
    let kasseVorFehler = db.getCompany(cid).kasse;
    r = await company.withdraw(G, U, 1_000, t0);
    check('Entnahme mit fehlgeschlagener Buchung -> payment, Kasse unverändert',
      r.ok === false && r.reason === 'payment' && db.getCompany(cid).kasse === kasseVorFehler, JSON.stringify(r));

    kasseVorFehler = db.getCompany(cid).kasse;
    r = await company.bonus(G, U, ps.id, 500, t0);
    check('Prämie mit fehlgeschlagener Buchung -> payment, Kasse unverändert',
      r.ok === false && r.reason === 'payment' && db.getCompany(cid).kasse === kasseVorFehler, JSON.stringify(r));
    unb.changeCash = echtChangeCash;

    const rangVorFehler = db.staffById(ps.id).rank;
    r = company.promote(G, U, ps.id, NaN);
    check('Beförderung mit NaN -> delta, Rang unverändert',
      r.ok === false && r.reason === 'delta' && db.staffById(ps.id).rank === rangVorFehler, JSON.stringify(r));

    // Einzahlen rettet vor der Insolvenz.
    db.saveCompany({ ...db.getCompany(cid), kasse: -5_000, negative_since: t0 - 13 * DAY_MS });
    r = await company.deposit(G, U, 6_000, t0);
    check('Einzahlung setzt die Minus-Uhr zurück', r.ok && db.getCompany(cid).negative_since === 0);

    // Status.
    const s = company.status(G, U, t0);
    check('status: Kasse, Auslastung, Personal, Decke, Tagesprognose',
      s.company.id === cid && s.staff.length === 4 && s.free === 1 && s.ceiling.net > 0 && typeof s.forecast === 'number'
      && s.budget.max === 24, JSON.stringify({ free: s.free, forecast: s.forecast }));

    // Schließen: Kasse wird entnommen, Personal weg.
    db.saveCompany({ ...db.getCompany(cid), kasse: 700 });
    bookings = [];
    r = await company.close(G, U, t0);
    check('Schließen entnimmt die Kasse (eine Buchung) und räumt auf',
      r.ok && bookings.length === 1 && bookings[0].amount === 700 && company.ownCompany(G, U) === null
      && db.getEmployment(G, P) === null && db.companyStaff(cid).length === 0);
    check('Auszahlung bei Auflösung: keine XP, keine Steuer', bookings[0].opts.xp === false && bookings[0].opts.tax === false);
    check('ohne Firma: status null', company.status(G, U, t0) === null);
  }

  console.log('--- Ansicht: Ziel, morgen, nächste Abrechnung ---');
  {
    // Handrechnung Kiosk (Stufe 1, 2 Plätze): 2 NPCs + Werbung -> Ziel 0,3 + 0,5 + 0,25,
    // gedeckelt auf 1,0; morgen 0,3 + (1,0 − 0,3) × 0,2 = 0,44; eine Stunde nach
    // der Gründung sind es noch 23 h bis zur ersten Abrechnung.
    const U = user(); funds(U, 1_000_000);
    const H = 60 * 60 * 1000;
    let r = await company.found(G, U, 'kiosk', 'Eckladen', t0);
    check('Kiosk gegründet', r.ok, JSON.stringify(r));
    for (let i = 0; i < 2; i++) check('NPC eingestellt', company.hireNpc(G, U, t0, seq(0.1)).ok);
    check('dritter NPC: voll', company.hireNpc(G, U, t0, seq(0.1)).reason === 'full');
    await company.deposit(G, U, 50_000, t0);
    r = await company.advertise(G, U, t0);
    check('Werbung gebucht', r.ok, JSON.stringify(r));

    let s = company.status(G, U, t0 + H);
    check('frisch: Auslastung 30 %, Ziel 100 %, morgen 44 %, Abrechnung in 23 h',
      Math.abs(s.auslastung - 0.3) < 1e-9 && s.target === 1 && Math.abs(s.auslastungTomorrow - 0.44) < 1e-9
      && s.nextSettleMs === 23 * H,
      JSON.stringify({ a: s.auslastung, target: s.target, morgen: s.auslastungTomorrow, ms: s.nextSettleMs / H }));

    // Nach dem ersten Tick steht die Auslastung genau auf dem angekündigten Wert.
    s = company.status(G, U, t0 + DAY_MS + H);
    check('Tag 1: Auslastung 44 % wie angekündigt, morgen ~55 %',
      Math.abs(s.auslastung - 0.44) < 1e-9 && Math.abs(s.auslastungTomorrow - 0.552) < 1e-9 && s.nextSettleMs === 23 * H,
      JSON.stringify({ a: s.auslastung, morgen: s.auslastungTomorrow, ms: s.nextSettleMs / H }));

    // Werbung läuft 3 Tage: Tag 3 zählt sie noch (>=), Tag 4 nicht mehr -> Ziel 0,8.
    s = company.status(G, U, t0 + 3 * DAY_MS + H);
    check('Tag 3: Werbung abgelaufen, nächstes Ziel 80 %', s.target === 0.8 && s.werbungMs === 0,
      JSON.stringify({ target: s.target, werbungMs: s.werbungMs }));

    // Ein Angestellter weniger -> Ziel 0,3 + 0,5 × 1/2 = 0,55.
    const npc = db.companyStaff(s.company.id)[0];
    company.fire(G, U, npc.id, t0 + 3 * DAY_MS + H);
    s = company.status(G, U, t0 + 3 * DAY_MS + H);
    check('mit 1 von 2 Plätzen: Ziel 55 %', Math.abs(s.target - 0.55) < 1e-9, String(s.target));
    await company.close(G, U, t0 + 3 * DAY_MS + H);
  }

  console.log('--- §3: kein Tag über der Decke ---');
  {
    for (const b of data.BRANCHES) {
      const U = user(); funds(U, 0, 50_000_000);
      const f = await company.found(G, U, b.id, `Voll-${b.id}`, t0);
      for (let i = 0; i < b.slots; i++) company.hireNpc(G, U, t0, seq(0.02 * i));
      for (const s of db.companyStaff(f.company.id)) db.saveStaff({ ...s, rank: 2 });
      const decke = company.ceilingOf(b).net;
      let best = -Infinity, gewinn = [];
      let now = t0, werbungLief = false;
      for (let d = 0; d < 365; d++) {
        const vor = db.getCompany(f.company.id).kasse;
        const w = await company.advertise(G, U, now);
        // Bis zur ersten Kampagne füllt sich die Kasse erst (Auslastung startet bei 0,3 –
        // Tag 0–2 reicht sie nicht); jede spätere Absage wäre ein Fehler, der laut sein soll.
        if (w.ok) werbungLief = true;
        if (!(w.ok || w.reason === 'running' || (w.reason === 'kasse' && !werbungLief))) {
          throw new Error(`${b.id}: Werbung an Tag ${d} abgelehnt: ${w.reason}`);
        }
        for (let i = 0; i < data.MAX_PITCH_PER_DAY; i++) await company.pitchIn(G, U, now + i * 60e3);
        company.settle(f.company.id, now + DAY_MS);
        const tag = db.getCompany(f.company.id).kasse - vor;
        best = Math.max(best, tag); gewinn.push(tag);
        now += DAY_MS;
      }
      const sorted = [...gewinn].sort((a, c) => a - c);
      const median = sorted[Math.floor(sorted.length / 2)];
      console.log(`    ${b.emoji} ${b.name}: Median ${de(median)}/Tag · bester Tag ${de(best)} · Decke ${de(decke)}`);
      check(`${b.name}: kein Tag über der Decke`, best <= decke, `${de(best)} > ${de(decke)}`);
      check(`${b.name}: die Firma verdient (keine stille Null)`, median > 0, de(median));
    }
  }

  console.log('--- Ausbau: Daten und Decke ---');
  {
    for (const b of data.BRANCHES) {
      check(`${b.id}: fünf Stufen`, b.stufen.length === data.MAX_STUFE);
      check(`${b.id}: Stufenpreise = Gründung × 1,5/3/6/9/14`,
        b.stufen.map((st) => st.price).join() === data.STUFE_PREISFAKTOREN.map((f) => Math.round(b.price * f)).join(),
        b.stufen.map((st) => st.price).join());
      // Regel statt Sonderfall: Faktoren steigen streng monoton mit konstantem Schritt,
      // der erste liegt bei mindestens 1,2 – gilt für den Standard (1,2…2,2) wie für
      // eigene Faktoren mit größerem Schritt (z. B. die Baufirma, 1,3…2,5).
      const arr = b.stufen.map((st) => st.umsatz);
      check(`${b.id}: Umsatzfaktoren steigen streng monoton mit konstantem Schritt, erster ≥ 1,2`,
        arr[0] >= 1.2 && arr.every((f, i) => i === 0 || Math.abs((f - arr[i - 1]) - (arr[1] - arr[0])) < 1e-9),
        arr.join());
      check(`${b.id}: Plätze steigen monoton bis zum Doppelten`,
        b.stufen.every((st, i) => st.slots >= (i ? b.stufen[i - 1].slots : b.slots))
        && b.stufen[4].slots === b.slots * 2, b.stufen.map((st) => st.slots).join());
      check(`${b.id}: vier Extras, drei Umsatz, eines Plätze`,
        b.extras.length === 4 && b.extras.filter((e) => e.umsatz).length === 3
        && b.extras.filter((e) => e.slots).length === 1);
      check(`${b.id}: Extras kosten je 2× Gründung`, b.extras.every((e) => e.price === b.price * 2));
      check(`${b.id}: minStufe 3 und 2 gesetzt`,
        b.extras.some((e) => e.umsatz && e.minStufe === 3) && b.extras.some((e) => e.slots && e.minStufe === 2)
        && b.extras.filter((e) => !e.minStufe).length === 2);
      check(`${b.id}: Extra-IDs eindeutig und auffindbar`,
        new Set(b.extras.map((e) => e.id)).size === 4 && b.extras.every((e) => data.extraById(e.id) === e));
      const gesamt = b.stufen.reduce((s, st) => s + st.price, 0) + b.extras.reduce((s, e) => s + e.price, 0);
      check(`${b.id}: Gesamtausbau ≈ 41,5× Gründung`, Math.abs(gesamt / b.price - 41.5) < 0.05, (gesamt / b.price).toFixed(2));
      check(`${b.id}: Kern-Decke unter Musik+Creator (100.916)`, company.ceilingOf(b).net < 100_916, de(company.ceilingOf(b).net));
    }
    check('Extra-IDs global eindeutig',
      new Set(data.BRANCHES.flatMap((b) => b.extras.map((e) => e.id))).size === 36);

    // effectiveOf: Stufe 0 = Kern, voll = Handrechnung.
    const sp = data.BRANCHES.find((b) => b.id === 'spedition');
    const kern = company.effectiveOf({ stufe: 0 }, sp, []);
    check('Stufe 0 ohne Extras = Kernwerte', kern.slots === 10 && kern.umsatzFactor === 1);
    const alle = sp.extras.map((e) => e.id);
    const voll = company.effectiveOf({ stufe: 5 }, sp, alle);
    check('Stufe 5 + alle Extras: 22 Plätze, Faktor 2,65', voll.slots === 22 && Math.abs(voll.umsatzFactor - 2.65) < 1e-9,
      JSON.stringify(voll));
    // Handrechnung Spedition voll: 22 × 3 × 1.900 × 1,5 × 2,65 = 498.465 + 4 × 1.900 × 1,5 × 2,65 = 30.210
    // → 528.675 brutto − Löhne 22 × 3 × 630 = 41.580 → 487.095.
    check('volle Decke der Spedition = 487.095 (Handrechnung)',
      Math.round(company.fullCeilingOf(sp).net) === 487_095, de(company.fullCeilingOf(sp).net));
    const ki = data.BRANCHES.find((b) => b.id === 'kiosk');
    // Kiosk voll: 5 × 3 × 250 × 1,5 × 2,65 = 14.906,25 + 3.975 − 2.250 = 16.631,25.
    check('volle Decke des Kiosks = 16.631 (Handrechnung)',
      Math.round(company.fullCeilingOf(ki).net) === 16_631, de(company.fullCeilingOf(ki).net));

    // Monotonie: jede Stufe und jedes Extra hebt die Decke echt.
    let ok = true;
    for (const b of data.BRANCHES) {
      let prev = company.ceilingOf(b, 0, []).net;
      for (let st = 1; st <= data.MAX_STUFE; st++) {
        const n = company.ceilingOf(b, st, []).net;
        if (!(n > prev)) ok = false;
        prev = n;
      }
      for (const e of b.extras) {
        if (!(company.ceilingOf(b, 5, [e.id]).net > company.ceilingOf(b, 5, []).net)) ok = false;
      }
    }
    check('jede Stufe und jedes Extra hebt die Decke', ok);
    check('nextStufe: bei Stufe 0 die erste, bei 5 null',
      company.nextStufe({ stufe: 0 }, sp)?.id === 1 && company.nextStufe({ stufe: 5 }, sp) === null);
  }

  console.log('--- Ausbau kaufen: Leiter und Extras ---');
  {
    const U = user(); funds(U, 100_000, 60_000_000);
    const f = await company.found(G, U, 'spedition', 'Ausbau-Sped', t0);
    const cid = f.company.id;
    const sp = company.branch('spedition');
    check('frisch gegründet: Stufe 0, keine Extras', db.getCompany(cid).stufe === 0 && db.companyExtras(cid).length === 0);

    bookings = [];
    let r = await company.upgrade(G, U, t0);
    check('Stufe 1 gekauft: 1,8 Mio, eine Buchung ohne XP', r.ok && r.stufe.id === 1 && bookings.length === 1
      && bookings[0].amount === -1_800_000 && bookings[0].opts.xp === false && bookings[0].opts.kind === 'company',
      JSON.stringify(bookings));
    check('Stufe steht in der DB', db.getCompany(cid).stufe === 1);
    check('Bank angezapft (Bargeld reichte nicht)', konten.get(U).cash === 0 && konten.get(U).bank === 60_000_000 - 1_200_000 + 100_000 - 1_800_000);
    for (let i = 2; i <= 5; i++) r = await company.upgrade(G, U, t0);
    check('bis Stufe 5 gekauft', db.getCompany(cid).stufe === 5);
    r = await company.upgrade(G, U, t0);
    check('Stufe 6 gibt es nicht', r.ok === false && r.reason === 'max');
    const ausgegeben = -bookings.reduce((s, b) => s + b.amount, 0);
    check('Leiter kostet 40,2 Mio', ausgegeben === 40_200_000, de(ausgegeben));

    // Extras
    const [u1, , u3, sx] = sp.extras;
    bookings = [];
    r = await company.buyExtra(G, U, u1.id, t0);
    check('Extra gekauft: 2,4 Mio, eine Buchung ohne XP', r.ok && r.extra.id === u1.id && bookings.length === 1
      && bookings[0].amount === -2_400_000 && bookings[0].opts.xp === false);
    check('Extra steht in der DB', db.companyExtras(cid).includes(u1.id));
    r = await company.buyExtra(G, U, u1.id, t0);
    check('zweimal kaufen geht nicht', r.ok === false && r.reason === 'owned');
    r = await company.buyExtra(G, U, 'kiosk-zeitungsregal', t0);
    check('Extra einer anderen Branche', r.reason === 'unknown');
    r = await company.buyExtra(G, U, 'gibtsnicht', t0);
    check('unbekanntes Extra', r.reason === 'unknown');
    for (const e of [u3, sx]) await company.buyExtra(G, U, e.id, t0);
    check('Extras mit minStufe bei Stufe 5 kaufbar', db.companyExtras(cid).length === 3);

    // minStufe greift bei einer frischen Firma.
    const V = user(); funds(V, 0, 10_000_000);
    const g = await company.found(G, V, 'cafe', 'Klein-Café', t0);
    const cafe = company.branch('cafe');
    r = await company.buyExtra(G, V, cafe.extras[3].id, t0);
    check('Platz-Extra vor Stufe 2 gesperrt', r.ok === false && r.reason === 'stufe' && r.minStufe === 2);
    r = await company.buyExtra(G, V, cafe.extras[2].id, t0);
    check('drittes Umsatz-Extra vor Stufe 3 gesperrt', r.reason === 'stufe' && r.minStufe === 3);
    r = await company.buyExtra(G, V, cafe.extras[0].id, t0);
    check('Extra ohne minStufe sofort kaufbar', r.ok === true);

    // Guthaben und Rollback.
    const W = user(); funds(W, 0, 30_000);
    await company.found(G, W, 'kiosk', 'Armer Kiosk', t0);
    r = await company.upgrade(G, W, t0);
    check('zu wenig Geld: funds mit needed/have', r.reason === 'funds' && r.needed === 37_500 && r.have === 5_000);
    funds(W, 0, 100_000);
    const echt = unb.changeCash;
    unb.changeCash = async () => { throw new Error('API down'); };
    r = await company.upgrade(G, W, t0);
    check('Buchung schlägt fehl: Stufe zurück', r.reason === 'payment' && company.ownCompany(G, W).stufe === 0);
    const kx = company.branch('kiosk').extras[0];
    r = await company.buyExtra(G, W, kx.id, t0);
    check('Buchung schlägt fehl: Extra zurück', r.reason === 'payment' && db.companyExtras(company.ownCompany(G, W).id).length === 0);
    unb.changeCash = echt;

    // Doppelklick-Schutz: zwei gleichzeitige Käufe derselben Stufe dürfen nicht
    // beide durchgehen (§9) – die bedingte Schreibung entscheidet, wer gewinnt.
    const U2 = user(); funds(U2, 100_000_000, 100_000_000);
    await company.found(G, U2, 'spedition', 'Doppelklick-Sped', t0);
    bookings = [];
    const [du1, du2] = await Promise.all([company.upgrade(G, U2, t0), company.upgrade(G, U2, t0)]);
    const upgradeOks = [du1, du2].filter((x) => x.ok);
    const upgradeBusy = [du1, du2].filter((x) => !x.ok);
    check('Doppelklick bei upgrade: genau ein Erfolg, der andere busy',
      upgradeOks.length === 1 && upgradeBusy.length === 1 && upgradeBusy[0].reason === 'busy',
      JSON.stringify([du1, du2]));
    check('Doppelklick bei upgrade: genau eine Buchung', bookings.length === 1, JSON.stringify(bookings));
    check('Doppelklick bei upgrade: Stufe 1 (nicht doppelt gestiegen)',
      company.ownCompany(G, U2).stufe === 1);

    // Dasselbe für Extras: die In-flight-Sperre weist den zweiten Klick ab (busy);
    // die PRIMARY KEY (company_id, extra_id) bleibt als zweite Verteidigungslinie.
    const dx = sp.extras[0];
    bookings = [];
    const [de1, de2] = await Promise.all([
      company.buyExtra(G, U2, dx.id, t0), company.buyExtra(G, U2, dx.id, t0),
    ]);
    const extraOks = [de1, de2].filter((x) => x.ok);
    const extraOwned = [de1, de2].filter((x) => !x.ok);
    check('Doppelklick bei buyExtra: genau ein Erfolg, der andere busy',
      extraOks.length === 1 && extraOwned.length === 1 && extraOwned[0].reason === 'busy',
      JSON.stringify([de1, de2]));
    check('Doppelklick bei buyExtra: genau eine Buchung', bookings.length === 1, JSON.stringify(bookings));

    // Verkettetes Rennen (§7): Trifft der zweite Klick ein, nachdem der erste
    // seine Stufe geschrieben hat, aber während er noch auf die Bank wartet,
    // läse er Stufe 1 und kaufte Stufe 2 – ohne dass die erste Abbuchung schon
    // vom Konto ist (Überziehung). Die In-flight-Sperre weist ihn vor dem ersten
    // `await` ab. Nachgestellt mit einer Bank, deren zweite Antwort (die
    // Guthabenprüfung in `pay`) erst auf Kommando kommt.
    const U4 = user(); funds(U4, 100_000_000, 100_000_000);
    await company.found(G, U4, 'spedition', 'Rennen-Sped', t0);
    const echtBalance = unb.getBalance;
    let freigeben; const tor = new Promise((resolve) => { freigeben = resolve; });
    let anfragen = 0;
    unb.getBalance = async (...a) => {
      anfragen++;
      if (anfragen === 2) await tor;                       // der erste Kauf hängt in `pay`
      await new Promise((resolve) => setTimeout(resolve, 20));
      return echtBalance(...a);
    };
    bookings = [];
    const p1 = company.upgrade(G, U4, t0);
    await new Promise((resolve) => setTimeout(resolve, 40)); // erster Kauf: Stufe geschrieben, wartet in `pay`
    const p2 = company.upgrade(G, U4, t0);                    // zweiter Klick trifft jetzt ein
    const r2 = await p2;
    freigeben();
    const r1 = await p1;
    unb.getBalance = echtBalance;
    check('Rennen mit langsamer Bank: erster Kauf ok, zweiter busy',
      r1.ok && r1.stufe.id === 1 && r2.ok === false && r2.reason === 'busy', JSON.stringify([r1, r2]));
    check('Rennen mit langsamer Bank: genau eine Buchung', bookings.length === 1, JSON.stringify(bookings));
    check('Rennen mit langsamer Bank: Stufe 1, nicht 2', company.ownCompany(G, U4).stufe === 1,
      String(company.ownCompany(G, U4).stufe));
    // Danach geht es normal weiter (die Sperre ist wieder frei).
    r = await company.upgrade(G, U4, t0);
    check('nach dem Rennen: Sperre wieder frei', r.ok && r.stufe.id === 2, JSON.stringify(r));

    // Bricht die Bank beim Anzapfen ab, darf weder eine Buchung noch eine
    // Stufenänderung übrig bleiben (die bedingte Rücknahme darf niemanden clobbern).
    const U3 = user(); funds(U3, 0, 100_000_000);
    await company.found(G, U3, 'spedition', 'Bankfehler-Sped', t0);
    const echtWithdraw = unb.withdrawFromBank;
    unb.withdrawFromBank = async () => { throw new Error('Bank down'); };
    bookings = [];
    r = await company.upgrade(G, U3, t0);
    check('Bank down: payment, Stufe unverändert, keine Buchung',
      r.reason === 'payment' && company.ownCompany(G, U3).stufe === 0 && bookings.length === 0,
      JSON.stringify(r));
    unb.withdrawFromBank = echtWithdraw;

    // Schließen räumt die Extras weg.
    const before = db.companyExtras(cid).length;
    await company.close(G, U, t0);
    check('Schließen löscht die Extras', before === 3 && db.companyExtras(cid).length === 0);

    // Insolvenz ebenso – Muster „Minuskiosk": ein Schichtleiter-NPC, Kasse läuft ins
    // Minus. Das Extra ist das Platz-Extra (kein Umsatzzuschlag), damit die
    // Verlust-Rechnung aus dem Kern-Block hält, auch wenn settle ab Task 3 den
    // Faktor kennt: 1 NPC auf 3 Plätzen → Ziel 0,467, Umsatz 125/135/143 < Lohn 150.
    const Y = user(); funds(Y, 0, 100_000);
    const g2 = await company.found(G, Y, 'kiosk', 'Pleitekiosk', t0);
    company.hireNpc(G, Y, t0, seq(0));
    for (const st of db.companyStaff(g2.company.id)) db.saveStaff({ ...st, rank: 2 });
    db.addCompanyExtra(g2.company.id, 'kiosk-verlaengerte_oeffnung', t0);
    company.settle(g2.company.id, t0 + 15 * DAY_MS);
    check('Insolvenz löscht die Extras',
      db.getCompany(g2.company.id).status === 'closed' && db.companyExtras(g2.company.id).length === 0,
      JSON.stringify({ status: db.getCompany(g2.company.id).status, extras: db.companyExtras(g2.company.id) }));
  }

  console.log('--- Migration: stufe nachgerüstet ---');
  {
    // Das Modul legt die Spalte beim Laden per PRAGMA-Prüfung an (Muster closed_why);
    // hier wird nur geprüft, dass jede Firma sie hat und sie bei 0 startet.
    const U = user(); funds(U, 0, 100_000);
    const f = await company.found(G, U, 'kiosk', 'Migrationskiosk', t0);
    check('stufe ist 0 und eine Zahl',
      typeof db.getCompany(f.company.id).stufe === 'number' && db.getCompany(f.company.id).stufe === 0);
  }

  console.log('--- Ausbau wirkt im Betrieb ---');
  {
    const U = user(); funds(U, 0, 5_000_000);
    const f = await company.found(G, U, 'cafe', 'Wachsendes Café', t0);
    const cid = f.company.id;
    const b = company.branch('cafe');
    for (let i = 0; i < 5; i++) company.hireNpc(G, U, t0, seq(0.1 * i));
    check('Kern: 5 Plätze voll', company.hireNpc(G, U, t0).reason === 'full');
    await company.upgrade(G, U, t0);                     // Terrasse: 6 Plätze, ×1,2
    check('Stufe 1: ein Platz mehr', company.hireNpc(G, U, t0, seq(0.7)).ok === true
      && company.hireNpc(G, U, t0).reason === 'full');
    check('openings zeigt keinen Platz mehr', !company.openings(G).some((o) => o.company.id === cid));

    // Ein Tag Abrechnung, Handrechnung mit Faktor 1,2 und 6 Aushilfen:
    // Ziel = 0,3 + 0,5 × 6/6 = 0,8 → a = 0,3 + 0,5 × 0,2 = 0,4;
    // Umsatz je Schicht = round(900 × 1 × 0,4 × 1,2) = 432; Lohn 180 → 6 × 3 × 252 = 4.536.
    const r = company.settle(cid, t0 + DAY_MS);
    check('settle rechnet mit dem Umsatzfaktor (Kasse 4.536)', db.getCompany(cid).kasse === 4_536, de(db.getCompany(cid).kasse));
    check('Auslastungsziel nutzt die neuen Plätze', Math.abs(company.dailyTarget(b, 6, false, 6) - 0.8) < 1e-9
      && Math.abs(company.dailyTarget(b, 5, false, 6) - (0.3 + 0.5 * 5 / 6)) < 1e-9);

    // Anpacken: round(900 × 1,5 × a × 1,2) mit a = 0,4 → 648.
    const p = await company.pitchIn(G, U, t0 + DAY_MS);
    check('Anpacken nutzt den Faktor (648)', p.ok && p.umsatz === 648, String(p.umsatz));

    // Spieler-Schicht: Umsatz round(900 × 1 × 0,4 × 1,3 × 1,2 × f) = 561. f ist der
    // Energiefaktor NACH dieser Schicht (§Zeit und Energie): selbst ein frischer
    // Spieler kostet die erste 2-h-Schicht 3,55 Erschöpfungspunkte, also
    // f = factorOf(energyOf(3.55)) = 0,998992 statt exakt 1 – 561,6 × f rundet auf 561.
    const P = user(); funds(P, 0);
    company.fire(G, U, db.companyStaff(cid)[0].id, t0 + DAY_MS);
    company.join(G, P, cid, t0 + DAY_MS);
    const jobs = require('../src/jobs');
    const w = await jobs.work(G, P, new Date(t0 + DAY_MS + 1000), seq(0.5));
    check('Spieler-Schicht nutzt den Faktor (561)', w.ok && w.umsatz === Math.round(561.6 * w.factor), String(w.umsatz));

    // Extra mit Plätzen: +2 ab Stufe 2.
    await company.upgrade(G, U, t0 + DAY_MS);
    await company.buyExtra(G, U, b.extras[3].id, t0 + DAY_MS);
    const s = company.status(G, U, t0 + DAY_MS);
    check('status: Stufe 2, 7 + 2 = 9 Plätze, Faktor 1,45', s.stufe === 2 && s.effective.slots === 9
      && Math.abs(s.effective.umsatzFactor - 1.45) < 1e-9, JSON.stringify(s.effective));
    check('status: Extras mit owned/locked', s.extras.length === 4 && s.extras[3].owned === true
      && s.extras[2].locked === true && s.extras[0].locked === false);
    check('status: Stufenliste mit owned', s.stufen.length === 5 && s.stufen[1].owned && !s.stufen[2].owned);
    check('status: nextStufe = Frühstückskarte', s.nextStufe?.name === 'Frühstückskarte');
    check('status: ceilingNow < ceilingMax, ceiling = ceilingNow',
      s.ceilingNow.net < s.ceilingMax.net && s.ceiling.net === s.ceilingNow.net
      && s.ceilingMax.net === company.fullCeilingOf(b).net);
    check('status: free zählt die neuen Plätze', s.free === 9 - s.staff.length);
  }

  console.log('--- §3: Vollausbau – kein Tag über der vollen Decke ---');
  {
    for (const b of data.BRANCHES) {
      const U = user(); funds(U, 0, 200_000_000);
      const f = await company.found(G, U, b.id, `Voll-${b.id}`, t0);
      for (let i = 0; i < data.MAX_STUFE; i++) {
        const r = await company.upgrade(G, U, t0);
        if (!r.ok) throw new Error(`${b.id} Stufe ${i + 1}: ${r.reason}`);
      }
      for (const e of b.extras) {
        const r = await company.buyExtra(G, U, e.id, t0);
        if (!r.ok) throw new Error(`${b.id} Extra ${e.id}: ${r.reason}`);
      }
      const eff = company.effectiveOf(company.ownCompany(G, U), b);
      for (let i = 0; i < eff.slots; i++) {
        const r = company.hireNpc(G, U, t0, seq(0.02 * i));
        if (!r.ok) throw new Error(`${b.id} NPC ${i + 1}: ${r.reason}`);
      }
      const cid = f.company.id;
      for (const s of db.companyStaff(cid)) db.saveStaff({ ...s, rank: 2 });
      const decke = company.fullCeilingOf(b).net;
      let best = -Infinity, gewinn = [], werbungLief = false;
      let now = t0;
      for (let d = 0; d < 365; d++) {
        const vor = db.getCompany(cid).kasse;
        const w = await company.advertise(G, U, now);
        if (w.ok) werbungLief = true;
        if (!(w.ok || w.reason === 'running' || (w.reason === 'kasse' && !werbungLief))) throw new Error(`${b.id} Werbung Tag ${d + 1}: ${w.reason}`);
        for (let i = 0; i < data.MAX_PITCH_PER_DAY; i++) { const p = await company.pitchIn(G, U, now + i * 60e3); if (!p.ok) break; }
        company.settle(cid, now + DAY_MS);
        const tag = db.getCompany(cid).kasse - vor;
        best = Math.max(best, tag); gewinn.push(tag);
        now += DAY_MS;
      }
      const sorted = [...gewinn].sort((a, c) => a - c);
      const median = sorted[Math.floor(sorted.length / 2)];
      console.log(`    ${b.emoji} ${b.name} voll: Median ${de(median)}/Tag · bester Tag ${de(best)} · Decke ${de(decke)}`);
      // Die Decke rechnet ungerundet, die Abrechnung rundet je Schicht (höchstens +0,5).
      // Beim Kiosk sind das 19 × 0,25 = 4,75 über der Decke – genau die Rundung, nichts sonst.
      const rundung = 0.5 * (eff.slots * data.NPC_SHIFTS + data.MAX_PITCH_PER_DAY);
      check(`${b.name} voll: kein Tag über der Decke (bis auf Rundung je Schicht)`, best <= decke + rundung, `${de(best)} > ${de(decke)}`);
      check(`${b.name} voll: verdient (keine stille Null)`, median > company.ceilingOf(b).net, `${de(median)} vs Kern ${de(company.ceilingOf(b).net)}`);
    }
  }

  console.log(`\n${pass} bestanden, ${fail} fehlgeschlagen`);
  process.exit(fail ? 1 : 0);
})();
