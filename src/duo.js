/**
 * ===========================================================================
 *  DUO – beide Bots in einem Prozess
 * ===========================================================================
 *
 * Startet die Discord- und die Fluxer-Version gemeinsam. Beide arbeiten auf
 * derselben Datenbank und derselben Welt, sodass ein verknüpfter Spieler
 * überall denselben Fortschritt hat (siehe identity.js).
 *
 * Gedacht für eine einzelne Hosting-Instanz: ein Startbefehl, ein Prozess,
 * ein Backup. Wer die Bots getrennt betreiben will, nutzt weiterhin
 * `npm start` bzw. `npm run start:fluxer`.
 *
 * Eine Seite darf die andere nicht mitreißen: Fehlt ein Token oder scheitert
 * ein Login, läuft der jeweils andere Bot trotzdem weiter.
 */
const identity = require('./identity');

identity.checkWorld();
console.log(`🌍 Welt: ${identity.world()}`);

let started = 0;

/**
 * Alle Variablen prüfen, die src/config.js verlangt.
 *
 * Wichtig: config.js beendet bei einer fehlenden Variablen den **ganzen
 * Prozess** (process.exit) – das lässt sich nicht per try/catch abfangen und
 * würde die Fluxer-Seite gleich mit umbringen. Deshalb hier vorher prüfen und
 * die Discord-Seite im Zweifel einfach auslassen.
 */
const DISCORD_VARS = ['DISCORD_TOKEN', 'DISCORD_CLIENT_ID', 'UNB_TOKEN'];
const missing = DISCORD_VARS.filter((name) => !process.env[name]);

if (missing.length === 0) {
  try {
    require('./index');
    started++;
  } catch (err) {
    console.error('❌ Discord-Bot konnte nicht starten:', err.message);
  }
} else {
  console.log(`ℹ️  Discord-Seite bleibt aus – es fehlt: ${missing.join(', ')}`);
}

if (process.env.FLUXER_TOKEN) {
  try {
    require('./fluxer/index');
    started++;
  } catch (err) {
    console.error('❌ Fluxer-Bot konnte nicht starten:', err.message);
  }
} else {
  console.log('ℹ️  FLUXER_TOKEN fehlt – Fluxer-Seite bleibt aus.');
}

if (started === 0) {
  console.error('❌ Kein Bot gestartet: Es fehlt jedes Token. Prüfe deine .env.');
  process.exit(1);
}

// Ein Absturz auf einer Seite soll nicht den ganzen Prozess beenden.
process.on('unhandledRejection', (err) => {
  console.error('Unbehandelter Fehler:', err);
});
