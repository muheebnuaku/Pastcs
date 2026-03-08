import { createClient } from '@/lib/supabase/server';

export async function POST(request: Request) {
  try {
    const supabase = await createClient();

    // Get current user
    const { data: { user } } = await supabase.auth.getUser();
    
    if (!user) {
      return Response.json(
        { error: 'Unauthorized' },
        { status: 401 }
      );
    }

    const body = await request.json();
    const {
      courseId,
      testType,
      answers, // Array of { questionId, userAnswer, isCorrect }
      totalQuestions,
      correctAnswers,
      timeTaken,
    } = body;

    // Calculate percentage
    const percentage = totalQuestions > 0
      ? (correctAnswers / totalQuestions) * 100
      : 0;

    // Calculate XP earned (10 XP per correct answer, bonus for exam)
    let xpEarned = correctAnswers * 10;
    if (testType === 'exam_simulation' && percentage >= 70) {
      xpEarned += 50; // Bonus for passing exam simulation
    }

    // Create test record
    const { data: test, error: testError } = await supabase
      .from('tests')
      .insert({
        user_id: user.id,
        course_id: courseId,
        test_type: testType,
        total_questions: totalQuestions,
        correct_answers: correctAnswers,
        percentage,
        time_taken: timeTaken,
        completed_at: new Date().toISOString(),
      })
      .select()
      .single();

    if (testError) {
      console.error('Error creating test:', testError);
      return Response.json(
        { error: 'Failed to save test' },
        { status: 500 }
      );
    }

    // Create test answers
    if (answers && answers.length > 0) {
      const testAnswers = answers.map((a: any) => ({
        test_id: test.id,
        question_id: a.questionId,
        user_answer: a.userAnswer,
        is_correct: a.isCorrect,
      }));

      const { error: answersError } = await supabase
        .from('test_answers')
        .insert(testAnswers);

      if (answersError) {
        console.error('Error saving answers:', answersError);
      }
    }

    // Update user XP
    const { error: xpError } = await supabase
      .from('users')
      .update({ 
        xp: supabase.rpc('increment_xp', { user_id: user.id, amount: xpEarned })
      })
      .eq('id', user.id);

    // Update streak using database function (if practice mode)
    if (testType === 'practice') {
      await supabase.rpc('update_practice_streak', { p_user_id: user.id });
    }

    // Check and award achievements
    await checkAndAwardAchievements(supabase, user.id, test, percentage);

    return Response.json({
      success: true,
      testId: test.id,
      percentage,
      xpEarned,
    });
  } catch (error) {
    console.error('Error submitting test:', error);
    return Response.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}

async function checkAndAwardAchievements(
  supabase: any,
  userId: string,
  test: any,
  percentage: number
) {
  // Get user's current achievements
  const { data: userAchievements } = await supabase
    .from('user_achievements')
    .select('achievement_id')
    .eq('user_id', userId);

  const earnedIds = new Set(userAchievements?.map((ua: any) => ua.achievement_id) || []);

  // Get all achievements
  const { data: achievements } = await supabase
    .from('achievements')
    .select('*');

  if (!achievements) return;

  // Get user stats
  const { data: userData } = await supabase
    .from('users')
    .select('*')
    .eq('id', userId)
    .single();

  const { count: totalTests } = await supabase
    .from('tests')
    .select('*', { count: 'exact', head: true })
    .eq('user_id', userId);

  const { count: perfectScores } = await supabase
    .from('tests')
    .select('*', { count: 'exact', head: true })
    .eq('user_id', userId)
    .eq('percentage', 100);

  // Check each achievement
  for (const achievement of achievements) {
    if (earnedIds.has(achievement.id)) continue;

    let earned = false;

    switch (achievement.achievement_type) {
      case 'first_test':
        earned = totalTests >= 1;
        break;
      case 'perfect_score':
        earned = percentage === 100;
        break;
      case 'streak':
        earned = userData?.practice_streak >= achievement.requirement;
        break;
      case 'tests_completed':
        earned = totalTests >= achievement.requirement;
        break;
      case 'course_mastery':
        // Check if user has avg >= 90% in a course with at least 5 tests
        const { data: courseTests } = await supabase
          .from('tests')
          .select('percentage')
          .eq('user_id', userId)
          .eq('course_id', test.course_id);
        
        if (courseTests && courseTests.length >= 5) {
          const avg = courseTests.reduce((acc: number, t: any) => acc + t.percentage, 0) / courseTests.length;
          earned = avg >= 90;
        }
        break;
    }

    if (earned) {
      await supabase
        .from('user_achievements')
        .insert({
          user_id: userId,
          achievement_id: achievement.id,
        });
    }
  }
}
