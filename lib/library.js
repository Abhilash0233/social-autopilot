// Video library: scan a channel's folder for finished videos and pick up their
// covers, YouTube thumbnails and captions automatically.
//
// Conventions it understands (all optional):
//   <folder>/name.mp4
//   <folder>/thumbnails/name_cover_9x16.png   (Reels cover)
//   <folder>/thumbnails/name_youtube.jpg      (YouTube thumbnail)
//   any .md file in <folder>, its parent, or <parent>/social with a "## Title — `.../name.mp4`"
//   heading followed by a ``` fenced caption block.
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const ffmpeg = require('ffmpeg-static');
const { all, get, run, log } = require('./db');

const VIDEO_EXT = /\.(mp4|mov|m4v|webm)$/i;

function probeDuration(file) {
  try {
    execFileSync(ffmpeg, ['-hide_banner', '-i', file], { stdio: ['ignore', 'ignore', 'pipe'] });
  } catch (e) {
    const m = String(e.stderr || '').match(/Duration: (\d+):(\d+):([\d.]+)/);
    if (m) return +m[1] * 3600 + +m[2] * 60 + +m[3];
  }
  return 0;
}

// Caption sections from markdown files: { 'yaksha.hi.mp4': { heading, caption } }
function findCaptions(dir) {
  const out = {};
  const candidates = [dir, path.dirname(dir), path.join(path.dirname(dir), 'social'), path.join(dir, 'social')];
  for (const d of candidates) {
    if (!fs.existsSync(d) || !fs.statSync(d).isDirectory()) continue;
    for (const f of fs.readdirSync(d).filter(n => n.endsWith('.md'))) {
      const text = fs.readFileSync(path.join(d, f), 'utf8');
      const sections = text.split(/\n(?=##\s)/);
      for (const sec of sections) {
        const head = sec.split('\n')[0];
        const file = (head.match(/`[^`]*?([^/`]+\.(?:mp4|mov|m4v|webm))`/i) || [])[1];
        const block = sec.match(/```[^\n]*\n([\s\S]*?)```/);
        if (file && block) out[file] = { heading: head.replace(/^##\s*/, ''), caption: block[1].trim() };
      }
    }
  }
  return out;
}

function findImage(dir, key, words) {
  for (const d of [path.join(dir, 'thumbnails'), dir]) {
    if (!fs.existsSync(d)) continue;
    const hits = fs.readdirSync(d).filter(n => n.toLowerCase().startsWith(key.toLowerCase()) && /\.(png|jpe?g)$/i.test(n) && words.some(w => n.toLowerCase().includes(w)));
    hits.sort((a, b) => (/\.jpe?g$/i.test(b) ? 1 : 0) - (/\.jpe?g$/i.test(a) ? 1 : 0));   // prefer JPEG (smaller uploads)
    if (hits.length) return path.join(d, hits[0]);
  }
  return '';
}

function titleFrom(heading, file) {
  if (heading) {
    return heading.replace(/^\d+\.\s*/, '').replace(/\s*[—-]\s*`.*$/, '').trim();
  }
  return path.basename(file).replace(VIDEO_EXT, '').replace(/[._-]+/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
}

const hashtags = text => [...new Set((text.match(/#[\p{L}\p{N}_]+/gu) || []).map(t => t.slice(1).toLowerCase()))];

function importFolder(channelId) {
  const ch = get('SELECT * FROM channels WHERE id = ?', channelId);
  if (!ch || !ch.video_dir) throw new Error('Set a video folder for this channel first.');
  const dir = ch.video_dir;
  if (!fs.existsSync(dir)) throw new Error(`Folder not found: ${dir}`);
  const captions = findCaptions(dir);
  const result = { added: 0, updated: 0, videos: [] };
  for (const name of fs.readdirSync(dir).filter(n => VIDEO_EXT.test(n)).sort()) {
    const file = path.join(dir, name), key = name.split('.')[0];
    const cap = captions[name] || null;
    const caption = cap ? cap.caption : '';
    const cover = findImage(dir, key, ['cover', '9x16', 'reel', 'vertical']);
    const portrait = findImage(dir, key, ['portrait', '4x5']);
    const thumb = findImage(dir, key, ['youtube', '16x9', 'thumb']);
    const ready = caption && (cover || portrait || thumb);
    const existing = get('SELECT * FROM videos WHERE channel_id = ? AND file_path = ?', channelId, file);
    const fields = {
      title: titleFrom(cap && cap.heading, name), caption, description: caption,
      tags: JSON.stringify(hashtags(caption)), cover_path: cover, thumb_path: thumb,
    };
    if (existing) {
      // refresh what the folder provides, but never overwrite the user's own edits with blanks
      run(`UPDATE videos SET caption = CASE WHEN caption = '' THEN ? ELSE caption END,
             description = CASE WHEN description = '' THEN ? ELSE description END,
             tags = CASE WHEN tags = '[]' THEN ? ELSE tags END,
             cover_path = CASE WHEN ? != '' THEN ? ELSE cover_path END,
             portrait_path = CASE WHEN ? != '' THEN ? ELSE portrait_path END,
             thumb_path = CASE WHEN ? != '' THEN ? ELSE thumb_path END WHERE id = ?`,
      fields.caption, fields.description, fields.tags, cover, cover, portrait, portrait, thumb, thumb, existing.id);
      result.updated++;
    } else {
      run(`INSERT INTO videos(channel_id, title, file_path, cover_path, portrait_path, thumb_path, caption, description, tags, duration, status)
           VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      channelId, fields.title, file, cover, portrait, thumb, caption, caption, fields.tags, probeDuration(file), ready ? 'ready' : 'draft');
      result.added++;
    }
  }
  result.videos = all('SELECT id, title, status FROM videos WHERE channel_id = ? ORDER BY id', channelId);
  log(channelId, `Imported folder: ${result.added} new, ${result.updated} refreshed`);
  return result;
}

module.exports = { importFolder, hashtags, probeDuration };
