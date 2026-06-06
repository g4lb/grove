import type { CommandRunner } from "./command-runner.ts";

export class GitRunner {
  constructor(
    private runner: CommandRunner,
    private repoPath: string,
  ) {}

  /** Run a git subcommand inside the repo; returns trimmed stdout, throws on non-zero exit. */
  async git(args: string[]): Promise<string> {
    const res = await this.runner.run("git", ["-C", this.repoPath, ...args]);
    if (res.code !== 0) {
      throw new Error(`git ${args.join(" ")} failed (exit ${res.code}): ${res.stderr.trim()}`);
    }
    return res.stdout.trim();
  }

  /** True if repoPath is inside a git work tree. */
  async isGitRepo(): Promise<boolean> {
    const res = await this.runner.run("git", [
      "-C",
      this.repoPath,
      "rev-parse",
      "--is-inside-work-tree",
    ]);
    return res.code === 0;
  }
}
