import { createClient } from "../api/client.js";
import type { ClientOpts } from "../api/client.js";
import type { GlobalOptions } from "../cli/parseArgs.js";
import type { OutputFormat } from "../cli/formatters.js";
import { formatOutput } from "../cli/formatters.js";
import type { Questions } from "@typesafe-ai/sdk";
import { parsePositiveInt } from "../utils/validation.js";
import { readJsonFile, readJsonlStream } from "../utils/io.js";
import { coerceQuestions, lintQuestions } from "../cli/lint.js";

interface SettledRow {
  index: number;
  id: unknown;
  ok: boolean;
  response?: unknown;
  error?: string;
}

// JSONL batch: one process, many independent requests, bounded concurrency.
// Contract: one result/error record per input record, input order preserved,
// streamed to stdout, nonzero overall status if any record fails.
// Input records: {id?, state, questions?, model?} with --questions as fallback.
export async function handleBatch(global: GlobalOptions, opts: ClientOpts, format: OutputFormat): Promise<void> {
  const input = global.request ?? global.stateFile;
  if (!input) throw new Error("Missing input: jev batch --request <jsonl-file> [--questions <file>].");
  const fallbackQuestions = global.questions ? coerceQuestions(readJsonFile(global.questions)) : undefined;
  const concurrency = global.concurrency === undefined ? 4 : parsePositiveInt(global.concurrency, "--concurrency", 1, 32);
  const client = createClient(opts);

  const pending: Array<Promise<SettledRow>> = [];
  const buffered = new Map<number, SettledRow>();
  let nextIndex = 0;
  let failures = 0;

  async function runOne(index: number, id: unknown, state: unknown, questions: Questions, model: string | undefined): Promise<SettledRow> {
    try {
      const response = await client.systemOne({
        state: state as never,
        questions,
        ...(model !== undefined ? { model } : {}),
      });
      return { index, id, ok: true, response: format === "json" ? response : formatOutput(response, format) };
    } catch (err) {
      return { index, id, ok: false, error: err instanceof Error ? err.message : String(err) };
    }
  }

  function printRow(row: SettledRow): void {
    if (format === "json") {
      process.stdout.write(JSON.stringify({ id: row.id ?? row.index, ok: row.ok, ...(row.ok ? { response: row.response } : { error: row.error }) }) + "\n");
    } else {
      process.stdout.write(`${String(row.id ?? row.index)}: ${row.ok ? row.response : `error: ${row.error}`}\n`);
    }
  }

  async function drain(completed: Promise<SettledRow>): Promise<void> {
    const settled = await completed;
    buffered.set(settled.index, settled);
    while (buffered.has(nextIndex)) {
      const row = buffered.get(nextIndex) as SettledRow;
      buffered.delete(nextIndex);
      if (!row.ok) failures++;
      printRow(row);
      nextIndex++;
    }
  }

  function failNow(index: number, id: unknown, error: string): void {
    failures++;
    while (nextIndex < index && buffered.has(nextIndex)) {
      const row = buffered.get(nextIndex) as SettledRow;
      buffered.delete(nextIndex);
      if (!row.ok) failures++;
      printRow(row);
      nextIndex++;
    }
    printRow({ index, id, ok: false, error });
    nextIndex = index + 1;
  }

  for await (const { index, record } of readJsonlStream(input)) {
    if (typeof record !== "object" || record === null) {
      failNow(index, index, `Invalid JSONL record ${index + 1}: expected an object with state.`);
      continue;
    }
    const rec = record as { id?: unknown; state?: unknown; questions?: unknown; model?: unknown };
    if (rec.state === undefined) {
      failNow(index, rec.id ?? index, `Invalid JSONL record ${index + 1}: missing state.`);
      continue;
    }
    let questions: Questions;
    try {
      if (rec.questions !== undefined) questions = coerceQuestions(rec.questions);
      else if (fallbackQuestions) questions = fallbackQuestions;
      else throw new Error(`Invalid JSONL record ${index + 1}: missing questions (or pass --questions).`);
    } catch (err) {
      failNow(index, rec.id ?? index, err instanceof Error ? err.message : String(err));
      continue;
    }
    const model = typeof rec.model === "string" ? rec.model : global.model;
    pending.push(runOne(index, rec.id, rec.state, questions, model));
    if (pending.length >= concurrency) {
      const task = pending.shift() as Promise<SettledRow>;
      await drain(task);
    }
  }
  for (const task of pending) {
    await drain(task);
  }
  if (failures > 0) {
    process.exitCode = 1;
    process.stderr.write(`${failures} batch record(s) failed.\n`);
  }
}

export async function handleLint(global: GlobalOptions): Promise<void> {
  if (!global.questions) throw new Error("Missing --questions <file>: jev lint --questions pack.json.");
  const result = lintQuestions(readJsonFile(global.questions));
  process.stdout.write(JSON.stringify(result, null, 2) + "\n");
  if (!result.ok) process.exitCode = 1;
}

export async function handleModels(opts: ClientOpts, format: OutputFormat): Promise<void> {
  const client = createClient(opts);
  const models = await client.models.list();
  if (format === "json") {
    process.stdout.write(JSON.stringify({ models }, null, 2) + "\n");
    return;
  }
  for (const m of models) {
    process.stdout.write(`${m.name}\t${m.release_date}\t${m.description}\n`);
  }
}
