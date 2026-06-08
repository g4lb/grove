import type { AgentEvent, SessionContext, SessionResult } from "./events.ts";

/**
 * Runs a single autonomous agent session for a task. Yields streamed AgentEvents
 * as the agent works, and returns the final SessionResult when the session ends.
 */
export interface AgentRunner {
  run(ctx: SessionContext): AsyncGenerator<AgentEvent, SessionResult>;
}
