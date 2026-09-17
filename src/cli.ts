#!/usr/bin/env node

import { APIError, TypeSafeError } from "@typesafe-ai/sdk";
import { parseGlobal, extractGlobalOpts } from "./cli/parseArgs.js";
import type { OutputFormat } from "./cli/formatters.js";
import { ASK_HELP, BATCH_HELP, MAIN_HELP, MODELS_HELP } from "./cli/help.js";
import { resolveApiKey } from "./utils/validation.js";
import { handleBatch, handleLint, handleModels } from "./commands/ops.js";
import { clientOpts, handleAsk, handleChoice, handleNoul, handleScore } from "./commands/requests.js";

const VERSION = "0.0.0-dev";

async function main(): Promise<void> {
  const argv = process.argv.slice(2);

  if (argv.length === 0) {
    process.stdout.write(MAIN_HELP);
    return;
  }

  const parsed = parseGlobal(argv);
  const global = extractGlobalOpts(parsed.values as Record<string, unknown>);
  const format = global.format as OutputFormat;

  if (global.help) {
    const [command] = parsed.positionals as string[];
    if (command === "ask") process.stdout.write(ASK_HELP);
    else if (command === "batch") process.stdout.write(BATCH_HELP);
    else if (command === "models") process.stdout.write(MODELS_HELP);
    else process.stdout.write(MAIN_HELP);
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
      process.stderr.write(`Unknown command: ${group}\n\n`);
      process.stdout.write(MAIN_HELP);
      process.exitCode = 1;
      return;
  }
}

main().catch((err) => {
  // Exit codes are execution status: 1 for usage/transport/API errors.
  // Successful inference always exits 0 — confidence is data for the caller.
  if (err instanceof APIError) {
    process.stderr.write(`Error: TypeSafe API error ${err.status}: ${err.message}\n`);
    if (err.requestId) process.stderr.write(`request-id: ${err.requestId}\n`);
  } else if (err instanceof TypeSafeError) {
    process.stderr.write(`Error: ${err.message}\n`);
  } else if (err instanceof Error) {
    process.stderr.write(`Error: ${err.message}\n`);
  } else {
    process.stderr.write(`Error: ${String(err)}\n`);
  }
  process.exitCode = 1;
});
