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

const relay = require('../src/relay');

let pass = 0, fail = 0;
const check = (label, ok, extra = '') => {
  if (ok) { pass++; console.log(`  ✅ ${label}`); }
  else { fail++; console.log(`  ❌ ${label} ${extra}`); }
};

// Zwei gefälschte Clients, die mitschreiben, was gesendet wurde.
const sentToFluxer = [];
const sentToDiscord = [];
const discordClient = {
  user: { id: 'DISCORDBOT' },
  channels: {
    async fetch() { return { async send(p) { sentToDiscord.push(p); } }; },
  },
};
const fluxerClient = {
  user: { id: 'FLUXERBOT' },
  channels: { async send(id, p) { sentToFluxer.push({ id, ...p }); } },
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

  console.log(`\n${pass} bestanden, ${fail} fehlgeschlagen`);
  process.exit(fail === 0 ? 0 : 1);
})();
