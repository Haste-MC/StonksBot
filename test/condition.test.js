/**
 * Tests für Fahrzeugzustand und Straßenrisiko.
 * Aufruf: npm run test:condition
 */
const db = require('../src/db');
const cond = require('../src/condition');
const street = require('../src/street');
const property = require('../src/property');
const { buy } = require('../src/purchase');
const unb = require('../src/unb');

const G = 'TESTGUILD9';
const U = 'TESTUSER';
let pass = 0, fail = 0;

const check = (label, ok, extra = '') => {
  if (ok) { pass++; console.log(`  ✅ ${label}`); }
  else { fail++; console.log(`  ❌ ${label} ${extra}`); }
};
const cleanup = () => {
  db.endRental(G, U); db.clearGrace(G, U);
  for (const k of ['car', 'gear', 'property']) {
    for (const i of db.allItemsOfKind(G, k)) db.deleteItem(G, i.id);
  }
};

const wallet = {};
const balanceOf = (u) => (wallet[u] ??= { cash: 10000000, bank: 0, total: 10000000 });
unb.getBalance = async (g, u) => ({ ...balanceOf(u) });
unb.changeCash = async (g, u, a) => {
  const b = balanceOf(u); b.cash += a; b.total = b.cash + b.bank; return { ...b };
};
unb.withdrawFromBank = async (g, u, a) => {
  const b = balanceOf(u); b.cash += a; b.bank -= a; b.total = b.cash + b.bank; return { ...b };
};

cleanup();

(async () => {
  console.log('--- Zustandsskala ---');
  check('100 = voller Wert', cond.valueFactor(100) === 1);
  check('0 = Restwert 30 %', Math.abs(cond.valueFactor(0) - 0.30) < 1e-9);
  check('monoton steigend', [0, 20, 50, 80, 100]
    .every((v, i, a) => i === 0 || cond.valueFactor(v) > cond.valueFactor(a[i - 1])));
  check('clamp begrenzt nach oben', cond.clamp(150) === 100);
  check('clamp begrenzt nach unten', cond.clamp(-20) === 0);
  check('jede Stufe hat ein Label', [0, 20, 40, 60, 80, 100].every((v) => cond.level(v).label));
  check('Wert nie unter 1', cond.currentValue(1, 0) >= 1);

  console.log('--- Neukauf startet bei 100 ---');
  const auto = db.createItem({
    guildId: G, name: 'Zustandsauto', price: 20000, kind: 'car', stock: null, createdBy: 't',
  });
  const bought = await buy(G, U, auto.id, 1);
  check('Kauf klappt', bought.ok === true, JSON.stringify(bought).slice(0, 120));
  check('startet neuwertig', db.getOwned(G, U, auto.id).condition === 100);

  console.log('--- Jedes Modell nur einmal ---');
  const again = await buy(G, U, auto.id, 1);
  check('zweiter Kauf abgelehnt', again.ok === false && again.reason === 'already_owned',
    JSON.stringify(again));
  const many = await buy(G, U, auto.id, 3);
  check('Mengenkauf abgelehnt', many.ok === false, JSON.stringify(many).slice(0, 80));

  console.log('--- Zustand beeinflusst den Garagenwert ---');
  const fullValue = db.garageValue(G, U);
  db.setCondition(G, U, auto.id, 50);
  const halfValue = db.garageValue(G, U);
  check('Wert sinkt mit dem Zustand', halfValue < fullValue, `${halfValue} vs ${fullValue}`);
  check('passt zur Formel in condition.js',
    halfValue === cond.currentValue(20000, 50), `${halfValue} vs ${cond.currentValue(20000, 50)}`);
  db.setCondition(G, U, auto.id, 100);

  console.log('--- Zustand überlebt die Treuhand ---');
  db.setCondition(G, U, auto.id, 63);
  const listing = db.createListing(G, U, auto.id, 9000);
  check('Inserat trägt den Zustand', listing.listing.condition === 63,
    String(listing.listing.condition));
  check('im Markt sichtbar',
    db.listListings(G, 1, 'car').items[0].listing_condition === 63);
  const back = db.cancelListing(G, U, listing.listing.id);
  check('Rückzug stellt Zustand wieder her', db.getOwned(G, U, auto.id).condition === 63,
    String(db.getOwned(G, U, auto.id).condition));

  // Verkauf an anderen Spieler.
  const listing2 = db.createListing(G, U, auto.id, 9000);
  const taken = db.takeListing(G, 'KAEUFER', listing2.listing.id);
  check('Käufer erhält den Zustand', db.getOwned(G, 'KAEUFER', auto.id).condition === 63,
    String(db.getOwned(G, 'KAEUFER', auto.id)?.condition));
  // Zurückgeben für die folgenden Tests.
  db.removeCar(G, 'KAEUFER', auto.id);
  db.reservePurchase(G, U, auto.id, 1);
  db.setCondition(G, U, auto.id, 100);

  console.log('--- Wer steht draußen? ---');
  let parked = street.parkedOutside(G, U);
  check('ohne Immobilie steht alles draußen', parked.outside.length === 1,
    String(parked.outside.length));

  const haus = db.createItem({
    guildId: G, name: 'Zustandshaus', price: 50000, kind: 'property',
    stock: 2, garage: 2, rent: 100, createdBy: 't',
  });
  db.reservePurchase(G, U, haus.id, 1);
  parked = street.parkedOutside(G, U);
  check('mit Garage steht nichts draußen', parked.outside.length === 0);

  // Drei weitere Autos: 2 Garagenplätze -> 2 drin, 2 draußen.
  const teuer = db.createItem({
    guildId: G, name: 'Teuerauto', price: 500000, kind: 'car', stock: null, createdBy: 't',
  });
  const billig = db.createItem({
    guildId: G, name: 'Billigauto', price: 1000, kind: 'car', stock: null, createdBy: 't',
  });
  const mittel = db.createItem({
    guildId: G, name: 'Mittelauto', price: 60000, kind: 'car', stock: null, createdBy: 't',
  });
  for (const it of [teuer, billig, mittel]) db.reservePurchase(G, U, it.id, 1);

  parked = street.parkedOutside(G, U);
  check('2 Autos draußen', parked.outside.length === 2, String(parked.outside.length));
  check('teuerste stehen in der Garage',
    !parked.outside.some((c) => c.name === 'Teuerauto'),
    parked.outside.map((c) => c.name).join());
  check('billigste stehen draußen',
    parked.outside.some((c) => c.name === 'Billigauto'),
    parked.outside.map((c) => c.name).join());

  console.log('--- Diebstahlrisiko skaliert mit dem Wert ---');
  check('teures Auto riskanter als billiges',
    street.theftChance(500000) > street.theftChance(1000),
    `${street.theftChance(500000)} vs ${street.theftChance(1000)}`);
  check('Risiko bleibt gedeckelt', street.theftChance(100000000) <= street.RISK.theft * 3.5);
  check('Risiko bleibt positiv', street.theftChance(1) > 0);

  console.log('--- Erster Lauf bestraft nicht rückwirkend ---');
  const first = await street.settle(G, U, Date.now());
  check('keine Ereignisse beim ersten Mal', first.events.length === 0 && first.days === 0,
    JSON.stringify(first));
  check('Zeitpunkt gemerkt', db.getStreetWatch(G, U) !== null);

  console.log('--- Innerhalb eines Tages passiert nichts ---');
  const soon = await street.settle(G, U, Date.now() + 3600000);
  check('unter 24 h keine Abrechnung', soon.days === 0, JSON.stringify(soon));

  console.log('--- Nachholen ist gedeckelt ---');
  const far = await street.settle(G, U, Date.now() + 400 * street.DAY_MS);
  check(`höchstens ${street.MAX_CATCHUP_DAYS} Tage nachgeholt`,
    far.days === street.MAX_CATCHUP_DAYS, String(far.days));

  console.log('--- Garage schützt zuverlässig ---');
  // Alles außer den zwei Garagenplätzen entfernen.
  for (const it of [billig, mittel]) db.removeCar(G, U, it.id);
  db.setStreetWatch(G, U, Date.now() - 30 * street.DAY_MS);
  const safe = await street.settle(G, U, Date.now());
  check('keine Ereignisse bei voller Überdachung', safe.events.length === 0,
    JSON.stringify(safe.events).slice(0, 150));
  check('Zustand unverändert', db.getOwned(G, U, teuer.id).condition === 100);

  console.log('--- Draußen passiert über 14 Tage etwas ---');
  db.reservePurchase(G, U, billig.id, 1);
  db.reservePurchase(G, U, mittel.id, 1);
  db.setCondition(G, U, billig.id, 100);
  db.setCondition(G, U, mittel.id, 100);

  let sawSomething = false;
  for (let run = 0; run < 25 && !sawSomething; run++) {
    db.setStreetWatch(G, U, Date.now() - 14 * street.DAY_MS);
    const r = await street.settle(G, U, Date.now());
    if (r.events.length) sawSomething = true;
    // Für den nächsten Versuch zurücksetzen.
    if (!db.getOwned(G, U, billig.id)) db.reservePurchase(G, U, billig.id, 1);
    if (!db.getOwned(G, U, mittel.id)) db.reservePurchase(G, U, mittel.id, 1);
    db.setCondition(G, U, billig.id, 100);
    db.setCondition(G, U, mittel.id, 100);
  }
  check('über viele Nächte passiert irgendwann etwas', sawSomething);

  console.log('--- Ereignisse sind wohlgeformt ---');
  // Erzwungenes Szenario mit garantiertem Schaden.
  const realRandom = Math.random;
  Math.random = () => 0;   // 0 < jede Chance -> Diebstahl greift zuerst
  db.setStreetWatch(G, U, Date.now() - 1 * street.DAY_MS);
  const forced = await street.settle(G, U, Date.now());
  Math.random = realRandom;

  check('Ereignisse erzeugt', forced.events.length > 0, JSON.stringify(forced).slice(0, 120));
  check('alle Ereignisse haben einen Typ',
    forced.events.every((e) => ['theft', 'damage', 'scratch'].includes(e.type)));
  check('gestohlene Autos sind weg',
    forced.events.filter((e) => e.type === 'theft')
      .every((e) => !db.carsByValue(G, U).some((c) => c.name === e.name)));

  const text = street.summarize(forced, '🪙');
  check('Zusammenfassung ist Text', typeof text === 'string' && text.length > 0);
  check('leere Ereignisse -> keine Meldung',
    street.summarize({ events: [], days: 1 }, '🪙') === null);

  console.log('--- Garage enthält nur Autos ---');
  const lizenz = db.createItem({
    guildId: G, name: 'Testlizenz', price: 9000, kind: 'gear', stock: null, createdBy: 't',
  });
  db.reservePurchase(G, U, lizenz.id, 1);
  const wohnung = db.createItem({
    guildId: G, name: 'Testwohnung', price: 40000, kind: 'property',
    stock: 2, garage: 1, rent: 90, createdBy: 't',
  });
  db.reservePurchase(G, U, wohnung.id, 1);

  const inGarage = [];
  const firstPage = db.listInventory(G, U, 1);
  for (let p = 1; p <= firstPage.totalPages; p++) {
    inGarage.push(...db.listInventory(G, U, p).items);
  }
  check('keine Ausrüstung in der Garage',
    !inGarage.some((i) => i.kind === 'gear'),
    inGarage.filter((i) => i.kind === 'gear').map((i) => i.name).join());
  check('keine Immobilien in der Garage',
    !inGarage.some((i) => i.kind === 'property'),
    inGarage.filter((i) => i.kind === 'property').map((i) => i.name).join());
  check('nur Autos gezählt',
    inGarage.every((i) => i.kind === 'car') && inGarage.length === firstPage.total);

  const carsWorth = db.carsByValue(G, U)
    .reduce((s, c) => s + cond.currentValue(c.price, c.condition ?? 100), 0);
  check('Gesamtwert zählt nur Autos', db.garageValue(G, U) === carsWorth,
    `${db.garageValue(G, U)} vs ${carsWorth}`);
  check('teuerstes Fahrzeug ist ein Auto',
    db.getMostValuable(G, U)?.kind === 'car', db.getMostValuable(G, U)?.name);
  check('Ausrüstung erscheint in der Ausrüstungsübersicht',
    db.ownedOfKind(G, U, 'gear').some((g) => g.name === 'Testlizenz'));
  check('Immobilie erscheint bei den Immobilien',
    db.listOwnedProperties(G, U).some((p) => p.name === 'Testwohnung'));

  console.log('--- Zustand kann nicht unter 0 fallen ---');
  db.reservePurchase(G, U, billig.id, 1);
  db.setCondition(G, U, billig.id, 2);
  Math.random = () => 0.99;  // kein Diebstahl, kein Schaden, kein Kratzer
  db.setStreetWatch(G, U, Date.now() - 14 * street.DAY_MS);
  await street.settle(G, U, Date.now());
  Math.random = realRandom;
  const after = db.getOwned(G, U, billig.id);
  check('Zustand bleibt im gültigen Bereich',
    !after || (after.condition >= 0 && after.condition <= 100),
    String(after?.condition));

  cleanup();
  console.log(`\n${pass} bestanden, ${fail} fehlgeschlagen`);
  process.exit(fail === 0 ? 0 : 1);
})();
