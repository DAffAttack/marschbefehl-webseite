// Prüflauf „Bild in der Beschreibung“: freiwilliges Feld, öffentlich sichtbar, ersetzen, entfernen,
// alte Bilder werden gelöscht. Nur lokal (netlify dev):
//   node werkzeug/beschreibungsbild-pruefen.js [Pfad zu einem JPG]
// Legt eigene Test-Führungen an; eine bleibt für die Sichtprüfung stehen und wird ausgegeben.

const fs = require('fs');
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });
const B = 'http://localhost:8888/.netlify/functions/';
const PW = process.env.FUEHRUNGEN_ADMIN_PASSWORD;
if (!PW) { console.error('FUEHRUNGEN_ADMIN_PASSWORD fehlt (.env).'); process.exit(2); }
const BILD = process.argv[2];
if (!BILD) { console.error('Bitte den Pfad zu einem JPG angeben.'); process.exit(2); }
let fehler = 0;
function pruef(name, ok, info) { console.log((ok ? 'OK   ' : 'FEHL ') + name + (info ? '  → ' + info : '')); if (!ok) fehler++; }
async function post(fn, body) { const r = await fetch(B + fn, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }); const j = await r.json().catch(() => ({})); return { status: r.status, j }; }
const admin = (action, body) => post('admin-api', { action, password: PW, ...(body || {}) });
const daten = 'data:image/jpeg;base64,' + fs.readFileSync(BILD).toString('base64');
async function hochladen() { const r = await post('fuehrungen-bild-upload', { password: PW, contentType: 'image/jpeg', filename: 'pruef.jpg', imageBase64: daten }); if (!r.j.ok) throw new Error('Upload: ' + JSON.stringify(r.j)); return r.j.imageId; }
const detail = async (id) => (await (await fetch(B + 'fuehrungen-oeffentlich?id=' + id)).json()).fuehrung;
const bildDa = async (id) => (await fetch(B + 'fuehrungen-bild?id=' + id)).status === 200;
const lauf = Date.now().toString(36);
const TEXT = ['Erster Absatz.', 'Zweiter Absatz.', 'Dritter Absatz.', 'Vierter Absatz.'].join('\n\n');

(async () => {
  const [ue, de, a, b] = [await hochladen(), await hochladen(), await hochladen(), await hochladen()];
  const basis = { kurzbeschreibung: 'nur Prüflauf', langbeschreibung: TEXT, ort: 'Prüfplatz', preisProPerson: 30 };

  const ohne = await admin('create-fuehrung', { ...basis, titel: 'Ohne Beschreibungsbild ' + lauf, bildUebersichtId: ue, bildDetailId: de });
  pruef('Anlegen ohne das Feld klappt wie bisher', ohne.j.ok);
  pruef('Ohne Bild: öffentlich null', (await detail(ohne.j.fuehrung.id)).bildBeschreibungId === null);

  const falsch = await admin('edit-fuehrung', { ...basis, fuehrungId: ohne.j.fuehrung.id, titel: 'Ohne Beschreibungsbild ' + lauf, bildBeschreibungId: '../boese' });
  pruef('Ungültige Bild-ID → abgewiesen', falsch.status === 400, falsch.j.error);

  const ue2 = await hochladen(); const de2 = await hochladen();
  const mit = await admin('create-fuehrung', { ...basis, titel: 'Mit Beschreibungsbild ' + lauf, bildUebersichtId: ue2, bildDetailId: de2, bildBeschreibungId: a });
  const id = mit.j.fuehrung.id;
  pruef('Anlegen mit Bild', mit.j.ok && mit.j.fuehrung.bildBeschreibungId === a);
  pruef('Öffentlich sichtbar', (await detail(id)).bildBeschreibungId === a);

  const name = 'Mit Beschreibungsbild ' + lauf;
  await admin('edit-fuehrung', { ...basis, fuehrungId: id, titel: name });
  pruef('Bearbeiten ohne Feld behält das Bild', (await detail(id)).bildBeschreibungId === a);

  await admin('edit-fuehrung', { ...basis, fuehrungId: id, titel: name, bildBeschreibungId: b });
  pruef('Ersetzen setzt das neue Bild', (await detail(id)).bildBeschreibungId === b);
  pruef('Ersetzen löscht das alte Bild', !(await bildDa(a)));
  pruef('Titel- und Übersichtsbild bleiben', (await detail(id)).bildDetailId === de2 && (await bildDa(ue2)) && (await bildDa(de2)));

  await admin('edit-fuehrung', { ...basis, fuehrungId: id, titel: name, bildBeschreibungEntfernen: true });
  pruef('Entfernen leert das Feld', (await detail(id)).bildBeschreibungId === null);
  pruef('Entfernen löscht die Datei', !(await bildDa(b)));

  const c = await hochladen();
  await admin('edit-fuehrung', { ...basis, fuehrungId: id, titel: name, bildBeschreibungId: c });
  const weg = await admin('delete-fuehrung', { fuehrungId: id });
  pruef('Führung löschen löscht auch dieses Bild', weg.j.ok && !(await bildDa(c)));

  const s = await hochladen();
  const sicht = await admin('edit-fuehrung', { ...basis, fuehrungId: ohne.j.fuehrung.id, titel: 'Ohne Beschreibungsbild ' + lauf, bildBeschreibungId: s });
  pruef('Führung für die Sichtprüfung bereit', sicht.j.ok);
  console.log('SICHT=' + ohne.j.fuehrung.id);
  console.log(fehler === 0 ? '\nALLE PRÜFPUNKTE BESTANDEN' : '\n' + fehler + ' PRÜFPUNKT(E) FEHLGESCHLAGEN');
  process.exit(fehler === 0 ? 0 : 1);
})().catch((e) => { console.error('ABBRUCH:', e); process.exit(2); });
