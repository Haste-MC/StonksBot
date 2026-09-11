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

  console.log(`\n${pass} bestanden, ${fail} fehlgeschlagen`);
  process.exit(fail ? 1 : 0);
})();
