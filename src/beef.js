/**
 * ===========================================================================
 *  BEEF – DIE REINEN RECHNUNGEN
 * ===========================================================================
 *
 * Hier steht, was ein Streit mit einem anderen Künstler wert ist – und sonst
 * nichts: kein Discord, kein Zufall außer dem, der hereingereicht wird, und in
 * DIESER ersten Hälfte auch keine Datenbank (die kommt erst beim zweiten
 * Banner dazu). Dadurch lässt sich jede Zahl einzeln nachrechnen und testen.
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
    .replace('{name}', name);
}

module.exports = {
  traitBonus, einstiegOf, wuchtOf, genrefaktorOf, aufmerksamkeitOf, haemeOf,
  hitzeJetzt, rundeNachDiss, rundeNachKonter, ausgangOf, bonusFaktor,
  anzaehlGewicht, textFor,
};
