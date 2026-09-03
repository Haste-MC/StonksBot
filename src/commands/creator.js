const { SlashCommandBuilder } = require('discord.js');
const ui = require('../ui');
const creator = require('../creator');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('creator')
    .setDescription('Dein Netzwerk: Twitch, YouTube, Instagram und Twitter.')
    .addStringOption((o) =>
      o.setName('plattform').setDescription('Direkt zu einer Plattform')
        .addChoices(...creator.PLATFORMS.map((p) => ({ name: p.name, value: p.id })))),

  async execute(interaction) {
    await interaction.deferReply();
    const ctx = { guildId: interaction.guildId, userId: interaction.user.id };

    // Beim Öffnen läuft die Katalog-Abrechnung mit (§4).
    await creator.settle(ctx.guildId, ctx.userId).catch(() => null);

    const key = interaction.options.getString('plattform');
    return interaction.editReply(key
      ? await ui.buildPlatformView({ ...ctx, key })
      : await ui.buildCreatorView(ctx));
  },
};
