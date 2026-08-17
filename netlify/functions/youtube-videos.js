// Öffentliche, ungeschützte Function: liefert die neuesten Videos des Kanals
// (für die Videos-Seite, inkl. "Weitere Videos laden"-Pagination) serverseitig
// statt wie zuvor per direktem Browser-Aufruf mit offen im Quelltext liegendem
// API-Schlüssel. Der Schlüssel liegt jetzt nur noch als Umgebungsvariable
// YOUTUBE_API_KEY auf dem Server (dieselbe Variable wie bei youtube-stats.js).
//
// Ablauf: Erster Aufruf ohne Parameter -> ermittelt die Uploads-Playlist-ID
// des Kanals UND liefert gleich die erste Videoseite mit. Für "weitere Videos
// laden" schickt das Frontend die zurückgegebene uploadsPlaylistId erneut mit
// (spart den erneuten Channel-Lookup) sowie den nextPageToken der letzten
// Antwort.

const { json, errorResponse } = require('./_lib/http');

const YT_CHANNEL_ID = 'UCS66v6xykvKupyUme3wpMwA';
const PAGE_SIZE = 12;

exports.handler = async (event) => {
  if (event.httpMethod !== 'GET') {
    return errorResponse(405, 'Nur GET erlaubt.');
  }

  const apiKey = process.env.YOUTUBE_API_KEY;
  if (!apiKey) {
    return errorResponse(500, 'Die Umgebungsvariable YOUTUBE_API_KEY fehlt im Netlify-Projekt.');
  }

  const params = event.queryStringParameters || {};
  const pageToken = typeof params.pageToken === 'string' ? params.pageToken.trim() : '';
  let uploadsPlaylistId = typeof params.uploadsPlaylistId === 'string' ? params.uploadsPlaylistId.trim() : '';

  try {
    if (!uploadsPlaylistId) {
      const channelUrl =
        'https://www.googleapis.com/youtube/v3/channels?part=contentDetails&id=' + YT_CHANNEL_ID + '&key=' + apiKey;
      const channelRes = await fetch(channelUrl);
      const channelData = await channelRes.json();
      uploadsPlaylistId =
        channelData.items &&
        channelData.items[0] &&
        channelData.items[0].contentDetails &&
        channelData.items[0].contentDetails.relatedPlaylists &&
        channelData.items[0].contentDetails.relatedPlaylists.uploads;
      if (!uploadsPlaylistId) {
        console.error('youtube-videos: keine uploads-Playlist gefunden', JSON.stringify(channelData).slice(0, 500));
        return errorResponse(502, 'Kanal-Uploads-Playlist konnte nicht ermittelt werden.');
      }
    }

    const itemsUrl =
      'https://www.googleapis.com/youtube/v3/playlistItems?part=snippet&maxResults=' +
      PAGE_SIZE +
      '&playlistId=' +
      encodeURIComponent(uploadsPlaylistId) +
      '&key=' +
      apiKey +
      (pageToken ? '&pageToken=' + encodeURIComponent(pageToken) : '');
    const itemsRes = await fetch(itemsUrl);
    const itemsData = await itemsRes.json();

    if (!itemsData.items) {
      console.error('youtube-videos: keine items im Response', JSON.stringify(itemsData).slice(0, 500));
      return errorResponse(502, 'Videos konnten nicht geladen werden.');
    }

    return json(200, {
      ok: true,
      uploadsPlaylistId: uploadsPlaylistId,
      items: itemsData.items,
      nextPageToken: itemsData.nextPageToken || null,
    });
  } catch (err) {
    console.error('youtube-videos Fehler:', err);
    return errorResponse(502, 'Videos konnten nicht geladen werden.');
  }
};
