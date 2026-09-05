/**
 * ===========================================================================
 *  !top MITHÖREN – unsere Rangliste neben der von UnbelievaBoat
 * ===========================================================================
 *
 * Auf Discord gehört `!top` UnbelievaBoat. Dessen Liste kennt aber nur
 * Bargeld und Bank – Autos, Immobilien, Depot und die Sammlung aus den
 * Auktionen tauchen dort nirgends auf, und Fluxer-Spieler ohne Verknüpfung
 * fehlen komplett.
 *
 * Deshalb liest der Bot den Präfix-Befehl mit und antwortet mit unserer
 * eigenen Rangliste. Standardmäßig **zusätzlich**: Beide Listen stehen
 * nebeneinander, und man sieht sofort den Unterschied.
 *
 * ---------------------------------------------------------------------------
 *  ERSETZEN (TOP_ECHO_REPLACE=true)
 * ---------------------------------------------------------------------------
 *
 * Einen fremden Bot am Antworten HINDERN kann niemand – Discord liefert die
 * Nachricht aus, bevor irgendwer sie sehen könnte. „Ersetzen" heißt hier
 * deshalb: Wir antworten selbst und **löschen ihre Antwort hinterher**. Für
 * einen Moment stehen beide da, danach nur noch unsere.
 *
 * Damit dabei nichts Falsches verschwindet, muss alles zusammenpassen:
 *
 *   1. Jemand hat gerade in DIESEM Kanal `!top` getippt,
 *   2. wir haben darauf tatsächlich geantwortet (sonst bliebe gar keine Liste),
 *   3. die Nachricht kommt von UnbelievaBoat (feste ID, per Env änderbar),
 *   4. und das alles innerhalb weniger Sekunden.
 *
 * Gelöscht wird höchstens EINE Nachricht je `!top`. Dafür braucht der Bot das
 * Recht **Nachrichten verwalten**; fehlt es, bleibt einfach beides stehen.
 *
 * Sauberer als jedes Löschen ist übrigens, den Befehl in UnbelievaBoats
 * Dashboard abzuschalten – dann antwortet dort von vornherein niemand mehr.
 *
 * ---------------------------------------------------------------------------
 *
 * Voraussetzung ist wie bei den Nudges das **Message Content Intent**. Das
 * wird bewusst NICHT allein wegen dieser Funktion angefordert – sonst würde
 * der Bot auf Servern ohne Freischaltung plötzlich nicht mehr starten:
 *
 *   TOP_ECHO nicht gesetzt -> läuft mit, wenn ohnehin mitgelesen wird
 *   TOP_ECHO=true          -> das Intent wird ausdrücklich angefordert
 *   TOP_ECHO=false         -> aus
 */

const setting = String(process.env.TOP_ECHO ?? '').toLowerCase();
const off = ['false', '0', 'off', 'nein'].includes(setting);
const forced = ['true', '1', 'on', 'ja'].includes(setting);

/** Antwortet der Bot auf den Präfix-Befehl? */
const enabled = !off;

/** Nur ausdrücklich verlangt fordern wir dafür das privilegierte Intent an. */
const needsIntent = forced;

/** Präfix von UnbelievaBoat (serverabhängig konfigurierbar). */
const PREFIX = process.env.UNB_PREFIX || '!';

/** Befehle, die eine Rangliste meinen – bei UnbelievaBoat wie bei uns. */
const COMMANDS = ['top', 'lb', 'leaderboard', 'reich', 'reichste'];

/** Nicht öfter als alle paar Sekunden je Kanal – sonst wird es Spam. */
const COOLDOWN_MS = Number(process.env.TOP_ECHO_COOLDOWN_S || '15') * 1000;

/**
 * Die Konto-ID von UnbelievaBoat – nur dessen Nachrichten werden gelöscht.
 * Wer einen anderen Wirtschafts-Bot ersetzen will, trägt hier dessen ID ein.
 */
const UNB_BOT_ID = String(process.env.UNB_BOT_ID || '292953664492929025');

/** So lange nach unserem `!top` gilt eine Antwort als die zum Befehl. */
const CATCH_MS = Number(process.env.TOP_ECHO_CATCH_S || '12') * 1000;

/**
 * Ersetzen statt ergänzen?
 *
 * Wird bei jedem Aufruf frisch gelesen: Das Löschen fremder Nachrichten ist
 * die einzige Funktion hier, die etwas WEGNIMMT – die Einstellung dafür soll
 * an einer Stelle stehen und auch im Test beide Wege durchlaufen können.
 */
function replacing() {
  return ['true', '1', 'on', 'ja'].includes(
    String(process.env.TOP_ECHO_REPLACE ?? '').toLowerCase());
}

const lastReply = new Map();

/** Kanäle, in denen gerade eine Antwort von UnbelievaBoat erwartet wird. */
const expecting = new Map();

/** Nur einmal meckern, wenn das Recht zum Löschen fehlt. */
let warned = false;

/**
 * Zerlegt eine Nachricht in Befehl und Argument.
 * @returns {{cmd: string, arg: string}|null} null, wenn es uns nichts angeht
 */
function parse(content) {
  const text = String(content ?? '').trim();
  if (!text.toLowerCase().startsWith(PREFIX.toLowerCase())) return null;
  const [cmd, ...rest] = text.slice(PREFIX.length).trim().split(/\s+/);
  if (!COMMANDS.includes(String(cmd).toLowerCase())) return null;
  return { cmd: String(cmd).toLowerCase(), arg: rest[0] ?? '' };
}

/**
 * Prüft eine eingehende Nachricht und schickt ggf. unsere Rangliste.
 *
 * Fehler bleiben hier: Eine Rangliste darf nie eine andere Funktion
 * mitreißen.
 *
 * @returns {Promise<boolean>} ob geantwortet wurde (für Tests)
 */
async function handleMessage(message, now = Date.now()) {
  if (!enabled) return false;
  if (!message?.guild || message.author?.bot) return false;

  const parsed = parse(message.content);
  if (!parsed) return false;

  const channelId = message.channel?.id ?? 'direkt';
  if (now - (lastReply.get(channelId) || 0) < COOLDOWN_MS) return false;
  lastReply.set(channelId, now);

  /*
   * Scharfstellen VOR dem ersten await (§7): UnbelievaBoat antwortet in
   * Millisekunden, unsere Liste kostet erst einen API-Aufruf. Wer erst nach
   * dem Senden scharf stellt, kommt regelmäßig zu spät und lässt ihre Liste
   * stehen.
   */
  if (replacing()) expecting.set(channelId, now + CATCH_MS);

  const identity = require('./identity');
  const view = await require('./ui').buildTopView({
    guildId: identity.world(),
    userId: message.author.id,
    // Ohne Zusatz das, was UnbelievaBoat nicht kann: das ganze Vermögen.
    sort: parsed.arg || 'networth',
  });

  const sent = await message.channel.send({
    ...view,
    allowedMentions: { users: [] },
  }).catch(() => null);

  // Ging unsere Liste nicht raus, bleibt ihre stehen – lieber die fremde
  // Rangliste als gar keine.
  if (!sent) {
    expecting.delete(channelId);
    return false;
  }
  return true;
}

/**
 * Löscht die Antwort von UnbelievaBoat, wenn wir gerade selbst geantwortet
 * haben. Ohne `TOP_ECHO_REPLACE` passiert hier nichts.
 *
 * @returns {Promise<boolean>} ob gelöscht wurde (für Tests)
 */
async function catchReply(message, now = Date.now()) {
  if (!enabled || !replacing()) return false;
  if (!message?.guild || !message.author?.bot) return false;

  // Niemals die eigene Liste wegräumen – auch nicht bei falsch gesetzter ID.
  if (String(message.author.id) === String(message.client?.user?.id ?? '')) return false;
  if (String(message.author.id) !== UNB_BOT_ID) return false;

  const channelId = message.channel?.id ?? 'direkt';
  const until = expecting.get(channelId);
  if (!until) return false;
  if (now > until) { expecting.delete(channelId); return false; }

  // Nur eine Nachricht je Befehl – danach ist das Fenster zu.
  expecting.delete(channelId);

  try {
    await message.delete();
    return true;
  } catch (err) {
    if (!warned) {
      warned = true;
      console.warn(
        '⚠️  Konnte UnbelievaBoats Rangliste nicht löschen ' +
        `(${err.message}). Fehlt mir das Recht „Nachrichten verwalten"? ` +
        'Alternativ den Befehl in UnbelievaBoats Dashboard abschalten.');
    }
    return false;
  }
}

module.exports = {
  enabled, needsIntent, PREFIX, COMMANDS, COOLDOWN_MS, CATCH_MS, UNB_BOT_ID,
  replacing, parse, handleMessage, catchReply,
};
