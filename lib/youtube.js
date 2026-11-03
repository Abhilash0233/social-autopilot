// YouTube: OAuth connection, uploads, and statistics, via the official googleapis client.
// Needs a Google Cloud OAuth client (type "Web application") with the redirect URI
//   http://localhost:<port>/oauth/youtube/callback
const fs = require('fs');
const { google } = require('googleapis');
const { get, run, setting, log } = require('./db');
const storage = require('./storage');

const SCOPES = [
  'https://www.googleapis.com/auth/youtube.upload',
  'https://www.googleapis.com/auth/youtube.readonly',
  'https://www.googleapis.com/auth/yt-analytics.readonly',
];

function oauthClient(baseUrl) {
  const id = setting('google_client_id'), secret = setting('google_client_secret');
  if (!id || !secret) throw new Error('Add your Google OAuth client ID and secret in Settings first.');
  return new google.auth.OAuth2(id, secret, `${baseUrl}/oauth/youtube/callback`);
}

function authUrl(baseUrl, channelId) {
  return oauthClient(baseUrl).generateAuthUrl({ access_type: 'offline', prompt: 'consent', scope: SCOPES, state: String(channelId) });
}

async function handleCallback(baseUrl, code, channelId) {
  const client = oauthClient(baseUrl);
  const { tokens } = await client.getToken(code);
  client.setCredentials(tokens);
  const yt = google.youtube({ version: 'v3', auth: client });
  const me = await yt.channels.list({ part: ['snippet', 'statistics'], mine: true });
  const c = me.data.items && me.data.items[0];
  if (!c) throw new Error('This Google account has no YouTube channel.');
  run(`INSERT INTO accounts(channel_id, platform, handle, external_id, access_token, refresh_token, token_expiry, status, last_error)
       VALUES(?, 'youtube', ?, ?, ?, ?, ?, 'connected', '')
       ON CONFLICT(channel_id, platform) DO UPDATE SET handle = excluded.handle, external_id = excluded.external_id,
         access_token = excluded.access_token, refresh_token = COALESCE(NULLIF(excluded.refresh_token, ''), accounts.refresh_token),
         token_expiry = excluded.token_expiry, status = 'connected', last_error = ''`,
  channelId, c.snippet.customUrl || c.snippet.title, c.id, tokens.access_token || '', tokens.refresh_token || '', String(tokens.expiry_date || ''));
  log(channelId, `YouTube connected: ${c.snippet.title}`);
  return c.snippet.title;
}

// An authorised client for a stored account; refreshed tokens are saved back.
function clientFor(account, baseUrl) {
  const client = oauthClient(baseUrl);
  client.setCredentials({ access_token: account.access_token, refresh_token: account.refresh_token, expiry_date: Number(account.token_expiry) || undefined });
  client.on('tokens', t => run('UPDATE accounts SET access_token = ?, token_expiry = ? WHERE id = ?', t.access_token || account.access_token, String(t.expiry_date || ''), account.id));
  return client;
}

async function upload(account, video, baseUrl) {
  const auth = clientFor(account, baseUrl);
  const yt = google.youtube({ version: 'v3', auth });
  const tags = JSON.parse(video.tags || '[]').slice(0, 15);
  const res = await yt.videos.insert({
    part: ['snippet', 'status'],
    requestBody: {
      snippet: { title: video.title.slice(0, 100), description: (video.description || video.caption || '').slice(0, 4900), tags, categoryId: '1' },
      status: { privacyStatus: setting('youtube_privacy', 'public'), selfDeclaredMadeForKids: false },
    },
    media: { body: fs.createReadStream(await storage.localFile(video.file_path)) },
  });
  const id = res.data.id;
  if (video.thumb_path && fs.existsSync(video.thumb_path)) {
    // custom thumbnails need a verified channel; a failure here shouldn't fail the post
    try { await yt.thumbnails.set({ videoId: id, media: { body: fs.createReadStream(video.thumb_path) } }); }
    catch (e) { log(video.channel_id, `YouTube thumbnail not set (${e.message}). Verify the channel to allow custom thumbnails.`); }
  }
  return { external_id: id, url: `https://youtu.be/${id}` };
}

// Current totals for posted videos and the channel's subscriber count.
async function fetchStats(account, postIds, baseUrl) {
  const auth = clientFor(account, baseUrl);
  const yt = google.youtube({ version: 'v3', auth });
  const out = { followers: null, videos: {} };
  const ch = await yt.channels.list({ part: ['statistics'], id: [account.external_id] });
  if (ch.data.items && ch.data.items[0]) out.followers = Number(ch.data.items[0].statistics.subscriberCount || 0);
  for (let i = 0; i < postIds.length; i += 50) {
    const r = await yt.videos.list({ part: ['statistics'], id: postIds.slice(i, i + 50) });
    for (const v of r.data.items || []) {
      out.videos[v.id] = { views: +v.statistics.viewCount || 0, likes: +v.statistics.likeCount || 0, comments: +v.statistics.commentCount || 0 };
    }
  }
  return out;
}

// Every upload on the channel (for analysing content that was posted before this app).
async function listUploads(account, baseUrl, max = 200) {
  const auth = clientFor(account, baseUrl);
  const yt = google.youtube({ version: 'v3', auth });
  const ch = await yt.channels.list({ part: ['contentDetails'], id: [account.external_id] });
  const uploads = ch.data.items[0].contentDetails.relatedPlaylists.uploads;
  const items = []; let pageToken;
  do {
    const r = await yt.playlistItems.list({ part: ['snippet', 'contentDetails'], playlistId: uploads, maxResults: 50, pageToken });
    for (const it of r.data.items || []) items.push({ id: it.contentDetails.videoId, title: it.snippet.title, description: it.snippet.description, publishedAt: it.contentDetails.videoPublishedAt });
    pageToken = r.data.nextPageToken;
  } while (pageToken && items.length < max);
  return items;
}

module.exports = { authUrl, handleCallback, upload, fetchStats, listUploads };
