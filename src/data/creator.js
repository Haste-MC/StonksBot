/**
 * ===========================================================================
 *  CREATOR-NETZWERK – vier Plattformen, ein Publikum
 * ===========================================================================
 *
 * Niemand ist nur auf einer Plattform. Wer streamt, hat auch einen
 * YouTube-Kanal, ein Instagram-Profil und einen Twitter-Account – und die
 * hängen zusammen: Der Clip vom Stream läuft auf YouTube, der Post treibt
 * Leute in den Stream, der Tweet kündigt beides an.
 *
 * Jede Plattform verdient auf ihre eigene Art – und Twitter gar nicht:
 *
 *   Twitch     Werbung + Spenden + Abos      live, sofort, am meisten Geld
 *   YouTube    Werbung auf Aufrufe           zahlt noch tagelang nach
 *   Instagram  nur Kooperationen             Reichweite ja, Werbegeld nein
 *   Twitter    NICHTS                        Community und Promo, kein Geld
 *
 * `time` ist der Anteil am Tagesbudget (siehe creator.js): Ein Stream kostet
 * einen halben Tag, ein Video den ganzen Nachmittag, ein Post fast nichts.
 * Dadurch wird aus "alles machen" eine Entscheidung.
 *
 * `community` sagt, wie stark eine Plattform **Bindung** aufbaut. Das ist
 * nicht dasselbe wie Reichweite: Im Livechat und unter Videos redet man
 * miteinander, im Instagram-Feed scrollt man vorbei. Deshalb:
 *
 *   Twitch     stark    zwei Stunden Livechat sind zwei Stunden Beziehung
 *   Twitter    stark    billig und direkt – pro Zeiteinheit das Beste
 *   YouTube    mittel   Kommentare, aber die Sendung läuft nur in eine Richtung
 *   Instagram  gar nicht  gesehen, geliked, weitergescrollt
 */

const PLATFORMS = [
  {
    id: 'twitch',
    name: 'Twitch',
    emoji: '🟣',
    color: 0x9146ff,
    action: 'Stream',
    actionVerb: 'live gehen',
    unit: 'Zuschauer',
    followerName: 'Follower',
    // Reichweite: base + k · (eigene + Übertrag)^exp
    base: 12, k: 0.9, exp: 0.62,
    follow: 0.35,                 // Anteil des Publikums, der folgt
    churnPerAction: 0.014,
    churnPerDay: 0.025,
    time: 2,
    cooldownMin: 90,
    gear: 'Streaming-Setup',
    subs: true,                   // hat Abos
    community: 1.3,        // Livechat bindet am stärksten
    blurb: 'Live und in Farbe. Das meiste Geld, die meiste Arbeit.',
  },
  {
    id: 'youtube',
    name: 'YouTube',
    emoji: '🔴',
    color: 0xff0000,
    action: 'Video',
    actionVerb: 'ein Video hochladen',
    unit: 'Aufrufe',
    followerName: 'Abonnenten',
    // Ein Video erreicht ein Vielfaches eines Livestreams – dafür abonniert
    // fast niemand. Genau umgekehrt zu Twitch.
    base: 20, k: 6.0, exp: 0.58,
    follow: 0.06,
    churnPerAction: 0.008,
    churnPerDay: 0.015,           // Abonnenten sind träge – im Guten wie im Schlechten
    time: 3,
    cooldownMin: 180,
    gear: 'Kameraausrüstung',
    subs: false,
    community: 0.9,       // Kommentare, aber Einbahnstraße
    blurb: 'Ein Video ist Arbeit – läuft dafür noch tagelang weiter.',
  },
  {
    id: 'instagram',
    name: 'Instagram',
    emoji: '📸',
    color: 0xe1306c,
    action: 'Post',
    actionVerb: 'etwas posten',
    unit: 'Impressionen',
    followerName: 'Follower',
    base: 25, k: 1.2, exp: 0.58,
    follow: 0.26,                 // wächst am schnellsten
    churnPerAction: 0.010,
    churnPerDay: 0.030,           // ... und vergisst am schnellsten
    time: 1,
    cooldownMin: 45,
    gear: null,                   // ein Handy hat jeder
    subs: false,
    community: 0,     // Feed baut keine Bindung auf
    blurb: 'Wächst am schnellsten. Zahlt selbst nichts – aber Marken zahlen.',
  },
  {
    id: 'twitter',
    name: 'Twitter',
    emoji: '🐦',
    color: 0x1da1f2,
    action: 'Tweet',
    actionVerb: 'etwas raushauen',
    unit: 'Impressionen',
    followerName: 'Follower',
    base: 30, k: 1.1, exp: 0.55,
    follow: 0.22,
    churnPerAction: 0.008,
    churnPerDay: 0.020,
    time: 1,
    cooldownMin: 30,
    gear: null,
    subs: false,
    community: 1.0,       // pro Zeiteinheit die beste Quelle
    blurb: 'Zahlt keinen Cent. Dafür hört dich hier jeder – auch beim Fehltritt.',
  },
];

/**
 * Formate je Plattform – das Gegenstück zu den Kategorien beim Streamen.
 *
 *   reach   Reichweite dieses Formats
 *   money   Zahlungsbereitschaft (Spenden bei Twitch, Kooperationen bei Insta)
 *   follow  wie gut es Publikum bindet
 *   risk    wie oft etwas schiefgeht
 */
const FORMATS = {
  twitch: [
    { id: 'chatting', name: 'Just Chatting', emoji: '💬', reach: 0.85, money: 1.6, follow: 1.0, risk: 1.0,
      community: 1.6,
      titles: ['wir reden über alles außer dem Thema', 'Kaffee, Chaos und ein bisschen Selbstmitleid',
        'Fragerunde bis mir die Antworten ausgehen', 'Ich lese eure Nachrichten vor (mutig)'] },
    { id: 'gaming', name: 'Gaming', emoji: '🎮', reach: 1.15, money: 0.8, follow: 1.05, risk: 0.9,
      community: 0.9,
      titles: ['Ranked bis zum Tilt', 'Wir schaffen das Level heute. Vermutlich.',
        'Blind durch ein Spiel, das ich nicht verstehe', 'Ein Versuch noch, dann ist Schluss (Lüge)'] },
    { id: 'speedrun', name: 'Speedrun', emoji: '⏱️', reach: 1.0, money: 1.0, follow: 1.25, risk: 1.15,
      community: 1.1,
      titles: ['PB-Versuch #412', 'Any% bis die Hände weh tun',
        'Der Skip klappt heute. Ganz sicher.', 'World Record Pace (bis Level 3)'] },
    { id: 'musik', name: 'Musik', emoji: '🎧', reach: 0.9, money: 1.45, follow: 0.9, risk: 1.0,
      community: 1.3,
      titles: ['Wunschkonzert – ihr sucht aus', 'Beats bauen, live und ohne Netz',
        'Cover-Abend mit fragwürdiger Tonlage', 'Lofi zum Lernen und Verzweifeln'] },
    { id: 'irl', name: 'IRL / Draußen', emoji: '🚶', reach: 1.25, money: 1.0, follow: 1.0, risk: 1.5,
      community: 0.9,
      titles: ['Stadtbummel mit fragwürdiger Route', 'Wir suchen den besten Döner der Stadt',
        'Zug fahren und Leute anschauen', 'Ich laufe, bis das Handy leer ist'] },
    { id: 'kochen', name: 'Kochen', emoji: '🍳', reach: 0.8, money: 1.2, follow: 0.85, risk: 0.75,
      community: 1.2,
      titles: ['Wir kochen etwas, das ich noch nie gekocht habe', 'Ein Rezept aus dem Chat (schlechte Idee)',
        'Meal Prep für die ganze Woche', 'Backen ohne Waage – Augenmaß ist alles'] },
  ],
  youtube: [
    { id: 'tutorial', name: 'Tutorial', emoji: '🛠️', reach: 1.0, money: 1.3, follow: 1.1, risk: 0.7,
      community: 1.0,
      tail: 1.6,   // Tutorials werden noch in zwei Jahren geklickt
      titles: ['So machst du das in 8 Minuten', 'Der komplette Anfängerguide',
        'Die 5 Fehler, die alle machen', 'Ich erkläre es so lange, bis es sitzt'] },
    { id: 'vlog', name: 'Vlog', emoji: '🎬', reach: 0.9, money: 1.0, follow: 1.2, risk: 1.0,
      community: 1.4,
      tail: 0.7,
      titles: ['Ein Tag in meinem Leben (spannend wie immer)', 'Umzugs-Vlog Teil 3',
        'Wir bauen das Studio um', 'Was diese Woche schiefging'] },
    { id: 'essay', name: 'Video-Essay', emoji: '📝', reach: 0.85, money: 1.4, follow: 1.3, risk: 0.9,
      community: 1.2,
      tail: 1.9,
      titles: ['Warum das eigentlich niemand versteht', 'Eine 40-Minuten-Analyse von etwas Belanglosem',
        'Die ganze Geschichte, chronologisch', 'Das Problem mit dem Ding'] },
    { id: 'highlights', name: 'Stream-Highlights', emoji: '✂️', reach: 1.2, money: 0.8, follow: 0.9, risk: 0.8,
      community: 0.8,
      tail: 0.5,   // schnell verbrannt
      titles: ['Die besten Momente der Woche', 'Ich reagiere auf meinen eigenen Stream',
        'Clips, die ihr gemeldet habt', 'Der Ausraster in voller Länge'] },
    { id: 'shorts', name: 'Shorts', emoji: '⚡', reach: 1.9, money: 0.35, follow: 0.6, risk: 0.9,
      community: 0.3,
      tail: 0.35,  // enorme Reichweite, mieser Ertrag – wie im Original
      titles: ['15 Sekunden, die alles ändern', 'Das geht gerade überall rum',
        'Kurz und schmerzlos', 'Ein Clip ohne Kontext'] },
  ],
  instagram: [
    { id: 'reel', name: 'Reel', emoji: '🎞️', reach: 1.8, money: 0.7, follow: 1.2, risk: 1.0,
      titles: ['Trend mitgenommen, drei Wochen zu spät', 'Schnitt auf den Beat',
        'Behind the Scenes vom Stream', '30 Sekunden, 4 Stunden Arbeit'] },
    { id: 'foto', name: 'Foto', emoji: '🖼️', reach: 0.8, money: 1.4, follow: 0.9, risk: 0.7,
      titles: ['Neues Setup, altes Chaos', 'Sonnenuntergang, ungefiltert (gefiltert)',
        'Das Foto, für das ich 40 Versuche brauchte', 'Kaffee und Kabelsalat'] },
    { id: 'story', name: 'Story', emoji: '⏳', reach: 1.1, money: 0.9, follow: 0.7, risk: 0.8,
      titles: ['Umfrage: soll ich das wirklich machen?', 'Countdown zum Stream',
        'Ungefiltertes Gemecker in 12 Teilen', 'Frag mich was'] },
    { id: 'kooperation', name: 'Werbepost', emoji: '🤝', reach: 0.9, money: 2.6, follow: 0.65, risk: 1.2,
      titles: ['#werbung, aber ehrlich', 'Ich benutze das wirklich (heute zum ersten Mal)',
        'Code in der Bio, ihr kennt das', 'Dieses Produkt hat mein Leben verändert (bis morgen)'] },
  ],
  twitter: [
    { id: 'ankuendigung', name: 'Ankündigung', emoji: '📢', reach: 1.0, money: 0, follow: 0.9, risk: 0.6,
      boost: 1.4, community: 0.6,   // treibt gezielt zur nächsten Aktion
      titles: ['gleich live, kommt vorbei', 'neues Video ist oben',
        'heute Abend passiert etwas Dummes', 'ihr wolltet es, hier ist es'] },
    { id: 'meinung', name: 'Meinung', emoji: '💭', reach: 1.5, money: 0, follow: 1.1, risk: 1.8,
      boost: 0.8, community: 0.8,
      titles: ['unpopular opinion:', 'niemand redet darüber, aber',
        'ich sage es, wie es ist', 'das wird mich Follower kosten'] },
    { id: 'witz', name: 'Witz', emoji: '😹', reach: 1.3, money: 0, follow: 1.0, risk: 0.9,
      boost: 0.9, community: 0.9,
      titles: ['ok das war lustiger in meinem Kopf', 'ein Wortspiel, für das ich mich entschuldige',
        'ich poste das und gehe', 'guten Morgen an alle außer einer Person'] },
    { id: 'community', name: 'Community', emoji: '💞', reach: 0.9, money: 0, follow: 0.8, risk: 0.5,
      boost: 0.6, community: 2.2,   // hält die Leute bei der Stange
      titles: ['danke für 10 tolle Jahre (es sind 3 Monate)', 'erzählt mir was Schönes',
        'wie geht es euch wirklich?', 'kleine Umfrage, große Wirkung'] },
  ],
};

/**
 * Ereignisse. `on` schränkt auf Plattformen ein (leer = überall möglich).
 * `spread` heißt: wirkt auf ALLE Plattformen, nicht nur auf die eine – so
 * fühlt sich das Netzwerk wie ein Netzwerk an.
 */
const EVENTS = [
  { id: 'none', weight: 110, text: null },

  // ------------------------------------------------------------- angenehm
  { id: 'raid', weight: 9, on: ['twitch'], audience: 1.8, follow: 1.4,
    text: '🚀 Ein größerer Kanal hat dich am Ende geraidet – plötzlich war die Bude voll.' },
  { id: 'algorithmus', weight: 9, on: ['youtube', 'instagram'], audience: 1.7, follow: 1.3,
    text: '📈 Der Algorithmus hat dich heute gemocht. Frag nicht, warum.' },
  { id: 'viral', weight: 5, audience: 2.4, follow: 1.8, spread: 1.5,
    text: '🔥 Das Ding geht rum. Überall. Auch da, wo du gar nichts gepostet hast.' },
  { id: 'whale', weight: 7, on: ['twitch'], money: 3.5,
    text: '🐳 Jemand mit zu viel Geld und zu wenig Schlaf hat den Chat geflutet.' },
  { id: 'clip', weight: 7, on: ['twitch', 'youtube'], audience: 1.25, follow: 2.0,
    text: '✂️ Ein Clip von dir ist rausgegangen. Leute kamen rein und blieben.' },
  { id: 'presse', weight: 4, audience: 1.4, follow: 1.5, spread: 1.8,
    text: '📰 Ein Artikel hat dich erwähnt. Plötzlich kennen dich Leute, die du nie erreicht hättest.' },

  // ------------------------------------------------------------ ärgerlich
  { id: 'technik', weight: 8, on: ['twitch'], audience: 0.55, follow: 0.5, risky: true,
    text: '🔌 Technikprobleme. Die halbe Sendung war ein Standbild.' },
  { id: 'troll', weight: 7, money: 0.6, loss: 0.02, risky: true,
    text: '👹 Eine Trollwelle in den Kommentaren. Ein paar Stammgäste hatten keine Lust mehr.' },
  { id: 'lag', weight: 6, on: ['twitch'], audience: 0.7, follow: 0.7, risky: true,
    text: '🐌 Das Internet war heute... kreativ. Ruckeln in HD.' },
  { id: 'flop', weight: 8, on: ['youtube', 'instagram'], audience: 0.5, follow: 0.6, risky: true,
    text: '🪦 Der Algorithmus hat es einfach nicht ausgespielt. Passiert.' },
  { id: 'strike', weight: 3, on: ['youtube'], audience: 0.4, money: 0.2, risky: true,
    text: '⚠️ Copyright-Claim. Die Einnahmen gehen erstmal woanders hin.' },
  { id: 'shitstorm', weight: 4, loss: 0.05, spreadLoss: 0.03, money: 0.7, risky: true,
    text: '🌪️ Ein Satz, ein Screenshot, eine Welle. Das kostet auf allen Kanälen.' },
  { id: 'stromausfall', weight: 3, on: ['twitch'], audience: 0.35, follow: 0.4, money: 0.5, risky: true,
    text: '💡 Stromausfall mitten im Stream. Ende, aus, Sicherung.' },
  { id: 'defekt', weight: 3, on: ['twitch', 'youtube'], breaks: true, audience: 0.6, risky: true,
    text: '💥 Mitten in der Aufnahme hat die Technik den Dienst quittiert.' },
];

/** Spendenkommentare (Twitch). */
const DONATIONS = [
  'für die Katzenstreu', 'sorry für den schlechten Witz eben',
  'ich schaue seit drei Jahren und schreibe zum ersten Mal',
  'mein Chef zahlt das, er weiß es nur nicht', 'kauf dir ein besseres Mikrofon',
  'das war der schlechteste Take, den ich je gesehen habe. Weiter so',
  'ich bin nur wegen der Musik hier', 'Grüße an meine Mutter, sie schaut mit',
  'nicht vorlesen', 'BITTE VORLESEN', 'ich habe eigentlich kein Geld',
  'für den Umzug in eine Wohnung mit Fenster',
  'du hast mir durch eine schwere Nachtschicht geholfen',
  'das ist mein letztes Geld bis Freitag',
  'ich wollte nur sehen, ob du meinen Namen richtig aussprichst',
];

/** Marken, die auf Instagram Kooperationen anbieten. */
const BRANDS = [
  { name: 'einem Energydrink mit fragwürdigem Geschmack', emoji: '🥤' },
  { name: 'einem Proteinriegel-Hersteller', emoji: '🍫' },
  { name: 'einer VPN-Firma', emoji: '🔐' },
  { name: 'einem Mobile Game, das du nie spielen wirst', emoji: '📱' },
  { name: 'einem Matratzen-Startup', emoji: '🛏️' },
  { name: 'einer Rasierklingen-Marke', emoji: '🪒' },
  { name: 'einem Lieferdienst', emoji: '🛵' },
  { name: 'einer Krypto-Börse (du sagst höflich ab und nimmst das Geld)', emoji: '🪙' },
  { name: 'einem Stuhlhersteller mit RGB', emoji: '🪑' },
  { name: 'einer Zahnzusatzversicherung', emoji: '🦷' },
];

/** Kommentare unter Videos und Posts – reine Deko. */
const COMMENTS = [
  'erster', 'wer schaut das 2026 noch', 'Algorithmus hat mich hergebracht',
  'die ersten 3 Minuten kann man skippen', 'wo ist das Setup-Video?',
  'mach mal lauter', 'ich bin wegen des Thumbnails hier und bleibe wegen der Stimme',
  'das hat mir tatsächlich geholfen, danke', 'Timestamps in den Kommentaren',
  'niemand: ... absolut niemand: ...', 'kommt der Teil 2?',
];

/** Wie eine Aktion anfängt. */
const INTROS = [
  'Licht an, Mikro auf,', 'Nach zwanzig Minuten Technikcheck:',
  'Ohne Vorwarnung raus:', 'Mit drei Stunden Verspätung, aber immerhin:',
  'Vollständig unvorbereitet:', 'Zwischen Tür und Angel:',
];

module.exports = { PLATFORMS, FORMATS, EVENTS, DONATIONS, BRANDS, COMMENTS, INTROS };
