/**
 * ===========================================================================
 *  HEIMAT UND SPRACHE
 * ===========================================================================
 *
 * Zwei Entscheidungen, die zusammen bestimmen, für WEN man eigentlich Inhalte
 * macht – und die sich gegenseitig bedingen:
 *
 *   Das Land   sagt, wo du sitzt: Wie kaufkräftig dein Heimatmarkt ist
 *              (Werbedeals, Merch) und welche Sprache dort gesprochen wird.
 *   Die Sprache sagt, wen du erreichst: Wie groß der Topf überhaupt ist, wie
 *              schnell Leute hängenbleiben und was ein Aufruf einbringt.
 *
 * Daraus wird die zentrale Abwägung des Features:
 *
 *   Klein & schnell   Landessprache: enge Nische, hohe Bindung, früh gutes
 *                     Geld – aber die Decke kommt schnell.
 *   Groß & langsam    Englisch: gewaltiger Topf, aber du gehst zwischen
 *                     Millionen unter und wächst anfangs zäh.
 *
 * `pool` ist die entscheidende Zahl: Sie skaliert die Obergrenze der
 * Reichweite **linear** (siehe creator.js, `marketOf`) und verschiebt zugleich
 * den Punkt, ab dem sich alles voll vermarkten lässt. 1,0 entspricht der
 * bisherigen Auslegung ohne Sprachwahl.
 */

/**
 * Sprachen.
 *   pool   Größe des erreichbaren Publikums (skaliert die Obergrenze)
 *   speed  wie gut Zuschauer hängenbleiben (enge Nischen binden besser)
 *   money  Werbeeinnahme je Aufruf in diesem Markt
 */
const LANGUAGES = [
  { id: 'deutsch', name: 'Deutsch', emoji: '🇩🇪', pool: 0.55, speed: 1.30, money: 1.30,
    blurb: 'Kleiner Markt, treue Leute, gute Werbepreise.' },
  { id: 'englisch', name: 'Englisch', emoji: '🇬🇧', pool: 3.00, speed: 0.80, money: 1.00,
    blurb: 'Die ganze Welt – und die ganze Konkurrenz. Zäher Start, keine Decke.' },
  { id: 'spanisch', name: 'Spanisch', emoji: '🇪🇸', pool: 1.80, speed: 0.95, money: 0.70,
    blurb: 'Zwei Kontinente, viel Publikum, mäßige Werbepreise.' },
  { id: 'portugiesisch', name: 'Portugiesisch', emoji: '🇧🇷', pool: 1.00, speed: 1.05, money: 0.55,
    blurb: 'Riesige, extrem aktive Community. Zahlt schlecht, wächst schnell.' },
  { id: 'franzoesisch', name: 'Französisch', emoji: '🇫🇷', pool: 0.85, speed: 1.00, money: 0.95,
    blurb: 'Solide Größe, solide Preise, eigene Regeln.' },
  { id: 'italienisch', name: 'Italienisch', emoji: '🇮🇹', pool: 0.45, speed: 1.10, money: 0.85,
    blurb: 'Überschaubar und laut.' },
  { id: 'tuerkisch', name: 'Türkisch', emoji: '🇹🇷', pool: 0.50, speed: 1.15, money: 0.45,
    blurb: 'Sehr engagiert, sehr schnell – und sehr günstig für Werbekunden.' },
  { id: 'polnisch', name: 'Polnisch', emoji: '🇵🇱', pool: 0.30, speed: 1.20, money: 0.60,
    blurb: 'Klein, treu, unterschätzt.' },
  { id: 'japanisch', name: 'Japanisch', emoji: '🇯🇵', pool: 0.60, speed: 1.10, money: 1.40,
    blurb: 'Eigene Welt mit eigenen Regeln – und den besten Werbepreisen.' },
  { id: 'koreanisch', name: 'Koreanisch', emoji: '🇰🇷', pool: 0.35, speed: 1.15, money: 1.10,
    blurb: 'Klein, hochprofessionell, zahlungskräftig.' },
  { id: 'hindi', name: 'Hindi', emoji: '🇮🇳', pool: 1.50, speed: 1.10, money: 0.30,
    blurb: 'Wahnsinnige Zuschauerzahlen, kaum Werbegeld.' },
  { id: 'arabisch', name: 'Arabisch', emoji: '🇸🇦', pool: 1.10, speed: 1.05, money: 0.60,
    blurb: 'Viele Länder, ein Publikum.' },
  { id: 'mandarin', name: 'Mandarin', emoji: '🇨🇳', pool: 2.00, speed: 0.90, money: 0.75,
    blurb: 'Gewaltig – wenn man reinkommt.' },
  { id: 'niederlaendisch', name: 'Niederländisch', emoji: '🇳🇱', pool: 0.18, speed: 1.30, money: 1.15,
    blurb: 'Winziger Markt, in dem dich nach einem Jahr jeder kennt.' },
  { id: 'rumaenisch', name: 'Rumänisch', emoji: '🇷🇴', pool: 0.28, speed: 1.25, money: 0.55,
    blurb: 'Klein und sehr aktiv – die Zuschauer sind da, das Werbegeld weniger.' },
];

/**
 * Länder.
 *   market   Kaufkraft des Heimatmarkts – wirkt auf Werbedeals und Merch
 *   language die dort übliche Sprache (Heimvorteil, wenn du sie sprichst)
 *   music    Musikmarkt (siehe src/music.js):
 *     scene    Größe der Szene – Hörerpotenzial und Konzertgagen
 *     royalty  was ein Abruf abwirft (Japan zahlt das Siebenfache Indiens)
 *     idol     ob es hier Idol-Verträge gibt (Japan, Südkorea)
 *     strict   wie streng dein Markt urteilt: Skandale treffen härter, und
 *              wer sich zu lange nicht meldet, wird schneller vergessen
 */
const COUNTRIES = [
  { id: 'de', name: 'Deutschland', flag: '🇩🇪', market: 1.30, language: 'deutsch', music: { scene: 1.00, royalty: 1.15, idol: false, strict: 0.35 } },
  { id: 'at', name: 'Österreich', flag: '🇦🇹', market: 1.20, language: 'deutsch', music: { scene: 0.75, royalty: 1.10, idol: false, strict: 0.35 } },
  { id: 'ch', name: 'Schweiz', flag: '🇨🇭', market: 1.60, language: 'deutsch', music: { scene: 0.70, royalty: 1.30, idol: false, strict: 0.30 } },
  { id: 'us', name: 'USA', flag: '🇺🇸', market: 1.50, language: 'englisch', music: { scene: 1.90, royalty: 1.00, idol: false, strict: 0.20 } },
  { id: 'gb', name: 'Vereinigtes Königreich', flag: '🇬🇧', market: 1.30, language: 'englisch', music: { scene: 1.55, royalty: 1.05, idol: false, strict: 0.25 } },
  { id: 'ca', name: 'Kanada', flag: '🇨🇦', market: 1.25, language: 'englisch', music: { scene: 1.15, royalty: 1.00, idol: false, strict: 0.20 } },
  { id: 'au', name: 'Australien', flag: '🇦🇺', market: 1.20, language: 'englisch', music: { scene: 1.05, royalty: 1.00, idol: false, strict: 0.20 } },
  { id: 'fr', name: 'Frankreich', flag: '🇫🇷', market: 1.05, language: 'franzoesisch', music: { scene: 1.10, royalty: 0.95, idol: false, strict: 0.40 } },
  { id: 'es', name: 'Spanien', flag: '🇪🇸', market: 0.85, language: 'spanisch', music: { scene: 1.00, royalty: 0.80, idol: false, strict: 0.30 } },
  { id: 'it', name: 'Italien', flag: '🇮🇹', market: 0.85, language: 'italienisch', music: { scene: 0.95, royalty: 0.80, idol: false, strict: 0.35 } },
  { id: 'nl', name: 'Niederlande', flag: '🇳🇱', market: 1.20, language: 'niederlaendisch', music: { scene: 0.85, royalty: 1.10, idol: false, strict: 0.25 } },
  { id: 'pl', name: 'Polen', flag: '🇵🇱', market: 0.60, language: 'polnisch', music: { scene: 0.70, royalty: 0.60, idol: false, strict: 0.35 } },
  { id: 'tr', name: 'Türkei', flag: '🇹🇷', market: 0.45, language: 'tuerkisch', music: { scene: 0.90, royalty: 0.45, idol: false, strict: 0.55 } },
  { id: 'br', name: 'Brasilien', flag: '🇧🇷', market: 0.50, language: 'portugiesisch', music: { scene: 1.25, royalty: 0.45, idol: false, strict: 0.20 } },
  { id: 'mx', name: 'Mexiko', flag: '🇲🇽', market: 0.50, language: 'spanisch', music: { scene: 1.10, royalty: 0.45, idol: false, strict: 0.25 } },
  { id: 'jp', name: 'Japan', flag: '🇯🇵', market: 1.40, language: 'japanisch', music: { scene: 1.30, royalty: 1.50, idol: true, strict: 0.90 } },
  { id: 'kr', name: 'Südkorea', flag: '🇰🇷', market: 1.10, language: 'koreanisch', music: { scene: 1.45, royalty: 1.20, idol: true, strict: 1.00 } },
  { id: 'in', name: 'Indien', flag: '🇮🇳', market: 0.25, language: 'hindi', music: { scene: 1.15, royalty: 0.20, idol: false, strict: 0.55 } },
  { id: 'ae', name: 'Vereinigte Arabische Emirate', flag: '🇦🇪', market: 1.35, language: 'arabisch', music: { scene: 0.65, royalty: 0.90, idol: false, strict: 0.75 } },
  { id: 'ro', name: 'Rumänien', flag: '🇷🇴', market: 0.55, language: 'rumaenisch', music: { scene: 0.60, royalty: 0.50, idol: false, strict: 0.35 } },
  { id: 'ng', name: 'Nigeria', flag: '🇳🇬', market: 0.30, language: 'englisch', music: { scene: 1.20, royalty: 0.30, idol: false, strict: 0.30 } },
];

/** Solange nichts gewählt ist: neutral, damit bestehende Kanäle gleich bleiben. */
const DEFAULT_LANGUAGE = {
  id: '', name: 'noch nicht gewählt', emoji: '❔', pool: 1, speed: 1, money: 1,
  blurb: 'Wähle eine Sprache – sie entscheidet, wie groß dein Publikum werden kann.',
};

const DEFAULT_COUNTRY = {
  id: '', name: 'nirgendwo', flag: '🏳️', market: 1, language: '',
};

/** Heimvorteil, wenn die Sprache zum Land passt: du kennst die Kultur. */
const HOME_BONUS_SPEED = 1.15;

module.exports = {
  LANGUAGES, COUNTRIES, DEFAULT_LANGUAGE, DEFAULT_COUNTRY, HOME_BONUS_SPEED,
};
