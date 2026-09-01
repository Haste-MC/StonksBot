const { EmbedBuilder } = require('discord.js');
const db = require('../db');
const ui = require('../ui');
const { buildMainMenu, buildGroupView, buildEntryView, ENTRIES, GROUPS } = require('../menu');
const income = require('../income');
const jobs = require('../jobs');
const level = require('../level');
const patchnotes = require('../patchnotes');
const accounts = require('../accounts');
const banking = require('../banking');
const robbery = require('../robbery');
const roleIncome = require('../roleIncome');
const identity = require('../identity');
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
    names: ['daily', 'täglich'],
    info: 'Täglicher Bonus (200–2000)',
    run: async ({ guildId, userId }) => {
      const symbol = await getSymbol(guildId);
      const res = await income.daily(guildId, userId);
      if (!res.ok) {
        return { text: `⏳ Schon abgeholt. Neuer Bonus in **${income.formatRemaining(res.remainingMs)}**.` };
      }
      return {
        text: `${income.lines.format(res.flavor, money(symbol, res.amount))}\n` +
          `💰 Kontostand: ${money(symbol, res.balance.total)}`,
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
    names: ['top', 'reich', 'reichste'],
    info: 'Geld-Rangliste: !top [bar|bank]',
    run: async ({ guildId, userId, args }) =>
      ({ view: await ui.buildTopView({ guildId, userId, sort: args[0] }) }),
  },
  {
    names: ['rob', 'ausrauben', 'überfall', 'ueberfall'],
    info: 'Jemanden ausrauben: !rob <@spieler|id>',
    run: async ({ guildId, userId, args, prefix }) => {
      const symbol = await getSymbol(guildId);
      const raw = String(args[0] ?? '').replace(/[<@!>]/g, '').trim();
      if (!raw) return { text: `❓ Wen denn? Beispiel: \`${prefix}rob @spieler\`` };

      // Auf das Konto übersetzen: Ein Fluxer-Ziel kann verknüpft sein.
      const victim = identity.account('fluxer', raw) === `fx:${raw}` && /^\d{17,20}$/.test(raw)
        ? raw : identity.account('fluxer', raw);

      const res = await robbery.rob(guildId, userId, victim);
      if (!res.ok) return { text: robProblem(res, symbol, prefix) };

      return {
        text: res.success
          ? `🎭 **Erfolg!** Du hast **${money(symbol, res.amount)}** erbeutet.\n` +
            `_Chance war ${Math.round(res.chance * 100)} %._`
          : `🚨 **Erwischt!** Du zahlst **${money(symbol, res.penalty)}** Schmerzensgeld.\n` +
            `_Chance war ${Math.round(res.chance * 100)} % – Bargeld auf der Bank ist sicher._`,
      };
    },
  },
  {
    names: ['einkommen', 'income', 'collect'],
    info: 'Rollen-Einkommen abholen',
    run: async ({ guildId, userId }) => {
      const symbol = await getSymbol(guildId);
      const roles = await roleIncome.rolesOf(require('../relay').discordClient?.(), userId);
      const res = await roleIncome.claim(guildId, userId, roles);

      if (!res.ok) {
        if (res.reason === 'disabled') return { text: 'ℹ️ Rollen-Einkommen ist nicht eingerichtet.' };
        if (res.reason === 'no_roles') {
          return {
            text: '🎭 Du hast keine Rolle, die Einkommen bringt.\n' +
              '_Fluxer-Spieler brauchen dafür ein verknüpftes Discord-Konto (`!link`)._',
          };
        }
        return {
          text: `⏳ Schon abgeholt. Nächstes Einkommen in **${income.formatRemaining(res.remainingMs)}**.`,
        };
      }
      return {
        text: `💼 **${money(symbol, res.amount)}** Rollen-Einkommen erhalten.\n` +
          `Kontostand: ${money(symbol, res.balance.total)}`,
      };
    },
  },
  {
    names: ['einzahlen', 'deposit', 'dep'],
    info: 'Geld auf die Bank bringen: !einzahlen <betrag|alles>',
    run: async ({ guildId, userId, args }) => {
      const symbol = await getSymbol(guildId);
      const res = await banking.deposit(guildId, userId, args[0] ?? 'alles');
      if (!res.ok) return { text: bankProblem(res, symbol, 'einzahlen') };
      return {
        text: `🏦 **${money(symbol, res.amount)}** eingezahlt – vor Überfällen sicher.\n` +
          `Bar: ${money(symbol, res.balance.cash)} · Bank: ${money(symbol, res.balance.bank)}`,
      };
    },
  },
  {
    names: ['abheben', 'withdraw', 'wd'],
    info: 'Geld von der Bank holen: !abheben <betrag|alles>',
    run: async ({ guildId, userId, args }) => {
      const symbol = await getSymbol(guildId);
      const res = await banking.withdraw(guildId, userId, args[0] ?? 'alles');
      if (!res.ok) return { text: bankProblem(res, symbol, 'abheben') };
      return {
        text: `💵 **${money(symbol, res.amount)}** abgehoben.\n` +
          `Bar: ${money(symbol, res.balance.cash)} · Bank: ${money(symbol, res.balance.bank)}\n` +
          `_Bargeld kann geraubt werden – nur einlagern, was du brauchst._`,
      };
    },
  },
  {
    names: ['link', 'verknuepfen', 'verknüpfen'],
    info: 'Discord-Konto verknüpfen: !link <discord-id>',
    run: async ({ userId, platformUserId, args, prefix, isAdmin }) => {
      // Admins dürfen fremde Konten reparieren: !link @jemand <discord-id>
      const targetUser = isAdmin && args.length > 1
        ? String(args[0]).replace(/[<@!>]/g, '') : platformUserId;
      const discordId = isAdmin && args.length > 1 ? args[1] : args[0];

      if (!discordId) {
        const st = accounts.status('fluxer', platformUserId);
        return {
          text: st.linked
            ? `🔗 Verknüpft mit Discord-Konto \`${st.account}\`.\n` +
              `Aufheben mit \`${prefix}unlink\`.`
            : '🔓 Noch nicht verknüpft. Dein Fortschritt liegt auf einem eigenen Konto.\n' +
              `Mit \`${prefix}link <deine-discord-id>\` holst du dir deinen Discord-Spielstand ` +
              'dazu – dein bisheriger Fortschritt wird dabei übernommen.',
        };
      }

      const res = await accounts.link('fluxer', targetUser, discordId);
      if (!res.ok) {
        return {
          text: res.reason === 'bad_id'
            ? '❌ Das sieht nicht nach einer Discord-ID aus (17–20 Ziffern).'
            : `ℹ️ Bereits mit \`${res.account}\` verknüpft.`,
        };
      }

      const parts = Object.entries(res.moved)
        .map(([k, v]) => `${k}: ${v}`).join(', ');
      return {
        text: `✅ Verknüpft mit Discord-Konto \`${res.account}\`.\n` +
          (res.carried > 0
            ? `💰 ${res.carried.toLocaleString('de-DE')} Guthaben übertragen.\n`
            : res.carried < 0
              ? `🔻 ${Math.abs(res.carried).toLocaleString('de-DE')} Schulden übernommen.\n`
              : '') +
          (parts ? `📦 Übernommen: ${parts}` : 'Es gab noch keinen Fortschritt zu übernehmen.'),
      };
    },
  },
  {
    names: ['unlink', 'trennen'],
    info: 'Verknüpfung aufheben',
    run: ({ platformUserId, isAdmin, args }) => {
      const target = isAdmin && args.length
        ? String(args[0]).replace(/[<@!>]/g, '') : platformUserId;
      const res = accounts.unlink('fluxer', target);
      return {
        text: res.ok
          ? '🔓 Verknüpfung aufgehoben. Dein Fortschritt bleibt beim Discord-Konto.'
          : 'ℹ️ Da war keine Verknüpfung.',
      };
    },
  },
  {
    names: ['konto', 'account'],
    info: 'Kontostatus und Verknüpfung',
    run: ({ platformUserId, prefix }) => {
      const st = accounts.status('fluxer', platformUserId);
      const name = identity.nameOf(st.account);
      return {
        text: `👤 Konto: \`${st.account}\`${name ? ` (${name})` : ''}\n` +
          `🔗 ${st.linked ? 'mit Discord verknüpft' : 'nicht verknüpft'}\n` +
          `💰 Geldquelle: ${st.viaUnb ? 'UnbelievaBoat (Discord)' : 'lokales Wallet'}` +
          (st.linked ? '' : `\n\n_Mit \`${prefix}link <discord-id>\` holst du deinen Discord-Spielstand._`),
      };
    },
  },
  {
    names: ['invest', 'investieren'],
    info: 'Wertpapier kaufen: !invest <kürzel> <stück|für betrag>',
    run: async ({ guildId, userId, args, prefix }) => {
      const wallstreet = require('../wallstreet');
      const symbol = String(args[0] ?? '').toUpperCase();
      if (!symbol) {
        return { text: `❓ Was denn? Beispiel: \`${prefix}invest HAST 10\` oder ` +
          `\`${prefix}invest RUBI für 20000\` (Kürzel siehe \`${prefix}boerse\`).` };
      }

      await wallstreet.advance(guildId).catch(() => {});
      const quote = wallstreet.quote(guildId, symbol);
      if (!quote) return { text: `❌ **${symbol}** wird bei uns nicht gehandelt.` };

      const rest = args.slice(1).join(' ').toLowerCase();
      const digits = Math.floor(Number(rest.replace(/[^\d]/g, '')));
      let shares = digits;

      if (/^(für|fuer|for)\b/.test(rest)) {
        shares = wallstreet.sharesFor(quote.price, digits);
      } else if (['alles', 'all', 'max'].includes(rest.trim())) {
        const balance = await require('../unb').getBalance(guildId, userId);
        shares = wallstreet.sharesFor(quote.price, balance.total);
      }

      const currency = await getSymbol(guildId);
      const res = await wallstreet.buy(guildId, userId, symbol, shares);
      if (!res.ok) return { text: marketProblem(res, currency) };

      return {
        text: `🛒 **${res.shares.toLocaleString('de-DE')}× ${res.quote.symbol}** ` +
          `zu ${money(currency, res.price)} gekauft.\n` +
          `Gesamt ${money(currency, res.total)} (davon ${money(currency, res.fee)} Gebühr) · ` +
          `Kontostand: ${money(currency, res.newBalance.total)}`,
      };
    },
  },
  {
    names: ['verkaufe', 'verkaufen', 'sell'],
    info: 'Wertpapier verkaufen: !verkaufe <kürzel> [stück|alles]',
    run: async ({ guildId, userId, args, prefix }) => {
      const wallstreet = require('../wallstreet');
      const symbol = String(args[0] ?? '').toUpperCase();
      if (!symbol) {
        return { text: `❓ Was denn? Beispiel: \`${prefix}verkaufe HAST alles\`.` };
      }

      await wallstreet.advance(guildId).catch(() => {});
      const rest = (args[1] ?? 'alles').toLowerCase();
      const shares = ['alles', 'all', 'max'].includes(rest)
        ? null : Math.floor(Number(rest.replace(/[^\d]/g, '')));

      const currency = await getSymbol(guildId);
      const res = await wallstreet.sell(guildId, userId, symbol, shares);
      if (!res.ok) return { text: marketProblem(res, currency) };

      return {
        text: `📤 **${res.shares.toLocaleString('de-DE')}× ${res.quote.symbol}** ` +
          `zu ${money(currency, res.price)} verkauft.\n` +
          `Erlös ${money(currency, res.net)} (nach ${money(currency, res.fee)} Gebühr) · ` +
          `${res.profit >= 0 ? '📈 Gewinn' : '📉 Verlust'} ` +
          `${res.profit >= 0 ? '+' : ''}${res.profit.toLocaleString('de-DE')} · ` +
          `Kontostand: ${money(currency, res.newBalance.total)}`,
      };
    },
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

/**
 * Befehlsnamen für die Menüpunkte und Kategorien.
 *
 * Bewusst hier und nicht in der Menü-Registry: Die Registry teilen sich beide
 * Branches, Textbefehle gibt es aber nur auf Fluxer. Fehlt ein Eintrag, wird
 * einfach seine ID als Befehl benutzt – ein neuer Menüpunkt ist also sofort
 * erreichbar, auch ohne Eintrag hier.
 */
const ENTRY_COMMANDS = {
  new: ['shop', 'neuwagen'],
  brands: ['marken'],
  used: ['gebraucht', 'gebrauchtwagen'],
  garage: ['garage'],
  werkstatt: ['werkstatt', 'reparieren', 'repair'],
  boerse: ['boerse', 'börse', 'aktien', 'markt2'],
  depot: ['depot', 'portfolio'],
  listings: ['inserate'],
  property: ['markt', 'immobilienmarkt'],
  estate: ['besitz', 'meinbesitz'],
  jobs: ['jobs', 'arbeitsamt'],
  gear: ['ausruestung', 'ausrüstung', 'gear'],
  casino: ['casino'],
  auktion: ['auktion', 'auktionshaus'],
  inbox: ['postfach', 'nachrichten'],
  balance: ['geld', 'guthaben', 'balance'],
  profil: ['profil', 'profile'],
  leaderboard: ['rangliste', 'leaderboard', 'top'],
};

const GROUP_COMMANDS = {
  cars: ['fahrzeuge'],
  estate: ['immobilien'],
  work: ['arbeit'],
  fun: ['zocken'],
  me: ['ich'],
};

/** Erzeugt je einen Befehl pro Kategorie und pro Menüpunkt. */
function generated() {
  const groups = GROUPS.map((g) => ({
    names: GROUP_COMMANDS[g.id] ?? [g.id],
    info: `${g.emoji} ${g.description}`,
    kind: 'group',
    run: ({ userId }) => ({ view: buildGroupView(g.id, { userId }) }),
  }));

  const entries = ENTRIES.map((e) => ({
    names: ENTRY_COMMANDS[e.id] ?? [e.id],
    info: `${e.emoji} ${e.description}`,
    kind: 'entry',
    group: e.group,
    run: ({ guildId, userId, args }) =>
      entry(e.id, { guildId, userId, page: Number(args[0]) || 1 }),
  }));

  return [...groups, ...entries];
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

function robProblem(res, symbol, prefix) {
  switch (res.reason) {
    case 'self': return '🙃 Dich selbst auszurauben bringt wenig.';
    case 'cooldown':
      return `⏳ Lass etwas Gras drüber wachsen – nächster Versuch in **${income.formatRemaining(res.remainingMs)}**.`;
    case 'victim_broke':
      return `🪹 Da ist nichts zu holen (unter ${money(symbol, res.needed)} Bargeld).`;
    case 'no_cash':
      return '👛 Ohne eigenes Bargeld kein Überfall – du könntest die Strafe nicht zahlen.';
    default: return '❌ Der Überfall ging schief.';
  }
}

function marketProblem(res, symbol) {
  switch (res.reason) {
    case 'unknown_symbol': return '❌ Diesen Wert gibt es an unserer Börse nicht.';
    case 'bad_amount': return '❓ Wie viele Stück denn? Sag eine Zahl über null.';
    case 'too_many': return `📦 Höchstens ${res.max.toLocaleString('de-DE')} Stück auf einmal.`;
    case 'nothing_held': return 'ℹ️ Davon besitzt du nichts.';
    case 'not_enough_shares':
      return `📉 So viele hast du nicht – nur ${res.have.toLocaleString('de-DE')} Stück.`;
    case 'insufficient_funds':
      return `💸 Zu wenig Geld: Der Auftrag kostet ${money(symbol, res.needed)}, ` +
        `du hast ${money(symbol, res.have)}.`;
    default: return '❌ Der Auftrag ist nicht durchgegangen.';
  }
}

function bankProblem(res, symbol, was) {
  switch (res.reason) {
    case 'bad_amount':
      return `❌ Wie viel? Beispiel: \`!${was} 5000\` oder \`!${was} alles\`.`;
    case 'no_cash': return '👛 Du hast kein Bargeld dabei.';
    case 'no_bank': return '🏦 Auf deiner Bank liegt nichts.';
    case 'not_enough_cash':
      return `💸 So viel Bargeld hast du nicht – nur ${money(symbol, res.have)}.`;
    case 'not_enough_bank':
      return `🏦 So viel liegt nicht auf der Bank – nur ${money(symbol, res.have)}.`;
    default: return '❌ Das hat nicht geklappt.';
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

/**
 * Alle Befehle: erst die handgeschriebenen Sonderfälle, dann die aus der
 * Menü-Registry erzeugten. Die Reihenfolge entscheidet bei Namensgleichheit.
 */
const ALL = [...COMMANDS, ...generated()];

/** Die Hilfe wird aus der Befehlsliste erzeugt – so veraltet sie nie. */
function helpView(userId, prefix) {
  const cmd = (c) => `\`${prefix}${c.names[0]}\``;

  // Nach Kategorien sortiert, damit die Liste trotz vieler Befehle lesbar bleibt.
  const sections = GROUPS.map((g) => {
    const group = ALL.find((c) => c.kind === 'group' && GROUP_COMMANDS[g.id]?.includes(c.names[0]));
    const inside = ALL.filter((c) => c.kind === 'entry' && c.group === g.id);
    return `${g.emoji} **${g.label}** ${group ? cmd(group) : ''}\n` +
      `　${inside.map(cmd).join(' · ')}`;
  });

  const basics = COMMANDS.map((c) => `${cmd(c)} — ${c.info}`);

  const embed = new EmbedBuilder()
    .setTitle('❓ Hilfe')
    .setColor(0x5865f2)
    .setDescription(
      'Ein kleines Wirtschaftsspiel: Autos, Immobilien, Jobs, Casino und Auktionen.\n\n' +
      `**Grundlagen**\n${basics.join('\n')}\n\n` +
      `**Bereiche**\n${sections.join('\n\n')}`)
    .setFooter({
      text: 'Menüs bedienst du mit den Reaktionen unter der Nachricht.',
    });
  return { embeds: [embed], components: [] };
}

/** Sucht den Befehl zu einem Namen. */
function find(name) {
  const key = String(name || '').toLowerCase();
  return ALL.find((c) => c.names.includes(key)) ?? null;
}

module.exports = { COMMANDS, ALL, generated, find, helpView };
