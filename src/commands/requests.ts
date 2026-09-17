import { createClient } from "../api/client.js";
import type { ClientOpts } from "../api/client.js";
import type { GlobalOptions } from "../cli/parseArgs.js";
import type { OutputFormat } from "../cli/formatters.js";
import { formatOutput } from "../cli/formatters.js";
import type { Questions } from "@typesafe-ai/sdk";
import { parseOption, parsePositiveInt } from "../utils/validation.js";
import { readJsonFile, readState } from "../utils/io.js";
import { coerceQuestions } from "../cli/lint.js";

export function clientOpts(global: GlobalOptions, apiKey: string): ClientOpts {
  return {
    apiKey,
    ...(global.baseUrl !== undefined ? { baseUrl: global.baseUrl } : {}),
    ...(global.model !== undefined ? { model: global.model } : {}),
    ...(global.logLevel !== undefined ? {} : {}),
    timeout: global.timeout === undefined ? undefined : parsePositiveInt(global.timeout, "--timeout", 1, 300_000),
    maxRetries: global.retries === undefined ? undefined : parsePositiveInt(global.retries, "--retries", 0, 10),
  };
}

export function logLevel(global: GlobalOptions): "debug" | "info" | "warn" | "error" | "off" | undefined {
  const level = global.logLevel as "debug" | "info" | "warn" | "error" | "off" | undefined;
  return level;
}

// Successful inference always exits 0. Confidence is data, not authorization:
// callers decide which answers matter and apply their own policy.
async function emit(opts: ClientOpts, state: unknown, questions: Questions, model: string | undefined, format: OutputFormat): Promise<void> {
  const client = createClient(opts);
  const response = await client.systemOne({
    state: state as never,
    questions,
    ...(model !== undefined ? { model } : {}),
  });
  process.stdout.write(formatOutput(response, format) + "\n");
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
  await emit(opts, state, { q: { type: "noul", instructions, ...(criteria ? { criteria } : {}) } } as Questions, global.model, format);
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
    criteria[name] = desc;
  }
  const state = await readState({ ...stateSource(global), extra });
  await emit(opts, state, { q: { type: "choice", instructions, criteria } } as Questions, global.model, format);
}

export async function handleScore(positionals: string[], global: GlobalOptions, opts: ClientOpts, format: OutputFormat): Promise<void> {
  const { instructions, extra } = requireInstructions(positionals, "score");
  if (global.levels.length < 2) {
    throw new Error(`score needs at least 2 --level entries, lowest first: --level "Calm" --level "Frustrated" --level "Angry".`);
  }
  const state = await readState({ ...stateSource(global), extra });
  const criteria = global.levels as [string, string, ...string[]];
  await emit(opts, state, { q: { type: "score", instructions, criteria } } as Questions, global.model, format);
}

export async function handleAsk(global: GlobalOptions, opts: ClientOpts, format: OutputFormat): Promise<void> {
  // Full request file: {state, model?, questions} — mirrors the API shape.
  if (global.request) {
    const raw = readJsonFile(global.request) as { state?: unknown; model?: string; questions?: unknown };
    if (typeof raw !== "object" || raw === null || raw.state === undefined || raw.questions === undefined) {
      throw new Error("Invalid --request file: expected {state, questions} with optional model.");
    }
    const questions = coerceQuestions(raw.questions);
    const model = typeof raw.model === "string" ? raw.model : global.model;
    await emit(opts, raw.state, questions, model, format);
    return;
  }
  if (!global.questions) {
    throw new Error("Missing questions: jev ask --request <file> | --questions <file> --state ... .");
  }
  const questions = coerceQuestions(readJsonFile(global.questions));
  const state = await readState({ ...stateSource(global), extra: [] });
  await emit(opts, state, questions, global.model, format);
}
