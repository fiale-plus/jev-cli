import { describe, it, beforeEach, afterEach, mock } from "node:test";
import assert from "node:assert/strict";
import { APIError, TypeSafeClient } from "@typesafe-ai/sdk";
import { createClient, estimateCostUsd, systemOne } from "../api/client.js";
import {
  SYSTEM_ONE_RESPONSE,
  MIXED_RESPONSE,
  MODELS_WIRE,
} from "./fixtures/systemone.js";

interface MockCall {
  arguments: unknown[];
}

interface FetchMock {
  mock: { calls: MockCall[] };
}

let fetchMock: FetchMock;

interface MockResponseShape {
  ok: boolean;
  status: number;
  headers: Headers;
  json(): Promise<unknown>;
  text(): Promise<string>;
}

type MockFetchFn = (...args: unknown[]) => Promise<MockResponseShape>;

function headersWith(values: Record<string, string>): Headers {
  const headers = new Headers();
  for (const [k, v] of Object.entries(values)) headers.set(k, v);
  return headers;
}

function mockFetch(response: unknown, status = 200, headers: Record<string, string> = {}) {
  const body = JSON.stringify(response);
  const fn: MockFetchFn = async () =>
    new Response(body, {
      status,
      headers: headersWith({ "content-type": "application/json", ...headers }),
    }) as MockResponseShape;
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

describe("SDK-backed transport", () => {
  beforeEach(() => {
    delete process.env.TYPESAFE_BASE_URL;
    delete process.env.TYPESAFE_DEFAULT_MODEL;
  });

  afterEach(() => {
    mock.restoreAll();
    delete process.env.TYPESAFE_BASE_URL;
    delete process.env.TYPESAFE_DEFAULT_MODEL;
  });

  describe("request mechanics", () => {
    it("POSTs state+model+questions to /v1/systemone", async () => {
      mockFetch(SYSTEM_ONE_RESPONSE);
      await systemOne({ apiKey: "test-key" }, "some state", {
        q: { type: "noul", instructions: "Is it urgent?" },
      });
      assert.equal(getCalledUrl(), "https://api.typesafe.ai/v1/systemone");
      assert.equal(getCalledOptions().method, "POST");
      const body = getCalledBody();
      assert.equal(body.state, "some state");
      assert.equal(body.model, "jev-latest");
      assert.deepEqual(body.questions, { q: { type: "noul", instructions: "Is it urgent?" } });
    });

    it("sends Bearer auth", async () => {
      mockFetch(SYSTEM_ONE_RESPONSE);
      await systemOne({ apiKey: "test-key" }, "s", { q: { type: "noul", instructions: "x?" } });
      const headers = getCalledOptions().headers;
      if (!(headers instanceof Headers)) {
        const h = headers as Record<string, unknown>;
        assert.equal(h.Authorization, "Bearer test-key");
        return;
      }
      assert.equal(headers.get("authorization"), "Bearer test-key");
    });

    it("passes structured state through untouched", async () => {
      mockFetch(MIXED_RESPONSE);
      const state = { ticket: { text: "x", priority: 1 }, tags: ["a"] };
      await systemOne({ apiKey: "test-key" }, state, { q: { type: "noul", instructions: "x?" } });
      assert.deepEqual(getCalledBody().state, state);
    });

    it("honors TYPESAFE_BASE_URL override", async () => {
      process.env.TYPESAFE_BASE_URL = "https://proxy.example.com";
      mockFetch(SYSTEM_ONE_RESPONSE);
      await systemOne({ apiKey: "k" }, "s", { q: { type: "noul", instructions: "x?" } });
      assert.ok(getCalledUrl().startsWith("https://proxy.example.com/v1/systemone"));
    });

    it("honors explicit model override", async () => {
      mockFetch(SYSTEM_ONE_RESPONSE);
      await systemOne({ apiKey: "k", model: "jev-1.13.0" }, "s", { q: { type: "noul", instructions: "x?" } });
      assert.equal(getCalledBody().model, "jev-1.13.0");
    });

    it("lists models through the SDK resource", async () => {
      mockFetch(MODELS_WIRE);
      const client = createClient({ apiKey: "k" });
      assert.ok(client instanceof TypeSafeClient);
      const out = await client.models.list();
      assert.equal(getCalledUrl(), "https://api.typesafe.ai/v1/models");
      assert.equal(getCalledOptions().method, "GET");
      assert.equal(out.length, 2);
    });

    it("surfaces API errors with status", async () => {
      mockFetch({ message: "bad questions" }, 400);
      await assert.rejects(
        systemOne({ apiKey: "k" }, "s", { q: { type: "noul", instructions: "x?" } }),
        (err: unknown) => {
          assert.ok(err instanceof APIError);
          if (err instanceof APIError) assert.equal(err.status, 400);
          return true;
        },
      );
    });
    it("accepts maxRetries 0 without local validation errors", async () => {
      mockFetch(SYSTEM_ONE_RESPONSE);
      const out = await systemOne({ apiKey: "k", maxRetries: 0 }, "s", { q: { type: "noul", instructions: "x?" } });
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
