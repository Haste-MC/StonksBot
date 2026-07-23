const {
  SlashCommandBuilder, EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle,
} = require('discord.js');
const db = require('../db');
const property = require('../property');
const { getSymbol } = require('../currency');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('sell')
    .setDescription('Bietet ein Auto oder eine Immobilie zum Verkauf an.')
    .addIntegerOption((o) =>
      o.setName('objekt').setDescription('ID aus deinem Besitz (/inventory oder /property)')
        .setRequired(true))
    .addIntegerOption((o) =>
      o.setName('preis').setDescription('Dein Verkaufspreis')
        .setRequired(true).setMinValue(1)),

  async execute(interaction) {
    await interaction.deferReply();
    const itemId = interaction.options.getInteger('objekt');
    const price = interaction.options.getInteger('preis');

    const owned = db.getOwned(interaction.guildId, interaction.user.id, itemId);
    if (!owned) {
      return interaction.editReply(
        '❌ Das besitzt du nicht. Schau in `/inventory` (Autos) oder ' +
        '`/property ansicht:Mein Besitz` (Immobilien).');
    }

    const result = db.createListing(interaction.guildId, interaction.user.id, itemId, price);
    if (!result.ok) {
      const texts = {
        not_owned: '❌ Das besitzt du nicht.',
        wrong_kind: '❌ Ausrüstung lässt sich nicht weiterverkaufen.',
        has_tenant: '❌ Da wohnt jemand drin. Zieh erst dein Mietangebot zurück.',
        too_many_listings:
          `❌ Du hast schon ${result.max} Inserate laufen. Zieh erst eins zurück.`,
      };
      return interaction.editReply(texts[result.reason] ?? '❌ Hat nicht geklappt.');
    }

    const symbol = await getSymbol(interaction.guildId);
    const money = (n) => `${symbol} ${n.toLocaleString('de-DE')}`;
    const isProperty = owned.kind === 'property';

    const embed = new EmbedBuilder()
      .setTitle(isProperty ? '🏘️ Immobilie inseriert' : '🔧 Auto inseriert')
      .setDescription(`**${owned.name}** steht jetzt im Markt.`)
      .addFields(
        { name: 'Dein Preis', value: money(price), inline: true },
        { name: 'Neupreis', value: money(owned.price), inline: true },
        { name: 'Inserat-Nr.', value: `\`${result.listing.id}\``, inline: true },
      )
      .setColor(isProperty ? 0x16a085 : 0x95a5a6)
      .setFooter({
        text: isProperty
          ? 'Bis zum Verkauf ist das Objekt aus deinem Besitz – auch die Stellplätze.'
          : 'Das Auto ist so lange aus deiner Garage.',
      });

    if (owned.image_url) embed.setThumbnail(owned.image_url);

    // Warnen, wenn der Verkauf die eigene Kapazität sprengt.
    if (isProperty) {
      const cap = property.capacity(interaction.guildId, interaction.user.id);
      if (cap.used > cap.capacity) {
        embed.addFields({
          name: '⚠️ Achtung',
          value: `Du hast jetzt ${cap.used} Autos, aber nur ${cap.capacity} Plätze. ` +
            `In ${property.GRACE_DAYS} Tagen werden sonst Fahrzeuge zwangsverkauft.`,
        });
      }
    }

    const row = new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId(`ucancel|${result.listing.id}|${interaction.user.id}`)
        .setLabel('Inserat zurückziehen').setEmoji('↩️')
        .setStyle(ButtonStyle.Danger),
    );

    return interaction.editReply({ embeds: [embed], components: [row] });
  },
};
