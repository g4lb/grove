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

/**
 * The Anthropic credential vars to OVERLAY onto the subprocess env (it does NOT scope the base
 * env — it just guarantees the credential vars are present). Overlay this on top of
 * `scopedAgentEnv(env)` so the subprocess keeps PATH/HOME/project vars but not unrelated secrets.
 */
export function credentialEnv(env: Env): Env {
  const out: Env = {};
  if (env.ANTHROPIC_API_KEY) out.ANTHROPIC_API_KEY = env.ANTHROPIC_API_KEY;
  if (env.CLAUDE_CODE_OAUTH_TOKEN) out.CLAUDE_CODE_OAUTH_TOKEN = env.CLAUDE_CODE_OAUTH_TOKEN;
  return out;
}

// Names matching this look like cloud/CI/service secrets the agent's dev work never needs, so we
// don't hand them to the third-party superpowers plugin running with bypassPermissions. The SDK's
// `env` option REPLACES the subprocess environment (it is not merged with process.env), so this
// scoping is effective. Anthropic/Claude creds are exempted below.
//
// NOTE — best-effort, not a security boundary: the agent runs with bypassPermissions on the host,
// so it can already read secret FILES (~/.aws, .env, …) regardless of env, and a denylist can't be
// exhaustive without dropping vars a legitimate task needs (DB URLs, service keys its tests use).
// True isolation requires sandboxing the agent — a deferred follow-up (the SDK has a `sandbox` option).
const SENSITIVE_ENV_KEY = /(SECRET|PASSWORD|PASSWD|CREDENTIALS|PRIVATE_KEY|_ACCESS_KEY|_TOKEN|^AWS_|GITHUB_TOKEN|GH_TOKEN|NPM_TOKEN|^GCP_|^GOOGLE_|^AZURE_|^DIGITALOCEAN_|^CLOUDFLARE_)/i;

/**
 * The base env for the agent subprocess with unrelated cloud/CI secrets removed, while keeping
 * dev/project env (PATH, HOME, project URLs, …) working. Anthropic/Claude credential vars are
 * always kept so the agent can authenticate.
 */
export function scopedAgentEnv(env: Env): Env {
  const out: Env = {};
  for (const [key, value] of Object.entries(env)) {
    const isAnthropic = key.startsWith("ANTHROPIC_") || key.startsWith("CLAUDE_");
    if (!isAnthropic && SENSITIVE_ENV_KEY.test(key)) continue;
    out[key] = value;
  }
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
