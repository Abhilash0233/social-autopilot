// Social Manager — a local app for running several YouTube/Instagram channels.
//   npm start  →  http://localhost:4173
// The site binds to 127.0.0.1. Channel data is stored in Supabase; video files stay on disk.
const path = require('path');
const fs = require('fs');
const express = require('express');
const multer = require('multer');
const { all, get, run, parse, setting, setSetting, log } = require('./lib/db');
const library = require('./lib/library');
const planner = require('./lib/planner');
const publish = require('./lib/publish');
const analytics = require('./lib/analytics');
const insights = require('./lib/insights');
const demo = require('./lib/demo');
const youtube = require('./lib/youtube');
const instagram = require('./lib/instagram');
const manager = require('./lib/manager');
const storage = require('./lib/storage');

const PORT = Number(process.env.PORT || 4173);
const BASE = `http://localhost:${PORT}`;
const app = express();
app.use(express.json({ limit: '5mb' }));
app.use(express.text({ type: 'text/csv', limit: '20mb' }));
app.use(express.static(path.join(__dirname, 'public')));

const wrap = fn => async (req, res) => {
  try { res.json(await fn(req, res)); }
  catch (e) { console.error(e); res.status(e.status || 400).json({ error: e.message }); }
};
const toVideo = v => parse(v, 'tags');
const SECRET_KEYS = ['google_client_secret', 'anthropic_api_key'];

// ---- overview ----
app.get('/api/state', wrap(() => ({
  channels: all('SELECT * FROM channels ORDER BY id').map(c => ({
    ...parse(c, 'schedule'),
    accounts: all('SELECT id, platform, handle, profile_url, status, last_error FROM accounts WHERE channel_id = ?', c.id),
    counts: get(`SELECT (SELECT COUNT(*) FROM videos WHERE channel_id = ? AND status = 'ready') ready,
                        (SELECT COUNT(*) FROM videos WHERE channel_id = ? AND status = 'draft') drafts,
                        (SELECT COUNT(*) FROM posts WHERE channel_id = ? AND status = 'posted') posted`, c.id, c.id, c.id),
    demo: demo.hasDemo(c.id),
  })),
  aiReady: !!(setting('anthropic_api_key') || process.env.ANTHROPIC_API_KEY),
  publicMedia: !!setting('public_media_url'),
})));

app.get('/api/dashboard', wrap(() => {
  const mon = planner.weekStart(), next = planner.addDays(mon, 7);
  return {
    week: planner.dateOnly(mon),
    channels: all('SELECT * FROM channels ORDER BY id').map(c => {
      const r = insights.analyse(c.id);
      return { id: c.id, name: c.name, color: c.color, growth: r.growth, summary: r.summary, next: r.next.slice(0, 3), working: r.working.slice(0, 2), demo: r.demo,
        thisWeek: planner.readiness(c.id, mon), nextWeek: planner.readiness(c.id, next) };
    }),
    upcoming: all(`SELECT p.*, v.title, c.name channel, c.color FROM posts p JOIN videos v ON v.id = p.video_id JOIN channels c ON c.id = p.channel_id
                   WHERE p.scheduled_at >= ? AND p.scheduled_at < ? AND p.is_demo = 0 ORDER BY p.scheduled_at`, planner.localStamp(new Date(Date.now() - 864e5)), planner.localStamp(next)),
    todo: all(`SELECT p.*, v.title, v.caption, v.cover_path != '' has_cover, v.portrait_path != '' has_portrait, v.thumb_path != '' has_thumb, c.name channel, c.color FROM posts p JOIN videos v ON v.id = p.video_id JOIN channels c ON c.id = p.channel_id
               WHERE p.status IN ('manual_due','failed') ORDER BY p.scheduled_at`),
    activity: all('SELECT a.*, c.name channel FROM activity a LEFT JOIN channels c ON c.id = a.channel_id ORDER BY a.id DESC LIMIT 12'),
  };
}));

// ---- channels & accounts ----
const channelFields = b => [b.name, b.niche || '', b.color || '#2a78d6', b.video_dir || '', JSON.stringify(b.schedule || []), Number(b.weekly_goal) || 0];
app.post('/api/channels', wrap(req => {
  if (!req.body.name) throw new Error('Give the channel a name.');
  const id = Number(run('INSERT INTO channels(name, niche, color, video_dir, schedule, weekly_goal) VALUES(?, ?, ?, ?, ?, ?)', ...channelFields(req.body)).lastInsertRowid);
  log(id, `Channel created: ${req.body.name}`);
  return { id };
}));
app.put('/api/channels/:id', wrap(req => {
  run('UPDATE channels SET name = ?, niche = ?, color = ?, video_dir = ?, schedule = ?, weekly_goal = ? WHERE id = ?', ...channelFields(req.body), req.params.id);
  return { ok: true };
}));
app.delete('/api/channels/:id', wrap(req => { run('DELETE FROM channels WHERE id = ?', req.params.id); return { ok: true }; }));
app.post('/api/channels/:id/import', wrap(req => library.importFolder(Number(req.params.id))));

app.post('/api/channels/:id/instagram', wrap(async req => ({ handle: await instagram.connect(Number(req.params.id), req.body.token.trim(), (req.body.user_id || '').trim()) })));
app.delete('/api/accounts/:id', wrap(req => { run("UPDATE accounts SET status = 'manual', access_token = '', refresh_token = '' WHERE id = ?", req.params.id); return { ok: true }; }));

app.get('/oauth/youtube/start', (req, res) => {
  try { res.redirect(youtube.authUrl(BASE, req.query.channel)); }
  catch (e) { res.status(400).send(`<p>${e.message}</p><p><a href="/#/settings">Open Settings</a></p>`); }
});
app.get('/oauth/youtube/callback', async (req, res) => {
  try {
    const name = await youtube.handleCallback(BASE, req.query.code, Number(req.query.state));
    res.redirect(`/#/channels?connected=${encodeURIComponent(name)}`);
  } catch (e) { res.status(400).send(`<p>YouTube connection failed: ${e.message}</p><p><a href="/#/channels">Back</a></p>`); }
});

// ---- library ----
app.get('/api/videos', wrap(req => all(`SELECT v.*, coalesce((SELECT json_agg(json_build_object('platform', platform, 'status', status, 'scheduled_at', scheduled_at, 'url', url))
                                        FROM posts p WHERE p.video_id = v.id), '[]'::json)::text posts FROM videos v
                                        WHERE (? = 0 OR channel_id = ?) AND is_demo = 0 ORDER BY v.id DESC`, +req.query.channel || 0, +req.query.channel || 0)
  .map(v => ({ ...toVideo(v), posts: JSON.parse(v.posts || '[]') }))));
app.put('/api/videos/:id', wrap(req => {
  const b = req.body;
  run('UPDATE videos SET title = ?, caption = ?, description = ?, tags = ?, status = ? WHERE id = ?', b.title, b.caption || '', b.description || '', JSON.stringify(b.tags || []), b.status || 'ready', req.params.id);
  return { ok: true };
}));

const uploadDir = path.join(__dirname, 'data', 'uploads');
fs.mkdirSync(uploadDir, { recursive: true });
const upload = multer({
  storage: multer.diskStorage({
    destination: (req, file, cb) => cb(null, uploadDir),
    filename: (req, file, cb) => cb(null, `${Date.now()}-${file.originalname.replace(/[^\w.-]/g, '_')}`),
  }),
  limits: { fileSize: storage.MAX_BYTES },
  fileFilter: (req, file, cb) => {
    const video = file.fieldname === 'video';
    const ok = video ? /\.(mp4|mov|m4v|webm)$/i.test(file.originalname) : /\.(png|jpe?g|webp)$/i.test(file.originalname);
    cb(ok ? null : new Error(video ? 'Use an mp4, mov, m4v, or webm video.' : 'Covers must be a PNG, JPEG, or WebP.'), ok);
  },
});
const VIDEO_FIELDS = [{ name: 'video', maxCount: 1 }, { name: 'cover', maxCount: 1 }, { name: 'portrait', maxCount: 1 }, { name: 'thumb', maxCount: 1 }];
const receiveFiles = (req, res) => new Promise((resolve, reject) => upload.fields(VIDEO_FIELDS)(req, res, err => {
  if (err && err.code === 'LIMIT_FILE_SIZE') reject(new Error('Videos must be 400 MB or smaller.'));
  else if (err) reject(err);
  else resolve();
}));
const savedFile = (req, field) => (req.files && req.files[field] && req.files[field][0] ? req.files[field][0].path : '');

app.post('/api/videos', wrap(async (req, res) => {
  await receiveFiles(req, res);
  const b = req.body;
  const video = savedFile(req, 'video');
  if (!b.channel_id) throw new Error('Choose a channel.');
  if (!b.title || !b.title.trim()) throw new Error('Give the video a title.');
  if (!video) throw new Error('Choose the video file.');
  const cover = savedFile(req, 'cover'), portrait = savedFile(req, 'portrait'), thumb = savedFile(req, 'thumb');
  if (!cover) throw new Error('Add the vertical cover (9:16).');
  if (!portrait) throw new Error('Add the portrait cover (4:5).');
  const tags = JSON.stringify(String(b.tags || '').split(',').map(s => s.trim().replace(/^#/, '').toLowerCase()).filter(Boolean));
  const name = storage.objectName(req.files.video[0].originalname);
  const stored = await storage.upload(video, name, storage.contentType(req.files.video[0].originalname, req.files.video[0].mimetype));
  let id;
  try {
    id = Number(run(`INSERT INTO videos(channel_id, title, file_path, cover_path, portrait_path, thumb_path, caption, description, tags, duration, status)
      VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    b.channel_id, b.title.trim(), stored, cover, portrait, thumb, b.caption || '', b.description || '', tags, library.probeDuration(video), b.status || 'ready').lastInsertRowid);
  } catch (err) {
    await storage.remove(stored).catch(() => {});
    throw err;
  } finally {
    fs.unlink(video, () => {});
  }
  log(b.channel_id, `Added video: ${b.title.trim()}`);
  return { id };
}));

app.post('/api/videos/:id/images', wrap(async (req, res) => {
  await receiveFiles(req, res);
  const v = get('SELECT * FROM videos WHERE id = ?', req.params.id);
  if (!v) throw new Error('Video not found.');
  const cover = savedFile(req, 'cover') || v.cover_path;
  const portrait = savedFile(req, 'portrait') || v.portrait_path;
  const thumb = savedFile(req, 'thumb') || v.thumb_path;
  run('UPDATE videos SET cover_path = ?, portrait_path = ?, thumb_path = ? WHERE id = ?', cover, portrait, thumb, v.id);
  return { ok: true };
}));

// media files: covers/thumbnails for the UI, and videos for Instagram to fetch
const mediaRoute = col => async (req, res) => {
  try {
    const v = get('SELECT * FROM videos WHERE id = ?', req.params.id);
    const file = v && v[col];
    if (!file) return res.status(404).end();
    if (storage.isStored(file)) return res.redirect(await storage.signedUrl(file));
    if (!fs.existsSync(file)) return res.status(404).end();
    res.sendFile(file);
  } catch (err) {
    console.error(err);
    if (!res.headersSent) res.status(404).end();
  }
};
app.get('/media/video/:id', mediaRoute('file_path'));
app.get('/media/cover/:id', mediaRoute('cover_path'));
app.get('/media/portrait/:id', mediaRoute('portrait_path'));
app.get('/media/thumb/:id', mediaRoute('thumb_path'));

// ---- planner & publishing ----
app.get('/api/posts', wrap(req => all(`SELECT p.*, v.title, v.caption, v.cover_path != '' has_cover, v.portrait_path != '' has_portrait, v.thumb_path != '' has_thumb, c.name channel, c.color
                                       FROM posts p JOIN videos v ON v.id = p.video_id JOIN channels c ON c.id = p.channel_id
                                       WHERE p.scheduled_at >= ? AND p.scheduled_at < ? AND p.is_demo = 0 ORDER BY p.scheduled_at`, req.query.from, req.query.to)));
app.post('/api/posts', wrap(req => {
  const v = get('SELECT * FROM videos WHERE id = ?', req.body.video_id);
  const id = Number(run('INSERT INTO posts(video_id, channel_id, platform, scheduled_at) VALUES(?, ?, ?, ?)', v.id, v.channel_id, req.body.platform, req.body.scheduled_at).lastInsertRowid);
  return { id };
}));
app.put('/api/posts/:id', wrap(req => {
  const b = req.body;
  if (b.scheduled_at) run("UPDATE posts SET scheduled_at = ?, status = CASE WHEN status IN ('failed','manual_due') THEN 'planned' ELSE status END WHERE id = ?", b.scheduled_at, req.params.id);
  if (b.status === 'posted') run("UPDATE posts SET status = 'posted', url = ?, posted_at = ?, error = '' WHERE id = ?", b.url || '', planner.localStamp(new Date()), req.params.id);
  return { ok: true };
}));
app.delete('/api/posts/:id', wrap(req => { run("DELETE FROM posts WHERE id = ? AND status != 'posted'", req.params.id); return { ok: true }; }));
app.post('/api/posts/:id/publish', wrap(req => publish.publishPost(Number(req.params.id), BASE)));
app.post('/api/plan/auto', wrap(req => {
  const mon = planner.weekStart(new Date(req.body.week + 'T00:00'));
  const ids = req.body.channel_id ? [req.body.channel_id] : all('SELECT id FROM channels').map(c => c.id);
  return ids.map(id => ({ channel_id: id, ...planner.autoPlan(id, mon) }));
}));

// ---- analytics & insights ----
app.get('/api/analytics/:id', wrap(req => ({ growth: analytics.weeklyGrowth(+req.params.id), series: analytics.series(+req.params.id), posts: analytics.postTable(+req.params.id), demo: demo.hasDemo(+req.params.id) })));
app.post('/api/analytics/:id/sync', wrap(async req => ({ report: await analytics.syncChannel(+req.params.id, BASE) })));
app.post('/api/analytics/:id/csv', wrap(req => analytics.importCsv(+req.params.id, req.body)));
app.post('/api/demo/:id', wrap(req => { demo.loadDemo(+req.params.id); return { ok: true }; }));
app.delete('/api/demo/:id', wrap(req => { demo.clearDemo(+req.params.id); return { ok: true }; }));
app.get('/api/insights/:id', wrap(req => insights.analyse(+req.params.id)));
app.post('/api/manager/chat', wrap(async req => ({ reply: await manager.chat(req.body.messages || []) })));

// ---- idea backlog ----
app.get('/api/ideas', wrap(req => all('SELECT * FROM ideas WHERE channel_id = ? ORDER BY status, id DESC', req.query.channel).map(i => parse(i, 'tags'))));
app.post('/api/ideas', wrap(req => ({ id: Number(run('INSERT INTO ideas(channel_id, title, notes, tags) VALUES(?, ?, ?, ?)', req.body.channel_id, req.body.title, req.body.notes || '', JSON.stringify(req.body.tags || [])).lastInsertRowid) })));
app.put('/api/ideas/:id', wrap(req => { run('UPDATE ideas SET title = ?, notes = ?, tags = ?, status = ? WHERE id = ?', req.body.title, req.body.notes || '', JSON.stringify(req.body.tags || []), req.body.status || 'idea', req.params.id); return { ok: true }; }));
app.delete('/api/ideas/:id', wrap(req => { run('DELETE FROM ideas WHERE id = ?', req.params.id); return { ok: true }; }));

// ---- settings (secrets are write-only from the UI) ----
const SETTING_KEYS = ['google_client_id', 'google_client_secret', 'youtube_privacy', 'public_media_url', 'instagram_graph_host', 'instagram_api_version', 'anthropic_api_key'];
app.get('/api/settings', wrap(() => ({
  ...Object.fromEntries(SETTING_KEYS.map(k => [k, SECRET_KEYS.includes(k) ? (setting(k) ? '••••••••' : '') : setting(k)])),
  redirect_uri: `${BASE}/oauth/youtube/callback`,
})));
app.put('/api/settings', wrap(req => {
  for (const k of SETTING_KEYS) if (k in req.body && req.body[k] !== '••••••••') setSetting(k, String(req.body[k]).trim());
  return { ok: true };
}));

const server = app.listen(PORT, '127.0.0.1', () => {
  console.log(`Social Manager running at ${BASE}`);
  publish.start(BASE);
});
server.requestTimeout = 0;
server.headersTimeout = 0;
