/**
 * Tests für den Titel im Profil (activity.js).
 *
 * Der Titel entsteht aus einer Strichliste: Jede Aktion, die Geld bewegt,
 * macht einen Strich. Wichtig ist deshalb vor allem, dass **eine Aktion genau
 * einen Strich** macht – und dass Buchungen, die keine Aktion sind (Käufe,
 * Storno, Rückerstattungen), gar keinen machen.
 *
 * Aufruf: node test/activity.test.js
 */
process.env.WORLD_ID = `ACT_T${Date.now()}`;

const db = require('../src/db');
const unb = require('../src/unb');
const identity = require('../src/identity');
const activity = require('../src/activity');

const W = identity.world();
let pass = 0, fail = 0;
const check = (label, ok, extra = '') => {
  if (ok) { pass++; console.log(`  ✅ ${label}`); }
  else { fail++; console.log(`  ❌ ${label} ${extra}`); }
};

let n = 0;
const player = () => `fx:act${n++}`;
const countOf = (u, kind) =>
  db.activityOf(W, u).find((r) => r.kind === kind)?.count ?? 0;

(async () => {
  console.log('--- Die Strichliste ---');
  const U = player();
  check('unbekannte Aktivität wird ignoriert', activity.record(W, U, 'quatsch') === false);
  check('und landet nicht in der Liste', db.activityOf(W, U).length === 0);

  activity.record(W, U, 'job');
  activity.record(W, U, 'job');
  activity.record(W, U, 'fishing');
  check('Striche werden gezählt', countOf(U, 'job') === 2, String(countOf(U, 'job')));
  check('je Aktivität getrennt', countOf(U, 'fishing') === 1);

  console.log('--- Der Titel folgt der Häufigkeit ---');
  check('die häufigste Aktivität gewinnt', activity.titleOf(W, U).id === 'job',
    JSON.stringify(activity.titleOf(W, U)));
  for (let i = 0; i < 5; i++) activity.record(W, U, 'fishing');
  check('und ändert sich, wenn sich das Verhalten ändert',
    activity.titleOf(W, U).id === 'fishing', activity.titleOf(W, U).id);
  check('der Titel ist nicht "gewählt"', activity.titleOf(W, U).chosen === false);

  console.log('--- Stufen ---');
  check('erste Stufe ab dem ersten Mal', activity.titleFor('heist', 1).title === 'Kleinkrimineller');
  check('zweite Stufe später', activity.titleFor('heist', 30).title === 'Ganove');
  check('dritte Stufe erst richtig spät', activity.titleFor('heist', 500).title === 'Meisterdieb');
  check('ohne ein einziges Mal gibt es keinen', activity.titleFor('heist', 0) === null);
  check('jede Aktivität hat genau drei Stufen',
    activity.KINDS.every((k) => k.titles.length === 3));
  check('keine Kennung doppelt',
    new Set(activity.KINDS.map((k) => k.id)).size === activity.KINDS.length);
  check('kein Titel doppelt', (() => {
    const all = activity.KINDS.flatMap((k) => k.titles);
    return new Set(all).size === all.length;
  })());

  console.log('--- Selbst wählen ---');
  check('nur was man gemacht hat', activity.choose(W, U, 'heist') === true);
  check('ein nie gemachter Titel wird nicht getragen',
    activity.titleOf(W, U).id === 'fishing', activity.titleOf(W, U).id);
  activity.record(W, U, 'heist');
  check('sobald man es tut, sitzt er', activity.titleOf(W, U).id === 'heist');
  check('und ist als gewählt erkennbar', activity.titleOf(W, U).chosen === true);
  check('Unsinn wird abgelehnt', activity.choose(W, U, 'gibtsnicht') === false);
  check('der alte Wunsch bleibt dann stehen', activity.titleOf(W, U).id === 'heist');

  activity.choose(W, U, 'none');
  check('"keiner" heißt keiner', activity.titleOf(W, U) === null);
  activity.choose(W, U, '');
  check('zurück auf automatisch', activity.titleOf(W, U).id === 'fishing',
    JSON.stringify(activity.titleOf(W, U)));

  console.log('--- Freigespielt ist nur, was man getan hat ---');
  const list = activity.unlocked(W, U);
  check('drei Aktivitäten', list.length === 3, String(list.length));
  check('häufigste zuerst', list[0].id === 'fishing', list.map((t) => t.id).join());
  check('nichts Ungemachtes dabei', list.every((t) => t.count > 0));

  console.log('--- Gezählt wird an der Buchung (§9: eine je Aktion) ---');
  const V = player();
  await unb.changeCash(W, V, 500, 'Schicht: Test', { kind: 'job' });
  check('eine Buchung mit Kennung = ein Strich', countOf(V, 'job') === 1, String(countOf(V, 'job')));

  await unb.changeCash(W, V, -200, 'Kauf: irgendwas');
  check('eine Buchung ohne Kennung zählt nicht', db.activityOf(W, V).length === 1,
    JSON.stringify(db.activityOf(W, V)));

  await unb.changeCash(W, V, 500, 'Storno', { kind: 'job', xp: false });
  check('Storno zählt nicht mit', countOf(V, 'job') === 1, String(countOf(V, 'job')));

  await unb.changeCash(W, V, 100, 'Fang: Hering', { kind: 'fishing' });
  check('andere Aktivität, eigener Strich', countOf(V, 'fishing') === 1);

  console.log('--- Im Profil ---');
  const ui = require('../src/ui');
  unb.getBalance = async () => ({ cash: 1, bank: 1, total: 2 });
  const view = await ui.buildProfileView({ guildId: W, userId: U });
  const desc = view.embeds[0].toJSON().description;
  check('der Titel steht im Profil', desc.includes('Sonntagsangler'), desc);

  const picker = await ui.buildTitleView({ guildId: W, userId: U });
  const fields = picker.embeds[0].toJSON().fields ?? [];
  check('die Auswahl listet die freigespielten', fields[0]?.value.includes('Sonntagsangler'),
    fields[0]?.value);
  check('und nichts Ungemachtes', !(fields[0]?.value ?? '').includes('Börsianer'));
  const labels = picker.components.flatMap((r) => r.toJSON().components.map((c) => c.label));
  check('Automatisch und Keiner stehen zur Wahl',
    labels.includes('Automatisch') && labels.includes('Keiner'), labels.join(' | '));

  console.log('--- Bestandsspieler bekommen ihre Vorgeschichte angerechnet ---');
  /*
   * Die Strichliste ist neu. Wer vorher 40 Schichten geschoben hat, stünde
   * ohne Titel da – deshalb übernimmt der Nachtrag einmalig die Zähler, die
   * es schon länger gibt (Anstellung, Verbrecherakte, Creator, Musik, Funde).
   */
  const ALT = player();
  db.setEmployment(W, ALT, 'kellner');
  for (let i = 0; i < 40; i++) db.recordShift(W, ALT, 100, '2026-09-01');
  db.addLoot(W, ALT, 'Alte Kiste', 1000, 'common');

  check('vorher steht nichts in der Liste', db.activityOf(W, ALT).length === 0);
  const nachgetragen = activity.backfill(W, ALT);
  check('der Nachtrag greift', nachgetragen === 2, String(nachgetragen));
  check('die Schichten sind da', countOf(ALT, 'job') === 40, String(countOf(ALT, 'job')));
  check('die Fundstücke auch', countOf(ALT, 'auction') === 1);
  check('und daraus entsteht sofort ein Titel', activity.titleOf(W, ALT).id === 'job',
    JSON.stringify(activity.titleOf(W, ALT)));

  for (let i = 0; i < 5; i++) db.recordShift(W, ALT, 100, '2026-09-02');
  check('ein zweiter Nachtrag fasst nichts mehr an', activity.backfill(W, ALT) === 0);
  check('und überschreibt den Zählerstand nicht', countOf(ALT, 'job') === 40,
    String(countOf(ALT, 'job')));

  const ALT2 = player();
  db.setEmployment(W, ALT2, 'kellner');
  for (let i = 0; i < 7; i++) db.recordShift(W, ALT2, 100, '2026-09-01');
  activity.record(W, ALT2, 'fishing');
  check('auch die erste neue Aktion löst den Nachtrag aus',
    countOf(ALT2, 'job') === 7 && countOf(ALT2, 'fishing') === 1,
    JSON.stringify(db.activityOf(W, ALT2)));

  console.log('--- Wer noch nichts getan hat ---');
  const NEU = player();
  check('bekommt keinen Titel', activity.titleOf(W, NEU) === null);
  const leer = await ui.buildTitleView({ guildId: W, userId: NEU });
  check('und eine Ansicht, die das erklärt',
    leer.embeds[0].toJSON().description.includes('Noch nichts getan'));
  check('ohne Absturz', leer.components.length >= 1);

  console.log(`\n${pass} bestanden, ${fail} fehlgeschlagen`);
  process.exit(fail === 0 ? 0 : 1);
})();
