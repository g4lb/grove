import type { Phase } from "../domain/types.ts";
import type { PhaseContext } from "./events.ts";

export interface PhaseDefinition {
  /** Appended to the claude_code system-prompt preset; encodes the phase methodology. */
  systemPromptAppend: string;
  /** Worktree-relative path of the gate artifact this phase should produce, or null. */
  artifactRelPath: string | null;
  /** Caps the agentic loop for this phase. */
  maxTurns: number;
}

const DEFINITIONS: Record<Phase, PhaseDefinition> = {
  brainstorm: {
    systemPromptAppend:
      "You are in grove's BRAINSTORM phase. Explore the request, clarify scope, and " +
      "weigh approaches. Write a concise design document to `.grove/design.md` covering " +
      "the chosen approach, the components involved, and key trade-offs. Do NOT write " +
      "implementation code in this phase.",
    artifactRelPath: ".grove/design.md",
    maxTurns: 30,
  },
  plan: {
    systemPromptAppend:
      "You are in grove's PLAN phase. Read `.grove/design.md`. Produce a step-by-step " +
      "implementation plan at `.grove/plan.md` as bite-sized, independently testable tasks " +
      "(test-driven where possible). Do NOT implement the code yet.",
    artifactRelPath: ".grove/plan.md",
    maxTurns: 30,
  },
  execute: {
    systemPromptAppend:
      "You are in grove's EXECUTE phase. Read `.grove/plan.md` and implement it task by " +
      "task, writing tests first where practical and committing as you complete each step. " +
      "Ensure the test suite passes before finishing.",
    artifactRelPath: null,
    maxTurns: 80,
  },
  review: {
    systemPromptAppend:
      "You are in grove's REVIEW phase. Review the changes on this branch for correctness, " +
      "edge cases, and quality. Write your findings (with file:line references and severity) " +
      "to `.grove/review.md`.",
    artifactRelPath: ".grove/review.md",
    maxTurns: 30,
  },
  finish: {
    systemPromptAppend:
      "You are in grove's FINISH phase. Make sure the test suite passes, then prepare the " +
      "branch for integration: ensure all work is committed with a clear message and produce " +
      "a short summary of what changed.",
    artifactRelPath: null,
    maxTurns: 15,
  },
};

export function phaseDefinition(phase: Phase): PhaseDefinition {
  return DEFINITIONS[phase];
}

/** Build the task-specific prompt for a phase, threading prior artifacts forward. */
export function buildPrompt(phase: Phase, ctx: PhaseContext): string {
  const lines: string[] = [];
  lines.push(`Task: ${ctx.title}`);
  if (ctx.description) lines.push(`Details: ${ctx.description}`);
  if (ctx.priorArtifacts.length > 0) {
    lines.push("");
    lines.push("Prior artifacts (read these for context):");
    for (const a of ctx.priorArtifacts) lines.push(`- ${a.phase}: ${a.path}`);
  }
  if (ctx.feedback) {
    lines.push("");
    lines.push("Requested changes from the previous attempt (address these):");
    lines.push(ctx.feedback);
  }
  lines.push("");
  lines.push(`Begin the ${phase} phase now.`);
  return lines.join("\n");
}
