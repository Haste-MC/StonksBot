// test/angebote.test.js
/**
 * Angebote 5c, Stück 1: Zahlen, Texte und die reinen Rechnungen.
 * Aufruf: DATA_DIR=.testdata node test/angebote.test.js
 *
 * Alle Erwartungswerte sind nachgerechnet und gegen die Spec
 * (docs/superpowers/specs/2026-10-02-angebote-design.md) geprüft. Wer sie
 * nicht trifft, hat einen Fehler im Code – nicht im Test.
 *
 * Zwei Zahlen aus dem Aufgabenheft sind dabei berichtigt worden, weil sie der
 * Formel desselben Hefts widersprachen; beide Stellen sind unten einzeln
 * begründet (Honorar-Deckel, Kollabo-Faktor).
 */
const data = require('../src/data/angebote');
const ang = require('../src/angebote');

let pass = 0, fail = 0;
const check = (label, ok, extra = '') => {
  if (ok) { pass++; console.log(`  ✅ ${label}`); }
  else { fail++; console.log(`  ❌ ${label} ${extra}`); }
};
const nah = (a, b, eps = 1e-6) => Math.abs(a - b) < eps;

console.log('--- Gewichtung ---');
check('unter Draht 20 meldet sich niemand', ang.gewichtOf({ draht: 19, passung: 1 }) === 0);
check('Bekannter wiegt 1', nah(ang.gewichtOf({ draht: 20, passung: 1 }), 1));
check('Partner wiegt 4', nah(ang.gewichtOf({ draht: 50, passung: 1 }), 4));
check('die Passung geht voll ein', nah(ang.gewichtOf({ draht: 50, passung: 0.3 }), 1.2));
check('ohne Passung meldet sich auch ein Partner nicht',
  ang.gewichtOf({ draht: 100, passung: 0 }) === 0);

console.log('--- Honorar ---');
/**
 * `tantiemenProTag` kommt aus `music.royaltyPerDay`. Die Spec nennt die Werte
 * gerundet (60/Tag bei 1.000 Hörern, 949/Tag bei 10.000) und die Deckel aus
 * den UNGERUNDETEN Werten (1.796 und 28.468). Beides zusammen geht nicht
 * auf – 30 × 949 ist 28.470. Hier stehen deshalb die ungerundeten Werte, dann
 * stimmen die Deckel der Spec-Tabelle auf den Cent.
 */
const TANT_1K = 59.87438528167906;    // royaltyPerDay(1_000),  Markt 1,0 → Deckel 1.796
const TANT_10K = 948.9450563572701;   // royaltyPerDay(10_000), Markt 1,0 → Deckel 28.468
check('Honorar gegen Lil Pfand', ang.honorarOf({ seine: 8_400, tantiemenProTag: TANT_10K }) === 679);
check('Honorar gegen Oxmo', ang.honorarOf({ seine: 350_000, tantiemenProTag: TANT_10K }) === 6_362);
check('Honorar gegen Nina Chuba', ang.honorarOf({ seine: 3_200_000, tantiemenProTag: TANT_10K }) === 24_000);
check('gegen Hans Zimmer greift der Deckel',
  ang.honorarOf({ seine: 110_000_000, tantiemenProTag: TANT_10K }) === 28_468);
check('ein Winzling bekommt immer genau 30 Tage',
  ang.honorarOf({ seine: 110_000_000, tantiemenProTag: 60 }) === 1_800);
// Die erste Zeile der Spec-Tabelle: bei 1.000 eigenen Hörern bindet der Deckel
// überall außer beim kleinsten Kontakt.
check('bei 1.000 Hörern reicht Lil Pfand noch unter den Deckel',
  ang.honorarOf({ seine: 8_400, tantiemenProTag: TANT_1K }) === 679);
check('bei 1.000 Hörern deckelt Oxmo auf 1.796',
  ang.honorarOf({ seine: 350_000, tantiemenProTag: TANT_1K }) === 1_796);
check('bei 1.000 Hörern deckelt auch Hans Zimmer auf 1.796',
  ang.honorarOf({ seine: 110_000_000, tantiemenProTag: TANT_1K }) === 1_796);
// Zum Mitlesen, warum oben die ungerundete Zahl steht:
check('mit der gerundeten Anzeigezahl 949 wäre der Deckel 28.470',
  ang.honorarOf({ seine: 110_000_000, tantiemenProTag: 949 }) === 28_470);
check('ohne eigene Tantiemen gibt es kein Honorar',
  ang.honorarOf({ seine: 110_000_000, tantiemenProTag: 0 }) === 0);
check('ein Kontakt ohne Reichweite bringt nichts',
  ang.honorarOf({ seine: 0, tantiemenProTag: TANT_10K }) === 0);

console.log('--- Gage ---');
// SHOW_PAY 8, SHOW_EXP 0,7 – dieselben Zahlen wie das Konzert in src/music.js
const g = (meine, seine) => ang.gageOf({ meine, seine, showPay: 8, showExp: 0.7 });
check('allein spielt sich schlechter', g(10_000, 8_400) === 5_195);
check('bei Oxmo ist die Deckelung erreicht', g(10_000, 350_000) === 8_200);
check('und darüber wird es nicht mehr', g(10_000, 110_000_000) === 8_200);
check('wer selbst groß ist, merkt Oxmo kaum', g(100_000, 350_000) === 28_322);
check('die Deckelung ist genau 2^0,7',
  nah(g(10_000, 110_000_000) / Math.round(8 * Math.pow(10_000, 0.7)), Math.pow(2, 0.7), 1e-3));
/**
 * Kein Aufrufer kann eine negative Reichweite liefern – aber `Math.pow` eines
 * negativen Werts mit einem gebrochenen Exponenten ist NaN, und NaN käme hier
 * bis in eine Geldbuchung. Darum derselbe Boden wie in `honorarOf`.
 */
check('eine negative eigene Reichweite ergibt 0, nicht NaN', g(-5, 8_400) === 0);
check('eine negative fremde Reichweite ergibt die eigene Gage',
  g(10_000, -8_400) === Math.round(8 * Math.pow(10_000, 0.7)));
check('ein negatives Gewicht gibt es nicht',
  ang.gewichtOf({ draht: 60, passung: -1 }) === 0);

console.log('--- Kollabo-Faktor ---');
/**
 * Die Werte sind mit `log10(1 + seine/max(100, meine))/3` gerechnet, also der
 * Formel aus Spec und Aufgabenheft. Das Heft nennt dazu sechsstellige
 * Erwartungswerte (1,518514 · 1,835922 · 1,043479), die diese Formel nicht
 * trifft; die Spec selbst nennt dreistellig ×1,519 · ×1,836 · ×2,000 · ×1,043
 * und stimmt damit mit der Formel überein. Hier stehen die gerechneten Werte.
 */
const k = (meine, seine) => ang.kollaboFaktorOf({ meine, seine });
check('Kollabo mit Oxmo', nah(k(10_000, 350_000), 1.518768, 1e-5), String(k(10_000, 350_000)));
check('Kollabo mit Nina Chuba', nah(k(10_000, 3_200_000), 1.835502, 1e-5), String(k(10_000, 3_200_000)));
check('die Obergrenze ist das Doppelte', nah(k(10_000, 110_000_000), 2));
check('wer selbst groß ist, holt wenig', nah(k(1_000_000, 350_000), 1.043445, 1e-5), String(k(1_000_000, 350_000)));
check('ein Kontakt ohne Reichweite bringt nichts dazu', nah(k(10_000, 0), 1));
check('unter 100 eigenen Hörern wird mit 100 gerechnet',
  nah(k(1, 900), k(100, 900)));

console.log('--- Fristen ---');
const TAG = 86_400_000;
check('eine Anfrage läuft drei Tage', ang.fristOf(1000 * TAG) === 1003 * TAG);
check('ohne Uhr wird einmal gewürfelt', ang.rollTage(0, 5 * TAG) === 1);
check('zwei Tage geben zwei Würfe', ang.rollTage(1000 * TAG, 1002 * TAG) === 2);
check('mehr als sieben Tage werden nicht nachgeholt',
  ang.rollTage(1000 * TAG, 1030 * TAG) === 7);
check('innerhalb eines Tages wird nicht gewürfelt',
  ang.rollTage(1000 * TAG, 1000 * TAG + 3600e3) === 0);
check('eine Uhr aus der Zukunft würfelt nicht rückwärts',
  ang.rollTage(1000 * TAG, 999 * TAG) === 0);

console.log('--- Die sechs Arten ---');
check('es gibt sechs Arten', data.ARTEN.length === 6);
check('die Ids stehen so in der Spec',
  data.ARTEN.map((a) => a.id).join(',') === 'tausch,gastpart,vorgruppe,kollabo,tour,label');
check('jede Art hat Name, Emoji, Zeit und Draht-Schwelle',
  data.ARTEN.every((a) => a.name && a.emoji && typeof a.time === 'number' && typeof a.minDraht === 'number'));
check('die drei großen Formate kommen nur von Partnern',
  data.ARTEN.filter((a) => a.minDraht === 50).map((a) => a.id).join(',') === 'kollabo,tour,label');
check('die drei kleinen Anfragen kommen ab Bekanntschaft',
  data.ARTEN.filter((a) => a.minDraht === 20).map((a) => a.id).join(',') === 'tausch,gastpart,vorgruppe');
check('Kollabo und Tour kosten bei der Annahme keine Zeit',
  data.ARTEN.filter((a) => a.time === 0).map((a) => a.id).join(',') === 'kollabo,tour');
/**
 * Die Namen der Arten stehen in der Anzeige direkt neben dem Namen des
 * Kontakts – „seiner Platte" liest sich bei der Hälfte des Katalogs falsch.
 */
const POSSESSIV = /\b(seine[rmsn]?|ihre[rmsn]?)\b/i;
for (const a of data.ARTEN) {
  check(`${a.id} nennt kein Geschlecht`, !POSSESSIV.test(a.name), a.name);
}

console.log('--- Texte ---');
check('fünf Charakterzüge', Object.keys(data.LINES).length === 5);
check('und zwar dieselben wie in 5a/5b',
  Object.keys(data.LINES).sort().join(',') === 'arrogant,geschaeftlich,kollegial,kuehl,launisch');
/**
 * Die Sperrliste steht im Test, nicht im Datenmodul: Keine Pronomen über den
 * Kontakt (`{name}` ist ein echter Künstlername jeden Geschlechts), und nichts
 * über Meinung, Gesundheit, Familie oder Politik eines Menschen.
 */
const VERBOTEN = [' er ', ' sie ', ' ihn ', ' ihm ', ' ihr ', 'seine ', 'ihre ',
  'wirklich', 'Politik', 'krank', 'Familie'];
/**
 * Zweite Wache, mit Wortgrenzen: Die Liste oben kennt nur Wörter zwischen
 * Leerzeichen und sieht weder „seiner Platte" noch „ohne ihn." noch
 * gegenderte Nomen. Beide Wachen zusammen.
 */
const GESCHLECHT = new RegExp(
  '\\b(' + [
    'er', 'sie', 'ihn', 'ihm', 'ihr',
    'seine[rmsn]?', 'ihre[rmsn]?',
    'S(?:ä|ae)nger(?:in|innen)?', 'K(?:ü|ue)nstlerin(?:nen)?',
    'Kollege', 'Kollegin', 'Chef(?:in)?', 'Frau', 'Mann',
  ].join('|') + ')\\b', 'i');
let zeilen_gesamt = 0;
for (const [trait, lagen] of Object.entries(data.LINES)) {
  check(`${trait} hat drei Lagen`,
    Object.keys(lagen).sort().join(',') === 'absage,anfrage,zusage');
  for (const [lage, zeilen] of Object.entries(lagen)) {
    check(`${trait}/${lage} hat drei Zeilen`, zeilen.length === 3);
    for (const z of zeilen) {
      zeilen_gesamt++;
      check(`${trait}/${lage} nennt {name}`, z.includes('{name}'), z);
      check(`${trait}/${lage} bleibt in der Spielfiktion`,
        !VERBOTEN.some((w) => ` ${z.toLowerCase()} `.includes(w.toLowerCase())), z);
      check(`${trait}/${lage} sagt nichts über das Geschlecht`,
        !GESCHLECHT.test(z), z);
    }
  }
}
check('zusammen 45 Zeilen', zeilen_gesamt === 45);

console.log('--- Zahlen ohne eigenen Verhaltenstest ---');
check('Draht: Zusage +8, Absage -5, Liegenlassen -8',
  data.DRAHT_AN === 8 && data.DRAHT_AB === -5 && data.DRAHT_VERFALL === -8,
  `${data.DRAHT_AN} / ${data.DRAHT_AB} / ${data.DRAHT_VERFALL}`);
check('Liegenlassen kostet mehr Draht als Absagen', data.DRAHT_VERFALL < data.DRAHT_AB);

console.log('--- textFor ---');
check('der Name wird eingesetzt',
  ang.textFor('kollegial', 'anfrage', 'Taylor Swift', () => 0)
  === 'Taylor Swift schreibt: „Ich hab da was, das ohne dich nicht funktioniert."');
check('ein hoher Wurf nimmt die letzte Zeile',
  ang.textFor('kollegial', 'anfrage', 'Ado', () => 0.999)
  === data.LINES.kollegial.anfrage[2].replaceAll('{name}', 'Ado'));
check('auch ein Wurf von genau 1 bleibt in der Liste',
  ang.textFor('kuehl', 'absage', 'Rosalía', () => 1)
  === data.LINES.kuehl.absage[2].replaceAll('{name}', 'Rosalía'));
check('ein unbekannter Charakterzug gibt leer zurück',
  ang.textFor('gibtsnicht', 'anfrage', 'Rammstein') === '');
check('eine unbekannte Lage gibt leer zurück',
  ang.textFor('kollegial', 'gibtsnicht', 'Igor Levit') === '');
check('nach dem Einsetzen steht kein Platzhalter mehr drin',
  !ang.textFor('arrogant', 'zusage', 'Rammstein', () => 0.5).includes('{name}'));

/**
 * ===========================================================================
 *  STÜCK 2: DER ZUSTAND – ZUSTELLUNG, ANNEHMEN, ABLEHNEN
 * ===========================================================================
 *
 * Ab hier mit Datenbank. Jede Prüfung baut sich ihre eigene Welt (eigene
 * `guild_id`), damit keine Reihenfolge eine andere trägt. Der Zufall wird
 * immer hereingereicht: `immer` trifft jeden Wurf und nimmt bei jeder Auswahl
 * das erste Feld, `nie` trifft nie.
 */
(async () => {
  // Die Kasse wird abgefangen – geprüft wird, WAS gebucht wird (Betrag,
  // Grund, `kind`), nicht dass UnbelievaBoat erreichbar ist.
  const unb = require('../src/unb');
  unb.getBalance = async () => ({ cash: 0, bank: 0, total: 0 });
  const gebucht = [];
  unb.changeCash = async (g, u, amount, reason, opts = {}) => {
    gebucht.push({ guildId: g, userId: u, amount, reason, opts });
    return { cash: 0, bank: 0, total: 0 };
  };

  const db = require('../src/db');
  const music = require('../src/music');
  const creator = require('../src/creator');
  const home = require('../src/home');
  const contacts = require('../src/contacts');
  const cdata = require('../src/data/contacts');

  const STAMP = Date.now();
  let nr = 0;
  // Morgen früh um sechs: ein voller Tageshaushalt, volle Energie.
  const T0 = new Date(new Date().setHours(6, 0, 0, 0)).getTime() + 24 * 3600e3;
  const immer = () => 0;
  const nie = () => 0.9999;

  /** Eine frische Welt: ein deutscher Rapper mit 10.000 Hörern. */
  const welt = async (listeners = 10_000, t = T0) => {
    const G = `ANGEBOT_T${STAMP}_${++nr}`;
    const U = 'a1';
    await home.setHome(G, U, 'de');
    home.setLanguage(G, U, 'deutsch');
    music.setup(G, U, 'hiphop', music.PERSONAS[0].id);
    db.saveArtist(G, U, {
      ...db.getArtist(G, U, t), listeners,
      touched_at: t, last_action_at: t, paid_through: t,
    });
    return { G, U };
  };

  /** Draht auf einen Wert setzen, ohne Abklingen (last_move = jetzt). */
  const draht = (G, U, contactId, wert, t = T0) => db.saveContact(G, U, contactId,
    { draht: wert, tries: 0, yes: 0, last_try: 0, last_move: t, ignored_at: 0 });

  /** Eine Anfrage, die genau jetzt eingegangen ist. */
  const anfrage = (G, U, art, contactId, t = T0) => db.insertAngebot({
    guildId: G, userId: U, art, contactId, erstellt: t, frist: ang.fristOf(t) });

  const LILPFAND = cdata.byId('lilpfand');      // deutsch, Hip-Hop, 8.400
  const OXMO = cdata.byId('oxmopuccino');       // franzoesisch, Hip-Hop, 350.000
  const RAF = cdata.byId('rafcamora');          // deutsch, Hip-Hop, 6.500.000 – 650× von 10.000

  /**
   * Ein Würfel mit Gedächtnis: gibt die Werte der Reihe nach heraus, danach
   * immer 0,9999. Damit lässt sich ein Treffer erzwingen UND steuern, welche
   * Art gezogen wird – 0,9999 nimmt die LETZTE erlaubte.
   */
  const folge = (...werte) => { let i = 0; return () => (i < werte.length ? werte[i++] : 0.9999); };

  console.log('--- Tabellen ---');
  {
    const { G, U } = await welt();
    const row = db.insertAngebot({ guildId: G, userId: U, art: 'gastpart',
      contactId: 'apache', erstellt: T0, frist: T0 + 3 * TAG });
    check('ein Angebot bekommt eine id', row && row.id > 0);
    check('und steht in der Liste', db.angeboteOf(G, U).some((a) => a.id === row.id));
    check('die Uhr hat Vorgaben', db.angebotUhr(G, 'wer-auch-immer').last_roll === 0);
    check('und legt beim Lesen keine Zeile an (§4)',
      db.angebotUhr(G, 'wer-auch-immer').pause_bis === 0);
    const p = db.insertProjekt({ guildId: G, userId: U, art: 'kollabo',
      contactId: 'apache', stundenSoll: 18, frist: T0 + 14 * TAG });
    check('ein Projekt bekommt eine id und beginnt bei 0 Stunden',
      p && p.id > 0 && p.stunden_ist === 0 && p.stunden_soll === 18);
    check('Projektstunden lassen sich in camelCase fortschreiben',
      db.saveProjekt(G, p.id, { stundenIst: 4 }).stunden_ist === 4);
    check('und der Status eines Angebots auch',
      db.saveAngebot(G, row.id, { status: 'ab' }).status === 'ab');
    db.saveAngebotUhr(G, U, { last_roll: T0, abgelehnt_folge: 2, pause_bis: T0 + TAG });
    check('die Uhr behält, was sie bekommt',
      db.angebotUhr(G, U).last_roll === T0 && db.angebotUhr(G, U).abgelehnt_folge === 2
      && db.angebotUhr(G, U).pause_bis === T0 + TAG);
    db.clearAngebote(G, U);
    check('clearAngebote räumt Anfragen, Projekte und Uhr ab',
      db.angeboteOf(G, U).length === 0 && db.projekteOf(G, U).length === 0
      && db.angebotUhr(G, U).last_roll === 0);
  }

  console.log('--- Zustellung ---');
  {
    const { G, U } = await welt();
    db.saveAngebotUhr(G, U, { last_roll: T0 - 10 * TAG, abgelehnt_folge: 0, pause_bis: 0 });
    const ev = ang.settle(G, U, T0, immer);
    check('bei Draht 0 meldet sich niemand – auch nach zehn Tagen nicht',
      ev.length === 0 && ang.offeneAngebote(G, U, T0).length === 0, JSON.stringify(ev));
  }
  {
    const { G, U } = await welt();
    draht(G, U, LILPFAND.id, 60);
    db.saveAngebotUhr(G, U, { last_roll: T0 - 10 * TAG, abgelehnt_folge: 0, pause_bis: 0 });
    const ev = ang.settle(G, U, T0, immer);
    const neu = ev.filter((e) => e.art === 'neu');
    check('bei Draht 60 kommt eine Anfrage, und zwar von ihm',
      neu.length >= 1 && neu[0].contact.id === LILPFAND.id, JSON.stringify(ev));
    check('mit Frist von drei Tagen und einer Zeile im Ton des Kontakts',
      neu[0].angebot.frist === T0 + data.FRIST_TAGE * TAG
      && neu[0].text.includes(LILPFAND.name), JSON.stringify(neu[0]));
    check('und nie mehr als ANFRAGEN_MAX offene',
      ang.offeneAngebote(G, U, T0).length === data.ANFRAGEN_MAX,
      String(ang.offeneAngebote(G, U, T0).length));
  }
  {
    const { G, U } = await welt();
    db.saveAngebotUhr(G, U, { last_roll: T0 - 30 * TAG, abgelehnt_folge: 0, pause_bis: 0 });
    let rufe = 0;
    ang.settle(G, U, T0, () => { rufe++; return 0.9999; });
    check('30 Tage Abwesenheit geben höchstens ROLL_TAGE_MAX Würfe',
      rufe === data.ROLL_TAGE_MAX, String(rufe));
    check('und die Uhr rückt auf jetzt vor (sonst würfelt der nächste Blick erneut)',
      db.angebotUhr(G, U).last_roll === T0);
  }
  {
    const { G, U } = await welt();
    draht(G, U, LILPFAND.id, 60);
    db.saveAngebotUhr(G, U, { last_roll: T0 - 2 * TAG, abgelehnt_folge: 0, pause_bis: 0 });
    const erst = ang.settle(G, U, T0, immer);
    const liste = JSON.stringify(db.angeboteOf(G, U));
    const uhr = JSON.stringify(db.angebotUhr(G, U));
    const zweit = ang.settle(G, U, T0, immer);
    check('settle ist idempotent: der zweite Lauf ändert nichts',
      erst.length === 2 && zweit.length === 0
      && JSON.stringify(db.angeboteOf(G, U)) === liste
      && JSON.stringify(db.angebotUhr(G, U)) === uhr, JSON.stringify(zweit));
  }

  console.log('--- Verfallen ---');
  {
    const { G, U } = await welt();
    draht(G, U, LILPFAND.id, 60);
    const row = anfrage(G, U, 'tausch', LILPFAND.id);
    const spaet = T0 + 4 * TAG;
    const zeitVor = creator.budget(G, U, spaet).left;
    const r = await ang.annehmen(G, U, row.id, spaet, nie);
    check('eine verstrichene Anfrage lässt sich nicht annehmen',
      r.ok === false, JSON.stringify(r));
    check('sie kostet dabei keine Zeit – die Zeitbuchung steht hinter jeder Prüfung',
      creator.budget(G, U, spaet).left === zeitVor);
    check('ihr Status ist "verfallen", nicht "an"',
      db.angebotRow(G, row.id).status === 'verfallen');
    check('Verfallen kostet 8 Draht',
      db.getContact(G, U, LILPFAND.id).draht === 60 + data.DRAHT_VERFALL,
      String(db.getContact(G, U, LILPFAND.id).draht));
    check('und zählt als nicht angenommen', db.angebotUhr(G, U).abgelehnt_folge === 1);
    check('das Verfallen steht in `vorher` genau dieses Klicks',
      (r.vorher ?? []).some((e) => e.art === 'verfallen' && e.angebot.id === row.id),
      JSON.stringify(r.vorher));
    const nochmal = await ang.annehmen(G, U, row.id, spaet, nie);
    check('ein zweiter Klick darauf meldet nur noch "weg"',
      nochmal.ok === false && nochmal.reason === 'weg' && nochmal.vorher.length === 0,
      JSON.stringify(nochmal));
  }

  console.log('--- Annehmen und Ablehnen ---');
  {
    const { G, U } = await welt();
    draht(G, U, LILPFAND.id, 30);
    db.saveAngebotUhr(G, U, { last_roll: T0, abgelehnt_folge: 2, pause_bis: 0 });
    const row = anfrage(G, U, 'tausch', LILPFAND.id);
    const zeitVor = creator.budget(G, U, T0).left;
    const kasseVor = gebucht.length;
    const r = await ang.annehmen(G, U, row.id, T0, nie);
    check('tausch lässt sich annehmen', r.ok === true, JSON.stringify(r));
    check('Status "an"', db.angebotRow(G, row.id).status === 'an');
    check('Draht +8', db.getContact(G, U, LILPFAND.id).draht === 30 + data.DRAHT_AN,
      String(db.getContact(G, U, LILPFAND.id).draht));
    check('abgelehnt_folge zurück auf 0', db.angebotUhr(G, U).abgelehnt_folge === 0);
    check('zwei Stunden gebucht', creator.budget(G, U, T0).left === zeitVor - 2,
      String(creator.budget(G, U, T0).left));
    // Derselbe Schub, den ein shoutout in 5a setzt: 1 + 3 × Stärke, Stufe 'zusage'.
    const staerke = contacts.staerkeOf({ seineReichweite: LILPFAND.reach,
      meineReichweite: 10_000, passung: 1, stufe: 'zusage' });
    const boost = contacts.activeBoost(G, U, 'release', T0);
    check('tausch setzt den Reichweiten-Schub (1 + 3 × Stärke)',
      boost && nah(boost.factor, Math.min(4, 1 + 3 * staerke)) && nah(boost.factor, 1.264824, 1e-5),
      JSON.stringify(boost));
    check('und kostet die Kasse nichts', r.geld === null && gebucht.length === kasseVor);
  }
  {
    const { G, U } = await welt();
    draht(G, U, LILPFAND.id, 30);
    const row = anfrage(G, U, 'tausch', LILPFAND.id);
    const zeitVor = creator.budget(G, U, T0).left;
    const r = ang.ablehnen(G, U, row.id, T0, nie);
    check('Ablehnen klappt und erzählt die Absage',
      r.ok === true && r.text.includes(LILPFAND.name), JSON.stringify(r));
    check('Draht −5', db.getContact(G, U, LILPFAND.id).draht === 30 + data.DRAHT_AB,
      String(db.getContact(G, U, LILPFAND.id).draht));
    check('Ablehnen kostet keine Zeit', creator.budget(G, U, T0).left === zeitVor);
    check('Status "ab", und es zählt als nicht angenommen',
      db.angebotRow(G, row.id).status === 'ab' && db.angebotUhr(G, U).abgelehnt_folge === 1);
  }

  console.log('--- Honorar und Gage ---');
  {
    const { G, U } = await welt();
    draht(G, U, LILPFAND.id, 30);
    const row = anfrage(G, U, 'gastpart', LILPFAND.id);
    const kasseVor = gebucht.length;
    const r = await ang.annehmen(G, U, row.id, T0, nie);
    // 3 × 8.400^0,6 = 679; der Deckel (30 × ~949/Tag = 28.468) greift nicht.
    check('gastpart zahlt das Honorar von 679',
      r.ok === true && r.honorar === 679 && r.geld?.amount === 679, JSON.stringify(r.geld));
    check('genau eine Buchung, mit `kind: music` – daran hängt die Erfahrung',
      gebucht.length === kasseVor + 1 && gebucht.at(-1).amount === 679
      && gebucht.at(-1).opts.kind === 'music', JSON.stringify(gebucht.at(-1)));
    check('die Buchung nennt den Kontakt', gebucht.at(-1).reason.includes(LILPFAND.name),
      gebucht.at(-1).reason);
    check('und gastpart setzt denselben Schub wie tausch',
      nah(contacts.activeBoost(G, U, 'release', T0)?.factor ?? 0, 1.264824, 1e-5));
  }
  {
    const { G, U } = await welt();
    draht(G, U, OXMO.id, 30);
    const row = anfrage(G, U, 'vorgruppe', OXMO.id);
    const kasseVor = gebucht.length;
    const zeitVor = creator.budget(G, U, T0).left;
    const r = await ang.annehmen(G, U, row.id, T0, nie);
    // 8 × (10.000 + min(10.000, 350.000 × 0,05))^0,7 = 8 × 20.000^0,7 = 8.200
    check('vorgruppe zahlt die Gage von 8.200',
      r.ok === true && r.gage === 8_200 && r.geld?.amount === 8_200, JSON.stringify(r.geld));
    /**
     * Sein Publikum ist auf die eigene Hörerschaft gedeckelt und steckt
     * ausschließlich in der GAGE (8.200 statt 5.195 allein – genau 2^0,7). Auf
     * die Hörerschaft kommt nur, was ein Konzert ohnehin bindet: 2 % = 200.
     */
    check('die mitgebrachten Hörer sind auf die eigene Hörerschaft gedeckelt',
      r.extraHoerer === 10_000, String(r.extraHoerer));
    check('sie heben die Gage, NICHT die Hörerschaft – die wächst wie bei jedem Konzert um 2 %',
      music.status(G, U, T0).listeners === 10_200 && r.auftritt?.gained === 200,
      JSON.stringify({ h: music.status(G, U, T0).listeners, g: r.auftritt?.gained }));
    check('die Vorgruppe zählt als Konzert und setzt dessen Sperre',
      music.status(G, U, T0).showMs > 0 && music.status(G, U, T0).shows === 1);
    check('vier Stunden gebucht', creator.budget(G, U, T0).left === zeitVor - 4);
    check('auch hier genau eine Buchung mit `kind: music`',
      gebucht.length === kasseVor + 1 && gebucht.at(-1).opts.kind === 'music');
  }
  /**
   * Der Befund, der diesen Test erzwungen hat: Solange die mitgebrachten Hörer
   * in die BASIS liefen, verdoppelte jeder Partner mit ≥ 20-facher Reichweite
   * die Hörerschaft auf einen Klick – und weil die Tantiemen mit `hörer^1,2`
   * wachsen, war das kein Zuschlag, sondern ein Zinssatz: Bei 10.000 Hörern
   * sprangen sie von 1.091 auf 2.507 am Tag, für immer. RAF Camora hat die
   * 650-fache Reichweite; mit dem alten Code stünden hier 20.000 Hörer.
   */
  {
    const { G, U } = await welt();
    draht(G, U, RAF.id, 30);
    const row = anfrage(G, U, 'vorgruppe', RAF.id);
    const tantVor = music.royaltyPerDay(10_000, music.marketOf(G, U));
    const r = await ang.annehmen(G, U, row.id, T0, nie);
    const nachher = music.status(G, U, T0).listeners;
    check('ein Partner mit 650-facher Reichweite verdoppelt die Hörerschaft NICHT',
      r.ok === true && nachher === 10_200, JSON.stringify({ ok: r.ok, h: nachher }));
    check('und zwar unabhängig davon, wie groß er ist – 2 % sind 2 %',
      nachher - 10_000 === music.showGain(10_000), String(nachher - 10_000));
    // 8 × (10.000 + 10.000)^0,7: dieselbe Deckelung wie bei Oxmo, denn 5 % von
    // 6,5 Mio sind 325.000 und davon zählen nur die eigenen 10.000.
    check('die Gage trägt sein Publikum weiterhin voll (8.200 statt 5.195)',
      r.gage === 8_200 && r.extraHoerer === 10_000, JSON.stringify({ g: r.gage, e: r.extraHoerer }));
    check('die Tantiemen steigen dadurch um höchstens die 2 % des Konzerts',
      music.royaltyPerDay(nachher, music.marketOf(G, U)) < tantVor * 1.03,
      `${tantVor} -> ${music.royaltyPerDay(nachher, music.marketOf(G, U))}`);
  }
  /**
   * SHOW_MIN_LISTENERS (5.000) gilt für die Vorgruppe ABSICHTLICH nicht: Die
   * Halle füllt der Hauptact, nicht man selbst. Das ist der Weg, auf dem ein
   * kleiner Künstler überhaupt auf eine Bühne kommt – und kein Hahn, weil
   * Gage und Zuwachs an der EIGENEN Größe hängen.
   */
  {
    const { G, U } = await welt(400);
    draht(G, U, RAF.id, 30);
    const eigenes = await music.show(G, U, T0, nie);
    check('mit 400 Hörern gibt es kein eigenes Konzert',
      eigenes.ok === false && eigenes.reason === 'too_small', JSON.stringify(eigenes));
    const row = anfrage(G, U, 'vorgruppe', RAF.id);
    const r = await ang.annehmen(G, U, row.id, T0, nie);
    // 8 × (400 + 400)^0,7 = 861; allein wären es 530.
    check('eine Vorgruppe aber doch – für 861 statt 530',
      r.ok === true && r.gage === 861, JSON.stringify({ ok: r.ok, reason: r.reason, g: r.gage }));
    check('und sie macht aus 400 Hörern 408, nicht 800',
      music.status(G, U, T0).listeners === 408,
      String(music.status(G, U, T0).listeners));
  }

  console.log('--- Die drei Ausnahmen bei der Art (artenFuer) ---');
  {
    const { G, U } = await welt();
    const ids = (d, t = T0) => ang.artenFuer(G, U, d, t).map((a) => a.id).join(',');
    check('bei Draht 20 gibt es nur die drei kleinen Arten',
      ids(20) === 'tausch,gastpart,vorgruppe', ids(20));
    check('ein Partner bekommt alle sechs',
      ids(50) === 'tausch,gastpart,vorgruppe,kollabo,tour,label', ids(50));
  }
  {
    // 1. Ausnahme: `label` fällt weg, solange ein ANGEBOT offen ist.
    const { G, U } = await welt();
    const c = db.insertContract({ guildId: G, userId: U, kind: 'idol', agency: 'A',
      country: 'jp', createdAt: T0, expiresAt: T0 + 2 * TAG });
    check('ein offenes Vertragsangebot nimmt `label` aus der Auswahl',
      !ang.artenFuer(G, U, 100, T0).some((a) => a.id === 'label'),
      ang.artenFuer(G, U, 100, T0).map((a) => a.id).join(','));
    check('die anderen fünf bleiben',
      ang.artenFuer(G, U, 100, T0).length === 5);
    check('nach Ablauf des Angebots ist `label` wieder dabei',
      ang.artenFuer(G, U, 100, T0 + 3 * TAG).some((a) => a.id === 'label'));
    // 2. Ausnahme: und erst recht, solange ein Vertrag LÄUFT. Das ist die, auf
    //    die es ankommt: Ein zweites `label` wäre ein zweiter Zehn-Tage-
    //    Vorschuss auf denselben Künstler (§3).
    db.setContractStatus(G, c.id, 'active', { signedAt: T0, endsAt: T0 + 365 * TAG });
    check('ein laufender Vertrag nimmt `label` ebenfalls heraus – kein zweiter Vorschuss',
      !ang.artenFuer(G, U, 100, T0 + 3 * TAG).some((a) => a.id === 'label'),
      ang.artenFuer(G, U, 100, T0 + 3 * TAG).map((a) => a.id).join(','));
  }
  {
    // 3. Ausnahme: `kollabo` und `tour` fallen weg, solange ein Projekt offen
    //    ist – zwei Stundenkonten gleichzeitig wären eine zweite Tagesordnung.
    const { G, U } = await welt();
    const pr = db.insertProjekt({ guildId: G, userId: U, art: 'kollabo',
      contactId: RAF.id, stundenSoll: 18, frist: T0 + 14 * TAG });
    const offen = ang.artenFuer(G, U, 100, T0).map((a) => a.id);
    check('ein offenes Projekt nimmt `kollabo` und `tour` heraus',
      offen.join(',') === 'tausch,gastpart,vorgruppe,label', offen.join(','));
    db.saveProjekt(G, pr.id, { status: 'fertig' });
    check('ist es fertig, sind beide wieder da',
      ang.artenFuer(G, U, 100, T0).length === 6);
  }
  {
    // Und das Ganze bis in die Zustellung: `folge(0, 0)` erzwingt einen Treffer
    // beim ersten Wurf, danach nimmt 0,9999 die LETZTE erlaubte Art.
    const { G, U } = await welt();
    draht(G, U, LILPFAND.id, 60);
    db.saveAngebotUhr(G, U, { last_roll: T0 - TAG, abgelehnt_folge: 0, pause_bis: 0 });
    const frei = ang.settle(G, U, T0, folge(0, 0));
    check('ohne Vertrag und ohne Projekt stellt die letzte Wahl `label` zu',
      frei.filter((e) => e.art === 'neu').map((e) => e.angebot.art).join(',') === 'label',
      JSON.stringify(frei.map((e) => e.angebot?.art)));
  }
  {
    const { G, U } = await welt();
    draht(G, U, LILPFAND.id, 60);
    db.saveAngebotUhr(G, U, { last_roll: T0 - TAG, abgelehnt_folge: 0, pause_bis: 0 });
    db.insertContract({ guildId: G, userId: U, kind: 'idol', agency: 'A', country: 'jp',
      createdAt: T0, expiresAt: T0 + 2 * TAG });
    db.insertProjekt({ guildId: G, userId: U, art: 'tour', contactId: RAF.id,
      stundenSoll: 30, frist: T0 + 14 * TAG });
    const ev = ang.settle(G, U, T0, folge(0, 0));
    const arten = ev.filter((e) => e.art === 'neu').map((e) => e.angebot.art);
    check('mit Vertragsangebot UND Projekt bleibt nur die kleine Auswahl übrig',
      arten.join(',') === 'vorgruppe', arten.join(','));
    check('kein zugestelltes Angebot ist `label`, `kollabo` oder `tour`',
      !arten.some((a) => ['label', 'kollabo', 'tour'].includes(a)), arten.join(','));
  }

  console.log('--- Ein Blick schreibt nichts (§4) ---');
  {
    /**
     * `musikIch` geht über `music.status` → `db.getArtist`, und das LEGT den
     * Künstler an. Gefragt wird darum erst, wenn wirklich gewürfelt wird:
     * Ein Blick ohne fälligen Wurf darf keine Zeile schreiben.
     */
    const G = `ANGEBOT_T${STAMP}_${++nr}`;
    const U = 'nie-musik-gemacht';
    db.saveAngebotUhr(G, U, { last_roll: T0, abgelehnt_folge: 0, pause_bis: 0 });
    const uhrVor = JSON.stringify(db.angebotUhr(G, U));
    let rufe = 0;
    const ev = ang.settle(G, U, T0, () => { rufe++; return 0; });
    check('ein Blick ohne fälligen Wurf meldet nichts und würfelt nicht',
      ev.length === 0 && rufe === 0, JSON.stringify(ev));
    check('und legt KEINE Künstlerzeile an', db.hasArtist(G, U) === false);
    check('die Uhr bleibt dabei unberührt', JSON.stringify(db.angebotUhr(G, U)) === uhrVor);
  }

  console.log('--- Pause nach drei Mal ---');
  {
    const { G, U } = await welt();
    draht(G, U, LILPFAND.id, 60);
    db.saveAngebotUhr(G, U, { last_roll: T0, abgelehnt_folge: 0, pause_bis: 0 });
    for (let i = 0; i < data.PAUSE_SCHWELLE; i++) {
      const row = anfrage(G, U, 'tausch', LILPFAND.id);
      ang.ablehnen(G, U, row.id, T0, nie);
    }
    check('dreimal abgelehnt wird gezählt', db.angebotUhr(G, U).abgelehnt_folge === 3,
      String(db.angebotUhr(G, U).abgelehnt_folge));
    ang.settle(G, U, T0, nie);
    const uhr = db.angebotUhr(G, U);
    check('danach ruht der Zustellweg 14 Tage, und der Zähler steht wieder auf 0',
      uhr.pause_bis === T0 + data.PAUSE_TAGE * TAG && uhr.abgelehnt_folge === 0,
      JSON.stringify(uhr));
    const inPause = ang.settle(G, U, T0 + 7 * TAG, immer);
    check('in der Pause meldet sich niemand',
      inPause.filter((e) => e.art === 'neu').length === 0, JSON.stringify(inPause));
    const danach = ang.settle(G, U, T0 + 15 * TAG, immer);
    check('nach der Pause wieder', danach.some((e) => e.art === 'neu'),
      JSON.stringify(danach));
  }

  /**
   * ===========================================================================
   *  STÜCK 4: DIE LABEL-TÜR
   * ===========================================================================
   *
   * Bis hierher konnte nur ein Idol in Japan oder Korea etwas unterschreiben –
   * ein deutscher Rapper nie. `label` ist die Tür, die das ändert: weniger
   * Schub als der Idol-Vertrag, aber auch weniger Fessel, und in JEDEM Markt.
   *
   * Geprüft wird darum nicht nur, DASS ein Angebot entsteht, sondern dass es
   * das richtige ist (Art, Label, Land, Frist) – und was der Klick kostet,
   * wenn er ins Leere geht.
   */
  console.log('--- Die Label-Tür: die Schwelle ---');
  {
    const { G, U } = await welt();              // 10.000 Hörer, unter 25.000
    draht(G, U, LILPFAND.id, 60);
    const row = anfrage(G, U, 'label', LILPFAND.id);
    const zeitVor = creator.budget(G, U, T0).left;
    const r = await ang.annehmen(G, U, row.id, T0, nie);
    check('unter 25.000 Hörern antwortet `label` mit "zu_klein"',
      r.ok === false && r.reason === 'zu_klein' && r.need === 25_000, JSON.stringify(r));
    check('die Schwelle ist die des Labels, nicht die des Idols (25.000 < 100.000)',
      music.LABEL.minListeners === 25_000 && music.IDOL.minListeners === 100_000);
    /**
     * Der Punkt, an dem Task 2 den Maßstab gesetzt hat: Eine Voraussetzung ist
     * kein Ergebnis. Eine Absage darf die zwei Stunden nicht kosten und keine
     * Zeile anfassen – sonst zahlt man für ein „zu klein".
     */
    check('und kostet weder Zeit noch Status noch eine Vertragszeile',
      creator.budget(G, U, T0).left === zeitVor
      && db.angebotRow(G, row.id).status === 'offen'
      && db.openContract(G, U, T0) === null);
  }

  console.log('--- Die Label-Tür: der Regelfall ---');
  {
    const { G, U } = await welt(30_000);
    draht(G, U, LILPFAND.id, 60);
    const row = anfrage(G, U, 'label', LILPFAND.id);
    const zeitVor = creator.budget(G, U, T0).left;
    const kasseVor = gebucht.length;
    const r = await ang.annehmen(G, U, row.id, T0, nie);
    check('ab 25.000 Hörern öffnet der Partner die Tür', r.ok === true, JSON.stringify(r));
    const offer = db.openContract(G, U, T0);
    check('es entsteht ein Vertragsangebot der Art `label`',
      Boolean(offer) && offer.kind === 'label' && offer.status === 'offer',
      JSON.stringify(offer));
    check('bei SEINEM Label und in SEINEM Land – kein Umzug nach Tokio',
      offer.agency === LILPFAND.name && offer.country === LILPFAND.country,
      `${offer.agency} / ${offer.country}`);
    check('die Rückgabe trägt dasselbe Angebot mit hinaus',
      r.vertragsangebot?.id === offer.id, JSON.stringify(r.vertragsangebot));
    check('mit derselben Drei-Tage-Frist wie das Idol-Angebot',
      music.CONTRACT_OFFER_MS === 3 * TAG && offer.expires_at === T0 + 3 * TAG,
      String(offer.expires_at - T0));
    check('die Einführung kostet die zwei Stunden aus der Spec',
      creator.budget(G, U, T0).left === zeitVor - 2,
      String(zeitVor - creator.budget(G, U, T0).left));
    check('aber kein Geld – der Vorschuss hängt an der Unterschrift, nicht an der Zusage',
      gebucht.length === kasseVor && r.geld === null);
    check('die Anfrage ist angenommen', db.angebotRow(G, row.id).status === 'an');

    // Die Frist läuft wie beim Idol-Angebot ab.
    check('nach drei Tagen ist das Angebot weg',
      db.openContract(G, U, T0 + 3 * TAG) === null);
    check('und es wurde nie ein Vertrag daraus', music.contractOf(G, U) === null);
  }

  console.log('--- Die Label-Tür: der Vertrag selbst ---');
  {
    const { G, U } = await welt(30_000);
    draht(G, U, LILPFAND.id, 60);
    const row = anfrage(G, U, 'label', LILPFAND.id);
    await ang.annehmen(G, U, row.id, T0, nie);
    const offer = db.openContract(G, U, T0);

    const tSign = T0 + 3600e3;
    const perTag = music.royaltyPerDay(
      db.getArtist(G, U, tSign).listeners, music.marketOf(G, U));
    const kasseVor = gebucht.length;
    const signed = await music.sign(G, U, offer.id, tSign);
    check('unterschreiben bringt 10 Tage Tantiemen, nicht 25 wie beim Idol',
      signed.ok === true
      && signed.advance === require('../src/perks').payout(G, U, Math.round(perTag * 10)),
      JSON.stringify({ a: signed.advance, soll: Math.round(perTag * 10) }));
    check('und zwar als genau eine Buchung', gebucht.length === kasseVor + 1
      && gebucht.at(-1).amount === signed.advance
      && gebucht.at(-1).reason === `Vorschuss: ${LILPFAND.name}`,
      JSON.stringify(gebucht.at(-1)));
    check('der Vertrag läuft 60 Tage, nicht 90',
      signed.contract.ends_at === tSign + 60 * TAG,
      String((signed.contract.ends_at - tSign) / TAG));
    check('die zurückgegebenen Konditionen sind die des Labels',
      signed.terms === music.LABEL);

    /**
     * Die Stelle, vor der das Aufgabenheft gewarnt hat: `payGig` ist die EINE
     * Geldtür für Honorar und Gage. Stünde dort noch `data.IDOL`, zöge dieser
     * Vertrag 50 % statt 30 % ab – 20 Punkte, die niemand im Spiel wiederfindet.
     */
    const geld = await music.payGig(G, U, 1_000, 'Test');
    check('das Label nimmt 30 % von jedem Honorar und jeder Gage, nicht 50 %',
      geld.cut === 300 && geld.amount === 700, JSON.stringify(geld));
    check('die Anzeige rechnet mit denselben 30 %',
      music.status(G, U, tSign).perDay === Math.round(
        music.royaltyPerDay(music.status(G, U, tSign).listeners, music.marketOf(G, U)) * 0.7),
      String(music.status(G, U, tSign).perDay));

    // Raus kostet 15 Tage, nicht 30.
    const kasse2 = gebucht.length;
    // Der Tagessatz VOR dem Ausstieg: `leave` kostet auch 10 % der Hörerschaft,
    // und danach ist der Satz ein anderer.
    const perTag2 = music.royaltyPerDay(
      db.getArtist(G, U, tSign + 10 * TAG).listeners, music.marketOf(G, U));
    const left = await music.leave(G, U, tSign + 10 * TAG);
    check('vorzeitig raus kostet 15 Tage Einnahmen, nicht 30',
      left.ok === true && left.penalty === Math.round(perTag2 * 15),
      JSON.stringify({ p: left.penalty, soll: Math.round(perTag2 * 15) }));
    check('und zwar als eine Abbuchung',
      gebucht.length === kasse2 + 1 && gebucht.at(-1).amount === -left.penalty);
    check('danach ist man frei', music.contractOf(G, U) === null);
  }

  console.log('--- Die Label-Tür: kein Gesicht nötig ---');
  {
    /**
     * Der Unterschied zum Idol-Angebot, auf den es ankommt: Das Label fragt
     * nicht nach dem Gesicht. Ein anonymer Künstler bekommt NIE ein
     * Idol-Angebot (`rollContract`), aber sehr wohl einen Label-Vertrag.
     */
    const G = `ANGEBOT_T${STAMP}_${++nr}`;
    const U = 'anonym';
    await home.setHome(G, U, 'de');
    home.setLanguage(G, U, 'deutsch');
    music.setup(G, U, 'hiphop', 'anon');
    db.saveArtist(G, U, {
      ...db.getArtist(G, U, T0), listeners: 30_000,
      touched_at: T0, last_action_at: T0, paid_through: T0,
    });
    draht(G, U, LILPFAND.id, 60);
    const row = anfrage(G, U, 'label', LILPFAND.id);
    const r = await ang.annehmen(G, U, row.id, T0, nie);
    check('ein anonymer Künstler bekommt den Label-Vertrag',
      r.ok === true && db.openContract(G, U, T0)?.kind === 'label', JSON.stringify(r));
    check('obwohl ihm ein Idol-Angebot verwehrt bliebe',
      music.rollContract(G, U, 300_000, { ...music.marketOf(G, U), idol: true },
        T0, () => 0) === null);
    check('und er bleibt anonym – das Label schreibt ihm das Auftreten nicht vor',
      music.status(G, U, T0).persona.id === 'anon');
  }

  console.log('--- Die Label-Tür: nur einmal ---');
  {
    const { G, U } = await welt(30_000);
    draht(G, U, LILPFAND.id, 60);
    const laeuft = db.insertContract({ guildId: G, userId: U, kind: 'idol', agency: 'A',
      country: 'jp', createdAt: T0, expiresAt: T0 + 2 * TAG });
    db.setContractStatus(G, laeuft.id, 'active', { signedAt: T0, endsAt: T0 + 90 * TAG });
    const row = anfrage(G, U, 'label', LILPFAND.id);
    const zeitVor = creator.budget(G, U, T0).left;
    const r = await ang.annehmen(G, U, row.id, T0, nie);
    /**
     * `artenFuer` lässt die Anfrage gar nicht erst zustellen – aber zwischen
     * Zustellung und Klick liegen bis zu drei Tage. Ohne diese zweite Prüfung
     * stünde hier ein zweiter Vorschuss auf denselben Künstler.
     */
    check('ein laufender Vertrag macht die Zusage unmöglich',
      r.ok === false && r.reason === 'vertrag_offen', JSON.stringify(r));
    check('auch das kostet keine Zeit und keinen Status',
      creator.budget(G, U, T0).left === zeitVor
      && db.angebotRow(G, row.id).status === 'offen');
    // Und genauso bei einem noch OFFENEN Angebot.
    const { G: G2, U: U2 } = await welt(30_000);
    draht(G2, U2, LILPFAND.id, 60);
    db.insertContract({ guildId: G2, userId: U2, kind: 'idol', agency: 'A',
      country: 'jp', createdAt: T0, expiresAt: T0 + 2 * TAG });
    const row2 = anfrage(G2, U2, 'label', LILPFAND.id);
    const r2 = await ang.annehmen(G2, U2, row2.id, T0, nie);
    check('ein offenes Angebot ebenso – kein zweites daneben',
      r2.ok === false && r2.reason === 'vertrag_offen', JSON.stringify(r2));
  }

  /**
   * =========================================================================
   *  STÜCK 3: DIE PROJEKTE – KOLLABO-ALBUM UND TOUR
   * =========================================================================
   *
   * Ein Projekt ist ein Stundenkonto aus demselben Tagesbudget wie alles
   * andere. Geprüft wird darum nicht nur, DASS das Ergebnis kommt, sondern vor
   * allem, was es KOSTET und was es NICHT anfasst:
   *
   *   • 18 Stunden für das Kollabo, nicht 18 + 3 für die Platte dazu
   *   • 24 Stunden für die Tour, nicht 24 + 20 für fünf Konzerte dazu
   *   • sein Publikum hebt die GAGE eines Abends, nie die Hörerschaft
   *   • die Konzert-Sperre gilt nach der Tour wieder wie immer
   *   • eine gerissene Frist frisst die investierten Stunden (Absicht)
   *   • `vorher` kommt auf JEDEM Rückweg mit heraus, auch auf jedem
   *     abgewiesenen – sonst verschluckt ein ins Leere gehender Klick eine
   *     verfallene Anfrage samt Draht-Verlust.
   *
   * Die Uhr wird in jedem Block auf `jetzt` gesetzt: Sonst holt Schritt 0
   * einen Tageswurf nach, verbraucht Zufall und verschiebt jede Zahl danach.
   */
  console.log('--- Projekt annehmen ---');
  {
    const { G, U } = await welt();
    draht(G, U, RAF.id, 60);
    db.saveAngebotUhr(G, U, { last_roll: T0, abgelehnt_folge: 2, pause_bis: 0 });
    const row = anfrage(G, U, 'kollabo', RAF.id);
    const zeitVor = creator.budget(G, U, T0).left;
    const kasseVor = gebucht.length;
    const r = await ang.annehmen(G, U, row.id, T0, nie);
    check('kollabo lässt sich annehmen und öffnet ein Projekt',
      r.ok === true && r.projekt?.art === 'kollabo', JSON.stringify(r.reason ?? r.projekt));
    check('18 Stunden zu füllen, bei 0 angefangen, Frist 14 Tage',
      r.projekt.stunden_soll === data.KOLLABO_STUNDEN && r.projekt.stunden_ist === 0
      && r.projekt.frist === T0 + data.PROJEKT_FRIST_TAGE * TAG, JSON.stringify(r.projekt));
    check('die Annahme selbst kostet keine Zeit (time: 0)',
      creator.budget(G, U, T0).left === zeitVor, String(creator.budget(G, U, T0).left));
    check('und keinen Cent – das Kollabo zahlt erst, wenn es erscheint',
      r.geld === null && gebucht.length === kasseVor);
    check('Status "an", Draht +8, Zähler zurück auf 0',
      db.angebotRow(G, row.id).status === 'an'
      && db.getContact(G, U, RAF.id).draht === 60 + data.DRAHT_AN
      && db.angebotUhr(G, U).abgelehnt_folge === 0);
    const offen = ang.offeneProjekte(G, U, T0);
    check('es steht in offeneProjekte, mit Kontakt und Restzeit',
      offen.length === 1 && offen[0].contact.id === RAF.id
      && offen[0].restMs === data.PROJEKT_FRIST_TAGE * TAG, JSON.stringify(offen[0]?.restMs));
    // Und das Gegenstück zur dritten Ausnahme in `artenFuer`, diesmal über den
    // ganzen Weg: Wer ein Konto offen hat, bekommt kein zweites angeboten.
    db.saveAngebotUhr(G, U, { last_roll: T0 - TAG, abgelehnt_folge: 0, pause_bis: 0 });
    const ev = ang.settle(G, U, T0, folge(0, 0));
    const arten = ev.filter((e) => e.art === 'neu').map((e) => e.angebot.art);
    check('solange es offen ist, kommt keine zweite kollabo- oder tour-Anfrage',
      arten.length === 1 && !arten.some((a) => ['kollabo', 'tour'].includes(a)),
      arten.join(','));
  }
  {
    const { G, U } = await welt();
    draht(G, U, RAF.id, 60);
    db.saveAngebotUhr(G, U, { last_roll: T0, abgelehnt_folge: 0, pause_bis: 0 });
    const row = anfrage(G, U, 'tour', RAF.id);
    const r = await ang.annehmen(G, U, row.id, T0, nie);
    check('tour öffnet ein Konto über 24 Stunden',
      r.ok === true && r.projekt?.art === 'tour'
      && r.projekt.stunden_soll === data.TOUR_STUNDEN, JSON.stringify(r.reason ?? r.projekt));
  }

  console.log('--- arbeiten: zwei Stunden je Druck ---');
  {
    const { G, U } = await welt();
    draht(G, U, RAF.id, 60);
    db.saveAngebotUhr(G, U, { last_roll: T0, abgelehnt_folge: 0, pause_bis: 0 });
    const row = anfrage(G, U, 'tour', RAF.id);
    const an = await ang.annehmen(G, U, row.id, T0, nie);
    const id = an.projekt.id;
    const zeitVor = creator.budget(G, U, T0).left;
    const r1 = await ang.arbeiten(G, U, id, T0, nie);
    check('arbeiten bucht zwei Stunden und zählt sie auf stunden_ist',
      r1.ok === true && r1.fertig === false && r1.ist === data.ARBEIT_STUNDEN
      && r1.soll === data.TOUR_STUNDEN
      && creator.budget(G, U, T0).left === zeitVor - data.ARBEIT_STUNDEN,
      JSON.stringify({ r: r1.reason, ist: r1.ist, left: creator.budget(G, U, T0).left }));
    check('und `vorher` kommt mit heraus', Array.isArray(r1.vorher));
    const r2 = await ang.arbeiten(G, U, id, T0, nie);
    check('zweimal am selben Tag ist erlaubt, solange das Budget trägt',
      r2.ok === true && r2.ist === 2 * data.ARBEIT_STUNDEN
      && creator.budget(G, U, T0).left === zeitVor - 2 * data.ARBEIT_STUNDEN,
      JSON.stringify({ ist: r2.ist, left: creator.budget(G, U, T0).left }));
    check('die Stunden stehen auch in der Tabelle',
      db.projektRow(G, id).stunden_ist === 4, String(db.projektRow(G, id).stunden_ist));
    const fremd = await ang.arbeiten(G, 'jemand-anders', id, T0, nie);
    const weg = await ang.arbeiten(G, U, 999_999, T0, nie);
    check('ein Projekt, das es nicht gibt, meldet "weg" – mit `vorher`',
      weg.ok === false && weg.reason === 'weg' && Array.isArray(weg.vorher),
      JSON.stringify(weg));
    check('und ein fremdes Projekt genauso',
      fremd.ok === false && fremd.reason === 'weg', JSON.stringify(fremd.reason));
    check('beides lässt die Stunden unberührt',
      db.projektRow(G, id).stunden_ist === 4, String(db.projektRow(G, id).stunden_ist));
  }
  {
    /**
     * Ohne Stunden passiert nichts – und der abgewiesene Klick darf die
     * verfallene Anfrage nicht verschlucken (der Fehler aus 5b).
     */
    const { G, U } = await welt();
    draht(G, U, LILPFAND.id, 60);
    const pr = db.insertProjekt({ guildId: G, userId: U, art: 'kollabo',
      contactId: RAF.id, stundenSoll: data.KOLLABO_STUNDEN, frist: T0 + 14 * TAG });
    db.insertAngebot({ guildId: G, userId: U, art: 'tausch', contactId: LILPFAND.id,
      erstellt: T0 - 4 * TAG, frist: T0 - TAG });
    db.saveAngebotUhr(G, U, { last_roll: T0, abgelehnt_folge: 0, pause_bis: 0 });
    // Eine Stunde bleibt stehen – arbeiten braucht zwei. Ohne Ermüdung
    // gebucht, damit die Ablehnung an den Stunden hängt und nicht an der Wand.
    creator.useTime(G, U, creator.budget(G, U, T0).left - 1, T0, { fatigueFactor: 0 });
    const r = await ang.arbeiten(G, U, pr.id, T0, nie);
    check('ohne Zeitbudget: reason no_time, und die Stunden bleiben unverändert',
      r.ok === false && r.reason === 'no_time' && r.need === data.ARBEIT_STUNDEN
      && db.projektRow(G, pr.id).stunden_ist === 0, JSON.stringify(r.reason));
    check('und die verfallene Anfrage steht trotzdem in `vorher`',
      (r.vorher ?? []).some((e) => e.art === 'verfallen'), JSON.stringify(r.vorher));
  }

  console.log('--- Das Kollabo-Album ---');
  {
    const { G, U } = await welt();
    draht(G, U, RAF.id, 60);
    db.saveAngebotUhr(G, U, { last_roll: T0, abgelehnt_folge: 0, pause_bis: 0 });
    // Ein Konto, dem genau ein Druck fehlt.
    const pr = db.insertProjekt({ guildId: G, userId: U, art: 'kollabo', contactId: RAF.id,
      stundenSoll: data.KOLLABO_STUNDEN,
      stundenIst: data.KOLLABO_STUNDEN - data.ARBEIT_STUNDEN, frist: T0 + 14 * TAG });
    const kasseVor = gebucht.length;
    const ohne = await ang.arbeiten(G, U, pr.id, T0, nie);
    check('ein volles Konto ohne die sechs Titel schließt NICHT ab',
      ohne.ok === false && ohne.reason === 'no_songs'
      && ohne.need === data.KOLLABO_TITEL && ohne.have === 0,
      JSON.stringify({ r: ohne.reason, n: ohne.need, h: ohne.have }));
    check('das Projekt bleibt offen stehen, mit voll bezahltem Konto',
      db.projektRow(G, pr.id).status === 'offen'
      && db.projektRow(G, pr.id).stunden_ist === data.KOLLABO_STUNDEN,
      JSON.stringify(db.projektRow(G, pr.id)));
    check('und es erscheint nichts und kostet nichts',
      music.status(G, U, T0).releases === 0 && gebucht.length === kasseVor);
    check('auch hier geht `vorher` mit heraus', Array.isArray(ohne.vorher));
    /**
     * Noch ein Druck auf dasselbe vollgelaufene Konto: Er kann nichts bewegen –
     * mehr als 18 Stunden nimmt das Konto nicht an, und die Titel fehlen
     * weiter. Also darf er auch nichts kosten; die Prüfung steht VOR
     * `useTime`. Ohne sie zahlte jeder Klick zwei Stunden für dieselbe Absage.
     */
    const zeitLeer = creator.budget(G, U, T0).left;
    const nochmal = await ang.arbeiten(G, U, pr.id, T0, nie);
    check('ein weiterer Druck auf das vollgelaufene Konto kostet keine Stunde',
      nochmal.ok === false && nochmal.reason === 'no_songs'
      && nochmal.need === data.KOLLABO_TITEL && nochmal.have === 0
      && creator.budget(G, U, T0).left === zeitLeer,
      JSON.stringify({ r: nochmal.reason, vor: zeitLeer, nach: creator.budget(G, U, T0).left }));
    check('und das Konto bleibt offen und voll stehen',
      db.projektRow(G, pr.id).status === 'offen'
      && db.projektRow(G, pr.id).stunden_ist === data.KOLLABO_STUNDEN,
      JSON.stringify(db.projektRow(G, pr.id)));

    // Jetzt die Titel – aufgenommen wird nicht, sie werden gesetzt: Sechs
    // echte Studiosessions wären sechs Würfel in diesem Test.
    db.saveArtist(G, U, { ...db.getArtist(G, U, T0), songs: data.KOLLABO_TITEL });
    const zeitVor = creator.budget(G, U, T0).left;
    const r = await ang.arbeiten(G, U, pr.id, T0, immer);
    check('mit den Titeln erscheint das Album',
      r.ok === true && r.fertig === true && r.platte?.ok === true,
      JSON.stringify({ r: r.reason, p: r.platte?.reason }));
    /**
     * Von Hand: log10(1 + 6.500.000 / 10.000) / 3 = log10(651)/3 = 0,937860,
     * also ×1,937860 – dieselbe Zahl, die der reine Test oben gegen die Spec
     * hält. `publish` gibt den Faktor unverändert zurück.
     */
    check('audienceFactor ist der handgerechnete Kollabo-Faktor',
      nah(r.platte.audienceFactor, 1.937860, 1e-5), String(r.platte.audienceFactor));
    check('das Projekt steht auf "fertig", mit 18 von 18 Stunden',
      db.projektRow(G, pr.id).status === 'fertig'
      && db.projektRow(G, pr.id).stunden_ist === data.KOLLABO_STUNDEN,
      JSON.stringify(db.projektRow(G, pr.id)));
    check('es ist eine echte Veröffentlichung in Albumgröße: sechs Titel weg',
      music.status(G, U, T0).releases === 1 && music.status(G, U, T0).songs === 0);
    /**
     * Der Punkt, an dem das Format steht oder fällt: 18 Stunden, nicht 18 + 3.
     * Das Album läuft über `force` – ohne das käme die Platte oben drauf, und
     * eine Release-Sperre von vorgestern könnte das ganze Projekt scheitern
     * lassen, nachdem die Stunden bezahlt sind.
     */
    check('der Abschluss kostet nur die zwei Stunden dieses Drucks',
      creator.budget(G, U, T0).left === zeitVor - data.ARBEIT_STUNDEN,
      `${zeitVor} -> ${creator.budget(G, U, T0).left}`);
    check('danach sind kollabo und tour wieder frei',
      ang.artenFuer(G, U, 100, T0).length === 6);
  }

  console.log('--- Die Tour ---');
  {
    const { G, U } = await welt();
    draht(G, U, RAF.id, 60);
    db.saveAngebotUhr(G, U, { last_roll: T0, abgelehnt_folge: 0, pause_bis: 0 });
    const pr = db.insertProjekt({ guildId: G, userId: U, art: 'tour', contactId: RAF.id,
      stundenSoll: data.TOUR_STUNDEN,
      stundenIst: data.TOUR_STUNDEN - data.ARBEIT_STUNDEN, frist: T0 + 14 * TAG });
    const kasseVor = gebucht.length;
    const zeitVor = creator.budget(G, U, T0).left;
    // `immer` trifft den ersten Eintrag jeder Liste: kein Ereignis (Gewicht
    // 110 von ~130) und die untere Kante der Güte (0,75).
    const r = await ang.arbeiten(G, U, pr.id, T0, immer);
    check('die Tour spielt TOUR_KONZERTE Abende hintereinander',
      r.ok === true && r.fertig === true && r.abende?.length === data.TOUR_KONZERTE
      && r.abende.every((a) => a.ok === true),
      JSON.stringify({ r: r.reason, a: r.abende?.map((x) => x.reason ?? 'ok') }));
    check('fünf Gagen, jede über den Weg des Konzerts (`kind: music`)',
      gebucht.length === kasseVor + data.TOUR_KONZERTE
      && gebucht.slice(-data.TOUR_KONZERTE).every((b) => b.opts.kind === 'music'),
      String(gebucht.length - kasseVor));
    check('und die Summe der Gagen steht im Ergebnis',
      r.verdient === gebucht.slice(-data.TOUR_KONZERTE).reduce((s, b) => s + b.amount, 0),
      String(r.verdient));
    const mitGast = r.abende.filter((a) => a.extraHoerer > 0);
    check('sein Publikum kommt GENAU EINMAL, nicht an jedem Abend',
      mitGast.length === 1, JSON.stringify(r.abende.map((a) => a.extraHoerer)));
    const basis = (a) => a.listeners - a.gained;     // die Hörerschaft vor dem Abend
    check('und auch dann gedeckelt auf die eigene Hörerschaft',
      mitGast[0].extraHoerer === basis(mitGast[0]),
      JSON.stringify({ e: mitGast[0].extraHoerer, b: basis(mitGast[0]) }));
    /**
     * Sein Publikum steckt ausschließlich in der GAGE dieses einen Abends, und
     * zwar über `hörer^0,7`: Weil die mitgebrachten Hörer auf die eigene
     * Hörerschaft gedeckelt sind, ist die Gage des Gastabends genau 2^0,7 =
     * +62 % der eigenen – nicht das Doppelte. Der Faktor `k` wird aus einem
     * normalen Abend zurückgerechnet und enthält Markt, Genre, Form und Güte.
     */
    const normal = r.abende[0];
    const k = normal.gross / Math.pow(basis(normal), 0.7);
    check('der Gastabend zahlt genau 2^0,7 der eigenen Gage',
      Math.abs(mitGast[0].gross - k * Math.pow(2 * basis(mitGast[0]), 0.7)) < 2,
      JSON.stringify({ gast: mitGast[0].gross, erwartet: k * Math.pow(2 * basis(mitGast[0]), 0.7) }));
    check('ein Abend ohne Gast rechnet nur mit der eigenen Hörerschaft',
      r.abende.slice(0, 4).every((a) => a.extraHoerer === 0));
    /**
     * DER BEFUND AUS 5b, hier für die Tour festgehalten: RAF Camora bringt
     * 5 % von 6,5 Mio = 325.000 Hörer mit. Stünden die in der BASIS, stünden
     * hier über 300.000 Hörer statt 10.800 – und über `hörer^1,2` in den
     * Tantiemen wäre das kein Zuschlag, sondern ein Zinssatz. Gewachsen ist
     * die Hörerschaft an jedem Abend nur um die 2 %, die jedes Konzert bindet.
     */
    let erwartet = 10_000;
    for (const a of r.abende) erwartet += Math.round(erwartet * music.SHOW_GAIN * a.quality);
    check('die Hörerschaft wächst an jedem Abend nur um die 2 % des Konzerts',
      music.status(G, U, T0).listeners === erwartet,
      `${music.status(G, U, T0).listeners} vs ${erwartet}`);
    check('aus 10.000 werden damit keine 300.000 – sein Publikum bleibt draußen',
      music.status(G, U, T0).listeners < 11_000,
      String(music.status(G, U, T0).listeners));
    check('fünf Konzerte stehen im Konto des Künstlers',
      music.status(G, U, T0).shows === data.TOUR_KONZERTE,
      String(music.status(G, U, T0).shows));
    /**
     * Die Sperre ist für die Tour umgangen, nicht gelockert: `last_show_at`
     * steht danach auf jetzt, das nächste EINZELNE Konzert wartet seine drei
     * Tage wie immer.
     */
    const danach = await music.show(G, U, T0 + 3600e3, nie);
    check('die Konzert-Sperre gilt für den normalen Weg unverändert weiter',
      danach.ok === false && danach.reason === 'cooldown', JSON.stringify(danach.reason));
    /**
     * Und der Preis: 24 Stunden, nicht 24 + 20. Fünf einzelne Konzerte kosten
     * 20 Stunden und 12 Tage Sperre – würde jeder Abend hier noch einmal
     * `SHOW_TIME` buchen, wäre die Tour kein Format, sondern eine Strafe.
     */
    check('die fünf Abende buchen keine Stunden nach',
      creator.budget(G, U, T0).left === zeitVor - data.ARBEIT_STUNDEN,
      `${zeitVor} -> ${creator.budget(G, U, T0).left}`);
    check('das Projekt steht auf "fertig", mit 24 von 24 Stunden',
      db.projektRow(G, pr.id).status === 'fertig'
      && db.projektRow(G, pr.id).stunden_ist === data.TOUR_STUNDEN,
      JSON.stringify(db.projektRow(G, pr.id)));
  }

  console.log('--- Frist gerissen: die Stunden sind weg ---');
  {
    /**
     * DIESER TEST HÄLT EINE ABSICHT FEST, DAMIT SIE NIEMAND SPÄTER
     * „REPARIERT": Ein Projekt zwingt zu nichts – wer es liegen lässt,
     * verliert die investierten Stunden. Ohne diesen Preis wäre ein offenes
     * Konto ein Stundenspeicher ohne Risiko.
     */
    const { G, U } = await welt();
    draht(G, U, RAF.id, 60);
    db.saveAngebotUhr(G, U, { last_roll: T0, abgelehnt_folge: 0, pause_bis: 0 });
    const pr = db.insertProjekt({ guildId: G, userId: U, art: 'tour', contactId: RAF.id,
      stundenSoll: data.TOUR_STUNDEN,
      stundenIst: data.TOUR_STUNDEN - 2 * data.ARBEIT_STUNDEN, frist: T0 + 14 * TAG });
    /**
     * Tag 1: ECHT gearbeitet. Die zwei Stunden gehen durch `creator.useTime`
     * und stehen danach im `time_used` dieses Tages. Darauf kommt es an: Ein
     * vorgesetztes `stundenIst` hat nie etwas gekostet, also könnte eine
     * „Reparatur" auch nichts erstatten – der Test hätte nichts zu messen und
     * ginge grün durch, egal was `settle` beim Verfall täte.
     */
    const tag1 = await ang.arbeiten(G, U, pr.id, T0, nie);
    check('Tag 1: zwei echte Stunden gehen ins Konto',
      tag1.ok === true && tag1.fertig === false
      && tag1.ist === data.TOUR_STUNDEN - data.ARBEIT_STUNDEN,
      JSON.stringify({ r: tag1.reason, i: tag1.ist }));
    const nachArbeit = creator.budget(G, U, T0);
    check('und sie stehen im Tagesbudget des Arbeitstages',
      nachArbeit.used === data.ARBEIT_STUNDEN
      && nachArbeit.left === nachArbeit.max - data.ARBEIT_STUNDEN,
      JSON.stringify({ used: nachArbeit.used, left: nachArbeit.left }));

    const spaet = T0 + 15 * TAG;
    db.saveAngebotUhr(G, U, { last_roll: spaet, abgelehnt_folge: 0, pause_bis: 0 });
    const kasseVor = gebucht.length;
    const zeitVor = creator.budget(G, U, spaet).left;
    const r = await ang.arbeiten(G, U, pr.id, spaet, nie);
    check('nach der Frist lässt sich nicht weiterarbeiten',
      r.ok === false && r.reason === 'weg', JSON.stringify(r.reason));
    check('Schritt 0 hat es auf "verfallen" gesetzt und meldet es unter `vorher`',
      (r.vorher ?? []).some((e) => e.art === 'projekt_verfallen' && e.projekt.id === pr.id),
      JSON.stringify(r.vorher));
    check('die 22 investierten Stunden sind weg – kein Konzert, kein Geld',
      db.projektRow(G, pr.id).status === 'verfallen'
      && db.projektRow(G, pr.id).stunden_ist === data.TOUR_STUNDEN - data.ARBEIT_STUNDEN
      && gebucht.length === kasseVor && music.status(G, U, spaet).shows === 0,
      JSON.stringify(db.projektRow(G, pr.id)));
    /**
     * DIE ZEILE, DIE DIE ABSICHT FESTHÄLT: Das `time_used` des Arbeitstages
     * steht nach dem Verfall noch genau so da wie vorher. Gäbe `settle` die
     * investierten Stunden zurück – egal ob auf den Arbeitstag oder auf den
     * Tag des Verfalls –, stünde hier eine andere Zahl, und dieser Test wäre
     * rot. Ohne ihn wäre „die Stunden sind weg" eine Behauptung ohne Messung.
     */
    const nachVerfall = creator.budget(G, U, T0);
    check('die gearbeiteten Stunden kommen NICHT zurück – time_used unverändert',
      nachVerfall.used === data.ARBEIT_STUNDEN
      && nachVerfall.left === nachArbeit.left,
      `${nachArbeit.used} -> ${nachVerfall.used}`);
    check('und der abgewiesene Klick kostet keine weitere Stunde',
      creator.budget(G, U, spaet).left === zeitVor);
    check('danach ist der Weg für ein neues Projekt wieder frei',
      ang.artenFuer(G, U, 100, spaet).some((a) => a.id === 'tour'));
  }

  console.log('--- Nur EIN Stundenkonto: beide Ebenen ---');
  {
    /**
     * Die Anfrage-Ebene. `artenFuer` hat bisher nur auf ein offenes PROJEKT
     * geschaut – eine offene ANFRAGE auf ein großes Format war ihr egal.
     * Genau wie `label` muss aber auch hier die Anfrage sperren, sonst liegen
     * zwei Zusagen bereit, von denen nur eine gelten darf.
     */
    const { G, U } = await welt();
    draht(G, U, RAF.id, 60);
    const row = anfrage(G, U, 'kollabo', RAF.id);
    const offen = ang.artenFuer(G, U, 100, T0).map((a) => a.id);
    check('eine offene kollabo-Anfrage nimmt kollabo UND tour aus der Auswahl',
      offen.join(',') === 'tausch,gastpart,vorgruppe,label', offen.join(','));
    check('eine Anfrage, deren Frist durch ist, sperrt nicht mehr',
      ang.artenFuer(G, U, 100, T0 + 4 * TAG).length === 6,
      ang.artenFuer(G, U, 100, T0 + 4 * TAG).map((a) => a.id).join(','));
    db.saveAngebot(G, row.id, { status: 'ab' });
    check('ist sie abgelehnt, sind beide wieder da',
      ang.artenFuer(G, U, 100, T0).length === 6);
  }
  {
    /**
     * DER WEG, AUF DEM DAS LOCH ENTSTAND: Eine Anfrage liegt drei Tage, ein
     * Wurf kommt jeden Tag. Tag 1 stellte `tour` zu (kein Projekt offen),
     * Tag 2 stellte `kollabo` zu (immer noch keines, weil nichts angenommen
     * ist) – und beide Fristen liefen gleichzeitig. Wer beide annahm, hatte
     * zwei Stundenkonten.
     *
     * `folge(0, 0, 0.7)`: Chance-Wurf trifft, der einzige Kandidat ist RAF,
     * und 0,7 × 6 = Index 4 – das ist `tour`.
     */
    const { G, U } = await welt();
    draht(G, U, RAF.id, 60);
    db.saveAngebotUhr(G, U, { last_roll: T0 - TAG, abgelehnt_folge: 0, pause_bis: 0 });
    const arten1 = ang.settle(G, U, T0, folge(0, 0, 0.7))
      .filter((e) => e.art === 'neu').map((e) => e.angebot.art);
    check('Tag 1 stellt eine tour-Anfrage zu', arten1.join(',') === 'tour', arten1.join(','));
    const arten2 = ang.settle(G, U, T0 + TAG, folge(0, 0, 0.7))
      .filter((e) => e.art === 'neu').map((e) => e.angebot.art);
    check('Tag 2 bringt kein zweites großes Format',
      arten2.length === 1 && !arten2.some((a) => ['kollabo', 'tour'].includes(a)),
      arten2.join(','));
    check('es steht genau EINE Anfrage auf ein großes Format offen',
      ang.offeneAngebote(G, U, T0 + TAG)
        .filter((a) => ['kollabo', 'tour'].includes(a.art)).length === 1,
      JSON.stringify(ang.offeneAngebote(G, U, T0 + TAG).map((a) => a.art)));
  }
  {
    /**
     * Die Annehmen-Ebene. Sie kann nicht entfallen, auch wenn `artenFuer`
     * oben sperrt: Zwischen Zustellung und Klick liegen bis zu drei Tage, und
     * eine Anfrage, die gestern noch die einzige war, trifft heute auf ein
     * frisch geöffnetes Konto (zum Beispiel, weil beide am selben Tag
     * zugestellt wurden, als noch keines offen war).
     */
    const { G, U } = await welt();
    draht(G, U, RAF.id, 60);
    db.saveAngebotUhr(G, U, { last_roll: T0, abgelehnt_folge: 0, pause_bis: 0 });
    const erste = anfrage(G, U, 'kollabo', RAF.id);
    const zweite = anfrage(G, U, 'tour', RAF.id);
    const eins = await ang.annehmen(G, U, erste.id, T0, nie);
    check('die erste Zusage öffnet das Konto',
      eins.ok === true && eins.projekt?.art === 'kollabo',
      JSON.stringify(eins.reason ?? eins.projekt?.art));
    const kasseVor = gebucht.length;
    const zeitVor = creator.budget(G, U, T0).left;
    const zwei = await ang.annehmen(G, U, zweite.id, T0, nie);
    check('die zweite wird abgewiesen: `projekt_offen`',
      zwei.ok === false && zwei.reason === 'projekt_offen', JSON.stringify(zwei.reason));
    check('und sie nennt das Konto, das im Weg steht',
      zwei.projekt?.id === eins.projekt.id && zwei.projekt.art === 'kollabo',
      JSON.stringify(zwei.projekt));
    /**
     * Die Prüfung steht vor der Zeitbuchung und vor jedem Schreibvorgang: Die
     * Anfrage liegt danach unberührt da, es gibt kein zweites Projekt, keine
     * Stunde ist gebucht und kein Cent geflossen.
     */
    check('die Datenbank bleibt unberührt – ein Konto, ein offenes Angebot, keine Stunde',
      db.angebotRow(G, zweite.id).status === 'offen'
      && db.projekteOf(G, U).filter((p) => p.status === 'offen').length === 1
      && creator.budget(G, U, T0).left === zeitVor
      && gebucht.length === kasseVor,
      JSON.stringify({
        status: db.angebotRow(G, zweite.id).status,
        offen: db.projekteOf(G, U).filter((p) => p.status === 'offen').length,
        zeit: creator.budget(G, U, T0).left,
      }));
    // Und sie ist nicht verloren: Ist das erste Konto durch, trägt sie wieder.
    db.saveProjekt(G, eins.projekt.id, { status: 'fertig' });
    const spaeter = await ang.annehmen(G, U, zweite.id, T0, nie);
    check('ist das erste Konto durch, lässt sich die zweite annehmen',
      spaeter.ok === true && spaeter.projekt?.art === 'tour',
      JSON.stringify(spaeter.reason ?? spaeter.projekt?.art));
  }

  console.log(`\n${pass} bestanden, ${fail} fehlgeschlagen`);
  process.exit(fail === 0 ? 0 : 1);
})();
