import type { JevClient } from "../api/client.js";
import type { GlobalOptions } from "../cli/parseArgs.js";
import { coerceQuestions } from "../cli/lint.js";
import { readJsonFile, readJsonlFile } from "../utils/io.js";
import { parseLimit } from "./batch.js";
import { EVAL_HELP } from "../cli/help.js";

interface EvalRow {
  state: unknown;
  labels: Record<string, number | string>;
}

interface PerQuestion {
  qid: string;
  type: string;
  n: number;
  accuracy: number;
  brier: number;
  ece: number;
  sweep: Array<{ threshold: number; metric: string; value: number }>;
  suggestion: string;
}

function brierMean(pairs: Array<{ p: number; y: number }>): number {
  if (pairs.length === 0) return NaN;
  return pairs.reduce((s, r) => s + (r.p - r.y) ** 2, 0) / pairs.length;
}

// 10-bin expected calibration error over P(yes/outcome).
function expectedCalibrationError(pairs: Array<{ p: number; y: number }>, bins = 10): number {
  if (pairs.length === 0) return NaN;
  let ece = 0;
  for (let b = 0; b < bins; b++) {
    const lo = b / bins;
    const hi = (b + 1) / bins;
    const inBin = pairs.filter((r) => r.p >= lo && (r.p < hi || (b === bins - 1 && r.p <= hi)));
    if (inBin.length === 0) continue;
    const meanP = inBin.reduce((s, r) => s + r.p, 0) / inBin.length;
    const meanY = inBin.reduce((s, r) => s + r.y, 0) / inBin.length;
    ece += (inBin.length / pairs.length) * Math.abs(meanP - meanY);
  }
  return ece;
}

export async function handleEval(global: GlobalOptions, client: JevClient): Promise<void> {
  if (!global.questions || !global.dataset) {
    process.stdout.write(EVAL_HELP);
    return;
  }
  const questions = coerceQuestions(readJsonFile(global.questions));
  const rows = readJsonlFile(global.dataset, parseLimit(global));
  if (rows.length === 0) throw new Error(`Dataset is empty: ${global.dataset}.`);

  // Per-question accumulators: predicted P(target) and 0/1 hit.
  const acc: Record<string, Array<{ p: number; y: number }>> = {};
  for (const [i, row] of rows.entries()) {
    const rec = row as Record<string, unknown>;
    if (rec.state === undefined || typeof rec.labels !== "object" || rec.labels === null) {
      throw new Error(`Dataset line ${i + 1}: expected {"state": ..., "labels": {qid: label}}.`);
    }
    const labels = rec.labels as Record<string, unknown>;
    const response = await client.systemOne(rec.state, questions, global.model);
    for (const [qid, ans] of Object.entries(response.answers)) {
      const label = labels[qid];
      if (label === undefined) continue;
      const list = acc[qid] ?? [];
      if (ans.type === "noul" && (label === 0 || label === 1)) {
        list.push({ p: ans.noul, y: label as number });
      } else if (ans.type === "choice" && typeof label === "string") {
        list.push({ p: ans.probabilities[label] ?? 0, y: ans.choice === label ? 1 : 0 });
      } else if (ans.type === "score" && typeof label === "number") {
        list.push({ p: ans.probabilities[String(label)] ?? 0, y: Math.round(ans.score) === label ? 1 : 0 });
      }
      acc[qid] = list;
    }
  }

  const report: { model: string; rows: number; questions: PerQuestion[] } = {
    model: global.model,
    rows: rows.length,
    questions: [],
  };

  for (const [qid, pairs] of Object.entries(acc)) {
    const q = questions[qid];
    const accuracy = pairs.length === 0 ? NaN : pairs.filter((r) => (r.p >= 0.5 ? 1 : 0) === r.y).length / pairs.length;
    const brier = brierMean(pairs);
    const ece = expectedCalibrationError(pairs);
    // Threshold sweep: fraction flagged "act" at each cutoff — pick from your cost of review.
    const sweep = [0.5, 0.6, 0.7, 0.8, 0.9].map((t) => ({
      threshold: t,
      metric: "flagged_act_rate",
      value: pairs.length === 0 ? NaN : pairs.filter((r) => r.p >= t).length / pairs.length,
    }));
    report.questions.push({
      qid,
      type: q.type,
      n: pairs.length,
      accuracy,
      brier,
      ece,
      sweep,
      suggestion: q.type === "noul"
        ? "Set --yes-at where flagged precision covers your cost of a false yes on held-out data."
        : "Set --act-above where reviewer load balances the cost of acting on a wrong answer.",
    });
  }

  process.stdout.write(JSON.stringify(report, null, 2) + "\n");
}
