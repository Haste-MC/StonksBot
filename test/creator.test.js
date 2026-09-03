/**
 * Tests für das Creator-Netzwerk (Twitch, YouTube, Instagram, Twitter).
 *
 * Drei Schwerpunkte:
 *
 *  1. **Jede Plattform verdient auf ihre Art** – und Twitter gar nicht. Das
 *     ist die inhaltliche Zusage des Features; wenn ein Tweet Geld bringt,
 *     ist es kaputt.
 *  2. **Kein Gelddrucker (§3)** – jetzt eine Ebene schwieriger als beim
 *     einzelnen Kanal: Vier Plattformen, die sich gegenseitig Follower
 *     zuspielen, könnten sich theoretisch hochschaukeln. Können sie nicht,
 *     weil der Übertrag INNERHALB der unterlinearen Wurzel steckt – hier über
 *     hunderte Karrieren nachgerechnet.
 *  3. **Faule Abrechnung des YouTube-Katalogs (§4)** – wiederholtes Aufrufen
 *     darf nichts erzeugen.
 *
 * Aufruf: node test/creator.test.js
 */
const db = require('../src/db');
const creator = require('../src/creator');
const jobs = require('../src/jobs');
const gear = require('../src/data/gear');
const unb = require('../src/unb');

let pass = 0, fail = 0;
const check = (label, ok, extra = '') => {
  if (ok) { pass++; console.log(`  ✅ ${label}`); }
  else { fail++; console.log(`  ❌ ${label} ${extra}`); }
};

const G = `CREATOR_T${Date.now()}`;
const DAY_MS = 24 * 60 * 60 * 1000;

let earned = 0;
let bookings = 0;
unb.changeCash = async (g, u, a) => { earned += a; bookings++; return { cash: a, bank: 0, total: a }; };
unb.getBalance = async () => ({ cash: 1_000_000, bank: 0, total: 1_000_000 });

// Ausrüstung, die zwei der vier Plattformen brauchen.
const items = {};
for (const name of ['Streaming-Setup', 'Kameraausrüstung']) {
  items[name] = db.createItem({
    guildId: G, name, price: 3400, kind: 'gear', stock: null, createdBy: 't',
  });
}

/** Ein Spieler mit kompletter Ausrüstung und leerem Netzwerk. */
function player(name) {
  db.clearCreator(G, name);
  for (const [gearName, item] of Object.entries(items)) {
    if (!db.ownsNamed(G, name, gearName)) db.reservePurchase(G, name, item.id, 1);
  }
  return name;
}

/** Sorgt dafür, dass die Ausrüstung nach einem Defekt wieder da ist. */
function refill(user) {
  for (const [gearName, item] of Object.entries(items)) {
    if (!db.ownsNamed(G, user, gearName)) db.reservePurchase(G, user, item.id, 1);
  }
}

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
 * Das Netzwerk als reine Rechnung – dieselbe Mathematik wie im Spiel, aber
 * ohne Datenbank. Nur so sind hunderte Karrieren in Sekunden zu simulieren.
 */
function network(random) {
  const state = {};
  const touched = {};
  for (const p of creator.PLATFORMS) {
    state[p.id] = { followers: 0, subs: 0, hype: 1, stock: 0 };
    touched[p.id] = null;
  }
  let community = 0, boost = 0, money = 0, day = 0;

  const decay = (id) => {
    const p = creator.platform(id);
    const idle = touched[id] === null ? 0 : Math.max(0, day - touched[id]);
    touched[id] = day;
    if (idle <= 0) return 1;
    return Math.pow(1 - p.churnPerDay * creator.churnFactor(community),
      Math.min(idle, creator.MAX_IDLE_DAYS));
  };

  return {
    state,
    get money() { return money; },
    get community() { return community; },
    get boost() { return boost; },
    total: () => Object.values(state).reduce((s, v) => s + v.followers, 0),
    do(platformId, formatId) {
      const p = creator.platform(platformId);
      const fmt = creator.format(platformId, formatId);
      const cross = Object.entries(state)
        .filter(([id]) => id !== platformId)
        .reduce((s, [, v]) => s + v.followers, 0);
      const idle = touched[platformId] === null ? 0 : Math.max(0, day - touched[platformId]);
      touched[platformId] = day;
      const r = creator.simulate(state[platformId], p, fmt,
        { cross, community, boost, idleDays: idle, random });
      state[platformId] = { followers: r.followers, subs: r.subs, hype: r.hype, stock: r.stock };
      for (const id of creator.PLATFORM_IDS) {
        if (id === platformId) continue;
        const keep = decay(id);
        state[id].followers = Math.max(0,
          state[id].followers * keep * (1 - (r.spillLoss ?? 0)) + r.spill);
      }
      community = Math.min(creator.COMMUNITY_MAX, community + (r.community ?? 0));
      boost = platformId === 'twitter' ? r.boost : 0;
      money += r.money;
      return r;
    },
    endDay() {
      // YouTube-Katalog: ein Tag Ausschüttung.
      const yt = state.youtube;
      const released = yt.stock * (1 - creator.YT_TAIL_KEEP);
      yt.stock -= released;
      money += Math.round(released * creator.YT_RPV);
      community *= 0.92;
      day++;
    },
  };
}

/** Fährt einen Tagesplan über `days` Tage. */
function career(plan, days, random) {
  const n = network(random);
  let lastMoney = 0;
  for (let d = 0; d < days; d++) {
    if (d === days - 30) lastMoney = n.money;
    for (const [p, f] of plan) n.do(p, f);
    n.endDay();
  }
  return { net: n, perDay: (n.money - lastMoney) / 30, total: n.total() };
}

const median = (xs) => [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)];
const quantile = (xs, q) => {
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.floor(s.length * q))];
};
const de = (n) => Math.round(n).toLocaleString('de-DE');

const PLAN_TWITCH = [['twitch', 'gaming'], ['twitch', 'gaming'], ['twitch', 'irl'], ['twitch', 'chatting']];
const PLAN_MIX = [['twitter', 'ankuendigung'], ['twitch', 'gaming'], ['twitch', 'irl'], ['youtube', 'highlights']];

(async () => {
  console.log('--- Die vier Plattformen ---');
  check('alle vier sind da',
    creator.PLATFORM_IDS.join(',') === 'twitch,youtube,instagram,twitter',
    creator.PLATFORM_IDS.join(','));
  check('jede Plattform ist vollständig beschrieben',
    creator.PLATFORMS.every((p) =>
      p.name && p.emoji && p.action && p.unit && p.followerName
      && p.base > 0 && p.k > 0 && p.exp > 0 && p.exp < 1
      && p.time > 0 && p.cooldownMin > 0 && creator.formats(p.id).length >= 4));
  check('jedes Format ist vollständig',
    creator.PLATFORMS.every((p) => creator.formats(p.id).every((f) =>
      f.id && f.name && f.emoji && f.reach > 0 && f.follow > 0 && f.risk > 0
      && f.titles.length > 0)));
  check('Reichweite wächst überall unterlinear',
    creator.PLATFORMS.every((p) => creator.reachOf(p, 10000) < 10 * creator.reachOf(p, 1000)));
  check('fremde Reichweite hilft, ersetzt aber nichts',
    creator.reachOf(creator.platform('twitch'), 1000, 9000)
      > creator.reachOf(creator.platform('twitch'), 1000)
    && creator.reachOf(creator.platform('twitch'), 1000, 9000)
      < creator.reachOf(creator.platform('twitch'), 10000),
    `${Math.round(creator.reachOf(creator.platform('twitch'), 1000, 9000))}`);
  check('der Streamer-Job ist aus dem Arbeitsamt verschwunden',
    !jobs.JOBS.some((j) => (j.requires ?? []).some((r) => r.item === 'Streaming-Setup')));
  check('Twitch und YouTube brauchen Ausrüstung, Instagram und Twitter nicht',
    creator.platform('twitch').gear && creator.platform('youtube').gear
    && !creator.platform('instagram').gear && !creator.platform('twitter').gear);
  check('die nötige Ausrüstung gibt es im Shop',
    creator.PLATFORMS.every((p) => !p.gear || gear.findGear(p.gear)));

  console.log('\n--- Jede Plattform verdient auf ihre Art ---');
  {
    const random = rng(7);
    const n = network(random);
    // Erst Reichweite aufbauen, damit die Zahlen aussagekräftig sind.
    for (let d = 0; d < 60; d++) {
      for (const [p, f] of PLAN_MIX) n.do(p, f);
      n.do('instagram', 'reel');
      n.endDay();
    }

    let twitterMoney = 0;
    let instaWithoutCoop = 0;
    let coops = 0;
    let ytStockGrew = 0;
    for (let i = 0; i < 400; i++) {
      const tw = n.do('twitter', ['meinung', 'witz', 'ankuendigung', 'community'][i % 4]);
      twitterMoney += tw.money;

      const ig = n.do('instagram', ['reel', 'foto', 'story', 'kooperation'][i % 4]);
      if (ig.coop) coops++; else instaWithoutCoop += ig.money;

      const before = n.state.youtube.stock;
      const yt = n.do('youtube', ['tutorial', 'vlog', 'essay', 'shorts'][i % 4]);
      if (yt.stock > before) ytStockGrew++;
      n.endDay();
    }

    check('Twitter zahlt NIE etwas', twitterMoney === 0, String(twitterMoney));
    check('Instagram zahlt ohne Kooperation nichts', instaWithoutCoop === 0, String(instaWithoutCoop));
    check('Kooperationen kommen aber vor', coops > 10, `${coops} von 400`);
    check('jedes Video füllt den YouTube-Katalog', ytStockGrew === 400, String(ytStockGrew));

    const stream = n.do('twitch', 'gaming');
    check('Twitch verdient an Werbung, Spenden und Abos',
      stream.money === stream.ads + stream.donations + stream.subIncome && stream.money > 0);
    check('ein Tweet erzeugt Promo für die nächste Aktion',
      n.do('twitter', 'ankuendigung').boost > 0);
    check('der Promo-Schub ist gedeckelt', n.boost <= creator.BOOST_MAX);
    check('Community-Tweets binden die Leute', n.community > 0, String(Math.round(n.community)));
    check('Community bremst den Schwund, hebt ihn aber nie auf',
      creator.churnFactor(creator.COMMUNITY_MAX) === 1 - creator.COMMUNITY_CHURN_CUT
      && creator.churnFactor(creator.COMMUNITY_MAX) > 0);
  }

  console.log('\n--- Das Netzwerk trägt sich gegenseitig ---');
  {
    const random = rng(11);
    const n = network(random);
    const before = { ...n.state };
    const r = n.do('twitter', 'ankuendigung');
    check('eine Aktion spült Follower zu den anderen Plattformen',
      r.spill > 0 && n.state.twitch.followers > 0 && n.state.youtube.followers > 0,
      `spill ${r.spill}`);
    check('Twitter überträgt am stärksten (reine Promo)',
      creator.SPREAD.twitter > creator.SPREAD.twitch);

    // Vergleich: dieselbe Zeit, einmal auf einer Plattform, einmal verteilt.
    const solo = median(Array.from({ length: 30 }, (_, i) => career(PLAN_TWITCH, 120, rng(200 + i)).total));
    const mixed = median(Array.from({ length: 30 }, (_, i) => career(PLAN_MIX, 120, rng(200 + i)).total));
    check('verteilt wächst die Gesamtreichweite stärker als auf einer Plattform',
      mixed > solo, `${de(mixed)} vs ${de(solo)}`);

    const soloMoney = median(Array.from({ length: 30 }, (_, i) => career(PLAN_TWITCH, 120, rng(300 + i)).perDay));
    const mixedMoney = median(Array.from({ length: 30 }, (_, i) => career(PLAN_MIX, 120, rng(300 + i)).perDay));
    check('live bleibt trotzdem die stärkste Geldquelle',
      soloMoney > mixedMoney * 0.9, `${de(soloMoney)} vs ${de(mixedMoney)}`);
    console.log(`     ℹ️  nur Twitch: ${de(soloMoney)} pro Tag / ${de(solo)} Follower · ` +
      `gemischt: ${de(mixedMoney)} pro Tag / ${de(mixed)} Follower`);
  }

  console.log('\n--- Kein Gelddrucker, auch nicht zu viert (§3) ---');
  {
    const CAREERS = 200;
    const mid = [];
    const end = [];
    const perDay = [];

    for (let i = 0; i < CAREERS; i++) {
      const random = rng(5000 + i);
      const n = network(random);
      const run = (days) => {
        let start = n.money;
        for (let d = 0; d < days; d++) {
          for (const [p, f] of PLAN_MIX) n.do(p, f);
          n.do('instagram', 'reel');
          n.endDay();
        }
        return (n.money - start) / days;
      };
      run(100);
      mid.push(n.total());
      const income = run(100);
      end.push(n.total());
      perDay.push(income);
    }

    check('die Gesamtreichweite steht nach 100 weiteren Tagen still',
      median(end) < median(mid) * 1.5, `Tag 100: ${de(median(mid))} · Tag 200: ${de(median(end))}`);
    check('doppelte Spielzeit bringt keine doppelte Reichweite',
      median(end) / median(mid) < 1.4, String((median(end) / median(mid)).toFixed(2)));
    check('kein einziges Netzwerk explodiert',
      quantile(end, 0.99) < 150000, de(quantile(end, 0.99)));
    check('der Tagesverdienst bleibt unter der Decke',
      quantile(perDay, 0.95) < 25000,
      `Median ${de(median(perDay))} · p95 ${de(quantile(perDay, 0.95))}`);
    console.log(`     ℹ️  ausgebautes Netzwerk: ${de(median(perDay))} pro Tag, ` +
      `${de(median(end))} Follower über alle Plattformen`);
  }

  console.log('\n--- Reichweite verfällt, auch auf vergessenen Kanälen ---');
  {
    const U = player('pause');
    let now = new Date(new Date().setHours(8, 0, 0, 0)).getTime();
    for (let d = 0; d < 15; d++) {
      refill(U);
      await creator.act(G, U, 'twitch', 'gaming', now);
      await creator.act(G, U, 'twitter', 'ankuendigung', now + 60_000);
      now += DAY_MS;
    }
    const built = creator.status(G, U, now);
    check('nach 15 Tagen steht ein Netzwerk', built.total > 200, String(built.total));

    const insta = built.platforms.find((p) => p.id === 'instagram');
    check('Instagram ist allein durch Überträge gewachsen',
      insta.followers > 0, String(insta.followers));

    const later = now + 20 * DAY_MS;
    const view = creator.status(G, U, later);
    check('drei Wochen Pause kosten überall Follower',
      view.total < built.total, `${built.total} -> ${view.total}`);
    check('Ansehen allein ändert nichts an der Datenbank',
      db.allCreator(G, U).reduce((s, r) => s + r.followers, 0)
        === built.platforms.reduce((s, p) => s + p.followers, 0));

    // Der Kern des Verfalls: Auch ein Kanal, auf dem man NIE etwas macht,
    // schrumpft – sonst ließe sich Reichweite dort dauerhaft parken.
    const instaBefore = db.getCreator(G, U, 'instagram').followers;
    refill(U);
    await creator.act(G, U, 'twitch', 'gaming', later);
    const instaAfter = db.getCreator(G, U, 'instagram').followers;
    check('auch ein nie benutzter Kanal verfällt',
      instaAfter < instaBefore + 200, `${instaBefore} -> ${instaAfter}`);
  }

  console.log('\n--- Der YouTube-Katalog (§4) ---');
  {
    const U = player('katalog');
    const t0 = new Date(new Date().setHours(9, 0, 0, 0)).getTime();
    refill(U);
    await creator.act(G, U, 'youtube', 'tutorial', t0);
    const stock = db.getCreator(G, U, 'youtube').stock;
    check('ein Video hinterlässt Aufrufe im Katalog', stock > 0, de(stock));

    earned = 0;
    const first = await creator.settle(G, U, t0 + 2 * DAY_MS);
    check('nach zwei Tagen zahlt der Katalog', first && first.amount > 0, JSON.stringify(first));
    check('der Vorrat schrumpft dabei',
      db.getCreator(G, U, 'youtube').stock < stock,
      `${de(stock)} -> ${de(db.getCreator(G, U, 'youtube').stock)}`);

    const before = earned;
    const again = await creator.settle(G, U, t0 + 2 * DAY_MS + 60_000);
    check('sofort nochmal abrechnen bringt nichts', again === null && earned === before);

    // Die Obergrenze: Der Katalog kann nie mehr auszahlen, als in ihm steckt.
    let total = 0;
    for (let d = 3; d < 60; d++) {
      const r = await creator.settle(G, U, t0 + d * DAY_MS);
      if (r) total += r.amount;
    }
    check('der Katalog zahlt insgesamt höchstens seinen Inhalt aus',
      first.amount + total <= Math.ceil(stock * creator.YT_RPV) + 1,
      `${de(first.amount + total)} von ${de(stock * creator.YT_RPV)}`);
  }

  console.log('\n--- Zeitbudget und Cooldowns ---');
  {
    const U = player('zeit');
    const t0 = new Date(new Date().setHours(7, 0, 0, 0)).getTime();
    refill(U);
    const first = await creator.act(G, U, 'twitch', 'gaming', t0);
    check('die erste Aktion geht durch', first.ok === true, first.reason ?? '');
    refill(U);
    const again = await creator.act(G, U, 'twitch', 'gaming', t0 + 1000);
    check('zweimal hintereinander streamen geht nicht', again.reason === 'cooldown', again.reason);

    // Andere Plattform hat einen eigenen Cooldown.
    const tweet = await creator.act(G, U, 'twitter', 'witz', t0 + 1000);
    check('eine andere Plattform ist trotzdem frei', tweet.ok === true, tweet.reason ?? '');

    // Budget leerfahren: Stream 2 + Tweet 1 = 3, es bleiben 5.
    let now = t0;
    let spent = 3;
    let blocked = null;
    for (let i = 0; i < 12 && !blocked; i++) {
      now += 50 * 60 * 1000;
      refill(U);
      const r = await creator.act(G, U, 'instagram', 'reel', now);
      if (r.ok) spent += 1;
      else if (r.reason === 'no_time') blocked = r;
    }
    check(`das Tagesbudget von ${creator.TIME_PER_DAY} greift`,
      blocked !== null && spent === creator.TIME_PER_DAY, `${spent} verbraucht`);
    check('die Meldung sagt, was noch übrig ist',
      blocked && blocked.left >= 0 && blocked.need > 0);

    const tomorrow = now + DAY_MS;
    refill(U);
    const next = await creator.act(G, U, 'instagram', 'reel', tomorrow);
    check('am nächsten Tag ist das Budget wieder voll', next.ok === true, next.reason ?? '');
  }

  console.log('\n--- Verkabelung ---');
  {
    const U = player('kabel');
    const t0 = new Date(new Date().setHours(10, 0, 0, 0)).getTime();
    earned = 0; bookings = 0;
    refill(U);
    const res = await creator.act(G, U, 'twitch', 'chatting', t0);
    check('genau EINE Geldbuchung je Aktion (§9)', bookings === 1, String(bookings));
    check('gebucht wird genau der ausgewiesene Betrag', earned === res.amount);
    check('der Kanal steht danach in der Datenbank',
      db.getCreator(G, U, 'twitch').followers === res.followers
      && db.getCreator(G, U, 'twitch').actions === 1);
    check('die anderen Plattformen haben den Übertrag bekommen',
      db.getCreator(G, U, 'instagram').followers === res.spill, String(res.spill));

    bookings = 0;
    const tweet = await creator.act(G, U, 'twitter', 'community', t0 + 60_000);
    check('ein Tweet bucht gar kein Geld (§9: nie netto 0)', bookings === 0 && tweet.amount === 0);
    check('die Meldung sagt klar, dass Twitter nichts zahlt',
      creator.describe(tweet, (n) => `${n}`).includes('keinen Cent'));

    const unknown = await creator.act(G, U, 'tiktok', 'tanz', t0);
    check('unbekannte Plattformen werden abgelehnt', unknown.reason === 'unknown_platform');
    const badFormat = await creator.act(G, U, 'twitch', 'asmr', t0);
    check('unbekannte Formate werden abgelehnt', badFormat.reason === 'unknown_format');
  }

  console.log(`\n${pass} bestanden, ${fail} fehlgeschlagen`);
  process.exit(fail === 0 ? 0 : 1);
})();
