/**
 * ===========================================================================
 *  NUDGES – der leicht penetrante Werbe-Wurf
 * ===========================================================================
 *
 * Wenn jemand einen Einkommens-Befehl von UnbelievaBoat per PRÄFIX benutzt
 * (z.B. `!work`), meldet sich der Bot MANCHMAL und wirbt fürs `/menu`.
 *
 * ⚠️ Voraussetzungen (sonst passiert nichts / der Bot startet nicht):
 *   1. Env `NUDGES=true` setzen (sonst ist das Feature komplett aus – der Bot
 *      fordert dann auch das privilegierte Intent gar nicht erst an).
 *   2. Im Discord Developer Portal das **Message Content Intent** aktivieren.
 *   3. Spieler müssen den **Präfix** (`!work`) nutzen. UnbelievaBoats
 *      SLASH-Befehl `/work` ist für uns unsichtbar (fremde Slash-Commands).
 *
 * Alles hier ist über Env tunbar; Cooldown liegt im Speicher (Reset bei Neustart).
 */

const enabled = process.env.NUDGES === 'true' || process.env.NUDGES === '1';

/** UnbelievaBoat-Präfix (serverabhängig konfigurierbar). */
const PREFIX = process.env.UNB_PREFIX || '!';

/** Einkommens-Befehle, auf die reagiert wird. Beliebig erweiterbar. */
const EARN_COMMANDS = ['work', 'crime', 'slut', 'beg'];

/** Wahrscheinlichkeit, dass überhaupt genudged wird (0–1). */
const CHANCE = Number(process.env.NUDGE_CHANCE || '0.2');

/** Pro Spieler frühestens wieder nach dieser Zeit nerven. */
const COOLDOWN_MS = Number(process.env.NUDGE_COOLDOWN_MIN || '120') * 60 * 1000;

const lastNudge = new Map();

/** Werbe-Sprüche. `u` ist die fertige Erwähnung (`<@id>`). */
const LINES = [
  (u) => `Hey ${u}, frisch was verdient 💸 – Lust, es in ein fettes Auto zu stecken? \`/menu\` zeigt dir wie. 🚗`,
  (u) => `Ohh ${u}, Kohle! 🤑 Bevor sie versickert: \`/menu\` – Immobilien, Autos, Casino und Auktionen warten.`,
  (u) => `${u}, schön geackert! 💪 Wusstest du, dass du dein Geld bei mir vermehren (oder verzocken 🎰) kannst? → \`/menu\``,
  (u) => `Psst ${u} 👀 – im Auktionshaus (\`/auktion\`) stehen gerade Garagen zum Ersteigern. Vielleicht ein Schnäppchen?`,
  (u) => `${u}, dein Konto füllt sich – Zeit zum Angeben? \`/profil\` und \`/leaderboard\` zeigen, wer hier wirklich reich ist. 📈`,
  (u) => `Nice, ${u}! 🪙 Nur rumliegen lassen ist langweilig – schau mal ins \`/menu\`, da geht was.`,
];

/**
 * Prüft eine eingehende Nachricht und wirft ggf. einen Werbe-Spruch. Fehler
 * werden verschluckt – ein Nudge darf nie etwas kaputt machen.
 */
async function handleMessage(message) {
  if (!enabled) return;
  if (!message.guild || message.author?.bot) return;

  const content = (message.content || '').trim().toLowerCase();
  if (!content.startsWith(PREFIX)) return;
  const cmd = content.slice(PREFIX.length).split(/\s+/)[0];
  if (!EARN_COMMANDS.includes(cmd)) return;

  // Nur manchmal, und nicht denselben Spieler in Dauerschleife.
  if (Math.random() >= CHANCE) return;
  const now = Date.now();
  if (now - (lastNudge.get(message.author.id) || 0) < COOLDOWN_MS) return;
  lastNudge.set(message.author.id, now);

  const line = LINES[Math.floor(Math.random() * LINES.length)](`<@${message.author.id}>`);
  await message.channel.send({
    content: line,
    allowedMentions: { users: [message.author.id] },
  }).catch(() => {});
}

module.exports = {
  enabled, PREFIX, EARN_COMMANDS, CHANCE, COOLDOWN_MS, LINES, handleMessage,
};
