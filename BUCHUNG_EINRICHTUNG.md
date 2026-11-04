# Buchungssystem marschbefehl.com – Einrichtung und Livegang

Stand 04.11.2026. Das Buchungssystem (Branch `buchung`) ist fertig gebaut, lokal mit Attrappen für Zahlung und Mail durchgespielt und seit 04.11.2026 als Branch-Deploy unter https://buchung--zeitreise-seelower-hoehen.netlify.app erreichbar (Zahlung dort noch „nicht freigeschaltet“, Verwaltung wartet auf die Variablen). Dieses Blatt führt Schritt für Schritt vom lokalen Stand zum Livegang. Alles, was ein Konto oder einen Schlüssel braucht, muss der Betreiber selbst anlegen.

## 1. Was läuft wo

| Baustein | Lösung | Kosten |
|---|---|---|
| Seiten + Functions | Netlify (Site `zeitreise-seelower-hoehen`) | frei |
| Daten | Netlify Blobs, Stores `fuehrungen` (Buchungen, Termine, Protokoll), `fuehrungen-bilder`, `fuehrungen-rechnungen` | frei |
| Zahlung | Stripe Checkout + Webhook | nur je Zahlung (ca. 1,5 % + 0,25 €) |
| Mail | Resend | frei bis 3.000 Mails/Monat |
| Zeitgesteuert | Netlify Scheduled Functions: `aufraeumen` alle 10 Min, `erinnerung` 07:00 UTC, `abgleich` 06:00 UTC | frei |

## 2. Stripe einrichten (Betreiber)

✅ 04.11.2026: Stripe-Konto angelegt, Testmodus; `STRIPE_SECRET_KEY` (sk_test) und `STRIPE_WEBHOOK_SECRET` per Doppelklick auf `werkzeug\2 START Stripe-Schluessel eintragen.cmd` (Desktop-Verknüpfung „Stripe-Schluessel eintragen“) für den Kontext `branch:buchung` gesetzt. Die Datei fragt beide Werte ab und prüft die Form (sk_…, whsec_…). Für den Livegang dieselbe Datei mit Live-Werten und `--alle` (Webhook dann auf marschbefehl.com, Punkt 3).

1. Konto bei stripe.com anlegen (Gewerbe, IBAN, Ausweis). Für den Testmodus reicht die Anmeldung.
2. **Developers → API keys**: `Secret key` (sk_test_… / später sk_live_…) → Netlify-Variable `STRIPE_SECRET_KEY`.
3. **Developers → Webhooks → Add endpoint**: Adresse `https://marschbefehl.com/.netlify/functions/stripe-webhook` (für den Branch-Test: `https://buchung--zeitreise-seelower-hoehen.netlify.app/.netlify/functions/stripe-webhook`). Ereignisse: `checkout.session.completed`, `checkout.session.async_payment_succeeded`, `checkout.session.async_payment_failed`, `checkout.session.expired`. Den angezeigten `Signing secret` (whsec_…) → `STRIPE_WEBHOOK_SECRET`.
4. **Einstellungen → Zahlungen → Zahlungsmethoden**: Karten, Apple Pay, Google Pay, PayPal an (je Zeile „···“ → Aktivieren). ✅ In der Sandbox am 04.11.2026 erledigt. **Im Live-Konto wiederholen** (Sandbox und Live haben getrennte Einstellungen). Entschieden: kein Klarna, keine SEPA-Lastschrift, keine Banküberweisung – die Bestätigung kommt dort erst nach Tagen, die Reservierung hält aber nur 15 Minuten.
5. **Settings → Branding**: Logo und Grün (#A1C74F) für die Bezahlseite.
6. Test: Testkarte 4242 4242 4242 4242, beliebiges Datum in der Zukunft, beliebige drei Ziffern.

## 3. Resend einrichten (Betreiber)

1. Konto bei resend.com anlegen.
2. **Domains → Add domain**: `marschbefehl.com`. Resend zeigt DNS-Einträge (SPF als TXT, DKIM als TXT/CNAME, optional DMARC). Diese Einträge beim Domain-Anbieter eintragen und in Resend „Verify“ drücken.
3. **API Keys → Create**: Schlüssel (re_…) → `RESEND_API_KEY`.
4. Absender `MAIL_ABSENDER` muss auf der bestätigten Domain liegen (Vorgabe `buchung@marschbefehl.com`; das Postfach muss nicht existieren, Antworten gehen an `MAIL_ANTWORT_AN`).

## 4. Netlify-Variablen setzen

Site configuration → Environment variables. Liste und Erklärung in `.env.example`. Pflicht: `FUEHRUNGEN_ADMIN_PASSWORD`, `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, `RESEND_API_KEY`, `MAIL_KOPIE_AN`. Empfohlen: `ADMIN_SITZUNG_GEHEIMNIS` (langer Zufallswert), `RECHNUNG_STEUERNUMMER` sobald vorhanden, `ZELLO_KANAL` und `ZELLO_PASSWORT` sobald der Kanal steht (bis dahin steht in den Mails: „am Treffpunkt“). Scope: alle Deploy-Kontexte (Branch-Deploys brauchen dieselben Werte, im Testmodus mit sk_test).

## 5. Probelauf auf dem Branch-Deploy (vor dem Livegang, Pflicht)

1. ✅ Branch `buchung` gepusht (04.11.2026) → Netlify baut `https://buchung--zeitreise-seelower-hoehen.netlify.app`. Seiten und Functions antworten; Verwaltung meldet „FUEHRUNGEN_ADMIN_PASSWORD fehlt“, Buchen meldet „Zahlung nicht freigeschaltet“ (503) – beides gewollt, solange die Variablen fehlen.
2. ✅ **Variablen gesetzt (04.11.2026 nachmittags):** Doppelklick auf `werkzeug\1 START Netlify-Variablen setzen.cmd` (Desktop-Verknüpfung „Netlify-Variablen setzen“). Die Datei liest das Passwort aus `.env`, setzt es nur für den Kontext `branch:buchung` und dazu `BUCHUNG_BREMSE_JE_STUNDE=1000` für die Prüfläufe. Wichtig: Die Netlify-Anmeldung liegt im AppData der Claude-App, die Startdatei zeigt deshalb mit `APPDATA` dorthin. Nach jedem Setzen braucht der Branch einen neuen Deploy (Claude pusht einen Leer-Commit). Vor dem Livegang dasselbe Skript mit `--alle` für alle Kontexte: `node werkzeug/netlify-variablen-setzen.js --alle`. Stripe- und Resend-Schlüssel kommen von Hand in Netlify, Abschnitt 4.
3. ✅ **Testdaten angelegt (04.11.2026):** Führung „Prüf-Führung (TEST)“ zu 1,00 € je Person mit Termin 13.02.2027 10:00, 20 Plätze (Skript läuft mehrfach ohne Doppelung):
   ```
   node werkzeug/testdaten-anlegen.js https://buchung--zeitreise-seelower-hoehen.netlify.app
   ```
4. **Prüfläufe gegen den Deploy**, weil die Schreibsperre von Netlify Blobs nur dort echt ist:
   ```
   node werkzeug/buchung-pruefen.js https://buchung--zeitreise-seelower-hoehen.netlify.app
   node werkzeug/verwaltung-pruefen.js https://buchung--zeitreise-seelower-hoehen.netlify.app
   ```
   ✅ Stand 04.11.2026 abends: `verwaltung-pruefen` **12 von 12**, `buchung-pruefen` mit Stripe-Testschlüssel **7 von 7** – darunter 6 Buchungen gleichzeitig: alle 6 durch, genau 12 von 20 belegt, nichts verloren, nichts überbucht. **Damit ist die Schreibsperre von Netlify Blobs im Echtbetrieb nachgewiesen.** Die Skripte stornieren ihre Reservierungen am Ende selbst; `verwaltung-pruefen` sperrt zum Schluss den Login für 15 Minuten.
5. ✅ **Testbuchung mit Testkarte (04.11.2026, Nutzer):** ZSH-2026-0007, 1 Person, 1,00 €, Stripe-Webhook kam an, Status „bezahlt“, Rechnung R-2026-0001 erzeugt (PDF abrufbar), Protokoll vollständig (reserviert → Bezahlsitzung → Zahlung eingegangen → Rechnungsnummer). Mail gewollt fehlgeschlagen („RESEND_API_KEY fehlt“, Eintrag im Protokoll) → nach Abschnitt 3 in der Verwaltung „Mail erneut“ drücken. Abgleich „Jetzt abgleichen“ gegen Stripe: **Note „sehr gut“, 0 Abweichungen.** Nach Resend: Testbuchung wiederholen, Mail mit Rechnung im Postfach prüfen.
6. ✅ **Storno mit Erstattung (04.11.2026, Nutzer in der Verwaltung):** ZSH-2026-0007 → Status „erstattet“, Stripe-Erstattung re_…nfto über 1 €, Grund in der Buchung, Platz wieder frei; Storno-Mail gewollt fehlgeschlagen (Resend fehlt). Abgleich danach: „sehr gut“, 0 Abweichungen. Nebenbei wurde die alte Testbuchung „Theo Tester“ (August 2026, Führung „Panzerkampf an der Oder“, Termin 19.09.2026) storniert – Altbestand aus dem ersten Grundgerüst, ohne Zahlung, deshalb keine Erstattung.
7. Stripe → Webhooks: alle Zustellungen 200.

## 6. Livegang

1. Rechtstexte freigegeben: `agb.html` (Stornoregel!), `datenschutz.html` Abschnitt 9, Hinweis „kein Widerrufsrecht“ im Formular, Impressum mit Kleinunternehmer-Hinweis sobald Steuernummer da.
2. Testdaten löschen: Führung „Prüf-Führung (TEST)“ **und die Alt-Führung „Panzerkampf an der Oder“ vom August 2026 (Termin 19.09.2026, Buchung „Theo Tester“)** in der Verwaltung entfernen (Termine zuerst absagen/löschen). Hinweis: Der Rechnungszähler steht dann schon bei R-2026-0001 (Probe-Rechnung); die erste echte Rechnung wird R-2026-0002 – für das Finanzamt in Ordnung, Stornos und Proben dürfen Nummern verbrauchen, die Probe-Rechnung als PDF aufbewahren. Blobs-Stores auf Netlify sind je Site, Branch-Deploy und Produktion teilen sie sich → Testbuchungen vom Branch-Test vor dem Livegang stornieren.
3. Stripe-Konto freischalten (Live), im Live-Konto PayPal und Google Pay aktivieren (Abschnitt 2 Punkt 4), Webhook für die Live-Adresse anlegen, dann die Live-Werte eintragen – für alle Kontexte im Ordner `website`: `node werkzeug/stripe-schluessel-setzen.js --alle` (der Doppelklick auf `2 START …` setzt nur den Branch).
4. `buchung` → `vorschau` → `main` mergen; Deploy abwarten; erste echte Führung in der Verwaltung anlegen.
5. EVENTIM.Light-Konto ruhen lassen (nichts mehr eingebunden).
6. Nach dem ersten echten Termin: Abgleich-Mail und Protokoll ansehen.

## 7. Betrieb

- Verwaltung: `https://marschbefehl.com/fuehrungen-verwaltung.html` (Sitzung 12 h; 5 Fehlversuche → 15 Min Sperre).
- Täglich 06:00 UTC Abgleich; Mail nur bei Abweichungen (Note, TO-DO je Zeile).
- Sicherung: Verwaltung → „Sicherung herunterladen“ (JSON mit allen Buchungen, Terminen, Protokoll); wöchentlich ablegen.
- Passwort wechseln = alle Sitzungen ungültig. Schlüssel nie im Repo, nur in Netlify-Variablen.
- Lokal testen: `npx netlify dev --port 8888` im Ordner `website` (Attrappen für Zahlung und Mail, Ausgang unter `.netlify/mail-ausgang`).
