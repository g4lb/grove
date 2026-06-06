import type { Database } from "bun:sqlite";

export function migrate(db: Database): void {
  db.run(`
    CREATE TABLE IF NOT EXISTS tasks (
      id TEXT PRIMARY KEY,
      title TEXT NOT NULL,
      kind TEXT NOT NULL,
      status TEXT NOT NULL,
      current_phase TEXT NOT NULL,
      repo_path TEXT NOT NULL,
      worktree_path TEXT,
      branch TEXT,
      compose_project TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
  `);
  db.run(`
    CREATE TABLE IF NOT EXISTS phase_runs (
      id TEXT PRIMARY KEY,
      task_id TEXT NOT NULL REFERENCES tasks(id),
      phase TEXT NOT NULL,
      state TEXT NOT NULL,
      summary TEXT,
      artifact_path TEXT,
      started_at TEXT,
      ended_at TEXT
    );
  `);
  db.run(`
    CREATE TABLE IF NOT EXISTS events (
      id TEXT PRIMARY KEY,
      task_id TEXT NOT NULL REFERENCES tasks(id),
      ts TEXT NOT NULL,
      type TEXT NOT NULL,
      payload TEXT NOT NULL
    );
  `);
  db.run(`CREATE INDEX IF NOT EXISTS idx_phase_runs_task ON phase_runs(task_id);`);
  db.run(`CREATE INDEX IF NOT EXISTS idx_events_task ON events(task_id);`);
}
