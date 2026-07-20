import { SELF, env } from "cloudflare:test";
import { beforeEach, describe, expect, it } from "vitest";
import { createSession } from "../src/worker/session";

async function createUser(timezone = "UTC"): Promise<string> {
  const id = crypto.randomUUID();
  await env.DB.prepare("INSERT INTO users (id, email, display_name, timezone) VALUES (?, ?, ?, ?)")
    .bind(id, `${id}@example.com`, "Tester", timezone)
    .run();
  return id;
}

async function seedHabits(count = 8): Promise<string[]> {
  const ids: string[] = [];

  for (let index = 1; index <= count; index += 1) {
    const id = `habit-${index}`;
    ids.push(id);
    await env.DB.prepare(
      `INSERT INTO habits (id, library_version, title, category, tags, identity_statement,
         tiny_version, standard_version, time_of_day, duration_minutes, difficulty,
         frequency_default, stack_anchors)
       VALUES (?, 1, ?, 'Exercise & Movement', '[]', ?, 'Tiny', 'Standard', 'morning', 10, 1, 'daily', '[]')`,
    )
      .bind(id, `Habit ${index}`, `I'm someone who does habit ${index}`)
      .run();
  }

  return ids;
}

async function adoptViaApi(token: string, habitId: string): Promise<Response> {
  return SELF.fetch(`https://example.com/api/habits/${habitId}/adopt`, {
    method: "POST",
    headers: { Cookie: `habit_session=${token}` },
  });
}

describe("POST /api/habits/:id/adopt", () => {
  beforeEach(async () => {
    await seedHabits();
  });

  it("returns 401 without a session", async () => {
    const res = await SELF.fetch("https://example.com/api/habits/habit-1/adopt", { method: "POST" });
    expect(res.status).toBe(401);
  });

  it("creates a user_habits row at the tiny level", async () => {
    const userId = await createUser();
    const { token } = await createSession(env.DB, userId);

    const res = await adoptViaApi(token, "habit-1");

    expect(res.status).toBe(201);
    const row = await env.DB.prepare(
      "SELECT habit_id, level, archived_at FROM user_habits WHERE user_id = ?",
    )
      .bind(userId)
      .first<{ habit_id: string; level: string; archived_at: string | null }>();

    expect(row?.habit_id).toBe("habit-1");
    expect(row?.level).toBe("tiny");
    expect(row?.archived_at).toBeNull();
  });

  it("creates the streak zeroed but with the repair already available", async () => {
    const userId = await createUser();
    const { token } = await createSession(env.DB, userId);

    await adoptViaApi(token, "habit-1");

    const row = await env.DB.prepare(
      `SELECT s.current, s.best, s.last_completed_date, s.repair_available, s.consecutive_since_repair
         FROM streaks s JOIN user_habits uh ON uh.id = s.user_habit_id
        WHERE uh.user_id = ?`,
    )
      .bind(userId)
      .first<{
        current: number;
        best: number;
        last_completed_date: string | null;
        repair_available: number;
        consecutive_since_repair: number;
      }>();

    expect(row?.current).toBe(0);
    expect(row?.best).toBe(0);
    expect(row?.last_completed_date).toBeNull();
    // The safety net is a promise from day one, not a reward to be earned.
    expect(row?.repair_available).toBe(1);
    expect(row?.consecutive_since_repair).toBe(0);
  });

  it("returns 404 for a habit that does not exist", async () => {
    const userId = await createUser();
    const { token } = await createSession(env.DB, userId);

    const res = await adoptViaApi(token, "no-such-habit");

    expect(res.status).toBe(404);
  });

  it("allows five active habits and rejects the sixth", async () => {
    const userId = await createUser();
    const { token } = await createSession(env.DB, userId);

    for (let index = 1; index <= 5; index += 1) {
      const res = await adoptViaApi(token, `habit-${index}`);
      expect(res.status).toBe(201);
    }

    const sixth = await adoptViaApi(token, "habit-6");

    expect(sixth.status).toBe(409);
    const body = await sixth.json<{ error: string }>();
    expect(body.error).toBe("habit_cap_reached");
  });

  it("counts only active habits against the cap, so archiving frees a slot", async () => {
    const userId = await createUser();
    const { token } = await createSession(env.DB, userId);

    for (let index = 1; index <= 5; index += 1) {
      await adoptViaApi(token, `habit-${index}`);
    }
    await env.DB.prepare(
      "UPDATE user_habits SET archived_at = datetime('now') WHERE user_id = ? AND habit_id = 'habit-1'",
    )
      .bind(userId)
      .run();

    const res = await adoptViaApi(token, "habit-6");

    expect(res.status).toBe(201);
  });

  it("refuses to adopt the same habit twice", async () => {
    const userId = await createUser();
    const { token } = await createSession(env.DB, userId);

    await adoptViaApi(token, "habit-1");
    const again = await adoptViaApi(token, "habit-1");

    expect(again.status).toBe(409);
    const body = await again.json<{ error: string }>();
    expect(body.error).toBe("already_adopted");

    const row = await env.DB.prepare(
      "SELECT COUNT(*) AS n FROM user_habits WHERE user_id = ? AND habit_id = 'habit-1'",
    )
      .bind(userId)
      .first<{ n: number }>();
    expect(row?.n).toBe(1);
  });

  it("marks the most recent suggestion of that habit as adopted", async () => {
    const userId = await createUser();
    const { token } = await createSession(env.DB, userId);

    await env.DB.prepare(
      "INSERT INTO suggestion_log (id, user_id, habit_id, score, score_breakdown, shown_at, local_date) VALUES (?, ?, 'habit-1', 5.0, '{}', '2026-07-14 08:00:00', '2026-07-14')",
    )
      .bind(crypto.randomUUID(), userId)
      .run();
    await env.DB.prepare(
      "INSERT INTO suggestion_log (id, user_id, habit_id, score, score_breakdown, shown_at, local_date) VALUES (?, ?, 'habit-1', 5.0, '{}', '2026-07-15 08:00:00', '2026-07-15')",
    )
      .bind(crypto.randomUUID(), userId)
      .run();

    await adoptViaApi(token, "habit-1");

    const { results } = await env.DB.prepare(
      "SELECT local_date, outcome FROM suggestion_log WHERE user_id = ? ORDER BY shown_at",
    )
      .bind(userId)
      .all<{ local_date: string; outcome: string | null }>();

    expect(results.map((r) => r.outcome)).toEqual([null, "adopted"]);
  });

  it("adopts for the session's user only — user A cannot adopt into user B's account", async () => {
    const userA = await createUser();
    const userB = await createUser();
    const { token: tokenA } = await createSession(env.DB, userA);

    const res = await SELF.fetch(`https://example.com/api/habits/habit-1/adopt?userId=${userB}`, {
      method: "POST",
      headers: { Cookie: `habit_session=${tokenA}` },
    });

    expect(res.status).toBe(201);

    const forA = await env.DB.prepare("SELECT COUNT(*) AS n FROM user_habits WHERE user_id = ?")
      .bind(userA)
      .first<{ n: number }>();
    const forB = await env.DB.prepare("SELECT COUNT(*) AS n FROM user_habits WHERE user_id = ?")
      .bind(userB)
      .first<{ n: number }>();

    expect(forA?.n).toBe(1);
    expect(forB?.n).toBe(0);
  });

  it("counts each user's habits separately against the cap", async () => {
    const userA = await createUser();
    const userB = await createUser();
    const { token: tokenA } = await createSession(env.DB, userA);
    const { token: tokenB } = await createSession(env.DB, userB);

    for (let index = 1; index <= 5; index += 1) {
      await adoptViaApi(tokenA, `habit-${index}`);
    }

    // B is at zero habits; A being full must not block them.
    const res = await adoptViaApi(tokenB, "habit-1");

    expect(res.status).toBe(201);
  });
});

describe("POST /api/habits/:id/dismiss", () => {
  beforeEach(async () => {
    await seedHabits();
  });

  it("returns 401 without a session", async () => {
    const res = await SELF.fetch("https://example.com/api/habits/habit-1/dismiss", {
      method: "POST",
    });
    expect(res.status).toBe(401);
  });

  it("marks the open suggestion as dismissed so the engine stops offering it", async () => {
    const userId = await createUser();
    const { token } = await createSession(env.DB, userId);
    await env.DB.prepare(
      "INSERT INTO suggestion_log (id, user_id, habit_id, score, score_breakdown, shown_at, local_date) VALUES (?, ?, 'habit-1', 5.0, '{}', '2026-07-15 08:00:00', '2026-07-15')",
    )
      .bind(crypto.randomUUID(), userId)
      .run();

    const res = await SELF.fetch("https://example.com/api/habits/habit-1/dismiss", {
      method: "POST",
      headers: { Cookie: `habit_session=${token}` },
    });

    expect(res.status).toBe(200);
    const row = await env.DB.prepare(
      "SELECT outcome FROM suggestion_log WHERE user_id = ? AND habit_id = 'habit-1'",
    )
      .bind(userId)
      .first<{ outcome: string | null }>();
    expect(row?.outcome).toBe("dismissed");
  });

  it("cannot dismiss another user's suggestion", async () => {
    const userA = await createUser();
    const userB = await createUser();
    const { token: tokenA } = await createSession(env.DB, userA);
    await env.DB.prepare(
      "INSERT INTO suggestion_log (id, user_id, habit_id, score, score_breakdown, shown_at, local_date) VALUES (?, ?, 'habit-1', 5.0, '{}', '2026-07-15 08:00:00', '2026-07-15')",
    )
      .bind(crypto.randomUUID(), userB)
      .run();

    await SELF.fetch("https://example.com/api/habits/habit-1/dismiss", {
      method: "POST",
      headers: { Cookie: `habit_session=${tokenA}` },
    });

    const row = await env.DB.prepare("SELECT outcome FROM suggestion_log WHERE user_id = ?")
      .bind(userB)
      .first<{ outcome: string | null }>();
    expect(row?.outcome).toBeNull();
  });
});
