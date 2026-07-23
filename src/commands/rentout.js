const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const property = require('../property');
const { getSymbol } = require('../currency');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('rentout')
    .setDescription('Bietet eine eigene Immobilie zur Miete an.')
    .addIntegerOption((o) =>
      o.setName('objekt').setDescription('Immobilien-ID aus deinem Besitz')
        .setRequired(true))
    .addIntegerOption((o) =>
      o.setName('preis').setDescription('Tagesmiete, die du verlangst')
        .setRequired(true).setMinValue(1)),

  async execute(interaction) {
    await interaction.deferReply();

    const result = property.offerForRent(
      interaction.guildId,
      interaction.user.id,
      interaction.options.getInteger('objekt'),
      interaction.options.getInteger('preis'),
    );

    if (!result.ok) {
      const texts = {
        not_found: '❌ Diese Immobilie gibt es nicht.',
        not_owned: '❌ Die gehört dir nicht. Schau in `/property ansicht:Mein Besitz`.',
        self_rented: '❌ Da wohnst du selbst — kündige erst deinen eigenen Vertrag.',
        already_offered: 'ℹ️ Das bietest du bereits an.',
      };
      return interaction.editReply(texts[result.reason] ?? '❌ Hat nicht geklappt.');
    }

    const symbol = await getSymbol(interaction.guildId);
    const price = interaction.options.getInteger('preis');

    const embed = new EmbedBuilder()
      .setTitle('🔑 Zur Miete angeboten')
      .setDescription(`**${result.item.name}** steht jetzt im Mietmarkt.`)
      .addFields(
        { name: 'Deine Tagesmiete', value: `${symbol} ${price.toLocaleString('de-DE')}`, inline: true },
        { name: 'Angebot-Nr.', value: `\`${result.offer.id}\``, inline: true },
        {
          name: 'Deine Stellplätze',
          value: `${result.capacity.used}/${result.capacity.capacity}`,
          inline: true,
        },
      )
      .setFooter({
        text: 'Achtung: Solange vermietet ist, zählen die Stellplätze dem Mieter.',
      })
      .setColor(0x9b59b6);

    if (result.item.image_url) embed.setThumbnail(result.item.image_url);

    // Warnen, wenn der Vermieter sich damit selbst in die Enge bringt.
    if (result.capacity.used > result.capacity.capacity) {
      embed.addFields({
        name: '⚠️ Achtung',
        value: `Du hast jetzt ${result.capacity.used} Autos, aber nur ` +
          `${result.capacity.capacity} Plätze. Du hast ${property.GRACE_DAYS} Tage Zeit, ` +
          'sonst werden Fahrzeuge zwangsverkauft.',
      });
    }

    return interaction.editReply({ embeds: [embed] });
  },
};
