// Zeitgesteuert (netlify.toml: alle 10 Minuten): abgelaufene Reservierungen freigeben.
// Reservierte Buchungen, deren reserviertBis vorbei ist, bekommen Status "abgelaufen".
// Für die Platzzählung sind sie ohnehin schon unsichtbar (belegtPlatz prüft die Zeit);
// hier wird nur der Status nachgezogen, damit Verwaltung und Protokoll stimmen.
//
// Lokal von Hand auslösen: npx netlify functions:invoke aufraeumen

const { withState, protokoll, blobsVerbinden } = require('./_lib/store');

exports.handler = async (event) => {
  blobsVerbinden(event);
  try {
    const result = await withState((state) => {
      const jetzt = Date.now();
      const freigegeben = [];
      for (const b of state.buchungen) {
        if (b.status === 'reserviert' && b.reserviertBis && new Date(b.reserviertBis).getTime() <= jetzt) {
          b.status = 'abgelaufen';
          freigegeben.push(b.nummer);
          protokoll(state, { art: 'reservierung-abgelaufen', buchungId: b.id, nummer: b.nummer });
        }
      }
      if (freigegeben.length === 0) return { ok: false, status: 200, error: 'nichts zu tun' };
      return { ok: true, freigegeben };
    });
    const anzahl = result.ok ? result.freigegeben.length : 0;
    console.log(`aufraeumen: ${anzahl} Reservierung(en) freigegeben`);
    // Zeitgesteuerte Functions geben keine Antwort an einen Aufrufer zurück.
    return { statusCode: 200 };
  } catch (err) {
    console.error('aufraeumen Fehler:', err);
    return { statusCode: 500 };
  }
};
