// Runs Supabase requests off the main thread and wakes it with a shared buffer.
const { parentPort, workerData } = require('worker_threads');
const { createClient } = require('@supabase/supabase-js');

const sab = workerData.sab;
const header = new Int32Array(sab, 0, 2);
const bytes = new Uint8Array(sab);
const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SECRET_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});

function finish(status, text) {
  let body = Buffer.from(String(text));
  if (body.length > bytes.length - 8) {
    status = 2;
    body = Buffer.from('Database result is too large');
  }
  bytes.set(body, 8);
  Atomics.store(header, 1, body.length);
  Atomics.store(header, 0, status);
  Atomics.notify(header, 0, 1);
}

parentPort.on('message', async (statement) => {
  try {
    const { data, error } = await supabase.rpc('app_sql', { statement });
    if (error) finish(2, error.message || 'Database request failed');
    else finish(1, JSON.stringify(data ?? []));
  } catch (e) {
    finish(2, e.message || 'Database request failed');
  }
});
