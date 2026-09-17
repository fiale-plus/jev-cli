import type { Questions, SystemOneResult } from "@typesafe-ai/sdk";
import { hashValue } from "../utils/hash.js";

// Gate decisions map to process exit codes. Acceptance is never inferred from a
// single confidence number: each rule names the answer and the condition that
// permits proceeding.
export type GateDecision = "accept" | "review" | "deny" | "abstain";

export const GATE_EXIT: Record<GateDecision, number> = {
  accept: 0,
  review: 2,
  deny: 3,
  abstain: 4,
};

// Fail-closed precedence when rules disagree: a definitive denial outranks missing
// data, which outranks a request for review, which outranks acceptance.
const ALL_PRECEDENCE: GateDecision[] = ["deny", "abstain", "review", "accept"];
const ANY_PRECEDENCE: GateDecision[] = ["accept", "review", "abstain", "deny"];

// A choice answer must carry a probability map that sums to 1. The tolerance
// absorbs rounding across many labels; anything wider is a malformed answer, and
// malformed answers abstain rather than pass a threshold.
const PROBABILITY_TOLERANCE = 0.05;

interface BaseRule {
  answer: string;
  optional?: boolean;
}

export interface NoulRule extends BaseRule {
  type: "noul";
  /** Which outcome permits proceeding. Default "yes". */
  accept_when?: "yes" | "no";
  accept_at?: number;
  review_at?: number;
}

export interface ChoiceRule extends BaseRule {
  type: "choice";
  /** Labels that permit proceeding. A label outside this list never accepts. */
  accept: string[];
  accept_at?: number;
  review_at?: number;
}

export interface ScoreRule extends BaseRule {
  type: "score";
  /** Default true: lower scores are safer (severity, risk, frustration). */
  higher_is_worse?: boolean;
  accept_at: number;
  review_at: number;
  /**
   * Closed interval the score must fall in. Taken from the answer's legend or
   * probability keys when omitted, so an out-of-scale score abstains instead of
   * sailing past the thresholds.
   */
  range?: [number, number];
}

export type GateRule = NoulRule | ChoiceRule | ScoreRule;

export interface GatePolicy {
  policy_version: number;
  name: string;
  /** "all" (default) requires every rule; "any" accepts when one rule accepts. */
  mode?: "all" | "any";
  rules: GateRule[];
}

export interface RuleOutcome {
  answer: string;
  type: GateRule["type"];
  decision: GateDecision;
  reason: string;
  observed: unknown;
}

export interface GateResult {
  decision: GateDecision;
  exit_code: number;
  policy: string;
  policy_version: number;
  policy_hash: string;
  mode: "all" | "any";
  rules: RuleOutcome[];
}

export interface PolicyLint {
  ok: boolean;
  errors: string[];
  policy?: GatePolicy;
}

function isFraction(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 && value <= 1;
}

function isNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

// Structural validation only: a policy that parses here always produces a decision.
export function lintPolicy(input: unknown): PolicyLint {
  const errors: string[] = [];
  if (typeof input !== "object" || input === null || Array.isArray(input)) {
    return { ok: false, errors: ["policy must be a JSON object"] };
  }
  const raw = input as Record<string, unknown>;
  if (raw.policy_version !== 1) {
    errors.push(`policy_version must be 1, found ${JSON.stringify(raw.policy_version ?? null)}`);
  }
  if (typeof raw.name !== "string" || raw.name.trim().length === 0) {
    errors.push("name must be a non-empty string");
  }
  if (raw.mode !== undefined && raw.mode !== "all" && raw.mode !== "any") {
    errors.push(`mode must be "all" or "any", found ${JSON.stringify(raw.mode)}`);
  }
  if (!Array.isArray(raw.rules) || raw.rules.length === 0) {
    errors.push("rules must be a non-empty array");
    return { ok: false, errors };
  }

  const seen = new Set<string>();
  raw.rules.forEach((rule, i) => {
    const at = `rules[${i}]`;
    if (typeof rule !== "object" || rule === null || Array.isArray(rule)) {
      errors.push(`${at} must be an object`);
      return;
    }
    const r = rule as Record<string, unknown>;
    if (typeof r.answer !== "string" || r.answer.trim().length === 0) {
      errors.push(`${at}.answer must be a non-empty string`);
    } else if (seen.has(r.answer)) {
      errors.push(`${at}.answer "${r.answer}" is declared twice`);
    } else {
      seen.add(r.answer);
    }
    if (r.optional !== undefined && typeof r.optional !== "boolean") {
      errors.push(`${at}.optional must be a boolean`);
    }

    if (r.type === "noul") {
      if (r.accept_when !== undefined && r.accept_when !== "yes" && r.accept_when !== "no") {
        errors.push(`${at}.accept_when must be "yes" or "no"`);
      }
      if (r.accept_at !== undefined && !isFraction(r.accept_at)) errors.push(`${at}.accept_at must be a number in [0, 1]`);
      if (r.review_at !== undefined && !isFraction(r.review_at)) errors.push(`${at}.review_at must be a number in [0, 1]`);
      const acceptAt = r.accept_at ?? 0.8;
      const reviewAt = r.review_at ?? 0.5;
      if (isFraction(acceptAt) && isFraction(reviewAt) && reviewAt > acceptAt) {
        errors.push(`${at}.review_at (${reviewAt}) must be <= accept_at (${acceptAt})`);
      }
    } else if (r.type === "choice") {
      if (!Array.isArray(r.accept) || r.accept.length === 0) {
        errors.push(`${at}.accept must be a non-empty array of labels`);
      } else if (r.accept.some((label) => typeof label !== "string" || label.trim().length === 0)) {
        errors.push(`${at}.accept entries must be non-empty strings`);
      } else if (new Set(r.accept).size !== r.accept.length) {
        errors.push(`${at}.accept repeats a label; probability mass would be counted twice`);
      }
      if (r.accept_at !== undefined && !isFraction(r.accept_at)) errors.push(`${at}.accept_at must be a number in [0, 1]`);
      if (r.review_at !== undefined && !isFraction(r.review_at)) errors.push(`${at}.review_at must be a number in [0, 1]`);
      const acceptAt = r.accept_at;
      const reviewAt = r.review_at ?? 0.5;
      if (isFraction(acceptAt) && isFraction(reviewAt) && reviewAt > acceptAt) {
        errors.push(`${at}.review_at (${reviewAt}) must be <= accept_at (${acceptAt})`);
      }
    } else if (r.type === "score") {
      if (r.higher_is_worse !== undefined && typeof r.higher_is_worse !== "boolean") {
        errors.push(`${at}.higher_is_worse must be a boolean`);
      }
      if (!isNumber(r.accept_at)) errors.push(`${at}.accept_at must be a finite number`);
      if (!isNumber(r.review_at)) errors.push(`${at}.review_at must be a finite number`);
      if (r.range !== undefined) {
        if (!Array.isArray(r.range) || r.range.length !== 2 || !r.range.every(isNumber)) {
          errors.push(`${at}.range must be [min, max] with finite numbers`);
        } else if (r.range[0] >= r.range[1]) {
          errors.push(`${at}.range min (${r.range[0]}) must be < max (${r.range[1]})`);
        }
      }
      if (isNumber(r.accept_at) && isNumber(r.review_at) && r.higher_is_worse !== false && r.review_at < r.accept_at) {
        errors.push(`${at}.review_at (${r.review_at}) must be >= accept_at (${r.accept_at}) when higher_is_worse`);
      }
      if (isNumber(r.accept_at) && isNumber(r.review_at) && r.higher_is_worse === false && r.review_at > r.accept_at) {
        errors.push(`${at}.review_at (${r.review_at}) must be <= accept_at (${r.accept_at}) when higher_is_worse is false`);
      }
    } else {
      errors.push(`${at}.type must be "noul", "choice", or "score"`);
    }
  });

  if (errors.length > 0) return { ok: false, errors };
  return { ok: true, errors, policy: input as GatePolicy };
}

export function coercePolicy(input: unknown): GatePolicy {
  const lint = lintPolicy(input);
  if (!lint.ok || !lint.policy) {
    throw new Error(`Invalid policy: ${lint.errors.join("; ")}`);
  }
  return lint.policy;
}

export function policyHash(policy: GatePolicy): string {
  return `sha256:${hashValue({ ...policy, mode: policy.mode ?? "all" })}`;
}

type AnswerMap = Record<string, Record<string, unknown>>;

// Level indices reported alongside a score answer: {"0": …, "1": …}.
function reportedRange(answer: Record<string, unknown>): [number, number] | undefined {
  const indices = new Set<number>();
  for (const source of [answer.legend, answer.probabilities]) {
    if (typeof source !== "object" || source === null || Array.isArray(source)) continue;
    for (const key of Object.keys(source as Record<string, unknown>)) {
      const index = Number(key);
      if (Number.isInteger(index) && index >= 0) indices.add(index);
    }
  }
  const sorted = [...indices].sort((a, b) => a - b);
  if (sorted.length === 0) return undefined;
  return [sorted[0], sorted[sorted.length - 1]];
}

function evaluateRule(rule: GateRule, answers: AnswerMap): RuleOutcome {
  const base = { answer: rule.answer, type: rule.type } as const;
  const answer = answers[rule.answer];
  if (answer === undefined || answer === null || typeof answer !== "object") {
    return { ...base, decision: "abstain", reason: `answer "${rule.answer}" is missing from the input`, observed: null };
  }
  if (answer.type !== rule.type) {
    return {
      ...base,
      decision: "abstain",
      reason: `answer "${rule.answer}" is type "${String(answer.type)}", policy expects "${rule.type}"`,
      observed: answer.type,
    };
  }

  if (rule.type === "noul") {
    const p = answer.noul;
    if (!isFraction(p)) {
      return { ...base, decision: "abstain", reason: "noul value is not a probability", observed: p };
    }
    const acceptWhen = rule.accept_when ?? "yes";
    const acceptAt = rule.accept_at ?? 0.8;
    const reviewAt = rule.review_at ?? 0.5;
    // `support` is the probability of the outcome that permits proceeding.
    const support = acceptWhen === "yes" ? p : 1 - p;
    const decision: GateDecision = support >= acceptAt ? "accept" : support >= reviewAt ? "review" : "deny";
    return {
      ...base,
      decision,
      reason: `noul=${p.toFixed(3)}, accept_when=${acceptWhen} gives support ${support.toFixed(3)} (accept_at ${acceptAt}, review_at ${reviewAt})`,
      observed: p,
    };
  }

  if (rule.type === "choice") {
    const label = answer.choice;
    if (typeof label !== "string") {
      return { ...base, decision: "abstain", reason: "choice value is missing", observed: label };
    }
    const raw = answer.probabilities;
    if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
      // Confidence is a number about the answer as a whole, not the probability of
      // this label: substituting it would let a malformed answer pass a threshold.
      return { ...base, decision: "abstain", reason: `answer "${rule.answer}" reports no probability map`, observed: { choice: label } };
    }
    const probabilities = raw as Record<string, unknown>;
    const entries = Object.entries(probabilities);
    const invalid = entries.filter(([, value]) => !isFraction(value));
    if (invalid.length > 0) {
      return {
        ...base,
        decision: "abstain",
        reason: `invalid probability for ${invalid.map(([name]) => `"${name}"`).join(", ")}: probabilities must be numbers in [0, 1]`,
        observed: { choice: label, probabilities },
      };
    }
    const total = entries.reduce((sum, [, value]) => sum + (value as number), 0);
    if (Math.abs(total - 1) > PROBABILITY_TOLERANCE) {
      return {
        ...base,
        decision: "abstain",
        reason: `probabilities sum to ${total.toFixed(3)}, expected 1 ± ${PROBABILITY_TOLERANCE}`,
        observed: { choice: label, total },
      };
    }
    const p = probabilities[label];
    if (!isFraction(p)) {
      return { ...base, decision: "abstain", reason: `no probability reported for the chosen label "${label}"`, observed: { choice: label, probabilities } };
    }

    // Deduplicated: a label listed twice must not count its mass twice.
    const accepted = [...new Set(rule.accept)];
    const acceptMass = accepted.reduce((sum, name) => sum + (isFraction(probabilities[name]) ? (probabilities[name] as number) : 0), 0);
    const acceptAt = rule.accept_at;
    const reviewAt = rule.review_at ?? 0.5;
    const allowed = accepted.includes(label);

    if (!allowed) {
      // The chosen label does not permit proceeding, so confidence in it is not a
      // reason to soften: what matters is how much probability mass sat on a label
      // that would have. Below review_at the answer is a clear denial.
      const decision: GateDecision = acceptMass >= reviewAt ? "review" : "deny";
      return {
        ...base,
        decision,
        reason: `chose "${label}", which the policy does not accept; probability on accepted labels ${acceptMass.toFixed(3)} (review_at ${reviewAt})`,
        observed: { choice: label, probability: p, accept_mass: acceptMass },
      };
    }
    if (acceptAt === undefined) {
      return { ...base, decision: "accept", reason: `chose "${label}", an accepted label; no threshold configured`, observed: { choice: label, probability: p } };
    }
    const decision: GateDecision = p >= acceptAt ? "accept" : p >= reviewAt ? "review" : "deny";
    return {
      ...base,
      decision,
      reason: `chose "${label}" at p=${p.toFixed(3)} (accept_at ${acceptAt}, review_at ${reviewAt})`,
      observed: { choice: label, probability: p },
    };
  }

  const s = answer.score;
  if (!isNumber(s)) {
    return { ...base, decision: "abstain", reason: "score value is not a number", observed: s };
  }
  // The scale comes from the answer itself: legend and probability keys are the
  // level indices. Without one, an out-of-scale score cannot be told apart from a
  // valid one, so the answer abstains instead of being compared to the bands.
  const range = rule.range ?? reportedRange(answer);
  if (range === undefined) {
    return {
      ...base,
      decision: "abstain",
      reason: "score domain unknown: the rule sets no range and the answer reports no legend or probability keys",
      observed: s,
    };
  }
  if (s < range[0] || s > range[1]) {
    return { ...base, decision: "abstain", reason: `score ${s} falls outside the reported range [${range[0]}, ${range[1]}]`, observed: s };
  }
  const higherIsWorse = rule.higher_is_worse ?? true;
  const decision: GateDecision = higherIsWorse
    ? s <= rule.accept_at
      ? "accept"
      : s <= rule.review_at
        ? "review"
        : "deny"
    : s >= rule.accept_at
      ? "accept"
      : s >= rule.review_at
        ? "review"
        : "deny";
  return {
    ...base,
    decision,
    reason: `score=${s.toFixed(3)} (higher_is_worse=${higherIsWorse}, accept_at ${rule.accept_at}, review_at ${rule.review_at})`,
    observed: s,
  };
}

export function evaluatePolicy(
  policy: GatePolicy,
  response: Pick<SystemOneResult<Questions>, "answers"> | { answers: unknown },
): GateResult {
  const answers = (response.answers ?? {}) as AnswerMap;
  const mode = policy.mode ?? "all";
  const rules = policy.rules
    .filter((rule) => !(rule.optional === true && (answers[rule.answer] === undefined || answers[rule.answer] === null)))
    .map((rule) => evaluateRule(rule, answers));

  if (rules.length === 0) {
    // Every rule was optional and absent: there is nothing to authorize on.
    return {
      decision: "abstain",
      exit_code: GATE_EXIT.abstain,
      policy: policy.name,
      policy_version: policy.policy_version,
      policy_hash: policyHash(policy),
      mode,
      rules,
    };
  }

  const precedence = mode === "all" ? ALL_PRECEDENCE : ANY_PRECEDENCE;
  const decisions = new Set(rules.map((r) => r.decision));
  const decision = precedence.find((d) => decisions.has(d)) as GateDecision;

  return {
    decision,
    exit_code: GATE_EXIT[decision],
    policy: policy.name,
    policy_version: policy.policy_version,
    policy_hash: policyHash(policy),
    mode,
    rules,
  };
}
