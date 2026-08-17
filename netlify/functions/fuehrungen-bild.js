// Öffentliche, ungeschützte Function: liefert ein einzelnes Führungs-Bild anhand
// seiner ID aus dem Blob-Store "fuehrungen-bilder" aus. Netlify Blobs sind nicht von
// sich aus über eine öffentliche URL erreichbar — diese Function übernimmt das
// Streamen, inklusive korrektem Content-Type und langem Cache (Bilder sind über ihre
// UUID inhaltlich unveränderlich: ein Ersetzen erzeugt immer eine neue ID).

const { getBilderStore } = require('./_lib/store');
const { errorResponse, istGueltigeId } = require('./_lib/http');

exports.handler = async (event) => {
  if (event.httpMethod !== 'GET') {
    return errorResponse(405, 'Nur GET erlaubt.');
  }

  const id = event.queryStringParameters && event.queryStringParameters.id;
  if (!id || !istGueltigeId(id)) {
    return errorResponse(400, 'Ungültige Bild-ID.');
  }

  try {
    const store = getBilderStore();
    const entry = await store.getWithMetadata(id, { type: 'arrayBuffer' });
    if (!entry) {
      return errorResponse(404, 'Bild nicht gefunden.');
    }

    const contentType = (entry.metadata && entry.metadata.contentType) || 'application/octet-stream';

    return {
      statusCode: 200,
      headers: {
        'Content-Type': contentType,
        'Cache-Control': 'public, max-age=31536000, immutable',
      },
      body: Buffer.from(entry.data).toString('base64'),
      isBase64Encoded: true,
    };
  } catch (err) {
    console.error('fuehrungen-bild Fehler:', err);
    return errorResponse(500, 'Bild konnte nicht geladen werden.');
  }
};
