/**
 * Prüft die gefundenen Fotos auf Fehlgriffe.
 *
 * Substring-Treffer sind gefährlich: "GLA 45" enthält "A 45", "Golf" enthält
 * kein Modelljahr, usw. Hier wird jeder Dateiname gegen Marke und Modell
 * geprüft und alles Verdächtige gemeldet.
 *
 * Aufruf: node scripts/audit-images.js
 */
const catalog = require('../src/data/catalog');
const images = require('../src/data/images.json');
const { mentionsBrand, brandTokens } = require('../src/data/brands');

// Modelle, die als Teilwort in anderen Modellnamen vorkommen können.
const CONFUSABLE = [
  { car: /A 45|A45/i, wrong: /\bGLA|\bCLA/i, note: 'GLA/CLA statt A-Klasse' },
  { car: /C 63|C63/i, wrong: /\bGLC|\bCLS/i, note: 'GLC/CLS statt C-Klasse' },
  { car: /G 63|G63/i, wrong: /\bGLE|\bGLS|\bGLC/i, note: 'GLE/GLS statt G-Klasse' },
  { car: /\bM3\b/i, wrong: /\bM340|\bM4\b/i, note: 'M340i/M4 statt M3' },
  { car: /\bM5\b/i, wrong: /\bM550/i, note: 'M550i statt M5' },
  { car: /\bRS4\b|RS 4/i, wrong: /\bRS4 B[578]\b/i, note: 'falsche RS4-Generation' },
  { car: /Model S/i, wrong: /Model 3|Model X|Model Y/i, note: 'anderes Tesla-Modell' },
  { car: /Model 3/i, wrong: /Model S|Model X|Model Y/i, note: 'anderes Tesla-Modell' },
];

/**
 * Wörter, die auf ein ungeeignetes Foto hindeuten.
 * Wortgrenzen sind Pflicht: ohne sie matcht "toy" auf "Toyota" und
 * "motor" auf "Motorsport" – genau der Teilstring-Fehler, den dieser
 * Audit eigentlich finden soll.
 */
const BAD_SUBJECT =
  /\b(interior|innenraum|engine|cockpit|dashboard|wheel|felge|badge|logo|emblem|taillight|headlight|rücklicht|scheinwerfer|chassis|replica|toy|lego|miniature)\b|\bmodel car\b|\bmodellauto\b|\bscale model\b/i;

let problems = 0, ok = 0, missing = 0;

console.log('Prüfe Fotos gegen Modellnamen...\n');

for (const car of catalog) {
  const img = images[car.name];
  if (!img) { missing++; console.log(`⚠️  ${car.name} — kein Foto`); continue; }

  const file = decodeURIComponent(img.url.split('/').pop()).replace(/_/g, ' ');
  const issues = [];

  // 1) Marke muss vorkommen – Kurzformen wie "VW" gelten mit.
  if (!mentionsBrand(file, car.brand)) {
    issues.push(`keine Marke (${brandTokens(car.brand).join('/')}) im Dateinamen`);
  }

  // 2) Bekannte Verwechslungen.
  for (const rule of CONFUSABLE) {
    if (rule.car.test(car.name) && rule.wrong.test(file)) {
      issues.push(rule.note);
    }
  }

  // 3) Ausdrücklich ausgeschlossene Begriffe aus dem Katalog.
  for (const n of car.not ?? []) {
    if (file.toLowerCase().includes(n.toLowerCase())) {
      issues.push(`enthält ausgeschlossenes "${n}"`);
    }
  }

  // 4) Ungeeignetes Motiv.
  if (BAD_SUBJECT.test(file)) issues.push('kein Fahrzeug-Gesamtbild');

  if (issues.length) {
    problems++;
    console.log(`❌ ${car.name}`);
    console.log(`   Datei: ${file}`);
    console.log(`   Problem: ${issues.join('; ')}\n`);
  } else {
    ok++;
  }
}

console.log(`\n${ok} unauffällig, ${problems} verdächtig, ${missing} ohne Foto.`);
if (problems) {
  console.log('\nVerdächtige Einträge in src/data/catalog.js über "must" präzisieren');
  console.log('und scripts/fetch-images.js erneut laufen lassen.');
}
process.exit(problems > 0 ? 1 : 0);
