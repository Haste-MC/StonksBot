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

if (process.env.DISCORD_TOKEN) {
  try {
    require('./index');
    started++;
  } catch (err) {
    console.error('❌ Discord-Bot konnte nicht starten:', err.message);
  }
} else {
  console.log('ℹ️  DISCORD_TOKEN fehlt – Discord-Seite bleibt aus.');
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
