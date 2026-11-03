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

const { getStore, setEnvironmentContext } = require('@netlify/blobs');

// WICHTIG (03.11.2026): Functions im Lambda-Format (exports.handler) bekommen den
// Blobs-Zugang NICHT über Umgebungsvariablen, sondern über event.blobs. Jede Function
// muss deshalb als Erstes blobsVerbinden(event) aufrufen, sonst wirft getStore()
// MissingBlobsEnvironmentError -- lokal unter "netlify dev" genauso wie auf Netlify.
// Das war im August 2026 die eigentliche Ursache des Fehlers auf dem Branch-Deploy;
// der damalige Umweg über NETLIFY_BLOBS_TOKEN ist damit nur noch Rückfall.
// Hinweis: Das mitgelieferte connectLambda() übergibt die "uncachedEdgeURL" nicht, die
// für Lesen mit starker Konsistenz nötig ist. Deshalb wird der Kontext hier selbst
// gesetzt (gleiche Felder wie connectLambda, plus url_uncached).
function blobsVerbinden(event) {
  if (!event || !event.blobs) return;
  let data;
  try {
    data = JSON.parse(Buffer.from(event.blobs, 'base64').toString('utf8'));
  } catch (err) {
    console.error('blobsVerbinden: event.blobs nicht lesbar:', err);
    return;
  }
  const h = event.headers || {};
  setEnvironmentContext({
    deployID: h['x-nf-deploy-id'],
    siteID: h['x-nf-site-id'],
    edgeURL: data.url,
    uncachedEdgeURL: data.url_uncached || data.url,
    token: data.token,
    primaryRegion: data.primary_region,
  });
}
const crypto = require('crypto');

const STORE_NAME = 'fuehrungen';
const STATE_KEY = 'state';
const IMAGE_STORE_NAME = 'fuehrungen-bilder';
const RECHNUNG_STORE_NAME = 'fuehrungen-rechnungen';
const MAX_RETRIES = 10;

// Seit E2 (03.11.2026) zusätzlich:
//   ereignisse             Protokoll (Buchung angelegt, bezahlt, abgelaufen, storniert, Webhook ...)
//   verarbeiteteEreignisse IDs der schon verarbeiteten Stripe-Ereignisse (Idempotenz des Webhooks)
//   buchungsZaehler        fortlaufende Nummer je Jahr für Buchungsnummern wie ZSH-2026-0001
function emptyState() {
  return { fuehrungen: [], termine: [], buchungen: [], ereignisse: [], verarbeiteteEreignisse: [], buchungsZaehler: {} };
}

// Felder nachrüsten, die ältere Stände noch nicht kennen.
function stateErgaenzen(state) {
  if (!Array.isArray(state.fuehrungen)) state.fuehrungen = [];
  if (!Array.isArray(state.termine)) state.termine = [];
  if (!Array.isArray(state.buchungen)) state.buchungen = [];
  if (!Array.isArray(state.ereignisse)) state.ereignisse = [];
  if (!Array.isArray(state.verarbeiteteEreignisse)) state.verarbeiteteEreignisse = [];
  if (!state.buchungsZaehler || typeof state.buchungsZaehler !== 'object') state.buchungsZaehler = {};
  if (!state.rechnungsZaehler || typeof state.rechnungsZaehler !== 'object') state.rechnungsZaehler = {};
  return state;
}

const RESERVIERUNG_MINUTEN = 15;
const MAX_PROTOKOLL = 2000;
const MAX_EREIGNIS_IDS = 1000;

// Zählt eine Buchung als Platz belegend? Bezahlte immer; reservierte nur, solange die
// Reservierung läuft. Buchungen ohne Status stammen aus der Zeit vor E2 und gelten als bezahlt.
function belegtPlatz(b, jetztMs) {
  const status = b.status || 'bezahlt';
  if (status === 'bezahlt' || status === 'pruefen') return true;
  if (status === 'reserviert') return !b.reserviertBis || new Date(b.reserviertBis).getTime() > jetztMs;
  return false;
}

function neueBuchungsnummer(state, datum) {
  const jahr = String((datum || new Date()).getFullYear());
  const n = (state.buchungsZaehler[jahr] || 0) + 1;
  state.buchungsZaehler[jahr] = n;
  return 'ZSH-' + jahr + '-' + String(n).padStart(4, '0');
}

// Rechnungsnummern fortlaufend und lückenlos je Jahr: R-2026-0001
function neueRechnungsnummer(state, datum) {
  const jahr = String((datum || new Date()).getFullYear());
  const n = (state.rechnungsZaehler[jahr] || 0) + 1;
  state.rechnungsZaehler[jahr] = n;
  return 'R-' + jahr + '-' + String(n).padStart(4, '0');
}

function protokoll(state, eintrag) {
  state.ereignisse.push({ zeit: new Date().toISOString(), ...eintrag });
  if (state.ereignisse.length > MAX_PROTOKOLL) state.ereignisse.splice(0, state.ereignisse.length - MAX_PROTOKOLL);
}

function ereignisSchonVerarbeitet(state, ereignisId) {
  return state.verarbeiteteEreignisse.includes(ereignisId);
}

function ereignisMerken(state, ereignisId) {
  state.verarbeiteteEreignisse.push(ereignisId);
  if (state.verarbeiteteEreignisse.length > MAX_EREIGNIS_IDS) {
    state.verarbeiteteEreignisse.splice(0, state.verarbeiteteEreignisse.length - MAX_EREIGNIS_IDS);
  }
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
  // consistency 'strong': Lesen liefert immer den zuletzt geschriebenen Stand (Blobs ist
  // sonst nur "eventually consistent"). Für Platzzählung und Bestätigung unverzichtbar.
  return getStore({ name: STORE_NAME, consistency: 'strong', ...(cfg || {}) });
}

function getRechnungenStore() {
  const cfg = blobsConfig();
  return getStore({ name: RECHNUNG_STORE_NAME, consistency: 'strong', ...(cfg || {}) });
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
async function withStateIntern(mutator, optionen) {
  const store = getFuehrungenStore();
  // optionen.bestaetigen(stateNachher, result): liefert true, wenn die eigene Änderung im
  // frisch gelesenen Stand tatsächlich enthalten ist. Sicherheitsnetz gegen verlorene
  // Schreibvorgänge (03.11.2026: der lokale Blobs-Server prüft das ETag nicht atomar und
  // hat bei 6 gleichzeitigen Buchungen 5 verloren; auf Netlify ist die Prüfung atomar,
  // die Bestätigung kostet dort nur ein Lesen und fängt Restfälle ab).
  const bestaetigen = optionen && typeof optionen.bestaetigen === 'function' ? optionen.bestaetigen : null;

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

    // Ältere Stände kennen manche Felder noch nicht — nachrüsten, damit der Mutator
    // sich darauf verlassen kann.
    stateErgaenzen(data);

    const draft = JSON.parse(JSON.stringify(data));
    const result = mutator(draft);

    if (!result || result.ok === false) {
      return result || { ok: false, status: 500, error: 'Unbekannter Fehler.' };
    }

    const written = await store.setJSON(STATE_KEY, draft, { onlyIfMatch: etag });
    if (written.modified) {
      if (!bestaetigen) return { ...result, ok: true };
      const nachher = await store.get(STATE_KEY, { type: 'json' });
      if (nachher && bestaetigen(stateErgaenzen(nachher), result)) return { ...result, ok: true };
      // Eigene Änderung fehlt im gelesenen Stand: jemand hat dazwischen überschrieben.
      // Nächster Durchlauf liest neu und wendet den Mutator erneut an.
      continue;
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
  return stateErgaenzen(existing || emptyState());
}

function belegtePersonen(state, terminId) {
  const jetzt = Date.now();
  return state.buchungen
    .filter((b) => b.terminId === terminId && belegtPlatz(b, jetzt))
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

// Schreibvorgänge nacheinander: Auf Netlify bearbeitet eine Function-Instanz ohnehin nur
// eine Anfrage gleichzeitig (Warteschlange ohne Wirkung). Unter netlify dev laufen alle
// Functions in EINEM Prozess, und der lokale Blobs-Server prüft das ETag nicht atomar --
// ohne Warteschlange gingen dort bei gleichzeitigen Buchungen Schreibvorgänge verloren
// (03.11.2026). Produktion verlässt sich auf das atomare onlyIfMatch von Netlify Blobs;
// das wird vor dem Livegang auf dem Branch-Deploy mit dem Prüflauf nachgewiesen (E6).
let schreibSchlange = Promise.resolve();
function withState(mutator, optionen) {
  const lauf = schreibSchlange.then(() => withStateIntern(mutator, optionen));
  schreibSchlange = lauf.catch(() => {});
  return lauf;
}

module.exports = {
  blobsVerbinden,
  withState,
  readState,
  belegtePersonen,
  verfuegbarkeitsStatus,
  terminDatumZeit,
  findFuehrung,
  neueId,
  getBilderStore,
  belegtPlatz,
  neueBuchungsnummer,
  neueRechnungsnummer,
  getRechnungenStore,
  protokoll,
  ereignisSchonVerarbeitet,
  ereignisMerken,
  RESERVIERUNG_MINUTEN,
};
