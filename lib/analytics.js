// Analytics: collect numbers (from the platforms, a CSV export, or demo data) and
// turn them into weekly growth figures.
//
// Metrics are stored as cumulative totals per post per day, so "views this week"
// is the total at the end of the week minus the total at its start.
const { all, get, run, log, onWrite } = require('./db');
const { channelData } = require('./channel-data');
const { localStamp, dateOnly, weekStart, addDays } = require('./planner');
const youtube = require('./youtube');
const instagram = require('./instagram');

const today = () => dateOnly(new Date());
const metricsByChannel = new Map();
const statsByChannel = new Map();
const invalidate = () => { metricsByChannel.clear(); statsByChannel.clear(); };
onWrite(invalidate);

// The numbers for one channel come back in a single request.
function preload(channelId) {
  if (metricsByChannel.has(channelId)) return;
  const data = channelData(channelId);
  metricsByChannel.set(channelId, data.metrics);
  statsByChannel.set(channelId, data.stats);
}

function saveMetrics(postId, m, date = today(), demo = 0) {
  invalidate();
  run(`INSERT INTO metrics(post_id, date, views, likes, comments, shares, saves, avg_view_pct, is_demo) VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(post_id, date) DO UPDATE SET views = excluded.views, likes = excluded.likes, comments = excluded.comments,
         shares = excluded.shares, saves = excluded.saves, avg_view_pct = excluded.avg_view_pct`,
  postId, date, m.views || 0, m.likes || 0, m.comments || 0, m.shares || 0, m.saves || 0, m.avg_view_pct || 0, demo);
}
function saveFollowers(channelId, platform, n, date = today(), demo = 0) {
  invalidate();
  run(`INSERT INTO channel_stats(channel_id, platform, date, followers, is_demo) VALUES(?, ?, ?, ?, ?)
       ON CONFLICT(channel_id, platform, date) DO UPDATE SET followers = excluded.followers`, channelId, platform, date, n, demo);
}

// Posts that exist on the platform but not in our library (made before this app).
function ensureExternalPost(channelId, platform, ext) {
  const found = get('SELECT id FROM posts WHERE platform = ? AND external_id = ?', platform, ext.id);
  if (found) return found.id;
  const file = `${platform}:${ext.id}`;
  let v = get('SELECT id FROM videos WHERE channel_id = ? AND file_path = ?', channelId, file);
  if (!v) {
    const caption = ext.caption || ext.description || '';
    const tags = [...new Set((caption.match(/#[\p{L}\p{N}_]+/gu) || []).map(t => t.slice(1).toLowerCase()))];
    const r = run(`INSERT INTO videos(channel_id, title, file_path, caption, description, tags, status) VALUES(?, ?, ?, ?, ?, ?, 'archived')`,
      channelId, (ext.title || caption.split('\n')[0] || 'Untitled').slice(0, 120), file, caption, caption, JSON.stringify(tags));
    v = { id: Number(r.lastInsertRowid) };
  }
  const when = (ext.publishedAt || ext.timestamp || new Date().toISOString());
  const r = run(`INSERT INTO posts(video_id, channel_id, platform, scheduled_at, status, external_id, url, posted_at) VALUES(?, ?, ?, ?, 'posted', ?, ?, ?)`,
    v.id, channelId, platform, localStamp(new Date(when)), ext.id, ext.permalink || (platform === 'youtube' ? `https://youtu.be/${ext.id}` : ''), localStamp(new Date(when)));
  return Number(r.lastInsertRowid);
}

async function syncChannel(channelId, baseUrl) {
  const report = [];
  for (const acc of all("SELECT * FROM accounts WHERE channel_id = ? AND status = 'connected'", channelId)) {
    try {
      if (acc.platform === 'youtube') for (const u of await youtube.listUploads(acc, baseUrl)) ensureExternalPost(channelId, 'youtube', u);
      else for (const mm of await instagram.listMedia(acc)) if (mm.media_type === 'VIDEO' || mm.media_type === 'REELS') ensureExternalPost(channelId, 'instagram', mm);
      const posts = all("SELECT id, external_id FROM posts WHERE channel_id = ? AND platform = ? AND status = 'posted' AND external_id != ''", channelId, acc.platform);
      const ids = posts.map(p => p.external_id);
      const stats = acc.platform === 'youtube' ? await youtube.fetchStats(acc, ids, baseUrl) : await instagram.fetchStats(acc, ids);
      if (stats.followers != null) saveFollowers(channelId, acc.platform, stats.followers);
      for (const p of posts) if (stats.videos[p.external_id]) saveMetrics(p.id, stats.videos[p.external_id]);
      run("UPDATE accounts SET last_error = '' WHERE id = ?", acc.id);
      report.push(`${acc.platform}: ${posts.length} posts updated`);
    } catch (e) {
      run('UPDATE accounts SET last_error = ? WHERE id = ?', e.message, acc.id);
      report.push(`${acc.platform}: ${e.message}`);
    }
  }
  log(channelId, `Analytics sync — ${report.join('; ') || 'no connected accounts'}`);
  return report;
}

// CSV import for history the APIs can't reach (or channels not connected yet).
// Columns (header row required, order free):
//   type,date,platform,title,views,likes,comments,shares,saves,avg_view_pct,followers
//   type = post | channel.  'post' rows match a library video by title (created if missing).
function importCsv(channelId, text) {
  const rows = text.trim().split(/\r?\n/).map(l => l.match(/("([^"]|"")*"|[^,]*)(,|$)/g).map(c => c.replace(/,$/, '').replace(/^"|"$/g, '').replace(/""/g, '"').trim()));
  const head = rows.shift().map(h => h.toLowerCase());
  const col = (r, k) => r[head.indexOf(k)] ?? '';
  let posts = 0, channel = 0;
  for (const r of rows) {
    if (!r.join('')) continue;
    const type = col(r, 'type') || 'post', date = col(r, 'date') || today(), platform = (col(r, 'platform') || 'youtube').toLowerCase();
    if (type === 'channel') { saveFollowers(channelId, platform, +col(r, 'followers') || 0, date); channel++; continue; }
    const title = col(r, 'title');
    let v = get('SELECT id FROM videos WHERE channel_id = ? AND lower(title) = lower(?)', channelId, title);
    if (!v) v = { id: Number(run(`INSERT INTO videos(channel_id, title, file_path, status) VALUES(?, ?, ?, 'archived')`, channelId, title, `csv:${title}`).lastInsertRowid) };
    let p = get("SELECT id FROM posts WHERE video_id = ? AND platform = ?", v.id, platform);
    if (!p) p = { id: Number(run(`INSERT INTO posts(video_id, channel_id, platform, scheduled_at, status, posted_at) VALUES(?, ?, ?, ?, 'posted', ?)`, v.id, channelId, platform, `${date}T12:00`, `${date}T12:00`).lastInsertRowid) };
    saveMetrics(p.id, { views: +col(r, 'views'), likes: +col(r, 'likes'), comments: +col(r, 'comments'), shares: +col(r, 'shares'), saves: +col(r, 'saves'), avg_view_pct: +col(r, 'avg_view_pct') }, date);
    posts++;
  }
  log(channelId, `CSV import: ${posts} post rows, ${channel} channel rows`);
  return { posts, channel };
}

// ---- reading the numbers back ----

// Latest cumulative totals for a post on or before a date.
function totalsAt(postId, date) {
  const blank = { views: 0, likes: 0, comments: 0, shares: 0, saves: 0, avg_view_pct: 0 };
  for (const rows of metricsByChannel.values()) {
    let seen = false, best = null;
    for (const row of rows) {
      if (row.post_id !== postId) continue;
      seen = true;
      if (row.date <= date) best = row;
    }
    if (seen) return best ? { views: best.views, likes: best.likes, comments: best.comments, shares: best.shares, saves: best.saves, avg_view_pct: best.avg_view_pct } : blank;
  }
  return get(`SELECT views, likes, comments, shares, saves, avg_view_pct FROM metrics WHERE post_id = ? AND date <= ? ORDER BY date DESC LIMIT 1`, postId, date) || blank;
}
function followersAt(channelId, platform, date) {
  const rows = statsByChannel.get(channelId);
  if (rows) {
    let best = null;
    for (const row of rows) if (row.platform === platform && row.date <= date) best = row;
    return best ? best.followers : null;
  }
  const r = get('SELECT followers FROM channel_stats WHERE channel_id = ? AND platform = ? AND date <= ? ORDER BY date DESC LIMIT 1', channelId, platform, date);
  return r ? r.followers : null;
}

// Week-over-week growth for a channel, per platform.
function weeklyGrowth(channelId, ref = new Date()) {
  preload(channelId);
  // This week so far vs. the same days of last week, so a Tuesday isn't compared with a full week.
  const thisMon = weekStart(ref), lastMon = addDays(thisMon, -7);
  const d = x => dateOnly(addDays(x, -1));                          // the day before a Monday closes the previous week
  const end = dateOnly(ref), start = d(thisMon), prevStart = d(lastMon), prevEnd = dateOnly(addDays(ref, -7));
  const out = {};
  const data = channelData(channelId);
  const platforms = [...new Set([...data.posts.map(p => p.platform), ...data.stats.map(s => s.platform)])];
  for (const pf of platforms) {
    const posts = data.posts.filter(p => p.platform === pf && p.status === 'posted');
    const sum = (a, b) => posts.reduce((s, p) => {
      const x = totalsAt(p.id, b), y = totalsAt(p.id, a);
      return { views: s.views + x.views - y.views, eng: s.eng + (x.likes + x.comments + x.shares + x.saves) - (y.likes + y.comments + y.shares + y.saves) };
    }, { views: 0, eng: 0 });
    const cur = sum(start, end), prev = sum(prevStart, prevEnd);
    const f = [followersAt(channelId, pf, end), followersAt(channelId, pf, start), followersAt(channelId, pf, prevStart), followersAt(channelId, pf, prevEnd)];
    const pct = (a, b) => (b ? Math.round(((a - b) / b) * 1000) / 10 : null);
    const published = posts.filter(p => p.posted_at >= localStamp(thisMon)).length;
    out[pf] = {
      followers: f[0], followers_gained: f[0] != null && f[1] != null ? f[0] - f[1] : null,
      followers_gained_prev: f[3] != null && f[2] != null ? f[3] - f[2] : null,
      views: cur.views, views_prev: prev.views, views_change_pct: pct(cur.views, prev.views),
      engagements: cur.eng, engagements_prev: prev.eng, engagement_change_pct: pct(cur.eng, prev.eng),
      published,
    };
  }
  return out;
}

// Daily follower series and weekly views series for charts.
function series(channelId, weeks = 8) {
  preload(channelId);
  const startDay = dateOnly(addDays(new Date(), -weeks * 7));
  const data = channelData(channelId);
  const followers = data.stats.filter(s => s.date >= startDay).sort((a, b) => a.date < b.date ? -1 : a.date > b.date ? 1 : 0);
  const weekly = [];
  for (let i = weeks - 1; i >= 0; i--) {
    const mon = addDays(weekStart(), -7 * i), a = dateOnly(addDays(mon, -1)), b = dateOnly(addDays(mon, 6));
    const row = { week: dateOnly(mon) };
    for (const pf of ['youtube', 'instagram']) {
      const posts = data.posts.filter(p => p.platform === pf && p.status === 'posted');
      row[pf] = posts.reduce((s, p) => s + totalsAt(p.id, b).views - totalsAt(p.id, a).views, 0);
    }
    weekly.push(row);
  }
  return { followers, weekly };
}

// Per-post performance table (lifetime totals).
function postTable(channelId) {
  return all(`SELECT p.id, p.platform, p.posted_at, p.url, v.title, v.tags, v.duration, v.caption,
                (SELECT views FROM metrics m WHERE m.post_id = p.id ORDER BY date DESC LIMIT 1) views,
                (SELECT likes + comments + shares + saves FROM metrics m WHERE m.post_id = p.id ORDER BY date DESC LIMIT 1) engagements,
                (SELECT avg_view_pct FROM metrics m WHERE m.post_id = p.id ORDER BY date DESC LIMIT 1) avg_view_pct
              FROM posts p JOIN videos v ON v.id = p.video_id
              WHERE p.channel_id = ? AND p.status = 'posted' ORDER BY p.posted_at DESC`, channelId)
    .map(r => ({ ...r, views: r.views || 0, engagements: r.engagements || 0, tags: JSON.parse(r.tags || '[]') }));
}

module.exports = { syncChannel, importCsv, weeklyGrowth, series, postTable, saveMetrics, saveFollowers, totalsAt, preload };
