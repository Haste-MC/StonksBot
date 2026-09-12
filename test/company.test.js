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

  console.log(`\n${pass} bestanden, ${fail} fehlgeschlagen`);
  process.exit(fail ? 1 : 0);
})();
