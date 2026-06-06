import { test, expect } from "bun:test";
import React from "react";
import { render } from "ink-testing-library";
import { App } from "../../src/app/app.tsx";
import type { ControllerView } from "../../src/app/controller.ts";
import type { GateDecision } from "../../src/engine/task-engine.ts";

function spyController(view: ControllerView) {
  return {
    view,
    onChange: () => {},
    starts: [] as string[],
    decisions: [] as GateDecision[],
    snapshot() {
      return this.view;
    },
    async start(prose: string) {
      this.starts.push(prose);
    },
    async decide(d: GateDecision) {
      this.decisions.push(d);
    },
  };
}

const idle: ControllerView = { state: "idle", task: null, feed: [], message: "" };

function delay(ms = 30) {
  return new Promise((r) => setTimeout(r, ms));
}

test("renders the grove prompt in the idle state", () => {
  const c = spyController(idle);
  const { lastFrame } = render(<App controller={c as any} />);
  expect(lastFrame()).toContain("grove");
});

test("typing a request and pressing enter calls controller.start", async () => {
  const c = spyController(idle);
  const { stdin } = render(<App controller={c as any} />);
  stdin.write("add a settings page");
  stdin.write("\r");
  await delay();
  expect(c.starts).toContain("add a settings page");
});

test("renders the feed and the gate action bar at a gate", () => {
  const c = spyController({
    state: "waiting_confirm",
    task: null,
    feed: ["· Write", "· Edit"],
    message: "gate — brainstorm done",
  });
  const { lastFrame } = render(<App controller={c as any} />);
  const frame = lastFrame() ?? "";
  expect(frame).toContain("· Write");
  expect(frame).toContain("brainstorm done");
  expect(frame.toLowerCase()).toContain("approve");
});

test("pressing 'a' at a gate approves", async () => {
  const c = spyController({ state: "waiting_confirm", task: null, feed: [], message: "gate" });
  const { stdin } = render(<App controller={c as any} />);
  stdin.write("a");
  await delay();
  expect(c.decisions).toContainEqual({ kind: "approve" });
});

test("pressing 's' at a gate stops", async () => {
  const c = spyController({ state: "waiting_confirm", task: null, feed: [], message: "gate" });
  const { stdin } = render(<App controller={c as any} />);
  stdin.write("s");
  await delay();
  expect(c.decisions).toContainEqual({ kind: "stop" });
});

test("renders a quit hint on a terminal state", () => {
  const c = spyController({ state: "done", task: null, feed: [], message: "task complete" });
  const { lastFrame } = render(<App controller={c as any} />);
  expect((lastFrame() ?? "").toLowerCase()).toContain("quit");
});
