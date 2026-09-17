import type { Questions, SystemOneResult } from "@typesafe-ai/sdk";
import { estimateCostUsd } from "../api/client.js";

export type OutputFormat = "json" | "table";

function formatNumber(value: unknown): string {
  return typeof value === "number" && Number.isFinite(value) ? value.toFixed(3) : String(value);
}

export function formatOutput(response: SystemOneResult<Questions>, format: OutputFormat): string {
  if (format === "json") {
    const enriched = {
      ...response,
      cost: {
        input_tokens: response.usage.input_tokens,
        output_tokens: response.usage.output_tokens,
        estimated_usd: estimateCostUsd(response.usage.input_tokens),
        note: "input billed, output free",
      },
    };
    return JSON.stringify(enriched, null, 2);
  }
  return formatTable(response);
}
function formatTable(response: SystemOneResult<Questions>): string {
  const lines: string[] = [`model: ${response.model}`];
  const answers = response.answers as unknown as Record<string, { type: string } & Record<string, unknown>>;
  for (const [id, ans] of Object.entries(answers)) {
    if (ans.type === "noul") {
      lines.push(`${id}: noul=${formatNumber(ans.noul)}`);
    } else if (ans.type === "choice") {
      lines.push(`${id}: choice=${String(ans.choice)} confidence=${formatNumber(ans.confidence)}`);
      const probs = ans.probabilities as Record<string, unknown> | undefined;
      for (const [opt, p] of Object.entries(probs ?? {})) {
        lines.push(`  ${opt}: ${formatNumber(p)}`);
      }
    } else if (ans.type === "score") {
      lines.push(`${id}: score=${formatNumber(ans.score)} confidence=${formatNumber(ans.confidence)}`);
      const probs = ans.probabilities as Record<string, unknown> | undefined;
      for (const [level, p] of Object.entries(probs ?? {})) {
        lines.push(`  [${level}]: ${formatNumber(p)}`);
      }
    } else {
      lines.push(`${id}: ${JSON.stringify(ans)}`);
    }
  }
  lines.push(
    `usage: ${response.usage.input_tokens} in / ${response.usage.output_tokens} out (~$${estimateCostUsd(response.usage.input_tokens).toFixed(6)})`,
  );
  return lines.join("\n");
}
