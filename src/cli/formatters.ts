import type { Questions, SystemOneResult } from "@typesafe-ai/sdk";
import { estimateCostUsd } from "../api/client.js";
import type { DecisionRecord } from "./records.js";
import type { GateResult } from "./policy.js";

export type OutputFormat = "json" | "table";

export interface DoctorCheck {
  name: string;
  status: "ok" | "warn" | "fail";
  detail: string;
}

export interface PackSummary {
  name: string;
  pack_version: number;
  description: string;
  hash: string;
  ruleCount: number;
  questionCount: number;
}

export interface GateProvenance {
  policy_source: string;
  pack: { name: string; pack_version: number; hash: string } | null;
  model: string | null;
  record_version: number | null;
  pack_hash_matches_record: boolean | null;
  questions_match_record: boolean | null;
  response_answers_hash: string;
}

function shortHash(hash: string): string {
  const hex = hash.startsWith("sha256:") ? hash.slice(7) : hash;
  return `sha256:${hex.slice(0, 12)}`;
}

export interface JsonError {
  error: {
    code: string;
    message: string;
    details?: unknown;
  };
}

export function formatJsonError(code: string, message: string, details?: unknown): string {
  const payload: JsonError = { error: { code, message, ...(details !== undefined ? { details } : {}) } };
  return JSON.stringify(payload);
}

function formatNumber(value: unknown): string {
  return typeof value === "number" && Number.isFinite(value) ? value.toFixed(3) : String(value);
}

// Every JSON response carries a cost block: callers budget with it.
export function enrichResponse(response: SystemOneResult<Questions>): SystemOneResult<Questions> & { cost: Record<string, unknown> } {
  return {
    ...response,
    cost: {
      input_tokens: response.usage.input_tokens,
      output_tokens: response.usage.output_tokens,
      estimated_usd: estimateCostUsd(response.usage.input_tokens),
      note: "display-only estimate: input billed, output free",
    },
  };
}

export function formatOutput(response: SystemOneResult<Questions>, format: OutputFormat): string {
  if (format === "json") return JSON.stringify(enrichResponse(response), null, 2);
  return formatTable(response);
}

function formatTable(response: SystemOneResult<Questions>): string {
  const lines: string[] = [`model: ${response.model}`];
  const answers = response.answers as unknown as Record<string, { type: string } & Record<string, unknown>>;
  for (const [id, ans] of Object.entries(answers)) {
    if (ans.type === "noul") {
      lines.push(`${id}: noul=${formatNumber(ans.noul)}`);
    } else if (ans.type === "choice") {
      lines.push(`${id}: choice=${String(ans.choice)} confidence=${formatNumber(ans.confidence)}`);
      const probs = ans.probabilities as Record<string, unknown> | undefined;
      for (const [opt, p] of Object.entries(probs ?? {})) {
        lines.push(`  ${opt}: ${formatNumber(p)}`);
      }
    } else if (ans.type === "score") {
      lines.push(`${id}: score=${formatNumber(ans.score)} confidence=${formatNumber(ans.confidence)}`);
      const probs = ans.probabilities as Record<string, unknown> | undefined;
      for (const [level, p] of Object.entries(probs ?? {})) {
        lines.push(`  [${level}]: ${formatNumber(p)}`);
      }
    } else {
      lines.push(`${id}: ${JSON.stringify(ans)}`);
    }
  }
  lines.push(
    `usage: ${response.usage.input_tokens} in / ${response.usage.output_tokens} out (~$${estimateCostUsd(response.usage.input_tokens).toFixed(6)})`,
  );
  return lines.join("\n");
}

export function formatGate(result: GateResult, provenance: GateProvenance, format: OutputFormat): string {
  if (format === "json") return JSON.stringify({ gate: result, provenance }, null, 2);
  const lines = [
    `decision: ${result.decision} (exit ${result.exit_code})`,
    `policy: ${result.policy} v${result.policy_version} ${shortHash(result.policy_hash)} mode=${result.mode}`,
  ];
  if (result.rules.length === 0) lines.push("  (no rules applied)");
  for (const rule of result.rules) {
    lines.push(`  ${rule.answer} [${rule.type}] ${rule.decision} — ${rule.reason}`);
  }
  if (provenance.pack !== null) {
    const match =
      provenance.pack_hash_matches_record === null
        ? "no record to compare"
        : provenance.pack_hash_matches_record
          ? "matches record"
          : provenance.questions_match_record
            ? "thresholds changed since the record"
            : "differs from record";
    lines.push(`pack: ${provenance.pack.name}@${provenance.pack.pack_version} ${shortHash(provenance.pack.hash)} (${match})`);
  }
  lines.push(
    `provenance: model ${provenance.model ?? "unknown"}, source ${provenance.policy_source}${provenance.record_version !== null ? `, record v${provenance.record_version}` : ""}`,
  );
  return lines.join("\n");
}

export function formatDoctor(version: string, checks: DoctorCheck[], format: OutputFormat): string {
  if (format === "json") {
    return JSON.stringify(
      { cli_version: version, ok: !checks.some((c) => c.status === "fail"), checks },
      null,
      2,
    );
  }
  const lines = [`jev doctor ${version}`];
  const order = { fail: 0, warn: 1, ok: 2 } as const;
  for (const check of [...checks].sort((a, b) => order[a.status] - order[b.status])) {
    lines.push(`${check.status.padEnd(4)} ${check.name.padEnd(16)} ${check.detail}`);
  }
  const failed = checks.filter((c) => c.status === "fail").length;
  const warned = checks.filter((c) => c.status === "warn").length;
  lines.push(failed > 0 ? `${failed} check(s) failed` : warned > 0 ? `${warned} warning(s)` : "all checks passed");
  return lines.join("\n");
}

export function formatPacks(packs: PackSummary[], format: OutputFormat): string {
  if (format === "json") return JSON.stringify({ packs }, null, 2);
  if (packs.length === 0) return "no packs found";
  const lines = ["name\tversion\tquestions\trules\thash\tdescription"];
  for (const pack of packs) {
    lines.push(`${pack.name}\t${pack.pack_version}\t${pack.questionCount}\t${pack.ruleCount}\t${shortHash(pack.hash)}\t${pack.description}`);
  }
  return lines.join("\n");
}

// Replay re-emits a stored response and says so: never mistaken for a fresh call.
export function formatReplay(record: DecisionRecord, format: OutputFormat): string {
  if (format === "json") {
    return JSON.stringify(
      {
        ...enrichResponse(record.response),
        replayed: true,
        replay: {
          created_at: record.created_at,
          cli_version: record.cli_version,
          record_version: record.record_version,
          model_requested: record.model_requested,
          model_resolved: record.model_resolved,
          pack: record.pack,
          latency_ms: record.latency_ms,
        },
      },
      null,
      2,
    );
  }
  return [
    `replayed: true (record from ${record.created_at} by jev ${record.cli_version}, original latency ${record.latency_ms} ms)`,
    formatTable(record.response),
  ].join("\n");
}
