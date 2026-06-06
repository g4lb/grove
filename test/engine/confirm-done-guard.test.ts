import { test, expect } from "bun:test";
import { buildEngine, ok } from "./helpers.ts";

function fullScripts() {
  return {
    brainstorm: ok("brainstorm", "/wt/.grove/design.md"),
    plan: ok("plan", "/wt/.grove/plan.md"),
    execute: ok("execute", null),
    review: ok("review", "/wt/.grove/review.md"),
    finish: ok("finish", null),
  };
}

async function toDone() {
  const { engine } = buildEngine(fullScripts());
  const t0 = await engine.startTask({ title: "x", repoPath: "/r", kind: "task" });
  await engine.confirmGate(t0.id, { kind: "approve" });
  await engine.confirmGate(t0.id, { kind: "approve" });
  await engine.confirmGate(t0.id, { kind: "approve" }); // done
  return { engine, id: t0.id };
}

test("rerun on a done task throws (no re-running finish / double teardown)", async () => {
  const { engine, id } = await toDone();
  await expect(engine.confirmGate(id, { kind: "rerun" })).rejects.toThrow();
});

test("stop on a done task throws (does not overwrite done)", async () => {
  const { engine, id } = await toDone();
  await expect(engine.confirmGate(id, { kind: "stop" })).rejects.toThrow();
});
