const { SlashCommandBuilder } = require('discord.js');
const jobs = require('../jobs');
const { shiftResult, settle } = require('../buttons');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('work')
    .setDescription('Arbeitet eine Schicht in deinem aktuellen Job.'),

  async execute(interaction) {
    await interaction.deferReply();
    // Erst Miete abrechnen, dann arbeiten.
    const notice = await settle(interaction);
    const result = await jobs.work(interaction.guildId, interaction.user.id);
    const reply = await shiftResult(interaction, result);
    if (notice) reply.content = `${notice}\n${reply.content ?? ''}`.trim();
    return interaction.editReply(reply);
  },
};
