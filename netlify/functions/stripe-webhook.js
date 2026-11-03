// Webhook: Stripe meldet hier das Ergebnis einer Bezahlsitzung.
//
// Sicherheit:
//   - Signatur wird mit STRIPE_WEBHOOK_SECRET geprüft (ungültig -> 400, nichts passiert).
//   - Jede Ereignis-ID wird nur einmal verarbeitet (Idempotenz: Stripe schickt bei
//     Zeitüberschreitung dasselbe Ereignis erneut).
//   - Die Buchung wird über metadata.buchungId gefunden UND die Sitzungs-ID muss zur
//     gespeicherten passen.
//   - Betrag und Währung müssen exakt zur Buchung passen; sonst Status "pruefen"
//     (Abgleich zeigt das rot an), nie stillschweigend "bezahlt".
//
// Rückgabe immer 200 nach erfolgreicher Verarbeitung, auch wenn wir das Ereignis nicht
// brauchen — sonst versucht Stripe es tagelang erneut.

const { withState, protokoll, ereignisSchonVerarbeitet, ereignisMerken, blobsVerbinden } = require('./_lib/store');
const { webhookEreignisLesen, WAEHRUNG } = require('./_lib/zahlung');
const { json, errorResponse } = require('./_lib/http');
const { nachZahlung } = require('./_lib/nachzahlung');

function sitzungVerarbeiten(state, ereignis) {
  const sitzung = ereignis.data && ereignis.data.object;
  if (!sitzung || sitzung.object !== 'checkout.session') return { ok: true, hinweis: 'kein Checkout-Objekt' };

  const buchungId = sitzung.metadata && sitzung.metadata.buchungId;
  const b = buchungId ? state.buchungen.find((x) => x.id === buchungId) : null;
  if (!b) {
    protokoll(state, { art: 'webhook-ohne-buchung', text: `${ereignis.type} ${sitzung.id}` });
    return { ok: true, hinweis: 'Buchung unbekannt' };
  }
  if (b.stripeSessionId && b.stripeSessionId !== sitzung.id) {
    protokoll(state, { art: 'webhook-sitzung-fremd', buchungId: b.id, nummer: b.nummer, text: `${sitzung.id} statt ${b.stripeSessionId}` });
    return { ok: true, hinweis: 'Sitzung passt nicht zur Buchung' };
  }

  const bezahlt = ereignis.type === 'checkout.session.async_payment_succeeded'
    || (ereignis.type === 'checkout.session.completed' && sitzung.payment_status === 'paid');

  if (bezahlt) {
    const betragOk = sitzung.amount_total === b.betragCent && String(sitzung.currency).toLowerCase() === WAEHRUNG;
    if (!betragOk) {
      b.status = 'pruefen';
      b.stripePaymentIntent = typeof sitzung.payment_intent === 'string' ? sitzung.payment_intent : b.stripePaymentIntent;
      protokoll(state, { art: 'zahlung-betrag-abweichung', buchungId: b.id, nummer: b.nummer, text: `erwartet ${b.betragCent} ${WAEHRUNG}, gemeldet ${sitzung.amount_total} ${sitzung.currency}` });
      return { ok: true, hinweis: 'Betrag weicht ab' };
    }
    if (b.status === 'bezahlt') return { ok: true, hinweis: 'schon bezahlt' };
    const warAbgelaufen = b.status === 'abgelaufen' || b.status === 'storniert';
    b.status = 'bezahlt';
    b.bezahltAm = new Date().toISOString();
    b.stripePaymentIntent = typeof sitzung.payment_intent === 'string' ? sitzung.payment_intent : b.stripePaymentIntent;
    b.zahlungsEmail = sitzung.customer_email || sitzung.customer_details && sitzung.customer_details.email || b.email;
    protokoll(state, { art: warAbgelaufen ? 'zahlung-nach-ablauf' : 'zahlung-eingegangen', buchungId: b.id, nummer: b.nummer, text: `${b.betragCent / 100} €` });
    // Hinweis: Eine Zahlung nach Ablauf der Reservierung wird trotzdem als bezahlt
    // gebucht (das Geld ist da). Ob der Platz noch frei ist, zeigt die Verwaltung;
    // bei Überbuchung erstattet der Nutzer per Storno-Knopf.
    return { ok: true, hinweis: 'bezahlt', buchungId: b.id };
  }

  if (ereignis.type === 'checkout.session.async_payment_failed' || ereignis.type === 'checkout.session.expired') {
    if (b.status === 'reserviert') {
      b.status = 'abgelaufen';
      protokoll(state, { art: ereignis.type === 'checkout.session.expired' ? 'bezahlsitzung-abgelaufen' : 'zahlung-fehlgeschlagen', buchungId: b.id, nummer: b.nummer });
    }
    return { ok: true, hinweis: 'freigegeben' };
  }

  if (ereignis.type === 'checkout.session.completed') {
    // completed mit payment_status "unpaid": Zahlung läuft noch (z. B. Lastschrift) —
    // warten auf async_payment_succeeded. Reservierung bleibt bis zum Ablauf.
    protokoll(state, { art: 'zahlung-ausstehend', buchungId: b.id, nummer: b.nummer, text: sitzung.payment_status });
    return { ok: true, hinweis: 'ausstehend' };
  }

  return { ok: true, hinweis: 'ignoriert' };
}

exports.handler = async (event) => {
  blobsVerbinden(event);
  if (event.httpMethod !== 'POST') return errorResponse(405, 'Nur POST erlaubt.');

  let ereignis;
  try {
    ereignis = webhookEreignisLesen(event);
  } catch (err) {
    console.error('stripe-webhook: Signatur ungültig:', err.message);
    return errorResponse(400, 'Ungültige Signatur.');
  }

  try {
    const result = await withState((state) => {
      if (ereignisSchonVerarbeitet(state, ereignis.id)) return { ok: true, hinweis: 'schon verarbeitet' };
      ereignisMerken(state, ereignis.id);
      return sitzungVerarbeiten(state, ereignis);
    }, {
      bestaetigen: (state) => ereignisSchonVerarbeitet(state, ereignis.id),
    });
    // Nach bestätigter Zahlung: Rechnung erzeugen und Bestätigungsmail senden. Fehler dabei
    // ändern nichts am Status "bezahlt" (Protokoll + "Mail erneut senden" in der Verwaltung).
    let nach = null;
    if (result.hinweis === 'bezahlt' && result.buchungId) {
      try {
        nach = await nachZahlung(result.buchungId);
      } catch (err) {
        console.error('stripe-webhook: Nachbereitung fehlgeschlagen:', err);
        nach = { ok: false, error: String(err && err.message) };
      }
    }
    return json(200, { ok: true, hinweis: result.hinweis || '', nach: nach ? { ok: nach.ok, hinweis: nach.hinweis || nach.error || '', rechnungsnummer: nach.rechnungsnummer || null } : undefined });
  } catch (err) {
    console.error('stripe-webhook Fehler:', err);
    // 500 -> Stripe versucht es später erneut (Idempotenz fängt Doppelungen ab).
    return errorResponse(500, 'Verarbeitung fehlgeschlagen.');
  }
};
