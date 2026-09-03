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
    const CAREERS = 60;
    const MARKS = [100, 200, 400, 800];
    const at = Object.fromEntries(MARKS.map((m) => [m, []]));
    const perDay = [];

    for (let i = 0; i < CAREERS; i++) {
      const n = network(rng(5000 + i));
      let lastMoney = 0;
      for (let d = 1; d <= 800; d++) {
        if (d === 771) lastMoney = n.money;
        for (const [p, f] of PLAN_MIX) n.do(p, f);
        n.do('instagram', 'reel');
        n.endDay();
        if (at[d]) at[d].push(n.total());
      }
      perDay.push((n.money - lastMoney) / 30);
    }

    const m = Object.fromEntries(MARKS.map((k) => [k, median(at[k])]));
    const growth = (a, b) => m[b] / m[a];

    // DER Beweis: Jede Verdopplung der Spielzeit bringt WENIGER als die
    // vorige. Ohne Gleichgewicht bliebe das Verhältnis konstant oder stiege.
    check('jede Verdopplung der Spielzeit bringt weniger als die vorige',
      growth(200, 400) < growth(100, 200) && growth(400, 800) < growth(200, 400),
      `100→200: ${growth(100, 200).toFixed(2)} · 200→400: ${growth(200, 400).toFixed(2)} ` +
      `· 400→800: ${growth(400, 800).toFixed(2)}`);
    check('nach 400 Tagen steht die Reichweite praktisch still',
      growth(400, 800) < 1.1, growth(400, 800).toFixed(3));
    check('das Gleichgewicht ist endlich',
      quantile(at[800], 0.99) < 150000, de(quantile(at[800], 0.99)));
    check('der Tagesverdienst bleibt unter der Decke',
      quantile(perDay, 0.95) < 25000,
      `Median ${de(median(perDay))} · p95 ${de(quantile(perDay, 0.95))}`);
    console.log(`     ℹ️  Reichweite über die Zeit: ` +
      MARKS.map((k) => `Tag ${k}: ${de(m[k])}`).join(' · '));
    console.log(`     ℹ️  ausgebautes Netzwerk: ${de(median(perDay))} pro Tag`);
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

  console.log('\n--- Eigene Titel ---');
  {
    check('ein normaler Titel bleibt, wie er ist',
      creator.cleanTitle('Ich lese Steuerbescheide vor') === 'Ich lese Steuerbescheide vor');
    check('Erwähnungen werden entschärft',
      !creator.cleanTitle('<@123> @everyone hallo').includes('@everyone')
      && !creator.cleanTitle('<@123> hallo').includes('<@'),
      creator.cleanTitle('<@123> @everyone hallo'));
    check('Markdown und Zeilenumbrüche fliegen raus',
      creator.cleanTitle('**fett**\nzweite Zeile') === 'fett zweite Zeile',
      creator.cleanTitle('**fett**\nzweite Zeile'));
    check('zu lange Titel werden gekappt',
      creator.cleanTitle('x'.repeat(300)).length === 80);
    check('aus nichts wird nichts', creator.cleanTitle('   ') === null
      && creator.cleanTitle(null) === null);

    const U = player('titel');
    const t0 = new Date(new Date().setHours(11, 0, 0, 0)).getTime();
    refill(U);
    const wish = 'Ich lese drei Stunden lang Steuerbescheide vor';
    const res = await creator.act(G, U, 'twitch', 'gaming', t0, Math.random, wish);
    check('der eigene Titel wird benutzt',
      res.title === wish && res.customTitle === true, res.title);
    check('die Meldung zeigt ihn an',
      creator.describe(res, (n) => `${n}`).includes(wish));
    check('er steht danach am Kanal',
      db.getCreator(G, U, 'twitch').last_title === wish);
    check('und taucht in der Ansicht auf',
      creator.status(G, U, t0).platforms.find((p) => p.id === 'twitch').lastTitle === wish);

    refill(U);
    const preset = await creator.act(G, U, 'instagram', 'reel', t0 + 60_000);
    const titles = creator.format('instagram', 'reel').titles;
    check('ohne eigenen Titel entscheidet die Vorauswahl',
      titles.includes(preset.title) && preset.customTitle === false, preset.title);

    refill(U);
    const junk = await creator.act(G, U, 'twitter', 'witz', t0 + 120_000, Math.random, '   ');
    check('ein leerer Wunschtitel fällt auf die Vorauswahl zurück',
      creator.format('twitter', 'witz').titles.includes(junk.title), junk.title);
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

  console.log('\n--- Burnout ---');
  {
    check('ausgeruht gibt es keinen Malus', creator.energyFactor(0) === 1);
    check('der Malus ist gedeckelt',
      Math.abs(creator.energyFactor(creator.FATIGUE_MAX) - (1 - creator.FATIGUE_MALUS)) < 1e-9);
    check('Erschöpfung klingt in Pausen ab',
      creator.fatigueNow({ fatigue: 100, fatigue_at: 1 }, 1 + DAY_MS) < 100,
      String(creator.fatigueNow({ fatigue: 100, fatigue_at: 1 }, 1 + DAY_MS)));
    check('Vollgas kostet spürbar Reichweite, aber nie alles',
      creator.energyFactor(creator.FATIGUE_MAX) > 0.5
      && creator.energyFactor(creator.FATIGUE_MAX) < 0.9,
      String(creator.energyFactor(creator.FATIGUE_MAX)));

    // Zwei identische Tage, einmal frisch, einmal ausgebrannt.
    const U = player('burnout');
    const t0 = new Date(new Date().setHours(6, 0, 0, 0)).getTime();
    refill(U);
    const fresh = await creator.act(G, U, 'twitch', 'gaming', t0, rng(3).valueOf ? rng(3) : Math.random);
    check('die erste Aktion des Tages läuft mit voller Energie',
      fresh.ok && fresh.energy === 1, String(fresh.energy));

    let now = t0;
    for (let i = 0; i < 3; i++) {
      now += 100 * 60 * 1000;
      refill(U);
      await creator.act(G, U, 'instagram', 'reel', now);
    }
    const tired = creator.status(G, U, now);
    check('nach einem vollen Tag ist die Energie gesunken',
      tired.energy < 1 && tired.fatigue > 0,
      `${Math.round(tired.energy * 100)} % bei ${Math.round(tired.fatigue)}`);
    const rested = creator.status(G, U, now + 3 * DAY_MS);
    check('drei Tage später ist sie wieder da',
      rested.energy > tired.energy, `${rested.energy} > ${tired.energy}`);
  }

  console.log('\n--- Sponsorenverträge ---');
  {
    const U = player('deal');
    const now = Date.now();
    check('kleine Kanäle bekommen keine Anfragen',
      creator.rollDeal(G, U, 100, now, () => 0) === null);

    // Mit genug Reichweite und einem Würfel, der immer trifft.
    const offer = creator.rollDeal(G, U, 40000, now, () => 0.01);
    check('große Kanäle bekommen Anfragen', offer !== null && offer.status === 'offer');
    check('die Summe hängt an der Reichweite',
      offer.payout > 0 && offer.quota >= 2, `${offer.payout} für ${offer.quota}`);
    check('es gibt immer eine Vertragsstrafe',
      offer.penalty > 0 && offer.penalty < offer.payout, String(offer.penalty));
    check('Twitter wird nie beauftragt (dort läuft keine Werbung)',
      offer.platform !== 'twitter', offer.platform);

    const accepted = creator.accept(G, U, offer.id, now);
    check('ein Angebot lässt sich annehmen', accepted.ok === true, accepted.reason ?? '');
    check('danach läuft es', db.activeDeal(G, U)?.id === offer.id);

    const second = creator.rollDeal(G, U, 40000, now, () => 0.01);
    check('während ein Vertrag läuft, kommt keiner dazu', second === null);

    // Liefern: die passende Plattform bedienen, bis die Quote steht.
    const p = creator.platform(offer.platform);
    let t = now;
    let completed = null;
    earned = 0;
    for (let i = 0; i < offer.quota + 2 && !completed; i++) {
      t += (p.cooldownMin + 5) * 60 * 1000;
      // Zeitbudget frisch halten: jeder Beitrag an einem eigenen Tag.
      t += DAY_MS;
      refill(U);
      const r = await creator.act(G, U, offer.platform, offer.format || creator.formats(offer.platform)[0].id, t);
      if (r.ok && r.deal?.complete) completed = r;
    }
    check('erfüllte Verträge zahlen aus', completed !== null && earned >= offer.payout,
      `${earned} vs ${offer.payout}`);
    check('danach läuft kein Vertrag mehr', db.activeDeal(G, U) === null);
    check('der Vertrag steht als erfüllt in der Historie',
      db.dealHistory(G, U).some((d) => d.id === offer.id && d.status === 'done'));

    // Frist reißen lassen.
    const U2 = player('pleite');
    const late = creator.rollDeal(G, U2, 40000, now, () => 0.01);
    creator.accept(G, U2, late.id, now);
    earned = 0;
    const settled = await creator.settleDeals(G, U2, now + 30 * DAY_MS);
    check('eine gerissene Frist kostet Vertragsstrafe',
      settled.failed !== null && earned === -late.penalty, `${earned} vs ${-late.penalty}`);
    check('der geplatzte Vertrag ist beendet', db.activeDeal(G, U2) === null);

    // Angebote verfallen von selbst.
    const U3 = player('zoegern');
    const stale = creator.rollDeal(G, U3, 40000, now, () => 0.01);
    await creator.settleDeals(G, U3, now + 10 * DAY_MS);
    check('unbeantwortete Angebote verfallen',
      db.getDeal(G, stale.id).status === 'expired');
    check('ein verfallenes Angebot lässt sich nicht mehr annehmen',
      creator.accept(G, U3, stale.id, now + 10 * DAY_MS).ok === false);
  }

  console.log('\n--- Auch die Zusatzeinnahmen sind gedeckelt (§3) ---');
  {
    // Verträge: zehnfache Reichweite darf nicht das Zehnfache zahlen.
    const U = player('grenze');
    const fixed = () => 0.01;
    const small = creator.rollDeal(G, U, 10000, Date.now(), fixed);
    db.setDealStatus(G, small.id, 'expired');
    const big = creator.rollDeal(G, U, 100000, Date.now(), fixed);
    db.setDealStatus(G, big.id, 'expired');
    check('Verträge zahlen unterlinear zur Reichweite',
      big.payout / small.payout < 10 * (big.quota / small.quota),
      `${small.payout} -> ${big.payout}`);
    check('die Vertragsstrafe ist immer ein fester Anteil',
      Math.abs(big.penalty / big.payout - creator.DEAL_PENALTY) < 0.01);
    check('höchstens zwei Angebote liegen gleichzeitig herum',
      creator.DEAL_MAX_OFFERS <= 2);
  }

  console.log('\n--- Merch ---');
  {
    const U = player('merch');
    check('kleine Kanäle haben keinen Merch', !creator.merchUnlocked(100));
    check('ab der Schwelle schon', creator.merchUnlocked(creator.MERCH_MIN_REACH));

    // Community echt aufbauen (nur Tweets bringen sie), Reichweite gesetzt –
    // die Wachstumskurve ist an anderer Stelle geprüft und dauert hier zu lang.
    let now = Date.now();
    for (let d = 0; d < 12; d++) {
      refill(U);
      await creator.act(G, U, 'twitter', 'community', now);
      now += DAY_MS;
    }
    const row = db.getCreator(G, U, 'twitch');
    db.saveCreator(G, U, 'twitch', { ...row, followers: 12000, touched_at: now, last_action_at: now });
    const st = creator.status(G, U, now);
    check('ein gewachsener Kanal schaltet Merch frei',
      st.merch.unlocked && st.merch.perDay > 0,
      `${st.total} Follower, ${st.merch.perDay} pro Tag`);

    earned = 0;
    const first = await creator.settleMerch(G, U, now + 2 * DAY_MS);
    check('Merch zahlt über die Zeit', first && first.amount > 0, JSON.stringify(first));
    const before = earned;
    const again = await creator.settleMerch(G, U, now + 2 * DAY_MS + 60_000);
    check('sofort nochmal abrechnen bringt nichts', again === null && earned === before);

    earned = 0;
    await creator.settleMerch(G, U, now + 90 * DAY_MS);
    check('ein Rückstau ist gedeckelt',
      earned <= creator.MERCH_DAILY_CAP * 7 + 1, String(earned));
  }

  console.log(`\n${pass} bestanden, ${fail} fehlgeschlagen`);
  process.exit(fail === 0 ? 0 : 1);
})();
