/**
 * Tests für den kriminellen Pfad.
 *
 * Ein Heist ist die einzige Aktivität, die richtig viel Geld auf einen Schlag
 * bringt – und die einzige, bei der man richtig viel verlieren kann. Geprüft
 * wird deshalb vor allem die Ökonomie:
 *
 *  1. **Ohne Vorbereitung verliert man** (§3): Der Erwartungswert eines
 *     unvorbereiteten Dings ist negativ. Erst wer Geld, Zeit und Ausrüstung
 *     investiert, dreht ihn ins Plus.
 *  2. **Die Chance ist ehrlich**: Was in der Anzeige steht, ist genau das,
 *     womit gewürfelt wird.
 *  3. **Der Ablauf hält Doppelklicks aus** – ein Ding lässt sich nicht
 *     zweimal ziehen, ein Schritt nicht zweimal abrechnen (§7).
 *
 * Aufruf: node test/heist.test.js
 */
const db = require('../src/db');
const heist = require('../src/heist');
const unb = require('../src/unb');

let pass = 0, fail = 0;
const check = (label, ok, extra = '') => {
  if (ok) { pass++; console.log(`  ✅ ${label}`); }
  else { fail++; console.log(`  ❌ ${label} ${extra}`); }
};

const G = `HEIST_T${Date.now()}`;
const HOUR = 60 * 60 * 1000;
const de = (n) => Math.round(n).toLocaleString('de-DE');

let cash = 50_000_000;
let bookings = 0;
unb.changeCash = async (g, u, a) => { cash += a; bookings++; return { cash, bank: 0, total: cash }; };
unb.getBalance = async () => ({ cash, bank: 0, total: cash });

// Alle Ausrüstungsgegenstände einmal anlegen.
const items = {};
for (const name of heist.TIERS.at(-1).items.concat(['Werkzeugkasten', 'Laptop'])) {
  const gear = require('../src/data/gear').findGear(name);
  items[name] = db.createItem({
    guildId: G, name, price: gear?.price ?? 1000, kind: 'gear', stock: null, createdBy: 't',
  });
}
const car = db.createItem({
  guildId: G, name: 'Fluchtwagen', price: 40_000, kind: 'car', stock: null, createdBy: 't',
});

let n = 0;
/** Ein Spieler mit vollständiger Ausrüstung und Auto. */
function player({ gear = true, withCar = true } = {}) {
  const U = `fx:h${n++}`;
  db.clearCrime(G, U);
  if (gear) {
    for (const [name, item] of Object.entries(items)) {
      if (!db.ownsNamed(G, U, name)) db.reservePurchase(G, U, item.id, 1);
    }
  }
  if (withCar && !db.ownsNamed(G, U, 'Fluchtwagen')) db.reservePurchase(G, U, car.id, 1);
  return U;
}

const loc = (id) => heist.location(id);

(async () => {
  console.log('--- Die Daten ---');
  {
    check(`${heist.LOCATIONS.length} Ziele, ${heist.PREPS.length} Vorbereitungen`,
      heist.LOCATIONS.length >= 5 && heist.PREPS.length >= 8);
    check('jedes Ziel ist vollständig',
      heist.LOCATIONS.every((l) => l.name && l.emoji && l.minCrew >= 1
        && l.maxCrew >= l.minCrew && l.loot[1] > l.loot[0] && l.fine > 0 && l.jailHours > 0
        && l.preps.length > 0));
    check('jedes Ziel nennt nur echte Vorbereitungen',
      heist.LOCATIONS.every((l) => l.preps.every((p) => heist.prep(p))));
    check('jede Vorbereitung nennt nur echte Gegenstände',
      heist.PREPS.every((p) => !p.needs?.item
        || require('../src/data/gear').findGear(p.needs.item)));
    check('die Ausrüstungsstufen bauen aufeinander auf',
      heist.TIERS.every((t, i) => i === 0
        || t.items.length >= heist.TIERS[i - 1].items.length));
    check('größere Ziele wollen mehr Leute und bessere Ausrüstung',
      heist.LOCATIONS.at(-1).minCrew > heist.LOCATIONS[0].minCrew
      && heist.LOCATIONS.at(-1).gearTier > heist.LOCATIONS[0].gearTier);
  }

  console.log('\n--- Ohne Vorbereitung verliert man (§3) ---');
  {
    /*
     * Der zentrale Nachweis: Wir rechnen den Erwartungswert je Ding aus,
     * einmal roh und einmal voll vorbereitet. Roh muss er negativ sein –
     * sonst wäre ein Heist eine Gelddruckmaschine mit Extraschritten.
     */
    const evOf = (l, done, tier, crew) => {
      const odds = heist.oddsOf({ loc: l, done, tier, crewSize: crew, heat: 0 });
      const avg = ((l.loot[0] + l.loot[1]) / 2)
        * heist.lootFactor(done) * heist.crewFactor(l, crew);
      const share = 1.15 / (1.15 + (crew - 1));
      // 75 % der Erfolge sind sauber, 25 % kosten Beute; 60 % der Fehlschläge
      // sind "nur" daneben, 40 % ein Desaster mit anderthalbfacher Strafe.
      const win = avg * share * (0.75 + 0.25 * heist.MESSY_LOOT);
      const lose = l.fine * (0.6 + 0.4 * 1.5);
      return odds.chance * win - (1 - odds.chance) * lose;
    };

    const raw = heist.LOCATIONS.map((l) =>
      ({ l, ev: evOf(l, [], heist.TIERS[l.gearTier], l.minCrew) }));
    check('roh ist jedes Ding ein Verlustgeschäft',
      raw.every((x) => x.ev < 0),
      raw.filter((x) => x.ev >= 0).map((x) => `${x.l.id}:${de(x.ev)}`).join(' '));

    const prepared = heist.LOCATIONS.map((l) => {
      const cost = heist.prepsFor(l).reduce((s, p) => s + p.cost, 0);
      return { l, ev: evOf(l, heist.prepsFor(l), heist.TIERS.at(-1), l.maxCrew) - cost };
    });
    check('voll vorbereitet lohnt es sich',
      prepared.every((x) => x.ev > 0),
      prepared.filter((x) => x.ev <= 0).map((x) => `${x.l.id}:${de(x.ev)}`).join(' '));
    console.log('     ℹ️  ' + prepared.map((x) => `${x.l.emoji} ${de(x.ev)}`).join(' · '));

    check('die Chance ist nach oben gedeckelt',
      heist.oddsOf({
        loc: loc('kiosk'), done: heist.PREPS, tier: heist.TIERS.at(-1),
        crewSize: 99, heat: 0,
      }).chance === heist.MAX_CHANCE);
    check('und nach unten',
      heist.oddsOf({
        loc: loc('goldtransport'), done: [], tier: heist.TIERS[0], crewSize: 1, heat: 100,
      }).chance === heist.MIN_CHANCE);
    check('Fahndung drückt die Chance',
      heist.oddsOf({ loc: loc('bank'), done: [], tier: heist.TIERS[3], crewSize: 3, heat: 100 })
        .chance
      < heist.oddsOf({ loc: loc('bank'), done: [], tier: heist.TIERS[3], crewSize: 3, heat: 0 })
        .chance);
    check('mehr Crew hilft, aber gedeckelt',
      heist.oddsOf({ loc: loc('bank'), done: [], tier: heist.TIERS[3], crewSize: 99, heat: 0 })
        .fromCrew === heist.CREW_BONUS_MAX);
    check('mehr Hände bringen mehr Beute, aber weniger je Kopf',
      heist.crewFactor(loc('bank'), 5) > 1
      && heist.crewFactor(loc('bank'), 5) / 5 < heist.crewFactor(loc('bank'), 3) / 3);
  }

  console.log('\n--- Planen, vorbereiten, durchziehen ---');
  {
    const U = player();
    const t0 = Date.now();

    check('unbekannte Ziele gibt es nicht',
      heist.plan(G, U, 'raumstation', t0).reason === 'unknown_location');

    const planned = heist.plan(G, U, 'tankstelle', t0);
    check('ein Ding lässt sich planen', planned.ok === true, planned.reason ?? '');
    check('man ist automatisch in der Crew',
      db.crewOf(planned.heist.id).length === 1);
    check('zwei Planungen gleichzeitig gehen nicht',
      heist.plan(G, U, 'kiosk', t0).reason === 'already_planning');

    cash = 1_000_000; bookings = 0;
    const prep = await heist.doPrep(G, U, 'auskundschaften', t0);
    check('ein Schritt lässt sich erledigen', prep.ok === true, prep.reason ?? '');
    check('und kostet genau einmal Geld', bookings === 1, String(bookings));
    check('derselbe Schritt nicht zweimal (§7)',
      (await heist.doPrep(G, U, 'auskundschaften', t0 + 10 * HOUR)).reason === 'already_done');
    check('Schritte, die nicht dazugehören, auch nicht',
      (await heist.doPrep(G, U, 'sprengung', t0 + 10 * HOUR)).reason === 'unknown_prep');

    const s = heist.status(G, U, t0);
    check('die Anzeige kennt den Fortschritt',
      s.heist.done === 1 && s.heist.total === loc('tankstelle').preps.length);
    check('und rechnet die Chance mit',
      s.heist.odds.fromPreps === heist.prep('auskundschaften').risk);

    // Ohne Ausrüstung geht das große Ding nicht.
    const arm = player({ gear: false, withCar: false });
    const bigPlan = heist.plan(G, arm, 'bank', t0);
    check('planen darf man auch ohne Ausrüstung', bigPlan.ok === true);
    const blocked = await heist.execute(G, arm, t0);
    check('durchziehen nicht',
      blocked.reason === 'too_few' || blocked.reason === 'gear', blocked.reason);
    heist.leave(G, arm, t0);
  }

  console.log('\n--- Crew ---');
  {
    const leader = player();
    const t0 = Date.now();
    const planned = heist.plan(G, leader, 'juwelier', t0);

    const mate = player();
    const joined = heist.join(G, mate, planned.heist.id, t0);
    check('andere können mitmachen', joined.ok === true, joined.reason ?? '');
    check('die Crew wächst', db.crewOf(planned.heist.id).length === 2);
    check('zweimal beitreten geht nicht',
      heist.join(G, mate, planned.heist.id, t0).reason === 'already_planning');

    check('nur der Anführer gibt das Startsignal',
      (await heist.execute(G, mate, t0)).reason === 'not_leader');

    const third = player();
    heist.join(G, third, planned.heist.id, t0);
    const out = heist.leave(G, third, t0);
    check('aussteigen geht', out.ok && !out.cancelled);
    check('und schrumpft die Crew', db.crewOf(planned.heist.id).length === 2);

    const off = heist.leave(G, leader, t0);
    check('der Anführer bläst das Ding ab', off.ok && off.cancelled);
    check('danach ist niemand mehr drin',
      db.crewOf(planned.heist.id).length === 0
      && db.getHeist(G, planned.heist.id).status === 'cancelled');
    check('und die Crew ist wieder frei',
      heist.plan(G, mate, 'kiosk', t0 + 13 * HOUR).ok === true);
    heist.leave(G, mate, t0 + 13 * HOUR);
  }

  console.log('\n--- Der Wurf ---');
  {
    // Erfolg erzwingen: Würfel liefert 0 → immer der beste Ausgang.
    const U = player();
    const t0 = Date.now();
    heist.plan(G, U, 'kiosk', t0);
    cash = 0; bookings = 0;
    const win = await heist.execute(G, U, t0, () => 0);
    check('ein Erfolg zahlt aus', win.ok && win.success && win.gross > 0, de(win.gross ?? 0));
    check('genau eine Buchung je Kopf (§9)', bookings === 1, String(bookings));
    const past = db.heistHistory(G, U, 1)[0];
    check('das Ding steht in der Akte', Boolean(past) && past.status === 'done',
      JSON.stringify(past?.status));
    check('und man ist aus der Planung raus', db.crewMembership(G, U) === null);
    check('die Fahndung steigt', heist.recordOf(G, U, t0).heat > 0,
      String(heist.recordOf(G, U, t0).heat));
    check('nicht sofort das nächste Ding',
      heist.plan(G, U, 'kiosk', t0 + HOUR).reason === 'cooldown');

    // Fehlschlag erzwingen: Würfel liefert 1 → immer der schlechteste Ausgang.
    const V = player();
    heist.plan(G, V, 'juwelier', t0);
    const W = player();
    heist.join(G, W, db.crewMembership(G, V).heist_id, t0);
    cash = 0; bookings = 0;
    const bust = await heist.execute(G, V, t0, () => 0.999);
    check('ein Fehlschlag kostet', bust.ok && !bust.success && cash < 0, de(cash));
    check('beide zahlen', bust.members.length === 2 && bust.members.every((m) => m.amount < 0));
    check('beide sitzen',
      heist.recordOf(G, V, t0).jailedMs > 0 && heist.recordOf(G, W, t0).jailedMs > 0);
    check('im Knast geht gar nichts',
      heist.plan(G, V, 'kiosk', t0 + HOUR).reason === 'jailed');
    check('ein Desaster kostet mehr als die Grundstrafe',
      Math.abs(bust.members[0].amount) > loc('juwelier').fine,
      de(Math.abs(bust.members[0].amount)));
  }

  console.log('\n--- Fahndung ---');
  {
    // heat_at = 0 hieße "nie gesetzt" – dann gibt es auch nichts abzubauen.
    const row = { heat: 100, heat_at: 1 };
    check('die Fahndung klingt ab', heist.heatNow(row, 1 + 5 * 24 * HOUR) < 100,
      String(heist.heatNow(row, 1 + 5 * 24 * HOUR).toFixed(1)));
    check('aber nicht sofort', heist.heatNow(row, 1 + HOUR) > 90);
    check('sie wird nie negativ', heist.heatNow(row, 1 + 400 * 24 * HOUR) >= 0);
    check('und nie größer als das Maximum',
      heist.heatNow({ heat: 999, heat_at: 1 }, 2) <= heist.HEAT_MAX);
  }

  console.log(`\n${pass} bestanden, ${fail} fehlgeschlagen`);
  process.exit(fail === 0 ? 0 : 1);
})();
