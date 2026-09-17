#!/usr/bin/env node

import { APIError, TypeSafeError } from "@typesafe-ai/sdk";
import { parseGlobal, extractGlobalOpts } from "./cli/parseArgs.js";
import type { OutputFormat } from "./cli/formatters.js";
import { formatJsonError } from "./cli/formatters.js";
import { ASK_HELP, BATCH_HELP, MAIN_HELP, MODELS_HELP } from "./cli/help.js";
import { resolveApiKey } from "./utils/validation.js";
import { handleBatch, handleLint, handleModels } from "./commands/ops.js";
import { clientOpts, handleAsk, handleChoice, handleNoul, handleScore } from "./commands/requests.js";

const VERSION = "0.1.0";

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
    const text = command === "ask" ? ASK_HELP : command === "batch" ? BATCH_HELP : command === "models" ? MODELS_HELP : MAIN_HELP;
    // --help goes to stdout (it IS the output); unknown commands go to stderr.
    process.stdout.write(text);
    return;
  }

  if (global.version) {
    process.stdout.write(VERSION + "\n");
    return;
  }

  const positionals = parsed.positionals as string[];
  const group = positionals[0];
  const restArgs = positionals.slice(1);

  switch (group) {
    case "lint":
      await handleLint(global);
      return;

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
