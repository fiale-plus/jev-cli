import type { AnnotatedResponse } from "../api/types.js";
import { estimateCostUsd } from "../api/client.js";

export type OutputFormat = "json" | "table";

export function formatOutput(response: AnnotatedResponse, format: OutputFormat): string {
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

function formatTable(response: AnnotatedResponse): string {
  const lines: string[] = [`model: ${response.model}`];
  for (const [id, ans] of Object.entries(response.answers)) {
    if (ans.type === "noul") {
      lines.push(`${id}: noul=${ans.noul.toFixed(3)} verdict=${ans.verdict}`);
    } else if (ans.type === "choice") {
      lines.push(`${id}: choice=${ans.choice} confidence=${ans.confidence.toFixed(3)} action=${ans.action}`);
      for (const [opt, p] of Object.entries(ans.probabilities)) {
        lines.push(`  ${opt}: ${Number(p).toFixed(3)}`);
      }
    } else {
      lines.push(`${id}: score=${ans.score.toFixed(3)} confidence=${ans.confidence.toFixed(3)} action=${ans.action}`);
      for (const [level, p] of Object.entries(ans.probabilities)) {
        lines.push(`  [${level}] ${ans.legend[level] ?? ""}: ${Number(p).toFixed(3)}`);
      }
    }
  }
  lines.push(
    `usage: ${response.usage.input_tokens} in / ${response.usage.output_tokens} out (~$${estimateCostUsd(response.usage.input_tokens).toFixed(6)})`,
  );
  return lines.join("\n");
}
