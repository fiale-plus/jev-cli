import { writeFileSync } from "node:fs";
import type { Questions, SystemOneResult } from "@typesafe-ai/sdk";
import { estimateCostUsd } from "../api/client.js";
import { hashValue, sha256Hex } from "../utils/hash.js";
import { cliVersion } from "../utils/package.js";

export const RECORD_VERSION = 1;

export interface RecordPackRef {
  name: string;
  pack_version: number;
  hash: string;
}

// Opt-in decision record. The raw state is deliberately not stored: it can hold
// confidential text, and the hash is enough to prove which input produced an answer.
export interface DecisionRecord {
  record_version: number;
  created_at: string;
  cli_version: string;
  pack: RecordPackRef | null;
  model_requested: string | null;
  model_resolved: string;
  state_sha256: string | null;
  questions_sha256: string;
  latency_ms: number;
  response: SystemOneResult<Questions>;
}

export interface RecordInputs {
  pack: RecordPackRef | null;
  modelRequested: string | undefined;
  state: unknown;
  questions: Questions;
  latencyMs: number;
}

function stateHash(state: unknown): string | null {
  if (state === undefined || state === null) return null;
  return typeof state === "string" ? `sha256:${sha256Hex(state)}` : `sha256:${hashValue(state)}`;
}

export function buildRecord(inputs: RecordInputs, response: SystemOneResult<Questions>): DecisionRecord {
  return {
    record_version: RECORD_VERSION,
    created_at: new Date().toISOString(),
    cli_version: cliVersion(),
    pack: inputs.pack,
    model_requested: inputs.modelRequested ?? null,
    model_resolved: response.model,
    state_sha256: stateHash(inputs.state),
    questions_sha256: `sha256:${hashValue(inputs.questions)}`,
    latency_ms: Math.round(inputs.latencyMs),
    response,
  };
}

export function writeRecord(path: string, record: DecisionRecord): void {
  writeFileSync(path, JSON.stringify(record, null, 2) + "\n", "utf8");
}

export function isRecord(input: unknown): input is DecisionRecord {
  return (
    typeof input === "object" &&
    input !== null &&
    (input as { record_version?: unknown }).record_version === RECORD_VERSION &&
    typeof (input as { response?: unknown }).response === "object"
  );
}

// Accepts either a record or a bare response object, so `gate` can read the output
// of `ask` directly as well as a saved record.
export function extractResponse(input: unknown): SystemOneResult<Questions> {
  if (isRecord(input)) return input.response;
  if (typeof input === "object" && input !== null && "answers" in input) {
    return input as SystemOneResult<Questions>;
  }
  throw new Error("Invalid input: expected a response object with an \"answers\" map, or a decision record with a \"response\" field.");
}

export function recordCost(record: DecisionRecord): { input_tokens: number; output_tokens: number; estimated_usd: number } {
  return {
    input_tokens: record.response.usage.input_tokens,
    output_tokens: record.response.usage.output_tokens,
    estimated_usd: estimateCostUsd(record.response.usage.input_tokens),
  };
}
