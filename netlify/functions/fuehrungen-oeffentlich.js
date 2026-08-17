// Öffentliche, ungeschützte Function: liefert Führungen (Tour-Angebote) für die
// Übersichts- und Detailseite. Ohne "id"-Query-Parameter kommt die Liste aller
// Führungen (für die Kartenübersicht), mit "id" die Detaildaten einer einzelnen
// Führung (für die Detailseite).

const { readState, findFuehrung } = require('./_lib/store');
const { json, errorResponse, istGueltigeId } = require('./_lib/http');

function oeffentlichesUebersichtsFeld(f) {
  return {
    id: f.id,
    titel: f.titel,
    kurzbeschreibung: f.kurzbeschreibung,
    preisProPerson: f.preisProPerson,
    bildUebersichtId: f.bildUebersichtId || null,
  };
}

function oeffentlichesDetailFeld(f) {
  return {
    id: f.id,
    titel: f.titel,
    kurzbeschreibung: f.kurzbeschreibung,
    langbeschreibung: f.langbeschreibung,
    ort: f.ort || '',
    preisProPerson: f.preisProPerson,
    bildUebersichtId: f.bildUebersichtId || null,
    bildDetailId: f.bildDetailId || null,
  };
}

exports.handler = async (event) => {
  if (event.httpMethod !== 'GET') {
    return errorResponse(405, 'Nur GET erlaubt.');
  }

  try {
    const state = await readState();
    const id = event.queryStringParameters && event.queryStringParameters.id;

    if (id) {
      if (!istGueltigeId(id)) {
        return errorResponse(400, 'Ungültige Führung-ID.');
      }
      const fuehrung = findFuehrung(state, id);
      if (!fuehrung) {
        return errorResponse(404, 'Diese Führung existiert nicht (mehr).');
      }
      return json(200, { ok: true, fuehrung: oeffentlichesDetailFeld(fuehrung) });
    }

    const fuehrungen = state.fuehrungen
      .slice()
      .sort((a, b) => new Date(a.erstelltAm) - new Date(b.erstelltAm))
      .map(oeffentlichesUebersichtsFeld);
    return json(200, { ok: true, fuehrungen });
  } catch (err) {
    console.error('fuehrungen-oeffentlich Fehler:', err);
    return errorResponse(500, 'Führungen konnten nicht geladen werden.');
  }
};
