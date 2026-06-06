import type { Phase } from "../domain/types.ts";

/** The full ordered phase sequence. */
export const PHASES: readonly Phase[] = ["brainstorm", "plan", "execute", "review", "finish"];

/** Phases after which the engine pauses at a gate (waiting_confirm). */
const GATE_AFTER: ReadonlySet<Phase> = new Set<Phase>(["brainstorm", "plan", "review"]);

export function isGateAfter(phase: Phase): boolean {
  return GATE_AFTER.has(phase);
}

/** The phase that follows `phase`, or null if `phase` is the last one. */
export function nextPhase(phase: Phase): Phase | null {
  const i = PHASES.indexOf(phase);
  if (i < 0 || i === PHASES.length - 1) return null;
  return PHASES[i + 1]!;
}

export function isTerminalPhase(phase: Phase): boolean {
  return phase === PHASES[PHASES.length - 1]!;
}
