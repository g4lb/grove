import { test, expect } from "bun:test";
import { slugify } from "../../src/infra/slug.ts";

test("slugify lowercases and hyphenates words", () => {
  expect(slugify("Add OAuth Login")).toBe("add-oauth-login");
});

test("slugify strips non-alphanumeric and collapses separators", () => {
  expect(slugify("Fix:  the   checkout!! bug")).toBe("fix-the-checkout-bug");
});

test("slugify trims leading/trailing hyphens", () => {
  expect(slugify("  --Hello--  ")).toBe("hello");
});

test("slugify truncates to 40 chars without a trailing hyphen", () => {
  const s = slugify("a".repeat(60));
  expect(s.length).toBe(40);
  expect(s.endsWith("-")).toBe(false);
});

test("slugify falls back to 'task' for empty/symbol-only input", () => {
  expect(slugify("!!!")).toBe("task");
  expect(slugify("")).toBe("task");
});
