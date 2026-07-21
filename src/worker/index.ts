import { Hono } from "hono";
import { setCookie } from "hono/cookie";
import { z } from "zod";
import { requireAuth } from "./auth-middleware";
import { ConsoleEmailSender, redeemMagicLink, requestMagicLink, type EmailSender } from "./magic-link";
import { ResendEmailSender } from "./resend-email";
import { createSession, SESSION_COOKIE_NAME, SESSION_DURATION_MS } from "./session";
import { createClaudeClient } from "./claude";
import { onboardingTurn } from "./onboarding";
import { getSuggestions } from "./suggestions";
import { adoptHabit, checkIn, dismissSuggestion, getToday, undoCheckIn } from "./tracking";
import type { Bindings, Variables } from "./types";

export type { Bindings, Variables };

const app = new Hono<{ Bindings: Bindings; Variables: Variables }>();

app.get("/health", (c) => c.json({ ok: true }));

const requestLinkSchema = z.object({ email: z.string().email() });

const DEFAULT_EMAIL_FROM = "Clydeford Habits <noreply@clydeford.net>";

// Resend in production; console logging in dev or if the key is unset — so a
// misconfigured secret degrades to "check the logs" rather than a hard outage.
function emailSenderFor(env: Bindings): EmailSender {
  if (env.RESEND_API_KEY) {
    return new ResendEmailSender(env.RESEND_API_KEY, env.EMAIL_FROM || DEFAULT_EMAIL_FROM);
  }
  return new ConsoleEmailSender();
}

app.post("/api/auth/request-link", async (c) => {
  const body = await c.req.json().catch(() => null);
  const parsed = requestLinkSchema.safeParse(body);

  if (!parsed.success) {
    return c.json({ error: "invalid_email" }, 400);
  }

  const ip = c.req.header("CF-Connecting-IP") ?? "unknown";

  let result;
  try {
    result = await requestMagicLink(c.env.DB, parsed.data.email, ip, emailSenderFor(c.env));
  } catch (error) {
    // The link row is written before the send, so a delivery failure leaves a
    // harmless unused token; surface a clear error rather than a false success.
    console.error("[request-link] send failed:", error);
    return c.json({ error: "email_send_failed" }, 502);
  }

  if (!result.ok) {
    return c.json({ error: result.reason }, 429);
  }

  return c.json({ ok: true });
});

// A browser navigates here by clicking the emailed link, so the response is a
// redirect into the app — not JSON. On success the session cookie is set and
// the user lands on the app root (→ Today); on failure they land on the app
// with an error flag so the sign-in screen can explain it. A missing token is
// a malformed request, not a user flow, so it stays a 400.
app.get("/api/auth/callback", async (c) => {
  const token = c.req.query("token");

  if (!token) {
    return c.json({ error: "invalid" }, 400);
  }

  const redeemed = await redeemMagicLink(c.env.DB, token);
  if (!redeemed.ok) {
    return c.redirect("/?auth=failed", 302);
  }

  const { token: sessionToken } = await createSession(c.env.DB, redeemed.userId);

  setCookie(c, SESSION_COOKIE_NAME, sessionToken, {
    httpOnly: true,
    secure: true,
    sameSite: "Lax",
    path: "/",
    maxAge: SESSION_DURATION_MS / 1000,
  });

  return c.redirect("/", 302);
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

app.post("/api/habits/:id/dismiss", requireAuth, async (c) => {
  const userId = c.get("userId");
  const habitId = c.req.param("id");

  if (!habitId) {
    return c.json({ error: "unknown_habit" }, 404);
  }

  const result = await dismissSuggestion(c.env.DB, userId, habitId);

  return c.json({ dismissed: result.dismissed });
});

const onboardingBodySchema = z
  .object({ session_id: z.string().min(1), answer: z.string().max(2000) })
  .partial();

app.post("/api/onboarding/turn", requireAuth, async (c) => {
  const userId = c.get("userId");
  const parsed = onboardingBodySchema.safeParse(await c.req.json().catch(() => ({})));

  if (!parsed.success) {
    return c.json({ error: "invalid_request" }, 400);
  }

  if (!c.env.ANTHROPIC_API_KEY) {
    return c.json({ error: "ai_unavailable" }, 503);
  }

  const result = await onboardingTurn({
    db: c.env.DB,
    userId,
    client: createClaudeClient(c.env.ANTHROPIC_API_KEY),
    now: new Date(),
    sessionId: parsed.data.session_id,
    answer: parsed.data.answer,
  });

  if (!result.ok) {
    const status = result.reason === "rate_limited" ? 429 : 404;
    return c.json({ error: result.reason }, status);
  }

  return c.json(result);
});

app.get("/api/today", requireAuth, async (c) => {
  const userId = c.get("userId");
  const habits = await getToday(c.env.DB, userId, new Date());

  return c.json({ habits });
});

export default app;
