import { SELF, env } from "cloudflare:test";
import { describe, expect, it } from "vitest";
import { createSession } from "../src/worker/session";

async function createUser(email: string): Promise<string> {
  const id = crypto.randomUUID();
  await env.DB.prepare(
    "INSERT INTO users (id, email, display_name, timezone) VALUES (?, ?, ?, ?)",
  )
    .bind(id, email, email.split("@")[0], "UTC")
    .run();
  return id;
}

describe("GET /api/me", () => {
  it("returns 401 when no session cookie is present", async () => {
    const res = await SELF.fetch("https://example.com/api/me");
    expect(res.status).toBe(401);
  });

  it("returns 401 for a forged/unknown session cookie", async () => {
    const res = await SELF.fetch("https://example.com/api/me", {
      headers: { Cookie: "habit_session=forged-token-never-issued" },
    });
    expect(res.status).toBe(401);
  });

  it("returns only the authenticated user's own data — user A cannot read user B's rows", async () => {
    const emailA = `${crypto.randomUUID()}@example.com`;
    const emailB = `${crypto.randomUUID()}@example.com`;
    const userAId = await createUser(emailA);
    const userBId = await createUser(emailB);

    const { token: tokenA } = await createSession(env.DB, userAId);
    const { token: tokenB } = await createSession(env.DB, userBId);

    const resA = await SELF.fetch("https://example.com/api/me", {
      headers: { Cookie: `habit_session=${tokenA}` },
    });
    expect(resA.status).toBe(200);
    const bodyA = await resA.json<{ user: { id: string; email: string } }>();
    expect(bodyA.user.id).toBe(userAId);
    expect(bodyA.user.email).toBe(emailA);

    const resB = await SELF.fetch("https://example.com/api/me", {
      headers: { Cookie: `habit_session=${tokenB}` },
    });
    expect(resB.status).toBe(200);
    const bodyB = await resB.json<{ user: { id: string; email: string } }>();
    expect(bodyB.user.id).toBe(userBId);
    expect(bodyB.user.email).toBe(emailB);

    // Cross-tenant isolation: A's session must never resolve to B's data,
    // even when a request tries to smuggle B's id in as a query param —
    // the route ignores request input entirely and trusts only the
    // session-resolved user_id.
    const spoofAttempt = await SELF.fetch(`https://example.com/api/me?userId=${userBId}`, {
      headers: { Cookie: `habit_session=${tokenA}` },
    });
    expect(spoofAttempt.status).toBe(200);
    const spoofBody = await spoofAttempt.json<{ user: { id: string } }>();
    expect(spoofBody.user.id).toBe(userAId);
    expect(spoofBody.user.id).not.toBe(userBId);
  });
});
