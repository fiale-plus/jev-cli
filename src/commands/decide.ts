import { mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import type { GlobalOptions } from "../cli/parseArgs.js";
import type { OutputFormat } from "../cli/formatters.js";
import { formatGate } from "../cli/formatters.js";
import { evaluatePolicy } from "../cli/policy.js";
import { buildRecord, writeRecord, appendRecordJsonl } from "../cli/records.js";
import { createClient, type ClientOpts } from "../api/client.js";
import { readJsonFile, readState } from "../utils/io.js";
import { abortSignal } from "./requests.js";
import { loadPack, loadPackFile } from "./packs.js";
import { resolvePolicy } from "./gate.js";
import { hashValue } from "../utils/hash.js";

export async function handleDecide(global: GlobalOptions, opts: ClientOpts, format: OutputFormat): Promise<void> {
  if (global.pack === undefined && global.packFile === undefined) throw new Error("Missing policy pack: decide requires --pack <name> or --pack-file <path>.");
  if (global.policy !== undefined) throw new Error("Conflicting inputs: decide uses the policy in --pack or --pack-file.");
  const loaded = global.pack !== undefined ? loadPack(global.pack) : loadPackFile(global.packFile as string);
  const state = await readState({ state: global.state, stateFile: global.stateFile, stateFormat: global.stateFormat, stdin: global.stdin, extra: [] });
  const started = Date.now();
  const response = await createClient(opts).systemOne({ state: state as never, questions: loaded.pack.questions, ...(global.model !== undefined ? { model: global.model } : {}) }, { signal: abortSignal() });
  const record = buildRecord({ runId: global.runId, decisionId: global.decisionId, parentId: global.parentId, pack: { name: loaded.pack.name, pack_version: loaded.pack.pack_version, hash: loaded.hash }, modelRequested: global.model, state, questions: loaded.pack.questions, latencyMs: Date.now() - started }, response);
  if (global.recordJsonl !== undefined) {
    mkdirSync(dirname(resolve(global.recordJsonl)), { recursive: true });
    appendRecordJsonl(global.recordJsonl, record);
  }
  if (global.record !== undefined) {
    writeRecord(global.record, record);
    process.stderr.write(`record written: ${global.record} (${record.decision_id})\n`);
  }
  const { policy, pack, questionsHash, source } = resolvePolicy(global);
  const gate = evaluatePolicy(policy, response);
  const provenance = { policy_source: source, pack, model: response.model ?? null, record_version: record.record_version, pack_hash_matches_record: true, questions_match_record: true, response_answers_hash: `sha256:${hashValue(response.answers ?? {})}` };
  if (format === "decision") process.stdout.write(`${gate.decision}\n`);
  else if (format === "json") process.stdout.write(JSON.stringify({ response, gate, provenance, record: { run_id: record.run_id, decision_id: record.decision_id } }, null, 2) + "\n");
  else process.stdout.write(formatGate(gate, provenance, format) + "\n");
  process.exitCode = gate.exit_code;
}
