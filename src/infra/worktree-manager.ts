import { join } from "node:path";
import { rmSync } from "node:fs";
import type { GrovePaths } from "../config/paths.ts";
import type { GitRunner } from "./git-runner.ts";
import { slugify } from "./slug.ts";

export interface Worktree {
  taskId: string;
  worktreePath: string;
  branch: string;
}

export interface WorktreeManager {
  create(taskId: string, title: string): Promise<Worktree>;
  remove(taskId: string): Promise<void>;
  list(): Promise<string[]>;
  getDiff(taskId: string): Promise<string>;
}

/** Short suffix of a `task_<hex>` id, used in the human-facing branch name. */
function shortId(taskId: string): string {
  const underscore = taskId.indexOf("_");
  const raw = underscore >= 0 ? taskId.slice(underscore + 1) : taskId;
  return raw.slice(0, 8);
}

// NOTE: taskId is trusted here — it is always an internally generated `task_<hex>` id
// (see domain/ids.ts), never user input, so it is safe to interpolate into branch names
// and filesystem paths. If task ids ever become user-influenced, sanitize at this boundary.
export class GitWorktreeManager implements WorktreeManager {
  constructor(
    private git: GitRunner,
    private paths: GrovePaths,
  ) {}

  private worktreePathFor(taskId: string): string {
    return join(this.paths.taskDir(taskId), "worktree");
  }

  async create(taskId: string, title: string): Promise<Worktree> {
    const branch = `grove/${shortId(taskId)}-${slugify(title)}`;
    const worktreePath = this.worktreePathFor(taskId);
    await this.git.git(["worktree", "add", "-b", branch, worktreePath, "HEAD"]);
    return { taskId, worktreePath, branch };
  }

  async remove(taskId: string): Promise<void> {
    const worktreePath = this.worktreePathFor(taskId);
    try {
      // --force is required because a task worktree normally has uncommitted changes;
      // the committed work lives on the grove/<...> branch, which is not deleted here.
      await this.git.git(["worktree", "remove", "--force", worktreePath]);
    } catch {
      // The worktree dir is already gone (e.g. a prior partial reclaim) — drop git's
      // now-stale registration instead of failing, so removal is idempotent.
      await this.git.git(["worktree", "prune"]);
    }
    // Remove the parent task dir too. `git worktree remove` only deletes the
    // `worktree/` subdir; without this, gc's discovery would rediscover the empty
    // task_<id> dir every run, re-orphan it, and exit 1 forever. force:true makes
    // this a no-op when the dir is already absent (second remove).
    rmSync(this.paths.taskDir(taskId), { recursive: true, force: true });
  }

  async list(): Promise<string[]> {
    const out = await this.git.git(["worktree", "list", "--porcelain"]);
    return out
      .split("\n")
      .filter((line) => line.startsWith("worktree "))
      .map((line) => line.slice("worktree ".length));
  }

  async getDiff(taskId: string): Promise<string> {
    const worktreePath = this.worktreePathFor(taskId);
    // GitRunner already injects `-C <repoPath>`; the second absolute `-C <worktreePath>`
    // overrides it so git operates in the task's worktree (absolute path is required).
    // `add -A -N` marks new files as intent-to-add so they appear as additions in the
    // diff — without it, `git diff HEAD` would silently omit untracked files.
    await this.git.git(["-C", worktreePath, "add", "-A", "-N"]);
    const res = await this.git.git(["-C", worktreePath, "diff", "HEAD"]);
    return res;
  }
}
