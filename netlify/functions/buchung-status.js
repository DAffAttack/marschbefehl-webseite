// Öffentliche Function für die Danke-Seite: Status einer Buchung.
// Abfrage nur mit Buchungsnummer UND Sitzungs-ID (steht nur in der Rücksprung-Adresse
// von Stripe) — so kann niemand Nummern durchprobieren. Keine persönlichen Daten.

const { readState, findFuehrung, blobsVerbinden } = require('./_lib/store');
const { json, errorResponse } = require('./_lib/http');

exports.handler = async (event) => {
  blobsVerbinden(event);
  if (event.httpMethod !== 'GET') return errorResponse(405, 'Nur GET erlaubt.');
  const q = event.queryStringParameters || {};
  const nr = typeof q.nr === 'string' ? q.nr.trim() : '';
  const s = typeof q.s === 'string' ? q.s.trim() : '';
  if (!/^ZSH-\d{4}-\d{4}$/.test(nr) || !/^cs_[A-Za-z0-9_]{8,120}$/.test(s)) {
    return errorResponse(400, 'Ungültige Anfrage.');
  }
  try {
    const state = await readState();
    const b = state.buchungen.find((x) => x.nummer === nr && x.stripeSessionId === s);
    if (!b) return errorResponse(404, 'Buchung nicht gefunden.');
    const termin = state.termine.find((t) => t.id === b.terminId) || null;
    const fuehrung = findFuehrung(state, b.fuehrungId);
    return json(200, {
      ok: true,
      nummer: b.nummer,
      status: b.status,
      personen: b.personen,
      betragCent: b.betragCent,
      reserviertBis: b.reserviertBis,
      termin: termin ? { datumIso: termin.datumIso, uhrzeit: termin.uhrzeit } : null,
      fuehrungTitel: fuehrung ? fuehrung.titel : null,
      fuehrungId: b.fuehrungId,
    });
  } catch (err) {
    console.error('buchung-status Fehler:', err);
    return errorResponse(500, 'Status konnte nicht geladen werden.');
  }
};
