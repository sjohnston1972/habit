import { env } from "cloudflare:test";
import { describe, expect, it } from "vitest";

const EXPECTED_TABLES = [
  "users",
  "sessions",
  "magic_links",
  "habits",
  "profiles",
  "user_habits",
  "stacks",
  "checkins",
  "streaks",
  "qa_sessions",
  "suggestion_log",
  "push_subscriptions",
];

describe("D1 schema migration", () => {
  it("creates all 12 tables from CLAUDE.md §12", async () => {
    const { results } = await env.DB.prepare(
      "SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' AND name != 'd1_migrations'",
    ).all<{ name: string }>();

    const tableNames = results.map((row) => row.name).sort();
    expect(tableNames).toEqual([...EXPECTED_TABLES].sort());
  });
});
