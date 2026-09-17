import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
const __dirname = dirname(fileURLToPath(import.meta.url));

// Preload that replaces fetch with a deterministic fixture.
const PRELOAD = `
globalThis.fetch = async (url, init) => {
  const body = init.body ? JSON.parse(init.body) : null;
  if (String(url).endsWith("/v1/models")) {
    return new Response(JSON.stringify({ models: [] }), { status: 200, headers: { "content-type": "application/json" } });
  }
  const questions = body && body.questions ? body.questions : {};
  const answers = Object.fromEntries(Object.entries(questions).map(([id, q]) => {
    const qq = q;
    if (qq.type === "choice") {
      const names = Object.keys(qq.criteria);
      return [id, { type: "choice", choice: names[0], probabilities: Object.fromEntries(names.map((n) => [n, 1 / names.length])), confidence: 0.5 }];
    }
    if (qq.type === "score") return [id, { type: "score", score: 0, probabilities: { 0: 0.5, 1: 0.5 }, legend: { 0: "low", 1: "high" }, confidence: 0.5 }];
    return [id, { type: "noul", noul: 0.5 }];
  }));
  return new Response(JSON.stringify({ model: (body && body.model ? body.model : "fixture-model"), answers, usage: { input_tokens: 10, output_tokens: 1 } }), { status: 200, headers: { "content-type": "application/json" } });
};
process.argv = [process.execPath, "cli", ...JSON.parse(process.env.CONTRACT_ARGS)];
await import(${JSON.stringify(join(__dirname, "..", "cli.ts"))});
`;
interface RunResult {
  code: number;
  stdout: string;
  stderr: string;
}

function run(args: string[], stdin = "", env: Record<string, string> = {}): Promise<RunResult> {
  const dir = mkdtempSync(join(tmpdir(), "jev-contract-"));
  const preload = join(dir, "preload.mjs");
  writeFileSync(preload, PRELOAD);
  const child = spawnSync(process.execPath, ["--import", "tsx", preload], {
    env: { ...process.env, TYPESAFE_API_KEY: "contract-fixture", CONTRACT_ARGS: JSON.stringify(args), ...env },
    input: stdin,
    timeout: 30_000,
    encoding: "utf8",
  });
  const code = child.status ?? 1;
  const stdout = typeof child.stdout === "string" ? child.stdout : String(child.stdout ?? "");
  const stderr = typeof child.stderr === "string" ? child.stderr : String(child.stderr ?? "");
  return Promise.resolve({ code, stdout, stderr });
}

function stdoutJsonLines(stdout: string): Array<Record<string, unknown>> {
  return stdout
    .split("\n")
    .filter((l) => l.trim().length > 0)
    .map((l) => JSON.parse(l) as Record<string, unknown>);
}

const QUESTIONS = { q: { type: "noul", instructions: "Is it urgent?" } };

describe("process contract (fixture transport)", () => {
  it("emits no stdout on unknown command; JSON error on stderr", async () => {
    const r = await run(["does-not-exist"]);
    assert.equal(r.code, 1);
    assert.equal(r.stdout, "");
    assert.ok(r.stderr.includes("Unknown command"));
  });

  it("errors on empty argv with usage on stderr", async () => {
    const r = await run([]);
    assert.equal(r.code, 1);
    assert.equal(r.stdout, "");
    assert.ok(r.stderr.includes("jev-cli"));
  });

  it("rejects --request combined with --state", async () => {
    const dir = mkdtempSync(join(tmpdir(), "jev-contract-"));
    const req = join(dir, "req.json");
    writeFileSync(req, JSON.stringify({ state: "a", questions: QUESTIONS }));
    const r = await run(["ask", "--request", req, "--state", "b"]);
    assert.equal(r.code, 1);
    assert.equal(r.stdout, "");
    assert.ok(r.stderr.includes("mutually exclusive"));
  });
  it("batch preserves every record around an invalid middle row", async () => {
    const lines = [
      JSON.stringify({ id: "first", state: "fast", questions: QUESTIONS }),
      JSON.stringify({ id: "invalid", state: "x" }),
      JSON.stringify({ id: "last", state: "fast", questions: QUESTIONS }),
    ].join("\n");
    const r = await run(["batch", "--request", "-", "--concurrency", "4"], lines + "\n");
    assert.equal(r.code, 1);
    const rows = stdoutJsonLines(r.stdout);
    assert.deepEqual(rows.map((row) => row.id), ["first", "invalid", "last"]);
    assert.deepEqual(rows.map((row) => row.ok), [true, false, true]);
    assert.deepEqual(rows.map((row) => row.index), [0, 1, 2]);
    assert.ok(r.stderr.includes("1 batch record(s) failed."));
  });

  it("batch drains pending results before reporting a malformed line", async () => {
    // A malformed line ends the stream: records after it are unreachable.
    // The contract is that settled rows are emitted before the error.
    const lines = [
      JSON.stringify({ id: "first", state: "fast", questions: QUESTIONS }),
      "not json",
      JSON.stringify({ id: "last", state: "fast", questions: QUESTIONS }),
    ].join("\n");
    const r = await run(["batch", "--request", "-", "--concurrency", "4"], lines + "\n");
    assert.equal(r.code, 1);
    const rows = stdoutJsonLines(r.stdout);
    assert.deepEqual(rows.map((row) => row.id), ["first"]);
    assert.deepEqual(rows.map((row) => row.ok), [true]);
    assert.ok(r.stderr.includes("Invalid JSONL line 2"));
  });
  it("single inference exits 0 with clean stdout", async () => {
    const r = await run(["noul", "Is it urgent?", "--state", "ticket"]);
    assert.equal(r.code, 0);
    const parsed = JSON.parse(r.stdout) as { model: string; answers: unknown };
    assert.equal(parsed.model, "jev-latest");
    assert.ok(typeof parsed.answers === "object");
  });

  it("structured JSON state reaches the request unchanged", async () => {
    const dir = mkdtempSync(join(tmpdir(), "jev-contract-"));
    const stateFile = join(dir, "state.json");
    writeFileSync(stateFile, JSON.stringify({ ticket: { priority: 3 } }));
    const r = await run(["noul", "Priority three?", "--state-file", stateFile, "--state-format", "json"]);
    assert.equal(r.code, 0);
    assert.ok(r.stdout.includes('"model"'));
  });
});
