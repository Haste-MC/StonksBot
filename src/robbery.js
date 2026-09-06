const db = require('./db');
const unb = require('./unb');

// Späte Bindung, damit Tests die Geldschnittstelle ersetzen können (§8).
const getBalance = (...a) => unb.getBalance(...a);
const changeCash = (...a) => unb.changeCash(...a);
const withdrawFromBank = (...a) => unb.withdrawFromBank(...a);

/**
 * ===========================================================================
 *  ÜBERFALL – Geld von anderen Spielern
 * ===========================================================================
 *
 * UnbelievaBoats `!rob` lässt sich für Fluxer-Spieler nicht auslösen (die API
 * kennt keine Befehlsausführung, und eine gespiegelte Nachricht stammt vom Bot,
 * nicht vom Spieler). Deshalb hier nachgebaut – es wirkt über `changeCash` auf
 * **dieselben** UnbelievaBoat-Konten.
 *
 * Aufgerufen wird es **nur auf Fluxer** (`!rob`). Auf Discord bleibt der Befehl
 * UnbelievaBoat überlassen: Zwei Überfall-Systeme nebeneinander hätten
 * getrennte Abklingzeiten, und man könnte doppelt so oft rauben.
 *
 * Die Regeln sind deshalb absichtlich dieselben wie drüben – **alles oder
 * nichts bei fünfzig-fünfzig**, damit sich der Befehl auf beiden Seiten gleich
 * anfühlt.
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
  /** Münzwurf. Keine Rechnerei, kein Vorteil für Reiche – wie bei UnbelievaBoat. */
  baseChance: 0.5,
  /**
   * Bei Erfolg ist das **ganze Bargeld** des Opfers weg.
   *
   * Das ist hart, und genau darin liegt der Sinn: Die Bank ist die Antwort
   * darauf. Wer einzahlt, ist unantastbar – ein Überfall bestraft also
   * Sorglosigkeit, nicht Pech. Wer weniger als das hier dabei hat, ist es
   * nicht wert und bleibt verschont.
   */
  minVictimCash: 500,
  /** Anteil des eigenen Vermögens, der bei Misserfolg ans Opfer geht. */
  penaltyShare: 0.15,
  /** Höchststrafe – ein Fehlschlag soll wehtun, aber nicht ruinieren. */
  maxPenalty: 2000,
};

/** Wie lange noch bis zum nächsten Versuch? (0 = jetzt möglich) */
function remainingMs(guildId, accountId, now = Date.now()) {
  const claim = db.getClaim(guildId, accountId, 'rob');
  if (!claim) return 0;
  return Math.max(0, claim.claimed_at + RULES.cooldownMs - now);
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
  // Die Strafe darf von der Bank kommen – wer gar nichts hat, raubt nicht.
  if (robber.total <= 0) return { ok: false, reason: 'no_cash' };

  // Alles oder nichts: das komplette Bargeld des Opfers. Die Bank bleibt tabu.
  const loot = victim.cash;
  const chance = RULES.baseChance;
  const success = random() < chance;

  db.setClaim(guildId, robberId, 'rob', now);

  if (!success) {
    // Strafe ans Opfer – so verschwindet nichts und Fehlschläge tun weh.
    const penalty = Math.min(
      RULES.maxPenalty,
      Math.max(1, Math.min(robber.total, Math.floor(robber.total * RULES.penaltyShare))));

    /*
     * Bargeld oder Bank ist egal: Reicht das Bargeld nicht, wird der Rest von
     * der Bank geholt. Sonst käme ausgerechnet der straffrei davon, der sein
     * Geld vorsorglich eingezahlt hat.
     */
    if (robber.cash < penalty) {
      await withdrawFromBank(guildId, robberId, penalty - robber.cash, 'Überfall gescheitert')
        .catch(() => {});
    }

    const moved = await transfer(guildId, robberId, victimId, penalty, 'Überfall gescheitert');
    if (!moved) return { ok: false, reason: 'failed_transfer' };
    return { ok: true, success: false, penalty, chance };
  }

  const moved = await transfer(guildId, victimId, robberId, loot, 'Überfall');
  if (!moved) return { ok: false, reason: 'failed_transfer' };

  // Für den Titel im Profil: Ein Überfall ist eine Umverteilung, deshalb hängt
  // an der Buchung kein `kind` – gezählt wird er hier von Hand (activity.js).
  require('./activity').record(guildId, robberId, 'rob');
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

module.exports = { RULES, HOUR, remainingMs, rob, transfer };
