# Buchungssystem marschbefehl.com – Einrichtung und Livegang

Stand 03.11.2026. Das Buchungssystem (Branch `buchung`) ist fertig gebaut und lokal mit Attrappen für Zahlung und Mail durchgespielt. Dieses Blatt führt Schritt für Schritt vom lokalen Stand zum Livegang. Alles, was ein Konto oder einen Schlüssel braucht, muss der Betreiber selbst anlegen.

## 1. Was läuft wo

| Baustein | Lösung | Kosten |
|---|---|---|
| Seiten + Functions | Netlify (Site `zeitreise-seelower-hoehen`) | frei |
| Daten | Netlify Blobs, Stores `fuehrungen` (Buchungen, Termine, Protokoll), `fuehrungen-bilder`, `fuehrungen-rechnungen` | frei |
| Zahlung | Stripe Checkout + Webhook | nur je Zahlung (ca. 1,5 % + 0,25 €) |
| Mail | Resend | frei bis 3.000 Mails/Monat |
| Zeitgesteuert | Netlify Scheduled Functions: `aufraeumen` alle 10 Min, `erinnerung` 07:00 UTC, `abgleich` 06:00 UTC | frei |

## 2. Stripe einrichten (Betreiber)

1. Konto bei stripe.com anlegen (Gewerbe, IBAN, Ausweis). Für den Testmodus reicht die Anmeldung.
2. **Developers → API keys**: `Secret key` (sk_test_… / später sk_live_…) → Netlify-Variable `STRIPE_SECRET_KEY`.
3. **Developers → Webhooks → Add endpoint**: Adresse `https://marschbefehl.com/.netlify/functions/stripe-webhook` (für den Branch-Test: `https://buchung--zeitreise-seelower-hoehen.netlify.app/.netlify/functions/stripe-webhook`). Ereignisse: `checkout.session.completed`, `checkout.session.async_payment_succeeded`, `checkout.session.async_payment_failed`, `checkout.session.expired`. Den angezeigten `Signing secret` (whsec_…) → `STRIPE_WEBHOOK_SECRET`.
4. **Settings → Payment methods**: Karten, Apple Pay, Google Pay an; PayPal aktivieren, falls für das Konto angeboten; SEPA-Lastschrift aus lassen (Zahlung muss sofort bestätigt sein).
5. **Settings → Branding**: Logo und Grün (#A1C74F) für die Bezahlseite.
6. Test: Testkarte 4242 4242 4242 4242, beliebiges Datum in der Zukunft, beliebige drei Ziffern.

## 3. Resend einrichten (Betreiber)

1. Konto bei resend.com anlegen.
2. **Domains → Add domain**: `marschbefehl.com`. Resend zeigt DNS-Einträge (SPF als TXT, DKIM als TXT/CNAME, optional DMARC). Diese Einträge beim Domain-Anbieter eintragen und in Resend „Verify“ drücken.
3. **API Keys → Create**: Schlüssel (re_…) → `RESEND_API_KEY`.
4. Absender `MAIL_ABSENDER` muss auf der bestätigten Domain liegen (Vorgabe `buchung@marschbefehl.com`; das Postfach muss nicht existieren, Antworten gehen an `MAIL_ANTWORT_AN`).

## 4. Netlify-Variablen setzen

Site configuration → Environment variables. Liste und Erklärung in `.env.example`. Pflicht: `FUEHRUNGEN_ADMIN_PASSWORD`, `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, `RESEND_API_KEY`, `MAIL_KOPIE_AN`. Empfohlen: `ADMIN_SITZUNG_GEHEIMNIS` (langer Zufallswert), `RECHNUNG_STEUERNUMMER` sobald vorhanden. Scope: alle Deploy-Kontexte (Branch-Deploys brauchen dieselben Werte, im Testmodus mit sk_test).

## 5. Probelauf auf dem Branch-Deploy (vor dem Livegang, Pflicht)

1. Branch `buchung` pushen → Netlify baut `https://buchung--zeitreise-seelower-hoehen.netlify.app`.
2. Mit Stripe-Testschlüsseln: eine Testbuchung mit Testkarte komplett durchspielen (Buchen → Bezahlseite → Danke-Seite „bestätigt“ → Mail mit Rechnung im echten Postfach).
3. Prüfläufe gegen den Deploy, weil die Schreibsperre von Netlify Blobs nur dort echt ist:
   ```
   node werkzeug/buchung-pruefen.js https://buchung--zeitreise-seelower-hoehen.netlify.app
   node werkzeug/verwaltung-pruefen.js https://buchung--zeitreise-seelower-hoehen.netlify.app
   ```
   (Passwort aus `.env`; die Zahlungs-Prüfpunkte überspringt das Skript dort, weil es keine Attrappe gibt. Es storniert seine Reservierungen am Ende selbst.)
4. In der Verwaltung: Termin anlegen, Teilnehmerliste öffnen, Storno mit Erstattung an einer Testbuchung (Erstattung im Stripe-Dashboard sichtbar), „Jetzt abgleichen“ → Note „sehr gut“.
5. Stripe → Webhooks: alle Zustellungen 200.

## 6. Livegang

1. Rechtstexte freigegeben: `agb.html` (Stornoregel!), `datenschutz.html` Abschnitt 9, Hinweis „kein Widerrufsrecht“ im Formular, Impressum mit Kleinunternehmer-Hinweis sobald Steuernummer da.
2. Testdaten löschen: Führung „… (TEST)“ und Prüf-Führungen in der Verwaltung entfernen (Termine zuerst absagen/löschen). Blobs-Stores auf Netlify sind je Site, Branch-Deploy und Produktion teilen sie sich → Testbuchungen vom Branch-Test vor dem Livegang stornieren.
3. Stripe-Konto freischalten (Live), `STRIPE_SECRET_KEY` auf sk_live, Webhook für die Live-Adresse anlegen, `STRIPE_WEBHOOK_SECRET` tauschen.
4. `buchung` → `vorschau` → `main` mergen; Deploy abwarten; erste echte Führung in der Verwaltung anlegen.
5. EVENTIM.Light-Konto ruhen lassen (nichts mehr eingebunden).
6. Nach dem ersten echten Termin: Abgleich-Mail und Protokoll ansehen.

## 7. Betrieb

- Verwaltung: `https://marschbefehl.com/fuehrungen-verwaltung.html` (Sitzung 12 h; 5 Fehlversuche → 15 Min Sperre).
- Täglich 06:00 UTC Abgleich; Mail nur bei Abweichungen (Note, TO-DO je Zeile).
- Sicherung: Verwaltung → „Sicherung herunterladen“ (JSON mit allen Buchungen, Terminen, Protokoll); wöchentlich ablegen.
- Passwort wechseln = alle Sitzungen ungültig. Schlüssel nie im Repo, nur in Netlify-Variablen.
- Lokal testen: `npx netlify dev --port 8888` im Ordner `website` (Attrappen für Zahlung und Mail, Ausgang unter `.netlify/mail-ausgang`).
