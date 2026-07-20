import type { Context, Next } from "hono";
import { getCookie } from "hono/cookie";
import { lookupSession, SESSION_COOKIE_NAME } from "./session";
import type { Bindings, Variables } from "./types";

type AuthContext = Context<{ Bindings: Bindings; Variables: Variables }>;

// The multi-tenancy rule: every protected route reads the caller's user_id
// from here, never from request input — a route can't be tricked into
// scoping a query to a different tenant.
export async function requireAuth(c: AuthContext, next: Next) {
  const token = getCookie(c, SESSION_COOKIE_NAME);
  if (!token) {
    return c.json({ error: "unauthorized" }, 401);
  }

  const session = await lookupSession(c.env.DB, token);
  if (!session) {
    return c.json({ error: "unauthorized" }, 401);
  }

  c.set("userId", session.userId);
  await next();
}
