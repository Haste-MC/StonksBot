const db = require('./db');

/**
 * ===========================================================================
 *  ERFOLGE – privat und serverweit
 * ===========================================================================
 *
 * Zwei Sorten:
 *
 *   privat     Meilensteine, die jeder für sich erreicht. Vier Stufen, damit
 *              der Fortschritt sichtbar bleibt statt sofort fertig zu sein.
 *   server     Taten, die nur EINER haben kann. Wer zuerst da ist, bekommt
 *              sie – alle anderen gehen leer aus.
 *
 * ==================== KEIN GELDDRUCKER (§3) ====================
 * Erfolge geben ausschließlich Ruhm: ein Abzeichen im Profil und einen
 * wählbaren Titel. Kein Geld, keine Erfahrung, keine Rabatte. Deshalb bindet
 * dieses Modul weder `unb` noch `wallet` noch `level` ein – wer hier eine
 * Auszahlung einbauen will, muss erst diese Zeile löschen.
 * ==============================================================
 *
 * Ein neuer Erfolg ist ein Eintrag in RULES – sonst nichts. Braucht er ein
 * Ereignis, das keine Geldbuchung ist, kommt ein `fire()` an die passende
 * Stelle.
 *
 * WICHTIG: Die `id` ist der Schlüssel und bleibt für immer. Titel, Emoji,
 * Text und Schwelle darf man ändern – wer den Erfolg hat, behält ihn. Eine
 * neue `id` dagegen ist ein NEUER Erfolg, den alle erneut holen müssen.
 */

/**
 * Die Stufen. `loud` entscheidet, ob es in den Kanal geht.
 *
 * Warum nicht alles laut: Von 37 privaten Erfolgen sind 20 laut. Wäre jeder
 * es, hätte der Hauptkanal bei zehn Spielern schnell 370 Meldungen – und
 * damit wäre keine davon mehr ein Ereignis.
 */
const TIERS = {
  bronze: { label: 'Bronze', emoji: '🥉', loud: false, rank: 1 },
  silber: { label: 'Silber', emoji: '🥈', loud: false, rank: 2 },
  gold:   { label: 'Gold',   emoji: '🥇', loud: true,  rank: 3 },
  platin: { label: 'Platin', emoji: '💠', loud: true,  rank: 4 },
};

/**
 * Rang einer Seltenheit in der Leiter aus data/storage.js.
 *
 * Gebraucht für „diese Stufe ODER BESSER": Ein Cosmic-Fund erfüllt auch den
 * Godlike-Erfolg. Ohne Rangvergleich müsste jede Regel alle höheren Stufen
 * einzeln aufzählen.
 *
 * @returns {number} Rang, oder -1 wenn die Leiter das nicht kennt
 */
function rarityRank(id) {
  const { RARITIES } = require('./data/storage');
  return RARITIES.findIndex((r) => r.id === String(id ?? ''));
}

/** Ab dieser Stufe zählt ein Fund für den jeweiligen Erfolg. */
const abStufe = (stufe) => (c) => rarityRank(c.rarity) >= rarityRank(stufe);

/**
 * Alle Erfolge.
 *
 * Die Schwellen sind am echten Spielstand geeicht (siehe die Spec unter
 * docs/superpowers/specs/): Bronze und Silber am heutigen Höchststand, Gold
 * und Platin am Endgame-Ertrag von rund 875.000 Beute pro Tag. Wer sie
 * ändert, sollte dort nachrechnen statt zu raten.
 */
const RULES = [
  // ------------------------------------------------------------------ Arbeit
  { id: 'job_1', scope: 'privat', tier: 'bronze', emoji: '💼', title: 'Erster Arbeitstag',
    text: 'Die erste Schicht geschoben.', on: 'kind:job',
    test: (c) => c.shifts >= 1, progress: (c) => [c.shifts, 1] },
  { id: 'job_50', scope: 'privat', tier: 'silber', emoji: '🔧', title: 'Malocher',
    text: '50 Schichten.', on: 'kind:job',
    test: (c) => c.shifts >= 50, progress: (c) => [c.shifts, 50] },
  { id: 'job_250', scope: 'privat', tier: 'gold', emoji: '⚙️', title: 'Arbeitstier',
    text: '250 Schichten.', on: 'kind:job',
    test: (c) => c.shifts >= 250, progress: (c) => [c.shifts, 250] },
  { id: 'job_1000', scope: 'privat', tier: 'platin', emoji: '🏭', title: 'Lebenswerk',
    text: '1.000 Schichten. Irgendwann ist es keine Arbeit mehr, sondern Charakter.',
    on: 'kind:job', test: (c) => c.shifts >= 1000, progress: (c) => [c.shifts, 1000] },

  // --------------------------------------------------------------- Vermögen
  { id: 'worth_100k', scope: 'privat', tier: 'bronze', emoji: '💵', title: 'Erstes Polster',
    text: 'Ein Vermögen von 100.000.', on: 'state',
    test: (c) => c.worth >= 100_000, progress: (c) => [c.worth, 100_000] },
  { id: 'worth_500k', scope: 'privat', tier: 'silber', emoji: '💸', title: 'Halbe Million',
    text: 'Ein Vermögen von 500.000.', on: 'state',
    test: (c) => c.worth >= 500_000, progress: (c) => [c.worth, 500_000] },
  { id: 'worth_1m', scope: 'privat', tier: 'gold', emoji: '💰', title: 'Millionär',
    text: 'Ein Vermögen von einer Million.', on: 'state',
    test: (c) => c.worth >= 1_000_000, progress: (c) => [c.worth, 1_000_000] },
  { id: 'worth_50m', scope: 'privat', tier: 'platin', emoji: '🤑', title: 'Schwerreich',
    text: 'Ein Vermögen von 50 Millionen.', on: 'state',
    test: (c) => c.worth >= 50_000_000, progress: (c) => [c.worth, 50_000_000] },

  // -------------------------------------------------------------- Fuhrpark
  { id: 'car_1', scope: 'privat', tier: 'bronze', emoji: '🚗', title: 'Erstes eigenes Auto',
    text: 'Das erste Auto in der Garage.', on: 'state',
    test: (c) => c.cars >= 1, progress: (c) => [c.cars, 1] },
  { id: 'car_5', scope: 'privat', tier: 'silber', emoji: '🅿️', title: 'Sammler',
    text: 'Fünf Autos gleichzeitig.', on: 'state',
    test: (c) => c.cars >= 5, progress: (c) => [c.cars, 5] },
  { id: 'car_500k', scope: 'privat', tier: 'gold', emoji: '🏎️', title: 'Traumwagen',
    text: 'Ein Auto für mindestens 500.000.', on: 'state',
    test: (c) => c.bestCar >= 500_000, progress: (c) => [c.bestCar, 500_000] },
  { id: 'car_3m', scope: 'privat', tier: 'platin', emoji: '👑', title: 'Hypercar',
    text: 'Ein Auto für mindestens 3 Millionen.', on: 'state',
    test: (c) => c.bestCar >= 3_000_000, progress: (c) => [c.bestCar, 3_000_000] },

  // ------------------------------------------------------------ Immobilien
  { id: 'prop_1', scope: 'privat', tier: 'bronze', emoji: '🏠', title: 'Eigenheim',
    text: 'Die erste eigene Immobilie.', on: 'state',
    test: (c) => c.properties >= 1, progress: (c) => [c.properties, 1] },
  { id: 'rent_1', scope: 'privat', tier: 'silber', emoji: '🔑', title: 'Vermieter',
    text: 'Die erste Mieteinnahme.', on: 'kind:landlord',
    test: (c) => (c.counts.landlord ?? 0) >= 1, progress: (c) => [c.counts.landlord ?? 0, 1] },
  { id: 'realty_1m', scope: 'privat', tier: 'gold', emoji: '🏘️', title: 'Immobilienmogul',
    text: 'Immobilien im Wert von einer Million.', on: 'state',
    test: (c) => c.realty >= 1_000_000, progress: (c) => [c.realty, 1_000_000] },
  { id: 'castle', scope: 'privat', tier: 'platin', emoji: '🏰', title: 'Schlossherr',
    text: 'Das Schloss. Es gibt genau eines.', on: 'state',
    test: (c) => c.hasCastle },

  // --------------------------------------------------------- Krumme Dinger
  { id: 'heist_1', scope: 'privat', tier: 'bronze', emoji: '🕵️', title: 'Erstes Ding',
    text: 'Am ersten Heist teilgenommen.', on: 'state',
    test: (c) => c.heists >= 1, progress: (c) => [c.heists, 1] },
  { id: 'rob_10', scope: 'privat', tier: 'silber', emoji: '🎭', title: 'Straßenräuber',
    text: 'Zehn Überfälle.', on: 'kind:rob',
    test: (c) => (c.counts.rob ?? 0) >= 10, progress: (c) => [c.counts.rob ?? 0, 10] },
  { id: 'heist_clean', scope: 'privat', tier: 'gold', emoji: '💎',
    title: 'Sauber durchgezogen', text: 'Ein Heist ohne einen einzigen Fehler.',
    on: 'fire:heist_perfect', test: () => true },
  { id: 'loot_50m', scope: 'privat', tier: 'platin', emoji: '🧨', title: 'Beutezug',
    text: '50 Millionen Diebesgut über alle Dinger hinweg.', on: 'state',
    test: (c) => c.lootTotal >= 50_000_000, progress: (c) => [c.lootTotal, 50_000_000] },

  // ---------------------------------------------------------------- Zocken
  { id: 'casino_1', scope: 'privat', tier: 'bronze', emoji: '🎰', title: 'Anfängerglück',
    text: 'Die erste Runde im Casino.', on: 'kind:casino',
    test: (c) => (c.counts.casino ?? 0) >= 1, progress: (c) => [c.counts.casino ?? 0, 1] },
  { id: 'casino_100k', scope: 'privat', tier: 'gold', emoji: '🃏', title: 'Hochroller',
    text: '100.000 Gewinn in einer einzigen Runde.', on: 'fire:casino_win',
    test: (c) => c.amount >= 100_000 },
  { id: 'casino_1m', scope: 'privat', tier: 'platin', emoji: '💥', title: 'Bank gesprengt',
    text: 'Eine Million Gewinn in einer einzigen Runde. Mehr lässt das Haus nicht zu.',
    on: 'fire:casino_win', test: (c) => c.amount >= 1_000_000 },

  // ----------------------------------------------------------------- Börse
  { id: 'market_1', scope: 'privat', tier: 'bronze', emoji: '📈', title: 'Kleinanleger',
    text: 'Der erste Handel an der Börse.', on: 'kind:market',
    test: (c) => (c.counts.market ?? 0) >= 1, progress: (c) => [c.counts.market ?? 0, 1] },
  { id: 'depot_250k', scope: 'privat', tier: 'gold', emoji: '🦈', title: 'Börsenhai',
    text: 'Ein Depot im Wert von 250.000.', on: 'state',
    test: (c) => c.depot >= 250_000, progress: (c) => [c.depot, 250_000] },
  { id: 'depot_25m', scope: 'privat', tier: 'platin', emoji: '🏦', title: 'Großkapital',
    text: 'Ein Depot im Wert von 25 Millionen – bei laufendem Kursrisiko.',
    on: 'state', test: (c) => c.depot >= 25_000_000, progress: (c) => [c.depot, 25_000_000] },

  // ------------------------------------------------------------- Auktionen
  { id: 'lot_1', scope: 'privat', tier: 'bronze', emoji: '🏬', title: 'Erster Zuschlag',
    text: 'Die erste Garage ersteigert.', on: 'kind:auction',
    test: (c) => (c.counts.auction ?? 0) >= 1, progress: (c) => [c.counts.auction ?? 0, 1] },
  { id: 'coll_100k', scope: 'privat', tier: 'gold', emoji: '🏺', title: 'Schatzmeister',
    text: 'Eine Sammlung im Schätzwert von 100.000.', on: 'state',
    test: (c) => c.collection >= 100_000, progress: (c) => [c.collection, 100_000] },
  { id: 'godlike', scope: 'privat', tier: 'platin', emoji: '🟠', title: 'Godlike',
    text: 'Ein Fundstück der Stufe Godlike oder besser. Etwa eine von 400 Garagen.',
    on: 'fire:loot', test: abStufe('godlike') },

  // ---------------------------------------------------------------- Angeln
  { id: 'fish_1', scope: 'privat', tier: 'bronze', emoji: '🎣', title: 'Erster Fang',
    text: 'Einmal am Wasser gesessen.', on: 'kind:fishing',
    test: (c) => (c.counts.fishing ?? 0) >= 1, progress: (c) => [c.counts.fishing ?? 0, 1] },
  { id: 'fish_100', scope: 'privat', tier: 'silber', emoji: '🐟', title: 'Angler',
    text: '100 Fänge.', on: 'kind:fishing',
    test: (c) => (c.counts.fishing ?? 0) >= 100, progress: (c) => [c.counts.fishing ?? 0, 100] },
  { id: 'fish_500', scope: 'privat', tier: 'gold', emoji: '🐠', title: 'Fischerkönig',
    text: '500 Fänge.', on: 'kind:fishing',
    test: (c) => (c.counts.fishing ?? 0) >= 500, progress: (c) => [c.counts.fishing ?? 0, 500] },
  { id: 'fish_1000', scope: 'privat', tier: 'platin', emoji: '🐋', title: 'Moby Dick',
    text: '1.000 Fänge.', on: 'kind:fishing',
    test: (c) => (c.counts.fishing ?? 0) >= 1000, progress: (c) => [c.counts.fishing ?? 0, 1000] },

  // ----------------------------------------------------------------- Leben
  { id: 'move_1', scope: 'privat', tier: 'bronze', emoji: '✈️', title: 'Weltenbummler',
    text: 'Ins Ausland gezogen.', on: 'fire:move', test: () => true },
  { id: 'level_25', scope: 'privat', tier: 'silber', emoji: '🏆', title: 'Aufsteiger',
    text: 'Level 25.', on: 'state',
    test: (c) => c.level >= 25, progress: (c) => [c.level, 25] },
  { id: 'level_50', scope: 'privat', tier: 'gold', emoji: '🌟', title: 'Legende',
    text: 'Level 50.', on: 'state',
    test: (c) => c.level >= 50, progress: (c) => [c.level, 50] },
  { id: 'level_100', scope: 'privat', tier: 'platin', emoji: '♾️', title: 'Unsterblich',
    text: 'Level 100. Eine Million Erfahrung – das dauert Jahre, und das ist Absicht.',
    on: 'state', test: (c) => c.level >= 100, progress: (c) => [c.level, 100] },

  // ============================================================== SERVERWEIT
  // Genau einer je Welt. `measure` entscheidet beim einmaligen Nachtrag, wer
  // ihn bekommt, wenn ihn schon mehrere erfüllen; `backfill: false` heißt,
  // dass es dafür keine Daten in der Vergangenheit gibt.
  { id: 'srv_millionaire', scope: 'server', emoji: '👑', title: 'Der erste Millionär',
    text: 'Als Erster ein Vermögen von einer Million.', on: 'state',
    test: (c) => c.worth >= 1_000_000, measure: (c) => c.worth },
  { id: 'srv_supercar', scope: 'server', emoji: '🏎️', title: 'Der erste Supersportwagen',
    text: 'Als Erster ein Auto für mindestens 500.000.', on: 'state',
    test: (c) => c.bestCar >= 500_000, measure: (c) => c.bestCar },
  { id: 'srv_castle', scope: 'server', emoji: '🏰', title: 'Der Schlossherr',
    text: 'Das Schloss gehört genau einem.', on: 'state',
    test: (c) => c.hasCastle, measure: (c) => c.realty },
  { id: 'srv_depot', scope: 'server', emoji: '📈', title: 'Der erste Großanleger',
    text: 'Als Erster ein Depot im Wert von 500.000.', on: 'state',
    test: (c) => c.depot >= 500_000, measure: (c) => c.depot },
  { id: 'srv_heist', scope: 'server', emoji: '💎', title: 'Der erste perfekte Coup',
    text: 'Als Erster ein Ding ohne einen einzigen Fehler.',
    on: 'fire:heist_perfect', test: () => true, backfill: false },
  { id: 'srv_pate', scope: 'server', emoji: '🚚', title: 'Der Pate',
    text: 'Als Erster 100 Millionen Diebesgut.', on: 'state',
    test: (c) => c.lootTotal >= 100_000_000, measure: (c) => c.lootTotal },
  { id: 'srv_worker', scope: 'server', emoji: '⚙️', title: 'Der erste Malocher',
    text: 'Als Erster 250 Schichten.', on: 'kind:job',
    test: (c) => c.shifts >= 250, measure: (c) => c.shifts },
  { id: 'srv_bigbid', scope: 'server', emoji: '🏬', title: 'Der erste Großeinkauf',
    text: 'Als Erster einen Zuschlag über 100.000.', on: 'fire:lot_won',
    test: (c) => c.price >= 100_000, backfill: false },
  { id: 'srv_godlike', scope: 'server', emoji: '🟠', title: 'Der erste Godlike-Fund',
    text: 'Als Erster ein Stück der Stufe Godlike. Etwa eine von 400 Garagen.',
    on: 'fire:loot', test: abStufe('godlike'), measure: (c) => c.bestRarity },
  { id: 'srv_cosmic', scope: 'server', emoji: '🌌', title: 'Der erste Cosmic-Fund',
    text: 'Als Erster ein Stück der Stufe Cosmic. Etwa eine von 4.000 Garagen.',
    on: 'fire:loot', test: abStufe('cosmic'), measure: (c) => c.bestRarity },
  { id: 'srv_billion', scope: 'server', emoji: '💰', title: 'Der erste Milliardär',
    text: 'Als Erster ein Vermögen von einer Milliarde.', on: 'state',
    test: (c) => c.worth >= 1_000_000_000, measure: (c) => c.worth },
  { id: 'srv_primordial', scope: 'server', emoji: '🩸', title: 'Primordial',
    text: 'Ein Stück der Stufe Primordial. Etwa eine von 40.000 Garagen.',
    on: 'fire:loot', test: abStufe('primordial'), measure: (c) => c.bestRarity },
  { id: 'srv_celestial', scope: 'server', emoji: '🌟', title: 'Celestial',
    text: 'Ein Stück der Stufe Celestial. Etwa eine von 700.000 Garagen.',
    on: 'fire:loot', test: abStufe('celestial'), measure: (c) => c.bestRarity },
  { id: 'srv_omnipotent', scope: 'server', emoji: '👁️', title: 'Omnipotent',
    text: 'Ein Stück der Stufe Omnipotent. Eine von zehn Milliarden Garagen.',
    on: 'fire:loot', test: abStufe('omnipotent'), measure: (c) => c.bestRarity },
  { id: 'srv_origin', scope: 'server', emoji: '🎆', title: 'Origin',
    text: 'Ein Stück der Stufe Origin. Diese Zeile bleibt leer, und das ist der Witz.',
    on: 'fire:loot', test: abStufe('origin'), measure: (c) => c.bestRarity },
];

const RULE_BY_ID = new Map(RULES.map((r) => [r.id, r]));

/** Die Regel zu einer Kennung, oder null. */
function byId(id) {
  return RULE_BY_ID.get(String(id ?? '')) ?? null;
}

module.exports = { TIERS, RULES, byId, rarityRank };
