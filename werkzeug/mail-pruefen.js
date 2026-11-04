// Prüflauf Mails + Rechnung (E3): Buchung → Zahlung (Attrappe) → Rechnung + Bestätigungsmail →
// Erinnerung → Mail erneut. Nur lokal (netlify dev, Mail-Attrappe schreibt nach .netlify/mail-ausgang).
//   node werkzeug/mail-pruefen.js
// Passwort aus FUEHRUNGEN_ADMIN_PASSWORD (.env). Braucht einen Termin mit mindestens 2 freien Plätzen.
const fs = require('fs');
const path = require('path');
const B = 'http://localhost:8888/.netlify/functions/';
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });
const PW = process.env.FUEHRUNGEN_ADMIN_PASSWORD;
if (!PW) { console.error('FUEHRUNGEN_ADMIN_PASSWORD fehlt (.env).'); process.exit(2); }
const AUSGANG = path.join(__dirname, '..', '.netlify', 'mail-ausgang');
let fehler = 0;
function pruef(name, ok, info) { console.log((ok ? 'OK   ' : 'FEHL ') + name + (info ? '  → ' + info : '')); if (!ok) fehler++; }
async function post(fn, body) { const r = await fetch(B + fn, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }); const t = await r.text(); let j; try { j = JSON.parse(t); } catch { j = { roh: t }; } return { status: r.status, j }; }
async function get(fn) { const r = await fetch(B + fn); const t = await r.text(); let j; try { j = JSON.parse(t); } catch { j = { roh: t }; } return { status: r.status, j, headers: r.headers }; }
function dateien() { try { return fs.readdirSync(AUSGANG); } catch { return []; } }

(async () => {
  const liste = (await post('admin-api', { action: 'list', password: PW })).j;
  const termin = liste.termine.find((t) => !t.istVergangenheit && t.freiePlaetze >= 2);
  console.log('     Termin', termin.datumIso, '| frei', termin.freiePlaetze);
  const vorher = new Set(dateien());

  // 1) Buchen + zahlen
  const b = await post('buchung-anlegen', { terminId: termin.id, name: 'Mail Prüfgast', email: 'mail-pruef@example.com', telefon: '0170 9999999', personen: 2, fahrzeug: 'eigen', agb: true, firma: '' });
  pruef('Buchung angelegt', b.status === 200, b.j.nummer);
  const s = new URL(b.j.url).searchParams.get('s');
  const z = await post('attrappe-bezahlen', { nr: b.j.nummer, s, ergebnis: 'bezahlt' });
  pruef('Zahlung → Webhook bezahlt', z.j.webhook && z.j.webhook.hinweis === 'bezahlt', JSON.stringify(z.j.webhook));
  pruef('Nachbereitung: Rechnung + Mail', z.j.webhook && z.j.webhook.nach && z.j.webhook.nach.ok && /^R-\d{4}-\d{4}$/.test(z.j.webhook.nach.rechnungsnummer), JSON.stringify(z.j.webhook && z.j.webhook.nach));
  const rnr = z.j.webhook.nach.rechnungsnummer;

  // 2) Status liefert Rechnungsnummer
  const st = await get('buchung-status?nr=' + b.j.nummer + '&s=' + s);
  pruef('Status mit Rechnungsnummer', st.j.status === 'bezahlt' && st.j.rechnungsnummer === rnr, st.j.rechnungsnummer);

  // 3) Rechnungs-PDF abrufbar
  const r = await fetch(B + 'rechnung-pdf?nr=' + b.j.nummer + '&s=' + s);
  const buf = Buffer.from(await r.arrayBuffer());
  pruef('Rechnungs-PDF abrufbar', r.status === 200 && r.headers.get('content-type') === 'application/pdf' && buf.slice(0, 4).toString() === '%PDF', r.status + ' ' + r.headers.get('content-type') + ' ' + buf.length + ' Bytes');
  fs.writeFileSync(path.join(AUSGANG, 'abruf_Rechnung-' + rnr + '.pdf'), buf);
  const r2 = await fetch(B + 'rechnung-pdf?nr=' + b.j.nummer + '&s=cs_attrappe_000000000000');
  pruef('Rechnung ohne passende Sitzung → 404', r2.status === 404);

  // 4) Mail-Attrappe: Dateien im Ausgang (Bestätigung + Kopie, falls MAIL_KOPIE_AN gesetzt)
  const neu = dateien().filter((d) => !vorher.has(d));
  const best = neu.filter((d) => d.includes('bestaetigt'));
  pruef('Bestätigungsmail im Ausgang (html, txt, json, pdf)', best.some((d) => d.endsWith('.html')) && best.some((d) => d.endsWith('.txt')) && best.some((d) => d.endsWith('.pdf')), best.join(', '));
  const txt = best.find((d) => d.endsWith('.txt'));
  const inhalt = txt ? fs.readFileSync(path.join(AUSGANG, txt), 'utf8') : '';
  pruef('Mailtext enthält Nummer, Termin, Treffpunkt, Rechnung', inhalt.includes(b.j.nummer) && inhalt.includes('Treffpunkt') && inhalt.includes(rnr) && inhalt.includes('An: mail-pruef@example.com'));

  pruef('Bestätigungsmail enthält die ganze Zello-Anleitung', inhalt.includes('Führung im Auto hören') && inhalt.includes('Vor der Tour') && inhalt.includes('Am Treffpunkt') && inhalt.includes('Während der Fahrt') && inhalt.includes('Hört nichts?') && inhalt.includes('Funkprobe'));
  const anhang = best.find((d) => d.endsWith('Fuehrung-im-Auto-hoeren-Zello.pdf'));
  pruef('Bestätigungsmail hat Rechnung + Zello-PDF', !!anhang && fs.readFileSync(path.join(AUSGANG, anhang)).slice(0, 4).toString() === '%PDF' && best.some((d) => d.endsWith('Rechnung-' + rnr + '.pdf')), anhang);

  // 5) Erneute Zahlungsmeldung → keine zweite Mail, gleiche Rechnungsnummer
  const vor2 = dateien().length;
  const z2 = await post('attrappe-bezahlen', { nr: b.j.nummer, s, ergebnis: 'bezahlt' });
  pruef('Zweite Zahlungsmeldung → schon bezahlt, keine neue Mail', z2.j.webhook.hinweis === 'schon bezahlt' && dateien().length === vor2);

  // 6) Mail erneut senden (Verwaltung) → neue Mail, gleiche Rechnungsnummer
  const liste2 = (await post('admin-api', { action: 'list', password: PW })).j;
  const bu = liste2.buchungen.find((x) => x.nummer === b.j.nummer);
  pruef('Verwaltung zeigt Rechnungsnummer + Mailzeit', bu.rechnungsnummer === rnr && !!bu.mailBestaetigungAm);
  const vor3 = dateien().length;
  const me = await post('admin-api', { action: 'mail-erneut', password: PW, buchungId: bu.id });
  pruef('Mail erneut → gesendet, gleiche Rechnungsnummer', me.j.ok && me.j.rechnungsnummer === rnr && dateien().length > vor3, JSON.stringify(me.j));

  // 7) Erinnerung: 3 Tage vor dem Termin (Antwort der CLI ist Text, Ergebnis über Dateien + Verwaltung prüfen)
  const heute = new Date(termin.datumIso + 'T12:00:00Z'); heute.setUTCDate(heute.getUTCDate() - 3);
  const datum = heute.toISOString().slice(0, 10);
  const anzErinn = () => dateien().filter((d) => d.includes('erinnerung') && d.endsWith('.txt')).length;
  const v0 = anzErinn();
  await fetch(B + 'erinnerung?datum=' + datum);
  const v1 = anzErinn();
  pruef('Erinnerung sendet an die neue bezahlte Buchung', v1 === v0 + 1, v0 + ' → ' + v1);
  const bu2 = (await post('admin-api', { action: 'list', password: PW })).j.buchungen.find((x) => x.nummer === b.j.nummer);
  pruef('Verwaltung zeigt erinnertAm', !!bu2.erinnertAm, bu2.erinnertAm);
  await fetch(B + 'erinnerung?datum=' + datum);
  pruef('Erinnerung ein zweites Mal → keine neue Mail', anzErinn() === v1);
  await fetch(B + 'erinnerung?datum=2020-01-01');
  pruef('Erinnerung an anderem Tag → keine Mail', anzErinn() === v1);
  const erinn = dateien().filter((d) => d.includes('erinnerung') && d.endsWith('.txt'));
  const et = erinn.length ? fs.readFileSync(path.join(AUSGANG, erinn[erinn.length - 1]), 'utf8') : '';
  pruef('Erinnerungstext enthält Treffpunkt und Uhrzeit', et.includes('Treffpunkt') && et.includes(termin.uhrzeit), erinn[erinn.length - 1]);
  pruef('Erinnerung enthält Zello-Anleitung + PDF', et.includes('Führung im Auto hören') && et.includes('Funkprobe') && dateien().some((d) => d.includes('erinnerung') && d.endsWith('Fuehrung-im-Auto-hoeren-Zello.pdf')));

  console.log('     Mail-Ausgang:', AUSGANG, '(' + dateien().length + ' Dateien)');
  console.log(fehler === 0 ? '\nALLE PRÜFPUNKTE BESTANDEN' : '\n' + fehler + ' PRÜFPUNKT(E) FEHLGESCHLAGEN');
  process.exit(fehler === 0 ? 0 : 1);
})().catch((e) => { console.error('ABBRUCH:', e); process.exit(2); });
