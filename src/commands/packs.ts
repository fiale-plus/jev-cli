import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import type { Questions } from "@typesafe-ai/sdk";
import { packsDir } from "../utils/package.js";
import { hashValue } from "../utils/hash.js";
import { lintQuestions } from "../cli/lint.js";
import type { GatePolicy } from "../cli/policy.js";
import { coercePolicy } from "../cli/policy.js";
import type { OutputFormat } from "../cli/formatters.js";
import { formatPacks } from "../cli/formatters.js";

export interface Pack {
  pack_version: number;
  name: string;
  description: string;
  state_contract?: Record<string, string>;
  questions: Questions;
  policy: GatePolicy;
}

export interface LoadedPack {
  pack: Pack;
  /** sha256 over the questions and policy, so a decision can name the exact pack revision. */
  hash: string;
  path: string;
}

function packFile(name: string): string {
  if (!/^[a-z0-9][a-z0-9_-]*$/.test(name)) {
    throw new Error(`Invalid pack name: "${name}". Use lowercase letters, digits, "-" or "_".`);
  }
  return join(packsDir(), `${name}.json`);
}

export function packNames(): string[] {
  try {
    return readdirSync(packsDir())
      .filter((file) => file.endsWith(".json"))
      .map((file) => file.slice(0, -5))
      .sort();
  } catch {
    return [];
  }
}

export function loadPack(name: string): LoadedPack {
  const path = packFile(name);
  let raw: unknown;
  try {
    raw = JSON.parse(readFileSync(path, "utf8")) as unknown;
  } catch (err) {
    const available = packNames();
    throw new Error(
      `Unknown pack "${name}" (${err instanceof Error ? err.message : String(err)}). Available: ${available.length > 0 ? available.join(", ") : "none"}.`,
    );
  }
  if (typeof raw !== "object" || raw === null) throw new Error(`Invalid pack "${name}": expected a JSON object.`);
  const record = raw as Record<string, unknown>;
  if (record.pack_version !== 1) throw new Error(`Invalid pack "${name}": pack_version must be 1.`);
  if (typeof record.name !== "string" || record.name !== name) {
    throw new Error(`Invalid pack "${name}": name must match the file name.`);
  }
  if (typeof record.description !== "string" || record.description.trim().length === 0) {
    throw new Error(`Invalid pack "${name}": description is required.`);
  }

  const questionsLint = lintQuestions(record.questions);
  if (!questionsLint.ok) {
    const first = questionsLint.issues.find((i) => i.severity === "error");
    throw new Error(`Invalid pack "${name}": questions ${first?.qid ? `(${first.qid}) ` : ""}[${first?.code}]: ${first?.message}`);
  }
  const policy = coercePolicy(record.policy);

  const pack = record as unknown as Pack;
  return { pack, hash: `sha256:${hashValue({ questions: pack.questions, policy })}`, path };
}

export function listPacks(): Array<{ name: string; pack_version: number; description: string; hash: string; ruleCount: number; questionCount: number }> {
  return packNames().map((name) => {
    const { pack, hash } = loadPack(name);
    return {
      name: pack.name,
      pack_version: pack.pack_version,
      description: pack.description,
      hash,
      ruleCount: pack.policy.rules.length,
      questionCount: Object.keys(pack.questions).length,
    };
  });
}

export function handlePacks(positionals: string[], format: OutputFormat): void {
  const [name] = positionals;
  if (name !== undefined) {
    const { pack, hash, path } = loadPack(name);
    process.stdout.write(JSON.stringify({ ...pack, hash, path }, null, 2) + "\n");
    return;
  }
  process.stdout.write(formatPacks(listPacks(), format) + "\n");
}
