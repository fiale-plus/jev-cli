export { TypeSafeClient, APIError, TypeSafeError, choice, noul, score, estimateCostUsd } from "./api/client.js";
export type { ClientOpts, ModelCard, Questions, SystemOneResult } from "./api/client.js";
export { lintQuestions, coerceQuestions } from "./cli/lint.js";
export type { LintIssue, LintResult } from "./cli/lint.js";
// Offline policy evaluation is part of the public surface: a caller tuning
// thresholds on their own records needs the same decision function the CLI uses.
export { lintPolicy, coercePolicy, evaluatePolicy, policyHash, GATE_EXIT } from "./cli/policy.js";
export type { GateDecision, GatePolicy, GateResult, GateRule, RuleOutcome } from "./cli/policy.js";
export { buildRecord, extractResponse, isRecord, recordCost, RECORD_VERSION } from "./cli/records.js";
export type { DecisionRecord, RecordPackRef } from "./cli/records.js";
export { listPacks, loadPack } from "./commands/packs.js";
export type { Pack } from "./commands/packs.js";
export { canonicalJson, hashValue, sha256Hex } from "./utils/hash.js";
export { cliVersion, packageRoot, packsDir } from "./utils/package.js";
