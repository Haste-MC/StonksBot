/**
 * Tests für Markenfilter und Markenauswahl.
 * Aufruf: npm run test:brands
 */
const db = require('../src/db');
const { buildNewShopView, buildBrandsView } = require('../src/ui');

const G = 'TESTGUILD3';
const U = 'TESTUSER';
let pass = 0, fail = 0;

const check = (label, cond, extra = '') => {
  if (cond) { pass++; console.log(`  ✅ ${label}`); }
  else { fail++; console.log(`  ❌ ${label} ${extra}`); }
};
const cleanup = () => {
  for (;;) {
    const { items } = db.listItems(G, 1);
    if (!items.length) break;
    for (const i of items) db.deleteItem(G, i.id);
  }
};

cleanup();

// Zwei Marken mit unterschiedlich vielen Autos, plus eines ohne Marke.
const make = (name, brand, price) =>
  db.createItem({ guildId: G, name, brand, price, stock: null, createdBy: 'test' });

make('Audi Eins', 'Audi', 1000);
make('Audi Zwei', 'Audi', 3000);
make('Audi Drei', 'Audi', 2000);
make('BMW Eins', 'BMW', 5000);
make('Ohne Marke', '', 500);

console.log('--- Filtern nach Marke ---');
const audi = db.listItems(G, 1, 'Audi');
check('Audi liefert 3 Autos', audi.total === 3, String(audi.total));
check('nur Audi enthalten', audi.items.every((i) => i.brand === 'Audi'));
check('nach Preis sortiert', audi.items.map((i) => i.price).join() === '1000,2000,3000',
  audi.items.map((i) => i.price).join());

const bmw = db.listItems(G, 1, 'BMW');
check('BMW liefert 1 Auto', bmw.total === 1, String(bmw.total));

check('ohne Filter alle 5', db.listItems(G, 1).total === 5, String(db.listItems(G, 1).total));
check('unbekannte Marke -> leer', db.listItems(G, 1, 'Trabant').total === 0);

console.log('--- Markenübersicht ---');
const brands = db.listBrands(G);
check('2 Marken (leere ignoriert)', brands.length === 2, JSON.stringify(brands.map((b) => b.brand)));
const a = brands.find((b) => b.brand === 'Audi');
check('Audi-Anzahl stimmt', a.n === 3, String(a.n));
check('Audi Preisspanne stimmt', a.min_price === 1000 && a.max_price === 3000,
  `${a.min_price}-${a.max_price}`);
check('alphabetisch sortiert', brands.map((b) => b.brand).join() === 'Audi,BMW');

console.log('--- Ansicht mit Filter ---');
(async () => {
  const view = await buildNewShopView({ guildId: G, userId: U, page: 1, brand: 'Audi' });
  const embed = view.embeds[0].toJSON();
  const rows = view.components.map((r) => r.toJSON());
  const btns = rows.flatMap((r) => r.components);

  check('Titel nennt die Marke', embed.title.includes('Audi'), embed.title);
  check('nur Audi-Autos gelistet',
    ['Audi Eins', 'Audi Zwei', 'Audi Drei'].every((n) => embed.description.includes(n)) &&
    !embed.description.includes('BMW Eins'));
  check('Blättern behält die Marke',
    btns.some((b) => (b.custom_id || '').startsWith(`menu|new|2|Audi|`)),
    btns.map((b) => b.custom_id).join(' '));
  check('Weg zurück zu allen Marken',
    btns.some((b) => b.custom_id === `menu|new|1|${U}`));
  check('Weg zur Markenauswahl',
    btns.some((b) => b.custom_id === `menu|brands|1|${U}`));
  check('höchstens 5 Zeilen', rows.length <= 5, String(rows.length));

  const empty = await buildNewShopView({ guildId: G, userId: U, page: 1, brand: 'Trabant' });
  check('leere Marke bricht nicht', empty.embeds[0].toJSON().description.length > 0);

  console.log('--- Markenauswahl-Ansicht ---');
  const bv = await buildBrandsView({ guildId: G, userId: U, page: 1 });
  const bbtns = bv.components.flatMap((r) => r.toJSON().components);
  check('ein Button pro Marke',
    brands.every((b) => bbtns.some((x) => x.custom_id === `menu|new|1|${b.brand}|${U}`)),
    bbtns.map((b) => b.custom_id).join(' '));
  check('Anzahl steht im Button', bbtns.some((b) => (b.label || '').includes('Audi (3)')));
  check('Hauptmenü erreichbar', bbtns.some((b) => b.custom_id === `home|${U}`));
  check('höchstens 5 Zeilen', bv.components.length <= 5, String(bv.components.length));

  cleanup();
  console.log(`\n${pass} bestanden, ${fail} fehlgeschlagen`);
  process.exit(fail === 0 ? 0 : 1);
})();
