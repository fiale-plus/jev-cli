import { createReadStream, readFileSync } from "node:fs";
import { createInterface } from "node:readline";

export interface StateSource {
  state?: string;
  stateFile?: string;
  stateFormat: "text" | "json";
  stdin: boolean;
}

// Exactly one state source. --state-format json parses --state/--state-file/stdin
// as JSON so objects and arrays reach the API unchanged.
export async function readState(opts: StateSource & { extra: string[] }): Promise<unknown> {
  const inline = opts.state !== undefined;
  const fromFile = opts.stateFile !== undefined;
  const fromStdin = opts.stdin || (!process.stdin.isTTY && opts.extra.length === 0 && !inline && !fromFile);
  const count = [inline, fromFile, fromStdin].filter(Boolean).length;
  if (count > 1) {
    throw new Error("Conflicting state sources: use exactly one of --state, --state-file, or stdin.");
  }

  let raw: string | undefined;
  if (inline) raw = opts.state as string;
  else if (fromFile) {
    raw = opts.stateFile === "-" ? await readStdin() : readFileSync(opts.stateFile as string, "utf8");
  } else if (fromStdin) {
    raw = await readStdin();
  }

  if (raw === undefined) {
    if (opts.extra.length > 0) raw = opts.extra.join(" ");
    else throw new Error("Missing state: pass --state, --state-file, --stdin, or trailing text.");
  }

  if (opts.stateFormat === "json") {
    try {
      return JSON.parse(raw) as unknown;
    } catch {
      throw new Error("Invalid JSON state: --state-format json requires valid JSON.");
    }
  }
  return raw;
}

export function readStdin(): Promise<string> {
  return new Promise((resolve, reject) => {
    let data = "";
    process.stdin.setEncoding("utf8");
    process.stdin.on("data", (chunk) => {
      data += chunk;
    });
    process.stdin.on("end", () => resolve(data));
    process.stdin.on("error", reject);
  });
}

export function readJsonFile(path: string): unknown {
  const raw = path === "-" ? readFileSync(0, "utf8") : readFileSync(path, "utf8");
  try {
    return JSON.parse(raw) as unknown;
  } catch {
    throw new Error(`Invalid JSON in ${path === "-" ? "stdin" : path}.`);
  }
}

// Streaming JSONL reader: backpressure-friendly, never loads the whole file.
export async function *readJsonlStream(path: string): AsyncGenerator<{ index: number; record: unknown }> {
  const input = path === "-" ? process.stdin : createReadStream(path, { encoding: "utf8" });
  const rl = createInterface({ input, crlfDelay: Infinity });
  let index = 0;
  try {
    for await (const line of rl) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      let record: unknown;
      try {
        record = JSON.parse(trimmed) as unknown;
      } catch {
        throw new Error(`Invalid JSONL line ${index + 1} in ${path === "-" ? "stdin" : path}.`);
      }
      yield { index, record };
      index++;
    }
  } finally {
    rl.close();
  }
}
