const fs = require('node:fs');
const path = require('node:path');
const { REST, Routes } = require('discord.js');
const { discordToken, clientId, devGuildId } = require('./config');

// Alle Command-Definitionen einsammeln.
const commands = [];
const commandsDir = path.join(__dirname, 'commands');
for (const file of fs.readdirSync(commandsDir).filter((f) => f.endsWith('.js'))) {
  const command = require(path.join(commandsDir, file));
  if (command?.data) commands.push(command.data.toJSON());
}

const rest = new REST().setToken(discordToken);

(async () => {
  try {
    if (devGuildId) {
      // Guild-Commands sind sofort verfügbar – ideal zum Entwickeln.
      await rest.put(Routes.applicationGuildCommands(clientId, devGuildId), { body: commands });
      console.log(`✅ ${commands.length} Commands auf Server ${devGuildId} registriert (sofort aktiv).`);
    } else {
      // Globale Commands können bis zu 1 Stunde brauchen, bis sie überall erscheinen.
      await rest.put(Routes.applicationCommands(clientId), { body: commands });
      console.log(`✅ ${commands.length} globale Commands registriert (bis zu 1h Verzögerung).`);
    }
  } catch (err) {
    console.error('❌ Registrierung fehlgeschlagen:', err);
    process.exit(1);
  }
})();
