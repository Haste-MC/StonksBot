/**
 * Tests für die Erfolge (achievements.js).
 *
 * Der heikelste Teil ist nicht das Vergeben, sondern die Einmaligkeit: Ein
 * serverweiter Erfolg darf genau einen Gewinner haben, auch wenn zwei Spieler
 * in derselben Millisekunde fertig werden. Deshalb hängt sie am
 * Primärschlüssel und nicht an einer Prüfung im Code.
 *
 * Aufruf: node test/achievements.test.js
 */
process.env.WORLD_ID = `ACH_T${Date.now()}`;

const db = require('../src/db');
const identity = require('../src/identity');

const W = identity.world();
let pass = 0, fail = 0;
const check = (label, ok, extra = '') => {
  if (ok) { pass++; console.log(`  ✅ ${label}`); }
  else { fail++; console.log(`  ❌ ${label} ${extra}`); }
};

const A = 'fx:anton', B = 'fx:berta';

(async () => {
  console.log('--- Vergeben ist einmalig je Konto ---');
  check('erste Vergabe zählt', db.awardAchievement(W, A, 'job_1', 1000) === true);
  check('die zweite nicht mehr', db.awardAchievement(W, A, 'job_1', 2000) === false);
  check('ein anderes Konto bekommt ihn trotzdem',
    db.awardAchievement(W, B, 'job_1', 3000) === true);

  const meine = db.achievementsOf(W, A);
  check('der Erfolg steht in der Liste', meine.length === 1 && meine[0].ach_id === 'job_1',
    JSON.stringify(meine));
  check('mit dem Zeitpunkt der ERSTEN Vergabe', meine[0].at === 1000, String(meine[0]?.at));

  console.log('--- Serverweit gewinnt genau einer ---');
  check('Anton war zuerst da', db.claimFirst(W, 'srv_millionaire', A, 1000) === true);
  check('Berta geht leer aus', db.claimFirst(W, 'srv_millionaire', B, 1001) === false);

  const tafel = db.allFirsts(W);
  const eintrag = tafel.find((r) => r.ach_id === 'srv_millionaire');
  check('die Ehrentafel nennt den Gewinner', eintrag?.user_id === A, JSON.stringify(eintrag));
  check('und nur einen', tafel.filter((r) => r.ach_id === 'srv_millionaire').length === 1);

  console.log(`\n${pass} bestanden, ${fail} fehlgeschlagen`);
  process.exit(fail === 0 ? 0 : 1);
})();
