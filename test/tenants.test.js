/**
 * Tests für NPC-Mieter bei Spieler-Vermietern.
 *
 * Schwerpunkt: die Miet-Obergrenze. NPCs ziehen nur bei fairer Miete ein –
 * kein Gelddrucker über überteuerte Angebote.
 *
 * Aufruf: npm run test:tenants
 */
const db = require('../src/db');
const tenants = require('../src/tenants');
const property = require('../src/property');
const unb = require('../src/unb');

const G = 'TESTGUILD12';
const LL = 'VERMIETER';
let pass = 0, fail = 0;

const check = (label, ok, extra = '') => {
  if (ok) { pass++; console.log(`  ✅ ${label}`); }
  else { fail++; console.log(`  ❌ ${label} ${extra}`); }
};
const cleanup = () => {
  for (const r of db.tenantsOf(G, LL)) db.endRental(G, r.user_id);
  db.endRental(G, LL);
  for (const m of db.listMessages(G, LL, 1).items) db.resolveMessage(G, m.id, 'expired');
  for (const k of ['car', 'gear', 'property']) {
    for (const i of db.allItemsOfKind(G, k)) db.deleteItem(G, i.id);
  }
};

const wallet = {};
const balanceOf = (u) => (wallet[u] ??= { cash: 1000000, bank: 0, total: 1000000 });
unb.getBalance = async (g, u) => ({ ...balanceOf(u) });
unb.changeCash = async (g, u, a) => {
  const b = balanceOf(u); b.cash += a; b.total = b.cash + b.bank; return { ...b };
};
unb.withdrawFromBank = async (g, u, a) => {
  const b = balanceOf(u); b.cash += a; b.bank -= a; b.total = b.cash + b.bank; return { ...b };
};

cleanup();

/** Legt eine Immobilie im Besitz des Vermieters an und bietet sie zur Miete an. */
function offerAt(price, catalogRent = 300, garage = 2) {
  const item = db.createItem({
    guildId: G, name: `Mietobjekt ${price}/${Math.random()}`, price: catalogRent * 350,
    kind: 'property', stock: 3, garage, rent: catalogRent, createdBy: 't',
  });
  db.reservePurchase(G, LL, item.id, 1);
  const res = property.offerForRent(G, LL, item.id, price);
  return { item, offer: res.offer };
}

(async () => {
  console.log('--- Einzugskurve ---');
  check('faire Miete lockt Mieter', tenants.moveInChancePerDay(1.0) > 0);
  check('billige Miete lockt stärker',
    tenants.moveInChancePerDay(0.6) > tenants.moveInChancePerDay(1.0));
  check('bei 1,5× Miete noch möglich', tenants.moveInChancePerDay(1.5) >= 0);
  check('über 1,5× zieht niemand ein', tenants.moveInChancePerDay(1.6) === 0);
  check('bei 10× erst recht nicht', tenants.moveInChancePerDay(10) === 0);

  console.log('--- Auszugskurve ---');
  check('faire Miete: Mieter bleibt eher',
    tenants.moveOutChancePerDay(1.0) < tenants.moveOutChancePerDay(1.5));
  check('Auszugschance immer positiv', tenants.moveOutChancePerDay(1.0) > 0);

  console.log('--- Fairer Preis: NPC zieht ein und zahlt ---');
  const fair = offerAt(300, 300);
  db.touchOffer(G, fair.offer.id, Date.now() - 40 * tenants.DAY_MS);

  const before = balanceOf(LL).cash;
  // Deterministisch: alles zieht ein, keiner zieht aus.
  const always = () => 0;      // 0 < jede Einzugschance, 0 < jede Auszugschance ⇒ zieht ein UND wieder aus
  // Für "zieht ein und bleibt" brauchen wir Einzug ja, Auszug nein.
  let calls = 0;
  const moveInStay = () => { calls++; return calls === 1 ? 0 : 0.99; }; // Tag 1 Einzug, danach kein Auszug/Einzug

  const r1 = await tenants.settleLandlord(G, LL, Date.now(), moveInStay);
  check('ein NPC ist eingezogen', r1.movedIn.length === 1, JSON.stringify(r1.movedIn));
  check('Mieteinnahmen geflossen', r1.income > 0, String(r1.income));
  check('Geld beim Vermieter angekommen', balanceOf(LL).cash === before + r1.income);
  const tenant = db.tenantOfOffer(G, fair.item.id, LL);
  check('NPC als Mieter eingetragen', tenant && tenants.isNpcTenant(tenant.user_id));
  check('Mietername gesetzt', tenant && tenant.tenant_name.length > 0);
  check('Objekt gilt als belegt', db.offerTaken(G, fair.item.id, LL) === true);
  check('Einzugs-Nachricht im Postfach',
    db.listMessages(G, LL, 1).items.some((m) => m.type === 'info' && m.title.includes('Neuer Mieter')));

  console.log('--- Vermieter verliert die Garage an den NPC ---');
  const cap = property.capacity(G, LL);
  check('Stellplätze des Objekts weg', cap.owned === 0, JSON.stringify(cap));

  console.log('--- NPC zieht wieder aus ---');
  // Genau ein Tag, damit der NPC an diesem Tag auszieht und nicht direkt
  // wieder einzieht (Ein- und Auszug teilen sich denselben Wurf pro Tag).
  db.touchOffer(G, fair.offer.id, Date.now() - Math.floor(1.5 * tenants.DAY_MS));
  const moveOut = () => 0;      // 0 < Auszugschance ⇒ zieht aus
  const r2 = await tenants.settleLandlord(G, LL, Date.now(), moveOut);
  check('NPC ausgezogen', r2.movedOut.length === 1, JSON.stringify(r2.movedOut));
  check('Objekt wieder frei', db.offerTaken(G, fair.item.id, LL) === false);
  check('Garage zurück beim Vermieter', property.capacity(G, LL).owned === fair.item.garage,
    JSON.stringify(property.capacity(G, LL)));
  check('Auszugs-Nachricht im Postfach',
    db.listMessages(G, LL, 1).items.some((m) => m.title.includes('Ausgezogen')));

  console.log('--- EXPLOIT: überteuerte Miete lockt niemanden ---');
  const greedy = offerAt(300000, 300);   // 1000× der marktüblichen Miete
  db.touchOffer(G, greedy.offer.id, Date.now() - 365 * tenants.DAY_MS);
  const before2 = balanceOf(LL).cash;
  const alwaysIn = () => 0;    // selbst bei garantiertem Wurf darf niemand einziehen
  const r3 = await tenants.settleLandlord(G, LL, Date.now(), alwaysIn);
  check('kein NPC bei Wuchermiete', r3.movedIn.length === 0, JSON.stringify(r3.movedIn));
  check('keine Einnahmen', r3.income === 0, String(r3.income));
  check('Geld unverändert', balanceOf(LL).cash === before2);
  check('Objekt bleibt frei', db.offerTaken(G, greedy.item.id, LL) === false);

  console.log('--- Erstprüfung holt nicht rückwirkend nach ---');
  const fresh = offerAt(300, 300);
  const before3 = balanceOf(LL).cash;
  // checked_at ist 0 (frisch) -> erster Aufruf setzt nur den Zeitpunkt.
  const r4 = await tenants.settleLandlord(G, LL, Date.now(), () => 0);
  check('erster Lauf ohne Einnahmen', r4.income === 0 && r4.movedIn.length === 0,
    JSON.stringify(r4));
  check('Geld unverändert', balanceOf(LL).cash === before3);

  console.log('--- Wiederholtes Aufrufen bringt nichts ---');
  const occupied = offerAt(300, 300);
  db.touchOffer(G, occupied.offer.id, Date.now() - 10 * tenants.DAY_MS);
  await tenants.settleLandlord(G, LL, Date.now(), moveInStay);
  const cashLocked = balanceOf(LL).cash;
  for (let i = 0; i < 20; i++) await tenants.settleLandlord(G, LL, Date.now(), () => 0.5);
  check('20 Aufrufe ohne Zeitablauf ändern nichts', balanceOf(LL).cash === cashLocked,
    String(balanceOf(LL).cash - cashLocked));

  console.log('--- EXPLOIT-Simulation: Rendite bleibt begrenzt ---');
  // Bestmögliche Strategie: fair inserieren, Dauermieter. Über 200 Tage darf
  // die Einnahme nicht den Kaufpreis sprengen (langsame Rendite, kein Glitch).
  cleanup();
  const invest = offerAt(300, 300);   // Kaufpreis 105.000
  const purchasePrice = 300 * 350;
  db.touchOffer(G, invest.offer.id, Date.now() - 200 * tenants.DAY_MS);
  const start = balanceOf(LL).cash;
  // Immer vermietet (Einzug ja, Auszug nie): maximaler Ertrag.
  const bestCase = () => 0.001;   // < Einzugschance, aber wir erzwingen Bleiben:
  // Einzug: random < moveInChance(1.0)=~0.19 -> 0.001 zieht ein
  // Auszug: random < moveOutChance(1.0)=~0.015 -> 0.001 < 0.015 -> würde ausziehen. Nicht gewollt.
  // Deshalb eigener Generator: erster Aufruf Einzug, danach Bleiben.
  let first = true;
  const stayForever = () => { if (first) { first = false; return 0; } return 0.99; };
  await tenants.settleLandlord(G, LL, Date.now(), stayForever);
  const earned = balanceOf(LL).cash - start;
  console.log(`    200 Tage Miete: ${earned.toLocaleString('de-DE')} bei Kaufpreis ${purchasePrice.toLocaleString('de-DE')}`);
  check('Ertrag über 200 Tage unter dem Kaufpreis', earned < purchasePrice,
    `${earned} vs ${purchasePrice}`);
  check('Ertrag ist aber spürbar positiv', earned > 0, String(earned));

  cleanup();
  console.log(`\n${pass} bestanden, ${fail} fehlgeschlagen`);
  process.exit(fail === 0 ? 0 : 1);
})();
