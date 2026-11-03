// Publishing: a once-a-minute scheduler that posts due videos through connected
// accounts. Anything it can't post automatically becomes "manual_due" so the
// dashboard shows it as a to-do with the caption ready to copy.
const { all, get, run, setting, log } = require('./db');
const { localStamp } = require('./planner');
const youtube = require('./youtube');
const instagram = require('./instagram');

let busy = false;

async function publishPost(postId, baseUrl) {
  const post = get('SELECT * FROM posts WHERE id = ?', postId);
  if (!post) throw new Error('Post not found.');
  if (post.status === 'posted' || post.is_demo) return { status: post.status, url: post.url };
  const video = get('SELECT * FROM videos WHERE id = ?', post.video_id);
  const account = get("SELECT * FROM accounts WHERE channel_id = ? AND platform = ? AND status = 'connected'", post.channel_id, post.platform);
  if (!account) {
    run("UPDATE posts SET status = 'manual_due', error = ? WHERE id = ?", `No connected ${post.platform} account — post it yourself, then mark it posted.`, postId);
    return { status: 'manual_due' };
  }
  run("UPDATE posts SET status = 'publishing', error = '' WHERE id = ?", postId);
  try {
    const r = post.platform === 'youtube'
      ? await youtube.upload(account, video, baseUrl)
      : await instagram.publishReel(account, video, setting('public_media_url').replace(/\/$/, ''));
    run("UPDATE posts SET status = 'posted', external_id = ?, url = ?, posted_at = ?, error = '' WHERE id = ?", r.external_id, r.url, localStamp(new Date()), postId);
    log(post.channel_id, `Posted "${video.title}" to ${post.platform}`);
    return { status: 'posted', url: r.url };
  } catch (e) {
    run("UPDATE posts SET status = 'failed', error = ? WHERE id = ?", e.message, postId);
    log(post.channel_id, `Failed to post "${video.title}" to ${post.platform}: ${e.message}`);
    return { status: 'failed', error: e.message };
  }
}

async function tick(baseUrl) {
  if (busy) return;
  busy = true;
  try {
    const due = all("SELECT id FROM posts WHERE status = 'planned' AND scheduled_at <= ? AND is_demo = 0 ORDER BY scheduled_at", localStamp(new Date()));
    for (const p of due) await publishPost(p.id, baseUrl);
  } finally { busy = false; }
}

function start(baseUrl) {
  tick(baseUrl);
  return setInterval(() => tick(baseUrl), 60 * 1000);
}

module.exports = { start, tick, publishPost };
