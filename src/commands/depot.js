const { SlashCommandBuilder } = require('discord.js');
const ui = require('../ui');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('depot')
    .setDescription('Dein Wertpapierdepot: Bestand, Wert und Gewinn.'),

  async execute(interaction) {
    await interaction.deferReply();
    return interaction.editReply(await ui.buildDepotView({
      guildId: interaction.guildId, userId: interaction.user.id,
    }));
  },
};
