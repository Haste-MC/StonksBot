const fs = require('node:fs');
const path = require('node:path');
const { Client, Collection, GatewayIntentBits, MessageFlags } = require('discord.js');
const { discordToken } = require('./config');
const { buttons, modals, parseId } = require('./buttons');
const nudges = require('./nudges');
const bridge = require('./bridge');

// Nachrichten mitlesen (für die !work-Nudges) nur, wenn das Feature an ist –
// sonst würde der Bot das privilegierte Message-Content-Intent anfordern und
// ohne Freischaltung im Developer Portal gar nicht erst starten.
const intents = [GatewayIntentBits.Guilds];
if (nudges.enabled) {
  intents.push(GatewayIntentBits.GuildMessages, GatewayIntentBits.MessageContent);
}

const client = new Client({ intents });

// Alle Commands aus src/commands laden.
client.commands = new Collection();
const commandsDir = path.join(__dirname, 'commands');
for (const file of fs.readdirSync(commandsDir).filter((f) => f.endsWith('.js'))) {
  const command = require(path.join(commandsDir, file));
  if (command?.data && command?.execute) {
    client.commands.set(command.data.name, command);
  } else {
    console.warn(`⚠️  ${file} hat kein data/execute und wird übersprungen.`);
  }
}

client.once('clientReady', (c) => {
  console.log(`✅ Eingeloggt als ${c.user.tag} – ${client.commands.size} Commands geladen.`);
  if (nudges.enabled) console.log('📣 Nudges aktiv (reagieren auf !work & Co.).');
});

// Werbe-Nudges bei UnbelievaBoat-Einkommensbefehlen (nur wenn aktiviert).
if (nudges.enabled) {
  client.on('messageCreate', (message) => {
    nudges.handleMessage(message).catch(() => {});
  });
}

client.on('interactionCreate', async (rawInteraction) => {
  // Ab hier arbeitet alles mit Welt und Konto statt mit Server und Discord-ID
  // – das ist die Grundlage der Cross-Progression (siehe bridge.js).
  const interaction = bridge.wrap(rawInteraction, 'discord');

  if (interaction.isButton()) return handleButton(interaction);
  if (interaction.isModalSubmit()) return handleModal(interaction);
  if (!interaction.isChatInputCommand()) return;

  const command = client.commands.get(interaction.commandName);
  if (!command) return;

  try {
    await command.execute(interaction);
  } catch (err) {
    console.error(`Fehler in /${interaction.commandName}:`, err);
    const msg = { content: '❌ Da ist etwas schiefgelaufen.', flags: MessageFlags.Ephemeral };
    if (interaction.deferred || interaction.replied) {
      await interaction.followUp(msg).catch(() => {});
    } else {
      await interaction.reply(msg).catch(() => {});
    }
  }
});

async function handleButton(interaction) {
  if (interaction.customId === 'noop') return interaction.deferUpdate();

  const { action, parts } = parseId(interaction.customId);
  // Letzter Teil ist immer die ID dessen, der den Befehl ausgelöst hat.
  const ownerId = parts[parts.length - 1];

  if (ownerId !== interaction.user.id) {
    return interaction.reply({
      content: '❌ Das ist nicht dein Menü – ruf `/shop` selbst auf.',
      flags: MessageFlags.Ephemeral,
    });
  }

  try {
    await buttons[action]?.(interaction, parts);
  } catch (err) {
    console.error(`Fehler bei Button "${interaction.customId}":`, err);
    const msg = { content: '❌ Da ist etwas schiefgelaufen.', flags: MessageFlags.Ephemeral };
    if (interaction.deferred || interaction.replied) {
      await interaction.followUp(msg).catch(() => {});
    } else {
      await interaction.reply(msg).catch(() => {});
    }
  }
}

async function handleModal(interaction) {
  const { action, parts } = parseId(interaction.customId);
  const ownerId = parts[parts.length - 1];
  if (ownerId !== interaction.user.id) {
    return interaction.reply({
      content: '❌ Das ist nicht dein Formular.', flags: MessageFlags.Ephemeral,
    });
  }
  try {
    await modals[action]?.(interaction, parts);
  } catch (err) {
    console.error(`Fehler bei Modal "${interaction.customId}":`, err);
    if (!interaction.replied && !interaction.deferred) {
      await interaction.reply({
        content: '❌ Da ist etwas schiefgelaufen.', flags: MessageFlags.Ephemeral,
      }).catch(() => {});
    }
  }
}

client.login(discordToken);
