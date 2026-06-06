import { test, expect } from "bun:test";
import { ShellDiskMonitor } from "../../src/infra/disk-monitor.ts";
import type { CommandRunner, CommandResult } from "../../src/infra/command-runner.ts";

class MapRunner implements CommandRunner {
  constructor(private fn: (cmd: string, args: string[]) => CommandResult) {}
  async run(cmd: string, args: string[]): Promise<CommandResult> {
    return this.fn(cmd, args);
  }
}

test("groveUsageBytes parses du -sk total into bytes", async () => {
  const runner = new MapRunner((cmd, args) => {
    expect(cmd).toBe("du");
    expect(args).toEqual(["-sk", "/groveroot/tasks"]);
    return { code: 0, stdout: "4096\t/groveroot/tasks\n", stderr: "" };
  });
  const monitor = new ShellDiskMonitor(runner);
  expect(await monitor.groveUsageBytes("/groveroot/tasks")).toBe(4096 * 1024);
});

test("groveUsageBytes returns 0 when the directory does not exist", async () => {
  const runner = new MapRunner(() => ({ code: 1, stdout: "", stderr: "du: no such file or directory" }));
  const monitor = new ShellDiskMonitor(runner);
  expect(await monitor.groveUsageBytes("/missing")).toBe(0);
});
