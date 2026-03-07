import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';

export async function GET(
  request: Request,
  { params }: { params: { testId: string } }
) {
  try {
    const supabase = await createClient();

    // Get current user
    const { data: { user } } = await supabase.auth.getUser();
    
    if (!user) {
      return NextResponse.json(
        { error: 'Unauthorized' },
        { status: 401 }
      );
    }

    // Get test with course info
    const { data: test, error: testError } = await supabase
      .from('tests')
      .select('*, course:courses(*)')
      .eq('id', params.testId)
      .single();

    if (testError || !test) {
      return NextResponse.json(
        { error: 'Test not found' },
        { status: 404 }
      );
    }

    // Verify user owns this test or is admin
    const { data: currentUser } = await supabase
      .from('users')
      .select('role')
      .eq('id', user.id)
      .single();

    if (test.user_id !== user.id && currentUser?.role !== 'admin') {
      return NextResponse.json(
        { error: 'Access denied' },
        { status: 403 }
      );
    }

    // Get test answers with questions
    const { data: answers, error: answersError } = await supabase
      .from('test_answers')
      .select('*, question:questions(*)')
      .eq('test_id', params.testId);

    if (answersError) {
      return NextResponse.json(
        { error: 'Failed to fetch answers' },
        { status: 500 }
      );
    }

    return NextResponse.json({
      test,
      answers: answers || [],
    });
  } catch (error) {
    console.error('Error fetching test:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}
