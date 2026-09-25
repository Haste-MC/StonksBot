/**
 * ===========================================================================
 *  KONTAKTE – DIE REINEN RECHNUNGEN
 * ===========================================================================
 *
 * Hier steht, was passiert, wenn man jemanden anschreibt – und sonst nichts:
 * keine Datenbank, kein Discord, kein Zufall außer dem, der hereingereicht
 * wird. Dadurch lässt sich jede Zahl einzeln nachrechnen und testen.
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

module.exports = { passungOf, chanceOf, stufeVon, staerkeOf, boostOf, drahtStufe, decay, STUFEN_FAKTOR };
