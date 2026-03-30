export type AnswerType =
  | "set"
  | "exact_match"
  | "boolean"
  | "number"
  | "free_text";

export type EvalQuestion = {
  id: string;
  category: string;
  question: string;
  answer_type: AnswerType;
  expected_answer: string | string[] | boolean | number;
  acceptable_aliases?: Record<string, string[]>;
  acceptable_answers?: string[];
  scoring: string;
  scoring_rubric?: Record<string, string>;
  reasoning: string;
};

export type ScoreResult = {
  score: number;
  details: Record<string, unknown>;
};

export type ToolStats = {
  search_calls: number;
  get_image_calls: number;
};

export type EvalResult = {
  id: string;
  category: string;
  question: string;
  expected: EvalQuestion["expected_answer"];
  actual: unknown;
  score: number;
  details: Record<string, unknown>;
  tool_stats?: ToolStats;
};

export type EvalSummary = {
  total_questions: number;
  overall_score: number;
  by_category: Record<string, number>;
  results: EvalResult[];
};
