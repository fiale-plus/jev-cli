import {
  APIError,
  TypeSafeClient,
  TypeSafeError,
  choice,
  noul,
  score,
} from "@typesafe-ai/sdk";
import type {
  LogLevel,
  Logger,
  ModelCard,
  Questions,
  SystemOneResult,
} from "@typesafe-ai/sdk";

export type { LogLevel, ModelCard, Questions, SystemOneResult };
export { APIError, TypeSafeClient, TypeSafeError, choice, noul, score };

// Pricing per https://docs.typesafe.ai/models: $42 per Btok input, output free.
// Display-only estimate; never used for enforcement.
export const PRICE_PER_INPUT_TOKEN = 42 / 1e9;

export interface ClientOpts {
  apiKey: string;
  baseUrl?: string;
  model?: string;
  timeout?: number;
  maxRetries?: number;
  logLevel?: LogLevel;
  signal?: AbortSignal;
}

function baseClientOpts(opts: ClientOpts): ConstructorParameters<typeof TypeSafeClient>[0] {
  return {
    apiKey: opts.apiKey,
    ...(opts.baseUrl !== undefined ? { baseURL: opts.baseUrl } : {}),
    ...(opts.model !== undefined ? { defaultModel: opts.model } : {}),
    ...(opts.timeout !== undefined ? { timeout: opts.timeout } : {}),
    ...(opts.maxRetries !== undefined ? { retry: { maxRetries: opts.maxRetries } } : {}),
    ...(opts.logLevel !== undefined ? { logLevel: opts.logLevel } : {}),
    // Always isolate SDK diagnostics from stdout: machine output owns stdout,
    // every log level goes to stderr.
    logger: stderrLogger,
  };
}

// SDK logger targeting stderr at every level so piped stdout stays parseable.
const stderrLogger: Logger = {
  debug: (message: string, ...args: unknown[]) => {
    process.stderr.write(`[typesafe-sdk] ${message}${args.length > 0 ? ` ${args.map((a) => String(a)).join(" ")}` : ""}\n`);
  },
  info: (message: string, ...args: unknown[]) => {
    process.stderr.write(`[typesafe-sdk] ${message}${args.length > 0 ? ` ${args.map((a) => String(a)).join(" ")}` : ""}\n`);
  },
  warn: (message: string, ...args: unknown[]) => {
    process.stderr.write(`[typesafe-sdk] ${message}${args.length > 0 ? ` ${args.map((a) => String(a)).join(" ")}` : ""}\n`);
  },
  error: (message: string, ...args: unknown[]) => {
    process.stderr.write(`[typesafe-sdk] ${message}${args.length > 0 ? ` ${args.map((a) => String(a)).join(" ")}` : ""}\n`);
  },
};

export function createClient(opts: ClientOpts): TypeSafeClient {
  return new TypeSafeClient(baseClientOpts(opts));
}

export async function systemOne<Q extends Questions>(
  opts: ClientOpts,
  state: unknown,
  questions: Q,
): Promise<SystemOneResult<Q>> {
  const client = createClient(opts);
  return client.systemOne(
    { state: state as never, questions },
    { ...(opts.signal !== undefined ? { signal: opts.signal } : {}) },
  );
}

export function estimateCostUsd(inputTokens: number): number {
  return inputTokens * PRICE_PER_INPUT_TOKEN;
}
