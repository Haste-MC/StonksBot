/**
 * ===========================================================================
 *  Firmen Stück 4, Teil 2: Firmenwert im Vermögen
 * ===========================================================================
 *
 * Eine Firma ist Besitz wie ein Auto oder ein Depot – bisher war sie in der
 * Vermögensrechnung ein blinder Fleck: Wer 5 Mio in den Ausbau gesteckt hat,
 * stand in der Rangliste wie ein Habenichts.
 *
 *   Firmenwert = Substanz (Investition + Kasse + Lager zum Einstand)
 *              + Ertrag   (gleitender Tagesgewinn × ERTRAG_FAKTOR)
 *
 * Jede erwartete Zahl hier ist von Hand hergeleitet (die Herleitung steht im
 * Kommentar darüber), damit der Test nicht bloß die Implementierung spiegelt.
 *
 * Aufruf: rm -rf .testdata && DATA_DIR=.testdata node test/companyWorth.test.js
 */

// Geld mocken (§8/§12: kein Netz im Test) – vor dem ersten require von company.js.
const unb = require('../src/unb');
const konten = new Map();
unb.getBalance = async (g, u) => ({ cash: konten.get(u) ?? 0, bank: 0, total: konten.get(u) ?? 0 });
unb.changeCash = async (g, u, amount) => {
  konten.set(u, (konten.get(u) ?? 0) + amount);
  return { cash: konten.get(u), bank: 0, total: konten.get(u) };
};
unb.withdrawFromBank = async (g, u) => ({ cash: konten.get(u) ?? 0, bank: 0, total: konten.get(u) ?? 0 });

const db = require('../src/db');
const company = require('../src/company');
const networth = require('../src/networth');
const data = require('../src/data/companies');

let pass = 0, fail = 0;
const check = (label, ok, extra = '') => {
  if (ok) { pass++; console.log(`  ✅ ${label}`); }
  else { fail++; console.log(`  ❌ ${label} ${extra}`); }
};
const DAY_MS = 24 * 60 * 60 * 1000;
const nah = (a, b, eps = 1e-6) => Math.abs(a - b) <= eps;
/** Ein fester Tagesanfang, damit nichts von der Uhrzeit des Laufs abhängt. */
const start = () => new Date(new Date().setHours(6, 0, 0, 0)).getTime() + DAY_MS;

(async () => {
  console.log('--- Substanzwert: Investition + Kasse + Lager ---');
  {
    const G = `CW_A${Date.now()}`;
    const U = 'cw-a';
    konten.set(U, 50_000_000);
    const t0 = start();
    const r = await company.found(G, U, 'kiosk', 'Eckladen', t0);
    check('Kiosk gegründet', r.ok, JSON.stringify(r.reason));
    const id = r.company.id;

    // Handrechnung Erstausstattung Kiosk: Lager = (Plätze × NPC_SHIFTS +
    // MAX_PITCH_PER_DAY) × LAGER_TAGE = (2 × 3 + 4) × 7 = 70 Einheiten;
    // Einheitspreis = round(umsatz × WARE_SHARE) = round(250 × 0,2) = 50
    // → Einstand 70 × 50 = 3.500.
    check('Lager 70 × 50 = 3.500', r.starter.units === 70 && r.starter.cost === 3_500,
      JSON.stringify(r.starter));

    // Kasse 5.000 einzahlen (gleicher Tag → die Abrechnung rechnet 0 Tage).
    await company.deposit(G, U, 5_000, t0 + 1000, id);
    check('Kasse ist 5.000', db.getCompany(id).kasse === 5_000, String(db.getCompany(id).kasse));

    // Stufe 0, keine Extras → invested = 0.
    // Substanz = 0 + 5.000 + 3.500 = 8.500; profit_ema = 0 → Ertrag 0 → Wert 8.500.
    const v = company.valueOf(id);
    check('invested 0', v.invested === 0, String(v.invested));
    check('kasse 5.000', v.kasse === 5_000, String(v.kasse));
    check('stock 3.500', v.stock === 3_500, String(v.stock));
    check('substance 8.500', v.substance === 8_500, String(v.substance));
    check('earnings 0', v.earnings === 0, String(v.earnings));
    check('total 8.500', v.total === 8_500, String(v.total));

    // ---- Ertragswert ------------------------------------------------------
    // Brief-Wert: profit_ema 1.320 → Ertrag = round(1.320 × 30) = 39.600.
    db.saveCompany({ ...db.getCompany(id), profit_ema: 1_320 });
    const v2 = company.valueOf(id);
    check('profit_ema 1.320 → Ertrag 39.600', v2.earnings === 39_600, String(v2.earnings));
    check('Wert 8.500 + 39.600 = 48.100', v2.total === 48_100, String(v2.total));

    // Korrektur zum Brief: „7 Tage à 2.000" ergibt NICHT 1.319,96, sondern
    // 2.000 × (1 − (6/7)^7) = 1.320,1666458… (die EMA nähert sich von unten
    // dem Tagesgewinn). Ertrag = round(1.320,1666… × 30) = round(39.605,0) = 39.605.
    const ema7 = 2_000 * (1 - Math.pow(6 / 7, 7));
    let iter = 0;
    for (let i = 0; i < 7; i++) iter = iter * 6 / 7 + 2_000 / 7;
    check('geschlossene Form = 7 Schritte der Rekursion', nah(ema7, iter, 1e-9), `${ema7} vs ${iter}`);
    check('und das sind 1.320,1666… (nicht 1.319,96)', nah(ema7, 1_320.1666458, 1e-6), String(ema7));
    db.saveCompany({ ...db.getCompany(id), profit_ema: ema7 });
    check('→ Ertrag 39.605', company.valueOf(id).earnings === 39_605,
      String(company.valueOf(id).earnings));

    // Eine Firma im Minus ist nicht negativ wert – sie ist ihre Substanz wert.
    db.saveCompany({ ...db.getCompany(id), profit_ema: -5_000 });
    const v3 = company.valueOf(id);
    check('negative profit_ema → Ertrag 0', v3.earnings === 0, String(v3.earnings));
    check('… und der Wert bleibt die Substanz 8.500', v3.total === 8_500, String(v3.total));

    check('ERTRAG_FAKTOR = 30', data.ERTRAG_FAKTOR === 30, String(data.ERTRAG_FAKTOR));
    check('unbekannte Firma ist 0 wert', company.valueOf(999_999).total === 0);
  }

  console.log('--- Stufe 2 Café: die Investition steckt im Wert ---');
  {
    const G = `CW_B${Date.now()}`;
    const U = 'cw-b';
    konten.set(U, 50_000_000);
    const t0 = start();
    const r = await company.found(G, U, 'cafe', 'Milchbar', t0);
    const id = r.company.id;

    // Handrechnung Café: Gründung 120.000; Stufenpreise = Gründung × 1,5 / 3
    // → 180.000 + 360.000 = 540.000 investiert.
    // Lager: (5 × 3 + 4) × 7 = 133 Einheiten × round(900 × 0,2) = 180 → 23.940.
    check('Erstausstattung Café 133 × 180 = 23.940',
      r.starter.units === 133 && r.starter.cost === 23_940, JSON.stringify(r.starter));
    db.setCompanyStufe(id, 2);
    const v = company.valueOf(id);
    check('invested 180.000 + 360.000 = 540.000', v.invested === 540_000, String(v.invested));
    // Substanz = 540.000 + 0 (Kasse) + 23.940 (Lager) = 563.940.
    check('Substanz 563.940', v.substance === 563_940, String(v.substance));
    check('Wert = Substanz (noch kein Gewinn gemessen)', v.total === 563_940, String(v.total));
  }

  console.log('--- profit_ema entsteht in der Abrechnung (nur aus dem Betrieb) ---');
  {
    const G = `CW_C${Date.now()}`;
    const U = 'cw-c';
    konten.set(U, 50_000_000);
    const t0 = start();
    const id = (await company.found(G, U, 'kiosk', 'Messladen', t0)).company.id;

    // 1. Ohne Personal gibt es keinen Umsatz und keine Löhne: tagesgewinn = 0,
    //    die EMA zerfällt um 6/7. 2.100 × 6/7 = 1.800 – exakt.
    db.saveCompany({ ...db.getCompany(id), profit_ema: 2_100 });
    const leer = company.settle(id, t0 + DAY_MS, () => 0);   // random 0 → Ereignis „none"
    check('ein Tag ohne Betrieb abgerechnet', leer.days === 1, JSON.stringify(leer.days));
    check('kein Ereignis gewürfelt', leer.news.length === 0, JSON.stringify(leer.news));
    check('profit_ema 2.100 × 6/7 = 1.800', nah(db.getCompany(id).profit_ema, 1_800),
      String(db.getCompany(id).profit_ema));

    // 2. Mit Personal: der Tagesgewinn ist Umsatz − Löhne − Ware. Die Ware
    //    kommt aus dem Lager, kostet also nicht die Kasse, sondern den
    //    Einstandswert (stock_cost) – beides zählt.
    for (const name of ['Ali', 'Anja']) db.insertStaff({ companyId: id, kind: 'npc', name, now: t0 });
    db.saveCompany({ ...db.getCompany(id), profit_ema: 0, kasse: 50_000 });
    const vorher = db.getCompany(id);
    const out = company.settle(id, t0 + 2 * DAY_MS, () => 0);
    const nachher = db.getCompany(id);
    check('genau ein Tag, kein Ereignis', out.days === 1 && out.news.length === 0,
      JSON.stringify({ days: out.days, news: out.news }));
    const lager = vorher.stock_cost - nachher.stock_cost;     // Entnahme zum Ø-Preis
    const gewinn = out.umsatz - out.loehne - lager - out.ware.cost;
    check('es wurde überhaupt gewirtschaftet', out.umsatz > 0 && out.loehne > 0 && lager > 0,
      JSON.stringify({ umsatz: out.umsatz, loehne: out.loehne, lager, adhoc: out.ware.cost }));
    check('profit_ema = Tagesgewinn / 7', nah(nachher.profit_ema, gewinn / 7),
      `${nachher.profit_ema} vs ${gewinn / 7} (gewinn ${gewinn})`);

    // 3. §3: Eine Einzahlung ist Betriebskapital, kein Gewinn – sie darf den
    //    Ertragswert nicht heben (sonst wäre der Firmenwert hochspielbar).
    const emaVorEinzahlung = db.getCompany(id).profit_ema;
    await company.deposit(G, U, 1_000_000, t0 + 2 * DAY_MS + 1000, id);
    check('Einzahlung hebt profit_ema nicht',
      db.getCompany(id).profit_ema === emaVorEinzahlung,
      `${db.getCompany(id).profit_ema} vs ${emaVorEinzahlung}`);
    check('… landet aber in der Kasse und damit in der Substanz',
      company.valueOf(id).kasse >= 1_000_000, String(company.valueOf(id).kasse));
  }

  console.log('--- Verteilung: Inhaber, Halter, ausstehende Ausschüttung ---');
  {
    const G = `CW_D${Date.now()}`;
    const U = 'cw-d';          // Inhaber
    const H = 'cw-d-halter';   // Anteilshalter
    konten.set(U, 50_000_000);
    const t0 = start();
    const id = (await company.found(G, U, 'kiosk', 'Anteilsladen', t0)).company.id;
    await company.deposit(G, U, 5_000, t0 + 1000, id);
    // Wert wie oben: 0 + 5.000 + 3.500 = 8.500, kein Ertrag.
    check('Firmenwert 8.500', company.valueOf(id).total === 8_500, String(company.valueOf(id).total));

    // 200 von 1000 Anteilen liegen beim Halter, dazu 7.000 nicht abgeholt.
    db.setCompanyShare(id, H, { shares: 200, cost: 4_000, pending: 7_000, received: 0 });
    const sh = company.sharesOf(id);
    check('Inhaber hält 800 von 1000', sh.total === 1_000 && sh.owner === 800,
      JSON.stringify({ total: sh.total, owner: sh.owner }));

    // 8.500 × 800/1000 = 6.800 beim Inhaber, 8.500 × 200/1000 = 1.700 beim Halter.
    const wOwner = company.worthOf(G, U);
    check('Inhaber: 80 % = 6.800', wOwner.own === 6_800, JSON.stringify(wOwner));
    check('Inhaber hat keine Anteile fremder Firmen', wOwner.shares === 0 && wOwner.pending === 0,
      JSON.stringify(wOwner));
    check('Inhaber gesamt 6.800', wOwner.total === 6_800, String(wOwner.total));

    const wHold = company.worthOf(G, H);
    check('Halter: 20 % = 1.700', wHold.shares === 1_700, JSON.stringify(wHold));
    check('Halter: pending 7.000 zählt dazu', wHold.pending === 7_000, JSON.stringify(wHold));
    check('Halter gesamt 8.700', wHold.total === 8_700, String(wHold.total));
    check('Halter besitzt keine eigene Firma', wHold.own === 0, String(wHold.own));

    // ---- Geschlossene Firmen zählen nicht mehr ----------------------------
    // `close` zahlt Kasse + Lager aus (8.500) und schreibt dem Halter seinen
    // Teil als `pending` gut: floor(8.500 × 200/1000) = 1.700 → pending 8.700.
    await company.close(G, U, t0 + 2000, id);
    check('Firma ist zu', db.getCompany(id).status === 'closed');
    check('geschlossene Firma ist 0 wert', company.valueOf(id).total === 0,
      JSON.stringify(company.valueOf(id)));
    check('Inhaber hat daraus kein Vermögen mehr', company.worthOf(G, U).total === 0,
      JSON.stringify(company.worthOf(G, U)));
    const wHold2 = company.worthOf(G, H);
    check('Halter: Anteil weg …', wHold2.shares === 0, JSON.stringify(wHold2));
    check('… aber die ausstehende Ausschüttung zählt weiter (7.000 + 1.700)',
      wHold2.pending === 8_700 && wHold2.total === 8_700, JSON.stringify(wHold2));
  }

  console.log('--- Vermögen: der Firmenteil steckt in networth ---');
  {
    const G = `CW_E${Date.now()}`;
    const U = 'cw-e';
    const H = 'cw-e-halter';
    konten.set(U, 50_000_000);
    konten.set(H, 0);
    const t0 = start();
    const id = (await company.found(G, U, 'kiosk', 'Vermögensladen', t0)).company.id;
    await company.deposit(G, U, 5_000, t0 + 1000, id);
    db.setCompanyShare(id, H, { shares: 200, cost: 4_000, pending: 0, received: 0 });

    check('PARTS kennt die Firmen',
      networth.PARTS.some((p) => p.key === 'company' && p.label === 'Firmen' && p.emoji === '🏢'),
      JSON.stringify(networth.PARTS));

    const a = networth.assetsOf(G, U);
    check('assetsOf trägt den Firmenwert (6.800)', a.company === 6_800, String(a.company));
    check('… und er steckt in der Summe',
      a.total === a.garage + a.realty + a.depot + a.collection + a.company, JSON.stringify(a));
    const aH = networth.assetsOf(G, H);
    check('auch beim Halter (1.700)', aH.company === 1_700, String(aH.company));

    const zeile = networth.breakdown(a, (v) => v.toLocaleString('de-DE'));
    check('breakdown nennt 🏢', zeile.includes('🏢') && zeile.includes('6.800'), zeile);

    // assetOwners: ein reiner Firmenbesitzer und ein reiner Anteilshalter
    // haben weder Auto noch Sammlung – ohne die neuen UNION-Zweige fehlten
    // sie in der Vermögens-Rangliste.
    const owners = new Set(networth.owners(G));
    check('reiner Firmenbesitzer taucht auf', owners.has(U), [...owners].join());
    check('reiner Anteilshalter auch', owners.has(H), [...owners].join());
    check('wer nichts hat, nicht', !owners.has('cw-e-niemand'));
  }

  console.log('--- §3: Einzahlung ist vermögensneutral ---');
  {
    const G = `CW_F${Date.now()}`;
    const U = 'cw-f';
    konten.set(U, 5_000_000);
    const t0 = start();
    const id = (await company.found(G, U, 'kiosk', 'Neutralladen', t0)).company.id;

    const vorher = await networth.of(G, U);          // Guthaben kommt aus dem Mock
    const firmaVorher = company.worthOf(G, U).total;
    const r = await company.deposit(G, U, 100_000, t0 + 1000, id);
    check('Einzahlung geglückt', r.ok, JSON.stringify(r));
    const nachher = await networth.of(G, U);
    const firmaNachher = company.worthOf(G, U).total;

    check('Firmenwert steigt um genau 100.000', firmaNachher - firmaVorher === 100_000,
      `${firmaVorher} → ${firmaNachher}`);
    check('Konto sinkt um genau 100.000', vorher.liquid - nachher.liquid === 100_000,
      `${vorher.liquid} → ${nachher.liquid}`);
    check('Vermögen bleibt gleich (kein Faucet)', vorher.total === nachher.total,
      `${vorher.total} → ${nachher.total}`);

    // Entnahme desselben Betrags: wieder neutral.
    const w = await company.withdraw(G, U, 100_000, t0 + 2000, id);
    check('Entnahme geglückt', w.ok, JSON.stringify(w));
    const zurueck = await networth.of(G, U);
    check('… und das Vermögen ist unverändert', zurueck.total === vorher.total,
      `${zurueck.total} vs ${vorher.total}`);
  }

  console.log(`\n${pass} bestanden, ${fail} fehlgeschlagen`);
  process.exit(fail === 0 ? 0 : 1);
})();
