import { NextRequest } from 'next/server';
import { createClient } from '@/lib/supabase/server';

export async function POST(request: NextRequest) {
  try {
    const supabase = await createClient();
    const { data: { user: authUser } } = await supabase.auth.getUser();

    if (!authUser) {
      return Response.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { courseCode } = await request.json();

    if (!courseCode) {
      return Response.json({ error: 'courseCode is required' }, { status: 400 });
    }

    // Fetch user's current selection and existing free course
    const { data: userData } = await supabase
      .from('users')
      .select('free_course_code, selected_level, selected_semester')
      .eq('id', authUser.id)
      .single();

    if (!userData) {
      return Response.json({ error: 'User not found' }, { status: 404 });
    }

    // Do not allow changing an already-selected free course
    if (userData.free_course_code) {
      return Response.json({ error: 'Free course already selected' }, { status: 400 });
    }

    if (!userData.selected_level || !userData.selected_semester) {
      return Response.json({ error: 'Level/semester not set' }, { status: 400 });
    }

    // Verify the course belongs to the user's selected level/semester
    const { data: course } = await supabase
      .from('courses')
      .select('course_code')
      .eq('course_code', courseCode)
      .eq('level', userData.selected_level)
      .eq('semester', userData.selected_semester)
      .single();

    if (!course) {
      return Response.json(
        { error: 'Course not found for your level/semester' },
        { status: 404 }
      );
    }

    const { error } = await supabase
      .from('users')
      .update({ free_course_code: courseCode })
      .eq('id', authUser.id);

    if (error) throw error;

    return Response.json({ success: true });
  } catch (error) {
    console.error('Error setting free course:', error);
    return Response.json({ error: 'Internal server error' }, { status: 500 });
  }
}
