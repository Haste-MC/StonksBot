/**
 * Tests für die Werkstatt.
 *
 * Schwerpunkte:
 *  - **Kein Gelddrucker** (ARCHITEKTUR §3): Eine Reparatur kostet über
 *    zufällige Preise, Zustände und Stufen IMMER mehr, als sie an Zeitwert
 *    zurückbringt. Wer repariert und danach zum Zeitwert verkauft, verliert.
 *  - **Keine Doppelbuchung** (§7): Der Zustand wird synchron gesetzt, ein
 *    zweiter Klick findet den Wagen schon repariert vor.
 *  - **Rückabwicklung** (§9): Scheitert die Geldbuchung, bleibt der alte
 *    Zustand stehen.
 *
 * Aufruf: node test/workshop.test.js
 */
const db = require('../src/db');
const cond = require('../src/condition');
const workshop = require('../src/workshop');
const unb = require('../src/unb');

const G = 'TESTGUILD_WERKSTATT';
const U = 'WERKSTATTUSER';
let pass = 0, fail = 0;

const check = (label, ok, extra = '') => {
  if (ok) { pass++; console.log(`  ✅ ${label}`); }
  else { fail++; console.log(`  ❌ ${label} ${extra}`); }
};

// Geldschnittstelle ersetzen (§8) – kein Netz, kein Token.
const wallet = { cash: 0, bank: 0, total: 0 };
const setMoney = (cash, bank = 0) => {
  wallet.cash = cash; wallet.bank = bank; wallet.total = cash + bank;
};
unb.getBalance = async () => ({ ...wallet });
unb.changeCash = async (g, u, amount) => {
  wallet.cash += amount; wallet.total = wallet.cash + wallet.bank; return { ...wallet };
};
unb.withdrawFromBank = async (g, u, amount) => {
  wallet.cash += amount; wallet.bank -= amount;
  wallet.total = wallet.cash + wallet.bank; return { ...wallet };
};

const cleanup = () => {
  for (const kind of ['car', 'gear']) {
    for (const i of db.allItemsOfKind(G, kind)) db.deleteItem(G, i.id);
  }
};

/** Legt ein Auto an und schreibt es dem Spieler im gewünschten Zustand gut. */
function giveCar(name, price, condition) {
  const item = db.createItem({
    guildId: G, name, price, kind: 'car', stock: null, createdBy: 't',
  });
  db.reservePurchase(G, U, item.id, 1);
  db.setCondition(G, U, item.id, condition);
  return item;
}

cleanup();

(async () => {
  console.log('--- Stufen ---');
  check('drei Stufen', workshop.TIERS.length === 3);
  check('Ziele steigen an',
    workshop.TIERS.every((t, i, a) => i === 0 || t.target > a[i - 1].target));
  check('Aufschlag steigt mit dem Ziel',
    workshop.TIERS.every((t, i, a) => i === 0 || t.markup > a[i - 1].markup));
  check('höchste Stufe ist Neuzustand',
    workshop.TIERS[workshop.TIERS.length - 1].target === cond.MAX);
  check('jede Stufe hat Aufschlag über 1',
    workshop.TIERS.every((t) => t.markup > 1));
  check('unbekannte Stufe -> kein Angebot', workshop.quote(1000, 10, 'gibtsnicht') === null);

  console.log('--- Kostenvoranschlag ---');
  const q = workshop.quote(20000, 20, 'resto');
  check('Ziel ist der Neuzustand', q.to === 100 && q.from === 20);
  check('Wert davor passt zu condition.js', q.before === cond.currentValue(20000, 20));
  check('Wert danach passt zu condition.js', q.after === cond.currentValue(20000, 100));
  check('Zuwachs ist die Differenz', q.gain === q.after - q.before);
  check('Preis = Zuwachs x Aufschlag + Pauschale',
    q.cost === Math.ceil(q.gain * q.tier.markup) + q.fee, `${q.cost} vs ${q.gain}`);
  check('Preis nie über dem Neupreis',
    workshop.quote(3000, 0, 'resto').cost <= 3000,
    String(workshop.quote(3000, 0, 'resto').cost));
  check('schon gut genug wird erkannt', workshop.quote(20000, 100, 'resto').possible === false);
  check('kaputter Wagen ist reparierbar', workshop.quote(20000, 0, 'clean').possible === true);
  check('teurer Wagen kostet mehr als billiger',
    workshop.quote(500000, 50, 'fix').cost > workshop.quote(5000, 50, 'fix').cost);
  check('höhere Stufe kostet mehr',
    workshop.quote(50000, 10, 'resto').cost > workshop.quote(50000, 10, 'clean').cost);

  console.log('--- Kein Gelddrucker: Kosten > Wertzuwachs ---');
  let worst = Infinity, cases = 0;
  for (let i = 0; i < 20000; i++) {
    const price = 1 + Math.floor(Math.random() * 2000000);
    const from = Math.floor(Math.random() * 101);
    const tier = workshop.TIERS[Math.floor(Math.random() * workshop.TIERS.length)];
    const est = workshop.quote(price, from, tier.id);
    if (!est.possible) continue;
    cases++;
    worst = Math.min(worst, est.cost - est.gain);
  }
  check(`${cases} Stichproben geprüft`, cases > 15000, String(cases));
  check('Reparatur ist NIE ein Geschäft (Kosten immer über dem Zuwachs)',
    worst > 0, `schlechtester Abstand: ${worst}`);

  // Der Deckel (Neupreis) darf die Regel nicht aushebeln – gerade bei
  // billigen Autos, wo die Pauschale schwer wiegt.
  let capBroken = null, overPrice = null;
  for (let price = 1; price <= 6000 && !capBroken && !overPrice; price++) {
    for (const tier of workshop.TIERS) {
      for (let from = 0; from < tier.target; from++) {
        const e = workshop.quote(price, from, tier.id);
        if (e.cost <= e.gain) capBroken = `${price}/${from}/${tier.id}`;
        if (e.cost > price) overPrice = `${price}/${from}/${tier.id}`;
      }
    }
  }
  check('auch bei billigen Autos: Kosten über dem Zuwachs', capBroken === null, String(capBroken));
  check('Rechnung nie über dem Neupreis', overPrice === null, String(overPrice));

  console.log('--- Reparatur bucht genau die Rechnung ---');
  const auto = giveCar('Werkstattauto', 40000, 30);
  const est = workshop.quote(40000, 30, 'fix');
  setMoney(1000000);
  const before = wallet.total;
  const res = await workshop.repair(G, U, auto.id, 'fix');
  check('Auftrag angenommen', res.ok === true, JSON.stringify(res).slice(0, 120));
  check('Zustand ist die Zielstufe', db.getOwned(G, U, auto.id).condition === 80,
    String(db.getOwned(G, U, auto.id).condition));
  check('genau der Kostenvoranschlag abgebucht', before - wallet.total === est.cost,
    `${before - wallet.total} vs ${est.cost}`);
  check('Garagenwert steigt auf den neuen Zeitwert',
    db.garageValue(G, U) === cond.currentValue(40000, 80), String(db.garageValue(G, U)));

  console.log('--- Vermögen sinkt trotz höherem Wagenwert ---');
  const worthBefore = cond.currentValue(40000, 30) + before;
  const worthAfter = db.garageValue(G, U) + wallet.total;
  check('Geld + Zeitwert nach der Reparatur kleiner als davor',
    worthAfter < worthBefore, `${worthAfter} vs ${worthBefore}`);

  console.log('--- Zweiter Klick bucht nicht doppelt ---');
  const cashAfter = wallet.total;
  const again = await workshop.repair(G, U, auto.id, 'fix');
  check('gleiche Stufe wird abgelehnt', again.ok === false && again.reason === 'already_good',
    JSON.stringify(again).slice(0, 100));
  check('nichts abgebucht', wallet.total === cashAfter);
  const lower = await workshop.repair(G, U, auto.id, 'clean');
  check('niedrigere Stufe verschlechtert nichts',
    lower.ok === false && db.getOwned(G, U, auto.id).condition === 80);

  console.log('--- Zu wenig Geld ---');
  const schrott = giveCar('Schrottauto', 100000, 5);
  setMoney(10);
  const broke = await workshop.repair(G, U, schrott.id, 'resto');
  check('abgelehnt', broke.ok === false && broke.reason === 'insufficient_funds',
    JSON.stringify(broke).slice(0, 100));
  check('Zustand unverändert', db.getOwned(G, U, schrott.id).condition === 5,
    String(db.getOwned(G, U, schrott.id).condition));
  check('kein Geld bewegt', wallet.total === 10);

  console.log('--- Bank wird angezapft, wenn das Bargeld nicht reicht ---');
  const teuer = workshop.quote(100000, 5, 'resto').cost;
  setMoney(100, teuer);           // fast alles liegt auf der Bank
  const fromBank = await workshop.repair(G, U, schrott.id, 'resto');
  check('Auftrag klappt trotzdem', fromBank.ok === true, JSON.stringify(fromBank).slice(0, 120));
  check('fehlender Teil kam von der Bank', fromBank.movedFromBank === teuer - 100,
    String(fromBank.movedFromBank));
  check('Vermögen sinkt um genau die Rechnung', wallet.total === 100,
    `${wallet.total} statt 100 (Rechnung ${teuer})`);

  console.log('--- Rückabwicklung, wenn die Geldbuchung scheitert ---');
  const pech = giveCar('Pechauto', 30000, 40);
  setMoney(1000000);
  const realChange = unb.changeCash;
  unb.changeCash = async () => { throw new Error('API down'); };
  let threw = false;
  try { await workshop.repair(G, U, pech.id, 'resto'); } catch { threw = true; }
  unb.changeCash = realChange;
  check('Fehler wird durchgereicht', threw);
  check('Zustand zurückgesetzt', db.getOwned(G, U, pech.id).condition === 40,
    String(db.getOwned(G, U, pech.id).condition));

  console.log('--- Nur eigene Autos ---');
  const fremd = db.createItem({
    guildId: G, name: 'Fremdauto', price: 10000, kind: 'car', stock: null, createdBy: 't',
  });
  const notMine = await workshop.repair(G, U, fremd.id, 'resto');
  check('fremdes Auto abgelehnt', notMine.ok === false && notMine.reason === 'not_owned');

  const gear = db.createItem({
    guildId: G, name: 'Werkstattschlüssel', price: 500, kind: 'gear', stock: null, createdBy: 't',
  });
  db.reservePurchase(G, U, gear.id, 1);
  const notCar = await workshop.repair(G, U, gear.id, 'resto');
  check('Ausrüstung abgelehnt', notCar.ok === false && notCar.reason === 'not_a_car',
    JSON.stringify(notCar).slice(0, 80));
  const badTier = await workshop.repair(G, U, auto.id, 'gibtsnicht');
  check('unbekannte Stufe abgelehnt', badTier.ok === false && badTier.reason === 'bad_tier');

  console.log('--- Werkstattliste zeigt nur beschädigte Autos ---');
  db.setCondition(G, U, auto.id, 100);
  db.setCondition(G, U, schrott.id, 100);
  db.setCondition(G, U, pech.id, 100);
  check('nichts kaputt -> leere Liste', db.listDamaged(G, U, 1).total === 0,
    JSON.stringify(db.listDamaged(G, U, 1).items.map((i) => i.name)));
  db.setCondition(G, U, auto.id, 70);
  db.setCondition(G, U, pech.id, 20);
  const damaged = db.listDamaged(G, U, 1);
  check('nur die beschädigten', damaged.total === 2, String(damaged.total));
  check('schlimmster zuerst', damaged.items[0].name === 'Pechauto',
    damaged.items.map((i) => i.name).join());
  check('keine Ausrüstung in der Liste',
    !damaged.items.some((i) => i.kind !== 'car'));

  console.log('--- Viele Reparaturen hintereinander erzeugen kein Geld ---');
  setMoney(50000000);
  const start = wallet.total + db.garageValue(G, U);
  for (let i = 0; i < 200; i++) {
    const cars = db.carsByValue(G, U);
    const car = cars[Math.floor(Math.random() * cars.length)];
    db.setCondition(G, U, car.id, Math.floor(Math.random() * 100));
    const worthBeforeRun = wallet.total + db.garageValue(G, U);
    const tier = workshop.TIERS[Math.floor(Math.random() * workshop.TIERS.length)];
    const r = await workshop.repair(G, U, car.id, tier.id);
    if (!r.ok) continue;
    if (wallet.total + db.garageValue(G, U) >= worthBeforeRun) {
      check('Vermögen wächst nie durch eine Reparatur', false,
        `${car.name} ${tier.id}: ${worthBeforeRun} -> ${wallet.total + db.garageValue(G, U)}`);
      break;
    }
  }
  check('Vermögen ist über 200 Aufträge gesunken',
    wallet.total + db.garageValue(G, U) < start,
    `${wallet.total + db.garageValue(G, U)} vs ${start}`);

  cleanup();
  console.log(`\n${pass} bestanden, ${fail} fehlgeschlagen`);
  process.exit(fail === 0 ? 0 : 1);
})();
