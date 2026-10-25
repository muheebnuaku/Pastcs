import OpenAI from 'openai';
import { withOpenAIRetry } from '@/lib/openaiRetry';
import { logAiUsage } from '@/lib/aiUsage';

// Fill-in-the-blank marking, shared by /api/check-answer (the instant
// "Check" in practice) and /api/tests/submit (the saved score). Server
// only — it uses the OpenAI key.

export const normAnswer = (s: string) => s.trim().toLowerCase().replace(/\s+/g, ' ');

/** True when the student's typed answer means the same as the correct one. */
export async function fillAnswerCorrect(
  questionText: string,
  correctAnswer: string,
  studentAnswer: string,
  userId: string
): Promise<boolean> {
  if (!studentAnswer || !correctAnswer) return false;
  // Fast exact/normalised check first — skip AI cost if obviously correct
  if (normAnswer(studentAnswer) === normAnswer(correctAnswer)) return true;
  // Fallback to normalised string compare if no API key
  if (!process.env.OPENAI_API_KEY) return false;

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

  logAiUsage('check_answer', 'gpt-4o-mini', completion.usage, userId).catch(() => {});

  const result = JSON.parse(completion.choices[0].message.content || '{}');
  return result.isCorrect === true;
}
