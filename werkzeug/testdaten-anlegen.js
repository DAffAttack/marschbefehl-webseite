// Legt die Testdaten für den Probelauf an: eine Führung „Prüf-Führung (TEST)“ mit zwei Bildern
// und einen Termin mit 20 Plätzen. Läuft mehrfach ohne Doppelungen (vorhandene werden genutzt).
//
// Aufruf (lokal):             node werkzeug/testdaten-anlegen.js
// Gegen den Branch-Deploy:    node werkzeug/testdaten-anlegen.js https://buchung--zeitreise-seelower-hoehen.netlify.app
//
// Passwort aus FUEHRUNGEN_ADMIN_PASSWORD (Umgebung oder .env). Vor dem Livegang die Test-Führung
// in der Verwaltung wieder löschen (Termine zuerst absagen/löschen), siehe BUCHUNG_EINRICHTUNG.md Abschnitt 6.

const fs = require('fs');
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });

const BASIS = (process.argv[2] || 'http://localhost:8888').replace(/\/$/, '');
const B = BASIS + '/.netlify/functions/';
const PW = process.env.FUEHRUNGEN_ADMIN_PASSWORD;
if (!PW) { console.error('FUEHRUNGEN_ADMIN_PASSWORD fehlt (Umgebung oder .env).'); process.exit(2); }

const TITEL = 'Prüf-Führung (TEST)';
const DATUM = '2027-02-13';

async function post(fn, body) {
  const r = await fetch(B + fn, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
  const t = await r.text(); let j; try { j = JSON.parse(t); } catch { j = { roh: t }; }
  if (!r.ok || j.ok === false) throw new Error(fn + ' → ' + r.status + ' ' + (j.error || t.slice(0, 200)));
  return j;
}

(async () => {
  console.log('Testdaten gegen', BASIS);
  const liste = await post('admin-api', { action: 'list', password: PW });
  let fuehrung = liste.fuehrungen.find((f) => f.titel === TITEL);
  if (fuehrung) {
    console.log('Führung vorhanden:', fuehrung.id);
  } else {
    const bild = fs.readFileSync(path.join(__dirname, '..', 'assets', 'logo.png')).toString('base64');
    const ids = [];
    for (const name of ['uebersicht.png', 'detail.png']) {
      const u = await post('fuehrungen-bild-upload', { password: PW, contentType: 'image/png', imageBase64: bild, filename: name });
      ids.push(u.imageId);
    }
    const r = await post('admin-api', {
      action: 'create-fuehrung', password: PW,
      titel: TITEL,
      kurzbeschreibung: 'Nur zum Prüfen des Buchungssystems. Nicht buchen.',
      langbeschreibung: 'Diese Führung dient ausschließlich dem Probelauf des Buchungssystems. Buchungen hierauf werden storniert und erstattet.',
      ort: 'Gedenkstätte Seelower Höhen, Küstriner Straße 28a, 15306 Seelow',
      preisProPerson: 1,
      bildUebersichtId: ids[0], bildDetailId: ids[1],
    });
    fuehrung = r.fuehrung;
    console.log('Führung angelegt:', fuehrung.id, '| Preis 1,00 € je Person (Testkarte)');
  }
  const termine = liste.termine.filter((t) => t.fuehrungId === fuehrung.id && !t.istVergangenheit && t.freiePlaetze >= 8);
  if (termine.length) {
    console.log('Termin vorhanden:', termine[0].datumIso, termine[0].uhrzeit, '| frei:', termine[0].freiePlaetze);
  } else {
    const r = await post('admin-api', { action: 'create-termin', password: PW, fuehrungId: fuehrung.id, datumIso: DATUM, uhrzeit: '10:00', maxPersonen: 20 });
    console.log('Termin angelegt:', r.termin.datumIso, r.termin.uhrzeit, '| 20 Plätze');
  }
  console.log('Fertig. Jetzt: node werkzeug/buchung-pruefen.js ' + (process.argv[2] || ''));
})().catch((e) => { console.error('FEHLER:', e.message); process.exit(1); });
