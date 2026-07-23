const { SlashCommandBuilder } = require('discord.js');
const ui = require('../ui');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('leaderboard')
    .setDescription('Rangliste des Servers – Level, Einnahmen, Ausgaben & Networth.'),

  async execute(interaction) {
    await interaction.deferReply();
    const view = await ui.buildLeaderboardView({
      guildId: interaction.guildId,
      userId: interaction.user.id,
    });
    return interaction.editReply(view);
  },
};
