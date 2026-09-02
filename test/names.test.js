/**
 * Tests für Anzeigenamen: Nirgends darf eine rohe Konto-ID stehen.
 *
 * Schwerpunkt: nicht verknüpfte Fluxer-Spieler (`fx:…`). Deren Konto ist auf
 * KEINER Plattform eine Erwähnung – vorher stand in der Rangliste deshalb
 * `<@fx:12345>`. Dazu das Nachtragen fehlender Namen beim Start.
 *
 * Aufruf: node test/names.test.js
 */
const db = require('../src/db');
const identity = require('../src/identity');
const names = require('../src/names');
const toplist = require('../src/toplist');

let pass = 0, fail = 0;
const check = (label, ok, extra = '') => {
  if (ok) { pass++; console.log(`  ✅ ${label}`); }
  else { fail++; console.log(`  ❌ ${label} ${extra}`); }
};

const DISCORD = '498875863496916995';
const FLUXER = 'fx:1543693306263769088';

(async () => {
  console.log('--- Anzeige eines Kontos ---');
  db.setAccountName(DISCORD, 'Kevin');
  check('Discord-Konto bleibt eine echte Erwähnung',
    identity.mention(DISCORD) === `<@${DISCORD}>`, identity.mention(DISCORD));

  db.setAccountName(FLUXER, 'Simon');
  check('Fluxer-Konto erscheint mit Namen',
    identity.mention(FLUXER) === '**Simon**', identity.mention(FLUXER));
  check('display() liefert den blanken Namen', identity.display(FLUXER) === 'Simon');

  console.log('--- Unbekannte werden trotzdem nicht zur ID ---');
  const UNBEKANNT = 'fx:9998887776665544';
  db.setAccountName(UNBEKANNT, '');
  check('keine rohe ID in der Ausgabe',
    !identity.mention(UNBEKANNT).includes(UNBEKANNT), identity.mention(UNBEKANNT));
  check('aber unterscheidbar (letzte Stellen)',
    identity.mention(UNBEKANNT).includes('5544'), identity.mention(UNBEKANNT));
  check('zwei Unbekannte sehen verschieden aus',
    identity.mention('fx:1111') !== identity.mention('fx:2222'));

  console.log('--- Rangliste zeigt keine IDs ---');
  check('Fluxer-Spieler mit Namen', toplist.label(FLUXER) === '**Simon**', toplist.label(FLUXER));
  check('Fluxer-Spieler ohne Namen',
    !toplist.label(UNBEKANNT).includes('fx:'), toplist.label(UNBEKANNT));
  check('Discord-Spieler mit gemerktem Namen wird lesbar',
    toplist.label(DISCORD) === '**Kevin**', toplist.label(DISCORD));

  console.log('--- Namen nachtragen (ohne privilegiertes Intent) ---');
  const world = identity.world();
  const NEU = 'fx:5554443332221100';
  db.setAccountName(NEU, '');
  db.addStats(world, NEU, { xp: 1 });
  check('steht auf der Nachtragsliste', names.unnamed(world).includes(NEU),
    names.unnamed(world).slice(0, 3).join());

  const asked = [];
  const clients = {
    discord: { users: { async fetch(id) { asked.push(['discord', id]); throw new Error('nicht hier'); } } },
    fluxer: { users: { async fetch(id) { asked.push(['fluxer', id]); return { id, displayName: 'Neuer' }; } } },
  };
  const result = await names.warm(clients, { world });
  check('Name wurde geholt', identity.nameOf(NEU) === 'Neuer', String(identity.nameOf(NEU)));
  check('ohne Präfix bei der Plattform angefragt',
    asked.some(([p, id]) => p === 'fluxer' && id === '5554443332221100'),
    JSON.stringify(asked.slice(0, 3)));
  check('Ergebnis wird gemeldet', result.learned >= 1, JSON.stringify(result));

  check('zweiter Lauf hat nichts mehr zu tun',
    !names.unnamed(world).includes(NEU));

  console.log('--- Ausfälle sind harmlos ---');
  const ohne = await names.warm({}, { world });
  check('ohne Clients kein Absturz', ohne.learned === 0, JSON.stringify(ohne));
  const kaputt = await names.warm({
    discord: { users: { async fetch() { throw new Error('API weg'); } } },
    fluxer: { users: { async fetch() { throw new Error('API weg'); } } },
  }, { world });
  check('API-Fehler werden geschluckt', kaputt.learned === 0, JSON.stringify(kaputt));

  console.log(`\n${pass} bestanden, ${fail} fehlgeschlagen`);
  process.exit(fail === 0 ? 0 : 1);
})();
