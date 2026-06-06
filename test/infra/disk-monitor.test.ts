import { test, expect } from "bun:test";
import { ShellDiskMonitor } from "../../src/infra/disk-monitor.ts";
import type { CommandRunner, CommandResult } from "../../src/infra/command-runner.ts";

class MapRunner implements CommandRunner {
  constructor(private fn: (cmd: string, args: string[]) => CommandResult) {}
  async run(cmd: string, args: string[]): Promise<CommandResult> {
    return this.fn(cmd, args);
  }
}

const DF_OUTPUT = [
  "Filesystem 1024-blocks      Used Available Capacity Mounted on",
  "/dev/disk1s1  488245288 200000000  20000000      91% /",
].join("\n");

test("freeBytes parses df -Pk available blocks into bytes", async () => {
  const runner = new MapRunner((cmd, args) => {
    expect(cmd).toBe("df");
    expect(args).toEqual(["-Pk", "/some/path"]);
    return { code: 0, stdout: DF_OUTPUT, stderr: "" };
  });
  const monitor = new ShellDiskMonitor(runner);
  expect(await monitor.freeBytes("/some/path")).toBe(20000000 * 1024);
});

test("evaluate returns 'ok' above warn, 'warn' between, 'block' below block", () => {
  const monitor = new ShellDiskMonitor(new MapRunner(() => ({ code: 0, stdout: "", stderr: "" })));
  const thresholds = { warnBytes: 10, blockBytes: 2 };
  expect(monitor.evaluate(20, thresholds)).toBe("ok");
  expect(monitor.evaluate(5, thresholds)).toBe("warn");
  expect(monitor.evaluate(1, thresholds)).toBe("block");
  expect(monitor.evaluate(10, thresholds)).toBe("ok");
  expect(monitor.evaluate(2, thresholds)).toBe("warn");
});

test("freeBytes throws on df failure", async () => {
  const runner = new MapRunner(() => ({ code: 1, stdout: "", stderr: "df: no such path" }));
  const monitor = new ShellDiskMonitor(runner);
  await expect(monitor.freeBytes("/nope")).rejects.toThrow("df");
});
