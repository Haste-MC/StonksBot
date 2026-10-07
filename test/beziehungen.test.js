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

/** Alles aufräumen, was diese Datei anlegt – vorher UND nachher, nie ein Leerstand vorausgesetzt. */
const aufraeumen = () => {
  for (const [g, u] of [[G, U], [G, U2], [G2, U], [G, U3], [G, U4]]) db.clearContacts(g, u);
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


  aufraeumen();

  console.log(`\n${pass} bestanden, ${fail} fehlgeschlagen`);
  process.exit(fail === 0 ? 0 : 1);
})();
