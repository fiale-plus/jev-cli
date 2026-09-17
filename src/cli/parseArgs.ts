import { parseArgs } from "node:util";

export interface GlobalOptions {
  apiKey?: string;
  model: string;
  baseUrl?: string;
  format: "json" | "table";
  state?: string;
  stateFile?: string;
  stdin: boolean;
  questions?: string;
  options: string[];
  levels: string[];
  trueMeans?: string;
  falseMeans?: string;
  yesAt?: string;
  noAt?: string;
  actAbove?: string;
  reviewAbove?: string;
  timeout?: string;
  retries?: string;
  dataset?: string;
  limit?: string;
  help: boolean;
  version: boolean;
}

const OPTIONS = {
  "api-key": { type: "string" as const },
  model: { type: "string" as const, default: "jev-latest" },
  "base-url": { type: "string" as const },
  format: { type: "string" as const, short: "f", default: "json" },
  state: { type: "string" as const },
  "state-file": { type: "string" as const },
  stdin: { type: "boolean" as const, default: false },
  questions: { type: "string" as const },
  option: { type: "string" as const, multiple: true as const, default: [] as string[] },
  level: { type: "string" as const, multiple: true as const, default: [] as string[] },
  "true-means": { type: "string" as const },
  "false-means": { type: "string" as const },
  "yes-at": { type: "string" as const },
  "no-at": { type: "string" as const },
  "act-above": { type: "string" as const },
  "review-above": { type: "string" as const },
  timeout: { type: "string" as const },
  retries: { type: "string" as const },
  dataset: { type: "string" as const },
  limit: { type: "string" as const },
  help: { type: "boolean" as const, default: false },
  version: { type: "boolean" as const, default: false },
};

export function parseGlobal(argv: string[]) {
  return parseArgs({ args: argv, options: OPTIONS, strict: false, allowPositionals: true });
}

export function extractGlobalOpts(values: Record<string, unknown>): GlobalOptions {
  const format = (values.format as string) || "json";
  if (format !== "json" && format !== "table") {
    throw new Error(`Invalid --format: "${format}". Expected json|table.`);
  }
  const asArray = (v: unknown): string[] => (Array.isArray(v) ? (v as string[]) : []);
  return {
    apiKey: values["api-key"] as string | undefined,
    model: (values.model as string) || "jev-latest",
    baseUrl: values["base-url"] as string | undefined,
    format: format as "json" | "table",
    state: values.state as string | undefined,
    stateFile: values["state-file"] as string | undefined,
    stdin: (values.stdin as boolean) || false,
    questions: values.questions as string | undefined,
    options: asArray(values.option),
    levels: asArray(values.level),
    trueMeans: values["true-means"] as string | undefined,
    falseMeans: values["false-means"] as string | undefined,
    yesAt: values["yes-at"] as string | undefined,
    noAt: values["no-at"] as string | undefined,
    actAbove: values["act-above"] as string | undefined,
    reviewAbove: values["review-above"] as string | undefined,
    timeout: values.timeout as string | undefined,
    retries: values.retries as string | undefined,
    dataset: values.dataset as string | undefined,
    limit: values.limit as string | undefined,
    help: (values.help as boolean) || false,
    version: (values.version as boolean) || false,
  };
}
