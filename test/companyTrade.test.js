/**
 * Firmen Stück 3b: Spedition als Großhändler – Angebote, Preise, Kauf, Decken.
 * Aufruf: DATA_DIR=.testdata node test/companyTrade.test.js
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
const H = 60 * 60 * 1000;
const keinWurf = () => 0.5;

(async () => {
  console.log('--- Konstanten und Preisrechnung ---');
  {
    check('Konstanten', data.HANDEL_RABATT === 0.1 && data.HANDEL_SHARE_MIN === 90 && data.HANDEL_SHARE_MAX === 100 && data.HANDEL_KAPAZITAET === 20);
    check('nur die Spedition handelt', data.BRANCHES.filter((b) => b.handel).map((b) => b.id).join() === 'spedition');
    const q = company.tradeQuote(50, 95);
    check('Kiosk-Ware 50 bei 95 %: 48 / 45 / 3', q.price === 48 && q.wholesale === 45 && q.spread === 3, JSON.stringify(q));
    const q2 = company.tradeQuote(340, 95);
    check('Baufirma-Ware 340 bei 95 %: 323 / 306 / 17', q2.price === 323 && q2.wholesale === 306 && q2.spread === 17, JSON.stringify(q2));
    check('bei 90 % ist die Spanne 0', company.tradeQuote(50, 90).spread === 0);
    check('bei 100 % zahlt der Käufer den NPC-Preis', company.tradeQuote(50, 100).price === 50);
    // Rundung: Preis und Großhandel runden getrennt – die Spanne darf trotzdem nie
    // negativ werden, sonst zahlte der Spediteur beim Liefern drauf (§3).
    let neg = 0;
    for (let npc = 1; npc <= 2_000; npc++) {
      for (let share = data.HANDEL_SHARE_MIN; share <= data.HANDEL_SHARE_MAX; share++) {
        if (company.tradeQuote(npc, share).spread < 0) neg++;
      }
    }
    check('Spanne nie negativ (NPC-Preis 1–2.000, Anteil 90–100)', neg === 0, String(neg));
  }

  console.log('--- Angebote ---');
  {
    const G = `HANDEL_T${Date.now()}`;
    const T = 't1', K = 'k1', B = 'b1';
    konten.set(T, 5_000_000); konten.set(K, 1_000_000); konten.set(B, 5_000_000);
    const t0 = new Date(new Date().setHours(6, 0, 0, 0)).getTime() + DAY_MS;
    let r = await company.found(G, T, 'spedition', 'Speedy GmbH', t0);
    const tid = r.company.id;
    r = await company.found(G, K, 'kiosk', 'Eckladen', t0);
    const kid = r.company.id;
    r = await company.found(G, B, 'baufirma', 'Bau AG', t0);
    const bid = r.company.id;
    // Die Gründungsbuchungen tragen die Firmennamen – ab hier zählt nur, was der Handel bucht.
    bookings = [];

    check('Kiosk darf nicht anbieten', (company.setOffer(G, K, 'kiosk', 95, t0)).reason === 'not_trader');
    check('unbekannte Branche', (company.setOffer(G, T, 'bank', 95, t0)).reason === 'branch');
    check('Anteil außerhalb 90–100', company.setOffer(G, T, 'kiosk', 89, t0).reason === 'share' && company.setOffer(G, T, 'kiosk', 101, t0).reason === 'share'
      && company.setOffer(G, T, 'kiosk', 'x', t0).reason === 'share');
    check('vorher: keine Angebote', company.offersOf(G, tid).every((o) => !o.active) && company.offersFor(G, 'kiosk', t0).length === 0);
    r = company.setOffer(G, T, 'alle', 95, t0);
    check('alle auf 95 %: neun aktive Angebote', r.ok && r.offers.length === 9 && r.offers.every((o) => o.active && o.share === 95), JSON.stringify(r.offers?.length));
    r = company.setOffer(G, T, 'kiosk', 'aus', t0);
    check('kiosk aus', r.ok && r.offers.find((o) => o.branch === 'kiosk').active === false && r.offers.filter((o) => o.active).length === 8);
    check('aus behält den Anteil', r.offers.find((o) => o.branch === 'kiosk').share === 95);
    r = company.setOffer(G, T, 'kiosk', 97, t0);
    check('kiosk wieder an mit 97 %', r.ok && r.offers.find((o) => o.branch === 'kiosk').share === 97 && r.offers.find((o) => o.branch === 'kiosk').active === true);
    check('offersOf: neun Zeilen in Katalogreihenfolge', company.offersOf(G, tid).map((o) => o.branch).join() === data.BRANCHES.map((b) => b.id).join());
    check('offersOf: Ware mit Name und Emoji', company.offersOf(G, tid).every((o) => o.ware?.name && o.ware?.emoji));

    // Käufersicht: ein Angebot für die Kiosk-Ware, Preis 49 (97 % von 50 = 48,5 → 49), Kapazität 10 × 20 = 200.
    let list = company.offersFor(G, 'kiosk', t0);
    check('offersFor kiosk: Speedy 49 statt 50, 200 übrig', list.length === 1 && list[0].price === 49 && list[0].wholesale === 45 && list[0].spread === 4 && list[0].left === 200 && list[0].company.name === 'Speedy GmbH', JSON.stringify(list));
    check('offersFor: unbekannte Branche → leer', company.offersFor(G, 'bank', t0).length === 0);
    // Der Spediteur sieht sich selbst nicht als Lieferant seiner eigenen Ware.
    check('offersFor spedition: eigenes Angebot ist da (für andere Spediteure)', company.offersFor(G, 'spedition', t0).length === 1);
    r = await company.buyFromTrader(G, T, tid, 5, t0);
    check('Spediteur kauft nicht bei sich selbst → self', r.ok === false && r.reason === 'self', JSON.stringify(r));

    // Kauf: Kiosk-Lager ist nach der Gründung voll (70) → erst 20 verbrauchen.
    // Die Kasse startet bei der Gründung mit 0 – der Kauf geht aus der Kasse, also füllen.
    db.saveCompany({ ...db.getCompany(kid), stock: 50, stock_cost: 2_500, kasse: 100_000 });
    // Beide Firmen vorab mit festem Würfel abrechnen (0 Tage bei t0 + 1h), damit die
    // Abrechnung im Kauf keine Zufallszeile mehr zwischen Vorher und Nachher schiebt.
    company.settle(kid, t0 + H, keinWurf); company.settle(tid, t0 + H, keinWurf);
    const kVor = db.getCompany(kid).kasse, tVor = db.getCompany(tid).kasse;
    r = await company.buyFromTrader(G, K, tid, 20, t0 + H);
    check('20 Einheiten bei Speedy: Käufer −980, Lager 70 / 3.480; Spediteur +80 Spanne, heute 20/200',
      r.ok && r.units === 20 && r.price === 49 && r.wholesale === 45 && r.cost === 980 && r.spread === 80 && r.trader.id === tid && r.stock === 70 && r.kasse === kVor - 980
      && db.getCompany(kid).kasse === kVor - 980 && db.getCompany(kid).stock === 70 && db.getCompany(kid).stock_cost === 3_480
      && db.getCompany(tid).kasse === tVor + 80 && db.getCompany(tid).trade_today === 20 && db.getCompany(tid).trade_units === 20 && db.getCompany(tid).trade_profit === 80,
      JSON.stringify({ r, k: db.getCompany(kid).kasse - kVor, t: db.getCompany(tid).kasse - tVor }));
    check('keine Buchung nach außen', bookings.length === 0, JSON.stringify(bookings));
    check('Chronik beidseitig', JSON.parse(db.getCompany(kid).news)[0].text.includes('Speedy GmbH') && JSON.parse(db.getCompany(tid).news)[0].text.includes('Eckladen'));
    check('offersFor kiosk: 180 übrig', company.offersFor(G, 'kiosk', t0 + H)[0].left === 180);
    r = await company.buyFromTrader(G, K, tid, 5, t0 + H);
    check('Lager voll → capacity mit free 0', r.ok === false && r.reason === 'capacity' && r.free === 0, JSON.stringify(r));
    r = await company.buyFromTrader(G, K, tid, 'x', t0 + H);
    check("unsinnige Menge → capacity", r.ok === false && r.reason === 'capacity', JSON.stringify(r));
    r = await company.buyFromTrader(G, K, 999_999, 5, t0 + H);
    check('unbekannter Spediteur → trader', r.ok === false && r.reason === 'trader');
    r = await company.buyFromTrader(G, K, kid, 5, t0 + H);
    check('Kiosk ist kein Spediteur → self (eigene Firma)', r.ok === false && r.reason === 'self');
    r = await company.buyFromTrader(G, B, kid, 5, t0 + H);
    check('Kiosk ist kein Spediteur → trader', r.ok === false && r.reason === 'trader');
    r = await company.buyFromTrader(G, 'niemand', tid, 5, t0 + H);
    check('ohne Firma → no_company', r.ok === false && r.reason === 'no_company');

    // Spediteur eines anderen Servers darf nicht beliefern (Firmen-ID ist nicht serverweit eindeutig).
    const G2 = `HANDEL_T2_${Date.now()}`;
    konten.set('t_g2', 5_000_000);
    const rg2 = await company.found(G2, 't_g2', 'spedition', 'Fremd-Spedition', t0);
    company.setOffer(G2, 't_g2', 'alle', 95, t0);
    r = await company.buyFromTrader(G, K, rg2.company.id, 5, t0 + H);
    check('Spediteur eines anderen Servers → trader', r.ok === false && r.reason === 'trader', JSON.stringify(r));
    await company.close(G2, 't_g2', t0);

    // Baufirma: 'voll' begrenzt durch die Tageskapazität (Spediteur hat noch 180).
    db.saveCompany({ ...db.getCompany(bid), stock: 0, stock_cost: 0, kasse: 1_000_000 });
    const bVor = db.getCompany(bid).kasse;
    r = await company.buyFromTrader(G, B, tid, 'voll', t0 + 2 * H);
    check("'voll' liefert 180 (Tageskapazität), 323 je Einheit, Spanne 17 × 180 = 3.060",
      r.ok && r.units === 180 && r.price === 323 && r.cost === 180 * 323 && r.spread === 3_060 && db.getCompany(bid).kasse === bVor - 180 * 323
      && db.getCompany(bid).stock === 180 && db.getCompany(tid).trade_today === 200, JSON.stringify(r));
    r = await company.buyFromTrader(G, B, tid, 10, t0 + 3 * H);
    check('Kapazität des Tages erschöpft → capacity mit left 0', r.ok === false && r.reason === 'capacity' && r.left === 0, JSON.stringify(r));
    check('offersFor blendet Spediteure ohne Kapazität aus', company.offersFor(G, 'baufirma', t0 + 3 * H).length === 0);
    r = await company.buyFromTrader(G, B, tid, 10, t0 + DAY_MS + H);
    check('nächster Tag: Kapazität zurück (trade_today 10)', r.ok && db.getCompany(tid).trade_today === 10, JSON.stringify(r));

    // Kasse des Käufers reicht nicht.
    db.saveCompany({ ...db.getCompany(bid), kasse: 100 });
    r = await company.buyFromTrader(G, B, tid, 10, t0 + DAY_MS + 2 * H);
    check('Kasse zu klein → kasse mit cost 3.230', r.ok === false && r.reason === 'kasse' && r.cost === 3_230, JSON.stringify(r));

    // Geschlossener Spediteur liefert nicht; inaktives Angebot auch nicht.
    db.saveCompany({ ...db.getCompany(tid), closed_until: t0 + 3 * DAY_MS });
    db.saveCompany({ ...db.getCompany(bid), kasse: 1_000_000 });
    r = await company.buyFromTrader(G, B, tid, 10, t0 + DAY_MS + 3 * H);
    check('geschlossener Spediteur → trader', r.ok === false && r.reason === 'trader');
    check('… und fehlt in offersFor', company.offersFor(G, 'baufirma', t0 + DAY_MS + 3 * H).length === 0);
    db.saveCompany({ ...db.getCompany(tid), closed_until: 0 });
    company.setOffer(G, T, 'baufirma', 'aus', t0 + DAY_MS + 3 * H);
    r = await company.buyFromTrader(G, B, tid, 10, t0 + DAY_MS + 3 * H);
    check('inaktives Angebot → trader', r.ok === false && r.reason === 'trader');
    check('… und fehlt in offersFor', company.offersFor(G, 'baufirma', t0 + DAY_MS + 3 * H).length === 0);

    // status: Spediteur sieht Handel, Käufer sieht Angebote.
    company.setOffer(G, T, 'baufirma', 95, t0 + DAY_MS + 3 * H);
    const st = company.status(G, T, t0 + DAY_MS + 3 * H);
    // Spanne gesamt: 20 × 4 (Kiosk 97 %) + 180 × 17 + 10 × 17 (Baufirma 95 %) = 80 + 3.060 + 170 = 3.310.
    check('status Spediteur: handel { today 10, capacity 200, units 210, profit 3.310 }',
      st.handel && st.handel.today === 10 && st.handel.capacity === 200 && st.handel.left === 190 && st.handel.units === 210 && st.handel.profit === 3_310
      && st.handel.offers.length === 9, JSON.stringify(st.handel));
    const sb = company.status(G, B, t0 + DAY_MS + 3 * H);
    check('status Käufer: angebote mit Speedy', sb.angebote.length === 1 && sb.angebote[0].company.name === 'Speedy GmbH' && sb.handel === null);

    // Zweiter Spediteur: Sortierung nach Preis, dann Name; sieht den anderen, nicht sich selbst.
    konten.set('t2', 5_000_000);
    r = await company.found(G, 't2', 'spedition', 'Anton Logistik', t0 + DAY_MS + 3 * H);
    const tid2 = r.company.id;
    company.setOffer(G, 't2', 'alle', 95, t0 + DAY_MS + 3 * H);
    list = company.offersFor(G, 'baufirma', t0 + DAY_MS + 3 * H);
    check('zwei Angebote, gleicher Preis → Name entscheidet', list.length === 2 && list[0].company.name === 'Anton Logistik' && list[1].company.name === 'Speedy GmbH', JSON.stringify(list.map((o) => o.company.name)));
    company.setOffer(G, 't2', 'baufirma', 100, t0 + DAY_MS + 3 * H);
    list = company.offersFor(G, 'baufirma', t0 + DAY_MS + 3 * H);
    check('billiger zuerst', list[0].company.name === 'Speedy GmbH' && list[1].price === 340, JSON.stringify(list.map((o) => [o.company.name, o.price])));
    const s2 = company.status(G, 't2', t0 + DAY_MS + 3 * H);
    check('Spediteur sieht nur den anderen als Lieferanten', s2.angebote.length === 1 && s2.angebote[0].company.id === tid, JSON.stringify(s2.angebote));
    // Auch die zweite Spedition kommt mit vollem Lager zur Welt – erst Platz schaffen.
    db.saveCompany({ ...db.getCompany(tid2), stock: 0, stock_cost: 0, kasse: 100_000 });
    r = await company.buyFromTrader(G, 't2', tid, 3, t0 + DAY_MS + 3 * H);
    check('Spedition kauft bei anderer Spedition', r.ok && r.units === 3 && r.trader.id === tid, JSON.stringify(r));

    // Schließen räumt Angebote weg.
    await company.close(G, T, t0 + DAY_MS + 4 * H);
    check('geschlossen: keine Angebote mehr', company.offersFor(G, 'baufirma', t0 + DAY_MS + 4 * H).every((o) => o.company.id !== tid) && db.offersOfCompany(tid).length === 0);
    r = await company.buyFromTrader(G, B, tid, 10, t0 + DAY_MS + 4 * H);
    check('Kauf beim geschlossenen → trader', r.ok === false && r.reason === 'trader');
  }

  console.log('--- §3: Handels-Decken ---');
  {
    const byId = Object.fromEntries(data.BRANCHES.map((b) => [b.id, b]));
    const sp = byId.spedition;
    const teuerste = Math.max(...data.BRANCHES.map((b) => company.wareUnit(b)));
    check('teuerste Ware ist der Club mit 480', teuerste === 480);
    check('Spediteur Kern: 10 × 20 × 48 = 9.600/Tag', sp.slots * data.HANDEL_KAPAZITAET * Math.round(teuerste * data.HANDEL_RABATT) === 9_600);
    // Vollausbau = Stufe 5 (20 Plätze) + Nachtschicht (+2) = 22 Plätze – wie ARCHITEKTUR §15
    // und der Ausbau-Test (die 3b-Spec rechnet mit 20 und kommt auf 19.200; das ist ein Rechenfehler).
    const effVoll = company.effectiveOf({ id: 0, stufe: data.MAX_STUFE }, sp, sp.extras.map((e) => e.id));
    check('Spediteur voll: 22 × 20 × 48 = 21.120/Tag', effVoll.slots === 22 && effVoll.slots * data.HANDEL_KAPAZITAET * 48 === 21_120, String(effVoll.slots));
    const k = company.ceilingOf(byId.kiosk);
    check('Käufer Kiosk: Handels-Decke = 2.350 + 0,1 × 500 = 2.400', k.net + Math.round(0.1 * k.ware) === 2_400);
  }

  console.log(`\n${pass} bestanden, ${fail} fehlgeschlagen`);
  process.exit(fail === 0 ? 0 : 1);
})();
