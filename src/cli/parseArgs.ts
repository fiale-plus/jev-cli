import { parseArgs } from "node:util";

export interface GlobalOptions {
  apiKey?: string;
  model?: string;
  baseUrl?: string;
  logLevel?: string;
  format: "json" | "table" | "decision";
  request?: string;
  state?: string;
  stateFile?: string;
  stateFormat: "text" | "json";
  stdin: boolean;
  questions?: string;
  options: string[];
  levels: string[];
  trueMeans?: string;
  falseMeans?: string;
  timeout?: string;
  retries?: string;
  concurrency?: string;
  pack?: string;
  packFile?: string;
  policy?: string;
  input?: string;
  record?: string;
  recordJsonl?: string;
  runId?: string;
  decisionId?: string;
  parentId?: string;
  live: boolean;
  help: boolean;
  version: boolean;
}

const OPTIONS = {
  "api-key": { type: "string" as const },
  model: { type: "string" as const },
  "base-url": { type: "string" as const },
  "log-level": { type: "string" as const },
  format: { type: "string" as const, short: "f", default: "json" },
  request: { type: "string" as const },
  state: { type: "string" as const },
  "state-file": { type: "string" as const },
  "state-format": { type: "string" as const, default: "text" },
  stdin: { type: "boolean" as const, default: false },
  questions: { type: "string" as const },
  option: { type: "string" as const, multiple: true as const, default: [] as string[] },
  level: { type: "string" as const, multiple: true as const, default: [] as string[] },
  "true-means": { type: "string" as const },
  "false-means": { type: "string" as const },
  timeout: { type: "string" as const },
  retries: { type: "string" as const },
  concurrency: { type: "string" as const },
  pack: { type: "string" as const },
  "pack-file": { type: "string" as const },
  policy: { type: "string" as const },
  input: { type: "string" as const },
  record: { type: "string" as const },
  "record-jsonl": { type: "string" as const },
  "run-id": { type: "string" as const },
  "decision-id": { type: "string" as const },
  "parent-id": { type: "string" as const },
  live: { type: "boolean" as const, default: false },
  help: { type: "boolean" as const, default: false },
  version: { type: "boolean" as const, default: false },
};


export function parseGlobal(argv: string[]) {
  return parseArgs({ args: argv, options: OPTIONS, strict: true, allowPositionals: true });
}

export function extractGlobalOpts(values: Record<string, unknown>): GlobalOptions {
  const format = (values.format as string) || "json";
  if (format !== "json" && format !== "table" && format !== "decision") {
    throw new Error(`Invalid --format: "${format}". Expected json|table|decision.`);
  }
  const stateFormat = (values["state-format"] as string) || "text";
  if (stateFormat !== "text" && stateFormat !== "json") {
    throw new Error(`Invalid --state-format: "${stateFormat}". Expected text|json.`);
  }
  const logLevel = values["log-level"] as string | undefined;
  if (logLevel !== undefined && !["debug", "info", "warn", "error", "off"].includes(logLevel)) {
    throw new Error(`Invalid --log-level: "${logLevel}". Expected debug|info|warn|error|off.`);
  }
  const asArray = (v: unknown): string[] => (Array.isArray(v) ? (v as string[]) : []);
  return {
    apiKey: values["api-key"] as string | undefined,
    model: values.model as string | undefined,
    baseUrl: values["base-url"] as string | undefined,
    logLevel,
    format: format as "json" | "table" | "decision",
    request: values.request as string | undefined,
    state: values.state as string | undefined,
    stateFile: values["state-file"] as string | undefined,
    stateFormat: stateFormat as "text" | "json",
    stdin: (values.stdin as boolean) || false,
    questions: values.questions as string | undefined,
    options: asArray(values.option),
    levels: asArray(values.level),
    trueMeans: values["true-means"] as string | undefined,
    falseMeans: values["false-means"] as string | undefined,
    timeout: values.timeout as string | undefined,
    retries: values.retries as string | undefined,
    concurrency: values.concurrency as string | undefined,
    pack: values.pack as string | undefined,
    packFile: values["pack-file"] as string | undefined,
    policy: values.policy as string | undefined,
    input: values.input as string | undefined,
    record: values.record as string | undefined,
    recordJsonl: values["record-jsonl"] as string | undefined,
    runId: values["run-id"] as string | undefined,
    decisionId: values["decision-id"] as string | undefined,
    parentId: values["parent-id"] as string | undefined,
    live: (values.live as boolean) || false,
    help: (values.help as boolean) || false,
    version: (values.version as boolean) || false,
  };
}
