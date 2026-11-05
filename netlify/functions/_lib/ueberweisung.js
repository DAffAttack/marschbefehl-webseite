// Banküberweisung (E7, 04.11.2026): Was passiert, wenn ein Gast auf der Bezahlseite
// „Überweisung“ wählt, wenn die Frist verstreicht und wenn erinnert werden muss.
//
// Ablauf:
//   1. Stripe meldet „Sitzung abgeschlossen, noch unbezahlt“ und die Zahlung hat eine
//      Überweisungsanweisung → Webhook setzt Status „wartet-ueberweisung“, Frist und die
//      Überweisungsdaten (IBAN, Verwendungszweck …) an der Buchung; danach Mail an den Gast
//      (nachUeberweisungGewaehlt).
//   2. Geht das Geld ein, meldet Stripe async_payment_succeeded → der normale Weg
//      (bezahlt, Rechnung, Bestätigungsmail) in stripe-webhook.js / nachzahlung.js.
//   3. Verstreicht die Frist, gibt aufraeumen.js den Platz frei (Status „abgelaufen“) und ruft
//      nachUeberweisungVerfallen: offene Zahlung bei Stripe abbrechen, Mail an den Gast.
//   4. erinnerung.js schickt nach ERINNERUNG_NACH_TAGEN ohne Eingang einmal eine Erinnerung.

const { withState, readState, findFuehrung, protokoll } = require('./store');
const { zahlungAbbrechen } = require('./zahlung');
const { mailSenden, ueberweisungMail, ueberweisungErinnerungMail, ueberweisungVerfallenMail } = require('./mail');

const ERINNERUNG_NACH_TAGEN = 2;

async function buchungMitUmfeld(buchungId) {
  const state = await readState();
  const b = state.buchungen.find((x) => x.id === buchungId);
  if (!b) return null;
  const termin = state.termine.find((t) => t.id === b.terminId) || null;
  const fuehrung = findFuehrung(state, b.fuehrungId) || { titel: 'Führung', ort: '' };
  return { buchung: b, termin, fuehrung };
}

async function mailMitProtokoll(buchungId, bauen, artOk) {
  const u = await buchungMitUmfeld(buchungId);
  if (!u || !u.termin) return { ok: false, error: 'Buchung oder Termin fehlt.' };
  try {
    const m = bauen(u);
    const erg = await mailSenden({ an: u.buchung.email, betreff: m.betreff, text: m.text, html: m.html });
    await withState((st) => {
      const x = st.buchungen.find((y) => y.id === buchungId);
      if (x) protokoll(st, { art: artOk, buchungId: x.id, nummer: x.nummer, text: erg.betriebsart + ' ' + erg.id });
      return { ok: true };
    });
    return { ok: true, mailId: erg.id };
  } catch (err) {
    console.error('ueberweisung: Mail (' + artOk + ') fehlgeschlagen:', err.message);
    await withState((st) => {
      const x = st.buchungen.find((y) => y.id === buchungId);
      if (x) protokoll(st, { art: 'mail-fehlgeschlagen', buchungId: x.id, nummer: x.nummer, text: artOk + ': ' + String(err.message).slice(0, 200) });
      return { ok: true };
    });
    return { ok: false, error: String(err.message) };
  }
}

/** Nach Wahl der Überweisung: Mail mit IBAN, Verwendungszweck und Frist. */
async function nachUeberweisungGewaehlt(buchungId) {
  const r = await mailMitProtokoll(buchungId, ueberweisungMail, 'mail-ueberweisung');
  if (r.ok) {
    await withState((st) => {
      const x = st.buchungen.find((y) => y.id === buchungId);
      if (x) x.mailUeberweisungAm = new Date().toISOString();
      return { ok: true };
    });
  }
  return r;
}

/** Erinnerung, wenn nach ERINNERUNG_NACH_TAGEN noch nichts eingegangen ist. */
async function ueberweisungErinnern(buchungId) {
  const r = await mailMitProtokoll(buchungId, ueberweisungErinnerungMail, 'mail-ueberweisung-erinnerung');
  if (r.ok) {
    await withState((st) => {
      const x = st.buchungen.find((y) => y.id === buchungId);
      if (x) x.ueberweisungErinnertAm = new Date().toISOString();
      return { ok: true };
    });
  }
  return r;
}

/** Frist verstrichen: offene Zahlung bei Stripe abbrechen, Gast informieren. */
async function nachUeberweisungVerfallen(buchungId) {
  const u = await buchungMitUmfeld(buchungId);
  if (!u) return { ok: false, error: 'Buchung fehlt.' };
  const abbruch = await zahlungAbbrechen({ buchung: u.buchung });
  await withState((st) => {
    const x = st.buchungen.find((y) => y.id === buchungId);
    if (x) protokoll(st, { art: abbruch.ok ? 'zahlung-abgebrochen' : 'zahlung-abbruch-fehlgeschlagen', buchungId: x.id, nummer: x.nummer, text: abbruch.hinweis || abbruch.status || abbruch.error || '' });
    return { ok: true };
  });
  return mailMitProtokoll(buchungId, ueberweisungVerfallenMail, 'mail-ueberweisung-verfallen');
}

module.exports = { nachUeberweisungGewaehlt, ueberweisungErinnern, nachUeberweisungVerfallen, ERINNERUNG_NACH_TAGEN };
