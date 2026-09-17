import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
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

  it("--version reports the published package version", async () => {
    const manifest = JSON.parse(readFileSync(join(__dirname, "..", "..", "package.json"), "utf8")) as { version: string };
    const r = await run(["--version"]);
    assert.equal(r.code, 0);
    assert.equal(r.stdout.trim(), manifest.version);
  });

  it("batch JSON rows carry the same cost block a single call does", async () => {
    const line = JSON.stringify({ id: "row", state: "fast", questions: QUESTIONS });
    const r = await run(["batch", "--request", "-"], line + "\n");
    assert.equal(r.code, 0);
    const [row] = stdoutJsonLines(r.stdout);
    assert.equal(row.ok, true);
    assert.ok(typeof (row.response as { cost?: unknown }).cost === "object");
  });
});

// Gate, records, and replay are offline: a judgment on disk is enough to decide,
// so a policy can run in CI without a key and without spending a call.
describe("gate and record contract (offline)", () => {
  const ACCEPT = {
    model: "jev-1.13.0",
    answers: { relation: { type: "choice", choice: "supports", probabilities: { supports: 0.93, contradicts: 0.07 }, confidence: 0.93 } },
    usage: { input_tokens: 100, output_tokens: 10 },
  };
  const REVIEW = {
    model: "jev-1.13.0",
    answers: { relation: { type: "choice", choice: "supports", probabilities: { supports: 0.61, contradicts: 0.39 }, confidence: 0.61 } },
    usage: { input_tokens: 100, output_tokens: 10 },
  };
  const DENY = {
    model: "jev-1.13.0",
    answers: { relation: { type: "choice", choice: "contradicts", probabilities: { supports: 0.02, contradicts: 0.98 }, confidence: 0.98 } },
    usage: { input_tokens: 100, output_tokens: 10 },
  };
  const ABSTAIN = { model: "jev-1.13.0", answers: {}, usage: { input_tokens: 100, output_tokens: 10 } };

  function writeJudgment(body: unknown): string {
    const dir = mkdtempSync(join(tmpdir(), "jev-contract-"));
    const path = join(dir, "judgment.json");
    writeFileSync(path, JSON.stringify(body));
    return path;
  }

  it("maps a policy outcome onto the documented exit codes", async () => {
    const cases: Array<[unknown, number, string]> = [
      [ACCEPT, 0, "accept"],
      [REVIEW, 2, "review"],
      [DENY, 3, "deny"],
      [ABSTAIN, 4, "abstain"],
    ];
    for (const [body, code, decision] of cases) {
      const r = await run(["gate", "--input", writeJudgment(body), "--pack", "verify"]);
      assert.equal(r.code, code, `expected exit ${code} for ${decision}: ${r.stderr}`);
      const parsed = JSON.parse(r.stdout) as { gate: { decision: string; policy: string } };
      assert.equal(parsed.gate.decision, decision);
      assert.equal(parsed.gate.policy, "verify");
    }
  });

  it("refuses two policy sources and a missing one", async () => {
    const input = writeJudgment(ACCEPT);
    const both = await run(["gate", "--input", input, "--pack", "verify", "--policy", input]);
    assert.equal(both.code, 1);
    assert.equal(both.stdout, "");
    assert.ok(both.stderr.includes("mutually exclusive"));

    const none = await run(["gate", "--input", input]);
    assert.equal(none.code, 1);
    assert.ok(none.stderr.includes("Missing policy"));
  });

  it("applies a caller-supplied policy file", async () => {
    const dir = mkdtempSync(join(tmpdir(), "jev-contract-"));
    const policyPath = join(dir, "policy.json");
    writeFileSync(
      policyPath,
      JSON.stringify({
        policy_version: 1,
        name: "relaxed",
        rules: [{ answer: "relation", type: "choice", accept: ["supports", "contradicts"], accept_at: 0.5 }],
      }),
    );
    const r = await run(["gate", "--input", writeJudgment(DENY), "--policy", policyPath]);
    assert.equal(r.code, 0);
  });

  it("rejects a policy that cannot decide, without treating it as a denial", async () => {
    const dir = mkdtempSync(join(tmpdir(), "jev-contract-"));
    const policyPath = join(dir, "bad.json");
    writeFileSync(policyPath, JSON.stringify({ policy_version: 1, name: "bad", rules: [] }));
    const r = await run(["gate", "--input", writeJudgment(ACCEPT), "--policy", policyPath]);
    assert.equal(r.code, 1);
    assert.ok(r.stderr.includes("Invalid policy"));
  });

  it("records a pack-backed call, gates the record, and replays it", async () => {
    const dir = mkdtempSync(join(tmpdir(), "jev-contract-"));
    const recordPath = join(dir, "record.json");
    const statePath = join(dir, "claim.json");
    writeFileSync(statePath, JSON.stringify({ claim: "Vendor X is SOC2 certified.", evidence: "Vendor X publishes a SOC2 report." }));

    const ask = await run(["ask", "--pack", "verify", "--state-file", statePath, "--state-format", "json", "--model", "jev-1.13.0", "--record", recordPath]);
    assert.equal(ask.code, 0, ask.stderr);
    assert.ok(ask.stderr.includes("record written"));
    const record = JSON.parse(readFileSync(recordPath, "utf8")) as {
      record_version: number;
      model_requested: string | null;
      state_sha256: string;
      pack: { name: string; hash: string };
      response: { answers: Record<string, unknown> };
    };
    assert.equal(record.record_version, 1);
    assert.equal(record.pack.name, "verify");
    // --model pins the request; model_resolved is what actually answered.
    assert.equal(record.model_requested, "jev-1.13.0");
    assert.equal(record.model_resolved, "jev-1.13.0");
    assert.ok(record.state_sha256.startsWith("sha256:"));
    // The claim text is not stored, only hashed.
    assert.equal(readFileSync(recordPath, "utf8").includes("SOC2"), false);

    // The fixture answers the pack's first option at 1/3, below review_at 0.5.
    const gate = await run(["gate", "--input", recordPath, "--pack", "verify"]);
    assert.equal(gate.code, 3, gate.stderr);
    const gateJson = JSON.parse(gate.stdout) as { provenance: { pack_hash_matches_record: boolean } };
    assert.equal(gateJson.provenance.pack_hash_matches_record, true);

    const replay = await run(["replay", "--record", recordPath]);
    assert.equal(replay.code, 0, replay.stderr);
    const replayed = JSON.parse(replay.stdout) as { replayed: boolean; answers: Record<string, unknown>; replay: { pack: { name: string } } };
    assert.equal(replayed.replayed, true);
    assert.deepEqual(replayed.answers, record.response.answers);
    assert.equal(replayed.replay.pack.name, "verify");
  });

  it("refuses to replay a file that is not a record", async () => {
    const r = await run(["replay", "--record", writeJudgment(ACCEPT)]);
    assert.equal(r.code, 1);
    assert.equal(r.stdout, "");
    assert.ok(r.stderr.includes("record_version 1"));
  });

  it("lists packs and lints a bundled pack without a key", async () => {
    const listed = await run(["packs", "-f", "json"], "", { TYPESAFE_API_KEY: "" });
    assert.equal(listed.code, 0);
    const { packs } = JSON.parse(listed.stdout) as { packs: Array<{ name: string; hash: string }> };
    assert.deepEqual(packs.map((p) => p.name), ["route", "screen", "verify"]);
    assert.ok(packs.every((p) => p.hash.startsWith("sha256:")));

    const linted = await run(["lint", "--pack", "verify"], "", { TYPESAFE_API_KEY: "" });
    assert.equal(linted.code, 0, linted.stderr);
    assert.ok(JSON.parse(linted.stdout).ok);
  });

  it("doctor reports configuration without printing the key", async () => {
    const r = await run(["doctor", "-f", "json"]);
    assert.equal(r.code, 0, r.stderr);
    const parsed = JSON.parse(r.stdout) as { ok: boolean; checks: Array<{ name: string; status: string; detail: string }> };
    assert.equal(parsed.ok, true);
    const key = parsed.checks.find((c) => c.name === "api_key");
    assert.equal(key?.status, "ok");
    assert.ok(key?.detail.includes("present"));
    assert.equal(r.stdout.includes("contract-fixture"), false);
    assert.ok(parsed.checks.some((c) => c.name === "packs" && c.status === "ok"));
  });
});
