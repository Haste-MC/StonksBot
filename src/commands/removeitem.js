const { SlashCommandBuilder, PermissionFlagsBits } = require('discord.js');
const db = require('../db');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('removeitem')
    .setDescription('Löscht einen Artikel aus dem Shop. (Nur für Admins)')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
    .addIntegerOption((o) =>
      o.setName('artikel').setDescription('Die Artikel-ID (siehe /shop)').setRequired(true)),

  async execute(interaction) {
    await interaction.deferReply();
    const itemId = interaction.options.getInteger('artikel');

    const item = db.getItem(interaction.guildId, itemId);
    if (!item) {
      return interaction.editReply('❌ Diesen Artikel gibt es nicht.');
    }

    // Durch ON DELETE CASCADE verschwindet der Artikel auch aus allen Inventaren.
    db.deleteItem(interaction.guildId, itemId);

    return interaction.editReply(
      `🗑️ **${item.name}** wurde gelöscht – auch aus den Inventaren aller Mitglieder.`);
  },
};
