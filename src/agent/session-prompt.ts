import type { SessionContext } from "./events.ts";

export const AUTONOMY_APPEND =
  "Operate fully autonomously: no human is available to answer questions or approve gates. " +
  "Use the superpowers TDD/planning/review skills' methodology, but never wait for user input and " +
  "do not invoke their interactive approval gates — make sensible decisions yourself and proceed.";

export function buildSessionPrompt(ctx: SessionContext): string {
  return [
    `You are working in an isolated git worktree on branch \`${ctx.branch}\`. Your task:`,
    "",
    ctx.prose,
    "",
    "Work **fully autonomously** — no human is available to answer questions or approve gates. Use your",
    "**superpowers** skills' methodology to take this from idea to a committed, tested change: understand and",
    "design the approach, write a brief plan, implement it **test-first**, review your own work, and **commit**",
    "to the current branch. Make decisions yourself and proceed end-to-end without pausing for approval or",
    "asking questions. When finished, summarize what you changed.",
  ].join("\n");
}
