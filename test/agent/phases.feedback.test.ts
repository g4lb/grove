import { test, expect } from "bun:test";
import { buildPrompt } from "../../src/agent/phases.ts";
import type { PhaseContext } from "../../src/agent/events.ts";

const base: PhaseContext = {
  taskId: "task_1",
  title: "Add login",
  worktreePath: "/wt",
  model: "m",
  priorArtifacts: [],
};

test("buildPrompt includes a Requested changes block when feedback is present", () => {
  const prompt = buildPrompt("brainstorm", { ...base, feedback: "use OAuth not passwords" });
  expect(prompt).toContain("Requested changes");
  expect(prompt).toContain("use OAuth not passwords");
});

test("buildPrompt omits the Requested changes block when feedback is absent", () => {
  const prompt = buildPrompt("brainstorm", base);
  expect(prompt).not.toContain("Requested changes");
});
