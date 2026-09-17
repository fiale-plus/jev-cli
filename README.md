# @fiale-plus/jev-cli

**Unofficial** CLI for the [TypeSafe System One API](https://docs.typesafe.ai/api) (Jev) — designed for AI agents and anything that can execute a process.

Jev is TypeSafe's System One model: send `state` + typed questions, get structured answers (`noul`/`choice`/`score` with probabilities + confidence) your code can branch on. No text generation, no parsing.

Transport, retries, and types come from the official [`@typesafe-ai/sdk`](https://docs.typesafe.ai/sdk/javascript). This CLI adds the shell interface: explicit input, machine-readable output, and execution exit codes.

## Why a CLI when SDKs exist?

The SDKs cover in-process calls. This CLI covers everything with a subprocess:

- **Shell composability** — pipes, `jq`, JSONL batch, documented exit codes
- **Question files as reviewable artifacts** — one JSON file holds questions; `lint` validates structure without spending API calls
- **Structured state** — `--state-format json` preserves objects/arrays end to end
- **Cost visibility** — every JSON response carries `usage` + `cost.estimated_usd` (input billed at $42/Btok, output free)

Policy lives in the caller. A successful inference exits 0 even when answers are uncertain — probabilities and confidence are data on stdout, not authorization.

## Quick Start

```bash
npm install -g @fiale-plus/jev-cli
export TYPESAFE_API_KEY=ts_...

jev noul "Does this convey urgency?" --state "Payouts failing 3 days, help!"
jev models
```

Get a key at: https://console.typesafe.ai/settings/keys

Requires Node.js >= 20.0.0 (matches the official SDK).

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
jev batch --request states.jsonl --questions pack.json
```

Input records: `{"id": "row-1", "state": ..., "questions": {...}, "model": "jev-1.13.0"}`. Per-record `questions`/`model` may be omitted when `--questions`/`--model` covers them. Output is JSON lines: `{"id","ok","response"|"error"}`. Overall exit is 1 when any record fails — filter and retry failures in the caller.

### Models

```bash
jev models
```

Pin `--model jev-1.13.0` (not the `jev-latest` alias) once thresholds are tuned — aliases drift, the response `model` field reports the versioned ID that answered.

### Exit codes (execution status)

| Code | Meaning |
|------|---------|
| 0 | success — inference completed, answers on stdout |
| 1 | usage, transport, or API error |

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
| `-f, --format <json\|table>` | Output format (default `json`) |
| `--help` | Show help |
| `--version` | Show version |

## Composition

```
input producer → request builder → jev → policy/consumer → authorized action
```

- A citation tool assembles claims and evidence, calls `jev`, then renders discrepancies.
- A routing tool constructs candidates, reads the selected answer, then applies its own fallback policy.
- An evaluation tool generates requests, stores predictions, and computes metrics independently.

Question design guidance lives in the [official skill](https://github.com/typesafe-ai/skills). Evaluation and calibration belong in separate tooling over saved results — this CLI deliberately has no `eval` command.

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

The package re-exports the official SDK client, builders, and error types.

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

# Integration tests (offline; no key needed)
npm run test:integration
```

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
