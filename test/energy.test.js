/**
 * Zeit und Energie: Kostenkurve, Erholung, Faktor, Wand – Handrechnung aus
 * docs/superpowers/specs/2026-09-14-zeit-energie-design.md.
 * Aufruf: DATA_DIR=.testdata node test/energy.test.js
 */
const unb = require('../src/unb');
// Gefälschte Bank VOR allen anderen Modulen (jobs.js destrukturiert changeCash beim Laden).
const konten = new Map();
let bookings = [];
unb.getBalance = async (g, u) => ({ cash: konten.get(u) ?? 0, bank: 0, total: konten.get(u) ?? 0 });
unb.changeCash = async (g, u, amount, reason, opts = {}) => {
  konten.set(u, (konten.get(u) ?? 0) + amount);
  bookings.push({ user: u, amount, reason, opts });
  return { cash: konten.get(u), bank: 0, total: konten.get(u) };
};
unb.withdrawFromBank = async () => ({ cash: 0, bank: 0, total: 0 });

const energy = require('../src/energy');

let pass = 0, fail = 0;
const check = (label, ok, extra = '') => {
  if (ok) { pass++; console.log(`  ✅ ${label}`); }
  else { fail++; console.log(`  ❌ ${label} ${extra}`); }
};
const near = (a, b, eps = 1e-9) => Math.abs(a - b) < eps;
const H = 60 * 60 * 1000;

(async () => {
  console.log('--- Kostenkurve (Stunde n kostet 1,4 + 0,25 × n) ---');
  {
    check('8 h ab 0 kosten 20,2', near(energy.costOf(0, 8), 20.2), String(energy.costOf(0, 8)));
    check('Stunden 9–10 kosten 7,55', near(energy.costOf(8, 2), 7.55), String(energy.costOf(8, 2)));
    check('… als Überstunde doppelt: 15,1', near(energy.costOf(8, 2, 2), 15.1));
    check('12 h kosten 36,3', near(energy.costOf(0, 12), 36.3));
    check('16 h kosten 56,4', near(energy.costOf(0, 16), 56.4));
    check('21 h kosten 87,15', near(energy.costOf(0, 21), 87.15));
    check('22 h kosten 94,05', near(energy.costOf(0, 22), 94.05));
    check('Stückweise = am Stück (8 + 2 = 10)', near(energy.costOf(0, 8) + energy.costOf(8, 2), energy.costOf(0, 10)));
    check('0 Stunden kosten nichts', energy.costOf(5, 0) === 0);
  }

  console.log('--- Energie und Wand ---');
  {
    check('8-h-Tag endet bei 79,8 %', near(energy.energyOf(energy.costOf(0, 8)), 0.798));
    check('10 h mit Überstunde bei 64,7 % (≥ 60 %)',
      near(energy.energyOf(energy.costOf(0, 8) + energy.costOf(8, 2, 2)), 0.647));
    check('21 h: noch über der Wand', !energy.exhausted(energy.costOf(0, 21)));
    check('22 h: an der Wand', energy.exhausted(energy.costOf(0, 22)));
    check('genau 90 Punkte sind noch nicht erschöpft (Wand ist „unter 10 %")', !energy.exhausted(90));
    check('readyAt: 94,05 Punkte → 1,0125 h nach fatigue_at',
      near(energy.readyAt(94.05, 1_000), 1_000 + (4.05 / 4) * H, 1), String(energy.readyAt(94.05, 1_000)));
    check('readyAt ohne Erschöpfung null', energy.readyAt(50, 1_000) === null);
  }

  console.log('--- Erholung (4 Punkte je Echtzeit-Stunde) ---');
  {
    const t = 1_000_000;
    check('Marathon (94,05) nach 8 h bei 62,05 → 37,95 % Energie',
      near(energy.energyOf(energy.recover(94.05, t, t + 8 * H)), 0.3795));
    check('nach 16 h bei 69,95 %', near(energy.energyOf(energy.recover(94.05, t, t + 16 * H)), 0.6995));
    check('nach 24 h voll (klemmt bei 0)', energy.recover(94.05, t, t + 24 * H) === 0);
    check('8-h-Tag (20,2) nach 5 h 3 min voll', energy.recover(20.2, t, t + 5.05 * H) < 1e-9);
    check('ohne fatigue_at keine Erholung, aber auch kein Fehler', energy.recover(30, 0, t) === 30);
    check('Zeit rückwärts erholt nicht', energy.recover(30, t, t - H) === 30);
  }

  console.log('--- Faktor: 1 − 0,8 × (1 − Energie)² ---');
  {
    check('100 % → 1,00', energy.factorOf(1) === 1);
    check('75 % → 0,95', near(energy.factorOf(0.75), 0.95));
    check('50 % → 0,80', near(energy.factorOf(0.5), 0.8));
    check('25 % → 0,55', near(energy.factorOf(0.25), 0.55));
    check('10 % → 0,352', near(energy.factorOf(0.1), 0.352));
    check('0 % → 0,20 (nie unter 0,2)', near(energy.factorOf(0), 0.2));
    check('über 1 wird geklemmt', energy.factorOf(1.5) === 1);
  }

  console.log('--- Sperrtext ---');
  {
    const now = 5_000_000;
    const text = energy.blockText({ reason: 'exhausted', readyAt: now + 62 * 60 * 1000 }, now);
    check('nennt die Restzeit', text.includes('erschöpft') && text.includes('1 h 2 min'), text);
    const past = energy.blockText({ reason: 'exhausted', readyAt: now - 1 }, now);
    check('abgelaufen → „jetzt"', past.includes('jetzt'), past);
  }

  console.log('--- Zeit und Zustand (creator.previewTime / useTime / energyOf) ---');
  {
    const db = require('../src/db');
    const creator = require('../src/creator');
    const G = `ENERGIE_T${Date.now()}`;
    const U = 'u1';
    const t0 = new Date(new Date().setHours(6, 0, 0, 0)).getTime() + 24 * H;

    check('der Tag hat 24 Stunden', creator.TIME_PER_DAY === 24);
    let b = creator.budget(G, U, t0);
    check('frisch: 0 von 24, Energie 100 %, Faktor 1',
      b.used === 0 && b.max === 24 && b.left === 24 && b.energy === 1 && b.factor === 1 && b.readyAt === null,
      JSON.stringify(b));

    // Vorschau schreibt nichts.
    let p = creator.previewTime(G, U, 8, t0);
    check('Vorschau 8 h: ok, Energie danach 79,8 %', p.ok && near(p.energy, 0.798) && near(p.factor, energy.factorOf(0.798)), JSON.stringify(p));
    check('… und hat nichts geschrieben', creator.budget(G, U, t0).used === 0);

    // Buchen: 8 h am Stück.
    let r = creator.useTime(G, U, 8, t0);
    check('8 h gebucht: 16 übrig, Energie 79,8 %', r.ok && r.used === 8 && r.left === 16 && near(r.energy, 0.798), JSON.stringify(r));
    check('energyOf liest denselben Stand', near(creator.energyOf(G, U, t0).energy, 0.798));

    // Überstunde: 2 h mit doppelter Müdigkeit → 64,7 %.
    r = creator.useTime(G, U, 2, t0, { fatigueFactor: 2 });
    check('2 h doppelt müde: 64,7 %', r.ok && near(r.energy, 0.647), JSON.stringify(r));

    // Erholung wirkt in Echtzeit: 1 h später 4 Punkte weniger.
    check('eine Stunde später +4 Punkte', near(creator.energyOf(G, U, t0 + H).energy, 0.687));

    // Bis zur Wand: weitere 12 h (insgesamt 22) am selben Zeitpunkt t0.
    r = creator.useTime(G, U, 12, t0);
    check('22 h gebucht, jetzt unter der Wand', r.ok && r.used === 22 && r.energy < 0.1, JSON.stringify(r));
    r = creator.useTime(G, U, 1, t0);
    check('nächste Aktion: exhausted mit readyAt', r.ok === false && r.reason === 'exhausted' && r.readyAt > t0, JSON.stringify(r));
    // readyAt ist ein fester Wanduhr-Zeitpunkt, kein Countdown: 30 Minuten
    // später (noch erschöpft) muss derselbe Zeitpunkt herauskommen wie eben.
    const spaeter = creator.useTime(G, U, 1, t0 + 30 * 60 * 1000);
    check('readyAt wandert nicht mit der Uhr (30 min später derselbe Zeitpunkt)',
      spaeter.ok === false && spaeter.reason === 'exhausted' && Math.abs(spaeter.readyAt - r.readyAt) < 1000,
      `${spaeter.readyAt} vs ${r.readyAt}`);
    check('… und die Stunden bleiben bei 22', creator.budget(G, U, t0).used === 22);
    const ready = creator.energyOf(G, U, t0).readyAt;
    r = creator.useTime(G, U, 1, ready + 1);
    check('ab readyAt geht es wieder (23. Stunde)', r.ok && r.used === 23, JSON.stringify(r));
    // Die 23. Stunde reißt die Erschöpfung selbst wieder über die Wand
    // (97,15 Punkte); erst wenn sie zwei weitere Stunden real abgeklungen
    // ist, greift beim Versuch, mehr als 24 h zu buchen, tatsächlich
    // no_time statt exhausted (Wand wird vor den Stunden geprüft, §Spec).
    r = creator.useTime(G, U, 2, ready + 1 + 2 * H);
    check('mehr als 24: no_time', r.ok === false && r.reason === 'no_time' && r.left === 1, JSON.stringify(r));

    // Neuer Tag: Stunden auf 0, Erschöpfung erholt sich nur mit der Zeit.
    // Stand nach der 23. Stunde (bei ready+1 = t0 + 2,5 h): 90 + costOf(22, 1) = 90 + 7,15 = 97,15;
    // bis t0 + 24 h vergehen 21,5 h × 4 = 86 Punkte → 11,15 → 88,85 %.
    b = creator.budget(G, U, t0 + 24 * H);
    check('nächster Tag: 0 von 24, Energie bei ~88,9 %', b.used === 0 && near(b.energy, 0.8885, 1e-3), JSON.stringify(b));

    // Marathon-Prüfpunkt: Wand um Mitternacht, 8 Uhr ~38 %.
    const V = 'u2';
    const mitternacht = new Date(new Date(t0).setHours(24, 0, 0, 0)).getTime();
    creator.useTime(G, V, 22, mitternacht - 1);
    const morgen = creator.energyOf(G, V, mitternacht - 1 + 8 * H);
    check('Marathon: um 8 Uhr 35–45 % Energie', morgen.energy > 0.35 && morgen.energy < 0.45, String(morgen.energy));
  }

  console.log('--- Jobs: Zeit, Überstunde, Faktor ---');
  {
    const db = require('../src/db');
    const creator = require('../src/creator');
    const jobs = require('../src/jobs');
    const JOBS = require('../src/data/jobs');
    const G = `ENERGIE_J${Date.now()}`;
    const U = 'j1';
    const easy = JOBS.find((j) => !(j.requires ?? []).length);
    db.setEmployment(G, U, easy.id);
    const t0 = new Date(new Date().setHours(6, 0, 0, 0)).getTime() + 24 * H;
    const at = (h) => new Date(t0 + h * H);

    check('Konstanten: 1 Überstunde, ×1,25, doppelt müde',
      jobs.OVERTIME_SHIFTS === 1 && jobs.OVERTIME_PAY === 1.25 && jobs.OVERTIME_FATIGUE === 2);

    // Vier reguläre Schichten, jede 2 h aus dem 24-h-Tag (Cooldown des Jobs beachten).
    const step = Math.max(2, Math.ceil(easy.cooldown / 60) + 0.01);
    let r;
    for (let i = 0; i < 4; i++) {
      r = await jobs.work(G, U, at(i * step));
      check(`Schicht ${i + 1} regulär`, r.ok && r.overtime === false && r.overtimeBonus === 0, JSON.stringify(r));
    }
    check('vier Schichten = 8 von 24 Stunden', creator.budget(G, U, t0 + 3 * step * H).used === 8);
    let b = jobs.shiftBudget(G, U, at(3 * step));
    check('shiftBudget: 4/4, nächste ist Überstunde', b.done === 4 && b.left === 0 && b.nextIsOvertime === true && b.overtimeLeft === 1, JSON.stringify(b));

    // Die fünfte Schicht ist die Überstunde: Lohn ×1,25 auf den Grundlohn, doppelte Müdigkeit.
    const vor = creator.energyOf(G, U, t0 + 4 * step * H).fatigue;
    r = await jobs.work(G, U, at(4 * step));
    check('5. Schicht = Überstunde', r.ok && r.overtime === true && r.overtimeBonus > 0, JSON.stringify(r));
    check('Bonus ist ein Viertel des Grundlohns (auf Taler gerundet)',
      Math.abs(r.overtimeBonus - Math.round((r.base - r.overtimeBonus) * 0.25)) <= 1, `${r.base} / ${r.overtimeBonus}`);
    const nach = creator.energyOf(G, U, t0 + 4 * step * H).fatigue;
    check('Überstunde macht doppelt müde: 2 × costOf(8, 2) = 15,1 (nach Erholung seit der 4. Schicht)',
      near(nach - vor, energy.costOf(8, 2, 2), 1e-6), `${nach - vor}`);
    check('10 von 24 Stunden', creator.budget(G, U, t0 + 4 * step * H).used === 10);

    r = await jobs.work(G, U, at(5 * step));
    check('6. Schicht: daily_limit mit 5 von 5', r.ok === false && r.reason === 'daily_limit' && r.done === 5 && r.max === 5, JSON.stringify(r));

    // Faktor auf den Lohn: bei 50 Punkten Erschöpfung (vor der Schicht) zahlt die Schicht weniger.
    const V = 'j2';
    db.setEmployment(G, V, easy.id);
    const s = db.getCreatorState(G, V, t0);
    db.saveCreatorState(G, V, { ...s, fatigue: 50, fatigue_at: t0 });
    const realRandom = Math.random; Math.random = () => 0.5;           // variance = 1,0
    r = await jobs.work(G, V, new Date(t0));
    Math.random = realRandom;
    // Nach der Schicht: 50 + costOf(0, 2) = 53,55 → Energie 0,4645 → Faktor 0,77059.
    const erwartet = Math.max(1, Math.round(easy.pay * 0.77059));
    check('Lohn bei 46 % Energie: Grundlohn × 0,7706', r.ok && Math.abs(r.base - erwartet) <= 1 && near(r.factor, 0.77059, 1e-4),
      `base ${r.base} erwartet ${erwartet} factor ${r.factor}`);

    // Wand: erschöpft → keine Schicht, keine Buchung.
    const W = 'j3';
    db.setEmployment(G, W, easy.id);
    const sw = db.getCreatorState(G, W, t0);
    db.saveCreatorState(G, W, { ...sw, fatigue: 95, fatigue_at: t0 });
    bookings = [];
    r = await jobs.work(G, W, new Date(t0));
    check('erschöpft: exhausted mit readyAt, nichts gebucht', r.ok === false && r.reason === 'exhausted' && r.readyAt > t0 && bookings.length === 0, JSON.stringify(r));
    check('… und die Schicht zählt nicht', db.shiftsToday(G, W, jobs.today(new Date(t0))) === 0);
  }

  console.log(`\n${pass} bestanden, ${fail} fehlgeschlagen`);
  process.exit(fail === 0 ? 0 : 1);
})();
