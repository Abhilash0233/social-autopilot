// "Ask your social manager": a chat with Claude that knows the channels, the
// numbers, the weekly report, the plan and the idea backlog.
const Anthropic = require('@anthropic-ai/sdk');
const { all, get, parse, setting } = require('./db');
const { analyse } = require('./insights');
const { weekStart, addDays, localStamp } = require('./planner');

const SYSTEM = `You are a sharp, practical social media manager for a creator who runs several channels on YouTube and Instagram.
You have the creator's live data below: their channels, weekly growth, an automatic performance analysis, the posting plan and their idea backlog.

How to help:
- Ground every claim in the data provided. Quote the actual numbers. If the data can't answer something, say what's missing and how to get it (connect accounts, sync, import CSV).
- Be concrete and prioritised: give the 1-3 things that will move growth most, with the reason from their numbers.
- When suggesting content, propose specific titles, hooks (the first line of the caption), and which platform/day/time to post.
- If the data includes sample/demo numbers, remind them it's sample data before drawing conclusions.
- Keep answers short and skimmable: short paragraphs or a brief list. Write in the language the creator writes in (English, Hindi or Hinglish).`;

function context() {
  const channels = all('SELECT * FROM channels ORDER BY id').map(c => parse(c, 'schedule'));
  const from = localStamp(weekStart()), to = localStamp(addDays(weekStart(), 14));
  return channels.map(c => ({
    channel: { name: c.name, niche: c.niche, weekly_goal: c.weekly_goal, schedule: c.schedule },
    accounts: all('SELECT platform, handle, status FROM accounts WHERE channel_id = ?', c.id),
    report: analyse(c.id),
    plan_next_two_weeks: all(`SELECT p.platform, p.scheduled_at, p.status, v.title FROM posts p JOIN videos v ON v.id = p.video_id
                              WHERE p.channel_id = ? AND p.scheduled_at >= ? AND p.scheduled_at < ? ORDER BY p.scheduled_at`, c.id, from, to),
    videos_ready_unposted: all(`SELECT title FROM videos v WHERE channel_id = ? AND status = 'ready' AND NOT EXISTS (SELECT 1 FROM posts p WHERE p.video_id = v.id)`, c.id).map(v => v.title),
    idea_backlog: all("SELECT title, notes, tags, status FROM ideas WHERE channel_id = ? AND status != 'done'", c.id),
  }));
}

async function chat(messages) {
  const key = setting('anthropic_api_key');
  if (!key && !process.env.ANTHROPIC_API_KEY && !process.env.ANTHROPIC_AUTH_TOKEN) throw new Error('Add an Anthropic API key in Settings to chat with your social manager.');
  const client = key ? new Anthropic({ apiKey: key }) : new Anthropic();
  const data = JSON.stringify({ today: localStamp(new Date()), channels: context() });
  const final = await client.beta.messages.stream({
    model: 'claude-opus-5-5',
    max_tokens: 16000,
    output_config: { effort: 'medium' },
    betas: ['server-side-fallback-2026-07-01'],
    fallbacks: 'default',
    system: [{ type: 'text', text: SYSTEM }, { type: 'text', text: `<creator_data>\n${data}\n</creator_data>` }],
    messages: messages.map(m => ({ role: m.role === 'assistant' ? 'assistant' : 'user', content: String(m.content) })),
  }).finalMessage();
  if (final.stop_reason === 'refusal') return 'I can’t help with that request. Try asking about your channels, content or growth.';
  return final.content.filter(b => b.type === 'text').map(b => b.text).join('\n').trim();
}

module.exports = { chat };
