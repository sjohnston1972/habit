import { sha256Hex } from "./hash";

const SESSION_DURATION_MS = 30 * 24 * 60 * 60 * 1000; // 30 days, per CLAUDE.md §3

export interface Session {
  id: string;
  userId: string;
  expiresAt: string;
}

interface SessionRow {
  id: string;
  user_id: string;
  expires_at: string;
}

function generateRawToken(): string {
  return crypto.randomUUID() + crypto.randomUUID();
}

function toSession(row: SessionRow): Session {
  return { id: row.id, userId: row.user_id, expiresAt: row.expires_at };
}

// Returns the raw token — this is the only place it ever exists outside the
// caller's memory. Only its SHA-256 hash is written to D1.
export async function createSession(
  db: D1Database,
  userId: string,
): Promise<{ token: string; session: Session }> {
  const token = generateRawToken();
  const tokenHash = await sha256Hex(token);
  const id = crypto.randomUUID();
  const now = new Date();
  const expiresAt = new Date(now.getTime() + SESSION_DURATION_MS).toISOString();

  await db
    .prepare(
      "INSERT INTO sessions (id, token_hash, user_id, created_at, expires_at) VALUES (?, ?, ?, ?, ?)",
    )
    .bind(id, tokenHash, userId, now.toISOString(), expiresAt)
    .run();

  return { token, session: { id, userId, expiresAt } };
}

// Returns null for an unknown, forged, or expired token — callers can't tell
// the difference, which is the point.
export async function lookupSession(db: D1Database, token: string): Promise<Session | null> {
  const tokenHash = await sha256Hex(token);
  const row = await db
    .prepare("SELECT id, user_id, expires_at FROM sessions WHERE token_hash = ?")
    .bind(tokenHash)
    .first<SessionRow>();

  if (!row) return null;
  if (new Date(row.expires_at).getTime() <= Date.now()) return null;

  return toSession(row);
}

// Slides the 30-day expiry window forward from now. Returns null if the
// token doesn't match a live (non-expired) session.
export async function renewSession(db: D1Database, token: string): Promise<Session | null> {
  const existing = await lookupSession(db, token);
  if (!existing) return null;

  const expiresAt = new Date(Date.now() + SESSION_DURATION_MS).toISOString();
  await db.prepare("UPDATE sessions SET expires_at = ? WHERE id = ?").bind(expiresAt, existing.id).run();

  return { ...existing, expiresAt };
}

export async function deleteSession(db: D1Database, token: string): Promise<void> {
  const tokenHash = await sha256Hex(token);
  await db.prepare("DELETE FROM sessions WHERE token_hash = ?").bind(tokenHash).run();
}
