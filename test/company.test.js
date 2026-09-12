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
    check('drei Branchen', data.BRANCHES.length === 3);
    check('jede Branche vollständig', data.BRANCHES.every((b) =>
      b.id && b.name && b.emoji && b.price > 0 && b.slots > 0 && b.umsatz > b.lohn && b.blurb));
    const [k, c, s] = data.BRANCHES;
    check('Kiosk < Café < Spedition beim Preis', k.price < c.price && c.price < s.price);
    check('… und bei der Decke',
      company.ceilingOf(k).net < company.ceilingOf(c).net && company.ceilingOf(c).net < company.ceilingOf(s).net,
      data.BRANCHES.map((b) => `${b.id}=${de(company.ceilingOf(b).net)}`).join(' '));
    // Handrechnung Spedition: 10 × 3 × 2.600 × 1,5 = 117.000 + 4 × 3.900 = 132.600 brutto,
    // Löhne 10 × 3 × 630 = 18.900 → 113.700 netto.
    check('Decke der Spedition ist die Handrechnung (113.700)',
      company.ceilingOf(s).net === 113_700, de(company.ceilingOf(s).net));
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
    check('Prämie über Kasse abgelehnt', (await company.bonus(G, U, ps.id, 10_000_000, t0)).reason === 'kasse');
    r = company.promote(G, U, ps.id, +1);
    check('Spieler-Beförderung spiegelt sich in employment.rank', r.ok && db.getEmployment(G, P).rank === 1);

    // Entnahme.
    bookings = [];
    const k = db.getCompany(cid).kasse;
    r = await company.withdraw(G, U, k, t0);
    check('Entnahme: eine Buchung ohne Steuer, Kasse 0', r.ok && bookings.length === 1 && bookings[0].amount === k
      && bookings[0].opts.tax === false && db.getCompany(cid).kasse === 0, JSON.stringify(bookings));
    check('Entnahme über Kasse abgelehnt', (await company.withdraw(G, U, 1, t0)).reason === 'kasse');
    check('Entnahme von 0 abgelehnt', (await company.withdraw(G, U, 0, t0)).reason === 'amount');

    // Einzahlen rettet vor der Insolvenz.
    db.saveCompany({ ...db.getCompany(cid), kasse: -5_000, negative_since: t0 - 13 * DAY_MS });
    r = await company.deposit(G, U, 6_000, t0);
    check('Einzahlung setzt die Minus-Uhr zurück', r.ok && db.getCompany(cid).negative_since === 0);

    // Status.
    const s = company.status(G, U, t0);
    check('status: Kasse, Auslastung, Personal, Decke, Tagesprognose',
      s.company.id === cid && s.staff.length === 4 && s.free === 1 && s.ceiling.net > 0 && typeof s.forecast === 'number'
      && s.budget.max === 8, JSON.stringify({ free: s.free, forecast: s.forecast }));

    // Schließen: Kasse wird entnommen, Personal weg.
    db.saveCompany({ ...db.getCompany(cid), kasse: 700 });
    bookings = [];
    r = await company.close(G, U, t0);
    check('Schließen entnimmt die Kasse (eine Buchung) und räumt auf',
      r.ok && bookings.length === 1 && bookings[0].amount === 700 && company.ownCompany(G, U) === null
      && db.getEmployment(G, P) === null && db.companyStaff(cid).length === 0);
    check('ohne Firma: status null', company.status(G, U, t0) === null);
  }

  console.log(`\n${pass} bestanden, ${fail} fehlgeschlagen`);
  process.exit(fail ? 1 : 0);
})();
