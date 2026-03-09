import { NextRequest } from 'next/server';
import { createClient } from '@/lib/supabase/server';

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ courseCode: string }> }
) {
  try {
    const { courseCode } = await params;
    const supabase = await createClient();
    const { searchParams } = request.nextUrl;
    const mode = searchParams.get('mode') || 'practice';
    const topicId = searchParams.get('topic');
    const limit = parseInt(searchParams.get('limit') || '20');

    // Require authenticated session
    const { data: { user: authUser } } = await supabase.auth.getUser();
    if (!authUser) {
      return Response.json({ error: 'Unauthorized' }, { status: 401 });
    }

    // Fetch user's subscription status and free course
    const { data: userData } = await supabase
      .from('users')
      .select('selected_level, selected_semester, free_course_code')
      .eq('id', authUser.id)
      .single();

    // Get course by code
    const { data: course, error: courseError } = await supabase
      .from('courses')
      .select('id, course_code')
      .eq('course_code', courseCode)
      .single();

    if (courseError || !course) {
      return Response.json({ error: 'Course not found' }, { status: 404 });
    }

    // Server-side subscription gate
    if (userData) {
      const isFree = userData.free_course_code === course.course_code;
      if (!isFree) {
        const { data: activeSub } = await supabase
          .from('subscriptions')
          .select('id')
          .eq('user_id', authUser.id)
          .eq('level', userData.selected_level)
          .eq('semester', userData.selected_semester)
          .eq('status', 'active')
          .limit(1)
          .single();

        if (!activeSub) {
          return Response.json(
            { error: 'subscription_required' },
            { status: 403 }
          );
        }
      }
    }

    // Build query for questions
    let query = supabase
      .from('questions')
      .select('*')
      .eq('course_id', course.id);

    if (topicId) {
      query = query.eq('topic_id', topicId);
    }

    if (mode === 'exam') {
      const { data: allQuestions } = await query;

      if (!allQuestions || allQuestions.length === 0) {
        return Response.json({ questions: [] });
      }

      const shuffled = [...allQuestions].sort(() => Math.random() - 0.5);
      const selected = shuffled.slice(0, Math.min(limit, shuffled.length));

      return Response.json({ questions: selected, courseId: course.id });
    }

    const { data: questions, error: questionsError } = await query;

    if (questionsError) {
      return Response.json({ error: 'Failed to fetch questions' }, { status: 500 });
    }

    const shuffled = questions ? [...questions].sort(() => Math.random() - 0.5) : [];
    const selected = shuffled.slice(0, Math.min(limit, shuffled.length));

    return Response.json({ questions: selected, courseId: course.id });
  } catch (error) {
    console.error('Error fetching questions:', error);
    return Response.json({ error: 'Internal server error' }, { status: 500 });
  }
}
