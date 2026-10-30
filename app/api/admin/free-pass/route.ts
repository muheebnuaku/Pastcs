import { createClient } from '@supabase/supabase-js';
import { requireAdmin } from '@/lib/adminAuth';
import { logAudit } from '@/lib/auditLog';
import { isSubscriptionCurrentlyActive, termCutoff, termOpensAt } from '@/lib/subscriptionAccess';

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

// Grant free pass
export async function POST(req: Request) {
  const auth = await requireAdmin();
  if (auth instanceof Response) return auth;

  const { userId, level, semester, programId } = await req.json();

  if (!userId || !level || !semester || !programId) {
    return Response.json({ error: 'userId, level, semester, programId required' }, { status: 400 });
  }

  // A pass only unlocks the student's own programme (course_access_for
  // checks subscriptions against users.program_id). A student who hasn't
  // picked one yet gets the pass's programme; a different one is refused
  // rather than granted and silently ignored.
  const { data: student } = await supabaseAdmin
    .from('users').select('id, program_id').eq('id', userId).maybeSingle();
  if (!student) return Response.json({ error: 'Student not found' }, { status: 404 });
  if (student.program_id && student.program_id !== programId) {
    const { data: progs } = await supabaseAdmin.from('programs').select('id, short_code, name').in('id', [student.program_id, programId]);
    const label = (id: string) => { const p = progs?.find(x => x.id === id); return p ? (p.short_code || p.name) : 'another programme'; };
    return Response.json({
      error: `This student is in ${label(student.program_id)}. A pass for ${label(programId)} wouldn't unlock their courses. Pick ${label(student.program_id)} instead.`,
    }, { status: 400 });
  }
  if (!student.program_id) {
    const { error: progError } = await supabaseAdmin.from('users').update({ program_id: programId }).eq('id', userId);
    if (progError) return Response.json({ error: progError.message }, { status: 500 });
  }

  // A pass for a semester that has already ended (plus grace) would be
  // expired the moment it's granted; one granted too long before it
  // starts would count for the cycle before it.
  const { data: term } = await supabaseAdmin
    .from('semester_end_dates').select('program_id, semester, start_date, end_date, grace_days')
    .eq('program_id', programId).eq('semester', semester).maybeSingle();
  const now = new Date().toISOString();
  if (term && Date.now() >= termCutoff(term).getTime()) {
    return Response.json({
      error: `Semester ${semester} for this programme ended on ${term.end_date} (plus ${term.grace_days} days' grace), so a pass for it would already be expired. Update the semester dates in Pricing first.`,
    }, { status: 400 });
  }
  const opens = termOpensAt(term?.start_date);
  if (opens && Date.now() < opens.getTime()) {
    return Response.json({
      error: `Semester ${semester} for this programme starts on ${term!.start_date}. Passes for it can be granted from ${opens.toISOString().slice(0, 10)}, or check its dates in Pricing.`,
    }, { status: 400 });
  }

  // An "active" row that no longer counts (last cycle's payment or pass,
  // past its semester or from before this one started) used to make this
  // say "Already has active access" and do nothing. Only a row that still
  // gives access counts.
  const { data: rows } = await supabaseAdmin
    .from('subscriptions')
    .select('id, status, paid_at, program_id, semester, payment_reference')
    .eq('user_id', userId)
    .eq('level', level)
    .eq('semester', semester)
    .eq('program_id', programId)
    .eq('status', 'active');
  if ((rows ?? []).some(r => isSubscriptionCurrentlyActive(r, term ? [term] : []))) {
    return Response.json({ message: 'Already has active access' });
  }

  const ref = `free_pass_${userId}_${level}_${semester}`;
  const { data: oldPass } = await supabaseAdmin
    .from('subscriptions').select('id').eq('payment_reference', ref).maybeSingle();
  const { error } = oldPass
    ? await supabaseAdmin.from('subscriptions')
        .update({ status: 'active', paid_at: now, amount: 0, program_id: programId, level, semester })
        .eq('id', oldPass.id)
    : await supabaseAdmin.from('subscriptions').insert({
        user_id: userId,
        level,
        semester,
        program_id: programId,
        payment_reference: ref,
        amount: 0,
        status: 'active',
        paid_at: now,
      });

  if (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }

  // Tell the student; an open app also refreshes its unlocked courses on
  // this (components/layout/ClassroomAlerts.tsx).
  await supabaseAdmin.from('notifications').insert({
    user_id: userId,
    type: 'free_pass',
    message: `🎁 You've been given free access to every Level ${level}, Semester ${semester} course, classrooms included.`,
    link: '/courses',
  }).then(() => {}, () => {});

  logAudit(supabaseAdmin, 'free_pass.grant', `user ${userId} — Level ${level} Semester ${semester}`, { userId, level, semester, programId }, auth.userId).catch(() => {});

  return Response.json({ success: true });
}

// Revoke free pass
export async function DELETE(req: Request) {
  const auth = await requireAdmin();
  if (auth instanceof Response) return auth;

  const { userId, level, semester, programId } = await req.json();

  if (!userId || !level || !semester) {
    return Response.json({ error: 'userId, level, semester required' }, { status: 400 });
  }

  let query = supabaseAdmin
    .from('subscriptions')
    .delete()
    .eq('user_id', userId)
    .eq('level', level)
    .eq('semester', semester)
    .like('payment_reference', 'free_pass_%');

  // Older rows (granted before program_id existed) have it null — only
  // narrow by program when the caller actually knows which one to revoke.
  if (programId) query = query.eq('program_id', programId);

  const { error } = await query;

  if (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }

  logAudit(supabaseAdmin, 'free_pass.revoke', `user ${userId} — Level ${level} Semester ${semester}`, { userId, level, semester, programId }, auth.userId).catch(() => {});

  return Response.json({ success: true });
}
