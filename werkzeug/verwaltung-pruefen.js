// Prüflauf Verwaltung (E4): Anmeldung mit Sitzungs-Cookie, Bremse, Abmelden, Teilnehmerliste,
// Protokoll. Gegen einen laufenden Server:
//   node werkzeug/verwaltung-pruefen.js [Basis-URL]
// Passwort aus FUEHRUNGEN_ADMIN_PASSWORD (.env). Achtung: der Bremse-Test erzeugt 5 Fehl-
// versuche; danach ist die Anmeldung von dieser IP 15 Minuten gesperrt — der Lauf meldet
// sich deshalb VOR dem Bremse-Test an und prüft die Sperre zum Schluss.

const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });
const BASIS = (process.argv[2] || 'http://localhost:8888').replace(/\/$/, '');
const B = BASIS + '/.netlify/functions/';
const PW = process.env.FUEHRUNGEN_ADMIN_PASSWORD;
if (!PW) { console.error('FUEHRUNGEN_ADMIN_PASSWORD fehlt (.env).'); process.exit(2); }
let fehler = 0;
function pruef(name, ok, info) { console.log((ok ? 'OK   ' : 'FEHL ') + name + (info ? '  → ' + info : '')); if (!ok) fehler++; }
async function post(fn, body, cookie) {
  const r = await fetch(B + fn, { method: 'POST', headers: { 'content-type': 'application/json', ...(cookie ? { cookie } : {}) }, body: JSON.stringify(body) });
  const t = await r.text(); let j; try { j = JSON.parse(t); } catch { j = { roh: t }; }
  return { status: r.status, j, setCookie: r.headers.get('set-cookie') || '' };
}
function cookieAus(setCookie) { return setCookie.split(';')[0]; }

(async () => {
  console.log('Prüflauf Verwaltung gegen', BASIS);
  // 1) Ohne Anmeldung
  let r = await post('admin-api', { action: 'list' });
  pruef('Liste ohne Anmeldung → 401', r.status === 401, r.j.error);
  r = await post('admin-api', { action: 'sitzung' });
  pruef('Sitzungsprüfung ohne Cookie → 401', r.status === 401);

  // 2) Anmelden
  r = await post('admin-api', { action: 'login', password: PW });
  pruef('Anmeldung → Cookie gesetzt (HttpOnly, SameSite=Strict)', r.status === 200 && /zsh_verwaltung=/.test(r.setCookie) && /HttpOnly/.test(r.setCookie) && /SameSite=Strict/.test(r.setCookie), r.setCookie.replace(/=[^;]+/, '=…'));
  const cookie = cookieAus(r.setCookie);
  r = await post('admin-api', { action: 'sitzung' }, cookie);
  pruef('Sitzungsprüfung mit Cookie → ok', r.status === 200 && r.j.weg === 'cookie', JSON.stringify(r.j));
  r = await post('admin-api', { action: 'list' }, cookie);
  pruef('Liste mit Cookie → 200', r.status === 200 && Array.isArray(r.j.termine));
  const termin = r.j.termine.find((t) => !t.istVergangenheit) || r.j.termine[0];

  // 3) Manipuliertes Cookie
  const kaputt = cookie.slice(0, -4) + 'xxxx';
  r = await post('admin-api', { action: 'list' }, kaputt);
  pruef('Verfälschtes Cookie → 401', r.status === 401);

  // 4) Passwort im Body weiterhin erlaubt (Prüfskripte)
  r = await post('admin-api', { action: 'sitzung', password: PW });
  pruef('Passwort im Body → ok (weg: passwort)', r.status === 200 && r.j.weg === 'passwort');

  // 5) Teilnehmerliste
  if (termin) {
    const t = await fetch(B + 'teilnehmerliste?terminId=' + termin.id, { headers: { cookie } });
    const buf = Buffer.from(await t.arrayBuffer());
    pruef('Teilnehmerliste mit Cookie → PDF', t.status === 200 && buf.slice(0, 4).toString() === '%PDF', t.status + ' ' + buf.length + ' Bytes');
    require('fs').writeFileSync(path.join(__dirname, '..', '.netlify', 'teilnehmerliste-probe.pdf'), buf);
    const t2 = await fetch(B + 'teilnehmerliste?terminId=' + termin.id);
    pruef('Teilnehmerliste ohne Cookie → 401', t2.status === 401);
  }

  // 6) Protokoll
  r = await post('admin-api', { action: 'protokoll' }, cookie);
  pruef('Protokoll mit Cookie', r.status === 200 && Array.isArray(r.j.eintraege), (r.j.eintraege || []).length + ' Einträge');

  // 7) Abmelden
  r = await post('admin-api', { action: 'logout' }, cookie);
  pruef('Abmelden → Cookie gelöscht', r.status === 200 && /Max-Age=0/.test(r.setCookie));

  // 8) Bremse: 5 falsche Passwörter → Sperre
  for (let i = 0; i < 5; i++) await post('admin-api', { action: 'login', password: 'falsch-' + i });
  r = await post('admin-api', { action: 'login', password: PW });
  pruef('Nach 5 Fehlversuchen: auch richtiges Passwort → 429', r.status === 429, r.j.error);
  console.log('     (Sperre gilt 15 Minuten für diese IP, nur im laufenden Server-Prozess)');

  console.log(fehler === 0 ? '\nALLE PRÜFPUNKTE BESTANDEN' : '\n' + fehler + ' PRÜFPUNKT(E) FEHLGESCHLAGEN');
  process.exit(fehler === 0 ? 0 : 1);
})().catch((e) => { console.error('ABBRUCH:', e.message || e); process.exit(2); });
