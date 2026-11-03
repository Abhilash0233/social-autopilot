// Instagram (professional accounts), via the Instagram API with Instagram Login.
// Connection: paste a long-lived access token and the account's user ID, generated in
// Meta's App Dashboard (Instagram → API setup with Instagram login → Generate token).
//
// Reels publishing is two steps: create a REELS container from a *public* video URL,
// wait for Instagram to finish processing it, then publish the container. Instagram
// fetches the file itself, so the video must be reachable on the internet — set
// "Public media URL" in Settings to a tunnel/host that serves this app's /media routes.
const { get, run, setting, log } = require('./db');

const host = () => `https://${setting('instagram_graph_host', 'graph.instagram.com')}/${setting('instagram_api_version', 'v23.0')}`;

async function call(method, path, params, token) {
  const url = new URL(host() + path);
  const body = new URLSearchParams({ ...params, access_token: token });
  const res = method === 'GET'
    ? await fetch(`${url}?${body}`)
    : await fetch(url, { method, body });
  const json = await res.json().catch(() => ({}));
  if (!res.ok || json.error) throw new Error(json.error ? `${json.error.message} (code ${json.error.code})` : `HTTP ${res.status}`);
  return json;
}

async function connect(channelId, token, userId) {
  const me = await call('GET', `/${userId || 'me'}`, { fields: 'user_id,username,followers_count' }, token);
  run(`INSERT INTO accounts(channel_id, platform, handle, external_id, access_token, status, last_error)
       VALUES(?, 'instagram', ?, ?, ?, 'connected', '')
       ON CONFLICT(channel_id, platform) DO UPDATE SET handle = excluded.handle, external_id = excluded.external_id,
         access_token = excluded.access_token, status = 'connected', last_error = ''`,
  channelId, '@' + me.username, String(me.user_id || me.id || userId), token);
  log(channelId, `Instagram connected: @${me.username}`);
  return me.username;
}

const sleep = ms => new Promise(r => setTimeout(r, ms));

async function publishReel(account, video, mediaBase) {
  if (!mediaBase) throw new Error('Instagram needs a public URL for the video. Set "Public media URL" in Settings, or post this one manually.');
  const params = {
    media_type: 'REELS', video_url: `${mediaBase}/media/video/${video.id}`,
    caption: video.caption || video.title, share_to_feed: 'true',
  };
  if (video.cover_path) params.cover_url = `${mediaBase}/media/cover/${video.id}`;
  const container = await call('POST', `/${account.external_id}/media`, params, account.access_token);
  for (let i = 0; i < 60; i++) {                          // processing usually takes under a minute
    await sleep(5000);
    const s = await call('GET', `/${container.id}`, { fields: 'status_code,status' }, account.access_token);
    if (s.status_code === 'FINISHED') break;
    if (s.status_code === 'ERROR' || s.status_code === 'EXPIRED') throw new Error(`Instagram could not process the video: ${s.status || s.status_code}`);
    if (i === 59) throw new Error('Instagram is still processing the video after 5 minutes; try again later.');
  }
  const pub = await call('POST', `/${account.external_id}/media_publish`, { creation_id: container.id }, account.access_token);
  const info = await call('GET', `/${pub.id}`, { fields: 'permalink' }, account.access_token).catch(() => ({}));
  return { external_id: pub.id, url: info.permalink || '' };
}

async function fetchStats(account, mediaIds) {
  const out = { followers: null, videos: {} };
  const me = await call('GET', `/${account.external_id}`, { fields: 'followers_count' }, account.access_token);
  out.followers = Number(me.followers_count || 0);
  for (const id of mediaIds) {
    const base = await call('GET', `/${id}`, { fields: 'like_count,comments_count' }, account.access_token).catch(() => ({}));
    const m = { views: 0, likes: base.like_count || 0, comments: base.comments_count || 0, shares: 0, saves: 0 };
    try {
      const ins = await call('GET', `/${id}/insights`, { metric: 'views,shares,saved' }, account.access_token);
      for (const d of ins.data || []) {
        const v = d.values ? d.values[0].value : d.total_value && d.total_value.value;
        if (d.name === 'views') m.views = v || 0; if (d.name === 'shares') m.shares = v || 0; if (d.name === 'saved') m.saves = v || 0;
      }
    } catch (e) { /* insights need the manage_insights permission; likes/comments still count */ }
    out.videos[id] = m;
  }
  return out;
}

async function listMedia(account, max = 200) {
  const items = []; let after;
  do {
    const r = await call('GET', `/${account.external_id}/media`, { fields: 'id,caption,media_type,timestamp,permalink', limit: '50', ...(after ? { after } : {}) }, account.access_token);
    items.push(...(r.data || []));
    after = r.paging && r.paging.cursors && r.paging.next ? r.paging.cursors.after : null;
  } while (after && items.length < max);
  return items;
}

module.exports = { connect, publishReel, fetchStats, listMedia };
