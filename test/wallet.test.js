/**
 * Tests für die eigene Wirtschaft (Fluxer-Branch).
 *
 * Schwerpunkt ist die buchhalterische Grundregel: Vermögen entsteht und
 * verschwindet AUSSCHLIESSLICH über changeCash. Umbuchungen zwischen Bank und
 * Bargeld dürfen die Summe niemals verändern – sonst wäre das Wallet selbst
 * ein Gelddrucker.
 *
 * Aufruf: npm run test:wallet
 */
const db = require('../src/db');
const wallet = require('../src/wallet');
const income = require('../src/income');
const level = require('../src/level');

let pass = 0, fail = 0;
const check = (label, ok, extra = '') => {
  if (ok) { pass++; console.log(`  ✅ ${label}`); }
  else { fail++; console.log(`  ❌ ${label} ${extra}`); }
};

/** Jeder Abschnitt bekommt einen frischen Server, damit nichts nachwirkt. */
let n = 0;
const freshGuild = () => `WALLET_T${Date.now()}_${n++}`;

(async () => {
  console.log('--- Startguthaben ---');
  const G1 = freshGuild(); const U = 'U1';
  const first = await wallet.getBalance(G1, U);
  check('neuer Spieler bekommt Startkapital', first.cash === wallet.START_CASH, String(first.cash));
  check('Bank startet leer', first.bank === 0);
  check('total = cash + bank', first.total === first.cash + first.bank);

  await wallet.changeCash(G1, U, -500, 'Test');
  const again = await wallet.getBalance(G1, U);
  check('Startkapital wird NICHT erneut vergeben',
    again.cash === wallet.START_CASH - 500, String(again.cash));

  console.log('--- Buchungen sind exakt ---');
  const G2 = freshGuild();
  await wallet.getBalance(G2, U);
  await wallet.changeCash(G2, U, 1000, 'Einnahme');
  await wallet.changeCash(G2, U, -250, 'Ausgabe');
  const b2 = await wallet.getBalance(G2, U);
  check('+1000 -250 wirkt genau', b2.cash === wallet.START_CASH + 750, String(b2.cash));
  check('Buchung gibt die neue Bilanz zurück',
    (await wallet.changeCash(G2, U, 0, 'nix')).cash === b2.cash);

  console.log('--- KEIN GELD AUS DEM NICHTS: Umbuchungen erhalten die Summe ---');
  const before = (await wallet.getBalance(G2, U)).total;
  await wallet.deposit(G2, U, 500);          // Bar -> Bank
  const mid = await wallet.getBalance(G2, U);
  check('Einzahlung verschiebt nur', mid.total === before, `${mid.total} vs ${before}`);
  check('Bank hat jetzt 500', mid.bank === 500, String(mid.bank));
  await wallet.withdrawFromBank(G2, U, 500); // Bank -> Bar
  const after = await wallet.getBalance(G2, U);
  check('Abhebung verschiebt nur', after.total === before, `${after.total} vs ${before}`);
  check('Bank wieder leer', after.bank === 0);

  // 200 zufällige Umbuchungen dürfen die Summe kein Stück verändern.
  let drift = false;
  for (let i = 0; i < 200; i++) {
    const amount = Math.floor(Math.random() * 400) - 200;
    await wallet.withdrawFromBank(G2, U, amount);
    if ((await wallet.getBalance(G2, U)).total !== before) { drift = true; break; }
  }
  check('200 Umbuchungen ändern die Summe nie', !drift);

  console.log('--- Invariante: total == Start + Summe aller Buchungen ---');
  const G3 = freshGuild(); const P = 'SPIELER';
  await wallet.getBalance(G3, P);
  const amounts = [900, -120, 4500, -3000, 75, -1, 260];
  for (const a of amounts) await wallet.changeCash(G3, P, a, 'Lauf');
  await wallet.deposit(G3, P, 1200);              // darf nichts ändern
  await wallet.withdrawFromBank(G3, P, 300);
  const sum = amounts.reduce((s, a) => s + a, 0);
  const end = await wallet.getBalance(G3, P);
  check('Bilanz stimmt exakt mit den Buchungen überein',
    end.total === wallet.START_CASH + sum, `${end.total} vs ${wallet.START_CASH + sum}`);

  const log = db.walletLog(G3, P, 100);
  const logged = log.filter((e) => e.reason === 'Lauf').reduce((s, e) => s + e.amount, 0);
  check('das Log bildet genau diese Buchungen ab', logged === sum, `${logged} vs ${sum}`);
  check('Umbuchungen stehen NICHT im Log (kein Scheinumsatz)',
    !log.some((e) => e.amount === 1200 || e.amount === -1200));

  console.log('--- Erfahrung wird korrekt vergeben ---');
  const G4 = freshGuild(); const X = 'XPUSER';
  await wallet.getBalance(G4, X);
  const xp0 = db.getStats(G4, X).xp;
  await wallet.changeCash(G4, X, 10000, 'Einnahme');
  const xp1 = db.getStats(G4, X).xp;
  check('Buchung gibt XP', xp1 - xp0 === level.xpForAmount(10000), `${xp1 - xp0}`);
  await wallet.changeCash(G4, X, 10000, 'Storno', { xp: false });
  check('{xp:false} vergibt KEINE XP', db.getStats(G4, X).xp === xp1);
  const inc0 = db.getStats(G4, X).income_total;
  await wallet.withdrawFromBank(G4, X, 100);
  check('Umbuchung zählt nicht als Einnahme', db.getStats(G4, X).income_total === inc0);

  console.log('--- Tagesbonus ---');
  const G5 = freshGuild(); const D = 'DAILY';
  const d1 = await income.daily(G5, D);
  check('erste Auszahlung klappt', d1.ok === true);
  check('Betrag liegt in der Spanne',
    d1.amount >= income.DAILY.base && d1.amount <= income.DAILY.base + income.DAILY.bonus,
    String(d1.amount));
  check('Spanne ist 200–2000',
    income.DAILY.base === 200 && income.DAILY.base + income.DAILY.bonus === 2000,
    `${income.DAILY.base}–${income.DAILY.base + income.DAILY.bonus}`);

  // Beide Enden der Spanne müssen erreichbar sein – ein Off-by-one im
  // Zufallsanteil fällt sonst nie auf.
  const low = await income.daily(freshGuild(), D, Date.now(), () => 0);
  const high = await income.daily(freshGuild(), D, Date.now(), () => 0.9999999);
  check('Minimum ist genau 200', low.amount === 200, String(low.amount));
  check('Maximum ist genau 2000', high.amount === 2000, String(high.amount));

  console.log('--- Sprüche zum Tagesbonus ---');
  const lines = income.lines;
  check('genug Auswahl', lines.LINES.length >= 40, String(lines.LINES.length));
  check('jede Zeile hat genau einen Platzhalter',
    lines.LINES.every((l) => l.split('{betrag}').length === 2),
    lines.LINES.filter((l) => l.split('{betrag}').length !== 2)[0]);
  check('keine Dubletten', new Set(lines.LINES).size === lines.LINES.length);
  check('keine Zeile ist zu lang (Fluxer/Discord)',
    lines.LINES.every((l) => l.length <= 200),
    lines.LINES.find((l) => l.length > 200));
  check('jede Zeile fängt mit einem Emoji an',
    lines.LINES.every((l) => /^[^\x00-\x7F]/.test(l)),
    lines.LINES.find((l) => /^[\x00-\x7F]/.test(l)));

  check('Auszahlung liefert einen Spruch',
    typeof d1.flavor === 'string' && lines.LINES.includes(d1.flavor), String(d1.flavor));
  const rendered = lines.format(d1.flavor, '🪙 1.234');
  check('Betrag wird eingesetzt', rendered.includes('🪙 1.234') && !rendered.includes('{betrag}'),
    rendered);
  check('gleicher Zufall -> gleicher Spruch',
    lines.pick(() => 0.42) === lines.pick(() => 0.42));
  check('alle Zeilen sind erreichbar',
    new Set(Array.from({ length: 2000 }, () => lines.pick())).size === lines.LINES.length);
  const cashAfter = (await wallet.getBalance(G5, D)).cash;
  check('Geld ist angekommen', cashAfter === wallet.START_CASH + d1.amount);

  const d2 = await income.daily(G5, D);
  check('zweite Auszahlung wird abgelehnt', d2.ok === false && d2.reason === 'cooldown');
  check('und es floss kein Geld', (await wallet.getBalance(G5, D)).cash === cashAfter);
  check('Restzeit wird gemeldet', d2.remainingMs > 0 && d2.remainingMs <= income.DAY_MS);

  const d3 = await income.daily(G5, D, Date.now() + income.DAY_MS + 1000);
  check('nach 24 h wieder möglich', d3.ok === true);

  console.log('--- Reichenliste ---');
  const G6 = freshGuild();
  await wallet.changeCash(G6, 'ARM', 10, 'x');
  await wallet.changeCash(G6, 'REICH', 99999, 'x');
  const top = db.walletTop(G6, 5);
  check('reichster Spieler steht oben', top[0].user_id === 'REICH', JSON.stringify(top[0]));

  console.log(`\n${pass} bestanden, ${fail} fehlgeschlagen`);
  process.exit(fail === 0 ? 0 : 1);
})();
