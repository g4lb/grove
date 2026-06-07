import { test, expect } from "bun:test";
import {
  detectCredentials,
  hasCredentials,
  credentialEnv,
  scopedAgentEnv,
  detectClaudeCodeLogin,
  detectUsableCredential,
} from "../../src/agent/credentials.ts";

test("detectCredentials prefers ANTHROPIC_API_KEY (the sanctioned path)", () => {
  const d = detectCredentials({ ANTHROPIC_API_KEY: "sk-1", CLAUDE_CODE_OAUTH_TOKEN: "oauth-1" });
  expect(d.kind).toBe("api_key");
  expect(d.present).toBe(true);
});

test("detectCredentials falls back to the OAuth token", () => {
  const d = detectCredentials({ CLAUDE_CODE_OAUTH_TOKEN: "oauth-1" });
  expect(d.kind).toBe("oauth_token");
  expect(d.present).toBe(true);
});

test("detectCredentials reports none when neither is set", () => {
  const d = detectCredentials({});
  expect(d.present).toBe(false);
  expect(d.kind).toBe("none");
});

test("hasCredentials is a boolean shortcut", () => {
  expect(hasCredentials({ ANTHROPIC_API_KEY: "x" })).toBe(true);
  expect(hasCredentials({})).toBe(false);
});

test("credentialEnv passes through only the credential vars that are set", () => {
  const env = credentialEnv({ ANTHROPIC_API_KEY: "sk-1", PATH: "/bin", FOO: "bar" });
  expect(env.ANTHROPIC_API_KEY).toBe("sk-1");
  expect(env.CLAUDE_CODE_OAUTH_TOKEN).toBeUndefined();
  expect((env as Record<string, unknown>).FOO).toBeUndefined();
});

test("scopedAgentEnv drops unrelated cloud secrets but keeps dev/project + Anthropic creds", () => {
  const env = scopedAgentEnv({
    PATH: "/bin",
    HOME: "/home/me",
    MY_PROJECT_URL: "https://example.test",
    ANTHROPIC_API_KEY: "sk-anthropic",
    CLAUDE_CODE_OAUTH_TOKEN: "oauth-1",
    AWS_SECRET_ACCESS_KEY: "aws-secret",
    AWS_ACCESS_KEY_ID: "aws-id",
    GH_TOKEN: "gh-token",
    GITHUB_TOKEN: "gh-token-2",
    NPM_TOKEN: "npm-token",
    GCP_PROJECT: "gcp-proj",
    GOOGLE_APPLICATION_CREDENTIALS: "/g/creds.json",
    AZURE_CLIENT_SECRET: "az-secret",
    MY_API_SECRET: "my-secret",
    SOME_PRIVATE_KEY: "pk",
  });
  // Kept: dev/project vars and Anthropic/Claude creds.
  expect(env.PATH).toBe("/bin");
  expect(env.HOME).toBe("/home/me");
  expect(env.MY_PROJECT_URL).toBe("https://example.test");
  expect(env.ANTHROPIC_API_KEY).toBe("sk-anthropic");
  expect(env.CLAUDE_CODE_OAUTH_TOKEN).toBe("oauth-1");
  // Dropped: unrelated cloud secrets.
  expect(env.AWS_SECRET_ACCESS_KEY).toBeUndefined();
  expect(env.AWS_ACCESS_KEY_ID).toBeUndefined();
  expect(env.GH_TOKEN).toBeUndefined();
  expect(env.GITHUB_TOKEN).toBeUndefined();
  expect(env.NPM_TOKEN).toBeUndefined();
  expect(env.GCP_PROJECT).toBeUndefined();
  expect(env.GOOGLE_APPLICATION_CREDENTIALS).toBeUndefined();
  expect(env.AZURE_CLIENT_SECRET).toBeUndefined();
  expect(env.MY_API_SECRET).toBeUndefined();
  expect(env.SOME_PRIVATE_KEY).toBeUndefined();
});

test("scopedAgentEnv drops password / credential / access-key style secrets too", () => {
  const env = scopedAgentEnv({
    DB_PASSWORD: "p",
    REGISTRY_PASSWD: "p2",
    SERVICE_CREDENTIALS: "c",
    SOME_ACCESS_KEY: "ak",
    DIGITALOCEAN_TOKEN: "do",
    CLOUDFLARE_API_TOKEN: "cf",
    NODE_ENV: "test", // kept — a normal dev var
  });
  expect(env.DB_PASSWORD).toBeUndefined();
  expect(env.REGISTRY_PASSWD).toBeUndefined();
  expect(env.SERVICE_CREDENTIALS).toBeUndefined();
  expect(env.SOME_ACCESS_KEY).toBeUndefined();
  expect(env.DIGITALOCEAN_TOKEN).toBeUndefined();
  expect(env.CLOUDFLARE_API_TOKEN).toBeUndefined();
  expect(env.NODE_ENV).toBe("test");
});

test("scopedAgentEnv keeps an ANTHROPIC_ var even if its name matches a sensitive pattern", () => {
  const env = scopedAgentEnv({ ANTHROPIC_AUTH_TOKEN: "tok", CLAUDE_PRIVATE_KEY: "x" });
  expect(env.ANTHROPIC_AUTH_TOKEN).toBe("tok");
  expect(env.CLAUDE_PRIVATE_KEY).toBe("x");
});

test("detectClaudeCodeLogin: true when the credentials file exists", () => {
  expect(
    detectClaudeCodeLogin({}, { fileExists: (p) => p.endsWith("/.claude/.credentials.json"), keychainHasLogin: () => false }),
  ).toBe(true);
});

test("detectClaudeCodeLogin: true when the keychain has the login", () => {
  expect(detectClaudeCodeLogin({}, { fileExists: () => false, keychainHasLogin: () => true })).toBe(true);
});

test("detectClaudeCodeLogin: false when neither", () => {
  expect(detectClaudeCodeLogin({}, { fileExists: () => false, keychainHasLogin: () => false })).toBe(false);
});

test("detectClaudeCodeLogin: honors CLAUDE_CONFIG_DIR", () => {
  const seen: string[] = [];
  detectClaudeCodeLogin(
    { CLAUDE_CONFIG_DIR: "/custom/cfg" },
    {
      fileExists: (p) => {
        seen.push(p);
        return false;
      },
      keychainHasLogin: () => false,
    },
  );
  expect(seen.some((p) => p.startsWith("/custom/cfg/"))).toBe(true);
});

test("detectUsableCredential: env key wins", () => {
  expect(
    detectUsableCredential({ ANTHROPIC_API_KEY: "k" }, { fileExists: () => false, keychainHasLogin: () => false }),
  ).toEqual({ present: true, kind: "api_key" });
});

test("detectUsableCredential: falls back to a claude code login", () => {
  expect(detectUsableCredential({}, { fileExists: () => false, keychainHasLogin: () => true })).toEqual({
    present: true,
    kind: "claude_code_login",
  });
});

test("detectUsableCredential: none when no env + no login", () => {
  expect(detectUsableCredential({}, { fileExists: () => false, keychainHasLogin: () => false })).toEqual({
    present: false,
    kind: "none",
  });
});
