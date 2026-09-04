const {
  SlashCommandBuilder, EmbedBuilder, ActionRowBuilder, MessageFlags,
} = require('discord.js');
const { homeButton } = require('../ui');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('help')
    .setDescription('Kurze Einführung: was dieser Bot kann und wie du loslegst.'),

  async execute(interaction) {
    const name = interaction.client.user.username;

    const embed = new EmbedBuilder()
      .setTitle(`❓ Willkommen bei ${name}`)
      .setColor(0x5865f2)
      .setDescription(
        `**${name}** ist ein kleines **Wirtschaftsspiel**: Autos, Immobilien, Jobs, ein Casino ` +
        'und Storage-Wars-Auktionen. Dein **Geld liegt bei UnbelievaBoat**, alles andere hier – ' +
        'und fast alles läuft über **Buttons** im Menü. Du kannst nichts kaputt machen, klick dich ruhig durch.')
      .addFields(
        {
          name: '🚀 So legst du los',
          value: '`/menu` öffnet das Hauptmenü – dein Startpunkt für **alles**.',
        },
        {
          name: '💸 Geld verdienen',
          value: '`!work` (UnbelievaBoat) · 💼 **Arbeitsamt** (Jobs) · Autos & Immobilien **verkaufen** · ' +
            '🎰 **Casino** · 🏬 **Auktionen**',
        },
        {
          name: '🛒 Geld ausgeben',
          value: '✨ **Neuwagen** · 🔧 **Gebrauchtwagen** · 🏘️ **Immobilien** (kaufen & mieten) · 🧰 **Ausrüstung**',
        },
        {
          name: '🛠️ Werkstatt',
          value: '`/werkstatt` – was auf der Straße stand, kommt zerkratzt zurück. ' +
            'Die Werkstatt bringt es wieder auf Vordermann: Aufbereitung, Instandsetzung oder volle Restaurierung.',
        },
        {
          name: '🧰 Ausrüstung, die etwas kann',
          value: '`/angeln` mit der Angelausrüstung · `/creator` baut dein Netzwerk aus ' +
            'Twitch, YouTube, Instagram und Twitter auf (Setup und Kamera nötig) – ' +
            'mit Sponsorenverträgen, Merch und Burnout · ' +
            'mit dem Werkzeugkasten reparierst du in der 🛠️ Werkstatt selbst und zahlst nur Material.',
        },
        {
          name: '📈 Börse',
          value: '`/boerse` – Aktien, Fonds-Anteile und Krypto. Die Kurse ändern sich alle 30 Minuten, ' +
            'ganz von selbst. `/depot` zeigt, wie es um dich steht.',
        },
        {
          name: '🏬 Storage Wars',
          value: '`/auktion` – verschlossene **Garagen ersteigern** und Wertobjekte finden. ' +
            'Manchmal steckt sogar ein Auto drin – aufmachen musst du selbst!',
        },
        {
          name: '🎵 Musik',
          value: '`/musik` – die längste Strecke im Spiel: Songs, Releases, Konzerte und ' +
            'Tantiemen, die von allein weiterlaufen. Mit Gesicht oder anonym, in Japan und ' +
            'Korea mit Idol-Verträgen.',
        },
        {
          name: '🌍 Heimat & Sprache',
          value: '`/heimat` – wo du lebst und in welcher Sprache du sendest. Landessprache ' +
            'wächst schnell und deckelt früh, Englisch ist zäh und grenzenlos. ' +
            'Erste Wahl gratis, danach kostet der Umzug.',
        },
        {
          name: '🏛️ Staatskasse',
          value: '`/staat` – der gemeinsame Topf des Servers. Er wächst bei jeder Geldbewegung mit, ' +
            '**ohne dass du etwas abgibst**: 19 % deiner Ausgaben und 40 % deiner Einnahmen werden ' +
            'zusätzlich obendrauf gelegt.',
        },
        {
          name: '👤 Angeben & vergleichen',
          value: '`/profil` dein Steckbrief · `/leaderboard` die Rangliste · `/showcase` ein Auto herzeigen',
        },
      )
      .setFooter({ text: 'Level & Erfahrung sammelst du automatisch bei jeder Ein- und Ausgabe.' });

    return interaction.reply({
      embeds: [embed],
      components: [new ActionRowBuilder().addComponents(homeButton(interaction.user.id))],
      flags: MessageFlags.Ephemeral,
    });
  },
};
