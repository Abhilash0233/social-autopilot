// One-time setup for the Mahabharata Reels channel from this project:
// creates the channel, imports the rendered reels from ../out, and fills the idea
// backlog with the next stories. Safe to run again (skips what already exists).
//   node scripts/seed-mahabharata.js
const path = require('path');
const { get, run, log } = require('../lib/db');
const library = require('../lib/library');

const NAME = 'Mahabharata Reels';
const OUT = path.resolve(__dirname, '..', '..', 'out');

let ch = get("SELECT * FROM channels WHERE name IN (?, 'Epic Tales of Bharat')", NAME);   // renamed after linking @BharatEpicStories
if (!ch) {
  // 3 posts a week, each going to both platforms: Tue, Fri, Sun evenings
  const schedule = [1, 4, 6].flatMap(day => [{ platform: 'instagram', day, time: '19:00' }, { platform: 'youtube', day, time: '19:30' }]);
  const id = Number(run('INSERT INTO channels(name, niche, color, video_dir, schedule, weekly_goal) VALUES(?, ?, ?, ?, ?, ?)',
    NAME, 'Animated Mahabharata stories in Hindi (2D cartoon & shadow puppet)', '#eb6834', OUT, JSON.stringify(schedule), 6).lastInsertRowid);
  ch = get('SELECT * FROM channels WHERE id = ?', id);
  log(id, 'Channel created: ' + NAME);
}
const r = library.importFolder(ch.id);
console.log(`Imported: ${r.added} new, ${r.updated} refreshed`);
for (const v of r.videos) console.log(`  [${v.status}] ${v.title}`);

const IDEAS = [
  ['भीष्म प्रतिज्ञा · Bhishma\'s Vow', 'Devavrata gives up the throne and marriage for his father. Ganga, Shantanu, Satyavati.', ['bhishma', 'sacrifice', 'emotional']],
  ['द्रौपदी स्वयंवर · Draupadi\'s Swayamvara', 'Arjuna strikes the fish\'s eye in disguise. Karna turned away.', ['draupadi', 'arjuna', 'archery']],
  ['अभिमन्यु · Abhimanyu in the Chakravyuha', 'The young hero who knew how to enter but not leave. Strongest emotional story of the war.', ['abhimanyu', 'war', 'emotional']],
  ['द्यूत क्रीड़ा · The Game of Dice', 'Shakuni\'s loaded dice; Yudhishthira loses everything.', ['shakuni', 'duryodhana', 'trickery']],
  ['गीता उपदेश · The Bhagavad Gita', 'Krishna and Arjuna at Kurukshetra. Short teaching reel.', ['krishna', 'arjuna', 'wisdom']],
  ['बर्बरीक · Barbarik\'s Sacrifice', 'Three arrows that could end the war; Krishna asks for his head.', ['barbarik', 'krishna', 'sacrifice']],
  ['लाक्षागृह · The House of Lac', 'Duryodhana\'s palace built to burn; Vidura\'s warning.', ['pandavas', 'duryodhana', 'trickery']],
  ['कर्ण का कवच · Karna Gives Away His Armour', 'Indra in disguise asks for his kavach-kundal.', ['karna', 'indra', 'emotional']],
];
let added = 0;
for (const [title, notes, tags] of IDEAS) {
  if (get('SELECT 1 FROM ideas WHERE channel_id = ? AND title = ?', ch.id, title)) continue;
  run('INSERT INTO ideas(channel_id, title, notes, tags) VALUES(?, ?, ?, ?)', ch.id, title, notes, JSON.stringify(tags)); added++;
}
console.log(`Idea backlog: ${added} added`);
