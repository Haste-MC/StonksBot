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

  console.log(`\n${pass} bestanden, ${fail} fehlgeschlagen`);
  process.exit(fail === 0 ? 0 : 1);
})();
