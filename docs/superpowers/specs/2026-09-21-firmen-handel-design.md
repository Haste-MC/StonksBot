# Eigene Firmen – Stück 3b: Handel zwischen Spielerfirmen (Spedition als Großhändler)

Stand: 2026-09-21 · Zweig `main` · baut auf 3a (`2026-09-20-firmen-waren-design.md`) ·
Beschluss des Nutzers 2026-09-21: Variante **A** („Die Spedition wird Großhändler").

## Ziel

Mit 3a kauft jede Firma ihre Ware beim NPC-Markt (Börsenkurs). 3b macht die
**Spedition** zur Drehscheibe: Sie kann die Ware **jeder** Branche liefern –
kauft beim NPC-Markt mit Großhandelsrabatt und verkauft an andere Spielerfirmen
zu einem selbst gesetzten Preis zwischen Großhandels- und NPC-Tagespreis. Der
Käufer spart, der Spediteur verdient die Spanne, Geld fließt Kasse → Kasse.
Kein Zwischenlager, keine Verträge, keine Nichterfüllung („just in time").

## Nicht-Ziele

- Keine Produktionsketten (Werkstatt → Spedition o. ä.), keine anderen
  Händler-Branchen, kein freier Warenmarkt zwischen Firmen derselben Ware.
- Kein Zwischenlager beim Spediteur, keine Lieferverträge mit Laufzeit.
- Keine Kursbeeinflussung durch Handel (3c).
- Kein Handel mit sich selbst (ein Spieler hat höchstens eine Firma).

## Was heute gilt (gegen den Code geprüft)

| | Quelle |
|---|---|
| `wareOf(guildId, b)` → `{ unit, price (NPC-Tagespreis), adhoc, ratio, … }`; `buyStock(guildId, userId, units | 'voll', now)` kauft zum NPC-Preis aus der Kasse, prüft `capacity − stock` und Kasse; `capacityOf(b, eff)` | `src/company.js:121, 134, 694` |
| Lager-Ansicht: Felder Bestand/Ø/Lagerwert/Kasse/Voll-machen-Kosten, Knöpfe Einkaufen (Modal `fware|kaufen`) · Voll machen · Firma · Home (4) | `src/ui.js:3105` |
| `firma|<aktion>|<arg>|<uid>`-Dispatcher, Modal-Zweige vor `deferUpdate`; `fware`-Modal-Handler | `src/buttons.js:1993, 2090, 2752` |
| Tageszähler-Muster `pitch_day`/`pitch_today` mit `dayKey(now)` | `src/company.js:52`, `pitchIn` |
| `openCompanies(guildId)`; Chronik `pushNews(c, at, text, kasse)`; Fluxer `MAX_REACTIONS 9`, Modal = Ein-Feld-Prompt | `src/db.js:1779`, `src/company.js`, `src/fluxer/` |

## Angebot

Nur Branchen mit `handel: true` (`data/companies.js`: die Spedition) dürfen
anbieten. Tabelle `company_offers (company_id, branch, share, active,
updated_at, PRIMARY KEY (company_id, branch))`: je Ziel-Branche (= deren Ware)
ein Anteil `share` in Prozent des NPC-Tagespreises, **90 … 100**, `active`
0/1. Der Preis ist damit an den Kurs gekoppelt: 95 % bleiben 95 %, wenn BETO
steigt.

Konstanten: `HANDEL_RABATT = 0.10` (Großhandel: der Spediteur zahlt
`round(npcPrice × 0,9)` je Einheit), `HANDEL_SHARE_MIN = 90`,
`HANDEL_SHARE_MAX = 100`, `HANDEL_KAPAZITAET = 20` (Einheiten je Platz und
Tag).

`setOffer(guildId, userId, branchId | 'alle', share | 'aus', now)` → setzt
oder deaktiviert Angebote (`reason: 'no_company' | 'not_trader' | 'branch' |
'share'`). `offersOf(guildId, companyId)` → alle neun Zeilen (fehlende als
inaktiv). `tradeCapacity(c, b, eff)` → `eff.slots × HANDEL_KAPAZITAET` minus
heute verkaufte Einheiten (`trade_day`/`trade_today` an der Firma).

## Kauf beim Spediteur

`offersFor(guildId, buyerBranchId, now)` → aktive Angebote offener
Spediteure für diese Ware, ohne geschlossene (`closed_until > now`), mit
`price = round(npcPrice × share / 100)`, `wholesale = round(npcPrice × 0,9)`,
`left` (Tageskapazität), sortiert nach Preis, dann Name.

`buyFromTrader(guildId, buyerUserId, traderCompanyId, units | 'voll', now)`:
1. Käufer `fresh`; Spediteur `settle` + laden; Angebot aktiv, Spediteur offen
   und nicht geschlossen (`reason: 'trader'`), nicht die eigene Firma
   (`'self'` – kann nicht vorkommen, wird trotzdem abgefangen).
2. `n = min(units, freie Lagerplätze, Tageskapazität des Spediteurs)`; `'voll'`
   = so viel wie geht; `n ≤ 0` → `'capacity'` (mit `free`, `left`).
3. `cost = n × price`; Käufer-Kasse ≥ cost (`'kasse'`).
4. **Synchron, ohne `unb`:** Käufer `kasse −= cost`, `stock += n`,
   `stock_cost += cost`; Spediteur `kasse += cost − n × wholesale`,
   `trade_today += n` (Tag über `trade_day`), `trade_units += n`,
   `trade_profit += cost − n × wholesale`. Zwei `saveCompany`, beide Chronik
   („🚚 12 Beton & Stahl von *Speedy GmbH* für 3.900" / „🚚 12 Beton & Stahl
   an *Bau AG* geliefert: +156 Spanne"). Rückgabe `{ ok, units, price,
   wholesale, cost, spread, trader, stock }`.

Die Spedition braucht keine Ware im eigenen Lager und keine Zeit: Der
Handel läuft über Kapazität (Plätze), nicht über Schichten.

## §3

- Geld fließt nur Kasse → Kasse; der einzige neue Effekt ist, dass `share <
  100` bis zu 10 % der Warenkosten des Käufers nicht vernichtet, sondern beim
  Spediteur landen. **Handels-Decke Käufer:** Decke + `0,1 × units × wareUnit`
  (Kiosk +50/Tag, Baufirma voll +2.788/Tag). **Handels-Decke Spediteur:**
  Kapazität × max. Spanne = `eff.slots × 20 × round(teuerste Ware × 0,1)` =
  Kern 10 × 20 × 48 (Club 480) = 9.600/Tag, voll 20 × 20 × 48 = 19.200/Tag –
  kleiner als ein Fünftel der Spedition-Decke; §15 nennt beide.
- Spanne ≥ 0 immer (`share ≥ 90` = Großhandelspreis); ein Spediteur kann sich
  nicht in den Ruin liefern.
- Test: Kiosk-Ware NPC 50 → Angebot 95 % = 48, Großhandel 45, Spanne 3;
  Baufirma-Ware 340 → 95 % = 323, Großhandel 306, Spanne 17.

## Anzeige

- **Lager-Ansicht des Käufers:** Abschnitt „🚚 Spediteure" mit bis zu drei
  Angeboten („**Speedy GmbH** 48 statt 50 (95 %) · heute noch 180
  Einheiten"), Knopf „Bei Spediteur kaufen" (Modal `fware|handel|<uid>`, Menge
  oder „voll"; nimmt das günstigste Angebot mit Kapazität) – nur wenn es
  Angebote gibt. Fluxer: 5 Knöpfe.
- **Spedition:** in ihrer Lager-Ansicht zusätzlich „Handel" (→
  `firma|handel|0|<uid>`). **Handel-Ansicht:** Tabelle der neun Waren mit
  Anteil/aktiv, heutige Lieferungen/Kapazität, gesamt gelieferte Einheiten
  und Spanne; Knöpfe „Angebot setzen" (Modal `fhandel|setzen|<uid>`, Text
  `<branche|alle> <prozent|aus>`, z. B. `baufirma 95`, `alle 97`, `kiosk aus`),
  „Alles aus", „Lager", „Firma", Home (5).
- **Betriebsansicht der Spedition:** im Feld „📦 Waren" eine Zeile „🚚 Handel:
  heute 60/200 · gesamt 4.120 Einheiten, +52.300 Spanne".
- Chronik-Zeilen auf beiden Seiten (siehe oben).

## Messung, Tests, Docs

- `handelslauf(tage)` im Messskript: eine Spedition (Kern) mit Angebot 95 %
  für alle Waren, eine Baufirma (Kern), die täglich zuerst beim Spediteur und
  dann beim NPC kauft; Ausgabe: Spediteur Median mit/ohne Handel, Käufer
  Median mit/ohne, Spanne/Tag, gelieferte Einheiten/Tag. Erwartung: Käufer
  +5 % seiner Warenkosten (`0,05 × 40 × 340 = 680/Tag`), Spediteur +680/Tag,
  beide unter ihrer Handels-Decke.
- Tests `test/companyTrade.test.js`: Angebotsregeln (nur Spedition, 90–100,
  `alle`, `aus`), Preisrechnung (48/45/3, 323/306/17), Kauf (Kassen, Lager,
  `trade_today`, Chronik beide Seiten), Kapazität (Tageslimit, Lager voll,
  `'voll'`), Ablehnungen (`trader` geschlossen/zu, `kasse`, `capacity`),
  Tageswechsel setzt `trade_today` zurück, `offersFor` sortiert und ohne
  geschlossene, Handels-Decke Handrechnung.
- Docs: §15 Handel (Decken, gemessen), Patchnotes 1.36.0, Addendum in 3a-Spec.

## Nachtrag 2026-09-21: 3c umgesetzt (siehe 2026-09-21-firmen-boerse-design.md)

Stück 3c („Börse aktiv": Nachfrage-Drift der Lieferanten-Aktien und
Firmenanteile) ist umgesetzt – Version 1.37.0, Spec
`2026-09-21-firmen-boerse-design.md`, Messung
`docs/messungen/2026-09-21-boerse-nachfrage.txt`, ARCHITEKTUR §15 „Börse
aktiv". Der Handel aus 3b zählt dabei je gelieferter Einheit einmal als
Nachfrage beim Lieferanten (der Spediteur kauft beim NPC-Markt); Angebote
und Spanne sind unverändert.
