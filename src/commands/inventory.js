const { SlashCommandBuilder } = require('discord.js');
const { buildGarageView } = require('../ui');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('inventory')
    .setDescription('Zeigt die Garage von dir oder jemand anderem.')
    .addUserOption((o) =>
      o.setName('user').setDescription('Wessen Garage? (Standard: du selbst)'))
    .addIntegerOption((o) =>
      o.setName('seite').setDescription('Seite der Garage').setMinValue(1)),

  async execute(interaction) {
    await interaction.deferReply();
    const target = interaction.options.getUser('user');

    return interaction.editReply(await buildGarageView({
      guildId: interaction.guildId,
      userId: interaction.user.id,
      targetId: target?.id ?? null,
      page: interaction.options.getInteger('seite') ?? 1,
    }));
  },
};
