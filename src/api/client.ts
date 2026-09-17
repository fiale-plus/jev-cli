import type {
  ModelsResponse,
  Question,
  SystemOneResponse,
} from "./types.js";

const DEFAULT_BASE_URL = "https://api.typesafe.ai";
const DEFAULT_MODEL = "jev-latest";
// Pricing per https://docs.typesafe.ai/models: $42 per Btok input, output free.
export const PRICE_PER_INPUT_TOKEN = 42 / 1e9;

export class JevApiError extends Error {
  constructor(
    public readonly status: number,
    public readonly errorMessage: string,
  ) {
    super(`TypeSafe API error ${status}: ${errorMessage}`);
    this.name = "JevApiError";
  }
}

export interface RetryOptions {
  maxRetries: number;
}

function sleep(ms: number): Promise<void> {
  // Executor form (not Promise.withResolvers): Node 18 compat per engines.
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function retryAfterMs(res: Response, attempt: number): number {
  const header = res.headers.get("retry-after");
  if (header) {
    const secs = Number(header);
    if (Number.isFinite(secs)) return Math.max(0, secs * 1000);
  }
  return Math.min(1000 * 2 ** attempt, 8000);
}

export class JevClient {
  private apiKey: string;
  private baseUrl: string;
  private timeout: number;
  private maxRetries: number;

  constructor(apiKey: string, opts: { baseUrl?: string; timeout?: number; maxRetries?: number } = {}) {
    this.apiKey = apiKey;
    this.baseUrl = (opts.baseUrl || process.env.TYPESAFE_BASE_URL || DEFAULT_BASE_URL).replace(/\/$/, "");
    this.timeout = opts.timeout ?? 30_000;
    this.maxRetries = opts.maxRetries ?? 3;
  }

  private async request<T>(path: string, body?: object): Promise<T> {
    const url = `${this.baseUrl}${path}`;
    let lastError: unknown = null;

    for (let attempt = 0; attempt <= this.maxRetries; attempt++) {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), this.timeout);
      try {
        const res = await fetch(url, {
          method: body === undefined ? "GET" : "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${this.apiKey}`,
            "User-Agent": "jev-cli",
          },
          body: body === undefined ? undefined : JSON.stringify(body),
          signal: controller.signal,
        });

        if (res.status === 429 || (res.status >= 500 && res.status < 600)) {
          lastError = new JevApiError(res.status, await res.text().catch(() => "Unknown error"));
          if (attempt < this.maxRetries) {
            await sleep(retryAfterMs(res, attempt));
            continue;
          }
          throw lastError;
        }

        if (!res.ok) {
          const text = await res.text().catch(() => "Unknown error");
          throw new JevApiError(res.status, text);
        }

        return (await res.json()) as T;
      } catch (err) {
        if (err instanceof JevApiError) throw err;
        lastError = err;
        if (attempt < this.maxRetries) {
          await sleep(Math.min(1000 * 2 ** attempt, 8000));
          continue;
        }
        throw err;
      } finally {
        clearTimeout(timer);
      }
    }
    throw lastError;
  }

  async systemOne(state: unknown, questions: Record<string, Question>, model = DEFAULT_MODEL): Promise<SystemOneResponse> {
    return this.request<SystemOneResponse>("/v1/systemone", { state, model, questions });
  }

  async listModels(): Promise<ModelsResponse> {
    return this.request<ModelsResponse>("/v1/models");
  }
}

export function estimateCostUsd(inputTokens: number): number {
  return inputTokens * PRICE_PER_INPUT_TOKEN;
}
