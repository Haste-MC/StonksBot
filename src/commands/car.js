const { SlashCommandBuilder } = require('discord.js');
const { buildDetailView } = require('../ui');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('car')
    .setDescription('Zeigt ein Auto aus dem Autohaus mit Foto und Daten.')
    .addIntegerOption((o) =>
      o.setName('auto').setDescription('Die Auto-ID (siehe /shop)').setRequired(true)),

  async execute(interaction) {
    await interaction.deferReply();

    const view = await buildDetailView({
      guildId: interaction.guildId,
      mode: 'new',
      key: interaction.options.getInteger('auto'),
      page: 1,
      userId: interaction.user.id,
    });

    return interaction.editReply(view);
  },
};
