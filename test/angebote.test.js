// test/angebote.test.js
/**
 * Angebote 5c, Stück 1: Zahlen, Texte und die reinen Rechnungen.
 * Aufruf: DATA_DIR=.testdata node test/angebote.test.js
 *
 * Alle Erwartungswerte sind nachgerechnet und gegen die Spec
 * (docs/superpowers/specs/2026-10-02-angebote-design.md) geprüft. Wer sie
 * nicht trifft, hat einen Fehler im Code – nicht im Test.
 *
 * Zwei Zahlen aus dem Aufgabenheft sind dabei berichtigt worden, weil sie der
 * Formel desselben Hefts widersprachen; beide Stellen sind unten einzeln
 * begründet (Honorar-Deckel, Kollabo-Faktor).
 */
const data = require('../src/data/angebote');
const ang = require('../src/angebote');

let pass = 0, fail = 0;
const check = (label, ok, extra = '') => {
  if (ok) { pass++; console.log(`  ✅ ${label}`); }
  else { fail++; console.log(`  ❌ ${label} ${extra}`); }
};
const nah = (a, b, eps = 1e-6) => Math.abs(a - b) < eps;

console.log('--- Gewichtung ---');
check('unter Draht 20 meldet sich niemand', ang.gewichtOf({ draht: 19, passung: 1 }) === 0);
check('Bekannter wiegt 1', nah(ang.gewichtOf({ draht: 20, passung: 1 }), 1));
check('Partner wiegt 4', nah(ang.gewichtOf({ draht: 50, passung: 1 }), 4));
check('die Passung geht voll ein', nah(ang.gewichtOf({ draht: 50, passung: 0.3 }), 1.2));
check('ohne Passung meldet sich auch ein Partner nicht',
  ang.gewichtOf({ draht: 100, passung: 0 }) === 0);

console.log('--- Honorar ---');
/**
 * `tantiemenProTag` kommt aus `music.royaltyPerDay`. Die Spec nennt die Werte
 * gerundet (60/Tag bei 1.000 Hörern, 949/Tag bei 10.000) und die Deckel aus
 * den UNGERUNDETEN Werten (1.796 und 28.468). Beides zusammen geht nicht
 * auf – 30 × 949 ist 28.470. Hier stehen deshalb die ungerundeten Werte, dann
 * stimmen die Deckel der Spec-Tabelle auf den Cent.
 */
const TANT_1K = 59.87438528167906;    // royaltyPerDay(1_000),  Markt 1,0 → Deckel 1.796
const TANT_10K = 948.9450563572701;   // royaltyPerDay(10_000), Markt 1,0 → Deckel 28.468
check('Honorar gegen Lil Pfand', ang.honorarOf({ seine: 8_400, tantiemenProTag: TANT_10K }) === 679);
check('Honorar gegen Oxmo', ang.honorarOf({ seine: 350_000, tantiemenProTag: TANT_10K }) === 6_362);
check('Honorar gegen Nina Chuba', ang.honorarOf({ seine: 3_200_000, tantiemenProTag: TANT_10K }) === 24_000);
check('gegen Hans Zimmer greift der Deckel',
  ang.honorarOf({ seine: 110_000_000, tantiemenProTag: TANT_10K }) === 28_468);
check('ein Winzling bekommt immer genau 30 Tage',
  ang.honorarOf({ seine: 110_000_000, tantiemenProTag: 60 }) === 1_800);
// Die erste Zeile der Spec-Tabelle: bei 1.000 eigenen Hörern bindet der Deckel
// überall außer beim kleinsten Kontakt.
check('bei 1.000 Hörern reicht Lil Pfand noch unter den Deckel',
  ang.honorarOf({ seine: 8_400, tantiemenProTag: TANT_1K }) === 679);
check('bei 1.000 Hörern deckelt Oxmo auf 1.796',
  ang.honorarOf({ seine: 350_000, tantiemenProTag: TANT_1K }) === 1_796);
check('bei 1.000 Hörern deckelt auch Hans Zimmer auf 1.796',
  ang.honorarOf({ seine: 110_000_000, tantiemenProTag: TANT_1K }) === 1_796);
// Zum Mitlesen, warum oben die ungerundete Zahl steht:
check('mit der gerundeten Anzeigezahl 949 wäre der Deckel 28.470',
  ang.honorarOf({ seine: 110_000_000, tantiemenProTag: 949 }) === 28_470);
check('ohne eigene Tantiemen gibt es kein Honorar',
  ang.honorarOf({ seine: 110_000_000, tantiemenProTag: 0 }) === 0);
check('ein Kontakt ohne Reichweite bringt nichts',
  ang.honorarOf({ seine: 0, tantiemenProTag: TANT_10K }) === 0);

console.log('--- Gage ---');
// SHOW_PAY 8, SHOW_EXP 0,7 – dieselben Zahlen wie das Konzert in src/music.js
const g = (meine, seine) => ang.gageOf({ meine, seine, showPay: 8, showExp: 0.7 });
check('allein spielt sich schlechter', g(10_000, 8_400) === 5_195);
check('bei Oxmo ist die Deckelung erreicht', g(10_000, 350_000) === 8_200);
check('und darüber wird es nicht mehr', g(10_000, 110_000_000) === 8_200);
check('wer selbst groß ist, merkt Oxmo kaum', g(100_000, 350_000) === 28_322);
check('die Deckelung ist genau 2^0,7',
  nah(g(10_000, 110_000_000) / Math.round(8 * Math.pow(10_000, 0.7)), Math.pow(2, 0.7), 1e-3));

console.log('--- Kollabo-Faktor ---');
/**
 * Die Werte sind mit `log10(1 + seine/max(100, meine))/3` gerechnet, also der
 * Formel aus Spec und Aufgabenheft. Das Heft nennt dazu sechsstellige
 * Erwartungswerte (1,518514 · 1,835922 · 1,043479), die diese Formel nicht
 * trifft; die Spec selbst nennt dreistellig ×1,519 · ×1,836 · ×2,000 · ×1,043
 * und stimmt damit mit der Formel überein. Hier stehen die gerechneten Werte.
 */
const k = (meine, seine) => ang.kollaboFaktorOf({ meine, seine });
check('Kollabo mit Oxmo', nah(k(10_000, 350_000), 1.518768, 1e-5), String(k(10_000, 350_000)));
check('Kollabo mit Nina Chuba', nah(k(10_000, 3_200_000), 1.835502, 1e-5), String(k(10_000, 3_200_000)));
check('die Obergrenze ist das Doppelte', nah(k(10_000, 110_000_000), 2));
check('wer selbst groß ist, holt wenig', nah(k(1_000_000, 350_000), 1.043445, 1e-5), String(k(1_000_000, 350_000)));
check('ein Kontakt ohne Reichweite bringt nichts dazu', nah(k(10_000, 0), 1));
check('unter 100 eigenen Hörern wird mit 100 gerechnet',
  nah(k(1, 900), k(100, 900)));

console.log('--- Fristen ---');
const TAG = 86_400_000;
check('eine Anfrage läuft drei Tage', ang.fristOf(1000 * TAG) === 1003 * TAG);
check('ohne Uhr wird einmal gewürfelt', ang.rollTage(0, 5 * TAG) === 1);
check('zwei Tage geben zwei Würfe', ang.rollTage(1000 * TAG, 1002 * TAG) === 2);
check('mehr als sieben Tage werden nicht nachgeholt',
  ang.rollTage(1000 * TAG, 1030 * TAG) === 7);
check('innerhalb eines Tages wird nicht gewürfelt',
  ang.rollTage(1000 * TAG, 1000 * TAG + 3600e3) === 0);
check('eine Uhr aus der Zukunft würfelt nicht rückwärts',
  ang.rollTage(1000 * TAG, 999 * TAG) === 0);

console.log('--- Die sechs Arten ---');
check('es gibt sechs Arten', data.ARTEN.length === 6);
check('die Ids stehen so in der Spec',
  data.ARTEN.map((a) => a.id).join(',') === 'tausch,gastpart,vorgruppe,kollabo,tour,label');
check('jede Art hat Name, Emoji, Zeit und Draht-Schwelle',
  data.ARTEN.every((a) => a.name && a.emoji && typeof a.time === 'number' && typeof a.minDraht === 'number'));
check('die drei großen Formate kommen nur von Partnern',
  data.ARTEN.filter((a) => a.minDraht === 50).map((a) => a.id).join(',') === 'kollabo,tour,label');
check('die drei kleinen Anfragen kommen ab Bekanntschaft',
  data.ARTEN.filter((a) => a.minDraht === 20).map((a) => a.id).join(',') === 'tausch,gastpart,vorgruppe');
check('Kollabo und Tour kosten bei der Annahme keine Zeit',
  data.ARTEN.filter((a) => a.time === 0).map((a) => a.id).join(',') === 'kollabo,tour');
/**
 * Die Namen der Arten stehen in der Anzeige direkt neben dem Namen des
 * Kontakts – „seiner Platte" liest sich bei der Hälfte des Katalogs falsch.
 */
const POSSESSIV = /\b(seine[rmsn]?|ihre[rmsn]?)\b/i;
for (const a of data.ARTEN) {
  check(`${a.id} nennt kein Geschlecht`, !POSSESSIV.test(a.name), a.name);
}

console.log('--- Texte ---');
check('fünf Charakterzüge', Object.keys(data.LINES).length === 5);
check('und zwar dieselben wie in 5a/5b',
  Object.keys(data.LINES).sort().join(',') === 'arrogant,geschaeftlich,kollegial,kuehl,launisch');
/**
 * Die Sperrliste steht im Test, nicht im Datenmodul: Keine Pronomen über den
 * Kontakt (`{name}` ist ein echter Künstlername jeden Geschlechts), und nichts
 * über Meinung, Gesundheit, Familie oder Politik eines Menschen.
 */
const VERBOTEN = [' er ', ' sie ', ' ihn ', ' ihm ', ' ihr ', 'seine ', 'ihre ',
  'wirklich', 'Politik', 'krank', 'Familie'];
let zeilen_gesamt = 0;
for (const [trait, lagen] of Object.entries(data.LINES)) {
  check(`${trait} hat drei Lagen`,
    Object.keys(lagen).sort().join(',') === 'absage,anfrage,zusage');
  for (const [lage, zeilen] of Object.entries(lagen)) {
    check(`${trait}/${lage} hat drei Zeilen`, zeilen.length === 3);
    for (const z of zeilen) {
      zeilen_gesamt++;
      check(`${trait}/${lage} nennt {name}`, z.includes('{name}'), z);
      check(`${trait}/${lage} bleibt in der Spielfiktion`,
        !VERBOTEN.some((w) => ` ${z.toLowerCase()} `.includes(w.toLowerCase())), z);
    }
  }
}
check('zusammen 45 Zeilen', zeilen_gesamt === 45);

console.log('--- textFor ---');
check('der Name wird eingesetzt',
  ang.textFor('kollegial', 'anfrage', 'Taylor Swift', () => 0)
  === 'Taylor Swift schreibt: „Ich hab da was, das ohne dich nicht funktioniert."');
check('ein hoher Wurf nimmt die letzte Zeile',
  ang.textFor('kollegial', 'anfrage', 'Ado', () => 0.999)
  === data.LINES.kollegial.anfrage[2].replaceAll('{name}', 'Ado'));
check('auch ein Wurf von genau 1 bleibt in der Liste',
  ang.textFor('kuehl', 'absage', 'Rosalía', () => 1)
  === data.LINES.kuehl.absage[2].replaceAll('{name}', 'Rosalía'));
check('ein unbekannter Charakterzug gibt leer zurück',
  ang.textFor('gibtsnicht', 'anfrage', 'Rammstein') === '');
check('eine unbekannte Lage gibt leer zurück',
  ang.textFor('kollegial', 'gibtsnicht', 'Igor Levit') === '');
check('nach dem Einsetzen steht kein Platzhalter mehr drin',
  !ang.textFor('arrogant', 'zusage', 'Rammstein', () => 0.5).includes('{name}'));

console.log(`\n${pass} bestanden, ${fail} fehlgeschlagen`);
process.exit(fail === 0 ? 0 : 1);
