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
    const { stderr } = await run([]);
    assert.ok(stderr.includes("jev-cli"));
  });

  it("shows version with --version", async () => {
    const { stdout } = await run(["--version"]);
    assert.match(stdout.trim(), /^\d+\.\d+\.\d+/);
  });

  it("errors when ask has no request source", async () => {
    const { stderr } = await run(["ask", "--state", "ticket"]);
    assert.ok(stderr.includes("Missing questions"));
  });

  it("documents batch contract in help", async () => {
    const { stdout } = await run(["batch", "--help"]);
    assert.ok(stdout.includes("jev batch"));
    assert.ok(stdout.includes("input order preserved"));
  });

  it("errors on unknown command", async () => {
    const { stderr } = await run(["foobar"]);
    assert.ok(stderr.includes("Unknown command"));
  });

  it("rejects misspelled flags loudly", async () => {
    const { stderr } = await run(["models", "--modle", "x"]);
    assert.ok(stderr.toLowerCase().includes("unknown"));
  });

  it("errors without API key on live commands", async () => {
    const { stderr } = await run(["models"], { TYPESAFE_API_KEY: "" });
    assert.ok(stderr.includes("Missing API key") || stderr.includes("Error"));
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
