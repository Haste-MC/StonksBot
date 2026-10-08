/**
 * ===========================================================================
 *  KONTAKTE – DIE REINEN RECHNUNGEN
 * ===========================================================================
 *
 * Hier steht, was passiert, wenn man jemanden anschreibt – und sonst nichts:
 * kein Discord, kein Zufall außer dem, der hereingereicht wird, und in DIESER
 * ersten Hälfte auch keine Datenbank (die kommt erst beim zweiten Banner dazu).
 * Dadurch lässt sich jede Zahl einzeln nachrechnen und testen.
 *
 *   passungOf   wie gut zwei Künstler zueinander passen (Sprache × Genre)
 *   chanceOf    Wurf 1: antwortet er überhaupt?
 *   stufeVon    Wurf 2: wie verbindlich fällt die Antwort aus?
 *   staerkeOf   wie viel eine Antwort wert ist (Größenunterschied × Passung)
 *   boostOf     der Schub, den ein Ja setzt
 *   decay       wie die Beziehung ohne Kontakt abkühlt
 *   drahtVon    der Draht als Mittelwert der zwei Achsen
 *   decayAchse  wie EINE Achse abkühlt (mit Boden)
 *   respektGewicht  das Gewicht des Respekts in der Antwortchance
 *   respektWirkt    der Respekt, der bei diesem Vertrauen noch wirkt
 *   istPartner  fester Partner – die EINZIGE Regel dafür
 *   artOf      die Art der Beziehung (zehn Arten, Reihenfolge ist Absicht)
 *
 * Die Zahlen und Schwellen stehen in data/contacts.js.
 */

const data = require('./data/contacts');
const db = require('./db');

const clamp = (lo, hi, v) => Math.max(lo, Math.min(hi, v));

/** Wie gut passen zwei Künstler zueinander – steuert Chance UND Wirkung. */
function passungOf({ meine, seine, seite = 'musik' }) {
  const sprachfaktor = meine.language === seine.language ? 1
    : (meine.language === 'englisch' || seine.language === 'englisch') ? 0.6 : 0.15;
  if (seite === 'creator') {
    const plattformfaktor = meine.platform === seine.platform ? 1 : 0.6;
    return { sprachfaktor, genrefaktor: plattformfaktor, passung: sprachfaktor * plattformfaktor };
  }
  const verwandt = data.RELATED_GENRES.some(([a, b]) =>
    (a === meine.genre && b === seine.genre) || (b === meine.genre && a === seine.genre));
  const genrefaktor = meine.genre === seine.genre ? 1 : verwandt ? 0.7 : 0.3;
  return { sprachfaktor, genrefaktor, passung: sprachfaktor * genrefaktor };
}

/** Antwortchance (Wurf 1) – alle Summanden aus der Spec. */
function chanceOf({ meineReichweite, seineReichweite, request, gleichesLand, sprache, genre,
  respekt = 0, vertrauen = 0, tuerOeffner = 0, hype = 1, trait = 'launisch',
  partner = false, szene = 0 }) {
  const ratio = Math.max(100, meineReichweite || 0) / Math.max(1, seineReichweite);
  const basis = Math.min(data.CHANCE_MAX, 0.6 * Math.sqrt(ratio));
  const r = data.REQUESTS.find((x) => x.id === request);
  const sprachbonus = sprache === 'gleich' ? 0.10 : sprache === 'englisch' ? 0 : -0.15;
  const genrebonus = genre === 'gleich' ? 0.05 : genre === 'verwandt' ? 0 : -0.05;
  return clamp(data.CHANCE_MIN, data.CHANCE_MAX,
    basis + (r?.schwierigkeit ?? 0)
    + (gleichesLand ? 0.05 : 0) + sprachbonus + genrebonus
    // Respekt öffnet die Tür, und je größer der Abstand, desto mehr – aber nur
    // so weit, wie er dir überhaupt noch traut (`respektWirkt`).
    + (respektWirkt(respekt, vertrauen) / 100) * respektGewicht(meineReichweite, seineReichweite)
    // Positives Vertrauen hebt die Chance NICHT – das ist Respekts Aufgabe.
    // Negatives senkt sie zusätzlich: der additive Teil des Riegels.
    + Math.min(0, vertrauen / 100) * data.VERTRAUEN_MALUS
    + clamp(0, 0.15, tuerOeffner)
    + (hype - 1) * 0.1 + (data.TRAIT_BONUS[trait] ?? 0) + (partner ? 0.10 : 0)
    // Solange ein Beef offen ist, macht die Szene des Gegners dicht (5b). Die
    // reine Hälfte holt sich das nicht selbst – sie bekommt es gereicht.
    + szene);
}

/**
 * Wie verbindlich die Antwort ausfällt (Wurf 2).
 *
 * Das Gewicht der Zusage hängt am RESPEKT, nicht am Mittelwert: Mit Vertrauen
 * wäre es selbstverstärkend (Vertrauen erzeugt Zusagen erzeugt Vertrauen), und
 * Respekt ist durchgehend die Achse, die über das Antworten entscheidet. Der
 * `ratio` bleibt der rohe Größenvergleich.
 *
 * Das Vertrauen steht hier nur als DÄMPFER (`respektWirkt`), nicht als eigener
 * Summand: Wer nur noch Respekt und kein Vertrauen hat, bekommt sonst über das
 * Zusage-Gewicht dauerhaft mehr Schub je Antwort – der Beef veränderte damit
 * den Ertrag und nicht bloß den Zugang (§3).
 */
function stufeVon(random, { ratio, respekt = 0, vertrauen = 0 }) {
  const naehe = Math.min(1, ratio);
  const gewichte = {
    fluechtig: 6 * (ratio < 0.05 ? 2 : 1),
    echt: 3,
    zusage: 1 * (1 + 2 * naehe) * (1 + respektWirkt(respekt, vertrauen) / 100),
  };
  const summe = gewichte.fluechtig + gewichte.echt + gewichte.zusage;
  let wurf = random() * summe;
  for (const [stufe, g] of Object.entries(gewichte)) {
    if (wurf < g) return stufe;
    wurf -= g;
  }
  return 'fluechtig';
}

const STUFEN_FAKTOR = { fluechtig: 0.25, echt: 0.5, zusage: 1 };

/** Wie stark der Schub ausfällt. */
function staerkeOf({ seineReichweite, meineReichweite, passung, stufe }) {
  const roh = clamp(0, 1, Math.log10(1 + seineReichweite / Math.max(100, meineReichweite || 0)) / 3);
  return roh * passung * (STUFEN_FAKTOR[stufe] ?? 0);
}

/** Der Schub, den ein Ja setzt. */
function boostOf(requestId, staerke, seineReichweite) {
  if (requestId === 'konzert') {
    return { kind: 'show', factor: 1, extra: Math.round(staerke * seineReichweite * 0.1), dauerMs: 7 * 24 * 3600e3 };
  }
  if (requestId === 'feature') {
    return { kind: 'release', factor: Math.min(6, 1 + 5 * staerke), extra: 1 + 0.15 * staerke, dauerMs: 72 * 3600e3 };
  }
  return { kind: 'release', factor: Math.min(4, 1 + 3 * staerke), extra: 1, dauerMs: 48 * 3600e3 };
}

/** Abklingen Richtung 0, 2 Punkte je Woche, ohne Überschießen. */
function decay(draht, tage) {
  const ab = Math.floor(Math.max(0, tage) / 7) * data.DRAHT_DECAY_PRO_WOCHE;
  if (draht > 0) return Math.max(0, draht - ab);
  if (draht < 0) return Math.min(0, draht + ab);
  return 0;
}

/** Der Draht ist abgeleitet – hier gerechnet, geschrieben nur in db.saveContact. */
const drahtVon = (respekt, vertrauen) => Math.round((respekt + vertrauen) / 2);

/**
 * Eine Achse Richtung Ziel, ohne Überschießen.
 *
 * Von oben gegen `boden`, von unten gegen 0. Der Boden bremst nur den Fall –
 * er zieht nicht nach oben und heilt damit keinen Beef.
 */
function decayAchse(wert, punkte, boden = 0) {
  if (wert > boden) return Math.max(boden, wert - punkte);
  if (wert < 0) return Math.min(0, wert + punkte);
  return wert;
}

/** Das Gewicht des Respekts in der Antwortchance – wächst mit dem Abstand. */
function respektGewicht(meine, seine) {
  const dekaden = Math.log10(Math.max(1, seine) / Math.max(100, meine || 0));
  return data.RESPEKT_W_MIN
    + data.RESPEKT_W_SPAN * clamp(0, 1, dekaden / data.RESPEKT_W_DEKADEN);
}

/**
 * Der Respekt, der tatsächlich wirkt.
 *
 * Er nimmt dich ernst – aber solange er dir überhaupt nicht traut, nützt dir
 * das nichts. Bei Vertrauen ≥ 0 ist der Faktor 1 und nichts ändert sich; bei
 * −100 ist der Respekt-Term ganz weg.
 *
 * Ohne diese Dämpfung sättigt der additive VERTRAUEN_MALUS bei −0,25, während
 * der Respekt-Term bis 0,45 läuft: Ein Spieler mit acht gelandeten Dissen
 * (Respekt 68, Vertrauen −100) käme auf 12,5 % Antwortchance gegen 6,9 % beim
 * Fremden – und über das Zusage-Gewicht in `stufeVon` auch an mehr Schub, also
 * an mehr Hörer. Das wäre §3.
 */
function respektWirkt(respekt, vertrauen) {
  return Math.max(0, respekt) * (1 + Math.min(0, vertrauen / 100));
}

/**
 * Fester Partner. Die EINZIGE Regel – gültig für vier Stellen: das ⭐, die +10
 * Punkte Antwortchance, die Türöffner-Zählung und die Anzählrunde in beef.js,
 * die seit Task 5 über `istPartnerRow` hier mitliest statt `drahtJetzt >=
 * STUFE_PARTNER` zu prüfen. Respekt 100 / Vertrauen 0 ist Draht 50 und
 * trotzdem kein Partner – und das gilt jetzt überall gleich.
 *
 * Vorher gab es drei Fassungen, von denen zwei sich widersprachen: Die Ansicht
 * zeigte das ⭐ bei `yes >= 3`, gezählt wurde aber nur `draht >= 50` – wer drei
 * Zusagen bei Draht 30 hatte, las „das öffnet Türen im Umfeld" und öffnete
 * keine.
 */
const istPartner = (respekt, vertrauen) =>
  respekt >= data.PARTNER_RESPEKT && vertrauen >= data.PARTNER_VERTRAUEN;

/**
 * Die Art der Beziehung – reine Funktion, kein Zustand, keine Datenbank.
 * Die ERSTE passende Art gewinnt, und die Reihenfolge ist an drei Stellen
 * Absicht:
 *
 *   • `rivale` über `verstimmt`, sonst verschwindet er: Respekt 30 bei
 *     Vertrauen −80 ergibt Draht −25 und hieße sonst nur „verstimmt".
 *   • `mentor`/`schuetzling` über `partner`, weil sie das Spezifischere sind.
 *     `istPartner` ist davon unabhängig – die Ansicht zeigt beides.
 *   • `band` unter den warmen Arten, damit sie das bedeutet, was sie sagt:
 *     Ihr habt etwas zusammen durchgezogen, und seither ist es abgekühlt.
 *     Zwei Wege führen dorthin: ein großes Format (Kollabo oder Tour, Boden
 *     +10) oder mehrere kleine (vier angenommene Gegenanfragen, je +3, ergeben
 *     12 – ohne ein einziges Album).
 *
 * `beefOffen` wird hereingereicht, nicht gelesen – der Aufrufer hat den Beef
 * sowieso in der Hand (`contacts.detail` fragt ihn heute schon).
 */
function artOf({ respekt, vertrauen, boden = 0, meine = 0, seine = 0,
  trait = null, beefOffen = false }) {
  const draht = drahtVon(respekt, vertrauen);
  const erGroesser = Math.max(1, seine) / Math.max(1, meine);
  const ichGroesser = Math.max(1, meine) / Math.max(1, seine);

  if (beefOffen) return 'beef';
  if (respekt >= data.ART_RIVALE_RESPEKT
    && vertrauen <= data.ART_RIVALE_VERTRAUEN) return 'rivale';
  if (draht <= data.STUFE_VERSTIMMT) return 'verstimmt';
  if (erGroesser >= data.ART_ABSTAND && respekt >= data.ART_MENTOR_RESPEKT
    && vertrauen >= data.ART_MENTOR_VERTRAUEN) return 'mentor';
  if (ichGroesser >= data.ART_ABSTAND
    && vertrauen >= data.ART_SCHUETZLING_VERTRAUEN) return 'schuetzling';
  if (istPartner(respekt, vertrauen)) return 'partner';
  if (boden >= data.ART_BAND_BODEN) return 'band';
  if (trait === 'geschaeftlich'
    && respekt >= data.ART_GESCHAEFTLICH_RESPEKT) return 'geschaeftlich';
  if (draht >= data.STUFE_BEKANNT) return 'bekannt';
  return 'fremd';
}


/**
 * ===========================================================================
 *  DIE ZUSTANDSBEHAFTETE SCHICHT
 * ===========================================================================
 *
 * Ab hier kommt die Datenbank dazu: der Draht zu jedem Kontakt, die Sperren,
 * die Schübe. Die Rechnungen oben bleiben unberührt – hier wird nur gelesen,
 * gewürfelt und geschrieben.
 *
 * Zwei Regeln, die überall durchschlagen:
 *
 *   • Die zwei Stunden werden IMMER gebucht, auch wenn er gar nicht antwortet
 *     (der Abend ist weg) – und zwar bevor irgendetwas geschrieben wird.
 *   • Das Abklingen des Drahts wird beim Lesen ausgerechnet, nie geschrieben
 *     (§4). Erst die nächste Bewegung schreibt den abgekühlten Wert fort.
 */

const DAY_MS = 24 * 3600e3;

/** Anteil der Ablehnungen, die einen Empfindlichen verstimmen. */
const VERSTIMMT_CHANCE = 0.25;

/** Der Draht, der für die Liste als Anfrageart dient (neutral, ±0). */
const LIST_REQUEST = 'shoutout';

/** Sind zwei Genres verwandt? (Tabelle in data/contacts.js) */
function verwandt(a, b) {
  return data.RELATED_GENRES.some(([x, y]) => (x === a && y === b) || (y === a && x === b));
}

/**
 * Wer ich gerade bin – einmal je Aufruf, nicht je Kontakt.
 *
 * `creator` ist bewusst an echten Followern festgemacht: `status().total` hat
 * einen Musik-Boden, sonst hätte jeder Musiker automatisch eine Creator-Seite.
 */
function ichFor(guildId, userId, now) {
  const m = require('./music').status(guildId, userId, now);
  const c = require('./creator').status(guildId, userId, now);
  const beste = c.platforms.reduce((a, p) => (p.followers > (a?.followers ?? -1) ? p : a), null);
  return {
    country: m.market.country.id,
    language: m.market.language.id,
    musik: m.started,
    genre: m.started ? m.genre.id : null,
    listeners: m.listeners,
    hype: m.hype ?? 1,
    creator: (beste?.followers ?? 0) > 0,
    total: c.total,
    platform: (beste?.followers ?? 0) > 0 ? beste.id : null,
  };
}

/**
 * Über welche Seite eine Anfrage läuft – oder null, wenn keine passt.
 *
 * `feature` und `konzert` gehen über die Musikseite, solange man Musik macht;
 * eine Reaktion oder Erwähnung läuft über die Seite, auf der man selbst mehr
 * Reichweite hat.
 */
function seiteFuer(contact, ich, requestId = null) {
  const kannMusik = (contact.kind === 'musik' || contact.kind === 'beides') && ich.musik;
  const kannCreator = (contact.kind === 'creator' || contact.kind === 'beides') && ich.creator;
  if (kannMusik && kannCreator) {
    if (requestId === 'feature' || requestId === 'konzert') return 'musik';
    return ich.listeners >= ich.total ? 'musik' : 'creator';
  }
  if (kannMusik) return 'musik';
  if (kannCreator) return 'creator';
  return null;
}

/** Alles, was Chance und Wirkung über dieses Paar wissen müssen. */
function kontextFor(contact, ich, seite) {
  const meine = seite === 'creator'
    ? { language: ich.language, platform: ich.platform }
    : { language: ich.language, genre: ich.genre };
  const seine = seite === 'creator'
    ? { language: contact.language, platform: contact.platform }
    : { language: contact.language, genre: contact.genre };
  const p = passungOf({ meine, seine, seite });

  return {
    ...p,
    meine: seite === 'creator' ? ich.total : ich.listeners,
    seine: seite === 'creator' ? contact.reachCreator : contact.reach,
    sprache: meine.language === seine.language ? 'gleich'
      : (meine.language === 'englisch' || seine.language === 'englisch') ? 'englisch' : 'fremd',
    genre: seite === 'creator'
      ? (meine.platform === seine.platform ? 'gleich' : 'fremd')
      : (meine.genre === seine.genre ? 'gleich'
        : verwandt(meine.genre, seine.genre) ? 'verwandt' : 'fremd'),
  };
}

/**
 * Die Achsen von heute: abgekühlt seit der letzten Bewegung, ohne zu schreiben
 * (§4). Erst die nächste Bewegung schreibt die abgekühlten Werte fort.
 */
function achsenJetzt(row, now) {
  if (!row) return { respekt: 0, vertrauen: 0, boden: 0, draht: 0 };
  const boden = row.boden ?? 0;
  const wochen = row.last_move
    ? Math.floor(Math.max(0, (now - row.last_move) / DAY_MS) / 7)
    : 0;
  const respekt = decayAchse(row.respekt, wochen * data.RESPEKT_DECAY_PRO_WOCHE, 0);
  const vertrauen = decayAchse(row.vertrauen, wochen * data.VERTRAUEN_DECAY_PRO_WOCHE, boden);
  return { respekt, vertrauen, boden, draht: drahtVon(respekt, vertrauen) };
}

/** Nur der Draht davon – was angebote.js, beef.js und die Messung brauchen. */
function drahtJetzt(row, now) {
  return achsenJetzt(row, now).draht;
}

/** Fester Partner, direkt auf einer Zeile. */
function istPartnerRow(row, now) {
  const a = achsenJetzt(row, now);
  return istPartner(a.respekt, a.vertrauen);
}

/** Bis wann dieser Kontakt dicht ist (0 = frei). */
function gesperrtBisOf(row) {
  if (!row) return 0;
  return Math.max(
    row.last_try ? row.last_try + data.SPERRE_TAGE * DAY_MS : 0,
    row.ignored_at ? row.ignored_at + data.SPERRE_IGNORIERT_TAGE * DAY_MS : 0);
}

/**
 * Türöffner: Wer im Umfeld dieses Kontakts – gleiches Land ODER gleiches
 * Genre – schon Partner hat, wird eher durchgestellt. Zwei reichen für den
 * vollen Bonus.
 */
function tuerOeffnerFor(zeilen, contact, now) {
  let anzahl = 0;
  for (const row of zeilen) {
    if (row.contact_id === contact.id) continue;
    const other = data.byId(row.contact_id);
    if (!other) continue;
    const nah = other.country === contact.country
      || (Boolean(other.genre) && other.genre === contact.genre);
    if (nah && istPartnerRow(row, now)) anzahl++;
  }
  return 0.15 * Math.min(1, anzahl / 2);
}

/** Die Antwortchance für genau dieses Paar und diese Anfrageart. */
function chanceFor({ guildId, userId, now, contact, ich, k, requestId, respekt, vertrauen,
  tuerOeffner, partner }) {
  return chanceOf({
    meineReichweite: k.meine, seineReichweite: k.seine, request: requestId,
    gleichesLand: contact.country === ich.country,
    sprache: k.sprache, genre: k.genre,
    respekt, vertrauen, tuerOeffner, hype: ich.hype, trait: contact.trait, partner,
    szene: require('./beef').szeneMalus(guildId, userId, contact, now),
  });
}

/** Passt der Kontakt zum gewählten Filter? */
function passtFilter(contact, ich, filter) {
  if (filter === 'inland') return contact.country === ich.country;
  if (filter === 'sprache') return contact.language === ich.language;
  if (filter === 'international') return contact.country !== ich.country;
  return true;
}

/**
 * Die Liste für die Anzeige. Gezeigt wird nur, wen man überhaupt anschreiben
 * kann – ohne passende Seite gibt es keine sinnvolle Chance.
 * Sortiert: Gesperrte nach hinten, sonst die beste Chance zuerst.
 */
function listFor(guildId, userId, { filter = 'alle', now = Date.now() } = {}) {
  const ich = ichFor(guildId, userId, now);
  const zeilen = db.contactsOf(guildId, userId);
  const nach = new Map(zeilen.map((z) => [z.contact_id, z]));
  // Einmal vor der Schleife, nicht je Kontakt: Die Liste läuft über alle
  // Einträge, und `offenerBeef` wäre je Aufruf eine eigene Abfrage.
  const offene = new Set(require('./beef').offeneBeefs(guildId, userId, now)
    .map((b) => b.contact_id));

  const out = [];
  for (const contact of data.CONTACTS) {
    if (!passtFilter(contact, ich, filter)) continue;
    const seite = seiteFuer(contact, ich);
    if (!seite) continue;

    const row = nach.get(contact.id) ?? null;
    const a = achsenJetzt(row, now);
    const partner = istPartner(a.respekt, a.vertrauen);
    const k = kontextFor(contact, ich, seite);
    const beefOffen = offene.has(contact.id);

    out.push({
      contact, seite,
      respekt: a.respekt, vertrauen: a.vertrauen, boden: a.boden, draht: a.draht,
      art: artOf({ respekt: a.respekt, vertrauen: a.vertrauen, boden: a.boden,
        meine: k.meine, seine: k.seine,
        trait: contact.trait, beefOffen: Boolean(beefOffen) }),
      passung: k.passung,
      chance: chanceFor({ guildId, userId, now, contact, ich, k, requestId: LIST_REQUEST,
        respekt: a.respekt, vertrauen: a.vertrauen,
        tuerOeffner: tuerOeffnerFor(zeilen, contact, now), partner }),
      gesperrtBis: gesperrtBisOf(row),
      tries: row?.tries ?? 0, yes: row?.yes ?? 0, partner,
    });
  }

  return out.sort((a, b) =>
    (a.gesperrtBis > now ? 1 : 0) - (b.gesperrtBis > now ? 1 : 0) || b.chance - a.chance);
}

/** Ein einzelner Kontakt mit allen vier Anfragearten. */
function detail(guildId, userId, contactId, now = Date.now()) {
  const contact = data.byId(contactId);
  if (!contact) return null;

  const ich = ichFor(guildId, userId, now);
  const zeilen = db.contactsOf(guildId, userId);
  const row = zeilen.find((z) => z.contact_id === contact.id) ?? null;
  const a = achsenJetzt(row, now);
  const partner = istPartner(a.respekt, a.vertrauen);
  const tuerOeffner = tuerOeffnerFor(zeilen, contact, now);
  const gesperrtBis = gesperrtBisOf(row);

  const seite = seiteFuer(contact, ich);
  const k = seite ? kontextFor(contact, ich, seite) : null;

  // Solange ein Beef mit ihm offen ist, ist jede Anfrage zwecklos – das wird
  // VOR Draht und Sperre geprüft, weil es der handfestere Grund ist (5b).
  const beefOffen = require('./beef').offenerBeef(guildId, userId, contact.id, now);

  const requests = data.REQUESTS.map((r) => {
    // Die Anfrageart kann eine andere Seite verlangen als die Leitseite.
    const s = seiteFuer(contact, ich, r.id);
    const ks = s === seite ? k : (s ? kontextFor(contact, ich, s) : null);
    const grund = !ks ? 'seite'
      : beefOffen ? 'beef'
        : (r.minDraht != null && a.draht < r.minDraht) ? 'draht'
          : (r.minVertrauen != null && a.vertrauen < r.minVertrauen) ? 'vertrauen'
            : gesperrtBis > now ? 'gesperrt' : null;
    return {
      ...r,
      seite: s,
      chance: ks ? chanceFor({ guildId, userId, now, contact, ich, k: ks, requestId: r.id,
        respekt: a.respekt, vertrauen: a.vertrauen, tuerOeffner, partner }) : 0,
      moeglich: grund === null,
      grund,
    };
  });

  return {
    contact, seite,
    meineReichweite: k ? k.meine : 0,
    seineReichweite: k ? k.seine : (contact.reach || contact.reachCreator || 0),
    passung: k ? k.passung : 0,
    sprachfaktor: k ? k.sprachfaktor : 0,
    genrefaktor: k ? k.genrefaktor : 0,
    respekt: a.respekt, vertrauen: a.vertrauen, boden: a.boden, draht: a.draht,
    art: artOf({ respekt: a.respekt, vertrauen: a.vertrauen, boden: a.boden,
      meine: k ? k.meine : 0, seine: k ? k.seine : 0,
      trait: contact.trait, beefOffen: Boolean(beefOffen) }),
    tries: row?.tries ?? 0, yes: row?.yes ?? 0,
    partner, gesperrtBis, tuerOeffner, requests,
  };
}

/** Der Schub dieser Art, wenn er noch gilt – mit dem Kontakt dahinter. */
function activeBoost(guildId, userId, kind, now = Date.now()) {
  const row = db.getBoost(guildId, userId, kind, now);
  if (!row) return null;
  return {
    kind: row.kind, factor: row.factor, extra: row.extra, until: row.until,
    restMs: Math.max(0, row.until - now),
    contact: data.byId(row.contact_id),
    requestId: row.request_id,
    request: data.REQUESTS.find((r) => r.id === row.request_id) ?? null,
  };
}

/** Dasselbe, aber verbraucht: gelesen, zurückgegeben, gelöscht (genau einmal). */
function consumeBoost(guildId, userId, kind, now = Date.now()) {
  const boost = activeBoost(guildId, userId, kind, now);
  if (boost) db.deleteBoost(guildId, userId, kind);
  return boost;
}

/**
 * Bewegt die Achsen – die einzige Stelle, an der sie jemand von außen
 * schreibt. Das Abkühlen wird vorher faul eingerechnet (§4), damit ein alter
 * Wert nicht konserviert wird. `sperre` setzt zusätzlich `last_try`.
 *
 * `setzeVertrauen` setzt ein Ziel statt zu addieren – das braucht genau eine
 * Stelle, die Versöhnung in beef.js. `merken` schreibt eine Gedächtniszeile,
 * synchron direkt hinter dem Achsen-Schreibvorgang und ohne `await` dazwischen
 * (§7); das Projekt benutzt nirgends `db.transaction`.
 *
 * (`request` unten schreibt seine Zeile weiterhin selbst: Es setzt in
 * DERSELBEN Anweisung auch `yes` und `ignored_at` – ein Beef tut das nie.)
 */
function move(guildId, userId, contactId, bewegung, now = Date.now(), { sperre = false } = {}) {
  const { respekt = 0, vertrauen = 0, boden = 0,
    setzeVertrauen = null, merken = null } = bewegung;
  const zeilen = db.contactsOf(guildId, userId);
  const row = zeilen.find((z) => z.contact_id === contactId) ?? null;
  const vor = achsenJetzt(row, now);

  const bodenNeu = clamp(0, data.BODEN_MAX, vor.boden + boden);
  const respektNeu = clamp(data.ACHSE_MIN, data.ACHSE_MAX, vor.respekt + respekt);
  const rohV = setzeVertrauen === null ? vor.vertrauen + vertrauen : setzeVertrauen;
  // Wer den Boden hebt, hebt das Vertrauen mit – es darf nie unter dem
  // eigenen Boden liegen.
  const vertrauenNeu = clamp(data.ACHSE_MIN, data.ACHSE_MAX,
    boden > 0 ? Math.max(rohV, bodenNeu) : rohV);

  db.saveContact(guildId, userId, contactId, {
    respekt: respektNeu, vertrauen: vertrauenNeu, boden: bodenNeu,
    tries: (row?.tries ?? 0) + (sperre ? 1 : 0),
    yes: row?.yes ?? 0,
    last_try: sperre ? now : (row?.last_try ?? 0),
    last_move: now,
    ignored_at: row?.ignored_at ?? 0,
  });
  if (merken) {
    db.addMemory(guildId, userId, contactId, {
      at: now, art: merken.art, detail: merken.detail ?? '',
      dRespekt: respektNeu - vor.respekt, dVertrauen: vertrauenNeu - vor.vertrauen,
    }, data.MEMORY_MAX);
  }

  return {
    vorher: vor.draht, nachher: drahtVon(respektNeu, vertrauenNeu),
    // Der Kontakt gehört an die Bewegung, nicht an ihre zehn Meldestellen:
    // `buttons.beefDraht` nennt den Namen in seiner Zeile, weil eine
    // Diss-Meldung gleichzeitig ein Anzählen melden kann und dann zwei Zeilen
    // für ZWEI verschiedene Kontakte untereinander stehen. Ohne dieses Feld
    // müssten alle zehn Aufrufstellen den Namen durchreichen. Reines Lesen –
    // geschrieben wird die Beziehung weiter nur in `db.saveContact`.
    contact: data.byId(contactId),
    achsenVor: { respekt: vor.respekt, vertrauen: vor.vertrauen, boden: vor.boden },
    achsen: { respekt: respektNeu, vertrauen: vertrauenNeu, boden: bodenNeu },
  };
}

/**
 * Jemanden anschreiben.
 *
 * Reihenfolge ist hier die halbe Miete: erst prüfen, dann die Zeit buchen,
 * dann würfeln und in EINER Anweisung schreiben (§7). Wer kein Zeitbudget
 * mehr hat, verliert weder Draht noch Sperre.
 */
function request(guildId, userId, contactId, requestId, now = Date.now(), random = Math.random) {
  const contact = data.byId(contactId);
  const r = data.REQUESTS.find((x) => x.id === requestId);
  if (!contact || !r) return { ok: false, reason: 'unknown' };

  const ich = ichFor(guildId, userId, now);
  const seite = seiteFuer(contact, ich, requestId);
  if (!seite) return { ok: false, reason: 'seite', contact, request: r };

  // Solange ein Beef mit ihm offen ist, ist jede Zusammenarbeit zwecklos –
  // derselbe Grund, den `detail` meldet, hier als Riegel gegen einen alten
  // Knopf. Er steht wie dort vor Draht und Sperre und vor der Zeitbuchung.
  if (require('./beef').offenerBeef(guildId, userId, contact.id, now)) {
    return { ok: false, reason: 'beef', contact, request: r };
  }

  const zeilen = db.contactsOf(guildId, userId);
  const row = zeilen.find((z) => z.contact_id === contact.id) ?? null;
  const a = achsenJetzt(row, now);
  const tries = row?.tries ?? 0;
  const yes = row?.yes ?? 0;
  const partner = istPartner(a.respekt, a.vertrauen);

  if (r.minDraht != null && a.draht < r.minDraht) {
    return { ok: false, reason: 'draht', contact, request: r, draht: a.draht, need: r.minDraht };
  }
  if (r.minVertrauen != null && a.vertrauen < r.minVertrauen) {
    return { ok: false, reason: 'vertrauen', contact, request: r,
      vertrauen: a.vertrauen, need: r.minVertrauen };
  }
  const bis = gesperrtBisOf(row);
  if (bis > now) {
    return { ok: false, reason: 'gesperrt', contact, request: r, bis, remainingMs: bis - now };
  }

  // Zwei Stunden kostet der Versuch – auch wenn er nie antwortet. Gebucht
  // wird VOR jedem Schreiben, damit ein abgelehnter Versuch nichts hinterlässt.
  const zeit = require('./creator').useTime(guildId, userId, r.time, now);
  if (!zeit.ok) return { ok: false, ...zeit, contact, request: r, need: r.time };

  const k = kontextFor(contact, ich, seite);
  const tuerOeffner = tuerOeffnerFor(zeilen, contact, now);
  const chance = chanceFor({ guildId, userId, now, contact, ich, k, requestId,
    respekt: a.respekt, vertrauen: a.vertrauen, tuerOeffner, partner });

  // Wurf 1: antwortet er überhaupt? Wurf 2: wie verbindlich?
  const ratio = Math.max(100, k.meine || 0) / Math.max(1, k.seine);
  const antwort = random() < chance
    ? stufeVon(random, { ratio, respekt: a.respekt, vertrauen: a.vertrauen })
    : 'ignoriert';

  // Wer arrogant oder kühl ist, nimmt das Nerven manchmal übel.
  const empfindlich = contact.trait === 'arrogant' || contact.trait === 'kuehl';
  const schluessel = antwort !== 'ignoriert' ? antwort
    : (empfindlich && random() < VERSTIMMT_CHANCE ? 'verstimmt' : 'ignoriert');
  const paar = data.ACHSEN[schluessel];

  const respektNeu = clamp(data.ACHSE_MIN, data.ACHSE_MAX, a.respekt + paar.respekt);
  const vertrauenNeu = clamp(data.ACHSE_MIN, data.ACHSE_MAX, a.vertrauen + paar.vertrauen);
  const drahtNeu = drahtVon(respektNeu, vertrauenNeu);
  const yesNeu = yes + (antwort === 'zusage' ? 1 : 0);

  // EINE Anweisung (§7) – sie setzt auch `yes` und `ignored_at`.
  db.saveContact(guildId, userId, contact.id, {
    respekt: respektNeu, vertrauen: vertrauenNeu, boden: a.boden,
    tries: tries + 1,
    yes: yesNeu,
    last_try: now,
    last_move: now,
    ignored_at: antwort === 'ignoriert' ? now : (row?.ignored_at ?? 0),
  });
  // Nur Zusage und Verstimmung kommen ins Gedächtnis – flüchtig, echt und
  // ignoriert sind häufig und klein, die erzählt `tries − yes`.
  if (schluessel === 'zusage' || schluessel === 'verstimmt') {
    db.addMemory(guildId, userId, contact.id, {
      at: now, art: schluessel, detail: r.name,
      dRespekt: respektNeu - a.respekt, dVertrauen: vertrauenNeu - a.vertrauen,
    }, data.MEMORY_MAX);
  }

  // Was die Antwort wert ist – und was sie anschiebt.
  let staerke = 0;
  let boost = null;
  if (antwort !== 'ignoriert') {
    staerke = staerkeOf({
      seineReichweite: k.seine, meineReichweite: k.meine, passung: k.passung, stufe: antwort });
    const b = boostOf(requestId, staerke, k.seine);
    // Auf der Creator-Seite gibt es keine Bühne: Ein gemeinsames Event schiebt
    // dort die nächste Aktion an, statt Hörer für eine Gage mitzubringen.
    const roh = seite === 'creator' && b.kind === 'show'
      ? { factor: Math.min(4, 1 + 3 * staerke), extra: 1, dauerMs: b.dauerMs }
      : b;
    const kind = seite === 'creator' ? 'creator' : b.kind;
    const gesetzt = db.setBoost(guildId, userId, {
      kind, factor: roh.factor, extra: roh.extra, until: now + roh.dauerMs,
      contactId: contact.id, requestId,
    }, now);
    const zeile = gesetzt.row;
    boost = {
      kind, factor: zeile.factor, extra: zeile.extra, until: zeile.until,
      restMs: Math.max(0, zeile.until - now),
      // Ein stärkerer Schub derselben Art bleibt liegen – gestapelt wird nie.
      // `neu` sagt darum die Wahrheit nur, wenn db.setBoost auch geschrieben hat.
      neu: gesetzt.neu,
    };
  }

  const linien = data.LINES[contact.trait]?.[antwort === 'ignoriert' ? 'nein' : antwort] ?? [];
  const text = linien.length
    ? linien[Math.min(linien.length - 1, Math.floor(random() * linien.length))]
      .replace('{name}', contact.name)
    : '';

  return {
    ok: true, contact, request: r, seite,
    antwort, text, chance, staerke, boost,
    draht: drahtNeu, drahtVor: a.draht, delta: drahtNeu - a.draht,
    achsen: { respekt: respektNeu, vertrauen: vertrauenNeu, boden: a.boden },
    achsenVor: { respekt: a.respekt, vertrauen: a.vertrauen, boden: a.boden },
    art: artOf({ respekt: respektNeu, vertrauen: vertrauenNeu, boden: a.boden,
      meine: k.meine, seine: k.seine, trait: contact.trait, beefOffen: false }),
    tries: tries + 1, yes: yesNeu,
    partner: istPartner(respektNeu, vertrauenNeu),
    partnerNeu: !partner && istPartner(respektNeu, vertrauenNeu),
    gesperrtBis: gesperrtBisOf({ last_try: now, ignored_at: antwort === 'ignoriert' ? now : (row?.ignored_at ?? 0) }),
    zeit,
  };
}

module.exports = {
  passungOf, chanceOf, stufeVon, staerkeOf, boostOf, decay, STUFEN_FAKTOR,
  drahtVon, decayAchse, respektGewicht, respektWirkt, istPartner, artOf,
  VERSTIMMT_CHANCE, seiteFuer, drahtJetzt, achsenJetzt, istPartnerRow, tuerOeffnerFor,
  listFor, detail, request, move, activeBoost, consumeBoost, LIST_REQUEST,
};
