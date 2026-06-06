import { test, expect } from "bun:test";
import { runGc, type GcDeps } from "../../src/cli/gc.ts";

function deps(over: Partial<GcDeps>): GcDeps {
  return {
    discover: async () => ["task_old", "task_live"],
    statusOf: (id) => (id === "task_live" ? "running" : null),
    removeWorktree: async () => {},
    downProject: async () => true,
    ...over,
  };
}

test("runGc reclaims only orphans, leaving live tasks alone", async () => {
  const removedWts: string[] = [];
  const downedProjects: string[] = [];
  const report = await runGc(
    deps({
      removeWorktree: async (id) => {
        removedWts.push(id);
      },
      downProject: async (project) => {
        downedProjects.push(project);
        return true;
      },
    }),
  );

  expect(report.reclaimed).toEqual(["task_old"]);
  expect(report.kept).toEqual(["task_live"]);
  expect(removedWts).toEqual(["task_old"]);
  expect(downedProjects).toEqual(["grove-task_old"]);
});

test("runGc continues past a failure on one orphan", async () => {
  const report = await runGc(
    deps({
      discover: async () => ["task_x", "task_y"],
      statusOf: () => null,
      removeWorktree: async (id) => {
        if (id === "task_x") throw new Error("rm failed");
      },
      downProject: async () => true,
    }),
  );
  expect(report.reclaimed).toContain("task_y");
  expect(report.errors.some((e) => e.taskId === "task_x")).toBe(true);
});

test("runGc does not reclaim an orphan whose compose down fails; surfaces an error and leaves the worktree", async () => {
  const removed: string[] = [];
  const report = await runGc(
    deps({
      discover: async () => ["task_downfail"],
      statusOf: () => null, // orphan
      downProject: async () => false, // teardown failed
      removeWorktree: async (id) => {
        removed.push(id);
      },
    }),
  );
  expect(report.reclaimed).not.toContain("task_downfail");
  expect(removed).toEqual([]); // worktree left in place for the next run to retry
  expect(report.errors.some((e) => e.taskId === "task_downfail")).toBe(true);
});

test("runGc with no orphans reports nothing reclaimed", async () => {
  const report = await runGc(
    deps({ discover: async () => ["task_live"], statusOf: () => "running" }),
  );
  expect(report.reclaimed).toEqual([]);
  expect(report.kept).toEqual(["task_live"]);
});
