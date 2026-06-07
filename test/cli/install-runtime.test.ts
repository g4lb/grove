import { test, expect } from "bun:test";
import { runInstallRuntime, type InstallRuntimeCliDeps } from "../../src/cli/install-runtime.ts";

function deps(over: Partial<InstallRuntimeCliDeps> = {}): InstallRuntimeCliDeps {
  return {
    platformName: "darwin",
    archName: "arm64",
    version: "0.3.167",
    runtimeDir: "/home/.grove/runtime",
    install: async () => ({ path: "/home/.grove/runtime/claude", skipped: false }),
    out: () => {},
    existing: null,
    force: false,
    ...over,
  };
}

test("returns 0 and reports success on a supported platform", async () => {
  const lines: string[] = [];
  const code = await runInstallRuntime(deps({ out: (l) => lines.push(l) }));
  expect(code).toBe(0);
  expect(lines.join("\n").toLowerCase()).toContain("claude");
});

test("returns 0 and notes a skip when already installed", async () => {
  const lines: string[] = [];
  const code = await runInstallRuntime(deps({
    install: async () => ({ path: "/home/.grove/runtime/claude", skipped: true }),
    out: (l) => lines.push(l),
  }));
  expect(code).toBe(0);
  expect(lines.join("\n").toLowerCase()).toContain("already");
});

test("returns 1 with a clear message on an unsupported platform (never calls install)", async () => {
  let installed = false;
  const lines: string[] = [];
  const code = await runInstallRuntime(deps({
    platformName: "win32",
    install: async () => { installed = true; return { path: "x", skipped: false }; },
    out: (l) => lines.push(l),
  }));
  expect(code).toBe(1);
  expect(installed).toBe(false);
  expect(lines.join("\n").toLowerCase()).toContain("unsupported");
});

test("returns 1 and surfaces a fetch failure", async () => {
  const lines: string[] = [];
  const code = await runInstallRuntime(deps({
    install: async () => { throw new Error("network down"); },
    out: (l) => lines.push(l),
  }));
  expect(code).toBe(1);
  expect(lines.join("\n").toLowerCase()).toContain("failed");
});

test("passes the detected libc through to the platform (musl linux)", async () => {
  let received: { os: string; arch: string; libc?: string } | null = null;
  const code = await runInstallRuntime(deps({
    platformName: "linux",
    archName: "x64",
    libc: "musl",
    install: async (p) => { received = p; return { path: "/home/.grove/runtime/claude", skipped: false }; },
  }));
  expect(code).toBe(0);
  expect(received as { os: string; arch: string; libc?: string } | null).toEqual({ os: "linux", arch: "x64", libc: "musl" });
});

test("reuses an existing claude and skips the download by default", async () => {
  let installed = false;
  const lines: string[] = [];
  const code = await runInstallRuntime(deps({
    existing: "/usr/local/bin/claude",
    force: false,
    install: async () => { installed = true; return { path: "x", skipped: false }; },
    out: (l) => lines.push(l),
  }));
  expect(code).toBe(0);
  expect(installed).toBe(false);
  expect(lines.join("\n").toLowerCase()).toContain("existing");
  expect(lines.join("\n").toLowerCase()).toContain("/usr/local/bin/claude");
});

test("--force installs the pinned binary even when an existing claude is present", async () => {
  let installed = false;
  const code = await runInstallRuntime(deps({
    existing: "/usr/local/bin/claude",
    force: true,
    install: async () => { installed = true; return { path: "/r/claude", skipped: false }; },
  }));
  expect(code).toBe(0);
  expect(installed).toBe(true);
});

test("with no existing claude, it installs as before", async () => {
  let installed = false;
  const code = await runInstallRuntime(deps({
    existing: null,
    install: async () => { installed = true; return { path: "/r/claude", skipped: false }; },
  }));
  expect(code).toBe(0);
  expect(installed).toBe(true);
});
