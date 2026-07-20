import { SELF, env } from "cloudflare:test";
import { describe, expect, it } from "vitest";
import { createSession } from "../src/worker/session";

async function createUser(timezone = "UTC"): Promise<string> {
  const id = crypto.randomUUID();
  await env.DB.prepare("INSERT INTO users (id, email, display_name, timezone) VALUES (?, ?, ?, ?)")
    .bind(id, `${id}@example.com`, "Tester", timezone)
    .run();
  return id;
}

async function seedHabit(id: string, title: string, category = "Exercise & Movement"): Promise<void> {
  await env.DB.prepare(
    `INSERT INTO habits (id, library_version, title, category, tags, identity_statement,
       tiny_version, standard_version, ambitious_version, cue_suggestion, time_of_day,
       duration_minutes, difficulty, frequency_default, stack_anchors)
     VALUES (?, 1, ?, ?, '[]', 'I am someone who does this', 'One page', 'Fifteen minutes',
             'Thirty minutes', 'After coffee', 'morning', 10, 1, 'daily', '[]')`,
  )
    .bind(id, title, category)
    .run();
}

async function adopt(userId: string, habitId: string, level = "tiny"): Promise<string> {
  const userHabitId = crypto.randomUUID();
  await env.DB.batch([
    env.DB.prepare("INSERT INTO user_habits (id, user_id, habit_id, level) VALUES (?, ?, ?, ?)").bind(
      userHabitId,
      userId,
      habitId,
      level,
    ),
    env.DB.prepare(
      "INSERT INTO streaks (user_habit_id, current, best, last_completed_date, repair_available, consecutive_since_repair) VALUES (?, 0, 0, NULL, 1, 0)",
    ).bind(userHabitId),
  ]);
  return userHabitId;
}

interface TodayHabit {
  user_habit_id: string;
  habit_id: string;
  title: string;
  category: string;
  level: string;
  tiny_version: string;
  identity_statement: string;
  completed: boolean;
  streak: { current: number; best: number };
}

async function fetchToday(token: string): Promise<{ status: number; habits: TodayHabit[] }> {
  const res = await SELF.fetch("https://example.com/api/today", {
    headers: { Cookie: `habit_session=${token}` },
  });
  if (res.status !== 200) return { status: res.status, habits: [] };
  const body = await res.json<{ habits: TodayHabit[] }>();
  return { status: res.status, habits: body.habits };
}

describe("GET /api/today", () => {
  it("returns 401 without a session", async () => {
    const res = await SELF.fetch("https://example.com/api/today");
    expect(res.status).toBe(401);
  });

  it("returns an empty list for a user with no habits", async () => {
    const userId = await createUser();
    const { token } = await createSession(env.DB, userId);

    const { habits } = await fetchToday(token);

    expect(habits).toEqual([]);
  });

  it("returns an adopted habit as not completed", async () => {
    const userId = await createUser();
    await seedHabit("habit-1", "Walk around the block");
    const userHabitId = await adopt(userId, "habit-1");
    const { token } = await createSession(env.DB, userId);

    const { habits } = await fetchToday(token);

    expect(habits).toHaveLength(1);
    expect(habits[0].user_habit_id).toBe(userHabitId);
    expect(habits[0].habit_id).toBe("habit-1");
    expect(habits[0].title).toBe("Walk around the block");
    expect(habits[0].completed).toBe(false);
    expect(habits[0].level).toBe("tiny");
  });

  it("returns a checked-off habit as completed", async () => {
    const userId = await createUser();
    await seedHabit("habit-1", "Walk around the block");
    const userHabitId = await adopt(userId, "habit-1");
    const { token } = await createSession(env.DB, userId);

    await SELF.fetch(`https://example.com/api/user-habits/${userHabitId}/checkin`, {
      method: "POST",
      headers: { Cookie: `habit_session=${token}` },
    });

    const { habits } = await fetchToday(token);

    expect(habits[0].completed).toBe(true);
    expect(habits[0].streak.current).toBe(1);
  });

  it("does not count yesterday's check-in as today's completion", async () => {
    const userId = await createUser();
    await seedHabit("habit-1", "Walk");
    const userHabitId = await adopt(userId, "habit-1");
    const yesterday = new Date(Date.now() - 86_400_000).toISOString().slice(0, 10);
    await env.DB.prepare("INSERT INTO checkins (id, user_habit_id, local_date) VALUES (?, ?, ?)")
      .bind(crypto.randomUUID(), userHabitId, yesterday)
      .run();
    const { token } = await createSession(env.DB, userId);

    const { habits } = await fetchToday(token);

    expect(habits[0].completed).toBe(false);
  });

  it("carries the level the habit was adopted at", async () => {
    const userId = await createUser();
    await seedHabit("habit-1", "Read");
    await adopt(userId, "habit-1", "standard");
    const { token } = await createSession(env.DB, userId);

    const { habits } = await fetchToday(token);

    expect(habits[0].level).toBe("standard");
  });

  it("carries the current and best streak", async () => {
    const userId = await createUser();
    await seedHabit("habit-1", "Read");
    const userHabitId = await adopt(userId, "habit-1");
    await env.DB.prepare("UPDATE streaks SET current = 6, best = 22 WHERE user_habit_id = ?")
      .bind(userHabitId)
      .run();
    const { token } = await createSession(env.DB, userId);

    const { habits } = await fetchToday(token);

    expect(habits[0].streak.current).toBe(6);
    expect(habits[0].streak.best).toBe(22);
  });

  it("carries the habit copy the card needs to render", async () => {
    const userId = await createUser();
    await seedHabit("habit-1", "Read before bed", "Learning & Growth");
    await adopt(userId, "habit-1");
    const { token } = await createSession(env.DB, userId);

    const { habits } = await fetchToday(token);

    expect(habits[0].category).toBe("Learning & Growth");
    expect(habits[0].tiny_version).toBe("One page");
    expect(habits[0].identity_statement).toBe("I am someone who does this");
  });

  it("excludes archived habits", async () => {
    const userId = await createUser();
    await seedHabit("habit-1", "Kept");
    await seedHabit("habit-2", "Archived");
    await adopt(userId, "habit-1");
    const archivedId = await adopt(userId, "habit-2");
    await env.DB.prepare("UPDATE user_habits SET archived_at = datetime('now') WHERE id = ?")
      .bind(archivedId)
      .run();
    const { token } = await createSession(env.DB, userId);

    const { habits } = await fetchToday(token);

    expect(habits).toHaveLength(1);
    expect(habits[0].title).toBe("Kept");
  });

  it("shows the caller none of another user's habits", async () => {
    const userA = await createUser();
    const userB = await createUser();
    await seedHabit("habit-1", "A's habit");
    await seedHabit("habit-2", "B's habit");
    await adopt(userA, "habit-1");
    await adopt(userB, "habit-2");
    const { token: tokenA } = await createSession(env.DB, userA);

    const { habits } = await fetchToday(tokenA);

    expect(habits).toHaveLength(1);
    expect(habits[0].title).toBe("A's habit");
  });

  it("computes today in the user's timezone", async () => {
    // Auckland is ahead of UTC, so a check-in recorded for Auckland's today
    // must read as completed even when UTC is still on the previous date.
    const userId = await createUser("Pacific/Auckland");
    await seedHabit("habit-1", "Walk");
    const userHabitId = await adopt(userId, "habit-1");
    const aucklandToday = new Intl.DateTimeFormat("en-CA", {
      timeZone: "Pacific/Auckland",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).format(new Date());
    await env.DB.prepare("INSERT INTO checkins (id, user_habit_id, local_date) VALUES (?, ?, ?)")
      .bind(crypto.randomUUID(), userHabitId, aucklandToday)
      .run();
    const { token } = await createSession(env.DB, userId);

    const { habits } = await fetchToday(token);

    expect(habits[0].completed).toBe(true);
  });
});
