// test/beef.test.js
/**
 * Beef 5b, Stück 1: Zahlen, Texte und die reinen Rechnungen.
 * Aufruf: DATA_DIR=.testdata node test/beef.test.js
 *
 * Alle Erwartungswerte sind von Hand nachgerechnet und gegen die Spec geprüft.
 * Wer sie nicht trifft, hat einen Fehler im Code – nicht im Test.
 */
const data = require('../src/data/beef');
const beef = require('../src/beef');

let pass = 0, fail = 0;
const check = (label, ok, extra = '') => {
  if (ok) { pass++; console.log(`  ✅ ${label}`); }
  else { fail++; console.log(`  ❌ ${label} ${extra}`); }
};
const nah = (a, b, eps = 1e-6) => Math.abs(a - b) < eps;

console.log('--- Einstieg ---');
// Einstieg, ohne Charakterzug (trait 'launisch' hat +0,15 – darum 'unbekannt'
// nehmen, das ergibt 0)
check('Einstieg auf Augenhöhe 55 %',
  nah(beef.einstiegOf({ meine: 1000, seine: 1000, trait: 'x' }), 0.55));
check('Einstieg gegen den Zehnfachen 30 %',
  nah(beef.einstiegOf({ meine: 1000, seine: 10_000, trait: 'x' }), 0.30));
check('Einstieg gegen den Hundertfachen 5 %',
  nah(beef.einstiegOf({ meine: 1000, seine: 100_000, trait: 'x' }), 0.05));
check('Einstieg gegen den Tausendfachen fällt auf die Untergrenze',
  nah(beef.einstiegOf({ meine: 1000, seine: 1_000_000, trait: 'x' }), 0.02));
check('Einstieg gegen den Zehntel-Großen 80 %',
  nah(beef.einstiegOf({ meine: 1000, seine: 100, trait: 'x' }), 0.80));
check('Einstieg gegen den Hundertstel-Großen an der Obergrenze',
  nah(beef.einstiegOf({ meine: 1000, seine: 10, trait: 'x' }), 0.95));

console.log('--- Charakter ---');
check('Der Geschäftsmann steigt auf Augenhöhe ein', nah(beef.traitBonus('geschaeftlich', 1000, 1000), 0.10));
check('Der Geschäftsmann winkt beim Winzling ab', nah(beef.traitBonus('geschaeftlich', 10, 1000), -0.098));
check('Der Kollegiale mag nicht', nah(beef.traitBonus('kollegial', 1000, 1000), -0.25));
check('Ein unbekannter Zug zählt nicht mit', nah(beef.traitBonus('x', 1000, 1000), 0));

console.log('--- Wucht und Aufmerksamkeit ---');
check('Wucht auf Augenhöhe', nah(beef.wuchtOf({ seine: 1000, meine: 1000 }), 0.100343, 1e-6));
check('Wucht gegen den Tausendfachen ist gedeckelt', nah(beef.wuchtOf({ seine: 1_000_000, meine: 1000 }), 1));
check('Genrefaktor Hip-Hop ist 1', nah(beef.genrefaktorOf(1.3), 1));
check('Genrefaktor Klassik', nah(beef.genrefaktorOf(0.5), 0.384615, 1e-5));
check('Aufmerksamkeit: Riese, Hip-Hop, volle Hitze',
  nah(beef.aufmerksamkeitOf({ wucht: 1, genrefaktor: 1, hitze: 100 }), 2.5));
check('Aufmerksamkeit: Riese, Hip-Hop, Hitze 25',
  nah(beef.aufmerksamkeitOf({ wucht: 1, genrefaktor: 1, hitze: 25 }), 1.9375));
check('Aufmerksamkeit: Augenhöhe, Hip-Hop, volle Hitze',
  nah(beef.aufmerksamkeitOf({ wucht: 0.100343, genrefaktor: 1, hitze: 100 }), 1.150515, 1e-5));
check('Aufmerksamkeit: Augenhöhe, Klassik, volle Hitze',
  nah(beef.aufmerksamkeitOf({ wucht: 0.100343, genrefaktor: 0.384615, hitze: 100 }), 1.057889, 1e-5));

console.log('--- Häme ---');
check('Keine Häme auf Augenhöhe im Hip-Hop',
  nah(beef.haemeOf({ meine: 1000, seine: 1000, genrefaktor: 1 }), 0));
check('Zehnfach größer im Hip-Hop: 33,3 %',
  nah(beef.haemeOf({ meine: 10_000, seine: 1000, genrefaktor: 1 }), 0.333333, 1e-5));
check('Hundertfach größer ist gedeckelt',
  nah(beef.haemeOf({ meine: 100_000, seine: 1000, genrefaktor: 1 }), 0.6));
check('Augenhöhe in Klassik: 12,3 %',
  nah(beef.haemeOf({ meine: 1000, seine: 1000, genrefaktor: 0.384615 }), 0.123077, 1e-5));
check('Zehnfach größer in Klassik: 45,6 %',
  nah(beef.haemeOf({ meine: 10_000, seine: 1000, genrefaktor: 0.384615 }), 0.456410, 1e-5));

console.log('--- Hitze ---');
const TAG = 86_400_000;
check('Hitze kühlt 6 Punkte je Tag',
  nah(beef.hitzeJetzt({ hitze: 55, last_cool: 1000 * TAG }, 1002 * TAG), 43));
check('Hitze fällt nie unter 0',
  nah(beef.hitzeJetzt({ hitze: 10, last_cool: 1000 * TAG }, 1010 * TAG), 0));
check('Ohne Zeile ist die Hitze 0', beef.hitzeJetzt(null, 1000 * TAG) === 0);

console.log('--- Runden und Ausgang ---');
check('Diss ohne Häme: Runde für mich', beef.rundeNachDiss(false) === 'ich');
check('Diss mit Häme: Runde für ihn', beef.rundeNachDiss(true) === 'er');
check('Konter eines Großen zählt', beef.rundeNachKonter(0.5) === 'er');
check('Konter eines Winzlings wirkt lächerlich', beef.rundeNachKonter(0.1) === 'ich');
check('Konter genau an der Grenze (0,2) zählt noch als seiner', beef.rundeNachKonter(0.2) === 'er');
check('2:1 ist ein Sieg', beef.ausgangOf(2, 1) === 'sieg');
check('1:2 ist eine Niederlage', beef.ausgangOf(1, 2) === 'niederlage');
check('1:1 ist unentschieden', beef.ausgangOf(1, 1) === 'unentschieden');
check('Sieg zahlt 1,25', nah(beef.bonusFaktor('sieg'), 1.25));
check('Niederlage zahlt 0,85', nah(beef.bonusFaktor('niederlage'), 0.85));
check('Frieden zahlt nichts', nah(beef.bonusFaktor('frieden'), 1));

console.log('--- Anzählen ---');
// Anzählen: wer nah dran ist, wiegt schwerer
const g1 = beef.anzaehlGewicht({ trait: 'arrogant', meine: 10_000, seine: 10_000, gleichesGenre: true, verwandtesGenre: false });
const g2 = beef.anzaehlGewicht({ trait: 'kollegial', meine: 10_000, seine: 10_000_000, gleichesGenre: false, verwandtesGenre: false });
const g3 = beef.anzaehlGewicht({ trait: 'x', meine: 10_000, seine: 10_000, gleichesGenre: false, verwandtesGenre: true });
check('Der nahe Arrogante wiegt schwerer als der ferne Kollegiale', g1 > g2 * 5, `${g1} / ${g2}`);
check('Anzählgewicht: gleiches Genre, gleiche Größe, arrogant', nah(g1, 3.6), `${g1}`);
check('Anzählgewicht: verwandtes Genre, gleiche Größe, Zug ohne Bonus', nah(g3, 2.0), `${g3}`);
check('Anzählgewicht: fremdes Genre, Gegner tausendfach größer, kollegial', nah(g2, 0.25), `${g2}`);

console.log('--- Zahlen und Aktionen ---');
check('Zwei Beef-Aktionen mit 2 h',
  data.BEEF_AKTIONEN.length === 2 && data.BEEF_AKTIONEN.every((a) => a.time === 2 && a.id && a.name && a.emoji));
check('Anstacheln kostet zwei Stunden', data.BEEF_TIME === 2);
check('Anstacheln und Frieden sind die beiden Aktionen',
  data.BEEF_AKTIONEN.map((a) => a.id).join(',') === 'anstacheln,frieden');
check('Hitze deckelt bei 100', data.HITZE_MAX === 100);
check('Höchstens zwei offene Beefs', data.BEEFS_MAX === 2);
check('Fünf Charakterzüge beim Streit', Object.keys(data.BEEF_TRAIT).length === 5);

console.log('--- Texte ---');
const VERBOTEN = ['wirklich', 'in echt', 'Politik', 'Religion', 'krank', 'Familie', 'hässlich'];
check('Fünf Charakterzüge in LINES', Object.keys(data.LINES).length === 5);
check('LINES deckt jeden Charakterzug aus BEEF_TRAIT ab',
  Object.keys(data.BEEF_TRAIT).every((t) => data.LINES[t]));
for (const [trait, lagen] of Object.entries(data.LINES)) {
  check(`${trait} hat vier Lagen`,
    ['einstieg', 'blamage', 'konter', 'ende'].every((l) => Array.isArray(lagen[l])));
  for (const [lage, zeilen] of Object.entries(lagen)) {
    check(`${trait}/${lage} hat drei Zeilen`, zeilen.length === 3);
    for (const z of zeilen) {
      check(`${trait}/${lage} bleibt in der Spielfiktion`,
        !VERBOTEN.some((w) => z.toLowerCase().includes(w.toLowerCase())), z);
      check(`${trait}/${lage} nennt den Kontakt`, z.includes('{name}'), z);
    }
  }
}
check('60 Zeilen insgesamt',
  Object.values(data.LINES).reduce((s, l) => s + Object.values(l).reduce((t, z) => t + z.length, 0), 0) === 60);

console.log('--- textFor ---');
check('textFor setzt den Namen ein',
  beef.textFor('arrogant', 'einstieg', 'Lil Pfand', () => 0).includes('Lil Pfand'));
check('textFor lässt keinen Platzhalter stehen',
  !beef.textFor('kuehl', 'konter', 'Rammstein', () => 0.99).includes('{name}'));
check('textFor greift bei random 0,999 noch die letzte Zeile',
  beef.textFor('launisch', 'ende', 'X', () => 0.999999) === data.LINES.launisch.ende[2].replace('{name}', 'X'));
check('textFor gibt bei unbekanntem Zug nichts zurück', beef.textFor('x', 'ende', 'X', () => 0) === '');
check('textFor gibt bei unbekannter Lage nichts zurück', beef.textFor('kuehl', 'y', 'X', () => 0) === '');

console.log(`\n${pass} bestanden, ${fail} fehlgeschlagen`);
process.exit(fail === 0 ? 0 : 1);
