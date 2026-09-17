#!/usr/bin/env node
// Deterministic offline stub for the TypeSafe System One API.
//
//   node tools/stub-server.mjs [--port 8787]
//   TYPESAFE_BASE_URL=http://127.0.0.1:8787 TYPESAFE_API_KEY=stub jev ask --pack verify --state-file claim.json --state-format json
//
// Purpose: wire a pipeline end to end without a key and without spending a call.
// The answers are deterministic and deliberately NON-COMMITTAL — the last choice
// option, a mid-scale score, noul 0.5 — so a stub run cannot look like an approval.
// Never treat stub output as a judgment; it exists to test plumbing.

import { createHash } from "node:crypto";
import { createServer } from "node:http";

const portFlag = process.argv.indexOf("--port");
const port = portFlag === -1 ? 8787 : Number(process.argv[portFlag + 1]);
if (!Number.isInteger(port) || port < 1 || port > 65535) {
  process.stderr.write(`Invalid --port: ${process.argv[portFlag + 1]}\n`);
  process.exit(1);
}

function digest(...parts) {
  return createHash("sha256").update(parts.join("\u0000")).digest("hex");
}

function answerFor(id, question, state) {
  const seed = digest(id, JSON.stringify(state ?? null), JSON.stringify(question));
  const byte = parseInt(seed.slice(0, 2), 16);
  if (question.type === "choice") {
    const names = Object.keys(question.criteria ?? {});
    // Last option: for the bundled packs that is the non-accepting label, so a
    // stub run rehearses the "policy says no" path rather than a fake approval.
    const choice = names[names.length - 1] ?? "unknown";
    const others = names.filter((name) => name !== choice);
    const probabilities = Object.fromEntries([
      ...others.map((name) => [name, 0.4 / Math.max(1, others.length)]),
      [choice, 0.6],
    ]);
    return { type: "choice", choice, probabilities, confidence: probabilities[choice] };
  }
  if (question.type === "score") {
    const levels = Array.isArray(question.criteria) ? question.criteria.length : 3;
    const score = (levels - 1) / 2;
    const probabilities = Object.fromEntries(Array.from({ length: levels }, (_, i) => [String(i), i === Math.round(score) ? 0.6 : 0.2]));
    return { type: "score", score, legend: Object.fromEntries(levels ? Array.from({ length: levels }, (_, i) => [String(i), question.criteria[i]]) : []), probabilities, confidence: 0.6 };
  }
  // noul: 0.5 is the point of maximum ignorance, which no threshold accepts.
  return { type: "noul", noul: 0.5 + (byte % 2) / 1000 };
}

const MODELS = [
  { name: "stub-latest", description: "Stub model: deterministic, non-committal answers", release_date: "2026-01-01T00:00:00Z" },
  { name: "stub-1.0.0", description: "Stub model, versioned", release_date: "2026-01-01T00:00:00Z" },
];

const server = createServer((req, res) => {
  const url = new URL(req.url ?? "/", `http://${req.headers.host ?? "127.0.0.1"}`);
  const send = (status, body) => {
    res.writeHead(status, { "content-type": "application/json" });
    res.end(JSON.stringify(body));
  };

  if (req.method === "GET" && url.pathname === "/v1/models") {
    return send(200, { models: MODELS });
  }

  if (req.method === "POST" && url.pathname === "/v1/systemone") {
    let raw = "";
    req.on("data", (chunk) => {
      raw += chunk;
    });
    req.on("end", () => {
      let body;
      try {
        body = JSON.parse(raw);
      } catch {
        return send(400, { error: { message: "invalid JSON body" } });
      }
      const questions = body?.questions ?? {};
      const answers = Object.fromEntries(Object.entries(questions).map(([id, question]) => [id, answerFor(id, question, body?.state)]));
      const input_tokens = Math.max(1, Math.ceil((raw.length + JSON.stringify(body?.state ?? "").length) / 4));
      // The response never claims the requested model: a record from a stub must
      // be identifiable as one by model_resolved alone.
      const model = `stub:${typeof body?.model === "string" ? body.model : "default"}`;
      process.stderr.write(`[stub] ${Object.keys(questions).length} question(s) -> ${input_tokens} input tokens\n`);
      send(200, { model, answers, usage: { input_tokens, output_tokens: Object.keys(questions).length * 8 } });
    });
    return;
  }

  send(404, { error: { message: `no stub route for ${req.method} ${url.pathname}` } });
});

server.listen(port, "127.0.0.1", () => {
  process.stderr.write(`[stub] listening on http://127.0.0.1:${port} — answers are deterministic and non-committal; never treat them as judgments\n`);
});

for (const signal of ["SIGINT", "SIGTERM"]) {
  process.on(signal, () => server.close(() => process.exit(0)));
}
