// test/contacts.test.js
/**
 * Kontakte 5a: Katalog, Passung, Antwortchance, Stufen, Stärke, Schübe.
 * Aufruf: DATA_DIR=.testdata node test/contacts.test.js
 */
const data = require('../src/data/contacts');
const contacts = require('../src/contacts');
const world = require('../src/data/world');
const musicData = require('../src/data/music');
const creatorData = require('../src/data/creator');

let pass = 0, fail = 0;
const check = (label, ok, extra = '') => {
  if (ok) { pass++; console.log(`  ✅ ${label}`); }
  else { fail++; console.log(`  ❌ ${label} ${extra}`); }
};
const near = (a, b, eps = 1e-9) => Math.abs(a - b) < eps;

(async () => {
  console.log('--- Katalog: Abdeckung ---');
  {
    const musik = data.CONTACTS.filter((c) => c.kind === 'musik' || c.kind === 'beides');
    const creator = data.CONTACTS.filter((c) => c.kind === 'creator' || c.kind === 'beides');
    check('IDs eindeutig', new Set(data.CONTACTS.map((c) => c.id)).size === data.CONTACTS.length);
    check('jeder Eintrag vollständig', data.CONTACTS.every((c) =>
      c.id && c.name && c.emoji && c.blurb && data.TRAIT_BONUS[c.trait] !== undefined
      && world.COUNTRIES.some((x) => x.id === c.country) && world.LANGUAGES.some((x) => x.id === c.language)));
    check('Musik-Einträge haben Genre und Reichweite', musik.every((c) => musicData.GENRES.some((g) => g.id === c.genre) && c.reach > 0));
    check('Creator-Einträge haben Plattform und Reichweite', creator.every((c) => creatorData.PLATFORMS.some((p) => p.id === c.platform) && c.reachCreator > 0));

    for (const land of world.COUNTRIES) {
      check(`Land ${land.id}: mindestens ein Kontakt`, data.CONTACTS.some((c) => c.country === land.id));
    }
    for (const sprache of world.LANGUAGES) {
      const m = musik.filter((c) => c.language === sprache.id);
      check(`Sprache ${sprache.id}: ≥ 3 Musiker, einer < 100k, einer > 1 Mio`,
        m.length >= 3 && m.some((c) => c.reach < 100_000) && m.some((c) => c.reach > 1_000_000),
        `${m.length} Einträge`);
    }
    for (const g of musicData.GENRES) {
      const m = musik.filter((c) => c.genre === g.id);
      check(`Genre ${g.id}: ≥ 4 Kontakte in ≥ 3 Sprachen, ≥ 1 Weltstar`,
        m.length >= 4 && new Set(m.map((c) => c.language)).size >= 3 && m.some((c) => c.reach >= 100_000_000),
        `${m.length} Einträge, ${new Set(m.map((c) => c.language)).size} Sprachen`);
    }
    // Das Mittelfeld: In jedem Genre muss es Kontakte in der eigenen Liga
    // geben, sonst stehen dem Spieler nur Zwerge und Weltstars gegenüber – und
    // Antwortchance (5a) wie Beef (5b) hängen am Größenverhältnis.
    for (const g of musicData.GENRES) {
      const reichweiten = musik.filter((c) => c.genre === g.id).map((c) => c.reach).sort((a, b) => a - b);
      const baender = [[40_000, 200_000], [200_000, 1_000_000], [1_000_000, 5_000_000]];
      const mitte = reichweiten.filter((r) => r >= 40_000 && r < 5_000_000);
      check(`Genre ${g.id}: Mittelfeld besetzt (40k–200k, 200k–1 Mio, 1–5 Mio), keine Lücke über Faktor 10`,
        baender.every(([lo, hi]) => reichweiten.some((r) => r >= lo && r < hi))
        && mitte.every((r, i) => i === 0 || r / mitte[i - 1] <= 10),
        mitte.join(' · '));
    }
    for (const p of creatorData.PLATFORMS) {
      const cs = creator.filter((c) => c.platform === p.id);
      check(`Plattform ${p.id}: ≥ 3 Kontakte, ≥ 1 über 10 Mio`,
        cs.length >= 3 && cs.some((c) => c.reachCreator > 10_000_000), `${cs.length} Einträge`);
    }
    check('Doppelrollen haben beide Seiten', data.CONTACTS.filter((c) => c.kind === 'beides')
      .every((c) => c.genre && c.reach > 0 && c.platform && c.reachCreator > 0));
    check('vier Anfragearten mit 2 h', data.REQUESTS.length === 4 && data.REQUESTS.every((r) => r.time === 2));
    check('Konzert braucht Vertrauen 20 (kein Draht-Tor mehr)',
      data.REQUESTS.find((r) => r.id === 'konzert').minVertrauen === 20
      && data.REQUESTS.find((r) => r.id === 'konzert').minDraht === null);
    check('Texte für jeden Charakter und jede Stufe', Object.keys(data.TRAIT_BONUS).every((t) =>
      ['fluechtig', 'echt', 'zusage', 'nein'].every((s) => Array.isArray(data.LINES[t]?.[s]) && data.LINES[t][s].length >= 3)));
  }

  console.log('--- Passung ---');
  {
    const p1 = contacts.passungOf({ meine: { language: 'deutsch', genre: 'hiphop' }, seine: { language: 'deutsch', genre: 'hiphop' } });
    check('gleiche Sprache, gleiches Genre: 1,0', near(p1.passung, 1));
    const p2 = contacts.passungOf({ meine: { language: 'japanisch', genre: 'jpop' }, seine: { language: 'deutsch', genre: 'hiphop' } });
    check('J-Pop-Act und deutscher Rapper: 0,045', near(p2.passung, 0.15 * 0.3), String(p2.passung));
    const p3 = contacts.passungOf({ meine: { language: 'japanisch', genre: 'jpop' }, seine: { language: 'englisch', genre: 'pop' } });
    check('Englisch als Brücke, verwandtes Genre: 0,42', near(p3.passung, 0.6 * 0.7));
    const p4 = contacts.passungOf({ meine: { language: 'deutsch', genre: 'rock' }, seine: { language: 'deutsch', genre: 'metal' } });
    check('verwandt: 0,7', near(p4.passung, 0.7));
    const p5 = contacts.passungOf({ meine: { language: 'deutsch', platform: 'twitch' }, seine: { language: 'deutsch', platform: 'youtube' }, seite: 'creator' });
    check('Creator, andere Plattform: 0,6', near(p5.passung, 0.6));
  }

  console.log('--- Antwortchance ---');
  {
    const basis = (r) => Math.min(0.95, 0.6 * Math.sqrt(r));
    const arg = (over) => ({
      meineReichweite: 1_000, seineReichweite: 1_000, request: 'shoutout',
      gleichesLand: false, sprache: 'gleich', genre: 'gleich', respekt: 0, vertrauen: 0,
      tuerOeffner: 0, hype: 1, trait: 'launisch', partner: false, ...over });
    // 1:1, alles neutral außer gleicher Sprache/Genre: 0,6 + 0,10 + 0,05 = 0,75
    check('1:1, gleiche Sprache und Genre: 0,75', near(contacts.chanceOf(arg()), 0.75), String(contacts.chanceOf(arg())));
    check('1:10 → Basis 0,190', near(basis(0.1), 0.6 * Math.sqrt(0.1)));
    check('1:100 fremde Sprache, fremdes Genre, arrogant: Untergrenze 0,02',
      near(contacts.chanceOf(arg({ seineReichweite: 100_000, sprache: 'fremd', genre: 'fremd', trait: 'arrogant' })), 0.02),
      String(contacts.chanceOf(arg({ seineReichweite: 100_000, sprache: 'fremd', genre: 'fremd', trait: 'arrogant' }))));
    // 1:1000 = Basis 0,019 + Sprache 0,10 + Genre 0,05 = 0,169
    check('1:1000, gleiche Sprache und Genre: 0,169',
      near(contacts.chanceOf(arg({ seineReichweite: 1_000_000 })), 0.6 * Math.sqrt(0.001) + 0.15),
      String(contacts.chanceOf(arg({ seineReichweite: 1_000_000 }))));
    // Die Umverteilung: Auf Augenhöhe wiegt die Beziehung weniger als früher.
    // Als Formel statt als Literal, damit die Zusicherung nicht einfriert.
    check('Respekt 50 hebt um 0,06',
      near(contacts.chanceOf(arg({ respekt: 50, vertrauen: 50 })) - contacts.chanceOf(arg()),
        0.5 * contacts.respektGewicht(1_000, 1_000)),
      String(contacts.chanceOf(arg({ respekt: 50, vertrauen: 50 })) - contacts.chanceOf(arg())));
    check('Vertrauen −100 senkt um 0,25',
      near(contacts.chanceOf(arg()) - contacts.chanceOf(arg({ respekt: -100, vertrauen: -100 })), 0.25),
      String(contacts.chanceOf(arg()) - contacts.chanceOf(arg({ respekt: -100, vertrauen: -100 }))));
    check('Partner gibt +0,10', near(contacts.chanceOf(arg({ partner: true })) - contacts.chanceOf(arg()), 0.10));
    check('Reaktion ist leichter als Konzert um 0,35',
      near(contacts.chanceOf(arg({ request: 'reaktion' })) - contacts.chanceOf(arg({ request: 'konzert' })), 0.35));
    check('Obergrenze 0,95',
      contacts.chanceOf(arg({ seineReichweite: 10, respekt: 100, vertrauen: 100, trait: 'kollegial' })) === 0.95);
    check('frischer Account: Boden 100 statt Division durch null',
      Number.isFinite(contacts.chanceOf(arg({ meineReichweite: 0, seineReichweite: 1_000_000 }))));
  }

  console.log('--- Stufe und Stärke ---');
  {
    // Gewichte: fluechtig 6, echt 3, zusage 1 × (1 + 2×min(1,ratio)) × (1 + respekt/100)
    const zaehle = (ratio, respekt, n = 20_000) => {
      let i = 0; const rng = () => ((i = (i * 1103515245 + 12345) % 2147483648) / 2147483648);
      const out = { fluechtig: 0, echt: 0, zusage: 0 };
      for (let k = 0; k < n; k++) out[contacts.stufeVon(rng, { ratio, respekt })]++;
      return out;
    };
    const gross = zaehle(1, 50);   // ratio 1 → naehe 1
    const erwartetZusage = 1 * (1 + 2) * (1 + 0.5);      // 4,5
    const summe = 6 + 3 + erwartetZusage;                 // 13,5 → Anteil 0,333
    check('auf Augenhöhe mit Respekt 50: Zusagen ≈ 33 % der Fälle',
      Math.abs(gross.zusage / 20_000 - erwartetZusage / summe) < 0.02,
      `${(gross.zusage / 20_000).toFixed(3)} vs ${(erwartetZusage / summe).toFixed(3)}`);
    const klein = zaehle(0.001, 0);
    // 1:1000: fluechtig 12, echt 3, zusage ≈ 1 → Anteil 0,750
    check('beim Weltstar bleibt es meist beim Emoji (> 70 %)', klein.fluechtig / 20_000 > 0.7,
      String(klein.fluechtig / 20_000));

    const s1 = contacts.staerkeOf({ seineReichweite: 1_000, meineReichweite: 1_000, passung: 1, stufe: 'zusage' });
    check('gleich groß, Zusage: 0,100', near(s1, Math.log10(2) / 3), String(s1));
    const s2 = contacts.staerkeOf({ seineReichweite: 1_000_000, meineReichweite: 1_000, passung: 1, stufe: 'zusage' });
    check('1:1000, Zusage: gedeckelt auf 1,0', near(s2, 1));
    const s3 = contacts.staerkeOf({ seineReichweite: 1_000_000, meineReichweite: 1_000, passung: 0.045, stufe: 'zusage' });
    check('dasselbe mit J-Pop-Passung: 0,045', near(s3, 0.045));
    const s4 = contacts.staerkeOf({ seineReichweite: 1_000_000, meineReichweite: 1_000, passung: 1, stufe: 'fluechtig' });
    check('flüchtig ist ein Viertel: 0,25', near(s4, 0.25));
  }

  console.log('--- Schübe und Draht ---');
  {
    const b1 = contacts.boostOf('shoutout', 1, 1_000_000);
    check('Shoutout: Faktor 4, 48 h, kind release-oder-creator',
      b1.factor === 4 && b1.dauerMs === 48 * 3600e3, JSON.stringify(b1));
    const b2 = contacts.boostOf('feature', 1, 1_000_000);
    check('Feature: Faktor 6, Hype-Extra 1,15, 72 h',
      b2.factor === 6 && near(b2.extra, 1.15) && b2.dauerMs === 72 * 3600e3, JSON.stringify(b2));
    const b3 = contacts.boostOf('konzert', 0.5, 1_000_000);
    check('Konzert: 50.000 zusätzliche Hörer, 7 Tage',
      b3.extra === 50_000 && b3.dauerMs === 7 * 24 * 3600e3, JSON.stringify(b3));

    // Die Beziehungsart statt der alten Drahtstufe. „beef" heißt jetzt „offener
    // Beef", nicht mehr „Draht ≤ −50" – ein Draht von −50 ohne Beef ist
    // verstimmt oder Rivale, darum entfällt dieser Fall hier.
    check('Art: null ist fremd', contacts.artOf({ respekt: 0, vertrauen: 0 }) === 'fremd',
      contacts.artOf({ respekt: 0, vertrauen: 0 }));
    check('Art: 20 / 20 ist bekannt', contacts.artOf({ respekt: 20, vertrauen: 20 }) === 'bekannt',
      contacts.artOf({ respekt: 20, vertrauen: 20 }));
    check('Art: 50 / 50 ist Partner', contacts.artOf({ respekt: 50, vertrauen: 50 }) === 'partner',
      contacts.artOf({ respekt: 50, vertrauen: 50 }));
    check('Art: 0 / −40 ist verstimmt', contacts.artOf({ respekt: 0, vertrauen: -40 }) === 'verstimmt',
      contacts.artOf({ respekt: 0, vertrauen: -40 }));
    check('Abklingen: 21 Punkte nach zwei Wochen → 17', contacts.decay(21, 14) === 17);
    check('Abklingen zieht auch negative Richtung 0', contacts.decay(-21, 14) === -17);
    check('Abklingen überschießt nicht', contacts.decay(3, 70) === 0 && contacts.decay(-3, 70) === 0);
  }

  console.log('--- Anfragen und Schübe ---');
  {
    const unb = require('../src/unb');
    unb.getBalance = async () => ({ cash: 0, bank: 0, total: 0 });
    unb.changeCash = async () => ({ cash: 0, bank: 0, total: 0 });
    const db = require('../src/db');
    const music = require('../src/music');
    const creator = require('../src/creator');
    const home = require('../src/home');
    const G = `KONTAKT_T${Date.now()}`;
    const U = 'k1';
    const t0 = new Date(new Date().setHours(6, 0, 0, 0)).getTime() + 24 * 3600e3;
    const H = 3600e3;
    const immer = () => 0.0001;     // Chance trifft, Stufe = erste = fluechtig
    const nie = () => 0.9999;

    await home.setHome(G, U, 'de');
    home.setLanguage(G, U, 'deutsch');
    music.setup(G, U, 'hiphop', music.PERSONAS[0].id);
    db.saveArtist(G, U, { ...db.getArtist(G, U, t0), listeners: 10_000 });

    const klein = data.CONTACTS.find((c) => c.language === 'deutsch' && c.genre === 'hiphop' && c.reach < 100_000);
    check('ein kleiner deutscher Rapper im Katalog', Boolean(klein));

    // Liste und Detail
    const liste = contacts.listFor(G, U, { filter: 'inland', now: t0 });
    check('Liste Inland: nur deutsche Kontakte, mit Chance', liste.length > 0
      && liste.every((z) => z.contact.country === 'de' && z.chance > 0 && z.chance <= 0.95));
    const d = contacts.detail(G, U, klein.id, t0);
    check('Detail: Musikseite, vier Anfragearten, Konzert gesperrt',
      d.seite === 'musik' && d.requests.length === 4
      && d.requests.find((r) => r.id === 'konzert').moeglich === false, JSON.stringify(d.requests?.map((r) => [r.id, r.moeglich])));

    // Erfolgreiche Anfrage: Zeit gebucht, Draht steigt, Schub gesetzt
    const zeitVor = creator.budget(G, U, t0).left;
    let r = await contacts.request(G, U, klein.id, 'shoutout', t0, immer);
    check('Antwort kommt, Zeit ist gebucht (2 h)', r.ok && r.antwort !== 'ignoriert'
      && creator.budget(G, U, t0).left === zeitVor - 2, JSON.stringify({ r: r.antwort, zeit: creator.budget(G, U, t0).left }));
    check('Draht bewegt sich nach oben', db.getContact(G, U, klein.id).draht > 0);
    check('Schub liegt bereit', contacts.activeBoost(G, U, 'release', t0)?.factor > 1);

    // Sperre
    r = await contacts.request(G, U, klein.id, 'shoutout', t0 + H, immer);
    check('Sperre 3 Tage', r.ok === false && r.reason === 'gesperrt', JSON.stringify(r));
    r = await contacts.request(G, U, klein.id, 'shoutout', t0 + 3 * 24 * H + H, immer);
    check('nach 3 Tagen wieder erlaubt', r.ok, JSON.stringify(r));

    // Ignoriert: Zeit trotzdem weg, Sperre 7 Tage, Draht −1
    const gross = data.CONTACTS.find((c) => c.reach >= 100_000_000);
    const drahtVor = db.getContact(G, U, gross.id)?.draht ?? 0;
    const zeit2 = creator.budget(G, U, t0 + 4 * 24 * H).left;
    r = await contacts.request(G, U, gross.id, 'feature', t0 + 4 * 24 * H, nie);
    check('Weltstar ignoriert, Zeit ist trotzdem weg, Draht −1',
      r.ok && r.antwort === 'ignoriert' && creator.budget(G, U, t0 + 4 * 24 * H).left === zeit2 - 2
      && db.getContact(G, U, gross.id).draht === drahtVor - 1, JSON.stringify(r));
    r = await contacts.request(G, U, gross.id, 'feature', t0 + 8 * 24 * H, immer);
    check('nach Ignorieren 7 Tage Sperre', r.ok === false && r.reason === 'gesperrt');

    // Schub wirkt genau einmal auf die nächste Veröffentlichung
    db.saveArtist(G, U, { ...db.getArtist(G, U, t0), songs: 5 });
    const boost = contacts.activeBoost(G, U, 'release', t0 + 4 * 24 * H);
    check('Schub noch aktiv', Boolean(boost));
    const ohne = music.publish(G, U, 'single', t0 + 4 * 24 * H, () => 0.5, { events: false });
    check('Veröffentlichung nennt den Schub', ohne.ok && ohne.kontakt?.name === klein.name, JSON.stringify(ohne.kontakt));
    check('Schub ist verbraucht', contacts.activeBoost(G, U, 'release', t0 + 4 * 24 * H) === null);

    // Abgelaufener Schub wirkt nicht
    db.setBoost(G, U, { kind: 'release', factor: 4, extra: 1, until: t0 - 1, contactId: klein.id, requestId: 'shoutout' }, t0);
    check('abgelaufener Schub zählt nicht', contacts.activeBoost(G, U, 'release', t0) === null);

    // Stärkerer Schub gewinnt, stapelt nicht
    db.setBoost(G, U, { kind: 'release', factor: 2, extra: 1, until: t0 + 48 * H, contactId: klein.id, requestId: 'shoutout' }, t0);
    db.setBoost(G, U, { kind: 'release', factor: 3, extra: 1, until: t0 + 48 * H, contactId: klein.id, requestId: 'shoutout' }, t0);
    check('stärkerer gewinnt', contacts.activeBoost(G, U, 'release', t0).factor === 3);
    db.setBoost(G, U, { kind: 'release', factor: 2.5, extra: 1, until: t0 + 48 * H, contactId: klein.id, requestId: 'shoutout' }, t0);
    check('schwächerer verdrängt nicht', contacts.activeBoost(G, U, 'release', t0).factor === 3);

    // Der StÄRKERE gewinnt, nicht der jüngere: ein laufendes Feature lässt sich
    // von einem später gesendeten Shoutout nicht verdrängen, obwohl der länger läuft.
    const stark = db.setBoost(G, U,
      { kind: 'release', factor: 6, extra: 1.9, until: t0 + 72 * H, contactId: klein.id, requestId: 'feature' }, t0);
    check('starker Schub wird gesetzt', stark.neu === true && stark.row.factor === 6);
    const spaet = t0 + 25 * H;
    const schwach = db.setBoost(G, U,
      { kind: 'release', factor: 1.5, extra: 1, until: spaet + 48 * H, contactId: gross.id, requestId: 'shoutout' }, spaet);
    const noch = contacts.activeBoost(G, U, 'release', spaet);
    check('schwächerer mit späterem Ende verdrängt den starken nicht',
      schwach.neu === false && noch.factor === 6 && noch.requestId === 'feature'
      && noch.until === t0 + 72 * H, JSON.stringify({ neu: schwach.neu, f: noch.factor, r: noch.requestId }));

    // Gleich stark: der alte bleibt stehen, sein Fenster reicht aber weiter.
    const gleich = db.setBoost(G, U,
      { kind: 'release', factor: 6, extra: 1.9, until: t0 + 96 * H, contactId: gross.id, requestId: 'shoutout' }, spaet);
    check('gleich stark verlängert nur das Fenster',
      gleich.neu === false && gleich.row.until === t0 + 96 * H
      && gleich.row.request_id === 'feature', JSON.stringify(gleich));

    // ----------------------------------------------- Achsen durch die Mechanik
    // Bis hier hat nur der DRAHT gezeigt, dass sich etwas bewegt – und der ist
    // der Mittelwert, also blind gegen vertauschte Achsen. Diese Fälle lesen
    // die Achsen selbst.
    db.saveArtist(G, U, { ...db.getArtist(G, U, t0), listeners: 10_000 });
    /** Gesetzter Zufall: erst die Chance, dann die Stufe, dann der Satz. */
    const folge = (...xs) => { let i = 0; return () => (i < xs.length ? xs[i++] : 0.5); };

    /*
     * Rammstein, Respekt 100 bei Vertrauen −100: der Rivale.
     *
     * Hier stand bis Task 5 die Zusicherung „die Stufe hängt am Respekt, nicht
     * am Draht" mit dem Wurf 0,73. Sie ist an dieser Stelle NICHT mehr prüfbar:
     * Seit `stufeVon` den Respekt mit `respektWirkt` dämpft, ist bei Vertrauen
     * −100 der wirkende Respekt 0 – und damit zufällig genau der Draht 0. Die
     * zwei Größen sind in diesem Zustand nicht mehr zu unterscheiden, der Fall
     * liegt jetzt unten bei kimchikid (Vertrauen 0, Draht 50 ≠ Respekt 100).
     *
     * Der Fall selbst bleibt: Er trägt die Achsen von „echt", die Rivalen-Art
     * und die Verstimmung darunter. Nur der Wurf wandert von 0,73 auf 0,80 –
     * die Grenze zu „echt" liegt ohne den Respekt-Term bei 0,7499 statt 0,7058,
     * und 0,80 liegt wie vorher 0,73 in der Spanne von „echt" (bis 0,9374).
     */
    const tR = t0 + 20 * 24 * H;
    db.saveContact(G, U, 'rammstein', { respekt: 100, vertrauen: -100, boden: 0,
      tries: 0, yes: 0, last_try: 0, last_move: tR, ignored_at: 0 });
    const re = await contacts.request(G, U, 'rammstein', 'shoutout', tR, folge(0.001, 0.80, 0.5));
    check('beim Rivalen (Respekt 100, Vertrauen −100) fällt die Antwort „echt"',
      re.ok && re.antwort === 'echt',
      JSON.stringify({ ok: re.ok, a: re.antwort, reason: re.reason }));
    check('echt bewegt ungleich: Respekt +9 (geklemmt bei 100), Vertrauen +3',
      re.achsen.respekt === 100 && re.achsen.vertrauen === -97, JSON.stringify(re.achsen));
    check('achsenVor meldet den Stand davor',
      re.achsenVor.respekt === 100 && re.achsenVor.vertrauen === -100, JSON.stringify(re.achsenVor));
    check('der Draht ist der Mittelwert der neuen Achsen',
      re.draht === 2 && re.drahtVor === 0 && re.delta === 2,
      JSON.stringify({ d: re.draht, v: re.drahtVor, delta: re.delta }));
    check('viel Respekt bei zerstörtem Vertrauen ist ein Rivale', re.art === 'rivale', re.art);
    check('echt schreibt keine Gedächtniszeile', db.memoryCount(G, U, 'rammstein') === 0,
      String(db.memoryCount(G, U, 'rammstein')));

    // Ninachuba, frisch: eine Zusage. 0,999 landet im letzten Gewicht.
    const tZ = tR + 24 * H;
    const rz = await contacts.request(G, U, 'ninachuba', 'shoutout', tZ, folge(0.001, 0.999, 0.5));
    check('Zusage', rz.ok && rz.antwort === 'zusage', JSON.stringify({ ok: rz.ok, a: rz.antwort }));
    check('Zusage bewegt beide Achsen um 12',
      rz.achsen.respekt === 12 && rz.achsen.vertrauen === 12, JSON.stringify(rz.achsen));
    check('eine Zusage allein macht noch keinen festen Partner',
      rz.partner === false && rz.partnerNeu === false, JSON.stringify([rz.partner, rz.partnerNeu]));
    const mz = db.memoryOf(G, U, 'ninachuba', 2);
    check('die Zusage steht im Gedächtnis, mit ihren Deltas',
      mz.length === 1 && mz[0].art === 'zusage' && mz[0].detail === 'Dich erwähnen'
      && mz[0].d_respekt === 12 && mz[0].d_vertrauen === 12, JSON.stringify(mz));

    // Rammstein ist kühl: Ablehnung kann verstimmen. 0,999 verfehlt die Chance,
    // 0,1 liegt unter VERSTIMMT_CHANCE.
    const tV = tR + 4 * 24 * H;
    const rv = await contacts.request(G, U, 'rammstein', 'shoutout', tV, folge(0.999, 0.1, 0.5));
    check('der Kühle verstimmt sich', rv.ok && rv.antwort === 'ignoriert', JSON.stringify(rv.antwort));
    check('verstimmt kostet Respekt 8 und Vertrauen 2',
      rv.achsen.respekt === 92 && rv.achsen.vertrauen === -99, JSON.stringify(rv.achsen));
    const mv = db.memoryOf(G, U, 'rammstein', 2);
    check('die Verstimmung steht im Gedächtnis',
      mv.length === 1 && mv[0].art === 'verstimmt'
      && mv[0].d_respekt === -8 && mv[0].d_vertrauen === -2, JSON.stringify(mv));

    // Der Türöffner zählt feste Partner, nicht Draht 50: Respekt 100 bei
    // Vertrauen 0 ist genau Draht 50 – und öffnet trotzdem keine Tür.
    const tP = tR + 10 * 24 * H;
    db.saveContact(G, U, 'ninachuba', { respekt: 100, vertrauen: 0, boden: 0,
      tries: 1, yes: 1, last_try: 0, last_move: tP, ignored_at: 0 });
    check('Draht 50 ohne Vertrauen öffnet keine Tür',
      contacts.detail(G, U, klein.id, tP).tuerOeffner === 0,
      String(contacts.detail(G, U, klein.id, tP).tuerOeffner));
    db.saveContact(G, U, 'ninachuba', { respekt: 100, vertrauen: 50, boden: 0,
      tries: 1, yes: 1, last_try: 0, last_move: tP, ignored_at: 0 });
    check('ein fester Partner im Umfeld öffnet sie',
      near(contacts.detail(G, U, klein.id, tP).tuerOeffner, 0.075),
      String(contacts.detail(G, U, klein.id, tP).tuerOeffner));

    /*
     * Die Stufe hängt am RESPEKT, nicht am Draht – und das bei Vertrauen 0, wo
     * nichts gedämpft wird.
     *
     * kimchikid (41.000) gegen 10.000 Hörer ist Verhältnis 0,2439. Respekt 100
     * bei Vertrauen 0 ist Draht 50, und die zwei Gewichte liegen auseinander:
     * mit dem Respekt ist die Grenze zu „echt" 0,50102, mit dem Draht 0,53420.
     * Der Wurf 0,52 liegt dazwischen – mit dem Respekt fällt es auf „echt", mit
     * dem Draht bliebe es „flüchtig". Das ist die Zusicherung, die vorher auf
     * dem Rivalen saß (siehe dort).
     */
    const tS = tP + 5 * 24 * H;
    db.saveContact(G, U, 'kimchikid', { respekt: 100, vertrauen: 0, boden: 0,
      tries: 0, yes: 0, last_try: 0, last_move: tS, ignored_at: 0 });
    const rs = await contacts.request(G, U, 'kimchikid', 'shoutout', tS, folge(0.001, 0.52, 0.5));
    check('die Stufe hängt am Respekt, nicht am Draht', rs.ok && rs.antwort === 'echt',
      JSON.stringify({ ok: rs.ok, a: rs.antwort, reason: rs.reason, draht: rs.drahtVor }));
    check('…und der Draht dieses Falls ist wirklich 50, nicht 100',
      rs.drahtVor === 50 && rs.achsenVor.respekt === 100 && rs.achsenVor.vertrauen === 0,
      JSON.stringify({ d: rs.drahtVor, a: rs.achsenVor }));

    // Derselbe Weg durch contacts.request, aber mit dem Wurf 0,73 – der liegt
    // NUR ungedämpft in der Spanne von „echt" (0,70583); mit dem Dämpfer
    // beginnt sie erst bei 0,74997. Fängt beides: einen stufeVon ohne Dämpfer
    // UND ein request, das das Vertrauen nicht mehr mitreicht.
    const tD = tS + 5 * 24 * H;
    db.saveContact(G, U, 'rammstein', { respekt: 100, vertrauen: -100, boden: 0,
      tries: 0, yes: 0, last_try: 0, last_move: tD, ignored_at: 0 });
    const rd = await contacts.request(G, U, 'rammstein', 'shoutout', tD, folge(0.001, 0.73, 0.5));
    check('request reicht das Vertrauen an stufeVon: bei V −100 fällt 0,73 auf flüchtig',
      rd.ok && rd.antwort === 'fluechtig', JSON.stringify({ ok: rd.ok, a: rd.antwort }));

    // Der Boden erzählt die alte Band – auch ohne warme Achsen.
    db.saveContact(G, U, 'igorlevit', { respekt: 0, vertrauen: 0, boden: 10,
      tries: 0, yes: 0, last_try: 0, last_move: tP, ignored_at: 0 });
    check('detail: Boden 10 ohne warme Achsen ist eine alte Band',
      contacts.detail(G, U, 'igorlevit', tP).art === 'band',
      contacts.detail(G, U, 'igorlevit', tP).art);
    const dB = contacts.detail(G, U, 'igorlevit', tP);
    check('detail meldet die Achsen und den Boden',
      dB.respekt === 0 && dB.vertrauen === 0 && dB.boden === 10 && dB.draht === 0,
      JSON.stringify([dB.respekt, dB.vertrauen, dB.boden, dB.draht]));

    // Ein offener Beef schlägt alles – in der Liste wie im Detail.
    db.saveBeef(G, U, 'igorlevit', { hitze: 40, runden_ich: 1, runden_er: 0,
      last_hit: tP, last_cool: tP, konter_at: 0, angefangen: tP,
      status: 'offen', bonus_until: 0 });
    check('detail: offener Beef schlägt die alte Band',
      contacts.detail(G, U, 'igorlevit', tP).art === 'beef',
      contacts.detail(G, U, 'igorlevit', tP).art);
    const zl = contacts.listFor(G, U, { filter: 'alle', now: tP })
      .find((z) => z.contact.id === 'igorlevit');
    check('listFor kennt den offenen Beef auch', zl?.art === 'beef', JSON.stringify(zl?.art));
    check('listFor liefert die Achsen und den Boden mit',
      zl?.respekt === 0 && zl?.vertrauen === 0 && zl?.boden === 10 && zl?.draht === 0,
      JSON.stringify([zl?.respekt, zl?.vertrauen, zl?.boden, zl?.draht]));
  }

  console.log(`\n${pass} bestanden, ${fail} fehlgeschlagen`);
  process.exit(fail === 0 ? 0 : 1);
})();
