import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const exec = promisify(execFile);
const __dirname = dirname(fileURLToPath(import.meta.url));
const CLI = join(__dirname, "..", "cli.ts");
const TSX = join(__dirname, "..", "..", "node_modules", ".bin", "tsx");

async function run(args: string[], env?: Record<string, string>): Promise<{ stdout: string; stderr: string }> {
  try {
    const result = await exec(TSX, [CLI, ...args], {
      env: { ...process.env, ...env },
      timeout: 30_000,
    });
    return { stdout: result.stdout, stderr: result.stderr };
  } catch (err: unknown) {
    const e = err as { stdout?: string; stderr?: string };
    return { stdout: e.stdout || "", stderr: e.stderr || "" };
  }
}

describe("CLI integration (offline)", () => {
  it("shows help with --help", async () => {
    const { stdout } = await run(["--help"]);
    assert.ok(stdout.includes("jev-cli"));
    assert.ok(stdout.includes("COMMANDS"));
    assert.ok(stdout.includes("noul"));
  });

  it("shows help with no args", async () => {
    const { stdout } = await run([]);
    assert.ok(stdout.includes("jev-cli"));
  });

  it("shows version with --version", async () => {
    const { stdout } = await run(["--version"]);
    assert.match(stdout.trim(), /^\d+\.\d+\.\d+/);
  });

  it("shows ask help with just 'ask'", async () => {
    const { stdout } = await run(["ask"]);
    assert.ok(stdout.includes("jev ask"));
  });

  it("shows eval help with just 'eval'", async () => {
    const { stdout } = await run(["eval"]);
    assert.ok(stdout.includes("jev eval"));
  });

  it("errors on unknown command", async () => {
    const { stderr } = await run(["foobar"]);
    assert.ok(stderr.includes("Unknown command"));
  });

  it("errors without API key on live commands", async () => {
    const env = { ...process.env };
    delete env.TYPESAFE_API_KEY;
    const { stderr } = await run(["models"], { TYPESAFE_API_KEY: "" });
    assert.ok(stderr.includes("Missing API key") || stderr.includes("Error"));
    void env;
  });

  it("rejects invalid format", async () => {
    const { stderr } = await run(["models", "--format", "csv"]);
    assert.ok(stderr.includes("Invalid --format"));
  });

  it("lints a bad pack offline", async () => {
    const { stdout } = await run(["lint", "--questions", join(__dirname, "fixtures", "bad-pack.json")]);
    assert.ok(stdout.includes('"ok": false'));
  });
});
