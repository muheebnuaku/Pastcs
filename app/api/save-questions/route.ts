import { createClient } from '@supabase/supabase-js';

export async function POST(request: Request) {
  try {
    const { questions, courseId } = await request.json();

    if (!questions?.length || !courseId) {
      return Response.json({ error: 'questions and courseId are required' }, { status: 400 });
    }

    // Use service role to bypass RLS and skip per-row trigger overhead
    const supabase = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!
    );

    // Disable the trigger temporarily isn't possible via PostgREST,
    // so we insert in one bulk call — PostgREST sends it as a single transaction
    const { error: insertError } = await supabase
      .from('questions')
      .insert(questions);

    if (insertError) throw insertError;

    // Recalculate total_questions with one query instead of relying on per-row trigger
    const { count } = await supabase
      .from('questions')
      .select('*', { count: 'exact', head: true })
      .eq('course_id', courseId);

    await supabase
      .from('courses')
      .update({ total_questions: count ?? 0 })
      .eq('id', courseId);

    return Response.json({ saved: questions.length });
  } catch (error: any) {
    console.error('Error saving questions:', error);
    return Response.json(
      { error: error.message || 'Failed to save questions' },
      { status: 500 }
    );
  }
}
