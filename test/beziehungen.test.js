// test/beziehungen.test.js
/**
 * Beziehungen 6a: Spalten, Wanderung, Gedächtnis, Arithmetik, Arten.
 * Aufruf: rm -rf .testdata && DATA_DIR=.testdata node test/beziehungen.test.js
 */
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { DatabaseSync } = require('node:sqlite');
const db = require('../src/db');

let pass = 0, fail = 0;
const check = (label, ok, extra = '') => {
  if (ok) { pass++; console.log(`  ✅ ${label}`); }
  else { fail++; console.log(`  ❌ ${label} ${extra}`); }
};
const near = (a, b, eps = 1e-9) => Math.abs(a - b) < eps;

const G = 'g1';
const G2 = 'g2';
const U = 'u1';
const U2 = 'u2';

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

    check('Lesen legt keine Zeile an (§4)',
      db.getContact(G, U, 'rammstein') === null && db.contactsOf(G, U).length === 3,
      String(db.contactsOf(G, U).length));

    // Negative ungerade Summe: -61 / 2 = -30,5. Math.round rundet bei .5 immer
    // nach oben (-30); eine "weg von der Null"-Rundung gäbe -31. (Math.ceil ist
    // bei ganzzahligen Achsen von Math.round nicht zu unterscheiden: die Summe
    // ist ganzzahlig, die Hälfte also .0 oder .5, und dort fallen beide zusammen.)
    db.saveContact(G, U2, 'ezhel', { respekt: -41, vertrauen: -20 });
    check('negative ungerade Summe rundet zur Null hin (-30,5 -> -30)',
      db.getContact(G, U2, 'ezhel').draht === -30,
      String(db.getContact(G, U2, 'ezhel').draht));

    // Bruchwerte auf einer Einzelachse werden mit Math.round gerundet.
    db.saveContact(G, U2, 'rammstein', { respekt: 40.5, vertrauen: -40.5 });
    const br = db.getContact(G, U2, 'rammstein');
    check('Bruchwert je Achse wird gerundet (40,5 -> 41; -40,5 -> -40)',
      br.respekt === 41 && br.vertrauen === -40, JSON.stringify(br));
    check('Draht aus den gerundeten Achsen (41 + -40 -> 1)',
      br.draht === 1, String(br.draht));

    // Ein Bruch, der nicht auf .5 endet: hier trennt sich Math.round von
    // Math.ceil (40,3 -> 40 statt 41; -20,7 -> -21 statt -20).
    db.saveContact(G, U2, 'drake', { respekt: 40.3, vertrauen: -20.7 });
    const bn = db.getContact(G, U2, 'drake');
    check('Bruchwert mit .3/.7 wird gerundet, nicht aufgerundet (40,3 -> 40; -20,7 -> -21)',
      bn.respekt === 40 && bn.vertrauen === -21 && bn.draht === 10, JSON.stringify(bn));
  }

  console.log('--- Fortschreiben derselben Zeile (ON CONFLICT) ---');
  {
    db.saveContact(G, U2, 'anitta', {
      respekt: 20, vertrauen: 10, boden: -5,
      tries: 1, yes: 0, last_try: 100, last_move: 100, ignored_at: 0 });
    const a1 = db.getContact(G, U2, 'anitta');
    check('erstes Speichern: Boden ungleich 0 kommt zurück',
      a1.respekt === 20 && a1.vertrauen === 10 && a1.boden === -5 && a1.draht === 15,
      JSON.stringify(a1));

    db.saveContact(G, U2, 'anitta', {
      respekt: 60, vertrauen: 30, boden: 7,
      tries: 2, yes: 1, last_try: 200, last_move: 300, ignored_at: 400 });
    const a2 = db.getContact(G, U2, 'anitta');
    check('zweites Speichern schreibt respekt fort', a2.respekt === 60, JSON.stringify(a2));
    check('zweites Speichern schreibt vertrauen fort', a2.vertrauen === 30, JSON.stringify(a2));
    check('zweites Speichern schreibt boden fort', a2.boden === 7, JSON.stringify(a2));
    check('Draht wandert mit den Achsen (60/30 -> 45)', a2.draht === 45, String(a2.draht));
    check('Zähler und Zeiten werden fortgeschrieben',
      a2.tries === 2 && a2.yes === 1 && a2.last_try === 200
        && a2.last_move === 300 && a2.ignored_at === 400, JSON.stringify(a2));
    check('Fortschreiben legt keine zweite Zeile an',
      db.contactsOf(G, U2).filter((c) => c.contact_id === 'anitta').length === 1);
  }

  console.log('--- Gedächtnis ---');
  {
    const fuelle = (g, u, c, n, tag, max) => {
      for (let i = 1; i <= n; i++) {
        db.addMemory(g, u, c, { at: i, art: 'zusage', detail: `${tag}${i}`,
          dRespekt: 1, dVertrauen: 1 }, max);
      }
    };
    // Drei Nachbarn des Kontakts "lilpfand": anderer Kontakt, anderer Nutzer,
    // andere Gilde. Sie werden VOR lilpfand gefüllt, damit dessen Einträge
    // die jüngeren sind – nur dann verrät jeder fehlende Filter in der
    // Kappung sich (an der Unterabfrage genauso wie am DELETE).
    fuelle(G, U, 'ninachuba', 5, 'k', 12);
    fuelle(G, U2, 'lilpfand', 5, 'u', 12);
    fuelle(G2, U, 'lilpfand', 5, 'g', 12);

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

    // Jeder Nachbar bekommt einen weiteren Eintrag; seine Kappung läuft.
    // Ohne Filter würde sie die jüngeren lilpfand-Einträge mitzählen
    // (Unterabfrage) oder löschen (DELETE).
    fuelle(G, U, 'ninachuba', 1, 'k+', 12);
    fuelle(G, U2, 'lilpfand', 1, 'u+', 12);
    fuelle(G2, U, 'lilpfand', 1, 'g+', 12);
    check('Kappung berührt anderen Kontakt desselben Nutzers nicht',
      db.memoryCount(G, U, 'ninachuba') === 6 && db.memoryCount(G, U, 'lilpfand') === 12,
      `${db.memoryCount(G, U, 'ninachuba')}/${db.memoryCount(G, U, 'lilpfand')}`);
    check('Kappung berührt anderen Nutzer derselben Gilde nicht',
      db.memoryCount(G, U2, 'lilpfand') === 6 && db.memoryCount(G, U, 'lilpfand') === 12,
      `${db.memoryCount(G, U2, 'lilpfand')}/${db.memoryCount(G, U, 'lilpfand')}`);
    check('Kappung berührt andere Gilde nicht',
      db.memoryCount(G2, U, 'lilpfand') === 6 && db.memoryCount(G, U, 'lilpfand') === 12,
      `${db.memoryCount(G2, U, 'lilpfand')}/${db.memoryCount(G, U, 'lilpfand')}`);
    check('die gekappte Erzählung des Nachbarn bleibt vollständig',
      db.memoryOf(G, U, 'ninachuba', 12).map((m) => m.detail).join() === 'k+1,k5,k4,k3,k2,k1',
      db.memoryOf(G, U, 'ninachuba', 12).map((m) => m.detail).join());
  }

  console.log('--- clearContacts löscht auch das Gedächtnis ---');
  {
    const U3 = 'u3';
    const U4 = 'u4';
    for (const [u, cs] of [[U3, ['lilpfand', 'ninachuba']], [U4, ['lilpfand']]]) {
      for (const c of cs) {
        db.saveContact(G, u, c, { respekt: 10, vertrauen: 10 });
        for (let i = 1; i <= 3; i++) {
          db.addMemory(G, u, c, { at: i, art: 'zusage', detail: `c${i}` }, 12);
        }
      }
    }
    check('Vorbedingung: Einträge und Zeilen sind da',
      db.memoryCount(G, U3, 'lilpfand') === 3 && db.memoryCount(G, U3, 'ninachuba') === 3
        && db.contactsOf(G, U3).length === 2);

    db.clearContacts(G, U3);
    check('clearContacts entfernt die Drähte', db.getContact(G, U3, 'lilpfand') === null
      && db.getContact(G, U3, 'ninachuba') === null && db.contactsOf(G, U3).length === 0);
    check('clearContacts entfernt das Gedächtnis aller Kontakte',
      db.memoryCount(G, U3, 'lilpfand') === 0 && db.memoryCount(G, U3, 'ninachuba') === 0,
      `${db.memoryCount(G, U3, 'lilpfand')}/${db.memoryCount(G, U3, 'ninachuba')}`);
    check('Draht und Gedächtnis eines anderen Nutzers bleiben stehen',
      db.getContact(G, U4, 'lilpfand') !== null && db.memoryCount(G, U4, 'lilpfand') === 3,
      `${db.memoryCount(G, U4, 'lilpfand')}`);
  }

  console.log('--- Wanderung (Altdatenbank, Kindprozess) ---');
  {
    const dir = path.resolve(__dirname, '..', '.testdata-wanderung');
    const dbPfad = path.join(dir, 'shop.db');
    const dbModul = path.resolve(__dirname, '..', 'src', 'db.js');
    fs.rmSync(dir, { recursive: true, force: true });
    try {
      fs.mkdirSync(dir, { recursive: true });

      // Der Zustand vor 6a: contacts OHNE respekt, vertrauen, boden.
      const alt = new DatabaseSync(dbPfad);
      alt.exec(`CREATE TABLE contacts (
        guild_id TEXT NOT NULL, user_id TEXT NOT NULL, contact_id TEXT NOT NULL,
        draht INTEGER NOT NULL DEFAULT 0, tries INTEGER NOT NULL DEFAULT 0,
        yes INTEGER NOT NULL DEFAULT 0, last_try INTEGER NOT NULL DEFAULT 0,
        last_move INTEGER NOT NULL DEFAULT 0, ignored_at INTEGER NOT NULL DEFAULT 0,
        PRIMARY KEY (guild_id, user_id, contact_id))`);
      const ins = alt.prepare(
        'INSERT INTO contacts (guild_id, user_id, contact_id, draht, tries, yes, last_try)'
        + ' VALUES (?, ?, ?, ?, ?, ?, ?)');
      ins.run('gw', 'uw', 'lilpfand', 44, 5, 2, 777);
      ins.run('gw', 'uw', 'drake', -30, 1, 0, 888);
      alt.close();

      // Ein Start von src/db.js gegen dieses Verzeichnis, danach Auslesen.
      const start = () => JSON.parse(execFileSync(process.execPath, ['-e', `
        const db = require(${JSON.stringify(dbModul)});
        const rows = db.contactsOf('gw', 'uw').map((r) => ({
          id: r.contact_id, draht: r.draht, respekt: r.respekt,
          vertrauen: r.vertrauen, boden: r.boden, tries: r.tries,
          yes: r.yes, last_try: r.last_try }));
        process.stdout.write(JSON.stringify(rows));
        process.exit(0);`], {
        env: { ...process.env, DATA_DIR: dir },
        encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'],
      }).trim().split('\n').pop());
      const je = (rows, id) => rows.find((r) => r.id === id);

      const erst = start();
      check('Wanderung: zwei Zeilen überleben', erst.length === 2, JSON.stringify(erst));
      const e1 = je(erst, 'lilpfand'), e2 = je(erst, 'drake');
      check('Wanderung: Respekt und Vertrauen starten auf dem alten Draht',
        e1.respekt === 44 && e1.vertrauen === 44 && e2.respekt === -30 && e2.vertrauen === -30,
        JSON.stringify(erst));
      check('Wanderung: Draht, Boden, Zähler bleiben unverändert',
        e1.draht === 44 && e2.draht === -30 && e1.boden === 0 && e2.boden === 0
          && e1.tries === 5 && e1.yes === 2 && e1.last_try === 777 && e2.last_try === 888,
        JSON.stringify(erst));

      // Zwischen den Starts ändern sich die Achsen (so, dass sie vom Draht abweichen).
      const mitte = new DatabaseSync(dbPfad);
      mitte.exec(`UPDATE contacts SET respekt = 70, vertrauen = 10, boden = 9
                   WHERE contact_id = 'lilpfand'`);
      mitte.close();

      const zweit = start();
      const z1 = je(zweit, 'lilpfand');
      check('Wanderung läuft genau einmal: zweiter Start lässt die Achsen stehen',
        z1.respekt === 70 && z1.vertrauen === 10 && z1.boden === 9, JSON.stringify(zweit));
      check('zweiter Start: die andere Zeile ebenso unberührt',
        je(zweit, 'drake').respekt === -30 && je(zweit, 'drake').vertrauen === -30,
        JSON.stringify(zweit));
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  }

  console.log(`\n${pass} bestanden, ${fail} fehlgeschlagen`);
  process.exit(fail === 0 ? 0 : 1);
})();
