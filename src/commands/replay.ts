import type { GlobalOptions } from "../cli/parseArgs.js";
import type { OutputFormat } from "../cli/formatters.js";
import { formatReplay } from "../cli/formatters.js";
import { RECORD_VERSION, isRecord } from "../cli/records.js";
import { readJsonFile } from "../utils/io.js";

// Replay never calls the API: it re-emits answers that were already paid for, and
// says so, so a stored decision cannot be mistaken for a fresh one.
export async function handleReplay(global: GlobalOptions, format: OutputFormat): Promise<void> {
  if (!global.record) {
    throw new Error("Missing --record <file>: jev replay --record decisions/claim-1.json.");
  }
  const raw = readJsonFile(global.record);
  if (!isRecord(raw)) {
    throw new Error(`Invalid record ${global.record}: expected a decision record written by --record (record_version ${RECORD_VERSION}).`);
  }
  process.stdout.write(formatReplay(raw, format) + "\n");
}
