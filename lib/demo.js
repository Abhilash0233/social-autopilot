// Sample history for trying the dashboards before any account is connected.
// Everything it creates is flagged is_demo = 1 and is removed by clearDemo().
// The numbers have patterns baked in (emotional stories and evening posts do
// better, etc.) so the insights engine has something real to find.
const { get, run, log } = require('./db');
const { localStamp, dateOnly, weekStart, addDays } = require('./planner');
const { saveMetrics, saveFollowers } = require('./analytics');

const PAST = [
  ['भीष्म प्रतिज्ञा · Bhishma\'s Vow', ['bhishma', 'sacrifice', 'emotional'], 95, 'Would you give up a throne for your father?'],
  ['लाक्षागृह · The House of Lac', ['pandavas', 'duryodhana', 'trickery'], 110, 'A palace built to burn...'],
  ['द्रौपदी स्वयंवर · Draupadi\'s Swayamvara', ['draupadi', 'arjuna', 'archery'], 88, 'One arrow. One fish. One chance.'],
  ['द्यूत क्रीड़ा · The Game of Dice', ['shakuni', 'duryodhana', 'trickery'], 102, 'How did a game of dice start a war?'],
  ['चीरहरण · Krishna Saves Draupadi', ['draupadi', 'krishna', 'emotional'], 84, 'When no one stood up, who did?'],
  ['अभिमन्यु · Abhimanyu in the Chakravyuha', ['abhimanyu', 'war', 'emotional'], 118, 'He knew how to enter. Not how to leave.'],
  ['बर्बरीक · Barbarik\'s Sacrifice', ['barbarik', 'krishna', 'sacrifice'], 92, 'Three arrows to end the war?'],
  ['गीता उपदेश · The Bhagavad Gita', ['krishna', 'arjuna', 'wisdom'], 140, 'Krishna\'s answer to every doubt.'],
  ['शकुंतला · Shakuntala and Dushyanta', ['shakuntala', 'romance', 'wisdom'], 125, 'A ring, a curse, a forgotten love.'],
  ['घटोत्कच · Ghatotkacha\'s Last Night', ['ghatotkacha', 'bhima', 'war'], 99, 'The son who saved Arjuna.'],
  ['कर्ण का दान · Karna\'s Armour', ['karna', 'indra', 'emotional'], 86, 'He gave away his own armour. Why?'],
  ['विदुर नीति · Vidura\'s Wisdom', ['vidura', 'wisdom'], 150, 'Ancient advice that still works.'],
  ['शिखंडी · The Story of Shikhandi', ['shikhandi', 'bhishma', 'war'], 105, 'The warrior Bhishma would not fight.'],
  ['जरासंध वध · Bhima and Jarasandha', ['bhima', 'krishna', 'war'], 97, 'Split in two... and joined again?'],
  ['उत्तरा · Uttara\'s Courage', ['uttara', 'arjuna', 'wisdom'], 132, 'A prince who ran from battle.'],
  ['एकलव्य · The Forest Archer', ['ekalavya', 'drona', 'emotional'], 91, 'The student who was never taught.'],
];

function rng(seed) { return () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296); }

function loadDemo(channelId) {
  clearDemo(channelId);
  const r = rng(channelId * 7919);
  const thisMon = weekStart();
  try {
    let followers = { youtube: 1180, instagram: 2050 };
    const weeklyViews = {};
    PAST.forEach(([title, tags, duration, hook], i) => {
      const caption = `${hook}\n\n${title}\n\n${tags.map(t => '#' + t).join(' ')} #mahabharata`;
      const v = Number(run(`INSERT INTO videos(channel_id, title, file_path, caption, description, tags, duration, status, is_demo)
                            VALUES(?, ?, ?, ?, ?, ?, ?, 'archived', 1)`, channelId, title, `demo:${i}`, caption, caption, JSON.stringify([...tags, 'mahabharata']), duration).lastInsertRowid);
      // two posts a week, oldest first, over the last 8 weeks
      const week = Math.floor(i / 2), mon = addDays(thisMon, -7 * (8 - week));
      for (const platform of ['youtube', 'instagram']) {
        const day = i % 2 ? (platform === 'youtube' ? 6 : 5) : (platform === 'youtube' ? 2 : 1);   // Wed/Sun on YT, Tue/Sat on IG
        const hour = (i + (platform === 'instagram' ? 1 : 0)) % 3 === 0 ? 9 : 19;
        const at = addDays(mon, day); at.setHours(hour, 0, 0, 0);
        if (at > new Date()) continue;
        // the hidden "truth" the insights should recover
        let f = 1;
        if (tags.includes('emotional')) f *= 1.6;
        if (tags.includes('war')) f *= 1.25;
        if (tags.includes('wisdom')) f *= 0.72;
        if (tags.includes('trickery')) f *= 1.15;
        if (hour === 19) f *= 1.35;
        if (day >= 5) f *= 1.15;
        if (platform === 'instagram' && duration > 110) f *= 0.7;
        const question = hook.endsWith('?');
        f *= 0.8 + 0.4 * r();
        const base = platform === 'youtube' ? 900 : 1600;
        const growth = 1 + 0.06 * week;                       // the channel is slowly growing
        const total = Math.round(base * f * growth);
        const er = (platform === 'instagram' ? 0.075 : 0.045) * (question ? 1.25 : 1) * (0.85 + 0.3 * r());
        const p = Number(run(`INSERT INTO posts(video_id, channel_id, platform, scheduled_at, status, external_id, posted_at, is_demo)
                              VALUES(?, ?, ?, ?, 'posted', ?, ?, 1)`, v, channelId, platform, localStamp(at), `demo-${platform}-${i}`, localStamp(at)).lastInsertRowid);
        for (let d = 0; ; d++) {
          const day0 = addDays(at, d);
          if (day0 > new Date()) break;
          const k = 1 - Math.exp(-(d + 1) / 2.2);             // most views arrive in the first few days
          const views = Math.round(total * k);
          const eng = Math.round(views * er);
          saveMetrics(p, {
            views, likes: Math.round(eng * 0.72), comments: Math.round(eng * 0.08), shares: Math.round(eng * 0.12), saves: Math.round(eng * 0.08),
            avg_view_pct: Math.round((platform === 'instagram' ? 62 : 48) * (tags.includes('emotional') ? 1.12 : 1) * (duration > 120 ? 0.85 : 1)),
          }, dateOnly(day0), 1);
          const wk = dateOnly(weekStart(day0));
          weeklyViews[wk] = weeklyViews[wk] || { youtube: 0, instagram: 0 };
          weeklyViews[wk][platform] += (d === 0 ? views : views - Math.round(total * (1 - Math.exp(-d / 2.2))));
        }
      }
    });
    // followers: a little every day, more in weeks with more views
    for (let d = 56; d >= 0; d--) {
      const day = addDays(new Date(), -d), wk = dateOnly(weekStart(day)), wv = weeklyViews[wk] || { youtube: 0, instagram: 0 };
      followers.youtube += Math.round(2 + wv.youtube / 7 * 0.012 + r() * 3);
      followers.instagram += Math.round(3 + wv.instagram / 7 * 0.018 + r() * 4);
      saveFollowers(channelId, 'youtube', followers.youtube, dateOnly(day), 1);
      saveFollowers(channelId, 'instagram', followers.instagram, dateOnly(day), 1);
    }
  } catch (e) {
    clearDemo(channelId);
    throw e;
  }
  log(channelId, 'Loaded sample analytics (demo data)');
}

function clearDemo(channelId) {
  const where = channelId ? 'AND channel_id = ?' : '';
  const a = channelId ? [channelId] : [];
  run(`DELETE FROM metrics WHERE is_demo = 1 AND post_id IN (SELECT id FROM posts WHERE 1 ${where})`, ...a);
  run(`DELETE FROM posts WHERE is_demo = 1 ${where}`, ...a);
  run(`DELETE FROM videos WHERE is_demo = 1 ${where}`, ...a);
  run(`DELETE FROM channel_stats WHERE is_demo = 1 ${where}`, ...a);
}

const hasDemo = channelId => !!get('SELECT 1 FROM posts WHERE is_demo = 1 AND channel_id = ? LIMIT 1', channelId);

module.exports = { loadDemo, clearDemo, hasDemo };
