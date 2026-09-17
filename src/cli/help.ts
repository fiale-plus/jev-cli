export const MAIN_HELP = `jev-cli — Unofficial CLI for the TypeSafe System One API (Jev)

USAGE
  jev <command> [args] [options]

COMMANDS
  noul <instructions>              Yes/no judgment (returns noul 0..1)
  choice <instructions>            Pick one option (--option name="desc" ×2+)
  score <instructions>             Rate along levels (--level "desc" ×2+, lowest first)
  ask                              Batch questions over one state in a single call
  batch                            Many requests from a JSONL file, bounded concurrency
  lint                             Validate a questions file without calling the API
  models                           List models available to your key

STATE (noul/choice/score/ask)
  --state <text>                   State inline
  --state-file <path>              State from file ("-" = stdin)
  --state-format <text|json>       Parse state input as JSON (default text)
  --stdin                          Read state from stdin
  (bare positional args after instructions are joined as state)

REQUEST FILE (ask)
  --request <path>                 Full request {"state","questions","model?"}
  --questions <file>               Questions map (with --state/--state-file/--stdin)

EXIT CODES (execution status)
  0  success — inference completed, answers on stdout
  1  usage, transport, or API error

Confidence and probabilities are data on stdout. Policy (act/review/abstain,
yes/no thresholds) belongs in the caller, not the exit code.

GLOBAL OPTIONS
  --api-key <key>                  API key (or TYPESAFE_API_KEY env var, required)
  --model <id>                     Model override (or TYPESAFE_DEFAULT_MODEL, default jev-latest)
  --base-url <url>                 API root (or TYPESAFE_BASE_URL)
  --log-level <level>              SDK log level: debug|info|warn|error|off
  --timeout <ms>                   Request timeout in ms (SDK default 10000)
  --retries <n>                    Max retries, 0 disables (SDK default 2)
  --concurrency <n>                Batch concurrency (default 4, max 32)
  -f, --format <json|table>        Output format (default json)
  --true-means <text>              Noul criteria.true: what yes means
  --false-means <text>             Noul criteria.false: what no means
  --help                           Show help
  --version                        Show version

EXAMPLES
  jev noul "Does this convey urgency?" --state "Payouts failing 3 days, help!"
  cat ticket.txt | jev choice "Which team handles this?" --option billing="Payments" --option technical="Bugs" --stdin
  jev score "How frustrated?" --level "Calm" --level "Frustrated" --level "Angry" --state-file ticket.txt
  jev ask --state-file ticket.json --state-format json --questions pack.json
  echo '{"state":"...","questions":{...}}' | jev ask --request -
  jev batch --request requests.jsonl --concurrency 8
  jev lint --questions pack.json
  jev models

DOCS
  API: https://docs.typesafe.ai/api  Models: https://docs.typesafe.ai/models
  Confidence: https://docs.typesafe.ai/confidence  Skill: https://github.com/typesafe-ai/skills

DISCLAIMER
  Unofficial, community-maintained. Not affiliated with TypeSafe.
  Typed output guarantees the interface, not the truth — validate on your data.
`;

export const ASK_HELP = `jev ask — Questions over one state in a single call

USAGE
  jev ask --request <file>                     Full request {"state","questions","model?"}
  jev ask --questions <file> --state ...       Questions + explicit state

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
  latency. "jev lint" validates the file first. Pin the model to a versioned ID
  (e.g. jev-1.13.0) when thresholds are tuned, since aliases drift.
  State may be text or structured JSON: use --state-format json for objects/arrays.
`;

export const BATCH_HELP = `jev batch — Many independent requests from a JSONL file

USAGE
  jev batch --request <file.jsonl> [--concurrency <n>]
  jev batch --state-file <file.jsonl> --questions <file> [--model <id>] [--concurrency <n>]

INPUT (one JSON object per line)
  {"id": "row-1", "state": ..., "questions": {...}, "model": "jev-1.13.0"}
  With --request, every record carries its own questions/model. With
  --state-file, records carry state (+id) and share --questions/--model.

CONTRACT
  One result/error record per input record, input order preserved, streamed to
  stdout as JSON lines: {"index","id","ok","response"|"error"}. Overall exit is
  1 when any record fails. No re-execution of successful records — callers
  filter and retry the failures themselves.
`;

export const MODELS_HELP = `jev models — List models available to your key

USAGE
  jev models

NOTE
  The list carries aliases. Versioned IDs (e.g. jev-1.13.0) are accepted by
  the model field whether or not they appear in the list. The response "model"
  field reports the versioned ID that answered — log it.
`;
