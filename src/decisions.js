const db = require('./db');
const { DECISIONS } = require('./data/decisions');
// Spät gebunden: creator.js zieht dieses Modul selbst herein (Kreis vermeiden).
const unb = require('./unb');

const changeCash = (...a) => unb.changeCash(...a);

/**
 * ===========================================================================
 *  ENTSCHEIDUNGEN – der Zufall, der nicht nur würfelt
 * ===========================================================================
 *
 * Ohne diese Vorfälle ist der Aufstieg eine reine Fleißaufgabe: Wer täglich
 * sendet, kommt sicher an. Genau daran krankt jede Aktivität, die sich
 * "durchoptimieren" lässt – man spielt sie nicht mehr, man arbeitet sie ab.
 *
 * Drei Eigenschaften machen den Unterschied:
 *
 *   1. **Keine Option ist sicher.** Jede Wahl hat mehrere gewichtete Ausgänge.
 *      Die brave Wahl kostet meistens ein wenig, die mutige kann alles kosten
 *      – und manchmal ist es umgekehrt.
 *   2. **Mit der Größe wird es gefährlicher.** Große Kanäle stehen unter
 *      Beobachtung: mehr Vorfälle, härtere Ausgänge. Die Spitze ist deshalb
 *      kein Zustand, den man erreicht und behält, sondern einer, den man
 *      halten muss.
 *   3. **Wegklicken hilft nicht.** Wer nicht entscheidet, bekommt den Ausgang,
 *      den Schweigen eben hat – meist einen schlechten.
 *
 * Das ist zugleich die Antwort auf §3 von der anderen Seite: Nicht die
 * Obergrenze wird gesenkt, sondern der Weg dorthin unsicher gemacht.
 */

const DAY_MS = 24 * 60 * 60 * 1000;

/** So lange steht eine Entscheidung offen. */
const DECIDE_MS = 24 * 60 * 60 * 1000;

/** Mindestabstand zwischen zwei Vorfällen. */
const MIN_GAP_MS = 36 * 60 * 60 * 1000;

/** Wahrscheinlichkeit je Aktion – wächst mit der Reichweite. */
const RISK_MIN = 0.02;
const RISK_MAX = 0.04;
const RISK_FULL = 1_500_000;

/**
 * Aufschlag auf die Verluste, wenn jemand gar nicht reagiert.
 *
 * Ohne ihn wäre Wegklicken eine Strategie: Die Ausgänge des Schweigens sind
 * ähnlich schlecht wie ein unglücklicher Zufallstreffer – nur ohne Risiko,
 * etwas falsch zu machen. Wer sich nicht kümmert, soll spürbar schlechter
 * fahren als jemand, der eine vernünftige Wahl trifft.
 */
const IGNORE_PENALTY = 1.6;

/**
 * Wie hart es die Großen trifft. Die Wirkungen in data/decisions.js sind für
 * mittlere Kanäle gedacht; oben kommt ein Aufschlag drauf, weil dort jeder
 * Fehltritt öffentlich ist.
 */
const SEVERITY_MAX = 1.6;
const SEVERITY_FULL = 3_000_000;

const byId = new Map(DECISIONS.map((d) => [d.id, d]));

const clamp = (min, max, v) => Math.min(max, Math.max(min, v));

/** Die Vorlage zu einem Vorfall. */
function decision(kind) {
  return byId.get(String(kind)) ?? null;
}

/** Wie wahrscheinlich ein Vorfall je Aktion ist. */
function riskFor(reach) {
  return clamp(RISK_MIN, RISK_MAX, (reach / RISK_FULL) * RISK_MAX);
}

/** Verstärkung der Wirkungen bei großen Kanälen (1 … SEVERITY_MAX). */
function severityFor(reach) {
  return clamp(1, SEVERITY_MAX, 1 + (reach / SEVERITY_FULL) * (SEVERITY_MAX - 1));
}

/** Geldbeträge wachsen mit dem, was der Kanal abwirft. */
function scaleMoney(reach, factor) {
  const creator = require('./creator');
  return Math.round(
    factor * Math.pow(Math.max(0, reach), 0.62) * creator.monetization(reach) * 3);
}

/** Zieht einen Ausgang nach Gewicht. */
function pickOutcome(option, random = Math.random) {
  const total = option.outcomes.reduce((s, o) => s + o.weight, 0);
  let roll = random() * total;
  for (const o of option.outcomes) {
    if (roll < o.weight) return o;
    roll -= o.weight;
  }
  return option.outcomes[option.outcomes.length - 1];
}

/**
 * Würfelt einen Vorfall aus. Höchstens einer gleichzeitig, und nicht öfter
 * als MIN_GAP_MS – sonst wäre der Kanal ein Katastrophengebiet.
 */
function roll(guildId, userId, reach, now = Date.now(), random = Math.random) {
  if (db.openEvent(guildId, userId)) return null;
  if (now - db.lastEventAt(guildId, userId) < MIN_GAP_MS) return null;
  if (random() >= riskFor(reach)) return null;

  const possible = DECISIONS.filter((d) => reach >= d.minReach);
  if (!possible.length) return null;
  const picked = possible[Math.floor(random() * possible.length)];

  return db.insertEvent({
    guildId, userId,
    kind: picked.id,
    platform: picked.platform ?? '',
    createdAt: now,
    expiresAt: now + DECIDE_MS,
  });
}

/**
 * Wendet eine Wirkung an.
 *
 * Alles Zustandsbehaftete wird **vor** der Geldbuchung geschrieben (§7), und
 * gebucht wird genau einmal (§9).
 */
async function apply(guildId, userId, row, effect, now = Date.now(), ignored = false) {
  const creator = require('./creator');
  const rows = db.allCreator(guildId, userId);
  const reach = rows.reduce((s, r) => s + r.followers, 0);
  const severity = severityFor(reach);
  const target = row.platform || null;
  const done = {
    followers: 0, community: 0, cash: 0, locked: [], gear: null,
    hype: effect.hype ?? 0, fatigue: effect.fatigue ?? 0,
  };

  /**
   * Verluste werden verstärkt, Gewinne nicht – Größe schützt nicht, und
   * Nichtstun erst recht nicht.
   */
  const weight = severity * (ignored ? IGNORE_PENALTY : 1);
  const scaled = (v) => (v < 0 ? v * weight : v);

  // --- Follower ---
  const touch = (r, factor) => {
    const before = r.followers;
    const after = Math.max(0, Math.round(before * (1 + factor)));
    db.saveCreator(guildId, userId, r.platform, { ...r, followers: after });
    done.followers += after - before;
  };
  if (effect.followers && target) {
    const r = rows.find((x) => x.platform === target);
    if (r) touch(r, scaled(effect.followers));
  }
  if (effect.followersAll) {
    for (const r of rows) touch(r, scaled(effect.followersAll));
  }

  // --- Form ---
  if (effect.hype) {
    for (const r of rows) {
      if (target && r.platform !== target) continue;
      db.saveCreator(guildId, userId, r.platform, {
        ...db.getCreator(guildId, userId, r.platform, now),
        hype: clamp(creator.HYPE_MIN, creator.HYPE_MAX, r.hype * effect.hype),
      });
    }
  }

  // --- Bindung und Erschöpfung ---
  if (effect.community || effect.fatigue) {
    const state = db.getCreatorState(guildId, userId, now);
    const community = creator.communityNow(state, now);
    const fatigue = creator.fatigueNow(state, now);
    db.saveCreatorState(guildId, userId, {
      ...state,
      community: clamp(0, creator.COMMUNITY_MAX, community + (effect.community ?? 0)),
      community_at: now,
      fatigue: clamp(0, creator.FATIGUE_MAX, fatigue + (effect.fatigue ?? 0)),
      fatigue_at: now,
    });
    done.community = effect.community ?? 0;
  }

  // --- Sperre ---
  if (effect.lock) {
    const until = now + effect.lock * DAY_MS;
    for (const r of rows) {
      if (target && r.platform !== target) continue;
      db.lockCreator(guildId, userId, r.platform, until);
      done.locked.push(r.platform);
    }
    done.lockUntil = until;
  }

  // --- Ausrüstung ---
  if (effect.gear) {
    const p = creator.platform(target ?? 'twitch');
    if (p?.gear && db.consumeNamed(guildId, userId, p.gear)) done.gear = p.gear;
  }

  // --- Geld: genau eine Buchung ---
  if (effect.cash) {
    const amount = scaleMoney(reach, effect.cash < 0 ? scaled(effect.cash) : effect.cash);
    if (amount !== 0) {
      const title = decision(row.kind)?.title ?? 'Vorfall';
      done.cash = amount;
      done.balance = await changeCash(guildId, userId, amount, `Vorfall: ${title}`)
        .catch(() => null);
    }
  }

  return done;
}

/**
 * Trifft eine Entscheidung.
 *
 * Der Vorfall wird **zuerst** geschlossen (§7): Ein zweiter schneller Klick
 * findet ihn erledigt vor und kann die Wirkung nicht doppelt auslösen.
 */
async function choose(guildId, userId, eventId, optionId, now = Date.now(), random = Math.random) {
  const row = db.getEvent(guildId, eventId);
  if (!row || row.user_id !== String(userId)) return { ok: false, reason: 'not_found' };
  if (row.status !== 'open') return { ok: false, reason: 'gone', row };

  const d = decision(row.kind);
  if (!d) return { ok: false, reason: 'unknown' };
  const option = d.options.find((o) => o.id === optionId);
  if (!option) return { ok: false, reason: 'unknown_option', decision: d };

  if (row.expires_at <= now) {
    const late = await expire(guildId, userId, row, now);
    return { ok: false, reason: 'expired', decision: d, result: late };
  }

  const outcome = pickOutcome(option, random);
  const closed = db.resolveEvent(guildId, row.id, {
    status: 'done', choice: option.id, outcome: outcome.text,
    effect: JSON.stringify(outcome), at: now,
  });
  if (!closed) return { ok: false, reason: 'gone', row };

  const done = await apply(guildId, userId, row, outcome, now);
  return { ok: true, decision: d, option, outcome, effect: done };
}

/** Lässt einen abgelaufenen Vorfall wirken. */
async function expire(guildId, userId, row, now = Date.now()) {
  const d = decision(row.kind);
  if (!d) {
    db.resolveEvent(guildId, row.id, { status: 'expired', outcome: '', effect: '', at: now });
    return null;
  }
  const closed = db.resolveEvent(guildId, row.id, {
    status: 'expired', choice: '', outcome: d.expire.text,
    effect: JSON.stringify(d.expire), at: now,
  });
  if (!closed) return null;

  const done = await apply(guildId, userId, row, d.expire, now, true);
  return { decision: d, outcome: d.expire, effect: done };
}

/** Rechnet abgelaufene Vorfälle ab (faule Abrechnung, §4). */
async function settle(guildId, userId, now = Date.now()) {
  const out = [];
  for (const row of db.overdueEvents(guildId, userId, now)) {
    const res = await expire(guildId, userId, row, now);
    if (res) out.push(res);
  }
  return out;
}

/** Der offene Vorfall mit seiner Vorlage, oder null. */
function pending(guildId, userId, now = Date.now()) {
  const row = db.openEvent(guildId, userId);
  if (!row) return null;
  const d = decision(row.kind);
  if (!d) return null;
  return { ...row, decision: d, remainingMs: Math.max(0, row.expires_at - now) };
}

/** Die letzten Vorfälle mit ihren Vorlagen. */
function history(guildId, userId, limit = 5) {
  return db.eventHistory(guildId, userId, limit)
    .map((row) => ({ ...row, decision: decision(row.kind) }))
    .filter((row) => row.decision);
}

module.exports = {
  DECISIONS, DECIDE_MS, MIN_GAP_MS, RISK_MIN, RISK_MAX, RISK_FULL,
  SEVERITY_MAX, SEVERITY_FULL,
  IGNORE_PENALTY,
  decision, riskFor, severityFor, scaleMoney, pickOutcome,
  roll, apply, choose, expire, settle, pending, history,
};
