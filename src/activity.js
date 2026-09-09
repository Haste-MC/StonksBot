const db = require('./db');

/**
 * ===========================================================================
 *  TITEL – was du am häufigsten tust, steht über deinem Profil
 * ===========================================================================
 *
 * Jede Aktivität, die Geld bewegt, wird mitgezählt (`player_activity`). Aus
 * dieser Strichliste entsteht ein Titel: Wer ständig Dinger dreht, ist ein
 * **Ganove**; wer am Wasser sitzt, ein **Angler**.
 *
 * Warum die HÄUFIGKEIT und nicht der Verdienst?
 * Weil Verdienste über die Spielarten hinweg nicht vergleichbar sind: Ein
 * Aktienverkauf bucht den kompletten Erlös (der zum größten Teil das eigene
 * Geld von vorhin ist), eine Schicht nur den Lohn, ein Casino-Abend eine
 * Netto-Differenz. Ein Ranking daraus wäre keine Erfolgsliste, sondern eine
 * Liste der Aktivitäten mit den größten Zahlen. Die Zahl der Male dagegen
 * bedeutet überall dasselbe: **das hier machst du ständig.**
 *
 * Gezählt wird zentral in `unb.changeCash` – jede Buchung, die ein `kind`
 * mitbringt (ARCHITEKTUR §9: eine Buchung je Aktion, also ein Strich je
 * Aktion). Buchungen ohne `kind` (Käufe, Rechnungen, Storno) zählen nicht.
 *
 * Drei Stufen je Aktivität, damit der Titel mitwächst statt sofort fertig zu
 * sein. Der Spieler kann jederzeit selbst wählen – aber nur aus dem, was er
 * auch wirklich gemacht hat (`unlocked`).
 */

/** Ab wie vielen Malen die zweite und dritte Stufe greifen. */
const TIERS = [0, 25, 100];

/**
 * Die Aktivitäten. `titles` sind die drei Stufen (siehe TIERS).
 * Eine neue Aktivität = ein Eintrag hier plus ein `kind` an ihrer Buchung.
 */
const KINDS = [
  { id: 'job', emoji: '💼', label: 'Schichten', titles: ['Aushilfe', 'Malocher', 'Arbeitstier'] },
  { id: 'fishing', emoji: '🎣', label: 'Angeln', titles: ['Sonntagsangler', 'Angler', 'Fischerkönig'] },
  { id: 'creator', emoji: '📡', label: 'Creator', titles: ['Hobby-Creator', 'Content-Creator', 'Internet-Größe'] },
  { id: 'music', emoji: '🎵', label: 'Musik', titles: ['Straßenmusiker', 'Musiker', 'Bühnenlegende'] },
  { id: 'heist', emoji: '🕵️', label: 'Heists', titles: ['Kleinkrimineller', 'Ganove', 'Meisterdieb'] },
  { id: 'rob', emoji: '🎭', label: 'Überfälle', titles: ['Taschendieb', 'Straßenräuber', 'Schrecken der Straße'] },
  { id: 'casino', emoji: '🎰', label: 'Casino', titles: ['Gelegenheitsspieler', 'Zocker', 'Hochroller'] },
  { id: 'market', emoji: '📈', label: 'Börse', titles: ['Kleinanleger', 'Börsianer', 'Börsenhai'] },
  { id: 'landlord', emoji: '🏠', label: 'Vermieten', titles: ['Zimmerwirt', 'Vermieter', 'Immobilienmogul'] },
  { id: 'auction', emoji: '🏬', label: 'Auktionen', titles: ['Schnäppchenjäger', 'Trödelprofi', 'Schatzmeister'] },
  { id: 'cars', emoji: '🚗', label: 'Autohandel', titles: ['Schrauber', 'Gebrauchtwagenhändler', 'Autobaron'] },
  { id: 'daily', emoji: '☀️', label: 'Tagesbonus', titles: ['Frühaufsteher', 'Stammgast', 'Uhrwerk'] },
];

const byId = new Map(KINDS.map((k) => [k.id, k]));

/** Kennt das Spiel diese Aktivität? */
function kind(id) {
  return byId.get(String(id ?? '')) ?? null;
}

/** Zählt eine Aktivität mit. Unbekannte Kennungen werden still ignoriert. */
function record(guildId, userId, id, at = Date.now()) {
  if (!byId.has(String(id ?? ''))) return false;
  // Erst den Bestand übernehmen, dann den neuen Strich: Sonst wäre die Liste
  // nach der ersten Aktion nicht mehr leer und der Nachtrag käme nie.
  backfill(guildId, userId, at);

  // Der Andockpunkt für Erfolge sitzt HIER und nicht an der Geldbuchung
  // (unb.changeCash): Überfall, Vermieten und Casino zählen bewusst OHNE
  // `kind` (robbery.js, tenants.js, casinoPlay.js) – über den Buchungspfad
  // liefe für sie also nie ein Erfolg mit. `record` ist dagegen der einzige
  // Ort, den jede Aktivität durchläuft, auch die Buchung selbst
  // (unb.countActivity ruft es auf). Fire-and-forget und in try/catch: ein
  // Erfolg darf niemals eine Strichliste zum Kippen bringen.
  //
  // A2-Fix: `require('./achievements')` und die Marker-Abfrage liefen bisher
  // UNGESCHÜTZT vor diesem try/catch. Wirft eine der beiden (ein kaputtes
  // Erfolge-Modul, eine kaputte Datenbankabfrage), wirft `record` selbst –
  // und `record` hängt an SIEBEN ungeschützten Stellen: robbery.js ruft es
  // NACH dem Geldtransfer eines Überfalls, creator.js VOR der Auszahlung
  // einer Aktion, dazu music.js, casinoPlay.js, tenants.js. Ein Wurf hier
  // würde also einen Überfall kippen, NACHDEM das Geld schon verschoben ist,
  // oder eine Auszahlung verhindern, BEVOR sie überhaupt versucht wurde.
  // Deshalb im Fehlerfall den Zweig nehmen, der ZUERST hochzählt (unten):
  // Die Strichliste ist Spielzustand, der Erfolg nur Schmuck – sie hat
  // Vorrang vor jeder Erfolgs-Prüfung.
  let achievements = null;
  let nochNichtNachgetragen = false;
  try {
    achievements = require('./achievements');
    // Die REIHENFOLGE zu `bumpActivity` hängt vom Erfolge-Nachtrag ab, und
    // genau DAS ist der Grund für die Fallunterscheidung hier:
    //
    //   - Konto noch nie nachgetragen: `onActivity` stößt selbst den stillen
    //     Nachtrag an, und der baut seinen Zusammenhang synchron BEIM AUFRUF
    //     (siehe achievements.backfillCtx) – noch bevor `onActivity` bei
    //     seinem eigenen `await backfill(...)` pausiert. Läuft `onActivity`
    //     danach erst nach `bumpActivity`, hielte der Nachtrag den gerade
    //     erst gezählten Strich für Vorgeschichte und würde z.B. "Erster
    //     Arbeitstag" lautlos vergeben statt mit Postfach-Eintrag – also VOR
    //     `bumpActivity` auslösen.
    //   - Konto schon nachgetragen (der Normalfall): `onActivity` überspringt
    //     seinen eigenen Nachtrag (Marker vorhanden) und läuft bis zu seinem
    //     `check()` komplett synchron durch (§7) – OHNE ein dazwischenliegendes
    //     `bumpActivity` sähe dieses `check()` den ALTEN Stand und würde die
    //     gerade erst erreichte Schwelle verpassen – also NACH `bumpActivity`
    //     auslösen, wie vor diesem Fix.
    nochNichtNachgetragen = !db.getClaim(guildId, userId, 'ach_backfill');
  } catch { /* Strichliste hat Vorrang – siehe Kommentar oben */ }

  // `record` bleibt dabei in jedem Fall synchron und gibt sofort zurück;
  // der eigentliche Nachtrag (falls nötig) läuft asynchron im Hintergrund
  // weiter, unabhängig davon, wann diese Funktion zurückkehrt.
  if (achievements && nochNichtNachgetragen) {
    try { achievements.onActivity(guildId, userId, id, at).catch(() => {}); }
    catch { /* dito */ }
    db.bumpActivity(guildId, userId, String(id), at);
  } else {
    db.bumpActivity(guildId, userId, String(id), at);
    if (achievements) {
      try { achievements.onActivity(guildId, userId, id, at).catch(() => {}); }
      catch { /* dito */ }
    }
  }

  return true;
}

/** Welche Stufe passt zu dieser Anzahl? (0–2) */
function tierOf(count = 0) {
  let tier = 0;
  for (let i = 0; i < TIERS.length; i++) if (count > TIERS[i]) tier = i;
  return tier;
}

/** Der Titel einer Aktivität bei dieser Anzahl. */
function titleFor(id, count = 1) {
  const k = kind(id);
  if (!k || count <= 0) return null;
  const tier = tierOf(count);
  return { id: k.id, emoji: k.emoji, label: k.label, count, tier, title: k.titles[tier] };
}

/**
 * Einmaliger Nachtrag für Bestandsspieler.
 *
 * Die Strichliste beginnt bei null – wer vorher 56 Schichten geschoben hat,
 * stünde ohne Titel da, bis er wieder arbeitet. Ein paar Zähler gibt es aber
 * schon länger, und die werden hier einmalig übernommen: Schichten, Heists,
 * Creator-Aktionen, Musik (Songs, Releases, Konzerte) und Fundstücke.
 *
 * Nur, solange die Liste **leer** ist – sobald ein einziger Strich drinsteht,
 * fasst der Nachtrag nichts mehr an und überschreibt nichts. Faul wie alles
 * andere (§4): Er läuft beim ersten Blick aufs Profil, nicht in einem Job.
 *
 * @returns {number} wie viele Aktivitäten nachgetragen wurden
 */
function backfill(guildId, userId, now = Date.now()) {
  if (db.activityOf(guildId, userId).length > 0) return 0;

  const job = db.getEmployment(guildId, userId)?.shifts ?? 0;
  const crime = db.peekCriminal(guildId, userId)?.heists ?? 0;
  const creator = db.allCreator(guildId, userId)
    .reduce((sum, row) => sum + (row.actions ?? 0), 0);
  const artist = db.hasArtist(guildId, userId)
    ? db.getArtist(guildId, userId, now) : null;
  const music = artist ? (artist.songs ?? 0) + (artist.releases ?? 0) + (artist.shows ?? 0) : 0;
  const auction = db.lootSummary(guildId, userId).n ?? 0;

  let added = 0;
  for (const [id, count] of [
    ['job', job], ['heist', crime], ['creator', creator],
    ['music', music], ['auction', auction],
  ]) {
    if (count > 0) { db.setActivity(guildId, userId, id, count, now); added++; }
  }
  return added;
}

/**
 * Alle Titel, die dieser Spieler tragen darf – häufigste Aktivität zuerst.
 * Wer etwas nie gemacht hat, kann den Titel auch nicht wählen.
 */
function unlocked(guildId, userId) {
  backfill(guildId, userId);
  return db.activityOf(guildId, userId)
    .map((row) => titleFor(row.kind, row.count))
    .filter(Boolean);
}

/**
 * Der Titel, der im Profil steht.
 *
 * Reihenfolge: eigene Wahl schlägt Automatik, 'none' heißt „keiner", und ohne
 * Wahl gewinnt die häufigste Aktivität. Wer noch gar nichts gemacht hat,
 * bekommt keinen Titel – das ist kein Fehler, sondern der Anfang.
 *
 * Ein Wunsch mit dem Präfix `ach:` kommt aus den Erfolgen (achievements.js).
 * Die beiden Listen kennen einander nicht; das Präfix ist die ganze
 * Schnittstelle – so bleibt es EIN Titelsystem statt zwei.
 *
 * @returns {{id,emoji,title,count,tier,chosen:boolean}|null}
 */
function titleOf(guildId, userId) {
  const wish = String(db.getStats(guildId, userId).title ?? '');
  if (wish === 'none') return null;

  if (wish.startsWith('ach:')) {
    const eigene = require('./achievements').titlesFor(guildId, userId);
    const treffer = eigene.find((t) => t.id === wish);
    // Kein Treffer heißt: Der Erfolg ist (noch) nicht verdient. Nicht
    // schummeln – dann greift unten die Automatik.
    if (treffer) {
      return { id: treffer.id, emoji: treffer.emoji, title: treffer.title,
        count: 0, tier: 0, chosen: true };
    }
  }

  const list = unlocked(guildId, userId);
  if (wish) {
    const own = list.find((t) => t.id === wish);
    if (own) return { ...own, chosen: true };
    // Titel gewählt, Aktivität aber (noch) nicht gemacht: nicht schummeln.
  }
  return list.length ? { ...list[0], chosen: false } : null;
}

/** Setzt den Wunsch: eine Kennung, '' für automatisch, 'none' für keinen. */
function choose(guildId, userId, wish) {
  const value = String(wish ?? '');

  if (value.startsWith('ach:')) {
    // Nur verdiente Erfolgstitel – sonst könnte man sich "Origin" anheften.
    const eigene = require('./achievements').titlesFor(guildId, userId);
    if (!eigene.some((t) => t.id === value)) return false;
    db.setTitle(guildId, userId, value);
    return true;
  }

  if (value && value !== 'none' && !byId.has(value)) return false;
  db.setTitle(guildId, userId, value);
  return true;
}

module.exports = {
  TIERS, KINDS, kind, record, tierOf, titleFor, backfill, unlocked, titleOf, choose,
};
