const db = require('./db');
const identity = require('./identity');

/**
 * ===========================================================================
 *  TREPPCHEN – Glückwunsch, wenn jemand nach oben klettert
 * ===========================================================================
 *
 * Steigt jemand auf Platz 3, 2 oder 1 der Reichsten, geht auf **beiden**
 * Plattformen eine Meldung raus: wer aufgestiegen ist, wen er überholt hat
 * und wie viel er inzwischen wert ist.
 *
 * Kein Scheduler (§4). Geprüft wird dann, wenn die Rangliste ohnehin gerechnet
 * wurde – beim Blick auf `!top` oder `!rangliste`. Die Meldung kann dadurch
 * ein paar Minuten später kommen als der Aufstieg selbst; dafür kostet sie
 * keine einzige zusätzliche Abfrage.
 *
 * Vier Regeln, damit daraus kein Spam wird:
 *
 *   1. **Nur Aufstiege.** Wer verdrängt wird, rutscht zwangsläufig – dafür
 *      gibt es keine Meldung.
 *   2. **Nichts beim ersten Mal.** Ist noch kein Treppchen gemerkt, wird es
 *      still gefüllt. Sonst würde die erste Rangliste nach dem Update drei
 *      Glückwünsche für einen Zustand absetzen, der längst gilt.
 *   3. **Sperrfrist je Spieler und Platz.** Zwei Spieler dicht beieinander
 *      tauschen sonst bei jedem Börsentick die Plätze – und der Kanal läuft
 *      voll.
 *   4. **Nie ein Ping.** Erwähnungen werden dargestellt, benachrichtigt wird
 *      niemand (siehe relay.broadcast) – @everyone schon gar nicht.
 */

/** So viele Plätze werden gefeiert. */
const PLACES = 3;

/** Wie ein Platz angekündigt wird. */
const LABELS = {
  1: { emoji: '🥇', text: 'ist die neue **Nummer 1**' },
  2: { emoji: '🥈', text: 'steht jetzt auf **Platz 2**' },
  3: { emoji: '🥉', text: 'steht jetzt auf **Platz 3**' },
};

/** Frühestens nach dieser Zeit gibt es für denselben Platz wieder Applaus. */
const COOLDOWN_MS = Number(process.env.PODIUM_COOLDOWN_H || '6') * 60 * 60 * 1000;

/** Unter diesem Vermögen ist das Treppchen keine Meldung wert. */
const MIN_WORTH = Number(process.env.PODIUM_MIN_WORTH || '10000');

/** Die Sperrfrist liegt bei den Einkommens-Cooldowns – eine Tabelle reicht. */
const claimKind = (rank) => `podium${rank}`;

/**
 * Vergleicht die neue Rangliste mit dem gemerkten Treppchen.
 *
 * Der Zustand wird **vor** dem Versand geschrieben (§7): Zwei gleichzeitige
 * Aufrufe sollen nicht beide dieselbe Meldung absetzen.
 *
 * @param entries Rangliste absteigend nach Vermögen (aus toplist.fetch)
 * @returns {Array<{rank,userId,worth,passed:string|null}>} was zu feiern ist
 */
function check(guildId, entries = [], now = Date.now()) {
  const top = entries.slice(0, PLACES);
  if (!top.length) return [];

  const before = db.podiumOf(guildId);
  const held = new Map(before.map((row) => [String(row.user_id), row.rank]));
  const first = before.length === 0;
  if (first) {
    console.log('🏆 Treppchen zum ersten Mal gemerkt – gefeiert wird ab der '
      + 'nächsten Veränderung.');
  }

  const news = [];
  for (let i = 0; i < top.length; i++) {
    const rank = i + 1;
    const entry = top[i];
    const userId = String(entry.userId);
    const worth = Math.round(entry.networth ?? entry.total ?? 0);
    const previous = before.find((row) => row.rank === rank) ?? null;

    // Nichts geändert? Dann bleibt auch der Merker, wie er ist.
    if (previous && String(previous.user_id) === userId) continue;

    db.setPodium(guildId, rank, userId, worth, now);

    if (first || worth < MIN_WORTH) continue;

    // Nur Aufstiege: Wer vorher schon weiter oben stand, ist gerutscht.
    const had = held.get(userId) ?? Infinity;
    if (had <= rank) continue;

    const last = db.getClaim(guildId, userId, claimKind(rank))?.claimed_at ?? 0;
    if (now - last < COOLDOWN_MS) continue;
    db.setClaim(guildId, userId, claimKind(rank), now);

    news.push({
      rank,
      userId,
      worth,
      // Überholt wurde, wer den Platz vorher innehatte – es sei denn, er war
      // frei (frischer Server, jemand hat aufgehört).
      passed: previous && String(previous.user_id) !== userId
        ? String(previous.user_id) : null,
    });
  }

  return news;
}

/** Der Text einer Meldung. `money` formatiert einen Betrag. */
function describe(item, money) {
  const label = LABELS[item.rank] ?? LABELS[3];
  const lines = [
    `${label.emoji} ${identity.mention(item.userId)} ${label.text} der Reichsten!`,
  ];
  if (item.passed) {
    lines.push(`Überholt: ${identity.mention(item.passed)} · ` +
      `Vermögen: **${money(item.worth)}**`);
  } else {
    lines.push(`Vermögen: **${money(item.worth)}**`);
  }
  return lines.join('\n');
}

/**
 * Prüfen und, wenn es etwas zu feiern gibt, auf beiden Plattformen melden.
 *
 * Fehler bleiben hier: Ein Glückwunsch darf keine Rangliste zerlegen.
 *
 * @returns {Promise<Array>} die abgesetzten Meldungen (für Tests)
 */
async function celebrate(guildId, entries, now = Date.now()) {
  let news = [];
  try { news = check(guildId, entries, now); }
  catch { return []; }
  if (!news.length) return [];

  try {
    const { getSymbol } = require('./currency');
    const { money } = require('./ui');
    const symbol = await getSymbol(guildId);
    const relay = require('./relay');

    for (const item of news) {
      const text = describe(item, (v) => money(symbol, v));
      const sent = await relay.broadcast(text);

      /*
       * Immer ins Log, egal ob es rausging.
       *
       * Genau hier fehlte die Antwort auf „ich war Erster und es kam nichts":
       * Ohne eingetragenen Kanal verschwand die Meldung lautlos, und im Log
       * stand nichts, woran man es hätte sehen können.
       */
      console.log(sent.length
        ? `🏆 Treppchen-Meldung an ${sent.join(' + ')}: ${text.split('\n')[0]}`
        : `🏆 Treppchen: ${text.split('\n')[0]} – aber kein Kanal eingetragen.`);
    }
  } catch (err) {
    console.warn(`Treppchen-Meldung fehlgeschlagen: ${err.message}`);
  }
  return news;
}

module.exports = { PLACES, LABELS, COOLDOWN_MS, MIN_WORTH, check, describe, celebrate };
