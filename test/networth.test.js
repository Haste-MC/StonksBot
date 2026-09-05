/**
 * Tests fürs Vermögen (networth.js) und die Reichen-Rangliste.
 *
 * Der Fehler, der dahintersteckt: Jede Ansicht rechnete ihr eigenes „Vermögen"
 * zusammen und ließ etwas anderes weg. Die **Sammlung aus den Auktionen** kam
 * nirgends vor, obwohl dort bei manchen 50.000 liegen, und das Depot fehlte in
 * der Rangliste. Deshalb hier: eine Rechnung, alle Bestandteile, und ein
 * Ranking, in dem jeder auftaucht, der irgendetwas besitzt.
 *
 * Aufruf: node test/networth.test.js
 */
// Eigene Welt je Lauf – sonst schleppen frühere Läufe Besitz in die Rangliste.
process.env.WORLD_ID = `NW_T${Date.now()}`;

const db = require('../src/db');
const unb = require('../src/unb');
const identity = require('../src/identity');
const networth = require('../src/networth');
const toplist = require('../src/toplist');

const W = identity.world();
let pass = 0, fail = 0;
const check = (label, ok, extra = '') => {
  if (ok) { pass++; console.log(`  ✅ ${label}`); }
  else { fail++; console.log(`  ❌ ${label} ${extra}`); }
};

// Geld mocken (§8/§12: kein Netz im Test).
const balances = {
  '111111111111111111': { cash: 10_000, bank: 0, total: 10_000 },   // reich am Konto
  '222222222222222222': { cash: 0, bank: 0, total: 0 },             // arm, aber besitzt
};
unb.getBalance = async (g, u) => ({ ...(balances[u] ?? { cash: 0, bank: 0, total: 0 }) });
unb.leaderboard = async () => [
  { user_id: '111111111111111111', cash: 10_000, bank: 0, total: 10_000 },
];

const REICH = '111111111111111111';   // nur Geld
const SAMMLER = '222222222222222222'; // kein Geld, aber eine Sammlung
const FX = 'fx:HAMSTER';              // lokaler Spieler mit Auto und Depot

// Besitz aufbauen.
const auto = db.createItem({
  guildId: W, name: 'NW-Testwagen', price: 20_000, kind: 'car', stock: null, createdBy: 't' });
const haus = db.createItem({
  guildId: W, name: 'NW-Testhaus', price: 100_000, kind: 'property', stock: null, createdBy: 't' });

db.addLoot(W, SAMMLER, 'Vergessene Kiste', 50_000, 'rare');
db.grantCar(W, FX, auto.id, 100);
// grantCar legt schlicht einen Besitzeintrag an – das trägt auch Immobilien.
db.grantCar(W, FX, haus.id, 100);
db.setHolding(W, FX, 'HAST', 5, 1000);

(async () => {
  console.log('--- Die Bestandteile ---');
  const assets = networth.assetsOf(W, FX);
  const depot = require('../src/wallstreet').portfolio(W, FX).value;
  check('Autos zählen', assets.garage === 20_000, String(assets.garage));
  check('Immobilien zählen', assets.realty === 100_000, String(assets.realty));
  check('das Depot zählt', assets.depot > 0 && assets.depot === Math.round(depot),
    `${assets.depot} vs ${depot}`);
  check('die Summe stimmt',
    assets.total === assets.garage + assets.realty + assets.depot + assets.collection,
    JSON.stringify(assets));

  const samm = networth.assetsOf(W, SAMMLER);
  check('die Sammlung zählt – genau das fehlte bisher', samm.collection === 50_000,
    String(samm.collection));
  check('und steckt in der Summe', samm.total === 50_000, String(samm.total));

  console.log('--- Geld plus Besitz ---');
  const worth = await networth.of(W, REICH);
  check('Bargeld und Bank sind drin', worth.liquid === 10_000, String(worth.liquid));
  check('ohne Besitz ist Vermögen = Guthaben', worth.total === 10_000, String(worth.total));

  const armAberReich = await networth.of(W, SAMMLER);
  check('wer nichts auf dem Konto hat, ist trotzdem etwas wert',
    armAberReich.total === 50_000, String(armAberReich.total));

  console.log('--- Ein bekanntes Guthaben spart die Abfrage ---');
  let calls = 0;
  const echt = unb.getBalance;
  unb.getBalance = async (...a) => { calls++; return echt(...a); };
  await networth.of(W, REICH, { cash: 1, bank: 2, total: 3 });
  check('mit übergebener Bilanz wird nicht nachgefragt', calls === 0, String(calls));
  await networth.of(W, REICH);
  check('ohne wird nachgefragt', calls === 1, String(calls));
  unb.getBalance = echt;

  console.log('--- Fällt die Geldquelle aus, zählt wenigstens der Besitz ---');
  const kaputt = unb.getBalance;
  unb.getBalance = async () => { throw new Error('kein Token'); };
  const ohneApi = await networth.of(W, SAMMLER);
  check('kein Absturz', ohneApi.total === 50_000, String(ohneApi.total));
  check('und es ist als unbekannt markiert', ohneApi.known === false);
  unb.getBalance = kaputt;

  console.log('--- Wer besitzt überhaupt etwas? ---');
  const owners = new Set(networth.owners(W));
  check('der Sammler ist dabei', owners.has(SAMMLER));
  check('der Autobesitzer auch', owners.has(FX));
  check('wer nur Geld hat, steht hier nicht', !owners.has(REICH));

  console.log('--- Rangliste: jeder mit Geld ODER Besitz ---');
  const nachGeld = await toplist.fetch({ sort: 'total', limit: 10 });
  const nachVermoegen = await toplist.fetch({ sort: 'networth', limit: 10 });

  check('der Sammler taucht auf, obwohl sein Konto leer ist',
    nachVermoegen.some((e) => e.userId === SAMMLER),
    nachVermoegen.map((e) => e.userId).join());
  check('auch der lokale Spieler ohne UnbelievaBoat',
    nachVermoegen.some((e) => e.userId === FX));
  check('Geld allein reicht nicht mehr für Platz 1',
    nachVermoegen[0].userId === FX, JSON.stringify(nachVermoegen[0]));
  check('nach Geld sortiert führt weiterhin das dickste Konto',
    nachGeld[0].userId === REICH, nachGeld[0].userId);
  check('jede Zeile kennt ihr Vermögen',
    nachVermoegen.every((e) => e.networth === e.total + e.assets));
  check('absteigend sortiert',
    nachVermoegen.every((e, i) => i === 0 || nachVermoegen[i - 1].networth >= e.networth));
  check('Ränge sind fortlaufend', nachVermoegen.every((e, i) => e.rank === i + 1));

  console.log('--- Wer gar nichts hat, steht nicht in der Liste ---');
  const niemand = 'fx:NIEMAND';
  db.getWallet(W, niemand, 0);
  const liste = await toplist.fetch({ sort: 'networth', limit: 20 });
  check('leeres Konto ohne Besitz bleibt draußen',
    !liste.some((e) => e.userId === niemand));

  console.log('--- Schreibweisen ---');
  check('"vermögen" meint das Vermögen', toplist.parseSort('vermögen') === 'networth');
  check('"vermoegen" auch', toplist.parseSort('vermoegen') === 'networth');
  check('"bar" bleibt Bargeld', toplist.parseSort('bar') === 'cash');
  check('Unbekanntes fällt auf Gesamt zurück', toplist.parseSort('quatsch') === 'total');

  console.log('--- Die Ansichten zeigen dieselbe Zahl ---');
  const ui = require('../src/ui');
  const view = await ui.buildProfileView({ guildId: W, userId: SAMMLER });
  const embed = view.embeds[0].toJSON();
  const nwField = embed.fields.find((f) => f.name.includes('Networth'));
  check('das Profil rechnet die Sammlung mit',
    nwField && nwField.value.includes('50.000'), nwField?.value);

  const top = await ui.buildTopView({ guildId: W, userId: SAMMLER });
  check('die Rangliste nennt den Sammler',
    top.embeds[0].toJSON().description.includes('50.000'),
    top.embeds[0].toJSON().description);

  console.log(`\n${pass} bestanden, ${fail} fehlgeschlagen`);
  process.exit(fail === 0 ? 0 : 1);
})();
