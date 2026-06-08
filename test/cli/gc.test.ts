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
    lookup({ task_a: "done", task_b: "stopped", task_c: "running" }),
  );
  expect(orphans.sort()).toEqual(["task_a", "task_b"]);
});

test("findOrphans keeps running/blocked tasks", () => {
  const orphans = findOrphans(
    ["task_a", "task_b"],
    lookup({ task_a: "running", task_b: "blocked" }),
  );
  expect(orphans).toEqual([]);
});

test("findOrphans reclaims blocked tasks when includeBlocked is set (but never running)", () => {
  const orphans = findOrphans(
    ["task_a", "task_b", "task_c"],
    lookup({ task_a: "blocked", task_b: "running", task_c: "done" }),
    { includeBlocked: true },
  );
  expect(orphans.sort()).toEqual(["task_a", "task_c"]); // blocked + done reclaimed; running kept
});

test("findOrphans without includeBlocked still keeps blocked tasks", () => {
  const orphans = findOrphans(["task_a"], lookup({ task_a: "blocked" }));
  expect(orphans).toEqual([]);
});

test("findOrphans de-duplicates ids seen from multiple sources", () => {
  const orphans = findOrphans(["task_a", "task_a", "task_b"], lookup({}));
  expect(orphans.sort()).toEqual(["task_a", "task_b"]);
});
