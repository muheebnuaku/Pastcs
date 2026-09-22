import { createClient } from '@/lib/supabase/server';
import { createClient as createAdminClient } from '@supabase/supabase-js';
import { requireAdmin } from '@/lib/adminAuth';
import { logAudit } from '@/lib/auditLog';

interface TermInput {
  semester: number;
  start_date: string | null;
  end_date: string;
  grace_days: number;
}

// GET /api/semester-dates?programId=... — returns both semesters' access
// windows for one program. programId is required, same convention as
// /api/pricing.
export async function GET(request: Request) {
  try {
    const programId = new URL(request.url).searchParams.get('programId');
    if (!programId) {
      return Response.json({ error: 'programId is required' }, { status: 400 });
    }

    const supabase = await createClient();
    const { data, error } = await supabase
      .from('semester_end_dates')
      .select('semester, start_date, end_date, grace_days')
      .eq('program_id', programId)
      .order('semester');

    if (error) throw error;

    return Response.json({ terms: data ?? [] });
  } catch (err) {
    console.error('GET semester-dates error:', err);
    return Response.json({ error: 'Failed to load semester dates' }, { status: 500 });
  }
}

// PUT /api/semester-dates — admin sets one program's access window for
// one or both semesters.
export async function PUT(request: Request) {
  try {
    const auth = await requireAdmin();
    if (auth instanceof Response) return auth;

    const { programId, terms } = await request.json() as { programId: string; terms: TermInput[] };
    if (!programId) {
      return Response.json({ error: 'programId is required' }, { status: 400 });
    }
    if (!Array.isArray(terms) || terms.length === 0) {
      return Response.json({ error: 'terms is required' }, { status: 400 });
    }
    for (const term of terms) {
      if (![1, 2].includes(term.semester) || !term.end_date || term.grace_days < 0) {
        return Response.json({ error: 'Each term needs a valid semester, end_date, and grace_days' }, { status: 400 });
      }
    }

    const adminSupabase = createAdminClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!
    );

    const updates = terms.map(t => ({
      program_id: programId,
      semester: t.semester,
      start_date: t.start_date || null,
      end_date: t.end_date,
      grace_days: t.grace_days,
      updated_at: new Date().toISOString(),
    }));

    const { error } = await adminSupabase
      .from('semester_end_dates')
      .upsert(updates, { onConflict: 'program_id,semester' });

    if (error) throw error;

    logAudit(adminSupabase, 'semester_dates.update', `program ${programId}`, { programId, terms }, auth.userId).catch(() => {});

    return Response.json({ success: true });
  } catch (err) {
    console.error('PUT semester-dates error:', err);
    return Response.json({ error: 'Failed to update semester dates' }, { status: 500 });
  }
}
