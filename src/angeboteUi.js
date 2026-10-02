const { EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
const ui = require('./ui');
const angebote = require('./angebote');
const data = require('./data/angebote');
const { bar } = require('./achievementsUi');

const { homeButton, faktor } = ui;

/**
 * ===========================================================================
 *  ANSICHT DER ANGEBOTE (5c)
 * ===========================================================================
 *
 * Die Gegenrichtung zu 5a: Hier steht, was ANDERE von dir wollen – höchstens
 * zwei offene Anfragen und das eine große Format, an dem gerade gearbeitet
 * wird. Eine eigene Datei nach dem Vorbild von achievementsUi.js, denn Reihe 1
 * der Kontaktansicht sitzt mit fünf Knöpfen am Discord-Maximum; dort passt
 * nichts mehr hinein.
 *
 * Diese Datei kennt keine Regeln. Sie liest `offeneAngebote` und
 * `offeneProjekte` und holt die Zahlen aus `honorarOf`, `gageOf` und
 * `kollaboFaktorOf` – entschieden wird nichts davon hier.
 *
 * Zwei Dinge, die über die Darstellung hinausgehen:
 *
 *   • GERECHNET, NICHT ABGERECHNET. Wie die Kontaktansicht (5b) ruft diese
 *     Ansicht KEIN `settle`: Eine verfallene Anfrage kostet Draht, und eine
 *     Ansicht hat keinen Rückkanal, um das zu sagen. Abgerechnet wird im
 *     Handler (`settleAngebote` in buttons.js), und zwar vor dem Aufbau.
 *     Darum stehen hier `restMs > 0`-Prüfungen: Eine Anfrage, deren Frist
 *     durch ist, die aber noch keine Abrechnung gesehen hat, steht weiter als
 *     `offen` in der Tabelle und darf trotzdem keinen Knopf bekommen.
 *   • REAKTIONSHAUSHALT (§16, höchstens neun). 2 Anfragen × 2 Knöpfe +
 *     Arbeiten + Zurück + Hauptmenü = 7. Mehr darf hier nicht dazukommen; ein
 *     achter Knopf würde auf Fluxer stumm abgeschnitten.
 */

const zahl = (n) => Math.round(n).toLocaleString('de-DE');

/** Stunden ohne Nachkomma-Ballast: `6`, `18`, und `1,5`, falls es je eines gibt. */
const stunden = (n) => Number(n).toLocaleString('de-DE');

/**
 * Die Restfrist in ganzen Tagen: „2 Tage", „11 Tage".
 *
 * `ui.restZeit` zählt unter vier Tagen in Stunden („48 h") – das ist das Maß
 * für einen Schub, der Stunden lebt. Eine Frist läuft hier über Tage (3 für
 * eine Anfrage, 14 für ein Projekt), und „48 h" liest an dieser Stelle
 * niemand. Unter einem Tag übernimmt `restZeit` wieder: Dann sind Stunden
 * genau die richtige Einheit.
 */
function restFrist(ms) {
  if (ms >= 86_400_000) {
    const tage = Math.ceil(ms / 86_400_000);
    return `${tage} ${tage === 1 ? 'Tag' : 'Tage'}`;
  }
  return ui.restZeit(Math.max(0, ms));
}

/**
 * Die Zeile des Kontakts zu einer Anfrage – aus der Id gewürfelt.
 *
 * Der Text steht nicht in der Tabelle (`angebote` hat keine Spalte dafür), und
 * eine Ansicht, die bei jedem Öffnen eine andere Zeile zeigt, liest sich wie
 * ein zweiter Kontakt. Dieselbe Id gibt deshalb immer dieselbe Zeile:
 * `textFor` zieht mit `Math.floor(random() × Anzahl)`, und dieser „Würfel"
 * trifft reproduzierbar das Fach `id % 3`.
 */
function zeileFor(row) {
  if (!row.contact) return '';
  const n = Number(row.id) || 0;
  return angebote.textFor(row.contact.trait, 'anfrage', row.contact.name,
    () => ((n % 3) + 0.5) / 3);
}

/**
 * Was eine Anfrage einbringt – eine Zeile je Art.
 *
 * Honorar, Gage und der Kollabo-Faktor kommen fertig aus `src/angebote.js`,
 * die Stunden und Stückzahlen aus `src/data/angebote.js`, die
 * Vertragskonditionen aus `music.LABEL`. Gerechnet wird hier nichts, und
 * gebucht schon gar nichts.
 */
function ertragZeile(art, lage, market) {
  const music = require('./music');
  if (art.id === 'gastpart') {
    return `💰 Honorar **${zahl(angebote.honorarOf({
      seine: lage.seine,
      tantiemenProTag: music.royaltyPerDay(lage.meine, market),
    }))}**`;
  }
  if (art.id === 'vorgruppe') {
    return `💰 Gage **${zahl(angebote.gageOf({
      meine: lage.meine, seine: lage.seine,
      showPay: music.SHOW_PAY, showExp: music.SHOW_EXP,
    }))}**`;
  }
  if (art.id === 'tausch') return '📣 Schub auf deine nächste Veröffentlichung';
  if (art.id === 'kollabo') {
    const f = angebote.kollaboFaktorOf({ meine: lage.meine, seine: lage.seine });
    return `💿 ${data.KOLLABO_STUNDEN} Stunden Arbeit · `
      + `Publikum ×${faktor(Math.round(f * 100) / 100)}`;
  }
  if (art.id === 'tour') {
    return `🎵 ${data.TOUR_KONZERTE} Konzerte · ${data.TOUR_STUNDEN} Stunden Arbeit`;
  }
  if (art.id === 'label') {
    return `📝 Vertragsangebot: ${music.LABEL.advanceDays} Tage Vorschuss, `
      + `${Math.round(music.LABEL.cut * 100)} % Anteil`;
  }
  return '';
}

/** Die Zeile unter dem Fortschrittsbalken eines Projekts. */
function projektErtrag(projekt, lage) {
  if (projekt.art === 'kollabo') {
    const f = angebote.kollaboFaktorOf({ meine: lage.meine, seine: lage.seine });
    return `Publikum ×${faktor(Math.round(f * 100) / 100)}`;
  }
  if (projekt.art === 'tour') return `${data.TOUR_KONZERTE} Konzerte am Stück`;
  return null;
}

/**
 * Die Lage auf der Musikseite – meine Hörer und seine Reichweite, dieselbe,
 * mit der `annehmen` rechnet. `null`, wenn es dafür keine Seite gibt.
 *
 * Geholt wird sie nur, wenn wirklich etwas anliegt: `music.status` geht über
 * `db.getArtist`, und das LEGT den Künstler an. Ein Blick auf eine leere
 * Ansicht darf keine Zeile schreiben (§4). Wer eine Anfrage offen hat, hat
 * ohnehin eine Karriere – anders wird keine zugestellt.
 */
function lageFor(guildId, userId, contact, now) {
  if (!contact) return null;
  return require('./beef').musikLage(guildId, userId, contact, now);
}

/**
 * 📬 Angebote: die offenen Anfragen und das laufende große Format.
 */
async function buildAngeboteView({ guildId, userId }) {
  const now = Date.now();
  // `restMs > 0`: siehe Banner – die Ansicht rechnet nicht ab, also darf eine
  // Anfrage, deren Frist längst durch ist, hier nicht mehr mitspielen.
  //
  // Die beiden `slice` sind der Reaktionshaushalt als Code: `ANFRAGEN_MAX` und
  // „nur EIN Projekt" sind Regeln von `src/angebote.js`, aber eine Ansicht darf
  // nicht daran zerbrechen, wenn irgendwann eine Zeile mehr in der Tabelle
  // steht – sechs Knöpfe in einer Reihe lehnt Discord ab, und Fluxer schnitte
  // den Rest stumm weg. Gezeigt wird deshalb nur, was auch einen Knopf bekommt.
  const anfragen = angebote.offeneAngebote(guildId, userId, now)
    .filter((r) => r.restMs > 0 && r.artInfo && r.contact)
    .slice(0, data.ANFRAGEN_MAX);
  const projekte = angebote.offeneProjekte(guildId, userId, now)
    .filter((p) => p.restMs > 0 && p.artInfo && p.contact)
    .slice(0, 1);

  const embed = new EmbedBuilder().setTitle('📬 Angebote').setColor(0x1abc9c);

  if (!anfragen.length && !projekte.length) {
    embed.setDescription(
      '_Gerade liegt nichts an._\n\n'
      + 'Anfragen kommen von selbst – von Künstlern, zu denen der Draht steht. '
      + 'Halte ihn in 🤝 **Kontakte** warm, dann meldet sich jemand.');
    return {
      embeds: [embed],
      // Auch die leere Ansicht braucht den Weg zurück ins Hauptmenü
      // (§ menu.test.js prüft genau das).
      components: [new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId(`grp|work|${userId}`)
          .setLabel('Zurück').setEmoji('◀️').setStyle(ButtonStyle.Secondary),
        homeButton(userId))],
    };
  }

  const market = require('./music').marketOf(guildId, userId);
  const bloecke = [];

  for (const r of anfragen) {
    const lage = lageFor(guildId, userId, r.contact, now);
    const ertrag = lage ? ertragZeile(r.artInfo, lage, market) : '';
    const zeile = zeileFor(r);
    const zeit = r.artInfo.time > 0 ? `⏳ ${r.artInfo.time} Stunden` : null;
    bloecke.push([
      `${r.artInfo.emoji} **${r.artInfo.name}** — ${r.contact.emoji} ${r.contact.name}`,
      // Kursiv und OHNE zusätzliche Anführungszeichen – wie `beefNote` und
      // `kontaktNote` die Zeilen aus LINES setzen. Die Zeilen erzählen eine
      // Handlung („{name} schreibt: „Sag einfach ja."") und tragen ihre
      // wörtliche Rede schon selbst; ein zweites Paar darum ergäbe „…"".
      zeile ? `_${zeile}_` : null,
      [ertrag, zeit, `Frist: noch ${restFrist(r.restMs)}`].filter(Boolean).join(' · '),
    ].filter(Boolean).join('\n'));
  }

  for (const p of projekte) {
    const lage = lageFor(guildId, userId, p.contact, now);
    const ertrag = lage ? projektErtrag(p, lage) : null;
    bloecke.push([
      `${p.artInfo.emoji} **${p.artInfo.name}** mit ${p.contact.emoji} ${p.contact.name}`,
      [
        `${bar([p.stunden_ist, p.stunden_soll])} `
        + `${stunden(p.stunden_ist)} von ${stunden(p.stunden_soll)} Stunden`,
        `Frist: noch ${restFrist(p.restMs)}`,
        ertrag,
      ].filter(Boolean).join(' · '),
    ].join('\n'));
  }

  embed.setDescription(bloecke.join('\n\n'));
  embed.setFooter({
    text: anfragen.length
      ? `Absagen kostet ${Math.abs(data.DRAHT_AB)} Draht, Liegenlassen `
        + `${Math.abs(data.DRAHT_VERFALL)}.`
      : 'Die Stunden sind weg, wenn die Frist reißt.',
  });

  /*
   * Reihe 1 trägt je Anfrage Annehmen und Absagen (höchstens 2 × 2 = 4) und
   * dahinter das Arbeiten am Projekt – fünf Knöpfe, genau das Discord-Maximum
   * einer Reihe. Reihe 2 trägt Zurück und Hauptmenü. Zusammen 7 Reaktionen,
   * also zwei unter der Fluxer-Grenze (§16).
   */
  const aktionen = [];
  for (const r of anfragen) {
    aktionen.push(new ButtonBuilder()
      .setCustomId(`angebot-an|${r.id}|${userId}`)
      .setLabel(`Annehmen: ${r.contact.name}`.slice(0, 40))
      .setEmoji('✅').setStyle(ButtonStyle.Success));
    aktionen.push(new ButtonBuilder()
      .setCustomId(`angebot-ab|${r.id}|${userId}`)
      .setLabel(`Absagen: ${r.contact.name}`.slice(0, 40))
      .setEmoji('🚪').setStyle(ButtonStyle.Secondary));
  }
  for (const p of projekte) {
    aktionen.push(new ButtonBuilder()
      .setCustomId(`angebot-arbeit|${p.id}|${userId}`)
      .setLabel(`Arbeiten (${data.ARBEIT_STUNDEN})`)
      .setEmoji('🛠️').setStyle(ButtonStyle.Primary));
  }

  const rows = [];
  if (aktionen.length) rows.push(new ActionRowBuilder().addComponents(...aktionen));
  rows.push(new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId(`grp|work|${userId}`)
      .setLabel('Zurück').setEmoji('◀️').setStyle(ButtonStyle.Secondary),
    homeButton(userId)));

  return { embeds: [embed], components: rows };
}

module.exports = { buildAngeboteView };
