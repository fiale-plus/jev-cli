# jev-cli

Unofficial CLI over the official TypeSafe SDK (`@typesafe-ai/sdk`).

## Build & Test

```bash
npm run build              # tsc -> dist/
npm test                   # unit tests (mocked fetch with real Response)
npm run test:integration   # offline CLI tests (help, lint, validation — no key needed)
npm run dev -- <args>      # run CLI directly via tsx
```

Requires Node.js >= 20 (matches the official SDK).

## Architecture

- `src/api/client.ts` — thin wrapper: `createClient`/`systemOne` over `TypeSafeClient`, cost estimate
- `src/commands/requests.ts` — `noul`/`choice`/`score`/`ask` request builders (same upstream shape)
- `src/commands/ops.ts` — `batch` (bounded-concurrency JSONL), `lint` (structural only), `models`
- `src/cli/` — strict parseArgs, structural lint, formatters (json/table), help text
- `src/utils/` — `resolveApiKey` (flag > `TYPESAFE_API_KEY`), state readers (text/json, single source), numeric parsing
- `src/tests/` — node:test runner, fixtures in `tests/fixtures/`

## Conventions

- Official SDK owns transport, retries, errors, types — never duplicate
- ESM (`"type": "module"`) with `.js` import extensions
- API speaks camelCase bodies; CLI flags use kebab-case
- Successful inference exits 0; policy lives in the caller
- Tests mock `global.fetch` with real `Response` objects (SDK clones responses)
- Structural lint only; question-design advice lives in the official skill
- No eval/calibration in core; no threshold flags; no exit-code gating
