#!/usr/bin/env node
// Score a pack's policy against labeled records.
//
//   node tools/evaluate.mjs --records records.jsonl [--pack verify] [--answer relation] [--json]
//   node tools/evaluate.mjs --records out/ --labels examples/verify/labels.jsonl [--pack verify]
//
// Two layouts, both with ground truth per case:
//   JSONL: one line per case, {"label": "supports", "record": {...}} (or "response")
//   DIR:   one record per file, labeled by --labels <jsonl> where each line is
//          {"id": "<file name without .json>", "label": "supports"}
//
// What it answers: on YOUR data, where does the policy land? Accuracy of the
// model's chosen label, the outcome mix (accept/review/deny/abstain), and the
// empirical acceptance rate of each probability bucket — the number that tells
// you whether accept_at is set anywhere near the right place.
//
// Requires a build: npm run build && node tools/evaluate.mjs ...

import { readFileSync, readdirSync, statSync } from "node:fs";
import { basename, extname, join } from "node:path";
import { evaluatePolicy, extractResponse, loadPack } from "../dist/index.js";

function arg(name, fallback = undefined) {
  const i = process.argv.indexOf(`--${name}`);
  return i === -1 ? fallback : process.argv[i + 1];
}

const recordsArg = arg("records", "-");
const labelsPath = arg("labels");
const packName = arg("pack", "verify");
const json = process.argv.includes("--json");
const input = recordsArg === "-" ? 0 : recordsArg;

const loaded = loadPack(packName);
const firstChoiceRule = loaded.pack.policy.rules.find((rule) => rule.type === "choice");
const answerId = arg("answer", firstChoiceRule?.answer ?? loaded.pack.policy.rules[0].answer);
const accepted = firstChoiceRule?.accept ?? [];

function readLines(source) {
  return readFileSync(source, "utf8")
    .split("\n")
    .filter((line) => line.trim().length > 0);
}

// Ground truth keyed by case id, for the directory layout.
function loadLabels() {
  if (labelsPath === undefined) return null;
  const map = new Map();
  for (const line of readLines(labelsPath)) {
    const parsed = JSON.parse(line);
    if (parsed.id === undefined || parsed.label === undefined) {
      throw new Error(`Invalid ${labelsPath}: each line needs {"id", "label"}.`);
    }
    map.set(String(parsed.id), parsed.label);
  }
  return map;
}

// Each case is a response plus the label it should have produced.
function loadCases() {
  const cases = [];
  let skipped = 0;

  if (statSync(input === 0 ? "/dev/stdin" : input, { throwIfNoEntry: false })?.isDirectory()) {
    const labels = loadLabels();
    if (!labels) throw new Error("--records <dir> needs --labels <jsonl> to attach ground truth.");
    for (const file of readdirSync(input).filter((name) => extname(name) === ".json").sort()) {
      const id = basename(file, ".json");
      const label = labels.get(id);
      if (label === undefined) {
        process.stderr.write(`skipping ${file}: no label for id "${id}"\n`);
        skipped++;
        continue;
      }
      try {
        cases.push({ id, label, parsed: JSON.parse(readFileSync(join(input, file), "utf8")) });
      } catch (err) {
        process.stderr.write(`skipping ${file}: ${err instanceof Error ? err.message : String(err)}\n`);
        skipped++;
      }
    }
    return { cases, skipped };
  }

  readLines(input).forEach((line, index) => {
    let parsed;
    try {
      parsed = JSON.parse(line);
    } catch {
      process.stderr.write(`skipping line ${index + 1}: invalid JSON\n`);
      skipped++;
      return;
    }
    if (parsed.label === undefined) {
      process.stderr.write(`skipping line ${index + 1}: no "label"\n`);
      skipped++;
      return;
    }
    cases.push({ id: String(parsed.id ?? index + 1), label: parsed.label, parsed });
  });
  return { cases, skipped };
}

const { cases, skipped } = loadCases();

const rows = [];
for (const item of cases) {
  let response;
  try {
    response = extractResponse(item.parsed.record ?? item.parsed.response ?? item.parsed);
  } catch (err) {
    process.stderr.write(`skipping ${item.id}: ${err instanceof Error ? err.message : String(err)}\n`);
    continue;
  }
  const answer = response.answers?.[answerId];
  const result = evaluatePolicy(loaded.pack.policy, response);
  rows.push({
    label: item.label,
    chosen: answer?.choice ?? (answer?.type === "noul" ? (answer.noul >= 0.5 ? "yes" : "no") : answer?.score),
    probability: Number.isFinite(answer?.probabilities?.[answer?.choice]) ? answer.probabilities[answer.choice] : (answer?.confidence ?? answer?.noul),
    decision: result.decision,
    shouldAccept: accepted.length > 0 ? accepted.includes(item.label) : undefined,
  });
}

if (rows.length === 0) {
  process.stderr.write("no usable records\n");
  process.exit(1);
}

const correct = rows.filter((row) => row.chosen === row.label).length;
const decisions = { accept: 0, review: 0, deny: 0, abstain: 0 };
const confusion = { true_accept: 0, false_accept: 0, missed_accept: 0, correct_deny: 0, other: 0 };
const buckets = new Map();

for (const row of rows) {
  decisions[row.decision]++;
  if (row.shouldAccept === undefined) continue;
  if (row.decision === "accept" && row.shouldAccept) confusion.true_accept++;
  else if (row.decision === "accept" && !row.shouldAccept) confusion.false_accept++;
  else if (row.decision !== "accept" && row.shouldAccept) confusion.missed_accept++;
  else if (row.decision !== "accept" && !row.shouldAccept) confusion.correct_deny++;
  else confusion.other++;

  if (Number.isFinite(row.probability)) {
    const bucket = Math.min(0.9, Math.floor(row.probability * 10) / 10);
    const entry = buckets.get(bucket) ?? { n: 0, right: 0 };
    entry.n++;
    if (row.shouldAccept) entry.right++;
    buckets.set(bucket, entry);
  }
}

const accuracy = correct / rows.length;
const summary = {
  pack: loaded.pack.name,
  pack_hash: loaded.hash,
  policy: loaded.pack.policy.name,
  answer: answerId,
  accepted_labels: accepted,
  records: rows.length,
  skipped,
  label_accuracy: Number(accuracy.toFixed(4)),
  decisions,
  confusion,
  calibration: [...buckets.entries()]
    .sort(([a], [b]) => a - b)
    .map(([bucket, v]) => ({ probability_bucket: Number(bucket.toFixed(2)), n: v.n, accepted_rate: Number((v.right / v.n).toFixed(3)) })),
};

if (json) {
  process.stdout.write(JSON.stringify(summary, null, 2) + "\n");
} else {
  process.stdout.write(`pack ${summary.pack} ${summary.pack_hash.slice(0, 19)}\n`);
  process.stdout.write(`policy ${summary.policy}, answer "${answerId}", accepted labels: ${accepted.join(", ") || "n/a"}\n`);
  process.stdout.write(`records ${summary.records} (skipped ${summary.skipped})\n`);
  process.stdout.write(`label accuracy ${(accuracy * 100).toFixed(1)}%  [${correct}/${rows.length}]\n\n`);
  process.stdout.write("decisions: " + Object.entries(decisions).map(([k, v]) => `${k} ${v}`).join("  ") + "\n");
  process.stdout.write(`confusion: true_accept ${confusion.true_accept}  false_accept ${confusion.false_accept}  missed_accept ${confusion.missed_accept}  correct_deny ${confusion.correct_deny}\n\n`);
  process.stdout.write("probability bucket -> share of labels the policy accepts\n");
  for (const row of summary.calibration) {
    const bar = "#".repeat(Math.round(row.accepted_rate * 40));
    process.stdout.write(`  ${row.probability_bucket.toFixed(1)}  n=${String(row.n).padStart(4)}  ${(row.accepted_rate * 100).toFixed(0).padStart(3)}% ${bar}\n`);
  }
  process.stdout.write("\nA well-placed accept_at sits where the accepted rate crosses ~0.9; a flat column means the score does not separate your labels on this data.\n");
}
