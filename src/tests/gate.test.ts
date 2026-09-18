import { describe, it } from "node:test";
import assert from "node:assert/strict";
import type { Questions, SystemOneResult } from "@typesafe-ai/sdk";
import { GATE_EXIT, coercePolicy, evaluatePolicy, lintPolicy, policyHash } from "../cli/policy.js";
import type { GatePolicy } from "../cli/policy.js";
import { buildRecord, extractResponse, isRecord, readRecord } from "../cli/records.js";
import { canonicalJson, hashValue } from "../utils/hash.js";
import { cliVersion } from "../utils/package.js";
import { listPacks, loadPack } from "../commands/packs.js";
import { MIXED_RESPONSE } from "./fixtures/systemone.js";

function policy(rules: GatePolicy["rules"], mode?: "all" | "any"): GatePolicy {
  return { policy_version: 1, name: "test", ...(mode ? { mode } : {}), rules };
}

function answers(entries: Record<string, unknown>): { answers: Record<string, Record<string, unknown>> } {
  return { answers: entries as Record<string, Record<string, unknown>> };
}

const noulYes = (p: number) => ({ type: "noul", noul: p });
const choice = (label: string, probabilities: Record<string, number>) => ({
  type: "choice",
  choice: label,
  probabilities,
  confidence: probabilities[label] ?? 0,
});
// Real score answers carry the level indices as legend/probability keys; the
// evaluator derives the valid range from them.
const score = (s: number, levels = 4) => ({
  type: "score",
  score: s,
  legend: Object.fromEntries(Array.from({ length: levels }, (_, i) => [String(i), `level ${i}`])),
  probabilities: Object.fromEntries(Array.from({ length: levels }, (_, i) => [String(i), 1 / levels])),
});

describe("gate: noul rules", () => {
  it("accepts at or above accept_at and reviews inside the band", () => {
    const p = policy([{ answer: "ok", type: "noul", accept_at: 0.8, review_at: 0.5 }]);
    assert.equal(evaluatePolicy(p, answers({ ok: noulYes(0.95) })).decision, "accept");
    assert.equal(evaluatePolicy(p, answers({ ok: noulYes(0.8) })).decision, "accept");
    assert.equal(evaluatePolicy(p, answers({ ok: noulYes(0.6) })).decision, "review");
    assert.equal(evaluatePolicy(p, answers({ ok: noulYes(0.2) })).decision, "deny");
  });

  it("inverts the support for accept_when no", () => {
    const p = policy([{ answer: "injection", type: "noul", accept_when: "no", accept_at: 0.9, review_at: 0.7 }]);
    assert.equal(evaluatePolicy(p, answers({ injection: noulYes(0.02) })).decision, "accept");
    assert.equal(evaluatePolicy(p, answers({ injection: noulYes(0.2) })).decision, "review");
    assert.equal(evaluatePolicy(p, answers({ injection: noulYes(0.6) })).decision, "deny");
  });
});

describe("gate: choice rules", () => {
  const rule: GatePolicy["rules"][number] = { answer: "relation", type: "choice", accept: ["supports"], accept_at: 0.8, review_at: 0.5 };

  it("accepts an accepted label only above accept_at", () => {
    const p = policy([rule]);
    assert.equal(evaluatePolicy(p, answers({ relation: choice("supports", { supports: 0.93, contradicts: 0.07 }) })).decision, "accept");
    assert.equal(evaluatePolicy(p, answers({ relation: choice("supports", { supports: 0.61, contradicts: 0.39 }) })).decision, "review");
    assert.equal(evaluatePolicy(p, answers({ relation: choice("supports", { supports: 0.4, contradicts: 0.6 }) })).decision, "deny");
  });

  it("denies a confident label outside the accept list", () => {
    const result = evaluatePolicy(policy([rule]), answers({ relation: choice("contradicts", { supports: 0.01, contradicts: 0.97, says_nothing: 0.02 }) }));
    assert.equal(result.decision, "deny");
    assert.equal(result.exit_code, GATE_EXIT.deny);
  });

  it("reviews when mass sits on an accepted label even though another label was chosen", () => {
    // A near-split is not grounds for denial: the accepted label keeps real mass.
    const result = evaluatePolicy(policy([rule]), answers({ relation: choice("says_nothing", { supports: 0.52, says_nothing: 0.3, contradicts: 0.18 }) }));
    assert.equal(result.decision, "review");
    // Below review_at the split no longer helps: the answer is a denial.
    const split = evaluatePolicy(policy([rule]), answers({ relation: choice("says_nothing", { supports: 0.45, says_nothing: 0.35, contradicts: 0.2 }) }));
    assert.equal(split.decision, "deny");
  });

  it("abstains when the probability map is missing, malformed, or off-label", () => {
    const p = policy([{ answer: "relation", type: "choice", accept: ["supports"], accept_at: 0.8 }]);
    // Confidence is about the answer as a whole, not this label: no substitution.
    assert.equal(evaluatePolicy(p, answers({ relation: { type: "choice", choice: "supports", confidence: 0.99 } })).decision, "abstain");
    assert.equal(evaluatePolicy(p, answers({ relation: choice("supports", { other: 0.9, other2: 0.1 }) })).decision, "abstain");
    assert.equal(evaluatePolicy(p, answers({ relation: choice("supports", { supports: 2, contradicts: -1 }) })).decision, "abstain");
    assert.equal(evaluatePolicy(p, answers({ relation: choice("supports", { supports: 0.7, contradicts: 0.7 }) })).decision, "abstain");
  });

  it("counts each accepted label once when the policy repeats one", () => {
    // Lint rejects this, so it can only arrive from an unvalidated caller: the
    // doubled label must not inflate the mass into a review.
    const p = policy([{ answer: "relation", type: "choice", accept: ["supports", "supports"], review_at: 0.5 }]);
    const result = evaluatePolicy(p, answers({ relation: choice("contradicts", { supports: 0.3, contradicts: 0.7 }) }));
    assert.equal(result.decision, "deny");
  });
});

describe("gate: score rules", () => {
  it("treats higher scores as worse by default", () => {
    const p = policy([{ answer: "severity", type: "score", accept_at: 0.5, review_at: 1.5 }]);
    assert.equal(evaluatePolicy(p, answers({ severity: score(0) })).decision, "accept");
    assert.equal(evaluatePolicy(p, answers({ severity: score(1.2) })).decision, "review");
    assert.equal(evaluatePolicy(p, answers({ severity: score(2.7) })).decision, "deny");
  });

  it("inverts the comparison for higher_is_worse false", () => {
    const p = policy([{ answer: "score", type: "score", higher_is_worse: false, accept_at: 0.8, review_at: 0.5 }]);
    assert.equal(evaluatePolicy(p, answers({ score: score(0.9) })).decision, "accept");
    assert.equal(evaluatePolicy(p, answers({ score: score(0.6) })).decision, "review");
    assert.equal(evaluatePolicy(p, answers({ score: score(0.2) })).decision, "deny");
  });

  it("abstains on a score outside the reported scale instead of accepting it", () => {
    const p = policy([{ answer: "severity", type: "score", accept_at: 0.5, review_at: 1.5 }]);
    assert.equal(evaluatePolicy(p, answers({ severity: score(-100) })).decision, "abstain");
    assert.equal(evaluatePolicy(p, answers({ severity: score(99) })).decision, "abstain");
  });

  it("abstains when the scale is unknowable, and honours an explicit range", () => {
    const noScale = policy([{ answer: "severity", type: "score", accept_at: 0.5, review_at: 1.5 }]);
    assert.equal(evaluatePolicy(noScale, answers({ severity: { type: "score", score: 0.2 } })).decision, "abstain");

    const explicit = policy([{ answer: "severity", type: "score", accept_at: 0.5, review_at: 1.5, range: [0, 3] }]);
    assert.equal(evaluatePolicy(explicit, answers({ severity: { type: "score", score: 0.2 } })).decision, "accept");
    assert.equal(evaluatePolicy(explicit, answers({ severity: { type: "score", score: -1 } })).decision, "abstain");
  });
});

describe("gate: missing and mismatched answers", () => {
  const rule: GatePolicy["rules"][number] = { answer: "relation", type: "choice", accept: ["supports"], accept_at: 0.8 };

  it("abstains when a required answer is absent", () => {
    const result = evaluatePolicy(policy([rule]), answers({}));
    assert.equal(result.decision, "abstain");
    assert.equal(result.exit_code, 4);
    assert.match(result.rules[0].reason, /missing/);
  });

  it("abstains when the answer type does not match the rule", () => {
    const result = evaluatePolicy(policy([rule]), answers({ relation: noulYes(0.99) }));
    assert.equal(result.decision, "abstain");
    assert.match(result.rules[0].reason, /expects "choice"/);
  });

  it("abstains rather than accepting when every rule is optional and absent", () => {
    const result = evaluatePolicy(policy([{ ...rule, optional: true }]), answers({}));
    assert.equal(result.decision, "abstain");
    assert.equal(result.rules.length, 0);
  });

  it("skips an optional rule that is absent but applies it when present", () => {
    const p = policy([
      { answer: "ok", type: "noul", accept_at: 0.8 },
      { answer: "extra", type: "noul", accept_at: 0.9, optional: true },
    ]);
    assert.equal(evaluatePolicy(p, answers({ ok: noulYes(0.9) })).decision, "accept");
    assert.equal(evaluatePolicy(p, answers({ ok: noulYes(0.9), extra: noulYes(0.1) })).decision, "deny");
  });

  it("ignores answers that no rule asks about", () => {
    const p = policy([{ answer: "ok", type: "noul", accept_at: 0.8 }]);
    assert.equal(evaluatePolicy(p, answers({ ok: noulYes(0.9), unasked: noulYes(0.1) })).decision, "accept");
  });
});

describe("gate: rule combination", () => {
  const rules: GatePolicy["rules"] = [
    { answer: "a", type: "noul", accept_at: 0.8, review_at: 0.5 },
    { answer: "b", type: "noul", accept_at: 0.8, review_at: 0.5 },
  ];

  it("takes the worst outcome under mode all", () => {
    assert.equal(evaluatePolicy(policy(rules), answers({ a: noulYes(0.9), b: noulYes(0.9) })).decision, "accept");
    assert.equal(evaluatePolicy(policy(rules), answers({ a: noulYes(0.9), b: noulYes(0.6) })).decision, "review");
    assert.equal(evaluatePolicy(policy(rules), answers({ a: noulYes(0.9), b: noulYes(0.1) })).decision, "deny");
    // Denial outranks missing data: the policy already says no.
    assert.equal(evaluatePolicy(policy(rules), answers({ a: noulYes(0.1) })).decision, "deny");
    assert.equal(evaluatePolicy(policy(rules), answers({})).decision, "abstain");
  });

  it("takes the best outcome under mode any", () => {
    const p = policy(rules, "any");
    assert.equal(evaluatePolicy(p, answers({ a: noulYes(0.9), b: noulYes(0.1) })).decision, "accept");
    assert.equal(evaluatePolicy(p, answers({ a: noulYes(0.6), b: noulYes(0.1) })).decision, "review");
    assert.equal(evaluatePolicy(p, answers({ a: noulYes(0.1) })).decision, "abstain");
    assert.equal(evaluatePolicy(p, answers({ a: noulYes(0.1), b: noulYes(0.1) })).decision, "deny");
  });

  it("reports the exit code that matches the decision", () => {
    const p = policy([{ answer: "a", type: "noul", accept_at: 0.8, review_at: 0.5 }]);
    const cases: Array<[number | undefined, string, number]> = [
      [0.9, "accept", 0],
      [0.6, "review", 2],
      [0.1, "deny", 3],
      [undefined, "abstain", 4],
    ];
    for (const [value, decision, code] of cases) {
      const result = evaluatePolicy(p, answers(value === undefined ? {} : { a: noulYes(value) }));
      assert.equal(result.decision, decision);
      assert.equal(result.exit_code, code);
      assert.equal(result.exit_code, GATE_EXIT[result.decision]);
    }
  });
});

describe("gate: policy linting", () => {
  it("accepts a well-formed policy", () => {
    const result = lintPolicy(policy([{ answer: "a", type: "noul" }]));
    assert.equal(result.ok, true);
  });

  it("rejects a wrong version, empty rules, and unknown types", () => {
    assert.equal(lintPolicy({ policy_version: 2, name: "x", rules: [{ answer: "a", type: "noul" }] }).ok, false);
    assert.equal(lintPolicy({ policy_version: 1, name: "x", rules: [] }).ok, false);
    assert.equal(lintPolicy(policy([{ answer: "a", type: "generator" } as unknown as GatePolicy["rules"][number]])).ok, false);
  });

  it("rejects a transient band that can never be reached", () => {
    const result = lintPolicy(policy([{ answer: "a", type: "noul", accept_at: 0.5, review_at: 0.8 }]));
    assert.equal(result.ok, false);
    assert.ok(result.errors.some((e) => e.includes("review_at")));
  });

  it("rejects duplicate answers and a choice with no accepted label", () => {
    const dup = lintPolicy(
      policy([
        { answer: "a", type: "noul" },
        { answer: "a", type: "noul" },
      ]),
    );
    assert.equal(dup.ok, false);
    assert.equal(lintPolicy(policy([{ answer: "a", type: "choice", accept: [] }])).ok, false);
  });

  it("rejects an inverted choice band and a repeated accepted label", () => {
    const inverted = lintPolicy(policy([{ answer: "a", type: "choice", accept: ["yes"], accept_at: 0.6, review_at: 0.9 }]));
    assert.equal(inverted.ok, false);
    assert.ok(inverted.errors.some((e) => e.includes("review_at")));

    // The default review_at applies when only accept_at is given.
    assert.equal(lintPolicy(policy([{ answer: "a", type: "choice", accept: ["yes"], accept_at: 0.4 }])).ok, false);

    const repeated = lintPolicy(policy([{ answer: "a", type: "choice", accept: ["yes", "yes"] }]));
    assert.equal(repeated.ok, false);
    assert.ok(repeated.errors.some((e) => e.includes("repeats")));
  });

  it("rejects a malformed score range", () => {
    assert.equal(lintPolicy(policy([{ answer: "a", type: "score", accept_at: 1, review_at: 2, range: [3, 3] }])).ok, false);
    assert.equal(lintPolicy(policy([{ answer: "a", type: "score", accept_at: 1, review_at: 2, range: [0] } as unknown as GatePolicy["rules"][number]])).ok, false);
    assert.equal(lintPolicy(policy([{ answer: "a", type: "score", accept_at: 1, review_at: 2, range: [0, 3] }])).ok, true);
  });

  it("throws from coercePolicy with the first structural problem", () => {
    assert.throws(() => coercePolicy({ policy_version: 1, name: "x", rules: [{ answer: "a", type: "bogus" }] }), /Invalid policy/);
  });

  it("hashes the policy independently of key order", () => {
    const a = policy([{ answer: "a", type: "noul", accept_at: 0.8, review_at: 0.5 }]);
    const b: GatePolicy = {
      rules: [{ review_at: 0.5, accept_at: 0.8, type: "noul", answer: "a" }],
      name: "test",
      policy_version: 1,
    };
    assert.equal(policyHash(a), policyHash(b));
  });
});

describe("records", () => {
  it("round-trips a response and exposes it to the gate", () => {
    const record = buildRecord(
      { pack: { name: "verify", pack_version: 1, hash: "sha256:abc" }, modelRequested: "jev-latest", state: "claim text", questions: {} as Questions, latencyMs: 123.4 },
      MIXED_RESPONSE,
    );
    assert.equal(record.record_version, 1);
    assert.equal(record.model_resolved, "jev-1.13.0");
    assert.equal(record.model_requested, "jev-latest");
    assert.equal(record.latency_ms, 123);
    assert.equal(record.cli_version, cliVersion());
    assert.equal(record.pack?.name, "verify");
    assert.equal(isRecord(record), true);
    assert.deepEqual(extractResponse(record), MIXED_RESPONSE);
  });

  it("never stores the raw state, only a hash of it", () => {
    const record = buildRecord(
      { pack: null, modelRequested: undefined, state: "secret claim text", questions: {} as Questions, latencyMs: 1 },
      MIXED_RESPONSE,
    );
    assert.ok(record.state_sha256?.startsWith("sha256:"));
    assert.equal(JSON.stringify(record).includes("secret claim text"), false);
    assert.equal(record.pack, null);
  });

  it("distinguishes states that serialize to the same bytes", () => {
    const build = (state: unknown) => buildRecord({ pack: null, modelRequested: undefined, state, questions: {} as Questions, latencyMs: 1 }, MIXED_RESPONSE).state_sha256;
    const hashes = [build('{"a":1}'), build({ a: 1 }), build("123"), build(123), build(null), build(undefined)];
    assert.equal(new Set(hashes).size, hashes.length, `state hashes must be distinct per input: ${JSON.stringify(hashes)}`);
  });

  it("detects record envelopes without claiming them valid", () => {
    assert.equal(isRecord({ response: null }), true);
    assert.throws(() => readRecord({ response: null }), /Unsupported record_version/);
    assert.throws(() => readRecord({ nope: true }), /Invalid record/);
  });

  it("validates stored records through the advertised boundary", () => {
    const record = buildRecord(
      { pack: null, modelRequested: undefined, state: "claim text", questions: {} as Questions, latencyMs: 1 },
      MIXED_RESPONSE,
    );
    assert.deepEqual(readRecord(record), record);
  });

  it("rejects a record envelope that is malformed or from another version", () => {
    assert.throws(() => extractResponse({ record_version: 2, response: { answers: {} }, answers: { a: {} } }), /Unsupported record_version 2/);
    assert.throws(() => extractResponse({ record_version: 1, response: null }), /"response" must be an object/);
    assert.throws(() => extractResponse({ record_version: 1, response: { model: "m", answers: {}, usage: {} } }), /created_at/);
    // A malformed envelope must never be reinterpreted as a bare response.
    assert.throws(() => extractResponse({ record_version: 2, response: { answers: { a: {} } }, answers: { a: {} } }), /Unsupported/);
  });

  it("accepts a bare response where a record is expected", () => {
    assert.deepEqual(extractResponse(MIXED_RESPONSE as unknown as SystemOneResult<Questions>), MIXED_RESPONSE);
    assert.throws(() => extractResponse({ nope: true }), /Invalid input/);
  });
});

describe("canonical hashing", () => {
  it("is stable across key order and array order is preserved", () => {
    assert.equal(canonicalJson({ b: 1, a: 2 }), canonicalJson({ a: 2, b: 1 }));
    assert.notEqual(canonicalJson([1, 2]), canonicalJson([2, 1]));
    assert.equal(hashValue({ b: [1, { d: 2, c: 3 }], a: null }), hashValue({ a: null, b: [1, { c: 3, d: 2 }] }));
  });
});

describe("packs", () => {
  it("ships the documented packs and validates them on load", () => {
    const names = listPacks().map((p) => p.name);
    assert.deepEqual(names, ["route", "screen", "verify"]);
  });

  it("loads a pack with its questions and policy, and hashes them together", () => {
    const loaded = loadPack("verify");
    assert.equal(loaded.pack.policy.rules[0].type, "choice");
    assert.ok("relation" in loaded.pack.questions);
    assert.ok(loaded.hash.startsWith("sha256:"));

    const screen = loadPack("screen");
    // The gate policy covers safety only: substance and relevance stay advisory.
    const ruled = screen.pack.policy.rules.map((r) => r.answer).sort();
    assert.deepEqual(ruled, ["harmful_content", "injection", "severity"]);
    assert.ok("substance" in screen.pack.questions);
  });

  it("reports the available packs when asked for an unknown one", () => {
    assert.throws(() => loadPack("nope"), /Unknown pack "nope".*verify/s);
    assert.throws(() => loadPack("../etc/passwd"), /Invalid pack name/);
  });
});
