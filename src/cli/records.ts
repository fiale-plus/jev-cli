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
// confidential text, and the hash is enough to commit to which input was judged.
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

// Type-tagged and versioned, so a text state cannot collide with the JSON state
// that parses to the same bytes, and absent state is distinct from JSON null.
function stateHash(state: unknown): string | null {
  if (state === undefined) return null;
  return `sha256:${hashValue({ state_version: 1, type: typeof state === "string" ? "text" : "json", value: state })}`;
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

export function recordCost(record: DecisionRecord): { input_tokens: number; output_tokens: number; estimated_usd: number } {
  return {
    input_tokens: record.response.usage.input_tokens,
    output_tokens: record.response.usage.output_tokens,
    estimated_usd: estimateCostUsd(record.response.usage.input_tokens),
  };
}

// Envelope detector. Anything carrying record fields is treated as a candidate
// record and must validate as one: falling back to a bare response would let a
// malformed or newer record be reinterpreted as a different judgment.
export function isRecord(input: unknown): boolean {
  return (
    typeof input === "object" &&
    input !== null &&
    !Array.isArray(input) &&
    ("record_version" in input || "response" in input)
  );
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

// Validates the fields that gate and replay dereference, so a hand-edited or
// truncated record fails with a message instead of a TypeError.
function coerceRecord(input: unknown): DecisionRecord {
  if (!isObject(input)) throw new Error("Invalid record: expected a JSON object.");
  if (input.record_version !== RECORD_VERSION) {
    throw new Error(`Unsupported record_version ${JSON.stringify(input.record_version ?? null)}: this CLI writes version ${RECORD_VERSION}.`);
  }
  if (!isObject(input.response)) {
    throw new Error('Invalid record: "response" must be an object.');
  }
  const response = input.response;
  if (!isObject(response.answers)) throw new Error('Invalid record: "response.answers" must be an object.');
  if (typeof response.model !== "string") throw new Error('Invalid record: "response.model" must be a string.');
  if (!isObject(response.usage)) throw new Error('Invalid record: "response.usage" must be an object.');
  if (typeof input.created_at !== "string") throw new Error('Invalid record: "created_at" must be a string.');
  if (typeof input.model_resolved !== "string") throw new Error('Invalid record: "model_resolved" must be a string.');
  if (typeof input.latency_ms !== "number") throw new Error('Invalid record: "latency_ms" must be a number.');
  return input as unknown as DecisionRecord;
}

// Public boundary for stored records: returns a validated record or throws. Unlike
// isRecord, this is a claim the caller can rely on — a malformed envelope fails
// here instead of reaching response handling unvalidated.
export function readRecord(input: unknown): DecisionRecord {
  if (!isRecord(input)) throw new Error('Invalid record: expected a decision record with a "record_version" or "response" field.');
  return coerceRecord(input);
}


// Accepts either a record or a bare response object, so `gate` can read the output
// of `ask` directly as well as a saved record.
export function extractResponse(input: unknown): SystemOneResult<Questions> {
  if (isRecord(input)) return readRecord(input).response;
  if (isObject(input) && "answers" in input) return input as unknown as SystemOneResult<Questions>;
  throw new Error('Invalid input: expected a response object with an "answers" map, or a decision record with a "response" field.');
}
