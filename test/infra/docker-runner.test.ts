import { test, expect } from "bun:test";
import { DockerRunner } from "../../src/infra/docker-runner.ts";
import type { CommandRunner, CommandResult } from "../../src/infra/command-runner.ts";

class RecordingRunner implements CommandRunner {
  calls: Array<{ cmd: string; args: string[] }> = [];
  constructor(private result: CommandResult) {}
  async run(cmd: string, args: string[]): Promise<CommandResult> {
    this.calls.push({ cmd, args });
    return this.result;
  }
}

test("docker() runs docker with args and returns trimmed stdout", async () => {
  const runner = new RecordingRunner({ code: 0, stdout: "out\n", stderr: "" });
  const docker = new DockerRunner(runner);
  const out = await docker.docker(["ps", "-a"]);
  expect(out).toBe("out");
  expect(runner.calls[0]).toEqual({ cmd: "docker", args: ["ps", "-a"] });
});

test("docker() throws with stderr on non-zero exit", async () => {
  const runner = new RecordingRunner({ code: 1, stdout: "", stderr: "boom" });
  const docker = new DockerRunner(runner);
  await expect(docker.docker(["ps"])).rejects.toThrow("boom");
});

test("compose() prepends 'compose -p <project>' to the args", async () => {
  const runner = new RecordingRunner({ code: 0, stdout: "", stderr: "" });
  const docker = new DockerRunner(runner);
  await docker.compose("grove-task_1", ["up", "-d"]);
  expect(runner.calls[0]).toEqual({
    cmd: "docker",
    args: ["compose", "-p", "grove-task_1", "up", "-d"],
  });
});

test("composeOk() returns false on non-zero exit instead of throwing", async () => {
  const runner = new RecordingRunner({ code: 1, stdout: "", stderr: "no such project" });
  const docker = new DockerRunner(runner);
  expect(await docker.composeOk("grove-task_1", ["down"])).toBe(false);
});
