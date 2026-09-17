import type { JevClient } from "../api/client.js";
import type { GlobalOptions } from "../cli/parseArgs.js";
import type { OutputFormat } from "../cli/formatters.js";
import { formatOutput } from "../cli/formatters.js";
import { annotateResponse, exitCodeFor } from "../cli/gates.js";
import { coerceQuestions, lintQuestions } from "../cli/lint.js";
import { parsePositiveInt } from "../utils/validation.js";
import { readJsonFile, readState } from "../utils/io.js";
import { buildThresholds } from "./single.js";
import { ASK_HELP } from "../cli/help.js";

export async function handleAsk(global: GlobalOptions, client: JevClient, format: OutputFormat): Promise<void> {
  if (!global.questions) {
    process.stdout.write(ASK_HELP);
    return;
  }
  const rawQuestions = readJsonFile(global.questions);
  const questions = coerceQuestions(rawQuestions);
  const state = await readState({ state: global.state, stateFile: global.stateFile, stdin: global.stdin, extra: [] });
  const response = await client.systemOne(state, questions, global.model);
  const annotated = annotateResponse(response, buildThresholds(global));
  process.stdout.write(formatOutput(annotated, format) + "\n");
  process.exitCode = exitCodeFor(annotated);
}

export async function handleLint(global: GlobalOptions): Promise<void> {
  if (!global.questions) throw new Error('Missing --questions <file>: jev lint --questions pack.json.');
  const result = lintQuestions(readJsonFile(global.questions));
  process.stdout.write(JSON.stringify(result, null, 2) + "\n");
  if (!result.ok) process.exitCode = 1;
}

export async function handleModels(client: JevClient, format: OutputFormat): Promise<void> {
  const models = await client.listModels();
  if (format === "json") {
    process.stdout.write(JSON.stringify(models, null, 2) + "\n");
    return;
  }
  for (const m of models.models) {
    process.stdout.write(`${m.name}\t${m.release_date}\t${m.description}\n`);
  }
}

export function parseLimit(global: GlobalOptions): number | undefined {
  if (global.limit === undefined) return undefined;
  return parsePositiveInt(global.limit, "--limit", 0, 100_000);
}
