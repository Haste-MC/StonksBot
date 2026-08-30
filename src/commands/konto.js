const { SlashCommandBuilder, EmbedBuilder, MessageFlags } = require('discord.js');
const accounts = require('../accounts');
const identity = require('../identity');
const db = require('../db');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('konto')
    .setDescription('Zeigt dein Konto und ob dein Fluxer-Zugang verknüpft ist.'),

  async execute(interaction) {
    // Achtung: interaction ist bereits übersetzt (siehe bridge.js) –
    // interaction.user.id ist das Konto, .platformId die echte Discord-ID.
    const accountId = interaction.user.id;
    const links = db.linksOf(accountId);
    const fluxer = links.filter((l) => l.platform === 'fluxer');

    const embed = new EmbedBuilder()
      .setTitle('👤 Dein Konto')
      .setColor(0x5865f2)
      .setDescription(
        `Konto: \`${accountId}\`\n` +
        (fluxer.length
          ? `🔗 Verknüpft mit **${fluxer.length}** Fluxer-Zugang${fluxer.length === 1 ? '' : 'en'}:\n` +
            fluxer.map((l) => `• \`${l.user_id}\``).join('\n')
          : '🔓 Noch kein Fluxer-Zugang verknüpft.'))
      .addFields({
        name: 'So verknüpfst du',
        value: 'Tippe **auf Fluxer** `!link ' + accountId + '` – dein Fortschritt ist ' +
          'danach auf beiden Plattformen derselbe.',
      })
      .setFooter({ text: `Welt: ${identity.world()}` });

    return interaction.reply({ embeds: [embed], flags: MessageFlags.Ephemeral });
  },
};
