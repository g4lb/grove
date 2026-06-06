import { test, expect } from "bun:test";
import { Database } from "bun:sqlite";
import { migrate } from "../../src/store/migrations.ts";

test("migrate creates tasks, phase_runs, events tables", () => {
  const db = new Database(":memory:");
  migrate(db);
  const names = db
    .query("SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name")
    .all()
    .map((r: any) => r.name);
  expect(names).toContain("tasks");
  expect(names).toContain("phase_runs");
  expect(names).toContain("events");
});

test("migrate is idempotent", () => {
  const db = new Database(":memory:");
  migrate(db);
  expect(() => migrate(db)).not.toThrow();
});
