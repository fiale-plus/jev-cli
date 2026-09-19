import { mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { createClient } from "../api/client.js";
import type { ClientOpts } from "../api/client.js";
import type { GlobalOptions } from "../cli/parseArgs.js";
import type { OutputFormat } from "../cli/formatters.js";
import { formatOutput } from "../cli/formatters.js";
import type { LogLevel, Questions } from "@typesafe-ai/sdk";
import { parseOption, parsePositiveInt } from "../utils/validation.js";
import { readJsonFile, readState } from "../utils/io.js";
import { coerceQuestions } from "../cli/lint.js";
import type { RecordPackRef } from "../cli/records.js";
import { buildRecord, writeRecord } from "../cli/records.js";
import { loadPack, loadPackFile } from "./packs.js";

export function clientOpts(global: GlobalOptions, apiKey: string): ClientOpts {
  return {
    apiKey,
    ...(global.baseUrl !== undefined ? { baseUrl: global.baseUrl } : {}),
    // --model is the per-call override; the request-file model (if any) wins.
    // Priority: request file > --model flag > TYPESAFE_DEFAULT_MODEL > SDK default.
    ...(global.model !== undefined ? { model: global.model } : {}),
    ...(global.logLevel !== undefined ? { logLevel: global.logLevel as LogLevel } : {}),
    timeout: global.timeout === undefined ? undefined : parsePositiveInt(global.timeout, "--timeout", 1, 300_000),
    maxRetries: global.retries === undefined ? undefined : parsePositiveInt(global.retries, "--retries", 0, 10),
  };
}

interface EmitOptions {
  opts: ClientOpts;
  state: unknown;
  questions: Questions;
  model: string | undefined;
  format: OutputFormat;
  pack: RecordPackRef | null;
  recordPath: string | undefined;
  runId?: string;
  decisionId?: string;
  parentId?: string;
  signal?: AbortSignal;
}

// Successful inference always exits 0. Confidence is data, not authorization:
// callers decide which answers matter and apply their own policy.
async function emit({ opts, state, questions, model, format, pack, recordPath, runId, decisionId, parentId, signal }: EmitOptions): Promise<void> {
  if (recordPath !== undefined) {
    // Prepared before the request: a bad record path must fail before paying for
    // an answer that would then have nowhere to go.
    mkdirSync(dirname(resolve(recordPath)), { recursive: true });
  }
  const client = createClient(opts);
  const started = Date.now();
  const response = await client.systemOne(
    {
      state: state as never,
      questions,
      ...(model !== undefined ? { model } : {}),
    },
    // Request-scoped options: the client carries no signal, so cancellation has to
    // travel with the request itself.
    { ...(signal !== undefined ? { signal } : {}) },
  );
  const latencyMs = Date.now() - started;
  if (recordPath !== undefined) {
    const record = buildRecord({ runId, decisionId, parentId, pack, modelRequested: model, state, questions, latencyMs }, response);
    writeRecord(recordPath, record);
    process.stderr.write(`record written: ${recordPath} (${record.decision_id ?? "un-correlated"})\n`);
  }

  // Broken pipe surfaces via the process error handler; stdout stays the only
  // machine-parseable channel.
  const ok = process.stdout.write(formatOutput(response, format) + "\n");
  if (!ok) await new Promise<void>((resolve) => process.stdout.once("drain", () => resolve()));
}

export function abortSignal(): AbortSignal | undefined {
  // SIGINT/SIGTERM cancel the in-flight SDK request via AbortSignal.
  const controller = new AbortController();
  const onSignal = () => controller.abort();
  process.once("SIGINT", onSignal);
  process.once("SIGTERM", onSignal);
  return controller.signal;
}

function requireInstructions(positionals: string[], command: string): { instructions: string; extra: string[] } {
  const [instructions, ...extra] = positionals;
  if (!instructions || instructions.trim().length === 0) {
    throw new Error(`Missing instructions: jev ${command} "<question>" [--state ...].`);
  }
  return { instructions, extra };
}

function stateSource(global: GlobalOptions) {
  return { state: global.state, stateFile: global.stateFile, stateFormat: global.stateFormat, stdin: global.stdin };
}

function rejectPack(global: GlobalOptions, command: string): void {
  if (global.pack !== undefined || global.packFile !== undefined) {
    throw new Error(`Conflicting inputs: --pack/--pack-file applies to "ask" (state plus pack questions), not "${command}".`);
  }
}

export async function handleNoul(positionals: string[], global: GlobalOptions, opts: ClientOpts, format: OutputFormat): Promise<void> {
  rejectPack(global, "noul");
  const { instructions, extra } = requireInstructions(positionals, "noul");
  const state = await readState({ ...stateSource(global), extra });
  const criteria =
    global.trueMeans !== undefined || global.falseMeans !== undefined
      ? { ...(global.trueMeans !== undefined ? { true: global.trueMeans } : {}), ...(global.falseMeans !== undefined ? { false: global.falseMeans } : {}) }
      : undefined;
  await emit({
    opts,
    state,
    questions: coerceQuestions({ q: { type: "noul", instructions, ...(criteria ? { criteria } : {}) } }),
    model: global.model,
    format,
    pack: null,
    recordPath: global.record, runId: global.runId, decisionId: global.decisionId, parentId: global.parentId,
    signal: abortSignal(),
  });
}

export async function handleChoice(positionals: string[], global: GlobalOptions, opts: ClientOpts, format: OutputFormat): Promise<void> {
  rejectPack(global, "choice");
  const { instructions, extra } = requireInstructions(positionals, "choice");
  if (global.options.length < 2) {
    throw new Error(`choice needs at least 2 --option entries: --option billing="Payments..." --option technical="Bugs..." (single-outcome checks are a noul).`);
  }
  const criteria: Record<string, string | null> = {};
  for (const raw of global.options) {
    const [name, desc] = parseOption(raw);
    if (!name) throw new Error(`Invalid --option "${raw}": expected name="description" or name.`);
    if (name in criteria) throw new Error(`Duplicate --option "${name}": option names must be unique.`);
    criteria[name] = desc;
  }
  const state = await readState({ ...stateSource(global), extra });
  await emit({
    opts,
    state,
    questions: coerceQuestions({ q: { type: "choice", instructions, criteria } }),
    model: global.model,
    format,
    pack: null,
    recordPath: global.record, runId: global.runId, decisionId: global.decisionId, parentId: global.parentId,
    signal: abortSignal(),
  });
}

export async function handleScore(positionals: string[], global: GlobalOptions, opts: ClientOpts, format: OutputFormat): Promise<void> {
  rejectPack(global, "score");
  const { instructions, extra } = requireInstructions(positionals, "score");
  if (global.levels.length < 2) {
    throw new Error(`score needs at least 2 --level entries, lowest first: --level "Calm" --level "Frustrated" --level "Angry".`);
  }
  const state = await readState({ ...stateSource(global), extra });
  const criteria = global.levels as [string, string, ...string[]];
  await emit({
    opts,
    state,
    questions: coerceQuestions({ q: { type: "score", instructions, criteria } }),
    model: global.model,
    format,
    pack: null,
    recordPath: global.record, runId: global.runId, decisionId: global.decisionId, parentId: global.parentId,
    signal: abortSignal(),
  });
}

export async function handleAsk(global: GlobalOptions, opts: ClientOpts, format: OutputFormat): Promise<void> {
  const hasStateFlags = global.state !== undefined || global.stateFile !== undefined || global.stdin;
  const packSource = global.pack !== undefined ? loadPack(global.pack) : global.packFile !== undefined ? loadPackFile(global.packFile) : null;
  if (packSource !== null) {
    if (global.questions !== undefined) throw new Error("Conflicting inputs: a pack and --questions both supply questions. Use one.");
    const state = await readState({ ...stateSource(global), extra: [] });
    await emit({ opts, state, questions: packSource.pack.questions, model: global.model, format, pack: { name: packSource.pack.name, pack_version: packSource.pack.pack_version, hash: packSource.hash }, recordPath: global.record, runId: global.runId, decisionId: global.decisionId, parentId: global.parentId, signal: abortSignal() });
    return;
  }
  if (global.request) {
    if (hasStateFlags || global.model !== undefined || global.questions !== undefined || global.pack !== undefined || global.packFile !== undefined) {
      throw new Error("Conflicting inputs: --request is mutually exclusive with state, model, questions, and pack options. Put them in the request file.");
    }
    const raw = readJsonFile(global.request) as { state?: unknown; model?: string; questions?: unknown };
    if (typeof raw !== "object" || raw === null || raw.state === undefined || raw.questions === undefined) {
      throw new Error("Invalid --request file: expected {state, questions} with optional model.");
    }
    const questions = coerceQuestions(raw.questions);
    const model = typeof raw.model === "string" ? raw.model : undefined;
    await emit({ opts, state: raw.state, questions, model, format, pack: null, recordPath: global.record, runId: global.runId, decisionId: global.decisionId, parentId: global.parentId, signal: abortSignal() });
    return;
  }


  if (!global.questions) {
    throw new Error("Missing questions: jev ask --request <file> | --questions <file> --state ... | --pack/--pack-file <path> --state ... .");
  }
  const questions = coerceQuestions(readJsonFile(global.questions));
  const state = await readState({ ...stateSource(global), extra: [] });
  await emit({ opts, state, questions, model: global.model, format, pack: null, recordPath: global.record, runId: global.runId, decisionId: global.decisionId, parentId: global.parentId, signal: abortSignal() });
}
