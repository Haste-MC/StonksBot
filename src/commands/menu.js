const { SlashCommandBuilder, PermissionFlagsBits, MessageFlags } = require('discord.js');
const { buildMainMenu } = require('../menu');
const patchnotes = require('../patchnotes');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('menu')
    .setDescription('Öffnet das Hauptmenü – von hier kommst du überall hin.'),

  async execute(interaction) {
    await interaction.deferReply();

    await interaction.editReply(buildMainMenu({
      userId: interaction.user.id,
      isAdmin: interaction.memberPermissions?.has(PermissionFlagsBits.ManageGuild) ?? false,
    }));

    // Neue Patchnotes einmalig zustellen – kurzer Hinweis, Details im Postfach.
    const news = patchnotes.deliver(interaction.guildId, interaction.user.id);
    if (news) {
      await interaction.followUp({ content: news, flags: MessageFlags.Ephemeral })
        .catch(() => {});
    }
  },
};
