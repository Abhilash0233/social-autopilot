// Weekly planning: fill each channel's posting slots with ready videos.
// Times are local wall-clock strings 'YYYY-MM-DDTHH:MM' so the calendar matches
// what the user sees on their clock.
const { run, parse, log } = require('./db');
const { channelData } = require('./channel-data');

const pad = n => String(n).padStart(2, '0');
const localStamp = d => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
const dateOnly = d => localStamp(d).slice(0, 10);

function weekStart(date = new Date()) {         // Monday 00:00 local
  const d = new Date(date); d.setHours(0, 0, 0, 0);
  d.setDate(d.getDate() - ((d.getDay() + 6) % 7));
  return d;
}
function addDays(d, n) { const x = new Date(d); x.setDate(x.getDate() + n); return x; }

// The slot times for a channel in the week starting `monday`.
function slotsFor(channel, monday) {
  const schedule = parse(channel, 'schedule').schedule || [];
  return schedule.map(s => {
    const d = addDays(monday, s.day); const [h, m] = (s.time || '18:00').split(':').map(Number);
    d.setHours(h, m || 0, 0, 0);
    return { platform: s.platform, at: localStamp(d) };
  }).sort((a, b) => a.at.localeCompare(b.at));
}

// Videos not yet posted or planned on this platform, oldest first.
function nextVideos(channelId, platform) {
  const data = channelData(channelId);
  const used = new Set(data.posts.filter(p => p.platform === platform).map(p => p.video_id));
  return data.videos
    .filter(v => v.status === 'ready' && !used.has(v.id))
    .sort((a, b) => (a.created_at || '').localeCompare(b.created_at || '') || a.id - b.id)
    .map(v => ({ ...v }));
}

function autoPlan(channelId, monday) {
  const channel = channelData(channelId).channel;
  const now = localStamp(new Date());
  const created = [], unfilled = [];
  const queues = {};
  for (const slot of slotsFor(channel, monday)) {
    if (slot.at < now) continue;                          // never plan into the past
    const taken = channelData(channelId).posts.some(p => p.platform === slot.platform && p.scheduled_at === slot.at);
    if (taken) continue;
    queues[slot.platform] = queues[slot.platform] || nextVideos(channelId, slot.platform);
    const v = queues[slot.platform].shift();
    if (!v) { unfilled.push(slot); continue; }
    const r = run('INSERT INTO posts(video_id, channel_id, platform, scheduled_at) VALUES(?, ?, ?, ?)', v.id, channelId, slot.platform, slot.at);
    created.push({ id: Number(r.lastInsertRowid), video: v.title, ...slot });
  }
  if (created.length) log(channelId, `Auto-planned ${created.length} post(s) for week of ${dateOnly(monday)}`);
  return { created, unfilled };
}

// How prepared is a channel for a given week: slots vs. planned vs. videos in stock.
function readiness(channelId, monday) {
  const data = channelData(channelId);
  const channel = data.channel;
  const slots = slotsFor(channel, monday);
  const end = localStamp(addDays(monday, 7));
  const start = localStamp(monday);
  const weekPosts = data.posts.filter(p => p.scheduled_at >= start && p.scheduled_at < end);
  const planned = weekPosts.length;
  const now = localStamp(new Date());
  const stock = {}, open = {};
  let shortfall = 0;
  for (const p of [...new Set(slots.map(s => s.platform))]) {
    stock[p] = nextVideos(channelId, p).length;
    const used = weekPosts.filter(row => row.platform === p).length;
    open[p] = Math.max(0, slots.filter(s => s.platform === p && s.at >= now).length - used);
    shortfall = Math.max(shortfall, open[p] - stock[p]);       // one video can fill a slot on every platform
  }
  return { slots: slots.length, planned, stock, open, shortfall, due: slots.filter(s => s.at <= now).length };
}

module.exports = { autoPlan, readiness, weekStart, addDays, localStamp, dateOnly, slotsFor, nextVideos };
