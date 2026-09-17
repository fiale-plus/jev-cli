import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { lintQuestions } from "../cli/lint.js";
import { formatOutput } from "../cli/formatters.js";
import { parseOption, parsePositiveInt, resolveApiKey } from "../utils/validation.js";
import { MIXED_RESPONSE } from "./fixtures/systemone.js";

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

  it("accepts structured instructions and null criteria", () => {
    const result = lintQuestions({
      u: { type: "noul", instructions: { text: "Is this urgent?", context: "ticket" } },
      d: { type: "choice", instructions: "Which team?", criteria: { a: null, b: null } },
    });
    assert.equal(result.ok, true);
  });

  it("rejects non-object questions", () => {
    const result = lintQuestions([]);
    assert.equal(result.ok, false);
  });

  it("rejects empty questions map", () => {
    const result = lintQuestions({});
    assert.equal(result.ok, false);
  });

  it("rejects missing instructions", () => {
    const result = lintQuestions({ refund: { type: "noul" } });
    assert.equal(result.ok, false);
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
});

describe("formatters", () => {
  it("json output includes answers, usage, and cost", () => {
    const parsed = JSON.parse(formatOutput(MIXED_RESPONSE, "json")) as Record<string, unknown>;
    assert.ok(typeof parsed.answers === "object");
    assert.ok(typeof parsed.usage === "object");
    assert.ok(typeof parsed.cost === "object");
  });

  it("table output renders one line per answer plus usage", () => {
    const text = formatOutput(MIXED_RESPONSE, "table");
    assert.ok(text.includes("model: jev-1.13.0"));
    assert.ok(text.includes("dept:"));
    assert.ok(text.includes("usage:"));
  });

  it("preserves raw probabilities without policy annotations", () => {
    const parsed = JSON.parse(formatOutput(MIXED_RESPONSE, "json")) as {
      answers: { dept: { choice: string; confidence: number } };
    };
    assert.equal(parsed.answers.dept.choice, "technical");
    assert.equal(parsed.answers.dept.confidence, 0.82);
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

  describe("parsePositiveInt", () => {
    it("passes through valid values and allows zero retries", () => {
      assert.equal(parsePositiveInt("0", "--retries", 2, 10), 0);
      assert.equal(parsePositiveInt(undefined, "--retries", 2, 10), 2);
    });

    it("rejects out-of-range values", () => {
      assert.throws(() => parsePositiveInt("11", "--retries", 2, 10), /Invalid --retries/);
      assert.throws(() => parsePositiveInt("1.5", "--retries", 2, 10), /Expected an integer/);
    });
  });

  describe("parseOption", () => {
    it("splits name=description and bare names", () => {
      assert.deepEqual(parseOption('billing="Payments"'), ["billing", '"Payments"']);
      assert.deepEqual(parseOption("other"), ["other", null]);
    });
  });
});
