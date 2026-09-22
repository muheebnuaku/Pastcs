import { createClient } from '@supabase/supabase-js';
import { requireSuperAdmin } from '@/lib/adminAuth';

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

interface SubRow {
  id: string;
  user_id: string;
  level: number;
  semester: number;
  amount: number;
  payment_reference: string;
  status: string;
  paid_at: string | null;
  created_at: string;
}

interface CreditRow {
  id: string;
  user_id: string;
  plan: string;
  amount_paid: number;
  total_credits: number;
  payment_reference: string;
  created_at: string;
}

const isFreePass = (ref: string) => ref?.startsWith('free_pass');

function dayKey(iso: string) {
  return iso.slice(0, 10); // YYYY-MM-DD
}

// GET /api/admin/tracker — platform-wide payment/revenue data for the
// super-admin-only Tracker page. Every genuine payment lives in one of
// two tables (course-access subscriptions, AI Tutor credit packs) —
// this merges both into one picture. Deliberately excludes free-pass
// grants (amount = 0, payment_reference starting "free_pass") from
// revenue sums, but counts them separately since "how many free passes
// did we hand out" is its own useful number.
export async function GET() {
  const auth = await requireSuperAdmin();
  if (auth instanceof Response) return auth;

  try {
    const [{ data: subsData }, { data: creditsData }, { data: usersData }, { data: plansData }] = await Promise.all([
      supabaseAdmin.from('subscriptions').select('*').order('created_at', { ascending: false }),
      supabaseAdmin.from('ai_tutor_credits').select('*').order('created_at', { ascending: false }),
      supabaseAdmin.from('users').select('id, email, full_name'),
      supabaseAdmin.from('tutor_credit_plans').select('id, name'),
    ]);

    const subs = (subsData ?? []) as SubRow[];
    const credits = (creditsData ?? []) as CreditRow[];
    const userMap = new Map((usersData ?? []).map((u: { id: string; email: string; full_name: string | null }) => [u.id, u]));
    const planNameMap = new Map((plansData ?? []).map((p: { id: string; name: string }) => [p.id, p.name]));

    // Only count money that actually moved — active subs, real (non-free-pass)
    const paidSubs = subs.filter(s => s.status === 'active' && !isFreePass(s.payment_reference));
    const freePasses = subs.filter(s => s.status === 'active' && isFreePass(s.payment_reference));

    const courseRevenue = paidSubs.reduce((sum, s) => sum + s.amount, 0);
    const tutorRevenue = credits.reduce((sum, c) => sum + c.amount_paid, 0);

    // Revenue by level (course access)
    const byLevel = new Map<number, { revenue: number; count: number }>();
    for (const s of paidSubs) {
      const cur = byLevel.get(s.level) ?? { revenue: 0, count: 0 };
      cur.revenue += s.amount;
      cur.count += 1;
      byLevel.set(s.level, cur);
    }

    // Revenue by AI Tutor plan
    const byPlan = new Map<string, { revenue: number; count: number }>();
    for (const c of credits) {
      const cur = byPlan.get(c.plan) ?? { revenue: 0, count: 0 };
      cur.revenue += c.amount_paid;
      cur.count += 1;
      byPlan.set(c.plan, cur);
    }

    // Daily revenue for the last 30 days, split by source, for a chart
    const days = new Map<string, { course: number; tutor: number }>();
    const now = Date.now();
    for (let i = 29; i >= 0; i--) {
      days.set(dayKey(new Date(now - i * 86400000).toISOString()), { course: 0, tutor: 0 });
    }
    for (const s of paidSubs) {
      const key = dayKey(s.paid_at || s.created_at);
      if (days.has(key)) days.get(key)!.course += s.amount;
    }
    for (const c of credits) {
      const key = dayKey(c.created_at);
      if (days.has(key)) days.get(key)!.tutor += c.amount_paid;
    }

    // Merged, most-recent-first feed
    const recentPayments = [
      ...paidSubs.map(s => ({
        id: s.id,
        type: 'course' as const,
        userEmail: userMap.get(s.user_id)?.email ?? 'unknown',
        userName: userMap.get(s.user_id)?.full_name ?? null,
        amount: s.amount,
        description: `Level ${s.level} · Semester ${s.semester} access`,
        createdAt: s.paid_at || s.created_at,
      })),
      ...credits.map(c => ({
        id: c.id,
        type: 'tutor' as const,
        userEmail: userMap.get(c.user_id)?.email ?? 'unknown',
        userName: userMap.get(c.user_id)?.full_name ?? null,
        amount: c.amount_paid,
        description: `AI Tutor — ${planNameMap.get(c.plan) ?? c.plan} (${c.total_credits} credits)`,
        createdAt: c.created_at,
      })),
    ].sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()).slice(0, 50);

    return Response.json({
      totals: {
        revenue: courseRevenue + tutorRevenue,
        courseRevenue,
        tutorRevenue,
        courseSubCount: paidSubs.length,
        tutorCreditCount: credits.length,
        freePassCount: freePasses.length,
      },
      revenueByDay: Array.from(days.entries()).map(([date, v]) => ({ date, ...v })),
      courseRevenueByLevel: Array.from(byLevel.entries())
        .map(([level, v]) => ({ level, ...v }))
        .sort((a, b) => a.level - b.level),
      tutorRevenueByPlan: Array.from(byPlan.entries())
        .map(([plan, v]) => ({ plan, planName: planNameMap.get(plan) ?? plan, ...v }))
        .sort((a, b) => b.revenue - a.revenue),
      recentPayments,
    });
  } catch (err) {
    console.error('Tracker data error:', err);
    return Response.json({ error: 'Failed to load tracker data' }, { status: 500 });
  }
}
