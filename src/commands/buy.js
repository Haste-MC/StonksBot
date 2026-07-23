const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const { buy } = require('../purchase');
const { getSymbol } = require('../currency');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('buy')
    .setDescription('Kauft einen Artikel aus dem Shop.')
    .addIntegerOption((o) =>
      o.setName('artikel').setDescription('Die Artikel-ID (siehe /shop)').setRequired(true))
    .addIntegerOption((o) =>
      o.setName('menge').setDescription('Wie viele (Standard 1)').setMinValue(1)),

  async execute(interaction) {
    await interaction.deferReply();
    const itemId = interaction.options.getInteger('artikel');
    const quantity = interaction.options.getInteger('menge') ?? 1;

    const symbol = await getSymbol(interaction.guildId);
    const money = (n) => `${symbol} ${n.toLocaleString('de-DE')}`;

    const result = await buy(interaction.guildId, interaction.user.id, itemId, quantity);

    if (!result.ok) {
      const messages = {
        not_found: '❌ Diesen Artikel gibt es nicht. Prüf die ID mit `/shop`.',
        out_of_stock: '📦 Davon ist nicht genug auf Lager.',
        insufficient_funds:
          `💸 Zu wenig Geld. Du brauchst ${money(result.needed)}, ` +
          `hast aber nur ${money(result.have)}.`,
      };
      return interaction.editReply(messages[result.reason] ?? '❌ Kauf fehlgeschlagen.');
    }

    const embed = new EmbedBuilder()
      .setTitle('✅ Gekauft!')
      .setDescription(
        `Du hast **${result.quantity}× ${result.item.name}** für ` +
        `${money(result.totalPrice)} gekauft.`)
      .addFields({ name: 'Neues Bargeld', value: money(result.newBalance.cash) })
      .setFooter({ text: 'Anschauen mit /inventory' })
      .setColor(0x2ecc71);

    if (result.movedFromBank > 0) {
      embed.addFields({
        name: 'Hinweis',
        value: `${money(result.movedFromBank)} wurden dafür von deiner Bank abgehoben.`,
      });
    }

    return interaction.editReply({ embeds: [embed] });
  },
};
