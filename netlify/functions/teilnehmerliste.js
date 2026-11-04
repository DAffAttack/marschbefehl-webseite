// Teilnehmerliste eines Termins als PDF (für den Tourtag, zum Drucken oder aufs Handy).
// Nur mit gültiger Verwaltungs-Sitzung (Cookie). Enthält bezahlte Buchungen und solche
// mit Status "prüfen" (Zahlung da, Betrag abweichend); Reservierungen ohne Zahlung nicht.

const { PDFDocument, StandardFonts, rgb } = require('pdf-lib');
const { readState, findFuehrung, blobsVerbinden } = require('./_lib/store');
const { angemeldet } = require('./_lib/sitzung');
const { errorResponse, istGueltigeId } = require('./_lib/http');
const { datumLesbar } = require('./_lib/zahlung');
const { treffpunktVon } = require('./_lib/rechnung');

exports.handler = async (event) => {
  blobsVerbinden(event);
  if (event.httpMethod !== 'GET') return errorResponse(405, 'Nur GET erlaubt.');
  const a = angemeldet(event, {});
  if (!a.konfiguriert) return errorResponse(500, 'Verwaltung nicht eingerichtet.');
  if (!a.ok) return errorResponse(401, 'Bitte in der Verwaltung anmelden.');

  const q = event.queryStringParameters || {};
  const terminId = typeof q.terminId === 'string' ? q.terminId.trim() : '';
  if (!istGueltigeId(terminId)) return errorResponse(400, 'Ungültige Termin-ID.');

  try {
    const state = await readState();
    const termin = state.termine.find((t) => t.id === terminId);
    if (!termin) return errorResponse(404, 'Termin nicht gefunden.');
    const fuehrung = findFuehrung(state, termin.fuehrungId) || { titel: 'Führung', ort: '' };
    const teilnehmer = state.buchungen
      .filter((b) => b.terminId === terminId && ((b.status || 'bezahlt') === 'bezahlt' || b.status === 'pruefen'))
      .sort((x, y) => x.name.localeCompare(y.name, 'de'));

    const doc = await PDFDocument.create();
    doc.setTitle('Teilnehmerliste ' + termin.datumIso);
    const normal = await doc.embedFont(StandardFonts.Helvetica);
    const fett = await doc.embedFont(StandardFonts.HelveticaBold);
    const grau = rgb(0.4, 0.4, 0.4);
    const gruen = rgb(0.435, 0.561, 0.18);
    const rand = 40;
    const B = 841.89; // Querformat A4
    const H = 595.28;
    let seite = doc.addPage([B, H]);
    let y = H - rand;
    const text = (t, x, yy, o = {}) => seite.drawText(String(t), { x, y: yy, size: o.size || 9, font: o.fett ? fett : normal, color: o.farbe || rgb(0.1, 0.1, 0.1) });

    const kopf = () => {
      text(fuehrung.titel, rand, y - 12, { size: 15, fett: true, farbe: gruen });
      text('Teilnehmerliste · ' + datumLesbar(termin.datumIso, termin.uhrzeit) + (treffpunktVon(fuehrung) ? ' · Treffpunkt ' + treffpunktVon(fuehrung) : ''), rand, y - 28, { size: 10, farbe: grau });
      y -= 50;
      seite.drawLine({ start: { x: rand, y: y + 6 }, end: { x: B - rand, y: y + 6 }, thickness: 0.8, color: gruen });
      y -= 8;
      const sp = spalten();
      text('Nr.', sp.nr, y, { fett: true });
      text('Name', sp.name, y, { fett: true });
      text('Pers.', sp.pers, y, { fett: true });
      text('Telefon', sp.tel, y, { fett: true });
      text('Anreise', sp.anreise, y, { fett: true });
      text('Buchung', sp.buchung, y, { fett: true });
      text('Status', sp.status, y, { fett: true });
      text('Anwesend', sp.anw, y, { fett: true });
      y -= 6;
      seite.drawLine({ start: { x: rand, y }, end: { x: B - rand, y }, thickness: 0.4, color: grau });
      y -= 16;
    };
    const spalten = () => ({ nr: rand, name: rand + 30, pers: rand + 250, tel: rand + 295, anreise: rand + 410, buchung: rand + 510, status: rand + 620, anw: rand + 700 });

    kopf();
    let gesamtPersonen = 0;
    let fahrzeuge = 0;
    teilnehmer.forEach((b, i) => {
      if (y < rand + 50) {
        seite = doc.addPage([B, H]);
        y = H - rand;
        kopf();
      }
      const sp = spalten();
      text(String(i + 1), sp.nr, y);
      text(b.name.slice(0, 48), sp.name, y, { fett: true });
      text(String(b.personen), sp.pers, y);
      text(b.telefon || '–', sp.tel, y);
      text(b.fahrzeug === 'eigen' ? 'eigenes Kfz' : b.fahrzeug === 'mitfahrer' ? 'Mitfahrer' : '–', sp.anreise, y);
      text(b.nummer || '–', sp.buchung, y);
      text(b.status === 'pruefen' ? 'PRÜFEN (Betrag)' : 'bezahlt', sp.status, y, { farbe: b.status === 'pruefen' ? rgb(0.73, 0.25, 0.18) : grau });
      // Kästchen zum Abhaken
      seite.drawRectangle({ x: sp.anw + 10, y: y - 3, width: 11, height: 11, borderWidth: 0.8, borderColor: grau });
      gesamtPersonen += b.personen;
      if (b.fahrzeug === 'eigen') fahrzeuge += 1;
      y -= 18;
    });
    if (teilnehmer.length === 0) {
      text('Noch keine bezahlten Buchungen für diesen Termin.', rand, y, { farbe: grau });
      y -= 18;
    }
    y -= 6;
    seite.drawLine({ start: { x: rand, y }, end: { x: B - rand, y }, thickness: 0.4, color: grau });
    y -= 16;
    text('Buchungen: ' + teilnehmer.length + '   ·   Personen: ' + gesamtPersonen + ' von ' + termin.maxPersonen + '   ·   Fahrzeuge in der Kolonne: ' + fahrzeuge, rand, y, { size: 10, fett: true });
    y -= 14;
    text('Stand: ' + new Date().toLocaleString('de-DE', { timeZone: 'Europe/Berlin' }) + ' Uhr · Nur für den Tourleiter, nicht weitergeben (personenbezogene Daten).', rand, y, { size: 8, farbe: grau });

    const bytes = await doc.save();
    return {
      statusCode: 200,
      headers: {
        'Content-Type': 'application/pdf',
        'Content-Disposition': 'inline; filename="Teilnehmerliste-' + termin.datumIso + '.pdf"',
        'Cache-Control': 'private, no-store',
      },
      body: Buffer.from(bytes).toString('base64'),
      isBase64Encoded: true,
    };
  } catch (err) {
    console.error('teilnehmerliste Fehler:', err);
    return errorResponse(500, 'Teilnehmerliste konnte nicht erstellt werden.');
  }
};
