import type { Questions } from "@typesafe-ai/sdk";

export interface LintIssue {
  qid: string;
  severity: "error" | "warn";
  message: string;
}

export interface LintResult {
  ok: boolean;
  issues: LintIssue[];
  questionCount: number;
}

function isNonEmptyString(v: unknown): v is string {
  return typeof v === "string" && v.trim().length > 0;
}

// Structural pre-flight only: shape errors that always fail server-side.
// Semantic question-design advice lives in the official skill, not here.
export function lintQuestions(input: unknown): LintResult {
  const issues: LintIssue[] = [];
  if (typeof input !== "object" || input === null || Array.isArray(input)) {
    return { ok: false, issues: [{ qid: "", severity: "error", message: "questions must be a JSON object mapping id -> question" }], questionCount: 0 };
  }
  const entries = Object.entries(input as Record<string, unknown>);
  if (entries.length === 0) {
    return { ok: false, issues: [{ qid: "", severity: "error", message: "questions map is empty" }], questionCount: 0 };
  }

  for (const [qid, raw] of entries) {
    if (qid.trim().length === 0) {
      issues.push({ qid, severity: "error", message: "question id is empty" });
      continue;
    }
    if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
      issues.push({ qid, severity: "error", message: "question must be an object with type/instructions" });
      continue;
    }
    const q = raw as Record<string, unknown>;
    const type = q.type as string;
    if (type !== "noul" && type !== "choice" && type !== "score") {
      issues.push({ qid, severity: "error", message: `unknown type "${String(type)}": expected noul|choice|score` });
      continue;
    }

    if (q.instructions === undefined || q.instructions === null) {
      issues.push({ qid, severity: "error", message: "instructions is required (string, object, or array)" });
    } else if (typeof q.instructions === "string" && !isNonEmptyString(q.instructions)) {
      issues.push({ qid, severity: "error", message: "instructions string is empty" });
    }

    if (type === "choice") {
      const c = q.criteria as Record<string, unknown> | undefined;
      if (typeof c !== "object" || c === null || Array.isArray(c)) {
        issues.push({ qid, severity: "error", message: "choice criteria must be a map of option -> description (use null when an option needs no detail)" });
      } else if (Object.keys(c).length < 2) {
        issues.push({ qid, severity: "error", message: `choice needs at least 2 options, found ${Object.keys(c).length} (single-outcome checks are a noul)` });
      }
    }

    if (type === "score") {
      const c = q.criteria as unknown;
      if (!Array.isArray(c)) {
        issues.push({ qid, severity: "error", message: "score criteria must be an ordered array of level descriptions, lowest first" });
      } else if (c.length < 2) {
        issues.push({ qid, severity: "error", message: `score needs at least 2 levels, found ${c.length}` });
      }
    }

    if (type === "noul" && q.criteria !== undefined && q.criteria !== null) {
      const c = q.criteria as Record<string, unknown>;
      if (typeof c !== "object" || Array.isArray(c)) {
        issues.push({ qid, severity: "error", message: 'noul criteria must be an object like {"true": "...", "false": "..."}' });
      }
    }
  }

  return { ok: !issues.some((i) => i.severity === "error"), issues, questionCount: entries.length };
}

export function coerceQuestions(input: unknown): Questions {
  const lint = lintQuestions(input);
  if (!lint.ok) {
    const first = lint.issues.find((i) => i.severity === "error");
    throw new Error(`Invalid questions${first?.qid ? ` (${first.qid})` : ""}: ${first?.message}`);
  }
  return input as Questions;
}
