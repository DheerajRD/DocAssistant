// Run separately from Next.js: node --env-file=.env.local scripts/worker.mjs
const origin = process.env.APP_URL;
const secret = process.env.CRON_SECRET;
if (!origin || !secret || secret.length < 32)
  throw new Error('Set APP_URL and a CRON_SECRET of at least 32 characters.');
let stopping = false;
process.on('SIGINT', () => {
  stopping = true;
});
process.on('SIGTERM', () => {
  stopping = true;
});
console.log('Document worker started. Press Ctrl+C to stop.');
while (!stopping) {
  try {
    const response = await fetch(new URL('/api/jobs', origin), {
      headers: { Authorization: `Bearer ${secret}` },
      signal: AbortSignal.timeout(290000),
    });
    if (!response.ok) console.error('Worker request failed:', response.status);
    else console.log('Worker tick:', await response.json());
  } catch {
    console.error('Worker could not reach the server. Check configuration.');
  }
  if (!stopping) await new Promise((resolve) => setTimeout(resolve, 60000));
}
