// Öffentliche, ungeschützte Function: liefert kommende, buchbare Führungstermine
// inkl. freier Plätze. Keine Buchungsdaten (Namen/E-Mails) werden hier ausgegeben.
// Optionaler Query-Parameter "fuehrungId" filtert auf die Termine einer einzelnen
// Führung (genutzt von der Detailseite fuehrung.html) — ohne den Parameter kommen
// alle kommenden Termine über alle Führungen hinweg.
//
// Der Preis pro Person liegt seit dem Führungen/Termine-Umbau NICHT mehr am Termin,
// sondern an der übergeordneten Führung — wird hier für die Anzeige mit eingeblendet.

const { readState, belegtePersonen, terminDatumZeit, findFuehrung } = require('./_lib/store');
const { json, errorResponse, istGueltigeId } = require('./_lib/http');

exports.handler = async (event) => {
  if (event.httpMethod !== 'GET') {
    return errorResponse(405, 'Nur GET erlaubt.');
  }

  const fuehrungId = event.queryStringParameters && event.queryStringParameters.fuehrungId;
  if (fuehrungId && !istGueltigeId(fuehrungId)) {
    return errorResponse(400, 'Ungültige Führung-ID.');
  }

  try {
    const state = await readState();
    const jetzt = Date.now();

    const termine = state.termine
      .filter((t) => !fuehrungId || t.fuehrungId === fuehrungId)
      .map((t) => {
        const belegt = belegtePersonen(state, t.id);
        const frei = Math.max(0, t.maxPersonen - belegt);
        const fuehrung = findFuehrung(state, t.fuehrungId);
        return {
          id: t.id,
          fuehrungId: t.fuehrungId,
          fuehrungTitel: fuehrung ? fuehrung.titel : null,
          datumIso: t.datumIso,
          uhrzeit: t.uhrzeit,
          preisProPerson: fuehrung ? fuehrung.preisProPerson : null,
          maxPersonen: t.maxPersonen,
          freiePlaetze: frei,
          ausgebucht: frei <= 0,
        };
      })
      .filter((t) => terminDatumZeit(t).getTime() >= jetzt)
      .sort((a, b) => terminDatumZeit(a).getTime() - terminDatumZeit(b).getTime());

    return json(200, { ok: true, termine });
  } catch (err) {
    console.error('termine-oeffentlich Fehler:', err);
    return errorResponse(500, 'Termine konnten nicht geladen werden.');
  }
};
