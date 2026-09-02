const identity = require('../identity');
const currency = require('../currency');

/**
 * ===========================================================================
 *  EMOJI-ÜBERSETZUNG ZWISCHEN DEN PLATTFORMEN
 * ===========================================================================
 *
 * Ein Discord-Custom-Emoji ist `<:Rubine:1067…>` – Name **und ID**. Die ID
 * gilt nur auf Discord; Fluxer kennt sie nicht und zeigt Rohtext (`:Rubine:`).
 * Umgekehrt genauso.
 *
 * Betroffen ist vor allem das **Währungssymbol**, denn das steckt in fast
 * jeder Ausgabe. Es kommt von UnbelievaBoat und ist deshalb immer ein
 * Discord-Emoji. Damit auf Fluxer trotzdem ein Geldzeichen steht:
 *
 *   1. `FLUXER_CURRENCY_SYMBOL` (.env) – das Gegenstück auf Fluxer, ideal.
 *   2. sonst 🪙 – eine Münze ist überall darstellbar.
 *
 * Alle übrigen Custom-Emojis werden durch ihren **Namen** ersetzt; „check"
 * liest sich besser als `<:check:456>`.
 *
 * Dieses Modul ist die einzige Stelle mit dieser Logik – benutzt wird sie von
 * der Fluxer-Darstellung (render.js), von den Textantworten und von der
 * Kanal-Brücke (relay.js). Vorher hing sie nur an den Embeds, weshalb genau
 * dort das Symbol stimmte und überall sonst `:Rubine:` stehen blieb.
 */

/** Das Fluxer-Gegenstück zum Währungsemoji, falls eingetragen. */
const FLUXER_CURRENCY = process.env.FLUXER_CURRENCY_SYMBOL || '';

/** Wenn keins eingetragen ist: eine Münze. Nie Rohtext. */
const COIN = currency.FALLBACK;

/** Custom-Emoji: `<:name:id>` oder animiert `<a:name:id>`. */
const CUSTOM = /<a?:([^:]+):\d+>/g;

/** Das Discord-Währungssymbol dieser Welt (oder null, wenn kein Emoji). */
function discordCurrency() {
  const symbol = currency.peek(identity.world());
  return symbol && symbol.startsWith('<') ? symbol : null;
}

/** Der Name des Währungsemojis, z.B. "Rubine" (oder null). */
function currencyName() {
  const symbol = discordCurrency();
  return symbol ? currency.plainSymbol(symbol) : null;
}

/**
 * Bringt den Eintrag aus `FLUXER_CURRENCY_SYMBOL` in die Form, die Fluxer im
 * Nachrichtentext versteht: `<:Name:ID>` (animiert `<a:Name:ID>`).
 *
 * Nachsichtig, weil man aus der Oberfläche je nach Weg etwas anderes
 * herauskopiert – all das wird akzeptiert:
 *
 *   <:Rubine:154…>   fertig
 *   a:Rubine:154…    Reaktions-Schreibweise (auch mit führendem :)
 *   154…             nur die ID  -> Name wird ergänzt
 *   🪙               ein normales Emoji bleibt, wie es ist
 *
 * Ohne Ergänzung stünde bei einer nackten ID einfach die Zahl im Chat.
 */
function normalizeSymbol(raw, fallbackName) {
  const text = String(raw ?? '').trim();
  if (!text) return '';

  // Schon vollständig.
  if (/^<a?:[^:\s]+:\d+>$/.test(text)) return text;

  // "name:id" / "a:name:id" / ":name:id"
  const parts = /^(a:)?:?([^:\s]+):(\d{5,25})>?$/.exec(text);
  if (parts) return `<${parts[1] ? 'a:' : ':'}${parts[2]}:${parts[3]}>`;

  // Nur die ID – der Name ist bloß Beiwerk, gerendert wird über die ID.
  if (/^\d{5,25}$/.test(text)) {
    const name = (fallbackName || 'currency').replace(/[^\w]/g, '') || 'currency';
    return `<:${name}:${text}>`;
  }

  // Unicode-Emoji oder sonstiger Text: unverändert übernehmen.
  return text;
}

/** Was auf Fluxer für Geld steht. */
function fluxerCurrency() {
  return normalizeSymbol(FLUXER_CURRENCY, currencyName()) || COIN;
}

/**
 * Discord-Text → Fluxer-Text.
 * Währungsemoji wird zum Fluxer-Geldzeichen, alles andere zu seinem Namen.
 */
function toFluxer(text) {
  if (typeof text !== 'string' || !text.includes('<')) return text;
  const money = currencyName();
  return text.replace(CUSTOM, (whole, name) =>
    (money && name === money ? fluxerCurrency() : name));
}

/**
 * Fluxer-Text → Discord-Text.
 * Das Fluxer-Geldzeichen wird zum echten Discord-Emoji (sonst stünde dort eine
 * fremde ID); übrige Fluxer-Emojis werden zu ihrem Namen.
 */
function toDiscord(text) {
  if (typeof text !== 'string') return text;
  const money = discordCurrency();
  let out = text;

  if (money && FLUXER_CURRENCY && out.includes(FLUXER_CURRENCY)) {
    out = out.split(FLUXER_CURRENCY).join(money);
  }
  if (!out.includes('<')) return out;

  const name = currencyName();
  return out.replace(CUSTOM, (whole, found) =>
    (money && found === name ? money : found));
}

module.exports = {
  FLUXER_CURRENCY, COIN, CUSTOM,
  discordCurrency, currencyName, normalizeSymbol, fluxerCurrency, toFluxer, toDiscord,
};
