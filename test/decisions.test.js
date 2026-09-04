/**
 * Tests für die Entscheidungs-Vorfälle.
 *
 * Das Feature hat drei Versprechen, und alle drei werden hier geprüft:
 *
 *  1. **Keine Option ist sicher** – jede Wahl hat mehrere Ausgänge, und die
 *     Wirkungen greifen wirklich (Tippfehler in einem Wirkungsschlüssel wären
 *     sonst still wirkungslos).
 *  2. **Wegklicken hilft nicht** – wer nicht reagiert, fährt im Schnitt
 *     schlechter als jemand, der irgendetwas entscheidet.
 *  3. **Mit der Größe wird es gefährlicher** – mehr Vorfälle, härtere
 *     Ausgänge. Das ist die Antwort darauf, dass ein reiner Fleiß-Aufstieg
 *     die Aktivität langweilig macht.
 *
 * Aufruf: node test/decisions.test.js
 */
const db = require('../src/db');
const decisions = require('../src/decisions');
const creator = require('../src/creator');
const { DECISIONS } = require('../src/data/decisions');
const unb = require('../src/unb');

let pass = 0, fail = 0;
const check = (label, ok, extra = '') => {
  if (ok) { pass++; console.log(`  ✅ ${label}`); }
  else { fail++; console.log(`  ❌ ${label} ${extra}`); }
};

const G = `DECIDE_T${Date.now()}`;
const DAY_MS = 24 * 60 * 60 * 1000;
const de = (n) => Math.round(n).toLocaleString('de-DE');

let earned = 0;
let bookings = 0;
unb.changeCash = async (g, u, a) => { earned += a; bookings++; return { cash: a, bank: 0, total: a }; };
unb.getBalance = async () => ({ cash: 1_000_000, bank: 0, total: 1_000_000 });

/** Ein Spieler mit gesetzter Reichweite. */
function player(name, reach = 1_000_000) {
  db.clearCreator(G, name);
  const share = { twitch: 0.52, youtube: 0.24, instagram: 0.11, twitter: 0.13 };
  const now = Date.now();
  for (const [id, part] of Object.entries(share)) {
    const row = db.getCreator(G, name, id, now);
    db.saveCreator(G, name, id, {
      ...row, followers: Math.round(reach * part), touched_at: now, last_action_at: 0,
    });
  }
  return name;
}

const always = () => 0;         // trifft immer den ersten Ausgang
const never = () => 0.999;      // trifft immer den letzten

(async () => {
  console.log('--- Der Katalog ---');
  {
    check(`${DECISIONS.length} Vorfälle vorhanden`, DECISIONS.length >= 10);
    check('IDs sind eindeutig',
      new Set(DECISIONS.map((d) => d.id)).size === DECISIONS.length);
    check('jeder Vorfall hat Text, Titel und Emoji',
      DECISIONS.every((d) => d.title && d.text && d.emoji));
    check('jeder hat mindestens zwei Optionen',
      DECISIONS.every((d) => d.options.length >= 2));
    check('jede Option hat mindestens einen Ausgang mit Gewicht',
      DECISIONS.every((d) => d.options.every((o) =>
        o.outcomes.length >= 1 && o.outcomes.every((x) => x.weight > 0 && x.text))));
    check('jeder Vorfall hat einen Ausgang fürs Nichtstun',
      DECISIONS.every((d) => d.expire && d.expire.text));
    check('Plattform-Vorfälle nennen eine echte Plattform',
      DECISIONS.every((d) => !d.platform || creator.platform(d.platform)));

    /*
     * Der wichtigste Test des Katalogs: Ein Tippfehler in einem
     * Wirkungsschlüssel ("follower" statt "followers") wäre still wirkungslos –
     * der Vorfall liefe, ohne etwas zu tun.
     */
    const KEYS = new Set(['weight', 'text', 'followers', 'followersAll', 'community',
      'hype', 'cash', 'fatigue', 'lock', 'gear']);
    const strays = [];
    for (const d of DECISIONS) {
      for (const o of d.options) {
        for (const x of o.outcomes) {
          for (const k of Object.keys(x)) if (!KEYS.has(k)) strays.push(`${d.id}.${o.id}.${k}`);
        }
      }
      for (const k of Object.keys(d.expire)) if (!KEYS.has(k)) strays.push(`${d.id}.expire.${k}`);
    }
    check('keine unbekannten Wirkungsschlüssel', strays.length === 0, strays.join(' '));

    check('Plattform-Vorfälle wirken nicht netzwerkweit auf Follower',
      DECISIONS.every((d) => d.platform || d.options.every((o) =>
        o.outcomes.every((x) => x.followers === undefined))),
      'followers ohne Plattform wäre wirkungslos');
  }

  console.log('\n--- Risiko und Härte wachsen mit der Größe ---');
  {
    const small = decisions.riskFor(10_000);
    const big = decisions.riskFor(5_000_000);
    check('große Kanäle trifft es öfter', big > small, `${small} -> ${big}`);
    check('das Risiko ist gedeckelt', big === decisions.RISK_MAX);
    check('ganz ohne Risiko geht es nie', decisions.riskFor(0) === decisions.RISK_MIN);
    check('die Härte wächst und ist gedeckelt',
      decisions.severityFor(3_000_000) > decisions.severityFor(100_000)
      && decisions.severityFor(50_000_000) === decisions.SEVERITY_MAX);
    check('Geldwirkungen wachsen mit der Reichweite',
      decisions.scaleMoney(2_000_000, 1) > decisions.scaleMoney(50_000, 1) * 10);
  }

  console.log('\n--- Ein Vorfall von Anfang bis Ende ---');
  {
    const U = player('ablauf');
    const now = Date.now();
    const ev = decisions.roll(G, U, 1_000_000, now, always);
    check('ein Vorfall entsteht', Boolean(ev) && ev.status === 'open');
    check('es gibt nur einen gleichzeitig',
      decisions.roll(G, U, 1_000_000, now, always) === null);

    const open = decisions.pending(G, U, now);
    check('er lässt sich abrufen', open?.decision?.id === ev.kind);
    check('mit Restzeit', open.remainingMs > 0 && open.remainingMs <= decisions.DECIDE_MS);

    const before = db.allCreator(G, U).reduce((s, r) => s + r.followers, 0);
    earned = 0; bookings = 0;
    const res = await decisions.choose(G, U, ev.id, open.decision.options[0].id, now, always);
    check('die Entscheidung greift', res.ok === true, res.reason ?? '');
    check('sie hat einen Ausgangstext', Boolean(res.outcome.text));
    check('höchstens EINE Geldbuchung (§9)', bookings <= 1, String(bookings));

    const after = db.allCreator(G, U).reduce((s, r) => s + r.followers, 0);
    const changed = after !== before || earned !== 0
      || res.effect.community !== 0 || res.effect.locked.length > 0;
    check('die Wirkung ist wirklich angekommen', changed,
      `${de(before)} -> ${de(after)}, ${de(earned)}`);

    check('ein zweiter Klick läuft ins Leere (§7)',
      (await decisions.choose(G, U, ev.id, open.decision.options[0].id, now, always)).reason === 'gone');
    check('danach ist nichts mehr offen', decisions.pending(G, U, now) === null);
    check('er steht in der Historie',
      decisions.history(G, U).some((h) => h.id === ev.id && h.status === 'done'));
  }

  console.log('\n--- Wer nicht reagiert, zahlt drauf ---');
  {
    const U = player('ignorant');
    const now = Date.now();
    const ev = decisions.roll(G, U, 1_000_000, now, always);
    const before = db.allCreator(G, U).reduce((s, r) => s + r.followers, 0);

    check('vor Fristablauf passiert nichts',
      (await decisions.settle(G, U, now + 1000)).length === 0);

    const gone = await decisions.settle(G, U, now + decisions.DECIDE_MS + 1000);
    check('nach der Frist wirkt das Schweigen', gone.length === 1);
    check('mit eigenem Text', Boolean(gone[0].outcome.text));
    const after = db.allCreator(G, U).reduce((s, r) => s + r.followers, 0);
    check('und es kostet etwas', after < before || gone[0].effect.cash < 0,
      `${de(before)} -> ${de(after)}`);
    check('zweimal abrechnen geht nicht',
      (await decisions.settle(G, U, now + 5 * DAY_MS)).length === 0);
    check('zu spät entscheiden ist zu spät',
      (await decisions.choose(G, U, ev.id, 'x', now + 5 * DAY_MS)).ok === false);

    /*
     * Das Kernversprechen: Über den ganzen Katalog gerechnet ist Nichtstun
     * schlechter als eine beliebige Wahl. Sonst wäre Wegklicken die beste
     * Strategie – und das Feature wertlos.
     */
    const avg = (outcomes) => {
      const total = outcomes.reduce((s, o) => s + o.weight, 0);
      return outcomes.reduce((s, o) =>
        s + o.weight * ((o.followersAll ?? 0) + (o.followers ?? 0) * 0.5), 0) / total;
    };
    let ignoring = 0;
    let deciding = 0;
    for (const d of DECISIONS) {
      ignoring += ((d.expire.followersAll ?? 0) + (d.expire.followers ?? 0) * 0.5)
        * decisions.IGNORE_PENALTY;
      deciding += d.options.reduce((s, o) => s + avg(o.outcomes), 0) / d.options.length;
    }
    check('Nichtstun ist im Schnitt schlechter als irgendeine Wahl',
      ignoring < deciding,
      `Schweigen ${(ignoring * 100).toFixed(1)} % vs Wahl ${(deciding * 100).toFixed(1)} %`);
    console.log(`     ℹ️  über alle Vorfälle: Schweigen ${(ignoring * 100).toFixed(0)} %, ` +
      `Entscheiden ${(deciding * 100).toFixed(0)} % Followerwirkung`);
  }

  console.log('\n--- Sperren legen einen Kanal still ---');
  {
    const U = player('gesperrt');
    const now = new Date(new Date().setHours(9, 0, 0, 0)).getTime();
    const item = db.createItem({
      guildId: G, name: 'Kameraausrüstung', price: 3400, kind: 'gear', stock: null,
      createdBy: 't',
    });
    db.reservePurchase(G, U, item.id, 1);

    db.lockCreator(G, U, 'youtube', now + 2 * DAY_MS);
    const blocked = await creator.act(G, U, 'youtube', 'tutorial', now);
    check('gesperrte Kanäle nehmen keine Aktion an', blocked.reason === 'locked', blocked.reason);
    check('die Restzeit wird gemeldet', blocked.remainingMs > 0);

    const view = creator.status(G, U, now);
    check('die Ansicht zeigt die Sperre',
      view.platforms.find((p) => p.id === 'youtube').lockedMs > 0);

    const later = await creator.act(G, U, 'youtube', 'tutorial', now + 3 * DAY_MS);
    check('danach geht es weiter', later.ok === true, later.reason ?? '');
  }

  console.log('\n--- Abstand zwischen Vorfällen ---');
  {
    const U = player('takt');
    const now = Date.now();
    decisions.roll(G, U, 5_000_000, now, always);
    const first = decisions.pending(G, U, now);
    await decisions.choose(G, U, first.id, first.decision.options[0].id, now, always);

    check('direkt danach kommt kein neuer',
      decisions.roll(G, U, 5_000_000, now + 60_000, always) === null);
    check('nach dem Mindestabstand schon',
      decisions.roll(G, U, 5_000_000, now + decisions.MIN_GAP_MS + 1000, always) !== null);
  }

  console.log('\n--- Kein Gelddrucker (§3) ---');
  {
    // Die größte denkbare Auszahlung eines Vorfalls, gegen die Reichweite.
    const best = Math.max(...DECISIONS.flatMap((d) =>
      d.options.flatMap((o) => o.outcomes.map((x) => x.cash ?? 0))));
    check('kein Vorfall zahlt ohne Obergrenze',
      Number.isFinite(best) && best <= 50, String(best));
    check('Geldwirkungen hängen an der Reichweite und sind damit begrenzt',
      decisions.scaleMoney(0, 40) === 0
      && decisions.scaleMoney(1_000_000, 40) < decisions.scaleMoney(10_000_000, 40));

    // Positive Ausgänge dürfen NICHT durch die Härte verstärkt werden.
    const U = player('bonus', 5_000_000);
    const now = Date.now();
    const row = db.insertEvent({
      guildId: G, userId: U, kind: 'exklusivvertrag', platform: 'twitch',
      createdAt: now, expiresAt: now + DAY_MS,
    });
    earned = 0;
    await decisions.apply(G, U, row, { cash: 10 }, now);
    const plain = decisions.scaleMoney(5_000_000, 10);
    check('Größe verstärkt nur Verluste, keine Gewinne',
      earned === plain, `${de(earned)} vs ${de(plain)}`);
    earned = 0;
    await decisions.apply(G, U, row, { cash: -10 }, now, true);
    check('Verluste dagegen schon (Härte + Ignorierstrafe)',
      Math.abs(earned) > plain, `${de(Math.abs(earned))} vs ${de(plain)}`);
  }

  console.log(`\n${pass} bestanden, ${fail} fehlgeschlagen`);
  process.exit(fail === 0 ? 0 : 1);
})();
