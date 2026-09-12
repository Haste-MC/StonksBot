# Antworten über die Brücke

Stand: 2026-09-12 · Zweig `main` · betrifft `src/relay.js`, `src/db.js`,
`test/relay.test.js`

## Ziel

Wer auf Discord mit der Antwort-Funktion auf eine Nachricht antwortet, die
von Fluxer kam (oder umgekehrt), soll das auf der anderen Seite sehen. Heute
kommt die Antwort als lose Nachricht an – der Bezug geht verloren.

Zwei Wege, weil die Plattformen unterschiedlich können:

| Richtung | Darstellung drüben | Warum |
|---|---|---|
| Discord → Fluxer | **echte Antwort** mit Antwort-Linie, Persona bleibt, Autor wird gepingt | Fluxers Webhook-Endpunkt nimmt `message_reference` an – am 2026-09-12 in `#stonks` geprüft (Antwort kam mit gesetzter Referenz zurück, `referencedMessage` beim Nachladen vorhanden). Das SDK tippt `WebhookSendOptions` nur enger als der Server kann. |
| Fluxer → Discord | **Zitat-Zeile** über dem Text | Discord-Webhooks dürfen laut API keine `message_reference` setzen. |

Rückfall auf beiden Seiten: Wenn die Originalnachricht der Brücke nicht
bekannt ist, kommt die Zitat-Zeile; wenn sie sich nicht einmal mehr laden
lässt, wird wie heute ohne Hinweis gespiegelt.

## Nicht-Ziele

- Keine Antwort als Bot-Nutzer auf Discord (würde die Persona kosten; der
  Nutzer hat sich für das Zitat entschieden).
- Kein Nachbearbeiten alter Nachrichten, keine Weiterleitungen (`forward`).
- Durchsagen (`broadcast`) bleiben unverändert – sie antworten nie.

## Was heute gilt (gegen den Code geprüft)

| | Quelle |
|---|---|
| Die Brücke merkt sich keine Nachrichten; `sendAsPersona` gibt `true/false` zurück, der Textform-Rückfall wirft das Ergebnis von `send` weg | `relay.js:476–512, 755–793` |
| Fluxer-Webhook: `hook.send(options, wait)` – mit `wait = true` kommt die erzeugte `Message` zurück; `prepareMessagePostPayload` übernimmt `replyTo` als `message_reference` | `@fluxerjs/core/dist/index.js:2344–2361` |
| Fluxer-Kanal ohne Webhook: `client.channels.send(id, { replyTo })` – echte Antwort auch in Textform | `MessageSendOptions.replyTo` |
| Fluxer-Nachricht: `message.messageReference` (`{ channel_id, message_id, guild_id }`), `referencedMessage` beim Nachladen; `channel.messages.fetch(id)` | Probe vom 2026-09-12 |
| Discord: `message.reference?.messageId`, `message.fetchReference()`; Webhook-`send` liefert die Nachricht mit `id` | discord.js |
| Nachrichten der Brücke werden auf 1.500 Zeichen gekürzt (`MAX_LENGTH`) | `relay.js:67` |

## Das Gedächtnis: `relay_messages`

```sql
CREATE TABLE IF NOT EXISTS relay_messages (
  discord_id TEXT PRIMARY KEY,   -- Nachricht auf Discord (Original oder Spiegel)
  fluxer_id  TEXT NOT NULL,      -- ihr Gegenstück auf Fluxer
  created_at INTEGER NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_relay_messages_fluxer ON relay_messages (fluxer_id);
```

Ein Paar je gespiegelter Nachricht, **egal in welche Richtung** – die Tabelle
weiß nicht, welche Seite das Original war, und muss es nicht wissen: Wer auf
eine der beiden antwortet, meint die andere.

`db.js`:

- `setRelayPair(discordId, fluxerId, now = Date.now())` – schreibt das Paar
  (`INSERT OR REPLACE`) und löscht in derselben Funktion alles, was älter als
  `RELAY_PAIR_TTL_MS` = **14 Tage** ist. Kein Scheduler (§4).
- `relayPairFor(platform, messageId)` → `{ discord_id, fluxer_id } | null`;
  `platform` bestimmt, in welcher Spalte gesucht wird.
- `clearRelayPairs()` für Tests.

Kein Kanal in der Tabelle: Die Brücke spiegelt je Kanalpaar, und die
Antwort landet ohnehin im Zielkanal der aktuellen Nachricht. Eine Referenz
auf eine Nachricht in einem anderen Kanal wäre auf Discord gar nicht möglich.

## Ablauf

### Sendewege geben die Nachricht zurück

Alle drei Wege, auf denen die Brücke etwas absetzt, liefern künftig die
**ID der erzeugten Nachricht** (String) oder `null`:

- `sendAsPersona(platform, channelId, message, text, sourcePlatform, users = [], replyTo = null)`
  – Fluxer: `hook.send(payload, true)`; Discord: `hook.send(payload)`.
  Rückgabe `sent?.id ?? null`; bei Fehler wie heute Webhook vergessen und
  `null` (der Aufrufer fällt auf Textform zurück). Mit `replyTo` bekommt das
  Payload `replyTo` **und** `allowedMentions.repliedUser = true` – die
  Antwort pingt den Autor des Originals, wie eine echte Antwort (Beschluss A).
- Textform Fluxer: `clients.fluxer.channels.send(target, { content, allowedMentions, replyTo })`
  → `sent?.id ?? null`.
- Textform Discord: `channel.send({ … })` → `sent?.id ?? null`.

Nach jedem erfolgreichen Versand: `db.setRelayPair(discordId, fluxerId)`. Bei
`fromDiscord` ist `discordId = message.id`, `fluxerId` die Rückgabe; bei
`fromFluxer` umgekehrt. Ohne ID (Rückgabe `null`) wird nichts gespeichert –
das ist kein Fehler, nur eine Nachricht, auf die man später nicht antworten
kann.

### Die Referenz lesen

`referenceOf(message, platform)` → `messageId | null`:

- Discord: `message.reference?.messageId`
- Fluxer: `message.messageReference?.message_id ?? message.messageReference?.messageId`

### Discord → Fluxer

```
ref = referenceOf(message, 'discord')
wenn ref:
  paar = db.relayPairFor('discord', ref)
  wenn paar:   replyTo = { channelId: target, messageId: paar.fluxer_id }
  sonst:       original = await message.fetchReference().catch(() => null)
               wenn original: text = quoteLine(original, 'discord') + '\n' + text
sendAsPersona(…, replyTo) → id  |  Textform mit replyTo → id
db.setRelayPair(message.id, id)
```

`replyTo.guildId` wird mitgegeben, wenn der Fluxer-Kanal im Cache liegt
(`clients.fluxer.channels.cache?.get(target)?.guildId`), sonst weggelassen –
das SDK erlaubt beides.

### Fluxer → Discord

```
ref = referenceOf(message, 'fluxer')
wenn ref:
  original = message.referencedMessage
          ?? await fluxerChannel(message.channelId)?.messages?.fetch(ref).catch(() => null)
  wenn original: text = quoteLine(original, 'fluxer') + '\n' + text
sendAsPersona(…) → id  |  Textform → id
db.setRelayPair(id, message.id)
```

Kein Nachschlagen in der Tabelle nötig – Discord kann ohnehin nicht
antworten, das Zitat braucht nur die Originalnachricht.

### Die Zitat-Zeile

`quoteLine(original, sourcePlatform)`:

```
> ↩️ **Max:** erste Zeile der Originalnachricht…
```

- Name: `displayName(original)` (die vorhandene Funktion – bei einem
  Spiegel ist das der Persona-Name, also der richtige Mensch).
- Text: erste nicht-leere Zeile von `body(original)`; leer (nur Anhang) →
  `[Anhang]`; länger als `QUOTE_LENGTH` = **80** Zeichen → gekürzt mit `…`.
- Erwähnungen in der Zeile werden wie der Text übersetzt (`forFluxerFull` /
  `forDiscordFull`), aber **ohne** deren Nutzer zu pingen – die Zeile zitiert,
  sie spricht niemanden an. Konkret: die Übersetzung des Zitats liefert
  `users`, die verworfen werden; gepingt wird nur, was die eigentliche
  Antwort erwähnt (plus `repliedUser` bei echter Antwort).
- `MAX_LENGTH` gilt weiter für den Text; die Zitat-Zeile kommt obendrauf
  (höchstens ~100 Zeichen, weit unter beiden Plattformgrenzen).

### Fehlerfälle

| Fall | Verhalten |
|---|---|
| Referenz zeigt auf eine unbekannte Nachricht (älter als 14 Tage, vor dem Update, nie gespiegelt) | Zitat-Zeile statt echter Antwort (Discord → Fluxer); Fluxer → Discord unverändert Zitat |
| Original gelöscht / nicht ladbar | Spiegeln ohne Hinweis, wie heute; kein Log-Spam |
| Webhook-Versand mit `replyTo` schlägt fehl | wie heute: Webhook vergessen, Textform – **mit** `replyTo` (Fluxer kann das auch ohne Webhook). Die Brücke unterscheidet nicht, *warum* der Webhook scheiterte. |
| Auch die Textform mit `replyTo` wirft (Fluxer lehnt die Referenz ab, z. B. Original inzwischen gelöscht) | zweiter Versuch **ohne** `replyTo`, ohne Zitat – die Nachricht kommt an, der Bezug fehlt. Danach Schluss; kein dritter Versuch. |
| `channels.send` liefert kein Objekt (älteres SDK) | kein Paar gespeichert, sonst alles wie heute |

## Tests (`test/relay.test.js`, Abschnitt „Antworten über die Brücke")

Gefälschte Clients wie bisher; die Webhook-Fälschung liefert
`{ id: 'MSG_<n>' }` aus `send`, die Kanal-Fälschungen ebenfalls, damit Paare
entstehen. Zusätzlich `fetchReference` (Discord) und `messages.fetch` (Fluxer)
mit einer kleinen In-Memory-Tabelle von Originalen.

1. **Paare.** `setRelayPair('D1', 'F1')`; `relayPairFor('discord', 'D1').fluxer_id === 'F1'`
   und `relayPairFor('fluxer', 'F1').discord_id === 'D1'`; unbekannt → `null`.
2. **Aufräumen.** Ein Paar mit `created_at` 15 Tage alt verschwindet beim
   nächsten `setRelayPair`; ein 13 Tage altes bleibt.
3. **Spiegeln legt Paare an** – in beide Richtungen: nach `fromDiscord`
   existiert `relayPairFor('discord', message.id)`, nach `fromFluxer`
   `relayPairFor('fluxer', message.id)`.
4. **Echte Antwort Discord → Fluxer.** Discord-Nachricht mit `reference` auf
   ein bekanntes Paar → das Webhook-Payload enthält `replyTo.messageId` mit
   der Fluxer-ID des Paars und `allowedMentions.repliedUser === true`; kein
   Zitat im Text.
5. **Antwort auf den Spiegel eines Fluxer-Nutzers.** Paar `(DC_SPIEGEL, FX_ORIG)`
   angelegt wie beim Spiegeln; Discord-Antwort auf `DC_SPIEGEL` → `replyTo.messageId === 'FX_ORIG'`.
6. **Unbekannte Referenz, Original ladbar** → kein `replyTo`, Text beginnt mit
   `> ↩️ **Max:**` und der ersten Zeile; eine 120-Zeichen-Zeile wird auf 80 + `…` gekürzt.
7. **Unbekannte Referenz, Original weg** (`fetchReference` wirft) → gespiegelt
   wie ohne Referenz, kein Absturz, kein Zitat.
8. **Fluxer → Discord** mit `messageReference` → Zitat-Zeile mit Name und
   Kopfzeile; Erwähnung im Zitat wird lesbar (`@Name`), aber
   `allowedMentions.users` enthält nur die Nutzer der eigentlichen Antwort.
9. **Ohne Referenz unverändert** – die bestehenden Abschnitte der Datei
   bleiben grün ohne Änderung an ihren Prüfungen (nur die Fälschungen liefern
   jetzt IDs).
10. **Textform-Rückfall mit Antwort.** `RELAY_WEBHOOKS=false`: Discord-Antwort
    auf bekanntes Paar → `channels.send` bekommt `replyTo`.

## Berührte Dateien

| Datei | Änderung |
|---|---|
| `src/db.js` | Tabelle `relay_messages`, `setRelayPair`, `relayPairFor`, `clearRelayPairs`, `RELAY_PAIR_TTL_MS` |
| `src/relay.js` | `referenceOf`, `quoteLine`, `QUOTE_LENGTH`; `sendAsPersona` mit `replyTo` und ID-Rückgabe; `fromDiscord`/`fromFluxer` mit Antwort-Logik und Paar-Speicherung; Textform-Wege geben IDs zurück |
| `test/relay.test.js` | Fälschungen liefern IDs; neuer Abschnitt mit den 10 Prüfungen |
| `src/data/patchnotes.js` | Eintrag 1.30.0: „↩️ Antworten über die Brücke" |
| `ARCHITEKTUR.md` | neuer kurzer Abschnitt §16 „Die Brücke antwortet“ (es gibt bisher keinen Brücken-Abschnitt): das Gedächtnis, die zwei Darstellungen, warum Discord nur zitiert, 14-Tage-Regel |

## Reihenfolge der Umsetzung

1. `db.js` Paare + Tests 1–2.
2. Sendewege geben IDs zurück, Spiegeln speichert Paare + Test 3 (und Test 9:
   Bestand bleibt grün).
3. Discord → Fluxer echte Antwort + Zitat-Rückfall + Tests 4–7, 10.
4. Fluxer → Discord Zitat + Test 8.
5. Patchnotes, ARCHITEKTUR.md.
