import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
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
export const QUESTIONS_PER_EXAM = 40;
export const QUESTIONS_PER_PRACTICE = 10;

export const QUESTION_TYPE_LABELS: Record<string, string> = {
  single_choice: 'Single Choice',
  multiple_choice: 'Multiple Choice',
  fill_in_blank: 'Fill in the Blank',
};
