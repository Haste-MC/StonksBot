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
 *   drahtStufe  in welcher Beziehung man steht
 *   decay       wie die Beziehung ohne Kontakt abkühlt
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
  draht = 0, tuerOeffner = 0, hype = 1, trait = 'launisch', partner = false }) {
  const ratio = Math.max(100, meineReichweite || 0) / Math.max(1, seineReichweite);
  const basis = Math.min(data.CHANCE_MAX, 0.6 * Math.sqrt(ratio));
  const r = data.REQUESTS.find((x) => x.id === request);
  const sprachbonus = sprache === 'gleich' ? 0.10 : sprache === 'englisch' ? 0 : -0.15;
  const genrebonus = genre === 'gleich' ? 0.05 : genre === 'verwandt' ? 0 : -0.05;
  return clamp(data.CHANCE_MIN, data.CHANCE_MAX,
    basis + (r?.schwierigkeit ?? 0)
    + (gleichesLand ? 0.05 : 0) + sprachbonus + genrebonus
    + (draht / 100) * 0.25 + clamp(0, 0.15, tuerOeffner)
    + (hype - 1) * 0.1 + (data.TRAIT_BONUS[trait] ?? 0) + (partner ? 0.10 : 0));
}

/** Wie verbindlich die Antwort ausfällt (Wurf 2). */
function stufeVon(random, { ratio, draht = 0 }) {
  const naehe = Math.min(1, ratio);
  const gewichte = {
    fluechtig: 6 * (ratio < 0.05 ? 2 : 1),
    echt: 3,
    zusage: 1 * (1 + 2 * naehe) * (1 + draht / 100),
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

function drahtStufe(draht) {
  if (draht <= data.STUFE_BEEF) return 'beef';
  if (draht <= data.STUFE_VERSTIMMT) return 'verstimmt';
  if (draht >= data.STUFE_PARTNER) return 'partner';
  if (draht >= data.STUFE_BEKANNT) return 'bekannt';
  return 'neutral';
}

/** Abklingen Richtung 0, 2 Punkte je Woche, ohne Überschießen. */
function decay(draht, tage) {
  const ab = Math.floor(Math.max(0, tage) / 7) * data.DRAHT_DECAY_PRO_WOCHE;
  if (draht > 0) return Math.max(0, draht - ab);
  if (draht < 0) return Math.min(0, draht + ab);
  return 0;
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

/** Der Draht von heute: abgekühlt seit der letzten Bewegung, ohne zu schreiben. */
function drahtJetzt(row, now) {
  if (!row) return 0;
  if (!row.last_move) return row.draht;
  return decay(row.draht, (now - row.last_move) / DAY_MS);
}

/** Bis wann dieser Kontakt dicht ist (0 = frei). */
function gesperrtBisOf(row) {
  if (!row) return 0;
  return Math.max(
    row.last_try ? row.last_try + data.SPERRE_TAGE * DAY_MS : 0,
    row.ignored_at ? row.ignored_at + data.SPERRE_IGNORIERT_TAGE * DAY_MS : 0);
}

/** Zählt als fester Partner, wer drei Zusagen hat oder auf Stufe „Partner" steht. */
function istPartner(row, draht) {
  return (row?.yes ?? 0) >= data.PARTNER_YES || draht >= data.STUFE_PARTNER;
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
    if (nah && drahtJetzt(row, now) >= data.STUFE_PARTNER) anzahl++;
  }
  return 0.15 * Math.min(1, anzahl / 2);
}

/** Die Antwortchance für genau dieses Paar und diese Anfrageart. */
function chanceFor({ contact, ich, k, requestId, draht, tuerOeffner, partner }) {
  return chanceOf({
    meineReichweite: k.meine, seineReichweite: k.seine, request: requestId,
    gleichesLand: contact.country === ich.country,
    sprache: k.sprache, genre: k.genre,
    draht, tuerOeffner, hype: ich.hype, trait: contact.trait, partner,
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

  const out = [];
  for (const contact of data.CONTACTS) {
    if (!passtFilter(contact, ich, filter)) continue;
    const seite = seiteFuer(contact, ich);
    if (!seite) continue;

    const row = nach.get(contact.id) ?? null;
    const draht = drahtJetzt(row, now);
    const partner = istPartner(row, draht);
    const k = kontextFor(contact, ich, seite);

    out.push({
      contact, seite, draht, stufe: drahtStufe(draht),
      passung: k.passung,
      chance: chanceFor({ contact, ich, k, requestId: LIST_REQUEST, draht,
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
  const draht = drahtJetzt(row, now);
  const partner = istPartner(row, draht);
  const tuerOeffner = tuerOeffnerFor(zeilen, contact, now);
  const gesperrtBis = gesperrtBisOf(row);

  const seite = seiteFuer(contact, ich);
  const k = seite ? kontextFor(contact, ich, seite) : null;

  const requests = data.REQUESTS.map((r) => {
    // Die Anfrageart kann eine andere Seite verlangen als die Leitseite.
    const s = seiteFuer(contact, ich, r.id);
    const ks = s === seite ? k : (s ? kontextFor(contact, ich, s) : null);
    const grund = !ks ? 'seite'
      : (r.minDraht !== null && draht < r.minDraht) ? 'draht'
        : gesperrtBis > now ? 'gesperrt' : null;
    return {
      ...r,
      seite: s,
      chance: ks ? chanceFor({ contact, ich, k: ks, requestId: r.id, draht, tuerOeffner, partner }) : 0,
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
    draht, stufe: drahtStufe(draht),
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

  const zeilen = db.contactsOf(guildId, userId);
  const row = zeilen.find((z) => z.contact_id === contact.id) ?? null;
  const draht = drahtJetzt(row, now);
  const tries = row?.tries ?? 0;
  const yes = row?.yes ?? 0;
  const partner = istPartner(row, draht);

  if (r.minDraht !== null && draht < r.minDraht) {
    return { ok: false, reason: 'draht', contact, request: r, draht, need: r.minDraht };
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
  const chance = chanceFor({ contact, ich, k, requestId, draht, tuerOeffner, partner });

  // Wurf 1: antwortet er überhaupt? Wurf 2: wie verbindlich?
  const ratio = Math.max(100, k.meine || 0) / Math.max(1, k.seine);
  const antwort = random() < chance ? stufeVon(random, { ratio, draht }) : 'ignoriert';

  let delta;
  if (antwort === 'zusage') delta = data.DRAHT_ZUSAGE;
  else if (antwort === 'echt') delta = data.DRAHT_ECHT;
  else if (antwort === 'fluechtig') delta = data.DRAHT_FLUECHTIG;
  else {
    // Wer arrogant oder kühl ist, nimmt das Nerven manchmal übel.
    const empfindlich = contact.trait === 'arrogant' || contact.trait === 'kuehl';
    delta = empfindlich && random() < VERSTIMMT_CHANCE
      ? data.DRAHT_VERSTIMMT : data.DRAHT_IGNORIERT;
  }
  const neu = clamp(-100, 100, draht + delta);
  const yesNeu = yes + (antwort === 'zusage' ? 1 : 0);

  db.saveContact(guildId, userId, contact.id, {
    draht: neu,
    tries: tries + 1,
    yes: yesNeu,
    last_try: now,
    last_move: now,
    ignored_at: antwort === 'ignoriert' ? now : (row?.ignored_at ?? 0),
  });

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
    draht: neu, drahtVor: draht, delta, stufe: drahtStufe(neu),
    tries: tries + 1, yes: yesNeu,
    partner: istPartner({ yes: yesNeu }, neu),
    partnerNeu: !partner && istPartner({ yes: yesNeu }, neu),
    gesperrtBis: gesperrtBisOf({ last_try: now, ignored_at: antwort === 'ignoriert' ? now : (row?.ignored_at ?? 0) }),
    zeit,
  };
}

module.exports = {
  passungOf, chanceOf, stufeVon, staerkeOf, boostOf, drahtStufe, decay, STUFEN_FAKTOR,
  VERSTIMMT_CHANCE, seiteFuer, drahtJetzt, tuerOeffnerFor,
  listFor, detail, request, activeBoost, consumeBoost, LIST_REQUEST,
};
