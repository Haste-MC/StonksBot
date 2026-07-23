const { unb } = require('./unb');

// Das Währungssymbol ändert sich praktisch nie -> pro Server einmal holen und merken.
const cache = new Map();
const FALLBACK = '🪙';

/**
 * Liefert das serverspezifische Währungssymbol aus den UnbelievaBoat-
 * Einstellungen (z.B. ein eigenes Emoji wie <:Rubine:123...>).
 * Fällt auf 🪙 zurück, wenn die API nicht erreichbar ist.
 */
async function getSymbol(guildId) {
  if (cache.has(guildId)) return cache.get(guildId);
  try {
    const guild = await unb.getGuild(guildId);
    const symbol = guild.currencySymbol || FALLBACK;
    cache.set(guildId, symbol);
    return symbol;
  } catch (err) {
    console.warn(`Währungssymbol für ${guildId} nicht abrufbar (${err.message}) – nutze ${FALLBACK}.`);
    return FALLBACK;
  }
}

/** Formatiert einen Betrag mit Symbol, z.B. "<:Rubine:123> 1.500". */
async function format(guildId, amount) {
  const symbol = await getSymbol(guildId);
  const value = Number.isFinite(amount) ? amount.toLocaleString('de-DE') : '∞';
  return `${symbol} ${value}`;
}

/**
 * Footer-taugliche Variante des Symbols.
 *
 * Custom-Emojis (`<:name:id>` / `<a:name:id>`) rendern Discord NUR in
 * Embed-Beschreibungen und -Feldern – in **Footern** (und im Author-Namen)
 * bleibt stattdessen der Rohtext stehen. Für solche reinen Textstellen den
 * Emoji-Namen verwenden; normale Emojis/Zeichen bleiben unverändert.
 */
function plainSymbol(symbol) {
  const m = /^<a?:([^:]+):\d+>$/.exec(symbol || '');
  return m ? m[1] : (symbol || FALLBACK);
}

module.exports = { getSymbol, format, plainSymbol, FALLBACK };
