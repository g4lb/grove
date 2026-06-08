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

  /** The current repo HEAD SHA (full). */
  async revParseHead(): Promise<string> {
    return this.git(["rev-parse", "HEAD"]);
  }

  /** True if `<branch>` has at least one commit ahead of `baseSha` (computed in the worktree). */
  async committedChanges(worktreePath: string, branch: string, baseSha: string): Promise<boolean> {
    // GitRunner injects `-C <repoPath>`; the second absolute `-C <worktreePath>` overrides it so
    // the count is computed in the task's worktree. Count against the task branch (not HEAD) so
    // an agent that wandered onto a different branch can't make an empty `grove/<id>` look done.
    const out = await this.git(["-C", worktreePath, "rev-list", "--count", `${baseSha}..${branch}`]);
    return Number(out) > 0;
  }

  /** True if repoPath is inside a git work tree. */
  async isGitRepo(): Promise<boolean> {
    const res = await this.runner.run("git", [
      "-C",
      this.repoPath,
      "rev-parse",
      "--is-inside-work-tree",
    ]);
    return res.code === 0 && res.stdout.trim() === "true";
  }
}
