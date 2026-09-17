import type { Questions } from "@typesafe-ai/sdk";

export type LintCode =
  | "JEV001"
  | "JEV002"
  | "JEV003"
  | "JEV004";

export interface LintIssue {
  code: LintCode;
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

function isEntryValue(v: unknown): boolean {
  // SDK EntryType: string | JSON object | array | null.
  return v === null || typeof v === "string" || typeof v === "number" || typeof v === "boolean" || Array.isArray(v) || (typeof v === "object" && v !== null);
}

// Structural pre-flight only: shape errors that always fail server-side.
// JEV001: unknown question type. JEV002: missing/empty instructions.
// JEV003: choice criteria not a map with >= 2 options. JEV004: score criteria
// not an array with >= 2 levels. Semantic question-design advice lives in the
// official skill, not here.
export function lintQuestions(input: unknown): LintResult {
  const issues: LintIssue[] = [];
  if (typeof input !== "object" || input === null || Array.isArray(input)) {
    return { ok: false, issues: [{ code: "JEV001", qid: "", severity: "error", message: "questions must be a JSON object mapping id -> question" }], questionCount: 0 };
  }
  const entries = Object.entries(input as Record<string, unknown>);
  if (entries.length === 0) {
    return { ok: false, issues: [{ code: "JEV001", qid: "", severity: "error", message: "questions map is empty" }], questionCount: 0 };
  }

  for (const [qid, raw] of entries) {
    if (qid.trim().length === 0) {
      issues.push({ code: "JEV001", qid, severity: "error", message: "question id is empty" });
      continue;
    }
    if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
      issues.push({ code: "JEV001", qid, severity: "error", message: "question must be an object with type/instructions" });
      continue;
    }
    const q = raw as Record<string, unknown>;
    const type = q.type as string;
    if (type !== "noul" && type !== "choice" && type !== "score") {
      issues.push({ code: "JEV001", qid, severity: "error", message: `unknown type "${String(type)}": expected noul|choice|score` });
      continue;
    }

    if (q.instructions === undefined) {
      issues.push({ code: "JEV002", qid, severity: "error", message: "instructions is required (string, object, array, or null)" });
    } else if (q.instructions !== null && !isEntryValue(q.instructions)) {
      issues.push({ code: "JEV002", qid, severity: "error", message: "instructions must be a string, JSON object, array, or null" });
    } else if (typeof q.instructions === "string" && !isNonEmptyString(q.instructions)) {
      issues.push({ code: "JEV002", qid, severity: "error", message: "instructions string is empty" });
    }

    if (type === "choice") {
      const c = q.criteria as Record<string, unknown> | undefined;
      if (typeof c !== "object" || c === null || Array.isArray(c)) {
        issues.push({ code: "JEV003", qid, severity: "error", message: "choice criteria must be a map of option -> description (use null when an option needs no detail)" });
      } else {
        const names = Object.keys(c);
        if (names.length < 2) {
          issues.push({ code: "JEV003", qid, severity: "error", message: `choice needs at least 2 options, found ${names.length} (single-outcome checks are a noul)` });
        }
        const seen = new Set<string>();
        for (const name of names) {
          if (name.trim().length === 0) {
            issues.push({ code: "JEV003", qid, severity: "error", message: "choice has an empty option name" });
          }
          if (seen.has(name)) {
            issues.push({ code: "JEV003", qid, severity: "error", message: `choice has duplicate option name "${name}"` });
          }
          seen.add(name);
          const desc = c[name];
          if (desc === undefined) {
            issues.push({ code: "JEV003", qid, severity: "error", message: `choice option "${name}" must map to a description or null, not undefined` });
          } else if (desc !== null && !isEntryValue(desc)) {
            issues.push({ code: "JEV003", qid, severity: "error", message: `choice option "${name}" description must be a string, object, array, or null` });
          } else if (desc === null) {
            issues.push({ code: "JEV003", qid, severity: "warn", message: `choice option "${name}" has no description — add one when options are confusable` });
          }
        }
      }
    }

    if (type === "score") {
      const c = q.criteria as unknown;
      if (!Array.isArray(c)) {
        issues.push({ code: "JEV004", qid, severity: "error", message: "score criteria must be an ordered array of level descriptions, lowest first" });
      } else if (c.length < 2) {
        issues.push({ code: "JEV004", qid, severity: "error", message: `score needs at least 2 levels, found ${c.length}` });
      } else {
        c.forEach((level, i) => {
          if (level === undefined) {
            issues.push({ code: "JEV004", qid, severity: "error", message: `score level ${i} is missing` });
          } else if (typeof level === "string" && level.trim().length === 0) {
            issues.push({ code: "JEV004", qid, severity: "error", message: `score level ${i} is an empty string` });
          } else if (!isEntryValue(level)) {
            issues.push({ code: "JEV004", qid, severity: "error", message: `score level ${i} must be a string, object, array, or null` });
          }
        });
      }
    }

    if (type === "noul" && q.criteria !== undefined && q.criteria !== null) {
      const c = q.criteria as Record<string, unknown>;
      if (typeof c !== "object" || Array.isArray(c)) {
        issues.push({ code: "JEV002", qid, severity: "error", message: 'noul criteria must be an object like {"true": "...", "false": "..."}' });
      } else {
        for (const key of Object.keys(c)) {
          if (key !== "true" && key !== "false") {
            issues.push({ code: "JEV002", qid, severity: "warn", message: `noul criteria key "${key}" is ignored — only "true" and "false" apply` });
          } else if (c[key] !== null && c[key] !== undefined && !isEntryValue(c[key])) {
            issues.push({ code: "JEV002", qid, severity: "error", message: `noul criteria "${key}" must be a string, object, array, or null` });
          }
        }
      }
    }
  }

  return { ok: !issues.some((i) => i.severity === "error"), issues, questionCount: entries.length };
}

export function coerceQuestions(input: unknown): Questions {
  const lint = lintQuestions(input);
  if (!lint.ok) {
    const first = lint.issues.find((i) => i.severity === "error");
    throw new Error(`Invalid questions${first?.qid ? ` (${first.qid})` : ""} [${first?.code}]: ${first?.message}`);
  }
  return input as Questions;
}
