const { SlashCommandBuilder } = require('discord.js');
const { buildJobCenterView } = require('../ui');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('jobs')
    .setDescription('Öffnet das Arbeitsamt mit den heutigen Stellenangeboten.'),

  async execute(interaction) {
    await interaction.deferReply();

    return interaction.editReply(await buildJobCenterView({
      guildId: interaction.guildId,
      userId: interaction.user.id,
    }));
  },
};
