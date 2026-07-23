/**
 * Welche Wörter im Dateinamen eines Fotos als Beleg für eine Marke gelten.
 *
 * Nötig, weil Dateien auf Commons oft Kurzformen nutzen ("VW Golf" statt
 * "Volkswagen Golf") oder die Untermarke weglassen ("Mercedes-Benz" statt
 * "Mercedes-AMG").
 */
const ALIASES = {
  // Modellnamen, die eindeutig zu einer Marke gehören, zählen als Beleg –
  // viele Dateinamen lauten nur "Golf R mk7" ohne Herstellernennung.
  'Volkswagen': ['volkswagen', 'vw', 'golf', 'polo', 'passat', 'scirocco'],
  'Mercedes-Benz': ['mercedes', 'benz'],
  'Mercedes-AMG': ['mercedes', 'amg', 'benz'],
  'Alfa Romeo': ['alfa'],
  'Aston Martin': ['aston'],
  'Rolls-Royce': ['rolls'],
  'Chevrolet': ['chevrolet', 'chevy', 'corvette'],
};

/** Erlaubte Marken-Tokens für einen Markennamen. */
function brandTokens(brand) {
  if (ALIASES[brand]) return ALIASES[brand];
  return [brand.split(/[\s-]/)[0].toLowerCase()];
}

/** Kommt die Marke im Text vor? */
function mentionsBrand(text, brand) {
  const lower = text.toLowerCase();
  return brandTokens(brand).some((t) => lower.includes(t));
}

module.exports = { brandTokens, mentionsBrand };
