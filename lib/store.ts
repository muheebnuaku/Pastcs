import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { User, Course, Question, Test, ExamState, Subscription } from '@/types';

// Auth Store
interface AuthState {
  user: User | null;
  isLoading: boolean;
  setUser: (user: User | null) => void;
  setLoading: (loading: boolean) => void;
}

export const useAuthStore = create<AuthState>((set) => ({
  user: null,
  isLoading: true,
  setUser: (user) => set({ user }),
  setLoading: (isLoading) => set({ isLoading }),
}));

// Exam Store
interface ExamStore {
  examState: ExamState | null;
  initExam: (questions: Question[], duration: number) => void;
  setAnswer: (questionId: string, answer: string[]) => void;
  goToQuestion: (index: number) => void;
  nextQuestion: () => void;
  prevQuestion: () => void;
  decrementTime: () => void;
  submitExam: () => void;
  resetExam: () => void;
}

export const useExamStore = create<ExamStore>((set) => ({
  examState: null,
  
  initExam: (questions, duration) => set({
    examState: {
      questions,
      currentIndex: 0,
      answers: {},
      timeRemaining: duration,
      isSubmitted: false,
    }
  }),
  
  setAnswer: (questionId, answer) => set((state) => {
    if (!state.examState) return state;
    return {
      examState: {
        ...state.examState,
        answers: {
          ...state.examState.answers,
          [questionId]: answer,
        },
      },
    };
  }),
  
  goToQuestion: (index) => set((state) => {
    if (!state.examState) return state;
    return {
      examState: {
        ...state.examState,
        currentIndex: Math.max(0, Math.min(index, state.examState.questions.length - 1)),
      },
    };
  }),
  
  nextQuestion: () => set((state) => {
    if (!state.examState) return state;
    const newIndex = Math.min(state.examState.currentIndex + 1, state.examState.questions.length - 1);
    return {
      examState: {
        ...state.examState,
        currentIndex: newIndex,
      },
    };
  }),
  
  prevQuestion: () => set((state) => {
    if (!state.examState) return state;
    const newIndex = Math.max(state.examState.currentIndex - 1, 0);
    return {
      examState: {
        ...state.examState,
        currentIndex: newIndex,
      },
    };
  }),
  
  decrementTime: () => set((state) => {
    if (!state.examState || state.examState.isSubmitted) return state;
    const newTime = Math.max(0, state.examState.timeRemaining - 1);
    return {
      examState: {
        ...state.examState,
        timeRemaining: newTime,
      },
    };
  }),
  
  submitExam: () => set((state) => {
    if (!state.examState) return state;
    return {
      examState: {
        ...state.examState,
        isSubmitted: true,
      },
    };
  }),
  
  resetExam: () => set({ examState: null }),
}));

// Course Store for caching
interface CourseStore {
  courses: Course[];
  setCourses: (courses: Course[]) => void;
  getCourse: (id: string) => Course | undefined;
}

export const useCourseStore = create<CourseStore>((set, get) => ({
  courses: [],
  setCourses: (courses) => set({ courses }),
  getCourse: (id) => get().courses.find(c => c.id === id),
}));

// Test History Store (persisted)
interface TestHistoryStore {
  recentTests: Test[];
  addTest: (test: Test) => void;
  clearHistory: () => void;
}

export const useTestHistoryStore = create<TestHistoryStore>()(
  persist(
    (set) => ({
      recentTests: [],
      addTest: (test) => set((state) => ({
        recentTests: [test, ...state.recentTests].slice(0, 10),
      })),
      clearHistory: () => set({ recentTests: [] }),
    }),
    {
      name: 'test-history',
    }
  )
);

// Subscription Store
interface SubscriptionStore {
  subscriptions: Subscription[];
  setSubscriptions: (subs: Subscription[]) => void;
  addSubscription: (sub: Subscription) => void;
  hasActiveSub: (level: number | null | undefined, semester: number | null | undefined) => boolean;
}

export const useSubscriptionStore = create<SubscriptionStore>((set, get) => ({
  subscriptions: [],
  setSubscriptions: (subscriptions) => set({ subscriptions }),
  addSubscription: (sub) => set((state) => ({
    subscriptions: [...state.subscriptions, sub],
  })),
  hasActiveSub: (level, semester) => {
    if (!level || !semester) return false;
    return get().subscriptions.some(
      (s) => s.level === level && s.semester === semester && s.status === 'active'
    );
  },
}));
