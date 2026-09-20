/**
 * ===========================================================================
 *  LEICHTE EREIGNISSE EINER FIRMA
 * ===========================================================================
 *
 * Das Gegenstück zu data/musicEvents.js: je abgerechnetem Tag ein Wurf in
 * company.settle, wirkt sofort, kein Klick. Branchenneutral formuliert –
 * die Härte kommt aus der Tagesdecke, nicht aus dem Text. `flavor` darf je
 * Branche einen eigenen Text liefern (Start: keiner).
 *
 *   klassen     welche Firmenklassen den Eintrag sehen (null = alle)
 *   umsatz      Faktor auf den Umsatz der nächsten `days` Tage (≤ 1,15, §3)
 *   days        Dauer für umsatz/wages in Tagen (Standard 1)
 *   auslastung  Punkte auf die Auslastung (±), gedeckelt 0…1
 *   kasse       Vielfaches der Tagesdecke, negativ = Abzug (nie positiv)
 *   wages       Faktor auf die NPC-Löhne der `days` Tage
 *   quit        so viele NPCs kündigen (die dienstältesten zuerst)
 *   werbung     Werbetage ±
 *   staffRank   ein zufälliger NPC ±1 Rang
 *
 * Kein `lock` hier: Betriebsschließungen gibt es nur in Vorfällen.
 */

const COMPANY_EVENTS = [
  { id: 'none', weight: 140, text: null },

  // ------------------------------------------------------------------ gut
  { id: 'stammkunde', weight: 5, umsatz: 1.10,
    text: '🤝 Ein Stammkunde bringt seine Kollegen mit.' },
  { id: 'grossauftrag', weight: 5, klassen: ['mittel', 'gross'], umsatz: 1.15, days: 2,
    text: '📦 Ein Großauftrag – zwei Tage volle Auslastung.' },
  { id: 'lokalpresse', weight: 5, auslastung: 0.1,
    text: '📰 Die Lokalzeitung hat euch erwähnt.' },
  { id: 'guter_tag', weight: 5, wages: 0.5,
    text: '☀️ Ruhiger Tag, halbe Belegschaft reicht – die Löhne auch.' },
  { id: 'empfehlung', weight: 5, werbung: 1,
    text: '⭐ Fünf Sterne online – wirkt wie ein Tag Werbung.' },
  { id: 'talent', weight: 5, klassen: ['mittel', 'gross'], staffRank: 1,
    text: '🎓 Einer deiner Leute wächst über sich hinaus.' },

  // ------------------------------------------------------------- schlecht
  { id: 'lieferant', weight: 5, umsatz: 0.7,
    text: '🚚 Der Lieferant kommt nicht. Halbleere Regale.' },
  { id: 'kuehlung', weight: 5, kasse: -0.5,
    text: '🧊 Die Kühlung fällt aus. Was drin war, ist hin.' },
  { id: 'kassensturz', weight: 5, kasse: -0.3,
    text: '🧾 Die Kasse stimmt nicht. Keiner weiß, warum.' },
  { id: 'krank', weight: 5, umsatz: 0.8,
    text: '🤒 Zwei Leute krank – Lohn läuft, Umsatz nicht.' },
  { id: 'abwanderung', weight: 5, klassen: ['mittel', 'gross'], quit: 1,
    text: '👋 Einer deiner Leute geht zur Konkurrenz.' },
  { id: 'bewertung', weight: 5, auslastung: -0.1,
    text: '💬 Eine Ein-Stern-Bewertung macht die Runde.' },
];

const NO_EVENT = COMPANY_EVENTS[0];

/** Kandidaten einer Firmenklasse mit Gewichten – Würfel und Tests ziehen hier. */
function candidates(klasse) {
  return COMPANY_EVENTS
    .filter((e) => !e.klassen || e.klassen.includes(klasse))
    .map((e) => ({ event: e, weight: e.weight }));
}

module.exports = { COMPANY_EVENTS, NO_EVENT, candidates };
