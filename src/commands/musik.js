const { SlashCommandBuilder } = require('discord.js');
const ui = require('../ui');
const music = require('../music');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('musik')
    .setDescription('Deine Musikkarriere: Songs, Releases, Konzerte, Tantiemen.'),

  async execute(interaction) {
    await interaction.deferReply();
    const ctx = { guildId: interaction.guildId, userId: interaction.user.id };

    // Beim Öffnen laufen Tantiemen und Vertragsfristen mit (§4).
    await music.settle(ctx.guildId, ctx.userId).catch(() => null);
    music.settleContracts(ctx.guildId, ctx.userId);

    return interaction.editReply(await ui.buildMusicView(ctx));
  },
};
