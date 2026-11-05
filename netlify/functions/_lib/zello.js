// Zello-Anleitung für die Kolonnenfahrt: eine einzige Textquelle für Mailtext und PDF-Anhang.
// Wortlaut wie Schlachtfeldfuehrung_Seelow\Ergebnisse\Teilnehmer-Anleitung Zello.md;
// Änderungen dort und hier nachziehen.
//
// Kanal und Passwort kommen aus ZELLO_KANAL und ZELLO_PASSWORT. Fehlt einer der beiden Werte,
// steht in Mail und PDF, dass beides am Treffpunkt bekanntgegeben wird.

const { PDFDocument, StandardFonts, rgb } = require('pdf-lib');
const { umbrechen } = require('./rechnung');

const ANHANG_NAME = 'Fuehrung-im-Auto-hoeren-Zello.pdf';

const TITEL = 'Führung im Auto hören – so geht\'s';
const EINLEITUNG = 'Während der Kolonnenfahrt erkläre ich Ihnen über Funk, was Sie rechts und links sehen. Dafür nutzen wir die kostenlose App Zello. Meine Stimme kommt dann aus Ihren Autolautsprechern.';
const MITFAHRER = 'Sie fahren als Mitfahrer: Es reicht, wenn ein Handy im Auto mit Zello verbunden ist. Bitte sprechen Sie das vorher ab.';

const VOR_DER_TOUR = [
  ['App laden', '„Zello Walkie Talkie“ im App Store (iPhone) oder bei Google Play (Android). Kostenlos.'],
  ['Konto anlegen', 'App öffnen, kostenloses Konto mit Benutzername und Passwort anlegen.'],
  ['Erlaubnis geben', 'Wenn die App fragt, Mikrofon und Benachrichtigungen erlauben.'],
];
const VOR_DER_TOUR_HINWEIS = 'Bitte erledigen Sie das vor dem Termin. Am Treffpunkt ist das Netz manchmal schwach.';

const NACH_DEM_KANAL = [
  ['Handy mit dem Auto verbinden', 'Bluetooth einschalten und mit dem Auto koppeln (wie beim Telefonieren oder Musikhören).'],
  ['Autoradio auf „Bluetooth“ stellen', 'und die Lautstärke aufdrehen.'],
  ['Funkprobe', 'Vor der Abfahrt sage ich etwas. Wer mich hört, gibt Lichthupe.'],
];

const WAEHREND_DER_FAHRT = [
  'Sie müssen nichts drücken. Sie hören nur zu, sprechen kann nur ich.',
  'Der Bildschirm darf aus sein. Zello spielt auch so weiter.',
  'Das Handy gehört in die Halterung oder zum Beifahrer. Als Fahrer bitte nicht in die Hand nehmen.',
  'Ansagen kommen früh, z. B. „In 300 Metern rechts …“. Das letzte Auto ist ja etwas später an der Stelle.',
  'Im Oderbruch gibt es Funklöcher. Fehlt eine Ansage, einfach dem Vorderwagen folgen. Wichtiges wiederhole ich am nächsten Halt.',
  'Datenverbrauch: nur wenige MB für die ganze Tour.',
];

const STOERUNG = 'Autoradio auf „Bluetooth“? Richtiger Kanal in Zello offen? Lautstärke an Handy und Radio hoch? Notfalls einfach den Handylautsprecher laut stellen.';

function zugang() {
  const kanal = String(process.env.ZELLO_KANAL || '').trim();
  const passwort = String(process.env.ZELLO_PASSWORT || '').trim();
  return kanal && passwort ? { kanal, passwort } : null;
}

function kanalSchritt() {
  const z = zugang();
  return z
    ? ['Kanal beitreten', 'In Zello diesen Kanal suchen und beitreten. Kanal: ' + z.kanal + ', Passwort: ' + z.passwort]
    : ['Kanal beitreten', 'Kanalname und Passwort geben wir am Treffpunkt bekannt.'];
}

function amTreffpunkt() {
  return [kanalSchritt()].concat(NACH_DEM_KANAL);
}

function schrittText([kopf, rest]) {
  return kopf + (rest.startsWith('und ') ? ' ' : ': ') + rest;
}

function esc(t) {
  return String(t).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
}

/**
 * Anleitung für den Mailtext.
 * @param {{mitfahrer?:boolean}} [opt]
 * @returns {{text:string, html:string}}
 */
function zelloBlock(opt) {
  const mitfahrer = Boolean(opt && opt.mitfahrer);
  const vor = VOR_DER_TOUR;
  const am = amTreffpunkt();

  const text =
    TITEL + '\n\n' + EINLEITUNG + (mitfahrer ? '\n' + MITFAHRER : '') +
    '\n\nVor der Tour (zu Hause, 5 Minuten)\n' + vor.map((s, i) => (i + 1) + '. ' + schrittText(s)).join('\n') + '\n' + VOR_DER_TOUR_HINWEIS +
    '\n\nAm Treffpunkt\n' + am.map((s, i) => (i + vor.length + 1) + '. ' + schrittText(s)).join('\n') +
    '\n\nWährend der Fahrt\n' + WAEHREND_DER_FAHRT.map((h) => '- ' + h).join('\n') +
    '\n\nHört nichts?\n' + STOERUNG;

  const zwischen = (t) => '<p style="font-weight:600;margin:14px 0 6px;">' + esc(t) + '</p>';
  const schritt = ([kopf, rest]) => '<li style="margin-bottom:6px;"><strong>' + esc(kopf) + '</strong>' + (rest.startsWith('und ') ? ' ' : ': ') + esc(rest) + '</li>';
  const html =
    '<div style="margin:20px 0;padding:16px 18px;background:#F4F7EA;border:1px solid #DDE6C4;border-radius:10px;">' +
    '<p style="font-weight:700;font-size:16px;margin:0 0 8px;">' + esc(TITEL) + '</p>' +
    '<p style="margin:0 0 8px;color:#444;">' + esc(EINLEITUNG) + '</p>' +
    (mitfahrer ? '<p style="margin:0 0 8px;color:#444;">' + esc(MITFAHRER) + '</p>' : '') +
    zwischen('Vor der Tour (zu Hause, 5 Minuten)') +
    '<ol style="padding-left:20px;margin:0 0 6px;color:#444;">' + vor.map(schritt).join('') + '</ol>' +
    '<p style="margin:0;color:#444;">' + esc(VOR_DER_TOUR_HINWEIS) + '</p>' +
    zwischen('Am Treffpunkt') +
    '<ol start="' + (vor.length + 1) + '" style="padding-left:20px;margin:0;color:#444;">' + am.map(schritt).join('') + '</ol>' +
    zwischen('Während der Fahrt') +
    '<ul style="padding-left:18px;margin:0;color:#444;">' + WAEHREND_DER_FAHRT.map((h) => '<li style="margin-bottom:6px;">' + esc(h) + '</li>').join('') + '</ul>' +
    zwischen('Hört nichts?') +
    '<p style="margin:0;color:#444;">' + esc(STOERUNG) + '</p>' +
    '</div>';
  return { text, html };
}

/**
 * Anleitung als einseitiges A4-PDF.
 * @returns {Promise<Uint8Array>}
 */
async function zelloPdf() {
  const doc = await PDFDocument.create();
  doc.setTitle(TITEL);
  doc.setAuthor('Zeitreise Seelower Höhen');
  const normal = await doc.embedFont(StandardFonts.Helvetica);
  const fett = await doc.embedFont(StandardFonts.HelveticaBold);
  const seite = doc.addPage([595.28, 841.89]);
  const rand = 56;
  const breite = 595.28 - 2 * rand;
  const dunkel = rgb(0.12, 0.12, 0.12);
  const grau = rgb(0.4, 0.4, 0.4);
  const gruen = rgb(0.435, 0.561, 0.18);
  let y = 841.89 - rand;

  const absatz = (text, opt = {}) => {
    const groesse = opt.size || 11;
    const font = opt.fett ? fett : normal;
    const x = rand + (opt.einzug || 0);
    for (const z of umbrechen(font, text, groesse, breite - (opt.einzug || 0))) {
      seite.drawText(z, { x, y, size: groesse, font, color: opt.farbe || dunkel });
      y -= groesse * 1.4;
    }
    y -= opt.abstand === undefined ? 4 : opt.abstand;
  };
  const kopf = (t) => {
    y -= 12;
    absatz(t, { size: 13, fett: true, farbe: gruen, abstand: 5 });
  };
  const liste = (zeilen, marke) => {
    zeilen.forEach((z, i) => {
      seite.drawText(marke(i), { x: rand, y, size: 11, font: normal, color: dunkel });
      absatz(z, { einzug: 18 });
    });
  };

  absatz('Zeitreise Seelower Höhen', { size: 10, fett: true, farbe: gruen, abstand: 6 });
  absatz(TITEL, { size: 20, fett: true, abstand: 8 });
  absatz(EINLEITUNG, { abstand: 2 });

  kopf('Vor der Tour (zu Hause, 5 Minuten)');
  liste(VOR_DER_TOUR.map(schrittText), (i) => (i + 1) + '.');
  absatz(VOR_DER_TOUR_HINWEIS, { farbe: grau, abstand: 2 });

  kopf('Am Treffpunkt');
  liste(amTreffpunkt().map(schrittText), (i) => (i + VOR_DER_TOUR.length + 1) + '.');

  kopf('Während der Fahrt');
  liste(WAEHREND_DER_FAHRT, () => '·');

  kopf('Hört nichts?');
  absatz(STOERUNG);

  return doc.save();
}

/**
 * Anhang für mailSenden. Scheitert das PDF (z. B. Sonderzeichen im Kanalnamen), geht die Mail
 * trotzdem raus, denn die Anleitung steht auch im Mailtext.
 * @returns {Promise<{dateiname:string, inhalt:Uint8Array, typ:string}[]>}
 */
async function zelloAnhang() {
  try {
    return [{ dateiname: ANHANG_NAME, inhalt: await zelloPdf(), typ: 'application/pdf' }];
  } catch (err) {
    console.error('zelloAnhang: PDF fehlgeschlagen:', err.message);
    return [];
  }
}

module.exports = { zelloBlock, zelloPdf, zelloAnhang, ANHANG_NAME };
