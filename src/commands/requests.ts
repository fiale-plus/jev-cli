import { createClient } from "../api/client.js";
import type { ClientOpts } from "../api/client.js";
import type { GlobalOptions } from "../cli/parseArgs.js";
import type { OutputFormat } from "../cli/formatters.js";
import { formatOutput } from "../cli/formatters.js";
import type { LogLevel, Questions } from "@typesafe-ai/sdk";
import { parseOption, parsePositiveInt } from "../utils/validation.js";
import { readJsonFile, readState } from "../utils/io.js";
import { coerceQuestions } from "../cli/lint.js";

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

// Successful inference always exits 0. Confidence is data, not authorization:
// callers decide which answers matter and apply their own policy.
async function emit(opts: ClientOpts, state: unknown, questions: Questions, model: string | undefined, format: OutputFormat, signal?: AbortSignal): Promise<void> {
  const client = createClient({ ...opts, ...(signal !== undefined ? { signal } : {}) });
  const response = await client.systemOne({
    state: state as never,
    questions,
    ...(model !== undefined ? { model } : {}),
  });
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

export async function handleNoul(positionals: string[], global: GlobalOptions, opts: ClientOpts, format: OutputFormat): Promise<void> {
  const { instructions, extra } = requireInstructions(positionals, "noul");
  const state = await readState({ ...stateSource(global), extra });
  const criteria =
    global.trueMeans !== undefined || global.falseMeans !== undefined
      ? { ...(global.trueMeans !== undefined ? { true: global.trueMeans } : {}), ...(global.falseMeans !== undefined ? { false: global.falseMeans } : {}) }
      : undefined;
  await emit(opts, state, coerceQuestions({ q: { type: "noul", instructions, ...(criteria ? { criteria } : {}) } }), global.model, format, abortSignal());
}

export async function handleChoice(positionals: string[], global: GlobalOptions, opts: ClientOpts, format: OutputFormat): Promise<void> {
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
  await emit(opts, state, coerceQuestions({ q: { type: "choice", instructions, criteria } }), global.model, format, abortSignal());
}

export async function handleScore(positionals: string[], global: GlobalOptions, opts: ClientOpts, format: OutputFormat): Promise<void> {
  const { instructions, extra } = requireInstructions(positionals, "score");
  if (global.levels.length < 2) {
    throw new Error(`score needs at least 2 --level entries, lowest first: --level "Calm" --level "Frustrated" --level "Angry".`);
  }
  const state = await readState({ ...stateSource(global), extra });
  const criteria = global.levels as [string, string, ...string[]];
  await emit(opts, state, coerceQuestions({ q: { type: "score", instructions, criteria } }), global.model, format, abortSignal());
}

export async function handleAsk(global: GlobalOptions, opts: ClientOpts, format: OutputFormat): Promise<void> {
  const hasStateFlags = global.state !== undefined || global.stateFile !== undefined || global.stdin;
  // Full request file: {state, model?, questions} — mirrors the API shape.
  // --request is mutually exclusive with --state/--state-file/--stdin/--model/--questions.
  if (global.request) {
    if (hasStateFlags || global.model !== undefined || global.questions !== undefined) {
      throw new Error("Conflicting inputs: --request is mutually exclusive with --state, --state-file, --stdin, --model, and --questions. Put state/model/questions in the request file.");
    }
    const raw = readJsonFile(global.request) as { state?: unknown; model?: string; questions?: unknown };
    if (typeof raw !== "object" || raw === null || raw.state === undefined || raw.questions === undefined) {
      throw new Error("Invalid --request file: expected {state, questions} with optional model.");
    }
    const questions = coerceQuestions(raw.questions);
    const model = typeof raw.model === "string" ? raw.model : undefined;
    await emit(opts, raw.state, questions, model, format, abortSignal());
    return;
  }
  if (!global.questions) {
    throw new Error("Missing questions: jev ask --request <file> | --questions <file> --state ... .");
  }
  const questions = coerceQuestions(readJsonFile(global.questions));
  const state = await readState({ ...stateSource(global), extra: [] });
  await emit(opts, state, questions, global.model, format, abortSignal());
}
