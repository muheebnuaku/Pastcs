import { createClient } from '@supabase/supabase-js';

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

// Grant free pass
export async function POST(req: Request) {
  const { userId, level, semester } = await req.json();

  if (!userId || !level || !semester) {
    return Response.json({ error: 'userId, level, semester required' }, { status: 400 });
  }

  // Check if already has active access for this level/semester
  const { data: existing } = await supabaseAdmin
    .from('subscriptions')
    .select('id')
    .eq('user_id', userId)
    .eq('level', level)
    .eq('semester', semester)
    .eq('status', 'active')
    .maybeSingle();

  if (existing) {
    return Response.json({ message: 'Already has active access' });
  }

  const ref = `free_pass_${userId}_${level}_${semester}`;
  const { error } = await supabaseAdmin
    .from('subscriptions')
    .insert({
      user_id: userId,
      level,
      semester,
      payment_reference: ref,
      amount: 0,
      status: 'active',
      paid_at: new Date().toISOString(),
    });

  if (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }

  return Response.json({ success: true });
}

// Revoke free pass
export async function DELETE(req: Request) {
  const { userId, level, semester } = await req.json();

  if (!userId || !level || !semester) {
    return Response.json({ error: 'userId, level, semester required' }, { status: 400 });
  }

  const { error } = await supabaseAdmin
    .from('subscriptions')
    .delete()
    .eq('user_id', userId)
    .eq('level', level)
    .eq('semester', semester)
    .like('payment_reference', 'free_pass_%');

  if (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }

  return Response.json({ success: true });
}
