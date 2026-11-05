// Prüflauf Überweisung (E7, 04.11.2026). Spielt lokal mit der Attrappe den ganzen Weg durch:
// Überweisung gewählt → Platz gehalten → Geld eingegangen → bezahlt + Rechnung; Erinnerung;
// Frist verstrichen → Platz frei + Mail; später Eingang → trotzdem bezahlt; Storno vor Eingang;
// Termin zu nah → keine Überweisung angeboten; Teilnehmerliste kennt den Zustand.
//
// Aufruf (netlify dev läuft auf 8888, ohne STRIPE_SECRET_KEY):
//   node werkzeug/ueberweisung-pruefen.js
// Braucht einen Termin mit mindestens 10 Tagen Vorlauf und 6 freien Plätzen.
// Jeder Prüfpunkt ist getrennt; am Ende Zahl der Fehler, Exit-Code 1 bei Fehlern.

const fs = require('fs');
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });

const BASIS = (process.argv[2] || 'http://localhost:8888').replace(/\/$/, '');
const B = BASIS + '/.netlify/functions/';
const PW = process.env.FUEHRUNGEN_ADMIN_PASSWORD;
if (!PW) { console.error('FUEHRUNGEN_ADMIN_PASSWORD fehlt (Umgebung oder .env).'); process.exit(2); }
const MAILAUSGANG = path.join(__dirname, '..', '.netlify', 'mail-ausgang');

let fehler = 0;
function pruef(name, ok, info) { console.log((ok ? 'OK   ' : 'FEHL ') + name + (info ? '  → ' + info : '')); if (!ok) fehler++; }
async function post(fn, body, headers) {
  const r = await fetch(B + fn, { method: 'POST', headers: { 'content-type': 'application/json', ...(headers || {}) }, body: JSON.stringify(body) });
  const t = await r.text(); let j; try { j = JSON.parse(t); } catch { j = { roh: t }; }
  return { status: r.status, j, setCookie: r.headers.get('set-cookie') || '' };
}
async function get(fn, headers) { const r = await fetch(B + fn, { headers: headers || {} }); const buf = Buffer.from(await r.arrayBuffer()); const t = buf.toString('utf8'); let j; try { j = JSON.parse(t); } catch { j = { roh: t.slice(0, 200) }; } return { status: r.status, j, buf }; }
async function admin(action, extra) { const r = await post('admin-api', { action, password: PW, ...(extra || {}) }); return r.j; }
async function liste() { const l = await admin('list'); if (!l.ok) throw new Error('Verwaltung: ' + (l.error || '?')); return l; }
async function buchung(nr) { return (await liste()).buchungen.find((b) => b.nummer === nr); }
async function protokollZu(nr) { const p = await admin('protokoll'); return (p.eintraege || p.ereignisse || []).filter((e) => e.nummer === nr); }
function mailDateien(nr, stueck) {
  if (!fs.existsSync(MAILAUSGANG)) return [];
  return fs.readdirSync(MAILAUSGANG).filter((f) => f.endsWith('.txt')).filter((f) => { const t = fs.readFileSync(path.join(MAILAUSGANG, f), 'utf8'); return t.includes(nr) && t.includes(stueck); });
}
// Sichtbarer Text eines PDFs (pdf-lib komprimiert die Seiteninhalte): alle Streams entpacken
// und die Klartext-Teile zusammenhängen.
function pdfText(buf) {
  const zlib = require('zlib');
  const s = buf.toString('latin1');
  let aus = '';
  const re = /stream\r?\n([\s\S]*?)\r?\nendstream/g;
  let m;
  while ((m = re.exec(s))) {
    const roh = Buffer.from(m[1], 'latin1');
    let text = '';
    try { text = zlib.inflateSync(roh).toString('latin1'); } catch { text = m[1]; }
    // pdf-lib schreibt Text als Hex-Strings <...> → in Zeichen zurückwandeln
    text = text.replace(/<([0-9A-Fa-f]+)>/g, (_, h) => Buffer.from(h, 'hex').toString('latin1'));
    aus += text + '\n';
  }
  return aus;
}
function tageAb(heute, n) { const d = new Date(heute + 'T12:00:00Z'); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); }
const lauf = Date.now().toString(36);
function gast(n, personen, terminId) {
  return { terminId, name: 'Überweiser ' + lauf + '-' + n, email: 'ueberw-' + lauf + '-' + n + '@example.com', telefon: '0170 100' + n, personen, fahrzeug: 'eigen', agb: true, firma: '' };
}
async function attrappe(nr, s, ergebnis) { return (await post('attrappe-bezahlen', { nr, s, ergebnis })).j; }

(async () => {
  console.log('Prüflauf Überweisung gegen', BASIS);
  const heute = new Date().toISOString().slice(0, 10);
  const l0 = await liste();
  const termin = l0.termine.find((t) => !t.istVergangenheit && t.status !== 'abgesagt' && t.freiePlaetze >= 6 && new Date(t.datumIso) - Date.now() > 10 * 864e5);
  if (!termin) { console.error('Kein Termin mit >= 10 Tagen Vorlauf und 6 freien Plätzen.'); process.exit(2); }
  const T = termin.id;
  const belegtVorher = termin.belegtePersonen;
  console.log('     Termin', termin.datumIso, termin.uhrzeit, '| belegt', belegtVorher, '/', termin.maxPersonen);

  // 1) Buchung A: Zahlarten enthalten Überweisung und Klarna
  let r = await post('buchung-anlegen', gast(1, 2, T));
  pruef('Buchung A angelegt', r.status === 200 && r.j.ok, r.j.error);
  const A = r.j.nummer; const sA = new URL(r.j.url).searchParams.get('s');
  pruef('Zahlarten bei fernem Termin: Überweisung + Klarna dabei', Array.isArray(r.j.zahlungsarten) && r.j.zahlungsarten.includes('customer_balance') && r.j.zahlungsarten.includes('klarna'), JSON.stringify(r.j.zahlungsarten));

  // 2) Überweisung gewählt → Platz gehalten
  let w = await attrappe(A, sA, 'ueberweisung-gewaehlt');
  pruef('Webhook: Überweisung vermerkt', w.ok && w.webhook && w.webhook.hinweis === 'ueberweisung-wartet', JSON.stringify(w.webhook));
  let bA = await buchung(A);
  pruef('Status wartet-ueberweisung', bA && bA.status === 'wartet-ueberweisung', bA && bA.status);
  const fristMs = bA && bA.ueberweisungFrist ? new Date(bA.ueberweisungFrist).getTime() : 0;
  const terminMs = new Date(termin.datumIso + 'T' + termin.uhrzeit + ':00').getTime();
  pruef('Frist: etwa 5 Tage, höchstens bis 3 Tage vor dem Termin', fristMs > Date.now() + 4.9 * 864e5 && fristMs <= Date.now() + 5.1 * 864e5 && fristMs <= terminMs - 3 * 864e5 + 1000, bA && bA.ueberweisungFrist);
  let t1 = (await liste()).termine.find((t) => t.id === T);
  pruef('Platz zählt als belegt (+2)', t1.belegtePersonen === belegtVorher + 2, t1.belegtePersonen + ' / ' + t1.maxPersonen);
  let st = await get('buchung-status?nr=' + A + '&s=' + sA);
  pruef('Danke-Status liefert Überweisungsdaten', st.j.status === 'wartet-ueberweisung' && st.j.ueberweisung && st.j.ueberweisung.iban && st.j.ueberweisung.referenz && st.j.ueberweisung.frist, JSON.stringify(st.j.ueberweisung));
  pruef('Mail „bitte überweisen“ im Ausgang', mailDateien(A, 'Verwendungszweck').length >= 1);
  pruef('Webhook doppelt (schon vermerkt) ändert nichts', (await attrappe(A, sA, 'ueberweisung-gewaehlt')).webhook.hinweis.startsWith('ueberweisung-wartet'));

  // 3) Geld eingegangen → bezahlt + Rechnung + Bestätigung
  w = await attrappe(A, sA, 'ueberweisung-eingegangen');
  pruef('Geldeingang → bezahlt mit Rechnung', w.webhook && w.webhook.hinweis === 'bezahlt' && w.webhook.nach && w.webhook.nach.rechnungsnummer, JSON.stringify(w.webhook));
  bA = await buchung(A);
  pruef('Status bezahlt, Frist bleibt als Verlauf', bA.status === 'bezahlt' && bA.rechnungsnummer, bA.status + ' ' + bA.rechnungsnummer);
  pruef('Bestätigungsmail im Ausgang', mailDateien(A, 'bestätigt und bezahlt').length >= 1);

  // 4) Buchung B: Erinnerung nach 2 Tagen
  r = await post('buchung-anlegen', gast(2, 1, T)); const Bn = r.j.nummer; const sB = new URL(r.j.url).searchParams.get('s');
  await attrappe(Bn, sB, 'ueberweisung-gewaehlt');
  let e = await get('erinnerung?datum=' + tageAb(heute, 1));
  let bB = await buchung(Bn);
  pruef('Erinnerung nach 1 Tag: noch keine', !bB.ueberweisungErinnertAm);
  e = await get('erinnerung?datum=' + tageAb(heute, 2));
  bB = await buchung(Bn);
  pruef('Erinnerung nach 2 Tagen gesendet', !!bB.ueberweisungErinnertAm && mailDateien(Bn, 'noch offen').length >= 1, bB.ueberweisungErinnertAm);
  e = await get('erinnerung?datum=' + tageAb(heute, 3));
  pruef('Erinnerung nur einmal', mailDateien(Bn, 'noch offen').length === 1);

  // 5) Frist verstrichen → Platz frei, Mail, Zahlung abgebrochen
  w = await attrappe(Bn, sB, 'ueberweisung-frist-vorbei');
  pruef('Prüffall Frist vorbei gesetzt', w.ok, JSON.stringify(w));
  await get('aufraeumen');
  bB = await buchung(Bn);
  pruef('Aufräumen → abgelaufen', bB.status === 'abgelaufen', bB.status);
  const pB = await protokollZu(Bn);
  pruef('Protokoll: ueberweisung-verfallen + Zahlung abgebrochen', pB.some((x) => x.art === 'ueberweisung-verfallen') && pB.some((x) => x.art === 'zahlung-abgebrochen'), pB.map((x) => x.art).join(','));
  pruef('Mail „verfallen“ im Ausgang', mailDateien(Bn, 'verfallen').length >= 1);
  t1 = (await liste()).termine.find((t) => t.id === T);
  pruef('Platz wieder frei (nur A belegt)', t1.belegtePersonen === belegtVorher + 2, t1.belegtePersonen + ' / ' + t1.maxPersonen);

  // 6) Geld kommt trotzdem noch → bezahlt (Protokoll zahlung-nach-ablauf)
  w = await attrappe(Bn, sB, 'ueberweisung-eingegangen');
  bB = await buchung(Bn);
  pruef('Später Eingang → trotzdem bezahlt, Protokoll zahlung-nach-ablauf', bB.status === 'bezahlt' && (await protokollZu(Bn)).some((x) => x.art === 'zahlung-nach-ablauf'), bB.status);

  // 7) Buchung C: Storno vor Geldeingang
  r = await post('buchung-anlegen', gast(3, 1, T)); const C = r.j.nummer; const sC = new URL(r.j.url).searchParams.get('s');
  await attrappe(C, sC, 'ueberweisung-gewaehlt');
  const bC0 = await buchung(C);
  const sc = await admin('cancel-buchung', { buchungId: bC0.id, erstatten: false, grund: 'Prüflauf' });
  pruef('Storno vor Eingang → storniert', sc.ok && sc.status === 'storniert', JSON.stringify(sc));
  const pC = await protokollZu(C);
  pruef('Protokoll: offene Zahlung abgebrochen / keine Stripe-Zahlung', pC.some((x) => x.art === 'buchung-storniert' && /abgebrochen|Stripe-Zahlung/.test(x.text || '')), pC.map((x) => x.art + ':' + (x.text || '').slice(0, 40)).join(' | '));
  pruef('Storno-Mail im Ausgang', mailDateien(C, 'storniert').length >= 1);

  // 8) Termin zu nah → keine Überweisung angeboten
  const nah = await admin('create-termin', { fuehrungId: termin.fuehrungId, datumIso: tageAb(heute, 3), uhrzeit: '10:00', maxPersonen: 5 });
  pruef('Naher Prüftermin angelegt (+3 Tage)', nah.ok, nah.error);
  if (nah.ok) {
    r = await post('buchung-anlegen', gast(4, 1, nah.termin.id)); const D = r.j.nummer;
    pruef('Zahlarten bei nahem Termin: ohne Überweisung, mit Karte/Klarna', Array.isArray(r.j.zahlungsarten) && !r.j.zahlungsarten.includes('customer_balance') && r.j.zahlungsarten.includes('card'), JSON.stringify(r.j.zahlungsarten));
    const bD = await buchung(D);
    await admin('cancel-buchung', { buchungId: bD.id, erstatten: false, grund: 'Prüflauf' });
    const del = await admin('delete-termin', { terminId: nah.termin.id });
    pruef('Naher Prüftermin wieder gelöscht', del.ok, del.error);
  }

  // 9) Teilnehmerliste kennt „Überweisung offen“
  r = await post('buchung-anlegen', gast(5, 1, T)); const E = r.j.nummer; const sE = new URL(r.j.url).searchParams.get('s');
  await attrappe(E, sE, 'ueberweisung-gewaehlt');
  const login = await post('admin-api', { action: 'login', password: PW });
  const cookie = (login.setCookie || '').split(';')[0];
  const tl = await get('teilnehmerliste?terminId=' + T, { cookie });
  pruef('Teilnehmerliste mit offener Überweisung als PDF', tl.status === 200 && tl.buf.length > 1000, tl.status + ' ' + tl.buf.length + ' Bytes');
  pruef('Teilnehmerliste zeigt „ÜBERW. OFFEN“', pdfText(tl.buf).includes('BERW. OFFEN'));

  // Aufräumen: alles stornieren, Platzstand wie vorher
  for (const nr of [A, Bn, E]) { const b = await buchung(nr); if (b && ['bezahlt', 'wartet-ueberweisung', 'pruefen', 'reserviert'].includes(b.status)) await admin('cancel-buchung', { buchungId: b.id, erstatten: b.status === 'bezahlt', grund: 'Prüflauf Ende' }); }
  t1 = (await liste()).termine.find((t) => t.id === T);
  pruef('Platzstand wie vor dem Lauf', t1.belegtePersonen === belegtVorher, t1.belegtePersonen + ' (vorher ' + belegtVorher + ')');

  console.log('');
  console.log(fehler === 0 ? 'ALLE PRÜFPUNKTE BESTANDEN' : fehler + ' PRÜFPUNKT(E) FEHLGESCHLAGEN');
  process.exit(fehler === 0 ? 0 : 1);
})().catch((e) => { console.error('ABBRUCH:', e.message); process.exit(1); });
