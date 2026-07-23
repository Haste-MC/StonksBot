/**
 * Ausrüstung und Qualifikationen – der zweite Shop.
 *
 * Diese Artikel sind Voraussetzung für bestimmte Jobs im Arbeitsamt.
 * `category` gruppiert sie im Shop (wie die Marke bei Autos).
 *
 * VERSCHLEISS
 * -----------
 * Physische Ausrüstung kann bei der Arbeit kaputtgehen und muss dann neu
 * gekauft werden. Die Wahrscheinlichkeit hängt an der Kategorie, nicht am
 * einzelnen Artikel – dadurch sind Führerscheine und Ausbildungen
 * strukturell unzerstörbar und können nicht versehentlich verschleißen.
 *
 * Einzelne Artikel können mit `wear` abweichen (teure Geräte halten länger).
 */
const WEAR_BY_CATEGORY = {
  'Werkzeug': 0.04,      // ~alle 25 Schichten
  'Ausstattung': 0.04,
  'Technik': 0.02,       // ~alle 50 Schichten
  'Führerschein': 0,     // verschleißt nie
  'Ausbildung': 0,       // verschleißt nie
};

const ITEMS = [
  // ------------------------------------------------------------ Führerscheine
  { category: 'Führerschein', name: 'Führerschein Klasse B', price: 2500, emoji: '🪪',
    description: 'Berechtigt zum Führen von PKW. Grundlage für fast alles auf vier Rädern.' },
  { category: 'Führerschein', name: 'Führerschein Klasse C', price: 6000, emoji: '🪪',
    description: 'LKW-Führerschein. Pflicht für alles über 3,5 Tonnen.' },
  { category: 'Führerschein', name: 'Personenbeförderungsschein', price: 4000, emoji: '🪪',
    description: 'Nötig, um Fahrgäste gewerblich zu befördern.' },
  { category: 'Führerschein', name: 'Motorradführerschein', price: 3000, emoji: '🏍️',
    description: 'Klasse A – für alles auf zwei Rädern.' },
  { category: 'Führerschein', name: 'Pilotenlizenz', price: 85000, emoji: '✈️',
    description: 'Verkehrsflugzeugführerschein. Jahrelange Ausbildung, entsprechend teuer.' },
  { category: 'Führerschein', name: 'Bootsführerschein', price: 5500, emoji: '⛵',
    description: 'Sportbootführerschein See.' },

  // -------------------------------------------------------------- Werkzeug
  { category: 'Werkzeug', name: 'Werkzeugkasten', price: 800, emoji: '🧰',
    description: 'Solides Grundwerkzeug. Ohne das geht handwerklich gar nichts.' },
  { category: 'Werkzeug', name: 'Schweißgerät', price: 2200, emoji: '🔥',
    description: 'Elektrodenschweißgerät für Metallbau und Karosserie.' },
  { category: 'Werkzeug', name: 'Motorsäge', price: 1400, emoji: '🪚',
    description: 'Profigerät für Forstarbeit. Inklusive Schnittschutzhose.' },
  { category: 'Werkzeug', name: 'Diagnosegerät', price: 4500, emoji: '🔌',
    description: 'Liest Fehlerspeicher moderner Fahrzeuge aus.' },
  { category: 'Werkzeug', name: 'Hebebühne', price: 12000, emoji: '🏗️', wear: 0.008,
    description: 'Zwei-Säulen-Hebebühne. Macht aus einer Garage eine Werkstatt.' },
  { category: 'Werkzeug', name: 'Maurerkelle', price: 200, emoji: '🧱',
    description: 'Kelle, Wasserwaage, Richtscheit. Der Klassiker.' },

  // ---------------------------------------------------------------- Technik
  { category: 'Technik', name: 'Laptop', price: 1800, emoji: '💻',
    description: 'Ordentliches Arbeitsgerät für alles Digitale.' },
  { category: 'Technik', name: 'Entwickler-Workstation', price: 6500, emoji: '🖥️',
    description: '64 GB RAM, 24 Kerne. Kompiliert alles, ohne zu klagen.' },
  { category: 'Technik', name: 'Kameraausrüstung', price: 5200, emoji: '📷',
    description: 'Vollformat-Body plus drei Objektive.' },
  { category: 'Technik', name: 'Streaming-Setup', price: 3400, emoji: '🎙️',
    description: 'Mikrofon, Licht, Capture-Card. Der halbe Weg zur Reichweite.' },
  { category: 'Technik', name: 'Serverschrank', price: 15000, emoji: '🗄️', wear: 0.006,
    description: 'Eigene Infrastruktur im Rack. Läuft und läuft.' },

  // ------------------------------------------------------------- Ausbildung
  { category: 'Ausbildung', name: 'Meisterbrief', price: 18000, emoji: '📜',
    description: 'Handwerksmeister. Berechtigt zur Führung eines eigenen Betriebs.' },
  { category: 'Ausbildung', name: 'Approbation', price: 95000, emoji: '⚕️',
    description: 'Ärztliche Zulassung nach abgeschlossenem Medizinstudium.' },
  { category: 'Ausbildung', name: 'Anwaltszulassung', price: 70000, emoji: '⚖️',
    description: 'Zwei Staatsexamen und die Aufnahme in die Anwaltskammer.' },
  { category: 'Ausbildung', name: 'Rennlizenz', price: 25000, emoji: '🏁',
    description: 'Internationale Lizenz für den Motorsport.' },
  { category: 'Ausbildung', name: 'Kochausbildung', price: 7500, emoji: '👨‍🍳',
    description: 'Abgeschlossene Lehre in der Gastronomie.' },
  { category: 'Ausbildung', name: 'Fluglotsen-Schein', price: 60000, emoji: '🗼',
    description: 'Eine der stressigsten Ausbildungen überhaupt.' },
  { category: 'Ausbildung', name: 'Trainerlizenz', price: 9000, emoji: '📣',
    description: 'Lizenz zum Trainieren von Mannschaften im Leistungsbereich.' },
  { category: 'Ausbildung', name: 'Sprengschein', price: 22000, emoji: '💥',
    description: 'Erlaubnis zum Umgang mit Sprengstoff. Gründlich geprüft.' },
  { category: 'Ausbildung', name: 'Taucherschein', price: 4800, emoji: '🤿',
    description: 'Berufstaucher-Qualifikation für Arbeiten unter Wasser.' },
  { category: 'Ausbildung', name: 'Kranführerschein', price: 5800, emoji: '🏗️',
    description: 'Befähigung zum Führen von Turmdrehkranen.' },

  // ------------------------------------------------------------- Ausstattung
  { category: 'Ausstattung', name: 'Arbeitskleidung', price: 350, emoji: '🦺',
    description: 'Sicherheitsschuhe, Warnweste, Helm. Pflicht auf jeder Baustelle.' },
  { category: 'Ausstattung', name: 'Anzug', price: 1200, emoji: '👔',
    description: 'Maßgeschneidert. Öffnet Türen in bestimmten Branchen.' },
  { category: 'Ausstattung', name: 'Kochmesser-Set', price: 900, emoji: '🔪',
    description: 'Geschmiedete Klingen. Jeder Koch hat seine eigenen.' },
  { category: 'Ausstattung', name: 'Medizinkoffer', price: 2800, emoji: '🩺',
    description: 'Notfallausrüstung für den mobilen Einsatz.' },
  { category: 'Ausstattung', name: 'Angelausrüstung', price: 1100, emoji: '🎣',
    description: 'Ruten, Rollen, Netze. Für die ruhige Art des Gelderwerbs.' },
  { category: 'Ausstattung', name: 'Imkeranzug', price: 600, emoji: '🐝',
    description: 'Vollschutz plus Smoker. Die Bienen danken es nicht.' },
];

/** Verschleißwahrscheinlichkeit pro Schicht (0 = unzerstörbar). */
function wearChance(item) {
  if (!item) return 0;
  return item.wear ?? WEAR_BY_CATEGORY[item.category] ?? 0;
}

const byName = new Map(ITEMS.map((i) => [i.name.toLowerCase(), i]));

/** Ausrüstungsdefinition per Name (case-insensitiv). */
function findGear(name) {
  return byName.get(String(name).toLowerCase()) ?? null;
}

/** Kann dieser Artikel überhaupt kaputtgehen? */
function isBreakable(name) {
  return wearChance(findGear(name)) > 0;
}

module.exports = ITEMS;
module.exports.WEAR_BY_CATEGORY = WEAR_BY_CATEGORY;
module.exports.wearChance = wearChance;
module.exports.findGear = findGear;
module.exports.isBreakable = isBreakable;
