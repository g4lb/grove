export type RouterKind = "task" | "debug";

export interface RouterResult {
  kind: RouterKind;
  confidence: number;
  reasoning: string;
}

/** Classifies a free-text request into a workflow kind. Async so an LLM adapter can drop in later. */
export interface Router {
  classify(prose: string): Promise<RouterResult>;
}

// Signal words that indicate an investigation/fix (debug) rather than a build (task).
const DEBUG_SIGNALS = [
  "fix",
  "bug",
  "broken",
  "crash",
  "error",
  "failing",
  "fails",
  "regression",
  "debug",
  "exception",
  "stack trace",
  "not working",
  "doesn't work",
];

/** A cheap, instant, dependency-free router. The LLM-backed adapter arrives with the v1.1 debug workflow. */
export class HeuristicRouter implements Router {
  async classify(prose: string): Promise<RouterResult> {
    const lower = prose.toLowerCase();
    const hits = DEBUG_SIGNALS.filter((s) => lower.includes(s));
    if (hits.length > 0) {
      return {
        kind: "debug",
        confidence: Math.min(1, 0.5 + 0.1 * hits.length),
        reasoning: `matched debug signal(s): ${hits.join(", ")}`,
      };
    }
    return { kind: "task", confidence: 0.6, reasoning: "no debug signals — treating as a build task" };
  }
}
