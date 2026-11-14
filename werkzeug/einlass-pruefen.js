// Prüflauf Einlass am Treffpunkt (14.11.2026): Buchung → Zahlung (Attrappe) → Mail mit QR-Code
// und Ticket-PDF → QR lesbar → Einlass-Liste → Einchecken (auch doppelt, gesammelt, rückgängig)
// → Schutz ohne Anmeldung. Nur lokal (netlify dev, Mail-Attrappe).
//   node werkzeug/einlass-pruefen.js
// Passwort aus FUEHRUNGEN_ADMIN_PASSWORD (.env). Braucht einen Termin mit mindestens 2 freien Plätzen.
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');
const jsQR = require('jsqr');
const B = (process.argv[2] || 'http://localhost:8888').replace(/\/$/, '') + '/.netlify/functions/';
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });
const PW = process.env.FUEHRUNGEN_ADMIN_PASSWORD;
if (!PW) { console.error('FUEHRUNGEN_ADMIN_PASSWORD fehlt (.env).'); process.exit(2); }
const AUSGANG = path.join(__dirname, '..', '.netlify', 'mail-ausgang');
let fehler = 0;
function pruef(name, ok, info) { console.log((ok ? 'OK   ' : 'FEHL ') + name + (info ? '  → ' + info : '')); if (!ok) fehler++; }
async function post(fn, body) { const r = await fetch(B + fn, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }); const t = await r.text(); let j; try { j = JSON.parse(t); } catch { j = { roh: t }; } return { status: r.status, j }; }
function dateien() { try { return fs.readdirSync(AUSGANG); } catch { return []; } }

function pngLesen(buf) {
  let o = 8; const idat = []; let w, h;
  while (o < buf.length) { const l = buf.readUInt32BE(o); const t = buf.toString('ascii', o + 4, o + 8); const d = buf.slice(o + 8, o + 8 + l); if (t === 'IHDR') { w = d.readUInt32BE(0); h = d.readUInt32BE(4); } if (t === 'IDAT') idat.push(d); o += 12 + l; }
  const roh = zlib.inflateSync(Buffer.concat(idat)); const px = new Uint8ClampedArray(w * h * 4);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) { const v = roh[y * (w + 1) + 1 + x]; const i = (y * w + x) * 4; px[i] = px[i + 1] = px[i + 2] = v; px[i + 3] = 255; }
  const r = jsQR(px, w, h); return r ? r.data : '';
}

(async () => {
  const liste = (await post('admin-api', { action: 'list', password: PW })).j;
  const termin = liste.termine.find((t) => !t.istVergangenheit && t.freiePlaetze >= 2);
  console.log('     Termin', termin.datumIso, '| frei', termin.freiePlaetze);
  const vorher = new Set(dateien());

  // 1) Buchen + zahlen
  const b = await post('buchung-anlegen', { terminId: termin.id, name: 'Einlass Prüfgast', email: 'einlass-pruef@example.com', telefon: '0170 1234567', personen: 2, fahrzeug: 'eigen', agb: true, firma: '' });
  pruef('Buchung angelegt', b.status === 200, b.j.nummer);
  const s = new URL(b.j.url).searchParams.get('s');
  const z = await post('attrappe-bezahlen', { nr: b.j.nummer, s, ergebnis: 'bezahlt' });
  pruef('Bezahlt, Mail raus', z.j.webhook && z.j.webhook.nach && z.j.webhook.nach.ok, JSON.stringify(z.j.webhook && z.j.webhook.nach));

  // 2) Mail: QR-Bild, Ticket-PDF, Text
  const neu = dateien().filter((d) => !vorher.has(d) && d.includes('bestaetigt'));
  const png = neu.find((d) => d.endsWith('einlass-qr.png'));
  const qr = png ? pngLesen(fs.readFileSync(path.join(AUSGANG, png))) : '';
  const m = /#(ZSH-\d{4}-\d{4})\.([A-Z2-9]{8})$/.exec(qr);
  pruef('QR-Bild in der Mail ist lesbar und trägt die Buchungsnummer', !!m && m[1] === b.j.nummer, qr);
  const ticket = neu.find((d) => d.endsWith('Ticket-' + b.j.nummer + '.pdf'));
  pruef('Ticket-PDF hängt an', !!ticket && fs.readFileSync(path.join(AUSGANG, ticket)).slice(0, 4).toString() === '%PDF', ticket);
  const html = fs.readFileSync(path.join(AUSGANG, neu.find((d) => d.endsWith('.html'))), 'utf8');
  pruef('Mail-HTML bindet das Bild per cid ein', html.includes('src="cid:einlass-qr"'));
  const json = JSON.parse(fs.readFileSync(path.join(AUSGANG, neu.find((d) => d.endsWith('.json'))), 'utf8'));
  pruef('Anhänge: Rechnung, QR, Ticket, Zello', json.anhaenge.length === 4, json.anhaenge.join(', '));
  const code = m ? m[2] : '';

  // 3) Einlass-Liste
  const ohne = await fetch(B + 'einlass?terminId=' + termin.id);
  pruef('Einlass-Liste ohne Anmeldung → 401', ohne.status === 401);
  const ohnePost = await post('einlass', { terminId: termin.id, eintraege: [{ buchungId: '00000000-0000-4000-8000-000000000000', eingecheckt: true }] });
  pruef('Einchecken ohne Anmeldung → 401', ohnePost.status === 401);
  const anm = await fetch(B + 'admin-api', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ action: 'login', password: PW }) });
  const cookie = (anm.headers.get('set-cookie') || '').split(';')[0];
  const mitCookie = (url, opt) => fetch(B + url, Object.assign({}, opt, { headers: Object.assign({ cookie, 'content-type': 'application/json' }, (opt && opt.headers) || {}) })).then(async (r) => ({ status: r.status, j: await r.json() }));
  const t = await mitCookie('einlass?aktion=termine');
  pruef('Terminliste mit Anmeldung', t.status === 200 && t.j.termine.some((x) => x.id === termin.id), t.j.termine && t.j.termine.length + ' Termine');
  const L = await mitCookie('einlass?terminId=' + termin.id);
  const gast = L.j.gaeste && L.j.gaeste.find((g) => g.nummer === b.j.nummer);
  pruef('Gast steht auf der Liste mit gleichem Code', !!gast && gast.code === code && gast.personen === 2 && !gast.eingechecktAm, gast && gast.code);
  pruef('Alle aktiven Gäste haben einen Code', L.j.gaeste.filter((g) => g.status !== 'storniert').every((g) => /^[A-Z2-9]{8}$/.test(g.code)));
  pruef('Liste nennt Treffpunkt und Titel', typeof L.j.termin.treffpunkt === 'string' && !!L.j.termin.titel);

  // 4) Einchecken, doppelt, gesammelt, rückgängig
  const zeit = new Date(Date.now() - 60000).toISOString();
  const e1 = await mitCookie('einlass', { method: 'POST', body: JSON.stringify({ terminId: termin.id, eintraege: [{ buchungId: gast.id, eingecheckt: true, zeit }] }) });
  const g1 = e1.j.gaeste.find((g) => g.id === gast.id);
  pruef('Einchecken → Zeit vom Handy übernommen', e1.j.angewendet === 1 && g1.eingechecktAm === zeit, g1 && g1.eingechecktAm);
  const e2 = await mitCookie('einlass', { method: 'POST', body: JSON.stringify({ terminId: termin.id, eintraege: [{ buchungId: gast.id, eingecheckt: true, zeit: new Date().toISOString() }] }) });
  pruef('Zweites Einchecken ändert nichts (erste Zeit bleibt)', e2.j.angewendet === 0 && e2.j.gaeste.find((g) => g.id === gast.id).eingechecktAm === zeit);
  const e3 = await mitCookie('einlass', { method: 'POST', body: JSON.stringify({ terminId: termin.id, eintraege: [{ buchungId: gast.id, eingecheckt: false }, { buchungId: gast.id, eingecheckt: true, zeit }] }) });
  pruef('Gesammelt nach Funkloch: zurück + wieder rein', e3.j.angewendet === 2 && e3.j.gaeste.find((g) => g.id === gast.id).eingechecktAm === zeit);
  const fremd = await mitCookie('einlass', { method: 'POST', body: JSON.stringify({ terminId: termin.id, eintraege: [{ buchungId: '00000000-0000-4000-8000-000000000000', eingecheckt: true }] }) });
  pruef('Unbekannte Buchung wird ignoriert', fremd.status === 200 && fremd.j.angewendet === 0);
  const prot = (await post('admin-api', { action: 'protokoll', password: PW })).j;
  pruef('Protokoll kennt das Einchecken', JSON.stringify(prot).includes('"einlass"'));

  // 5) Storno: Gast bleibt auf der Liste, aber als storniert
  const bu = (await post('admin-api', { action: 'list', password: PW })).j.buchungen.find((x) => x.nummer === b.j.nummer);
  const st = await post('admin-api', { action: 'cancel-buchung', password: PW, buchungId: bu.id, erstatten: false, grund: 'Prüflauf Einlass' });
  const L2 = await mitCookie('einlass?terminId=' + termin.id);
  const g2 = L2.j.gaeste.find((g) => g.id === gast.id);
  pruef('Stornierte Buchung erscheint als storniert (Scan zeigt Rot)', st.j.ok && g2 && g2.status === 'storniert', st.j.error || (g2 && g2.status));

  // 6) Seite + Offline-Dateien werden ausgeliefert
  const basis = B.replace('/.netlify/functions/', '');
  for (const u of ['/einlass.html', '/einlass-sw.js', '/assets/einlass/jsQR.js']) {
    const r = await fetch(basis + u);
    const inhalt = await r.text();
    pruef('Ausgeliefert: ' + u, r.status === 200 && inhalt.length > 500, r.status + ', ' + inhalt.length + ' Zeichen');
  }

  console.log(fehler === 0 ? '\nALLE PRÜFPUNKTE BESTANDEN' : '\n' + fehler + ' PRÜFPUNKT(E) FEHLGESCHLAGEN');
  process.exit(fehler === 0 ? 0 : 1);
})().catch((e) => { console.error('ABBRUCH:', e); process.exit(2); });
