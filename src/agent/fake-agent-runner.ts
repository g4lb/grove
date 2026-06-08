import type { AgentRunner } from "./agent-runner.ts";
import type { AgentEvent, SessionContext, SessionResult } from "./events.ts";

export interface FakeSession {
  events?: AgentEvent[];
  result: SessionResult;
}

/** A single-session fake: records contexts, yields scripted events, returns a scripted result. */
export class FakeAgentRunner implements AgentRunner {
  contexts: SessionContext[] = [];
  constructor(private session: FakeSession) {}
  async *run(ctx: SessionContext): AsyncGenerator<AgentEvent, SessionResult> {
    this.contexts.push(ctx);
    for (const e of this.session.events ?? []) yield e;
    return this.session.result;
  }
}

export function ok(summary = "done", events: AgentEvent[] = []): FakeSession {
  return { events, result: { success: true, summary, costUsd: 0, turns: 0, sessionId: "s" } };
}
export function fail(summary = "failed", events: AgentEvent[] = []): FakeSession {
  return { events, result: { success: false, summary, costUsd: 0, turns: 0, sessionId: "s" } };
}
