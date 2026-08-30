/**
 * Tests für die Geld-Rangliste (!top).
 *
 * Anders als !work oder !rob lässt sich die Rangliste über die
 * UnbelievaBoat-API wirklich LESEN – sie wird also nicht nachgebaut, sondern
 * geholt. Ergänzt wird sie um die Fluxer-Spieler ohne Verknüpfung, deren Geld
 * im lokalen Wallet liegt und die UnbelievaBoat gar nicht kennt.
 *
 * Aufruf: npm run test:toplist
 */
process.env.WORLD_ID = 'TESTWORLD_TOP';

const db = require('../src/db');
const unb = require('../src/unb');
const wallet = require('../src/wallet');
const identity = require('../src/identity');
const toplist = require('../src/toplist');

const W = identity.world();
let pass = 0, fail = 0;
const check = (label, ok, extra = '') => {
  if (ok) { pass++; console.log(`  ✅ ${label}`); }
  else { fail++; console.log(`  ❌ ${label} ${extra}`); }
};

// UnbelievaBoat nachstellen – der Test darf kein Netz brauchen (§12).
const remote = [
  { user_id: '111111111111111111', cash: 1000, bank: 9000, total: 10000 },
  { user_id: '222222222222222222', cash: 5000, bank: 0, total: 5000 },
  { user_id: '333333333333333333', cash: 100, bank: 400, total: 500 },
];
let lastQuery = null;
unb.leaderboard = async (q) => { lastQuery = q; return remote.map((u) => ({ ...u })); };

(async () => {
  console.log('--- Sortierung verstehen ---');
  check('Standard ist Gesamtvermögen', toplist.parseSort(undefined) === 'total');
  check('"bar" meint Bargeld', toplist.parseSort('bar') === 'cash');
  check('"konto" meint Bank', toplist.parseSort('konto') === 'bank');
  check('Unbekanntes fällt auf Gesamt zurück', toplist.parseSort('quatsch') === 'total');

  console.log('--- Liste von UnbelievaBoat ---');
  const top = await toplist.fetch({ limit: 10 });
  check('alle Einträge kommen an', top.length >= 3, String(top.length));
  check('Sortierwunsch wird durchgereicht', lastQuery?.sort === 'total');
  check('absteigend nach Vermögen',
    top[0].total >= top[1].total && top[1].total >= top[2].total);
  check('Ränge sind fortlaufend', top.every((e, i) => e.rank === i + 1));
  check('Discord-Konten sind nicht als lokal markiert',
    top.filter((e) => e.userId.startsWith('1')).every((e) => e.local === false));

  console.log('--- Nach Bargeld sortiert ---');
  const byCash = await toplist.fetch({ sort: 'cash', limit: 10 });
  check('Bargeld-Sortierung greift', byCash[0].cash >= byCash[1].cash,
    `${byCash[0].cash} vs ${byCash[1].cash}`);
  check('der Reichste kann ein anderer sein',
    byCash[0].userId === '222222222222222222', byCash[0].userId);

  console.log('--- Fluxer-Spieler ohne Verknüpfung erscheinen mit ---');
  const fx = 'fx:EINSAMER';
  await wallet.getBalance(W, fx);
  await wallet.changeCash(W, fx, 7000, 'Testaufbau');   // ergibt 9500
  const merged = await toplist.fetch({ limit: 10 });
  const entry = merged.find((e) => e.userId === fx);
  check('lokaler Spieler steht in der Liste', Boolean(entry), merged.map((e) => e.userId).join());
  check('und ist als lokal gekennzeichnet', entry?.local === true);
  check('er ist richtig einsortiert',
    merged.findIndex((e) => e.userId === fx) < merged.findIndex((e) => e.userId === '222222222222222222'),
    `Platz ${entry?.rank}`);

  console.log('--- Verknüpfte tauchen nicht doppelt auf ---');
  // Ein Discord-Konto mit lokaler Wallet-Leiche (nach Verknüpfung geleert).
  await wallet.getBalance(W, '111111111111111111');
  const ids = (await toplist.fetch({ limit: 20 })).map((e) => e.userId);
  check('jede ID nur einmal', new Set(ids).size === ids.length, ids.join());

  console.log('--- Leere Wallets werden übersprungen ---');
  const leer = 'fx:LEER';
  db.getWallet(W, leer, 0);
  const ohneLeere = await toplist.fetch({ limit: 20 });
  check('Konto ohne Geld erscheint nicht',
    !ohneLeere.some((e) => e.userId === leer));

  console.log('--- Grenze wird eingehalten ---');
  const kurz = await toplist.fetch({ limit: 2 });
  check('nur so viele wie gewünscht', kurz.length === 2, String(kurz.length));

  console.log('--- Ohne UnbelievaBoat bricht nichts ---');
  unb.leaderboard = async () => { throw new Error('kein Token'); };
  const nurLokal = await toplist.fetch({ limit: 10 });
  check('lokale Spieler bleiben sichtbar',
    nurLokal.some((e) => e.userId === fx), JSON.stringify(nurLokal).slice(0, 80));
  check('kein Absturz', Array.isArray(nurLokal));

  console.log('--- Beschriftung ---');
  identity.remember('111111111111111111', 'Kevin');
  check('gemerkter Name wird bevorzugt', toplist.label('111111111111111111').includes('Kevin'));
  check('sonst eine Erwähnung', toplist.label('444444444444444444') === '<@444444444444444444>');

  console.log(`\n${pass} bestanden, ${fail} fehlgeschlagen`);
  process.exit(fail === 0 ? 0 : 1);
})();
