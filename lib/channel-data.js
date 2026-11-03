// One round trip loads everything a channel screen needs. Writes drop the cache.
const { get, onWrite } = require('./db');

const cache = new Map();
onWrite(() => cache.clear());

function asArray(value) {
  if (Array.isArray(value)) return value;
  if (value == null || value === '') return [];
  if (typeof value === 'string') return JSON.parse(value);
  return [];
}

function channelData(channelId) {
  const id = Number(channelId);
  if (cache.has(id)) return cache.get(id);
  const row = get(`SELECT
    (SELECT to_jsonb(c) FROM channels c WHERE c.id = ?) AS channel,
    COALESCE((SELECT json_agg(json_build_object(
      'id', p.id, 'platform', p.platform, 'posted_at', p.posted_at, 'url', p.url,
      'status', p.status, 'scheduled_at', p.scheduled_at, 'is_demo', p.is_demo,
      'video_id', v.id, 'title', v.title, 'tags', v.tags, 'duration', v.duration, 'caption', v.caption
    )) FROM posts p JOIN videos v ON v.id = p.video_id WHERE p.channel_id = ?), '[]'::json) AS posts,
    COALESCE((SELECT json_agg(json_build_object(
      'post_id', m.post_id, 'date', m.date, 'views', m.views, 'likes', m.likes,
      'comments', m.comments, 'shares', m.shares, 'saves', m.saves, 'avg_view_pct', m.avg_view_pct
    )) FROM metrics m JOIN posts p ON p.id = m.post_id WHERE p.channel_id = ?), '[]'::json) AS metrics,
    COALESCE((SELECT json_agg(json_build_object('platform', s.platform, 'date', s.date, 'followers', s.followers))
      FROM channel_stats s WHERE s.channel_id = ?), '[]'::json) AS stats,
    COALESCE((SELECT json_agg(to_jsonb(i)) FROM ideas i WHERE i.channel_id = ?), '[]'::json) AS ideas,
    COALESCE((SELECT json_agg(json_build_object(
      'id', v.id, 'title', v.title, 'status', v.status, 'created_at', v.created_at
    )) FROM videos v WHERE v.channel_id = ?), '[]'::json) AS videos`, id, id, id, id, id, id);
  const data = {
    channel: row && row.channel,
    posts: asArray(row && row.posts),
    metrics: asArray(row && row.metrics).sort((a, b) => a.date < b.date ? -1 : a.date > b.date ? 1 : 0),
    stats: asArray(row && row.stats).sort((a, b) => a.date < b.date ? -1 : a.date > b.date ? 1 : 0),
    ideas: asArray(row && row.ideas),
    videos: asArray(row && row.videos),
  };
  cache.set(id, data);
  return data;
}

module.exports = { channelData };
