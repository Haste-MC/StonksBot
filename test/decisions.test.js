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
const music = require('../src/music');

/*
 * Ein zweiter, nur LESENDER Zugang auf dieselbe Datei. Gebraucht wird er für
 * genau eine Zusicherung, die über die Modulgrenze nicht sichtbar ist: Ein
 * Lesen der Vorfall-Uhr darf keine Zeile anlegen (§4). Ohne Zählung von außen
 * wäre „legt keine Zeile an" nicht prüfbar – db.decisionUhr liefert in beiden
 * Fällen dieselben Vorgaben zurück.
 */
const { DatabaseSync } = require('node:sqlite');
const nodePath = require('node:path');
const roh = new DatabaseSync(nodePath.join(
  process.env.DATA_DIR ? nodePath.resolve(process.env.DATA_DIR)
    : nodePath.join(__dirname, '..', 'data'), 'shop.db'), { readOnly: true });
const uhrZeilen = (g, u) => roh.prepare(
  'SELECT COUNT(*) AS n FROM decision_uhr WHERE guild_id = ? AND user_id = ?')
  .get(g, String(u)).n;

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

/**
 * Ein Spieler mit gesetzter Reichweite.
 *
 * `actions: 1` gehört dazu: Daran erkennt `decisions.betreten`, dass der Bereich
 * wirklich benutzt wurde (nur `creator.act` zählt es hoch). Ohne das wäre dieser
 * Spieler eine leere, automatisch angelegte Zeile – und würfelte zu Recht nicht.
 * `last_action_at` bleibt 0, damit kein Cooldown in den Tests steht.
 */
function player(name, reach = 1_000_000) {
  db.clearCreator(G, name);
  const share = { twitch: 0.52, youtube: 0.24, instagram: 0.11, twitter: 0.13 };
  const now = Date.now();
  for (const [id, part] of Object.entries(share)) {
    const row = db.getCreator(G, name, id, now);
    db.saveCreator(G, name, id, {
      ...row, followers: Math.round(reach * part), actions: 1,
      touched_at: now, last_action_at: 0,
    });
  }
  return name;
}

// roll() verlangt für Musik und Creator `schonGewuerfelt` – nur tick würfelt die Rate.
const SCHON = { schonGewuerfelt: true };
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
    const ev = decisions.roll(G, U, 1_000_000, now, always, 'creator', SCHON);
    check('ein Vorfall entsteht', Boolean(ev) && ev.status === 'open');
    check('es gibt nur einen gleichzeitig',
      decisions.roll(G, U, 1_000_000, now, always, 'creator', SCHON) === null);

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
    const ev = decisions.roll(G, U, 1_000_000, now, always, 'creator', SCHON);
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
    decisions.roll(G, U, 5_000_000, now, always, 'creator', SCHON);
    const first = decisions.pending(G, U, now);
    await decisions.choose(G, U, first.id, first.decision.options[0].id, now, always);

    check('direkt danach kommt kein neuer',
      decisions.roll(G, U, 5_000_000, now + 60_000, always, 'creator', SCHON) === null);
    check('nach dem Mindestabstand schon',
      decisions.roll(G, U, 5_000_000, now + decisions.MIN_GAP_MS + 1000, always, 'creator', SCHON) !== null);
  }

  console.log('\n--- Das Risiko je TAG ---');
  {
    /*
     * Bis hierher hing ein Vorfall an der Zahl der AKTIONEN: 2 % je Aktion,
     * also im Schnitt fünfzig Aktionen bis zum ersten. Wer gemütlich spielt,
     * sah deshalb nie einen. Die Firma rechnet seit jeher über die vergangenen
     * TAGE – dieselbe Spanne gilt jetzt auch für Musik und Creator.
     */
    const nah = (a, b, eps = 1e-9) => Math.abs(a - b) < eps;

    check('Anfänger: 2 % je Tag', nah(decisions.riskPerDay(0), 0.02));
    check('100.000 Reichweite: 2,4 %', nah(decisions.riskPerDay(100_000), 0.024));
    check('500.000 Reichweite: 4 %', nah(decisions.riskPerDay(500_000), 0.04));
    check('1 Mio Reichweite: 6 %', nah(decisions.riskPerDay(1_000_000), 0.06));
    check('ab 1,5 Mio ist bei 8 % Schluss', nah(decisions.riskPerDay(1_500_000), 0.08));
    check('und darüber bleibt es bei 8 %', nah(decisions.riskPerDay(5_000_000), 0.08));
    check('negative Reichweite faellt auf den Boden', nah(decisions.riskPerDay(-5), 0.02));

    check('ein Tag ist die Tageschance', nah(decisions.chanceOver(0, 1), 0.02));
    check('zwei Tage zinsen auf', nah(decisions.chanceOver(0, 2), 1 - 0.98 * 0.98));
    check('mehr als 14 Tage werden nicht nachgeholt',
      nah(decisions.chanceOver(0, 30), decisions.chanceOver(0, 14)));
    check('null Tage geben nichts', nah(decisions.chanceOver(0, 0), 0));
    check('ROLL_TAGE_MAX sind 14 Tage – wie MAX_SETTLE_DAYS bei den Tantiemen',
      decisions.ROLL_TAGE_MAX === music.MAX_SETTLE_DAYS);
    // Das Literal bleibt: Wandert MAX_SETTLE_DAYS, soll das hier auffallen und
    // bewusst nachgezogen werden, nicht beide still gemeinsam davonlaufen.
    check('… und beide sind derzeit 14', decisions.ROLL_TAGE_MAX === 14);
  }

  console.log('\n--- Der Tageswurf (decisions.tick) ---');
  {
    const T0 = Date.UTC(2026, 0, 15, 12);
    const STUNDE = 60 * 60 * 1000;

    /** Ein Würfel, der immer denselben Wert liefert. */
    const wert = (v) => () => v;
    /** Derselbe Würfel, aber er zählt seine Würfe mit. */
    const zaehlend = (v = 0.999) => {
      const f = () => { f.wuerfe++; return v; };
      f.wuerfe = 0;
      return f;
    };
    /**
     * Ein Künstler mit Hörern – sonst gäbe es keine Musik-Kandidaten.
     *
     * Genre UND Auftrittsform, denn `tick` würfelt nur in einem betretenen
     * Bereich (Stück 3), und gestartet ist eine Karriere erst mit beidem.
     */
    const musiker = (name, listeners) => {
      db.clearArtist(G, name);
      const a = db.getArtist(G, name, T0);
      db.saveArtist(G, name,
        { ...a, genre: 'pop', persona: 'face', listeners, songs: 5, touched_at: T0 });
      return name;
    };

    /*
     * Alle Zahlen hier hängen an Reichweite 1 Mio = 6 % je Tag:
     *   chanceOver(1 Mio,  1) = 0,0600
     *   chanceOver(1 Mio,  2) = 0,1164
     *   chanceOver(1 Mio, 13) = 0,5526
     *   chanceOver(1 Mio, 14) = 0,5795
     *   ungedeckelt über 30 Tage wären es 0,8437
     * Ein fester Würfelwert zwischen zwei dieser Marken sagt deshalb genau,
     * über wie viele Tage gewürfelt wurde.
     */
    {
      const U = player('tick-erst');
      db.clearEvents(G, U);
      const w = zaehlend();
      const r = decisions.tick(G, U, 'creator', 1_000_000, T0, w);
      check('tick ohne Uhr wuerfelt genau einmal', w.wuerfe === 1 && r === null,
        String(w.wuerfe));
      check('und die Uhr steht danach auf diesem Wurf',
        db.decisionUhr(G, U, 'creator').last_roll === T0);
    }
    {
      const U = player('tick-eintag');
      db.clearEvents(G, U);
      check('beim allerersten Mal ist es genau EIN Tag (0,07 > 0,0600 geht daneben)',
        decisions.tick(G, U, 'creator', 1_000_000, T0, wert(0.07)) === null);
      const V = player('tick-eintag-treffer');
      db.clearEvents(G, V);
      check('… und 0,05 ist der Treffer dieses einen Tages',
        decisions.tick(G, V, 'creator', 1_000_000, T0, wert(0.05)) !== null);
    }
    {
      const U = player('tick-stunde');
      db.clearEvents(G, U);
      const w = zaehlend();
      decisions.tick(G, U, 'creator', 1_000_000, T0, w);
      const vorher = w.wuerfe;
      check('tick zweimal in derselben Stunde: der zweite Aufruf wuerfelt nicht',
        decisions.tick(G, U, 'creator', 1_000_000, T0 + STUNDE, w) === null
        && w.wuerfe === vorher, String(w.wuerfe));
      check('die Uhr wird nur geschrieben, wenn gewuerfelt wurde',
        db.decisionUhr(G, U, 'creator').last_roll === T0);
    }
    {
      const U = player('tick-urlaub');
      db.clearEvents(G, U);
      db.saveDecisionUhr(G, U, 'creator', T0 - 30 * DAY_MS);
      check('30 Tage Abwesenheit geben hoechstens ROLL_TAGE_MAX Tage (0,58 > 0,5795)',
        decisions.tick(G, U, 'creator', 1_000_000, T0, wert(0.58)) === null);
      const V = player('tick-urlaub-treffer');
      db.clearEvents(G, V);
      db.saveDecisionUhr(G, V, 'creator', T0 - 30 * DAY_MS);
      check('… aber die vollen 14 Tage zaehlen auch (0,57 < 0,5795, 13 Tage täten es nicht)',
        decisions.tick(G, V, 'creator', 1_000_000, T0, wert(0.57)) !== null);
    }
    {
      const U = musiker('tick-musik-offen', 100_000);
      db.clearEvents(G, U);
      db.insertEvent({ guildId: G, userId: U, kind: 'plagiat', platform: 'music',
        createdAt: T0, expiresAt: T0 + DAY_MS });
      const w = zaehlend(0);
      check('ein offener MUSIK-Vorfall haelt den naechsten Musik-Wurf auf',
        decisions.tick(G, U, 'music', 100_000, T0 + 2 * DAY_MS, w) === null && w.wuerfe === 0);
      check('… und die Uhr bleibt unberührt – reines Lesen aendert nichts',
        db.decisionUhr(G, U, 'music').last_roll === 0 && uhrZeilen(G, U) === 0);
    }
    {
      const U = musiker('tick-firma-offen', 100_000);
      db.clearEvents(G, U);
      db.insertEvent({ guildId: G, userId: U, kind: 'plagiat', platform: 'company',
        createdAt: T0, expiresAt: T0 + DAY_MS });
      check('ein offener FIRMEN-Vorfall haelt den Musik-Wurf NICHT mehr auf',
        decisions.tick(G, U, 'music', 100_000, T0 + 2 * DAY_MS, wert(0))?.platform === 'music');
    }
    {
      const U = musiker('tick-creator-offen', 100_000);
      db.clearEvents(G, U);
      db.insertEvent({ guildId: G, userId: U, kind: DECISIONS[0].id,
        platform: DECISIONS[0].platform ?? '', createdAt: T0, expiresAt: T0 + DAY_MS });
      check('ein offener CREATOR-Vorfall haelt den Musik-Wurf NICHT auf',
        decisions.tick(G, U, 'music', 100_000, T0 + 2 * DAY_MS, wert(0))?.platform === 'music');
    }
    {
      /*
       * Fast alle Creator-Vorlagen tragen eine Plattform (6 von 12: twitch,
       * youtube, twitter) – der Test oben mit DECISIONS[0] hat `platform: null`,
       * also '', und deckt nur den Fall „netzwerkweit" ab. Der Bereich Creator
       * heißt in der Datenbank aber „alles außer music und company".
       */
      const U = player('tick-creator-plattform');
      db.clearEvents(G, U);
      db.insertEvent({ guildId: G, userId: U, kind: 'exklusivvertrag', platform: 'twitch',
        createdAt: T0, expiresAt: T0 + DAY_MS });
      check('ein offener Vorfall auf twitch sperrt den CREATOR-Bereich',
        db.openEvent(G, U, 'creator')?.platform === 'twitch'
        && db.lastEventAt(G, U, 'creator') === T0);
      const w = zaehlend(0);
      check('… und haelt den naechsten Creator-Wurf auf',
        decisions.tick(G, U, 'creator', 1_000_000, T0 + 2 * DAY_MS, w) === null && w.wuerfe === 0);
      check('… aber nicht den Musik-Bereich',
        db.openEvent(G, U, 'music') === null && db.lastEventAt(G, U, 'music') === 0);
      check('… und nicht den Firmen-Bereich',
        db.openEvent(G, U, 'company') === null && db.lastEventAt(G, U, 'company') === 0);
    }
    {
      // Ein Tippfehler im Bereich darf die Sperre nicht abschalten, sondern verschärft sie.
      const U = player('tick-bereich-tippfehler');
      db.clearEvents(G, U);
      check('ohne Vorfall bleibt auch ein unbekannter Bereich leer',
        db.openEvent(G, U, 'musik') === null && db.lastEventAt(G, U, 'musik') === 0);
      db.insertEvent({ guildId: G, userId: U, kind: 'exklusivvertrag', platform: 'twitch',
        createdAt: T0, expiresAt: T0 + DAY_MS });
      check('ein unbekannter Bereich („musik") sieht den offenen Vorfall trotzdem',
        db.openEvent(G, U, 'musik') !== null);
      check('… und lastEventAt auch (nicht 0)',
        db.lastEventAt(G, U, 'musik') === T0);
    }
    {
      // Die Firma zählt ihre Tage in company.settle selbst – tick fasst sie nicht an.
      const U = player('tick-keine-firma');
      db.clearEvents(G, U);
      check('tick wuerfelt nur fuer Musik und Creator',
        decisions.tick(G, U, 'company', { groesse: 5, days: 3, npc: 3 }, T0, wert(0)) === null
        && uhrZeilen(G, U) === 0);
    }
    {
      /*
       * `roll` darf Musik und Creator nicht auf eigene Faust würfeln: Sonst läge
       * neben dem Tageswurf (tick) wieder eine zweite Rate je Aufruf. Nur
       * `schonGewuerfelt` – das setzt allein tick – lässt es zu.
       */
      const wirft = (fn) => { try { fn(); return null; } catch (e) { return e.message; } };
      const U = musiker('roll-pflicht', 100_000);
      player(U, 1_000_000);
      db.clearEvents(G, U);
      for (const [bereich, groesse] of [['music', 100_000], ['creator', 1_000_000]]) {
        check(`roll(${bereich}) ohne schonGewuerfelt wirft – auch mit sicherem Wurf`,
          /schonGewuerfelt/.test(wirft(() => decisions.roll(G, U, groesse, T0, wert(0), bereich)) ?? ''));
        check(`… und mit leerem Optionsobjekt (${bereich})`,
          wirft(() => decisions.roll(G, U, groesse, T0, wert(0), bereich, {})) !== null);
        check(`… und es legt nichts an (${bereich})`,
          db.openEvent(G, U, bereich) === null && db.lastEventAt(G, U, bereich) === 0);
      }
      check('roll ohne Bereich wirft, statt still „creator" zu nehmen',
        wirft(() => decisions.roll(G, U, 1_000_000, T0, wert(0))) !== null
        && db.openEvent(G, U, 'creator') === null);
      check('roll mit unbekanntem Bereich wirft',
        wirft(() => decisions.roll(G, U, 1_000_000, T0, wert(0), 'musik', SCHON)) !== null);
      check('mit schonGewuerfelt (so ruft tick) entsteht der Vorfall',
        decisions.roll(G, U, 100_000, T0, wert(0), 'music', SCHON)?.platform === 'music');
      // Die Firma würfelt ihre Rate weiter selbst in roll (company.settle) – dort kein Fehler.
      check('Firmen-Bereich braucht schonGewuerfelt nicht',
        wirft(() => decisions.roll(G, U, { groesse: 5, days: 3, npc: 3 }, T0, wert(0.99), 'company')) === null);
    }
    {
      // MIN_GAP_MS gilt je Bereich – geprüft über roll, damit keine Uhr mitredet.
      const U = 'tick-abstand';
      musiker(U, 100_000);
      player(U, 1_000_000);
      db.clearEvents(G, U);
      const ZEHN = 10 * STUNDE;
      const m1 = decisions.roll(G, U, 100_000, T0, wert(0), 'music', SCHON);
      check('ein Musik-Vorfall entsteht', m1?.platform === 'music');
      db.resolveEvent(G, m1.id, { status: 'done', at: T0 });
      check('zwei Musik-Vorfaelle im Abstand von 10 h gehen nicht',
        decisions.roll(G, U, 100_000, T0 + ZEHN, wert(0), 'music', SCHON) === null);
      const c1 = decisions.roll(G, U, 1_000_000, T0 + ZEHN, wert(0), 'creator', SCHON);
      check('ein Musik- und ein Creator-Vorfall im Abstand von 10 h gehen',
        Boolean(c1) && c1.platform !== 'music' && c1.platform !== 'company');
    }
    {
      const U = 'tick-uhr-leer';
      check('db.decisionUhr gibt Vorgaben zurueck, auch ohne Zeile',
        db.decisionUhr(G, U, 'music').last_roll === 0);
      check('db.decisionUhr legt keine Zeile an (§4)', uhrZeilen(G, U) === 0);
      db.saveDecisionUhr(G, U, 'music', T0);
      check('saveDecisionUhr schreibt sie dann',
        uhrZeilen(G, U) === 1 && db.decisionUhr(G, U, 'music').last_roll === T0);
      check('und jeder Bereich hat seine eigene Uhr',
        db.decisionUhr(G, U, 'creator').last_roll === 0 && uhrZeilen(G, U) === 1);
    }
  }

  /*
   * Seit dem Tageswurf (§4) hängt ein Vorfall an der ZEIT, nicht an der Zahl
   * der Aktionen. `record`, `publish`, `show` und `creator.act` würfeln deshalb
   * nicht mehr selbst – sonst addierten sich beide Raten, und der Fleißige wäre
   * wieder der Gefährdete. Gewürfelt wird in der faulen Abrechnung, an
   * derselben Stelle wie jede andere.
   */
  console.log('\n--- Der Wurf haengt an der Zeit, nicht an der Aktion ---');
  {
    const buttons = require('../src/buttons');
    const company = require('../src/company');
    const ui = require('../src/ui');
    const immerTreffer = () => 0;      // erzwingt jeden Wurf, der noch da wäre

    /** Ein Künstler mit Hörern – ohne sie gäbe es keine Musik-Kandidaten. */
    const musiker = (name, listeners) => {
      const jetzt = Date.now();
      db.clearArtist(G, name);
      const a = db.getArtist(G, name, jetzt);
      db.saveArtist(G, name, {
        ...a, genre: 'pop', persona: 'face', listeners, songs: 5,
        touched_at: jetzt, paid_through: jetzt, last_action_at: jetzt,
      });
      return name;
    };

    {
      const U = player('aktion-creator');
      db.clearEvents(G, U);
      // Twitter braucht keine Ausrüstung – die Aktion läuft ohne Vorbereitung.
      const r = await creator.act(G, U, 'twitter', 'ankuendigung', Date.now(), immerTreffer);
      check('creator.act legt keinen Vorfall mehr an (auch mit erzwungenem Wurf)',
        r.ok && r.incident === null && db.openEvent(G, U) === null,
        JSON.stringify({ reason: r.reason, incident: r.incident }));
    }
    {
      const U = player('settle-creator');
      db.clearEvents(G, U);
      db.saveDecisionUhr(G, U, 'creator', Date.now() - 2 * DAY_MS);
      const text = await buttons.settleCreator(G, U, immerTreffer);
      const offen = db.openEvent(G, U, 'creator');
      check('settleCreator holt den Tageswurf nach', Boolean(offen), String(text));
      check('… und die Notiz nennt ihn',
        Boolean(offen) && String(text).includes(decisions.decision(offen.kind).title),
        String(text));
      /*
       * Und sie nennt den ORT, nicht die Sache: Aus einer Plattform-, Deal-
       * oder Vorfall-Ansicht ist kein ⚠️-Knopf zu sehen, ein blankes
       * „⚠️ Vorfall" schübe den Spieler dort auf nichts.
       */
      check('… und sagt, wo er wartet (⚠️ im Netzwerk)',
        String(text).includes('⚠️ im Netzwerk'), String(text));
      /*
       * Der offene Vorfall allein würde den zweiten Wurf schon sperren – weg
       * damit, denn geprüft wird die Uhr: Zweimal abrechnen heißt EIN Wurf.
       */
      db.clearEvents(G, U);
      const text2 = await buttons.settleCreator(G, U, immerTreffer);
      check('zweimal settleCreator hintereinander: nur ein Wurf',
        db.openEvent(G, U, 'creator') === null, String(text2));
    }
    {
      const U = musiker('settle-musik', 100_000);
      db.clearEvents(G, U);
      db.saveDecisionUhr(G, U, 'music', Date.now() - 2 * DAY_MS);
      const text = await buttons.settleMusic(G, U, immerTreffer);
      const offen = db.openEvent(G, U, 'music');
      check('settleMusic holt den Tageswurf nach', offen?.platform === 'music', String(text));
      check('… und die Notiz nennt ihn',
        Boolean(offen) && String(text).includes(decisions.decision(offen.kind).title),
        String(text));
      check('… und sagt, wo er wartet (⚠️ im Studio)',
        String(text).includes('⚠️ im Studio'), String(text));
      db.clearEvents(G, U);
      const text2 = await buttons.settleMusic(G, U, immerTreffer);
      check('zweimal settleMusic hintereinander: nur ein Wurf',
        db.openEvent(G, U, 'music') === null, String(text2));
    }
    {
      /*
       * Ein Fehler im Tageswurf darf den Wurf kosten, nicht die Ansicht.
       *
       * Jeder andere Schritt der faulen Abrechnung trägt sein
       * `.catch(() => null)`; der Tageswurf war der einzige ohne Netz – samt
       * seinen Argumenten (`music.status`, `creator.reachTotalOf`). Solange der
       * Wurf an der Aktion hing, kostete ein Fehler darin nur diese Aktion.
       * Als Teil der Abrechnung nimmt er Studio, Netzwerk, Plattform, Deals und
       * die Vorfall-Ansicht mit, dazu /musik, /creator, !musik und !creator.
       *
       * Geprüft wird nicht nur „kein Wurf", sondern dass die Abrechnung sonst
       * ganz durchläuft: Der verfallene Vorfall muss in der Notiz stehen.
       */
      const kaputt = () => { throw new Error('Wurf kaputt'); };
      /** Führt `fn` aus, während `obj[key]` wirft – und setzt es danach zurück. */
      const mitFehler = async (obj, key, fn) => {
        const echt = obj[key];
        obj[key] = kaputt;
        try { return { note: await fn(), fehler: null }; }
        catch (e) { return { note: null, fehler: e }; }
        finally { obj[key] = echt; }
      };
      /** Ein Spieler mit einem gerade verfallenen Vorfall des Bereichs. */
      const mitVerfall = (name, kind, platform) => {
        db.clearEvents(G, name);
        const jetzt = Date.now();
        db.saveDecisionUhr(G, name, platform === 'music' ? 'music' : 'creator',
          jetzt - 2 * DAY_MS);
        db.insertEvent({ guildId: G, userId: name, kind, platform,
          createdAt: jetzt - 2 * DAY_MS, expiresAt: jetzt - 1000 });
        return decisions.decision(kind).title;
      };

      {
        const U = musiker('wurf-wirft-musik', 100_000);
        const titel = mitVerfall(U, 'plagiat', 'music');
        const r = await mitFehler(decisions, 'tick',
          () => buttons.settleMusic(G, U, immerTreffer));
        check('ein werfender Tageswurf reisst die Studio-Abrechnung nicht mit',
          r.fehler === null, String(r.fehler));
        check('… und der verfallene Vorfall steht trotzdem in der Notiz',
          String(r.note).includes(titel), String(r.note));
      }
      {
        const U = player('wurf-wirft-creator');
        const titel = mitVerfall(U, 'exklusivvertrag', 'twitch');
        const r = await mitFehler(decisions, 'tick',
          () => buttons.settleCreator(G, U, immerTreffer));
        check('ein werfender Tageswurf reisst die Netzwerk-Abrechnung nicht mit',
          r.fehler === null, String(r.fehler));
        check('… und der verfallene Vorfall steht trotzdem in der Notiz',
          String(r.note).includes(titel), String(r.note));
      }
      {
        /*
         * Auch die GRÖSSE für den Wurf liegt hinter dem Netz: `reachTotalOf`
         * ist ein Aufruf wie jeder andere und kann werfen.
         *
         * Die Musik-Seite wird hier nur über `decisions.tick` geprüft, nicht
         * über ein werfendes `music.status`: Das benutzt auch die
         * Angebots-Abrechnung (`angebote.settle` über `settleStrasse`), die
         * VOR dem Wurf läuft – ein Fehler dort ist ein älterer, anderer Weg.
         */
        const U = player('wurf-wirft-reichweite');
        const titel = mitVerfall(U, 'exklusivvertrag', 'twitch');
        const r = await mitFehler(creator, 'reachTotalOf',
          () => buttons.settleCreator(G, U, immerTreffer));
        check('ein werfendes creator.reachTotalOf reisst die Abrechnung nicht mit',
          r.fehler === null, String(r.fehler));
        check('… und der verfallene Vorfall steht trotzdem in der Notiz',
          String(r.note).includes(titel), String(r.note));
      }
    }
    {
      /*
       * Drei Vorfaelle in EINER Notiz.
       *
       * Vor der Sperre je Bereich konnte höchstens einer offen sein, also auch
       * nur einer auf einmal verfallen. Jetzt sind es drei, jeder mit Titel- UND
       * Folgezeile. Über 2000 Zeichen nimmt Discord die Nachricht nicht an, und
       * jedes `followUp` dieser Notizen hat sein `.catch(() => {})` – der
       * Spieler erführe nicht, warum seine Follower weg sind.
       */
      const U = 'drei-verfallen';
      musiker(U, 100_000);
      player(U, 1_000_000);
      db.clearEvents(G, U);
      const jetzt = Date.now();
      const f = await company.found(G, U, 'cafe', 'Dreiverfall', jetzt);
      const vorlagen = [
        db.insertEvent({ guildId: G, userId: U, kind: 'wasserschaden',
          platform: 'company', refId: f.company?.id ?? 0,
          createdAt: jetzt - 2 * DAY_MS, expiresAt: jetzt - 1000 }),
        db.insertEvent({ guildId: G, userId: U, kind: 'exklusivvertrag',
          platform: 'twitch', createdAt: jetzt - 2 * DAY_MS, expiresAt: jetzt - 1000 }),
        db.insertEvent({ guildId: G, userId: U, kind: 'plagiat',
          platform: 'music', createdAt: jetzt - 2 * DAY_MS, expiresAt: jetzt - 1000 }),
      ];
      check('drei Bereiche, drei faellige Vorfaelle', f.ok && vorlagen.every(Boolean),
        JSON.stringify(f.reason ?? ''));
      // `() => 1` statt eines Treffers: Geprüft wird der Verfall, nicht ein
      // neuer Wurf, der die Notiz zufällig verlängern würde.
      const notiz = String(await buttons.settleCreator(G, U, () => 1));
      for (const v of vorlagen) {
        check(`… und ${v.kind} steht in der einen Notiz`,
          notiz.includes(decisions.decision(v.kind).title), notiz);
      }
      check('drei Verfaelle auf einmal bleiben unter Discords Grenze',
        notiz.length <= 2000, `${notiz.length} Zeichen`);
      check('… und nichts bleibt offen', db.openEvent(G, U) === null);
    }
    {
      /*
       * Und wenn es doch zu lang wird, wird gekürzt und GESAGT, dass gekürzt
       * wurde – still verschlucken ist genau der Fehler, der behoben wird.
       * Geschnitten wird an der Blockgrenze: Eine Vorfallsmeldung besteht aus
       * Titel und Folge, eine halbe Meldung ist schlimmer als keine.
       */
      const kurz = ['eins', 'zwei'];
      check('eine kurze Notiz bleibt unangetastet',
        buttons.notizAus(kurz) === 'eins\nzwei', String(buttons.notizAus(kurz)));
      check('nichts zu melden heisst keine Notiz', buttons.notizAus([]) === null);

      const lang = ['A'.repeat(700), 'B'.repeat(700), 'C'.repeat(700)];
      const gek = buttons.notizAus(lang);
      check('eine zu lange Notiz wird gekuerzt', gek.length <= buttons.NOTIZ_MAX,
        `${gek.length} Zeichen`);
      check('… an der Blockgrenze, nicht mitten im Block',
        gek.startsWith('A'.repeat(700)) && !gek.includes('C'), gek.slice(-120));
      check('… und die fehlenden Meldungen werden benannt',
        gek.includes('1 weitere Meldung') && gek.includes('Verlauf'), gek.slice(-120));

      const riesig = buttons.notizAus(['X'.repeat(5000)]);
      check('selbst ein einzelner Riesenblock kommt zugestellt an',
        riesig.length <= buttons.NOTIZ_MAX && riesig.startsWith('XXX')
        && riesig.includes('gekürzt'), `${riesig.length} Zeichen`);
    }
    {
      /*
       * Der Tageswurf hängt an jeder Tür, die die Creator-Ansicht öffnet – nicht
       * nur an den Plattform-Knöpfen. Sonst hinge die gemessene Rate daran,
       * welche Tür jemand benutzt. Die Türen nehmen keinen Würfel mit, darum
       * wird Math.random für die Dauer des Aufrufs auf 0 gesetzt (= Treffer).
       */
      const wuerfelTreffer = async (fn) => {
        const echt = Math.random;
        Math.random = () => 0;
        try { return await fn(); } finally { Math.random = echt; }
      };
      const vorbereiten = (name) => {
        const U = player(name);
        db.clearEvents(G, U);
        db.saveDecisionUhr(G, U, 'creator', Date.now() - 2 * DAY_MS);
        return U;
      };
      const netz = (view) => JSON.stringify(view ?? '');
      const fake = (U, rec) => ({
        guildId: G,
        user: { id: U },
        memberPermissions: { has: () => false },
        options: { getString: () => null },
        deferUpdate: async () => {},
        deferReply: async () => {},
        update: async (v) => { rec.views.push(v); },
        editReply: async (v) => { rec.views.push(v); },
        followUp: async (v) => { rec.notes.push(v.content ?? v); },
      });

      /*
       * Meldet eine Notiz den offenen Vorfall? Geprüft wird sein TITEL und der
       * ORT, an dem er wartet – das Wort „Vorfall" allein stand bis hierher im
       * Text und sagte dem Spieler nicht, wohin er gehen soll.
       */
      const meldetVorfall = (texte, user) => {
        const offen = db.openEvent(G, user, 'creator');
        if (!offen) return false;
        return texte.some((n) => String(n).includes(decisions.decision(offen.kind).title)
          && String(n).includes('⚠️ im Netzwerk'));
      };

      {
        const U = vorbereiten('tuer-menue');
        const rec = { views: [], notes: [] };
        await wuerfelTreffer(() => buttons.buttons.menu(fake(U, rec), ['creator', '1', U]));
        check('Tür Menü (Knopf „creator"): der Tageswurf fällt',
          db.openEvent(G, U, 'creator') !== null, JSON.stringify(rec.notes));
        check('… und die Notiz meldet ihn', meldetVorfall(rec.notes, U),
          JSON.stringify(rec.notes));
      }
      {
        const U = vorbereiten('tuer-plattform');
        const rec = { views: [], notes: [] };
        await wuerfelTreffer(() => buttons.buttons.creator(fake(U, rec), ['twitch']));
        check('Tür Plattform-Knopf: der Tageswurf fällt', db.openEvent(G, U, 'creator') !== null);
      }
      {
        const U = vorbereiten('tuer-slash');
        const rec = { views: [], notes: [] };
        await wuerfelTreffer(() => require('../src/commands/creator').execute(fake(U, rec)));
        check('Tür /creator: der Tageswurf fällt', db.openEvent(G, U, 'creator') !== null,
          JSON.stringify(rec.notes));
        check('… und die Notiz meldet ihn', meldetVorfall(rec.notes, U),
          JSON.stringify(rec.notes));
        check('… und die Ansicht kam trotzdem', rec.views.length === 1 && netz(rec.views[0]).length > 2);
      }
      {
        const U = vorbereiten('tuer-fluxer');
        const cmd = require('../src/fluxer/commands').find('creator');
        const res = await wuerfelTreffer(() => cmd.run({ guildId: G, userId: U, args: [], name: 'creator' }));
        check('Tür Fluxer !creator: der Tageswurf fällt', db.openEvent(G, U, 'creator') !== null);
        check('… und die Notiz kommt als `note` mit', meldetVorfall([res.note ?? ''], U),
          String(res.note));
        check('… zusammen mit der Ansicht', Boolean(res.view));
      }
      {
        const U = vorbereiten('tuer-zweimal');
        const rec = { views: [], notes: [] };
        await wuerfelTreffer(async () => {
          await require('../src/commands/creator').execute(fake(U, rec));
          db.clearEvents(G, U);
          await buttons.buttons.menu(fake(U, rec), ['creator', '1', U]);
        });
        check('zwei Türen hintereinander: nur ein Wurf (die Uhr ist gestellt)',
          db.openEvent(G, U, 'creator') === null);
      }
    }
    {
      /*
       * Schritt 2b: Mit Sperren je Bereich können drei Vorfälle gleichzeitig
       * offen sein. Ohne Bereich gäbe `pending` nur den NEUESTEN zurück – die
       * anderen zwei wären über ihre Ansicht unerreichbar, bis sie verfallen,
       * und das kostet den Ignorier-Aufschlag.
       */
      const U = 'drei-bereiche';
      musiker(U, 100_000);
      player(U, 1_000_000);
      db.clearEvents(G, U);
      const jetzt = Date.now();
      const f = await company.found(G, U, 'cafe', 'Dreibereich', jetzt);
      const vFirma = db.insertEvent({ guildId: G, userId: U, kind: 'wasserschaden',
        platform: 'company', refId: f.company?.id ?? 0,
        createdAt: jetzt, expiresAt: jetzt + DAY_MS });
      const vCreator = db.insertEvent({ guildId: G, userId: U, kind: 'exklusivvertrag',
        platform: 'twitch', createdAt: jetzt + 1, expiresAt: jetzt + DAY_MS });
      const vMusik = db.insertEvent({ guildId: G, userId: U, kind: 'plagiat',
        platform: 'music', createdAt: jetzt + 2, expiresAt: jetzt + DAY_MS });
      check('drei Bereiche, drei offene Vorfälle – der Musik-Vorfall ist der neueste',
        f.ok && vFirma.id < vCreator.id && vCreator.id < vMusik.id,
        JSON.stringify(f.reason ?? ''));
      check('die Musik-Ansicht zeigt den Musik-Vorfall',
        music.status(G, U, jetzt).incident?.id === vMusik.id);
      check('die Creator-Ansicht zeigt den Creator-Vorfall',
        creator.status(G, U, jetzt).incident?.id === vCreator.id);
      check('die Firmen-Ansicht zeigt den Firmen-Vorfall, nicht den neuesten',
        company.status(G, U, jetzt, f.company?.id).incident?.id === vFirma.id);
      check('ohne Bereich bleibt es wie bisher der neueste',
        decisions.pending(G, U, jetzt)?.id === vMusik.id);
      const ansicht = await ui.buildDecisionView({ guildId: G, userId: U, domain: 'company' });
      check('die Vorfall-Ansicht zeigt den Bereich, nach dem sie fragt',
        ansicht.embeds[0].data.title.startsWith('🏢'), ansicht.embeds[0].data.title);

      /*
       * Und der Knopf bringt den Bereich mit: ⚠️ Vorfall im Studio zeigt das
       * Studio-Drama, auch wenn das Firmen-Drama neuer wäre. Ohne diesen Weg
       * wäre der Bereich in `pending` nur halb angekommen.
       */
      const geklickt = async (...parts) => {
        const gesehen = [];
        await buttons.buttons.vorfall({
          guildId: G,
          user: { id: U },
          deferUpdate: async () => {},
          editReply: async (v) => { gesehen.push(v); return v; },
          followUp: async () => {},
        }, parts);
        return gesehen[0]?.embeds?.[0]?.data?.title ?? '';
      };
      const titelMusik = await geklickt('music', U);
      check('der Knopf aus dem Studio zeigt den Musik-Vorfall',
        titelMusik.startsWith('🎵'), titelMusik);
      const titelFirma = await geklickt('company', U);
      check('der Knopf aus der Firma zeigt den Firmen-Vorfall',
        titelFirma.startsWith('🏢'), titelFirma);
      const titelAlt = await geklickt(U);
      check('ein alter Knopf ohne Bereich zeigt weiter den neuesten (Musik)',
        titelAlt.startsWith('🎵'), titelAlt);
      db.clearEvents(G, U);
    }
  }

  /*
   * Die frühen Vorfälle (Stück 3). Vorher war der Anfang leer: Jede
   * Musik-Vorlage verlangt mindestens 5.000 Hörer, elf von zwölf
   * Creator-Vorlagen mindestens 10.000 Reichweite. Gewürfelt wird aber seit
   * dem Tageswurf ab dem ersten Tag – der Wurf fand nur keine Kandidaten und
   * wurde weggeworfen.
   */
  console.log('\n--- Die frühen Vorfälle (0 … FRUEH_MAX) ---');
  {
    const { MUSIC_DECISIONS } = require('../src/data/musicDecisions');
    const FRUEH_MUSIK = ['proberaum', 'kleiner_auftritt'];
    const FRUEH_CREATOR = ['erster_sponsor', 'festplatte'];
    const FRUEH = [...FRUEH_MUSIK, ...FRUEH_CREATOR];
    const alle = [...MUSIC_DECISIONS, ...DECISIONS];
    const frueh = alle.filter((d) => FRUEH.includes(d.id));
    const T0 = Date.UTC(2026, 1, 3, 12);

    /*
     * Ein Würfel, der über die Läufe die ganze Spanne abschreitet (goldener
     * Schnitt) – `() => 0` träfe immer dieselbe erste Vorlage und zeigte
     * nichts über die Kandidatenliste.
     */
    const fegend = (i) => () => (i * 0.6180339887) % 1;

    /**
     * Welche Vorlagen bei dieser Größe überhaupt gezogen werden.
     *
     * Die Uhr läuft über alle Proben hinweg weiter: `MIN_GAP_MS` vergleicht mit
     * dem letzten Vorfall, und ein zweiter Durchlauf am alten Anfang läge
     * davor – er bekäme keinen einzigen Vorfall mehr.
     */
    let zeit = T0;
    const kinds = (U, domain, size, tries = 400) => {
      const out = new Set();
      for (let i = 0; i < tries; i++) {
        const ev = decisions.roll(G, U, size, zeit, fegend(i + 1), domain, SCHON);
        if (ev) { out.add(ev.kind); db.resolveEvent(G, ev.id, { status: 'done', at: zeit }); }
        zeit += decisions.MIN_GAP_MS + 1000;
      }
      return out;
    };

    /*
     * Ein Künstler, der ALLES erfüllt, was die alten Vorlagen verlangen
     * (Gesicht, fünf Titel) – nur den Vertrag nicht. Dass bei 0 Hörern
     * trotzdem allein die frühen kommen, liegt dann sicher an der Schwelle.
     */
    const musiker = (name) => {
      db.clearArtist(G, name);
      db.clearEvents(G, name);
      const a = db.getArtist(G, name, T0);
      db.saveArtist(G, name, { ...a, genre: 'pop', persona: 'face', songs: 5, touched_at: T0 });
      return name;
    };

    const sortiert = (set) => [...set].sort().join(' ');

    check('alle vier frühen Vorfälle stehen im Katalog', frueh.length === 4,
      frueh.map((d) => d.id).join(' '));
    check('FRUEH_MAX sind 10.000', decisions.FRUEH_MAX === 10_000,
      String(decisions.FRUEH_MAX));
    check('jeder frühe Vorfall geht von 0 bis FRUEH_MAX',
      frueh.every((d) => (d.minListeners ?? d.minReach) === 0
        && (d.maxListeners ?? d.maxReach) === decisions.FRUEH_MAX));
    check('die alten Vorlagen bleiben nach oben offen',
      alle.filter((d) => !FRUEH.includes(d.id))
        .every((d) => d.maxListeners === undefined && d.maxReach === undefined));

    // --- Musik ---
    {
      const U = musiker('frueh-musiker');
      const k0 = kinds(U, 'music', 0);
      check('ein Anfänger (0 Hörer) bekommt überhaupt Kandidaten – vorher war die Liste leer',
        k0.size > 0, sortiert(k0));
      check('… und zwar NUR die frühen', sortiert(k0) === 'kleiner_auftritt proberaum',
        sortiert(k0));

      const k20 = kinds(U, 'music', 20_000);
      check('bei 20.000 Hörern sind die frühen weg',
        FRUEH_MUSIK.every((id) => !k20.has(id)), sortiert(k20));
      check('… und die alten da (plagiat, stimme, album_leak, skandal)',
        sortiert(k20) === 'album_leak plagiat skandal stimme', sortiert(k20));

      const grenze = kinds(U, 'music', decisions.FRUEH_MAX);
      check('genau an der Grenze FRUEH_MAX ist der frühe noch dabei (<=)',
        FRUEH_MUSIK.every((id) => grenze.has(id)), sortiert(grenze));
      const drueber = kinds(U, 'music', decisions.FRUEH_MAX + 1);
      check('einen Hörer darüber nicht mehr',
        FRUEH_MUSIK.every((id) => !drueber.has(id)), sortiert(drueber));
    }

    // --- Creator ---
    {
      /*
       * „Das Setup macht Geräusche" (hardware, minReach 0) war der eine
       * Vorfall, den ein Anfänger schon vorher ziehen konnte – allein. Er
       * bleibt nach oben offen und steht deshalb in beiden erwarteten Mengen.
       */
      const U = player('frueh-creator', 0);
      const c0 = kinds(U, 'creator', 0);
      check('ein Creator-Anfänger: die zwei frühen plus hardware',
        sortiert(c0) === 'erster_sponsor festplatte hardware', sortiert(c0));
      const c20 = kinds(U, 'creator', 20_000);
      check('bei 20.000 Reichweite sind die frühen weg, die alten da',
        sortiert(c20) === 'algorithmus copyright hardware', sortiert(c20));
      const grenze = kinds(U, 'creator', decisions.FRUEH_MAX);
      check('auch hier ist die Grenze selbst noch drin (<=)',
        FRUEH_CREATOR.every((id) => grenze.has(id)), sortiert(grenze));
      const drueber = kinds(U, 'creator', decisions.FRUEH_MAX + 1);
      check('eine Reichweite darüber nicht mehr',
        FRUEH_CREATOR.every((id) => !drueber.has(id)), sortiert(drueber));
    }

    // --- Form: wie die Nachbarn in derselben Datei ---
    {
      const spanne = (liste) => {
        const n = liste.filter((d) => !FRUEH.includes(d.id)).map((d) => d.options.length);
        return [Math.min(...n), Math.max(...n)];
      };
      for (const [name, liste] of [['musicDecisions', MUSIC_DECISIONS], ['decisions', DECISIONS]]) {
        const [min, max] = spanne(liste);
        const eigene = liste.filter((d) => FRUEH.includes(d.id));
        check(`jeder frühe Vorfall hat so viele Optionen wie seine Nachbarn in ${name} (${min}…${max})`,
          eigene.length === 2 && eigene.every((d) => d.options.length >= min && d.options.length <= max),
          eigene.map((d) => `${d.id}:${d.options.length}`).join(' '));
      }
      check('die frühen Musik-Vorfälle haben keine Zulassungshürde – sie sollen den Anfänger treffen',
        MUSIC_DECISIONS.filter((d) => FRUEH.includes(d.id)).every((d) => !d.requires));
      check('jeder frühe Vorfall hat einen Ausgang fürs Nichtstun',
        frueh.every((d) => d.expire && d.expire.text));
    }

    // --- Kein früher Vorfall ist eine Einnahmequelle (§3) ---
    {
      const ausgaenge = (d) => [...d.options.flatMap((o) => o.outcomes), d.expire];
      const zahlt = frueh.flatMap((d) => ausgaenge(d)
        .filter((x) => (x.cash ?? 0) > 0).map(() => d.id));
      check('keine Option eines frühen Vorfalls bringt netto Geld', zahlt.length === 0,
        zahlt.join(' '));
      const erwartung = (o) => {
        const total = o.outcomes.reduce((s, x) => s + x.weight, 0);
        return o.outcomes.reduce((s, x) => s + x.weight * (x.cash ?? 0), 0) / total;
      };
      check('… auch nicht im Erwartungswert',
        frueh.every((d) => d.options.every((o) => erwartung(o) <= 0)));
    }
  }

  /*
   * Stück 3, zweiter Teil: Der Tageswurf darf nur dort fallen, wo jemand
   * wirklich drin ist. Geprüft wird die EXISTENZ, nicht die Größe – ein
   * Anfänger mit einem Kanal bei null Followern soll würfeln, ein reiner
   * Firmenspieler nicht. Ohne diese Tür sammelte er Creator-Vorfälle ein:
   * `creator.reachTotalOf` zählt den Musikboden mit, und `settleCreator` läuft
   * an jedem Klick, der die Creator-Ansicht öffnet.
   */
  console.log('\n--- tick würfelt nur in betretenen Bereichen ---');
  {
    const T = Date.UTC(2026, 1, 10, 12);
    const treffer = () => 0;              // der Wurf fällt sicher, wenn er fällt

    {
      const U = 'frueh-ohne-kanal';
      db.clearCreator(G, U);
      check('ohne einen einzigen Kanal würfelt tick(creator) nicht',
        decisions.tick(G, U, 'creator', 500_000, T, treffer) === null
        && db.allCreator(G, U).length === 0);
      check('… und die Uhr bleibt stehen – der erste echte Tag soll der erste Wurf sein',
        db.decisionUhr(G, U, 'creator').last_roll === 0 && uhrZeilen(G, U) === 0);

      // Ein wirklich gesendeter Kanal (`actions: 1`), aber ohne einen Follower.
      const row = db.getCreator(G, U, 'twitch', T);
      db.saveCreator(G, U, 'twitch', { ...row, followers: 0, actions: 1, touched_at: T });
      const ev = decisions.tick(G, U, 'creator', 0, T, treffer);
      check('mit EINEM benutzten Kanal bei null Followern schon – genau dafür sind die frühen da',
        ev !== null, JSON.stringify(ev));
    }
    {
      const U = 'frueh-ohne-karriere';
      db.clearArtist(G, U);
      db.clearEvents(G, U);
      check('ohne gestartete Karriere würfelt tick(music) nicht',
        decisions.tick(G, U, 'music', 500_000, T, treffer) === null);
      check('… und die Künstlerzeile wird dabei nicht angelegt (§4)',
        db.hasArtist(G, U) === false);
      check('… und die Uhr bleibt stehen',
        db.decisionUhr(G, U, 'music').last_roll === 0);

      check('Genre und Auftrittsform gewählt', music.setup(G, U, 'pop', 'anon', T).ok === true);
      const ev = decisions.tick(G, U, 'music', 0, T, treffer);
      check('mit gestarteter Karriere bei null Hörern schon',
        ev?.platform === 'music' && ['proberaum', 'kleiner_auftritt'].includes(ev.kind),
        JSON.stringify(ev?.kind));
    }
    {
      // Eine angelegte, aber leere Künstlerzeile ist keine Karriere.
      const U = 'frueh-halbe-karriere';
      db.clearArtist(G, U);
      db.clearEvents(G, U);
      db.getArtist(G, U, T);
      check('eine leere Künstlerzeile zählt nicht als gestartet',
        db.hasArtist(G, U) === true
        && decisions.tick(G, U, 'music', 500_000, T, treffer) === null);
    }
    {
      /*
       * Die Tür muss auf dem ECHTEN Weg halten, nicht nur in `tick`.
       * `buttons.settleCreator` ruft zuerst `creator.settle`, und das holt sich
       * `db.getCreator(..., 'youtube', ...)` – das „legt sie beim ersten Zugriff
       * an" (db.js). Eine Tür, die nur die EXISTENZ einer Kanalzeile prüft,
       * stand danach für immer offen: Gemessen genügte ein Blick in die
       * Creator-Ansicht – auch der Klick auf das eigene Firmendrama – für einen
       * `sponsor_betrug`. Genau deshalb läuft dieser Test über den Knopf und
       * nicht über `tick`; über `tick` fiel der Fehler nicht auf.
       */
      const buttons = require('../src/buttons');
      const treffer2 = () => 0;
      {
        const U = 'nur-geschaut';
        db.clearCreator(G, U);
        db.clearEvents(G, U);
        const text = await buttons.settleCreator(G, U, treffer2);
        const zeilen = db.allCreator(G, U);
        check('settleCreator legt selbst eine Kanalzeile an – das war das Leck',
          zeilen.length > 0 && zeilen.every((r) => r.actions === 0),
          zeilen.map((r) => `${r.platform}:${r.actions}`).join(' '));
        check('wer nur geschaut hat, würfelt trotzdem nicht (über settleCreator)',
          db.openEvent(G, U, 'creator') === null, String(text));
        check('… und seine Uhr bleibt stehen',
          db.decisionUhr(G, U, 'creator').last_roll === 0);
      }
      {
        const U = 'wirklich-gesendet';
        db.clearCreator(G, U);
        db.clearEvents(G, U);
        const r = await creator.act(G, U, 'twitter', 'ankuendigung', Date.now(), treffer2);
        check('eine echte Aktion zählt `actions` hoch',
          r.ok === true && db.allCreator(G, U).some((row) => row.actions > 0),
          JSON.stringify({ reason: r.reason }));
        // Null Follower sind erlaubt – genau dafür sind die frühen Vorfälle da.
        for (const row of db.allCreator(G, U)) {
          db.saveCreator(G, U, row.platform, { ...row, followers: 0 });
        }
        db.clearEvents(G, U);
        const text = await buttons.settleCreator(G, U, treffer2);
        check('wer wirklich gesendet hat, würfelt – auch bei null Followern (über settleCreator)',
          db.openEvent(G, U, 'creator') !== null, String(text));
      }
    }
    {
      // Und die Tür steht nur für die zwei Bereiche, die tick überhaupt kennt.
      check('betreten() kennt keinen dritten Bereich',
        decisions.betreten(G, 'frueh-ohne-kanal', 'company') === false);
    }
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
