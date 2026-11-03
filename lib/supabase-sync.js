// Sync CLI helper for serverless: run one SQL statement and print JSON rows.
const { createClient } = require('@supabase/supabase-js');

(async () => {
  const statement = process.argv[2];
  if (!statement) {
    console.error('Missing SQL statement');
    process.exit(2);
  }
  if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SECRET_KEY) {
    console.error('Supabase is not configured');
    process.exit(2);
  }
  const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SECRET_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data, error } = await supabase.rpc('app_sql', { statement });
  if (error) {
    console.error(error.message || 'Database request failed');
    process.exit(2);
  }
  process.stdout.write(JSON.stringify(data ?? []));
})().catch(e => {
  console.error(e.message || String(e));
  process.exit(2);
});
