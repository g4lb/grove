import { accessSync, constants } from "node:fs";
import { join } from "node:path";

export interface ResolveClaudeDeps {
  env: Record<string, string | undefined>;
  /** `<grove root>/runtime` — where `grove install-runtime` places the binary. */
  runtimeDir: string;
  /** Injectable for tests; defaults to an fs X_OK check. */
  isExecutable?: (path: string) => boolean;
  /** Injectable for tests; defaults to `Bun.which("claude")`. */
  whichClaude?: () => string | null;
}

function defaultIsExecutable(path: string): boolean {
  try {
    accessSync(path, constants.X_OK);
    return true;
  } catch {
    return false;
  }
}

function defaultWhichClaude(): string | null {
  return Bun.which("claude");
}

/**
 * Resolve the native `claude` binary grove drives, by precedence:
 *   $GROVE_CLAUDE_PATH → <runtimeDir>/claude → `claude` on PATH → null.
 * `null` means "let the SDK self-resolve from node_modules" (dev).
 */
export function resolveClaudePath(deps: ResolveClaudeDeps): string | null {
  const isExec = deps.isExecutable ?? defaultIsExecutable;
  const override = deps.env.GROVE_CLAUDE_PATH;
  if (override && isExec(override)) return override;

  const runtime = join(deps.runtimeDir, "claude");
  if (isExec(runtime)) return runtime;

  const onPath = (deps.whichClaude ?? defaultWhichClaude)();
  if (onPath && isExec(onPath)) return onPath;

  return null;
}
