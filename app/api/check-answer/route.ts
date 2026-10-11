import OpenAI from 'openai';
import { withOpenAIRetry } from '@/lib/openaiRetry';
import { logAiUsage } from '@/lib/aiUsage';
import { requireUser } from '@/lib/apiAuth';

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

    if (!studentAnswer || !correctAnswer) {
      return Response.json({ isCorrect: false });
    }

    // Fast exact/normalised check first — skip AI cost if obviously correct
    const norm = (s: string) => s.trim().toLowerCase().replace(/\s+/g, ' ');
    if (norm(studentAnswer) === norm(correctAnswer)) {
      return Response.json({ isCorrect: true });
    }

    if (!process.env.OPENAI_API_KEY) {
      // Fallback to normalised string compare if no API key
      return Response.json({ isCorrect: norm(studentAnswer) === norm(correctAnswer) });
    }

    const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

    const completion = await withOpenAIRetry(() => openai.chat.completions.create({
      model: 'gpt-4o-mini',
      messages: [
        {
          role: 'user',
          content: `You are grading a university fill-in-the-blank answer.

Question: "${questionText}"
Correct answer: "${correctAnswer}"
Student's answer: "${studentAnswer}"

Mark as correct if:
- Same meaning/concept even with different wording
- Common abbreviation of the correct answer (e.g. "CPU" = "Central Processing Unit")
- Minor spelling error on a clearly identifiable term
- Different casing or extra spaces

Mark as incorrect if:
- Completely different concept
- Too vague or incomplete to confirm the right answer

Respond with ONLY valid JSON: {"isCorrect": true} or {"isCorrect": false}`,
        },
      ],
      response_format: { type: 'json_object' },
      max_tokens: 20,
      temperature: 0,
    }));

    logAiUsage('check_answer', 'gpt-4o-mini', completion.usage, auth.userId).catch(() => {});

    const result = JSON.parse(completion.choices[0].message.content || '{}');
    return Response.json({ isCorrect: result.isCorrect === true });
  } catch (err) {
    console.error('check-answer error:', err);
    return Response.json({ isCorrect: false });
  }
}
