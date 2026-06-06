import type { Task, TaskKind } from "../domain/types.ts";
import type { AgentEvent } from "../agent/events.ts";
import type { StartTaskInput, GateDecision } from "../engine/task-engine.ts";
import type { Router } from "../engine/router.ts";

/** The engine surface the controller needs (the real TaskEngine satisfies it). */
export interface ControllerEngine {
  startTask(input: StartTaskInput, onEvent?: (e: AgentEvent) => void): Promise<Task>;
  confirmGate(taskId: string, decision: GateDecision, onEvent?: (e: AgentEvent) => void): Promise<Task>;
}

export type RunState = "idle" | "running" | "waiting_confirm" | "blocked" | "done" | "stopped";

export interface ControllerView {
  state: RunState;
  task: Task | null;
  feed: string[];
  message: string;
}

/** Holds TUI run state and drives the engine. No Ink — fully unit-testable. */
export class TaskRunController {
  /** Called whenever the view changes; the Ink layer wires this to a re-render. */
  onChange: () => void = () => {};

  private view: ControllerView = { state: "idle", task: null, feed: [], message: "" };

  constructor(
    private engine: ControllerEngine,
    private router: Router,
    private repoPath: string,
  ) {}

  snapshot(): ControllerView {
    return { ...this.view, feed: [...this.view.feed] };
  }

  private push(line: string): void {
    this.view.feed.push(line);
    this.onChange();
  }

  private set(partial: Partial<ControllerView>): void {
    this.view = { ...this.view, ...partial };
    this.onChange();
  }

  private onEvent = (event: AgentEvent): void => {
    if (event.type === "tool_use") this.push(`· ${event.tool}`);
    else if (event.type === "notice") this.push(`· ${event.message}`);
  };

  async start(prose: string): Promise<void> {
    const routed = await this.router.classify(prose);
    this.push(`detected: ${routed.kind}`);
    const kind: TaskKind = routed.kind === "debug" ? "issue" : "task";
    if (routed.kind === "debug") this.push("debugging is coming in v1.1 — running as a task");
    this.set({ state: "running" });
    const task = await this.engine.startTask({ title: prose, repoPath: this.repoPath, kind }, this.onEvent);
    this.applyTask(task);
  }

  async decide(decision: GateDecision): Promise<void> {
    if (!this.view.task) return;
    this.set({ state: "running" });
    const task = await this.engine.confirmGate(this.view.task.id, decision, this.onEvent);
    this.applyTask(task);
  }

  private applyTask(task: Task): void {
    let message = "";
    if (task.status === "waiting_confirm") message = `gate — ${task.currentPhase} done`;
    else if (task.status === "done") message = "task complete";
    else if (task.status === "blocked") message = `blocked at ${task.currentPhase}`;
    else if (task.status === "stopped") message = `stopped at ${task.currentPhase}`;
    this.set({ state: task.status, task, message });
  }
}
