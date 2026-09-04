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

  -- Ersteigerte, aber NOCH VERSCHLOSSENE Garagen. Der Inhalt bleibt versteckt,
  -- bis der Spieler die Garage aktiv öffnet (dann wird contents aufgelöst).
  CREATE TABLE IF NOT EXISTS storage_garages (
    id       INTEGER PRIMARY KEY AUTOINCREMENT,
    guild_id TEXT    NOT NULL,
    user_id  TEXT    NOT NULL,
    label    TEXT    NOT NULL,
    price    INTEGER NOT NULL,
    contents TEXT    NOT NULL,
    value    INTEGER NOT NULL,
    won_at   INTEGER NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_garages_user ON storage_garages (guild_id, user_id, won_at);
`);

// Fluxer-Menüs: Welche Reaktion einer Nachricht löst welche Aktion aus.
// Fluxer kennt keine Buttons, also merken wir uns die Zuordnung hier – dadurch
// funktionieren offene Menüs auch nach einem Neustart weiter (wie die
// zustandslosen Button-IDs im Discord-Original, ARCHITEKTUR §6).
db.exec(`
  CREATE TABLE IF NOT EXISTS fluxer_views (
    message_id TEXT PRIMARY KEY,
    user_id    TEXT NOT NULL,
    channel_id TEXT NOT NULL DEFAULT '',
    mapping    TEXT NOT NULL,
    updated_at INTEGER NOT NULL
  );
`);

// Börse: Kurse, Depots und Schlagzeilen.
//
// Die Kurse gehören der WELT, nicht dem Spieler – alle sehen dieselben. Sie
// werden faul fortgeschrieben (siehe wallstreet.js): Beim Öffnen der Börse
// werden die seit dem letzten Mal vergangenen Stunden nachsimuliert.
db.exec(`
  CREATE TABLE IF NOT EXISTS market_prices (
    guild_id  TEXT    NOT NULL,
    symbol    TEXT    NOT NULL,
    price     INTEGER NOT NULL,
    tick      INTEGER NOT NULL,        -- bis hierhin simuliert
    listed_at INTEGER NOT NULL,
    PRIMARY KEY (guild_id, symbol)
  );
`);

// Zustand des Gesamtmarktes: eine Welt, eine Uhr, eine Stimmung.
// `vol` ist die aktuelle Nervosität (1 = normal) und wandert langsam – daher
// gibt es ruhige Wochen und hektische Tage, statt immer gleich viel Zappeln.
db.exec(`
  CREATE TABLE IF NOT EXISTS market_state (
    guild_id TEXT    PRIMARY KEY,
    vol      REAL    NOT NULL,
    tick     INTEGER NOT NULL
  );
`);

// Kursverlauf für die Anzeige (Sparkline, Tagesveränderung). Alte Ticks
// werden gekappt – niemand braucht den Kurs von vorletzter Woche.
db.exec(`
  CREATE TABLE IF NOT EXISTS market_history (
    guild_id TEXT    NOT NULL,
    symbol   TEXT    NOT NULL,
    tick     INTEGER NOT NULL,
    price    INTEGER NOT NULL,
    PRIMARY KEY (guild_id, symbol, tick)
  );
`);

// Depot: wie viele Stücke jemand hält und was er dafür bezahlt hat.
// `invested` ist die Summe der Kaufpreise OHNE Gebühr – daraus wird der
// Einstandskurs und damit Gewinn/Verlust berechnet.
db.exec(`
  CREATE TABLE IF NOT EXISTS market_holdings (
    guild_id TEXT    NOT NULL,
    user_id  TEXT    NOT NULL,
    symbol   TEXT    NOT NULL,
    shares   INTEGER NOT NULL,
    invested INTEGER NOT NULL,
    PRIMARY KEY (guild_id, user_id, symbol)
  );
`);

// Schlagzeilen. Sie entstehen NACH einer Bewegung und erklären sie nur –
// eine Vorhersage wäre ein garantierter Gewinn (ARCHITEKTUR §3).
db.exec(`
  CREATE TABLE IF NOT EXISTS market_news (
    id       INTEGER PRIMARY KEY AUTOINCREMENT,
    guild_id TEXT    NOT NULL,
    symbol   TEXT    NOT NULL,
    tick     INTEGER NOT NULL,
    headline TEXT    NOT NULL,
    change   REAL    NOT NULL,
    at       INTEGER NOT NULL
  );
`);

// Webhooks der Kanal-Brücke: Damit eine gespiegelte Nachricht drüben mit
// NAME UND AVATAR des Absenders erscheint, wird sie über einen Webhook
// gesendet. Dessen Token gibt es nur EINMAL – beim Anlegen. Fluxer gibt ihn
// beim späteren Abrufen nicht mehr heraus ("fetched webhooks cannot execute"),
// also muss er hier liegen, sonst bräuchte jeder Neustart einen neuen Webhook.
db.exec(`
  CREATE TABLE IF NOT EXISTS relay_webhooks (
    platform   TEXT NOT NULL,          -- 'discord' | 'fluxer'
    channel_id TEXT NOT NULL,
    webhook_id TEXT NOT NULL,
    token      TEXT NOT NULL,
    created_at INTEGER NOT NULL,
    PRIMARY KEY (platform, channel_id)
  );
`);

// Kontoverknüpfung (duo-Branch): Ein Spieler soll auf Discord UND Fluxer
// denselben Fortschritt haben. Dafür wird jede Plattform-Identität auf EIN
// kanonisches Konto abgebildet – siehe src/identity.js.
db.exec(`
  CREATE TABLE IF NOT EXISTS account_links (
    platform   TEXT NOT NULL,          -- 'discord' | 'fluxer'
    user_id    TEXT NOT NULL,          -- ID auf dieser Plattform
    account_id TEXT NOT NULL,          -- kanonisches Konto (= Discord-ID)
    linked_at  INTEGER NOT NULL,
    PRIMARY KEY (platform, user_id)
  );
  CREATE INDEX IF NOT EXISTS idx_links_account ON account_links (account_id);

  -- Anzeigenamen je Konto. Auf Fluxer lassen sich Discord-Erwähnungen nicht
  -- darstellen, deshalb wird dort stattdessen der Name gezeigt.
  CREATE TABLE IF NOT EXISTS account_names (
    account_id TEXT PRIMARY KEY,
    name       TEXT NOT NULL,
    updated_at INTEGER NOT NULL
  );
`);

// ------------------------------------------------------------- STAATSKASSE
// Ein serverweiter Topf, der bei JEDER Geldbuchung mitverdient: 19 % auf
// Ausgaben (Mehrwertsteuer), 40 % auf Einnahmen (Einkommensteuer).
//
// Wichtig: Diese Anteile werden dem Spieler NICHT abgezogen – sie werden aus
// dem Betrag nur berechnet und hier zusätzlich abgelegt. Deshalb ist das kein
// Gelddrucker im Sinne von ARCHITEKTUR §3: aus der Kasse fließt nichts an
// Spieler zurück, sie ist eine reine Senke/Statistik (siehe src/treasury.js).
db.exec(`
  CREATE TABLE IF NOT EXISTS treasury (
    guild_id    TEXT    PRIMARY KEY,
    balance     INTEGER NOT NULL DEFAULT 0,   -- Stand der Kasse
    vat_total   INTEGER NOT NULL DEFAULT 0,   -- davon aus Ausgaben (19 %)
    tax_total   INTEGER NOT NULL DEFAULT 0,   -- davon aus Einnahmen (40 %)
    spend_base  INTEGER NOT NULL DEFAULT 0,   -- Bemessungsgrundlage Ausgaben
    income_base INTEGER NOT NULL DEFAULT 0,   -- Bemessungsgrundlage Einnahmen
    bookings    INTEGER NOT NULL DEFAULT 0,
    started_at  INTEGER NOT NULL,
    updated_at  INTEGER NOT NULL
  );

  -- Aufteilung auf die Wohnsitzländer der Spieler. Der Welttopf oben bleibt
  -- die Gesamtsumme; hier steht, welcher Staat davon was abbekommen hat.
  -- Buchungen aus der Zeit vor der Aufteilung sind keinem Land zugeordnet –
  -- die Summe der Länder ist deshalb kleiner als der Welttopf.
  CREATE TABLE IF NOT EXISTS treasury_countries (
    guild_id    TEXT    NOT NULL,
    country     TEXT    NOT NULL,          -- '' = Spieler ohne Heimat
    balance     INTEGER NOT NULL DEFAULT 0,
    vat_total   INTEGER NOT NULL DEFAULT 0,
    tax_total   INTEGER NOT NULL DEFAULT 0,
    spend_base  INTEGER NOT NULL DEFAULT 0,
    income_base INTEGER NOT NULL DEFAULT 0,
    bookings    INTEGER NOT NULL DEFAULT 0,
    updated_at  INTEGER NOT NULL DEFAULT 0,
    PRIMARY KEY (guild_id, country)
  );

  -- Woher das Geld kommt (Käufe, Arbeit, Börse …). Getrennt nach Art, damit
  -- sich Mehrwert- und Einkommensteuer je Bereich vergleichen lassen.
  CREATE TABLE IF NOT EXISTS treasury_sources (
    guild_id TEXT    NOT NULL,
    source   TEXT    NOT NULL,
    kind     TEXT    NOT NULL,               -- 'vat' | 'tax'
    amount   INTEGER NOT NULL DEFAULT 0,
    base     INTEGER NOT NULL DEFAULT 0,
    bookings INTEGER NOT NULL DEFAULT 0,
    PRIMARY KEY (guild_id, source, kind)
  );

  -- Wer wie viel beigetragen hat. Reine Statistik – auch hier zahlt niemand
  -- wirklich etwas, es ist der auf ihn entfallende Anteil.
  CREATE TABLE IF NOT EXISTS treasury_payers (
    guild_id   TEXT    NOT NULL,
    account_id TEXT    NOT NULL,
    amount     INTEGER NOT NULL DEFAULT 0,
    vat        INTEGER NOT NULL DEFAULT 0,
    tax        INTEGER NOT NULL DEFAULT 0,
    bookings   INTEGER NOT NULL DEFAULT 0,
    PRIMARY KEY (guild_id, account_id)
  );

  -- Die letzten Zuflüsse für die Anzeige. Wird gekappt (siehe LOG_KEEP).
  CREATE TABLE IF NOT EXISTS treasury_log (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    guild_id   TEXT    NOT NULL,
    account_id TEXT    NOT NULL,
    kind       TEXT    NOT NULL,
    base       INTEGER NOT NULL,
    amount     INTEGER NOT NULL,
    source     TEXT    NOT NULL DEFAULT '',
    reason     TEXT    NOT NULL DEFAULT '',
    at         INTEGER NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_treasury_log ON treasury_log (guild_id, id);
`);

// ------------------------------------------------------------- CREATOR
// Vier Plattformen (Twitch, YouTube, Instagram, Twitter) mit je eigenem
// Publikum – eine Zeile je Spieler UND Plattform. Der Zustand ist dauerhaft:
// Reichweite wächst über viele Aktionen und schrumpft, wenn man sie liegen
// lässt (siehe src/creator.js).
//
// `hype`  Form der letzten Aktionen (Momentum)
// `stock` unbezahlte Katalog-Reichweite – YouTube-Videos werden noch tagelang
//         geklickt und über `stock_paid_through` faul abgerechnet (§4).
// `touched_at` letzte Berührung – Aktion ODER Übertrag von einer anderen
//         Plattform. Daran hängt der Verfall: Ohne diesen Zeitstempel würde
//         eine liegengelassene Plattform nie schrumpfen, weil der Verfall
//         erst bei der nächsten Aktion gerechnet wird – Reichweite ließe sich
//         auf einem Kanal parken, den man nie wieder anfasst.
db.exec(`
  CREATE TABLE IF NOT EXISTS creator_channels (
    guild_id           TEXT    NOT NULL,
    user_id            TEXT    NOT NULL,
    platform           TEXT    NOT NULL,
    followers          INTEGER NOT NULL DEFAULT 0,
    subs               INTEGER NOT NULL DEFAULT 0,
    hype               REAL    NOT NULL DEFAULT 1,
    actions            INTEGER NOT NULL DEFAULT 0,
    views_total        INTEGER NOT NULL DEFAULT 0,
    earned_total       INTEGER NOT NULL DEFAULT 0,
    peak_audience      INTEGER NOT NULL DEFAULT 0,
    peak_followers     INTEGER NOT NULL DEFAULT 0,
    last_action_at     INTEGER NOT NULL DEFAULT 0,
    touched_at         INTEGER NOT NULL DEFAULT 0,
    locked_until       INTEGER NOT NULL DEFAULT 0,
    stock              REAL    NOT NULL DEFAULT 0,
    stock_paid_through INTEGER NOT NULL DEFAULT 0,
    last_title         TEXT    NOT NULL DEFAULT '',
    created_at         INTEGER NOT NULL,
    PRIMARY KEY (guild_id, user_id, platform)
  );
  CREATE INDEX IF NOT EXISTS idx_creator_reach
    ON creator_channels (guild_id, platform, followers);
`);

// Spalten nachrüsten, ohne bestehende Kanäle zu verlieren.
const creatorColumns = new Set(
  db.prepare('PRAGMA table_info(creator_channels)').all().map((c) => c.name));
for (const [column, definition] of [
  ['touched_at', 'INTEGER NOT NULL DEFAULT 0'],
  ['last_title', "TEXT NOT NULL DEFAULT ''"],
  ['locked_until', 'INTEGER NOT NULL DEFAULT 0'],
]) {
  if (!creatorColumns.has(column)) {
    db.exec(`ALTER TABLE creator_channels ADD COLUMN ${column} ${definition}`);
  }
}

// Was sich ein Creator mit sich selbst teilt, nicht mit der Plattform:
// das Tagesbudget an Zeit, der Promo-Schub aus dem letzten Tweet und die
// Community-Bindung (senkt den Schwund überall).
db.exec(`
  CREATE TABLE IF NOT EXISTS creator_state (
    guild_id     TEXT    NOT NULL,
    user_id      TEXT    NOT NULL,
    day          TEXT    NOT NULL DEFAULT '',
    time_used    INTEGER NOT NULL DEFAULT 0,
    boost        REAL    NOT NULL DEFAULT 0,
    boost_until  INTEGER NOT NULL DEFAULT 0,
    community    REAL    NOT NULL DEFAULT 0,
    community_at INTEGER NOT NULL DEFAULT 0,
    fatigue      REAL    NOT NULL DEFAULT 0,
    fatigue_at   INTEGER NOT NULL DEFAULT 0,
    merch_at     INTEGER NOT NULL DEFAULT 0,
    language     TEXT    NOT NULL DEFAULT '',
    language_at  INTEGER NOT NULL DEFAULT 0,
    created_at   INTEGER NOT NULL,
    PRIMARY KEY (guild_id, user_id)
  );
`);

// Spalten nachrüsten (Erschöpfung und Merch kamen später dazu).
const creatorStateColumns = new Set(
  db.prepare('PRAGMA table_info(creator_state)').all().map((c) => c.name));
for (const [column, definition] of [
  ['fatigue', 'REAL NOT NULL DEFAULT 0'],
  ['fatigue_at', 'INTEGER NOT NULL DEFAULT 0'],
  ['merch_at', 'INTEGER NOT NULL DEFAULT 0'],
  ['language', "TEXT NOT NULL DEFAULT ''"],
  ['language_at', 'INTEGER NOT NULL DEFAULT 0'],
]) {
  if (!creatorStateColumns.has(column)) {
    db.exec(`ALTER TABLE creator_state ADD COLUMN ${column} ${definition}`);
  }
}

// Vorfälle mit Entscheidung: Ein Ereignis liegt offen, bis der Spieler wählt
// oder die Frist abläuft. Zustand gehört in die Datenbank, damit eine offene
// Entscheidung einen Neustart überlebt – sonst wäre Wegklicken die beste
// Strategie.
db.exec(`
  CREATE TABLE IF NOT EXISTS creator_events (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    guild_id   TEXT    NOT NULL,
    user_id    TEXT    NOT NULL,
    kind       TEXT    NOT NULL,            -- ID aus data/decisions.js
    platform   TEXT    NOT NULL DEFAULT '', -- leer = netzwerkweit
    status     TEXT    NOT NULL,            -- open | done | expired
    choice     TEXT    NOT NULL DEFAULT '',
    outcome    TEXT    NOT NULL DEFAULT '',
    effect     TEXT    NOT NULL DEFAULT '', -- angewandte Wirkung als JSON
    created_at INTEGER NOT NULL,
    expires_at INTEGER NOT NULL,
    decided_at INTEGER
  );
  CREATE INDEX IF NOT EXISTS idx_creator_events
    ON creator_events (guild_id, user_id, status);
`);

// Sponsorenverträge: Eine Marke zahlt für eine vereinbarte Zahl von Beiträgen
// innerhalb einer Frist. Wer liefert, kassiert; wer die Frist reißt, zahlt
// Vertragsstrafe. Angebote verfallen von selbst.
db.exec(`
  CREATE TABLE IF NOT EXISTS creator_deals (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    guild_id    TEXT    NOT NULL,
    user_id     TEXT    NOT NULL,
    brand       TEXT    NOT NULL,
    emoji       TEXT    NOT NULL DEFAULT '',
    platform    TEXT    NOT NULL,
    format      TEXT    NOT NULL DEFAULT '',   -- leer = jedes Format zählt
    quota       INTEGER NOT NULL,
    done        INTEGER NOT NULL DEFAULT 0,
    payout      INTEGER NOT NULL,
    penalty     INTEGER NOT NULL DEFAULT 0,
    status      TEXT    NOT NULL,              -- offer|active|done|failed|expired
    created_at  INTEGER NOT NULL,
    expires_at  INTEGER NOT NULL,
    accepted_at INTEGER,
    deadline    INTEGER
  );
  CREATE INDEX IF NOT EXISTS idx_creator_deals
    ON creator_deals (guild_id, user_id, status);
`);

// Die erste Fassung kannte nur Twitch (Tabelle `channels`, ein Eintrag je
// Spieler). Sie wird nicht gelöscht, sondern beiseitegelegt – falls doch
// irgendwo Daten darin liegen, sind sie nicht weg.
const legacyChannels = db.prepare(
  "SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'channels'").get();
if (legacyChannels) {
  const cols = new Set(db.prepare('PRAGMA table_info(channels)').all().map((c) => c.name));
  if (!cols.has('platform')) db.exec('ALTER TABLE channels RENAME TO channels_v1');
}

// ---------------------------------------------------------------- WALLET
// Eigene Wirtschaft (Fluxer-Branch): Auf Fluxer gibt es kein UnbelievaBoat,
// deshalb liegt das Geld hier. Struktur bewusst wie bei UnbelievaBoat –
// Bargeld und Bank getrennt –, damit src/unb.js ein reiner Austausch bleibt
// und die gesamte Spiellogik unverändert weiterläuft.
db.exec(`
  CREATE TABLE IF NOT EXISTS wallets (
    guild_id   TEXT    NOT NULL,
    user_id    TEXT    NOT NULL,
    cash       INTEGER NOT NULL DEFAULT 0,
    bank       INTEGER NOT NULL DEFAULT 0,
    created_at INTEGER NOT NULL,
    PRIMARY KEY (guild_id, user_id)
  );

  -- Ersetzt das UnbelievaBoat-Transaktionslog: jede Buchung mit Grund.
  CREATE TABLE IF NOT EXISTS wallet_log (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    guild_id   TEXT    NOT NULL,
    user_id    TEXT    NOT NULL,
    amount     INTEGER NOT NULL,
    reason     TEXT    NOT NULL DEFAULT '',
    created_at INTEGER NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_wallet_log ON wallet_log (guild_id, user_id, created_at);

  -- Cooldowns für wiederkehrende Einkommensbefehle (!daily …).
  CREATE TABLE IF NOT EXISTS income_claims (
    guild_id   TEXT    NOT NULL,
    user_id    TEXT    NOT NULL,
    kind       TEXT    NOT NULL,
    claimed_at INTEGER NOT NULL,
    PRIMARY KEY (guild_id, user_id, kind)
  );
`);

// Heimat: In welchem Land der Spieler lebt und wie oft er schon umgezogen
// ist. Beides hängt am Spieler, nicht am Kanal – der Umzug betrifft ja auch
// Wohnung und Stellplätze (siehe src/home.js).
const homeColumns = new Set(
  db.prepare('PRAGMA table_info(player_stats)').all().map((c) => c.name));
for (const [column, definition] of [
  ['home_country', "TEXT NOT NULL DEFAULT ''"],
  ['moves', 'INTEGER NOT NULL DEFAULT 0'],
  ['home_at', 'INTEGER NOT NULL DEFAULT 0'],
]) {
  if (!homeColumns.has(column)) {
    db.exec(`ALTER TABLE player_stats ADD COLUMN ${column} ${definition}`);
  }
}

// In welchem Land ein Besitz steht. Immobilien im Ausland bleiben dein
// Eigentum und behalten ihren Wert – Wohnen und Parken kann man darin aber
// nicht mehr, wenn man weggezogen ist. Leer = "war schon immer da", zählt
// deshalb als Inland (Bestandsdaten).
const inventoryCountry = new Set(
  db.prepare('PRAGMA table_info(inventory)').all().map((c) => c.name));
if (!inventoryCountry.has('country')) {
  db.exec("ALTER TABLE inventory ADD COLUMN country TEXT NOT NULL DEFAULT ''");
}

// Zuletzt gesehene Patchnotes-Version nachrüsten ('' = noch nie welche gesehen).
const statsColumns = new Set(
  db.prepare('PRAGMA table_info(player_stats)').all().map((c) => c.name));
if (!statsColumns.has('seen_version')) {
  db.exec("ALTER TABLE player_stats ADD COLUMN seen_version TEXT NOT NULL DEFAULT ''");
}

// Seltenheit & Zustand an Fundstücken nachrüsten (für Anzeige/Flex).
const lootColumns = new Set(
  db.prepare('PRAGMA table_info(storage_loot)').all().map((c) => c.name));
for (const [column, definition] of [
  ['rarity', "TEXT NOT NULL DEFAULT ''"],
  ['condition', "TEXT NOT NULL DEFAULT ''"],
]) {
  if (!lootColumns.has(column)) db.exec(`ALTER TABLE storage_loot ADD COLUMN ${column} ${definition}`);
}

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
  // Beförderungen werden gewürfelt, nicht erreicht – der Rang muss also
  // gespeichert werden. `rank_at` merkt sich die Schichtzahl beim letzten
  // Aufstieg; daraus ergibt sich die wachsende Chance (siehe ranks.js).
  ['rank', 'INTEGER NOT NULL DEFAULT 0'],
  ['rank_at', 'INTEGER NOT NULL DEFAULT 0'],
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
       AND (inv.country = ? OR inv.country = '')
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
    `SELECT i.*, inv.quantity, inv.condition, inv.country
     FROM inventory inv JOIN items i ON i.id = inv.item_id
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
  // Eine Nachricht wegräumen. Rechnungen sind ausgenommen: sie sind Schulden,
  // die sich nicht per Klick wegwischen lassen dürfen (der Filter steckt
  // bewusst im SQL, damit ihn kein Aufrufer vergessen kann).
  deleteMessage: db.prepare(
    `UPDATE messages SET resolved = 'deleted'
     WHERE guild_id = ? AND user_id = ? AND id = ? AND resolved IS NULL AND type <> 'bill'`),
  clearMessages: db.prepare(
    `UPDATE messages SET resolved = 'deleted'
     WHERE guild_id = ? AND user_id = ? AND resolved IS NULL AND type <> 'bill'`),
  countDeletable: db.prepare(
    `SELECT COUNT(*) AS n FROM messages
     WHERE guild_id = ? AND user_id = ? AND resolved IS NULL AND type <> 'bill'`),

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
  clearStreetWatch: db.prepare('DELETE FROM street_watch WHERE guild_id = ? AND user_id = ?'),
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
                   last_work_at = 0, shifts = 0, earned = 0, rank = 0, rank_at = 0`),
  clearEmployment: db.prepare('DELETE FROM employment WHERE guild_id = ? AND user_id = ?'),
  promote: db.prepare(
    `UPDATE employment SET rank = ?, rank_at = ? WHERE guild_id = ? AND user_id = ?`),
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
  // Werkstatt: nur Autos unter Neuzustand, die schlimmsten zuerst –
  // dort ist der Handlungsbedarf am größten.
  listDamaged: db.prepare(
    `SELECT i.*, inv.quantity, inv.condition
     FROM inventory inv JOIN items i ON i.id = inv.item_id
     WHERE inv.guild_id = ? AND inv.user_id = ? AND inv.quantity > 0
       AND i.kind = 'car' AND inv.condition < 100
     ORDER BY inv.condition ASC, i.price DESC LIMIT ? OFFSET ?`),
  countDamaged: db.prepare(
    `SELECT COUNT(*) AS n FROM inventory inv JOIN items i ON i.id = inv.item_id
     WHERE inv.guild_id = ? AND inv.user_id = ? AND inv.quantity > 0
       AND i.kind = 'car' AND inv.condition < 100`),
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
  setSeenVersion: db.prepare(
    `INSERT INTO player_stats (guild_id, user_id, seen_version) VALUES (?, ?, ?)
     ON CONFLICT (guild_id, user_id) DO UPDATE SET seen_version = excluded.seen_version`),
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
    `INSERT INTO storage_loot (guild_id, user_id, name, value, rarity, condition, lot_id, found_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?) RETURNING *`),
  listLoot: db.prepare(
    `SELECT * FROM storage_loot WHERE guild_id = ? AND user_id = ?
     ORDER BY value DESC, found_at DESC`),
  lootSummary: db.prepare(
    `SELECT COALESCE(SUM(value), 0) AS value, COUNT(*) AS n
     FROM storage_loot WHERE guild_id = ? AND user_id = ?`),
  getLoot: db.prepare('SELECT * FROM storage_loot WHERE guild_id = ? AND id = ?'),
  removeLoot: db.prepare('DELETE FROM storage_loot WHERE guild_id = ? AND user_id = ? AND id = ?'),
  clearLoot: db.prepare('DELETE FROM storage_loot WHERE guild_id = ? AND user_id = ?'),
  // --- Fluxer-Menüzuordnung ---
  saveFluxerView: db.prepare(
    `INSERT INTO fluxer_views (message_id, user_id, channel_id, mapping, updated_at)
     VALUES (?, ?, ?, ?, ?)
     ON CONFLICT (message_id) DO UPDATE SET
       user_id = excluded.user_id, channel_id = excluded.channel_id,
       mapping = excluded.mapping, updated_at = excluded.updated_at`),
  getFluxerView: db.prepare('SELECT * FROM fluxer_views WHERE message_id = ?'),
  purgeFluxerViews: db.prepare('DELETE FROM fluxer_views WHERE updated_at < ?'),

  // --- Börse ---
  getMarketState: db.prepare('SELECT * FROM market_state WHERE guild_id = ?'),
  setMarketState: db.prepare(
    `INSERT INTO market_state (guild_id, vol, tick) VALUES (?, ?, ?)
     ON CONFLICT (guild_id) DO UPDATE SET vol = excluded.vol, tick = excluded.tick`),
  clearMarketState: db.prepare('DELETE FROM market_state WHERE guild_id = ?'),
  getPrice: db.prepare('SELECT * FROM market_prices WHERE guild_id = ? AND symbol = ?'),
  allPrices: db.prepare('SELECT * FROM market_prices WHERE guild_id = ?'),
  setPrice: db.prepare(
    `INSERT INTO market_prices (guild_id, symbol, price, tick, listed_at)
     VALUES (?, ?, ?, ?, ?)
     ON CONFLICT (guild_id, symbol) DO UPDATE SET
       price = excluded.price, tick = excluded.tick`),
  relist: db.prepare(
    `UPDATE market_prices SET price = ?, tick = ?, listed_at = ?
     WHERE guild_id = ? AND symbol = ?`),
  addHistory: db.prepare(
    `INSERT INTO market_history (guild_id, symbol, tick, price) VALUES (?, ?, ?, ?)
     ON CONFLICT (guild_id, symbol, tick) DO UPDATE SET price = excluded.price`),
  history: db.prepare(
    `SELECT tick, price FROM market_history
     WHERE guild_id = ? AND symbol = ? AND tick >= ? ORDER BY tick ASC`),
  purgeHistory: db.prepare(
    'DELETE FROM market_history WHERE guild_id = ? AND symbol = ? AND tick < ?'),
  clearHistoryOf: db.prepare('DELETE FROM market_history WHERE guild_id = ? AND symbol = ?'),

  getHolding: db.prepare(
    'SELECT * FROM market_holdings WHERE guild_id = ? AND user_id = ? AND symbol = ?'),
  holdingsOf: db.prepare(
    'SELECT * FROM market_holdings WHERE guild_id = ? AND user_id = ? AND shares > 0'),
  holdersOf: db.prepare(
    'SELECT * FROM market_holdings WHERE guild_id = ? AND symbol = ? AND shares > 0'),
  setHolding: db.prepare(
    `INSERT INTO market_holdings (guild_id, user_id, symbol, shares, invested)
     VALUES (?, ?, ?, ?, ?)
     ON CONFLICT (guild_id, user_id, symbol) DO UPDATE SET
       shares = excluded.shares, invested = excluded.invested`),
  dropHolding: db.prepare(
    'DELETE FROM market_holdings WHERE guild_id = ? AND user_id = ? AND symbol = ?'),
  pruneHoldings: db.prepare('DELETE FROM market_holdings WHERE shares <= 0'),

  addNews: db.prepare(
    `INSERT INTO market_news (guild_id, symbol, tick, headline, change, at)
     VALUES (?, ?, ?, ?, ?, ?)`),
  listNews: db.prepare(
    'SELECT * FROM market_news WHERE guild_id = ? ORDER BY tick DESC, id DESC LIMIT ?'),
  purgeNews: db.prepare('DELETE FROM market_news WHERE guild_id = ? AND tick < ?'),
  clearMarket: db.prepare('DELETE FROM market_prices WHERE guild_id = ?'),
  clearMarketHoldings: db.prepare('DELETE FROM market_holdings WHERE guild_id = ?'),
  clearMarketNews: db.prepare('DELETE FROM market_news WHERE guild_id = ?'),
  clearMarketHistory: db.prepare('DELETE FROM market_history WHERE guild_id = ?'),

  // --- Brücken-Webhooks ---
  setRelayWebhook: db.prepare(
    `INSERT INTO relay_webhooks (platform, channel_id, webhook_id, token, created_at)
     VALUES (?, ?, ?, ?, ?)
     ON CONFLICT (platform, channel_id) DO UPDATE SET
       webhook_id = excluded.webhook_id, token = excluded.token,
       created_at = excluded.created_at`),
  getRelayWebhook: db.prepare(
    'SELECT * FROM relay_webhooks WHERE platform = ? AND channel_id = ?'),
  deleteRelayWebhook: db.prepare(
    'DELETE FROM relay_webhooks WHERE platform = ? AND channel_id = ?'),
  allRelayWebhooks: db.prepare('SELECT * FROM relay_webhooks'),

  // --- Kontoverknüpfung ---
  getLink: db.prepare('SELECT * FROM account_links WHERE platform = ? AND user_id = ?'),
  setLink: db.prepare(
    `INSERT INTO account_links (platform, user_id, account_id, linked_at)
     VALUES (?, ?, ?, ?)
     ON CONFLICT (platform, user_id) DO UPDATE SET
       account_id = excluded.account_id, linked_at = excluded.linked_at`),
  deleteLink: db.prepare('DELETE FROM account_links WHERE platform = ? AND user_id = ?'),
  linksOf: db.prepare('SELECT * FROM account_links WHERE account_id = ?'),
  setAccountName: db.prepare(
    `INSERT INTO account_names (account_id, name, updated_at) VALUES (?, ?, ?)
     ON CONFLICT (account_id) DO UPDATE SET name = excluded.name, updated_at = excluded.updated_at`),
  getAccountName: db.prepare('SELECT name FROM account_names WHERE account_id = ?'),
  allAccountNames: db.prepare('SELECT account_id, name FROM account_names'),

  // --- Wallet (eigene Wirtschaft) ---
  getWallet: db.prepare('SELECT * FROM wallets WHERE guild_id = ? AND user_id = ?'),
  createWallet: db.prepare(
    `INSERT INTO wallets (guild_id, user_id, cash, bank, created_at) VALUES (?, ?, ?, ?, ?)
     ON CONFLICT (guild_id, user_id) DO NOTHING`),
  // Eine einzige Anweisung = atomar. Zwischen ihr und dem nächsten await kann
  // kein zweiter Klick dazwischenfunken (ARCHITEKTUR §7).
  addCash: db.prepare(
    'UPDATE wallets SET cash = cash + ? WHERE guild_id = ? AND user_id = ?'),
  // Bank -> Bar in EINER Anweisung: die Summe kann dabei nicht verloren gehen.
  moveToCash: db.prepare(
    'UPDATE wallets SET cash = cash + ?, bank = bank - ? WHERE guild_id = ? AND user_id = ?'),
  logWallet: db.prepare(
    `INSERT INTO wallet_log (guild_id, user_id, amount, reason, created_at)
     VALUES (?, ?, ?, ?, ?)`),
  walletLog: db.prepare(
    `SELECT * FROM wallet_log WHERE guild_id = ? AND user_id = ?
     ORDER BY created_at DESC LIMIT ?`),
  walletTop: db.prepare(
    `SELECT user_id, cash, bank, cash + bank AS total FROM wallets
     WHERE guild_id = ? ORDER BY total DESC LIMIT ?`),

  // --- Einkommens-Cooldowns (!daily …) ---
  getClaim: db.prepare(
    'SELECT * FROM income_claims WHERE guild_id = ? AND user_id = ? AND kind = ?'),
  setClaim: db.prepare(
    `INSERT INTO income_claims (guild_id, user_id, kind, claimed_at) VALUES (?, ?, ?, ?)
     ON CONFLICT (guild_id, user_id, kind) DO UPDATE SET claimed_at = excluded.claimed_at`),
  clearClaim: db.prepare(
    'DELETE FROM income_claims WHERE guild_id = ? AND user_id = ? AND kind = ?'),

  deleteRounds: db.prepare('DELETE FROM storage_rounds WHERE guild_id = ?'),
  deleteLots: db.prepare('DELETE FROM storage_lots WHERE guild_id = ?'),
  deleteLoot: db.prepare('DELETE FROM storage_loot WHERE guild_id = ?'),

  // --- Storage-Wars: verschlossene Garagen ---
  addGarage: db.prepare(
    `INSERT INTO storage_garages (guild_id, user_id, label, price, contents, value, won_at)
     VALUES (?, ?, ?, ?, ?, ?, ?) RETURNING *`),
  listGarages: db.prepare(
    'SELECT * FROM storage_garages WHERE guild_id = ? AND user_id = ? ORDER BY won_at ASC'),
  getGarage: db.prepare('SELECT * FROM storage_garages WHERE guild_id = ? AND id = ?'),
  removeGarage: db.prepare(
    'DELETE FROM storage_garages WHERE guild_id = ? AND user_id = ? AND id = ?'),
  countGarages: db.prepare(
    'SELECT COUNT(*) AS n FROM storage_garages WHERE guild_id = ? AND user_id = ?'),
  deleteGarages: db.prepare('DELETE FROM storage_garages WHERE guild_id = ?'),

  // --- Creator-Netzwerk ---
  getCreator: db.prepare(
    'SELECT * FROM creator_channels WHERE guild_id = ? AND user_id = ? AND platform = ?'),
  allCreator: db.prepare(
    'SELECT * FROM creator_channels WHERE guild_id = ? AND user_id = ?'),
  createCreator: db.prepare(
    `INSERT INTO creator_channels (guild_id, user_id, platform, created_at) VALUES (?, ?, ?, ?)
     ON CONFLICT (guild_id, user_id, platform) DO NOTHING`),
  // Eine Aktion = EINE Anweisung. Zwischen ihr und dem nächsten await kann kein
  // zweiter Klick dazwischenfunken (§7) – der findet den Cooldown vor.
  saveCreator: db.prepare(
    `UPDATE creator_channels SET
       followers = ?, subs = ?, hype = ?, actions = ?, views_total = ?,
       earned_total = ?, peak_audience = ?, peak_followers = ?,
       last_action_at = ?, touched_at = ?, stock = ?, stock_paid_through = ?,
       last_title = ?, locked_until = ?
     WHERE guild_id = ? AND user_id = ? AND platform = ?`),
  // Übertrag auf eine andere Plattform: erst den aufgelaufenen Verfall
  // anwenden (Faktor), dann den Zuwachs – in EINER Anweisung.
  addCreatorFollowers: db.prepare(
    `UPDATE creator_channels
       SET followers = MAX(0, CAST(followers * ? AS INTEGER) + ?), touched_at = ?
     WHERE guild_id = ? AND user_id = ? AND platform = ?`),
  topCreator: db.prepare(
    `SELECT * FROM creator_channels WHERE guild_id = ? AND platform = ? AND followers > 0
     ORDER BY followers DESC LIMIT ?`),
  topCreatorTotal: db.prepare(
    `SELECT user_id, SUM(followers) AS followers, SUM(earned_total) AS earned
     FROM creator_channels WHERE guild_id = ?
     GROUP BY user_id HAVING followers > 0 ORDER BY followers DESC LIMIT ?`),
  clearCreator: db.prepare('DELETE FROM creator_channels WHERE guild_id = ? AND user_id = ?'),

  // --- Vorfälle mit Entscheidung ---
  insertEvent: db.prepare(
    `INSERT INTO creator_events (guild_id, user_id, kind, platform, status, created_at, expires_at)
     VALUES (?, ?, ?, ?, 'open', ?, ?) RETURNING *`),
  getEvent: db.prepare('SELECT * FROM creator_events WHERE guild_id = ? AND id = ?'),
  openEvent: db.prepare(
    `SELECT * FROM creator_events WHERE guild_id = ? AND user_id = ? AND status = 'open'
     ORDER BY id DESC LIMIT 1`),
  overdueEvents: db.prepare(
    `SELECT * FROM creator_events WHERE guild_id = ? AND user_id = ? AND status = 'open'
       AND expires_at <= ?`),
  resolveEvent: db.prepare(
    `UPDATE creator_events SET status = ?, choice = ?, outcome = ?, effect = ?, decided_at = ?
     WHERE guild_id = ? AND id = ? AND status = 'open'`),
  eventHistory: db.prepare(
    `SELECT * FROM creator_events WHERE guild_id = ? AND user_id = ? AND status <> 'open'
     ORDER BY id DESC LIMIT ?`),
  lastEvent: db.prepare(
    `SELECT MAX(created_at) AS at FROM creator_events WHERE guild_id = ? AND user_id = ?`),
  clearEvents: db.prepare('DELETE FROM creator_events WHERE guild_id = ? AND user_id = ?'),
  lockCreator: db.prepare(
    `UPDATE creator_channels SET locked_until = ?
     WHERE guild_id = ? AND user_id = ? AND platform = ?`),

  // --- Sponsorenverträge ---
  insertDeal: db.prepare(
    `INSERT INTO creator_deals
       (guild_id, user_id, brand, emoji, platform, format, quota, payout, penalty,
        status, created_at, expires_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?) RETURNING *`),
  getDeal: db.prepare('SELECT * FROM creator_deals WHERE guild_id = ? AND id = ?'),
  listDeals: db.prepare(
    `SELECT * FROM creator_deals WHERE guild_id = ? AND user_id = ? AND status = ?
     ORDER BY id DESC`),
  activeDeal: db.prepare(
    `SELECT * FROM creator_deals WHERE guild_id = ? AND user_id = ? AND status = 'active'
     ORDER BY id DESC LIMIT 1`),
  countOffers: db.prepare(
    `SELECT COUNT(*) AS n FROM creator_deals
     WHERE guild_id = ? AND user_id = ? AND status = 'offer' AND expires_at > ?`),
  acceptDeal: db.prepare(
    `UPDATE creator_deals SET status = 'active', accepted_at = ?, deadline = ?
     WHERE guild_id = ? AND id = ? AND status = 'offer'`),
  setDealStatus: db.prepare(
    'UPDATE creator_deals SET status = ? WHERE guild_id = ? AND id = ?'),
  advanceDeal: db.prepare(
    'UPDATE creator_deals SET done = done + 1 WHERE guild_id = ? AND id = ?'),
  expireOffers: db.prepare(
    `UPDATE creator_deals SET status = 'expired'
     WHERE guild_id = ? AND user_id = ? AND status = 'offer' AND expires_at <= ?`),
  dealHistory: db.prepare(
    `SELECT * FROM creator_deals WHERE guild_id = ? AND user_id = ?
       AND status IN ('done', 'failed')
     ORDER BY id DESC LIMIT ?`),
  clearDeals: db.prepare('DELETE FROM creator_deals WHERE guild_id = ? AND user_id = ?'),

  getCreatorState: db.prepare(
    'SELECT * FROM creator_state WHERE guild_id = ? AND user_id = ?'),
  createCreatorState: db.prepare(
    `INSERT INTO creator_state (guild_id, user_id, created_at) VALUES (?, ?, ?)
     ON CONFLICT (guild_id, user_id) DO NOTHING`),
  saveCreatorState: db.prepare(
    `UPDATE creator_state SET day = ?, time_used = ?, boost = ?, boost_until = ?,
       community = ?, community_at = ?, fatigue = ?, fatigue_at = ?, merch_at = ?,
       language = ?, language_at = ?
     WHERE guild_id = ? AND user_id = ?`),
  clearCreatorState: db.prepare('DELETE FROM creator_state WHERE guild_id = ? AND user_id = ?'),

  // --- Staatskasse ---
  getTreasury: db.prepare('SELECT * FROM treasury WHERE guild_id = ?'),
  // Eine Anweisung je Zufluss: anlegen oder aufaddieren.
  addTreasury: db.prepare(
    `INSERT INTO treasury (guild_id, balance, vat_total, tax_total,
                           spend_base, income_base, bookings, started_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, 1, ?, ?)
     ON CONFLICT (guild_id) DO UPDATE SET
       balance     = balance     + excluded.balance,
       vat_total   = vat_total   + excluded.vat_total,
       tax_total   = tax_total   + excluded.tax_total,
       spend_base  = spend_base  + excluded.spend_base,
       income_base = income_base + excluded.income_base,
       bookings    = bookings    + 1,
       updated_at  = excluded.updated_at`),
  addTreasuryCountry: db.prepare(
    `INSERT INTO treasury_countries (guild_id, country, balance, vat_total, tax_total,
                                     spend_base, income_base, bookings, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, 1, ?)
     ON CONFLICT (guild_id, country) DO UPDATE SET
       balance     = balance     + excluded.balance,
       vat_total   = vat_total   + excluded.vat_total,
       tax_total   = tax_total   + excluded.tax_total,
       spend_base  = spend_base  + excluded.spend_base,
       income_base = income_base + excluded.income_base,
       bookings    = bookings    + 1,
       updated_at  = excluded.updated_at`),
  treasuryCountries: db.prepare(
    'SELECT * FROM treasury_countries WHERE guild_id = ? ORDER BY balance DESC'),
  treasuryCountry: db.prepare(
    'SELECT * FROM treasury_countries WHERE guild_id = ? AND country = ?'),
  clearTreasuryCountries: db.prepare('DELETE FROM treasury_countries WHERE guild_id = ?'),
  countryPopulation: db.prepare(
    `SELECT home_country AS country, COUNT(*) AS n FROM player_stats
     WHERE guild_id = ? AND home_country <> '' GROUP BY home_country`),

  addTreasurySource: db.prepare(
    `INSERT INTO treasury_sources (guild_id, source, kind, amount, base, bookings)
     VALUES (?, ?, ?, ?, ?, 1)
     ON CONFLICT (guild_id, source, kind) DO UPDATE SET
       amount   = amount   + excluded.amount,
       base     = base     + excluded.base,
       bookings = bookings + 1`),
  topTreasurySources: db.prepare(
    `SELECT source,
            SUM(amount)   AS amount,
            SUM(base)     AS base,
            SUM(bookings) AS bookings,
            SUM(CASE WHEN kind = 'vat' THEN amount ELSE 0 END) AS vat,
            SUM(CASE WHEN kind = 'tax' THEN amount ELSE 0 END) AS tax
     FROM treasury_sources WHERE guild_id = ?
     GROUP BY source ORDER BY amount DESC LIMIT ?`),
  addTreasuryPayer: db.prepare(
    `INSERT INTO treasury_payers (guild_id, account_id, amount, vat, tax, bookings)
     VALUES (?, ?, ?, ?, ?, 1)
     ON CONFLICT (guild_id, account_id) DO UPDATE SET
       amount   = amount   + excluded.amount,
       vat      = vat      + excluded.vat,
       tax      = tax      + excluded.tax,
       bookings = bookings + 1`),
  topTreasuryPayers: db.prepare(
    'SELECT * FROM treasury_payers WHERE guild_id = ? ORDER BY amount DESC LIMIT ?'),
  treasuryPayer: db.prepare(
    'SELECT * FROM treasury_payers WHERE guild_id = ? AND account_id = ?'),
  logTreasury: db.prepare(
    `INSERT INTO treasury_log (guild_id, account_id, kind, base, amount, source, reason, at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`),
  treasuryLog: db.prepare(
    'SELECT * FROM treasury_log WHERE guild_id = ? ORDER BY id DESC LIMIT ?'),
  // Alles außer den letzten N Zeilen wegwerfen – das Log ist reine Anzeige.
  trimTreasuryLog: db.prepare(
    `DELETE FROM treasury_log WHERE guild_id = ? AND id NOT IN
       (SELECT id FROM treasury_log WHERE guild_id = ? ORDER BY id DESC LIMIT ?)`),
  clearTreasury: db.prepare('DELETE FROM treasury WHERE guild_id = ?'),
  clearTreasurySources: db.prepare('DELETE FROM treasury_sources WHERE guild_id = ?'),
  clearTreasuryPayers: db.prepare('DELETE FROM treasury_payers WHERE guild_id = ?'),
  clearTreasuryLog: db.prepare('DELETE FROM treasury_log WHERE guild_id = ?'),
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
/**
 * Stellplätze aus eigenen Immobilien – nur die im angegebenen Land.
 *
 * Wer umzieht, kann seine Wohnung im alten Land nicht mitnehmen: Sie bleibt
 * sein Eigentum und behält ihren Wert, aber wohnen und parken lässt sich dort
 * nicht mehr. Bestandsdaten ohne Land zählen als Inland.
 */
function ownedGarageSlots(guildId, userId, country = '') {
  return stmt.ownedGarage.get(guildId, userId, country).slots;
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

/**
 * Räumt eine Nachricht weg. Rechnungen bleiben bestehen – Schulden lassen sich
 * nicht wegklicken.
 * @returns {boolean} true, wenn wirklich etwas entfernt wurde.
 */
function deleteMessage(guildId, userId, id) {
  return stmt.deleteMessage.run(guildId, userId, id).changes > 0;
}

/** Leert das Postfach (außer Rechnungen). @returns Anzahl entfernter Nachrichten. */
function clearMessages(guildId, userId) {
  return stmt.clearMessages.run(guildId, userId).changes;
}

/** Wie viele Nachrichten sich überhaupt löschen lassen (ohne Rechnungen). */
function countDeletable(guildId, userId) {
  return stmt.countDeletable.get(guildId, userId).n;
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

/**
 * Vergisst den Prüfzeitpunkt – der nächste Aufruf gilt wieder als "erstes Mal"
 * und holt nichts rückwirkend nach. Gedacht für Tests und Resets.
 */
function clearStreetWatch(guildId, userId) {
  return stmt.clearStreetWatch.run(guildId, userId).changes > 0;
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

/** Setzt Rang und die Schichtzahl, bei der er erreicht wurde. */
function promote(guildId, userId, rank, atShifts) {
  stmt.promote.run(Math.max(0, Math.round(rank)), Math.max(0, Math.round(atShifts)),
    guildId, userId);
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
/** Beschädigte Autos eines Spielers (Zustand < 100), schlimmste zuerst. */
function listDamaged(guildId, userId, page = 1) {
  const total = stmt.countDamaged.get(guildId, userId).n;
  const items = stmt.listDamaged.all(guildId, userId, PAGE_SIZE, (page - 1) * PAGE_SIZE);
  return { items, total, totalPages: Math.max(1, Math.ceil(total / PAGE_SIZE)), page };
}

function stampCountry(guildId, userId, itemId, country) {
  db.prepare(
    `UPDATE inventory SET country = ?
     WHERE guild_id = ? AND user_id = ? AND item_id = ? AND country = ''`
  ).run(String(country ?? ''), guildId, String(userId), itemId);
}

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
    ?? {
      guild_id: guildId, user_id: userId, xp: 0, income_total: 0, expense_total: 0,
      tagline: '', seen_version: '', home_country: '', moves: 0, home_at: 0,
    };
}

/** Merkt sich, welche Patchnotes-Version dieser Spieler schon gesehen hat. */
function setSeenVersion(guildId, userId, version) {
  stmt.setSeenVersion.run(guildId, userId, version);
}

/** Alle Spieler mit Statistik auf diesem Server – die Leaderboard-Teilnehmer. */
function listStats(guildId) {
  return stmt.listStats.all(guildId);
}

/** Setzt den Angeber-Spruch fürs Profil. */
function setTagline(guildId, userId, text) {
  stmt.setTagline.run(guildId, userId, text);
}

// ---------------------------------------------------------------- Heimat

/** Setzt das Wohnsitzland und zählt Umzüge mit. */
function setHome(guildId, userId, country, { move = false, at = Date.now() } = {}) {
  db.prepare(
    `INSERT INTO player_stats (guild_id, user_id, home_country, moves, home_at)
     VALUES (?, ?, ?, ?, ?)
     ON CONFLICT (guild_id, user_id) DO UPDATE SET
       home_country = excluded.home_country,
       moves = moves + ?,
       home_at = excluded.home_at`
  ).run(guildId, String(userId), String(country), move ? 1 : 0, at, move ? 1 : 0);
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

function addLoot(guildId, userId, name, value, rarity = '', condition = '', lotId = null) {
  return stmt.addLoot.get(guildId, userId, name, value, rarity, condition, lotId, Date.now());
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
    stmt.deleteGarages.run(guildId);
    return true;
  });
}

// --- Verschlossene Garagen (contents als JSON) ---

function addGarage(guildId, userId, label, price, contents, value) {
  return parseGarage(
    stmt.addGarage.get(guildId, userId, label, price, JSON.stringify(contents), value, Date.now()));
}

function parseGarage(row) {
  return { ...row, contents: JSON.parse(row.contents) };
}

function listGarages(guildId, userId) {
  return stmt.listGarages.all(guildId, userId).map(parseGarage);
}

function getGarage(guildId, garageId) {
  const row = stmt.getGarage.get(guildId, garageId);
  return row ? parseGarage(row) : null;
}

function removeGarage(guildId, userId, garageId) {
  return stmt.removeGarage.run(guildId, userId, garageId).changes > 0;
}

function countGarages(guildId, userId) {
  return stmt.countGarages.get(guildId, userId).n;
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

// ------------------------------------------------------ Fluxer-Menüs

/** Merkt sich, welche Reaktion dieser Nachricht welche Aktion auslöst. */
function saveFluxerView(messageId, userId, mapping, channelId = '') {
  stmt.saveFluxerView.run(
    String(messageId), String(userId), String(channelId),
    JSON.stringify(mapping), Date.now());
}

/** Die gemerkte Zuordnung einer Nachricht, oder null. */
function getFluxerView(messageId) {
  const row = stmt.getFluxerView.get(String(messageId));
  if (!row) return null;
  return { ...row, mapping: JSON.parse(row.mapping) };
}

/** Räumt alte Menüs weg (Standard: älter als 7 Tage). */
function purgeFluxerViews(before = Date.now() - 7 * 24 * 60 * 60 * 1000) {
  return stmt.purgeFluxerViews.run(before).changes;
}

// ------------------------------------------------- Konten zusammenführen

/**
 * Führt den Spielstand eines Kontos in ein anderes über.
 *
 * Nötig, wenn ein Fluxer-Spieler erst losspielt und sich später mit seinem
 * Discord-Konto verknüpft: Sein bisheriger Fortschritt darf nicht verfallen.
 *
 * Läuft komplett in EINER Transaktion – entweder alles wandert, oder nichts.
 *
 * Zwei Arten von Tabellen:
 *  - **umhängen**: mehrere Zeilen je Spieler möglich (Inserate, Fundstücke …)
 *    -> einfach die Besitzerspalte umschreiben.
 *  - **eine Zeile je Spieler** (Anstellung, Mietvertrag, Frist …)
 *    -> nur übernehmen, wenn das Zielkonto dort noch nichts hat.
 *
 * Geld ist bewusst NICHT dabei: Das erledigt der Aufrufer über die
 * Geldschnittstelle, weil es je nach Konto bei UnbelievaBoat liegen kann.
 *
 * @returns {{moved: object}} was jeweils übernommen wurde
 */
function mergeAccounts(guildId, fromId, toId) {
  if (String(fromId) === String(toId)) return { moved: {} };

  return transaction(() => {
    const moved = {};
    const reassign = (sql, label) => {
      const res = db.prepare(sql).run(String(toId), guildId, String(fromId));
      if (res.changes) moved[label] = res.changes;
    };

    // --- Besitz: Mengen zusammenzählen, damit nichts überschrieben wird ---
    const items = db.prepare(
      'SELECT item_id, quantity, condition FROM inventory WHERE guild_id = ? AND user_id = ?'
    ).all(guildId, String(fromId));
    for (const row of items) {
      const target = db.prepare(
        'SELECT quantity FROM inventory WHERE guild_id = ? AND user_id = ? AND item_id = ?'
      ).get(guildId, String(toId), row.item_id);
      if (target) {
        db.prepare(
          `UPDATE inventory SET quantity = quantity + ?
           WHERE guild_id = ? AND user_id = ? AND item_id = ?`
        ).run(row.quantity, guildId, String(toId), row.item_id);
      } else {
        db.prepare(
          `INSERT INTO inventory (guild_id, user_id, item_id, quantity, condition)
           VALUES (?, ?, ?, ?, ?)`
        ).run(guildId, String(toId), row.item_id, row.quantity, row.condition ?? 100);
      }
    }
    if (items.length) {
      db.prepare('DELETE FROM inventory WHERE guild_id = ? AND user_id = ?')
        .run(guildId, String(fromId));
      moved.inventory = items.length;
    }

    // --- Erfahrung und Statistik addieren ---
    const stats = db.prepare(
      'SELECT * FROM player_stats WHERE guild_id = ? AND user_id = ?'
    ).get(guildId, String(fromId));
    if (stats) {
      db.prepare(
        `INSERT INTO player_stats
           (guild_id, user_id, xp, income_total, expense_total, tagline, seen_version)
         VALUES (?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT (guild_id, user_id) DO UPDATE SET
           xp = xp + excluded.xp,
           income_total = income_total + excluded.income_total,
           expense_total = expense_total + excluded.expense_total,
           tagline = CASE WHEN tagline = '' THEN excluded.tagline ELSE tagline END`
      ).run(guildId, String(toId), stats.xp, stats.income_total, stats.expense_total,
        stats.tagline, stats.seen_version);
      db.prepare('DELETE FROM player_stats WHERE guild_id = ? AND user_id = ?')
        .run(guildId, String(fromId));
      moved.stats = stats.xp;
    }

    // --- Mehrfach-Zeilen: einfach umhängen ---
    reassign('UPDATE listings SET seller_id = ? WHERE guild_id = ? AND seller_id = ?', 'listings');
    reassign('UPDATE rent_offers SET landlord_id = ? WHERE guild_id = ? AND landlord_id = ?', 'rentOffers');
    reassign('UPDATE rentals SET landlord_id = ? WHERE guild_id = ? AND landlord_id = ?', 'tenants');
    reassign('UPDATE messages SET user_id = ? WHERE guild_id = ? AND user_id = ?', 'messages');
    reassign('UPDATE storage_loot SET user_id = ? WHERE guild_id = ? AND user_id = ?', 'loot');
    reassign('UPDATE storage_garages SET user_id = ? WHERE guild_id = ? AND user_id = ?', 'garages');
    reassign('UPDATE storage_lots SET top_bidder = ? WHERE guild_id = ? AND top_bidder = ?', 'bids');
    reassign('UPDATE wallet_log SET user_id = ? WHERE guild_id = ? AND user_id = ?', 'walletLog');
    reassign('UPDATE treasury_log SET account_id = ? WHERE guild_id = ? AND account_id = ?',
      'treasuryLog');

    // --- Beitrag zur Staatskasse addieren (der Topf selbst bleibt unberührt) ---
    const paid = db.prepare(
      'SELECT * FROM treasury_payers WHERE guild_id = ? AND account_id = ?'
    ).get(guildId, String(fromId));
    if (paid) {
      db.prepare(
        `INSERT INTO treasury_payers (guild_id, account_id, amount, vat, tax, bookings)
         VALUES (?, ?, ?, ?, ?, ?)
         ON CONFLICT (guild_id, account_id) DO UPDATE SET
           amount   = amount   + excluded.amount,
           vat      = vat      + excluded.vat,
           tax      = tax      + excluded.tax,
           bookings = bookings + excluded.bookings`
      ).run(guildId, String(toId), paid.amount, paid.vat, paid.tax, paid.bookings);
      db.prepare('DELETE FROM treasury_payers WHERE guild_id = ? AND account_id = ?')
        .run(guildId, String(fromId));
      moved.treasury = paid.amount;
    }

    // --- Eine Zeile je Spieler: nur übernehmen, wenn das Ziel noch leer ist ---
    for (const [table, label] of [
      ['employment', 'employment'], ['rentals', 'rental'], ['capacity_grace', 'grace'],
      ['street_watch', 'streetWatch'], ['casino_games', 'casinoGame'],
    ]) {
      const has = db.prepare(
        `SELECT 1 FROM ${table} WHERE guild_id = ? AND user_id = ?`
      ).get(guildId, String(toId));
      if (has) {
        db.prepare(`DELETE FROM ${table} WHERE guild_id = ? AND user_id = ?`)
          .run(guildId, String(fromId));
      } else {
        const res = db.prepare(
          `UPDATE ${table} SET user_id = ? WHERE guild_id = ? AND user_id = ?`
        ).run(String(toId), guildId, String(fromId));
        if (res.changes) moved[label] = res.changes;
      }
    }

    // Cooldowns (je Art eine Zeile): den späteren behalten, damit das
    // Zusammenführen kein zusätzliches !daily verschenkt.
    for (const claim of db.prepare(
      'SELECT * FROM income_claims WHERE guild_id = ? AND user_id = ?'
    ).all(guildId, String(fromId))) {
      db.prepare(
        `INSERT INTO income_claims (guild_id, user_id, kind, claimed_at) VALUES (?, ?, ?, ?)
         ON CONFLICT (guild_id, user_id, kind) DO UPDATE SET
           claimed_at = MAX(claimed_at, excluded.claimed_at)`
      ).run(guildId, String(toId), claim.kind, claim.claimed_at);
    }
    db.prepare('DELETE FROM income_claims WHERE guild_id = ? AND user_id = ?')
      .run(guildId, String(fromId));

    return { moved };
  });
}

// ------------------------------------------------------ Kontoverknüpfung

/** Die Verknüpfung einer Plattform-Identität, oder null. */
// ------------------------------------------------------- Creator-Netzwerk

/** Eine Plattform eines Spielers – legt sie beim ersten Zugriff an. */
function getCreator(guildId, userId, platform, now = Date.now()) {
  stmt.createCreator.run(guildId, String(userId), platform, now);
  return stmt.getCreator.get(guildId, String(userId), platform);
}

/** Alle Plattformen eines Spielers, die schon existieren. */
function allCreator(guildId, userId) {
  return stmt.allCreator.all(guildId, String(userId));
}

/** Schreibt eine Plattform in EINER Anweisung fort. */
function saveCreator(guildId, userId, platform, c) {
  stmt.saveCreator.run(
    Math.max(0, Math.round(c.followers)), Math.max(0, Math.round(c.subs)), c.hype,
    c.actions, c.views_total, c.earned_total, c.peak_audience, c.peak_followers,
    c.last_action_at, c.touched_at, c.stock, c.stock_paid_through,
    String(c.last_title ?? '').slice(0, 120), c.locked_until ?? 0,
    guildId, String(userId), platform);
}

/**
 * Übertrag auf eine andere Plattform: `keep` ist der Anteil, der den Verfall
 * seit der letzten Berührung überlebt hat (1 = kein Verfall).
 */
function addCreatorFollowers(guildId, userId, platform, delta, keep = 1, now = Date.now()) {
  stmt.createCreator.run(guildId, String(userId), platform, now);
  stmt.addCreatorFollowers.run(
    keep, Math.round(delta), now, guildId, String(userId), platform);
}

/** Der geteilte Zustand (Tagesbudget, Promo-Schub, Community). */
function getCreatorState(guildId, userId, now = Date.now()) {
  stmt.createCreatorState.run(guildId, String(userId), now);
  return stmt.getCreatorState.get(guildId, String(userId));
}

function saveCreatorState(guildId, userId, s) {
  stmt.saveCreatorState.run(
    s.day, s.time_used, s.boost, s.boost_until, s.community, s.community_at,
    s.fatigue ?? 0, s.fatigue_at ?? 0, s.merch_at ?? 0,
    s.language ?? '', s.language_at ?? 0,
    guildId, String(userId));
}

/** Reichweiten-Rangliste einer Plattform. */
function topCreator(guildId, platform, limit = 10) {
  return stmt.topCreator.all(guildId, platform, limit);
}

/** Rangliste über alle Plattformen zusammen. */
function topCreatorTotal(guildId, limit = 10) {
  return stmt.topCreatorTotal.all(guildId, limit);
}

// ------------------------------------------------- Vorfälle (Entscheidungen)

/** Legt einen offenen Vorfall an. */
function insertEvent({ guildId, userId, kind, platform = '', createdAt, expiresAt }) {
  return stmt.insertEvent.get(guildId, String(userId), kind, platform, createdAt, expiresAt);
}

function getEvent(guildId, id) {
  return stmt.getEvent.get(guildId, Number(id)) ?? null;
}

/** Der offene Vorfall eines Spielers, oder null. */
function openEvent(guildId, userId) {
  return stmt.openEvent.get(guildId, String(userId)) ?? null;
}

/** Offene Vorfälle, deren Frist abgelaufen ist. */
function overdueEvents(guildId, userId, now = Date.now()) {
  return stmt.overdueEvents.all(guildId, String(userId), now);
}

/** Schließt einen Vorfall ab. false, wenn er nicht mehr offen war. */
function resolveEvent(guildId, id, { status, choice = '', outcome = '', effect = '', at }) {
  return stmt.resolveEvent.run(
    status, choice, outcome, effect, at, guildId, Number(id)).changes > 0;
}

/** Die letzten erledigten Vorfälle. */
function eventHistory(guildId, userId, limit = 5) {
  return stmt.eventHistory.all(guildId, String(userId), limit);
}

/** Wann zuletzt überhaupt ein Vorfall auftrat (0 = noch nie). */
function lastEventAt(guildId, userId) {
  return stmt.lastEvent.get(guildId, String(userId))?.at ?? 0;
}

/** Sperrt eine Plattform bis zu einem Zeitpunkt. */
function lockCreator(guildId, userId, platform, until) {
  stmt.lockCreator.run(until, guildId, String(userId), platform);
}

// ------------------------------------------------------ Sponsorenverträge

/** Legt ein Vertragsangebot an und gibt es zurück. */
function insertDeal(d) {
  return stmt.insertDeal.get(
    d.guildId, String(d.userId), d.brand, d.emoji ?? '', d.platform, d.format ?? '',
    d.quota, d.payout, d.penalty ?? 0, 'offer', d.createdAt, d.expiresAt);
}

function getDeal(guildId, id) {
  return stmt.getDeal.get(guildId, Number(id)) ?? null;
}

/** Alle Verträge eines Spielers in einem Zustand. */
function listDeals(guildId, userId, status = 'offer') {
  return stmt.listDeals.all(guildId, String(userId), status);
}

/** Der laufende Vertrag, oder null. */
function activeDeal(guildId, userId) {
  return stmt.activeDeal.get(guildId, String(userId)) ?? null;
}

/** Wie viele Angebote gerade offen sind. */
function countOffers(guildId, userId, now = Date.now()) {
  return stmt.countOffers.get(guildId, String(userId), now).n;
}

/** Nimmt ein Angebot an. Gibt false zurück, wenn es kein Angebot mehr ist. */
function acceptDeal(guildId, id, acceptedAt, deadline) {
  return stmt.acceptDeal.run(acceptedAt, deadline, guildId, Number(id)).changes > 0;
}

function setDealStatus(guildId, id, status) {
  stmt.setDealStatus.run(status, guildId, Number(id));
}

/** Zählt einen gelieferten Beitrag auf den laufenden Vertrag. */
function advanceDeal(guildId, id) {
  stmt.advanceDeal.run(guildId, Number(id));
}

/** Lässt abgelaufene Angebote verfallen. */
function expireOffers(guildId, userId, now = Date.now()) {
  return stmt.expireOffers.run(guildId, String(userId), now).changes;
}

/** Die letzten abgeschlossenen Verträge (für den Ruf). */
function dealHistory(guildId, userId, limit = 10) {
  return stmt.dealHistory.all(guildId, String(userId), limit);
}

/** Löscht das ganze Netzwerk eines Spielers (Tests, Admin). */
function clearCreator(guildId, userId) {
  stmt.clearCreator.run(guildId, String(userId));
  stmt.clearCreatorState.run(guildId, String(userId));
  stmt.clearDeals.run(guildId, String(userId));
  stmt.clearEvents.run(guildId, String(userId));
}

// -------------------------------------------------------- Staatskasse

/** Wie viele Log-Zeilen je Welt aufgehoben werden. */
const TREASURY_LOG_KEEP = 200;

/** Stand der Staatskasse – nie null, eine leere Kasse zählt als 0. */
function getTreasury(guildId) {
  return stmt.getTreasury.get(guildId) ?? {
    guild_id: guildId, balance: 0, vat_total: 0, tax_total: 0,
    spend_base: 0, income_base: 0, bookings: 0, started_at: 0, updated_at: 0,
  };
}

/**
 * Bucht einen Zufluss in die Staatskasse. Vier synchrone Anweisungen, kein
 * `await` dazwischen – der Stand kann dabei nicht auseinanderlaufen (§7).
 */
function bookTreasury({
  guildId, accountId, kind, base, amount, source = '', reason = '', country = '',
  at = Date.now(),
}) {
  const vat = kind === 'vat' ? amount : 0;
  const tax = kind === 'tax' ? amount : 0;
  const spend = kind === 'vat' ? base : 0;
  const income = kind === 'tax' ? base : 0;

  stmt.addTreasury.run(guildId, amount, vat, tax, spend, income, at, at);
  // Derselbe Betrag noch einmal auf das Land des Spielers – der Welttopf
  // bleibt die Summe, die Länderzeilen sind die Aufteilung.
  stmt.addTreasuryCountry.run(guildId, String(country ?? ''), amount, vat, tax,
    spend, income, at);
  stmt.addTreasurySource.run(guildId, source, kind, amount, base);
  stmt.addTreasuryPayer.run(guildId, String(accountId), amount, vat, tax);
  stmt.logTreasury.run(guildId, String(accountId), kind, base, amount, source, reason, at);

  const row = stmt.getTreasury.get(guildId);
  // Nur gelegentlich aufräumen – das Kappen kostet mehr als das Einfügen.
  if (row && row.bookings % 50 === 0) {
    stmt.trimTreasuryLog.run(guildId, guildId, TREASURY_LOG_KEEP);
  }
  return row;
}

/** Die Staatskassen aller Länder, absteigend nach Stand. */
function treasuryCountries(guildId) {
  return stmt.treasuryCountries.all(guildId);
}

/** Die Kasse eines einzelnen Landes – nie null. */
function treasuryCountry(guildId, country) {
  return stmt.treasuryCountry.get(guildId, String(country ?? '')) ?? {
    guild_id: guildId, country: String(country ?? ''), balance: 0, vat_total: 0,
    tax_total: 0, spend_base: 0, income_base: 0, bookings: 0, updated_at: 0,
  };
}

/** Wie viele Spieler in welchem Land leben. */
function countryPopulation(guildId) {
  return stmt.countryPopulation.all(guildId);
}

/** Die ergiebigsten Bereiche (Käufe, Arbeit, Börse …). */
function topTreasurySources(guildId, limit = 5) {
  return stmt.topTreasurySources.all(guildId, limit);
}

/** Wer am meisten beigetragen hat. */
function topTreasuryPayers(guildId, limit = 5) {
  return stmt.topTreasuryPayers.all(guildId, limit);
}

/** Der Beitrag eines einzelnen Kontos – nie null. */
function treasuryPayer(guildId, accountId) {
  return stmt.treasuryPayer.get(guildId, String(accountId)) ?? {
    guild_id: guildId, account_id: String(accountId),
    amount: 0, vat: 0, tax: 0, bookings: 0,
  };
}

/** Die letzten Zuflüsse. */
function treasuryLog(guildId, limit = 5) {
  return stmt.treasuryLog.all(guildId, limit);
}

/** Setzt die Kasse einer Welt zurück (Tests, Admin). */
function clearTreasury(guildId) {
  stmt.clearTreasury.run(guildId);
  stmt.clearTreasuryCountries.run(guildId);
  stmt.clearTreasurySources.run(guildId);
  stmt.clearTreasuryPayers.run(guildId);
  stmt.clearTreasuryLog.run(guildId);
}

// -------------------------------------------------------------- Börse

/** Uhr und Stimmung des Marktes (oder null beim allerersten Mal). */
function getMarketState(guildId) {
  return stmt.getMarketState.get(guildId) ?? null;
}

function setMarketState(guildId, vol, tick) {
  stmt.setMarketState.run(guildId, vol, tick);
}

/** Kurszeile eines Wertes (oder null, wenn er noch nie notiert wurde). */
function getPrice(guildId, symbol) {
  return stmt.getPrice.get(guildId, symbol) ?? null;
}

/** Alle notierten Werte dieser Welt. */
function allPrices(guildId) {
  return stmt.allPrices.all(guildId);
}

/** Schreibt Kurs und Stand der Simulation fort. */
function setPrice(guildId, symbol, price, tick, listedAt = Date.now()) {
  stmt.setPrice.run(guildId, symbol, Math.max(1, Math.round(price)), tick, listedAt);
}

/** Neuemission nach einer Insolvenz: Kurs und Startzeitpunkt zurücksetzen. */
function relistAsset(guildId, symbol, price, tick, when = Date.now()) {
  stmt.relist.run(Math.max(1, Math.round(price)), tick, when, guildId, symbol);
  stmt.clearHistoryOf.run(guildId, symbol);
}

function addHistory(guildId, symbol, tick, price) {
  stmt.addHistory.run(guildId, symbol, tick, Math.max(1, Math.round(price)));
}

/** Kursverlauf ab einem Tick (aufsteigend). */
function history(guildId, symbol, sinceTick = 0) {
  return stmt.history.all(guildId, symbol, sinceTick);
}

function purgeHistory(guildId, symbol, beforeTick) {
  stmt.purgeHistory.run(guildId, symbol, beforeTick);
}

/** Depotposition eines Spielers. */
function getHolding(guildId, userId, symbol) {
  return stmt.getHolding.get(guildId, userId, symbol) ?? null;
}

/** Alle Positionen eines Spielers. */
function holdingsOf(guildId, userId) {
  return stmt.holdingsOf.all(guildId, userId);
}

/** Alle Halter eines Wertes – gebraucht bei der Insolvenz-Auszahlung. */
function holdersOf(guildId, symbol) {
  return stmt.holdersOf.all(guildId, symbol);
}

/** Schreibt eine Position (0 Stücke = Position löschen). */
function setHolding(guildId, userId, symbol, shares, invested) {
  if (shares <= 0) {
    stmt.dropHolding.run(guildId, userId, symbol);
    return;
  }
  stmt.setHolding.run(guildId, userId, symbol, Math.round(shares), Math.round(invested));
}

function addNews(guildId, symbol, tick, headline, change, when = Date.now()) {
  stmt.addNews.run(guildId, symbol, tick, headline, change, when);
}

function listNews(guildId, limit = 5) {
  return stmt.listNews.all(guildId, limit);
}

function purgeNews(guildId, beforeTick) {
  stmt.purgeNews.run(guildId, beforeTick);
}

/** Räumt die ganze Börse dieser Welt ab – für Tests und Resets. */
function clearMarket(guildId) {
  return transaction(() => {
    stmt.clearMarket.run(guildId);
    stmt.clearMarketHoldings.run(guildId);
    stmt.clearMarketNews.run(guildId);
    stmt.clearMarketHistory.run(guildId);
    stmt.clearMarketState.run(guildId);
    return true;
  });
}

// ------------------------------------------------------ Brücken-Webhooks

/** Merkt sich Webhook-ID und Token eines Brücken-Kanals. */
function setRelayWebhook(platform, channelId, webhookId, token, when = Date.now()) {
  stmt.setRelayWebhook.run(platform, channelId, webhookId, token, when);
}

function getRelayWebhook(platform, channelId) {
  return stmt.getRelayWebhook.get(platform, channelId) ?? null;
}

/** Vergisst einen Webhook – etwa wenn er drüben gelöscht wurde. */
function deleteRelayWebhook(platform, channelId) {
  return stmt.deleteRelayWebhook.run(platform, channelId).changes > 0;
}

/** Alle gemerkten Webhooks – beim Start gebraucht, um eigene zu erkennen. */
function allRelayWebhooks() {
  return stmt.allRelayWebhooks.all();
}

function getLink(platform, userId) {
  return stmt.getLink.get(platform, String(userId)) ?? null;
}

function setLink(platform, userId, accountId) {
  stmt.setLink.run(platform, String(userId), String(accountId), Date.now());
}

function deleteLink(platform, userId) {
  return stmt.deleteLink.run(platform, String(userId)).changes > 0;
}

/** Alle Plattform-Identitäten eines Kontos. */
function linksOf(accountId) {
  return stmt.linksOf.all(String(accountId));
}

/** Merkt sich den Anzeigenamen – für Plattformen, die fremde Erwähnungen nicht auflösen. */
function setAccountName(accountId, name) {
  stmt.setAccountName.run(String(accountId), String(name), Date.now());
}

function getAccountName(accountId) {
  return stmt.getAccountName.get(String(accountId))?.name ?? null;
}

/**
 * Alle gemerkten Anzeigenamen. Die Tabelle hat eine Zeile je Konto und ist
 * damit winzig – der Abgleich (Groß-/Kleinschreibung, Sonderzeichen) passiert
 * bewusst in JavaScript, weil SQLite kein Unicode-Casefolding kann.
 */
function allAccountNames() {
  return stmt.allAccountNames.all();
}

// ------------------------------------------------------------------- Wallet

/** Geldbeutel eines Spielers; legt ihn beim ersten Zugriff mit Startguthaben an. */
function getWallet(guildId, userId, startCash = 0) {
  let row = stmt.getWallet.get(guildId, userId);
  if (!row) {
    stmt.createWallet.run(guildId, userId, startCash, 0, Date.now());
    row = stmt.getWallet.get(guildId, userId);
    if (startCash) logWallet(guildId, userId, startCash, 'Startguthaben');
  }
  return row;
}

/** Existiert schon ein Geldbeutel? (ohne einen anzulegen) */
function hasWallet(guildId, userId) {
  return !!stmt.getWallet.get(guildId, userId);
}

/** Verändert das Bargeld – eine Anweisung, also atomar. */
function addCash(guildId, userId, amount) {
  return stmt.addCash.run(Math.round(amount), guildId, userId).changes > 0;
}

/** Schiebt Geld von der Bank aufs Bargeld (negativ = zurück auf die Bank). */
function moveToCash(guildId, userId, amount) {
  const value = Math.round(amount);
  return stmt.moveToCash.run(value, value, guildId, userId).changes > 0;
}

function logWallet(guildId, userId, amount, reason = '') {
  stmt.logWallet.run(guildId, userId, Math.round(amount), reason, Date.now());
}

function walletLog(guildId, userId, limit = 20) {
  return stmt.walletLog.all(guildId, userId, limit);
}

/** Reichste Spieler (nur flüssiges Vermögen) – für die Rangliste. */
function walletTop(guildId, limit = 50) {
  return stmt.walletTop.all(guildId, limit);
}

// --------------------------------------------------- Einkommens-Cooldowns

/** Zeitpunkt der letzten Auszahlung dieser Art, oder null. */
function getClaim(guildId, userId, kind) {
  return stmt.getClaim.get(guildId, userId, kind) ?? null;
}

function setClaim(guildId, userId, kind, when = Date.now()) {
  stmt.setClaim.run(guildId, userId, kind, when);
}

function clearClaim(guildId, userId, kind) {
  return stmt.clearClaim.run(guildId, userId, kind).changes > 0;
}

module.exports = {
  listItems, listBrands, getItem, createItem, deleteItem, updateItemImage, allItemsOfKind,
  listInventory, listDamaged, reservePurchase, releasePurchase,
  getOwned, getMostValuable, garageValue, propertyValue, ownsNamed, bestCarValue,
  addStats, getStats, listStats, setTagline, setSeenVersion, setHome, stampCountry,
  getWallet, hasWallet, addCash, moveToCash, logWallet, walletLog, walletTop,
  getLink, setLink, deleteLink, linksOf,
  getCreator, allCreator, saveCreator, addCreatorFollowers,
  getCreatorState, saveCreatorState, topCreator, topCreatorTotal, clearCreator,
  insertEvent, getEvent, openEvent, overdueEvents, resolveEvent, eventHistory,
  lastEventAt, lockCreator,
  insertDeal, getDeal, listDeals, activeDeal, countOffers, acceptDeal,
  setDealStatus, advanceDeal, expireOffers, dealHistory,
  getTreasury, bookTreasury, topTreasurySources, topTreasuryPayers, treasuryPayer,
  treasuryCountries, treasuryCountry, countryPopulation,
  treasuryLog, clearTreasury, TREASURY_LOG_KEEP,
  getMarketState, setMarketState,
  getPrice, allPrices, setPrice, relistAsset, addHistory, history, purgeHistory,
  getHolding, holdingsOf, holdersOf, setHolding,
  addNews, listNews, purgeNews, clearMarket,
  setRelayWebhook, getRelayWebhook, deleteRelayWebhook, allRelayWebhooks,
  setAccountName, getAccountName, allAccountNames, mergeAccounts,
  saveFluxerView, getFluxerView, purgeFluxerViews,
  getClaim, setClaim, clearClaim,
  deleteMessage, clearMessages, countDeletable,
  transaction,
  activeRound, latestRound, insertRound, insertLot, listRoundLots, getLot, placeBid, claimLot,
  finishLot, dueLots, purgeOldLots,
  addLoot, listLoot, lootSummary, getLoot, removeLoot, clearLoot, clearStorage, grantCar,
  addGarage, listGarages, getGarage, removeGarage, countGarages,
  listListings, allListingsOfKind, getListing, createListing, cancelListing,
  takeListing, restoreListing,
  getEmployment, setEmployment, clearEmployment, promote, recordShift, shiftsToday, consumeNamed,
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
  setCondition, carsByValue, getStreetWatch, setStreetWatch, clearStreetWatch,
  PAGE_SIZE, MAX_LISTINGS_PER_USER,
};
