/**
 * Tests für die Zufallsereignisse der Musikkarriere.
 *
 * Zwei Schichten, zwei Versprechen:
 *
 *  1. **Leichte Ereignisse** (data/musicEvents.js) feuern wirklich, hängen am
 *     Genre-Risiko und landen im Zustand – ein Tippfehler in einem
 *     Wirkungsschlüssel wäre sonst still wirkungslos.
 *  2. **Schwere Vorfälle** (data/musicDecisions.js) laufen durch das
 *     bestehende Entscheidungs-System, treffen nur die Künstlerzeile, und
 *     die Creator-Vorfälle bleiben davon unberührt.
 *
 * Dazu die §3-Messung: Mit Ereignissen darf der Hörer-Median nach einem
 * Jahr höchstens 10 % über dem ohne liegen.
 *
 * Aufruf: DATA_DIR=.testdata node test/musicEvents.test.js
 */
const db = require('../src/db');
const music = require('../src/music');
const decisions = require('../src/decisions');
const home = require('../src/home');
const unb = require('../src/unb');
const { MUSIC_DECISIONS } = require('../src/data/musicDecisions');
const { DECISIONS } = require('../src/data/decisions');
const { MUSIC_EVENTS, candidates } = require('../src/data/musicEvents');

let pass = 0, fail = 0;
const check = (label, ok, extra = '') => {
  if (ok) { pass++; console.log(`  ✅ ${label}`); }
  else { fail++; console.log(`  ❌ ${label} ${extra}`); }
};

const G = `MEVENT_T${Date.now()}`;
const DAY_MS = 24 * 60 * 60 * 1000;
const de = (n) => Math.round(n).toLocaleString('de-DE');

let cash = 0;
let bookings = 0;
unb.changeCash = async (g, u, a) => { cash += a; bookings++; return { cash, bank: 0, total: cash }; };
unb.getBalance = async () => ({ cash: 10_000_000, bank: 0, total: 10_000_000 });

/** Derselbe feste Würfel wie in scripts/messung-geldquellen.js. */
function rng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Feste Zahlenfolge; nach dem Ende kommt 0,5. */
function seq(...values) {
  let i = 0;
  return () => (i < values.length ? values[i++] : 0.5);
}

/**
 * Würfel für decisions.roll(): Der erste Aufruf (Risikoprüfung) trifft immer,
 * danach gleichverteilt (Auswahl der Vorlage). `() => 0` wäre falsch – die
 * Auswahl träfe dann immer die erste Vorlage.
 */
function hit(rand) {
  let first = true;
  return () => { if (first) { first = false; return 0; } return rand(); };
}

const setup = db.createItem({
  guildId: G, name: music.GEAR, price: 3400, kind: 'gear', stock: null, createdBy: 't',
});

let n = 0;
/** Ein Künstler mit Ausrüstung, Heimat Deutschland (kein Idol-Markt). */
async function artist({ genre = 'pop', persona = 'face', listeners = 0, songs = 0, land = 'de' } = {}) {
  const U = `fx:e${n++}`;
  db.clearArtist(G, U);
  db.clearCreator(G, U);
  db.clearEvents(G, U);
  if (!db.ownsNamed(G, U, music.GEAR)) db.reservePurchase(G, U, setup.id, 1);
  await home.setHome(G, U, land);
  home.setLanguage(G, U, 'deutsch');
  music.setup(G, U, genre, persona);
  const now = Date.now();
  const row = db.getArtist(G, U, now);
  db.saveArtist(G, U, {
    ...row, listeners, songs, touched_at: now, paid_through: now, last_action_at: now,
  });
  return U;
}

const gear = (U) => Boolean(db.ownsNamed(G, U, music.GEAR));
const refill = (U) => { if (!gear(U)) db.reservePurchase(G, U, setup.id, 1); };

(async () => {
  console.log('--- Der Katalog der schweren Vorfälle ---');
  {
    check('fünf Vorfälle', MUSIC_DECISIONS.length === 5, String(MUSIC_DECISIONS.length));
    const ids = new Set(MUSIC_DECISIONS.map((d) => d.id));
    check('IDs sind eindeutig', ids.size === MUSIC_DECISIONS.length);
    check('keine ID kollidiert mit einem Creator-Vorfall',
      DECISIONS.every((d) => !ids.has(d.id)));
    check('jeder hat Titel, Text, Emoji, Hörerschwelle',
      MUSIC_DECISIONS.every((d) => d.title && d.text && d.emoji && d.minListeners > 0));
    check('jeder hat mindestens zwei Optionen',
      MUSIC_DECISIONS.every((d) => d.options.length >= 2));
    check('jede Option hat gewichtete Ausgänge mit Text',
      MUSIC_DECISIONS.every((d) => d.options.every((o) =>
        o.outcomes.length >= 1 && o.outcomes.every((x) => x.weight > 0 && x.text))));
    check('jeder hat einen Ausgang fürs Nichtstun',
      MUSIC_DECISIONS.every((d) => d.expire && d.expire.text));

    // Ein Tippfehler im Schlüssel wäre still wirkungslos – deshalb die Liste.
    const KEYS = new Set(['weight', 'text', 'listeners', 'songsShare', 'hype',
      'lockRelease', 'lockShow', 'contract', 'gear', 'cash', 'publish', 'audience']);
    const strays = [];
    for (const d of MUSIC_DECISIONS) {
      for (const o of d.options) {
        for (const x of o.outcomes) {
          for (const k of Object.keys(x)) if (!KEYS.has(k)) strays.push(`${d.id}.${o.id}.${k}`);
        }
      }
      for (const k of Object.keys(d.expire)) if (!KEYS.has(k)) strays.push(`${d.id}.expire.${k}`);
    }
    check('keine unbekannten Wirkungsschlüssel', strays.length === 0, strays.join(' '));

    // Vertragsbruch bucht die Strafe selbst – ein zweites `cash` wäre §9-Bruch.
    check('contract:break nie zusammen mit cash',
      MUSIC_DECISIONS.every((d) => [...d.options.flatMap((o) => o.outcomes), d.expire]
        .every((x) => !(x.contract && x.cash))));
    check('requires nur mit bekannten Feldern',
      MUSIC_DECISIONS.every((d) => !d.requires
        || Object.keys(d.requires).every((k) => ['persona', 'songs', 'contract'].includes(k))));
  }

  console.log('\n--- Domänen bleiben getrennt ---');
  {
    const musicIds = new Set(MUSIC_DECISIONS.map((d) => d.id));
    const creatorIds = new Set(DECISIONS.map((d) => d.id));

    // Ein reiner Musiker: 1.000 Würfe mit Würfel, der immer einen Vorfall zieht.
    const U = await artist({ listeners: 100_000, songs: 5 });
    const got = new Set();
    let now = Date.now();
    for (let i = 0; i < 1000; i++) {
      const rand = rng(i + 1);
      const ev = decisions.roll(G, U, 100_000, now, hit(rand), 'music');
      if (ev) { got.add(ev.kind); db.resolveEvent(G, ev.id, { status: 'done', at: now }); }
      now += decisions.MIN_GAP_MS + 1000;
    }
    check('ein Musiker bekommt nur Musik-Vorfälle',
      [...got].every((k) => musicIds.has(k)), [...got].join(' '));
    check('… und zwar alle ohne Zulassungshürde (plagiat, stimme, album_leak)',
      got.has('plagiat') && got.has('stimme') && got.has('album_leak'), [...got].join(' '));
    check('… und skandal (100.000 Hörer, Gesicht)',
      got.has('skandal'), [...got].join(' '));
    check('… und nie label (kein Vertrag)', !got.has('label'));
    check('die Zeile trägt platform = music',
      decisions.roll(G, U, 100_000, now, () => 0, 'music')?.platform === 'music');
    db.clearEvents(G, U);

    // Ein reiner Creator: Standard-Domäne, keine Musik-IDs.
    const C = `fx:c${n++}`;
    db.clearCreator(G, C); db.clearEvents(G, C);
    const share = { twitch: 0.52, youtube: 0.24, instagram: 0.11, twitter: 0.13 };
    for (const [id, part] of Object.entries(share)) {
      const row = db.getCreator(G, C, id, now);
      db.saveCreator(G, C, id, { ...row, followers: Math.round(1_000_000 * part), touched_at: now });
    }
    const gotC = new Set();
    for (let i = 0; i < 300; i++) {
      const rand = rng(i + 7);
      const ev = decisions.roll(G, C, 1_000_000, now, hit(rand));
      if (ev) { gotC.add(ev.kind); db.resolveEvent(G, ev.id, { status: 'done', at: now }); }
      now += decisions.MIN_GAP_MS + 1000;
    }
    check('ein Creator bekommt nur Creator-Vorfälle',
      gotC.size > 0 && [...gotC].every((k) => creatorIds.has(k)), [...gotC].join(' '));
    check('decision() findet Musik-Vorlagen', decisions.decision('plagiat')?.title === 'Plagiatsvorwurf');
  }

  console.log('\n--- Zulassungskriterien ---');
  {
    const now = Date.now();
    const anon = await artist({ persona: 'anon', listeners: 100_000, songs: 5 });
    const kinds = (U, size, tries = 400) => {
      const out = new Set();
      let t = now;
      for (let i = 0; i < tries; i++) {
        const rand = rng(i + 3);
        const ev = decisions.roll(G, U, size, t, hit(rand), 'music');
        if (ev) { out.add(ev.kind); db.resolveEvent(G, ev.id, { status: 'done', at: t }); }
        t += decisions.MIN_GAP_MS + 1000;
      }
      return out;
    };
    const a = kinds(anon, 100_000);
    check('anonym: nie skandal', a.size > 0 && !a.has('skandal'), [...a].join(' '));

    const wenig = await artist({ listeners: 100_000, songs: 2 });
    const w = kinds(wenig, 100_000);
    check('unter 3 Songs: nie album_leak', w.size > 0 && !w.has('album_leak'), [...w].join(' '));

    const klein = await artist({ listeners: 6_000, songs: 5 });
    const k = kinds(klein, 6_000);
    check('bei 6.000 Hörern: plagiat und stimme, aber kein skandal/album_leak',
      k.has('plagiat') && k.has('stimme') && !k.has('skandal') && !k.has('album_leak'),
      [...k].join(' '));

    // Mit Vertrag: label wird möglich. Vertrag direkt in die Tabelle legen.
    const idol = await artist({ listeners: 150_000, songs: 5, land: 'jp' });
    const c = db.insertContract({
      guildId: G, userId: idol, kind: 'idol', agency: 'Test Ent.', country: 'jp',
      createdAt: now, expiresAt: now + DAY_MS,
    });
    db.setContractStatus(G, c.id, 'active', { signedAt: now, endsAt: now + 90 * DAY_MS });
    check('Vertrag ist aktiv (Voraussetzung)', Boolean(music.contractOf(G, idol)));
    const l = kinds(idol, 150_000);
    check('mit Vertrag: label kommt', l.has('label'), [...l].join(' '));
  }

  /** Legt einen offenen Musik-Vorfall an, ohne zu würfeln. */
  function openMusic(U, kind, now) {
    return db.insertEvent({
      guildId: G, userId: U, kind, platform: 'music',
      createdAt: now, expiresAt: now + decisions.DECIDE_MS,
    });
  }
  const first = () => 0;          // erster Ausgang der Option
  const last = () => 0.999;       // letzter Ausgang

  console.log('\n--- Jede Option jedes Vorfalls wirkt am Künstler ---');
  {
    const now = Date.now();
    const H = 100_000;
    const rel = (U) => music.status(G, U, now).releaseMs;
    const shw = (U) => music.status(G, U, now).showMs;

    // plagiat
    {
      const U = await artist({ listeners: H, songs: 4 });
      const perDay = music.royaltyPerDay(H, music.marketOf(G, U));
      cash = 0; bookings = 0;
      let ev = openMusic(U, 'plagiat', now);
      let r = await decisions.choose(G, U, ev.id, 'anwalt', now, first);
      check('plagiat/anwalt: -3 Tage Tantiemen', r.ok && cash < 0
        && Math.abs(cash) >= 3 * perDay * 0.99 && Math.abs(cash) <= 3 * perDay * 2.0,
        `${de(cash)} bei ${de(perDay)}/Tag`);
      check('… genau eine Buchung (§9)', bookings === 1, String(bookings));

      ev = openMusic(U, 'plagiat', now + 1);
      const hypeVor = db.getArtist(G, U).hype;
      r = await decisions.choose(G, U, ev.id, 'antworten', now + 1, first);
      check('plagiat/antworten (gut): Hype × 1,15',
        Math.abs(db.getArtist(G, U).hype - Math.min(music.HYPE_MAX, hypeVor * 1.15)) < 1e-9);

      ev = openMusic(U, 'plagiat', now + 2);
      const vor = db.getArtist(G, U).listeners;
      r = await decisions.choose(G, U, ev.id, 'ignorieren', now + 2, last);
      const nach = db.getArtist(G, U).listeners;
      check('plagiat/ignorieren (schlecht): Hörer −12 % (× Härte)',
        nach < vor && nach >= vor * (1 - 0.12 * decisions.SEVERITY_MAX) - 1
        && nach <= vor * 0.88 + 1, `${de(vor)} -> ${de(nach)}`);
    }

    // skandal
    {
      const U = await artist({ listeners: H, songs: 0 });
      let ev = openMusic(U, 'skandal', now);
      let vor = db.getArtist(G, U);
      await decisions.choose(G, U, ev.id, 'entschuldigen', now, first);
      let nach = db.getArtist(G, U);
      check('skandal/entschuldigen: −5 % Hörer und Hype × 0,9',
        nach.listeners < vor.listeners && nach.hype < vor.hype);

      ev = openMusic(U, 'skandal', now + 1);
      vor = db.getArtist(G, U);
      await decisions.choose(G, U, ev.id, 'gegenangriff', now + 1, first);
      nach = db.getArtist(G, U);
      check('skandal/gegenangriff (gut): Hype × 1,2, Hörer unverändert',
        nach.hype > vor.hype && nach.listeners === vor.listeners);

      ev = openMusic(U, 'skandal', now + 2);
      vor = db.getArtist(G, U);
      await decisions.choose(G, U, ev.id, 'aussitzen', now + 2, last);
      nach = db.getArtist(G, U);
      check('skandal/aussitzen (schlecht): −15 % Hörer',
        nach.listeners <= vor.listeners * 0.85 + 1, `${de(vor.listeners)} -> ${de(nach.listeners)}`);
    }

    // stimme
    {
      const U = await artist({ listeners: H });
      let ev = openMusic(U, 'stimme', now);
      await decisions.choose(G, U, ev.id, 'absagen', now, first);
      check('stimme/absagen: 7 Tage Konzertsperre',
        shw(U) > 6.9 * DAY_MS && shw(U) <= 7 * DAY_MS, de(shw(U) / DAY_MS));

      ev = openMusic(U, 'stimme', now + 1);
      const vor = db.getArtist(G, U);
      await decisions.choose(G, U, ev.id, 'playback', now + 1, first);
      check('stimme/playback (gut): keine Folgen',
        db.getArtist(G, U).listeners === vor.listeners && db.getArtist(G, U).hype === vor.hype);

      ev = openMusic(U, 'stimme', now + 2);
      await decisions.choose(G, U, ev.id, 'durchziehen', now + 2, last);
      check('stimme/durchziehen (schlecht): Hörer weg',
        db.getArtist(G, U).listeners < vor.listeners);
    }

    // album_leak
    {
      const U = await artist({ listeners: H, songs: 6 });
      let ev = openMusic(U, 'album_leak', now);
      const relVor = db.getArtist(G, U).releases;
      // Sperre aktiv setzen: ohne `force` läge ein normales Release jetzt auf
      // Kühlung – die folgenden Prüfungen beweisen so, dass `force` wirklich
      // durchgreift, statt zufällig auf einen freien Slot zu treffen.
      db.saveArtist(G, U, { ...db.getArtist(G, U), last_release_at: now });
      const r = await decisions.choose(G, U, ev.id, 'sofort', now, first);
      const a = db.getArtist(G, U);
      check('album_leak/sofort: ein Release entsteht, alle Titel weg',
        a.releases === relVor + 1 && a.songs === 0 && r.effect.published?.ok === true,
        `releases ${relVor} -> ${a.releases}, songs ${a.songs}`);
      check('… mit Publikum × 0,7 (Faktor durchgereicht)',
        r.effect.published?.audienceFactor === 0.7, String(r.effect.published?.audienceFactor));

      const V = await artist({ listeners: H, songs: 4 });
      ev = openMusic(V, 'album_leak', now);
      await decisions.choose(G, V, ev.id, 'neu', now, first);
      check('album_leak/neu: alle Titel weg, Hype × 1,1',
        db.getArtist(G, V).songs === 0 && db.getArtist(G, V).hype > 1);

      const W = await artist({ listeners: H, songs: 4 });
      ev = openMusic(W, 'album_leak', now);
      await decisions.choose(G, W, ev.id, 'ignorieren', now, first);
      check('album_leak/ignorieren (gut): die Hälfte bleibt', db.getArtist(G, W).songs === 2);

      // Ohne Titel: `publish` findet nichts zu tun (ok: false), trotzdem
      // bleiben songs = 0 – das Material ist so oder so draußen.
      const X = await artist({ listeners: H, songs: 0 });
      ev = openMusic(X, 'album_leak', now);
      const rx = await decisions.choose(G, X, ev.id, 'sofort', now, first);
      check('album_leak/sofort ohne Titel: publish scheitert, songs bleiben 0',
        rx.ok === true && rx.effect.published?.ok === false && db.getArtist(G, X).songs === 0,
        JSON.stringify(rx.effect.published));
    }

    // label
    {
      const U = await artist({ listeners: H, songs: 2, land: 'jp' });
      const c = db.insertContract({
        guildId: G, userId: U, kind: 'idol', agency: 'Test Ent.', country: 'jp',
        createdAt: now, expiresAt: now + DAY_MS,
      });
      db.setContractStatus(G, c.id, 'active', { signedAt: now, endsAt: now + 90 * DAY_MS });
      let ev = openMusic(U, 'label', now);
      await decisions.choose(G, U, ev.id, 'nachgeben', now, first);
      check('label/nachgeben: 7 Tage Release-Sperre',
        rel(U) > 6.9 * DAY_MS && rel(U) <= 7 * DAY_MS, de(rel(U) / DAY_MS));

      ev = openMusic(U, 'label', now + 1);
      cash = 0; bookings = 0;
      const r = await decisions.choose(G, U, ev.id, 'durchziehen', now + 1, last);
      check('label/durchziehen (schlecht): Vertrag geplatzt, Strafe gebucht',
        !music.contractOf(G, U) && db.getContract(G, c.id).status === 'broken'
        && cash < 0 && bookings === 1 && r.effect.contract,
        `status ${db.getContract(G, c.id).status}, ${de(cash)}, ${bookings} Buchungen`);
    }
  }

  console.log('\n--- Verfall bestraft ---');
  {
    const now = Date.now();
    const U = await artist({ listeners: 100_000 });
    const ev = openMusic(U, 'plagiat', now);
    const vor = db.getArtist(G, U).listeners;
    const gone = await decisions.settle(G, U, now + decisions.DECIDE_MS + 1);
    const nach = db.getArtist(G, U).listeners;
    // Härte bei 100.000 Hörern: 1 + 100000/3000000 × 0,6 = 1,02; × 1,6 Ignorieren = 1,632
    const erwartet = Math.round(vor * (1 - 0.12 * decisions.severityFor(100_000) * decisions.IGNORE_PENALTY));
    check('ein verfallener Vorfall wird abgerechnet', gone.length === 1 && gone[0].decision.id === 'plagiat');
    check('… mit Faktor 1,6 auf den Verlust', nach === erwartet, `${de(vor)} -> ${de(nach)}, erwartet ${de(erwartet)}`);
    check('danach ist nichts mehr offen', decisions.pending(G, U, now + decisions.DECIDE_MS + 2) === null);
    check('er steht in der Historie', decisions.history(G, U, 1)[0]?.status === 'expired');
  }

  console.log('\n--- Leichte Ereignisse: jedes feuert ---');
  {
    check('zwölf Ereignisse plus none', MUSIC_EVENTS.length === 13, String(MUSIC_EVENTS.length));
    check('none steht vorn mit Gewicht 110',
      MUSIC_EVENTS[0].id === 'none' && MUSIC_EVENTS[0].weight === 110);
    const KEYS = new Set(['id', 'weight', 'on', 'risky', 'text',
      'songs', 'breaks', 'hype', 'audience', 'pay', 'gain']);
    const strays = MUSIC_EVENTS.flatMap((e) => Object.keys(e).filter((k) => !KEYS.has(k)).map((k) => `${e.id}.${k}`));
    check('keine unbekannten Felder', strays.length === 0, strays.join(' '));
    check('jedes Ereignis außer none hat Text und genau eine Aktion',
      MUSIC_EVENTS.slice(1).every((e) => e.text && Array.isArray(e.on) && e.on.length === 1));

    const pop = music.genre('pop');
    for (const action of ['record', 'publish', 'show']) {
      const counts = {};
      const rand = rng(11);
      for (let i = 0; i < 2000; i++) {
        const e = music.rollMusicEvent(action, pop, rand);
        counts[e.id] = (counts[e.id] ?? 0) + 1;
      }
      const ids = MUSIC_EVENTS.filter((e) => e.on?.includes(action)).map((e) => e.id);
      check(`${action}: vier Ereignisse (${ids.join(', ')})`, ids.length === 4);
      check(`${action}: jedes kommt mindestens 15-mal`,
        ids.every((id) => (counts[id] ?? 0) >= 15),
        ids.map((id) => `${id}=${counts[id] ?? 0}`).join(' '));
      check(`${action}: none ist die Mehrheit`,
        counts.none > 1000, `none=${counts.none}`);
      check(`${action}: kein fremdes Ereignis`,
        Object.keys(counts).every((id) => id === 'none' || ids.includes(id)),
        Object.keys(counts).join(' '));
    }
  }

  console.log('\n--- Das Genre-Risiko wirkt ---');
  {
    const risky = new Set(MUSIC_EVENTS.filter((e) => e.risky).map((e) => e.id));
    check('sechs riskante Ereignisse', risky.size === 6, [...risky].join(' '));
    const count = (genreId) => {
      const g = music.genre(genreId);
      const rand = rng(23);
      let hits = 0;
      for (const action of ['record', 'publish', 'show']) {
        for (let i = 0; i < 2000; i++) if (risky.has(music.rollMusicEvent(action, g, rand).id)) hits++;
      }
      return hits;
    };
    const hiphop = count('hiphop');
    const klassik = count('klassik');
    // Erwartung: 1,3 / 0,5 = 2,6 auf die Gewichte; durch das feste none-Gewicht
    // liegt das Verhältnis der Treffer etwas darunter. Spanne aus der Spec: 2–3.
    check('Hip-Hop trifft Pannen 2- bis 3-mal so oft wie Klassik',
      hiphop / klassik >= 2 && hiphop / klassik <= 3,
      `${hiphop} / ${klassik} = ${(hiphop / klassik).toFixed(2)}`);
    check('candidates() liefert die Gewichte, mit denen gewürfelt wird',
      candidates('record', 1.3).find((c) => c.event.id === 'aufnahme').weight === 7 * 1.3
      && candidates('record', 1.3).find((c) => c.event.id === 'flow').weight === 7);
  }

  console.log(`\n${pass} bestanden, ${fail} fehlgeschlagen`);
  process.exit(fail ? 1 : 0);
})();
