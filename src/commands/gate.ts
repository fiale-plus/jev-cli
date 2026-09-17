import type { GlobalOptions } from "../cli/parseArgs.js";
import type { OutputFormat } from "../cli/formatters.js";
import { formatGate } from "../cli/formatters.js";
import type { GatePolicy } from "../cli/policy.js";
import { GATE_EXIT, coercePolicy, evaluatePolicy } from "../cli/policy.js";
import { extractResponse, isRecord } from "../cli/records.js";
import { loadPack } from "./packs.js";
import { hashValue } from "../utils/hash.js";
import { readJsonFile } from "../utils/io.js";

export interface ResolvedPolicy {
  policy: GatePolicy;
  pack: { name: string; pack_version: number; hash: string } | null;
  source: string;
}

// Exactly one policy source. A pack carries its own policy, so `--pack verify` is
// enough; `--policy file.json` is for policies tuned on your own data.
export function resolvePolicy(global: GlobalOptions): ResolvedPolicy {
  if (global.policy !== undefined && global.pack !== undefined) {
    throw new Error("Conflicting inputs: --policy and --pack are mutually exclusive.");
  }
  if (global.pack !== undefined) {
    const loaded = loadPack(global.pack);
    return {
      policy: loaded.pack.policy,
      pack: { name: loaded.pack.name, pack_version: loaded.pack.pack_version, hash: loaded.hash },
      source: loaded.path,
    };
  }
  if (global.policy !== undefined) {
    const raw = readRecordOrJson(global.policy);
    const policy = coercePolicy(raw);
    return { policy, pack: null, source: global.policy };
  }
  throw new Error("Missing policy: pass --pack <name> or --policy <file>. Run `jev packs` to list packs.");
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
  const { policy, pack, source } = resolvePolicy(global);

  const input = readJsonFile(global.input);
  const response = extractResponse(input);
  const result = evaluatePolicy(policy, response);

  const provenance = {
    policy_source: source,
    pack,
    model: response.model ?? null,
    record_version: isRecord(input) ? input.record_version : null,
    pack_hash_matches_record:
      isRecord(input) && input.pack !== null && pack !== null ? input.pack.hash === pack.hash : null,
    response_answers_hash: `sha256:${hashValue(response.answers ?? {})}`,
  };

  process.stdout.write(formatGate(result, provenance, format) + "\n");
  process.exitCode = GATE_EXIT[result.decision];
}
