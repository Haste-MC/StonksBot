const {
  SlashCommandBuilder, EmbedBuilder, PermissionFlagsBits, MessageFlags,
} = require('discord.js');
const db = require('../db');
const { getSymbol } = require('../currency');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('additem')
    .setDescription('Legt einen neuen Artikel im Shop an. (Nur für Admins)')
    // Standardmäßig nur für Mitglieder mit "Server verwalten" sichtbar.
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
    .addStringOption((o) =>
      o.setName('name').setDescription('Name des Artikels')
        .setRequired(true).setMaxLength(80))
    .addIntegerOption((o) =>
      o.setName('preis').setDescription('Preis in Serverwährung')
        .setRequired(true).setMinValue(0))
    .addStringOption((o) =>
      o.setName('beschreibung').setDescription('Kurze Beschreibung').setMaxLength(200))
    .addStringOption((o) =>
      o.setName('emoji').setDescription('Emoji für die Anzeige, z.B. 🍗').setMaxLength(64))
    .addIntegerOption((o) =>
      o.setName('lager').setDescription('Stückzahl (leer lassen = unbegrenzt)').setMinValue(0))
    .addStringOption((o) =>
      o.setName('marke').setDescription('Marke, z.B. Ferrari').setMaxLength(50))
    .addStringOption((o) =>
      o.setName('bild').setDescription('Bild-URL (https, muss direkt aufs Bild zeigen)'))
    .addStringOption((o) =>
      o.setName('bildquelle').setDescription('Urheber/Lizenz des Bildes').setMaxLength(150)),

  async execute(interaction) {
    await interaction.deferReply();

    const name = interaction.options.getString('name').trim();
    const price = interaction.options.getInteger('preis');
    const description = interaction.options.getString('beschreibung')?.trim() ?? '';
    const emoji = interaction.options.getString('emoji')?.trim() ?? '';
    const stock = interaction.options.getInteger('lager'); // null = unbegrenzt
    const brand = interaction.options.getString('marke')?.trim() ?? '';
    const imageUrl = interaction.options.getString('bild')?.trim() ?? '';
    const attribution = interaction.options.getString('bildquelle')?.trim() ?? '';

    if (!name) {
      return interaction.editReply({
        content: '❌ Der Name darf nicht leer sein.', flags: MessageFlags.Ephemeral,
      });
    }

    // Discord zeigt nur https-Bilder an – eine kaputte URL macht das Embed unbrauchbar.
    if (imageUrl && !/^https:\/\/\S+$/i.test(imageUrl)) {
      return interaction.editReply('❌ Die Bild-URL muss mit `https://` beginnen.');
    }

    let item;
    try {
      item = db.createItem({
        guildId: interaction.guildId,
        name, price, description, emoji, stock, brand, imageUrl, attribution,
        createdBy: interaction.user.id,
      });
    } catch (err) {
      // Unique-Index auf (guild_id, lower(name)) hat zugeschlagen.
      if (String(err.message).includes('UNIQUE')) {
        return interaction.editReply(`❌ Es gibt bereits einen Artikel namens **${name}**.`);
      }
      throw err;
    }

    const symbol = await getSymbol(interaction.guildId);

    const embed = new EmbedBuilder()
      .setTitle('✅ Artikel angelegt')
      .setDescription(`${emoji ? `${emoji} ` : ''}**${item.name}**`)
      .addFields(
        { name: 'Preis', value: `${symbol} ${price.toLocaleString('de-DE')}`, inline: true },
        { name: 'Lager', value: stock === null ? '∞' : String(stock), inline: true },
        { name: 'Artikel-ID', value: `\`${item.id}\``, inline: true },
      )
      .setFooter({ text: 'Kaufbar mit /buy ' + item.id })
      .setColor(0x2ecc71);

    if (description) embed.addFields({ name: 'Beschreibung', value: description });
    if (brand) embed.addFields({ name: 'Marke', value: brand, inline: true });
    if (imageUrl) embed.setImage(imageUrl);
    if (attribution) embed.setAuthor({ name: attribution });

    return interaction.editReply({ embeds: [embed] });
  },
};
