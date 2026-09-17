#!/usr/bin/env node

import { JevClient, JevApiError } from "./api/client.js";
import { parseGlobal, extractGlobalOpts } from "./cli/parseArgs.js";
import type { OutputFormat } from "./cli/formatters.js";
import { ASK_HELP, EVAL_HELP, MAIN_HELP, MODELS_HELP } from "./cli/help.js";
import { resolveApiKey } from "./utils/validation.js";
import { handleAsk, handleLint, handleModels } from "./commands/batch.js";
import { handleEval } from "./commands/eval.js";
import { handleChoice, handleNoul, handleScore, clientOpts } from "./commands/single.js";

const VERSION = "0.0.0-dev";

async function main(): Promise<void> {
  const argv = process.argv.slice(2);

  if (argv.length === 0) {
    process.stdout.write(MAIN_HELP);
    return;
  }

  const command = argv[0];

  if (command === "--help" || command === "-h") {
    process.stdout.write(MAIN_HELP);
    return;
  }

  if (command === "--version" || command === "-v") {
    process.stdout.write(VERSION + "\n");
    return;
  }

  const parsed = parseGlobal(argv);
  const global = extractGlobalOpts(parsed.values as Record<string, unknown>);
  const format = global.format as OutputFormat;

  if (global.help) {
    if (command === "ask") process.stdout.write(ASK_HELP);
    else if (command === "eval") process.stdout.write(EVAL_HELP);
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
      const apiKey = resolveApiKey(global.apiKey);
      const client = new JevClient(apiKey, clientOpts(global));
      await handleModels(client, format);
      return;
    }

    case "noul":
    case "choice":
    case "score":
    case "ask":
    case "eval": {
      const apiKey = resolveApiKey(global.apiKey);
      const client = new JevClient(apiKey, clientOpts(global));
      if (group === "noul") await handleNoul(restArgs, global, client, format);
      else if (group === "choice") await handleChoice(restArgs, global, client, format);
      else if (group === "score") await handleScore(restArgs, global, client, format);
      else if (group === "ask") await handleAsk(global, client, format);
      else await handleEval(global, client);
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
  if (err instanceof JevApiError) {
    process.stderr.write(`Error: ${err.message}\n`);
  } else if (err instanceof Error) {
    process.stderr.write(`Error: ${err.message}\n`);
  } else {
    process.stderr.write(`Error: ${String(err)}\n`);
  }
  process.exitCode = 1;
});
