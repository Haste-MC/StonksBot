const { SlashCommandBuilder } = require('discord.js');
const ui = require('../ui');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('stream')
    .setDescription('Dein Streaming-Kanal: Reichweite aufbauen und live gehen.'),

  async execute(interaction) {
    await interaction.deferReply();
    return interaction.editReply(await ui.buildStreamView({
      guildId: interaction.guildId, userId: interaction.user.id,
    }));
  },
};
