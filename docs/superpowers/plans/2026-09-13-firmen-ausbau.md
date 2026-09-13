# Firmen, Stück 2a (Katalog + Ausbau) – Umsetzungsplan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Neun Branchen statt drei, und je Branche eine fünfstufige Ausbauleiter plus vier Extras, die Plätze und Umsatz je Schicht heben – die Investition, für die der Kern Platz gelassen hat (Spedition voll ausgebaut ~500.000/Tag bei ~50 Mio).

**Architecture:** Die Daten (`src/data/companies.js`) beschreiben Leiter und Extras je Branche über zwei Hilfsfunktionen aus Gründungspreis, Namen und Platzlisten. `company.effectiveOf(company, branch)` → `{ slots, umsatzFactor }` ist die einzige Stelle, die Stufe und Extras in Zahlen übersetzt; alle Stellen, die heute `b.slots`/`b.umsatz` lesen, nehmen die effektiven Werte. `upgrade`/`buyExtra` buchen vom Konto des Inhabers (`xp: false`), Zustand zuerst (§7), eine Buchung (§9), Rollback bei Fehler. Neue Spalte `companies.stufe` (nachgerüstet) und Tabelle `company_extras`.

**Tech Stack:** Node.js (CommonJS), `node:sqlite` über `src/db.js`, discord.js-Builder, eigene Testdateien, `DATA_DIR=.testdata`.

## Global Constraints

- Spec: `docs/superpowers/specs/2026-09-13-firmen-ausbau-design.md`. Zahlen daraus wörtlich: Umsatzfaktoren der Stufen **1,2 · 1,45 · 1,7 · 1,95 · 2,2**; Stufenpreise **Gründung × 1,5 · 3 · 6 · 9 · 14**; Extras: drei à **+0,15** Umsatz, eines **+2 Plätze (klein: +1)**, Preis je Extra **Gründung × 2**, `minStufe` 3 für das dritte Umsatz-Extra und 2 für das Platz-Extra; `MAX_STUFE = 5`, `CONFIRM_ABOVE = 5_000_000`. Platzlisten und Namen wie in der Spec. Neue Branchen mit den Werten der Katalog-Tabelle (Imbiss 40.000/3/240/90, Autowäsche 35.000/2/260/80, Fitness 150.000/4/700/150, Werkstatt 200.000/4/1.100/320, Baufirma 1.800.000/12/1.700/500, Club 1.000.000/6/2.400/380).
- **Eine Abweichung von der Spec, bewusst:** `ceilingOf(b)` behält den Kern-Standard (Stufe 0, keine Extras), damit die Stück-1-Tests und die Handrechnung 78.000 gültig bleiben; die volle Decke heißt `fullCeilingOf(b)`, die aktuelle `ceilingOf(b, stufe, extraIds)`.
- ARCHITEKTUR §3 (Decke vorgerechnet und getestet, Monotonie), §4 (`fresh` vor jeder Aktion), §6 (zustandslose IDs), §7 (Stufe/Extra zuerst schreiben, dann buchen), §8 (späte Bindung), §9 (eine Buchung), §12 (Tests ohne Netz).
- Geldbuchungen für Ausbau: `changeCash(guildId, userId, −price, 'Ausbau: <Firma> – <Name>', { xp: false, kind: 'company' })`, Bank anzapfen wie in `found` (`unb.withdrawFromBank`). Investition gibt **keine XP** (XP-Schleife aus dem Stück-1-Review).
- Bestehende Firmen (Stufe 0, keine Extras) verhalten sich exakt wie bisher – alle Stück-1-Handrechnungen in `test/company.test.js` bleiben grün ohne Änderung ihrer Zahlen; nur der Katalogtest (drei → neun Branchen, Zugriff per id statt Position) wird angepasst.
- Regeln aus `messfehler-vermeiden.md`: keine abgeleitete Zahl ohne Handrechnung, eine Null ist ein Fehler, Simulationen starten heute 6:00, `grep src/` statt raten.
- Sprache Deutsch; Commit-Trailer wörtlich `Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>`. Tests: `rm -rf .testdata && DATA_DIR=.testdata node test/company.test.js`; volle Kette `npm test 2>&1 | grep -c '❌'` → `0`.

---

## Dateien

| Datei | Verantwortung |
|---|---|
| `src/data/companies.js` | neun Branchen mit `stufen`/`extras` (Hilfsfunktionen `leiter`, `extrasFor`), `MAX_STUFE`, `CONFIRM_ABOVE`, `STUFE_FAKTOREN`, `STUFE_PREISFAKTOREN`, `extraById` |
| `src/db.js` | Spalte `stufe` (Migration), Tabelle `company_extras`, Funktionen |
| `src/company.js` | `effectiveOf`, `nextStufe`, `ceilingOf(b, stufe, extraIds)`, `fullCeilingOf`, `upgrade`, `buyExtra`, effektive Werte überall, `status` erweitert |
| `src/ui.js` | Gründungsansicht mit Klassen, Betriebsansicht mit Ausbau-Zeile/-Button, `buildFirmaAusbauView` |
| `src/buttons.js` | `firma|gruendung|<klasse>`, `firma|ausbau`, `firma|ausbauen|<ja>`, `firma|extra|<id>` |
| `test/company.test.js` | Katalogtest angepasst, neuer Abschnitt „Ausbau" |
| `scripts/messung-geldquellen.js` | `firmenlauf(branchId, tage, { ausbau })` – Kapitalist und Aufsteiger |
| `src/data/patchnotes.js`, `ARCHITEKTUR.md` | 1.32.0, §15 |

---

### Task 1: Neun Branchen, Leiter und Extras als Daten; `effectiveOf` und die Decke

**Files:**
- Modify: `src/data/companies.js`, `src/company.js` (`ceilingOf` ~Zeile 65, Exporte)
- Test: `test/company.test.js` (Katalogblock; neuer Abschnitt „Ausbau: Daten und Decke")

**Interfaces:**
- Produces (`data/companies.js`): `BRANCHES[9]` mit je `stufen: [{ id: 1..5, name, price, slots, umsatz }]` und `extras: [{ id, name, emoji, price, umsatz, slots, minStufe }]`, `klasse: 'klein'|'mittel'|'gross'`; `MAX_STUFE = 5`; `CONFIRM_ABOVE = 5_000_000`; `STUFE_FAKTOREN`, `STUFE_PREISFAKTOREN`; `extraById(id)`.
- Produces (`company.js`): `effectiveOf(company, branch, extraIds = null)` → `{ slots, umsatzFactor }` (liest `company.stufe`; `extraIds` optional, sonst aus `db.companyExtras(company.id)` – in dieser Task ohne DB-Aufruf, wenn `extraIds` gegeben); `ceilingOf(b, stufe = 0, extraIds = [])` → `{ gross, wages, net, slots, factor }`; `fullCeilingOf(b)`; `nextStufe(company, branch)` → Stufen-Eintrag oder `null`.

- [ ] **Step 1: Katalogtest anpassen und neue Prüfungen schreiben**

Im Block „Der Katalog" von `test/company.test.js` die drei Zeilen

```js
    check('drei Branchen', data.BRANCHES.length === 3);
    …
    const [k, c, s] = data.BRANCHES;
```

ersetzen durch

```js
    check('neun Branchen', data.BRANCHES.length === 9, String(data.BRANCHES.length));
    check('IDs eindeutig', new Set(data.BRANCHES.map((b) => b.id)).size === 9);
    check('drei je Klasse', ['klein', 'mittel', 'gross'].every((k) =>
      data.BRANCHES.filter((b) => b.klasse === k).length === 3));
    const byId = Object.fromEntries(data.BRANCHES.map((b) => [b.id, b]));
    const [k, c, s] = [byId.kiosk, byId.cafe, byId.spedition];
```

(die Prüfungen „Kiosk < Café < Spedition" und „Decke der Spedition ist die Handrechnung (78.000)" bleiben wörtlich – `ceilingOf(s).net` ist weiter die Kern-Decke).

Neuen Abschnitt vor der Abschlusszeile einfügen:

```js
  console.log('--- Ausbau: Daten und Decke ---');
  {
    for (const b of data.BRANCHES) {
      check(`${b.id}: fünf Stufen`, b.stufen.length === data.MAX_STUFE);
      check(`${b.id}: Stufenpreise = Gründung × 1,5/3/6/9/14`,
        b.stufen.map((st) => st.price).join() === data.STUFE_PREISFAKTOREN.map((f) => Math.round(b.price * f)).join(),
        b.stufen.map((st) => st.price).join());
      check(`${b.id}: Umsatzfaktoren 1,2…2,2`, b.stufen.map((st) => st.umsatz).join() === '1.2,1.45,1.7,1.95,2.2');
      check(`${b.id}: Plätze steigen monoton bis zum Doppelten`,
        b.stufen.every((st, i) => st.slots >= (i ? b.stufen[i - 1].slots : b.slots))
        && b.stufen[4].slots === b.slots * 2, b.stufen.map((st) => st.slots).join());
      check(`${b.id}: vier Extras, drei Umsatz, eines Plätze`,
        b.extras.length === 4 && b.extras.filter((e) => e.umsatz).length === 3
        && b.extras.filter((e) => e.slots).length === 1);
      check(`${b.id}: Extras kosten je 2× Gründung`, b.extras.every((e) => e.price === b.price * 2));
      check(`${b.id}: minStufe 3 und 2 gesetzt`,
        b.extras.some((e) => e.umsatz && e.minStufe === 3) && b.extras.some((e) => e.slots && e.minStufe === 2)
        && b.extras.filter((e) => !e.minStufe).length === 2);
      check(`${b.id}: Extra-IDs eindeutig und auffindbar`,
        new Set(b.extras.map((e) => e.id)).size === 4 && b.extras.every((e) => data.extraById(e.id) === e));
      const gesamt = b.stufen.reduce((s, st) => s + st.price, 0) + b.extras.reduce((s, e) => s + e.price, 0);
      check(`${b.id}: Gesamtausbau ≈ 41,5× Gründung`, Math.abs(gesamt / b.price - 41.5) < 0.05, (gesamt / b.price).toFixed(2));
      check(`${b.id}: Kern-Decke unter Musik+Creator (100.916)`, company.ceilingOf(b).net < 100_916, de(company.ceilingOf(b).net));
    }
    check('Extra-IDs global eindeutig',
      new Set(data.BRANCHES.flatMap((b) => b.extras.map((e) => e.id))).size === 36);

    // effectiveOf: Stufe 0 = Kern, voll = Handrechnung.
    const sp = data.BRANCHES.find((b) => b.id === 'spedition');
    const kern = company.effectiveOf({ stufe: 0 }, sp, []);
    check('Stufe 0 ohne Extras = Kernwerte', kern.slots === 10 && kern.umsatzFactor === 1);
    const alle = sp.extras.map((e) => e.id);
    const voll = company.effectiveOf({ stufe: 5 }, sp, alle);
    check('Stufe 5 + alle Extras: 22 Plätze, Faktor 2,65', voll.slots === 22 && Math.abs(voll.umsatzFactor - 2.65) < 1e-9,
      JSON.stringify(voll));
    // Handrechnung Spedition voll: 22 × 3 × 1.900 × 1,5 × 2,65 = 498.465 + 4 × 1.900 × 1,5 × 2,65 = 30.210
    // → 528.675 brutto − Löhne 22 × 3 × 630 = 41.580 → 487.095.
    check('volle Decke der Spedition = 487.095 (Handrechnung)',
      Math.round(company.fullCeilingOf(sp).net) === 487_095, de(company.fullCeilingOf(sp).net));
    const ki = data.BRANCHES.find((b) => b.id === 'kiosk');
    // Kiosk voll: 5 × 3 × 250 × 1,5 × 2,65 = 14.906,25 + 3.975 − 2.250 = 16.631,25.
    check('volle Decke des Kiosks = 16.631 (Handrechnung)',
      Math.round(company.fullCeilingOf(ki).net) === 16_631, de(company.fullCeilingOf(ki).net));

    // Monotonie: jede Stufe und jedes Extra hebt die Decke echt.
    let ok = true;
    for (const b of data.BRANCHES) {
      let prev = company.ceilingOf(b, 0, []).net;
      for (let st = 1; st <= data.MAX_STUFE; st++) {
        const n = company.ceilingOf(b, st, []).net;
        if (!(n > prev)) ok = false;
        prev = n;
      }
      for (const e of b.extras) {
        if (!(company.ceilingOf(b, 5, [e.id]).net > company.ceilingOf(b, 5, []).net)) ok = false;
      }
    }
    check('jede Stufe und jedes Extra hebt die Decke', ok);
    check('nextStufe: bei Stufe 0 die erste, bei 5 null',
      company.nextStufe({ stufe: 0 }, sp)?.id === 1 && company.nextStufe({ stufe: 5 }, sp) === null);
  }
```

- [ ] **Step 2: Test laufen lassen – Scheitern erwartet**

```bash
rm -rf .testdata && DATA_DIR=.testdata node test/company.test.js 2>&1 | grep -m3 "❌"
```

Erwartet: `neun Branchen` ❌ (heute 3), danach Abbruch bei `b.stufen.length` (TypeError) oder ❌ – beides ist die erwartete Röte.

- [ ] **Step 3: Datendatei erweitern**

In `src/data/companies.js` den `BRANCHES`-Block und die Exporte ersetzen (Kommentarkopf der Datei um den Ausbau ergänzen):

```js
/**
 * Ausbau (Stück 2a): fünf Stufen je Branche (Leiter) plus vier Extras.
 *
 *   Stufe: { id 1…5, name, price, slots (neue Platzzahl), umsatz (Faktor) }
 *   Extra: { id, name, emoji, price, umsatz (+Faktor) | slots (+Plätze), minStufe }
 *
 * Gemeinsame Regeln: Umsatzfaktoren 1,2 · 1,45 · 1,7 · 1,95 · 2,2; Stufenpreise
 * Gründung × 1,5 · 3 · 6 · 9 · 14; Extras je 2× Gründung, drei à +0,15 Umsatz,
 * eines +2 Plätze (klein +1); minStufe 3 auf dem dritten Umsatz-Extra, 2 auf dem
 * Platz-Extra. Löhne skalieren NICHT mit – die Marge wächst mit der Größe.
 * Spedition voll: 22 Plätze, Faktor 2,65 → 487.095/Tag (company.fullCeilingOf).
 */
const MAX_STUFE = 5;
const CONFIRM_ABOVE = 5_000_000;          // ab hier fragt der Ausbau-Knopf nach
const STUFE_FAKTOREN = [1.2, 1.45, 1.7, 1.95, 2.2];
const STUFE_PREISFAKTOREN = [1.5, 3, 6, 9, 14];
const EXTRA_PREISFAKTOR = 2;
const EXTRA_UMSATZ = 0.15;

const slug = (s) => s.toLowerCase()
  .replace(/ä/g, 'ae').replace(/ö/g, 'oe').replace(/ü/g, 'ue').replace(/ß/g, 'ss')
  .replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '');

/** Die fünf Stufen einer Branche aus Preis, Namen und Platzliste. */
function leiter(price, names, slots) {
  return names.map((name, i) => ({
    id: i + 1, name, price: Math.round(price * STUFE_PREISFAKTOREN[i]),
    slots: slots[i], umsatz: STUFE_FAKTOREN[i],
  }));
}

/** Die vier Extras: drei Umsatz (das dritte ab Stufe 3), ein Platz-Extra ab Stufe 2. */
function extrasFor(branchId, price, [u1, u2, u3, s], slotsPlus) {
  const price2 = price * EXTRA_PREISFAKTOR;
  const mk = (n, fields) => ({ id: `${branchId}-${slug(n.name)}`, name: n.name, emoji: n.emoji, price: price2, ...fields });
  return [
    mk(u1, { umsatz: EXTRA_UMSATZ, minStufe: 0 }),
    mk(u2, { umsatz: EXTRA_UMSATZ, minStufe: 0 }),
    mk(u3, { umsatz: EXTRA_UMSATZ, minStufe: 3 }),
    mk(s, { slots: slotsPlus, minStufe: 2 }),
  ];
}

const E = (name, emoji) => ({ name, emoji });

const BRANCHES = [
  // ------------------------------------------------------------- klein
  { id: 'kiosk', klasse: 'klein', name: 'Kiosk', emoji: '🏪', price: 25_000, slots: 2, umsatz: 250, lohn: 100,
    blurb: 'Zeitungen, Zigaretten, kalte Getränke. Läuft fast allein – aber eben nur fast.',
    stufen: leiter(25_000, ['Kühlregal', 'Lotto-Terminal', 'Zweite Kasse', 'Backshop', 'Paketstation'], [3, 3, 4, 4, 4]),
    extras: extrasFor('kiosk', 25_000, [E('Zeitungsregal', '📰'), E('Kaffeeautomat', '☕'), E('Bargeld-Service', '💶'), E('Verlängerte Öffnung', '🌙')], 1) },
  { id: 'imbiss', klasse: 'klein', name: 'Imbiss', emoji: '🌭', price: 40_000, slots: 3, umsatz: 240, lohn: 90,
    blurb: 'Pommes, Wurst, Stammkunden. Viele billige Schichten – und Werbung, die man riecht.',
    stufen: leiter(40_000, ['Zweiter Grill', 'Sitzplätze', 'Lieferdienst', 'Zweite Theke', 'Foodtruck'], [4, 4, 5, 6, 6]),
    extras: extrasFor('imbiss', 40_000, [E('Eiswürfelmaschine', '🧊'), E('Fritteuse XL', '🍟'), E('Currywurst-Franchise', '🌭'), E('Nachtschicht', '🌙')], 1) },
  { id: 'autowaesche', klasse: 'klein', name: 'Autowäsche', emoji: '🚗', price: 35_000, slots: 2, umsatz: 260, lohn: 80,
    blurb: 'Kaum Personal, dafür Anlagen – hier steckt das Geld im Ausbau, nicht in Leuten.',
    stufen: leiter(35_000, ['Zweite Box', 'Staubsaugerplätze', 'Waschstraße', 'Innenreinigung', 'Zweite Waschstraße'], [3, 3, 4, 4, 4]),
    extras: extrasFor('autowaesche', 35_000, [E('Wachsprogramm', '✨'), E('Felgenreiniger', '🛞'), E('Kartenzahlung', '💳'), E('Sonntagsöffnung', '📅')], 1) },
  // ------------------------------------------------------------ mittel
  { id: 'cafe', klasse: 'mittel', name: 'Café', emoji: '☕', price: 120_000, slots: 5, umsatz: 900, lohn: 180,
    blurb: 'Braucht Leute hinter der Theke und jemanden, der sich kümmert. Dann läuft es.',
    stufen: leiter(120_000, ['Terrasse', 'Siebträger-Maschine', 'Frühstückskarte', 'Abendbetrieb', 'Rösterei'], [6, 7, 8, 9, 10]),
    extras: extrasFor('cafe', 120_000, [E('Kuchenvitrine', '🍰'), E('Kaffeebohnen-Verkauf', '🫘'), E('Catering', '🚐'), E('Zweite Schicht', '🌙')], 2) },
  { id: 'fitness', klasse: 'mittel', name: 'Fitnessstudio', emoji: '🏋️', price: 150_000, slots: 4, umsatz: 700, lohn: 150,
    blurb: 'Wenig Lohn, viel Gerät. Der Umsatz hängt daran, was an der Wand steht – am Ausbau.',
    stufen: leiter(150_000, ['Freihantelbereich', 'Kursraum', 'Sauna', 'Cardio-Fläche', '24-Stunden-Betrieb'], [5, 6, 6, 7, 8]),
    extras: extrasFor('fitness', 150_000, [E('Proteinbar', '🥤'), E('Personal Training', '🧑‍🏫'), E('Firmenverträge', '📄'), E('Frühöffnung', '🌅')], 2) },
  { id: 'werkstatt', klasse: 'mittel', name: 'Werkstatt', emoji: '🔧', price: 200_000, slots: 4, umsatz: 1_100, lohn: 320,
    blurb: 'Teure Fachkräfte, hoher Umsatz je Schicht. Wer gute Leute hält, verdient hier gut.',
    stufen: leiter(200_000, ['Zweite Hebebühne', 'Diagnosegerät', 'Reifenlager', 'Lackierkabine', 'Dritte Hebebühne'], [5, 6, 6, 7, 8]),
    extras: extrasFor('werkstatt', 200_000, [E('Reifenservice', '🛞'), E('TÜV-Prüfstelle', '📋'), E('Oldtimer-Restauration', '🏎️'), E('Samstagsschicht', '📅')], 2) },
  // -------------------------------------------------------------- groß
  { id: 'spedition', klasse: 'gross', name: 'Spedition', emoji: '🚚', price: 1_200_000, slots: 10, umsatz: 1_900, lohn: 420,
    blurb: 'Lkw, Fahrer, Disposition. Hohe Löhne, hohe Marge – rentabel nur mit voller Mannschaft.',
    stufen: leiter(1_200_000, ['3 Lkw', 'Depot', 'Eigene Werkstatt', 'Flotte 15', 'Flotte 20'], [12, 14, 16, 18, 20]),
    extras: extrasFor('spedition', 1_200_000, [E('Telematik', '📡'), E('Tankkarten-Vertrag', '⛽'), E('Gefahrgut-Lizenz', '☣️'), E('Nachtschicht', '🌙')], 2) },
  { id: 'baufirma', klasse: 'gross', name: 'Baufirma', emoji: '🏗️', price: 1_800_000, slots: 12, umsatz: 1_700, lohn: 500,
    blurb: 'Kolonnen, Kran, Bauhof. Die höchsten Löhne im Spiel – und nur mit voller Mannschaft ein Geschäft.',
    stufen: leiter(1_800_000, ['Zweite Kolonne', 'Kran', 'Bauhof', 'Dritte Kolonne', 'Fertigteilwerk'], [14, 17, 19, 22, 24]),
    extras: extrasFor('baufirma', 1_800_000, [E('Eigener Bagger', '🚜'), E('Gerüstbau', '🪜'), E('Sanierungslizenz', '📜'), E('Zweite Schicht', '🌙')], 2) },
  { id: 'club', klasse: 'gross', name: 'Club', emoji: '🍸', price: 1_000_000, slots: 6, umsatz: 2_400, lohn: 380,
    blurb: 'Wenige Plätze, teurer Ausbau, und der Name muss in der Stadt sein. Werbung ist hier alles.',
    stufen: leiter(1_000_000, ['Zweite Bar', 'Soundanlage', 'Lounge', 'Zweiter Floor', 'Dachterrasse'], [7, 8, 9, 11, 12]),
    extras: extrasFor('club', 1_000_000, [E('VIP-Bereich', '👑'), E('Gastro-Lizenz', '🍽️'), E('Booking-Agentur', '🎧'), E('Afterhour', '🌙')], 2) },
];

const extraIndex = new Map(BRANCHES.flatMap((b) => b.extras.map((e) => [e.id, e])));
/** Extra per ID, oder null. */
function extraById(id) { return extraIndex.get(String(id ?? '')) ?? null; }
```

Exporte ergänzen: `MAX_STUFE, CONFIRM_ABOVE, STUFE_FAKTOREN, STUFE_PREISFAKTOREN, EXTRA_UMSATZ, extraById,`.

Prüfen: `node -e "const d=require('./src/data/companies'); console.log(d.BRANCHES.length, d.BRANCHES[6].extras.map(e=>e.id))"` → `9 [ 'spedition-telematik', 'spedition-tankkarten_vertrag', 'spedition-gefahrgut_lizenz', 'spedition-nachtschicht' ]`.

- [ ] **Step 4: `effectiveOf`, `ceilingOf`, `fullCeilingOf`, `nextStufe` in `company.js`**

`ceilingOf` (Zeile ~65) ersetzen:

```js
/**
 * Was Stufe und Extras aus einer Branche machen: Plätze und Umsatzfaktor.
 * Stufe 0 ohne Extras = Kernwerte – bestehende Firmen rechnen wie bisher.
 * `extraIds` übergibt der Aufrufer, wenn er sie schon hat; sonst aus der DB.
 */
function effectiveOf(company, b, extraIds = null) {
  const ids = extraIds ?? db.companyExtras(company.id);
  const st = company.stufe > 0 ? b.stufen[Math.min(company.stufe, data.MAX_STUFE) - 1] : null;
  let slots = st ? st.slots : b.slots;
  let umsatzFactor = st ? st.umsatz : 1;
  for (const id of ids) {
    const e = data.extraById(id);
    if (!e) continue;
    if (e.slots) slots += e.slots;
    if (e.umsatz) umsatzFactor += e.umsatz;
  }
  return { slots, umsatzFactor: Math.round(umsatzFactor * 1000) / 1000 };
}

/** Die nächste Stufe der Leiter, oder null bei Vollausbau. */
function nextStufe(company, b) {
  return company.stufe >= data.MAX_STUFE ? null : b.stufen[company.stufe];
}

/**
 * Die Decke je Tag – vorgerechnet, damit §3 eine Zahl hat. Standard ist der
 * Kern (Stufe 0, keine Extras); mit Stufe und Extras die Decke der aktuellen
 * Firma, `fullCeilingOf` die des Vollausbaus. Volle NPC-Besetzung mit
 * Schichtleitern, Auslastung 1,0, tägliches Anpacken.
 */
function ceilingOf(b, stufe = 0, extraIds = []) {
  const top = rankOf(data.RANKS.length - 1).factor;
  const { slots, umsatzFactor } = effectiveOf({ id: 0, stufe }, b, extraIds);
  const gross = slots * data.NPC_SHIFTS * b.umsatz * top * umsatzFactor
    + data.MAX_PITCH_PER_DAY * b.umsatz * top * umsatzFactor;
  const wages = slots * data.NPC_SHIFTS * b.lohn * top;
  return { gross, wages, net: gross - wages, slots, factor: umsatzFactor };
}

function fullCeilingOf(b) {
  return ceilingOf(b, data.MAX_STUFE, b.extras.map((e) => e.id));
}
```

Damit `effectiveOf` in Task 1 ohne DB läuft, braucht `db.companyExtras` noch nicht zu existieren – die Tests übergeben `extraIds`. Exporte ergänzen: `effectiveOf, nextStufe, fullCeilingOf,` und `MAX_STUFE: data.MAX_STUFE, CONFIRM_ABOVE: data.CONFIRM_ABOVE,`.

- [ ] **Step 5: Gründungsansicht vorläufig in drei Zeilen (Discord-Limit)**

`buildFirmaFoundView` in `src/ui.js` baut heute **eine** Zeile aus `company.BRANCHES.map(...)` – mit neun Branchen sind das neun Buttons in einer Zeile, Discord erlaubt fünf, und `test/menu.test.js` würde rot. Bis Task 4 die Ansicht neu baut, die eine Zeile durch drei ersetzen:

```js
      ...['klein', 'mittel', 'gross'].map((k) => new ActionRowBuilder().addComponents(
        ...company.BRANCHES.filter((b) => b.klasse === k).map((b) =>
          new ButtonBuilder().setCustomId(`firma|gruenden|${b.id}|${userId}`)
            .setLabel(b.name).setEmoji(b.emoji).setStyle(ButtonStyle.Success)))),
```

(an der Stelle der bisherigen `new ActionRowBuilder().addComponents(...company.BRANCHES.map(...))`-Zeile; die Home-Zeile bleibt als vierte).

- [ ] **Step 6: Handrechnung, dann Test**

Spedition voll: `effectiveOf({stufe:5}, sp, alle)` → slots 20 + 2 = 22, Faktor 2,2 + 0,45 = 2,65. `gross = 22 × 3 × 1900 × 1,5 × 2,65 = 498.465` + `4 × 1900 × 1,5 × 2,65 = 30.210` = 528.675; `wages = 22 × 3 × 420 × 1,5 = 41.580`; net 487.095 ✓. Kiosk: slots 4 + 1 = 5; `5 × 3 × 250 × 1,5 × 2,65 = 14.906,25` + `3.975` − `2.250` = 16.631,25 → gerundet 16.631 ✓. Falls die Gleitkomma-Summe 2,65 nicht exakt trifft, rundet `effectiveOf` auf drei Stellen – deshalb die Rundung dort.

```bash
rm -rf .testdata && DATA_DIR=.testdata node test/company.test.js 2>&1 | tail -1
```

Erwartet: `… bestanden, 0 fehlgeschlagen`; danach `DATA_DIR=.testdata node test/menu.test.js | tail -1` → `0 fehlgeschlagen` und `npm test 2>&1 | grep -c '❌'` → `0`.

- [ ] **Step 7: Commit**

```bash
git add src/data/companies.js src/company.js src/ui.js test/company.test.js
git commit -m "$(printf 'firmen: neun branchen, ausbauleiter und extras als daten, decke je stufe\n\nCo-Authored-By: Claude Opus 5 <noreply@anthropic.com>')"
```

---

### Task 2: Spalte `stufe`, Tabelle `company_extras`, `upgrade` und `buyExtra`

**Files:**
- Modify: `src/db.js` (Migrationsblock nach `closed_why`, `stmt`, Funktionen, Exporte), `src/company.js` (`closeCompany`, neue Funktionen, Exporte)
- Test: `test/company.test.js`

**Interfaces:**
- Consumes: Task 1.
- Produces (`db.js`): `setCompanyStufe(id, stufe)`, `companyExtras(companyId)` → `string[]`, `addCompanyExtra(companyId, extraId, now)`, `deleteCompanyExtra(companyId, extraId)`, `deleteExtrasOfCompany(companyId)`; `companies.stufe` in `getCompany`-Zeilen.
- Produces (`company.js`): `upgrade(guildId, userId, now)` → `{ ok, stufe, price, balance } | { ok: false, reason: 'no_company'|'max'|'funds'|'payment' }`; `buyExtra(guildId, userId, extraId, now)` → `{ ok, extra, balance } | { reason: 'no_company'|'unknown'|'owned'|'stufe'|'funds'|'payment' }`.

- [ ] **Step 1: Tests schreiben**

Vor der Abschlusszeile:

```js
  console.log('--- Ausbau kaufen: Leiter und Extras ---');
  {
    const U = user(); funds(U, 100_000, 60_000_000);
    const f = await company.found(G, U, 'spedition', 'Ausbau-Sped', t0);
    const cid = f.company.id;
    const sp = company.branch('spedition');
    check('frisch gegründet: Stufe 0, keine Extras', db.getCompany(cid).stufe === 0 && db.companyExtras(cid).length === 0);

    bookings = [];
    let r = await company.upgrade(G, U, t0);
    check('Stufe 1 gekauft: 1,8 Mio, eine Buchung ohne XP', r.ok && r.stufe.id === 1 && bookings.length === 1
      && bookings[0].amount === -1_800_000 && bookings[0].opts.xp === false && bookings[0].opts.kind === 'company',
      JSON.stringify(bookings));
    check('Stufe steht in der DB', db.getCompany(cid).stufe === 1);
    check('Bank angezapft (Bargeld reichte nicht)', konten.get(U).cash === 0 && konten.get(U).bank === 60_000_000 - 1_200_000 + 100_000 - 1_800_000);
    for (let i = 2; i <= 5; i++) r = await company.upgrade(G, U, t0);
    check('bis Stufe 5 gekauft', db.getCompany(cid).stufe === 5);
    r = await company.upgrade(G, U, t0);
    check('Stufe 6 gibt es nicht', r.ok === false && r.reason === 'max');
    const ausgegeben = -bookings.reduce((s, b) => s + b.amount, 0);
    check('Leiter kostet 40,2 Mio', ausgegeben === 40_200_000, de(ausgegeben));

    // Extras
    const [u1, , u3, sx] = sp.extras;
    bookings = [];
    r = await company.buyExtra(G, U, u1.id, t0);
    check('Extra gekauft: 2,4 Mio, eine Buchung ohne XP', r.ok && r.extra.id === u1.id && bookings.length === 1
      && bookings[0].amount === -2_400_000 && bookings[0].opts.xp === false);
    check('Extra steht in der DB', db.companyExtras(cid).includes(u1.id));
    r = await company.buyExtra(G, U, u1.id, t0);
    check('zweimal kaufen geht nicht', r.ok === false && r.reason === 'owned');
    r = await company.buyExtra(G, U, 'kiosk-zeitungsregal', t0);
    check('Extra einer anderen Branche', r.reason === 'unknown');
    r = await company.buyExtra(G, U, 'gibtsnicht', t0);
    check('unbekanntes Extra', r.reason === 'unknown');
    for (const e of [u3, sx]) await company.buyExtra(G, U, e.id, t0);
    check('Extras mit minStufe bei Stufe 5 kaufbar', db.companyExtras(cid).length === 3);

    // minStufe greift bei einer frischen Firma.
    const V = user(); funds(V, 0, 10_000_000);
    const g = await company.found(G, V, 'cafe', 'Klein-Café', t0);
    const cafe = company.branch('cafe');
    r = await company.buyExtra(G, V, cafe.extras[3].id, t0);
    check('Platz-Extra vor Stufe 2 gesperrt', r.ok === false && r.reason === 'stufe' && r.minStufe === 2);
    r = await company.buyExtra(G, V, cafe.extras[2].id, t0);
    check('drittes Umsatz-Extra vor Stufe 3 gesperrt', r.reason === 'stufe' && r.minStufe === 3);
    r = await company.buyExtra(G, V, cafe.extras[0].id, t0);
    check('Extra ohne minStufe sofort kaufbar', r.ok === true);

    // Guthaben und Rollback.
    const W = user(); funds(W, 0, 30_000);
    await company.found(G, W, 'kiosk', 'Armer Kiosk', t0);
    r = await company.upgrade(G, W, t0);
    check('zu wenig Geld: funds mit needed/have', r.reason === 'funds' && r.needed === 37_500 && r.have === 5_000);
    funds(W, 0, 100_000);
    const echt = unb.changeCash;
    unb.changeCash = async () => { throw new Error('API down'); };
    r = await company.upgrade(G, W, t0);
    check('Buchung schlägt fehl: Stufe zurück', r.reason === 'payment' && company.ownCompany(G, W).stufe === 0);
    const kx = company.branch('kiosk').extras[0];
    r = await company.buyExtra(G, W, kx.id, t0);
    check('Buchung schlägt fehl: Extra zurück', r.reason === 'payment' && db.companyExtras(company.ownCompany(G, W).id).length === 0);
    unb.changeCash = echt;

    // Schließen räumt die Extras weg.
    const before = db.companyExtras(cid).length;
    await company.close(G, U, t0);
    check('Schließen löscht die Extras', before === 3 && db.companyExtras(cid).length === 0);

    // Insolvenz ebenso – Muster „Minuskiosk": ein Schichtleiter-NPC, Kasse läuft ins
    // Minus. Das Extra ist das Platz-Extra (kein Umsatzzuschlag), damit die
    // Verlust-Rechnung aus dem Kern-Block hält, auch wenn settle ab Task 3 den
    // Faktor kennt: 1 NPC auf 3 Plätzen → Ziel 0,467, Umsatz 125/135/143 < Lohn 150.
    const Y = user(); funds(Y, 0, 100_000);
    const g2 = await company.found(G, Y, 'kiosk', 'Pleitekiosk', t0);
    company.hireNpc(G, Y, t0, seq(0));
    for (const st of db.companyStaff(g2.company.id)) db.saveStaff({ ...st, rank: 2 });
    db.addCompanyExtra(g2.company.id, 'kiosk-verlaengerte_oeffnung', t0);
    company.settle(g2.company.id, t0 + 15 * DAY_MS);
    check('Insolvenz löscht die Extras',
      db.getCompany(g2.company.id).status === 'closed' && db.companyExtras(g2.company.id).length === 0,
      JSON.stringify({ status: db.getCompany(g2.company.id).status, extras: db.companyExtras(g2.company.id) }));
  }

  console.log('--- Migration: stufe nachgerüstet ---');
  {
    // Das Modul legt die Spalte beim Laden per PRAGMA-Prüfung an (Muster closed_why);
    // hier wird nur geprüft, dass jede Firma sie hat und sie bei 0 startet.
    const U = user(); funds(U, 0, 100_000);
    const f = await company.found(G, U, 'kiosk', 'Migrationskiosk', t0);
    check('stufe ist 0 und eine Zahl',
      typeof db.getCompany(f.company.id).stufe === 'number' && db.getCompany(f.company.id).stufe === 0);
  }
```

- [ ] **Step 2: Scheitern prüfen**

```bash
rm -rf .testdata && DATA_DIR=.testdata node test/company.test.js 2>&1 | grep -m1 "TypeError\|❌"
```

Erwartet: `db.companyExtras is not a function`.

- [ ] **Step 3: `db.js`**

Nach dem `closed_why`-Migrationsblock:

```js
// Ausbau (Stück 2a): die Stufe hängt an der Firma, die Extras in eigener Tabelle.
if (!db.prepare('PRAGMA table_info(companies)').all().some((c) => c.name === 'stufe')) {
  db.exec('ALTER TABLE companies ADD COLUMN stufe INTEGER NOT NULL DEFAULT 0');
}
db.exec(`
  CREATE TABLE IF NOT EXISTS company_extras (
    company_id INTEGER NOT NULL,
    extra_id   TEXT    NOT NULL,
    bought_at  INTEGER NOT NULL,
    PRIMARY KEY (company_id, extra_id)
  );
`);
```

`stmt` (bei den Firmen-Statements):

```js
  setCompanyStufe: db.prepare('UPDATE companies SET stufe = ? WHERE id = ?'),
  companyExtras: db.prepare('SELECT extra_id FROM company_extras WHERE company_id = ? ORDER BY bought_at, extra_id'),
  addCompanyExtra: db.prepare('INSERT INTO company_extras (company_id, extra_id, bought_at) VALUES (?, ?, ?)'),
  deleteCompanyExtra: db.prepare('DELETE FROM company_extras WHERE company_id = ? AND extra_id = ?'),
  deleteExtrasOfCompany: db.prepare('DELETE FROM company_extras WHERE company_id = ?'),
```

Funktionen (bei den Firmen-Funktionen):

```js
function setCompanyStufe(id, stufe) { stmt.setCompanyStufe.run(Math.round(stufe), Number(id)); }
function companyExtras(companyId) { return stmt.companyExtras.all(Number(companyId)).map((r) => r.extra_id); }
function addCompanyExtra(companyId, extraId, now = Date.now()) {
  stmt.addCompanyExtra.run(Number(companyId), String(extraId), now);
}
function deleteCompanyExtra(companyId, extraId) { stmt.deleteCompanyExtra.run(Number(companyId), String(extraId)); }
function deleteExtrasOfCompany(companyId) { stmt.deleteExtrasOfCompany.run(Number(companyId)); }
```

`clearCompanies` löscht zusätzlich `deleteExtrasOfCompany` je Firma. Exporte: `setCompanyStufe, companyExtras, addCompanyExtra, deleteCompanyExtra, deleteExtrasOfCompany,`.

- [ ] **Step 4: `upgrade`, `buyExtra`, Aufräumen in `company.js`**

In `closeCompany` nach `db.deleteStaffOfCompany(c.id);` einfügen: `db.deleteExtrasOfCompany(c.id);`.

Vor `module.exports` einfügen:

```js
// ------------------------------------------------------------------ Ausbau

/**
 * Bezahlt eine Investition vom Konto des Inhabers (Bargeld, notfalls Bank) –
 * eine Buchung, ohne XP: Investition ist keine Ausgabe fürs Level, sonst
 * wäre Kaufen die nächste XP-Schleife (siehe deposit/withdraw).
 * Gibt `{ ok, balance }` oder `{ ok: false, reason: 'funds'|'payment', … }`.
 */
async function pay(guildId, userId, price, reason) {
  const balance = await getBalance(guildId, userId);
  if (balance.total < price) return { ok: false, reason: 'funds', needed: price, have: balance.total };
  try {
    if (balance.cash < price) await unb.withdrawFromBank(guildId, userId, price - balance.cash, reason);
    const after = await changeCash(guildId, userId, -price, reason, { xp: false, kind: 'company' });
    return { ok: true, balance: after };
  } catch (err) {
    return { ok: false, reason: 'payment', error: err.message };
  }
}

/** Die nächste Stufe der Leiter kaufen. Stufe zuerst (§7), dann buchen; bei Fehler zurück. */
async function upgrade(guildId, userId, now = Date.now()) {
  const ctx = fresh(guildId, userId, now);
  if (!ctx) return { ok: false, reason: 'no_company' };
  const { company: c, branch: b } = ctx;
  const st = nextStufe(c, b);
  if (!st) return { ok: false, reason: 'max' };
  const balance = await getBalance(guildId, userId);
  if (balance.total < st.price) return { ok: false, reason: 'funds', needed: st.price, have: balance.total, stufe: st };

  db.setCompanyStufe(c.id, st.id);
  const paid = await pay(guildId, userId, st.price, `Ausbau: ${c.name} – ${st.name}`);
  if (!paid.ok) {
    db.setCompanyStufe(c.id, c.stufe);
    return { ok: false, reason: paid.reason, error: paid.error, stufe: st };
  }
  return { ok: true, stufe: st, price: st.price, balance: paid.balance };
}

/** Ein Extra kaufen – jedes genau einmal, manche erst ab einer Stufe. */
async function buyExtra(guildId, userId, extraId, now = Date.now()) {
  const ctx = fresh(guildId, userId, now);
  if (!ctx) return { ok: false, reason: 'no_company' };
  const { company: c, branch: b } = ctx;
  const e = b.extras.find((x) => x.id === String(extraId));
  if (!e) return { ok: false, reason: 'unknown' };
  if (db.companyExtras(c.id).includes(e.id)) return { ok: false, reason: 'owned', extra: e };
  if (c.stufe < e.minStufe) return { ok: false, reason: 'stufe', extra: e, minStufe: e.minStufe };
  const balance = await getBalance(guildId, userId);
  if (balance.total < e.price) return { ok: false, reason: 'funds', needed: e.price, have: balance.total, extra: e };

  db.addCompanyExtra(c.id, e.id, now);
  const paid = await pay(guildId, userId, e.price, `Ausbau: ${c.name} – ${e.name}`);
  if (!paid.ok) {
    db.deleteCompanyExtra(c.id, e.id);
    return { ok: false, reason: paid.reason, error: paid.error, extra: e };
  }
  return { ok: true, extra: e, price: e.price, balance: paid.balance };
}
```

Hinweis: `pay` prüft das Guthaben ein zweites Mal – die erste Prüfung in `upgrade`/`buyExtra` liefert dem Aufrufer `needed/have` **vor** dem Schreiben, die zweite in `pay` ist der Schutz, falls sich das Guthaben zwischen den Aufrufen geändert hat (dann Rollback über `payment`… nein: `pay` gibt `funds` zurück, der Aufrufer rollt ebenfalls zurück – der Code oben behandelt beides über `paid.ok`). Exporte: `upgrade, buyExtra,`.

- [ ] **Step 5: Handrechnung Guthaben-Test**

Kiosk-Test: `funds(W, 0, 30_000)`, Gründung 25.000 → bank 5.000; Stufe 1 kostet 25.000 × 1,5 = 37.500 → `needed 37.500, have 5.000` ✓. Spedition-Test: Start 100.000 Bar + 60 Mio Bank; Gründung 1,2 Mio (1,1 Mio von der Bank) → cash 0, bank 58.900.000; Stufe 1 1,8 Mio von der Bank → 57.100.000 = `60.000.000 − 1.200.000 + 100.000 − 1.800.000` ✓.

```bash
rm -rf .testdata && DATA_DIR=.testdata node test/company.test.js 2>&1 | tail -1
```

- [ ] **Step 6: Commit**

```bash
git add src/db.js src/company.js test/company.test.js
git commit -m "$(printf 'firmen: stufe und extras kaufen – vom konto, ohne xp, mit rollback\n\nCo-Authored-By: Claude Opus 5 <noreply@anthropic.com>')"
```

---

### Task 3: Der Betrieb rechnet mit dem Ausbau

**Files:**
- Modify: `src/company.js` (`hireNpc`, `dailyTarget`, `settle`, `openings`, `join`, `workShift`, `pitchIn`, `status`)
- Test: `test/company.test.js`

**Interfaces:**
- Consumes: `effectiveOf`, `ceilingOf(b, stufe, extraIds)`, `fullCeilingOf`, `nextStufe` (Task 1), `db.companyExtras` (Task 2).
- Produces: `dailyTarget(b, staffCount, werbungActive, slots = b.slots)`; `status()` zusätzlich `stufe`, `stufen: [{ …stufe, owned }]`, `extras: [{ …extra, owned, locked }]`, `effective`, `ceilingNow`, `ceilingMax`, `nextStufe`; `ceiling` bleibt (= `ceilingNow`, Rückwärtskompatibilität für die Ansicht).

- [ ] **Step 1: Tests schreiben**

```js
  console.log('--- Ausbau wirkt im Betrieb ---');
  {
    const U = user(); funds(U, 0, 5_000_000);
    const f = await company.found(G, U, 'cafe', 'Wachsendes Café', t0);
    const cid = f.company.id;
    const b = company.branch('cafe');
    for (let i = 0; i < 5; i++) company.hireNpc(G, U, t0, seq(0.1 * i));
    check('Kern: 5 Plätze voll', company.hireNpc(G, U, t0).reason === 'full');
    await company.upgrade(G, U, t0);                     // Terrasse: 6 Plätze, ×1,2
    check('Stufe 1: ein Platz mehr', company.hireNpc(G, U, t0, seq(0.7)).ok === true
      && company.hireNpc(G, U, t0).reason === 'full');
    check('openings zeigt keinen Platz mehr', !company.openings(G).some((o) => o.company.id === cid));

    // Ein Tag Abrechnung, Handrechnung mit Faktor 1,2 und 6 Aushilfen:
    // Ziel = 0,3 + 0,5 × 6/6 = 0,8 → a = 0,3 + 0,5 × 0,2 = 0,4;
    // Umsatz je Schicht = round(900 × 1 × 0,4 × 1,2) = 432; Lohn 180 → 6 × 3 × 252 = 4.536.
    const r = company.settle(cid, t0 + DAY_MS);
    check('settle rechnet mit dem Umsatzfaktor (Kasse 4.536)', db.getCompany(cid).kasse === 4_536, de(db.getCompany(cid).kasse));
    check('Auslastungsziel nutzt die neuen Plätze', Math.abs(company.dailyTarget(b, 6, false, 6) - 0.8) < 1e-9
      && Math.abs(company.dailyTarget(b, 5, false, 6) - (0.3 + 0.5 * 5 / 6)) < 1e-9);

    // Anpacken: round(900 × 1,5 × a × 1,2) mit a = 0,4 → 648.
    const p = await company.pitchIn(G, U, t0 + DAY_MS);
    check('Anpacken nutzt den Faktor (648)', p.ok && p.umsatz === 648, String(p.umsatz));

    // Spieler-Schicht: Umsatz round(900 × 1 × 0,4 × 1,3 × 1,2) = 562.
    const P = user(); funds(P, 0);
    company.fire(G, U, db.companyStaff(cid)[0].id, t0 + DAY_MS);
    company.join(G, P, cid, t0 + DAY_MS);
    const jobs = require('../src/jobs');
    const w = await jobs.work(G, P, new Date(t0 + DAY_MS + 1000), seq(0.5));
    check('Spieler-Schicht nutzt den Faktor (562)', w.ok && w.umsatz === 562, String(w.umsatz));

    // Extra mit Plätzen: +2 ab Stufe 2.
    await company.upgrade(G, U, t0 + DAY_MS);
    await company.buyExtra(G, U, b.extras[3].id, t0 + DAY_MS);
    const s = company.status(G, U, t0 + DAY_MS);
    check('status: Stufe 2, 7 + 2 = 9 Plätze, Faktor 1,45', s.stufe === 2 && s.effective.slots === 9
      && Math.abs(s.effective.umsatzFactor - 1.45) < 1e-9, JSON.stringify(s.effective));
    check('status: Extras mit owned/locked', s.extras.length === 4 && s.extras[3].owned === true
      && s.extras[2].locked === true && s.extras[0].locked === false);
    check('status: Stufenliste mit owned', s.stufen.length === 5 && s.stufen[1].owned && !s.stufen[2].owned);
    check('status: nextStufe = Frühstückskarte', s.nextStufe?.name === 'Frühstückskarte');
    check('status: ceilingNow < ceilingMax, ceiling = ceilingNow',
      s.ceilingNow.net < s.ceilingMax.net && s.ceiling.net === s.ceilingNow.net
      && s.ceilingMax.net === company.fullCeilingOf(b).net);
    check('status: free zählt die neuen Plätze', s.free === 9 - s.staff.length);
  }
```

- [ ] **Step 2: Scheitern prüfen**

```bash
rm -rf .testdata && DATA_DIR=.testdata node test/company.test.js 2>&1 | grep -m2 "❌"
```

Erwartet: „Stufe 1: ein Platz mehr" ❌ (heute zählt `hireNpc` `b.slots`).

- [ ] **Step 3: Effektive Werte einziehen**

In `src/company.js`:

`hireNpc`: nach `if (!ctx) …`:

```js
  const eff = effectiveOf(ctx.company, ctx.branch);
  if (ctx.staff.length >= eff.slots) return { ok: false, reason: 'full' };
  …
  return { ok: true, staff, free: eff.slots - ctx.staff.length - 1 };
```

`dailyTarget`:

```js
function dailyTarget(b, staffCount, werbungActive, slots = b.slots) {
  const ziel = data.AUSLASTUNG_MIN + data.AUSLASTUNG_STAFF * Math.min(1, staffCount / slots)
    + (werbungActive ? data.WERBUNG_BOOST : 0);
  return Math.min(1, ziel);
}
```

`settle`: nach `const b = branch(c.branch);` einfügen `const eff = effectiveOf(c, b);`, dann `dailyTarget(b, staff.length, c.werbung_until >= tag, eff.slots)` und `const umsatz = Math.round(b.umsatz * f * auslastung * eff.umsatzFactor);`.

`openings`: `const eff = effectiveOf(c, b); const free = eff.slots - db.companyStaff(c.id).length;` und zusätzlich `stufe: c.stufe` im Ergebnis.

`join`: `if (db.companyStaff(c.id).length >= effectiveOf(c, b).slots) return { ok: false, reason: 'full' };`

`workShift`: `const eff = effectiveOf(c, b);` und `const umsatz = Math.round(b.umsatz * f * c.auslastung * data.PLAYER_BONUS * eff.umsatzFactor);`

`pitchIn`: `const eff = effectiveOf(c, b);` und `const umsatz = Math.round(b.umsatz * rankOf(…).factor * c.auslastung * eff.umsatzFactor);`

`status`: nach `const { company: c, branch: b, staff } = ctx;`:

```js
  const extraIds = db.companyExtras(c.id);
  const eff = effectiveOf(c, b, extraIds);
  const ceilingNow = ceilingOf(b, c.stufe, extraIds);
```

`forecast` mit `eff.umsatzFactor` multiplizieren (`Math.round(b.umsatz * f * c.auslastung * eff.umsatzFactor)`); im Rückgabeobjekt `free: eff.slots - staff.length`, `ceiling: ceilingNow, ceilingNow, ceilingMax: fullCeilingOf(b), effective: eff, stufe: c.stufe, nextStufe: nextStufe(c, b), stufen: b.stufen.map((st) => ({ ...st, owned: st.id <= c.stufe })), extras: b.extras.map((e) => ({ ...e, owned: extraIds.includes(e.id), locked: c.stufe < e.minStufe })),`.

`fire` hat seit dem Review-Fix ein `now`; `hireNpc` ebenso über `fresh` – unverändert lassen, nur `eff` einziehen.

- [ ] **Step 4: Handrechnung, dann Tests**

Café Stufe 1, 6 Aushilfen, Tag 1: Ziel 0,8, a = 0,4; Umsatz `round(900 × 0,4 × 1,2) = 432`; je NPC 3 × (432 − 180) = 756; × 6 = 4.536 ✓. Anpacken `round(900 × 1,5 × 0,4 × 1,2) = round(648) = 648` ✓. Spieler `round(900 × 0,4 × 1,3 × 1,2) = round(561,6) = 562` ✓ (Auslastung ist nach dem Tag 0,4 – `workShift` liest `c.auslastung` nach `settle`, das bei `t0 + DAY_MS + 1000` keinen weiteren Tag findet).

```bash
rm -rf .testdata && DATA_DIR=.testdata node test/company.test.js 2>&1 | tail -1; DATA_DIR=.testdata node test/jobs.test.js 2>&1 | tail -1; npm test 2>&1 | grep -c '❌'
```

Erwartet: alles grün, `0`. Die Kern-Handrechnungen (Rechenkiosk 5 Tage, Minuskiosk −57/−69/−45, Bohne 180/351/225, Chefsache 405/648…) bleiben exakt – Stufe 0, Faktor 1.

- [ ] **Step 5: Commit**

```bash
git add src/company.js test/company.test.js
git commit -m "$(printf 'firmen: plaetze und umsatz je schicht kommen aus stufe und extras\n\nCo-Authored-By: Claude Opus 5 <noreply@anthropic.com>')"
```

---

### Task 4: Ansichten und Handler

**Files:**
- Modify: `src/ui.js` (`buildFirmaFoundView`, `buildFirmaView`; neu `buildFirmaAusbauView`; Exporte), `src/buttons.js` (`firma`-Handler)
- Test: `test/menu.test.js` läuft unverändert.

**Interfaces:**
- Consumes: `company.status()` mit `stufe/stufen/extras/effective/ceilingNow/ceilingMax/nextStufe`, `company.upgrade`, `company.buyExtra`, `company.BRANCHES[].klasse`, `company.CONFIRM_ABOVE`, `company.fullCeilingOf`.
- Produces: `buildFirmaFoundView({ guildId, userId, klasse = 'klein' })`, `buildFirmaAusbauView({ guildId, userId })`; Button-IDs `firma|gruendung|<klasse>|<userId>`, `firma|ausbau|0|<userId>`, `firma|ausbauen|<0|ja>|<userId>`, `firma|extra|<extraId>|<userId>`.

- [ ] **Step 1: Gründungsansicht mit Klassen**

`buildFirmaFoundView` ersetzen:

```js
const KLASSEN = [
  { id: 'klein', label: 'Klein', emoji: '🏪', blurb: 'Einstieg – billig, wenig Plätze, schneller Ertrag' },
  { id: 'mittel', label: 'Mittel', emoji: '☕', blurb: 'braucht Personal und Pflege' },
  { id: 'gross', label: 'Groß', emoji: '🚚', blurb: 'nur mit voller Mannschaft rentabel – ausgebaut die Spitze' },
];

/** Ohne Firma: die neun Branchen zur Wahl, je Klasse eine Seite. */
async function buildFirmaFoundView({ guildId, userId, klasse = 'klein' }) {
  const company = require('./company');
  const symbol = await getSymbol(guildId);
  const k = KLASSEN.find((x) => x.id === klasse) ?? KLASSEN[0];
  const branches = company.BRANCHES.filter((b) => b.klasse === k.id);

  const embed = new EmbedBuilder()
    .setTitle('🏢 Eine Firma gründen')
    .setColor(0x34495e)
    .setDescription(
      'Deine eigene Firma: Personal einstellen, Kasse im Plus halten, Gewinn entnehmen – und '
      + 'mit dem Gewinn **ausbauen**. NPCs kosten jeden Tag Lohn, Spieler nur für gearbeitete '
      + 'Schichten. Läuft die Kasse **14 Tage** im Minus, ist die Firma insolvent.\n\n'
      + `**${k.emoji} ${k.label}** – _${k.blurb}_`);

  const last = company.lastClosed(guildId, userId);
  if (last && last.closed_why === 'insolvent') {
    embed.addFields({
      name: `⚠️ ${last.name} ist insolvent`,
      value: `Die Kasse war 14 Tage im Minus. Personal, Ausbau und Gründung sind weg – du kannst neu `
        + `gründen. _(${new Date(last.closed_at).toLocaleDateString('de-DE')})_`,
    });
  }
  for (const b of branches) {
    const kern = company.ceilingOf(b);
    const voll = company.fullCeilingOf(b);
    embed.addFields({
      name: `${b.emoji} ${b.name} – ${money(symbol, b.price)}`,
      value: `_${b.blurb}_\n**${b.slots}** Plätze · Umsatz **${money(symbol, b.umsatz)}** / Lohn `
        + `**${money(symbol, b.lohn)}** je Schicht\nDecke ~**${money(symbol, kern.net)}** am Tag, `
        + `ausgebaut bis ~**${money(symbol, voll.net)}** (${voll.slots} Plätze)`,
    });
  }
  return {
    embeds: [embed],
    components: [
      // Fluxer bildet Buttons in Zeilenreihenfolge auf Reaktionen ab – die
      // Klassenwahl zuerst, damit sie nie hinten runterfällt.
      new ActionRowBuilder().addComponents(
        ...KLASSEN.map((x) => new ButtonBuilder().setCustomId(`firma|gruendung|${x.id}|${userId}`)
          .setLabel(x.label).setEmoji(x.emoji)
          .setStyle(x.id === k.id ? ButtonStyle.Primary : ButtonStyle.Secondary)
          .setDisabled(x.id === k.id)),
        homeButton(userId)),
      new ActionRowBuilder().addComponents(...branches.map((b) =>
        new ButtonBuilder().setCustomId(`firma|gruenden|${b.id}|${userId}`)
          .setLabel(b.name).setEmoji(b.emoji).setStyle(ButtonStyle.Success))),
    ],
  };
}
```

- [ ] **Step 2: Betriebsansicht: Ausbau-Zeile, Footer, Button**

In `buildFirmaView` nach dem Feld „⏳ Heute" einfügen:

```js
  embed.addFields({
    name: '🏗️ Ausbau',
    value: `Stufe **${s.stufe}/${company.MAX_STUFE}**`
      + (s.stufe > 0 ? ` _(${s.stufen[s.stufe - 1].name})_` : '')
      + ` · **${s.extras.filter((e) => e.owned).length}** von ${s.extras.length} Extras · `
      + `${s.effective.slots} Plätze, Umsatz ×${s.effective.umsatzFactor}`
      + (s.nextStufe ? `\nNächste Stufe: **${s.nextStufe.name}** für ${money(symbol, s.nextStufe.price)}` : '\n_Voll ausgebaut._'),
  });
```

Footer ersetzen: `` embed.setFooter({ text: `Decke jetzt ~${money(symbol, s.ceilingNow.net)} am Tag · voll ausgebaut ~${money(symbol, s.ceilingMax.net)}` }); ``

Zweite Button-Zeile: zwischen „Personal" und „Schließen" einfügen

```js
      new ButtonBuilder().setCustomId(`firma|ausbau|0|${userId}`)
        .setLabel('Ausbau').setEmoji('🏗️').setStyle(ButtonStyle.Primary),
```

(Zeile hat dann Personal · Ausbau · Schließen · Home = 4.)

- [ ] **Step 3: Ausbau-Ansicht**

Nach `buildFirmaStaffView` einfügen:

```js
/** Ausbau: nächste Stufe und die vier Extras. */
async function buildFirmaAusbauView({ guildId, userId }) {
  const company = require('./company');
  const s = company.status(guildId, userId);
  if (!s) return buildFirmaFoundView({ guildId, userId });
  const symbol = await getSymbol(guildId);

  const embed = new EmbedBuilder()
    .setTitle(`🏗️ Ausbau – ${s.company.name}`)
    .setColor(0x34495e)
    .setDescription(`Stufe **${s.stufe}/${company.MAX_STUFE}** · ${s.effective.slots} Plätze · Umsatz ×${s.effective.umsatzFactor}\n`
      + `Decke jetzt ~**${money(symbol, s.ceilingNow.net)}** am Tag, voll ausgebaut ~**${money(symbol, s.ceilingMax.net)}**.\n`
      + '_Investitionen kommen von deinem Konto, nicht aus der Kasse – und sind nicht umkehrbar._');

  if (s.nextStufe) {
    const n = s.nextStufe;
    embed.addFields({
      name: `⬆️ Nächste Stufe: ${n.name} – ${money(symbol, n.price)}`,
      value: `→ **${n.slots}** Plätze, Umsatz **×${n.umsatz}**`
        + (n.price >= company.CONFIRM_ABOVE ? ' · _fragt vor dem Kauf nach_' : ''),
    });
  } else {
    embed.addFields({ name: '⬆️ Leiter', value: '_Voll ausgebaut – alle fünf Stufen gekauft._' });
  }
  for (const e of s.extras) {
    const wirkung = e.umsatz ? `Umsatz +${e.umsatz}` : `+${e.slots} Plätze`;
    const zustand = e.owned ? '✅ gekauft' : e.locked ? `🔒 ab Stufe ${e.minStufe}` : '🛒 kaufbar';
    embed.addFields({ name: `${e.emoji} ${e.name} – ${money(symbol, e.price)}`, value: `${wirkung} · ${zustand}`, inline: true });
  }

  return {
    embeds: [embed],
    components: [
      // Nav zuerst (Fluxer-Reaktionen), dann die Extras.
      new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId(`firma|ausbauen|0|${userId}`)
          .setLabel(s.nextStufe ? `Ausbauen: ${s.nextStufe.name}`.slice(0, 40) : 'Voll ausgebaut')
          .setEmoji('⬆️').setStyle(ButtonStyle.Success).setDisabled(!s.nextStufe),
        new ButtonBuilder().setCustomId(ID.menu('firma', 1, userId)).setLabel('Firma')
          .setEmoji('🏢').setStyle(ButtonStyle.Secondary),
        homeButton(userId)),
      new ActionRowBuilder().addComponents(...s.extras.map((e) =>
        new ButtonBuilder().setCustomId(`firma|extra|${e.id}|${userId}`)
          .setLabel(e.name.slice(0, 40)).setEmoji(e.emoji)
          .setStyle(e.owned ? ButtonStyle.Secondary : ButtonStyle.Primary)
          .setDisabled(e.owned || e.locked))),
    ],
  };
}
```

Export `buildFirmaAusbauView` ergänzen.

- [ ] **Step 4: Handler**

In `buttons.firma` vor `await interaction.deferUpdate();` (bei den Modal-Zweigen) nichts ändern; **nach** `deferUpdate` neue Zweige ergänzen (vor `else if (aktion === 'personal')`):

```js
    } else if (aktion === 'gruendung') {
      return interaction.editReply(await buildFirmaFoundView({ guildId, userId, klasse: arg }));
    } else if (aktion === 'ausbau') {
      return interaction.editReply(await buildFirmaAusbauView({ guildId, userId }));
    } else if (aktion === 'ausbauen') {
      const s = company.status(guildId, userId);
      const n = s?.nextStufe;
      if (n && n.price >= company.CONFIRM_ABOVE && arg !== 'ja') {
        return interaction.editReply({
          embeds: [new EmbedBuilder().setTitle(`⬆️ ${n.name} für ${money(symbol, n.price)}?`).setColor(0xf39c12)
            .setDescription(`→ ${n.slots} Plätze, Umsatz ×${n.umsatz}. Vom Konto, nicht umkehrbar.`)],
          components: [new ActionRowBuilder().addComponents(
            new ButtonBuilder().setCustomId(`firma|ausbauen|ja|${userId}`).setLabel('Ja, ausbauen')
              .setEmoji('⬆️').setStyle(ButtonStyle.Success),
            new ButtonBuilder().setCustomId(`firma|ausbau|0|${userId}`).setLabel('Abbrechen')
              .setStyle(ButtonStyle.Secondary),
            homeButton(userId))],
        });
      }
      const r = await company.upgrade(guildId, userId);
      note = r.ok ? `⬆️ **${r.stufe.name}** gebaut (${money(symbol, r.price)}) – ${r.stufe.slots} Plätze, Umsatz ×${r.stufe.umsatz}.`
        : { no_company: '🏢 Du hast keine Firma.', max: 'ℹ️ Voll ausgebaut.',
          funds: `💸 Dafür fehlen ${money(symbol, (r.needed ?? 0) - (r.have ?? 0))}.`,
          payment: '❌ Die Buchung ist fehlgeschlagen – nichts ist passiert.' }[r.reason] ?? '❌ Das ging nicht.';
      await interaction.editReply(await buildFirmaAusbauView({ guildId, userId }));
      if (note) await interaction.followUp({ content: note, flags: MessageFlags.Ephemeral }).catch(() => {});
      return;
    } else if (aktion === 'extra') {
      const r = await company.buyExtra(guildId, userId, arg);
      note = r.ok ? `${r.extra.emoji} **${r.extra.name}** gekauft (${money(symbol, r.price)}).`
        : { no_company: '🏢 Du hast keine Firma.', unknown: '❌ Dieses Extra gibt es hier nicht.',
          owned: 'ℹ️ Hast du schon.', stufe: `🔒 Erst ab Stufe ${r.minStufe}.`,
          funds: `💸 Dafür fehlen ${money(symbol, (r.needed ?? 0) - (r.have ?? 0))}.`,
          payment: '❌ Die Buchung ist fehlgeschlagen – nichts ist passiert.' }[r.reason] ?? '❌ Das ging nicht.';
      await interaction.editReply(await buildFirmaAusbauView({ guildId, userId }));
      if (note) await interaction.followUp({ content: note, flags: MessageFlags.Ephemeral }).catch(() => {});
      return;
```

`buildFirmaAusbauView` in den Import aus `./ui` aufnehmen. Im `fname`-Modal-Text: „Personal, Ausbau und Gründung" ist bereits in der Insolvenznotiz; der Gründungstext bleibt.

- [ ] **Step 5: Laden, Menü-Test, volle Kette**

```bash
node -e "require('./src/ui'); require('./src/buttons'); console.log('ok')" && rm -rf .testdata && DATA_DIR=.testdata node test/menu.test.js 2>&1 | tail -1 && npm test 2>&1 | grep -c '❌'
```

Erwartet: `ok`, `0 fehlgeschlagen`, `0`. Zusätzlich ein Render-Check gegen `.testdata`: Firma gründen, Stufe 2 kaufen, `buildFirmaAusbauView` und `buildFirmaView` rendern, `JSON.stringify` auf `undefined`/`NaN` durchsuchen.

- [ ] **Step 6: Commit**

```bash
git add src/ui.js src/buttons.js
git commit -m "$(printf 'firmen: gruendung nach klassen, ausbau-ansicht mit leiter und extras\n\nCo-Authored-By: Claude Opus 5 <noreply@anthropic.com>')"
```

---

### Task 5: §3-Test im Vollausbau, Messung, Werte ziehen, Patchnotes, §15

**Files:**
- Test: `test/company.test.js`
- Modify: `scripts/messung-geldquellen.js` (`firmenlauf` erweitern), `src/data/companies.js` (nur Faktoren, falls die Messung es verlangt), `src/data/patchnotes.js`, `ARCHITEKTUR.md`

- [ ] **Step 1: Test 9 – Vollausbau, kein Tag über der Decke**

```js
  console.log('--- §3: Vollausbau – kein Tag über der vollen Decke ---');
  {
    for (const b of data.BRANCHES) {
      const U = user(); funds(U, 0, 200_000_000);
      const f = await company.found(G, U, b.id, `Voll-${b.id}`, t0);
      for (let i = 0; i < data.MAX_STUFE; i++) {
        const r = await company.upgrade(G, U, t0);
        if (!r.ok) throw new Error(`${b.id} Stufe ${i + 1}: ${r.reason}`);
      }
      for (const e of b.extras) {
        const r = await company.buyExtra(G, U, e.id, t0);
        if (!r.ok) throw new Error(`${b.id} Extra ${e.id}: ${r.reason}`);
      }
      const eff = company.effectiveOf(company.ownCompany(G, U), b);
      for (let i = 0; i < eff.slots; i++) {
        const r = company.hireNpc(G, U, t0, seq(0.02 * i));
        if (!r.ok) throw new Error(`${b.id} NPC ${i + 1}: ${r.reason}`);
      }
      const cid = f.company.id;
      for (const s of db.companyStaff(cid)) db.saveStaff({ ...s, rank: 2 });
      const decke = company.fullCeilingOf(b).net;
      let best = -Infinity, gewinn = [], werbungLief = false;
      let now = t0;
      for (let d = 0; d < 365; d++) {
        const vor = db.getCompany(cid).kasse;
        const w = await company.advertise(G, U, now);
        if (w.ok) werbungLief = true;
        if (!(w.ok || w.reason === 'running' || (w.reason === 'kasse' && !werbungLief))) throw new Error(`${b.id} Werbung Tag ${d + 1}: ${w.reason}`);
        for (let i = 0; i < data.MAX_PITCH_PER_DAY; i++) { const p = await company.pitchIn(G, U, now + i * 60e3); if (!p.ok) break; }
        company.settle(cid, now + DAY_MS);
        const tag = db.getCompany(cid).kasse - vor;
        best = Math.max(best, tag); gewinn.push(tag);
        now += DAY_MS;
      }
      const sorted = [...gewinn].sort((a, c) => a - c);
      const median = sorted[Math.floor(sorted.length / 2)];
      console.log(`    ${b.emoji} ${b.name} voll: Median ${de(median)}/Tag · bester Tag ${de(best)} · Decke ${de(decke)}`);
      check(`${b.name} voll: kein Tag über der Decke`, best <= decke + 1, `${de(best)} > ${de(decke)}`);
      check(`${b.name} voll: verdient (keine stille Null)`, median > company.ceilingOf(b).net, `${de(median)} vs Kern ${de(company.ceilingOf(b).net)}`);
    }
  }
```

(`decke + 1` wegen der Rundung je Schicht – die Decke rechnet ungerundet.)

- [ ] **Step 2: Test laufen lassen, die neun Zeilen notieren**

```bash
rm -rf .testdata && DATA_DIR=.testdata node test/company.test.js 2>&1 | grep -A20 "Vollausbau"
```

Erwartung Spedition (Handrechnung, Werbung durchgehend, Auslastung → 1,0, 3 Anpacken von 4 wegen Zeitbudget): 22 × 3 × (round(1.900 × 1,5 × 2,65) − 630) + 3 × round(1.900 × 1,5 × 2,65) = 66 × (7.553 − 630) + 3 × 7.553 = 456.918 + 22.659 = **479.577**, minus Werbung 60.000 alle 3 Tage (−20.000/Tag) → Median um **~460.000**. Die Decke rechnet mit 4 Anpacken und ohne Werbungskosten: 487.095. Wörtlich in den Bericht.

- [ ] **Step 3: Messskript – Kapitalist und Aufsteiger**

`firmenlauf(branchId, tage, { ausbau = 'keiner' } = {})` mit `ausbau ∈ { 'keiner', 'kapitalist', 'aufsteiger' }`:

- `'kapitalist'`: Startguthaben `konto`-Fake unverändert (500 Mio für alle – die Gründung und der Ausbau werden davon bezahlt; das Skript zählt nur Entnahmen, nicht das Startguthaben). Am Tag 0 nach der Gründung: alle fünf Stufen und alle vier Extras kaufen, dann NPCs bis `effectiveOf(...).slots`. Rest wie heute.
- `'aufsteiger'`: **eigene Guthabenlogik** – `unb.getBalance` liefert für diesen Nutzer `konto[U]` (die Summe der Entnahmen abzüglich Ausbaukäufe), nicht 500 Mio. Dafür im Skript vor dem Lauf `getBalance` für `U` umbiegen: `unb.getBalance = async (g, u) => (u === U ? { cash: konto[u] ?? 0, bank: 0, total: konto[u] ?? 0 } : alt(g, u))` und danach zurücksetzen. Gründung bezahlt der Aufsteiger **nicht** (Startpunkt: gegründete Firma mit Kern-Besetzung – der Weg *ab* der Gründung ist die Frage). Täglich nach der Entnahme: solange `nextStufe` bezahlbar ist → `upgrade`; sonst billigstes noch nicht gekauftes, freigeschaltetes Extra, wenn bezahlbar → `buyExtra`; danach NPCs nachstellen bis `effectiveOf(...).slots` (neue NPCs beginnen als Aushilfe, ab Tag 30 wird alles befördert – die bestehende Schleife verallgemeinern: jeden Tag alle unter Schichtleiter befördern, sobald `d >= 30`). Ausgabe zusätzlich `stufe5Tag` (erster Tag mit Stufe 5) und `vollTag` (erster Tag mit Stufe 5 + 4 Extras).

Im Hauptlauf hinter dem Kern-Block:

```js
  console.log('\n--- Firmen voll ausgebaut (Kapitalist: alles am Tag 1) ---\n');
  for (const br of companyData.BRANCHES) {
    const r = await firmenlauf(br.id, TAGE, { ausbau: 'kapitalist' });
    console.log(`  ${(br.emoji + ' ' + br.name).padEnd(16)}${de(r.median).padStart(9)}/Tag   ` +
      `Decke ${de(r.decke)}   Amortisation des Ausbaus ${r.amortTage === null ? `nicht in ${TAGE}` : r.amortTage} Tage`);
  }
  console.log('\n--- Firmen aus eigener Kraft (Aufsteiger: nur aus Gewinn) ---\n');
  for (const br of companyData.BRANCHES) {
    const r = await firmenlauf(br.id, TAGE, { ausbau: 'aufsteiger' });
    console.log(`  ${(br.emoji + ' ' + br.name).padEnd(16)}Stufe 5 an Tag ${r.stufe5Tag ?? '–'} · voll an Tag ${r.vollTag ?? '–'} · ` +
      `Ertrag am Ende ${de(r.endeProTag)}/Tag`);
  }
```

`amortTage` beim Kapitalisten: erster Tag, an dem die Summe der Entnahmen den **Gesamtausbau + Gründung** übersteigt. `endeProTag` beim Aufsteiger: Median der letzten 30 Tage. `decke` beim Kapitalisten = `fullCeilingOf(b).net`.

- [ ] **Step 4: Messen, Werte ziehen**

```bash
node scripts/messung-geldquellen.js 10 365 2>&1 | grep -A11 "voll ausgebaut"; node scripts/messung-geldquellen.js 10 365 2>&1 | grep -A11 "eigener Kraft"; node scripts/messung-geldquellen.js 10 365 2>&1 | grep "Musik+Creator "
```

(Drei Läufe kosten Zeit; alternativ einmal laufen lassen und die ganze Ausgabe in eine Datei im Scratchpad schreiben.)

Zielmarken (Spec): Spedition voll **~500.000/Tag**; alle Branchen voll ≈ ×6 ihres Kernwerts; Amortisation des Gesamtausbaus **60–120 Tage**. Liegt eine Branche mehr als 25 % daneben, werden **nur die Stufenfaktoren dieser Branche** angepasst – dafür bekommt `leiter()` einen optionalen vierten Parameter `faktoren` (Standard `STUFE_FAKTOREN`), und der Test „Umsatzfaktoren 1,2…2,2" wird für diese Branche auf ihre Faktoren geändert. Kern-`umsatz` bleibt unangetastet (sonst verschiebt sich Stück 1). **Alle gemessenen Zahlen wörtlich in den Bericht**, inklusive Aufsteiger-Tage.

- [ ] **Step 5: Patchnotes und §15**

`src/data/patchnotes.js`, oben:

```js
  {
    version: '1.32.0',
    date: '2026-09-13',
    title: '🏗️ Firmen: Ausbau und neun Branchen',
    lines: [
      '🏢 **Sechs neue Branchen.** Imbiss, Autowäsche, Fitnessstudio, Werkstatt, Baufirma und Club – drei Klassen, drei Preisstufen, je eine Seite in der Gründungsansicht.',
      '🏗️ **Ausbau.** Jede Firma hat fünf Ausbaustufen (mehr Plätze, mehr Umsatz je Schicht) und vier Extras. Bezahlt wird vom Konto, nicht aus der Kasse – und nichts davon ist umkehrbar. Eine Spedition voll auszubauen kostet rund 50 Mio.',
      '💰 **Die Spitze.** Voll ausgebaut verdient eine Spedition rund eine halbe Million am Tag – so viel wie Musik+Creator nach zwei Jahren. Wer das Musikgeld in die Firma steckt, hat die Königsdisziplin mit Firma.',
      '📏 Gemessen, nicht geschätzt: Wer nur aus dem Gewinn ausbaut, braucht <TAGE> Tage bis zur vollen Spedition.',
    ],
  },
```

`<TAGE>` aus der Aufsteiger-Messung. `ARCHITEKTUR.md` §15, nach dem Firmen-Absatz:

```markdown
**Ausbau (seit 1.32.0, Stück 2a):** Fünf Stufen und vier Extras je Branche
heben Plätze und Umsatz je Schicht; Löhne skalieren nicht, die Marge wächst
mit der Größe. Volle Decke (`company.fullCeilingOf`): Spedition 487.095/Tag,
Café 133.380, Kiosk 16.631. Gemessen voll ausgebaut (365 Tage, Median):
<Werte>. Aus eigener Kraft (nur Gewinn reinvestiert) ist die Spedition nach
<Tage> Tagen voll. Damit ist die Firma nach zwei Jahren gleichauf mit
Musik+Creator – die Königsdisziplin *mit* Firma, aber erkauft: ~50 Mio
Ausbau. Investitionen buchen ohne XP (Umbuchung, keine Ausgabe).
```

Platzhalter mit den Messwerten füllen.

- [ ] **Step 6: Volle Kette, Commit**

```bash
npm test 2>&1 | grep -c '❌'; npm test 2>&1 | tail -2
```

```bash
git add test/company.test.js scripts/messung-geldquellen.js src/data/companies.js src/data/patchnotes.js ARCHITEKTUR.md
git commit -m "$(printf 'firmen: vollausbau gemessen, aufsteiger-lauf, patchnotes 1.32.0\n\nSpedition voll: <ZAHL>/Tag (Decke 487.095); Aufsteiger voll an Tag <TAG>.\n\nCo-Authored-By: Claude Opus 5 <noreply@anthropic.com>')"
```

---

## Selbstprüfung des Plans

**Spec-Abdeckung:** Katalog neun Branchen, Leiter, Extras, `effectiveOf`, Decke → Task 1; Migration `stufe`, `company_extras`, `upgrade`/`buyExtra` mit Rollback, Extras bei Schließen/Insolvenz weg → Task 2; effektive Werte in `hireNpc/join/openings/dailyTarget/settle/workShift/pitchIn/status`, Bestand unverändert (Stufe 0) → Task 3; Gründung nach Klassen (Fluxer-Reaktionen), Betriebsansicht-Zeile/-Footer/-Button, Ausbau-Ansicht, Rückfrage ab `CONFIRM_ABOVE` → Task 4; §3-Vollausbau-Test, Kapitalist/Aufsteiger, Werte ziehen, Patchnotes, §15 → Task 5. Tests 1–3 (T1), 4/5/7/10 (T2), 6/8 (T3), 9 (T5).

**Namen quer über die Tasks:** `effectiveOf(company, b, extraIds)`, `ceilingOf(b, stufe, extraIds)`, `fullCeilingOf(b)`, `nextStufe(company, b)` (T1 → T2–T5); `db.companyExtras/addCompanyExtra/deleteCompanyExtra/deleteExtrasOfCompany/setCompanyStufe` (T2 → T3, T5); `upgrade`, `buyExtra` mit Gründen `max/unknown/owned/stufe/funds/payment` (T2 → T4, T5); `status().stufe/stufen/extras/effective/ceilingNow/ceilingMax/nextStufe` (T3 → T4); `dailyTarget(b, staffCount, werbung, slots)` (T3, Test); `BRANCHES[].klasse`, `MAX_STUFE`, `CONFIRM_ABOVE`, `extraById` (T1 → T4); Button-IDs `firma|gruendung|<klasse>`, `firma|ausbau|0`, `firma|ausbauen|<0|ja>`, `firma|extra|<id>` (T4).
