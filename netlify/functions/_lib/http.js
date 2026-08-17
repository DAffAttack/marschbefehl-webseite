// Kleine Helfer für einheitliche JSON-Antworten in allen Functions.

function json(statusCode, obj) {
  return {
    statusCode,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-store',
    },
    body: JSON.stringify(obj),
  };
}

function errorResponse(status, error) {
  return json(status || 400, { ok: false, error: error || 'Unbekannter Fehler.' });
}

function parseBody(event) {
  try {
    return event.body ? JSON.parse(event.body) : {};
  } catch (err) {
    return null;
  }
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const DATUM_RE = /^\d{4}-\d{2}-\d{2}$/;
const UHRZEIT_RE = /^\d{2}:\d{2}$/;

function isNichtLeererText(v, maxLen) {
  return typeof v === 'string' && v.trim().length > 0 && v.trim().length <= (maxLen || 200);
}

function istGueltigeEmail(v) {
  return typeof v === 'string' && v.trim().length <= 200 && EMAIL_RE.test(v.trim());
}

function istGanzzahlInBereich(v, min, max) {
  return typeof v === 'number' && Number.isInteger(v) && v >= min && v <= max;
}

// UUID v4-Format, wie es crypto.randomUUID() erzeugt — genutzt, um Bild-/Führungs-/
// Termin-IDs grob zu validieren, bevor damit gegen den Blob-Store gearbeitet wird.
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function istGueltigeId(v) {
  return typeof v === 'string' && UUID_RE.test(v.trim());
}

module.exports = {
  json,
  errorResponse,
  parseBody,
  isNichtLeererText,
  istGueltigeEmail,
  istGanzzahlInBereich,
  istGueltigeId,
  DATUM_RE,
  UHRZEIT_RE,
  UUID_RE,
};
