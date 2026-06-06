import type { DockerRunner } from "./docker-runner.ts";
import { findComposeFile } from "./compose-file.ts";

export function composeProjectFor(taskId: string): string {
  return `grove-${taskId}`;
}

export interface ComposeManager {
  /** Start the task's service stack. Returns false (no-op) if the worktree has no compose file. */
  up(taskId: string, worktreePath: string): Promise<boolean>;
  /** Stop + remove the task's service stack (containers, volumes, orphans). No-op false if no compose file. */
  down(taskId: string, worktreePath: string): Promise<boolean>;
  /** Stop a project by name only (used by gc when the worktree/compose file is already gone). */
  downByProject(project: string): Promise<boolean>;
  /** `docker compose ps` output for the task, or "" if no compose file. */
  status(taskId: string, worktreePath: string): Promise<string>;
  /** `docker compose logs` output for the task, or "" if no compose file. */
  logs(taskId: string, worktreePath: string): Promise<string>;
}

export class DockerComposeManager implements ComposeManager {
  constructor(private docker: DockerRunner) {}

  async up(taskId: string, worktreePath: string): Promise<boolean> {
    const file = findComposeFile(worktreePath);
    if (!file) return false;
    await this.docker.compose(composeProjectFor(taskId), ["-f", file, "up", "-d"]);
    return true;
  }

  async down(taskId: string, worktreePath: string): Promise<boolean> {
    const file = findComposeFile(worktreePath);
    if (!file) return false;
    await this.docker.compose(composeProjectFor(taskId), [
      "-f",
      file,
      "down",
      "--volumes",
      "--remove-orphans",
    ]);
    return true;
  }

  async downByProject(project: string): Promise<boolean> {
    // No -f: compose removes resources by project label even without the file.
    return this.docker.composeOk(project, ["down", "--volumes", "--remove-orphans"]);
  }

  async status(taskId: string, worktreePath: string): Promise<string> {
    const file = findComposeFile(worktreePath);
    if (!file) return "";
    return this.docker.compose(composeProjectFor(taskId), ["-f", file, "ps"]);
  }

  async logs(taskId: string, worktreePath: string): Promise<string> {
    const file = findComposeFile(worktreePath);
    if (!file) return "";
    return this.docker.compose(composeProjectFor(taskId), ["-f", file, "logs", "--no-color"]);
  }
}
