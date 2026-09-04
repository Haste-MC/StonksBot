/**
 * ===========================================================================
 *  ENTSCHEIDUNGEN – die Vorfälle, bei denen man wählen muss
 * ===========================================================================
 *
 * Bis hierher war der Aufstieg eine Fleißaufgabe: Wer täglich sendet, kommt
 * irgendwann oben an. Genau das macht eine Aktivität langweilig – man spielt
 * sie nicht, man arbeitet sie ab.
 *
 * Diese Vorfälle brechen das auf. Sie treffen jeden, sie werden mit der Größe
 * häufiger und härter, und **keine Option ist sicher**: Die brave Wahl kostet
 * meistens etwas, die mutige kann alles kosten. Wer nicht reagiert, bekommt
 * das Ergebnis, das Schweigen eben hat.
 *
 * AUFBAU
 * ------
 *   minReach   ab welcher Gesamtreichweite der Vorfall überhaupt auftaucht
 *   platform   betroffener Kanal (null = trifft das ganze Netzwerk)
 *   options    2–3 Wahlmöglichkeiten, jede mit gewichteten Ausgängen
 *   expire     Ausgang, wenn niemand reagiert (Schweigen ist auch eine Wahl)
 *
 * WIRKUNGEN (alle optional, alle relativ zur Größe)
 * -------------------------------------------------
 *   followers     Anteil auf der betroffenen Plattform   (-0.2 = −20 %)
 *   followersAll  Anteil auf ALLEN Plattformen
 *   community     Punkte auf die Bindung (±)
 *   hype          Faktor auf die Form
 *   cash          Vielfaches eines "Aktionsertrags" (±)
 *   fatigue       Punkte auf die Erschöpfung (±)
 *   lock          Tage, die der Kanal gesperrt ist
 *   gear          true = die Ausrüstung dieser Plattform geht kaputt
 */

const DECISIONS = [
  {
    id: 'sponsor_betrug',
    emoji: '🪙',
    title: 'Dein Sponsor ist ein Problem',
    minReach: 25000,
    platform: null,
    text: 'Die Krypto-Börse, für die du letzte Woche geworben hast, ist heute '
      + 'nicht mehr erreichbar. Dein Chat schon.',
    options: [
      {
        id: 'trennen', label: 'Öffentlich distanzieren', emoji: '✂️',
        outcomes: [
          { weight: 6, community: 6, cash: -3,
            text: 'Du entschuldigst dich, zahlst ein paar Zuschauern den Schaden und kommst als jemand raus, der geradesteht.' },
          { weight: 4, followersAll: -0.04, community: 2,
            text: 'Die Entschuldigung wirkt einstudiert. Ein Teil des Publikums kauft sie dir nicht ab.' },
        ],
      },
      {
        id: 'schweigen', label: 'Aussitzen', emoji: '🤐',
        outcomes: [
          { weight: 5, followersAll: -0.10, community: -12,
            text: 'Schweigen liest sich wie Mittäterschaft. Das Thema läuft eine Woche ohne dich weiter.' },
          { weight: 5, hype: 0.85,
            text: 'Nach drei Tagen redet niemand mehr darüber. Ein bisschen hängen bleibt es trotzdem.' },
        ],
      },
      {
        id: 'doppeln', label: 'Nachlegen: "war ein guter Deal"', emoji: '🔥',
        outcomes: [
          { weight: 3, cash: 8, followersAll: -0.18, community: -20,
            text: 'Der Sponsor zahlt die letzte Rate, weil du hältst. Dein Publikum zahlt es dir heim.' },
          { weight: 7, followersAll: -0.28, community: -25, hype: 0.7,
            text: 'Das war der Clip, der rumgeht. Nicht der, den du wolltest.' },
        ],
      },
    ],
    expire: {
      followersAll: -0.08, community: -8,
      text: 'Du hast nicht reagiert. Die Geschichte hat sich ohne dich eine Meinung gebildet.',
    },
  },
  {
    id: 'alter_clip',
    emoji: '🎞️',
    title: 'Ein alter Clip taucht auf',
    minReach: 50000,
    platform: null,
    text: 'Irgendwer hat einen sechs Jahre alten Stream ausgegraben, in dem du '
      + 'etwas sagst, das du heute nicht mehr sagen würdest.',
    options: [
      {
        id: 'entschuldigen', label: 'Klar entschuldigen', emoji: '🙇',
        outcomes: [
          { weight: 7, community: 8, followersAll: -0.02,
            text: 'Kurz, ehrlich, ohne "aber". Das nimmt der Sache die Luft.' },
          { weight: 3, followersAll: -0.06,
            text: 'Die Entschuldigung wird selbst zum Thema. Manche finden sie zu viel, andere zu wenig.' },
        ],
      },
      {
        id: 'kontext', label: 'Kontext liefern', emoji: '📄',
        outcomes: [
          { weight: 5, community: 3,
            text: 'Du zeigst die zehn Minuten davor. Die Hälfte des Vorwurfs löst sich in Luft auf.' },
          { weight: 5, followersAll: -0.09, hype: 0.8,
            text: '"Kontext" liest sich wie Ausrede. Es wird größer, nicht kleiner.' },
        ],
      },
      {
        id: 'kontern', label: 'Zurückschießen', emoji: '🗡️',
        outcomes: [
          { weight: 4, followersAll: 0.06, community: -10, hype: 1.25,
            text: 'Du drehst den Spieß um. Laut, unterhaltsam, und es zieht neue Leute an.' },
          { weight: 6, followersAll: -0.20, community: -15,
            text: 'Aus einem alten Clip werden jetzt zwei. Der neue ist schlimmer.' },
        ],
      },
    ],
    expire: {
      followersAll: -0.10, hype: 0.8,
      text: 'Keine Reaktion, keine Kontrolle. Die Erzählung gehört jetzt anderen.',
    },
  },
  {
    id: 'exklusivvertrag',
    emoji: '📜',
    title: 'Exklusivvertrag auf dem Tisch',
    minReach: 250000,
    platform: 'twitch',
    text: 'Ein Netzwerk will dich exklusiv. Viel Geld sofort – dafür sollst du '
      + 'ein Jahr lang nirgendwo anders senden.',
    options: [
      {
        id: 'unterschreiben', label: 'Unterschreiben', emoji: '✍️',
        outcomes: [
          { weight: 6, cash: 25, followers: 0.05, community: -5,
            text: 'Das Geld ist da. Die Freiheit ein Jahr lang nicht.' },
          { weight: 4, cash: 30, followersAll: -0.12,
            text: 'Der Vertrag zahlt gut – aber die Plattformwechsel kosten dich Stammpublikum.' },
        ],
      },
      {
        id: 'nachverhandeln', label: 'Nachverhandeln', emoji: '🤝',
        outcomes: [
          { weight: 4, cash: 40, community: 4,
            text: 'Du bekommst mehr Geld und behältst die Zweitverwertung. Selten, aber es passiert.' },
          { weight: 6, hype: 0.9,
            text: 'Sie ziehen das Angebot zurück. Zu selbstbewusst für ihren Geschmack.' },
        ],
      },
      {
        id: 'ablehnen', label: 'Ablehnen', emoji: '🚪',
        outcomes: [
          { weight: 8, community: 10, hype: 1.1,
            text: 'Dein Publikum feiert die Unabhängigkeit. Zahlen kann man davon nichts, aber es hält.' },
          { weight: 2, followersAll: -0.03,
            text: 'Das Netzwerk nimmt stattdessen deine Konkurrenz unter Vertrag. Man merkt es.' },
        ],
      },
    ],
    expire: {
      hype: 0.95,
      text: 'Du hast dich nicht gemeldet. Das Angebot ist vom Tisch – und die Branche redet.',
    },
  },
  {
    id: 'copyright',
    emoji: '⚖️',
    title: 'Copyright-Claim auf dein bestes Video',
    minReach: 10000,
    platform: 'youtube',
    text: 'Ein Musikverlag beansprucht dein meistgesehenes Video. Vierzig '
      + 'Sekunden Hintergrundmusik.',
    options: [
      {
        id: 'entfernen', label: 'Musik rausschneiden', emoji: '✂️',
        outcomes: [
          { weight: 8, cash: -2,
            text: 'Eine Stunde Arbeit, das Video läuft weiter. Unspektakulär und richtig.' },
          { weight: 2, followers: -0.05,
            text: 'Der Neu-Upload verliert seinen Platz im Algorithmus. Ärgerlich.' },
        ],
      },
      {
        id: 'streiten', label: 'Widerspruch einlegen', emoji: '📢',
        outcomes: [
          { weight: 4, cash: 6, community: 5,
            text: 'Fair Use. Der Claim fällt, die Einnahmen kommen nach.' },
          { weight: 4, cash: -4, lock: 2,
            text: 'Der Widerspruch scheitert. Der Kanal bekommt eine Verwarnung und liegt zwei Tage still.' },
          { weight: 2, lock: 5, followers: -0.10,
            text: 'Zweiter Strike. Fünf Tage nichts, und der Kanal hängt danach in den Seilen.' },
        ],
      },
    ],
    expire: {
      cash: -3, followers: -0.04,
      text: 'Ignoriert. Die Einnahmen des Videos laufen ab jetzt woandershin.',
    },
  },
  {
    id: 'community_mob',
    emoji: '🧯',
    title: 'Deine Community geht auf jemanden los',
    minReach: 50000,
    platform: null,
    text: 'Du hast dich über einen anderen Creator lustig gemacht. Dein Chat '
      + 'hat das als Auftrag verstanden und überrennt gerade dessen Kanal.',
    options: [
      {
        id: 'ansage', label: 'Klare Ansage machen', emoji: '🛑',
        outcomes: [
          { weight: 8, community: 12, followersAll: -0.03,
            text: 'Du stellst dich davor und räumst auf. Ein paar Krawallmacher gehen, der Rest bleibt fester.' },
          { weight: 2, community: 5,
            text: 'Die Ansage wirkt. Der andere Creator bedankt sich sogar öffentlich.' },
        ],
      },
      {
        id: 'lachen', label: 'Mitlachen', emoji: '😹',
        outcomes: [
          { weight: 5, followersAll: 0.05, hype: 1.2, community: -8,
            text: 'Es ist unterhaltsam, und Unterhaltung zieht. Sauber fühlt es sich nicht an.' },
          { weight: 5, followersAll: -0.15, community: -18,
            text: 'Es kippt. Aus einem Witz wird eine Kampagne, und dein Name steht darüber.' },
        ],
      },
      {
        id: 'schweigen', label: 'Nichts sagen', emoji: '🙈',
        outcomes: [
          { weight: 6, community: -10, hype: 0.85,
            text: 'Du lässt es laufen. Es hört von selbst auf – aber nicht, ohne Spuren zu hinterlassen.' },
          { weight: 4, followersAll: -0.08,
            text: 'Andere Creator merken sich, wer weggeschaut hat.' },
        ],
      },
    ],
    expire: {
      community: -12, followersAll: -0.06,
      text: 'Ohne dich eskaliert es weiter, bis es jemand anderes beendet.',
    },
  },
  {
    id: 'algorithmus',
    emoji: '🔀',
    title: 'Die Plattform dreht am Algorithmus',
    minReach: 10000,
    platform: 'youtube',
    text: 'Über Nacht laufen nur noch kurze Videos. Deine 40-Minuten-Essays '
      + 'sehen plötzlich halb so viele Leute.',
    options: [
      {
        id: 'anpassen', label: 'Auf Kurzformat umstellen', emoji: '⚡',
        outcomes: [
          { weight: 6, followers: 0.12, community: -6,
            text: 'Die Zahlen kommen zurück. Deine Stammzuschauer vermissen die langen Sachen.' },
          { weight: 4, followers: 0.04, hype: 0.9,
            text: 'Du triffst den Ton nicht ganz. Es läuft, aber es fühlt sich nach fremdem Anzug an.' },
        ],
      },
      {
        id: 'bleiben', label: 'Beim eigenen Ding bleiben', emoji: '🪨',
        outcomes: [
          { weight: 5, followers: -0.08, community: 10,
            text: 'Weniger Leute, aber die richtigen. Deine Community wird enger.' },
          { weight: 3, followers: -0.15,
            text: 'Der Algorithmus vergisst dich schneller, als du dachtest.' },
          { weight: 2, followers: 0.10, community: 8, hype: 1.2,
            text: 'Zwei Monate später dreht die Plattform zurück – und du bist der Einzige, der noch da ist.' },
        ],
      },
    ],
    expire: {
      followers: -0.10,
      text: 'Du hast weitergemacht wie bisher, ohne es zu entscheiden. Die Zahlen entscheiden dann eben allein.',
    },
  },
  {
    id: 'talkshow',
    emoji: '📺',
    title: 'Einladung ins Fernsehen',
    minReach: 250000,
    platform: null,
    text: 'Eine Talkshow will dich als "Stimme der jungen Generation". Live, '
      + 'ohne Schnitt, neben jemandem, der das Internet für eine Modeerscheinung hält.',
    options: [
      {
        id: 'hingehen', label: 'Hingehen', emoji: '🎤',
        outcomes: [
          { weight: 5, followersAll: 0.22, community: 6,
            text: 'Du bleibst ruhig, sagst zwei kluge Sätze – und am nächsten Tag kennt dich die halbe Republik.' },
          { weight: 5, followersAll: -0.10, hype: 0.75, community: -6,
            text: 'Sie lassen dich auflaufen. Der Ausschnitt läuft seitdem als Meme.' },
        ],
      },
      {
        id: 'absagen', label: 'Höflich absagen', emoji: '🙅',
        outcomes: [
          { weight: 9, community: 3,
            text: 'Kein Risiko, keine Reichweite. Dein Publikum findet es souverän.' },
          { weight: 1, followersAll: 0.02,
            text: 'Die Absage selbst wird zum kleinen Thema – positiv, ausnahmsweise.' },
        ],
      },
    ],
    expire: {
      text: 'Die Redaktion hat jemand anderen genommen. Kein Schaden, keine Chance.',
    },
  },
  {
    id: 'stalker',
    emoji: '🚨',
    title: 'Jemand steht vor deiner Tür',
    minReach: 100000,
    platform: null,
    text: 'Ein Zuschauer hat deine Adresse herausgefunden und wartet unten. '
      + 'Er meint es "nur nett".',
    options: [
      {
        id: 'anzeige', label: 'Anzeige und öffentlich machen', emoji: '👮',
        outcomes: [
          { weight: 7, community: 10, fatigue: 15,
            text: 'Du sagst klar, dass das nicht okay ist. Die Community stellt sich hinter dich – der Abend ist trotzdem im Eimer.' },
          { weight: 3, followersAll: -0.04, fatigue: 20,
            text: 'Ein Teil des Internets findet, du "übertreibst". Du bist danach eine Weile nicht mehr so gern live.' },
        ],
      },
      {
        id: 'privat', label: 'Still regeln, umziehen', emoji: '📦',
        outcomes: [
          { weight: 8, cash: -6, fatigue: 10,
            text: 'Teuer, anstrengend, unsichtbar. Aber es ist vorbei.' },
          { weight: 2, cash: -9, hype: 0.9,
            text: 'Der Umzug frisst zwei Wochen. Der Kanal merkt die Pause.' },
        ],
      },
    ],
    expire: {
      fatigue: 25, hype: 0.85,
      text: 'Du hast es verdrängt. Es kostet dich trotzdem den Schlaf.',
    },
  },
  {
    id: 'leak',
    emoji: '💧',
    title: 'Dein unfertiges Video ist geleakt',
    minReach: 50000,
    platform: 'youtube',
    text: 'Der Schnitt von morgen liegt seit einer Stunde auf einer '
      + 'Filesharing-Seite. Zwei Kapitel fehlen noch.',
    options: [
      {
        id: 'sofort', label: 'Sofort veröffentlichen', emoji: '🚀',
        outcomes: [
          { weight: 6, followers: 0.08, hype: 1.15, community: -3,
            text: 'Unfertig, aber zuerst. Die Aufmerksamkeit nimmst du mit.' },
          { weight: 4, followers: -0.05, community: -5,
            text: 'Man sieht, dass es unfertig ist. Die Kommentare auch.' },
        ],
      },
      {
        id: 'neu', label: 'Neu drehen', emoji: '🎬',
        outcomes: [
          { weight: 7, cash: -5, fatigue: 20, community: 6,
            text: 'Zwei Nächte durch, dafür in deiner Qualität. Das sieht man.' },
          { weight: 3, fatigue: 25, hype: 0.85,
            text: 'Die zweite Fassung ist schlechter als die erste. Passiert.' },
        ],
      },
    ],
    expire: {
      followers: -0.05, community: -4,
      text: 'Der Leak läuft, du reagierst nicht. Die Klicks holt sich jemand anderes.',
    },
  },
  {
    id: 'steuer',
    emoji: '🧾',
    title: 'Post vom Finanzamt',
    minReach: 100000,
    platform: null,
    text: 'Betriebsprüfung. Drei Jahre. Du hast Belege in vier Ordnern, '
      + 'zwei E-Mail-Postfächern und einem Schuhkarton.',
    options: [
      {
        id: 'berater', label: 'Steuerberater bezahlen', emoji: '👔',
        outcomes: [
          { weight: 9, cash: -8,
            text: 'Teuer, aber es geht glatt durch. Genau dafür gibt es die.' },
          { weight: 1, cash: -4, community: 2,
            text: 'Der Berater findet sogar etwas zurück. Selten, aber schön.' },
        ],
      },
      {
        id: 'selbst', label: 'Selbst machen', emoji: '📚',
        outcomes: [
          { weight: 4, cash: -3, fatigue: 30,
            text: 'Drei Wochenenden im Schuhkarton. Es reicht.' },
          { weight: 6, cash: -18, fatigue: 25,
            text: 'Die Nachzahlung tut weh. Der Schuhkarton war keine Buchhaltung.' },
        ],
      },
    ],
    expire: {
      cash: -20,
      text: 'Nicht reagiert. Das Finanzamt schätzt dann – großzügig, zu seinen Gunsten.',
    },
  },
  {
    id: 'kollege',
    emoji: '🫂',
    title: 'Ein Kollege bittet um Rückendeckung',
    minReach: 25000,
    platform: 'twitter',
    text: 'Jemand, mit dem du früher gestreamt hast, steht in einem Drama. '
      + 'Er schreibt dir privat: "Sag doch mal was."',
    options: [
      {
        id: 'stellen', label: 'Öffentlich für ihn einstehen', emoji: '🛡️',
        outcomes: [
          { weight: 5, community: 8, followersAll: 0.04,
            text: 'Du stehst dazu, und es geht gut aus. Sowas merkt man sich in der Szene.' },
          { weight: 5, followersAll: -0.14, community: -10,
            text: 'Zwei Tage später kommen neue Details raus. Du stehst mit im Bild.' },
        ],
      },
      {
        id: 'privat', label: 'Nur privat unterstützen', emoji: '💬',
        outcomes: [
          { weight: 9, community: 2,
            text: 'Keine Schlagzeile, keine Blessuren. Er versteht es.' },
          { weight: 1, community: -4,
            text: 'Er versteht es nicht. Ein Kontakt weniger.' },
        ],
      },
      {
        id: 'distanz', label: 'Öffentlich distanzieren', emoji: '🧊',
        outcomes: [
          { weight: 6, followersAll: 0.03, community: -12,
            text: 'Sauber aus der Schusslinie. Die Szene findet es kalt.' },
          { weight: 4, followersAll: -0.07, community: -8,
            text: 'Zu schnell, zu hart – und am Ende war an der Sache nichts dran.' },
        ],
      },
    ],
    expire: {
      community: -6,
      text: 'Du hast nicht geantwortet. Auch das ist eine Antwort.',
    },
  },
  {
    id: 'hardware',
    emoji: '🔧',
    title: 'Das Setup macht Geräusche',
    minReach: 0,
    platform: 'twitch',
    text: 'Seit drei Tagen fiept irgendetwas im Rechner. Es könnte das Netzteil '
      + 'sein. Es könnte auch nichts sein.',
    options: [
      {
        id: 'tauschen', label: 'Vorsorglich tauschen', emoji: '🛒',
        outcomes: [
          { weight: 9, cash: -2,
            text: 'Kostet Geld, kostet einen Abend, und danach ist Ruhe.' },
          { weight: 1, cash: -2, hype: 1.05,
            text: 'Beim Umbau räumst du gleich alles auf. Läuft besser als vorher.' },
        ],
      },
      {
        id: 'weiter', label: 'Läuft doch noch', emoji: '🤷',
        outcomes: [
          { weight: 6, text: 'Es fiept weiter. Sonst passiert nichts.' },
          { weight: 4, gear: true, lock: 1, followers: -0.03,
            text: 'Mitten im Stream ist Schluss. Das Setup ist hin, der Abend auch.' },
        ],
      },
    ],
    expire: {
      text: 'Du hast es weiter ignoriert. Vorerst geht es gut.',
    },
  },
];

module.exports = { DECISIONS };
