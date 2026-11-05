// Löschfristen aus der Datenschutzerklärung, Abschnitt 9 (eingebaut 05.11.2026). Wird von
// aufraeumen.js aufgerufen. Prüflauf ohne Netz: node werkzeug/bereinigung-pruefen.js
//   Telefon und Anreise: ein Jahr nach dem Termin weg, Name, E-Mail und Rechnungsdaten bleiben
//     wegen der Aufbewahrungspflicht.
//   Abgelaufene, nie bezahlte Reservierungen: ABGELAUFEN_LOESCHEN_TAGE nach Fristende ganz weg.
//     Die Frist liegt über den 35 Tagen des Zahlungs-Abgleichs, damit eine späte Zahlung dort
//     noch einer Buchung zugeordnet werden kann.

const TAG_MS = 24 * 60 * 60 * 1000;
const KONTAKT_LOESCHEN_TAGE = 365;
const ABGELAUFEN_LOESCHEN_TAGE = 40;

function zeitMs(wert) {
  const ms = new Date(wert).getTime();
  return Number.isFinite(ms) ? ms : null;
}

function bezugFuerKontakt(buchung, termine) {
  const termin = termine.find((t) => t.id === buchung.terminId);
  // Termin gelöscht: Das Buchungsdatum liegt davor, die Frist endet also eher früher.
  return zeitMs(termin ? termin.datumIso + 'T23:59:59' : buchung.erstelltAm);
}

function fristEnde(buchung) {
  return zeitMs(buchung.ueberweisungFrist || buchung.reserviertBis);
}

/**
 * Ändert state direkt. Eine Buchung mit Zahlung bleibt immer erhalten.
 * @returns {{kontakte:number, entfernt:string[]}}
 */
function datenBereinigen(state, jetztMs) {
  const entfernt = [];
  let kontakte = 0;
  state.buchungen = state.buchungen.filter((b) => {
    const nieBezahlt = b.status === 'abgelaufen' && !b.bezahltAm && !b.rechnungsnummer;
    const ende = fristEnde(b);
    if (nieBezahlt && ende !== null && jetztMs - ende > ABGELAUFEN_LOESCHEN_TAGE * TAG_MS) {
      entfernt.push(b.nummer);
      return false;
    }
    return true;
  });
  for (const b of state.buchungen) {
    if (!b.telefon && !b.fahrzeug) continue;
    const bezug = bezugFuerKontakt(b, state.termine);
    if (bezug !== null && jetztMs - bezug > KONTAKT_LOESCHEN_TAGE * TAG_MS) {
      b.telefon = '';
      b.fahrzeug = '';
      b.kontaktGeloeschtAm = new Date(jetztMs).toISOString();
      kontakte += 1;
    }
  }
  return { kontakte, entfernt };
}

module.exports = { datenBereinigen, KONTAKT_LOESCHEN_TAGE, ABGELAUFEN_LOESCHEN_TAGE };
