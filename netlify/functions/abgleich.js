// Zeitgesteuert (netlify.toml: täglich 06:00 UTC): Abgleich Zahlungsanbieter ↔ Buchungen.
// Lokal: GET /.netlify/functions/abgleich (Ergebnis im Log und in der Verwaltung unter
// "Abgleich"). Die Verwaltung kann den Abgleich auch per Knopf auslösen (admin-api).

const { blobsVerbinden } = require('./_lib/store');
const { abgleichDurchfuehren } = require('./_lib/abgleich');

exports.handler = async (event) => {
  blobsVerbinden(event);
  try {
    const r = await abgleichDurchfuehren();
    if (!r.ok) console.error('abgleich:', r.error);
    else console.log(`abgleich: ${r.geprueft.zahlungen} Zahlungen, ${r.geprueft.buchungen} Buchungen, ${r.abweichungen.length} Abweichung(en) – ${r.note}`);
    return { statusCode: 200 };
  } catch (err) {
    console.error('abgleich Fehler:', err);
    return { statusCode: 500 };
  }
};
