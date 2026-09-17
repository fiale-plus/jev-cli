import {
  APIError,
  TypeSafeClient,
  TypeSafeError,
  choice,
  noul,
  score,
} from "@typesafe-ai/sdk";
import type {
  ModelCard,
  Questions,
  SystemOneResult,
} from "@typesafe-ai/sdk";

export type { ModelCard, Questions, SystemOneResult };
export { APIError, TypeSafeClient, TypeSafeError, choice, noul, score };

// Pricing per https://docs.typesafe.ai/models: $42 per Btok input, output free.
export const PRICE_PER_INPUT_TOKEN = 42 / 1e9;

export interface ClientOpts {
  apiKey: string;
  baseUrl?: string;
  model?: string;
  timeout?: number;
  maxRetries?: number;
}

function baseClientOpts(opts: ClientOpts): ConstructorParameters<typeof TypeSafeClient>[0] {
  return {
    apiKey: opts.apiKey,
    ...(opts.baseUrl !== undefined ? { baseURL: opts.baseUrl } : {}),
    ...(opts.model !== undefined ? { defaultModel: opts.model } : {}),
    ...(opts.timeout !== undefined ? { timeout: opts.timeout } : {}),
    ...(opts.maxRetries !== undefined ? { retry: { maxRetries: opts.maxRetries } } : {}),
  };
}

export function createClient(opts: ClientOpts): TypeSafeClient {
  return new TypeSafeClient(baseClientOpts(opts));
}

export async function systemOne<Q extends Questions>(
  opts: ClientOpts,
  state: unknown,
  questions: Q,
): Promise<SystemOneResult<Q>> {
  const client = createClient(opts);
  return client.systemOne({ state: state as never, questions });
}

export function estimateCostUsd(inputTokens: number): number {
  return inputTokens * PRICE_PER_INPUT_TOKEN;
}
