require('dotenv').config();

function required(name) {
  const value = process.env[name];
  if (!value) {
    console.error(`❌ Umgebungsvariable ${name} fehlt. Trage sie in deiner .env ein (siehe .env.example).`);
    process.exit(1);
  }
  return value;
}

module.exports = {
  discordToken: required('DISCORD_TOKEN'),
  clientId: required('DISCORD_CLIENT_ID'),
  unbToken: required('UNB_TOKEN'),
  devGuildId: process.env.DEV_GUILD_ID || null,
  // Währungssymbol nur für die Anzeige in Embeds.
  currency: process.env.CURRENCY_SYMBOL || '🪙',
};
