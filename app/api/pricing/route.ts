import { createClient } from '@/lib/supabase/server';
import { createClient as createAdminClient } from '@supabase/supabase-js';
import { requireAdmin } from '@/lib/adminAuth';

// GET /api/pricing?programId=... — returns per-level prices for one
// program. programId is required — pricing is program-scoped, so
// there's no longer a single global price list to fall back to.
export async function GET(request: Request) {
  try {
    const programId = new URL(request.url).searchParams.get('programId');
    if (!programId) {
      return Response.json({ error: 'programId is required' }, { status: 400 });
    }

    const supabase = await createClient();
    const { data, error } = await supabase
      .from('subscription_prices')
      .select('level, amount')
      .eq('program_id', programId)
      .order('level');

    if (error) throw error;

    // Return as { 100: 5000, 200: 5000, ... }
    const prices: Record<number, number> = {};
    for (const row of data || []) {
      prices[row.level] = row.amount;
    }
    return Response.json({ prices });
  } catch (err) {
    console.error('GET pricing error:', err);
    return Response.json({ error: 'Failed to load prices' }, { status: 500 });
  }
}

// PUT /api/pricing — admin updates one program's per-level prices
export async function PUT(request: Request) {
  try {
    const auth = await requireAdmin();
    if (auth instanceof Response) return auth;

    const { prices, programId } = await request.json() as { prices: Record<number, number>; programId: string };
    if (!programId) {
      return Response.json({ error: 'programId is required' }, { status: 400 });
    }

    const adminSupabase = createAdminClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!
    );

    const updates = Object.entries(prices).map(([level, amount]) => ({
      level: Number(level),
      program_id: programId,
      amount: Number(amount),
      updated_at: new Date().toISOString(),
    }));

    const { error } = await adminSupabase
      .from('subscription_prices')
      .upsert(updates, { onConflict: 'level,program_id' });

    if (error) throw error;

    return Response.json({ success: true });
  } catch (err) {
    console.error('PUT pricing error:', err);
    return Response.json({ error: 'Failed to update prices' }, { status: 500 });
  }
}
