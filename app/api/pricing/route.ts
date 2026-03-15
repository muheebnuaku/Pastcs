import { createClient } from '@/lib/supabase/server';
import { createClient as createAdminClient } from '@supabase/supabase-js';

// GET /api/pricing — returns all per-level subscription prices
export async function GET() {
  try {
    const supabase = await createClient();
    const { data, error } = await supabase
      .from('subscription_prices')
      .select('level, amount')
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

// PUT /api/pricing — admin updates per-level prices
export async function PUT(request: Request) {
  try {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 });

    // Check admin role
    const { data: profile } = await supabase
      .from('users')
      .select('role')
      .eq('id', user.id)
      .single();

    if (profile?.role !== 'admin') {
      return Response.json({ error: 'Forbidden' }, { status: 403 });
    }

    const { prices } = await request.json() as { prices: Record<number, number> };

    const adminSupabase = createAdminClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!
    );

    const updates = Object.entries(prices).map(([level, amount]) => ({
      level: Number(level),
      amount: Number(amount),
      updated_at: new Date().toISOString(),
    }));

    const { error } = await adminSupabase
      .from('subscription_prices')
      .upsert(updates, { onConflict: 'level' });

    if (error) throw error;

    return Response.json({ success: true });
  } catch (err) {
    console.error('PUT pricing error:', err);
    return Response.json({ error: 'Failed to update prices' }, { status: 500 });
  }
}
