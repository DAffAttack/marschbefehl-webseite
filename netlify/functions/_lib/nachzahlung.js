// Was nach einer bestätigten Zahlung passiert: Rechnungsnummer vergeben, Rechnungs-PDF
// erzeugen und ablegen, Bestätigungsmail (mit PDF) an den Gast, Kopie "Neue Buchung" an
// den Nutzer. Wird vom Webhook aufgerufen und von der Verwaltung ("Mail erneut senden").
//
// Reihenfolge und Fehlerverhalten:
//   - Rechnungsnummer nur einmal je Buchung (bleibt bei erneutem Versand gleich).
//   - PDF wird erzeugt, wenn es noch nicht im Store liegt.
//   - Schlägt der Mailversand fehl, bleibt die Buchung "bezahlt"; im Protokoll steht
//     "mail-fehlgeschlagen" und die Verwaltung bietet "Mail erneut senden" an.

const { withState, readState, findFuehrung, protokoll, neueRechnungsnummer, getRechnungenStore } = require('./store');
const { rechnungPdf } = require('./rechnung');
const { mailSenden, bestaetigungsMail, neueBuchungMail, kopieAn } = require('./mail');

async function rechnungSicherstellen(buchungId) {
  // 1) Nummer vergeben (atomar) und Daten holen
  const r = await withState((state) => {
    const b = state.buchungen.find((x) => x.id === buchungId);
    if (!b) return { ok: false, status: 404, error: 'Buchung nicht gefunden.' };
    if (b.status !== 'bezahlt') return { ok: false, status: 400, error: 'Buchung ist nicht bezahlt (' + b.status + ').' };
    if (!b.rechnungsnummer) {
      b.rechnungsnummer = neueRechnungsnummer(state, new Date());
      b.rechnungsdatum = new Date().toISOString();
      protokoll(state, { art: 'rechnung-nummer', buchungId: b.id, nummer: b.nummer, text: b.rechnungsnummer });
    }
    const termin = state.termine.find((t) => t.id === b.terminId) || null;
    const fuehrung = findFuehrung(state, b.fuehrungId);
    return { ok: true, buchung: JSON.parse(JSON.stringify(b)), termin, fuehrung };
  }, { bestaetigen: (state, result) => state.buchungen.some((x) => x.id === buchungId && x.rechnungsnummer === result.buchung.rechnungsnummer) });
  if (!r.ok) return r;
  if (!r.termin || !r.fuehrung) return { ok: false, status: 500, error: 'Termin oder Führung zur Buchung fehlt.' };

  // 2) PDF holen oder erzeugen
  const store = getRechnungenStore();
  let pdf = await store.get(r.buchung.rechnungsnummer, { type: 'arrayBuffer' });
  if (!pdf) {
    const bytes = await rechnungPdf({ rechnungsnummer: r.buchung.rechnungsnummer, rechnungsdatum: r.buchung.rechnungsdatum, buchung: r.buchung, fuehrung: r.fuehrung, termin: r.termin });
    await store.set(r.buchung.rechnungsnummer, Buffer.from(bytes), { metadata: { buchungId: r.buchung.id, nummer: r.buchung.nummer, contentType: 'application/pdf' } });
    pdf = bytes;
  }
  return { ok: true, ...r, pdf: Buffer.from(pdf) };
}

/**
 * @param {string} buchungId
 * @param {{erneut?:boolean}} [opt] erneut: auch senden, wenn schon einmal gesendet
 */
async function nachZahlung(buchungId, opt) {
  const erneut = Boolean(opt && opt.erneut);
  const r = await rechnungSicherstellen(buchungId);
  if (!r.ok) return r;
  if (r.buchung.mailBestaetigungAm && !erneut) return { ok: true, hinweis: 'schon gesendet', rechnungsnummer: r.buchung.rechnungsnummer };

  const m = bestaetigungsMail({ buchung: r.buchung, fuehrung: r.fuehrung, termin: r.termin, rechnungsnummer: r.buchung.rechnungsnummer });
  let ergebnis;
  try {
    ergebnis = await mailSenden({ an: r.buchung.email, betreff: m.betreff, text: m.text, html: m.html, anhaenge: [{ dateiname: 'Rechnung-' + r.buchung.rechnungsnummer + '.pdf', inhalt: r.pdf, typ: 'application/pdf' }] });
  } catch (err) {
    console.error('nachZahlung: Bestätigungsmail fehlgeschlagen:', err.message);
    await withState((state) => {
      const b = state.buchungen.find((x) => x.id === buchungId);
      if (b) protokoll(state, { art: 'mail-fehlgeschlagen', buchungId: b.id, nummer: b.nummer, text: String(err.message).slice(0, 200) });
      return { ok: true };
    });
    return { ok: false, status: 502, error: 'Bestätigungsmail konnte nicht gesendet werden: ' + err.message, rechnungsnummer: r.buchung.rechnungsnummer };
  }

  await withState((state) => {
    const b = state.buchungen.find((x) => x.id === buchungId);
    if (!b) return { ok: true };
    b.mailBestaetigungAm = new Date().toISOString();
    protokoll(state, { art: erneut ? 'mail-bestaetigung-erneut' : 'mail-bestaetigung', buchungId: b.id, nummer: b.nummer, text: ergebnis.betriebsart + ' ' + ergebnis.id });
    return { ok: true };
  });

  // Kopie "Neue Buchung" an den Nutzer (nur beim ersten Mal, nur wenn eine Adresse hinterlegt ist)
  if (!erneut && kopieAn()) {
    try {
      const k = neueBuchungMail({ buchung: r.buchung, fuehrung: r.fuehrung, termin: r.termin });
      await mailSenden({ an: kopieAn(), betreff: k.betreff, text: k.text, html: k.html });
    } catch (err) {
      console.error('nachZahlung: Kopie an den Nutzer fehlgeschlagen:', err.message);
    }
  }
  return { ok: true, hinweis: erneut ? 'erneut gesendet' : 'gesendet', rechnungsnummer: r.buchung.rechnungsnummer, mailId: ergebnis.id };
}

module.exports = { nachZahlung, rechnungSicherstellen };
