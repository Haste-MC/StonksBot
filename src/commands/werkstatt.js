const { SlashCommandBuilder } = require('discord.js');
const ui = require('../ui');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('werkstatt')
    .setDescription('Beschädigte Autos reparieren lassen – Kostenvoranschlag inklusive.')
    .addIntegerOption((o) =>
      o.setName('auto').setDescription('Auto-ID direkt öffnen (siehe /inventory)'))
    .addIntegerOption((o) =>
      o.setName('seite').setDescription('Seite der Liste').setMinValue(1)),

  async execute(interaction) {
    await interaction.deferReply();

    const carId = interaction.options.getInteger('auto');
    const ctx = {
      guildId: interaction.guildId,
      userId: interaction.user.id,
      page: interaction.options.getInteger('seite') ?? 1,
    };

    return interaction.editReply(carId
      ? await ui.buildRepairView({ ...ctx, key: carId })
      : await ui.buildWorkshopView(ctx));
  },
};
