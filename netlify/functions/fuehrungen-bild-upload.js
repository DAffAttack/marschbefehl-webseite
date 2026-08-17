// Passwortgeschützte Function: nimmt ein Bild (Übersichts- oder Detailbild einer
// Führung) entgegen und legt es im separaten Blob-Store "fuehrungen-bilder" ab.
//
// Übertragungsweg: Das Bild kommt als Base64-String im JSON-Body an (kein Multipart-
// Parsing nötig — für einen internen Admin-Upload mit einzelnen Bildern angemessen
// einfach). Netlify Functions (klassisch, AWS-Lambda-basiert) haben ein Body-Limit von
// rund 6 MB; Base64 vergrößert die Rohdaten um ca. 37% — deshalb ist die Originaldatei
// hart auf 3 MB begrenzt (ergibt ca. 4,1 MB Base64-Body, mit deutlichem Puffer zum Limit).
//
// Nur gängige Bildformate zugelassen (JPEG/PNG/WebP) — bewusst keine SVGs (XSS-Risiko)
// oder beliebige Dateitypen, da das Bild direkt öffentlich ausgeliefert wird.

const crypto = require('crypto');
const { getBilderStore } = require('./_lib/store');
const { json, errorResponse, parseBody } = require('./_lib/http');

const ERLAUBTE_TYPEN = ['image/jpeg', 'image/png', 'image/webp'];
const MAX_BYTES = 3 * 1024 * 1024; // 3 MB Originaldatei

function passwortStimmt(eingabe) {
  const erwartet = process.env.FUEHRUNGEN_ADMIN_PASSWORD;
  if (!erwartet || typeof erwartet !== 'string' || erwartet.length === 0) {
    return { konfiguriert: false, stimmt: false };
  }
  if (typeof eingabe !== 'string' || eingabe.length === 0) {
    return { konfiguriert: true, stimmt: false };
  }
  const a = crypto.createHash('sha256').update(eingabe).digest();
  const b = crypto.createHash('sha256').update(erwartet).digest();
  return { konfiguriert: true, stimmt: crypto.timingSafeEqual(a, b) };
}

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') {
    return errorResponse(405, 'Nur POST erlaubt.');
  }

  const body = parseBody(event);
  if (body === null) {
    return errorResponse(400, 'Ungültige Anfrage.');
  }

  const pruefung = passwortStimmt(body.password);
  if (!pruefung.konfiguriert) {
    return errorResponse(
      500,
      'Der Verwaltungsbereich ist noch nicht eingerichtet: Die Umgebungsvariable FUEHRUNGEN_ADMIN_PASSWORD fehlt im Netlify-Projekt.'
    );
  }
  if (!pruefung.stimmt) {
    return errorResponse(401, 'Falsches Passwort.');
  }

  const contentType = typeof body.contentType === 'string' ? body.contentType.trim().toLowerCase() : '';
  const imageBase64Roh = typeof body.imageBase64 === 'string' ? body.imageBase64 : '';
  const filename = typeof body.filename === 'string' ? body.filename.trim().slice(0, 150) : '';

  if (!ERLAUBTE_TYPEN.includes(contentType)) {
    return errorResponse(400, 'Nur JPEG-, PNG- oder WebP-Bilder sind erlaubt.');
  }
  if (!imageBase64Roh) {
    return errorResponse(400, 'Keine Bilddaten übertragen.');
  }

  // Falls das Frontend eine komplette Data-URL schickt ("data:image/png;base64,....."),
  // hier den Präfix abtrennen — robuster als sich auf das Frontend zu verlassen.
  const kommaIdx = imageBase64Roh.indexOf(',');
  const reinesBase64 = imageBase64Roh.startsWith('data:') && kommaIdx !== -1
    ? imageBase64Roh.slice(kommaIdx + 1)
    : imageBase64Roh;

  let buffer;
  try {
    buffer = Buffer.from(reinesBase64, 'base64');
  } catch (err) {
    return errorResponse(400, 'Bilddaten konnten nicht gelesen werden.');
  }

  if (buffer.length === 0) {
    return errorResponse(400, 'Bilddatei ist leer.');
  }
  if (buffer.length > MAX_BYTES) {
    return errorResponse(400, `Bild ist zu groß (max. ${Math.round(MAX_BYTES / 1024 / 1024)} MB).`);
  }

  try {
    const id = crypto.randomUUID();
    const store = getBilderStore();
    await store.set(id, buffer, { metadata: { contentType, filename } });
    return json(200, { ok: true, imageId: id });
  } catch (err) {
    console.error('fuehrungen-bild-upload Fehler:', err);
    // TEMPORÄR (2026-08-17): Klartext-Fehlerdetails mit in die Antwort, damit sich der
    // eigentliche Netlify-Blobs-Fehler direkt in der Verwaltungsseite zeigt, ohne erst
    // durch die Netlify-Dashboard-Logs suchen zu müssen. Vor dem echten Go-Live wieder
    // auf die schlichte Meldung zurücksetzen (kein Grund, Interna öffentlich zu zeigen).
    return errorResponse(
      500,
      'Bild konnte nicht gespeichert werden. Technisches Detail: ' +
        (err && err.name ? err.name + ': ' : '') +
        (err && err.message ? err.message : String(err))
    );
  }
};
