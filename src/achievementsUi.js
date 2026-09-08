const { EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
const ui = require('./ui');
const identity = require('./identity');
const achievements = require('./achievements');

const { homeButton } = ui;

/**
 * ===========================================================================
 *  ANSICHT DER ERFOLGE
 * ===========================================================================
 *
 * Zwei Seiten: die eigenen Erfolge und die Ehrentafel. Bewusst eine eigene
 * Datei statt eines weiteren Blocks in ui.js – die hat über viertausend
 * Zeilen, und casinoUi.js zeigt, dass ausgelagerte Ansichten hier üblich sind.
 *
 * Die Datei kennt keine Regeln, nur `achievements.listFor` und `board`. Wer
 * einen Erfolg hinzufügt, muss hier nichts anfassen.
 */

/** Ein Balken aus [ist, soll] – zehn Felder, damit es auf Fluxer nicht bricht. */
function bar([ist, soll]) {
  const anteil = soll > 0 ? Math.min(1, ist / soll) : 0;
  const voll = Math.round(anteil * 10);
  return `${'▰'.repeat(voll)}${'▱'.repeat(10 - voll)}`;
}

const zahl = (n) => Math.round(n).toLocaleString('de-DE');

/** Höchstens so viele offene Erfolge zeigen – der Rest wäre eine Wand. */
const OFFEN_MAX = 8;

/**
 * Seite 1: die eigenen Erfolge.
 * Geholte oben (Platin zuerst), darunter die nächsten erreichbaren Ziele.
 */
async function buildAchievementsView({ guildId, userId, page = 1 }) {
  const { geholt, offen, gesamt } = await achievements.listFor(guildId, userId);

  const embed = new EmbedBuilder()
    .setTitle('🏅 Erfolge')
    .setColor(0xf1c40f)
    .setDescription(
      `${identity.mention(userId)} · **${geholt.length} / ${gesamt}**`
      + (geholt.length === gesamt ? '\nAlles geholt. Ernsthaft?' : ''));

  if (geholt.length) {
    embed.addFields({
      name: '✅ Geholt',
      value: geholt.slice(0, 15).map((r) =>
        `${r.emoji} **${r.title}** _(${achievements.TIERS[r.tier].label})_`).join('\n')
        + (geholt.length > 15 ? `\n… und ${geholt.length - 15} weitere` : ''),
    });
  }

  if (offen.length) {
    embed.addFields({
      name: '🔒 Als Nächstes',
      value: offen.slice(0, OFFEN_MAX).map((r) => {
        const ziel = r.progress
          ? `\n${bar(r.progress)} ${zahl(r.progress[0])} / ${zahl(r.progress[1])}`
          : '';
        return `${r.emoji} **${r.title}** — _${r.text}_${ziel}`;
      }).join('\n'),
    });
  }

  return {
    embeds: [embed],
    // Die Ehrentafel ist ein eigener Knopf, aber jede Menü-Ansicht braucht
    // auch den Weg zurück ins Hauptmenü (§ menu.test.js prüft genau das).
    components: [new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId(`erfolge-tafel|${userId}`)
        .setLabel('Ehrentafel')
        .setEmoji('👑')
        .setStyle(ButtonStyle.Primary),
      homeButton(userId))],
  };
}

/**
 * Seite 2: die Ehrentafel der serverweiten Erfolge.
 *
 * Auch die leeren Zeilen bleiben stehen – sie sind die Einladung.
 */
async function buildBoardView({ guildId, userId }) {
  const tafel = achievements.board(guildId);
  const vergeben = tafel.filter((e) => e.userId);

  const embed = new EmbedBuilder()
    .setTitle('👑 Ehrentafel')
    .setColor(0xe67e22)
    .setDescription(
      'Diese Erfolge kann nur **einer** haben – wer zuerst da ist, behält ihn.\n'
      + `Vergeben: **${vergeben.length} / ${tafel.length}**`)
    .addFields({
      name: 'Serverweit',
      value: tafel.map((e) =>
        `${e.rule.emoji} **${e.rule.title}** — `
        + (e.userId ? identity.mention(e.userId) : '_noch niemand_')).join('\n'),
    });

  return {
    embeds: [embed],
    components: [new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId(`erfolge-meine|${userId}`)
        .setLabel('Meine Erfolge')
        .setEmoji('🏅')
        .setStyle(ButtonStyle.Secondary),
      homeButton(userId))],
  };
}

module.exports = { buildAchievementsView, buildBoardView, bar };
