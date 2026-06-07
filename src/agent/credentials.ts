import { existsSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";

type CredentialKind = "api_key" | "oauth_token" | "claude_code_login" | "none";

export interface CredentialInfo {
  present: boolean;
  kind: CredentialKind;
}

type Env = Record<string, string | undefined>;

/**
 * Detect which Anthropic credential is available. ANTHROPIC_API_KEY is the
 * product-sanctioned path and takes precedence (it also wins inside the SDK
 * subprocess when both are set); CLAUDE_CODE_OAUTH_TOKEN is the local fallback.
 */
export function detectCredentials(env: Env): CredentialInfo {
  if (env.ANTHROPIC_API_KEY) return { present: true, kind: "api_key" };
  if (env.CLAUDE_CODE_OAUTH_TOKEN) return { present: true, kind: "oauth_token" };
  return { present: false, kind: "none" };
}

export function hasCredentials(env: Env): boolean {
  return detectCredentials(env).present;
}

/** The credential-only env to hand to the SDK subprocess (no unrelated vars leaked). */
export function credentialEnv(env: Env): Env {
  const out: Env = {};
  if (env.ANTHROPIC_API_KEY) out.ANTHROPIC_API_KEY = env.ANTHROPIC_API_KEY;
  if (env.CLAUDE_CODE_OAUTH_TOKEN) out.CLAUDE_CODE_OAUTH_TOKEN = env.CLAUDE_CODE_OAUTH_TOKEN;
  return out;
}

export interface ClaudeLoginProbes {
  /** Default: fs existsSync. */
  fileExists?: (path: string) => boolean;
  /** Default: macOS Keychain check for the Claude Code login. */
  keychainHasLogin?: () => boolean;
}

function defaultKeychainHasLogin(): boolean {
  if (process.platform !== "darwin") return false;
  try {
    const p = Bun.spawnSync(["security", "find-generic-password", "-s", "Claude Code-credentials"], {
      stdout: "ignore",
      stderr: "ignore",
    });
    return p.exitCode === 0;
  } catch {
    return false;
  }
}

/** True if the user is logged into Claude Code (browser-authorized via `claude login`). */
export function detectClaudeCodeLogin(env: Env, probes: ClaudeLoginProbes = {}): boolean {
  // Escape hatch (CI / deterministic tests): force "not logged in" regardless of host state.
  if (env.GROVE_DISABLE_CLAUDE_LOGIN_DETECTION === "1") return false;
  const configDir =
    env.CLAUDE_CONFIG_DIR && env.CLAUDE_CONFIG_DIR.length > 0
      ? env.CLAUDE_CONFIG_DIR
      : join(env.HOME ?? homedir(), ".claude");
  const fileExists = probes.fileExists ?? existsSync;
  if (fileExists(join(configDir, ".credentials.json"))) return true;
  const keychainHasLogin = probes.keychainHasLogin ?? defaultKeychainHasLogin;
  return keychainHasLogin();
}

/** Combined: an env credential, or a Claude Code login. */
export function detectUsableCredential(env: Env, probes: ClaudeLoginProbes = {}): CredentialInfo {
  const direct = detectCredentials(env);
  if (direct.present) return direct;
  if (detectClaudeCodeLogin(env, probes)) return { present: true, kind: "claude_code_login" };
  return { present: false, kind: "none" };
}
