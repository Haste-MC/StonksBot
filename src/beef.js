/**
 * ===========================================================================
 *  BEEF – DIE REINEN RECHNUNGEN
 * ===========================================================================
 *
 * Hier steht, was ein Streit mit einem anderen Künstler wert ist – und sonst
 * nichts: kein Discord, kein Zufall außer dem, der hereingereicht wird, und in
 * DIESER ersten Hälfte auch kein einziger Blick in die Datenbank – das `db`
 * unten ist allein für die zweite Hälfte ab dem zweiten Banner da. Dadurch
 * lässt sich jede Zahl einzeln nachrechnen und testen.
 *
 *   traitBonus        was der Charakterzug am Einstieg dreht
 *   einstiegOf        steigt er überhaupt ein? (die Umkehrung von 5a)
 *   wuchtOf           wie groß der ist, den du anfasst
 *   genrefaktorOf     wie genau in diesem Genre hingehört wird
 *   aufmerksamkeitOf  was ein Disstrack an Publikum bringt
 *   haemeOf           wie sehr du ausgelacht wirst, wenn du nach unten trittst
 *   hitzeJetzt        die Uhr des Beefs, faul gerechnet
 *   rundeNachDiss     wem die Runde nach deinem Disstrack gehört
 *   rundeNachKonter   wem die Runde nach seinem Gegenschlag gehört
 *   ausgangOf         sieg · niederlage · unentschieden
 *   bonusFaktor       was der Ausgang eine Woche lang am Hype macht
 *   anzaehlGewicht    wie wahrscheinlich dich gerade dieser anzählt
 *   textFor           eine Zeile im Ton des Kontakts
 *
 * Die Zahlen und Texte stehen in data/beef.js.
 */

const data = require('./data/beef');
const db = require('./db');

const clamp = (lo, hi, v) => Math.max(lo, Math.min(hi, v));

/** Der Charakterzug beim Streit – der Geschäftsmann rechnet die Größe mit. */
function traitBonus(trait, meine, seine) {
  const basis = data.BEEF_TRAIT[trait] ?? 0;
  if (trait !== 'geschaeftlich') return basis;
  return basis + data.GESCHAEFT_GROESSE * clamp(0, 1, meine / Math.max(1, seine));
}

/**
 * Steigt er ein? Die Umkehrung der Antwortchance aus 5a: Beim Gefallen hilft
 * es, klein zu sein, beim Streit nicht. Der Riese hat nichts zu gewinnen.
 */
function einstiegOf({ meine, seine, trait }) {
  const v = Math.log10(Math.max(100, meine) / Math.max(1, seine));
  return clamp(data.EINSTIEG_MIN, data.EINSTIEG_MAX,
    data.EINSTIEG_BASIS + data.EINSTIEG_STEIGUNG * v + traitBonus(trait, meine, seine));
}

/** Wie groß der ist, den du anfasst – dieselbe Form wie staerkeOf in 5a. */
function wuchtOf({ seine, meine }) {
  return clamp(0, 1, Math.log10(1 + seine / Math.max(100, meine)) / 3);
}

/** Hip-Hop 1,0 – das Genre-Feld `risk` sagt, wie genau hingehört wird. */
function genrefaktorOf(risk) { return (risk ?? 1) / 1.3; }

/** Was ein Disstrack an Aufmerksamkeit bringt. */
function aufmerksamkeitOf({ wucht, genrefaktor, hitze }) {
  return 1 + data.DISS_AUFMERK * wucht * genrefaktor * (0.5 + 0.5 * clamp(0, 100, hitze) / 100);
}

/** Wer nach unten tritt, wird ausgelacht. */
function haemeOf({ meine, seine, genrefaktor }) {
  return clamp(0, data.HAEME_MAX,
    Math.log10(Math.max(1, meine / Math.max(1, seine))) / 3 + 0.2 * (1 - genrefaktor));
}

/** Abkühlung, faul gerechnet (§4) – schreibt nichts. */
function hitzeJetzt(row, now) {
  if (!row) return 0;
  const tage = Math.max(0, (now - (row.last_cool || 0)) / 86_400_000);
  return clamp(0, data.HITZE_MAX, row.hitze - data.HITZE_COOL_PRO_TAG * tage);
}

/** Dein Disstrack holt die Runde – außer er ging nach hinten los. */
function rundeNachDiss(haeme) { return haeme ? 'er' : 'ich'; }

/** Sein Konter holt die Runde – außer er ist so klein, dass es lächerlich wirkt. */
function rundeNachKonter(wucht) { return wucht < data.KONTER_LAECHERLICH ? 'ich' : 'er'; }

/** Mehr Runden gewonnen als verloren – dazwischen bleibt es unentschieden. */
function ausgangOf(rundenIch, rundenEr) {
  if (rundenIch > rundenEr) return 'sieg';
  if (rundenIch < rundenEr) return 'niederlage';
  return 'unentschieden';
}

/** Was der Ausgang eine Woche lang am Hype macht – Frieden zahlt nichts. */
function bonusFaktor(status) {
  if (status === 'sieg') return data.BONUS_SIEG;
  if (status === 'niederlage') return data.BONUS_NIEDERLAGE;
  return 1;
}

/** Wer zählt dich an? Nähe im Genre, Nähe in der Größe, streitbarer Charakter. */
function anzaehlGewicht({ trait, meine, seine, gleichesGenre, verwandtesGenre }) {
  const genrenaehe = gleichesGenre ? 3 : verwandtesGenre ? 2 : 1;
  const abstand = Math.abs(Math.log10(Math.max(1, seine) / Math.max(100, meine)));
  const groessennaehe = 1 / (1 + abstand);
  return genrenaehe * groessennaehe * (1 + Math.max(0, data.BEEF_TRAIT[trait] ?? 0));
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
 *  DIE ZUSTANDSBEHAFTETE SCHICHT
 * ===========================================================================
 *
 * Ab hier kommt die Datenbank dazu: die Tabelle `beefs` mit Hitze, Runden und
 * Uhr. Die Rechnungen oben bleiben unberührt – hier wird nur gelesen,
 * gewürfelt und geschrieben.
 *
 * Drei Regeln, die überall durchschlagen:
 *
 *   • Die zwei Stunden werden IMMER gebucht, auch wenn er nicht einsteigt –
 *     und zwar BEVOR irgendetwas geschrieben wird. Ein abgelehnter Versuch
 *     hinterlässt weder Beef noch Draht noch Sperre.
 *   • Die Abkühlung wird beim Lesen ausgerechnet, nie geschrieben (§4). Erst
 *     wenn ohnehin etwas geschrieben wird, wandert der abgekühlte Wert mit.
 *   • Der Draht wird hier NIE selbst geschrieben. Das macht ausschließlich
 *     `contacts.moveDraht` – eine Stelle, ein Abklingen, eine Sperre.
 */

const DAY_MS = 86_400_000;

/** Der Beef mit ihm, wenn er offen ist – mit faul gerechneter Hitze. */
function offenerBeef(guildId, userId, contactId, now = Date.now()) {
  const row = db.beefRow(guildId, userId, contactId);
  if (!row || row.status !== 'offen') return null;
  return { ...row, hitze: hitzeJetzt(row, now) };
}

/** Alle offenen Beefs, Hitze faul gerechnet. */
function offeneBeefs(guildId, userId, now = Date.now()) {
  return db.beefsOf(guildId, userId)
    .filter((r) => r.status === 'offen')
    .map((r) => ({ ...r, hitze: hitzeJetzt(r, now) }));
}

/**
 * Die Zahlen, mit denen ein Beef rechnet – immer die der Musikseite.
 *
 * `contacts.detail` meldet bei einem Kontakt, der beides macht, die LEITSEITE:
 * Wer mehr Follower als Hörer hat, bekommt dort `creator` und damit die
 * Creator-Zahlen. Für einen Streit wäre das falsch – er würde mal mit den
 * Hörern und mal mit den Followern rechnen, je nachdem, was gerade größer
 * ist, und ein wachsender Kanal würde die Wucht MITTEN im laufenden Beef
 * verschieben. Ein Beef ist von vorn bis hinten eine Sache unter Musikern,
 * also holt er sich seine beiden Zahlen selbst: meine Hörer gegen seine
 * Reichweite als Musiker. Null heißt: Einer von beiden macht keine Musik.
 */
function musikLage(guildId, userId, contact, now = Date.now()) {
  if (!contact?.reach) return null;
  const m = require('./music').status(guildId, userId, now);
  if (!m.started) return null;
  return { meine: m.listeners, seine: contact.reach };
}

/**
 * Jemanden anstacheln.
 *
 * Die Reihenfolge ist hier die halbe Miete und dieselbe wie bei einer Anfrage
 * in 5a: erst alles prüfen, dann die Zeit buchen, dann würfeln, dann in einem
 * Rutsch schreiben. Bis zur Zeitbuchung schreibt DIE AKTION SELBST nichts –
 * wer kein Zeitbudget mehr hat, hinterlässt keine Spur. Schritt 0 darf davor
 * trotzdem schreiben: Was dort fällig ist, war es schon vorher und wäre bei
 * jeder Ansicht ebenso nachgeholt worden.
 */
function anstacheln(guildId, userId, contactId, now = Date.now(), random = Math.random) {
  const contacts = require('./contacts');

  // 0. Erst aufräumen: Ein Beef, dessen Hitze längst durch ist, steht bis zur
  //    Abrechnung weiter als offen in der Tabelle und würde hier als Front
  //    mitzählen. Die Abrechnung ist faul (§4), also holen wir sie nach,
  //    bevor wir zählen – geschrieben wird dabei nur, was ohnehin fällig war.
  //    Die dabei ausgelösten Ereignisse (Gegenschlag, Abrechnung) gehen sonst
  //    spurlos verloren, also reichen wir sie unter `vorher` mit hinaus.
  const vorher = settle(guildId, userId, now, random);

  // 1. Kennen wir ihn überhaupt?
  const d = contacts.detail(guildId, userId, contactId, now);
  if (!d) return { ok: false, reason: 'unknown', vorher };

  // 2. Beef ist eine Sache unter Musikern: Ich brauche eine Musikkarriere, er
  //    eine Reichweite als Musiker. Auf der Creator-Seite gibt es keinen
  //    Disstrack, also auch keinen Streit.
  const lage = musikLage(guildId, userId, d.contact, now);
  if (!lage) return { ok: false, reason: 'seite', contact: d.contact, vorher };

  // 3. Mit ihm läuft schon etwas.
  if (offenerBeef(guildId, userId, contactId, now)) {
    return { ok: false, reason: 'laeuft_schon', contact: d.contact, vorher };
  }

  // 3b. Die Straße redet noch über die letzte Sache: Solange das Bonusfenster
  //     des Beefs läuft, der gerade mit ihm abgerechnet wurde, fängt man mit
  //     ihm keinen neuen an – der würde die Zeile sonst gleich überschreiben
  //     und den eben verdienten Bonus mitreißen (Tabelle hat nur eine Zeile
  //     je Kontakt).
  const alt = db.beefRow(guildId, userId, contactId);
  if (alt && alt.status !== 'offen' && alt.bonus_until > now) {
    return { ok: false, reason: 'zu_frisch', contact: d.contact, bis: alt.bonus_until, vorher };
  }

  // 4. Zwei Fronten reichen.
  const offene = offeneBeefs(guildId, userId, now);
  if (offene.length >= data.BEEFS_MAX) {
    return { ok: false, reason: 'zu_viele', contact: d.contact, max: data.BEEFS_MAX, offen: offene.length, vorher };
  }

  // 5. Er ist noch dicht von der letzten Runde.
  if (d.gesperrtBis > now) {
    return { ok: false, reason: 'gesperrt', contact: d.contact,
      bis: d.gesperrtBis, remainingMs: d.gesperrtBis - now, vorher };
  }

  // 6. Zwei Stunden kostet der Abend – auch wenn er nicht einsteigt.
  const zeit = require('./creator').useTime(guildId, userId, data.BEEF_TIME, now);
  if (!zeit.ok) return { ok: false, ...zeit, contact: d.contact, need: data.BEEF_TIME, vorher };

  // 7. Der Wurf.
  const chance = einstiegOf({ ...lage, trait: d.contact.trait });
  const ein = random() < chance;

  // 8. Schreiben – und zwar erst jetzt.
  let draht;
  let treffer = null;
  if (ein) {
    db.saveBeef(guildId, userId, contactId, {
      hitze: data.HITZE_ANSTACHELN, runden_ich: 0, runden_er: 0,
      last_hit: now, last_cool: now, konter_at: 0, angefangen: now,
      status: 'offen', bonus_until: 0,
    });
    draht = contacts.moveDraht(guildId, userId, contactId,
      data.DRAHT_ANSTACHELN, now, { sperre: true });
  } else {
    // Blamage: er steigt nicht ein, die Zeile steht allein da. Draht runter,
    // einmalig ein Zwanzigstel Hype – der Rest bleibt, wie er war.
    draht = contacts.moveDraht(guildId, userId, contactId,
      data.DRAHT_BLAMAGE, now, { sperre: true });
    treffer = require('./music').applyBeefTreffer(guildId, userId,
      { hype: data.BLAMAGE_HYPE, hoererAnteil: 0 }, now);
  }

  // 9. Was die Anzeige erzählt.
  return {
    ok: true, ein, chance, contact: d.contact,
    text: textFor(d.contact.trait, ein ? 'einstieg' : 'blamage', d.contact.name, random),
    draht, treffer, zeit, vorher,
  };
}

/**
 * Die faule Abrechnung (§4): Gegenschlag und Ende passieren nicht zu ihrer
 * Zeit, sondern sobald jemand hinsieht oder handelt.
 *
 * Darf auf jeder Ansicht und vor jeder Aktion laufen: Ist nichts fällig, wird
 * nichts geschrieben und nichts gemeldet. Ein fällig gewordener Gegenschlag
 * fällt genau einmal – `konter_at` wird dabei auf 0 gesetzt (§9), auch wenn
 * er verfällt, weil die Hitze inzwischen zu niedrig ist.
 */
function settle(guildId, userId, now = Date.now(), random = Math.random) {
  const contacts = require('./contacts');
  const katalog = require('./data/contacts');
  const ereignisse = [];

  for (const row of db.beefsOf(guildId, userId)) {
    if (row.status !== 'offen') continue;

    // 1. Wie heiß ist es jetzt?
    let hitze = hitzeJetzt(row, now);
    let rundenIch = row.runden_ich;
    let rundenEr = row.runden_er;
    let konterAt = row.konter_at;
    let lastHit = row.last_hit;
    let status = row.status;
    let bonusUntil = row.bonus_until;
    let bewegt = false;
    const gegner = katalog.byId(row.contact_id);

    // 2. Ist sein Gegenschlag fällig?
    if (konterAt > 0 && now >= konterAt) {
      konterAt = 0;          // genau einmal, egal wie es ausgeht (§9)
      bewegt = true;
      // Ohne Gegner im Katalog (oder ohne Karriere) gäbe es nur Schreibvorgänge
      // ohne Wirkung – dann geht der Schlag ins Leere wie unter der Mindesthitze.
      const lage = gegner ? musikLage(guildId, userId, gegner, now) : null;
      if (hitze >= data.HITZE_KONTER_MIN && lage) {
        const wucht = wuchtOf(lage);
        const treffer = require('./music').applyBeefTreffer(guildId, userId, {
          hype: 1 - data.KONTER_HYPE * wucht,
          hoererAnteil: data.KONTER_HOERER * wucht,
        }, now);
        const runde = rundeNachKonter(wucht);
        if (runde === 'er') rundenEr += 1; else rundenIch += 1;
        hitze = clamp(0, data.HITZE_MAX, hitze + data.HITZE_KONTER);
        const draht = contacts.moveDraht(guildId, userId, row.contact_id, data.DRAHT_KONTER, now);
        lastHit = now;
        ereignisse.push({
          contactId: row.contact_id, art: 'konter', contact: gegner,
          wucht, runde, treffer, draht, hitze, rundenIch, rundenEr,
          text: textFor(gegner.trait, 'konter', gegner.name, random),
        });
      }
      // Sonst verfällt der Schlag. Nur konter_at = 0.
    }

    // 3. Ist die Hitze durch? Dann wird abgerechnet.
    if (hitze <= 0) {
      status = ausgangOf(rundenIch, rundenEr);
      bonusUntil = now + data.BONUS_TAGE * DAY_MS;
      bewegt = true;
      ereignisse.push({
        contactId: row.contact_id, art: 'ende', contact: gegner ?? null,
        status, rundenIch, rundenEr, faktor: bonusFaktor(status), bonusUntil,
        text: gegner ? textFor(gegner.trait, 'ende', gegner.name, random) : '',
      });
    }

    // 4. Ein Schreibvorgang je bewegtem Beef – und nur dann.
    if (!bewegt) continue;
    db.saveBeef(guildId, userId, row.contact_id, {
      hitze, runden_ich: rundenIch, runden_er: rundenEr,
      last_hit: lastHit, last_cool: now, konter_at: konterAt,
      angefangen: row.angefangen, status, bonus_until: bonusUntil,
    });
  }

  // 5. Was die Anzeige (Stück 4) melden kann.
  return ereignisse;
}

/**
 * Der Bonus auf den Hype: der JÜNGSTE abgerechnete Beef, dessen Fenster noch
 * läuft. Gestapelt wird nie – wie der Schub in 5a.
 */
function bonusOf(guildId, userId, now = Date.now()) {
  const fertig = db.beefsOf(guildId, userId)
    .filter((r) => r.status !== 'offen' && r.bonus_until > now)
    .sort((a, b) => b.bonus_until - a.bonus_until);
  const j = fertig[0];
  return j ? { faktor: bonusFaktor(j.status), status: j.status, contactId: j.contact_id, until: j.bonus_until }
    : { faktor: 1, status: null, contactId: null, until: 0 };
}

/**
 * Solange es brennt, macht seine Szene dicht: gleiche Sprache UND gleiches
 * Genre wie der Gegner – oder er selbst.
 *
 * Bei zwei offenen Beefs zählt der GRÖSSTE Malus, nicht die Summe. Sonst
 * könnte man sich mit zwei Streits vollständig selbst aussperren.
 */
function szeneMalus(guildId, userId, contact, now = Date.now()) {
  let max = 0;
  for (const b of offeneBeefs(guildId, userId, now)) {
    const gegner = require('./data/contacts').byId(b.contact_id);
    if (!gegner) continue;
    const szene = gegner.id === contact.id
      || (gegner.language === contact.language
        && Boolean(gegner.genre) && gegner.genre === contact.genre);
    if (!szene) continue;
    max = Math.max(max, data.SZENE_MALUS * (b.hitze / 100));
  }
  return -max;
}

/**
 * Frieden anbieten.
 *
 * Möglich, sobald die Hitze unter HITZE_FRIEDEN_MAX liegt – auch noch nach
 * dem Ende, solange die Zeile steht; dann verfällt der Bonus mit. Der Draht
 * springt dabei nie ins Plus (FRIEDEN_DECKEL): Beef anfangen und sofort
 * Frieden schließen ist keine Abkürzung zum Partner.
 */
function frieden(guildId, userId, contactId, now = Date.now(), random = Math.random) {
  const contacts = require('./contacts');

  // Erst die faule Abrechnung nachholen (§4), damit ein längst ausgekühlter
  // Beef hier als das dasteht, was er ist. Was dabei fällig wurde, geht sonst
  // spurlos verloren – also unter `vorher` mit hinausreichen.
  const vorher = settle(guildId, userId, now, random);

  const d = contacts.detail(guildId, userId, contactId, now);
  if (!d) return { ok: false, reason: 'unknown', vorher };

  const row = db.beefRow(guildId, userId, contactId);
  if (!row) return { ok: false, reason: 'kein_beef', contact: d.contact, vorher };

  // Zu heiß ist eine Voraussetzung wie die Sperre bei einer Anfrage, kein
  // Ergebnis: Sie steht VOR der Zeitbuchung. Wer es zu früh versucht, hat den
  // Abend noch.
  const hitze = hitzeJetzt(row, now);
  if (hitze >= data.HITZE_FRIEDEN_MAX) {
    return { ok: false, reason: 'zu_heiss', hitze, contact: d.contact, vorher };
  }

  // Auch die Versöhnung kostet den Abend – gebucht vor jedem Schreiben.
  const zeit = require('./creator').useTime(guildId, userId, data.BEEF_TIME, now);
  if (!zeit.ok) return { ok: false, ...zeit, contact: d.contact, need: data.BEEF_TIME, vorher };

  db.saveBeef(guildId, userId, contactId, {
    ...row, hitze: 0, konter_at: 0, last_cool: now,
    status: 'frieden', bonus_until: 0,
  });
  const ziel = Math.min(data.FRIEDEN_DECKEL, d.draht + data.FRIEDEN_PLUS);
  const draht = contacts.moveDraht(guildId, userId, contactId, ziel - d.draht, now, { sperre: true });

  return {
    ok: true, contact: d.contact, status: 'frieden', hitze, draht, zeit, vorher,
    text: textFor(d.contact.trait, 'ende', d.contact.name, random),
  };
}

module.exports = {
  traitBonus, einstiegOf, wuchtOf, genrefaktorOf, aufmerksamkeitOf, haemeOf,
  hitzeJetzt, rundeNachDiss, rundeNachKonter, ausgangOf, bonusFaktor,
  anzaehlGewicht, textFor,
  offenerBeef, offeneBeefs, anstacheln, settle, bonusOf, szeneMalus, frieden,
};
