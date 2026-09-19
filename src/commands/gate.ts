import type { GlobalOptions } from "../cli/parseArgs.js";
import type { OutputFormat } from "../cli/formatters.js";
import { formatGate } from "../cli/formatters.js";
import type { GatePolicy } from "../cli/policy.js";
import { GATE_EXIT, coercePolicy, evaluatePolicy } from "../cli/policy.js";
import { extractResponse, isRecord, readRecord } from "../cli/records.js";
import { loadPack, loadPackFile } from "./packs.js";
import { readJsonFile } from "../utils/io.js";
import { hashValue } from "../utils/hash.js";

export interface ResolvedPolicy {
  policy: GatePolicy;
  pack: { name: string; pack_version: number; hash: string } | null;
  /** Hash of the pack's questions alone, to separate "questions changed" from "thresholds changed". */
  questionsHash: string | null;
  source: string;
}

// Exactly one policy source. A pack carries its own policy, so `--pack verify` is
// enough; `--policy file.json` is for policies tuned on your own data.
export function resolvePolicy(global: GlobalOptions): ResolvedPolicy {
  if (global.policy !== undefined && (global.pack !== undefined || global.packFile !== undefined)) throw new Error("Conflicting inputs: --policy and pack options are mutually exclusive.");
  if (global.pack !== undefined || global.packFile !== undefined) {
    const loaded = global.pack !== undefined ? loadPack(global.pack) : loadPackFile(global.packFile as string);
    return { policy: loaded.pack.policy, pack: { name: loaded.pack.name, pack_version: loaded.pack.pack_version, hash: loaded.hash }, questionsHash: `sha256:${hashValue(loaded.pack.questions)}`, source: loaded.path };
  }
  if (global.policy !== undefined) {
    const policy = coercePolicy(readRecordOrJson(global.policy));
    return { policy, pack: null, questionsHash: null, source: global.policy };
  }
  throw new Error("Missing policy: pass --pack, --pack-file, or --policy. Run `jev packs` to list bundled packs.");
}

// A policy file may hold the policy itself or an object with a "policy" field.
function readRecordOrJson(path: string): unknown {
  const raw = readJsonFile(path);
  if (typeof raw === "object" && raw !== null && !Array.isArray(raw) && "policy" in (raw as Record<string, unknown>)) {
    return (raw as Record<string, unknown>).policy;
  }
  return raw;
}

export async function handleGate(global: GlobalOptions, format: OutputFormat): Promise<void> {
  if (!global.input) {
    throw new Error("Missing --input <file>: jev gate --input judgment.json --pack <name> | --policy <file>.");
  }
  const { policy, pack, questionsHash, source } = resolvePolicy(global);

  const input = readJsonFile(global.input);
  const record = isRecord(input) ? readRecord(input) : null;
  const response = record !== null ? record.response : extractResponse(input);

  // Gating a record against the pack that produced it: if the questions changed,
  // the stored answers no longer mean what the current rules assume. Re-deciding
  // old answers under new questions has to be deliberate, so it exits 1.
  const questionsMatch = record?.pack !== null && record?.pack !== undefined && questionsHash !== null
    ? record.questions_sha256 === questionsHash
    : null;
  if (questionsMatch === false) {
    throw new Error(
      `Pack "${pack?.name}" changed its questions since this record was written (record ${record?.pack?.hash}, current ${pack?.hash}). ` +
        "Stored answers cannot be re-judged under different questions. Re-run the request, or gate with --policy <file> if re-deciding is intended.",
    );
  }

  const packHashMatches = record?.pack !== null && record?.pack !== undefined && pack !== null ? record.pack.hash === pack.hash : null;
  if (packHashMatches === false) {
    process.stderr.write(
      `warning: pack "${pack?.name}" thresholds changed since this record was written (record ${record?.pack?.hash}, current ${pack?.hash}); the questions are unchanged, so the current policy is applied.\n`,
    );
  }

  const result = evaluatePolicy(policy, response);

  const provenance = {
    policy_source: source,
    pack,
    model: response.model ?? null,
    record_version: record?.record_version ?? null,
    pack_hash_matches_record: packHashMatches,
    questions_match_record: questionsMatch,
    response_answers_hash: `sha256:${hashValue(response.answers ?? {})}`,
  };

  process.stdout.write(formatGate(result, provenance, format) + "\n");
  process.exitCode = GATE_EXIT[result.decision];
}
