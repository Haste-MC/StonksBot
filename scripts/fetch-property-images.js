/**
 * Sucht frei lizenzierte Gebäudefotos für den Immobilienkatalog.
 *
 * Aufruf: node scripts/fetch-property-images.js [--only "Name" ...]
 *
 * Anders als bei Autos gibt es hier kein eindeutiges Modell, das im Dateinamen
 * stehen muss – gesucht wird nach Gebäudetyp. Entsprechend lockerer ist die
 * Prüfung: es reicht, wenn eines der `must`-Wörter vorkommt.
 */
const fs = require('node:fs');
const path = require('node:path');
const catalog = require('../src/data/properties');

const OUT = path.join(__dirname, '..', 'src', 'data', 'property-images.json');
const UA = 'DiscordCarShopBot/1.0 (hobby Discord bot; contact via GitHub)';
const FREE = /^(cc[ -]|public domain|pd|no restrictions|gfdl)/i;

/**
 * Motive, die kein brauchbares Gebäudefoto sind.
 *
 * Neben Innenräumen und Plänen fliegen hier vor allem Gemälde und alte
 * Darstellungen raus: Commons ist voll mit digitalisierter Kunst, und eine
 * Suche nach "manor house" liefert sonst schnell einen van Gogh statt eines
 * Fotos. Eine Jahreszahl vor 1930 im Dateinamen ist dafür ein guter Indikator.
 */
const BAD_SUBJECT = new RegExp([
  '\\b(interior|innenraum|floor plan|grundriss|map|karte|diagram|logo)\\b',
  '\\b(coat of arms|wappen|sign|schild|plaque|toy|lego|miniature|model)\\b',
  '\\b(painting|gemälde|drawing|zeichnung|engraving|etching|lithograph)\\b',
  '\\b(watercolo\\w*|sketch|postcard|postkarte|stamp|briefmarke|illustration)\\b',
  '\\b(ruins?|ruine|abandoned|derelict|demolition|abriss|fire|brand)\\b',
  '\\b(1[0-9]{3}|19[0-2][0-9])\\b',   // alte Jahreszahl -> historische Darstellung
  '\\b(habs|haer|perspective view|elevation|archival|survey)\\b', // Bauaufnahmen
].join('|'), 'i');

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const clean = (s) => (s || '').replace(/<[^>]+>/g, '').trim();

async function api(params, attempt = 0) {
  const url = 'https://commons.wikimedia.org/w/api.php?' + new URLSearchParams(params);
  const res = await fetch(url, { headers: { 'User-Agent': UA } });
  const text = await res.text();
  if (!text.startsWith('{')) {
    if (attempt < 5) { await sleep(10000 * (attempt + 1)); return api(params, attempt + 1); }
    throw new Error('rate limited');
  }
  return JSON.parse(text);
}

async function findImage(entry) {
  const data = await api({
    action: 'query', generator: 'search',
    gsrsearch: `filetype:bitmap ${entry.search}`,
    gsrnamespace: '6', gsrlimit: '25',
    prop: 'imageinfo', iiprop: 'url|extmetadata|size',
    iiurlwidth: '960', format: 'json',
  });

  for (const p of Object.values(data?.query?.pages || {})) {
    const info = p.imageinfo?.[0];
    if (!info) continue;

    const meta = info.extmetadata || {};
    const license = clean(meta.LicenseShortName?.value);
    if (!FREE.test(license)) continue;
    if ((info.width || 0) < 800) continue;

    const title = p.title.toLowerCase();
    if (BAD_SUBJECT.test(title)) continue;

    const hasType = entry.must.some((m) => {
      const escaped = m.toLowerCase().replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      return new RegExp(`(^|[^a-z0-9])${escaped}`, 'i').test(title);
    });
    if (!hasType) continue;

    return {
      title: p.title,
      license,
      artist: clean(meta.Artist?.value).slice(0, 60) || 'unbekannt',
      url: info.thumburl || info.url,
    };
  }
  return null;
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
  const onlyIndex = process.argv.indexOf('--only');
  const only = onlyIndex === -1 ? null : process.argv.slice(onlyIndex + 1);

  let results = {};
  if (only) {
    try { results = { ...require(OUT) }; } catch { /* noch keine Datei */ }
  }

  const todo = only ? catalog.filter((c) => only.includes(c.name)) : catalog;
  const missing = [];

  for (const entry of todo) {
    await sleep(1200);
    try {
      const hit = await findImage(entry);
      if (!hit || !await verify(hit.url)) {
        missing.push(entry.name);
        console.log(`❌ ${entry.name}`);
        continue;
      }
      results[entry.name] = {
        url: hit.url,
        attribution: `Foto: ${hit.artist}, Wikimedia Commons, ${hit.license}`,
      };
      console.log(`✅ ${entry.name}\n   ${hit.license} · ${hit.title}`);
    } catch (err) {
      missing.push(entry.name);
      console.log(`❌ ${entry.name} — ${err.message}`);
    }
  }

  fs.writeFileSync(OUT, JSON.stringify(results, null, 2));
  console.log(`\n${Object.keys(results).length}/${catalog.length} Bilder insgesamt.`);
  if (missing.length) console.log(`Ohne Bild: ${missing.join(', ')}`);
})();
