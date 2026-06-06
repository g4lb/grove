import { Database } from "bun:sqlite";
import { migrate } from "./migrations.ts";
import { newId } from "../domain/ids.ts";
import type { Task, PhaseRun, TaskEvent } from "../domain/types.ts";
import type {
  Store,
  CreateTaskInput,
  TaskPatch,
  TaskQuery,
  CreatePhaseRunInput,
  PhaseRunPatch,
  AppendEventInput,
} from "./store.ts";

interface TaskRow {
  id: string;
  title: string;
  kind: string;
  status: string;
  current_phase: string;
  repo_path: string;
  worktree_path: string | null;
  branch: string | null;
  compose_project: string | null;
  created_at: string;
  updated_at: string;
}

function mapTask(r: TaskRow): Task {
  return {
    id: r.id,
    title: r.title,
    kind: r.kind as Task["kind"],
    status: r.status as Task["status"],
    currentPhase: r.current_phase as Task["currentPhase"],
    repoPath: r.repo_path,
    worktreePath: r.worktree_path,
    branch: r.branch,
    composeProject: r.compose_project,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  };
}

interface PhaseRunRow {
  id: string;
  task_id: string;
  phase: string;
  state: string;
  summary: string | null;
  artifact_path: string | null;
  started_at: string | null;
  ended_at: string | null;
}

function mapPhaseRun(r: PhaseRunRow): PhaseRun {
  return {
    id: r.id,
    taskId: r.task_id,
    phase: r.phase as PhaseRun["phase"],
    state: r.state as PhaseRun["state"],
    summary: r.summary,
    artifactPath: r.artifact_path,
    startedAt: r.started_at,
    endedAt: r.ended_at,
  };
}

export interface SqliteStoreOptions {
  now?: () => string;
}

export class SqliteStore implements Store {
  private db: Database;
  private now: () => string;

  constructor(db: Database, opts: SqliteStoreOptions = {}) {
    this.db = db;
    this.now = opts.now ?? (() => new Date().toISOString());
    db.run("PRAGMA foreign_keys = ON;");
    migrate(db);
  }

  static open(file: string, opts: SqliteStoreOptions = {}): SqliteStore {
    return new SqliteStore(new Database(file), opts);
  }

  createTask(input: CreateTaskInput): Task {
    const id = newId("task");
    const ts = this.now();
    this.db
      .query(
        `INSERT INTO tasks
         (id, title, kind, status, current_phase, repo_path, worktree_path, branch, compose_project, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        id,
        input.title,
        input.kind,
        input.status ?? "running",
        input.currentPhase ?? "brainstorm",
        input.repoPath,
        null,
        null,
        null,
        ts,
        ts,
      );
    return this.getTask(id)!;
  }

  getTask(id: string): Task | null {
    const row = this.db.query("SELECT * FROM tasks WHERE id = ?").get(id) as TaskRow | null;
    return row ? mapTask(row) : null;
  }

  queryTasks(query: TaskQuery = {}): Task[] {
    const rows = query.status
      ? (this.db
          .query("SELECT * FROM tasks WHERE status = ? ORDER BY updated_at DESC")
          .all(query.status) as TaskRow[])
      : (this.db.query("SELECT * FROM tasks ORDER BY updated_at DESC").all() as TaskRow[]);
    return rows.map(mapTask);
  }

  updateTask(id: string, patch: TaskPatch): Task {
    const cur = this.getTask(id);
    if (!cur) throw new Error(`task not found: ${id}`);
    const next: Task = { ...cur, ...patch, updatedAt: this.now() };
    this.db
      .query(
        `UPDATE tasks SET status = ?, current_phase = ?, worktree_path = ?, branch = ?, compose_project = ?, updated_at = ? WHERE id = ?`,
      )
      .run(
        next.status,
        next.currentPhase,
        next.worktreePath,
        next.branch,
        next.composeProject,
        next.updatedAt,
        id,
      );
    return next;
  }

  // --- phase_runs and events implemented in Tasks 7 & 8 ---
  createPhaseRun(input: CreatePhaseRunInput): PhaseRun {
    const id = newId("run");
    this.db
      .query(
        `INSERT INTO phase_runs (id, task_id, phase, state, summary, artifact_path, started_at, ended_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(id, input.taskId, input.phase, input.state ?? "pending", null, null, null, null);
    const row = this.db.query("SELECT * FROM phase_runs WHERE id = ?").get(id) as PhaseRunRow;
    return mapPhaseRun(row);
  }

  updatePhaseRun(id: string, patch: PhaseRunPatch): PhaseRun {
    const row = this.db.query("SELECT * FROM phase_runs WHERE id = ?").get(id) as PhaseRunRow | null;
    if (!row) throw new Error(`phase run not found: ${id}`);
    const cur = mapPhaseRun(row);
    const next: PhaseRun = { ...cur, ...patch };
    this.db
      .query(
        `UPDATE phase_runs SET state = ?, summary = ?, artifact_path = ?, started_at = ?, ended_at = ? WHERE id = ?`,
      )
      .run(next.state, next.summary, next.artifactPath, next.startedAt, next.endedAt, id);
    return next;
  }

  getPhaseRuns(taskId: string): PhaseRun[] {
    const rows = this.db
      .query("SELECT * FROM phase_runs WHERE task_id = ? ORDER BY rowid ASC")
      .all(taskId) as PhaseRunRow[];
    return rows.map(mapPhaseRun);
  }
  appendEvent(input: AppendEventInput): TaskEvent {
    const id = newId("evt");
    const ts = this.now();
    const payload = JSON.stringify(input.payload ?? null);
    this.db
      .query("INSERT INTO events (id, task_id, ts, type, payload) VALUES (?, ?, ?, ?, ?)")
      .run(id, input.taskId, ts, input.type, payload);
    return { id, taskId: input.taskId, ts, type: input.type, payload };
  }

  getEvents(taskId: string): TaskEvent[] {
    const rows = this.db
      .query("SELECT * FROM events WHERE task_id = ? ORDER BY rowid ASC")
      .all(taskId) as Array<{ id: string; task_id: string; ts: string; type: string; payload: string }>;
    return rows.map((r) => ({
      id: r.id,
      taskId: r.task_id,
      ts: r.ts,
      type: r.type,
      payload: r.payload,
    }));
  }

  close(): void {
    this.db.close();
  }
}
