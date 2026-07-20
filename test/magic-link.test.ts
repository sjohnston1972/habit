import { SELF, env } from "cloudflare:test";
import { describe, expect, it } from "vitest";
import { requestMagicLink, type EmailSender } from "../src/worker/magic-link";
import { sha256Hex } from "../src/worker/hash";

class CapturingEmailSender implements EmailSender {
  sent: { email: string; magicLink: string }[] = [];

  async send(email: string, magicLink: string): Promise<void> {
    this.sent.push({ email, magicLink });
  }
}

function extractToken(magicLink: string): string {
  return new URL(magicLink).searchParams.get("token")!;
}

async function requestLinkOverHttp(email: string, ip: string): Promise<Response> {
  return SELF.fetch("https://example.com/api/auth/request-link", {
    method: "POST",
    headers: { "Content-Type": "application/json", "CF-Connecting-IP": ip },
    body: JSON.stringify({ email }),
  });
}

describe("requestMagicLink", () => {
  it("writes a hashed token row and never stores the raw token", async () => {
    const email = `${crypto.randomUUID()}@example.com`;
    const sender = new CapturingEmailSender();

    const result = await requestMagicLink(env.DB, email, "203.0.113.10", sender);
    expect(result.ok).toBe(true);
    expect(sender.sent).toHaveLength(1);

    const rawToken = extractToken(sender.sent[0].magicLink);
    const expectedHash = await sha256Hex(rawToken);

    const row = await env.DB.prepare(
      "SELECT token_hash, email, used_at FROM magic_links WHERE email = ?",
    )
      .bind(email)
      .first<{ token_hash: string; email: string; used_at: string | null }>();

    expect(row).not.toBeNull();
    expect(row!.token_hash).toBe(expectedHash);
    expect(row!.token_hash).not.toBe(rawToken);
    expect(row!.token_hash).toMatch(/^[0-9a-f]{64}$/);
    expect(row!.used_at).toBeNull();
  });
});

describe("POST /api/auth/request-link", () => {
  it("returns 400 for a malformed email", async () => {
    const res = await requestLinkOverHttp("not-an-email", "203.0.113.20");
    expect(res.status).toBe(400);
  });

  it("returns 200 for a well-formed request", async () => {
    const res = await requestLinkOverHttp(`${crypto.randomUUID()}@example.com`, "203.0.113.21");
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
  });

  it("rejects the 4th rapid request from the same IP/email", async () => {
    const email = `${crypto.randomUUID()}@example.com`;
    const ip = "203.0.113.22";

    const first = await requestLinkOverHttp(email, ip);
    const second = await requestLinkOverHttp(email, ip);
    const third = await requestLinkOverHttp(email, ip);
    const fourth = await requestLinkOverHttp(email, ip);

    expect(first.status).toBe(200);
    expect(second.status).toBe(200);
    expect(third.status).toBe(200);
    expect(fourth.status).toBe(429);
    expect(await fourth.json()).toEqual({ error: "rate_limited" });
  });
});
