import type { Phase } from "../domain/types.ts";
import type { AgentEvent, PhaseResult, PhaseContext } from "./events.ts";

/**
 * Runs a single bounded workflow phase. Yields streamed AgentEvents as the agent
 * works, and returns the final PhaseResult when the phase completes.
 */
export interface AgentRunner {
  run(phase: Phase, context: PhaseContext): AsyncGenerator<AgentEvent, PhaseResult>;
}
