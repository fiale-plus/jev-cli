import type { Questions, SystemOneResult } from "@typesafe-ai/sdk";

export const SYSTEM_ONE_RESPONSE: SystemOneResult<Questions> = {
  model: "jev-1.13.0",
  answers: {
    is_urgent: { type: "noul", noul: 0.92 },
  },
  usage: { input_tokens: 312, output_tokens: 48 },
};

export const MIXED_RESPONSE: SystemOneResult<Questions> = {
  model: "jev-1.13.0",
  answers: {
    dept: {
      type: "choice",
      choice: "technical",
      probabilities: { billing: 0.08, technical: 0.85, sales: 0.07 },
      confidence: 0.82,
    },
    frustration: {
      type: "score",
      score: 1.035,
      legend: { 0: "Calm", 1: "Frustrated", 2: "Very angry" },
      probabilities: { 0: 0.15, 1: 0.68, 2: 0.17 },
      confidence: 0.842,
    },
    is_urgent: { type: "noul", noul: 0.999 },
  },
  usage: { input_tokens: 400, output_tokens: 60 },
};

export const MODELS_WIRE = {
  models: [
    { name: "jev-latest", description: "Latest stable", release_date: "2026-09-10T18:38:01Z" },
    { name: "jev-preview", description: "Preview", release_date: "2026-09-10T18:39:06Z" },
  ],
};
