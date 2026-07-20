import { env } from "cloudflare:test";
import { describe, expect, it } from "vitest";
import { ALL_HABITS, seedHabits } from "../src/worker/seed";

async function countHabits(db: D1Database): Promise<number> {
  const row = await db.prepare("SELECT COUNT(*) AS n FROM habits").first<{ n: number }>();
  return row?.n ?? 0;
}

describe("seed loader", () => {
  it("is idempotent — re-running leaves the same row count", async () => {
    const db = env.DB;

    const firstInserted = await seedHabits(db);
    const firstRowCount = await countHabits(db);

    const secondInserted = await seedHabits(db);
    const secondRowCount = await countHabits(db);

    expect(firstInserted).toBe(ALL_HABITS.length);
    expect(secondInserted).toBe(ALL_HABITS.length);
    expect(firstRowCount).toBe(ALL_HABITS.length);
    expect(secondRowCount).toBe(firstRowCount);
  });
});
