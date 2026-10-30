// Exam Boss (migration 043): types, messages, sharing, sound and buzz.
// The server runs every fight; this file only describes what it sends.

import { whatsappShareUrl } from '@/lib/share';

export type FightStatus = 'live' | 'won' | 'lost' | 'abandoned';

export interface BossQuestion {
  idx: number;
  type: 'single_choice' | 'multiple_choice';
  /** When its clock starts. Text and options are null until then. */
  starts_at: string;
  text: string | null;
  options: { id: string; text: string }[] | null;
  deadline: string;
  countdown: number;
}

export interface BossLastAnswer {
  idx: number;
  correct: boolean;
  timed_out: boolean;
  damage: number;
  selected: string[] | null;
  correct_answers: string[];
  explanation: string | null;
}

export interface BossFight {
  id: string;
  status: FightStatus;
  course_id: string;
  course_code: string;
  topic_id: string | null;
  is_daily: boolean;
  level: number;
  boss_name: string;
  hearts: number;
  boss_hp: number;
  boss_max_hp: number;
  streak: number;
  power: boolean;
  enraged: boolean;
  xp: number;
  time_ms: number | null;
  server_now: string;
  answered: number;
  right: number;
  rating: number | null;
  question: BossQuestion | null;
  last: BossLastAnswer | null;
}

export interface BossTrophy {
  topic_id: string | null;
  topic_name: string | null;
  gold: boolean;
  best_time_ms: number | null;
}

export interface BossHome {
  access: 'ok' | 'locked';
  free?: boolean;
  rating?: number;
  level?: number;
  boss_name?: string;
  next_level_at?: number | null;
  best_level?: number;
  wins?: number;
  fights_today?: number;
  free_limit?: number | null;
  pool?: number;
  daily?: { status: FightStatus | 'open'; time_ms: number | null; fight_id: string | null };
  trophies?: BossTrophy[];
}

export interface DailyBoardRow {
  rank: number;
  user_id: string;
  first_name: string;
  avatar_url: string | null;
  time_ms: number;
  hearts: number;
  is_me: boolean;
}

export const BOSS_HEARTS = 3;
export const FREE_FIGHTS_PER_DAY = 3;
export const FIGHTS_BEFORE_BREAK = 5;

const ERRORS: Record<string, string> = {
  free_limit_fights: `You’ve had your ${FREE_FIGHTS_PER_DAY} free fights today. Unlock all courses for unlimited fights, or come back tomorrow.`,
  daily_paid_only: 'The Daily Boss is for students who’ve unlocked all courses.',
  daily_done: 'You’ve already fought today’s Daily Boss. A new one arrives tomorrow.',
  topic_locked: 'That topic is locked on your free course. Unlock all courses to fight it.',
  not_enough_questions: 'There aren’t enough multiple choice questions here for a fight yet. Try the whole course instead.',
  payment_required: 'Unlock this course to fight its boss.',
  bad_topic: 'That topic isn’t part of this course.',
  not_found: 'That fight isn’t yours, or it no longer exists.',
};

export function bossErrorMessage(error: { message?: string } | null | undefined): string {
  const msg = error?.message ?? '';
  const known = Object.keys(ERRORS).find(k => msg.includes(k));
  return known ? ERRORS[known] : 'Something went wrong. Please try again.';
}

export function formatFightTime(ms: number | null | undefined): string {
  if (!ms && ms !== 0) return '—';
  const s = Math.round(ms / 1000);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

export function bossShareUrl(f: Pick<BossFight, 'boss_name' | 'level' | 'course_code' | 'time_ms' | 'hearts' | 'is_daily'>): string {
  const flawless = f.hearts === BOSS_HEARTS ? ' without losing a heart' : '';
  const what = f.is_daily ? `today’s ${f.course_code} Daily Boss` : `${f.boss_name} (level ${f.level}) in ${f.course_code}`;
  const origin = typeof window !== 'undefined' ? window.location.origin : 'https://www.pastcs.com';
  const text = `I knocked out ${what} on PastCS in ${formatFightTime(f.time_ms)}${flawless}. Think you can beat it? ${origin}/boss`;
  return whatsappShareUrl(text);
}

// ── Sound ────────────────────────────────────────────────────────────
// Little synthesised blips, so there are no audio files to load. On by
// default; the mute choice is kept on this phone.

const MUTE_KEY = 'pastcs_boss_muted';

export function isBossMuted(): boolean {
  try { return localStorage.getItem(MUTE_KEY) === '1'; } catch { return false; }
}

export function setBossMuted(muted: boolean) {
  try { localStorage.setItem(MUTE_KEY, muted ? '1' : '0'); } catch { /* private mode */ }
}

let audio: AudioContext | null = null;

function ctx(): AudioContext | null {
  if (typeof window === 'undefined') return null;
  const Ctor = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!Ctor) return null;
  if (!audio) {
    try { audio = new Ctor(); } catch { return null; }
  }
  if (audio.state === 'suspended') audio.resume().catch(() => {});
  return audio;
}

function tone(freq: number, start: number, length: number, type: OscillatorType = 'square', volume = 0.06, slideTo?: number) {
  const ac = ctx();
  if (!ac) return;
  const t = ac.currentTime + start;
  const osc = ac.createOscillator();
  const gain = ac.createGain();
  osc.type = type;
  osc.frequency.setValueAtTime(freq, t);
  if (slideTo) osc.frequency.exponentialRampToValueAtTime(slideTo, t + length);
  gain.gain.setValueAtTime(volume, t);
  gain.gain.exponentialRampToValueAtTime(0.0001, t + length);
  osc.connect(gain).connect(ac.destination);
  osc.start(t);
  osc.stop(t + length + 0.02);
}

export type BossSound = 'hit' | 'power' | 'hurt' | 'tick' | 'win' | 'lose' | 'start' | 'rage' | 'shoot' | 'shootPower';

export function playBossSound(kind: BossSound) {
  if (isBossMuted()) return;
  switch (kind) {
    case 'hit': tone(520, 0, 0.08); tone(780, 0.07, 0.12); tone(160, 0, 0.18, 'sine', 0.12, 50); break;
    case 'shoot': tone(300, 0, 0.22, 'sawtooth', 0.035, 1400); break;
    case 'shootPower': tone(200, 0, 0.26, 'sawtooth', 0.05, 1800); tone(400, 0.02, 0.24, 'square', 0.03, 2400); break;
    case 'power': tone(330, 0, 0.1, 'sawtooth'); tone(660, 0.08, 0.1, 'sawtooth'); tone(990, 0.16, 0.22, 'sawtooth'); break;
    case 'hurt': tone(220, 0, 0.3, 'sawtooth', 0.08, 70); break;
    case 'tick': tone(1000, 0, 0.04, 'sine', 0.04); break;
    case 'start': tone(392, 0, 0.1); tone(523, 0.1, 0.1); tone(659, 0.2, 0.18); break;
    case 'rage': tone(140, 0, 0.45, 'sawtooth', 0.07, 90); break;
    case 'win': [523, 659, 784, 1047].forEach((f, i) => tone(f, i * 0.12, 0.2, 'triangle', 0.08)); break;
    case 'lose': [392, 330, 262, 196].forEach((f, i) => tone(f, i * 0.16, 0.24, 'triangle', 0.07)); break;
  }
}

export function buzz(pattern: number | number[]) {
  if (isBossMuted()) return;
  try { navigator.vibrate?.(pattern); } catch { /* not supported */ }
}

// ── Background music ─────────────────────────────────────────────────
// A small chiptune loop, played by a look-ahead scheduler: bass, an
// arpeggio, kick and a noise snare. When the boss is enraged it speeds
// up and moves to darker chords. Off when muted, or when music is
// switched off (kept on this phone).

const MUSIC_KEY = 'pastcs_boss_music_off';

export function isBossMusicOff(): boolean {
  try { return localStorage.getItem(MUSIC_KEY) === '1'; } catch { return false; }
}

export function setBossMusicOff(off: boolean) {
  try { localStorage.setItem(MUSIC_KEY, off ? '1' : '0'); } catch { /* private mode */ }
}

const midi = (n: number) => 440 * Math.pow(2, (n - 69) / 12);
// Four bars each: a bass root and a chord to arpeggiate.
const CALM = { bpm: 116, bass: [45, 41, 48, 43], chords: [[57, 60, 64], [53, 57, 60], [60, 64, 67], [55, 59, 62]], wave: 'triangle' as OscillatorType };
const RAGE = { bpm: 148, bass: [45, 46, 45, 40], chords: [[57, 60, 64], [58, 62, 65], [57, 60, 64], [52, 56, 59]], wave: 'sawtooth' as OscillatorType };

interface Music { timer: number; step: number; next: number; out: GainNode; rage: boolean; noise: AudioBuffer }
let music: Music | null = null;

function note(ac: AudioContext, out: AudioNode, freq: number, t: number, len: number, type: OscillatorType, vol: number, slideTo?: number) {
  const osc = ac.createOscillator();
  const g = ac.createGain();
  osc.type = type;
  osc.frequency.setValueAtTime(freq, t);
  if (slideTo) osc.frequency.exponentialRampToValueAtTime(slideTo, t + len);
  g.gain.setValueAtTime(vol, t);
  g.gain.exponentialRampToValueAtTime(0.0001, t + len);
  osc.connect(g).connect(out);
  osc.start(t);
  osc.stop(t + len + 0.02);
}

function playStep(ac: AudioContext, m: Music, step: number, t: number) {
  const song = m.rage ? RAGE : CALM;
  const bar = Math.floor(step / 16) % 4;
  const s = step % 16;
  const sixteenth = 60 / song.bpm / 4;
  // Bass on the beat, octave bounce on the off-beat.
  if (s % 4 === 0) note(ac, m.out, midi(song.bass[bar]), t, sixteenth * 3, song.wave, 0.09);
  if (s % 4 === 2) note(ac, m.out, midi(song.bass[bar] + 12), t, sixteenth * 1.5, song.wave, 0.05);
  // Arpeggio in eighths.
  if (s % 2 === 0) {
    const chord = song.chords[bar];
    note(ac, m.out, midi(chord[(s / 2) % chord.length] + 12), t, sixteenth * 1.6, 'square', 0.022);
  }
  // Kick, and a noise snare on 2 and 4.
  if (s === 0 || s === 8 || (m.rage && s % 4 === 0)) note(ac, m.out, 130, t, 0.14, 'sine', 0.22, 40);
  if (s === 4 || s === 12) {
    const src = ac.createBufferSource();
    const g = ac.createGain();
    src.buffer = m.noise;
    g.gain.setValueAtTime(0.06, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.12);
    src.connect(g).connect(m.out);
    src.start(t);
    src.stop(t + 0.13);
  }
}

export function startBossMusic(rage = false) {
  if (music || isBossMuted() || isBossMusicOff()) { if (music) music.rage = rage; return; }
  const ac = ctx();
  if (!ac) return;
  const out = ac.createGain();
  out.gain.setValueAtTime(0.0001, ac.currentTime);
  out.gain.exponentialRampToValueAtTime(0.5, ac.currentTime + 0.6);
  out.connect(ac.destination);
  const noise = ac.createBuffer(1, Math.floor(ac.sampleRate * 0.15), ac.sampleRate);
  const data = noise.getChannelData(0);
  for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
  const m: Music = { timer: 0, step: 0, next: ac.currentTime + 0.05, out, rage, noise };
  m.timer = window.setInterval(() => {
    if (ac.state !== 'running') { m.next = ac.currentTime + 0.05; return; }
    while (m.next < ac.currentTime + 0.15) {
      playStep(ac, m, m.step, m.next);
      m.next += 60 / (m.rage ? RAGE : CALM).bpm / 4;
      m.step = (m.step + 1) % 64;
    }
  }, 40);
  music = m;
}

export function setBossMusicRage(rage: boolean) {
  if (music) music.rage = rage;
}

export function stopBossMusic() {
  if (!music) return;
  const m = music;
  music = null;
  window.clearInterval(m.timer);
  const ac = ctx();
  if (!ac) return;
  m.out.gain.cancelScheduledValues(ac.currentTime);
  m.out.gain.setValueAtTime(m.out.gain.value, ac.currentTime);
  m.out.gain.exponentialRampToValueAtTime(0.0001, ac.currentTime + 0.4);
  window.setTimeout(() => m.out.disconnect(), 500);
}
