import { Hono } from "hono";
import { setCookie } from "hono/cookie";
import { z } from "zod";
import { requireAuth } from "./auth-middleware";
import { ConsoleEmailSender, redeemMagicLink, requestMagicLink } from "./magic-link";
import { createSession, SESSION_COOKIE_NAME, SESSION_DURATION_MS } from "./session";
import { getSuggestions } from "./suggestions";
import { adoptHabit, checkIn, undoCheckIn } from "./tracking";
import type { Bindings, Variables } from "./types";

export type { Bindings, Variables };

const app = new Hono<{ Bindings: Bindings; Variables: Variables }>();

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

// Always scoped by the session-resolved user_id (set by requireAuth), never
// by anything in the request — the multi-tenancy rule (CLAUDE.md §12).
app.get("/api/me", requireAuth, async (c) => {
  const userId = c.get("userId");
  const user = await c.env.DB.prepare(
    "SELECT id, email, display_name, timezone FROM users WHERE id = ?",
  )
    .bind(userId)
    .first<{ id: string; email: string; display_name: string; timezone: string }>();

  if (!user) {
    return c.json({ error: "not_found" }, 404);
  }

  return c.json({ user });
});

app.get("/api/suggestions", requireAuth, async (c) => {
  const userId = c.get("userId");
  const suggestions = await getSuggestions(c.env.DB, userId, new Date());

  return c.json({ suggestions });
});

app.post("/api/habits/:id/adopt", requireAuth, async (c) => {
  const userId = c.get("userId");
  const habitId = c.req.param("id");

  if (!habitId) {
    return c.json({ error: "unknown_habit" }, 404);
  }

  const result = await adoptHabit(c.env.DB, userId, habitId);

  if (!result.ok) {
    return c.json({ error: result.reason }, result.reason === "unknown_habit" ? 404 : 409);
  }

  return c.json({ user_habit_id: result.userHabitId }, 201);
});

// The offline queue may replay a check-off made on an earlier local date, so
// the client can name that date; the server still verifies ownership itself.
const checkinBodySchema = z.object({ local_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/) }).partial();

app.post("/api/user-habits/:id/checkin", requireAuth, async (c) => {
  const userId = c.get("userId");
  const body = await c.req.json().catch(() => ({}));
  const parsed = checkinBodySchema.safeParse(body ?? {});

  if (!parsed.success) {
    return c.json({ error: "invalid_local_date" }, 400);
  }

  const userHabitId = c.req.param("id");

  if (!userHabitId) {
    return c.json({ error: "not_found" }, 404);
  }

  const result = await checkIn(c.env.DB, userId, userHabitId, new Date(), parsed.data.local_date);

  if (!result.ok) {
    return c.json({ error: result.reason }, 404);
  }

  return c.json({ outcome: result.outcome, streak: result.streak, local_date: result.localDate });
});

app.delete("/api/user-habits/:id/checkin", requireAuth, async (c) => {
  const userId = c.get("userId");
  const userHabitId = c.req.param("id");

  if (!userHabitId) {
    return c.json({ error: "not_found" }, 404);
  }

  const result = await undoCheckIn(c.env.DB, userId, userHabitId, new Date());

  if (!result.ok) {
    return c.json({ error: result.reason }, 404);
  }

  return c.json({ removed: result.removed, streak: result.streak });
});

export default app;
