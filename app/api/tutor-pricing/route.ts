import { createClient } from '@/lib/supabase/server';
import { createClient as createAdminClient } from '@supabase/supabase-js';

export interface TutorCreditPlan {
  id: string;
  name: string;
  credits: number;
  amount: number; // pesewas
}

// GET /api/tutor-pricing — returns all AI Tutor credit pack prices
export async function GET() {
  try {
    const supabase = await createClient();
    const { data, error } = await supabase
      .from('tutor_credit_plans')
      .select('id, name, credits, amount')
      .order('amount');

    if (error) throw error;

    return Response.json({ plans: (data ?? []) as TutorCreditPlan[] });
  } catch (err) {
    console.error('GET tutor-pricing error:', err);
    return Response.json({ error: 'Failed to load tutor pricing' }, { status: 500 });
  }
}

// PUT /api/tutor-pricing — admin updates pack name/credits/price
export async function PUT(request: Request) {
  try {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 });

    const { data: profile } = await supabase
      .from('users')
      .select('role')
      .eq('id', user.id)
      .single();

    if (profile?.role !== 'admin') {
      return Response.json({ error: 'Forbidden' }, { status: 403 });
    }

    const { plans } = await request.json() as { plans: TutorCreditPlan[] };
    if (!Array.isArray(plans) || plans.length === 0) {
      return Response.json({ error: 'plans array is required' }, { status: 400 });
    }

    const adminSupabase = createAdminClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!
    );

    const updates = plans.map(p => ({
      id: p.id,
      name: p.name,
      credits: Number(p.credits),
      amount: Number(p.amount),
      updated_at: new Date().toISOString(),
    }));

    const { error } = await adminSupabase
      .from('tutor_credit_plans')
      .upsert(updates, { onConflict: 'id' });

    if (error) throw error;

    return Response.json({ success: true });
  } catch (err) {
    console.error('PUT tutor-pricing error:', err);
    return Response.json({ error: 'Failed to update tutor pricing' }, { status: 500 });
  }
}
