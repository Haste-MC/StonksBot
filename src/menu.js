const { EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
const ui = require('./ui');
const casinoUi = require('./casinoUi');

/**
 * ===========================================================================
 *  MENÜ-REGISTRY
 * ===========================================================================
 *
 * Jeder Eintrag hier erscheint automatisch als Button im Hauptmenü (`/menu`).
 * Ein neues Menü hinzuzufügen heißt: einen Eintrag ergänzen – sonst nichts.
 *
 *   id          eindeutiger Schlüssel, taucht in den Button-IDs auf
 *   label       Beschriftung des Buttons (kurz halten)
 *   emoji       Icon des Buttons
 *   description Zeile in der Übersicht des Hauptmenüs
 *   style       optional: 'primary' | 'secondary' | 'success' | 'danger'
 *   adminOnly   optional: nur für Mitglieder mit "Server verwalten"
 *   build(ctx)  baut die Ansicht; bekommt { guildId, userId, page }
 *               und gibt { embeds, components } zurück
 *
 * Discord erlaubt 25 Buttons (5 Zeilen à 5) – so viele Menüpunkte passen.
 */
const ENTRIES = [
  {
    id: 'new',
    label: 'Neuwagen',
    emoji: '✨',
    description: 'Autos direkt vom Händler kaufen',
    style: 'success',
    build: (ctx) => ui.buildNewShopView(ctx),
  },
  {
    id: 'brands',
    label: 'Marken',
    emoji: '🏷️',
    description: 'Autos nach Hersteller filtern',
    style: 'secondary',
    build: (ctx) => ui.buildBrandsView(ctx),
  },
  {
    id: 'used',
    label: 'Gebrauchtwagen',
    emoji: '🔧',
    description: 'Autos von anderen Spielern kaufen',
    style: 'secondary',
    build: (ctx) => ui.buildUsedShopView(ctx),
  },
  {
    id: 'property',
    label: 'Immobilien',
    emoji: '🏘️',
    description: 'Kaufen und mieten – vom Markt und von Spielern',
    style: 'secondary',
    build: (ctx) => ui.buildPropertyShopView(ctx),
  },
  {
    id: 'estate',
    label: 'Mein Besitz',
    emoji: '🔑',
    description: 'Immobilien, Mietvertrag und freie Stellplätze',
    style: 'secondary',
    build: (ctx) => ui.buildEstateView(ctx),
  },
  {
    id: 'jobs',
    label: 'Arbeitsamt',
    emoji: '💼',
    description: 'Täglich wechselnde Stellenangebote',
    style: 'primary',
    build: (ctx) => ui.buildJobCenterView(ctx),
  },
  {
    id: 'gear',
    label: 'Ausrüstung',
    emoji: '🧰',
    description: 'Werkzeug und Qualifikationen für Jobs',
    style: 'secondary',
    build: (ctx) => ui.buildGearShopView(ctx),
  },
  {
    id: 'casino',
    label: 'Casino',
    emoji: '🎰',
    description: 'Coinflip, Slots, Blackjack und Roulette',
    style: 'primary',
    build: (ctx) => casinoUi.buildHub(ctx),
  },
  {
    id: 'inbox',
    label: 'Postfach',
    emoji: '📬',
    description: 'Kaufangebote, Verkäufe und Rechnungen',
    style: 'primary',
    build: (ctx) => ui.buildInboxView(ctx),
  },
  {
    id: 'garage',
    label: 'Meine Garage',
    emoji: '🅿️',
    description: 'Deine Autos und ihr Gesamtwert',
    style: 'secondary',
    build: (ctx) => ui.buildGarageView(ctx),
  },
  {
    id: 'listings',
    label: 'Meine Inserate',
    emoji: '📋',
    description: 'Was du im Gebrauchtmarkt anbietest',
    style: 'secondary',
    build: (ctx) => ui.buildListingsView(ctx),
  },
  {
    id: 'balance',
    label: 'Guthaben',
    emoji: '💰',
    description: 'Bargeld, Bank und Vermögen',
    style: 'secondary',
    build: (ctx) => ui.buildBalanceView(ctx),
  },
  {
    id: 'profil',
    label: 'Profil',
    emoji: '👤',
    description: 'Dein Steckbrief zum Angeben',
    style: 'primary',
    build: (ctx) => ui.buildProfileView(ctx),
  },
  {
    id: 'leaderboard',
    label: 'Rangliste',
    emoji: '🏆',
    description: 'Level, Einnahmen, Ausgaben & Networth',
    style: 'primary',
    build: (ctx) => ui.buildLeaderboardView(ctx),
  },
  {
    id: 'auktion',
    label: 'Auktionshaus',
    emoji: '🏬',
    description: 'Garagen ersteigern – Storage Wars',
    style: 'primary',
    build: (ctx) => ui.buildAuctionView(ctx),
  },
];

const STYLES = {
  primary: ButtonStyle.Primary,
  secondary: ButtonStyle.Secondary,
  success: ButtonStyle.Success,
  danger: ButtonStyle.Danger,
};

const byId = new Map(ENTRIES.map((e) => [e.id, e]));

function getEntry(id) {
  return byId.get(id) ?? null;
}

/** Menüpunkte, die dieser Nutzer sehen darf. */
function visibleEntries(isAdmin) {
  return ENTRIES.filter((e) => !e.adminOnly || isAdmin);
}

/** Baut das Hauptmenü mit einem Button pro registriertem Menüpunkt. */
function buildMainMenu({ userId, isAdmin = false }) {
  const entries = visibleEntries(isAdmin);

  const embed = new EmbedBuilder()
    .setTitle('🏠 Hauptmenü')
    .setDescription(entries.map((e) => `${e.emoji} **${e.label}** — ${e.description}`).join('\n'))
    .setFooter({ text: 'Wähle unten aus, wohin es gehen soll.' })
    .setColor(0x5865f2);

  const rows = [];
  for (let i = 0; i < entries.length; i += 5) {
    rows.push(new ActionRowBuilder().addComponents(
      ...entries.slice(i, i + 5).map((e) =>
        new ButtonBuilder()
          .setCustomId(ui.ID.menu(e.id, 1, userId))
          .setLabel(e.label).setEmoji(e.emoji)
          .setStyle(STYLES[e.style] ?? ButtonStyle.Secondary))));
  }

  return { embeds: [embed], components: rows };
}

/**
 * Baut die Ansicht eines Menüpunkts. Unbekannte IDs landen im Hauptmenü,
 * damit alte Buttons nach einer Umbenennung nicht ins Leere laufen.
 */
async function buildEntryView(id, ctx) {
  const entry = getEntry(id);
  if (!entry) return buildMainMenu({ userId: ctx.userId, isAdmin: ctx.isAdmin });
  if (entry.adminOnly && !ctx.isAdmin) {
    return {
      embeds: [new EmbedBuilder()
        .setTitle('🔒 Kein Zugriff')
        .setDescription('Dieser Bereich ist Admins vorbehalten.')
        .setColor(0xe74c3c)],
      components: [new ActionRowBuilder().addComponents(ui.homeButton(ctx.userId))],
    };
  }
  return entry.build(ctx);
}

module.exports = { ENTRIES, getEntry, visibleEntries, buildMainMenu, buildEntryView };
