const { SlashCommandBuilder, MessageFlags } = require('discord.js');
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

    // Beim Öffnen laufen Katalog, Merch, Vertragsfristen, der Verfall offener
    // Vorfälle und der Tageswurf mit (§4) – dieselbe Abrechnung wie über die
    // Knöpfe, damit der Wurf an jeder Tür fällt und nicht nur an einigen.
    const note = await require('../buttons').settleCreator(ctx.guildId, ctx.userId);

    const key = interaction.options.getString('plattform');
    await interaction.editReply(key
      ? await ui.buildPlatformView({ ...ctx, key })
      : await ui.buildCreatorView(ctx));
    if (note) {
      await interaction.followUp({ content: note, flags: MessageFlags.Ephemeral }).catch(() => {});
    }
  },
};
