const { EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
const db = require('./db');
const { getSymbol, plainSymbol } = require('./currency');

/**
 * Button-IDs sind bewusst zustandslos: alles zum Neuaufbau der Ansicht
 * steckt in der ID. Dadurch funktionieren Buttons auch nach einem Neustart.
 *
 *   menu|<bereich>|<seite>|<userId>   Menüpunkt öffnen / blättern
 *   home|<userId>                     zurück ins Hauptmenü
 *   det|<itemId>|<seite>|<userId>     Detailansicht Neuwagen
 *   udet|<listingId>|<seite>|<userId> Detailansicht Gebrauchtwagen
 *   buy|<itemId>|<userId>             Neuwagen kaufen
 *   ubuy|<listingId>|<userId>         Gebrauchtwagen kaufen
 *   ucancel|<listingId>|<userId>      Inserat zurückziehen
 */
const ID = {
  menu: (entry, page, userId) => `menu|${entry}|${page}|${userId}`,
  home: (userId) => `home|${userId}`,
  // Marken-Filter: der Markenname steckt als eigener Abschnitt in der ID.
  brand: (brand, page, userId) => `menu|new|${page}|${brand}|${userId}`,
};

const money = (symbol, n) =>
  `${symbol} ${Number.isFinite(n) ? n.toLocaleString('de-DE') : '∞'}`;

const homeButton = (userId) =>
  new ButtonBuilder()
    .setCustomId(ID.home(userId))
    .setLabel('Hauptmenü').setEmoji('🏠')
    .setStyle(ButtonStyle.Primary);

/**
 * Standard-Kopfzeile: Blättern, optionaler Zusatz-Button, Hauptmenü.
 * Discord erlaubt 5 Buttons pro Zeile – mehr als ein Extra passt nicht.
 */
function navigationRow(entry, page, totalPages, userId, extra = null, brand = null) {
  // Bei aktivem Markenfilter muss die Marke beim Blättern erhalten bleiben.
  const pageId = (n) => (brand ? ID.brand(brand, n, userId) : ID.menu(entry, n, userId));

  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(pageId(page - 1))
      .setLabel('Zurück').setEmoji('◀️')
      .setStyle(ButtonStyle.Secondary)
      .setDisabled(page <= 1),
    new ButtonBuilder()
      .setCustomId('noop').setLabel(`${page} / ${totalPages}`)
      .setStyle(ButtonStyle.Secondary).setDisabled(true),
    new ButtonBuilder()
      .setCustomId(pageId(page + 1))
      .setLabel('Weiter').setEmoji('▶️')
      .setStyle(ButtonStyle.Secondary)
      .setDisabled(page >= totalPages),
  );
  if (extra) row.addComponents(extra);
  row.addComponents(homeButton(userId));
  return row;
}

/** Eigene Zeile für Bereichswechsel und Filter – hält die Navigation frei. */
function actionsRow(...buttons) {
  return new ActionRowBuilder().addComponents(...buttons.filter(Boolean));
}

/**
 * Holt eine Seite und korrigiert dabei Seitenzahlen außerhalb des gültigen
 * Bereichs. Nötig, weil alte Buttons auf Seiten zeigen können, die es nach
 * dem Löschen von Einträgen nicht mehr gibt – sonst käme eine leere Liste
 * zurück, obwohl es Einträge gibt.
 */
function fetchPage(fetch, page) {
  const result = fetch(Math.max(1, Number(page) || 1));
  if (result.items.length === 0 && result.total > 0) return fetch(result.totalPages);
  return result;
}

/** Detail- und Kauf-Buttons für die Artikel einer Seite, spaltengleich untereinander. */
function itemRows(entries, userId, mode, page) {
  const detail = { used: 'udet', gear: 'gdet' }[mode] ?? 'det';
  const buy = mode === 'used' ? 'ubuy' : 'buy';

  return [
    new ActionRowBuilder().addComponents(...entries.map((e) =>
      new ButtonBuilder()
        .setCustomId(`${detail}|${e.key}|${page}|${userId}`)
        .setLabel(e.label.slice(0, 40)).setEmoji('🔍')
        .setStyle(ButtonStyle.Secondary))),
    new ActionRowBuilder().addComponents(...entries.map((e) =>
      new ButtonBuilder()
        .setCustomId(`${buy}|${e.key}|${userId}`)
        .setLabel(e.price.toLocaleString('de-DE')).setEmoji('💰')
        .setStyle(ButtonStyle.Success))),
  ];
}

// ------------------------------------------------------------------ Neuwagen

async function buildNewShopView({ guildId, userId, page = 1, brand = null }) {
  const symbol = await getSymbol(guildId);
  const { items, total, totalPages, page: p } =
    fetchPage((n) => db.listItems(guildId, n, brand), page);

  const actions = actionsRow(
    new ButtonBuilder()
      .setCustomId(ID.menu('brands', 1, userId))
      .setLabel(brand ? 'Andere Marke' : 'Nach Marke filtern').setEmoji('🏷️')
      .setStyle(brand ? ButtonStyle.Primary : ButtonStyle.Secondary),
    // Bei aktivem Filter zurück zur vollen Liste.
    brand ? new ButtonBuilder()
      .setCustomId(ID.menu('new', 1, userId))
      .setLabel('Alle Marken').setEmoji('✨')
      .setStyle(ButtonStyle.Secondary) : null,
    new ButtonBuilder()
      .setCustomId(ID.menu('used', 1, userId))
      .setLabel('Gebrauchtwagen').setEmoji('🔧')
      .setStyle(ButtonStyle.Secondary),
  );

  const embed = new EmbedBuilder()
    .setTitle(brand ? `✨ Neuwagen · ${brand}` : '✨ Neuwagen')
    .setColor(0x2ecc71);

  if (total === 0) {
    embed.setDescription(brand
      ? `Von **${brand}** steht gerade nichts im Autohaus.`
      : 'Das Autohaus ist noch leer. Ein Admin kann mit `/additem` Autos anlegen.');
    return {
      embeds: [embed],
      components: [navigationRow('new', 1, 1, userId, null, brand), actions],
    };
  }

  embed.setDescription(items.map((i) =>
    `${i.emoji ? `${i.emoji} ` : ''}**${i.name}** — ${money(symbol, i.price)}\n` +
    `\`ID ${i.id}\`${brand ? '' : ` · ${i.brand}`} · Lager: ${i.stock === null ? '∞' : i.stock}` +
    (i.description ? `\n> ${i.description}` : '')).join('\n\n'));
  embed.setFooter({
    text: `${total} ${brand ? `Autos von ${brand}` : 'Autos'} · 🔍 für Details, 💰 zum Kaufen`,
  });

  const best = items.reduce((a, b) => (b.price > a.price ? b : a));
  if (best.image_url) embed.setThumbnail(best.image_url);

  const entries = items.map((i) => ({ key: i.id, label: i.name, price: i.price }));
  return {
    embeds: [embed],
    components: [
      navigationRow('new', p, totalPages, userId, null, brand),
      actions,
      ...itemRows(entries, userId, 'new', p),
    ],
  };
}

/**
 * Markenauswahl: ein Button pro Marke. Discord erlaubt 5 Zeilen à 5 Buttons –
 * eine Zeile bleibt für "Alle Autos" und das Hauptmenü reserviert.
 */
async function buildBrandsView({ guildId, userId, page = 1 }) {
  const symbol = await getSymbol(guildId);
  const brands = db.listBrands(guildId);
  const PER_PAGE = 20;
  const totalPages = Math.max(1, Math.ceil(brands.length / PER_PAGE));
  const p = Math.min(Math.max(1, Number(page) || 1), totalPages);
  const shown = brands.slice((p - 1) * PER_PAGE, p * PER_PAGE);

  const embed = new EmbedBuilder()
    .setTitle('🏷️ Marken')
    .setColor(0x2ecc71);

  if (brands.length === 0) {
    embed.setDescription('Es gibt noch keine Autos im Autohaus.');
    return {
      embeds: [embed],
      components: [new ActionRowBuilder().addComponents(homeButton(userId))],
    };
  }

  embed.setDescription(shown.map((b) =>
    `**${b.brand}** — ${b.n} ${b.n === 1 ? 'Auto' : 'Autos'} · ` +
    `${money(symbol, b.min_price)} – ${money(symbol, b.max_price)}`).join('\n'));
  embed.setFooter({ text: `${brands.length} Marken · Seite ${p}/${totalPages}` });

  const rows = [];
  for (let i = 0; i < shown.length; i += 5) {
    rows.push(new ActionRowBuilder().addComponents(
      ...shown.slice(i, i + 5).map((b) =>
        new ButtonBuilder()
          .setCustomId(ID.brand(b.brand, 1, userId))
          .setLabel(`${b.brand} (${b.n})`.slice(0, 40))
          .setStyle(ButtonStyle.Secondary))));
  }

  // Letzte Zeile: Blättern (falls nötig), alle Autos, Hauptmenü.
  const last = new ActionRowBuilder();
  if (totalPages > 1) {
    last.addComponents(
      new ButtonBuilder().setCustomId(ID.menu('brands', p - 1, userId))
        .setLabel('Zurück').setEmoji('◀️')
        .setStyle(ButtonStyle.Secondary).setDisabled(p <= 1),
      new ButtonBuilder().setCustomId(ID.menu('brands', p + 1, userId))
        .setLabel('Weiter').setEmoji('▶️')
        .setStyle(ButtonStyle.Secondary).setDisabled(p >= totalPages),
    );
  }
  last.addComponents(
    new ButtonBuilder().setCustomId(ID.menu('new', 1, userId))
      .setLabel('Alle Autos').setEmoji('✨')
      .setStyle(ButtonStyle.Primary),
    homeButton(userId),
  );
  rows.push(last);

  return { embeds: [embed], components: rows };
}

// ------------------------------------------------------------- Gebrauchtwagen

/**
 * Führt Spieler-Inserate und Anzeigen privater Anbieter zusammen.
 * Beides sind Gebrauchtwagen – getrennte Listen wären künstlich.
 */
function collectUsedCars(guildId) {
  const npc = require('./npc');
  const entries = [];

  for (const l of db.allListingsOfKind(guildId, 'car')) {
    entries.push({
      source: 'player',
      key: `p${l.listing_id}`,
      item: l,
      price: l.listing_price,
      condition: l.listing_condition ?? 100,
      seller: l.seller_id,
    });
  }

  for (const n of npc.listings(guildId, 'car')) {
    entries.push({
      source: 'npc',
      key: `n${n.npc_id}`,
      item: n,
      price: n.npc_price,
      condition: n.npc_condition,
      seller: n.seller,
      note: n.note,
    });
  }

  entries.sort((a, b) => a.price - b.price);
  return entries;
}

async function buildUsedShopView({ guildId, userId, page = 1 }) {
  const symbol = await getSymbol(guildId);
  const cond = require('./condition');

  const all = collectUsedCars(guildId);
  const PER_PAGE = 5;
  const totalPages = Math.max(1, Math.ceil(all.length / PER_PAGE));
  const p = Math.min(Math.max(1, Number(page) || 1), totalPages);
  const shown = all.slice((p - 1) * PER_PAGE, p * PER_PAGE);
  const total = all.length;

  const actions = actionsRow(
    new ButtonBuilder()
      .setCustomId(ID.menu('new', 1, userId))
      .setLabel('Neuwagen').setEmoji('✨')
      .setStyle(ButtonStyle.Secondary),
  );

  const embed = new EmbedBuilder().setTitle('🔧 Gebrauchtwagen').setColor(0x95a5a6);

  if (total === 0) {
    embed.setDescription(
      'Hier steht gerade nichts.\nStell dein eigenes Auto rein mit `/sell <auto-id> <preis>`.');
    return { embeds: [embed], components: [navigationRow('used', 1, 1, userId), actions] };
  }

  embed.setDescription(shown.map((e) => {
    const i = e.item;
    const from = e.source === 'npc' ? `🧑‍💼 ${e.seller}` : `🧑 <@${e.seller}>`;

    // Bewusst sparsam: nur Preis, grobe Zustandsstufe und Verkäufer. Weder
    // Neupreis noch Prozentwert – sonst ließe sich direkt ausrechnen, ob das
    // Angebot ein Schnäppchen oder Wucher ist. Genau darin liegt das Spiel.
    return `${i.emoji ? `${i.emoji} ` : ''}**${i.name}** — ${money(symbol, e.price)}\n` +
      `${cond.label(e.condition)} · ${from}` +
      (e.note ? `\n> _${e.note}_` : '');
  }).join('\n\n'));

  embed.setFooter({ text: `${total} Angebote · 🔍 für Details, 💰 zum Kaufen` });

  const best = shown.reduce((a, b) => (b.price > a.price ? b : a));
  if (best.item.image_url) embed.setThumbnail(best.item.image_url);

  // Detail- und Kauf-Buttons: NPC und Spieler brauchen eigene Präfixe.
  const detailRow = new ActionRowBuilder().addComponents(
    ...shown.map((e) =>
      new ButtonBuilder()
        .setCustomId(`udet|${e.key}|${p}|${userId}`)
        .setLabel(e.item.name.slice(0, 40)).setEmoji('🔍')
        .setStyle(ButtonStyle.Secondary)));

  const buyRow = new ActionRowBuilder().addComponents(
    ...shown.map((e) =>
      new ButtonBuilder()
        .setCustomId(`${e.source === 'npc' ? 'nbuy' : 'ubuy'}|` +
          `${e.source === 'npc' ? e.key.slice(1) : e.key.slice(1)}|${userId}`)
        .setLabel(e.price.toLocaleString('de-DE')).setEmoji('💰')
        .setStyle(ButtonStyle.Success)));

  return {
    embeds: [embed],
    components: [navigationRow('used', p, totalPages, userId), actions, detailRow, buyRow],
  };
}

// -------------------------------------------------------------- Ausrüstung

async function buildGearShopView({ guildId, userId, page = 1, brand = null }) {
  const symbol = await getSymbol(guildId);
  const { items, total, totalPages, page: p } =
    fetchPage((n) => db.listItems(guildId, n, brand, 'gear'), page);

  const embed = new EmbedBuilder()
    .setTitle(brand ? `🧰 Ausrüstung · ${brand}` : '🧰 Ausrüstung')
    .setColor(0xe67e22);

  const actions = actionsRow(
    new ButtonBuilder()
      .setCustomId(ID.menu('jobs', 1, userId))
      .setLabel('Arbeitsamt').setEmoji('💼')
      .setStyle(ButtonStyle.Secondary),
    brand ? new ButtonBuilder()
      .setCustomId(ID.menu('gear', 1, userId))
      .setLabel('Alle Kategorien').setEmoji('🧰')
      .setStyle(ButtonStyle.Secondary) : null,
  );

  if (total === 0) {
    embed.setDescription('Hier gibt es noch nichts zu kaufen.');
    return { embeds: [embed], components: [navigationRow('gear', 1, 1, userId), actions] };
  }

  const gear = require('./data/gear');

  embed.setDescription(items.map((i) => {
    const owned = db.getOwned(guildId, userId, i.id);
    const wear = gear.wearChance(gear.findGear(i.name));
    const tag = wear > 0 ? ' 🔧' : ' 🛡️';
    return `${i.emoji ? `${i.emoji} ` : ''}**${i.name}** — ${money(symbol, i.price)}` +
      `${owned ? '  ✅' : ''}${tag}\n\`ID ${i.id}\` · ${i.brand}` +
      (i.description ? `\n> ${i.description}` : '');
  }).join('\n\n'));
  // Was man schon hat, gehört an den Anfang – sonst müsste man alle Seiten
  // durchblättern, um den eigenen Bestand zu sehen.
  const mine = db.ownedOfKind(guildId, userId, 'gear');
  if (mine.length) {
    const byCategory = new Map();
    for (const g of mine) {
      const list = byCategory.get(g.brand) ?? [];
      list.push(`${g.emoji ? `${g.emoji} ` : ''}${g.name}`);
      byCategory.set(g.brand, list);
    }
    embed.addFields({
      name: `🎒 Dein Bestand (${mine.length})`,
      value: [...byCategory].map(([cat, list]) =>
        `**${cat}:** ${list.join(', ')}`).join('\n').slice(0, 1024),
    });
  }

  embed.setFooter({
    text: `${total} Artikel · ✅ im Besitz · 🔧 kann verschleißen · 🛡️ hält ewig`,
  });

  const entries = items.map((i) => ({ key: i.id, label: i.name, price: i.price }));
  return {
    embeds: [embed],
    components: [
      navigationRow('gear', p, totalPages, userId, null, brand),
      actions,
      ...itemRows(entries, userId, 'gear', p),
    ],
  };
}

// -------------------------------------------------------------- Immobilien

/** Kurzform der Garagenangabe eines Objekts. */
function garageLabel(slots) {
  if (slots === 0) return '🚫 keine Garage';
  return `🅿️ ${slots} ${slots === 1 ? 'Stellplatz' : 'Stellplätze'}`;
}

/**
 * Alle Immobilien-Angebote in einer Liste: Katalog, Spieler-Verkäufe und
 * Spieler-Mietangebote. Bewusst zusammengeführt – getrennte Menüpunkte für
 * "kaufen" und "mieten" waren unübersichtlich, weil dasselbe Objekt in
 * beiden auftauchen kann.
 *
 * Die Liste ist klein genug (Katalog ~26 plus wenige Spielerangebote), um sie
 * im Speicher zu sortieren und zu blättern.
 */
function collectPropertyOffers(guildId, userId, brand) {
  const property = require('./property');
  const entries = [];

  // 1) Vom Markt – kaufbar und mietbar.
  for (const item of db.allItemsOfKind(guildId, 'property')) {
    if (brand && item.brand !== brand) continue;
    entries.push({
      source: 'market',
      key: `m${item.id}`,
      item,
      price: item.price,
      rent: item.rent,
      free: property.available(guildId, item),
    });
  }

  // 2) Von Spielern zum Verkauf.
  for (const listing of db.allListingsOfKind(guildId, 'property')) {
    if (brand && listing.brand !== brand) continue;
    entries.push({
      source: 'sale',
      key: `s${listing.listing_id}`,
      item: listing,
      price: listing.listing_price,
      seller: listing.seller_id,
      free: 1,
    });
  }

  // 3) Anzeigen privater Anbieter – kaufen oder mieten.
  const npc = require('./npc');
  for (const n of npc.listings(guildId, 'property')) {
    if (brand && n.brand !== brand) continue;
    entries.push({
      source: n.mode === 'rent' ? 'npcrent' : 'npcsale',
      key: `n${n.npc_id}`,
      item: n,
      price: n.mode === 'rent' ? null : n.npc_price,
      rent: n.mode === 'rent' ? n.npc_price : null,
      seller: n.seller,
      note: n.note,
      free: 1,
    });
  }

  // 4) Von Spielern zur Miete.
  const offers = db.listOffers(guildId, 1);
  const allOffers = offers.totalPages > 1
    ? Array.from({ length: offers.totalPages }, (_, i) => db.listOffers(guildId, i + 1).items).flat()
    : offers.items;

  for (const offer of allOffers) {
    if (brand && offer.brand !== brand) continue;
    entries.push({
      source: 'offer',
      key: `o${offer.offer_id}`,
      item: offer,
      rent: offer.offer_price,
      seller: offer.landlord_id,
      free: offer.taken ? 0 : 1,
    });
  }

  // Nach dem jeweils relevanten Preis sortieren.
  entries.sort((a, b) => (a.price ?? a.rent * 350) - (b.price ?? b.rent * 350));
  return entries;
}

async function buildPropertyShopView({ guildId, userId, page = 1, brand = null }) {
  const property = require('./property');
  const symbol = await getSymbol(guildId);

  const all = collectPropertyOffers(guildId, userId, brand);
  const PER_PAGE = 5;
  const totalPages = Math.max(1, Math.ceil(all.length / PER_PAGE));
  const p = Math.min(Math.max(1, Number(page) || 1), totalPages);
  const shown = all.slice((p - 1) * PER_PAGE, p * PER_PAGE);

  const slots = property.capacity(guildId, userId);
  const rental = db.getRental(guildId, userId);

  const embed = new EmbedBuilder()
    .setTitle(brand ? `🏘️ Immobilien · ${brand}` : '🏘️ Immobilienmarkt')
    .setColor(0x16a085);

  const actions = actionsRow(
    new ButtonBuilder()
      .setCustomId(ID.menu('estate', 1, userId))
      .setLabel('Mein Besitz').setEmoji('🔑')
      .setStyle(ButtonStyle.Secondary),
    brand ? new ButtonBuilder()
      .setCustomId(ID.menu('property', 1, userId))
      .setLabel('Alle Arten').setEmoji('🏘️')
      .setStyle(ButtonStyle.Secondary) : null,
  );

  if (all.length === 0) {
    embed.setDescription('Der Immobilienmarkt ist leer.');
    return { embeds: [embed], components: [navigationRow('property', 1, 1, userId), actions] };
  }

  const LABEL = {
    market: '🏢 Vom Markt',
    sale: '🧑 Von Spieler · Verkauf',
    offer: '🧑 Von Spieler · Miete',
    npcsale: '🧑‍💼 Privatverkauf',
    npcrent: '🧑‍💼 Privat zu vermieten',
  };

  embed.setDescription(shown.map((e) => {
    const i = e.item;
    const owned = db.getOwned(guildId, userId, i.id);
    const isRented = rental?.item_id === i.id;
    const mine = e.seller === userId;

    const lines = [
      `${i.emoji ? `${i.emoji} ` : ''}**${i.name}**` +
      (owned ? ' ✅ gekauft' : isRented ? ' 🔑 gemietet' : '') +
      (mine ? ' _(dein Angebot)_' : ''),
      LABEL[e.source] +
        (e.source.startsWith('npc') ? ` · ${e.seller}`
          : e.seller && !mine ? ` <@${e.seller}>` : ''),
    ];

    const priceParts = [];
    if (e.price) priceParts.push(`Kauf ${money(symbol, e.price)}`);
    if (e.rent) priceParts.push(`Miete ${money(symbol, e.rent)}/Tag`);
    lines.push(priceParts.join(' · '));

    const stock = e.free === Infinity ? '∞'
      : e.free === 0 ? '**vergeben**' : `noch ${e.free}`;
    lines.push(`${garageLabel(i.garage)} · ${stock}`);
    if (e.note) lines.push(`> _${e.note}_`);

    return lines.join('\n');
  }).join('\n\n'));

  embed.setFooter({
    text: `${all.length} Angebote · Deine Stellplätze: ${slots.used}/${slots.capacity} belegt · ` +
      '🔍 für Details und Aktionen',
  });

  const best = shown.reduce((a, b) => ((b.price ?? 0) > (a.price ?? 0) ? b : a));
  if (best.item.image_url) embed.setThumbnail(best.item.image_url);

  const detailRow = new ActionRowBuilder().addComponents(
    ...shown.map((e) =>
      new ButtonBuilder()
        .setCustomId(`pdet|${e.key}|${p}|${userId}`)
        .setLabel(e.item.name.slice(0, 40)).setEmoji('🔍')
        .setStyle(ButtonStyle.Secondary)));

  return {
    embeds: [embed],
    components: [navigationRow('property', p, totalPages, userId, null, brand), actions, detailRow],
  };
}

/**
 * Detailansicht eines Immobilien-Angebots.
 *
 * `key` trägt die Herkunft im Präfix: `m` = Katalog, `s` = Spieler-Verkauf,
 * `o` = Spieler-Mietangebot. So bleibt eine einzige Ansicht für alle drei
 * Quellen, und die Buttons passen sich an, was tatsächlich möglich ist.
 */
async function buildPropertyDetailView({ guildId, userId, key, page = 1 }) {
  const property = require('./property');
  const symbol = await getSymbol(guildId);

  const source = { m: 'market', s: 'sale', o: 'offer', n: 'npc' }[String(key)[0]] ?? 'market';
  const id = Number(String(key).slice(1)) || Number(key);

  const backRow = (extra = []) => new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(ID.menu('property', page, userId))
      .setLabel('Zurück').setEmoji('◀️')
      .setStyle(ButtonStyle.Secondary),
    ...extra,
    homeButton(userId),
  );

  const gone = (text) => ({
    embeds: [new EmbedBuilder()
      .setTitle('❌ Nicht mehr verfügbar').setDescription(text).setColor(0xe74c3c)],
    components: [backRow()],
  });

  // Quelle auflösen.
  let item, buyPrice = null, rentPrice = null, seller = null, free = 0, listingId = null, offerId = null;

  if (source === 'sale') {
    const listing = db.getListing(guildId, id);
    if (!listing) return gone('Dieses Verkaufsangebot gibt es nicht mehr.');
    item = listing;
    buyPrice = listing.listing_price;
    seller = listing.seller_id;
    listingId = listing.listing_id;
    free = 1;
  } else if (source === 'npc') {
    const n = db.getNpcListing(guildId, id);
    if (!n) return gone('Diese Anzeige gibt es nicht mehr.');
    item = n;
    if (n.mode === 'rent') rentPrice = n.npc_price; else buyPrice = n.npc_price;
    seller = n.seller;
    free = n.expires_at > Date.now() ? 1 : 0;
  } else if (source === 'offer') {
    const offer = db.getOffer(guildId, id);
    if (!offer) return gone('Dieses Mietangebot gibt es nicht mehr.');
    item = offer;
    rentPrice = offer.offer_price;
    seller = offer.landlord_id;
    offerId = offer.offer_id;
    free = db.offerTaken(guildId, offer.id, offer.landlord_id) ? 0 : 1;
  } else {
    item = db.getItem(guildId, id);
    if (!item || item.kind !== 'property') return gone('Dieses Objekt gibt es nicht mehr.');
    buyPrice = item.price;
    rentPrice = item.rent || null;
    free = property.available(guildId, item);
  }

  const owned = db.getOwned(guildId, userId, item.id);
  const rental = db.getRental(guildId, userId);
  const isRented = rental?.item_id === item.id;
  const slots = property.capacity(guildId, userId);
  const mine = seller === userId;

  const SOURCE_LABEL = {
    market: '🏢 Angebot des Marktes',
    sale: `🧑 Verkauf von <@${seller}>`,
    offer: `🧑 Vermietet von <@${seller}>`,
    npc: `🧑‍💼 Privatanzeige von ${seller}`,
  };

  const embed = new EmbedBuilder()
    .setTitle(`${item.emoji ? `${item.emoji} ` : ''}${item.name}`)
    .setDescription(`${SOURCE_LABEL[source]}\n\n${item.description || ''}`.trim())
    .setColor(source === 'market' ? 0x16a085 : 0x9b59b6)
    .addFields(
      { name: 'Kaufpreis', value: buyPrice ? money(symbol, buyPrice) : '—', inline: true },
      { name: 'Miete', value: rentPrice ? `${money(symbol, rentPrice)} / Tag` : '—', inline: true },
      { name: 'Garage', value: garageLabel(item.garage), inline: true },
      {
        name: 'Verfügbar',
        value: free === Infinity ? '∞' : source === 'market' ? `${free} von ${item.stock}`
          : free > 0 ? 'frei' : 'vergeben',
        inline: true,
      },
      { name: 'Art', value: item.brand || '—', inline: true },
      { name: 'Deine Stellplätze', value: `${slots.used}/${slots.capacity} belegt`, inline: true },
    );

  if (source === 'market' && buyPrice && rentPrice) {
    embed.addFields({
      name: 'Rechnet sich',
      value: `Nach ${Math.round(buyPrice / rentPrice)} Tagen Miete wäre der Kauf günstiger.`,
    });
  }

  if (owned) embed.addFields({ name: 'Status', value: '✅ Gehört bereits dir.' });
  else if (isRented) embed.addFields({ name: 'Status', value: '🔑 Du mietest dieses Objekt.' });
  else if (mine) embed.addFields({ name: 'Status', value: 'ℹ️ Das ist dein eigenes Angebot.' });

  if (item.image_url) embed.setImage(item.image_url);
  if (item.attribution) embed.setAuthor({ name: item.attribution });

  const buttons = [];

  if (source === 'npc') {
    if (item.note) {
      embed.addFields({ name: 'Aus der Anzeige', value: `_${item.note}_` });
    }
    if (buyPrice) {
      buttons.push(new ButtonBuilder()
        .setCustomId(`npbuy|${item.npc_id}|${userId}`)
        .setLabel(`Kaufen für ${buyPrice.toLocaleString('de-DE')}`).setEmoji('💰')
        .setStyle(ButtonStyle.Success)
        .setDisabled(free <= 0 || !!owned));
    }
    if (rentPrice) {
      buttons.push(new ButtonBuilder()
        .setCustomId(`nprent|${item.npc_id}|${userId}`)
        .setLabel(`Mieten für ${rentPrice.toLocaleString('de-DE')}/Tag`).setEmoji('🔑')
        .setStyle(ButtonStyle.Primary)
        .setDisabled(free <= 0));
    }
  } else if (source === 'sale' && !mine) {
    buttons.push(new ButtonBuilder()
      .setCustomId(`psale|${listingId}|${userId}`)
      .setLabel(`Kaufen für ${buyPrice.toLocaleString('de-DE')}`).setEmoji('💰')
      .setStyle(ButtonStyle.Success));
  } else if (source === 'offer' && !mine) {
    buttons.push(new ButtonBuilder()
      .setCustomId(`poffer|${offerId}|${userId}`)
      .setLabel(`Mieten für ${rentPrice.toLocaleString('de-DE')}/Tag`).setEmoji('🔑')
      .setStyle(ButtonStyle.Primary)
      .setDisabled(free <= 0));
  } else if (source === 'market') {
    if (!owned) {
      buttons.push(new ButtonBuilder()
        .setCustomId(`pbuy|${item.id}|${userId}`)
        .setLabel(`Kaufen für ${buyPrice.toLocaleString('de-DE')}`).setEmoji('💰')
        .setStyle(ButtonStyle.Success)
        .setDisabled(free <= 0));
    }
    if (rentPrice && !owned && !isRented) {
      buttons.push(new ButtonBuilder()
        .setCustomId(`prent|${item.id}|${userId}`)
        .setLabel(`Mieten für ${rentPrice.toLocaleString('de-DE')}/Tag`).setEmoji('🔑')
        .setStyle(ButtonStyle.Primary)
        .setDisabled(free <= 0));
    }
  }

  return { embeds: [embed], components: [backRow(buttons)] };
}

/** Übersicht über Besitz, Mietvertrag und Stellplätze. */
async function buildEstateView({ guildId, userId }) {
  const property = require('./property');
  const symbol = await getSymbol(guildId);

  const owned = db.listOwnedProperties(guildId, userId);
  const rental = db.getRental(guildId, userId);
  const slots = property.capacity(guildId, userId);

  const embed = new EmbedBuilder()
    .setTitle('🔑 Mein Besitz')
    .setColor(0x16a085);

  const parts = [];

  if (owned.length) {
    parts.push('**Gekauft**\n' + owned.map((i) =>
      `${i.emoji ? `${i.emoji} ` : ''}**${i.name}**  \`ID ${i.id}\`\n` +
      `${money(symbol, i.price)} · ${garageLabel(i.garage)}`).join('\n\n') +
      '\n_Verkaufen: `/sell <ID> <preis>` · Vermieten: `/rentout <ID> <preis>`_');
  }

  if (rental) {
    const dueIn = rental.paid_through - Date.now();
    const hours = Math.max(0, Math.floor(dueIn / 3600000));
    // Der vereinbarte Preis kann vom Katalogwert abweichen.
    const daily = rental.agreed_rent || rental.catalog_rent;
    parts.push('**Gemietet**\n' +
      `${rental.emoji ? `${rental.emoji} ` : ''}**${rental.name}** · ` +
      `${money(symbol, daily)}/Tag · ${garageLabel(rental.garage)}\n` +
      (rental.landlord_id ? `Vermieter: <@${rental.landlord_id}>\n` : 'Vom Markt\n') +
      `Nächste Miete in ${hours} h · bisher gezahlt: ${money(symbol, rental.paid_total)}`);
  }

  // Eigene Mietangebote.
  const offers = db.listOffersOf(guildId, userId);
  if (offers.length) {
    parts.push('**Vermietet**\n' + offers.map((o) => {
      // Bei belegten Angeboten den Mieter nennen (NPC oder Spieler).
      let status = '✅ frei';
      if (o.taken) {
        const tenant = db.tenantOfOffer(guildId, o.id, userId);
        status = tenant?.tenant_name
          ? `🚫 an ${tenant.tenant_name}`
          : tenant ? `🚫 an <@${tenant.user_id}>` : '🚫 belegt';
      }
      return `${o.emoji ? `${o.emoji} ` : ''}**${o.name}** · ${money(symbol, o.offer_price)}/Tag · ` +
        `${status} · \`Angebot ${o.offer_id}\``;
    }).join('\n') +
      '\n_Vermietete Objekte bringen dir keine Stellplätze, aber Mieteinnahmen._');
  }

  // Eigene Verkaufsinserate.
  const forSale = db.allListingsOfKind(guildId, 'property')
    .filter((l) => l.seller_id === userId);
  if (forSale.length) {
    parts.push('**Zum Verkauf**\n' + forSale.map((l) =>
      `${l.emoji ? `${l.emoji} ` : ''}**${l.name}** · ${money(symbol, l.listing_price)} · ` +
      `\`Inserat ${l.listing_id}\``).join('\n') +
      '\n_Inserierte Objekte sind aus deinem Besitz, bis sie verkauft oder zurückgezogen sind._');
  }

  // Warnung bei Überkapazität.
  const grace = db.getGrace(guildId, userId);
  if (grace) {
    const property2 = require('./property');
    const left = grace.since + property2.GRACE_DAYS * 24 * 3600000 - Date.now();
    const days = Math.max(0, Math.floor(left / (24 * 3600000)));
    const hours = Math.max(0, Math.floor((left % (24 * 3600000)) / 3600000));
    parts.push(
      `⚠️ **Zu wenig Stellplätze!**\nNoch ${days} Tage ${hours} h, dann werden ` +
      'zufällige Autos zwangsverkauft (40–95 % vom Kaufpreis).');
  }

  if (!owned.length && !rental) {
    parts.push('_Du besitzt und mietest noch nichts._\nSchau dich im Immobilienmarkt um.');
  }

  parts.push(
    '**Stellplätze**\n' +
    `${'▰'.repeat(Math.min(slots.used, 20))}${'▱'.repeat(Math.max(0, Math.min(slots.free, 20)))}\n` +
    `${slots.used} von ${slots.capacity} belegt · ${slots.free} frei\n` +
    `Straße ${slots.street} · gekauft ${slots.owned} · gemietet ${slots.rented}`);

  embed.setDescription(parts.join('\n\n'));

  if (slots.free === 0) {
    embed.setFooter({ text: 'Garage voll – für weitere Autos brauchst du mehr Stellplätze.' });
  }

  const actions = actionsRow(
    new ButtonBuilder()
      .setCustomId(ID.menu('property', 1, userId))
      .setLabel('Immobilienmarkt').setEmoji('🏘️')
      .setStyle(ButtonStyle.Secondary),
    rental ? new ButtonBuilder()
      .setCustomId(`prentcancel|${userId}`)
      .setLabel('Kündigen').setEmoji('🚪')
      .setStyle(ButtonStyle.Danger) : null,
    homeButton(userId),
  );

  const rows = [actions];

  // Zurückziehen-Buttons für eigene Angebote.
  if (offers.length) {
    rows.push(new ActionRowBuilder().addComponents(
      ...offers.slice(0, 5).map((o) =>
        new ButtonBuilder()
          .setCustomId(`pofferdel|${o.offer_id}|${userId}`)
          .setLabel(`${o.name}`.slice(0, 40)).setEmoji('↩️')
          .setStyle(ButtonStyle.Danger))));
  }

  return { embeds: [embed], components: rows };
}

// --------------------------------------------------------------- Arbeitsamt

/** Tagesangebot des Arbeitsamts mit Bewerbungs-Buttons. */
async function buildJobCenterView({ guildId, userId }) {
  const jobs = require('./jobs');
  const symbol = await getSymbol(guildId);

  const offers = jobs.dailyOffers(guildId, userId);
  const current = jobs.currentJob(guildId, userId);
  const refreshIn = jobs.msUntilRefresh();
  const hours = Math.floor(refreshIn / 3600000);
  const minutes = Math.floor((refreshIn % 3600000) / 60000);

  const embed = new EmbedBuilder()
    .setTitle('💼 Arbeitsamt')
    .setColor(0x5865f2)
    .setFooter({ text: `Neues Angebot in ${hours} h ${minutes} min · nur heute gültig` });

  const budget = jobs.shiftBudget(guildId, userId);

  if (current) {
    embed.addFields({
      name: 'Deine Anstellung',
      value: `${current.job.emoji} **${current.job.title}** · ` +
        `${money(symbol, current.job.pay)} pro Schicht\n` +
        `${current.employment.shifts} Schichten insgesamt · ` +
        `${money(symbol, current.employment.earned)} verdient`,
    });
    embed.addFields({
      name: 'Heute gearbeitet',
      value: `${'▰'.repeat(budget.done)}${'▱'.repeat(budget.left)}  ` +
        `${budget.done}/${budget.max} Schichten · ${budget.hours}/${budget.maxHours} Stunden` +
        (budget.left === 0 ? '\n🛌 Feierabend – morgen geht es weiter.' : ''),
    });
  }

  embed.setDescription(
    (current ? '' : '_Du bist arbeitslos._\n\n') +
    '**Heutige Stellenangebote**\n' +
    offers.map((job) => {
      const check = jobs.checkRequirements(guildId, userId, job);
      const reqs = jobs.requirementLabels(job);
      const mark = check.ok ? '✅' : '🔒';
      return `${mark} ${job.emoji} **${job.title}** — ${money(symbol, job.pay)} / Schicht\n` +
        `${jobs.TIER_LABEL[job.tier]} · alle ${job.cooldown} min` +
        (reqs.length ? `\n> Braucht: ${reqs.join(', ')}` : '') +
        (check.missing.length ? `\n> ❌ Dir fehlt: ${check.missing.join(', ')}` : '');
    }).join('\n\n'));

  // Bewerbungs-Buttons: gesperrt, wenn Voraussetzungen fehlen.
  const applyRow = new ActionRowBuilder().addComponents(
    ...offers.map((job) => {
      const check = jobs.checkRequirements(guildId, userId, job);
      return new ButtonBuilder()
        .setCustomId(`apply|${job.id}|${userId}`)
        .setLabel(job.title.slice(0, 40))
        .setEmoji(check.ok ? '📝' : '🔒')
        .setStyle(check.ok ? ButtonStyle.Success : ButtonStyle.Secondary)
        .setDisabled(!check.ok || current?.job.id === job.id);
    }));

  const actions = actionsRow(
    new ButtonBuilder()
      .setCustomId(`shift|${userId}`)
      .setLabel(budget.left > 0
        ? `Schicht arbeiten (${budget.left} übrig)`
        : 'Heute fertig')
      .setEmoji(budget.left > 0 ? '⚒️' : '🛌')
      .setStyle(ButtonStyle.Primary)
      .setDisabled(!current || budget.left === 0),
    new ButtonBuilder()
      .setCustomId(ID.menu('gear', 1, userId))
      .setLabel('Ausrüstung kaufen').setEmoji('🧰')
      .setStyle(ButtonStyle.Secondary),
    current ? new ButtonBuilder()
      .setCustomId(`quitjob|${userId}`)
      .setLabel('Kündigen').setEmoji('🚪')
      .setStyle(ButtonStyle.Danger) : null,
    homeButton(userId),
  );

  return { embeds: [embed], components: [applyRow, actions] };
}

// ------------------------------------------------------------------- Garage

async function buildGarageView({ guildId, userId, targetId = null, page = 1 }) {
  const owner = targetId ?? userId;
  const symbol = await getSymbol(guildId);
  const { items, total, totalPages, page: p } =
    fetchPage((n) => db.listInventory(guildId, owner, n), page);

  const embed = new EmbedBuilder().setTitle('🅿️ Garage').setColor(0x3498db);

  if (total === 0) {
    embed.setDescription(
      owner === userId
        ? 'Deine Garage ist leer. Ab ins Autohaus!\n' +
          '_Ausrüstung findest du unter 🧰, Immobilien unter 🔑 Mein Besitz._'
        : `<@${owner}> hat noch kein Auto.`);
    return { embeds: [embed], components: [navigationRow('garage', 1, 1, userId)] };
  }

  const cond = require('./condition');
  const street = require('./street');
  const { outside } = street.parkedOutside(guildId, owner);
  const outsideIds = new Set(outside.map((c) => c.id));

  embed.setDescription(items.map((i) => {
    const c = i.condition ?? 100;
    const where = outsideIds.has(i.id) ? '🌧️ Straße' : '🏠 Garage';
    return `${i.emoji ? `${i.emoji} ` : ''}**${i.name}**  \`ID ${i.id}\` · ${where}\n` +
      `${cond.labelDetailed(c)} · Wert ${money(symbol, cond.currentValue(i.price, c))}` +
      (c < 100 ? ` _(neu ${money(symbol, i.price)})_` : '');
  }).join('\n\n'));

  embed.addFields({
    name: 'Gesamtwert', value: money(symbol, db.garageValue(guildId, owner)),
  });

  if (outside.length) {
    embed.addFields({
      name: '⚠️ Steht draußen',
      value: `${outside.length} ${outside.length === 1 ? 'Auto' : 'Autos'} auf der Straße — ` +
        'kann zerkratzt, beschädigt oder gestohlen werden. Eine Garage schützt.',
    });
  }

  embed.setFooter({ text: `Besitzer: ${owner === userId ? 'du' : 'anderer Spieler'} · Verkaufen: /sell` });

  const best = items.reduce((a, b) => (b.price > a.price ? b : a));
  if (best.image_url) embed.setThumbnail(best.image_url);

  return { embeds: [embed], components: [navigationRow('garage', p, totalPages, userId)] };
}

// ------------------------------------------------------------ Eigene Inserate

async function buildListingsView({ guildId, userId }) {
  const symbol = await getSymbol(guildId);

  const mine = [];
  const first = db.listListings(guildId, 1);
  for (let p = 1; p <= first.totalPages; p++) {
    for (const l of db.listListings(guildId, p).items) {
      if (l.seller_id === userId) mine.push(l);
    }
  }

  const embed = new EmbedBuilder().setTitle('📋 Deine Inserate').setColor(0x95a5a6);

  if (mine.length === 0) {
    embed.setDescription('Du hast keine Inserate. Mit `/sell <auto-id> <preis>` erstellst du eins.');
    return { embeds: [embed], components: [new ActionRowBuilder().addComponents(homeButton(userId))] };
  }

  embed.setDescription(mine.map((l) =>
    `${l.emoji ? `${l.emoji} ` : ''}**${l.name}** — ${money(symbol, l.listing_price)}\n` +
    `\`Inserat ${l.listing_id}\` · Neupreis ${money(symbol, l.price)}`).join('\n\n'));
  embed.setFooter({ text: `${mine.length} von ${db.MAX_LISTINGS_PER_USER} Plätzen belegt` });

  // Zurückziehen-Buttons, 5 pro Zeile; eine Zeile bleibt fürs Hauptmenü frei.
  const rows = [];
  for (let i = 0; i < mine.length && rows.length < 4; i += 5) {
    rows.push(new ActionRowBuilder().addComponents(
      ...mine.slice(i, i + 5).map((l) =>
        new ButtonBuilder()
          .setCustomId(`ucancel|${l.listing_id}|${userId}`)
          .setLabel(l.name.slice(0, 40)).setEmoji('↩️')
          .setStyle(ButtonStyle.Danger))));
  }
  rows.push(new ActionRowBuilder().addComponents(homeButton(userId)));

  return { embeds: [embed], components: rows };
}

// -------------------------------------------------------------- Postfach

const MESSAGE_STYLE = {
  offer: { emoji: '🤝', label: 'Kaufangebot', color: 0x9b59b6 },
  sold: { emoji: '✅', label: 'Verkauft', color: 0x2ecc71 },
  bill: { emoji: '🧾', label: 'Rechnung', color: 0xe74c3c },
  info: { emoji: '📨', label: 'Nachricht', color: 0x95a5a6 },
};

/** Postfach: Kaufangebote, Verkaufsmeldungen und Rechnungen. */
async function buildInboxView({ guildId, userId, page = 1 }) {
  const symbol = await getSymbol(guildId);
  db.expireMessages(guildId);

  const { items, total, totalPages, page: p } =
    fetchPage((n) => db.listMessages(guildId, userId, n), page);

  const embed = new EmbedBuilder().setTitle('📬 Postfach').setColor(0x5865f2);

  if (total === 0) {
    embed.setDescription(
      'Keine neuen Nachrichten.\n\n' +
      '_Hier landen Kaufangebote für deine Inserate, Verkaufsmeldungen und Rechnungen._');
    return {
      embeds: [embed],
      components: [new ActionRowBuilder().addComponents(homeButton(userId))],
    };
  }

  const blocks = items.map((m) => {
    const style = MESSAGE_STYLE[m.type] ?? MESSAGE_STYLE.info;
    const unread = m.read_at ? '' : ' 🔵';
    const lines = [`${style.emoji} **${m.title}**${unread}  \`#${m.id}\``];

    if (m.amount) {
      lines.push(m.type === 'bill'
        ? `Forderung: ${money(symbol, m.amount)}`
        : `Betrag: ${money(symbol, m.amount)}`);
    }
    // Lange Texte (z.B. Patchnotes) kürzen, damit die Beschreibung nicht
    // über das Discord-Limit von 4096 Zeichen läuft.
    if (m.body) {
      const body = m.body.length > 900 ? `${m.body.slice(0, 900)}…` : m.body;
      lines.push(`> ${body.replace(/\n/g, '\n> ')}`);
    }

    if (m.expires_at) {
      const left = m.expires_at - Date.now();
      const hours = Math.max(0, Math.floor(left / 3600000));
      lines.push(m.type === 'bill'
        ? `_Zahlbar innerhalb von ${hours} h_`
        : `_Gültig noch ${hours} h_`);
    }
    return lines.join('\n');
  });

  // Nur so viele Blöcke zeigen, wie ins Embed passen – der Rest bleibt über
  // die Blätter-Buttons erreichbar.
  const shown = [];
  let used = 0;
  for (const block of blocks) {
    if (used + block.length + 2 > 3900) break;
    shown.push(block);
    used += block.length + 2;
  }
  if (shown.length < blocks.length) {
    shown.push(`_… ${blocks.length - shown.length} weitere auf dieser Seite ausgeblendet._`);
  }
  embed.setDescription(shown.join('\n\n'));

  const unread = db.countUnread(guildId, userId);
  embed.setFooter({
    text: `${total} offen${unread ? ` · ${unread} ungelesen` : ''} · Seite ${p}/${totalPages}`,
  });

  // "Leeren" sitzt im freien Slot der Navigationszeile – spart eine Reihe.
  const deletable = items.filter((m) => m.type !== 'bill');
  const clearButton = db.countDeletable(guildId, userId) > 0
    ? new ButtonBuilder()
      .setCustomId(`mclear|${userId}`).setLabel('Leeren').setEmoji('🧹')
      .setStyle(ButtonStyle.Danger)
    : null;

  const rows = [navigationRow('inbox', p, totalPages, userId, clearButton)];

  // Aktionen: Angebote annehmen/ablehnen, Rechnungen bezahlen.
  const actionable = items.filter((m) => m.type === 'offer' || m.type === 'bill');
  for (const m of actionable.slice(0, 2)) {
    if (m.type === 'offer') {
      rows.push(new ActionRowBuilder().addComponents(
        new ButtonBuilder()
          .setCustomId(`oaccept|${m.id}|${userId}`)
          .setLabel(`Annehmen: ${m.amount.toLocaleString('de-DE')}`).setEmoji('✅')
          .setStyle(ButtonStyle.Success),
        new ButtonBuilder()
          .setCustomId(`odecline|${m.id}|${userId}`)
          .setLabel(`Ablehnen: ${m.title.slice(0, 25)}`).setEmoji('❌')
          .setStyle(ButtonStyle.Secondary),
      ));
    } else {
      rows.push(new ActionRowBuilder().addComponents(
        new ButtonBuilder()
          .setCustomId(`bpay|${m.id}|${userId}`)
          .setLabel(`Bezahlen: ${m.amount.toLocaleString('de-DE')}`).setEmoji('🧾')
          .setStyle(ButtonStyle.Danger),
      ));
    }
  }

  // Einzelne Nachrichten wegräumen (Rechnungen nicht – das sind Schulden).
  if (deletable.length && rows.length < 5) {
    rows.push(new ActionRowBuilder().addComponents(...deletable.slice(0, 5).map((m) =>
      new ButtonBuilder()
        .setCustomId(`mdel|${m.id}|${userId}`)
        .setLabel(m.title.slice(0, 35)).setEmoji('🗑️')
        .setStyle(ButtonStyle.Secondary))));
  }

  // Gelesen markieren, sobald das Postfach geöffnet wurde.
  db.markMessagesRead(guildId, userId);

  return { embeds: [embed], components: rows };
}

// ------------------------------------------------------------------ Guthaben

async function buildBalanceView({ guildId, userId, targetId = null }) {
  const { getBalance } = require('./unb');
  const owner = targetId ?? userId;
  const [bal, symbol] = await Promise.all([
    getBalance(guildId, owner), getSymbol(guildId),
  ]);

  const embed = new EmbedBuilder()
    .setTitle('💰 Guthaben')
    .setDescription(`<@${owner}>`)
    .addFields(
      { name: 'Bargeld', value: money(symbol, bal.cash), inline: true },
      { name: 'Bank', value: money(symbol, bal.bank), inline: true },
      { name: 'Gesamt', value: money(symbol, bal.total), inline: true },
      { name: 'Garagenwert', value: money(symbol, db.garageValue(guildId, owner)), inline: true },
    )
    .setColor(0xf1c40f);

  return { embeds: [embed], components: [new ActionRowBuilder().addComponents(homeButton(userId))] };
}

// -------------------------------------------------------------------- Profil

const JOBS_BY_ID = new Map(require('./data/jobs').map((j) => [j.id, j]));

/** Ein einfacher Fortschrittsbalken aus Block-Zeichen. */
function progressBar(ratio, width = 12) {
  const filled = Math.max(0, Math.min(width, Math.round((ratio || 0) * width)));
  return '█'.repeat(filled) + '░'.repeat(width - filled);
}

/**
 * Steckbrief eines Spielers zum Angeben: Level, Vermögen, dickstes Auto,
 * teuerste Immobilie, Beruf und ein frei setzbarer Spruch.
 */
async function buildProfileView({ guildId, userId, targetId = null }) {
  const level = require('./level');
  const cond = require('./condition');
  const { getBalance } = require('./unb');
  const owner = targetId ?? userId;
  const isSelf = owner === userId;
  const symbol = await getSymbol(guildId);

  const bal = await getBalance(guildId, owner).catch(() => null);
  const garage = db.garageValue(guildId, owner);
  const realty = db.propertyValue(guildId, owner);
  const liquid = bal ? bal.total : 0;
  const networth = liquid + garage + realty;

  const stats = db.getStats(guildId, owner);
  const prog = level.progress(stats.xp);

  const car = db.getMostValuable(guildId, owner);
  const topProp = db.listOwnedProperties(guildId, owner)[0] ?? null;
  const emp = db.getEmployment(guildId, owner);
  const job = emp ? JOBS_BY_ID.get(emp.job_id) : null;

  const embed = new EmbedBuilder()
    .setTitle('👤 Profil')
    .setColor(0xf1c40f)
    .setDescription(
      `<@${owner}>` + (stats.tagline ? `\n> _${stats.tagline}_` : ''));

  embed.addFields(
    {
      name: '🏆 Level',
      value: `**${prog.level}**\n${progressBar(prog.ratio)}\n` +
        `${prog.into.toLocaleString('de-DE')} / ${prog.needed.toLocaleString('de-DE')} XP`,
      inline: true,
    },
    { name: '💰 Networth', value: money(symbol, networth), inline: true },
    { name: '​', value: '​', inline: true },
    { name: '📈 Einnahmen', value: money(symbol, stats.income_total), inline: true },
    { name: '📉 Ausgaben', value: money(symbol, stats.expense_total), inline: true },
    { name: '​', value: '​', inline: true },
    {
      name: '🚗 Dickstes Auto',
      value: car
        ? `${car.emoji ? `${car.emoji} ` : ''}**${car.name}**\n` +
          money(symbol, cond.currentValue(car.price, car.condition ?? 100))
        : '—',
      inline: true,
    },
    {
      name: '🏠 Teuerste Immobilie',
      value: topProp
        ? `${topProp.emoji ? `${topProp.emoji} ` : ''}**${topProp.name}**\n${money(symbol, topProp.price)}`
        : '—',
      inline: true,
    },
    {
      name: '💼 Beruf',
      value: job
        ? `${job.emoji} **${job.title}**\n${emp.shifts} ${emp.shifts === 1 ? 'Schicht' : 'Schichten'}`
        : '💤 Arbeitslos',
      inline: true,
    },
  );

  // Storage-Wars-Sammlung, falls vorhanden (mit dem wertvollsten Stück als Flex).
  const collection = db.lootSummary(guildId, owner);
  if (collection.n > 0) {
    const best = db.listLoot(guildId, owner)[0];
    const bestR = best ? require('./data/storage').rarityOf(best.rarity) : null;
    embed.addFields({
      name: '🏺 Sammlung',
      value: `${collection.n} ${collection.n === 1 ? 'Fundstück' : 'Fundstücke'} · ` +
        `Schätzwert ${money(symbol, collection.value)}` +
        (best ? `\nTop: ${bestR.emoji} ${best.name} _(${bestR.label})_` : ''),
      inline: true,
    });
  }

  // Custom-Emoji-Symbole rendern im Footer nicht – dort die Textvariante nutzen.
  const footSym = plainSymbol(symbol);
  embed.setFooter({
    text: bal
      ? `Bar ${money(footSym, bal.cash)} · Bank ${money(footSym, bal.bank)} · ` +
        `Autos ${money(footSym, garage)} · Immobilien ${money(footSym, realty)}`
      : 'Guthaben gerade nicht abrufbar',
  });

  // Großes Foto der teuersten Immobilie (Flex!), kleines Thumbnail vom Auto.
  if (topProp && topProp.image_url) embed.setImage(topProp.image_url);
  else if (car && car.image_url) embed.setImage(car.image_url);
  if (car && car.image_url) embed.setThumbnail(car.image_url);

  const row = new ActionRowBuilder();
  if (isSelf) {
    row.addComponents(new ButtonBuilder()
      .setCustomId(`flexedit|${userId}`)
      .setLabel('Spruch setzen').setEmoji('✏️')
      .setStyle(ButtonStyle.Secondary));
  }
  row.addComponents(homeButton(userId));

  return { embeds: [embed], components: [row] };
}

// ---------------------------------------------------------------- Rangliste

const LB_METRICS = {
  level: { label: 'Level', emoji: '🏆' },
  income: { label: 'Einnahmen', emoji: '📈' },
  expense: { label: 'Ausgaben', emoji: '📉' },
  networth: { label: 'Networth', emoji: '💰' },
};
const LB_PAGE = 10;
// Networth kostet je Spieler eine API-Abfrage – für die Networth-Sortierung
// müssen wir alle abfragen, deshalb hier gedeckelt.
const LB_MAX_NETWORTH = 50;

async function buildLeaderboardView({ guildId, userId, metric = 'level', page = 1 }) {
  const level = require('./level');
  const { getBalance } = require('./unb');
  const symbol = await getSymbol(guildId);
  if (!LB_METRICS[metric]) metric = 'level';

  let roster = db.listStats(guildId).map((s) => ({
    userId: s.user_id,
    xp: s.xp,
    lvl: level.levelForXp(s.xp),
    income: s.income_total,
    expense: s.expense_total,
    networth: null,
  }));

  // Guthaben (und damit Networth) nur bei Bedarf holen – je Zeile eine Abfrage.
  const fillNetworth = (rows) => Promise.all(rows.map(async (r) => {
    if (r.networth !== null) return;
    const bal = await getBalance(guildId, r.userId).catch(() => null);
    r.networth = (bal ? bal.total : 0)
      + db.garageValue(guildId, r.userId)
      + db.propertyValue(guildId, r.userId);
  }));

  const embed = new EmbedBuilder()
    .setTitle(`🏆 Rangliste — ${LB_METRICS[metric].label}`)
    .setColor(0xf1c40f);

  if (roster.length === 0) {
    embed.setDescription('Noch keine Daten. Verdiene oder gib Geld aus, dann tauchst du hier auf!');
  }

  if (metric === 'networth') {
    roster = roster.slice(0, LB_MAX_NETWORTH);
    await fillNetworth(roster);
    roster.sort((a, b) => b.networth - a.networth);
  } else {
    const key = { level: 'lvl', income: 'income', expense: 'expense' }[metric];
    roster.sort((a, b) => (b[key] - a[key]) || (b.xp - a.xp));
  }

  const totalPages = Math.max(1, Math.ceil(roster.length / LB_PAGE));
  const p = Math.min(Math.max(1, Number(page) || 1), totalPages);
  const slice = roster.slice((p - 1) * LB_PAGE, p * LB_PAGE);
  if (metric !== 'networth') await fillNetworth(slice);

  const medal = (rank) => ['🥇', '🥈', '🥉'][rank - 1] ?? `**#${rank}**`;

  if (roster.length > 0) {
    embed.setDescription(slice.map((r, i) => {
      const rank = (p - 1) * LB_PAGE + i + 1;
      const you = r.userId === userId ? ' ⬅️ **du**' : '';
      return `${medal(rank)} <@${r.userId}>${you}\n` +
        `🏆 Lvl ${r.lvl} · 📈 ${money(symbol, r.income)} · ` +
        `📉 ${money(symbol, r.expense)} · 💰 ${money(symbol, r.networth ?? 0)}`;
    }).join('\n\n'));
  }

  const metricRow = new ActionRowBuilder().addComponents(
    ...Object.entries(LB_METRICS).map(([key, m]) =>
      new ButtonBuilder()
        .setCustomId(`lb|${key}|1|${userId}`)
        .setLabel(m.label).setEmoji(m.emoji)
        .setStyle(key === metric ? ButtonStyle.Primary : ButtonStyle.Secondary)));

  const navRow = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(`lb|${metric}|${p - 1}|${userId}`)
      .setLabel('Zurück').setEmoji('◀️')
      .setStyle(ButtonStyle.Secondary).setDisabled(p <= 1),
    new ButtonBuilder()
      .setCustomId('noop').setLabel(`${p} / ${totalPages}`)
      .setStyle(ButtonStyle.Secondary).setDisabled(true),
    new ButtonBuilder()
      .setCustomId(`lb|${metric}|${p + 1}|${userId}`)
      .setLabel('Weiter').setEmoji('▶️')
      .setStyle(ButtonStyle.Secondary).setDisabled(p >= totalPages),
    homeButton(userId),
  );

  return { embeds: [embed], components: [metricRow, navRow] };
}

// -------------------------------------------------------------- Auktionshaus

/** Kurze, menschliche Restzeit-Angabe. */
function timeLeft(ms) {
  if (ms <= 0) return 'gleich';
  const totalMin = Math.floor(ms / 60000);
  if (totalMin >= 60) return `${Math.floor(totalMin / 60)} h ${totalMin % 60} min`;
  if (totalMin >= 1) return `${totalMin} min`;
  return `${Math.floor(ms / 1000)} s`;
}

const TIER_LABEL = (id) =>
  require('./data/storage').TIERS.find((t) => t.id === id)?.label ?? 'Garage';

/** Storage Wars: die laufende Auktionsrunde mit der aktuell live Garage. */
async function buildAuctionView({ guildId, userId }) {
  const storage = require('./storage');
  const symbol = await getSymbol(guildId);
  const now = Date.now();

  // Faul: fällige Lose abrechnen und dafür sorgen, dass eine Runde läuft.
  await storage.settle(guildId, userId, now).catch(() => {});
  storage.ensureRound(guildId, now);

  const embed = new EmbedBuilder().setTitle('🏬 Auktionshaus').setColor(0x8e44ad);

  // Untere Reihe: Sammlung, ggf. verschlossene Garagen, Hauptmenü.
  const bottomRow = () => {
    const row = new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId(`scol|${userId}`).setLabel('Meine Sammlung').setEmoji('🔎')
        .setStyle(ButtonStyle.Secondary));
    const garages = db.countGarages(guildId, userId);
    if (garages > 0) {
      row.addComponents(new ButtonBuilder()
        .setCustomId(`sgar|${userId}`).setLabel(`Meine Garagen (${garages})`).setEmoji('🔓')
        .setStyle(ButtonStyle.Primary));
    }
    return row.addComponents(homeButton(userId));
  };

  const round = db.activeRound(guildId, now);
  if (!round) {
    embed.setDescription(
      'Gerade läuft keine Auktion. Die nächste Runde kommt bald – schau später wieder rein.');
    return { embeds: [embed], components: [bottomRow()] };
  }

  const lots = db.listRoundLots(guildId, round.id);
  const live = lots.find((l) => storage.isLive(l, now));
  const upcoming = lots.filter((l) => l.opens_at > now);

  const rows = [];
  if (live) {
    const bid = live.top_bid > 0 ? live.top_bid : null;
    embed.setDescription(
      `**Garage #${live.seq + 1}** — _${TIER_LABEL(live.tier)}_\n` +
      `Angeboten von ${live.seller}.\n\n` +
      (live.hint ? `🕵️ _${live.hint}_\n` : '') +
      (live.peek ? `👀 ${live.peek}\n` : '') +
      `\n⏳ Noch **${timeLeft(live.ends_at - now)}** zum Bieten.`);
    embed.addFields(
      { name: bid ? 'Höchstgebot' : 'Startpreis', value: money(symbol, bid ?? live.start_price), inline: true },
      { name: 'Mindestgebot', value: money(symbol, storage.minBid(live)), inline: true },
    );
    if (bid) embed.addFields({ name: 'Höchstbietender', value: `<@${live.top_bidder}>`, inline: true });

    rows.push(new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId(`sbid|${live.id}|min|${userId}`)
        .setLabel(`Bieten (${storage.minBid(live).toLocaleString('de-DE')})`).setEmoji('💰')
        .setStyle(ButtonStyle.Success),
      new ButtonBuilder()
        .setCustomId(`sbidmod|${live.id}|${userId}`)
        .setLabel('Eigenes Gebot').setEmoji('✏️').setStyle(ButtonStyle.Primary),
    ));
  } else {
    embed.setDescription('Zwischen zwei Garagen … gleich geht die nächste los.');
  }

  if (upcoming.length) {
    embed.addFields({
      name: 'Als Nächstes',
      value: upcoming.slice(0, 5)
        .map((l) => `🔒 Garage #${l.seq + 1} — in ${timeLeft(l.opens_at - now)}`).join('\n'),
    });
  }

  embed.setFooter({ text: `Runde mit ${round.size} Garagen · Ersteigertes landet verschlossen bei „Meine Garagen"` });
  rows.push(bottomRow());

  return { embeds: [embed], components: rows };
}

/** Ersteigerte, noch verschlossene Garagen – hier öffnet der Spieler sie. */
async function buildGaragesView({ guildId, userId }) {
  const symbol = await getSymbol(guildId);
  const garages = db.listGarages(guildId, userId);

  const embed = new EmbedBuilder().setTitle('🔓 Meine Garagen').setColor(0x8e44ad);
  const navRow = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId(`sauc|${userId}`).setLabel('Auktionshaus').setEmoji('🏬')
      .setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId(`scol|${userId}`).setLabel('Sammlung').setEmoji('🔎')
      .setStyle(ButtonStyle.Secondary),
    homeButton(userId));

  if (!garages.length) {
    embed.setDescription('Keine verschlossenen Garagen. Ersteigere eine im 🏬 Auktionshaus!');
    return { embeds: [embed], components: [navRow] };
  }

  embed.setDescription(
    'Ersteigert, aber noch **verschlossen** – was drin ist, weißt du erst beim Öffnen. Trau dich!\n\n' +
    garages.map((g) => `📦 **${g.label}** — bezahlt ${money(symbol, g.price)} \`#${g.id}\``).join('\n'));
  embed.setFooter({ text: `${garages.length} verschlossene ${garages.length === 1 ? 'Garage' : 'Garagen'}` });

  const rows = [];
  rows.push(new ActionRowBuilder().addComponents(...garages.slice(0, 5).map((g) =>
    new ButtonBuilder()
      .setCustomId(`sopen|${g.id}|${userId}`)
      .setLabel(`${g.label} öffnen`.slice(0, 40)).setEmoji('🔓').setStyle(ButtonStyle.Success))));
  rows.push(navRow);

  return { embeds: [embed], components: rows };
}

/** Die eigene Fundstück-Sammlung mit Verkaufs-Optionen (Hehler). */
async function buildCollectionView({ guildId, userId }) {
  const symbol = await getSymbol(guildId);
  const loot = db.listLoot(guildId, userId);
  const summary = db.lootSummary(guildId, userId);

  const embed = new EmbedBuilder().setTitle('🏺 Deine Sammlung').setColor(0x8e44ad);
  const backRow = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId(`sauc|${userId}`).setLabel('Auktionshaus').setEmoji('🏬')
      .setStyle(ButtonStyle.Secondary),
    homeButton(userId));

  if (!loot.length) {
    embed.setDescription('Noch keine Fundstücke. Ersteigere eine Garage im 🏬 Auktionshaus!');
    return { embeds: [embed], components: [backRow] };
  }

  const sw = require('./data/storage');
  embed.setDescription(loot.slice(0, 15).map((l) => {
    const r = sw.rarityOf(l.rarity);
    const c = sw.conditionOf(l.condition);
    return `${r.emoji} **${l.name}** — ${money(symbol, l.value)} \`#${l.id}\`\n` +
      `　_${r.label} · ${c.emoji} ${c.label}_`;
  }).join('\n'));
  embed.addFields({ name: 'Gesamt-Schätzwert', value: `${money(symbol, summary.value)} (${summary.n} Stück)` });
  embed.setFooter({ text: 'Behalten zum Angeben – oder beim Hehler zu Bargeld machen.' });

  const rows = [];
  const top = loot.slice(0, 5);
  rows.push(new ActionRowBuilder().addComponents(...top.map((l) =>
    new ButtonBuilder()
      .setCustomId(`ssell|${l.id}|${userId}`)
      .setLabel(l.name.slice(0, 40)).setEmoji('💸').setStyle(ButtonStyle.Secondary))));
  rows.push(new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId(`ssell|all|${userId}`).setLabel('Alles verkaufen').setEmoji('💰')
      .setStyle(ButtonStyle.Danger),
    new ButtonBuilder().setCustomId(`sauc|${userId}`).setLabel('Auktionshaus').setEmoji('🏬')
      .setStyle(ButtonStyle.Secondary),
    homeButton(userId)));

  return { embeds: [embed], components: rows };
}

// ------------------------------------------------------------------- Detail

async function buildDetailView({ guildId, mode, key, page, userId }) {
  const symbol = await getSymbol(guildId);
  const used = mode === 'used';
  const backTo = { used: 'used', gear: 'gear' }[mode] ?? 'new';

  // Im Gebrauchtmarkt trägt der Schlüssel die Herkunft: p = Spieler, n = NPC.
  let car, npcListing = null;
  if (used) {
    const prefix = String(key)[0];
    const id = Number(String(key).slice(1)) || Number(key);
    if (prefix === 'n') {
      npcListing = db.getNpcListing(guildId, id);
      car = npcListing;
    } else {
      car = db.getListing(guildId, id);
    }
  } else {
    car = db.getItem(guildId, key);
  }

  const backRow = (extra = []) => new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(ID.menu(backTo, page, userId))
      .setLabel('Zurück').setEmoji('◀️')
      .setStyle(ButtonStyle.Secondary),
    ...extra,
    homeButton(userId),
  );

  if (!car) {
    return {
      embeds: [new EmbedBuilder()
        .setTitle('❌ Nicht mehr verfügbar')
        .setDescription(used
          ? 'Dieses Inserat gibt es nicht mehr – vielleicht war jemand schneller.'
          : 'Dieses Auto gibt es nicht mehr.')
        .setColor(0xe74c3c)],
      components: [backRow()],
    };
  }

  const price = used ? (npcListing ? car.npc_price : car.listing_price) : car.price;

  const embed = new EmbedBuilder()
    .setTitle(`${car.emoji ? `${car.emoji} ` : ''}${car.name}`)
    .setDescription(car.description || null)
    .setColor(used ? 0x95a5a6 : 0xe74c3c)
    .addFields(
      { name: 'Preis', value: money(symbol, price), inline: true },
      { name: 'Marke', value: car.brand || '—', inline: true },
    );

  if (used) {
    const cond = require('./condition');
    const c = npcListing ? car.npc_condition : (car.listing_condition ?? 100);

    // Kein Neupreis, kein Prozentwert, kein Balken: alles davon ließe sich
    // gegen den Preis rechnen. Die grobe Stufe muss reichen.
    embed.addFields(
      {
        name: 'Verkäufer',
        value: npcListing ? `🧑‍💼 ${car.seller}` : `🧑 <@${car.seller_id}>`,
        inline: true,
      },
      { name: 'Zustand', value: cond.label(c), inline: true },
    );

    if (npcListing && car.note) {
      embed.addFields({ name: 'Aus der Anzeige', value: `_${car.note}_` });
    }
  } else {
    embed.addFields({
      name: 'Verfügbar', value: car.stock === null ? '∞' : String(car.stock), inline: true,
    });
  }

  // Bei Ausrüstung anzeigen, welche Jobs damit möglich werden – und wie
  // haltbar das Teil ist.
  if (mode === 'gear') {
    const gearData = require('./data/gear');
    const jobList = require('./data/jobs')
      .filter((j) => (j.requires ?? []).some((r) => r.item === car.name))
      .map((j) => `${j.emoji} ${j.title}`);

    if (jobList.length) {
      embed.addFields({
        name: 'Wird gebraucht für',
        value: jobList.slice(0, 10).join('\n') +
          (jobList.length > 10 ? `\n… und ${jobList.length - 10} weitere` : ''),
      });
    }

    const wear = gearData.wearChance(gearData.findGear(car.name));
    embed.addFields({
      name: 'Haltbarkeit',
      value: wear > 0
        ? `🔧 Kann bei der Arbeit kaputtgehen (${(wear * 100).toFixed(1)} % pro Schicht, ` +
          `im Schnitt alle ${Math.round(1 / wear)} Schichten).`
        : '🛡️ Unzerstörbar – Qualifikationen verfallen nicht.',
    });
  }

  const owned = db.getOwned(guildId, userId, used ? car.id : key);
  if (owned) {
    const cond = require('./condition');
    embed.addFields({
      name: 'In deiner Garage',
      value: `Ja — ${cond.labelDetailed(owned.condition ?? 100)}`,
      inline: true,
    });
  }

  if (car.image_url) embed.setImage(car.image_url);
  if (car.attribution) embed.setAuthor({ name: car.attribution });

  const buyId = used
    ? (npcListing ? `nbuy|${car.npc_id}|${userId}` : `ubuy|${car.listing_id}|${userId}`)
    : `buy|${key}|${userId}`;
  const buyButton = new ButtonBuilder()
    .setCustomId(buyId)
    .setLabel(`Kaufen für ${price.toLocaleString('de-DE')}`).setEmoji('💰')
    .setStyle(ButtonStyle.Success);

  return { embeds: [embed], components: [backRow([buyButton])] };
}

module.exports = {
  buildNewShopView, buildUsedShopView, buildBrandsView, buildGearShopView,
  buildPropertyShopView, buildPropertyDetailView, buildEstateView,
  buildJobCenterView, buildGarageView, buildListingsView, buildBalanceView,
  buildInboxView, buildProfileView, buildLeaderboardView,
  buildAuctionView, buildCollectionView, buildGaragesView,
  buildDetailView,
  navigationRow, actionsRow, homeButton, garageLabel, ID, money,
};
