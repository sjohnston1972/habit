import { Hono } from "hono";
import { setCookie } from "hono/cookie";
import { z } from "zod";
import { ConsoleEmailSender, redeemMagicLink, requestMagicLink } from "./magic-link";
import { createSession, SESSION_COOKIE_NAME, SESSION_DURATION_MS } from "./session";

export type Bindings = {
  DB: D1Database;
};

const app = new Hono<{ Bindings: Bindings }>();

app.get("/health", (c) => c.json({ ok: true }));

const requestLinkSchema = z.object({ email: z.string().email() });

app.post("/api/auth/request-link", async (c) => {
  const body = await c.req.json().catch(() => null);
  const parsed = requestLinkSchema.safeParse(body);

  if (!parsed.success) {
    return c.json({ error: "invalid_email" }, 400);
  }

  const ip = c.req.header("CF-Connecting-IP") ?? "unknown";
  const result = await requestMagicLink(c.env.DB, parsed.data.email, ip, new ConsoleEmailSender());

  if (!result.ok) {
    return c.json({ error: result.reason }, 429);
  }

  return c.json({ ok: true });
});

app.get("/api/auth/callback", async (c) => {
  const token = c.req.query("token");

  if (!token) {
    return c.json({ error: "invalid" }, 400);
  }

  const redeemed = await redeemMagicLink(c.env.DB, token);
  if (!redeemed.ok) {
    return c.json({ error: redeemed.reason }, 400);
  }

  const { token: sessionToken } = await createSession(c.env.DB, redeemed.userId);

  setCookie(c, SESSION_COOKIE_NAME, sessionToken, {
    httpOnly: true,
    secure: true,
    sameSite: "Lax",
    path: "/",
    maxAge: SESSION_DURATION_MS / 1000,
  });

  return c.json({ ok: true });
});

export default app;
