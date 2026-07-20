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

async function seedHabit(id: string): Promise<void> {
  await env.DB.prepare(
    `INSERT INTO habits (id, library_version, title, category, tags, identity_statement,
       tiny_version, standard_version, time_of_day, duration_minutes, difficulty,
       frequency_default, stack_anchors)
     VALUES (?, 1, 'Walk', 'Exercise & Movement', '[]', 'I move', 'Tiny', 'Standard', 'morning', 10, 1, 'daily', '[]')`,
  )
    .bind(id)
    .run();
}

/** Adopt directly so these tests exercise check-off, not the adopt route. */
async function adopt(userId: string, habitId: string): Promise<string> {
  const userHabitId = crypto.randomUUID();
  await env.DB.batch([
    env.DB.prepare(
      "INSERT INTO user_habits (id, user_id, habit_id, level) VALUES (?, ?, ?, 'tiny')",
    ).bind(userHabitId, userId, habitId),
    env.DB.prepare(
      "INSERT INTO streaks (user_habit_id, current, best, last_completed_date, repair_available, consecutive_since_repair) VALUES (?, 0, 0, NULL, 1, 0)",
    ).bind(userHabitId),
  ]);
  return userHabitId;
}

async function setStreak(
  userHabitId: string,
  fields: { current: number; best: number; last: string | null; repair: number },
): Promise<void> {
  await env.DB.prepare(
    "UPDATE streaks SET current = ?, best = ?, last_completed_date = ?, repair_available = ? WHERE user_habit_id = ?",
  )
    .bind(fields.current, fields.best, fields.last, fields.repair, userHabitId)
    .run();
}

async function readStreak(userHabitId: string) {
  return env.DB.prepare(
    "SELECT current, best, last_completed_date, repair_available FROM streaks WHERE user_habit_id = ?",
  )
    .bind(userHabitId)
    .first<{
      current: number;
      best: number;
      last_completed_date: string | null;
      repair_available: number;
    }>();
}

function checkinUrl(userHabitId: string): string {
  return `https://example.com/api/user-habits/${userHabitId}/checkin`;
}

async function postCheckin(token: string, userHabitId: string): Promise<Response> {
  return SELF.fetch(checkinUrl(userHabitId), {
    method: "POST",
    headers: { Cookie: `habit_session=${token}` },
  });
}

async function deleteCheckin(token: string, userHabitId: string): Promise<Response> {
  return SELF.fetch(checkinUrl(userHabitId), {
    method: "DELETE",
    headers: { Cookie: `habit_session=${token}` },
  });
}

/** Today in UTC, which is the timezone these fixtures use unless stated. */
function todayUtc(): string {
  return new Date().toISOString().slice(0, 10);
}

function daysAgo(n: number): string {
  return new Date(Date.now() - n * 86_400_000).toISOString().slice(0, 10);
}

describe("POST /api/user-habits/:id/checkin", () => {
  it("returns 401 without a session", async () => {
    const res = await SELF.fetch(checkinUrl("whatever"), { method: "POST" });
    expect(res.status).toBe(401);
  });

  it("records the check-in and starts the streak", async () => {
    const userId = await createUser();
    await seedHabit("habit-1");
    const userHabitId = await adopt(userId, "habit-1");
    const { token } = await createSession(env.DB, userId);

    const res = await postCheckin(token, userHabitId);

    expect(res.status).toBe(200);
    const body = await res.json<{ outcome: string; streak: { current: number } }>();
    expect(body.outcome).toBe("incremented");
    expect(body.streak.current).toBe(1);

    const streak = await readStreak(userHabitId);
    expect(streak?.current).toBe(1);
    expect(streak?.last_completed_date).toBe(todayUtc());
  });

  it("increments an existing streak from yesterday", async () => {
    const userId = await createUser();
    await seedHabit("habit-1");
    const userHabitId = await adopt(userId, "habit-1");
    await setStreak(userHabitId, { current: 4, best: 9, last: daysAgo(1), repair: 1 });
    const { token } = await createSession(env.DB, userId);

    const res = await postCheckin(token, userHabitId);

    const body = await res.json<{ outcome: string; streak: { current: number } }>();
    expect(body.outcome).toBe("incremented");
    expect(body.streak.current).toBe(5);
  });

  it("is idempotent for the same local date — one row, one increment", async () => {
    const userId = await createUser();
    await seedHabit("habit-1");
    const userHabitId = await adopt(userId, "habit-1");
    const { token } = await createSession(env.DB, userId);

    await postCheckin(token, userHabitId);
    const second = await postCheckin(token, userHabitId);

    expect(second.status).toBe(200);
    const body = await second.json<{ outcome: string }>();
    expect(body.outcome).toBe("noop");

    const rows = await env.DB.prepare(
      "SELECT COUNT(*) AS n FROM checkins WHERE user_habit_id = ?",
    )
      .bind(userHabitId)
      .first<{ n: number }>();
    expect(rows?.n).toBe(1);

    const streak = await readStreak(userHabitId);
    expect(streak?.current).toBe(1);
  });

  it("repairs a single missed day and says so, so the UI can celebrate it", async () => {
    const userId = await createUser();
    await seedHabit("habit-1");
    const userHabitId = await adopt(userId, "habit-1");
    await setStreak(userHabitId, { current: 4, best: 9, last: daysAgo(2), repair: 1 });
    const { token } = await createSession(env.DB, userId);

    const res = await postCheckin(token, userHabitId);

    const body = await res.json<{ outcome: string; streak: { current: number } }>();
    expect(body.outcome).toBe("repaired");
    expect(body.streak.current).toBe(5);

    const streak = await readStreak(userHabitId);
    expect(streak?.repair_available).toBe(0);
  });

  it("reports a reset when the streak could not be saved", async () => {
    const userId = await createUser();
    await seedHabit("habit-1");
    const userHabitId = await adopt(userId, "habit-1");
    await setStreak(userHabitId, { current: 12, best: 12, last: daysAgo(5), repair: 1 });
    const { token } = await createSession(env.DB, userId);

    const res = await postCheckin(token, userHabitId);

    const body = await res.json<{ outcome: string; streak: { current: number; best: number } }>();
    expect(body.outcome).toBe("reset");
    expect(body.streak.current).toBe(1);
    expect(body.streak.best).toBe(12);
  });

  it("computes the local date in the user's timezone", async () => {
    // Auckland is 12 hours ahead of UTC, so its local date can already be
    // tomorrow while the server is still on today.
    const userId = await createUser("Pacific/Auckland");
    await seedHabit("habit-1");
    const userHabitId = await adopt(userId, "habit-1");
    const { token } = await createSession(env.DB, userId);

    await postCheckin(token, userHabitId);

    const row = await env.DB.prepare("SELECT local_date FROM checkins WHERE user_habit_id = ?")
      .bind(userHabitId)
      .first<{ local_date: string }>();

    const aucklandToday = new Intl.DateTimeFormat("en-CA", {
      timeZone: "Pacific/Auckland",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).format(new Date());
    expect(row?.local_date).toBe(aucklandToday);
  });

  it("returns 404 for a user_habit belonging to someone else", async () => {
    const userA = await createUser();
    const userB = await createUser();
    await seedHabit("habit-1");
    const usersBHabit = await adopt(userB, "habit-1");
    const { token: tokenA } = await createSession(env.DB, userA);

    const res = await postCheckin(tokenA, usersBHabit);

    expect(res.status).toBe(404);

    const rows = await env.DB.prepare("SELECT COUNT(*) AS n FROM checkins WHERE user_habit_id = ?")
      .bind(usersBHabit)
      .first<{ n: number }>();
    expect(rows?.n).toBe(0);
  });

  it("returns 404 for an unknown user_habit id", async () => {
    const userId = await createUser();
    const { token } = await createSession(env.DB, userId);

    const res = await postCheckin(token, crypto.randomUUID());

    expect(res.status).toBe(404);
  });
});

describe("DELETE /api/user-habits/:id/checkin", () => {
  it("removes today's check-in and restores the previous streak", async () => {
    const userId = await createUser();
    await seedHabit("habit-1");
    const userHabitId = await adopt(userId, "habit-1");
    const { token } = await createSession(env.DB, userId);

    // Two consecutive days, then undo today's.
    await env.DB.prepare("INSERT INTO checkins (id, user_habit_id, local_date) VALUES (?, ?, ?)")
      .bind(crypto.randomUUID(), userHabitId, daysAgo(1))
      .run();
    await setStreak(userHabitId, { current: 1, best: 1, last: daysAgo(1), repair: 1 });

    await postCheckin(token, userHabitId);
    expect((await readStreak(userHabitId))?.current).toBe(2);

    const res = await deleteCheckin(token, userHabitId);

    expect(res.status).toBe(200);
    const streak = await readStreak(userHabitId);
    expect(streak?.current).toBe(1);
    expect(streak?.last_completed_date).toBe(daysAgo(1));

    const rows = await env.DB.prepare("SELECT COUNT(*) AS n FROM checkins WHERE user_habit_id = ?")
      .bind(userHabitId)
      .first<{ n: number }>();
    expect(rows?.n).toBe(1);
  });

  it("returns the streak to zero when undoing the only check-in", async () => {
    const userId = await createUser();
    await seedHabit("habit-1");
    const userHabitId = await adopt(userId, "habit-1");
    const { token } = await createSession(env.DB, userId);

    await postCheckin(token, userHabitId);
    await deleteCheckin(token, userHabitId);

    const streak = await readStreak(userHabitId);
    expect(streak?.current).toBe(0);
    expect(streak?.last_completed_date).toBeNull();
    expect(streak?.repair_available).toBe(1);
  });

  it("gives back a repair that today's check-in had consumed", async () => {
    const userId = await createUser();
    await seedHabit("habit-1");
    const userHabitId = await adopt(userId, "habit-1");
    const { token } = await createSession(env.DB, userId);

    await env.DB.prepare("INSERT INTO checkins (id, user_habit_id, local_date) VALUES (?, ?, ?)")
      .bind(crypto.randomUUID(), userHabitId, daysAgo(2))
      .run();
    await setStreak(userHabitId, { current: 3, best: 3, last: daysAgo(2), repair: 1 });

    await postCheckin(token, userHabitId);
    expect((await readStreak(userHabitId))?.repair_available).toBe(0);

    await deleteCheckin(token, userHabitId);

    expect((await readStreak(userHabitId))?.repair_available).toBe(1);
  });

  it("is harmless when there is nothing to undo", async () => {
    const userId = await createUser();
    await seedHabit("habit-1");
    const userHabitId = await adopt(userId, "habit-1");
    const { token } = await createSession(env.DB, userId);

    const res = await deleteCheckin(token, userHabitId);

    expect(res.status).toBe(200);
    const streak = await readStreak(userHabitId);
    expect(streak?.current).toBe(0);
  });

  it("returns 404 when undoing someone else's check-in", async () => {
    const userA = await createUser();
    const userB = await createUser();
    await seedHabit("habit-1");
    const usersBHabit = await adopt(userB, "habit-1");
    const { token: tokenB } = await createSession(env.DB, userB);
    await postCheckin(tokenB, usersBHabit);

    const { token: tokenA } = await createSession(env.DB, userA);
    const res = await deleteCheckin(tokenA, usersBHabit);

    expect(res.status).toBe(404);

    const rows = await env.DB.prepare("SELECT COUNT(*) AS n FROM checkins WHERE user_habit_id = ?")
      .bind(usersBHabit)
      .first<{ n: number }>();
    expect(rows?.n).toBe(1);
  });
});
