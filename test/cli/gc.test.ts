import { test, expect } from "bun:test";
import { findOrphans, type TaskStatusLookup } from "../../src/cli/gc.ts";

const lookup = (m: Record<string, string | undefined>): TaskStatusLookup => ({
  statusOf: (taskId: string) => (m[taskId] ?? null) as any,
});

test("findOrphans reclaims tasks absent from the store", () => {
  const orphans = findOrphans(["task_a", "task_b"], lookup({ task_a: "running" }));
  expect(orphans).toEqual(["task_b"]);
});

test("findOrphans reclaims terminal tasks (done/stopped)", () => {
  const orphans = findOrphans(
    ["task_a", "task_b", "task_c"],
    lookup({ task_a: "done", task_b: "stopped", task_c: "waiting_confirm" }),
  );
  expect(orphans.sort()).toEqual(["task_a", "task_b"]);
});

test("findOrphans keeps running/blocked/waiting tasks", () => {
  const orphans = findOrphans(
    ["task_a", "task_b", "task_c"],
    lookup({ task_a: "running", task_b: "blocked", task_c: "waiting_confirm" }),
  );
  expect(orphans).toEqual([]);
});

test("findOrphans de-duplicates ids seen from multiple sources", () => {
  const orphans = findOrphans(["task_a", "task_a", "task_b"], lookup({}));
  expect(orphans.sort()).toEqual(["task_a", "task_b"]);
});
