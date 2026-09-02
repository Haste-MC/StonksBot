const { SlashCommandBuilder } = require('discord.js');
const ui = require('../ui');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('staat')
    .setDescription('Die Staatskasse: der gemeinsame Topf des ganzen Servers.'),

  async execute(interaction) {
    await interaction.deferReply();
    return interaction.editReply(await ui.buildTreasuryView({
      guildId: interaction.guildId, userId: interaction.user.id,
    }));
  },
};
