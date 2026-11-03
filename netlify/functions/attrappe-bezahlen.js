// NUR LOKAL (netlify dev ohne STRIPE_SECRET_KEY): simuliert das Ergebnis einer Zahlung.
// Erzeugt ein korrekt signiertes Ereignis im Stripe-Format und schickt es durch den
// echten Webhook-Code (stripe-webhook.js) — derselbe Weg wie bei Stripe, nur ohne Stripe.
// Auf Netlify antwortet diese Function immer mit 403, weil attrappeAktiv() dort false ist.

const { readState, blobsVerbinden } = require('./_lib/store');
const { attrappeAktiv, attrappeEreignis } = require('./_lib/zahlung');
const { json, errorResponse, parseBody } = require('./_lib/http');
const webhook = require('./stripe-webhook');

exports.handler = async (event) => {
  blobsVerbinden(event);
  if (!attrappeAktiv()) return errorResponse(403, 'Die Zahlungs-Attrappe ist nur lokal verfügbar.');
  if (event.httpMethod !== 'POST') return errorResponse(405, 'Nur POST erlaubt.');

  const body = parseBody(event);
  if (body === null) return errorResponse(400, 'Ungültige Anfrage.');
  const nr = typeof body.nr === 'string' ? body.nr.trim() : '';
  const s = typeof body.s === 'string' ? body.s.trim() : '';
  const ergebnis = ['bezahlt', 'abgebrochen', 'betrag-falsch'].includes(body.ergebnis) ? body.ergebnis : 'bezahlt';

  const state = await readState();
  const b = state.buchungen.find((x) => x.nummer === nr && x.stripeSessionId === s);
  if (!b) return errorResponse(404, 'Buchung nicht gefunden.');

  const typ = ergebnis === 'abgebrochen' ? 'checkout.session.expired' : 'checkout.session.completed';
  const { payload, header } = attrappeEreignis({
    typ,
    sessionId: s,
    buchung: b,
    betragCent: ergebnis === 'betrag-falsch' ? Math.max(100, b.betragCent - 500) : undefined,
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
