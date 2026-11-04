// Zeitgesteuert (netlify.toml, täglich 07:00 UTC = 08:00/09:00 Berlin): Erinnerungsmail an
// alle bezahlten Buchungen, deren Termin in genau drei Tagen liegt. Jede Buchung bekommt
// die Erinnerung nur einmal (erinnertAm).
//
// Lokal prüfen: GET /.netlify/functions/erinnerung?datum=2026-12-09  (nur unter netlify dev;
// "datum" ist der angenommene heutige Tag; Ergebnis steht im Server-Log, die Antwort ist
// die Standardmeldung der CLI für zeitgesteuerte Functions).

const { readState, withState, findFuehrung, protokoll, blobsVerbinden } = require('./_lib/store');
const { mailSenden, erinnerungsMail } = require('./_lib/mail');
const { zelloAnhang } = require('./_lib/zello');

const VORLAUF_TAGE = 3;

function heuteBerlin() {
  // JJJJ-MM-TT in Europe/Berlin
  return new Intl.DateTimeFormat('sv-SE', { timeZone: 'Europe/Berlin', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
}

function tageAddieren(iso, tage) {
  const d = new Date(iso + 'T12:00:00Z');
  d.setUTCDate(d.getUTCDate() + tage);
  return d.toISOString().slice(0, 10);
}

exports.handler = async (event) => {
  blobsVerbinden(event);
  const q = (event && event.queryStringParameters) || {};
  const heute = process.env.NETLIFY_DEV === 'true' && /^\d{4}-\d{2}-\d{2}$/.test(q.datum || '') ? q.datum : heuteBerlin();
  const ziel = tageAddieren(heute, VORLAUF_TAGE);

  let gesendet = 0;
  let fehlgeschlagen = 0;
  try {
    const state = await readState();
    const faellig = state.buchungen.filter((b) => {
      if (b.status !== 'bezahlt' || b.erinnertAm) return false;
      const t = state.termine.find((x) => x.id === b.terminId);
      return t && t.datumIso === ziel;
    });
    for (const b of faellig) {
      const termin = state.termine.find((x) => x.id === b.terminId);
      const fuehrung = findFuehrung(state, b.fuehrungId);
      if (!termin || !fuehrung) continue;
      const m = erinnerungsMail({ buchung: b, fuehrung, termin });
      try {
        const erg = await mailSenden({ an: b.email, betreff: m.betreff, text: m.text, html: m.html, anhaenge: await zelloAnhang() });
        await withState((st) => {
          const x = st.buchungen.find((y) => y.id === b.id);
          if (x) {
            x.erinnertAm = new Date().toISOString();
            protokoll(st, { art: 'mail-erinnerung', buchungId: x.id, nummer: x.nummer, text: erg.betriebsart + ' ' + erg.id });
          }
          return { ok: true };
        });
        gesendet++;
      } catch (err) {
        fehlgeschlagen++;
        console.error('erinnerung: Mail an ' + b.nummer + ' fehlgeschlagen:', err.message);
        await withState((st) => {
          const x = st.buchungen.find((y) => y.id === b.id);
          if (x) protokoll(st, { art: 'mail-erinnerung-fehlgeschlagen', buchungId: x.id, nummer: x.nummer, text: String(err.message).slice(0, 200) });
          return { ok: true };
        });
      }
    }
    console.log(`erinnerung (${heute} → ${ziel}): ${gesendet} gesendet, ${fehlgeschlagen} fehlgeschlagen, ${faellig.length} fällig`);
    // Zeitgesteuerte Functions geben keine Antwort an einen Aufrufer zurück (Ergebnis steht im Log).
    return { statusCode: 200 };
  } catch (err) {
    console.error('erinnerung Fehler:', err);
    return { statusCode: 500 };
  }
};
