// Zeitgesteuert (netlify.toml: alle 10 Minuten): abgelaufene Reservierungen freigeben.
// Reservierte Buchungen, deren reserviertBis vorbei ist, bekommen Status "abgelaufen".
// Für die Platzzählung sind sie ohnehin schon unsichtbar (belegtPlatz prüft die Zeit);
// hier wird nur der Status nachgezogen, damit Verwaltung und Protokoll stimmen.
//
// Lokal von Hand auslösen: npx netlify functions:invoke aufraeumen

const { withState, protokoll, blobsVerbinden } = require('./_lib/store');
const { nachUeberweisungVerfallen } = require('./_lib/ueberweisung');

exports.handler = async (event) => {
  blobsVerbinden(event);
  try {
    const result = await withState((state) => {
      const jetzt = Date.now();
      const freigegeben = [];
      const verfallen = [];
      for (const b of state.buchungen) {
        if (b.status === 'reserviert' && b.reserviertBis && new Date(b.reserviertBis).getTime() <= jetzt) {
          b.status = 'abgelaufen';
          freigegeben.push(b.nummer);
          protokoll(state, { art: 'reservierung-abgelaufen', buchungId: b.id, nummer: b.nummer });
        }
        // Überweisung (E7): Frist verstrichen, kein Geldeingang → Platz frei, Buchung verfallen.
        if (b.status === 'wartet-ueberweisung' && b.ueberweisungFrist && new Date(b.ueberweisungFrist).getTime() <= jetzt) {
          b.status = 'abgelaufen';
          b.ueberweisungVerfallenAm = new Date().toISOString();
          verfallen.push(b.id);
          protokoll(state, { art: 'ueberweisung-verfallen', buchungId: b.id, nummer: b.nummer, text: 'Frist ' + b.ueberweisungFrist.slice(0, 10) });
        }
      }
      if (freigegeben.length === 0 && verfallen.length === 0) return { ok: false, status: 200, error: 'nichts zu tun' };
      return { ok: true, freigegeben, verfallen };
    });
    // Verfallene Überweisungen: offene Zahlung bei Stripe abbrechen, Gast informieren.
    for (const id of (result.ok && result.verfallen) || []) {
      try { await nachUeberweisungVerfallen(id); } catch (err) { console.error('aufraeumen: Nachbereitung Überweisung fehlgeschlagen:', err.message); }
    }
    const anzahl = result.ok ? result.freigegeben.length : 0;
    console.log(`aufraeumen: ${anzahl} Reservierung(en) freigegeben, ${result.ok ? result.verfallen.length : 0} Überweisung(en) verfallen`);
    // Zeitgesteuerte Functions geben keine Antwort an einen Aufrufer zurück.
    return { statusCode: 200 };
  } catch (err) {
    console.error('aufraeumen Fehler:', err);
    return { statusCode: 500 };
  }
};
