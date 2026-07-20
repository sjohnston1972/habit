import { SELF, env } from "cloudflare:test";
import { describe, expect, it } from "vitest";
import { CATEGORIES } from "../src/shared/habit";
import { ProfileSchema } from "../src/shared/profile";
import { createSession } from "../src/worker/session";
import { MAX_SESSIONS_PER_DAY, QUESTIONS, onboardingTurn } from "../src/worker/onboarding";

async function createUser(): Promise<string> {
  const id = crypto.randomUUID();
  await env.DB.prepare("INSERT INTO users (id, email, display_name, timezone) VALUES (?, ?, ?, ?)")
    .bind(id, `${id}@example.com`, "Tester", "UTC")
    .run();
  return id;
}

/** A stand-in for the model, so the interview flow is testable without the network. */
function fakeClient(tokens = 120) {
  return {
    create: async () => ({
      profile: {
        category_scores: Object.fromEntries(CATEGORIES.map((c) => [c, 50])),
        capacity_minutes_per_day: 20,
        preferred_times: ["morning"],
        identity_goals: ["healthier"],
        avoid_tags: [],
        notes: "",
      },
      tokens,
    }),
  };
}

/** Walk the whole interview, returning the final result. */
async function completeInterview(userId: string, client = fakeClient()) {
  const now = new Date();
  let result = await onboardingTurn({ db: env.DB, userId, client, now });
  if (!result.ok) return result;

  const sessionId = result.sessionId;

  for (let i = 0; i < QUESTIONS.length; i += 1) {
    result = await onboardingTurn({
      db: env.DB,
      userId,
      client,
      now,
      sessionId,
      answer: `answer ${i}`,
    });
    if (!result.ok) return result;
  }

  return result;
}

describe("the interview script", () => {
  it("asks between 8 and 12 questions, per CLAUDE.md §5", () => {
    expect(QUESTIONS.length).toBeGreaterThanOrEqual(8);
    expect(QUESTIONS.length).toBeLessThanOrEqual(12);
  });

  it("is tappable-first — every question offers options", () => {
    for (const question of QUESTIONS) {
      expect(question.options.length).toBeGreaterThan(0);
    }
  });

  it("offers free text where a canned option cannot capture the answer", () => {
    expect(QUESTIONS.some((q) => q.allowFreeText)).toBe(true);
  });

  it("uses unique question ids", () => {
    const ids = QUESTIONS.map((q) => q.id);
    expect(new Set(ids).size).toBe(ids.length);
  });
});

describe("onboardingTurn", () => {
  it("starts an interview and returns the first question", async () => {
    const userId = await createUser();

    const result = await onboardingTurn({
      db: env.DB,
      userId,
      client: fakeClient(),
      now: new Date(),
    });

    expect(result.ok).toBe(true);
    if (!result.ok || result.done) throw new Error("expected an open interview");
    expect(result.question.id).toBe(QUESTIONS[0].id);
    expect(result.index).toBe(0);
    expect(result.total).toBe(QUESTIONS.length);
  });

  it("walks through every question before finishing", async () => {
    const userId = await createUser();
    const client = fakeClient();
    const now = new Date();

    let result = await onboardingTurn({ db: env.DB, userId, client, now });
    if (!result.ok || result.done) throw new Error("expected an open interview");
    const sessionId = result.sessionId;

    const asked = [result.question.id];
    for (let i = 0; i < QUESTIONS.length - 1; i += 1) {
      result = await onboardingTurn({ db: env.DB, userId, client, now, sessionId, answer: "x" });
      if (!result.ok || result.done) throw new Error(`finished early at question ${i}`);
      asked.push(result.question.id);
    }

    expect(asked).toEqual(QUESTIONS.map((q) => q.id));
  });

  it("writes exactly one profile row and one qa_sessions row on completion", async () => {
    const userId = await createUser();

    const result = await completeInterview(userId);

    expect(result.ok).toBe(true);
    if (!result.ok || !result.done) throw new Error("expected a completed interview");

    const profiles = await env.DB.prepare("SELECT COUNT(*) AS n FROM profiles WHERE user_id = ?")
      .bind(userId)
      .first<{ n: number }>();
    const sessions = await env.DB.prepare("SELECT COUNT(*) AS n FROM qa_sessions WHERE user_id = ?")
      .bind(userId)
      .first<{ n: number }>();

    expect(profiles?.n).toBe(1);
    expect(sessions?.n).toBe(1);
  });

  it("records non-zero tokens_used so cost stays observable", async () => {
    const userId = await createUser();

    await completeInterview(userId, fakeClient(250));

    const row = await env.DB.prepare("SELECT tokens_used FROM qa_sessions WHERE user_id = ?")
      .bind(userId)
      .first<{ tokens_used: number }>();

    expect(row?.tokens_used).toBe(250);
  });

  it("stores a profile the suggestion engine can read back", async () => {
    const userId = await createUser();

    await completeInterview(userId);

    const row = await env.DB.prepare("SELECT data FROM profiles WHERE user_id = ?")
      .bind(userId)
      .first<{ data: string }>();

    expect(() => ProfileSchema.parse(JSON.parse(row!.data))).not.toThrow();
  });

  it("keeps the full transcript for later review", async () => {
    const userId = await createUser();

    await completeInterview(userId);

    const row = await env.DB.prepare("SELECT transcript FROM qa_sessions WHERE user_id = ?")
      .bind(userId)
      .first<{ transcript: string }>();
    const stored = JSON.parse(row!.transcript);

    expect(stored.answers).toHaveLength(QUESTIONS.length);
    expect(stored.answers[0].prompt).toBe(QUESTIONS[0].prompt);
    expect(stored.complete).toBe(true);
  });

  it("replaces the profile when the interview is run again", async () => {
    const userId = await createUser();

    await completeInterview(userId);
    await completeInterview(userId);

    const row = await env.DB.prepare("SELECT COUNT(*) AS n FROM profiles WHERE user_id = ?")
      .bind(userId)
      .first<{ n: number }>();

    expect(row?.n).toBe(1);
  });

  it("refuses a 4th interview in the same day", async () => {
    const userId = await createUser();
    const now = new Date();

    for (let i = 0; i < MAX_SESSIONS_PER_DAY; i += 1) {
      const started = await onboardingTurn({ db: env.DB, userId, client: fakeClient(), now });
      expect(started.ok).toBe(true);
    }

    const fourth = await onboardingTurn({ db: env.DB, userId, client: fakeClient(), now });

    expect(fourth.ok).toBe(false);
    if (fourth.ok) throw new Error("expected rate limiting");
    expect(fourth.reason).toBe("rate_limited");
  });

  it("counts each user's interviews separately against the cap", async () => {
    const userA = await createUser();
    const userB = await createUser();
    const now = new Date();

    for (let i = 0; i < MAX_SESSIONS_PER_DAY; i += 1) {
      await onboardingTurn({ db: env.DB, userId: userA, client: fakeClient(), now });
    }

    const forB = await onboardingTurn({ db: env.DB, userId: userB, client: fakeClient(), now });

    expect(forB.ok).toBe(true);
  });

  it("will not let user A resume user B's interview", async () => {
    const userA = await createUser();
    const userB = await createUser();
    const now = new Date();

    const started = await onboardingTurn({ db: env.DB, userId: userB, client: fakeClient(), now });
    if (!started.ok || started.done) throw new Error("expected an open interview");

    const stolen = await onboardingTurn({
      db: env.DB,
      userId: userA,
      client: fakeClient(),
      now,
      sessionId: started.sessionId,
      answer: "mine now",
    });

    expect(stolen.ok).toBe(false);
    if (stolen.ok) throw new Error("expected refusal");
    expect(stolen.reason).toBe("not_found");
  });

  it("refuses to reopen a completed interview", async () => {
    const userId = await createUser();
    const result = await completeInterview(userId);
    if (!result.ok || !result.done) throw new Error("expected a completed interview");

    const again = await onboardingTurn({
      db: env.DB,
      userId,
      client: fakeClient(),
      now: new Date(),
      sessionId: result.sessionId,
      answer: "one more",
    });

    expect(again.ok).toBe(false);
    if (again.ok) throw new Error("expected refusal");
    expect(again.reason).toBe("already_complete");
  });

  it("still writes a usable profile when the model fails entirely", async () => {
    const userId = await createUser();

    const result = await completeInterview(userId, {
      create: async () => {
        throw new Error("model unavailable");
      },
    });

    expect(result.ok).toBe(true);
    if (!result.ok || !result.done) throw new Error("expected a completed interview");
    expect(result.usedFallback).toBe(true);

    const row = await env.DB.prepare("SELECT data FROM profiles WHERE user_id = ?")
      .bind(userId)
      .first<{ data: string }>();
    expect(() => ProfileSchema.parse(JSON.parse(row!.data))).not.toThrow();
  });
});

describe("POST /api/onboarding/turn", () => {
  it("returns 401 without a session", async () => {
    const res = await SELF.fetch("https://example.com/api/onboarding/turn", { method: "POST" });
    expect(res.status).toBe(401);
  });

  it("starts an interview for a signed-in user", async () => {
    const userId = await createUser();
    const { token } = await createSession(env.DB, userId);

    const res = await SELF.fetch("https://example.com/api/onboarding/turn", {
      method: "POST",
      headers: { Cookie: `habit_session=${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({}),
    });

    expect(res.status).toBe(200);
    const body = await res.json<{ done: boolean; question: { id: string }; total: number }>();
    expect(body.done).toBe(false);
    expect(body.question.id).toBe(QUESTIONS[0].id);
    expect(body.total).toBe(QUESTIONS.length);
  });

  it("returns 429 for the 4th interview in a day", async () => {
    const userId = await createUser();
    const { token } = await createSession(env.DB, userId);

    const start = () =>
      SELF.fetch("https://example.com/api/onboarding/turn", {
        method: "POST",
        headers: { Cookie: `habit_session=${token}`, "Content-Type": "application/json" },
        body: JSON.stringify({}),
      });

    for (let i = 0; i < MAX_SESSIONS_PER_DAY; i += 1) {
      expect((await start()).status).toBe(200);
    }

    const fourth = await start();

    expect(fourth.status).toBe(429);
    const body = await fourth.json<{ error: string }>();
    expect(body.error).toBe("rate_limited");
  });

  it("cannot read another user's qa_sessions through the endpoint", async () => {
    const userA = await createUser();
    const userB = await createUser();
    const { token: tokenA } = await createSession(env.DB, userA);

    const started = await onboardingTurn({
      db: env.DB,
      userId: userB,
      client: fakeClient(),
      now: new Date(),
    });
    if (!started.ok || started.done) throw new Error("expected an open interview");

    const res = await SELF.fetch("https://example.com/api/onboarding/turn", {
      method: "POST",
      headers: { Cookie: `habit_session=${tokenA}`, "Content-Type": "application/json" },
      body: JSON.stringify({ session_id: started.sessionId, answer: "mine now" }),
    });

    expect(res.status).toBe(404);

    const row = await env.DB.prepare("SELECT transcript FROM qa_sessions WHERE id = ?")
      .bind(started.sessionId)
      .first<{ transcript: string }>();
    expect(JSON.parse(row!.transcript).answers).toHaveLength(0);
  });
});
