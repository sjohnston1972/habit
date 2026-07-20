import { sha256Hex } from "./hash";

const MAGIC_LINK_TTL_MS = 15 * 60 * 1000; // 15 minutes, per CLAUDE.md §3
const RATE_LIMIT_WINDOW_MS = 60 * 1000; // 1 minute
const RATE_LIMIT_MAX_REQUESTS = 3; // a 4th request in the window is rejected

const DEFAULT_BASE_URL = "https://habit.clydeford.net";

export interface EmailSender {
  send(email: string, magicLink: string): Promise<void>;
}

// Dev implementation — logs instead of sending. Do not wire a real provider
// (Resend) into this run; see CLAUDE.md §3 and PLAN.md decisions.
export class ConsoleEmailSender implements EmailSender {
  async send(email: string, magicLink: string): Promise<void> {
    console.log(`[magic-link] ${email}: ${magicLink}`);
  }
}

export type RequestMagicLinkResult = { ok: true } | { ok: false; reason: "rate_limited" };

async function countRecentRequests(
  db: D1Database,
  email: string,
  ip: string,
  sinceIso: string,
): Promise<number> {
  const row = await db
    .prepare(
      "SELECT COUNT(*) AS n FROM magic_links WHERE (email = ? OR ip = ?) AND created_at > ?",
    )
    .bind(email, ip, sinceIso)
    .first<{ n: number }>();
  return row?.n ?? 0;
}

// Rate limited per-IP and per-email: a burst from either dimension counts
// against the same window, so switching IP or email alone doesn't bypass it.
export async function requestMagicLink(
  db: D1Database,
  email: string,
  ip: string,
  emailSender: EmailSender,
  baseUrl: string = DEFAULT_BASE_URL,
): Promise<RequestMagicLinkResult> {
  const windowStart = new Date(Date.now() - RATE_LIMIT_WINDOW_MS).toISOString();
  const recentCount = await countRecentRequests(db, email, ip, windowStart);

  if (recentCount >= RATE_LIMIT_MAX_REQUESTS) {
    return { ok: false, reason: "rate_limited" };
  }

  const token = crypto.randomUUID() + crypto.randomUUID();
  const tokenHash = await sha256Hex(token);
  const id = crypto.randomUUID();
  const now = new Date();
  const expiresAt = new Date(now.getTime() + MAGIC_LINK_TTL_MS).toISOString();

  await db
    .prepare(
      "INSERT INTO magic_links (id, token_hash, email, ip, created_at, expires_at) VALUES (?, ?, ?, ?, ?, ?)",
    )
    .bind(id, tokenHash, email, ip, now.toISOString(), expiresAt)
    .run();

  const link = `${baseUrl}/api/auth/callback?token=${token}`;
  await emailSender.send(email, link);

  return { ok: true };
}
