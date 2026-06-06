import type { Phase } from "../domain/types.ts";
import type { AgentRunner } from "./agent-runner.ts";
import type { AgentEvent, PhaseContext, PhaseResult } from "./events.ts";

export interface PhaseScript {
  events: AgentEvent[];
  result: PhaseResult;
}

/** Deterministic AgentRunner driven by a per-phase script. For tests and the engine. */
export class FakeAgentRunner implements AgentRunner {
  calls: Array<{ phase: Phase; taskId: string }> = [];

  constructor(private scripts: Partial<Record<Phase, PhaseScript>>) {}

  async *run(phase: Phase, context: PhaseContext): AsyncGenerator<AgentEvent, PhaseResult> {
    this.calls.push({ phase, taskId: context.taskId });
    const script = this.scripts[phase];
    if (!script) throw new Error(`no script for phase: ${phase}`);
    for (const event of script.events) {
      yield event;
    }
    return script.result;
  }
}
