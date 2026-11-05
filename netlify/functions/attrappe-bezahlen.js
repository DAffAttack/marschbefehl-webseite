// NUR LOKAL (netlify dev ohne STRIPE_SECRET_KEY): simuliert das Ergebnis einer Zahlung.
// Erzeugt ein korrekt signiertes Ereignis im Stripe-Format und schickt es durch den
// echten Webhook-Code (stripe-webhook.js) — derselbe Weg wie bei Stripe, nur ohne Stripe.
// Auf Netlify antwortet diese Function immer mit 403, weil attrappeAktiv() dort false ist.

const { readState, withState, protokoll, blobsVerbinden } = require('./_lib/store');
const { attrappeAktiv, attrappeEreignis } = require('./_lib/zahlung');
const { json, errorResponse, parseBody } = require('./_lib/http');
const webhook = require('./stripe-webhook');

// Ergebnisse der Attrappe:
//   bezahlt                  Karte/PayPal sofort bezahlt (completed, paid)
//   abgebrochen              Sitzung läuft ab (expired)
//   betrag-falsch            Prüffall: bezahlt mit falschem Betrag
//   ueberweisung-gewaehlt    Überweisung gewählt (completed, unpaid, customer_balance) – E7
//   ueberweisung-eingegangen Geld eingegangen (async_payment_succeeded) – E7
//   ueberweisung-frist-vorbei Prüffall: setzt die Überweisungsfrist in die Vergangenheit
//                            (kein Webhook; danach aufraeumen aufrufen) – E7
const ERGEBNISSE = ['bezahlt', 'abgebrochen', 'betrag-falsch', 'ueberweisung-gewaehlt', 'ueberweisung-eingegangen', 'ueberweisung-frist-vorbei'];

exports.handler = async (event) => {
  blobsVerbinden(event);
  if (!attrappeAktiv()) return errorResponse(403, 'Die Zahlungs-Attrappe ist nur lokal verfügbar.');
  if (event.httpMethod !== 'POST') return errorResponse(405, 'Nur POST erlaubt.');

  const body = parseBody(event);
  if (body === null) return errorResponse(400, 'Ungültige Anfrage.');
  const nr = typeof body.nr === 'string' ? body.nr.trim() : '';
  const s = typeof body.s === 'string' ? body.s.trim() : '';
  const ergebnis = ERGEBNISSE.includes(body.ergebnis) ? body.ergebnis : 'bezahlt';

  const state = await readState();
  const b = state.buchungen.find((x) => x.nummer === nr && x.stripeSessionId === s);
  if (!b) return errorResponse(404, 'Buchung nicht gefunden.');

  if (ergebnis === 'ueberweisung-frist-vorbei') {
    const r = await withState((st) => {
      const x = st.buchungen.find((y) => y.id === b.id);
      if (!x || x.status !== 'wartet-ueberweisung') return { ok: false, status: 400, error: 'Buchung wartet nicht auf eine Überweisung.' };
      x.ueberweisungFrist = new Date(Date.now() - 60 * 1000).toISOString();
      protokoll(st, { art: 'attrappe-frist-vorbei', buchungId: x.id, nummer: x.nummer });
      return { ok: true, frist: x.ueberweisungFrist };
    });
    if (!r.ok) return errorResponse(r.status || 400, r.error);
    return json(200, { ok: true, ergebnis, frist: r.frist, hinweis: 'Jetzt /.netlify/functions/aufraeumen aufrufen.' });
  }

  const typ = ergebnis === 'abgebrochen' ? 'checkout.session.expired'
    : ergebnis === 'ueberweisung-eingegangen' ? 'checkout.session.async_payment_succeeded'
      : 'checkout.session.completed';
  const { payload, header } = attrappeEreignis({
    typ,
    sessionId: s,
    buchung: b,
    betragCent: ergebnis === 'betrag-falsch' ? Math.max(100, b.betragCent - 500) : undefined,
    zahlungsstatus: ergebnis === 'ueberweisung-gewaehlt' ? 'unpaid' : undefined,
    zahlungsart: ergebnis.startsWith('ueberweisung') ? 'customer_balance' : 'card',
  });

  // Durch denselben Handler wie ein echter Stripe-Aufruf — inklusive Signaturprüfung.
  // connectLambda() liest neben event.blobs auch die Kopfzeilen x-nf-site-id und
  // x-nf-deploy-id, deshalb müssen die Netlify-Kopfzeilen des Originalaufrufs mit.
  const nfKopf = {};
  for (const [k, v] of Object.entries(event.headers || {})) {
    if (k.toLowerCase().startsWith('x-nf-')) nfKopf[k] = v;
  }
  const antwort = await webhook.handler({
    httpMethod: 'POST',
    headers: { ...nfKopf, 'stripe-signature': header, 'content-type': 'application/json' },
    body: payload,
    isBase64Encoded: false,
    blobs: event.blobs,
  });

  let inhalt = {};
  try { inhalt = JSON.parse(antwort.body); } catch (e) { /* leer */ }
  return json(200, { ok: true, webhookStatus: antwort.statusCode, webhook: inhalt, ergebnis });
};
