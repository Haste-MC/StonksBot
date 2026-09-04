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
 *   group       Kategorie im Hauptmenü (siehe GROUPS weiter unten)
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
    group: 'cars',
    label: 'Neuwagen',
    emoji: '✨',
    description: 'Autos direkt vom Händler kaufen',
    style: 'success',
    build: (ctx) => ui.buildNewShopView(ctx),
  },
  {
    id: 'brands',
    group: 'cars',
    label: 'Marken',
    emoji: '🏷️',
    description: 'Autos nach Hersteller filtern',
    style: 'secondary',
    build: (ctx) => ui.buildBrandsView(ctx),
  },
  {
    id: 'used',
    group: 'cars',
    label: 'Gebrauchtwagen',
    emoji: '🔧',
    description: 'Autos von anderen Spielern kaufen',
    style: 'secondary',
    build: (ctx) => ui.buildUsedShopView(ctx),
  },
  {
    id: 'property',
    group: 'estate',
    label: 'Immobilien',
    emoji: '🏘️',
    description: 'Kaufen und mieten – vom Markt und von Spielern',
    style: 'secondary',
    build: (ctx) => ui.buildPropertyShopView(ctx),
  },
  {
    id: 'estate',
    group: 'estate',
    label: 'Mein Besitz',
    emoji: '🔑',
    description: 'Immobilien, Mietvertrag und freie Stellplätze',
    style: 'secondary',
    build: (ctx) => ui.buildEstateView(ctx),
  },
  {
    id: 'jobs',
    group: 'work',
    label: 'Arbeitsamt',
    emoji: '💼',
    description: 'Täglich wechselnde Stellenangebote',
    style: 'primary',
    build: (ctx) => ui.buildJobCenterView(ctx),
  },
  {
    id: 'angeln',
    group: 'work',
    label: 'Angeln',
    emoji: '🎣',
    description: 'Mit der Angelausrüstung Geld verdienen',
    style: 'secondary',
    build: (ctx) => ui.buildFishingView(ctx),
  },
  {
    id: 'creator',
    group: 'work',
    label: 'Creator',
    emoji: '📡',
    description: 'Twitch, YouTube, Instagram, Twitter',
    style: 'primary',
    build: (ctx) => ui.buildCreatorView(ctx),
  },
  {
    id: 'gear',
    group: 'work',
    label: 'Ausrüstung',
    emoji: '🧰',
    description: 'Werkzeug und Qualifikationen für Jobs',
    style: 'secondary',
    build: (ctx) => ui.buildGearShopView(ctx),
  },
  {
    id: 'casino',
    group: 'fun',
    label: 'Casino',
    emoji: '🎰',
    description: 'Coinflip, Slots, Blackjack und Roulette',
    style: 'primary',
    build: (ctx) => casinoUi.buildHub(ctx),
  },
  {
    id: 'inbox',
    group: 'me',
    label: 'Postfach',
    emoji: '📬',
    description: 'Kaufangebote, Verkäufe und Rechnungen',
    style: 'primary',
    build: (ctx) => ui.buildInboxView(ctx),
  },
  {
    id: 'garage',
    group: 'cars',
    label: 'Meine Garage',
    emoji: '🅿️',
    description: 'Deine Autos und ihr Gesamtwert',
    style: 'secondary',
    build: (ctx) => ui.buildGarageView(ctx),
  },
  {
    id: 'werkstatt',
    group: 'cars',
    label: 'Werkstatt',
    emoji: '🛠️',
    description: 'Beschädigte Autos reparieren lassen',
    style: 'primary',
    build: (ctx) => ui.buildWorkshopView(ctx),
  },
  {
    id: 'listings',
    group: 'cars',
    label: 'Meine Inserate',
    emoji: '📋',
    description: 'Was du im Gebrauchtmarkt anbietest',
    style: 'secondary',
    build: (ctx) => ui.buildListingsView(ctx),
  },
  {
    id: 'balance',
    group: 'me',
    label: 'Guthaben',
    emoji: '💰',
    description: 'Bargeld, Bank und Vermögen',
    style: 'secondary',
    build: (ctx) => ui.buildBalanceView(ctx),
  },
  {
    id: 'profil',
    group: 'me',
    label: 'Profil',
    emoji: '👤',
    description: 'Dein Steckbrief zum Angeben',
    style: 'primary',
    build: (ctx) => ui.buildProfileView(ctx),
  },
  {
    id: 'leaderboard',
    group: 'me',
    label: 'Rangliste',
    emoji: '🏆',
    description: 'Level, Einnahmen, Ausgaben & Networth',
    style: 'primary',
    build: (ctx) => ui.buildLeaderboardView(ctx),
  },
  {
    id: 'boerse',
    group: 'fun',
    label: 'Börse',
    emoji: '📈',
    description: 'Aktien, Fonds und Krypto – Kurse alle 30 min',
    style: 'success',
    build: (ctx) => ui.buildMarketView(ctx),
  },
  {
    id: 'depot',
    group: 'me',
    label: 'Depot',
    emoji: '💼',
    description: 'Deine Wertpapiere und ihr Gewinn',
    style: 'secondary',
    build: (ctx) => ui.buildDepotView(ctx),
  },
  {
    id: 'heimat',
    group: 'me',
    label: 'Heimat',
    emoji: '🌍',
    description: 'Wohnsitz und Inhaltssprache',
    style: 'secondary',
    build: (ctx) => ui.buildHomeView(ctx),
  },
  {
    id: 'staat',
    group: 'me',
    label: 'Staatskasse',
    emoji: '🏛️',
    description: 'Der gemeinsame Topf des Servers',
    style: 'secondary',
    build: (ctx) => ui.buildTreasuryView(ctx),
  },
  {
    id: 'auktion',
    group: 'fun',
    label: 'Auktionshaus',
    emoji: '🏬',
    description: 'Garagen ersteigern – Storage Wars',
    style: 'primary',
    build: (ctx) => ui.buildAuctionView(ctx),
  },
];

/**
 * ===========================================================================
 *  KATEGORIEN
 * ===========================================================================
 *
 * Das Hauptmenü zeigt nicht mehr alle 15 Menüpunkte auf einmal, sondern nur
 * diese Kategorien – ein Klick führt in die jeweilige Unterauswahl.
 *
 * Warum: Bei 15 Knöpfen wurde das Hauptmenü unübersichtlich, und auf Fluxer
 * (wo Menüs über Emoji-Reaktionen bedient werden) passten schlicht nicht alle
 * hin – Auktionshaus und Inserate waren dort gar nicht erreichbar.
 *
 * Eine neue Kategorie = ein Eintrag hier; ein Menüpunkt landet über sein
 * `group`-Feld automatisch darin.
 */
const GROUPS = [
  { id: 'cars', label: 'Fahrzeuge', emoji: '🚗', description: 'Kaufen, verkaufen, deine Garage' },
  { id: 'estate', label: 'Immobilien', emoji: '🏘️', description: 'Kaufen, mieten, vermieten' },
  { id: 'work', label: 'Arbeit', emoji: '💼', description: 'Jobs und Ausrüstung' },
  { id: 'fun', label: 'Zocken', emoji: '🎲', description: 'Casino und Auktionshaus' },
  { id: 'me', label: 'Ich', emoji: '👤', description: 'Profil, Geld, Postfach, Rangliste, Heimat' },
];

const groupById = new Map(GROUPS.map((g) => [g.id, g]));

/** Alle Menüpunkte einer Kategorie, die dieser Nutzer sehen darf. */
function entriesOfGroup(groupId, isAdmin = false) {
  return visibleEntries(isAdmin).filter((e) => e.group === groupId);
}

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

/** Baut einen Knopf, der einen Menüpunkt öffnet. */
function entryButton(entry, userId) {
  return new ButtonBuilder()
    .setCustomId(ui.ID.menu(entry.id, 1, userId))
    .setLabel(entry.label).setEmoji(entry.emoji)
    .setStyle(STYLES[entry.style] ?? ButtonStyle.Secondary);
}

/** Verteilt Knöpfe auf Zeilen zu je fünf (Discord-Grenze). */
function rowsOf(buttons) {
  const rows = [];
  for (let i = 0; i < buttons.length; i += 5) {
    rows.push(new ActionRowBuilder().addComponents(...buttons.slice(i, i + 5)));
  }
  return rows;
}

/** Das Hauptmenü zeigt die Kategorien, nicht mehr jeden einzelnen Punkt. */
function buildMainMenu({ userId, isAdmin = false }) {
  const groups = GROUPS.filter((g) => entriesOfGroup(g.id, isAdmin).length > 0);

  const embed = new EmbedBuilder()
    .setTitle('🏠 Hauptmenü')
    .setDescription(groups.map((g) => {
      const inside = entriesOfGroup(g.id, isAdmin).map((e) => e.label).join(', ');
      return `${g.emoji} **${g.label}** — ${g.description}\n_${inside}_`;
    }).join('\n\n'))
    .setFooter({ text: 'Wähle einen Bereich.' })
    .setColor(0x5865f2);

  const buttons = groups.map((g) =>
    new ButtonBuilder()
      .setCustomId(`grp|${g.id}|${userId}`)
      .setLabel(g.label).setEmoji(g.emoji)
      .setStyle(ButtonStyle.Primary));

  return { embeds: [embed], components: rowsOf(buttons) };
}

/**
 * Die Auswahl innerhalb einer Kategorie. Unbekannte IDs landen im Hauptmenü,
 * damit alte Knöpfe nach einer Umbenennung nicht ins Leere laufen.
 */
function buildGroupView(groupId, { userId, isAdmin = false }) {
  const group = groupById.get(groupId);
  if (!group) return buildMainMenu({ userId, isAdmin });

  const entries = entriesOfGroup(groupId, isAdmin);

  const embed = new EmbedBuilder()
    .setTitle(`${group.emoji} ${group.label}`)
    .setDescription(entries.map((e) => `${e.emoji} **${e.label}** — ${e.description}`).join('\n'))
    .setFooter({ text: 'Zurück geht es über 🏠 Hauptmenü.' })
    .setColor(0x5865f2);

  const rows = rowsOf(entries.map((e) => entryButton(e, userId)));
  rows.push(new ActionRowBuilder().addComponents(ui.homeButton(userId)));

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

module.exports = {
  ENTRIES, GROUPS, getEntry, visibleEntries, entriesOfGroup,
  buildMainMenu, buildGroupView, buildEntryView,
};
