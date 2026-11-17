// Bewertung einer Führung (17.11.2026). QR-Code auf der Rückseite der Persönlichkeitskarten
// führt auf /bewerten.html, die Seite schickt hierher.
//
// POST {sterne 1..5, text, name?, fuehrung?, zeigen?}      -> öffentlich, speichert eine Bewertung
// GET                                                       -> nur mit Verwaltungs-Sitzung: alle Bewertungen
// POST {aktion:'loeschen', id}                              -> nur mit Verwaltungs-Sitzung: eine löschen
//
// Speicher: eigener Blobs-Store "bewertungen" (mit Endung "-live" auf der echten Seite), ein
// Eintrag je Bewertung. Dadurch keine Schreibkonflikte und keine Berührung der Buchungsdaten.
// Die IP wird nur flüchtig für die Bremse genutzt und nicht gespeichert.

const { getStore } = require('@netlify/blobs');
const { blobsVerbinden, speicherName } = require('./_lib/store');
const { angemeldet } = require('./_lib/sitzung');
const { json, errorResponse, parseBody } = require('./_lib/http');

const MAX_JE_STUNDE = Number(process.env.BEWERTUNG_BREMSE_JE_STUNDE) > 0 ? Number(process.env.BEWERTUNG_BREMSE_JE_STUNDE) : 5;
const versuche = new Map();

function bremseGreift(ip) {
  const jetzt = Date.now();
  const liste = (versuche.get(ip) || []).filter((t) => jetzt - t < 60 * 60 * 1000);
  liste.push(jetzt);
  versuche.set(ip, liste);
  return liste.length > MAX_JE_STUNDE;
}

function clientIp(event) {
  const h = event.headers || {};
  return h['x-nf-client-connection-ip'] || (h['x-forwarded-for'] || '').split(',')[0].trim() || 'unbekannt';
}

function speicher() {
  return getStore({ name: speicherName('bewertungen'), consistency: 'strong' });
}

function kurz(v, max) {
  return typeof v === 'string' ? v.replace(/\s+/g, ' ').trim().slice(0, max) : '';
}

const ID_RE = /^\d{13}-[0-9a-f]{8}$/;

exports.handler = async (event) => {
  blobsVerbinden(event);
  const store = speicher();

  if (event.httpMethod === 'GET') {
    const a = angemeldet(event, {});
    if (!a.konfiguriert) return errorResponse(500, 'Verwaltung nicht eingerichtet.');
    if (!a.ok) return errorResponse(401, 'Bitte anmelden.');
    const { blobs } = await store.list();
    const liste = [];
    for (const b of blobs) {
      const d = await store.get(b.key, { type: 'json' });
      if (d) liste.push(d);
    }
    liste.sort((x, y) => y.zeit.localeCompare(x.zeit));
    const schnitt = liste.length ? liste.reduce((s, b) => s + b.sterne, 0) / liste.length : 0;
    return json(200, { ok: true, anzahl: liste.length, schnitt: Math.round(schnitt * 10) / 10, bewertungen: liste });
  }

  if (event.httpMethod !== 'POST') return errorResponse(405, 'Nur GET oder POST erlaubt.');
  const body = parseBody(event);
  if (body === null) return errorResponse(400, 'Ungültige Anfrage.');

  if (body.aktion === 'loeschen') {
    const a = angemeldet(event, body);
    if (!a.konfiguriert) return errorResponse(500, 'Verwaltung nicht eingerichtet.');
    if (!a.ok) return errorResponse(401, 'Bitte anmelden.');
    if (typeof body.id !== 'string' || !ID_RE.test(body.id)) return errorResponse(400, 'Ungültige ID.');
    await store.delete(body.id);
    return json(200, { ok: true });
  }

  // Honigtopf: echte Gäste füllen dieses unsichtbare Feld nie aus.
  if (typeof body.firma === 'string' && body.firma.trim() !== '') return json(200, { ok: true });

  if (bremseGreift(clientIp(event))) {
    return errorResponse(429, 'Danke! Von diesem Anschluss kamen gerade schon mehrere Bewertungen. Bitte später noch einmal.');
  }

  const sterne = Number(body.sterne);
  if (!Number.isInteger(sterne) || sterne < 1 || sterne > 5) return errorResponse(400, 'Bitte 1 bis 5 Sterne wählen.');
  const text = typeof body.text === 'string' ? body.text.trim().slice(0, 1500) : '';
  const eintrag = {
    id: Date.now() + '-' + require('crypto').randomBytes(4).toString('hex'),
    zeit: new Date().toISOString(),
    sterne,
    text,
    name: kurz(body.name, 80),
    fuehrung: kurz(body.fuehrung, 120),
    zeigen: body.zeigen === true,
  };
  await store.setJSON(eintrag.id, eintrag);
  return json(200, { ok: true });
};
