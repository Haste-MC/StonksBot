/**
 * Prüft, dass jeder registrierte Menüpunkt eine gültige Ansicht baut,
 * überall ein Weg zurück existiert und die Discord-Limits eingehalten werden.
 * Aufruf: npm run test:menu
 */
const { ENTRIES, buildMainMenu, buildEntryView } = require('../src/menu');

const G = process.env.DEV_GUILD_ID || '561491377502945288';
const U = '498875863496916995';
const LIMIT = { rows: 5, buttons: 5, label: 80, title: 256, description: 4096 };

let pass = 0, fail = 0;
const check = (label, cond, extra = '') => {
  if (cond) { pass++; console.log(`  ✅ ${label}`); }
  else { fail++; console.log(`  ❌ ${label} ${extra}`); }
};

/** Prüft eine Ansicht gegen alle harten Discord-Grenzen. */
function validate(name, view) {
  const rows = view.components.map((r) => r.toJSON());
  const buttons = rows.flatMap((r) => r.components);
  const embed = view.embeds[0].toJSON();
  const problems = [];

  if (rows.length > LIMIT.rows) problems.push(`${rows.length} Zeilen`);
  rows.forEach((r, i) => {
    if (r.components.length > LIMIT.buttons) problems.push(`Zeile ${i}: ${r.components.length} Buttons`);
  });
  for (const b of buttons) {
    if ((b.label || '').length > LIMIT.label) problems.push(`Label zu lang: ${b.label}`);
    if (!b.custom_id && !b.disabled) problems.push('Button ohne custom_id');
  }
  if ((embed.title || '').length > LIMIT.title) problems.push('Titel zu lang');
  if ((embed.description || '').length > LIMIT.description) problems.push('Beschreibung zu lang');

  check(`${name}: gültige Ansicht`, problems.length === 0, problems.join('; '));
  return { rows, buttons, embed };
}

(async () => {
  console.log('--- Hauptmenü ---');
  const main = buildMainMenu({ userId: U });
  const m = validate('Hauptmenü', main);
  check('ein Button pro Menüpunkt', m.buttons.length === ENTRIES.length,
    `${m.buttons.length} vs ${ENTRIES.length}`);
  check('jeder Menüpunkt wird beschrieben',
    ENTRIES.every((e) => m.embed.description.includes(e.label)));
  check('Button-IDs zeigen auf den jeweiligen Eintrag',
    ENTRIES.every((e) => m.buttons.some((b) => b.custom_id === `menu|${e.id}|1|${U}`)));

  console.log('\n--- Jeder Menüpunkt ---');
  for (const entry of ENTRIES) {
    const view = await buildEntryView(entry.id, { guildId: G, userId: U, page: 1 });
    const v = validate(`${entry.emoji} ${entry.label}`, view);
    check(`  ${entry.label}: Weg zurück ins Hauptmenü`,
      v.buttons.some((b) => b.custom_id === `home|${U}`));
  }

  console.log('\n--- Blättern über das Ende hinaus ---');
  for (const entry of ENTRIES) {
    const view = await buildEntryView(entry.id, { guildId: G, userId: U, page: 99 });
    validate(`${entry.label} Seite 99`, view);
  }
  const negative = await buildEntryView('new', { guildId: G, userId: U, page: -5 });
  validate('Neuwagen Seite -5', negative);

  console.log('\n--- Unbekannter Menüpunkt ---');
  const unknown = await buildEntryView('gibtesnicht', { guildId: G, userId: U, page: 1 });
  const u = validate('unbekannte ID', unknown);
  check('landet im Hauptmenü statt im Fehler', u.embed.title.includes('Hauptmenü'), u.embed.title);

  console.log('\n--- Admin-Sichtbarkeit ---');
  const asUser = buildMainMenu({ userId: U, isAdmin: false });
  const asAdmin = buildMainMenu({ userId: U, isAdmin: true });
  const adminOnly = ENTRIES.filter((e) => e.adminOnly).length;
  check('Admin sieht mindestens so viel wie ein Spieler',
    asAdmin.components.flatMap((r) => r.toJSON().components).length >=
    asUser.components.flatMap((r) => r.toJSON().components).length);
  check(`Admin-Menüpunkte werden gefiltert (aktuell ${adminOnly})`,
    asAdmin.components.flatMap((r) => r.toJSON().components).length -
    asUser.components.flatMap((r) => r.toJSON().components).length === adminOnly);

  console.log(`\n${pass} bestanden, ${fail} fehlgeschlagen`);
  process.exit(fail === 0 ? 0 : 1);
})();
