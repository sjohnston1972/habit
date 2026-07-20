import { SELF, env } from "cloudflare:test";
import { describe, expect, it } from "vitest";
import { createSession } from "../src/worker/session";

/**
 * The offline queue's safety net, proven end to end: replaying the same queued
 * check-in must leave exactly one row and one increment. The guarantee comes
 * from the unique constraint on (user_habit_id, local_date), not from the
 * client remembering what it already sent.
 */

async function createUser(timezone = "UTC"): Promise<string> {
  const id = crypto.randomUUID();
  await env.DB.prepare("INSERT INTO users (id, email, display_name, timezone) VALUES (?, ?, ?, ?)")
    .bind(id, `${id}@example.com`, "Tester", timezone)
    .run();
  return id;
}

async function adopt(userId: string): Promise<string> {
  await env.DB.prepare(
    `INSERT INTO habits (id, library_version, title, category, tags, identity_statement,
       tiny_version, standard_version, time_of_day, duration_minutes, difficulty,
       frequency_default, stack_anchors)
     VALUES ('habit-1', 1, 'Walk', 'Exercise & Movement', '[]', 'I move', 'Tiny', 'Standard',
             'morning', 10, 1, 'daily', '[]')`,
  ).run();

  const userHabitId = crypto.randomUUID();
  await env.DB.batch([
    env.DB.prepare(
      "INSERT INTO user_habits (id, user_id, habit_id, level) VALUES (?, ?, 'habit-1', 'tiny')",
    ).bind(userHabitId, userId),
    env.DB.prepare(
      "INSERT INTO streaks (user_habit_id, current, best, last_completed_date, repair_available, consecutive_since_repair) VALUES (?, 0, 0, NULL, 1, 0)",
    ).bind(userHabitId),
  ]);
  return userHabitId;
}

function replay(token: string, userHabitId: string, localDate: string): Promise<Response> {
  return SELF.fetch(`https://example.com/api/user-habits/${userHabitId}/checkin`, {
    method: "POST",
    headers: { Cookie: `habit_session=${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({ local_date: localDate }),
  });
}

describe("replaying a queued check-in", () => {
  it("writes one row and one increment however many times it is sent", async () => {
    const userId = await createUser();
    const userHabitId = await adopt(userId);
    const { token } = await createSession(env.DB, userId);

    const first = await replay(token, userHabitId, "2026-07-14");
    const second = await replay(token, userHabitId, "2026-07-14");
    const third = await replay(token, userHabitId, "2026-07-14");

    expect(first.status).toBe(200);
    expect(second.status).toBe(200);
    expect(third.status).toBe(200);

    expect((await first.json<{ outcome: string }>()).outcome).toBe("incremented");
    expect((await second.json<{ outcome: string }>()).outcome).toBe("noop");
    expect((await third.json<{ outcome: string }>()).outcome).toBe("noop");

    const rows = await env.DB.prepare("SELECT COUNT(*) AS n FROM checkins WHERE user_habit_id = ?")
      .bind(userHabitId)
      .first<{ n: number }>();
    expect(rows?.n).toBe(1);

    const streak = await env.DB.prepare(
      "SELECT current, last_completed_date FROM streaks WHERE user_habit_id = ?",
    )
      .bind(userHabitId)
      .first<{ current: number; last_completed_date: string }>();
    expect(streak?.current).toBe(1);
    expect(streak?.last_completed_date).toBe("2026-07-14");
  });

  it("counts a check-off for the day it was made, not the day it synced", async () => {
    const userId = await createUser();
    const userHabitId = await adopt(userId);
    const { token } = await createSession(env.DB, userId);

    // Tuesday's tap, flushed after Wednesday's had already landed.
    await replay(token, userHabitId, "2026-07-15");
    await replay(token, userHabitId, "2026-07-14");

    const { results } = await env.DB.prepare(
      "SELECT local_date FROM checkins WHERE user_habit_id = ? ORDER BY local_date",
    )
      .bind(userHabitId)
      .all<{ local_date: string }>();

    expect(results.map((r) => r.local_date)).toEqual(["2026-07-14", "2026-07-15"]);
  });

  it("does not let a late arrival damage a healthy streak", async () => {
    const userId = await createUser();
    const userHabitId = await adopt(userId);
    const { token } = await createSession(env.DB, userId);

    await replay(token, userHabitId, "2026-07-14");
    await replay(token, userHabitId, "2026-07-15");
    const before = await env.DB.prepare("SELECT current FROM streaks WHERE user_habit_id = ?")
      .bind(userHabitId)
      .first<{ current: number }>();
    expect(before?.current).toBe(2);

    // An old queued item shows up out of order.
    const late = await replay(token, userHabitId, "2026-07-10");

    expect((await late.json<{ outcome: string }>()).outcome).toBe("noop");
    const after = await env.DB.prepare("SELECT current FROM streaks WHERE user_habit_id = ?")
      .bind(userHabitId)
      .first<{ current: number }>();
    expect(after?.current).toBe(2);
  });

  it("refuses a replayed check-in for someone else's habit", async () => {
    const userA = await createUser();
    const userB = await createUser();
    const usersBHabit = await adopt(userB);
    const { token: tokenA } = await createSession(env.DB, userA);

    const res = await replay(tokenA, usersBHabit, "2026-07-14");

    expect(res.status).toBe(404);
    const rows = await env.DB.prepare("SELECT COUNT(*) AS n FROM checkins WHERE user_habit_id = ?")
      .bind(usersBHabit)
      .first<{ n: number }>();
    expect(rows?.n).toBe(0);
  });

  it("rejects a malformed local date rather than storing it", async () => {
    const userId = await createUser();
    const userHabitId = await adopt(userId);
    const { token } = await createSession(env.DB, userId);

    const res = await SELF.fetch(
      `https://example.com/api/user-habits/${userHabitId}/checkin`,
      {
        method: "POST",
        headers: { Cookie: `habit_session=${token}`, "Content-Type": "application/json" },
        body: JSON.stringify({ local_date: "last tuesday" }),
      },
    );

    expect(res.status).toBe(400);
    const rows = await env.DB.prepare("SELECT COUNT(*) AS n FROM checkins WHERE user_habit_id = ?")
      .bind(userHabitId)
      .first<{ n: number }>();
    expect(rows?.n).toBe(0);
  });
});
