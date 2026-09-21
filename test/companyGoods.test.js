/**
 * Firmen Stück 3a: Waren, Lieferanten, Lager, Decke mit Wareneinsatz – und die
 * Erstausstattung bei der Gründung (Nachtrag 2026-09-20).
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

  console.log('--- Erstausstattung bei der Gründung (Kiosk) ---');
  {
    const G = `START_T${Date.now()}`;
    const U = 's1';
    konten.set(U, 1_000_000);
    const t0 = new Date(new Date().setHours(6, 0, 0, 0)).getTime() + DAY_MS;
    const b = company.branch('kiosk');
    check('starterOf Kiosk: 70 Einheiten × 50 = 3.500; Baufirma 280 × 340 = 95.200',
      company.starterOf(b).units === 70 && company.starterOf(b).cost === 3_500
      && company.starterOf(company.branch('baufirma')).units === 280 && company.starterOf(company.branch('baufirma')).cost === 95_200,
      JSON.stringify([company.starterOf(b), company.starterOf(company.branch('baufirma'))]));
    bookings = [];
    const r = await company.found(G, U, 'kiosk', 'Startbude', t0);
    // Eine Buchung (§9): Gründung 25.000 + Erstausstattung 3.500 = 28.500.
    check('found: eine Buchung über −(25.000 + 3.500)', r.ok && bookings.length === 1 && bookings[0].amount === -28_500
      && bookings[0].opts.kind === 'company', JSON.stringify(bookings));
    check('found nennt Erstausstattung und Summe', r.starter.units === 70 && r.starter.cost === 3_500 && r.total === 28_500, JSON.stringify(r.starter));
    const c = db.getCompany(r.company.id);
    check('Firmenzeile: stock 70, stock_cost 3.500, stock_seeded 1', c.stock === 70 && c.stock_cost === 3_500 && c.stock_seeded === 1,
      JSON.stringify({ stock: c.stock, cost: c.stock_cost, seeded: c.stock_seeded }));
    // Zu wenig für Gründung + Erstausstattung: `needed` ist die Summe.
    const V = 's2'; konten.set(V, 27_000);
    const f = await company.found(G, V, 'kiosk', 'Knapp', t0);
    check('funds prüft die Summe (28.500 > 27.000)', f.ok === false && f.reason === 'funds' && f.needed === 28_500 && f.have === 27_000, JSON.stringify(f));
    // Kein Faucet: Sofort schließen gibt genau die Erstausstattung zurück (Kasse 0 + Lager 3.500).
    bookings = [];
    const cl = await company.close(G, U, t0);
    check('sofort schließen: Auszahlung = Erstausstattung 3.500, nicht mehr', cl.ok && cl.payout === 3_500 && bookings[0]?.amount === 3_500, JSON.stringify(cl));
  }

  console.log('--- Hände weg: gründen, einstellen, 20 Tage warten (kein Anlauf-Tod) ---');
  {
    // Der Fall vor dem Nachtrag: Kiosk gegründet, zwei Aushilfen eingestellt, nichts weiter.
    // Ohne Erstausstattung kostete jede Schicht 63 ad hoc, die Kasse war ab Tag 1 rot, die
    // NPCs kündigten nach drei Tagen und an Tag 15 war die Firma insolvent. Mit dem vollen
    // Lager: Tag 1 a = 0,4 → 6 × (round(250 × 0,4) − 100) = 0; Tag 2 a = 0,48 → 6 × (120 − 100)
    // = +120; Tag 3 a = 0,544 → 6 × (136 − 100) = +216 … Die Kasse ist nie negativ (Minimum 0
    // nach Tag 1). Das Lager (70) reicht 11 Tage à 6; Tag 12 nimmt 4 aus dem Lager und 2 ad hoc
    // (126), ab Tag 13 laufen 6 ad hoc (378) – bei a ≈ 0,77 bringt der Tag 6 × (193 − 100) −
    // 378 = 180, immer noch schwarz. Die Handrechnung unten stellt genau das nach.
    const G = `HANDS_T${Date.now()}`;
    const U = 'h1';
    konten.set(U, 1_000_000);
    const t0 = new Date(new Date().setHours(6, 0, 0, 0)).getTime() + DAY_MS;
    const seq = (...v) => { let i = 0; return () => (i < v.length ? v[i++] : 0.5); };
    const b = company.branch('kiosk');
    const r = await company.found(G, U, 'kiosk', 'Wartebude', t0);
    const cid = r.company.id;
    company.hireNpc(G, U, t0, seq(0.1)); company.hireNpc(G, U, t0, seq(0.2));
    const adhoc = company.wareOf(G, b).adhoc;                       // 63
    let a = data.AUSLASTUNG_MIN, kasse = 0, stock = 70, minKasse = 0;
    const tage = [];
    let ok = true, quit = 0;
    for (let d = 1; d <= 20; d++) {
      a += (0.8 - a) * data.AUSLASTUNG_STEP;
      const umsatz = Math.round(b.umsatz * a);
      for (let k = 0; k < 6; k++) { if (stock > 0) stock--; else kasse -= adhoc; }
      kasse += 6 * (umsatz - b.lohn);
      minKasse = Math.min(minKasse, kasse);
      const s = company.settle(cid, t0 + d * DAY_MS, () => 0.5);
      quit += s.quit.length;
      const c = db.getCompany(cid);
      tage.push(c.kasse);
      if (c.status !== 'open' || c.kasse !== kasse || c.stock !== stock) { ok = false; break; }
    }
    check('20 Tage Kasse = Handrechnung, Lager = Handrechnung', ok, JSON.stringify({ tage, kasse, stock: db.getCompany(cid).stock }));
    check('Tag 1 = 0, Tag 2 = 120, Tag 3 = 336 (0 + 120 + 216)', tage[0] === 0 && tage[1] === 120 && tage[2] === 336, tage.slice(0, 3).join(' '));
    check('Kasse nie unter 0, kein NPC gekündigt, Firma offen', minKasse === 0 && quit === 0 && db.getCompany(cid).status === 'open'
      && db.companyStaff(cid).length === 2 && db.getCompany(cid).negative_since === 0,
      JSON.stringify({ minKasse, quit, kasse: db.getCompany(cid).kasse }));
    check('Lager nach 20 Tagen leer (70 − 120 → 0), Wert 0', db.getCompany(cid).stock === 0 && db.getCompany(cid).stock_cost === 0);
  }

  console.log('--- Bestehende Firmen: Lager einmal ohne Einstand auffüllen ---');
  {
    const G = `SEED_T${Date.now()}`;
    const U = 'e1';
    konten.set(U, 1_000_000);
    const t0 = new Date(new Date().setHours(6, 0, 0, 0)).getTime() + DAY_MS;
    // Eine Zeile aus der Zeit vor dem Update: leer, stock_seeded 0.
    const row = db.insertCompany({ guildId: G, ownerId: U, branch: 'kiosk', name: 'Altbude', now: t0 });
    check('insertCompany setzt stock_seeded 1 (neue Gründungen)', row.stock_seeded === 1);
    db.saveCompany({ ...row, stock: 0, stock_cost: 0, stock_seeded: 0 });
    let c = db.getCompany(row.id);
    check('Ausgangslage: leer, nicht befüllt', c.stock === 0 && c.stock_cost === 0 && c.stock_seeded === 0);
    // Schon ein Blick ohne abzurechnenden Tag (now = paid_through) befüllt.
    const s = company.settle(row.id, t0);
    c = db.getCompany(row.id);
    check('settle ohne Tag: Lager 70, Einstand 0, stock_seeded 1', s.days === 0 && c.stock === 70 && c.stock_cost === 0 && c.stock_seeded === 1,
      JSON.stringify({ stock: c.stock, cost: c.stock_cost, seeded: c.stock_seeded }));
    const news = company.newsOf(c);
    check('eine Chronik-Zeile, ohne Betrag', news.length === 1 && news[0].text.includes('Lager aus der Zeit vor dem Update') && news[0].kasse === 0, JSON.stringify(news));
    company.settle(row.id, t0, () => 0.5);
    company.settle(row.id, t0 + DAY_MS, () => 0.5);       // ein Tag ohne Personal: keine Schicht, kein Ereignis
    c = db.getCompany(row.id);
    check('zweite Abrechnung befüllt nicht erneut (70 − 0 Schichten = 70, eine Zeile)', c.stock === 70 && company.newsOf(c).length === 1, JSON.stringify(c));
    // Halb voller Bestand mit Einstand bleibt: nur auffüllen, Einstand unverändert.
    db.saveCompany({ ...c, stock: 10, stock_cost: 500, stock_seeded: 0 });
    company.settle(row.id, t0 + DAY_MS, () => 0.5);
    c = db.getCompany(row.id);
    check('mit Restbestand: auf 70 aufgefüllt, Einstand 500 bleibt', c.stock === 70 && c.stock_cost === 500 && c.stock_seeded === 1, JSON.stringify(c));
    // Kein Faucet: Schließen zahlt nur den Einstand (500) aus, nicht die geschenkten Einheiten.
    bookings = [];
    const cl = await company.close(G, U, t0 + DAY_MS);
    check('Schließen: nur der Einstand 500, nicht 70 × 50', cl.ok && cl.payout === 500 && bookings[0]?.amount === 500, JSON.stringify(cl));
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
    // Erstausstattung (Nachtrag): die Firma kommt mit vollem Lager zur Welt.
    check('frisch: Lager 70/70 (Erstausstattung), Ø 50, Wert 3.500, Preis 50, ad hoc 63', (() => {
      const s = company.status(G, U, t0);
      return s.ware.stock === 70 && s.ware.capacity === 70 && s.ware.price === 50 && s.ware.adhoc === 63
        && s.ware.avgPaid === 50 && s.ware.value === 3_500 && s.ware.daysLeft === 7;
    })(), JSON.stringify(company.status(G, U, t0).ware));

    // Prognose zieht die Ware der heutigen NPC-Schichten ab: 2 NPCs Rang 0 bei Auslastung 0,3
    // = 6 × (round(250 × 0,3) − 100) = −150; leeres Lager: dazu 6 × 63 ad hoc = −528.
    // Was im Lager liegt, ist schon bezahlt – ab 6 Einheiten kostet der Tag keine Ware.
    {
      const c0 = db.getCompany(cid);
      for (const st of db.companyStaff(cid)) db.saveStaff({ ...st, rank: 0 });
      db.saveCompany({ ...c0, auslastung: 0.3, stock: 0, stock_cost: 0 });
      const leer = company.status(G, U, t0).forecast;
      db.saveCompany({ ...db.getCompany(cid), stock: 4, stock_cost: 200 });
      const halb = company.status(G, U, t0).forecast;
      db.saveCompany({ ...db.getCompany(cid), stock: 6, stock_cost: 300 });
      const voll = company.status(G, U, t0).forecast;
      check('Prognose: leer −528, 4 im Lager −276, ab 6 im Lager −150', leer === -528 && halb === -276 && voll === -150,
        JSON.stringify({ leer, halb, voll }));
      // Zurück auf die Erstausstattung.
      db.saveCompany({ ...db.getCompany(cid), stock: 70, stock_cost: 3_500, auslastung: c0.auslastung });
      for (const st of db.companyStaff(cid)) db.saveStaff({ ...st, rank: 2 });
    }

    // Tag 1 mit Erstausstattung: Umsatz 6 × round(375 × 0,4) = 900, Löhne 900 → Kasse ±0;
    // 6 Einheiten aus dem Lager (70 → 64, Wert 3.500 → 3.200), nichts ad hoc.
    let vor = db.getCompany(cid).kasse;
    let s = company.settle(cid, t0 + DAY_MS, keinWurf);
    check('Tag 1 aus der Erstausstattung: Kasse ±0, 64 übrig, Wert 3.200, nichts ad hoc',
      db.getCompany(cid).kasse - vor === 0 && s.ware.units === 6 && s.ware.adhoc === 0 && s.ware.cost === 0
      && db.getCompany(cid).stock === 64 && db.getCompany(cid).stock_cost === 3_200,
      JSON.stringify({ delta: db.getCompany(cid).kasse - vor, ware: s.ware, stock: db.getCompany(cid).stock }));

    // Tag 2 ohne Lager (leer geräumt): Umsatz 6 × round(375 × a2) − Löhne 900, dazu 6 × 63 = 378 ad hoc.
    db.saveCompany({ ...db.getCompany(cid), stock: 0, stock_cost: 0 });
    const ziel = company.dailyTarget(b, 2, false, 2);
    let a = db.getCompany(cid).auslastung; a = a + (ziel - a) * 0.2;          // 0,48
    vor = db.getCompany(cid).kasse;
    s = company.settle(cid, t0 + 2 * DAY_MS, keinWurf);
    check('ohne Lager: −378 ad hoc zusätzlich, 6 Einheiten', db.getCompany(cid).kasse - vor === 6 * Math.round(375 * a) - 900 - 378
      && s.ware.units === 6 && s.ware.adhoc === 6 && s.ware.cost === 378,
      JSON.stringify({ delta: db.getCompany(cid).kasse - vor, ware: s.ware }));

    // Einkauf: 70 zu 50 = 3.500 aus der Kasse.
    vor = db.getCompany(cid).kasse;
    r = await company.buyStock(G, U, 'voll', t0 + 2 * DAY_MS + 3600e3);
    check('voll machen: 70 Einheiten für 3.500', r.ok && r.units === 70 && r.cost === 3_500 && r.stock === 70 && db.getCompany(cid).kasse === vor - 3_500, JSON.stringify(r));
    r = await company.buyStock(G, U, 5, t0 + 2 * DAY_MS + 3600e3);
    check('Kapazität voll → capacity mit free 0', r.reason === 'capacity' && r.free === 0, JSON.stringify(r));
    check('0 oder Unsinn → units', (await company.buyStock(G, U, 0, t0 + 2 * DAY_MS + 3600e3)).reason === 'units'
      && (await company.buyStock(G, U, 'x', t0 + 2 * DAY_MS + 3600e3)).reason === 'units');

    // Tag 3 mit Lager: Kasse nur Umsatz − Löhne; Lager 70 → 64, Wert 3.500 → 3.200.
    a = db.getCompany(cid).auslastung; a = a + (ziel - a) * 0.2;
    vor = db.getCompany(cid).kasse;
    s = company.settle(cid, t0 + 3 * DAY_MS, keinWurf);
    check('mit Lager: kein Warenabzug, 64 übrig, Wert 3.200',
      db.getCompany(cid).kasse - vor === 2 * 3 * Math.round(375 * a) - 900 && s.ware.adhoc === 0 && s.ware.cost === 0
      && db.getCompany(cid).stock === 64 && db.getCompany(cid).stock_cost === 3_200,
      JSON.stringify({ delta: db.getCompany(cid).kasse - vor, stock: db.getCompany(cid).stock, cost: db.getCompany(cid).stock_cost }));
    s = company.status(G, U, t0 + 3 * DAY_MS);
    check('status: reicht 6,4 Tage, Ø 50, Wert 3.200', s.ware.daysLeft === 6.4 && s.ware.avgPaid === 50 && s.ware.value === 3_200, JSON.stringify(s.ware));

    // Anpacken verbraucht eine Einheit.
    r = await company.pitchIn(G, U, t0 + 3 * DAY_MS + 3600e3);
    check('Anpacken: eine Einheit aus dem Lager', r.ok && r.ware.adhoc === false && db.getCompany(cid).stock === 63, JSON.stringify(r.ware));

    // Leeres Lager + Anpacken: ad hoc 63 von der Kasse, Umsatz bleibt.
    db.saveCompany({ ...db.getCompany(cid), stock: 0, stock_cost: 0 });
    vor = db.getCompany(cid).kasse;
    r = await company.pitchIn(G, U, t0 + 3 * DAY_MS + 10_800e3);
    check('Anpacken ohne Lager: Umsatz − 63', r.ok && r.ware.adhoc === true && r.ware.cost === 63 && db.getCompany(cid).kasse - vor === r.umsatz - 63, JSON.stringify(r));

    // Geschlossener Tag: kein Verbrauch, kein Ad-hoc.
    db.saveCompany({ ...db.getCompany(cid), closed_until: t0 + 5 * DAY_MS });
    vor = db.getCompany(cid).kasse;
    s = company.settle(cid, t0 + 4 * DAY_MS, keinWurf);
    check('geschlossen: nur Löhne, keine Ware', s.ware.units === 0 && db.getCompany(cid).kasse - vor === -900);
    db.saveCompany({ ...db.getCompany(cid), closed_until: 0 });

    // Kasse zu klein für den Einkauf. Den offenen Tag vorher ohne Würfel abrechnen – sonst
    // würfelt `buyStock` (über `fresh`) mit Math.random, und ein „guter Tag" (halbe Löhne)
    // hebt die Kasse über die 500.
    company.settle(cid, t0 + 5 * DAY_MS, keinWurf);
    db.saveCompany({ ...db.getCompany(cid), kasse: 100 });
    r = await company.buyStock(G, U, 10, t0 + 5 * DAY_MS);
    check('Kasse reicht nicht → kasse', r.ok === false && r.reason === 'kasse' && r.cost === 500);

    // Spieler-Schicht verbraucht eine Einheit (Platz frei machen: ein NPC geht).
    db.saveCompany({ ...db.getCompany(cid), kasse: 10_000, stock: 5, stock_cost: 250 });
    company.fire(G, U, db.companyStaff(cid)[0].id, t0 + 5 * DAY_MS);
    const P = 'l2';
    const j = await company.join(G, P, cid, t0 + 5 * DAY_MS);
    check('Spieler eingestellt', j.ok, JSON.stringify(j));
    const w = company.workShift(G, P, cid, t0 + 5 * DAY_MS + 3600e3, () => 0.5);
    check('Spieler-Schicht: eine Einheit aus dem Lager (5 → 4, Wert 250 → 200)',
      w.ok && w.ware.adhoc === false && db.getCompany(cid).stock === 4 && db.getCompany(cid).stock_cost === 200, JSON.stringify(w));
    check('Spieler-Schicht liefert die fortgeschriebene Firmenzeile (nach Verbrauch)',
      w.company.stock === 4 && w.company.stock_cost === 200 && w.company.kasse === db.getCompany(cid).kasse, JSON.stringify(w.company));

    // Schließen zahlt Kasse + Lager zum Einstand aus: 10 Einheiten zu 50 = 500 (kein Faucet:
    // nur das Geld, das beim Einkauf aus dem Spiel ging – nicht der Tagespreis).
    db.saveCompany({ ...db.getCompany(cid), stock: 0, stock_cost: 0, kasse: 20_000 });
    r = await company.buyStock(G, U, 10, t0 + 5 * DAY_MS + 7000e3);
    check('10 Einheiten zu 50 gekauft', r.ok && r.cost === 500 && db.getCompany(cid).kasse === 19_500, JSON.stringify(r));
    bookings = [];
    r = await company.close(G, U, t0 + 5 * DAY_MS + 7200e3);
    const buchung = bookings.find((x) => x.user === U && x.reason.startsWith('Auflösung'));
    check('Schließen: Auszahlung = Kasse + Lagerwert (19.500 + 500)',
      r.ok && r.payout === 20_000 && buchung?.amount === 20_000 && buchung.opts.xp === false, JSON.stringify({ r, buchung }));
  }

  console.log('--- Nachfrage wird gezählt (NPC, ad hoc, Großhandel) ---');
  {
    const market = require('../src/wallstreet');
    const G = `DEM_T${Date.now()}`;
    const U = 'n1', T = 'n2';
    konten.set(U, 5_000_000); konten.set(T, 5_000_000);
    const t0 = new Date(new Date().setHours(6, 0, 0, 0)).getTime() + DAY_MS;
    let r = await company.found(G, U, 'baufirma', 'Bau AG', t0);
    const bid = r.company.id;
    check('Gründung zählt die Erstausstattung (280) bei BETO', market.demandOf(G, 'BETO', t0).today === 280, String(market.demandOf(G, 'BETO', t0).today));
    db.saveCompany({ ...db.getCompany(bid), stock: 0, stock_cost: 0 });
    await company.deposit(G, U, 200_000, t0);
    r = await company.buyStock(G, U, 10, t0);
    check('NPC-Kauf 10 → 290', r.ok && market.demandOf(G, 'BETO', t0).today === 290);
    db.saveCompany({ ...db.getCompany(bid), stock: 0, stock_cost: 0 });
    r = await company.pitchIn(G, U, t0 + 3600e3);
    check('ad hoc beim Anpacken → 291', r.ok && r.ware.adhoc && market.demandOf(G, 'BETO', t0).today === 291);
    r = await company.found(G, T, 'spedition', 'Speedy', t0);
    company.setOffer(G, T, 'baufirma', 95, t0);
    r = await company.buyFromTrader(G, U, r.company.id, 5, t0 + 7200e3);
    check('Großhandel 5 → 296 (beim Lieferanten des Käufers)', r.ok && market.demandOf(G, 'BETO', t0).today === 296, JSON.stringify(r));
    check('SCHR (Spedition) unberührt', market.demandOf(G, 'SCHR', t0).today === 238);   // Erstausstattung der Spedition: 34 × 7
  }

  console.log(`\n${pass} bestanden, ${fail} fehlgeschlagen`);
  process.exit(fail === 0 ? 0 : 1);
})();
