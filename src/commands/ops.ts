import { createClient } from "../api/client.js";
import type { ClientOpts } from "../api/client.js";
import type { GlobalOptions } from "../cli/parseArgs.js";
import type { OutputFormat } from "../cli/formatters.js";
import { formatOutput, enrichResponse } from "../cli/formatters.js";
import type { Questions } from "@typesafe-ai/sdk";
import { parsePositiveInt } from "../utils/validation.js";
import { readJsonFile, readJsonlStream } from "../utils/io.js";
import { coerceQuestions, lintQuestions } from "../cli/lint.js";
import { abortSignal } from "./requests.js";
import { loadPack } from "./packs.js";

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
// Input records: {id?, state, questions?, model?}. --request takes per-record
// questions/model; --state-file <jsonl> with --questions/--model shares them.
export async function handleBatch(global: GlobalOptions, opts: ClientOpts, format: OutputFormat): Promise<void> {
  const input = global.request ?? global.stateFile;
  if (!input) throw new Error("Missing input: jev batch --request <jsonl-file> [--questions <file>].");
  if (global.request && (global.model !== undefined || global.questions !== undefined)) {
    throw new Error("Conflicting inputs: batch reads per-record model/questions from JSONL; --model/--questions are the fallback only via --state-file mode. Use --state-file <jsonl> with --questions for shared questions.");
  }
  const fallbackQuestions = global.questions ? coerceQuestions(readJsonFile(global.questions)) : undefined;
  const concurrency = global.concurrency === undefined ? 4 : parsePositiveInt(global.concurrency, "--concurrency", 1, 32);
  if (concurrency < 1) throw new Error(`Invalid --concurrency: "${global.concurrency}". Expected an integer in [1, 32].`);
  const signal = abortSignal();
  const client = createClient(opts);

  const inFlight = new Map<number, Promise<SettledRow>>();
  const buffered = new Map<number, SettledRow>();
  let nextIndex = 0;
  let failures = 0;
  let streamError: unknown = null;

  async function runOne(index: number, id: unknown, state: unknown, questions: Questions, model: string | undefined): Promise<SettledRow> {
    try {
      const response = await client.systemOne(
        {
          state: state as never,
          questions,
          ...(model !== undefined ? { model } : {}),
        },
        { ...(signal !== undefined ? { signal } : {}) },
      );
      // JSON rows carry the same enrichment a single call does (cost included);
      // table rows carry the rendered block.
      return { index, id, ok: true, response: format === "json" ? enrichResponse(response) : formatOutput(response, format) };
    } catch (err) {
      return { index, id, ok: false, error: err instanceof Error ? err.message : String(err) };
    }
  }

  function printRow(row: SettledRow): void {
    if (format === "json") {
      process.stdout.write(JSON.stringify({ index: row.index, id: row.id ?? row.index, ok: row.ok, ...(row.ok ? { response: row.response } : { error: row.error }) }) + "\n");
    } else {
      process.stdout.write(`${String(row.id ?? row.index)}: ${row.ok ? row.response : `error: ${row.error}`}\n`);
    }
  }

  function settle(row: SettledRow): void {
    buffered.set(row.index, row);
    while (buffered.has(nextIndex)) {
      const next = buffered.get(nextIndex) as SettledRow;
      buffered.delete(nextIndex);
      if (!next.ok) failures++;
      printRow(next);
      nextIndex++;
    }
  }

  function validateRecord(index: number, record: unknown): { id: unknown; state: unknown; questions: Questions; model: string | undefined } | { id: unknown; error: string } {
    if (typeof record !== "object" || record === null) {
      return { id: index, error: `Invalid JSONL record ${index + 1}: expected an object with state.` };
    }
    const rec = record as { id?: unknown; state?: unknown; questions?: unknown; model?: unknown };
    if (rec.state === undefined) {
      return { id: rec.id ?? index, error: `Invalid JSONL record ${index + 1}: missing state.` };
    }
    try {
      const questions = rec.questions !== undefined ? coerceQuestions(rec.questions) : fallbackQuestions;
      if (!questions) throw new Error(`Invalid JSONL record ${index + 1}: missing questions (or pass --questions).`);
      const model = typeof rec.model === "string" ? rec.model : global.model;
      return { id: rec.id, state: rec.state, questions, model };
    } catch (err) {
      return { id: rec.id ?? index, error: err instanceof Error ? err.message : String(err) };
    }
  }

  try {
    for await (const { index, record } of readJsonlStream(input)) {
      const validated = validateRecord(index, record);
      if ("error" in validated) {
        settle({ index, id: validated.id, ok: false, error: validated.error });
        continue;
      }
      const task = runOne(index, validated.id, validated.state, validated.questions, validated.model);
      inFlight.set(index, task);
      task.then(
        (row) => {
          inFlight.delete(index);
          settle(row);
        },
        (err: unknown) => {
          inFlight.delete(index);
          settle({ index, id: validated.id, ok: false, error: err instanceof Error ? err.message : String(err) });
        },
      );
      if (inFlight.size >= concurrency) {
        await Promise.race(inFlight.values());
      }
    }
  } catch (err) {
    streamError = err;
  }
  // Malformed input ends the stream but must not discard completed work:
  // drain everything settled so far, then report the stream failure.
  await Promise.all(inFlight.values());
  if (streamError !== null) {
    process.stderr.write(`${streamError instanceof Error ? streamError.message : String(streamError)}\n`);
    process.exitCode = 1;
  }
  if (failures > 0) {
    process.exitCode = 1;
    process.stderr.write(`${failures} batch record(s) failed.\n`);
  }
}

export async function handleLint(global: GlobalOptions): Promise<void> {
  // A pack is linted on load (questions and policy both), so --pack reports the
  // pack identity rather than a per-question list.
  if (global.pack !== undefined) {
    if (global.questions !== undefined) {
      throw new Error("Conflicting inputs: --pack and --questions. Lint one at a time.");
    }
    const { pack, hash, path } = loadPack(global.pack);
    process.stdout.write(
      JSON.stringify(
        {
          ok: true,
          pack: { name: pack.name, pack_version: pack.pack_version, hash, path },
          questionCount: Object.keys(pack.questions).length,
          ruleCount: pack.policy.rules.length,
        },
        null,
        2,
      ) + "\n",
    );
    return;
  }
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
