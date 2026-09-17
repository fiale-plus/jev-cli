# jev-cli

Unofficial CLI + TypeScript client for the TypeSafe System One API (Jev).

## Build & Test

```bash
npm run build              # tsc -> dist/
npm test                   # unit tests (mocked HTTP)
npm run test:integration   # offline CLI tests (help, lint, validation — no key needed)
npm run dev -- <args>      # run CLI directly via tsx
```

## Architecture

- `src/api/client.ts` — `JevClient` class, native `fetch`, POST `/v1/systemone` + GET `/v1/models`, retries 429/5xx with `retry-after`
- `src/api/types.ts` — request/response shapes mirroring https://docs.typesafe.ai/api; annotations (`verdict`/`action`) are CLI-local
- `src/commands/single.ts` — `noul`/`choice`/`score` one-shot builders
- `src/commands/batch.ts` — `ask` (parallel batch), `lint` (offline validation), `models`
- `src/commands/eval.ts` — `eval` threshold sweep over labeled JSONL (accuracy/Brier/ECE)
- `src/cli/` — parseArgs configs, gates (threshold→verdict/action→exit code), lint rules, formatters (json/table), help text
- `src/utils/` — `resolveApiKey` (flag > `TYPESAFE_API_KEY`), state readers (inline/file/stdin/positional), numeric parsing
- `src/tests/` — node:test runner, fixtures in `tests/fixtures/`

## Conventions

- Zero runtime dependencies (Node 18+ native fetch, parseArgs, test runner)
- ESM (`"type": "module"`) with `.js` import extensions
- API speaks camelCase bodies; CLI flags use kebab-case
- Thresholds live in code, never sent to the API; JSON output carries `cost.estimated_usd` (input $42/Btok, output free)
- Exit codes: 0 act/yes/no, 2 review/uncertain, 3 abstain, 1 error
- Tests mock `global.fetch` — no external mock libraries
- Node 18 compat: executor-form promises (no `Promise.withResolvers`), ES2022 lib
