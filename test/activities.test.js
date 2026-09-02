/**
 * Tests für Beförderungen und die Tätigkeiten an der Ausrüstung
 * (Angeln, Selberschrauben).
 *
 * Schwerpunkte:
 *  - **Rang hängt an der Schichtzahl** und wird beim Jobwechsel zurückgesetzt –
 *    er wird berechnet, nie gespeichert, kann also nicht auseinanderlaufen.
 *  - **Angeln ist eine Geldquelle mit Cooldown**, wie eine Schicht.
 *  - **Selberschrauben bleibt teurer als der Wertzuwachs** (ARCHITEKTUR §3).
 *    Sonst wäre der Weg offen: Wrack kaufen, selbst herrichten, verkaufen.
 *
 * Aufruf: node test/activities.test.js
 */
const db = require('../src/db');
const ranks = require('../src/ranks');
const fishing = require('../src/fishing');
const workshop = require('../src/workshop');
const cond = require('../src/condition');
const unb = require('../src/unb');

const G = 'TESTWORLD_AKTIV';
const U = 'AKTIVUSER';
let pass = 0, fail = 0;
const check = (label, ok, extra = '') => {
  if (ok) { pass++; console.log(`  ✅ ${label}`); }
  else { fail++; console.log(`  ❌ ${label} ${extra}`); }
};

const wallet = { cash: 5_000_000, bank: 0, total: 5_000_000 };
unb.getBalance = async () => ({ ...wallet });
unb.changeCash = async (g, u, a) => {
  wallet.cash += a; wallet.total = wallet.cash + wallet.bank; return { ...wallet };
};
unb.withdrawFromBank = async (g, u, a) => {
  wallet.cash += a; wallet.bank -= a; wallet.total = wallet.cash + wallet.bank; return { ...wallet };
};

const cleanup = () => {
  for (const kind of ['car', 'gear']) {
    for (const i of db.allItemsOfKind(G, kind)) db.deleteItem(G, i.id);
  }
  db.clearClaim(G, U, 'fishing');
  db.clearClaim(G, U, 'wrench');
};

const giveGear = (name, price = 800) => {
  const item = db.createItem({ guildId: G, name, price, kind: 'gear', stock: null, createdBy: 't' });
  db.reservePurchase(G, U, item.id, 1);
  return item;
};

cleanup();

(async () => {
  console.log('--- Beförderungen sind ein Wurf, kein Schwellenwert ---');
  check('Rang 0 zahlt den Grundlohn', ranks.payFactor(0) === 1);
  check('jeder Rang zahlt mehr als der vorige',
    [0, 1, 2, 5, 10, 40, 200].every((r, i, a) => i === 0 || ranks.payFactor(r) > ranks.payFactor(a[i - 1])));
  check('der Lohn wächst mit abnehmendem Schwung',
    ranks.payFactor(2) - ranks.payFactor(1) > ranks.payFactor(31) - ranks.payFactor(30));
  check('nach oben offen: auch Rang 500 hat einen Titel',
    ranks.label(500).length > 0 && ranks.rank(500).pay > ranks.rank(100).pay,
    ranks.label(500));
  check('benannte Stufen zuerst, danach Sterne',
    ranks.titleOf(1).title === 'Fachkraft' && ranks.titleOf(20).title.includes('★'),
    ranks.titleOf(20).title);

  check('ohne Schichten seit dem Aufstieg keine Chance', ranks.chance(0, 0) === 0);
  check('die Chance steigt mit jeder Schicht',
    ranks.chance(0, 10) > ranks.chance(0, 3) && ranks.chance(0, 3) > ranks.chance(0, 1));
  check('höherer Rang = kleinere Chance',
    ranks.chance(10, 5) < ranks.chance(0, 5), `${ranks.chance(10, 5)} vs ${ranks.chance(0, 5)}`);
  check('die Chance bleibt gedeckelt (nie sicher)',
    ranks.chance(0, 100000) === ranks.MAX_CHANCE && ranks.MAX_CHANCE < 1);

  check('sicherer Wurf befördert genau eine Stufe',
    ranks.roll(3, 50, () => 0)?.to.rank === 4);
  check('schlechter Wurf befördert nicht', ranks.roll(3, 50, () => 0.999) === null);
  check('ohne Schichten hilft auch der beste Wurf nichts',
    ranks.roll(0, 0, () => 0) === null);

  // Über viele Karrieren: Beförderungen kommen, werden aber seltener.
  const careerShifts = (startRank, tries = 4000) => {
    let sum = 0;
    for (let i = 0; i < tries; i++) {
      let since = 0;
      while (!ranks.roll(startRank, ++since)) { /* weiterarbeiten */ }
      sum += since;
    }
    return sum / tries;
  };
  const low = careerShifts(0);
  const high = careerShifts(15);
  console.log(`    Rang 0: Ø ${low.toFixed(1)} Schichten · Rang 15: Ø ${high.toFixed(1)}`);
  check('der erste Aufstieg kommt zügig', low > 2 && low < 15, low.toFixed(1));
  check('höhere Ränge dauern länger', high > low * 1.5, `${high.toFixed(1)} vs ${low.toFixed(1)}`);
  check('zwei Karrieren verlaufen unterschiedlich',
    (() => {
      const run = () => { let s = 0; while (!ranks.roll(0, ++s)) { /* … */ } return s; };
      const runs = new Set(Array.from({ length: 50 }, run));
      return runs.size > 1;
    })());

  console.log('--- Angeln braucht die Ausrüstung ---');
  const ohne = await fishing.fish(G, U);
  check('ohne Rute kein Fang', !ohne.ok && ohne.reason === 'no_gear', ohne.reason);
  check('sagt, was fehlt und was es kostet', ohne.gear === fishing.GEAR && ohne.price > 0);

  const rute = giveGear('Angelausrüstung', 1100);
  check('mit Rute erkannt', fishing.hasGear(G, U) === true);

  const before = wallet.total;
  const zug = await fishing.fish(G, U);
  check('Zug klappt', zug.ok === true, JSON.stringify(zug).slice(0, 100));
  check('entweder Fang oder leer', zug.empty === true || zug.catch != null);
  if (!zug.empty) {
    check('Fang hat Gewicht und Wert', zug.kg > 0 && zug.amount >= 0);
    check('Geld ist angekommen', wallet.total === before + zug.amount,
      `${wallet.total - before} vs ${zug.amount}`);
    check('Meldung nennt den Fisch',
      fishing.describe(zug, '100').includes(zug.catch.name));
  }

  const sofort = await fishing.fish(G, U);
  check('zweiter Zug läuft in den Cooldown',
    !sofort.ok && sofort.reason === 'cooldown', sofort.reason);
  check('Restzeit wird gemeldet',
    sofort.remainingMs > 0 && sofort.remainingMs <= fishing.COOLDOWN_MS);

  const cashAfter = wallet.total;
  await fishing.fish(G, U);
  check('und bucht nichts', wallet.total === cashAfter);

  const später = await fishing.fish(G, U, Date.now() + fishing.COOLDOWN_MS + 1000);
  check('nach dem Cooldown wieder', später.ok === true);

  console.log('--- Fangtabelle ---');
  const seen = new Map();
  const rng = (() => { let a = 12345; return () => ((a = (a * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff); })();
  for (let i = 0; i < 20000; i++) {
    const c = fishing.rollCatch(rng);
    seen.set(c.name, (seen.get(c.name) ?? 0) + 1);
  }
  check('alle Fänge sind erreichbar',
    seen.size === require('../src/data/fishing').CATCHES.length,
    `${seen.size} von ${require('../src/data/fishing').CATCHES.length}`);
  check('Schrott ist häufiger als der Wels',
    seen.get('Alter Stiefel') > seen.get('Wels'));
  check('Kuriosa sind selten',
    (seen.get('Versunkene Geldkassette') ?? 0) < 20000 * 0.01,
    String(seen.get('Versunkene Geldkassette')));
  check('kein Fang ist wertlos negativ',
    require('../src/data/fishing').CATCHES.every((c) => c.value >= 0));

  console.log('--- Selberschrauben braucht Werkzeug ---');
  const auto = db.createItem({
    guildId: G, name: 'Schraubauto', price: 60000, kind: 'car', stock: null, createdBy: 't',
  });
  db.reservePurchase(G, U, auto.id, 1);
  db.setCondition(G, U, auto.id, 25);

  const ohneWerkzeug = await workshop.selfRepair(G, U, auto.id, 'resto');
  check('ohne Werkzeugkasten geht nichts',
    !ohneWerkzeug.ok && ohneWerkzeug.reason === 'no_tools', ohneWerkzeug.reason);

  const kasten = giveGear('Werkzeugkasten', 800);
  const q = workshop.selfQuote(G, U, 60000, 25, 'resto');
  const werkstatt = workshop.quote(60000, 25, 'resto');
  check('selbst ist günstiger als die Werkstatt', q.cost < werkstatt.cost,
    `${q.cost} vs ${werkstatt.cost}`);
  check('Ersparnis wird ausgewiesen', q.saved === werkstatt.cost - q.cost);

  console.log('--- ... bleibt aber teurer als der Wertzuwachs (§3) ---');
  // Sonst wäre der Weg offen: Wrack kaufen, selbst herrichten, verkaufen.
  let broken = null;
  for (let price = 1; price <= 4000 && !broken; price++) {
    for (const tier of workshop.TIERS) {
      for (let from = 0; from < tier.target; from += 7) {
        const est = workshop.selfQuote(G, U, price, from, tier.id);
        if (est.cost <= est.gain) broken = `${price}/${from}/${tier.id}`;
      }
    }
  }
  check('auch bei billigen Autos: Kosten über dem Zuwachs', broken === null, String(broken));
  check('Materialaufschlag bleibt über 1',
    workshop.toolsOf(G, U).markup > 1, String(workshop.toolsOf(G, U).markup));

  // Auch mit dem gesamten Werkzeugpark darf der Aufschlag nicht unter 1 fallen.
  for (const t of workshop.EXTRA_TOOLS) giveGear(t.name, 5000);
  const voll = workshop.toolsOf(G, U);
  check('volle Werkstattausrüstung erkannt', voll.extras.length === workshop.EXTRA_TOOLS.length);
  check('Aufschlag bleibt trotzdem über 1', voll.markup > 1, String(voll.markup));
  check('Aufschlag respektiert die Untergrenze', voll.markup >= workshop.SELF_MARKUP_FLOOR);
  check('Pfuschrisiko sinkt mit dem Werkzeug',
    voll.botch < workshop.BOTCH_CHANCE, `${voll.botch} vs ${workshop.BOTCH_CHANCE}`);
  check('Pfuschrisiko verschwindet nie ganz', voll.botch > 0);

  console.log('--- Eine Eigenreparatur ---');
  const cashBefore = wallet.total;
  const rep = await workshop.selfRepair(G, U, auto.id, 'resto', Date.now(), () => 0.99);
  check('klappt', rep.ok === true, JSON.stringify(rep).slice(0, 120));
  check('kein Pfusch bei gutem Wurf', rep.botched === false);
  check('Zustand ist die Zielstufe', db.getOwned(G, U, auto.id).condition === 100,
    String(db.getOwned(G, U, auto.id).condition));
  check('genau das Material abgebucht', cashBefore - wallet.total === rep.cost,
    `${cashBefore - wallet.total} vs ${rep.cost}`);

  const nochmal = await workshop.selfRepair(G, U, auto.id, 'resto');
  check('danach ist Pause', !nochmal.ok && nochmal.reason === 'cooldown', nochmal.reason);

  console.log('--- Pfusch kostet trotzdem, bringt aber weniger ---');
  db.clearClaim(G, U, 'wrench');
  db.setCondition(G, U, auto.id, 20);
  const cashBefore2 = wallet.total;
  const pfusch = await workshop.selfRepair(G, U, auto.id, 'resto', Date.now(), () => 0.001);
  check('als Pfusch erkannt', pfusch.ok && pfusch.botched === true);
  check('Zustand steigt nur teilweise',
    pfusch.reached > 20 && pfusch.reached < 100, String(pfusch.reached));
  check('Material ist trotzdem weg', cashBefore2 - wallet.total === pfusch.cost);
  check('nie mehr Zustand als bezahlt', pfusch.reached <= pfusch.quote.to);

  check('bei ganz schlechtem Wurf geht auch das Werkzeug kaputt',
    pfusch.brokeTool === true && workshop.toolsOf(G, U).base === false,
    String(pfusch.brokeTool));

  console.log('--- Zu wenig Geld: nichts passiert ---');
  // Der Artikel steht weiter im Katalog – nur aus dem Inventar ist er weg.
  db.reservePurchase(G, U, kasten.id, 1);
  db.clearClaim(G, U, 'wrench');
  db.setCondition(G, U, auto.id, 30);
  const merk = wallet.total;
  wallet.cash = 5; wallet.total = 5;
  const arm = await workshop.selfRepair(G, U, auto.id, 'resto');
  check('abgelehnt', !arm.ok && arm.reason === 'insufficient_funds', arm.reason);
  check('Zustand unverändert', db.getOwned(G, U, auto.id).condition === 30);
  check('Cooldown wurde freigegeben', workshop.selfRemainingMs(G, U) === 0);
  wallet.cash = merk; wallet.total = merk;

  cleanup();
  console.log(`\n${pass} bestanden, ${fail} fehlgeschlagen`);
  process.exit(fail === 0 ? 0 : 1);
})();
