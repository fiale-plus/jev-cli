import type { AnnotatedResponse, Answer, GateAction, NoulVerdict } from "../api/types.js";

export interface Thresholds {
  yesAt: number;
  noAt: number;
  actAbove: number;
  reviewAbove: number;
}

export const DEFAULT_THRESHOLDS: Thresholds = {
  yesAt: 0.7,
  noAt: 0.3,
  actAbove: 0.8,
  reviewAbove: 0.5,
};

export function noulVerdict(noul: number, t: Pick<Thresholds, "yesAt" | "noAt">): NoulVerdict {
  if (noul >= t.yesAt) return "yes";
  if (noul <= t.noAt) return "no";
  return "uncertain";
}

export function gateAction(confidence: number, t: Pick<Thresholds, "actAbove" | "reviewAbove">): GateAction {
  if (confidence >= t.actAbove) return "act";
  if (confidence >= t.reviewAbove) return "review";
  return "abstain";
}

export function annotateResponse(
  response: { model: string; answers: Record<string, Answer>; usage: { input_tokens: number; output_tokens: number } },
  t: Thresholds,
): AnnotatedResponse {
  const answers: AnnotatedResponse["answers"] = {};
  for (const [id, ans] of Object.entries(response.answers)) {
    if (ans.type === "noul") answers[id] = { ...ans, verdict: noulVerdict(ans.noul, t) };
    else answers[id] = { ...ans, action: gateAction(ans.confidence, t) };
  }
  return { model: response.model, answers, usage: response.usage };
}

// Exit codes for shell gating (documented in help):
//   0 act / yes / no — usable answer
//   1 usage or API error
//   2 review or uncertain — needs a human / second opinion
//   3 abstain — model declined via low confidence
export function exitCodeFor(annotated: AnnotatedResponse): number {
  let code = 0;
  for (const ans of Object.values(annotated.answers)) {
    if (ans.type === "noul") {
      if (ans.verdict === "uncertain") code = Math.max(code, 2);
    } else if (ans.action === "review") code = Math.max(code, 2);
    else if (ans.action === "abstain") code = Math.max(code, 3);
  }
  return code;
}
