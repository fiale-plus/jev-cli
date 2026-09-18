# @fiale-plus/jev-cli

[![NPM Version](https://img.shields.io/npm/v/@fiale-plus/jev-cli?style=flat-square)](https://www.npmjs.com/package/@fiale-plus/jev-cli)
[![NPM Downloads](https://img.shields.io/npm/dm/@fiale-plus/jev-cli?style=flat-square)](https://www.npmjs.com/package/@fiale-plus/jev-cli)
[![Test Status](https://img.shields.io/github/actions/workflow/status/fiale-plus/jev-cli/test.yml?branch=main&label=tests&style=flat-square)](https://github.com/fiale-plus/jev-cli/actions/workflows/test.yml)
[![License](https://img.shields.io/github/license/fiale-plus/jev-cli?style=flat-square)](LICENSE)

**Unofficial** CLI for the [TypeSafe System One API](https://docs.typesafe.ai/api) (Jev) — designed for AI agents and anything that can execute a process.

Jev is TypeSafe's System One model: send `state` + typed questions, get structured answers (`noul`/`choice`/`score` with probabilities + confidence) your code can branch on. No text generation, no parsing.

Transport, retries, and types come from the official [`@typesafe-ai/sdk`](https://docs.typesafe.ai/sdk/javascript). This CLI adds the shell interface: explicit input, machine-readable output, and execution exit codes.

## Why a CLI when SDKs exist?

- **Shell composability** — pipes, `jq`, JSONL batch, documented exit codes
- **Question files as reviewable artifacts** — one JSON file holds questions; `lint` validates structure without spending API calls
- **Structured state** — `--state-format json` preserves objects/arrays end to end
- **Cost visibility** — every JSON response carries `usage` + `cost.estimated_usd` (input billed at $42/Btok, output free)

Policy lives in the caller. A successful inference exits 0 even when answers are uncertain — probabilities and confidence are data on stdout, not authorization. `jev gate` runs that policy **offline** over a saved judgment, which is where accept/review/deny/abstain exit codes come from.

## Quick Start

```bash
npm install -g @fiale-plus/jev-cli
export TYPESAFE_API_KEY=ts_...

jev noul "Does this convey urgency?" --state "Payouts failing 3 days, help!"
jev models
```

Get a key at: https://console.typesafe.ai/settings/keys

Requires Node.js >= 22.0.0.

## The decision pipeline

Inference and policy are separate steps, so a judgment is reproducible and auditable:

```bash
# 1. Judge — questions from a bundled pack, state from you, record for the audit trail
jev ask --pack verify --state-file claim.json --state-format json --record decisions/claim-1.json

# 2. Decide — offline, no API call, exit code is the decision
jev gate --input decisions/claim-1.json --pack verify; echo "exit $?"    # 0 2 3 4

# 3. Show your work — re-emit the stored answers without paying again
jev replay --record decisions/claim-1.json
```

| `jev gate` exit | Decision | Caller action |
|---|---|---|
| 0 | `accept` | proceed |
| 2 | `review` | escalate to a human or a stronger check |
| 3 | `deny` | refuse |
| 4 | `abstain` | not enough information — never treated as acceptance |

`deny` and `abstain` are separate codes because remediation differs: one is a verdict, the other is a missing input. Every rule's reason is printed in both formats, so the answer to "why did this pass?" is on stdout.

## CLI Usage

### Single judgments

```bash
jev noul <instructions> --state <text> | --state-file <path> | --stdin
jev choice <instructions> --option name="desc" --option name2="desc" --state ...
jev score <instructions> --level "low" --level "high" --state ...
```

Noul takes optional `--true-means` / `--false-means` criteria. Choice needs ≥2 `--option` entries (`name="desc"` or bare `name`). Score needs ≥2 `--level` entries, lowest first. Trailing positional args are joined as state. Add `--state-format json` when the state input is JSON.

### Batch (`ask`)

One call, many questions over the same state — parallel, barely extra latency:

```bash
jev ask --state-file ticket.txt --questions pack.json
jev ask --state-file ticket.json --state-format json --questions pack.json
echo '{"state":"...","questions":{...}}' | jev ask --request -
jev lint --questions pack.json   # validate without calling the API
```

`pack.json` maps caller-chosen IDs to questions. IDs are for your code only — never sent to the model, so write complete instructions:

```json
{
  "is_urgent": { "type": "noul", "instructions": "Does this convey urgency?" },
  "dept": { "type": "choice", "instructions": "Which team handles this?",
            "criteria": { "billing": "Payments", "technical": "Bugs" } },
  "frustration": { "type": "score", "instructions": "How frustrated?",
                   "criteria": ["Calm", "Frustrated", "Angry"] }
}
```

Speculative questions are welcome: ask branches that may not apply, then ignore irrelevant answers in code. Uncertainty on an unused branch must not fail the request.

### Batch (`batch`)

Many independent requests from a JSONL file, bounded concurrency, one result record per input record in input order:

```bash
jev batch --request requests.jsonl --concurrency 8
jev batch --state-file states.jsonl --questions pack.json
```

Input records: `{"id": "row-1", "state": ..., "questions": {...}, "model": "jev-1.13.0"}`. With `--request`, every record carries its own questions/model; with `--state-file <jsonl> --questions pack.json [--model ...]`, records carry state (+id) and share them. Output is JSON lines: `{"index","id","ok","response"|"error"}`. Overall exit is 1 when any record fails — filter and retry failures in the caller.

### Packs

A pack is a versioned question set plus the policy that decides when its answers permit proceeding:

```bash
jev packs                    # list bundled packs with their content hash
jev packs verify             # dump one pack's questions, policy, and hash
jev lint  --pack verify      # validate it
jev ask   --pack verify --state-file claim.json --state-format json
jev gate  --input judgment.json --pack verify
```

| Pack | Questions | Answers |
|---|---|---|
| `verify` | claim + cited evidence | `supports` / `contradicts` / `says_nothing` |
| `screen` | untrusted content | injection, harmful content, severity (plus substance and relevance for the caller) |
| `route` | incoming request | `deterministic` / `specialist` / `human` / `none`, plus complexity |

`screen` is advisory: it is a judgment layer, not a security boundary — keep it behind real sandboxing, not instead of it. Ranking candidates is not a pack because its options are dynamic: build the `--option` flags per call (see `examples/README.md`).

Each pack carries a state contract in its `state_contract` field, describing the fields its questions expect. Pack questions and policy are hashed together; `gate` prints the hash, and a record captures the hash it ran under, so a decision names the exact revision it used.

### Gate policies

`--policy <file>` applies your own thresholds instead of a pack's:

```json
{
  "policy_version": 1,
  "name": "verify-strict",
  "mode": "all",
  "rules": [
    { "answer": "relation", "type": "choice", "accept": ["supports"], "accept_at": 0.95, "review_at": 0.75 },
    { "answer": "injection", "type": "noul", "accept_when": "no", "accept_at": 0.9, "review_at": 0.7 },
    { "answer": "severity", "type": "score", "higher_is_worse": true, "accept_at": 0.5, "review_at": 1.5 }
  ]
}
```

- Every rule names one answer and the condition that permits proceeding.
- A choice label outside `accept` never accepts, however confident the model is; what can soften a denial into `review` is probability mass sitting on an accepted label.
- A choice answer must carry a probability map whose values sit in `[0, 1]` and sum to 1 (tolerance 0.05). A map that is missing, off-label, or unnormalized **abstains**: confidence is a number about the whole answer, and substituting it for a per-label probability would let a malformed answer pass a threshold.
- A score must fall inside its scale — the rule's `range`, or the level indices the answer reports in `legend`/`probabilities`. A score outside that scale abstains, so `severity: -100` cannot glide past `accept_at: 0.5`.
- A missing or wrong-typed answer abstains — it never accepts. Mark a rule `"optional": true` to skip it when absent.
- `mode: "all"` (default) takes the worst outcome in the order `deny > abstain > review > accept`; `mode: "any"` is the reverse.

Rules are validated on load: `review_at` above `accept_at`, a choice rule with no accepted label or a repeated one, an out-of-order `range`, or an unknown type fails loudly instead of silently never firing.

### Pack identity

Gating a record against the pack that produced it is checked in two parts, because the two kinds of change mean different things:

| Change since the record was written | Result |
|---|---|
| questions changed | exit 1 — stored answers no longer mean what the current rules assume; re-run the request, or gate with `--policy <file>` if re-deciding is genuinely intended |
| thresholds changed only | the current policy applies, with a warning on stderr |
| identical | no note |

Both the pack hash and that comparison are printed in `json` and `table` output, so an accepted decision never looks unqualified.

### Records and replay

`--record <path>` writes a decision record next to a normal response (noul/choice/score/ask):

```json
{
  "record_version": 1,
  "created_at": "2026-09-18T10:00:00.000Z",
  "cli_version": "0.1.2",
  "model_requested": "jev-1.13.0",
  "model_resolved": "jev-1.13.0",
  "state_sha256": "sha256:...",
  "questions_sha256": "sha256:...",
  "latency_ms": 412,
  "pack": { "name": "verify", "pack_version": 1, "hash": "sha256:..." },
  "response": { "model": "...", "answers": { "...": {} }, "usage": { "...": "..." } }
}
```

The state is **hashed, not stored**: a record can live beside a log without carrying the confidential text that produced the decision, while still committing to the exact input the CLI sent. The hash is type-tagged and versioned, so a text state cannot collide with the JSON state that parses to the same bytes. It is an unsigned commitment, not proof of what the model read: only the response, returned by the API under TLS, attests to that.

`jev replay --record <file>` prints those stored answers again with `"replayed": true` — no API call, for re-running downstream policy or comparing a stored decision against a fresh one. Replay is not a rerun: an answer is reproducible only while the model version stays pinned, which is why `model_resolved` is recorded. `<path>` is created along with any missing parent directories, before the request is sent, so a bad path cannot fail after you have paid for an answer.

### Doctor

```bash
jev doctor            # engine, key presence, base URL, model, packs — no API call
jev doctor --live     # also authenticate, list models, and time a probe
```

The key is reported by presence and source, never by value. Exit is 1 when a check fails; warnings (no key, skipped live checks) do not fail the run.

### Offline development

```bash
node tools/stub-server.mjs                       # deterministic, non-committal stub
export TYPESAFE_BASE_URL=http://127.0.0.1:8787 TYPESAFE_API_KEY=stub
jev ask --pack verify --state-file claim.json --state-format json --record out/claim.json
jev gate --input out/claim.json --pack verify; echo "exit $?"
```

The stub answers the last option of a choice, the middle score, and noul 0.5, and it never claims the model you asked for: `model_resolved` comes back as `stub:<requested>` so a stub record is identifiable as one. Every bundled policy denies stub answers — a test asserts exactly that, through the real transport, for all three packs. It exists to test plumbing; never treat its output as a judgment, and never wire fabricated answers into a production path.

### Scoring a policy on your data

```bash
jev ask --pack verify --state-file examples/verify/c1.json --state-format json --record out/c1.json
# ... one record per labeled example ...
npm run evaluate -- --records out/ --labels examples/verify/labels.jsonl
```

It reports label accuracy, the accept/review/deny/abstain mix, and the support curve: for each bucket, the share of cases whose label the policy really accepts, bucketed by the probability the policy treats as permission for the primary rule (accepted-label mass for a choice rule, the supportive probability for a noul). That is the curve `accept_at` sits on. Score rules are excluded from the curve because a score is not a probability. Evaluation stays a script over saved records; the CLI's inference path has no eval or threshold flags.

### Models

```bash
jev models
```

### Exit codes (execution status)

| Code | Meaning |
|------|---------|
| 0 | success — inference completed, answers on stdout; or `gate` accepted |
| 1 | usage, transport, or API error |
| 2 | `gate`: review |
| 3 | `gate`: deny |
| 4 | `gate`: abstain |

### Common Options

| Flag | Description |
|------|-------------|
| `--api-key <key>` | API key (or `TYPESAFE_API_KEY` env var, required) |
| `--model <id>` | Model override (or `TYPESAFE_DEFAULT_MODEL`, default `jev-latest`) |
| `--base-url <url>` | API root (or `TYPESAFE_BASE_URL`) |
| `--log-level <level>` | SDK log level: debug\|info\|warn\|error\|off |
| `--timeout <ms>` | Request timeout in ms (SDK default 10000) |
| `--retries <n>` | Max retries, 0 disables (SDK default 2) |
| `--concurrency <n>` | Batch concurrency (default 4, max 32) |
| `--pack <name>` | Bundled questions (ask) or bundled policy (gate, lint) |
| `--policy <file>` | Gate policy file |
| `--input <file>` | Saved judgment or record for `gate` |
| `--record <path>` | Write a decision record (noul/choice/score/ask) |
| `--live` | `doctor`: also authenticate, list models, and probe |
| `-f, --format <json\|table>` | Output format (default `json`) |
| `--help` | Show help |
| `--version` | Show version |

## Composition

```
input producer → jev ask (pack) → record → jev gate → authorized action
                                            ↘ jev replay / evaluate
```

- A citation tool assembles claims and evidence, calls `jev ask --pack verify`, then reads the gate exit code.
- An agent gate screens third-party content with `--pack screen` and routes work with `--pack route` before spending a call on a specialist.
- An evaluation tool joins records with labels and computes metrics (`tools/evaluate.mjs`).

Question design guidance lives in the [official skill](https://github.com/typesafe-ai/skills). Calibration runs over saved records, not inside inference: the CLI deliberately has no eval or threshold flags on the model-calling path.

## Library Usage

```typescript
import { TypeSafeClient, choice, noul } from "@fiale-plus/jev-cli";

const jev = new TypeSafeClient({ apiKey: process.env.TYPESAFE_API_KEY! });

const response = await jev.systemOne({
  state: "Payouts failing 3 days, help!",
  questions: {
    is_urgent: noul("Does this convey urgency?"),
    dept: choice("Which team handles this?", { billing: "Payments", technical: "Bugs" }),
  },
});
console.log(response.answers.is_urgent); // { type: "noul", noul: 0.98 }
console.log(response.usage);             // { input_tokens, output_tokens }
```

The package re-exports the official SDK client, builders, and error types, plus the offline decision layer:

```typescript
import { TypeSafeClient, choice, noul } from "@fiale-plus/jev-cli";

const client = new TypeSafeClient({ apiKey: process.env.TYPESAFE_API_KEY! });
const response = await client.systemOne({
  state: "Payouts failing 3 days, help!",
  questions: {
    is_urgent: noul("Does this convey urgency?"),
    dept: choice("Which team handles this?", { billing: "Payments", technical: "Bugs" }),
  },
});
console.log(response.answers.is_urgent); // { type: "noul", noul: 0.98 }
console.log(response.usage);             // { input_tokens, output_tokens }
```

Reuse one client across calls, own your state and elapsed time, and never apply a policy to a failed request:

```typescript
import { evaluatePolicy, loadPack, readRecord, buildRecord } from "@fiale-plus/jev-cli";

const { pack } = loadPack("verify");
const started = Date.now();
const response = await client.systemOne({ state: claim, questions: pack.questions });
const record = buildRecord({ pack: null, modelRequested: undefined, state: claim, questions: pack.questions, latencyMs: Date.now() - started }, response);
```

`readRecord` is the validated boundary for stored records — it returns a checked `DecisionRecord` or throws — while `isRecord` only detects the envelope. `extractResponse` accepts either a bare response or a decision record, so gating code does not care which one it was handed:

```typescript
const stored = readRecord(JSON.parse(savedText));
const result = evaluatePolicy(pack.policy, stored.response);
if (result.decision !== "accept") process.exit(result.exit_code);
```

A complete runnable version lives at `examples/library/record-and-gate.mts`. `GATE_EXIT` maps a decision to its exit code.

## Development

```bash
git clone https://github.com/fiale-plus/jev-cli.git
cd jev-cli
npm install
npm run build
npm test

# Dev mode (runs TypeScript directly)
npm run dev -- models
npm run dev -- noul "Urgent?" --state "help, failing!"

# Offline end-to-end: stub server + packs + gate + evaluation
npm run stub &
TYPESAFE_BASE_URL=http://127.0.0.1:8787 TYPESAFE_API_KEY=stub npm run dev -- ask --pack verify --state-file examples/verify/c1.json --state-format json

# Integration tests (offline; no key needed)
npm run test:integration
```

`packs/` ships with the package; `examples/` holds inputs and labels only — no recorded model output is committed, because fabricated answers presented as real ones are worse than no examples at all.

## Disclaimer

This is an **unofficial**, **community-maintained** tool. It is **not affiliated with, endorsed by, or connected to TypeSafe**.

Typed output guarantees the interface, not the truth — validate thresholds and accuracy on your own data. Start from the [confidence guide](https://docs.typesafe.ai/confidence) and [confidence-routing pattern](https://docs.typesafe.ai/patterns/confidence-routing).

## Links

- [TypeSafe docs](https://docs.typesafe.ai/) · [API reference](https://docs.typesafe.ai/api) · [Models](https://docs.typesafe.ai/models)
- [Agent skill](https://github.com/typesafe-ai/skills) · [Cookbooks](https://docs.typesafe.ai/llms.txt)
- [GitHub Repository](https://github.com/fiale-plus/jev-cli)
- [npm Package](https://www.npmjs.com/package/@fiale-plus/jev-cli)

## License

[MIT](LICENSE)
