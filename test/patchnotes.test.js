/**
 * Tests für Patchnotes-Zustellung und das Aufräumen im Postfach.
 *
 * Schwerpunkte: die Zustellung ist idempotent (nervt nicht bei jedem Klick),
 * und Rechnungen lassen sich NICHT wegklicken – das wären sonst geschenkte
 * Schulden-Erlasse.
 *
 * Aufruf: npm run test:patchnotes
 */
const db = require('../src/db');
const patchnotes = require('../src/patchnotes');
const notes = require('../src/data/patchnotes');

const G = 'TESTGUILD_PATCH';
const U = 'PNUSER';
let pass = 0, fail = 0;

const check = (label, ok, extra = '') => {
  if (ok) { pass++; console.log(`  ✅ ${label}`); }
  else { fail++; console.log(`  ❌ ${label} ${extra}`); }
};

/** Alles wegräumen, was dieser Test angelegt hat. */
const cleanup = () => {
  for (const m of db.listMessages(G, U, 1).items) db.resolveMessage(G, m.id, 'expired');
  for (let p = 1; p <= 5; p++) {
    for (const m of db.listMessages(G, U, p).items) db.resolveMessage(G, m.id, 'expired');
  }
  db.setSeenVersion(G, U, '');
};

cleanup();

(async () => {
  console.log('--- Katalog ---');
  check('mindestens ein Eintrag', notes.length > 0);
  check('jeder Eintrag hat version/title/lines',
    notes.every((n) => n.version && n.title && Array.isArray(n.lines) && n.lines.length));
  check('Versionen sind eindeutig',
    new Set(notes.map((n) => n.version)).size === notes.length);
  check('LATEST ist der oberste Eintrag', patchnotes.LATEST === notes[0].version);

  console.log('--- Auswahl der ausstehenden Notes ---');
  check('neuer Spieler bekommt NUR die neueste',
    patchnotes.pending('').length === 1 && patchnotes.pending('')[0].version === notes[0].version);
  check('wer aktuell ist, bekommt nichts', patchnotes.pending(notes[0].version).length === 0);
  check('unbekannte Version -> nur die neueste',
    patchnotes.pending('0.0.1-gibtsnicht').length === 1);
  if (notes.length > 1) {
    check('wer eine ältere gesehen hat, bekommt alle neueren',
      patchnotes.pending(notes[1].version).length === 1);
  }

  console.log('--- Zustellung ---');
  const before = db.listMessages(G, U, 1).total;
  const toast = patchnotes.deliver(G, U);
  const after = db.listMessages(G, U, 1).total;
  check('Toast wird zurückgegeben', typeof toast === 'string' && toast.includes(notes[0].version),
    String(toast));
  check('Nachricht liegt im Postfach', after === before + 1, `${before} -> ${after}`);
  const msg = db.listMessages(G, U, 1).items.find((m) => m.title.includes('Update'));
  check('Titel nennt die Version', !!msg && msg.title.includes(notes[0].version));
  check('Inhalt enthält die Stichpunkte', !!msg && msg.body.includes(notes[0].lines[0].slice(0, 20)));
  check('Version wurde gemerkt', db.getStats(G, U).seen_version === patchnotes.LATEST);

  console.log('--- Zustellung ist idempotent ---');
  const second = patchnotes.deliver(G, U);
  check('zweiter Aufruf liefert keinen Toast', second === null, String(second));
  check('keine zweite Nachricht', db.listMessages(G, U, 1).total === after);

  console.log('--- Neue Version wird wieder zugestellt ---');
  db.setSeenVersion(G, U, '0.0.0-alt');
  const again = patchnotes.deliver(G, U);
  check('nach altem Stand kommt wieder ein Toast', typeof again === 'string');
  check('und eine neue Nachricht', db.listMessages(G, U, 1).total === after + 1);

  console.log('--- Einzelne Nachricht löschen ---');
  cleanup();
  const info = db.createMessage({ guildId: G, userId: U, type: 'info', title: 'Hinweis' });
  const sold = db.createMessage({ guildId: G, userId: U, type: 'sold', title: 'Verkauft', amount: 500 });
  check('zwei Nachrichten offen', db.listMessages(G, U, 1).total === 2);
  check('löschen klappt', db.deleteMessage(G, U, info.id) === true);
  check('nur noch eine offen', db.listMessages(G, U, 1).total === 1);
  check('zweites Löschen derselben tut nichts', db.deleteMessage(G, U, info.id) === false);
  check('fremde Nachricht lässt sich nicht löschen',
    db.deleteMessage(G, 'ANDERER', sold.id) === false);
  check('die fremde ist noch da', db.listMessages(G, U, 1).total === 1);

  console.log('--- RECHNUNGEN sind geschützt ---');
  cleanup();
  const bill = db.createMessage({
    guildId: G, userId: U, type: 'bill', title: 'Kfz-Steuer', amount: 900,
  });
  db.createMessage({ guildId: G, userId: U, type: 'info', title: 'Nur Info' });
  check('Rechnung lässt sich nicht einzeln löschen',
    db.deleteMessage(G, U, bill.id) === false);
  check('Rechnung zählt nicht als löschbar', db.countDeletable(G, U) === 1,
    String(db.countDeletable(G, U)));

  console.log('--- Postfach leeren ---');
  const removed = db.clearMessages(G, U);
  check('genau eine Nachricht entfernt (die Info)', removed === 1, String(removed));
  check('die Rechnung bleibt offen', db.listMessages(G, U, 1).total === 1);
  check('und es ist wirklich die Rechnung',
    db.listMessages(G, U, 1).items[0].type === 'bill');
  check('nichts mehr zu löschen', db.countDeletable(G, U) === 0);
  check('erneutes Leeren entfernt nichts', db.clearMessages(G, U) === 0);
  check('Rechnung ist weiterhin bezahlbar (nicht resolved)',
    db.getMessage(G, bill.id).resolved === null);

  cleanup();
  console.log(`\n${pass} bestanden, ${fail} fehlgeschlagen`);
  process.exit(fail === 0 ? 0 : 1);
})();
