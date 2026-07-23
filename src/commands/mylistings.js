const { SlashCommandBuilder } = require('discord.js');
const { buildListingsView } = require('../ui');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('mylistings')
    .setDescription('Zeigt deine Inserate im Gebrauchtmarkt.'),

  async execute(interaction) {
    await interaction.deferReply();

    return interaction.editReply(await buildListingsView({
      guildId: interaction.guildId,
      userId: interaction.user.id,
    }));
  },
};
