/**
 * Tests für die Geld-Rangliste (!top).
 *
 * Anders als !work oder !rob lässt sich die Rangliste über die
 * UnbelievaBoat-API wirklich LESEN – sie wird also nicht nachgebaut, sondern
 * geholt. Ergänzt wird sie um die Fluxer-Spieler ohne Verknüpfung, deren Geld
 * im lokalen Wallet liegt und die UnbelievaBoat gar nicht kennt – und um den
 * Besitz (test/networth.test.js prüft die Vermögenssicht).
 *
 * Aufruf: npm run test:toplist
 */
// Eigene Welt je Lauf: Sonst bleiben Wallets aus früheren Läufen liegen und
// verfälschen die Rangliste (genau das ist hier schon einmal passiert).
process.env.WORLD_ID = `TESTWORLD_TOP_${Date.now()}`;

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

  console.log('--- !top wird auf Discord mitgehört ---');
  /*
   * `!top` gehört dort UnbelievaBoat. Dessen Liste kennt aber weder Besitz
   * noch die Fluxer-Spieler – deshalb antwortet der Bot zusätzlich mit seiner
   * eigenen (siehe topEcho.js).
   */
  const topEcho = require('../src/topEcho');
  const P = topEcho.PREFIX;
  check('erkennt den Befehl', topEcho.parse(`${P}top`)?.cmd === 'top');
  check('auch mit Argument', topEcho.parse(`${P}top bar`)?.arg === 'bar');
  check('auch die Schreibweisen von UnbelievaBoat',
    Boolean(topEcho.parse(`${P}lb`)) && Boolean(topEcho.parse(`${P}leaderboard`)));
  check('lässt fremde Befehle in Ruhe', topEcho.parse(`${P}work`) === null);
  check('und normalen Text erst recht', topEcho.parse('top 10 Autos') === null);

  const gesendet = [];
  const nachricht = (content, userId = '111111111111111111') => ({
    guild: { id: 'G' },
    author: { id: userId, bot: false },
    channel: {
      id: 'KANAL',
      async send(payload) { gesendet.push(payload); return { id: `M${gesendet.length}` }; },
    },
    content,
  });

  const t0 = Date.now();
  check('antwortet auf !top', await topEcho.handleMessage(nachricht(`${P}top`), t0) === true);
  check('und schickt eine Ansicht',
    gesendet.length === 1 && Boolean(gesendet[0].embeds?.length), JSON.stringify(gesendet[0] ?? {}));
  check('die Liste ist unsere (mit Vermögen)',
    gesendet[0].embeds[0].toJSON().title.includes('Vermögen'),
    gesendet[0].embeds[0].toJSON().title);
  check('ohne Pings – die Liste soll niemanden anschreien',
    gesendet[0].allowedMentions?.users?.length === 0);

  check('gleich danach nicht noch einmal (Spamschutz)',
    await topEcho.handleMessage(nachricht(`${P}top`), t0 + 1000) === false);
  check('nach der Wartezeit wieder',
    await topEcho.handleMessage(nachricht(`${P}top`), t0 + topEcho.COOLDOWN_MS + 1) === true);
  check('Bots werden ignoriert', await topEcho.handleMessage(
    { ...nachricht(`${P}top`), author: { id: 'BOT', bot: true } }, t0 + 999999) === false);

  console.log('--- Ersetzen: UnbelievaBoats Antwort wegräumen ---');
  /*
   * Einen fremden Bot am Antworten hindern kann niemand. „Ersetzen" heißt
   * deshalb: selbst antworten und ihre Antwort danach löschen. Gefährlich ist
   * dabei nur eines – die falsche Nachricht zu erwischen. Genau das wird hier
   * durchgespielt.
   */
  let geloescht = 0;
  const unbAntwort = (authorId = topEcho.UNB_BOT_ID, channelId = 'KANAL') => ({
    guild: { id: 'G' },
    author: { id: authorId, bot: true },
    client: { user: { id: 'ICHSELBST' } },
    channel: { id: channelId },
    content: 'Leaderboard',
    async delete() { geloescht++; },
  });

  const t1 = t0 + 10 * topEcho.COOLDOWN_MS;
  check('ohne TOP_ECHO_REPLACE bleibt alles stehen',
    await topEcho.handleMessage(nachricht(`${P}top`), t1) === true
    && await topEcho.catchReply(unbAntwort(), t1 + 500) === false);
  check('und nichts wurde gelöscht', geloescht === 0, String(geloescht));

  process.env.TOP_ECHO_REPLACE = 'true';
  check('die Einstellung greift', topEcho.replacing() === true);

  const t2 = t1 + 10 * topEcho.COOLDOWN_MS;
  check('ohne vorheriges !top wird nichts gelöscht',
    await topEcho.catchReply(unbAntwort(), t2) === false);

  await topEcho.handleMessage(nachricht(`${P}top`), t2);
  check('eine fremde Bot-Nachricht bleibt',
    await topEcho.catchReply(unbAntwort('IRGENDEINBOT'), t2 + 300) === false);
  check('in einem anderen Kanal auch',
    await topEcho.catchReply(unbAntwort(topEcho.UNB_BOT_ID, 'ANDERER'), t2 + 300) === false);
  check('unsere eigene Liste erst recht',
    await topEcho.catchReply(unbAntwort('ICHSELBST'), t2 + 300) === false);
  check('ihre Antwort wird gelöscht',
    await topEcho.catchReply(unbAntwort(), t2 + 300) === true);
  check('genau eine', geloescht === 1, String(geloescht));
  check('eine zweite Nachricht bleibt stehen',
    await topEcho.catchReply(unbAntwort(), t2 + 400) === false);

  const t3 = t2 + 10 * topEcho.COOLDOWN_MS;
  await topEcho.handleMessage(nachricht(`${P}top`), t3);
  check('was zu spät kommt, bleibt auch stehen',
    await topEcho.catchReply(unbAntwort(), t3 + topEcho.CATCH_MS + 1) === false);
  check('immer noch nur eine gelöscht', geloescht === 1, String(geloescht));

  console.log('--- Geht unsere Liste nicht raus, bleibt ihre ---');
  const stummerKanal = {
    guild: { id: 'G' },
    author: { id: '111111111111111111', bot: false },
    channel: { id: 'STUMM', async send() { throw new Error('keine Rechte'); } },
    content: `${P}top`,
  };
  const t4 = t3 + 10 * topEcho.COOLDOWN_MS;
  check('wir melden ehrlich, dass nichts kam',
    await topEcho.handleMessage(stummerKanal, t4) === false);
  check('und löschen deshalb auch nichts',
    await topEcho.catchReply(unbAntwort(topEcho.UNB_BOT_ID, 'STUMM'), t4 + 300) === false);

  delete process.env.TOP_ECHO_REPLACE;

  console.log(`\n${pass} bestanden, ${fail} fehlgeschlagen`);
  process.exit(fail === 0 ? 0 : 1);
})();
