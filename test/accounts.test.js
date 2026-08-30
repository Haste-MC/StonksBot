/**
 * Tests für Cross-Progression: Kontoverknüpfung und Zusammenführung.
 *
 * Schwerpunkt ist Datensicherheit. Wenn ein Fluxer-Spieler sich mit seinem
 * Discord-Konto verknüpft, darf NICHTS verloren gehen – und es darf auch kein
 * Geld aus dem Nichts entstehen.
 *
 * Aufruf: npm run test:accounts
 */
process.env.WORLD_ID = 'TESTWORLD_ACC';

const db = require('../src/db');
const identity = require('../src/identity');
const accounts = require('../src/accounts');
const wallet = require('../src/wallet');
const unb = require('../src/unb');

const W = identity.world();
let pass = 0, fail = 0;
const check = (label, ok, extra = '') => {
  if (ok) { pass++; console.log(`  ✅ ${label}`); }
  else { fail++; console.log(`  ❌ ${label} ${extra}`); }
};

let n = 0;
const fresh = () => `FX${Date.now()}_${n++}`;
const DISCORD = '498875863496916995';

const cleanup = () => {
  for (const k of ['car', 'gear', 'property']) {
    for (const i of db.allItemsOfKind(W, k)) db.deleteItem(W, i.id);
  }
};
cleanup();

(async () => {
  console.log('--- Identität ---');
  const fx = fresh();
  check('Discord-Nutzer behält seine rohe ID (Fortschritt bleibt)',
    identity.account('discord', DISCORD) === DISCORD);
  check('ungelinkter Fluxer-Nutzer bekommt eigenes Konto',
    identity.account('fluxer', fx) === `fx:${fx}`);
  check('Discord-Konto wird als solches erkannt', identity.isDiscordAccount(DISCORD));
  check('Fluxer-Konto wird als solches erkannt', !identity.isDiscordAccount(`fx:${fx}`));
  check('alle Server teilen eine Welt', identity.world() === W);

  console.log('--- Ungültige Eingaben ---');
  check('Unsinn wird abgelehnt', (await accounts.link('fluxer', fx, 'hallo')).reason === 'bad_id');
  check('zu kurze ID wird abgelehnt', (await accounts.link('fluxer', fx, '123')).reason === 'bad_id');
  check('nach Fehlversuch weiterhin ungelinkt', !identity.isLinked('fluxer', fx));

  console.log('--- Verknüpfen zieht den Spielstand mit ---');
  const auto = db.createItem({
    guildId: W, name: 'Merge-Auto', price: 10000, kind: 'car', stock: null, createdBy: 't',
  });
  const haus = db.createItem({
    guildId: W, name: 'Merge-Haus', price: 50000, kind: 'property', stock: 5, garage: 2, rent: 100, createdBy: 't',
  });

  const player = fresh();
  const old = identity.account('fluxer', player);
  // Fluxer-Spieler baut sich etwas auf.
  db.reservePurchase(W, old, auto.id, 1);
  db.setCondition(W, old, auto.id, 77);
  db.reservePurchase(W, old, haus.id, 1);
  db.addStats(W, old, { xp: 500, income: 9000, expense: 4000 });
  db.addLoot(W, old, 'Vase', 2000, 'rare', 'normal');
  db.createMessage({ guildId: W, userId: old, type: 'info', title: 'Alte Nachricht' });
  await wallet.getBalance(W, old);
  await wallet.changeCash(W, old, 7500, 'Verdienst');
  const localBefore = (await wallet.getBalance(W, old)).total;

  // Das Discord-Konto hat auch schon etwas.
  db.addStats(W, DISCORD, { xp: 100, income: 1000, expense: 0 });
  // Beide Stände exakt festhalten – die Summe muss hinterher stimmen.
  const before = db.getStats(W, DISCORD);
  const oldStats = db.getStats(W, old);

  const res = await accounts.link('fluxer', player, DISCORD);
  check('Verknüpfung klappt', res.ok === true, JSON.stringify(res).slice(0, 120));
  check('Konto ist jetzt das Discord-Konto',
    identity.account('fluxer', player) === DISCORD);

  console.log('--- Nichts geht verloren ---');
  check('Auto ist übernommen', db.getOwned(W, DISCORD, auto.id) !== null);
  check('Zustand des Autos bleibt erhalten',
    db.getOwned(W, DISCORD, auto.id)?.condition === 77,
    String(db.getOwned(W, DISCORD, auto.id)?.condition));
  check('Immobilie ist übernommen', db.getOwned(W, DISCORD, haus.id) !== null);
  check('Fundstück ist übernommen',
    db.listLoot(W, DISCORD).some((l) => l.name === 'Vase'));
  check('Seltenheit des Fundstücks bleibt',
    db.listLoot(W, DISCORD).find((l) => l.name === 'Vase')?.rarity === 'rare');
  check('Postfach-Nachricht ist übernommen',
    db.listMessages(W, DISCORD, 1).items.some((m) => m.title === 'Alte Nachricht'));
  check('Erfahrung wird addiert (nicht überschrieben)',
    db.getStats(W, DISCORD).xp === before.xp + oldStats.xp,
    `${db.getStats(W, DISCORD).xp} vs ${before.xp + oldStats.xp}`);
  check('Einnahmen werden addiert',
    db.getStats(W, DISCORD).income_total === before.income_total + oldStats.income_total,
    `${db.getStats(W, DISCORD).income_total} vs ${before.income_total + oldStats.income_total}`);
  check('Ausgaben werden addiert',
    db.getStats(W, DISCORD).expense_total === before.expense_total + oldStats.expense_total);
  check('altes Konto ist leergeräumt',
    db.getOwned(W, old, auto.id) === null && db.listLoot(W, old).length === 0);

  console.log('--- Geld: kein Verlust, keine Vermehrung ---');
  check('Zwischenguthaben wurde mitgenommen', res.carried === localBefore,
    `${res.carried} vs ${localBefore}`);
  check('altes Wallet ist leer', (await wallet.getBalance(W, old)).total === 0);
  // Der Übertrag darf die Einnahmen NICHT erhöhen: Das Geld wurde bereits
  // beim Verdienen gezählt. Sonst gäbe es Erfahrung doppelt.
  check('Übertrag zählt NICHT als zusätzliche Einnahme',
    db.getStats(W, DISCORD).income_total === before.income_total + oldStats.income_total,
    `${db.getStats(W, DISCORD).income_total}, Übertrag war ${res.carried}`);
  check('Übertrag gibt auch keine zusätzliche Erfahrung',
    db.getStats(W, DISCORD).xp === before.xp + oldStats.xp);

  console.log('--- Schulden wandern mit (kein Geld aus dem Nichts) ---');
  const debtor = fresh();
  const debtAccount = identity.account('fluxer', debtor);
  const DISCORD2 = '111111111111111111';
  await wallet.getBalance(W, debtAccount);
  await wallet.changeCash(W, debtAccount, -(wallet.START_CASH + 1000), 'Überziehung');
  const owed = (await wallet.getBalance(W, debtAccount)).total;
  check('Spieler ist im Minus', owed === -1000, String(owed));
  const debtRes = await accounts.link('fluxer', debtor, DISCORD2);
  check('Schuld wird übernommen, nicht erlassen', debtRes.carried === -1000,
    String(debtRes.carried));
  check('altes Konto danach ausgeglichen',
    (await wallet.getBalance(W, debtAccount)).total === 0);
  accounts.unlink('fluxer', debtor);

  console.log('--- Wiederholtes Verknüpfen ---');
  const again = await accounts.link('fluxer', player, DISCORD);
  check('zweites Mal wird abgewiesen', !again.ok && again.reason === 'already_linked');
  check('Besitz bleibt unverändert', db.getOwned(W, DISCORD, auto.id) !== null);

  console.log('--- Status und Aufheben ---');
  const st = accounts.status('fluxer', player);
  check('Status meldet verknüpft', st.linked === true && st.account === DISCORD);
  check('Aufheben klappt', accounts.unlink('fluxer', player).ok === true);
  check('danach wieder eigenes Konto',
    identity.account('fluxer', player) === `fx:${player}`);
  check('Fortschritt bleibt beim Discord-Konto', db.getOwned(W, DISCORD, auto.id) !== null);
  check('Aufheben ohne Verknüpfung scheitert',
    accounts.unlink('fluxer', fresh()).ok === false);

  console.log('--- Geldquelle richtet sich nach dem Konto ---');
  check('Discord-Konto läuft über UnbelievaBoat (wenn eingerichtet)',
    unb.viaUnb(DISCORD) === Boolean(unb.UNB_GUILD && process.env.UNB_TOKEN));
  check('Fluxer-Konto läuft nie über UnbelievaBoat', unb.viaUnb('fx:egal') === false);

  console.log('--- Admin ---');
  check('ohne Eintrag in BOT_ADMINS kein Admin', accounts.isAdmin('irgendwer') === false);

  cleanup();
  console.log(`\n${pass} bestanden, ${fail} fehlgeschlagen`);
  process.exit(fail === 0 ? 0 : 1);
})();
