const { EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
const ui = require('./ui');
const db = require('./db');
const casino = require('./casino');
const { getSymbol, plainSymbol } = require('./currency');
const unb = require('./unb');

const { money, homeButton } = ui;

const BET_CHIPS = [100, 1000, 10000, 100000];

const GAMES = {
  coinflip: { emoji: '🪙', title: 'Coinflip', color: 0xf1c40f },
  slots: { emoji: '🎰', title: 'Slots', color: 0xe91e63 },
  blackjack: { emoji: '🃏', title: 'Blackjack', color: 0x2ecc71 },
  roulette: { emoji: '🎡', title: 'Roulette', color: 0xe74c3c },
};

/** Bargeld des Spielers – null, wenn die API nicht erreichbar ist. */
async function cashOf(guildId, userId) {
  try {
    return (await unb.getBalance(guildId, userId)).cash;
  } catch {
    return null;
  }
}

const compact = (n) =>
  n >= 1000000 ? `${n / 1000000}M` : n >= 1000 ? `${n / 1000}K` : String(n);

/** Chip-Reihe zum Einsatz wählen: feste Beträge + Max. */
function chipRow(game, bet, userId) {
  const row = new ActionRowBuilder();
  for (const amount of BET_CHIPS) {
    row.addComponents(new ButtonBuilder()
      .setCustomId(`cbet|${game}|${amount}|${userId}`)
      .setLabel(compact(amount))
      .setStyle(amount === bet ? ButtonStyle.Primary : ButtonStyle.Secondary));
  }
  row.addComponents(new ButtonBuilder()
    .setCustomId(`cbet|${game}|max|${userId}`)
    .setLabel('Max').setEmoji('💰')
    .setStyle(ButtonStyle.Secondary));
  return row;
}

/** Fußzeile: eigener Betrag, zurück zum Casino, Hauptmenü. */
function navRow(game, userId) {
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(`cmod|${game}|${userId}`)
      .setLabel('Eigener Betrag').setEmoji('✏️')
      .setStyle(ButtonStyle.Secondary),
    new ButtonBuilder()
      .setCustomId(`chub|${userId}`)
      .setLabel('Casino').setEmoji('🎰')
      .setStyle(ButtonStyle.Secondary),
    homeButton(userId),
  );
}

// ------------------------------------------------------------------ Hub

async function buildHub({ guildId, userId }) {
  const symbol = await getSymbol(guildId);
  const cash = await cashOf(guildId, userId);

  const embed = new EmbedBuilder()
    .setTitle('🎰 Casino')
    .setColor(0x9b59b6)
    .setDescription(
      'Willkommen! Wähle ein Spiel:\n\n' +
      '🪙 **Coinflip** — Kopf oder Zahl, zahlt 2×\n' +
      '🎰 **Slots** — drei Walzen, Jackpot 90× (7️⃣7️⃣7️⃣)\n' +
      '🃏 **Blackjack** — gegen den Dealer, näher an 21\n' +
      '🎡 **Roulette** — Farbe oder Dutzend\n\n' +
      '_Spiel mit Verstand — das Haus gewinnt auf Dauer._')
    .setFooter({ text: cash === null ? 'Guthaben nicht abrufbar' : `Dein Bargeld: ${plainSymbol(symbol)} ${cash.toLocaleString('de-DE')}` });

  const gameRow = new ActionRowBuilder().addComponents(
    ...Object.entries(GAMES).map(([id, g]) =>
      new ButtonBuilder()
        .setCustomId(`cgame|${id}|${userId}`)
        .setLabel(g.title).setEmoji(g.emoji)
        .setStyle(ButtonStyle.Success)));

  return {
    embeds: [embed],
    components: [gameRow, new ActionRowBuilder().addComponents(homeButton(userId))],
  };
}

// ------------------------------------------------------------- Spielansicht

/**
 * Baut die Ansicht eines Spiels. `banner` wird oben eingeblendet (Ergebnis
 * der letzten Runde). Bei Blackjack mit laufender Runde zeigt sie den Tisch.
 */
async function buildGame(game, { guildId, userId, bet = 100, banner = null }) {
  if (game === 'blackjack' && db.getGame(guildId, userId)) {
    return buildBlackjackTable({ guildId, userId, banner });
  }

  const symbol = await getSymbol(guildId);
  const cash = await cashOf(guildId, userId);
  const g = GAMES[game];

  const embed = new EmbedBuilder()
    .setTitle(`${g.emoji} ${g.title}`)
    .setColor(g.color);

  const parts = [];
  if (banner) parts.push(banner + '\n');
  parts.push(`**Einsatz:** ${money(symbol, bet)}`);
  parts.push(payoutHint(game, symbol));
  embed.setDescription(parts.join('\n'));
  embed.setFooter({
    text: cash === null ? 'Guthaben nicht abrufbar'
      : `Dein Bargeld: ${plainSymbol(symbol)} ${cash.toLocaleString('de-DE')}`,
  });

  return {
    embeds: [embed],
    components: [chipRow(game, bet, userId), ...playRows(game, bet, userId), navRow(game, userId)],
  };
}

/** Auszahlungshinweis je Spiel. */
function payoutHint(game) {
  switch (game) {
    case 'coinflip':
      return '_50 / 50 · Gewinn zahlt **2×** deinen Einsatz._';
    case 'slots':
      return '_Paar: 🍒🍋 Einsatz zurück · 🔔 1,3× · ⭐ 1,6× · 💎 2,2× · 7️⃣ 3,5×\n' +
        'Drei gleiche: 🍒🍋 **4×** · 🔔 **9×** · ⭐ **16×** · 💎 **40×** · 7️⃣ **90×**_';
    case 'blackjack':
      return '_Näher an 21 als der Dealer · Gewinn **2×**, Blackjack **2,5×**._';
    case 'roulette':
      return '_Rot/Schwarz **2×** · Dutzend **3×** · Grün (0) **36×**._';
    default:
      return '';
  }
}

/** Spiel-Buttons (Einsatz steckt in der Button-ID). */
function playRows(game, bet, userId) {
  switch (game) {
    case 'coinflip':
      return [new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId(`cf|${bet}|kopf|${userId}`)
          .setLabel('Kopf').setEmoji('🪙').setStyle(ButtonStyle.Success),
        new ButtonBuilder().setCustomId(`cf|${bet}|zahl|${userId}`)
          .setLabel('Zahl').setEmoji('🎯').setStyle(ButtonStyle.Success),
      )];
    case 'slots':
      return [new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId(`slot|${bet}|${userId}`)
          .setLabel('Drehen').setEmoji('🎰').setStyle(ButtonStyle.Success),
      )];
    case 'blackjack':
      return [new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId(`bjdeal|${bet}|${userId}`)
          .setLabel('Karten geben').setEmoji('🃏').setStyle(ButtonStyle.Success),
      )];
    case 'roulette':
      return [
        new ActionRowBuilder().addComponents(
          new ButtonBuilder().setCustomId(`rl|${bet}|red|${userId}`)
            .setLabel('Rot').setEmoji('🔴').setStyle(ButtonStyle.Danger),
          new ButtonBuilder().setCustomId(`rl|${bet}|black|${userId}`)
            .setLabel('Schwarz').setEmoji('⚫').setStyle(ButtonStyle.Secondary),
          new ButtonBuilder().setCustomId(`rl|${bet}|green|${userId}`)
            .setLabel('Grün (0)').setEmoji('🟢').setStyle(ButtonStyle.Success),
        ),
        new ActionRowBuilder().addComponents(
          new ButtonBuilder().setCustomId(`rl|${bet}|dozen1|${userId}`)
            .setLabel('1–12').setStyle(ButtonStyle.Primary),
          new ButtonBuilder().setCustomId(`rl|${bet}|dozen2|${userId}`)
            .setLabel('13–24').setStyle(ButtonStyle.Primary),
          new ButtonBuilder().setCustomId(`rl|${bet}|dozen3|${userId}`)
            .setLabel('25–36').setStyle(ButtonStyle.Primary),
        ),
      ];
    default:
      return [];
  }
}

// --------------------------------------------------------- Blackjack-Tisch

/** Der Tisch während einer laufenden oder gerade beendeten Runde. */
async function buildBlackjackTable({ guildId, userId, banner = null, done = null }) {
  const symbol = await getSymbol(guildId);
  const g = done ?? db.getGame(guildId, userId);
  const cash = await cashOf(guildId, userId);

  const embed = new EmbedBuilder().setTitle('🃏 Blackjack').setColor(0x2ecc71);

  const playerVal = casino.handValue(g.player);
  const lines = [];
  if (banner) lines.push(banner + '\n');

  // Während des Spiels ist die zweite Dealer-Karte verdeckt.
  if (done) {
    lines.push(`**Dealer:** ${casino.formatHand(g.dealer)}  = ${casino.handValue(g.dealer)}`);
  } else {
    lines.push(`**Dealer:** ${casino.formatCard(g.dealer[0])} 🎴`);
  }
  lines.push(`**Du:** ${casino.formatHand(g.player)}  = ${playerVal}`);
  lines.push(`\n**Einsatz:** ${money(symbol, g.bet)}`);
  embed.setDescription(lines.join('\n'));
  embed.setFooter({
    text: cash === null ? '' : `Dein Bargeld: ${plainSymbol(symbol)} ${cash.toLocaleString('de-DE')}`,
  });

  if (done) {
    // Runde vorbei – nur zurück zum Spiel bzw. Casino.
    return {
      embeds: [embed],
      components: [new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId(`cgame|blackjack|${userId}`)
          .setLabel('Nochmal').setEmoji('🔄').setStyle(ButtonStyle.Success),
        new ButtonBuilder().setCustomId(`chub|${userId}`)
          .setLabel('Casino').setEmoji('🎰').setStyle(ButtonStyle.Secondary),
        homeButton(userId),
      )],
    };
  }

  return {
    embeds: [embed],
    components: [new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId(`bjhit|${userId}`)
        .setLabel('Karte ziehen').setEmoji('🃏').setStyle(ButtonStyle.Primary),
      new ButtonBuilder().setCustomId(`bjstand|${userId}`)
        .setLabel('Bleiben').setEmoji('✋').setStyle(ButtonStyle.Success),
    )],
  };
}

module.exports = { buildHub, buildGame, buildBlackjackTable, GAMES, BET_CHIPS };
