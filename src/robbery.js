const db = require('./db');
const unb = require('./unb');

// Späte Bindung, damit Tests die Geldschnittstelle ersetzen können (§8).
const getBalance = (...a) => unb.getBalance(...a);
const changeCash = (...a) => unb.changeCash(...a);

/**
 * ===========================================================================
 *  ÜBERFALL – Geld von anderen Spielern
 * ===========================================================================
 *
 * UnbelievaBoats `!rob` lässt sich für Fluxer-Spieler nicht auslösen (die API
 * kennt keine Befehlsausführung, und eine gespiegelte Nachricht stammt vom Bot,
 * nicht vom Spieler). Deshalb hier nachgebaut – es wirkt über `changeCash` auf
 * **dieselben** UnbelievaBoat-Konten und funktioniert damit auf beiden
 * Plattformen gleich.
 *
 * ==================== KEIN GELDDRUCKER (§3) ====================
 * Ein Überfall ist reine UMVERTEILUNG: Was der eine bekommt, verliert der
 * andere – auf den Cent genau. Auch die Strafe bei Misserfolg geht an das
 * Opfer, statt zu verschwinden. Die Summe über beide Konten ändert sich nie.
 * ==============================================================
 *
 * Erfahrung gibt es dafür bewusst NICHT (`xp: false`): Sonst könnten sich zwei
 * Spieler gegenseitig ausrauben und daraus endlos Erfahrung erzeugen.
 */

const HOUR = 60 * 60 * 1000;

/** Balance-Stellschrauben. */
const RULES = {
  cooldownMs: 2 * HOUR,
  /** Grundchance auf Erfolg. */
  baseChance: 0.5,
  /** So viel vom Bargeld des Opfers ist höchstens erbeutbar. */
  maxShare: 0.3,
  /** Darunter lohnt sich ein Überfall nicht – schützt Arme. */
  minVictimCash: 500,
  /** Anteil des eigenen Bargelds, der bei Misserfolg ans Opfer geht. */
  penaltyShare: 0.15,
  /** Höchststrafe, damit ein Fehlschlag nicht ruiniert. */
  maxPenalty: 5000,
};

/** Wie lange noch bis zum nächsten Versuch? (0 = jetzt möglich) */
function remainingMs(guildId, accountId, now = Date.now()) {
  const claim = db.getClaim(guildId, accountId, 'rob');
  if (!claim) return 0;
  return Math.max(0, claim.claimed_at + RULES.cooldownMs - now);
}

/**
 * Erfolgschance.
 *
 * Je größer die Beute im Verhältnis zum eigenen Bargeld, desto riskanter –
 * das bremst, sich an einem viel Reicheren zu vergreifen, ohne es zu verbieten.
 */
function chanceFor(loot, robberCash) {
  const ratio = loot / Math.max(1, robberCash);
  const penalty = Math.min(0.25, ratio * 0.05);
  return Math.max(0.2, RULES.baseChance - penalty);
}

/**
 * Führt einen Überfall aus.
 *
 * Der Cooldown wird **vor** der Geldbewegung gesetzt: Ein zweiter, schneller
 * Versuch findet ihn dann schon vor (ARCHITEKTUR §7).
 */
async function rob(guildId, robberId, victimId, now = Date.now(), random = Math.random) {
  if (String(robberId) === String(victimId)) return { ok: false, reason: 'self' };

  const left = remainingMs(guildId, robberId, now);
  if (left > 0) return { ok: false, reason: 'cooldown', remainingMs: left };

  const [robber, victim] = await Promise.all([
    getBalance(guildId, robberId), getBalance(guildId, victimId),
  ]);

  if (victim.cash < RULES.minVictimCash) {
    return { ok: false, reason: 'victim_broke', have: victim.cash, needed: RULES.minVictimCash };
  }
  if (robber.cash <= 0) return { ok: false, reason: 'no_cash' };

  const loot = Math.max(1, Math.floor(victim.cash * RULES.maxShare * (0.4 + random() * 0.6)));
  const chance = chanceFor(loot, robber.cash);
  const success = random() < chance;

  db.setClaim(guildId, robberId, 'rob', now);

  if (!success) {
    // Strafe ans Opfer – so verschwindet nichts und Fehlschläge tun weh.
    const penalty = Math.min(
      RULES.maxPenalty, Math.max(1, Math.floor(robber.cash * RULES.penaltyShare)));
    const moved = await transfer(guildId, robberId, victimId, penalty, 'Überfall gescheitert');
    if (!moved) return { ok: false, reason: 'failed_transfer' };
    return { ok: true, success: false, penalty, chance };
  }

  const moved = await transfer(guildId, victimId, robberId, loot, 'Überfall');
  if (!moved) return { ok: false, reason: 'failed_transfer' };
  return { ok: true, success: true, amount: loot, chance };
}

/**
 * Verschiebt Bargeld von einem Konto zum anderen.
 *
 * Erst abbuchen, dann gutschreiben – und wenn die Gutschrift scheitert, wird
 * die Abbuchung zurückgenommen. So kann weder Geld entstehen noch verschwinden.
 * `xp: false`, weil eine Umverteilung kein Einkommen ist.
 */
async function transfer(guildId, fromId, toId, amount, reason) {
  await changeCash(guildId, fromId, -amount, reason, { xp: false });
  try {
    await changeCash(guildId, toId, amount, reason, { xp: false });
    return true;
  } catch (err) {
    await changeCash(guildId, fromId, amount, `${reason}: rückgängig`, { xp: false })
      .catch(() => {});
    return false;
  }
}

module.exports = { RULES, HOUR, remainingMs, chanceFor, rob, transfer };
