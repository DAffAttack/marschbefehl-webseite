// Prüflauf für die Vorab-Buchung der Kanalmitglieder. Nur lokal gegen "netlify dev" (Port 8888):
//   node werkzeug/vorab-pruefen.js
// Legt einen eigenen Testtermin an und löscht ihn am Ende. Bricht ab, wenn der lokale Speicher
// die echte Führung enthält, damit nie auf Live-Daten geprüft wird.

const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });

const B = 'http://localhost:8888/.netlify/functions/';
const PW = process.env.FUEHRUNGEN_ADMIN_PASSWORD;
const ECHTE_FUEHRUNG = 'f3d9e96b-425b-4d0b-a3a7-43568fb89dcd';
if (!PW) { console.error('FUEHRUNGEN_ADMIN_PASSWORD fehlt (.env).'); process.exit(2); }

let fehler = 0;
function pruef(name, ok, info) { console.log((ok ? 'OK   ' : 'FEHL ') + name + (info ? '  → ' + info : '')); if (!ok) fehler++; }
async function post(fn, body) {
  const r = await fetch(B + fn, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
  const t = await r.text(); let j; try { j = JSON.parse(t); } catch { j = { roh: t }; }
  return { status: r.status, j };
}
const admin = (action, daten) => post('admin-api', { action, password: PW, ...daten });
const lauf = Date.now().toString(36);
const gast = (n, terminId, extra) => ({ terminId, name: 'Vorabgast ' + lauf + n, email: 'vorab-' + lauf + n + '@example.com', telefon: '0170 0000' + n, personen: 1, fahrzeug: 'eigen', agb: true, firma: '', ...extra });
const inZukunft = (tage) => new Date(Date.now() + tage * 86400000).toISOString();
const termineOeffentlich = async (fid) => (await (await fetch(B + 'termine-oeffentlich?fuehrungId=' + fid)).json()).termine;

(async () => {
  const liste = (await admin('list', {})).j;
  if (!liste.ok) { console.error('Verwaltung:', liste.error); process.exit(2); }
  if (liste.fuehrungen.some((f) => f.id === ECHTE_FUEHRUNG)) { console.error('ABBRUCH: Speicher enthält die echte Führung, das ist nicht der lokale Teststand.'); process.exit(2); }
  const f = liste.fuehrungen[0];
  if (!f) { console.error('Keine Führung im lokalen Speicher (werkzeug/testdaten-anlegen.js).'); process.exit(2); }

  // Anlegen mit Vorab-Phase
  let r = await admin('create-termin', { fuehrungId: f.id, datumIso: '2099-06-01', uhrzeit: '09:00', maxPersonen: 5, fuerAlleAb: inZukunft(2) });
  pruef('Termin mit Vorab-Phase angelegt', r.j.ok && /^[A-Z2-9]{4}-[A-Z2-9]{4}$/.test(r.j.termin.vorabCode), r.j.error);
  const T = r.j.termin.id, CODE = r.j.termin.vorabCode;

  r = await admin('create-termin', { fuehrungId: f.id, datumIso: '2099-06-01', uhrzeit: '09:00', maxPersonen: 5, fuerAlleAb: '2100-01-01T00:00:00.000Z' });
  pruef('Zeitpunkt nach dem Termin abgelehnt', r.status === 400, r.j.error);

  // Öffentliche Antwort
  let oe = (await termineOeffentlich(f.id)).find((t) => t.id === T);
  pruef('Öffentlich: Vorab sichtbar', oe && oe.vorab === true && !!oe.fuerAlleAb);
  pruef('Öffentlich: Code nicht enthalten', oe && !JSON.stringify(oe).includes(CODE) && !('vorabCode' in oe));

  // Sperre
  r = await post('buchung-anlegen', gast(1, T));
  pruef('Ohne Code gesperrt (403)', r.status === 403, r.j.error);
  r = await post('buchung-anlegen', gast(2, T, { vorabCode: 'FALS-CH22' }));
  pruef('Falscher Code gesperrt (403)', r.status === 403, r.j.error);
  r = await post('buchung-anlegen', gast(3, T, { vorabCode: CODE }));
  pruef('Richtiger Code bucht', r.status === 200 && r.j.ok, r.j.error);
  r = await post('buchung-anlegen', gast(4, T, { vorabCode: ' ' + CODE.toLowerCase() + ' ' }));
  pruef('Kleinschreibung und Leerzeichen gehen', r.status === 200 && r.j.ok, r.j.error);

  let l = (await admin('list', {})).j;
  const eigene = (l.buchungen || []).filter((b) => b.terminId === T);
  pruef('Buchung als Vorab markiert', eigene.length === 2 && eigene.every((b) => b.vorab === true), eigene.length + ' Buchungen');
  const tA = l.termine.find((t) => t.id === T);
  pruef('Verwaltung sieht Code und Zeitpunkt', tA && tA.vorabCode === CODE && !!tA.fuerAlleAb);

  // Zeitpunkt ändern behält den Code
  r = await admin('edit-termin', { terminId: T, maxPersonen: 5, fuerAlleAb: inZukunft(3) });
  pruef('Neuer Zeitpunkt behält den Code', r.j.ok && r.j.termin.vorabCode === CODE, r.j.error);

  // Vorab-Phase vorbei: für alle offen, Code unnötig
  r = await admin('edit-termin', { terminId: T, maxPersonen: 5, fuerAlleAb: new Date(Date.now() - 60000).toISOString() });
  pruef('Zeitpunkt in der Vergangenheit gespeichert', r.j.ok, r.j.error);
  oe = (await termineOeffentlich(f.id)).find((t) => t.id === T);
  pruef('Nach Ablauf öffentlich ohne Vorab', oe && oe.vorab === false && oe.fuerAlleAb === null);
  r = await post('buchung-anlegen', gast(5, T));
  pruef('Nach Ablauf ohne Code buchbar', r.status === 200 && r.j.ok, r.j.error);
  l = (await admin('list', {})).j;
  pruef('Diese Buchung nicht als Vorab markiert', l.buchungen.filter((b) => b.terminId === T && !b.vorab).length === 1);

  // Feld leeren: sofort für alle
  r = await admin('edit-termin', { terminId: T, maxPersonen: 5, fuerAlleAb: '' });
  pruef('Feld leeren entfernt Code', r.j.ok && !r.j.termin.vorabCode && !r.j.termin.fuerAlleAb, r.j.error);
  r = await admin('edit-termin', { terminId: T, maxPersonen: 5 });
  pruef('Bearbeiten ohne das Feld ändert nichts', r.j.ok && !r.j.termin.vorabCode, r.j.error);

  // Aufräumen
  await admin('cancel-termin', { terminId: T, grund: 'Prüflauf' });
  r = await admin('delete-termin', { terminId: T });
  console.log(r.j.ok ? '     Testtermin gelöscht' : '     Testtermin nicht gelöscht: ' + (r.j.error || r.status));

  console.log('Fehler:', fehler);
  process.exit(fehler ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(2); });
