// Öffentliche, ungeschützte Function: legt eine Buchung für einen Termin an.
// Prüft serverseitig (nicht nur im Frontend), ob genug Plätze frei sind, und schreibt
// atomar über withState() — Überbuchen bei gleichzeitigen Anfragen ist damit ausgeschlossen.

const { withState, belegtePersonen, terminDatumZeit, findFuehrung, neueId } = require('./_lib/store');
const {
  json,
  errorResponse,
  parseBody,
  isNichtLeererText,
  istGueltigeEmail,
  istGanzzahlInBereich,
} = require('./_lib/http');

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') {
    return errorResponse(405, 'Nur POST erlaubt.');
  }

  const body = parseBody(event);
  if (body === null) {
    return errorResponse(400, 'Ungültige Anfrage.');
  }

  const terminId = typeof body.terminId === 'string' ? body.terminId.trim() : '';
  const name = typeof body.name === 'string' ? body.name.trim() : '';
  const email = typeof body.email === 'string' ? body.email.trim() : '';
  const personen = Number(body.personen);

  if (!terminId) return errorResponse(400, 'Kein Termin angegeben.');
  if (!isNichtLeererText(name, 120)) return errorResponse(400, 'Bitte einen Namen angeben.');
  if (!istGueltigeEmail(email)) return errorResponse(400, 'Bitte eine gültige E-Mail-Adresse angeben.');
  if (!istGanzzahlInBereich(personen, 1, 50)) {
    return errorResponse(400, 'Bitte eine Personenzahl zwischen 1 und 50 angeben.');
  }

  try {
    const result = await withState((state) => {
      const termin = state.termine.find((t) => t.id === terminId);
      if (!termin) {
        return { ok: false, status: 404, error: 'Dieser Termin existiert nicht mehr.' };
      }
      if (terminDatumZeit(termin).getTime() < Date.now()) {
        return { ok: false, status: 400, error: 'Dieser Termin liegt bereits in der Vergangenheit.' };
      }

      const belegt = belegtePersonen(state, terminId);
      const frei = termin.maxPersonen - belegt;
      if (personen > frei) {
        return {
          ok: false,
          status: 409,
          error:
            frei <= 0
              ? 'Dieser Termin ist inzwischen ausgebucht.'
              : `Nur noch ${frei} von ${termin.maxPersonen} Plätzen frei — bitte Personenzahl anpassen.`,
        };
      }

      const fuehrung = findFuehrung(state, termin.fuehrungId);

      const buchung = {
        id: neueId(),
        terminId,
        name,
        email,
        personen,
        erstelltAm: new Date().toISOString(),
      };
      state.buchungen.push(buchung);

      return {
        ok: true,
        buchung: { id: buchung.id, personen: buchung.personen },
        termin: {
          datumIso: termin.datumIso,
          uhrzeit: termin.uhrzeit,
          preisProPerson: fuehrung ? fuehrung.preisProPerson : null,
        },
        freiePlaetzeDanach: frei - personen,
      };
    });

    if (!result.ok) {
      return errorResponse(result.status || 400, result.error);
    }
    return json(200, result);
  } catch (err) {
    console.error('buchung-erstellen Fehler:', err);
    return errorResponse(500, 'Buchung konnte nicht gespeichert werden. Bitte später erneut versuchen.');
  }
};
