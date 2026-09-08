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

/**
 * ===========================================================================
 *  DER ZUSAMMENHANG (ctx)
 * ===========================================================================
 *
 * Jede Regel bekommt ein `ctx` mit dem, was sie zum Prüfen braucht. Die
 * teuren Werte sind **Getter**: Sie rechnen erst, wenn eine Regel danach
 * fragt, und danach nie wieder.
 *
 * Das ist keine Spielerei, sondern der Grund, warum die Prüfung an jeder
 * Geldbuchung hängen darf: Auf dem Buchungspfad laufen nur Regeln mit
 * `kind:`-Andockpunkt, und die fragen ausschließlich nach der Strichliste –
 * eine einzige Abfrage. Vermögen, Depot und Immobilien werden dort nie
 * berechnet.
 */
function baseCtx(guildId, userId, extra = {}) {
  const cache = new Map();
  const once = (key, fn) => {
    if (!cache.has(key)) cache.set(key, fn());
    return cache.get(key);
  };

  return {
    ...extra,
    get counts() {
      return once('counts', () => Object.fromEntries(
        db.activityOf(guildId, userId).map((row) => [row.kind, row.count])));
    },
    get shifts() { return this.counts.job ?? 0; },
    get cars() { return once('cars', () => db.carsOwned(guildId, userId)); },
    get bestCar() {
      return once('bestCar', () => db.getMostValuable(guildId, userId)?.price ?? 0);
    },
    get properties() {
      return once('props', () => db.listOwnedProperties(guildId, userId).length);
    },
    get realty() { return once('realty', () => db.propertyValue(guildId, userId) || 0); },
    get hasCastle() {
      return once('castle', () => db.listOwnedProperties(guildId, userId)
        .some((p) => String(p.name).toLowerCase() === 'schloss'));
    },
    get depot() {
      return once('depot', () =>
        Math.round(require('./wallstreet').portfolio(guildId, userId).value || 0));
    },
    get collection() {
      return once('coll', () => db.lootSummary(guildId, userId).value || 0);
    },
    get crime() { return once('crime', () => db.peekCriminal(guildId, userId)); },
    get heists() { return this.crime?.heists ?? 0; },
    get lootTotal() { return this.crime?.loot_total ?? 0; },
    get level() {
      return once('level', () =>
        require('./level').progress(db.getStats(guildId, userId).xp).level);
    },
    /** Bester Rang in der noch vorhandenen Sammlung – für den Nachtrag. */
    get bestRarity() {
      return once('bestRarity', () => db.listLoot(guildId, userId)
        .reduce((best, item) => Math.max(best, rarityRank(item.rarity)), -1));
    },
  };
}

/**
 * Der Zusammenhang für den `state`-Andockpunkt.
 *
 * Das Vermögen wird **übergeben**, nicht geholt: Profil und Startseite haben
 * es ohnehin gerade berechnet. Ohne diesen Kniff käme bei jedem Blick eine
 * zweite Guthabenabfrage über die API dazu.
 */
async function stateCtx(guildId, userId, worth = null) {
  const total = worth?.total ?? (await require('./networth').of(guildId, userId)
    .then((w) => w.total).catch(() => 0));
  return baseCtx(guildId, userId, { worth: total });
}

/**
 * Prüft alle Regeln eines Andockpunkts und vergibt, was zutrifft.
 *
 * **Synchron** – hier ist kein `await` (§7). Ein zweiter, schneller Klick
 * findet die Zeile bereits vor, und bei einem serverweiten Erfolg entscheidet
 * die Datenbank, wer der Erste war.
 *
 * Ein Verlierer bekommt bei `scope: 'server'` GAR NICHTS – auch keine private
 * Kopie. Sonst stünde der Erfolg bei zwei Leuten im Profil, und die Ehrentafel
 * würde ihre eigene Aussage widerlegen.
 *
 * @returns {Array} die frisch vergebenen Regeln (zum Melden)
 */
function check(guildId, userId, hook, ctx, now = Date.now()) {
  const schon = new Set(db.achievementsOf(guildId, userId).map((r) => r.ach_id));
  const frisch = [];

  for (const rule of RULES) {
    if (rule.on !== hook) continue;
    if (schon.has(rule.id)) continue;

    let trifft = false;
    try { trifft = Boolean(rule.test(ctx)); }
    catch { continue; }          // eine kaputte Regel darf die anderen nicht mitreißen
    if (!trifft) continue;

    if (rule.scope === 'server' && !db.claimFirst(guildId, rule.id, userId, now)) continue;
    if (!db.awardAchievement(guildId, userId, rule.id, now)) continue;
    frisch.push(rule);
  }

  return frisch;
}

/** Andockpunkt 1: eine Geldbuchung mit `kind` (siehe unb.countActivity). */
async function onActivity(guildId, userId, kind, now = Date.now()) {
  const frisch = check(guildId, userId, `kind:${kind}`, baseCtx(guildId, userId), now);
  await report(guildId, userId, frisch);
  return frisch;
}

/** Andockpunkt 2: Profil und Startseite. `worth` spart die Guthabenabfrage. */
async function state(guildId, userId, worth = null, now = Date.now()) {
  const ctx = await stateCtx(guildId, userId, worth);
  const frisch = check(guildId, userId, 'state', ctx, now);
  await report(guildId, userId, frisch);
  return frisch;
}

/** Andockpunkt 3: die Hintertür für Ereignisse ohne Geldbuchung. */
async function fire(guildId, userId, name, daten = {}, now = Date.now()) {
  const frisch = check(
    guildId, userId, `fire:${name}`, baseCtx(guildId, userId, daten), now);
  await report(guildId, userId, frisch);
  return frisch;
}

/**
 * ===========================================================================
 *  MELDEN
 * ===========================================================================
 *
 * Ins Postfach kommt jeder Erfolg – dort stört er niemanden und man findet ihn
 * wieder. In den Kanal kommen nur Gold, Platin und die serverweiten: Wäre
 * jeder Erfolg laut, hätte der Hauptkanal bei zehn Spielern schnell
 * dreihundert Meldungen, und dann ist keine davon mehr ein Ereignis.
 *
 * Alles hier ist fire-and-forget und vollständig in try/catch: Ein Glückwunsch
 * darf niemals eine Schicht, einen Heist oder eine Ansicht kippen.
 */
async function report(guildId, userId, frisch) {
  if (!frisch.length) return;

  for (const rule of frisch) {
    const stufe = rule.scope === 'server' ? null : TIERS[rule.tier];

    try {
      db.createMessage({
        guildId, userId, type: 'info',
        title: `${rule.emoji} ${rule.title}`,
        body: rule.scope === 'server'
          ? `${rule.text}\nDu hast ihn **als Erster auf dem Server** geholt.`
          : `${rule.text}\n_${stufe.emoji} ${stufe.label}_`,
      });
    } catch { /* ein Postfacheintrag darf nichts kippen */ }

    if (rule.scope !== 'server' && !stufe.loud) continue;

    try {
      const identity = require('./identity');
      const text = rule.scope === 'server'
        ? `${rule.emoji} ${identity.mention(userId)} holt **${rule.title}** `
          + `– **als Erster auf dem Server**.\n_${rule.text}_`
        : `${stufe.emoji} ${identity.mention(userId)} schaltet **${rule.title}** frei.`
          + `\n_${rule.text}_`;
      await require('./relay').broadcast(text, { lane: 'wichtig' });
    } catch { /* ohne Kanal bleibt es beim Postfach */ }
  }
}

/**
 * ===========================================================================
 *  NACHTRAG FÜR BESTANDSSPIELER
 * ===========================================================================
 *
 * Die Erfolge beginnen bei null – wer vorher 600 Fische gefangen hat, stünde
 * ohne alles da. Also einmalig alles vergeben, was schon erfüllt ist.
 *
 * **Lautlos**, und das ist der ganze Punkt: Ohne diese Regel bekäme ein
 * Bestandsspieler beim ersten Menü-Klick zwanzig Glückwünsche am Stück, und
 * der Hauptkanal wäre am Tag der Einführung unbenutzbar. Wie bei
 * `activity.backfill()` und der Erstbefüllung des Treppchens gilt: Der erste
 * Durchlauf merkt sich den Stand, gefeiert wird ab der nächsten Veränderung.
 *
 * @returns {Promise<number>} wie viele Erfolge nachgetragen wurden
 */
async function backfill(guildId, userId, now = Date.now()) {
  if (db.getClaim(guildId, userId, 'ach_backfill')) return 0;
  db.setClaim(guildId, userId, 'ach_backfill', now);   // synchron, vor dem ersten await (§7)

  const ctx = await stateCtx(guildId, userId);
  let n = 0;

  // Alle Andockpunkte durchgehen: Was zählbar ist, ist auch nachtragbar.
  // `fire`-Erfolge ohne Daten in der Vergangenheit fallen dabei von selbst
  // heraus – ihr `test` bekommt kein Ereignis und schlägt fehl.
  for (const hook of hooksOf('privat')) {
    n += check(guildId, userId, hook, ctx, now).length;
  }
  return n;
}

/** Alle Andockpunkte, die in Regeln dieser Sorte vorkommen. */
function hooksOf(scope) {
  return [...new Set(RULES.filter((r) => r.scope === scope).map((r) => r.on))];
}

/**
 * Einmaliger Durchlauf über die ganze Welt für die serverweiten Erfolge.
 *
 * Ohne ihn ginge „Der erste Millionär" an den, der nach dem Update zufällig
 * zuerst ins Menü klickt – nicht an den Reichsten. Deshalb wird hier der
 * Kandidat mit dem höchsten `measure` bestimmt und bekommt ihn.
 *
 * Erfolge mit `backfill: false` bleiben außen vor: Für sie gibt es keine
 * Daten in der Vergangenheit (ein perfekter Coup wird nirgends festgehalten),
 * also starten sie leer und gehen an den Nächsten, der es schafft.
 *
 * @param {string[]} [konten] – nur für Tests; sonst alle mit Besitz
 * @returns {Promise<number>} wie viele serverweite Erfolge vergeben wurden
 */
async function backfillWorld(guildId, konten = null, now = Date.now()) {
  if (db.getClaim(guildId, '*', 'ach_backfill_world')) return 0;
  db.setClaim(guildId, '*', 'ach_backfill_world', now);

  const alle = konten ?? require('./networth').owners(guildId);
  if (!alle.length) return 0;

  // Einmal je Konto den Zusammenhang bauen, nicht je Regel.
  const ctxs = [];
  for (const userId of alle) ctxs.push([userId, await stateCtx(guildId, userId)]);

  let n = 0;
  for (const rule of RULES) {
    if (rule.scope !== 'server' || rule.backfill === false) continue;

    let bester = null;
    let bestwert = -Infinity;
    for (const [userId, ctx] of ctxs) {
      let trifft = false;
      try { trifft = Boolean(rule.test(ctx)); } catch { continue; }
      if (!trifft) continue;

      const wert = rule.measure ? rule.measure(ctx) : ctx.worth;
      if (wert > bestwert) { bestwert = wert; bester = userId; }
    }

    if (!bester) continue;
    if (!db.claimFirst(guildId, rule.id, bester, now)) continue;
    db.awardAchievement(guildId, bester, rule.id, now);
    n++;
  }
  return n;
}

module.exports = {
  TIERS, RULES, byId, rarityRank,
  baseCtx, stateCtx, check, onActivity, state, fire,
  backfill, backfillWorld, hooksOf,
};
