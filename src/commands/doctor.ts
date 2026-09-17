import { join } from "node:path";
import type { ClientOpts } from "../api/client.js";
import { createClient } from "../api/client.js";
import type { GlobalOptions } from "../cli/parseArgs.js";
import type { OutputFormat } from "../cli/formatters.js";
import { formatDoctor } from "../cli/formatters.js";
import type { DoctorCheck } from "../cli/formatters.js";
import { cliVersion, packageManifest, packageRoot } from "../utils/package.js";
import { listPacks } from "./packs.js";

export type { DoctorCheck };

// Local checks first: they answer "is this wired correctly?" without spending an API
// call, which matters while access is gated. --live adds auth, model, latency, and cost.
export async function handleDoctor(global: GlobalOptions, opts: ClientOpts | undefined, format: OutputFormat): Promise<void> {
  const checks: DoctorCheck[] = [];

  const manifest = packageManifest();
  const requiredMajor = Number((manifest.engines?.node ?? "22").replace(/[^0-9]/g, "").slice(0, 2)) || 22;
  const nodeMajor = Number(process.versions.node.split(".")[0]);
  checks.push({
    name: "node",
    status: nodeMajor >= requiredMajor ? "ok" : "fail",
    detail: `node ${process.versions.node} (package requires >=${requiredMajor})`,
  });

  checks.push({ name: "cli_version", status: "ok", detail: cliVersion() });
  checks.push({ name: "package_root", status: "ok", detail: packageRoot() });

  const apiKeySource = global.apiKey !== undefined ? "--api-key flag" : process.env.TYPESAFE_API_KEY ? "TYPESAFE_API_KEY" : null;
  // Presence only; the key value is never read into output.
  checks.push({
    name: "api_key",
    status: apiKeySource ? "ok" : "warn",
    detail: apiKeySource ? `present (from ${apiKeySource})` : "missing — set TYPESAFE_API_KEY or pass --api-key (offline commands still work)",
  });

  const baseUrl = global.baseUrl ?? process.env.TYPESAFE_BASE_URL ?? "https://api.typesafe.ai";
  checks.push({ name: "base_url", status: "ok", detail: baseUrl });

  const model = global.model ?? process.env.TYPESAFE_DEFAULT_MODEL ?? "jev-latest";
  checks.push({
    name: "model",
    status: "ok",
    detail: `${model}${model === "jev-latest" || model === "jev-preview" ? " (alias — pin a versioned ID when thresholds are tuned)" : ""}`,
  });

  const packs = listPacks();
  checks.push({
    name: "packs",
    status: packs.length > 0 ? "ok" : "fail",
    detail:
      packs.length > 0
        ? `${packs.length} pack(s): ${packs.map((p) => `${p.name}@${p.pack_version}`).join(", ")}`
        : `none found in ${join(packageRoot(), "packs")}`,
  });

  if (global.live) {
    if (!opts) {
      checks.push({ name: "live_auth", status: "fail", detail: "--live needs an API key" });
    } else {
      const client = createClient(opts);
      try {
        const started = Date.now();
        const models = await client.models.list();
        checks.push({
          name: "live_models",
          status: "ok",
          detail: `${models.length} model(s) in ${Date.now() - started} ms: ${models.map((m) => m.name).join(", ") || "none"}`,
        });
      } catch (err) {
        checks.push({ name: "live_models", status: "fail", detail: err instanceof Error ? err.message : String(err) });
      }
      try {
        const started = Date.now();
        const response = await client.systemOne({
          state: "The deployment finished without errors.",
          questions: { ok: { type: "noul", instructions: "Does this sentence describe a successful outcome?" } },
        });
        const latency = Date.now() - started;
        checks.push({
          name: "live_probe",
          status: "ok",
          detail: `model ${response.model}, noul=${response.answers.ok.noul.toFixed(3)}, ${latency} ms, ${response.usage.input_tokens} input tokens (~$${(response.usage.input_tokens * 42 / 1e9).toFixed(8)})`,
        });
      } catch (err) {
        checks.push({ name: "live_probe", status: "fail", detail: err instanceof Error ? err.message : String(err) });
      }
    }
  } else {
    checks.push({ name: "live_checks", status: "warn", detail: "skipped — pass --live to check authentication, models, latency, and cost" });
  }

  process.stdout.write(formatDoctor(cliVersion(), checks, format) + "\n");
  if (checks.some((check) => check.status === "fail")) process.exitCode = 1;
}
