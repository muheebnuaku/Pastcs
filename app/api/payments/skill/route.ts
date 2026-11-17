import { createClient as createAdminClient } from '@supabase/supabase-js';
import { createClient } from '@/lib/supabase/server';
import { recordSkillEnrolment } from '@/lib/skillsServer';
import { SKILL_SLUG } from '@/lib/skills';

// The browser's quick path after a skill course checkout (Paystack's
// webhook is the backstop). Paystack is asked what was really paid; the
// database checks it against the course price.
export async function POST(request: Request) {
  try {
    const supabase = await createClient();
    const { data: { user: authUser } } = await supabase.auth.getUser();
    if (!authUser) return Response.json({ error: 'Please sign in again.' }, { status: 401 });

    const { reference, slug } = await request.json() as { reference?: string; slug?: string };
    if (!reference || typeof reference !== 'string' || !slug || !SKILL_SLUG.test(slug)) {
      return Response.json({ error: 'reference and course are required' }, { status: 400 });
    }

    const paystackRes = await fetch(
      `https://api.paystack.co/transaction/verify/${encodeURIComponent(reference)}`,
      { headers: { Authorization: `Bearer ${process.env.PAYSTACK_SECRET_KEY}` } }
    );
    const paystack = await paystackRes.json() as {
      status: boolean;
      data?: { status: string; amount: number; currency?: string; metadata?: { userId?: string; product?: string; skill?: string } };
    };
    if (!paystack.status || paystack.data?.status !== 'success') {
      return Response.json({ error: 'Payment not successful.' }, { status: 400 });
    }

    // Only a skill checkout made from this account, for this course, counts.
    const meta = paystack.data.metadata;
    if (meta?.product !== 'skill' || meta.userId !== authUser.id || meta.skill !== slug) {
      console.error('[payments/skill] reference is not a skill checkout for this account', { reference, userId: authUser.id, meta });
      return Response.json({ error: `This payment isn't for this course on your account. Please contact support with reference ${reference}.` }, { status: 400 });
    }

    const admin = createAdminClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);
    const result = await recordSkillEnrolment(admin, authUser.id, slug, reference, paystack.data.amount, String(paystack.data.currency ?? ''));
    if (result.ok) return Response.json({ success: true, ends_at: result.ends_at });

    console.error('[payments/skill] record_skill_enrolment failed', result.message, { reference, userId: authUser.id, slug });
    if (result.code === 'amount_too_low') {
      return Response.json({ error: `The amount paid is below the course price. Please contact support with reference ${reference}.` }, { status: 400 });
    }
    return Response.json({ error: `Your payment went through but we couldn't confirm it yet. Refresh in a minute, or contact support with reference ${reference}.` }, { status: 500 });
  } catch (e) {
    console.error('[payments/skill] error', e);
    return Response.json({ error: 'Something went wrong. Refresh in a minute; if you were charged, your place is kept.' }, { status: 500 });
  }
}
