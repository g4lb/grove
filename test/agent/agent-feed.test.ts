import { test, expect } from "bun:test";
import { describeToolUse, renderAgentEvent } from "../../src/agent/agent-feed.ts";

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
    "· session started",
    "I'll create the file.",
    "Then commit it.",
    "· Write(hello.txt)",
  ]);
});

test("renderAgentEvent skips blank narration", () => {
  const lines: string[] = [];
  renderAgentEvent({ type: "token", text: "   \n\n" }, (l) => lines.push(l));
  expect(lines).toEqual([]);
});
