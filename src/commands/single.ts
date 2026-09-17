import type { JevClient } from "../api/client.js";
import type { GlobalOptions } from "../cli/parseArgs.js";
import type { OutputFormat } from "../cli/formatters.js";
import { formatOutput } from "../cli/formatters.js";
import { annotateResponse, DEFAULT_THRESHOLDS, exitCodeFor } from "../cli/gates.js";
import { parseOption, parsePositiveInt, parseProbability } from "../utils/validation.js";
import { readState } from "../utils/io.js";

export function buildThresholds(global: GlobalOptions) {
  return {
    yesAt: parseProbability(global.yesAt, "--yes-at", DEFAULT_THRESHOLDS.yesAt),
    noAt: parseProbability(global.noAt, "--no-at", DEFAULT_THRESHOLDS.noAt),
    actAbove: parseProbability(global.actAbove, "--act-above", DEFAULT_THRESHOLDS.actAbove),
    reviewAbove: parseProbability(global.reviewAbove, "--review-above", DEFAULT_THRESHOLDS.reviewAbove),
  };
}

export function clientOpts(global: GlobalOptions) {
  return {
    baseUrl: global.baseUrl,
    timeout: global.timeout === undefined ? undefined : parsePositiveInt(global.timeout, "--timeout", 30_000, 300_000),
    maxRetries: global.retries === undefined ? undefined : parsePositiveInt(global.retries, "--retries", 3, 10),
  };
}

async function emit(
  client: JevClient,
  state: unknown,
  questions: Parameters<JevClient["systemOne"]>[1],
  global: GlobalOptions,
  format: OutputFormat,
): Promise<void> {
  const raw = await client.systemOne(state, questions, global.model);
  const annotated = annotateResponse(raw, buildThresholds(global));
  process.stdout.write(formatOutput(annotated, format) + "\n");
  process.exitCode = exitCodeFor(annotated);
}

function requireInstructions(positionals: string[], command: string): { instructions: string; extra: string[] } {
  const [instructions, ...extra] = positionals;
  if (!instructions || instructions.trim().length === 0) {
    throw new Error(`Missing instructions: jev ${command} "<question>" [--state ...].`);
  }
  return { instructions, extra };
}

export async function handleNoul(positionals: string[], global: GlobalOptions, client: JevClient, format: OutputFormat): Promise<void> {
  const { instructions, extra } = requireInstructions(positionals, "noul");
  const state = await readState({ state: global.state, stateFile: global.stateFile, stdin: global.stdin, extra });
  const criteria =
    global.trueMeans !== undefined || global.falseMeans !== undefined
      ? { ...(global.trueMeans !== undefined ? { true: global.trueMeans } : {}), ...(global.falseMeans !== undefined ? { false: global.falseMeans } : {}) }
      : undefined;
  await emit(client, state, { q: { type: "noul", instructions, ...(criteria ? { criteria } : {}) } }, global, format);
}

export async function handleChoice(positionals: string[], global: GlobalOptions, client: JevClient, format: OutputFormat): Promise<void> {
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
  const state = await readState({ state: global.state, stateFile: global.stateFile, stdin: global.stdin, extra });
  await emit(client, state, { q: { type: "choice", instructions, criteria } }, global, format);
}

export async function handleScore(positionals: string[], global: GlobalOptions, client: JevClient, format: OutputFormat): Promise<void> {
  const { instructions, extra } = requireInstructions(positionals, "score");
  if (global.levels.length < 2) {
    throw new Error(`score needs at least 2 --level entries, lowest first: --level "Calm" --level "Frustrated" --level "Angry".`);
  }
  const state = await readState({ state: global.state, stateFile: global.stateFile, stdin: global.stdin, extra });
  await emit(client, state, { q: { type: "score", instructions, criteria: global.levels } }, global, format);
}
