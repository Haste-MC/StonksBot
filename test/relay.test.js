/**
 * Tests für die Kanal-Brücke zwischen Discord und Fluxer.
 *
 * Wichtigster Punkt: der SCHLEIFENSCHUTZ. Ohne ihn würde jede gespiegelte
 * Nachricht drüben wieder gespiegelt – beide Kanäle wären in Sekunden geflutet.
 *
 * Aufruf: npm run test:relay
 */
process.env.RELAY_DISCORD_CHANNEL = 'DC_KANAL';
process.env.RELAY_FLUXER_CHANNEL = 'FX_KANAL';
process.env.RELAY_ALL = 'true';
process.env.RELAY_EXCLUDE = 'admin, intern';
process.env.RELAY_MAP = 'DC_SONDER:FX_ANDERS';
// Durchsagen: Hauptkanal und Wirtschaftskanal sind absichtlich verschieden,
// damit die Trennung überhaupt sichtbar werden kann.
process.env.ANNOUNCE_DISCORD_CHANNEL = 'DC_HAUPT';
process.env.ANNOUNCE_FLUXER_CHANNEL = 'FX_HAUPT';
process.env.ECONOMY_DISCORD_CHANNEL = 'DC_WIRTSCHAFT';
process.env.ECONOMY_FLUXER_CHANNEL = 'FX_WIRTSCHAFT';
// Dieser Teil prüft die Textform (Notausgang). Die Persona-Spiegelung über
// Webhooks hat unten einen eigenen Abschnitt mit eigenem Modul-Zustand.
process.env.RELAY_WEBHOOKS = 'false';

const relay = require('../src/relay');

let pass = 0, fail = 0;
const check = (label, ok, extra = '') => {
  if (ok) { pass++; console.log(`  ✅ ${label}`); }
  else { fail++; console.log(`  ❌ ${label} ${extra}`); }
};

/**
 * Das Modul mit anderen Umgebungsvariablen noch einmal laden.
 *
 * Die Kanäle werden beim Laden gelesen (Konstanten) – anders lässt sich ein
 * zweites Setup nicht prüfen. Danach wird alles zurückgedreht, damit die
 * folgenden Abschnitte wieder das ursprüngliche Modul sehen.
 */
function fresh(env) {
  const alt = {};
  for (const [k, v] of Object.entries(env)) { alt[k] = process.env[k]; process.env[k] = v; }
  delete require.cache[require.resolve('../src/relay')];
  const geladen = require('../src/relay');

  for (const [k, v] of Object.entries(alt)) {
    if (v === undefined) delete process.env[k]; else process.env[k] = v;
  }
  delete require.cache[require.resolve('../src/relay')];
  return geladen;
}

// Zwei gefälschte Clients, die mitschreiben, was gesendet wurde.
const sentToFluxer = [];
const sentToDiscord = [];
// Beide Server mit gleichem Aufbau nachstellen – teils mit Verzierungen im
// Namen, damit die Paarung darüber hinweg funktionieren muss.
const chan = (id, name) => ({ id, name, isTextBased: () => true, isDM: () => false });
const discordChannels = [
  chan('DC_KANAL', '💰┃economy'), chan('DC_ALLGEMEIN', 'allgemein'),
  chan('DC_ADMIN', 'admin'), chan('DC_NUR_HIER', 'nur-discord'),
];
const fluxerChannels = [
  chan('FX_KANAL', 'economy'), chan('FX_ALLGEMEIN', '💬 Allgemein'),
  chan('FX_ADMIN', 'admin'),
];

const discordClient = {
  user: { id: 'DISCORDBOT' },
  channels: {
    cache: new Map(discordChannels.map((c) => [c.id, c])),
    async fetch(id) {
      return { id, async send(p) { sentToDiscord.push({ id, ...p }); } };
    },
  },
};
const fluxerClient = {
  user: { id: 'FLUXERBOT' },
  channels: {
    values: () => fluxerChannels.values(),
    async send(id, p) { sentToFluxer.push({ id, ...p }); },
  },
};

const msg = (over = {}) => ({
  author: { id: 'USER1', displayName: 'Kevin' },
  content: 'Hallo',
  channelId: 'DC_KANAL',
  embeds: [],
  attachments: [],
  ...over,
});

(async () => {
  console.log('--- Ohne angemeldete Clients passiert nichts ---');
  check('Brücke ist konfiguriert', relay.enabled === true);
  check('aber noch nicht bereit', relay.ready() === false);
  check('Weiterleiten tut nichts', (await relay.fromDiscord(msg())) === false);

  relay.register('discord', discordClient);
  relay.register('fluxer', fluxerClient);
  check('nach Anmeldung bereit', relay.ready() === true);

  console.log('--- Discord → Fluxer ---');
  check('Nachricht wird gespiegelt', (await relay.fromDiscord(msg())) === true);
  check('kam im Fluxer-Kanal an', sentToFluxer[0]?.id === 'FX_KANAL');
  check('Name und Text sind enthalten',
    /Kevin/.test(sentToFluxer[0].content) && /Hallo/.test(sentToFluxer[0].content),
    sentToFluxer[0]?.content);
  check('Herkunft ist erkennbar (Fahne 🔵 für Discord)',
    sentToFluxer[0].content.startsWith('🔵'), sentToFluxer[0].content.slice(0, 20));

  console.log('--- Währungs-Emoji wird übersetzt ---');
  // UnbelievaBoat schreibt sein Custom-Emoji `<:Rubine:123>` – auf Fluxer stünde
  // davon nur Rohtext (`:Rubine:`). Genau das war der Fehler in der Praxis.
  const currency = require('../src/currency');
  const identity = require('../src/identity');
  const unbmod = require('../src/unb');
  unbmod.unb.getGuild = async () => ({ currencySymbol: '<:Rubine:1067>' });
  await currency.getSymbol(identity.world());

  sentToFluxer.length = 0;
  await relay.fromDiscord(msg({
    author: { id: 'UNB', displayName: 'UnbelievaBoat' },
    content: '<:check:456> Deposited <:Rubine:1067>4.492 to your bank!',
  }));
  const relayed = sentToFluxer[0].content;
  check('kein rohes Discord-Emoji mehr auf Fluxer', !/<a?:[^:]+:\d+>/.test(relayed), relayed);
  check('Geldzeichen ist ein Emoji', relayed.includes('🪙'), relayed);
  check('fremdes Emoji wird zum Namen', relayed.includes('check'), relayed);

  sentToDiscord.length = 0;
  await relay.fromFluxer(msg({
    channelId: 'FX_KANAL',
    content: 'Ich habe 🪙 300 – und ein <:fluxding:987>',
  }));
  const back = sentToDiscord[0].content;
  check('Fluxer-Emoji kommt auf Discord nicht roh an',
    !back.includes('<:fluxding:987>'), back);

  // Zähler zurücksetzen, damit die folgenden Abschnitte wieder bei null anfangen.
  sentToFluxer.length = 0;
  sentToDiscord.length = 0;

  console.log('--- Fluxer → Discord ---');
  check('Nachricht wird gespiegelt',
    (await relay.fromFluxer(msg({ channelId: 'FX_KANAL' }))) === true);
  check('kam im Discord-Kanal an', sentToDiscord.length === 1);
  // Kein Ping-Spam: `parse` bleibt leer (nie @everyone/@here/Rollen), und
  // ohne ausdrückliche Erwähnung ist auch die Nutzerliste leer.
  const am = sentToDiscord[0].allowedMentions;
  check('erwähnt niemanden (kein Ping-Spam)',
    Array.isArray(am?.parse) && am.parse.length === 0 && (am.users ?? []).length === 0,
    JSON.stringify(am));

  console.log('--- SCHLEIFENSCHUTZ ---');
  const before = sentToFluxer.length + sentToDiscord.length;
  check('eigene Discord-Nachricht wird NICHT gespiegelt',
    (await relay.fromDiscord(msg({ author: { id: 'DISCORDBOT' } }))) === false);
  check('eigene Fluxer-Nachricht wird NICHT gespiegelt',
    (await relay.fromFluxer(msg({ channelId: 'FX_KANAL', author: { id: 'FLUXERBOT' } }))) === false);
  check('es wurde nichts gesendet', sentToFluxer.length + sentToDiscord.length === before);

  console.log('--- Nur der eingestellte Kanal ---');
  check('anderer Discord-Kanal wird ignoriert',
    (await relay.fromDiscord(msg({ channelId: 'IRGENDWO' }))) === false);
  check('anderer Fluxer-Kanal wird ignoriert',
    (await relay.fromFluxer(msg({ channelId: 'ANDERSWO' }))) === false);

  console.log('--- Fremde Bots werden gespiegelt (UnbelievaBoat!) ---');
  const unb = msg({
    author: { id: 'UNBELIEVABOAT', username: 'UnbelievaBoat', bot: true },
    content: '',
    embeds: [{
      title: 'Arbeit',
      description: 'Du hast 1.500 verdient',
      fields: [{ name: 'Kontostand', value: '12.000' }],
    }],
  });
  check('Bot-Nachricht wird gespiegelt', (await relay.fromDiscord(unb)) === true);
  const text = sentToFluxer[sentToFluxer.length - 1].content;
  check('Embed-Titel übernommen', /Arbeit/.test(text), text);
  check('Embed-Text übernommen', /1\.500 verdient/.test(text));
  check('Embed-Feld übernommen', /Kontostand/.test(text) && /12\.000/.test(text));

  console.log('--- Leeres und Überlanges ---');
  check('völlig leere Nachricht wird übersprungen',
    (await relay.fromDiscord(msg({ content: '' }))) === false);
  const long = await relay.fromDiscord(msg({ content: 'x'.repeat(5000) }));
  const longText = sentToFluxer[sentToFluxer.length - 1].content;
  check('überlange Nachricht wird gekürzt', long === true && longText.length < 1700,
    String(longText.length));
  check('Kürzung ist erkennbar', longText.endsWith('…'));

  console.log('--- Anhänge ---');
  const withFile = msg({ content: 'Schau mal', attachments: [{ url: 'https://x/y.png' }] });
  await relay.fromDiscord(withFile);
  check('Anhang-Verweis wird mitgeschickt',
    /https:\/\/x\/y\.png/.test(sentToFluxer[sentToFluxer.length - 1].content));

  console.log('--- Alle Kanäle: Paarung über den Namen ---');
  check('findet economy trotz Verzierung',
    relay.counterpart('💰┃economy', 'fluxer')?.id === 'FX_KANAL');
  check('findet Allgemein in beide Richtungen',
    relay.counterpart('allgemein', 'fluxer')?.id === 'FX_ALLGEMEIN' &&
    relay.counterpart('💬 Allgemein', 'discord')?.id === 'DC_ALLGEMEIN');
  check('ohne Gegenstück kommt nichts zurück',
    relay.counterpart('nur-discord', 'fluxer') === null);

  const allgemein = msg({ channelId: 'DC_ALLGEMEIN', channel: { id: 'DC_ALLGEMEIN', name: 'allgemein' } });
  check('Nachricht landet im gleichnamigen Kanal',
    (await relay.fromDiscord(allgemein)) === true &&
    sentToFluxer[sentToFluxer.length - 1].id === 'FX_ALLGEMEIN');

  const zurueck = msg({
    author: { id: 'FXUSER', displayName: 'Simon' },
    channelId: 'FX_ALLGEMEIN', channel: { id: 'FX_ALLGEMEIN', name: '💬 Allgemein' },
  });
  check('und zurück in den passenden Discord-Kanal',
    (await relay.fromFluxer(zurueck)) === true &&
    sentToDiscord[sentToDiscord.length - 1].id === 'DC_ALLGEMEIN');

  console.log('--- Ausnahmen ---');
  const adminMsg = msg({ channelId: 'DC_ADMIN', channel: { id: 'DC_ADMIN', name: 'admin' } });
  check('ausgeschlossener Kanal wird nicht gespiegelt',
    (await relay.fromDiscord(adminMsg)) === false);

  const einsam = msg({ channelId: 'DC_NUR_HIER', channel: { id: 'DC_NUR_HIER', name: 'nur-discord' } });
  check('Kanal ohne Gegenstück wird übersprungen',
    (await relay.fromDiscord(einsam)) === false);

  console.log('--- Ausdrückliche Zuordnung hat Vorrang ---');
  const sonder = msg({ channelId: 'DC_SONDER', channel: { id: 'DC_SONDER', name: 'egal' } });
  check('geht an das eingetragene Ziel',
    (await relay.fromDiscord(sonder)) === true &&
    sentToFluxer[sentToFluxer.length - 1].id === 'FX_ANDERS');

  console.log('--- Durchsagen: Wichtiges und Alltag gehen getrennt raus ---');
  /*
   * Warum getrennt: Ein Treppchenwechsel passiert selten und soll auffallen,
   * ein Auktions-Zuschlag stündlich. Im selben Kanal spült der Alltag den
   * seltenen Glückwunsch weg – deshalb zwei Sorten.
   */
  sentToDiscord.length = 0;
  sentToFluxer.length = 0;

  const wichtig = await relay.broadcast('🥇 Kevin ist die neue Nummer 1');
  check('Wichtiges geht auf beide Plattformen',
    wichtig.join('+') === 'discord+fluxer', wichtig.join('+'));
  check('und zwar in den Hauptkanal',
    sentToDiscord[0]?.id === 'DC_HAUPT' && sentToFluxer[0]?.id === 'FX_HAUPT',
    `${sentToDiscord[0]?.id} / ${sentToFluxer[0]?.id}`);

  await relay.broadcast('🏬 Garage #3 geht für 12.400 weg', { lane: 'wirtschaft' });
  check('der Alltag landet im Wirtschaftskanal',
    sentToDiscord[1]?.id === 'DC_WIRTSCHAFT' && sentToFluxer[1]?.id === 'FX_WIRTSCHAFT',
    `${sentToDiscord[1]?.id} / ${sentToFluxer[1]?.id}`);
  check('der Hauptkanal bleibt davon verschont',
    sentToDiscord.filter((m) => m.id === 'DC_HAUPT').length === 1);

  await relay.broadcast('Tippfehler in der Sorte', { lane: 'gibtsnicht' });
  check('eine unbekannte Sorte sendet nicht ins Leere, sondern in den Hauptkanal',
    sentToDiscord[2]?.id === 'DC_HAUPT', sentToDiscord[2]?.id);

  check('die Startmeldung nennt beide Sorten',
    relay.announceOverview().length === 2
    && relay.announceOverview().join(' ').includes('Wirtschaft'),
    relay.announceOverview().join(' | '));
  check('und weiß, wohin das Wichtige geht',
    relay.announcesTo('wichtig').join('+') === 'Discord+Fluxer');

  // Ohne eigenen Wirtschaftskanal bleibt alles wie vorher: alles im Hauptkanal.
  {
    const geerbt = fresh({
      ANNOUNCE_DISCORD_CHANNEL: 'DC_HAUPT', ANNOUNCE_FLUXER_CHANNEL: 'FX_HAUPT',
      ECONOMY_DISCORD_CHANNEL: '', ECONOMY_FLUXER_CHANNEL: '',
    });
    check('ohne ECONOMY_* erbt die Wirtschaft den Hauptkanal',
      geerbt.LANES.wirtschaft.discord === 'DC_HAUPT'
      && geerbt.LANES.wirtschaft.fluxer === 'FX_HAUPT',
      JSON.stringify(geerbt.LANES.wirtschaft));
  }

  console.log('--- Klartext @Name pingt, wenn er eindeutig ist ---');
  {
    /*
     * Der Fall aus der Praxis: Ein reiner Discord-Nutzer hat keine Fluxer-ID,
     * also kann ihn von Fluxer aus niemand "richtig" erwähnen. Bleibt nur
     * `@Name` als Text – und der muss auf Discord zur echten Erwähnung werden
     * UND klingeln. Ohne @ davor passiert nichts.
     */
    const dbx = require('../src/db');
    const idn = require('../src/identity');
    // Eindeutiger Name je Lauf: `account_names` ist weltübergreifend, und der
    // Doppelgänger-Schritt weiter unten würde sonst den nächsten Lauf kippen.
    const NAME = `Bergmann${Date.now() % 100000}`;
    const NUR_DISCORD = '700000000000000001';
    const DOPPEL = '700000000000000002';
    dbx.setAccountName(NUR_DISCORD, NAME);
    dbx.setAccountName(DOPPEL, 'niemand-sonst');
    sentToDiscord.length = 0;

    await relay.fromFluxer(msg({ channelId: 'FX_KANAL', content: `hey @${NAME} bist du da?` }));
    const gesendet = sentToDiscord[sentToDiscord.length - 1];
    check('@Name wird zur echten Discord-Erwähnung',
      gesendet?.content.includes(`<@${NUR_DISCORD}>`), gesendet?.content);
    check('und genau dieser Nutzer darf gepingt werden',
      JSON.stringify(gesendet?.allowedMentions?.users) === JSON.stringify([NUR_DISCORD]),
      JSON.stringify(gesendet?.allowedMentions));
    check('parse bleibt leer – kein @everyone über die Hintertür',
      gesendet?.allowedMentions?.parse?.length === 0);

    sentToDiscord.length = 0;
    await relay.fromFluxer(msg({ channelId: 'FX_KANAL', content: `${NAME} war gestern gut` }));
    const ohne = sentToDiscord[sentToDiscord.length - 1];
    check('ohne @ wird nicht erwähnt und nicht gepingt',
      !ohne?.content.includes('<@') && (ohne?.allowedMentions?.users ?? []).length === 0,
      ohne?.content);

    sentToDiscord.length = 0;
    await relay.fromFluxer(msg({ channelId: 'FX_KANAL', content: '@everyone @here aufwachen' }));
    const alle = sentToDiscord[sentToDiscord.length - 1];
    check('@everyone und @here bleiben Text und pingen nie',
      (alle?.allowedMentions?.users ?? []).length === 0 && !alle?.content.includes('<@'),
      JSON.stringify(alle?.allowedMentions));

    // Zwei Konten mit demselben Namen: kein Treffer, kein Ping.
    dbx.setAccountName(DOPPEL, NAME);
    sentToDiscord.length = 0;
    await relay.fromFluxer(msg({ channelId: 'FX_KANAL', content: `@${NAME}?` }));
    const doppelt = sentToDiscord[sentToDiscord.length - 1];
    check('bei zwei gleichnamigen Konten wird niemand gepingt',
      (doppelt?.allowedMentions?.users ?? []).length === 0 && doppelt?.content.includes(`@${NAME}`),
      doppelt?.content);
    check('platformIdByName ist dabei eindeutig-oder-nichts',
      idn.platformIdByName(NAME, 'discord') === null);
    dbx.setAccountName(DOPPEL, 'niemand-sonst');   // aufräumen
  }

  await personaTests();
  await replyTests();

  console.log(`\n${pass} bestanden, ${fail} fehlgeschlagen`);
  process.exit(fail === 0 ? 0 : 1);
})();

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
      hookSends.push({ hook: id, ...payload, sentId: sent.id, wait: sent.wait });
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
  check('Fluxer-Webhook wurde mit wait=true gerufen (liefert die Nachricht)',
    s1?.hook === 'FXHOOK' && s1?.wait === true && s1?.sentId?.startsWith('MSG_'), JSON.stringify({ wait: s1?.wait }));
  check('Paar Discord -> Fluxer gespeichert',
    db.relayPairFor('discord', d1.id)?.fluxer_id === s1.sentId, JSON.stringify(db.relayPairFor('discord', d1.id)));

  const f1 = fxMsg();
  check('Fluxer-Nachricht wird gespiegelt', (await bridge.fromFluxer(f1)) === true);
  const s2 = hookSends[hookSends.length - 1];
  check('Paar Fluxer -> Discord gespeichert',
    db.relayPairFor('fluxer', f1.id)?.discord_id === s2.sentId, JSON.stringify(db.relayPairFor('fluxer', f1.id)));
  check('ohne Antwort kein replyTo und kein Zitat',
    s1.replyTo === undefined && !s1.content.includes('↩️') && s2.replyTo === undefined && !s2.content.includes('↩️'));

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
}

/**
 * Spiegeln als Persona (Webhooks): Name und Avatar des Absenders drüben.
 *
 * Eigenes Modul-Exemplar, weil `RELAY_WEBHOOKS` beim Laden gelesen wird.
 */
async function personaTests() {
  console.log('--- Erwähnungen über die Plattformgrenze ---');
  // Der Fehler aus der Praxis: Eine Fluxer-Erwähnung landete roh auf Discord,
  // das daraus "@unbekannter-Benutzer" machte.
  const db2 = require('../src/db');
  const konten = require('../src/accounts');
  const mentions = require('../src/fluxer/mentions');
  const DC = '498875863496916995';
  const FX = '1543693306263769088';
  const fxMessage = { mentions: [{ id: FX, username: 'Diabilon' }] };

  db2.deleteLink('fluxer', FX);
  db2.setAccountName(DC, 'Kevin');
  check('ohne Verknüpfung: lesbarer Name statt kaputter Erwähnung',
    mentions.toDiscord(`<@${FX}> civ?`, fxMessage) === '@Diabilon civ?',
    mentions.toDiscord(`<@${FX}> civ?`, fxMessage));
  check('keine rohe ID mehr im Text',
    !mentions.toDiscord(`<@${FX}> civ?`, fxMessage).includes(FX));

  await konten.link('fluxer', FX, DC);
  check('verknüpft: echte Discord-Erwähnung',
    mentions.toDiscord(`<@${FX}> civ?`, fxMessage) === `<@${DC}> civ?`,
    mentions.toDiscord(`<@${FX}> civ?`, fxMessage));
  check('Gegenrichtung: echte Fluxer-Erwähnung',
    mentions.toFluxer(`Hey <@${DC}>`, {}) === `Hey <@${FX}>`,
    mentions.toFluxer(`Hey <@${DC}>`, {}));
  konten.unlink('fluxer', FX);

  db2.setAccountName(DC, 'Diabilon');
  check('ohne Verknüpfung erkennt der Namensabgleich die Person',
    mentions.toDiscord(`<@${FX}>`, fxMessage) === `<@${DC}>`,
    mentions.toDiscord(`<@${FX}>`, fxMessage));
  db2.setAccountName(DC, 'Kevin');

  check('unbekannte Erwähnung wird nicht zur Zahl',
    mentions.toDiscord('<@777000111> hallo', {}) === '@jemand hallo',
    mentions.toDiscord('<@777000111> hallo', {}));
  check('Rollen und Kanäle bleiben lesbar',
    mentions.toFluxer('<@&123> in <#456>', {}) === '@Rolle in #kanal',
    mentions.toFluxer('<@&123> in <#456>', {}));
  check('Text ohne Erwähnung bleibt unverändert',
    mentions.toDiscord('nur Text', {}) === 'nur Text');

  console.log('--- Als Persona spiegeln (Webhooks) ---');

  const db = require('../src/db');
  // Zähler der Textform-Abschnitte zurücksetzen.
  sentToFluxer.length = 0;
  sentToDiscord.length = 0;
  db.deleteRelayWebhook('discord', 'DC_KANAL');
  db.deleteRelayWebhook('fluxer', 'FX_KANAL');

  delete require.cache[require.resolve('../src/relay')];
  process.env.RELAY_WEBHOOKS = 'true';
  const bridge = require('../src/relay');

  const hookSends = [];
  let created = 0;
  const makeHook = (id) => ({
    id, name: bridge.WEBHOOK_NAME, token: `tok-${id}`,
    async send(payload) { hookSends.push({ id, ...payload }); },
  });

  const dcChannel = {
    id: 'DC_KANAL',
    async fetchWebhooks() { return new Map(); },
    async createWebhook() { created++; return makeHook('DCHOOK'); },
    async send(p) { sentToDiscord.push({ id: 'DC_KANAL', ...p }); },
  };
  const fxChannel = {
    id: 'FX_KANAL', name: 'economy',
    async fetchWebhooks() { return []; },
    async createWebhook() { created++; return makeHook('FXHOOK'); },
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
      async send(id, p) { sentToFluxer.push({ id, ...p }); },
    },
  });

  const fromDc = {
    author: {
      id: 'USER1', displayName: 'Kevin',
      displayAvatarURL: () => 'https://cdn.discord/kevin.png',
    },
    content: 'Hallo von Discord',
    channelId: 'DC_KANAL',
    embeds: [], attachments: [],
  };

  check('Weiterleitung meldet Erfolg', (await bridge.fromDiscord(fromDc)) === true);
  check('ging über den Webhook, nicht als Bot-Text',
    hookSends.length === 1 && sentToFluxer.length === 0, JSON.stringify(hookSends[0]));
  check('Name des Absenders', hookSends[0]?.username === 'Kevin', hookSends[0]?.username);
  check('Avatar des Absenders',
    hookSends[0]?.avatarUrl === 'https://cdn.discord/kevin.png' &&
    hookSends[0]?.avatarURL === 'https://cdn.discord/kevin.png', hookSends[0]?.avatarUrl);
  check('kein "Name:"-Präfix mehr im Text',
    hookSends[0]?.content === 'Hallo von Discord', hookSends[0]?.content);
  const am2 = hookSends[0]?.allowedMentions;
  check('erwähnt niemanden',
    Array.isArray(am2?.parse) && am2.parse.length === 0 && (am2.users ?? []).length === 0,
    JSON.stringify(am2));

  console.log('--- Webhook wird wiederverwendet, nicht neu angelegt ---');
  await bridge.fromDiscord({ ...fromDc, content: 'Noch eine' });
  check('nur einmal angelegt', created === 1, String(created));
  check('zweite Nachricht kam an', hookSends.length === 2);
  check('Token wurde gemerkt',
    db.getRelayWebhook('fluxer', 'FX_KANAL')?.token === 'tok-FXHOOK',
    JSON.stringify(db.getRelayWebhook('fluxer', 'FX_KANAL')));

  console.log('--- SCHLEIFENSCHUTZ für Webhook-Nachrichten ---');
  // Die gespiegelte Nachricht trägt NICHT die Bot-ID, sondern die des
  // Webhooks. Ohne Sonderbehandlung würde sie sofort zurückgespiegelt.
  const mirrored = {
    author: { id: 'FXHOOK', displayName: 'Kevin' },
    webhookId: 'FXHOOK',
    content: 'Hallo von Discord',
    channelId: 'FX_KANAL',
    embeds: [], attachments: [],
  };
  const before = hookSends.length + sentToDiscord.length;
  check('eigene Webhook-Nachricht wird NICHT zurückgespiegelt',
    (await bridge.fromFluxer(mirrored)) === false);
  check('es wurde nichts gesendet', hookSends.length + sentToDiscord.length === before);

  console.log('--- Fluxer → Discord als Persona ---');
  const fromFx = {
    author: {
      id: 'FXUSER', globalName: 'Simon',
      displayAvatarURL: () => 'https://cdn.fluxer/simon.png',
    },
    content: 'Hallo von Fluxer',
    channelId: 'FX_KANAL',
    embeds: [], attachments: [],
  };
  check('wird gespiegelt', (await bridge.fromFluxer(fromFx)) === true);
  const toDiscord = hookSends[hookSends.length - 1];
  check('über den Discord-Webhook', toDiscord?.id === 'DCHOOK', toDiscord?.id);
  check('Name und Avatar übernommen',
    toDiscord?.username === 'Simon' && toDiscord?.avatarURL === 'https://cdn.fluxer/simon.png',
    JSON.stringify(toDiscord));

  console.log('--- Namen bleiben plattformtauglich ---');
  check('"discord" im Namen wird entschärft (Discord lehnt ihn sonst ab)',
    !/discord/i.test(bridge.displayName({ author: { displayName: 'Discord Admin' } })),
    bridge.displayName({ author: { displayName: 'Discord Admin' } }));
  check('höchstens 80 Zeichen',
    bridge.displayName({ author: { displayName: 'x'.repeat(200) } }).length === 80);
  check('"clyde" ebenso (auch das lehnt Discord ab)',
    !/clyde/i.test(bridge.displayName({ author: { displayName: 'Clyde' } })),
    bridge.displayName({ author: { displayName: 'Clyde' } }));
  check('@everyone verliert seinen Klammeraffen',
    bridge.displayName({ author: { displayName: '@everyone' } }) === 'everyone');
  check('ohne Namen ein Platzhalter',
    bridge.displayName({ author: {} }) === 'Jemand');
  check('Servername (member.displayName) hat Vorrang',
    bridge.displayName({ member: { displayName: 'Nick' }, author: { username: 'kevin' } }) === 'Nick');

  console.log('--- Discord-Gesicht als Standard auf beiden Plattformen ---');
  // Wer verknüpft ist, soll überall gleich aussehen: Name und Avatar kommen
  // dann vom DISCORD-Konto, egal auf welcher Plattform er geschrieben hat.
  const identity = require('../src/identity');
  const accounts = require('../src/accounts');
  bridge.faces.clear();

  const DISCORD_ID = '498875863496916995';
  accounts.unlink('fluxer', 'FXLINKED');
  await accounts.link('fluxer', 'FXLINKED', DISCORD_ID);
  check('Testkonto ist verknüpft',
    identity.account('fluxer', 'FXLINKED') === DISCORD_ID,
    identity.account('fluxer', 'FXLINKED'));

  // Discord-Client, der das Konto auflösen kann.
  bridge.register('discord', {
    user: { id: 'DISCORDBOT' },
    users: {
      async fetch(id) {
        if (id !== DISCORD_ID) throw new Error('unbekannt');
        return {
          id, displayName: 'KevinDC',
          displayAvatarURL: () => 'https://cdn.discord/kevin-echt.png',
        };
      },
    },
    channels: {
      cache: new Map([['DC_KANAL', dcChannel]]),
      async fetch(id) { return id === 'DC_KANAL' ? dcChannel : { id, async send() {} }; },
    },
  });

  const linked = await bridge.personaOf({
    author: { id: 'FXLINKED', displayName: 'kev_fluxer', displayAvatarURL: () => 'https://cdn.fluxer/k.png' },
  }, 'fluxer');
  check('Name kommt vom Discord-Konto', linked.username === 'KevinDC', linked.username);
  check('Avatar kommt vom Discord-Konto',
    linked.avatarURL === 'https://cdn.discord/kevin-echt.png', linked.avatarURL);

  const unlinked = await bridge.personaOf({
    author: { id: 'FXFREMD', displayName: 'Nurfluxer', displayAvatarURL: () => 'https://cdn.fluxer/n.png' },
  }, 'fluxer');
  check('ohne Verknüpfung bleibt das Fluxer-Aussehen',
    unlinked.username === 'Nurfluxer' && unlinked.avatarURL === 'https://cdn.fluxer/n.png',
    JSON.stringify(unlinked));

  const fromDiscordFace = await bridge.personaOf({
    member: { displayName: 'Spitzname' },
    author: { id: DISCORD_ID, displayName: 'KevinDC', displayAvatarURL: () => 'https://cdn.discord/kevin-echt.png' },
  }, 'discord');
  check('Discord-Nachrichten behalten ihren Servernamen',
    fromDiscordFace.username === 'Spitzname', fromDiscordFace.username);

  check('Gesicht wird gemerkt (kein Abruf je Nachricht)',
    bridge.faces.has(DISCORD_ID));

  // Ohne Discord-Client (Einzelbetrieb) darf nichts hängen bleiben.
  bridge.faces.clear();
  bridge.register('discord', { user: { id: 'DISCORDBOT' }, channels: { cache: new Map(), async fetch() { return { async send() {} }; } } });
  const noClient = await bridge.personaOf({
    author: { id: 'FXLINKED', displayName: 'kev_fluxer' },
  }, 'fluxer');
  check('ohne Discord-Client der Rückfall auf Fluxer',
    noClient.username === 'kev_fluxer', noClient.username);
  accounts.unlink('fluxer', 'FXLINKED');
  bridge.faces.clear();

  console.log('--- Avatar-Auflösung ---');
  check('Funktion, die null liefert -> kein Avatar (nicht die Funktion selbst!)',
    bridge.avatarOf({ author: { displayAvatarURL: () => null } }) === null);
  check('String-Feld wird genommen',
    bridge.avatarOf({ author: { avatarURL: 'https://x/y.png' } }) === 'https://x/y.png');
  check('kaputte Implementierung wirft nicht',
    bridge.avatarOf({ author: { displayAvatarURL() { throw new Error('nope'); } } }) === null);
  check('ohne Autor kein Avatar', bridge.avatarOf({}) === null);

  console.log('--- Notausgang: kein Recht für Webhooks ---');
  db.deleteRelayWebhook('fluxer', 'FX_KANAL');
  bridge.hooks.clear();
  fxChannel.createWebhook = async () => { throw new Error('Missing Permissions'); };
  sentToFluxer.length = 0;
  check('Nachricht geht trotzdem raus', (await bridge.fromDiscord(fromDc)) === true);
  check('und zwar in der alten Textform',
    sentToFluxer.length === 1 && /Kevin/.test(sentToFluxer[0].content), sentToFluxer[0]?.content);
  check('nichts über einen Webhook', hookSends.length === 3, String(hookSends.length));

  db.deleteRelayWebhook('discord', 'DC_KANAL');
  db.deleteRelayWebhook('fluxer', 'FX_KANAL');
}
