import { createClient } from '@/lib/supabase/server';

export async function POST(request: Request) {
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
      .from('user_public')
      .select('free_course_code, selected_level, selected_semester, program_id')
      .eq('id', authUser.id)
      .single();

    if (!userData) {
      return Response.json({ error: 'User not found' }, { status: 404 });
    }

    // Do not allow changing an already-selected free course
    if (userData.free_course_code) {
      return Response.json({ error: 'Free course already selected' }, { status: 400 });
    }

    if (!userData.selected_level || !userData.selected_semester || !userData.program_id) {
      return Response.json({ error: 'Level/semester/program not set' }, { status: 400 });
    }

    // Verify the course belongs to the user's selected level/semester AND
    // their own program — without this a student could otherwise claim
    // their free pick from a course outside their program at the same
    // level/semester.
    const { data: course } = await supabase
      .from('courses')
      .select('course_code, course_programs!inner(program_id)')
      // Case-insensitive — see app/(student)/courses/[courseCode]/page.tsx
      // for why a course_code saved with any casing needs this.
      .ilike('course_code', courseCode)
      .eq('level', userData.selected_level)
      .eq('semester', userData.selected_semester)
      .eq('course_programs.program_id', userData.program_id)
      .single();

    if (!course) {
      return Response.json(
        { error: 'Course not found for your level/semester/program' },
        { status: 404 }
      );
    }

    // Store the course's own canonical casing, not whatever the client sent.
    const { error } = await supabase
      .from('user_public')
      .update({ free_course_code: course.course_code })
      .eq('id', authUser.id);

    if (error) throw error;

    return Response.json({ success: true });
  } catch (error) {
    console.error('Error setting free course:', error);
    return Response.json({ error: 'Internal server error' }, { status: 500 });
  }
}
