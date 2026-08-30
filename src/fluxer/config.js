require('dotenv').config();

/**
 * Konfiguration des Fluxer-Bots. Bewusst getrennt von src/config.js, das
 * Discord-Tokens verlangt – die gibt es hier nicht.
 */
function required(name) {
  const value = process.env[name];
  if (!value) {
    console.error(`❌ Umgebungsvariable ${name} fehlt. Trage sie in deiner .env ein.`);
    process.exit(1);
  }
  return value;
}

module.exports = {
  token: required('FLUXER_TOKEN'),
  prefix: process.env.FLUXER_PREFIX || '!',
  currency: process.env.CURRENCY_SYMBOL || '🪙',
};
