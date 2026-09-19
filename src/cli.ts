#!/usr/bin/env node

import { APIError, TypeSafeError } from "@typesafe-ai/sdk";
import { parseGlobal, extractGlobalOpts } from "./cli/parseArgs.js";
import type { OutputFormat } from "./cli/formatters.js";
import { formatJsonError } from "./cli/formatters.js";
import { ASK_HELP, BATCH_HELP, DECIDE_HELP, DOCTOR_HELP, GATE_HELP, MAIN_HELP, MODELS_HELP, PACKS_HELP, REPLAY_HELP } from "./cli/help.js";
import { resolveApiKey } from "./utils/validation.js";
import { cliVersion } from "./utils/package.js";
import { handleBatch, handleLint, handleModels } from "./commands/ops.js";
import type { ClientOpts } from "./api/client.js";
import { clientOpts, handleAsk, handleChoice, handleNoul, handleScore } from "./commands/requests.js";
import { handleGate } from "./commands/gate.js";
import { handleReplay } from "./commands/replay.js";
import { handleDoctor } from "./commands/doctor.js";
import { handlePacks } from "./commands/packs.js";
import { handleDecide } from "./commands/decide.js";

const HELP_BY_COMMAND: Record<string, string> = {
  ask: ASK_HELP,
  batch: BATCH_HELP,
  decide: DECIDE_HELP,
  models: MODELS_HELP,
  gate: GATE_HELP,
  replay: REPLAY_HELP,
  packs: PACKS_HELP,
  doctor: DOCTOR_HELP,
};
async function main(): Promise<void> {
  const argv = process.argv.slice(2);

  if (argv.length === 0) {
    process.stderr.write(MAIN_HELP);
    process.exitCode = 1;
    return;
  }

  const parsed = parseGlobal(argv);
  const global = extractGlobalOpts(parsed.values as Record<string, unknown>);
  const format = global.format as OutputFormat;

  if (global.help) {
    const [command] = parsed.positionals as string[];
    // --help goes to stdout (it IS the output); unknown commands go to stderr.
    process.stdout.write((command !== undefined ? HELP_BY_COMMAND[command] : undefined) ?? MAIN_HELP);
    return;
  }

  if (global.version) {
    process.stdout.write(cliVersion() + "\n");
    return;
  }

  const positionals = parsed.positionals as string[];
  const group = positionals[0];
  const restArgs = positionals.slice(1);

  switch (group) {
    case "lint":
      await handleLint(global);
      return;

    case "decide": {
      const opts = clientOpts(global, resolveApiKey(global.apiKey));
      await handleDecide(global, opts, format);
      return;
    }
    case "gate":
      await handleGate(global, format);
      return;

    case "replay":
      await handleReplay(global, format);
      return;

    case "packs":
      handlePacks(restArgs, format);
      return;

    case "doctor": {
      // Doctor reports a missing key instead of failing on it.
      let opts: ClientOpts | undefined;
      try {
        opts = clientOpts(global, resolveApiKey(global.apiKey));
      } catch {
        opts = undefined;
      }
      await handleDoctor(global, opts, format);
      return;
    }

    case "models": {
      const opts = clientOpts(global, resolveApiKey(global.apiKey));
      await handleModels(opts, format);
      return;
    }

    case "noul":
    case "choice":
    case "score":
    case "ask":
    case "batch": {
      const opts = clientOpts(global, resolveApiKey(global.apiKey));
      if (group === "noul") await handleNoul(restArgs, global, opts, format);
      else if (group === "choice") await handleChoice(restArgs, global, opts, format);
      else if (group === "score") await handleScore(restArgs, global, opts, format);
      else if (group === "ask") await handleAsk(global, opts, format);
      else await handleBatch(global, opts, format);
      return;
    }

    default:
      process.stderr.write(`Unknown command: ${group}\n\n${MAIN_HELP}`);
      process.exitCode = 1;
      return;
  }
}

main().catch((err) => {
  // Exit codes are execution status: 1 for usage/transport/API errors.
  // Successful inference always exits 0 — confidence is data for the caller.
  // JSON errors go to stderr in every format; stdout stays machine-parseable.
  let code = "ERROR";
  let message: string;
  let details: unknown;
  if (err instanceof APIError) {
    code = `API_${err.status}`;
    message = `TypeSafe API error ${err.status}: ${err.message}`;
    details = err.requestId ? { requestId: err.requestId } : undefined;
  } else if (err instanceof TypeSafeError) {
    code = "CLIENT_ERROR";
    message = err.message;
  } else if (err instanceof Error) {
    if (err.message.includes("Invalid ") || err.message.includes("Missing ") || err.message.includes("Conflicting ") || err.message.includes("Unknown ")) {
      code = "USAGE_ERROR";
    }
    message = err.message;
  } else {
    message = String(err);
  }
  process.stderr.write(formatJsonError(code, message, details) + "\n");
  process.exitCode = 1;
});
