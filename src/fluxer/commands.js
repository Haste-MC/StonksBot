const { EmbedBuilder } = require('discord.js');
const db = require('../db');
const ui = require('../ui');
const { buildMainMenu, buildEntryView } = require('../menu');
const income = require('../income');
const jobs = require('../jobs');
const level = require('../level');
const patchnotes = require('../patchnotes');
const { getSymbol } = require('../currency');
const { buy } = require('../purchase');
const { money } = require('../ui');

/**
 * ===========================================================================
 *  TEXTBEFEHLE
 * ===========================================================================
 *
 * Fluxer hat keine Slash-Commands, also läuft der Einstieg über einen Präfix
 * (Standard `!`). Die Befehle bauen dieselben Ansichten wie die Discord-
 * Version – gerendert wird über render.js als Embed mit Reaktionen.
 *
 * Ein Befehl liefert entweder
 *   { view }   -> Ansicht mit Reaktionen (Menü)
 *   { text }   -> einfache Textantwort
 */

/** Ein Eintrag: Namen (inkl. Synonyme), Beschreibung, Handler. */
const COMMANDS = [
  {
    names: ['hilfe', 'help'],
    info: 'Diese Übersicht',
    run: ({ userId, prefix }) => ({ view: helpView(userId, prefix) }),
  },
  {
    names: ['menu', 'menü', 'start'],
    info: 'Das Hauptmenü',
    run: ({ userId, guildId }) => {
      const news = patchnotes.deliver(guildId, userId);
      return { view: buildMainMenu({ userId }), note: news };
    },
  },
  {
    names: ['shop', 'autos', 'neuwagen'],
    info: 'Neuwagen kaufen',
    run: ({ guildId, userId, args }) =>
      entry('new', { guildId, userId, page: Number(args[0]) || 1 }),
  },
  {
    names: ['garage'],
    info: 'Deine Autos',
    run: ({ guildId, userId, args }) =>
      entry('garage', { guildId, userId, page: Number(args[0]) || 1 }),
  },
  {
    names: ['geld', 'balance', 'guthaben'],
    info: 'Dein Kontostand',
    run: ({ guildId, userId }) => entry('balance', { guildId, userId }),
  },
  {
    names: ['profil', 'profile'],
    info: 'Dein Steckbrief',
    run: async ({ guildId, userId }) => ({ view: await ui.buildProfileView({ guildId, userId }) }),
  },
  {
    names: ['daily', 'täglich'],
    info: 'Täglicher Bonus',
    run: async ({ guildId, userId }) => {
      const symbol = await getSymbol(guildId);
      const res = await income.daily(guildId, userId);
      if (!res.ok) {
        return { text: `⏳ Schon abgeholt. Neuer Bonus in **${income.formatRemaining(res.remainingMs)}**.` };
      }
      return {
        text: `💰 **+${money(symbol, res.amount)}** Tagesbonus!\n` +
          `Neuer Kontostand: ${money(symbol, res.balance.total)}`,
      };
    },
  },
  {
    names: ['work', 'arbeiten'],
    info: 'Eine Schicht arbeiten',
    run: async ({ guildId, userId, prefix }) => {
      const symbol = await getSymbol(guildId);
      const res = await jobs.work(guildId, userId);
      if (!res.ok) return { text: workProblem(res, prefix, symbol) };
      const l = level.progress(db.getStats(guildId, userId).xp);
      return {
        text: `${res.job.emoji} **${res.job.title}** – Schicht erledigt!\n` +
          `Verdienst: **${money(symbol, res.amount)}** · Kontostand: ${money(symbol, res.balance.total)}\n` +
          `🏆 Level ${l.level}` +
          (res.broken ? `\n🔧 Dabei ist kaputtgegangen: **${res.broken.name}**` : ''),
      };
    },
  },
  {
    names: ['jobs', 'arbeitsamt'],
    info: 'Stellenangebote',
    run: ({ guildId, userId }) => entry('jobs', { guildId, userId }),
  },
  {
    names: ['kaufen', 'buy'],
    info: 'Auto kaufen: !kaufen <id>',
    run: async ({ guildId, userId, args, prefix }) => {
      const id = Number(args[0]);
      if (!id) return { text: `❌ Welches Auto? Beispiel: \`${prefix}kaufen 42\` (IDs stehen im \`${prefix}shop\`).` };
      const symbol = await getSymbol(guildId);
      const res = await buy(guildId, userId, id, 1);
      if (!res.ok) return { text: buyProblem(res, symbol) };
      return {
        text: `✅ **${res.item.name}** gekauft für ${money(symbol, res.totalPrice)}.\n` +
          `Kontostand: ${money(symbol, res.newBalance.total)}`,
      };
    },
  },
];

/** Menüpunkt-Ansicht bauen (async, weil die Builder DB/Guthaben lesen). */
async function entry(id, ctx) {
  return { view: await buildEntryView(id, ctx) };
}

function workProblem(res, prefix, symbol) {
  switch (res.reason) {
    case 'unemployed':
      return `💼 Du hast keinen Job. Schau ins Arbeitsamt: \`${prefix}jobs\``;
    case 'cooldown':
      return `⏳ Pause! Nächste Schicht in **${income.formatRemaining(res.remainingMs)}**.`;
    case 'daily_limit':
      return `😴 Feierabend – ${res.done}/${res.max} Schichten heute. ` +
        `Weiter geht's in **${income.formatRemaining(res.resetMs)}**.`;
    case 'requirements':
      return `🧰 Dir fehlt: **${res.missing.join(', ')}**`;
    default:
      return '❌ Das hat nicht geklappt.';
  }
}

function buyProblem(res, symbol) {
  switch (res.reason) {
    case 'not_found': return '❌ Dieses Auto gibt es nicht.';
    case 'already_owned': return '🚗 Du besitzt dieses Modell bereits.';
    case 'out_of_stock': return '📦 Ausverkauft.';
    case 'no_garage':
      return `🅿️ Kein freier Stellplatz – ${res.used}/${res.capacity} belegt.`;
    case 'insufficient_funds':
      return `💸 Zu wenig Geld: du brauchst ${money(symbol, res.needed)}, hast ${money(symbol, res.have)}.`;
    default: return '❌ Kauf fehlgeschlagen.';
  }
}

/** Die Hilfe wird aus der Befehlsliste erzeugt – so veraltet sie nie. */
function helpView(userId, prefix) {
  const lines = COMMANDS.map((c) => `\`${prefix}${c.names[0]}\` — ${c.info}`);
  const embed = new EmbedBuilder()
    .setTitle('❓ Hilfe')
    .setColor(0x5865f2)
    .setDescription(
      'Ein kleines Wirtschaftsspiel: Autos, Immobilien, Jobs, Casino und Auktionen.\n\n' +
      `**Befehle**\n${lines.join('\n')}`)
    .setFooter({
      text: 'Menüs bedienst du mit den Reaktionen unter der Nachricht.',
    });
  return { embeds: [embed], components: [] };
}

/** Sucht den Befehl zu einem Namen. */
function find(name) {
  const key = String(name || '').toLowerCase();
  return COMMANDS.find((c) => c.names.includes(key)) ?? null;
}

module.exports = { COMMANDS, find, helpView };
