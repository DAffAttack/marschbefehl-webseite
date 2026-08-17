// Gemeinsame Datenschicht für das Führungen-Buchungssystem.
// Speichert den kompletten Zustand (Führungen + Termine + Buchungen) als EIN JSON-Blob
// unter dem Schlüssel "state" im Netlify-Blobs-Store "fuehrungen". Ein einzelner Schlüssel
// macht den Lese-Ändern-Schreiben-Zyklus atomar über einen einzigen bedingten Schreibvorgang
// (onlyIfMatch/onlyIfNew) statt über mehrere Keys hinweg koordinieren zu müssen.
//
// Race-Condition-Schutz: optimistisches Locking über den ETag, den Netlify Blobs bei
// jedem Schreibvorgang zurückgibt. store.setJSON(...,{onlyIfMatch:etag}) schlägt fehl
// (modified:false, kein Fehler/Exception), wenn der Blob seit dem Lesen von jemand
// anderem verändert wurde — dann wird im withState()-Retry-Loop einfach neu gelesen
// und der Mutator erneut angewendet. Kein Überbuchen möglich, weil die Kapazitätsprüfung
// IMMER auf dem zuletzt tatsächlich geschriebenen Stand passiert, nicht auf einem
// veralteten, zwischenzeitlich überholten Lesewert.
//
// WICHTIG (2026-08-16, beim Führungen/Termine-Umbau entdeckt und behoben):
// Die ursprünglich installierte @netlify/blobs-Version (8.2.0, über das freie "^8.1.0"
// in package.json aufgelöst) unterstützt onlyIfMatch/onlyIfNew NOCH GAR NICHT — set()/
// setJSON() gaben dort nur Promise<void> zurück, kein {modified, etag}-Objekt. Der Code
// hätte auf echter Netlify-Infrastruktur beim ersten Schreibversuch mit einer TypeError
// ("Cannot read properties of undefined") abgestürzt, weil written.modified auf undefined
// zugegriffen hätte. Das ist beim ursprünglichen Bau nicht aufgefallen, weil die
// automatisierten Tests gegen einen selbstgebauten Mock liefen, der diese (damals in der
// echten Bibliothek noch nicht existierende) API bereits simulierte. Fix: package.json auf
// "^10.7.13" angehoben (dort ist onlyIfMatch/onlyIfNew offizieller, dokumentierter
// Bestandteil der API, WriteResult={modified,etag}), npm install ausgeführt, mit dem
// aktuellen Code erneut gegen einen Mock UND gegen die echte installierte Bibliotheks-API
// geprüft. Für künftige Bump-Vorsicht: bei jeder @netlify/blobs-Versionsänderung die
// tatsächlichen .d.cts-Typen von set()/setJSON() gegenprüfen, nicht nur der Doku vertrauen.

const { getStore } = require('@netlify/blobs');
const crypto = require('crypto');

const STORE_NAME = 'fuehrungen';
const STATE_KEY = 'state';
const IMAGE_STORE_NAME = 'fuehrungen-bilder';
const MAX_RETRIES = 10;

function emptyState() {
  return { fuehrungen: [], termine: [], buchungen: [] };
}

// Fallback für Umgebungen, in denen Netlify die Blobs-Zugangsdaten nicht automatisch
// injiziert (beobachtet 2026-08-17 auf dem "vorschau"-Branch-Deploy:
// MissingBlobsEnvironmentError trotz korrekt in der Handler-Funktion aufgerufenem
// getStore()). Netlifys eigene Fehlermeldung empfiehlt genau diesen manuellen Weg:
// siteID + token explizit mitgeben statt auf Auto-Konfiguration zu vertrauen.
// SITE_ID wird von Netlify automatisch bereitgestellt, NETLIFY_BLOBS_TOKEN ist ein
// vom Nutzer selbst angelegtes Personal Access Token (Umgebungsvariable, kein
// Klartext im Code). Ohne gesetztes Token bleibt das Verhalten unverändert
// (automatische Konfiguration wird weiter versucht).
function blobsConfig() {
  if (process.env.NETLIFY_BLOBS_TOKEN) {
    return { siteID: process.env.SITE_ID, token: process.env.NETLIFY_BLOBS_TOKEN };
  }
  return undefined;
}

function getFuehrungenStore() {
  const cfg = blobsConfig();
  return cfg ? getStore({ name: STORE_NAME, ...cfg }) : getStore(STORE_NAME);
}

function getBilderStore() {
  const cfg = blobsConfig();
  return cfg ? getStore({ name: IMAGE_STORE_NAME, ...cfg }) : getStore(IMAGE_STORE_NAME);
}

/**
 * Atomarer Lese-Ändern-Schreiben-Zyklus auf den gesamten Buchungs-Zustand.
 *
 * @param {(draft: {fuehrungen:any[], termine:any[], buchungen:any[]}) => ({ok:true, [key:string]:any} | {ok:false, status:number, error:string})} mutator
 *   Bekommt eine tiefe Kopie des aktuellen Zustands, darf sie direkt verändern (push/splice/etc.)
 *   und muss ein Ergebnis zurückgeben. Bei ok:false wird NICHT geschrieben (z.B. Validierungsfehler,
 *   nicht genug freie Plätze) — kein unnötiger Schreibversuch für ungültige Anfragen.
 * @returns {Promise<{ok:true,...}|{ok:false,status:number,error:string}>}
 */
async function withState(mutator) {
  const store = getFuehrungenStore();

  for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
    let data;
    let etag;

    const existing = await store.getWithMetadata(STATE_KEY, { type: 'json' });
    if (existing === null) {
      // Noch kein Zustand vorhanden — versuchen, ihn initial anzulegen.
      const initial = emptyState();
      const created = await store.setJSON(STATE_KEY, initial, { onlyIfNew: true });
      if (!created.modified) {
        // Ein anderer Aufruf war zwischenzeitlich schneller — im nächsten Durchlauf frisch lesen.
        continue;
      }
      data = initial;
      etag = created.etag;
    } else {
      data = existing.data;
      etag = existing.etag;
    }

    // Ältere Blobs (vor dem Führungen/Termine-Umbau) kennen noch kein "fuehrungen"-Feld —
    // defensiv nachrüsten, damit der Mutator sich darauf verlassen kann.
    if (!Array.isArray(data.fuehrungen)) data.fuehrungen = [];
    if (!Array.isArray(data.termine)) data.termine = [];
    if (!Array.isArray(data.buchungen)) data.buchungen = [];

    const draft = JSON.parse(JSON.stringify(data));
    const result = mutator(draft);

    if (!result || result.ok === false) {
      return result || { ok: false, status: 500, error: 'Unbekannter Fehler.' };
    }

    const written = await store.setJSON(STATE_KEY, draft, { onlyIfMatch: etag });
    if (written.modified) {
      return { ...result, ok: true };
    }
    // Schreibkonflikt: zwischen Lesen und Schreiben hat ein anderer Aufruf bereits
    // geschrieben (z.B. zwei gleichzeitige Buchungen). Nächster Durchlauf liest neu.
  }

  return {
    ok: false,
    status: 409,
    error: 'Gerade sehr viele gleichzeitige Anfragen. Bitte in ein paar Sekunden erneut versuchen.',
  };
}

async function readState() {
  const store = getFuehrungenStore();
  const existing = await store.get(STATE_KEY, { type: 'json' });
  const state = existing || emptyState();
  if (!Array.isArray(state.fuehrungen)) state.fuehrungen = [];
  if (!Array.isArray(state.termine)) state.termine = [];
  if (!Array.isArray(state.buchungen)) state.buchungen = [];
  return state;
}

function belegtePersonen(state, terminId) {
  return state.buchungen
    .filter((b) => b.terminId === terminId)
    .reduce((sum, b) => sum + b.personen, 0);
}

function terminDatumZeit(termin) {
  return new Date(`${termin.datumIso}T${termin.uhrzeit}:00`);
}

function findFuehrung(state, fuehrungId) {
  return state.fuehrungen.find((f) => f.id === fuehrungId) || null;
}

function neueId() {
  return crypto.randomUUID();
}

// Ampel-Status statt exakter Platzzahl für öffentliche Ausgaben (Nutzer-Wunsch
// 2026-08-17: keine genaue Zahl freier Plätze mehr nach außen zeigen, weder in
// der Terminliste noch in Fehlermeldungen/Buchungsbestätigungen). "wenige" greift
// unterhalb von 20% der Gesamtkapazität (mindestens 1 Platz Schwelle).
function verfuegbarkeitsStatus(frei, maxPersonen) {
  if (frei <= 0) return 'ausgebucht';
  const schwelle = Math.max(1, Math.ceil(maxPersonen * 0.2));
  return frei <= schwelle ? 'wenige' : 'frei';
}

module.exports = {
  withState,
  readState,
  belegtePersonen,
  verfuegbarkeitsStatus,
  terminDatumZeit,
  findFuehrung,
  neueId,
  getBilderStore,
};
