/**
 * ===========================================================================
 *  TAGESBONUS – die Sprüche
 * ===========================================================================
 *
 * Wie bei UnbelievaBoats `!work` soll nicht jeden Tag dieselbe Zeile kommen:
 * Woher das Geld stammt, wird jedes Mal neu gewürfelt. Der Betrag selbst
 * hängt NICHT vom Spruch ab (siehe income.js) – die Zeile ist reine Deko,
 * damit sich der Befehl nicht wie ein Knopf, sondern wie ein kleiner
 * Tagesbericht anfühlt.
 *
 * Format: In jeder Zeile steht genau einmal `{betrag}`; dort setzt der
 * Aufrufer den formatierten Betrag samt Währungssymbol ein. Das Emoji gehört
 * zur Zeile, damit jede ihren eigenen Ton hat.
 *
 * Eine neue Zeile hinzufügen = eine Zeile ergänzen. Der Test prüft
 * automatisch jede: genau ein Platzhalter, keine Dubletten, nicht zu lang.
 */

const LINES = [
  // ------------------------------------------------ dummes Glück
  '🛋️ Zwischen Omas Sofakissen lagen **{betrag}**. Sie hat nichts gemerkt. Noch nicht.',
  '🧦 In der Waschmaschine überlebten **{betrag}** den Schleudergang. Die Socke nicht.',
  '🪙 Du hast einen Parkautomaten geschüttelt, bis **{betrag}** rausfielen. Technik verstanden.',
  '🎰 Ein Automat hat sich verrechnet und dir **{betrag}** ausgespuckt. Du bist einfach gegangen.',
  '🧥 In der Winterjacke vom letzten Jahr steckten **{betrag}**. Vergangenheits-Ich, du Legende.',
  '🛒 Du hast einen Einkaufswagen zurückgebracht — und noch 43 weitere. Macht **{betrag}**.',
  '📬 Ein Brief vom Finanzamt. Ausnahmsweise mal **{betrag}** ZURÜCK. Setz dich lieber hin.',
  '🕳️ Beim Stolpern in ein Loch gefallen und unten **{betrag}** gefunden. Sturz hat sich gelohnt.',
  '🎫 Das Rubbellos aus dem Papierkorb war nicht ganz durchgerubbelt: **{betrag}**.',
  '🪑 Beim Möbelaufbau blieben Schrauben übrig — verkauft für **{betrag}**. Der Schrank wackelt.',

  // ------------------------------------------------ dreckig & eklig
  '🧻 Auf dem Bahnhofsklo Pfandflaschen gesammelt. Riecht nach Erfolg und nach anderem: **{betrag}**.',
  '🍕 Unterm Sofa lag ein Dönerteller von 2019. Darunter: **{betrag}**. Nicht anfassen, nur nehmen.',
  '🦶 Du hast Fußbilder verkauft. Frag nicht an wen. **{betrag}**, und die Scham war inklusive.',
  '🚽 Beim Klo-Reparieren im Spülkasten **{betrag}** gefunden. Der Vormieter hatte Geheimnisse.',
  '🐀 Eine Ratte hat dir einen Geldschein gebracht. Ihr habt jetzt eine Abmachung: **{betrag}**.',
  '🤧 Du hast in ein Taschentuch geniest und **{betrag}** ausgehustet. Der Arzt ist ratlos.',
  '🧼 Du hast fremde Autos gewaschen. Ungefragt. Die Leute zahlten **{betrag}**, damit du aufhörst.',
  '🥴 Nach der Feier lagen **{betrag}** in deiner Hose. Woher, weiß niemand. Erinnerung: gelöscht.',
  '🗑️ Container-Tauchen hinter dem Elektromarkt: **{betrag}**. Du riechst nach Sieg und nach Müll.',
  '👃 Du hast in der Nase gebohrt und einen Diamanten gefunden. Verkauft für **{betrag}**. Nicht nachmachen.',

  // ------------------------------------------------ unfassbar dumm
  '🧠 Du hast dein Passwort gegen Bezahlung verkauft: **{betrag}**. Es war „passwort123".',
  '📞 Ein Prinz aus einem fernen Land hat dir wirklich Geld überwiesen. **{betrag}**. Diesmal echt.',
  '🪜 Du bist auf ein Dach gestiegen, um deine Drohne zu retten. Fandest **{betrag}**. Die Drohne nicht.',
  '🔥 Du hast versucht, Geld zu verbrennen, um reich auszusehen. Der Feuerwehr-Bonus: **{betrag}**.',
  '🧊 Du hast Eiswürfel im Sommer verkauft. Sie schmolzen. Trotzdem **{betrag}**. Kundschaft war betrunken.',
  '🚲 Du hast dein Fahrrad verkauft und musstest laufen. Reue: groß. Ertrag: **{betrag}**.',
  '📺 Deinen Fernseher verkauft, um dir einen besseren zu kaufen. Aktueller Stand: **{betrag}** und kein Fernseher.',
  '🎓 Du hast bei einem Quiz „Ja" geraten. Es war eine Rechenaufgabe. Trotzdem **{betrag}**.',
  '🪤 Du hast eine Mausefalle mit Geld beködert und dich selbst gefangen. Trostpreis: **{betrag}**.',
  '🧪 Du hast Energydrink mit Cola gemischt und als Medizin verkauft. **{betrag}** und drei Anzeigen.',

  // ------------------------------------------------ zwielichtig
  '🕶️ Du hast „Beratung" angeboten. Worüber, weiß keiner. Honorar: **{betrag}**.',
  '📦 Ein Paket wurde falsch geliefert. Du hast es „weitergeleitet". Provision: **{betrag}**.',
  '🃏 Beim Kartenspiel im Hinterzimmer **{betrag}** gewonnen. Geh da nie wieder hin.',
  '🚗 Du hast jemandem sein eigenes Auto zurückverkauft. Er hat es nicht gemerkt: **{betrag}**.',
  '🏷️ Preisschilder im Laden „korrigiert". Differenz zu deinen Gunsten: **{betrag}**.',
  '🐕 Du hast einen entlaufenen Hund gefunden — nachdem du ihn losgebunden hast. Finderlohn **{betrag}**.',
  '🎩 Du hast dich als Hutverkäufer ausgegeben und einen Hut verkauft, den du getragen hast: **{betrag}**.',
  '💼 Du warst zwei Stunden in einem Büro, in das du nicht gehörst. Gehalt: **{betrag}**.',

  // ------------------------------------------------ absurd
  '👽 Außerirdische haben dich untersucht und **{betrag}** Schmerzensgeld dagelassen. Sehr korrekt.',
  '🦆 Eine Ente mit Talenten hat für dich gearbeitet. Ihr Anteil: null. Deiner: **{betrag}**.',
  '🍞 Ein Toaster hat **{betrag}** ausgeworfen statt Toast. Du hast trotzdem reingegriffen.',
  '🎮 Du hast einen von Gabriels 300 Controllern verkauft. Er zählt sie nie: **{betrag}**.',
  '🧙 Ein Zauberer verwandelte deinen Kaffee in Gold. Verkauft für **{betrag}**, Kaffee vermisst.',
  '🐙 Ein Oktopus hat für dich Aktien gehandelt. Rendite: **{betrag}**. Er will jetzt einen Anzug.',
  '🌪️ Ein Windstoß hat dir Scheine ins Gesicht geweht. **{betrag}** direkt in die Backe.',
  '🚀 Du hast Werbefläche auf deinem Rücken vermietet. Ein Raumfahrtkonzern zahlte **{betrag}**.',
  '🧟 Du hast im Zombiefilm mitgespielt und musstest nicht schauspielern. Gage: **{betrag}**.',
  '🐔 Dein Huhn hat ein goldenes Ei gelegt. Es war lackiert. Käufer merkte nichts: **{betrag}**.',

  // ------------------------------------------------ ehrliche Arbeit (selten)
  '🧾 Ganz normal gearbeitet. Kein Witz, keine Pointe, einfach **{betrag}**. Auch mal schön.',
  '🛠️ Du hast dem Nachbarn beim Umzug geholfen. Er zahlte **{betrag}** und einen Rücken.',
  '📚 Du hast Nachhilfe gegeben. Das Kind ist jetzt schlechter, du reicher: **{betrag}**.',
  '☕ Frühschicht im Café. Trinkgeld war gut gelaunt: **{betrag}**.',
  '🌱 Du hast Unkraut gejätet und Blumen erwischt. Bezahlt wurde trotzdem: **{betrag}**.',

  // ------------------------------------------------ selbstironisch
  '📉 Du wolltest investieren, hast aber nur zugeschaut. Deshalb hast du noch **{betrag}**.',
  '🤖 Der Bot hatte Mitleid mit dir. Hier, nimm **{betrag}** und sag es niemandem.',
  '🎁 Anwesenheitsprämie. Du hast heute geatmet: **{betrag}**.',
  '🫡 Für „einfach mal da sein" gibt es **{betrag}**. Die Latte liegt niedrig, du hast sie erreicht.',
  '🪫 Dein Akku war leer, dein Konto zum Glück nicht: **{betrag}**.',
  '🛌 Du bist im Bett geblieben und hast trotzdem **{betrag}** verdient. Das System ist kaputt.',
];

/** Zufällige Zeile. `random` ist injizierbar, damit Tests reproduzierbar sind. */
function pick(random = Math.random) {
  return LINES[Math.floor(random() * LINES.length)];
}

/** Setzt den (bereits formatierten) Betrag in eine Zeile ein. */
function format(line, amountText) {
  return String(line).replace('{betrag}', amountText);
}

module.exports = { LINES, pick, format };
