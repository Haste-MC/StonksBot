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
  check('Herkunft ist erkennbar', /Discord/.test(sentToFluxer[0].content));

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

  console.log(`\n${pass} bestanden, ${fail} fehlgeschlagen`);
  process.exit(fail === 0 ? 0 : 1);
})();
