import { test, expect } from "bun:test";
import React from "react";
import { render } from "ink-testing-library";
import { App } from "../../src/app/app.tsx";
import type { ControllerView } from "../../src/app/controller.ts";
import type { Task } from "../../src/domain/types.ts";

function task(over: Partial<Task>): Task {
  return {
    id: "task_1", title: "x", description: null, kind: "task", status: "done",
    currentPhase: "session", repoPath: "/r", worktreePath: "/wt", branch: "b",
    composeProject: null, createdAt: "t", updatedAt: "t", ...over,
  };
}

function spyController(view: ControllerView) {
  return {
    view,
    onChange: () => {},
    submits: [] as string[],
    nav: [] as string[],
    snapshot() { return this.view; },
    async start() {},
    async submit(s: string) { this.submits.push(s); },
    selectUp() { this.nav.push("up"); },
    selectDown() { this.nav.push("down"); },
    openSelected() { this.nav.push("open"); },
    backToPrompt() { this.nav.push("back"); },
  };
}

const idle: ControllerView = { mode: "prompt", state: "idle", task: null, feed: [], message: "", tasks: [], selected: 0, viewing: false };
function delay(ms = 40) { return new Promise((r) => setTimeout(r, ms)); }

test("idle Enter routes input through submit (so /list works)", async () => {
  const c = spyController(idle);
  const { stdin } = render(<App controller={c as any} />);
  stdin.write("/list");
  stdin.write("\r");
  await delay();
  expect(c.submits).toContain("/list");
});

test("renders the list dashboard with task rows", () => {
  const c = spyController({
    ...idle,
    mode: "list",
    tasks: [task({ id: "task_1", title: "build login", status: "blocked", kind: "task" })],
    selected: 0,
  });
  const { lastFrame } = render(<App controller={c as any} />);
  const frame = lastFrame() ?? "";
  expect(frame).toContain("build login");
  expect(frame).toContain("blocked");
});

test("list-mode arrow keys move the selection", async () => {
  const c = spyController({ ...idle, mode: "list", tasks: [task({ id: "a" }), task({ id: "b" })], selected: 0 });
  const { stdin } = render(<App controller={c as any} />);
  stdin.write("\x1B[B"); // down arrow
  await delay();
  expect(c.nav).toContain("down");
});

test("list-mode 'o' opens the selected task", async () => {
  const c = spyController({ ...idle, mode: "list", tasks: [task({ id: "a" })], selected: 0 });
  const { stdin } = render(<App controller={c as any} />);
  stdin.write("o");
  await delay();
  expect(c.nav).toContain("open");
});

test("list-mode Esc returns to the prompt", async () => {
  const c = spyController({ ...idle, mode: "list", tasks: [task({ id: "a" })], selected: 0 });
  const { stdin } = render(<App controller={c as any} />);
  stdin.write("\x1B"); // escape
  await delay();
  expect(c.nav).toContain("back");
});

test("pressing enter on a terminal state returns to the prompt (so /list is reachable again)", async () => {
  const c = spyController({ ...idle, state: "done", message: "done", task: task({}) });
  const { stdin } = render(<App controller={c as any} />);
  stdin.write("\r");
  await delay();
  expect(c.nav).toContain("back");
});

test("terminal-state hint mentions starting a new prompt and quitting", () => {
  const c = spyController({ ...idle, state: "done", message: "done" });
  const { lastFrame } = render(<App controller={c as any} />);
  const frame = (lastFrame() ?? "").toLowerCase();
  expect(frame).toContain("new prompt");
  expect(frame).toContain("quit");
});

test("Esc escapes an opened task (even a stale running one) back to the prompt", async () => {
  const c = spyController({ ...idle, viewing: true, state: "running", task: task({ id: "task_1", status: "running" }), message: "" });
  const { stdin } = render(<App controller={c as any} />);
  stdin.write("\x1B"); // escape
  await delay();
  expect(c.nav).toContain("back");
});

test("a viewed task shows an esc-back hint", () => {
  const c = spyController({ ...idle, viewing: true, state: "running", task: task({ id: "task_1", status: "running" }), message: "" });
  const { lastFrame } = render(<App controller={c as any} />);
  expect((lastFrame() ?? "").toLowerCase()).toContain("esc");
});
