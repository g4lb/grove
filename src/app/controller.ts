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
  mode: "prompt" | "list";
  state: RunState;
  task: Task | null;
  feed: string[];
  message: string;
  tasks: Task[];
  selected: number;
}

/** Holds TUI run state and drives the engine. No Ink — fully unit-testable. */
export class TaskRunController {
  /** Called whenever the view changes; the Ink layer wires this to a re-render. */
  onChange: () => void = () => {};

  /** Returns all tasks for the list view; wired by the launcher to the engine. */
  private lister: () => Task[] = () => [];
  setLister(lister: () => Task[]): void {
    this.lister = lister;
  }

  private view: ControllerView = { mode: "prompt", state: "idle", task: null, feed: [], message: "", tasks: [], selected: 0 };

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
    if (this.view.state === "running") return;
    this.set({ state: "running" });
    try {
      const routed = await this.router.classify(prose);
      this.push(`detected: ${routed.kind}`);
      const kind: TaskKind = routed.kind === "debug" ? "issue" : "task";
      if (routed.kind === "debug") this.push("debugging is coming in v1.1 — running as a task");
      const task = await this.engine.startTask({ title: prose, repoPath: this.repoPath, kind }, this.onEvent);
      this.applyTask(task);
    } catch (err) {
      this.set({ state: "blocked", message: `failed: ${err instanceof Error ? err.message : String(err)}` });
    }
  }

  async decide(decision: GateDecision): Promise<void> {
    if (!this.view.task) return;
    if (this.view.state === "running") return;
    try {
      this.set({ state: "running" });
      const task = await this.engine.confirmGate(this.view.task.id, decision, this.onEvent);
      this.applyTask(task);
    } catch (err) {
      this.set({ state: "blocked", message: `failed: ${err instanceof Error ? err.message : String(err)}` });
    }
  }

  /** Route a prompt submission: `/list`, `/open <id>`, else run as a task. */
  async submit(input: string): Promise<void> {
    const trimmed = input.trim();
    if (trimmed === "/list") {
      this.openList();
      return;
    }
    if (trimmed.startsWith("/open ")) {
      this.openTask(trimmed.slice("/open ".length).trim());
      return;
    }
    await this.start(trimmed);
  }

  openList(): void {
    this.set({ mode: "list", tasks: this.lister(), selected: 0 });
  }

  selectDown(): void {
    const max = this.view.tasks.length - 1;
    this.set({ selected: Math.min(this.view.selected + 1, Math.max(0, max)) });
  }

  selectUp(): void {
    this.set({ selected: Math.max(this.view.selected - 1, 0) });
  }

  openSelected(): void {
    const t = this.view.tasks[this.view.selected];
    if (t) this.loadTask(t);
  }

  openTask(id: string): void {
    const t = this.lister().find((x) => x.id === id);
    if (!t) {
      this.set({ mode: "prompt" });
      this.push(`task not found: ${id}`);
      return;
    }
    this.loadTask(t);
  }

  backToPrompt(): void {
    this.set({ mode: "prompt", state: "idle", task: null, message: "", feed: [] });
  }

  private loadTask(t: Task): void {
    this.view = { ...this.view, mode: "prompt", task: t };
    this.applyTask(t);
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
