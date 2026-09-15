# Firmen Stück 2b – Ereignisse und Vorfälle – Implementierungsplan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Spielerfirmen bekommen leichte Tagesereignisse in der Abrechnung und Vorfälle mit Entscheidung (Domäne `company`), ohne die Decke aus §3 aufzugeben (`EVENT_UMSATZ_MAX = 1,15`).

**Architecture:** Zwei Datenkataloge (`data/companyEvents.js`, `data/companyDecisions.js`) mit einem gemeinsamen Wirkungsvokabular, das `company.applyEffect` synchron auf eine Firma anwendet. `company.settle` würfelt je Tag ein leichtes Ereignis und nach der Abrechnung einen Vorfall über `decisions.roll(…, 'company')`; `decisions.applyCompany` wendet Ausgänge über dieselbe `applyEffect` an. Mehrtägige Wirkungen leben in neuen Spalten der Tabelle `companies`; Vorfälle in `creator_events` mit `platform = 'company'`.

**Tech Stack:** Node.js, better-sqlite3 (synchron), discord.js-Builder, eigene Test-Skripte (`node test/<x>.test.js`), Messskript `scripts/messung-geldquellen.js`.

## Global Constraints

- Spec: `docs/superpowers/specs/2026-09-15-firmen-ereignisse-design.md` – Katalogtabellen und Wirkungsgrenzen dort sind bindend.
- ARCHITEKTUR.md: §3 kein Gelddrucker (`EVENT_UMSATZ_MAX = 1.15`; `kasse ≤ 0`; `refund` nie über Abzug; Übernahme zahlt höchstens investiert + Kasse), §4 faule Abrechnung, §7 synchrone Schreibvorgänge vor dem ersten `await`, §8 spät gebundene `require` in Funktionen (company ↔ decisions ↔ jobs), §9 eine Buchung je Aktion, §12 Tests ohne Netz.
- Größe/Risiko/Härte wörtlich: `groesse = stufe + Extras (0…9)`, `riskPerDay = 0.02 + groesse/9 × 0.06`, `riskFor(groesse, days) = 1 − (1 − riskPerDay)^days`, `severityFor = 1 + groesse/9 × 0.6`, Schweigen × `IGNORE_PENALTY 1.6`. Leichte Ereignisse werden nicht verstärkt.
- Katalog leichte Ereignisse: `none` Gewicht 140, zwölf Einträge je Gewicht 5, Klassenfilter wie in der Spec. Vorfälle: sechs Einträge mit `minGroesse`/`minNpc` wie in der Spec.
- Zeitregeln: Faktor-Laufzeiten `until = at + (days − (today ? 1 : 0)) × DAY_MS`; ein Tag ist betroffen, wenn `until >= tag`. `lock` nur aus Vorfällen: `closed_until = now + lock × DAY_MS`; Abrechnungstag geschlossen, wenn `tag <= closed_until`; Echtzeit gesperrt, wenn `now < closed_until`.
- Tests laufen so: `rm -rf .testdata && DATA_DIR=.testdata node test/<x>.test.js`; volle Suite `npm test 2>&1 | grep -c '❌'` → `0`. Gefälschte Bank wie in `test/company.test.js` (`unb.getBalance/changeCash/withdrawFromBank` überschreiben, `konten`-Map).
- Alle Texte Deutsch; Commit-Trailer wörtlich `Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>`.

---

### Task 1: Kataloge und Katalogtest

**Files:**
- Create: `src/data/companyEvents.js`, `src/data/companyDecisions.js`
- Modify: `src/data/companies.js` (Konstante `EVENT_UMSATZ_MAX`, Export)
- Create: `test/companyEvents.test.js`
- Modify: `package.json` (`&& node test/companyEvents.test.js` nach `node test/company.test.js`)

**Interfaces:**
- Produces: `companyEvents.COMPANY_EVENTS` (Array, erster Eintrag `{ id:'none', weight:140, text:null }`), `companyEvents.candidates(klasse)` → `[{ event, weight }]` (nur Einträge ohne `klassen` oder mit `klassen.includes(klasse)`), `companyEvents.NO_EVENT`. `companyDecisions.COMPANY_DECISIONS` (Array wie `MUSIC_DECISIONS`: `{ id, emoji, title, minGroesse, minNpc?, text, options:[{ id, label, emoji, outcomes:[{ weight, text, …Wirkung }] }], expire:{ text, …Wirkung } }`). `data/companies.EVENT_UMSATZ_MAX = 1.15`. Wirkungsfelder: `umsatz, days, auslastung, kasse, refund, wages, quit, lock, werbung, staffRank, sell`.

- [ ] **Step 1: Test schreiben**

```js
// test/companyEvents.test.js
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
```

- [ ] **Step 2: Test laufen lassen – muss fehlschlagen**

Run: `rm -rf .testdata && DATA_DIR=.testdata node test/companyEvents.test.js`
Expected: `Cannot find module '../src/data/companyEvents'`

- [ ] **Step 3: Konstante und Kataloge schreiben**

`src/data/companies.js`, nach `MAX_SETTLE_DAYS`:

```js
const EVENT_UMSATZ_MAX = 1.15;      // §3: kein Ereignis hebt den Tagesumsatz über Decke × 1,15
```

und in `module.exports` aufnehmen.

```js
// src/data/companyEvents.js
/**
 * ===========================================================================
 *  LEICHTE EREIGNISSE EINER FIRMA
 * ===========================================================================
 *
 * Das Gegenstück zu data/musicEvents.js: je abgerechnetem Tag ein Wurf in
 * company.settle, wirkt sofort, kein Klick. Branchenneutral formuliert –
 * die Härte kommt aus der Tagesdecke, nicht aus dem Text. `flavor` darf je
 * Branche einen eigenen Text liefern (Start: keiner).
 *
 *   klassen     welche Firmenklassen den Eintrag sehen (null = alle)
 *   umsatz      Faktor auf den Umsatz der nächsten `days` Tage (≤ 1,15, §3)
 *   days        Dauer für umsatz/wages in Tagen (Standard 1)
 *   auslastung  Punkte auf die Auslastung (±), gedeckelt 0…1
 *   kasse       Vielfaches der Tagesdecke, negativ = Abzug (nie positiv)
 *   wages       Faktor auf die NPC-Löhne der `days` Tage
 *   quit        so viele NPCs kündigen (die dienstältesten zuerst)
 *   werbung     Werbetage ±
 *   staffRank   ein zufälliger NPC ±1 Rang
 *
 * Kein `lock` hier: Betriebsschließungen gibt es nur in Vorfällen.
 */

const COMPANY_EVENTS = [
  { id: 'none', weight: 140, text: null },

  // ------------------------------------------------------------------ gut
  { id: 'stammkunde', weight: 5, umsatz: 1.10,
    text: '🤝 Ein Stammkunde bringt seine Kollegen mit.' },
  { id: 'grossauftrag', weight: 5, klassen: ['mittel', 'gross'], umsatz: 1.15, days: 2,
    text: '📦 Ein Großauftrag – zwei Tage volle Auslastung.' },
  { id: 'lokalpresse', weight: 5, auslastung: 0.1,
    text: '📰 Die Lokalzeitung hat euch erwähnt.' },
  { id: 'guter_tag', weight: 5, wages: 0.5,
    text: '☀️ Ruhiger Tag, halbe Belegschaft reicht – die Löhne auch.' },
  { id: 'empfehlung', weight: 5, werbung: 1,
    text: '⭐ Fünf Sterne online – wirkt wie ein Tag Werbung.' },
  { id: 'talent', weight: 5, klassen: ['mittel', 'gross'], staffRank: 1,
    text: '🎓 Einer deiner Leute wächst über sich hinaus.' },

  // ------------------------------------------------------------- schlecht
  { id: 'lieferant', weight: 5, umsatz: 0.7,
    text: '🚚 Der Lieferant kommt nicht. Halbleere Regale.' },
  { id: 'kuehlung', weight: 5, kasse: -0.5,
    text: '🧊 Die Kühlung fällt aus. Was drin war, ist hin.' },
  { id: 'kassensturz', weight: 5, kasse: -0.3,
    text: '🧾 Die Kasse stimmt nicht. Keiner weiß, warum.' },
  { id: 'krank', weight: 5, umsatz: 0.8,
    text: '🤒 Zwei Leute krank – Lohn läuft, Umsatz nicht.' },
  { id: 'abwanderung', weight: 5, klassen: ['mittel', 'gross'], quit: 1,
    text: '👋 Einer deiner Leute geht zur Konkurrenz.' },
  { id: 'bewertung', weight: 5, auslastung: -0.1,
    text: '💬 Eine Ein-Stern-Bewertung macht die Runde.' },
];

const NO_EVENT = COMPANY_EVENTS[0];

/** Kandidaten einer Firmenklasse mit Gewichten – Würfel und Tests ziehen hier. */
function candidates(klasse) {
  return COMPANY_EVENTS
    .filter((e) => !e.klassen || e.klassen.includes(klasse))
    .map((e) => ({ event: e, weight: e.weight }));
}

module.exports = { COMPANY_EVENTS, NO_EVENT, candidates };
```

```js
// src/data/companyDecisions.js
/**
 * ===========================================================================
 *  VORFÄLLE EINER FIRMA – die Entscheidungen des Inhabers
 * ===========================================================================
 *
 * Dritte Domäne des Entscheidungs-Systems (decisions.js) neben Creator und
 * Musik. Gewürfelt nach der Tagesabrechnung, entschieden nur vom Inhaber,
 * Frist 24 h. Wirkungen wie bei den leichten Ereignissen (siehe
 * data/companyEvents.js), dazu:
 *
 *   minGroesse  ab welcher Größe (Stufe + Extras, 0…9) der Vorfall auftaucht
 *   minNpc      so viele NPC-Angestellte braucht es mindestens
 *   refund      Vielfaches der Tagesdecke zurück – nur nach einem kasse-Abzug
 *               derselben Option, nie mehr als abgezogen
 *   lock        Betrieb geschlossen für N Tage (Löhne laufen)
 *   sell        Übernahme: Firma schließt, Auszahlung = investiert + Kasse
 *
 * Verluste werden mit der Härte der Größe verstärkt (× 1 … 1,6), × 1,6 bei
 * Schweigen. Kein Ausgang zerstört Ausbau – die Schließung ist das Härteste.
 */

const COMPANY_DECISIONS = [
  {
    id: 'gesundheitsamt', emoji: '🧑‍⚕️', title: 'Das Gesundheitsamt steht vor der Tür',
    minGroesse: 0,
    text: 'Unangemeldete Kontrolle. Die Liste der Mängel ist länger, als dir lieb ist.',
    options: [
      { id: 'beheben', label: 'Sofort beheben', emoji: '🔧',
        outcomes: [
          { weight: 10, kasse: -1, text: 'Ein Tag Umsatz für Handwerker und Auflagen. Dafür ist Ruhe.' },
        ] },
      { id: 'abwarten', label: 'Abwarten', emoji: '⏳',
        outcomes: [
          { weight: 5, text: 'Die Nachkontrolle kommt nie. Glück gehabt.' },
          { weight: 5, lock: 3, auslastung: -0.2,
            text: 'Sie kommen wieder – mit Siegel. Drei Tage zu, und die Kundschaft hat es gesehen.' },
        ] },
    ],
    expire: { lock: 5, text: 'Keine Reaktion, keine Frist eingehalten. Fünf Tage geschlossen.' },
  },
  {
    id: 'griff_in_die_kasse', emoji: '🕵️', title: 'Griff in die Kasse',
    minGroesse: 1, minNpc: 1,
    text: 'Die Abrechnung stimmt seit Tagen nicht, und die Kamera zeigt, wer es war.',
    options: [
      { id: 'anzeigen', label: 'Anzeigen', emoji: '⚖️',
        outcomes: [
          { weight: 6, quit: 1, text: 'Anzeige, Kündigung, Ende. Die anderen haben verstanden.' },
          { weight: 4, quit: 1, kasse: -0.5, text: 'Anzeige und Kündigung – und ein Anwalt, der auch bezahlt werden will.' },
        ] },
      { id: 'gespraech', label: 'Unter vier Augen', emoji: '🤫',
        outcomes: [
          { weight: 7, staffRank: 1, kasse: -0.3,
            text: 'Ein ehrliches Gespräch. Der Fehlbetrag bleibt, aber die Person wird dein zuverlässigster Mensch.' },
          { weight: 3, kasse: -1, quit: 1, text: 'Zweite Chance, zweiter Griff. Diesmal ist die Kasse leer und die Person weg.' },
        ] },
    ],
    expire: { kasse: -2, text: 'Du hast nicht hingeschaut. Es hat sich rumgesprochen, dass niemand hinschaut.' },
  },
  {
    id: 'streik', emoji: '✊', title: 'Die Belegschaft will mehr',
    minGroesse: 3, minNpc: 3,
    text: 'Deine Leute stehen vor der Tür statt dahinter. Sie wollen mehr Lohn – ab sofort.',
    options: [
      { id: 'nachgeben', label: 'Nachgeben', emoji: '🤝',
        outcomes: [
          { weight: 10, wages: 1.3, days: 7, text: 'Eine Woche 30 % mehr Lohn. Der Laden läuft weiter.' },
        ] },
      { id: 'aussitzen', label: 'Aussitzen', emoji: '🪨',
        outcomes: [
          { weight: 5, lock: 2, text: 'Zwei Tage steht alles. Dann kommen sie zurück – zu den alten Bedingungen.' },
          { weight: 5, quit: 2, text: 'Zwei von ihnen kommen nicht zurück.' },
        ] },
    ],
    expire: { lock: 3, quit: 1, text: 'Drei Tage Stillstand, und einer hat in der Zeit was Neues gefunden.' },
  },
  {
    id: 'wasserschaden', emoji: '💧', title: 'Rohrbruch über Nacht',
    minGroesse: 0,
    text: 'Zehn Zentimeter Wasser im Laden, und es kommt noch nach.',
    options: [
      { id: 'notdienst', label: 'Notdienst rufen', emoji: '🚨',
        outcomes: [
          { weight: 10, kasse: -1.5, text: 'Teuer, aber um zehn Uhr ist der Boden trocken.' },
        ] },
      { id: 'versicherung', label: 'Über die Versicherung', emoji: '📄',
        outcomes: [
          { weight: 7, kasse: -1.5, lock: 2, refund: 1,
            text: 'Zwei Tage zu, dann zahlt die Versicherung den Großteil zurück.' },
          { weight: 3, kasse: -1.5, lock: 2,
            text: 'Zwei Tage zu – und die Versicherung findet eine Klausel.' },
        ] },
    ],
    expire: { lock: 4, kasse: -1, text: 'Das Wasser stand vier Tage. Der Schaden auch.' },
  },
  {
    id: 'uebernahme', emoji: '🏦', title: 'Ein Investor will den Laden',
    minGroesse: 3,
    text: 'Ein Angebot auf dem Tisch: alles, was du reingesteckt hast, plus die Kasse. Sofort.',
    options: [
      { id: 'verkaufen', label: 'Verkaufen', emoji: '💰',
        outcomes: [
          { weight: 10, sell: true, text: 'Unterschrift, Übergabe, Konto. Die Firma gehört jetzt jemand anderem.' },
        ] },
      { id: 'ablehnen', label: 'Ablehnen', emoji: '🚫',
        outcomes: [
          { weight: 6, text: 'Er zuckt mit den Schultern und geht.' },
          { weight: 4, auslastung: -0.2, text: 'Er eröffnet zwei Straßen weiter. Ein Teil deiner Kundschaft läuft rüber.' },
        ] },
    ],
    expire: { auslastung: -0.2, text: 'Keine Antwort ist auch eine. Er eröffnet nebenan.' },
  },
  {
    id: 'grossauftrag_risiko', emoji: '🎲', title: 'Alles auf einmal',
    minGroesse: 2,
    text: 'Ein Kunde will eine Großbestellung – du musst in Vorkasse gehen, er zahlt bei Lieferung. Sagt er.',
    options: [
      { id: 'annehmen', label: 'Annehmen', emoji: '✅',
        outcomes: [
          { weight: 65, kasse: -1, umsatz: 1.15, days: 5, text: 'Er zahlt. Fünf Tage läuft der Laden auf Anschlag.' },
          { weight: 35, kasse: -1, text: 'Er zahlt nicht. Die Ware ist weg, das Geld auch.' },
        ] },
      { id: 'ablehnen', label: 'Ablehnen', emoji: '🚫',
        outcomes: [
          { weight: 10, text: 'Du bleibst beim Tagesgeschäft.' },
        ] },
    ],
    expire: { text: 'Der Kunde hat sich anderswo bedient.' },
  },
];

module.exports = { COMPANY_DECISIONS };
```

- [ ] **Step 4: Test laufen lassen – muss bestehen**

Run: `rm -rf .testdata && DATA_DIR=.testdata node test/companyEvents.test.js`
Expected: `… bestanden, 0 fehlgeschlagen`

- [ ] **Step 5: `package.json` und Commit**

`"test"`: nach `node test/company.test.js` → ` && node test/companyEvents.test.js`.

```bash
git add src/data/companyEvents.js src/data/companyDecisions.js src/data/companies.js test/companyEvents.test.js package.json
git commit -m "firmen: kataloge fuer leichte ereignisse und vorfaelle, EVENT_UMSATZ_MAX

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 2: Zustand, `applyEffect`, Abrechnung mit Ereignissen, Sperre

**Files:**
- Modify: `src/db.js` (Tabelle `companies`: Spalten + Migration, `saveCompany`), `src/company.js` (`groesse`, `riskPerDay`, `riskFor`, `severityFor`, `investedOf`, `applyEffect`, `settle`, `workShift`, `pitchIn`, `advertise`, `status`, Exporte), `src/jobs.js` (`locked` durchreichen)
- Modify: `test/company.test.js` (§3-Block: fester Würfel, `× EVENT_UMSATZ_MAX`), `test/companyEvents.test.js` (Block „Abrechnung mit Ereignissen")

**Interfaces:**
- Consumes: `companyEvents.candidates(klasse)`, `data.EVENT_UMSATZ_MAX`.
- Produces (alle in `src/company.js`, exportiert):
  - `groesse(c, extraIds)` → `c.stufe + extraIds.length`; `riskPerDay(g)`, `riskFor(g, days)`, `severityFor(g)` wie in den Global Constraints.
  - `investedOf(b, c, extraIds)` → Summe der Preise gekaufter Stufen (`b.stufen[i].price` für `i < c.stufe`) und Extras.
  - `applyEffect(c, staff, effect, ctx)` mit `ctx = { b, extraIds, at, today = false, haerte = 1, random = Math.random }` → schreibt **nichts** in die DB, sondern mutiert und liefert `{ company, staff, done, quit }`: `company` ist die fortgeschriebene Firmenzeile, `staff` die verbleibende Belegschaft (gekündigte entfernt, Ränge geändert), `done = { kasse, refund, auslastung, quit: [names], lock, umsatz, days, wages, werbung, staffRank: {name, rank}|null, sell }` (Taler bzw. Punkte, wie angewandt), `quit` die gelöschten Staff-Zeilen (der Aufrufer löscht sie in der DB).
  - `settle(companyId, now, random = Math.random)` → wie bisher plus `out.news: [{ at, text }]` (neue Chronik-Zeilen dieses Laufs) und `out.incident` (in Task 3).
  - `workShift/pitchIn/advertise` → `{ ok:false, reason:'locked', remainingMs }` bei `now < closed_until`.
  - `status()` zusätzlich `news` (Array aus `c.news`), `closedMs = max(0, closed_until − now)`, `groesse`, `invested`, `umsatzBoost = { factor, until } | null`, `wageFactor = { factor, until } | null`.
  - `jobs.work` reicht `locked` mit `remainingMs` durch.
- Spalten: `news TEXT NOT NULL DEFAULT '[]'`, `closed_until INTEGER NOT NULL DEFAULT 0`, `umsatz_boost REAL NOT NULL DEFAULT 1`, `umsatz_boost_until INTEGER NOT NULL DEFAULT 0`, `wage_factor REAL NOT NULL DEFAULT 1`, `wage_factor_until INTEGER NOT NULL DEFAULT 0`.

- [ ] **Step 1: Tests schreiben – Block in `test/companyEvents.test.js` vor der Schlusszeile**

```js
  console.log('--- Abrechnung mit Ereignissen (Kiosk Stufe 1, Decke 2.850) ---');
  {
    const db = require('../src/db');
    const company = require('../src/company');
    const G = `FEV_T${Date.now()}`;
    const U = 'u1';
    konten.set(U, 1_000_000);
    const t0 = new Date(new Date().setHours(6, 0, 0, 0)).getTime() + DAY_MS;
    const seq = (...v) => { let i = 0; return () => (i < v.length ? v[i++] : 0.5); };
    // Würfel: erster Aufruf wählt das leichte Ereignis (Anteil an der Gewichtssumme),
    // zweiter den Vorfall (0,99 = keiner). candidates('klein') hat 185 Gewicht:
    // none 0…140, dann die neun Einträge je 5 in Katalogreihenfolge.
    const pos = (id) => {
      let acc = 0;
      for (const c of events.candidates('klein')) { if (c.event.id === id) return (acc + 2.5) / 185; acc += c.weight; }
      throw new Error(id);
    };
    const wurf = (id) => seq(pos(id), 0.99);

    let r = await company.found(G, U, 'kiosk', 'Eckladen', t0);
    check('Kiosk gegründet', r.ok, JSON.stringify(r));
    const cid = r.company.id;
    company.hireNpc(G, U, t0, seq(0.1)); company.hireNpc(G, U, t0, seq(0.2));
    for (const s of db.companyStaff(cid)) db.saveStaff({ ...s, rank: 2 });    // Schichtleiter
    await company.deposit(G, U, 100_000, t0);
    const b = company.branch('kiosk');
    const decke = company.ceilingOf(b).net;
    check('Decke Kiosk 2.850', decke === 2_850);
    check('groesse 0, riskPerDay 2 %, severity 1', company.groesse(db.getCompany(cid), []) === 0
      && near(company.riskPerDay(0), 0.02) && company.severityFor(0) === 1);
    check('groesse 9: riskPerDay 8 %, severity 1,6, riskFor(9, 30) = 1 − 0,92^30',
      near(company.riskPerDay(9), 0.08) && near(company.severityFor(9), 1.6) && near(company.riskFor(9, 30), 1 - 0.92 ** 30));

    // Referenztag ohne Ereignis: 2 NPC × 3 Schichten × (250 × 1,5 × a − 100 × 1,5).
    const a0 = db.getCompany(cid).auslastung;
    const ziel = company.dailyTarget(b, 2, false, 2);           // 0,3 + 0,5 = 0,8
    const a1 = a0 + (ziel - a0) * 0.2;                           // 0,4
    const tagesUmsatz = (a) => 2 * 3 * Math.round(250 * 1.5 * a);
    const tagesLohn = 2 * 3 * 150;
    let vor = db.getCompany(cid).kasse;
    let s = company.settle(cid, t0 + DAY_MS, wurf('none'));
    check('ohne Ereignis: Kasse + Umsatz − Löhne, keine Chronik',
      db.getCompany(cid).kasse - vor === tagesUmsatz(a1) - tagesLohn && s.news.length === 0,
      `${db.getCompany(cid).kasse - vor} vs ${tagesUmsatz(a1) - tagesLohn}`);

    // kuehlung: −0,5 × Decke = −1.425, nicht verstärkt.
    let a = db.getCompany(cid).auslastung; a = a + (ziel - a) * 0.2;
    vor = db.getCompany(cid).kasse;
    s = company.settle(cid, t0 + 2 * DAY_MS, wurf('kuehlung'));
    check('kuehlung: −1.425 zusätzlich, Chronik-Zeile',
      db.getCompany(cid).kasse - vor === tagesUmsatz(a) - tagesLohn - 1_425 && s.news.length === 1 && s.news[0].text.startsWith('🧊'),
      `${db.getCompany(cid).kasse - vor} vs ${tagesUmsatz(a) - tagesLohn - 1_425}`);
    check('Chronik in der Firma gespeichert', JSON.parse(db.getCompany(cid).news).length === 1);

    // lieferant: Umsatz × 0,7 an diesem Tag, morgen wieder 1,0.
    a = db.getCompany(cid).auslastung; a = a + (ziel - a) * 0.2;
    vor = db.getCompany(cid).kasse;
    company.settle(cid, t0 + 3 * DAY_MS, wurf('lieferant'));
    check('lieferant: Umsatz × 0,7', db.getCompany(cid).kasse - vor === 2 * 3 * Math.round(250 * 1.5 * a * 0.7) - tagesLohn,
      `${db.getCompany(cid).kasse - vor}`);
    a = db.getCompany(cid).auslastung; a = a + (ziel - a) * 0.2;
    vor = db.getCompany(cid).kasse;
    company.settle(cid, t0 + 4 * DAY_MS, wurf('none'));
    check('… am nächsten Tag wieder 1,0', db.getCompany(cid).kasse - vor === tagesUmsatz(a) - tagesLohn);

    // guter_tag: Löhne halbiert.
    a = db.getCompany(cid).auslastung; a = a + (ziel - a) * 0.2;
    vor = db.getCompany(cid).kasse;
    company.settle(cid, t0 + 5 * DAY_MS, wurf('guter_tag'));
    check('guter_tag: Löhne × 0,5', db.getCompany(cid).kasse - vor === tagesUmsatz(a) - 2 * 3 * Math.round(150 * 0.5));

    // lokalpresse / bewertung: Auslastung ±0,1 (nach der Tagesbewegung, gedeckelt).
    a = db.getCompany(cid).auslastung; a = a + (ziel - a) * 0.2;
    company.settle(cid, t0 + 6 * DAY_MS, wurf('lokalpresse'));
    check('lokalpresse: +0,1 Auslastung', near(db.getCompany(cid).auslastung, a + 0.1, 1e-9));
    a = db.getCompany(cid).auslastung; a = a + (ziel - a) * 0.2;
    company.settle(cid, t0 + 7 * DAY_MS, wurf('bewertung'));
    check('bewertung: −0,1 Auslastung', near(db.getCompany(cid).auslastung, a - 0.1, 1e-9));

    // empfehlung: ein Werbetag.
    company.settle(cid, t0 + 8 * DAY_MS, wurf('empfehlung'));
    check('empfehlung: werbung_until = Tag + 1', db.getCompany(cid).werbung_until === t0 + 9 * DAY_MS, String(db.getCompany(cid).werbung_until - t0));

    // Ein Boost stapelt nicht: stammkunde (1,10) auf laufenden Boost 1,15 → max, nicht Produkt.
    const c0 = db.getCompany(cid);
    db.saveCompany({ ...c0, umsatz_boost: 1.15, umsatz_boost_until: t0 + 12 * DAY_MS });
    company.settle(cid, t0 + 9 * DAY_MS, wurf('stammkunde'));
    check('Boosts stapeln nicht (max 1,15, längeres until bleibt)',
      db.getCompany(cid).umsatz_boost === 1.15 && db.getCompany(cid).umsatz_boost_until === t0 + 12 * DAY_MS);
    // Ein Malus ersetzt den Boost.
    company.settle(cid, t0 + 10 * DAY_MS, wurf('krank'));
    check('krank ersetzt den laufenden Boost (0,8 für heute)',
      db.getCompany(cid).umsatz_boost === 0.8 && db.getCompany(cid).umsatz_boost_until === t0 + 10 * DAY_MS);

    // Sperre (nur aus Vorfällen): applyEffect direkt, dann drei Abrechnungstage ohne Umsatz.
    const now = t0 + 11 * DAY_MS;
    company.settle(cid, now, wurf('none'));
    const c1 = db.getCompany(cid);
    const staff1 = db.companyStaff(cid);
    const eff = company.applyEffect(c1, staff1, { lock: 3 }, { b, extraIds: [], at: now, haerte: 1 });
    db.saveCompany(eff.company);
    check('lock 3: closed_until = now + 3 Tage', eff.company.closed_until === now + 3 * DAY_MS && eff.done.lock === 3);
    r = await company.pitchIn(G, U, now + 60_000);
    check('Anpacken gesperrt: locked mit remainingMs', r.ok === false && r.reason === 'locked' && r.remainingMs > 0, JSON.stringify(r));
    r = await company.advertise(G, U, now + 60_000);
    check('Werbung gesperrt', r.ok === false && r.reason === 'locked');
    vor = db.getCompany(cid).kasse;
    s = company.settle(cid, now + 3 * DAY_MS, () => 0.5);
    check('drei geschlossene Tage: nur Löhne', s.days === 3 && s.umsatz === 0 && db.getCompany(cid).kasse - vor === -3 * tagesLohn,
      `${db.getCompany(cid).kasse - vor}`);
    vor = db.getCompany(cid).kasse;
    s = company.settle(cid, now + 4 * DAY_MS, () => 0.5);
    check('vierter Tag: wieder Umsatz', s.umsatz > 0 && db.getCompany(cid).kasse - vor > -tagesLohn);
    r = await company.pitchIn(G, U, now + 4 * DAY_MS);
    check('Anpacken geht wieder', r.ok, JSON.stringify(r));

    // Härte: kasse −1 bei groesse 9 und Schweigen = −1 × 1,6 × 1,6 × Decke.
    const c2 = db.getCompany(cid);
    const e2 = company.applyEffect(c2, db.companyStaff(cid), { kasse: -1, refund: 1 }, { b, extraIds: [], at: now, haerte: 1.6 * 1.6 });
    check('kasse −1 mit Härte 2,56: −7.296, refund 1 = +2.850 (nie mehr als der Abzug)',
      e2.done.kasse === -Math.round(2.56 * decke) && e2.done.refund === decke && e2.company.kasse === c2.kasse - Math.round(2.56 * decke) + decke,
      JSON.stringify(e2.done));
    const e3 = company.applyEffect(c2, db.companyStaff(cid), { kasse: -0.3, refund: 1 }, { b, extraIds: [], at: now, haerte: 1 });
    check('refund gedeckelt auf den Abzug', e3.done.refund === Math.round(0.3 * decke));

    // quit: dienstältester zuerst; staffRank ±1 gedeckelt.
    const staffQ = db.companyStaff(cid);
    db.saveStaff({ ...staffQ[0], shifts: 99 });
    const e4 = company.applyEffect(db.getCompany(cid), db.companyStaff(cid), { quit: 1 }, { b, extraIds: [], at: now, haerte: 1 });
    check('quit 1: der mit den meisten Schichten geht', e4.quit.length === 1 && e4.quit[0].id === staffQ[0].id && e4.staff.length === 1
      && e4.done.quit[0] === staffQ[0].name);
    const e5 = company.applyEffect(db.getCompany(cid), db.companyStaff(cid), { staffRank: 1 }, { b, extraIds: [], at: now, haerte: 1, random: () => 0 });
    check('staffRank +1 auf Schichtleiter bleibt Schichtleiter (gedeckelt)', e5.done.staffRank === null || e5.staff.every((x) => x.rank <= 2));

    // investedOf
    check('investedOf ohne Ausbau = 0', company.investedOf(b, db.getCompany(cid), []) === 0);
    check('investedOf Stufe 2 + ein Extra', company.investedOf(b, { ...db.getCompany(cid), stufe: 2 }, [b.extras[0].id])
      === b.stufen[0].price + b.stufen[1].price + b.extras[0].price);

    // jobs.work reicht locked durch.
    const jobs = require('../src/jobs');
    const P = 'p1';
    const c3 = db.getCompany(cid);
    db.saveCompany({ ...c3, closed_until: now + 10 * DAY_MS });
    const j = await company.join(G, P, cid, now + 5 * DAY_MS);
    check('Spieler eingestellt', j.ok, JSON.stringify(j));
    const w = await jobs.work(G, P, new Date(now + 5 * DAY_MS));
    check('Schicht in geschlossener Firma: locked mit remainingMs', w.ok === false && w.reason === 'locked' && w.remainingMs > 0, JSON.stringify(w));
    db.saveCompany({ ...db.getCompany(cid), closed_until: 0 });

    const st = company.status(G, U, now + 5 * DAY_MS);
    check('status: news, closedMs 0, groesse, invested', Array.isArray(st.news) && st.closedMs === 0 && st.groesse === 0 && st.invested === 0);
    await company.close(G, U, now + 5 * DAY_MS);
  }
```

- [ ] **Step 2: Test laufen lassen – muss fehlschlagen**

Run: `rm -rf .testdata && DATA_DIR=.testdata node test/companyEvents.test.js`
Expected: ❌ ab „groesse 0 …" (`company.groesse is not a function`).

- [ ] **Step 3: `src/db.js` – Spalten, Migration, `saveCompany`**

In `CREATE TABLE IF NOT EXISTS companies` nach `closed_why`:

```sql
    news               TEXT    NOT NULL DEFAULT '[]',
    closed_until       INTEGER NOT NULL DEFAULT 0,
    umsatz_boost       REAL    NOT NULL DEFAULT 1,
    umsatz_boost_until INTEGER NOT NULL DEFAULT 0,
    wage_factor        REAL    NOT NULL DEFAULT 1,
    wage_factor_until  INTEGER NOT NULL DEFAULT 0
```

Migration nach dem `stufe`-Block:

```js
// Ereignisse (Stück 2b): Chronik, Schließung und mehrtägige Faktoren hängen an der Firma.
{
  const have = new Set(db.prepare('PRAGMA table_info(companies)').all().map((c) => c.name));
  for (const [column, definition] of [
    ['news', "TEXT NOT NULL DEFAULT '[]'"],
    ['closed_until', 'INTEGER NOT NULL DEFAULT 0'],
    ['umsatz_boost', 'REAL NOT NULL DEFAULT 1'],
    ['umsatz_boost_until', 'INTEGER NOT NULL DEFAULT 0'],
    ['wage_factor', 'REAL NOT NULL DEFAULT 1'],
    ['wage_factor_until', 'INTEGER NOT NULL DEFAULT 0'],
  ]) {
    if (!have.has(column)) db.exec(`ALTER TABLE companies ADD COLUMN ${column} ${definition}`);
  }
}
```

`saveCompany`-Statement um `news = ?, closed_until = ?, umsatz_boost = ?, umsatz_boost_until = ?, wage_factor = ?, wage_factor_until = ?` erweitern (vor `WHERE id = ?`), und die Funktion:

```js
function saveCompany(c) {
  stmt.saveCompany.run(
    c.name, Math.round(c.kasse), c.auslastung, c.paid_through, c.negative_since ?? 0,
    c.werbung_until ?? 0, c.pitch_day ?? '', c.pitch_today ?? 0, c.status ?? 'open',
    c.closed_at ?? 0, c.closed_why ?? '',
    typeof c.news === 'string' ? c.news : JSON.stringify(c.news ?? []),
    c.closed_until ?? 0, c.umsatz_boost ?? 1, c.umsatz_boost_until ?? 0,
    c.wage_factor ?? 1, c.wage_factor_until ?? 0,
    Number(c.id));
}
```

- [ ] **Step 4: `src/company.js` – Größe, Härte, `investedOf`, `applyEffect`**

Nach `dailyTarget`:

```js
// ------------------------------------------------------------- Ereignisse

const NEWS_MAX = 5;

/** Firmengröße: Ausbaustufe plus gekaufte Extras (0 … 9). Treibt Häufigkeit und Härte. */
function groesse(c, extraIds) {
  return (c.stufe ?? 0) + extraIds.length;
}
/** Tageswahrscheinlichkeit eines Vorfalls: 2 % (Größe 0) … 8 % (Größe 9). */
function riskPerDay(g) {
  return 0.02 + (g / 9) * 0.06;
}
/** Wahrscheinlichkeit, dass in `days` Tagen mindestens ein Vorfall passiert. */
function riskFor(g, days) {
  return 1 - Math.pow(1 - riskPerDay(g), Math.max(0, days));
}
/** Verstärkung der Verluste: 1 (Größe 0) … 1,6 (Größe 9). */
function severityFor(g) {
  return 1 + (g / 9) * 0.6;
}
/** Was in Stufen und Extras steckt – so rechnet auch der Schließen-Dialog. */
function investedOf(b, c, extraIds) {
  return b.stufen.slice(0, c.stufe ?? 0).reduce((s, st) => s + st.price, 0)
    + extraIds.reduce((s, id) => s + (data.extraById(id)?.price ?? 0), 0);
}

/**
 * Wendet eine Wirkung (leichtes Ereignis oder Vorfall-Ausgang) auf eine Firma
 * an – rein, ohne DB: liefert die fortgeschriebene Firmenzeile, die
 * verbleibende Belegschaft, die gekündigten Zeilen und `done` mit den
 * angewandten Zahlen. Verluste (kasse < 0, auslastung < 0, quit, lock,
 * werbung < 0) werden mit `haerte` verstärkt, Gewinne nie; `refund` gibt nie
 * mehr zurück, als dieselbe Wirkung abgezogen hat.
 *
 * `today`: der Tag `at` zählt schon als erster Tag (Abrechnung); bei
 * Vorfällen (Echtzeit) beginnen die `days` mit dem nächsten Abrechnungstag.
 */
function applyEffect(c, staff, effect, { b, extraIds, at, today = false, haerte = 1, random = Math.random }) {
  const decke = ceilingOf(b, c.stufe ?? 0, extraIds).net;
  const days = effect.days ?? 1;
  const until = at + (days - (today ? 1 : 0)) * DAY_MS;
  const next = { ...c };
  let rest = [...staff];
  const quit = [];
  const done = { kasse: 0, refund: 0, auslastung: 0, quit: [], lock: 0, umsatz: null, days: 0,
    wages: null, werbung: 0, staffRank: null, sell: !!effect.sell };

  if (effect.kasse) {
    done.kasse = -Math.round(Math.abs(effect.kasse) * decke * haerte);
    next.kasse += done.kasse;
  }
  if (effect.refund && done.kasse < 0) {
    done.refund = Math.min(Math.round(effect.refund * decke), -done.kasse);
    next.kasse += done.refund;
  }
  if (effect.auslastung) {
    const delta = effect.auslastung < 0 ? effect.auslastung * haerte : effect.auslastung;
    const a = Math.max(0, Math.min(1, next.auslastung + delta));
    done.auslastung = a - next.auslastung;
    next.auslastung = a;
  }
  if (effect.umsatz) {
    // Boosts stapeln nicht (§3): zwei gute Nachrichten sind das Maximum beider,
    // nie das Produkt. Ein Malus ersetzt, was gerade läuft.
    const laeuft = next.umsatz_boost_until >= at ? next.umsatz_boost : 1;
    if (effect.umsatz >= 1 && laeuft >= 1) {
      next.umsatz_boost = Math.min(data.EVENT_UMSATZ_MAX, Math.max(laeuft, effect.umsatz));
      next.umsatz_boost_until = Math.max(next.umsatz_boost_until, until);
    } else {
      next.umsatz_boost = Math.min(data.EVENT_UMSATZ_MAX, effect.umsatz);
      next.umsatz_boost_until = until;
    }
    done.umsatz = next.umsatz_boost; done.days = days;
  }
  if (effect.wages !== undefined) {
    next.wage_factor = effect.wages; next.wage_factor_until = until;
    done.wages = effect.wages; done.days = days;
  }
  if (effect.werbung) {
    const w = effect.werbung < 0 ? Math.round(effect.werbung * haerte) : effect.werbung;
    next.werbung_until = w > 0
      ? Math.max(next.werbung_until, at) + w * DAY_MS
      : Math.max(0, next.werbung_until + w * DAY_MS);
    done.werbung = w;
  }
  if (effect.lock) {
    done.lock = Math.min(5, Math.round(effect.lock * haerte));
    next.closed_until = Math.max(next.closed_until ?? 0, at) + done.lock * DAY_MS;
  }
  if (effect.quit) {
    const n = Math.min(rest.filter((s) => s.kind === 'npc').length, Math.round(effect.quit * haerte));
    const npcs = rest.filter((s) => s.kind === 'npc').sort((x, y) => y.shifts - x.shifts);
    for (const s of npcs.slice(0, n)) { quit.push(s); done.quit.push(s.name); }
    rest = rest.filter((s) => !quit.includes(s));
  }
  if (effect.staffRank) {
    const npcs = rest.filter((s) => s.kind === 'npc');
    if (npcs.length) {
      const s = npcs[Math.min(npcs.length - 1, Math.floor(random() * npcs.length))];
      const rank = Math.max(0, Math.min(data.RANKS.length - 1, s.rank + effect.staffRank));
      if (rank !== s.rank) { s.rank = rank; done.staffRank = { name: s.name, rank }; }
    }
  }
  return { company: next, staff: rest, quit, done };
}

/** Eine Zeile in die Chronik (neueste zuerst, höchstens NEWS_MAX). */
function pushNews(c, at, text) {
  const list = typeof c.news === 'string' ? JSON.parse(c.news || '[]') : (c.news ?? []);
  return [{ at, text }, ...list].slice(0, NEWS_MAX);
}

/** Würfelt ein leichtes Ereignis für einen Abrechnungstag. */
function rollLightEvent(klasse, random = Math.random) {
  const list = require('./data/companyEvents').candidates(klasse);
  const total = list.reduce((s, c) => s + c.weight, 0);
  let roll = random() * total;
  for (const c of list) {
    if (roll < c.weight) return c.event;
    roll -= c.weight;
  }
  return require('./data/companyEvents').NO_EVENT;
}
```

- [ ] **Step 5: `src/company.js` – `settle` umbauen**

Signatur `function settle(companyId, now = Date.now(), random = Math.random)`. `out` bekommt `news: [], incident: null`. `extraIds` einmal holen (`const extraIds = db.companyExtras(c.id);` neben `eff`). Die Tagesschleife:

```js
  let cur = { ...c };                         // die fortgeschriebene Firmenzeile
  for (let d = 0; d < days; d++) {
    tag += DAY_MS;

    // 1. Auslastung bewegt sich aufs Ziel zu (Werbung zählt am Ablauftag noch mit, >=).
    const ziel = dailyTarget(b, staff.length, cur.werbung_until >= tag, eff.slots);
    cur.auslastung += (ziel - cur.auslastung) * data.AUSLASTUNG_STEP;

    // 2. Ein leichtes Ereignis – nicht verstärkt, wirkt ab heute.
    const ev = rollLightEvent(b.klasse, random);
    if (ev.text) {
      const r = applyEffect(cur, staff, ev, { b, extraIds, at: tag, today: true, haerte: 1, random });
      cur = r.company; staff = r.staff;
      for (const s of r.quit) { db.deleteStaff(s.id); out.quit.push(s.name); }
      const text = ev.flavor?.[b.id] ?? ev.text;
      cur.news = pushNews(cur, tag, text);
      out.news.push({ at: tag, text });
    }

    // 3. Faktoren des Tages und Schließung.
    const fUmsatz = cur.umsatz_boost_until >= tag ? cur.umsatz_boost : 1;
    const fLohn = cur.wage_factor_until >= tag ? cur.wage_factor : 1;
    const zu = tag <= (cur.closed_until ?? 0);

    // 4. NPC-Schichten – Löhne sind Verbindlichkeiten, auch bei geschlossenem Betrieb.
    for (const s of staff) {
      if (s.kind !== 'npc') continue;
      const f = rankOf(s.rank).factor;
      const lohn = Math.round(b.lohn * f * fLohn);
      const umsatz = zu ? 0 : Math.round(b.umsatz * f * cur.auslastung * eff.umsatzFactor * fUmsatz);
      cur.kasse += data.NPC_SHIFTS * (umsatz - lohn);
      out.umsatz += data.NPC_SHIFTS * umsatz;
      out.loehne += data.NPC_SHIFTS * lohn;
      if (!zu) s.shifts += data.NPC_SHIFTS;
    }
    // … Punkt „Unbezahlt"/Kündigungen unverändert, aber mit `cur.kasse` statt `kasse` …
    // … Minus-Uhr unverändert mit `cur.kasse`/`cur.negative_since`; beim Insolvenzfall
    //     `db.saveCompany({ ...cur, paid_through: tag })` …
  }

  for (const s of staff) db.saveStaff(s);
  db.saveCompany({ ...cur, paid_through: tag });
  out.auslastung = cur.auslastung; out.kasse = cur.kasse;
  return out;
```

(Die lokalen `kasse`, `auslastung`, `negative_since` werden durch `cur.*` ersetzt; `out.auslastung/kasse` beim Insolvenz-Return ebenfalls aus `cur`.) Der Vorfallswurf nach der Schleife kommt in Task 3.

- [ ] **Step 6: Sperre, Status, Exporte, jobs**

`workShift` (nach `if (!s) …`), `pitchIn` und `advertise` (nach dem `ctx`-Check, vor Zeit/Kasse):

```js
  if (now < (c.closed_until ?? 0)) return { ok: false, reason: 'locked', remainingMs: c.closed_until - now };
```

`status()` ergänzen:

```js
    news: typeof c.news === 'string' ? JSON.parse(c.news || '[]') : (c.news ?? []),
    closedMs: Math.max(0, (c.closed_until ?? 0) - now),
    groesse: groesse(c, extraIds), invested: investedOf(b, c, extraIds),
    umsatzBoost: c.umsatz_boost_until >= now ? { factor: c.umsatz_boost, until: c.umsatz_boost_until } : null,
    wageFactor: c.wage_factor_until >= now ? { factor: c.wage_factor, until: c.wage_factor_until } : null,
```

Exporte: `groesse, riskPerDay, riskFor, severityFor, investedOf, applyEffect, pushNews, rollLightEvent, NEWS_MAX`.

`src/jobs.js` Firmenzweig: `return { ok: false, reason: shift.reason, job, lohn: shift.lohn, kasse: shift.kasse, remainingMs: shift.remainingMs };`

`src/buttons.js` Schließen-Dialog (`~2057`): `investiert` aus `s.invested` statt der Summenrechnung.

- [ ] **Step 7: `test/company.test.js` §3-Block anpassen**

Zeile `company.settle(f.company.id, now + DAY_MS);` → `company.settle(f.company.id, now + DAY_MS, () => 0.5);` (0,5 × 200 = 100 < 140 → `none`; zweiter Wurf 0,5 ≥ 8 % → kein Vorfall). Der Check bleibt `best <= decke` (ohne Ereignisse gilt die alte Decke). Neuer Block direkt danach:

```js
  console.log('--- §3: mit Ereignissen kein Tag über der Ereignis-Decke ---');
  {
    const rng = (seed) => { let a = seed >>> 0; return () => { a = (a + 0x6d2b79f5) >>> 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; };
    for (const id of ['kiosk', 'cafe', 'spedition']) {
      const b = company.branch(id);
      const U = user(); funds(U, 0, 50_000_000);
      const f = await company.found(G, U, b.id, `Ev-${b.id}`, t0);
      const rand = rng(7);
      // Ereignis-Decke ist eine UMSATZ-Decke (Spec §3): NPC-Schichten je Tag höchstens
      // slots × 3 × round(umsatz × 1,5) × 1,15. Lohnnachlässe heben den Nettogewinn – kein Umsatz.
      const decke = b.slots * data.NPC_SHIFTS * Math.round(b.umsatz * 1.5) * data.EVENT_UMSATZ_MAX;
      let best = -Infinity, ereignisse = 0;
      let now = t0;
      for (let d = 0; d < 365; d++) {
        while (db.companyStaff(f.company.id).length < b.slots) company.hireNpc(G, U, now, rand);
        for (const s of db.companyStaff(f.company.id)) if (s.rank < 2) db.saveStaff({ ...s, rank: 2 });
        const vor = db.getCompany(f.company.id).kasse;
        await company.advertise(G, U, now);
        for (let i = 0; i < data.MAX_PITCH_PER_DAY; i++) await company.pitchIn(G, U, now + i * 60e3);
        const s = company.settle(f.company.id, now + DAY_MS, rand);
        ereignisse += s.news.length;
        // Ein Vorfall soll hier nicht entscheiden – er wird sofort verworfen (Task 3 testet ihn).
        const open = db.openEvent(G, U);
        if (open) db.resolveEvent(G, open.id, { status: 'done', choice: '', outcome: '', effect: '', at: now + DAY_MS });
        best = Math.max(best, s.umsatz);            // Umsatz der NPC-Schichten dieses Tages
        void vor;
        now += DAY_MS;
      }
      check(`${b.name}: mit Ereignissen kein Tag über der Umsatz-Decke × 1,15 (${ereignisse} Ereignisse)`, best <= decke + 0.5 * b.slots * data.NPC_SHIFTS, `${de(best)} > ${de(decke)}`);
      check(`${b.name}: Ereignisse sind passiert (≈ 30 % der Tage)`, ereignisse > 60 && ereignisse < 160, String(ereignisse));
    }
  }
```

`out.news[]` trägt zusätzlich `kasse` (die angewandten Taler aus `done.kasse + done.refund`) – in Step 5 `out.news.push({ at: tag, text, kasse: r.done.kasse + r.done.refund })`; die Messung (Task 5) nutzt das. `db.resolveEvent(guildId, id, { status, choice, outcome, effect, at })` existiert (siehe `decisions.choose`). Die Zeile `const vor = …` im neuen Block kann entfallen, wenn sie ungenutzt bleibt.

- [ ] **Step 8: Tests laufen lassen**

Run: `rm -rf .testdata && DATA_DIR=.testdata node test/companyEvents.test.js && DATA_DIR=.testdata node test/company.test.js && DATA_DIR=.testdata node test/db.test.js && DATA_DIR=.testdata node test/energy.test.js && DATA_DIR=.testdata node test/shifts.test.js`
Expected: alle `0 fehlgeschlagen`. Wenn im Handrechnungs-Block ein Wert um ±1 abweicht, zuerst die Rundungsreihenfolge im Code gegen den Test prüfen (`Math.round(b.umsatz × f × a × umsatzFactor × fUmsatz)` – ein Rundungsschritt je Schicht) – nicht den Test „passend" machen.

- [ ] **Step 9: Commit**

```bash
git add src/db.js src/company.js src/jobs.js src/buttons.js test/company.test.js test/companyEvents.test.js
git commit -m "firmen: chronik, applyEffect, leichte ereignisse in der abrechnung, betriebsschliessung

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 3: Vorfälle – Domäne `company` im Entscheidungs-System

**Files:**
- Modify: `src/decisions.js` (`roll` Domäne `company`, `applyCompany`, `apply`-Verzweigung, Katalog in `byId`, Exporte), `src/company.js` (`sell`, Vorfallswurf am Ende von `settle`)
- Test: `test/companyEvents.test.js` (Block „Vorfälle")

**Interfaces:**
- Consumes: `company.groesse/riskFor/severityFor/applyEffect/investedOf/closeCompany/ownCompany`, `COMPANY_DECISIONS`.
- Produces:
  - `decisions.roll(guildId, userId, size, now, random, 'company')` mit `size = { groesse, days, npc }` → Zeile in `creator_events` mit `platform:'company'`, oder `null`.
  - `decisions.applyCompany(guildId, userId, row, effect, now, ignored, random)` → `done` aus `applyEffect` plus `{ gone: boolean, sold: { payout, paid } | null, text }`.
  - `company.sell(guildId, ownerId, now)` → `{ ok, company, payout, paid, balance }` (wie `close`, Grund `'sold'`, Auszahlung `investedOf + kasse`, eine Buchung `{ xp:false, tax:false, kind:'company' }`, `paid:false` bei Buchungsfehler).
  - `settle(...)` → `out.incident` = neue Vorfallszeile oder `null`.

- [ ] **Step 1: Tests schreiben – Block in `test/companyEvents.test.js`**

```js
  console.log('--- Vorfälle (Domäne company) ---');
  {
    const db = require('../src/db');
    const company = require('../src/company');
    const decisions = require('../src/decisions');
    const G = `FDEC_T${Date.now()}`;
    const U = 'd1';
    konten.set(U, 100_000_000);
    const t0 = new Date(new Date().setHours(6, 0, 0, 0)).getTime() + DAY_MS;
    const seq = (...v) => { let i = 0; return () => (i < v.length ? v[i++] : 0.5); };
    const H = 60 * 60 * 1000;

    let r = await company.found(G, U, 'cafe', 'Kaffeeklatsch', t0);
    const cid = r.company.id;
    const b = company.branch('cafe');
    for (let i = 0; i < b.slots; i++) company.hireNpc(G, U, t0, seq(0.1 * i));
    await company.deposit(G, U, 1_000_000, t0);

    // roll: Größe 0, ein Tag → 2 %. Würfel 0,5 → nichts; 0,01 → Vorfall aus den zulässigen (minGroesse 0, npc ≥ 0).
    check('roll company: 0,5 → kein Vorfall', decisions.roll(G, U, { groesse: 0, days: 1, npc: 3 }, t0, seq(0.5, 0), 'company') === null);
    let row = decisions.roll(G, U, { groesse: 0, days: 1, npc: 3 }, t0, seq(0.01, 0), 'company');
    check('roll company: 0,01 → Vorfall mit platform company, erster zulässiger (gesundheitsamt)',
      row && row.platform === 'company' && row.kind === 'gesundheitsamt', JSON.stringify(row));
    check('pending sieht ihn', decisions.pending(G, U, t0)?.kind === 'gesundheitsamt');
    check('kein zweiter, solange einer offen ist', decisions.roll(G, U, { groesse: 9, days: 30, npc: 9 }, t0, seq(0.01, 0), 'company') === null);

    // Option „beheben": kasse −1 × Decke (Härte 1 bei Größe 0).
    const decke = company.ceilingOf(b).net;
    let vor = db.getCompany(cid).kasse;
    let res = await decisions.choose(G, U, row.id, 'beheben', t0 + H, seq(0.5));
    check('beheben: Kasse −1 × Decke, Chronik-Zeile mit Ausgangstext',
      res.ok && res.effect.kasse === -decke && db.getCompany(cid).kasse === vor - decke
      && JSON.parse(db.getCompany(cid).news)[0].text.includes('Handwerker'), JSON.stringify(res.effect));

    // Abwarten mit schlechtem Ausgang: lock 3 + auslastung −0,2 (Härte 1).
    db.clearEvents(G, U);
    row = decisions.roll(G, U, { groesse: 0, days: 1, npc: 3 }, t0 + 2 * DAY_MS, seq(0.01, 0), 'company');
    res = await decisions.choose(G, U, row.id, 'abwarten', t0 + 2 * DAY_MS + H, seq(0.9));
    check('abwarten (schlecht): 3 Tage zu, Auslastung −0,2',
      res.ok && res.effect.lock === 3 && near(res.effect.auslastung, -0.2, 1e-9)
      && db.getCompany(cid).closed_until === t0 + 2 * DAY_MS + H + 3 * DAY_MS, JSON.stringify(res.effect));
    db.saveCompany({ ...db.getCompany(cid), closed_until: 0 });

    // Schweigen: expire mit × 1,6 – gesundheitsamt expire lock 5 → 5 (gedeckelt 5).
    db.clearEvents(G, U);
    row = decisions.roll(G, U, { groesse: 0, days: 1, npc: 3 }, t0 + 4 * DAY_MS, seq(0.01, 0), 'company');
    const gone = await decisions.settle(G, U, t0 + 4 * DAY_MS + 25 * H);
    check('Schweigen: lock 5 (Deckel), Status expired', gone.length === 1 && gone[0].effect.lock === 5
      && db.getEvent(G, row.id).status === 'expired', JSON.stringify(gone[0]?.effect));
    db.saveCompany({ ...db.getCompany(cid), closed_until: 0 });

    // Größe 9 und Schweigen: kasse −2 (griff_in_die_kasse expire) × 1,6 × 1,6 = −5,12 × Decke.
    db.clearEvents(G, U);
    const c9 = db.getCompany(cid);
    db.saveCompany({ ...c9, stufe: 5 });
    for (const e of b.extras) db.addCompanyExtra(cid, e.id, t0);
    const decke9 = company.ceilingOf(b, 5, b.extras.map((e) => e.id)).net;
    // Kandidaten bei Größe 9 mit 3+ NPC: alle sechs; zweiter Wurf wählt den Index: 1/6 → griff_in_die_kasse.
    row = decisions.roll(G, U, { groesse: 9, days: 1, npc: db.companyStaff(cid).length }, t0 + 6 * DAY_MS, seq(0.01, 1.5 / 6), 'company');
    check('Größe 9: griff_in_die_kasse gewürfelt', row?.kind === 'griff_in_die_kasse', row?.kind);
    vor = db.getCompany(cid).kasse;
    const g2 = await decisions.settle(G, U, t0 + 6 * DAY_MS + 25 * H);
    check('Schweigen bei Größe 9: −2 × 1,6 × 1,6 × Decke', g2[0].effect.kasse === -Math.round(2 * 1.6 * 1.6 * decke9)
      && db.getCompany(cid).kasse === vor + g2[0].effect.kasse, JSON.stringify(g2[0]?.effect));

    // Übernahme: verkaufen → Firma sold, Auszahlung = investiert + Kasse, eine Buchung.
    db.clearEvents(G, U);
    row = decisions.roll(G, U, { groesse: 9, days: 1, npc: 9 }, t0 + 8 * DAY_MS, seq(0.01, 4.5 / 6), 'company');
    check('uebernahme gewürfelt', row?.kind === 'uebernahme', row?.kind);
    const invested = company.investedOf(b, db.getCompany(cid), b.extras.map((e) => e.id));
    const kasse = db.getCompany(cid).kasse;
    bookings = [];
    res = await decisions.choose(G, U, row.id, 'verkaufen', t0 + 8 * DAY_MS + H, seq(0.5));
    check('verkauft: eine Buchung über investiert + Kasse, Firma geschlossen mit Grund sold',
      res.ok && res.effect.sold?.payout === invested + kasse && bookings.length === 1 && bookings[0].amount === invested + kasse
      && bookings[0].opts.xp === false && db.getCompany(cid).status === 'closed' && db.getCompany(cid).closed_why === 'sold',
      JSON.stringify({ eff: res.effect, b: bookings }));
    check('Verkauf ist eine Umbuchung: kein XP, keine Steuer', bookings[0].opts.tax === false && bookings[0].opts.kind === 'company');

    // Vorfall auf eine Firma, die es nicht mehr gibt: keine Wirkung, `gone`.
    db.clearEvents(G, U);
    const stale = db.insertEvent({ guildId: G, userId: U, kind: 'wasserschaden', platform: 'company', createdAt: t0 + 9 * DAY_MS, expiresAt: t0 + 10 * DAY_MS });
    res = await decisions.choose(G, U, stale.id, 'notdienst', t0 + 9 * DAY_MS + H, seq(0.5));
    check('ohne Firma: Vorfall geschlossen, gone, keine Wirkung', res.ok && res.effect.gone === true && res.effect.kasse === 0, JSON.stringify(res.effect));

    // settle würfelt den Vorfall selbst (Größe 0, 1 Tag, Wurf 0,01 nach dem Ereigniswurf).
    const V = 'd2'; konten.set(V, 1_000_000);
    r = await company.found(G, V, 'kiosk', 'Wurfbude', t0);
    const s = company.settle(r.company.id, t0 + DAY_MS, seq(0.5, 0.01, 0));
    check('settle: Vorfall gewürfelt und gemeldet', s.incident?.platform === 'company' && decisions.pending(G, V, t0 + DAY_MS)?.kind === 'gesundheitsamt', JSON.stringify(s.incident));
    check('Frist läuft ab jetzt (24 h), nicht ab dem Abrechnungstag', s.incident.expires_at === t0 + DAY_MS + decisions.DECIDE_MS);
  }
```

Falls `db.clearEvents(G, U)` eine andere Signatur hat (siehe `test/decisions.test.js`), die dortige verwenden. `db.getEvent(guildId, id)` existiert (`decisions.choose`).

- [ ] **Step 2: Test laufen lassen – muss fehlschlagen**

Run: `rm -rf .testdata && DATA_DIR=.testdata node test/companyEvents.test.js`
Expected: ❌ „roll company: 0,01 → Vorfall …" (`possible` leer / Domäne unbekannt).

- [ ] **Step 3: `src/decisions.js`**

Katalog laden: `const { COMPANY_DECISIONS } = require('./data/companyDecisions');` und `byId` über alle drei: `new Map([...DECISIONS, ...MUSIC_DECISIONS, ...COMPANY_DECISIONS].map(...))`.

`roll` – der Domänenzweig:

```js
  let possible;
  if (domain === 'company') {
    // Firmen: Größe statt Reichweite (0…9), Wahrscheinlichkeit über die
    // abgerechneten Tage, Kandidaten nach Größe und NPC-Zahl.
    const company = require('./company');
    const { groesse, days, npc } = size;
    if (random() >= company.riskFor(groesse, days)) return null;
    possible = COMPANY_DECISIONS.filter((d) => groesse >= d.minGroesse && npc >= (d.minNpc ?? 0));
  } else {
    if (random() >= riskFor(size)) return null;
    if (domain === 'music') { … wie bisher … } else { … wie bisher … }
  }
```

(Der bisherige `random() >= riskFor(size)` rückt in den `else`-Zweig; die Reihenfolge der `random()`-Aufrufe für Creator/Musik bleibt gleich.) `platform: domain === 'music' ? 'music' : domain === 'company' ? 'company' : (picked.platform ?? '')`.

`apply`: `if (row.platform === 'company') return applyCompany(guildId, userId, row, effect, now, ignored, random);` als erste Zeile nach dem Musik-Zweig.

```js
/**
 * Wendet einen Firmen-Ausgang an. Alles synchron über company.applyEffect
 * (§7); nur der Verkauf bucht – über company.sell, eine Buchung (§9).
 * Gibt es die Firma nicht mehr (geschlossen, insolvent), wirkt nichts.
 */
async function applyCompany(guildId, userId, row, effect, now, ignored, random) {
  const company = require('./company');
  const c = company.ownCompany(guildId, userId);
  const leer = { kasse: 0, refund: 0, auslastung: 0, quit: [], lock: 0, umsatz: null, days: 0,
    wages: null, werbung: 0, staffRank: null, sell: false, sold: null, gone: true, text: effect.text };
  if (!c) return leer;
  const b = company.branch(c.branch);
  const extraIds = db.companyExtras(c.id);
  const haerte = company.severityFor(company.groesse(c, extraIds)) * (ignored ? IGNORE_PENALTY : 1);
  const staff = db.companyStaff(c.id);
  const r = company.applyEffect(c, staff, effect, { b, extraIds, at: now, today: false, haerte, random });
  for (const s of r.quit) db.deleteStaff(s.id);
  for (const s of r.staff) db.saveStaff(s);
  const d = decision(row.kind);
  r.company.news = company.pushNews(r.company, now, `${d?.emoji ?? '⚠️'} ${effect.text}`);
  db.saveCompany(r.company);

  let sold = null;
  if (effect.sell) {
    const s = await company.sell(guildId, userId, now);
    sold = s.ok ? { payout: s.payout, paid: s.paid } : null;
  }
  return { ...r.done, sold, gone: false, text: effect.text };
}
```

Exporte: `applyCompany, COMPANY_DECISIONS`. Prüfen, dass `company.ownCompany(guildId, userId)` die offene Firma liefert (sonst `db.getOpenCompany`).

- [ ] **Step 4: `src/company.js` – `sell` und Vorfallswurf**

Nach `close`:

```js
/**
 * Verkauf im Übernahme-Vorfall: schließt mit Grund `sold` und zahlt
 * Gründung + Ausbau + Kasse – nie mehr, als reingesteckt wurde (§3).
 * Eine Buchung, ohne XP und Steuer (Umbuchung wie bei `close`).
 */
async function sell(guildId, userId, now = Date.now()) {
  const ctx = ownerContext(guildId, userId);
  if (!ctx) return { ok: false, reason: 'no_company' };
  const { company: c, branch: b } = ctx;
  const extraIds = db.companyExtras(c.id);
  const payout = Math.max(0, Math.round(investedOf(b, c, extraIds) + c.kasse));
  const closed = closeCompany(guildId, c.id, now, 'sold');
  if (payout <= 0) return { ok: true, company: closed, payout, paid: true, balance: null };
  try {
    const balance = await changeCash(guildId, userId, payout, `Verkauf: ${c.name}`,
      { xp: false, tax: false, kind: 'company' });
    return { ok: true, company: closed, payout, paid: true, balance };
  } catch (err) {
    console.warn(`Firma ${c.id}: Auszahlung von ${payout} beim Verkauf fehlgeschlagen – ${err.message}`);
    return { ok: true, company: closed, payout, paid: false, error: err.message };
  }
}
```

`closeCompany` muss den Grund `'sold'` unverändert durchreichen (prüfen: es schreibt `closed_why = why`). Am Ende von `settle`, vor dem `return out` (nur im Nicht-Insolvenz-Pfad):

```js
  // Ein Vorfall je Abrechnung – über die nachgeholten Tage, nicht je Tag (§4).
  out.incident = require('./decisions').roll(guildId, c.owner_id,
    { groesse: groesse(cur, extraIds), days, npc: staff.filter((s) => s.kind === 'npc').length },
    now, random, 'company');
```

Exporte: `sell`.

- [ ] **Step 5: Tests laufen lassen**

Run: `rm -rf .testdata && DATA_DIR=.testdata node test/companyEvents.test.js && DATA_DIR=.testdata node test/decisions.test.js && DATA_DIR=.testdata node test/musicEvents.test.js && DATA_DIR=.testdata node test/company.test.js`
Expected: alle `0 fehlgeschlagen`. Der Musik-/Creator-Test darf sich nicht ändern (Reihenfolge der `random()`-Aufrufe in `roll` bleibt für ihre Domänen gleich).

- [ ] **Step 6: Commit**

```bash
git add src/decisions.js src/company.js test/companyEvents.test.js
git commit -m "firmen: vorfaelle als dritte domaene – roll nach groesse, applyCompany, verkauf

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 4: Anzeige und Wege

**Files:**
- Modify: `src/ui.js` (`buildFirmaView`: Chronik, Vorfall, Geschlossen, Knöpfe; `buildDecisionView`: Domäne `company`; Verlauf-Präfix), `src/buttons.js` (`settleFirma`, Menü-Pfad `entryId === 'firma'`, `wahl`-Ergebnistext für Firmenfelder, `shiftResult` `locked`), `src/fluxer/commands.js` (`workProblem` `locked`)
- Test: `test/menu.test.js`, `test/fluxer-render.test.js` (laufen), Sichtprüfung per Skript

**Interfaces:**
- Consumes: `company.status()` → `news, closedMs, incident` (siehe unten), `decisions.pending/history`, `applyCompany`-`done`-Felder, `jobs.work` → `locked` + `remainingMs`.
- Produces: `company.status()` bekommt zusätzlich `incident` = `decisions.pending(guildId, userId, now)` **nur wenn** `platform === 'company'`, sonst `null` (in `src/company.js`, spät gebunden).

- [ ] **Step 1: `src/company.js` – `incident` im Status**

```js
    incident: (() => { const p = require('./decisions').pending(guildId, userId, now); return p?.platform === 'company' ? p : null; })(),
```

- [ ] **Step 2: `src/ui.js` – Betriebsansicht**

Nach dem Feld „⚠️ Minus-Uhr"/„Kasse im Minus"-Block:

```js
  if (s.closedMs > 0) {
    embed.addFields({
      name: '🔒 Geschlossen',
      value: `Der Betrieb steht still – noch **${fmt(s.closedMs)}**. Löhne laufen weiter.`,
    });
  }
  if (s.incident) {
    embed.addFields({
      name: '⚠️ Vorfall',
      value: `**${s.incident.decision.emoji} ${s.incident.decision.title}** – noch **${fmt(s.incident.remainingMs)}**. `
        + 'Entscheiden über den Knopf ⚠️ Vorfall.',
    });
  }
  if (s.news.length) {
    embed.addFields({
      name: '📰 Chronik',
      value: s.news.map((n) => `${new Date(n.at).toLocaleDateString('de-DE', { day: '2-digit', month: '2-digit' })} · ${n.text}`).join('\n'),
    });
  }
```

Knöpfe: Werbung und Anpacken zusätzlich `.setDisabled(… || s.closedMs > 0)`. Zweite Zeile: statt `homeButton(userId)` →

```js
      s.incident
        ? new ButtonBuilder().setCustomId(`vorfall|${userId}`).setLabel('Vorfall').setEmoji('⚠️').setStyle(ButtonStyle.Danger)
        : homeButton(userId)),
```

- [ ] **Step 3: `src/ui.js` – `buildDecisionView`**

```js
  const isMusic = open.platform === 'music';
  const isCompany = open.platform === 'company';
  const firma = isCompany ? require('./company').ownCompany(guildId, userId) : null;
  …
    .setTitle(`${isMusic ? '🎵 ' : isCompany ? '🏢 ' : ''}${d.emoji} ${d.title}`)
  …
    .setFooter({
      text: isCompany ? `Betrifft deine Firma ${firma?.name ?? ''}`.trim()
        : isMusic ? 'Betrifft deine Musik'
        : platform ? `Betrifft ${platform.name}` : 'Betrifft dein ganzes Netzwerk',
    });
```

Zurück-Knopf: `isCompany ? new ButtonBuilder().setCustomId(ID.menu('firma', 1, userId)).setLabel('Firma').setEmoji('🏢').setStyle(ButtonStyle.Secondary) : isMusic ? … : …`. Verlauf (ohne offenen Vorfall): Präfix `p.platform === 'music' ? '🎵 ' : p.platform === 'company' ? '🏢 ' : ''`.

- [ ] **Step 4: `src/buttons.js`**

Helfer neben `settleMusic`:

```js
/** Verfallene Firmen-Vorfälle wirken beim Öffnen der Firma (§4) – wie settleMusic fürs Studio. */
async function settleFirma(guildId, userId) {
  const lines = [];
  for (const gone of await require('./decisions').settle(guildId, userId).catch(() => [])) {
    lines.push(`⚠️ **${gone.decision.emoji} ${gone.decision.title}** – du hast nicht reagiert.\n_${gone.outcome.text}_`);
  }
  return lines.length ? lines.join('\n') : null;
}
```

Menü-Pfad (`~440`): `const firma = entryId === 'firma' ? await settleFirma(gid(interaction), uid(interaction)) : null;` und `firma` in die `notice`-Liste aufnehmen.

`wahl`-Ergebnis, nach den Musik-Feldern:

```js
      // Firmen-Wirkungen (applyCompany).
      if (e.gone) parts.push('🏢 Die Firma gibt es nicht mehr – keine Wirkung.');
      if (e.kasse) parts.push(`🏢 Kasse ${money(symbol, e.kasse)}`);
      if (e.refund) parts.push(`📄 +${money(symbol, e.refund)} zurück`);
      if (e.auslastung) parts.push(`📈 Auslastung ${e.auslastung > 0 ? '+' : ''}${Math.round(e.auslastung * 100)} %`);
      if (e.quit?.length) parts.push(`👋 gekündigt: ${e.quit.join(', ')}`);
      if (e.lock) parts.push(`🔒 ${e.lock} Tage geschlossen`);
      if (e.umsatz && e.umsatz !== 1) parts.push(`📦 Umsatz ×${e.umsatz.toFixed(2).replace('.', ',')} für ${e.days} Tage`);
      if (e.wages && e.wages !== 1) parts.push(`💶 Löhne ×${e.wages.toFixed(2).replace('.', ',')} für ${e.days} Tage`);
      if (e.werbung) parts.push(`📣 ${e.werbung > 0 ? '+' : ''}${e.werbung} Werbetage`);
      if (e.staffRank) parts.push(`🎓 ${e.staffRank.name} ist jetzt ${require('./company').rankOf(e.staffRank.rank).name}`);
      if (e.sold) parts.push(e.sold.paid ? `💰 Verkauft für ${money(symbol, e.sold.payout)}` : `⚠️ Verkauf gebucht, Auszahlung von ${money(symbol, e.sold.payout)} fehlgeschlagen`);
```

`shiftResult` (vor `const texts = {`): `if (result.reason === 'locked') return { content: \`🔒 **${result.job.title}** ist geschlossen – noch **${require('./income').formatRemaining(result.remainingMs)}**.\` };`

`src/fluxer/commands.js` `workProblem`: `case 'locked': return \`🔒 **${res.job?.title ?? 'Die Firma'}** ist geschlossen – noch **${income.formatRemaining(res.remainingMs)}**.\`;`

- [ ] **Step 5: Tests und Sichtprüfung**

Run: `rm -rf .testdata && DATA_DIR=.testdata node test/menu.test.js && DATA_DIR=.testdata node test/fluxer-render.test.js && DATA_DIR=.testdata node test/companyEvents.test.js`
Expected: `0 fehlgeschlagen`. Sichtprüfung: Skript im Scratchpad, das eine Firma gründet, `db.saveCompany` mit `news` (zwei Zeilen) und `closed_until = Date.now() + 2 Tage` setzt, einen Vorfall per `db.insertEvent({ …, platform:'company', kind:'wasserschaden' })` anlegt und `buildFirmaView` + `buildDecisionView` rendert; Feldtexte und Knopf-Labels in den Report.

- [ ] **Step 6: Commit**

```bash
git add src/company.js src/ui.js src/buttons.js src/fluxer/commands.js
git commit -m "firmen: chronik, vorfall und schliessung in der ansicht; decision-view kennt die firma

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 5: Messung, Docs, Patchnotes

**Files:**
- Modify: `scripts/messung-geldquellen.js` (`firmenlauf`: Ereignisse, Vorfälle zufällig entscheiden, `locked` akzeptieren, `--ohne-ereignisse`, Ausgabe), `ARCHITEKTUR.md` §15, `src/data/patchnotes.js` (1.34.0), `docs/superpowers/specs/2026-09-13-firmen-ausbau-design.md` (Addendum „2b umgesetzt")

**Interfaces:**
- Consumes: `company.settle(cid, now, random)`, `decisions.pending/choose`, Ergebnis `{ news, incident }`.

- [ ] **Step 1: `firmenlauf` erweitern**

Option: `firmenlauf(branchId, tage, { ausbau = 'keiner', ereignisse = !OHNE_EREIGNISSE } = {})`. In der Tagesschleife:

- `company.settle(cid, now + DAY, ereignisse ? rand : () => 0.5)`; zählen: `ereignisTage += s.news.length`, `vorfaelle += s.incident ? 1 : 0`, `zuTage += (db.getCompany(cid).closed_until >= now + DAY) ? 1 : 0`.
- Werbung: die Absage `locked` ist erlaubt (`wb.reason === 'locked'` in die Bedingung aufnehmen); Anpacken bricht bei `locked` ab wie bei `no_time`.
- Vorfälle entscheiden (nach `settle`, nur mit `ereignisse`): `const open = decisions.pending(G, U, now + DAY); if (open?.platform === 'company') { const opts = open.decision.options.filter((o) => !o.outcomes.some((x) => x.sell)); const o = opts[Math.floor(rand() * opts.length)]; await decisions.choose(G, U, open.id, o.id, now + DAY + 1, rand); }` – nie verkaufen, sonst endet der Lauf.
- `besetzen(now)` täglich (Kündigungen nachbesetzen), wie bisher.
- Rückgabe zusätzlich `{ ereignisTage, vorfaelle, zuTage }`; `main()` gibt im Abschnitt „Firmen (nicht ausgebaut, Vollbetrieb)" je Branche beide Läufe aus: `mit Ereignissen X/Tag (Vorfälle N, Y Tage zu) · ohne Z/Tag`.

- [ ] **Step 2: Messläufe**

```bash
rm -rf .testdata && DATA_DIR=.testdata node scripts/messung-geldquellen.js 10 365 2>&1 | tee /tmp/claude-1000/-home-kevin-projects-DiscordBot/bceec67f-7105-4095-882a-6de722ecf202/scratchpad/mess-2b.txt
```

(Timeout 600000 ms; wenn zu lang, `6 365` und im Report sagen.) Erwartung: Median mit Ereignissen < ohne; kein Tag über `decke × 1,15` (der Lauf soll `best` je Branche mit ausgeben); Vorfälle je Jahr ~7 bei Größe 0 (Kern) und ~30 bei Vollausbau (Kapitalist). Handvalidierung: einen Kiosk-Tag mit erzwungenem `kuehlung` durchrechnen (−1.425) und mit der Skript-Ausgabe eines Einzeltags vergleichen – ins Report.

- [ ] **Step 3: Docs und Patchnotes**

ARCHITEKTUR §15: Absatz „**Ereignisse (seit 1.34.0, Stück 2b):** …" mit Ereignis-Decke (`× 1,15`), gemessenen Medianen mit/ohne je Branche, Vorfallsrate je Größe, und der §3-Begründung (Boosts stapeln nicht, `kasse` nie positiv, Übernahme ≤ investiert + Kasse). Patchnote 1.34.0 (Datum des Laufs, Titel „🧯 Firmen: Ereignisse und Vorfälle"): Chronik, 12 leichte Ereignisse, 6 Vorfälle mit 24-h-Frist, Betriebsschließung als härtester Ausgang, gemessene Kosten. Addendum in der 2a-Spec: „## Nachtrag 2026-09-xx: Stück 2b umgesetzt (siehe 2026-09-15-firmen-ereignisse-design.md)".

- [ ] **Step 4: Volle Suite und Commit**

Run: `npm test 2>&1 | grep -c '❌'` → `0`.

```bash
git add scripts/messung-geldquellen.js ARCHITEKTUR.md src/data/patchnotes.js docs/superpowers/specs/2026-09-13-firmen-ausbau-design.md
git commit -m "firmen: messung mit ereignissen, §15, patchnotes 1.34.0

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

## Selbstprüfung gegen die Spec

- Beschluss 1 (beide Schichten): Task 1–3. ✔
- Beschluss 2 (Größe treibt Häufigkeit/Härte, Geld relativ zur Decke): Task 2 (`groesse/riskPerDay/riskFor/severityFor`, `applyEffect` mit `decke`), Task 3 (`roll` mit `riskFor(groesse, days)`). ✔
- Beschluss 3 (`EVENT_UMSATZ_MAX 1,15`, Decken-Test): Task 1 (Konstante, Katalogtest), Task 2 (kein Stapeln, §3-Block mit Ereignissen), §15 in Task 5. ✔
- Beschluss 4 (Schließung als Härtestes, kein Ausbauverlust): Katalog ohne Ausbau-Wirkung; `lock ≤ 5` gedeckelt (Task 2); leichte Ereignisse ohne `lock` (Katalogtest). ✔
- Beschluss 5 (neutraler Katalog, `flavor`): Task 1; `settle` nutzt `ev.flavor?.[b.id]` (Task 2). ✔
- Chronik `news` (5 Zeilen), Spalten, Migration: Task 2. Vorfall-Frist ab echtem `now`: Task 3 (`roll(…, now, …)` in `settle`). Ein Vorfall je Abrechnung: Task 3. ✔
- Anzeige (Chronik, Vorfall-Feld/-Knopf statt Home, Geschlossen, Decision-View, Angestellten-Text, Fluxer): Task 4. ✔
- Messung, §15, Patchnotes, 2a-Addendum: Task 5. ✔
- Refund ≤ Abzug, Übernahme ≤ investiert + Kasse, eine Buchung: Task 2 (`applyEffect`), Task 3 (`sell`, Tests). ✔
- Offen gelassen (bewusst): `staffRank −1` gibt es im Katalog nicht, die Wirkung ist trotzdem implementiert (Grenze −1…+1 im Test) – YAGNI-nah, weil eine Zeile.
