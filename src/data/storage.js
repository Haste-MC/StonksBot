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
 * Basis-Objekte: nur Name + Basiswertspanne (Seltenheit „common"). Seltenheit
 * und Zustand skalieren diesen Basiswert. Bewusst überschaubar gehalten –
 * die Spannbreite entsteht über die Seltenheitsstufen.
 */
const OBJECTS = [
  { name: 'Kiste altes Werkzeug', range: [50, 300] },
  { name: 'Stapel alte Schallplatten', range: [80, 400] },
  { name: 'Voller Werkzeugkoffer', range: [120, 500] },
  { name: 'Alte Armbanduhr', range: [100, 600] },
  { name: 'Antike Vase', range: [150, 800] },
  { name: 'Gerahmtes Gemälde', range: [200, 900] },
  { name: 'Vergessene Münzsammlung', range: [120, 700] },
  { name: 'AWP - Dragonlore', range: [2750, 7560] },
  { name: 'Simons Schrotflinte', range: [400, 2450] },
  { name: 'Miros Pokemon Karten', range: [50, 500] },
  { name: '1 von Gabriels 300 Controllern', range: [20, 300] },
  { name: 'Ente mit Talenten', range: [50, 1000] },
  { name: 'Haste MCs Motorradteile', range: [20, 700] },
  { name: 'Toaster', range: [5, 400] },
];

/** Wie viel Bargeld in einer Kiste stecken kann, wenn welches drin ist. */
const CASH_RANGE = [200, 3000];

/**
 * Seltenheitsstufen: `weight` = grobe Drop-Wahrscheinlichkeit in Prozent
 * (weighted() normalisiert über die Summe), `mult` = Wert-Multiplikator.
 *
 * Ab „Godlike" wird es *respektlos* selten – die Stufen sind absichtlich fast
 * unerreichbar, dafür bei einem Treffer absurd wertvoll. Vorgabe: legendary 1 %,
 * Mythic 0,5 %. Der common-Wert wird unten so gesetzt, dass die Summe = 100
 * ergibt, damit diese Prozente exakt stimmen.
 */
const RARITY_TAIL = [
  { id: 'uncommon',     label: 'Uncommon',     emoji: '🟢', weight: 25,            mult: 2 },
  { id: 'rare',         label: 'Rare',         emoji: '🔵', weight: 9,             mult: 4 },
  { id: 'epic',         label: 'Epic',         emoji: '🟣', weight: 3.5,           mult: 8 },
  { id: 'legendary',    label: 'Legendary',    emoji: '🟡', weight: 1,             mult: 20 },
  { id: 'mythic',       label: 'Mythic',       emoji: '🔴', weight: 0.5,           mult: 60 },
  // ---- ab hier respektlos selten ----
  { id: 'godlike',      label: 'Godlike',      emoji: '🟠', weight: 0.05,          mult: 200 },
  { id: 'cosmic',       label: 'Cosmic',       emoji: '🌌', weight: 0.005,         mult: 800 },
  { id: 'primordial',   label: 'Primordial',   emoji: '🩸', weight: 0.0005,        mult: 4000 },
  { id: 'celestial',    label: 'Celestial',    emoji: '🌟', weight: 0.00003,       mult: 20000 },
  { id: 'eternal',      label: 'Eternal',      emoji: '♾️',  weight: 0.000005,      mult: 100000 },
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
  { id: 'beschaedigt',    label: 'beschädigt',     emoji: '💢', weight: 18, mult: 0.4 },
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
 * drin sind und wie wahrscheinlich Bargeld/ein Auto dazukommt.
 */
const TIERS = [
  { id: 'klein', label: 'kleine Garage', weight: 5, objectCount: [1, 3], cashChance: 0.15, carChance: 0.00 },
  { id: 'mittel', label: 'normale Garage', weight: 3, objectCount: [2, 5], cashChance: 0.25, carChance: 0.03 },
  { id: 'gross', label: 'große Garage', weight: 2, objectCount: [3, 7], cashChance: 0.35, carChance: 0.06 },
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
