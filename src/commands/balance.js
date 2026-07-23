const { SlashCommandBuilder } = require('discord.js');
const { buildBalanceView } = require('../ui');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('balance')
    .setDescription('Zeigt das UnbelievaBoat-Guthaben an.')
    .addUserOption((o) =>
      o.setName('user').setDescription('Wessen Guthaben? (Standard: du selbst)')),

  async execute(interaction) {
    await interaction.deferReply();
    const target = interaction.options.getUser('user');

    return interaction.editReply(await buildBalanceView({
      guildId: interaction.guildId,
      userId: interaction.user.id,
      targetId: target?.id ?? null,
    }));
  },
};
