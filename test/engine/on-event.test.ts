import { test, expect } from "bun:test";
import { buildEngine, ok } from "./helpers.ts";
import type { AgentEvent } from "../../src/agent/events.ts";

test("startTask delivers first-phase events to onEvent", async () => {
  const { engine } = buildEngine({
    brainstorm: ok("brainstorm", "/wt/.grove/design.md", [
      { type: "notice", message: "phase brainstorm started" },
      { type: "tool_use", tool: "Write", input: {} },
    ]),
  });
  const seen: AgentEvent[] = [];
  await engine.startTask({ title: "x", repoPath: "/r", kind: "task" }, (e) => seen.push(e));
  expect(seen).toContainEqual({ type: "tool_use", tool: "Write", input: {} });
});

test("confirmGate delivers the advanced phase's events to onEvent", async () => {
  const { engine } = buildEngine({
    brainstorm: ok("brainstorm", "/wt/.grove/design.md"),
    plan: ok("plan", "/wt/.grove/plan.md", [{ type: "tool_use", tool: "Edit", input: {} }]),
  });
  const t0 = await engine.startTask({ title: "x", repoPath: "/r", kind: "task" });
  const seen: AgentEvent[] = [];
  await engine.confirmGate(t0.id, { kind: "approve" }, (e) => seen.push(e));
  expect(seen).toContainEqual({ type: "tool_use", tool: "Edit", input: {} });
});

test("onEvent is unsubscribed after the call (no leak to a later run)", async () => {
  const { engine } = buildEngine({
    brainstorm: ok("brainstorm", "/wt/.grove/design.md", [{ type: "notice", message: "a" }]),
    plan: ok("plan", "/wt/.grove/plan.md", [{ type: "notice", message: "b" }]),
  });
  const seen: AgentEvent[] = [];
  const t0 = await engine.startTask({ title: "x", repoPath: "/r", kind: "task" }, (e) => seen.push(e));
  const before = seen.length;
  await engine.confirmGate(t0.id, { kind: "approve" }); // no onEvent this time
  expect(seen.length).toBe(before);
});
