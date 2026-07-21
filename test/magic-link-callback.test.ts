import { SELF, env } from "cloudflare:test";
import { describe, expect, it } from "vitest";
import { redeemMagicLink, requestMagicLink, type EmailSender } from "../src/worker/magic-link";

class CapturingEmailSender implements EmailSender {
  sent: { email: string; magicLink: string }[] = [];

  async send(email: string, magicLink: string): Promise<void> {
    this.sent.push({ email, magicLink });
  }
}

function extractToken(magicLink: string): string {
  return new URL(magicLink).searchParams.get("token")!;
}

async function issueToken(email: string, ip: string): Promise<string> {
  const sender = new CapturingEmailSender();
  const result = await requestMagicLink(env.DB, email, ip, sender);
  if (!result.ok) throw new Error("failed to issue token in test setup");
  return extractToken(sender.sent[0].magicLink);
}

describe("redeemMagicLink", () => {
  it("happy path: redeems the token, marks it used, and creates the user", async () => {
    const email = `${crypto.randomUUID()}@example.com`;
    const token = await issueToken(email, "198.51.100.1");

    const result = await redeemMagicLink(env.DB, token);
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("unreachable");

    const user = await env.DB.prepare("SELECT id, email FROM users WHERE id = ?")
      .bind(result.userId)
      .first<{ id: string; email: string }>();
    expect(user).not.toBeNull();
    expect(user!.email).toBe(email);

    const link = await env.DB.prepare("SELECT used_at FROM magic_links WHERE email = ?")
      .bind(email)
      .first<{ used_at: string | null }>();
    expect(link!.used_at).not.toBeNull();
  });

  it("happy path: redeeming again for the same email reuses the existing user", async () => {
    const email = `${crypto.randomUUID()}@example.com`;
    const firstToken = await issueToken(email, "198.51.100.2");
    const first = await redeemMagicLink(env.DB, firstToken);
    expect(first.ok).toBe(true);

    const secondToken = await issueToken(email, "198.51.100.2");
    const second = await redeemMagicLink(env.DB, secondToken);
    expect(second.ok).toBe(true);

    if (!first.ok || !second.ok) throw new Error("unreachable");
    expect(second.userId).toBe(first.userId);
  });

  it("rejects a reused token", async () => {
    const email = `${crypto.randomUUID()}@example.com`;
    const token = await issueToken(email, "198.51.100.3");

    const first = await redeemMagicLink(env.DB, token);
    expect(first.ok).toBe(true);

    const second = await redeemMagicLink(env.DB, token);
    expect(second).toEqual({ ok: false, reason: "used" });
  });

  it("rejects an expired token", async () => {
    const email = `${crypto.randomUUID()}@example.com`;
    const token = await issueToken(email, "198.51.100.4");

    const alreadyExpired = new Date(Date.now() - 1000).toISOString();
    await env.DB.prepare("UPDATE magic_links SET expires_at = ? WHERE email = ?")
      .bind(alreadyExpired, email)
      .run();

    const result = await redeemMagicLink(env.DB, token);
    expect(result).toEqual({ ok: false, reason: "expired" });
  });

  it("rejects a forged token that was never issued", async () => {
    const result = await redeemMagicLink(env.DB, "forged-token-never-issued");
    expect(result).toEqual({ ok: false, reason: "invalid" });
  });
});

describe("GET /api/auth/callback", () => {
  it("redeems, sets the session cookie, and redirects into the app on success", async () => {
    const email = `${crypto.randomUUID()}@example.com`;
    const token = await issueToken(email, "198.51.100.5");

    // A browser follows the redirect; manual mode lets us inspect it.
    const res = await SELF.fetch(`https://example.com/api/auth/callback?token=${token}`, {
      redirect: "manual",
    });

    // 302 to the app root — this is what carries the just-signed-in user to Today.
    expect(res.status).toBe(302);
    expect(res.headers.get("Location")).toBe("/");

    const setCookie = res.headers.get("Set-Cookie");
    expect(setCookie).toBeTruthy();
    expect(setCookie).toMatch(/habit_session=/);
    expect(setCookie).toMatch(/HttpOnly/i);
    expect(setCookie).toMatch(/Secure/i);
    expect(setCookie).toMatch(/SameSite=Lax/i);
  });

  it("redirects to the app with an error flag for a reused token, setting no session", async () => {
    const email = `${crypto.randomUUID()}@example.com`;
    const token = await issueToken(email, "198.51.100.6");

    const first = await SELF.fetch(`https://example.com/api/auth/callback?token=${token}`, {
      redirect: "manual",
    });
    expect(first.status).toBe(302);

    const second = await SELF.fetch(`https://example.com/api/auth/callback?token=${token}`, {
      redirect: "manual",
    });
    expect(second.status).toBe(302);
    expect(second.headers.get("Location")).toBe("/?auth=failed");
    // A failed redeem must not hand out a session.
    expect(second.headers.get("Set-Cookie")).toBeNull();
  });

  it("redirects to the app with an error flag for a forged token", async () => {
    const res = await SELF.fetch("https://example.com/api/auth/callback?token=totally-made-up", {
      redirect: "manual",
    });
    expect(res.status).toBe(302);
    expect(res.headers.get("Location")).toBe("/?auth=failed");
    expect(res.headers.get("Set-Cookie")).toBeNull();
  });

  it("returns 400 when no token is provided", async () => {
    const res = await SELF.fetch("https://example.com/api/auth/callback");
    expect(res.status).toBe(400);
  });
});
