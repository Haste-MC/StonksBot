/**
 * Tests für NPC-Interessenten, Postfach und Rechnungen.
 *
 * Schwerpunkt: die Obergrenze. Ein NPC darf niemals mehr als den Zeitwert
 * zahlen, sonst wäre das System ein Gelddrucker.
 *
 * Aufruf: npm run test:buyers
 */
const db = require('../src/db');
const buyers = require('../src/buyers');
const bills = require('../src/bills');
const cond = require('../src/condition');
const unb = require('../src/unb');

const G = 'TESTGUILD11';
const U = 'TESTUSER';
let pass = 0, fail = 0;

const check = (label, ok, extra = '') => {
  if (ok) { pass++; console.log(`  ✅ ${label}`); }
  else { fail++; console.log(`  ❌ ${label} ${extra}`); }
};
const cleanup = () => {
  db.expireMessages(G, Date.now() + 1e12);
  for (const m of db.listMessages(G, U, 1).items) db.resolveMessage(G, m.id, 'expired');
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

(async () => {
  console.log('--- Kaufkurve ---');
  check('bei Zeitwert kauft niemand', buyers.saleChancePerDay(1.0) === 0);
  check('über Zeitwert kauft niemand', buyers.saleChancePerDay(1.5) === 0);
  check('deutlich darüber ebenso', buyers.saleChancePerDay(10) === 0);
  check('billig verkauft sich schnell', buyers.saleChancePerDay(0.35) > 0.8,
    String(buyers.saleChancePerDay(0.35)));
  check('Kurve fällt monoton', [0.4, 0.6, 0.8, 0.95].every((r, i, a) =>
    i === 0 || buyers.saleChancePerDay(r) < buyers.saleChancePerDay(a[i - 1])));
  check('nie über 100 %', [0, 0.1, 0.35, 0.5].every((r) => buyers.saleChancePerDay(r) <= 1));

  console.log('--- Angebotskurve ---');
  check('bei Dumpingpreis kaum Verhandlung', buyers.offerChancePerDay(0.4) === 0);
  check('bei hohem Preis wird gehandelt', buyers.offerChancePerDay(1.4) > 0.2,
    String(buyers.offerChancePerDay(1.4)));
  check('Angebote gibt es auch über der Kaufgrenze', buyers.offerChancePerDay(3) > 0);

  console.log('--- OBERGRENZE: Angebote nie über Zeitwert ---');
  let maxRatio = 0;
  for (let i = 0; i < 20000; i++) {
    const worth = 10000;
    // Auch bei absurden Forderungen darf das Gebot den Zeitwert nicht übersteigen.
    const asking = worth * (0.5 + Math.random() * 20);
    const amount = buyers.offerAmount(asking, worth);
    maxRatio = Math.max(maxRatio, amount / worth);
    if (amount > worth) { fail++; console.log(`  ❌ Angebot ${amount} > Zeitwert ${worth}`); break; }
  }
  check(`20.000 Gebote bleiben unter dem Zeitwert (max ${(maxRatio * 100).toFixed(1)} %)`,
    maxRatio <= 1.0);
  check('Gebote liegen immer unter der Forderung', (() => {
    for (let i = 0; i < 5000; i++) {
      const asking = 1000 + Math.random() * 50000;
      if (buyers.offerAmount(asking, 1e9) >= asking) return false;
    }
    return true;
  })());

  console.log('--- Zeitwert-Berechnung ---');
  check('Auto: Zustand zählt',
    buyers.worthOf({ kind: 'car', price: 10000, listing_condition: 50 })
      === cond.currentValue(10000, 50));
  check('Immobilie: Listenpreis',
    buyers.worthOf({ kind: 'property', price: 80000 }) === 80000);

  console.log('--- Überteuertes Inserat wird nicht gekauft ---');
  const auto = db.createItem({
    guildId: G, name: 'Kaufauto', price: 20000, kind: 'car', stock: null, createdBy: 't',
  });
  db.reservePurchase(G, U, auto.id, 1);

  // Zehnfacher Zeitwert – der klassische Exploit-Versuch.
  const greedy = db.createListing(G, U, auto.id, 200000);
  db.touchListing(G, greedy.listing.id, Date.now() - 60 * buyers.DAY_MS);

  const cashBefore = balanceOf(U).cash;
  const result = await buyers.settleListings(G, U);
  check('nach 60 Tagen kein Käufer', result.sold.length === 0, JSON.stringify(result.sold));
  check('kein Geld geflossen', balanceOf(U).cash === cashBefore);
  check('Inserat besteht weiter', db.getListing(G, greedy.listing.id) !== null);

  const highOffers = db.listMessages(G, U, 1).items.filter((m) => m.type === 'offer');
  check('es kamen aber Gebote', highOffers.length > 0, String(highOffers.length));
  check('jedes Gebot unter dem Zeitwert',
    highOffers.every((m) => m.amount <= cond.currentValue(20000, 100)),
    highOffers.map((m) => m.amount).join());

  console.log('--- Angebot annehmen bringt höchstens den Zeitwert ---');
  const offer = highOffers[0];
  const before = balanceOf(U).cash;
  const accepted = await buyers.acceptOffer(G, U, offer.id);
  check('Annahme klappt', accepted.ok === true, JSON.stringify(accepted).slice(0, 120));
  check('Erlös entspricht dem Gebot', balanceOf(U).cash === before + offer.amount);
  check('Erlös unter Neupreis', offer.amount < 20000, String(offer.amount));
  check('Auto ist weg', db.getOwned(G, U, auto.id) === null);
  check('Inserat aufgelöst', db.getListing(G, greedy.listing.id) === null);
  check('Nachricht abgeschlossen', db.getMessage(G, offer.id).resolved === 'accepted');
  check('andere Gebote zum selben Inserat verfallen',
    db.listMessages(G, U, 1).items.every((m) => m.listing_id !== greedy.listing.id));

  console.log('--- Günstiges Inserat findet Käufer ---');
  const auto2 = db.createItem({
    guildId: G, name: 'Billigauto', price: 30000, kind: 'car', stock: null, createdBy: 't',
  });
  db.reservePurchase(G, U, auto2.id, 1);
  const cheap = db.createListing(G, U, auto2.id, 12000);   // 40 % vom Zeitwert
  db.touchListing(G, cheap.listing.id, Date.now() - 5 * buyers.DAY_MS);

  const cashBefore2 = balanceOf(U).cash;
  const sold = await buyers.settleListings(G, U);
  check('wird verkauft', sold.sold.length === 1, JSON.stringify(sold.sold));
  check('zum geforderten Preis', balanceOf(U).cash === cashBefore2 + 12000,
    String(balanceOf(U).cash - cashBefore2));
  check('Inserat verschwunden', db.getListing(G, cheap.listing.id) === null);
  check('Verkaufsmeldung im Postfach',
    db.listMessages(G, U, 1).items.some((m) => m.type === 'sold'));

  console.log('--- Wiederholtes Aufrufen bringt nichts ---');
  const auto3 = db.createItem({
    guildId: G, name: 'Wiederholauto', price: 10000, kind: 'car', stock: null, createdBy: 't',
  });
  db.reservePurchase(G, U, auto3.id, 1);
  db.createListing(G, U, auto3.id, 4000);
  const cash3 = balanceOf(U).cash;
  for (let i = 0; i < 30; i++) await buyers.settleListings(G, U);
  check('30 Aufrufe ohne Zeitablauf ändern nichts', balanceOf(U).cash === cash3,
    String(balanceOf(U).cash - cash3));

  console.log('--- Angebot ablehnen ---');
  const auto4 = db.createItem({
    guildId: G, name: 'Ablehnauto', price: 50000, kind: 'car', stock: null, createdBy: 't',
  });
  db.reservePurchase(G, U, auto4.id, 1);
  const listing4 = db.createListing(G, U, auto4.id, 90000);
  db.touchListing(G, listing4.listing.id, Date.now() - 30 * buyers.DAY_MS);
  await buyers.settleListings(G, U);

  const toDecline = db.listMessages(G, U, 1).items
    .find((m) => m.type === 'offer' && m.listing_id === listing4.listing.id);
  if (toDecline) {
    const declined = buyers.declineOffer(G, U, toDecline.id);
    check('Ablehnen klappt', declined.ok === true);
    check('Nachricht abgeschlossen', db.getMessage(G, toDecline.id).resolved === 'declined');
    check('Inserat läuft weiter', db.getListing(G, listing4.listing.id) !== null);
    check('erneutes Ablehnen scheitert',
      buyers.declineOffer(G, U, toDecline.id).reason === 'already_resolved');
  }

  console.log('--- Abgelaufene Angebote ---');
  const stale = db.createMessage({
    guildId: G, userId: U, type: 'offer', title: 'Altes Angebot',
    amount: 100, listingId: 999999, expiresAt: Date.now() - 1000,
  });
  db.expireMessages(G);
  check('läuft ab', db.getMessage(G, stale.id).resolved === 'expired');
  check('Annahme scheitert',
    (await buyers.acceptOffer(G, U, stale.id)).reason === 'already_resolved');

  console.log('--- Rechnungen ---');
  const bill = bills.create({
    guildId: G, userId: U, title: 'Testrechnung', body: 'Zur Zahlung fällig.',
    sender: 'Finanzamt', amount: 5000,
  });
  check('Rechnung liegt im Postfach',
    db.listMessages(G, U, 1).items.some((m) => m.id === bill.id && m.type === 'bill'));

  const beforePay = balanceOf(U).cash;
  const paid = await bills.pay(G, U, bill.id);
  check('bezahlen klappt', paid.ok === true, JSON.stringify(paid).slice(0, 100));
  check('Betrag abgebucht', balanceOf(U).cash === beforePay - 5000);
  check('als bezahlt markiert', db.getMessage(G, bill.id).resolved === 'paid');
  check('zweimal zahlen scheitert',
    (await bills.pay(G, U, bill.id)).reason === 'already_resolved');

  console.log('--- Rechnung ohne Deckung ---');
  const huge = bills.create({
    guildId: G, userId: U, title: 'Riesenrechnung', amount: 99999999, sender: 'X',
  });
  const denied = await bills.pay(G, U, huge.id);
  check('wird abgelehnt', denied.ok === false && denied.reason === 'insufficient_funds');
  check('bleibt offen', db.getMessage(G, huge.id).resolved === null);

  console.log('--- Mahnung ---');
  const overdue = bills.create({
    guildId: G, userId: U, title: 'Überfällig', amount: 1000, sender: 'Y', dueDays: -1,
  });
  const dunned = bills.dun(G, U);
  check('wird gemahnt', dunned.some((d) => d.original.id === overdue.id),
    JSON.stringify(dunned.map((d) => d.original.title)));
  const reminder = dunned.find((d) => d.original.id === overdue.id);
  check('Mahngebühr aufgeschlagen', reminder.reminder.amount > 1000,
    String(reminder.reminder.amount));
  check('Gebühr entspricht dem Satz',
    reminder.fee === Math.round(1000 * bills.LATE_FEE), String(reminder.fee));
  check('Original abgeschlossen', db.getMessage(G, overdue.id).resolved === 'expired');

  console.log('--- Postfach zählt ungelesen ---');
  const unread = db.countUnread(G, U);
  check('ungelesene werden gezählt', unread >= 0, String(unread));
  db.markMessagesRead(G, U);
  check('nach dem Lesen null', db.countUnread(G, U) === 0);

  cleanup();
  console.log(`\n${pass} bestanden, ${fail} fehlgeschlagen`);
  process.exit(fail === 0 ? 0 : 1);
})();
