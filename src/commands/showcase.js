const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const db = require('../db');
const { getSymbol } = require('../currency');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('showcase')
    .setDescription('Zeigt ein Auto aus deiner Garage her.')
    .addIntegerOption((o) =>
      o.setName('auto').setDescription('Auto-ID (ohne Angabe: dein teuerstes)'))
    .addUserOption((o) =>
      o.setName('user').setDescription('Wessen Garage? (Standard: du selbst)')),

  async execute(interaction) {
    await interaction.deferReply();
    const target = interaction.options.getUser('user') ?? interaction.user;
    const id = interaction.options.getInteger('auto');

    const car = id
      ? db.getOwned(interaction.guildId, target.id, id)
      : db.getMostValuable(interaction.guildId, target.id);

    if (!car) {
      const who = target.id === interaction.user.id ? 'Du besitzt' : `${target} besitzt`;
      return interaction.editReply(
        id ? `❌ ${who} dieses Auto nicht.`
           : `🅿️ ${who} noch kein Auto. Ab zu \`/shop\`!`);
    }

    const symbol = await getSymbol(interaction.guildId);
    const total = db.garageValue(interaction.guildId, target.id);

    const embed = new EmbedBuilder()
      .setTitle(`${car.emoji ? `${car.emoji} ` : ''}${car.name}`)
      .setDescription(car.description || null)
      .addFields(
        { name: 'Wert', value: `${symbol} ${car.price.toLocaleString('de-DE')}`, inline: true },
        { name: 'Im Besitz', value: `${car.quantity}×`, inline: true },
        { name: 'Garagenwert', value: `${symbol} ${total.toLocaleString('de-DE')}`, inline: true },
      )
      .setColor(0xf39c12)
      .setFooter({ text: `Garage von ${target.displayName ?? target.username}` });

    if (car.image_url) embed.setImage(car.image_url);
    if (car.attribution) embed.setAuthor({ name: car.attribution });

    return interaction.editReply({ embeds: [embed] });
  },
};
