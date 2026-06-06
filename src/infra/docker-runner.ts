import type { CommandRunner } from "./command-runner.ts";

export class DockerRunner {
  constructor(private runner: CommandRunner) {}

  /** Run `docker <args>`; returns trimmed stdout, throws on non-zero exit. */
  async docker(args: string[]): Promise<string> {
    const res = await this.runner.run("docker", args);
    if (res.code !== 0) {
      throw new Error(`docker ${args.join(" ")} failed (exit ${res.code}): ${res.stderr.trim()}`);
    }
    return res.stdout.trim();
  }

  /** Run `docker compose -p <project> <args>`; returns trimmed stdout, throws on non-zero exit. */
  async compose(project: string, args: string[]): Promise<string> {
    return this.docker(["compose", "-p", project, ...args]);
  }

  /** Like compose() but returns false on non-zero exit instead of throwing (for best-effort teardown). */
  async composeOk(project: string, args: string[]): Promise<boolean> {
    const res = await this.runner.run("docker", ["compose", "-p", project, ...args]);
    return res.code === 0;
  }
}
