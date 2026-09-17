// TypeSafe System One API shapes (https://docs.typesafe.ai/api).
// state: string | object | array. Question IDs are caller-chosen keys;
// they are not sent to the model — answers come back under the same IDs.

export type QuestionType = "noul" | "choice" | "score";

export type Instructions = string | Record<string, unknown> | unknown[];

export interface NoulQuestion {
  type: "noul";
  instructions: Instructions;
  criteria?: { true?: string; false?: string } | null;
}

export interface ChoiceQuestion {
  type: "choice";
  instructions: Instructions;
  criteria: Record<string, string | null>;
}

export interface ScoreQuestion {
  type: "score";
  instructions: Instructions;
  criteria: Array<string | Record<string, unknown> | unknown[] | null>;
}

export type Question = NoulQuestion | ChoiceQuestion | ScoreQuestion;

export interface SystemOneRequest {
  state: unknown;
  model: string;
  questions: Record<string, Question>;
}

export interface NoulAnswer {
  type: "noul";
  noul: number;
}

export interface ChoiceAnswer {
  type: "choice";
  choice: string;
  probabilities: Record<string, number>;
  confidence: number;
}

export interface ScoreAnswer {
  type: "score";
  score: number;
  legend: Record<string, string>;
  probabilities: Record<string, number>;
  confidence: number;
}

export type Answer = NoulAnswer | ChoiceAnswer | ScoreAnswer;

export interface SystemOneResponse {
  model: string;
  answers: Record<string, Answer>;
  usage: { input_tokens: number; output_tokens: number };
}

export interface ModelCard {
  name: string;
  description: string;
  release_date: string;
}

export interface ModelsResponse {
  models: ModelCard[];
}

// CLI-local annotations. Thresholds live in code, not the API:
// verdict/action are derived from probabilities/confidence.
export type NoulVerdict = "yes" | "no" | "uncertain";
export type GateAction = "act" | "review" | "abstain";

export type AnnotatedAnswer =
  | (NoulAnswer & { verdict: NoulVerdict })
  | (ChoiceAnswer & { action: GateAction })
  | (ScoreAnswer & { action: GateAction });

export interface AnnotatedResponse {
  model: string;
  answers: Record<string, AnnotatedAnswer>;
  usage: { input_tokens: number; output_tokens: number };
}
