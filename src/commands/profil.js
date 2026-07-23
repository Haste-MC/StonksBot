const { SlashCommandBuilder } = require('discord.js');
const ui = require('../ui');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('profil')
    .setDescription('Zeigt den Steckbrief eines Spielers: Level, Vermögen, Auto, Immobilie, Beruf.')
    .addUserOption((o) =>
      o.setName('user').setDescription('Wessen Profil? (Standard: du selbst)')),

  async execute(interaction) {
    await interaction.deferReply();
    const target = interaction.options.getUser('user') ?? interaction.user;
    const view = await ui.buildProfileView({
      guildId: interaction.guildId,
      userId: interaction.user.id,
      targetId: target.id,
    });
    return interaction.editReply(view);
  },
};
