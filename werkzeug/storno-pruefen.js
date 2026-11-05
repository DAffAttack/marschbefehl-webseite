// Prüflauf Storno, Termin-Absage und Abgleich (E5). Nur lokal (netlify dev mit Zahlungs- und
// Mail-Attrappe):
//   node werkzeug/storno-pruefen.js
// Legt eine eigene Test-Führung mit Terminen an, damit die übrigen Testdaten unberührt bleiben.

const fs = require('fs');
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });
const B = 'http://localhost:8888/.netlify/functions/';
const PW = process.env.FUEHRUNGEN_ADMIN_PASSWORD;
if (!PW) { console.error('FUEHRUNGEN_ADMIN_PASSWORD fehlt (.env).'); process.exit(2); }
const AUSGANG = path.join(__dirname, '..', '.netlify', 'mail-ausgang');
const ATTRAPPE_ZAHLUNGEN = path.join(__dirname, '..', '.netlify', 'attrappe-zahlungen.json');
let fehler = 0;
function pruef(name, ok, info) { console.log((ok ? 'OK   ' : 'FEHL ') + name + (info ? '  → ' + info : '')); if (!ok) fehler++; }
async function post(fn, body) { const r = await fetch(B + fn, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }); const t = await r.text(); let j; try { j = JSON.parse(t); } catch { j = { roh: t }; } return { status: r.status, j }; }
async function get(fn) { const r = await fetch(B + fn); const t = await r.text(); let j; try { j = JSON.parse(t); } catch { j = { roh: t }; } return { status: r.status, j }; }
async function admin(action, body) { return post('admin-api', { action, password: PW, ...(body || {}) }); }
const mails = () => { try { return fs.readdirSync(AUSGANG).filter((d) => d.endsWith('.txt')); } catch { return []; } };
const lauf = Date.now().toString(36);
async function buchen(terminId, n, personen) {
  const r = await post('buchung-anlegen', { terminId, name: 'Storno-Gast ' + lauf + '-' + n, email: 'storno-' + lauf + '-' + n + '@example.com', telefon: '0170 5' + n, personen, fahrzeug: 'eigen', agb: true, firma: '' });
  if (r.status !== 200) throw new Error('Buchung fehlgeschlagen: ' + JSON.stringify(r.j));
  return { nummer: r.j.nummer, s: new URL(r.j.url).searchParams.get('s') };
}
async function zahlen(b) { return post('attrappe-bezahlen', { nr: b.nummer, s: b.s, ergebnis: 'bezahlt' }); }
async function buchungNach(nummer) { return (await admin('list')).j.buchungen.find((x) => x.nummer === nummer); }

(async () => {
  try { fs.unlinkSync(ATTRAPPE_ZAHLUNGEN); } catch { /* keine */ }
  // Eigene Führung + 2 Termine
  const bild = (await admin('list')).j.fuehrungen[0];
  const f = await admin('create-fuehrung', { titel: 'Storno-Prüfung ' + lauf, kurzbeschreibung: 'nur Prüflauf', langbeschreibung: 'nur Prüflauf', ort: 'Prüfplatz', preisProPerson: 30, bildUebersichtId: bild ? bild.bildUebersichtId : null, bildDetailId: bild ? bild.bildDetailId : null });
  if (!f.j.ok) { console.error('Führung anlegen fehlgeschlagen', f.j); process.exit(2); }
  const fId = f.j.fuehrung.id;
  const t1 = (await admin('create-termin', { fuehrungId: fId, datumIso: '2027-03-06', uhrzeit: '09:00', maxPersonen: 10 })).j.termin;
  const t2 = (await admin('create-termin', { fuehrungId: fId, datumIso: '2027-03-20', uhrzeit: '09:00', maxPersonen: 10 })).j.termin;

  // 1) Storno mit Erstattung
  const a = await buchen(t1.id, 1, 2); await zahlen(a);
  let m0 = mails().length;
  let r = await admin('cancel-buchung', { buchungId: (await buchungNach(a.nummer)).id, erstatten: true, grund: 'Absage durch den Veranstalter (Prüflauf)' });
  pruef('Storno mit Erstattung → erstattet + Erstattungs-ID', r.j.ok && r.j.status === 'erstattet' && !!r.j.erstattungId, JSON.stringify(r.j));
  let b = await buchungNach(a.nummer);
  pruef('Buchung zeigt erstattet, erstattetAm, Grund', b.status === 'erstattet' && !!b.erstattetAm && /Prüflauf/.test(b.stornoGrund));
  pruef('Storno-Mail im Ausgang', mails().length === m0 + 1 && /storniert/.test(mails().slice(-1)[0]), mails().slice(-1)[0]);
  const st = await get('buchung-status?nr=' + a.nummer + '&s=' + a.s);
  pruef('Status-Abfrage → erstattet', st.j.status === 'erstattet');
  r = await admin('cancel-buchung', { buchungId: b.id });
  pruef('Storno doppelt → abgewiesen', r.status === 400, r.j.error);

  // 2) Storno ohne Erstattung
  const c = await buchen(t1.id, 2, 1); await zahlen(c);
  r = await admin('cancel-buchung', { buchungId: (await buchungNach(c.nummer)).id, erstatten: false, grund: 'Storno nach Frist' });
  b = await buchungNach(c.nummer);
  pruef('Storno ohne Erstattung → storniert, keine Erstattungs-ID', r.j.ok && r.j.status === 'storniert' && !b.erstattungId, JSON.stringify(r.j));

  // 3) Storno einer unbezahlten Reservierung
  const d = await buchen(t1.id, 3, 1);
  r = await admin('cancel-buchung', { buchungId: (await buchungNach(d.nummer)).id });
  pruef('Reservierung stornieren → storniert (nichts zu erstatten)', r.j.ok && r.j.status === 'storniert' && r.j.erstattet === false);

  // 4) Termin absagen: 2 bezahlte + 1 reservierte Buchung
  const e1 = await buchen(t2.id, 4, 2); await zahlen(e1);
  const e2 = await buchen(t2.id, 5, 3); await zahlen(e2);
  const e3 = await buchen(t2.id, 6, 1);
  r = await admin('delete-termin', { terminId: t2.id });
  pruef('Löschen mit aktiven Buchungen → abgewiesen', r.status === 400, r.j.error);
  m0 = mails().length;
  r = await admin('cancel-termin', { terminId: t2.id, grund: 'Unwetterwarnung (Prüflauf)' });
  pruef('Termin absagen → ok, 3 Buchungen, 2 erstattet', r.j.ok && r.j.abgesagt && r.j.buchungen.length === 3 && r.j.buchungen.filter((x) => x.erstattet).length === 2, JSON.stringify(r.j.buchungen));
  const liste = (await admin('list')).j;
  const t2n = liste.termine.find((t) => t.id === t2.id);
  pruef('Termin steht auf abgesagt mit Grund', t2n.status === 'abgesagt' && /Unwetter/.test(t2n.absageGrund));
  pruef('3 Absage-Mails im Ausgang', mails().length === m0 + 3, (mails().length - m0) + ' Mails');
  const oeff = await get('termine-oeffentlich?fuehrungId=' + fId);
  pruef('Abgesagter Termin nicht mehr öffentlich', oeff.j.ok && !oeff.j.termine.some((t) => t.id === t2.id));
  r = await post('buchung-anlegen', { terminId: t2.id, name: 'Spät', email: 'spaet@example.com', telefon: '0170 1', personen: 1, fahrzeug: 'eigen', agb: true, firma: '' });
  pruef('Buchen auf abgesagten Termin → abgewiesen', r.status === 400, r.j.error);
  r = await admin('cancel-termin', { terminId: t2.id });
  pruef('Termin zweimal absagen → abgewiesen', r.status === 400);
  r = await admin('delete-termin', { terminId: t2.id });
  pruef('Abgesagten Termin löschen → ok (Buchungen bleiben)', r.j.ok && !!(await buchungNach(e1.nummer)));

  // 5) Abgleich: erst sauber, dann mit eingebauten Abweichungen
  r = await admin('abgleich-jetzt');
  pruef('Abgleich ohne Abweichungen → sehr gut', r.j.ok && r.j.abgleich.note === 'sehr gut' && r.j.abgleich.abweichungen.length === 0, r.j.abgleich && (r.j.abgleich.geprueft.zahlungen + ' Zahlungen, ' + r.j.abgleich.abweichungen.length + ' Abw.'));
  // Attrappe-Zahlungen mit 3 Abweichungen: fremde Zahlung, Betrag falsch, bezahlte Buchung ohne Zahlung
  const g = await buchen(t1.id, 7, 2); await zahlen(g);
  const h = await buchen(t1.id, 8, 1); await zahlen(h);
  const bg = await buchungNach(g.nummer);
  const bh = await buchungNach(h.nummer);
  const zahlungen = [
    { sessionId: 'cs_attrappe_fremd_' + lauf, paymentIntent: 'pi_fremd', betragCent: 4500, waehrung: 'eur', bezahlt: true, erstattetCent: 0, email: 'fremd@example.com', nummer: '', erstellt: new Date().toISOString() },
    { sessionId: bg.stripeSessionId, paymentIntent: 'pi_g', betragCent: bg.betragCent - 1000, waehrung: 'eur', bezahlt: true, erstattetCent: 0, email: bg.email, nummer: bg.nummer, erstellt: bg.erstelltAm },
    // bh fehlt absichtlich → buchung-ohne-zahlung
  ];
  // Alle anderen bezahlten/erstatteten Buchungen korrekt mitliefern, damit nur die 3 Abweichungen übrig bleiben
  for (const x of liste.buchungen.concat((await admin('list')).j.buchungen)) {
    if (!x.stripeSessionId || zahlungen.some((z) => z.sessionId === x.stripeSessionId) || x.nummer === bh.nummer || x.nummer === bg.nummer) continue;
    if (x.status === 'bezahlt' || x.status === 'pruefen' || x.status === 'erstattet') {
      zahlungen.push({ sessionId: x.stripeSessionId, paymentIntent: x.stripeSessionId, betragCent: x.betragCent, waehrung: 'eur', bezahlt: true, erstattetCent: x.status === 'erstattet' ? x.betragCent : 0, email: x.email, nummer: x.nummer, erstellt: x.erstelltAm });
    }
  }
  fs.writeFileSync(ATTRAPPE_ZAHLUNGEN, JSON.stringify(zahlungen, null, 2));
  m0 = mails().length;
  r = await admin('abgleich-jetzt');
  const arten = r.j.ok ? r.j.abgleich.abweichungen.map((x) => x.art).sort() : [];
  pruef('Abgleich mit 3 Abweichungen → schlecht', r.j.ok && r.j.abgleich.note === 'schlecht' && arten.join() === ['betrag-abweichung', 'buchung-ohne-zahlung', 'zahlung-ohne-buchung'].join(), arten.join(', '));
  pruef('Jede Abweichung hat ein TO-DO', r.j.ok && r.j.abgleich.abweichungen.every((x) => x.todo && x.todo.length > 20));
  pruef('Abgleich-Mail im Ausgang', mails().length === m0 + 1 && /abgleich/.test(mails().slice(-1)[0]), mails().slice(-1)[0]);
  const ab = await admin('abgleich');
  pruef('Verwaltung liefert letzten Abgleich', ab.j.ok && ab.j.abgleich && ab.j.abgleich.abweichungen.length === 3);
  fs.unlinkSync(ATTRAPPE_ZAHLUNGEN);

  console.log(fehler === 0 ? '\nALLE PRÜFPUNKTE BESTANDEN' : '\n' + fehler + ' PRÜFPUNKT(E) FEHLGESCHLAGEN');
  process.exit(fehler === 0 ? 0 : 1);
})().catch((e) => { console.error('ABBRUCH:', e); try { fs.unlinkSync(ATTRAPPE_ZAHLUNGEN); } catch { /* */ } process.exit(2); });
