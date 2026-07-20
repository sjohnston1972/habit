import { env } from "cloudflare:test";
import { beforeEach, describe, expect, it } from "vitest";
import { createSession, deleteSession, lookupSession, renewSession } from "../src/worker/session";

let userId: string;

beforeEach(async () => {
  userId = crypto.randomUUID();
  await env.DB.prepare(
    "INSERT INTO users (id, email, display_name, timezone) VALUES (?, ?, ?, ?)",
  )
    .bind(userId, `${userId}@example.com`, "Session Test", "Europe/London")
    .run();
});

describe("session layer", () => {
  it("create: stores only the hashed token, never the raw one", async () => {
    const { token, session } = await createSession(env.DB, userId);

    expect(token).toBeTruthy();
    expect(session.userId).toBe(userId);

    const row = await env.DB.prepare("SELECT token_hash FROM sessions WHERE id = ?")
      .bind(session.id)
      .first<{ token_hash: string }>();

    expect(row).not.toBeNull();
    expect(row!.token_hash).not.toBe(token);
    expect(row!.token_hash).toMatch(/^[0-9a-f]{64}$/);
  });

  it("lookup: resolves a valid token back to its session, and rejects unknown tokens", async () => {
    const { token, session } = await createSession(env.DB, userId);

    const found = await lookupSession(env.DB, token);
    expect(found).toEqual(session);

    const notFound = await lookupSession(env.DB, "this-token-was-never-issued");
    expect(notFound).toBeNull();
  });

  it("expiry: an expired session is rejected on lookup", async () => {
    const { token, session } = await createSession(env.DB, userId);

    const alreadyExpired = new Date(Date.now() - 1000).toISOString();
    await env.DB.prepare("UPDATE sessions SET expires_at = ? WHERE id = ?")
      .bind(alreadyExpired, session.id)
      .run();

    const found = await lookupSession(env.DB, token);
    expect(found).toBeNull();
  });

  it("renewal: extends the expiry window forward and keeps the token valid", async () => {
    const { token, session } = await createSession(env.DB, userId);

    const renewed = await renewSession(env.DB, token);
    expect(renewed).not.toBeNull();
    expect(new Date(renewed!.expiresAt).getTime()).toBeGreaterThan(
      new Date(session.expiresAt).getTime(),
    );

    const row = await env.DB.prepare("SELECT expires_at FROM sessions WHERE id = ?")
      .bind(session.id)
      .first<{ expires_at: string }>();
    expect(row!.expires_at).toBe(renewed!.expiresAt);

    const stillFound = await lookupSession(env.DB, token);
    expect(stillFound).toEqual(renewed);
  });

  it("renewal: returns null for an already-expired session instead of reviving it", async () => {
    const { token, session } = await createSession(env.DB, userId);

    const alreadyExpired = new Date(Date.now() - 1000).toISOString();
    await env.DB.prepare("UPDATE sessions SET expires_at = ? WHERE id = ?")
      .bind(alreadyExpired, session.id)
      .run();

    const renewed = await renewSession(env.DB, token);
    expect(renewed).toBeNull();
  });

  it("delete: removes the session so the token no longer resolves", async () => {
    const { token } = await createSession(env.DB, userId);

    await deleteSession(env.DB, token);

    const found = await lookupSession(env.DB, token);
    expect(found).toBeNull();
  });
});
