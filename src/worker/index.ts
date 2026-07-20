import { Hono } from "hono";
import { z } from "zod";
import { ConsoleEmailSender, requestMagicLink } from "./magic-link";

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

export default app;
