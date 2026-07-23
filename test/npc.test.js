/**
 * Tests für Anzeigen privater Anbieter (NPCs).
 * Aufruf: npm run test:npc
 */
const db = require('../src/db');
const npc = require('../src/npc');
const data = require('../src/data/npc');
const cond = require('../src/condition');
const property = require('../src/property');
const unb = require('../src/unb');

const G = 'TESTGUILD10';
const U = 'TESTUSER';
let pass = 0, fail = 0;

const check = (label, ok, extra = '') => {
  if (ok) { pass++; console.log(`  ✅ ${label}`); }
  else { fail++; console.log(`  ❌ ${label} ${extra}`); }
};
const cleanup = () => {
  db.endRental(G, U); db.clearGrace(G, U);
  db.purgeExpiredNpc(G, Date.now() + 1e12);
  for (const k of ['car', 'property']) db.clearNpcSpawn(G, k);
  for (const k of ['car', 'gear', 'property']) {
    for (const i of db.allItemsOfKind(G, k)) db.deleteItem(G, i.id);
  }
};

const wallet = {};
const balanceOf = (u) => (wallet[u] ??= { cash: 50000000, bank: 0, total: 50000000 });
unb.getBalance = async (g, u) => ({ ...balanceOf(u) });
unb.changeCash = async (g, u, a) => {
  const b = balanceOf(u); b.cash += a; b.total = b.cash + b.bank; return { ...b };
};
unb.withdrawFromBank = async (g, u, a) => {
  const b = balanceOf(u); b.cash += a; b.bank -= a; b.total = b.cash + b.bank; return { ...b };
};

cleanup();

(async () => {
  // Genug Katalog anlegen, damit aufgefüllt werden kann.
  const cars = [];
  for (let i = 0; i < 12; i++) {
    cars.push(db.createItem({
      guildId: G, name: `NPC-Auto ${i}`, price: 10000 + i * 5000,
      kind: 'car', stock: null, createdBy: 'test',
    }));
  }
  const props = [];
  for (let i = 0; i < 8; i++) {
    props.push(db.createItem({
      guildId: G, name: `NPC-Objekt ${i}`, price: 100000 + i * 50000,
      kind: 'property', stock: 3, garage: 2, rent: 300 + i * 100, createdBy: 'test',
    }));
  }

  console.log('--- Erstbestückung ---');
  const made = npc.refresh(G, 'car');
  const lim = npc.CAPACITY.car;
  check('startet mit einer Menge in der Spanne',
    made.length >= lim.min && made.length <= lim.max, String(made.length));
  check('Bestand entspricht dem', db.countNpcListings(G, 'car') === made.length);

  console.log('--- Wiederholtes Öffnen erzeugt nichts ---');
  const before10 = db.countNpcListings(G, 'car');
  for (let i = 0; i < 10; i++) npc.refresh(G, 'car');
  check('zehnmal öffnen ändert nichts', db.countNpcListings(G, 'car') === before10,
    `${before10} -> ${db.countNpcListings(G, 'car')}`);

  console.log('--- Ankünfte hängen an der Zeit ---');
  // Weit in die Zukunft springen: es müssen welche dazukommen (bis zur Obergrenze).
  const later = Date.now() + npc.MAX_TICKS * npc.ARRIVAL_TICK_MS;
  npc.refresh(G, 'car', later);
  check('nach längerer Zeit kommen Anzeigen dazu',
    db.countNpcListings(G, 'car', later) >= before10,
    `${before10} -> ${db.countNpcListings(G, 'car', later)}`);
  check('Obergrenze wird eingehalten',
    db.countNpcListings(G, 'car', later) <= lim.max,
    String(db.countNpcListings(G, 'car', later)));

  const list = db.listNpcListings(G, 'car');
  check('keine Dubletten', new Set(list.map((l) => l.id)).size === list.length,
    list.map((l) => l.name).join());
  check('alle haben einen Verkäufer', list.every((l) => l.seller && l.seller.length > 0));
  check('alle haben eine Preisstufe',
    list.every((l) => data.DEALS.some((d) => d.id === l.deal)));
  check('alle haben Zustand 0–100',
    list.every((l) => l.npc_condition >= 0 && l.npc_condition <= 100));
  check('alle haben positiven Preis', list.every((l) => l.npc_price > 0));
  check('alle laufen in der Zukunft ab', list.every((l) => l.expires_at > Date.now()));

  console.log('--- Immobilien: Kauf und Miete gemischt ---');
  npc.refresh(G, 'property');
  const pList = db.listNpcListings(G, 'property');
  check('Immobilienanzeigen in der Spanne',
    pList.length >= npc.CAPACITY.property.min && pList.length <= npc.CAPACITY.property.max,
    String(pList.length));
  check('Modi sind gültig', pList.every((l) => ['sale', 'rent'].includes(l.mode)));

  console.log('--- Preisstreuung über 3000 Anzeigen ---');
  const tally = {};
  let cheapest = Infinity, dearest = 0;
  for (let i = 0; i < 3000; i++) {
    const item = cars[i % cars.length];
    const gen = npc.generate(G, item, 'car');
    tally[gen.deal] = (tally[gen.deal] || 0) + 1;
    const worth = cond.currentValue(item.price, gen.condition);
    const ratio = gen.price / worth;
    cheapest = Math.min(cheapest, ratio);
    dearest = Math.max(dearest, ratio);
    db.deleteNpcListing(G, gen.id);
  }
  console.log('   ', JSON.stringify(tally));
  console.log(`    Preisspanne: ${(cheapest * 100).toFixed(0)}% – ${(dearest * 100).toFixed(0)}% vom Zeitwert`);

  check('alle Stufen kommen vor', data.DEALS.every((d) => tally[d.id] > 0),
    JSON.stringify(tally));
  check('marktüblich ist am häufigsten',
    tally.fair > tally.bargain && tally.fair > tally.steep, JSON.stringify(tally));
  check('Schnäppchen sind selten', tally.steal < tally.fair / 5, String(tally.steal));
  check('es gibt echte Schnäppchen (unter 50 %)', cheapest < 0.5, String(cheapest));
  check('es gibt absurde Preise (über 200 %)', dearest > 2, String(dearest));

  console.log('--- Kauf eines NPC-Autos ---');
  npc.refresh(G, 'car');
  const buyable = db.listNpcListings(G, 'car').find((l) => l.mode === 'sale');
  const before = balanceOf(U).cash;
  const bought = await npc.buy(G, U, buyable.npc_id);

  check('Kauf klappt', bought.ok === true, JSON.stringify(bought).slice(0, 150));
  check('Auto im Besitz', db.getOwned(G, U, buyable.id) !== null);
  check('Zustand übernommen',
    db.getOwned(G, U, buyable.id).condition === buyable.npc_condition,
    `${db.getOwned(G, U, buyable.id)?.condition} vs ${buyable.npc_condition}`);
  check('Geld abgebucht', balanceOf(U).cash === before - buyable.npc_price,
    String(before - balanceOf(U).cash));
  check('Anzeige verschwunden', db.getNpcListing(G, buyable.npc_id) === null);
  check('erneuter Kauf scheitert',
    (await npc.buy(G, U, buyable.npc_id)).reason === 'not_found');

  console.log('--- Garagen-Sperre gilt auch hier ---');
  // Stellplätze auffüllen (2 Straßenplätze, eines ist schon belegt).
  npc.refresh(G, 'car');
  const more = db.listNpcListings(G, 'car').filter((l) => l.mode === 'sale');
  await npc.buy(G, U, more[0].npc_id);
  const capNow = property.capacity(G, U);
  check('Garage jetzt voll', capNow.free === 0, JSON.stringify(capNow));

  npc.refresh(G, 'car');
  const blocked = db.listNpcListings(G, 'car').find((l) => !db.getOwned(G, U, l.id));
  const denied = await npc.buy(G, U, blocked.npc_id);
  check('Kauf ohne Stellplatz abgelehnt',
    denied.ok === false && denied.reason === 'no_garage', JSON.stringify(denied).slice(0, 120));
  check('Anzeige bleibt bestehen', db.getNpcListing(G, blocked.npc_id) !== null);

  console.log('--- Miete von einem NPC ---');
  npc.refresh(G, 'property');
  let rentable = db.listNpcListings(G, 'property').find((l) => l.mode === 'rent');
  if (!rentable) {
    // Notfalls eine Mietanzeige erzwingen.
    rentable = db.insertNpcListing({
      guildId: G, itemId: props[0].id, kind: 'property', mode: 'rent',
      seller: 'Testvermieter', note: '', price: 250, condition: 100, deal: 'fair',
      expiresAt: Date.now() + npc.DAY_MS,
    });
    rentable = db.getNpcListing(G, rentable.id);
  }
  const cashBeforeRent = balanceOf(U).cash;
  const rented = await npc.rent(G, U, rentable.npc_id);

  check('Miete klappt', rented.ok === true, JSON.stringify(rented).slice(0, 150));
  check('Mietvertrag angelegt', db.getRental(G, U)?.item_id === rentable.id);
  check('Vermieter ist kein Spieler', db.getRental(G, U)?.landlord_id === '');
  check('vereinbarter Preis gespeichert',
    db.getRental(G, U)?.agreed_rent === rentable.npc_price,
    `${db.getRental(G, U)?.agreed_rent} vs ${rentable.npc_price}`);
  check('erste Miete abgebucht', balanceOf(U).cash === cashBeforeRent - rentable.npc_price);
  check('Stellplätze dazubekommen', rented.capacity.rented === rentable.garage,
    JSON.stringify(rented.capacity));
  check('Anzeige verschwunden', db.getNpcListing(G, rentable.npc_id) === null);

  console.log('--- Abgelaufene Anzeigen ---');
  const stale = db.insertNpcListing({
    guildId: G, itemId: cars[0].id, kind: 'car', mode: 'sale',
    seller: 'Abgelaufen', note: '', price: 100, condition: 90, deal: 'fair',
    expiresAt: Date.now() - 1000,
  });
  check('abgelaufene tauchen nicht auf',
    !db.listNpcListings(G, 'car').some((l) => l.npc_id === stale.id));
  const expired = await npc.buy(G, U, stale.id);
  check('Kauf einer abgelaufenen scheitert', expired.reason === 'expired', JSON.stringify(expired));
  check('abgelaufene wird entfernt', db.getNpcListing(G, stale.id) === null);

  const purged = db.insertNpcListing({
    guildId: G, itemId: cars[1].id, kind: 'car', mode: 'sale',
    seller: 'X', note: '', price: 1, condition: 50, deal: 'fair',
    expiresAt: Date.now() - 1,
  });
  db.purgeExpiredNpc(G);
  check('purge räumt auf', db.getNpcListing(G, purged.id) === null);

  console.log('--- Anzahl schwankt über die Zeit ---');
  // Frischer Server, damit die Simulation sauber startet.
  const SIM = 'TESTGUILD10_SIM';
  for (const i of db.allItemsOfKind(SIM, 'car')) db.deleteItem(SIM, i.id);
  db.purgeExpiredNpc(SIM, Date.now() + 1e12);
  db.clearNpcSpawn(SIM, 'car');
  for (let i = 0; i < 30; i++) {
    db.createItem({
      guildId: SIM, name: `Sim-Auto ${i}`, price: 5000 + i * 1000,
      kind: 'car', stock: null, createdBy: 'test',
    });
  }

  const counts = [];
  let clock = Date.now();
  // Zwei Wochen in Ein-Stunden-Schritten durchlaufen.
  for (let h = 0; h < 24 * 14; h++) {
    clock += 60 * 60 * 1000;
    npc.refresh(SIM, 'car', clock);
    counts.push(db.countNpcListings(SIM, 'car', clock));
  }

  const min = Math.min(...counts);
  const max = Math.max(...counts);
  const distinct = new Set(counts).size;
  console.log(`    Bestand über 14 Tage: min ${min}, max ${max}, ${distinct} verschiedene Werte`);

  check('Anzahl ist nicht konstant', distinct > 2, `nur ${distinct} verschiedene Werte`);
  check('Untergrenze wird gehalten', min >= npc.CAPACITY.car.min, String(min));
  check('Obergrenze wird gehalten', max <= npc.CAPACITY.car.max, String(max));
  check('Markt wird nie leer', min > 0, String(min));

  // Anzeigen müssen auch wieder verschwinden, nicht nur dazukommen.
  check('Bestand geht zwischendurch zurück',
    counts.some((c, i) => i > 0 && c < counts[i - 1]),
    'Bestand ist nie gesunken');

  for (const i of db.allItemsOfKind(SIM, 'car')) db.deleteItem(SIM, i.id);
  db.clearNpcSpawn(SIM, 'car');

  console.log('--- Kein Katalog, keine Anzeigen ---');
  const EMPTY = 'TESTGUILD10_LEER';
  check('leerer Server bricht nicht', npc.refresh(EMPTY, 'car').length === 0);

  cleanup();
  console.log(`\n${pass} bestanden, ${fail} fehlgeschlagen`);
  process.exit(fail === 0 ? 0 : 1);
})();
