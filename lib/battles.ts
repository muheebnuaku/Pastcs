// Class battles (supabase/migrations/034_classroom_battles.sql).

export type BattlePhase = 'lobby' | 'countdown' | 'question' | 'reveal' | 'finished' | 'cancelled';

export interface BattlePlayer {
  user_id: string;
  full_name: string | null;
  avatar_url: string | null;
  is_me: boolean;
  score: number;
  correct: number;
  rank: number | null;
  /** Points from the question just revealed (null while it's open). */
  last_points: number | null;
  /** Locked in an answer for the open question (never says if it's right). */
  answered_current: boolean;
}

export interface BattleQuestion {
  idx: number;
  type: 'single_choice' | 'multiple_choice';
  text: string;
  options: { id: string; text: string }[];
  /** Only once the question has closed. */
  correct_answers: string[] | null;
  explanation: string | null;
}

export interface BattleState {
  id: string;
  classroom_id: string;
  host_id: string;
  status: 'lobby' | 'live' | 'finished' | 'cancelled';
  phase: BattlePhase;
  idx: number;
  phase_ends_at: string | null;
  server_now: string;
  started_at: string | null;
  created_at: string;
  question_count: number;
  seconds_per_question: number;
  reveal_seconds: number;
  am_player: boolean;
  topics: string[];
  players: BattlePlayer[];
  question?: BattleQuestion;
  my_answer?: { selected: string[]; is_correct: boolean | null; points: number | null } | null;
}

export interface BattleSummary {
  id: string;
  status: 'lobby' | 'live' | 'finished';
  host_id: string;
  host_name: string | null;
  players: number;
  question_count: number;
  created_at: string;
  winner_name: string | null;
  my_rank: number | null;
  my_score: number | null;
}

export const battlePath = (classroomId: string, battleId: string) => `/classrooms/${classroomId}/battles/${battleId}`;

const ERRORS: Record<string, string> = {
  battle_in_progress: 'There’s already a battle open in this classroom. Join that one first.',
  not_enough_questions: 'Not enough questions in those topics for a battle yet. Pick more topics, or leave them all unticked.',
  bad_topic: 'One of those topics isn’t part of this course.',
  slow_down: 'You’ve started a lot of battles this hour. Try again a bit later.',
  payment_required: 'Unlock this course to play battles in it.',
  battle_started: 'This battle has already started.',
  battle_full: 'This battle is full (50 players).',
  need_two_players: 'You need at least one classmate in the lobby to start.',
  not_allowed: 'Only the person who opened the battle, or a class leader, can do that.',
  question_closed: 'Too late — that question has closed.',
  already_answered: 'You’ve already locked in an answer.',
  not_in_battle: 'You’re watching this battle, not playing in it.',
  not_a_member: 'You’re not a member of this classroom.',
};

export function battleErrorMessage(error: { message?: string } | null | undefined): string {
  const msg = error?.message ?? '';
  const known = Object.keys(ERRORS).find(k => msg.includes(k));
  return known ? ERRORS[known] : 'Something went wrong. Please try again.';
}

export function ordinal(n: number): string {
  const s = ['th', 'st', 'nd', 'rd'];
  const v = n % 100;
  return n + (s[(v - 20) % 10] || s[v] || s[0]);
}

export function battleShareUrl(opts: { rank: number | null; players: number; correct: number; total: number; score: number; room: string; courseCode?: string }): string {
  const place = opts.rank ? `came ${ordinal(opts.rank)} of ${opts.players}` : 'took part';
  const text = `I ${place} in a ${opts.courseCode ? `${opts.courseCode} ` : ''}class battle in "${opts.room}" on PastCS: ${opts.correct}/${opts.total} correct, ${opts.score.toLocaleString('en-GB')} points. Think you can beat me? ${typeof window !== 'undefined' ? window.location.origin : 'https://www.pastcs.com'}/classrooms`;
  return `https://wa.me/?text=${encodeURIComponent(text)}`;
}
