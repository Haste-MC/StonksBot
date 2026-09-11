const db = require('./db');
const { DECISIONS } = require('./data/decisions');
const { MUSIC_DECISIONS } = require('./data/musicDecisions');
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

/** Beide Kataloge in einer Map – die Zeile in der DB kennt nur die `kind`. */
const byId = new Map([...DECISIONS, ...MUSIC_DECISIONS].map((d) => [d.id, d]));

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
 * Zulassung eines Musik-Vorfalls: Persona, vorhandene Titel, Vertrag.
 *
 * Ohne diese Prüfung träfe „Das Label will verschieben" jemanden ohne Label
 * und „Album im Netz" jemanden ohne Album – Vorfälle ins Leere.
 */
function musicEligible(d, artist, contract) {
  const r = d.requires ?? {};
  if (r.persona && artist.persona !== r.persona) return false;
  if (r.songs && (artist.songs ?? 0) < r.songs) return false;
  if (r.contract && !contract) return false;
  return true;
}

/**
 * Würfelt einen Vorfall aus. Höchstens einer gleichzeitig, und nicht öfter
 * als MIN_GAP_MS – sonst wäre der Kanal ein Katastrophengebiet.
 *
 * `size` ist bei Creator die Reichweite, bei Musik die Hörerzahl – dieselbe
 * Risikokurve. Die Sperre „solange einer offen ist" gilt über beide Domänen:
 * Wer gerade ein Creator-Drama hat, bekommt kein Musik-Drama obendrauf.
 */
function roll(guildId, userId, size, now = Date.now(), random = Math.random, domain = 'creator') {
  if (db.openEvent(guildId, userId)) return null;
  if (now - db.lastEventAt(guildId, userId) < MIN_GAP_MS) return null;
  if (random() >= riskFor(size)) return null;

  let possible;
  if (domain === 'music') {
    const artist = db.getArtist(guildId, userId, now);
    const contract = db.activeContract(guildId, userId);
    possible = MUSIC_DECISIONS.filter((d) =>
      size >= d.minListeners && musicEligible(d, artist, contract));
  } else {
    possible = DECISIONS.filter((d) => size >= d.minReach);
  }
  if (!possible.length) return null;
  const picked = possible[Math.floor(random() * possible.length)];

  return db.insertEvent({
    guildId, userId,
    kind: picked.id,
    platform: domain === 'music' ? 'music' : (picked.platform ?? ''),
    createdAt: now,
    expiresAt: now + DECIDE_MS,
  });
}

/**
 * Wendet eine Musik-Wirkung an – nur auf die Künstlerzeile, nie auf Kanäle.
 *
 * Reihenfolge: erst alles, was synchron in die Künstlerzeile geht (§7), dann
 * Ausrüstung, dann die erzwungene Veröffentlichung, dann das, was bucht
 * (Vertragsbruch ODER Geld – nie beides, siehe Katalogtest, §9).
 *
 * Verluste werden wie beim Creator verstärkt: Härte nach Größe, × 1,6 bei
 * Schweigen, × 2 unter Idol-Vertrag. Gewinne nicht.
 */
async function applyMusic(guildId, userId, row, effect, now, ignored, random) {
  const music = require('./music');
  const artist = db.getArtist(guildId, userId, now);
  const market = music.marketOf(guildId, userId);
  const contract = music.contractOf(guildId, userId);
  const weight = severityFor(artist.listeners)
    * (ignored ? IGNORE_PENALTY : 1)
    * (contract ? music.IDOL.scandalFactor : 1);
  const scaled = (v) => (v < 0 ? v * weight : v);
  const done = {
    listeners: 0, songs: 0, cash: 0, hype: effect.hype ?? 0,
    lockRelease: 0, lockShow: 0, gear: null, contract: null, published: null,
  };

  // --- Künstlerzeile: ein synchroner Schreibvorgang ---
  const next = { ...artist };
  if (effect.listeners) {
    next.listeners = Math.max(0, Math.round(artist.listeners * (1 + scaled(effect.listeners))));
    done.listeners = next.listeners - artist.listeners;
  }
  if (effect.songsShare) {
    // Anteil, nicht verstärkt: mehr als „alle weg" gibt es nicht.
    next.songs = Math.max(0, Math.round(artist.songs * (1 + Math.max(-1, effect.songsShare))));
    done.songs = next.songs - artist.songs;
  }
  if (effect.hype) {
    next.hype = clamp(music.HYPE_MIN, music.HYPE_MAX, artist.hype * effect.hype);
  }
  // Sperren: der Zeitstempel wird so weit vorgeschoben, dass die Restzeit
  // genau `Tage` beträgt (remainingMs = at + Sperre − now).
  if (effect.lockRelease) {
    next.last_release_at = now + effect.lockRelease * DAY_MS - music.RELEASE_COOLDOWN_MIN * 60_000;
    done.lockRelease = effect.lockRelease;
  }
  if (effect.lockShow) {
    next.last_show_at = now + effect.lockShow * DAY_MS - music.SHOW_COOLDOWN_MIN * 60_000;
    done.lockShow = effect.lockShow;
  }
  db.saveArtist(guildId, userId, next);

  // --- Ausrüstung ---
  if (effect.gear && db.consumeNamed(guildId, userId, music.GEAR)) done.gear = music.GEAR;

  // --- Erzwungene Veröffentlichung: alles Aufgenommene, sofort ---
  if (effect.publish) {
    const a = db.getArtist(guildId, userId, now);
    const type = a.songs >= 6 ? 'album' : a.songs >= 3 ? 'ep' : 'single';
    const res = music.publish(guildId, userId, type, now, random,
      { events: false, force: true, audience: effect.audience ?? 1 });
    if (res.ok) {
      done.published = res;
      // Was das Release nicht verbraucht hat, ist trotzdem draußen.
      const after = db.getArtist(guildId, userId, now);
      db.saveArtist(guildId, userId, { ...after, songs: 0 });
    }
  }

  // --- Vertragsbruch: bucht die Strafe selbst (genau eine Buchung) ---
  if (effect.contract === 'break' && contract) {
    const res = await music.leave(guildId, userId, now);
    if (res.ok) {
      done.contract = res.contract;
      done.cash = -res.penalty;
      done.balance = res.balance;
    }
  }

  // --- Geld: in Tagen Tantiemen, genau eine Buchung ---
  if (effect.cash) {
    const perDay = music.royaltyPerDay(artist.listeners, market);
    const days = effect.cash < 0 ? scaled(effect.cash) : effect.cash;
    const amount = require('./perks').payout(guildId, userId, Math.round(days * perDay));
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
 * Wendet eine Wirkung an.
 *
 * Alles Zustandsbehaftete wird **vor** der Geldbuchung geschrieben (§7), und
 * gebucht wird genau einmal (§9).
 */
async function apply(guildId, userId, row, effect, now = Date.now(), ignored = false,
  random = Math.random) {
  if (row.platform === 'music') return applyMusic(guildId, userId, row, effect, now, ignored, random);
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
  /*
   * Unter Idol-Vertrag duldet die Agentur nichts: Jeder Fehltritt kostet das
   * Doppelte. Genau dafür gibt es den Vertragspunkt – ohne diese Stelle wäre
   * er nur ein Satz im Angebot.
   */
  let contractFactor = 1;
  try {
    const music = require('./music');
    if (music.contractOf(guildId, userId)) contractFactor = music.IDOL.scandalFactor;
  } catch { /* egal */ }

  const weight = severity * (ignored ? IGNORE_PENALTY : 1) * contractFactor;
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
    // Der Zuschlag greift nur nach oben – eine Strafe wächst nicht mit dem
    // Level mit (perks.payout lässt negative Beträge in Ruhe).
    const amount = require('./perks').payout(guildId, userId,
      scaleMoney(reach, effect.cash < 0 ? scaled(effect.cash) : effect.cash));
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

  const done = await apply(guildId, userId, row, outcome, now, false, random);
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
  DECISIONS, MUSIC_DECISIONS, DECIDE_MS, MIN_GAP_MS, RISK_MIN, RISK_MAX, RISK_FULL,
  SEVERITY_MAX, SEVERITY_FULL,
  IGNORE_PENALTY,
  decision, riskFor, severityFor, scaleMoney, pickOutcome, musicEligible,
  roll, apply, applyMusic, choose, expire, settle, pending, history,
};
