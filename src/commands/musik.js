const { SlashCommandBuilder, MessageFlags } = require('discord.js');
const ui = require('../ui');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('musik')
    .setDescription('Deine Musikkarriere: Songs, Releases, Konzerte, Tantiemen.'),

  async execute(interaction) {
    await interaction.deferReply();
    const ctx = { guildId: interaction.guildId, userId: interaction.user.id };

    // Beim Öffnen laufen Tantiemen, Vertragsfristen und der Verfall offener
    // Vorfälle mit (§4) – dieselbe Abrechnung wie über den Knopf.
    const note = await require('../buttons').settleMusic(ctx.guildId, ctx.userId);

    await interaction.editReply(await ui.buildMusicView(ctx));
    if (note) {
      await interaction.followUp({ content: note, flags: MessageFlags.Ephemeral }).catch(() => {});
    }
  },
};
