const db = require('./db');
const level = require('./level');

/**
 * ===========================================================================
 *  LEVEL-VORTEILE – wofür man überhaupt levelt
 * ===========================================================================
 *
 * Erfahrung sammelte man bisher nebenbei, ohne dass sie etwas bewirkt hätte.
 * Hier hängen die Vorteile dran – alle an EINER Stelle, damit man beim
 * Balancing nicht durch zehn Dateien suchen muss.
 *
 * Fünf Vorteile, bewusst unterschiedlich in ihrer Art:
 *
 *   💰 Einkommen     mehr Geld bei `!daily`, bei jeder Schicht und als
 *                    Zuschlag auf UnbelievaBoats `!work`
 *   📉 Börsengebühr  sinkt (aber nie auf null – siehe unten)
 *   🅿️ Stellplätze   zusätzliche Garagenplätze
 *   🛡️ Straße        geringeres Diebstahlrisiko für Autos draußen
 *   ⏱️ Tagesbonus    nichts davon verkürzt den Cooldown (bewusst)
 *
 * ===================== GRENZEN, DIE BLEIBEN MÜSSEN =====================
 * Zwei Vorteile fassen Regeln an, die den Bot vor einem Gelddrucker schützen
 * (ARCHITEKTUR §3) – deshalb sind sie gedeckelt:
 *
 *  - **Börsengebühr:** Sie ist der Grund, warum die Börse unterm Strich eine
 *    Geldsenke ist. Sie darf sinken, aber NIE null werden, sonst wäre Handeln
 *    ein Nullsummenspiel mit unbegrenzten Versuchen.
 *  - **Werkstatt und Auktionshaus fassen wir gar nicht an.** Dort liegt der
 *    Aufschlag knapp über dem Wertzuwachs bzw. dem Erwartungswert; jeder
 *    Rabatt würde die Regel kippen.
 *
 * Das Einkommen zu erhöhen ist dagegen unbedenklich: `!daily`, Schichten und
 * `!work` sind ohnehin die geplanten Geldquellen des Spiels. Der Zuschlag ist
 * gedeckelt, damit er nicht mit dem Level davonläuft.
 * =======================================================================
 */

/** Je Level mehr Einkommen (2 %) – gedeckelt bei +60 %. */
const INCOME_PER_LEVEL = 0.02;
const INCOME_CAP = 0.60;

/** Je Level 2 % weniger Börsengebühr – höchstens die Hälfte, nie null. */
const FEE_CUT_PER_LEVEL = 0.02;
const FEE_CUT_CAP = 0.50;

/** Ab diesen Leveln gibt es je einen zusätzlichen Stellplatz. */
const SLOT_LEVELS = [10, 20, 35];

/** Je Level 2 % weniger Diebstahlrisiko – höchstens 40 %. */
const THEFT_CUT_PER_LEVEL = 0.02;
const THEFT_CUT_CAP = 0.40;

/** Das Level eines Kontos. */
function levelOf(guildId, userId) {
  return level.levelForXp(db.getStats(guildId, userId).xp);
}

/**
 * Alle Vorteile zu einem Level – reine Rechnung, ohne Datenbank.
 * @returns {{level:number, income:number, incomeBonus:number, fee:number,
 *   slots:number, theft:number}}
 */
function perks(lvl = 0) {
  const l = Math.max(0, Math.floor(lvl));
  const incomeBonus = Math.min(INCOME_CAP, l * INCOME_PER_LEVEL);
  const feeCut = Math.min(FEE_CUT_CAP, l * FEE_CUT_PER_LEVEL);
  const theftCut = Math.min(THEFT_CUT_CAP, l * THEFT_CUT_PER_LEVEL);

  return {
    level: l,
    income: 1 + incomeBonus,          // Faktor auf Einkommen
    incomeBonus,                      // nur der Aufschlag, für die Anzeige
    fee: 1 - feeCut,                  // Faktor auf die Börsengebühr (> 0)
    slots: SLOT_LEVELS.filter((need) => l >= need).length,
    theft: 1 - theftCut,              // Faktor auf die Diebstahlchance
  };
}

/** Die Vorteile eines Spielers. */
function perksOf(guildId, userId) {
  return perks(levelOf(guildId, userId));
}

/** Nächster Meilenstein: Was bringt das nächste Level? */
function nextMilestone(lvl = 0) {
  const l = Math.max(0, Math.floor(lvl));
  const slot = SLOT_LEVELS.find((need) => need > l);
  const incomeOpen = l * INCOME_PER_LEVEL < INCOME_CAP;

  if (slot && slot - l <= 3) {
    return { level: slot, text: `🅿️ ein zusätzlicher Stellplatz ab Level ${slot}` };
  }
  if (incomeOpen) {
    return {
      level: l + 1,
      text: `💰 +${((l + 1) * INCOME_PER_LEVEL * 100).toFixed(0)} % Einkommen ab Level ${l + 1}`,
    };
  }
  if (slot) return { level: slot, text: `🅿️ ein zusätzlicher Stellplatz ab Level ${slot}` };
  return null;
}

/** Kurzfassung der aktiven Vorteile – für Profil und Level-Übersicht. */
function summary(lvl = 0) {
  const p = perks(lvl);
  const lines = [
    `💰 Einkommen **+${Math.round(p.incomeBonus * 100)} %** (Tagesbonus, Schichten, \`!work\`)`,
    `📉 Börsengebühr **−${Math.round((1 - p.fee) * 100)} %**`,
  ];
  if (p.slots > 0) lines.push(`🅿️ **+${p.slots}** ${p.slots === 1 ? 'Stellplatz' : 'Stellplätze'}`);
  if (p.theft < 1) lines.push(`🛡️ Diebstahlrisiko **−${Math.round((1 - p.theft) * 100)} %**`);
  return lines;
}

// ===========================================================================
//  ZUSCHLAG AUF UNBELIEVABOATS `!work`
// ===========================================================================
//
// UnbelievaBoats Auszahlung können wir nicht verändern – es ist ein fremder
// Bot mit eigener Datenbank. Also legen wir drauf: Der Bot liest die
// Auszahlung mit und bucht den Level-Aufschlag hinterher.
//
// Das Zuordnen ist der heikle Teil, denn UnbelievaBoats Antwort ist eine
// eigene Nachricht ohne Bezug zum Befehl. Deshalb in zwei Schritten:
//
//   1. Jemand schreibt `!work` -> wir merken uns Kanal, Spieler und Zeit.
//   2. Kurz darauf schreibt UnbelievaBoat in denselben Kanal -> die größte
//      Zahl darin ist die Auszahlung, der gemerkte Spieler der Empfänger.
//
// Absichtlich vorsichtig: nur ein offener Anspruch je Kanal, ein kurzes
// Zeitfenster, ein Cooldown je Spieler und eine Obergrenze für die erkannte
// Summe. Im Zweifel passiert lieber nichts, als dass jemand fremdes Geld
// bekommt. Ohne `WORK_BONUS=true` ist das Ganze aus.

const enabled = ['true', '1', 'on'].includes(String(process.env.WORK_BONUS || '').toLowerCase());

/** Präfix von UnbelievaBoat (wie in nudges.js). */
const PREFIX = process.env.UNB_PREFIX || '!';

/** Befehle, deren Auszahlung einen Zuschlag bekommt. */
const EARN_COMMANDS = (process.env.WORK_BONUS_COMMANDS || 'work,daily,crime,slut,beg')
  .split(',').map((c) => c.trim().toLowerCase()).filter(Boolean);

/** So lange nach dem Befehl gilt die Antwort als Auszahlung. */
const WINDOW_MS = 20 * 1000;

/** Frühestens nach dieser Zeit gibt es für denselben Spieler wieder etwas. */
const COOLDOWN_MS = Number(process.env.WORK_BONUS_COOLDOWN_MIN || '20') * 60 * 1000;

/** Größer erkennen wir nicht als Auszahlung an (Schutz vor Fehldeutung). */
const MAX_PAYOUT = Number(process.env.WORK_BONUS_MAX || '2000000');

/** Offene Ansprüche je Kanal: channelId -> { userId, at }. */
const pending = new Map();

/** Letzter Zuschlag je Spieler. */
const lastBonus = new Map();

/**
 * Findet die Auszahlung in einer UnbelievaBoat-Nachricht.
 *
 * Gesucht wird die größte Zahl in Text UND Embeds – Auszahlungen stehen mal
 * im Text, mal in einer Embed-Beschreibung. Punkte und Kommas als
 * Tausendertrennung werden entfernt.
 */
function parsePayout(message) {
  const parts = [message.content || ''];
  for (const embed of message.embeds ?? []) {
    const e = typeof embed?.toJSON === 'function' ? embed.toJSON() : embed;
    parts.push(e.title ?? '', e.description ?? '');
    for (const f of e.fields ?? []) parts.push(f.name ?? '', f.value ?? '');
  }

  let best = 0;
  for (const raw of parts.join(' ').matchAll(/\d[\d.,]*/g)) {
    const value = Number(String(raw[0]).replace(/[.,]/g, ''));
    if (Number.isFinite(value) && value > best && value <= MAX_PAYOUT) best = value;
  }
  return best;
}

/**
 * Verarbeitet eine Kanalnachricht. Gibt zurück, was gutgeschrieben wurde
 * (oder null) – der Aufrufer meldet es dem Spieler.
 *
 * @param message  Discord-Nachricht
 * @param credit   async (accountId, amount, reason) – bucht das Geld
 */
async function handleMessage(message, credit, now = Date.now()) {
  if (!enabled || !message?.channelId) return null;

  const channelId = String(message.channelId);

  // Schritt 1: der Befehl eines Spielers.
  if (!message.author?.bot) {
    const content = (message.content || '').trim().toLowerCase();
    if (!content.startsWith(PREFIX)) return null;
    const cmd = content.slice(PREFIX.length).split(/\s+/)[0];
    if (!EARN_COMMANDS.includes(cmd)) return null;

    pending.set(channelId, { userId: String(message.author.id), at: now, cmd });
    return null;
  }

  // Schritt 2: die Antwort des fremden Bots.
  const claim = pending.get(channelId);
  if (!claim || now - claim.at > WINDOW_MS) {
    pending.delete(channelId);
    return null;
  }
  pending.delete(channelId);

  if (now - (lastBonus.get(claim.userId) ?? 0) < COOLDOWN_MS) return null;

  const payout = parsePayout(message);
  if (payout <= 0) return null;

  const identity = require('./identity');
  const accountId = identity.account('discord', claim.userId);
  const perk = perksOf(identity.world(), accountId);
  const amount = Math.round(payout * perk.incomeBonus);
  if (amount <= 0) return null;

  lastBonus.set(claim.userId, now);
  await credit(accountId, amount, `Level-Zuschlag (Level ${perk.level})`);

  return { userId: claim.userId, accountId, payout, amount, level: perk.level, command: claim.cmd };
}

/** Für Tests: alles vergessen. */
function reset() {
  pending.clear();
  lastBonus.clear();
}

module.exports = {
  INCOME_PER_LEVEL, INCOME_CAP, FEE_CUT_PER_LEVEL, FEE_CUT_CAP,
  SLOT_LEVELS, THEFT_CUT_PER_LEVEL, THEFT_CUT_CAP,
  enabled, PREFIX, EARN_COMMANDS, WINDOW_MS, COOLDOWN_MS, MAX_PAYOUT,
  levelOf, perks, perksOf, nextMilestone, summary,
  parsePayout, handleMessage, reset,
};
