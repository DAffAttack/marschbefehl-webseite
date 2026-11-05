// Öffentliche, ungeschützte Function: liefert die aktuellen YouTube-Kennzahlen
// des Kanals (Abonnenten, Gesamtaufrufe, Videoanzahl, Gründungsdatum) für die
// Kooperationen-Seite. Läuft serverseitig statt wie zuvor direkt im Browser --
// dadurch funktioniert es auf JEDER Adresse gleich (Produktion, Vorschau-Branch,
// lokal), ohne dass ein HTTP-Referrer-eingeschränkter API-Schlüssel im Quelltext
// des Browsers auftauchen muss. Der YouTube-API-Schlüssel liegt jetzt nur noch
// als Umgebungsvariable YOUTUBE_API_KEY auf dem Server.

const { json, errorResponse } = require('./_lib/http');

const YT_CHANNEL_ID = 'UCS66v6xykvKupyUme3wpMwA';

exports.handler = async (event) => {
  if (event.httpMethod !== 'GET') {
    return errorResponse(405, 'Nur GET erlaubt.');
  }

  const apiKey = process.env.YOUTUBE_API_KEY;
  if (!apiKey) {
    return errorResponse(
      500,
      'Der Verwaltungsbereich ist noch nicht eingerichtet: Die Umgebungsvariable YOUTUBE_API_KEY fehlt im Netlify-Projekt.'
    );
  }

  try {
    const url =
      'https://www.googleapis.com/youtube/v3/channels?part=snippet,statistics&id=' +
      YT_CHANNEL_ID +
      '&key=' +
      apiKey;
    const res = await fetch(url);
    const data = await res.json();
    const item = data.items && data.items[0];
    const stats = item && item.statistics;

    if (!stats) {
      console.error('youtube-stats: keine statistics im Response', JSON.stringify(data).slice(0, 500));
      return errorResponse(502, 'Keine Kanaldaten von YouTube erhalten.');
    }

    return json(200, {
      ok: true,
      subscriberCount: stats.subscriberCount,
      viewCount: stats.viewCount,
      videoCount: stats.videoCount,
      publishedAt: item.snippet ? item.snippet.publishedAt : null,
    });
  } catch (err) {
    console.error('youtube-stats Fehler:', err);
    return errorResponse(502, 'YouTube-Daten konnten nicht geladen werden.');
  }
};
