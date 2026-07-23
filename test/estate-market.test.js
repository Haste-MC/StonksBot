/**
 * Tests für den zusammengeführten Immobilienmarkt und den Spieler-Verkauf.
 * Aufruf: npm run test:estate
 */
const db = require('../src/db');
const property = require('../src/property');
const { buyUsed } = require('../src/purchase');
const ui = require('../src/ui');
const unb = require('../src/unb');

const G = 'TESTGUILD8';
const A = 'SPIELER_A';
const B = 'SPIELER_B';
let pass = 0, fail = 0;

const check = (label, cond, extra = '') => {
  if (cond) { pass++; console.log(`  ✅ ${label}`); }
  else { fail++; console.log(`  ❌ ${label} ${extra}`); }
};
const cleanup = () => {
  for (const u of [A, B]) { db.endRental(G, u); db.clearGrace(G, u); }
  for (const kind of ['car', 'gear', 'property']) {
    for (const i of db.allItemsOfKind(G, kind)) db.deleteItem(G, i.id);
  }
};

// Geldbörse simulieren.
const wallet = {};
const balanceOf = (u) => (wallet[u] ??= { cash: 1000000, bank: 0, total: 1000000 });
unb.getBalance = async (g, u) => ({ ...balanceOf(u) });
unb.changeCash = async (g, u, amount) => {
  const b = balanceOf(u); b.cash += amount; b.total = b.cash + b.bank; return { ...b };
};
unb.withdrawFromBank = async (g, u, amount) => {
  const b = balanceOf(u); b.cash += amount; b.bank -= amount; b.total = b.cash + b.bank; return { ...b };
};

cleanup();

(async () => {
  const haus = db.createItem({
    guildId: G, name: 'Verkaufshaus', price: 100000, kind: 'property',
    stock: 3, garage: 3, rent: 300, createdBy: 'test',
  });
  const auto = db.createItem({
    guildId: G, name: 'Marktauto', price: 5000, kind: 'car', stock: null, createdBy: 'test',
  });
  const gear = db.createItem({
    guildId: G, name: 'Marktlizenz', price: 500, kind: 'gear', stock: null, createdBy: 'test',
  });

  db.reservePurchase(G, A, haus.id, 1);
  db.reservePurchase(G, A, auto.id, 1);
  db.reservePurchase(G, A, gear.id, 1);

  console.log('--- Immobilie inserieren ---');
  check('A hat 3+2 Plätze',
    property.capacity(G, A).capacity === property.STREET_SLOTS + 3);

  const listing = db.createListing(G, A, haus.id, 80000);
  check('Immobilie inserierbar', listing.ok === true, JSON.stringify(listing));
  check('Ausrüstung weiterhin nicht', db.createListing(G, A, gear.id, 100).reason === 'wrong_kind');
  check('Haus ist aus dem Besitz (Treuhand)', db.getOwned(G, A, haus.id) === null);
  check('Stellplätze weg', property.capacity(G, A).capacity === property.STREET_SLOTS,
    JSON.stringify(property.capacity(G, A)));

  console.log('--- Trennung der Märkte ---');
  db.createListing(G, A, auto.id, 4000);
  check('Automarkt zeigt nur Autos',
    db.listListings(G, 1, 'car').items.every((i) => i.kind === 'car'),
    db.listListings(G, 1, 'car').items.map((i) => i.kind).join());
  check('Immobilienmarkt zeigt nur Immobilien',
    db.listListings(G, 1, 'property').items.every((i) => i.kind === 'property'));
  check('Auto nicht im Immobilienmarkt',
    !db.listListings(G, 1, 'property').items.some((i) => i.name === 'Marktauto'));

  console.log('--- Bewohnte Immobilie nicht verkaufbar ---');
  const haus2 = db.createItem({
    guildId: G, name: 'Bewohnt', price: 90000, kind: 'property',
    stock: 2, garage: 2, rent: 250, createdBy: 'test',
  });
  db.reservePurchase(G, A, haus2.id, 1);
  db.startRental(G, B, haus2.id, Date.now() + property.DAY_MS, 250, A, 250);
  check('mit Mieter drin abgelehnt',
    db.createListing(G, A, haus2.id, 50000).reason === 'has_tenant');
  check('bleibt im Besitz', db.getOwned(G, A, haus2.id) !== null);
  db.endRental(G, B);

  console.log('--- Kauf durch anderen Spieler ---');
  const cashA = balanceOf(A).cash;
  const bought = await buyUsed(G, B, listing.listing.id);
  check('B kauft das Haus', bought.ok === true, JSON.stringify(bought).slice(0, 150));
  check('B besitzt es jetzt', db.getOwned(G, B, haus.id) !== null);
  check('A hat 80.000 bekommen', balanceOf(A).cash === cashA + 80000,
    String(balanceOf(A).cash - cashA));
  check('B bekommt die Stellplätze',
    property.capacity(G, B).capacity === property.STREET_SLOTS + 3,
    JSON.stringify(property.capacity(G, B)));
  check('Inserat verschwunden',
    db.listListings(G, 1, 'property').total === 0, String(db.listListings(G, 1, 'property').total));

  console.log('--- Immobilienkauf braucht keinen Stellplatz ---');
  // B mit Autos vollstopfen, dann noch eine Immobilie kaufen lassen.
  db.reservePurchase(G, B, auto.id, 5);
  const capB = property.capacity(G, B);
  check('B ist voll ausgelastet', capB.free === 0, JSON.stringify(capB));
  const haus3 = db.createItem({
    guildId: G, name: 'Zweithaus', price: 40000, kind: 'property',
    stock: 2, garage: 2, rent: 120, createdBy: 'test',
  });
  const boughtProp = await property.buy(G, B, haus3.id);
  check('Immobilienkauf trotz voller Garage möglich', boughtProp.ok === true,
    JSON.stringify(boughtProp).slice(0, 120));

  console.log('--- Zusammengeführte Marktansicht ---');
  db.reservePurchase(G, A, haus3.id, 1);
  property.offerForRent(G, A, haus3.id, 200);
  const listing2 = db.createListing(G, A, haus2.id, 70000);
  check('zweites Verkaufsinserat', listing2.ok === true);

  const view = await ui.buildPropertyShopView({ guildId: G, userId: B, page: 1 });
  const text = view.embeds[0].toJSON().description;
  check('Marktobjekte enthalten', text.includes('Vom Markt'), text.slice(0, 200));
  check('Spieler-Verkauf enthalten', text.includes('Verkauf'), text.slice(0, 300));
  const rows = view.components.map((r) => r.toJSON());
  check('höchstens 5 Zeilen', rows.length <= 5, String(rows.length));
  check('höchstens 5 Buttons je Zeile', rows.every((r) => r.components.length <= 5));

  // Über alle Seiten hinweg müssen alle drei Quellen vorkommen.
  let allText = '';
  for (let p = 1; p <= 10; p++) {
    const v = await ui.buildPropertyShopView({ guildId: G, userId: B, page: p });
    allText += v.embeds[0].toJSON().description;
  }
  check('alle drei Quellen im Markt',
    allText.includes('Vom Markt') && allText.includes('Verkauf') && allText.includes('Miete'));

  console.log('--- Detailansicht je Quelle ---');
  for (const [label, key] of [
    ['Katalog', `m${haus.id}`],
    ['Verkauf', `s${listing2.listing.id}`],
  ]) {
    const d = await ui.buildPropertyDetailView({ guildId: G, userId: B, key, page: 1 });
    const drows = d.components.map((r) => r.toJSON());
    check(`${label}: gültige Detailansicht`,
      drows.length <= 5 && drows.every((r) => r.components.length <= 5));
  }
  const goneView = await ui.buildPropertyDetailView({ guildId: G, userId: B, key: 's99999', page: 1 });
  check('verschwundenes Inserat bricht nicht',
    goneView.embeds[0].toJSON().title.includes('Nicht mehr verfügbar'));

  cleanup();
  console.log(`\n${pass} bestanden, ${fail} fehlgeschlagen`);
  process.exit(fail === 0 ? 0 : 1);
})();
