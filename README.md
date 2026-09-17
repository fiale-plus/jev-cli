# @fiale-plus/jev-cli

**Unofficial** CLI and TypeScript client for the [TypeSafe System One API](https://docs.typesafe.ai/api) (Jev) — designed for AI agents.

Jev is TypeSafe's flagship System One model: send `state` + typed questions, get structured answers (`noul`/`choice`/`score` with probabilities + confidence) your code can branch on. No text generation, no parsing.

## Why a CLI when SDKs exist?

The [Python](https://docs.typesafe.ai/sdk/python) and [JavaScript](https://docs.typesafe.ai/sdk/javascript) SDKs cover in-process calls. This CLI adds the operator layer:

- **Shell composability** — pipes, `jq`, exit codes for confidence gating in CI
- **Question packs as reviewable files** — one JSON file holds questions + pinned model; `lint` validates design without spending API calls
- **Threshold sweep** — `eval` runs a labeled JSONL dataset and reports accuracy/Brier/ECE + a cutoff sweep, so `--yes-at`/`--act-above` come from your data, not cookbook defaults
- **Cost visibility** — every JSON response carries `usage` + `cost.estimated_usd` (input billed at $42/Btok, output free)

## Quick Start

```bash
npm install -g @fiale-plus/jev-cli
export TYPESAFE_API_KEY=ts_...

jev noul "Does this convey urgency?" --state "Payouts failing 3 days, help!"
jev models
```

Get a key at: https://console.typesafe.ai/settings/keys

## Installation

```bash
# Global (CLI usage)
npm install -g @fiale-plus/jev-cli

# Local (library usage)
npm install @fiale-plus/jev-cli
```

Requires Node.js >= 18.0.0.

## CLI Usage

### Single judgments

```bash
jev noul <instructions> --state <text> | --state-file <path> | --stdin
jev choice <instructions> --option name="desc" --option name2="desc" --state ...
jev score <instructions> --level "low" --level "high" --state ...
```

Noul takes optional `--true-means` / `--false-means` criteria. Choice needs ≥2 `--option` entries (`name="desc"` or bare `name`). Score needs ≥2 `--level` entries, lowest first. Trailing positional args are joined as state.

### Batch (`ask`)

One call, many questions over the same state — parallel, barely extra latency:

```bash
jev ask --state-file ticket.txt --questions pack.json
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

### Threshold tuning (`eval`)

```bash
jev eval --questions pack.json --dataset labeled.jsonl [--limit 200]
```

Dataset: one JSON object per line — `{"state": ..., "labels": {"qid": 0|1 | "<option>" | <level-index>}}`. Reports per-question accuracy, Brier, ECE, and a threshold sweep.

### Models

```bash
jev models
```

Pin `--model jev-1.13.0` (not the `jev-latest` alias) once thresholds are tuned — aliases drift, the response `model` field reports the versioned ID that answered.

### Thresholds (local policy, in code — not sent to the API)

| Flag | Default | Meaning |
|------|---------|---------|
| `--yes-at <p>` | 0.7 | Noul ≥ p is `yes` |
| `--no-at <p>` | 0.3 | Noul ≤ p is `no`, else `uncertain` |
| `--act-above <c>` | 0.8 | Choice/Score confidence ≥ c → `act` |
| `--review-above <c>` | 0.5 | Confidence ≥ c → `review`, else `abstain` |

### Exit codes (shell gating)

| Code | Meaning |
|------|---------|
| 0 | act / yes / no — usable answer |
| 2 | review / uncertain — needs a human or second opinion |
| 3 | abstain — low confidence, do not use |
| 1 | usage or API error |

### Common Options

| Flag | Description |
|------|-------------|
| `--api-key <key>` | API key (or `TYPESAFE_API_KEY` env var, required) |
| `--model <id>` | Model (default `jev-latest`) |
| `--base-url <url>` | API root (or `TYPESAFE_BASE_URL`) |
| `--timeout <ms>` | Request timeout (default 30000) |
| `--retries <n>` | Retries on 429/5xx with backoff (default 3) |
| `-f, --format <json\|table>` | Output format (default `json`) |
| `--help` | Show help |
| `--version` | Show version |

## Library Usage

```typescript
import { JevClient, lintQuestions } from "@fiale-plus/jev-cli";

const jev = new JevClient(process.env.TYPESAFE_API_KEY!);

const response = await jev.systemOne(
  "Payouts failing 3 days, help!",
  {
    is_urgent: { type: "noul", instructions: "Does this convey urgency?" },
    dept: { type: "choice", instructions: "Which team handles this?",
            criteria: { billing: "Payments", technical: "Bugs" } },
  },
  "jev-latest",
);
console.log(response.answers.is_urgent); // { type: "noul", noul: 0.98 }
console.log(response.usage);             // { input_tokens, output_tokens }

// Validate a pack before sending it
console.log(lintQuestions({ q: { type: "noul", instructions: "x" } }));
```

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
