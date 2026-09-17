import { readFileSync } from "node:fs";

export async function readState(opts: { state?: string; stateFile?: string; stdin: boolean; extra: string[] }): Promise<unknown> {
  if (opts.state !== undefined) return opts.state;
  if (opts.stateFile !== undefined) {
    if (opts.stateFile === "-") return readStdin();
    return readFileSync(opts.stateFile, "utf8");
  }
  if (opts.stdin || !process.stdin.isTTY) {
    const text = await readStdin();
    // Piped-but-empty stdin with positional fallback: prefer positionals.
    if (text.length > 0 || opts.extra.length === 0) return text;
  }
  if (opts.extra.length > 0) return opts.extra.join(" ");
  throw new Error("Missing state: pass --state, --state-file, --stdin, or trailing text.");
}

export function readStdin(): Promise<string> {
  // Executor form (not Promise.withResolvers): Node 18 compat per engines.
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

export function readJsonlFile(path: string, limit?: number): Array<Record<string, unknown>> {
  const raw = path === "-" ? readFileSync(0, "utf8") : readFileSync(path, "utf8");
  const rows: Array<Record<string, unknown>> = [];
  for (const line of raw.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    try {
      rows.push(JSON.parse(trimmed) as Record<string, unknown>);
    } catch {
      throw new Error(`Invalid JSONL line ${rows.length + 1} in ${path === "-" ? "stdin" : path}.`);
    }
    if (limit !== undefined && rows.length >= limit) break;
  }
  return rows;
}
