import { join } from "node:path";

const SUPERPOWERS_REPO = "https://github.com/obra/superpowers.git";
/** Pinned tag the fetcher clones — never track an unpinned branch (the plugin runs with bypassPermissions + your creds). */
export const SUPERPOWERS_REF = "v5.1.0";

export interface ResolveSuperpowersDeps {
  env: Record<string, string | undefined>;
  grovePluginsDir: string;
  installedPluginsJsonPath: string;
  fileExists: (path: string) => boolean;
  readText: (path: string) => string | null;
  gitClone: (url: string, dest: string) => Promise<void>;
  out: (line: string) => void;
}

function isValidPlugin(dir: string, fileExists: (p: string) => boolean): boolean {
  return fileExists(join(dir, ".claude-plugin", "plugin.json"));
}

/** Resolve the obra/superpowers plugin dir: env → user install → grove copy → fetch. */
export async function resolveSuperpowers(deps: ResolveSuperpowersDeps): Promise<string> {
  const override = deps.env.GROVE_SUPERPOWERS_PATH;
  if (override && isValidPlugin(override, deps.fileExists)) return override;

  const installed = deps.readText(deps.installedPluginsJsonPath);
  if (installed) {
    try {
      const json = JSON.parse(installed) as { plugins?: Record<string, Array<{ installPath?: string }>> };
      for (const [name, entries] of Object.entries(json.plugins ?? {})) {
        if (!name.startsWith("superpowers@")) continue;
        const path = entries.find((e) => e.installPath)?.installPath;
        if (path && isValidPlugin(path, deps.fileExists)) return path;
      }
    } catch {
      // ignore a malformed config; fall through
    }
  }

  const groveCopy = join(deps.grovePluginsDir, "superpowers");
  if (isValidPlugin(groveCopy, deps.fileExists)) return groveCopy;

  deps.out("fetching the superpowers skills (one-time)…");
  await deps.gitClone(SUPERPOWERS_REPO, groveCopy);
  if (!isValidPlugin(groveCopy, deps.fileExists)) {
    throw new Error(`failed to install superpowers into ${groveCopy}`);
  }
  return groveCopy;
}
