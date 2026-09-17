import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { annotateResponse, exitCodeFor, gateAction, noulVerdict } from "../cli/gates.js";
import { lintQuestions } from "../cli/lint.js";
import { formatOutput } from "../cli/formatters.js";
import { parseOption, parseProbability, resolveApiKey } from "../utils/validation.js";
import { MIXED_RESPONSE } from "./fixtures/systemone.js";

describe("gates", () => {
  describe("noulVerdict", () => {
    it("applies yes/no thresholds with uncertain middle", () => {
      assert.equal(noulVerdict(0.9, { yesAt: 0.7, noAt: 0.3 }), "yes");
      assert.equal(noulVerdict(0.1, { yesAt: 0.7, noAt: 0.3 }), "no");
      assert.equal(noulVerdict(0.5, { yesAt: 0.7, noAt: 0.3 }), "uncertain");
    });

    it("treats boundary values as decided", () => {
      assert.equal(noulVerdict(0.7, { yesAt: 0.7, noAt: 0.3 }), "yes");
      assert.equal(noulVerdict(0.3, { yesAt: 0.7, noAt: 0.3 }), "no");
    });
  });

  describe("gateAction", () => {
    it("maps confidence to act/review/abstain", () => {
      assert.equal(gateAction(0.9, { actAbove: 0.8, reviewAbove: 0.5 }), "act");
      assert.equal(gateAction(0.6, { actAbove: 0.8, reviewAbove: 0.5 }), "review");
      assert.equal(gateAction(0.2, { actAbove: 0.8, reviewAbove: 0.5 }), "abstain");
    });
  });

  describe("annotateResponse + exitCodeFor", () => {
    const t = { yesAt: 0.7, noAt: 0.3, actAbove: 0.8, reviewAbove: 0.5 };

    it("annotates mixed answers with verdict/action", () => {
      const out = annotateResponse(MIXED_RESPONSE, t);
      assert.equal(out.answers.dept.type, "choice");
      if (out.answers.dept.type === "choice") assert.equal(out.answers.dept.action, "act");
      if (out.answers.frustration.type === "score") assert.equal(out.answers.frustration.action, "act");
      if (out.answers.is_urgent.type === "noul") assert.equal(out.answers.is_urgent.verdict, "yes");
    });

    it("exits 0 when everything acts", () => {
      const out = annotateResponse(MIXED_RESPONSE, t);
      assert.equal(exitCodeFor(out), 0);
    });

    it("exits 2 on uncertain noul", () => {
      const out = annotateResponse(
        { model: "m", answers: { q: { type: "noul", noul: 0.5 } }, usage: { input_tokens: 1, output_tokens: 0 } },
        t,
      );
      assert.equal(exitCodeFor(out), 2);
    });

    it("exits 2 on review, 3 on abstain, review wins when both present", () => {
      const review = annotateResponse(
        { model: "m", answers: { q: { type: "choice", choice: "a", probabilities: { a: 0.6, b: 0.4 }, confidence: 0.6 } }, usage: { input_tokens: 1, output_tokens: 0 } },
        t,
      );
      assert.equal(exitCodeFor(review), 2);
      const abstain = annotateResponse(
        { model: "m", answers: { q: { type: "choice", choice: "a", probabilities: { a: 0.5, b: 0.5 }, confidence: 0.1 } }, usage: { input_tokens: 1, output_tokens: 0 } },
        t,
      );
      assert.equal(exitCodeFor(abstain), 3);
    });
  });
});

describe("lint", () => {
  it("accepts a valid mixed pack", () => {
    const result = lintQuestions({
      u: { type: "noul", instructions: "Does this convey urgency?" },
      d: { type: "choice", instructions: "Which team handles this?", criteria: { billing: "Payments", technical: "Bugs" } },
      f: { type: "score", instructions: "How frustrated?", criteria: ["Calm", "Angry"] },
    });
    assert.equal(result.ok, true);
    assert.equal(result.questionCount, 3);
  });

  it("rejects non-object questions", () => {
    const result = lintQuestions([]);
    assert.equal(result.ok, false);
  });

  it("rejects empty questions map", () => {
    const result = lintQuestions({});
    assert.equal(result.ok, false);
  });

  it("flags instructions that parrot the question id", () => {
    const result = lintQuestions({ refund: { type: "noul", instructions: "refund" } });
    assert.equal(result.ok, false);
    assert.ok(result.issues.some((i) => i.message.includes("never sent to the model")));
  });

  it("rejects single-option choice", () => {
    const result = lintQuestions({ c: { type: "choice", instructions: "Pick one?", criteria: { only: "thing" } } });
    assert.equal(result.ok, false);
    assert.ok(result.issues.some((i) => i.message.includes("at least 2 options")));
  });

  it("rejects single-level score", () => {
    const result = lintQuestions({ s: { type: "score", instructions: "Rate it?", criteria: ["only"] } });
    assert.equal(result.ok, false);
    assert.ok(result.issues.some((i) => i.message.includes("at least 2 levels")));
  });

  it("rejects unknown type", () => {
    const result = lintQuestions({ q: { type: "generate", instructions: "Write something" } });
    assert.equal(result.ok, false);
  });

  it("warns on undescribed choice options but stays ok", () => {
    const result = lintQuestions({ c: { type: "choice", instructions: "Which team handles this?", criteria: { a: null, b: null } } });
    assert.equal(result.ok, true);
    assert.ok(result.issues.some((i) => i.severity === "warn"));
  });
});

describe("formatters", () => {
  const t = { yesAt: 0.7, noAt: 0.3, actAbove: 0.8, reviewAbove: 0.5 };

  it("json output includes answers, usage, and cost", () => {
    const annotated = annotateResponse(MIXED_RESPONSE, t);
    const parsed = JSON.parse(formatOutput(annotated, "json")) as Record<string, unknown>;
    assert.ok(typeof parsed.answers === "object");
    assert.ok(typeof parsed.usage === "object");
    assert.ok(typeof parsed.cost === "object");
  });

  it("table output renders one line per answer plus usage", () => {
    const annotated = annotateResponse(MIXED_RESPONSE, t);
    const text = formatOutput(annotated, "table");
    assert.ok(text.includes("model: jev-1.13.0"));
    assert.ok(text.includes("dept:"));
    assert.ok(text.includes("usage:"));
  });
});

describe("validation", () => {
  describe("resolveApiKey", () => {
    it("prefers the flag over env", () => {
      process.env.TYPESAFE_API_KEY = "env-key";
      try {
        assert.equal(resolveApiKey("flag-key"), "flag-key");
        assert.equal(resolveApiKey(undefined), "env-key");
      } finally {
        delete process.env.TYPESAFE_API_KEY;
      }
    });

    it("throws when no key is configured", () => {
      delete process.env.TYPESAFE_API_KEY;
      assert.throws(() => resolveApiKey(undefined), /Missing API key/);
    });
  });

  describe("parseProbability", () => {
    it("passes through valid values and defaults", () => {
      assert.equal(parseProbability("0.9", "--yes-at", 0.7), 0.9);
      assert.equal(parseProbability(undefined, "--yes-at", 0.7), 0.7);
    });

    it("rejects out-of-range values", () => {
      assert.throws(() => parseProbability("2", "--yes-at", 0.7), /Invalid --yes-at/);
      assert.throws(() => parseProbability("abc", "--yes-at", 0.7), /Invalid --yes-at/);
    });
  });

  describe("parseOption", () => {
    it("splits name=description and bare names", () => {
      assert.deepEqual(parseOption('billing="Payments"'), ["billing", '"Payments"']);
      assert.deepEqual(parseOption("other"), ["other", null]);
    });
  });
});
