export const MAIN_HELP = `jev-cli — Unofficial CLI for the TypeSafe System One API (Jev)

USAGE
  jev <command> [args] [options]

COMMANDS
  noul <instructions>              Yes/no judgment (returns noul 0..1 + verdict)
  choice <instructions>            Pick one option (--option name="desc" ×2+)
  score <instructions>             Rate along levels (--level "desc" ×2+, lowest first)
  ask                              Batch: --questions file.json (+ state), one parallel call
  lint                             Validate a questions file without calling the API
  eval                             Sweep thresholds over a labeled JSONL dataset
  models                           List models available to your key

STATE (all judgment commands)
  --state <text>                   State inline
  --state-file <path>              State from file ("-" = stdin)
  --stdin                          Read state from stdin
  (bare positional args after instructions are joined as state)

QUESTIONS FILE (ask)
  {"qid": {"type": "noul|choice|score", "instructions": "...", "criteria": ...}}
  IDs are for your code only — never sent to the model. Write complete
  instructions even when the ID looks self-explanatory.

THRESHOLDS (local policy, evaluated in code — not sent to the API)
  --yes-at <p>                     Noul >= p is "yes" (default 0.7)
  --no-at <p>                      Noul <= p is "no" (default 0.3, else uncertain)
  --act-above <c>                  Choice/Score confidence >= c acts (default 0.8)
  --review-above <c>               Confidence >= c reviews, else abstains (default 0.5)

EXIT CODES (shell gating)
  0  act / yes / no                usable answer
  2  review / uncertain            needs a human or second opinion
  3  abstain                       low confidence, do not use
  1  usage or API error

GLOBAL OPTIONS
  --api-key <key>                  API key (or TYPESAFE_API_KEY env var, required)
  --model <id>                     Model (default jev-latest; pin jev-1.13.0 for stable thresholds)
  --base-url <url>                 API root (or TYPESAFE_BASE_URL, default https://api.typesafe.ai)
  --timeout <ms>                   Request timeout (default 30000)
  --retries <n>                    Retries on 429/5xx with backoff (default 3)
  -f, --format <json|table>        Output format (default json)
  --true-means <text>              Noul criteria.true: what yes means
  --false-means <text>             Noul criteria.false: what no means
  --help                           Show help
  --version                        Show version

EXAMPLES
  jev noul "Does this convey urgency?" --state "Payouts failing 3 days, help!"
  cat ticket.txt | jev choice "Which team handles this?" --option billing="Payments" --option technical="Bugs" --stdin
  jev score "How frustrated?" --level "Calm" --level "Frustrated" --level "Angry" --state-file ticket.txt
  jev ask --state-file ticket.txt --questions pack.json
  jev lint --questions pack.json
  jev eval --questions pack.json --dataset labeled.jsonl
  jev models

DOCS
  API: https://docs.typesafe.ai/api  Models: https://docs.typesafe.ai/models
  Confidence: https://docs.typesafe.ai/confidence  Skill: https://github.com/typesafe-ai/skills

DISCLAIMER
  Unofficial, community-maintained. Not affiliated with TypeSafe.
  Typed output guarantees the interface, not the truth — validate on your data.
`;

export const ASK_HELP = `jev ask — Batch questions over one state in a single call

USAGE
  jev ask --questions <file> [--state <text> | --state-file <path> | --stdin]

QUESTIONS FILE
  JSON object mapping caller-chosen IDs to questions:
  {
    "is_urgent": {"type": "noul", "instructions": "Does this convey urgency?"},
    "dept": {"type": "choice", "instructions": "Which team handles this?",
             "criteria": {"billing": "Payments", "technical": "Bugs"}},
    "frustration": {"type": "score", "instructions": "How frustrated?",
                    "criteria": ["Calm", "Frustrated", "Angry"]}
  }

NOTES
  Questions run in parallel and cannot see each other's answers — state any
  speculative premise explicitly. Extra questions cost tokens but barely add
  latency. "jev lint" validates the file first. Pin --model to a versioned ID
  (e.g. jev-1.13.0) when thresholds are tuned, since aliases drift.
`;

export const EVAL_HELP = `jev eval — Sweep thresholds over a labeled JSONL dataset

USAGE
  jev eval --questions <file> --dataset <file> [--limit <n>]

DATASET (one JSON object per line)
  {"state": "...", "labels": {"qid": <0|1 for noul, "<option>" for choice, <level-index> for score>}}

REPORT
  Per question: accuracy, Brier score, ECE (10 bins), and a threshold sweep
  suggesting --yes-at / --act-above cutoffs. Tune on your own data; cookbook
  thresholds are starting points, not rules.
`;

export const MODELS_HELP = `jev models — List models available to your key

USAGE
  jev models

NOTE
  The list carries aliases. Versioned IDs (e.g. jev-1.13.0) are accepted by
  the model field whether or not they appear in the list. The response "model"
  field reports the versioned ID that answered — log it.
`;
