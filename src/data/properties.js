/**
 * Der Immobilienkatalog.
 *
 *   stock   Begrenzte Stückzahl – ist alles vergeben, gibt es nichts mehr.
 *           Mieter zählen mit: eine vermietete Wohnung ist belegt.
 *   garage  Stellplätze. Diese Zahl begrenzt, wie viele Autos man besitzen darf.
 *   rent    Tagesmiete. Etwa Kaufpreis/350 – nach knapp einem Jahr Miete
 *           hätte man das Objekt auch kaufen können.
 *
 * `search`/`must` steuern die Bildsuche auf Wikimedia Commons.
 */
module.exports = [
  // ------------------------------------------------------------- Anfang
  { category: 'Zimmer', name: 'WG-Zimmer', price: 12000, rent: 40, garage: 0, stock: 20, emoji: '🛏️',
    description: '14 m² · Bad geteilt · Küche geteilt — der Anfang von allem.',
    search: 'shared room apartment interior', must: ['room'] },
  { category: 'Zimmer', name: 'Souterrainzimmer', price: 18000, rent: 60, garage: 0, stock: 14, emoji: '🕯️',
    description: '20 m² · eigenes Bad · wenig Tageslicht, dafür günstig.',
    search: 'basement apartment building', must: ['basement', 'souterrain'] },
  { category: 'Zimmer', name: 'Dachkammer', price: 24000, rent: 75, garage: 0, stock: 12, emoji: '🪟',
    description: '26 m² · Dachschräge · Aussicht über die Dächer.',
    search: 'attic room apartment', must: ['attic', 'garret'] },

  // ---------------------------------------------------------- Wohnungen
  { category: 'Wohnung', name: '1-Zimmer-Wohnung', price: 38000, rent: 110, garage: 0, stock: 18, emoji: '🏢',
    description: '32 m² · Stadtrand · Bus vor der Tür.',
    search: 'apartment building facade', must: ['apartment'] },
  { category: 'Wohnung', name: '2-Zimmer-Altbau', price: 72000, rent: 210, garage: 1, stock: 12, emoji: '🏢',
    description: '58 m² · Stuck · Parkett · ein Stellplatz im Hof.',
    search: 'Altbau apartment building Berlin', must: ['altbau', 'apartment'] },
  { category: 'Wohnung', name: '3-Zimmer-Wohnung', price: 105000, rent: 300, garage: 1, stock: 10, emoji: '🏢',
    description: '78 m² · Balkon · Tiefgaragenplatz inklusive.',
    search: 'modern apartment building residential', must: ['apartment', 'residential'] },
  { category: 'Wohnung', name: 'Maisonette', price: 165000, rent: 470, garage: 1, stock: 7, emoji: '🪜',
    description: '96 m² über zwei Etagen · innenliegende Treppe.',
    search: 'maisonette apartment building', must: ['maisonette', 'duplex'] },
  { category: 'Wohnung', name: 'Loft im Speicher', price: 290000, rent: 830, garage: 2, stock: 5, emoji: '🧱',
    description: '140 m² · 4,2 m Deckenhöhe · Sichtbacksteine · Rampe als Garage.',
    search: 'loft warehouse conversion building', must: ['loft', 'warehouse'] },
  { category: 'Wohnung', name: 'Penthouse', price: 950000, rent: 2700, garage: 3, stock: 3, emoji: '🌆',
    description: '180 m² · Dachterrasse · Aufzug direkt in die Wohnung.',
    search: 'penthouse rooftop apartment building', must: ['penthouse'] },

  // ------------------------------------------------------------- Häuser
  { category: 'Haus', name: 'Reihenhaus', price: 195000, rent: 560, garage: 1, stock: 10, emoji: '🏘️',
    description: '110 m² · kleiner Garten · Garage an der Seite.',
    search: 'terraced houses row', must: ['terraced', 'row house'] },
  { category: 'Haus', name: 'Doppelhaushälfte', price: 265000, rent: 760, garage: 2, stock: 8, emoji: '🏡',
    description: '135 m² · Garten · Doppelgarage.',
    search: 'semi-detached house', must: ['semi-detached', 'doppelhaus'] },
  { category: 'Haus', name: 'Einfamilienhaus', price: 380000, rent: 1090, garage: 2, stock: 7, emoji: '🏡',
    description: '160 m² · 600 m² Grundstück · zwei Stellplätze.',
    search: 'detached family house garden', must: ['house'] },
  { category: 'Haus', name: 'Bungalow', price: 340000, rent: 970, garage: 2, stock: 6, emoji: '🏠',
    description: '145 m² ebenerdig · großzügige Fensterfront.',
    search: 'bungalow house architecture', must: ['bungalow'] },
  { category: 'Haus', name: 'Fachwerkhaus', price: 420000, rent: 1200, garage: 1, stock: 4, emoji: '🪵',
    description: '170 m² · Baujahr 1687 · denkmalgeschützt.',
    search: 'Fachwerkhaus timber framed house', must: ['fachwerk', 'timber'] },
  { category: 'Haus', name: 'Stadthaus', price: 560000, rent: 1600, garage: 2, stock: 5, emoji: '🏙️',
    description: '200 m² auf vier Etagen · Innenstadtlage.',
    search: 'townhouse city architecture', must: ['townhouse', 'town house'] },
  { category: 'Haus', name: 'Landhaus', price: 720000, rent: 2050, garage: 4, stock: 4, emoji: '🌳',
    description: '240 m² · 4000 m² Grund · Scheune als Garage.',
    search: 'country house manor garden', must: ['country house', 'manor'] },

  // ------------------------------------------------------------- Villen
  { category: 'Villa', name: 'Stadtvilla', price: 1250000, rent: 3550, garage: 4, stock: 3, emoji: '🏛️',
    description: '310 m² · Gründerzeit · Auffahrt mit vier Plätzen.',
    search: 'villa mansion architecture', must: ['villa'] },
  { category: 'Villa', name: 'Villa am See', price: 2400000, rent: 6850, garage: 6, stock: 2, emoji: '🏞️',
    description: '420 m² · eigener Steg · Tiefgarage für sechs Wagen.',
    search: 'lakeside villa house', must: ['villa', 'lake'] },
  { category: 'Villa', name: 'Bergvilla', price: 3100000, rent: 8850, garage: 5, stock: 2, emoji: '🏔️',
    description: '390 m² · Panoramafenster · Serpentine bis zur Haustür.',
    search: 'chalet Switzerland alps house', must: ['chalet'] },
  { category: 'Villa', name: 'Mediterrane Villa', price: 4200000, rent: 12000, garage: 8, stock: 2, emoji: '🌴',
    description: '520 m² · Pool · Olivenhain · achtfache Garage.',
    search: 'mediterranean villa pool', must: ['villa'] },
  { category: 'Villa', name: 'Herrenhaus', price: 6800000, rent: 19400, garage: 10, stock: 1, emoji: '🎩',
    description: '780 m² · Park · Remise mit zehn Stellplätzen.',
    search: 'manor house estate architecture', must: ['manor'] },

  // ------------------------------------------------------------ Extreme
  { category: 'Anwesen', name: 'Schloss', price: 18000000, rent: 51000, garage: 15, stock: 1, emoji: '🏰',
    description: '2400 m² · 40 Zimmer · Wagenhalle für fünfzehn Fahrzeuge.',
    search: 'castle schloss architecture', must: ['castle', 'schloss'] },
  { category: 'Anwesen', name: 'Leuchtturm', price: 890000, rent: 2540, garage: 0, stock: 1, emoji: '🗼',
    description: '95 m² auf sechs Ebenen · kein Stellplatz, dafür Weitblick.',
    search: 'lighthouse building coast', must: ['lighthouse', 'leuchtturm'] },
  { category: 'Anwesen', name: 'Hausboot', price: 240000, rent: 690, garage: 0, stock: 4, emoji: '🛥️',
    description: '85 m² schwimmend · Liegeplatz inklusive, Garage unmöglich.',
    search: 'houseboat floating home', must: ['houseboat'] },
  { category: 'Anwesen', name: 'Berghütte', price: 310000, rent: 890, garage: 1, stock: 5, emoji: '🛖',
    description: '70 m² · Holzofen · im Winter nur mit Kette erreichbar.',
    search: 'alpine hut cabin mountain', must: ['hut', 'cabin', 'hütte'] },
  { category: 'Anwesen', name: 'Umgebauter Bauernhof', price: 640000, rent: 1830, garage: 6, stock: 3, emoji: '🚜',
    description: '280 m² · Stall zur Werkstatt umgebaut · sechs Plätze.',
    search: 'converted farmhouse barn', must: ['farmhouse', 'farm house'] },
];
