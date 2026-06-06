import type { Phase } from "../domain/types.ts";

/** A streamed event emitted while an agent phase runs. */
export type AgentEvent =
  | { type: "token"; text: string }
  | { type: "tool_use"; tool: string; input: unknown }
  | { type: "notice"; message: string };

/** The terminal outcome of a phase run. */
export interface PhaseResult {
  success: boolean;
  summary: string;
  /** Absolute path to the phase's gate artifact (verified to exist when success is true), or null if the phase produces no file (e.g. execute). */
  artifactPath: string | null;
  costUsd: number;
  /** The SDK session id, for chaining context into the next phase. */
  sessionId: string | null;
}

/** Everything a phase run needs. `worktreePath` is the agent's cwd. */
export interface PhaseContext {
  taskId: string;
  title: string;
  description?: string;
  worktreePath: string;
  model: string;
  /** Artifacts produced by earlier phases, passed forward as context. */
  priorArtifacts: Array<{ phase: Phase; path: string }>;
  /** Reviewer feedback for a re-run of this phase ("request changes"); absent on a first run. */
  feedback?: string;
}
