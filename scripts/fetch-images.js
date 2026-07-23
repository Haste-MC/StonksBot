/**
 * Sucht für jedes Auto im Katalog ein frei lizenziertes Foto auf Wikimedia
 * Commons und schreibt das Ergebnis nach src/data/images.json.
 *
 * Aufruf: node scripts/fetch-images.js
 *
 * Nur eindeutig freie Lizenzen werden akzeptiert, und der Dateiname muss eines
 * der `must`-Wörter enthalten – sonst landet leicht ein völlig anderes Auto im
 * Katalog. Jedes Ergebnis wird zusätzlich per HTTP geprüft.
 */
const fs = require('node:fs');
const path = require('node:path');
const catalog = require('../src/data/catalog');
const { mentionsBrand } = require('../src/data/brands');

/**
 * Motive, die kein brauchbares Fahrzeugfoto sind. Wortgrenzen sind hier
 * Pflicht – ohne sie matcht "toy" auf "Toyota" und "motor" auf "Motorsport".
 */
const BAD_SUBJECT =
  /\b(interior|innenraum|engine|cockpit|dashboard|wheel|felge|badge|logo|emblem|taillight|headlight|rücklicht|scheinwerfer|chassis|replica|toy|lego|miniature)\b|\bmodel car\b|\bmodellauto\b|\bscale model\b/i;

const OUT = path.join(__dirname, '..', 'src', 'data', 'images.json');
const UA = 'DiscordCarShopBot/1.0 (hobby Discord bot; contact via GitHub)';
const FREE = /^(cc[ -]|public domain|pd|no restrictions|gfdl)/i;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const clean = (s) => (s || '').replace(/<[^>]+>/g, '').trim();

async function api(params, attempt = 0) {
  const url = 'https://commons.wikimedia.org/w/api.php?' + new URLSearchParams(params);
  const res = await fetch(url, { headers: { 'User-Agent': UA } });
  const text = await res.text();
  if (!text.startsWith('{')) {
    // Wikimedia drosselt – warten und erneut versuchen.
    if (attempt < 5) { await sleep(10000 * (attempt + 1)); return api(params, attempt + 1); }
    throw new Error('rate limited');
  }
  return JSON.parse(text);
}

async function findImage(car) {
  const data = await api({
    action: 'query', generator: 'search',
    gsrsearch: `filetype:bitmap ${car.search}`,
    gsrnamespace: '6', gsrlimit: '20',
    prop: 'imageinfo', iiprop: 'url|extmetadata|size',
    iiurlwidth: '960', format: 'json',
  });

  const pages = Object.values(data?.query?.pages || {});
  const candidates = [];

  for (const p of pages) {
    const info = p.imageinfo?.[0];
    if (!info) continue;

    const meta = info.extmetadata || {};
    const license = clean(meta.LicenseShortName?.value);
    if (!FREE.test(license)) continue;
    if ((info.width || 0) < 800) continue;

    // Der Dateiname muss zum Modell passen – mit Wortgrenzen, sonst matcht
    // z.B. "GLA 45" auf das Suchwort "A 45".
    const title = p.title.toLowerCase();
    const hasModel = car.must.some((m) => {
      const escaped = m.toLowerCase().replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      return new RegExp(`(^|[^a-z0-9])${escaped}([^a-z0-9]|$)`, 'i').test(title);
    });
    if (!hasModel) continue;

    // Die Marke muss vorkommen (Kurzformen wie "VW" zählen mit).
    if (!mentionsBrand(title, car.brand)) continue;

    // Ausdrücklich ausgeschlossene Begriffe (z.B. "GLA" beim A 45).
    if (car.not?.some((n) => title.includes(n.toLowerCase()))) continue;

    // Innenraum-, Detail- und Modellauto-Aufnahmen aussortieren.
    if (BAD_SUBJECT.test(title)) continue;

    candidates.push({
      title: p.title,
      license,
      artist: clean(meta.Artist?.value).slice(0, 60) || 'unbekannt',
      url: info.thumburl || info.url,
      width: info.width,
    });
  }

  return candidates[0] || null;
}

async function verify(url) {
  try {
    const res = await fetch(url, { method: 'HEAD', headers: { 'User-Agent': UA } });
    return res.ok && (res.headers.get('content-type') || '').startsWith('image/');
  } catch {
    return false;
  }
}

(async () => {
  // --only "Name A" "Name B"  -> nur diese Autos neu holen, Rest behalten
  const onlyIndex = process.argv.indexOf('--only');
  const only = onlyIndex === -1 ? null : process.argv.slice(onlyIndex + 1);

  let results = {};
  if (only) {
    try { results = { ...require(OUT) }; } catch { /* noch keine Datei */ }
    console.log(`Hole ${only.length} Autos neu, bestehende bleiben erhalten.\n`);
  }

  const todo = only ? catalog.filter((c) => only.includes(c.name)) : catalog;
  if (only && todo.length !== only.length) {
    const unknown = only.filter((n) => !catalog.some((c) => c.name === n));
    console.error(`Unbekannte Autos: ${unknown.join(', ')}`);
    process.exit(1);
  }

  const missing = [];

  for (const car of todo) {
    await sleep(1200); // Wikimedia gegenüber fair bleiben
    try {
      const hit = await findImage(car);
      if (!hit) { missing.push(car.name); console.log(`❌ ${car.name} — kein passendes Bild`); continue; }
      if (!await verify(hit.url)) {
        missing.push(car.name); console.log(`❌ ${car.name} — URL nicht erreichbar`); continue;
      }
      results[car.name] = {
        url: hit.url,
        attribution: `Foto: ${hit.artist}, Wikimedia Commons, ${hit.license}`,
      };
      console.log(`✅ ${car.name}\n   ${hit.license} · ${hit.title}`);
    } catch (err) {
      missing.push(car.name);
      console.log(`❌ ${car.name} — ${err.message}`);
    }
  }

  fs.writeFileSync(OUT, JSON.stringify(results, null, 2));
  console.log(`\n${Object.keys(results).length}/${catalog.length} Bilder insgesamt.`);
  if (missing.length) console.log(`Ohne Bild: ${missing.join(', ')}`);
})();
