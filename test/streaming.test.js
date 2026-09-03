/**
 * Tests für den Streaming-Kanal.
 *
 * Der spannende Teil ist ARCHITEKTUR §3. Streaming ist die erste Tätigkeit,
 * deren Ertrag mit dem eigenen Fortschritt **wächst** – genau die Form, aus
 * der sonst ein Gelddrucker wird. Verhindert wird es durch die Kurvenform:
 *
 *     Zuwachs  ~ follower^0.62   (unterlinear)
 *     Verlust  ~ follower        (linear)
 *
 * Daraus folgt ein Gleichgewicht. Hier wird es nachgerechnet – über hunderte
 * simulierte Karrieren, nicht an einem einzelnen Verlauf (der beweist nichts).
 *
 * Gerechnet wird auf `streaming.simulate`, dem reinen Kern ohne Datenbank.
 * Ein eigener Abschnitt prüft, dass die Verkabelung darum herum stimmt.
 *
 * Aufruf: node test/streaming.test.js
 */
const db = require('../src/db');
const streaming = require('../src/streaming');
const jobs = require('../src/jobs');
const gear = require('../src/data/gear');
const unb = require('../src/unb');

let pass = 0, fail = 0;
const check = (label, ok, extra = '') => {
  if (ok) { pass++; console.log(`  ✅ ${label}`); }
  else { fail++; console.log(`  ❌ ${label} ${extra}`); }
};

const G = `STREAM_T${Date.now()}`;
const DAY_MS = 24 * 60 * 60 * 1000;
const STEP = 95 * 60 * 1000;          // etwas mehr als der Cooldown

// Geld wird mitgezählt, aber nicht wirklich gebucht (§8).
let earned = 0;
let bookings = 0;
unb.changeCash = async (g, u, a) => { earned += a; bookings++; return { cash: a, bank: 0, total: a }; };
unb.getBalance = async () => ({ cash: 1_000_000, bank: 0, total: 1_000_000 });

const setup = db.createItem({
  guildId: G, name: streaming.GEAR, price: 3400, kind: 'gear', stock: null, createdBy: 't',
});

/** Ein Spieler mit Setup und frischem Kanal. */
function player(name) {
  db.clearChannel(G, name);
  if (!db.ownsNamed(G, name, streaming.GEAR)) db.reservePurchase(G, name, setup.id, 1);
  return name;
}

/** Deterministischer PRNG, damit ein Fehlschlag reproduzierbar ist. */
function rng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Eine Karriere auf dem reinen Kern: `days` Tage à MAX_STREAMS_PER_DAY
 * Sendungen, ohne Pause dazwischen.
 */
function career(catId, days, random, state = { followers: 0, subs: 0, hype: 1 }) {
  const cat = streaming.category(catId);
  let money = 0;
  const history = [];
  for (let day = 0; day < days; day++) {
    let earnedToday = 0;
    for (let k = 0; k < streaming.MAX_STREAMS_PER_DAY; k++) {
      const r = streaming.simulate(state, cat, { random });
      state = { followers: r.followers, subs: r.subs, hype: r.hype };
      earnedToday += r.base;
    }
    money += earnedToday;
    history.push({ day: day + 1, followers: state.followers, earnedToday });
  }
  return { state, money, history };
}

const median = (xs) => {
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.floor(s.length / 2)];
};
const quantile = (xs, q) => {
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.floor(s.length * q))];
};
const de = (n) => Math.round(n).toLocaleString('de-DE');

(async () => {
  console.log('--- Grundlagen ---');
  check('Setup ist Pflicht', (await streaming.stream(G, 'nackt', 'gaming')).reason === 'no_gear');
  check('unbekannte Kategorie wird abgelehnt',
    (await streaming.stream(G, player('kat'), 'karaoke')).reason === 'unknown_category');
  check('Reichweite wächst unterlinear',
    streaming.reachOf(10000) < 10 * streaming.reachOf(1000),
    `${Math.round(streaming.reachOf(10000))} statt ${Math.round(10 * streaming.reachOf(1000))}`);
  check('jede Kategorie ist vollständig beschrieben',
    streaming.CATEGORIES.every((c) =>
      c.id && c.name && c.emoji && c.reach > 0 && c.donate > 0 && c.follow > 0
      && c.risk > 0 && c.titles.length > 0));
  check('der Streamer-Job ist aus dem Arbeitsamt verschwunden',
    !jobs.JOBS.some((j) => (j.requires ?? []).some((r) => r.item === streaming.GEAR)),
    jobs.JOBS.filter((j) => (j.requires ?? []).some((r) => r.item === streaming.GEAR))
      .map((j) => j.id).join());
  check('das Setup gibt es weiterhin in der Ausrüstung',
    Boolean(gear.findGear(streaming.GEAR)));

  console.log('\n--- Kein Gelddrucker: die Reichweite läuft nicht davon (§3) ---');
  {
    const CAREERS = 300;
    const mid = [];
    const end = [];
    const perDay = [];

    for (let i = 0; i < CAREERS; i++) {
      const random = rng(1000 + i);
      const first = career('gaming', 100, random);
      mid.push(first.state.followers);
      const second = career('gaming', 100, random, first.state);
      end.push(second.state.followers);
      perDay.push(second.money / 100);
    }

    check('die Reichweite steht nach 100 Tagen still',
      median(end) < median(mid) * 1.5,
      `Tag 100: ${de(median(mid))} · Tag 200: ${de(median(end))}`);
    check('auch der beste Kanal explodiert nicht',
      quantile(end, 0.99) < 30000, de(quantile(end, 0.99)));
    check('der Tagesverdienst bleibt unter der Decke',
      quantile(perDay, 0.95) < 20000,
      `Median ${de(median(perDay))} · p95 ${de(quantile(perDay, 0.95))}`);
    console.log(`     ℹ️  ausgebauter Kanal: ${de(median(perDay))} pro Tag ` +
      `(${de(median(perDay) / streaming.MAX_STREAMS_PER_DAY)} je Sendung, ` +
      `${de(median(end))} Follower)`);

    // Der eigentliche Beweis: doppelt so lange spielen bringt NICHT doppelt
    // so viel Reichweite. Ohne Gleichgewicht müsste das Verhältnis ~2 sein.
    check('doppelte Spielzeit bringt keine doppelte Reichweite',
      median(end) / median(mid) < 1.35, String((median(end) / median(mid)).toFixed(2)));
  }

  console.log('\n--- Der Aufbau ist lang ---');
  {
    const random = rng(4711);
    const run = career('gaming', 100, random);
    const firstWeek = run.history.slice(0, 7).reduce((s, d) => s + d.earnedToday, 0) / 7;
    const lastWeek = run.history.slice(-7).reduce((s, d) => s + d.earnedToday, 0) / 7;
    check('die erste Woche ist mager', firstWeek < 1500, de(firstWeek));
    check('ein gewachsener Kanal verdient ein Vielfaches',
      lastWeek > firstWeek * 4, `${de(firstWeek)} -> ${de(lastWeek)}`);
    console.log(`     ℹ️  Woche 1: ${de(firstWeek)} pro Tag · Woche 14: ${de(lastWeek)} pro Tag`);
  }

  console.log('\n--- Kategorien unterscheiden sich wirklich ---');
  {
    const results = {};
    for (const cat of streaming.CATEGORIES) {
      const runs = Array.from({ length: 40 }, (_, i) => career(cat.id, 60, rng(9000 + i)));
      results[cat.id] = {
        followers: median(runs.map((r) => r.state.followers)),
        money: median(runs.map((r) => r.money)),
      };
    }
    const order = [...streaming.CATEGORIES].sort((a, b) => b.reach - a.reach);
    check('mehr Reichweite = mehr Follower',
      results[order[0].id].followers > results[order[order.length - 1].id].followers,
      Object.entries(results).map(([k, v]) => `${k}:${de(v.followers)}`).join(' '));
    check('jede Kategorie verdient etwas',
      Object.values(results).every((r) => r.money > 0));
    check('keine Kategorie ist unbrauchbar (schlechteste > 25 % der besten)',
      Math.min(...Object.values(results).map((r) => r.money))
        > 0.25 * Math.max(...Object.values(results).map((r) => r.money)),
      Object.entries(results).map(([k, v]) => `${k}:${de(v.money)}`).join(' '));
  }

  console.log('\n--- Abos bleiben gedeckelt ---');
  {
    const run = career('musik', 120, rng(99));
    check('Abos übersteigen nie ihren Anteil an den Followern',
      run.state.subs <= run.state.followers * streaming.MAX_SUB_SHARE + 1,
      `${de(run.state.subs)} von ${de(run.state.followers)}`);
    check('ein gewachsener Kanal hat Abos', run.state.subs > 1, de(run.state.subs));
  }

  console.log('\n--- Cooldown und Tagesgrenze ---');
  {
    const U = player('cool');
    // Fester Start am Morgen: Acht Sendungen à 95 Minuten passen so in EINEN
    // Tag. Mit Date.now() würde der Abschnitt je nach Uhrzeit über Mitternacht
    // rutschen und die Tagesgrenze scheinbar nicht greifen.
    const t0 = new Date(new Date().setHours(8, 0, 0, 0)).getTime();
    const first = await streaming.stream(G, U, 'gaming', t0);
    check('die erste Sendung geht durch', first.ok === true, first.reason ?? '');

    // Das Setup kann bei der Sendung kaputtgegangen sein – dann käme hier
    // 'no_gear' statt 'cooldown', weil die Ausrüstung zuerst geprüft wird.
    if (!db.ownsNamed(G, U, streaming.GEAR)) db.reservePurchase(G, U, setup.id, 1);
    const again = await streaming.stream(G, U, 'gaming', t0 + 1000);
    check('ein zweiter Klick prallt am Cooldown ab', again.reason === 'cooldown',
      again.reason ?? '');

    let now = t0; let done = 1; let limited = false;
    for (let i = 0; i < 8; i++) {
      now += STEP;
      if (!db.ownsNamed(G, U, streaming.GEAR)) db.reservePurchase(G, U, setup.id, 1);
      const r = await streaming.stream(G, U, 'gaming', now);
      if (r.ok) done++;
      else if (r.reason === 'daily_limit') { limited = true; break; }
    }
    check(`höchstens ${streaming.MAX_STREAMS_PER_DAY} Sendungen am Tag`,
      limited && done === streaming.MAX_STREAMS_PER_DAY, String(done));

    const tomorrow = now + DAY_MS;
    if (!db.ownsNamed(G, U, streaming.GEAR)) db.reservePurchase(G, U, setup.id, 1);
    const next = await streaming.stream(G, U, 'gaming', tomorrow);
    check('am nächsten Tag geht es weiter', next.ok === true, next.reason ?? '');
  }

  console.log('\n--- Der Kanal verfällt ohne Sendungen ---');
  {
    const U = player('pause');
    let now = Date.now();
    for (let i = 0; i < 12; i++) {
      if (!db.ownsNamed(G, U, streaming.GEAR)) db.reservePurchase(G, U, setup.id, 1);
      await streaming.stream(G, U, 'gaming', now);
      now += DAY_MS;                                  // ein Stream pro Tag
    }
    const before = db.getChannel(G, U).followers;
    check('nach zwölf Sendungen steht ein Kanal', before > 50, String(before));

    const later = now + 14 * DAY_MS;
    const view = streaming.status(G, U, later);
    check('zwei Wochen Pause kosten Follower', view.followers < before,
      `${before} -> ${view.followers}`);
    check('der Verlust wird beziffert', view.lostToIdle > 0, String(view.lostToIdle));
    check('Ansehen allein ändert nichts an der Datenbank',
      db.getChannel(G, U).followers === before);

    if (!db.ownsNamed(G, U, streaming.GEAR)) db.reservePurchase(G, U, setup.id, 1);
    const after = await streaming.stream(G, U, 'gaming', later);
    check('erst die nächste Sendung rechnet den Verlust ab',
      after.lostToIdle > 0, String(after.lostToIdle));
  }

  console.log('\n--- Verkabelung ---');
  {
    const U = player('kabel');
    earned = 0; bookings = 0;
    const res = await streaming.stream(G, U, 'chatting', Date.now());
    check('genau EINE Geldbuchung je Sendung (§9)', bookings === 1, String(bookings));
    check('gebucht wird die Summe aus Werbung, Spenden und Abos',
      earned === res.amount && res.base === res.ads + res.donations + res.subIncome,
      `${earned} vs ${res.amount}`);
    check('der Kanal steht danach in der Datenbank',
      db.getChannel(G, U).followers === Math.round(res.followers)
      && db.getChannel(G, U).streams === 1);
    check('die Meldung erwähnt Zuschauer und Geld',
      streaming.describe(res, (n) => `${n}`).includes(String(res.viewers)));
    check('Werbung ist die größte Einnahmequelle eines neuen Kanals',
      res.ads >= res.subIncome);
  }

  console.log(`\n${pass} bestanden, ${fail} fehlgeschlagen`);
  process.exit(fail === 0 ? 0 : 1);
})();
