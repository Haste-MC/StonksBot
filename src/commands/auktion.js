const { SlashCommandBuilder } = require('discord.js');
const ui = require('../ui');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('auktion')
    .setDescription('Storage Wars – ersteigere verschlossene Garagen und finde Wertobjekte.'),

  async execute(interaction) {
    await interaction.deferReply();
    return interaction.editReply(await ui.buildAuctionView({
      guildId: interaction.guildId,
      userId: interaction.user.id,
    }));
  },
};
