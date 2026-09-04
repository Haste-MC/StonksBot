const db = require('./db');

/**
 * ===========================================================================
 *  STAATSKASSE – der serverweite Topf
 * ===========================================================================
 *
 * Jede Geldbewegung im Spiel wirft etwas für die Allgemeinheit ab:
 *
 *     Ausgabe   (Spieler zahlt)   ->  19 %  Mehrwertsteuer
 *     Einnahme  (Spieler kassiert) -> 40 %  Einkommensteuer
 *
 * ================== DIE WICHTIGSTE REGEL ==================
 * Der Spieler zahlt dadurch KEINEN Cent mehr und gibt von seiner Einnahme
 * NICHTS ab. Der Prozentsatz wird aus dem Betrag nur *berechnet* und dann
 * zusätzlich in die Kasse gelegt. Ein Auto für 10 000 kostet weiter 10 000 –
 * die Kasse notiert dazu 1 900.
 * ==========================================================
 *
 * Warum das kein Gelddrucker im Sinne von ARCHITEKTUR §3 ist: Aus der Kasse
 * fließt **nichts an Spieler zurück**. Sie ist eine reine Senke – ein Zähler
 * für das, was die Server-Wirtschaft insgesamt umsetzt. Erst eine Auszahlung
 * an Spieler würde §3 berühren; die gibt es hier bewusst nicht.
 *
 * Angebunden ist das an genau EINER Stelle: `unb.changeCash` (siehe
 * src/unb.js) – dem zentralen Geld-Choke-Point. Storno- und
 * Rückerstattungsbuchungen laufen dort mit `{ xp: false }` und werden
 * übersprungen, sonst würde ein abgebrochener Kauf die Kasse füttern.
 */

/** Steuersätze. Über die .env änderbar, aber selten nötig. */
const VAT_RATE = clampRate(process.env.TREASURY_VAT_RATE, 0.19);
const TAX_RATE = clampRate(process.env.TREASURY_TAX_RATE, 0.40);

function clampRate(raw, fallback) {
  const value = Number(raw);
  if (!Number.isFinite(value) || value < 0 || value > 1) return fallback;
  return value;
}

/**
 * Bereiche für die Anzeige. Die Buchungsgründe sind Freitext ("Kauf: BMW",
 * "Börse: Verkauf 3× HAST @ 120"), deshalb hier eine kleine Zuordnung statt
 * roher Textstücke – sonst stünden in der Übersicht hunderte Einzelzeilen.
 *
 * Reihenfolge zählt: die erste passende Regel gewinnt.
 */
const CATEGORIES = [
  { id: 'immobilien', emoji: '🏘️', label: 'Miete & Immobilien', test: /^(erste )?miete|^mieteinnahme|^immobilie/i },
  { id: 'fahrzeuge', emoji: '🚗', label: 'Fahrzeughandel', test: /^(privat)?kauf|^(zwangs)?verkauf|^neuwagen/i },
  { id: 'arbeit', emoji: '💼', label: 'Arbeit', test: /^schicht|^rollen-einkommen|^prämie/i },
  { id: 'bonus', emoji: '🎁', label: 'Boni', test: /^täglicher bonus|^daily/i },
  { id: 'boerse', emoji: '📈', label: 'Börse', test: /^börse/i },
  { id: 'werkstatt', emoji: '🛠️', label: 'Werkstatt', test: /^werkstatt|^selbst repariert/i },
  { id: 'angeln', emoji: '🎣', label: 'Angeln', test: /^fang/i },
  { id: 'musik', emoji: '🎵', label: 'Musik', test: /^(tantiemen|konzert|vorschuss)/i },
  { id: 'creator', emoji: '📡', label: 'Creator', test: /^(twitch|youtube|instagram|twitter|stream|sponsor|merch|vertragsstrafe)/i },
  { id: 'auktion', emoji: '🏬', label: 'Auktionshaus', test: /^auktion|^fund|^hehler/i },
  { id: 'casino', emoji: '🎰', label: 'Casino', test: /^(blackjack|coinflip|slots|roulette)/i },
  { id: 'rechnung', emoji: '🧾', label: 'Rechnungen', test: /rechnung|gebühr|strafe|bußgeld/i },
];

const FALLBACK = { id: 'sonstiges', emoji: '📦', label: 'Sonstiges' };
const byId = new Map([...CATEGORIES, FALLBACK].map((c) => [c.id, c]));

/** Der Bereich zu einem Buchungsgrund. */
function categoryOf(reason) {
  const text = String(reason ?? '').trim();
  return CATEGORIES.find((c) => c.test.test(text)) ?? FALLBACK;
}

/** Anzeigedaten eines Bereichs (auch für unbekannte IDs sicher). */
function category(id) {
  return byId.get(id) ?? FALLBACK;
}

/** 'vat' bei Ausgaben, 'tax' bei Einnahmen. */
function kindOf(amount) {
  return amount < 0 ? 'vat' : 'tax';
}

/** Der Satz, der auf diesen Betrag angewendet wird. */
function rateFor(amount) {
  return amount < 0 ? VAT_RATE : TAX_RATE;
}

/**
 * Der Anteil, der aus einem Betrag in die Kasse fließt – ohne dass der Betrag
 * selbst sich ändert.
 */
function shareOf(amount) {
  const value = Math.round(Number(amount) || 0);
  if (!value) return 0;
  return Math.round(Math.abs(value) * rateFor(value));
}

/**
 * Verbucht den Anteil einer Geldbewegung in der Staatskasse.
 *
 * Rein synchron: der Aufrufer (`unb.changeCash`) hat sein Geld zu diesem
 * Zeitpunkt schon gebucht, hier kann kein zweiter Klick dazwischen.
 *
 * @returns {{kind,base,amount,rate,source,balance}|null} null, wenn nichts anfiel
 */
function collect(guildId, accountId, amount, reason = '', now = Date.now()) {
  const value = Math.round(Number(amount) || 0);
  if (!guildId || !accountId || !value) return null;

  const share = shareOf(value);
  if (share <= 0) return null;

  const kind = kindOf(value);
  const source = categoryOf(reason).id;

  // In welches Land der Anteil fließt: dorthin, wo der Spieler lebt.
  // Wer keine Heimat gewählt hat, zahlt in den Topf der Staatenlosen.
  let country = '';
  try { country = require('./home').homeOf(guildId, accountId).id; } catch { /* egal */ }

  const row = db.bookTreasury({
    guildId,
    accountId,
    kind,
    base: Math.abs(value),
    amount: share,
    source,
    reason: String(reason ?? '').slice(0, 80),
    country,
    at: now,
  });

  return {
    kind, base: Math.abs(value), amount: share, rate: rateFor(value),
    source, balance: row?.balance ?? share,
  };
}

/**
 * Der Stand der Kasse mit ein paar abgeleiteten Zahlen für die Anzeige.
 */
function state(guildId) {
  const row = db.getTreasury(guildId);
  const turnover = row.spend_base + row.income_base;
  return {
    ...row,
    turnover,
    // Wie viel Kasse je umgesetztem Taler entsteht – die Mischung aus beiden
    // Sätzen, abhängig davon, ob mehr ausgegeben oder verdient wurde.
    effectiveRate: turnover > 0 ? row.balance / turnover : 0,
    share: {
      vat: row.balance > 0 ? row.vat_total / row.balance : 0,
      tax: row.balance > 0 ? row.tax_total / row.balance : 0,
    },
  };
}

/**
 * Die Staatskassen der Länder, absteigend – mit Flagge, Einwohnerzahl und
 * Anteil am Gesamttopf.
 *
 * Die Summe der Länder ist kleiner als der Welttopf: Buchungen aus der Zeit
 * vor der Aufteilung sind keinem Land zugeordnet.
 */
function countries(guildId) {
  const home = require('./home');
  const people = new Map(db.countryPopulation(guildId).map((r) => [r.country, r.n]));
  const rows = db.treasuryCountries(guildId);
  const assigned = rows.reduce((s, r) => s + r.balance, 0);

  return rows.map((row) => {
    const land = home.country(row.country);
    return {
      ...row,
      name: row.country ? land.name : 'Ohne Heimat',
      flag: row.country ? land.flag : '🏳️',
      market: land.market,
      people: people.get(row.country) ?? 0,
      share: assigned > 0 ? row.balance / assigned : 0,
    };
  });
}

/** Was das Land dieses Spielers bisher eingenommen hat. */
function countryOf(guildId, accountId) {
  const home = require('./home');
  const land = home.homeOf(guildId, accountId);
  const row = db.treasuryCountry(guildId, land.id);
  const all = countries(guildId);
  const rank = all.findIndex((c) => c.country === land.id);
  return {
    ...row,
    land,
    rank: rank >= 0 ? rank + 1 : null,
    of: all.length,
  };
}

/** Die ergiebigsten Bereiche, schon mit Anzeigedaten. */
function sources(guildId, limit = 5) {
  return db.topTreasurySources(guildId, limit).map((row) => ({
    ...row, ...category(row.source),
  }));
}

/** Wer am meisten beigetragen hat. */
function payers(guildId, limit = 5) {
  return db.topTreasuryPayers(guildId, limit);
}

/** Der Beitrag eines einzelnen Kontos. */
function contribution(guildId, accountId) {
  return db.treasuryPayer(guildId, accountId);
}

/** Die letzten Zuflüsse, schon mit Anzeigedaten. */
function recent(guildId, limit = 5) {
  return db.treasuryLog(guildId, limit).map((row) => ({
    ...row, ...category(row.source),
  }));
}

/** Setzt die Kasse einer Welt zurück. */
function reset(guildId) {
  db.clearTreasury(guildId);
}

module.exports = {
  VAT_RATE, TAX_RATE, CATEGORIES, FALLBACK,
  categoryOf, category, kindOf, rateFor, shareOf,
  collect, state, sources, payers, contribution, recent, reset, countries, countryOf,
};
