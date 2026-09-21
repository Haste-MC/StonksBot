/**
 * Firmen Stück 3c: Firmenanteile – Börsengang ab Stufe 2, Kauf als Transfer
 * mit Gebühr (Senke), Ausschüttung aus Entnahme und Auszahlung.
 * Aufruf: DATA_DIR=.testdata node test/companyShares.test.js
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

(async () => {
  const G = `ANTEIL_T${Date.now()}`;
  const O = 'o1', A = 'a1', B = 'b1';
  konten.set(O, 20_000_000); konten.set(A, 5_000_000); konten.set(B, 5_000_000);
  const t0 = new Date(new Date().setHours(6, 0, 0, 0)).getTime() + DAY_MS;
  const H = 3600e3;

  console.log('--- Konstanten und Regeln ---');
  check('Konstanten', data.SHARES_TOTAL === 1000 && data.OWNER_MIN === 510 && data.IPO_MIN_STUFE === 2 && data.SHARE_FEE === 0.01);
  let r = await company.found(G, O, 'cafe', 'Kaffeeklatsch', t0);
  const cid = r.company.id;
  // Café: Gründung 120.000 + Erstausstattung (5 × 3 + 4) × 7 = 133 Einheiten × 180 = 23.940.
  check('Gründung kostet 143.940 (120.000 + Lager 23.940)', r.ok && r.total === 143_940 && konten.get(O) === 20_000_000 - 143_940, JSON.stringify(r));
  check('ohne Halter: alle 1000 Anteile beim Inhaber', company.sharesOf(cid).owner === 1000 && company.sharesOf(cid).holders.length === 0);
  check('Stufe 0: kein Börsengang', company.listShares(G, O, cid, 100, 1_000, t0).reason === 'stufe');
  bookings = [];
  db.setCompanyStufe(cid, 2);
  check('Stufe per db.setCompanyStufe gesetzt: keine Buchung', db.getCompany(cid).stufe === 2 && bookings.length === 0);
  check('mehr als 490 geht nicht', company.listShares(G, O, cid, 491, 1_000, t0).reason === 'owner_min');
  check('Menge/Preis geprüft', company.listShares(G, O, cid, 0, 1_000, t0).reason === 'shares' && company.listShares(G, O, cid, 10, 0, t0).reason === 'price');
  check('fremde Firma: no_company', company.listShares(G, A, 999_999, 10, 1_000, t0).reason === 'no_company');
  r = company.listShares(G, O, cid, 300, 1_000, t0);
  check('300 Anteile à 1.000 angeboten', r.ok && r.offer.shares === 300 && r.offer.price === 1_000, JSON.stringify(r));
  const offerId = r.offer.id;
  check('zweites Angebot: nur noch 190 möglich', company.listShares(G, O, cid, 191, 1_000, t0).reason === 'owner_min' && company.listShares(G, O, cid, 190, 2_000, t0).ok);
  check('Liste des Servers: zwei Angebote, billigstes zuerst', company.shareOffers(G).length === 2 && company.shareOffers(G)[0].price === 1_000);
  {
    const o = company.shareOffers(G)[0];
    // Buchwert je Anteil: Ausbau Stufe 1+2 (120.000 × 1,5 + 120.000 × 3 = 540.000; die Stufe
    // wurde per DB gesetzt, zählt aber wie gekauft) + Kasse 0 + Lager 23.940 = 563.940 / 1000 ≈ 564.
    check('Angebot nennt Firma, Buchwert 564 und letzte Ausschüttung 0',
      o.company.id === cid && o.company.name === 'Kaffeeklatsch' && o.company.stufe === 2 && o.book === 564 && o.lastPayout === 0, JSON.stringify(o));
  }

  console.log('--- Kauf ---');
  check('Verkäufer kauft nicht bei sich', (await company.buyShares(G, O, offerId, 10, t0)).reason === 'self');
  check('mehr als angeboten', (await company.buyShares(G, A, offerId, 301, t0)).reason === 'shares');
  check('unbekanntes Angebot', (await company.buyShares(G, A, 999_999, 1, t0)).reason === 'offer');
  bookings = [];
  r = await company.buyShares(G, A, offerId, 200, t0 + H);
  // 200 × 1.000 = 200.000; Gebühr 1 % = 2.000; Käufer −202.000, Verkäufer +200.000.
  check('A kauft 200: −202.000 / +200.000, Gebühr 2.000', r.ok && r.cost === 200_000 && r.fee === 2_000
    && bookings.length === 2 && bookings[0].user === A && bookings[0].amount === -202_000 && bookings[1].user === O && bookings[1].amount === 200_000
    && bookings.every((x) => x.opts.xp === false), JSON.stringify({ r, bookings }));
  let s = company.sharesOf(cid);
  check('Verteilung: Inhaber 800, A 200 (Angebot auf 100 gekürzt)', s.owner === 800 && s.holders.length === 1 && s.holders[0].shares === 200 && s.holders[0].cost === 200_000
    && db.getShareOffer(offerId).shares === 100);
  r = await company.buyShares(G, B, offerId, 100, t0 + 2 * H);
  check('B kauft den Rest: Angebot weg', r.ok && db.getShareOffer(offerId) === null && company.sharesOf(cid).owner === 700);
  check('Chronik nennt den Handel', JSON.parse(db.getCompany(cid).news)[0].text.includes('Anteile'));
  {
    // Zu wenig Geld: nichts gebucht, nichts geschrieben.
    const arm = 'arm1';
    konten.set(arm, 1_000);
    const o2 = company.shareOffers(G, cid)[0];         // das 190er-Angebot à 2.000
    bookings = [];
    const rr = await company.buyShares(G, arm, o2.id, 10, t0 + 2 * H);
    check('ohne Geld: funds, keine Buchung, Angebot unverändert', rr.reason === 'funds' && bookings.length === 0 && db.getShareOffer(o2.id).shares === 190, JSON.stringify(rr));
  }
  {
    // Zweite Buchung (Verkäufer) scheitert: Käufer bekommt cost+fee zurück, Angebot
    // wächst auf die alte Größe, keine Halter-Zeile (§7, Muster `pay`).
    const neu = 'c1';
    konten.set(neu, 100_000);
    const o2 = company.shareOffers(G, cid)[0];         // das 190er-Angebot à 2.000
    const echt = unb.changeCash;
    unb.changeCash = async (g, u, ...rest) => { if (u === o2.seller_id) throw new Error('Bank down'); return echt(g, u, ...rest); };
    bookings = [];
    const rr = await company.buyShares(G, neu, o2.id, 10, t0 + 2 * H);
    unb.changeCash = echt;
    // 10 × 2.000 = 20.000 + 1 % Gebühr 200 = 20.200 abgebucht und wieder gutgeschrieben.
    check('Verkäufer-Buchung scheitert: payment, −20.200/+20.200, Angebot 190, keine Halter-Zeile',
      rr.ok === false && rr.reason === 'payment'
      && bookings.length === 2 && bookings[0].user === neu && bookings[0].amount === -20_200 && bookings[1].user === neu && bookings[1].amount === 20_200
      && db.getShareOffer(o2.id).shares === 190 && db.getCompanyShare(cid, neu) === null && konten.get(neu) === 100_000,
      JSON.stringify({ rr, bookings }));
  }

  console.log('--- Ausschüttung ---');
  await company.deposit(G, O, 100_000, t0 + 3 * H);
  bookings = [];
  r = await company.withdraw(G, O, 10_000, t0 + 3 * H);
  // A: floor(10.000 × 200/1000) = 2.000; B: 1.000; Inhaber 7.000 in einer Buchung.
  check('Entnahme 10.000: Inhaber 7.000 gebucht, A 2.000 und B 1.000 ausstehend', r.ok && r.paid === 7_000 && r.shared === 3_000
    && bookings.length === 1 && bookings[0].amount === 7_000
    && db.getCompanyShare(cid, A).pending === 2_000 && db.getCompanyShare(cid, B).pending === 1_000, JSON.stringify({ r, bookings }));
  check('Kasse 90.000', db.getCompany(cid).kasse === 90_000);
  check('last_payout je 1000 Anteile = 10.000', db.getCompany(cid).last_payout === 10_000);
  check('Angebot zeigt letzte Ausschüttung 10 je Anteil', company.shareOffers(G, cid)[0].lastPayout === 10);
  {
    // Buchung scheitert: Kasse UND ausstehende Anteile zurück.
    const echt = unb.changeCash;
    unb.changeCash = async () => { throw new Error('Bank down'); };
    const rr = await company.withdraw(G, O, 5_000, t0 + 3 * H);
    unb.changeCash = echt;
    check('Entnahme scheitert: Kasse 90.000, A weiter 2.000 ausstehend', rr.ok === false && rr.reason === 'payment'
      && db.getCompany(cid).kasse === 90_000 && db.getCompanyShare(cid, A).pending === 2_000 && db.getCompanyShare(cid, B).pending === 1_000, JSON.stringify(rr));
  }
  bookings = [];
  r = await company.claimDividends(G, A);
  check('A holt 2.000 in einer Buchung ab', r.ok && r.amount === 2_000 && bookings.length === 1 && bookings[0].amount === 2_000 && bookings[0].opts.xp === false
    && db.getCompanyShare(cid, A).pending === 0 && db.getCompanyShare(cid, A).received === 2_000, JSON.stringify({ r, bookings }));
  check('nochmal abholen: 0', (await company.claimDividends(G, A)).amount === 0);
  {
    // Abholen scheitert: ausstehend bleibt ausstehend.
    const echt = unb.changeCash;
    unb.changeCash = async () => { throw new Error('Bank down'); };
    const rr = await company.claimDividends(G, B);
    unb.changeCash = echt;
    check('Abholen scheitert: B weiter 1.000 ausstehend', rr.ok === false && rr.reason === 'payment'
      && db.getCompanyShare(cid, B).pending === 1_000 && db.getCompanyShare(cid, B).received === 0, JSON.stringify(rr));
  }

  console.log('--- Weiterverkauf und Schließen ---');
  r = company.listShares(G, A, cid, 50, 1_500, t0 + 4 * H);
  check('A bietet 50 an', r.ok);
  check('A kann nicht mehr als 150 weitere anbieten', company.listShares(G, A, cid, 151, 1_500, t0 + 4 * H).reason === 'shares');
  const bVor = konten.get(B);
  r = await company.buyShares(G, B, r.offer.id, 50, t0 + 5 * H);
  // 50 × 1.500 = 75.000, Gebühr 750; A gibt anteilig 200.000 × 50/200 = 50.000 Einstand ab.
  check('B kauft 50 von A: B 150, A 150, A.cost anteilig 150.000', r.ok && db.getCompanyShare(cid, B).shares === 150 && db.getCompanyShare(cid, A).shares === 150
    && db.getCompanyShare(cid, A).cost === 150_000 && konten.get(B) === bVor - Math.round(75_000 * 1.01), JSON.stringify({ r, A: db.getCompanyShare(cid, A), B: db.getCompanyShare(cid, B) }));
  check('B.cost 100.000 + 75.000', db.getCompanyShare(cid, B).cost === 175_000);
  r = company.cancelShareOffer(G, A, 999_999);
  check('fremdes/unbekanntes Angebot nicht löschbar', r.ok === false);
  {
    const o2 = company.shareOffers(G, cid)[0];         // das 190er-Angebot des Inhabers
    check('fremdes Angebot nicht löschbar', company.cancelShareOffer(G, A, o2.id).ok === false && db.getShareOffer(o2.id) !== null);
  }
  check('status() nennt die Anteile', company.status(G, O, t0 + 5 * H).anteile.owner === 700);
  // Schließen: Kasse 90.000 + Lager (Café-Erstausstattung 133 × 180 = 23.940) → 113.940;
  // je Halter (150 Anteile) floor(113.940 × 150/1000) = 17.091, Inhaber 113.940 − 2 × 17.091 = 79.758.
  const payout = db.getCompany(cid).kasse + db.getCompany(cid).stock_cost;
  check('Auszahlung 113.940', payout === 113_940, String(payout));
  bookings = [];
  r = await company.close(G, O, t0 + 6 * H);
  const teil = Math.floor(payout * 150 / 1000);
  // (Korrektur zum Brief: B hat die 1.000 aus der Entnahme noch nicht abgeholt – sein
  // Ausstehendes ist 1.000 + teil, nicht teil; A hat seine 2.000 schon abgeholt.)
  check('Schließen teilt die Auszahlung: Inhaber Rest, je Halter floor(15 %)', r.ok && r.paid === payout - 2 * teil && bookings[0].amount === payout - 2 * teil
    && db.getCompanyShare(cid, A).pending === teil && db.getCompanyShare(cid, B).pending === 1_000 + teil, JSON.stringify({ r, teil, payout }));
  check('Inhaber 79.758, Halter je 17.091, eine Buchung', r.paid === 79_758 && teil === 17_091 && r.shared === 34_182 && bookings.length === 1);
  check('geschlossen: keine Angebote, kein neues Angebot', company.shareOffers(G, cid).length === 0 && company.listShares(G, A, cid, 10, 100, t0 + 7 * H).reason === 'no_company');
  bookings = [];
  r = await company.claimDividends(G, B);
  check('B holt nach dem Schließen ab: 1.000 + 17.091', r.ok && r.amount === 1_000 + teil && bookings.length === 1 && r.parts.length === 1 && r.parts[0].company === 'Kaffeeklatsch', JSON.stringify(r));

  console.log('--- §3: Summe aller Buchungen ---');
  {
    // Über die ganze Kette entsteht kein Geld: Käufe sind Transfers minus Gebühr,
    // Ausschüttungen kommen aus der Kasse (Einzahlung/Umsatz), nie aus dem Nichts.
    // Handrechnung (je Konto):
    //   O: 20.000.000 − 143.940 (Gründung) + 200.000 + 100.000 (Verkäufe) − 100.000 (Einzahlung)
    //      + 7.000 (Entnahme-Anteil) + 79.758 (Auflösung) = 20.142.818
    //   A:  5.000.000 − 202.000 (Kauf) + 2.000 (Ausschüttung) + 75.000 (Verkauf an B) = 4.875.000
    //   B:  5.000.000 − 101.000 − 75.750 (Käufe) + 18.091 (Ausschüttung) = 4.841.341
    //   Summe 29.859.159 = Start 30.000.000 − Gründungspreis 120.000 (Senke; das Lager kommt
    //   zum Einstand zurück) − Gebühren 3.750 (2.000 + 1.000 + 750) − 17.091 (A hat die
    //   Schließungs-Ausschüttung noch nicht abgeholt).
    const kette = konten.get(O) + konten.get(A) + konten.get(B);
    check('Konten einzeln: O 20.142.818, A 4.875.000, B 4.841.341',
      konten.get(O) === 20_142_818 && konten.get(A) === 4_875_000 && konten.get(B) === 4_841_341,
      JSON.stringify({ O: konten.get(O), A: konten.get(A), B: konten.get(B) }));
    check('Konten-Summe = Start − Gründung − Einzahlung + Entnahme + Auszahlung + abgeholte Ausschüttungen − Gebühren',
      kette === 30_000_000 - 143_940 - 100_000 + 7_000 + 79_758 + (2_000 + 18_091) - (2_000 + 1_000 + 750), String(kette));
    check('… = Start − Gründungspreis − Gebühren − nicht abgeholt (17.091)',
      kette === 30_000_000 - 120_000 - 3_750 - 17_091 && db.getCompanyShare(cid, A).pending === 17_091, String(kette));
  }
  console.log('--- Rückkauf durch den Inhaber ---');
  {
    // Eigene Firma (die alte ist schon zu): Inhaber verkauft 300 an A, A bietet
    // davon 100 weiter an, der Inhaber kauft die 100 zurück – er bekommt dabei
    // KEINE eigene Halter-Zeile; sein impliziter Anteil wächst nur, weil die
    // Halter-Summe sinkt (sharesOf().owner = 1000 − Σ Halter).
    r = await company.found(G, O, 'cafe', 'Rueckkauf', t0 + 8 * H);
    check('zweite Firma gegründet', r.ok, JSON.stringify(r));
    const cid2 = r.company.id;
    db.setCompanyStufe(cid2, 2);
    r = company.listShares(G, O, cid2, 300, 1_000, t0 + 8 * H);
    check('Inhaber bietet 300 an', r.ok, JSON.stringify(r));
    r = await company.buyShares(G, A, r.offer.id, 300, t0 + 8 * H);
    check('A kauft alle 300', r.ok && r.shares === 300, JSON.stringify(r));
    r = company.listShares(G, A, cid2, 100, 1_100, t0 + 8 * H);
    check('A bietet 100 davon an', r.ok, JSON.stringify(r));
    bookings = [];
    r = await company.buyShares(G, O, r.offer.id, 100, t0 + 9 * H);
    check('Inhaber kauft die 100 zurück', r.ok && r.shares === 100, JSON.stringify(r));
    check('Inhaber wieder bei 800, keine eigene Halter-Zeile',
      company.sharesOf(cid2).owner === 800 && (db.getCompanyShare(cid2, O) === null || db.getCompanyShare(cid2, O).shares === 0),
      JSON.stringify({ owner: company.sharesOf(cid2).owner, row: db.getCompanyShare(cid2, O) }));
    check('A hat noch 200', db.getCompanyShare(cid2, A).shares === 200, JSON.stringify(db.getCompanyShare(cid2, A)));
    r = company.listShares(G, O, cid2, 290, 1_000, t0 + 9 * H);
    check('Inhaber darf bis zu 290 weitere anbieten (800 − 510)', r.ok, JSON.stringify(r));
    check('291 geht nicht mehr: owner_min', company.listShares(G, O, cid2, 291, 1_000, t0 + 9 * H).reason === 'owner_min');
  }

  console.log(`\n${pass} bestanden, ${fail} fehlgeschlagen`);
  process.exit(fail === 0 ? 0 : 1);
})();
