/**
 * Lädt das Fluxer-SDK – oder eben nicht.
 *
 * Der Bot läuft in drei Betriebsarten (`npm start`, `start:fluxer`,
 * `start:duo`). In der reinen Discord-Variante ist das SDK vielleicht gar
 * nicht installiert; ein hartes `require` würde den Start verhindern. Deshalb
 * fragt hier jeder nach, der SDK-Klassen braucht, und kommt mit `null` klar.
 *
 * `@fluxerjs/core` ist die Bibliothek des Projekts, `fluxerjs` bündelt sie –
 * beides wird akzeptiert.
 */

const NAMES = ['@fluxerjs/core', 'fluxerjs'];

let cached;

/** Das SDK-Modul, oder null wenn es nicht installiert ist. */
function sdk() {
  if (cached === undefined) {
    cached = null;
    for (const name of NAMES) {
      try { cached = require(name); break; } catch { /* nächste probieren */ }
    }
  }
  return cached;
}

module.exports = { sdk, NAMES };
