import { env } from "cloudflare:test";
import { describe, expect, it } from "vitest";

async function countWhere(
  db: D1Database,
  table: string,
  column: string,
  value: string,
): Promise<number> {
  const row = await db
    .prepare(`SELECT COUNT(*) AS n FROM ${table} WHERE ${column} = ?`)
    .bind(value)
    .first<{ n: number }>();
  return row?.n ?? 0;
}

describe("cascading delete on user removal", () => {
  it("removes every child row across all tables, but leaves the habit library intact", async () => {
    const db = env.DB;

    const userId = crypto.randomUUID();
    const habitId = crypto.randomUUID();
    const stackId = crypto.randomUUID();
    const userHabitId = crypto.randomUUID();

    await db
      .prepare(
        "INSERT INTO users (id, email, display_name, timezone) VALUES (?, ?, ?, ?)",
      )
      .bind(userId, `${userId}@example.com`, "Cascade Test", "Europe/London")
      .run();

    await db
      .prepare(
        "INSERT INTO habits (id, library_version, title, category, identity_statement, tiny_version, standard_version, time_of_day, duration_minutes, difficulty) VALUES (?, 1, 'Read before bed', 'learning', 'I read every day', 'Read one page', 'Read for 15 minutes', 'evening', 15, 1)",
      )
      .bind(habitId)
      .run();

    await db
      .prepare("INSERT INTO sessions (id, token_hash, user_id, expires_at) VALUES (?, ?, ?, ?)")
      .bind(crypto.randomUUID(), crypto.randomUUID(), userId, "2999-01-01T00:00:00Z")
      .run();

    await db
      .prepare("INSERT INTO profiles (user_id, data) VALUES (?, ?)")
      .bind(userId, "{}")
      .run();

    await db
      .prepare("INSERT INTO stacks (id, user_id, name) VALUES (?, ?, ?)")
      .bind(stackId, userId, "Morning routine")
      .run();

    await db
      .prepare(
        "INSERT INTO user_habits (id, user_id, habit_id, level, stack_id, position) VALUES (?, ?, ?, 'tiny', ?, 1)",
      )
      .bind(userHabitId, userId, habitId, stackId)
      .run();

    await db
      .prepare("INSERT INTO checkins (id, user_habit_id, local_date) VALUES (?, ?, ?)")
      .bind(crypto.randomUUID(), userHabitId, "2026-07-20")
      .run();

    await db
      .prepare(
        "INSERT INTO streaks (user_habit_id, current, best, last_completed_date, repair_available) VALUES (?, 1, 1, ?, 0)",
      )
      .bind(userHabitId, "2026-07-20")
      .run();

    await db
      .prepare(
        "INSERT INTO qa_sessions (id, user_id, type, transcript, tokens_used) VALUES (?, ?, 'onboarding', '[]', 100)",
      )
      .bind(crypto.randomUUID(), userId)
      .run();

    await db
      .prepare(
        "INSERT INTO suggestion_log (id, user_id, habit_id, score, score_breakdown, outcome) VALUES (?, ?, ?, 0.9, '{}', 'adopted')",
      )
      .bind(crypto.randomUUID(), userId, habitId)
      .run();

    await db
      .prepare(
        "INSERT INTO push_subscriptions (id, user_id, endpoint, keys, platform) VALUES (?, ?, 'https://example.com/push', '{}', 'web')",
      )
      .bind(crypto.randomUUID(), userId)
      .run();

    // Sanity check: every child row exists before delete.
    expect(await countWhere(db, "sessions", "user_id", userId)).toBe(1);
    expect(await countWhere(db, "profiles", "user_id", userId)).toBe(1);
    expect(await countWhere(db, "stacks", "user_id", userId)).toBe(1);
    expect(await countWhere(db, "user_habits", "user_id", userId)).toBe(1);
    expect(await countWhere(db, "checkins", "user_habit_id", userHabitId)).toBe(1);
    expect(await countWhere(db, "streaks", "user_habit_id", userHabitId)).toBe(1);
    expect(await countWhere(db, "qa_sessions", "user_id", userId)).toBe(1);
    expect(await countWhere(db, "suggestion_log", "user_id", userId)).toBe(1);
    expect(await countWhere(db, "push_subscriptions", "user_id", userId)).toBe(1);

    await db.prepare("DELETE FROM users WHERE id = ?").bind(userId).run();

    expect(await countWhere(db, "sessions", "user_id", userId)).toBe(0);
    expect(await countWhere(db, "profiles", "user_id", userId)).toBe(0);
    expect(await countWhere(db, "stacks", "user_id", userId)).toBe(0);
    expect(await countWhere(db, "user_habits", "user_id", userId)).toBe(0);
    expect(await countWhere(db, "checkins", "user_habit_id", userHabitId)).toBe(0);
    expect(await countWhere(db, "streaks", "user_habit_id", userHabitId)).toBe(0);
    expect(await countWhere(db, "qa_sessions", "user_id", userId)).toBe(0);
    expect(await countWhere(db, "suggestion_log", "user_id", userId)).toBe(0);
    expect(await countWhere(db, "push_subscriptions", "user_id", userId)).toBe(0);

    // The habit library itself is not user-owned and must survive.
    expect(await countWhere(db, "habits", "id", habitId)).toBe(1);
  });
});
