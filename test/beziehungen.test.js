// test/beziehungen.test.js
/**
 * Beziehungen 6a: Spalten, Wanderung, Gedächtnis, Arithmetik, Arten.
 * Aufruf: rm -rf .testdata && DATA_DIR=.testdata node test/beziehungen.test.js
 */
const db = require('../src/db');

let pass = 0, fail = 0;
const check = (label, ok, extra = '') => {
  if (ok) { pass++; console.log(`  ✅ ${label}`); }
  else { fail++; console.log(`  ❌ ${label} ${extra}`); }
};
const near = (a, b, eps = 1e-9) => Math.abs(a - b) < eps;

const G = 'g1';
const U = 'u1';

(async () => {
  console.log('--- Spalten und abgeleiteter Draht ---');
  {
    db.saveContact(G, U, 'lilpfand', {
      respekt: 40, vertrauen: 20, boden: 0,
      tries: 3, yes: 1, last_try: 1000, last_move: 1000, ignored_at: 0 });
    const row = db.getContact(G, U, 'lilpfand');
    check('Achsen kommen zurück', row.respekt === 40 && row.vertrauen === 20, JSON.stringify(row));
    check('Draht ist der Mittelwert', row.draht === 30, String(row.draht));
    check('Boden, Zähler und Zeiten bleiben',
      row.boden === 0 && row.tries === 3 && row.yes === 1 && row.last_try === 1000);

    // Ungerade Summe: Math.round rundet bei .5 nach oben.
    db.saveContact(G, U, 'ninachuba', { respekt: 41, vertrauen: 20 });
    check('ungerade Summe wird gerundet',
      db.getContact(G, U, 'ninachuba').draht === 31,
      String(db.getContact(G, U, 'ninachuba').draht));

    // Negative Achsen.
    db.saveContact(G, U, 'drake', { respekt: 10, vertrauen: -80 });
    check('negativer Mittelwert', db.getContact(G, U, 'drake').draht === -35,
      String(db.getContact(G, U, 'drake').draht));

    check('Lesen legt keine Zeile an (§4)', db.getContact(G, U, 'rammstein') === null);
  }

  console.log('--- Gedächtnis ---');
  {
    for (let i = 1; i <= 15; i++) {
      db.addMemory(G, U, 'lilpfand',
        { at: 1000 + i, art: 'zusage', detail: `t${i}`, dRespekt: i, dVertrauen: i }, 12);
    }
    check('auf zwölf gekappt', db.memoryCount(G, U, 'lilpfand') === 12,
      String(db.memoryCount(G, U, 'lilpfand')));
    const neueste = db.memoryOf(G, U, 'lilpfand', 3);
    check('neueste zuerst',
      neueste.length === 3 && neueste[0].detail === 't15' && neueste[2].detail === 't13',
      JSON.stringify(neueste.map((m) => m.detail)));
    check('die ältesten drei sind weg',
      !db.memoryOf(G, U, 'lilpfand', 12).some((m) => ['t1', 't2', 't3'].includes(m.detail)));
    check('Deltas werden mitgeführt',
      neueste[0].d_respekt === 15 && neueste[0].d_vertrauen === 15);
    check('je Kontakt eigene Kappung', db.memoryCount(G, U, 'ninachuba') === 0);
  }

  console.log(`\n${pass} bestanden, ${fail} fehlgeschlagen`);
  process.exit(fail === 0 ? 0 : 1);
})();
