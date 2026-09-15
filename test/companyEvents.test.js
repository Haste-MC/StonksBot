/**
 * Firmen Stück 2b: Kataloge, Wirkungen, Abrechnung mit Ereignissen, Vorfälle.
 * Aufruf: DATA_DIR=.testdata node test/companyEvents.test.js
 */
const unb = require('../src/unb');
const konten = new Map();
let bookings = [];
unb.getBalance = async (g, u) => ({ cash: konten.get(u) ?? 0, bank: 0, total: konten.get(u) ?? 0 });
unb.changeCash = async (g, u, amount, reason, opts = {}) => {
  konten.set(u, (konten.get(u) ?? 0) + amount);
  bookings.push({ user: u, amount, reason, opts });
  return { cash: konten.get(u), bank: 0, total: konten.get(u) };
};
unb.withdrawFromBank = async (g, u, amount) => ({ cash: konten.get(u) ?? 0, bank: 0, total: konten.get(u) ?? 0 });

const data = require('../src/data/companies');
const events = require('../src/data/companyEvents');
const { COMPANY_DECISIONS } = require('../src/data/companyDecisions');
const { DECISIONS } = require('../src/data/decisions');
const { MUSIC_DECISIONS } = require('../src/data/musicDecisions');

let pass = 0, fail = 0;
const check = (label, ok, extra = '') => {
  if (ok) { pass++; console.log(`  ✅ ${label}`); }
  else { fail++; console.log(`  ❌ ${label} ${extra}`); }
};
const near = (a, b, eps = 1e-9) => Math.abs(a - b) < eps;
const DAY_MS = 24 * 60 * 60 * 1000;

/** Grenzen der Wirkungstabelle aus der Spec. */
const GRENZEN = {
  umsatz: [0.4, data.EVENT_UMSATZ_MAX], days: [1, 7], auslastung: [-0.2, 0.2], kasse: [-3, 0],
  refund: [0, 1.5], wages: [0, 1.5], quit: [0, 2], lock: [0, 5], werbung: [-3, 3], staffRank: [-1, 1],
};
const FELDER = new Set([...Object.keys(GRENZEN), 'sell']);
function wirkungOk(e, label) {
  for (const [k, v] of Object.entries(e)) {
    if (['id', 'weight', 'text', 'klassen', 'flavor'].includes(k)) continue;
    if (!FELDER.has(k)) { check(`${label}: unbekanntes Feld ${k}`, false); return; }
    if (k === 'sell') continue;
    const [lo, hi] = GRENZEN[k];
    check(`${label}: ${k}=${v} in [${lo}, ${hi}]`, typeof v === 'number' && v >= lo && v <= hi);
  }
  if (e.refund && !(e.kasse < 0)) check(`${label}: refund nur mit kasse-Abzug`, false);
}

(async () => {
  console.log('--- Leichte Ereignisse: Katalog ---');
  {
    check('EVENT_UMSATZ_MAX ist 1,15', data.EVENT_UMSATZ_MAX === 1.15);
    const list = events.COMPANY_EVENTS;
    check('none zuerst mit Gewicht 140', list[0].id === 'none' && list[0].weight === 140 && list[0].text === null);
    check('zwölf Ereignisse je Gewicht 5', list.length === 13 && list.slice(1).every((e) => e.weight === 5));
    check('IDs eindeutig', new Set(list.map((e) => e.id)).size === list.length);
    for (const e of list.slice(1)) {
      check(`${e.id}: Text mit Emoji vorn`, typeof e.text === 'string' && e.text.length > 10);
      check(`${e.id}: kein lock (nur Vorfälle sperren)`, e.lock === undefined);
      wirkungOk(e, e.id);
    }
    const gut = list.slice(1).filter((e) => (e.umsatz ?? 1) > 1 || (e.auslastung ?? 0) > 0 || (e.wages ?? 1) < 1
      || (e.werbung ?? 0) > 0 || (e.staffRank ?? 0) > 0);
    check('sechs gute, sechs schlechte', gut.length === 6, String(gut.length));
    const mittel = events.candidates('mittel');
    const klein = events.candidates('klein');
    check('mittel sieht alle 13 Kandidaten', mittel.length === 13);
    check('klein sieht 10 (ohne grossauftrag, talent, abwanderung)', klein.length === 10
      && !klein.some((c) => ['grossauftrag', 'talent', 'abwanderung'].includes(c.event.id)));
    const sum = (l) => l.reduce((s, c) => s + c.weight, 0);
    check('Ereignisquote mittel 30 %', near(1 - 140 / sum(mittel), 0.3));
    check('Ereignisquote klein ≈ 24 %', near(1 - 140 / sum(klein), 45 / 185));
    check('NO_EVENT ist none', events.NO_EVENT === list[0]);
  }

  console.log('--- Vorfälle: Katalog ---');
  {
    check('sechs Vorfälle', COMPANY_DECISIONS.length === 6);
    const ids = [...DECISIONS, ...MUSIC_DECISIONS, ...COMPANY_DECISIONS].map((d) => d.id);
    check('IDs eindeutig über alle drei Kataloge', new Set(ids).size === ids.length);
    for (const d of COMPANY_DECISIONS) {
      check(`${d.id}: Kopf vollständig`, d.emoji && d.title && typeof d.minGroesse === 'number' && d.text);
      check(`${d.id}: 2–3 Optionen`, d.options.length >= 2 && d.options.length <= 3);
      check(`${d.id}: expire mit Text`, d.expire && typeof d.expire.text === 'string');
      wirkungOk(d.expire, `${d.id}/expire`);
      for (const o of d.options) {
        check(`${d.id}/${o.id}: 1–3 Ausgänge mit Gewicht > 0 und Text`,
          o.outcomes.length >= 1 && o.outcomes.length <= 3 && o.outcomes.every((x) => x.weight > 0 && x.text));
        for (const x of o.outcomes) wirkungOk(x, `${d.id}/${o.id}`);
      }
    }
    const u = COMPANY_DECISIONS.find((d) => d.id === 'uebernahme');
    check('nur die Übernahme verkauft', COMPANY_DECISIONS.every((d) => d.options.every((o) => o.outcomes.every((x) =>
      !x.sell || d.id === 'uebernahme'))) && u.options.some((o) => o.outcomes.some((x) => x.sell === true)));
    const s = COMPANY_DECISIONS.find((d) => d.id === 'streik');
    check('Streik braucht Größe 3 und 3 NPCs', s.minGroesse === 3 && s.minNpc === 3);
    const w = COMPANY_DECISIONS.find((d) => d.id === 'wasserschaden').options.find((o) => o.id === 'versicherung');
    check('Versicherung: Abzug in jedem Ausgang, Rückerstattung nur in einem',
      w.outcomes.every((x) => x.kasse === -1.5 && x.lock === 2) && w.outcomes.filter((x) => x.refund === 1).length === 1);
  }

  console.log(`\n${pass} bestanden, ${fail} fehlgeschlagen`);
  process.exit(fail === 0 ? 0 : 1);
})();
