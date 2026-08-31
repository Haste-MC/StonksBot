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
// Dieser Teil prüft die Textform (Notausgang). Die Persona-Spiegelung über
// Webhooks hat unten einen eigenen Abschnitt mit eigenem Modul-Zustand.
process.env.RELAY_WEBHOOKS = 'false';

const relay = require('../src/relay');

let pass = 0, fail = 0;
const check = (label, ok, extra = '') => {
  if (ok) { pass++; console.log(`  ✅ ${label}`); }
  else { fail++; console.log(`  ❌ ${label} ${extra}`); }
};

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
  check('erwähnt niemanden (kein Ping-Spam)',
    JSON.stringify(sentToDiscord[0].allowedMentions) === '{"parse":[]}');

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

  await personaTests();

  console.log(`\n${pass} bestanden, ${fail} fehlgeschlagen`);
  process.exit(fail === 0 ? 0 : 1);
})();

/**
 * Spiegeln als Persona (Webhooks): Name und Avatar des Absenders drüben.
 *
 * Eigenes Modul-Exemplar, weil `RELAY_WEBHOOKS` beim Laden gelesen wird.
 */
async function personaTests() {
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
  check('erwähnt niemanden',
    JSON.stringify(hookSends[0]?.allowedMentions) === '{\"parse\":[]}');

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
  check('@everyone verliert seinen Klammeraffen',
    bridge.displayName({ author: { displayName: '@everyone' } }) === 'everyone');
  check('ohne Namen ein Platzhalter',
    bridge.displayName({ author: {} }) === 'Jemand');
  check('Servername (member.displayName) hat Vorrang',
    bridge.displayName({ member: { displayName: 'Nick' }, author: { username: 'kevin' } }) === 'Nick');

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
