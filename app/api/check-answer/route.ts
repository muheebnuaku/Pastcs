import { requireUser } from '@/lib/apiAuth';
import { fillAnswerCorrect } from '@/lib/checkAnswer';

export async function POST(request: Request) {
  try {
    const auth = await requireUser();
    if (auth instanceof Response) return auth;

    const body = await request.json() as {
      studentAnswer?: unknown;
      correctAnswer?: unknown;
      questionText?: unknown;
    };
    const studentAnswer = typeof body.studentAnswer === 'string' ? body.studentAnswer.slice(0, 500) : '';
    const correctAnswer = typeof body.correctAnswer === 'string' ? body.correctAnswer.slice(0, 500) : '';
    const questionText = typeof body.questionText === 'string' ? body.questionText.slice(0, 2000) : '';

    return Response.json({ isCorrect: await fillAnswerCorrect(questionText, correctAnswer, studentAnswer, auth.userId) });
  } catch (err) {
    console.error('check-answer error:', err);
    return Response.json({ isCorrect: false });
  }
}
