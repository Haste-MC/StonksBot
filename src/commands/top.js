const { SlashCommandBuilder } = require('discord.js');
const ui = require('../ui');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('top')
    .setDescription('Die reichsten Spieler – Geld-Rangliste.')
    .addStringOption((o) =>
      o.setName('sortierung').setDescription('Wonach ranken?')
        .addChoices(
          { name: 'Gesamtvermögen', value: 'total' },
          { name: 'Bargeld', value: 'cash' },
          { name: 'Bank', value: 'bank' },
        )),

  async execute(interaction) {
    await interaction.deferReply();
    return interaction.editReply(await ui.buildTopView({
      guildId: interaction.guildId,
      userId: interaction.user.id,
      sort: interaction.options.getString('sortierung') ?? 'total',
    }));
  },
};
