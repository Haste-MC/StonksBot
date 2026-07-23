const { SlashCommandBuilder } = require('discord.js');
const { buildPropertyShopView, buildEstateView } = require('../ui');
const { settle } = require('../buttons');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('property')
    .setDescription('Immobilienmarkt: Wohnungen, Häuser und Villen.')
    .addStringOption((o) =>
      o.setName('ansicht').setDescription('Was möchtest du sehen?')
        .addChoices(
          { name: 'Markt', value: 'market' },
          { name: 'Mein Besitz', value: 'mine' },
        )),

  async execute(interaction) {
    await interaction.deferReply();

    // Fällige Miete abrechnen, bevor Stellplätze angezeigt werden.
    const notice = await settle(interaction);

    const ctx = { guildId: interaction.guildId, userId: interaction.user.id, page: 1 };
    const view = interaction.options.getString('ansicht') === 'mine'
      ? await buildEstateView(ctx)
      : await buildPropertyShopView(ctx);

    if (notice) view.content = notice;
    return interaction.editReply(view);
  },
};
