const db = require('./db');

/**
 * ===========================================================================
 *  TITEL – was du am häufigsten tust, steht über deinem Profil
 * ===========================================================================
 *
 * Jede Aktivität, die Geld bewegt, wird mitgezählt (`player_activity`). Aus
 * dieser Strichliste entsteht ein Titel: Wer ständig Dinger dreht, ist ein
 * **Ganove**; wer am Wasser sitzt, ein **Angler**.
 *
 * Warum die HÄUFIGKEIT und nicht der Verdienst?
 * Weil Verdienste über die Spielarten hinweg nicht vergleichbar sind: Ein
 * Aktienverkauf bucht den kompletten Erlös (der zum größten Teil das eigene
 * Geld von vorhin ist), eine Schicht nur den Lohn, ein Casino-Abend eine
 * Netto-Differenz. Ein Ranking daraus wäre keine Erfolgsliste, sondern eine
 * Liste der Aktivitäten mit den größten Zahlen. Die Zahl der Male dagegen
 * bedeutet überall dasselbe: **das hier machst du ständig.**
 *
 * Gezählt wird zentral in `unb.changeCash` – jede Buchung, die ein `kind`
 * mitbringt (ARCHITEKTUR §9: eine Buchung je Aktion, also ein Strich je
 * Aktion). Buchungen ohne `kind` (Käufe, Rechnungen, Storno) zählen nicht.
 *
 * Drei Stufen je Aktivität, damit der Titel mitwächst statt sofort fertig zu
 * sein. Der Spieler kann jederzeit selbst wählen – aber nur aus dem, was er
 * auch wirklich gemacht hat (`unlocked`).
 */

/** Ab wie vielen Malen die zweite und dritte Stufe greifen. */
const TIERS = [0, 25, 100];

/**
 * Die Aktivitäten. `titles` sind die drei Stufen (siehe TIERS).
 * Eine neue Aktivität = ein Eintrag hier plus ein `kind` an ihrer Buchung.
 */
const KINDS = [
  { id: 'job', emoji: '💼', label: 'Schichten', titles: ['Aushilfe', 'Malocher', 'Arbeitstier'] },
  { id: 'fishing', emoji: '🎣', label: 'Angeln', titles: ['Sonntagsangler', 'Angler', 'Fischerkönig'] },
  { id: 'creator', emoji: '📡', label: 'Creator', titles: ['Hobby-Creator', 'Content-Creator', 'Internet-Größe'] },
  { id: 'music', emoji: '🎵', label: 'Musik', titles: ['Straßenmusiker', 'Musiker', 'Bühnenlegende'] },
  { id: 'heist', emoji: '🕵️', label: 'Heists', titles: ['Kleinkrimineller', 'Ganove', 'Meisterdieb'] },
  { id: 'rob', emoji: '🎭', label: 'Überfälle', titles: ['Taschendieb', 'Straßenräuber', 'Schrecken der Straße'] },
  { id: 'casino', emoji: '🎰', label: 'Casino', titles: ['Gelegenheitsspieler', 'Zocker', 'Hochroller'] },
  { id: 'market', emoji: '📈', label: 'Börse', titles: ['Kleinanleger', 'Börsianer', 'Börsenhai'] },
  { id: 'landlord', emoji: '🏠', label: 'Vermieten', titles: ['Zimmerwirt', 'Vermieter', 'Immobilienmogul'] },
  { id: 'auction', emoji: '🏬', label: 'Auktionen', titles: ['Schnäppchenjäger', 'Trödelprofi', 'Schatzmeister'] },
  { id: 'cars', emoji: '🚗', label: 'Autohandel', titles: ['Schrauber', 'Gebrauchtwagenhändler', 'Autobaron'] },
  { id: 'daily', emoji: '☀️', label: 'Tagesbonus', titles: ['Frühaufsteher', 'Stammgast', 'Uhrwerk'] },
];

const byId = new Map(KINDS.map((k) => [k.id, k]));

/** Kennt das Spiel diese Aktivität? */
function kind(id) {
  return byId.get(String(id ?? '')) ?? null;
}

/** Zählt eine Aktivität mit. Unbekannte Kennungen werden still ignoriert. */
function record(guildId, userId, id, at = Date.now()) {
  if (!byId.has(String(id ?? ''))) return false;
  db.bumpActivity(guildId, userId, String(id), at);
  return true;
}

/** Welche Stufe passt zu dieser Anzahl? (0–2) */
function tierOf(count = 0) {
  let tier = 0;
  for (let i = 0; i < TIERS.length; i++) if (count > TIERS[i]) tier = i;
  return tier;
}

/** Der Titel einer Aktivität bei dieser Anzahl. */
function titleFor(id, count = 1) {
  const k = kind(id);
  if (!k || count <= 0) return null;
  const tier = tierOf(count);
  return { id: k.id, emoji: k.emoji, label: k.label, count, tier, title: k.titles[tier] };
}

/**
 * Alle Titel, die dieser Spieler tragen darf – häufigste Aktivität zuerst.
 * Wer etwas nie gemacht hat, kann den Titel auch nicht wählen.
 */
function unlocked(guildId, userId) {
  return db.activityOf(guildId, userId)
    .map((row) => titleFor(row.kind, row.count))
    .filter(Boolean);
}

/**
 * Der Titel, der im Profil steht.
 *
 * Reihenfolge: eigene Wahl schlägt Automatik, 'none' heißt „keiner", und ohne
 * Wahl gewinnt die häufigste Aktivität. Wer noch gar nichts gemacht hat,
 * bekommt keinen Titel – das ist kein Fehler, sondern der Anfang.
 *
 * @returns {{id,emoji,title,count,tier,chosen:boolean}|null}
 */
function titleOf(guildId, userId) {
  const wish = String(db.getStats(guildId, userId).title ?? '');
  if (wish === 'none') return null;

  const list = unlocked(guildId, userId);
  if (wish) {
    const own = list.find((t) => t.id === wish);
    if (own) return { ...own, chosen: true };
    // Titel gewählt, Aktivität aber (noch) nicht gemacht: nicht schummeln.
  }
  return list.length ? { ...list[0], chosen: false } : null;
}

/** Setzt den Wunsch: eine Kennung, '' für automatisch, 'none' für keinen. */
function choose(guildId, userId, wish) {
  const value = String(wish ?? '');
  if (value && value !== 'none' && !byId.has(value)) return false;
  db.setTitle(guildId, userId, value);
  return true;
}

module.exports = { TIERS, KINDS, kind, record, tierOf, titleFor, unlocked, titleOf, choose };
