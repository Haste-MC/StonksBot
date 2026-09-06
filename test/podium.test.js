/**
 * Tests für die Treppchen-Meldung (podium.js).
 *
 * Gefeiert wird, wer auf Platz 3, 2 oder 1 der Reichsten steigt. Heikel ist
 * dabei nicht das Feiern, sondern das **Schweigen**: kein Applaus für
 * Absteiger, keiner beim allerersten Mal, und keiner, wenn zwei Spieler dicht
 * beieinander bei jedem Börsentick die Plätze tauschen.
 *
 * Aufruf: node test/podium.test.js
 */
process.env.WORLD_ID = `POD_T${Date.now()}`;

const db = require('../src/db');
const identity = require('../src/identity');
const podium = require('../src/podium');

const W = identity.world();
const HOUR = 60 * 60 * 1000;
let pass = 0, fail = 0;
const check = (label, ok, extra = '') => {
  if (ok) { pass++; console.log(`  ✅ ${label}`); }
  else { fail++; console.log(`  ❌ ${label} ${extra}`); }
};

/** Eine Rangliste, wie toplist.fetch sie liefert. */
const list = (...pairs) => pairs.map(([userId, networth], i) => ({
  userId, networth, total: networth, rank: i + 1,
}));

const A = 'fx:anton', B = 'fx:berta', C = 'fx:cem', D = 'fx:dora';
const t0 = Date.now();

(async () => {
  console.log('--- Das erste Mal wird nur gemerkt ---');
  const still = podium.check(W, list([A, 900_000], [B, 500_000], [C, 100_000]), t0);
  check('kein Glückwunsch für den Bestand', still.length === 0, JSON.stringify(still));
  check('aber das Treppchen steht', db.podiumOf(W).length === 3);
  check('und zwar richtig herum',
    db.podiumOf(W).map((r) => r.user_id).join() === [A, B, C].join(),
    db.podiumOf(W).map((r) => r.user_id).join());

  console.log('--- Ein Aufstieg wird gefeiert ---');
  const t1 = t0 + HOUR;
  const news = podium.check(W, list([B, 1_200_000], [A, 900_000], [C, 100_000]), t1);
  check('genau eine Meldung', news.length === 1, JSON.stringify(news));
  check('für den Aufsteiger', news[0]?.userId === B);
  check('auf Platz 1', news[0]?.rank === 1);
  check('mit dem Überholten', news[0]?.passed === A, String(news[0]?.passed));
  check('und seinem Vermögen', news[0]?.worth === 1_200_000, String(news[0]?.worth));

  console.log('--- Der Verdrängte bekommt keinen Applaus ---');
  check('nur eine Meldung, nicht zwei',
    news.filter((n) => n.userId === A).length === 0, JSON.stringify(news));

  console.log('--- Ohne Änderung passiert nichts ---');
  check('dieselbe Rangliste ist stumm',
    podium.check(W, list([B, 1_200_000], [A, 900_000], [C, 100_000]), t1 + 60_000).length === 0);

  console.log('--- Sperrfrist gegen Ping-Pong ---');
  const t2 = t1 + 2 * HOUR;
  const zurueck = podium.check(W, list([A, 1_300_000], [B, 1_200_000], [C, 100_000]), t2);
  check('der Rückeroberer wird gefeiert', zurueck.length === 1 && zurueck[0].userId === A);

  const t3 = t2 + 60_000;
  const pong = podium.check(W, list([B, 1_400_000], [A, 1_300_000], [C, 100_000]), t3);
  check('aber nicht schon wieder derselbe Platz für denselben Spieler',
    pong.length === 0, JSON.stringify(pong));
  check('das Treppchen stimmt trotzdem',
    db.podiumOf(W).find((r) => r.rank === 1)?.user_id === B);

  const t4 = t3 + podium.COOLDOWN_MS + 1;
  const spaeter = podium.check(W, list([A, 1_500_000], [B, 1_400_000], [C, 100_000]), t4);
  check('nach der Sperrfrist wieder', spaeter.length === 1 && spaeter[0].userId === A,
    JSON.stringify(spaeter));

  console.log('--- Einstieg von außen ---');
  const t5 = t4 + 10 * HOUR;
  const neu = podium.check(W, list([A, 1_500_000], [B, 1_400_000], [D, 900_000]), t5);
  check('wer neu aufs Treppchen kommt, wird gefeiert',
    neu.length === 1 && neu[0].userId === D, JSON.stringify(neu));
  check('auf Platz 3', neu[0]?.rank === 3);
  check('und hat C verdrängt', neu[0]?.passed === C, String(neu[0]?.passed));

  console.log('--- Kleinvieh feiern wir nicht ---');
  const arm = `POD_ARM${Date.now()}`;
  podium.check(arm, list(['fx:x', 5], ['fx:y', 4], ['fx:z', 3]), t5);
  const winzig = podium.check(arm, list(['fx:y', 6], ['fx:x', 5], ['fx:z', 3]), t5 + HOUR);
  check('unter der Mindestsumme bleibt es still', winzig.length === 0, JSON.stringify(winzig));

  console.log('--- Leere Liste ---');
  check('nichts drin, nichts los', podium.check(W, [], t5).length === 0);

  console.log('--- Der Text ---');
  identity.remember(A, 'Anton');
  identity.remember(D, 'Dora');
  const text = podium.describe(
    { rank: 1, userId: A, worth: 1_500_000, passed: D }, (v) => `🪙 ${v.toLocaleString('de-DE')}`);
  check('nennt den Platz', text.includes('Nummer 1'), text);
  check('nennt den Überholten', text.includes('Dora'), text);
  check('nennt das Vermögen', text.includes('1.500.000'), text);
  check('und pingt nirgends @everyone',
    !text.includes('@everyone') && !text.includes('@here'), text);

  const ohne = podium.describe(
    { rank: 3, userId: A, worth: 50_000, passed: null }, (v) => String(v));
  check('ohne Vorgänger fehlt die Zeile nicht ganz', ohne.includes('Vermögen'), ohne);
  check('aber niemand wird erfunden', !ohne.includes('Überholt'), ohne);

  console.log('--- Verschickt wird auf beiden Plattformen ---');
  const relay = require('../src/relay');
  const gesendet = [];
  relay.broadcast = async (t) => { gesendet.push(t); return ['discord', 'fluxer']; };
  // Das Währungssymbol käme sonst von der API (§12: kein Netz im Test).
  require('../src/currency').getSymbol = async () => '🪙';

  const t6 = t5 + 20 * HOUR;
  const gefeiert = await podium.celebrate(
    W, list([C, 2_000_000], [A, 1_500_000], [B, 1_400_000]), t6);
  check('eine Meldung ging raus', gesendet.length === 1, JSON.stringify(gesendet));
  check('sie nennt den Aufsteiger und den Überholten',
    gesendet[0]?.includes('Anton'), gesendet[0]);
  check('celebrate meldet zurück, was gefeiert wurde',
    gefeiert.length === 1 && gefeiert[0].userId === C);

  gesendet.length = 0;
  await podium.celebrate(W, list([C, 2_000_000], [A, 1_500_000], [B, 1_400_000]), t6 + 60_000);
  check('ohne Änderung geht nichts raus', gesendet.length === 0);

  console.log('--- Ein kaputter Kanal reißt nichts mit ---');
  relay.broadcast = async () => { throw new Error('kein Kanal'); };
  const t7 = t6 + 20 * HOUR;
  const trotzdem = await podium.celebrate(
    W, list([D, 3_000_000], [C, 2_000_000], [A, 1_500_000]), t7);
  check('kein Absturz', Array.isArray(trotzdem));
  check('das Treppchen wurde trotzdem fortgeschrieben',
    db.podiumOf(W).find((r) => r.rank === 1)?.user_id === D);

  console.log(`\n${pass} bestanden, ${fail} fehlgeschlagen`);
  process.exit(fail === 0 ? 0 : 1);
})();
