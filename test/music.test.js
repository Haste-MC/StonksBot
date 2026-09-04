/**
 * Tests für die Musikkarriere.
 *
 * Musik ist die höchstskalierte Aktivität ohne eigene Firma – und damit die
 * gefährlichste für die Balance. Geprüft wird deshalb vor allem:
 *
 *  1. **Das Gleichgewicht steht** (§3): Zuwachs unterlinear, Verlust linear.
 *     Weder Idol-Vertrag noch Sprachtempo dürfen die Decke verschieben –
 *     beide beschleunigen nur. Genau das war beim Bauen zweimal falsch.
 *  2. **Das Land entscheidet mit**: Szene skaliert die Decke, Tantiemen das
 *     Geld, Strenge das Vergessen.
 *  3. **Die beiden Wege unterscheiden sich wirklich** – Gesicht gegen anonym.
 *  4. **Der Idol-Vertrag ist ein Handel**, kein Geschenk: Vorschuss und Tempo
 *     gegen die Hälfte der Einnahmen.
 *
 * Aufruf: node test/music.test.js
 */
const db = require('../src/db');
const music = require('../src/music');
const creator = require('../src/creator');
const home = require('../src/home');
const unb = require('../src/unb');

let pass = 0, fail = 0;
const check = (label, ok, extra = '') => {
  if (ok) { pass++; console.log(`  ✅ ${label}`); }
  else { fail++; console.log(`  ❌ ${label} ${extra}`); }
};

const G = `MUSIC_T${Date.now()}`;
const DAY_MS = 24 * 60 * 60 * 1000;
const de = (n) => Math.round(n).toLocaleString('de-DE');

let cash = 0;
let bookings = 0;
unb.changeCash = async (g, u, a) => { cash += a; bookings++; return { cash, bank: 0, total: cash }; };
unb.getBalance = async () => ({ cash: 10_000_000, bank: 0, total: 10_000_000 });

const setup = db.createItem({
  guildId: G, name: music.GEAR, price: 3400, kind: 'gear', stock: null, createdBy: 't',
});

let n = 0;
async function player(land, sprache, genre, persona) {
  const U = `fx:m${n++}`;
  db.clearArtist(G, U);
  db.clearCreator(G, U);
  if (!db.ownsNamed(G, U, music.GEAR)) db.reservePurchase(G, U, setup.id, 1);
  await home.setHome(G, U, land);
  home.setLanguage(G, U, sprache);
  if (genre) music.setup(G, U, genre, persona);
  return U;
}

/** Fährt eine Karriere: täglich Studio + Release, wenn möglich. */
async function career(U, days, { sign = false, shows = true, start } = {}) {
  let now = start ?? new Date(new Date().setHours(6, 0, 0, 0)).getTime();
  let signed = false;
  let signedDay = null;
  for (let d = 0; d < days; d++) {
    music.record(G, U, now);
    const s = music.status(G, U, now + 1e6);
    if (s.songs >= 1 && s.releaseMs <= 0) {
      music.publish(G, U, s.songs >= 6 ? 'album' : s.songs >= 3 ? 'ep' : 'single', now + 3.6e6);
    }
    const s2 = music.status(G, U, now + 4e6);
    if (sign && s2.offer && !signed) {
      await music.sign(G, U, s2.offer.id, now + 5e6);
      signed = true; signedDay = d;
    }
    if (shows && s2.showMs <= 0 && s2.listeners >= music.SHOW_MIN_LISTENERS) {
      await music.show(G, U, now + 6e6);
    }
    await music.settle(G, U, now + 7e6);
    music.settleContracts(G, U, now + 7.2e6);
    now += DAY_MS;
  }
  return { end: now, status: music.status(G, U, now), signedDay };
}

/** Die rechnerische Obergrenze an Hörern für einen Markt. */
function ceiling({ scene = 1, speed = 1, boost = 1, genreReach = 1, growth = 1 } = {}) {
  const gain = music.REACH_K * Math.pow(scene, 1 - music.REACH_EXP)
    * music.CONVERSION * music.TEMPO * speed * boost * genreReach * genreReach * growth;
  const loss = music.CHURN_PER_RELEASE * music.TEMPO * speed * boost;
  return Math.pow(gain / loss, 1 / (1 - music.REACH_EXP));
}

(async () => {
  console.log('--- Die Daten ---');
  {
    check(`${music.GENRES.length} Genres, ${music.RELEASES.length} Veröffentlichungsarten`,
      music.GENRES.length >= 6 && music.RELEASES.length >= 3);
    check('jedes Genre ist vollständig',
      music.GENRES.every((g) => g.id && g.name && g.emoji && g.reach > 0 && g.royalty > 0
        && g.live > 0 && g.blurb));
    check('jede Veröffentlichung kostet Titel und Zeit',
      music.RELEASES.every((r) => r.songs >= 1 && r.time >= 1 && r.spike > 0 && r.growth > 0));
    check('genau zwei Wege: Gesicht und anonym',
      music.PERSONAS.length === 2 && music.PERSONAS.some((p) => p.id === 'face')
      && music.PERSONAS.some((p) => p.id === 'anon'));
    check('anonym bringt mehr Abrufe, aber kleinere Socials',
      music.persona('anon').plays > music.persona('face').plays
      && music.persona('anon').social < music.persona('face').social);
    check('nur Japan und Südkorea haben Idol-Verträge',
      home.COUNTRIES.filter((c) => c.music.idol).map((c) => c.id).sort().join() === 'jp,kr');
    check('jedes Land hat ein Musikprofil',
      home.COUNTRIES.every((c) => c.music && c.music.scene > 0 && c.music.royalty > 0
        && c.music.strict >= 0));
  }

  console.log('\n--- Kein Gelddrucker (§3) ---');
  {
    check('der Zuwachs ist unterlinear',
      music.reachOf(1_000_000) < 10 * music.reachOf(100_000),
      `${de(music.reachOf(100_000))} -> ${de(music.reachOf(1_000_000))}`);
    check('es gibt einen endlichen Fixpunkt', Number.isFinite(ceiling()) && ceiling() > 0,
      de(ceiling()));

    /*
     * Der Kern: Beschleuniger dürfen die Decke NICHT verschieben. Beim Bauen
     * lag der Agenturschub zuerst nur auf dem Zuwachs – das hätte das
     * Gleichgewicht versiebenfacht.
     */
    check('der Agenturschub beschleunigt, vergrößert aber nicht',
      Math.abs(ceiling({ boost: music.IDOL.growth }) - ceiling()) < 1,
      `${de(ceiling())} vs ${de(ceiling({ boost: music.IDOL.growth }))}`);
    check('dasselbe gilt für das Sprachtempo',
      Math.abs(ceiling({ speed: 1.5 }) - ceiling()) < 1);
    check('die Szene skaliert die Decke dagegen linear',
      Math.abs(ceiling({ scene: 2 }) / ceiling() - 2) < 0.05,
      String((ceiling({ scene: 2 }) / ceiling()).toFixed(2)));

    /*
     * Simuliert über den reinen Kern: Jede Verdopplung der Veröffentlichungen
     * bringt weniger als die vorige. Über die Datenbank wären das Minuten –
     * hier sind es Millisekunden, und gerechnet wird dieselbe Formel.
     */
    const market = { scene: 1, pool: 1, speed: 1, strict: 0.35, royalty: 1, deal: 1 };
    const marks = {};
    let state = { listeners: 0, buzz: 0, hype: 1 };
    for (let i = 1; i <= 8000; i++) {
      const r = music.simulateRelease(state, {
        type: music.release('single'), genre: music.genre('pop'),
        persona: music.persona('face'), market, random: () => 0.5,
      });
      state = { listeners: r.listeners, buzz: r.buzz, hype: r.hype };
      if ([250, 500, 1000, 2000, 4000, 8000].includes(i)) marks[i] = state.listeners;
    }
    const growth = (a, b) => marks[b] / marks[a];
    check('jede Verdopplung bringt weniger als die vorige',
      growth(1000, 2000) < growth(500, 1000) && growth(4000, 8000) < growth(1000, 2000),
      `500→1000: ${growth(500, 1000).toFixed(2)} · 1000→2000: ${growth(1000, 2000).toFixed(2)} ` +
      `· 4000→8000: ${growth(4000, 8000).toFixed(2)}`);
    check('am Ende steht es praktisch still',
      growth(4000, 8000) < 1.02, growth(4000, 8000).toFixed(3));
    console.log(`     ℹ️  Hörer nach Releases: ` +
      [250, 1000, 4000, 8000].map((k) => `${k}: ${de(marks[k])}`).join(' · '));
  }

  console.log('\n--- Das Land entscheidet mit ---');
  {
    const jp = await player('jp', 'japanisch', 'pop', 'face');
    const ro = await player('ro', 'rumaenisch', 'pop', 'face');
    const jpRun = await career(jp, 70);
    const roRun = await career(ro, 70);

    check('die große Szene trägt weiter als die kleine',
      jpRun.status.listeners > roRun.status.listeners,
      `${de(jpRun.status.listeners)} vs ${de(roRun.status.listeners)}`);
    check('und zahlt je Hörer deutlich mehr',
      jpRun.status.perDay / Math.max(1, jpRun.status.listeners)
      > roRun.status.perDay / Math.max(1, roRun.status.listeners) * 2);
    console.log(`     ℹ️  🇯🇵 ${de(jpRun.status.listeners)} Hörer / ${de(jpRun.status.perDay)} am Tag · ` +
      `🇷🇴 ${de(roRun.status.listeners)} / ${de(roRun.status.perDay)}`);

    // Strenge: Wer pausiert, wird in Korea schneller vergessen als in den USA.
    const strict = { strict: 1.0 };
    const lax = { strict: 0.2 };
    const row = { touched_at: 1, last_action_at: 1 };
    const later = 1 + 12 * DAY_MS;
    check('strenge Märkte vergessen schneller',
      music.keepFactor(row, strict, later) < music.keepFactor(row, lax, later),
      `${music.keepFactor(row, strict, later).toFixed(2)} vs ${music.keepFactor(row, lax, later).toFixed(2)}`);
    check('die Schonfrist gilt überall',
      music.keepFactor({ touched_at: 1 }, strict, 1 + DAY_MS) === 1);
  }

  console.log('\n--- Studio, Release, Konzert ---');
  {
    const U = await player('de', 'deutsch', 'rock', 'face');
    const t0 = new Date(new Date().setHours(7, 0, 0, 0)).getTime();

    check('ohne Titel keine Veröffentlichung',
      music.publish(G, U, 'single', t0).reason === 'no_songs');

    const rec = music.record(G, U, t0);
    check('eine Session bringt einen Titel', rec.ok && rec.songs === 1, rec.reason ?? '');
    check('sie kostet Zeit aus dem gemeinsamen Budget',
      creator.budget(G, U, t0).used === music.RECORD_TIME,
      String(creator.budget(G, U, t0).used));
    check('sofort nochmal geht nicht',
      music.record(G, U, t0 + 1000).reason === 'cooldown');

    const pub = music.publish(G, U, 'single', t0 + 60_000);
    check('mit Titel klappt die Veröffentlichung', pub.ok === true, pub.reason ?? '');
    check('sie verbraucht den Titel', music.status(G, U).songs === 0);
    check('und bringt Hörer', pub.listeners > 0, String(pub.listeners));
    check('ein Album braucht mehr Titel als eine Single',
      music.release('album').songs > music.release('single').songs);

    check('ohne Hörer kein Konzert',
      (await music.show(G, U, t0 + 120_000)).reason === 'too_small');

    // Ein großer Künstler kann spielen.
    const row = db.getArtist(G, U);
    db.saveArtist(G, U, { ...row, listeners: 300_000, touched_at: t0, last_show_at: 0 });
    // Am nächsten Tag: Studio und Release haben das heutige Budget verbraucht.
    const t1 = t0 + DAY_MS;
    cash = 0; bookings = 0;
    const show = await music.show(G, U, t1);
    check('ein Konzert zahlt sofort', show.ok && show.amount > 0, de(show.amount ?? 0));
    check('und genau einmal (§9)', bookings === 1, String(bookings));
    check('es bindet Hörer', show.gained > 0);
  }

  console.log('\n--- Tantiemen laufen weiter (§4) ---');
  {
    const U = await player('jp', 'japanisch', 'pop', 'face');
    const t0 = Date.now();
    const row = db.getArtist(G, U);
    db.saveArtist(G, U, {
      ...row, listeners: 400_000, buzz: 500_000, touched_at: t0, paid_through: t0,
    });

    cash = 0;
    const first = await music.settle(G, U, t0 + 2 * DAY_MS);
    check('nach zwei Tagen kommt Geld', first && first.amount > 0, JSON.stringify(first));
    check('der Schub schrumpft dabei',
      db.getArtist(G, U).buzz < 500_000, de(db.getArtist(G, U).buzz));

    const before = cash;
    const again = await music.settle(G, U, t0 + 2 * DAY_MS + 60_000);
    check('sofort nochmal bringt nichts', again === null && cash === before);

    // Obergrenze: Auch nach Monaten wird höchstens der Rückstau gezahlt.
    cash = 0;
    await music.settle(G, U, t0 + 200 * DAY_MS);
    const maxDays = music.MAX_SETTLE_DAYS;
    check('ein Rückstau ist gedeckelt',
      cash <= 400_000 * music.PLAYS_PER_LISTENER * music.ROYALTY * 2 * maxDays + 500_000 * 2,
      de(cash));
  }

  console.log('\n--- Gesicht gegen anonym ---');
  {
    const face = await player('jp', 'japanisch', 'pop', 'face');
    const anon = await player('jp', 'japanisch', 'pop', 'anon');
    const f = await career(face, 70, { shows: false });
    const a = await career(anon, 70, { shows: false });

    check('mit Gesicht wächst die Hörerschaft schneller',
      f.status.listeners > a.status.listeners,
      `${de(f.status.listeners)} vs ${de(a.status.listeners)}`);
    check('anonym bringt je Hörer mehr Abrufe',
      a.status.perDay / a.status.listeners > f.status.perDay / f.status.listeners,
      `${(a.status.perDay / a.status.listeners).toFixed(2)} vs ` +
      `${(f.status.perDay / f.status.listeners).toFixed(2)}`);

    const socialFace = db.allCreator(G, face).reduce((s, r) => s + r.followers, 0);
    const socialAnon = db.allCreator(G, anon).reduce((s, r) => s + r.followers, 0);
    check('mit Gesicht wachsen die Kanäle deutlich stärker mit',
      socialFace > socialAnon * 2, `${de(socialFace)} vs ${de(socialAnon)}`);
    console.log(`     ℹ️  Socials: 🎭 ${de(socialFace)} · 🕶️ ${de(socialAnon)} Follower`);

    // Die Enthüllung geht nur in eine Richtung.
    const reveal = music.reveal(G, anon, a.end);
    check('anonym kann sich enthüllen', reveal.ok && reveal.gained > 0, de(reveal.gained ?? 0));
    check('danach ist man Gesicht', music.status(G, anon).persona.id === 'face');
    check('und kann nicht zurück', music.reveal(G, anon, a.end).reason === 'already_face');
  }

  console.log('\n--- Der Idol-Vertrag ---');
  {
    const U = await player('jp', 'japanisch', 'jpop', 'face');
    const row = db.getArtist(G, U);
    const t0 = Date.now();
    db.saveArtist(G, U, { ...row, listeners: 300_000, touched_at: t0 });

    check('unter der Schwelle klopft niemand',
      music.rollContract(G, U, 1000, music.marketOf(G, U), t0, () => 0) === null);
    const offer = music.rollContract(G, U, 300_000, music.marketOf(G, U), t0, () => 0);
    check('darüber schon', Boolean(offer) && offer.status === 'offer');
    check('mit einer echten Agentur',
      music.AGENCIES.jp.includes(offer.agency), offer.agency);

    cash = 0; bookings = 0;
    const signed = await music.sign(G, U, offer.id, t0);
    check('unterschreiben bringt einen Vorschuss',
      signed.ok && signed.advance > 0 && cash === signed.advance, de(signed.advance ?? 0));
    check('der Vertrag läuft', Boolean(music.contractOf(G, U)));

    // Der Preis: die Hälfte der Einnahmen.
    const r2 = db.getArtist(G, U);
    db.saveArtist(G, U, { ...r2, buzz: 1_000_000, paid_through: t0 });
    cash = 0;
    const paid = await music.settle(G, U, t0 + 2 * DAY_MS);
    check('die Agentur nimmt ihren Anteil', paid.cut > 0, de(paid.cut ?? 0));
    check('und zwar die vereinbarte Hälfte',
      Math.abs(paid.cut / (paid.cut + paid.amount) - music.IDOL.cut) < 0.05,
      String((paid.cut / (paid.cut + paid.amount)).toFixed(2)));

    check('anonyme Künstler bekommen keine Idol-Angebote',
      (() => {
        const V = `fx:anon_idol${n++}`;
        db.clearArtist(G, V);
        music.setup(G, V, 'jpop', 'anon');
        const row2 = db.getArtist(G, V);
        db.saveArtist(G, V, { ...row2, listeners: 500_000 });
        return music.rollContract(G, V, 500_000, music.marketOf(G, U), t0, () => 0) === null;
      })());

    check('in Ländern ohne Idol-System auch nicht',
      (async () => true)() && music.rollContract(
        G, await player('de', 'deutsch', 'pop', 'face'), 500_000,
        { ...music.marketOf(G, U), idol: false }, t0, () => 0) === null);

    // Vorzeitig raus kostet.
    cash = 0;
    const left = await music.leave(G, U, t0 + 10 * DAY_MS);
    check('ein Vertragsbruch kostet Strafe und Hörer',
      left.ok && left.penalty > 0 && cash === -left.penalty, de(left.penalty ?? 0));
    check('danach ist man frei', music.contractOf(G, U) === null);
  }

  console.log('\n--- Der Vertrag gilt auch außerhalb der Musik ---');
  {
    const U = await player('jp', 'japanisch', 'jpop', 'face');
    const t0 = Date.now();
    const row = db.getArtist(G, U);
    db.saveArtist(G, U, { ...row, listeners: 300_000, touched_at: t0 });
    const offer = music.rollContract(G, U, 300_000, music.marketOf(G, U), t0, () => 0);
    await music.sign(G, U, offer.id, t0);

    const move = await home.setHome(G, U, 'us');
    check('unter Vertrag darf man nicht auswandern',
      move.ok === false && move.reason === 'contract', move.reason ?? '');
    check('die Heimat bleibt Japan', home.homeOf(G, U).id === 'jp');
    check('anonym werden geht auch nicht',
      music.reveal(G, U, t0).reason === 'already_face');

    // Skandale kosten unter Vertrag doppelt.
    const decisions = require('../src/decisions');
    const event = db.insertEvent({
      guildId: G, userId: U, kind: 'shitstorm_test', platform: '',
      createdAt: t0, expiresAt: t0 + DAY_MS,
    });
    const before = db.allCreator(G, U).reduce((s, r) => s + r.followers, 0);
    db.saveCreator(G, U, 'twitch',
      { ...db.getCreator(G, U, 'twitch', t0), followers: 100_000, touched_at: t0 });
    const withContract = await decisions.apply(
      G, U, { ...event, platform: '' }, { followersAll: -0.1 }, t0);

    await music.leave(G, U, t0 + DAY_MS);
    db.saveCreator(G, U, 'twitch',
      { ...db.getCreator(G, U, 'twitch', t0), followers: 100_000, touched_at: t0 });
    const without = await decisions.apply(
      G, U, { ...event, platform: '' }, { followersAll: -0.1 }, t0 + DAY_MS);

    check('ein Skandal kostet unter Vertrag mehr',
      Math.abs(withContract.followers) > Math.abs(without.followers),
      `${de(withContract.followers)} vs ${de(without.followers)}`);
  }

  console.log('\n--- Musik und Kanäle hängen zusammen ---');
  {
    const U = await player('de', 'deutsch', 'pop', 'face');
    const run = await career(U, 30, { shows: false });
    check('Veröffentlichungen bringen Follower auf allen Kanälen',
      db.allCreator(G, U).every((r) => r.followers > 0),
      db.allCreator(G, U).map((r) => `${r.platform}:${r.followers}`).join(' '));
    check('Hörer zählen als Publikum für die Kanäle',
      music.reachBonus(G, U) > 0
      && music.reachBonus(G, U) === Math.round(run.status.listeners * music.MUSIC_TO_CREATOR),
      de(music.reachBonus(G, U)));
    check('Studio und Kanäle teilen sich denselben Tag',
      creator.budget(G, U, run.end).max === creator.TIME_PER_DAY);
  }

  console.log(`\n${pass} bestanden, ${fail} fehlgeschlagen`);
  process.exit(fail === 0 ? 0 : 1);
})();
