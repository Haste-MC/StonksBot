/**
 * Private Anbieter ("NPCs") für den Gebraucht- und Immobilienmarkt.
 *
 * Sie füllen den Markt, wenn gerade wenige Spieler etwas anbieten, und sorgen
 * für Preisstreuung: die meisten Anzeigen sind fair, manche ein echtes
 * Schnäppchen, manche dreist überteuert. Genau wie in echten Kleinanzeigen.
 */

/**
 * Preisstufen. `weight` bestimmt die Häufigkeit, `range` den Faktor auf den
 * Zeitwert (also Neupreis × Zustand).
 *
 * Die Verteilung ist bewusst schief: gute Angebote sind selten genug, dass
 * sich regelmäßiges Nachschauen lohnt, aber häufig genug, dass es sich nicht
 * aussichtslos anfühlt.
 */
const DEALS = [
  {
    id: 'steal', weight: 4, range: [0.20, 0.40], label: '🔥 Verdächtig günstig',
    reasons: [
      'Muss heute weg, ich wandere aus.',
      'Erbstück, ich brauche nur den Platz.',
      'Scheidung. Frag nicht.',
      'Keine Zeit für Verhandlungen, erster der zahlt kriegt ihn.',
    ],
  },
  {
    id: 'bargain', weight: 14, range: [0.45, 0.75], label: '💚 Günstig',
    reasons: [
      'Zwangsverkauf wegen Umzug.',
      'Brauche schnell Bargeld.',
      'Steht nur rum, weg damit.',
      'Nachlass meines Onkels.',
    ],
  },
  {
    id: 'fair', weight: 52, range: [0.85, 1.15], label: '⚪ Marktüblich',
    reasons: [
      'Gepflegter Zustand, alle Papiere da.',
      'Zweithand, scheckheftgepflegt.',
      'Privatverkauf, keine Garantie.',
      'Besichtigung nach Absprache.',
    ],
  },
  {
    id: 'steep', weight: 22, range: [1.30, 1.90], label: '🟠 Überteuert',
    reasons: [
      'Preis ist Verhandlungsbasis. Also fast.',
      'Liebhaberstück, das gibt man nicht her.',
      'Ich weiß was ich habe.',
      'Der Preis steht, keine Mails mit Angeboten.',
    ],
  },
  {
    id: 'delusional', weight: 8, range: [2.50, 5.00], label: '🤡 Realitätsfern',
    reasons: [
      'SAMMLERSTÜCK!!! Wertsteigerung garantiert!!',
      'Absolut selten, Preis nicht verhandelbar.',
      'Wer es sich leisten kann, fragt nicht nach dem Preis.',
      'Unter diesem Preis verschrotte ich es lieber.',
    ],
  },
];

/**
 * Zustandsverteilung für gebrauchte Autos.
 * Die Mehrheit ist brauchbar, echte Wracks und Perlen sind selten.
 */
const CONDITIONS = [
  { weight: 8, range: [10, 30] },    // Bastlerfahrzeug
  { weight: 22, range: [30, 55] },   // abgenutzt
  { weight: 40, range: [55, 78] },   // normaler Gebrauchter
  { weight: 22, range: [78, 92] },   // gepflegt
  { weight: 8, range: [92, 100] },   // fast neu
];

const SELLERS = [
  'Autohaus Brenner', 'Kleinanzeige von Meike', 'Privatverkauf Ortmann',
  'Ali (Kleinanzeigen)', 'Hof Lindenau', 'Garage Vukovic', 'Familie Schwarz',
  'Erbengemeinschaft Kessler', 'Nachlassverwaltung Rieck', 'Karsten aus Bochum',
  'Sammlung Dr. Wendt', 'Umzugsauflösung Nord', 'Werkstatt Cicek',
  'Nachbar Grabowski', 'Frau Öztürk', 'Hofladen Sieberts', 'Herr Pawlak',
  'Anonyme Anzeige', 'Jens & Söhne', 'Restposten Havemann',
];

/** Zusatztexte für beschädigte Fahrzeuge – erklärt den schlechten Zustand. */
const DAMAGE_NOTES = [
  'Kratzer an der Fahrerseite, sonst top.',
  'Hagelschaden, rein optisch.',
  'Parkrempler hinten links, fährt einwandfrei.',
  'TÜV abgelaufen, muss gemacht werden.',
  'Kupplung schleift, sonst gepflegt.',
  'Innenraum riecht nach Hund. Ehrlich gesagt.',
  'Kleiner Wildunfall, repariert aber sichtbar.',
  'Rost am Schweller, Substanz aber gut.',
];

/**
 * Begründungen speziell für Mietanzeigen. Die Verkaufs-Sprüche aus DEALS
 * passen dort nicht ("Privatverkauf, keine Garantie" bei einer Wohnung, die
 * man mietet, liest sich falsch).
 */
const RENT_REASONS = {
  steal: [
    'Wohnung steht leer, Hauptsache jemand wohnt drin.',
    'Miete weit unter Marktwert, ich will nur zuverlässige Mieter.',
    'Der Vormieter ist überstürzt ausgezogen.',
  ],
  bargain: [
    'Etwas hellhörig, dafür günstig.',
    'Erdgeschoss zur Straße, deshalb der Preis.',
    'Heizung ist alt, Miete dafür fair.',
  ],
  fair: [
    'Ortsübliche Vergleichsmiete, Nebenkosten extra.',
    'Langfristige Vermietung bevorzugt.',
    'Staffelmiete ausgeschlossen, Preis bleibt.',
  ],
  steep: [
    'Lage, Lage, Lage. Das kostet.',
    'Möbliert, deshalb der Aufschlag.',
    'Wer hier wohnen will, zahlt das auch.',
  ],
  delusional: [
    'Miete ist Miete. Verhandeln zwecklos.',
    'EXKLUSIVE LAGE!!! Nur für gehobene Ansprüche!',
    'Ich vermiete lieber gar nicht als unter diesem Preis.',
  ],
};

/** Texte für Immobilienanzeigen. */
const PROPERTY_NOTES = [
  'Provisionsfrei, Übergabe nach Absprache.',
  'Renovierungsbedürftig, dafür der Preis.',
  'Bezugsfrei ab sofort.',
  'Ruhige Lage, gute Anbindung.',
  'Nur an Nichtraucher.',
  'Kaution zwei Monatsmieten.',
  'Von privat, keine Makler bitte.',
  'Frisch gestrichen, Boden neu.',
];

/** Zieht ein Element gemäß seiner Gewichtung. */
function weighted(list, random = Math.random) {
  const total = list.reduce((s, e) => s + e.weight, 0);
  let roll = random() * total;
  for (const entry of list) {
    if (roll < entry.weight) return entry;
    roll -= entry.weight;
  }
  return list[list.length - 1];
}

const pick = (list, random = Math.random) => list[Math.floor(random() * list.length)];
const between = ([min, max], random = Math.random) => min + random() * (max - min);

module.exports = {
  DEALS, CONDITIONS, SELLERS, DAMAGE_NOTES, PROPERTY_NOTES, RENT_REASONS,
  weighted, pick, between,
};
