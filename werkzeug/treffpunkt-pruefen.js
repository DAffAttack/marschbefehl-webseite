// Prüflauf genauer Treffpunkt: Die Adresse steht nur in Mails, Rechnung und Verwaltung, nie in
// öffentlichen Antworten. Nur lokal (netlify dev mit Zahlungs- und Mail-Attrappe):
//   node werkzeug/treffpunkt-pruefen.js
// Legt eigene Test-Führungen an, die übrigen Testdaten bleiben unberührt.

const fs = require('fs');
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });
const B = 'http://localhost:8888/.netlify/functions/';
const PW = process.env.FUEHRUNGEN_ADMIN_PASSWORD;
if (!PW) { console.error('FUEHRUNGEN_ADMIN_PASSWORD fehlt (.env).'); process.exit(2); }
const AUSGANG = path.join(__dirname, '..', '.netlify', 'mail-ausgang');
let fehler = 0;
function pruef(name, ok, info) { console.log((ok ? 'OK   ' : 'FEHL ') + name + (info ? '  → ' + info : '')); if (!ok) fehler++; }
async function post(fn, body) { const r = await fetch(B + fn, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }); const t = await r.text(); let j; try { j = JSON.parse(t); } catch { j = { roh: t }; } return { status: r.status, j, roh: t }; }
async function roh(fn) { const r = await fetch(B + fn); return { status: r.status, text: await r.text() }; }
async function admin(action, body) { return post('admin-api', { action, password: PW, ...(body || {}) }); }
const dateien = () => { try { return fs.readdirSync(AUSGANG); } catch { return []; } };
const lauf = Date.now().toString(36);
const GEHEIM = 'Geheimer Treffpunkt ' + lauf + ', 15306 Seelow';

(async () => {
  const bild = (await admin('list')).j.fuehrungen[0];
  const basis = { kurzbeschreibung: 'nur Prüflauf', langbeschreibung: 'nur Prüflauf', preisProPerson: 30, bildUebersichtId: bild.bildUebersichtId, bildDetailId: bild.bildDetailId };

  // 1) Führung mit genauem Treffpunkt
  const f = await admin('create-fuehrung', { ...basis, titel: 'Treffpunkt-Prüfung ' + lauf, ort: 'Raum Seelow', treffpunkt: GEHEIM });
  pruef('Führung mit Treffpunkt angelegt', f.j.ok && f.j.fuehrung.treffpunkt === GEHEIM);
  const fId = f.j.fuehrung.id;
  const t = (await admin('create-termin', { fuehrungId: fId, datumIso: '2027-04-10', uhrzeit: '09:00', maxPersonen: 10 })).j.termin;

  // 2) Öffentliche Wege dürfen die Adresse nicht enthalten
  const liste = await roh('fuehrungen-oeffentlich');
  pruef('Öffentliche Liste ohne Adresse', liste.status === 200 && !liste.text.includes(lauf + ',') && !liste.text.includes('Geheimer'));
  const detail = await roh('fuehrungen-oeffentlich?id=' + fId);
  const dj = JSON.parse(detail.text);
  pruef('Öffentliches Detail ohne Adresse', detail.status === 200 && !detail.text.includes('Geheimer') && !('treffpunkt' in dj.fuehrung));
  pruef('Öffentliches Detail: Ort + Hinweis', dj.fuehrung.ort === 'Raum Seelow' && dj.fuehrung.treffpunktNachBuchung === true);
  const termine = await roh('termine-oeffentlich?fuehrungId=' + fId);
  pruef('Öffentliche Termine ohne Adresse', termine.status === 200 && !termine.text.includes('Geheimer'), 'Status ' + termine.status);

  // 3) Buchung: Antworten ohne Adresse, Mail mit Adresse
  const b = await post('buchung-anlegen', { terminId: t.id, name: 'Treffpunkt Prüfgast', email: 'treffpunkt-' + lauf + '@example.com', telefon: '0170 1234', personen: 1, fahrzeug: 'eigen', agb: true, firma: '' });
  pruef('Buchung angelegt, Antwort ohne Adresse', b.status === 200 && !b.roh.includes('Geheimer'), b.j.nummer);
  const s = new URL(b.j.url).searchParams.get('s');
  const z = await post('attrappe-bezahlen', { nr: b.j.nummer, s, ergebnis: 'bezahlt' });
  pruef('Bezahlt', z.j.webhook && z.j.webhook.hinweis === 'bezahlt');
  const status = await roh('buchung-status?nr=' + b.j.nummer + '&s=' + s);
  pruef('Buchungsstatus ohne Adresse', status.status === 200 && !status.text.includes('Geheimer'));
  const nr = b.j.nummer.toLowerCase();
  const best = dateien().filter((d) => d.includes(nr) && d.endsWith('.txt'));
  const txt = best.length ? fs.readFileSync(path.join(AUSGANG, best[best.length - 1]), 'utf8') : '';
  pruef('Bestätigung nennt die genaue Adresse', txt.includes('Treffpunkt: ' + GEHEIM), best[best.length - 1]);
  const html = fs.readFileSync(path.join(AUSGANG, best[best.length - 1].replace(/\.txt$/, '.html')), 'utf8');
  pruef('Bestätigung als HTML nennt die Adresse', html.includes(GEHEIM));

  // 4) Erinnerung
  await fetch(B + 'erinnerung?datum=2027-04-07');
  const erinn = dateien().filter((d) => d.includes('erinnerung') && d.endsWith('.txt')).map((d) => fs.readFileSync(path.join(AUSGANG, d), 'utf8'));
  pruef('Erinnerung nennt die genaue Adresse', erinn.some((e) => e.includes('treffpunkt-' + lauf + '@example.com') && e.includes(GEHEIM)));

  // 5) Verwaltung: Anzeige, Bearbeiten ohne Feld behält den Wert, Leeren
  const inListe = () => admin('list').then((r) => r.j.fuehrungen.find((x) => x.id === fId));
  pruef('Verwaltung zeigt die Adresse', (await inListe()).treffpunkt === GEHEIM);
  await admin('edit-fuehrung', { ...basis, fuehrungId: fId, titel: 'Treffpunkt-Prüfung ' + lauf, ort: 'Raum Seelow' });
  pruef('Bearbeiten ohne Feld behält die Adresse', (await inListe()).treffpunkt === GEHEIM);
  await admin('edit-fuehrung', { ...basis, fuehrungId: fId, titel: 'Treffpunkt-Prüfung ' + lauf, ort: 'Raum Seelow', treffpunkt: '' });
  pruef('Leeres Feld löscht die Adresse', (await inListe()).treffpunkt === '');
  const zuLang = await admin('edit-fuehrung', { ...basis, fuehrungId: fId, titel: 'Treffpunkt-Prüfung ' + lauf, ort: 'Raum Seelow', treffpunkt: 'x'.repeat(500) });
  pruef('Zu langer Treffpunkt → abgewiesen', zuLang.status === 400, zuLang.j.error);

  // 6) Führung ohne genauen Treffpunkt verhält sich wie bisher
  const alt = await admin('create-fuehrung', { ...basis, titel: 'Ohne Treffpunkt ' + lauf, ort: 'Öffentlicher Platz ' + lauf });
  const altD = JSON.parse((await roh('fuehrungen-oeffentlich?id=' + alt.j.fuehrung.id)).text);
  pruef('Ohne Treffpunkt: kein Hinweis, Ort öffentlich', altD.fuehrung.treffpunktNachBuchung === false && altD.fuehrung.ort === 'Öffentlicher Platz ' + lauf);
  const altT = (await admin('create-termin', { fuehrungId: alt.j.fuehrung.id, datumIso: '2027-04-17', uhrzeit: '09:00', maxPersonen: 10 })).j.termin;
  const b2 = await post('buchung-anlegen', { terminId: altT.id, name: 'Ohne Treffpunkt', email: 'ohne-' + lauf + '@example.com', telefon: '0170 1235', personen: 1, fahrzeug: 'eigen', agb: true, firma: '' });
  await post('attrappe-bezahlen', { nr: b2.j.nummer, s: new URL(b2.j.url).searchParams.get('s'), ergebnis: 'bezahlt' });
  const m2 = dateien().filter((d) => d.includes(b2.j.nummer.toLowerCase()) && d.endsWith('.txt'));
  pruef('Ohne Treffpunkt: Mail nennt den Ort', m2.length > 0 && fs.readFileSync(path.join(AUSGANG, m2[0]), 'utf8').includes('Treffpunkt: Öffentlicher Platz ' + lauf));

  console.log('     Führung für die Sichtprüfung:', fId, '| Mail-Ausgang:', AUSGANG);
  console.log(fehler === 0 ? '\nALLE PRÜFPUNKTE BESTANDEN' : '\n' + fehler + ' PRÜFPUNKT(E) FEHLGESCHLAGEN');
  process.exit(fehler === 0 ? 0 : 1);
})().catch((e) => { console.error('ABBRUCH:', e); process.exit(2); });
