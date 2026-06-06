import { homedir } from "node:os";
import { join } from "node:path";

export interface GrovePaths {
  root: string;
  dbFile: string;
  tasksDir: string;
  configFile: string;
  taskDir(id: string): string;
}

export function resolvePaths(root: string = join(homedir(), ".grove")): GrovePaths {
  return {
    root,
    dbFile: join(root, "grove.db"),
    tasksDir: join(root, "tasks"),
    configFile: join(root, "config.json"),
    taskDir: (id: string) => join(root, "tasks", id),
  };
}
