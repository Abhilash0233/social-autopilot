// Video files live in a private Supabase Storage bucket. Covers can still be local files.
const fs = require('fs');
const os = require('os');
const path = require('path');
const { Readable } = require('stream');
const { pipeline } = require('stream/promises');
const { Upload } = require('tus-js-client');
const { createClient } = require('@supabase/supabase-js');

const BUCKET = 'videos';
const PREFIX = `sb://${BUCKET}/`;
const MAX_BYTES = 400 * 1024 * 1024;
const projectRef = () => new URL(process.env.SUPABASE_URL).hostname.split('.')[0];

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SECRET_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});

const isStored = filePath => typeof filePath === 'string' && filePath.startsWith(PREFIX);
const objectPath = filePath => filePath.slice(PREFIX.length);
const refFor = objectName => `${PREFIX}${objectName}`;

function objectName(filename) {
  const base = path.basename(filename).replace(/[^\w.-]/g, '_').slice(-80) || 'video.mp4';
  return `v/${Date.now()}-${base}`;
}

function contentType(filename, mime) {
  if (mime && mime.startsWith('video/')) return mime;
  const ext = path.extname(filename).toLowerCase();
  if (ext === '.webm') return 'video/webm';
  if (ext === '.mov') return 'video/quicktime';
  if (ext === '.m4v') return 'video/x-m4v';
  return 'video/mp4';
}

function upload(localPath, name, type) {
  const size = fs.statSync(localPath).size;
  if (size > MAX_BYTES) throw new Error('Videos must be 400 MB or smaller.');
  const headers = {
    authorization: `Bearer ${process.env.SUPABASE_SECRET_KEY}`,
    apikey: process.env.SUPABASE_SECRET_KEY,
    'x-upsert': 'true',
  };
  return new Promise((resolve, reject) => {
    const attempt = new Upload(fs.createReadStream(localPath), {
      endpoint: `https://${projectRef()}.storage.supabase.co/storage/v1/upload/resumable`,
      retryDelays: [0, 3000, 5000, 10000, 20000],
      headers,
      uploadDataDuringCreation: true,
      removeFingerprintOnSuccess: true,
      uploadSize: size,
      chunkSize: 6 * 1024 * 1024,
      metadata: { bucketName: BUCKET, objectName: name, contentType: type, cacheControl: '3600' },
      onError: reject,
      onSuccess: () => resolve(refFor(name)),
    });
    attempt.start();
  });
}

async function remove(storedPath) {
  if (!isStored(storedPath)) return;
  const { error } = await supabase.storage.from(BUCKET).remove([objectPath(storedPath)]);
  if (error) throw new Error(error.message);
}

async function signedUrl(storedPath, expiresIn = 60 * 60) {
  const { data, error } = await supabase.storage.from(BUCKET).createSignedUrl(objectPath(storedPath), expiresIn);
  if (error) throw new Error(error.message);
  return data.signedUrl;
}

// YouTube's upload client needs a local file. Download a stored video into a temp file once.
async function localFile(filePath) {
  if (!isStored(filePath)) return filePath;
  const dest = path.join(os.tmpdir(), 'social-manager', objectPath(filePath).replace(/[^\w.-]/g, '_'));
  if (fs.existsSync(dest) && fs.statSync(dest).size > 0) return dest;
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  const encoded = objectPath(filePath).split('/').map(encodeURIComponent).join('/');
  const res = await fetch(`${process.env.SUPABASE_URL}/storage/v1/object/${BUCKET}/${encoded}`, {
    headers: { authorization: `Bearer ${process.env.SUPABASE_SECRET_KEY}`, apikey: process.env.SUPABASE_SECRET_KEY },
  });
  if (!res.ok) throw new Error('Could not read the video from Supabase.');
  await pipeline(Readable.fromWeb(res.body), fs.createWriteStream(dest));
  return dest;
}

module.exports = { BUCKET, MAX_BYTES, isStored, objectName, contentType, upload, remove, signedUrl, localFile };
