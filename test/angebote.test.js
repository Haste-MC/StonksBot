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
    check('die mitgebrachten Hörer sind auf die eigene Hörerschaft gedeckelt',
      r.extraHoerer === 10_000 && music.status(G, U, T0).listeners === 20_000,
      JSON.stringify({ extra: r.extraHoerer, h: music.status(G, U, T0).listeners }));
    check('die Vorgruppe zählt als Konzert und setzt dessen Sperre',
      music.status(G, U, T0).showMs > 0 && music.status(G, U, T0).shows === 1);
    check('vier Stunden gebucht', creator.budget(G, U, T0).left === zeitVor - 4);
    check('auch hier genau eine Buchung mit `kind: music`',
      gebucht.length === kasseVor + 1 && gebucht.at(-1).opts.kind === 'music');
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

  console.log('--- Was Task 3 und 4 noch bauen ---');
  {
    const { G, U } = await welt();
    draht(G, U, LILPFAND.id, 60);
    const row = anfrage(G, U, 'label', LILPFAND.id);
    const zeitVor = creator.budget(G, U, T0).left;
    const r = await ang.annehmen(G, U, row.id, T0, nie);
    check('label antwortet bis Task 4 mit "noch_nicht"',
      r.ok === false && r.reason === 'noch_nicht', JSON.stringify(r));
    check('und kostet dabei weder Zeit noch Status',
      creator.budget(G, U, T0).left === zeitVor
      && db.angebotRow(G, row.id).status === 'offen');
  }

  console.log(`\n${pass} bestanden, ${fail} fehlgeschlagen`);
  process.exit(fail === 0 ? 0 : 1);
})();
