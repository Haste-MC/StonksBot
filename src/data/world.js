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
 */
const COUNTRIES = [
  { id: 'de', name: 'Deutschland', flag: '🇩🇪', market: 1.30, language: 'deutsch' },
  { id: 'at', name: 'Österreich', flag: '🇦🇹', market: 1.20, language: 'deutsch' },
  { id: 'ch', name: 'Schweiz', flag: '🇨🇭', market: 1.60, language: 'deutsch' },
  { id: 'us', name: 'USA', flag: '🇺🇸', market: 1.50, language: 'englisch' },
  { id: 'gb', name: 'Vereinigtes Königreich', flag: '🇬🇧', market: 1.30, language: 'englisch' },
  { id: 'ca', name: 'Kanada', flag: '🇨🇦', market: 1.25, language: 'englisch' },
  { id: 'au', name: 'Australien', flag: '🇦🇺', market: 1.20, language: 'englisch' },
  { id: 'fr', name: 'Frankreich', flag: '🇫🇷', market: 1.05, language: 'franzoesisch' },
  { id: 'es', name: 'Spanien', flag: '🇪🇸', market: 0.85, language: 'spanisch' },
  { id: 'it', name: 'Italien', flag: '🇮🇹', market: 0.85, language: 'italienisch' },
  { id: 'nl', name: 'Niederlande', flag: '🇳🇱', market: 1.20, language: 'niederlaendisch' },
  { id: 'pl', name: 'Polen', flag: '🇵🇱', market: 0.60, language: 'polnisch' },
  { id: 'tr', name: 'Türkei', flag: '🇹🇷', market: 0.45, language: 'tuerkisch' },
  { id: 'br', name: 'Brasilien', flag: '🇧🇷', market: 0.50, language: 'portugiesisch' },
  { id: 'mx', name: 'Mexiko', flag: '🇲🇽', market: 0.50, language: 'spanisch' },
  { id: 'jp', name: 'Japan', flag: '🇯🇵', market: 1.40, language: 'japanisch' },
  { id: 'kr', name: 'Südkorea', flag: '🇰🇷', market: 1.10, language: 'koreanisch' },
  { id: 'in', name: 'Indien', flag: '🇮🇳', market: 0.25, language: 'hindi' },
  { id: 'ae', name: 'Vereinigte Arabische Emirate', flag: '🇦🇪', market: 1.35, language: 'arabisch' },
  { id: 'ro', name: 'Rumänien', flag: '🇷🇴', market: 0.55, language: 'rumaenisch' },
  { id: 'ng', name: 'Nigeria', flag: '🇳🇬', market: 0.30, language: 'englisch' },
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
