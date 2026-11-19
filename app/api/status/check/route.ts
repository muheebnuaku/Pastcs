import { timingSafeEqual } from 'crypto';
import { serviceClient } from '@/lib/apiAuth';

// The status page's automatic checks (migration 054). The database calls
// this every 5 minutes through pg_net, with the push drain's secret, and
// gets the results back through status_record(). Each part of PastCS is
// tested the cheapest real way: a query, Supabase's own health endpoint, a
// read-only call to Paystack and OpenAI, and the push queue's backlog.
// Nothing here costs money or changes data.

export const maxDuration = 30;
export const dynamic = 'force-dynamic';

const TIMEOUT_MS = 8000;

type Result = { component: string; ok: boolean; latency_ms: number | null; detail: string | null };

function secretMatches(header: string | null): boolean {
  const expected = process.env.PUSH_DRAIN_SECRET;
  const given = header?.replace(/^Bearer\s+/i, '') ?? '';
  if (!expected || !given) return false;
  const a = Buffer.from(given);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

async function timed(component: string, run: () => Promise<string | null>): Promise<Result> {
  const start = Date.now();
  try {
    const failure = await Promise.race([
      run(),
      new Promise<string>((resolve) => setTimeout(() => resolve('timed out'), TIMEOUT_MS)),
    ]);
    return { component, ok: failure === null, latency_ms: Date.now() - start, detail: failure };
  } catch (e) {
    return { component, ok: false, latency_ms: Date.now() - start, detail: e instanceof Error ? e.message.slice(0, 200) : 'failed' };
  }
}

async function httpOk(url: string, headers: Record<string, string>): Promise<string | null> {
  const res = await fetch(url, { headers, cache: 'no-store', signal: AbortSignal.timeout(TIMEOUT_MS) });
  return res.ok ? null : `HTTP ${res.status}`;
}

export async function POST(request: Request) {
  if (!secretMatches(request.headers.get('authorization'))) {
    return Response.json({ error: 'Unauthorized' }, { status: 401 });
  }
  const admin = serviceClient();
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;

  const results = await Promise.all([
    // This route answering at all means the site is up.
    Promise.resolve<Result>({ component: 'website', ok: true, latency_ms: null, detail: null }),
    timed('database', async () => {
      const { error } = await admin.from('courses').select('id').limit(1);
      return error ? error.message : null;
    }),
    timed('login', () => httpOk(`${supabaseUrl}/auth/v1/health`, { apikey: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? '' })),
    timed('storage', async () => {
      const { error } = await admin.storage.listBuckets();
      return error ? error.message : null;
    }),
    timed('payments', () => process.env.PAYSTACK_SECRET_KEY
      ? httpOk('https://api.paystack.co/balance', { Authorization: `Bearer ${process.env.PAYSTACK_SECRET_KEY}` })
      : Promise.resolve('PAYSTACK_SECRET_KEY not set')),
    timed('ai', () => process.env.OPENAI_API_KEY
      ? httpOk('https://api.openai.com/v1/models', { Authorization: `Bearer ${process.env.OPENAI_API_KEY}` })
      : Promise.resolve('OPENAI_API_KEY not set')),
    timed('push', async () => {
      if (!process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY || !process.env.VAPID_PRIVATE_KEY) return 'VAPID keys not set';
      // Notifications waiting more than 10 minutes means sending is stuck.
      const { count, error } = await admin
        .from('push_outbox')
        .select('notification_id', { count: 'exact', head: true })
        .lt('created_at', new Date(Date.now() - 10 * 60_000).toISOString());
      if (error) return error.message;
      return count && count > 0 ? `${count} notifications stuck in the queue` : null;
    }),
  ]);

  const { error } = await admin.rpc('status_record', { p_results: results });
  if (error) {
    console.error('[status/check] status_record failed', error.message);
    return Response.json({ error: 'Could not record results', results }, { status: 500 });
  }
  return Response.json({ ok: true, results });
}
