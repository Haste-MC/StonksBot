// test/beef.test.js
/**
 * Beef 5b, Stück 1: Zahlen, Texte und die reinen Rechnungen.
 * Aufruf: DATA_DIR=.testdata node test/beef.test.js
 *
 * Alle Erwartungswerte sind von Hand nachgerechnet und gegen die Spec geprüft.
 * Wer sie nicht trifft, hat einen Fehler im Code – nicht im Test.
 */
const data = require('../src/data/beef');
const beef = require('../src/beef');

let pass = 0, fail = 0;
const check = (label, ok, extra = '') => {
  if (ok) { pass++; console.log(`  ✅ ${label}`); }
  else { fail++; console.log(`  ❌ ${label} ${extra}`); }
};
const nah = (a, b, eps = 1e-6) => Math.abs(a - b) < eps;

console.log('--- Einstieg ---');
// Einstieg, ohne Charakterzug (trait 'launisch' hat +0,15 – darum 'unbekannt'
// nehmen, das ergibt 0)
check('Einstieg auf Augenhöhe 55 %',
  nah(beef.einstiegOf({ meine: 1000, seine: 1000, trait: 'x' }), 0.55));
check('Einstieg gegen den Zehnfachen 30 %',
  nah(beef.einstiegOf({ meine: 1000, seine: 10_000, trait: 'x' }), 0.30));
check('Einstieg gegen den Hundertfachen 5 %',
  nah(beef.einstiegOf({ meine: 1000, seine: 100_000, trait: 'x' }), 0.05));
check('Einstieg gegen den Tausendfachen fällt auf die Untergrenze',
  nah(beef.einstiegOf({ meine: 1000, seine: 1_000_000, trait: 'x' }), 0.02));
check('Einstieg gegen den Zehntel-Großen 80 %',
  nah(beef.einstiegOf({ meine: 1000, seine: 100, trait: 'x' }), 0.80));
check('Einstieg gegen den Hundertstel-Großen an der Obergrenze',
  nah(beef.einstiegOf({ meine: 1000, seine: 10, trait: 'x' }), 0.95));

console.log('--- Charakter ---');
check('Der Geschäftsmann steigt auf Augenhöhe ein', nah(beef.traitBonus('geschaeftlich', 1000, 1000), 0.10));
check('Der Geschäftsmann winkt beim Winzling ab', nah(beef.traitBonus('geschaeftlich', 10, 1000), -0.098));
check('Der Kollegiale mag nicht', nah(beef.traitBonus('kollegial', 1000, 1000), -0.25));
check('Ein unbekannter Zug zählt nicht mit', nah(beef.traitBonus('x', 1000, 1000), 0));

console.log('--- Wucht und Aufmerksamkeit ---');
check('Wucht auf Augenhöhe', nah(beef.wuchtOf({ seine: 1000, meine: 1000 }), 0.100343, 1e-6));
check('Wucht gegen den Tausendfachen ist gedeckelt', nah(beef.wuchtOf({ seine: 1_000_000, meine: 1000 }), 1));
check('Genrefaktor Hip-Hop ist 1', nah(beef.genrefaktorOf(1.3), 1));
check('Genrefaktor Klassik', nah(beef.genrefaktorOf(0.5), 0.384615, 1e-5));
check('Aufmerksamkeit: Riese, Hip-Hop, volle Hitze',
  nah(beef.aufmerksamkeitOf({ wucht: 1, genrefaktor: 1, hitze: 100 }), 2.5));
check('Aufmerksamkeit: Riese, Hip-Hop, Hitze 25',
  nah(beef.aufmerksamkeitOf({ wucht: 1, genrefaktor: 1, hitze: 25 }), 1.9375));
check('Aufmerksamkeit: Augenhöhe, Hip-Hop, volle Hitze',
  nah(beef.aufmerksamkeitOf({ wucht: 0.100343, genrefaktor: 1, hitze: 100 }), 1.150515, 1e-5));
check('Aufmerksamkeit: Augenhöhe, Klassik, volle Hitze',
  nah(beef.aufmerksamkeitOf({ wucht: 0.100343, genrefaktor: 0.384615, hitze: 100 }), 1.057889, 1e-5));

console.log('--- Häme ---');
check('Keine Häme auf Augenhöhe im Hip-Hop',
  nah(beef.haemeOf({ meine: 1000, seine: 1000, genrefaktor: 1 }), 0));
check('Zehnfach größer im Hip-Hop: 33,3 %',
  nah(beef.haemeOf({ meine: 10_000, seine: 1000, genrefaktor: 1 }), 0.333333, 1e-5));
check('Hundertfach größer ist gedeckelt',
  nah(beef.haemeOf({ meine: 100_000, seine: 1000, genrefaktor: 1 }), 0.6));
check('Augenhöhe in Klassik: 12,3 %',
  nah(beef.haemeOf({ meine: 1000, seine: 1000, genrefaktor: 0.384615 }), 0.123077, 1e-5));
check('Zehnfach größer in Klassik: 45,6 %',
  nah(beef.haemeOf({ meine: 10_000, seine: 1000, genrefaktor: 0.384615 }), 0.456410, 1e-5));

console.log('--- Hitze ---');
const TAG = 86_400_000;
check('Hitze kühlt 6 Punkte je Tag',
  nah(beef.hitzeJetzt({ hitze: 55, last_cool: 1000 * TAG }, 1002 * TAG), 43));
check('Hitze fällt nie unter 0',
  nah(beef.hitzeJetzt({ hitze: 10, last_cool: 1000 * TAG }, 1010 * TAG), 0));
check('Ohne Zeile ist die Hitze 0', beef.hitzeJetzt(null, 1000 * TAG) === 0);

console.log('--- Runden und Ausgang ---');
check('Diss ohne Häme: Runde für mich', beef.rundeNachDiss(false) === 'ich');
check('Diss mit Häme: Runde für ihn', beef.rundeNachDiss(true) === 'er');
check('Konter eines Großen zählt', beef.rundeNachKonter(0.5) === 'er');
check('Konter eines Winzlings wirkt lächerlich', beef.rundeNachKonter(0.1) === 'ich');
check('Konter genau an der Grenze (0,2) zählt noch als seiner', beef.rundeNachKonter(0.2) === 'er');
check('2:1 ist ein Sieg', beef.ausgangOf(2, 1) === 'sieg');
check('1:2 ist eine Niederlage', beef.ausgangOf(1, 2) === 'niederlage');
check('1:1 ist unentschieden', beef.ausgangOf(1, 1) === 'unentschieden');
check('Sieg zahlt 1,25', nah(beef.bonusFaktor('sieg'), 1.25));
check('Niederlage zahlt 0,85', nah(beef.bonusFaktor('niederlage'), 0.85));
check('Frieden zahlt nichts', nah(beef.bonusFaktor('frieden'), 1));

console.log('--- Anzählen ---');
// Anzählen: wer nah dran ist, wiegt schwerer
const g1 = beef.anzaehlGewicht({ trait: 'arrogant', meine: 10_000, seine: 10_000, gleichesGenre: true, verwandtesGenre: false });
const g2 = beef.anzaehlGewicht({ trait: 'kollegial', meine: 10_000, seine: 10_000_000, gleichesGenre: false, verwandtesGenre: false });
const g3 = beef.anzaehlGewicht({ trait: 'x', meine: 10_000, seine: 10_000, gleichesGenre: false, verwandtesGenre: true });
check('Der nahe Arrogante wiegt schwerer als der ferne Kollegiale', g1 > g2 * 5, `${g1} / ${g2}`);
check('Anzählgewicht: gleiches Genre, gleiche Größe, arrogant', nah(g1, 3.6), `${g1}`);
check('Anzählgewicht: verwandtes Genre, gleiche Größe, Zug ohne Bonus', nah(g3, 2.0), `${g3}`);
check('Anzählgewicht: fremdes Genre, Gegner tausendfach größer, kollegial', nah(g2, 0.25), `${g2}`);

console.log('--- Zahlen und Aktionen ---');
check('Zwei Beef-Aktionen mit 2 h',
  data.BEEF_AKTIONEN.length === 2 && data.BEEF_AKTIONEN.every((a) => a.time === 2 && a.id && a.name && a.emoji));
check('Anstacheln kostet zwei Stunden', data.BEEF_TIME === 2);
check('Anstacheln und Frieden sind die beiden Aktionen',
  data.BEEF_AKTIONEN.map((a) => a.id).join(',') === 'anstacheln,frieden');
check('Hitze deckelt bei 100', data.HITZE_MAX === 100);
check('Höchstens zwei offene Beefs', data.BEEFS_MAX === 2);
check('Fünf Charakterzüge beim Streit', Object.keys(data.BEEF_TRAIT).length === 5);

console.log('--- Texte ---');
const VERBOTEN = ['wirklich', 'in echt', 'Politik', 'Religion', 'krank', 'Familie', 'hässlich'];
check('Fünf Charakterzüge in LINES', Object.keys(data.LINES).length === 5);
check('LINES deckt jeden Charakterzug aus BEEF_TRAIT ab',
  Object.keys(data.BEEF_TRAIT).every((t) => data.LINES[t]));
for (const [trait, lagen] of Object.entries(data.LINES)) {
  check(`${trait} hat vier Lagen`,
    ['einstieg', 'blamage', 'konter', 'ende'].every((l) => Array.isArray(lagen[l])));
  for (const [lage, zeilen] of Object.entries(lagen)) {
    check(`${trait}/${lage} hat drei Zeilen`, zeilen.length === 3);
    for (const z of zeilen) {
      check(`${trait}/${lage} bleibt in der Spielfiktion`,
        !VERBOTEN.some((w) => z.toLowerCase().includes(w.toLowerCase())), z);
      check(`${trait}/${lage} nennt den Kontakt`, z.includes('{name}'), z);
    }
  }
}
check('60 Zeilen insgesamt',
  Object.values(data.LINES).reduce((s, l) => s + Object.values(l).reduce((t, z) => t + z.length, 0), 0) === 60);

console.log('--- textFor ---');
check('textFor setzt den Namen ein',
  beef.textFor('arrogant', 'einstieg', 'Lil Pfand', () => 0).includes('Lil Pfand'));
check('textFor lässt keinen Platzhalter stehen',
  !beef.textFor('kuehl', 'konter', 'Rammstein', () => 0.99).includes('{name}'));
check('textFor greift bei random 0,999 noch die letzte Zeile',
  beef.textFor('launisch', 'ende', 'X', () => 0.999999) === data.LINES.launisch.ende[2].replace('{name}', 'X'));
check('textFor gibt bei unbekanntem Zug nichts zurück', beef.textFor('x', 'ende', 'X', () => 0) === '');
check('textFor gibt bei unbekannter Lage nichts zurück', beef.textFor('kuehl', 'y', 'X', () => 0) === '');

/**
 * ---------------------------------------------------------------------------
 *  Stück 2: der Zustand – Anstacheln, Abkühlung, Gegenschlag, Abrechnung
 * ---------------------------------------------------------------------------
 * Ab hier läuft alles gegen eine echte Datenbank. Geprüft wird vor allem die
 * REIHENFOLGE: Vor der Zeitbuchung darf nichts geschrieben sein, die zwei
 * Stunden sind auch bei der Blamage weg, und ein fälliger Gegenschlag fällt
 * genau einmal (§9).
 */
(async () => {
  const db = require('../src/db');
  const contacts = require('../src/contacts');
  const cdata = require('../src/data/contacts');
  const music = require('../src/music');
  const creator = require('../src/creator');
  const home = require('../src/home');
  const unb = require('../src/unb');
  unb.getBalance = async () => ({ cash: 0, bank: 0, total: 0 });
  unb.changeCash = async () => ({ cash: 0, bank: 0, total: 0 });

  const G = `BEEF_T${Date.now()}`;
  const t0 = new Date(new Date().setHours(6, 0, 0, 0)).getTime() + 24 * 3600e3;
  const H = 3600e3;
  const immer = () => 0.0001;   // unter jeder Einstiegschance → er steigt ein
  const nie = () => 0.99;       // über jeder Einstiegschance → Blamage

  /** Ein deutscher Hip-Hop-Musiker mit fester Hörerzahl und Hype 1. */
  async function musiker(u, listeners) {
    await home.setHome(G, u, 'de');
    home.setLanguage(G, u, 'deutsch');
    music.setup(G, u, 'hiphop', music.PERSONAS[0].id);
    db.saveArtist(G, u, { ...db.getArtist(G, u, t0), listeners, hype: 1, touched_at: t0 });
    return u;
  }

  const riese = cdata.byId('hanszimmer');
  const klein = cdata.byId('lilpfand');
  const klein2 = cdata.byId('rafcamora');
  const klein3 = cdata.byId('loredana');
  const anders = cdata.CONTACTS.find((c) =>
    c.language === 'deutsch' && c.reach > 0 && c.genre && c.genre !== 'hiphop');

  console.log('--- Tabelle ---');
  {
    const U = 'b0';
    db.saveBeef(G, U, 'apache', { hitze: 55, runden_ich: 1, last_cool: t0, angefangen: t0 });
    const row = db.beefRow(G, U, 'apache');
    check('Beef-Zeile kommt zurück', row && row.hitze === 55 && row.runden_ich === 1);
    check('Unbekannter Beef ist null', db.beefRow(G, U, 'gibtsnicht') === null);
    check('Voreinstellungen stehen', row.status === 'offen' && row.runden_er === 0
      && row.konter_at === 0 && row.bonus_until === 0);
  }

  console.log('--- music.applyBeefTreffer ---');
  {
    const U = await musiker('b9', 10_000);
    const t = music.applyBeefTreffer(G, U, { hype: 0.8, hoererAnteil: 0.1 }, t0);
    const a = db.getArtist(G, U, t0);
    check('Hype × 0,8 und 10 % der Hörer weg',
      t.ok && t.verloren === 1000 && a.listeners === 9000 && nah(a.hype, 0.8),
      JSON.stringify({ v: t.verloren, l: a.listeners, h: a.hype }));
    for (let i = 0; i < 10; i++) music.applyBeefTreffer(G, U, { hype: 0.5 }, t0);
    check('Hype fällt nie unter HYPE_MIN',
      nah(db.getArtist(G, U, t0).hype, music.HYPE_MIN), String(db.getArtist(G, U, t0).hype));
    check('Ohne begonnene Karriere: not_started',
      music.applyBeefTreffer(G, 'bOhne', { hype: 0.8 }, t0).reason === 'not_started');
    // Genre ohne Persona ist eine halbe Zeile – publish und show zählen sie
    // nicht als Karriere, der Beef-Treffer darf es auch nicht.
    db.saveArtist(G, 'bHalb', { ...db.getArtist(G, 'bHalb', t0), genre: 'hiphop', persona: '' });
    check('Halbe Künstlerzeile (Genre ohne Persona): not_started',
      music.applyBeefTreffer(G, 'bHalb', { hype: 0.8 }, t0).reason === 'not_started');
  }

  console.log('--- Anstacheln ---');
  {
    const U = await musiker('b1', 10_000);

    // Blamage: er steigt nicht ein – die zwei Stunden sind trotzdem weg.
    const zeitVor = creator.budget(G, U, t0).left;
    const r = beef.anstacheln(G, U, riese.id, t0, nie);
    check('Der Riese steigt nicht ein', r.ok === true && r.ein === false, JSON.stringify(r.reason ?? r.ein));
    check('Zeit wird auch bei der Blamage gebucht',
      creator.budget(G, U, t0).left === zeitVor - data.BEEF_TIME,
      `${creator.budget(G, U, t0).left} statt ${zeitVor - 2}`);
    check('Blamage schreibt keinen Beef', db.beefRow(G, U, riese.id) === null);
    check('Blamage kostet Draht −5 und sperrt drei Tage',
      db.getContact(G, U, riese.id).draht === data.DRAHT_BLAMAGE
      && db.getContact(G, U, riese.id).last_try === t0);
    check('Blamage kostet einmalig ein Zwanzigstel Hype',
      nah(db.getArtist(G, U, t0).hype, 0.95), String(db.getArtist(G, U, t0).hype));
    check('Blamage erzählt eine Zeile', typeof r.text === 'string' && r.text.includes(riese.name));

    // Sperre: derselbe Kontakt am selben Tag
    const r2 = beef.anstacheln(G, U, riese.id, t0 + H, nie);
    check('Zweiter Versuch am selben Tag: gesperrt',
      r2.ok === false && r2.reason === 'gesperrt', JSON.stringify(r2.reason));

    // Einstieg: zwei Beefs aufmachen
    const e1 = beef.anstacheln(G, U, klein.id, t0, immer);
    const e2 = beef.anstacheln(G, U, klein2.id, t0, immer);
    check('Er steigt ein: Hitze 25, Runden 0:0',
      e1.ok && e1.ein && db.beefRow(G, U, klein.id).hitze === data.HITZE_ANSTACHELN
      && db.beefRow(G, U, klein.id).runden_ich === 0 && db.beefRow(G, U, klein.id).runden_er === 0,
      JSON.stringify(e1.reason ?? db.beefRow(G, U, klein.id)));
    check('Einstieg kostet Draht −15', e1.draht.nachher === data.DRAHT_ANSTACHELN);
    check('Zwei offene Beefs', e2.ok && beef.offeneBeefs(G, U, t0).length === 2);
    check('offenerBeef liefert die Zeile mit faul gerechneter Hitze',
      nah(beef.offenerBeef(G, U, klein.id, t0 + 2 * 86_400_000).hitze, 13));

    // Derselbe Gegner noch einmal: läuft schon
    check('Mit ihm läuft schon etwas',
      beef.anstacheln(G, U, klein.id, t0, immer).reason === 'laeuft_schon');

    // Der dritte wird abgelehnt – und zwar VOR der Zeitbuchung
    const zeitVor3 = creator.budget(G, U, t0).left;
    const r3 = beef.anstacheln(G, U, klein3.id, t0, immer);
    check('Der dritte Beef wird abgelehnt', r3.ok === false && r3.reason === 'zu_viele');
    check('Vor der Zeitbuchung ist nichts geschrieben',
      db.beefRow(G, U, klein3.id) === null && db.getContact(G, U, klein3.id) === null
      && creator.budget(G, U, t0).left === zeitVor3,
      JSON.stringify({ beef: db.beefRow(G, U, klein3.id), zeit: creator.budget(G, U, t0).left }));

    check('Unbekannter Kontakt', beef.anstacheln(G, U, 'gibtsnicht', t0, immer).reason === 'unknown');
  }

  console.log('--- Gegenschlag ---');
  {
    const U = await musiker('b2', 10_000);
    db.saveBeef(G, U, riese.id, {
      hitze: 55, runden_ich: 0, runden_er: 0, last_hit: t0, last_cool: t0,
      konter_at: t0 - 1000, angefangen: t0, status: 'offen', bonus_until: 0,
    });
    const ev = beef.settle(G, U, t0, () => 0.5);
    const row = db.beefRow(G, U, riese.id);
    const a = db.getArtist(G, U, t0);
    check('Genau ein Gegenschlag', ev.length === 1 && ev[0].art === 'konter'
      && ev[0].contactId === riese.id, JSON.stringify(ev.map((e) => e.art)));
    check('Die Wucht des Riesen ist gedeckelt und die Runde seine',
      nah(ev[0].wucht, 1) && ev[0].runde === 'er' && row.runden_er === 1 && row.runden_ich === 0);
    check('Konter: Hype × 0,75 und 10 % der Hörer weg',
      nah(a.hype, 0.75) && a.listeners === 9000, JSON.stringify({ h: a.hype, l: a.listeners }));
    check('Konter: Hitze +30, Draht −10, konter_at zurückgesetzt',
      nah(row.hitze, 85) && row.konter_at === 0
      && db.getContact(G, U, riese.id).draht === data.DRAHT_KONTER);
    check('Der Gegenschlag sperrt den Kontakt nicht',
      db.getContact(G, U, riese.id).last_try === 0 && db.getContact(G, U, riese.id).tries === 0);

    // §9: genau einmal. Ein zweiter Aufruf ändert nichts.
    const ev2 = beef.settle(G, U, t0, () => 0.5);
    const row2 = db.beefRow(G, U, riese.id);
    const a2 = db.getArtist(G, U, t0);
    check('Zweiter settle-Aufruf meldet nichts', ev2.length === 0);
    check('Zweiter settle-Aufruf schreibt nichts',
      nah(row2.hitze, 85) && row2.runden_er === 1 && row2.konter_at === 0
      && nah(a2.hype, 0.75) && a2.listeners === 9000,
      JSON.stringify({ h: row2.hitze, r: row2.runden_er, hy: a2.hype, l: a2.listeners }));
  }

  console.log('--- Der Gegenschlag verfällt ---');
  {
    const U = await musiker('b3', 10_000);
    db.saveBeef(G, U, riese.id, {
      hitze: 39, runden_ich: 1, runden_er: 0, last_hit: t0, last_cool: t0,
      konter_at: t0 - 1000, angefangen: t0, status: 'offen', bonus_until: 0,
    });
    const ev = beef.settle(G, U, t0, () => 0.5);
    const row = db.beefRow(G, U, riese.id);
    check('Unter Hitze 40 schlägt er nicht mehr zurück',
      ev.length === 0 && row.konter_at === 0 && nah(row.hitze, 39) && row.runden_er === 0,
      JSON.stringify({ ev: ev.length, k: row.konter_at, h: row.hitze }));
    check('Ein verfallener Konter kostet weder Hype noch Hörer',
      nah(db.getArtist(G, U, t0).hype, 1) && db.getArtist(G, U, t0).listeners === 10_000);
  }

  console.log('--- Abrechnung ---');
  {
    const U = await musiker('b4', 10_000);
    db.saveBeef(G, U, klein.id, {
      hitze: 30, runden_ich: 2, runden_er: 1, last_hit: t0, last_cool: t0,
      konter_at: 0, angefangen: t0, status: 'offen', bonus_until: 0,
    });
    const t5 = t0 + 5 * 86_400_000;   // 5 Tage × 6 Punkte = 30 → Hitze 0
    check('Nach fünf Tagen ist die Hitze durch', nah(beef.offenerBeef(G, U, klein.id, t5).hitze, 0));
    const ev = beef.settle(G, U, t5, () => 0.5);
    const row = db.beefRow(G, U, klein.id);
    check('2:1 ist ein Sieg', ev.length === 1 && ev[0].art === 'ende' && ev[0].status === 'sieg'
      && row.status === 'sieg', JSON.stringify(ev));
    check('Das Bonusfenster läuft sieben Tage',
      row.bonus_until === t5 + data.BONUS_TAGE * 86_400_000);
    check('Ein abgerechneter Beef ist nicht mehr offen',
      beef.offenerBeef(G, U, klein.id, t5) === null && beef.offeneBeefs(G, U, t5).length === 0);
    check('Sieg zahlt eine Woche lang 1,25',
      nah(beef.bonusOf(G, U, t5).faktor, data.BONUS_SIEG)
      && beef.bonusOf(G, U, t5).contactId === klein.id);
    check('Nach sieben Tagen ist der Bonus weg',
      nah(beef.bonusOf(G, U, t5 + 8 * 86_400_000).faktor, 1));
    check('Ein zweiter settle-Aufruf rechnet nicht noch einmal ab',
      beef.settle(G, U, t5, () => 0.5).length === 0);
  }

  console.log('--- bonusOf stapelt nicht ---');
  {
    const U = 'b5';
    db.saveBeef(G, U, klein.id, { hitze: 0, runden_ich: 2, runden_er: 1, last_cool: t0,
      angefangen: t0, status: 'sieg', bonus_until: t0 + 3 * 86_400_000 });
    db.saveBeef(G, U, klein2.id, { hitze: 0, runden_ich: 0, runden_er: 1, last_cool: t0,
      angefangen: t0, status: 'niederlage', bonus_until: t0 + 5 * 86_400_000 });
    const b = beef.bonusOf(G, U, t0);
    check('Der jüngere Ausgang gewinnt, nicht das Produkt',
      nah(b.faktor, data.BONUS_NIEDERLAGE) && b.contactId === klein2.id, JSON.stringify(b));
    check('Ohne laufendes Fenster ist der Faktor 1',
      nah(beef.bonusOf(G, U, t0 + 6 * 86_400_000).faktor, 1));
  }

  console.log('--- Frieden ---');
  {
    const U = await musiker('b6', 10_000);
    const beefZeile = (id, hitze) => db.saveBeef(G, U, id, {
      hitze, runden_ich: 0, runden_er: 0, last_hit: t0, last_cool: t0,
      konter_at: 0, angefangen: t0, status: 'offen', bonus_until: 0 });

    contacts.moveDraht(G, U, klein.id, -60, t0);
    beefZeile(klein.id, 0);
    const f1 = beef.frieden(G, U, klein.id, t0);
    check('Draht −60 + 30 = −30', f1.ok && f1.draht.nachher === -30, JSON.stringify(f1.reason ?? f1.draht));
    check('Frieden beendet den Beef und löscht den Bonus',
      db.beefRow(G, U, klein.id).status === 'frieden'
      && db.beefRow(G, U, klein.id).bonus_until === 0
      && nah(beef.bonusOf(G, U, t0).faktor, 1));

    contacts.moveDraht(G, U, klein2.id, -20, t0);
    beefZeile(klein2.id, 0);
    const f2 = beef.frieden(G, U, klein2.id, t0);
    check('Draht −20 + 30 wird auf −10 gedeckelt', f2.ok && f2.draht.nachher === data.FRIEDEN_DECKEL,
      JSON.stringify(f2.reason ?? f2.draht));

    beefZeile(klein3.id, 55);
    const zeitVor = creator.budget(G, U, t0).left;
    const f3 = beef.frieden(G, U, klein3.id, t0);
    check('Über Hitze 30 nimmt er keinen Frieden an',
      f3.ok === false && f3.reason === 'zu_heiss' && nah(f3.hitze, 55), JSON.stringify(f3.reason));
    // Zu heiß ist eine Voraussetzung wie die Sperre bei einer Anfrage, kein
    // Ergebnis: Sie wird VOR der Zeitbuchung geprüft.
    check('Der abgelehnte Friedensversuch kostet den Abend nicht',
      creator.budget(G, U, t0).left === zeitVor,
      `${creator.budget(G, U, t0).left} statt ${zeitVor}`);
    check('Ohne Beef gibt es nichts zu befrieden',
      beef.frieden(G, U, anders.id, t0).reason === 'kein_beef');
  }

  console.log('--- Die Szene macht dicht ---');
  {
    const U = await musiker('b7', 10_000);
    db.saveBeef(G, U, klein.id, { hitze: 100, runden_ich: 0, runden_er: 0, last_hit: t0,
      last_cool: t0, konter_at: 0, angefangen: t0, status: 'offen', bonus_until: 0 });
    check('Gegen ihn selbst voller Malus', nah(beef.szeneMalus(G, U, klein, t0), -data.SZENE_MALUS));
    check('Gleiche Sprache UND gleiches Genre: Malus',
      nah(beef.szeneMalus(G, U, klein2, t0), -data.SZENE_MALUS));
    check('Nur gleiche Sprache: kein Malus', nah(beef.szeneMalus(G, U, anders, t0), 0),
      `${anders.id}: ${beef.szeneMalus(G, U, anders, t0)}`);
    // 50 Punkte Abkühlung sind bei 6 je Tag gut acht ein Drittel Tage.
    check('Halbe Hitze, halber Malus',
      nah(beef.szeneMalus(G, U, klein, t0 + (50 / data.HITZE_COOL_PRO_TAG) * 86_400_000), -0.075, 1e-9));

    db.saveBeef(G, U, klein3.id, { hitze: 50, runden_ich: 0, runden_er: 0, last_hit: t0,
      last_cool: t0, konter_at: 0, angefangen: t0, status: 'offen', bonus_until: 0 });
    check('Zwei offene Beefs: der größte Malus, nicht die Summe',
      nah(beef.szeneMalus(G, U, klein2, t0), -data.SZENE_MALUS),
      String(beef.szeneMalus(G, U, klein2, t0)));
    check('Der Malus landet in der Antwortchance',
      contacts.chanceOf({ meineReichweite: 10_000, seineReichweite: 10_000, request: 'shoutout',
        gleichesLand: true, sprache: 'gleich', genre: 'gleich', trait: 'launisch' })
      - contacts.chanceOf({ meineReichweite: 10_000, seineReichweite: 10_000, request: 'shoutout',
        gleichesLand: true, sprache: 'gleich', genre: 'gleich', trait: 'launisch', szene: -0.15 })
      > 0.14);
  }

  console.log('--- Anfragen bei offenem Beef ---');
  {
    const U = await musiker('b8', 10_000);
    const vorher = contacts.detail(G, U, klein.id, t0);
    check('Ohne Beef ist mindestens eine Anfrage möglich', vorher.requests.some((r) => r.moeglich));
    db.saveBeef(G, U, klein.id, { hitze: 25, runden_ich: 0, runden_er: 0, last_hit: t0,
      last_cool: t0, konter_at: 0, angefangen: t0, status: 'offen', bonus_until: 0 });
    const d = contacts.detail(G, U, klein.id, t0);
    check('Bei offenem Beef haben alle vier Anfragearten den Grund beef',
      d.requests.length === 4 && d.requests.every((r) => r.grund === 'beef' && r.moeglich === false),
      JSON.stringify(d.requests.map((r) => [r.id, r.grund])));
    check('Ein anderer Kontakt bleibt erreichbar',
      contacts.detail(G, U, anders.id, t0).requests.some((r) => r.moeglich));

    // Ein alter Knopf darf den Grund nicht umgehen: Was detail sperrt, weist
    // request ab – und zwar vor der Zeitbuchung.
    const zeitVor = creator.budget(G, U, t0).left;
    const abgewiesen = contacts.request(G, U, klein.id, 'shoutout', t0, () => 0.0001);
    check('contacts.request weist bei offenem Beef ab',
      abgewiesen.ok === false && abgewiesen.reason === 'beef', JSON.stringify(abgewiesen.reason));
    check('Die abgewiesene Anfrage kostet keine Zeit',
      creator.budget(G, U, t0).left === zeitVor && db.getContact(G, U, klein.id) === null,
      JSON.stringify({ zeit: creator.budget(G, U, t0).left, vor: zeitVor }));
    check('Ohne Beef geht dieselbe Anfrage durch',
      contacts.request(G, U, anders.id, 'shoutout', t0, () => 0.0001).ok === true);
  }

  console.log('--- Der Beef rechnet immer auf der Musikseite ---');
  {
    // Drake macht beides. Wer einen großen Kanal hat, bekommt von
    // contacts.detail die Creator-Seite gemeldet – für den Streit zählen
    // trotzdem Hörer gegen Musik-Reichweite.
    const beides = cdata.byId('drake');
    async function konter(u, followers) {
      const U = await musiker(u, 10_000);
      if (followers) db.addCreatorFollowers(G, U, 'youtube', followers, 1, t0);
      db.saveBeef(G, U, beides.id, {
        hitze: 55, runden_ich: 0, runden_er: 0, last_hit: t0, last_cool: t0,
        konter_at: t0 - 1000, angefangen: t0, status: 'offen', bonus_until: 0,
      });
      return { U, ev: beef.settle(G, U, t0, () => 0.5)[0] };
    }
    const ohne = await konter('bB', 0);
    const mit = await konter('bC', 500_000);
    check('Der Kanal ist größer als die Hörerzahl',
      contacts.detail(G, mit.U, beides.id, t0).seite === 'creator',
      contacts.detail(G, mit.U, beides.id, t0).seite);
    check('Der große Kanal ändert die Wucht des Gegenschlags nicht',
      ohne.ev && mit.ev && nah(ohne.ev.wucht, mit.ev.wucht) && nah(mit.ev.wucht, 1),
      JSON.stringify({ ohne: ohne.ev?.wucht, mit: mit.ev?.wucht }));
    check('Und damit auch nicht, was der Treffer kostet',
      nah(db.getArtist(G, mit.U, t0).hype, 0.75)
      && db.getArtist(G, mit.U, t0).listeners === 9000,
      JSON.stringify({ h: db.getArtist(G, mit.U, t0).hype, l: db.getArtist(G, mit.U, t0).listeners }));

    const U = await musiker('bD', 10_000);
    db.addCreatorFollowers(G, U, 'youtube', 500_000, 1, t0);
    const r = beef.anstacheln(G, U, beides.id, t0, immer);
    check('Mit großem Kanal steigt man trotzdem in den Beef ein',
      r.ok === true && r.ein === true, JSON.stringify(r.reason ?? r.ein));
  }

  console.log('--- Der Gegenschlag eines verschwundenen Gegners ---');
  {
    const U = await musiker('bE', 10_000);
    db.saveBeef(G, U, 'gibtsnichtmehr', {
      hitze: 55, runden_ich: 0, runden_er: 0, last_hit: t0, last_cool: t0,
      konter_at: t0 - 1000, angefangen: t0, status: 'offen', bonus_until: 0,
    });
    const ev = beef.settle(G, U, t0, () => 0.5);
    check('Ein Gegner ohne Katalogzeile schlägt nicht zurück',
      ev.length === 0 && db.beefRow(G, U, 'gibtsnichtmehr').konter_at === 0,
      JSON.stringify(ev.map((e) => e.art)));
    check('Und kostet weder Hype noch Hörer',
      nah(db.getArtist(G, U, t0).hype, 1) && db.getArtist(G, U, t0).listeners === 10_000);
  }

  console.log('--- Ausgekühlte Beefs blockieren nicht ---');
  {
    const U = await musiker('bF', 10_000);
    for (const c of [klein, klein2]) {
      db.saveBeef(G, U, c.id, { hitze: 30, runden_ich: 0, runden_er: 0, last_hit: t0,
        last_cool: t0, konter_at: 0, angefangen: t0, status: 'offen', bonus_until: 0 });
    }
    const t5 = t0 + 5 * 86_400_000;   // 5 Tage × 6 Punkte = 30 → Hitze 0
    // Niemand hat dazwischen eine Ansicht geöffnet: anstacheln rechnet selbst ab.
    const r = beef.anstacheln(G, U, klein3.id, t5, immer);
    check('Der dritte Beef geht, sobald die alten ausgekühlt sind',
      r.ok === true && r.ein === true, JSON.stringify(r.reason ?? r.ein));
    check('Die beiden alten sind dabei abgerechnet worden',
      db.beefRow(G, U, klein.id).status === 'unentschieden'
      && db.beefRow(G, U, klein2.id).status === 'unentschieden'
      && beef.offeneBeefs(G, U, t5).length === 1,
      JSON.stringify(beef.offeneBeefs(G, U, t5).map((b) => b.contact_id)));
  }

  console.log('--- Stück 3: die Ereignisse aus Schritt 0 gehen nicht verloren ---');
  {
    // klein (Lil Pfand, Reichweite 8.400) hat einen fälligen Gegenschlag. Wird
    // er durch Schritt 0 von anstacheln nachgeholt, darf das Ereignis nicht
    // verschwinden – es muss unter `vorher` im Rückgabewert auftauchen.
    const U = await musiker('bG', 10_000);
    db.saveBeef(G, U, klein.id, {
      hitze: 55, runden_ich: 0, runden_er: 0, last_hit: t0, last_cool: t0,
      konter_at: t0 - 1000, angefangen: t0, status: 'offen', bonus_until: 0,
    });
    // anstacheln zielt auf einen ANDEREN Kontakt – der fällige Gegenschlag bei
    // klein wird trotzdem in Schritt 0 nachgeholt.
    const r = beef.anstacheln(G, U, klein2.id, t0, immer);
    check('Anstacheln gegen den anderen Kontakt geht durch', r.ok === true && r.ein === true,
      JSON.stringify(r.reason ?? r.ein));
    check('Der fällige Gegenschlag steht unter vorher',
      Array.isArray(r.vorher) && r.vorher.length === 1 && r.vorher[0].art === 'konter'
      && r.vorher[0].contactId === klein.id,
      JSON.stringify(r.vorher));
    check('Seine Zahlen stehen drin: Wucht, Hype-Treffer und verlorene Hörer',
      nah(r.vorher[0].wucht, 0.088267, 1e-5) && r.vorher[0].treffer.verloren === 88
      && r.vorher[0].treffer.listeners === 9912,
      JSON.stringify(r.vorher[0]));
    check('Die Zahlen sind auch wirklich geschrieben: Hype 1 → 0,978, Hörer 10.000 → 9.912',
      nah(db.getArtist(G, U, t0).hype, 0.977933, 1e-5) && db.getArtist(G, U, t0).listeners === 9_912,
      JSON.stringify(db.getArtist(G, U, t0)));

    // Auch eine abgelehnte Aktion darf die Ereignisse aus Schritt 0 nicht
    // verschlucken: derselbe Kontakt läuft noch (Hitze 85 nach dem Konter),
    // ein zweiter Versuch wird abgelehnt – vorher muss trotzdem ankommen.
    const r2 = beef.anstacheln(G, U, klein.id, t0, immer);
    check('Zweiter Versuch gegen denselben Kontakt: läuft schon',
      r2.ok === false && r2.reason === 'laeuft_schon', JSON.stringify(r2.reason));
    check('vorher ist bei der Ablehnung leer, weil der Gegenschlag schon gefallen ist',
      Array.isArray(r2.vorher) && r2.vorher.length === 0, JSON.stringify(r2.vorher));

    // Eigener Fall: ein fälliger Gegenschlag gegen GENAU den Kontakt, den man
    // gerade wieder anstacheln will – die Ablehnung ('laeuft_schon') darf das
    // Ereignis trotzdem melden.
    const U2 = await musiker('bH', 10_000);
    db.saveBeef(G, U2, riese.id, {
      hitze: 55, runden_ich: 0, runden_er: 0, last_hit: t0, last_cool: t0,
      konter_at: t0 - 1000, angefangen: t0, status: 'offen', bonus_until: 0,
    });
    const r3 = beef.anstacheln(G, U2, riese.id, t0, immer);
    check('Läuft schon – aber mit dem nachgeholten Ereignis im Gepäck',
      r3.ok === false && r3.reason === 'laeuft_schon'
      && Array.isArray(r3.vorher) && r3.vorher.length === 1
      && r3.vorher[0].art === 'konter' && r3.vorher[0].contactId === riese.id,
      JSON.stringify({ reason: r3.reason, vorher: r3.vorher }));
  }

  console.log('--- Stück 3: ein frischer Bonus lässt sich nicht überschreiben ---');
  {
    // Genau abgerechnet wie in „bonusOf stapelt nicht": ein Sieg mit laufendem
    // Bonusfenster, direkt in die Tabelle geschrieben.
    const U = await musiker('bI', 10_000);
    const bis = t0 + data.BONUS_TAGE * 86_400_000;
    db.saveBeef(G, U, klein.id, {
      hitze: 0, runden_ich: 2, runden_er: 0, last_hit: t0, last_cool: t0,
      konter_at: 0, angefangen: t0, status: 'sieg', bonus_until: bis,
    });
    check('Der Bonus steht: Faktor 1,25',
      nah(beef.bonusOf(G, U, t0).faktor, data.BONUS_SIEG) && beef.bonusOf(G, U, t0).contactId === klein.id);

    const zeitVor = creator.budget(G, U, t0).left;
    const r = beef.anstacheln(G, U, klein.id, t0, immer);
    check('Ein neuer Beef mit ihm wird abgelehnt: zu_frisch',
      r.ok === false && r.reason === 'zu_frisch' && r.bis === bis, JSON.stringify(r));
    check('Die Ablehnung kostet keine Zeit', creator.budget(G, U, t0).left === zeitVor,
      `${creator.budget(G, U, t0).left} statt ${zeitVor}`);
    check('Die alte Zeile und der Bonus stehen unverändert',
      db.beefRow(G, U, klein.id).status === 'sieg' && db.beefRow(G, U, klein.id).bonus_until === bis
      && nah(beef.bonusOf(G, U, t0).faktor, data.BONUS_SIEG));

    // Nach Ablauf des Fensters darf ein neuer Beef ihn legitim überschreiben.
    const spaeter = bis + 1;
    const r2 = beef.anstacheln(G, U, klein.id, spaeter, immer);
    check('Nach Ablauf des Bonusfensters geht ein neuer Beef durch',
      r2.ok === true && r2.ein === true, JSON.stringify(r2.reason ?? r2.ein));
    check('Die alte Zeile ist jetzt legitim ersetzt: offen, ohne Bonus',
      db.beefRow(G, U, klein.id).status === 'offen' && db.beefRow(G, U, klein.id).bonus_until === 0,
      JSON.stringify(db.beefRow(G, U, klein.id)));
  }

  /**
   * -------------------------------------------------------------------------
   *  Stück 3: der Disstrack und das Angezähltwerden
   * -------------------------------------------------------------------------
   * Geprüft wird auch hier die REIHENFOLGE: Die Wirkung wird gerechnet, bevor
   * veröffentlicht wird, und geschrieben wird erst, wenn `publish` durch ist.
   * Ein gescheiterter Versuch (kein Titel, Sperre, keine Zeit) lässt den Beef
   * vollständig unberührt – keine Hitze, keine Runde, kein Draht, kein Konter.
   */

  /** Ein Würfel, der eine feste Folge abspielt und danach den letzten Wert hält. */
  const wuerfel = (...werte) => { let i = 0; return () => werte[Math.min(i++, werte.length - 1)]; };
  /** Musiker mit Titeln im Kasten – ohne die geht keine Veröffentlichung. */
  async function rapper(u, listeners, songs = 3) {
    const U = await musiker(u, listeners);
    db.saveArtist(G, U, { ...db.getArtist(G, U, t0), songs });
    return U;
  }
  /** Eine frische offene Beef-Zeile mit der gewünschten Hitze. */
  const offeneZeile = (hitze) => ({
    hitze, runden_ich: 0, runden_er: 0, last_hit: t0, last_cool: t0,
    konter_at: 0, angefangen: t0, status: 'offen', bonus_until: 0,
  });

  console.log('--- Der Disstrack ---');
  {
    const U = await rapper('bJ', 10_000);
    const r = beef.diss(G, U, riese.id, t0, wuerfel(0.5));
    check('Ohne offenen Beef gibt es keinen Disstrack',
      r.ok === false && r.reason === 'kein_beef', JSON.stringify(r.reason));
    check('Und er meldet trotzdem, was inzwischen fällig war', Array.isArray(r.vorher));
    check('Nichts veröffentlicht, nichts verbraucht',
      db.getArtist(G, U, t0).releases === 0 && db.getArtist(G, U, t0).songs === 3
      && creator.budget(G, U, t0).used === 0);
    check('Ein unbekannter Kontakt hat erst recht keinen offenen Beef',
      beef.diss(G, U, 'gibtsnicht', t0, wuerfel(0.5)).reason === 'kein_beef');
  }
  {
    // §6: Ein alter Knopf in der Musikansicht darf den Disstrack nicht am
    // Beef vorbei auslösen – `publish` selbst riegelt ab.
    const U = await rapper('bK', 10_000);
    const r = music.publish(G, U, 'diss', t0, wuerfel(0.5), { events: false });
    check('publish lehnt den Disstrack ohne { beef: true } ab',
      r.ok === false && r.reason === 'kein_beef', JSON.stringify(r.reason));
    check('Und verbraucht dabei weder Titel noch Zeit',
      db.getArtist(G, U, t0).songs === 3 && creator.budget(G, U, t0).used === 0);
  }
  {
    // Gegen den Riesen ist die Häme-Chance 0 – der Würfel kann sie nicht auslösen.
    const U = await rapper('bL', 10_000);
    db.saveBeef(G, U, riese.id, offeneZeile(40));
    const r = beef.diss(G, U, riese.id, t0, wuerfel(0.5));
    const row = db.beefRow(G, U, riese.id);
    check('Der Disstrack geht raus', r.ok === true, JSON.stringify(r.reason));
    check('Gegen den Riesen fällt keine Häme – die Runde ist meine',
      r.beef.haeme === false && r.beef.runde === 'ich'
      && row.runden_ich === 1 && row.runden_er === 0,
      JSON.stringify({ haeme: r.beef.haeme, i: row.runden_ich, e: row.runden_er }));
    check('Volle Wucht und die gerechnete Aufmerksamkeit gehen an publish',
      nah(r.beef.wucht, 1)
      && nah(r.beef.aufmerksamkeit, beef.aufmerksamkeitOf({ wucht: 1, genrefaktor: 1, hitze: 40 }))
      && nah(r.audienceFactor, r.beef.aufmerksamkeit),
      JSON.stringify({ w: r.beef.wucht, a: r.beef.aufmerksamkeit, f: r.audienceFactor }));
    check('Hitze +30', nah(row.hitze, 70), String(row.hitze));
    check('Sein Gegenschlag steht ein bis drei Tage voraus',
      row.konter_at >= t0 + TAG && row.konter_at <= t0 + 3 * TAG,
      String((row.konter_at - t0) / TAG));
    check('Draht −20, ohne Sperre',
      db.getContact(G, U, riese.id).draht === data.DRAHT_DISS
      && db.getContact(G, U, riese.id).last_try === 0,
      JSON.stringify(db.getContact(G, U, riese.id)));
    check('Er kostet einen Titel und die Veröffentlichungszeit',
      db.getArtist(G, U, t0).songs === 2 && creator.budget(G, U, t0).used === music.release('diss').time,
      JSON.stringify({ s: db.getArtist(G, U, t0).songs, z: creator.budget(G, U, t0).used }));
  }
  {
    // Nach unten getreten: gegen Lil Pfand (8.400) liegt die Häme-Chance bei
    // 2,5 % – der erste Wurf fällt darunter.
    const U = await rapper('bM', 10_000);
    db.saveBeef(G, U, klein.id, offeneZeile(40));
    const r = beef.diss(G, U, klein.id, t0, wuerfel(0.001, 0.5));
    const row = db.beefRow(G, U, klein.id);
    const a = db.getArtist(G, U, t0);
    check('Die Häme fällt', r.ok === true && r.beef.haeme === true,
      JSON.stringify(r.reason ?? r.beef.haeme));
    check('Statt der Aufmerksamkeit geht der halbe Faktor an publish',
      nah(r.audienceFactor, data.HAEME_AUDIENCE), String(r.audienceFactor));
    check('Die Runde geht an ihn',
      r.beef.runde === 'er' && row.runden_er === 1 && row.runden_ich === 0);
    check('Hype × 0,8 …',
      nah(a.hype, Math.max(music.HYPE_MIN, r.beef.treffer.hypeVor * data.HAEME_HYPE)),
      JSON.stringify({ h: a.hype, vor: r.beef.treffer.hypeVor }));
    check('… und zwei Prozent der Hörer weg',
      r.beef.treffer.verloren > 0
      && Math.abs(r.beef.treffer.verloren / (r.beef.treffer.verloren + r.beef.treffer.listeners)
        - data.HAEME_HOERER) < 0.001,
      JSON.stringify(r.beef.treffer));
    check('Hitze +30 auch bei Häme', nah(row.hitze, 70), String(row.hitze));
  }

  console.log('--- Ein gescheiterter Disstrack lässt den Beef unberührt ---');
  {
    const unveraendert = (row, hitze = 40) => Boolean(row) && nah(row.hitze, hitze)
      && row.runden_ich === 0 && row.runden_er === 0 && row.konter_at === 0
      && row.last_hit === t0 && row.last_cool === t0;

    // 1. Kein Titel im Kasten.
    const U = await rapper('bN', 10_000, 0);
    db.saveBeef(G, U, klein.id, offeneZeile(40));
    const r = beef.diss(G, U, klein.id, t0, wuerfel(0.5));
    check('Ohne Titel: no_songs', r.ok === false && r.reason === 'no_songs', JSON.stringify(r.reason));
    check('Der Beef steht unverändert, kein Draht bewegt',
      unveraendert(db.beefRow(G, U, klein.id)) && db.getContact(G, U, klein.id) === null,
      JSON.stringify(db.beefRow(G, U, klein.id)));
    check('Auch die Ablehnung meldet, was fällig war', Array.isArray(r.vorher));

    // 2. Die Veröffentlichungssperre.
    db.saveArtist(G, U, { ...db.getArtist(G, U, t0), songs: 2 });
    const ok = beef.diss(G, U, klein.id, t0, wuerfel(0.5));
    check('Mit Titel geht derselbe Disstrack raus', ok.ok === true, JSON.stringify(ok.reason));
    const stand = JSON.stringify(db.beefRow(G, U, klein.id));
    const drahtStand = db.getContact(G, U, klein.id).draht;
    const r2 = beef.diss(G, U, klein.id, t0 + 60_000, wuerfel(0.5));
    check('Zweiter Disstrack sofort danach: cooldown',
      r2.ok === false && r2.reason === 'cooldown', JSON.stringify(r2.reason));
    check('Und der Beef steht danach genau wie vorher',
      JSON.stringify(db.beefRow(G, U, klein.id)) === stand
      && db.getContact(G, U, klein.id).draht === drahtStand,
      JSON.stringify(db.beefRow(G, U, klein.id)));

    // 3. Der Tag ist voll.
    const U2 = await rapper('bO', 10_000);
    db.saveBeef(G, U2, klein.id, offeneZeile(40));
    // Eine Stunde bleibt stehen – der Disstrack braucht zwei. Ohne Ermüdung
    // gebucht, damit die Ablehnung wirklich an den Stunden hängt und nicht an
    // der Energiewand ('exhausted').
    creator.useTime(G, U2, creator.budget(G, U2, t0).left - 1, t0, { fatigueFactor: 0 });
    const r3 = beef.diss(G, U2, klein.id, t0, wuerfel(0.5));
    check('Ohne Stunden: no_time', r3.ok === false && r3.reason === 'no_time', JSON.stringify(r3.reason));
    check('Auch dann bleibt der Beef unberührt',
      unveraendert(db.beefRow(G, U2, klein.id)) && db.getContact(G, U2, klein.id) === null
      && db.getArtist(G, U2, t0).songs === 3,
      JSON.stringify(db.beefRow(G, U2, klein.id)));
  }

  console.log('--- zielFor: der heißeste offene Beef ---');
  {
    const U = await musiker('bV', 10_000);
    check('Ohne Beef gibt es kein Ziel', beef.zielFor(G, U, t0) === null);
    db.saveBeef(G, U, klein.id, offeneZeile(30));
    db.saveBeef(G, U, klein2.id, offeneZeile(60));
    const ziel = beef.zielFor(G, U, t0);
    check('Der heißeste Beef ist das Ziel',
      ziel && ziel.contact_id === klein2.id && ziel.contact.id === klein2.id && nah(ziel.hitze, 60),
      JSON.stringify({ id: ziel?.contact_id, h: ziel?.hitze }));
    db.saveBeef(G, U, klein2.id, { ...offeneZeile(60), status: 'sieg' });
    check('Ein abgerechneter Beef ist kein Ziel mehr',
      beef.zielFor(G, U, t0).contact_id === klein.id);
  }

  console.log('--- Der Bonus eines abgerechneten Beefs wirkt auf den Hype ---');
  {
    const mit = await rapper('bP', 10_000);
    const ohne = await rapper('bQ', 10_000);
    db.saveBeef(G, mit, klein.id, {
      hitze: 0, runden_ich: 2, runden_er: 0, last_hit: t0, last_cool: t0,
      konter_at: 0, angefangen: t0, status: 'sieg', bonus_until: t0 + data.BONUS_TAGE * TAG,
    });
    const a = music.publish(G, mit, 'single', t0, wuerfel(0.5), { events: false });
    const b = music.publish(G, ohne, 'single', t0, wuerfel(0.5), { events: false });
    check('Beide veröffentlichen mit demselben Würfel dasselbe',
      a.ok && b.ok && a.audience === b.audience, JSON.stringify({ a: a.audience, b: b.audience }));
    const hm = db.getArtist(G, mit, t0).hype;
    const ho = db.getArtist(G, ohne, t0).hype;
    check('Nach einem Sieg steht der Hype um den Bonusfaktor höher',
      hm > ho && nah(hm, Math.min(music.HYPE_MAX, ho * data.BONUS_SIEG)), `${hm} vs ${ho}`);
  }

  console.log('--- Angezählt werden ---');
  {
    // Der Katalog in seiner Reihenfolge: Mit `wurf = 0` trifft es immer den
    // ERSTEN Kandidaten, der nicht ausgeschlossen ist – so ist der Wurf
    // prüfbar, ohne die Gewichte nachzurechnen.
    const musikKontakte = cdata.CONTACTS.filter((c) => c.reach);

    {
      const U = await musiker('bR', 10_000);
      db.saveBeef(G, U, klein2.id, offeneZeile(25));
      db.saveBeef(G, U, klein3.id, offeneZeile(25));
      check('Bei zwei offenen Beefs zählt niemand an',
        beef.anzaehlen(G, U, t0, wuerfel(0, 0, 0)) === null);
    }
    {
      const U = await musiker('bS', 10_000);
      check('Über der Chance passiert nichts',
        beef.anzaehlen(G, U, t0, wuerfel(data.ANZAEHL_CHANCE)) === null);
      check('Und es wird auch nichts geschrieben', db.beefsOf(G, U).length === 0);
    }
    {
      const U = await musiker('bT', 10_000);
      const r = beef.anzaehlen(G, U, t0, wuerfel(0.01, 0, 0));
      const erste = musikKontakte[0];
      check('Mit festem Würfel trifft es den ersten Kandidaten des Katalogs',
        r && r.contact.id === erste.id, JSON.stringify(r?.contact?.id));
      const row = db.beefRow(G, U, erste.id);
      check('Wer angezählt wird, steht bei Hitze 25 und 0:1 hinten',
        row.hitze === data.HITZE_ANGEZAEHLT && row.runden_ich === 0 && row.runden_er === 1
        && row.status === 'offen' && row.konter_at === 0 && row.angefangen === t0,
        JSON.stringify(row));
      check('Draht −10', db.getContact(G, U, erste.id).draht === data.DRAHT_ANGEZAEHLT);
      check('Er sagt dazu etwas im Ton seines Charakters',
        typeof r.text === 'string' && r.text.includes(erste.name), r.text);
    }
    {
      const U = await musiker('bU', 10_000);
      contacts.moveDraht(G, U, musikKontakte[0].id, cdata.STUFE_PARTNER, t0);
      db.saveBeef(G, U, musikKontakte[1].id, offeneZeile(25));
      const r = beef.anzaehlen(G, U, t0, wuerfel(0.01, 0, 0));
      check('Partner und laufende Beefs fallen aus der Auswahl',
        r && r.contact.id === musikKontakte[2].id, JSON.stringify(r?.contact?.id));
    }
    {
      // Der Wurf hängt in `publish` – und zwar NACH `db.saveArtist`, damit die
      // neue Hörerzahl schon steht. Genau das prüft dieser Würfel: Er kippt,
      // sobald die Veröffentlichung geschrieben ist.
      const U = await rapper('bW', 10_000);
      const kippt = () => (db.getArtist(G, U, t0).releases > 0 ? 0.001 : 0.99);
      const res = music.publish(G, U, 'single', t0, kippt);
      check('Die Veröffentlichung chartet', res.ok === true && res.position > 0,
        JSON.stringify({ ok: res.ok, pos: res.position, aud: res.audience }));
      check('Wer chartet, wird angezählt – und das Ergebnis sagt es',
        res.angezaehlt && res.angezaehlt.contact.id === musikKontakte[0].id,
        JSON.stringify(res.angezaehlt?.contact?.id ?? res.angezaehlt));
      check('Der Beef steht danach in der Tabelle',
        db.beefRow(G, U, musikKontakte[0].id).hitze === data.HITZE_ANGEZAEHLT
        && beef.offeneBeefs(G, U, t0).length === 1);
    }
    {
      const U = await rapper('bX', 10_000);
      const res = music.publish(G, U, 'single', t0, wuerfel(0.99), { events: false });
      check('Ohne Ereignisse zählt niemand an (Messläufe bleiben sauber)',
        res.ok === true && res.angezaehlt === null, JSON.stringify(res.angezaehlt));
    }
  }

  console.log(`\n${pass} bestanden, ${fail} fehlgeschlagen`);
  process.exit(fail === 0 ? 0 : 1);
})();
