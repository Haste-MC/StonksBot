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

  console.log('--- Lager und Verbrauch (Kiosk, 2 Schichtleiter, Auslastung 0,4) ---');
  {
    const G = `LAGER_T${Date.now()}`;
    const U = 'l1';
    konten.set(U, 1_000_000);
    const t0 = new Date(new Date().setHours(6, 0, 0, 0)).getTime() + DAY_MS;
    const seq = (...v) => { let i = 0; return () => (i < v.length ? v[i++] : 0.5); };
    const keinWurf = () => 0.5;
    let r = await company.found(G, U, 'kiosk', 'Lagerbude', t0);
    const cid = r.company.id;
    const b = company.branch('kiosk');
    company.hireNpc(G, U, t0, seq(0.1)); company.hireNpc(G, U, t0, seq(0.2));
    for (const s of db.companyStaff(cid)) db.saveStaff({ ...s, rank: 2 });
    await company.deposit(G, U, 100_000, t0);
    check('frisch: Lager leer, Kapazität 70, Preis 50, ad hoc 63', (() => {
      const s = company.status(G, U, t0);
      return s.ware.stock === 0 && s.ware.capacity === 70 && s.ware.price === 50 && s.ware.adhoc === 63 && s.ware.avgPaid === 0;
    })());

    // Prognose zieht die Ware der heutigen NPC-Schichten ab: 2 NPCs Rang 0 bei Auslastung 0,3
    // = 6 × (round(250 × 0,3) − 100) = −150; leeres Lager: dazu 6 × 63 ad hoc = −528.
    // Was im Lager liegt, ist schon bezahlt – ab 6 Einheiten kostet der Tag keine Ware.
    {
      const c0 = db.getCompany(cid);
      for (const st of db.companyStaff(cid)) db.saveStaff({ ...st, rank: 0 });
      db.saveCompany({ ...c0, auslastung: 0.3 });
      const leer = company.status(G, U, t0).forecast;
      db.saveCompany({ ...db.getCompany(cid), stock: 4, stock_cost: 200 });
      const halb = company.status(G, U, t0).forecast;
      db.saveCompany({ ...db.getCompany(cid), stock: 6, stock_cost: 300 });
      const voll = company.status(G, U, t0).forecast;
      check('Prognose: leer −528, 4 im Lager −276, ab 6 im Lager −150', leer === -528 && halb === -276 && voll === -150,
        JSON.stringify({ leer, halb, voll }));
      db.saveCompany({ ...db.getCompany(cid), stock: 0, stock_cost: 0, auslastung: c0.auslastung });
      for (const st of db.companyStaff(cid)) db.saveStaff({ ...st, rank: 2 });
    }

    // Tag 1 ohne Lager: Umsatz 6 × round(375 × 0,4) = 900, Löhne 900, Ware 6 × 63 = 378 ad hoc.
    let vor = db.getCompany(cid).kasse;
    let s = company.settle(cid, t0 + DAY_MS, keinWurf);
    check('ohne Lager: −378 ad hoc, 6 Einheiten', db.getCompany(cid).kasse - vor === -378 && s.ware.units === 6 && s.ware.adhoc === 6 && s.ware.cost === 378,
      JSON.stringify({ delta: db.getCompany(cid).kasse - vor, ware: s.ware }));

    // Einkauf: 70 zu 50 = 3.500 aus der Kasse.
    vor = db.getCompany(cid).kasse;
    r = await company.buyStock(G, U, 'voll', t0 + DAY_MS + 3600e3);
    check('voll machen: 70 Einheiten für 3.500', r.ok && r.units === 70 && r.cost === 3_500 && r.stock === 70 && db.getCompany(cid).kasse === vor - 3_500, JSON.stringify(r));
    check('Kapazität voll → capacity', (await company.buyStock(G, U, 5, t0 + DAY_MS + 3600e3)).reason === 'capacity');
    check('0 oder Unsinn → units', (await company.buyStock(G, U, 0, t0 + DAY_MS + 3600e3)).reason === 'units'
      && (await company.buyStock(G, U, 'x', t0 + DAY_MS + 3600e3)).reason === 'units');

    // Tag 2 mit Lager: Kasse nur Umsatz − Löhne; Lager 70 → 64, Wert 3.500 → 3.200.
    const a1 = db.getCompany(cid).auslastung;
    const ziel = company.dailyTarget(b, 2, false, 2);
    const a2 = a1 + (ziel - a1) * 0.2;
    vor = db.getCompany(cid).kasse;
    s = company.settle(cid, t0 + 2 * DAY_MS, keinWurf);
    check('mit Lager: kein Warenabzug, 64 übrig, Wert 3.200',
      db.getCompany(cid).kasse - vor === 2 * 3 * Math.round(375 * a2) - 900 && s.ware.adhoc === 0 && s.ware.cost === 0
      && db.getCompany(cid).stock === 64 && db.getCompany(cid).stock_cost === 3_200,
      JSON.stringify({ delta: db.getCompany(cid).kasse - vor, stock: db.getCompany(cid).stock, cost: db.getCompany(cid).stock_cost }));
    s = company.status(G, U, t0 + 2 * DAY_MS);
    check('status: reicht 6,4 Tage, Ø 50, Wert 3.200', s.ware.daysLeft === 6.4 && s.ware.avgPaid === 50 && s.ware.value === 3_200, JSON.stringify(s.ware));

    // Anpacken verbraucht eine Einheit.
    r = await company.pitchIn(G, U, t0 + 2 * DAY_MS + 3600e3);
    check('Anpacken: eine Einheit aus dem Lager', r.ok && r.ware.adhoc === false && db.getCompany(cid).stock === 63, JSON.stringify(r.ware));

    // Leeres Lager + Anpacken: ad hoc 63 von der Kasse, Umsatz bleibt.
    db.saveCompany({ ...db.getCompany(cid), stock: 0, stock_cost: 0 });
    vor = db.getCompany(cid).kasse;
    r = await company.pitchIn(G, U, t0 + 2 * DAY_MS + 10_800e3);
    check('Anpacken ohne Lager: Umsatz − 63', r.ok && r.ware.adhoc === true && r.ware.cost === 63 && db.getCompany(cid).kasse - vor === r.umsatz - 63, JSON.stringify(r));

    // Geschlossener Tag: kein Verbrauch, kein Ad-hoc.
    db.saveCompany({ ...db.getCompany(cid), closed_until: t0 + 4 * DAY_MS });
    vor = db.getCompany(cid).kasse;
    s = company.settle(cid, t0 + 3 * DAY_MS, keinWurf);
    check('geschlossen: nur Löhne, keine Ware', s.ware.units === 0 && db.getCompany(cid).kasse - vor === -900);
    db.saveCompany({ ...db.getCompany(cid), closed_until: 0 });

    // Kasse zu klein für den Einkauf.
    db.saveCompany({ ...db.getCompany(cid), kasse: 100 });
    r = await company.buyStock(G, U, 10, t0 + 4 * DAY_MS);
    check('Kasse reicht nicht → kasse', r.ok === false && r.reason === 'kasse' && r.cost === 500);

    // Spieler-Schicht verbraucht eine Einheit (Platz frei machen: ein NPC geht).
    db.saveCompany({ ...db.getCompany(cid), kasse: 10_000, stock: 5, stock_cost: 250 });
    company.fire(G, U, db.companyStaff(cid)[0].id, t0 + 4 * DAY_MS);
    const P = 'l2';
    const j = await company.join(G, P, cid, t0 + 4 * DAY_MS);
    check('Spieler eingestellt', j.ok, JSON.stringify(j));
    const w = company.workShift(G, P, cid, t0 + 4 * DAY_MS + 3600e3, () => 0.5);
    check('Spieler-Schicht: eine Einheit aus dem Lager (5 → 4, Wert 250 → 200)',
      w.ok && w.ware.adhoc === false && db.getCompany(cid).stock === 4 && db.getCompany(cid).stock_cost === 200, JSON.stringify(w));
    check('Spieler-Schicht liefert die fortgeschriebene Firmenzeile (nach Verbrauch)',
      w.company.stock === 4 && w.company.stock_cost === 200 && w.company.kasse === db.getCompany(cid).kasse, JSON.stringify(w.company));

    // Schließen zahlt Kasse + Lager zum Einstand aus: 10 Einheiten zu 50 = 500 (kein Faucet:
    // nur das Geld, das beim Einkauf aus dem Spiel ging – nicht der Tagespreis).
    db.saveCompany({ ...db.getCompany(cid), stock: 0, stock_cost: 0, kasse: 20_000 });
    r = await company.buyStock(G, U, 10, t0 + 4 * DAY_MS + 7000e3);
    check('10 Einheiten zu 50 gekauft', r.ok && r.cost === 500 && db.getCompany(cid).kasse === 19_500, JSON.stringify(r));
    bookings = [];
    r = await company.close(G, U, t0 + 4 * DAY_MS + 7200e3);
    const buchung = bookings.find((x) => x.user === U && x.reason.startsWith('Auflösung'));
    check('Schließen: Auszahlung = Kasse + Lagerwert (19.500 + 500)',
      r.ok && r.payout === 20_000 && buchung?.amount === 20_000 && buchung.opts.xp === false, JSON.stringify({ r, buchung }));
  }

  console.log(`\n${pass} bestanden, ${fail} fehlgeschlagen`);
  process.exit(fail === 0 ? 0 : 1);
})();
