/**
 * ===========================================================================
 *  ANGEBOTE – DIE REINEN RECHNUNGEN
 * ===========================================================================
 *
 * Hier steht, was eine Gegenanfrage wert ist – und sonst nichts: kein
 * Discord, kein Zufall außer dem, der hereingereicht wird, und in DIESER
 * ersten Hälfte keine Datenbank. Dadurch lässt sich jede Zahl einzeln
 * nachrechnen und testen.
 *
 *   gewichtOf          wer sich überhaupt melden kann, und wie oft
 *   honorarOf          was ein Gastpart einbringt (zweiseitig gedeckelt)
 *   gageOf             was eine Vorgruppe einbringt
 *   kollaboFaktorOf    wie viel Publikum ein gemeinsames Album mitbringt
 *   fristOf            wann eine Anfrage verfällt
 *   rollTage           wie viele Tageswürfe nachzuholen sind
 *   textFor            eine Zeile im Ton des Kontakts
 *
 * Die Zahlen und Texte stehen in data/angebote.js.
 */

const data = require('./data/angebote');

const clamp = (lo, hi, v) => Math.max(lo, Math.min(hi, v));

/**
 * Wer meldet sich? Partner viermal so oft wie Bekannte, und wer sprachlich
 * und im Genre zu dir passt, eher – dieselbe Passung, die in 5a die
 * Antwortchance trägt.
 */
function gewichtOf({ draht, passung }) {
  if (draht < 20) return 0;
  // `Math.max(0, …)` wie in `honorarOf`: Ein negatives Gewicht würde die Summe
  // beim gewichteten Ziehen verfälschen und könnte sie sogar auf 0 drücken.
  return (draht < 50 ? data.GEWICHT_BEKANNT : data.GEWICHT_PARTNER) * Math.max(0, passung);
}

/**
 * Das Honorar für einen Gastpart – zweiseitig gedeckelt: Es wächst mit SEINER
 * Reichweite, aber nie über ein Vielfaches dessen, was du selbst am Tag
 * verdienst. Ein Winzling wird von einem Weltstar nicht über Nacht reich.
 */
function honorarOf({ seine, tantiemenProTag }) {
  const roh = data.HONORAR_K * Math.pow(Math.max(0, seine), data.HONORAR_EXP);
  return Math.round(Math.min(roh, data.HONORAR_DECKEL_TAGE * Math.max(0, tantiemenProTag)));
}

/**
 * Die Gage als Vorgruppe: sein Publikum kommt mit, gedeckelt auf die eigene
 * Hörerschaft – dieselbe Deckelung wie beim zugesagten Konzert in 5a.
 */
function gageOf({ meine, seine, showPay, showExp }) {
  // Dieselbe Absicherung wie in `honorarOf`: `Math.pow` eines negativen
  // Werts mit einem gebrochenen Exponenten ist NaN, und NaN wäre hier eine
  // Zahl, die bis in eine Geldbuchung durchrutschen könnte.
  const m = Math.max(0, meine);
  const extra = Math.min(m, Math.max(0, seine) * data.VORGRUPPE_ANTEIL);
  return Math.round(showPay * Math.pow(m + extra, showExp));
}

/** Wie viel Publikum ein gemeinsames Album mitbringt – höchstens das Doppelte. */
function kollaboFaktorOf({ meine, seine }) {
  return 1 + clamp(0, 1, Math.log10(1 + seine / Math.max(100, meine)) / 3);
}

/** Wann eine Anfrage verfällt. */
function fristOf(erstellt) { return erstellt + data.FRIST_TAGE * 86_400_000; }

/**
 * Wie viele Tageswürfe nachzuholen sind. Ohne die Obergrenze bekäme ein
 * Spieler nach drei Wochen Pause zwanzig Würfe auf einmal und damit sofort
 * beide Plätze voll.
 */
function rollTage(lastRoll, now) {
  if (!lastRoll) return 1;
  return clamp(0, data.ROLL_TAGE_MAX, Math.floor((now - lastRoll) / 86_400_000));
}

/** Eine Zeile im Ton des Kontakts. */
function textFor(trait, lage, name, random = Math.random) {
  const zeilen = data.LINES[trait]?.[lage] ?? [];
  if (!zeilen.length) return '';
  return zeilen[Math.min(zeilen.length - 1, Math.floor(random() * zeilen.length))]
    .replaceAll('{name}', name);
}

/**
 * ===========================================================================
 *  AB HIER MIT DATENBANK
 * ===========================================================================
 *
 * Die Gegenrichtung zu 5a: Nicht der Spieler schreibt, sondern ein Kontakt
 * meldet sich. Dazu gehören drei Tabellen (`angebote`, `projekte`,
 * `angebot_uhr`), die faule Zustellung und die beiden Knöpfe.
 *
 * Vier Regeln, die überall durchschlagen – drei davon hat 5b schon gelernt:
 *
 *   • Hier wird NIE `unb` gerufen. Geld bucht `music.payGig`, und zwar in
 *     derselben Reihenfolge und mit demselben `{ kind: 'music' }` wie das
 *     Konzert (§3). Eine zweite Kasse gibt es nicht.
 *   • Die Zeit wird gebucht, BEVOR irgendetwas geschrieben wird. Eine
 *     Voraussetzung, die nicht trägt, lässt die Datenbank unberührt.
 *   • Abgerechnet wird faul (§4): `settle` steht als Schritt 0 vor jedem
 *     Knopf und schreibt nur, wenn sich etwas bewegt hat. Was dabei fällig
 *     wird, geht unter `vorher` mit hinaus – AUCH bei jeder Ablehnung danach.
 *     Fehlt das, verschluckt ein abgewiesener Klick eine verfallene Anfrage
 *     samt Draht-Verlust; genau dieser Fehler ist in 5b zweimal passiert.
 *   • Der Draht wird hier nie selbst geschrieben, das macht ausschließlich
 *     `contacts.moveDraht` – eine Stelle, ein Abklingen, eine Sperre.
 */

const db = require('./db');

const DAY_MS = 86_400_000;

/** Die Art hinter einer Id – null, wenn der Katalog sie nicht (mehr) kennt. */
function artOf(id) { return data.ARTEN.find((a) => a.id === String(id ?? '')) ?? null; }

/**
 * Wer ich auf der MUSIKSEITE bin – Sprache und Genre, für die Passung.
 *
 * Wie in 5b holt sich dieses Modul seine beiden Zahlen selbst und nimmt NICHT
 * die aus `contacts.detail`: Dort meldet bei einem Kontakt, der beides macht,
 * die Leitseite unter Umständen die Follower, und Honorar, Gage und Gewichtung
 * hingen dann daran, was gerade größer ist. Eine Gegenanfrage ist von vorn bis
 * hinten eine Sache unter Musikern. `null` heißt: keine Musikkarriere.
 */
function musikIch(guildId, userId, now) {
  const m = require('./music').status(guildId, userId, now);
  if (!m.started) return null;
  return { language: m.market.language.id, genre: m.genre.id };
}

/** Die Passung auf der Musikseite – dieselbe, die in 5a die Antwortchance trägt. */
function passungFor(meine, contact) {
  return require('./contacts').passungOf({
    meine,
    seine: { language: contact.language, genre: contact.genre },
    seite: 'musik',
  }).passung;
}

/**
 * Die offenen Gegenanfragen, angereichert für die Anzeige.
 *
 * Liest nur. Eine Anfrage, deren Frist durch ist, steht bis zur Abrechnung
 * weiter als `offen` in der Tabelle – DER AUFRUFER MUSS VORHER ABGERECHNET
 * HABEN, genau wie bei `beef.zielFor`. `settle` bringt jeder Knopf als
 * Schritt 0 mit; jede andere Ansicht ruft es selbst.
 */
function offeneAngebote(guildId, userId, now = Date.now()) {
  const katalog = require('./data/contacts');
  return db.angeboteOf(guildId, userId)
    .filter((r) => r.status === 'offen')
    .map((r) => ({
      ...r,
      artInfo: artOf(r.art),
      contact: katalog.byId(r.contact_id),
      restMs: Math.max(0, r.frist - now),
    }));
}

/** Die offenen großen Formate – Task 3 füllt sie mit Stunden. */
function offeneProjekte(guildId, userId) {
  const katalog = require('./data/contacts');
  return db.projekteOf(guildId, userId)
    .filter((r) => r.status === 'offen')
    .map((r) => ({ ...r, artInfo: artOf(r.art), contact: katalog.byId(r.contact_id) }));
}

/**
 * Welche Arten dieser Draht gerade hergibt.
 *
 * Drei Ausnahmen über die Draht-Schwelle hinaus: `label` fällt weg, solange
 * ein Vertrag läuft ODER einer offen ist – sonst bekäme man ein zweites
 * Angebot auf dasselbe. `kollabo` und `tour` fallen weg, solange ein Projekt
 * offen ist: Zwei Stundenkonten gleichzeitig wären kein Format mehr, sondern
 * eine zweite Tagesordnung.
 */
function artenFuer(guildId, userId, draht, now) {
  const projektOffen = db.projekteOf(guildId, userId).some((p) => p.status === 'offen');
  const vertrag = Boolean(db.activeContract(guildId, userId))
    || Boolean(db.openContract(guildId, userId, now));
  return data.ARTEN.filter((a) => {
    if (draht < a.minDraht) return false;
    if (a.id === 'label') return !vertrag;
    if (a.id === 'kollabo' || a.id === 'tour') return !projektOffen;
    return true;
  });
}

/**
 * EIN Treffer: Kontakt gewichtet ziehen, Art gleichverteilt ziehen, Anfrage
 * anlegen. `null`, wenn sich niemand melden kann – dann ist dieser Wurf
 * verfallen, ohne zu schreiben.
 */
function zustellen(guildId, userId, meine, now, random) {
  const contacts = require('./contacts');
  const katalog = require('./data/contacts');
  const zeilen = db.contactsOf(guildId, userId);

  const kandidaten = [];
  let summe = 0;
  for (const c of katalog.CONTACTS) {
    if (!c.reach) continue;                 // ohne Musik-Reichweite kein Angebot
    const row = zeilen.find((z) => z.contact_id === c.id) ?? null;
    const draht = contacts.drahtJetzt(row, now);
    const g = gewichtOf({ draht, passung: passungFor(meine, c) });
    if (g <= 0) continue;
    summe += g;
    kandidaten.push({ c, g, draht });
  }
  if (!kandidaten.length || summe <= 0) return null;

  let wurf = random() * summe;
  const treffer = kandidaten.find(({ g }) => (wurf -= g) <= 0)
    ?? kandidaten[kandidaten.length - 1];

  // Die Art gleichverteilt aus den erlaubten. Bleibt keine übrig, passiert bei
  // diesem Wurf nichts – der Kontakt hat dann gerade nichts anzubieten.
  const erlaubt = artenFuer(guildId, userId, treffer.draht, now);
  if (!erlaubt.length) return null;
  const art = erlaubt[Math.min(erlaubt.length - 1, Math.floor(random() * erlaubt.length))];

  const row = db.insertAngebot({
    guildId, userId, art: art.id, contactId: treffer.c.id,
    erstellt: now, frist: fristOf(now),
  });
  return {
    art: 'neu', contact: treffer.c,
    angebot: { ...row, artInfo: art, contact: treffer.c, restMs: row.frist - now },
    text: textFor(treffer.c.trait, 'anfrage', treffer.c.name, random),
  };
}

/**
 * Die faule Abrechnung (§4): Fristen laufen nicht zu ihrer Zeit ab und
 * Anfragen kommen nicht zu ihrer Zeit herein, sondern sobald jemand hinsieht
 * oder handelt.
 *
 * Darf auf jeder Ansicht und vor jeder Aktion laufen: Ist nichts fällig, wird
 * nichts geschrieben und nichts gemeldet. Die Reihenfolge ist verbindlich –
 * erst wird aufgeräumt, dann die Pause gesetzt, dann gewürfelt. Sonst könnte
 * eine Anfrage hereinkommen, die eine gerade verfallene noch nicht
 * freigegeben hat.
 */
function settle(guildId, userId, now = Date.now(), random = Math.random) {
  const contacts = require('./contacts');
  const katalog = require('./data/contacts');
  const ereignisse = [];

  const uhr = db.angebotUhr(guildId, userId);
  let abgelehntFolge = uhr.abgelehnt_folge;
  let pauseBis = uhr.pause_bis;

  // 1. Verstrichene Anfragen. Liegenlassen kostet mehr Draht als Absagen.
  for (const row of db.angeboteOf(guildId, userId)) {
    if (row.status !== 'offen' || row.frist > now) continue;
    const neu = db.saveAngebot(guildId, row.id, { status: 'verfallen' });
    const contact = katalog.byId(row.contact_id);
    const draht = contacts.moveDraht(guildId, userId, row.contact_id, data.DRAHT_VERFALL, now);
    abgelehntFolge += 1;
    ereignisse.push({
      art: 'verfallen', contact,
      angebot: { ...neu, artInfo: artOf(row.art), contact },
      draht,
    });
  }

  // 2. Verstrichene Projekte. Die investierten Stunden sind weg – das ist der
  //    Preis dafür, dass ein Projekt zu nichts zwingt.
  for (const row of db.projekteOf(guildId, userId)) {
    if (row.status !== 'offen' || row.frist > now) continue;
    const neu = db.saveProjekt(guildId, row.id, { status: 'verfallen' });
    const contact = katalog.byId(row.contact_id);
    ereignisse.push({
      art: 'projekt_verfallen', contact,
      projekt: { ...neu, artInfo: artOf(row.art), contact },
    });
  }

  // 3. Dreimal nicht angenommen: Der Zustellweg ruht zwei Wochen. Gezählt wird
  //    unabhängig vom Kontakt – wer nie zusagt, wird nicht mehr gefragt.
  if (abgelehntFolge >= data.PAUSE_SCHWELLE) {
    pauseBis = now + data.PAUSE_TAGE * DAY_MS;
    abgelehntFolge = 0;
  }

  // 4. Neue Anfragen: je ganzem vergangenen Tag EIN Wurf, je Wurf höchstens
  //    EIN Treffer. Ohne Musikkarriere meldet sich niemand – es gäbe weder
  //    Genre für die Passung noch eine Seite, auf der man zusagen könnte.
  const wuerfe = rollTage(uhr.last_roll, now);
  // `musikIch` geht über `music.status` und damit über `db.getArtist` – und das
  // LEGT den Künstler an, wenn es ihn noch nicht gibt. Darum wird erst gefragt,
  // wenn überhaupt gewürfelt wird: Ein reiner Blick (null Würfe, nichts
  // verfallen) darf keine Zeile schreiben (§4), auch keine leere.
  const meine = wuerfe > 0 && now >= pauseBis ? musikIch(guildId, userId, now) : null;
  if (meine) {
    for (let i = 0; i < wuerfe; i++) {
      // Mehr als ANFRAGEN_MAX offene gibt es nicht; weitere Würfe können daran
      // nichts ändern, also ist hier Schluss.
      if (offeneAngebote(guildId, userId, now).length >= data.ANFRAGEN_MAX) break;
      if (random() >= data.ANFRAGE_CHANCE) continue;
      const neu = zustellen(guildId, userId, meine, now, random);
      if (neu) ereignisse.push(neu);
    }
  }

  // 5. Die Uhr – EIN Schreibvorgang, und nur wenn sich etwas bewegt hat.
  //    `last_roll` MUSS mitrücken, sobald gewürfelt wurde: Bliebe sie stehen,
  //    würfelte der nächste Blick dieselben Tage noch einmal, und aus der
  //    Zustellung würde ein Geldhahn (§3). Während der Pause wird nicht
  //    gewürfelt, die Uhr rückt aber trotzdem vor – sonst stünden nach der
  //    Pause sofort ROLL_TAGE_MAX Würfe bereit.
  if (wuerfe > 0 || abgelehntFolge !== uhr.abgelehnt_folge || pauseBis !== uhr.pause_bis) {
    db.saveAngebotUhr(guildId, userId, {
      last_roll: wuerfe > 0 ? now : uhr.last_roll,
      abgelehnt_folge: abgelehntFolge,
      pause_bis: pauseBis,
    });
  }

  return ereignisse;
}

/**
 * Die gemeinsamen Prüfungen von `annehmen` und `ablehnen` (Schritte 1–4).
 *
 * Gibt entweder `{ fehler }` – dann ist nichts geschrieben worden außer dem,
 * was Schritt 0 ohnehin nachgeholt hat – oder `{ row, art, contact }`.
 */
function pruefen(guildId, userId, id, now, vorher) {
  const row = db.angebotRow(guildId, id);
  const art = row ? artOf(row.art) : null;

  // 2. Unbekannt, fremd, schon beantwortet oder eine Art, die der Katalog
  //    nicht mehr kennt: Der Knopf stammt aus einer alten Nachricht.
  if (!row || String(row.user_id) !== String(userId) || row.status !== 'offen' || !art) {
    return { fehler: { ok: false, reason: 'weg', vorher } };
  }
  // 3. Frist durch. Nach Schritt 0 ist das kaum erreichbar – `settle` hat eine
  //    verstrichene Anfrage dann schon auf `verfallen` gesetzt und meldet sie
  //    unter `vorher`. Die Prüfung bleibt trotzdem stehen: Sie ist die, die
  //    hier gilt, und nicht die, die ein anderer Schritt nebenbei erledigt.
  if (row.frist <= now) {
    return { fehler: { ok: false, reason: 'abgelaufen', vorher } };
  }
  // 4. Der Kontakt ist aus dem Katalog verschwunden.
  const contact = require('./data/contacts').byId(row.contact_id);
  if (!contact) return { fehler: { ok: false, reason: 'unknown', vorher } };

  return { row, art, contact };
}

/**
 * Die Arten, deren Wirkung in diesem Stück gebaut ist. Task 3 und 4 nehmen
 * ihre Arten hier auf, sobald sie die Wirkung dazuschreiben – eine Art ohne
 * Wirkung darf nicht annehmbar sein (siehe Schritt 5b in `annehmen`).
 */
const GEBAUTE_ARTEN = new Set(['tausch', 'gastpart', 'vorgruppe']);

/** Der Schub, den `tausch` und `gastpart` setzen – derselbe wie ein shoutout in 5a. */
function schubFor(guildId, userId, { art, contact, meine, lage, now }) {
  const contacts = require('./contacts');
  const staerke = contacts.staerkeOf({
    seineReichweite: lage.seine, meineReichweite: lage.meine,
    passung: passungFor(meine, contact), stufe: 'zusage',
  });
  const schub = db.setBoost(guildId, userId, {
    kind: 'release', factor: Math.min(4, 1 + 3 * staerke), extra: 1,
    until: now + 48 * 3600e3, contactId: contact.id, requestId: art.id,
  }, now);
  return { staerke, factor: schub.row.factor, neu: schub.neu, until: schub.row.until };
}

/**
 * Eine Gegenanfrage annehmen.
 *
 * Die Reihenfolge ist die halbe Miete und steht so im Aufgabenheft:
 *
 *   0. faul abrechnen, Ergebnis unter `vorher` – auch an jede Ablehnung danach
 *   1.–4. prüfen (weg · abgelaufen · unknown)
 *   5. die Musikseite, und ob diese Art überhaupt schon gebaut ist
 *   6. ZEIT BUCHEN – davor schreibt diese Aktion nichts
 *   7. die Wirkung der Art (alle Schreibvorgänge synchron)
 *   8. Status, Draht, Zähler
 *   9. die EINE Geldbuchung, ganz am Ende
 *
 * Warum das Geld nach Schritt 8 steht und nicht in Schritt 7: Es ist der
 * einzige `await` der Aktion. Stünde er vor dem Status, fände ein zweiter
 * Klick die Anfrage noch als `offen` vor und würde zweimal zahlen (§7).
 * `music.show` macht es genauso: erst den Künstler speichern, dann buchen.
 */
async function annehmen(guildId, userId, id, now = Date.now(), random = Math.random) {
  const contacts = require('./contacts');
  const music = require('./music');

  // 0. Erst nachholen, was ohnehin fällig war – und mit hinausreichen.
  const vorher = settle(guildId, userId, now, random);

  // 1.–4.
  const p = pruefen(guildId, userId, id, now, vorher);
  if (p.fehler) return p.fehler;
  const { row, art, contact } = p;

  // 5. Zusagen kann nur, wer selbst Musik macht – und nur bei einem Kontakt,
  //    der als Musiker Reichweite hat (dieselbe Lage wie ein Beef in 5b).
  const lage = require('./beef').musikLage(guildId, userId, contact, now);
  if (!lage) return { ok: false, reason: 'seite', contact, vorher };
  const meine = musikIch(guildId, userId, now);
  if (!meine) return { ok: false, reason: 'seite', contact, vorher };

  // 5b. Was Task 3 (`kollabo`, `tour`) und Task 4 (`label`) bauen, gibt es hier
  //     noch nicht. Zwei Dinge daran sind Absicht:
  //
  //     • Die Prüfung steht VOR der Zeitbuchung. Sie ist eine Voraussetzung,
  //       kein Ergebnis – sonst kostete ein Klick auf `label` zwei Stunden
  //       für eine Absage, und die Datenbank bliebe nicht unberührt.
  //     • Gefragt wird nach dem, was GEBAUT ist, nicht nach dem, was fehlt.
  //       Eine neue Art in `data.ARTEN` antwortet damit von selbst
  //       `noch_nicht`, statt unten in den letzten Zweig zu fallen und eine
  //       Gage auszuzahlen, die niemand gemeint hat.
  if (!GEBAUTE_ARTEN.has(art.id)) {
    return { ok: false, reason: 'noch_nicht', contact, angebot: row, art, vorher };
  }

  // 6. Die Stunden – ab hier wird geschrieben, vorher nicht. `kollabo` und
  //    `tour` kosten bei der Annahme nichts (`time: 0`); dort wird gar nicht
  //    erst gebucht, weil die API eine Nullbuchung nicht braucht.
  const zeit = art.time > 0
    ? require('./creator').useTime(guildId, userId, art.time, now)
    : { ok: true, factor: 1 };
  if (!zeit.ok) return { ok: false, ...zeit, contact, need: art.time, vorher };

  // 7. Die Wirkung der Art. Geld wird hier nur GERECHNET, nicht gebucht.
  let schub = null;
  let honorar = null;
  let gage = null;
  let extraHoerer = 0;
  let auftritt = null;
  let brutto = 0;
  let grund = '';

  if (art.id === 'tausch') {
    schub = schubFor(guildId, userId, { art, contact, meine, lage, now });
  } else if (art.id === 'gastpart') {
    honorar = honorarOf({
      seine: lage.seine,
      tantiemenProTag: music.royaltyPerDay(lage.meine, music.marketOf(guildId, userId)),
    });
    brutto = honorar;
    grund = `Gastpart: ${contact.name}`;
    schub = schubFor(guildId, userId, { art, contact, meine, lage, now });
  } else if (art.id === 'vorgruppe') {
    // Sein Publikum steckt AUSSCHLIESSLICH in der Gage: `gageOf` rechnet
    // `8 × (meine + extra)^0,7`, also höchstens 2^0,7 = +62 % – die Obergrenze,
    // die §3 für diesen Weg nennt. Auf die HÖRERSCHAFT kommt es nicht, sonst
    // verdoppelte ein Partner mit zwanzigfacher Reichweite sie auf einen Klick,
    // und über `hörer^1,2` in den Tantiemen würde daraus ein Zinssatz. Was
    // bleibt, ist der Zuwachs eines normalen Konzerts (`music.showGain`, 2 %),
    // und den bucht `bookSupportShow` selbst.
    gage = gageOf({
      meine: lage.meine, seine: lage.seine,
      showPay: music.SHOW_PAY, showExp: music.SHOW_EXP,
    });
    // Nur für die Anzeige und zum Nachrechnen der Gage – keine Hörerbuchung.
    extraHoerer = Math.round(Math.min(lage.meine, lage.seine * data.VORGRUPPE_ANTEIL));
    auftritt = music.bookSupportShow(guildId, userId, now);
    brutto = gage;
    grund = `Vorgruppe: ${contact.name}`;
  }

  // 8. Jetzt ist es verbindlich: Status, Draht, Zähler.
  const angebot = db.saveAngebot(guildId, id, { status: 'an' });
  const draht = contacts.moveDraht(guildId, userId, row.contact_id, data.DRAHT_AN, now);
  const uhr = db.angebotUhr(guildId, userId);
  db.saveAngebotUhr(guildId, userId, { ...uhr, abgelehnt_folge: 0 });

  // 9. Die einzige Geldbuchung – nach allen Schreibvorgängen, über den Weg des
  //    Konzerts (§3: eine Buchung, keine zweite Kasse).
  const geld = brutto > 0 ? await music.payGig(guildId, userId, brutto, grund) : null;

  return {
    ok: true, contact, art, draht, zeit, vorher,
    angebot: { ...angebot, artInfo: art, contact },
    honorar, gage, extraHoerer, auftritt, schub, geld,
    text: textFor(contact.trait, 'zusage', contact.name, random),
  };
}

/**
 * Eine Gegenanfrage absagen. Dieselben Prüfungen wie beim Annehmen, aber ohne
 * Zeitbuchung und ohne Musikseite: Nein sagen darf man immer, und es kostet
 * nur Draht – weniger als Liegenlassen.
 *
 * `random` ist nur für den Zufall, den Schritt 0 und die Textzeile brauchen.
 */
function ablehnen(guildId, userId, id, now = Date.now(), random = Math.random) {
  const contacts = require('./contacts');

  // 0. wie beim Annehmen.
  const vorher = settle(guildId, userId, now, random);

  const p = pruefen(guildId, userId, id, now, vorher);
  if (p.fehler) return p.fehler;
  const { row, art, contact } = p;

  const angebot = db.saveAngebot(guildId, id, { status: 'ab' });
  const draht = contacts.moveDraht(guildId, userId, row.contact_id, data.DRAHT_AB, now);
  const uhr = db.angebotUhr(guildId, userId);
  db.saveAngebotUhr(guildId, userId, { ...uhr, abgelehnt_folge: uhr.abgelehnt_folge + 1 });

  return {
    ok: true, contact, art, draht, vorher,
    angebot: { ...angebot, artInfo: art, contact },
    text: textFor(contact.trait, 'absage', contact.name, random),
  };
}

module.exports = {
  gewichtOf, honorarOf, gageOf, kollaboFaktorOf, fristOf, rollTage, textFor,
  artOf, artenFuer, offeneAngebote, offeneProjekte, settle, annehmen, ablehnen,
};
