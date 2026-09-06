/**
 * ===========================================================================
 *  STORAGE-WARS – KATALOG (Basis-Objekte, Seltenheit, Zustand)
 * ===========================================================================
 *
 * Wertformel eines Fundstücks:
 *     Wert = Basiswert (aus range) × Seltenheits-Multiplikator × Zustands-Multiplikator
 *
 * Seltenheit UND Zustand fließen sowohl in den Wert als auch – über den
 * Erwartungswert – in den Startpreis der Auktion ein. Die Multiplikatoren und
 * Wahrscheinlichkeiten sind reine Balance-Stellschrauben.
 *
 * Die Helfer `weighted/pick/between` werden aus data/npc.js wiederverwendet.
 */
const { weighted, pick, between } = require('./npc');

/**
 * Basis-Objekte: Name, Fundgewicht und Basiswertspanne (Seltenheit „common").
 * Seltenheit und Zustand skalieren diesen Basiswert.
 *
 * Das `weight` ist eine **Balance-Stellschraube gegen Frust**: Ohne Gewichte
 * wurde jedes Objekt gleich oft gezogen, und die eine teure Ausnahme
 * (Dragonlore) trug fast die Hälfte des Durchschnittswerts – also fast die
 * Hälfte des Startpreises – obwohl sie nur in 1 von 14 Funden steckt. Bezahlt
 * hat man sie in JEDER Garage. Jetzt sind die teuren Stücke entsprechend
 * seltener, und der Preis folgt dem, was üblicherweise drin liegt.
 */
/*
 * `jackpot: true` heißt: Das Stück ist **findbar, aber nicht eingepreist**.
 *
 * Dieselbe Idee wie bei den obersten Seltenheitsstufen (UNPRICED_FROM in
 * storage.js): Ein Goldbarren, den man einmal in tausend Funden zieht, würde
 * über den Erwartungswert den Startpreis JEDER Garage anheben – man bezahlt
 * dann in jeder Auktion eine Lotterie mit, die praktisch nie aufgeht. Genau
 * daran ist die erste Fassung des Auktionshauses gescheitert.
 *
 * Deshalb zählen diese Stücke voll zum Inhalt, aber nicht zum Preis:
 * geschenkter Ausreißer statt Dauerabgabe.
 */
const OBJECTS = [
  { name: 'Kiste altes Werkzeug', weight: 10, range: [50, 300] },
  { name: 'Stapel alte Schallplatten', weight: 10, range: [80, 400] },
  { name: 'Voller Werkzeugkoffer', weight: 8, range: [120, 500] },
  { name: 'Alte Armbanduhr', weight: 8, range: [100, 600] },
  { name: 'Antike Vase', weight: 6, range: [150, 800] },
  { name: 'Gerahmtes Gemälde', weight: 5, range: [200, 900] },
  { name: 'Vergessene Münzsammlung', weight: 7, range: [120, 700] },
  { name: 'AWP - Dragonlore', weight: 2, range: [2750, 7560], jackpot: true },
  { name: 'Simons Schrotflinte', weight: 2, range: [400, 2450] },
  { name: 'Miros Pokemon Karten', weight: 8, range: [50, 500] },
  { name: '1 von Gabriels 300 Controllern', weight: 10, range: [20, 300] },
  { name: 'Ente mit Talenten', weight: 5, range: [50, 1000] },
  { name: 'Haste MCs Motorradteile', weight: 8, range: [20, 700] },
  { name: 'Toaster', weight: 10, range: [5, 400] },
  { name: 'Rolex', weight: 1, range: [15000, 60000], jackpot: true },

  // --- Zocker-Nachlass ---
  { name: 'Game Boy mit Tetris-Modul', weight: 7, range: [80, 500] },
  { name: 'Kiste PS2-Spiele', weight: 9, range: [40, 350] },
  { name: 'N64 mit Ocarina of Time', weight: 2, range: [400, 2200] },
  { name: 'Gaming-Stuhl (durchgesessen)', weight: 9, range: [30, 350] },
  { name: 'Arcade-Automat, läuft fast', weight: 1.5, range: [800, 3500] },
  { name: 'Tastatur ohne W, A, S und D', weight: 9, range: [5, 90] },
  { name: 'Karton voller Steam-Keys', weight: 6, range: [30, 600] },
  { name: 'Grafikkarte aus der Mining-Zeit', weight: 4, range: [150, 1200] },
  { name: 'Versiegeltes Super Mario 64', weight: 0.06, range: [30000, 120000], jackpot: true },

  // --- Regal Anime ---
  { name: 'Umzugskarton voller Manga', weight: 8, range: [80, 700] },
  { name: 'Figurensammlung, halb ausgepackt', weight: 6, range: [100, 900] },
  { name: 'Limitiertes Figma, noch in Folie', weight: 2, range: [300, 1800] },
  { name: 'Signiertes Anime-Cel', weight: 1, range: [900, 4500] },
  { name: 'Stapel Waifu-Kissenbezüge', weight: 5, range: [15, 220] },
  { name: 'Cosplay-Rüstung aus Pappe', weight: 6, range: [20, 300] },
  { name: '1st-Edition-Glurak im Slab', weight: 0.12, range: [12000, 55000], jackpot: true },

  // --- Dinge, bei denen der Auktionator kurz still wird ---
  { name: 'Antikes Samuraischwert', weight: 0.5, range: [3000, 14000], jackpot: true },
  { name: 'Erstausgabe-Comic in Schutzhülle', weight: 0.3, range: [4000, 20000], jackpot: true },
  { name: 'Goldbarren unter dem Fußboden', weight: 0.08, range: [25000, 90000], jackpot: true },
  { name: 'Zettel mit einem Seed-Phrase-Backup', weight: 0.04, range: [40000, 160000], jackpot: true },

  // --- Ganz normaler Hausrat ---
  { name: 'Karton IKEA-Schrauben', weight: 10, range: [5, 90] },
  { name: 'Heimtrainer, kaum benutzt', weight: 9, range: [30, 400] },
  { name: 'Aquarium ohne Wasser', weight: 7, range: [20, 250] },
  { name: 'Rasenmäher ohne Motor', weight: 8, range: [10, 200] },
  { name: 'Palette abgelaufener Energydrinks', weight: 9, range: [5, 80] },
  { name: 'Zwölf identische Regenschirme', weight: 8, range: [15, 180] },
  { name: 'Kaffeevollautomat mit Kalk', weight: 7, range: [80, 700] },
  { name: 'Nähmaschine von Oma', weight: 7, range: [60, 450] },
  { name: 'Plattenspieler mit heiler Nadel', weight: 6, range: [120, 800] },
  { name: 'Kiste Modelleisenbahn', weight: 5, range: [200, 1500] },
  { name: 'Eichenschrankwand, zerlegt', weight: 6, range: [80, 700] },
  { name: 'Umzugskisten voller Schulhefte', weight: 9, range: [1, 40] },
];

/**
 * Rückfall-Spanne für Bargeld, falls eine Stufe keine eigene `cash` mitbringt.
 * Die Stufen unten setzen ihre eigene – dort liegt IMMER Bargeld dabei.
 */
const CASH_RANGE = [200, 3000];

/**
 * Seltenheitsstufen: `weight` = grobe Drop-Wahrscheinlichkeit in Prozent
 * (weighted() normalisiert über die Summe), `mult` = Wert-Multiplikator.
 *
 * Die Multiplikatoren der mittleren Stufen sind bewusst gestaucht (früher bis
 * 60× bei Mythic): Der Startpreis ist der Erwartungswert, und der wurde zu
 * einem Viertel von Funden getragen, die seltener als 1:100 sind. Man hat also
 * in jeder Garage eine Lotterie mitbezahlt, die man fast nie gewinnt.
 *
 * Ab „Godlike" wird es *respektlos* selten – die Stufen sind absichtlich fast
 * unerreichbar, dafür bei einem Treffer absurd wertvoll. Vorgabe: legendary 1 %,
 * Mythic 0,5 %. Der common-Wert wird unten so gesetzt, dass die Summe = 100
 * ergibt, damit diese Prozente exakt stimmen.
 */
const RARITY_TAIL = [
  { id: 'uncommon',     label: 'Uncommon',     emoji: '🟢', weight: 28,            mult: 2 },
  { id: 'rare',         label: 'Rare',         emoji: '🔵', weight: 15,             mult: 4 },
  { id: 'epic',         label: 'Epic',         emoji: '🟣', weight: 5,           mult: 8 },
  { id: 'legendary',    label: 'Legendary',    emoji: '🟡', weight: 1,             mult: 20 },
  { id: 'mythic',       label: 'Mythic',       emoji: '🔴', weight: 0.5,           mult: 60 },
  // ---- ab hier respektlos selten ----
  { id: 'godlike',      label: 'Godlike',      emoji: '🟠', weight: 0.05,          mult: 200 },
  { id: 'cosmic',       label: 'Cosmic',       emoji: '🌌', weight: 0.005,         mult: 800 },
  { id: 'primordial',   label: 'Primordial',   emoji: '🩸', weight: 0.0005,        mult: 4000 },
  { id: 'celestial',    label: 'Celestial',    emoji: '🌟', weight: 0.00003,       mult: 20000 },
  { id: 'eternal',      label: 'Eternal',      emoji: '♾️', weight: 0.000005,      mult: 100000 },
  { id: 'ascended',     label: 'Ascended',     emoji: '🔆', weight: 0.0000005,     mult: 500000 },
  { id: 'transcendent', label: 'Transcendent', emoji: '🕳️', weight: 0.00000003,    mult: 3000000 },
  { id: 'omnipotent',   label: 'Omnipotent',   emoji: '👁️', weight: 0.000000002,   mult: 20000000 },
  { id: 'origin',       label: 'Origin',       emoji: '🎆', weight: 0.0000000001,  mult: 200000000 },
];

// common füllt auf 100 % auf – so bleiben legendary = 1 % und Mythic = 0,5 % exakt.
const COMMON_WEIGHT = 100 - RARITY_TAIL.reduce((s, r) => s + r.weight, 0);
const RARITIES = [
  { id: 'common', label: 'Common', emoji: '⚪', weight: COMMON_WEIGHT, mult: 1 },
  ...RARITY_TAIL,
];

/**
 * Zustände: skalieren den Wert zusätzlich. „Beschädigt" drückt auf 0,4×,
 * „Sammlerzustand" verdreifacht – und ist entsprechend selten.
 */
const CONDITIONS = [
  { id: 'beschaedigt',    label: 'beschädigt',     emoji: '💢', weight: 15, mult: 0.5 },
  { id: 'abgenutzt',      label: 'abgenutzt',      emoji: '🩹', weight: 22, mult: 0.75 },
  { id: 'normal',         label: 'normal',         emoji: '📦', weight: 50, mult: 1.0 },
  { id: 'gepflegt',       label: 'gepflegt',       emoji: '✨', weight: 8,  mult: 1.5 },
  { id: 'sammlerzustand', label: 'Sammlerzustand', emoji: '💎', weight: 2,  mult: 3.0 },
];

const RARITY_BY_ID = new Map(RARITIES.map((r) => [r.id, r]));
const CONDITION_BY_ID = new Map(CONDITIONS.map((c) => [c.id, c]));

const rarityOf = (id) => RARITY_BY_ID.get(id) ?? RARITIES[0];
const conditionOf = (id) => CONDITION_BY_ID.get(id) ?? CONDITIONS[2];

/**
 * Größenstufen der Garage (NICHT Item-Seltenheit): bestimmen, wie viele Objekte
 * drin sind, wie viel Bargeld dabeiliegt und wie wahrscheinlich ein Auto ist.
 *
 * Zwei bewusste Entscheidungen gegen das „Geld verbrennen"-Gefühl:
 *  - **Bargeld liegt IMMER dabei** (`cash`-Spanne je Stufe). Ein sicherer
 *    Sockel senkt keine Erwartungswerte, er verschiebt nur Preis und Inhalt
 *    gleichermaßen – dafür ist die typische Garage nicht mehr fast wertlos.
 *  - **Mehr Objekte je Garage.** Je mehr Stücke drin sind, desto näher liegt
 *    der einzelne Fund am Durchschnitt – aus Alles-oder-nichts wird Streuung.
 */
const TIERS = [
  { id: 'klein', label: 'kleine Garage', weight: 5, objectCount: [3, 5], cash: [500, 1500], carChance: 0.00 },
  { id: 'mittel', label: 'normale Garage', weight: 3, objectCount: [4, 7], cash: [1000, 3000], carChance: 0.03 },
  { id: 'gross', label: 'große Garage', weight: 2, objectCount: [5, 9], cash: [2000, 5000], carChance: 0.06 },
];

/** Vage Andeutungen – Storage-Wars-Gefühl, ohne den Inhalt zu verraten. */
const HINTS = [
  'Der Vorbesitzer war angeblich Sammler.',
  'Ein altes Auto blockiert die Sicht auf den Rest.',
  'Riecht muffig – steht wohl schon lange zu.',
  'Viele Kisten, aber alles ist verhängt.',
  'Der Auktionator zwinkert vielsagend.',
  'Sieht von außen nach Rumpelkammer aus.',
  'Ordentlich gestapelt – da hat jemand Wert drauf gelegt.',
  'Ein paar Möbel, der Rest unter Planen.',
];

/** Einleitung, wenn ausnahmsweise ein Objekt beim Namen sichtbar ist. */
const PEEK_INTROS = ['Ganz vorne erkennt man', 'Durch den Spalt sieht man', 'Obenauf liegt'];

/** Wer die Garage "versteigert" (reine Deko). */
const SELLERS = [
  'Auktionator Manni',
  'die Lagerverwaltung',
  'ein wortkarger Hausmeister',
  'die Insolvenzverwaltung',
];

module.exports = {
  OBJECTS, CASH_RANGE, RARITIES, CONDITIONS, TIERS, HINTS, PEEK_INTROS, SELLERS,
  rarityOf, conditionOf,
  weighted, pick, between,
};
