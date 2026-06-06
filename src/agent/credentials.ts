export type CredentialKind = "api_key" | "oauth_token" | "none";

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
