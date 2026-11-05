// Anmeldung für den Verwaltungsbereich (E4, 03.11.2026).
//
// Vorher: Das Passwort wurde bei jeder Aktion im Browser gehalten und mitgeschickt.
// Jetzt: Einmal anmelden -> signiertes Sitzungs-Token im HttpOnly-Cookie (12 Stunden).
// Das Passwort verlässt den Browser nur beim Anmelden. Prüfskripte dürfen weiterhin das
// Passwort im Body mitgeben (angemeldet() akzeptiert beides).
//
// Token: "<ablauf>.<zufall>.<hmac>" — HMAC-SHA256 über "<ablauf>.<zufall>" mit einem
// Geheimnis aus ADMIN_SITZUNG_GEHEIMNIS (oder, falls nicht gesetzt, abgeleitet aus dem
// Admin-Passwort). Ein Passwortwechsel macht damit alle Sitzungen ungültig.
//
// Bremse: nach 5 Fehlversuchen je IP ist die Anmeldung 15 Minuten gesperrt (im Speicher
// der Function-Instanz; erste Hürde gegen Durchprobieren).

const crypto = require('crypto');

const COOKIE_NAME = 'zsh_verwaltung';
const SITZUNG_STUNDEN = 12;
const MAX_FEHLVERSUCHE = 5;
const SPERRE_MINUTEN = 15;

function passwortStimmt(eingabe) {
  const erwartet = process.env.FUEHRUNGEN_ADMIN_PASSWORD;
  if (!erwartet || typeof erwartet !== 'string' || erwartet.length === 0) {
    return { konfiguriert: false, stimmt: false };
  }
  if (typeof eingabe !== 'string' || eingabe.length === 0) {
    return { konfiguriert: true, stimmt: false };
  }
  // Zeitkonstanter Vergleich über gleich lange SHA-256-Digests.
  const a = crypto.createHash('sha256').update(eingabe).digest();
  const b = crypto.createHash('sha256').update(erwartet).digest();
  return { konfiguriert: true, stimmt: crypto.timingSafeEqual(a, b) };
}

function geheimnis() {
  if (process.env.ADMIN_SITZUNG_GEHEIMNIS) return process.env.ADMIN_SITZUNG_GEHEIMNIS;
  const pw = process.env.FUEHRUNGEN_ADMIN_PASSWORD || '';
  return crypto.createHash('sha256').update('sitzung:' + pw).digest('hex');
}

function signatur(teil) {
  return crypto.createHmac('sha256', geheimnis()).update(teil).digest('base64url');
}

function tokenErzeugen() {
  const ablauf = Date.now() + SITZUNG_STUNDEN * 60 * 60 * 1000;
  const teil = ablauf + '.' + crypto.randomBytes(16).toString('base64url');
  return teil + '.' + signatur(teil);
}

function tokenGueltig(token) {
  if (typeof token !== 'string') return false;
  const stuecke = token.split('.');
  if (stuecke.length !== 3) return false;
  const [ablauf, zufall, sig] = stuecke;
  if (!/^\d+$/.test(ablauf) || Number(ablauf) < Date.now()) return false;
  const erwartet = signatur(ablauf + '.' + zufall);
  const a = Buffer.from(sig);
  const b = Buffer.from(erwartet);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

function cookieLesen(event) {
  const h = (event && event.headers) || {};
  const roh = h.cookie || h.Cookie || '';
  for (const teil of roh.split(';')) {
    const [k, ...v] = teil.trim().split('=');
    if (k === COOKIE_NAME) return decodeURIComponent(v.join('='));
  }
  return '';
}

function istLokal(event) {
  const h = (event && event.headers) || {};
  const host = h['x-forwarded-host'] || h.host || '';
  return /^(localhost|127\.0\.0\.1)(:\d+)?$/.test(host);
}

function cookieSetzen(token, event) {
  return COOKIE_NAME + '=' + encodeURIComponent(token) + '; Path=/.netlify/functions/; HttpOnly; SameSite=Strict; Max-Age=' + SITZUNG_STUNDEN * 3600 + (istLokal(event) ? '' : '; Secure');
}

function cookieLoeschen(event) {
  return COOKIE_NAME + '=; Path=/.netlify/functions/; HttpOnly; SameSite=Strict; Max-Age=0' + (istLokal(event) ? '' : '; Secure');
}

/**
 * Angemeldet, wenn ein gültiges Sitzungs-Cookie vorliegt ODER (für Prüfskripte) das
 * Passwort im Body stimmt.
 */
function angemeldet(event, body) {
  if (tokenGueltig(cookieLesen(event))) return { konfiguriert: true, ok: true, weg: 'cookie' };
  const p = passwortStimmt(body && body.password);
  if (!p.konfiguriert) return { konfiguriert: false, ok: false };
  return { konfiguriert: true, ok: p.stimmt, weg: p.stimmt ? 'passwort' : '' };
}

// ---- Login-Bremse
const fehlversuche = new Map(); // ip -> [zeitstempel]

function clientIp(event) {
  const h = (event && event.headers) || {};
  return h['x-nf-client-connection-ip'] || (h['x-forwarded-for'] || '').split(',')[0].trim() || 'unbekannt';
}

function loginGesperrt(event) {
  const jetzt = Date.now();
  const liste = (fehlversuche.get(clientIp(event)) || []).filter((t) => jetzt - t < SPERRE_MINUTEN * 60 * 1000);
  fehlversuche.set(clientIp(event), liste);
  return liste.length >= MAX_FEHLVERSUCHE;
}

function loginFehlversuch(event) {
  const liste = fehlversuche.get(clientIp(event)) || [];
  liste.push(Date.now());
  fehlversuche.set(clientIp(event), liste);
}

function loginErfolg(event) {
  fehlversuche.delete(clientIp(event));
}

module.exports = {
  COOKIE_NAME,
  passwortStimmt,
  tokenErzeugen,
  tokenGueltig,
  cookieLesen,
  cookieSetzen,
  cookieLoeschen,
  angemeldet,
  loginGesperrt,
  loginFehlversuch,
  loginErfolg,
  SPERRE_MINUTEN,
};
