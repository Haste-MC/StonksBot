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

  console.log(`\n${pass} bestanden, ${fail} fehlgeschlagen`);
  process.exit(fail ? 1 : 0);
})();
