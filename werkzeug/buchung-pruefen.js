// Prüflauf für das Buchungssystem (E2). Spielt den echten Ablauf gegen einen laufenden
// Server durch: Eingabeprüfung, gleichzeitige Buchungen, Abbruch, falscher Betrag,
// doppelte und gefälschte Webhook-Meldungen, Statusabfrage, Aufräumen, Storno.
//
// Aufruf (lokal, netlify dev läuft auf 8888):
//   node werkzeug/buchung-pruefen.js
// Gegen den Branch-Deploy (dort gibt es keine Attrappe, Zahlungs-Prüfpunkte werden übersprungen):
//   node werkzeug/buchung-pruefen.js https://buchung--zeitreise-seelower-hoehen.netlify.app
//
// Das Verwaltungs-Passwort kommt aus FUEHRUNGEN_ADMIN_PASSWORD (Umgebung oder .env).
// Es wird ein Termin mit mindestens 8 freien Plätzen gebraucht (erster passender wird genommen).
// Jeder Prüfpunkt ist getrennt; am Ende steht die Zahl der Fehler, Exit-Code 1 bei Fehlern.

const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });
const Stripe = require('stripe');

const BASIS = (process.argv[2] || 'http://localhost:8888').replace(/\/$/, '');
const B = BASIS + '/.netlify/functions/';
const PW = process.env.FUEHRUNGEN_ADMIN_PASSWORD;
const LOKAL = /localhost|127\.0\.0\.1/.test(BASIS);
if (!PW) { console.error('FUEHRUNGEN_ADMIN_PASSWORD fehlt (Umgebung oder .env).'); process.exit(2); }

let fehler = 0;
function pruef(name, ok, info) { console.log((ok ? 'OK   ' : 'FEHL ') + name + (info ? '  → ' + info : '')); if (!ok) fehler++; }
async function post(fn, body, headers) {
  const r = await fetch(B + fn, { method: 'POST', headers: { 'content-type': 'application/json', ...(headers || {}) }, body: typeof body === 'string' ? body : JSON.stringify(body) });
  let j; const t = await r.text(); try { j = JSON.parse(t); } catch { j = { roh: t }; }
  return { status: r.status, j };
}
async function get(fn) { const r = await fetch(B + fn); return { status: r.status, j: await r.json() }; }
async function adminListe() { const r = await post('admin-api', { action: 'list', password: PW }); if (!r.j.ok) throw new Error('Verwaltung: ' + (r.j.error || r.status)); return r.j; }
const lauf = Date.now().toString(36);
function gast(n, personen, terminId) {
  return { terminId, name: 'Prüfgast ' + lauf + '-' + n, email: 'pruef-' + lauf + '-' + n + '@example.com', telefon: '0170 000' + n, personen, fahrzeug: 'eigen', agb: true, firma: '' };
}

(async () => {
  console.log('Prüflauf gegen', BASIS, LOKAL ? '(lokal, mit Zahlungs-Attrappe)' : '(ohne Attrappe)');
  let liste = await adminListe();
  const termin = liste.termine.find((t) => !t.istVergangenheit && t.freiePlaetze >= 8);
  if (!termin) { console.error('Kein Termin mit mindestens 8 freien Plätzen. Bitte einen Testtermin anlegen.'); process.exit(2); }
  const T = termin.id;
  console.log('     Termin', termin.datumIso, termin.uhrzeit, '| frei:', termin.freiePlaetze);

  // 1) Eingabeprüfung
  let r = await post('buchung-anlegen', { ...gast(1, 1, T), agb: false });
  pruef('AGB-Haken Pflicht', r.status === 400, r.j.error);
  r = await post('buchung-anlegen', { ...gast(1, 1, T), telefon: '' });
  pruef('Telefon Pflicht', r.status === 400, r.j.error);
  r = await post('buchung-anlegen', { ...gast(1, 1, T), firma: 'Spam GmbH' });
  pruef('Honigtopf: Schein-Antwort ohne Buchung', r.status === 200 && r.j.nummer === 'ZSH-0000-0000');

  // 2) Überbuchung in einem Aufruf
  const freiVorher = termin.freiePlaetze;
  r = await post('buchung-anlegen', gast(2, freiVorher + 1, T));
  pruef('Zu viele Personen → 409', r.status === 409, r.j.error);

  // 3) Gleichzeitige Buchungen: 6 × 2 Personen
  const parallel = await Promise.all([1, 2, 3, 4, 5, 6].map((i) => post('buchung-anlegen', gast(10 + i, 2, T))));
  const okAnz = parallel.filter((x) => x.status === 200).length;
  const erwartet = Math.min(6, Math.floor(freiVorher / 2));
  pruef('Gleichzeitig: genau ' + erwartet + ' von 6 kommen durch', okAnz === erwartet, okAnz + ' durchgekommen; Antworten: ' + parallel.map((x) => x.status).join(','));
  liste = await adminListe();
  let t2 = liste.termine.find((t) => t.id === T);
  pruef('Kein Überbuchen', t2.belegtePersonen <= t2.maxPersonen, t2.belegtePersonen + '/' + t2.maxPersonen);
  const durch = parallel.filter((x) => x.status === 200).map((x) => x.j);
  const sess = (b) => new URL(b.url).searchParams.get('s');

  if (LOKAL && durch.length >= 3) {
    // 4) Abbruch → abgelaufen
    r = await post('attrappe-bezahlen', { nr: durch[0].nummer, s: sess(durch[0]), ergebnis: 'abgebrochen' });
    let st = await get('buchung-status?nr=' + durch[0].nummer + '&s=' + sess(durch[0]));
    pruef('Abbruch → Status abgelaufen', st.j.status === 'abgelaufen', st.j.status);

    // 5) Falscher Betrag → pruefen
    r = await post('attrappe-bezahlen', { nr: durch[1].nummer, s: sess(durch[1]), ergebnis: 'betrag-falsch' });
    st = await get('buchung-status?nr=' + durch[1].nummer + '&s=' + sess(durch[1]));
    pruef('Falscher Betrag → Status pruefen', st.j.status === 'pruefen', st.j.status);

    // 6) Webhook: gleiche Ereignis-ID zweimal, falsche Signatur, fremde Sitzung
    const stripe = new Stripe('sk_test_attrappe');
    const b3 = (await adminListe()).buchungen.find((b) => b.nummer === durch[2].nummer);
    const s3 = sess(durch[2]);
    const EID = 'evt_pruef_' + lauf;
    const payload = JSON.stringify({ id: EID, object: 'event', type: 'checkout.session.completed', data: { object: { id: s3, object: 'checkout.session', payment_status: 'paid', amount_total: b3.betragCent, currency: 'eur', payment_intent: 'pi_pruef_' + lauf, metadata: { buchungId: b3.id, nummer: b3.nummer } } } });
    const header = stripe.webhooks.generateTestHeaderString({ payload, secret: 'whsec_attrappe_nur_lokal' });
    const w1 = await post('stripe-webhook', payload, { 'stripe-signature': header });
    const w2 = await post('stripe-webhook', payload, { 'stripe-signature': header });
    pruef('Webhook 1. Mal → bezahlt', w1.status === 200 && w1.j.hinweis === 'bezahlt', JSON.stringify(w1.j));
    pruef('Webhook 2. Mal (gleiche ID) → schon verarbeitet', w2.status === 200 && w2.j.hinweis === 'schon verarbeitet', JSON.stringify(w2.j));
    const w3 = await post('stripe-webhook', payload, { 'stripe-signature': 't=1,v1=falsch' });
    pruef('Webhook falsche Signatur → 400', w3.status === 400);
    const payloadFremd = payload.replace(s3, 'cs_attrappe_fremd000000000000').replace(EID, 'evt_fremd_' + lauf);
    const headerFremd = stripe.webhooks.generateTestHeaderString({ payload: payloadFremd, secret: 'whsec_attrappe_nur_lokal' });
    const w4 = await post('stripe-webhook', payloadFremd, { 'stripe-signature': headerFremd });
    pruef('Webhook mit fremder Sitzungs-ID → abgewiesen', w4.j.hinweis === 'Sitzung passt nicht zur Buchung', JSON.stringify(w4.j));

    // 7) Status ohne passende Sitzung
    st = await get('buchung-status?nr=' + durch[2].nummer + '&s=cs_attrappe_000000000000');
    pruef('Status mit falscher Sitzung → 404', st.status === 404);

    // 8) Storno einer bezahlten Buchung
    r = await post('admin-api', { action: 'cancel-buchung', password: PW, buchungId: b3.id });
    pruef('Storno → Status storniert', r.j.ok && r.j.status === 'storniert', JSON.stringify(r.j));
    r = await post('admin-api', { action: 'cancel-buchung', password: PW, buchungId: b3.id });
    pruef('Storno doppelt → abgewiesen', r.status === 400, r.j.error);
  } else if (!LOKAL) {
    console.log('     (Zahlungs-Prüfpunkte übersprungen: keine Attrappe auf dem Deploy; Webhook ohne Signatur prüfen)');
    const w3 = await post('stripe-webhook', '{}', { 'stripe-signature': 't=1,v1=falsch' });
    pruef('Webhook falsche Signatur → 400', w3.status === 400);
    // Reservierungen wieder freigeben (Storno), damit der Termin nicht blockiert bleibt
    const bl = (await adminListe()).buchungen;
    for (const d of durch) {
      const b = bl.find((x) => x.nummer === d.nummer);
      if (b) await post('admin-api', { action: 'cancel-buchung', password: PW, buchungId: b.id });
    }
    console.log('     Reservierungen des Prüflaufs storniert');
  }

  // 9) Aufräumen
  const vor = (await adminListe()).buchungen.filter((b) => b.status === 'reserviert' && new Date(b.reserviertBis) < new Date()).length;
  if (LOKAL) {
    // Zeitgesteuerte Function: lokal per HTTP auslösbar (Antwort ist Text, nicht JSON).
    await fetch(B + 'aufraeumen');
    const nach = (await adminListe()).buchungen.filter((b) => b.status === 'reserviert' && new Date(b.reserviertBis) < new Date()).length;
    pruef('Aufräumen: ' + vor + ' abgelaufene Reservierung(en) freigegeben', nach === 0, 'vorher ' + vor + ', nachher ' + nach);
  }

  liste = await adminListe();
  t2 = liste.termine.find((t) => t.id === T);
  console.log('     Stand Termin: belegt', t2.belegtePersonen, 'von', t2.maxPersonen);
  console.log(fehler === 0 ? '\nALLE PRÜFPUNKTE BESTANDEN' : '\n' + fehler + ' PRÜFPUNKT(E) FEHLGESCHLAGEN');
  process.exit(fehler === 0 ? 0 : 1);
})().catch((e) => { console.error('ABBRUCH:', e.message || e); process.exit(2); });
