# Erfolge – Fortschritt

Plan: docs/superpowers/plans/2026-09-08-achievements.md
Zweig: erfolge (von main abgezweigt bei 73e2c44)

Task 1: complete (commits 4c53f03..5f5a447, review clean)
  Minor offen: async-IIFE im Test ohne await (wird ab Task 3 gebraucht);
  test/achievements.test.js noch nicht in package.json (geplant fuer Task 9).
Task 2: complete (commits 5f5a447..15fea2d, review clean)
  Minor offen: abStufe('tippfehler') wuerde jeden Fund treffen (rarityRank -1);
  db-require in achievements.js bis Task 3 ungenutzt;
  Tests pruefen Struktur, nicht die exakten Schwellenwerte.
Task 3: complete (commits 15fea2d..8281ef6, review clean)
  Minor offen: catch-Zweig in check() wird von keinem Test provoziert.
  Geklaert: state()/stateCtx wird ab Task 5 (Nachtrag) mitgetestet.
Task 4: complete (commits 8281ef6..c4d6326, review clean)
  Minor offen: toter getSymbol-Mock im Test; Fall "Postfach kaputt, Kanal ok" ungetestet.
Task 5: complete (commits c4d6326..49f4ba0, 3 commits: umsetzung + 2 fixes)
  2 CRITICAL behoben: backfill() vergab serverweite Erfolge (kein scope-Filter);
  Regeln mit test:()=>true feuerten im Nachtrag bedingungslos.
  1 IMPORTANT behoben: moves-Getter fehlte in baseCtx (move_1 im Live-Pfad stumm).
  hooksOf() entfernt (tot). heist_clean bekam backfill:false.
  Minor offen: rarity-Getter in backfillCtx ohne Memoisierung;
  measure-Fallback auf ctx.worth ist toter Code; Gleichstand bei measure unspezifiziert.
  Verifiziert: npm test EXIT=0, 1814 gruen, 0 rot; achievements 55/55.
Task 6: complete (commits 49f4ba0..a0cafe6, review clean, keine Befunde)
  Hinweis: Umsetzer-Subagent brach vor Test/Commit ab; Controller hat Tests
  nachgeholt (57/57, npm test EXIT=0, 1816 gruen) und committet.
Task 7: complete (commits a0cafe6..8a5356e, 2 commits: umsetzung + fix, review clean)
  2 IMPORTANT behoben: Buttons erfolge-tafel/erfolge-meine hatten keinen Handler
  in src/buttons.js (Ehrentafel war im Bot unerreichbar); buildBoardView ungetestet.
  Umsetzer ergaenzte zusaetzlich ui.homeButton in beiden Ansichten, weil
  test/menu.test.js fuer jeden Menueintrag einen Zurueck-Button verlangt.
Task 8: complete (commits 8a5356e..fe647ce, 3 commits: umsetzung + 2 fixes)
  1 CRITICAL behoben: Abzeichen im Profil zeigten keine serverweiten Erfolge
  (listFor filtert auf privat) -> neue Funktion badgesFor, serverweite zuerst.
  1 IMPORTANT behoben: Titel-Menue schnitt Erfolgstitel lautlos ab -> faire
  Aufteilung der 16 Button-Plaetze + sichtbarer Hinweis beim Kuerzen.
  2 IMPORTANT (Testluecken) geschlossen, beide mit Gegenprobe rot->gruen belegt.
  Minor offen: buildProfileView ruft listFor UND badgesFor -> zwei Abfragen
  derselben Rohdaten.
Task 9: complete (commit fe647ce..HEAD)
  package.json: achievements.test.js in die Kette (npm test jetzt 1910 statt 1816).
  ARCHITEKTUR.md Abschnitt 14; Controller korrigierte die falsche Aussage
  "bindet level nicht ein" (Zeile 313 nutzt level.progress) und ergaenzte
  den Absatz zum lautlosen Nachtrag.
  patchnotes 1.27.0 vom 2026-09-09.
  Hinweis: Umsetzer-Subagent brach vor Test/Commit ab (wie in Task 6).

FINALE GESAMTPRUEFUNG (3 Runden Review -> Fix -> Verifikation):
  Runde 1 (opus): 2 CRITICAL (3 Erfolge unerreichbar; backfillWorld nie
    aufgerufen), 3 IMPORTANT -> commits 229877e, 0be60cf, 80b79b3
  Runde 2 (opus): 1 CRITICAL (N Guthabenabfragen im Renderpfad -> Ansicht
    kippt), 1 IMPORTANT (neue Konten verlieren ihren ersten Erfolg)
    -> commits 32d495c, 2520a9a, c641966
  Runde 3 (opus): 1 CRITICAL (backfillWorld sperrt sich selbst aus),
    2 IMPORTANT (activity.record kann Ueberfall/Auszahlung kippen; nur das
    Profil stiess den Welt-Nachtrag an) -> commits dba0a9f, 1760a13
  Beide Critical aus Runde 3 vom Controller unabhaengig per Skript verifiziert.
  Endstand: npm test EXIT=0, 1954 gruen, 0 rot.
