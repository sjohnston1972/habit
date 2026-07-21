import { env } from "cloudflare:test";
import { describe, expect, it } from "vitest";
import { ALL_HABITS, seedHabits } from "../src/worker/seed";

async function countHabits(db: D1Database): Promise<number> {
  const row = await db.prepare("SELECT COUNT(*) AS n FROM habits").first<{ n: number }>();
  return row?.n ?? 0;
}

async function allHabitIds(db: D1Database): Promise<string[]> {
  const { results } = await db.prepare("SELECT id FROM habits ORDER BY id").all<{ id: string }>();
  return results.map((row) => row.id);
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

  it("keeps habit ids stable across re-seeds", async () => {
    const db = env.DB;

    await seedHabits(db);
    const firstIds = await allHabitIds(db);

    await seedHabits(db);
    const secondIds = await allHabitIds(db);

    expect(secondIds).toEqual(firstIds);
  });

  it("uses the deterministic id from the library, not a random one", async () => {
    const db = env.DB;
    await seedHabits(db);

    const ids = new Set(await allHabitIds(db));
    for (const habit of ALL_HABITS) {
      expect(ids.has(habit.id)).toBe(true);
    }
  });

  it("does not orphan an adopted habit when the library is re-seeded", async () => {
    const db = env.DB;
    await seedHabits(db);

    // A user adopts a habit — this is the reference a re-seed must not break.
    const userId = crypto.randomUUID();
    await db
      .prepare("INSERT INTO users (id, email, display_name, timezone) VALUES (?, ?, ?, ?)")
      .bind(userId, `${userId}@example.com`, "Tester", "UTC")
      .run();
    const adoptedHabitId = ALL_HABITS[0].id;
    const userHabitId = crypto.randomUUID();
    await db
      .prepare("INSERT INTO user_habits (id, user_id, habit_id, level) VALUES (?, ?, ?, 'tiny')")
      .bind(userHabitId, userId, adoptedHabitId)
      .run();

    // Re-seed the whole library (e.g. to add new habits).
    await seedHabits(db);

    // The adopted habit still exists and still joins.
    const joined = await db
      .prepare(
        `SELECT h.title FROM user_habits uh JOIN habits h ON h.id = uh.habit_id WHERE uh.id = ?`,
      )
      .bind(userHabitId)
      .first<{ title: string }>();

    expect(joined?.title).toBe(ALL_HABITS[0].title);
  });
});
