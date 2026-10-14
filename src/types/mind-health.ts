// ─── Mind Health JSON types ─────────────────────────────────────────

export interface MindHealthMeta {
  date: string; // ISO date, e.g. "2026-06-09"
  day_of_week: string;
  week_number: number;
  focus_category: string;
  memory_technique: string;
  is_weekly_benchmark: boolean;
}

export interface MindHealthTechnique {
  name: string;
  what_it_is: string;
  how_to_use_today: string;
  science: string;
}

export interface MindHealthExercise {
  type: string;
  category: string;
  instruction: string;
  items?: string[];
  answers?: string[];
  data?: Record<string, unknown>;
  problems?: MindHealthProblem[];
  questions?: string[];
  scoring: string;
  sample_answers?: string[];
  pattern_explanation?: string;
  grid?: string[][];
}

export interface MindHealthProblem {
  id?: string;
  question?: string;
  input?: string;
  answer?: string | number;
  steps?: string[];
  options?: string[];
  [key: string]: unknown;
}

export interface MindHealthDeepSet {
  description: string;
  tracking_note: string;
  focus_category: string;
  total_scoring: string;
  technique: MindHealthTechnique;
  arithmetic_block?: MindHealthArithmeticBlock;
  exercises: MindHealthExercise[];
  challenge_exercise: MindHealthExercise;
}

export interface MindHealthQuickSet {
  description: string;
  tracking_note?: string;
  total_scoring: string;
  exercises?: MindHealthExercise[];
}

export interface MindHealthProgressTracking {
  what_to_record: string[];
  comparison_rule: string;
  weekly_benchmark: string;
}

export interface MindHealthArithmeticBlock {
  instruction: string;
  time_target: string;
  items: string[];
  answers: number[];
  scoring: string;
}

export interface MindHealthData {
  meta: MindHealthMeta;
  quick_set: MindHealthQuickSet;
  deep_set: MindHealthDeepSet;
  progress_tracking: MindHealthProgressTracking;
}

// ─── API response shapes ────────────────────────────────────────────

export interface MindHealthResponse {
  data: MindHealthData | null;
  availableDates: string[]; // ISO date strings for calendar
  currentDate: string;
  role: "GUEST" | "STUDENT" | "EVENT_ORGANIZER" | "TEAM_MEMBER" | "INSTRUCTOR" | "ADMIN";
  canManage: boolean;
}

export type MindHealthUserRole =
  | "GUEST"
  | "STUDENT"
  | "EVENT_ORGANIZER"
  | "TEAM_MEMBER"
  | "INSTRUCTOR"
  | "ADMIN";
