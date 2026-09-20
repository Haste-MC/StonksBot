/**
 * ===========================================================================
 *  VORFÄLLE EINER FIRMA – die Entscheidungen des Inhabers
 * ===========================================================================
 *
 * Dritte Domäne des Entscheidungs-Systems (decisions.js) neben Creator und
 * Musik. Gewürfelt nach der Tagesabrechnung, entschieden nur vom Inhaber,
 * Frist 24 h. Wirkungen wie bei den leichten Ereignissen (siehe
 * data/companyEvents.js), dazu:
 *
 *   minGroesse  ab welcher Größe (Stufe + Extras, 0…9) der Vorfall auftaucht
 *   minNpc      so viele NPC-Angestellte braucht es mindestens
 *   refund      Vielfaches der Tagesdecke zurück – nur nach einem kasse-Abzug
 *               derselben Option, nie mehr als abgezogen
 *   lock        Betrieb geschlossen für N Tage (Löhne laufen)
 *   sell        Übernahme: Firma schließt, Auszahlung = investiert plus Kasse und Lager (Einstand)
 *
 * Verluste werden mit der Härte der Größe verstärkt (× 1 … 1,6), × 1,6 bei
 * Schweigen. Kein Ausgang zerstört Ausbau – die Schließung ist das Härteste.
 */

const COMPANY_DECISIONS = [
  {
    id: 'gesundheitsamt', emoji: '🧑‍⚕️', title: 'Das Gesundheitsamt steht vor der Tür',
    minGroesse: 0,
    text: 'Unangemeldete Kontrolle. Die Liste der Mängel ist länger, als dir lieb ist.',
    options: [
      { id: 'beheben', label: 'Sofort beheben', emoji: '🔧',
        outcomes: [
          { weight: 10, kasse: -1, text: 'Ein Tag Umsatz für Handwerker und Auflagen. Dafür ist Ruhe.' },
        ] },
      { id: 'abwarten', label: 'Abwarten', emoji: '⏳',
        outcomes: [
          { weight: 5, text: 'Die Nachkontrolle kommt nie. Glück gehabt.' },
          { weight: 5, lock: 3, auslastung: -0.2,
            text: 'Sie kommen wieder – mit Siegel. Drei Tage zu, und die Kundschaft hat es gesehen.' },
        ] },
    ],
    expire: { lock: 5, text: 'Keine Reaktion, keine Frist eingehalten. Fünf Tage geschlossen.' },
  },
  {
    id: 'griff_in_die_kasse', emoji: '🕵️', title: 'Griff in die Kasse',
    minGroesse: 1, minNpc: 1,
    text: 'Die Abrechnung stimmt seit Tagen nicht, und die Kamera zeigt, wer es war.',
    options: [
      { id: 'anzeigen', label: 'Anzeigen', emoji: '⚖️',
        outcomes: [
          { weight: 6, quit: 1, text: 'Anzeige, Kündigung, Ende. Die anderen haben verstanden.' },
          { weight: 4, quit: 1, kasse: -0.5, text: 'Anzeige und Kündigung – und ein Anwalt, der auch bezahlt werden will.' },
        ] },
      { id: 'gespraech', label: 'Unter vier Augen', emoji: '🤫',
        outcomes: [
          { weight: 7, staffRank: 1, kasse: -0.3,
            text: 'Ein ehrliches Gespräch. Der Fehlbetrag bleibt, aber die Person wird dein zuverlässigster Mensch.' },
          { weight: 3, kasse: -1, quit: 1, text: 'Zweite Chance, zweiter Griff. Diesmal ist die Kasse leer und die Person weg.' },
        ] },
    ],
    expire: { kasse: -2, text: 'Du hast nicht hingeschaut. Es hat sich rumgesprochen, dass niemand hinschaut.' },
  },
  {
    id: 'streik', emoji: '✊', title: 'Die Belegschaft will mehr',
    minGroesse: 3, minNpc: 3,
    text: 'Deine Leute stehen vor der Tür statt dahinter. Sie wollen mehr Lohn – ab sofort.',
    options: [
      { id: 'nachgeben', label: 'Nachgeben', emoji: '🤝',
        outcomes: [
          { weight: 10, wages: 1.3, days: 7, text: 'Eine Woche 30 % mehr Lohn. Der Laden läuft weiter.' },
        ] },
      { id: 'aussitzen', label: 'Aussitzen', emoji: '🪨',
        outcomes: [
          { weight: 5, lock: 2, text: 'Zwei Tage steht alles. Dann kommen sie zurück – zu den alten Bedingungen.' },
          { weight: 5, quit: 2, text: 'Zwei von ihnen kommen nicht zurück.' },
        ] },
    ],
    expire: { lock: 3, quit: 1, text: 'Drei Tage Stillstand, und einer hat in der Zeit was Neues gefunden.' },
  },
  {
    id: 'wasserschaden', emoji: '💧', title: 'Rohrbruch über Nacht',
    minGroesse: 0,
    text: 'Zehn Zentimeter Wasser im Laden, und es kommt noch nach.',
    options: [
      { id: 'notdienst', label: 'Notdienst rufen', emoji: '🚨',
        outcomes: [
          { weight: 10, kasse: -1.5, text: 'Teuer, aber um zehn Uhr ist der Boden trocken.' },
        ] },
      { id: 'versicherung', label: 'Über die Versicherung', emoji: '📄',
        outcomes: [
          { weight: 7, kasse: -1.5, lock: 2, refund: 1,
            text: 'Zwei Tage zu, dann zahlt die Versicherung den Großteil zurück.' },
          { weight: 3, kasse: -1.5, lock: 2,
            text: 'Zwei Tage zu – und die Versicherung findet eine Klausel.' },
        ] },
    ],
    expire: { lock: 4, kasse: -1, text: 'Das Wasser stand vier Tage. Der Schaden auch.' },
  },
  {
    id: 'uebernahme', emoji: '🏦', title: 'Ein Investor will den Laden',
    minGroesse: 3,
    text: 'Ein Angebot auf dem Tisch: deinen ganzen Ausbau plus Kasse und Lager. Sofort.',
    options: [
      { id: 'verkaufen', label: 'Verkaufen', emoji: '💰',
        outcomes: [
          { weight: 10, sell: true, text: 'Unterschrift, Übergabe, Konto. Die Firma gehört jetzt jemand anderem.' },
        ] },
      { id: 'ablehnen', label: 'Ablehnen', emoji: '🚫',
        outcomes: [
          { weight: 6, text: 'Er zuckt mit den Schultern und geht.' },
          { weight: 4, auslastung: -0.2, text: 'Er eröffnet zwei Straßen weiter. Ein Teil deiner Kundschaft läuft rüber.' },
        ] },
    ],
    expire: { auslastung: -0.2, text: 'Keine Antwort ist auch eine. Er eröffnet nebenan.' },
  },
  {
    id: 'grossauftrag_risiko', emoji: '🎲', title: 'Alles auf einmal',
    minGroesse: 2,
    text: 'Ein Kunde will eine Großbestellung – du musst in Vorkasse gehen, er zahlt bei Lieferung. Sagt er.',
    options: [
      { id: 'annehmen', label: 'Annehmen', emoji: '✅',
        outcomes: [
          { weight: 65, kasse: -1, umsatz: 1.15, days: 5, text: 'Er zahlt. Fünf Tage läuft der Laden auf Anschlag.' },
          { weight: 35, kasse: -1, text: 'Er zahlt nicht. Die Ware ist weg, das Geld auch.' },
        ] },
      { id: 'ablehnen', label: 'Ablehnen', emoji: '🚫',
        outcomes: [
          { weight: 10, text: 'Du bleibst beim Tagesgeschäft.' },
        ] },
    ],
    expire: { text: 'Der Kunde hat sich anderswo bedient.' },
  },
];

module.exports = { COMPANY_DECISIONS };
