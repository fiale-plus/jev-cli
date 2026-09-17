export function resolveApiKey(flagValue?: string): string {
  const key = flagValue || process.env.TYPESAFE_API_KEY;
  if (!key) {
    throw new Error("Missing API key: pass --api-key or set TYPESAFE_API_KEY (create one at https://console.typesafe.ai/settings/keys).");
  }
  return key;
}

function parseNumber(value: string | undefined, name: string, min: number, max: number, fallback: number): number {
  if (value === undefined) return fallback;
  const n = Number(value);
  if (!Number.isFinite(n) || n < min || n > max) {
    throw new Error(`Invalid ${name}: "${value}". Expected a number in [${min}, ${max}].`);
  }
  return n;
}

export function parseProbability(value: string | undefined, name: string, fallback: number): number {
  return parseNumber(value, name, 0, 1, fallback);
}

export function parsePositiveInt(value: string | undefined, name: string, fallback: number, max = 1_000_000): number {
  const n = parseNumber(value, name, 1, max, fallback);
  if (!Number.isInteger(n)) throw new Error(`Invalid ${name}: "${value}". Expected an integer.`);
  return n;
}

export function parseOption(pair: string): [string, string | null] {
  const eq = pair.indexOf("=");
  if (eq === -1) return [pair.trim(), null];
  return [pair.slice(0, eq).trim(), pair.slice(eq + 1)];
}
