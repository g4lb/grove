import type { Task } from "../domain/types.ts";
import type { AgentEvent } from "../agent/events.ts";
import { renderAgentEvent } from "../agent/agent-feed.ts";
import type { StartTaskInput } from "../engine/task-engine.ts";

/** The engine surface the controller needs (the real TaskEngine satisfies it). */
export interface ControllerEngine {
  startTask(input: StartTaskInput, onEvent?: (e: AgentEvent) => void): Promise<Task>;
}

type RunState = "idle" | "running" | "blocked" | "done" | "stopped";

export interface ControllerView {
  mode: "prompt" | "list";
  state: RunState;
  task: Task | null;
  feed: string[];
  message: string;
  tasks: Task[];
  selected: number;
  viewing: boolean;
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

  private view: ControllerView = { mode: "prompt", state: "idle", task: null, feed: [], message: "", tasks: [], selected: 0, viewing: false };

  constructor(
    private engine: ControllerEngine,
    private repoPath: string,
    private superpowersPath: string,
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
    renderAgentEvent(event, (line) => this.push(line));
  };

  async start(prose: string): Promise<void> {
    if (this.view.state === "running") return;
    this.set({ state: "running", message: "", feed: [], viewing: false, task: null });
    try {
      const task = await this.engine.startTask(
        { title: prose, description: prose, repoPath: this.repoPath, kind: "task", superpowersPath: this.superpowersPath },
        this.onEvent,
      );
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
    this.set({ mode: "prompt", state: "idle", task: null, message: "", feed: [], viewing: false });
  }

  private loadTask(t: Task): void {
    this.view = { ...this.view, mode: "prompt", task: t, viewing: true };
    this.applyTask(t);
  }

  private applyTask(task: Task): void {
    let message = "";
    if (task.status === "done") message = `done — branch ${task.branch ?? "?"} is ready`;
    else if (task.status === "blocked") message = "blocked — the session did not complete";
    else if (task.status === "stopped") message = "stopped";
    this.set({ state: task.status as RunState, task, message });
  }
}
