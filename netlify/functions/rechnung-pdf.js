// Liefert das Rechnungs-PDF einer bezahlten Buchung. Zugriff wie bei buchung-status nur mit
// Buchungsnummer UND Sitzungs-ID (Link auf der Danke-Seite, in der Verwaltung).

const { readState, blobsVerbinden, getRechnungenStore } = require('./_lib/store');
const { errorResponse } = require('./_lib/http');

exports.handler = async (event) => {
  blobsVerbinden(event);
  if (event.httpMethod !== 'GET') return errorResponse(405, 'Nur GET erlaubt.');
  const q = event.queryStringParameters || {};
  const nr = typeof q.nr === 'string' ? q.nr.trim() : '';
  const s = typeof q.s === 'string' ? q.s.trim() : '';
  if (!/^ZSH-\d{4}-\d{4}$/.test(nr) || !/^cs_[A-Za-z0-9_]{8,120}$/.test(s)) return errorResponse(400, 'Ungültige Anfrage.');
  try {
    const state = await readState();
    const b = state.buchungen.find((x) => x.nummer === nr && x.stripeSessionId === s);
    if (!b) return errorResponse(404, 'Buchung nicht gefunden.');
    if (!b.rechnungsnummer) {
      return {
        statusCode: 404,
        headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' },
        body: '<!DOCTYPE html><html lang="de"><body style="font-family:Segoe UI,Arial;padding:40px;"><h1>Rechnung wird noch erstellt</h1><p>Die Zahlung ist eingegangen, die Rechnung folgt in wenigen Augenblicken. Bitte die Seite in einer Minute neu laden.</p></body></html>',
      };
    }
    const pdf = await getRechnungenStore().get(b.rechnungsnummer, { type: 'arrayBuffer' });
    if (!pdf) return errorResponse(404, 'Rechnung nicht gefunden.');
    return {
      statusCode: 200,
      headers: {
        'Content-Type': 'application/pdf',
        'Content-Disposition': 'inline; filename="Rechnung-' + b.rechnungsnummer + '.pdf"',
        'Cache-Control': 'private, no-store',
      },
      body: Buffer.from(pdf).toString('base64'),
      isBase64Encoded: true,
    };
  } catch (err) {
    console.error('rechnung-pdf Fehler:', err);
    return errorResponse(500, 'Rechnung konnte nicht geladen werden.');
  }
};
