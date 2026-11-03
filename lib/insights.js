// The "social manager" brain: reads a channel's numbers and writes the weekly report —
// how it grew, what's working, what isn't, and what to do next.
//
// Posts are compared fairly by their first-7-day views, as a multiple of the median
// post on the same platform (a "performance index": 1.0 = typical, 1.5 = 50% better).
const { parse } = require('./db');
const { channelData } = require('./channel-data');
const { weeklyGrowth, totalsAt, preload } = require('./analytics');
const { dateOnly, addDays, weekStart, readiness, localStamp } = require('./planner');
const planner = require('./planner');
const { hasDemo } = require('./demo');

const DAYS = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];
const median = a => { const s = [...a].sort((x, y) => x - y); return s.length ? (s.length % 2 ? s[(s.length - 1) / 2] : (s[s.length / 2 - 1] + s[s.length / 2]) / 2) : 0; };
const mean = a => a.reduce((s, x) => s + x, 0) / (a.length || 1);
const pctText = x => `${x >= 1 ? '+' : '−'}${Math.round(Math.abs(x - 1) * 100)}%`;
const slot = h => (h < 12 ? 'morning' : h < 17 ? 'afternoon' : 'evening');

function postsWithPerformance(channelId) {
  preload(channelId);
  const now = new Date();
  const rows = channelData(channelId).posts.filter(p => p.status === 'posted' && p.posted_at);
  const out = [];
  for (const r of rows) {
    const posted = new Date(r.posted_at), age = (now - posted) / 864e5;
    const d7 = totalsAt(r.id, dateOnly(addDays(posted, 7)));
    const eng = d7.likes + d7.comments + d7.shares + d7.saves;
    out.push({
      ...r, tags: JSON.parse(r.tags || '[]'), age, views7: d7.views, eng7: eng, er: d7.views ? eng / d7.views : 0, avg_view_pct: d7.avg_view_pct,
      mature: age >= 3, weekday: (posted.getDay() + 6) % 7, hour: posted.getHours(),
      question: /\?/.test((r.caption || '').split('\n')[0]),
    });
  }
  for (const pf of ['youtube', 'instagram']) {
    const set = out.filter(p => p.platform === pf && p.mature);
    const med = median(set.map(p => p.views7)) || 1, medEr = median(set.map(p => p.er)) || 1;
    for (const p of out.filter(p => p.platform === pf)) { p.index = p.views7 / med; p.erIndex = p.er / medEr; }
  }
  return out;
}

// Compare groups of posts on one dimension; keep only differences big and backed enough to act on.
function compare(posts, keyOf, label, metric = 'index') {
  const groups = {};
  for (const p of posts) for (const k of [].concat(keyOf(p) ?? [])) (groups[k] = groups[k] || []).push(p[metric]);
  return Object.entries(groups)
    .filter(([, v]) => v.length >= 2 && v.length < posts.length)
    .map(([k, v]) => ({ dimension: label, key: k, n: v.length, effect: mean(v), metric }));
}

function analyse(channelId) {
  const channel = parse(channelData(channelId).channel, 'schedule');
  const posts = postsWithPerformance(channelId);
  const mature = posts.filter(p => p.mature);
  const growth = weeklyGrowth(channelId);
  const report = { channel: channel.name, generatedAt: localStamp(new Date()), sample: mature.length, demo: hasDemo(channelId), growth, working: [], notWorking: [], next: [], topPosts: [], bottomPosts: [], summary: [] };

  // ---- growth story ----
  for (const [pf, g] of Object.entries(growth)) {
    const name = pf === 'youtube' ? 'YouTube' : 'Instagram';
    const parts = [];
    if (g.followers_gained != null) parts.push(`${g.followers_gained >= 0 ? '+' : ''}${g.followers_gained} ${pf === 'youtube' ? 'subscribers' : 'followers'}${g.followers_gained_prev != null ? ` (last week ${g.followers_gained_prev >= 0 ? '+' : ''}${g.followers_gained_prev})` : ''}`);
    parts.push(`${g.views.toLocaleString('en-IN')} views${g.views_change_pct != null ? ` (${g.views_change_pct >= 0 ? '+' : ''}${g.views_change_pct}% vs last week)` : ''}`);
    parts.push(`${g.published} post${g.published === 1 ? '' : 's'} published`);
    report.summary.push(`${name}: ${parts.join(', ')}.`);
  }

  // ---- what's working / not ----
  if (mature.length >= 4) {
    const common = new Set(Object.entries(mature.flatMap(p => p.tags).reduce((m, t) => (m[t] = (m[t] || 0) + 1, m), {}))
      .filter(([, n]) => n > mature.length * 0.7).map(([t]) => t));                        // tags on nearly every post tell us nothing
    const findings = [
      ...compare(mature, p => p.tags.filter(t => !common.has(t)), 'topic'),
      ...compare(mature, p => slot(p.hour), 'time'),
      ...compare(mature, p => DAYS[p.weekday], 'day'),
      ...compare(mature, p => `${p.platform}:${p.duration <= 75 ? 'short' : p.duration <= 110 ? 'medium' : 'long'}`, 'length'),
      ...compare(mature, p => (p.question ? 'question' : 'statement'), 'hook', 'erIndex'),
    ];
    const describe = f => {
      const pv = pctText(f.effect);
      if (f.dimension === 'topic') return `Stories tagged #${f.key} get ${pv} views vs your typical post (${f.n} posts).`;
      if (f.dimension === 'time') return `Posts in the ${f.key} get ${pv} views (${f.n} posts).`;
      if (f.dimension === 'day') return `${f.key} posts get ${pv} views (${f.n} posts).`;
      if (f.dimension === 'length') { const [pf, b] = f.key.split(':'); return `${b[0].toUpperCase() + b.slice(1)} videos on ${pf === 'youtube' ? 'YouTube' : 'Instagram'} (${b === 'short' ? '≤75s' : b === 'medium' ? '75–110s' : '>110s'}) get ${pv} views (${f.n} posts).`; }
      if (f.dimension === 'hook') return `Captions that open with a ${f.key} get ${pv} engagement rate (${f.n} posts).`;
      return '';
    };
    const score = f => Math.abs(Math.log(f.effect)) * Math.sqrt(f.n);
    const strong = findings.filter(f => f.effect >= 1.18 || f.effect <= 0.85).sort((a, b) => score(b) - score(a));
    // one finding per dimension+direction keeps the list readable
    const seen = new Set();
    for (const f of strong) {
      const tag = `${f.dimension}:${f.effect > 1}`;
      if (f.dimension !== 'topic' && seen.has(tag)) continue;
      seen.add(tag);
      (f.effect > 1 ? report.working : report.notWorking).push({ ...f, text: describe(f) });
    }
    report.working = report.working.slice(0, 5);
    report.notWorking = report.notWorking.slice(0, 4);
  }
  const ranked = [...mature].sort((a, b) => b.index - a.index);
  const brief = p => ({ id: p.id, title: p.title, platform: p.platform, posted_at: p.posted_at, views7: p.views7, index: Math.round(p.index * 100) / 100, er: Math.round(p.er * 1000) / 10, url: p.url });
  report.topPosts = ranked.slice(0, 3).map(brief);
  report.bottomPosts = ranked.slice(-3).reverse().map(brief);

  // ---- what to do next ----
  const next = report.next;
  const mon = addDays(weekStart(), 7), ready = readiness(channelId, mon), thisWeek = readiness(channelId, weekStart());
  if (ready.slots) {
    const open = Object.values(ready.open).reduce((s, n) => s + n, 0);
    const perPlatform = Math.max(...Object.values(ready.open), 0);
    if (ready.shortfall > 0) next.push({ priority: 'high', kind: 'pipeline', text: `Next week needs ${perPlatform} video(s) (each one goes to every platform) but only ${perPlatform - ready.shortfall} unposted video(s) are ready. Finish ${ready.shortfall} more this week.` });
    else if (open > 0) next.push({ priority: 'medium', kind: 'pipeline', text: `You have enough videos for next week. Press Auto-plan to fill its ${open} open slot(s).` });
  }
  const published = Object.values(growth).reduce((s, g) => s + g.published, 0);
  if (thisWeek.due > published) next.push({ priority: 'medium', kind: 'consistency', text: `${published} of the ${thisWeek.due} slots that have come due this week were posted. Consistency drives growth on both platforms.` });
  const due = channelData(channelId).posts.filter(p => p.status === 'manual_due' || p.status === 'failed').length;
  if (due) next.push({ priority: 'high', kind: 'action', text: `${due} post(s) need you: they're due but couldn't be posted automatically. Open the Planner.` });

  const winTopics = report.working.filter(f => f.dimension === 'topic').map(f => f.key);
  const loseTopics = report.notWorking.filter(f => f.dimension === 'topic').map(f => f.key);
  const ideas = channelData(channelId).ideas.filter(i => i.status !== 'done').map(i => ({ ...i, tags: JSON.parse(i.tags || '[]') }));
  const scored = ideas.map(i => ({ ...i, score: i.tags.filter(t => winTopics.includes(t)).length - 0.5 * i.tags.filter(t => loseTopics.includes(t)).length }))
    .sort((a, b) => b.score - a.score);
  if (scored.length) next.push({ priority: 'high', kind: 'content', text: `Make next: ${scored.slice(0, 3).map(i => `“${i.title}”`).join(', ')}${winTopics.length ? `, which match what's working (#${winTopics.slice(0, 2).join(', #')})` : ''}.`, ideas: scored.slice(0, 3).map(i => i.id) });
  else if (winTopics.length) next.push({ priority: 'high', kind: 'content', text: `Make more stories like #${winTopics.slice(0, 2).join(' and #')}. Add ideas to the backlog and I'll rank them.` });

  const timeWin = report.working.find(f => f.dimension === 'time'), dayWin = report.working.find(f => f.dimension === 'day');
  if (timeWin || dayWin) {
    const sched = channel.schedule || [];
    const offSlot = sched.filter(s => (timeWin && slot(+s.time.split(':')[0]) !== timeWin.key) || (dayWin && DAYS[s.day] !== dayWin.key)).length;
    if (offSlot) next.push({ priority: 'medium', kind: 'schedule', text: `Move more posting slots to ${dayWin ? dayWin.key + ' ' : ''}${timeWin ? timeWin.key + 's' : ''}. ${offSlot} of your ${sched.length} weekly slots are outside the best window.` });
  }
  const hook = report.working.find(f => f.dimension === 'hook' && f.key === 'question');
  if (hook) next.push({ priority: 'low', kind: 'caption', text: 'Open every caption with a question. Posts that do get noticeably more likes, comments and shares.' });
  const longIg = report.notWorking.find(f => f.dimension === 'length' && f.key.startsWith('instagram'));
  if (longIg) next.push({ priority: 'medium', kind: 'format', text: 'Cut Instagram versions shorter (under ~90 seconds). Long reels are underperforming there.' });
  if (!mature.length) next.push({ priority: 'medium', kind: 'data', text: 'No performance data yet. Connect your accounts and press Sync, or import a CSV export, so I can see what works.' });
  const openNow = Object.values(thisWeek.open || {}).reduce((s, n) => s + n, 0);
  if (openNow) next.unshift({ priority: 'high', kind: 'pipeline', text: `This week still has ${openNow} empty posting slot(s). Press Auto-plan to fill them${thisWeek.shortfall > 0 ? `, and finish ${thisWeek.shortfall} more video(s)` : ''}.` });

  const order = { high: 0, medium: 1, low: 2 };
  next.sort((a, b) => order[a.priority] - order[b.priority]);
  return report;
}

module.exports = { analyse, postsWithPerformance };
