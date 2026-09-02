import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

// Course codes with a space (e.g. "STAT 112") get percent-encoded by the
// browser when navigated to (/courses/stat%20112). useParams() has been
// observed returning that segment still encoded rather than decoded, so
// a raw "%20" ends up baked into course_code queries and gets encoded a
// second time on the wire (course_code=ilike.STAT%2520112) — never
// matching anything. Decode defensively; a plain code with no encoded
// characters passes through decodeURIComponent unchanged.
export function decodeRouteParam(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

// For very large documents (slides, lecture notes), sample intelligently
// instead of silently truncating: keep the start, middle, and end so the
// model sees how the material opens, develops, and concludes rather than
// just its first few pages. Shared by every AI feature that reads an
// uploaded document (question generation, lesson generation).
export function sampleContent(text: string, maxChars: number): string {
  if (text.length <= maxChars) return text;
  const third = Math.floor(maxChars / 3);
  const start  = text.slice(0, third);
  const mid    = text.slice(Math.floor(text.length / 2) - Math.floor(third / 2), Math.floor(text.length / 2) + Math.floor(third / 2));
  const end    = text.slice(-third);
  return `${start}\n\n[...middle section omitted — document continues...]\n\n${mid}\n\n[...more omitted — this is the end of the document...]\n\n${end}`;
}

export function formatDate(date: string | Date): string {
  return new Intl.DateTimeFormat('en-US', {
    dateStyle: 'medium',
  }).format(new Date(date));
}

export function formatTime(seconds: number): string {
  const mins = Math.floor(seconds / 60);
  const secs = seconds % 60;
  return `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
}

export function formatPercentage(value: number): string {
  return `${value.toFixed(1)}%`;
}

export function getGradeColor(percentage: number): string {
  if (percentage >= 80) return 'text-green-600';
  if (percentage >= 60) return 'text-yellow-600';
  if (percentage >= 40) return 'text-orange-600';
  return 'text-red-600';
}

export function getGradeBadgeColor(percentage: number): string {
  if (percentage >= 80) return 'bg-green-100 text-green-800';
  if (percentage >= 60) return 'bg-yellow-100 text-yellow-800';
  if (percentage >= 40) return 'bg-orange-100 text-orange-800';
  return 'bg-red-100 text-red-800';
}

export function shuffleArray<T>(array: T[]): T[] {
  const shuffled = [...array];
  for (let i = shuffled.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
  }
  return shuffled;
}

export function generateId(): string {
  return Math.random().toString(36).substring(2, 9);
}

export function truncateText(text: string, maxLength: number): string {
  if (text.length <= maxLength) return text;
  return text.slice(0, maxLength) + '...';
}

export function calculateAccuracy(correct: number, total: number): number {
  if (total === 0) return 0;
  return (correct / total) * 100;
}

export function getStreakMessage(streak: number): string {
  if (streak === 0) return 'Start your practice streak today!';
  if (streak === 1) return 'Great start! Keep it up!';
  if (streak < 7) return `${streak} day streak! You're building momentum!`;
  if (streak < 30) return `${streak} day streak! You're on fire! 🔥`;
  return `${streak} day streak! Unstoppable! 🏆`;
}

// Picks the same option all day (so the message doesn't change on every
// re-render/refetch) but a different one from day to day — a small hash
// of today's date plus a seed string, not real randomness.
function pickForToday<T>(options: T[], seed: string): T {
  const key = new Date().toDateString() + seed;
  let hash = 0;
  for (let i = 0; i < key.length; i++) hash = (hash * 31 + key.charCodeAt(i)) >>> 0;
  return options[hash % options.length];
}

export type ExamUrgency = 'calm' | 'steady' | 'focused' | 'urgent' | 'today' | 'passed' | 'unset';

export interface ExamMotivation {
  text: string;
  urgency: ExamUrgency;
}

// Powers the dashboard's Exam Countdown card — the message escalates in
// urgency as the exam gets closer, and varies day to day within each
// tier rather than repeating the same line every visit.
export function getExamMotivation(daysUntilExam: number | null): ExamMotivation {
  if (daysUntilExam === null) {
    return { text: 'Set your exam date to get a personalised countdown and study plan.', urgency: 'unset' };
  }
  if (daysUntilExam < 0) {
    return { text: 'That exam date has passed — update it to keep your countdown and focus list accurate.', urgency: 'passed' };
  }
  if (daysUntilExam === 0) {
    return {
      urgency: 'today',
      text: pickForToday([
        "Today's the day. Trust the work you've put in — a light review beats last-minute cramming.",
        "It's exam day. Stay calm, breathe, and focus on what you already know.",
        "This is it — you've prepared for this. Go show what you know.",
      ], 'today'),
    };
  }
  const s = daysUntilExam === 1 ? '' : 's';
  if (daysUntilExam <= 3) {
    return {
      urgency: 'urgent',
      text: pickForToday([
        `${daysUntilExam} day${s} left — this is crunch time. Stick to your weakest topics, not new material.`,
        `Only ${daysUntilExam} day${s} to go. Short, focused sessions on your weak spots help more than long ones now.`,
        `${daysUntilExam} day${s} left. Review, don't relearn — you know more than you think.`,
      ], 'urgent'),
    };
  }
  if (daysUntilExam <= 7) {
    return {
      urgency: 'focused',
      text: pickForToday([
        `One week to go — a focused 20-minute session each day on your weak topics adds up fast.`,
        `${daysUntilExam} days left — enough time to turn a weak topic into a strength if you start now.`,
        `${daysUntilExam} days to go. Consistency this week matters more than intensity.`,
      ], 'week'),
    };
  }
  if (daysUntilExam <= 21) {
    return {
      urgency: 'steady',
      text: pickForToday([
        `${daysUntilExam} days left — plenty of time to close the gaps in your weak topics.`,
        `Steady pace: ${daysUntilExam} days to go. A little practice most days beats a lot right before the exam.`,
        `${daysUntilExam} days out — good time to work through your whole weak-topics list, not just the top ones.`,
      ], 'steady'),
    };
  }
  return {
    urgency: 'calm',
    text: pickForToday([
      `${daysUntilExam} days until your exam — plenty of runway. Build the habit now so the final stretch is easier.`,
      `${daysUntilExam} days to go. This is the best time to fix weak topics — no pressure yet, just progress.`,
      `${daysUntilExam} days left. Small, regular practice now means less to cram later.`,
    ], 'calm'),
  };
}

// A one-line read on where the student actually stands, computed from
// tests taken in their current level/semester — the concrete "how am I
// doing" signal that sits next to the countdown's "how urgent is this".
export function getPerformanceNote(avgScore: number, totalTests: number): string {
  if (totalTests === 0) return "No tests taken yet in your current courses — practise a topic to get a personalised focus list.";
  const pct = Math.round(avgScore);
  if (avgScore >= 80) return `Averaging ${pct}% across ${totalTests} test${totalTests === 1 ? '' : 's'} — you're in great shape.`;
  if (avgScore >= 60) return `Averaging ${pct}% across ${totalTests} test${totalTests === 1 ? '' : 's'} — solid, but tighten up the topics below.`;
  return `Averaging ${pct}% across ${totalTests} test${totalTests === 1 ? '' : 's'} — focus on the topics below before new material.`;
}

export function getDifficultyColor(difficulty: string): string {
  switch (difficulty) {
    case 'easy':
      return 'bg-green-100 text-green-800';
    case 'medium':
      return 'bg-yellow-100 text-yellow-800';
    case 'hard':
      return 'bg-red-100 text-red-800';
    default:
      return 'bg-gray-100 text-gray-800';
  }
}

export const COURSE_ICONS: Record<string, string> = {
  DCIT101: '💻',
  DCIT103: '📊',
  DCIT105: '🔢',
  ECON101: '📈',
  STAT111: '📉',
  UGRC150: '🧠',
};

export const EXAM_DURATION_MINUTES = 60;
export const QUESTIONS_PER_EXAM = 50;
export const QUESTIONS_PER_PRACTICE = 30;

export const QUESTION_TYPE_LABELS: Record<string, string> = {
  single_choice: 'Single Choice',
  multiple_choice: 'Multiple Choice',
  fill_in_blank: 'Fill in the Blank',
};
