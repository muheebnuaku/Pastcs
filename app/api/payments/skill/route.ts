import { createClient as createAdminClient } from '@supabase/supabase-js';
import { createClient } from '@/lib/supabase/server';
import { buyerFromPaystack, recordSkillEnrolment } from '@/lib/skillsServer';
import { SKILL_SLUG } from '@/lib/skills';

// The browser's quick path after a skill course checkout (Paystack's
// webhook is the backstop). No account is needed. Paystack is asked what
// was really paid; the database checks it against the course price.
//
// The buyer's access link is handed back only to the browser that made
// the checkout: it put a random `claim` in Paystack's metadata and must
// send the same one here, so knowing someone's reference isn't enough.
export async function POST(request: Request) {
  try {
    const { reference, slug, claim } = await request.json() as { reference?: string; slug?: string; claim?: string };
    if (!reference || typeof reference !== 'string' || !slug || !SKILL_SLUG.test(slug) || !claim || typeof claim !== 'string') {
      return Response.json({ error: 'reference, course and claim are required' }, { status: 400 });
    }

    const supabase = await createClient();
    const { data: { user: authUser } } = await supabase.auth.getUser();

    const paystackRes = await fetch(
      `https://api.paystack.co/transaction/verify/${encodeURIComponent(reference)}`,
      { headers: { Authorization: `Bearer ${process.env.PAYSTACK_SECRET_KEY}` } }
    );
    const paystack = await paystackRes.json() as {
      status: boolean;
      data?: { status: string; amount: number; currency?: string; customer?: { email?: string }; metadata?: Record<string, unknown> };
    };
    if (!paystack.status || paystack.data?.status !== 'success') {
      return Response.json({ error: 'Payment not successful.' }, { status: 400 });
    }

    const meta = paystack.data.metadata;
    if (meta?.product !== 'skill' || meta.skill !== slug || meta.claim !== claim) {
      console.error('[payments/skill] reference is not this skill checkout', { reference, slug, product: meta?.product, skill: meta?.skill });
      return Response.json({ error: `This payment isn't for this course. Please contact support with reference ${reference}.` }, { status: 400 });
    }
    const buyer = buyerFromPaystack(meta, paystack.data.customer?.email);
    // Bought while signed in: it must be this account.
    if (buyer.userId && buyer.userId !== authUser?.id) {
      return Response.json({ error: 'Please sign in to the account you paid from.' }, { status: 401 });
    }

    const admin = createAdminClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);
    const result = await recordSkillEnrolment(admin, buyer, slug, reference, paystack.data.amount, String(paystack.data.currency ?? ''));
    if (result.ok) return Response.json({ success: true, ends_at: result.ends_at, access_token: result.access_token });

    console.error('[payments/skill] record_skill_enrolment failed', result.message, { reference, slug });
    if (result.code === 'amount_too_low') {
      return Response.json({ error: `The amount paid is below the course price. Please contact support with reference ${reference}.` }, { status: 400 });
    }
    return Response.json({ error: `Your payment went through but we couldn't confirm it yet. Please contact support with reference ${reference}.` }, { status: 500 });
  } catch (e) {
    console.error('[payments/skill] error', e);
    return Response.json({ error: 'Something went wrong confirming your payment. If you were charged, contact support: your place is kept.' }, { status: 500 });
  }
}
