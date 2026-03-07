import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';

export async function GET(
  request: Request,
  { params }: { params: { courseCode: string } }
) {
  try {
    const supabase = await createClient();
    const { searchParams } = new URL(request.url);
    const mode = searchParams.get('mode') || 'practice';
    const topicId = searchParams.get('topic');
    const limit = parseInt(searchParams.get('limit') || '20');

    // Get course by code
    const { data: course, error: courseError } = await supabase
      .from('courses')
      .select('id')
      .eq('course_code', params.courseCode)
      .single();

    if (courseError || !course) {
      return NextResponse.json(
        { error: 'Course not found' },
        { status: 404 }
      );
    }

    // Build query for questions
    let query = supabase
      .from('questions')
      .select('*')
      .eq('course_id', course.id);

    if (topicId) {
      query = query.eq('topic_id', topicId);
    }

    // For exam simulation, get a balanced mix of difficulties
    if (mode === 'exam') {
      const { data: allQuestions } = await query;
      
      if (!allQuestions || allQuestions.length === 0) {
        return NextResponse.json({ questions: [] });
      }

      // Shuffle and select questions
      const shuffled = [...allQuestions].sort(() => Math.random() - 0.5);
      const selected = shuffled.slice(0, Math.min(limit, shuffled.length));

      return NextResponse.json({ 
        questions: selected,
        courseId: course.id,
      });
    }

    // For practice mode, randomize
    const { data: questions, error: questionsError } = await query;

    if (questionsError) {
      return NextResponse.json(
        { error: 'Failed to fetch questions' },
        { status: 500 }
      );
    }

    // Shuffle questions
    const shuffled = questions ? [...questions].sort(() => Math.random() - 0.5) : [];
    const selected = shuffled.slice(0, Math.min(limit, shuffled.length));

    return NextResponse.json({ 
      questions: selected,
      courseId: course.id,
    });
  } catch (error) {
    console.error('Error fetching questions:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}
