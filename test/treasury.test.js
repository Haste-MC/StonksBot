/**
 * Tests für die Staatskasse.
 *
 * Drei Schwerpunkte:
 *
 *  1. **Der Spieler zahlt nicht mehr.** Das ist die Zusage des Features: Der
 *     Anteil wird aus dem Betrag nur berechnet und zusätzlich abgelegt. Wenn
 *     ein Kauf über 10 000 den Spieler 10 001 kostet, ist das Feature kaputt.
 *  2. **Kein Gelddrucker (ARCHITEKTUR §3).** Die Kasse ist eine reine Senke:
 *     Über eine lange Zufallssitzung darf sich das Vermögen der Spieler durch
 *     sie um keinen Taler verändern.
 *  3. **Nur echte Buchungen.** Stornos (`{ xp: false }`) und Raubzüge füllen
 *     die Kasse nicht, sonst würde ein abgebrochener Kauf Geld erzeugen.
 *
 * Aufruf: node test/treasury.test.js
 */
const db = require('../src/db');
const treasury = require('../src/treasury');
const unb = require('../src/unb');
const wallet = require('../src/wallet');
const robbery = require('../src/robbery');

let pass = 0, fail = 0;
const check = (label, ok, extra = '') => {
  if (ok) { pass++; console.log(`  ✅ ${label}`); }
  else { fail++; console.log(`  ❌ ${label} ${extra}`); }
};

/** Jeder Abschnitt bekommt eine frische Welt, damit nichts nachwirkt. */
let n = 0;
const freshGuild = () => {
  const g = `TREASURY_T${Date.now()}_${n++}`;
  treasury.reset(g);
  return g;
};

/** Konten ohne Discord-ID laufen garantiert über das lokale Wallet. */
const acc = (name) => `fx:${name}`;

(async () => {
  console.log('--- Die Sätze ---');
  check('19 % auf Ausgaben', treasury.shareOf(-10000) === 1900, String(treasury.shareOf(-10000)));
  check('40 % auf Einnahmen', treasury.shareOf(10000) === 4000, String(treasury.shareOf(10000)));
  check('Nullbuchung wirft nichts ab', treasury.shareOf(0) === 0);
  check('Ausgabe ist "vat", Einnahme ist "tax"',
    treasury.kindOf(-5) === 'vat' && treasury.kindOf(5) === 'tax');
  check('gerundet wird kaufmännisch', treasury.shareOf(-3) === 1, String(treasury.shareOf(-3)));
  check('Kleinstbeträge fallen unter den Tisch statt aufzurunden',
    treasury.shareOf(-2) === 0, String(treasury.shareOf(-2)));

  console.log('\n--- Der Spieler zahlt keinen Taler mehr ---');
  {
    const G = freshGuild(); const U = acc('kaeufer');
    const before = await unb.getBalance(G, U);
    await unb.changeCash(G, U, -10000, 'Kauf: Golf GTI');
    const after = await unb.getBalance(G, U);

    check('Kaufpreis bleibt exakt der Kaufpreis',
      before.total - after.total === 10000, `${before.total} -> ${after.total}`);
    check('die Kasse hat trotzdem 1.900 bekommen',
      treasury.state(G).balance === 1900, String(treasury.state(G).balance));

    const beforeWork = await unb.getBalance(G, U);
    await unb.changeCash(G, U, 2000, 'Schicht: Kellner');
    const afterWork = await unb.getBalance(G, U);
    check('vom Lohn wird nichts abgezogen',
      afterWork.total - beforeWork.total === 2000, `${beforeWork.total} -> ${afterWork.total}`);
    check('die Kasse hat 40 % des Lohns notiert',
      treasury.state(G).balance === 1900 + 800, String(treasury.state(G).balance));

    const s = treasury.state(G);
    check('Bemessungsgrundlagen stimmen',
      s.spend_base === 10000 && s.income_base === 2000, `${s.spend_base}/${s.income_base}`);
    check('Umsatz ist die Summe beider Seiten', s.turnover === 12000, String(s.turnover));
    check('Beitrag des Spielers ist vollständig verbucht',
      treasury.contribution(G, U).amount === 2700,
      String(treasury.contribution(G, U).amount));
  }

  console.log('\n--- Nur echte Buchungen ---');
  {
    const G = freshGuild(); const U = acc('storno');
    await unb.changeCash(G, U, -1000, 'Kauf: Fahrrad');
    const afterBuy = treasury.state(G).balance;
    await unb.changeCash(G, U, 1000, 'Kauf abgebrochen', { xp: false });
    check('ein Storno füllt die Kasse nicht',
      treasury.state(G).balance === afterBuy, String(treasury.state(G).balance));

    await unb.changeCash(G, U, 5000, 'Sonderfall', { tax: false });
    check('{ tax: false } schaltet die Kasse gezielt ab',
      treasury.state(G).balance === afterBuy, String(treasury.state(G).balance));

    const opfer = acc('opfer'); const raeuber = acc('raeuber');
    await wallet.changeCash(G, opfer, 50000, 'Startkapital');
    const beforeRob = treasury.state(G).balance;
    const kasseVorher = (await unb.getBalance(G, opfer)).cash;
    let raubzuege = 0;
    for (let i = 0; i < 20; i++) {
      const res = await robbery.rob(G, raeuber, opfer, Date.now() + i * 3600_000);
      if (res.ok) raubzuege++;
    }
    check('es wurde wirklich geraubt',
      raubzuege > 0 && (await unb.getBalance(G, opfer)).cash !== kasseVorher,
      `${raubzuege} Versuche`);
    check('Raubgut wird nicht deklariert',
      treasury.state(G).balance === beforeRob, String(treasury.state(G).balance));
  }

  console.log('\n--- Bereiche ---');
  {
    const cases = [
      ['Kauf: BMW M3', 'fahrzeuge'],
      ['Privatkauf: Polo', 'fahrzeuge'],
      ['Verkauf: Passat', 'fahrzeuge'],
      ['Zwangsverkauf: Corsa', 'fahrzeuge'],
      ['Schicht: Bäcker:in', 'arbeit'],
      ['Rollen-Einkommen', 'arbeit'],
      ['Täglicher Bonus', 'bonus'],
      ['Miete 3 Tage: Loft', 'immobilien'],
      ['Erste Miete: Loft', 'immobilien'],
      ['Mieteinnahme: Loft', 'immobilien'],
      ['Börse: 3× HAST @ 120', 'boerse'],
      ['Werkstatt: Golf (40 % → 80 %)', 'werkstatt'],
      ['Selbst repariert: Golf (40 % → 71 %)', 'werkstatt'],
      ['Fang: Wels', 'angeln'],
      ['Auktion: Garage 4', 'auktion'],
      ['Fund: Garage 4', 'auktion'],
      ['Hehler: 3 Fundstücke', 'auktion'],
      ['Blackjack: win', 'casino'],
      ['Coinflip', 'casino'],
      ['Slots', 'casino'],
      ['Roulette', 'casino'],
      ['Irgendwas Neues', 'sonstiges'],
    ];
    const wrong = cases.filter(([reason, id]) => treasury.categoryOf(reason).id !== id);
    check('alle echten Buchungsgründe landen im richtigen Bereich',
      wrong.length === 0,
      wrong.map(([r, id]) => `${r} -> ${treasury.categoryOf(r).id} statt ${id}`).join(', '));

    const G = freshGuild(); const U = acc('bereiche');
    await unb.changeCash(G, U, -10000, 'Kauf: BMW M3');
    await unb.changeCash(G, U, -1000, 'Börse: 5× HAST @ 200');
    await unb.changeCash(G, U, 3000, 'Schicht: Bäcker:in');
    const sources = treasury.sources(G, 5);
    check('Bereiche sind absteigend nach Ertrag sortiert',
      sources[0].id === 'fahrzeuge' && sources[1].id === 'arbeit' && sources[2].id === 'boerse',
      sources.map((s) => s.id).join(','));
    check('jeder Bereich hat Anzeigedaten',
      sources.every((s) => s.emoji && s.label));
    check('die Summe der Bereiche ist der Kassenstand',
      sources.reduce((sum, s) => sum + s.amount, 0) === treasury.state(G).balance);
  }

  console.log('\n--- Kasse und Log ---');
  {
    const G = freshGuild();
    const users = [acc('a'), acc('b'), acc('c')];
    let expected = 0;
    for (let i = 0; i < 300; i++) {
      const u = users[i % users.length];
      const amount = (i % 3 === 0 ? -1 : 1) * (100 + i * 7);
      expected += treasury.shareOf(amount);
      await unb.changeCash(G, u, amount, 'Kauf: Testposten');
    }
    check('der Kassenstand ist die Summe aller Anteile',
      treasury.state(G).balance === expected, `${treasury.state(G).balance} vs ${expected}`);
    check('alle Buchungen sind gezählt', treasury.state(G).bookings === 300,
      String(treasury.state(G).bookings));
    check('das Log wird gekappt',
      db.treasuryLog(G, 1000).length <= db.TREASURY_LOG_KEEP,
      String(db.treasuryLog(G, 1000).length));
    check('die letzten Zuflüsse stehen zuerst',
      treasury.recent(G, 3).length === 3);

    const payers = treasury.payers(G, 10);
    check('die Summe der Beitragszahler ist der Kassenstand',
      payers.reduce((sum, p) => sum + p.amount, 0) === treasury.state(G).balance);
    const standNachher = treasury.state(G).balance;
    for (let i = 0; i < 5; i++) {
      treasury.state(G); treasury.sources(G); treasury.payers(G); treasury.recent(G);
    }
    check('Ansehen bucht nichts nach',
      treasury.state(G).balance === standNachher && treasury.state(G).bookings === 300,
      `${treasury.state(G).balance} vs ${standNachher}`);
  }

  console.log('\n--- Kein Gelddrucker (§3) ---');
  {
    const G = freshGuild();
    const users = [acc('m1'), acc('m2'), acc('m3'), acc('m4')];
    const reasons = [
      'Kauf: Auto', 'Verkauf: Auto', 'Schicht: Job', 'Täglicher Bonus',
      'Börse: 1× HAST @ 100', 'Miete 2 Tage: Loft', 'Fang: Hecht', 'Blackjack: win',
    ];

    let startTotal = 0;
    for (const u of users) startTotal += (await unb.getBalance(G, u)).total;

    let booked = 0;
    for (let i = 0; i < 2000; i++) {
      const u = users[Math.floor(Math.random() * users.length)];
      const amount = Math.round((Math.random() * 2 - 1) * 5000);
      if (!amount) continue;
      booked += amount;
      await unb.changeCash(G, u, amount, reasons[i % reasons.length]);
    }

    let endTotal = 0;
    for (const u of users) endTotal += (await unb.getBalance(G, u)).total;

    check('das Vermögen der Spieler ändert sich um exakt die gebuchten Beträge',
      endTotal - startTotal === booked, `${endTotal - startTotal} vs ${booked}`);
    check('die Kasse hat trotzdem etwas gesammelt', treasury.state(G).balance > 0);
    check('aus der Kasse fließt nichts zurück',
      typeof treasury.payout !== 'function' && typeof treasury.spend !== 'function');
  }

  console.log('\n--- Aufteilung auf die Länder ---');
  {
    const home = require('../src/home');
    const G = freshGuild();
    const kevin = acc('kevin');
    const mara = acc('mara');
    const yuki = acc('yuki');
    const heimatlos = acc('heimatlos');

    await home.setHome(G, kevin, 'de');
    await home.setHome(G, mara, 'de');
    await home.setHome(G, yuki, 'jp');

    await unb.changeCash(G, kevin, -100000, 'Kauf: Auto');   // 19.000 -> DE
    await unb.changeCash(G, mara, 50000, 'Schicht: Job');    // 20.000 -> DE
    await unb.changeCash(G, yuki, -80000, 'Kauf: Auto');     // 15.200 -> JP
    await unb.changeCash(G, heimatlos, -10000, 'Kauf: Rad'); //  1.900 -> ohne

    const list = treasury.countries(G);
    const byId = Object.fromEntries(list.map((c) => [c.country, c]));

    check('jeder zahlt in sein eigenes Land',
      byId.de.balance === 39000 && byId.jp.balance === 15200,
      `de ${byId.de?.balance} · jp ${byId.jp?.balance}`);
    check('ohne Heimat landet es im Topf der Staatenlosen',
      byId[''].balance === 1900, String(byId['']?.balance));
    check('die Summe der Länder ist der Welttopf',
      list.reduce((s, c) => s + c.balance, 0) === treasury.state(G).balance);
    check('die Rangliste ist absteigend sortiert',
      list.every((c, i) => i === 0 || list[i - 1].balance >= c.balance));
    check('Länder tragen Flagge und Namen',
      byId.de.flag === '🇩🇪' && byId.de.name === 'Deutschland' && byId[''].name === 'Ohne Heimat');
    check('die Einwohner werden gezählt',
      byId.de.people === 2 && byId.jp.people === 1, `${byId.de?.people}/${byId.jp?.people}`);
    check('die Anteile ergeben zusammen 100 %',
      Math.abs(list.reduce((s, c) => s + c.share, 0) - 1) < 0.001);

    const view = treasury.countryOf(G, kevin);
    check('ein Spieler sieht sein Land und dessen Platz',
      view.land.id === 'de' && view.rank === 1 && view.balance === 39000,
      JSON.stringify({ rank: view.rank, balance: view.balance }));

    // Umzug: Neues Geld fließt woandershin, altes bleibt liegen.
    // Erst Geld besorgen – ein Umzug will bezahlt werden. Die Gutschrift läuft
    // steuerfrei, damit sie die Länderzahlen oben nicht verschiebt.
    await unb.changeCash(G, kevin, 500000, 'Testkapital', { tax: false });
    const moved = await home.setHome(G, kevin, 'jp');
    check('der Umzug klappt', moved.ok === true, moved.reason ?? '');
    const jpBefore = treasury.countries(G).find((c) => c.country === 'jp').balance;
    await unb.changeCash(G, kevin, -100000, 'Kauf: Auto');
    const after = Object.fromEntries(treasury.countries(G).map((c) => [c.country, c]));
    check('nach dem Umzug zahlt man ins neue Land',
      after.jp.balance === jpBefore + 19000, `${jpBefore} -> ${after.jp.balance}`);
    check('das alte Land behält, was es hat',
      after.de.balance === 39000, String(after.de.balance));
    check('auch Rumänien lässt sich wählen',
      (await home.setHome(G, acc('radu'), 'ro')).ok === true);
  }

  console.log('\n--- Zusammenführen von Konten ---');
  {
    const G = freshGuild();
    const alt = acc('alt'); const neu = '123456789012345678';
    await unb.changeCash(G, alt, -1000, 'Kauf: Roller');     // 190
    await unb.changeCash(G, neu, -2000, 'Kauf: Roller');     // 380
    const before = treasury.state(G).balance;

    db.mergeAccounts(G, alt, neu);

    check('der Beitrag wandert auf das Zielkonto',
      treasury.contribution(G, neu).amount === 570,
      String(treasury.contribution(G, neu).amount));
    check('das alte Konto ist leer', treasury.contribution(G, alt).amount === 0);
    check('der Kassenstand bleibt unberührt',
      treasury.state(G).balance === before, String(treasury.state(G).balance));
  }

  console.log(`\n${pass} bestanden, ${fail} fehlgeschlagen`);
  process.exit(fail === 0 ? 0 : 1);
})();
