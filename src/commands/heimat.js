const { SlashCommandBuilder } = require('discord.js');
const ui = require('../ui');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('heimat')
    .setDescription('Wohnsitz und Inhaltssprache: für welchen Markt du produzierst.'),

  async execute(interaction) {
    await interaction.deferReply();
    return interaction.editReply(await ui.buildHomeView({
      guildId: interaction.guildId, userId: interaction.user.id,
    }));
  },
};
