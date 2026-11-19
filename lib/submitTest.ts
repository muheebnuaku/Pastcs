'use client';

// Sends a finished practice session or mock exam to /api/tests/submit,
// which marks it, saves it and awards XP (migration 034).

export interface TestSubmission {
  courseId: string;
  topicId: string | null;
  testType: 'practice' | 'exam_simulation' | 'climb';
  answers: { question_id: string; selected: string[]; confidence?: 'sure' | 'unsure' | null }[];
  timeTaken?: number | null;
}

export interface TestResult {
  testId: string;
  score: number;
  total: number;
  marks: { question_id: string; is_correct: boolean }[];
}

export async function submitTest(submission: TestSubmission): Promise<TestResult> {
  const res = await fetch('/api/tests/submit', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(submission),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || !data.testId) {
    // No JSON back means the server gave up before answering (a timeout).
    const fallback = res.status === 504 || res.status === 502
      ? 'Saving took too long. Your answers are still here: tap Finish again.'
      : `Could not save your results (error ${res.status}). Your answers are still here: please try again.`;
    throw new Error(data.error || fallback);
  }
  return data as TestResult;
}
