import { SELF, env } from "cloudflare:test";
import { beforeEach, describe, expect, it } from "vitest";
import { CATEGORIES } from "../src/shared/habit";
import { createSession } from "../src/worker/session";
import { getSuggestions } from "../src/worker/suggestions";

/** 08:00 UTC — the "morning" bucket for a UTC user. */
const NOW = new Date("2026-07-15T08:00:00Z");

async function createUser(timezone = "UTC"): Promise<string> {
  const id = crypto.randomUUID();
  const email = `${id}@example.com`;
  await env.DB.prepare("INSERT INTO users (id, email, display_name, timezone) VALUES (?, ?, ?, ?)")
    .bind(id, email, "Tester", timezone)
    .run();
  return id;
}

/**
 * Six habits identical in every scoring input but their id and category, so
 * every candidate scores the same and selection is decided purely by the
 * id-ascending tie-break. Any reordering in a test is therefore caused by the
 * thing that test changed, not by fixture noise.
 */
const CATEGORIES_IN_ID_ORDER = [
  "Exercise & Movement",
  "Sleep & Rest",
  "Home & Housework",
  "Money & Admin",
  "Work & Focus",
  "Learning & Growth",
];

async function seedHabits(): Promise<string[]> {
  const ids: string[] = [];

  for (const [index, category] of CATEGORIES_IN_ID_ORDER.entries()) {
    const id = `habit-${index + 1}`;
    ids.push(id);
    await env.DB.prepare(
      `INSERT INTO habits (id, library_version, title, category, tags, identity_statement,
         tiny_version, standard_version, time_of_day, duration_minutes, difficulty,
         frequency_default, stack_anchors)
       VALUES (?, 1, ?, ?, '[]', ?, 'Tiny', 'Standard', 'morning', 10, 1, 'daily', '[]')`,
    )
      .bind(id, `Habit ${index + 1}`, category, `I'm someone who does habit ${index + 1}`)
      .run();
  }

  return ids;
}

async function adopt(userId: string, habitId: string): Promise<string> {
  const userHabitId = crypto.randomUUID();
  await env.DB.prepare("INSERT INTO user_habits (id, user_id, habit_id, level) VALUES (?, ?, ?, 'tiny')")
    .bind(userHabitId, userId, habitId)
    .run();
  return userHabitId;
}

describe("getSuggestions", () => {
  beforeEach(async () => {
    await seedHabits();
  });

  it("returns exactly three suggestions", async () => {
    const userId = await createUser();

    const suggestions = await getSuggestions(env.DB, userId, NOW);

    expect(suggestions).toHaveLength(3);
  });

  it("breaks ties by habit id ascending", async () => {
    const userId = await createUser();

    const suggestions = await getSuggestions(env.DB, userId, NOW);

    expect(suggestions.map((s) => s.habit.id)).toEqual(["habit-1", "habit-2", "habit-3"]);
  });

  it("never suggests a habit the user has already adopted", async () => {
    const userId = await createUser();
    await adopt(userId, "habit-1");

    const suggestions = await getSuggestions(env.DB, userId, NOW);

    expect(suggestions.map((s) => s.habit.id)).not.toContain("habit-1");
    expect(suggestions.map((s) => s.habit.id)).toEqual(["habit-2", "habit-3", "habit-4"]);
  });

  it("suggests a habit again once the user has archived it", async () => {
    const userId = await createUser();
    const userHabitId = await adopt(userId, "habit-1");
    await env.DB.prepare("UPDATE user_habits SET archived_at = datetime('now') WHERE id = ?")
      .bind(userHabitId)
      .run();

    const suggestions = await getSuggestions(env.DB, userId, NOW);

    expect(suggestions.map((s) => s.habit.id)).toContain("habit-1");
  });

  it("is deterministic — two users in identical states get identical suggestions", async () => {
    const userA = await createUser();
    const userB = await createUser();

    const first = await getSuggestions(env.DB, userA, NOW);
    const second = await getSuggestions(env.DB, userB, NOW);

    expect(second.map((s) => s.habit.id)).toEqual(first.map((s) => s.habit.id));
    expect(second.map((s) => s.score)).toEqual(first.map((s) => s.score));
  });

  it("writes one suggestion_log row per suggestion, each with a score breakdown", async () => {
    const userId = await createUser();

    const suggestions = await getSuggestions(env.DB, userId, NOW);

    const { results } = await env.DB.prepare(
      "SELECT habit_id, score, score_breakdown, outcome FROM suggestion_log WHERE user_id = ? ORDER BY habit_id",
    )
      .bind(userId)
      .all<{ habit_id: string; score: number; score_breakdown: string; outcome: string | null }>();

    expect(results).toHaveLength(3);
    expect(results.map((r) => r.habit_id)).toEqual(suggestions.map((s) => s.habit.id).sort());

    for (const row of results) {
      expect(row.score_breakdown).not.toBeNull();
      expect(row.outcome).toBeNull();
      const breakdown = JSON.parse(row.score_breakdown);
      expect(Object.keys(breakdown)).toContain("categoryFit");
      expect(breakdown.categoryFit).toBeGreaterThan(0);
    }
  });

  it("falls back to the default profile when the user has no profile row", async () => {
    const userId = await createUser();

    const suggestions = await getSuggestions(env.DB, userId, NOW);

    // Default profile scores every category at 50, so category fit is half-weight.
    expect(suggestions[0].breakdown.categoryFit).toBeCloseTo(1.5);
  });

  it("reads a stored profile in preference to the default", async () => {
    const userId = await createUser();
    // ProfileSchema is .strict() over all 12 categories — a partial map is
    // rejected and would silently fall back to the default profile.
    const profile = {
      category_scores: Object.fromEntries(
        CATEGORIES.map((c) => [c, c === "Work & Focus" ? 100 : 0]),
      ),
      capacity_minutes_per_day: 15,
      preferred_times: ["morning"],
      identity_goals: [],
      avoid_tags: [],
      notes: "",
    };

    await env.DB.prepare("INSERT INTO profiles (user_id, data) VALUES (?, ?)")
      .bind(userId, JSON.stringify(profile))
      .run();

    const suggestions = await getSuggestions(env.DB, userId, NOW);

    // "Work & Focus" (habit-5) is the only category scored above zero, so it
    // must outrank the id-ascending tie-break that would otherwise win.
    expect(suggestions[0].habit.id).toBe("habit-5");
  });

  it("falls back to the default profile when the stored profile is malformed", async () => {
    const userId = await createUser();
    await env.DB.prepare("INSERT INTO profiles (user_id, data) VALUES (?, ?)")
      .bind(userId, '{"category_scores": "not an object"}')
      .run();

    const suggestions = await getSuggestions(env.DB, userId, NOW);

    expect(suggestions).toHaveLength(3);
    expect(suggestions[0].breakdown.categoryFit).toBeCloseTo(1.5);
  });

  it("does not read another user's adoptions, suggestion log, or streaks", async () => {
    const userA = await createUser();
    const userB = await createUser();

    // Give B state that would visibly change A's results if it leaked: B has
    // adopted the habit A should be offered first, and has been shown the rest.
    await adopt(userB, "habit-1");
    for (const habitId of ["habit-2", "habit-3"]) {
      await env.DB.prepare(
        "INSERT INTO suggestion_log (id, user_id, habit_id, score, score_breakdown, shown_at, outcome) VALUES (?, ?, ?, 1.0, '{}', ?, 'dismissed')",
      )
        .bind(crypto.randomUUID(), userB, habitId, "2026-07-15 07:00:00")
        .run();
    }

    const suggestions = await getSuggestions(env.DB, userA, NOW);

    expect(suggestions.map((s) => s.habit.id)).toEqual(["habit-1", "habit-2", "habit-3"]);

    const { results } = await env.DB.prepare(
      "SELECT user_id FROM suggestion_log WHERE user_id = ?",
    )
      .bind(userA)
      .all<{ user_id: string }>();
    expect(results).toHaveLength(3);
  });

  it("penalises a habit the user previously dismissed", async () => {
    const userId = await createUser();
    await env.DB.prepare(
      "INSERT INTO suggestion_log (id, user_id, habit_id, score, score_breakdown, shown_at, outcome) VALUES (?, ?, 'habit-1', 1.0, '{}', ?, 'dismissed')",
    )
      .bind(crypto.randomUUID(), userId, "2026-07-01 08:00:00")
      .run();

    const suggestions = await getSuggestions(env.DB, userId, NOW);

    expect(suggestions.map((s) => s.habit.id)).not.toContain("habit-1");
  });

  it("treats a habit shown within the last 14 days as no longer novel", async () => {
    const userId = await createUser();
    await env.DB.prepare(
      "INSERT INTO suggestion_log (id, user_id, habit_id, score, score_breakdown, shown_at) VALUES (?, ?, 'habit-1', 1.0, '{}', ?)",
    )
      .bind(crypto.randomUUID(), userId, "2026-07-14 08:00:00")
      .run();

    const suggestions = await getSuggestions(env.DB, userId, NOW);

    expect(suggestions.map((s) => s.habit.id)).not.toContain("habit-1");
  });

  it("treats a habit shown more than 14 days ago as novel again", async () => {
    const userId = await createUser();
    await env.DB.prepare(
      "INSERT INTO suggestion_log (id, user_id, habit_id, score, score_breakdown, shown_at) VALUES (?, ?, 'habit-1', 1.0, '{}', ?)",
    )
      .bind(crypto.randomUUID(), userId, "2026-06-01 08:00:00")
      .run();

    const suggestions = await getSuggestions(env.DB, userId, NOW);

    expect(suggestions.map((s) => s.habit.id)).toContain("habit-1");
  });

  it("returns the same three, in the same order, when called again the same day", async () => {
    const userId = await createUser();

    const first = await getSuggestions(env.DB, userId, NOW);
    const second = await getSuggestions(env.DB, userId, new Date("2026-07-15T19:30:00Z"));

    expect(second.map((s) => s.habit.id)).toEqual(first.map((s) => s.habit.id));
    expect(second.map((s) => s.score)).toEqual(first.map((s) => s.score));
    expect(second.map((s) => s.breakdown)).toEqual(first.map((s) => s.breakdown));
  });

  it("does not log a second impression when replaying the same day's suggestions", async () => {
    const userId = await createUser();

    await getSuggestions(env.DB, userId, NOW);
    await getSuggestions(env.DB, userId, new Date("2026-07-15T19:30:00Z"));

    const row = await env.DB.prepare("SELECT COUNT(*) AS n FROM suggestion_log WHERE user_id = ?")
      .bind(userId)
      .first<{ n: number }>();

    expect(row?.n).toBe(3);
  });

  it("scores a fresh set once the user's local day rolls over", async () => {
    const userId = await createUser();

    const today = await getSuggestions(env.DB, userId, NOW);
    const tomorrow = await getSuggestions(env.DB, userId, new Date("2026-07-16T08:00:00Z"));

    // Yesterday's three are inside the 14-day novelty window now, so they lose
    // to the habits that have never been shown.
    expect(tomorrow.map((s) => s.habit.id)).toEqual(["habit-4", "habit-5", "habit-6"]);
    expect(tomorrow.map((s) => s.habit.id)).not.toEqual(today.map((s) => s.habit.id));
  });

  it("keys the day on the user's timezone, not UTC", async () => {
    // 19:00Z on the 15th is already the 16th in Auckland, so these two calls
    // straddle a local midnight and must not share a suggestion set.
    const userId = await createUser("Pacific/Auckland");

    const before = await getSuggestions(env.DB, userId, new Date("2026-07-15T08:00:00Z"));
    const after = await getSuggestions(env.DB, userId, new Date("2026-07-15T19:00:00Z"));

    expect(after.map((s) => s.habit.id)).not.toEqual(before.map((s) => s.habit.id));
  });

  it("drops a suggestion the user has acted on without reshuffling the rest", async () => {
    const userId = await createUser();

    const first = await getSuggestions(env.DB, userId, NOW);
    await env.DB.prepare(
      "UPDATE suggestion_log SET outcome = 'adopted' WHERE user_id = ? AND habit_id = ?",
    )
      .bind(userId, first[0].habit.id)
      .run();
    await adopt(userId, first[0].habit.id);

    const second = await getSuggestions(env.DB, userId, NOW);

    expect(second.map((s) => s.habit.id)).toEqual([first[1].habit.id, first[2].habit.id]);
  });

  it("computes the time bucket in the user's timezone, not the server's", async () => {
    // 08:00 UTC is 20:00 in Auckland — evening, so morning habits lose time_match.
    const aucklander = await createUser("Pacific/Auckland");

    const suggestions = await getSuggestions(env.DB, aucklander, NOW);

    expect(suggestions[0].breakdown.timeMatch).toBe(0);
  });
});

describe("GET /api/suggestions", () => {
  beforeEach(async () => {
    await seedHabits();
  });

  it("returns 401 without a session", async () => {
    const res = await SELF.fetch("https://example.com/api/suggestions");
    expect(res.status).toBe(401);
  });

  it("returns three suggestions for a signed-in user", async () => {
    const userId = await createUser();
    const { token } = await createSession(env.DB, userId);

    const res = await SELF.fetch("https://example.com/api/suggestions", {
      headers: { Cookie: `habit_session=${token}` },
    });

    expect(res.status).toBe(200);
    const body = await res.json<{
      suggestions: { habit: { id: string; title: string }; score: number }[];
    }>();
    expect(body.suggestions).toHaveLength(3);
    expect(body.suggestions[0].habit.title).toBeTruthy();
    expect(typeof body.suggestions[0].score).toBe("number");
  });

  it("scopes suggestions to the session's user, ignoring request input", async () => {
    const userA = await createUser();
    const userB = await createUser();
    await adopt(userA, "habit-1");
    const { token } = await createSession(env.DB, userA);

    const res = await SELF.fetch(`https://example.com/api/suggestions?userId=${userB}`, {
      headers: { Cookie: `habit_session=${token}` },
    });

    const body = await res.json<{ suggestions: { habit: { id: string } }[] }>();
    // A's own adoption still applies; B's identity in the query string is ignored.
    expect(body.suggestions.map((s) => s.habit.id)).not.toContain("habit-1");

    const { results } = await env.DB.prepare(
      "SELECT id FROM suggestion_log WHERE user_id = ?",
    )
      .bind(userB)
      .all();
    expect(results).toHaveLength(0);
  });
});
