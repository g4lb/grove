import type { GateDecision } from "../engine/task-engine.ts";

export type ReadLine = (prompt: string) => Promise<string>;

/** Prompt for a gate decision. `[a]pprove / [r]equest changes / [s]top`. Defaults to stop on anything else. */
export async function stdinGateDecider(readLine: ReadLine): Promise<GateDecision> {
  const ans = (await readLine("[a]pprove / [r]equest changes / [s]top: ")).trim().toLowerCase();
  if (ans === "a" || ans === "approve") return { kind: "approve" };
  if (ans === "r" || ans === "request" || ans === "request changes") {
    const feedback = (await readLine("describe the changes: ")).trim();
    return { kind: "rerun", feedback: feedback.length > 0 ? feedback : undefined };
  }
  // "s"/"stop"/empty/unknown → stop (safe default; never silently approves).
  return { kind: "stop" };
}
