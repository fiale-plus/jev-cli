import type { Question } from "../api/types.js";

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

function instructionsText(instructions: unknown): string | null {
  return typeof instructions === "string" ? instructions : null;
}

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

    const text = instructionsText(q.instructions);
    if (text !== null) {
      if (!isNonEmptyString(text)) {
        issues.push({ qid, severity: "error", message: "instructions string is empty" });
      } else {
        // IDs are for code only — never sent to the model. Instructions that
        // parrot the ID (or say almost nothing) silently lose meaning.
        if (text.trim() === qid) {
          issues.push({ qid, severity: "error", message: "instructions equal the question id, which is never sent to the model — write the full judgment" });
        }
        if (text.trim().length < 10) {
          issues.push({ qid, severity: "warn", message: "instructions look too short to be a complete judgment (<10 chars)" });
        }
      }
    } else if (q.instructions === undefined || q.instructions === null) {
      issues.push({ qid, severity: "error", message: "instructions is required" });
    }

    if (type === "choice") {
      const c = q.criteria as Record<string, unknown> | undefined;
      if (typeof c !== "object" || c === null || Array.isArray(c)) {
        issues.push({ qid, severity: "error", message: "choice criteria must be a map of option -> description (use null when an option needs no detail)" });
      } else {
        const names = Object.keys(c);
        if (names.length < 2) {
          issues.push({ qid, severity: "error", message: `choice needs at least 2 options, found ${names.length} (single-outcome checks are a noul)` });
        }
        for (const name of names) {
          if (name.trim().length === 0) issues.push({ qid, severity: "error", message: "choice has an empty option name" });
          if (c[name] === undefined) issues.push({ qid, severity: "error", message: `choice option "${name}" must map to a description or null, not undefined` });
          else if (c[name] === null) issues.push({ qid, severity: "warn", message: `choice option "${name}" has no description — add one when options are confusable` });
          else if (typeof c[name] !== "string" && typeof c[name] !== "object") {
            issues.push({ qid, severity: "error", message: `choice option "${name}" description must be a string, object, array, or null` });
          }
        }
      }
    }

    if (type === "score") {
      const c = q.criteria as unknown;
      if (!Array.isArray(c)) {
        issues.push({ qid, severity: "error", message: "score criteria must be an ordered array of level descriptions, lowest first" });
      } else {
        if (c.length < 2) {
          issues.push({ qid, severity: "error", message: `score needs at least 2 levels, found ${c.length}` });
        }
        c.forEach((level, i) => {
          if (typeof level === "string" && level.trim().length === 0) {
            issues.push({ qid, severity: "error", message: `score level ${i} is an empty string` });
          } else if (level === null || level === undefined) {
            issues.push({ qid, severity: "error", message: `score level ${i} is empty — every level must describe a concrete situation` });
          }
        });
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

export function coerceQuestions(input: unknown): Record<string, Question> {
  const lint = lintQuestions(input);
  if (!lint.ok) {
    const first = lint.issues.find((i) => i.severity === "error");
    throw new Error(`Invalid questions${first?.qid ? ` (${first.qid})` : ""}: ${first?.message}`);
  }
  return input as Record<string, Question>;
}
