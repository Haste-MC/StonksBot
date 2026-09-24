/**
 * Firmen Stück 4: mehrere Firmen je Spieler – Limit, Auswahl, getrennte Betriebe.
 * Aufruf: DATA_DIR=.testdata node test/companyMulti.test.js
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
unb.withdrawFromBank = async (g, u) => ({ cash: konten.get(u) ?? 0, bank: 0, total: konten.get(u) ?? 0 });

const db = require('../src/db');
const company = require('../src/company');
const data = require('../src/data/companies');

let pass = 0, fail = 0;
const check = (label, ok, extra = '') => {
  if (ok) { pass++; console.log(`  ✅ ${label}`); }
  else { fail++; console.log(`  ❌ ${label} ${extra}`); }
};
const DAY_MS = 24 * 60 * 60 * 1000;
const H = 3600e3;

/**
 * Level über XP setzen: `perks.levelOf` liest `db.getStats(...).xp`, und
 * `level.xpForLevel` sagt, wie viel XP ein Level kostet. `db.addStats` ist
 * additiv – also die Differenz zum Ist-Stand buchen (auch negativ).
 */
function setLevel(G, U, lvl) {
  const level = require('../src/level');
  const ziel = level.xpForLevel(lvl);
  const jetzt = db.getStats(G, U).xp;
  db.addStats(G, U, { xp: ziel - jetzt });
}

(async () => {
  console.log('--- Limit am Level ---');
  {
    check('Konstanten', data.COMPANIES_PER_LEVEL === 10 && data.COMPANIES_MAX === 5);
    check('Level 0 → 1, 9 → 1, 10 → 2, 25 → 3, 39 → 4, 40 → 5, 99 → 5',
      [0, 9, 10, 25, 39, 40, 99].map((l) => company.maxCompanies(l)).join() === '1,1,2,3,4,5,5',
      [0, 9, 10, 25, 39, 40, 99].map((l) => company.maxCompanies(l)).join());
  }

  console.log('--- Zwei Firmen führen ---');
  {
    const G = `MULTI_T${Date.now()}`;
    const U = 'm1';
    konten.set(U, 50_000_000);
    const t0 = new Date(new Date().setHours(6, 0, 0, 0)).getTime() + DAY_MS;
    setLevel(G, U, 15);                                   // erlaubt 2
    check('setLevel wirkt', require('../src/perks').levelOf(G, U) === 15,
      String(require('../src/perks').levelOf(G, U)));

    let r = await company.found(G, U, 'kiosk', 'Eckladen', t0);
    check('erste Firma', r.ok, JSON.stringify(r.reason));
    const k1 = r.company.id;
    check('sie ist aktiv', company.activeCompanyId(G, U) === k1);
    r = await company.found(G, U, 'imbiss', 'Bude', t0 + H);
    check('zweite Firma bei Level 15', r.ok, JSON.stringify(r));
    const i1 = r.company.id;
    check('jetzt ist die zweite aktiv', company.activeCompanyId(G, U) === i1);
    check('companiesOf: beide, älteste zuerst', company.companiesOf(G, U).map((c) => c.id).join() === `${k1},${i1}`);
    r = await company.found(G, U, 'cafe', 'Dritte', t0 + 2 * H);
    check('dritte scheitert am Limit', r.ok === false && r.reason === 'limit' && r.have === 2 && r.max === 2 && r.nextAt === 20, JSON.stringify(r));

    setLevel(G, U, 20);
    r = await company.found(G, U, 'cafe', 'Dritte', t0 + 3 * H);
    check('mit Level 20 geht die dritte', r.ok, JSON.stringify(r));
    const c1 = r.company.id;

    // Getrennte Kassen und Abrechnungen.
    await company.deposit(G, U, 10_000, t0 + 4 * H, k1);
    check('Einzahlung landet in der genannten Firma', db.getCompany(k1).kasse > 0 && db.getCompany(i1).kasse === 0,
      `${db.getCompany(k1).kasse} / ${db.getCompany(i1).kasse}`);
    const s1 = company.status(G, U, t0 + 4 * H, k1);
    const s2 = company.status(G, U, t0 + 4 * H, i1);
    check('status je Firma', s1.company.id === k1 && s2.company.id === i1 && s1.branch.id === 'kiosk' && s2.branch.id === 'imbiss');
    check('ohne companyId gilt die aktive (zuletzt gegründete)', company.status(G, U, t0 + 4 * H).company.id === c1);

    check('fremde Firma wird abgelehnt', company.status(G, 'wer-anders', t0 + 4 * H, k1) === null);

    company.hireNpc(G, U, t0 + 5 * H, () => 0.1, k1);
    check('Personal geht an die genannte Firma', db.companyStaff(k1).length === 1 && db.companyStaff(i1).length === 0);

    // Vorfall-Sperre gilt über alle Firmen des Spielers.
    db.clearEvents(G, U);
    const ev = db.insertEvent({ guildId: G, userId: U, kind: 'gesundheitsamt', platform: 'company', refId: k1, createdAt: t0 + 6 * H, expiresAt: t0 + 30 * H });
    check('Vorfall trägt die Firmen-ID', db.getEvent(G, ev.id).ref_id === k1);
    const zweiter = require('../src/decisions').roll(G, U, { groesse: 9, days: 30, npc: 5 }, t0 + 7 * H, () => 0.01, 'company');
    check('kein zweiter Vorfall, solange einer offen ist', zweiter === null);

    // Schließen: aktive Firma fällt zurück.
    await company.close(G, U, t0 + 8 * H, c1);
    check('geschlossen, aktive fällt auf eine offene zurück', db.getCompany(c1).status === 'closed'
      && [k1, i1].includes(company.activeCompanyId(G, U)), String(company.activeCompanyId(G, U)));
    check('companiesOf zählt nur offene', company.companiesOf(G, U).length === 2);
  }

  console.log('--- Vorfall trifft die Firma, an der er hängt ---');
  {
    const G = `MULTI_E${Date.now()}`;
    const U = 'e1';
    konten.set(U, 50_000_000);
    const t0 = new Date(new Date().setHours(6, 0, 0, 0)).getTime() + DAY_MS;
    setLevel(G, U, 20);
    const a = (await company.found(G, U, 'kiosk', 'Erste', t0)).company.id;
    const b = (await company.found(G, U, 'imbiss', 'Zweite', t0 + H)).company.id;
    await company.deposit(G, U, 50_000, t0 + 2 * H, a);
    await company.deposit(G, U, 50_000, t0 + 2 * H, b);
    const kasseB = db.getCompany(b).kasse;

    db.clearEvents(G, U);
    const row = db.insertEvent({ guildId: G, userId: U, kind: 'wasserschaden', platform: 'company',
      refId: a, createdAt: t0 + 3 * H, expiresAt: t0 + 27 * H });
    const done = await require('../src/decisions').apply(G, U, db.getEvent(G, row.id),
      { text: 'Test', kasse: -10_000 }, t0 + 3 * H, false, () => 0.5);
    check('Wirkung greift', done.gone === false, JSON.stringify(done));
    check('nur die verknüpfte Firma zahlt', db.getCompany(a).kasse < 50_000 && db.getCompany(b).kasse === kasseB,
      `${db.getCompany(a).kasse} / ${db.getCompany(b).kasse} (vorher ${kasseB})`);
  }

  console.log(`\n${pass} bestanden, ${fail} fehlgeschlagen`);
  process.exit(fail === 0 ? 0 : 1);
})();
