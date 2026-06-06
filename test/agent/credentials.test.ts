import { test, expect } from "bun:test";
import { detectCredentials, hasCredentials, credentialEnv } from "../../src/agent/credentials.ts";

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
