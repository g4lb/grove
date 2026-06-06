import { test, expect } from "bun:test";
import { phaseDefinition, buildPrompt } from "../../src/agent/phases.ts";
import type { PhaseContext } from "../../src/agent/events.ts";

const ctx: PhaseContext = {
  taskId: "task_1",
  title: "Add OAuth login",
  description: "Support Google sign-in",
  worktreePath: "/wt",
  model: "claude-opus-4-8",
  priorArtifacts: [{ phase: "brainstorm", path: "/wt/.grove/design.md" }],
};

test("every phase has a definition with a non-empty system prompt and turn cap", () => {
  for (const phase of ["brainstorm", "plan", "execute", "review", "finish"] as const) {
    const def = phaseDefinition(phase);
    expect(def.systemPromptAppend.length).toBeGreaterThan(0);
    expect(def.maxTurns).toBeGreaterThan(0);
  }
});

test("brainstorm and plan produce a .grove artifact; execute and finish do not", () => {
  expect(phaseDefinition("brainstorm").artifactRelPath).toBe(".grove/design.md");
  expect(phaseDefinition("plan").artifactRelPath).toBe(".grove/plan.md");
  expect(phaseDefinition("review").artifactRelPath).toBe(".grove/review.md");
  expect(phaseDefinition("execute").artifactRelPath).toBeNull();
  expect(phaseDefinition("finish").artifactRelPath).toBeNull();
});

test("buildPrompt includes the task title, description, and prior artifact paths", () => {
  const prompt = buildPrompt("plan", ctx);
  expect(prompt).toContain("Add OAuth login");
  expect(prompt).toContain("Support Google sign-in");
  expect(prompt).toContain("/wt/.grove/design.md");
});

test("buildPrompt for brainstorm works with no prior artifacts", () => {
  const prompt = buildPrompt("brainstorm", { ...ctx, priorArtifacts: [] });
  expect(prompt).toContain("Add OAuth login");
  expect(prompt).not.toContain("Prior artifacts");
});
