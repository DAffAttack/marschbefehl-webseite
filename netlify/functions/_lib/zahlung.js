// Zahlungsschicht: alles, was Stripe berührt, liegt hier — die Functions kennen nur
// checkoutAnlegen(), webhookEreignisLesen() und erstatten().
//
// Zwei Betriebsarten:
//   1. Stripe (Regelfall): STRIPE_SECRET_KEY und STRIPE_WEBHOOK_SECRET als Umgebungs-
//      variablen gesetzt. Kartendaten berühren unser System nie — der Gast zahlt auf der
//      von Stripe gehosteten Bezahlseite (Checkout), Stripe meldet das Ergebnis per
//      Webhook, dessen Signatur wir prüfen.
//   2. Attrappe (nur lokal): kein STRIPE_SECRET_KEY UND NETLIFY_DEV === 'true'. Statt der
//      Stripe-Bezahlseite öffnet sich zahlung-attrappe.html; ein Knopf dort erzeugt ein
//      korrekt signiertes Test-Ereignis und schickt es durch denselben Webhook-Code wie
//      Stripe. So lässt sich der ganze Ablauf ohne Stripe-Konto durchspielen. Auf Netlify
//      (NETLIFY_DEV nicht gesetzt) ist die Attrappe hart abgeschaltet: ohne Schlüssel
//      gibt es dort nur eine Fehlermeldung, nie eine Scheinzahlung.

const Stripe = require('stripe');

const ATTRAPPE_WEBHOOK_SECRET = 'whsec_attrappe_nur_lokal';
const WAEHRUNG = 'eur';

function stripeSchluessel() {
  const k = process.env.STRIPE_SECRET_KEY;
  return typeof k === 'string' && k.trim() ? k.trim() : null;
}

function attrappeAktiv() {
  return !stripeSchluessel() && process.env.NETLIFY_DEV === 'true';
}

function betriebsart() {
  if (stripeSchluessel()) return 'stripe';
  if (attrappeAktiv()) return 'attrappe';
  return 'nicht-konfiguriert';
}

function client() {
  const key = stripeSchluessel();
  if (!key) return null;
  return new Stripe(key, { apiVersion: undefined, appInfo: { name: 'marschbefehl.com Buchung' } });
}

// Basis-Adresse der Seite für Rücksprung-Links: die Adresse, über die der Gast gerade
// bucht (Host-Header). So landet er nach der Zahlung wieder dort, wo er war —
// Produktion, Branch-Deploy oder lokal. Erst wenn kein Host bekannt ist, greifen die
// Netlify-Variablen. (netlify dev injiziert DEPLOY_PRIME_URL des Branches, deshalb
// darf die Variable lokal NICHT Vorrang haben — 03.11.2026 gelernt.)
function basisUrl(event) {
  const h = (event && event.headers) || {};
  const host = h['x-forwarded-host'] || h.host;
  if (host) {
    const lokal = /^(localhost|127\.0\.0\.1)(:\d+)?$/.test(host);
    const proto = h['x-forwarded-proto'] || (lokal ? 'http' : 'https');
    return proto + '://' + host;
  }
  const env = process.env.URL || process.env.DEPLOY_PRIME_URL;
  return env ? env.replace(/\/$/, '') : 'https://marschbefehl.com';
}

function datumLesbar(datumIso, uhrzeit) {
  const d = new Date(datumIso + 'T' + uhrzeit + ':00');
  const tage = ['So', 'Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa'];
  const [j, m, t] = datumIso.split('-');
  return tage[d.getDay()] + ', ' + t + '.' + m + '.' + j + ', ' + uhrzeit + ' Uhr';
}

/**
 * Legt die Bezahlsitzung an. Der Betrag kommt ausschließlich aus der Buchung
 * (serverseitig berechnet), nie aus dem Browser.
 * @returns {Promise<{sessionId:string, url:string, betriebsart:string}>}
 */
async function checkoutAnlegen({ buchung, fuehrung, termin, event }) {
  const basis = basisUrl(event);
  const erfolgUrl = basis + '/danke.html?nr=' + encodeURIComponent(buchung.nummer) + '&s={CHECKOUT_SESSION_ID}';
  const abbruchUrl = basis + '/fuehrung.html?id=' + encodeURIComponent(fuehrung.id) + '&abbruch=' + encodeURIComponent(buchung.nummer);
  const art = betriebsart();

  if (art === 'attrappe') {
    const sessionId = 'cs_attrappe_' + buchung.id.replace(/-/g, '').slice(0, 24);
    const url = basis + '/zahlung-attrappe.html?nr=' + encodeURIComponent(buchung.nummer) + '&s=' + sessionId;
    return { sessionId, url, betriebsart: art, zahlungsarten: zahlungsarten(termin), zahlungsartenHinweis: '' };
  }
  if (art !== 'stripe') {
    throw new Error('Zahlung ist noch nicht eingerichtet (STRIPE_SECRET_KEY fehlt).');
  }

  const stripe = client();
  const arten = zahlungsarten(termin);
  const grund = {
    mode: 'payment',
    locale: 'de',
    // Filterliste statt Stripe-Vorgaben (Entscheidung 04.11.2026): Karte (dazu automatisch
    // Apple Pay und Google Pay), PayPal, Klarna (= Sofortüberweisung) und Banküberweisung
    // (customer_balance, E7). Die Banküberweisung fällt weg, wenn der Termin näher als
    // UEBERWEISUNG_MIN_VORLAUF_TAGE liegt. Über ZAHLUNGSARTEN änderbar.
    // Seit Stripe-API 2026-09-30 gibt es "payment_method_types" für Checkout nicht mehr;
    // "allowed_payment_method_types" filtert die im Dashboard aktiven Zahlarten – eine dort
    // nicht aktive Zahlart (z. B. Banküberweisung noch nicht freigeschaltet) wird still
    // weggelassen statt die Buchung zu blockieren.
    allowed_payment_method_types: arten,
    customer_email: buchung.email,
  };
  let stripeCustomerId = null;
  if (arten.includes('customer_balance')) {
    // Banküberweisung: Stripe stellt je Zahlung eine eigene IBAN mit Verwendungszweck und
    // meldet den Eingang per Webhook (async_payment_succeeded). Laut Stripe-Anleitung nur
    // für Sitzungen mit einem VORHANDENEN Kunden – customer_creation reicht nicht. Deshalb
    // wird der Gast vorher als Stripe-Kunde angelegt (idempotent je Buchung).
    const kunde = await stripe.customers.create(
      { email: buchung.email, name: buchung.name, metadata: { buchungId: buchung.id, nummer: buchung.nummer } },
      { idempotencyKey: 'kunde-' + buchung.id }
    );
    stripeCustomerId = kunde.id;
    grund.customer = kunde.id;
    delete grund.customer_email; // nicht zusammen mit customer erlaubt
    grund.payment_method_options = {
      customer_balance: { funding_type: 'bank_transfer', bank_transfer: { type: 'eu_bank_transfer', eu_bank_transfer: { country: 'DE' } } },
    };
  }
  let zahlungsartenHinweis = '';
  let session;
  try {
    session = await stripe.checkout.sessions.create(sitzungsDaten(grund), { idempotencyKey: 'checkout-' + buchung.id });
  } catch (err) {
    // Typischer Fall: eine Zahlart ist im Stripe-Konto (noch) nicht freigeschaltet. Dann
    // lieber nur mit Karte buchen lassen als gar nicht – und das im Protokoll festhalten.
    const text = String(err && err.message || '');
    if (!/payment_method_types|payment method|customer_balance|customer_creation|paypal|klarna/i.test(text)) throw err;
    console.error('checkoutAnlegen: Zahlarten ' + arten.join(',') + ' abgelehnt, Rückfall auf Stripe-Vorgaben:', text);
    zahlungsartenHinweis = 'Rückfall auf Stripe-Vorgaben: ' + text.slice(0, 160);
    delete grund.payment_method_options;
    delete grund.allowed_payment_method_types;
    session = await stripe.checkout.sessions.create(sitzungsDaten(grund), { idempotencyKey: 'checkout-card-' + buchung.id });
  }
  return { sessionId: session.id, url: session.url, betriebsart: art, stripeCustomerId, zahlungsarten: zahlungsartenHinweis ? (session.payment_method_types || ['card']) : arten, zahlungsartenHinweis };

  function sitzungsDaten(basisDaten) {
    return {
      ...basisDaten,
      line_items: [
        {
          quantity: buchung.personen,
          price_data: {
            currency: WAEHRUNG,
            unit_amount: buchung.preisCentProPerson,
            product_data: {
              name: fuehrung.titel,
              description: 'Führung am ' + datumLesbar(termin.datumIso, termin.uhrzeit) + ' · Buchung ' + buchung.nummer,
            },
          },
        },
      ],
      metadata: { buchungId: buchung.id, nummer: buchung.nummer },
      payment_intent_data: {
        description: fuehrung.titel + ' · ' + datumLesbar(termin.datumIso, termin.uhrzeit) + ' · ' + buchung.nummer,
        metadata: { buchungId: buchung.id, nummer: buchung.nummer },
      },
      // Stripe erlaubt frühestens 30 Minuten; unsere Reservierung läuft nach 15 Minuten
      // ab, danach wird die Zahlung im Webhook abgewiesen (Status abgelaufen).
      expires_at: Math.floor(Date.now() / 1000) + 30 * 60,
      success_url: erfolgUrl,
      cancel_url: abbruchUrl,
    };
  }
}

/**
 * Zahlarten für eine Bezahlsitzung: ZAHLUNGSARTEN (Vorgabe card,paypal,klarna,customer_balance),
 * ohne customer_balance, wenn der Termin zu nah ist (store.ueberweisungMoeglich).
 */
function zahlungsarten(termin) {
  const { ueberweisungMoeglich } = require('./store');
  let liste = String(process.env.ZAHLUNGSARTEN || 'card,paypal,klarna,customer_balance').split(',').map((s) => s.trim()).filter(Boolean);
  if (termin && !ueberweisungMoeglich(termin)) liste = liste.filter((a) => a !== 'customer_balance');
  return liste.length ? liste : ['card'];
}

/**
 * Überweisungsdaten einer offenen Zahlung (E7): IBAN, BIC, Empfänger, Verwendungszweck,
 * Betrag und die Anleitungsseite von Stripe. Liefert null, wenn die Zahlung keine
 * Banküberweisung ist (z. B. Karte noch in Bearbeitung).
 */
async function ueberweisungDetails({ paymentIntentId, sitzung }) {
  const art = betriebsart();
  if (art === 'attrappe') {
    const arten = (sitzung && sitzung.payment_method_types) || [];
    if (!arten.includes('customer_balance')) return null;
    return {
      hostedUrl: '',
      empfaenger: 'Stripe Payments Europe (Attrappe)',
      iban: 'DE00 0000 0000 0000 0000 00',
      bic: 'ATTRDE00',
      referenz: 'ATTRAPPE-' + ((sitzung && sitzung.metadata && sitzung.metadata.nummer) || ''),
      betragCent: sitzung ? sitzung.amount_total : 0,
    };
  }
  if (art !== 'stripe' || !paymentIntentId) return null;
  const stripe = client();
  const pi = await stripe.paymentIntents.retrieve(paymentIntentId);
  const na = pi.next_action;
  if (!na || na.type !== 'display_bank_transfer_instructions') return null;
  const d = na.display_bank_transfer_instructions || {};
  const adr = (d.financial_addresses || []).find((a) => a.type === 'iban') || (d.financial_addresses || [])[0] || {};
  const iban = adr.iban || {};
  return {
    hostedUrl: d.hosted_instructions_url || '',
    empfaenger: iban.account_holder_name || '',
    iban: iban.iban || '',
    bic: iban.bic || '',
    referenz: d.reference || '',
    betragCent: typeof d.amount_remaining === 'number' ? d.amount_remaining : pi.amount,
  };
}

/**
 * NUR TESTMODUS (sk_test_…): simuliert den Geldeingang einer Banküberweisung, indem das
 * Kundenguthaben bei Stripe aufgefüllt wird – Stripe ordnet es der offenen Zahlung zu und
 * meldet async_payment_succeeded per Webhook. Mit Live-Schlüssel lehnt Stripe den Aufruf ab.
 */
async function testUeberweisungEingang({ buchung }) {
  const art = betriebsart();
  if (art !== 'stripe') throw new Error('Nur mit Stripe-Testschlüssel möglich.');
  const key = stripeSchluessel();
  if (!key.startsWith('sk_test_')) throw new Error('Nur im Testmodus (sk_test_) erlaubt.');
  if (!buchung.stripeSessionId) throw new Error('Keine Bezahlsitzung an der Buchung.');
  const stripe = client();
  const s = await stripe.checkout.sessions.retrieve(buchung.stripeSessionId);
  const kunde = typeof s.customer === 'string' ? s.customer : s.customer && s.customer.id;
  if (!kunde) throw new Error('Die Sitzung hat keinen Stripe-Kunden (Überweisung noch nicht gewählt?).');
  const referenz = buchung.ueberweisung && buchung.ueberweisung.referenz ? buchung.ueberweisung.referenz : undefined;
  const r = await stripe.testHelpers.customers.fundCashBalance(kunde, { amount: buchung.betragCent, currency: WAEHRUNG, ...(referenz ? { reference: referenz } : {}) });
  return { ok: true, kunde, transaktion: r.id, betragCent: buchung.betragCent };
}

/**
 * Bricht eine noch offene Zahlung ab (Überweisungsfrist verstrichen, Storno vor Zahlung).
 * Danach kann ein später überwiesener Betrag nicht mehr der Buchung zugeordnet werden – er
 * landet als Guthaben beim Kunden bei Stripe und wird dort manuell erstattet.
 */
async function zahlungAbbrechen({ buchung }) {
  const art = betriebsart();
  if (art !== 'stripe') return { ok: true, betriebsart: art, hinweis: 'keine Stripe-Zahlung' };
  if (!buchung.stripePaymentIntent) return { ok: true, betriebsart: art, hinweis: 'kein PaymentIntent' };
  const stripe = client();
  try {
    const pi = await stripe.paymentIntents.cancel(buchung.stripePaymentIntent, { cancellation_reason: 'abandoned' });
    return { ok: true, betriebsart: art, status: pi.status };
  } catch (err) {
    // schon bezahlt oder schon abgebrochen: nichts zu tun
    return { ok: false, betriebsart: art, error: String(err && err.message).slice(0, 200) };
  }
}

function rohBody(event) {
  if (!event.body) return '';
  return event.isBase64Encoded ? Buffer.from(event.body, 'base64').toString('utf8') : event.body;
}

/**
 * Prüft die Signatur eines Webhook-Aufrufs und liefert das Stripe-Ereignis.
 * Wirft bei ungültiger Signatur.
 */
function webhookEreignisLesen(event) {
  const art = betriebsart();
  const secret = art === 'attrappe' ? ATTRAPPE_WEBHOOK_SECRET : process.env.STRIPE_WEBHOOK_SECRET;
  if (!secret) throw new Error('STRIPE_WEBHOOK_SECRET fehlt.');
  const h = event.headers || {};
  const signatur = h['stripe-signature'] || h['Stripe-Signature'];
  if (!signatur) throw new Error('Keine Stripe-Signatur im Aufruf.');
  // Für die Signaturprüfung reicht ein Client ohne echten Schlüssel.
  const stripe = client() || new Stripe('sk_test_attrappe');
  return stripe.webhooks.constructEvent(rohBody(event), signatur, secret);
}

/**
 * Nur für die lokale Attrappe: erzeugt ein signiertes Ereignis im Stripe-Format.
 */
function attrappeEreignis({ typ, sessionId, buchung, betragCent, zahlungsstatus, zahlungsart }) {
  if (!attrappeAktiv()) throw new Error('Attrappe ist nur lokal verfügbar.');
  const stripe = new Stripe('sk_test_attrappe');
  const ereignis = {
    id: 'evt_attrappe_' + Date.now() + '_' + Math.random().toString(36).slice(2, 8),
    object: 'event',
    api_version: '2024-06-20',
    created: Math.floor(Date.now() / 1000),
    livemode: false,
    type: typ,
    data: {
      object: {
        id: sessionId,
        object: 'checkout.session',
        mode: 'payment',
        status: typ === 'checkout.session.expired' ? 'expired' : 'complete',
        payment_method_types: [zahlungsart || 'card'],
        payment_status: zahlungsstatus || (typ === 'checkout.session.completed' ? 'paid' : typ === 'checkout.session.async_payment_succeeded' ? 'paid' : 'unpaid'),
        amount_total: typeof betragCent === 'number' ? betragCent : buchung.betragCent,
        currency: WAEHRUNG,
        customer_email: buchung.email,
        payment_intent: 'pi_attrappe_' + buchung.id.replace(/-/g, '').slice(0, 24),
        metadata: { buchungId: buchung.id, nummer: buchung.nummer },
      },
    },
  };
  const payload = JSON.stringify(ereignis);
  const header = stripe.webhooks.generateTestHeaderString({ payload, secret: ATTRAPPE_WEBHOOK_SECRET });
  return { payload, header };
}

/**
 * Erstattet eine bezahlte Buchung vollständig (für Storno/Absage, E5).
 */
async function erstatten({ buchung }) {
  const art = betriebsart();
  if (art === 'attrappe') {
    return { erstattungId: 're_attrappe_' + Date.now(), betriebsart: art };
  }
  if (art !== 'stripe') throw new Error('Zahlung ist noch nicht eingerichtet (STRIPE_SECRET_KEY fehlt).');
  if (!buchung.stripePaymentIntent) throw new Error('Zu dieser Buchung ist keine Zahlung hinterlegt.');
  const stripe = client();
  const r = await stripe.refunds.create(
    { payment_intent: buchung.stripePaymentIntent, metadata: { buchungId: buchung.id, nummer: buchung.nummer } },
    { idempotencyKey: 'erstattung-' + buchung.id }
  );
  return { erstattungId: r.id, betriebsart: art };
}

/**
 * Zahlungen der letzten Zeit beim Zahlungsanbieter (für den Abgleich).
 * Stripe: Checkout-Sitzungen + Erstattungen. Attrappe (lokal): aus
 * website/.netlify/attrappe-zahlungen.json, falls vorhanden (Prüfläufe können dort
 * Abweichungen einbauen), sonst aus den eigenen Buchungen abgeleitet.
 * @returns {Promise<{sessionId:string, paymentIntent:string|null, betragCent:number, waehrung:string, bezahlt:boolean, erstattetCent:number, email:string, nummer:string, erstellt:string}[]>}
 */
async function zahlungenAbrufen({ seit }) {
  const art = betriebsart();
  if (art === 'attrappe') {
    const fs = require('fs');
    const path = require('path');
    const datei = path.resolve(process.cwd(), '.netlify', 'attrappe-zahlungen.json');
    if (fs.existsSync(datei)) {
      return JSON.parse(fs.readFileSync(datei, 'utf8'));
    }
    const { readState } = require('./store');
    const state = await readState();
    return state.buchungen
      .filter((b) => b.stripeSessionId && (b.status === 'bezahlt' || b.status === 'pruefen' || b.status === 'erstattet') && new Date(b.erstelltAm) >= seit)
      .map((b) => ({ sessionId: b.stripeSessionId, paymentIntent: b.stripePaymentIntent || null, betragCent: b.betragCent, waehrung: WAEHRUNG, bezahlt: true, erstattetCent: b.status === 'erstattet' ? b.betragCent : 0, email: b.email, nummer: b.nummer, erstellt: b.erstelltAm }));
  }
  if (art !== 'stripe') throw new Error('Zahlung ist noch nicht eingerichtet (STRIPE_SECRET_KEY fehlt).');
  const stripe = client();
  const gte = Math.floor(seit.getTime() / 1000);
  const sitzungen = await stripe.checkout.sessions.list({ created: { gte }, limit: 100, expand: ['data.payment_intent'] }).autoPagingToArray({ limit: 1000 });
  const erstattungen = await stripe.refunds.list({ created: { gte }, limit: 100 }).autoPagingToArray({ limit: 1000 });
  const erstattetJePi = new Map();
  for (const r of erstattungen) {
    if (r.status === 'succeeded' || r.status === 'pending') {
      erstattetJePi.set(r.payment_intent, (erstattetJePi.get(r.payment_intent) || 0) + r.amount);
    }
  }
  return sitzungen.map((s) => {
    const pi = s.payment_intent && typeof s.payment_intent === 'object' ? s.payment_intent.id : s.payment_intent || null;
    return {
      sessionId: s.id,
      paymentIntent: pi,
      betragCent: s.amount_total || 0,
      waehrung: String(s.currency || '').toLowerCase(),
      bezahlt: s.payment_status === 'paid',
      erstattetCent: pi ? erstattetJePi.get(pi) || 0 : 0,
      email: (s.customer_details && s.customer_details.email) || s.customer_email || '',
      nummer: (s.metadata && s.metadata.nummer) || '',
      erstellt: new Date(s.created * 1000).toISOString(),
    };
  });
}

module.exports = {
  betriebsart,
  attrappeAktiv,
  basisUrl,
  datumLesbar,
  checkoutAnlegen,
  zahlungsarten,
  ueberweisungDetails,
  zahlungAbbrechen,
  testUeberweisungEingang,
  webhookEreignisLesen,
  attrappeEreignis,
  erstatten,
  zahlungenAbrufen,
  WAEHRUNG,
};
