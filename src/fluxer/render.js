const db = require('../db');
const identity = require('../identity');

/**
 * Die Emoji-Übersetzung liegt in emoji.js – dieselbe Logik benutzen auch die
 * Textantworten und die Kanal-Brücke, damit das Geldzeichen ÜBERALL stimmt
 * und nicht nur in Embeds.
 */
const emoji = require('./emoji');

/**
 * ===========================================================================
 *  RENDER – Ansichten ohne Buttons darstellen
 * ===========================================================================
 *
 * Fluxer kennt (noch) keine Message-Components: Man kann Buttons weder senden
 * noch von einem Klick erfahren – es gibt kein `InteractionCreate`. Laut
 * Fluxer-Roadmap kommt das später.
 *
 * Bis dahin übersetzt dieses Modul die **unveränderten** Ansichten aus
 * `ui.js`/`menu.js` (die weiterhin discord.js-Builder benutzen – das sind
 * reine JSON-Erzeuger ohne Netzwerk) in etwas, das Fluxer kann:
 *
 *     Embed  +  Emoji-Reaktionen  +  eine Legende im Embed
 *
 * Jede Reaktion steht für einen Button. Welche Reaktion zu welcher Aktion
 * gehört, wird pro Nachricht in der Datenbank hinterlegt – dadurch
 * funktionieren die Menüs auch nach einem Neustart des Bots weiter, genau wie
 * die zustandslosen Button-IDs im Original (ARCHITEKTUR §6).
 *
 * Kommen später echte Buttons, wird nur diese Datei ersetzt.
 */

/** Reaktionen, die ihre Bedeutung schon im Button-Emoji tragen. */
const NAV = new Set(['◀️', '▶️', '🏠']);

/** Auswahl-Emojis für alle übrigen Buttons, in Reihenfolge. */
const PICKERS = [
  '1️⃣', '2️⃣', '3️⃣', '4️⃣', '5️⃣', '6️⃣', '7️⃣', '8️⃣', '9️⃣', '🔟',
  '🇦', '🇧', '🇨', '🇩', '🇪',
];

/**
 * Wie viele Reaktionen eine Nachricht bekommt.
 *
 * Bewusst knapp: **jede Reaktion ist ein eigener REST-Aufruf**, 15 Stück
 * würden das Öffnen eines Menüs spürbar verzögern und ins Rate-Limit laufen.
 * Deshalb bekommt die Navigation immer Vorrang, und für die Auswahl gibt es
 * eine Handvoll Ziffern – alles Weitere erreicht man über Textbefehle
 * (z.B. `!kaufen 42`), was ohnehin der schnellere Weg ist.
 */
const MAX_REACTIONS = 9;

/** Holt die Buttons aus einer Ansicht (discord.js-Builder -> JSON). */
function buttonsOf(view) {
  const out = [];
  for (const row of view.components ?? []) {
    const json = typeof row.toJSON === 'function' ? row.toJSON() : row;
    for (const c of json.components ?? []) {
      // Deaktivierte Knöpfe (z.B. die Seitenanzeige "2 / 5") sind reine
      // Beschriftung und bekommen keine Reaktion.
      if (c.disabled || !c.custom_id) continue;
      out.push({
        customId: c.custom_id,
        label: c.label ?? '',
        emoji: c.emoji?.name ?? null,
      });
    }
  }
  return out;
}

/**
 * Ordnet jedem Button eine Reaktion zu.
 *
 * Navigations-Knöpfe behalten ihr sprechendes Emoji (◀️ ▶️ 🏠), sofern es in
 * dieser Ansicht nur einmal vorkommt. Alles andere bekommt der Reihe nach
 * eine Ziffer – so ist die Zuordnung eindeutig und stabil.
 */
function mapReactions(view) {
  const buttons = buttonsOf(view);

  // Wie oft kommt ein Navigations-Emoji vor? Nur eindeutige dürfen es behalten.
  const counts = new Map();
  for (const b of buttons) {
    if (b.emoji && NAV.has(b.emoji)) counts.set(b.emoji, (counts.get(b.emoji) ?? 0) + 1);
  }
  const isNav = (b) => b.emoji && NAV.has(b.emoji) && counts.get(b.emoji) === 1;

  // Navigation zuerst: Blättern und "zurück zum Hauptmenü" müssen immer
  // erreichbar sein, auch wenn die Ansicht viele Auswahlknöpfe hat.
  const nav = buttons.filter(isNav);
  const rest = buttons.filter((b) => !isNav(b));

  const used = new Set();
  const mapping = [];
  let pick = 0;

  for (const b of nav) {
    if (used.has(b.emoji)) continue;
    used.add(b.emoji);
    mapping.push({ emoji: b.emoji, customId: b.customId, label: b.label, buttonEmoji: b.emoji });
  }

  for (const b of rest) {
    if (mapping.length >= MAX_REACTIONS) break;
    while (pick < PICKERS.length && used.has(PICKERS[pick])) pick++;
    if (pick >= PICKERS.length) break;
    const emoji = PICKERS[pick++];
    used.add(emoji);
    mapping.push({ emoji, customId: b.customId, label: b.label, buttonEmoji: b.emoji });
  }

  // Was nicht mehr passt, meldet die Legende – erreichbar über Textbefehle.
  const dropped = rest.length - mapping.filter((m) => !NAV.has(m.emoji)).length;
  if (dropped > 0) mapping.overflow = dropped;

  return mapping;
}

/** Baut die Legende, die erklärt, welche Reaktion was tut. */
function legend(mapping) {
  if (!mapping.length) return '';
  const parts = mapping
    .map((m) => {
      const label = m.label || m.customId.split('|')[0];
      // Bei Navigation reicht das Emoji selbst, sonst Emoji + Beschriftung.
      const icon = m.buttonEmoji && !NAV.has(m.buttonEmoji) ? `${m.buttonEmoji} ` : '';
      return `${m.emoji} ${icon}${label}`;
    });
  const extra = mapping.overflow
    ? `\n_… und ${mapping.overflow} weitere – nutze die Textbefehle (z.B. \`!hilfe\`)._`
    : '';
  return parts.join('  ·  ') + extra;
}

/**
 * Ersetzt Konto-Erwähnungen durch Namen.
 *
 * Die Ansichten schreiben `<@konto>`. Das Konto ist eine Discord-ID – die kann
 * Fluxer nicht auflösen und würde roh dastehen. Deshalb hier der gemerkte
 * Anzeigename (siehe identity.remember).
 */
function resolveMentions(text) {
  if (typeof text !== 'string' || !text.includes('<@')) return text;
  return text.replace(/<@!?([^>]+)>/g, (whole, id) => {
    const name = identity.nameOf(id);
    return name ? `**${name}**` : whole;
  });
}

/** Wendet die Namensauflösung auf alle Textfelder eines Embeds an. */
/** Ersetzt Discord-Emojis durch etwas, das Fluxer darstellen kann. */
const localizeEmoji = (text) => emoji.toFluxer(text);

/** Macht einen Text auf Fluxer lesbar: Erwähnungen und Emojis auflösen. */
function forFluxer(text) {
  return localizeEmoji(resolveMentions(text));
}

function humanize(embed) {
  const out = { ...embed };
  if (out.title) out.title = forFluxer(out.title);
  if (out.description) out.description = forFluxer(out.description);
  if (Array.isArray(out.fields)) {
    out.fields = out.fields.map((f) => ({
      ...f, name: forFluxer(f.name), value: forFluxer(f.value),
    }));
  }
  if (out.footer?.text) out.footer = { ...out.footer, text: forFluxer(out.footer.text) };
  return out;
}

/**
 * Wandelt eine Ansicht in das um, was an Fluxer geschickt wird.
 * @returns {{embed: object, mapping: Array, reactions: string[]}}
 */
function toMessage(view) {
  const embedJson = view.embeds?.[0]
    ? (typeof view.embeds[0].toJSON === 'function' ? view.embeds[0].toJSON() : view.embeds[0])
    : {};
  const embed = humanize(embedJson);
  const mapping = mapReactions(view);

  const help = legend(mapping);
  if (help) {
    // Die Legende gehört sichtbar unter den Inhalt, nicht in den Footer –
    // dort würden Custom-Emojis nicht dargestellt.
    const sep = embed.description ? `${embed.description}\n\n` : '';
    embed.description = `${sep}▬▬▬▬▬▬▬▬▬▬\n${help}`;
  }

  return { embed, mapping, reactions: mapping.map((m) => m.emoji) };
}

// ------------------------------------------------- Zuordnung merken

/**
 * Speichert, welche Reaktion dieser Nachricht welche Aktion auslöst.
 * `userId` ist der Spieler, dem das Menü gehört – nur er darf es bedienen
 * (wie im Original, wo die userId in jeder Button-ID steckt).
 */
function remember(messageId, userId, mapping) {
  db.saveFluxerView(messageId, userId, mapping);
}

/** Welche Reaktionen hängen laut Zuordnung gerade an dieser Nachricht? */
function current(messageId) {
  const view = db.getFluxerView(messageId);
  return view ? view.mapping.map((m) => m.emoji) : [];
}

/** Findet die Aktion zu einer Reaktion, oder null. */
function lookup(messageId, emoji) {
  const view = db.getFluxerView(messageId);
  if (!view) return null;
  const hit = view.mapping.find((m) => m.emoji === emoji);
  if (!hit) return null;
  return { customId: hit.customId, userId: view.user_id };
}

module.exports = {
  NAV, PICKERS, MAX_REACTIONS,
  buttonsOf, mapReactions, legend, toMessage, remember, lookup, current,
  resolveMentions, humanize, localizeEmoji, forFluxer,
};
