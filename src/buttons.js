const {
  EmbedBuilder, MessageFlags, PermissionFlagsBits,
  ModalBuilder, TextInputBuilder, TextInputStyle, ActionRowBuilder,
} = require('discord.js');
const casino = require('./casino');
const casinoPlay = require('./casinoPlay');
const casinoUi = require('./casinoUi');
const db = require('./db');
const { buy, buyUsed } = require('./purchase');
const {
  buildDetailView, buildPropertyDetailView, buildProfileView, buildLeaderboardView,
  buildAuctionView, buildCollectionView, buildGaragesView, buildInboxView,
  buildTopView, buildRepairView, buildMarketView, buildAssetView, buildDepotView,
  buildFishingView, buildCreatorView, buildPlatformView, buildDealsView,
  buildDecisionView, money,
} = require('./ui');
const { buildMainMenu, buildGroupView, buildEntryView } = require('./menu');
const { getSymbol } = require('./currency');
const jobs = require('./jobs');
const property = require('./property');
const street = require('./street');
const condition = require('./condition');
const identity = require('./identity');
const workshop = require('./workshop');
const wallstreet = require('./wallstreet');
const npc = require('./npc');
const buyers = require('./buyers');
const bills = require('./bills');
const tenants = require('./tenants');
const storage = require('./storage');
const patchnotes = require('./patchnotes');

/** Fehlermeldungen für Anzeigen privater Anbieter. */
function npcFailure(result, symbol) {
  const texts = {
    not_found: '❌ Diese Anzeige gibt es nicht mehr.',
    expired: '⌛ Die Anzeige ist abgelaufen — der Verkäufer hat sich anders entschieden.',
    not_for_sale: '❌ Das Objekt wird nur vermietet, nicht verkauft.',
    not_for_rent: '❌ Das Objekt wird nur verkauft, nicht vermietet.',
    already_owned: '🚗 Du besitzt dieses Modell bereits.',
    already_renting: 'ℹ️ Das mietest du schon.',
    no_garage: `🅿️ Keine freien Stellplätze — ${result.used}/${result.capacity} belegt.`,
    insufficient_funds:
      `💸 Zu wenig Geld. Du brauchst ${money(symbol, result.needed ?? 0)}, ` +
      `hast aber nur ${money(symbol, result.have ?? 0)}.`,
  };
  return texts[result.reason] ?? '❌ Das hat nicht geklappt.';
}

/**
 * Rechnet fällige Miete ab und meldet einen Rauswurf.
 *
 * Wird "faul" an den Stellen aufgerufen, an denen Miete oder Stellplätze
 * eine Rolle spielen – so braucht es keinen Hintergrundjob, und niemand
 * zahlt Miete für Tage, an denen er den Bot gar nicht benutzt hat... doch,
 * genau das passiert: die Tage werden nachberechnet, sobald er zurückkommt.
 */
async function settle(interaction) {
  const guildId = interaction.guildId;
  const userId = interaction.user.id;
  const symbol = await getSymbol(guildId);
  const lines = [];

  const rentResult = await property.settleRent(guildId, userId)
    .catch(() => ({ status: 'none' }));

  if (rentResult.status === 'evicted') {
    lines.push(
      `🚪 **Zwangsräumung:** Du konntest ${money(symbol, rentResult.amount)} Miete für ` +
      `${rentResult.days} Tage nicht zahlen und hast **${rentResult.rental.name}** verloren.`);
  } else if (rentResult.status === 'paid') {
    lines.push(
      `🏠 ${money(symbol, rentResult.amount)} Miete für ${rentResult.days} ` +
      `${rentResult.days === 1 ? 'Tag' : 'Tage'} abgebucht (${rentResult.rental.name})` +
      (rentResult.landlordId ? ` — an <@${rentResult.landlordId}>.` : '.'));
  }

  // Serverweite Auktion faul schließen; eigene Zuschläge kurz melden
  // (Details liegen ohnehin im Postfach).
  const auctionWins = await storage.settle(guildId, userId).catch(() => []);
  for (const w of auctionWins) {
    lines.push(`🏬 **Zuschlag:** ${w.label} für ${money(symbol, w.price)} — noch verschlossen, ` +
      'öffne sie im Auktionshaus unter „Meine Garagen".');
  }

  // Was draußen steht, kann über Nacht etwas abbekommen haben.
  const streetResult = await street.settle(guildId, userId).catch(() => ({ events: [] }));
  const streetNotice = street.summarize(streetResult, symbol);
  if (streetNotice) lines.push(streetNotice);

  // Haben sich Interessenten für die eigenen Inserate gemeldet?
  const market = await buyers.settleListings(guildId, userId)
    .catch(() => ({ sold: [], offers: [] }));

  if (market.sold.length) {
    lines.push('💰 **Verkauft:**\n' + market.sold.map((s) =>
      `• ${s.name} für ${money(symbol, s.price)} an ${s.buyer}`).join('\n'));
  }
  if (market.offers.length) {
    lines.push(
      `🤝 **${market.offers.length} neue${market.offers.length === 1 ? 's' : ''} ` +
      `Kaufangebot${market.offers.length === 1 ? '' : 'e'}** im Postfach.`);
  }

  // Mieteinnahmen von NPC-Mietern, Ein- und Auszüge.
  const landlord = await tenants.settleLandlord(guildId, userId)
    .catch(() => ({ income: 0, movedIn: [], movedOut: [] }));

  if (landlord.income > 0) {
    lines.push(`🏠 **Mieteinnahmen:** ${money(symbol, landlord.income)} von deinen Mietobjekten.`);
  }
  for (const m of landlord.movedIn) {
    lines.push(`🔑 **${m.tenant}** ist in **${m.name}** eingezogen.`);
  }
  for (const m of landlord.movedOut) {
    lines.push(`🚚 **${m.tenant}** ist aus **${m.name}** ausgezogen — wieder frei.`);
  }

  // Überfällige Rechnungen anmahnen.
  const dunned = bills.dun(guildId, userId);
  if (dunned.length) {
    lines.push('🧾 **Mahnung:**\n' + dunned.map((d) =>
      `• ${d.original.title} — Frist verstrichen, ` +
      `${money(symbol, d.fee)} Mahngebühr aufgeschlagen.`).join('\n'));
  }

  // Danach prüfen, ob die Stellplätze noch reichen.
  const cap = await property.enforceCapacity(guildId, userId).catch(() => ({ status: 'ok' }));

  if (cap.status === 'grace_started') {
    lines.push(
      `🅿️ **Zu wenig Stellplätze:** ${cap.used} Autos, aber nur ${cap.capacity} Plätze.\n` +
      `Du hast **${cap.days} Tage**, um ${cap.excess} ${cap.excess === 1 ? 'Auto' : 'Autos'} ` +
      'zu verkaufen oder mehr Platz zu besorgen — danach werden zufällige Fahrzeuge ' +
      'zwangsverkauft (40–95 % vom Kaufpreis).');
  } else if (cap.status === 'grace') {
    const days = Math.floor(cap.remainingMs / property.DAY_MS);
    const hours = Math.floor((cap.remainingMs % property.DAY_MS) / 3600000);
    lines.push(
      `⏳ **Noch ${days} Tage ${hours} h**, um ${cap.excess} ` +
      `${cap.excess === 1 ? 'Auto' : 'Autos'} unterzubringen ` +
      `(${cap.used}/${cap.capacity} Plätze belegt).`);
  } else if (cap.status === 'sold') {
    lines.push(
      '🔨 **Frist abgelaufen — zwangsverkauft:**\n' +
      cap.sold.map((c) =>
        `• ${c.name} für ${money(symbol, c.amount)} ` +
        `(${c.percent} % vom Zeitwert bei ${c.condition} % Zustand)`).join('\n') +
      `\nErlös insgesamt: ${money(symbol, cap.total)}`);
  }

  return lines.length ? lines.join('\n\n') : null;
}

/**
 * Rechnet alles Laufende des Creator-Netzwerks ab: YouTube-Katalog, Merch und
 * abgelaufene Verträge. Läuft beim Öffnen der Ansichten (faule Abrechnung, §4)
 * und gibt eine fertige Notiz zurück – oder null, wenn nichts passiert ist.
 */
async function settleCreator(guildId, userId) {
  const creator = require('./creator');
  const symbol = await getSymbol(guildId);
  const lines = [];

  const catalog = await creator.settle(guildId, userId).catch(() => null);
  if (catalog) {
    lines.push(`📼 Dein Katalog lief weiter: **${catalog.views.toLocaleString('de-DE')}** ` +
      `Aufrufe, **${money(symbol, catalog.amount)}**.`);
  }

  const merch = await creator.settleMerch(guildId, userId).catch(() => null);
  if (merch) lines.push(`👕 Merch verkauft: **${money(symbol, merch.amount)}**.`);

  // Abgelaufene Entscheidungen wirken jetzt – Schweigen ist auch eine Wahl.
  for (const gone of await require('./decisions').settle(guildId, userId).catch(() => [])) {
    lines.push(`⚠️ **${gone.decision.emoji} ${gone.decision.title}** – du hast nicht ` +
      `reagiert.\n_${gone.outcome.text}_`);
  }

  const deals = await creator.settleDeals(guildId, userId).catch(() => null);
  if (deals?.failed) {
    lines.push(`⚠️ Vertrag mit **${deals.failed.brand}** geplatzt – Frist gerissen. ` +
      `Das kostet **${money(symbol, deals.failed.penalty)}**.`);
  }

  return lines.length ? lines.join('\n') : null;
}

/** Menüpunkte, bei denen Miete und Stellplätze relevant sind. */
const RENT_RELEVANT = new Set([
  'property', 'estate', 'garage', 'werkstatt', 'new', 'used', 'inbox', 'listings', 'auktion',
]);

/** Baut die offene Menü-Nachricht neu, damit Änderungen sofort sichtbar sind. */
async function refresh(interaction, entryId) {
  return interaction.message
    .edit(await buildEntryView(entryId, context(interaction)))
    .catch(() => {});
}

/** Fehlermeldungen rund um Immobilien. */
function estateFailure(result, symbol) {
  const texts = {
    not_found: '❌ Dieses Objekt gibt es nicht.',
    not_rentable: '❌ Dieses Objekt wird nicht vermietet.',
    already_owned: 'ℹ️ Das gehört dir bereits.',
    already_renting: 'ℹ️ Das mietest du bereits.',
    already_offered: 'ℹ️ Das bietest du bereits an.',
    not_owned: '❌ Das gehört dir nicht.',
    not_landlord: '❌ Das ist nicht dein Angebot.',
    own_offer: '❌ Du kannst nicht bei dir selbst mieten.',
    self_rented: '❌ Da wohnst du selbst — kündige erst deinen Vertrag.',
    unavailable: '🚫 Schon vermietet.',
    out_of_stock: '🚫 Alle Exemplare sind vergeben.',
    insufficient_funds:
      `💸 Zu wenig Geld. Du brauchst ${money(symbol, result.needed ?? 0)}, ` +
      `hast aber nur ${money(symbol, result.have ?? 0)}.`,
  };
  return texts[result.reason] ?? '❌ Das hat nicht geklappt.';
}

/** Ergebnis einer Schicht als Text bzw. Embed. */
async function shiftResult(interaction, result) {
  const symbol = await getSymbol(interaction.guildId);

  if (!result.ok) {
    if (result.reason === 'cooldown') {
      const min = Math.ceil(result.remainingMs / 60000);
      return { content: `⏳ Noch ${min} min Pause, dann kannst du wieder arbeiten.` };
    }
    if (result.reason === 'daily_limit') {
      const h = Math.floor(result.resetMs / 3600000);
      const m = Math.floor((result.resetMs % 3600000) / 60000);
      return {
        content: `🛌 Feierabend! Du hast heute schon ${result.done} Schichten gearbeitet ` +
          `(${result.done * jobs.HOURS_PER_SHIFT} Stunden). ` +
          `Neue Schichten in ${h} h ${m} min.`,
      };
    }
    const texts = {
      unemployed: '❌ Du hast keine Anstellung. Schau ins Arbeitsamt.',
      requirements: `🔒 Du erfüllst die Voraussetzungen nicht mehr: ${result.missing?.join(', ')}`,
    };
    return { content: texts[result.reason] ?? '❌ Das hat nicht geklappt.' };
  }

  const embed = new EmbedBuilder()
    .setTitle(`${result.job.emoji} Schicht beendet`)
    .setDescription(`Als **${result.job.title}** hast du ${money(symbol, result.amount)} verdient.` +
      (result.levelBonus > 0
        ? `\n🏆 Darin stecken **${money(symbol, result.levelBonus)}** Level-Zuschlag (Level ${result.level}).`
        : ''))
    .addFields(
      { name: 'Bargeld', value: money(symbol, result.balance.cash), inline: true },
      {
        name: 'Heute',
        value: `${result.shiftsToday}/${result.maxShifts} Schichten · ` +
          `${result.shiftsToday * jobs.HOURS_PER_SHIFT} h`,
        inline: true,
      },
      { name: 'Insgesamt verdient', value: money(symbol, result.employment.earned), inline: true },
    )
    .setColor(jobs.TIER_COLOR[result.job.tier] ?? 0x2ecc71);

  if (result.broken?.length) {
    embed.addFields({
      name: '💥 Kaputtgegangen',
      value: result.broken.map((b) =>
        `**${b.name}**${b.price ? ` — Ersatz kostet ${money(symbol, b.price)}` : ''}`).join('\n') +
        '\n_Ohne Ersatz kannst du diesen Job nicht weiter ausüben._',
    });
    embed.setColor(0xe74c3c);
  }

  if (result.promotion) {
    embed.addFields({
      name: '🎉 Befördert!',
      value: `Der Chef hat dich bemerkt: Du bist jetzt ` +
        `**${result.promotion.to.emoji} ${result.promotion.to.title}** ` +
        `— **+${Math.round((result.promotion.to.pay - 1) * 100)} %** auf jede Schicht.`,
    });
    embed.setColor(0xf1c40f);
  } else if (result.rank) {
    embed.setFooter({
      text: `${result.rank.emoji} ${result.rank.title} · ` +
        `Beförderungschance nächste Schicht: ${Math.round((result.nextChance ?? 0) * 100)} %`,
    });
  }

  if (result.shiftsToday >= result.maxShifts) {
    embed.setFooter({ text: 'Das war deine letzte Schicht für heute.' });
  }

  return { embeds: [embed] };
}

function parseId(customId) {
  const [action, ...parts] = customId.split('|');
  return { action, parts };
}

/** Prüft, ob der Klickende "Server verwalten" darf (für adminOnly-Menüs). */
function isAdmin(interaction) {
  return interaction.memberPermissions?.has(PermissionFlagsBits.ManageGuild) ?? false;
}

function context(interaction, page = 1, brand = null) {
  return {
    guildId: interaction.guildId,
    userId: interaction.user.id,
    isAdmin: isAdmin(interaction),
    page,
    brand,
  };
}

const buttons = {
  /** Zurück ins Hauptmenü. */
  async home(interaction) {
    await interaction.update(
      buildMainMenu({ userId: interaction.user.id, isAdmin: isAdmin(interaction) }));
  },

  /** Eine Kategorie des Hauptmenüs öffnen (z.B. 🚗 Fahrzeuge). */
  async grp(interaction, [groupId]) {
    await interaction.update(buildGroupView(groupId, {
      userId: interaction.user.id,
      isAdmin: isAdmin(interaction),
    }));
  },

  /**
   * Einen Menüpunkt öffnen oder darin blättern.
   * Die ID ist entweder `menu|<bereich>|<seite>|<userId>` oder – mit
   * Markenfilter – `menu|new|<seite>|<marke>|<userId>`.
   */
  async menu(interaction, parts) {
    const [entryId, page, ...rest] = parts;
    // Bleibt mehr als die userId übrig, ist es der Markenname.
    const brand = rest.length > 1 ? rest.slice(0, -1).join('|') : null;

    // Vor dem Anzeigen abrechnen, damit Stellplätze und Mietstatus stimmen.
    const settled = RENT_RELEVANT.has(entryId) ? await settle(interaction) : null;
    // Neue Patchnotes einmalig zustellen (idempotent, siehe patchnotes.js).
    const news = patchnotes.deliver(gid(interaction), uid(interaction));
    const notice = [news, settled].filter(Boolean).join('\n\n') || null;

    await interaction.update(
      await buildEntryView(entryId, context(interaction, Number(page) || 1, brand)));

    if (notice) {
      await interaction.followUp({ content: notice, flags: MessageFlags.Ephemeral })
        .catch(() => {});
    }
  },

  /** Detailansicht eines Neuwagens. */
  async det(interaction, [itemId, page]) {
    await interaction.update(await buildDetailView({
      guildId: interaction.guildId, mode: 'new',
      key: Number(itemId), page: Number(page) || 1, userId: interaction.user.id,
    }));
  },

  /** Detailansicht eines Ausrüstungsgegenstands. */
  async gdet(interaction, [itemId, page]) {
    await interaction.update(await buildDetailView({
      guildId: interaction.guildId, mode: 'gear',
      key: Number(itemId), page: Number(page) || 1, userId: interaction.user.id,
    }));
  },

  /** Detailansicht einer Immobilie (Katalog, Verkauf oder Mietangebot). */
  async pdet(interaction, [key, page]) {
    await interaction.update(await buildPropertyDetailView({
      guildId: interaction.guildId, userId: interaction.user.id,
      key, page: Number(page) || 1,
    }));
  },

  /** Kaufangebot annehmen. */
  async oaccept(interaction, [messageId]) {
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    const symbol = await getSymbol(interaction.guildId);
    const result = await buyers.acceptOffer(
      interaction.guildId, interaction.user.id, Number(messageId));

    if (!result.ok) {
      const texts = {
        not_found: '❌ Dieses Angebot gibt es nicht.',
        already_resolved: 'ℹ️ Das hast du schon bearbeitet.',
        expired: '⌛ Das Angebot ist abgelaufen.',
        listing_gone: '❌ Dein Inserat gibt es nicht mehr.',
      };
      await interaction.editReply(texts[result.reason] ?? '❌ Hat nicht geklappt.');
      return refresh(interaction, 'inbox');
    }

    const embed = new EmbedBuilder()
      .setTitle('🤝 Angebot angenommen')
      .setDescription(
        `**${result.listing.name}** ist verkauft — ${result.message.sender} hat gezahlt.`)
      .addFields(
        { name: 'Erlös', value: money(symbol, result.amount), inline: true },
        { name: 'Neues Bargeld', value: money(symbol, result.balance.cash), inline: true },
      )
      .setColor(0x2ecc71);

    await interaction.editReply({ embeds: [embed] });
    return refresh(interaction, 'inbox');
  },

  /** Kaufangebot ablehnen. */
  async odecline(interaction, [messageId]) {
    const result = buyers.declineOffer(
      interaction.guildId, interaction.user.id, Number(messageId));
    await interaction.reply({
      content: result.ok
        ? `❌ Angebot von ${result.message.sender} abgelehnt. Dein Inserat läuft weiter.`
        : 'ℹ️ Dieses Angebot ist nicht mehr offen.',
      flags: MessageFlags.Ephemeral,
    });
    return refresh(interaction, 'inbox');
  },

  /** Rechnung bezahlen. */
  async bpay(interaction, [messageId]) {
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    const symbol = await getSymbol(interaction.guildId);
    const result = await bills.pay(
      interaction.guildId, interaction.user.id, Number(messageId));

    if (!result.ok) {
      const texts = {
        not_found: '❌ Diese Rechnung gibt es nicht.',
        already_resolved: 'ℹ️ Die ist schon bezahlt.',
        insufficient_funds:
          `💸 Zu wenig Geld. Die Rechnung lautet über ${money(symbol, result.needed)}, ` +
          `du hast ${money(symbol, result.have)}.`,
      };
      await interaction.editReply(texts[result.reason] ?? '❌ Hat nicht geklappt.');
      return refresh(interaction, 'inbox');
    }

    await interaction.editReply(
      `🧾 **${result.message.title}** bezahlt — ${money(symbol, result.amount)}. ` +
      `Neues Bargeld: ${money(symbol, result.balance.cash)}.`);
    return refresh(interaction, 'inbox');
  },

  /** Gebrauchtwagen von einem privaten Anbieter kaufen. */
  async nbuy(interaction, [npcId]) {
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    const symbol = await getSymbol(interaction.guildId);
    const result = await npc.buy(interaction.guildId, interaction.user.id, Number(npcId));

    if (!result.ok) return interaction.editReply(npcFailure(result, symbol));

    const l = result.listing;
    // Auch hier kein Urteil: ob der Kauf gut war, verrät der Bot nicht.
    // Wer es wissen will, verkauft weiter und sieht, was er bekommt.
    const embed = new EmbedBuilder()
      .setTitle('✅ Gekauft!')
      .setDescription(`**${l.name}** von ${l.seller} steht jetzt in deiner Garage.`)
      .addFields(
        { name: 'Bezahlt', value: money(symbol, l.npc_price), inline: true },
        { name: 'Zustand', value: condition.labelDetailed(l.npc_condition), inline: true },
      )
      .setColor(0x2ecc71)
      .setFooter({ text: 'Anschauen mit /showcase' });

    if (l.image_url) embed.setThumbnail(l.image_url);
    await interaction.editReply({ embeds: [embed] });
    return refresh(interaction, 'used');
  },

  /** Immobilie von einem privaten Anbieter kaufen. */
  async npbuy(interaction, [npcId]) {
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    const symbol = await getSymbol(interaction.guildId);
    const result = await npc.buy(interaction.guildId, interaction.user.id, Number(npcId));

    if (!result.ok) return interaction.editReply(npcFailure(result, symbol));

    const l = result.listing;
    const embed = new EmbedBuilder()
      .setTitle('🔑 Gekauft!')
      .setDescription(`**${l.name}** von ${l.seller} gehört jetzt dir.`)
      .addFields(
        { name: 'Bezahlt', value: money(symbol, l.npc_price), inline: true },
        { name: 'Listenpreis', value: money(symbol, l.price), inline: true },
      )
      .setColor(0x16a085);

    if (l.image_url) embed.setThumbnail(l.image_url);
    await interaction.editReply({ embeds: [embed] });
    return refresh(interaction, 'property');
  },

  /** Wohnung von einem privaten Anbieter mieten. */
  async nprent(interaction, [npcId]) {
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    const symbol = await getSymbol(interaction.guildId);
    const result = await npc.rent(interaction.guildId, interaction.user.id, Number(npcId));

    if (!result.ok) return interaction.editReply(npcFailure(result, symbol));

    const l = result.listing;
    const embed = new EmbedBuilder()
      .setTitle('🔑 Eingezogen!')
      .setDescription(
        `Du mietest **${l.name}** von ${l.seller}.` +
        (result.previous ? '\nDein alter Vertrag ist damit beendet.' : ''))
      .addFields(
        { name: 'Tagesmiete', value: money(symbol, l.npc_price), inline: true },
        {
          name: 'Stellplätze',
          value: `${result.capacity.used}/${result.capacity.capacity}`,
          inline: true,
        },
      )
      .setFooter({ text: 'Die Miete wird täglich automatisch abgebucht.' })
      .setColor(0x16a085);

    if (l.image_url) embed.setThumbnail(l.image_url);
    await interaction.editReply({ embeds: [embed] });
    return refresh(interaction, 'property');
  },

  /** Immobilie von einem Spieler kaufen. */
  async psale(interaction, [listingId]) {
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    const symbol = await getSymbol(interaction.guildId);
    const result = await buyUsed(
      interaction.guildId, interaction.user.id, Number(listingId));

    if (!result.ok) return interaction.editReply(failureText(result, symbol));

    const embed = new EmbedBuilder()
      .setTitle('🔑 Gekauft!')
      .setDescription(
        `**${result.listing.name}** gehört jetzt dir.\n` +
        `${identity.mention(result.listing.seller_id)} hat ` +
        `${money(symbol, result.price)} erhalten.`)
      .addFields({ name: 'Neues Bargeld', value: money(symbol, result.newBalance.cash) })
      .setColor(0x16a085);
    if (result.listing.image_url) embed.setThumbnail(result.listing.image_url);

    await interaction.editReply({ embeds: [embed] });
    return refresh(interaction, 'property');
  },

  /** Immobilie kaufen. */
  async pbuy(interaction, [itemId]) {
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    const symbol = await getSymbol(interaction.guildId);
    const result = await property.buy(interaction.guildId, interaction.user.id, Number(itemId));

    if (!result.ok) return interaction.editReply(estateFailure(result, symbol));

    const embed = new EmbedBuilder()
      .setTitle('🔑 Gekauft!')
      .setDescription(`**${result.item.name}** gehört jetzt dir.`)
      .addFields(
        { name: 'Preis', value: money(symbol, result.item.price), inline: true },
        { name: 'Neue Stellplätze', value: `${result.capacity.used}/${result.capacity.capacity}`, inline: true },
      )
      .setColor(0x16a085);
    if (result.item.image_url) embed.setThumbnail(result.item.image_url);

    await interaction.editReply({ embeds: [embed] });
    return refresh(interaction, 'property');
  },

  /** Immobilie mieten. */
  async prent(interaction, [itemId]) {
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    const symbol = await getSymbol(interaction.guildId);
    const result = await property.rent(interaction.guildId, interaction.user.id, Number(itemId));

    if (!result.ok) return interaction.editReply(estateFailure(result, symbol));

    const embed = new EmbedBuilder()
      .setTitle('🔑 Eingezogen!')
      .setDescription(
        `Du mietest jetzt **${result.item.name}**.` +
        (result.previous ? `\nDein alter Vertrag über ${result.previous.name} ist beendet.` : ''))
      .addFields(
        { name: 'Tagesmiete', value: money(symbol, result.item.rent), inline: true },
        { name: 'Stellplätze', value: `${result.capacity.used}/${result.capacity.capacity}`, inline: true },
      )
      .setFooter({ text: 'Die Miete wird täglich automatisch abgebucht.' })
      .setColor(0x16a085);
    if (result.item.image_url) embed.setThumbnail(result.item.image_url);

    await interaction.editReply({ embeds: [embed] });
    return refresh(interaction, 'property');
  },

  /** Von einem Spieler mieten. */
  async poffer(interaction, [offerId]) {
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    const symbol = await getSymbol(interaction.guildId);
    const result = await property.rentFromPlayer(
      interaction.guildId, interaction.user.id, Number(offerId));

    if (!result.ok) return interaction.editReply(estateFailure(result, symbol));

    const embed = new EmbedBuilder()
      .setTitle('🔑 Eingezogen!')
      .setDescription(
        `Du mietest **${result.item.name}** von <@${result.landlordId}>.` +
        (result.previous ? '\nDein alter Vertrag ist damit beendet.' : ''))
      .addFields(
        { name: 'Tagesmiete', value: money(symbol, result.item.offer_price), inline: true },
        { name: 'Stellplätze', value: `${result.capacity.used}/${result.capacity.capacity}`, inline: true },
      )
      .setFooter({ text: 'Die Miete geht täglich an den Vermieter.' })
      .setColor(0x16a085);
    if (result.item.image_url) embed.setThumbnail(result.item.image_url);

    await interaction.editReply({ embeds: [embed] });
    return refresh(interaction, 'property');
  },

  /** Eigenes Mietangebot zurückziehen. */
  async pofferdel(interaction, [offerId]) {
    const result = property.withdrawOffer(
      interaction.guildId, interaction.user.id, Number(offerId));

    const evicted = result.evictedName
      ? ` ${result.evictedName} musste ausziehen.`
      : result.evictedTenant ? ` <@${result.evictedTenant}> musste ausziehen.` : '';
    const text = result.ok
      ? `↩️ Angebot für **${result.offer.name}** zurückgezogen.${evicted}` +
        ` Stellplätze: ${result.capacity.used}/${result.capacity.capacity}.`
      : result.reason === 'not_landlord'
        ? '❌ Das ist nicht dein Angebot.'
        : '❌ Dieses Angebot gibt es nicht.';

    await interaction.reply({ content: text, flags: MessageFlags.Ephemeral });
    return refresh(interaction, 'estate');
  },

  /** Mietvertrag kündigen. */
  async prentcancel(interaction) {
    const result = property.cancelRent(interaction.guildId, interaction.user.id);
    const text = result.ok
      ? `🚪 Vertrag über **${result.rental.name}** gekündigt. ` +
        `Stellplätze jetzt: ${result.capacity.used}/${result.capacity.capacity}.`
      : 'ℹ️ Du mietest gerade nichts.';
    await interaction.reply({ content: text, flags: MessageFlags.Ephemeral });
    return refresh(interaction, 'estate');
  },

  /** Auf einen Job bewerben. */
  async apply(interaction, [jobId]) {
    const result = jobs.apply(interaction.guildId, interaction.user.id, jobId);

    if (!result.ok) {
      const texts = {
        unknown_job: '❌ Diesen Job gibt es nicht mehr.',
        not_offered: '❌ Dieser Job wird heute nicht mehr angeboten.',
        already_hired: 'ℹ️ Da arbeitest du bereits.',
        requirements: `🔒 Dir fehlt noch: ${result.missing?.join(', ')}`,
      };
      return interaction.reply({
        content: texts[result.reason] ?? '❌ Bewerbung fehlgeschlagen.',
        flags: MessageFlags.Ephemeral,
      });
    }

    const symbol = await getSymbol(interaction.guildId);
    const embed = new EmbedBuilder()
      .setTitle('🎉 Eingestellt!')
      .setDescription(
        `Du arbeitest jetzt als ${result.job.emoji} **${result.job.title}**.` +
        (result.previous ? `\nDeine Stelle als ${result.previous.title} hast du aufgegeben.` : ''))
      .addFields(
        { name: 'Verdienst', value: `${money(symbol, result.job.pay)} pro Schicht`, inline: true },
        { name: 'Pause', value: `alle ${result.job.cooldown} min`, inline: true },
      )
      .setColor(jobs.TIER_COLOR[result.job.tier] ?? 0x2ecc71)
      .setFooter({ text: 'Arbeiten mit /work oder dem Button im Arbeitsamt' });

    await interaction.reply({ embeds: [embed], flags: MessageFlags.Ephemeral });
    // Ansicht aktualisieren, damit die Anstellung sofort sichtbar ist.
    return interaction.message.edit(await buildEntryView('jobs', context(interaction)))
      .catch(() => {});
  },

  /** Eine Schicht arbeiten. */
  async shift(interaction) {
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    // Erst Miete abrechnen – Lohn soll nicht vor der Miete kommen.
    const notice = await settle(interaction);
    const result = await jobs.work(interaction.guildId, interaction.user.id);
    const reply = await shiftResult(interaction, result);
    if (notice) reply.content = `${notice}\n${reply.content ?? ''}`.trim();
    await interaction.editReply(reply);
    return interaction.message.edit(await buildEntryView('jobs', context(interaction)))
      .catch(() => {});
  },

  /** Anstellung kündigen. */
  async quitjob(interaction) {
    const result = jobs.quit(interaction.guildId, interaction.user.id);
    const text = result.ok
      ? `🚪 Du hast als **${result.job?.title ?? 'Angestellter'}** gekündigt.`
      : 'ℹ️ Du hast gerade keine Anstellung.';
    await interaction.reply({ content: text, flags: MessageFlags.Ephemeral });
    return interaction.message.edit(await buildEntryView('jobs', context(interaction)))
      .catch(() => {});
  },

  /** Detailansicht eines Gebrauchtwagen-Inserats. */
  async udet(interaction, [listingId, page]) {
    await interaction.update(await buildDetailView({
      guildId: interaction.guildId, mode: 'used',
      key: Number(listingId), page: Number(page) || 1, userId: interaction.user.id,
    }));
  },

  /** Neuwagen kaufen. */
  async buy(interaction, [itemId]) {
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    const symbol = await getSymbol(interaction.guildId);
    const result = await buy(interaction.guildId, interaction.user.id, Number(itemId), 1);

    if (!result.ok) return interaction.editReply(failureText(result, symbol));

    const embed = new EmbedBuilder()
      .setTitle('✅ Gekauft!')
      .setDescription(`**${result.item.name}** steht jetzt in deiner Garage.`)
      .addFields(
        { name: 'Preis', value: money(symbol, result.totalPrice), inline: true },
        { name: 'Neues Bargeld', value: money(symbol, result.newBalance.cash), inline: true },
      )
      .setColor(0x2ecc71);

    if (result.item.image_url) embed.setThumbnail(result.item.image_url);
    if (result.movedFromBank > 0) {
      embed.addFields({
        name: 'Hinweis',
        value: `${money(symbol, result.movedFromBank)} von der Bank abgehoben.`,
      });
    }
    return interaction.editReply({ embeds: [embed] });
  },

  /** Gebrauchtwagen von einem anderen Spieler kaufen. */
  async ubuy(interaction, [listingId]) {
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    const symbol = await getSymbol(interaction.guildId);
    const result = await buyUsed(interaction.guildId, interaction.user.id, Number(listingId));

    if (!result.ok) return interaction.editReply(failureText(result, symbol));

    const embed = new EmbedBuilder()
      .setTitle('✅ Gebrauchtwagen gekauft!')
      .setDescription(
        `**${result.listing.name}** steht jetzt in deiner Garage.\n` +
        `${identity.mention(result.listing.seller_id)} hat ` +
        `${money(symbol, result.price)} erhalten.`)
      .addFields({ name: 'Neues Bargeld', value: money(symbol, result.newBalance.cash) })
      .setColor(0x2ecc71);

    if (result.listing.image_url) embed.setThumbnail(result.listing.image_url);
    return interaction.editReply({ embeds: [embed] });
  },

  /** Eigenes Inserat zurückziehen. */
  async ucancel(interaction, [listingId]) {
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    const result = db.cancelListing(interaction.guildId, interaction.user.id, Number(listingId));

    if (!result.ok) {
      const texts = {
        not_found: '❌ Dieses Inserat gibt es nicht mehr.',
        not_seller: '❌ Das ist nicht dein Inserat.',
      };
      return interaction.editReply(texts[result.reason] ?? '❌ Hat nicht geklappt.');
    }
    return interaction.editReply(`↩️ **${result.listing.name}** steht wieder in deiner Garage.`);
  },
};

/** Einheitliche Fehlertexte für fehlgeschlagene Käufe. */
function failureText(result, symbol) {
  switch (result.reason) {
    case 'not_found':
      return '❌ Das Auto gibt es nicht mehr – vielleicht war jemand schneller.';
    case 'out_of_stock':
      return '📦 Davon ist nichts mehr auf Lager.';
    case 'own_listing':
      return '❌ Das ist dein eigenes Inserat.';
    case 'no_garage':
      return `🅿️ Keine freien Stellplätze — ${result.used}/${result.capacity} belegt.\n` +
        'Kauf oder miete eine Immobilie mit Garage (`/menu` → 🏘️ Immobilien).';
    case 'already_owned':
      return '🚗 Du besitzt dieses Modell schon. Jeder Wagen hat seinen eigenen ' +
        'Zustand, deshalb gibt es jedes Modell nur einmal pro Spieler.';
    case 'single_only':
      return '🚗 Autos lassen sich nur einzeln kaufen.';
    case 'insufficient_funds':
      return `💸 Zu wenig Geld. Du brauchst ${money(symbol, result.needed)}, ` +
        `hast aber nur ${money(symbol, result.have)}.`;
    default:
      return '❌ Kauf fehlgeschlagen.';
  }
}

// ==================================================================== Casino

const gid = (i) => i.guildId;
const uid = (i) => i.user.id;

Object.assign(buttons, {
  /** Zurück zur Casino-Übersicht. */
  async chub(interaction) {
    await interaction.deferUpdate();
    await interaction.editReply(await casinoUi.buildHub({ guildId: gid(interaction), userId: uid(interaction) }));
  },

  /** Ein Spiel öffnen (Standard-Einsatz 100). */
  async cgame(interaction, [game]) {
    await interaction.deferUpdate();
    await interaction.editReply(
      await casinoUi.buildGame(game, { guildId: gid(interaction), userId: uid(interaction), bet: 100 }));
  },

  /** Einsatz-Chip wählen. */
  async cbet(interaction, [game, amount]) {
    await interaction.deferUpdate();
    let bet;
    if (amount === 'max') {
      const cash = await unbCash(interaction);
      bet = casino.clampBet(Math.max(casino.MIN_BET, cash ?? casino.MIN_BET));
    } else {
      bet = casino.clampBet(amount);
    }
    await interaction.editReply(
      await casinoUi.buildGame(game, { guildId: gid(interaction), userId: uid(interaction), bet }));
  },

  /** Eigenen Betrag eingeben (öffnet ein Modal). */
  async cmod(interaction, [game]) {
    const modal = new ModalBuilder()
      .setCustomId(`cbetset|${game}|${uid(interaction)}`)
      .setTitle('Eigener Einsatz');
    const input = new TextInputBuilder()
      .setCustomId('amount')
      .setLabel(`Betrag (${casino.MIN_BET}–${casino.MAX_BET})`)
      .setStyle(TextInputStyle.Short)
      .setRequired(true);
    modal.addComponents(new ActionRowBuilder().addComponents(input));
    await interaction.showModal(modal);
  },

  /** Coinflip. */
  async cf(interaction, [betStr, choice]) {
    await interaction.deferUpdate();
    const bet = casino.clampBet(betStr);
    const symbol = await getSymbol(gid(interaction));
    const res = await casinoPlay.playRound(
      gid(interaction), uid(interaction), bet, 'Coinflip', () => casino.coinflip(choice));

    let banner;
    if (!res.ok) banner = insufficientBanner(res, symbol);
    else {
      const face = res.outcome.result === 'kopf' ? '🪙 Kopf' : '🎯 Zahl';
      banner = res.outcome.win
        ? `${face} — **Gewinn!** +${money(symbol, res.net)}`
        : `${face} — verloren. −${money(symbol, bet)}`;
    }
    await interaction.editReply(
      await casinoUi.buildGame('coinflip', { guildId: gid(interaction), userId: uid(interaction), bet, banner }));
  },

  /** Slots. */
  async slot(interaction, [betStr]) {
    await interaction.deferUpdate();
    const bet = casino.clampBet(betStr);
    const symbol = await getSymbol(gid(interaction));
    const res = await casinoPlay.playRound(
      gid(interaction), uid(interaction), bet, 'Slots', () => casino.slots());

    let banner;
    if (!res.ok) banner = insufficientBanner(res, symbol);
    else {
      const reels = `【 ${res.outcome.reels.join(' | ')} 】`;
      banner = res.net > 0
        ? `${reels}\n${res.outcome.line} — **+${money(symbol, res.net)}**`
        : res.net === 0
          ? `${reels}\n${res.outcome.line}`
          : `${reels}\n${res.outcome.line} — −${money(symbol, bet)}`;
    }
    await interaction.editReply(
      await casinoUi.buildGame('slots', { guildId: gid(interaction), userId: uid(interaction), bet, banner }));
  },

  /** Roulette. */
  async rl(interaction, [betStr, pick]) {
    await interaction.deferUpdate();
    const bet = casino.clampBet(betStr);
    const symbol = await getSymbol(gid(interaction));
    const res = await casinoPlay.playRound(
      gid(interaction), uid(interaction), bet, 'Roulette', () => casino.roulette(pick));

    let banner;
    if (!res.ok) banner = insufficientBanner(res, symbol);
    else {
      const dot = { red: '🔴', black: '⚫', green: '🟢' }[res.outcome.color];
      const head = `${dot} **${res.outcome.number}** (${res.outcome.color})`;
      banner = res.net > 0
        ? `${head} — **Gewinn!** +${money(symbol, res.net)}`
        : `${head} — verloren. −${money(symbol, bet)}`;
    }
    await interaction.editReply(
      await casinoUi.buildGame('roulette', { guildId: gid(interaction), userId: uid(interaction), bet, banner }));
  },

  /** Blackjack: Karten geben. */
  async bjdeal(interaction, [betStr]) {
    await interaction.deferUpdate();
    const bet = casino.clampBet(betStr);
    const res = await casinoPlay.blackjackDeal(gid(interaction), uid(interaction), bet);
    return renderBlackjack(interaction, res, bet);
  },

  /** Blackjack: Karte ziehen. */
  async bjhit(interaction) {
    await interaction.deferUpdate();
    const res = await casinoPlay.blackjackHit(gid(interaction), uid(interaction));
    return renderBlackjack(interaction, res);
  },

  /** Blackjack: bleiben. */
  async bjstand(interaction) {
    await interaction.deferUpdate();
    const res = await casinoPlay.blackjackStand(gid(interaction), uid(interaction));
    return renderBlackjack(interaction, res);
  },
});

async function unbCash(interaction) {
  const unb = require('./unb');
  try { return (await unb.getBalance(gid(interaction), uid(interaction))).cash; }
  catch { return null; }
}

/** Vollständiges Guthaben (Bargeld + Bank) – die Börse darf beides nutzen. */
async function unbBalance(interaction) {
  const unb = require('./unb');
  try { return await unb.getBalance(gid(interaction), uid(interaction)); }
  catch { return null; }
}

function insufficientBanner(res, symbol) {
  return `💸 Zu wenig Bargeld — du hast ${money(symbol, res.have)}, brauchst aber ${money(symbol, res.needed)}.`;
}

/** Übersetzt ein Blackjack-Ergebnis in die passende Ansicht. */
async function renderBlackjack(interaction, res, bet = 100) {
  const guildId = gid(interaction);
  const userId = uid(interaction);
  const symbol = await getSymbol(guildId);

  if (!res.ok) {
    if (res.reason === 'active') {
      return interaction.editReply(await casinoUi.buildBlackjackTable({ guildId, userId }));
    }
    if (res.reason === 'insufficient_funds') {
      return interaction.editReply(await casinoUi.buildGame('blackjack', {
        guildId, userId, bet, banner: insufficientBanner(res, symbol),
      }));
    }
    // no_game o.ä. – zurück zur Bet-Ansicht.
    return interaction.editReply(await casinoUi.buildGame('blackjack', { guildId, userId, bet }));
  }

  if (res.status === 'playing') {
    return interaction.editReply(await casinoUi.buildBlackjackTable({ guildId, userId }));
  }

  // Runde beendet.
  const net = res.gross - res.bet;
  const pv = casino.handValue(res.state.player);
  const banners = {
    blackjack: `🃏 **Blackjack!** +${money(symbol, net)}`,
    win: `✅ **Gewonnen!** +${money(symbol, net)}`,
    dealer_bust: `✅ Dealer überkauft — **Gewonnen!** +${money(symbol, net)}`,
    push: '➖ **Push** — Einsatz zurück',
    bust: `💥 Überkauft (${pv}) — −${money(symbol, res.bet)}`,
    lose: `❌ Verloren — −${money(symbol, res.bet)}`,
    dealer_blackjack: `🃏 Dealer-Blackjack — −${money(symbol, res.bet)}`,
  };
  return interaction.editReply(await casinoUi.buildBlackjackTable({
    guildId, userId, done: res.state, banner: banners[res.result.outcome] ?? '',
  }));
}

// ============================================================ Profil & Rangliste

Object.assign(buttons, {
  /** Rangliste öffnen / Metrik umschalten / blättern. */
  async lb(interaction, [metric, page]) {
    await interaction.deferUpdate();
    await interaction.editReply(await buildLeaderboardView({
      guildId: gid(interaction), userId: uid(interaction),
      metric, page: Number(page) || 1,
    }));
  },

  /** Angeber-Spruch bearbeiten (öffnet ein Modal). */
  async flexedit(interaction) {
    const modal = new ModalBuilder()
      .setCustomId(`flexset|${uid(interaction)}`)
      .setTitle('Dein Spruch');
    const input = new TextInputBuilder()
      .setCustomId('tagline')
      .setLabel('Spruch (leer = löschen)')
      .setStyle(TextInputStyle.Short)
      .setMaxLength(100)
      .setRequired(false);
    modal.addComponents(new ActionRowBuilder().addComponents(input));
    await interaction.showModal(modal);
  },
});

// ============================================================ Storage Wars

/** Klartext zu einem abgelehnten Gebot. */
function bidFailText(res, symbol) {
  switch (res.reason) {
    case 'too_low': return `❌ Mindestgebot ist ${money(symbol, res.min)}.`;
    case 'outbid': return `⚡ Jemand war schneller — neues Mindestgebot ${money(symbol, res.min)}.`;
    case 'not_live': return '❌ Diese Garage ist gerade nicht dran.';
    case 'insufficient_funds':
      return `💸 Zu wenig Geld — du brauchst ${money(symbol, res.needed)}, hast ${money(symbol, res.have)}.`;
    default: return '❌ Das Gebot ging nicht durch.';
  }
}

async function submitBid(interaction, lotId, value) {
  const guildId = gid(interaction);
  const userId = uid(interaction);
  const res = await storage.placeBid(guildId, userId, Number(lotId), value);
  await interaction.editReply(await buildAuctionView({ guildId, userId }));
  const symbol = await getSymbol(guildId);
  const note = res.ok ? `✅ Gebot über ${money(symbol, res.bid)} abgegeben.` : bidFailText(res, symbol);
  await interaction.followUp({ content: note, flags: MessageFlags.Ephemeral }).catch(() => {});
}

Object.assign(buttons, {
  /** Auktionshaus öffnen / aktualisieren. */
  async sauc(interaction) {
    await interaction.deferUpdate();
    await interaction.editReply(
      await buildAuctionView({ guildId: gid(interaction), userId: uid(interaction) }));
  },

  /** Auf das Live-Los bieten (amount = 'min' oder ein fester Betrag). */
  async sbid(interaction, [lotId, amount]) {
    await interaction.deferUpdate();
    let value = Number(amount);
    if (amount === 'min') {
      const lot = db.getLot(gid(interaction), Number(lotId));
      value = lot ? storage.minBid(lot) : 0;
    }
    await submitBid(interaction, lotId, value);
  },

  /** Eigenes Gebot eingeben (öffnet ein Modal). */
  async sbidmod(interaction, [lotId]) {
    const modal = new ModalBuilder()
      .setCustomId(`sbidset|${lotId}|${uid(interaction)}`)
      .setTitle('Eigenes Gebot');
    const input = new TextInputBuilder()
      .setCustomId('amount').setLabel('Dein Gebot')
      .setStyle(TextInputStyle.Short).setRequired(true);
    modal.addComponents(new ActionRowBuilder().addComponents(input));
    await interaction.showModal(modal);
  },

  /** Eigene Sammlung öffnen. */
  async scol(interaction) {
    await interaction.deferUpdate();
    await interaction.editReply(
      await buildCollectionView({ guildId: gid(interaction), userId: uid(interaction) }));
  },

  /** Eine Nachricht wegräumen (Rechnungen sind geschützt). */
  async mdel(interaction, [messageId]) {
    await interaction.deferUpdate();
    const guildId = gid(interaction);
    const userId = uid(interaction);
    const ok = db.deleteMessage(guildId, userId, Number(messageId));
    await interaction.editReply(await buildInboxView({ guildId, userId }));
    if (!ok) {
      await interaction.followUp({
        content: '🧾 Rechnungen lassen sich nicht löschen – die musst du bezahlen.',
        flags: MessageFlags.Ephemeral,
      }).catch(() => {});
    }
  },

  /** Postfach leeren – alles außer offenen Rechnungen. */
  async mclear(interaction) {
    await interaction.deferUpdate();
    const guildId = gid(interaction);
    const userId = uid(interaction);
    const removed = db.clearMessages(guildId, userId);
    const bills = db.listMessages(guildId, userId, 1).total;
    await interaction.editReply(await buildInboxView({ guildId, userId }));
    await interaction.followUp({
      content: `🧹 ${removed} ${removed === 1 ? 'Nachricht' : 'Nachrichten'} gelöscht.` +
        (bills > 0 ? ` ${bills} offene ${bills === 1 ? 'Rechnung bleibt' : 'Rechnungen bleiben'} bestehen.` : ''),
      flags: MessageFlags.Ephemeral,
    }).catch(() => {});
  },

  /** Geld-Rangliste: zwischen Gesamt, Bargeld und Bank umschalten. */
  async top(interaction, [sort]) {
    await interaction.deferUpdate();
    await interaction.editReply(await buildTopView({
      guildId: gid(interaction), userId: uid(interaction), sort,
    }));
  },

  /** Verschlossene Garagen ansehen. */
  async sgar(interaction) {
    await interaction.deferUpdate();
    await interaction.editReply(
      await buildGaragesView({ guildId: gid(interaction), userId: uid(interaction) }));
  },

  /** Eine ersteigerte Garage öffnen und den Inhalt aufdecken. */
  async sopen(interaction, [garageId]) {
    await interaction.deferUpdate();
    const guildId = gid(interaction);
    const userId = uid(interaction);
    const res = await storage.openGarage(guildId, userId, Number(garageId));
    await interaction.editReply(await buildGaragesView({ guildId, userId }));
    const note = res.ok
      ? `🔓 **${res.garage.label} geöffnet!**\n${storage.revealBody(res.contents, res.carResult, res.net)}`
      : '❌ Diese Garage gibt es nicht mehr.';
    await interaction.followUp({ content: note.slice(0, 1900), flags: MessageFlags.Ephemeral }).catch(() => {});
  },

  /** Fundstück(e) beim Hehler verkaufen ('all' = alles). */
  async ssell(interaction, [which]) {
    await interaction.deferUpdate();
    const guildId = gid(interaction);
    const userId = uid(interaction);
    const res = await storage.sellLoot(guildId, userId, which === 'all' ? null : Number(which));
    await interaction.editReply(await buildCollectionView({ guildId, userId }));
    const symbol = await getSymbol(guildId);
    const note = res.ok
      ? `💰 Verkauft für ${money(symbol, res.total)}.`
      : (res.reason === 'empty' ? 'Nichts zu verkaufen.' : '❌ Konnte nicht verkauft werden.');
    await interaction.followUp({ content: note, flags: MessageFlags.Ephemeral }).catch(() => {});
  },

  // ------------------------------------------------------------- Börse

  /** Kursboard nach Anlageklasse filtern. */
  async wkind(interaction, [kind]) {
    await interaction.deferUpdate();
    await interaction.editReply(await buildMarketView({
      guildId: gid(interaction), userId: uid(interaction),
      kind: kind === 'all' ? null : kind, page: 1,
    }));
  },

  /** Einen Wert öffnen (Kurs, Bestand, alle Kaufwege). */
  async wdet2(interaction, [symbol, page]) {
    await interaction.deferUpdate();
    await interaction.editReply(await buildAssetView({
      guildId: gid(interaction), userId: uid(interaction),
      symbol, page: Number(page) || 1,
    }));
  },

  /** Depot öffnen. */
  async wdepot(interaction) {
    await interaction.deferUpdate();
    await interaction.editReply(await buildDepotView({
      guildId: gid(interaction), userId: uid(interaction),
    }));
  },

  /** Kaufen: feste Stückzahl oder "max". */
  async wbuy(interaction, [symbol, amount, page]) {
    await interaction.deferUpdate();
    const guildId = gid(interaction);
    const userId = uid(interaction);

    let shares = Number(amount);
    if (amount === 'max') {
      const quote = wallstreet.quote(guildId, symbol);
      const balance = await unbBalance(interaction);
      shares = quote ? wallstreet.sharesFor(quote.price, balance?.total ?? 0) : 0;
    }
    await tradeBuy(interaction, symbol, shares, page);
  },

  /** Kaufen für einen Betrag – die natürlichere Frage als "wie viele Stück". */
  async wbuyfor(interaction, [symbol, amount, page]) {
    await interaction.deferUpdate();
    const quote = wallstreet.quote(gid(interaction), symbol);
    const shares = quote ? wallstreet.sharesFor(quote.price, Number(amount)) : 0;
    await tradeBuy(interaction, symbol, shares, page);
  },

  /** Verkaufen: Anteil des Bestands in Prozent. */
  async wsell(interaction, [symbol, pct, page]) {
    await interaction.deferUpdate();
    const holding = db.getHolding(gid(interaction), uid(interaction), symbol);
    const held = holding?.shares ?? 0;
    const shares = Number(pct) >= 100 ? held : Math.floor(held * (Number(pct) / 100));
    await tradeSell(interaction, symbol, shares, page);
  },

  /** Eigene Stückzahl eingeben (Modal). */
  async wmod(interaction, [symbol, side, page]) {
    const modal = new ModalBuilder()
      .setCustomId(`wtrade|${symbol}|${side}|${page}|${uid(interaction)}`)
      .setTitle(side === 'buy' ? 'Kaufen' : 'Verkaufen');
    const input = new TextInputBuilder()
      .setCustomId('amount')
      .setLabel(side === 'buy' ? 'Stückzahl (oder "für 5000")' : 'Stückzahl (oder "alles")')
      .setStyle(TextInputStyle.Short).setRequired(true);
    modal.addComponents(new ActionRowBuilder().addComponents(input));
    await interaction.showModal(modal);
  },

  /** Angeln: einmal auswerfen. */
  async fish(interaction) {
    await interaction.deferUpdate();
    const guildId = gid(interaction);
    const userId = uid(interaction);
    const fishing = require('./fishing');
    const symbol = await getSymbol(guildId);

    const res = await fishing.fish(guildId, userId);
    await interaction.editReply(await buildFishingView({ guildId, userId }));

    let note;
    if (!res.ok) {
      note = res.reason === 'cooldown'
        ? `⏳ Die Fische brauchen Ruhe – nächster Zug in ` +
          `**${require('./income').formatRemaining(res.remainingMs)}**.`
        : `🎣 Dafür brauchst du eine **${res.gear}** (🧰 Ausrüstung, ` +
          `${money(symbol, res.price ?? 0)}).`;
    } else {
      note = fishing.describe(res, money(symbol, res.amount)) +
        (res.balance ? `\n💰 Kontostand: ${money(symbol, res.balance.total)}` : '');
    }
    await interaction.followUp({ content: note, flags: MessageFlags.Ephemeral }).catch(() => {});
  },

  /** Creator: eine Plattform öffnen (`t` = Modus für eigene Titel). */
  async creator(interaction, [platformId, mode]) {
    await interaction.deferUpdate();
    const guildId = gid(interaction);
    const userId = uid(interaction);

    const notes = await settleCreator(guildId, userId);
    await interaction.editReply(await buildPlatformView({
      guildId, userId, key: platformId, titleMode: mode === 't',
    }));
    if (notes) {
      await interaction.followUp({ content: notes, flags: MessageFlags.Ephemeral })
        .catch(() => {});
    }
  },

  /** Die Sponsorenverträge. */
  async deals(interaction) {
    await interaction.deferUpdate();
    const guildId = gid(interaction);
    const userId = uid(interaction);
    const notes = await settleCreator(guildId, userId);
    await interaction.editReply(await buildDealsView({ guildId, userId }));
    if (notes) {
      await interaction.followUp({ content: notes, flags: MessageFlags.Ephemeral })
        .catch(() => {});
    }
  },

  /** Ein Vertragsangebot annehmen. */
  async dealok(interaction, [dealId]) {
    await interaction.deferUpdate();
    const guildId = gid(interaction);
    const userId = uid(interaction);
    const symbol = await getSymbol(guildId);
    const creator = require('./creator');

    const res = creator.accept(guildId, userId, Number(dealId));
    await interaction.editReply(await buildDealsView({ guildId, userId }));

    const problems = {
      not_found: '❌ Dieses Angebot gibt es nicht.',
      gone: 'ℹ️ Das Angebot ist nicht mehr offen.',
      expired: '⏳ Zu spät – das Angebot ist abgelaufen.',
      busy: '📋 Du hast schon einen laufenden Vertrag. Erst liefern, dann der nächste.',
    };
    const p = creator.platform(res.deal?.platform);
    const note = res.ok
      ? `✍️ Unterschrieben: **${res.deal.brand}**.\n` +
        `Liefere **${res.deal.quota}** ${p?.action ?? 'Beiträge'}` +
        (res.deal.format
          ? ` im Format **${creator.format(res.deal.platform, res.deal.format)?.name}**` : '') +
        ` auf ${p?.name}. Dann gibt es **${money(symbol, res.deal.payout)}**.\n` +
        `⚠️ Schaffst du es nicht bis zur Frist, kostet es **${money(symbol, res.deal.penalty)}**.`
      : (problems[res.reason] ?? '❌ Das ging nicht.');
    await interaction.followUp({ content: note, flags: MessageFlags.Ephemeral }).catch(() => {});
  },

  /** Ein Vertragsangebot ablehnen. */
  async dealno(interaction, [dealId]) {
    await interaction.deferUpdate();
    const guildId = gid(interaction);
    const userId = uid(interaction);
    const res = require('./creator').decline(guildId, userId, Number(dealId));
    await interaction.editReply(await buildDealsView({ guildId, userId }));
    await interaction.followUp({
      content: res.ok
        ? `🚫 Abgelehnt. ${res.deal.brand} sucht sich jemand anderen.`
        : 'ℹ️ Das Angebot ist nicht mehr offen.',
      flags: MessageFlags.Ephemeral,
    }).catch(() => {});
  },

  /**
   * Fragt nach einem eigenen Titel und führt die Aktion damit aus.
   * Genau ein Eingabefeld – mehr kann der Fluxer-Ersatz für Modals nicht.
   */
  async ptitle(interaction, [platformId, formatId]) {
    const userId = uid(interaction);
    const creator = require('./creator');
    const p = creator.platform(platformId);
    const f = creator.format(platformId, formatId);
    if (!p || !f) return;

    const modal = new ModalBuilder()
      .setCustomId(`ctitle|${platformId}|${formatId}|${userId}`)
      .setTitle(`${p.action}-Titel (${f.name})`.slice(0, 45));
    const input = new TextInputBuilder()
      .setCustomId('title')
      .setLabel(`Wie heißt dein ${p.action}?`.slice(0, 45))
      .setPlaceholder(f.titles[0].slice(0, 100))
      .setMaxLength(80)
      .setStyle(TextInputStyle.Short).setRequired(true);
    modal.addComponents(new ActionRowBuilder().addComponents(input));
    await interaction.showModal(modal);
  },

  /** Den offenen Vorfall ansehen. */
  async vorfall(interaction) {
    await interaction.deferUpdate();
    const guildId = gid(interaction);
    const userId = uid(interaction);
    const notes = await settleCreator(guildId, userId);
    await interaction.editReply(await buildDecisionView({ guildId, userId }));
    if (notes) {
      await interaction.followUp({ content: notes, flags: MessageFlags.Ephemeral })
        .catch(() => {});
    }
  },

  /** Eine Entscheidung treffen. */
  async wahl(interaction, [eventId, optionId]) {
    await interaction.deferUpdate();
    const guildId = gid(interaction);
    const userId = uid(interaction);
    const symbol = await getSymbol(guildId);

    const res = await require('./decisions').choose(guildId, userId, Number(eventId), optionId);
    await interaction.editReply(await buildDecisionView({ guildId, userId }));

    let note;
    if (!res.ok) {
      note = res.reason === 'expired'
        ? `⏱️ Zu spät – die Frist ist abgelaufen.\n_${res.result?.outcome?.text ?? ''}_`
        : 'ℹ️ Diese Entscheidung ist nicht mehr offen.';
    } else {
      const e = res.effect;
      const parts = [];
      if (e.followers) {
        parts.push(`${e.followers > 0 ? '📈 +' : '📉 '}` +
          `${e.followers.toLocaleString('de-DE')} Follower`);
      }
      if (e.community) parts.push(`💞 ${e.community > 0 ? '+' : ''}${e.community} Community`);
      if (e.cash) parts.push(`💰 ${e.cash > 0 ? '+' : ''}${money(symbol, e.cash)}`);
      if (e.hype) {
        parts.push(`📈 Form ${e.hype > 1 ? '+' : ''}${Math.round((e.hype - 1) * 100)} %`);
      }
      if (e.fatigue) parts.push(`🔋 ${e.fatigue > 0 ? '+' : ''}${e.fatigue} Erschöpfung`);
      if (e.gear) parts.push(`💥 ${e.gear} kaputt`);
      if (e.locked?.length) {
        parts.push(`⛔ gesperrt: ${e.locked.map((id) =>
          require('./creator').platform(id)?.name ?? id).join(', ')}`);
      }

      note = `${res.decision.emoji} **${res.option.label}**\n_${res.outcome.text}_` +
        (parts.length ? `\n\n${parts.join(' · ')}` : '\n\n_Ohne Folgen. Diesmal._');
    }
    await interaction.followUp({ content: note, flags: MessageFlags.Ephemeral }).catch(() => {});
  },

  /** Creator: eine Aktion auf einer Plattform (Stream, Video, Post, Tweet). */
  async post(interaction, [platformId, formatId], title = null) {
    await interaction.deferUpdate();
    const guildId = gid(interaction);
    const userId = uid(interaction);
    const creator = require('./creator');
    const symbol = await getSymbol(guildId);

    const res = await creator.act(
      guildId, userId, platformId, formatId, Date.now(), Math.random, title);
    await interaction.editReply(await buildPlatformView({
      guildId, userId, key: platformId, titleMode: Boolean(title),
    }));

    let note;
    if (!res.ok) {
      if (res.reason === 'cooldown') {
        note = `⏳ Zu früh – ${res.platform.name} ist in ` +
          `**${require('./income').formatRemaining(res.remainingMs)}** wieder dran.`;
      } else if (res.reason === 'no_time') {
        note = `😴 Der Tag hat nur ${res.max} Stunden Kreativzeit. ` +
          `Für ${res.platform.action} brauchst du **${res.need}**, übrig sind **${res.left}**. ` +
          `Morgen wieder (in **${require('./income').formatRemaining(res.resetMs)}**).`;
      } else if (res.reason === 'locked') {
        note = `⛔ ${res.platform.name} ist nach dem Vorfall gesperrt – noch ` +
          `**${require('./income').formatRemaining(res.remainingMs)}**.`;
      } else if (res.reason === 'no_gear') {
        note = `${res.platform.emoji} Dafür brauchst du **${res.gear}** ` +
          `(🧰 Ausrüstung, ${money(symbol, res.price ?? 0)}).`;
      } else {
        note = '❌ Das gibt es so nicht.';
      }
    } else {
      note = creator.describe(res, (n) => money(symbol, n)) +
        (res.balance ? `\n💰 Kontostand: ${money(symbol, res.balance.total)}` : '');

      if (res.deal) {
        note += res.deal.complete
          ? `\n🤝 **Vertrag erfüllt!** ${res.deal.emoji} ${res.deal.brand} zahlt ` +
            `**${money(symbol, res.deal.payout)}**.`
          : `\n🤝 Zählt für ${res.deal.emoji} ${res.deal.brand}: ` +
            `**${res.deal.done}/${res.deal.quota}**.`;
      }
      if (res.offer) {
        note += `\n📬 ${res.offer.emoji} **${res.offer.brand}** hat angefragt – ` +
          'siehe 🤝 Deals.';
      }
      if (res.incident) {
        const d = require('./decisions').decision(res.incident.kind);
        note += `\n⚠️ **${d?.emoji ?? ''} ${d?.title ?? 'Etwas ist passiert'}** – ` +
          'du musst dich entscheiden (⚠️ im Netzwerk).';
      }
      if (res.tired) {
        note += `\n🔋 Du wirkst müde: **${Math.round(res.energy * 100)} %** Reichweite. ` +
          'Eine Pause hilft.';
      }
    }
    await interaction.followUp({ content: note, flags: MessageFlags.Ephemeral }).catch(() => {});
  },

  /** Selbst schrauben statt in die Werkstatt. */
  async wself(interaction, [itemId, tierId, page]) {
    await interaction.deferUpdate();
    const guildId = gid(interaction);
    const userId = uid(interaction);
    const symbol = await getSymbol(guildId);

    const res = await workshop.selfRepair(guildId, userId, Number(itemId), tierId);
    await interaction.editReply(await buildRepairView({
      guildId, userId, key: Number(itemId), page: Number(page) || 1,
    }));

    const note = res.ok
      ? (res.botched
        ? `🔧 **${res.item.name}**: Es hat nicht ganz geklappt – ` +
          `${condition.labelDetailed(res.quote.from)} → ${condition.labelDetailed(res.reached)}.\n` +
          `_Material ist trotzdem weg: ${money(symbol, res.cost)}._`
        : `🔧 **${res.item.name}** selbst hergerichtet — ` +
          `${condition.labelDetailed(res.quote.from)} → ${condition.labelDetailed(res.reached)}.\n` +
          `Material: ${money(symbol, res.cost)} _(${money(symbol, res.saved)} gespart)_`) +
        (res.brokeTool ? '\n💥 Dein **Werkzeugkasten** hat es nicht überlebt.' : '') +
        `\nBargeld: ${money(symbol, res.newBalance.cash)}`
      : selfRepairFailure(res, symbol);

    await interaction.followUp({ content: note, flags: MessageFlags.Ephemeral }).catch(() => {});
  },

  /** Werkstatt: Kostenvoranschlag für ein Auto öffnen. */
  async wdet(interaction, [itemId, page]) {
    await interaction.update(await buildRepairView({
      guildId: gid(interaction), userId: uid(interaction),
      key: Number(itemId), page: Number(page) || 1,
    }));
  },

  /**
   * Reparatur beauftragen. Das Panel zeigt danach den neuen Zustand, das
   * Ergebnis kommt als kurze private Meldung dazu.
   */
  async wfix(interaction, [itemId, tierId, page]) {
    await interaction.deferUpdate();
    const guildId = gid(interaction);
    const userId = uid(interaction);
    const symbol = await getSymbol(guildId);

    const res = await workshop.repair(guildId, userId, Number(itemId), tierId);

    await interaction.editReply(await buildRepairView({
      guildId, userId, key: Number(itemId), page: Number(page) || 1,
    }));

    const note = res.ok
      ? `${res.quote.tier.emoji} **${res.item.name}** ist fertig — ` +
        `${condition.labelDetailed(res.quote.from)} → ${condition.labelDetailed(res.quote.to)}.\n` +
        `Rechnung: ${money(symbol, res.cost)} · Zeitwert jetzt ${money(symbol, res.quote.after)}` +
        (res.movedFromBank > 0
          ? `\n_${money(symbol, res.movedFromBank)} von der Bank geholt._` : '') +
        `\nNeues Bargeld: ${money(symbol, res.newBalance.cash)}`
      : workshopFailure(res, symbol);

    await interaction.followUp({ content: note, flags: MessageFlags.Ephemeral }).catch(() => {});
  },
});

/** Kauf ausführen, Panel neu aufbauen, Ergebnis privat melden. */
async function tradeBuy(interaction, symbol, shares, page) {
  const guildId = gid(interaction);
  const userId = uid(interaction);
  const currency = await getSymbol(guildId);

  const res = await wallstreet.buy(guildId, userId, symbol, shares);
  await interaction.editReply(await buildAssetView({
    guildId, userId, symbol, page: Number(page) || 1,
  }));

  const note = res.ok
    ? `🛒 **${res.shares.toLocaleString('de-DE')}× ${res.quote.symbol}** zu ` +
      `${money(currency, res.price)} gekauft.\n` +
      `Kosten ${money(currency, res.gross)} + ${money(currency, res.fee)} Gebühr = ` +
      `**${money(currency, res.total)}**` +
      (res.movedFromBank > 0 ? `\n_${money(currency, res.movedFromBank)} von der Bank geholt._` : '') +
      `\nBargeld: ${money(currency, res.newBalance.cash)}`
    : marketFailure(res, currency);

  await interaction.followUp({ content: note, flags: MessageFlags.Ephemeral }).catch(() => {});
}

/** Verkauf ausführen. */
async function tradeSell(interaction, symbol, shares, page) {
  const guildId = gid(interaction);
  const userId = uid(interaction);
  const currency = await getSymbol(guildId);

  const res = await wallstreet.sell(guildId, userId, symbol, shares);
  await interaction.editReply(await buildAssetView({
    guildId, userId, symbol, page: Number(page) || 1,
  }));

  const note = res.ok
    ? `📤 **${res.shares.toLocaleString('de-DE')}× ${res.quote.symbol}** zu ` +
      `${money(currency, res.price)} verkauft.\n` +
      `Erlös ${money(currency, res.gross)} − ${money(currency, res.fee)} Gebühr = ` +
      `**${money(currency, res.net)}**\n` +
      `${res.profit >= 0 ? '📈 Gewinn' : '📉 Verlust'}: ` +
      `${res.profit >= 0 ? '+' : ''}${res.profit.toLocaleString('de-DE')} ` +
      `· Bargeld: ${money(currency, res.newBalance.cash)}`
    : marketFailure(res, currency);

  await interaction.followUp({ content: note, flags: MessageFlags.Ephemeral }).catch(() => {});
}

/** Fehlermeldungen der Börse. */
function marketFailure(result, currency) {
  switch (result.reason) {
    case 'unknown_symbol':
      return '❌ Diesen Wert gibt es an unserer Börse nicht.';
    case 'bad_amount':
      return '❓ Wie viele Stück denn? Sag eine Zahl über null.';
    case 'too_many':
      return `📦 So viele auf einmal gehen nicht (höchstens ${result.max.toLocaleString('de-DE')}).`;
    case 'nothing_held':
      return 'ℹ️ Davon besitzt du nichts.';
    case 'not_enough_shares':
      return `📉 So viele hast du nicht – nur ${result.have.toLocaleString('de-DE')} Stück.`;
    case 'insufficient_funds':
      return `💸 Zu wenig Geld: Der Auftrag kostet ${money(currency, result.needed)}, ` +
        `du hast ${money(currency, result.have)}.`;
    default:
      return '❌ Der Auftrag ist nicht durchgegangen.';
  }
}

/** Fehlermeldungen fürs Selberschrauben. */
function selfRepairFailure(result, symbol) {
  switch (result.reason) {
    case 'no_tools':
      return `🧰 Dafür brauchst du einen **${result.needs}** (🧰 Ausrüstung).`;
    case 'cooldown':
      return '🔧 Du hast gerade erst geschraubt – Pause bis ' +
        `**${require('./income').formatRemaining(result.remainingMs)}**.`;
    default:
      return workshopFailure(result, symbol);
  }
}

/** Fehlermeldungen der Werkstatt. */
function workshopFailure(result, symbol) {
  switch (result.reason) {
    case 'not_owned':
      return '❌ Dieses Auto steht nicht (mehr) in deiner Garage.';
    case 'not_a_car':
      return '🔧 Die Werkstatt nimmt nur Autos an.';
    case 'already_good':
      return 'ℹ️ Dafür ist dein Wagen schon zu gut — such dir eine höhere Stufe.';
    case 'insufficient_funds':
      return `💸 Zu wenig Geld. Der Auftrag kostet ${money(symbol, result.needed)}, ` +
        `du hast ${money(symbol, result.have)}.`;
    default:
      return '❌ Der Auftrag ist schiefgegangen.';
  }
}

// -------------------------------------------------------- Modal-Handler

const modals = {
  /** Eigener Titel wurde getippt – dieselbe Aktion, nur mit Wunschtitel. */
  async ctitle(interaction, [platformId, formatId]) {
    const title = interaction.fields.getTextInputValue('title');
    return buttons.post(interaction, [platformId, formatId], title);
  },

  /** Eigener Einsatz wurde eingegeben. */
  async cbetset(interaction, [game]) {
    await interaction.deferUpdate();
    const bet = casino.clampBet(interaction.fields.getTextInputValue('amount'));
    await interaction.editReply(
      await casinoUi.buildGame(game, { guildId: gid(interaction), userId: uid(interaction), bet }));
  },

  /** Angeber-Spruch wurde gesetzt. */
  async flexset(interaction) {
    await interaction.deferUpdate();
    const text = (interaction.fields.getTextInputValue('tagline') || '').trim().slice(0, 100);
    db.setTagline(gid(interaction), uid(interaction), text);
    await interaction.editReply(await buildProfileView({
      guildId: gid(interaction), userId: uid(interaction),
    }));
  },

  /**
   * Eigene Börsen-Menge wurde eingegeben.
   * Akzeptiert Stückzahlen, "alles" und "für 5000" – Tippen soll nicht
   * schwerer sein als Klicken.
   */
  async wtrade(interaction, [symbol, side, page]) {
    await interaction.deferUpdate();
    const raw = (interaction.fields.getTextInputValue('amount') || '').trim().toLowerCase();
    const guildId = gid(interaction);
    const userId = uid(interaction);

    if (side === 'sell') {
      const held = db.getHolding(guildId, userId, symbol)?.shares ?? 0;
      const shares = ['alles', 'all', 'max'].includes(raw)
        ? held : Math.floor(Number(raw.replace(/[^\d]/g, '')));
      return tradeSell(interaction, symbol, shares, page);
    }

    const quote = wallstreet.quote(guildId, symbol);
    const digits = Math.floor(Number(raw.replace(/[^\d]/g, '')));
    let shares = digits;

    if (/^(für|fuer|for)\b/.test(raw)) {
      shares = quote ? wallstreet.sharesFor(quote.price, digits) : 0;
    } else if (['alles', 'all', 'max'].includes(raw)) {
      const balance = await unbBalance(interaction);
      shares = quote ? wallstreet.sharesFor(quote.price, balance?.total ?? 0) : 0;
    }
    return tradeBuy(interaction, symbol, shares, page);
  },

  /** Eigenes Auktionsgebot wurde eingegeben. */
  async sbidset(interaction, [lotId]) {
    await interaction.deferUpdate();
    const raw = interaction.fields.getTextInputValue('amount') || '';
    const value = Math.round(Number(raw.replace(/[^\d]/g, '')));
    await submitBid(interaction, lotId, value);
  },
};

module.exports = {
  buttons, modals, parseId, failureText, workshopFailure, shiftResult, settle,
};
