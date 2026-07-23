const { DatabaseSync } = require('node:sqlite');
const fs = require('node:fs');
const path = require('node:path');

const dataDir = path.join(__dirname, '..', 'data');
fs.mkdirSync(dataDir, { recursive: true });

const db = new DatabaseSync(path.join(dataDir, 'shop.db'));

// WAL macht gleichzeitige Lese-/Schreibzugriffe robuster.
db.exec('PRAGMA journal_mode = WAL');
db.exec('PRAGMA foreign_keys = ON');

db.exec(`
  CREATE TABLE IF NOT EXISTS items (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    guild_id    TEXT    NOT NULL,
    name        TEXT    NOT NULL,
    price       INTEGER NOT NULL,
    description TEXT    NOT NULL DEFAULT '',
    emoji       TEXT    NOT NULL DEFAULT '',
    stock       INTEGER,                       -- NULL = unbegrenzter Vorrat
    created_by  TEXT    NOT NULL,
    created_at  INTEGER NOT NULL
  );

  -- Verhindert zwei Artikel mit gleichem Namen auf demselben Server.
  CREATE UNIQUE INDEX IF NOT EXISTS idx_items_guild_name
    ON items (guild_id, lower(name));

  CREATE TABLE IF NOT EXISTS inventory (
    guild_id TEXT    NOT NULL,
    user_id  TEXT    NOT NULL,
    item_id  INTEGER NOT NULL REFERENCES items(id) ON DELETE CASCADE,
    quantity INTEGER NOT NULL,
    PRIMARY KEY (guild_id, user_id, item_id)
  );

  -- Gebrauchtmarkt: von Spielern eingestellte Autos.
  -- Das Auto liegt währenddessen NICHT in der Garage des Verkäufers,
  -- damit es nicht doppelt verkauft werden kann.
  CREATE TABLE IF NOT EXISTS listings (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    guild_id   TEXT    NOT NULL,
    item_id    INTEGER NOT NULL REFERENCES items(id) ON DELETE CASCADE,
    seller_id  TEXT    NOT NULL,
    price      INTEGER NOT NULL,
    created_at INTEGER NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_listings_guild ON listings (guild_id, price);
`);

// Migration: Spalten nachrüsten, ohne bestehende Daten zu verlieren.
const existing = new Set(db.prepare('PRAGMA table_info(items)').all().map((c) => c.name));
for (const [column, definition] of [
  ['brand', "TEXT NOT NULL DEFAULT ''"],        // z.B. "Ferrari"
  ['image_url', "TEXT NOT NULL DEFAULT ''"],    // Foto für die Anzeige
  ['attribution', "TEXT NOT NULL DEFAULT ''"],  // Lizenz + Urheber des Fotos
  // Trennt die Shops: 'car', 'gear' oder 'property'.
  ['kind', "TEXT NOT NULL DEFAULT 'car'"],
  // Nur bei Immobilien: Stellplätze und Tagesmiete (0 = nicht mietbar).
  ['garage', 'INTEGER NOT NULL DEFAULT 0'],
  ['rent', 'INTEGER NOT NULL DEFAULT 0'],
]) {
  if (!existing.has(column)) db.exec(`ALTER TABLE items ADD COLUMN ${column} ${definition}`);
}

// Mietverhältnisse: ein Spieler mietet höchstens eine Immobilie gleichzeitig.
db.exec(`
  CREATE TABLE IF NOT EXISTS rentals (
    guild_id     TEXT    NOT NULL,
    user_id      TEXT    NOT NULL,
    item_id      INTEGER NOT NULL REFERENCES items(id) ON DELETE CASCADE,
    started_at   INTEGER NOT NULL,
    paid_through INTEGER NOT NULL,   -- bis zu diesem Zeitpunkt ist die Miete bezahlt
    paid_total   INTEGER NOT NULL DEFAULT 0,
    PRIMARY KEY (guild_id, user_id)
  );

  -- Von Spielern angebotene Mietobjekte. Ob eines belegt ist, steht in
  -- rentals – so bleibt das Angebot nach einer Kündigung bestehen.
  CREATE TABLE IF NOT EXISTS rent_offers (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    guild_id    TEXT    NOT NULL,
    item_id     INTEGER NOT NULL REFERENCES items(id) ON DELETE CASCADE,
    landlord_id TEXT    NOT NULL,
    price       INTEGER NOT NULL,
    created_at  INTEGER NOT NULL,
    UNIQUE (guild_id, landlord_id, item_id)
  );

  -- Wer zu viele Autos für seine Stellplätze hat, bekommt eine Frist.
  -- Läuft sie ab, werden Fahrzeuge zwangsverkauft.
  CREATE TABLE IF NOT EXISTS capacity_grace (
    guild_id TEXT    NOT NULL,
    user_id  TEXT    NOT NULL,
    since    INTEGER NOT NULL,
    PRIMARY KEY (guild_id, user_id)
  );
`);

// Zustand nachrüsten: 0–100. Gilt pro Besitzeintrag – bei Autos ist die
// Menge deshalb immer 1, damit jeder Wagen seinen eigenen Zustand hat.
const inventoryColumns = new Set(
  db.prepare('PRAGMA table_info(inventory)').all().map((c) => c.name));
if (!inventoryColumns.has('condition')) {
  db.exec('ALTER TABLE inventory ADD COLUMN condition INTEGER NOT NULL DEFAULT 100');
}

// Inserate müssen den Zustand mitführen: das Auto liegt in Treuhand und ist
// währenddessen nicht mehr im Inventar hinterlegt.
const listingColumns = new Set(
  db.prepare('PRAGMA table_info(listings)').all().map((c) => c.name));
if (!listingColumns.has('condition')) {
  db.exec('ALTER TABLE listings ADD COLUMN condition INTEGER NOT NULL DEFAULT 100');
}

// Anzeigen privater Anbieter ("NPCs"). Sie gehören niemandem, laufen ab und
// werden bei Bedarf nachgefüllt – deshalb eine eigene Tabelle statt listings.
db.exec(`
  CREATE TABLE IF NOT EXISTS npc_listings (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    guild_id   TEXT    NOT NULL,
    item_id    INTEGER NOT NULL REFERENCES items(id) ON DELETE CASCADE,
    kind       TEXT    NOT NULL,          -- 'car' | 'property'
    mode       TEXT    NOT NULL,          -- 'sale' | 'rent'
    seller     TEXT    NOT NULL,
    note       TEXT    NOT NULL DEFAULT '',
    price      INTEGER NOT NULL,
    condition  INTEGER NOT NULL DEFAULT 100,
    deal       TEXT    NOT NULL,
    created_at INTEGER NOT NULL,
    expires_at INTEGER NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_npc_guild ON npc_listings (guild_id, kind, expires_at);

  -- Wann zuletzt geprüft wurde, ob neue Anzeigen eingegangen sind.
  -- Ohne das würde der Markt bei jedem Öffnen sofort wieder aufgefüllt.
  CREATE TABLE IF NOT EXISTS npc_spawn (
    guild_id   TEXT    NOT NULL,
    kind       TEXT    NOT NULL,
    last_spawn INTEGER NOT NULL,
    PRIMARY KEY (guild_id, kind)
  );
`);

// Postfach: Kaufangebote, Verkaufsmeldungen und Rechnungen.
db.exec(`
  CREATE TABLE IF NOT EXISTS messages (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    guild_id   TEXT    NOT NULL,
    user_id    TEXT    NOT NULL,
    type       TEXT    NOT NULL,          -- 'offer' | 'sold' | 'bill' | 'info'
    title      TEXT    NOT NULL,
    body       TEXT    NOT NULL DEFAULT '',
    sender     TEXT    NOT NULL DEFAULT '',
    amount     INTEGER NOT NULL DEFAULT 0,
    item_id    INTEGER,                   -- Bezug auf einen Artikel, optional
    listing_id INTEGER,                   -- bei Kaufangeboten
    created_at INTEGER NOT NULL,
    expires_at INTEGER,                   -- Angebote verfallen
    read_at    INTEGER,
    resolved   TEXT                       -- 'accepted' | 'declined' | 'paid' | 'expired'
  );
  CREATE INDEX IF NOT EXISTS idx_messages_user
    ON messages (guild_id, user_id, resolved, created_at);
`);

// Wann zuletzt geprüft wurde, ob sich für ein Inserat jemand interessiert.
const listingCols2 = new Set(
  db.prepare('PRAGMA table_info(listings)').all().map((c) => c.name));
if (!listingCols2.has('checked_at')) {
  db.exec('ALTER TABLE listings ADD COLUMN checked_at INTEGER NOT NULL DEFAULT 0');
}

// Laufende Blackjack-Runden. Der Zustand (Schuh, Hände) ist zu groß für eine
// Button-ID, deshalb hier abgelegt. Höchstens eine aktive Runde pro Spieler.
db.exec(`
  CREATE TABLE IF NOT EXISTS casino_games (
    guild_id   TEXT    NOT NULL,
    user_id    TEXT    NOT NULL,
    bet        INTEGER NOT NULL,
    shoe       TEXT    NOT NULL,
    player     TEXT    NOT NULL,
    dealer     TEXT    NOT NULL,
    created_at INTEGER NOT NULL,
    PRIMARY KEY (guild_id, user_id)
  );
`);

// Wann zuletzt geprüft wurde, was auf der Straße steht.
db.exec(`
  CREATE TABLE IF NOT EXISTS street_watch (
    guild_id   TEXT    NOT NULL,
    user_id    TEXT    NOT NULL,
    last_check INTEGER NOT NULL,
    PRIMARY KEY (guild_id, user_id)
  );
`);

// Spielerstatistik: Erfahrung (XP) sowie kumulierte Ein- und Ausgaben.
// XP entsteht bei jeder echten Geldbuchung (siehe src/level.js), Ein-/Ausgaben
// füttern das Leaderboard. Wer je Geld bewegt hat, hat hier eine Zeile –
// diese Tabelle ist damit zugleich die Teilnehmerliste der Rangliste.
// tagline ist der frei setzbare Angeber-Spruch fürs Profil.
db.exec(`
  CREATE TABLE IF NOT EXISTS player_stats (
    guild_id      TEXT    NOT NULL,
    user_id       TEXT    NOT NULL,
    xp            INTEGER NOT NULL DEFAULT 0,
    income_total  INTEGER NOT NULL DEFAULT 0,
    expense_total INTEGER NOT NULL DEFAULT 0,
    tagline       TEXT    NOT NULL DEFAULT '',
    PRIMARY KEY (guild_id, user_id)
  );
`);

// Storage-Wars-Auktion (serverweit): eine Runde besteht aus mehreren Losen,
// die nacheinander live gehen. Zustand liegt komplett in der DB, damit die
// Auktion auch nach einem Neustart weiterläuft und faul abgerechnet werden kann.
db.exec(`
  CREATE TABLE IF NOT EXISTS storage_rounds (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    guild_id   TEXT    NOT NULL,
    started_at INTEGER NOT NULL,
    ends_at    INTEGER NOT NULL,
    size       INTEGER NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_rounds_guild ON storage_rounds (guild_id, ends_at);

  -- Ein Los = eine Garage. seq bestimmt die Reihenfolge; opens_at/ends_at
  -- staffeln, welche Garage gerade live ist. contents ist der versteckte
  -- Inhalt als JSON, value der Gesamtwert V (fürs Reveal & den No-Faucet-Test).
  CREATE TABLE IF NOT EXISTS storage_lots (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    guild_id    TEXT    NOT NULL,
    round_id    INTEGER NOT NULL,
    seq         INTEGER NOT NULL,
    tier        TEXT    NOT NULL,
    seller      TEXT    NOT NULL DEFAULT '',
    hint        TEXT    NOT NULL DEFAULT '',
    peek        TEXT    NOT NULL DEFAULT '',
    start_price INTEGER NOT NULL,
    top_bid     INTEGER NOT NULL DEFAULT 0,
    top_bidder  TEXT,
    contents    TEXT    NOT NULL,
    value       INTEGER NOT NULL,
    status      TEXT    NOT NULL DEFAULT 'open',   -- open|closing|sold|unsold|void
    opens_at    INTEGER NOT NULL,
    ends_at     INTEGER NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_lots_guild ON storage_lots (guild_id, status, ends_at);

  -- Ersteigerte Fundstücke. Bleiben in der Sammlung, bis sie beim Hehler
  -- verkauft werden – behalten (sammeln) ist der Standard.
  CREATE TABLE IF NOT EXISTS storage_loot (
    id       INTEGER PRIMARY KEY AUTOINCREMENT,
    guild_id TEXT    NOT NULL,
    user_id  TEXT    NOT NULL,
    name     TEXT    NOT NULL,
    value    INTEGER NOT NULL,
    lot_id   INTEGER,
    found_at INTEGER NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_loot_user ON storage_loot (guild_id, user_id, found_at);
`);

// Vermieter nachrüsten ('' = Markt/NPC).
const rentalColumns = new Set(
  db.prepare('PRAGMA table_info(rentals)').all().map((c) => c.name));
if (!rentalColumns.has('landlord_id')) {
  db.exec("ALTER TABLE rentals ADD COLUMN landlord_id TEXT NOT NULL DEFAULT ''");
}
// Der vereinbarte Tagespreis. Bei Spieler-Vermietung weicht er vom
// Katalogwert ab – ohne diese Spalte würde die falsche Miete abgebucht.
if (!rentalColumns.has('price')) {
  db.exec('ALTER TABLE rentals ADD COLUMN price INTEGER NOT NULL DEFAULT 0');
}
// Anzeigename bei NPC-Mietern (leer = Spieler-Mieter).
if (!rentalColumns.has('tenant_name')) {
  db.exec("ALTER TABLE rentals ADD COLUMN tenant_name TEXT NOT NULL DEFAULT ''");
}

// Prüfzeitpunkt für Mietangebote: wann zuletzt geschaut wurde, ob ein
// NPC-Mieter ein- oder auszieht. Ohne das würde jedes Öffnen neu würfeln.
const offerColumns = new Set(
  db.prepare('PRAGMA table_info(rent_offers)').all().map((c) => c.name));
if (!offerColumns.has('checked_at')) {
  db.exec('ALTER TABLE rent_offers ADD COLUMN checked_at INTEGER NOT NULL DEFAULT 0');
}

// Anstellungen: wer arbeitet gerade wo.
db.exec(`
  CREATE TABLE IF NOT EXISTS employment (
    guild_id     TEXT    NOT NULL,
    user_id      TEXT    NOT NULL,
    job_id       TEXT    NOT NULL,
    hired_at     INTEGER NOT NULL,
    last_work_at INTEGER NOT NULL DEFAULT 0,
    shifts       INTEGER NOT NULL DEFAULT 0,
    earned       INTEGER NOT NULL DEFAULT 0,
    PRIMARY KEY (guild_id, user_id)
  );
`);

// Tageszähler nachrüsten (Schichtbegrenzung pro Tag).
const employmentColumns = new Set(
  db.prepare('PRAGMA table_info(employment)').all().map((c) => c.name));
for (const [column, definition] of [
  ['work_day', "TEXT NOT NULL DEFAULT ''"],        // z.B. "2026-07-20"
  ['shifts_today', 'INTEGER NOT NULL DEFAULT 0'],
]) {
  if (!employmentColumns.has(column)) {
    db.exec(`ALTER TABLE employment ADD COLUMN ${column} ${definition}`);
  }
}

// 5 pro Seite: so passen die Kauf-Buttons in genau eine Discord-Zeile.
const PAGE_SIZE = 5;

const stmt = {
  listItems: db.prepare(
    `SELECT * FROM items WHERE guild_id = ? AND kind = ?
     ORDER BY price ASC, name ASC LIMIT ? OFFSET ?`),
  countItems: db.prepare('SELECT COUNT(*) AS n FROM items WHERE guild_id = ? AND kind = ?'),
  listItemsByBrand: db.prepare(
    `SELECT * FROM items WHERE guild_id = ? AND kind = ? AND brand = ?
     ORDER BY price ASC, name ASC LIMIT ? OFFSET ?`),
  countItemsByBrand: db.prepare(
    'SELECT COUNT(*) AS n FROM items WHERE guild_id = ? AND kind = ? AND brand = ?'),
  listBrands: db.prepare(
    `SELECT brand, COUNT(*) AS n, MIN(price) AS min_price, MAX(price) AS max_price
     FROM items WHERE guild_id = ? AND kind = 'car' AND brand <> ''
     GROUP BY brand ORDER BY brand ASC`),
  allItemsOfKind: db.prepare('SELECT * FROM items WHERE guild_id = ? AND kind = ?'),

  // --- Besitz nach Name (für Job-Voraussetzungen) ---
  ownsNamed: db.prepare(
    `SELECT inv.quantity, i.name FROM inventory inv JOIN items i ON i.id = inv.item_id
     WHERE inv.guild_id = ? AND inv.user_id = ? AND lower(i.name) = lower(?)
       AND inv.quantity > 0`),
  bestCarValue: db.prepare(
    `SELECT COALESCE(MAX(i.price), 0) AS best
     FROM inventory inv JOIN items i ON i.id = inv.item_id
     WHERE inv.guild_id = ? AND inv.user_id = ? AND i.kind = 'car' AND inv.quantity > 0`),

  // --- Immobilien & Garage ---
  // Eigene Immobilien zählen nur, solange sie nicht vermietet sind –
  // wer sein Haus vermietet, gibt die Garage mit ab.
  ownedGarage: db.prepare(
    `SELECT COALESCE(SUM(i.garage * inv.quantity), 0) AS slots
     FROM inventory inv JOIN items i ON i.id = inv.item_id
     WHERE inv.guild_id = ? AND inv.user_id = ? AND i.kind = 'property' AND inv.quantity > 0
       AND NOT EXISTS (
         SELECT 1 FROM rentals r
         WHERE r.guild_id = inv.guild_id AND r.item_id = inv.item_id
           AND r.landlord_id = inv.user_id
       )`),
  carsOwned: db.prepare(
    `SELECT COALESCE(SUM(inv.quantity), 0) AS n
     FROM inventory inv JOIN items i ON i.id = inv.item_id
     WHERE inv.guild_id = ? AND inv.user_id = ? AND i.kind = 'car' AND inv.quantity > 0`),
  // Besitz einer bestimmten Art – für die Ausrüstungsübersicht.
  ownedOfKind: db.prepare(
    `SELECT i.*, inv.quantity, inv.condition
     FROM inventory inv JOIN items i ON i.id = inv.item_id
     WHERE inv.guild_id = ? AND inv.user_id = ? AND inv.quantity > 0 AND i.kind = ?
     ORDER BY i.brand ASC, i.name ASC`),
  listOwnedProperties: db.prepare(
    `SELECT i.*, inv.quantity, inv.condition FROM inventory inv JOIN items i ON i.id = inv.item_id
     WHERE inv.guild_id = ? AND inv.user_id = ? AND i.kind = 'property' AND inv.quantity > 0
     ORDER BY i.price DESC`),

  // --- Miete ---
  // r.price (vereinbarte Miete) und i.price (Kaufpreis) heißen gleich –
  // ohne Aliase würde eines das andere überschreiben.
  getRental: db.prepare(
    `SELECT r.guild_id, r.user_id, r.item_id, r.started_at, r.paid_through,
            r.paid_total, r.landlord_id, r.price AS agreed_rent,
            i.name, i.emoji, i.garage, i.rent AS catalog_rent,
            i.price AS purchase_price, i.image_url, i.brand, i.description
     FROM rentals r JOIN items i ON i.id = r.item_id
     WHERE r.guild_id = ? AND r.user_id = ?`),
  startRental: db.prepare(
    `INSERT INTO rentals (guild_id, user_id, item_id, started_at, paid_through, paid_total)
     VALUES (?, ?, ?, ?, ?, ?)
     ON CONFLICT (guild_id, user_id) DO UPDATE SET
       item_id = excluded.item_id, started_at = excluded.started_at,
       paid_through = excluded.paid_through, paid_total = excluded.paid_total`),
  endRental: db.prepare('DELETE FROM rentals WHERE guild_id = ? AND user_id = ?'),
  setLandlord: db.prepare(
    'UPDATE rentals SET landlord_id = ?, price = ? WHERE guild_id = ? AND user_id = ?'),
  extendRental: db.prepare(
    `UPDATE rentals SET paid_through = ?, paid_total = paid_total + ?
     WHERE guild_id = ? AND user_id = ?`),
  countRentersOf: db.prepare(
    'SELECT COUNT(*) AS n FROM rentals WHERE guild_id = ? AND item_id = ?'),

  // --- Vermietung durch Spieler ---
  createOffer: db.prepare(
    `INSERT INTO rent_offers (guild_id, item_id, landlord_id, price, created_at)
     VALUES (?, ?, ?, ?, ?) RETURNING *`),
  deleteOffer: db.prepare(
    'DELETE FROM rent_offers WHERE guild_id = ? AND id = ? AND landlord_id = ?'),
  getOffer: db.prepare(
    `SELECT o.id AS offer_id, o.price AS offer_price, o.landlord_id, i.*
     FROM rent_offers o JOIN items i ON i.id = o.item_id
     WHERE o.guild_id = ? AND o.id = ?`),
  listOffers: db.prepare(
    `SELECT o.id AS offer_id, o.price AS offer_price, o.landlord_id, i.*,
            EXISTS (SELECT 1 FROM rentals r
                    WHERE r.guild_id = o.guild_id AND r.item_id = o.item_id
                      AND r.landlord_id = o.landlord_id) AS taken
     FROM rent_offers o JOIN items i ON i.id = o.item_id
     WHERE o.guild_id = ? ORDER BY o.price ASC LIMIT ? OFFSET ?`),
  countOffers: db.prepare('SELECT COUNT(*) AS n FROM rent_offers WHERE guild_id = ?'),
  listOffersOf: db.prepare(
    `SELECT o.id AS offer_id, o.price AS offer_price, o.checked_at, o.created_at, i.*,
            EXISTS (SELECT 1 FROM rentals r
                    WHERE r.guild_id = o.guild_id AND r.item_id = o.item_id
                      AND r.landlord_id = o.landlord_id) AS taken
     FROM rent_offers o JOIN items i ON i.id = o.item_id
     WHERE o.guild_id = ? AND o.landlord_id = ?`),
  offerTaken: db.prepare(
    `SELECT COUNT(*) AS n FROM rentals
     WHERE guild_id = ? AND item_id = ? AND landlord_id = ?`),
  tenantsOf: db.prepare(
    `SELECT * FROM rentals WHERE guild_id = ? AND landlord_id = ?`),
  // Mieter eines bestimmten Objekts (höchstens einer je Angebot).
  tenantOfOffer: db.prepare(
    `SELECT * FROM rentals WHERE guild_id = ? AND item_id = ? AND landlord_id = ?`),
  setTenantName: db.prepare(
    'UPDATE rentals SET tenant_name = ? WHERE guild_id = ? AND user_id = ?'),
  touchOffer: db.prepare(
    'UPDATE rent_offers SET checked_at = ? WHERE guild_id = ? AND id = ?'),

  // --- NPC-Anzeigen ---
  insertNpc: db.prepare(
    `INSERT INTO npc_listings
       (guild_id, item_id, kind, mode, seller, note, price, condition, deal, created_at, expires_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?) RETURNING *`),
  listNpc: db.prepare(
    `SELECT n.id AS npc_id, n.mode, n.seller, n.note, n.price AS npc_price,
            n.condition AS npc_condition, n.deal, n.expires_at, i.*
     FROM npc_listings n JOIN items i ON i.id = n.item_id
     WHERE n.guild_id = ? AND n.kind = ? AND n.expires_at > ?
     ORDER BY n.price ASC`),
  getNpc: db.prepare(
    `SELECT n.id AS npc_id, n.mode, n.seller, n.note, n.price AS npc_price,
            n.condition AS npc_condition, n.deal, n.expires_at, i.*
     FROM npc_listings n JOIN items i ON i.id = n.item_id
     WHERE n.guild_id = ? AND n.id = ?`),
  deleteNpc: db.prepare('DELETE FROM npc_listings WHERE guild_id = ? AND id = ?'),
  purgeExpiredNpc: db.prepare('DELETE FROM npc_listings WHERE guild_id = ? AND expires_at <= ?'),
  countNpc: db.prepare(
    `SELECT COUNT(*) AS n FROM npc_listings
     WHERE guild_id = ? AND kind = ? AND expires_at > ?`),
  npcItemIds: db.prepare(
    `SELECT item_id FROM npc_listings WHERE guild_id = ? AND kind = ? AND expires_at > ?`),
  getNpcSpawn: db.prepare('SELECT * FROM npc_spawn WHERE guild_id = ? AND kind = ?'),
  setNpcSpawn: db.prepare(
    `INSERT INTO npc_spawn (guild_id, kind, last_spawn) VALUES (?, ?, ?)
     ON CONFLICT (guild_id, kind) DO UPDATE SET last_spawn = excluded.last_spawn`),
  clearNpcSpawn: db.prepare('DELETE FROM npc_spawn WHERE guild_id = ? AND kind = ?'),

  // --- Postfach ---
  insertMessage: db.prepare(
    `INSERT INTO messages
       (guild_id, user_id, type, title, body, sender, amount, item_id, listing_id,
        created_at, expires_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?) RETURNING *`),
  listMessages: db.prepare(
    `SELECT * FROM messages
     WHERE guild_id = ? AND user_id = ? AND resolved IS NULL
     ORDER BY created_at DESC LIMIT ? OFFSET ?`),
  countMessages: db.prepare(
    `SELECT COUNT(*) AS n FROM messages
     WHERE guild_id = ? AND user_id = ? AND resolved IS NULL`),
  countUnread: db.prepare(
    `SELECT COUNT(*) AS n FROM messages
     WHERE guild_id = ? AND user_id = ? AND resolved IS NULL AND read_at IS NULL`),
  getMessage: db.prepare('SELECT * FROM messages WHERE guild_id = ? AND id = ?'),
  resolveMessage: db.prepare(
    'UPDATE messages SET resolved = ? WHERE guild_id = ? AND id = ? AND resolved IS NULL'),
  markRead: db.prepare(
    `UPDATE messages SET read_at = ?
     WHERE guild_id = ? AND user_id = ? AND read_at IS NULL AND resolved IS NULL`),
  expireMessages: db.prepare(
    `UPDATE messages SET resolved = 'expired'
     WHERE guild_id = ? AND resolved IS NULL AND expires_at IS NOT NULL AND expires_at <= ?`),
  // Offene Angebote zu einem Inserat – beim Verkauf hinfällig.
  cancelOffersFor: db.prepare(
    `UPDATE messages SET resolved = 'expired'
     WHERE guild_id = ? AND listing_id = ? AND type = 'offer' AND resolved IS NULL`),

  // --- Interessenten für eigene Inserate ---
  ownListings: db.prepare(
    `SELECT l.id AS listing_id, l.price AS listing_price, l.seller_id, l.created_at,
            l.checked_at, l.condition AS listing_condition, i.*
     FROM listings l JOIN items i ON i.id = l.item_id
     WHERE l.guild_id = ? AND l.seller_id = ?`),
  touchListing: db.prepare(
    'UPDATE listings SET checked_at = ? WHERE guild_id = ? AND id = ?'),

  // --- Blackjack-Runde ---
  getGame: db.prepare('SELECT * FROM casino_games WHERE guild_id = ? AND user_id = ?'),
  setGame: db.prepare(
    `INSERT INTO casino_games (guild_id, user_id, bet, shoe, player, dealer, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT (guild_id, user_id) DO UPDATE SET
       bet = excluded.bet, shoe = excluded.shoe,
       player = excluded.player, dealer = excluded.dealer,
       created_at = excluded.created_at`),
  updateGame: db.prepare(
    `UPDATE casino_games SET shoe = ?, player = ?, dealer = ?
     WHERE guild_id = ? AND user_id = ?`),
  clearGame: db.prepare('DELETE FROM casino_games WHERE guild_id = ? AND user_id = ?'),

  // --- Gnadenfrist bei Überkapazität ---
  getGrace: db.prepare('SELECT * FROM capacity_grace WHERE guild_id = ? AND user_id = ?'),
  startGrace: db.prepare(
    `INSERT INTO capacity_grace (guild_id, user_id, since) VALUES (?, ?, ?)
     ON CONFLICT (guild_id, user_id) DO NOTHING`),
  clearGrace: db.prepare('DELETE FROM capacity_grace WHERE guild_id = ? AND user_id = ?'),

  // Zufällige Autos eines Spielers – für den Zwangsverkauf.
  randomCars: db.prepare(
    `SELECT i.id, i.name, i.price, inv.quantity, inv.condition
     FROM inventory inv JOIN items i ON i.id = inv.item_id
     WHERE inv.guild_id = ? AND inv.user_id = ? AND i.kind = 'car' AND inv.quantity > 0
     ORDER BY RANDOM()`),

  // --- Zustand ---
  setCondition: db.prepare(
    `UPDATE inventory SET condition = ?
     WHERE guild_id = ? AND user_id = ? AND item_id = ?`),
  /**
   * Autos, die draußen stehen: die teuersten kommen zuerst in die Garage,
   * der Rest parkt auf der Straße. Wer eine Garage hat, stellt schließlich
   * nicht den Bugatti raus und den Corsa rein.
   */
  carsByValue: db.prepare(
    `SELECT i.id, i.name, i.price, inv.condition
     FROM inventory inv JOIN items i ON i.id = inv.item_id
     WHERE inv.guild_id = ? AND inv.user_id = ? AND i.kind = 'car' AND inv.quantity > 0
     ORDER BY i.price DESC, i.id ASC`),

  getStreetWatch: db.prepare('SELECT * FROM street_watch WHERE guild_id = ? AND user_id = ?'),
  setStreetWatch: db.prepare(
    `INSERT INTO street_watch (guild_id, user_id, last_check) VALUES (?, ?, ?)
     ON CONFLICT (guild_id, user_id) DO UPDATE SET last_check = excluded.last_check`),

  // --- Anstellung ---
  getEmployment: db.prepare('SELECT * FROM employment WHERE guild_id = ? AND user_id = ?'),
  setEmployment: db.prepare(
    `INSERT INTO employment (guild_id, user_id, job_id, hired_at, last_work_at)
     VALUES (?, ?, ?, ?, 0)
     ON CONFLICT (guild_id, user_id)
     DO UPDATE SET job_id = excluded.job_id, hired_at = excluded.hired_at,
                   last_work_at = 0, shifts = 0, earned = 0`),
  clearEmployment: db.prepare('DELETE FROM employment WHERE guild_id = ? AND user_id = ?'),
  recordShift: db.prepare(
    `UPDATE employment
     SET last_work_at = ?, shifts = shifts + 1, earned = earned + ?,
         work_day = ?,
         shifts_today = CASE WHEN work_day = ? THEN shifts_today + 1 ELSE 1 END
     WHERE guild_id = ? AND user_id = ?`),
  // Verschleiß: ein Stück eines benannten Artikels aus dem Inventar nehmen.
  consumeNamed: db.prepare(
    `UPDATE inventory SET quantity = quantity - 1
     WHERE guild_id = ? AND user_id = ? AND quantity > 0 AND item_id = (
       SELECT id FROM items WHERE guild_id = ? AND lower(name) = lower(?)
     )`),
  getItem: db.prepare('SELECT * FROM items WHERE guild_id = ? AND id = ?'),
  createItem: db.prepare(
    `INSERT INTO items (guild_id, name, price, description, emoji, stock, created_by, created_at,
                        brand, image_url, attribution, kind, garage, rent)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?) RETURNING *`),
  deleteItem: db.prepare('DELETE FROM items WHERE guild_id = ? AND id = ?'),
  // Bild aktualisieren, ohne den Artikel (und damit Inventare) anzufassen.
  updateItemImage: db.prepare(
    `UPDATE items SET image_url = ?, attribution = ?
     WHERE guild_id = ? AND lower(name) = lower(?)`),
  takeStock: db.prepare('UPDATE items SET stock = stock - ? WHERE id = ? AND stock >= ?'),
  giveStock: db.prepare('UPDATE items SET stock = stock + ? WHERE id = ?'),
  addToInventory: db.prepare(
    `INSERT INTO inventory (guild_id, user_id, item_id, quantity) VALUES (?, ?, ?, ?)
     ON CONFLICT (guild_id, user_id, item_id)
     DO UPDATE SET quantity = quantity + excluded.quantity`),
  removeFromInventory: db.prepare(
    'UPDATE inventory SET quantity = quantity - ? WHERE guild_id = ? AND user_id = ? AND item_id = ?'),
  pruneInventory: db.prepare('DELETE FROM inventory WHERE quantity <= 0'),
  listInventory: db.prepare(
    `SELECT i.*, inv.quantity, inv.condition
     FROM inventory inv JOIN items i ON i.id = inv.item_id
     WHERE inv.guild_id = ? AND inv.user_id = ? AND inv.quantity > 0 AND i.kind = 'car'
     ORDER BY i.price DESC, i.name ASC LIMIT ? OFFSET ?`),
  countInventory: db.prepare(
    `SELECT COUNT(*) AS n FROM inventory inv JOIN items i ON i.id = inv.item_id
     WHERE inv.guild_id = ? AND inv.user_id = ? AND inv.quantity > 0 AND i.kind = 'car'`),
  getOwned: db.prepare(
    `SELECT i.*, inv.quantity, inv.condition
     FROM inventory inv JOIN items i ON i.id = inv.item_id
     WHERE inv.guild_id = ? AND inv.user_id = ? AND inv.item_id = ? AND inv.quantity > 0`),
  getMostValuable: db.prepare(
    `SELECT i.*, inv.quantity, inv.condition
     FROM inventory inv JOIN items i ON i.id = inv.item_id
     WHERE inv.guild_id = ? AND inv.user_id = ? AND inv.quantity > 0 AND i.kind = 'car'
     ORDER BY i.price DESC LIMIT 1`),
  // Der Zustand drückt den Wert: 0.30 Restwert plus 0.70 nach Zustand.
  // Muss zur Formel in src/condition.js passen.
  totalGarageValue: db.prepare(
    `SELECT COALESCE(SUM(
       ROUND(i.price * (0.30 + 0.70 * (inv.condition / 100.0))) * inv.quantity
     ), 0) AS value
     FROM inventory inv JOIN items i ON i.id = inv.item_id
     WHERE inv.guild_id = ? AND inv.user_id = ? AND inv.quantity > 0 AND i.kind = 'car'`),

  // --- Gebrauchtmarkt ---
  listListings: db.prepare(
    `SELECT l.id AS listing_id, l.price AS listing_price, l.seller_id, l.created_at,
            l.condition AS listing_condition, i.*
     FROM listings l JOIN items i ON i.id = l.item_id
     WHERE l.guild_id = ? AND i.kind = ?
     ORDER BY l.price ASC, l.id ASC LIMIT ? OFFSET ?`),
  countListings: db.prepare(
    `SELECT COUNT(*) AS n FROM listings l JOIN items i ON i.id = l.item_id
     WHERE l.guild_id = ? AND i.kind = ?`),
  allListingsOfKind: db.prepare(
    `SELECT l.id AS listing_id, l.price AS listing_price, l.seller_id, l.created_at,
            l.condition AS listing_condition, i.*
     FROM listings l JOIN items i ON i.id = l.item_id
     WHERE l.guild_id = ? AND i.kind = ? ORDER BY l.price ASC`),
  hasTenant: db.prepare('SELECT COUNT(*) AS n FROM rentals WHERE guild_id = ? AND item_id = ?'),
  getListing: db.prepare(
    `SELECT l.id AS listing_id, l.price AS listing_price, l.seller_id, l.created_at,
            l.condition AS listing_condition, i.*
     FROM listings l JOIN items i ON i.id = l.item_id
     WHERE l.guild_id = ? AND l.id = ?`),
  insertListing: db.prepare(
    `INSERT INTO listings (guild_id, item_id, seller_id, price, created_at, condition)
     VALUES (?, ?, ?, ?, ?, ?) RETURNING *`),
  deleteListing: db.prepare('DELETE FROM listings WHERE guild_id = ? AND id = ?'),
  countUserListings: db.prepare(
    'SELECT COUNT(*) AS n FROM listings WHERE guild_id = ? AND seller_id = ?'),

  // --- Spielerstatistik (XP, Ein-/Ausgaben, Spruch) ---
  addStats: db.prepare(
    `INSERT INTO player_stats (guild_id, user_id, xp, income_total, expense_total)
     VALUES (?, ?, ?, ?, ?)
     ON CONFLICT (guild_id, user_id) DO UPDATE SET
       xp            = xp + excluded.xp,
       income_total  = income_total + excluded.income_total,
       expense_total = expense_total + excluded.expense_total`),
  getStats: db.prepare('SELECT * FROM player_stats WHERE guild_id = ? AND user_id = ?'),
  listStats: db.prepare('SELECT * FROM player_stats WHERE guild_id = ?'),
  setTagline: db.prepare(
    `INSERT INTO player_stats (guild_id, user_id, tagline) VALUES (?, ?, ?)
     ON CONFLICT (guild_id, user_id) DO UPDATE SET tagline = excluded.tagline`),
  // Kaufwert aller eigenen Immobilien – fürs Profil/Networth, analog garageValue.
  totalPropertyValue: db.prepare(
    `SELECT COALESCE(SUM(i.price * inv.quantity), 0) AS value
     FROM inventory inv JOIN items i ON i.id = inv.item_id
     WHERE inv.guild_id = ? AND inv.user_id = ? AND inv.quantity > 0 AND i.kind = 'property'`),

  // --- Storage-Wars: Runden ---
  activeRound: db.prepare(
    `SELECT * FROM storage_rounds WHERE guild_id = ? AND ends_at > ?
     ORDER BY ends_at DESC LIMIT 1`),
  latestRound: db.prepare(
    'SELECT * FROM storage_rounds WHERE guild_id = ? ORDER BY ends_at DESC LIMIT 1'),
  insertRound: db.prepare(
    `INSERT INTO storage_rounds (guild_id, started_at, ends_at, size)
     VALUES (?, ?, ?, ?) RETURNING *`),

  // --- Storage-Wars: Lose ---
  insertLot: db.prepare(
    `INSERT INTO storage_lots
       (guild_id, round_id, seq, tier, seller, hint, peek, start_price, contents,
        value, opens_at, ends_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?) RETURNING *`),
  listRoundLots: db.prepare(
    'SELECT * FROM storage_lots WHERE guild_id = ? AND round_id = ? ORDER BY seq ASC'),
  getLot: db.prepare('SELECT * FROM storage_lots WHERE guild_id = ? AND id = ?'),
  // Gebot nur annehmen, wenn das Los LIVE ist und das Gebot höher liegt (atomar).
  placeBid: db.prepare(
    `UPDATE storage_lots SET top_bid = ?, top_bidder = ?
     WHERE id = ? AND guild_id = ? AND status = 'open'
       AND opens_at <= ? AND ends_at > ? AND top_bid < ?`),
  // Fälliges Los für die Abrechnung reservieren (verhindert Doppelabrechnung).
  claimLot: db.prepare(
    "UPDATE storage_lots SET status = 'closing' WHERE id = ? AND guild_id = ? AND status = 'open'"),
  finishLot: db.prepare(
    'UPDATE storage_lots SET status = ? WHERE id = ? AND guild_id = ?'),
  dueLots: db.prepare(
    `SELECT * FROM storage_lots WHERE guild_id = ? AND status = 'open' AND ends_at <= ?
     ORDER BY seq ASC`),
  purgeOldLots: db.prepare(
    `DELETE FROM storage_lots
     WHERE guild_id = ? AND status IN ('sold','unsold','void') AND ends_at < ?`),

  // --- Storage-Wars: Fundstücke (Sammlung) ---
  addLoot: db.prepare(
    `INSERT INTO storage_loot (guild_id, user_id, name, value, lot_id, found_at)
     VALUES (?, ?, ?, ?, ?, ?) RETURNING *`),
  listLoot: db.prepare(
    `SELECT * FROM storage_loot WHERE guild_id = ? AND user_id = ?
     ORDER BY value DESC, found_at DESC`),
  lootSummary: db.prepare(
    `SELECT COALESCE(SUM(value), 0) AS value, COUNT(*) AS n
     FROM storage_loot WHERE guild_id = ? AND user_id = ?`),
  getLoot: db.prepare('SELECT * FROM storage_loot WHERE guild_id = ? AND id = ?'),
  removeLoot: db.prepare('DELETE FROM storage_loot WHERE guild_id = ? AND user_id = ? AND id = ?'),
  clearLoot: db.prepare('DELETE FROM storage_loot WHERE guild_id = ? AND user_id = ?'),
  deleteRounds: db.prepare('DELETE FROM storage_rounds WHERE guild_id = ?'),
  deleteLots: db.prepare('DELETE FROM storage_lots WHERE guild_id = ?'),
  deleteLoot: db.prepare('DELETE FROM storage_loot WHERE guild_id = ?'),
};

/** Führt fn in einer Transaktion aus; bei einem Fehler wird alles zurückgerollt. */
function transaction(fn) {
  db.exec('BEGIN');
  try {
    const result = fn();
    db.exec('COMMIT');
    return result;
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }
}

/**
 * @param {string|null} brand Auf eine Marke einschränken, null = alle.
 * @param {'car'|'gear'} kind Autos oder Ausrüstung.
 */
function listItems(guildId, page = 1, brand = null, kind = 'car') {
  const offset = (page - 1) * PAGE_SIZE;
  const total = brand
    ? stmt.countItemsByBrand.get(guildId, kind, brand).n
    : stmt.countItems.get(guildId, kind).n;
  const items = brand
    ? stmt.listItemsByBrand.all(guildId, kind, brand, PAGE_SIZE, offset)
    : stmt.listItems.all(guildId, kind, PAGE_SIZE, offset);
  return { items, total, totalPages: Math.max(1, Math.ceil(total / PAGE_SIZE)), page, brand, kind };
}

/** Besitzt der Spieler einen Artikel mit diesem Namen? */
function ownsNamed(guildId, userId, name) {
  return stmt.ownsNamed.get(guildId, userId, name) ?? null;
}

/** Wert des teuersten Autos des Spielers (0 = keins). */
function bestCarValue(guildId, userId) {
  return stmt.bestCarValue.get(guildId, userId).best;
}

/** Alle Artikel einer Art – für Seed-Abgleiche. */
function allItemsOfKind(guildId, kind) {
  return stmt.allItemsOfKind.all(guildId, kind);
}

// -------------------------------------------------------- Immobilien & Miete

/** Stellplätze aus gekauften Immobilien. */
function ownedGarageSlots(guildId, userId) {
  return stmt.ownedGarage.get(guildId, userId).slots;
}

/** Wie viele Autos der Spieler besitzt. */
function carsOwned(guildId, userId) {
  return stmt.carsOwned.get(guildId, userId).n;
}

/** Alle gekauften Immobilien eines Spielers. */
function listOwnedProperties(guildId, userId) {
  return stmt.listOwnedProperties.all(guildId, userId);
}

/** Alles, was ein Spieler von einer Art besitzt. */
function ownedOfKind(guildId, userId, kind) {
  return stmt.ownedOfKind.all(guildId, userId, kind);
}

/** Das laufende Mietverhältnis, oder null. */
function getRental(guildId, userId) {
  return stmt.getRental.get(guildId, userId) ?? null;
}

/**
 * @param {number} dailyPrice Der vereinbarte Tagespreis. Bei Spieler-
 *   Vermietung weicht er vom Katalogwert des Objekts ab.
 */
function startRental(guildId, userId, itemId, paidThrough, paidNow, landlordId = '', dailyPrice = 0) {
  stmt.startRental.run(guildId, userId, itemId, Date.now(), paidThrough, paidNow);
  stmt.setLandlord.run(landlordId, dailyPrice, guildId, userId);
  return getRental(guildId, userId);
}

// ------------------------------------------------- Vermietung durch Spieler

function createOffer(guildId, landlordId, itemId, price) {
  return stmt.createOffer.get(guildId, itemId, landlordId, price, Date.now());
}

function deleteOffer(guildId, landlordId, offerId) {
  return stmt.deleteOffer.run(guildId, offerId, landlordId).changes > 0;
}

function getOffer(guildId, offerId) {
  return stmt.getOffer.get(guildId, offerId) ?? null;
}

function listOffers(guildId, page = 1) {
  const total = stmt.countOffers.get(guildId).n;
  const items = stmt.listOffers.all(guildId, PAGE_SIZE, (page - 1) * PAGE_SIZE);
  return { items, total, totalPages: Math.max(1, Math.ceil(total / PAGE_SIZE)), page };
}

function listOffersOf(guildId, landlordId) {
  return stmt.listOffersOf.all(guildId, landlordId);
}

/** Ist dieses Angebot gerade belegt? */
function offerTaken(guildId, itemId, landlordId) {
  return stmt.offerTaken.get(guildId, itemId, landlordId).n > 0;
}

/** Alle Mietverhältnisse, bei denen dieser Spieler Vermieter ist. */
function tenantsOf(guildId, landlordId) {
  return stmt.tenantsOf.all(guildId, landlordId);
}

/** Der Mieter eines konkreten Objekts, oder null. */
function tenantOfOffer(guildId, itemId, landlordId) {
  return stmt.tenantOfOffer.get(guildId, itemId, landlordId) ?? null;
}

function setTenantName(guildId, userId, name) {
  stmt.setTenantName.run(name, guildId, userId);
}

function touchOffer(guildId, offerId, when = Date.now()) {
  stmt.touchOffer.run(when, guildId, offerId);
}

// --------------------------------------------------------- NPC-Anzeigen

function insertNpcListing(entry) {
  return stmt.insertNpc.get(
    entry.guildId, entry.itemId, entry.kind, entry.mode, entry.seller,
    entry.note ?? '', entry.price, entry.condition ?? 100, entry.deal,
    Date.now(), entry.expiresAt);
}

/** Aktive Anzeigen einer Art. */
function listNpcListings(guildId, kind, now = Date.now()) {
  return stmt.listNpc.all(guildId, kind, now);
}

function getNpcListing(guildId, id) {
  return stmt.getNpc.get(guildId, id) ?? null;
}

function deleteNpcListing(guildId, id) {
  return stmt.deleteNpc.run(guildId, id).changes > 0;
}

/** Räumt abgelaufene Anzeigen weg. */
function purgeExpiredNpc(guildId, now = Date.now()) {
  return stmt.purgeExpiredNpc.run(guildId, now).changes;
}

function countNpcListings(guildId, kind, now = Date.now()) {
  return stmt.countNpc.get(guildId, kind, now).n;
}

/** Welche Artikel schon in einer aktiven Anzeige stecken (keine Dubletten). */
function npcItemIds(guildId, kind, now = Date.now()) {
  return new Set(stmt.npcItemIds.all(guildId, kind, now).map((r) => r.item_id));
}

/** Zeitpunkt der letzten Ankunftsprüfung, oder null. */
function getNpcSpawn(guildId, kind) {
  return stmt.getNpcSpawn.get(guildId, kind) ?? null;
}

function setNpcSpawn(guildId, kind, when) {
  stmt.setNpcSpawn.run(guildId, kind, when);
}

/** Setzt den Ankunftszähler zurück – der Markt startet wieder bei null. */
function clearNpcSpawn(guildId, kind) {
  return stmt.clearNpcSpawn.run(guildId, kind).changes > 0;
}

// -------------------------------------------------------------- Postfach

function createMessage(m) {
  return stmt.insertMessage.get(
    m.guildId, m.userId, m.type, m.title, m.body ?? '', m.sender ?? '',
    m.amount ?? 0, m.itemId ?? null, m.listingId ?? null,
    Date.now(), m.expiresAt ?? null);
}

function listMessages(guildId, userId, page = 1) {
  const total = stmt.countMessages.get(guildId, userId).n;
  const items = stmt.listMessages.all(guildId, userId, PAGE_SIZE, (page - 1) * PAGE_SIZE);
  return { items, total, totalPages: Math.max(1, Math.ceil(total / PAGE_SIZE)), page };
}

function countUnread(guildId, userId) {
  return stmt.countUnread.get(guildId, userId).n;
}

function getMessage(guildId, id) {
  return stmt.getMessage.get(guildId, id) ?? null;
}

/** Schließt eine Nachricht ab ('accepted' | 'declined' | 'paid' | 'expired'). */
function resolveMessage(guildId, id, how) {
  return stmt.resolveMessage.run(how, guildId, id).changes > 0;
}

function markMessagesRead(guildId, userId) {
  return stmt.markRead.run(Date.now(), guildId, userId).changes;
}

/** Lässt abgelaufene Angebote verfallen. */
function expireMessages(guildId, now = Date.now()) {
  return stmt.expireMessages.run(guildId, now).changes;
}

/** Zieht alle offenen Angebote zu einem Inserat zurück. */
function cancelOffersFor(guildId, listingId) {
  return stmt.cancelOffersFor.run(guildId, listingId).changes;
}

/** Alle eigenen Inserate mit Prüfzeitpunkt. */
function ownListings(guildId, sellerId) {
  return stmt.ownListings.all(guildId, sellerId);
}

function touchListing(guildId, listingId, when = Date.now()) {
  stmt.touchListing.run(when, guildId, listingId);
}

// -------------------------------------------------------------- Blackjack

/** Laufende Blackjack-Runde eines Spielers, mit geparsten Karten. */
function getGame(guildId, userId) {
  const row = stmt.getGame.get(guildId, userId);
  if (!row) return null;
  return {
    ...row,
    shoe: JSON.parse(row.shoe),
    player: JSON.parse(row.player),
    dealer: JSON.parse(row.dealer),
  };
}

function setGame(guildId, userId, bet, state) {
  stmt.setGame.run(guildId, userId, bet,
    JSON.stringify(state.shoe), JSON.stringify(state.player),
    JSON.stringify(state.dealer), Date.now());
}

function updateGame(guildId, userId, state) {
  stmt.updateGame.run(
    JSON.stringify(state.shoe), JSON.stringify(state.player),
    JSON.stringify(state.dealer), guildId, userId);
}

function clearGame(guildId, userId) {
  return stmt.clearGame.run(guildId, userId).changes > 0;
}

// ------------------------------------------------------------ Gnadenfrist

function getGrace(guildId, userId) {
  return stmt.getGrace.get(guildId, userId) ?? null;
}

function startGrace(guildId, userId, since = Date.now()) {
  stmt.startGrace.run(guildId, userId, since);
  return getGrace(guildId, userId);
}

function clearGrace(guildId, userId) {
  return stmt.clearGrace.run(guildId, userId).changes > 0;
}

/** Autos eines Spielers in zufälliger Reihenfolge. */
function randomCars(guildId, userId) {
  return stmt.randomCars.all(guildId, userId);
}

// ---------------------------------------------------------------- Zustand

/** Setzt den Zustand eines Fahrzeugs (0–100). */
function setCondition(guildId, userId, itemId, value) {
  return stmt.setCondition.run(
    Math.min(100, Math.max(0, Math.round(value))), guildId, userId, itemId).changes > 0;
}

/** Autos eines Spielers, teuerste zuerst. */
function carsByValue(guildId, userId) {
  return stmt.carsByValue.all(guildId, userId);
}

function getStreetWatch(guildId, userId) {
  return stmt.getStreetWatch.get(guildId, userId) ?? null;
}

function setStreetWatch(guildId, userId, when = Date.now()) {
  stmt.setStreetWatch.run(guildId, userId, when);
}

/** Nimmt ein Auto aus dem Inventar (Zwangsverkauf). */
function removeCar(guildId, userId, itemId) {
  return transaction(() => {
    stmt.removeFromInventory.run(1, guildId, userId, itemId);
    stmt.pruneInventory.run();
    return true;
  });
}

function endRental(guildId, userId) {
  return stmt.endRental.run(guildId, userId).changes > 0;
}

function extendRental(guildId, userId, paidThrough, amount) {
  stmt.extendRental.run(paidThrough, amount, guildId, userId);
}

/** Wie viele Spieler dieses Objekt gerade mieten (zählt gegen den Bestand). */
function countRentersOf(guildId, itemId) {
  return stmt.countRentersOf.get(guildId, itemId).n;
}

// ------------------------------------------------------------- Anstellung

function getEmployment(guildId, userId) {
  return stmt.getEmployment.get(guildId, userId) ?? null;
}

function setEmployment(guildId, userId, jobId) {
  stmt.setEmployment.run(guildId, userId, jobId, Date.now());
  return getEmployment(guildId, userId);
}

function clearEmployment(guildId, userId) {
  return stmt.clearEmployment.run(guildId, userId).changes > 0;
}

/** @param {string} day Tagesstempel, z.B. "2026-07-20" – setzt den Tageszähler zurück. */
function recordShift(guildId, userId, amount, day) {
  stmt.recordShift.run(Date.now(), amount, day, day, guildId, userId);
}

/** Wie viele Schichten heute schon gearbeitet wurden. */
function shiftsToday(guildId, userId, day) {
  const e = stmt.getEmployment.get(guildId, userId);
  if (!e || e.work_day !== day) return 0;
  return e.shifts_today;
}

/**
 * Nimmt ein Stück eines Artikels aus dem Inventar (Verschleiß).
 * @returns {boolean} true, wenn tatsächlich etwas entfernt wurde.
 */
function consumeNamed(guildId, userId, name) {
  const changed = stmt.consumeNamed.run(guildId, userId, guildId, name).changes > 0;
  if (changed) stmt.pruneInventory.run();
  return changed;
}

/** Alle Marken mit Anzahl und Preisspanne – für die Marken-Auswahl. */
function listBrands(guildId) {
  return stmt.listBrands.all(guildId);
}

function getItem(guildId, itemId) {
  return stmt.getItem.get(guildId, itemId) ?? null;
}

function createItem({
  guildId, name, price, description = '', emoji = '', stock = null, createdBy,
  brand = '', imageUrl = '', attribution = '', kind = 'car', garage = 0, rent = 0,
}) {
  return stmt.createItem.get(
    guildId, name, price, description, emoji, stock, createdBy, Date.now(),
    brand, imageUrl, attribution, kind, garage, rent);
}

function deleteItem(guildId, itemId) {
  return stmt.deleteItem.run(guildId, itemId).changes > 0;
}

/**
 * Tauscht nur das Foto eines Artikels aus – Preis, Bestand und alle
 * Inventare bleiben unberührt. Gedacht für den Bildabgleich nach einer
 * Änderung an den *-images.json.
 */
function updateItemImage(guildId, name, imageUrl, attribution) {
  return stmt.updateItemImage.run(imageUrl, attribution, guildId, name).changes > 0;
}

function listInventory(guildId, userId, page = 1) {
  const total = stmt.countInventory.get(guildId, userId).n;
  const items = stmt.listInventory.all(guildId, userId, PAGE_SIZE, (page - 1) * PAGE_SIZE);
  return { items, total, totalPages: Math.max(1, Math.ceil(total / PAGE_SIZE)), page };
}

/**
 * Reserviert einen Kauf lokal: zieht den Lagerbestand ab und legt den Artikel
 * ins Inventar – beides in einer Transaktion. Wird VOR der Geldbuchung
 * aufgerufen, damit ein Fehlschlag lokal (und damit zuverlässig) rückgängig
 * gemacht werden kann.
 */
function reservePurchase(guildId, userId, itemId, quantity) {
  return transaction(() => {
    const item = stmt.getItem.get(guildId, itemId);
    if (!item) return { ok: false, reason: 'not_found' };

    // stock === null bedeutet unbegrenzt.
    if (item.stock !== null) {
      const res = stmt.takeStock.run(quantity, itemId, quantity);
      if (res.changes === 0) return { ok: false, reason: 'out_of_stock', item };
    }

    stmt.addToInventory.run(guildId, userId, itemId, quantity);
    return { ok: true, item };
  });
}

/** Macht reservePurchase rückgängig (z.B. wenn die Geldbuchung fehlschlägt). */
function releasePurchase(guildId, userId, itemId, quantity, hadStock) {
  transaction(() => {
    stmt.removeFromInventory.run(quantity, guildId, userId, itemId);
    stmt.pruneInventory.run();
    if (hadStock) stmt.giveStock.run(quantity, itemId);
  });
}

/** Ein Artikel aus dem Besitz eines Users – null, wenn er ihn nicht hat. */
function getOwned(guildId, userId, itemId) {
  return stmt.getOwned.get(guildId, userId, itemId) ?? null;
}

/** Der teuerste Artikel im Besitz eines Users (für /showcase ohne Angabe). */
function getMostValuable(guildId, userId) {
  return stmt.getMostValuable.get(guildId, userId) ?? null;
}

/** Gesamtwert aller Artikel eines Users. */
function garageValue(guildId, userId) {
  return stmt.totalGarageValue.get(guildId, userId).value;
}

/** Kaufwert aller eigenen Immobilien eines Users. */
function propertyValue(guildId, userId) {
  return stmt.totalPropertyValue.get(guildId, userId).value;
}

// ------------------------------------------------------- Spielerstatistik

/**
 * Schreibt Erfahrung sowie Ein-/Ausgaben eines Users fort (alles additiv).
 * @param {{xp?: number, income?: number, expense?: number}} delta
 */
function addStats(guildId, userId, { xp = 0, income = 0, expense = 0 } = {}) {
  stmt.addStats.run(guildId, userId, Math.round(xp), Math.round(income), Math.round(expense));
}

/** Statistik eines Users – nie null, fehlende Zeilen zählen als 0. */
function getStats(guildId, userId) {
  return stmt.getStats.get(guildId, userId)
    ?? { guild_id: guildId, user_id: userId, xp: 0, income_total: 0, expense_total: 0, tagline: '' };
}

/** Alle Spieler mit Statistik auf diesem Server – die Leaderboard-Teilnehmer. */
function listStats(guildId) {
  return stmt.listStats.all(guildId);
}

/** Setzt den Angeber-Spruch fürs Profil. */
function setTagline(guildId, userId, text) {
  stmt.setTagline.run(guildId, userId, text);
}

// ----------------------------------------------------------- Storage-Wars

/** Die aktuell laufende Auktionsrunde, oder null. */
function activeRound(guildId, now = Date.now()) {
  return stmt.activeRound.get(guildId, now) ?? null;
}

/** Die jüngste Runde (egal ob beendet) – für die Pausen-Berechnung. */
function latestRound(guildId) {
  return stmt.latestRound.get(guildId) ?? null;
}

function insertRound(guildId, startedAt, endsAt, size) {
  return stmt.insertRound.get(guildId, startedAt, endsAt, size);
}

/** @param lot {guildId,roundId,seq,tier,seller,hint,peek,startPrice,contents,value,opensAt,endsAt} */
function insertLot(lot) {
  return parseLot(stmt.insertLot.get(
    lot.guildId, lot.roundId, lot.seq, lot.tier, lot.seller ?? '', lot.hint ?? '',
    lot.peek ?? '', lot.startPrice, JSON.stringify(lot.contents), lot.value,
    lot.opensAt, lot.endsAt));
}

/** contents ist als JSON abgelegt – hier geparst zurückgeben. */
function parseLot(row) {
  return { ...row, contents: JSON.parse(row.contents) };
}

function listRoundLots(guildId, roundId) {
  return stmt.listRoundLots.all(guildId, roundId).map(parseLot);
}

function getLot(guildId, lotId) {
  const row = stmt.getLot.get(guildId, lotId);
  return row ? parseLot(row) : null;
}

/** Gebot setzen – nur wenn Los live und Gebot höher (atomar). true = angenommen. */
function placeBid(guildId, lotId, amount, bidderId, now = Date.now()) {
  return stmt.placeBid.run(amount, bidderId, lotId, guildId, now, now, amount).changes > 0;
}

/** Fälliges Los für die Abrechnung reservieren; true nur beim ersten Beanspruchen. */
function claimLot(guildId, lotId) {
  return stmt.claimLot.run(lotId, guildId).changes > 0;
}

function finishLot(guildId, lotId, status) {
  return stmt.finishLot.run(status, lotId, guildId).changes > 0;
}

/** Alle abgelaufenen, noch offenen Lose – in Sequenzreihenfolge. */
function dueLots(guildId, now = Date.now()) {
  return stmt.dueLots.all(guildId, now).map(parseLot);
}

function purgeOldLots(guildId, before) {
  return stmt.purgeOldLots.run(guildId, before).changes;
}

function addLoot(guildId, userId, name, value, lotId = null) {
  return stmt.addLoot.get(guildId, userId, name, value, lotId, Date.now());
}

function listLoot(guildId, userId) {
  return stmt.listLoot.all(guildId, userId);
}

/** Anzahl und Gesamt-Schätzwert der Sammlung. */
function lootSummary(guildId, userId) {
  return stmt.lootSummary.get(guildId, userId);
}

function getLoot(guildId, lootId) {
  return stmt.getLoot.get(guildId, lootId) ?? null;
}

function removeLoot(guildId, userId, lootId) {
  return stmt.removeLoot.run(guildId, userId, lootId).changes > 0;
}

function clearLoot(guildId, userId) {
  return stmt.clearLoot.run(guildId, userId).changes;
}

/** Räumt alle Auktions-Daten eines Servers weg (Reset/Tests). */
function clearStorage(guildId) {
  return transaction(() => {
    stmt.deleteLots.run(guildId);
    stmt.deleteRounds.run(guildId);
    stmt.deleteLoot.run(guildId);
    return true;
  });
}

/**
 * Übereignet ein gefundenes Auto, OHNE den Katalog-Bestand anzufassen –
 * ein Fund ist kein Kauf. Erwartet, dass der Spieler das Modell noch nicht hat.
 */
function grantCar(guildId, userId, itemId, condition = 100) {
  return transaction(() => {
    stmt.addToInventory.run(guildId, userId, itemId, 1);
    stmt.setCondition.run(
      Math.min(100, Math.max(0, Math.round(condition))), guildId, userId, itemId);
    return true;
  });
}

// ---------------------------------------------------------------- Gebrauchtmarkt

const MAX_LISTINGS_PER_USER = 10;

/** @param {'car'|'property'} kind Welche Art von Inseraten. */
function listListings(guildId, page = 1, kind = 'car') {
  const total = stmt.countListings.get(guildId, kind).n;
  const items = stmt.listListings.all(guildId, kind, PAGE_SIZE, (page - 1) * PAGE_SIZE);
  return { items, total, totalPages: Math.max(1, Math.ceil(total / PAGE_SIZE)), page, kind };
}

/** Alle Inserate einer Art – für den zusammengeführten Immobilienmarkt. */
function allListingsOfKind(guildId, kind) {
  return stmt.allListingsOfKind.all(guildId, kind);
}

function getListing(guildId, listingId) {
  return stmt.getListing.get(guildId, listingId) ?? null;
}

/**
 * Stellt ein Auto aus der Garage in den Gebrauchtmarkt.
 * Das Auto verlässt dabei die Garage (Treuhand), damit es nicht
 * gleichzeitig verkauft und behalten werden kann.
 */
function createListing(guildId, sellerId, itemId, price) {
  return transaction(() => {
    const owned = stmt.getOwned.get(guildId, sellerId, itemId);
    if (!owned) return { ok: false, reason: 'not_owned' };

    // Autos und Immobilien lassen sich weiterverkaufen, Ausrüstung nicht –
    // ein gebrauchter Führerschein ergibt keinen Sinn.
    if (owned.kind !== 'car' && owned.kind !== 'property') {
      return { ok: false, reason: 'wrong_kind', item: owned };
    }

    // Eine bewohnte Immobilie lässt sich nicht verkaufen – sonst stünde der
    // Mieter plötzlich bei einem fremden Eigentümer.
    if (owned.kind === 'property' && stmt.hasTenant.get(guildId, itemId).n > 0) {
      return { ok: false, reason: 'has_tenant', item: owned };
    }

    if (stmt.countUserListings.get(guildId, sellerId).n >= MAX_LISTINGS_PER_USER) {
      return { ok: false, reason: 'too_many_listings', max: MAX_LISTINGS_PER_USER };
    }

    stmt.removeFromInventory.run(1, guildId, sellerId, itemId);
    stmt.pruneInventory.run();
    // Zustand mit ins Inserat nehmen – im Inventar ist er gleich weg.
    const listing = stmt.insertListing.get(
      guildId, itemId, sellerId, price, Date.now(), owned.condition ?? 100);
    return { ok: true, listing, item: owned };
  });
}

/** Nimmt ein Inserat zurück – das Auto wandert zurück in die Garage. */
function cancelListing(guildId, sellerId, listingId) {
  return transaction(() => {
    const listing = stmt.getListing.get(guildId, listingId);
    if (!listing) return { ok: false, reason: 'not_found' };
    if (listing.seller_id !== sellerId) return { ok: false, reason: 'not_seller' };

    stmt.deleteListing.run(guildId, listingId);
    stmt.addToInventory.run(guildId, sellerId, listing.id, 1);
    // Zustand aus dem Inserat zurückschreiben.
    stmt.setCondition.run(listing.listing_condition ?? 100, guildId, sellerId, listing.id);
    return { ok: true, listing };
  });
}

/**
 * Übereignet ein inseriertes Auto an den Käufer und entfernt das Inserat.
 * Wird VOR der Geldbuchung aufgerufen, damit ein Fehlschlag lokal
 * zurückgerollt werden kann.
 */
function takeListing(guildId, buyerId, listingId) {
  return transaction(() => {
    const listing = stmt.getListing.get(guildId, listingId);
    if (!listing) return { ok: false, reason: 'not_found' };

    stmt.deleteListing.run(guildId, listingId);
    stmt.addToInventory.run(guildId, buyerId, listing.id, 1);
    // Der Käufer übernimmt den Wagen im inserierten Zustand.
    stmt.setCondition.run(listing.listing_condition ?? 100, guildId, buyerId, listing.id);
    return { ok: true, listing };
  });
}

/** Macht takeListing rückgängig (Auto zurück, Inserat wieder da). */
function restoreListing(guildId, buyerId, listing) {
  transaction(() => {
    stmt.removeFromInventory.run(1, guildId, buyerId, listing.id);
    stmt.pruneInventory.run();
    stmt.insertListing.get(
      guildId, listing.id, listing.seller_id, listing.listing_price, listing.created_at,
      listing.listing_condition ?? 100);
  });
}

module.exports = {
  listItems, listBrands, getItem, createItem, deleteItem, updateItemImage, allItemsOfKind,
  listInventory, reservePurchase, releasePurchase,
  getOwned, getMostValuable, garageValue, propertyValue, ownsNamed, bestCarValue,
  addStats, getStats, listStats, setTagline,
  transaction,
  activeRound, latestRound, insertRound, insertLot, listRoundLots, getLot, placeBid, claimLot,
  finishLot, dueLots, purgeOldLots,
  addLoot, listLoot, lootSummary, getLoot, removeLoot, clearLoot, clearStorage, grantCar,
  listListings, allListingsOfKind, getListing, createListing, cancelListing,
  takeListing, restoreListing,
  getEmployment, setEmployment, clearEmployment, recordShift, shiftsToday, consumeNamed,
  ownedGarageSlots, carsOwned, listOwnedProperties, ownedOfKind,
  getRental, startRental, endRental, extendRental, countRentersOf,
  createOffer, deleteOffer, getOffer, listOffers, listOffersOf, offerTaken, tenantsOf,
  tenantOfOffer, setTenantName, touchOffer,
  getGrace, startGrace, clearGrace, randomCars, removeCar,
  insertNpcListing, listNpcListings, getNpcListing, deleteNpcListing,
  purgeExpiredNpc, countNpcListings, npcItemIds, getNpcSpawn, setNpcSpawn, clearNpcSpawn,
  createMessage, listMessages, countUnread, getMessage, resolveMessage,
  markMessagesRead, expireMessages, cancelOffersFor, ownListings, touchListing,
  getGame, setGame, updateGame, clearGame,
  setCondition, carsByValue, getStreetWatch, setStreetWatch,
  PAGE_SIZE, MAX_LISTINGS_PER_USER,
};
