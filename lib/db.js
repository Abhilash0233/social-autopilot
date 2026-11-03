// Supabase storage for the local server. Video files stay on disk; rows live in Postgres.
const fs = require('fs');
const path = require('path');
const os = require('os');
const { spawnSync } = require('child_process');
const { Worker } = require('worker_threads');

const ON_SERVERLESS = !!(process.env.NETLIFY || process.env.VERCEL || process.env.AWS_LAMBDA_FUNCTION_NAME);
const DATA_DIR = ON_SERVERLESS ? path.join(os.tmpdir(), 'social-manager-data') : path.join(__dirname, '..', 'data');
fs.mkdirSync(DATA_DIR, { recursive: true });

function loadEnv() {
  const file = path.join(__dirname, '..', '.env');
  if (!fs.existsSync(file)) return;
  for (const line of fs.readFileSync(file, 'utf8').split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const i = trimmed.indexOf('=');
    if (i < 1) continue;
    const key = trimmed.slice(0, i).trim();
    if (!process.env[key]) process.env[key] = trimmed.slice(i + 1).trim();
  }
}
loadEnv();

if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SECRET_KEY) {
  throw new Error('Supabase is not configured. Add SUPABASE_URL and SUPABASE_SECRET_KEY to .env.');
}

function resolveLibFile(name) {
  const candidates = [
    path.join(__dirname, name),
    path.join(__dirname, '..', 'lib', name),
    path.join(__dirname, '..', '..', 'lib', name),
    path.join(process.cwd(), 'lib', name),
    path.join(process.cwd(), 'src', 'lib', name),
  ];
  for (const p of candidates) if (fs.existsSync(p)) return p;
  throw new Error(`${name} not found (looked in ${candidates.join(', ')})`);
}

let worker, header, bytes;
if (!ON_SERVERLESS) {
  const BUF = 8 * 1024 * 1024;
  const sab = new SharedArrayBuffer(BUF);
  header = new Int32Array(sab, 0, 2);
  bytes = new Uint8Array(sab);
  worker = new Worker(resolveLibFile('supabase-worker.js'), { workerData: { sab } });
  worker.unref();
}

const NUMERIC = new Set(['id', 'n', 'ready', 'drafts', 'posted', 'views', 'likes', 'comments', 'shares', 'saves', 'followers', 'weekly_goal', 'channel_id', 'video_id', 'post_id', 'duration', 'avg_view_pct', 'is_demo', 'engagements']);

function literal(value) {
  if (value === null || value === undefined) return 'NULL';
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw new Error('Invalid number in query');
    return String(value);
  }
  if (typeof value === 'boolean') return value ? 'TRUE' : 'FALSE';
  return `'${String(value).replace(/'/g, "''")}'`;
}

function bind(sql, params) {
  let i = 0;
  const text = sql.replace(/\?/g, () => {
    if (i >= params.length) throw new Error('Missing SQL parameter');
    return literal(params[i++]);
  });
  if (i !== params.length) throw new Error('Unused SQL parameter');
  return text.trim();
}

function prepare(sql, params) {
  let text = bind(sql, params);
  if (/^insert\s+into\s+(channels|accounts|videos|posts|ideas|activity)\b/i.test(text) && !/\breturning\b/i.test(text)) {
    text += ' returning id';
  }
  return text;
}

function revive(row) {
  if (!row || typeof row !== 'object') return row;
  const out = {};
  for (const [key, value] of Object.entries(row)) {
    if (typeof value === 'string' && NUMERIC.has(key) && /^-?\d+(\.\d+)?$/.test(value)) out[key] = Number(value);
    else out[key] = value;
  }
  return out;
}

function callServerless(statement) {
  const script = resolveLibFile('supabase-sync.js');
  const r = spawnSync(process.execPath, [script, statement], {
    encoding: 'utf8',
    env: process.env,
    maxBuffer: 8 * 1024 * 1024,
    timeout: 30000,
  });
  if (r.error) throw r.error;
  if (r.status !== 0) throw new Error((r.stderr || r.stdout || 'Database request failed').toString().trim());
  const data = JSON.parse(r.stdout || '[]');
  return Array.isArray(data) ? data.map(revive) : [];
}

function callWorker(statement) {
  Atomics.store(header, 0, 0);
  Atomics.store(header, 1, 0);
  worker.postMessage(statement);
  const wake = Atomics.wait(header, 0, 0, 30000);
  const status = Atomics.load(header, 0);
  if (status === 0) throw new Error(wake === 'timed-out' ? 'Database request timed out' : 'Database request failed');
  const len = Atomics.load(header, 1);
  const text = Buffer.from(bytes.subarray(8, 8 + len)).toString('utf8');
  if (status !== 1) throw new Error(text);
  const data = JSON.parse(text);
  return Array.isArray(data) ? data.map(revive) : [];
}

const call = statement => (ON_SERVERLESS ? callServerless(statement) : callWorker(statement));

const writeListeners = new Set();
function onWrite(fn) { writeListeners.add(fn); }

const all = (sql, ...params) => call(prepare(sql, params));
const get = (sql, ...params) => all(sql, ...params)[0];
const run = (sql, ...params) => {
  const rows = all(sql, ...params);
  if (/^\s*(insert|update|delete)\b/i.test(sql)) for (const fn of writeListeners) fn();
  return { lastInsertRowid: rows[0] && rows[0].id, changes: rows.length };
};

function setting(key, fallback = '') {
  const row = get('select value from settings where key = ?', key);
  return row ? row.value : (process.env[key.toUpperCase()] || fallback);
}
function setSetting(key, value) {
  run('insert into settings(key, value) values(?, ?) on conflict(key) do update set value = excluded.value', key, value ?? '');
}
function log(channelId, message) {
  run('insert into activity(channel_id, message) values(?, ?)', channelId ?? null, message);
}

function parse(row, ...cols) {
  if (!row) return row;
  const out = { ...row };
  for (const col of cols) {
    const value = out[col];
    if (value && typeof value === 'object') continue;
    try { out[col] = JSON.parse(value || 'null'); } catch { out[col] = null; }
  }
  return out;
}

// Kept so older call sites can mark a transaction. Each statement is saved on its own.
const db = { exec() {} };

module.exports = { db, all, get, run, setting, setSetting, log, parse, onWrite, DATA_DIR };
