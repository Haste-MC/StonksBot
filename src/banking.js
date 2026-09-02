const unb = require('./unb');

// Späte Bindung, damit Tests die Geldschnittstelle ersetzen können (§8).
const getBalance = (...a) => unb.getBalance(...a);
const withdrawFromBank = (...a) => unb.withdrawFromBank(...a);

/**
 * ===========================================================================
 *  BANK – Geld in Sicherheit bringen
 * ===========================================================================
 *
 * UnbelievaBoats `!rob` nimmt nur **Bargeld**. Wer sein Geld auf der Bank hat,
 * ist geschützt. Auf Discord erledigen das UnbelievaBoats eigene Befehle –
 * Fluxer-Spieler hatten diese Möglichkeit bisher nicht und konnten sich gegen
 * einen Überfall aus Discord nicht wehren. Genau diese Lücke schließt dieses
 * Modul.
 *
 * Es arbeitet über `unb.withdrawFromBank`, also automatisch mit der richtigen
 * Quelle: UnbelievaBoat bei verknüpften Konten, lokales Wallet bei den übrigen.
 * Umbuchungen verändern die Gesamtsumme nie (siehe wallet.js).
 */

/** Wandelt "alles"/"max"/"1.000" in einen Betrag um; null = ungültig. */
function parseAmount(input, available) {
  const text = String(input ?? '').trim().toLowerCase();
  if (!text) return null;
  if (['alles', 'all', 'max', 'voll'].includes(text)) return available;

  // Punkte und Leerzeichen als Tausendertrennung erlauben: "1.000" -> 1000
  const digits = text.replace(/[.\s']/g, '').replace(',', '.');
  const value = Math.floor(Number(digits));
  if (!Number.isFinite(value) || value <= 0) return null;
  return value;
}

/**
 * Zahlt Bargeld auf die Bank ein (schützt es vor Überfällen).
 * @returns {{ok:boolean, amount?:number, balance?:object, reason?:string, have?:number}}
 */
async function deposit(guildId, accountId, input) {
  const before = await getBalance(guildId, accountId);
  const amount = parseAmount(input, before.cash);

  if (amount === null) return { ok: false, reason: 'bad_amount' };
  if (before.cash <= 0) return { ok: false, reason: 'no_cash', have: before.cash };
  if (amount > before.cash) return { ok: false, reason: 'not_enough_cash', have: before.cash };

  // Negativer Betrag = Bargeld zur Bank.
  const balance = await withdrawFromBank(guildId, accountId, -amount, 'Einzahlung');
  return { ok: true, amount, balance };
}

/** Hebt Geld von der Bank ab (macht es wieder ausgabefähig – und raubbar). */
async function withdraw(guildId, accountId, input) {
  const before = await getBalance(guildId, accountId);
  const amount = parseAmount(input, before.bank);

  if (amount === null) return { ok: false, reason: 'bad_amount' };
  if (before.bank <= 0) return { ok: false, reason: 'no_bank', have: before.bank };
  if (amount > before.bank) return { ok: false, reason: 'not_enough_bank', have: before.bank };

  const balance = await withdrawFromBank(guildId, accountId, amount, 'Auszahlung');
  return { ok: true, amount, balance };
}

module.exports = { parseAmount, deposit, withdraw };
