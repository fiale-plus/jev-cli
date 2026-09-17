# jev-cli

Unofficial CLI over the official TypeSafe SDK (`@typesafe-ai/sdk`).

## Build & Test

```bash
npm run build              # tsc -> dist/
npm test                   # unit + contract tests (mocked fetch with real Response)
npm run test:integration   # offline CLI tests (help, lint, validation — no key needed)
npm run dev -- <args>      # run CLI directly via tsx
npm run stub               # deterministic offline stub API on 127.0.0.1:8787
npm run evaluate -- --records out/ --labels examples/verify/labels.jsonl
```

Requires Node.js >= 22.

## Architecture

- `src/api/client.ts` — thin wrapper: `createClient`/`systemOne` over `TypeSafeClient`, cost estimate
- `src/commands/requests.ts` — `noul`/`choice`/`score`/`ask` request builders (same upstream shape), records
- `src/commands/ops.ts` — `batch` (bounded-concurrency JSONL), `lint` (structural only), `models`
- `src/commands/gate.ts` — offline policy evaluation over a saved response or record
- `src/commands/replay.ts` — re-emit a stored record, marked `replayed: true`, no API call
- `src/commands/packs.ts` — pack loading/validation from `packs/`, listed by `jev packs`
- `src/commands/doctor.ts` — local config checks, `--live` for auth/models/latency/cost
- `src/cli/` — strict parseArgs, structural lint, policy schema + evaluation, records, formatters, help text
- `src/utils/` — `resolveApiKey` (flag > `TYPESAFE_API_KEY`), state readers, numeric parsing, canonical hashing, package root/version
- `packs/` — versioned question sets + policies (`verify`, `screen`, `route`); shipped in the tarball
- `src/tests/` — node:test runner, fixtures in `tests/fixtures/`
- `tools/` — `stub-server.mjs` (offline API), `evaluate.mjs` (policy scoring over labeled records)
- `examples/` — inputs and labels only; never committed model output

## Conventions

- Official SDK owns transport, retries, errors, types — never duplicate
- ESM (`"type": "module"`) with `.js` import extensions
- API speaks camelCase bodies; CLI flags use kebab-case
- Successful inference exits 0; policy lives in the caller
- Gate exit codes are decisions: 0 accept, 2 review, 3 deny, 4 abstain (1 = error). Judgment on stdout, decision in the status
- Policy evaluation is offline and fail-closed: a missing or mismatched answer abstains, and a label outside `accept` never accepts
- Records hash the state; never store it. `jev replay` is not a rerun
- `--version` reads `package.json` at runtime; the publish workflow fails when a release tag disagrees with it
- Tests mock `global.fetch` with real `Response` objects (SDK clones responses); `contract.test.ts` spawns the real CLI
- Structural lint only; question-design advice lives in the official skill
- No eval/calibration or threshold flags on the model-calling path; evaluation runs over saved records
- No MCP surface: deliberately out of scope
