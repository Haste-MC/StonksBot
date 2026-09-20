/**
 * Firmen Stück 3a: Waren, Lieferanten, Lager, Decke mit Wareneinsatz.
 * Aufruf: DATA_DIR=.testdata node test/companyGoods.test.js
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
const wsData = require('../src/data/wallstreet');

let pass = 0, fail = 0;
const check = (label, ok, extra = '') => {
  if (ok) { pass++; console.log(`  ✅ ${label}`); }
  else { fail++; console.log(`  ❌ ${label} ${extra}`); }
};
const DAY_MS = 24 * 60 * 60 * 1000;
const de = (n) => Math.round(n).toLocaleString('de-DE');

(async () => {
  console.log('--- Waren und Lieferanten ---');
  {
    check('Konstanten', data.WARE_SHARE === 0.2 && data.WARE_KURS_MIN === 0.5 && data.WARE_KURS_MAX === 2.0
      && data.AD_HOC_MARKUP === 1.25 && data.LAGER_TAGE === 7);
    for (const b of data.BRANCHES) {
      check(`${b.id}: Ware mit Name, Emoji und Lieferant an der Börse`,
        b.ware && b.ware.name && b.ware.emoji && wsData.find(b.ware.supplier)?.kind === 'stock', JSON.stringify(b.ware));
    }
    const byId = Object.fromEntries(data.BRANCHES.map((b) => [b.id, b]));
    check('Lieferanten wie in der Spec',
      byId.kiosk.ware.supplier === 'LAGR' && byId.imbiss.ware.supplier === 'DÖNR' && byId.autowaesche.ware.supplier === 'LACK'
      && byId.cafe.ware.supplier === 'DÖNR' && byId.fitness.ware.supplier === 'GABR' && byId.werkstatt.ware.supplier === 'HAST'
      && byId.spedition.ware.supplier === 'SCHR' && byId.baufirma.ware.supplier === 'BETO' && byId.club.ware.supplier === 'ENTE');
    check('Einheitspreise: Kiosk 50, Baufirma 340, Club 480',
      company.wareUnit(byId.kiosk) === 50 && company.wareUnit(byId.baufirma) === 340 && company.wareUnit(byId.club) === 480);
  }

  console.log('--- Tagespreis am Kurs ---');
  {
    const G = `WARE_T${Date.now()}`;
    const b = company.branch('baufirma');
    const beto = wsData.find('BETO');
    let w = company.wareOf(G, b);
    check('ohne Notierung: Kurs = Start, ratio 1, Preis 340, ad hoc 425',
      w.kurs === beto.start && w.ratio === 1 && w.price === 340 && w.adhoc === 425, JSON.stringify(w));
    db.setPrice(G, 'BETO', Math.round(beto.start * 1.3), 1, Date.now());
    w = company.wareOf(G, b);
    check('Kurs +30 %: Preis 442', w.price === Math.round(340 * (Math.round(beto.start * 1.3) / beto.start)), String(w.price));
    db.setPrice(G, 'BETO', Math.round(beto.start * 0.2), 2, Date.now());
    check('Kurs 0,2 → geklemmt auf 0,5: Preis 170', company.wareOf(G, b).price === 170);
    db.setPrice(G, 'BETO', beto.start * 3, 3, Date.now());
    check('Kurs 3,0 → geklemmt auf 2,0: Preis 680', company.wareOf(G, b).price === 680);
  }

  console.log('--- Decke mit Wareneinsatz ---');
  {
    const byId = Object.fromEntries(data.BRANCHES.map((b) => [b.id, b]));
    const sp = company.ceilingOf(byId.spedition);
    check('Spedition Kern: 96.900 − 18.900 − 34 × 380 = 65.080', sp.gross === 96_900 && sp.wages === 18_900 && sp.ware === 12_920 && sp.net === 65_080, JSON.stringify(sp));
    check('Kiosk Kern 2.350', company.ceilingOf(byId.kiosk).net === 2_350);
    check('Café Kern 18.180', company.ceilingOf(byId.cafe).net === 18_180);
    check('Spedition voll 460.495', company.fullCeilingOf(byId.spedition).net === 460_495, de(company.fullCeilingOf(byId.spedition).net));
    check('Kiosk voll 15.681', company.fullCeilingOf(byId.kiosk).net === 15_681);
    check('Baufirma voll 530.465', company.fullCeilingOf(byId.baufirma).net === 530_465);
    check('Rangfolge voll: Baufirma > Spedition > Club',
      company.fullCeilingOf(byId.baufirma).net > company.fullCeilingOf(byId.spedition).net
      && company.fullCeilingOf(byId.spedition).net > company.fullCeilingOf(byId.club).net);
    const eff = company.effectiveOf({ id: 0, stufe: 0 }, byId.kiosk, []);
    check('Kapazität Kiosk Stufe 0: (2 × 3 + 4) × 7 = 70', company.capacityOf(byId.kiosk, eff) === 70);
  }

  console.log(`\n${pass} bestanden, ${fail} fehlgeschlagen`);
  process.exit(fail === 0 ? 0 : 1);
})();
