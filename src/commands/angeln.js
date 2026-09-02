const { SlashCommandBuilder } = require('discord.js');
const ui = require('../ui');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('angeln')
    .setDescription('Mit der Angelausrüstung angeln gehen – jeder Zug bringt etwas anderes.'),

  async execute(interaction) {
    await interaction.deferReply();
    return interaction.editReply(await ui.buildFishingView({
      guildId: interaction.guildId, userId: interaction.user.id,
    }));
  },
};
