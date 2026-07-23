const { SlashCommandBuilder, PermissionFlagsBits } = require('discord.js');
const { buildEntryView } = require('../menu');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('shop')
    .setDescription('Öffnet das Autohaus – Neu- und Gebrauchtwagen.')
    .addStringOption((o) =>
      o.setName('bereich').setDescription('Womit anfangen?')
        .addChoices(
          { name: 'Neuwagen', value: 'new' },
          { name: 'Gebrauchtwagen', value: 'used' },
        )),

  async execute(interaction) {
    await interaction.deferReply();

    return interaction.editReply(await buildEntryView(
      interaction.options.getString('bereich') ?? 'new',
      {
        guildId: interaction.guildId,
        userId: interaction.user.id,
        isAdmin: interaction.memberPermissions?.has(PermissionFlagsBits.ManageGuild) ?? false,
        page: 1,
      },
    ));
  },
};
