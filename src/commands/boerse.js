const { SlashCommandBuilder } = require('discord.js');
const ui = require('../ui');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('boerse')
    .setDescription('Die Börse: Aktien, Fonds-Anteile und Krypto handeln.')
    .addStringOption((o) =>
      o.setName('wert').setDescription('Kürzel eines Wertes, z.B. HAST oder RUBI'))
    .addStringOption((o) =>
      o.setName('art').setDescription('Nur eine Anlageklasse zeigen')
        .addChoices(
          { name: 'Aktien', value: 'stock' },
          { name: 'Fonds', value: 'fund' },
          { name: 'Krypto', value: 'crypto' },
        )),

  async execute(interaction) {
    await interaction.deferReply();
    const ctx = { guildId: interaction.guildId, userId: interaction.user.id };
    const wanted = interaction.options.getString('wert');

    return interaction.editReply(wanted
      ? await ui.buildAssetView({ ...ctx, symbol: wanted.toUpperCase() })
      : await ui.buildMarketView({ ...ctx, kind: interaction.options.getString('art') }));
  },
};
