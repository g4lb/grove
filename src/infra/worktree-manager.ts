import { join } from "node:path";
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
    // --force is required because a task worktree normally has uncommitted changes;
    // the committed work lives on the grove/<...> branch, which is not deleted here.
    await this.git.git(["worktree", "remove", "--force", worktreePath]);
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
    // GitRunner already injects `-C <repoPath>`; this second absolute `-C <worktreePath>`
    // overrides it so the diff runs in the task's worktree (absolute path is required).
    const res = await this.git.git(["-C", worktreePath, "diff", "HEAD"]);
    return res;
  }
}
