const { SlashCommandBuilder, PermissionFlagsBits } = require('discord.js');
const { buildMainMenu } = require('../menu');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('menu')
    .setDescription('Öffnet das Hauptmenü – von hier kommst du überall hin.'),

  async execute(interaction) {
    await interaction.deferReply();

    return interaction.editReply(buildMainMenu({
      userId: interaction.user.id,
      isAdmin: interaction.memberPermissions?.has(PermissionFlagsBits.ManageGuild) ?? false,
    }));
  },
};
