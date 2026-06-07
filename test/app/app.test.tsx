import { test, expect } from "bun:test";
import { render } from "ink-testing-library";
import { App } from "../../src/app/app.tsx";
import type { ControllerView } from "../../src/app/controller.ts";

function spyController(view: ControllerView) {
  return {
    view,
    onChange: () => {},
    starts: [] as string[],
    submits: [] as string[],
    snapshot() {
      return this.view;
    },
    async start(prose: string) {
      this.starts.push(prose);
    },
    async submit(s: string) {
      this.submits.push(s);
    },
  };
}

const idle: ControllerView = { mode: "prompt", state: "idle", task: null, feed: [], message: "", tasks: [], selected: 0, viewing: false };

function delay(ms = 30) {
  return new Promise((r) => setTimeout(r, ms));
}

test("renders the grove prompt in the idle state", () => {
  const c = spyController(idle);
  const { lastFrame } = render(<App controller={c as any} />);
  expect(lastFrame()).toContain("grove");
});

test("typing a request and pressing enter calls controller.submit", async () => {
  const c = spyController(idle);
  const { stdin } = render(<App controller={c as any} />);
  stdin.write("add a settings page");
  stdin.write("\r");
  await delay();
  expect(c.submits).toContain("add a settings page");
});

test("renders the live feed while running", () => {
  const c = spyController({
    mode: "prompt",
    state: "running",
    task: null,
    feed: ["· Write", "· Edit"],
    message: "",
    tasks: [],
    selected: 0,
    viewing: false,
  });
  const { lastFrame } = render(<App controller={c as any} />);
  const frame = lastFrame() ?? "";
  expect(frame).toContain("· Write");
  expect(frame.toLowerCase()).toContain("working");
});

test("renders the done message and a quit hint on a terminal state", () => {
  const c = spyController({ mode: "prompt", state: "done", task: null, feed: [], message: "done — branch grove/t is ready", tasks: [], selected: 0, viewing: false });
  const { lastFrame } = render(<App controller={c as any} />);
  const frame = lastFrame() ?? "";
  expect(frame).toContain("done — branch grove/t is ready");
  expect(frame.toLowerCase()).toContain("quit");
});
