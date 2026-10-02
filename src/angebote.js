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
  return (draht < 50 ? data.GEWICHT_BEKANNT : data.GEWICHT_PARTNER) * passung;
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
  const extra = Math.min(meine, seine * data.VORGRUPPE_ANTEIL);
  return Math.round(showPay * Math.pow(meine + extra, showExp));
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

module.exports = {
  gewichtOf, honorarOf, gageOf, kollaboFaktorOf, fristOf, rollTage, textFor,
};
