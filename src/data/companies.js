/**
 * ===========================================================================
 *  FIRMEN – Branchen, Ränge, Konstanten (Stück 1: der Kern)
 * ===========================================================================
 *
 * Gründungspreise sind realistisch („Deutschland durch drei", wie die
 * übrigen Preise im Spiel). Die Investition liegt nicht in der Gründung,
 * sondern im Ausbau – der kommt in Stück 2. Deshalb ist die Decke einer
 * nicht ausgebauten Firma bewusst niedrig (siehe company.ceilingOf).
 *
 *   price   Gründungspreis
 *   slots   Arbeitsplätze – NPCs und Spieler zusammen; das ist die Decke
 *   umsatz  Umsatz je Schicht bei Auslastung 1,0 und Rang Aushilfe
 *   lohn    Lohn je Schicht, Rang Aushilfe
 *
 * Alle Zahlen sind gegen die Messung gezogen (scripts/messung-geldquellen.js),
 * keine Behauptung. Zielmarken im Vollbetrieb: Kiosk ~2.500/Tag, Café ~20.000,
 * Spedition ~70.000 – alle unter Musik+Creator. Gemessen (365 Tage, Median):
 * Kiosk 2.584, Café 19.651, Spedition 70.380 – die Spedition stand mit
 * umsatz 2.600 bei 103.280 und damit ÜBER Musik+Creator (100.916), deshalb 1.900.
 */

/**
 * Ausbau (Stück 2a): fünf Stufen je Branche (Leiter) plus vier Extras.
 *
 *   Stufe: { id 1…5, name, price, slots (neue Platzzahl), umsatz (Faktor) }
 *   Extra: { id, name, emoji, price, umsatz (+Faktor) | slots (+Plätze), minStufe }
 *
 * Gemeinsame Regeln: Umsatzfaktoren 1,2 · 1,45 · 1,7 · 1,95 · 2,2; Stufenpreise
 * Gründung × 1,5 · 3 · 6 · 9 · 14; Extras je 2× Gründung, drei à +0,15 Umsatz,
 * eines +2 Plätze (klein +1); minStufe 3 auf dem dritten Umsatz-Extra, 2 auf dem
 * Platz-Extra. Löhne skalieren NICHT mit – die Marge wächst mit der Größe.
 * Spedition voll: 22 Plätze, Faktor 2,65 → 487.095/Tag (company.fullCeilingOf).
 * Ausnahme Baufirma: eigene Faktoren 1,3…2,5 (siehe dort), voll 558.345/Tag.
 */
const MAX_STUFE = 5;
const CONFIRM_ABOVE = 5_000_000;          // ab hier fragt der Ausbau-Knopf nach
const STUFE_FAKTOREN = [1.2, 1.45, 1.7, 1.95, 2.2];
const STUFE_PREISFAKTOREN = [1.5, 3, 6, 9, 14];
const EXTRA_PREISFAKTOR = 2;
const EXTRA_UMSATZ = 0.15;

const slug = (s) => s.toLowerCase()
  .replace(/ä/g, 'ae').replace(/ö/g, 'oe').replace(/ü/g, 'ue').replace(/ß/g, 'ss')
  .replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '');

/**
 * Die fünf Stufen einer Branche aus Preis, Namen und Platzliste. `faktoren`
 * nur, wenn die Messung es verlangt (bisher: Baufirma) – die Kernwerte bleiben.
 */
function leiter(price, names, slots, faktoren = STUFE_FAKTOREN) {
  return names.map((name, i) => ({
    id: i + 1, name, price: Math.round(price * STUFE_PREISFAKTOREN[i]),
    slots: slots[i], umsatz: faktoren[i],
  }));
}

/** Die vier Extras: drei Umsatz (das dritte ab Stufe 3), ein Platz-Extra ab Stufe 2. */
function extrasFor(branchId, price, [u1, u2, u3, s], slotsPlus) {
  const price2 = price * EXTRA_PREISFAKTOR;
  const mk = (n, fields) => ({ id: `${branchId}-${slug(n.name)}`, name: n.name, emoji: n.emoji, price: price2, ...fields });
  return [
    mk(u1, { umsatz: EXTRA_UMSATZ, minStufe: 0 }),
    mk(u2, { umsatz: EXTRA_UMSATZ, minStufe: 0 }),
    mk(u3, { umsatz: EXTRA_UMSATZ, minStufe: 3 }),
    mk(s, { slots: slotsPlus, minStufe: 2 }),
  ];
}

const E = (name, emoji) => ({ name, emoji });

const BRANCHES = [
  // ------------------------------------------------------------- klein
  { id: 'kiosk', klasse: 'klein', name: 'Kiosk', emoji: '🏪', price: 25_000, slots: 2, umsatz: 250, lohn: 100,
    blurb: 'Zeitungen, Zigaretten, kalte Getränke. Läuft fast allein – aber eben nur fast.',
    stufen: leiter(25_000, ['Kühlregal', 'Lotto-Terminal', 'Zweite Kasse', 'Backshop', 'Paketstation'], [3, 3, 4, 4, 4]),
    extras: extrasFor('kiosk', 25_000, [E('Zeitungsregal', '📰'), E('Kaffeeautomat', '☕'), E('Bargeld-Service', '💶'), E('Verlängerte Öffnung', '🌙')], 1) },
  { id: 'imbiss', klasse: 'klein', name: 'Imbiss', emoji: '🌭', price: 40_000, slots: 3, umsatz: 240, lohn: 90,
    blurb: 'Pommes, Wurst, Stammkunden. Viele billige Schichten – und Werbung, die man riecht.',
    stufen: leiter(40_000, ['Zweiter Grill', 'Sitzplätze', 'Lieferdienst', 'Zweite Theke', 'Foodtruck'], [4, 4, 5, 6, 6]),
    extras: extrasFor('imbiss', 40_000, [E('Eiswürfelmaschine', '🧊'), E('Fritteuse XL', '🍟'), E('Currywurst-Franchise', '🌭'), E('Nachtschicht', '🌙')], 1) },
  { id: 'autowaesche', klasse: 'klein', name: 'Autowäsche', emoji: '🚗', price: 35_000, slots: 2, umsatz: 260, lohn: 80,
    blurb: 'Kaum Personal, dafür Anlagen – hier steckt das Geld im Ausbau, nicht in Leuten.',
    stufen: leiter(35_000, ['Zweite Box', 'Staubsaugerplätze', 'Waschstraße', 'Innenreinigung', 'Zweite Waschstraße'], [3, 3, 4, 4, 4]),
    extras: extrasFor('autowaesche', 35_000, [E('Wachsprogramm', '✨'), E('Felgenreiniger', '🛞'), E('Kartenzahlung', '💳'), E('Sonntagsöffnung', '📅')], 1) },
  // ------------------------------------------------------------ mittel
  { id: 'cafe', klasse: 'mittel', name: 'Café', emoji: '☕', price: 120_000, slots: 5, umsatz: 900, lohn: 180,
    blurb: 'Braucht Leute hinter der Theke und jemanden, der sich kümmert. Dann läuft es.',
    stufen: leiter(120_000, ['Terrasse', 'Siebträger-Maschine', 'Frühstückskarte', 'Abendbetrieb', 'Rösterei'], [6, 7, 8, 9, 10]),
    extras: extrasFor('cafe', 120_000, [E('Kuchenvitrine', '🍰'), E('Kaffeebohnen-Verkauf', '🫘'), E('Catering', '🚐'), E('Zweite Schicht', '🌙')], 2) },
  { id: 'fitness', klasse: 'mittel', name: 'Fitnessstudio', emoji: '🏋️', price: 150_000, slots: 4, umsatz: 700, lohn: 150,
    blurb: 'Wenig Lohn, viel Gerät. Der Umsatz hängt daran, was an der Wand steht – am Ausbau.',
    stufen: leiter(150_000, ['Freihantelbereich', 'Kursraum', 'Sauna', 'Cardio-Fläche', '24-Stunden-Betrieb'], [5, 6, 6, 7, 8]),
    extras: extrasFor('fitness', 150_000, [E('Proteinbar', '🥤'), E('Personal Training', '🧑‍🏫'), E('Firmenverträge', '📄'), E('Frühöffnung', '🌅')], 2) },
  { id: 'werkstatt', klasse: 'mittel', name: 'Werkstatt', emoji: '🔧', price: 200_000, slots: 4, umsatz: 1_100, lohn: 320,
    blurb: 'Teure Fachkräfte, hoher Umsatz je Schicht. Wer gute Leute hält, verdient hier gut.',
    stufen: leiter(200_000, ['Zweite Hebebühne', 'Diagnosegerät', 'Reifenlager', 'Lackierkabine', 'Dritte Hebebühne'], [5, 6, 6, 7, 8]),
    extras: extrasFor('werkstatt', 200_000, [E('Reifenservice', '🛞'), E('TÜV-Prüfstelle', '📋'), E('Oldtimer-Restauration', '🏎️'), E('Samstagsschicht', '📅')], 2) },
  // -------------------------------------------------------------- groß
  { id: 'spedition', klasse: 'gross', name: 'Spedition', emoji: '🚚', price: 1_200_000, slots: 10, umsatz: 1_900, lohn: 420,
    blurb: 'Lkw, Fahrer, Disposition. Hohe Löhne, hohe Marge – rentabel nur mit voller Mannschaft.',
    stufen: leiter(1_200_000, ['3 Lkw', 'Depot', 'Eigene Werkstatt', 'Flotte 15', 'Flotte 20'], [12, 14, 16, 18, 20]),
    extras: extrasFor('spedition', 1_200_000, [E('Telematik', '📡'), E('Tankkarten-Vertrag', '⛽'), E('Gefahrgut-Lizenz', '☣️'), E('Nachtschicht', '🌙')], 2) },
  { id: 'baufirma', klasse: 'gross', name: 'Baufirma', emoji: '🏗️', price: 1_800_000, slots: 12, umsatz: 1_700, lohn: 500,
    blurb: 'Kolonnen, Kran, Bauhof. Die höchsten Löhne im Spiel – und nur mit voller Mannschaft ein Geschäft.',
    // Eigene Faktoren (Schritt 0,3 statt 0,25): Mit den Standardfaktoren amortisierte sich
    // der Ausbau (74,7 Mio, der teuerste im Spiel) erst nach 178 Tagen statt 60–120 – die
    // hohen Löhne fressen die Marge. Gemessen mit 2,5: siehe ARCHITEKTUR.md §15.
    // Beschluss 2026-09-13: eigene Faktoren – die Baufirma ist die Spitze (siehe ARCHITEKTUR §15).
    stufen: leiter(1_800_000, ['Zweite Kolonne', 'Kran', 'Bauhof', 'Dritte Kolonne', 'Fertigteilwerk'], [14, 17, 19, 22, 24], [1.3, 1.6, 1.9, 2.2, 2.5]),
    extras: extrasFor('baufirma', 1_800_000, [E('Eigener Bagger', '🚜'), E('Gerüstbau', '🪜'), E('Sanierungslizenz', '📜'), E('Zweite Schicht', '🌙')], 2) },
  { id: 'club', klasse: 'gross', name: 'Club', emoji: '🍸', price: 1_000_000, slots: 6, umsatz: 2_400, lohn: 380,
    blurb: 'Wenige Plätze, teurer Ausbau, und der Name muss in der Stadt sein. Werbung ist hier alles.',
    stufen: leiter(1_000_000, ['Zweite Bar', 'Soundanlage', 'Lounge', 'Zweiter Floor', 'Dachterrasse'], [7, 8, 9, 11, 12]),
    extras: extrasFor('club', 1_000_000, [E('VIP-Bereich', '👑'), E('Gastro-Lizenz', '🍽️'), E('Booking-Agentur', '🎧'), E('Afterhour', '🌙')], 2) },
];

const extraIndex = new Map(BRANCHES.flatMap((b) => b.extras.map((e) => [e.id, e])));
/** Extra per ID, oder null. */
function extraById(id) { return extraIndex.get(String(id ?? '')) ?? null; }

/** Ränge: Faktor auf Umsatz UND Lohn – der Inhaber befördert selbst. */
const RANKS = [
  { id: 0, name: 'Aushilfe', emoji: '🧹', factor: 1.0 },
  { id: 1, name: 'Fachkraft', emoji: '🔧', factor: 1.25 },
  { id: 2, name: 'Schichtleiter', emoji: '📋', factor: 1.5 },
];

const NPC_NAMES = [
  'Ali', 'Anja', 'Ben', 'Bianca', 'Cem', 'Clara', 'Dennis', 'Dilara', 'Emre', 'Eva',
  'Finn', 'Frieda', 'Gökhan', 'Greta', 'Hakan', 'Hanna', 'Igor', 'Ines', 'Jonas', 'Julia',
  'Kai', 'Katja', 'Leon', 'Lena', 'Murat', 'Mia', 'Niko', 'Nina', 'Ömer', 'Olga',
  'Paul', 'Petra', 'Rafael', 'Rosa', 'Sven', 'Selin', 'Tim', 'Tamara', 'Yusuf', 'Zoe',
];

const NPC_SHIFTS = 3;               // Schichten je NPC und Tag
const INSOLVENCY_DAYS = 14;         // so lange darf die Kasse im Minus sein
const NPC_QUIT_AFTER_UNPAID = 3;    // unbezahlte Tage, bis ein NPC kündigt
const WERBUNG_DAYS = 3;
const WERBUNG_BOOST = 0.25;         // auf das Auslastungsziel
const WERBUNG_COST_SHARE = 0.05;    // des Gründungspreises
const AUSLASTUNG_MIN = 0.3;         // ohne Personal
const AUSLASTUNG_STAFF = 0.5;       // volle Besetzung bringt 0,3 + 0,5 = 0,8; der Rest ist Werbung
const AUSLASTUNG_STEP = 0.2;        // Annäherung je Tag
const PLAYER_BONUS = 1.3;           // Umsatz einer Spieler-Schicht gegenüber NPC
const TIME_WERBUNG = 2;             // aus dem gemeinsamen Tagesbudget (creator.useTime)
const TIME_ANPACKEN = 2;
const SHIFT_COOLDOWN_MIN = 60;      // Abklingzeit einer Spieler-Schicht
const MAX_PITCH_PER_DAY = 4;        // „selbst anpacken" je Tag
const MAX_SETTLE_DAYS = 30;         // ältere Tage verfallen (wie bei Musik)

module.exports = {
  BRANCHES, RANKS, NPC_NAMES,
  NPC_SHIFTS, INSOLVENCY_DAYS, NPC_QUIT_AFTER_UNPAID, WERBUNG_DAYS, WERBUNG_BOOST,
  WERBUNG_COST_SHARE, AUSLASTUNG_MIN, AUSLASTUNG_STAFF, AUSLASTUNG_STEP, PLAYER_BONUS,
  TIME_WERBUNG, TIME_ANPACKEN, SHIFT_COOLDOWN_MIN, MAX_PITCH_PER_DAY, MAX_SETTLE_DAYS,
  MAX_STUFE, CONFIRM_ABOVE, STUFE_FAKTOREN, STUFE_PREISFAKTOREN, EXTRA_UMSATZ, extraById,
};
