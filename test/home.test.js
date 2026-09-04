/**
 * Tests für Heimat und Inhaltssprache.
 *
 * Das Feature ist eine Weichenstellung, keine Optimierungsaufgabe – deshalb
 * prüfen diese Tests vor allem zwei Dinge:
 *
 *  1. **Die Abwägung stimmt.** Ein kleiner Sprachmarkt hat eine niedrigere
 *     Decke, wird aber schneller erreicht; ein großer ist zäh, aber offen.
 *     Der entscheidende Beweis: `speed` verschiebt die Obergrenze NICHT,
 *     `pool` skaliert sie linear. Sonst wäre die "schnelle" Wahl auch die
 *     größere und die Entscheidung keine.
 *  2. **Wechseln tut weh.** Die erste Wahl ist frei, danach kostet der Umzug
 *     Geld und Wohnung, der Sprachwechsel den größten Teil der Reichweite.
 *
 * Aufruf: node test/home.test.js
 */
const db = require('../src/db');
const home = require('../src/home');
const creator = require('../src/creator');
const property = require('../src/property');
const world = require('../src/data/world');
const unb = require('../src/unb');

let pass = 0, fail = 0;
const check = (label, ok, extra = '') => {
  if (ok) { pass++; console.log(`  ✅ ${label}`); }
  else { fail++; console.log(`  ❌ ${label} ${extra}`); }
};

const G = `HOME_T${Date.now()}`;
const de = (n) => Math.round(n).toLocaleString('de-DE');

let cash = 5_000_000;
let bookings = 0;
unb.changeCash = async (g, u, a) => { cash += a; bookings++; return { cash, bank: 0, total: cash }; };
unb.getBalance = async () => ({ cash, bank: 0, total: cash });
unb.withdrawFromBank = async () => ({ cash, bank: 0, total: cash });

let n = 0;
const player = (name) => { db.clearCreator(G, `${name}`); return `${name}_${n++}`; };

/** Die rechnerische Obergrenze einer Plattform in einem Markt. */
function ceiling(platformId, market) {
  const p = creator.platform(platformId);
  const f = creator.formats(platformId).reduce((a, b) => (b.follow > a.follow ? b : a));
  const shift = Math.pow(market.pool, -(1 - p.exp));
  const gain = p.k * p.follow * market.speed * f.follow;
  const loss = p.churnPerAction * market.speed * shift;
  return Math.pow(gain / loss, 1 / (1 - p.exp));
}

(async () => {
  console.log('--- Länder und Sprachen ---');
  {
    check(`${world.COUNTRIES.length} Länder, ${world.LANGUAGES.length} Sprachen`,
      world.COUNTRIES.length >= 15 && world.LANGUAGES.length >= 10);
    check('IDs sind eindeutig',
      new Set(world.COUNTRIES.map((c) => c.id)).size === world.COUNTRIES.length
      && new Set(world.LANGUAGES.map((l) => l.id)).size === world.LANGUAGES.length);
    check('jedes Land nennt eine existierende Sprache',
      world.COUNTRIES.every((c) => world.LANGUAGES.some((l) => l.id === c.language)),
      world.COUNTRIES.filter((c) => !world.LANGUAGES.some((l) => l.id === c.language))
        .map((c) => c.name).join());
    check('alle Werte sind sinnvoll',
      world.LANGUAGES.every((l) => l.pool > 0 && l.speed > 0 && l.money > 0 && l.blurb)
      && world.COUNTRIES.every((c) => c.market > 0 && c.flag && c.name));
    check('unbekannte IDs fallen auf den Standard zurück',
      home.country('atlantis').id === '' && home.language('elbisch').id === '');
    check('ohne Wahl ist der Markt neutral',
      JSON.stringify(home.marketOf(G, 'niemand')).includes('"pool":1'));

    // Die Kernabwägung muss im Katalog wirklich angelegt sein.
    const small = world.LANGUAGES.filter((l) => l.pool < 0.7);
    const big = world.LANGUAGES.filter((l) => l.pool >= 1.5);
    check('kleine Märkte binden schneller als große',
      small.reduce((s, l) => s + l.speed, 0) / small.length
        > big.reduce((s, l) => s + l.speed, 0) / big.length,
      `${small.length} kleine, ${big.length} große`);
  }

  console.log('\n--- Die Abwägung: klein & schnell gegen groß & langsam ---');
  {
    const neutral = { pool: 1, speed: 1, money: 1, deal: 1 };
    const fast = { pool: 1, speed: 1.5, money: 1, deal: 1 };
    const big = { pool: 3, speed: 1, money: 1, deal: 1 };

    check('Tempo verschiebt die Obergrenze NICHT',
      Math.abs(ceiling('twitch', fast) - ceiling('twitch', neutral)) < 1,
      `${de(ceiling('twitch', neutral))} vs ${de(ceiling('twitch', fast))}`);
    check('der Markt skaliert die Obergrenze linear',
      Math.abs(ceiling('twitch', big) / ceiling('twitch', neutral) - 3) < 0.05,
      String((ceiling('twitch', big) / ceiling('twitch', neutral)).toFixed(2)));

    const deutsch = home.language('deutsch');
    const englisch = home.language('englisch');
    const dCeil = ceiling('twitch', { ...neutral, pool: deutsch.pool, speed: deutsch.speed });
    const eCeil = ceiling('twitch', { ...neutral, pool: englisch.pool, speed: englisch.speed });
    check('Englisch hat die weit höhere Decke als Deutsch',
      eCeil > dCeil * 4, `${de(dCeil)} vs ${de(eCeil)}`);
    console.log(`     ℹ️  Twitch-Decke: 🥨 ${de(dCeil)} · 🌍 ${de(eCeil)} Follower`);

    // Tempo: Wie viele Aktionen bis zur halben Decke?
    const half = (market) => {
      const p = creator.platform('twitch');
      const f = creator.format('twitch', 'gaming');
      let state = { followers: 0, subs: 0, hype: 1, stock: 0 };
      const goal = ceiling('twitch', market) * 0.5;
      for (let i = 1; i <= 20000; i++) {
        const r = creator.simulate(state, p, f, { market, random: () => 0.5 });
        state = { followers: r.followers, subs: r.subs, hype: r.hype, stock: r.stock };
        if (state.followers >= goal) return i;
      }
      return Infinity;
    };
    const dSteps = half({ ...neutral, pool: deutsch.pool, speed: deutsch.speed });
    const eSteps = half({ ...neutral, pool: englisch.pool, speed: englisch.speed });
    check('der kleine Markt ist deutlich schneller halb voll',
      dSteps < eSteps, `${dSteps} vs ${eSteps} Aktionen`);
    console.log(`     ℹ️  bis zur halben Decke: 🥨 ${dSteps} · 🌍 ${eSteps} Aktionen`);

    check('volle Vermarktung kommt im kleinen Markt früher',
      creator.monetization(500_000, deutsch.pool) > creator.monetization(500_000, englisch.pool),
      `${creator.monetization(500_000, deutsch.pool).toFixed(2)} vs ` +
      `${creator.monetization(500_000, englisch.pool).toFixed(2)}`);
    check('jede Sprache hat einen endlichen Fixpunkt',
      world.LANGUAGES.every((l) =>
        Number.isFinite(ceiling('twitch', { pool: l.pool, speed: l.speed, money: 1, deal: 1 }))));
  }

  console.log('\n--- Heimat: einmal frei, danach Umzug ---');
  {
    const U = player('umzug');
    check('am Anfang wohnt man nirgends', home.settled(G, U) === false);

    bookings = 0;
    const first = await home.setHome(G, U, 'de');
    check('die erste Wahl ist kostenlos', first.ok && first.first && bookings === 0);
    check('sie wird gespeichert', home.homeOf(G, U).id === 'de');
    check('dasselbe Land nochmal geht nicht',
      (await home.setHome(G, U, 'de')).reason === 'already_there');
    check('Fantasieländer auch nicht',
      (await home.setHome(G, U, 'narnia')).reason === 'unknown_country');

    // Wohnung kaufen, dann wegziehen.
    const haus = db.createItem({
      guildId: G, name: `Haus ${U}`, price: 150_000, kind: 'property', stock: null,
      createdBy: 't', garage: 3,
    });
    await property.buy(G, U, haus.id);
    check('die Immobilie gibt zu Hause Stellplätze',
      property.capacity(G, U).owned === 3, String(property.capacity(G, U).owned));

    const cost = home.moveCost(G, U, 'jp');
    check('der Umzug kostet nach Kaufkraft des Ziels',
      cost === Math.round(home.MOVE_BASE * home.country('jp').market), String(cost));

    bookings = 0;
    const move = await home.setHome(G, U, 'jp');
    check('der Umzug klappt', move.ok && !move.first, move.reason ?? '');
    check('und kostet genau einmal Geld', bookings === 1, String(bookings));
    check('die Immobilie bleibt Eigentum',
      db.listOwnedProperties(G, U).some((x) => x.id === haus.id));
    check('gibt drüben aber keinen Stellplatz mehr',
      property.capacity(G, U).owned === 0, String(property.capacity(G, U).owned));
    check('sie zählt weiterhin zum Vermögen', db.propertyValue(G, U) >= 150_000);
    check('der Umzug ist gezählt', db.getStats(G, U).moves === 1);
    check('der nächste Umzug ist teurer',
      home.moveCost(G, U, 'jp') > cost, String(home.moveCost(G, U, 'jp')));

    // Wer nicht zahlen kann, zieht nicht um.
    const arm = player('arm');
    await home.setHome(G, arm, 'de');
    const before = cash;
    cash = 100;
    const denied = await home.setHome(G, arm, 'ch');
    check('ohne Geld kein Umzug', denied.reason === 'too_poor', denied.reason);
    check('und die Heimat bleibt', home.homeOf(G, arm).id === 'de');
    cash = before;
  }

  console.log('\n--- Mietvertrag endet beim Umzug ---');
  {
    const U = player('mieter');
    await home.setHome(G, U, 'de');
    const wohnung = db.createItem({
      guildId: G, name: `Mietwohnung ${U}`, price: 60_000, kind: 'property', stock: null,
      createdBy: 't', garage: 1, rent: 400,
    });
    await property.rent(G, U, wohnung.id);
    check('der Mietvertrag steht', Boolean(db.getRental(G, U)));

    const move = await home.setHome(G, U, 'br');
    check('der Umzug beendet ihn', move.ok && !db.getRental(G, U));
    check('und meldet es zurück', Boolean(move.rental));
  }

  console.log('\n--- Sprache: einmal frei, danach schmerzhaft ---');
  {
    const U = player('sprache');
    await home.setHome(G, U, 'de');
    const row = db.getCreator(G, U, 'twitch');
    db.saveCreator(G, U, 'twitch', { ...row, followers: 200_000, touched_at: Date.now() });

    const first = home.setLanguage(G, U, 'deutsch');
    check('die erste Sprache ist kostenlos', first.ok && first.first && first.lost === 0);
    check('sie wird gespeichert', home.languageOf(G, U).id === 'deutsch');
    check('Heimvorteil, wenn sie zum Land passt', home.marketOf(G, U).atHome === true);
    check('der Heimvorteil beschleunigt',
      home.marketOf(G, U).speed > home.language('deutsch').speed);

    const before = db.getCreator(G, U, 'twitch').followers;
    const now = Date.now() + home.LANGUAGE_COOLDOWN_MS + 1000;
    const switched = home.setLanguage(G, U, 'englisch', now);
    check('der Wechsel kostet Follower', switched.ok && switched.lost > 0, String(switched.lost));
    check('und zwar den vereinbarten Anteil',
      Math.abs(switched.lost / before - home.LANGUAGE_LOSS) < 0.02,
      `${(switched.lost / before * 100).toFixed(1)} %`);
    check('die Follower sind wirklich weg',
      db.getCreator(G, U, 'twitch').followers < before);
    check('danach ist die Sprache umgestellt', home.languageOf(G, U).id === 'englisch');
    check('kein Heimvorteil mehr', home.marketOf(G, U).atHome === false);

    const again = home.setLanguage(G, U, 'spanisch', now + 1000);
    check('sofort nochmal wechseln geht nicht', again.reason === 'cooldown', again.reason);
    check('mit Restzeit', again.remainingMs > 0);
    check('nach der Sperre wieder',
      home.setLanguage(G, U, 'spanisch', now + home.LANGUAGE_COOLDOWN_MS + 2000).ok === true);
  }

  console.log('\n--- Der Markt wirkt aufs Geld ---');
  {
    const p = creator.platform('twitch');
    const f = creator.format('twitch', 'gaming');
    const state = { followers: 500_000, subs: 2000, hype: 1, stock: 0 };
    const fixed = () => 0.5;
    const poor = creator.simulate(state, p, f,
      { market: { pool: 1, speed: 1, money: 0.3, deal: 1 }, random: fixed });
    const rich = creator.simulate(state, p, f,
      { market: { pool: 1, speed: 1, money: 1.4, deal: 1 }, random: fixed });
    check('teure Werbemärkte zahlen mehr', rich.money > poor.money * 2,
      `${de(poor.money)} vs ${de(rich.money)}`);

    check('Merch hängt an der Kaufkraft der Heimat',
      creator.merchPerDay(1_000_000, 100, 1.6) > creator.merchPerDay(1_000_000, 100, 0.5) * 2);

    const U = player('markt');
    await home.setHome(G, U, 'in');           // kaufkraftschwach
    home.setLanguage(G, U, 'hindi');
    const m = home.marketOf(G, U);
    check('Indien + Hindi: großer Topf, wenig Geld',
      m.pool > 1 && m.money < 0.5 && m.deal < 0.5,
      JSON.stringify({ pool: m.pool, money: m.money, deal: m.deal }));

    const V = player('schweiz');
    await home.setHome(G, V, 'ch');
    home.setLanguage(G, V, 'deutsch');
    const m2 = home.marketOf(G, V);
    check('Schweiz + Deutsch: kleiner Topf, viel Geld',
      m2.pool < 1 && m2.money > 1.2 && m2.deal > 1.5,
      JSON.stringify({ pool: m2.pool, money: m2.money, deal: m2.deal }));
  }

  console.log('\n--- Das Profilbild landet dort, wo Fluxer es zeigt ---');
  {
    const relay = require('../src/relay');
    const ui = require('../src/ui');
    const identity = require('../src/identity');
    const render = require('../src/fluxer/render');

    // Bewusst ein Fluxer-Konto (fx:): Nur dafür greift der Fluxer-Client.
    const U = `fx:${player('bild')}`;
    identity.remember(U, 'Testspieler');
    db.addStats(G, U, { xp: 500 });
    relay.register('fluxer', {
      users: { fetch: async (id) => ({ displayAvatarURL: () => `https://cdn.test/${id}.webp` }) },
    });

    const view = await ui.buildProfileView({ guildId: G, userId: U });
    const embed = view.embeds[0].data;
    check('das Profilbild steht im Autorblock',
      embed.author?.icon_url?.startsWith('https://cdn.test/'), JSON.stringify(embed.author));
    check('mit dem Anzeigenamen daneben', embed.author?.name === 'Testspieler');
    check('das Miniaturbild bleibt für das Auto frei',
      embed.thumbnail === undefined || !embed.thumbnail?.url?.includes('cdn.test'));

    // Der Autorblock ist genau das Feld, das die Fluxer-Ansicht überträgt.
    const message = render.toMessage(view, { userId: U });
    check('und übersteht die Fluxer-Übersetzung',
      Boolean(embed.author) && message.embed.author?.icon_url === embed.author?.icon_url);
  }

  console.log(`\n${pass} bestanden, ${fail} fehlgeschlagen`);
  process.exit(fail === 0 ? 0 : 1);
})();
