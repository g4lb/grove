import { test, expect } from "bun:test";
import { GitRunner } from "../../src/infra/git-runner.ts";
import type { CommandRunner, CommandResult } from "../../src/infra/command-runner.ts";

class RecordingRunner implements CommandRunner {
  calls: Array<{ cmd: string; args: string[] }> = [];
  constructor(private result: CommandResult) {}
  async run(cmd: string, args: string[]): Promise<CommandResult> {
    this.calls.push({ cmd, args });
    return this.result;
  }
}

test("git() runs git with the given args and returns trimmed stdout", async () => {
  const runner = new RecordingRunner({ code: 0, stdout: "abc123\n", stderr: "" });
  const git = new GitRunner(runner, "/repo");
  const out = await git.git(["rev-parse", "HEAD"]);
  expect(out).toBe("abc123");
  expect(runner.calls[0]!.cmd).toBe("git");
  expect(runner.calls[0]!.args).toEqual(["-C", "/repo", "rev-parse", "HEAD"]);
});

test("git() throws with stderr on non-zero exit", async () => {
  const runner = new RecordingRunner({ code: 128, stdout: "", stderr: "fatal: not a git repository" });
  const git = new GitRunner(runner, "/repo");
  await expect(git.git(["status"])).rejects.toThrow("fatal: not a git repository");
});

test("revParseHead returns the trimmed HEAD SHA", async () => {
  const runner = new RecordingRunner({ code: 0, stdout: "deadbeef\n", stderr: "" });
  const git = new GitRunner(runner, "/repo");
  expect(await git.revParseHead()).toBe("deadbeef");
  expect(runner.calls[0]!.args).toEqual(["-C", "/repo", "rev-parse", "HEAD"]);
});

test("committedChanges is true when the rev-list count is > 0", async () => {
  const yes = new GitRunner(new RecordingRunner({ code: 0, stdout: "3\n", stderr: "" }), "/repo");
  expect(await yes.committedChanges("/wt", "grove/x", "base000")).toBe(true);
  const no = new GitRunner(new RecordingRunner({ code: 0, stdout: "0\n", stderr: "" }), "/repo");
  expect(await no.committedChanges("/wt", "grove/x", "base000")).toBe(false);
});

test("isGitRepo returns true on exit 0, false otherwise", async () => {
  const ok = new GitRunner(new RecordingRunner({ code: 0, stdout: "true\n", stderr: "" }), "/repo");
  expect(await ok.isGitRepo()).toBe(true);
  const no = new GitRunner(new RecordingRunner({ code: 128, stdout: "", stderr: "fatal" }), "/repo");
  expect(await no.isGitRepo()).toBe(false);
});

test("isGitRepo returns false when inside a .git dir (exit 0 but stdout 'false')", async () => {
  const inGitDir = new GitRunner(new RecordingRunner({ code: 0, stdout: "false\n", stderr: "" }), "/repo/.git");
  expect(await inGitDir.isGitRepo()).toBe(false);
});
