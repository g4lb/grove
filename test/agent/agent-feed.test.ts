import { test, expect } from "bun:test";
import { describeToolUse, renderAgentEvent, mergeUsage, formatStats, branchActions } from "../../src/agent/agent-feed.ts";

test("branchActions shows how to review, merge, and open the isolated branch", () => {
  expect(branchActions("grove/abc", "/wt")).toEqual([
    "  review: git diff HEAD..grove/abc",
    "  merge:  git merge grove/abc",
    "  open:   /wt",
  ]);
  expect(branchActions("grove/abc", null)).toEqual([
    "  review: git diff HEAD..grove/abc",
    "  merge:  git merge grove/abc",
  ]);
});

test("mergeUsage overwrites only the fields a usage event carries", () => {
  let s = mergeUsage(null, { contextTokens: 1000, outputTokens: 50 });
  expect(s).toEqual({ contextTokens: 1000, outputTokens: 50 });
  s = mergeUsage(s, { costUsd: 0.04, turns: 3 });
  expect(s).toEqual({ contextTokens: 1000, outputTokens: 50, costUsd: 0.04, turns: 3 });
  s = mergeUsage(s, { contextTokens: 2000 });
  expect(s.contextTokens).toBe(2000);
  expect(s.costUsd).toBe(0.04); // preserved
});

test("formatStats renders a compact status line scaled to present fields", () => {
  expect(formatStats({ contextTokens: 14200, costUsd: 0.09, turns: 6 }, 12)).toBe("12s · 14.2k ctx · 6 turns · $0.09");
  expect(formatStats({ turns: 1 })).toBe("1 turn");
  expect(formatStats(null)).toBe("");
});

test("renderAgentEvent emits nothing for usage events (they drive the status line, not the feed)", () => {
  const lines: string[] = [];
  renderAgentEvent({ type: "usage", contextTokens: 100, costUsd: 0.01 }, (l) => lines.push(l));
  expect(lines).toEqual([]);
});

test("describeToolUse summarizes common tools claude-code style", () => {
  expect(describeToolUse("Bash", { command: "git add . && git commit -m x" })).toBe(
    "Bash(git add . && git commit -m x)",
  );
  expect(describeToolUse("Write", { file_path: "/wt/hello.txt", content: "hello" })).toBe("Write(/wt/hello.txt)");
  expect(describeToolUse("Edit", { file_path: "src/foo.ts" })).toBe("Edit(src/foo.ts)");
  expect(describeToolUse("Read", { file_path: "README.md" })).toBe("Read(README.md)");
  expect(describeToolUse("Grep", { pattern: "TODO", path: "src" })).toBe("Grep(TODO)");
  expect(describeToolUse("Skill", { command: "superpowers:test-driven-development" })).toBe(
    "Skill(superpowers:test-driven-development)",
  );
  expect(describeToolUse("TodoWrite", { todos: [] })).toBe("TodoWrite");
});

test("describeToolUse collapses whitespace and truncates long commands", () => {
  const out = describeToolUse("Bash", { command: "echo " + "x".repeat(200) });
  expect(out.length).toBeLessThan(90);
  expect(out.endsWith("…)")).toBe(true);
});

test("describeToolUse falls back to the tool name, or its first string arg", () => {
  expect(describeToolUse("MysteryTool", {})).toBe("MysteryTool");
  expect(describeToolUse("MysteryTool", { foo: "bar" })).toBe("MysteryTool(bar)");
});

test("renderAgentEvent emits notices, narration lines, and tool calls", () => {
  const lines: string[] = [];
  const emit = (l: string) => lines.push(l);
  renderAgentEvent({ type: "notice", message: "session started" }, emit);
  renderAgentEvent({ type: "token", text: "I'll create the file.\nThen commit it." }, emit);
  renderAgentEvent({ type: "tool_use", tool: "Write", input: { file_path: "hello.txt" } }, emit);
  expect(lines).toEqual([
    "● session started",
    "I'll create the file.",
    "Then commit it.",
    "● Write(hello.txt)",
  ]);
});

test("renderAgentEvent shows a tool result as a truncated ⎿ line with a +N lines hint", () => {
  const lines: string[] = [];
  renderAgentEvent({ type: "tool_result", output: "first line of output\nsecond\nthird" }, (l) => lines.push(l));
  expect(lines).toEqual(["  ⎿ first line of output", "     … +2 lines"]);
});

test("renderAgentEvent shows a one-line tool result with no +N hint", () => {
  const lines: string[] = [];
  renderAgentEvent({ type: "tool_result", output: "ok\n" }, (l) => lines.push(l));
  expect(lines).toEqual(["  ⎿ ok"]);
});

test("renderAgentEvent skips blank narration", () => {
  const lines: string[] = [];
  renderAgentEvent({ type: "token", text: "   \n\n" }, (l) => lines.push(l));
  expect(lines).toEqual([]);
});
