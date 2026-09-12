# Antworten über die Brücke – Umsetzungsplan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Eine Discord-Antwort auf eine Fluxer-Nachricht erscheint auf Fluxer als echte Antwort (Persona bleibt, Autor wird gepingt); eine Fluxer-Antwort erscheint auf Discord mit einer Zitat-Zeile. Dafür merkt sich die Brücke 14 Tage lang, welche Nachricht welche gespiegelt hat.

**Architecture:** Neue Tabelle `relay_messages` mit Paaren `discord_id ↔ fluxer_id` (Einfügen räumt alte Paare auf, §4). Alle drei Sendewege in `relay.js` (`sendAsPersona`, Textform Fluxer, Textform Discord) liefern die erzeugte Nachrichten-ID, damit das Paar gespeichert werden kann. `fromDiscord` liest `message.reference`, schlägt das Paar nach und sendet mit `replyTo` + `repliedUser: true`; ohne Paar (oder bei `fromFluxer` immer) kommt eine Zitat-Zeile `> ↩️ **Name:** Kopfzeile…` über den Text.

**Tech Stack:** Node.js (CommonJS), `node:sqlite` über `src/db.js`, discord.js (Discord), `@fluxerjs/core` 2.2 (Fluxer), eigene Testdateien ohne Framework (`check(label, ok)`), `DATA_DIR=.testdata`.

## Global Constraints

- Spec: `docs/superpowers/specs/2026-09-12-bruecke-antworten-design.md` – Zahlen daraus wörtlich: `RELAY_PAIR_TTL_MS` = 14 Tage, `QUOTE_LENGTH` = 80, Zitat-Format `> ↩️ **Name:** Kopfzeile…`, Rückfalltext `[Anhang]`.
- **Geprüfte Plattform-Fakten (nicht raten):** Fluxer-Webhook `hook.send(payload, true)` gibt die erzeugte `Message` zurück und übernimmt `replyTo` als `message_reference` (Probe am 2026-09-12 in `#stonks`); Discord-Webhooks können **nicht** antworten; Fluxer `client.channels.send(id, { replyTo })` antwortet auch ohne Webhook; Discord-Referenz: `message.reference?.messageId`, Original per `message.fetchReference()`; Fluxer-Referenz: `message.messageReference` (`message_id`), Original per `message.referencedMessage` oder `channel.messages.fetch(id)`.
- Eine Abweichung von der Spec, bewusst: `sendAsPersona` gibt `{ ok, id }` zurück statt `id | null`. Grund: Ein erfolgreicher Versand ohne ID (älteres SDK) darf **nicht** den Textform-Rückfall auslösen – die Nachricht käme sonst doppelt an. Die Textform-Wege geben `id | null` zurück, wie in der Spec.
- Gepingt wird bei einer echten Antwort der Autor des Originals (`allowedMentions.repliedUser = true`, Beschluss A); Erwähnungen **im Zitat** pingen niemanden (die `users` der Zitat-Übersetzung werden verworfen).
- Bestehende Prüfungen in `test/relay.test.js` bleiben grün ohne Änderung ihrer Aussagen; nur die Fälschungen dürfen jetzt IDs liefern. `test/decisions.test.js` und alle anderen Dateien bleiben unberührt.
- Sprache: Deutsch in Kommentaren, Texten, Commit-Botschaften. Jede Commit-Botschaft endet mit der wörtlichen Zeile `Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>`.
- Tests: `rm -rf .testdata && DATA_DIR=.testdata node test/relay.test.js`; volle Kette `npm test 2>&1 | grep -c '❌'` → `0`. Nie gegen `data/shop.db`.
- ARCHITEKTUR §4 (faule Abrechnung – Aufräumen beim Einfügen, kein Scheduler), §12 (Tests ohne Netz – Clients werden gefälscht).

---

## Dateien

| Datei | Verantwortung |
|---|---|
| `src/db.js` | Tabelle `relay_messages`; `RELAY_PAIR_TTL_MS`, `setRelayPair`, `relayPairFor`, `clearRelayPairs` |
| `src/relay.js` | `QUOTE_LENGTH`, `referenceOf`, `quoteLine`, `remember`; `sendAsPersona` mit `replyTo` und `{ ok, id }`; `sendPlainFluxer`; `replyContextDiscord`, `quoteForFluxerReply`; `fromDiscord`/`fromFluxer` |
| `test/relay.test.js` | neue Funktion `replyTests()` mit den zehn Prüfungen der Spec, nach `personaTests()` aufgerufen |
| `src/data/patchnotes.js` | Eintrag 1.30.0 |
| `ARCHITEKTUR.md` | §16 „Die Brücke antwortet" |

---

### Task 1: Das Gedächtnis – `relay_messages`

**Files:**
- Modify: `src/db.js` (Tabellenblock nach `relay_webhooks` ~Zeile 508; `stmt`-Block „Brücken-Webhooks" ~Zeile 1649; Funktionen nach `allRelayWebhooks` ~Zeile 3638; `module.exports` ~Zeile 3769)
- Test: `test/relay.test.js` (neue Funktion `replyTests()`, Aufruf nach `personaTests()`)

**Interfaces:**
- Produces: `db.RELAY_PAIR_TTL_MS` (Number, 14 Tage in ms); `db.setRelayPair(discordId, fluxerId, now = Date.now())`; `db.relayPairFor(platform, messageId)` → `{ discord_id, fluxer_id, created_at } | null` mit `platform ∈ {'discord','fluxer'}`; `db.clearRelayPairs()`.

- [ ] **Step 1: Testgerüst und Prüfungen 1–2 schreiben**

In `test/relay.test.js` direkt **vor** dem Kommentar `/**` über `async function personaTests()` einfügen:

```js
/**
 * Antworten über die Brücke: Paare gespiegelter Nachrichten, echte Antwort
 * nach Fluxer, Zitat-Zeile nach Discord.
 */
async function replyTests() {
  const db = require('../src/db');

  console.log('--- Paare gespiegelter Nachrichten ---');
  db.clearRelayPairs();
  db.setRelayPair('D1', 'F1');
  check('Paar über die Discord-ID gefunden', db.relayPairFor('discord', 'D1')?.fluxer_id === 'F1');
  check('Paar über die Fluxer-ID gefunden', db.relayPairFor('fluxer', 'F1')?.discord_id === 'D1');
  check('unbekannte ID -> null', db.relayPairFor('discord', 'NIX') === null && db.relayPairFor('fluxer', 'NIX') === null);

  const TAG = 24 * 60 * 60 * 1000;
  const jetzt = Date.now();
  db.setRelayPair('ALT', 'F_ALT', jetzt - 15 * TAG);
  db.setRelayPair('FRISCH', 'F_FRISCH', jetzt - 13 * TAG);
  db.setRelayPair('NEU', 'F_NEU', jetzt);          // räumt beim Einfügen auf
  check('15 Tage altes Paar ist weg', db.relayPairFor('discord', 'ALT') === null);
  check('13 Tage altes Paar bleibt', db.relayPairFor('discord', 'FRISCH')?.fluxer_id === 'F_FRISCH');
  check('TTL ist 14 Tage', db.RELAY_PAIR_TTL_MS === 14 * TAG);
  db.clearRelayPairs();
}
```

Und in der Haupt-IIFE nach `await personaTests();` die Zeile `await replyTests();` einfügen.

- [ ] **Step 2: Test laufen lassen – er muss scheitern**

```bash
rm -rf .testdata && DATA_DIR=.testdata node test/relay.test.js 2>&1 | tail -5
```

Erwartet: `TypeError: db.clearRelayPairs is not a function`.

- [ ] **Step 3: Tabelle, Statements, Funktionen**

`src/db.js`, nach dem `db.exec` für `relay_webhooks` (nach Zeile ~508) einfügen:

```js
// Paare gespiegelter Nachrichten: Wer auf Discord auf eine Nachricht
// antwortet, meint drüben deren Gegenstück. Ohne dieses Gedächtnis kann die
// Brücke keine Antwort zuordnen. Zwei Wochen reichen – länger antwortet
// niemand; aufgeräumt wird beim Einfügen (§4, kein Scheduler).
db.exec(`
  CREATE TABLE IF NOT EXISTS relay_messages (
    discord_id TEXT PRIMARY KEY,       -- Nachricht auf Discord (Original oder Spiegel)
    fluxer_id  TEXT NOT NULL,          -- ihr Gegenstück auf Fluxer
    created_at INTEGER NOT NULL
  );
  CREATE UNIQUE INDEX IF NOT EXISTS idx_relay_messages_fluxer ON relay_messages (fluxer_id);
`);
```

Im `stmt`-Objekt nach `allRelayWebhooks: db.prepare('SELECT * FROM relay_webhooks'),`:

```js
  // --- Paare gespiegelter Nachrichten ---
  setRelayPair: db.prepare(
    `INSERT OR REPLACE INTO relay_messages (discord_id, fluxer_id, created_at) VALUES (?, ?, ?)`),
  pruneRelayPairs: db.prepare('DELETE FROM relay_messages WHERE created_at < ?'),
  relayPairByDiscord: db.prepare('SELECT * FROM relay_messages WHERE discord_id = ?'),
  relayPairByFluxer: db.prepare('SELECT * FROM relay_messages WHERE fluxer_id = ?'),
  clearRelayPairs: db.prepare('DELETE FROM relay_messages'),
```

Nach der Funktion `allRelayWebhooks()`:

```js
// ------------------------------------------ Paare gespiegelter Nachrichten

/** So lange kann man auf eine gespiegelte Nachricht antworten. */
const RELAY_PAIR_TTL_MS = 14 * 24 * 60 * 60 * 1000;

/** Merkt sich ein Paar und räumt dabei alles auf, was älter als die Frist ist. */
function setRelayPair(discordId, fluxerId, now = Date.now()) {
  stmt.pruneRelayPairs.run(now - RELAY_PAIR_TTL_MS);
  stmt.setRelayPair.run(String(discordId), String(fluxerId), now);
}

/** Das Gegenstück einer Nachricht – `platform` sagt, welche Seite bekannt ist. */
function relayPairFor(platform, messageId) {
  const s = platform === 'discord' ? stmt.relayPairByDiscord : stmt.relayPairByFluxer;
  return s.get(String(messageId)) ?? null;
}

function clearRelayPairs() {
  stmt.clearRelayPairs.run();
}
```

In `module.exports` nach `setRelayWebhook, getRelayWebhook, deleteRelayWebhook, allRelayWebhooks,`:

```js
  RELAY_PAIR_TTL_MS, setRelayPair, relayPairFor, clearRelayPairs,
```

- [ ] **Step 4: Test laufen lassen – grün**

```bash
rm -rf .testdata && DATA_DIR=.testdata node test/relay.test.js 2>&1 | grep -A7 "Paare gespiegelter" ; rm -rf .testdata && DATA_DIR=.testdata node test/relay.test.js 2>&1 | tail -1
```

Erwartet: sechs ✅ im neuen Abschnitt, Schlusszeile `… bestanden, 0 fehlgeschlagen`.

- [ ] **Step 5: Commit**

```bash
git add src/db.js test/relay.test.js
git commit -m "$(printf 'bruecke: paare gespiegelter nachrichten (14 tage)\n\nCo-Authored-By: Claude Opus 5 <noreply@anthropic.com>')"
```

---

### Task 2: Sendewege geben IDs zurück, Spiegeln speichert Paare

**Files:**
- Modify: `src/relay.js` (`sendAsPersona` ~Zeile 476, `fromDiscord` ~755, `fromFluxer` ~777, Exporte ~800)
- Test: `test/relay.test.js` (`replyTests()`)

**Interfaces:**
- Consumes: `db.setRelayPair`, `db.relayPairFor` (Task 1).
- Produces: `sendAsPersona(platform, channelId, message, text, sourcePlatform, users = [], replyTo = null)` → `{ ok: boolean, id: string | null }`; `sendPlainFluxer(channelId, content, allowedMentions, replyTo = null)` → `string | null`; `remember(sourcePlatform, sourceId, sentId)`. `replyTo` wird in dieser Task nur durchgereicht, gesetzt wird es in Task 3.

- [ ] **Step 1: Prüfung 3 schreiben (Spiegeln legt Paare an)**

In `replyTests()` nach `db.clearRelayPairs();` (Ende des Paare-Blocks) anhängen:

```js
  console.log('--- Spiegeln legt Paare an ---');
  // Eigenes Modul-Exemplar mit Webhooks, wie in personaTests – aber die
  // Fälschungen liefern jetzt IDs, wie die echten Clients.
  db.deleteRelayWebhook('discord', 'DC_KANAL');
  db.deleteRelayWebhook('fluxer', 'FX_KANAL');
  delete require.cache[require.resolve('../src/relay')];
  process.env.RELAY_WEBHOOKS = 'true';
  const bridge = require('../src/relay');

  let n = 0;
  const nextId = () => `MSG_${++n}`;
  const hookSends = [];
  const plainFluxer = [];
  const plainDiscord = [];
  const makeHook = (id) => ({
    id, name: bridge.WEBHOOK_NAME, token: `tok-${id}`,
    async send(payload, wait) {
      const sent = { id: nextId(), wait: Boolean(wait) };
      hookSends.push({ hook: id, ...payload, sentId: sent.id });
      return sent;
    },
  });
  // Originale, die sich nachladen lassen (Discord fetchReference, Fluxer messages.fetch).
  const originals = new Map();
  const dcChannel = {
    id: 'DC_KANAL',
    async fetchWebhooks() { return new Map(); },
    async createWebhook() { return makeHook('DCHOOK'); },
    async send(p) { const id = nextId(); plainDiscord.push({ ...p, sentId: id }); return { id }; },
  };
  const fxChannel = {
    id: 'FX_KANAL', name: 'economy', guildId: 'FX_GUILD',
    async fetchWebhooks() { return []; },
    async createWebhook() { return makeHook('FXHOOK'); },
    messages: { async fetch(id) { if (!originals.has(id)) throw new Error('Unknown Message'); return originals.get(id); } },
  };
  bridge.register('discord', {
    user: { id: 'DISCORDBOT' },
    channels: {
      cache: new Map([['DC_KANAL', dcChannel]]),
      async fetch(id) { return id === 'DC_KANAL' ? dcChannel : { id, async send() {} }; },
    },
  });
  bridge.register('fluxer', {
    user: { id: 'FLUXERBOT' },
    channels: {
      values: () => [fxChannel].values(),
      get: (id) => (id === 'FX_KANAL' ? fxChannel : null),
      cache: new Map([['FX_KANAL', fxChannel]]),
      async send(id, p) { const sentId = nextId(); plainFluxer.push({ id, ...p, sentId }); return { id: sentId }; },
    },
  });

  const dcMsg = (over = {}) => ({
    id: `DC_${++n}`,
    author: { id: 'USER1', displayName: 'Kevin', displayAvatarURL: () => 'https://cdn.discord/kevin.png' },
    content: 'Hallo von Discord', channelId: 'DC_KANAL', embeds: [], attachments: [],
    ...over,
  });
  const fxMsg = (over = {}) => ({
    id: `FX_${++n}`,
    author: { id: 'FXUSER', globalName: 'Simon', displayAvatarURL: () => 'https://cdn.fluxer/simon.png' },
    content: 'Hallo von Fluxer', channelId: 'FX_KANAL', embeds: [], attachments: [],
    ...over,
  });

  const d1 = dcMsg();
  check('Discord-Nachricht wird gespiegelt', (await bridge.fromDiscord(d1)) === true);
  const s1 = hookSends[hookSends.length - 1];
  check('Fluxer-Webhook wurde mit wait=true gerufen (liefert die Nachricht)', s1?.hook === 'FXHOOK' && s1?.sentId?.startsWith('MSG_'));
  check('Paar Discord -> Fluxer gespeichert',
    db.relayPairFor('discord', d1.id)?.fluxer_id === s1.sentId, JSON.stringify(db.relayPairFor('discord', d1.id)));

  const f1 = fxMsg();
  check('Fluxer-Nachricht wird gespiegelt', (await bridge.fromFluxer(f1)) === true);
  const s2 = hookSends[hookSends.length - 1];
  check('Paar Fluxer -> Discord gespeichert',
    db.relayPairFor('fluxer', f1.id)?.discord_id === s2.sentId, JSON.stringify(db.relayPairFor('fluxer', f1.id)));
  check('ohne Antwort kein replyTo und kein Zitat',
    s1.replyTo === undefined && !s1.content.includes('↩️') && s2.replyTo === undefined && !s2.content.includes('↩️'));
```

- [ ] **Step 2: Test laufen lassen – er muss scheitern**

```bash
rm -rf .testdata && DATA_DIR=.testdata node test/relay.test.js 2>&1 | grep "❌"
```

Erwartet: „Paar Discord -> Fluxer gespeichert" ❌ und „Paar Fluxer -> Discord gespeichert" ❌ (heute wird nichts gespeichert; `wait=true` fehlt auch).

- [ ] **Step 3: `sendAsPersona` umbauen**

`src/relay.js`, die Funktion `sendAsPersona` komplett ersetzen:

```js
/**
 * Sendet als Persona des Absenders. Rückgabe `{ ok, id }`: `ok` sagt, ob
 * die Nachricht raus ist (sonst fällt der Aufrufer auf Textform zurück),
 * `id` ist die erzeugte Nachricht – oder null, wenn die Plattform keine
 * liefert. Beides getrennt, damit ein Erfolg ohne ID nie doppelt sendet.
 *
 * `replyTo` macht daraus eine echte Antwort (nur Fluxer nimmt das über
 * Webhooks an – Discord ignoriert es nicht, sondern lehnt ab, deshalb wird
 * es dort nie gesetzt). Bei einer Antwort wird der Autor des Originals
 * gepingt, wie bei jeder echten Antwort.
 */
async function sendAsPersona(platform, channelId, message, text, sourcePlatform, users = [],
  replyTo = null) {
  if (!WEBHOOKS) return { ok: false, id: null };
  const hook = await webhookFor(platform, channelId);
  if (!hook) return { ok: false, id: null };

  const source = sourcePlatform ?? (platform === 'discord' ? 'fluxer' : 'discord');
  const face = await personaOf(message, source);

  const payload = {
    content: text,
    username: face.username,
    // Die Plattformen schreiben das Feld unterschiedlich – beide mitgeben.
    avatarURL: face.avatarURL ?? undefined,
    avatarUrl: face.avatarURL ?? undefined,
    allowedMentions: replyTo ? { ...pings(users), repliedUser: true } : pings(users),
  };
  if (replyTo) payload.replyTo = replyTo;

  try {
    // Fluxer gibt die erzeugte Nachricht nur mit wait=true zurück.
    const sent = platform === 'fluxer' ? await hook.send(payload, true) : await hook.send(payload);
    return { ok: true, id: sent?.id ? String(sent.id) : null };
  } catch (err) {
    // Webhook weg oder Recht entzogen: vergessen und beim nächsten Mal neu
    // versuchen; diese Nachricht geht in Textform raus.
    console.warn(`Brücke: Webhook-Versand in ${platform}/${channelId} fehlgeschlagen ` +
      `(${err.message}) – spiegele in Textform.`);
    hooks.delete(hookKey(platform, channelId));
    db.deleteRelayWebhook(platform, channelId);
    return { ok: false, id: null };
  }
}

/**
 * Textform nach Fluxer. Mit `replyTo` als echte Antwort; lehnt Fluxer die
 * Referenz ab (Original inzwischen gelöscht), ein zweiter Versuch ohne –
 * die Nachricht kommt an, der Bezug fehlt. Kein dritter Versuch.
 */
async function sendPlainFluxer(channelId, content, allowedMentions, replyTo = null) {
  if (replyTo) {
    try {
      const sent = await clients.fluxer.channels.send(channelId, {
        content, allowedMentions: { ...allowedMentions, repliedUser: true }, replyTo,
      });
      return sent?.id ? String(sent.id) : null;
    } catch (err) {
      console.warn(`Brücke: Antwort in fluxer/${channelId} abgelehnt (${err.message}) – sende ohne Bezug.`);
    }
  }
  const sent = await clients.fluxer.channels.send(channelId, { content, allowedMentions });
  return sent?.id ? String(sent.id) : null;
}

/** Merkt sich das Paar aus Quelle und Spiegel – wenn beide eine ID haben. */
function remember(sourcePlatform, sourceId, sentId) {
  if (!sourceId || !sentId) return;
  if (sourcePlatform === 'discord') db.setRelayPair(String(sourceId), String(sentId));
  else db.setRelayPair(String(sentId), String(sourceId));
}
```

- [ ] **Step 4: `fromDiscord` und `fromFluxer` speichern Paare**

Beide Funktionen ersetzen (die Antwort-Logik kommt in Task 3/4 hinzu – hier nur IDs und Paare):

```js
async function fromDiscord(message) {
  if (!ready() || isOwn(message, 'discord') || ignored(message)) return false;
  learnFace(message);

  const target = destination(message, 'discord');
  if (!target || !body(message)) return false;
  const uebersetzt = forFluxerFull(body(message) ?? '', message);
  const persona = await sendAsPersona(
    'fluxer', target, message, uebersetzt.text, 'discord', uebersetzt.users);
  if (persona.ok) {
    remember('discord', message.id, persona.id);
    return true;
  }

  const text = format(message, { platform: 'discord' });
  if (!text) return false;
  const rueckfall = forFluxerFull(text, message);
  const sentId = await sendPlainFluxer(target, rueckfall.text, pings(rueckfall.users));
  remember('discord', message.id, sentId);
  return true;
}

/** Fluxer → Discord. */
async function fromFluxer(message) {
  if (!ready() || isOwn(message, 'fluxer') || ignored(message)) return false;
  learnFace(message, 'fluxer');

  const target = destination(message, 'fluxer');
  if (!target || !body(message)) return false;
  const uebersetzt = forDiscordFull(body(message) ?? '', message);
  const persona = await sendAsPersona(
    'discord', target, message, uebersetzt.text, 'fluxer', uebersetzt.users);
  if (persona.ok) {
    remember('fluxer', message.id, persona.id);
    return true;
  }

  const text = format(message, { platform: 'fluxer' });
  if (!text) return false;
  const channel = await clients.discord.channels.fetch(target);
  const rueckfall = forDiscordFull(text, message);
  const sent = await channel.send({ content: rueckfall.text, allowedMentions: pings(rueckfall.users) });
  remember('fluxer', message.id, sent?.id ? String(sent.id) : null);
  return true;
}
```

In `module.exports` ergänzen: `sendPlainFluxer, remember,` (neben `sendAsPersona`, falls das exportiert ist – `grep -n "sendAsPersona" src/relay.js` zeigt die Exportzeile; sonst dort anhängen).

- [ ] **Step 5: Alle Relay-Tests grün, Bestand unverändert**

```bash
rm -rf .testdata && DATA_DIR=.testdata node test/relay.test.js 2>&1 | grep -c "❌"; rm -rf .testdata && DATA_DIR=.testdata node test/relay.test.js 2>&1 | tail -1
```

Erwartet: `0`, Schlusszeile ohne Fehler. Die bestehenden Abschnitte (`personaTests`, Textform, Erwähnungen) laufen mit Fälschungen ohne Rückgabewert weiter: `sent?.id` ist dann `undefined` → kein Paar, kein Fehler.

- [ ] **Step 6: Commit**

```bash
git add src/relay.js test/relay.test.js
git commit -m "$(printf 'bruecke: sendewege liefern die erzeugte nachricht, spiegeln merkt sich paare\n\nCo-Authored-By: Claude Opus 5 <noreply@anthropic.com>')"
```

---

### Task 3: Discord → Fluxer als echte Antwort, Zitat als Rückfall

**Files:**
- Modify: `src/relay.js` (neue Konstante/Funktionen bei `displayName` ~Zeile 259; `fromDiscord`)
- Test: `test/relay.test.js` (`replyTests()`)

**Interfaces:**
- Consumes: `sendAsPersona(…, replyTo)`, `sendPlainFluxer(…, replyTo)`, `remember` (Task 2); `db.relayPairFor` (Task 1); vorhandene `body(message)`, `displayName(message)`, `forFluxerFull`, `forDiscordFull`.
- Produces: `QUOTE_LENGTH = 80`; `referenceOf(message, platform)` → `string | null`; `quoteLine(original, targetPlatform)` → `string`; `replyContextDiscord(message, target)` → `{ replyTo: object | null, quote: string | null }`.

- [ ] **Step 1: Prüfungen 4–7 und 10 schreiben**

In `replyTests()` ans Ende anhängen (nach dem Block „Spiegeln legt Paare an"):

```js
  console.log('--- Discord antwortet auf Fluxer: echte Antwort ---');
  db.setRelayPair('DC_ORIG', 'FX_ORIG');
  const antwort = dcMsg({ content: 'Genau so!', reference: { messageId: 'DC_ORIG' } });
  check('wird gespiegelt', (await bridge.fromDiscord(antwort)) === true);
  const a1 = hookSends[hookSends.length - 1];
  check('replyTo zeigt auf das Fluxer-Gegenstück',
    a1?.replyTo?.messageId === 'FX_ORIG' && a1?.replyTo?.channelId === 'FX_KANAL', JSON.stringify(a1?.replyTo));
  check('guildId aus dem Kanal-Cache', a1?.replyTo?.guildId === 'FX_GUILD');
  check('der Autor des Originals wird gepingt (repliedUser)',
    a1?.allowedMentions?.repliedUser === true && Array.isArray(a1?.allowedMentions?.parse), JSON.stringify(a1?.allowedMentions));
  check('kein Zitat im Text', a1?.content === 'Genau so!', a1?.content);

  console.log('--- Antwort auf den Spiegel eines Fluxer-Nutzers ---');
  // Simons Fluxer-Nachricht wurde nach Discord gespiegelt (Paar aus Task 2);
  // Kevin antwortet auf Discord auf den SPIEGEL – drüben muss Simons Original getroffen werden.
  const simon = fxMsg({ content: 'Wer spielt civ?' });
  await bridge.fromFluxer(simon);
  const spiegelId = db.relayPairFor('fluxer', simon.id)?.discord_id;
  check('Spiegel hat eine Discord-ID', Boolean(spiegelId), String(spiegelId));
  await bridge.fromDiscord(dcMsg({ content: 'ich!', reference: { messageId: spiegelId } }));
  const a2 = hookSends[hookSends.length - 1];
  check('Antwort trifft Simons Original', a2?.replyTo?.messageId === simon.id, JSON.stringify(a2?.replyTo));

  console.log('--- Unbekanntes Original: Zitat-Zeile ---');
  const lang = 'x'.repeat(120);
  const unbekannt = dcMsg({
    content: 'Dazu kann ich was sagen',
    reference: { messageId: 'DC_UNBEKANNT' },
    async fetchReference() {
      return { author: { displayName: 'Max' }, content: `${lang}\nzweite Zeile`, embeds: [], attachments: [] };
    },
  });
  check('wird gespiegelt', (await bridge.fromDiscord(unbekannt)) === true);
  const a3 = hookSends[hookSends.length - 1];
  check('kein replyTo', a3?.replyTo === undefined);
  check('Zitat-Zeile mit Name und gekürzter erster Zeile',
    a3?.content.startsWith(`> ↩️ **Max:** ${'x'.repeat(80)}…\n`), a3?.content.slice(0, 100));
  check('eigentlicher Text darunter', a3?.content.endsWith('\nDazu kann ich was sagen'));
  check('Zitat pingt niemanden', a3?.allowedMentions?.repliedUser === undefined && (a3?.allowedMentions?.users ?? []).length === 0);

  const nurAnhang = dcMsg({
    reference: { messageId: 'DC_BILD' },
    async fetchReference() { return { author: { displayName: 'Max' }, content: '', embeds: [], attachments: [{ url: 'https://cdn/x.png' }] }; },
  });
  await bridge.fromDiscord(nurAnhang);
  check('Original ohne Text -> [Anhang]',
    hookSends[hookSends.length - 1]?.content.startsWith('> ↩️ **Max:** [Anhang]\n'), hookSends[hookSends.length - 1]?.content);

  console.log('--- Original gelöscht: spiegeln wie ohne Bezug ---');
  const weg = dcMsg({
    content: 'Egal',
    reference: { messageId: 'DC_WEG' },
    async fetchReference() { throw new Error('Unknown Message'); },
  });
  check('wird trotzdem gespiegelt', (await bridge.fromDiscord(weg)) === true);
  const a4 = hookSends[hookSends.length - 1];
  check('ohne Zitat, ohne replyTo', a4?.content === 'Egal' && a4?.replyTo === undefined, a4?.content);

  console.log('--- Textform-Rückfall antwortet auch ---');
  // Webhook kaputt -> Textform. Fluxer kann auch dort antworten.
  db.deleteRelayWebhook('fluxer', 'FX_KANAL');
  bridge.hooks.clear();
  fxChannel.createWebhook = async () => { throw new Error('Missing Permissions'); };
  const text1 = dcMsg({ content: 'Textform-Antwort', reference: { messageId: 'DC_ORIG' } });
  check('kommt an', (await bridge.fromDiscord(text1)) === true);
  const p1 = plainFluxer[plainFluxer.length - 1];
  check('channels.send bekommt replyTo und repliedUser',
    p1?.replyTo?.messageId === 'FX_ORIG' && p1?.allowedMentions?.repliedUser === true, JSON.stringify(p1));
  check('Paar auch in Textform gespeichert', db.relayPairFor('discord', text1.id)?.fluxer_id === p1?.sentId);

  // Fluxer lehnt die Referenz ab -> zweiter Versuch ohne Bezug.
  const fluxerClient = bridge.fluxerClient();
  const echtesSend = fluxerClient.channels.send;
  fluxerClient.channels.send = async (id, p) => {
    if (p.replyTo) throw new Error('Unknown Message');
    return echtesSend(id, p);
  };
  check('abgelehnte Referenz: Nachricht kommt trotzdem an',
    (await bridge.fromDiscord(dcMsg({ content: 'Trotzdem', reference: { messageId: 'DC_ORIG' } }))) === true);
  const p2 = plainFluxer[plainFluxer.length - 1];
  check('… ohne replyTo', p2?.replyTo === undefined && /Trotzdem/.test(p2?.content), JSON.stringify(p2));
  fluxerClient.channels.send = echtesSend;
  fxChannel.createWebhook = async () => makeHook('FXHOOK');
  bridge.hooks.clear();
```

- [ ] **Step 2: Test laufen lassen – er muss scheitern**

```bash
rm -rf .testdata && DATA_DIR=.testdata node test/relay.test.js 2>&1 | grep "❌" | head -5
```

Erwartet: „replyTo zeigt auf das Fluxer-Gegenstück" ❌ (heute wird die Referenz ignoriert).

- [ ] **Step 3: Referenz, Zitat, Antwort-Kontext**

`src/relay.js`, direkt **nach** der Funktion `sanitizeName` einfügen:

```js
// ------------------------------------------------------------ Antworten

/** Höchstlänge der Kopfzeile im Zitat einer Antwort. */
const QUOTE_LENGTH = 80;

/** Die Nachricht, auf die diese antwortet – oder null. */
function referenceOf(message, platform) {
  if (platform === 'discord') return message.reference?.messageId ?? null;
  const ref = message.messageReference;
  return ref?.message_id ?? ref?.messageId ?? null;
}

/**
 * Die Zitat-Zeile über einer Antwort – wenn drüben keine echte Antwort
 * möglich ist (Discord-Webhooks) oder das Original der Brücke nicht bekannt
 * ist. Erwähnungen im Zitat werden lesbar übersetzt, aber niemand wird
 * dafür gepingt: Die Zeile zitiert, sie spricht niemanden an.
 */
function quoteLine(original, targetPlatform) {
  const first = String(original.content ?? '')
    .split('\n').map((l) => l.trim()).find(Boolean) ?? '[Anhang]';
  const head = first.length > QUOTE_LENGTH ? `${first.slice(0, QUOTE_LENGTH)}…` : first;
  const uebersetzt = targetPlatform === 'fluxer'
    ? forFluxerFull(head, original) : forDiscordFull(head, original);
  return `> ↩️ **${displayName(original)}:** ${uebersetzt.text}`;
}

/**
 * Was eine Discord-Antwort drüben wird: bekanntes Paar → echte Antwort
 * (`replyTo`), sonst Zitat des nachgeladenen Originals, sonst nichts.
 */
async function replyContextDiscord(message, target) {
  const ref = referenceOf(message, 'discord');
  if (!ref) return { replyTo: null, quote: null };

  const pair = db.relayPairFor('discord', ref);
  if (pair) {
    const guildId = clients.fluxer?.channels?.cache?.get?.(target)?.guildId;
    return {
      replyTo: { channelId: target, messageId: pair.fluxer_id, ...(guildId ? { guildId } : {}) },
      quote: null,
    };
  }

  let original = null;
  if (typeof message.fetchReference === 'function') {
    original = await message.fetchReference().catch(() => null);
  }
  return { replyTo: null, quote: original ? quoteLine(original, 'fluxer') : null };
}
```

Achtung: `forFluxerFull`/`forDiscordFull` sind weiter unten in der Datei als `const` definiert (~Zeile 593). Das ist in Ordnung, weil `quoteLine` erst zur Laufzeit aufgerufen wird – aber `QUOTE_LENGTH` muss **vor** dem ersten Aufruf initialisiert sein, was bei Modul-Konstanten immer gilt.

`fromDiscord` ersetzen:

```js
async function fromDiscord(message) {
  if (!ready() || isOwn(message, 'discord') || ignored(message)) return false;
  learnFace(message);

  const target = destination(message, 'discord');
  if (!target || !body(message)) return false;

  // Antwort? Bekanntes Gegenstück → echte Antwort drüben, sonst Zitat.
  const { replyTo, quote } = await replyContextDiscord(message, target);
  const mitZitat = (text) => (quote ? `${quote}\n${text}` : text);

  const uebersetzt = forFluxerFull(body(message) ?? '', message);
  const persona = await sendAsPersona(
    'fluxer', target, message, mitZitat(uebersetzt.text), 'discord', uebersetzt.users, replyTo);
  if (persona.ok) {
    remember('discord', message.id, persona.id);
    return true;
  }

  const text = format(message, { platform: 'discord' });
  if (!text) return false;
  const rueckfall = forFluxerFull(text, message);
  const sentId = await sendPlainFluxer(
    target, mitZitat(rueckfall.text), pings(rueckfall.users), replyTo);
  remember('discord', message.id, sentId);
  return true;
}
```

Exporte ergänzen: `QUOTE_LENGTH, referenceOf, quoteLine, replyContextDiscord,`.

- [ ] **Step 4: Von Hand prüfen, bevor der Test läuft**

`quoteLine` mit `content = 'x'.repeat(120) + '\nzweite Zeile'`: erste Zeile 120 Zeichen > 80 → `'x'.repeat(80) + '…'`; Name `displayName({ author: { displayName: 'Max' } })` = `'Max'` (kein `NAME_SUFFIX` im Test). Ergebnis: `> ↩️ **Max:** xxxx…(80)…` – genau das, was Prüfung 6 verlangt.

- [ ] **Step 5: Tests laufen lassen – grün**

```bash
rm -rf .testdata && DATA_DIR=.testdata node test/relay.test.js 2>&1 | grep -c "❌"; rm -rf .testdata && DATA_DIR=.testdata node test/relay.test.js 2>&1 | tail -1
```

Erwartet: `0`.

- [ ] **Step 6: Commit**

```bash
git add src/relay.js test/relay.test.js
git commit -m "$(printf 'bruecke: discord-antworten kommen auf fluxer als echte antwort an\n\nBekanntes Paar -> replyTo ueber den Webhook (Fluxer nimmt message_reference\nan, geprueft), sonst Zitat-Zeile. Textform-Rueckfall antwortet ebenfalls.\n\nCo-Authored-By: Claude Opus 5 <noreply@anthropic.com>')"
```

---

### Task 4: Fluxer → Discord mit Zitat-Zeile, Patchnotes, Architektur

**Files:**
- Modify: `src/relay.js` (`fromFluxer`; neue Funktion `quoteForFluxerReply` neben `replyContextDiscord`)
- Modify: `src/data/patchnotes.js` (oben im Array)
- Modify: `ARCHITEKTUR.md` (neuer §16 am Ende)
- Test: `test/relay.test.js` (`replyTests()`)

**Interfaces:**
- Consumes: `quoteLine`, `referenceOf` (Task 3), `remember`, `sendAsPersona` (Task 2).
- Produces: `quoteForFluxerReply(message)` → `string | null`.

- [ ] **Step 1: Prüfung 8 schreiben**

In `replyTests()` ans Ende anhängen:

```js
  console.log('--- Fluxer antwortet: Zitat-Zeile auf Discord ---');
  // Discord-Webhooks können nicht antworten – also Zitat. Das Original
  // hängt an der Fluxer-Nachricht (referencedMessage) oder wird nachgeladen.
  const mitOriginal = fxMsg({
    content: 'Ja, gleich!',
    messageReference: { message_id: 'FX_Q', channel_id: 'FX_KANAL' },
    referencedMessage: {
      author: { globalName: 'Diabilon' },
      content: '<@FXUSER2> kommst du?', embeds: [], attachments: [],
      mentions: [{ id: 'FXUSER2', username: 'Simon' }],
    },
  });
  check('wird gespiegelt', (await bridge.fromFluxer(mitOriginal)) === true);
  const z1 = hookSends[hookSends.length - 1];
  check('über den Discord-Webhook', z1?.hook === 'DCHOOK', z1?.hook);
  check('Zitat-Zeile mit Name und lesbarer Erwähnung',
    z1?.content.startsWith('> ↩️ **Diabilon:** @Simon kommst du?\n'), z1?.content);
  check('Text darunter', z1?.content.endsWith('\nJa, gleich!'));
  check('die Erwähnung im Zitat pingt niemanden',
    (z1?.allowedMentions?.users ?? []).length === 0 && z1?.replyTo === undefined, JSON.stringify(z1?.allowedMentions));

  originals.set('FX_LADEN', { author: { globalName: 'Diabilon' }, content: 'nachgeladen', embeds: [], attachments: [] });
  const nachladen = fxMsg({ content: 'ok', messageReference: { message_id: 'FX_LADEN' } });
  await bridge.fromFluxer(nachladen);
  check('ohne referencedMessage wird das Original nachgeladen',
    hookSends[hookSends.length - 1]?.content.startsWith('> ↩️ **Diabilon:** nachgeladen\n'), hookSends[hookSends.length - 1]?.content);

  const geloescht = fxMsg({ content: 'hm', messageReference: { message_id: 'FX_WEG' } });
  check('gelöschtes Original: spiegeln ohne Zitat', (await bridge.fromFluxer(geloescht)) === true
    && hookSends[hookSends.length - 1]?.content === 'hm', hookSends[hookSends.length - 1]?.content);

  db.clearRelayPairs();
  db.deleteRelayWebhook('discord', 'DC_KANAL');
  db.deleteRelayWebhook('fluxer', 'FX_KANAL');
```

- [ ] **Step 2: Test laufen lassen – er muss scheitern**

```bash
rm -rf .testdata && DATA_DIR=.testdata node test/relay.test.js 2>&1 | grep "❌" | head -3
```

Erwartet: „Zitat-Zeile mit Name und lesbarer Erwähnung" ❌.

- [ ] **Step 3: `quoteForFluxerReply` und `fromFluxer`**

In `src/relay.js` direkt nach `replyContextDiscord` einfügen:

```js
/**
 * Das Zitat für eine Fluxer-Antwort. Discord-Webhooks können nicht
 * antworten, deshalb immer Zitat – das Original hängt meist schon an der
 * Nachricht, sonst wird es aus dem Kanal nachgeladen.
 */
async function quoteForFluxerReply(message) {
  const ref = referenceOf(message, 'fluxer');
  if (!ref) return null;

  let original = message.referencedMessage ?? null;
  if (!original) {
    const channel = clients.fluxer?.channels?.cache?.get?.(message.channelId)
      ?? clients.fluxer?.channels?.get?.(message.channelId) ?? null;
    try {
      original = channel?.messages?.fetch ? await channel.messages.fetch(ref) : null;
    } catch {
      original = null;
    }
  }
  return original ? quoteLine(original, 'discord') : null;
}
```

`fromFluxer` ersetzen:

```js
/** Fluxer → Discord. */
async function fromFluxer(message) {
  if (!ready() || isOwn(message, 'fluxer') || ignored(message)) return false;
  learnFace(message, 'fluxer');

  const target = destination(message, 'fluxer');
  if (!target || !body(message)) return false;

  const quote = await quoteForFluxerReply(message);
  const mitZitat = (text) => (quote ? `${quote}\n${text}` : text);

  const uebersetzt = forDiscordFull(body(message) ?? '', message);
  const persona = await sendAsPersona(
    'discord', target, message, mitZitat(uebersetzt.text), 'fluxer', uebersetzt.users);
  if (persona.ok) {
    remember('fluxer', message.id, persona.id);
    return true;
  }

  const text = format(message, { platform: 'fluxer' });
  if (!text) return false;
  const channel = await clients.discord.channels.fetch(target);
  const rueckfall = forDiscordFull(text, message);
  const sent = await channel.send({
    content: mitZitat(rueckfall.text), allowedMentions: pings(rueckfall.users),
  });
  remember('fluxer', message.id, sent?.id ? String(sent.id) : null);
  return true;
}
```

Export ergänzen: `quoteForFluxerReply,`.

- [ ] **Step 4: Tests grün, volle Kette**

```bash
rm -rf .testdata && DATA_DIR=.testdata node test/relay.test.js 2>&1 | tail -1; npm test 2>&1 | grep -c '❌'
```

Erwartet: `… bestanden, 0 fehlgeschlagen` und `0`.

- [ ] **Step 5: Patchnotes**

`src/data/patchnotes.js`, ganz oben im Array vor `version: '1.29.0'`:

```js
  {
    version: '1.30.0',
    date: '2026-09-12',
    title: '↩️ Antworten über die Brücke',
    lines: [
      '↩️ **Antworten kommen jetzt als Antworten an.** Wer auf Discord auf eine Fluxer-Nachricht antwortet, erzeugt auf Fluxer eine echte Antwort – mit Antwort-Linie, Name und Avatar wie gewohnt. Der Angesprochene bekommt seine Benachrichtigung.',
      '💬 **In die andere Richtung ein Zitat.** Discord erlaubt Webhooks keine Antworten, deshalb steht eine Fluxer-Antwort auf Discord mit einer Zitat-Zeile über dem Text: „↩️ **Name:** erste Zeile der Originalnachricht…“.',
      '🗓️ **Zwei Wochen Gedächtnis.** Die Brücke merkt sich gespiegelte Nachrichten 14 Tage; auf Älteres kommt statt der echten Antwort ebenfalls das Zitat.',
    ],
  },
```

Dann `DATA_DIR=.testdata node test/patchnotes.test.js | tail -1` → grün.

- [ ] **Step 6: ARCHITEKTUR.md §16**

Am Ende von `ARCHITEKTUR.md` anhängen:

```markdown
## 16. Die Brücke antwortet

Die Kanal-Brücke (`src/relay.js`) spiegelt Nachrichten zwischen Discord und
Fluxer als Persona des Absenders (Webhooks). Seit 1.30.0 merkt sie sich dabei
in `relay_messages`, welche Nachricht welche gespiegelt hat – ein Paar
`discord_id ↔ fluxer_id`, **14 Tage** lang, aufgeräumt beim Einfügen (§4).

Eine Antwort wird damit zuordenbar, aber die Plattformen können nicht dasselbe:

| Richtung | Darstellung | Warum |
|---|---|---|
| Discord → Fluxer | echte Antwort (`replyTo`), Persona bleibt, Autor wird gepingt | Fluxers Webhook-Endpunkt nimmt `message_reference` an (geprüft 2026-09-12) |
| Fluxer → Discord | Zitat-Zeile `> ↩️ **Name:** Kopfzeile…` (80 Zeichen) | Discord-Webhooks dürfen nicht antworten |

Ist das Original der Brücke unbekannt (älter als 14 Tage, nie gespiegelt),
kommt auch nach Fluxer das Zitat; lässt es sich nicht mehr laden, wird ohne
Hinweis gespiegelt. Erwähnungen im Zitat werden lesbar übersetzt, pingen aber
niemanden – gepingt wird nur, wen die Antwort selbst erwähnt, plus der Autor
des Originals bei einer echten Antwort.
```

- [ ] **Step 7: Commit**

```bash
git add src/relay.js test/relay.test.js src/data/patchnotes.js ARCHITEKTUR.md
git commit -m "$(printf 'bruecke: fluxer-antworten mit zitat-zeile auf discord, patchnotes 1.30.0\n\nCo-Authored-By: Claude Opus 5 <noreply@anthropic.com>')"
```

---

## Selbstprüfung des Plans

**Spec-Abdeckung:** Tabelle + `setRelayPair`/`relayPairFor`/`clearRelayPairs`/TTL → Task 1; Sendewege mit IDs, Paare in beide Richtungen → Task 2; `referenceOf`, `quoteLine`, `QUOTE_LENGTH`, Discord → Fluxer echte Antwort, `guildId`, Zitat-Rückfall, `[Anhang]`, Textform mit `replyTo` und zweiter Versuch ohne → Task 3; Fluxer → Discord Zitat mit `referencedMessage`/Nachladen, Erwähnungen ohne Ping → Task 4; Patchnotes, ARCHITEKTUR §16 → Task 4. Tests 1–2 (Task 1), 3 und 9 (Task 2), 4–7 und 10 (Task 3), 8 (Task 4).

**Namen quer über die Tasks:** `sendAsPersona(…, users, replyTo)` → `{ ok, id }` (2, 3, 4); `sendPlainFluxer(channelId, content, allowedMentions, replyTo)` (2, 3); `remember(sourcePlatform, sourceId, sentId)` (2, 3, 4); `referenceOf`, `quoteLine(original, targetPlatform)`, `replyContextDiscord(message, target)` (3, 4); `quoteForFluxerReply(message)` (4); Test-Fälschungen `hookSends[].hook/sentId/replyTo/allowedMentions`, `plainFluxer`, `originals`, `dcMsg`, `fxMsg`, `nextId` (2, 3, 4).
