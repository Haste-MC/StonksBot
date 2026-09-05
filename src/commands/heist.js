const { SlashCommandBuilder } = require('discord.js');
const ui = require('../ui');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('heist')
    .setDescription('Der kriminelle Pfad: planen, vorbereiten, durchziehen.'),

  async execute(interaction) {
    await interaction.deferReply();
    return interaction.editReply(await ui.buildCrimeView({
      guildId: interaction.guildId, userId: interaction.user.id,
    }));
  },
};
