# Social Manager

A local app that runs your YouTube and Instagram channels like a social media manager:
weekly posting plans filled from your finished videos, automatic publishing, analytics,
week-over-week growth, and a report on what's working and what to make next.

```bash
cd social-manager
npm install
npm start            # → http://localhost:4173
```

It runs only on this computer (bound to 127.0.0.1). Data lives in `data/social.db`.

## Pages

| Page | What it does |
|---|---|
| Dashboard | Every channel's growth this week vs the same days last week, the posting pipeline, top advice, posts that need you |
| Weekly planner | 7-day calendar. **Auto-plan** fills each channel's posting slots with ready videos; drag posts between days; drag new videos in from the tray |
| Video library | Videos imported from each channel's folder, with covers, thumbnails and captions picked up automatically |
| Analytics | Followers and weekly views charts, every post's numbers. Sync from the platforms, import a CSV, or load sample data |
| Insights & manager | The weekly report (what's working, what's not, what to do next), best and weakest posts, the idea backlog, and a chat with Claude that sees all your data |
| Channels & accounts | Add channels, set posting slots and weekly goals, connect YouTube and Instagram |
| Settings | API credentials and setup steps |

## Connecting accounts

- **YouTube:** create a Google Cloud OAuth client (Web application) with redirect URI
  `http://localhost:4173/oauth/youtube/callback`, enable YouTube Data API v3 and YouTube Analytics API,
  paste the client ID/secret in Settings, then **Connect YouTube** on the channel.
- **Instagram (professional account):** generate a token in Meta's App Dashboard (Instagram → API setup
  with Instagram login) and paste it on the channel. Auto-posting Reels also needs **Public media URL**
  in Settings (e.g. `cloudflared tunnel --url http://localhost:4173`), because Instagram downloads the
  video itself. Without it, Instagram posts wait as "Post manually" with the caption ready to copy.
- **AI manager chat:** add an Anthropic API key in Settings. Everything else works without it.

Anything due without a connected account becomes a **Needs you** item on the Dashboard:
copy the caption, download the video, post it, then mark it posted.

## Video folder conventions

Point a channel at a folder of finished videos. On import it picks up, by file name:
`thumbnails/<name>_cover_9x16.png` (Reels cover), `thumbnails/<name>_youtube.jpg` (YouTube thumbnail),
and a caption from any Markdown file nearby whose `## heading` mentions the video file and is followed by
a fenced code block. Videos with a caption and a cover are marked **ready**; others are **drafts**.

`node scripts/seed-mahabharata.js` sets up the Mahabharata Reels channel from `../out`.

## How "what's working" is worked out

Each post is scored by its first-7-days views as a multiple of the median post on the same platform,
then grouped by topic tag (hashtags), time of day, weekday, video length, and caption hook (question
or statement). Differences of about ±18% or more, seen on at least two posts, are reported.
Ideas in the backlog are ranked by how many of the winning topics they share.
