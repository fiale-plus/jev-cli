import { describe, it, beforeEach, afterEach, mock } from "node:test";
import assert from "node:assert/strict";
import { JevClient, JevApiError, estimateCostUsd } from "../api/client.js";
import {
  SYSTEM_ONE_RESPONSE,
  MIXED_RESPONSE,
  MODELS_RESPONSE,
} from "./fixtures/systemone.js";

interface MockCall {
  arguments: unknown[];
}

interface FetchMock {
  mock: { calls: MockCall[] };
}

let client: JevClient;
let fetchMock: FetchMock;
interface MockResponseShape {
  ok: boolean;
  status: number;
  headers: { get(name: string): string | null };
  json(): Promise<unknown>;
  text(): Promise<string>;
}

type MockFetchFn = (...args: unknown[]) => Promise<MockResponseShape>;

function mockFetch(response: unknown, status = 200, headers: Record<string, string> = {}) {
  const fn: MockFetchFn = async () => ({
    ok: status >= 200 && status < 300,
    status,
    headers: { get: (name: string) => headers[name.toLowerCase()] ?? null },
    json: async () => response,
    text: async () => JSON.stringify(response),
  });
  fetchMock = mock.fn(fn);
  globalThis.fetch = fetchMock as unknown as typeof fetch;
}

function firstCallArgs(): unknown[] {
  const calls = fetchMock.mock.calls;
  if (calls.length === 0) throw new Error("fetch was not called");
  return calls[0].arguments;
}

function getCalledUrl(): string {
  const url = firstCallArgs()[0];
  if (typeof url !== "string") throw new Error("fetch called without URL string");
  return url;
}

function getCalledOptions(): RequestInit {
  const opts = firstCallArgs()[1];
  if (typeof opts !== "object" || opts === null) throw new Error("fetch called without options");
  return opts as RequestInit;
}

function getCalledBody(): Record<string, unknown> {
  const body = getCalledOptions().body;
  if (typeof body !== "string") throw new Error("expected JSON string body");
  const parsed: unknown = JSON.parse(body);
  if (typeof parsed !== "object" || parsed === null) throw new Error("expected JSON object body");
  return parsed as Record<string, unknown>;
}

describe("JevClient", () => {
  beforeEach(() => {
    client = new JevClient("test-key", { maxRetries: 0 });
  });

  afterEach(() => {
    mock.restoreAll();
  });

  describe("request mechanics", () => {
    it("POSTs state+model+questions to /v1/systemone", async () => {
      mockFetch(SYSTEM_ONE_RESPONSE);
      await client.systemOne("some state", {
        q: { type: "noul", instructions: "Is it urgent?" },
      });
      assert.equal(getCalledUrl(), "https://api.typesafe.ai/v1/systemone");
      assert.equal(getCalledOptions().method, "POST");
      const body = getCalledBody();
      assert.equal(body.state, "some state");
      assert.equal(body.model, "jev-latest");
      assert.deepEqual(body.questions, { q: { type: "noul", instructions: "Is it urgent?" } });
    });

    it("sends Bearer auth and jev-cli User-Agent", async () => {
      mockFetch(SYSTEM_ONE_RESPONSE);
      await client.systemOne("s", { q: { type: "noul", instructions: "x?" } });
      const headers = getCalledOptions().headers;
      if (typeof headers !== "object" || headers === null || Array.isArray(headers)) {
        throw new Error("expected headers object");
      }
      const h: Record<string, unknown> = headers as Record<string, unknown>;
      assert.equal(h.Authorization, "Bearer test-key");
      assert.equal(h["User-Agent"], "jev-cli");
      assert.equal(h["Content-Type"], "application/json");
    });

    it("passes structured state through untouched", async () => {
      mockFetch(MIXED_RESPONSE);
      const state = { ticket: { text: "x", priority: 1 }, tags: ["a"] };
      await client.systemOne(state, { q: { type: "noul", instructions: "x?" } });
      assert.deepEqual(getCalledBody().state, state);
    });

    it("honors TYPESAFE_BASE_URL override", async () => {
      process.env.TYPESAFE_BASE_URL = "https://proxy.example.com";
      try {
        const c = new JevClient("k", { maxRetries: 0 });
        mockFetch(SYSTEM_ONE_RESPONSE);
        await c.systemOne("s", { q: { type: "noul", instructions: "x?" } });
        assert.ok(getCalledUrl().startsWith("https://proxy.example.com/v1/systemone"));
      } finally {
        delete process.env.TYPESAFE_BASE_URL;
      }
    });

    it("GETs /v1/models for listModels", async () => {
      mockFetch(MODELS_RESPONSE);
      const out = await client.listModels();
      assert.equal(getCalledUrl(), "https://api.typesafe.ai/v1/models");
      assert.equal(getCalledOptions().method, "GET");
      assert.equal(out.models.length, 2);
    });

    it("throws JevApiError with status on 400", async () => {
      mockFetch({ message: "bad questions" }, 400);
      await assert.rejects(() => client.systemOne("s", {}), (err: unknown) => {
        assert.ok(err instanceof JevApiError);
        if (err instanceof JevApiError) assert.equal(err.status, 400);
        return true;
      });
    });

    it("retries 429 then succeeds", async () => {
      const c = new JevClient("k", { maxRetries: 2, timeout: 5000 });
      let calls = 0;
      const fn: MockFetchFn = async (): Promise<MockResponseShape> => {
        calls++;
        if (calls === 1) {
          return { ok: false, status: 429, headers: { get: () => "0" }, text: async () => "slow down", json: async () => ({}) };
        }
        return {
          ok: true, status: 200, headers: { get: () => null },
          json: async () => SYSTEM_ONE_RESPONSE, text: async () => "{}",
        };
      };
      fetchMock = mock.fn(fn);
      globalThis.fetch = fn as typeof fetch;
      const out = await c.systemOne("s", { q: { type: "noul", instructions: "x?" } });
      assert.equal(calls, 2);
      assert.equal(out.model, "jev-1.13.0");
    });
  });

  describe("estimateCostUsd", () => {
    it("prices input at $42/Btok", () => {
      assert.equal(estimateCostUsd(1e9), 42);
      assert.equal(estimateCostUsd(0), 0);
    });
  });
});
