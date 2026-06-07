import { test, expect } from "bun:test";
import {
  detectCredentials,
  hasCredentials,
  credentialEnv,
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
