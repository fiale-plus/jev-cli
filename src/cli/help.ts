export const MAIN_HELP = `jev-cli — Unofficial CLI for the TypeSafe System One API (Jev)

USAGE
  jev <command> [args] [options]

COMMANDS
  noul <instructions>              Yes/no judgment (returns noul 0..1)
  choice <instructions>            Pick one option (--option name="desc" ×2+)
  score <instructions>             Rate along levels (--level "desc" ×2+, lowest first)
  ask                              Batch questions over one state in a single call
  decide                           Judge and apply a pack policy in one call
  gate                             Apply a policy to a saved judgment — no API call
  replay                           Re-emit a stored record — no API call
  packs                            List the bundled question packs
  doctor                           Check configuration; --live also checks the API
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
  --pack <name>                    Bundled questions/policy pack
  --pack-file <path>               Project-owned questions/policy pack
  --record <path>                  Write a decision record (state hashed, not stored)
  --run-id <id>                    Correlate related operations
  --decision-id <id>               Set the decision correlation ID
  --parent-id <id>                 Link this decision to a parent operation
EXIT CODES (execution status)
  0  success — inference completed, answers on stdout
  1  usage, transport, or API error
  2  gate: review   3  gate: deny   4  gate: abstain

Confidence and probabilities are data on stdout. For inference commands an exit
code is never a judgment; apply a policy with "jev gate" (which evaluates a saved
response offline and exits 0/2/3/4) and let the caller act on it.

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
  jev ask --pack verify --state-file claim.json --state-format json --record decisions/claim-1.json
  jev gate --input decisions/claim-1.json --pack verify; echo "exit $?"
  jev replay --record decisions/claim-1.json
  jev packs
  jev doctor
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
export const DECIDE_HELP = `jev decide — Run inference and policy together

USAGE
  jev decide --pack <name> --state-file <path> [--record <path>]
  jev decide --pack-file <path> --state-file <path> [--format decision]

The policy is explicit in the selected pack. JSON output separates response,
gate result, provenance, and correlation IDs. Exit codes are accept 0,
review 2, deny 3, abstain 4; execution failures remain 1.
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
  The list carries aliases. Versioned IDs are accepted by the model field; the
  response model field reports the versioned ID that answered — log it.
`;
export const GATE_HELP = `jev gate — Apply a policy to a saved judgment (no API call)

USAGE
  jev gate --input <file> --pack <name>          Policy bundled with a pack
  jev gate --input <file> --policy <file>        Your own policy
  jev gate --input <file> --pack screen -f table

INPUT
  The JSON printed by an inference command, or a record written with --record.

POLICY (exactly one of --pack / --policy)
{
  "policy_version": 1,
  "name": "my-policy",
  "mode": "all",
  "rules": [
    {"answer": "relation", "type": "choice", "accept": ["supports"], "accept_at": 0.8, "review_at": 0.5},
    {"answer": "injection", "type": "noul", "accept_when": "no", "accept_at": 0.9, "review_at": 0.7},
    {"answer": "severity", "type": "score", "higher_is_worse": true, "accept_at": 0.5, "review_at": 1.5}
  ]
}

RULES
  Every rule names one answer and the condition that permits proceeding.
  A label outside "accept" never accepts, however confident the model is.
  A missing or wrong-typed answer abstains — it never accepts.
  A choice answer must carry a probability map whose values sit in [0, 1] and sum
  to 1: a malformed or off-label map abstains rather than falling back to a
  confidence number that means something else.
  A score must fall inside its scale (the rule's "range", else the level indices
  the answer reports in legend/probabilities); an out-of-scale score abstains.
  mode "all" (default) takes the worst outcome: deny > abstain > review > accept.
  mode "any" is the reverse. Mark a rule "optional": true to skip it when absent.

RECORDS
  Gating a record written by --record against the pack that produced it checks
  identity: if the pack's questions changed, the stored answers no longer mean
  the same thing, so the run fails (exit 1) until you re-run the request or gate
  with --policy explicitly. If only the thresholds changed, the questions are
  unchanged and the current policy applies, with a warning on stderr. Both the
  pack hash and that comparison are printed in either format.

EXIT CODES
  0 accept   2 review   3 deny   4 abstain   1 error

  The decision and per-rule reasons go to stdout in both formats, so a caller can
  act on the exit code and log why. Deny ("policy forbids") and abstain ("not
  enough information") are separate codes because remediation differs.
`;

export const REPLAY_HELP = `jev replay — Re-emit a stored record (no API call)

USAGE
  jev replay --record <file> [-f json|table]

WHAT IT IS
  Replay prints the answers that were already paid for, marked "replayed": true,
  for re-running downstream policy without re-running inference. An answer is
  reproducible only while the model version stays pinned: the record carries
  model_resolved, and a fresh call to a different version is a new decision.

  To gate a stored record, use "jev gate --input <record>"; to compare a stored
  decision against a new one, replay both and diff.
`;

export const PACKS_HELP = `jev packs — List the bundled question packs

USAGE
  jev packs [-f json|table]

WHAT A PACK IS
  A versioned question set plus the policy that says when its answers permit
  proceeding. Pass --pack <name> to "ask" for the questions, or to "gate" for
  the policy. The pack hash is printed so a decision record can name the exact
  revision it used.

BUNDLED
  verify   Claim vs. cited evidence -> supports / contradicts / says_nothing
  screen   Untrusted content -> injection, harmful content, severity (+ substance, relevance)
  route    Request -> deterministic / specialist / human / none, plus complexity

  screen is advisory: it is a judgment layer, not a security boundary.
  Ranking candidates has dynamic options, so it is not a pack — see examples/rank.
`;

export const DOCTOR_HELP = `jev doctor — Check configuration before spending a call

USAGE
  jev doctor            Local checks only: engine, key presence, base URL, model, packs
  jev doctor --live     Also authenticate, list models, and time a probe

NOTE
  The API key is reported by presence and source, never by value. Exit is 1 when
  any check fails. Warnings (no key, skipped live checks) do not fail the run.
`;
