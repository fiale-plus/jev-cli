// Complete recorded library workflow: one shared client, caller-owned state,
// elapsed time and error handling, offline policy over a saved record.
//
// Run with: npx tsx examples/library/record-and-gate.mjs [out-path]
import { readFileSync, writeFileSync } from "node:fs";
import {
  TypeSafeClient,
  buildRecord,
  estimateCostUsd,
  evaluatePolicy,
  loadPack,
  readRecord,
} from "../../src/index.ts";

const apiKey = process.env.TYPESAFE_API_KEY;
if (!apiKey) {
  throw new Error("TYPESAFE_API_KEY is required (with `npm run stub`: TYPESAFE_BASE_URL=http://127.0.0.1:8787 TYPESAFE_API_KEY=stub).");
}
const outPath = process.argv[2] ?? "out/library-record.json";

// Example input: caller-owned evidence and its stable ID. The record stores a
// hash of this state, never the text — keep the original outside version
// control if it is private.
const claim = {
  id: "library-intro-1",
  claim: "Paid plans add seats in billing settings.",
  evidence: "On the billing page, choose Add seats to invite more members.",
};

const { pack } = loadPack("verify");

// One shared client: reuse it across calls instead of constructing one per row.
const client = new TypeSafeClient({ apiKey });
const controller = new AbortController();
process.on("SIGINT", () => controller.abort());
process.on("SIGTERM", () => controller.abort());

let response;
const started = Date.now();
try {
  response = await client.systemOne(
    { state: claim, questions: pack.questions },
    { signal: controller.signal },
  );
} catch (err) {
  // Client errors stay in the caller: no policy is applied to a failed request.
  process.stderr.write(`request failed: ${err instanceof Error ? err.message : String(err)}\n`);
  process.exit(1);
}
const latencyMs = Date.now() - started;

const relation = response.answers.relation;
console.log(`relation: ${relation?.choice ?? "unknown"} (confidence ${(relation?.confidence ?? 0).toFixed(3)})`);
console.log(`model: ${response.model} latency: ${Math.round(latencyMs)}ms cost: $${estimateCostUsd(response.usage.input_tokens).toFixed(6)}`);

const record = buildRecord({ pack: null, modelRequested: undefined, state: claim, questions: pack.questions, latencyMs }, response);
writeFileSync(outPath, JSON.stringify(record, null, 2) + "\n", "utf8");
process.stderr.write(`record written: ${outPath}\n`);

// Offline decision over the stored record, no inference: readRecord validates
// the envelope, evaluatePolicy returns a decision with per-rule reasons.
const stored = readRecord(JSON.parse(readFileSync(outPath, "utf8")));
const result = evaluatePolicy(pack.policy, stored.response);
console.log(`decision: ${result.decision} (exit ${result.exit_code})`);
for (const rule of result.rules) console.log(` - ${rule.answer}: ${rule.outcome}${rule.reason ? ` — ${rule.reason}` : ""}`);
process.exitCode = result.exit_code;
