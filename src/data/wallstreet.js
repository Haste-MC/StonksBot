/**
 * ===========================================================================
 *  BÖRSE – Katalog und Schlagzeilen
 * ===========================================================================
 *
 * Drei Anlageklassen, die sich spürbar unterschiedlich anfühlen:
 *
 *   stock   Einzelaktien – mittlere Schwankung, eigene Geschichte
 *   fund    Fonds-Anteile – der Durchschnitt ALLER Aktien. Weniger Ausschlag,
 *           weil sich Einzelschicksale wegmitteln (echte Diversifikation,
 *           nicht simuliert: der Preis IST der Mittelwert, siehe wallstreet.js)
 *   crypto  wild, jederzeit, ohne Rücksicht auf Verluste
 *
 * `sigma` ist die Schwankung **pro Stunde** (ein Tick). Pro Tag kommt der
 * Faktor √24 dazu: 0,008 wird also zu rund 4 % Tagesschwankung, 0,03 zu 15 %.
 *
 * WICHTIG: `sigma` beeinflusst NUR die Streuung, nie die Richtung. Der
 * Erwartungswert jedes Preises ist der aktuelle Preis (Martingal) – sonst
 * wäre die Börse ein Gelddrucker oder eine Enteignungsmaschine.
 */

const ASSETS = [
  // ============================================================== AKTIEN
  {
    symbol: 'HAST', name: 'Haste Motors', emoji: '🚗', kind: 'stock',
    sector: 'Fahrzeugbau', start: 1400, sigma: 0.009,
    blurb: 'Baut Autos, die im Autohaus stehen. Solide, langweilig, zuverlässig.',
  },
  {
    symbol: 'TOST', name: 'Toastwerk AG', emoji: '🍞', kind: 'stock',
    sector: 'Haushaltsgeräte', start: 320, sigma: 0.011,
    blurb: 'Marktführer für Geräte, die morgens nicht funktionieren.',
  },
  {
    symbol: 'ENTE', name: 'Entenreich Holding', emoji: '🦆', kind: 'stock',
    sector: 'Unterhaltung', start: 780, sigma: 0.014,
    blurb: 'Talentagentur für Wasservögel. Fragen Sie nicht nach der Bilanz.',
  },
  {
    symbol: 'GABR', name: 'Gabriel Controller Corp', emoji: '🎮', kind: 'stock',
    sector: 'Elektronik', start: 2100, sigma: 0.012,
    blurb: 'Produziert Controller schneller, als einer kaputtgehen kann.',
  },
  {
    symbol: 'MIRO', name: 'Miro Pharma', emoji: '💊', kind: 'stock',
    sector: 'Gesundheit', start: 4600, sigma: 0.010,
    blurb: 'Forscht an Mitteln gegen Sammelleidenschaft. Bisher erfolglos.',
  },
  {
    symbol: 'SIMN', name: 'Simon Sicherheitstechnik', emoji: '🛡️', kind: 'stock',
    sector: 'Sicherheit', start: 950, sigma: 0.013,
    blurb: 'Schrotflinten, Schlösser, Sorgenfreiheit. In dieser Reihenfolge.',
  },
  {
    symbol: 'BETO', name: 'Betonbau Union', emoji: '🏗️', kind: 'stock',
    sector: 'Immobilien', start: 1750, sigma: 0.008,
    blurb: 'Baut die Garagen, in denen andere ihre Autos verstecken.',
  },
  {
    symbol: 'DÖNR', name: 'Döner Systems', emoji: '🥙', kind: 'stock',
    sector: 'Gastronomie', start: 240, sigma: 0.015,
    blurb: 'Franchise mit 4000 Filialen und einem einzigen Rezept.',
  },
  {
    symbol: 'PFND', name: 'Pfand & Partner', emoji: '🍾', kind: 'stock',
    sector: 'Entsorgung', start: 95, sigma: 0.018,
    blurb: 'Sammelt ein, was andere wegwerfen. Erstaunlich profitabel.',
  },
  {
    symbol: 'LACK', name: 'Lackwerke Nord', emoji: '🎨', kind: 'stock',
    sector: 'Industrie', start: 610, sigma: 0.010,
    blurb: 'Jeder Kratzer in der Garage ist ihr Umsatz.',
  },
  {
    symbol: 'NETZ', name: 'Netzwerk Systeme', emoji: '📡', kind: 'stock',
    sector: 'Technologie', start: 3300, sigma: 0.016,
    blurb: 'Verbindet zwei Plattformen. Kommt Ihnen bekannt vor.',
  },
  {
    symbol: 'BANK', name: 'Erste Rubinbank', emoji: '🏦', kind: 'stock',
    sector: 'Finanzen', start: 2750, sigma: 0.009,
    blurb: 'Verwahrt Ihr Geld sicher – gegen Gebühr, versteht sich.',
  },
  {
    symbol: 'CASI', name: 'Casino Royale AG', emoji: '🎰', kind: 'stock',
    sector: 'Glücksspiel', start: 1150, sigma: 0.017,
    blurb: 'Das Haus gewinnt immer. Die Aktionäre meistens.',
  },
  {
    symbol: 'SCHR', name: 'Schrottplatz Müller', emoji: '🔧', kind: 'stock',
    sector: 'Recycling', start: 175, sigma: 0.014,
    blurb: 'Kauft Totalschäden, verkauft Ersatzteile. Krisensicher.',
  },
  {
    symbol: 'LAGR', name: 'Lagerhaus Consolidated', emoji: '🏬', kind: 'stock',
    sector: 'Logistik', start: 1980, sigma: 0.011,
    blurb: 'Vermietet die Garagen, die im Auktionshaus versteigert werden.',
  },
  {
    symbol: 'VERS', name: 'Allsicher Versicherung', emoji: '📋', kind: 'stock',
    sector: 'Versicherung', start: 5400, sigma: 0.007,
    blurb: 'Zahlt nie, kassiert immer. Das Geschäftsmodell des Jahrhunderts.',
  },

  // =============================================================== FONDS
  {
    symbol: 'IDX', name: 'Haste-Index', emoji: '📊', kind: 'fund',
    sector: 'Fonds', basket: 'stock', scale: 1, sigma: 0,
    blurb: 'Ein Anteil an ALLEN Aktien gleichzeitig. Kein Ausreißer nach oben, ' +
      'keiner nach unten – der ruhige Einstieg.',
  },
  {
    symbol: 'CRYX', name: 'Krypto-Korb', emoji: '🧺', kind: 'fund',
    sector: 'Fonds', basket: 'crypto', scale: 1, sigma: 0,
    blurb: 'Alle Coins in einem Anteil. Immer noch wild, aber nicht mehr Roulette.',
  },
  {
    symbol: 'BLUE', name: 'Blue-Chip-Auswahl', emoji: '💠', kind: 'fund',
    sector: 'Fonds', basket: ['MIRO', 'VERS', 'BANK', 'NETZ'], scale: 1, sigma: 0,
    blurb: 'Nur die schwersten Werte. Teuer, träge, standhaft.',
  },

  // ============================================================== KRYPTO
  {
    symbol: 'RUBI', name: 'RubinCoin', emoji: '🔴', kind: 'crypto',
    sector: 'Krypto', start: 5200, sigma: 0.028,
    blurb: 'Angeblich durch echte Rubine gedeckt. Angeblich.',
  },
  {
    symbol: 'QUAK', name: 'QuakCoin', emoji: '🟡', kind: 'crypto',
    sector: 'Krypto', start: 45, sigma: 0.040,
    blurb: 'Ein Meme mit Blockchain. Steigt und fällt aus Gründen.',
  },
  {
    symbol: 'FLXR', name: 'FluxerToken', emoji: '🟣', kind: 'crypto',
    sector: 'Krypto', start: 890, sigma: 0.031,
    blurb: 'Der Coin für Leute, die auf zwei Plattformen gleichzeitig verlieren.',
  },
  {
    symbol: 'TOAS', name: 'ToastCoin', emoji: '🟠', kind: 'crypto',
    sector: 'Krypto', start: 130, sigma: 0.045,
    blurb: 'Wird von einem Toaster im Keller geschürft. Kein Scherz.',
  },
  {
    symbol: 'GRGE', name: 'GarageCoin', emoji: '🟤', kind: 'crypto',
    sector: 'Krypto', start: 2400, sigma: 0.033,
    blurb: 'Jeder Coin ist angeblich eine echte Garage. Niemand hat je eine gesehen.',
  },
  {
    symbol: 'DUCK', name: 'DuckDAO', emoji: '🟢', kind: 'crypto',
    sector: 'Krypto', start: 760, sigma: 0.036,
    blurb: 'Dezentral verwaltet von 4000 Enten. Läuft überraschend gut.',
  },
];

/**
 * Schlagzeilen zu auffälligen Bewegungen.
 *
 * ===================== WICHTIG FÜR DIE BALANCE =====================
 * Die Nachricht entsteht NACH der Bewegung und erklärt sie nur. Sie sagt
 * nichts voraus – sonst könnte man auf die Schlagzeile hin kaufen und hätte
 * einen sicheren Gewinn (ARCHITEKTUR §3).
 * ===================================================================
 *
 * `{name}` wird ersetzt, `{pct}` ist die Veränderung in Prozent.
 */
const HEADLINES = {
  stock: {
    up: [
      '{name} meldet Rekordquartal – Aktie springt {pct} %.',
      'Übernahmegerüchte bei {name}: {pct} % im Plus.',
      '{name} bekommt Großauftrag, Anleger greifen zu (+{pct} %).',
      'Analysten stufen {name} hoch – {pct} % nach oben.',
      '{name} überrascht mit neuem Produkt: {pct} % Kursgewinn.',
    ],
    down: [
      '{name} verfehlt die Prognose deutlich – {pct} %.',
      'Rückruf bei {name}: Kurs verliert {pct} %.',
      '{name} verliert Großkunden, Anleger flüchten ({pct} %).',
      'Bilanzskandal bei {name}? Aktie bricht um {pct} % ein.',
      'Vorstand von {name} tritt zurück – {pct} %.',
    ],
  },
  crypto: {
    up: [
      '{name} explodiert um {pct} % – niemand weiß, warum.',
      'Ein Wal kauft {name}: {pct} % nach oben.',
      '{name} trendet, alle wollen rein (+{pct} %).',
      'Prominenter Tweet treibt {name} um {pct} % hoch.',
    ],
    down: [
      '{name} bricht um {pct} % ein – Panikverkäufe.',
      'Großanleger steigt aus {name} aus: {pct} %.',
      '{name} stürzt {pct} %, Forum sucht Schuldige.',
      'Gerüchte über ein Verbot: {name} verliert {pct} %.',
    ],
  },
  fund: {
    up: ['Breiter Markt zieht an – der Index gewinnt {pct} %.'],
    down: ['Der Gesamtmarkt gibt nach: Index {pct} %.'],
  },
};

/** Meldungen zur Insolvenz (Preis unter der Notierungsgrenze). */
const BANKRUPTCY = [
  '💀 **{name} ist insolvent.** Die Anteile wurden zum letzten Kurs ausgebucht.',
  '💀 **Aus für {name}.** Restwert ausgezahlt, Notierung eingestellt.',
];

/** Meldung zur Neuemission nach einer Insolvenz. */
const RELAUNCH = '🆕 **{name}** wagt den Neustart und wird zu {price} neu notiert.';

const BY_SYMBOL = new Map(ASSETS.map((a) => [a.symbol, a]));

const find = (symbol) => BY_SYMBOL.get(String(symbol ?? '').toUpperCase()) ?? null;

const KIND_LABEL = {
  stock: 'Aktie',
  fund: 'Fonds-Anteil',
  crypto: 'Krypto',
};

module.exports = { ASSETS, HEADLINES, BANKRUPTCY, RELAUNCH, KIND_LABEL, find };
