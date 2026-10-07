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

// Eigene Schlüssel: npm test fährt alle Dateien gegen EINE Datenbank, und die
// Kontakt-Familie davor schreibt in dieselben Tabellen.
const G = 'b6a-g1';
const G2 = 'b6a-g2';
const U = 'b6a-u1';
const U2 = 'b6a-u2';
const U3 = 'b6a-u3';
const U4 = 'b6a-u4';
const U5 = 'b6a-u5';
const U6 = 'b6a-u6';   // Anfragen: braucht einen Künstler und ein Zeitbudget

/** Alles aufräumen, was diese Datei anlegt – vorher UND nachher, nie ein Leerstand vorausgesetzt. */
const aufraeumen = () => {
  for (const [g, u] of [[G, U], [G, U2], [G2, U], [G, U3], [G, U4], [G, U5], [G, U6]]) db.clearContacts(g, u);
  // `request` bucht Zeit und liest den Künstler – beides bliebe sonst für den
  // zweiten Lauf gegen dieselbe Datenbank stehen.
  db.clearArtist(G, U6);
  db.clearCreator(G, U6);
};

(async () => {
  aufraeumen();

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

  console.log('--- Parität gegen die alte Kette ---');
  {
    const contacts = require('../src/contacts');
    const cdata = require('../src/data/contacts');

    // Die alten Draht-Deltas, wie main sie rechnete.
    const ALT = { zusage: 12, echt: 6, fluechtig: 2, ignoriert: -1, verstimmt: -5 };
    const klemm = (v) => Math.max(-100, Math.min(100, v));

    /** Die alte Kette: EIN Draht, Abkühlen mit contacts.decay. */
    const altKette = (folge) => folge.reduce((draht, [art, tage]) =>
      klemm(contacts.decay(draht, tage) + ALT[art]), 0);

    /**
     * Die neue Kette mit GLEICHMÄSSIGER Spaltung und gleicher Abkühlrate:
     * beide Achsen tragen in jedem Schritt dasselbe, also gilt (d+d)/2 = d.
     *
     * Das ist eine ENTARTUNG, und sie ist mit Absicht so gebaut: Die Rundung in
     * drahtVon wird nie berührt (die Summe ist immer gerade), und die echten
     * ACHSEN und echten Abkühlraten kommen in keiner der beiden Ketten vor.
     * Bewiesen ist damit: die BUCHFÜHRUNG ist neutral (decayAchse mit Boden 0
     * verhält sich wie decay, drahtVon(d, d) ist d). NICHT bewiesen ist das
     * Spielverhalten – mit den echten Zahlen laufen die Ketten auseinander, und
     * das ist gewollt; der Abschnitt „Die gewollte Abweichung" unten hält es fest.
     * Weicht dieser Abschnitt ab, liegt der Fehler in der Mechanik, nicht in den Zahlen.
     */
    const neuKette = (folge) => {
      let r = 0, v = 0;
      for (const [art, tage] of folge) {
        const ab = Math.floor(Math.max(0, tage) / 7) * cdata.DRAHT_DECAY_PRO_WOCHE;
        r = klemm(contacts.decayAchse(r, ab, 0) + ALT[art]);
        v = klemm(contacts.decayAchse(v, ab, 0) + ALT[art]);
      }
      return contacts.drahtVon(r, v);
    };

    const folgen = [
      [['zusage', 0]],
      [['zusage', 0], ['zusage', 0], ['zusage', 0], ['zusage', 0], ['zusage', 0]],
      [['ignoriert', 3], ['ignoriert', 3], ['ignoriert', 3], ['verstimmt', 7]],
      [['zusage', 0], ['zusage', 0], ['fluechtig', 70]],
      [['verstimmt', 0], ['verstimmt', 0], ['verstimmt', 0], ['verstimmt', 0],
        ['verstimmt', 0], ['verstimmt', 0], ['verstimmt', 0], ['verstimmt', 0],
        ['verstimmt', 0], ['verstimmt', 0], ['verstimmt', 0], ['verstimmt', 0],
        ['verstimmt', 0], ['verstimmt', 0], ['verstimmt', 0], ['verstimmt', 0],
        ['verstimmt', 0], ['verstimmt', 0], ['verstimmt', 0], ['verstimmt', 0],
        ['verstimmt', 0], ['verstimmt', 0]],            // läuft an die −100
      [['zusage', 0], ['zusage', 0], ['zusage', 0], ['zusage', 0], ['zusage', 0],
        ['zusage', 0], ['zusage', 0], ['zusage', 0], ['zusage', 0], ['zusage', 0]],  // an die +100
    ];
    for (let i = 0; i < folgen.length; i++) {
      const a = altKette(folgen[i]);
      const n = neuKette(folgen[i]);
      check(`Parität, Folge ${i + 1} (${folgen[i].length} Schritte): ${a}`, a === n,
        `alt ${a}, neu ${n}`);
    }

    // Und dasselbe über 400 gewürfelte Folgen mit gesätem Zufall.
    let seed = 20261007;
    const wuerfel = () => {
      seed = (seed * 1103515245 + 12345) & 0x7fffffff;
      return seed / 0x7fffffff;
    };
    const arten = Object.keys(ALT);
    let abweichungen = 0;
    for (let n = 0; n < 400; n++) {
      const folge = [];
      const len = 1 + Math.floor(wuerfel() * 25);
      for (let i = 0; i < len; i++) {
        folge.push([arten[Math.floor(wuerfel() * arten.length)],
          Math.floor(wuerfel() * 40)]);
      }
      if (altKette(folge) !== neuKette(folge)) abweichungen++;
    }
    check('Parität über 400 gewürfelte Folgen', abweichungen === 0,
      `${abweichungen} Abweichungen`);

    // Die Brücke zu den echten Zahlen: Die Ketten oben rechnen mit den alten Deltas
    // auf beiden Achsen. Dass die ECHTEN Achsenwerte im Mittel dasselbe sind, sagt erst das hier.
    for (const art of Object.keys(ALT)) {
      const { respekt, vertrauen } = cdata.ACHSEN[art];
      check(`ACHSEN.${art}: Mittel ist das alte Delta ${ALT[art]}`,
        (respekt + vertrauen) / 2 === ALT[art], `${respekt}/${vertrauen}`);
    }
    check('Abkühlraten: Mittel aus Respekt und Vertrauen ist die alte Rate',
      (cdata.RESPEKT_DECAY_PRO_WOCHE + cdata.VERTRAUEN_DECAY_PRO_WOCHE) / 2
        === cdata.DRAHT_DECAY_PRO_WOCHE,
      `${cdata.RESPEKT_DECAY_PRO_WOCHE}/${cdata.VERTRAUEN_DECAY_PRO_WOCHE}`);
  }

  console.log('--- Die verbindlichen Zahlen, als Literale ---');
  {
    // Die Mittelwert-Zusicherungen oben tragen „verhaltensneutral zu früher";
    // sie lassen aber Paare und Raten offen, die denselben Mittelwert haben.
    // Hier steht jede Zahl selbst.
    const cdata = require('../src/data/contacts');
    check('Respekt kühlt mit 1 je Woche ab', cdata.RESPEKT_DECAY_PRO_WOCHE === 1,
      String(cdata.RESPEKT_DECAY_PRO_WOCHE));
    check('Vertrauen kühlt mit 3 je Woche ab (dreimal so schnell wie Respekt)',
      cdata.VERTRAUEN_DECAY_PRO_WOCHE === 3, String(cdata.VERTRAUEN_DECAY_PRO_WOCHE));
    check('der Boden steigt höchstens auf 30', cdata.BODEN_MAX === 30, String(cdata.BODEN_MAX));
    const erwartet = {
      zusage: [12, 12], echt: [9, 3], fluechtig: [3, 1], ignoriert: [-2, 0], verstimmt: [-8, -2],
    };
    check('ACHSEN hat genau die fünf Arten',
      Object.keys(cdata.ACHSEN).sort().join() === Object.keys(erwartet).sort().join(),
      Object.keys(cdata.ACHSEN).join());
    for (const [art, [r, v]] of Object.entries(erwartet)) {
      const a = cdata.ACHSEN[art];
      check(`ACHSEN.${art}: Respekt ${r}, Vertrauen ${v}`,
        a.respekt === r && a.vertrauen === v, JSON.stringify(a));
    }
  }

  // Reine Arithmetik: Diese Zeilen halten die KONSTANTEN fest, nicht das
  // Verhalten der Schreibmechanik – die Klemme und die Wochenzählung sind hier
  // Test-Eigenbau. Durch die echte move/achsenJetzt-Mechanik führt erst
  // Task 3 Step 9 dieselbe Kette.
  console.log('--- Die gewollte Abweichung vom alten Draht ---');
  {
    // Mit den ECHTEN Zahlen läuft die neue Kette vom alten Draht weg. Das ist
    // das Design, kein Fehler: Respekt und Vertrauen verhalten sich verschieden.
    const contacts = require('../src/contacts');
    const cdata = require('../src/data/contacts');
    const klemm = (x) => Math.max(-100, Math.min(100, x));

    // Zwanzig echte Antworten. Alt: 20 × +6, geklemmt: Draht 100.
    let r = 0, v = 0;
    for (let i = 0; i < 20; i++) {
      r = klemm(r + cdata.ACHSEN.echt.respekt);
      v = klemm(v + cdata.ACHSEN.echt.vertrauen);
    }
    check('20 × echt: Respekt sättigt bei 100, Vertrauen steht bei 60',
      r === 100 && v === 60, `${r}/${v}`);
    check('20 × echt: der Draht ist 80, nicht die alten 100',
      contacts.drahtVon(r, v) === 80, String(contacts.drahtVon(r, v)));

    // Respekt 50, Vertrauen -50: Draht 0, dann nichts. Alt: bleibt 0 (ein Draht
    // von 0 kühlt nicht ab). Neu: Vertrauen läuft dreimal schneller gegen 0.
    const nach = (wochen) => {
      const rr = contacts.decayAchse(50, wochen * cdata.RESPEKT_DECAY_PRO_WOCHE, 0);
      const vv = contacts.decayAchse(-50, wochen * cdata.VERTRAUEN_DECAY_PRO_WOCHE, 0);
      return { rr, vv, draht: contacts.drahtVon(rr, vv) };
    };
    check('Ausgangspunkt: Respekt 50 / Vertrauen -50 ist Draht 0',
      contacts.drahtVon(50, -50) === 0);
    check('nach einer Woche: Draht +1 (49 / -47)',
      nach(1).rr === 49 && nach(1).vv === -47 && nach(1).draht === 1, JSON.stringify(nach(1)));
    check('nach vier Wochen: Draht +4 (Respekt 46, Vertrauen -38)',
      nach(4).rr === 46 && nach(4).vv === -38 && nach(4).draht === 4, JSON.stringify(nach(4)));
    check('nach zehn Wochen: Draht +10 (Respekt 40, Vertrauen -20)',
      nach(10).rr === 40 && nach(10).vv === -20 && nach(10).draht === 10, JSON.stringify(nach(10)));
    check('der alte Draht hätte bei 0 stillgestanden',
      contacts.decay(0, 70) === 0 && contacts.decay(0, 28) === 0);
  }

  console.log('--- Abkühlen mit Boden ---');
  {
    const contacts = require('../src/contacts');
    const f = contacts.decayAchse;
    check('von oben gegen 0', f(40, 3, 0) === 37, String(f(40, 3, 0)));
    check('kein Überschießen nach unten', f(2, 3, 0) === 0, String(f(2, 3, 0)));
    check('von unten gegen 0', f(-40, 3, 0) === -37, String(f(-40, 3, 0)));
    check('kein Überschießen nach oben', f(-2, 3, 0) === 0, String(f(-2, 3, 0)));
    check('der Boden bremst den Fall', f(31, 3, 30) === 30, String(f(31, 3, 30)));
    check('auf dem Boden bleibt es liegen', f(30, 3, 30) === 30, String(f(30, 3, 30)));
    check('der Boden zieht NICHT nach oben', f(0, 3, 30) === 0, String(f(0, 3, 30)));
    check('von unten ist der Boden egal', f(-50, 3, 30) === -47, String(f(-50, 3, 30)));
    // Unter dem Boden (aber nicht negativ) passiert nichts; Negatives schießt nicht über 0.
    check('zwischen 0 und Boden bleibt es liegen', f(10, 3, 30) === 10, String(f(10, 3, 30)));
    check('kein Überschießen nach oben, auch mit Boden', f(-2, 3, 30) === 0, String(f(-2, 3, 30)));
    check('von unten gegen 0, auch mit Boden', f(-5, 3, 30) === -2, String(f(-5, 3, 30)));
    check('Boden 0 ist der Standard', f(5, 3) === 2 && f(-5, 3) === -2, `${f(5, 3)} / ${f(-5, 3)}`);
  }

  console.log('--- Draht als Mittelwert ---');
  {
    const v = require('../src/contacts').drahtVon;
    check('gerade Summe: genau der Mittelwert', v(40, 20) === 30, String(v(40, 20)));
    check('ungerade Summe rundet bei .5 nach oben', v(41, 20) === 31, String(v(41, 20)));
    check('negativ: -30,5 wird -30 (Math.round)', v(-41, -20) === -30, String(v(-41, -20)));
    check('Achsen gegeneinander: 50 und -50 ergeben 0', v(50, -50) === 0, String(v(50, -50)));
    check('beide Achsen tragen gleich viel', v(80, 0) === 40 && v(0, 80) === 40,
      `${v(80, 0)} / ${v(0, 80)}`);
    check('Grenzen: ±100 bleiben ±100', v(100, 100) === 100 && v(-100, -100) === -100);
  }

  console.log('--- Respekt-Gewicht ---');
  {
    const contacts = require('../src/contacts');
    const g = contacts.respektGewicht;
    check('gleich groß: 0,12', near(g(100_000, 100_000), 0.12), String(g(100_000, 100_000)));
    check('10×: 0,23', near(g(100_000, 1_000_000), 0.23), String(g(100_000, 1_000_000)));
    check('100×: 0,34', near(g(100_000, 10_000_000), 0.34), String(g(100_000, 10_000_000)));
    check('1000×: 0,45', near(g(10_000, 10_000_000), 0.45), String(g(10_000, 10_000_000)));
    check('er ist kleiner: 0,12 (geklemmt)', near(g(100_000, 10_000), 0.12), String(g(100_000, 10_000)));
    check('weit über 1000× bleibt 0,45', near(g(100, 1_000_000_000), 0.45), String(g(100, 1_000_000_000)));
    // Wer kleiner als 100 ist, zählt als 100 – und wer gar keine Reichweite hat, auch.
    check('meine unter 100 zählt als 100 (10×: 0,23)', near(g(10, 1_000), 0.23), String(g(10, 1_000)));
    check('meine fehlt: zählt als 100', near(g(undefined, 1_000), 0.23) && near(g(0, 1_000), 0.23),
      `${g(undefined, 1_000)} / ${g(0, 1_000)}`);
    check('seine unter 1 zählt als 1 (kein NaN, kein Minus)',
      near(g(100_000, 0), 0.12) && near(g(100_000, -5), 0.12), `${g(100_000, 0)} / ${g(100_000, -5)}`);
    check('3,16× ist eine halbe Dekade: 0,12 + 0,33 · 0,5 / 3 = 0,175',
      near(g(100_000, 316_228), 0.12 + 0.33 * 0.5 / 3, 1e-4), String(g(100_000, 316_228)));
    // Die Grenze, an der das neue Gewicht die alten 0,25 übersteigt.
    // Die Grenze liegt bei Faktor 15,199: darunter (15×: 0,24937) unter 0,25,
    // darüber (16×: 0,2524) mit Luft darüber.
    check('Faktor 15,2 ist die Grenze',
      g(100_000, 1_600_000) > 0.25 && g(100_000, 1_500_000) < 0.25,
      `${g(100_000, 1_500_000)} / ${g(100_000, 1_600_000)}`);
  }


  console.log('--- Fester Partner: eine Regel ---');
  {
    const contacts = require('../src/contacts');
    check('beide oben', contacts.istPartner(50, 50) === true);
    check('Respekt knapp drunter', contacts.istPartner(49, 50) === false);
    check('Vertrauen knapp drunter', contacts.istPartner(50, 49) === false);
    // Der Fall, den die alte Regel durchließ: Draht 50 ohne jedes Vertrauen.
    check('Respekt 100 und Vertrauen 0 ist KEIN Partner',
      contacts.istPartner(100, 0) === false);
    check('beide unten', contacts.istPartner(0, 0) === false);
  }

  console.log('--- Die Art der Beziehung ---');
  {
    const contacts = require('../src/contacts');
    const art = (o) => contacts.artOf({ meine: 100_000, seine: 100_000, ...o });

    check('offener Beef schlägt alles',
      art({ respekt: 90, vertrauen: 90, boden: 30, beefOffen: true }) === 'beef');
    check('Rivale: Respekt 30, Vertrauen −20',
      art({ respekt: 30, vertrauen: -20 }) === 'rivale');
    check('Respekt 29 ist kein Rivale',
      art({ respekt: 29, vertrauen: -20 }) === 'fremd',
      art({ respekt: 29, vertrauen: -20 }));
    check('Vertrauen −19 ist kein Rivale',
      art({ respekt: 30, vertrauen: -19 }) === 'fremd',
      art({ respekt: 30, vertrauen: -19 }));
    // Der Zustand, den eine Zahl nicht ausdrücken kann: Draht −25, aber Rivale.
    check('der Rivale bei Draht −25 wird NICHT verstimmt',
      art({ respekt: 30, vertrauen: -80 }) === 'rivale',
      art({ respekt: 30, vertrauen: -80 }));
    check('verstimmt bei Draht −20 ohne Respekt',
      art({ respekt: 0, vertrauen: -40 }) === 'verstimmt');
    check('Draht −19 ist nicht verstimmt',
      art({ respekt: 0, vertrauen: -38 }) === 'fremd',
      art({ respekt: 0, vertrauen: -38 }));

    const gross = { meine: 100_000, seine: 10_000_000 };
    check('Mentor', contacts.artOf({ ...gross, respekt: 50, vertrauen: 40 }) === 'mentor');
    check('Respekt 49 ist kein Mentor',
      contacts.artOf({ ...gross, respekt: 49, vertrauen: 40 }) === 'bekannt',
      contacts.artOf({ ...gross, respekt: 49, vertrauen: 40 }));
    check('Vertrauen 39 ist kein Mentor',
      contacts.artOf({ ...gross, respekt: 50, vertrauen: 39 }) === 'bekannt',
      contacts.artOf({ ...gross, respekt: 50, vertrauen: 39 }));
    check('Faktor 10 reicht für den Mentor',
      contacts.artOf({ meine: 100_000, seine: 1_000_000, respekt: 50, vertrauen: 40 }) === 'mentor');
    check('Faktor 9,99999 reicht nicht',
      contacts.artOf({ meine: 100_000, seine: 999_999, respekt: 50, vertrauen: 40 }) === 'bekannt',
      contacts.artOf({ meine: 100_000, seine: 999_999, respekt: 50, vertrauen: 40 }));
    // Die Reihenfolge-Absicht aus der Spec: Mentor steht ÜBER Partner, das
    // ⭐ hängt daran aber nicht.
    check('Mentor schlägt Partner',
      contacts.artOf({ ...gross, respekt: 60, vertrauen: 60 }) === 'mentor');
    check('…und ist trotzdem fester Partner', contacts.istPartner(60, 60) === true);

    check('Schützling',
      contacts.artOf({ meine: 10_000_000, seine: 100_000, respekt: 0, vertrauen: 40 }) === 'schuetzling');
    // Dieselbe Absicht von der anderen Seite: Auch der Schützling steht über
    // dem Partner.
    check('Schützling schlägt Partner',
      contacts.artOf({ meine: 10_000_000, seine: 100_000, respekt: 60, vertrauen: 60 }) === 'schuetzling',
      contacts.artOf({ meine: 10_000_000, seine: 100_000, respekt: 60, vertrauen: 60 }));
    check('Partner bei gleicher Größe', art({ respekt: 50, vertrauen: 50 }) === 'partner');
    check('alte Band: Boden 10 ohne warme Achsen',
      art({ respekt: 0, vertrauen: 0, boden: 10 }) === 'band');
    check('Boden 9 ist keine Band',
      art({ respekt: 0, vertrauen: 0, boden: 9 }) === 'fremd',
      art({ respekt: 0, vertrauen: 0, boden: 9 }));
    // Die zweite Reihenfolge-Absicht: band steht UNTER den warmen Arten.
    check('warme Band wird Partner, nicht Band',
      art({ respekt: 70, vertrauen: 70, boden: 10 }) === 'partner',
      art({ respekt: 70, vertrauen: 70, boden: 10 }));
    check('geschäftlich',
      art({ respekt: 40, vertrauen: 0, trait: 'geschaeftlich' }) === 'geschaeftlich');
    check('derselbe Respekt ohne den Charakterzug ist nur bekannt',
      art({ respekt: 40, vertrauen: 0, trait: 'kollegial' }) === 'bekannt',
      art({ respekt: 40, vertrauen: 0, trait: 'kollegial' }));
    check('bekannt bei Draht 20', art({ respekt: 20, vertrauen: 20 }) === 'bekannt');
    check('fremd bei null', art({ respekt: 0, vertrauen: 0 }) === 'fremd');

    // Jede der zehn Arten muss erreichbar sein – sonst ist eine Schwelle tot.
    const alle = new Set([
      art({ respekt: 0, vertrauen: 0, beefOffen: true }),
      art({ respekt: 30, vertrauen: -80 }),
      art({ respekt: 0, vertrauen: -40 }),
      contacts.artOf({ ...gross, respekt: 50, vertrauen: 40 }),
      contacts.artOf({ meine: 10_000_000, seine: 100_000, respekt: 0, vertrauen: 40 }),
      art({ respekt: 50, vertrauen: 50 }),
      art({ respekt: 0, vertrauen: 0, boden: 10 }),
      art({ respekt: 40, vertrauen: 0, trait: 'geschaeftlich' }),
      art({ respekt: 20, vertrauen: 20 }),
      art({ respekt: 0, vertrauen: 0 }),
    ]);
    check('alle zehn Arten sind erreichbar', alle.size === 10,
      `${alle.size}: ${[...alle].join(', ')}`);
  }

  console.log('--- Antwortchance: die Tabelle der Spec ---');
  {
    const contacts = require('../src/contacts');
    // Neutrale Anfrage, gleiches Land, gleiche Sprache, gleiches Genre weg –
    // gemessen wird der Beziehungs-Summand, nicht die Beiwerke.
    const arg = (meine, seine, respekt, vertrauen = 0) => ({
      meineReichweite: meine, seineReichweite: seine, request: 'shoutout',
      gleichesLand: false, sprache: 'englisch', genre: 'verwandt',
      respekt, vertrauen, tuerOeffner: 0, hype: 1, trait: 'launisch',
      partner: false, szene: 0,
    });
    const c = (...a) => contacts.chanceOf(arg(...a));
    const tabelle = [
      // meine,     seine,  R,   erwartet
      [100_000,   100_000,   0, 0.6000],
      [100_000,   100_000,  50, 0.6600],
      [100_000,   100_000, 100, 0.7200],
      [100_000, 1_000_000,   0, 0.1897],
      [100_000, 1_000_000, 100, 0.4197],
      [100_000, 10_000_000,  0, 0.0600],
      [100_000, 10_000_000, 50, 0.2300],
      [100_000, 10_000_000, 100, 0.4000],
      [10_000,  10_000_000, 50, 0.2440],
      [10_000,  10_000_000, 100, 0.4690],
    ];
    for (const [m, s, r, soll] of tabelle) {
      check(`${m} → ${s} bei Respekt ${r}: ${(soll * 100).toFixed(1)} %`,
        near(c(m, s, r), soll, 5e-5), String(c(m, s, r)));
    }

    check('positives Vertrauen hebt die Chance NICHT',
      near(c(100_000, 10_000_000, 50, 0), c(100_000, 10_000_000, 50, 100), 1e-12));

    // Der Riegel: Dauer-Beefer mit Respekt 20 und Vertrauen −100.
    check('Dauer-Beefer landet auf CHANCE_MIN',
      near(c(100_000, 10_000_000, 20, -100), 0.02),
      String(c(100_000, 10_000_000, 20, -100)));
    check('…ohne den Malus wäre er über dem Fremden',
      c(100_000, 10_000_000, 20, 0) > c(100_000, 10_000_000, 0, 0));

    // Der Dämpfer `respektWirkt` greift AUSSCHLIESSLICH ins Negative: Bei
    // Vertrauen ≥ 0 ist sein Faktor 1, und damit gelten die zehn Zahlen oben
    // Punkt für Punkt unverändert – bei Vertrauen 0 wie bei vollem Vertrauen.
    check('bei Vertrauen ≥ 0 dämpft nichts: alle zehn Zahlen bleiben gleich',
      tabelle.every(([m, s, r, soll]) => near(c(m, s, r, 0), soll, 5e-5)
        && near(c(m, s, r, 50), soll, 5e-5) && near(c(m, s, r, 100), soll, 5e-5)),
      tabelle.map(([m, s, r]) =>
        `${c(m, s, r, 0).toFixed(4)}/${c(m, s, r, 100).toFixed(4)}`).join(' '));
  }

  console.log('--- Der Dämpfer: Respekt wirkt nur, soweit er traut ---');
  {
    const contacts = require('../src/contacts');
    const cdata = require('../src/data/contacts');

    // Die reine Rechnung zuerst. Sie ist der Riegel, den der additive
    // VERTRAUEN_MALUS allein nicht ist: Er sättigt bei −0,25, der Respekt-Term
    // läuft bis 0,45.
    check('respektWirkt lässt bei Vertrauen ≥ 0 alles stehen',
      contacts.respektWirkt(68, 0) === 68 && contacts.respektWirkt(68, 100) === 68,
      `${contacts.respektWirkt(68, 0)} / ${contacts.respektWirkt(68, 100)}`);
    check('respektWirkt löscht den Respekt bei Vertrauen −100',
      contacts.respektWirkt(68, -100) === 0, String(contacts.respektWirkt(68, -100)));
    check('respektWirkt lässt dem Rivalen (V −20) 80 % seines Respekts',
      contacts.respektWirkt(30, -20) === 24, String(contacts.respektWirkt(30, -20)));
    check('negativer Respekt wirkt nie (auch nicht als Bonus)',
      contacts.respektWirkt(-50, 0) === 0 && contacts.respektWirkt(-50, -100) === 0);

    // Der Fall des Dauer-Beefers mit den Zahlen des Reviews: 10.000 Hörer
    // gegen 10 Mio., gleiches Land, sonst neutral. Fremd sind das 6,9 %.
    const arg = (respekt, vertrauen) => ({
      meineReichweite: 10_000, seineReichweite: 10_000_000, request: 'shoutout',
      gleichesLand: true, sprache: 'englisch', genre: 'verwandt',
      respekt, vertrauen, tuerOeffner: 0, hype: 1, trait: 'launisch',
      partner: false, szene: 0,
    });
    const c = (r, v) => contacts.chanceOf(arg(r, v));
    check('der Fremde (R 0 / V 0) steht bei 6,9 %', near(c(0, 0), 0.0690, 5e-5), String(c(0, 0)));
    // Acht gelandete Disse: +10 Respekt je Treffer, Vertrauen längst auf −100.
    // Ohne den Dämpfer wären das 12,5 % – fast das Doppelte des Fremden.
    check('acht gelandete Disse (R 68 / V −100) landen auf CHANCE_MIN',
      c(68, -100) === cdata.CHANCE_MIN, String(c(68, -100)));
    check('…und zwölf (R 88 / V −100) genauso',
      c(88, -100) === cdata.CHANCE_MIN, String(c(88, -100)));
    check('der Dauer-Beefer kommt damit nie über den Fremden',
      c(68, -100) < c(0, 0) && c(88, -100) < c(0, 0),
      `${c(68, -100)} / ${c(88, -100)} gegen ${c(0, 0)}`);
    // Der Rivale ist der Fall, der NICHT verschwinden darf: Respekt 30 bei
    // Vertrauen −20 behält 80 % seines Respekt-Vorteils, also 12,7 %.
    check('der Rivale (R 30 / V −20) steht bei 12,7 % und damit über dem Fremden',
      near(c(30, -20), 0.1270, 5e-5) && c(30, -20) > c(0, 0), String(c(30, -20)));

    /*
     * Das Zusage-Gewicht in `stufeVon`.
     *
     * Die Funktion würfelt und gibt ihre Verteilung nicht heraus – also wird
     * die Schwelle gesucht, ab der ein Wurf eine Zusage wird. Daraus folgt das
     * Gewicht exakt: Bei p = z / (f + e + z) ist z = (f + e) × p / (1 − p).
     * Gemessen wird also das GEWICHT, nicht eine gewürfelte Häufigkeit.
     */
    const schwelle = (ratio, respekt, vertrauen) => {
      let lo = 0, hi = 1;
      for (let i = 0; i < 60; i++) {
        const m = (lo + hi) / 2;
        if (contacts.stufeVon(() => m, { ratio, respekt, vertrauen }) === 'zusage') hi = m;
        else lo = m;
      }
      return hi;
    };
    const gewicht = (ratio, respekt, vertrauen = 0) => {
      const p = 1 - schwelle(ratio, respekt, vertrauen);
      const rest = 6 * (ratio < 0.05 ? 2 : 1) + 3;
      return (rest * p) / (1 - p);
    };
    const R = 0.001;   // 10.000 Hörer gegen 10 Mio.
    check('die Schwellensuche trifft das Zusage-Gewicht des Fremden (1,002)',
      near(gewicht(R, 0), 1 * (1 + 2 * R), 1e-9), String(gewicht(R, 0)));
    check('bei Vertrauen 0 hebt Respekt 68 das Zusage-Gewicht auf das 1,68-fache',
      near(gewicht(R, 68, 0), 1.68 * gewicht(R, 0), 1e-9),
      `${gewicht(R, 68, 0)} statt ${1.68 * gewicht(R, 0)}`);
    // Der Kern von §3: Der Beef darf den ZUGANG verändern, nicht den ERTRAG.
    // Ohne den Dämpfer stünde das Gewicht hier dauerhaft bei 1,68 – mehr
    // Zusagen, mehr Schub, mehr Hörer aus demselben Beef.
    check('stufeVon: bei R 68 / V −100 ist das Zusage-Gewicht das des Fremden',
      near(gewicht(R, 68, -100), gewicht(R, 0), 1e-9),
      `${gewicht(R, 68, -100)} statt ${gewicht(R, 0)}`);
    check('…und der Rivale (R 30 / V −20) behält auch hier 80 %',
      near(gewicht(R, 30, -20), 1.24 * gewicht(R, 0), 1e-9),
      `${gewicht(R, 30, -20)} statt ${1.24 * gewicht(R, 0)}`);
  }

  console.log('--- Die Schreibwege ---');
  {
    const contacts = require('../src/contacts');
    const T = 1_700_000_000_000;
    const DAY = 86_400_000;

    // move: addiert, klemmt, kühlt vorher faul ab.
    db.saveContact(G, U2, 'drake',
      { respekt: 40, vertrauen: 40, boden: 0, last_move: T });
    const m1 = contacts.move(G, U2, 'drake', { respekt: 10, vertrauen: -20 }, T);
    check('move addiert beide Achsen',
      m1.achsen.respekt === 50 && m1.achsen.vertrauen === 20, JSON.stringify(m1.achsen));
    check('move meldet den Draht vorher und nachher',
      m1.vorher === 40 && m1.nachher === 35, `${m1.vorher}/${m1.nachher}`);
    check('move meldet die Achsen von vorher',
      m1.achsenVor.respekt === 40 && m1.achsenVor.vertrauen === 40 && m1.achsenVor.boden === 0,
      JSON.stringify(m1.achsenVor));

    // Vier Wochen später: Respekt −4, Vertrauen −12.
    const spaet = T + 28 * DAY;
    const a = contacts.achsenJetzt(db.getContact(G, U2, 'drake'), spaet);
    check('Respekt kühlt mit 1 je Woche', a.respekt === 46, String(a.respekt));
    check('Vertrauen kühlt mit 3 je Woche', a.vertrauen === 8, String(a.vertrauen));
    check('der Draht kühlt mit den alten 2', a.draht === 27, String(a.draht));
    check('Lesen hat nichts geschrieben (§4)',
      db.getContact(G, U2, 'drake').respekt === 50);

    // Der Boden hebt das Vertrauen mit.
    db.saveContact(G, U3, 'anitta', { respekt: 0, vertrauen: 2, boden: 0, last_move: T });
    const m2 = contacts.move(G, U3, 'anitta', { boden: 10 }, T);
    check('der Boden hebt das Vertrauen auf seine Höhe',
      m2.achsen.boden === 10 && m2.achsen.vertrauen === 10, JSON.stringify(m2.achsen));
    const m3 = contacts.move(G, U3, 'anitta', { boden: 30 }, T);
    check('der Boden ist bei 30 gedeckelt', m3.achsen.boden === 30, String(m3.achsen.boden));

    // setzeVertrauen: nur die Versöhnung benutzt es.
    db.saveContact(G, U4, 'ezhel', { respekt: 20, vertrauen: -70, boden: 0, last_move: T });
    const m4 = contacts.move(G, U4, 'ezhel', { setzeVertrauen: -40 }, T);
    check('setzeVertrauen setzt statt zu addieren',
      m4.achsen.vertrauen === -40 && m4.achsen.respekt === 20, JSON.stringify(m4.achsen));

    // merken schreibt eine Gedächtniszeile mit den echten Deltas – bewusst
    // UNGLEICH, sonst wäre ein Vertauschen der zwei Achsen unsichtbar.
    contacts.move(G, U4, 'ezhel',
      { respekt: 9, vertrauen: 3, merken: { art: 'frieden', detail: '' } }, T);
    const mem = db.memoryOf(G, U4, 'ezhel', 1);
    check('merken schreibt mit den echten Deltas',
      mem.length === 1 && mem[0].art === 'frieden'
      && mem[0].d_respekt === 9 && mem[0].d_vertrauen === 3, JSON.stringify(mem));
    check('ohne merken keine Zeile', db.memoryCount(G, U2, 'drake') === 0);

    // Der Boden bremst auch beim Lesen: ohne ihn fiele das Vertrauen auf 0.
    db.saveContact(G, U5, 'rammstein', { respekt: 0, vertrauen: 30, boden: 20, last_move: T });
    const b10 = contacts.achsenJetzt(db.getContact(G, U5, 'rammstein'), T + 70 * DAY);
    check('achsenJetzt hält das Vertrauen auf dem Boden',
      b10.vertrauen === 20 && b10.boden === 20, JSON.stringify(b10));
    check('der Respekt hat keinen Boden und fällt auf 0',
      b10.respekt === 0 && b10.draht === 10, JSON.stringify(b10));

    /*
     * `istPartnerRow` rechnet auf den ABGEKÜHLTEN Achsen (§4).
     *
     * Seit diesem Task trägt die Funktion auch die Anzählrunde in beef.js: Wer
     * Partner ist, wird nicht angezählt. Läse sie die rohe Zeile, bliebe ein
     * Partner von vor einem halben Jahr dauerhaft verschont, ohne je wieder
     * etwas dafür zu tun.
     */
    db.saveContact(G, U5, 'drake', { respekt: 60, vertrauen: 60, boden: 0,
      tries: 0, yes: 0, last_try: 0, last_move: T, ignored_at: 0 });
    const pRow = () => db.getContact(G, U5, 'drake');
    check('istPartnerRow sieht den frischen Partner', contacts.istPartnerRow(pRow(), T) === true);
    // 14 Wochen Funkstille: Respekt 60 − 14 = 46, Vertrauen 60 − 42 = 18.
    const kalt = T + 98 * DAY;
    check('istPartnerRow rechnet das Abkühlen mit: nach 14 Wochen kein Partner mehr',
      contacts.istPartnerRow(pRow(), kalt) === false
      && contacts.achsenJetzt(pRow(), kalt).respekt === 46
      && contacts.achsenJetzt(pRow(), kalt).vertrauen === 18,
      JSON.stringify(contacts.achsenJetzt(pRow(), kalt)));

    // Die Klemme: beide Achsen bleiben zwischen −100 und 100.
    db.saveContact(G, U5, 'anitta', { respekt: 95, vertrauen: -95, boden: 0, last_move: T });
    const m5 = contacts.move(G, U5, 'anitta', { respekt: 50, vertrauen: -50 }, T);
    check('move klemmt beide Achsen bei ±100',
      m5.achsen.respekt === 100 && m5.achsen.vertrauen === -100, JSON.stringify(m5.achsen));
  }

  // Der Paritätsabschnitt oben baut die Wochenzählung und die ±100-Klemme im
  // TEST nach. Erst hier läuft dieselbe Ereignisfolge durch die echte
  // Schreibmechanik: contacts.move schreibt, contacts.achsenJetzt liest.
  console.log('--- Dieselbe Kette durch move und achsenJetzt ---');
  {
    const contacts = require('../src/contacts');
    const cdata = require('../src/data/contacts');
    const T = 1_700_000_000_000;
    const DAY = 86_400_000;

    // Zwanzig echte Antworten, alle am selben Tag. Die alte Kette ergab hier
    // Draht 100; dass es jetzt 80 sind, ist das Design (siehe „Die gewollte
    // Abweichung") – hier steht es für die echte Mechanik.
    for (let i = 0; i < 20; i++) {
      contacts.move(G, U5, 'lilpfand',
        { respekt: cdata.ACHSEN.echt.respekt, vertrauen: cdata.ACHSEN.echt.vertrauen }, T);
    }
    const z = contacts.achsenJetzt(db.getContact(G, U5, 'lilpfand'), T);
    check('20 × echt durch move: Respekt sättigt bei 100, Vertrauen steht bei 60',
      z.respekt === 100 && z.vertrauen === 60, JSON.stringify(z));
    check('20 × echt durch move: der Draht ist 80', z.draht === 80, String(z.draht));

    // Respekt 50 / Vertrauen −50 (Draht 0), dann nichts mehr. Die alte Kette
    // blieb bei 0 stehen, weil ein Draht von 0 nicht abkühlt.
    contacts.move(G, U5, 'ninachuba', { respekt: 50, vertrauen: -50 }, T);
    const zeile = db.getContact(G, U5, 'ninachuba');
    const n0 = contacts.achsenJetzt(zeile, T);
    check('Ausgangspunkt durch move: 50 / −50 ist Draht 0',
      n0.respekt === 50 && n0.vertrauen === -50 && n0.draht === 0, JSON.stringify(n0));
    const n4 = contacts.achsenJetzt(zeile, T + 28 * DAY);
    check('vier Wochen durch achsenJetzt: 46 / −38, Draht 4',
      n4.respekt === 46 && n4.vertrauen === -38 && n4.draht === 4, JSON.stringify(n4));
    const n10 = contacts.achsenJetzt(zeile, T + 70 * DAY);
    check('zehn Wochen durch achsenJetzt: 40 / −20, Draht 10',
      n10.respekt === 40 && n10.vertrauen === -20 && n10.draht === 10, JSON.stringify(n10));
    // Angebrochene Wochen zählen nicht: 27 Tage sind drei Wochen, nicht vier.
    const n27 = contacts.achsenJetzt(zeile, T + 27 * DAY);
    check('27 Tage sind drei Wochen: 47 / −41, Draht 3',
      n27.respekt === 47 && n27.vertrauen === -41 && n27.draht === 3, JSON.stringify(n27));
    check('das Lesen hat die Zeile nicht angefasst (§4)',
      db.getContact(G, U5, 'ninachuba').respekt === 50
      && db.getContact(G, U5, 'ninachuba').vertrauen === -50);
  }


  // Alle Zeitstempel oben setzen `last_move` auf dasselbe T, zu dem auch
  // bewegt wird – es gibt dort nirgends eine Pause VOR einem Schreibvorgang.
  // Wer in `move` oder `request` die rohen Spaltenwerte liest statt der faul
  // abgekühlten, bliebe darum unbemerkt: §4 verspricht, dass erst die nächste
  // Bewegung die abgekühlten Werte fortschreibt. Hier steht die Pause davor.
  console.log('--- Bewegen nach einer Pause (§4: erst der Schreibvorgang schreibt fort) ---');
  {
    const contacts = require('../src/contacts');
    const music = require('../src/music');
    const unb = require('../src/unb');
    unb.getBalance = async () => ({ cash: 0, bank: 0, total: 0 });
    unb.changeCash = async () => ({ cash: 0, bank: 0, total: 0 });
    const T = 1_700_000_000_000;
    const DAY = 86_400_000;
    const PAUSE = T + 70 * DAY;     // zehn Wochen: Respekt −10, Vertrauen −30

    /** Gesetzter Zufall: erst die Chance, dann die Stufe, dann der Satz. */
    const folge = (...xs) => { let i = 0; return () => (i < xs.length ? xs[i++] : 0.5); };

    // Ein Künstler mit Hörern, sonst weist `request` mit „seite" ab.
    music.setup(G, U6, 'hiphop', music.PERSONAS[0].id, T);
    db.saveArtist(G, U6, { ...db.getArtist(G, U6, T), listeners: 10_000 });

    // --- move ---
    db.saveContact(G, U6, 'drake', { respekt: 50, vertrauen: 50, boden: 0,
      tries: 0, yes: 2, last_try: 0, last_move: T, ignored_at: 0 });
    const vorher = contacts.achsenJetzt(db.getContact(G, U6, 'drake'), PAUSE);
    check('Ausgangspunkt: zehn Wochen kühlen 50 / 50 auf 40 / 20, Draht 30',
      vorher.respekt === 40 && vorher.vertrauen === 20 && vorher.draht === 30, JSON.stringify(vorher));

    const mp = contacts.move(G, U6, 'drake', { respekt: 12, vertrauen: 12 }, PAUSE);
    const zp = db.getContact(G, U6, 'drake');
    check('move nach der Pause schreibt 52 / 32 in die Datenbank, nicht 62 / 62',
      zp.respekt === 52 && zp.vertrauen === 32, `${zp.respekt}/${zp.vertrauen}`);
    check('move nach der Pause: der gespeicherte Draht ist 42, nicht 62',
      zp.draht === 42, String(zp.draht));
    check('move nach der Pause meldet die abgekühlten Achsen von vorher (40 / 20)',
      mp.achsenVor.respekt === 40 && mp.achsenVor.vertrauen === 20
      && mp.vorher === 30 && mp.nachher === 42, JSON.stringify(mp));
    check('move nach der Pause setzt last_move auf jetzt', zp.last_move === PAUSE, String(zp.last_move));
    check('move lässt den Zusagen-Zähler stehen (yes bleibt 2)', zp.yes === 2, String(zp.yes));

    // --- request ---
    db.saveContact(G, U6, 'ninachuba', { respekt: 50, vertrauen: 50, boden: 0,
      tries: 0, yes: 0, last_try: 0, last_move: T, ignored_at: 0 });
    const rp = await contacts.request(G, U6, 'ninachuba', 'shoutout', PAUSE, folge(0.001, 0.999, 0.5));
    const zr = db.getContact(G, U6, 'ninachuba');
    check('request nach der Pause: eine Zusage', rp.ok && rp.antwort === 'zusage',
      JSON.stringify({ ok: rp.ok, a: rp.antwort, reason: rp.reason }));
    check('request nach der Pause schreibt 52 / 32 in die Datenbank, nicht 62 / 62',
      zr.respekt === 52 && zr.vertrauen === 32, `${zr.respekt}/${zr.vertrauen}`);
    check('request nach der Pause: der gespeicherte Draht ist 42, nicht 62',
      zr.draht === 42, String(zr.draht));
    check('request nach der Pause meldet die abgekühlten Achsen von vorher (40 / 20)',
      rp.achsenVor.respekt === 40 && rp.achsenVor.vertrauen === 20
      && rp.drahtVor === 30 && rp.draht === 42, JSON.stringify({ v: rp.achsenVor, d: rp.draht }));
  }

  // Der Boden ist die eine DAUERHAFTE Zusicherung des Stücks: Ein Album zu
  // zweit ist nach einem halben Jahr Funkstille nicht nichts. Eine einzige
  // Anfrage darf ihn nicht löschen – alle Fälle oben liefen auf boden 0.
  console.log('--- Der Boden überlebt Bewegung und Anfrage ---');
  {
    const contacts = require('../src/contacts');
    const T = 1_700_000_000_000;
    const DAY = 86_400_000;
    const folge = (...xs) => { let i = 0; return () => (i < xs.length ? xs[i++] : 0.5); };

    // request mit Boden 20
    const tB = T + 10 * DAY;
    db.saveContact(G, U6, 'lilpfand', { respekt: 30, vertrauen: 25, boden: 20,
      tries: 0, yes: 0, last_try: 0, last_move: tB, ignored_at: 0 });
    const rb = await contacts.request(G, U6, 'lilpfand', 'shoutout', tB, folge(0.001, 0.999, 0.5));
    const zb = db.getContact(G, U6, 'lilpfand');
    check('request lässt den Boden stehen (20 bleibt 20)',
      rb.ok && zb.boden === 20 && rb.achsen.boden === 20,
      JSON.stringify({ ok: rb.ok, reason: rb.reason, boden: zb.boden, achsen: rb.achsen }));
    // Die Folge, an der es weh täte: Nach einem Jahr Funkstille hält der Boden
    // das Vertrauen noch bei 20; ohne ihn stünde es auf 0.
    const jahr = contacts.achsenJetzt(zb, tB + 365 * DAY);
    check('ein Jahr Funkstille nach der Anfrage: Vertrauen steht auf dem Boden (20), nicht 0',
      jahr.vertrauen === 20 && jahr.boden === 20, JSON.stringify(jahr));

    // move: yes, Boden-Untergrenze, Boden hebt das Vertrauen um die ERHÖHTE Höhe.
    db.saveContact(G, U6, 'anitta', { respekt: 10, vertrauen: 12, boden: 10,
      tries: 0, yes: 4, last_try: 0, last_move: T, ignored_at: 0 });
    const m1 = contacts.move(G, U6, 'anitta', { boden: 5 }, T);
    check('Boden +5 auf 10 ergibt 15 und hebt das Vertrauen von 12 auf 15 (nicht bei 12 stehen)',
      m1.achsen.boden === 15 && m1.achsen.vertrauen === 15
      && db.getContact(G, U6, 'anitta').vertrauen === 15, JSON.stringify(m1.achsen));
    // Quelle der Stufe: `buttons.beefDraht` liest `stufe` aus JEDER Drahtbewegung
    // (Angebote, später Beef) – fehlt sie hier, stünde dort still „undefined".
    // Draht 13 liegt unter STUFE_BEKANNT (20), 73 darüber – der Name muss mitwandern.
    check('move liefert `stufe` selbst, passend zum neuen Draht',
      typeof m1.stufe === 'string' && m1.stufe === contacts.drahtStufe(m1.nachher),
      JSON.stringify(m1));
    const mS = contacts.move(G, U6, 'anitta', { respekt: 60, vertrauen: 60 }, T);
    check('und die Stufe folgt dem Draht über die Schwelle',
      mS.stufe === contacts.drahtStufe(mS.nachher) && mS.stufe !== m1.stufe,
      JSON.stringify({ a: m1.stufe, b: mS.stufe, nachher: mS.nachher }));
    // Zurück auf den Stand nach m1, damit die folgenden Zusicherungen unverändert gelten.
    db.saveContact(G, U6, 'anitta', { respekt: 10, vertrauen: 15, boden: 15,
      tries: 0, yes: 4, last_try: 0, last_move: T, ignored_at: 0 });
    check('move lässt yes stehen (4 bleibt 4)', db.getContact(G, U6, 'anitta').yes === 4,
      String(db.getContact(G, U6, 'anitta').yes));
    const m2 = contacts.move(G, U6, 'anitta', { boden: -50 }, T);
    check('der Boden fällt nie unter 0 (15 − 50 ergibt 0, nicht −35)',
      m2.achsen.boden === 0 && db.getContact(G, U6, 'anitta').boden === 0,
      JSON.stringify(m2.achsen));
    check('ein gesenkter Boden senkt das Vertrauen nicht mit', m2.achsen.vertrauen === 15,
      JSON.stringify(m2.achsen));
  }

  console.log('--- Partner: die Regel an den Aufrufern, partnerNeu nur beim Übertritt ---');
  {
    const contacts = require('../src/contacts');
    const T = 1_700_000_000_000;
    const DAY = 86_400_000;
    const folge = (...xs) => { let i = 0; return () => (i < xs.length ? xs[i++] : 0.5); };

    // Die Partner-Regel steht nur in istPartner. `artOf` darf sie nicht neu
    // schreiben: Draht 50 allein (Respekt 100 / Vertrauen 0) ist kein Partner.
    check('artOf: Respekt 100 / Vertrauen 0 ist „bekannt", nicht „partner"',
      contacts.artOf({ respekt: 100, vertrauen: 0 }) === 'bekannt',
      contacts.artOf({ respekt: 100, vertrauen: 0 }));
    check('artOf: 50 / 50 ist „partner" (Gegenprobe)',
      contacts.artOf({ respekt: 50, vertrauen: 50 }) === 'partner');

    // Wer schon Partner ist, wird es nicht „neu".
    const t1 = T + 20 * DAY;
    db.saveContact(G, U6, 'ezhel', { respekt: 60, vertrauen: 60, boden: 0,
      tries: 0, yes: 0, last_try: 0, last_move: t1, ignored_at: 0 });
    const alt = await contacts.request(G, U6, 'ezhel', 'shoutout', t1, folge(0.001, 0.999, 0.5));
    check('ein bestehender Partner bleibt Partner, wird es aber nicht neu',
      alt.ok && alt.partner === true && alt.partnerNeu === false,
      JSON.stringify({ ok: alt.ok, reason: alt.reason, p: alt.partner, n: alt.partnerNeu }));

    // Gegenprobe: der Übertritt meldet es.
    const t2 = T + 30 * DAY;
    db.saveContact(G, U6, 'rammstein', { respekt: 45, vertrauen: 45, boden: 0,
      tries: 0, yes: 0, last_try: 0, last_move: t2, ignored_at: 0 });
    const neu = await contacts.request(G, U6, 'rammstein', 'shoutout', t2, folge(0.001, 0.999, 0.5));
    check('der Übertritt über beide Schwellen meldet partnerNeu',
      neu.ok && neu.partner === true && neu.partnerNeu === true,
      JSON.stringify({ ok: neu.ok, reason: neu.reason, a: neu.antwort, p: neu.partner, n: neu.partnerNeu }));
  }


  console.log('--- Angebote: Tore und Achsen ---');
  {
    const adata = require('../src/data/angebote');
    const cdata = require('../src/data/contacts');

    check('jede Angebotsart trägt genau EIN Tor',
      adata.ARTEN.every((a) =>
        (a.minDraht == null) !== (a.minVertrauen == null)),
      JSON.stringify(adata.ARTEN.map((a) => [a.id, a.minDraht, a.minVertrauen])));
    check('die drei großen Formate hängen am Vertrauen',
      ['kollabo', 'tour', 'label'].every((id) =>
        adata.ARTEN.find((a) => a.id === id).minVertrauen === 50));
    check('die drei kleinen hängen am Draht',
      ['tausch', 'gastpart', 'vorgruppe'].every((id) =>
        adata.ARTEN.find((a) => a.id === id).minDraht === 20));
    check('jede Anfrageart trägt höchstens EIN Tor',
      cdata.REQUESTS.every((r) => !(r.minDraht != null && r.minVertrauen != null)));
    check('die gemeinsame Bühne hängt am Vertrauen',
      cdata.REQUESTS.find((r) => r.id === 'konzert').minVertrauen === 20
      && cdata.REQUESTS.find((r) => r.id === 'konzert').minDraht === null);

    // Die Mittelwerte: drei wie früher, zwei neu.
    const mittel = (p) => (p.respekt + p.vertrauen) / 2;
    check('ACHSEN_AN mittelt auf die alten +8', mittel(adata.ACHSEN_AN) === 8);
    check('ACHSEN_AB mittelt auf die alten −5', mittel(adata.ACHSEN_AB) === -5);
    check('ACHSEN_VERFALL mittelt auf die alten −8', mittel(adata.ACHSEN_VERFALL) === -8);
    check('ACHSEN_FERTIG ist neu und positiv', mittel(adata.ACHSEN_FERTIG) === 12);
    check('ACHSEN_PFUSCH ist neu und der härteste Verlust unter den Gegenanfragen',
      adata.ACHSEN_PFUSCH.vertrauen < adata.ACHSEN_VERFALL.vertrauen
      && adata.ACHSEN_PFUSCH.vertrauen < adata.ACHSEN_AB.vertrauen
      && adata.ACHSEN_PFUSCH.vertrauen === -20);
    check('Verfallen kostet mehr Vertrauen als Absagen',
      adata.ACHSEN_VERFALL.vertrauen < adata.ACHSEN_AB.vertrauen);
    check('Absagen kostet kaum Respekt',
      Math.abs(adata.ACHSEN_AB.respekt) < Math.abs(adata.ACHSEN_AB.vertrauen));
    check('nur Durchgezogenes hebt den Boden',
      adata.BODEN_FERTIG === 10 && adata.BODEN_AN === 3);

    // Der Mittelwert ist blind für vertauschte Achsen – darum die Achsen einzeln.
    check('die Paare stehen Achse für Achse fest (nicht nur im Mittel)',
      JSON.stringify(adata.ACHSEN_AN) === '{"respekt":4,"vertrauen":12}'
      && JSON.stringify(adata.ACHSEN_AB) === '{"respekt":-2,"vertrauen":-8}'
      && JSON.stringify(adata.ACHSEN_VERFALL) === '{"respekt":-4,"vertrauen":-12}'
      && JSON.stringify(adata.ACHSEN_FERTIG) === '{"respekt":6,"vertrauen":18}'
      && JSON.stringify(adata.ACHSEN_PFUSCH) === '{"respekt":-6,"vertrauen":-20}');
    check('die alten Draht-Deltas sind abgeleitet und stehen noch da (Spielermeldungen lesen sie)',
      adata.DRAHT_AN === 8 && adata.DRAHT_AB === -5 && adata.DRAHT_VERFALL === -8);

    // Das Vertrauens-Tor der Anfrage `konzert`: bei 19 zu, bei 20 offen – und
    // zwar auf dem VERTRAUEN, nicht auf dem Draht. Respekt 100 / Vertrauen 19
    // ist Draht 60, und trotzdem bleibt die Tür zu.
    const contacts = require('../src/contacts');
    const creator = require('../src/creator');
    const T = 1_700_000_000_000;
    const folge = (...xs) => { let i = 0; return () => (i < xs.length ? xs[i++] : 0.5); };
    const setze = (vertrauen) => db.saveContact(G, U6, 'lilpfand', { respekt: 100, vertrauen,
      boden: 0, tries: 0, yes: 0, last_try: 0, last_move: T, ignored_at: 0 });

    setze(19);
    const links = creator.budget(G, U6, T).left;
    const zu = await contacts.request(G, U6, 'lilpfand', 'konzert', T, folge(0.001, 0.999, 0.5));
    check('konzert bei Vertrauen 19 (Draht 60) wird mit „vertrauen" abgewiesen',
      zu.ok === false && zu.reason === 'vertrauen' && zu.need === 20 && zu.vertrauen === 19,
      JSON.stringify({ ok: zu.ok, reason: zu.reason, need: zu.need, v: zu.vertrauen }));
    check('die Abweisung bucht weder Zeit noch Versuch noch Draht',
      creator.budget(G, U6, T).left === links
      && db.getContact(G, U6, 'lilpfand').tries === 0
      && db.getContact(G, U6, 'lilpfand').vertrauen === 19);
    const dZu = contacts.detail(G, U6, 'lilpfand', T).requests.find((r) => r.id === 'konzert');
    check('detail meldet für konzert bei 19: gesperrt, Grund „vertrauen"',
      dZu.moeglich === false && dZu.grund === 'vertrauen', JSON.stringify(dZu.grund));
    check('die drei anderen Anfragen sind bei 19 unberührt offen',
      contacts.detail(G, U6, 'lilpfand', T).requests
        .filter((r) => r.id !== 'konzert').every((r) => r.grund === null));

    setze(20);
    const dOffen = contacts.detail(G, U6, 'lilpfand', T).requests.find((r) => r.id === 'konzert');
    check('detail meldet für konzert bei 20: möglich', dOffen.moeglich === true && dOffen.grund === null,
      JSON.stringify(dOffen.grund));
    const auf = await contacts.request(G, U6, 'lilpfand', 'konzert', T, folge(0.001, 0.999, 0.5));
    check('konzert bei Vertrauen 20 geht durch', auf.ok === true,
      JSON.stringify({ ok: auf.ok, reason: auf.reason }));
  }



  console.log('--- Beef: Respekt rauf, Vertrauen runter ---');
  {
    const bdata = require('../src/data/beef');
    const mittel = (p) => (p.respekt + p.vertrauen) / 2;

    // Der Kern des ganzen Stücks: Der gelandete Diss hebt den Respekt.
    check('der gelandete Disstrack HEBT den Respekt',
      bdata.ACHSEN_DISS.respekt > 0, String(bdata.ACHSEN_DISS.respekt));
    check('…und zerstört das Vertrauen',
      bdata.ACHSEN_DISS.vertrauen === -36, String(bdata.ACHSEN_DISS.vertrauen));
    check('Anstacheln bringt keinen Respekt',
      bdata.ACHSEN_ANSTACHELN.respekt === 0);
    check('die Blamage kostet Respekt, nicht Vertrauen',
      bdata.ACHSEN_BLAMAGE.respekt < bdata.ACHSEN_BLAMAGE.vertrauen,
      JSON.stringify(bdata.ACHSEN_BLAMAGE));
    // Der Mittelwert ist blind für vertauschte Achsen (Konter −6/−14 und −14/−6
    // ergeben beide −10), und test/beef.test.js liest die Paare aus denselben
    // Konstanten, die es prüft – darum stehen sie hier Achse für Achse als Literal.
    check('die sechs Beef-Paare stehen Achse für Achse fest (nicht nur im Mittel)',
      JSON.stringify(bdata.ACHSEN_ANSTACHELN) === '{"respekt":0,"vertrauen":-24}'
      && JSON.stringify(bdata.ACHSEN_BLAMAGE) === '{"respekt":-10,"vertrauen":-4}'
      && JSON.stringify(bdata.ACHSEN_DISS) === '{"respekt":10,"vertrauen":-36}'
      && JSON.stringify(bdata.ACHSEN_HAEME) === '{"respekt":-8,"vertrauen":-20}'
      && JSON.stringify(bdata.ACHSEN_KONTER) === '{"respekt":-6,"vertrauen":-14}'
      && JSON.stringify(bdata.ACHSEN_ANGEZAEHLT) === '{"respekt":-4,"vertrauen":-16}');
    check('die fünf DRAHT_* des Beefs gibt es nicht mehr',
      ['DRAHT_ANSTACHELN', 'DRAHT_BLAMAGE', 'DRAHT_DISS', 'DRAHT_KONTER', 'DRAHT_ANGEZAEHLT']
        .every((k) => !(k in bdata)));
    check('Konter mittelt auf die alten −10', mittel(bdata.ACHSEN_KONTER) === -10);
    check('Angezählt mittelt auf die alten −10', mittel(bdata.ACHSEN_ANGEZAEHLT) === -10);

    // Ein ganzer Beef-Durchlauf: Respekt netto leicht hoch, Vertrauen am Boden,
    // der Draht trotzdem klar im Minus – und damit jedes Tor zu.
    const contacts = require('../src/contacts');
    const rNetto = bdata.ACHSEN_ANSTACHELN.respekt + bdata.ACHSEN_DISS.respekt
      + bdata.ACHSEN_KONTER.respekt;
    const vNetto = bdata.ACHSEN_ANSTACHELN.vertrauen + bdata.ACHSEN_DISS.vertrauen
      + bdata.ACHSEN_KONTER.vertrauen;
    check('nach einem Beef: Respekt netto nicht gesunken', rNetto >= 0, String(rNetto));
    check('nach einem Beef: Vertrauen tief im Minus', vNetto <= -70, String(vNetto));
    check('nach einem Beef sind alle großen Formate zu',
      vNetto < 50 && contacts.drahtVon(rNetto, vNetto) < 20,
      `R ${rNetto}, V ${vNetto}, Draht ${contacts.drahtVon(rNetto, vNetto)}`);
    // Rivale heißt: er nimmt dich ernst (Respekt ab ART_RIVALE_RESPEKT) und
    // traut dir nicht (Vertrauen höchstens ART_RIVALE_VERTRAUEN). Ein Beef allein
    // liefert dafür nur +4 Respekt netto – Rivale wird also, wer dich vorher schon
    // ernst genommen hat. Aus dem Nichts (0/0) wird er „verstimmt", und das ist
    // gewollt so gemessen, nicht schöngerechnet.
    const cdata = require('../src/data/contacts');
    const nachBeef = (start) => contacts.artOf({
      respekt: start.respekt + rNetto, vertrauen: start.vertrauen + vNetto,
      meine: 100_000, seine: 100_000 });
    check('wer dich schon ernst nahm (30/20), ist nach einem Beef ein Rivale',
      nachBeef({ respekt: 30, vertrauen: 20 }) === 'rivale',
      nachBeef({ respekt: 30, vertrauen: 20 }));
    check('Schwelle: ab Respekt 26 vor dem Beef (+4 netto = 30) wird er Rivale, bei 25 nicht',
      cdata.ART_RIVALE_RESPEKT - rNetto === 26
      && nachBeef({ respekt: 26, vertrauen: 0 }) === 'rivale'
      && nachBeef({ respekt: 25, vertrauen: 0 }) === 'verstimmt',
      `${nachBeef({ respekt: 26, vertrauen: 0 })} / ${nachBeef({ respekt: 25, vertrauen: 0 })}`);
    check('aus dem Nichts (0/0) wird er durch einen Beef „verstimmt", noch kein Rivale',
      nachBeef({ respekt: 0, vertrauen: 0 }) === 'verstimmt',
      nachBeef({ respekt: 0, vertrauen: 0 }));

    // Der Frieden hebt Vertrauen bis zum Deckel und rührt den Respekt nicht an.
    // Geprüft wird die PRODUKTIONSFUNKTION, nicht eine Kopie ihrer Formel.
    const beef = require('../src/beef');
    check('der Frieden hebt −70 auf den Deckel −10', beef.friedenZiel(-70) === -40,
      String(beef.friedenZiel(-70)));
    check('…und −20 nur bis −10', beef.friedenZiel(-20) === -10,
      String(beef.friedenZiel(-20)));
    check('…und zieht einen hohen Wert nicht herunter', beef.friedenZiel(20) === 20,
      String(beef.friedenZiel(20)));
  }


  aufraeumen();

  console.log(`\n${pass} bestanden, ${fail} fehlgeschlagen`);
  process.exit(fail === 0 ? 0 : 1);
})();
