const fs = require('node:fs');
const path = require('node:path');
const { Client, Collection, GatewayIntentBits, MessageFlags } = require('discord.js');
const { discordToken } = require('./config');
const { buttons, modals, parseId } = require('./buttons');
const nudges = require('./nudges');
const bridge = require('./bridge');
const relay = require('./relay');

// Nachrichten mitlesen braucht das privilegierte Message-Content-Intent.
// Nur anfordern, wenn eines der Features es wirklich benötigt – ohne
// Freischaltung im Developer Portal würde der Bot sonst gar nicht starten.
const needsMessages = nudges.enabled || relay.enabled;
const intents = [GatewayIntentBits.Guilds];
if (needsMessages) {
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
  relay.register('discord', client);
  if (relay.enabled) console.log('🔗 Kanal-Brücke: Discord-Seite bereit.');
});

// Nachrichten im Kanal: Werbe-Nudges und die Brücke nach Fluxer.
if (needsMessages) {
  client.on('messageCreate', (message) => {
    if (nudges.enabled) nudges.handleMessage(message).catch(() => {});
    relay.fromDiscord(message).catch((err) =>
      console.error('Brücke Discord→Fluxer:', err.message));
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
