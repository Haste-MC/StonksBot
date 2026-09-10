const db = require('./db');
const data = require('./data/heists');
const gearData = require('./data/gear');
// Spät gebunden, damit Tests die Geldschnittstelle ersetzen können (§8).
const unb = require('./unb');

const changeCash = (...a) => unb.changeCash(...a);

/**
 * ===========================================================================
 *  HEISTS – der kriminelle Pfad
 * ===========================================================================
 *
 * Alles andere im Spiel ist ein Kreislauf: kaufen, arbeiten, warten,
 * wiederholen. Ein Ding ist ein **Projekt**. Man wählt ein Ziel, besorgt über
 * Tage die Vorbereitung, holt Leute dazu – und dann entscheidet ein einziger
 * Wurf über alles.
 *
 * Die Erfolgschance ist offen einsehbar und setzt sich zusammen aus:
 *
 *     Grundchance des Ziels
 *   + jede erledigte Vorbereitung
 *   + Ausrüstungsstufe der Crew
 *   + jeder über die Mindestgröße hinausgehende Kopf
 *   − Fahndungsdruck
 *
 * ================== WARUM DAS KEIN GELDDRUCKER IST (§3) ==================
 * Ein Ding ohne Vorbereitung hat einen **negativen Erwartungswert**: Die
 * Grundchancen liegen zwischen 20 % und 55 %, und ein Fehlschlag kostet
 * ungefähr so viel, wie ein Erfolg einbringt. Erst wer Geld, Zeit und
 * Ausrüstung investiert, dreht das ins Plus – und zahlt dafür vorher.
 * Zusätzlich gedeckelt durch Abklingzeiten, Knast und die Fahndung, die mit
 * jedem Ding steigt. Nachgerechnet über 20.000 simulierte Coups in
 * test/heist.test.js.
 * =========================================================================
 */

const DAY_MS = 24 * 60 * 60 * 1000;
const HOUR_MS = 60 * 60 * 1000;

/**
 * Pause zwischen zwei Dingern – je Ziel verschieden (`cooldownH` in
 * data/heists.js).
 *
 * Vorher war es EINE Zahl für alle sieben Ziele. Damit ließ sich der
 * Goldtransport nicht entschleunigen, ohne den Spätkauf mit 3.000 Beute
 * gleich mitzusperren. Die Staffelung ist so gewählt, dass der Ertrag pro Tag
 * über die Ziele hinweg **aufsteigend** bleibt – sonst lohnte der Aufstieg
 * nicht mehr (siehe test/heist.test.js).
 *
 * Der Knast läuft weiter PARALLEL, nicht obendrauf: Beim Goldtransport sind
 * beide 72 h, ein Fehlschlag kostet dort also nur die Geldstrafe. Bewusst so.
 */
const HEIST_COOLDOWN_MS = 12 * HOUR_MS;      // Rückfall für Ziele ohne eigene Angabe

/** Die Sperre dieses Ziels in Millisekunden. */
function cooldownOf(loc) {
  return (loc?.cooldownH ?? 12) * HOUR_MS;
}

/** Fahndung: klingt pro Tag um diesen Anteil ab. */
const HEAT_DECAY = 0.12;
const HEAT_MAX = 100;

/** Wie stark volle Fahndung die Erfolgschance drückt. */
const HEAT_RISK = 0.25;

/** Und wie stark sie Strafen erhöht. */
const HEAT_FINE = 0.8;

/** Jeder Kopf über der Mindestgröße hilft – bis zu dieser Grenze. */
const CREW_BONUS = 0.04;
const CREW_BONUS_MAX = 0.12;

/** Grenzen der Erfolgschance: sicher ist nie etwas. */
const MIN_CHANCE = 0.05;
const MAX_CHANCE = 0.93;

/** Anteil der Beute bei einem Erfolg mit Komplikationen. */
const MESSY_LOOT = 0.6;

/** Der Anführer bekommt einen Organisationsaufschlag. */
const LEADER_SHARE = 1.15;

/** Wahrscheinlichkeit, bei einem Desaster Ausrüstung zu verlieren. */
const GEAR_LOSS_CHANCE = 0.5;

/**
 * ===========================================================================
 *  DER DURCHLAUF
 * ===========================================================================
 *
 * Ein Ding ist kein einzelner Wurf mehr. Zwischen „los" und „raus" stehen
 * mehrere **Szenen**, und jede verlangt eine Entscheidung: sicher oder gierig
 * (siehe data/heists.js).
 *
 * In der Crew kommt **reihum jeder mindestens einmal** dran – deshalb gibt es
 * nie weniger Szenen als Köpfe. Wer allein arbeitet, entscheidet alles selbst.
 *
 * Damit ein Ding nicht ewig offen steht, wenn jemand nicht mehr antwortet,
 * darf nach `TURN_TIMEOUT_MS` jeder aus der Crew für ihn übernehmen.
 */

/** So viele Szenen mindestens – auch allein. */
const MIN_STAGES = 3;

/** Danach darf die Crew für den Zögernden entscheiden. */
const TURN_TIMEOUT_MS = Number(process.env.HEIST_TURN_MIN || '5') * 60 * 1000;

const locationById = new Map(data.LOCATIONS.map((l) => [l.id, l]));
const prepById = new Map(data.PREPS.map((p) => [p.id, p]));

const clamp = (min, max, v) => Math.min(max, Math.max(min, v));
const pick = (list, random) => list[Math.floor(random() * list.length)];

/** Ziel und Vorbereitungsschritt per ID. */
function location(id) { return locationById.get(String(id ?? '')) ?? null; }
function prep(id) { return prepById.get(String(id ?? '')) ?? null; }

/** Die Vorbereitungen, die dieses Ziel verlangt. */
function prepsFor(loc) {
  return (loc?.preps ?? []).map((id) => prep(id)).filter(Boolean);
}

// ---------------------------------------------------------------- Fahndung

/** Fahndung, nachdem sie seit dem letzten Mal abgeklungen ist. */
function heatNow(row, now) {
  if (!row.heat || !row.heat_at) return row.heat || 0;
  const days = Math.max(0, (now - row.heat_at) / DAY_MS);
  return clamp(0, HEAT_MAX, row.heat * Math.pow(1 - HEAT_DECAY, days));
}

/** Sitzt dieser Spieler gerade? */
function jailedMs(row, now) {
  return Math.max(0, (row.jailed_until ?? 0) - now);
}

/** Die Fahndungsakte mit aktuellen Werten. */
function recordOf(guildId, userId, now = Date.now()) {
  const row = db.getCriminal(guildId, userId, now);
  return {
    ...row,
    heat: heatNow(row, now),
    jailedMs: jailedMs(row, now),
    /*
     * Bestandszeilen kennen `cooldown_until` noch nicht (Standard 0). Für sie
     * gilt die alte Rechnung, damit durch das Update niemand eine laufende
     * Sperre verliert – und niemand eine geschenkt bekommt.
     */
    cooldownMs: Math.max(0, (row.cooldown_until
      || (row.last_heist_at ?? 0) + HEIST_COOLDOWN_MS) - now),
  };
}

// -------------------------------------------------------------- Ausrüstung

/** Die Ausrüstungsstufe eines Spielers. */
function tierOf(guildId, userId) {
  let best = data.TIERS[0];
  for (const tier of data.TIERS) {
    if (tier.items.every((item) => db.ownsNamed(guildId, userId, item))) best = tier;
  }
  return best;
}

/**
 * Die Stufe der Crew: Es zählt die **beste** Ausrüstung am Tisch – Werkzeug
 * lässt sich teilen, Wissen nicht.
 */
function crewTier(guildId, crew) {
  let best = data.TIERS[0];
  for (const member of crew) {
    const tier = tierOf(guildId, member.user_id);
    if (tier.tier > best.tier) best = tier;
  }
  return best;
}

// ----------------------------------------------------------- Erfolgschance

/**
 * Rechnet die Erfolgschance aus – und liefert die Bestandteile mit, damit die
 * Anzeige zeigen kann, woran es liegt.
 */
function oddsOf({ loc, done, tier, crewSize, heat }) {
  const fromPreps = done.reduce((sum, p) => sum + (p.risk ?? 0), 0);
  const extra = Math.max(0, crewSize - loc.minCrew);
  const fromCrew = Math.min(CREW_BONUS_MAX, extra * CREW_BONUS);
  const fromHeat = -(heat / HEAT_MAX) * HEAT_RISK;
  const raw = loc.base + fromPreps + tier.risk + fromCrew + fromHeat;

  return {
    chance: clamp(MIN_CHANCE, MAX_CHANCE, raw),
    base: loc.base, fromPreps, fromTier: tier.risk, fromCrew, fromHeat,
  };
}

/** Der Beutefaktor aus den Vorbereitungen. */
function lootFactor(done) {
  return 1 + done.reduce((sum, p) => sum + (p.loot ?? 0), 0);
}

/**
 * Mehr Hände tragen mehr – aber unterlinear.
 *
 * Ohne diesen Faktor wäre jede zusätzliche Person ein reiner Verlust (gleiche
 * Beute, mehr Köpfe). Mit ihm wächst die Beute mit der Crew, der Anteil je
 * Kopf sinkt aber trotzdem leicht: Sicherheit gegen Prozente, genau die
 * Abwägung, die ein Ding interessant macht.
 */
function crewFactor(loc, crewSize) {
  return Math.pow(Math.max(1, crewSize) / Math.max(1, loc.minCrew), 0.8);
}

// ------------------------------------------------------------- Szenenfolge

/** Wie viele Szenen dieses Ding hat: nie weniger als Köpfe (und nie 0). */
function stagesFor(crewSize) {
  return clamp(MIN_STAGES, data.SCENES.length, Math.max(MIN_STAGES, crewSize));
}

/** Zieht so viele verschiedene Szenen – kein Ding gleicht dem anderen. */
function pickScenes(count, random = Math.random) {
  const pool = data.SCENES.map((s) => s.id);
  const out = [];
  while (out.length < count && pool.length) {
    out.push(...pool.splice(Math.floor(random() * pool.length), 1));
  }
  return out;
}

/**
 * Die Reihenfolge am Tisch: Der Anführer fängt an, danach in der
 * Beitrittsreihenfolge. `sort` ist stabil, die Crew bleibt also sortiert.
 */
function orderOf(crew, leaderId) {
  return [...crew].sort((a, b) =>
    Number(String(b.user_id) === String(leaderId))
    - Number(String(a.user_id) === String(leaderId)));
}

/** Wer entscheidet die Szene Nummer `stage` (1-basiert)? */
function turnFor(crew, leaderId, stage) {
  const order = orderOf(crew, leaderId);
  if (!order.length) return '';
  return String(order[(Math.max(1, stage) - 1) % order.length].user_id);
}

/** Die Szenen dieses Durchlaufs als Objekte. */
function scenesOf(heist) {
  return String(heist.scenes ?? '').split(',').filter(Boolean)
    .map((id) => data.scene(id)).filter(Boolean);
}

/**
 * Der Stand des laufenden Dings – alles, was die Ansicht braucht.
 * @returns {object|null} null, wenn gerade kein Durchlauf läuft
 */
function runOf(heist, crew, userId, now = Date.now()) {
  if (!heist || heist.status !== 'running') return null;

  const scenes = scenesOf(heist);
  const stage = Math.max(1, heist.stage || 1);
  const scene = scenes[stage - 1] ?? null;
  const waited = now - (heist.turn_at || 0);
  const takeoverIn = Math.max(0, TURN_TIMEOUT_MS - waited);

  return {
    stage,
    stages: heist.stages || scenes.length,
    scene,
    scenes,
    turnId: String(heist.turn_id ?? ''),
    // Dran ist, wer aufgerufen wurde – oder jeder, wenn zu lange nichts kam.
    yourTurn: String(heist.turn_id ?? '') === String(userId) || takeoverIn === 0,
    takeoverIn,
    oddsMod: heist.odds_mod ?? 0,
    lootMod: heist.loot_mod ?? 0,
    calls: db.callsOf(heist.id).map((c) => ({
      ...c,
      scene: data.scene(c.scene),
      option: data.scene(c.scene)?.options.find((o) => o.id === c.option) ?? null,
    })),
  };
}

// ------------------------------------------------------------------ Planen

/** Der Zustand eines Spielers im kriminellen Pfad. */
function status(guildId, userId, now = Date.now()) {
  const record = recordOf(guildId, userId, now);
  const membership = db.crewMembership(guildId, userId);
  const heist = membership ? db.getHeist(guildId, membership.heist_id) : null;

  if (!heist) {
    return {
      record, heist: null, tier: tierOf(guildId, userId),
      open: db.openHeists(guildId, 8).map((h) => ({
        ...h,
        location: location(h.location),
        crew: db.crewOf(h.id).length,
      })),
      history: db.heistHistory(guildId, userId, 5)
        .map((h) => ({ ...h, location: location(h.location) })),
    };
  }

  const loc = location(heist.location);
  const crew = db.crewOf(heist.id);
  const doneIds = new Set(db.prepsOf(heist.id).map((p) => p.prep));
  const steps = prepsFor(loc).map((p) => ({ ...p, done: doneIds.has(p.id) }));
  const done = steps.filter((p) => p.done);
  const tier = crewTier(guildId, crew);
  const odds = oddsOf({
    loc, done, tier, crewSize: crew.length, heat: record.heat,
  });

  return {
    record, tier,
    heist: {
      ...heist,
      location: loc,
      crew,
      steps,
      done: done.length,
      total: steps.length,
      // Läuft das Ding gerade? Dann zählt nur noch die aktuelle Szene.
      run: runOf(heist, crew, userId, now),
      isLeader: heist.leader_id === String(userId),
      ready: crew.length >= loc.minCrew && tier.tier >= loc.gearTier,
      odds,
      loot: [
        Math.round(loc.loot[0] * lootFactor(done) * crewFactor(loc, crew.length)),
        Math.round(loc.loot[1] * lootFactor(done) * crewFactor(loc, crew.length)),
      ],
    },
    open: [],
    history: db.heistHistory(guildId, userId, 5)
      .map((h) => ({ ...h, location: location(h.location) })),
  };
}

/** Ein Ding planen. Höchstens eine Planung gleichzeitig. */
function plan(guildId, userId, locationId, now = Date.now()) {
  const loc = location(locationId);
  if (!loc) return { ok: false, reason: 'unknown_location' };

  const record = recordOf(guildId, userId, now);
  if (record.jailedMs > 0) {
    return { ok: false, reason: 'jailed', remainingMs: record.jailedMs };
  }
  if (db.crewMembership(guildId, userId)) return { ok: false, reason: 'already_planning' };
  if (record.cooldownMs > 0) {
    return { ok: false, reason: 'cooldown', remainingMs: record.cooldownMs };
  }

  const heist = db.insertHeist({
    guildId, leaderId: userId, location: loc.id, createdAt: now,
  });
  db.addCrew(heist.id, guildId, userId, now);
  return { ok: true, heist, location: loc };
}

/** Einer offenen Planung beitreten. */
function join(guildId, userId, heistId, now = Date.now()) {
  const heist = db.getHeist(guildId, heistId);
  if (!heist || heist.status !== 'planning') return { ok: false, reason: 'gone' };

  const record = recordOf(guildId, userId, now);
  if (record.jailedMs > 0) {
    return { ok: false, reason: 'jailed', remainingMs: record.jailedMs };
  }
  if (db.crewMembership(guildId, userId)) return { ok: false, reason: 'already_planning' };

  const loc = location(heist.location);
  const crew = db.crewOf(heist.id);
  if (crew.length >= loc.maxCrew) return { ok: false, reason: 'full', location: loc };

  db.addCrew(heist.id, guildId, userId, now);
  return { ok: true, heist, location: loc, crew: crew.length + 1 };
}

/** Eine Planung verlassen. Der Anführer löst sie damit auf. */
function leave(guildId, userId, now = Date.now()) {
  const membership = db.crewMembership(guildId, userId);
  if (!membership) return { ok: false, reason: 'not_planning' };
  const heist = db.getHeist(guildId, membership.heist_id);
  if (!heist) return { ok: false, reason: 'gone' };
  // Mitten im Ding steigt niemand aus – sonst wäre der Abbruch die beste
  // Antwort auf eine schlechte Szene, und das Risiko wäre keins mehr.
  if (heist.status === 'running') return { ok: false, reason: 'running' };

  if (heist.leader_id === String(userId)) {
    db.finishHeist(guildId, heist.id, {
      status: 'cancelled', outcome: '', loot: 0, chance: 0, at: now,
    });
    for (const member of db.crewOf(heist.id)) db.removeCrew(heist.id, member.user_id);
    return { ok: true, cancelled: true, heist };
  }

  db.removeCrew(heist.id, userId);
  return { ok: true, cancelled: false, heist };
}

/**
 * Einen Vorbereitungsschritt erledigen.
 *
 * Bezahlt wird sofort und einmal (§9); der Schritt wird **vor** der Buchung
 * eingetragen (§7), damit ein zweiter Klick ins Leere läuft.
 */
async function doPrep(guildId, userId, prepId, now = Date.now()) {
  const membership = db.crewMembership(guildId, userId);
  if (!membership) return { ok: false, reason: 'not_planning' };
  const heist = db.getHeist(guildId, membership.heist_id);
  if (!heist || heist.status !== 'planning') return { ok: false, reason: 'gone' };

  const loc = location(heist.location);
  const step = prep(prepId);
  if (!step || !loc.preps.includes(step.id)) {
    return { ok: false, reason: 'unknown_prep', location: loc };
  }

  const record = recordOf(guildId, userId, now);
  if (record.jailedMs > 0) {
    return { ok: false, reason: 'jailed', remainingMs: record.jailedMs };
  }

  const wait = Math.max(0, (record.last_prep_at ?? 0) + step.cooldownMin * 60 * 1000 - now);
  if (wait > 0) return { ok: false, reason: 'cooldown', remainingMs: wait, prep: step };

  if (db.prepsOf(heist.id).some((p) => p.prep === step.id)) {
    return { ok: false, reason: 'already_done', prep: step };
  }

  // Voraussetzungen prüfen.
  const crew = db.crewOf(heist.id);
  if (step.needs?.item && !db.ownsNamed(guildId, userId, step.needs.item)) {
    const item = gearData.findGear(step.needs.item);
    return {
      ok: false, reason: 'needs_item', prep: step,
      item: step.needs.item, price: item?.price ?? null,
    };
  }
  if (step.needs?.car && db.bestCarValue(guildId, userId) < step.needs.car) {
    return { ok: false, reason: 'needs_car', prep: step, need: step.needs.car };
  }
  if (step.needs?.crew && crew.length < step.needs.crew) {
    return { ok: false, reason: 'needs_crew', prep: step, need: step.needs.crew, have: crew.length };
  }

  if (step.cost > 0) {
    const balance = await unb.getBalance(guildId, userId).catch(() => null);
    if (!balance || balance.total < step.cost) {
      return { ok: false, reason: 'too_poor', prep: step, cost: step.cost, have: balance?.total ?? 0 };
    }
  }

  // Erst eintragen, dann zahlen (§7).
  if (!db.addPrep(heist.id, step.id, userId, now)) {
    return { ok: false, reason: 'already_done', prep: step };
  }
  db.saveCriminal(guildId, userId, { ...db.getCriminal(guildId, userId, now), last_prep_at: now });

  const paid = step.cost > 0
    ? await changeCash(guildId, userId, -step.cost, `Vorbereitung: ${step.name}`)
    : null;

  return { ok: true, prep: step, balance: paid, heist };
}

/**
 * Das Ding starten. Nur der Anführer, nur einmal – der Statuswechsel
 * geschieht vor allem anderen (§7).
 *
 * Gewürfelt wird hier noch nichts: Erst laufen die Szenen, und was die Crew
 * dabei entscheidet, verschiebt Chance und Beute (siehe `decide`).
 */
async function execute(guildId, userId, now = Date.now(), random = Math.random) {
  const membership = db.crewMembership(guildId, userId);
  if (!membership) return { ok: false, reason: 'not_planning' };
  const heist = db.getHeist(guildId, membership.heist_id);
  if (!heist) return { ok: false, reason: 'gone' };
  if (heist.status === 'running') return { ok: false, reason: 'running' };
  if (heist.status !== 'planning') return { ok: false, reason: 'gone' };
  if (heist.leader_id !== String(userId)) return { ok: false, reason: 'not_leader' };

  const loc = location(heist.location);
  const crew = db.crewOf(heist.id);
  const record = recordOf(guildId, userId, now);
  if (record.jailedMs > 0) {
    return { ok: false, reason: 'jailed', remainingMs: record.jailedMs };
  }
  if (crew.length < loc.minCrew) {
    return { ok: false, reason: 'too_few', need: loc.minCrew, have: crew.length, location: loc };
  }

  const tier = crewTier(guildId, crew);
  if (tier.tier < loc.gearTier) {
    return {
      ok: false, reason: 'gear', location: loc,
      need: data.TIERS[loc.gearTier], have: tier,
    };
  }

  // Szenenfolge festlegen und den Ersten aufrufen. Erst schreiben, dann
  // melden: Ein zweiter Klick findet kein 'planning' mehr vor (§7).
  const stages = stagesFor(crew.length);
  const scenes = pickScenes(stages, random);
  const turnId = turnFor(crew, heist.leader_id, 1);

  if (!db.startRun(guildId, heist.id, {
    stage: 1, stages, turnId, turnAt: now, scenes,
  })) return { ok: false, reason: 'gone' };

  const fresh = db.getHeist(guildId, heist.id);
  return {
    ok: true, started: true, location: loc, crew,
    run: runOf(fresh, crew, userId, now),
  };
}

/**
 * Eine Szene entscheiden.
 *
 * Dran ist, wer aufgerufen wurde – oder nach `TURN_TIMEOUT_MS` jeder aus der
 * Crew, damit ein Ding nicht an einem hängt, der offline ist.
 *
 * Reihenfolge wie überall (§7): erst die Entscheidung festschreiben (die
 * Tabelle lässt je Szene genau eine zu), dann weiterrücken. Zwei gleichzeitige
 * Klicks können deshalb weder doppelt zählen noch zwei Szenen überspringen.
 */
async function decide(guildId, userId, optionId, now = Date.now(), random = Math.random) {
  const membership = db.crewMembership(guildId, userId);
  if (!membership) return { ok: false, reason: 'not_planning' };
  const heist = db.getHeist(guildId, membership.heist_id);
  if (!heist || heist.status !== 'running') return { ok: false, reason: 'not_running' };

  const crew = db.crewOf(heist.id);
  const run = runOf(heist, crew, userId, now);
  if (!run?.scene) return { ok: false, reason: 'gone' };
  if (!run.yourTurn) {
    return {
      ok: false, reason: 'not_your_turn',
      turnId: run.turnId, takeoverIn: run.takeoverIn, run,
    };
  }

  const option = run.scene.options.find((o) => o.id === String(optionId));
  if (!option) return { ok: false, reason: 'unknown_option', run };

  if (!db.addCall({
    heistId: heist.id, stage: run.stage, guildId, userId,
    scene: run.scene.id, option: option.id,
    odds: option.odds ?? 0, loot: option.loot ?? 0, at: now,
  })) return { ok: false, reason: 'already_decided', run };

  const odds = (heist.odds_mod ?? 0) + (option.odds ?? 0);
  const loot = (heist.loot_mod ?? 0) + (option.loot ?? 0);
  const heat = (heist.heat_mod ?? 0) + (option.heat ?? 0);
  const last = run.stage >= run.stages;

  if (!db.advanceRun(guildId, heist.id, run.stage, {
    stage: last ? run.stage : run.stage + 1,
    turnId: last ? '' : turnFor(crew, heist.leader_id, run.stage + 1),
    turnAt: now,
    odds, loot, heat,
  })) return { ok: false, reason: 'gone' };

  const fresh = db.getHeist(guildId, heist.id);
  if (!last) {
    return {
      ok: true, finished: false, scene: run.scene, option,
      by: String(userId), run: runOf(fresh, crew, userId, now),
    };
  }

  /*
   * `finished` und nicht `done`: Der Ausgang bringt sein eigenes `done` mit –
   * die Zahl der erledigten Vorbereitungen. Zwei Bedeutungen für dasselbe
   * Wort haben hier schon einmal dafür gesorgt, dass ein fertiges Ding als
   * „läuft noch" durchging.
   */
  const outcome = await resolve(guildId, fresh, crew, now, random);
  return { ok: true, scene: run.scene, option, by: String(userId), ...outcome, finished: true };
}

/**
 * Der Ausgang: würfeln, aufteilen, buchen.
 *
 * Chance und Beute tragen hier die Aufschläge aus den Entscheidungen –
 * `odds_mod` und `loot_mod` – mit. Der Rest ist unverändert: eine Buchung je
 * Kopf (§9), Status vor jeder Buchung (§7).
 */
async function resolve(guildId, heist, crew, now = Date.now(), random = Math.random) {
  const loc = location(heist.location);
  const doneIds = new Set(db.prepsOf(heist.id).map((p) => p.prep));
  const done = prepsFor(loc).filter((p) => doneIds.has(p.id));
  const tier = crewTier(guildId, crew);
  const heat = crew.reduce(
    (sum, m) => sum + heatNow(db.getCriminal(guildId, m.user_id, now), now), 0) / crew.length;

  const base = oddsOf({ loc, done, tier, crewSize: crew.length, heat });
  const odds = {
    ...base,
    fromCalls: heist.odds_mod ?? 0,
    chance: clamp(MIN_CHANCE, MAX_CHANCE, base.chance + (heist.odds_mod ?? 0)),
  };
  const callLoot = Math.max(0.2, 1 + (heist.loot_mod ?? 0));

  // --- Der Wurf ---
  const roll = random();
  let outcome;
  if (roll < odds.chance * 0.75) outcome = 'clean';
  else if (roll < odds.chance) outcome = 'messy';
  else if (roll < odds.chance + (1 - odds.chance) * 0.6) outcome = 'failed';
  else outcome = 'disaster';

  const success = outcome === 'clean' || outcome === 'messy';
  const spread = loc.loot[1] - loc.loot[0];
  const gross = success
    ? Math.round((loc.loot[0] + random() * spread) * lootFactor(done)
      * crewFactor(loc, crew.length) * callLoot * (outcome === 'messy' ? MESSY_LOOT : 1))
    : 0;

  // Zuerst den Status – danach kann niemand dasselbe Ding zweimal ziehen.
  if (!db.finishHeist(guildId, heist.id, {
    status: success ? 'done' : 'busted',
    outcome, loot: gross, chance: odds.chance, at: now,
  })) return { ok: false, reason: 'gone' };

  // --- Aufteilen oder büßen ---
  const shares = crew.map((m) => (m.user_id === heist.leader_id ? LEADER_SHARE : 1));
  const total = shares.reduce((a, b) => a + b, 0);
  const members = [];

  for (let i = 0; i < crew.length; i++) {
    const member = crew[i];
    const row = db.getCriminal(guildId, member.user_id, now);
    const memberHeat = heatNow(row, now);
    const extraHeat = loc.heat * (outcome === 'disaster' ? 1.5 : outcome === 'messy' ? 1.2 : 1)
      + (heist.heat_mod ?? 0);

    let amount = 0;
    let jailUntil = 0;
    let lostGear = null;

    if (success) {
      // Der Level-Zuschlag gilt für jede Einnahme – auch für die Beute.
      // Die Strafe im else-Zweig bleibt unangetastet (siehe perks.payout).
      amount = require('./perks').payout(
        guildId, member.user_id, Math.round(gross * (shares[i] / total)));
    } else {
      const factor = outcome === 'disaster' ? 1.5 : 1;
      amount = -Math.round(loc.fine * factor * (1 + (memberHeat / HEAT_MAX) * HEAT_FINE));
      jailUntil = now + loc.jailHours * factor * HOUR_MS;
      if (outcome === 'disaster' && random() < GEAR_LOSS_CHANCE) {
        const owned = data.TIERS.at(-1).items
          .filter((item) => db.ownsNamed(guildId, member.user_id, item));
        if (owned.length) {
          const item = pick(owned, random);
          if (db.consumeNamed(guildId, member.user_id, item)) lostGear = item;
        }
      }
    }

    // Der Anteil bleibt an der Crew-Zeile stehen: Sie ist zugleich die
    // Historie. Gelöscht wird sie nicht – `crewMembership` schaut ohnehin nur
    // auf laufende Dinger, und ohne die Zeile gäbe es keine Akte.
    db.setShare(heist.id, member.user_id, amount);
    db.saveCriminal(guildId, member.user_id, {
      ...row,
      heat: clamp(0, HEAT_MAX, memberHeat + extraHeat),
      heat_at: now,
      jailed_until: Math.max(row.jailed_until ?? 0, jailUntil),
      heists: row.heists + 1,
      busted: row.busted + (success ? 0 : 1),
      loot_total: row.loot_total + Math.max(0, amount),
      last_heist_at: now,
      cooldown_until: now + cooldownOf(loc),
    });

    // Ein Ding ganz ohne Fehler – das gibt es nur bei `clean`, nicht bei
    // `messy`. Kein Geldereignis, deshalb die Hintertür. Auch das `require`
    // selbst kapseln (wie unb.js es tut): Ein Erfolg darf niemals einen
    // Heist zum Kippen bringen, egal ob er synchron beim Laden des Moduls
    // oder erst später scheitert.
    if (outcome === 'clean') {
      try { require('./achievements').fire(guildId, member.user_id, 'heist_perfect').catch(() => {}); }
      catch { /* ein Erfolg darf einen Heist nicht kippen */ }
    }

    const balance = amount !== 0
      ? await changeCash(
        guildId, member.user_id, amount,
        success ? `Beute: ${loc.name}` : `Strafe: ${loc.name}`,
        { kind: 'heist' }).catch(() => null)
      : null;

    members.push({
      userId: member.user_id, amount, jailUntil, lostGear, balance,
      leader: member.user_id === heist.leader_id,
    });
  }

  const texts = { clean: data.CLEAN, messy: data.MESSY, failed: data.FAILED, disaster: data.DISASTER };
  const calls = db.callsOf(heist.id);
  return {
    ok: true, outcome, success, location: loc, crew: crew.length, tier,
    odds, gross, members, done: done.length, total: loc.preps.length,
    calls: calls.map((c) => ({
      ...c,
      scene: data.scene(c.scene),
      option: data.scene(c.scene)?.options.find((o) => o.id === c.option) ?? null,
    })),
    text: pick(texts[outcome], random),
    jailHours: success ? 0 : loc.jailHours * (outcome === 'disaster' ? 1.5 : 1),
  };
}

module.exports = {
  LOCATIONS: data.LOCATIONS, PREPS: data.PREPS, TIERS: data.TIERS,
  HEIST_COOLDOWN_MS, cooldownOf, HEAT_DECAY, HEAT_MAX, HEAT_RISK, HEAT_FINE,
  CREW_BONUS, CREW_BONUS_MAX, MIN_CHANCE, MAX_CHANCE, MESSY_LOOT, LEADER_SHARE,
  location, prep, prepsFor, heatNow, jailedMs, recordOf, tierOf, crewTier,
  oddsOf, lootFactor, crewFactor, status, plan, join, leave, doPrep, execute,
  MIN_STAGES, TURN_TIMEOUT_MS, SCENES: data.SCENES, scene: data.scene,
  stagesFor, pickScenes, turnFor, orderOf, scenesOf, runOf, decide, resolve,
};
