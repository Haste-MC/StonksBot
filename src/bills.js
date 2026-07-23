const db = require('./db');
const unb = require('./unb');

const getBalance = (...a) => unb.getBalance(...a);
const changeCash = (...a) => unb.changeCash(...a);
const withdrawFromBank = (...a) => unb.withdrawFromBank(...a);

/**
 * Rechnungen im Postfach.
 *
 * Die Infrastruktur steht vollständig: erstellen, anzeigen, bezahlen, mahnen.
 * Erzeugt werden derzeit noch keine – welche Kosten es geben soll (Kfz-Steuer,
 * Grundsteuer, Versicherung, Reparaturen) ist eine Balance-Entscheidung und
 * bewusst offen gelassen. `create()` ist der einzige nötige Einstiegspunkt.
 */

const DAY_MS = 24 * 60 * 60 * 1000;

/** Standard-Zahlungsfrist. */
const DUE_DAYS = 7;

/** Mahngebühr, wenn die Frist verstreicht (Anteil der Forderung). */
const LATE_FEE = 0.15;

/**
 * Stellt eine Rechnung aus.
 *
 * @param {object} bill
 * @param {string} bill.guildId
 * @param {string} bill.userId
 * @param {string} bill.title    z.B. "Kfz-Steuer 2026"
 * @param {string} bill.body     Erläuterung
 * @param {string} bill.sender   Absender, z.B. "Finanzamt"
 * @param {number} bill.amount   Forderung
 * @param {number} [bill.dueDays] Zahlungsfrist in Tagen
 */
function create(bill) {
  return db.createMessage({
    guildId: bill.guildId,
    userId: bill.userId,
    type: 'bill',
    title: bill.title,
    body: bill.body ?? '',
    sender: bill.sender ?? 'Rechnungsstelle',
    amount: bill.amount,
    itemId: bill.itemId ?? null,
    expiresAt: Date.now() + (bill.dueDays ?? DUE_DAYS) * DAY_MS,
  });
}

/**
 * Bezahlt eine Rechnung. Fehlendes Bargeld wird von der Bank geholt.
 */
async function pay(guildId, userId, messageId) {
  const message = db.getMessage(guildId, messageId);
  if (!message || message.user_id !== userId) return { ok: false, reason: 'not_found' };
  if (message.resolved) return { ok: false, reason: 'already_resolved' };
  if (message.type !== 'bill') return { ok: false, reason: 'not_a_bill' };

  const balance = await getBalance(guildId, userId);
  if (balance.total < message.amount) {
    return {
      ok: false, reason: 'insufficient_funds',
      needed: message.amount, have: balance.total, message,
    };
  }

  if (balance.cash < message.amount) {
    await withdrawFromBank(guildId, userId, message.amount - balance.cash, message.title);
  }
  const newBalance = await changeCash(guildId, userId, -message.amount, message.title);

  db.resolveMessage(guildId, messageId, 'paid');
  return { ok: true, message, amount: message.amount, balance: newBalance };
}

/**
 * Überfällige Rechnungen: schlägt eine Mahngebühr auf und verlängert die Frist.
 *
 * Bewusst keine automatische Abbuchung und keine Pfändung – wer nicht zahlen
 * kann, soll nicht in eine Schuldenspirale rutschen, aus der es keinen Weg
 * gibt. Die Gebühr macht Aufschieben trotzdem unattraktiv.
 *
 * @returns {Array} die gemahnten Rechnungen
 */
function dun(guildId, userId, now = Date.now()) {
  const dunned = [];

  for (const message of db.listMessages(guildId, userId, 1).items) {
    if (message.type !== 'bill') continue;
    if (!message.expires_at || message.expires_at > now) continue;

    const fee = Math.max(1, Math.round(message.amount * LATE_FEE));
    db.resolveMessage(guildId, message.id, 'expired');

    const reminder = create({
      guildId,
      userId,
      title: `Mahnung: ${message.title}`,
      body: `${message.body}\n\nZahlungsfrist verstrichen. ` +
        `Mahngebühr von ${fee} wurde aufgeschlagen.`,
      sender: message.sender,
      amount: message.amount + fee,
      itemId: message.item_id,
    });

    dunned.push({ original: message, reminder, fee });
  }

  return dunned;
}

module.exports = { DUE_DAYS, LATE_FEE, DAY_MS, create, pay, dun };
